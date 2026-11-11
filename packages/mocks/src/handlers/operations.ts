// Library, warehouse (with the book shop) and transport — mock handlers and stores, owned by the operations module.
// Rules the real server enforces live here too: one open loan per copy, fines worked out from the campus rule,
// stock that can never go below zero, posted documents corrected only by reversal, stock counts approved by a
// second person, vehicles that cannot carry more riders than seats without a decision, and the transport fee,
// library fines and book-shop sales on account sent to the student's fee account in Fees.
import {
  can,
  type CampusCode,
  type Charge,
  type Ctx,
  type LibraryCabinet,
  type LibraryCopy,
  type LibraryCopyRow,
  type LibraryLibrary,
  type LibraryCountDetail,
  type LibraryCountResult,
  type LibraryCountRow,
  type LibraryCountSummary,
  type LibraryFinePolicy,
  type LibraryLoan,
  type LibraryMember,
  type LibraryOverview,
  type LibraryShelf,
  type LibraryTitle,
  type LibraryTitleDetail,
  type OperationsPerson,
  type OperationsPersonType,
  type Permission,
  type SessionUser,
  type TransportAlert,
  type TransportFuel,
  type TransportOverview,
  type TransportRider,
  type TransportRoute,
  type TransportRouteSheet,
  type TransportTrip,
  type TransportVehicle,
  type WarehouseBookSet,
  type WarehouseCount,
  type WarehouseDepartment,
  type WarehouseGrn,
  type WarehouseIssue,
  type WarehouseItem,
  type WarehouseItemDetail,
  type WarehouseMovement,
  type WarehouseOverview,
  type WarehouseRequest,
  type WarehouseRequestStatus,
  type WarehouseReturn,
  type WarehouseRoomStock,
  type WarehouseSale,
  type WarehouseSupplier,
  LIBRARY_COPY_STATUS_LABEL,
  WAREHOUSE_UNITS,
} from "@mtb/api";
import { amountInWords, daysBetween, formatDate, formatRs, formatSession, type IsoDate } from "@mtb/domain";
import { http, type HttpHandler } from "msw";
import { CURRENT_SESSION, DEMO_TODAY, demoNow } from "../clock";
import { createStore } from "../db";
import { campusName, campusOf } from "../fixtures/campuses";
import {
  addDays,
  initialLibrary,
  initialTransport,
  initialWarehouse,
  OPS_CAMPUSES,
  OPS_STAFF,
  type LibCopyRec,
  type LibLoanRec,
  type LibTitleRec,
  type TrnRiderRec,
  type WhItemRec,
  type WhMoveRec,
  type WhSaleRec,
} from "../fixtures/operations";
import { findStudent, STUDENTS } from "../fixtures/students";
import { currentUser } from "./auth-state";
import { chargesOf, feesStore } from "./fees-state";
import { smsStatusStore } from "./sms-model";
import { ctxFrom, fail, HttpResponse, latency } from "../util";

// v2: libraries, room numbers and floors, copy placement and write-offs, supplier email and mobile, tax on receipts.
const libStore = createStore("operations.library.v2", initialLibrary);
const whStore = createStore("operations.warehouse.v2", initialWarehouse);
const trnStore = createStore("operations.transport", initialTransport);
const idemStore = createStore<Record<string, unknown>>("operations.idem", () => ({}));

const TODAY = DEMO_TODAY;
const sessionStart = (s: number): IsoDate => `${s}-04-01`;
const sessionEnd = (s: number): IsoDate => `${s + 1}-03-31`;
const inSession = (d: IsoDate, s: number) => d >= sessionStart(s) && d <= sessionEnd(s);
const scopeOf = (ctx: Ctx): CampusCode[] => (ctx.campus === "ALL" ? OPS_CAMPUSES : [ctx.campus]);
const inScope = (ctx: Ctx, campus: CampusCode) => ctx.campus === "ALL" || ctx.campus === campus;
const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 9)}`;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, "");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (iso: IsoDate) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const int = (v: unknown) => typeof v === "number" && Number.isInteger(v);

/* ================================================================================================ Guards */

type Guarded = SessionUser | Response;

function guard(permission: Permission, campus: Ctx["campus"]): Guarded {
  const user = currentUser();
  if (!user) return fail(401, "UNAUTHENTICATED", "Please sign in.");
  if (!can(user, permission, campus)) return fail(403, "FORBIDDEN", "Your role can't do this at this campus.");
  return user;
}

/** Changes need one campus and the current session. */
function writeGuard(permission: Permission, ctx: Ctx): Guarded {
  const user = guard(permission, ctx.campus);
  if (user instanceof Response) return user;
  if (ctx.campus === "ALL") return fail(400, "CAMPUS_REQUIRED", "Choose a campus first. Records always belong to one campus.");
  if (ctx.session !== CURRENT_SESSION) return fail(409, "SESSION_CLOSED", `Session ${formatSession(ctx.session)} is closed. Switch to ${formatSession(CURRENT_SESSION)} to make changes.`);
  return user;
}

/**
 * A change to an existing record uses the record's own campus and the session the user is working in.
 * The client sends ?session= with every write, so a return, renew or cancel made while a closed session
 * is selected is refused by writeGuard (SESSION_CLOSED) rather than slipping through.
 */
const ctxOf = (campus: CampusCode, request: Request): Ctx => ({ campus, session: ctxFrom(new URL(request.url)).session });

/** For org-wide writes (categories) and approvals that don't go through writeGuard: refuse a closed session. */
function closedSession(request: Request): Response | null {
  const { session } = ctxFrom(new URL(request.url));
  return session !== CURRENT_SESSION ? fail(409, "SESSION_CLOSED", `Session ${formatSession(session)} is closed. Switch to ${formatSession(CURRENT_SESSION)} to make changes.`) : null;
}

/** A retried post with the same Idempotency-Key gets the first answer back instead of a second document. */
function idem(request: Request): { key: string | null; hit: Record<string, unknown> | undefined } {
  const key = request.headers.get("Idempotency-Key");
  return { key, hit: key ? (idemStore.get()[key] as Record<string, unknown> | undefined) : undefined };
}
function remember<T>(key: string | null, value: T): T {
  if (key) idemStore.set((m) => ({ ...m, [key]: value }));
  return value;
}

const bad = (field: string, message: string) => fail(400, "VALIDATION", message, { field });

/**
 * Optimistic locking: a form sends the rowVer it was opened with; if the record was saved since, the save is refused
 * so nobody overwrites a change they have not seen.
 */
function stale(rec: { rowVer?: number }, sent: number | undefined, what: string): Response | null {
  const current = rec.rowVer ?? 1;
  if (sent === undefined || sent === current) return null;
  return fail(409, "CONCURRENCY", `This ${what} was changed by someone else after you opened it. Reload to see the change, then make yours again.`, { details: { rowVer: current } });
}

/** "Teaching", "Non-teaching" or "Management" from a staff member's post. */
export function staffGroupOf(detail: string): string {
  const d = detail.toLowerCase();
  if (/principal|director|coordinator|head of/.test(d)) return "Management";
  if (/teacher|qari|lecturer|instructor/.test(d)) return "Teaching";
  return "Non-teaching";
}

/* ================================================================================================ People */

function studentPerson(grNo: string): OperationsPerson | null {
  const s = findStudent(grNo);
  if (!s) return null;
  return { id: s.grNo, type: "STUDENT", name: s.name, detail: s.classSection, father: s.father, relation: s.relation, mobile: s.guardian.mobile, campus: s.campus, active: s.status === "ACTIVE" };
}
function staffPerson(id: string): OperationsPerson | null {
  const s = OPS_STAFF.find((x) => x.id === id);
  return s ? { id: s.id, type: "STAFF", name: s.name, detail: s.detail, father: "", relation: "", mobile: s.mobile, campus: s.campus, active: true } : null;
}
const personOf = (type: OperationsPersonType, id: string) => (type === "STUDENT" ? studentPerson(id) : staffPerson(id));

function searchPeople(ctx: Ctx, q: string, type: OperationsPersonType | ""): OperationsPerson[] {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  const compact = needle.replace(/[^a-z0-9]/g, "");
  const out: OperationsPerson[] = [];
  if (type !== "STAFF") {
    for (const s of STUDENTS) {
      if (!inScope(ctx, s.campus)) continue;
      const hit = `${s.name} ${s.father} ${s.classSection}`.toLowerCase().includes(needle) || (compact.length >= 3 && s.grNo.replace("-", "").toLowerCase().includes(compact));
      if (hit) out.push(studentPerson(s.grNo)!);
      if (out.length >= 10) break;
    }
  }
  if (type !== "STUDENT") {
    for (const s of OPS_STAFF) {
      if (!inScope(ctx, s.campus)) continue;
      if (`${s.name} ${s.detail}`.toLowerCase().includes(needle) || (compact.length >= 3 && s.id.replace(/-/g, "").toLowerCase().includes(compact))) out.push(staffPerson(s.id)!);
    }
  }
  return out.slice(0, 14);
}

/* ================================================================================================ Fees link */

/** Adds a charge to a student's fee account in Fees (it then shows at the fee counter). */
function addFeeCharge(grNo: string, key: string, head: string, amount: number, dueDate: IsoDate): string {
  chargesOf(grNo);
  const id = `${grNo}:${key}`;
  const charge: Charge = { id, grNo, session: CURRENT_SESSION, head, kind: "FEE", amount, dueDate, status: "OPEN", settledAmount: 0 };
  feesStore.set((st) => {
    const list = st.charges[grNo] ?? [];
    if (list.some((c) => c.id === id)) return st;
    return { ...st, charges: { ...st.charges, [grNo]: [...list, charge] } };
  });
  return id;
}
/** Cancels a charge this module raised, if nothing has been paid against it. Returns false when it was paid. */
function cancelFeeCharge(grNo: string, id: string): boolean {
  const c = feesStore.get().charges[grNo]?.find((x) => x.id === id);
  if (!c) return true;
  if (c.settledAmount > 0 || c.status === "SETTLED") return false;
  feesStore.set((st) => ({ ...st, charges: { ...st.charges, [grNo]: (st.charges[grNo] ?? []).map((x) => (x.id === id ? { ...x, status: "CANCELLED" as const } : x)) } }));
  return true;
}
function setFeeChargeAmount(grNo: string, id: string, amount: number) {
  feesStore.set((st) => ({ ...st, charges: { ...st.charges, [grNo]: (st.charges[grNo] ?? []).map((x) => (x.id === id && x.status === "OPEN" && x.settledAmount === 0 ? { ...x, amount } : x)) } }));
}

/* ================================================================================================ Library: views */

type Lib = ReturnType<typeof libStore.get>;

function shelfMap(lib: Lib) {
  const m = new Map<string, { cabinetId: string; code: string; label: string; full: string }>();
  for (const c of lib.cabinets) for (const s of c.shelves) m.set(s.id, { cabinetId: c.id, code: c.code, label: s.label, full: `${c.code} · ${s.label}` });
  return m;
}

function policyOf(lib: Lib, campus: CampusCode, type: OperationsPersonType): LibraryFinePolicy {
  const p = lib.policies.find((x) => x.campus === campus && x.borrowerType === type)!;
  const { campus: _c, ...rest } = p;
  return rest;
}

function fineFor(policy: LibraryFinePolicy, daysLate: number, cost: number) {
  const chargeable = Math.max(0, daysLate - policy.graceDays);
  const raw = chargeable * policy.ratePerDay;
  return policy.capAtCost ? Math.min(raw, cost) : raw;
}

function loanView(lib: Lib, l: LibLoanRec): LibraryLoan {
  const copy = lib.copies.find((c) => c.id === l.copyId)!;
  const title = lib.titles.find((t) => t.id === copy.titleId)!;
  const person = personOf(l.borrowerType, l.borrowerId);
  const daysLate = Math.max(0, daysBetween(l.dueOn, l.returnedOn ?? TODAY));
  const fine = l.returnedOn ? l.fine : fineFor(policyOf(lib, l.campus, l.borrowerType), daysLate, copy.cost);
  return {
    id: l.id,
    campus: l.campus,
    copyId: copy.id,
    accessionNo: copy.accessionNo,
    titleId: title.id,
    title: title.title,
    titleUr: title.titleUr,
    authors: title.authors,
    borrowerType: l.borrowerType,
    borrowerId: l.borrowerId,
    borrowerName: person?.name ?? l.borrowerId,
    borrowerDetail: person ? (person.type === "STUDENT" && !person.active ? `${person.detail} · left the school` : person.detail) : "",
    borrowerGroup: person && person.type === "STAFF" ? staffGroupOf(person.detail) : "",
    mobile: person?.mobile ?? "",
    issuedOn: l.issuedOn,
    dueOn: l.dueOn,
    returnedOn: l.returnedOn,
    daysLate,
    fine,
    fineStatus: l.fineStatus,
    fineNote: l.fineNote,
    issuedBy: l.issuedBy,
    returnedBy: l.returnedBy,
    reminders: l.reminders,
    lastReminderAt: l.lastReminderAt,
    lost: l.lost,
  };
}

function openLoanOf(lib: Lib, copyId: string) {
  return lib.loans.find((l) => l.copyId === copyId && !l.returnedOn);
}

function copyView(lib: Lib, c: LibCopyRec, shelves = shelfMap(lib)): LibraryCopy {
  const open = openLoanOf(lib, c.id);
  const lv = open ? loanView(lib, open) : null;
  return {
    id: c.id,
    titleId: c.titleId,
    campus: c.campus,
    accessionNo: c.accessionNo,
    shelfId: c.shelfId,
    shelfLabel: c.shelfId ? (shelves.get(c.shelfId)?.full ?? null) : null,
    status: c.status,
    condition: c.condition,
    cost: c.cost,
    acquiredOn: c.acquiredOn,
    placedOn: c.placedOn ?? null,
    writtenOff: c.writtenOff ?? null,
    note: c.note,
    loan: lv ? { loanId: lv.id, borrowerName: lv.borrowerName, borrowerDetail: lv.borrowerDetail, dueOn: lv.dueOn, daysLate: lv.daysLate } : null,
    loans: lib.loans.filter((l) => l.copyId === c.id).length,
  };
}

function titleView(lib: Lib, t: LibTitleRec, shelves = shelfMap(lib)): LibraryTitle {
  const cs = lib.copies.filter((c) => c.titleId === t.id);
  const cat = lib.categories.find((c) => c.id === t.categoryId);
  const cabLib = new Map(lib.cabinets.map((c) => [c.id, c.libraryId]));
  return {
    ...t,
    volume: t.volume ?? null,
    publisherCountry: t.publisherCountry ?? "",
    rowVer: t.rowVer ?? 1,
    libraryIds: [...new Set(cs.map((c) => (c.shelfId ? cabLib.get(shelves.get(c.shelfId)?.cabinetId ?? "") : undefined)).filter((x): x is string => Boolean(x)))],
    category: cat?.name ?? "",
    copies: cs.length,
    available: cs.filter((c) => c.status === "AVAILABLE").length,
    onLoan: cs.filter((c) => c.status === "ON_LOAN").length,
    outOfUse: cs.filter((c) => !["AVAILABLE", "ON_LOAN"].includes(c.status)).length,
    shelves: [...new Set(cs.map((c) => (c.shelfId ? shelves.get(c.shelfId)?.full : undefined)).filter((x): x is string => Boolean(x)))].sort(),
  };
}

function titleDetail(lib: Lib, t: LibTitleRec): LibraryTitleDetail {
  const shelves = shelfMap(lib);
  const cs = lib.copies.filter((c) => c.titleId === t.id);
  const ids = new Set(cs.map((c) => c.id));
  return {
    ...titleView(lib, t, shelves),
    copyList: cs.map((c) => copyView(lib, c, shelves)).sort((a, b) => a.accessionNo.localeCompare(b.accessionNo)),
    loans: lib.loans
      .filter((l) => ids.has(l.copyId))
      .map((l) => loanView(lib, l))
      .sort((a, b) => b.issuedOn.localeCompare(a.issuedOn)),
  };
}

function libActivity(campus: CampusCode, kind: "ISSUE" | "RETURN" | "LOST" | "ADDED" | "COUNT" | "REMINDER", text: string, by: string) {
  libStore.set((s) => ({ ...s, activity: [{ id: uid("la"), campus, at: demoNow(), kind, text, by }, ...s.activity].slice(0, 80) }));
}

function libOverview(ctx: Ctx): LibraryOverview {
  const lib = libStore.get();
  const campuses = scopeOf(ctx);
  const copies = lib.copies.filter((c) => campuses.includes(c.campus));
  const titles = lib.titles.filter((t) => campuses.includes(t.campus));
  const loans = lib.loans.filter((l) => campuses.includes(l.campus));
  const open = loans.filter((l) => !l.returnedOn);
  const since = addDays(TODAY, -30);
  // Weeks start on Monday; the last bar is the current week.
  const dow = (new Date(`${TODAY}T00:00:00Z`).getUTCDay() + 6) % 7;
  const thisMonday = addDays(TODAY, -dow);
  const byWeek = Array.from({ length: 10 }, (_, i) => {
    const ws = addDays(thisMonday, (i - 9) * 7);
    const we = addDays(ws, 7);
    return { weekStart: ws, issued: loans.filter((l) => l.issuedOn >= ws && l.issuedOn < we).length, returned: loans.filter((l) => l.returnedOn && l.returnedOn >= ws && l.returnedOn < we).length };
  });
  const byCategory = lib.categories
    .map((cat) => {
      const ids = new Set(titles.filter((t) => t.categoryId === cat.id).map((t) => t.id));
      const cs = copies.filter((c) => ids.has(c.titleId));
      return { name: cat.name, copies: cs.length, onLoan: cs.filter((c) => c.status === "ON_LOAN").length };
    })
    .filter((x) => x.copies > 0)
    .sort((a, b) => b.copies - a.copies);
  const openCountRec = lib.counts.find((c) => campuses.includes(c.campus) && c.status === "OPEN");
  const openCount = openCountRec ? (() => {
    const d = countDetail(lib, openCountRec.id)!;
    return { id: d.id, name: d.name, scanned: d.scanned, expected: d.expected };
  })() : null;
  return {
    titles: titles.length,
    copies: copies.length,
    available: copies.filter((c) => c.status === "AVAILABLE").length,
    onLoan: open.length,
    overdue: open.filter((l) => l.dueOn < TODAY).length,
    dueToday: open.filter((l) => l.dueOn === TODAY).length,
    issuedLast30: loans.filter((l) => l.issuedOn > since).length,
    returnedLast30: loans.filter((l) => l.returnedOn && l.returnedOn > since).length,
    finesLast30: loans.filter((l) => l.returnedOn && l.returnedOn > since && l.fineStatus !== "WAIVED").reduce((a, l) => a + l.fine, 0),
    outOfUse: copies.filter((c) => !["AVAILABLE", "ON_LOAN"].includes(c.status)).length,
    byWeek,
    byCategory,
    recent: lib.activity.filter((a) => campuses.includes(a.campus)).slice(0, 8).map(({ campus: _c, ...a }) => a),
    openCount,
  };
}

/* ---------------------------------------------------------------- Stock counts */

function countRows(lib: Lib, countId: string): { rows: LibraryCountRow[]; expected: number } {
  const count = lib.counts.find((c) => c.id === countId)!;
  const shelves = shelfMap(lib);
  const scopeShelves = new Set(lib.cabinets.filter((c) => count.cabinetIds.includes(c.id)).flatMap((c) => c.shelves.map((s) => s.id)));
  const label = (id: string | null) => (id ? (shelves.get(id)?.full ?? "") : "");
  const titleOf = (c: LibCopyRec) => lib.titles.find((t) => t.id === c.titleId)?.title ?? "";
  const rows: LibraryCountRow[] = [];
  const scanned = new Set<string>();
  for (const sc of count.scans) {
    const copy = lib.copies.find((c) => c.campus === count.campus && c.accessionNo === sc.accessionNo);
    scanned.add(sc.accessionNo);
    if (!copy) {
      rows.push({ accessionNo: sc.accessionNo, copyId: null, title: "", recordedShelf: "", scannedShelf: label(sc.shelfId), result: "UNKNOWN", action: "Check the label; add the book to the catalogue if it is new" });
      continue;
    }
    let result: LibraryCountResult = "FOUND";
    let action = "No change";
    if (copy.status === "ON_LOAN") {
      result = "ON_LOAN_FOUND";
      action = "Close the loan as returned (no fine)";
    } else if (["LOST", "MISSING", "WITHDRAWN"].includes(copy.status)) {
      result = "WRITTEN_OFF_FOUND";
      action = `Put back on ${label(sc.shelfId)}`;
    } else if (copy.shelfId !== sc.shelfId) {
      result = "WRONG_SHELF";
      action = `Move to ${label(sc.shelfId)} in the catalogue`;
    }
    rows.push({ accessionNo: copy.accessionNo, copyId: copy.id, title: titleOf(copy), recordedShelf: label(copy.shelfId), scannedShelf: label(sc.shelfId), result, action });
  }
  let expected = 0;
  for (const copy of lib.copies) {
    if (copy.campus !== count.campus || !copy.shelfId || !scopeShelves.has(copy.shelfId)) continue;
    if (copy.status === "AVAILABLE") {
      expected++;
      if (!scanned.has(copy.accessionNo)) rows.push({ accessionNo: copy.accessionNo, copyId: copy.id, title: titleOf(copy), recordedShelf: label(copy.shelfId), scannedShelf: "", result: "MISSING", action: "Mark as missing" });
    } else if (copy.status === "ON_LOAN" && !scanned.has(copy.accessionNo)) {
      const loan = openLoanOf(lib, copy.id);
      const who = loan ? personOf(loan.borrowerType, loan.borrowerId)?.name : "";
      rows.push({ accessionNo: copy.accessionNo, copyId: copy.id, title: titleOf(copy), recordedShelf: label(copy.shelfId), scannedShelf: "", result: "ON_LOAN", action: `No change (on loan${who ? ` to ${who}` : ""})` });
    }
  }
  const order: Record<LibraryCountResult, number> = { MISSING: 0, WRONG_SHELF: 1, ON_LOAN_FOUND: 2, WRITTEN_OFF_FOUND: 3, UNKNOWN: 4, ON_LOAN: 5, FOUND: 6 };
  rows.sort((a, b) => order[a.result] - order[b.result] || a.accessionNo.localeCompare(b.accessionNo));
  return { rows, expected };
}

const DISCREPANCY: LibraryCountResult[] = ["MISSING", "WRONG_SHELF", "ON_LOAN_FOUND", "WRITTEN_OFF_FOUND", "UNKNOWN"];

function countDetail(lib: Lib, id: string): LibraryCountDetail | null {
  const count = lib.counts.find((c) => c.id === id);
  if (!count) return null;
  const shelves = shelfMap(lib);
  const cabs = lib.cabinets.filter((c) => count.cabinetIds.includes(c.id));
  let rows: LibraryCountRow[];
  let expected: number;
  if (count.status === "CLOSED" && count.closedRows) {
    rows = count.closedRows.map((r) => ({ ...r, result: r.result as LibraryCountResult }));
    expected = rows.filter((r) => r.result === "FOUND" || r.result === "WRONG_SHELF" || r.result === "MISSING").length;
  } else {
    ({ rows, expected } = countRows(lib, id));
  }
  const shelfList: LibraryShelf[] = cabs.flatMap((c) => c.shelves.map((s) => ({ id: s.id, cabinetId: c.id, label: s.label, fullLabel: `${c.code} · ${s.label}`, copies: lib.copies.filter((x) => x.shelfId === s.id).length })));
  return {
    id: count.id,
    campus: count.campus,
    name: count.name,
    cabinetIds: count.cabinetIds,
    cabinets: cabs.map((c) => c.code).join(", "),
    status: count.status,
    startedOn: count.startedOn,
    startedBy: count.startedBy,
    closedOn: count.closedOn,
    closedBy: count.closedBy,
    expected,
    scanned: count.scans.length,
    found: rows.filter((r) => r.result === "FOUND" || r.result === "WRONG_SHELF").length,
    missing: rows.filter((r) => r.result === "MISSING").length,
    discrepancies: rows.filter((r) => DISCREPANCY.includes(r.result)).length,
    rows,
    scans: [...count.scans].reverse().map((s) => ({ ...s, shelfLabel: shelves.get(s.shelfId)?.full ?? "" })),
    shelves: shelfList,
    applied: count.applied,
  };
}

const countSummary = (d: LibraryCountDetail): LibraryCountSummary => {
  const { rows: _r, scans: _s, shelves: _sh, applied: _a, ...rest } = d;
  return rest;
};

/** Accepts "KC-L-14063", "kc l 14063" or just "14063". */
function findCopyByAccession(lib: Lib, campus: CampusCode, raw: string): LibCopyRec | undefined {
  const v = raw.trim().toUpperCase().replace(/\s+/g, "-");
  const digits = v.replace(/\D/g, "");
  return lib.copies.find((c) => c.campus === campus && (c.accessionNo === v || (digits.length >= 3 && c.accessionNo.endsWith(`-${digits.padStart(5, "0")}`))));
}

function memberView(lib: Lib, ctx: Ctx, type: OperationsPersonType, id: string): LibraryMember | null {
  const person = personOf(type, id);
  if (!person) return null;
  const policy = policyOf(lib, person.campus, type);
  const loans = lib.loans
    .filter((l) => l.borrowerType === type && l.borrowerId === id)
    .map((l) => loanView(lib, l))
    .sort((a, b) => b.issuedOn.localeCompare(a.issuedOn));
  const open = loans.filter((l) => !l.returnedOn);
  const overdue = open.filter((l) => l.dueOn < TODAY);
  const blockReason = !person.active ? `${person.name} has left the school. Books can't be issued.` : open.length >= policy.maxLoans ? `${person.name} already has ${open.length} ${open.length === 1 ? "book" : "books"}, the most a ${type === "STUDENT" ? "student" : "staff member"} may borrow. Return one first.` : "";
  void ctx;
  return {
    person,
    loans,
    policy,
    totals: {
      borrowed: loans.length,
      open: open.length,
      overdue: overdue.length,
      returnedLate: loans.filter((l) => l.returnedOn && l.returnedOn > l.dueOn).length,
      finesCharged: loans.filter((l) => l.returnedOn && ["ADDED_TO_FEES", "PAID"].includes(l.fineStatus)).reduce((a, l) => a + l.fine, 0),
      finesWaived: loans.filter((l) => l.fineStatus === "WAIVED").reduce((a, l) => a + l.fine, 0),
    },
    blockReason,
  };
}

function setupView(ctx: Ctx) {
  const lib = libStore.get();
  const campuses = scopeOf(ctx);
  const titles = lib.titles.filter((t) => campuses.includes(t.campus));
  const copies = lib.copies.filter((c) => campuses.includes(c.campus));
  const libName = new Map(lib.libraries.map((l) => [l.id, l.name]));
  const cabinets: LibraryCabinet[] = lib.cabinets
    .filter((c) => campuses.includes(c.campus))
    .map((c) => ({
      ...c,
      libraryName: libName.get(c.libraryId) ?? "",
      rowVer: c.rowVer ?? 1,
      shelves: c.shelves.map((s) => ({ id: s.id, cabinetId: c.id, label: s.label, fullLabel: `${c.code} · ${s.label}`, copies: copies.filter((x) => x.shelfId === s.id).length })),
      copies: copies.filter((x) => x.shelfId && c.shelves.some((s) => s.id === x.shelfId)).length,
    }));
  const libraries: LibraryLibrary[] = lib.libraries
    .filter((l) => campuses.includes(l.campus))
    .map((l) => {
      const cabs = cabinets.filter((c) => c.libraryId === l.id);
      return { ...l, rowVer: l.rowVer ?? 1, cabinets: cabs.length, copies: cabs.reduce((a, c) => a + c.copies, 0) };
    });
  const tally = (pick: (t: LibTitleRec) => string[]) => {
    const m = new Map<string, { name: string; titles: number; copies: number }>();
    for (const t of titles) {
      for (const n of pick(t)) {
        if (!n) continue;
        const k = norm(n);
        const row = m.get(k) ?? { name: n, titles: 0, copies: 0 };
        row.titles++;
        row.copies += copies.filter((c) => c.titleId === t.id).length;
        m.set(k, row);
      }
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  };
  const campus = ctx.campus === "ALL" ? "KC" : ctx.campus;
  return {
    libraries,
    cabinets,
    categories: lib.categories.map((c) => ({ ...c, titles: titles.filter((t) => t.categoryId === c.id).length })),
    authors: tally((t) => t.authors),
    publishers: tally((t) => [t.publisher]),
    policies: (["STUDENT", "STAFF"] as const).map((b) => policyOf(lib, campus, b)),
    nextAccessionNo: `${campus}-L-${String(lib.nextAccession[campus] ?? 1).padStart(5, "0")}`,
  };
}

/* ================================================================================================ Library: handlers */

interface TitleBody {
  title: string;
  titleUr: string;
  authors: string[];
  publisher: string;
  categoryId: string;
  language: "EN" | "UR" | "AR" | "PA";
  edition: string;
  volume?: number | null;
  publisherCountry?: string;
  year: number | null;
  isbn: string;
  pages: number | null;
  rowVer?: number;
  copies?: { count: number; shelfId: string | null; cost: number; acquiredOn: IsoDate; condition: LibCopyRec["condition"] };
}

function validateTitle(lib: Lib, campus: CampusCode, b: TitleBody, id?: string): Response | null {
  if ((b.title ?? "").trim().length < 2 && (b.titleUr ?? "").trim().length < 2) return bad("title", "Enter the title in English or Urdu.");
  if (!Array.isArray(b.authors) || b.authors.filter((a) => a.trim()).length === 0) return bad("authors", "Enter at least one author.");
  if (!lib.categories.some((c) => c.id === b.categoryId)) return bad("categoryId", "Choose a subject.");
  if (!["EN", "UR", "AR", "PA"].includes(b.language)) return bad("language", "Choose the language.");
  if (b.volume !== undefined && b.volume !== null && (!int(b.volume) || b.volume < 1 || b.volume > 999)) return bad("volume", "Volume is a number from 1 to 999. Leave it empty for a single book.");
  if ((b.publisherCountry ?? "").trim().length > 60) return bad("publisherCountry", "Keep the country under 60 letters.");
  if (b.year !== null && (!int(b.year) || b.year < 1800 || b.year > 2027)) return bad("year", "Enter the year it was published, for example 2019.");
  const isbn = (b.isbn ?? "").replace(/[-\s]/g, "");
  if (isbn && !/^(\d{9}[\dX]|\d{13})$/i.test(isbn)) return bad("isbn", "An ISBN has 10 or 13 digits. Leave it empty if the book has none.");
  if (isbn) {
    const dup = lib.titles.find((t) => t.campus === campus && t.id !== id && t.isbn.replace(/[-\s]/g, "") === isbn);
    if (dup) return fail(409, "DUPLICATE_ISBN", `This ISBN is already in the catalogue as "${dup.title}". Add copies to it instead.`, { field: "isbn", details: { titleId: dup.id } });
  }
  const sameTitle = lib.titles.find(
    (t) => t.campus === campus && t.id !== id && norm(t.title || t.titleUr) === norm(b.title || b.titleUr) && norm(t.authors[0] ?? "") === norm(b.authors[0] ?? "") && norm(t.edition) === norm(b.edition ?? "") && (t.volume ?? null) === (b.volume ?? null),
  );
  if (sameTitle) return fail(409, "DUPLICATE_TITLE", `"${sameTitle.title || sameTitle.titleUr}"${sameTitle.volume ? `, volume ${sameTitle.volume},` : ""} by ${sameTitle.authors[0]} is already in the catalogue. Add copies to it instead.`, { field: "title", details: { titleId: sameTitle.id } });
  return null;
}

/** Uses the spelling already on file for a known author or publisher, so names are kept once. */
function canonical(lib: Lib, name: string, kind: "author" | "publisher"): string {
  const k = norm(name);
  if (!k) return name.trim();
  for (const t of lib.titles) {
    const names = kind === "author" ? t.authors : [t.publisher];
    const hit = names.find((n) => norm(n) === k);
    if (hit) return hit;
  }
  return name.trim().replace(/\s+/g, " ");
}

function validateCopies(lib: Lib, campus: CampusCode, c: NonNullable<TitleBody["copies"]>): Response | null {
  if (!int(c.count) || c.count < 1 || c.count > 50) return bad("copies.count", "Enter how many copies, from 1 to 50.");
  if (c.shelfId && !lib.cabinets.some((cab) => cab.campus === campus && cab.shelves.some((s) => s.id === c.shelfId))) return bad("copies.shelfId", "Choose a shelf at this campus.");
  if (!int(c.cost) || c.cost < 0) return bad("copies.cost", "Enter the price paid in whole rupees.");
  if (!c.acquiredOn || c.acquiredOn > TODAY) return bad("copies.acquiredOn", "Enter the date the copies arrived (today or earlier).");
  return null;
}

function addCopiesTo(campus: CampusCode, titleId: string, c: NonNullable<TitleBody["copies"]>): string[] {
  const nos: string[] = [];
  libStore.set((s) => {
    let n = s.nextAccession[campus] ?? 1;
    const added: LibCopyRec[] = [];
    for (let i = 0; i < c.count; i++) {
      const accessionNo = `${campus}-L-${String(n++).padStart(5, "0")}`;
      nos.push(accessionNo);
      added.push({ id: uid(`${campus}-cp`), campus, titleId, accessionNo, shelfId: c.shelfId, status: "AVAILABLE", condition: c.condition ?? "NEW", cost: c.cost, acquiredOn: c.acquiredOn, placedOn: c.shelfId ? c.acquiredOn : null, writtenOff: null, note: "" });
    }
    return { ...s, copies: [...s.copies, ...added], nextAccession: { ...s.nextAccession, [campus]: n } };
  });
  return nos;
}

const libraryHandlers: HttpHandler[] = [
  http.get("/api/operations/people", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = currentUser();
    if (!user) return fail(401, "UNAUTHENTICATED", "Please sign in.");
    if (!(["library.view", "warehouse.view", "transport.view"] as const).some((p) => can(user, p, ctx.campus))) return fail(403, "FORBIDDEN", "Your role can't do this at this campus.");
    const type = (url.searchParams.get("type") ?? "") as OperationsPersonType | "";
    return HttpResponse.json(searchPeople(ctx, url.searchParams.get("q") ?? "", type));
  }),

  http.get("/api/library/overview", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = guard("library.view", ctx.campus);
    if (user instanceof Response) return user;
    return HttpResponse.json(libOverview(ctx));
  }),

  http.get("/api/library/titles", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = guard("library.view", ctx.campus);
    if (user instanceof Response) return user;
    const lib = libStore.get();
    const shelves = shelfMap(lib);
    return HttpResponse.json(lib.titles.filter((t) => inScope(ctx, t.campus)).map((t) => titleView(lib, t, shelves)).sort((a, b) => (a.title || a.titleUr).localeCompare(b.title || b.titleUr)));
  }),

  http.get("/api/library/titles/:id", async ({ params }) => {
    await latency();
    const lib = libStore.get();
    const t = lib.titles.find((x) => x.id === params.id);
    if (!t) return fail(404, "NOT_FOUND", "This title is no longer in the catalogue.");
    const user = guard("library.view", t.campus);
    if (user instanceof Response) return user;
    return HttpResponse.json(titleDetail(lib, t));
  }),

  http.post("/api/library/titles", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = writeGuard("library.manage", ctx);
    if (user instanceof Response) return user;
    const campus = ctx.campus as CampusCode;
    const b = (await request.json()) as TitleBody;
    const lib = libStore.get();
    const err = validateTitle(lib, campus, b) ?? (b.copies ? validateCopies(lib, campus, b.copies) : null);
    if (err) return err;
    const rec: LibTitleRec = {
      id: uid(`${campus}-t`),
      campus,
      title: b.title.trim(),
      titleUr: (b.titleUr ?? "").trim(),
      authors: b.authors.filter((a) => a.trim()).map((a) => canonical(lib, a, "author")),
      publisher: b.publisher ? canonical(lib, b.publisher, "publisher") : "",
      categoryId: b.categoryId,
      language: b.language,
      edition: (b.edition ?? "").trim(),
      volume: b.volume ?? null,
      publisherCountry: (b.publisherCountry ?? "").trim(),
      year: b.year,
      isbn: (b.isbn ?? "").trim(),
      pages: b.pages,
      addedOn: TODAY,
      rowVer: 1,
    };
    libStore.set((s) => ({ ...s, titles: [...s.titles, rec] }));
    const nos = b.copies ? addCopiesTo(campus, rec.id, b.copies) : [];
    libActivity(campus, "ADDED", `${rec.title || rec.titleUr} added to the catalogue${nos.length ? ` (${nos.length} ${nos.length === 1 ? "copy" : "copies"}, ${nos[0]}${nos.length > 1 ? ` to ${nos[nos.length - 1]}` : ""})` : ""}`, user.name);
    return HttpResponse.json(titleDetail(libStore.get(), rec), { status: 201 });
  }),

  http.put("/api/library/titles/:id", async ({ request, params }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const lib = libStore.get();
    const t = lib.titles.find((x) => x.id === params.id);
    if (!t) return fail(404, "NOT_FOUND", "This title is no longer in the catalogue.");
    const user = writeGuard("library.manage", { ...ctx, campus: t.campus });
    if (user instanceof Response) return user;
    const b = (await request.json()) as TitleBody;
    const conflict = stale(t, b.rowVer, "title");
    if (conflict) return conflict;
    const err = validateTitle(lib, t.campus, b, t.id);
    if (err) return err;
    const next: LibTitleRec = {
      ...t,
      title: b.title.trim(),
      titleUr: (b.titleUr ?? "").trim(),
      authors: b.authors.filter((a) => a.trim()).map((a) => canonical(lib, a, "author")),
      publisher: b.publisher ? canonical(lib, b.publisher, "publisher") : "",
      categoryId: b.categoryId,
      language: b.language,
      edition: (b.edition ?? "").trim(),
      volume: b.volume ?? null,
      publisherCountry: (b.publisherCountry ?? "").trim(),
      year: b.year,
      isbn: (b.isbn ?? "").trim(),
      pages: b.pages,
      rowVer: (t.rowVer ?? 1) + 1,
    };
    libStore.set((s) => ({ ...s, titles: s.titles.map((x) => (x.id === t.id ? next : x)) }));
    return HttpResponse.json(titleDetail(libStore.get(), next));
  }),

  http.post("/api/library/titles/:id/copies", async ({ request, params }) => {
    await latency();
    const lib = libStore.get();
    const t = lib.titles.find((x) => x.id === params.id);
    if (!t) return fail(404, "NOT_FOUND", "This title is no longer in the catalogue.");
    const user = writeGuard("library.manage", ctxOf(t.campus, request));
    if (user instanceof Response) return user;
    const b = (await request.json()) as NonNullable<TitleBody["copies"]>;
    const err = validateCopies(lib, t.campus, b);
    if (err) return err;
    const nos = addCopiesTo(t.campus, t.id, b);
    libActivity(t.campus, "ADDED", `${nos.length} ${nos.length === 1 ? "copy" : "copies"} of ${t.title || t.titleUr} added (${nos[0]}${nos.length > 1 ? ` to ${nos[nos.length - 1]}` : ""})`, user.name);
    return HttpResponse.json(titleDetail(libStore.get(), t), { status: 201 });
  }),

  http.put("/api/library/copies/:id", async ({ request, params }) => {
    await latency();
    const lib = libStore.get();
    const c = lib.copies.find((x) => x.id === params.id);
    if (!c) return fail(404, "NOT_FOUND", "This copy is no longer in the catalogue.");
    const user = writeGuard("library.manage", ctxOf(c.campus, request));
    if (user instanceof Response) return user;
    const b = (await request.json()) as { shelfId: string | null; condition: LibCopyRec["condition"]; note: string };
    if (b.shelfId && !lib.cabinets.some((cab) => cab.campus === c.campus && cab.shelves.some((s) => s.id === b.shelfId))) return bad("shelfId", "Choose a shelf at this campus.");
    // A copy moved to another shelf is placed there today.
    const moved = (b.shelfId ?? null) !== c.shelfId;
    libStore.set((s) => ({ ...s, copies: s.copies.map((x) => (x.id === c.id ? { ...x, shelfId: b.shelfId, placedOn: moved ? (b.shelfId ? TODAY : null) : (x.placedOn ?? null), condition: b.condition, note: (b.note ?? "").slice(0, 200) } : x)) }));
    return HttpResponse.json(copyView(libStore.get(), libStore.get().copies.find((x) => x.id === c.id)!));
  }),

  http.post("/api/library/copies/:id/status", async ({ request, params }) => {
    await latency();
    const lib = libStore.get();
    const c = lib.copies.find((x) => x.id === params.id);
    if (!c) return fail(404, "NOT_FOUND", "This copy is no longer in the catalogue.");
    const user = writeGuard("library.manage", ctxOf(c.campus, request));
    if (user instanceof Response) return user;
    const b = (await request.json()) as { status: "LOST" | "DAMAGED" | "WITHDRAWN" | "AVAILABLE"; reason: string; charge?: "FEES" | "WAIVE"; approvedById?: string };
    const reason = (b.reason ?? "").trim();
    if (b.status !== "AVAILABLE" && reason.length < 3) return bad("reason", "Say what happened, in a few words.");
    // A write-off needs the staff member who approved it (the legacy "wasted approved by").
    const approver = b.status === "AVAILABLE" ? null : staffPerson(b.approvedById ?? "");
    if (b.status !== "AVAILABLE") {
      if (!approver) return bad("approvedById", "Choose the staff member who approved this.");
      if (approver.campus !== c.campus) return bad("approvedById", `${approver.name} works at ${campusName(approver.campus)}. Choose someone at this campus.`);
    }
    const writtenOff = approver ? { on: TODAY, by: user.name, approvedBy: approver.name, reason } : null;
    const open = openLoanOf(lib, c.id);
    const title = lib.titles.find((t) => t.id === c.titleId)!;
    if (b.status === "LOST") {
      if (open) {
        const person = personOf(open.borrowerType, open.borrowerId);
        let fineStatus: LibLoanRec["fineStatus"] = "NONE";
        let fine = 0;
        if (open.borrowerType === "STUDENT" && b.charge === "FEES") {
          addFeeCharge(open.borrowerId, `lib-lost-${open.id}`, `Library: lost book (${title.title || title.titleUr})`, c.cost, TODAY);
          fineStatus = "ADDED_TO_FEES";
          fine = c.cost;
        } else if (b.charge === "WAIVE" || open.borrowerType === "STAFF") {
          fineStatus = "WAIVED";
          fine = c.cost;
        }
        libStore.set((s) => ({
          ...s,
          loans: s.loans.map((l) => (l.id === open.id ? { ...l, returnedOn: TODAY, returnedBy: user.name, lost: true, fine, fineStatus, fineNote: `Lost: ${reason}` } : l)),
          copies: s.copies.map((x) => (x.id === c.id ? { ...x, status: "LOST", note: reason, writtenOff } : x)),
        }));
        libActivity(c.campus, "LOST", `${title.title || title.titleUr} (${c.accessionNo}) lost by ${person?.name ?? open.borrowerId}${fineStatus === "ADDED_TO_FEES" ? `; ${formatRs(c.cost)} added to the fee account` : ""}; approved by ${approver!.name}`, user.name);
      } else {
        libStore.set((s) => ({ ...s, copies: s.copies.map((x) => (x.id === c.id ? { ...x, status: "LOST", note: reason, writtenOff } : x)) }));
        libActivity(c.campus, "LOST", `${title.title || title.titleUr} (${c.accessionNo}) written off as lost; approved by ${approver!.name}`, user.name);
      }
    } else if (b.status === "DAMAGED" || b.status === "WITHDRAWN") {
      if (open) return fail(409, "ON_LOAN", "This copy is on loan. Take it back first, then mark its condition.");
      libStore.set((s) => ({ ...s, copies: s.copies.map((x) => (x.id === c.id ? { ...x, status: b.status, condition: b.status === "DAMAGED" ? "DAMAGED" : x.condition, note: reason, writtenOff } : x)) }));
      libActivity(c.campus, "LOST", `${title.title || title.titleUr} (${c.accessionNo}) ${b.status === "DAMAGED" ? "marked damaged" : "withdrawn"}; approved by ${approver!.name}`, user.name);
    } else {
      if (c.status === "ON_LOAN" || c.status === "AVAILABLE") return fail(409, "NOTHING_TO_DO", `This copy is already ${LIBRARY_COPY_STATUS_LABEL[c.status].toLowerCase()}.`);
      libStore.set((s) => ({ ...s, copies: s.copies.map((x) => (x.id === c.id ? { ...x, status: "AVAILABLE", condition: x.condition === "DAMAGED" ? "WORN" : x.condition, note: reason || `Back in use from ${formatDate(TODAY)}`, writtenOff: null } : x)) }));
      libActivity(c.campus, "ADDED", `${title.title || title.titleUr} (${c.accessionNo}) put back in use`, user.name);
    }
    return HttpResponse.json(copyView(libStore.get(), libStore.get().copies.find((x) => x.id === c.id)!));
  }),

  http.get("/api/library/lookup", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = guard("library.view", ctx.campus);
    if (user instanceof Response) return user;
    if (ctx.campus === "ALL") return fail(400, "CAMPUS_REQUIRED", "Choose a campus first.");
    const raw = url.searchParams.get("accessionNo") ?? "";
    const lib = libStore.get();
    const copy = findCopyByAccession(lib, ctx.campus, raw);
    if (!copy) return fail(404, "NOT_FOUND", `No copy with accession number ${raw.trim().toUpperCase()} at ${campusName(ctx.campus)}. Check the label on the spine, or search by title.`, { field: "accessionNo" });
    const title = lib.titles.find((t) => t.id === copy.titleId)!;
    const open = openLoanOf(lib, copy.id);
    return HttpResponse.json({ copy: copyView(lib, copy), title: titleView(lib, title), loan: open ? loanView(lib, open) : null });
  }),

  http.get("/api/library/loans", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = guard("library.view", ctx.campus);
    if (user instanceof Response) return user;
    const status = url.searchParams.get("status") ?? "ALL";
    const type = url.searchParams.get("borrowerType") ?? "";
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const cls = url.searchParams.get("cls") ?? "";
    const section = url.searchParams.get("section") ?? "";
    const staffGroup = url.searchParams.get("staffGroup") ?? "";
    const lib = libStore.get();
    // Class and section come from the student's class now (findStudent), not from the text shown on the loan.
    const inClass = (l: LibLoanRec) => {
      if (!cls && !section) return true;
      if (l.borrowerType !== "STUDENT") return false;
      const cs = findStudent(l.borrowerId)?.classSection ?? "";
      return (!cls || cs.startsWith(`${cls}-`)) && (!section || cs.endsWith(`-${section}`));
    };
    const rows = lib.loans
      .filter((l) => inScope(ctx, l.campus))
      .filter((l) => inSession(l.issuedOn, ctx.session) || (ctx.session === CURRENT_SESSION && !l.returnedOn))
      .filter((l) => (status === "OPEN" ? !l.returnedOn : status === "OVERDUE" ? !l.returnedOn && l.dueOn < TODAY : status === "RETURNED" ? Boolean(l.returnedOn) : true))
      .filter((l) => !type || l.borrowerType === type)
      .filter((l) => !from || l.issuedOn >= from)
      .filter((l) => !to || l.issuedOn <= to)
      .filter(inClass)
      .map((l) => loanView(lib, l))
      .filter((l) => !staffGroup || (l.borrowerType === "STAFF" && l.borrowerGroup === staffGroup))
      .filter((l) => !q || `${l.title} ${l.titleUr} ${l.borrowerName} ${l.borrowerId} ${l.accessionNo} ${l.authors.join(" ")}`.toLowerCase().includes(q))
      .sort((a, b) => (status === "OVERDUE" ? b.daysLate - a.daysLate : b.issuedOn.localeCompare(a.issuedOn)));
    return HttpResponse.json(rows);
  }),

  http.post("/api/library/loans", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = writeGuard("library.manage", ctx);
    if (user instanceof Response) return user;
    const { key, hit } = idem(request);
    if (hit) return HttpResponse.json(hit, { status: 201 });
    const campus = ctx.campus as CampusCode;
    const b = (await request.json()) as { copyId: string; borrowerType: OperationsPersonType; borrowerId: string; dueOn: IsoDate; allowOverdue?: boolean };
    const lib = libStore.get();
    const copy = lib.copies.find((c) => c.id === b.copyId && c.campus === campus);
    if (!copy) return bad("copyId", "Scan or type the accession number of the copy.");
    const title = lib.titles.find((t) => t.id === copy.titleId)!;
    const open = openLoanOf(lib, copy.id);
    if (open) {
      const lv = loanView(lib, open);
      return fail(409, "ON_LOAN", `This copy is already on loan to ${lv.borrowerName} until ${formatDate(lv.dueOn)}. Take it back first.`, { field: "copyId" });
    }
    if (copy.status !== "AVAILABLE") return fail(409, "NOT_AVAILABLE", `This copy is marked ${LIBRARY_COPY_STATUS_LABEL[copy.status].toLowerCase()}. Put it back in use from the catalogue before issuing it.`, { field: "copyId" });
    const person = personOf(b.borrowerType, b.borrowerId);
    if (!person) return bad("borrowerId", "Choose who is borrowing the book.");
    if (person.campus !== campus) return fail(409, "OTHER_CAMPUS", `${person.name} belongs to ${campusName(person.campus)}. Books are issued at the borrower's own campus.`, { field: "borrowerId" });
    const member = memberView(lib, ctx, b.borrowerType, b.borrowerId)!;
    if (member.blockReason) return fail(409, "CANNOT_BORROW", member.blockReason, { field: "borrowerId" });
    if (member.totals.overdue > 0 && !b.allowOverdue) return fail(409, "HAS_OVERDUE", `${person.name} has ${member.totals.overdue} overdue ${member.totals.overdue === 1 ? "book" : "books"}.`, { details: { overdue: member.totals.overdue } });
    if (!b.dueOn || b.dueOn < TODAY || b.dueOn > addDays(TODAY, 60)) return bad("dueOn", "The due date must be from today up to 60 days ahead.");
    const rec: LibLoanRec = { id: uid(`${campus}-ln`), campus, copyId: copy.id, borrowerType: b.borrowerType, borrowerId: b.borrowerId, issuedOn: TODAY, dueOn: b.dueOn, returnedOn: null, fine: 0, fineStatus: "NONE", fineNote: "", issuedBy: user.name, returnedBy: null, reminders: 0, lastReminderAt: null, lost: false };
    libStore.set((s) => ({ ...s, loans: [...s.loans, rec], copies: s.copies.map((c) => (c.id === copy.id ? { ...c, status: "ON_LOAN" } : c)) }));
    libActivity(campus, "ISSUE", `${title.title || title.titleUr} issued to ${person.name}${person.type === "STUDENT" ? ` (${person.detail})` : ""}`, user.name);
    return HttpResponse.json(remember(key, loanView(libStore.get(), rec)), { status: 201 });
  }),

  http.post("/api/library/loans/:id/return", async ({ request, params }) => {
    await latency();
    const lib = libStore.get();
    const loan = lib.loans.find((l) => l.id === params.id);
    if (!loan) return fail(404, "NOT_FOUND", "This loan is no longer on record.");
    const user = writeGuard("library.manage", ctxOf(loan.campus, request));
    if (user instanceof Response) return user;
    if (loan.returnedOn) return fail(409, "ALREADY_RETURNED", `This book was already returned on ${formatDate(loan.returnedOn)}.`);
    const b = (await request.json()) as { fineAction: "FEES" | "CASH" | "WAIVE"; note: string; condition: LibCopyRec["condition"] };
    const view = loanView(lib, loan);
    let fineStatus: LibLoanRec["fineStatus"] = "NONE";
    let fineNote = "";
    if (view.fine > 0) {
      if (b.fineAction === "WAIVE") {
        if ((b.note ?? "").trim().length < 5) return bad("note", "Say why the fine is waived (at least a few words).");
        fineStatus = "WAIVED";
        fineNote = b.note.trim();
      } else if (b.fineAction === "FEES") {
        if (loan.borrowerType !== "STUDENT") return bad("fineAction", "Only a student's fine can go to a fee account. Take it at the desk or waive it.");
        addFeeCharge(loan.borrowerId, `lib-${loan.id}`, `Library fine: ${view.title || view.titleUr} (${view.daysLate} days late)`, view.fine, TODAY);
        fineStatus = "ADDED_TO_FEES";
      } else {
        fineStatus = "PAID";
        fineNote = (b.note ?? "").trim();
      }
    }
    const damaged = b.condition === "DAMAGED";
    libStore.set((s) => ({
      ...s,
      loans: s.loans.map((l) => (l.id === loan.id ? { ...l, returnedOn: TODAY, returnedBy: user.name, fine: view.fine, fineStatus, fineNote } : l)),
      copies: s.copies.map((c) => (c.id === loan.copyId ? { ...c, status: damaged ? "DAMAGED" : "AVAILABLE", condition: b.condition ?? c.condition, note: damaged ? `Returned damaged on ${formatDate(TODAY)}` : c.note } : c)),
    }));
    libActivity(loan.campus, "RETURN", `${view.title || view.titleUr} returned by ${view.borrowerName}${view.fine > 0 ? ` (${view.daysLate} days late, fine ${formatRs(view.fine)}: ${fineStatus === "WAIVED" ? "waived" : fineStatus === "ADDED_TO_FEES" ? "added to fee account" : "paid"})` : ""}`, user.name);
    return HttpResponse.json(loanView(libStore.get(), libStore.get().loans.find((l) => l.id === loan.id)!));
  }),

  http.post("/api/library/loans/:id/renew", async ({ request, params }) => {
    await latency();
    const lib = libStore.get();
    const loan = lib.loans.find((l) => l.id === params.id);
    if (!loan) return fail(404, "NOT_FOUND", "This loan is no longer on record.");
    const user = writeGuard("library.manage", ctxOf(loan.campus, request));
    if (user instanceof Response) return user;
    if (loan.returnedOn) return fail(409, "ALREADY_RETURNED", "This book has been returned.");
    if (loan.dueOn < TODAY) return fail(409, "OVERDUE", "This book is overdue. Take it back (the fine is worked out) and issue it again.");
    const { dueOn } = (await request.json()) as { dueOn: IsoDate };
    if (!dueOn || dueOn <= loan.dueOn || dueOn > addDays(TODAY, 60)) return bad("dueOn", "Choose a new due date after the current one, up to 60 days ahead.");
    libStore.set((s) => ({ ...s, loans: s.loans.map((l) => (l.id === loan.id ? { ...l, dueOn } : l)) }));
    return HttpResponse.json(loanView(libStore.get(), libStore.get().loans.find((l) => l.id === loan.id)!));
  }),

  http.post("/api/library/reminders", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = writeGuard("library.manage", ctx);
    if (user instanceof Response) return user;
    if (!can(user, "sms.send", ctx.campus) && !can(user, "library.manage", ctx.campus)) return fail(403, "FORBIDDEN", "Your role can't send SMS.");
    if (smsStatusStore.get().paused) return fail(409, "SMS_PAUSED", "All SMS are paused by the admin. Nothing was sent; send again once SMS are resumed.");
    const { key, hit } = idem(request);
    if (hit) return HttpResponse.json(hit);
    const b = (await request.json()) as { loanIds: string[]; language: "en" | "ur" };
    const lib = libStore.get();
    const skipped: Array<{ name: string; reason: string }> = [];
    const sent: string[] = [];
    for (const id of b.loanIds ?? []) {
      const l = lib.loans.find((x) => x.id === id && x.campus === ctx.campus);
      if (!l) continue;
      const v = loanView(lib, l);
      if (l.returnedOn) skipped.push({ name: v.borrowerName, reason: "Already returned" });
      else if (l.dueOn >= TODAY) skipped.push({ name: v.borrowerName, reason: "Not overdue yet" });
      else if (!v.mobile) skipped.push({ name: v.borrowerName, reason: "No mobile number" });
      else sent.push(id);
    }
    const now = demoNow();
    libStore.set((s) => ({ ...s, loans: s.loans.map((l) => (sent.includes(l.id) ? { ...l, reminders: l.reminders + 1, lastReminderAt: now } : l)) }));
    if (sent.length) libActivity(ctx.campus as CampusCode, "REMINDER", `Overdue reminder sent for ${sent.length} ${sent.length === 1 ? "book" : "books"}`, user.name);
    return HttpResponse.json(remember(key, { queued: sent.length, skipped }));
  }),

  http.get("/api/library/members/:type/:id", async ({ request, params }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = guard("library.view", ctx.campus);
    if (user instanceof Response) return user;
    const m = memberView(libStore.get(), ctx, params.type as OperationsPersonType, String(params.id));
    if (!m) return fail(404, "NOT_FOUND", "No student or staff member with this number.");
    return HttpResponse.json(m);
  }),

  http.get("/api/library/counts", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = guard("library.view", ctx.campus);
    if (user instanceof Response) return user;
    const lib = libStore.get();
    return HttpResponse.json(
      lib.counts
        .filter((c) => inScope(ctx, c.campus) && inSession(c.startedOn, ctx.session))
        .map((c) => countSummary(countDetail(lib, c.id)!))
        .sort((a, b) => b.startedOn.localeCompare(a.startedOn)),
    );
  }),

  http.get("/api/library/counts/:id", async ({ params }) => {
    await latency();
    const lib = libStore.get();
    const d = countDetail(lib, String(params.id));
    if (!d) return fail(404, "NOT_FOUND", "This stock count is no longer on record.");
    const user = guard("library.view", d.campus);
    if (user instanceof Response) return user;
    return HttpResponse.json(d);
  }),

  http.post("/api/library/counts", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = writeGuard("library.manage", ctx);
    if (user instanceof Response) return user;
    const campus = ctx.campus as CampusCode;
    const b = (await request.json()) as { name: string; cabinetIds: string[] };
    const lib = libStore.get();
    if ((b.name ?? "").trim().length < 3) return bad("name", "Give the count a name, for example \"Urdu cabinet, November\".");
    const ids = (b.cabinetIds ?? []).filter((id) => lib.cabinets.some((c) => c.id === id && c.campus === campus));
    if (ids.length === 0) return bad("cabinetIds", "Choose at least one cabinet to count.");
    const clash = lib.counts.find((c) => c.campus === campus && c.status === "OPEN" && c.cabinetIds.some((x) => ids.includes(x)));
    if (clash) return fail(409, "COUNT_OPEN", `"${clash.name}" is still open for the same cabinet. Close it first.`, { field: "cabinetIds", details: { countId: clash.id } });
    const id = uid(`${campus}-lcount`);
    libStore.set((s) => ({ ...s, counts: [...s.counts, { id, campus, name: b.name.trim(), cabinetIds: ids, status: "OPEN", startedOn: TODAY, startedBy: user.name, closedOn: null, closedBy: null, scans: [], closedRows: null, applied: [] }] }));
    libActivity(campus, "COUNT", `Stock count started: ${b.name.trim()}`, user.name);
    return HttpResponse.json(countDetail(libStore.get(), id), { status: 201 });
  }),

  http.post("/api/library/counts/:id/scans", async ({ request, params }) => {
    await latency();
    const lib = libStore.get();
    const count = lib.counts.find((c) => c.id === params.id);
    if (!count) return fail(404, "NOT_FOUND", "This stock count is no longer on record.");
    const user = writeGuard("library.manage", ctxOf(count.campus, request));
    if (user instanceof Response) return user;
    if (count.status !== "OPEN") return fail(409, "CLOSED", "This count is closed. Start a new count to scan again.");
    const b = (await request.json()) as { accessionNos: string[]; shelfId: string };
    const shelfOk = lib.cabinets.some((c) => count.cabinetIds.includes(c.id) && c.shelves.some((s) => s.id === b.shelfId));
    if (!shelfOk) return bad("shelfId", "Choose the shelf you are scanning.");
    const nos = (b.accessionNos ?? []).map((n) => n.trim()).filter(Boolean);
    if (nos.length === 0) return bad("accessionNos", "Scan or type at least one accession number.");
    const now = demoNow();
    const resolved = nos.map((raw) => findCopyByAccession(lib, count.campus, raw)?.accessionNo ?? raw.toUpperCase());
    libStore.set((s) => ({
      ...s,
      counts: s.counts.map((c) => (c.id === count.id ? { ...c, scans: [...c.scans.filter((x) => !resolved.includes(x.accessionNo)), ...resolved.map((accessionNo) => ({ accessionNo, shelfId: b.shelfId, at: now }))] } : c)),
    }));
    return HttpResponse.json(countDetail(libStore.get(), count.id));
  }),

  http.delete("/api/library/counts/:id/scans/:no", async ({ request, params }) => {
    await latency();
    const lib = libStore.get();
    const count = lib.counts.find((c) => c.id === params.id);
    if (!count) return fail(404, "NOT_FOUND", "This stock count is no longer on record.");
    const user = writeGuard("library.manage", ctxOf(count.campus, request));
    if (user instanceof Response) return user;
    if (count.status !== "OPEN") return fail(409, "CLOSED", "This count is closed.");
    libStore.set((s) => ({ ...s, counts: s.counts.map((c) => (c.id === count.id ? { ...c, scans: c.scans.filter((x) => x.accessionNo !== params.no) } : c)) }));
    return HttpResponse.json(countDetail(libStore.get(), count.id));
  }),

  http.post("/api/library/counts/:id/close", async ({ request, params }) => {
    await latency();
    const lib = libStore.get();
    const count = lib.counts.find((c) => c.id === params.id);
    if (!count) return fail(404, "NOT_FOUND", "This stock count is no longer on record.");
    const user = writeGuard("library.manage", ctxOf(count.campus, request));
    if (user instanceof Response) return user;
    if (count.status !== "OPEN") return fail(409, "CLOSED", "This count is already closed.");
    if (count.scans.length === 0) return fail(409, "EMPTY", "Nothing has been scanned yet. Scan the shelves first, or delete nothing and come back later.");
    const { rows } = countRows(lib, count.id);
    const scanShelf = new Map(count.scans.map((s) => [s.accessionNo, s.shelfId]));
    const tally = { missing: 0, moved: 0, returned: 0, restored: 0, unknown: 0, found: 0 };
    libStore.set((s) => {
      let copies = s.copies;
      let loans = s.loans;
      for (const r of rows) {
        if (r.result === "FOUND") tally.found++;
        if (r.result === "UNKNOWN") tally.unknown++;
        if (!r.copyId) continue;
        const shelf = scanShelf.get(r.accessionNo) ?? null;
        if (r.result === "MISSING") {
          tally.missing++;
          copies = copies.map((c) => (c.id === r.copyId ? { ...c, status: "MISSING", note: `Not found in the stock count "${count.name}" on ${formatDate(TODAY)}.` } : c));
        } else if (r.result === "WRONG_SHELF") {
          tally.moved++;
          copies = copies.map((c) => (c.id === r.copyId ? { ...c, shelfId: shelf, placedOn: TODAY } : c));
        } else if (r.result === "ON_LOAN_FOUND") {
          tally.returned++;
          loans = loans.map((l) => (l.copyId === r.copyId && !l.returnedOn ? { ...l, returnedOn: TODAY, returnedBy: user.name, fine: 0, fineStatus: "NONE", fineNote: "Found on the shelf during the stock count; closed without a fine." } : l));
          copies = copies.map((c) => (c.id === r.copyId ? { ...c, status: "AVAILABLE", shelfId: shelf, placedOn: c.shelfId === shelf ? (c.placedOn ?? null) : TODAY } : c));
        } else if (r.result === "WRITTEN_OFF_FOUND") {
          tally.restored++;
          copies = copies.map((c) => (c.id === r.copyId ? { ...c, status: "AVAILABLE", shelfId: shelf, placedOn: TODAY, writtenOff: null, note: `Found in the stock count on ${formatDate(TODAY)}.` } : c));
        }
      }
      const applied = [
        `${tally.found} ${tally.found === 1 ? "copy" : "copies"} confirmed on their shelves.`,
        tally.missing ? `${tally.missing} not found, marked as missing.` : "",
        tally.moved ? `${tally.moved} moved to the shelf where they were found.` : "",
        tally.returned ? `${tally.returned} shown on loan but on the shelf: loans closed without a fine.` : "",
        tally.restored ? `${tally.restored} written off before but found: back in use.` : "",
        tally.unknown ? `${tally.unknown} accession numbers not in the catalogue: check and add them.` : "",
      ].filter(Boolean);
      return { ...s, copies, loans, counts: s.counts.map((c) => (c.id === count.id ? { ...c, status: "CLOSED", closedOn: TODAY, closedBy: user.name, closedRows: rows, applied } : c)) };
    });
    libActivity(count.campus, "COUNT", `Stock count closed: ${count.name} (${tally.missing} missing, ${tally.moved} moved)`, user.name);
    return HttpResponse.json(countDetail(libStore.get(), count.id));
  }),

  http.get("/api/library/setup", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = guard("library.view", ctx.campus);
    if (user instanceof Response) return user;
    return HttpResponse.json(setupView(ctx));
  }),

  // Every copy with its cabinet and shelf, for the copy-level cabinet list (legacy "Book info cabinet wise").
  http.get("/api/library/copies", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = guard("library.view", ctx.campus);
    if (user instanceof Response) return user;
    const cabinetId = url.searchParams.get("cabinetId") ?? "";
    const categoryId = url.searchParams.get("categoryId") ?? "";
    const libraryId = url.searchParams.get("libraryId") ?? "";
    return HttpResponse.json(copyRows(libStore.get(), scopeOf(ctx), { cabinetId, categoryId, libraryId }));
  }),

  http.post("/api/library/libraries", async ({ request }) => saveLibrary(request, null)),
  http.put("/api/library/libraries/:id", async ({ request, params }) => saveLibrary(request, String(params.id))),

  http.post("/api/library/cabinets", async ({ request }) => saveCabinet(request, null)),
  http.put("/api/library/cabinets/:id", async ({ request, params }) => saveCabinet(request, String(params.id))),

  http.post("/api/library/categories", async ({ request }) => saveLibCategory(request, null)),
  http.put("/api/library/categories/:id", async ({ request, params }) => saveLibCategory(request, String(params.id))),

  http.put("/api/library/policies", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = writeGuard("library.manage", ctx);
    if (user instanceof Response) return user;
    const b = (await request.json()) as { borrowerType: OperationsPersonType; loanDays: number; graceDays: number; ratePerDay: number; maxLoans: number; capAtCost: boolean };
    if (!int(b.loanDays) || b.loanDays < 1 || b.loanDays > 60) return bad("loanDays", "Loan period is 1 to 60 days.");
    if (!int(b.graceDays) || b.graceDays < 0 || b.graceDays > 14) return bad("graceDays", "Days without a fine are 0 to 14.");
    if (!int(b.ratePerDay) || b.ratePerDay < 0 || b.ratePerDay > 100) return bad("ratePerDay", "The fine is 0 to Rs 100 a day, in whole rupees.");
    if (!int(b.maxLoans) || b.maxLoans < 1 || b.maxLoans > 10) return bad("maxLoans", "A borrower may have 1 to 10 books at a time.");
    const now = demoNow();
    libStore.set((s) => ({ ...s, policies: s.policies.map((p) => (p.campus === ctx.campus && p.borrowerType === b.borrowerType ? { ...p, ...b, updatedAt: now, updatedBy: user.name } : p)) }));
    return HttpResponse.json(policyOf(libStore.get(), ctx.campus as CampusCode, b.borrowerType));
  }),
];

/** Copy rows for the cabinet-wise list, in cabinet and accession order. */
function copyRows(lib: Lib, campuses: CampusCode[], f: { cabinetId?: string; categoryId?: string; libraryId?: string } = {}): LibraryCopyRow[] {
  const shelves = shelfMap(lib);
  const cabs = new Map(lib.cabinets.map((c) => [c.id, c]));
  const libName = new Map(lib.libraries.map((l) => [l.id, l.name]));
  const titles = new Map(lib.titles.map((t) => [t.id, t]));
  const cats = new Map(lib.categories.map((c) => [c.id, c.name]));
  return lib.copies
    .filter((c) => campuses.includes(c.campus))
    .map((c): LibraryCopyRow => {
      const t = titles.get(c.titleId)!;
      const sh = c.shelfId ? shelves.get(c.shelfId) : undefined;
      const cab = sh ? cabs.get(sh.cabinetId) : undefined;
      return {
        copyId: c.id,
        titleId: c.titleId,
        accessionNo: c.accessionNo,
        title: t?.title ?? "",
        titleUr: t?.titleUr ?? "",
        category: cats.get(t?.categoryId ?? "") ?? "",
        libraryName: cab ? (libName.get(cab.libraryId) ?? "") : "",
        cabinetId: cab?.id ?? null,
        cabinetCode: cab?.code ?? "",
        cabinetTitle: cab?.title ?? "",
        shelfLabel: sh?.label ?? "",
        placedOn: c.placedOn ?? null,
        status: c.status,
        condition: c.condition,
        cost: c.cost,
        writtenOffOn: c.writtenOff?.on ?? null,
        approvedBy: c.writtenOff?.approvedBy ?? "",
      };
    })
    .filter((r) => !f.cabinetId || r.cabinetId === f.cabinetId)
    .filter((r) => !f.categoryId || titles.get(r.titleId)?.categoryId === f.categoryId)
    .filter((r) => !f.libraryId || (r.cabinetId !== null && cabs.get(r.cabinetId)?.libraryId === f.libraryId))
    .sort((a, b) => (a.cabinetCode || "~").localeCompare(b.cabinetCode || "~") || a.accessionNo.localeCompare(b.accessionNo));
}

async function saveLibrary(request: Request, id: string | null) {
  await latency();
  const ctx = ctxFrom(new URL(request.url));
  const lib = libStore.get();
  const existing = id ? lib.libraries.find((l) => l.id === id) : undefined;
  if (id && !existing) return fail(404, "NOT_FOUND", "This library is no longer on record.");
  const user = writeGuard("library.manage", existing ? ctxOf(existing.campus, request) : ctx);
  if (user instanceof Response) return user;
  const campus = existing?.campus ?? (ctx.campus as CampusCode);
  const b = (await request.json()) as { name: string; seatingCapacity: number; active: boolean; rowVer?: number };
  if (existing) {
    const conflict = stale(existing, b.rowVer, "library");
    if (conflict) return conflict;
  }
  const name = (b.name ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 3) return bad("name", 'Enter the library\'s name, for example "Junior library".');
  if (lib.libraries.some((l) => l.campus === campus && l.id !== id && norm(l.name) === norm(name))) return fail(409, "DUPLICATE", `${name} already exists at this campus.`, { field: "name" });
  if (!int(b.seatingCapacity) || b.seatingCapacity < 0 || b.seatingCapacity > 500) return bad("seatingCapacity", "Seats are a whole number from 0 to 500.");
  if (existing && b.active === false && existing.active) {
    const inUse = lib.cabinets.filter((c) => c.libraryId === existing.id && c.active).length;
    if (inUse) return fail(409, "IN_USE", `${inUse} ${inUse === 1 ? "cabinet is" : "cabinets are"} still in use in ${existing.name}. Move them to another library or take them out of use first.`, { field: "active" });
  }
  const rec = { id: existing?.id ?? uid(`${campus}-lib`), campus, name, seatingCapacity: b.seatingCapacity, active: b.active !== false, rowVer: existing ? (existing.rowVer ?? 1) + 1 : 1 };
  libStore.set((s) => ({ ...s, libraries: existing ? s.libraries.map((l) => (l.id === rec.id ? rec : l)) : [...s.libraries, rec] }));
  libActivity(campus, "ADDED", `${existing ? "Library updated" : "Library added"}: ${name}`, user.name);
  return HttpResponse.json(setupView(ctxOf(campus, request)).libraries.find((l) => l.id === rec.id), { status: existing ? 200 : 201 });
}

async function saveCabinet(request: Request, id: string | null) {
  await latency();
  const ctx = ctxFrom(new URL(request.url));
  const user = writeGuard("library.manage", ctx);
  if (user instanceof Response) return user;
  const campus = ctx.campus as CampusCode;
  const b = (await request.json()) as { libraryId: string; code: string; title: string; capacity: number; shelves: string[]; active: boolean; rowVer?: number };
  const lib = libStore.get();
  const library = lib.libraries.find((l) => l.id === b.libraryId);
  if (!library) return bad("libraryId", "Choose the library the cabinet stands in.");
  if (library.campus !== campus) return bad("libraryId", `${library.name} is at ${campusName(library.campus)}. Choose a library at this campus.`);
  if (!library.active && lib.cabinets.find((c) => c.id === id)?.libraryId !== library.id) return bad("libraryId", `${library.name} is not in use. Choose another library.`);
  const code = (b.code ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9-]{2,8}$/.test(code)) return bad("code", "Use a short code such as C-08.");
  if (lib.cabinets.some((c) => c.campus === campus && c.code === code && c.id !== id)) return fail(409, "DUPLICATE", `Cabinet ${code} already exists.`, { field: "code" });
  if ((b.title ?? "").trim().length < 2) return bad("title", "Say what the cabinet holds, for example \"Urdu poetry\".");
  if (!int(b.capacity) || b.capacity < 1) return bad("capacity", "Enter how many books it holds.");
  const labels = (b.shelves ?? []).map((s) => s.trim()).filter(Boolean);
  if (labels.length === 0) return bad("shelves", "Add at least one shelf.");
  const existing = id ? lib.cabinets.find((c) => c.id === id) : undefined;
  if (id && !existing) return fail(404, "NOT_FOUND", "This cabinet is no longer on record.");
  if (existing) {
    const conflict = stale(existing, b.rowVer, "cabinet");
    if (conflict) return conflict;
  }
  const cabId = existing?.id ?? uid(`${campus}-cab`);
  const shelves = labels.map((label, i) => ({ id: existing?.shelves[i]?.id ?? `${cabId}-s${uid("x")}`, label }));
  const removed = (existing?.shelves ?? []).slice(labels.length);
  for (const r of removed) {
    const n = lib.copies.filter((c) => c.shelfId === r.id).length;
    if (n) return fail(409, "SHELF_IN_USE", `${r.label} still holds ${n} ${n === 1 ? "copy" : "copies"}. Move them to another shelf first.`, { field: "shelves" });
  }
  const rec = { id: cabId, campus, libraryId: library.id, code, title: b.title.trim(), capacity: b.capacity, shelves, active: b.active !== false, rowVer: existing ? (existing.rowVer ?? 1) + 1 : 1 };
  libStore.set((s) => ({ ...s, cabinets: existing ? s.cabinets.map((c) => (c.id === cabId ? rec : c)) : [...s.cabinets, rec] }));
  return HttpResponse.json(setupView(ctx).cabinets.find((c) => c.id === cabId), { status: existing ? 200 : 201 });
}

async function saveLibCategory(request: Request, id: string | null) {
  await latency();
  const user = guard("library.manage", ctxFrom(new URL(request.url)).campus);
  if (user instanceof Response) return user;
  const closed = closedSession(request);
  if (closed) return closed;
  const b = (await request.json()) as { name: string; nameUr: string; active: boolean };
  const name = (b.name ?? "").trim();
  if (name.length < 2) return bad("name", "Enter the subject name.");
  const lib = libStore.get();
  if (lib.categories.some((c) => norm(c.name) === norm(name) && c.id !== id)) return fail(409, "DUPLICATE", `"${name}" is already a subject.`, { field: "name" });
  const rec = { id: id ?? uid("lc"), name, nameUr: (b.nameUr ?? "").trim(), active: b.active !== false };
  libStore.set((s) => ({ ...s, categories: id ? s.categories.map((c) => (c.id === id ? rec : c)) : [...s.categories, rec] }));
  return HttpResponse.json({ ...rec, titles: lib.titles.filter((t) => t.categoryId === rec.id).length }, { status: id ? 200 : 201 });
}

/* ================================================================================================ Warehouse: views */

type Wh = ReturnType<typeof whStore.get>;

interface Bal {
  onHand: number;
  avg: number;
  last: IsoDate | null;
  inRooms: number;
}

function balances(wh: Wh): Map<string, Bal> {
  const m = new Map<string, Bal>();
  const consumable = new Map(wh.items.map((i) => [i.id, i.consumable]));
  for (const mv of wh.moves) {
    const b = m.get(mv.itemId) ?? { onHand: 0, avg: mv.unitCost, last: null, inRooms: 0 };
    if (mv.qtyIn > 0 && !["RETURN", "SALE_CANCEL"].includes(mv.type)) b.avg = Math.round((b.onHand * b.avg + mv.qtyIn * mv.unitCost) / Math.max(1, b.onHand + mv.qtyIn));
    b.onHand += mv.qtyIn - mv.qtyOut;
    b.last = mv.date;
    if (consumable.get(mv.itemId) === false) {
      if (mv.type === "ISSUE") b.inRooms += mv.qtyOut;
      if (mv.type === "RETURN") b.inRooms -= mv.qtyIn;
    }
    m.set(mv.itemId, b);
  }
  return m;
}

function itemView(wh: Wh, it: WhItemRec, bals = balances(wh)): WarehouseItem {
  const b = bals.get(it.id) ?? { onHand: 0, avg: 0, last: null, inRooms: 0 };
  const cat = wh.categories.find((c) => c.id === it.categoryId);
  return {
    id: it.id,
    campus: it.campus,
    code: it.code,
    group: it.group,
    name: it.name,
    categoryId: it.categoryId,
    category: cat?.name ?? "",
    unit: it.unit,
    consumable: it.consumable,
    reorderLevel: it.reorderLevel,
    onHand: b.onHand,
    inRooms: Math.max(0, b.inRooms),
    avgCost: b.avg,
    value: b.onHand * b.avg,
    forSale: Boolean(cat?.forSale),
    salePrice: it.salePrice,
    status: b.onHand <= 0 ? "OUT" : b.onHand <= it.reorderLevel ? "LOW" : "OK",
    active: it.active,
    lastMovementOn: b.last,
  };
}

function moveViews(wh: Wh, itemId: string): WarehouseMovement[] {
  let bal = 0;
  return wh.moves
    .filter((m) => m.itemId === itemId)
    .map((m) => {
      bal += m.qtyIn - m.qtyOut;
      return { id: m.id, itemId: m.itemId, date: m.date, at: m.at, type: m.type, docNo: m.docNo, qtyIn: m.qtyIn, qtyOut: m.qtyOut, balance: bal, party: m.party, unitCost: m.unitCost, note: m.note, by: m.by };
    })
    .reverse();
}

function grnView(wh: Wh, g: Wh["grns"][number]): WarehouseGrn {
  const sup = wh.suppliers.find((s) => s.id === g.supplierId);
  const lines = g.lines.map((l) => {
    const it = wh.items.find((i) => i.id === l.itemId)!;
    return { itemId: l.itemId, itemName: it.name, unit: it.unit, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct, total: Math.round(l.qty * l.unitPrice * (1 - l.discountPct / 100)) };
  });
  const subtotal = lines.reduce((a, l) => a + l.qty * l.unitPrice, 0);
  const net = lines.reduce((a, l) => a + l.total, 0);
  const tax = g.tax ?? 0;
  return { ...g, tax, supplierName: sup?.name ?? "", lines, subtotal, discount: subtotal - net, total: net + g.freight + tax };
}

function requestView(wh: Wh, r: Wh["requests"][number]): WarehouseRequest {
  const dep = wh.departments.find((d) => d.id === r.departmentId);
  const linked = wh.issues.filter((i) => i.requestId === r.id);
  const lines = r.lines.map((l) => {
    const it = wh.items.find((i) => i.id === l.itemId)!;
    const issued = linked.reduce((a, i) => a + i.lines.filter((x) => x.itemId === l.itemId).reduce((s, x) => s + x.qty, 0), 0);
    return { itemId: l.itemId, itemName: it.name, unit: it.unit, qty: l.qty, issued };
  });
  const status: WarehouseRequestStatus = r.cancelled ? "CANCELLED" : lines.every((l) => l.issued >= l.qty) ? "FULFILLED" : lines.some((l) => l.issued > 0) ? "PARTIAL" : "OPEN";
  return { id: r.id, no: r.no, campus: r.campus, departmentId: r.departmentId, department: dep?.name ?? "", room: r.room, requestedBy: r.requestedBy, requestedOn: r.requestedOn, lines, status, note: r.note, cancelReason: r.cancelReason };
}

function issueView(wh: Wh, i: Wh["issues"][number]): WarehouseIssue {
  const dep = wh.departments.find((d) => d.id === i.departmentId);
  const req = i.requestId ? wh.requests.find((r) => r.id === i.requestId) : undefined;
  const rets = wh.returns.filter((r) => r.issueId === i.id);
  const lines = i.lines.map((l) => {
    const it = wh.items.find((x) => x.id === l.itemId)!;
    const returned = rets.reduce((a, r) => a + r.lines.filter((x) => x.issueLineId === l.id).reduce((s, x) => s + x.qty, 0), 0);
    return { id: l.id, itemId: l.itemId, itemName: it.name, unit: it.unit, consumable: it.consumable, qty: l.qty, returned, unitCost: l.unitCost, remarks: l.remarks };
  });
  return {
    id: i.id,
    no: i.no,
    campus: i.campus,
    date: i.date,
    departmentId: i.departmentId,
    department: dep?.name ?? "",
    room: i.room,
    receivedBy: i.receivedBy,
    requestId: i.requestId,
    requestNo: req?.no ?? null,
    lines,
    value: lines.reduce((a, l) => a + (l.qty - l.returned) * l.unitCost, 0),
    issuedBy: i.issuedBy,
    postedAt: i.postedAt,
    returns: rets.map((r) => ({ no: r.no, date: r.date, qty: r.lines.reduce((a, x) => a + x.qty, 0) })),
  };
}

function returnView(wh: Wh, r: Wh["returns"][number]): WarehouseReturn {
  const iss = wh.issues.find((i) => i.id === r.issueId)!;
  const dep = wh.departments.find((d) => d.id === iss.departmentId);
  return {
    id: r.id,
    no: r.no,
    campus: r.campus,
    date: r.date,
    issueId: r.issueId,
    issueNo: iss.no,
    department: dep?.name ?? "",
    room: iss.room,
    lines: r.lines.map((l) => {
      const line = iss.lines.find((x) => x.id === l.issueLineId)!;
      const it = wh.items.find((x) => x.id === line.itemId)!;
      return { issueLineId: l.issueLineId, itemId: it.id, itemName: it.name, unit: it.unit, qty: l.qty };
    }),
    reason: r.reason,
    receivedBy: r.receivedBy,
    postedAt: r.postedAt,
  };
}

function countView(wh: Wh, c: Wh["counts"][number]): WarehouseCount {
  const cat = c.categoryId ? wh.categories.find((x) => x.id === c.categoryId) : undefined;
  const lines = c.lines.map((l) => {
    const it = wh.items.find((x) => x.id === l.itemId)!;
    const difference = l.countedQty === null ? 0 : l.countedQty - l.systemQty;
    return { itemId: it.id, code: it.code, itemName: it.name, unit: it.unit, systemQty: l.systemQty, countedQty: l.countedQty, difference, unitCost: l.unitCost, value: difference * l.unitCost, reason: l.reason };
  });
  return {
    id: c.id,
    no: c.no,
    campus: c.campus,
    name: c.name,
    categoryId: c.categoryId,
    category: cat?.name ?? "All items",
    status: c.status,
    startedOn: c.startedOn,
    startedBy: c.startedBy,
    submittedBy: c.submittedBy,
    submittedAt: c.submittedAt,
    decidedBy: c.decidedBy,
    decidedAt: c.decidedAt,
    decisionNote: c.decisionNote,
    lines,
    counted: lines.filter((l) => l.countedQty !== null).length,
    differences: lines.filter((l) => l.difference !== 0).length,
    gainValue: lines.filter((l) => l.value > 0).reduce((a, l) => a + l.value, 0),
    lossValue: lines.filter((l) => l.value < 0).reduce((a, l) => a - l.value, 0),
  };
}

function saleView(wh: Wh, s: WhSaleRec): WarehouseSale {
  const st = findStudent(s.grNo);
  const camp = campusOf(s.campus);
  const lines = s.lines.map((l) => ({ itemId: l.itemId, itemName: wh.items.find((i) => i.id === l.itemId)?.name ?? "", qty: l.qty, price: l.price, total: l.qty * l.price }));
  const total = lines.reduce((a, l) => a + l.total, 0);
  return {
    id: s.id,
    receiptNo: s.receiptNo,
    campus: s.campus,
    campusName: camp.name,
    campusAddress: camp.address,
    at: s.at,
    grNo: s.grNo,
    studentName: st?.name ?? s.grNo,
    classSection: st?.classSection ?? "",
    father: st?.father ?? "",
    relation: st?.relation ?? "",
    lines,
    total,
    amountInWords: amountInWords(total),
    payment: s.payment,
    received: s.received,
    change: s.payment === "CASH" && s.received !== null ? s.received - total : null,
    soldBy: s.soldBy,
    status: s.status,
    cancelReason: s.cancelReason,
  };
}

function bookSetView(wh: Wh, b: Wh["bookSets"][number]): WarehouseBookSet {
  const lines = b.lines.map((l) => {
    const it = wh.items.find((i) => i.id === l.itemId)!;
    return { itemId: it.id, itemName: it.name, qty: l.qty, price: it.salePrice ?? 0 };
  });
  return { id: b.id, campus: b.campus, classShort: b.classShort, name: `Class ${b.classShort} book set`, lines, total: lines.reduce((a, l) => a + l.qty * l.price, 0) };
}

function supplierView(wh: Wh, s: Wh["suppliers"][number], session: number): WarehouseSupplier {
  const gs = wh.grns.filter((g) => g.supplierId === s.id && g.status === "POSTED" && inSession(g.date, session)).map((g) => grnView(wh, g));
  return { ...s, mobile: s.mobile ?? "", email: s.email ?? "", rowVer: s.rowVer ?? 1, grns: gs.length, purchased: gs.reduce((a, g) => a + g.total, 0), lastGrnOn: gs.map((g) => g.date).sort().pop() ?? null };
}

function deptView(wh: Wh, d: Wh["departments"][number], session: number): WarehouseDepartment {
  const value = wh.issues.filter((i) => i.departmentId === d.id && inSession(i.date, session)).reduce((a, i) => a + issueView(wh, i).value, 0);
  return { ...d, rowVer: d.rowVer ?? 1, issuedThisSession: value };
}

/** Stock held in each room: issues add what went out, returns take back what came in. Used-up and kept items. */
function roomStock(wh: Wh, campuses: CampusCode[], f: { departmentId?: string; room?: string; categoryId?: string } = {}): WarehouseRoomStock[] {
  const issueDept = new Map(wh.issues.map((i) => [i.id, i.departmentId]));
  const returnDept = new Map(wh.returns.map((r) => [r.id, issueDept.get(r.issueId) ?? ""]));
  const held = new Map<string, { departmentId: string; room: string; itemId: string; qty: number }>();
  for (const m of wh.moves) {
    if (!campuses.includes(m.campus) || !m.room || (m.type !== "ISSUE" && m.type !== "RETURN")) continue;
    const departmentId = m.type === "ISSUE" ? (issueDept.get(m.docId) ?? "") : (returnDept.get(m.docId) ?? "");
    const k = `${departmentId}|${m.room}|${m.itemId}`;
    const row = held.get(k) ?? { departmentId, room: m.room, itemId: m.itemId, qty: 0 };
    row.qty += m.type === "ISSUE" ? m.qtyOut : -m.qtyIn;
    held.set(k, row);
  }
  const deps = new Map(wh.departments.map((d) => [d.id, d.name]));
  const items = new Map(wh.items.map((i) => [i.id, i]));
  const cats = new Map(wh.categories.map((c) => [c.id, c.name]));
  return [...held.values()]
    .filter((r) => r.qty > 0)
    .filter((r) => !f.departmentId || r.departmentId === f.departmentId)
    .filter((r) => !f.room || r.room === f.room)
    .flatMap((r): WarehouseRoomStock[] => {
      const it = items.get(r.itemId);
      if (!it || (f.categoryId && it.categoryId !== f.categoryId)) return [];
      return [{ departmentId: r.departmentId, department: deps.get(r.departmentId) ?? "", room: r.room, itemId: it.id, code: it.code, itemName: it.name, group: it.group, categoryId: it.categoryId, category: cats.get(it.categoryId) ?? "", unit: it.unit, consumable: it.consumable, qty: r.qty }];
    })
    .sort((a, b) => a.group.localeCompare(b.group) || a.itemName.localeCompare(b.itemName) || a.department.localeCompare(b.department) || a.room.localeCompare(b.room));
}

function nextNo(prefix: string, campus: CampusCode, width = 4) {
  let n = 0;
  whStore.set((s) => {
    n = (s.seq[`${campus}-${prefix}`] ?? 0) + 1;
    return { ...s, seq: { ...s.seq, [`${campus}-${prefix}`]: n } };
  });
  return `${campus}-${prefix}-2627-${String(n).padStart(width, "0")}`;
}

function pushMoves(moves: Array<Omit<WhMoveRec, "id">>) {
  whStore.set((s) => ({ ...s, moves: [...s.moves, ...moves.map((m) => ({ ...m, id: uid(`${m.campus}-mv`) }))] }));
}

function whOverview(ctx: Ctx): WarehouseOverview {
  const wh = whStore.get();
  const campuses = scopeOf(ctx);
  const bals = balances(wh);
  const items = wh.items.filter((i) => campuses.includes(i.campus) && i.active).map((i) => itemView(wh, i, bals));
  const moves = wh.moves.filter((m) => campuses.includes(m.campus) && inSession(m.date, ctx.session));
  const since = addDays(TODAY, -30);
  const val = (list: WhMoveRec[], kind: "in" | "out") => list.reduce((a, m) => a + (kind === "in" ? m.qtyIn : m.qtyOut) * m.unitCost, 0);
  const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(ctx.session, 3 + i, 1)).toISOString().slice(0, 7)).filter((m) => `${m}-01` <= TODAY);
  const byMonth = months.map((m) => {
    const inMonth = moves.filter((x) => x.date.startsWith(m));
    return {
      month: m,
      received: val(inMonth.filter((x) => x.type === "RECEIPT"), "in") - val(inMonth.filter((x) => x.type === "REVERSAL"), "out"),
      issued: val(inMonth.filter((x) => x.type === "ISSUE"), "out") - val(inMonth.filter((x) => x.type === "RETURN"), "in"),
    };
  });
  const deptValue = new Map<string, number>();
  for (const i of wh.issues.filter((x) => campuses.includes(x.campus) && inSession(x.date, ctx.session))) {
    const v = issueView(wh, i);
    deptValue.set(v.department, (deptValue.get(v.department) ?? 0) + v.value);
  }
  const shopToday = wh.sales.filter((s) => campuses.includes(s.campus) && s.at.startsWith(TODAY) && s.status === "POSTED").reduce((a, s) => a + saleView(wh, s).total, 0);
  return {
    items: items.length,
    stockValue: items.reduce((a, i) => a + Math.max(0, i.value), 0),
    lowStock: items.filter((i) => i.status === "LOW").length,
    outOfStock: items.filter((i) => i.status === "OUT").length,
    openRequests: wh.requests.filter((r) => campuses.includes(r.campus)).map((r) => requestView(wh, r)).filter((r) => r.status === "OPEN" || r.status === "PARTIAL").length,
    countsAwaitingApproval: wh.counts.filter((c) => campuses.includes(c.campus) && c.status === "SUBMITTED").length,
    receivedLast30: val(moves.filter((m) => m.type === "RECEIPT" && m.date > since), "in"),
    issuedLast30: val(moves.filter((m) => m.type === "ISSUE" && m.date > since), "out"),
    shopToday,
    byMonth,
    byDepartment: [...deptValue.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8),
    byCampus: campuses.map((c) => {
      const here = items.filter((i) => i.campus === c);
      return { campus: c, name: campusName(c), items: here.length, value: here.reduce((a, i) => a + Math.max(0, i.value), 0), low: here.filter((i) => i.status !== "OK" && !i.forSale).length };
    }),
    lowItems: items.filter((i) => i.status !== "OK" && !i.forSale).sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === "OUT" ? -1 : 1)).slice(0, 8),
    recent: wh.moves
      .filter((m) => campuses.includes(m.campus))
      .slice(-8)
      .reverse()
      .map((m) => ({ id: m.id, itemId: m.itemId, date: m.date, at: m.at, type: m.type, docNo: m.docNo, qtyIn: m.qtyIn, qtyOut: m.qtyOut, balance: 0, party: `${wh.items.find((i) => i.id === m.itemId)?.name ?? ""} · ${m.party}`, unitCost: m.unitCost, note: m.note, by: m.by })),
  };
}

/* ================================================================================================ Warehouse: handlers */

const whView = (perm: Permission = "warehouse.view") => (ctx: Ctx) => guard(perm, ctx.campus);

const warehouseHandlers: HttpHandler[] = [
  http.get("/api/warehouse/overview", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = whView()(ctx);
    if (user instanceof Response) return user;
    return HttpResponse.json(whOverview(ctx));
  }),

  http.get("/api/warehouse/items", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = whView()(ctx);
    if (user instanceof Response) return user;
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const cat = url.searchParams.get("categoryId") ?? "";
    const status = url.searchParams.get("status") ?? "";
    const forSale = url.searchParams.get("forSale") === "1";
    const wh = whStore.get();
    const bals = balances(wh);
    const rows = wh.items
      .filter((i) => inScope(ctx, i.campus))
      .map((i) => itemView(wh, i, bals))
      .filter((i) => !q || `${i.code} ${i.name} ${i.group}`.toLowerCase().includes(q))
      .filter((i) => !cat || i.categoryId === cat)
      .filter((i) => !status || i.status === status)
      .filter((i) => !forSale || i.forSale)
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    return HttpResponse.json(rows);
  }),

  http.get("/api/warehouse/items/:id", async ({ params }) => {
    await latency();
    const wh = whStore.get();
    const it = wh.items.find((i) => i.id === params.id);
    if (!it) return fail(404, "NOT_FOUND", "This item is no longer on record.");
    const user = guard("warehouse.view", it.campus);
    if (user instanceof Response) return user;
    const view = itemView(wh, it);
    const rooms = new Map<string, number>();
    if (!it.consumable) {
      for (const m of wh.moves.filter((x) => x.itemId === it.id && x.room)) rooms.set(m.room, (rooms.get(m.room) ?? 0) + (m.type === "ISSUE" ? m.qtyOut : m.type === "RETURN" ? -m.qtyIn : 0));
    }
    const suppliers = [...new Set(wh.grns.filter((g) => g.lines.some((l) => l.itemId === it.id)).map((g) => wh.suppliers.find((s) => s.id === g.supplierId)?.name ?? ""))].filter(Boolean);
    const detail: WarehouseItemDetail = { ...view, movements: moveViews(wh, it.id), rooms: [...rooms.entries()].filter(([, q]) => q > 0).map(([location, qty]) => ({ location, qty })), suppliers };
    return HttpResponse.json(detail);
  }),

  http.post("/api/warehouse/items", async ({ request }) => saveItem(request, null)),
  http.put("/api/warehouse/items/:id", async ({ request, params }) => saveItem(request, String(params.id))),

  http.get("/api/warehouse/setup", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = whView()(ctx);
    if (user instanceof Response) return user;
    const wh = whStore.get();
    return HttpResponse.json({
      categories: wh.categories.map((c) => ({ ...c, items: wh.items.filter((i) => i.categoryId === c.id && inScope(ctx, i.campus)).length })),
      departments: wh.departments.filter((d) => inScope(ctx, d.campus)).map((d) => deptView(wh, d, ctx.session)),
      units: [...WAREHOUSE_UNITS],
    });
  }),

  http.get("/api/warehouse/room-stock", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = whView()(ctx);
    if (user instanceof Response) return user;
    const f = { departmentId: url.searchParams.get("departmentId") ?? "", room: url.searchParams.get("room") ?? "", categoryId: url.searchParams.get("categoryId") ?? "" };
    return HttpResponse.json(roomStock(whStore.get(), scopeOf(ctx), f));
  }),

  http.post("/api/warehouse/categories", async ({ request }) => saveWhCategory(request, null)),
  http.put("/api/warehouse/categories/:id", async ({ request, params }) => saveWhCategory(request, String(params.id))),
  http.post("/api/warehouse/departments", async ({ request }) => saveDepartment(request, null)),
  http.put("/api/warehouse/departments/:id", async ({ request, params }) => saveDepartment(request, String(params.id))),

  http.get("/api/warehouse/suppliers", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = whView()(ctx);
    if (user instanceof Response) return user;
    const wh = whStore.get();
    return HttpResponse.json(wh.suppliers.filter((s) => inScope(ctx, s.campus)).map((s) => supplierView(wh, s, ctx.session)).sort((a, b) => a.name.localeCompare(b.name)));
  }),
  http.post("/api/warehouse/suppliers", async ({ request }) => saveSupplier(request, null)),
  http.put("/api/warehouse/suppliers/:id", async ({ request, params }) => saveSupplier(request, String(params.id))),

  http.get("/api/warehouse/grns", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = whView()(ctx);
    if (user instanceof Response) return user;
    const wh = whStore.get();
    return HttpResponse.json(wh.grns.filter((g) => inScope(ctx, g.campus) && inSession(g.date, ctx.session)).map((g) => grnView(wh, g)).sort((a, b) => b.postedAt.localeCompare(a.postedAt)));
  }),

  http.post("/api/warehouse/grns", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = writeGuard("warehouse.manage", ctx);
    if (user instanceof Response) return user;
    const { key, hit } = idem(request);
    if (hit) return HttpResponse.json(hit, { status: 201 });
    const campus = ctx.campus as CampusCode;
    const b = (await request.json()) as { supplierId: string; supplierInvoiceNo: string; date: IsoDate; freight: number; tax?: number; note: string; lines: Array<{ itemId: string; qty: number; unitPrice: number; discountPct: number }> };
    const wh = whStore.get();
    const sup = wh.suppliers.find((s) => s.id === b.supplierId && s.campus === campus && s.active);
    if (!sup) return bad("supplierId", "Choose the supplier.");
    const inv = (b.supplierInvoiceNo ?? "").trim();
    if (!inv) return bad("supplierInvoiceNo", "Enter the supplier's invoice or bill number.");
    const dup = wh.grns.find((g) => g.supplierId === sup.id && g.supplierInvoiceNo.toLowerCase() === inv.toLowerCase() && g.status === "POSTED");
    if (dup) return fail(409, "DUPLICATE_INVOICE", `Invoice ${inv} from ${sup.name} was already received on ${dup.no} (${formatDate(dup.date)}).`, { field: "supplierInvoiceNo" });
    if (!b.date || b.date > TODAY || b.date < sessionStart(CURRENT_SESSION)) return bad("date", "The date must be in this session and not in the future.");
    if (!int(b.freight) || b.freight < 0) return bad("freight", "Enter freight in whole rupees, or 0.");
    const tax = b.tax ?? 0;
    if (!int(tax) || tax < 0) return bad("tax", "Enter sales tax in whole rupees, or 0.");
    if (!b.lines?.length) return bad("lines", "Add at least one item.");
    const seen = new Set<string>();
    for (const [i, l] of b.lines.entries()) {
      const it = wh.items.find((x) => x.id === l.itemId && x.campus === campus);
      if (!it) return bad(`lines.${i}.itemId`, "Choose the item.");
      if (seen.has(l.itemId)) return bad(`lines.${i}.itemId`, `${it.name} is on the list twice. Put the total on one line.`);
      seen.add(l.itemId);
      if (!int(l.qty) || l.qty <= 0) return bad(`lines.${i}.qty`, "Quantity must be a whole number above 0.");
      if (!int(l.unitPrice) || l.unitPrice < 0) return bad(`lines.${i}.unitPrice`, "Enter the price in whole rupees.");
      if (typeof l.discountPct !== "number" || l.discountPct < 0 || l.discountPct > 100) return bad(`lines.${i}.discountPct`, "Discount is 0 to 100%.");
    }
    const no = nextNo("GRN", campus);
    const postedAt = demoNow();
    const rec = { id: uid(`${campus}-grn`), no, campus, supplierId: sup.id, supplierInvoiceNo: inv, date: b.date, lines: b.lines, freight: b.freight, tax, status: "POSTED" as const, receivedBy: user.name, postedAt, note: (b.note ?? "").trim(), reversal: null };
    whStore.set((s) => ({ ...s, grns: [...s.grns, rec] }));
    pushMoves(b.lines.map((l) => ({ campus, itemId: l.itemId, date: b.date, at: postedAt, type: "RECEIPT", docId: rec.id, docNo: no, qtyIn: l.qty, qtyOut: 0, unitCost: Math.round(l.unitPrice * (1 - l.discountPct / 100)), party: sup.name, room: "", note: `Invoice ${inv}`, by: user.name })));
    return HttpResponse.json(remember(key, grnView(whStore.get(), rec)), { status: 201 });
  }),

  http.post("/api/warehouse/grns/:id/reverse", async ({ request, params }) => {
    await latency();
    const wh = whStore.get();
    const g = wh.grns.find((x) => x.id === params.id);
    if (!g) return fail(404, "NOT_FOUND", "This goods received note is no longer on record.");
    const user = writeGuard("warehouse.manage", ctxOf(g.campus, request));
    if (user instanceof Response) return user;
    if (g.status === "REVERSED") return fail(409, "ALREADY_REVERSED", "This receipt has already been reversed.");
    const { reason } = (await request.json()) as { reason: string };
    if ((reason ?? "").trim().length < 5) return bad("reason", "Say why it is being reversed (at least a few words).");
    const bals = balances(wh);
    for (const l of g.lines) {
      const have = bals.get(l.itemId)?.onHand ?? 0;
      if (have < l.qty) {
        const it = wh.items.find((x) => x.id === l.itemId)!;
        return fail(409, "STOCK_USED", `Only ${have} of the ${l.qty} ${it.name} from this receipt are still in the store. Take back the issues first, or count the stock.`);
      }
    }
    const now = demoNow();
    whStore.set((s) => ({ ...s, grns: s.grns.map((x) => (x.id === g.id ? { ...x, status: "REVERSED", reversal: { by: user.name, at: now, reason: reason.trim() } } : x)) }));
    const sup = wh.suppliers.find((s) => s.id === g.supplierId)!;
    pushMoves(g.lines.map((l) => ({ campus: g.campus, itemId: l.itemId, date: TODAY, at: now, type: "REVERSAL", docId: g.id, docNo: g.no, qtyIn: 0, qtyOut: l.qty, unitCost: Math.round(l.unitPrice * (1 - l.discountPct / 100)), party: sup.name, room: "", note: reason.trim(), by: user.name })));
    return HttpResponse.json(grnView(whStore.get(), whStore.get().grns.find((x) => x.id === g.id)!));
  }),

  http.get("/api/warehouse/requests", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = whView()(ctx);
    if (user instanceof Response) return user;
    const wh = whStore.get();
    return HttpResponse.json(wh.requests.filter((r) => inScope(ctx, r.campus) && inSession(r.requestedOn, ctx.session)).map((r) => requestView(wh, r)).sort((a, b) => b.requestedOn.localeCompare(a.requestedOn)));
  }),

  http.post("/api/warehouse/requests", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = writeGuard("warehouse.manage", ctx);
    if (user instanceof Response) return user;
    const campus = ctx.campus as CampusCode;
    const b = (await request.json()) as { departmentId: string; room: string; requestedBy: string; note: string; lines: Array<{ itemId: string; qty: number }> };
    const wh = whStore.get();
    const dep = wh.departments.find((d) => d.id === b.departmentId && d.campus === campus);
    if (!dep) return bad("departmentId", "Choose the department.");
    if (!dep.rooms.some((r) => r.name === b.room && r.active)) return bad("room", "Choose the room or class.");
    if ((b.requestedBy ?? "").trim().length < 3) return bad("requestedBy", "Enter who asked for it.");
    if (!b.lines?.length) return bad("lines", "Add at least one item.");
    for (const [i, l] of b.lines.entries()) {
      if (!wh.items.some((x) => x.id === l.itemId && x.campus === campus)) return bad(`lines.${i}.itemId`, "Choose the item.");
      if (!int(l.qty) || l.qty <= 0) return bad(`lines.${i}.qty`, "Quantity must be a whole number above 0.");
    }
    const no = nextNo("REQ", campus);
    const rec = { id: uid(`${campus}-req`), no, campus, departmentId: dep.id, room: b.room, requestedBy: b.requestedBy.trim(), requestedOn: TODAY, lines: b.lines, cancelled: false, note: (b.note ?? "").trim(), cancelReason: "" };
    whStore.set((s) => ({ ...s, requests: [...s.requests, rec] }));
    return HttpResponse.json(requestView(whStore.get(), rec), { status: 201 });
  }),

  http.post("/api/warehouse/requests/:id/cancel", async ({ request, params }) => {
    await latency();
    const wh = whStore.get();
    const r = wh.requests.find((x) => x.id === params.id);
    if (!r) return fail(404, "NOT_FOUND", "This request is no longer on record.");
    const user = writeGuard("warehouse.manage", ctxOf(r.campus, request));
    if (user instanceof Response) return user;
    const v = requestView(wh, r);
    if (v.status === "FULFILLED" || v.status === "CANCELLED") return fail(409, "CLOSED", `This request is already ${v.status === "FULFILLED" ? "issued" : "cancelled"}.`);
    const { reason } = (await request.json()) as { reason: string };
    if ((reason ?? "").trim().length < 3) return bad("reason", "Say why it is cancelled.");
    whStore.set((s) => ({ ...s, requests: s.requests.map((x) => (x.id === r.id ? { ...x, cancelled: true, cancelReason: reason.trim() } : x)) }));
    return HttpResponse.json(requestView(whStore.get(), whStore.get().requests.find((x) => x.id === r.id)!));
  }),

  http.get("/api/warehouse/issues", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = whView()(ctx);
    if (user instanceof Response) return user;
    const wh = whStore.get();
    return HttpResponse.json(wh.issues.filter((i) => inScope(ctx, i.campus) && inSession(i.date, ctx.session)).map((i) => issueView(wh, i)).sort((a, b) => b.postedAt.localeCompare(a.postedAt)));
  }),

  http.post("/api/warehouse/issues", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = writeGuard("warehouse.manage", ctx);
    if (user instanceof Response) return user;
    const { key, hit } = idem(request);
    if (hit) return HttpResponse.json(hit, { status: 201 });
    const campus = ctx.campus as CampusCode;
    const b = (await request.json()) as { departmentId: string; room: string; receivedBy: string; requestId: string | null; lines: Array<{ itemId: string; qty: number; remarks: string }> };
    const wh = whStore.get();
    const dep = wh.departments.find((d) => d.id === b.departmentId && d.campus === campus);
    if (!dep) return bad("departmentId", "Choose the department.");
    // A request recorded before a room was taken out of use can still be issued to that room.
    const fromRequest = b.requestId ? wh.requests.find((r) => r.id === b.requestId) : undefined;
    if (!dep.rooms.some((r) => r.name === b.room && (r.active || fromRequest?.room === b.room))) return bad("room", "Choose the room or class it goes to.");
    if ((b.receivedBy ?? "").trim().length < 3) return bad("receivedBy", "Enter who received it.");
    if (b.requestId) {
      const req = wh.requests.find((r) => r.id === b.requestId && r.campus === campus);
      if (!req) return bad("requestId", "This request is no longer on record.");
      const st = requestView(wh, req).status;
      if (st === "FULFILLED" || st === "CANCELLED") return fail(409, "REQUEST_CLOSED", `Request ${req.no} is already ${st === "FULFILLED" ? "issued" : "cancelled"}.`, { field: "requestId" });
    }
    if (!b.lines?.length) return bad("lines", "Add at least one item.");
    const bals = balances(wh);
    const seen = new Set<string>();
    for (const [i, l] of b.lines.entries()) {
      const it = wh.items.find((x) => x.id === l.itemId && x.campus === campus);
      if (!it) return bad(`lines.${i}.itemId`, "Choose the item.");
      if (seen.has(l.itemId)) return bad(`lines.${i}.itemId`, `${it.name} is on the list twice. Put the total on one line.`);
      seen.add(l.itemId);
      if (!int(l.qty) || l.qty <= 0) return bad(`lines.${i}.qty`, "Quantity must be a whole number above 0.");
      const have = bals.get(it.id)?.onHand ?? 0;
      if (l.qty > have) return fail(409, "NOT_ENOUGH_STOCK", have === 0 ? `${it.name} is out of stock. Receive more before issuing.` : `Only ${have} ${it.name} in the store. Issue ${have} or less.`, { field: `lines.${i}.qty` });
    }
    const no = nextNo("ISS", campus);
    const postedAt = demoNow();
    const rec = {
      id: uid(`${campus}-iss`),
      no,
      campus,
      date: TODAY,
      departmentId: dep.id,
      room: b.room,
      receivedBy: b.receivedBy.trim(),
      requestId: b.requestId,
      lines: b.lines.map((l, i) => ({ id: `L${i + 1}`, itemId: l.itemId, qty: l.qty, unitCost: bals.get(l.itemId)?.avg ?? 0, remarks: (l.remarks ?? "").trim() })),
      issuedBy: user.name,
      postedAt,
    };
    whStore.set((s) => ({ ...s, issues: [...s.issues, rec] }));
    pushMoves(rec.lines.map((l) => ({ campus, itemId: l.itemId, date: TODAY, at: postedAt, type: "ISSUE", docId: rec.id, docNo: no, qtyIn: 0, qtyOut: l.qty, unitCost: l.unitCost, party: `${dep.name} · ${b.room}`, room: b.room, note: l.remarks, by: user.name })));
    return HttpResponse.json(remember(key, issueView(whStore.get(), rec)), { status: 201 });
  }),

  http.put("/api/warehouse/issues/:id/lines/:lineId", async ({ request, params }) => {
    await latency();
    const wh = whStore.get();
    const iss = wh.issues.find((i) => i.id === params.id);
    if (!iss) return fail(404, "NOT_FOUND", "This issue note is no longer on record.");
    const user = writeGuard("warehouse.manage", ctxOf(iss.campus, request));
    if (user instanceof Response) return user;
    const { remarks } = (await request.json()) as { remarks: string };
    if ((remarks ?? "").length > 200) return bad("remarks", "Keep the remark under 200 characters.");
    whStore.set((s) => ({ ...s, issues: s.issues.map((i) => (i.id === iss.id ? { ...i, lines: i.lines.map((l) => (l.id === params.lineId ? { ...l, remarks: remarks.trim() } : l)) } : i)) }));
    return HttpResponse.json(issueView(whStore.get(), whStore.get().issues.find((i) => i.id === iss.id)!));
  }),

  http.get("/api/warehouse/returns", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = whView()(ctx);
    if (user instanceof Response) return user;
    const wh = whStore.get();
    return HttpResponse.json(wh.returns.filter((r) => inScope(ctx, r.campus) && inSession(r.date, ctx.session)).map((r) => returnView(wh, r)).sort((a, b) => b.postedAt.localeCompare(a.postedAt)));
  }),

  http.post("/api/warehouse/returns", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = writeGuard("warehouse.manage", ctx);
    if (user instanceof Response) return user;
    const { key, hit } = idem(request);
    if (hit) return HttpResponse.json(hit, { status: 201 });
    const b = (await request.json()) as { issueId: string; reason: string; lines: Array<{ issueLineId: string; qty: number }> };
    const wh = whStore.get();
    const iss = wh.issues.find((i) => i.id === b.issueId && i.campus === ctx.campus);
    if (!iss) return bad("issueId", "Choose the issue note the items came out on.");
    if ((b.reason ?? "").trim().length < 3) return bad("reason", "Say why they are coming back.");
    const view = issueView(wh, iss);
    const lines = (b.lines ?? []).filter((l) => l.qty > 0);
    if (lines.length === 0) return bad("lines", "Enter how many of at least one item came back.");
    for (const l of lines) {
      const line = view.lines.find((x) => x.id === l.issueLineId);
      if (!line) return bad("lines", "This item is not on the issue note.");
      if (!int(l.qty)) return bad(`lines.${l.issueLineId}`, "Quantity must be a whole number.");
      const out = line.qty - line.returned;
      if (l.qty > out) return fail(409, "MORE_THAN_ISSUED", `Only ${out} of the ${line.qty} ${line.itemName} issued are still out${line.returned ? ` (${line.returned} already came back)` : ""}.`, { field: `lines.${l.issueLineId}` });
    }
    const no = nextNo("RET", ctx.campus as CampusCode);
    const postedAt = demoNow();
    const rec = { id: uid(`${iss.campus}-ret`), no, campus: iss.campus, date: TODAY, issueId: iss.id, lines: lines.map((l) => ({ issueLineId: l.issueLineId, qty: l.qty })), reason: b.reason.trim(), receivedBy: user.name, postedAt };
    whStore.set((s) => ({ ...s, returns: [...s.returns, rec] }));
    const dep = wh.departments.find((d) => d.id === iss.departmentId)!;
    pushMoves(
      lines.map((l) => {
        const line = iss.lines.find((x) => x.id === l.issueLineId)!;
        return { campus: iss.campus, itemId: line.itemId, date: TODAY, at: postedAt, type: "RETURN" as const, docId: rec.id, docNo: no, qtyIn: l.qty, qtyOut: 0, unitCost: line.unitCost, party: `${dep.name} · ${iss.room}`, room: iss.room, note: b.reason.trim(), by: user.name };
      }),
    );
    return HttpResponse.json(remember(key, returnView(whStore.get(), rec)), { status: 201 });
  }),

  http.get("/api/warehouse/counts", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = whView()(ctx);
    if (user instanceof Response) return user;
    const wh = whStore.get();
    return HttpResponse.json(wh.counts.filter((c) => inScope(ctx, c.campus) && inSession(c.startedOn, ctx.session)).map((c) => countView(wh, c)).sort((a, b) => b.startedOn.localeCompare(a.startedOn) || b.no.localeCompare(a.no)));
  }),

  http.get("/api/warehouse/counts/:id", async ({ params }) => {
    await latency();
    const wh = whStore.get();
    const c = wh.counts.find((x) => x.id === params.id);
    if (!c) return fail(404, "NOT_FOUND", "This stock count is no longer on record.");
    const user = guard("warehouse.view", c.campus);
    if (user instanceof Response) return user;
    return HttpResponse.json(countView(wh, c));
  }),

  http.post("/api/warehouse/counts", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = writeGuard("warehouse.manage", ctx);
    if (user instanceof Response) return user;
    const campus = ctx.campus as CampusCode;
    const b = (await request.json()) as { name: string; categoryId: string | null };
    const wh = whStore.get();
    if ((b.name ?? "").trim().length < 3) return bad("name", "Give the count a name, for example \"Stationery, November\".");
    if (b.categoryId && !wh.categories.some((c) => c.id === b.categoryId)) return bad("categoryId", "Choose a category, or all items.");
    const clash = wh.counts.find((c) => c.campus === campus && (c.status === "COUNTING" || c.status === "SUBMITTED" || c.status === "REJECTED") && (c.categoryId === b.categoryId || c.categoryId === null || b.categoryId === null));
    if (clash) return fail(409, "COUNT_OPEN", `${clash.no} "${clash.name}" covers the same items and is not finished. Finish it first.`, { field: "categoryId", details: { countId: clash.id } });
    const bals = balances(wh);
    const lines = wh.items
      .filter((i) => i.campus === campus && i.active && (!b.categoryId || i.categoryId === b.categoryId))
      .sort((a, b2) => a.code.localeCompare(b2.code))
      .map((i) => ({ itemId: i.id, systemQty: bals.get(i.id)?.onHand ?? 0, countedQty: null, reason: "", unitCost: bals.get(i.id)?.avg ?? 0 }));
    if (lines.length === 0) return bad("categoryId", "There are no items in this category to count.");
    let no = "";
    whStore.set((s) => {
      const n = (s.seq[`${campus}-CNT`] ?? 2) + 1;
      no = `${campus}-CNT-2627-${String(n).padStart(2, "0")}`;
      return { ...s, seq: { ...s.seq, [`${campus}-CNT`]: n } };
    });
    const rec = { id: uid(`${campus}-wcount`), no, campus, name: b.name.trim(), categoryId: b.categoryId, status: "COUNTING" as const, startedOn: TODAY, startedBy: user.name, submittedBy: null, submittedAt: null, decidedBy: null, decidedAt: null, decisionNote: "", lines };
    whStore.set((s) => ({ ...s, counts: [...s.counts, rec] }));
    return HttpResponse.json(countView(whStore.get(), rec), { status: 201 });
  }),

  http.put("/api/warehouse/counts/:id/lines", async ({ request, params }) => {
    await latency();
    const wh = whStore.get();
    const c = wh.counts.find((x) => x.id === params.id);
    if (!c) return fail(404, "NOT_FOUND", "This stock count is no longer on record.");
    const user = writeGuard("warehouse.manage", ctxOf(c.campus, request));
    if (user instanceof Response) return user;
    if (c.status !== "COUNTING" && c.status !== "REJECTED") return fail(409, "LOCKED", "This count has been submitted. It can't be changed now.");
    const { lines } = (await request.json()) as { lines: Array<{ itemId: string; countedQty: number | null; reason: string }> };
    for (const l of lines ?? []) {
      if (l.countedQty !== null && (!int(l.countedQty) || l.countedQty < 0)) return bad(`lines.${l.itemId}`, "Counted quantity must be a whole number, 0 or more.");
    }
    const byId = new Map((lines ?? []).map((l) => [l.itemId, l]));
    whStore.set((s) => ({ ...s, counts: s.counts.map((x) => (x.id === c.id ? { ...x, status: "COUNTING", lines: x.lines.map((l) => (byId.has(l.itemId) ? { ...l, countedQty: byId.get(l.itemId)!.countedQty, reason: (byId.get(l.itemId)!.reason ?? "").trim() } : l)) } : x)) }));
    return HttpResponse.json(countView(whStore.get(), whStore.get().counts.find((x) => x.id === c.id)!));
  }),

  http.post("/api/warehouse/counts/:id/submit", async ({ request, params }) => {
    await latency();
    const wh = whStore.get();
    const c = wh.counts.find((x) => x.id === params.id);
    if (!c) return fail(404, "NOT_FOUND", "This stock count is no longer on record.");
    const user = writeGuard("warehouse.manage", ctxOf(c.campus, request));
    if (user instanceof Response) return user;
    if (c.status !== "COUNTING" && c.status !== "REJECTED") return fail(409, "LOCKED", "This count has already been submitted.");
    const notCounted = c.lines.filter((l) => l.countedQty === null).length;
    if (notCounted) return fail(409, "NOT_COUNTED", `${notCounted} ${notCounted === 1 ? "item is" : "items are"} not counted yet. Enter 0 for anything not on the shelf.`);
    const noReason = c.lines.filter((l) => l.countedQty !== l.systemQty && !l.reason.trim()).length;
    if (noReason) return fail(409, "REASON_NEEDED", `Give a reason for each difference (${noReason} without one).`);
    const now = demoNow();
    whStore.set((s) => ({ ...s, counts: s.counts.map((x) => (x.id === c.id ? { ...x, status: "SUBMITTED", submittedBy: user.name, submittedAt: now } : x)) }));
    return HttpResponse.json(countView(whStore.get(), whStore.get().counts.find((x) => x.id === c.id)!));
  }),

  http.post("/api/warehouse/counts/:id/decide", async ({ request, params }) => {
    await latency();
    const wh = whStore.get();
    const c = wh.counts.find((x) => x.id === params.id);
    if (!c) return fail(404, "NOT_FOUND", "This stock count is no longer on record.");
    const user = guard("approvals.decide", c.campus);
    if (user instanceof Response) return fail(403, "FORBIDDEN", "Only the principal or an admin can approve a stock adjustment.");
    const closed = closedSession(request);
    if (closed) return closed;
    if (c.status !== "SUBMITTED") return fail(409, "NOT_WAITING", "This count is not waiting for approval.");
    if (c.submittedBy === user.name) return fail(403, "SAME_PERSON", "You submitted this count. Another person must approve it.");
    const b = (await request.json()) as { decision: "APPROVE" | "REJECT"; note: string };
    const now = demoNow();
    if (b.decision === "REJECT") {
      if ((b.note ?? "").trim().length < 5) return bad("note", "Say what needs checking again.");
      whStore.set((s) => ({ ...s, counts: s.counts.map((x) => (x.id === c.id ? { ...x, status: "REJECTED", decidedBy: user.name, decidedAt: now, decisionNote: b.note.trim() } : x)) }));
    } else {
      const bals = balances(wh);
      for (const l of c.lines) {
        const d = (l.countedQty ?? l.systemQty) - l.systemQty;
        const have = bals.get(l.itemId)?.onHand ?? 0;
        if (have + d < 0) {
          const it = wh.items.find((x) => x.id === l.itemId)!;
          return fail(409, "STOCK_MOVED", `${it.name} has moved since the count (${have} now in the store), so the adjustment would go below zero. Send the count back to be checked.`);
        }
      }
      whStore.set((s) => ({ ...s, counts: s.counts.map((x) => (x.id === c.id ? { ...x, status: "APPROVED", decidedBy: user.name, decidedAt: now, decisionNote: (b.note ?? "").trim() } : x)) }));
      pushMoves(
        c.lines
          .filter((l) => l.countedQty !== null && l.countedQty !== l.systemQty)
          .map((l) => {
            const d = l.countedQty! - l.systemQty;
            return { campus: c.campus, itemId: l.itemId, date: TODAY, at: now, type: "ADJUSTMENT" as const, docId: c.id, docNo: c.no, qtyIn: Math.max(0, d), qtyOut: Math.max(0, -d), unitCost: l.unitCost, party: "Stock count", room: "", note: l.reason, by: user.name };
          }),
      );
    }
    return HttpResponse.json(countView(whStore.get(), whStore.get().counts.find((x) => x.id === c.id)!));
  }),

  http.get("/api/warehouse/shop", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = whView()(ctx);
    if (user instanceof Response) return user;
    const wh = whStore.get();
    const bals = balances(wh);
    const today = wh.sales.filter((s) => inScope(ctx, s.campus) && s.at.startsWith(TODAY) && s.status === "POSTED").map((s) => saleView(wh, s));
    return HttpResponse.json({
      items: wh.items.filter((i) => inScope(ctx, i.campus) && i.active && i.salePrice !== null).map((i) => itemView(wh, i, bals)).filter((i) => i.forSale).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
      bookSets: wh.bookSets.filter((b) => inScope(ctx, b.campus)).map((b) => bookSetView(wh, b)),
      today: { sales: today.length, cash: today.filter((s) => s.payment === "CASH").reduce((a, s) => a + s.total, 0), feeAccount: today.filter((s) => s.payment === "FEE_ACCOUNT").reduce((a, s) => a + s.total, 0) },
    });
  }),

  http.get("/api/warehouse/sales", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = whView()(ctx);
    if (user instanceof Response) return user;
    const date = url.searchParams.get("date") ?? "";
    const wh = whStore.get();
    return HttpResponse.json(wh.sales.filter((s) => inScope(ctx, s.campus) && (date ? s.at.startsWith(date) : inSession(s.at.slice(0, 10), ctx.session))).map((s) => saleView(wh, s)).sort((a, b) => b.at.localeCompare(a.at)));
  }),

  http.get("/api/warehouse/sales/:id", async ({ params }) => {
    await latency();
    const wh = whStore.get();
    const s = wh.sales.find((x) => x.id === params.id || x.receiptNo === params.id);
    if (!s) return fail(404, "NOT_FOUND", "This sale is no longer on record.");
    const user = guard("warehouse.view", s.campus);
    if (user instanceof Response) return user;
    return HttpResponse.json(saleView(wh, s));
  }),

  http.post("/api/warehouse/sales", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = writeGuard("warehouse.manage", ctx);
    if (user instanceof Response) return user;
    const { key, hit } = idem(request);
    if (hit) return HttpResponse.json(hit, { status: 201 });
    const campus = ctx.campus as CampusCode;
    const b = (await request.json()) as { grNo: string; payment: "CASH" | "FEE_ACCOUNT"; received: number | null; lines: Array<{ itemId: string; qty: number }> };
    const st = findStudent(b.grNo ?? "");
    if (!st) return bad("grNo", "Choose the student.");
    if (st.campus !== campus) return fail(409, "OTHER_CAMPUS", `${st.name} belongs to ${campusName(st.campus)}.`, { field: "grNo" });
    if (st.status !== "ACTIVE") return fail(409, "LEFT", `${st.name} has left the school.`, { field: "grNo" });
    const wh = whStore.get();
    const bals = balances(wh);
    if (!b.lines?.length) return bad("lines", "Add at least one item.");
    const lines: Array<{ itemId: string; qty: number; price: number }> = [];
    for (const [i, l] of b.lines.entries()) {
      const it = wh.items.find((x) => x.id === l.itemId && x.campus === campus && x.salePrice !== null);
      if (!it) return bad(`lines.${i}.itemId`, "This item is not sold in the shop.");
      if (!int(l.qty) || l.qty <= 0) return bad(`lines.${i}.qty`, "Quantity must be a whole number above 0.");
      const have = bals.get(it.id)?.onHand ?? 0;
      if (l.qty > have) return fail(409, "NOT_ENOUGH_STOCK", have === 0 ? `${it.name} is out of stock.` : `Only ${have} ${it.name} left. Sell ${have} or less.`, { field: `lines.${i}.qty` });
      lines.push({ itemId: it.id, qty: l.qty, price: it.salePrice! });
    }
    const total = lines.reduce((a, l) => a + l.qty * l.price, 0);
    if (b.payment === "CASH" && (!int(b.received) || (b.received ?? 0) < total)) return bad("received", `Cash received must be at least ${formatRs(total)}.`);
    const receiptNo = nextNo("BS", campus, 6);
    const at2 = demoNow();
    const id = uid(`${campus}-sale`);
    const feeChargeId = b.payment === "FEE_ACCOUNT" ? addFeeCharge(st.grNo, `bs-${receiptNo}`, `Book shop: ${receiptNo}`, total, TODAY) : null;
    const rec: WhSaleRec = { id, receiptNo, campus, at: at2, grNo: st.grNo, lines, payment: b.payment, received: b.payment === "CASH" ? b.received : null, soldBy: user.name, status: "POSTED", cancelReason: "", feeChargeId };
    whStore.set((s) => ({ ...s, sales: [...s.sales, rec] }));
    pushMoves(lines.map((l) => ({ campus, itemId: l.itemId, date: TODAY, at: at2, type: "SALE", docId: id, docNo: receiptNo, qtyIn: 0, qtyOut: l.qty, unitCost: bals.get(l.itemId)?.avg ?? 0, party: `${st.name} (${st.classSection})`, room: "", note: b.payment === "FEE_ACCOUNT" ? "Added to fee account" : "", by: user.name })));
    return HttpResponse.json(remember(key, saleView(whStore.get(), rec)), { status: 201 });
  }),

  http.post("/api/warehouse/sales/:id/cancel", async ({ request, params }) => {
    await latency();
    const wh = whStore.get();
    const s = wh.sales.find((x) => x.id === params.id);
    if (!s) return fail(404, "NOT_FOUND", "This sale is no longer on record.");
    const user = writeGuard("warehouse.manage", ctxOf(s.campus, request));
    if (user instanceof Response) return user;
    if (s.status === "CANCELLED") return fail(409, "ALREADY_CANCELLED", "This sale is already cancelled.");
    if (!s.at.startsWith(TODAY)) return fail(409, "NOT_TODAY", "Only today's sales can be cancelled at the shop. For an older sale, take the items back as a return and refund through the office.");
    const { reason } = (await request.json()) as { reason: string };
    if ((reason ?? "").trim().length < 5) return bad("reason", "Say why the sale is cancelled.");
    if (s.feeChargeId && !cancelFeeCharge(s.grNo, s.feeChargeId)) return fail(409, "ALREADY_PAID", "This amount has already been paid at the fee counter. Cancel that receipt first.");
    const now = demoNow();
    whStore.set((st) => ({ ...st, sales: st.sales.map((x) => (x.id === s.id ? { ...x, status: "CANCELLED", cancelReason: reason.trim() } : x)) }));
    pushMoves(s.lines.map((l) => ({ campus: s.campus, itemId: l.itemId, date: TODAY, at: now, type: "SALE_CANCEL", docId: s.id, docNo: s.receiptNo, qtyIn: l.qty, qtyOut: 0, unitCost: balances(wh).get(l.itemId)?.avg ?? 0, party: "Sale cancelled", room: "", note: reason.trim(), by: user.name })));
    return HttpResponse.json(saleView(whStore.get(), whStore.get().sales.find((x) => x.id === s.id)!));
  }),

  http.put("/api/warehouse/book-sets/:id", async ({ request, params }) => {
    await latency();
    const wh = whStore.get();
    const set = wh.bookSets.find((x) => x.id === params.id);
    if (!set) return fail(404, "NOT_FOUND", "This book set is no longer on record.");
    const user = writeGuard("warehouse.manage", ctxOf(set.campus, request));
    if (user instanceof Response) return user;
    const { lines } = (await request.json()) as { lines: Array<{ itemId: string; qty: number }> };
    for (const l of lines ?? []) {
      if (!wh.items.some((i) => i.id === l.itemId && i.campus === set.campus && i.salePrice !== null)) return bad("lines", "Every item in a set must be sold in the shop.");
      if (!int(l.qty) || l.qty <= 0) return bad("lines", "Quantities must be whole numbers above 0.");
    }
    if (!lines?.length) return bad("lines", "A set needs at least one item.");
    whStore.set((s) => ({ ...s, bookSets: s.bookSets.map((x) => (x.id === set.id ? { ...x, lines } : x)) }));
    return HttpResponse.json(bookSetView(whStore.get(), whStore.get().bookSets.find((x) => x.id === set.id)!));
  }),
];

async function saveItem(request: Request, id: string | null) {
  await latency();
  const ctx = ctxFrom(new URL(request.url));
  const wh = whStore.get();
  const existing = id ? wh.items.find((i) => i.id === id) : undefined;
  if (id && !existing) return fail(404, "NOT_FOUND", "This item is no longer on record.");
  const user = writeGuard("warehouse.manage", existing ? ctxOf(existing.campus, request) : ctx);
  if (user instanceof Response) return user;
  const campus = existing?.campus ?? (ctx.campus as CampusCode);
  const b = (await request.json()) as { group: string; name: string; categoryId: string; unit: string; consumable: boolean; reorderLevel: number; salePrice: number | null; active: boolean; openingQty?: number; openingCost?: number };
  const name = (b.name ?? "").trim();
  if (name.length < 2) return bad("name", "Enter the item name, for example \"Register 200 pages\".");
  if (wh.items.some((i) => i.campus === campus && i.id !== id && norm(i.name) === norm(name))) return fail(409, "DUPLICATE", `${name} is already an item at this campus.`, { field: "name" });
  const cat = wh.categories.find((c) => c.id === b.categoryId);
  if (!cat) return bad("categoryId", "Choose a category.");
  if (!(WAREHOUSE_UNITS as readonly string[]).includes(b.unit)) return bad("unit", "Choose the unit it is counted in.");
  if (!int(b.reorderLevel) || b.reorderLevel < 0) return bad("reorderLevel", "Enter the level to reorder at (a whole number, 0 or more).");
  if (cat.forSale && (!int(b.salePrice) || (b.salePrice ?? 0) <= 0)) return bad("salePrice", "Enter the price students pay, in whole rupees.");
  if (!existing && b.openingQty !== undefined && (!int(b.openingQty) || b.openingQty < 0)) return bad("openingQty", "Opening quantity must be a whole number, 0 or more.");
  if (!existing && (b.openingQty ?? 0) > 0 && (!int(b.openingCost) || (b.openingCost ?? 0) < 0)) return bad("openingCost", "Enter the cost of one unit in whole rupees.");
  const prefix = ({ "wc-office": "OF", "wc-class": "CL", "wc-clean": "CN", "wc-elec": "EL", "wc-it": "IT", "wc-furn": "FN", "wc-sport": "SP", "wc-lab": "LB", "wc-books": "BK", "wc-uniform": "UN", "wc-stat": "SS" } as Record<string, string>)[cat.id] ?? "GN";
  const code = existing?.code ?? `${prefix}-${String(wh.items.filter((i) => i.campus === campus && i.code.startsWith(`${prefix}-`)).length + 1).padStart(3, "0")}`;
  const rec: WhItemRec = { id: existing?.id ?? uid(`${campus}-it`), campus, code, group: (b.group ?? "").trim() || name.split(" ")[0]!, name, categoryId: cat.id, unit: b.unit, consumable: Boolean(b.consumable), reorderLevel: b.reorderLevel, salePrice: cat.forSale ? b.salePrice : null, active: b.active !== false };
  whStore.set((s) => ({ ...s, items: existing ? s.items.map((i) => (i.id === rec.id ? rec : i)) : [...s.items, rec] }));
  if (!existing && (b.openingQty ?? 0) > 0) {
    const now = demoNow();
    pushMoves([{ campus, itemId: rec.id, date: TODAY, at: now, type: "OPENING", docId: "", docNo: `${campus}-OB-2627`, qtyIn: b.openingQty!, qtyOut: 0, unitCost: b.openingCost ?? 0, party: "Opening balance", room: "", note: "Counted when the item was added", by: user.name }]);
  }
  return HttpResponse.json(itemView(whStore.get(), rec), { status: existing ? 200 : 201 });
}

async function saveWhCategory(request: Request, id: string | null) {
  await latency();
  const ctx = ctxFrom(new URL(request.url));
  const user = guard("warehouse.manage", ctx.campus);
  if (user instanceof Response) return user;
  const closed = closedSession(request);
  if (closed) return closed;
  const b = (await request.json()) as { name: string; forSale: boolean; active: boolean };
  const name = (b.name ?? "").trim();
  if (name.length < 2) return bad("name", "Enter the category name.");
  const wh = whStore.get();
  if (wh.categories.some((c) => c.id !== id && norm(c.name) === norm(name))) return fail(409, "DUPLICATE", `"${name}" is already a category.`, { field: "name" });
  const rec = { id: id ?? uid("wc"), name, forSale: Boolean(b.forSale), active: b.active !== false };
  whStore.set((s) => ({ ...s, categories: id ? s.categories.map((c) => (c.id === id ? rec : c)) : [...s.categories, rec] }));
  return HttpResponse.json({ ...rec, items: wh.items.filter((i) => i.categoryId === rec.id).length }, { status: id ? 200 : 201 });
}

async function saveDepartment(request: Request, id: string | null) {
  await latency();
  const ctx = ctxFrom(new URL(request.url));
  const user = writeGuard("warehouse.manage", ctx);
  if (user instanceof Response) return user;
  const campus = ctx.campus as CampusCode;
  const b = (await request.json()) as { name: string; rooms: Array<{ name: string; roomNo: string; floor: number | null; active: boolean }>; active: boolean; rowVer?: number };
  const wh = whStore.get();
  const existing = id ? wh.departments.find((d) => d.id === id) : undefined;
  if (id && !existing) return fail(404, "NOT_FOUND", "This department is no longer on record.");
  if (existing) {
    const conflict = stale(existing, b.rowVer, "department");
    if (conflict) return conflict;
  }
  const name = (b.name ?? "").trim();
  if (name.length < 2) return bad("name", "Enter the department name.");
  const rooms = (b.rooms ?? []).map((r) => ({ name: (r.name ?? "").trim().replace(/\s+/g, " "), roomNo: (r.roomNo ?? "").trim().toUpperCase(), floor: r.floor ?? null, active: r.active !== false })).filter((r) => r.name || r.roomNo);
  if (rooms.length === 0) return bad("rooms", "Add at least one room or class.");
  // Room names are unique in the department; room numbers are unique across the campus.
  const otherNos = new Map(wh.departments.filter((d) => d.campus === campus && d.id !== id).flatMap((d) => d.rooms.filter((r) => r.roomNo).map((r) => [r.roomNo.toUpperCase(), `${r.name} (${d.name})`] as const)));
  const seenNames = new Set<string>();
  const seenNos = new Set<string>();
  for (const [i, r] of rooms.entries()) {
    if (r.name.length < 2) return bad(`rooms.${i}.name`, "Enter the room or class name.");
    if (seenNames.has(norm(r.name))) return bad(`rooms.${i}.name`, `${r.name} is on the list twice.`);
    seenNames.add(norm(r.name));
    if (r.roomNo && !/^[A-Z0-9-]{1,8}$/.test(r.roomNo)) return bad(`rooms.${i}.roomNo`, "Use a short room number such as 204 or G-12.");
    if (r.roomNo && seenNos.has(r.roomNo)) return bad(`rooms.${i}.roomNo`, `Room ${r.roomNo} is on the list twice.`);
    if (r.roomNo && otherNos.has(r.roomNo)) return fail(409, "DUPLICATE_ROOM_NO", `Room ${r.roomNo} is already ${otherNos.get(r.roomNo)}. Room numbers can't repeat at a campus.`, { field: `rooms.${i}.roomNo` });
    if (r.roomNo) seenNos.add(r.roomNo);
    if (r.floor !== null && (!int(r.floor) || r.floor < 0 || r.floor > 20)) return bad(`rooms.${i}.floor`, "Floor is 0 (ground) to 20.");
  }
  // A room that still holds stock can't be removed; take it out of use instead.
  for (const old of existing?.rooms ?? []) {
    if (rooms.some((r) => r.name === old.name)) continue;
    const held = roomStock(wh, [campus], { departmentId: existing!.id, room: old.name }).filter((x) => !x.consumable);
    if (held.length) return fail(409, "ROOM_IN_USE", `${old.name} still holds ${held.length === 1 ? held[0]!.itemName : `${held.length} kept items`}. Take them back first, or untick "In use" instead of removing it.`, { field: "rooms" });
  }
  if (wh.departments.some((d) => d.campus === campus && d.id !== id && norm(d.name) === norm(name))) return fail(409, "DUPLICATE", `${name} already exists.`, { field: "name" });
  const rec = { id: id ?? uid(`${campus}-dep`), campus, name, rooms, active: b.active !== false, rowVer: existing ? (existing.rowVer ?? 1) + 1 : 1 };
  whStore.set((s) => ({ ...s, departments: id ? s.departments.map((d) => (d.id === id ? rec : d)) : [...s.departments, rec] }));
  return HttpResponse.json(deptView(whStore.get(), rec, ctx.session), { status: id ? 200 : 201 });
}

async function saveSupplier(request: Request, id: string | null) {
  await latency();
  const ctx = ctxFrom(new URL(request.url));
  const wh = whStore.get();
  const existing = id ? wh.suppliers.find((s) => s.id === id) : undefined;
  if (id && !existing) return fail(404, "NOT_FOUND", "This supplier is no longer on record.");
  const user = writeGuard("warehouse.manage", existing ? ctxOf(existing.campus, request) : ctx);
  if (user instanceof Response) return user;
  const campus = existing?.campus ?? (ctx.campus as CampusCode);
  const b = (await request.json()) as { name: string; contact: string; phone: string; mobile?: string; email?: string; address: string; ntn: string; supplies: string; active: boolean; rowVer?: number };
  if (existing) {
    const conflict = stale(existing, b.rowVer, "supplier");
    if (conflict) return conflict;
  }
  const name = (b.name ?? "").trim();
  if (name.length < 2) return bad("name", "Enter the supplier's business name.");
  if (wh.suppliers.some((s) => s.campus === campus && s.id !== id && norm(s.name) === norm(name))) return fail(409, "DUPLICATE", `${name} is already a supplier at this campus.`, { field: "name" });
  const digits = (b.phone ?? "").replace(/\D/g, "");
  if (digits && (digits.length < 10 || digits.length > 11)) return bad("phone", "Enter a landline like 068-5551234.");
  const mobile = (b.mobile ?? "").trim();
  if (mobile && !/^03\d{9}$/.test(mobile.replace(/\D/g, ""))) return bad("mobile", "Enter a mobile number of 11 digits, like 0300-1234567.");
  const email = (b.email ?? "").trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad("email", "Enter an email address like orders@example.com.");
  if ((b.supplies ?? "").trim().length < 2) return bad("supplies", "Say what they supply, for example \"Stationery\".");
  const rec = { id: existing?.id ?? uid(`${campus}-sup`), campus, name, contact: (b.contact ?? "").trim(), phone: (b.phone ?? "").trim(), mobile, email, address: (b.address ?? "").trim(), ntn: (b.ntn ?? "").trim(), supplies: b.supplies.trim(), active: b.active !== false, rowVer: existing ? (existing.rowVer ?? 1) + 1 : 1 };
  whStore.set((s) => ({ ...s, suppliers: existing ? s.suppliers.map((x) => (x.id === rec.id ? rec : x)) : [...s.suppliers, rec] }));
  return HttpResponse.json(supplierView(whStore.get(), rec, ctx.session), { status: existing ? 200 : 201 });
}

/* ================================================================================================ Transport: views */

type Trn = ReturnType<typeof trnStore.get>;

const riderActive = (r: TrnRiderRec, on: IsoDate = TODAY) => r.fromDate <= addDays(on, 60) && (r.toDate === null || r.toDate >= on);
const activeRiders = (trn: Trn, routeId: string) => trn.riders.filter((r) => r.routeId === routeId && riderActive(r));

function alertsOf(v: Trn["vehicles"][number]): TransportAlert[] {
  const docs: Array<[TransportAlert["kind"], IsoDate]> = [
    ["FITNESS", v.fitnessExpiry],
    ["INSURANCE", v.insuranceExpiry],
    ["LICENCE", v.licenceExpiry],
    ["PERMIT", v.permitExpiry],
  ];
  return docs.map(([kind, expiresOn]) => ({ vehicleId: v.id, regNo: v.regNo, kind, expiresOn, days: daysBetween(TODAY, expiresOn) })).filter((a) => a.days <= 30);
}

function vehicleView(trn: Trn, v: Trn["vehicles"][number]): TransportVehicle {
  const route = trn.routes.find((r) => r.vehicleId === v.id && r.active);
  return { ...v, routeId: route?.id ?? null, routeCode: route?.code ?? null, routeName: route?.name ?? null, riders: route ? activeRiders(trn, route.id).length : 0, alerts: alertsOf(v) };
}

function routeView(trn: Trn, r: Trn["routes"][number]): TransportRoute {
  const v = r.vehicleId ? trn.vehicles.find((x) => x.id === r.vehicleId) : undefined;
  const riders = activeRiders(trn, r.id);
  return {
    id: r.id,
    campus: r.campus,
    code: r.code,
    name: r.name,
    vehicleId: v?.id ?? null,
    vehicleRegNo: v?.regNo ?? "",
    vehicleLabel: v ? `${v.make} ${v.model} · ${v.regNo}` : "No vehicle",
    capacity: v?.capacity ?? 0,
    riders: riders.length,
    fare: r.fare,
    stops: r.stops.map((s) => ({ ...s, riders: riders.filter((x) => x.stopId === s.id).length })),
    driverName: v?.driverName ?? "",
    driverMobile: v?.driverMobile ?? "",
    active: r.active,
  };
}

function riderView(trn: Trn, r: TrnRiderRec): TransportRider {
  const p = personOf(r.type, r.personId);
  const route = trn.routes.find((x) => x.id === r.routeId)!;
  const stop = route.stops.find((s) => s.id === r.stopId) ?? route.stops[0]!;
  return {
    id: r.id,
    campus: r.campus,
    type: r.type,
    personId: r.personId,
    name: p?.name ?? r.personId,
    detail: p?.detail ?? "",
    father: p?.father ?? "",
    mobile: p?.mobile ?? "",
    routeId: route.id,
    routeCode: route.code,
    routeName: route.name,
    stopId: stop.id,
    stopName: stop.name,
    pickupTime: stop.pickupTime,
    dropTime: stop.dropTime,
    direction: r.direction,
    fromDate: r.fromDate,
    toDate: r.toDate,
    monthlyFee: stop.fare ?? route.fare,
    feeLink: r.type === "STUDENT" ? "BILLED" : "PAYROLL",
    status: riderActive(r) ? "ACTIVE" : "ENDED",
    endReason: r.endReason,
  };
}

function tripView(trn: Trn, t: Trn["trips"][number]): TransportTrip {
  const v = trn.vehicles.find((x) => x.id === t.vehicleId);
  const r = t.routeId ? trn.routes.find((x) => x.id === t.routeId) : undefined;
  return { ...t, regNo: v?.regNo ?? "", routeCode: r?.code ?? "" };
}

function fuelViews(trn: Trn, campuses: CampusCode[], session: number): TransportFuel[] {
  const rows = trn.fuel.filter((f) => campuses.includes(f.campus)).sort((a, b) => a.date.localeCompare(b.date) || a.odometer - b.odometer);
  const last = new Map<string, number>();
  const out: TransportFuel[] = [];
  for (const f of rows) {
    const prev = last.get(f.vehicleId);
    last.set(f.vehicleId, f.odometer);
    if (!inSession(f.date, session)) continue;
    const km = prev !== undefined ? f.odometer - prev : null;
    out.push({ ...f, regNo: trn.vehicles.find((v) => v.id === f.vehicleId)?.regNo ?? "", kmSinceLast: km, kmPerLitre: km !== null && f.litres > 0 ? Math.round((km / f.litres) * 10) / 10 : null });
  }
  return out.reverse();
}

function trnOverview(ctx: Ctx): TransportOverview {
  const trn = trnStore.get();
  const campuses = scopeOf(ctx);
  const vehicles = trn.vehicles.filter((v) => campuses.includes(v.campus));
  const routes = trn.routes.filter((r) => campuses.includes(r.campus) && r.active).map((r) => routeView(trn, r));
  const riders = trn.riders.filter((r) => campuses.includes(r.campus) && riderActive(r)).map((r) => riderView(trn, r));
  const months = ["2026-08", "2026-09", "2026-10", "2026-11"];
  const fuel = trn.fuel.filter((f) => campuses.includes(f.campus));
  return {
    vehicles: vehicles.length,
    activeVehicles: vehicles.filter((v) => v.active && trn.routes.some((r) => r.vehicleId === v.id && r.active)).length,
    routes: routes.length,
    riders: riders.length,
    seats: routes.reduce((a, r) => a + r.capacity, 0),
    fullRoutes: routes.filter((r) => r.capacity > 0 && r.riders >= r.capacity).length,
    monthlyBilling: riders.filter((r) => r.type === "STUDENT").reduce((a, r) => a + r.monthlyFee, 0),
    alerts: vehicles.filter((v) => v.active).flatMap(alertsOf).sort((a, b) => a.days - b.days),
    load: routes.map((r) => ({ routeId: r.id, code: ctx.campus === "ALL" ? `${r.campus} ${r.code}` : r.code, name: r.name, riders: r.riders, capacity: r.capacity })),
    fuel: months.map((m) => ({ month: m, litres: fuel.filter((f) => f.date.startsWith(m)).reduce((a, f) => a + f.litres, 0), amount: fuel.filter((f) => f.date.startsWith(m)).reduce((a, f) => a + f.amount, 0) })),
    fuelLast30: fuel.filter((f) => f.date > addDays(TODAY, -30)).reduce((a, f) => a + f.amount, 0),
    tripsToday: trn.trips.filter((t) => campuses.includes(t.campus) && t.date === TODAY).length,
  };
}

/** Bills the month the rider starts in: "Transport fee – Nov 2026", due on the 10th (or the start day if later). */
function billTransport(rider: TrnRiderRec, amount: number): { head: string; due: IsoDate; chargeId: string } {
  const month = rider.fromDate.slice(0, 7);
  const tenth = `${month}-10`;
  const due = rider.fromDate > tenth ? rider.fromDate : tenth;
  const head = `Transport fee – ${monthLabel(`${month}-01`)}`;
  const chargeId = addFeeCharge(rider.personId, `trn-${rider.id}-${month}`, head, amount, due);
  return { head, due, chargeId };
}

function capacityCheck(trn: Trn, routeId: string, allow: boolean | undefined, ignoreRiderId?: string): Response | null {
  const route = trn.routes.find((r) => r.id === routeId)!;
  const v = route.vehicleId ? trn.vehicles.find((x) => x.id === route.vehicleId) : undefined;
  if (!v) return fail(409, "NO_VEHICLE", `Route ${route.code} has no vehicle yet. Give it a vehicle first.`, { field: "routeId" });
  const n = activeRiders(trn, routeId).filter((r) => r.id !== ignoreRiderId).length;
  if (n >= v.capacity && !allow) return fail(409, "CAPACITY_FULL", `Route ${route.code} is full: ${n} riders for ${v.capacity} seats in ${v.regNo}.`, { field: "routeId", details: { riders: n, capacity: v.capacity } });
  return null;
}

/* ================================================================================================ Transport: handlers */

const transportHandlers: HttpHandler[] = [
  http.get("/api/transport/overview", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = guard("transport.view", ctx.campus);
    if (user instanceof Response) return user;
    return HttpResponse.json(trnOverview(ctx));
  }),

  http.get("/api/transport/vehicles", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = guard("transport.view", ctx.campus);
    if (user instanceof Response) return user;
    const trn = trnStore.get();
    return HttpResponse.json(trn.vehicles.filter((v) => inScope(ctx, v.campus)).map((v) => vehicleView(trn, v)).sort((a, b) => (a.routeCode ?? "Z").localeCompare(b.routeCode ?? "Z") || a.regNo.localeCompare(b.regNo)));
  }),

  http.post("/api/transport/vehicles", async ({ request }) => saveVehicle(request, null)),
  http.put("/api/transport/vehicles/:id", async ({ request, params }) => saveVehicle(request, String(params.id))),

  http.get("/api/transport/routes", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = guard("transport.view", ctx.campus);
    if (user instanceof Response) return user;
    const trn = trnStore.get();
    return HttpResponse.json(trn.routes.filter((r) => inScope(ctx, r.campus)).map((r) => routeView(trn, r)).sort((a, b) => a.campus.localeCompare(b.campus) || a.code.localeCompare(b.code)));
  }),

  http.post("/api/transport/routes", async ({ request }) => saveRoute(request, null)),
  http.put("/api/transport/routes/:id", async ({ request, params }) => saveRoute(request, String(params.id))),

  http.get("/api/transport/route-sheets", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = guard("transport.view", ctx.campus);
    if (user instanceof Response) return user;
    const only = url.searchParams.get("routeId") ?? "";
    const trn = trnStore.get();
    const sheets: TransportRouteSheet[] = trn.routes
      .filter((r) => inScope(ctx, r.campus) && r.active && (!only || r.id === only))
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((r) => {
        const view = routeView(trn, r);
        const v = r.vehicleId ? trn.vehicles.find((x) => x.id === r.vehicleId) : undefined;
        const riders = activeRiders(trn, r.id).map((x) => riderView(trn, x));
        return { route: view, vehicle: v ? vehicleView(trn, v) : null, stops: view.stops.map((s) => ({ stop: s, riders: riders.filter((x) => x.stopId === s.id).sort((a, b) => a.name.localeCompare(b.name)) })), campusName: campusName(r.campus) };
      });
    return HttpResponse.json(sheets);
  }),

  http.get("/api/transport/riders", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = guard("transport.view", ctx.campus);
    if (user instanceof Response) return user;
    const routeId = url.searchParams.get("routeId") ?? "";
    const status = url.searchParams.get("status") ?? "ACTIVE";
    const trn = trnStore.get();
    const rows = trn.riders
      .filter((r) => inScope(ctx, r.campus) && (!routeId || r.routeId === routeId))
      .filter((r) => r.fromDate <= sessionEnd(ctx.session) && (r.toDate === null || r.toDate >= sessionStart(ctx.session)))
      .map((r) => riderView(trn, r))
      .filter((r) => status === "ALL" || r.status === status)
      .sort((a, b) => a.routeCode.localeCompare(b.routeCode) || a.stopName.localeCompare(b.stopName) || a.name.localeCompare(b.name));
    return HttpResponse.json(rows);
  }),

  http.post("/api/transport/riders", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = writeGuard("transport.manage", ctx);
    if (user instanceof Response) return user;
    const { key, hit } = idem(request);
    if (hit) return HttpResponse.json(hit, { status: 201 });
    const campus = ctx.campus as CampusCode;
    const b = (await request.json()) as { type: OperationsPersonType; personId: string; routeId: string; stopId: string; direction: TrnRiderRec["direction"]; fromDate: IsoDate; allowOverCapacity?: boolean };
    const person = personOf(b.type, b.personId);
    if (!person) return bad("personId", "Choose the student or staff member.");
    if (person.campus !== campus) return fail(409, "OTHER_CAMPUS", `${person.name} belongs to ${campusName(person.campus)}.`, { field: "personId" });
    if (!person.active) return fail(409, "LEFT", `${person.name} has left the school.`, { field: "personId" });
    const trn = trnStore.get();
    const current = trn.riders.find((r) => r.type === b.type && r.personId === b.personId && riderActive(r));
    if (current) {
      const v = riderView(trn, current);
      return fail(409, "ALREADY_RIDING", `${person.name} already rides ${v.routeCode} from ${v.stopName}. Use "Change route" instead.`, { field: "personId", details: { riderId: current.id } });
    }
    const route = trn.routes.find((r) => r.id === b.routeId && r.campus === campus && r.active);
    if (!route) return bad("routeId", "Choose the route.");
    const stop = route.stops.find((s) => s.id === b.stopId);
    if (!stop) return bad("stopId", "Choose the stop where they get on.");
    if (!b.fromDate || b.fromDate < sessionStart(CURRENT_SESSION) || b.fromDate > addDays(TODAY, 60)) return bad("fromDate", "Start date must be in this session, up to 60 days ahead.");
    const cap = capacityCheck(trn, route.id, b.allowOverCapacity);
    if (cap) return cap;
    const rec: TrnRiderRec = { id: uid(`${campus}-rd`), campus, type: b.type, personId: b.personId, routeId: route.id, stopId: stop.id, direction: b.direction ?? "BOTH", fromDate: b.fromDate, toDate: null, endReason: "", feeChargeIds: [] };
    let feeHead = "";
    let feeDueOn: IsoDate | null = null;
    if (b.type === "STUDENT") {
      const bill = billTransport(rec, stop.fare ?? route.fare);
      rec.feeChargeIds = [bill.chargeId];
      feeHead = bill.head;
      feeDueOn = bill.due;
    }
    trnStore.set((s) => ({ ...s, riders: [...s.riders, rec] }));
    return HttpResponse.json(remember(key, { rider: riderView(trnStore.get(), rec), feeHead, feeDueOn }), { status: 201 });
  }),

  http.put("/api/transport/riders/:id", async ({ request, params }) => {
    await latency();
    const trn = trnStore.get();
    const r = trn.riders.find((x) => x.id === params.id);
    if (!r) return fail(404, "NOT_FOUND", "This rider is no longer on record.");
    const user = writeGuard("transport.manage", ctxOf(r.campus, request));
    if (user instanceof Response) return user;
    if (!riderActive(r)) return fail(409, "ENDED", "This assignment has ended. Assign the rider again.");
    const b = (await request.json()) as { routeId: string; stopId: string; direction: TrnRiderRec["direction"]; allowOverCapacity?: boolean };
    const route = trn.routes.find((x) => x.id === b.routeId && x.campus === r.campus && x.active);
    if (!route) return bad("routeId", "Choose the route.");
    const stop = route.stops.find((s) => s.id === b.stopId);
    if (!stop) return bad("stopId", "Choose the stop.");
    if (route.id !== r.routeId) {
      const cap = capacityCheck(trn, route.id, b.allowOverCapacity, r.id);
      if (cap) return cap;
    }
    const fee = stop.fare ?? route.fare;
    trnStore.set((s) => ({ ...s, riders: s.riders.map((x) => (x.id === r.id ? { ...x, routeId: route.id, stopId: stop.id, direction: b.direction ?? x.direction } : x)) }));
    // An unpaid charge this demo raised follows the new fare.
    for (const cid of r.feeChargeIds) setFeeChargeAmount(r.personId, cid, fee);
    const view = riderView(trnStore.get(), trnStore.get().riders.find((x) => x.id === r.id)!);
    return HttpResponse.json({ rider: view, feeHead: r.type === "STUDENT" ? `Transport fee ${formatRs(fee)} a month from the next fee voucher` : "", feeDueOn: null });
  }),

  http.post("/api/transport/riders/:id/end", async ({ request, params }) => {
    await latency();
    const trn = trnStore.get();
    const r = trn.riders.find((x) => x.id === params.id);
    if (!r) return fail(404, "NOT_FOUND", "This rider is no longer on record.");
    const user = writeGuard("transport.manage", ctxOf(r.campus, request));
    if (user instanceof Response) return user;
    if (r.toDate) return fail(409, "ENDED", `This assignment already ends on ${formatDate(r.toDate)}.`);
    const b = (await request.json()) as { toDate: IsoDate; reason: string };
    if (!b.toDate || b.toDate < r.fromDate || b.toDate > addDays(TODAY, 90)) return bad("toDate", "The last day must be after the start date, up to 90 days ahead.");
    if ((b.reason ?? "").trim().length < 3) return bad("reason", "Say why they stop using transport.");
    // Charges for months after the last day are cancelled if unpaid.
    for (const cid of r.feeChargeIds) {
      const c = feesStore.get().charges[r.personId]?.find((x) => x.id === cid);
      if (c && c.dueDate.slice(0, 7) > b.toDate.slice(0, 7)) cancelFeeCharge(r.personId, cid);
    }
    trnStore.set((s) => ({ ...s, riders: s.riders.map((x) => (x.id === r.id ? { ...x, toDate: b.toDate, endReason: b.reason.trim() } : x)) }));
    return HttpResponse.json(riderView(trnStore.get(), trnStore.get().riders.find((x) => x.id === r.id)!));
  }),

  http.get("/api/transport/trips", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = guard("transport.view", ctx.campus);
    if (user instanceof Response) return user;
    const trn = trnStore.get();
    return HttpResponse.json(trn.trips.filter((t) => inScope(ctx, t.campus) && inSession(t.date, ctx.session)).map((t) => tripView(trn, t)).sort((a, b) => b.date.localeCompare(a.date) || b.departAt.localeCompare(a.departAt)));
  }),

  http.post("/api/transport/trips", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = writeGuard("transport.manage", ctx);
    if (user instanceof Response) return user;
    const campus = ctx.campus as CampusCode;
    const b = (await request.json()) as Omit<Trn["trips"][number], "id" | "campus">;
    const trn = trnStore.get();
    const v = trn.vehicles.find((x) => x.id === b.vehicleId && x.campus === campus);
    if (!v) return bad("vehicleId", "Choose the vehicle.");
    if (!b.date || b.date > TODAY || b.date < sessionStart(CURRENT_SESSION)) return bad("date", "The date must be in this session and not in the future.");
    if (!/^\d{2}:\d{2}$/.test(b.departAt ?? "")) return bad("departAt", "Enter the time it left, for example 06:45.");
    if (!/^\d{2}:\d{2}$/.test(b.arriveAt ?? "") || b.arriveAt <= b.departAt) return bad("arriveAt", "Enter the arrival time, after the departure time.");
    if (!int(b.startKm) || b.startKm < 0) return bad("startKm", "Enter the meter reading when it left.");
    if (!int(b.endKm) || b.endKm < b.startKm) return bad("endKm", "The meter reading at the end can't be less than at the start.");
    if (b.endKm - b.startKm > 600) return bad("endKm", "That is more than 600 km in one trip. Check the meter readings.");
    if (!int(b.ridersPresent) || b.ridersPresent < 0) return bad("ridersPresent", "Enter how many were on board.");
    if (b.ridersPresent > v.capacity) return bad("ridersPresent", `${v.regNo} has ${v.capacity} seats.`);
    if (b.direction === "OTHER" && (b.purpose ?? "").trim().length < 3) return bad("purpose", "Say what the trip was for.");
    const route = b.routeId ? trn.routes.find((r) => r.id === b.routeId && r.campus === campus) : undefined;
    const rec = { ...b, id: uid(`${campus}-trip`), campus, routeId: route?.id ?? null, purpose: b.direction === "PICKUP" ? "Morning pickup" : b.direction === "DROP" ? "Afternoon drop" : b.purpose.trim(), driverName: (b.driverName ?? "").trim() || v.driverName, note: (b.note ?? "").trim() };
    trnStore.set((s) => ({ ...s, trips: [...s.trips, rec], vehicles: s.vehicles.map((x) => (x.id === v.id && b.endKm > x.odometer ? { ...x, odometer: b.endKm } : x)) }));
    return HttpResponse.json(tripView(trnStore.get(), rec), { status: 201 });
  }),

  http.get("/api/transport/fuel", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = guard("transport.view", ctx.campus);
    if (user instanceof Response) return user;
    return HttpResponse.json(fuelViews(trnStore.get(), scopeOf(ctx), ctx.session));
  }),

  http.post("/api/transport/fuel", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = writeGuard("transport.manage", ctx);
    if (user instanceof Response) return user;
    const campus = ctx.campus as CampusCode;
    const b = (await request.json()) as { date: IsoDate; vehicleId: string; litres: number; amount: number; odometer: number; station: string; slipNo: string };
    const trn = trnStore.get();
    const v = trn.vehicles.find((x) => x.id === b.vehicleId && x.campus === campus);
    if (!v) return bad("vehicleId", "Choose the vehicle.");
    if (!b.date || b.date > TODAY || b.date < sessionStart(CURRENT_SESSION)) return bad("date", "The date must be in this session and not in the future.");
    if (typeof b.litres !== "number" || b.litres <= 0 || b.litres > 400) return bad("litres", "Enter the litres filled (up to 400).");
    if (!int(b.amount) || b.amount <= 0) return bad("amount", "Enter the amount paid in whole rupees.");
    const rate = b.amount / b.litres;
    if (rate < 150 || rate > 500) return bad("amount", `That is ${formatRs(Math.round(rate))} a litre. Check the litres and the amount.`);
    const lastOdo = Math.max(0, ...trn.fuel.filter((f) => f.vehicleId === v.id).map((f) => f.odometer));
    if (!int(b.odometer) || b.odometer <= lastOdo) return bad("odometer", `The last fill-up of ${v.regNo} was at ${lastOdo.toLocaleString("en-US")} km. Enter a higher meter reading.`);
    if ((b.slipNo ?? "").trim().length < 2) return bad("slipNo", "Enter the pump slip number.");
    const rec = { id: uid(`${campus}-fuel`), campus, date: b.date, vehicleId: v.id, litres: Math.round(b.litres * 10) / 10, amount: b.amount, odometer: b.odometer, station: (b.station ?? "").trim(), slipNo: b.slipNo.trim(), enteredBy: user.name };
    trnStore.set((s) => ({ ...s, fuel: [...s.fuel, rec], vehicles: s.vehicles.map((x) => (x.id === v.id && b.odometer > x.odometer ? { ...x, odometer: b.odometer } : x)) }));
    return HttpResponse.json(fuelViews(trnStore.get(), [campus], CURRENT_SESSION).find((f) => f.id === rec.id), { status: 201 });
  }),
];

async function saveVehicle(request: Request, id: string | null) {
  await latency();
  const ctx = ctxFrom(new URL(request.url));
  const trn = trnStore.get();
  const existing = id ? trn.vehicles.find((v) => v.id === id) : undefined;
  if (id && !existing) return fail(404, "NOT_FOUND", "This vehicle is no longer on record.");
  const user = writeGuard("transport.manage", existing ? ctxOf(existing.campus, request) : ctx);
  if (user instanceof Response) return user;
  const campus = existing?.campus ?? (ctx.campus as CampusCode);
  const b = (await request.json()) as Omit<Trn["vehicles"][number], "id" | "campus">;
  const regNo = (b.regNo ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2,4}-\d{1,4}$/.test(regNo)) return bad("regNo", "Use the number plate format, for example RYK-2231.");
  if (trn.vehicles.some((v) => v.campus === campus && v.id !== id && v.regNo === regNo)) return fail(409, "DUPLICATE", `${regNo} is already on the list.`, { field: "regNo" });
  if (!int(b.capacity) || b.capacity < 2 || b.capacity > 80) return bad("capacity", "Seats are 2 to 80.");
  if ((b.driverName ?? "").trim().length < 3) return bad("driverName", "Enter the driver's name.");
  const mob = (b.driverMobile ?? "").replace(/\D/g, "");
  if (!/^03\d{9}$/.test(mob)) return bad("driverMobile", "Enter the driver's mobile, for example 0301-2345678.");
  for (const [f, label] of [["fitnessExpiry", "fitness certificate"], ["insuranceExpiry", "insurance"], ["licenceExpiry", "driver's licence"], ["permitExpiry", "route permit"]] as const) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b[f] ?? "")) return bad(f, `Enter the date the ${label} runs out.`);
  }
  if (!int(b.odometer) || b.odometer < 0) return bad("odometer", "Enter the meter reading in km.");
  if (b.ownership === "CONTRACTED" && (b.contractor ?? "").trim().length < 3) return bad("contractor", "Enter the contractor's name.");
  if (existing) {
    const route = trn.routes.find((r) => r.vehicleId === existing.id && r.active);
    const n = route ? activeRiders(trn, route.id).length : 0;
    if (route && b.capacity < n) return fail(409, "TOO_SMALL", `Route ${route.code} has ${n} riders, more than ${b.capacity} seats. Move riders first.`, { field: "capacity" });
  }
  const rec = { ...b, id: existing?.id ?? uid(`${campus}-veh`), campus, regNo, driverName: b.driverName.trim(), contractor: b.ownership === "CONTRACTED" ? b.contractor.trim() : "" };
  trnStore.set((s) => ({ ...s, vehicles: existing ? s.vehicles.map((v) => (v.id === rec.id ? rec : v)) : [...s.vehicles, rec] }));
  return HttpResponse.json(vehicleView(trnStore.get(), rec), { status: existing ? 200 : 201 });
}

async function saveRoute(request: Request, id: string | null) {
  await latency();
  const ctx = ctxFrom(new URL(request.url));
  const trn = trnStore.get();
  const existing = id ? trn.routes.find((r) => r.id === id) : undefined;
  if (id && !existing) return fail(404, "NOT_FOUND", "This route is no longer on record.");
  const user = writeGuard("transport.manage", existing ? ctxOf(existing.campus, request) : ctx);
  if (user instanceof Response) return user;
  const campus = existing?.campus ?? (ctx.campus as CampusCode);
  const b = (await request.json()) as { code: string; name: string; vehicleId: string | null; fare: number; active: boolean; stops: Array<{ id?: string; name: string; pickupTime: string; dropTime: string; fare: number | null }> };
  const code = (b.code ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9-]{2,8}$/.test(code)) return bad("code", "Use a short code such as R-10.");
  if (trn.routes.some((r) => r.campus === campus && r.id !== id && r.code === code)) return fail(409, "DUPLICATE", `Route ${code} already exists.`, { field: "code" });
  if ((b.name ?? "").trim().length < 3) return bad("name", "Name the route by the areas it covers.");
  if (!int(b.fare) || b.fare < 0) return bad("fare", "Enter the monthly fare in whole rupees.");
  const stops = b.stops ?? [];
  if (stops.length === 0) return bad("stops", "Add at least one stop.");
  for (const [i, s] of stops.entries()) {
    if ((s.name ?? "").trim().length < 2) return bad(`stops.${i}.name`, "Enter the stop name.");
    if (!/^\d{2}:\d{2}$/.test(s.pickupTime)) return bad(`stops.${i}.pickupTime`, "Enter the pickup time, for example 07:05.");
    if (!/^\d{2}:\d{2}$/.test(s.dropTime)) return bad(`stops.${i}.dropTime`, "Enter the drop time, for example 13:50.");
    if (s.fare !== null && (!int(s.fare) || s.fare < 0)) return bad(`stops.${i}.fare`, "Enter the fare in whole rupees, or leave it empty for the route fare.");
  }
  if (b.vehicleId) {
    const v = trn.vehicles.find((x) => x.id === b.vehicleId && x.campus === campus);
    if (!v) return bad("vehicleId", "Choose a vehicle at this campus.");
    const other = trn.routes.find((r) => r.vehicleId === v.id && r.active && r.id !== id);
    if (other) return fail(409, "VEHICLE_BUSY", `${v.regNo} already runs route ${other.code}. Choose another vehicle, or free it from ${other.code} first.`, { field: "vehicleId" });
    if (existing) {
      const n = activeRiders(trn, existing.id).length;
      if (v.capacity < n) return fail(409, "TOO_SMALL", `${v.regNo} has ${v.capacity} seats but ${n} ride this route. Choose a bigger vehicle or move riders first.`, { field: "vehicleId" });
    }
  }
  const routeId = existing?.id ?? uid(`${campus}-rt`);
  const nextStops = stops.map((s) => ({ id: s.id && existing?.stops.some((x) => x.id === s.id) ? s.id : uid(`${routeId}-st`), name: s.name.trim(), pickupTime: s.pickupTime, dropTime: s.dropTime, fare: s.fare }));
  if (existing) {
    const kept = new Set(nextStops.map((s) => s.id));
    const orphan = existing.stops.find((s) => !kept.has(s.id) && activeRiders(trn, existing.id).some((r) => r.stopId === s.id));
    if (orphan) {
      const n = activeRiders(trn, existing.id).filter((r) => r.stopId === orphan.id).length;
      return fail(409, "STOP_IN_USE", `${n} ${n === 1 ? "rider gets" : "riders get"} on at ${orphan.name}. Move them to another stop first.`, { field: "stops" });
    }
    if (b.active === false && activeRiders(trn, existing.id).length) return fail(409, "ROUTE_IN_USE", `${activeRiders(trn, existing.id).length} riders still use ${existing.code}. Move them before closing the route.`, { field: "active" });
  }
  const rec = { id: routeId, campus, code, name: b.name.trim(), vehicleId: b.vehicleId, fare: b.fare, stops: nextStops, active: b.active !== false };
  trnStore.set((s) => ({ ...s, routes: existing ? s.routes.map((r) => (r.id === routeId ? rec : r)) : [...s.routes, rec] }));
  return HttpResponse.json(routeView(trnStore.get(), rec), { status: existing ? 200 : 201 });
}

/* ================================================================================================ Snapshots for the report centre */

// Read-only views of the live stores, so the report centre shows the same books, stock and riders as the module
// pages (and changes made in the demo). Nothing here writes.

export function librarySnapshot(campuses: CampusCode[]) {
  const lib = libStore.get();
  const shelves = shelfMap(lib);
  return {
    titles: lib.titles.filter((t) => campuses.includes(t.campus)).map((t) => titleView(lib, t, shelves)),
    copies: copyRows(lib, campuses),
    loans: lib.loans.filter((l) => campuses.includes(l.campus)).map((l) => loanView(lib, l)),
    cabinets: lib.cabinets.filter((c) => campuses.includes(c.campus)).map((c) => ({ id: c.id, campus: c.campus, code: c.code, title: c.title, libraryId: c.libraryId })),
    libraries: lib.libraries.filter((l) => campuses.includes(l.campus)).map((l) => ({ id: l.id, campus: l.campus, name: l.name })),
    categories: lib.categories.map((c) => ({ id: c.id, name: c.name })),
  };
}

export function warehouseSnapshot(campuses: CampusCode[]) {
  const wh = whStore.get();
  const bals = balances(wh);
  return {
    items: wh.items.filter((i) => campuses.includes(i.campus)).map((i) => itemView(wh, i, bals)),
    /** Ledger rows (oldest first). */
    moves: wh.moves.filter((m) => campuses.includes(m.campus)).map((m) => ({ campus: m.campus, itemId: m.itemId, date: m.date, type: m.type, qtyIn: m.qtyIn, qtyOut: m.qtyOut, unitCost: m.unitCost })),
    issues: wh.issues.filter((i) => campuses.includes(i.campus)).map((i) => issueView(wh, i)),
    grns: wh.grns.filter((g) => campuses.includes(g.campus)).map((g) => grnView(wh, g)),
    departments: wh.departments.filter((d) => campuses.includes(d.campus)).map((d) => ({ id: d.id, campus: d.campus, name: d.name, rooms: d.rooms.map((r) => ({ ...r })) })),
    roomStock: roomStock(wh, campuses),
  };
}

export function transportSnapshot(campuses: CampusCode[], session: number) {
  const trn = trnStore.get();
  return {
    vehicles: trn.vehicles.filter((v) => campuses.includes(v.campus)).map((v) => vehicleView(trn, v)),
    routes: trn.routes.filter((r) => campuses.includes(r.campus)).map((r) => routeView(trn, r)),
    riders: trn.riders.filter((r) => campuses.includes(r.campus)).map((r) => riderView(trn, r)),
    trips: trn.trips.filter((t) => campuses.includes(t.campus)).map((t) => tripView(trn, t)),
    fuel: fuelViews(trn, campuses, session),
  };
}

export const operationsHandlers: HttpHandler[] = [...libraryHandlers, ...warehouseHandlers, ...transportHandlers];
