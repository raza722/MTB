// The fictional library the report centre still reads (no routes). The library itself and the shared people search
// (/api/library/*, /api/operations/people) are real now: their requests fall through to the backend. librarySnapshot
// stays until the report centre moves to the real API (module 13); studentPerson / staffPerson / personOf stay while the
// report centre's fictional loans and transport riders (transport-model.ts) still look people up in the fixtures.
import {
  type CampusCode,
  type LibraryCopyRow,
  type LibraryFinePolicy,
  type LibraryLoan,
  type LibraryTitle,
  type OperationsPerson,
  type OperationsPersonType,
} from "@mtb/api";
import { daysBetween } from "@mtb/domain";
import { DEMO_TODAY } from "../clock";
import { createStore } from "../db";
import { initialLibrary, OPS_STAFF, type LibLoanRec, type LibTitleRec } from "../fixtures/operations";
import { findStudent } from "../fixtures/students";

const libStore = createStore("operations.library.v2", initialLibrary);
const TODAY = DEMO_TODAY;

/** "Teaching", "Non-teaching" or "Management" from a staff member's post. */
export function staffGroupOf(detail: string): string {
  const d = detail.toLowerCase();
  if (/principal|director|coordinator|head of/.test(d)) return "Management";
  if (/teacher|qari|lecturer|instructor/.test(d)) return "Teaching";
  return "Non-teaching";
}

/* ================================================================================================ People */

export function studentPerson(grNo: string): OperationsPerson | null {
  const s = findStudent(grNo);
  if (!s) return null;
  return { id: s.grNo, type: "STUDENT", name: s.name, detail: s.classSection, father: s.father, relation: s.relation, mobile: s.guardian.mobile, campus: s.campus, active: s.status === "ACTIVE" };
}
export function staffPerson(id: string): OperationsPerson | null {
  const s = OPS_STAFF.find((x) => x.id === id);
  return s ? { id: s.id, type: "STAFF", name: s.name, detail: s.detail, father: "", relation: "", mobile: s.mobile, campus: s.campus, active: true } : null;
}
export const personOf = (type: OperationsPersonType, id: string) => (type === "STUDENT" ? studentPerson(id) : staffPerson(id));

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

/** Read-only view of the fictional library for the report centre. Nothing here writes. */
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
