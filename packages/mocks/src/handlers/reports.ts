// Report centre, background report jobs, scheduled reports, staff notifications (the bell) and notices.
import {
  ACCOUNTS_STATUS_LABEL,
  ACCOUNTS_VOUCHER_TYPE_LABEL,
  ADMISSIONS_STAGE_LABEL,
  can,
  clockTime,
  periodsInWeek,
  periodTime,
  scheduleOf,
  streamShort,
  TIMETABLE_DAYS,
  PAYMENT_METHOD_LABEL,
  REPORT_SUBTOTAL_KEY,
  type CampusCode,
  type CampusScope,
  type Notice,
  type NoticeInput,
  type ReportCatalogue,
  type ReportCell,
  type ReportColumnDef,
  type ReportDefinition,
  type ReportFilterValues,
  type ReportFormat,
  type ReportJob,
  type ReportResult,
  type ReportRunRequest,
  type ReportSchedule,
  type ReportScheduleInput,
  type SessionUser,
  type SmsAudience,
  type StaffNotification,
  smsMaskMobile,
} from "@mtb/api";
import { daysBetween, formatDate, formatMobile, formatSession, maskCnic, type IsoDate } from "@mtb/domain";
import { http } from "msw";
import { DEMO_TODAY, demoNow } from "../clock";
import { createStore } from "../db";
import { pastMark, registersFor, registerSections, rosterFor, type RosterEntry } from "../fixtures/attendance";
import { campusName } from "../fixtures/campuses";
import { CONCESSION_TYPES } from "../fixtures/fee-setup";
import { noticesStore } from "../fixtures/notices";
import { DEFAULT_FAVOURITES, hashStr, pick, rand01, REPORT_DEFINITIONS, reportById, staffOf } from "../fixtures/reports";
import { FAMILIES } from "../fixtures/sms";
import { groupsOfClass, seatsFor, setupSectionOf, subjectsOfGroup } from "../fixtures/student-records";
import { findStudent, STUDENTS } from "../fixtures/students";
import { ctxFrom, fail, HttpResponse, latency, requirePermission, requireUser } from "../util";
import { accountsReportBook, accountsReportIncomeExpenditure, accountsReportTrialBalance, accountsReportVouchers } from "./accounts";
import { chargesOf, feesStore, receiptsOf } from "./fees-state";
import { feeCandidateRows, feeClassArrears, feeCollectionRows, feeConcessionSummary, feeDefaulterRows, feeHeadByCode, headCodeOf } from "./fee-setup";
import { librarySnapshot, transportSnapshot, warehouseSnapshot } from "./operations";
import { examReportGenerators, liveExamDefinition } from "./reports-exams";
import { genderOfName, outboxSnapshot, queueBatch, rosterPeople } from "./sms";
import { admissionsSeats, admissionsStore } from "./admissions";
import { allMovements, sessionOfDate, streamFor } from "./student-records-model";
import { portalFamilies } from "./portal";
import { timetableReportBoard } from "./timetable";

const ALL: CampusCode[] = ["KC", "SM", "UC", "MC", "HC"];
const campusesOf = (scope: CampusScope): CampusCode[] => (scope === "ALL" ? ALL : [scope]);
/** Back from the campus list to the scope (every campus = All campuses). */
const scopeOf = (campuses: CampusCode[]): CampusScope => (campuses.length === 1 ? campuses[0]! : "ALL");
const ON_SCREEN_LIMIT = 5000;

// ---------------------------------------------------------------------------------------------------
// Small date helpers
// ---------------------------------------------------------------------------------------------------

const addDays = (d: IsoDate, n: number): IsoDate => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const weekday = (d: IsoDate) => new Date(`${d}T00:00:00Z`).getUTCDay();
/** School days: not Sunday, not the summer vacation (June–July). */
const isSchoolDay = (d: IsoDate) => weekday(d) !== 0 && !(d >= "2026-06-01" && d <= "2026-07-31");
function daysBetweenIncl(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}
const monthEnd = (m: string): IsoDate => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthLabel = (m: string) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const round = (n: number, step = 1) => Math.round(n / step) * step;
const pct1 = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

// ---------------------------------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------------------------------

function resolveFilters(def: ReportDefinition, given: ReportFilterValues): ReportFilterValues {
  const out: ReportFilterValues = {};
  for (const f of def.filters) {
    let v = given[f.key] ?? f.default ?? "";
    v = v.replace("monthStart", `${DEMO_TODAY.slice(0, 7)}-01`).replace(/today/g, DEMO_TODAY);
    out[f.key] = v;
  }
  return out;
}

function validate(def: ReportDefinition, f: ReportFilterValues, scope: CampusScope): Response | null {
  if (def.singleCampus && scope === "ALL") return fail(422, "SINGLE_CAMPUS", "This report is for one campus. Choose a campus at the top of the page.");
  for (const d of def.filters) {
    const v = f[d.key] ?? "";
    if (d.required && !v) return fail(422, "VALIDATION", `Choose ${d.label.toLowerCase()}.`, { field: d.key });
    if (d.kind === "dateRange") {
      const [from = "", to = ""] = v.split("|");
      if (!from || !to) return fail(422, "VALIDATION", "Choose both dates.", { field: d.key });
      if (from > to) return fail(422, "VALIDATION", "The first date must be on or before the second.", { field: d.key });
      if (to > DEMO_TODAY) return fail(422, "VALIDATION", `Choose dates up to today (${formatDate(DEMO_TODAY)}).`, { field: d.key });
      if (daysBetween(from, to) > 366) return fail(422, "VALIDATION", "Choose a period of one year or less.", { field: d.key });
    }
    if (d.kind === "date" && v > DEMO_TODAY && !d.allowFuture) return fail(422, "VALIDATION", `Choose today (${formatDate(DEMO_TODAY)}) or an earlier date.`, { field: d.key });
    if (d.kind === "number" && v && !/^\d+$/.test(v)) return fail(422, "VALIDATION", `${d.label}: enter a whole number.`, { field: d.key });
  }
  return null;
}

/** For schedules: "today" means the day it runs. */
function describeSchedule(def: ReportDefinition, raw: ReportFilterValues): string {
  const parts: string[] = [];
  for (const d of def.filters) {
    const v = raw[d.key] ?? d.default ?? "";
    if (d.kind === "date" && (v === "today" || !v)) parts.push("The day it runs");
    else if (d.kind === "dateRange" && /today/.test(v)) parts.push(v.startsWith("monthStart") ? "Month to date" : "Up to the day it runs");
    else parts.push(...describeFilters({ ...def, filters: [d] }, resolveFilters({ ...def, filters: [d] }, raw)));
  }
  return parts.join(" · ") || "Default filters";
}

function describeFilters(def: ReportDefinition, f: ReportFilterValues): string[] {
  const parts: string[] = [];
  for (const d of def.filters) {
    const v = f[d.key];
    if (!v) continue;
    if (d.kind === "dateRange") {
      const [from = "", to = ""] = v.split("|");
      parts.push(from === to ? formatDate(from) : `${formatDate(from)} to ${formatDate(to)}`);
    } else if (d.kind === "date") parts.push(`${d.label === "Date" ? "" : `${d.label} `}${formatDate(v)}`);
    else if (d.kind === "month") parts.push(monthLabel(v));
    else if (d.kind === "class") parts.push(v === "Prep" ? "Prep" : `Class ${v}`);
    else if (d.kind === "section") parts.push(`Section ${v}`);
    else if (d.kind === "classSection") parts.push(`Class ${v}`);
    else if (d.kind === "gender") parts.push(v === "F" ? "Girls" : "Boys");
    else if (d.kind === "select") parts.push(d.options?.find((o) => o.value === v)?.label ?? v);
    else parts.push(`${d.label}: ${v}`);
  }
  return parts;
}

// ---------------------------------------------------------------------------------------------------
// Fictional data shared by several reports
// ---------------------------------------------------------------------------------------------------

type Row = Record<string, ReportCell>;
interface Gen {
  campuses: CampusCode[];
  session: number;
  f: ReportFilterValues;
  user: SessionUser;
}
interface GenOut {
  rows: Row[];
  columns?: ReportColumnDef[];
  notes?: string[];
  /** Added to the subtitle after the filters, e.g. "187 students". */
  subtitle?: string[];
}

const sectionsFor = (campus: CampusCode, f: ReportFilterValues) =>
  registerSections(campus).filter((cs) => (!f.class || cs.startsWith(`${f.class}-`)) && (!f.section || cs.endsWith(`-${f.section}`)));

function genderOf(e: RosterEntry): "F" | "M" {
  if (e.hasProfile) return findStudent(e.grNo)?.gender ?? "M";
  return genderOfName(e.name);
}

const AREAS = ["Model Town", "Satellite Town", "Sugar Mill Colony", "Bhong Road", "Gulshan-e-Iqbal", "Rahim Yar Khan Road", "Ghalla Mandi", "Railway Colony"];
const fakeAddress = (key: string, city = "Sadiqabad") => `House ${1 + (hashStr(key) % 140)}, Street ${1 + (hashStr(`${key}s`) % 18)}, ${pick(AREAS, key)}, ${city}`;
const fakeDob = (key: string, classShort: string) => {
  const n = classShort === "Prep" ? 0 : Number(classShort);
  const y = 2026 - 5 - n - (rand01(`${key}:y`) < 0.25 ? 1 : 0);
  return `${y}-${String(1 + (hashStr(`${key}m`) % 12)).padStart(2, "0")}-${String(1 + (hashStr(`${key}d`) % 28)).padStart(2, "0")}`;
};
const classOf = (cs: string) => cs.split("-")[0] ?? "";

/** Student records admitted between two dates at these campuses (new admissions). */
const newAdmissionsIn = (campuses: CampusCode[], from: string, to: string) => STUDENTS.filter((s) => !s.mergedInto && campuses.includes(s.campus) && s.admissionDate >= from && s.admissionDate <= to && s.admissionDate <= DEMO_TODAY);
/** The application a student was admitted from, if any. */
const admittedApplicant = (grNo: string) => admissionsStore.get().applicants.find((a) => a.grNo === grNo);
const formatCnicDigits = (d: string) => (/^\d{13}$/.test(d) ? `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}` : d);
const CITY: Record<CampusCode, string> = { KC: "Sadiqabad", SM: "Sadiqabad", UC: "Sadiqabad", MC: "Sadiqabad", HC: "Lahore" };

/** Receipts posted at these campuses in a period (the fee office's collection report reads the same rows); cancelled ones left out. */
const liveReceipts = (campuses: CampusCode[], from: IsoDate, to: IsoDate) => campuses.flatMap((c) => feeCollectionRows(c, from, to)).filter((r) => r.status !== "CANCELLED");

// Exam reports read the exams store (handlers/reports-exams.ts): no marks of their own.

function studentsOf(campus: CampusCode, f: ReportFilterValues) {
  return sectionsFor(campus, f).flatMap((cs) => rosterFor(campus, cs).map((e) => ({ ...e, classSection: cs, gender: genderOf(e) })));
}

// ---------------------------------------------------------------------------------------------------
// Generators, one per report
// ---------------------------------------------------------------------------------------------------

const GENERATORS: Record<string, (g: Gen) => GenOut> = {
  // ---------- Fees ----------
  "fee-daily-summary": ({ campuses, f }) => {
    // Live: the day's receipts by cashier and payment method.
    const rows: Row[] = [];
    for (const campus of campuses) {
      const by = new Map<string, Row & { receipts: number; cash: number; bank: number; cheque: number; online: number; total: number }>();
      for (const r of liveReceipts([campus], f.date!, f.date!)) {
        const g = by.get(r.cashier) ?? { campus, cashier: r.cashier, receipts: 0, cash: 0, bank: 0, cheque: 0, online: 0, total: 0 };
        g.receipts += 1;
        if (r.method === "CASH") g.cash += r.amount;
        else if (r.method === "BANK") g.bank += r.amount;
        else if (r.method === "CHEQUE") g.cheque += r.amount;
        else g.online += r.amount;
        g.total += r.amount;
        by.set(r.cashier, g);
      }
      rows.push(...[...by.values()].sort((a, b) => b.total - a.total));
    }
    return { rows, notes: rows.length ? [] : ["No fees were collected on this day (Sunday, a holiday or the summer vacation)."] };
  },
  "fee-collection-period": ({ campuses, f }) => {
    // Live: receipts per day, with a running total.
    const [from = "", to = ""] = f.range!.split("|");
    const byDay = new Map<string, { receipts: number; amount: number }>();
    for (const r of liveReceipts(campuses, from, to)) {
      const d = r.at.slice(0, 10);
      const g = byDay.get(d) ?? { receipts: 0, amount: 0 };
      g.receipts += 1;
      g.amount += r.amount;
      byDay.set(d, g);
    }
    let running = 0;
    const rows: Row[] = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, g]) => {
        running += g.amount;
        return { date, receipts: g.receipts, amount: g.amount, running };
      });
    return { rows };
  },
  "fee-collection-heads": ({ campuses, f }) => {
    // Live: every receipt in the period (the fee office's own collection report reads the same rows).
    const [from = "", to = ""] = f.range!.split("|");
    const live = campuses
      .flatMap((c) => feeCollectionRows(c, from, to))
      .filter((r) => r.status !== "CANCELLED")
      .filter((r) => !f.gender || r.gender === f.gender)
      .filter((r) => !f.class || classOf(r.classSection) === f.class)
      .filter((r) => !f.section || r.classSection.endsWith(`-${f.section}`));
    if (f.mode === "STUDENTS") {
      if (!f.head) throw new ReportError("Choose the fee head to list the students who paid it.", "head");
      const paidHead = (r: (typeof live)[number]) => r.lines.filter((l) => l.head === f.head).reduce((a, l) => a + l.amount, 0);
      const list = live.filter((r) => paidHead(r) > 0).sort((a, b) => a.at.localeCompare(b.at) || a.classSection.localeCompare(b.classSection, "en", { numeric: true }));
      return {
        rows: list.slice(0, ON_SCREEN_LIMIT).map((r) => ({ campus: r.campus, grNo: r.grNo, student: r.studentName, classSection: r.classSection, date: r.at.slice(0, 10), receiptNo: r.receiptNo, amount: paidHead(r) })),
        columns: [
          { key: "grNo", label: "G.R. No.", kind: "mono" },
          { key: "student", label: "Student" },
          { key: "classSection", label: "Class" },
          { key: "date", label: "Payment date", kind: "date" },
          { key: "receiptNo", label: "Receipt", kind: "mono" },
          { key: "amount", label: feeHeadByCode(f.head)?.title ?? "Amount", kind: "money", total: true },
        ].map((x) => ({ kind: "text" as const, ...x })) as ReportColumnDef[],
        notes: list.length > ON_SCREEN_LIMIT ? [`${list.length.toLocaleString("en-PK")} receipts; the first ${ON_SCREEN_LIMIT.toLocaleString("en-PK")} are shown on screen.`] : [],
      };
    }
    const m = new Map<string, { head: string; receipts: Set<string>; amount: number }>();
    const add = (key: string, title: string, receiptNo: string, amount: number) => {
      if (amount <= 0) return;
      const g = m.get(key) ?? { head: title, receipts: new Set<string>(), amount: 0 };
      g.receipts.add(receiptNo);
      g.amount += amount;
      m.set(key, g);
    };
    for (const r of live) {
      for (const l of r.lines) {
        if (!f.head || l.head === f.head) add(l.head, l.headTitle, r.receiptNo, l.amount);
        if (!f.head) add("LATE_FINE", "Late fines", r.receiptNo, l.fine);
      }
    }
    const total = [...m.values()].reduce((a, g) => a + g.amount, 0);
    return {
      rows: [...m.values()].sort((a, b) => b.amount - a.amount).map((g) => ({ head: g.head, receipts: g.receipts.size, amount: g.amount, share: total ? Math.round((g.amount / total) * 1000) / 10 : 0 })),
      notes: m.size ? [] : ["Nothing was collected under this head in the period."],
    };
  },
  "fee-class-wise": ({ campuses, f, session }) => {
    // Live: charges falling due in the month on each student's ledger, and what has been paid against them.
    const month = f.month!;
    const head = f.head ?? "";
    const cs = f.class && f.section ? `${f.class}-${f.section}` : "";
    const students = f.mode === "STUDENTS";
    if (students && !cs) throw new ReportError("Choose the class and the section to list its students.", f.class ? "section" : "class");
    const groups = new Map<string, Row & { students: number; billed: number; collected: number }>();
    const rows: Row[] = [];
    for (const s of STUDENTS) {
      if (s.mergedInto || s.status !== "ACTIVE" || !campuses.includes(s.campus)) continue;
      if (cs && s.classSection !== cs) continue;
      if (f.class && classOf(s.classSection) !== f.class) continue;
      const charges = chargesOf(s.grNo).filter((c) => c.session === session && c.status !== "CANCELLED" && c.dueDate.slice(0, 7) === month && (!head || (c.headCode ?? headCodeOf(c.head)) === head));
      const billed = charges.reduce((a, c) => a + c.amount, 0);
      const collected = charges.reduce((a, c) => a + (c.status === "SETTLED" ? c.amount : c.settledAmount), 0);
      if (students) {
        rows.push({ campus: s.campus, grNo: s.grNo, student: s.name, father: s.father, billed, collected, outstanding: billed - collected, status: billed === 0 ? "Nothing due" : collected >= billed ? "Paid" : collected > 0 ? "Part paid" : "Unpaid" });
        continue;
      }
      const key = `${s.campus}|${s.classSection}`;
      const g = groups.get(key) ?? { campus: s.campus, classSection: s.classSection, students: 0, billed: 0, collected: 0 };
      g.students += 1;
      g.billed += billed;
      g.collected += collected;
      groups.set(key, g);
    }
    if (students) {
      rows.sort((a, b) => String(a.student).localeCompare(String(b.student)));
      return {
        rows,
        columns: [
          { key: "grNo", label: "G.R. No.", kind: "mono" },
          { key: "student", label: "Student", kind: "text" },
          { key: "father", label: "Father", kind: "text" },
          { key: "billed", label: "Billed", kind: "money", total: true },
          { key: "collected", label: "Paid", kind: "money", total: true },
          { key: "outstanding", label: "Unpaid", kind: "money", total: true },
          { key: "status", label: "Status", kind: "status" },
        ],
      };
    }
    const out = [...groups.values()]
      .sort((a, b) => String(a.classSection).localeCompare(String(b.classSection), "en", { numeric: true }))
      .map((g) => ({ ...g, outstanding: g.billed - g.collected, percent: pct1(g.collected, g.billed) }));
    const current = month === DEMO_TODAY.slice(0, 7);
    return {
      rows: out,
      notes: [
        ...(current ? [`${monthLabel(month)} fees are due on the 10th, so part of the month may still be collected.`] : []),
        ...(out.every((r) => r.billed === 0) ? ["No charges fell due in this month for the chosen head. Months before August 2026 were carried over from the old system as totals."] : []),
      ],
    };
  },
  "fee-student-arrears": ({ campuses, f }) => {
    const min = Number(f.minAmount || 0);
    const rows: Row[] = [];
    for (const campus of campuses) {
      for (const p of rosterPeople(campus, sectionsFor(campus, f))) {
        if (p.overdueAmount <= 0 || p.overdueAmount <= min) continue;
        rows.push({ campus, grNo: p.grNo, student: p.name, father: p.guardian, classSection: p.classSection, mobile: formatMobile(p.mobile), oldestDue: p.oldestDue ?? null, days: p.daysOverdue, arrears: p.overdueAmount });
      }
    }
    rows.sort((a, b) => Number(b.arrears) - Number(a.arrears));
    return { rows };
  },
  "fee-class-arrears": ({ campuses, f, session }) => {
    // Live: billed and paid to date per class-section, and what is overdue (the fee office's arrears page reads the same).
    const rows: Row[] = [];
    const filter = { ...(f.head ? { heads: [f.head] } : {}), ...(f.class ? { classShort: f.class } : {}) };
    for (const campus of campuses) {
      const ca = feeClassArrears(campus, session, filter);
      const owing = feeDefaulterRows(campus, session, false, filter);
      for (const r of ca.rows) {
        if (r.billed === 0 && r.arrears === 0) continue;
        const over30 = owing.filter((d) => d.classSection === r.classSection && d.daysOverdue > 30).reduce((a, d) => a + d.outstanding, 0);
        rows.push({ campus, classSection: r.classSection, strength: r.strength, students: r.students, billed: r.billed, paid: r.paid, arrears: r.arrears, percent: r.pct, over30 });
      }
    }
    return { rows };
  },
  "fee-defaulters": ({ campuses, f }) => {
    const minDays = Number(f.minDays || 0);
    const minAmount = Number(f.minAmount || 0);
    const rows: Row[] = [];
    for (const campus of campuses) {
      for (const p of rosterPeople(campus, sectionsFor(campus, f))) {
        if (!(p.daysOverdue > minDays && p.overdueAmount > minAmount)) continue;
        rows.push({ campus, grNo: p.grNo, student: p.name, classSection: p.classSection, guardian: p.guardian, mobile: formatMobile(p.mobile), days: p.daysOverdue, amount: p.overdueAmount });
      }
    }
    rows.sort((a, b) => Number(b.days) - Number(a.days) || Number(b.amount) - Number(a.amount));
    return { rows };
  },
  "fee-cancellations": ({ campuses, f }) => {
    const [from = "", to = ""] = f.range!.split("|");
    const rows: Row[] = [];
    for (const r of Object.values(feesStore.get().receipts)) {
      if (!r.cancellation || !campuses.includes(r.campus)) continue;
      const day = r.cancellation.requestedAt.slice(0, 10);
      if (day < from || day > to) continue;
      rows.push({ campus: r.campus, cnNo: r.cancellation.cnNo, receiptNo: r.receiptNo, student: r.studentName, amount: r.total, requestedBy: r.cancellation.requestedBy, decidedBy: r.cancellation.decidedBy ?? "—", reason: r.cancellation.note || r.cancellation.reason, status: r.cancellation.status === "APPROVED" ? "Approved" : r.cancellation.status === "REJECTED" ? "Not approved" : "Waiting" });
    }
    // Live only: the same cancellations the principal decides on the dashboard and Accounts reverses in the ledger.
    rows.sort((x, y) => String(x.cnNo).localeCompare(String(y.cnNo)));
    return { rows, notes: rows.length ? [] : ["No receipt was cancelled in this period."] };
  },
  "fee-concessions": ({ campuses, f, session }) => {
    // Live: approved concessions from the fee office, with the same kinds and the session fee they reduce.
    const rows: Row[] = [];
    const title = (t: string) => CONCESSION_TYPES.find((x) => x.code === t)?.title ?? t;
    for (const campus of campuses) {
      const sum = feeConcessionSummary(campus, session, `${session}-04-01`, `${session + 1}-03-31`, { ...(f.class ? { classes: [f.class] } : {}), ...(f.section ? { section: f.section } : {}) });
      for (const s of sum.students) {
        if (f.type && s.type !== f.type) continue;
        rows.push({ campus, grNo: s.grNo, student: s.studentName, father: s.father, classSection: s.classSection, type: `${title(s.type)}${s.reference ? ` (${s.reference})` : ""}`, percent: s.pct, sessionFee: s.sessionFee, concession: s.concession, payable: s.payable });
      }
    }
    return { rows, notes: rows.length ? [] : ["No approved concession runs this session for the chosen class and kind."] };
  },
  "fee-concessions-class": ({ campuses, f, session }) => {
    // Live: the fee office's class summary (Concessions → By class) for the period.
    const [from = "", to = ""] = f.range!.split("|");
    const start = `${session}-04-01`;
    const end = `${session + 1}-03-31`;
    const lo = from < start ? start : from;
    const hi = to > end ? end : to;
    if (lo > hi) throw new ReportError(`Choose dates inside ${formatSession(session)}.`, "range");
    const rows: Row[] = [];
    for (const campus of campuses) {
      const sum = feeConcessionSummary(campus, session, lo, hi, f.class ? { classes: [f.class] } : {});
      for (const r of sum.byClass) rows.push({ campus, className: r.className, strength: r.strength, students: r.students, billed: r.billed, discount: r.discount, remaining: r.remaining, percent: r.pct });
    }
    return { rows, notes: ["Total amount: tuition and other heads a concession can reduce, falling due in the period. Discount: approved concessions."] };
  },
  "fee-student-ledger": ({ f, user, session }) => {
    const s = findStudent(f.grNo ?? "");
    if (!s) throw new ReportError(`No student has G.R. number ${f.grNo}. Check the number, for example KC-14823.`, "grNo");
    if (!can(user, "fees.view", s.campus)) throw new ReportError(`${s.name} is at ${s.campusName}, which your role can't see.`, "grNo");
    type Ev = { date: IsoDate; description: string; reference: string; charged: number; paid: number };
    const ev: Ev[] = [];
    for (const c of chargesOf(s.grNo)) if (c.status !== "CANCELLED" && c.session === session) ev.push({ date: addDays(c.dueDate, -10), description: c.head, reference: `Due ${formatDate(c.dueDate)}`, charged: c.amount, paid: 0 });
    for (const r of receiptsOf(s.grNo)) {
      if (r.session !== session) continue;
      const fine = r.lines.reduce((a, l) => a + l.lateFine, 0);
      if (fine) ev.push({ date: r.postedAt.slice(0, 10), description: "Late fine", reference: r.receiptNo, charged: fine, paid: 0 });
      ev.push({ date: r.postedAt.slice(0, 10), description: r.status === "CANCELLED" ? "Receipt (cancelled)" : "Payment received", reference: r.receiptNo, charged: 0, paid: r.status === "CANCELLED" ? 0 : r.total });
    }
    ev.sort((a, b) => a.date.localeCompare(b.date) || b.charged - a.charged);
    let bal = 0;
    return {
      rows: ev.map((e) => {
        bal += e.charged - e.paid;
        return { ...e, balance: bal };
      }),
      notes: [`${s.name} ${s.relation} ${s.father} · ${s.classSection} · ${s.campusName}. Balance today: Rs ${bal.toLocaleString("en-PK")}.`],
    };
  },
  "fee-candidate": ({ campuses, f, session }) => {
    // Live: candidate fees received at the fee office, grouped by cashier with a subtotal each.
    const [from = "", to = ""] = f.range!.split("|");
    const paid = (lines: Array<{ head: string; paid: number }>, h: string) => lines.find((l) => l.head === h)?.paid ?? 0;
    const list = campuses
      .flatMap((campus) => feeCandidateRows(campus, session).map((c) => ({ campus, c })))
      .filter(({ c }) => c.status === "PAID" && c.paidOn !== undefined && c.paidOn >= from && c.paidOn <= to && (!f.cashier || c.receivedBy === f.cashier))
      .sort((a, b) => (a.c.receivedBy ?? "").localeCompare(b.c.receivedBy ?? "") || (a.c.paidOn ?? "").localeCompare(b.c.paidOn ?? "") || (a.c.receiptNo ?? "").localeCompare(b.c.receiptNo ?? ""));
    const rows: Row[] = [];
    let group: string | null = null;
    let acc = { n: 0, test: 0, prospectus: 0, form: 0, total: 0, amount: 0 };
    const close = () => {
      if (group === null || acc.n === 0) return;
      rows.push({ [REPORT_SUBTOTAL_KEY]: 1, cashier: `${group || "—"} · ${acc.n} candidates`, test: acc.test, prospectus: acc.prospectus, form: acc.form, total: acc.total, amount: acc.amount });
    };
    for (const { campus, c } of list) {
      const name = c.receivedBy ?? "";
      if (name !== group) {
        close();
        group = name;
        acc = { n: 0, test: 0, prospectus: 0, form: 0, total: 0, amount: 0 };
      }
      const row = { test: paid(c.lines, "CANDIDATE"), prospectus: paid(c.lines, "PROSPECTUS"), form: paid(c.lines, "FORM"), total: c.amount, amount: c.received };
      acc = { n: acc.n + 1, test: acc.test + row.test, prospectus: acc.prospectus + row.prospectus, form: acc.form + row.form, total: acc.total + row.total, amount: acc.amount + row.amount };
      rows.push({ campus, cashier: name, date: c.paidOn ?? null, receiptNo: c.receiptNo ?? "", formNo: c.applicationNo, candidate: c.name, classApplied: c.classApplied, ...row });
    }
    close();
    return { rows, notes: rows.length ? [] : ["No candidate fees were received in this period."] };
  },
  "fee-receipt-register": ({ campuses, f }) => {
    // Live: the same receipts as Fees → Reports → Daily collection, oldest first.
    const [from = "", to = ""] = f.range!.split("|");
    const all = campuses
      .flatMap((c) => feeCollectionRows(c, from, to))
      .filter((r) => (!f.class || classOf(r.classSection) === f.class) && (!f.section || r.classSection.endsWith(`-${f.section}`)))
      .sort((a, b) => a.at.localeCompare(b.at));
    const rows: Row[] = all.slice(0, ON_SCREEN_LIMIT).map((r) => ({
      campus: r.campus,
      date: r.at.slice(0, 10),
      receiptNo: r.receiptNo,
      grNo: r.grNo,
      student: r.studentName,
      classSection: r.classSection,
      heads: r.status === "CANCELLED" ? `${r.heads} (cancelled)` : r.heads,
      method: PAYMENT_METHOD_LABEL[r.method],
      cashier: r.cashier,
      fine: r.status === "CANCELLED" ? 0 : r.fine,
      amount: r.status === "CANCELLED" ? 0 : r.amount,
    }));
    return { rows, notes: all.length > rows.length ? [`${all.length.toLocaleString("en-PK")} receipts in this period. The first ${ON_SCREEN_LIMIT.toLocaleString("en-PK")} are shown on screen; the Excel file has every receipt.`] : [] };
  },

  // ---------- Students ----------
  // Parent-teacher meeting sign-off sheet: one section's register in name order, blank remark and signature columns.
  "students-ptm-sheet": ({ campuses, f }) => {
    const campus = campuses[0]!;
    const list = studentsOf(campus, { class: f.class ?? "", section: f.section ?? "" }).sort((a, b) => a.name.localeCompare(b.name));
    const rows: Row[] = list.map((s, i) => ({ sr: i + 1, grNo: s.grNo, student: s.name, father: s.father, gender: s.gender === "F" ? "Female" : "Male", teacherRemarks: "", parentRemarks: "", parentSign: "" }));
    return {
      rows,
      subtitle: [`${rows.length} ${rows.length === 1 ? "student" : "students"}`],
      ...(rows.length ? {} : { notes: ["This section has no students on its register. Check the class and section."] }),
    };
  },
  // Parent portal accounts: status only, never a password (families sign in with a one-time code).
  "portal-accounts": ({ campuses, f }) => {
    const families = portalFamilies();
    const rows: Row[] = [];
    for (const campus of campuses) {
      for (const s of studentsOf(campus, f)) {
        const rec = s.hasProfile ? findStudent(s.grNo) : undefined;
        const mobile = rec?.guardian.mobile ?? s.mobile ?? "";
        const family = families.find((x) => x.children.includes(s.grNo));
        const last = family?.lastSignInAt;
        const status = !mobile ? "Not set up" : last ? "Signed in" : "Never signed in";
        const code = !mobile ? "NOT_SET_UP" : last ? "SIGNED_IN" : "NEVER";
        if (f.status && f.status !== code) continue;
        rows.push({ campus, grNo: s.grNo, student: s.name, father: rec?.father ?? s.father, classSection: s.classSection, mobile: mobile ? smsMaskMobile(formatMobile(mobile)) : "", status, lastSignIn: last ? last.slice(0, 10) : null });
      }
    }
    const signedIn = rows.filter((r) => r.status === "Signed in").length;
    return {
      rows,
      subtitle: [`${rows.length} students`, `${signedIn} signed in`],
      notes: ["No passwords are kept or printed. A family signs in with the mobile number on the student's record and a one-time code sent to it. “Not set up” means there is no mobile number on record: update it in the student's profile."],
    };
  },
  "students-list": ({ campuses, f }) => {
    const rows = campuses.flatMap((campus) =>
      studentsOf(campus, f)
        .filter((s) => !f.gender || s.gender === f.gender)
        .map((s) => ({ campus, grNo: s.grNo, roll: s.rollNo, student: s.name, father: s.father, classSection: s.classSection, gender: s.gender === "F" ? "Girl" : "Boy", mobile: formatMobile(s.mobile) })),
    );
    // The printed register (Register Report) has an empty column for signatures or ticks.
    const blank = f.blank === "SIGNATURE" ? "Signature" : f.blank === "TICK" ? "Tick" : "";
    return { rows, ...(blank ? { columns: [...(reportById("students-list")?.columns ?? []), { key: "blank", label: blank, kind: "blank" as const }] } : {}) };
  },
  "students-group-wise": ({ campuses, f }) => {
    const cls = f.class ?? "";
    const groups = groupsOfClass(cls);
    if (!groups.length) throw new ReportError(`${cls === "Prep" ? "Prep" : `Class ${cls}`} has no groups. Choose a class with groups, such as Class 9 or 10.`, "class");
    if (f.group && !groups.includes(f.group)) throw new ReportError(`Class ${cls} has no group called ${f.group}.`, "group");
    const rows: Row[] = [];
    for (const campus of campuses)
      for (const s of studentsOf(campus, { class: cls })) {
        if (f.gender && s.gender !== f.gender) continue;
        const real = s.hasProfile ? findStudent(s.grNo) : undefined;
        const group = streamFor(s.grNo, s.classSection, real?.stream) ?? "";
        if (f.group && group !== f.group) continue;
        rows.push({ campus, sr: 0, grNo: s.grNo, student: s.name, marks: null, classSection: `Class ${cls}`, section: s.classSection.split("-")[1] ?? "", group, subjects: subjectsOfGroup(cls, group).join(", ") || "Not set in Setup → Subjects" });
      }
    rows.sort((a, b) => String(a.campus).localeCompare(String(b.campus)) || String(a.group).localeCompare(String(b.group)) || String(a.section).localeCompare(String(b.section)) || String(a.student).localeCompare(String(b.student)));
    rows.forEach((r, i) => (r.sr = i + 1));
    return { rows, subtitle: [`Total students: ${rows.length.toLocaleString("en-PK")}`] };
  },
  "students-strength": ({ campuses, session, f }) => {
    const rows: Row[] = [];
    for (const campus of campuses) {
      // Sections of each class in school order, then a total line for the class (Student Count Summary).
      const byClass = new Map<string, Row[]>();
      for (const r of registersFor(campus)) {
        const cls = classOf(r.classSection);
        if (f.class && cls !== f.class) continue;
        const roster = rosterFor(campus, r.classSection);
        const girls = roster.filter((e) => genderOf(e) === "F").length;
        const sec = setupSectionOf(campus, session, r.classSection);
        const seats = sec?.seats ?? seatsFor(cls);
        byClass.set(cls, [...(byClass.get(cls) ?? []), { campus, classSection: r.classSection, teacher: r.classTeacher, room: sec?.room ?? "", seats, boys: roster.length - girls, girls, total: roster.length, free: seats - roster.length }]);
      }
      for (const [cls, list] of byClass) {
        const sum = (k: string) => list.reduce((a, x) => a + Number(x[k] ?? 0), 0);
        rows.push(...list, {
          campus,
          classSection: `${cls === "Prep" ? "Prep" : `Class ${cls}`} total · ${list.length} ${list.length === 1 ? "section" : "sections"}`,
          teacher: "",
          room: "",
          seats: sum("seats"),
          boys: sum("boys"),
          girls: sum("girls"),
          total: sum("total"),
          free: sum("free"),
          [REPORT_SUBTOTAL_KEY]: 1,
        });
      }
    }
    return { rows };
  },
  "students-register": ({ campuses, f }) => {
    const rows: Row[] = [];
    const schools = ["The City School", "Allied School", "Government Primary School", "Dar-e-Arqam School", "Iqra Public School", "Govt. Girls High School"];
    const jobs = ["Shopkeeper", "Farmer", "Government job", "Teacher", "Driver", "Business", "Labourer", "Overseas"];
    const fakeCnic = (key: string) => `3130${String(hashStr(key) % 1_000_000_000).padStart(9, "0")}`;
    const inScope = (cs: string) => (!f.class || classOf(cs) === f.class) && (!f.section || cs.endsWith(`-${f.section}`));
    const push = (campus: CampusCode, e: { grNo: string; name: string; father: string; rollNo: number; mobile: string; classSection: string; gender: "F" | "M" }, real: (typeof STUDENTS)[number] | undefined) => {
      const cls = classOf(e.classSection);
      const roll = real?.boardRollNo;
      rows.push({
        campus,
        grNo: e.grNo,
        roll: real?.rollNo ?? e.rollNo,
        student: e.name,
        father: e.father,
        occupation: real ? (real.guardian.occupation ?? "") : pick(jobs, `${e.grNo}:job`),
        fatherCnic: maskCnic(real?.fatherCnic ?? fakeCnic(`${e.grNo}:f`)),
        gender: e.gender === "F" ? "Girl" : "Boy",
        dob: real?.dob ?? fakeDob(e.grNo, cls),
        bForm: real ? (real.bForm ? maskCnic(real.bForm) : "") : rand01(`${e.grNo}:bf`) < 0.15 ? "" : maskCnic(fakeCnic(`${e.grNo}:b`)),
        classSection: e.classSection,
        group: streamFor(e.grNo, e.classSection, real?.stream) ?? "",
        boardRoll: [roll?.partI, roll?.partII].filter(Boolean).join(" / "),
        admitted: real?.admissionDate ?? `${2026 - Math.floor(rand01(`${e.grNo}:adm`) * 6)}-04-0${1 + (hashStr(e.grNo) % 6)}`,
        previous: real ? (real.previousSchool ?? "") : cls === "Prep" ? "First school" : rand01(`${e.grNo}:ps`) < 0.35 ? "" : pick(schools, e.grNo),
        mobile: formatMobile(real?.guardian.mobile ?? e.mobile),
        address: real?.guardian.address || fakeAddress(e.grNo, CITY[campus]),
      });
    };
    let expelled = 0;
    let struck = 0;
    for (const campus of campuses) {
      // Enrolled students: the class registers (fixture students keep their own record).
      if (f.status !== "LEFT")
        for (const s of studentsOf(campus, f)) {
          if (f.gender && s.gender !== f.gender) continue;
          push(campus, s, s.hasProfile ? findStudent(s.grNo) : undefined);
        }
      // Left, struck off, expelled and passed out: from the student records.
      const inactive = STUDENTS.filter((s) => !s.mergedInto && s.status !== "ACTIVE" && s.campus === campus && inScope(s.classSection));
      if (f.status === "LEFT" || f.status === "ALL")
        for (const s of inactive) {
          if (f.gender && s.gender !== f.gender) continue;
          push(campus, { grNo: s.grNo, name: s.name, father: s.father, rollNo: s.rollNo, mobile: s.guardian.mobile, classSection: s.classSection, gender: s.gender }, s);
        }
      expelled += inactive.filter((s) => s.status === "EXPELLED").length;
      struck += inactive.filter((s) => s.status === "STRUCK_OFF").length;
    }
    const where = f.class ? ` in ${f.class === "Prep" ? "Prep" : `Class ${f.class}`}${f.section ? `-${f.section}` : ""}` : "";
    return { rows, notes: [`Total students${where}: ${rows.length.toLocaleString("en-PK")}. Expelled: ${expelled}. Struck off now: ${struck}.`] };
  },
  "students-new-admissions": ({ campuses, f }) => {
    // Live: student records admitted in the period (admissions office admits included), with the application's test.
    const [from = "", to = ""] = f.range!.split("|");
    const rows: Row[] = newAdmissionsIn(campuses, from, to)
      .filter((s) => (!f.class || classOf(s.classSection) === f.class) && (!f.section || s.classSection.endsWith(`-${f.section}`)) && (!f.gender || s.gender === f.gender))
      .map((s) => {
        const a = admittedApplicant(s.grNo);
        return {
          campus: s.campus,
          date: s.admissionDate,
          grNo: s.grNo,
          student: s.name,
          father: s.father,
          gender: s.gender === "F" ? "Girl" : "Boy",
          classSection: s.classSection,
          group: streamFor(s.grNo, s.classSection, s.stream) ?? "",
          mobile: formatMobile(s.guardian.mobile),
          basis: a ? (a.testScore !== null ? `Test ${a.testScore}/${a.testMax}` : "Interview") : "Admitted at the office",
          previous: s.previousSchool ?? a?.previousSchool ?? "",
        };
      });
    rows.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.classSection).localeCompare(String(b.classSection), undefined, { numeric: true }));
    const girls = rows.filter((r) => r.gender === "Girl").length;
    return { rows, notes: [`Total students: ${rows.length} (${rows.length - girls} boys, ${girls} girls).`] };
  },
  "students-new-admission-count": ({ campuses, f }) => {
    const [from = "", to = ""] = f.range!.split("|");
    const LEVEL = (cls: string) => (cls === "Prep" ? "Pre-primary" : Number(cls) <= 5 ? "Primary" : Number(cls) <= 8 ? "Middle" : "Secondary (Matric)");
    const counts = new Map<string, { level: string; cls: string; section: string; boys: number; girls: number }>();
    for (const s of newAdmissionsIn(campuses, from, to)) {
      const [cls = "", section = ""] = s.classSection.split("-");
      const k = `${s.campus}|${s.classSection}`;
      const c = counts.get(k) ?? { level: LEVEL(cls), cls, section, boys: 0, girls: 0 };
      if (s.gender === "F") c.girls++;
      else c.boys++;
      counts.set(k, c);
    }
    const order = (x: { cls: string }) => (x.cls === "Prep" ? 0 : Number(x.cls) || 99);
    const list = [...counts.values()].sort((a, b) => order(a) - order(b) || a.section.localeCompare(b.section));
    const rows: Row[] = [];
    let level = "";
    let sub = { boys: 0, girls: 0 };
    const close = () => {
      if (level) rows.push({ [REPORT_SUBTOTAL_KEY]: 1, level, className: `${level} total`, section: "", boys: sub.boys, girls: sub.girls, total: sub.boys + sub.girls });
    };
    for (const c of list) {
      if (c.level !== level) {
        close();
        level = c.level;
        sub = { boys: 0, girls: 0 };
      }
      sub.boys += c.boys;
      sub.girls += c.girls;
      rows.push({ level: c.level, className: c.cls === "Prep" ? "Prep" : `Class ${c.cls}`, section: c.section, boys: c.boys, girls: c.girls, total: c.boys + c.girls });
    }
    close();
    const total = list.reduce((a, c) => a + c.boys + c.girls, 0);
    return { rows, notes: [total ? `Grand total: ${total} new admissions.` : "Nobody was admitted in this period."] };
  },
  "students-siblings": ({ campuses }) => {
    const byFather = new Map<string, typeof STUDENTS>();
    for (const s of STUDENTS) if (s.status === "ACTIVE") byFather.set(s.fatherCnic, [...(byFather.get(s.fatherCnic) ?? []), s]);
    const rows: Row[] = [];
    for (const kids of byFather.values()) {
      if (kids.length < 2 || !kids.some((k) => campuses.includes(k.campus))) continue;
      rows.push({ father: kids[0]!.father, cnic: maskCnic(kids[0]!.fatherCnic), children: kids.map((k) => `${k.name} (${k.classSection}, ${k.campus})`).join("; "), count: kids.length, campuses: [...new Set(kids.map((k) => k.campusName))].join(", ") });
    }
    return { rows };
  },
  "students-left": ({ campuses, f }) => {
    // The same records as Students → Leaving & transfers (every change is kept there with who recorded and approved it).
    const [from = "", to = ""] = f.range!.split("|");
    const label: Record<string, string> = { LEFT: "Left", STRUCK_OFF: "Struck off", EXPELLED: "Expelled", PASSED_OUT: "Passed out" };
    const rows: Row[] = allMovements()
      .filter((m) => label[m.kind] && campuses.includes(m.campus) && m.date >= from && m.date <= to && (!f.status || m.kind === f.status))
      .filter((m) => (!f.class || classOf(m.classSection) === f.class) && (!f.section || m.classSection.endsWith(`-${f.section}`)))
      .map((m) => ({ m, s: findStudent(m.grNo) }))
      .map(({ m, s }) => ({ m, s, gender: s?.gender ?? (m.relation === "d/o" ? "F" : "M") }))
      .filter(({ gender }) => !f.gender || gender === f.gender)
      .map(({ m, s, gender }) => ({
        campus: m.campus,
        date: m.date,
        grNo: m.grNo,
        student: m.name,
        father: m.father,
        mobile: s ? formatMobile(s.guardian.mobile) : "",
        gender: gender === "F" ? "Girl" : "Boy",
        classSection: m.classSection,
        session: formatSession(sessionOfDate(m.date)),
        status: label[m.kind]!,
        reason: m.remarks ? `${m.reason} · ${m.remarks}` : m.reason,
        by: m.by,
        approvedBy: m.approvedBy ?? "",
      }));
    rows.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.student).localeCompare(String(b.student)));
    return { rows };
  },
  "students-contacts": ({ campuses, f }) => ({
    rows: campuses.flatMap((campus) =>
      studentsOf(campus, f).map((s) => {
        const real = s.hasProfile ? findStudent(s.grNo) : undefined;
        return { campus, grNo: s.grNo, student: s.name, classSection: s.classSection, guardian: real?.guardian.name ?? s.father, relation: real?.guardian.relation ?? "Father", mobile: formatMobile(s.mobile), address: real?.guardian.address ?? fakeAddress(s.grNo, CITY[campus]) };
      }),
    ),
  }),

  // ---------- Admissions ----------
  "adm-candidates": ({ campuses, f, session }) => {
    // Live: the admissions office's applications for this session (withdrawn ones left out).
    const st = admissionsStore.get();
    const sittingOf = (id?: string) => st.tests.find((t) => t.id === id);
    const rows: Row[] = st.applicants
      .filter((a) => campuses.includes(a.campus) && a.session === session && a.stage !== "WITHDRAWN" && (!f.class || a.classApplied === (f.class === "Prep" ? "Prep" : `Class ${f.class}`)) && (!f.gender || a.gender === f.gender))
      .sort((a, b) => a.applicationNo.localeCompare(b.applicationNo))
      .map((a) => {
        const t = sittingOf(a.testId);
        return {
          campus: a.campus,
          formNo: a.applicationNo,
          candidate: a.name,
          father: a.father,
          bForm: a.bForm ? formatCnicDigits(a.bForm) : a.fatherCnic ? `Father ${formatCnicDigits(a.fatherCnic)}` : "",
          dob: a.dob,
          classApplied: a.classApplied,
          gender: a.gender === "F" ? "Girl" : "Boy",
          previous: a.previousSchool ?? "",
          mobile: formatMobile(a.mobile),
          address: a.address,
          sitting: t ? `${formatDate(t.date)}${a.testRollNo ? ` · seat ${a.testRollNo}` : ""}` : a.directAdmission ? "No test (interview)" : "Not booked",
          status: ADMISSIONS_STAGE_LABEL[a.stage],
        };
      });
    return { rows, notes: [`Total candidates: ${rows.length}.`] };
  },
  "adm-test-appearance": ({ campuses, f, session }) => {
    const [from = "", to = ""] = f.range!.split("|");
    const st = admissionsStore.get();
    const rows: Row[] = [];
    for (const t of st.tests.filter((x) => campuses.includes(x.campus) && x.session === session && x.date >= from && x.date <= to && x.date <= DEMO_TODAY && (!f.class || x.classApplied === (f.class === "Prep" ? "Prep" : `Class ${f.class}`)))) {
      for (const a of st.applicants.filter((x) => x.testId === t.id && x.stage !== "WITHDRAWN").sort((x, y) => (x.testRollNo ?? "").localeCompare(y.testRollNo ?? ""))) {
        const appeared = a.testScore !== null || Object.values(a.marks ?? {}).some((v) => v !== null);
        if (f.appeared === "yes" && !appeared) continue;
        if (f.appeared === "no" && appeared) continue;
        rows.push({ campus: t.campus, seatNo: a.testRollNo ?? "", candidate: a.name, father: a.father, classApplied: a.classApplied, date: t.date, appeared: appeared ? "Appeared" : a.absentFromTest ? "Absent" : "Not marked yet", score: a.testScore !== null ? `${a.testScore}/${a.testMax}` : "" });
      }
    }
    const yes = rows.filter((r) => r.appeared === "Appeared").length;
    return { rows, notes: [`Appeared: ${yes} · did not appear or not marked: ${rows.length - yes}.`] };
  },
  "adm-merit": ({ campuses, f, session }) => {
    // Live: marked candidates of the class ranked by percentage, with a column per paper of the class's sittings.
    const st = admissionsStore.get();
    const cls = f.class === "Prep" ? "Prep" : `Class ${f.class}`;
    const papers: Array<{ subject: string; max: number }> = [];
    for (const t of st.tests.filter((x) => campuses.includes(x.campus) && x.session === session && x.classApplied === cls)) for (const p of t.subjects) if (!papers.some((x) => x.subject === p.subject)) papers.push(p);
    const rows: Row[] = [];
    for (const campus of campuses) {
      const list = st.applicants
        .filter((a) => a.campus === campus && a.session === session && a.classApplied === cls && a.testScore !== null && a.stage !== "WITHDRAWN" && (!f.gender || a.gender === f.gender))
        .sort((a, b) => b.testScore! / b.testMax - a.testScore! / a.testMax || a.dob.localeCompare(b.dob));
      const seats = admissionsSeats(cls);
      list.forEach((a, i) =>
        rows.push({
          campus,
          rank: i + 1,
          seatNo: a.testRollNo ?? "",
          formNo: a.applicationNo,
          candidate: a.name,
          father: a.father,
          ...Object.fromEntries(papers.map((p) => [`p:${p.subject}`, a.marks?.[p.subject] ?? null])),
          marks: a.testScore,
          percent: pct1(a.testScore!, a.testMax),
          decision: a.stage === "ADMITTED" ? "Admitted" : a.stage === "OFFERED" ? "Offered" : i < seats ? "Selected" : i < seats * 2 ? "Waiting list" : "Not selected",
        }),
      );
    }
    const columns: ReportColumnDef[] = [
      { key: "rank", label: "Rank", kind: "count" },
      { key: "seatNo", label: "Seat no.", kind: "mono" },
      { key: "formNo", label: "Form No.", kind: "mono" },
      { key: "candidate", label: "Candidate", kind: "text" },
      { key: "father", label: "Father", kind: "text" },
      ...papers.map((p) => ({ key: `p:${p.subject}`, label: `${p.subject} (${p.max})`, kind: "count" as const })),
      { key: "marks", label: "Total", kind: "count" },
      { key: "percent", label: "Score", kind: "percent" },
      { key: "decision", label: "Decision", kind: "status" },
    ];
    return { rows, columns, notes: rows.length ? ["Ranked by percentage of each candidate's own papers; ties go to the older candidate. Seats are offered in rank order."] : ["No entry test has been marked for this class yet this session."] };
  },

  // ---------- Attendance ----------
  "att-daily": ({ campuses, f }) => {
    const date = f.date!;
    if (!isSchoolDay(date)) throw new ReportError(`${formatDate(date)} was not a school day. Choose another date.`, "date");
    const rows: Row[] = [];
    for (const campus of campuses) {
      if (date === DEMO_TODAY) {
        for (const r of registersFor(campus)) {
          if (r.status === "NOT_MARKED") {
            rows.push({ campus, classSection: r.classSection, teacher: `${r.classTeacher} · not marked yet`, enrolled: r.enrolled, present: 0, absent: 0, leave: 0, late: 0, percent: null });
            continue;
          }
          rows.push({ campus, classSection: r.classSection, teacher: r.classTeacher, enrolled: r.enrolled, present: r.present, absent: r.absent, leave: r.leave, late: r.late, percent: pct1(r.present + r.late, r.enrolled) });
        }
        continue;
      }
      for (const r of registersFor(campus)) {
        const roster = rosterFor(campus, r.classSection);
        const codes = roster.map((e) => pastMark(e, date));
        const p = codes.filter((c) => c === "P").length;
        const lt = codes.filter((c) => c === "LT").length;
        rows.push({ campus, classSection: r.classSection, teacher: r.classTeacher, enrolled: roster.length, present: p, absent: codes.filter((c) => c === "A").length, leave: codes.filter((c) => c === "L").length, late: lt, percent: pct1(p + lt, roster.length) });
      }
    }
    return { rows };
  },
  "att-monthly-register": ({ campuses, f }) => {
    const campus = campuses[0]!;
    const cs = f.classSection!;
    if (!registerSections(campus).includes(cs)) throw new ReportError(`There is no class ${cs} at ${campusName(campus)}.`, "classSection");
    const month = f.month!;
    const days = daysBetweenIncl(`${month}-01`, monthEnd(month) < DEMO_TODAY ? monthEnd(month) : DEMO_TODAY).filter(isSchoolDay);
    if (!days.length) throw new ReportError(`${monthLabel(month)} has no school days (summer vacation).`, "month");
    // The legacy register's "Attendances" columns: this month, the month before (within the session), and the session total.
    const m = Number(month.slice(5, 7));
    const prev = m === 1 ? `${Number(month.slice(0, 4)) - 1}-12` : `${month.slice(0, 4)}-${String(m - 1).padStart(2, "0")}`;
    const sessionStart: IsoDate = "2026-04-01";
    const prevDays = prev < sessionStart.slice(0, 7) ? [] : daysBetweenIncl(`${prev}-01`, monthEnd(prev)).filter(isSchoolDay);
    const sessionDays = daysBetweenIncl(sessionStart, monthEnd(month) < DEMO_TODAY ? monthEnd(month) : DEMO_TODAY).filter(isSchoolDay);
    const attended = (e: RosterEntry, list: IsoDate[]) => list.filter((d) => pastMark(e, d) === "P" || pastMark(e, d) === "LT").length;
    const columns: ReportColumnDef[] = [
      { key: "roll", label: "Roll", kind: "count" },
      { key: "grNo", label: "G.R. No.", kind: "mono" },
      { key: "student", label: "Student", kind: "text" },
      { key: "father", label: "Father", kind: "text" },
      ...days.map((d) => ({ key: `d${d.slice(8)}`, label: d.slice(8), kind: "text" as const })),
      { key: "P", label: "P", kind: "count" as const },
      { key: "A", label: "A", kind: "count" as const },
      { key: "L", label: "L", kind: "count" as const },
      { key: "percent", label: "%", kind: "percent" as const },
      { key: "attMonth", label: "Attended this month", kind: "count" as const },
      { key: "attPrev", label: "Previous month", kind: "count" as const },
      { key: "attTotal", label: "Session total", kind: "count" as const },
    ];
    const rows = rosterFor(campus, cs).map((e) => {
      const row: Row = { roll: e.rollNo, grNo: e.grNo, student: e.name, father: e.father, attPrev: attended(e, prevDays), attTotal: attended(e, sessionDays) };
      let p = 0;
      let a = 0;
      let l = 0;
      for (const d of days) {
        const code = pastMark(e, d);
        row[`d${d.slice(8)}`] = code === "LT" ? "Lt" : code;
        if (code === "P" || code === "LT") p++;
        else if (code === "A") a++;
        else if (code === "L") l++;
      }
      return { ...row, P: p, A: a, L: l, percent: pct1(p, days.length), attMonth: p };
    });
    return {
      rows,
      columns,
      notes: [`Lessons delivered: this month ${days.length} · previous month ${prevDays.length} · total ${sessionDays.length}.`, "P present · A absent · L leave · Lt late (counted as present). Sundays are left out."],
    };
  },
  "att-low": ({ campuses, f }) => {
    const below = Number(f.below || 80);
    const days = daysBetweenIncl("2026-08-01", addDays(DEMO_TODAY, -1)).filter(isSchoolDay);
    const rows: Row[] = [];
    for (const campus of campuses)
      for (const s of studentsOf(campus, f)) {
        const present = days.filter((d) => {
          const c = pastMark(s, d);
          return c === "P" || c === "LT";
        }).length;
        const percent = pct1(present, days.length);
        if (percent >= below) continue;
        rows.push({ campus, grNo: s.grNo, student: s.name, classSection: s.classSection, days: days.length, present, percent, mobile: formatMobile(s.mobile) });
      }
    rows.sort((a, b) => Number(a.percent) - Number(b.percent));
    return { rows, notes: ["Counted from 01-Aug-2026 (after the summer vacation) to yesterday. Late counts as present."] };
  },
  "att-leave": ({ campuses, f }) => {
    const [from = "", to = ""] = f.range!.split("|");
    const days = daysBetweenIncl(from, to < DEMO_TODAY ? to : addDays(DEMO_TODAY, -1)).filter(isSchoolDay);
    const rows: Row[] = [];
    for (const campus of campuses)
      for (const s of studentsOf(campus, f)) {
        const leave = days.filter((d) => pastMark(s, d) === "L");
        if (!leave.length) continue;
        rows.push({ campus, grNo: s.grNo, student: s.name, classSection: s.classSection, days: leave.length, last: leave[leave.length - 1]! });
      }
    rows.sort((a, b) => Number(b.days) - Number(a.days));
    return { rows };
  },

  // ---------- Exams (live: the exams store) ----------
  ...examReportGenerators((message, field) => {
    throw new ReportError(message, field);
  }),

  // ---------- Accounts (live: the books in Accounts, vouchers and postings) ----------
  "acc-trial-balance": ({ campuses, session, f }) => {
    const [from = "", to = ""] = f.range!.split("|");
    const tb = accountsReportTrialBalance(session, scopeOf(campuses), from, to);
    // Roll up to a level: 1 classes, 2 groups, 3 sub-groups; blank lists every account under its groups.
    const level = Number(f.level || 0);
    const shown = level ? tb.rows.filter((r) => r.depth < level) : tb.rows;
    const rows: Row[] = shown.map((r) => {
      const detail = r.postable || r.depth === level - 1;
      return {
        ...(detail ? {} : { [REPORT_SUBTOTAL_KEY]: 1 }),
        code: r.code,
        account: `${"\u2003".repeat(r.depth)}${r.name}`,
        openingDr: Math.max(0, r.opening),
        openingCr: Math.max(0, -r.opening),
        debit: r.debit,
        credit: r.credit,
        closingDr: Math.max(0, r.closing),
        closingCr: Math.max(0, -r.closing),
      };
    });
    return {
      rows,
      subtitle: [`${tb.vouchers.toLocaleString("en-PK")} vouchers`],
      notes: [
        tb.balanced ? "Debits equal credits. Balances are by voucher date, so back-dated receipts land in the right month." : `Out of balance by Rs ${Math.abs(tb.difference).toLocaleString("en-PK")}. Check Accounts → Trial balance.`,
        ...(tb.clamped ? [`Dates are kept inside the session: ${formatDate(tb.from)} to ${formatDate(tb.asOf)}.`] : []),
        ...(level ? [] : ["Group lines (bold) are the sums of the accounts under them; the totals add up the accounts only."]),
      ],
    };
  },
  "acc-cash-book": ({ campuses, session, f }) => {
    const [from = "", to = ""] = f.range!.split("|");
    const book = accountsReportBook(session, scopeOf(campuses), (a) => a.code === "1101", from, to);
    return {
      rows: [
        { date: book.from, voucher: "—", description: "Opening balance", receipts: null, payments: null, balance: book.opening },
        ...book.lines.map((l) => ({ campus: l.campus, date: l.date, voucher: l.voucherNo, description: l.description && l.description !== l.narration ? `${l.narration} · ${l.description}` : l.narration, receipts: l.debit, payments: l.credit, balance: l.balance })),
      ],
      notes: [`Cash in hand (1101). Closing balance Rs ${book.closing.toLocaleString("en-PK")}. A fee batch line is one campus's cash for the day; open it in Accounts → Ledger to see that day's receipts.`, ...(book.clamped ? [`Dates are kept inside the session: ${formatDate(book.from)} to ${formatDate(book.to)}.`] : [])],
    };
  },
  "acc-bank-book": ({ campuses, session, f }) => {
    const [from = "", to = ""] = f.range!.split("|");
    // Older saved filters named the two Khalid Campus banks.
    const bank = ({ meezan: "1102", hbl: "1103" } as Record<string, string>)[f.bank ?? ""] ?? f.bank ?? "";
    const book = accountsReportBook(session, scopeOf(campuses), (a) => a.kind === "BANK" && (!bank || a.code === bank), from, to);
    if (book.accounts.length === 0) throw new ReportError("This bank account is not at the chosen campus. Choose another account or All bank accounts.", "bank");
    const all = book.accounts.length > 1;
    const name = new Map(book.accounts.map((a) => [a.code, a.name]));
    const columns: ReportColumnDef[] = [
      { key: "date", label: "Date", kind: "date" },
      { key: "voucher", label: "Voucher", kind: "mono" },
      ...(all ? [{ key: "account", label: "Bank account", kind: "text" as const }] : []),
      { key: "description", label: "Description", kind: "text" },
      { key: "deposits", label: "Deposits", kind: "money", total: true },
      { key: "payments", label: "Payments", kind: "money", total: true },
      { key: "balance", label: "Balance", kind: "money" },
    ];
    return {
      columns,
      rows: [
        { date: book.from, voucher: "—", ...(all ? { account: "" } : {}), description: "Opening balance", deposits: null, payments: null, balance: book.opening },
        ...book.lines.map((l) => ({ campus: l.campus, date: l.date, voucher: l.voucherNo, ...(all ? { account: name.get(l.account) ?? l.account } : {}), description: l.description && l.description !== l.narration ? `${l.narration} · ${l.description}` : l.narration, deposits: l.debit, payments: l.credit, balance: l.balance })),
      ],
      subtitle: [all ? `${book.accounts.length} bank accounts` : `${book.accounts[0]!.code} ${book.accounts[0]!.name}`],
      notes: [`Closing balance Rs ${book.closing.toLocaleString("en-PK")}.`, ...(book.clamped ? [`Dates are kept inside the session: ${formatDate(book.from)} to ${formatDate(book.to)}.`] : [])],
    };
  },
  "acc-income-expenditure": ({ campuses, session, f }) => {
    const month = f.month!;
    const start = `${session}-04-01`;
    if (`${month}-01` < start || month > `${session + 1}-03`) throw new ReportError(`Choose a month in ${formatSession(session)}.`, "month");
    const end = monthEnd(month) < DEMO_TODAY ? monthEnd(month) : DEMO_TODAY;
    const scope = scopeOf(campuses);
    const inMonth = accountsReportIncomeExpenditure(session, scope, `${month}-01`, end);
    const toDate = accountsReportIncomeExpenditure(session, scope, start, end);
    const monthOf = new Map([...inMonth.income, ...inMonth.expenses].flatMap((g) => g.accounts.map((a) => [a.code, a.amount] as const)));
    const rows: Row[] = [];
    const block = (groups: typeof toDate.income, type: "Income" | "Expense") => {
      for (const g of groups) {
        for (const a of g.accounts) rows.push({ head: `${a.code} ${a.name}`, type, month: monthOf.get(a.code) ?? 0, session: a.amount });
        rows.push({ [REPORT_SUBTOTAL_KEY]: 1, head: `${g.name} total`, type, month: g.accounts.reduce((s, a) => s + (monthOf.get(a.code) ?? 0), 0), session: g.amount });
      }
    };
    block(toDate.income, "Income");
    rows.push({ [REPORT_SUBTOTAL_KEY]: 1, head: "Total income", type: "Income", month: inMonth.totalIncome, session: toDate.totalIncome });
    block(toDate.expenses, "Expense");
    rows.push({ [REPORT_SUBTOTAL_KEY]: 1, head: "Total expenses", type: "Expense", month: inMonth.totalExpenses, session: toDate.totalExpenses });
    rows.push({ [REPORT_SUBTOTAL_KEY]: 1, head: inMonth.surplus >= 0 && toDate.surplus >= 0 ? "Surplus" : "Surplus (deficit shown as minus)", type: "", month: inMonth.surplus, session: toDate.surplus });
    return { rows, notes: [`Session to date runs from ${formatDate(start)} to ${formatDate(end)}. Posted vouchers only.`] };
  },
  "acc-voucher-register": ({ campuses, session, f }) => {
    const [from = "", to = ""] = f.range!.split("|");
    const list = accountsReportVouchers(session, scopeOf(campuses), from, to).filter((v) => !f.type || v.type === f.type);
    const rows: Row[] = list.slice(0, ON_SCREEN_LIMIT).map((v) => ({
      campus: v.campus,
      voucherNo: v.voucherNo ?? "Draft",
      date: v.date,
      type: ACCOUNTS_VOUCHER_TYPE_LABEL[v.type],
      narration: v.narration,
      amount: v.totalDebit,
      status: ACCOUNTS_STATUS_LABEL[v.status],
      by: v.createdBy,
    }));
    return { rows, notes: list.length > rows.length ? [`${list.length.toLocaleString("en-PK")} vouchers in this period. The first ${ON_SCREEN_LIMIT.toLocaleString("en-PK")} are shown on screen.`] : rows.length ? [] : ["No vouchers are dated in this period."] };
  },

  // ---------- Staff ----------
  "hr-staff-list": ({ campuses, f }) => ({
    rows: campuses.flatMap((campus) =>
      staffOf(campus)
        .filter((s) => (!f.group || (f.group === "T" ? s.teaching : !s.teaching)) && (!f.gender || s.gender === f.gender))
        .map((s) => ({ campus, staffNo: s.staffNo, name: s.name, designation: s.designation, department: s.department, joined: s.joined, mobile: formatMobile(s.mobile) })),
    ),
  }),
  "hr-staff-attendance": ({ campuses, f }) => {
    const month = f.month!;
    const days = daysBetweenIncl(`${month}-01`, monthEnd(month) < DEMO_TODAY ? monthEnd(month) : DEMO_TODAY).filter(isSchoolDay).length;
    if (!days) throw new ReportError(`${monthLabel(month)} has no working days (summer vacation).`, "month");
    return {
      rows: campuses.flatMap((campus) =>
        staffOf(campus).map((s) => {
          const absent = Math.floor(rand01(`${s.id}:${month}:a`) * 2.4);
          const leave = Math.floor(rand01(`${s.id}:${month}:l`) * 2.2);
          const late = Math.floor(rand01(`${s.id}:${month}:t`) * 4);
          const present = Math.max(0, days - absent - leave);
          return { campus, staffNo: s.staffNo, name: s.name, designation: s.designation, present, absent, leave, late, percent: pct1(present, days) };
        }),
      ),
    };
  },
  "hr-salary-sheet": ({ campuses, f }) => ({
    rows: campuses.flatMap((campus) =>
      staffOf(campus).map((s) => {
        const allowances = round(s.basic * 0.45) + 2500 + 2000;
        const loan = rand01(`${s.id}:loan`) < 0.1 ? 3000 : 0;
        const tax = s.basic + allowances > 100000 ? round((s.basic + allowances - 100000) * 0.05) : 0;
        const deductions = 400 + round(s.basic * 0.05) + loan + tax;
        return { campus, staffNo: s.staffNo, name: s.name, designation: s.designation, basic: s.basic, allowances, deductions, net: s.basic + allowances - deductions };
      }),
    ),
    notes: [`For ${monthLabel(f.month!)}. Allowances: house rent 45% of basic, conveyance Rs 2,500, medical Rs 2,000. Deductions: EOBI Rs 400, provident fund 5% of basic, loan instalments, income tax where due.`],
  }),
  "hr-loans": ({ campuses }) => ({
    rows: campuses.flatMap((campus) =>
      staffOf(campus)
        .filter((s) => rand01(`${s.id}:loan`) < 0.1)
        .map((s) => {
          const amount = round(30000 + rand01(`${s.id}:la`) * 90000, 5000);
          const repaid = round(amount * rand01(`${s.id}:lr`), 3000);
          return { campus, staffNo: s.staffNo, name: s.name, type: rand01(`${s.id}:lt`) < 0.3 ? "Salary advance" : "Personal loan", amount, repaid, balance: amount - repaid, instalment: 3000 };
        }),
    ),
  }),
  "hr-increments": ({ campuses }) => ({
    rows: campuses.flatMap((campus) =>
      staffOf(campus).map((s) => {
        const years = Math.max(1, 2026 - Number(s.joined.slice(0, 4)));
        const inc = s.scale >= 16 ? 2200 : s.scale >= 14 ? 1600 : 900;
        const extra = years >= 10 ? 500 : 0;
        return { campus, staffNo: s.staffNo, name: s.name, scale: s.scale, years, oldBasic: s.basic, increment: inc + extra, newBasic: s.basic + inc + extra };
      }),
    ),
    notes: ["Increment by pay scale, plus Rs 500 for ten or more years of service. Applies from 01-Jul-2026 once approved."],
  }),
  "hr-leave": ({ campuses, f }) => {
    const [from = "", to = ""] = f.range!.split("|");
    const span = Math.max(1, daysBetween(from, to));
    return {
      rows: campuses.flatMap((campus) =>
        staffOf(campus).map((s) => {
          const casual = Math.min(10, Math.floor((rand01(`${s.id}:cl`) * 7 * span) / 180));
          return { campus, staffNo: s.staffNo, name: s.name, casual, sick: Math.floor((rand01(`${s.id}:sl`) * 4 * span) / 180), other: rand01(`${s.id}:ol`) < 0.05 ? 3 : 0, remaining: 10 - casual };
        }),
      ),
    };
  },

  // ---------- Timetable (live: the class timetable and bell timings) ----------
  "tt-class": ({ campuses, session, f }) => {
    const campus = campuses[0]!;
    const cs = f.classSection!;
    const board = timetableReportBoard(campus, session);
    const section = board.sections.find((s) => s.classSection === cs);
    if (!section) throw new ReportError(`There is no class ${cs} at ${campusName(campus)}.`, "classSection");
    const subject = new Map(board.subjects.map((s) => [s.id, s.short]));
    const teacher = new Map(board.teachers.map((t) => [t.id, t.name.replace(/^(Ms|Mr|Mrs|Dr) /, "")]));
    const most = Math.max(...TIMETABLE_DAYS.map((d) => board.days[section.scheduleId]?.[d.day === 5 ? "friday" : "normal"].periods.length ?? 0), 1);
    const monday = board.days[section.scheduleId]?.normal.periods ?? [];
    const columns: ReportColumnDef[] = [{ key: "day", label: "Day", kind: "text" }, ...Array.from({ length: most }, (_, i) => ({ key: `p${i + 1}`, label: monday[i] ? `${i + 1} · ${clockTime(monday[i]!.start)}` : `Period ${i + 1}`, kind: "text" as const }))];
    const rows: Row[] = TIMETABLE_DAYS.map((d) => {
      const row: Row = { day: d.long };
      for (let p = 1; p <= most; p++) {
        if (!periodTime(board, cs, d.day, p)) {
          row[`p${p}`] = "—";
          continue;
        }
        const here = board.slots.filter((s) => s.classSection === cs && s.day === d.day && s.period === p);
        row[`p${p}`] = here.length ? here.map((s) => `${s.stream ? `${streamShort(s.stream)}: ` : ""}${subject.get(s.subjectId) ?? s.subjectId} · ${s.teacherId ? (teacher.get(s.teacherId) ?? "") : "no teacher"}`).join(" / ") : "Free";
      }
      return row;
    });
    const sched = board.schedules.find((s) => s.id === section.scheduleId) ?? board.schedule;
    return { rows, columns, notes: [`${sched.name}: assembly ${clockTime(sched.assemblyStart)}. Times in the headings are Monday to Saturday; Friday is shorter. Same as Timetable → Class timetable.`] };
  },
  "tt-teacher": ({ campuses, session }) =>
    ({
      rows: campuses.flatMap((campus) => {
        const board = timetableReportBoard(campus, session);
        return board.teachers.map((t) => {
          const mine = board.slots.filter((s) => s.teacherId === t.id);
          // Against the timings their classes follow (an evening lecturer's week is the evening shift's).
          const week = periodsInWeek(mine.length ? scheduleOf(board, mine[0]!.classSection) : board.schedule);
          const classes = [...new Set(mine.map((s) => s.classSection))].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
          return { campus, teacher: t.name, periods: mine.length, free: Math.max(0, week - mine.length), classes: classes.join(", ") || "—" };
        });
      }),
      notes: ["Periods from the class timetable (Timetable → Teachers). Free periods count against the periods a week of the timings the teacher's classes follow."],
    }),

  // ---------- Library ----------
  // Library, warehouse and transport reports read the modules' live stores (handlers/operations.ts snapshots),
  // so they match /library, /warehouse and /transport and include changes made in the demo.
  "lib-catalogue": ({ campuses, f }) => {
    const snap = librarySnapshot(campuses);
    const rows: Row[] = [];
    for (const t of snap.titles) {
      if (f.category && f.category !== t.categoryId) continue;
      // One row per cabinet the title is kept in; copies without a shelf get their own row.
      const byCabinet = new Map<string, typeof snap.copies>();
      for (const c of snap.copies.filter((x) => x.titleId === t.id)) byCabinet.set(c.cabinetCode, [...(byCabinet.get(c.cabinetCode) ?? []), c]);
      for (const [code, list] of byCabinet) {
        if (f.cabinet && f.cabinet !== code) continue;
        const acc = list.map((c) => c.accessionNo).sort();
        rows.push({
          campus: t.campus,
          accession: acc.length > 2 ? `${acc[0]} to ${acc[acc.length - 1]!.split("-").pop()}` : acc.join(", "),
          title: t.title || t.titleUr,
          author: t.authors.join(", "),
          category: t.category,
          cabinet: code ? `${code} · ${list[0]!.cabinetTitle}` : "Not on a shelf",
          copies: list.length,
          available: list.filter((c) => c.status === "AVAILABLE").length,
        });
      }
    }
    rows.sort((a, b) => String(a.campus).localeCompare(String(b.campus)) || String(a.cabinet).localeCompare(String(b.cabinet)) || String(a.title).localeCompare(String(b.title)));
    return { rows, notes: ["Copies counts every copy on record; on shelf counts those ready to lend."] };
  },
  "lib-issued": ({ campuses, session, f }) => {
    const sessionEnd = `${session + 1}-03-31`;
    const rows: Row[] = librarySnapshot(campuses)
      .loans.filter((l) => !l.returnedOn && l.issuedOn <= sessionEnd)
      .filter((l) => !f.borrower || (f.borrower === "staff" ? l.borrowerType === "STAFF" : l.borrowerType === "STUDENT"))
      .filter((l) => f.status !== "overdue" || l.dueOn < DEMO_TODAY)
      .map((l) => ({ campus: l.campus, accession: l.accessionNo, title: l.title || l.titleUr, borrowerId: l.borrowerId, borrower: l.borrowerName, of: l.borrowerDetail, issued: l.issuedOn, due: l.dueOn, days: l.daysLate, fine: l.fine }));
    rows.sort((a, b) => Number(b.days) - Number(a.days) || String(a.borrower).localeCompare(String(b.borrower)));
    return { rows, notes: ["Fines follow each campus's loan rule (Library → Shelves and rules) and are what the book would cost if returned today."] };
  },

  // ---------- Warehouse ----------
  "wh-stock": ({ campuses, session, f }) => {
    const snap = warehouseSnapshot(campuses);
    const start = `${session}-04-01`;
    const end = `${session + 1}-03-31`;
    const byItem = new Map<string, typeof snap.moves>();
    for (const m of snap.moves) if (m.date >= start && m.date <= end) byItem.set(m.itemId, [...(byItem.get(m.itemId) ?? []), m]);
    const sum = (list: typeof snap.moves, types: string[], side: "in" | "out") => list.filter((m) => types.includes(m.type)).reduce((a, m) => a + (side === "in" ? m.qtyIn : m.qtyOut), 0);
    const rows: Row[] = snap.items
      .filter((i) => i.active && (!f.category || i.categoryId === f.category))
      .map((i) => {
        const mv = byItem.get(i.id) ?? [];
        const received = sum(mv, ["OPENING", "RECEIPT"], "in") - sum(mv, ["REVERSAL"], "out");
        const issued = sum(mv, ["ISSUE", "SALE"], "out") - sum(mv, ["RETURN", "SALE_CANCEL"], "in");
        return { campus: i.campus, code: i.code, item: i.status !== "OK" ? `${i.name} · reorder` : i.name, unit: i.unit, received, issued, stock: i.onHand, reorder: i.reorderLevel, value: Math.max(0, i.value) };
      });
    return { rows, notes: ["Items marked “reorder” are at or below their reorder level. Value is at average cost. Received includes the opening count on 01-Apr-2026."] };
  },
  "wh-issued": ({ campuses, f }) => {
    const [from = "", to = ""] = f.range!.split("|");
    const rows: Row[] = [];
    for (const i of warehouseSnapshot(campuses).issues) {
      if (i.date < from || i.date > to) continue;
      if (f.department && i.department !== f.department) continue;
      if (f.room && i.room !== f.room) continue;
      for (const l of i.lines)
        rows.push({ campus: i.campus, date: i.date, issueNo: i.no, item: l.itemName, kind: l.consumable ? "Used up" : "Kept", qty: l.qty, returned: l.returned, remaining: l.qty - l.returned, department: i.department, room: i.room, to: i.receivedBy });
    }
    rows.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.issueNo).localeCompare(String(b.issueNo)));
    return { rows };
  },
  "wh-purchases": ({ campuses, f }) => {
    const [from = "", to = ""] = f.range!.split("|");
    const snap = warehouseSnapshot(campuses);
    const groupOf = new Map(snap.items.map((i) => [i.id, i.group]));
    const rows: Row[] = [];
    for (const g of snap.grns) {
      if (g.status !== "POSTED" || g.date < from || g.date > to) continue;
      if (f.supplier && g.supplierName !== f.supplier) continue;
      const lines = f.item ? g.lines.filter((l) => groupOf.get(l.itemId) === f.item) : g.lines;
      if (lines.length === 0) continue;
      rows.push({ campus: g.campus, date: g.date, grn: g.no, supplier: g.supplierName, invoice: g.supplierInvoiceNo, items: lines.map((l) => `${l.itemName} × ${l.qty}`).join(", "), amount: f.item ? lines.reduce((a, l) => a + l.total, 0) : g.total });
    }
    rows.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.grn).localeCompare(String(b.grn)));
    return { rows, notes: [f.item ? "With an item chosen, the amount is that item's lines only (no freight or tax)." : "Amounts include freight and sales tax. Reversed receipts are left out."] };
  },

  // ---------- Transport ----------
  "trn-riders": ({ campuses, session, f }) => {
    const snap = transportSnapshot(campuses, session);
    const reg = new Map(snap.routes.map((r) => [r.id, r.vehicleRegNo]));
    const rows: Row[] = snap.riders
      .filter((r) => r.type === "STUDENT" && r.status === "ACTIVE" && (!f.route || r.routeCode === f.route))
      .map((r) => ({ campus: r.campus, route: `${r.routeCode} · ${r.routeName}`, vehicle: reg.get(r.routeId) ?? "", grNo: r.personId, student: r.name, classSection: r.detail, stop: r.stopName, fee: r.monthlyFee }));
    rows.sort((a, b) => String(a.campus).localeCompare(String(b.campus)) || String(a.route).localeCompare(String(b.route)) || String(a.stop).localeCompare(String(b.stop)) || String(a.student).localeCompare(String(b.student)));
    return { rows };
  },
  "trn-fuel": ({ campuses, session, f }) => {
    const snap = transportSnapshot(campuses, session);
    const month = f.month!;
    const rows: Row[] = snap.vehicles
      .filter((v) => v.active)
      .map((v) => {
        const trips = snap.trips.filter((t) => t.vehicleId === v.id && t.date.startsWith(month));
        const fills = snap.fuel.filter((x) => x.vehicleId === v.id && x.date.startsWith(month));
        // Kilometres from the meter readings at each fill; the trip log when no fill has a previous reading.
        const meterKm = fills.reduce((a, x) => a + (x.kmSinceLast ?? 0), 0);
        const km = meterKm || trips.reduce((a, t) => a + (t.endKm - t.startKm), 0);
        const cost = fills.reduce((a, x) => a + x.amount, 0);
        return { campus: v.campus, vehicle: v.regNo, type: `${v.make} ${v.model} (${v.capacity} seats)`, trips: trips.length, km, litres: Math.round(fills.reduce((a, x) => a + x.litres, 0)), cost, perKm: km ? Math.round(cost / km) : 0 };
      });
    rows.sort((a, b) => String(a.campus).localeCompare(String(b.campus)) || String(a.vehicle).localeCompare(String(b.vehicle)));
    return { rows, notes: ["Kilometres come from the meter readings in the fuel log, litres and cost from the fuel slips, and trips from the trip log (Transport → Logbook)."] };
  },

  // ---------- Messages ----------
  "msg-log": ({ campuses, f }) => {
    const [from = "", to = ""] = f.range!.split("|");
    const rows: Row[] = [];
    let total = 0;
    const kinds: Array<[string, string]> = [["ATTENDANCE", "Attendance"], ["FEE", "Fees"], ["RESULT", "Results"], ["NOTICE", "Notice"]];
    for (const campus of campuses) {
      const pool = studentsOf(campus, {});
      for (const date of daysBetweenIncl(from, to)) {
        if (!isSchoolDay(date)) continue;
        const absent = pool.filter((s) => pastMark(s, date) === "A");
        const sends: Array<[string, typeof pool]> = [["ATTENDANCE", absent]];
        const dom = Number(date.slice(8));
        if (dom === 5 || dom === 12 || dom === 3) sends.push(["FEE", pool.filter((p) => rand01(`${p.grNo}:fee`) < 0.3)]);
        if (dom % 7 === 2) sends.push(["NOTICE", pool]);
        if (dom === 20) sends.push(["RESULT", pool.filter((p) => !p.classSection.startsWith("Prep"))]);
        for (const [cat, list] of sends) {
          if (f.category && f.category !== cat) continue;
          for (const s of list) {
            total++;
            if (rows.length >= ON_SCREEN_LIMIT) continue;
            const app = rand01(`${s.mobile}:app`) < 0.42 && cat !== "FEE";
            const failed = !app && hashStr(`${s.grNo}${date}${cat}`) % 61 === 0;
            rows.push({ campus, date, grNo: s.grNo, student: s.name, father: s.father, gender: s.gender === "F" ? "Female" : "Male", classSection: s.classSection, mobile: formatMobile(s.mobile), category: kinds.find((k) => k[0] === cat)![1], channel: app ? "App" : "SMS", status: failed ? "Failed" : "Delivered" });
          }
        }
      }
    }
    return { rows, notes: total > rows.length ? [`${total.toLocaleString("en-PK")} messages in this period. The first ${ON_SCREEN_LIMIT.toLocaleString("en-PK")} are shown on screen; the Excel file has all of them.`] : [] };
  },
  "msg-cost": ({ campuses }) => {
    const months = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"];
    const k = campuses.reduce((s, c) => s + ({ KC: 1, SM: 0.49, UC: 0.57, MC: 0.33, HC: 0.78 } as const)[c], 0);
    const snap = outboxSnapshot().batches.filter((b) => campuses.includes(b.campus) && (b.sentAt ?? b.createdAt).startsWith("2026-11") && (b.status === "SENT" || b.status === "SENDING"));
    return {
      rows: months.map((m, i) => {
        if (m === "2026-11") {
          const sms = snap.reduce((s, b) => s + b.smsRecipients, 0);
          const app = snap.reduce((s, b) => s + b.appRecipients, 0);
          return { month: `${monthLabel(m)} (so far)`, messages: sms + app, parts: snap.reduce((s, b) => s + b.segments, 0), app, cost: snap.reduce((s, b) => s + b.estCost, 0), saved: snap.reduce((s, b) => s + b.saved, 0) };
        }
        const vacation = m === "2026-06" || m === "2026-07";
        const messages = Math.round((vacation ? 2600 : 21000 + rand01(m) * 6000) * k);
        const appShare = Math.min(0.42, 0.04 + i * 0.06);
        const app = Math.round(messages * appShare);
        const parts = Math.round((messages - app) * 1.45);
        return { month: monthLabel(m), messages, parts, app, cost: Math.round((parts * 55) / 100), saved: Math.round((app * 1.45 * 55) / 100) };
      }),
      notes: ["App notifications are free. The app share grows as more families install it."],
    };
  },
};


class ReportError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------------------------------
// Running a report
// ---------------------------------------------------------------------------------------------------

function runReport(given: ReportDefinition, req: ReportRunRequest, user: SessionUser): ReportResult | Response {
  // Exam choices come from the exams of the campus and session.
  const def = liveExamDefinition(given, req.campus, req.session);
  const f = resolveFilters(def, req.filters ?? {});
  const bad = validate(def, f, req.campus);
  if (bad) return bad;
  const gen = GENERATORS[def.id];
  if (!gen) return fail(404, "NOT_FOUND", "This report is not available yet.");
  let out: GenOut;
  try {
    out = gen({ campuses: campusesOf(req.campus), session: req.session, f, user });
  } catch (e) {
    if (e instanceof ReportError) return fail(422, "VALIDATION", e.message, e.field ? { field: e.field } : {});
    throw e;
  }
  let columns = out.columns ?? def.columns;
  const multi = req.campus === "ALL" && out.rows.some((r) => "campus" in r);
  if (multi) columns = [{ key: "campus", label: "Campus", kind: "text" }, ...columns];
  const rows = out.rows.map((r) => {
    if (!multi) {
      const { campus: _c, ...rest } = r;
      return rest;
    }
    return { ...r, campus: campusName(r.campus as CampusCode).replace(" Campus", "") };
  });
  const totals: Record<string, number> = {};
  // Subtotal lines (REPORT_SUBTOTAL_KEY) are already sums: the totals row adds up the detail rows only.
  for (const c of columns) if (c.total) totals[c.key] = rows.reduce((s, r) => s + (!r[REPORT_SUBTOTAL_KEY] && typeof r[c.key] === "number" ? (r[c.key] as number) : 0), 0);
  const heading = req.campus === "ALL" ? "MTB School & College System · All campuses" : `MTB · ${campusName(req.campus)}${req.campus === "HC" ? ", Lahore" : ", Sadiqabad"}`;
  return {
    reportId: def.id,
    title: def.name,
    subtitle: [req.campus === "ALL" ? "All campuses" : campusName(req.campus), `Session ${formatSession(req.session)}`, ...describeFilters(def, f), ...(out.subtitle ?? [])].join(" · "),
    campusHeading: heading,
    generatedAt: demoNow(),
    generatedBy: user.name,
    columns,
    rows,
    ...(Object.keys(totals).length ? { totals } : {}),
    ...(out.notes?.length ? { notes: out.notes } : {}),
    ...(def.chart ? { chart: def.chart } : {}),
    ...(def.signatures?.length ? { signatures: def.signatures } : {}),
    ...(def.ruled ? { ruled: true } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------
// Stores: favourites, last runs, jobs, schedules, notifications
// ---------------------------------------------------------------------------------------------------

interface MockJob extends ReportJob {
  requestedAtMs: number;
  durationMs: number;
  notified?: boolean;
}

interface ReportsState {
  favourites: Record<string, string[]>;
  lastRun: Record<string, Record<string, string>>;
  jobs: Record<string, MockJob[]>;
  notifications: Record<string, StaffNotification[]>;
  seeded: Record<string, boolean>;
}

const reportsStore = createStore<ReportsState>("reports", () => ({ favourites: {}, lastRun: {}, jobs: {}, notifications: {}, seeded: {} }));

function seedSchedules(): ReportSchedule[] {
  const mk = (id: string, reportId: string, campus: CampusScope, frequency: ReportSchedule["frequency"], time: string, format: ReportFormat, recipients: string[], extra: Partial<ReportSchedule>, filters: ReportFilterValues = {}): ReportSchedule => {
    const def = reportById(reportId)!;
    return {
      id,
      reportId,
      reportName: def.name,
      module: def.module,
      campus,
      session: 2026,
      filters,
      filterSummary: describeSchedule(def, filters),
      frequency,
      time,
      format,
      recipients,
      active: true,
      nextRunAt: nextRun({ frequency, time, ...extra }),
      lastRunAt: extra.lastRunAt ?? "2026-11-03T18:00:00+05:00",
      createdBy: recipients[0] ?? "Kamran Yousaf",
      createdAt: "2026-09-02T10:00:00+05:00",
      ...extra,
    };
  };
  return [
    mk("sch-1", "fee-daily-summary", "KC", "DAILY", "18:00", "PDF", ["Mrs Sadia Rehman", "Nadia Shah"], {}, { date: "today" }),
    mk("sch-2", "fee-defaulters", "KC", "MONTHLY", "09:00", "EXCEL", ["Mrs Sadia Rehman", "Usman Ali"], { dayOfMonth: 15, lastRunAt: "2026-10-15T09:00:00+05:00" }),
    mk("sch-3", "att-daily", "ALL", "DAILY", "11:00", "PDF", ["Kamran Yousaf"], {}, { date: "today" }),
    mk("sch-4", "hr-staff-attendance", "ALL", "MONTHLY", "08:00", "EXCEL", ["Nadia Shah"], { dayOfMonth: 1, lastRunAt: "2026-11-01T08:00:00+05:00" }),
  ];
}

const schedulesStore = createStore<ReportSchedule[]>("report-schedules", seedSchedules);

/** Next time a schedule runs after now (demo clock). */
function nextRun(s: Pick<ReportSchedule, "frequency" | "time"> & { weekday?: number; dayOfMonth?: number }): string {
  const now = demoNow();
  const at = (d: IsoDate) => `${d}T${s.time}:00+05:00`;
  for (let i = 0; i < 70; i++) {
    const d = addDays(DEMO_TODAY, i);
    const ok = s.frequency === "DAILY" ? weekday(d) !== 0 : s.frequency === "WEEKLY" ? weekday(d) === (s.weekday ?? 1) : Number(d.slice(8)) === (s.dayOfMonth ?? 1);
    if (ok && at(d) > now) return at(d);
  }
  return at(addDays(DEMO_TODAY, 1));
}

const RECIPIENTS = [
  { name: "Mrs Sadia Rehman", role: "Principal, Khalid Campus" },
  { name: "Nadia Shah", role: "Accountant, all campuses" },
  { name: "Kamran Yousaf", role: "Admin, all campuses" },
  { name: "Usman Ali", role: "Cashier, Khalid Campus" },
  { name: "Farah Naz", role: "Office, Khalid Campus" },
  { name: "Ms Hina Javed", role: "Teacher, Khalid Campus" },
];

const allowed = (user: SessionUser, def: ReportDefinition, scope: CampusScope) => can(user, def.permission, scope) || (scope !== "ALL" && can(user, def.permission, "ALL"));

const durationFor = (def: ReportDefinition, format: ReportJob["format"]) => (def.background ? 9000 + (hashStr(def.id) % 5000) : 1800) + (format === "PDF" ? 1500 : 0);

function fileNameFor(def: ReportDefinition, campus: CampusScope, format: ReportJob["format"]) {
  const slug = def.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `${slug}-${campus === "ALL" ? "all-campuses" : campus.toLowerCase()}-${formatDate(DEMO_TODAY).toLowerCase()}.${format === "EXCEL" ? "csv" : "pdf"}`;
}

function newJob(def: ReportDefinition, req: ReportRunRequest, format: ReportJob["format"], user: SessionUser, extra: Partial<MockJob> = {}): MockJob {
  const f = resolveFilters(def, req.filters ?? {});
  const now = Date.now();
  return {
    id: `job-${now.toString(36)}${Math.floor(Math.random() * 1000)}`,
    reportId: def.id,
    reportName: def.name,
    module: def.module,
    campus: req.campus,
    session: req.session,
    filters: f,
    filterSummary: [req.campus === "ALL" ? "All campuses" : campusName(req.campus), ...describeFilters(def, f)].join(" · "),
    format,
    status: "QUEUED",
    progress: 0,
    requestedAt: demoNow(),
    requestedBy: user.name,
    requestedAtMs: now,
    durationMs: durationFor(def, format),
    ...extra,
  };
}

function seedFor(user: SessionUser) {
  const st = reportsStore.get();
  if (st.seeded[user.id]) return;
  const scope: CampusScope = user.roles[0]?.campus ?? "KC";
  const preference = ["fee-defaulters", "students-register", "hr-salary-sheet", "lib-issued", "att-daily", "msg-log"];
  const mine = preference.map((id) => reportById(id)!).filter((d) => allowed(user, d, scope));
  const jobs: MockJob[] = [];
  const past = Date.now() - 86_400_000;
  mine.slice(0, 3).forEach((def, i) => {
    const format: ReportFormat = i === 1 ? "PDF" : "EXCEL";
    const j = newJob(def, { reportId: def.id, campus: def.singleCampus && scope === "ALL" ? "KC" : scope, session: 2026, filters: {} }, format, user);
    const at = i === 0 ? "2026-11-04T08:12:00+05:00" : i === 1 ? "2026-11-03T16:40:00+05:00" : "2026-10-27T11:05:00+05:00";
    const expired = i === 2;
    jobs.push({
      ...j,
      id: `job-seed-${user.id}-${i}`,
      requestedAt: at,
      requestedAtMs: past,
      status: expired ? "EXPIRED" : "READY",
      progress: 100,
      readyAt: at.replace(/:(\d\d):00\+/, (_m, mm: string) => `:${String(Math.min(59, Number(mm) + 1)).padStart(2, "0")}:00+`),
      expiresAt: expired ? "2026-11-03T11:06:00+05:00" : `${addDays(at.slice(0, 10), 7)}T23:59:00+05:00`,
      rowCount: 140 + (hashStr(def.id) % 900),
      fileName: fileNameFor(def, j.campus, format),
      sizeKb: 40 + (hashStr(def.id) % 400),
      notified: true,
    });
  });
  const notes: StaffNotification[] = jobs
    .filter((j) => j.status === "READY")
    .map((j) => ({ id: `n-${j.id}`, kind: "REPORT_READY" as const, title: `${j.reportName} is ready`, body: `${j.format === "EXCEL" ? "Excel" : "PDF"} · ${j.filterSummary}`, at: j.readyAt!, read: true, link: "/reports/jobs", jobId: j.id }));
  reportsStore.set((s) => ({ ...s, seeded: { ...s.seeded, [user.id]: true }, jobs: { ...s.jobs, [user.id]: [...jobs, ...(s.jobs[user.id] ?? [])] }, notifications: { ...s.notifications, [user.id]: [...notes, ...(s.notifications[user.id] ?? [])] } }));
}

/** Moves running jobs forward; finished ones get a row count, a file and a bell notification. */
function tick(user: SessionUser) {
  const st = reportsStore.get();
  const list = st.jobs[user.id] ?? [];
  const now = Date.now();
  const fresh: StaffNotification[] = [];
  let changed = false;
  const next = list.map((j) => {
    if (j.status !== "QUEUED" && j.status !== "RUNNING") return j;
    changed = true;
    const elapsed = now - j.requestedAtMs;
    if (elapsed < 700) return { ...j, status: "QUEUED" as const, progress: 0 };
    const progress = Math.min(100, Math.round((elapsed / j.durationMs) * 100));
    if (progress < 100) return { ...j, status: "RUNNING" as const, progress };
    const def = reportById(j.reportId)!;
    const result = runReport(def, { reportId: j.reportId, campus: j.campus, session: j.session, filters: j.filters }, user);
    if (result instanceof Response) {
      const failed = { ...j, status: "FAILED" as const, progress: 100, error: "The report could not be prepared with these filters. Open it on screen to see why." };
      fresh.push({ id: `n-${j.id}`, kind: "REPORT_FAILED", title: `${j.reportName} could not be prepared`, body: "Open it on screen to see why, then try again.", at: demoNow(), read: false, link: "/reports/jobs", jobId: j.id });
      return failed;
    }
    const readyAt = demoNow();
    const done: MockJob = {
      ...j,
      status: "READY",
      progress: 100,
      readyAt,
      expiresAt: `${addDays(DEMO_TODAY, 7)}T23:59:00+05:00`,
      rowCount: result.rows.length,
      ...(j.format !== "SCREEN" ? { fileName: fileNameFor(def, j.campus, j.format), sizeKb: Math.max(8, Math.round(result.rows.length * (j.format === "PDF" ? 0.6 : 0.15))) } : {}),
      notified: true,
    };
    fresh.push({
      id: `n-${j.id}`,
      kind: j.scheduleId ? "SCHEDULE_SENT" : "REPORT_READY",
      title: j.scheduleId ? `Scheduled report sent: ${j.reportName}` : `${j.reportName} is ready`,
      body: `${j.format === "SCREEN" ? "View on screen" : j.format === "EXCEL" ? "Excel" : "PDF"} · ${result.rows.length.toLocaleString("en-PK")} rows · ${j.filterSummary}`,
      at: readyAt,
      read: false,
      link: j.format === "SCREEN" ? `/reports/${j.reportId}?job=${j.id}` : "/reports/jobs",
      jobId: j.id,
    });
    return done;
  });
  if (changed) reportsStore.set((s) => ({ ...s, jobs: { ...s.jobs, [user.id]: next }, notifications: { ...s.notifications, [user.id]: [...fresh, ...(s.notifications[user.id] ?? [])] } }));
}

const publicJob = ({ requestedAtMs: _a, durationMs: _d, notified: _n, ...j }: MockJob): ReportJob => j;

// ---------------------------------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------------------------------

function validateNotice(b: NoticeInput): Response | null {
  if (!b.title?.trim()) return fail(422, "VALIDATION", "Write the title in English.", { field: "title" });
  if (b.title.trim().length > 120) return fail(422, "VALIDATION", "Keep the title under 120 characters.", { field: "title" });
  if (!b.titleUr?.trim()) return fail(422, "VALIDATION", "Write the title in Urdu. Parents who read Urdu see this one.", { field: "titleUr" });
  if (!b.body?.trim()) return fail(422, "VALIDATION", "Write the notice in English.", { field: "body" });
  if (!b.bodyUr?.trim()) return fail(422, "VALIDATION", "Write the notice in Urdu.", { field: "bodyUr" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date ?? "")) return fail(422, "VALIDATION", "Choose the date the notice is about.", { field: "date" });
  if (b.audience === "CLASS" && !(b.classSections ?? []).length) return fail(422, "VALIDATION", "Choose at least one class.", { field: "classSections" });
  if (b.expiresOn && b.expiresOn < DEMO_TODAY) return fail(422, "VALIDATION", "The notice would already be hidden. Choose today or a later date, or leave it empty.", { field: "expiresOn" });
  return null;
}

function audienceCountOf(n: Pick<Notice, "campus" | "audience" | "classSections">): number {
  if (n.audience === "STAFF") return staffOf(n.campus).length;
  if (n.audience === "ALL_PARENTS") return FAMILIES[n.campus];
  return Math.round((n.classSections ?? []).reduce((s, cs) => s + rosterFor(n.campus, cs).length, 0) * 0.82);
}

/** Publishing with "also send": an app notification and/or SMS through the messages outbox. */
function sendNotice(n: Notice, user: SessionUser): string | Response | null {
  if (!n.sendApp && !n.sendSms) return null;
  const audience: SmsAudience = n.audience === "STAFF" ? { kind: "STAFF", group: "ALL" } : n.audience === "CLASS" ? { kind: "SECTIONS", classSections: n.classSections ?? [] } : { kind: "ALL_PARENTS" };
  const channel = n.sendApp && n.sendSms ? "APP_FIRST" : n.sendApp ? "APP" : "SMS";
  const shortBody = (s: string) => (s.length > 220 ? `${s.slice(0, 217)}...` : s);
  const r = queueBatch(
    {
      campus: n.campus,
      session: 2026,
      templateId: "custom",
      language: "en",
      audience,
      channel,
      title: n.title,
      source: "Notices",
      customText: { en: `${n.title}. ${shortBody(n.body)} - MTB ${campusName(n.campus)}`, ur: `${n.titleUr}۔ ${shortBody(n.bodyUr)}`, category: n.audience === "STAFF" ? "STAFF" : "NOTICE" },
    },
    // Publishing is the approval for a notice.
    { ...user, roles: [...user.roles, { role: "PRINCIPAL", roleName: "", campus: n.campus, campusName: "", permissions: ["approvals.decide"] }] },
  );
  if (r instanceof Response) return r;
  return r.batchId;
}

// ---------------------------------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------------------------------

export const reportsHandlers = [
  http.get("/api/reports/catalogue", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("reports.view", ctx.campus);
    if (user instanceof Response) return user;
    const st = reportsStore.get();
    const favs = new Set(st.favourites[user.id] ?? DEFAULT_FAVOURITES);
    const runs = st.lastRun[user.id] ?? {};
    const visible = REPORT_DEFINITIONS.filter((d) => allowed(user, d, ctx.campus));
    const catalogue: ReportCatalogue = {
      reports: visible.map((d) => ({ ...liveExamDefinition(d, ctx.campus, ctx.session), favourite: favs.has(d.id), ...(runs[d.id] ? { lastRunAt: runs[d.id] } : {}) })),
      hiddenCount: REPORT_DEFINITIONS.length - visible.length,
    };
    return HttpResponse.json(catalogue);
  }),
  http.put("/api/reports/favourites/:id", async ({ params, request }) => {
    await latency();
    const user = requireUser();
    if (user instanceof Response) return user;
    const id = String(params.id);
    if (!reportById(id)) return fail(404, "NOT_FOUND", "That report no longer exists.");
    const { favourite } = (await request.json()) as { favourite: boolean };
    reportsStore.set((s) => {
      const current = new Set(s.favourites[user.id] ?? DEFAULT_FAVOURITES);
      if (favourite) current.add(id);
      else current.delete(id);
      return { ...s, favourites: { ...s.favourites, [user.id]: [...current] } };
    });
    return HttpResponse.json({ favourite });
  }),
  http.post("/api/reports/run", async ({ request }) => {
    await latency();
    const body = (await request.json()) as ReportRunRequest;
    const user = requireUser();
    if (user instanceof Response) return user;
    const def = reportById(body.reportId);
    if (!def) return fail(404, "NOT_FOUND", "That report no longer exists.");
    if (!can(user, "reports.view", body.campus) || !allowed(user, def, body.campus)) return fail(403, "FORBIDDEN", "Your role can't open this report at this campus.");
    if (def.background) return fail(409, "RUN_IN_BACKGROUND", "This report is large. Run it in the background; the bell tells you when it is ready.");
    const result = runReport(def, body, user);
    if (result instanceof Response) return result;
    reportsStore.set((s) => ({ ...s, lastRun: { ...s.lastRun, [user.id]: { ...(s.lastRun[user.id] ?? {}), [def.id]: demoNow() } } }));
    return HttpResponse.json(result);
  }),
  http.post("/api/reports/jobs", async ({ request }) => {
    await latency();
    const body = (await request.json()) as ReportRunRequest & { format: ReportJob["format"] };
    const user = requireUser();
    if (user instanceof Response) return user;
    const def = reportById(body.reportId);
    if (!def) return fail(404, "NOT_FOUND", "That report no longer exists.");
    if (!can(user, "reports.view", body.campus) || !allowed(user, def, body.campus)) return fail(403, "FORBIDDEN", "Your role can't open this report at this campus.");
    if (body.format !== "SCREEN" && !def.formats.includes(body.format)) return fail(422, "VALIDATION", `This report can't be saved as ${body.format === "EXCEL" ? "Excel" : "PDF"}.`);
    const f = resolveFilters(def, body.filters ?? {});
    const bad = validate(def, f, body.campus);
    if (bad) return bad;
    seedFor(user);
    const job = newJob(def, body, body.format, user);
    reportsStore.set((s) => ({ ...s, jobs: { ...s.jobs, [user.id]: [job, ...(s.jobs[user.id] ?? [])] }, lastRun: { ...s.lastRun, [user.id]: { ...(s.lastRun[user.id] ?? {}), [def.id]: demoNow() } } }));
    // Small exports are ready straight away; large ones keep running in the background.
    if (!def.background) {
      reportsStore.set((s) => ({ ...s, jobs: { ...s.jobs, [user.id]: (s.jobs[user.id] ?? []).map((j) => (j.id === job.id ? { ...j, requestedAtMs: j.requestedAtMs - j.durationMs } : j)) } }));
      tick(user);
      // The user is on the page that asked for it: no need to ring the bell as well.
      reportsStore.set((s) => ({ ...s, notifications: { ...s.notifications, [user.id]: (s.notifications[user.id] ?? []).map((n) => (n.jobId === job.id ? { ...n, read: true } : n)) } }));
    }
    const saved = reportsStore.get().jobs[user.id]!.find((j) => j.id === job.id)!;
    return HttpResponse.json(publicJob(saved), { status: 201 });
  }),
  http.get("/api/reports/jobs", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("reports.view", ctx.campus);
    if (user instanceof Response) return user;
    seedFor(user);
    tick(user);
    return HttpResponse.json((reportsStore.get().jobs[user.id] ?? []).map(publicJob));
  }),
  http.get("/api/reports/jobs/:id", async ({ params }) => {
    await latency();
    const user = requireUser();
    if (user instanceof Response) return user;
    tick(user);
    const j = (reportsStore.get().jobs[user.id] ?? []).find((x) => x.id === String(params.id));
    if (!j) return fail(404, "NOT_FOUND", "This download was removed or belongs to someone else.");
    return HttpResponse.json(publicJob(j));
  }),
  http.get("/api/reports/jobs/:id/result", async ({ params }) => {
    await latency();
    const user = requireUser();
    if (user instanceof Response) return user;
    tick(user);
    const j = (reportsStore.get().jobs[user.id] ?? []).find((x) => x.id === String(params.id));
    if (!j) return fail(404, "NOT_FOUND", "This download was removed or belongs to someone else.");
    if (j.status === "EXPIRED") return fail(410, "EXPIRED", "Files are kept for 7 days. Run the report again to get a fresh copy.");
    if (j.status !== "READY") return fail(409, "NOT_READY", "This report is still being prepared.");
    const result = runReport(reportById(j.reportId)!, { reportId: j.reportId, campus: j.campus, session: j.session, filters: j.filters }, user);
    if (result instanceof Response) return result;
    return HttpResponse.json(result);
  }),
  http.post("/api/reports/jobs/:id/retry", async ({ params }) => {
    await latency();
    const user = requireUser();
    if (user instanceof Response) return user;
    const j = (reportsStore.get().jobs[user.id] ?? []).find((x) => x.id === String(params.id));
    if (!j) return fail(404, "NOT_FOUND", "This download was removed.");
    const def = reportById(j.reportId)!;
    const job = newJob(def, { reportId: j.reportId, campus: j.campus, session: j.session, filters: j.filters }, j.format, user);
    reportsStore.set((s) => ({ ...s, jobs: { ...s.jobs, [user.id]: [job, ...(s.jobs[user.id] ?? []).filter((x) => x.id !== j.id)] } }));
    return HttpResponse.json(publicJob(job), { status: 201 });
  }),
  http.delete("/api/reports/jobs/:id", async ({ params }) => {
    await latency();
    const user = requireUser();
    if (user instanceof Response) return user;
    reportsStore.set((s) => ({ ...s, jobs: { ...s.jobs, [user.id]: (s.jobs[user.id] ?? []).filter((x) => x.id !== String(params.id)) } }));
    return HttpResponse.json({ status: "ok" });
  }),

  // ---- Schedules ----
  http.get("/api/reports/schedules", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("reports.view", ctx.campus);
    if (user instanceof Response) return user;
    const list = schedulesStore
      .get()
      .filter((s) => ctx.campus === "ALL" || s.campus === ctx.campus || s.campus === "ALL")
      .filter((s) => allowed(user, reportById(s.reportId)!, s.campus === "ALL" ? ctx.campus : s.campus));
    return HttpResponse.json(list.sort((a, b) => Number(b.active) - Number(a.active) || a.nextRunAt.localeCompare(b.nextRunAt)));
  }),
  http.post("/api/reports/schedules", async ({ request }) => {
    await latency();
    const body = (await request.json()) as ReportScheduleInput;
    const user = requirePermission("reports.view", body.campus);
    if (user instanceof Response) return user;
    const def = reportById(body.reportId);
    if (!def) return fail(404, "NOT_FOUND", "Choose a report.", { field: "reportId" });
    if (!allowed(user, def, body.campus)) return fail(403, "FORBIDDEN", "Your role can't open this report at this campus.");
    if (def.background && body.frequency === "DAILY") return fail(422, "VALIDATION", "This report is large; schedule it weekly or monthly.", { field: "frequency" });
    if (!/^\d{2}:\d{2}$/.test(body.time)) return fail(422, "VALIDATION", "Choose a time.", { field: "time" });
    if (!body.recipients?.length) return fail(422, "VALIDATION", "Choose who gets it.", { field: "recipients" });
    const f = resolveFilters(def, body.filters ?? {});
    const bad = validate(def, f, body.campus);
    if (bad) return bad;
    const s: ReportSchedule = {
      id: `sch-${Date.now().toString(36)}`,
      reportId: def.id,
      reportName: def.name,
      module: def.module,
      campus: body.campus,
      session: body.session,
      filters: body.filters ?? {},
      filterSummary: describeSchedule(def, body.filters ?? {}),
      frequency: body.frequency,
      ...(body.frequency === "WEEKLY" ? { weekday: body.weekday ?? 1 } : {}),
      ...(body.frequency === "MONTHLY" ? { dayOfMonth: body.dayOfMonth ?? 1 } : {}),
      time: body.time,
      format: body.format,
      recipients: body.recipients,
      active: true,
      nextRunAt: nextRun(body),
      createdBy: user.name,
      createdAt: demoNow(),
    };
    schedulesStore.set((list) => [s, ...list]);
    return HttpResponse.json(s, { status: 201 });
  }),
  http.put("/api/reports/schedules/:id", async ({ params, request }) => {
    await latency();
    const current = schedulesStore.get().find((s) => s.id === String(params.id));
    if (!current) return fail(404, "NOT_FOUND", "This schedule was deleted.");
    const user = requirePermission("reports.view", current.campus);
    if (user instanceof Response) return user;
    const body = (await request.json()) as Partial<ReportScheduleInput> & { active?: boolean };
    if (body.recipients && !body.recipients.length) return fail(422, "VALIDATION", "Choose who gets it.", { field: "recipients" });
    const merged: ReportSchedule = { ...current, ...body } as ReportSchedule;
    const def = reportById(merged.reportId)!;
    if (def.background && merged.frequency === "DAILY") return fail(422, "VALIDATION", "This report is large; schedule it weekly or monthly.", { field: "frequency" });
    const saved: ReportSchedule = { ...merged, filterSummary: describeSchedule(def, merged.filters), nextRunAt: nextRun(merged) };
    schedulesStore.set((list) => list.map((s) => (s.id === saved.id ? saved : s)));
    return HttpResponse.json(saved);
  }),
  http.delete("/api/reports/schedules/:id", async ({ params }) => {
    await latency();
    const current = schedulesStore.get().find((s) => s.id === String(params.id));
    if (!current) return fail(404, "NOT_FOUND", "This schedule was already deleted.");
    const user = requirePermission("reports.view", current.campus);
    if (user instanceof Response) return user;
    schedulesStore.set((list) => list.filter((s) => s.id !== current.id));
    return HttpResponse.json({ status: "ok" });
  }),
  http.post("/api/reports/schedules/:id/run", async ({ params }) => {
    await latency();
    const s = schedulesStore.get().find((x) => x.id === String(params.id));
    if (!s) return fail(404, "NOT_FOUND", "This schedule was deleted.");
    const user = requirePermission("reports.view", s.campus);
    if (user instanceof Response) return user;
    const def = reportById(s.reportId)!;
    seedFor(user);
    const job = newJob(def, { reportId: s.reportId, campus: s.campus, session: s.session, filters: s.filters }, s.format, user, { scheduleId: s.id });
    reportsStore.set((st) => ({ ...st, jobs: { ...st.jobs, [user.id]: [job, ...(st.jobs[user.id] ?? [])] } }));
    schedulesStore.set((list) => list.map((x) => (x.id === s.id ? { ...x, lastRunAt: demoNow() } : x)));
    return HttpResponse.json(publicJob(job), { status: 201 });
  }),
  http.get("/api/reports/recipients", async () => {
    await latency();
    const user = requireUser();
    if (user instanceof Response) return user;
    return HttpResponse.json(RECIPIENTS);
  }),

  // ---- Staff notifications (bell) ----
  http.get("/api/notifications", async () => {
    await latency();
    const user = requireUser();
    if (user instanceof Response) return user;
    seedFor(user);
    tick(user);
    return HttpResponse.json((reportsStore.get().notifications[user.id] ?? []).slice(0, 30));
  }),
  http.post("/api/notifications/read-all", async () => {
    await latency();
    const user = requireUser();
    if (user instanceof Response) return user;
    reportsStore.set((s) => ({ ...s, notifications: { ...s.notifications, [user.id]: (s.notifications[user.id] ?? []).map((n) => ({ ...n, read: true })) } }));
    return HttpResponse.json({ status: "ok" });
  }),
  http.post("/api/notifications/:id/read", async ({ params }) => {
    await latency();
    const user = requireUser();
    if (user instanceof Response) return user;
    reportsStore.set((s) => ({ ...s, notifications: { ...s.notifications, [user.id]: (s.notifications[user.id] ?? []).map((n) => (n.id === String(params.id) ? { ...n, read: true } : n)) } }));
    return HttpResponse.json({ status: "ok" });
  }),

  // ---- Notices ----
  http.get("/api/notices", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("sms.view", ctx.campus);
    if (user instanceof Response) return user;
    return HttpResponse.json(
      noticesStore
        .get()
        .filter((n) => ctx.campus === "ALL" || n.campus === ctx.campus)
        .sort((a, b) => (b.updatedAt ?? b.publishedAt).localeCompare(a.updatedAt ?? a.publishedAt)),
    );
  }),
  http.post("/api/notices", async ({ request }) => {
    await latency();
    const body = (await request.json()) as NoticeInput & { publish: boolean };
    const user = requirePermission("sms.send", body.campus);
    if (user instanceof Response) return user;
    const bad = validateNotice(body);
    if (bad) return bad;
    const now = demoNow();
    let n: Notice = {
      id: `nt-${Date.now().toString(36)}`,
      campus: body.campus,
      title: body.title.trim(),
      titleUr: body.titleUr.trim(),
      body: body.body.trim(),
      bodyUr: body.bodyUr.trim(),
      date: body.date,
      publishedAt: now,
      publishedBy: user.name,
      audience: body.audience,
      ...(body.audience === "CLASS" ? { classSections: body.classSections ?? [] } : {}),
      status: body.publish ? "PUBLISHED" : "DRAFT",
      category: body.category,
      createdAt: now,
      createdBy: user.name,
      updatedAt: now,
      updatedBy: user.name,
      ...(body.expiresOn ? { expiresOn: body.expiresOn } : {}),
      pinned: Boolean(body.pinned),
      sendApp: Boolean(body.sendApp),
      sendSms: Boolean(body.sendSms),
    };
    n.audienceCount = audienceCountOf(n);
    if (body.publish) {
      const sent = sendNotice(n, user);
      if (sent instanceof Response) return sent;
      if (sent) n = { ...n, batchId: sent, readCount: 0 };
    }
    noticesStore.set((list) => [n, ...list]);
    return HttpResponse.json(n, { status: 201 });
  }),
  http.put("/api/notices/:id", async ({ params, request }) => {
    await latency();
    const current = noticesStore.get().find((n) => n.id === String(params.id));
    if (!current) return fail(404, "NOT_FOUND", "This notice was deleted.");
    const body = (await request.json()) as NoticeInput;
    const user = requirePermission("sms.send", current.campus);
    if (user instanceof Response) return user;
    const bad = validateNotice(body);
    if (bad) return bad;
    const saved: Notice = {
      ...current,
      title: body.title.trim(),
      titleUr: body.titleUr.trim(),
      body: body.body.trim(),
      bodyUr: body.bodyUr.trim(),
      date: body.date,
      audience: body.audience,
      category: body.category,
      pinned: Boolean(body.pinned),
      sendApp: Boolean(body.sendApp),
      sendSms: Boolean(body.sendSms),
      updatedAt: demoNow(),
      updatedBy: user.name,
    };
    if (body.audience === "CLASS") saved.classSections = body.classSections ?? [];
    else delete saved.classSections;
    if (body.expiresOn) saved.expiresOn = body.expiresOn;
    else delete saved.expiresOn;
    saved.audienceCount = audienceCountOf(saved);
    noticesStore.set((list) => list.map((n) => (n.id === saved.id ? saved : n)));
    return HttpResponse.json(saved);
  }),
  http.post("/api/notices/:id/publish", async ({ params }) => {
    await latency();
    const current = noticesStore.get().find((n) => n.id === String(params.id));
    if (!current) return fail(404, "NOT_FOUND", "This notice was deleted.");
    const user = requirePermission("sms.send", current.campus);
    if (user instanceof Response) return user;
    if (current.status === "PUBLISHED") return fail(409, "ALREADY_PUBLISHED", "This notice is already published.");
    const bad = validateNotice({ ...current, category: current.category ?? "GENERAL" });
    if (bad) return bad;
    let saved: Notice = { ...current, status: "PUBLISHED", publishedAt: demoNow(), publishedBy: user.name, updatedAt: demoNow(), updatedBy: user.name };
    delete saved.unpublishedAt;
    delete saved.unpublishedBy;
    delete saved.unpublishReason;
    // A notice taken down and published again does not send its app notification or SMS twice.
    if (!current.batchId && !current.unpublishedAt) {
      const sent = sendNotice(saved, user);
      if (sent instanceof Response) return sent;
      if (sent) saved = { ...saved, batchId: sent, readCount: 0 };
    }
    noticesStore.set((list) => list.map((n) => (n.id === saved.id ? saved : n)));
    return HttpResponse.json(saved);
  }),
  http.post("/api/notices/:id/unpublish", async ({ params, request }) => {
    await latency();
    const current = noticesStore.get().find((n) => n.id === String(params.id));
    if (!current) return fail(404, "NOT_FOUND", "This notice was deleted.");
    const user = requirePermission("sms.send", current.campus);
    if (user instanceof Response) return user;
    if (current.status !== "PUBLISHED") return fail(409, "NOT_PUBLISHED", "This notice is not published.");
    const { reason } = (await request.json()) as { reason: string };
    if (!reason?.trim()) return fail(422, "VALIDATION", "Say why it is being taken down. It is kept with the notice.", { field: "reason" });
    const saved: Notice = { ...current, status: "DRAFT", unpublishedAt: demoNow(), unpublishedBy: user.name, unpublishReason: reason.trim(), updatedAt: demoNow(), updatedBy: user.name };
    noticesStore.set((list) => list.map((n) => (n.id === saved.id ? saved : n)));
    return HttpResponse.json(saved);
  }),
  http.delete("/api/notices/:id", async ({ params }) => {
    await latency();
    const current = noticesStore.get().find((n) => n.id === String(params.id));
    if (!current) return fail(404, "NOT_FOUND", "This notice was already deleted.");
    const user = requirePermission("sms.send", current.campus);
    if (user instanceof Response) return user;
    if (current.status === "PUBLISHED" || current.unpublishedAt) return fail(409, "WAS_PUBLISHED", "Families have seen this notice, so it is kept for the record. Take it down instead.");
    noticesStore.set((list) => list.filter((n) => n.id !== current.id));
    return HttpResponse.json({ status: "ok" });
  }),
];

