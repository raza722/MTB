// Staff and payroll mock handlers and stores — owned by the hr feature.
// The rules mirror the planned hr.usp_* procedures (modernization doc 30 §e): one profile per person with a posting per
// campus, effective-dated salary, increments and salary sheets that need a second person's approval, loan installments
// that stop exactly at the balance, and device punches stored idempotently (the machine is never cleared).
import {
  can,
  HR_CATEGORY_LABEL,
  hrMonthLabel,
  hrMonthlyTax,
  hrSessionMonths,
  type CampusCode,
  type CampusScope,
  type HrAttendanceDay,
  type HrAttendanceMonth,
  type HrAttendanceRange,
  type HrAuditEntry,
  type HrCampusSettings,
  type HrCategory,
  type HrDayEntryInput,
  type HrDayRow,
  type HrDayStatus,
  type HrDocument,
  type HrDuplicateDetails,
  type HrExperienceReport,
  type HrImportBatch,
  type HrImportCommitInput,
  type HrImportPreview,
  type HrIncrementCriteria,
  type HrIncrementInput,
  type HrIncrementLine,
  type HrIncrementRun,
  type HrIncrementRunSummary,
  type HrLeaveBalance,
  type HrLeaveBalanceRow,
  type HrLeaveData,
  type HrLeaveInput,
  type HrLeaveRequest,
  type HrLeaveType,
  type HrLoan,
  type HrLoanData,
  type HrLoanInput,
  type HrLoanSummary,
  type HrLoanType,
  type HrMonthCode,
  type HrMyAttendance,
  type HrNewStaffInput,
  type HrOverview,
  type HrPayDefaults,
  type HrPayDetails,
  type HrPayInput,
  type HrPayItem,
  type HrPayLine,
  type HrPayrollOverview,
  type HrPayrollRun,
  type HrPayrollRunSummary,
  type HrPayrollStatus,
  type HrPayrollTotals,
  type HrPayslip,
  type HrPayslipInput,
  type HrPersonalInput,
  type HrPosting,
  type HrPostingInput,
  type HrRangeRow,
  type HrRunStatus,
  type HrSalaryHistory,
  type HrSalaryStructureRow,
  type HrSettings,
  type HrSettingsSection,
  type HrStaffProfile,
  type HrStaffSummary,
  type HrStrengthReport,
  type Permission,
  type SessionUser,
} from "@mtb/api";
import { formatDate, formatRs, isValidCnic, normalizeMobile, type IsoDate } from "@mtb/domain";
import { http, type HttpHandler } from "msw";
import { DEMO_TODAY, demoNow } from "../clock";
import { createStore } from "../db";
import { calendarSeed } from "../fixtures/attendance";
import { campusName } from "../fixtures/campuses";
import {
  BANKS,
  criteriaAmount,
  DEPARTMENTS,
  DESIGNATIONS,
  hash01,
  initialCampusSettings,
  initialCriteria,
  initialLeave,
  initialLoans,
  initialStaff,
  LEAVE_TYPES,
  LOAN_TYPES,
  NO_SCALE_HOUSE_RENT_PCT,
  PAY_DEFAULTS,
  PAY_SCALES,
  TEACHING_LEVELS,
  type CampusSettingsRec,
  type DocRec,
  type LeaveRec,
  type LoanRec,
  type PostingRec,
  type StaffRec,
} from "../fixtures/hr";
import { initialSubjects } from "../fixtures/setup";
import { ctxFrom, fail, HttpResponse, latency, requirePermission, requireUser } from "../util";
import { calendarEventsBetween } from "./attendance";

/* ================================================================== Dates */

const TODAY = DEMO_TODAY;
const THIS_MONTH = TODAY.slice(0, 7);
const CURRENT_SESSION = 2026;
const SESSION_START = (s: number) => `${s}-04-01`;
const SESSION_END = (s: number) => `${s + 1}-03-31`;
const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const addDays = (d: IsoDate, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const weekday = (d: IsoDate) => new Date(`${d}T00:00:00Z`).getUTCDay();
const monthDates = (m: string) => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  const n = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${m}-${pad(i + 1)}`);
};
const nextMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return mo === 12 ? `${y + 1}-01` : `${y}-${pad(mo + 1)}`;
};
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fromMin = (n: number) => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;
const yearsBetween = (from: IsoDate, to: IsoDate) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / (365.25 * 86_400_000);
const round1 = (n: number) => Math.round(n * 10) / 10;
const sessionOf = (d: IsoDate) => (Number(d.slice(5, 7)) >= 4 ? Number(d.slice(0, 4)) : Number(d.slice(0, 4)) - 1);
const isTime = (t: unknown): t is string => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const isDate = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
const whole = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const newId = (p: string) => `${p}-${Math.random().toString(36).slice(2, 9)}`;

/* ================================================================== Calendar */

/** The calendar as it was when the demo starts: only for salary sheets paid before the demo, so they never change. */
const SEED_CALENDAR = calendarSeed();

/**
 * A holiday or vacation that closes the campus on a date, from the live school calendar (/attendance/calendar), so a
 * holiday added there reaches the daily register, monthly sheet, leave day counts and unpaid days in payroll. Event days
 * that close the student registers (parent–teacher day, annual day) are still working days for staff.
 */
function holidayName(campus: CampusCode, date: IsoDate, env?: Pick<Env, "pristine">): string | null {
  const entries = env?.pristine ? SEED_CALENDAR.filter((x) => (x.campus === "ALL" || x.campus === campus) && x.from <= date && x.to >= date) : calendarEventsBetween(campus, date, date);
  return entries.find((x) => (x.kind === "HOLIDAY" || x.kind === "VACATION") && x.closesRegisters)?.name ?? null;
}
/** Events and exams on the live calendar between two dates, for the leave "happening on those days" note. */
function eventsBetween(campus: CampusCode, from: IsoDate, to: IsoDate): string[] {
  return calendarEventsBetween(campus, from, to)
    .filter((x) => x.kind === "EVENT" || x.kind === "EXAM")
    .sort((a, b) => a.from.localeCompare(b.from))
    .map((x) => `${x.name} (${formatDate(x.from)}${x.to !== x.from ? ` to ${formatDate(x.to)}` : ""})`);
}

/* ================================================================== Stores */

interface IncRunRec {
  id: string;
  campus: CampusCode;
  session: number;
  title: string;
  method: HrIncrementRun["method"];
  value: number | null;
  filter: HrIncrementRun["filter"];
  experienceAsOf: IsoDate;
  effectiveFrom: IsoDate;
  status: HrRunStatus;
  lines: HrIncrementLine[];
  preparedBy: string;
  preparedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  history: HrAuditEntry[];
}

interface PayRunRec {
  id: string;
  campus: CampusCode;
  month: string;
  status: HrPayrollStatus;
  /** null: a sheet paid before this demo, worked out from the starting records. */
  lines: HrPayslip[] | null;
  preparedBy: string;
  preparedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  paidBy: string | null;
  paymentDate: IsoDate | null;
  history: HrAuditEntry[];
}

interface OverrideRec {
  status: HrDayStatus;
  timeIn: string | null;
  timeOut: string | null;
  note: string | null;
  by: string;
}

interface ImportedRec {
  firstIn: string;
  lastOut: string | null;
}

interface WorkState {
  leave: LeaveRec[];
  loans: LoanRec[];
  increments: IncRunRec[];
  payroll: PayRunRec[];
  overrides: Record<string, Record<string, OverrideRec>>;
  imported: Record<string, Record<string, ImportedRec>>;
  punchKeys: Record<string, string[]>;
  batches: HrImportBatch[];
  childFee: Array<{ runId: string; staffId: string; grNo: string; name: string; month: string; amount: number }>;
  idem: Record<string, string>;
}

interface SettingsState {
  designations: Array<{ id: string; title: string; category: HrCategory; active: boolean }>;
  departments: Array<{ id: string; title: string; active: boolean }>;
  leaveTypes: HrLeaveType[];
  loanTypes: HrLoanType[];
  criteria: HrIncrementCriteria[];
  payDefaults: HrPayDefaults;
  campuses: CampusSettingsRec[];
  rowVer: number;
  updatedBy: string;
  updatedAt: string;
}

const initialSettings = (): SettingsState => ({
  designations: DESIGNATIONS.map((d) => ({ ...d })),
  departments: DEPARTMENTS.map((d) => ({ ...d })),
  leaveTypes: LEAVE_TYPES.map((t) => ({ ...t })),
  loanTypes: LOAN_TYPES.map((t) => ({ ...t })),
  criteria: initialCriteria(),
  payDefaults: { ...PAY_DEFAULTS },
  campuses: initialCampusSettings(),
  rowVer: 3,
  updatedBy: "Nadia Shah",
  updatedAt: "2026-10-01T10:00:00+05:00",
});

/**
 * Staff records: the generated starting records stay in memory and only changed or added records are kept in
 * sessionStorage (the full register is several hundred kilobytes).
 */
interface StaffOverlay {
  edited: Record<string, StaffRec>;
  added: StaffRec[];
}
const staffOverlay = createStore<StaffOverlay>("hr-staff", () => ({ edited: {}, added: [] }));
let baseStaff: StaffRec[] | null = null;
let merged: { ref: StaffOverlay; list: StaffRec[] } | null = null;
const staffStore = {
  get(): StaffRec[] {
    const o = staffOverlay.get();
    if (merged && merged.ref === o) return merged.list;
    baseStaff ??= initialStaff();
    const list = [...baseStaff, ...o.added].map((s) => o.edited[s.id] ?? s);
    merged = { ref: o, list };
    return list;
  },
  set(update: (all: StaffRec[]) => StaffRec[]) {
    const before = staffStore.get();
    const after = update(before);
    const prev = new Map(before.map((s) => [s.id, s]));
    staffOverlay.set((o) => {
      const edited = { ...o.edited };
      const added = [...o.added];
      for (const s of after) {
        const was = prev.get(s.id);
        if (!was) added.push(s);
        else if (was !== s) edited[s.id] = s;
      }
      return { edited, added };
    });
  },
};
const settingsStore = createStore<SettingsState>("hr-settings", initialSettings);
const workStore = createStore<WorkState>("hr-work", initialWork);

/** Calculation context: the live stores, or the starting records (for salary sheets paid before the demo). */
interface Env {
  staff: StaffRec[];
  leave: LeaveRec[];
  loans: LoanRec[];
  settings: SettingsState;
  overrides: WorkState["overrides"];
  imported: WorkState["imported"];
  pristine: boolean;
}

let fixtureEnv: Env | null = null;
function pristineEnv(): Env {
  if (!fixtureEnv) {
    const staff = initialStaff();
    fixtureEnv = { staff, leave: initialLeave(staff), loans: initialLoans(staff), settings: initialSettings(), overrides: {}, imported: {}, pristine: true };
  }
  return fixtureEnv;
}
function liveEnv(): Env {
  const w = workStore.get();
  return { staff: staffStore.get(), leave: w.leave, loans: w.loans, settings: settingsStore.get(), overrides: w.overrides, imported: w.imported, pristine: false };
}

/* ================================================================== Staff helpers */

const designation = (st: SettingsState, id: string) => st.designations.find((d) => d.id === id);
const department = (st: SettingsState, id: string) => st.departments.find((d) => d.id === id);
const campusSettings = (st: SettingsState, campus: CampusCode) => st.campuses.find((c) => c.campus === campus)!;

const postingActiveOn = (p: PostingRec, date: IsoDate) => p.startDate <= date && (!p.endDate || p.endDate >= date);
function postingAt(s: StaffRec, campus: CampusCode, date: IsoDate = TODAY): PostingRec | undefined {
  return s.postings.find((p) => p.campus === campus && postingActiveOn(p, date)) ?? s.postings.filter((p) => p.campus === campus).sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
}
const primaryPosting = (s: StaffRec) => s.postings.find((p) => p.primary) ?? s.postings[0]!;
function postingFor(s: StaffRec, scope: CampusScope): PostingRec {
  return scope === "ALL" ? primaryPosting(s) : (postingAt(s, scope) ?? primaryPosting(s));
}
const worksAt = (s: StaffRec, scope: CampusScope) => scope === "ALL" || s.postings.some((p) => p.campus === scope);
const activeAt = (s: StaffRec, campus: CampusCode, date: IsoDate = TODAY) => s.postings.some((p) => p.campus === campus && postingActiveOn(p, date));
const joiningDate = (s: StaffRec) => s.postings.reduce((a, p) => (p.startDate < a ? p.startDate : a), s.postings[0]!.startDate);
const serviceYears = (s: StaffRec, asOf: IsoDate = TODAY) => Math.max(0, round1(yearsBetween(joiningDate(s), asOf) + s.priorServiceYears));
const categoryOf = (st: SettingsState, _s: StaffRec, p: PostingRec) => designation(st, p.designationId)?.category ?? "TEACHING";
const isTeachingCat = (c: HrCategory) => c === "TEACHING" || c === "VISITING" || c === "HIFZ";

function basicOn(s: StaffRec, date: IsoDate): number {
  const rows = s.salary.filter((r) => r.effectiveFrom <= date).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  return rows.at(-1)?.basic ?? 0;
}

function canPay(user: SessionUser, scope: CampusScope) {
  return can(user, "payroll.manage", scope) || can(user, "approvals.decide", scope);
}
/** Allowed at the staff member's campus (any posting), or with an all-campus grant. */
function canFor(user: SessionUser, perm: Permission, s: StaffRec) {
  return can(user, perm, "ALL") || s.postings.some((p) => can(user, perm, p.campus));
}
function requireFor(perm: Permission, s: StaffRec): SessionUser | Response {
  const user = requireUser();
  if (user instanceof Response) return user;
  if (!canFor(user, perm, s)) return fail(403, "FORBIDDEN", "Your role can't change this staff record.");
  return user;
}
const audit = (by: string, text: string, detail?: string): HrAuditEntry => ({ id: newId("h"), at: demoNow(), by, text, ...(detail ? { detail } : {}) });

function onApprovedLeave(env: Env, staffId: string, date: IsoDate): LeaveRec | undefined {
  return env.leave.find((l) => l.staffId === staffId && l.status === "APPROVED" && l.from <= date && l.to >= date);
}

/* ================================================================== Pay structure */

function standingPay(s: StaffRec, p: PostingRec, basic: number, d: HrPayDefaults): { allowances: HrPayItem[]; deductions: HrPayItem[] } {
  if (p.employmentType === "VISITING") return { allowances: [], deductions: [] };
  const scaled = Boolean(p.payScale && p.payScale !== "0");
  const hraPct = scaled ? d.houseRentPct : NO_SCALE_HOUSE_RENT_PCT;
  const allowances: HrPayItem[] = [
    { code: "HOUSE_RENT", label: "House rent", amount: Math.round((basic * hraPct) / 100), basis: `${hraPct}% of basic` },
    { code: "CONVEYANCE", label: "Conveyance", amount: d.conveyance },
    { code: "MEDICAL", label: "Medical", amount: d.medical },
  ];
  if (s.pay.specialAllowance > 0) allowances.push({ code: "SPECIAL", label: "Special allowance", amount: s.pay.specialAllowance, basis: "Responsibility allowance" });
  const gross = basic + sum(allowances.map((a) => a.amount));
  const deductions: HrPayItem[] = [];
  if (s.pay.eobi) deductions.push({ code: "EOBI", label: "EOBI", amount: d.eobi, basis: "Employee's share" });
  if (s.pay.providentFund) deductions.push({ code: "PF", label: "Provident fund", amount: Math.round((basic * d.providentFundPct) / 100), basis: `${d.providentFundPct}% of basic` });
  const tax = hrMonthlyTax(gross);
  if (tax > 0) deductions.push({ code: "TAX", label: "Income tax", amount: tax, basis: `On ${formatRs(gross * 12)} a year` });
  return { allowances, deductions };
}

/* ================================================================== Attendance */

interface DayInfo {
  status: HrDayStatus | null;
  timeIn: string | null;
  timeOut: string | null;
  lateMinutes: number;
  source: HrDayRow["source"];
  leaveType: string | null;
  note: string | null;
  editedBy: string | null;
  paidLeave: boolean;
}

const lateAfter = (cs: CampusSettingsRec) => toMin(cs.dayStarts) + cs.graceMinutes;
const dayKey = (campus: CampusCode, date: IsoDate) => `${campus}|${date}`;

/** What the register looked like on a past day (deterministic), for days before the demo. */
function generated(env: Env, s: StaffRec, campus: CampusCode, date: IsoDate): Pick<DayInfo, "status" | "timeIn" | "timeOut" | "lateMinutes"> {
  const cs = campusSettings(env.settings, campus);
  const r = hash01(`${s.id}|${date}`);
  const r2 = hash01(`${date}|${s.id}|t`);
  const prone = hash01(`${s.id}|prone`) < 0.06;
  const start = toMin(cs.dayStarts);
  const limit = lateAfter(cs);
  const p = postingAt(s, campus, date);
  const teaching = p ? isTeachingCat(categoryOf(env.settings, s, p)) || p.designationId === "d-head" : true;
  const outBase = teaching ? toMin("13:35") : toMin("15:30");
  const device = cs.attendanceDevice;
  if (r < 0.007) return { status: "ABSENT", timeIn: null, timeOut: null, lateMinutes: 0 };
  if (r < 0.011) return { status: "HALF_DAY", timeIn: device ? fromMin(start - 10) : null, timeOut: device ? fromMin(toMin("11:00") + Math.floor(r2 * 20)) : null, lateMinutes: 0 };
  if (r < 0.045 || (prone && r < 0.26)) {
    const late = 1 + Math.floor(r2 * 34);
    return { status: "LATE", timeIn: device ? fromMin(limit + late) : null, timeOut: device ? fromMin(outBase + Math.floor(r2 * 45)) : null, lateMinutes: device ? late + (limit - start) : 0 };
  }
  return { status: "PRESENT", timeIn: device ? fromMin(start - 25 + Math.floor(r2 * 34)) : null, timeOut: device ? fromMin(outBase + Math.floor(hash01(`${s.id}${date}o`) * 50)) : null, lateMinutes: 0 };
}

/** The day for one staff member at one campus: holiday → manual change → approved leave → machine → past register. */
function resolveDay(env: Env, s: StaffRec, campus: CampusCode, date: IsoDate): DayInfo | null {
  const p = s.postings.find((x) => x.campus === campus && postingActiveOn(x, date));
  if (!p) return null;
  const blank: DayInfo = { status: null, timeIn: null, timeOut: null, lateMinutes: 0, source: null, leaveType: null, note: null, editedBy: null, paidLeave: false };
  const hol = holidayName(campus, date, env);
  if (hol) return { ...blank, status: "HOLIDAY", source: "CALENDAR", note: hol };
  const wd = weekday(date);
  if (wd === 0 || (p.workDays && !p.workDays.includes(wd))) return { ...blank, status: "OFF", source: "CALENDAR", note: wd === 0 ? "Sunday" : "Not a working day at this campus" };
  const cs = campusSettings(env.settings, campus);
  const ov = env.overrides[dayKey(campus, date)]?.[s.id];
  if (ov) {
    const late = ov.status === "LATE" && ov.timeIn ? Math.max(0, toMin(ov.timeIn) - toMin(cs.dayStarts)) : 0;
    const lv = ov.status === "LEAVE" ? onApprovedLeave(env, s.id, date) : undefined;
    return { ...blank, status: ov.status, timeIn: ov.timeIn, timeOut: ov.timeOut, lateMinutes: late, source: "MANUAL", note: ov.note, editedBy: ov.by, leaveType: lv ? (env.settings.leaveTypes.find((t) => t.id === lv.typeId)?.name ?? null) : null, paidLeave: lv ? (env.settings.leaveTypes.find((t) => t.id === lv.typeId)?.paid ?? true) : true };
  }
  const lv = onApprovedLeave(env, s.id, date);
  if (lv) {
    const t = env.settings.leaveTypes.find((x) => x.id === lv.typeId);
    return { ...blank, status: lv.halfDay ? "HALF_DAY" : "LEAVE", source: "LEAVE", leaveType: t?.name ?? "Leave", paidLeave: t?.paid ?? true, note: lv.halfDay ? `Half day ${t?.name.toLowerCase() ?? "leave"}` : null };
  }
  const imp = env.imported[dayKey(campus, date)]?.[s.id];
  if (imp) {
    const late = toMin(imp.firstIn) > lateAfter(cs);
    return { ...blank, status: late ? "LATE" : "PRESENT", timeIn: imp.firstIn, timeOut: imp.lastOut, lateMinutes: late ? toMin(imp.firstIn) - toMin(cs.dayStarts) : 0, source: "DEVICE" };
  }
  if (date >= TODAY) return blank;
  const g = generated(env, s, campus, date);
  return { ...blank, ...g, source: cs.attendanceDevice ? "DEVICE" : "MANUAL", editedBy: cs.attendanceDevice ? null : "Office register" };
}

function staffAtOn(env: Env, campus: CampusCode, from: IsoDate, to: IsoDate) {
  return env.staff
    .filter((s) => s.postings.some((p) => p.campus === campus && p.startDate <= to && (!p.endDate || p.endDate >= from)))
    .sort((a, b) => {
      const ca = categoryOf(env.settings, a, postingAt(a, campus, to) ?? primaryPosting(a));
      const cb = categoryOf(env.settings, b, postingAt(b, campus, to) ?? primaryPosting(b));
      const order: HrCategory[] = ["MANAGEMENT", "TEACHING", "HIFZ", "VISITING", "NON_TEACHING"];
      return order.indexOf(ca) - order.indexOf(cb) || a.name.replace(/^(Mr|Ms|Mrs|Dr|Qari)\s+/, "").localeCompare(b.name.replace(/^(Mr|Ms|Mrs|Dr|Qari)\s+/, ""));
    });
}

function buildDay(campus: CampusCode, date: IsoDate): HrAttendanceDay {
  const env = liveEnv();
  const cs = campusSettings(env.settings, campus);
  const hol = holidayName(campus, date, env);
  const closed = hol ? { name: hol } : weekday(date) === 0 ? { name: "Sunday" } : null;
  const rows: HrDayRow[] = [];
  for (const s of staffAtOn(env, campus, date, date)) {
    const info = resolveDay(env, s, campus, date);
    if (!info) continue;
    const p = postingAt(s, campus, date)!;
    rows.push({
      staffId: s.id,
      name: s.name,
      employeeNo: s.employeeNo,
      designationId: p.designationId,
      designation: designation(env.settings, p.designationId)?.title ?? "",
      category: categoryOf(env.settings, s, p),
      deviceEnrolNo: p.deviceEnrolNo,
      timeIn: info.timeIn,
      timeOut: info.timeOut,
      status: info.status,
      lateMinutes: info.lateMinutes,
      source: info.source,
      leaveType: info.leaveType,
      note: info.note,
      editedBy: info.editedBy,
    });
  }
  const working = rows.filter((r) => r.status !== "OFF" && r.status !== "HOLIDAY");
  const w = workStore.get();
  return {
    campus,
    date,
    closed,
    dayStarts: cs.dayStarts,
    graceMinutes: cs.graceMinutes,
    lateAfter: fromMin(lateAfter(cs)),
    rows,
    summary: {
      total: working.length,
      present: working.filter((r) => r.status === "PRESENT").length,
      late: working.filter((r) => r.status === "LATE").length,
      absent: working.filter((r) => r.status === "ABSENT").length,
      leave: working.filter((r) => r.status === "LEAVE").length,
      halfDay: working.filter((r) => r.status === "HALF_DAY").length,
      notMarked: working.filter((r) => r.status === null).length,
    },
    deviceName: cs.attendanceDevice ? cs.deviceName : null,
    lastImport: w.batches.filter((b) => b.campus === campus).sort((a, b) => b.importedAt.localeCompare(a.importedAt))[0] ?? null,
  };
}

const CODE: Record<HrDayStatus, HrMonthCode> = { PRESENT: "P", LATE: "LT", ABSENT: "A", LEAVE: "LV", HALF_DAY: "HD", HOLIDAY: "H", OFF: "OFF" };

function buildMonth(campus: CampusCode, month: string): HrAttendanceMonth {
  const env = liveEnv();
  const dates = monthDates(month);
  const days = dates.map((date) => ({ date, weekday: weekday(date), holiday: holidayName(campus, date, env), future: date > TODAY }));
  const late: HrAttendanceMonth["late"] = [];
  const byDay = new Map(dates.map((d) => [d, { date: d, present: 0, late: 0, absent: 0, leave: 0 }]));
  const rows = staffAtOn(env, campus, dates[0]!, dates.at(-1)!).map((s) => {
    const p = postingAt(s, campus, dates.at(-1)!) ?? primaryPosting(s);
    const row = { staffId: s.id, name: s.name, employeeNo: s.employeeNo, designationId: p.designationId, designation: designation(env.settings, p.designationId)?.title ?? "", codes: {} as Partial<Record<IsoDate, HrMonthCode>>, present: 0, late: 0, absent: 0, leave: 0, halfDay: 0, lateMinutes: 0, percent: null as number | null, nameUrdu: s.nameUrdu, workedMinutes: 0, offDays: 0 };
    let working = 0;
    for (const d of dates) {
      if (d > TODAY) continue;
      const info = resolveDay(env, s, campus, d);
      if (!info || !info.status) continue;
      row.codes[d] = CODE[info.status];
      if (info.timeIn && info.timeOut) row.workedMinutes += Math.max(0, toMin(info.timeOut) - toMin(info.timeIn));
      if (info.status === "OFF" && info.source === "MANUAL") row.offDays++;
      const b = byDay.get(d)!;
      if (info.status === "PRESENT") (row.present++, b.present++);
      if (info.status === "LATE") {
        row.late++;
        b.late++;
        row.lateMinutes += info.lateMinutes;
        late.push({ staffId: s.id, name: s.name, designation: row.designation, date: d, timeIn: info.timeIn ?? "—", lateMinutes: info.lateMinutes });
      }
      if (info.status === "ABSENT") (row.absent++, b.absent++);
      if (info.status === "LEAVE") (row.leave++, b.leave++);
      if (info.status === "HALF_DAY") (row.halfDay++, b.present++);
      if (info.status !== "HOLIDAY" && info.status !== "OFF") working++;
    }
    row.percent = working ? round1(((row.present + row.late + row.halfDay * 0.5) / working) * 100) : null;
    return row;
  });
  return {
    campus,
    month,
    days,
    rows,
    late: late.sort((a, b) => b.date.localeCompare(a.date) || b.lateMinutes - a.lateMinutes),
    byDay: [...byDay.values()].filter((d) => d.date <= TODAY && !holidayName(campus, d.date, env) && weekday(d.date) !== 0),
    workingDays: days.filter((d) => !d.holiday && d.weekday !== 0 && !d.future).length,
  };
}

/** Longest date range the attendance report covers in one go (about three months). */
const RANGE_MAX_DAYS = 93;

/** Status and time in/out per person per day over a date range: the same day rules as the daily register. */
function buildRange(campus: CampusCode, from: IsoDate, to: IsoDate, filter: { designationId?: string | null; staffId?: string | null }): HrAttendanceRange {
  const env = liveEnv();
  const dates: IsoDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  const days = dates.map((date) => ({ date, weekday: weekday(date), holiday: holidayName(campus, date, env) }));
  const rows: HrRangeRow[] = [];
  for (const s of staffAtOn(env, campus, from, to)) {
    if (filter.staffId && s.id !== filter.staffId) continue;
    const p = postingAt(s, campus, to) ?? primaryPosting(s);
    if (filter.designationId && p.designationId !== filter.designationId) continue;
    const row: HrRangeRow = { staffId: s.id, name: s.name, employeeNo: s.employeeNo, designationId: p.designationId, designation: designation(env.settings, p.designationId)?.title ?? "", cells: {}, present: 0, late: 0, absent: 0, leave: 0, halfDay: 0, lateMinutes: 0, workedMinutes: 0, percent: null };
    let working = 0;
    for (const d of dates) {
      const info = resolveDay(env, s, campus, d);
      if (!info) continue;
      const worked = info.timeIn && info.timeOut ? Math.max(0, toMin(info.timeOut) - toMin(info.timeIn)) : 0;
      row.cells[d] = { status: info.status, timeIn: info.timeIn, timeOut: info.timeOut, lateMinutes: info.lateMinutes, workedMinutes: worked, leaveType: info.leaveType, source: info.source, note: info.note };
      if (!info.status) continue;
      if (info.status === "PRESENT") row.present++;
      if (info.status === "LATE") (row.late++, (row.lateMinutes += info.lateMinutes));
      if (info.status === "ABSENT") row.absent++;
      if (info.status === "LEAVE") row.leave++;
      if (info.status === "HALF_DAY") row.halfDay++;
      if (info.status !== "HOLIDAY" && info.status !== "OFF") working++;
      row.workedMinutes += worked;
    }
    row.percent = working ? round1(((row.present + row.late + row.halfDay * 0.5) / working) * 100) : null;
    rows.push(row);
  }
  return { campus, from, to, days, rows, workingDays: days.filter((d) => !d.holiday && d.weekday !== 0).length };
}

/* ---------------------------------------------------------------- Fingerprint machine export */

const secondsFor = (k: string) => pad(Math.floor(hash01(k) * 60));

function deviceFile(campus: CampusCode): { fileName: string; text: string } {
  const env = liveEnv();
  const lines: string[] = ["No,EnrollNo,DateTime,VerifyMode,InOutMode,DeviceId"];
  let n = 0;
  const push = (enrol: string, date: IsoDate, time: string, key: string) => lines.push(`${++n},${enrol},${date} ${time}:${secondsFor(key)},FP,0,1`);
  const yesterday = addDays(TODAY, -1);
  const people = env.staff.filter((s) => activeAt(s, campus));
  // Yesterday's punches again (the machine keeps its log; the system skips what it already has).
  for (const s of people) {
    const p = postingAt(s, campus)!;
    if (!p.deviceEnrolNo) continue;
    const info = resolveDay(env, s, campus, yesterday);
    if (!info?.timeIn) continue;
    push(p.deviceEnrolNo, yesterday, info.timeIn, `${s.id}|${yesterday}|in`);
    if (info.timeOut) push(p.deviceEnrolNo, yesterday, info.timeOut, `${s.id}|${yesterday}|out`);
  }
  // This morning.
  const cs = campusSettings(env.settings, campus);
  for (const s of people) {
    const p = postingAt(s, campus)!;
    const wd = weekday(TODAY);
    if (p.workDays && !p.workDays.includes(wd)) continue;
    if (onApprovedLeave(env, s.id, TODAY)) continue;
    const r = hash01(`${s.id}|${TODAY}|dev`);
    if (r < 0.03) continue; // absent today
    const enrol = p.deviceEnrolNo ?? (s.name === "Ms Mehwish Anjum" ? "1166" : null);
    if (!enrol) continue;
    const start = toMin(cs.dayStarts);
    const mins = r < 0.11 ? lateAfter(cs) + 1 + Math.floor(hash01(`${s.id}|late`) * 30) : start - 26 + Math.floor(hash01(`${s.id}|on`) * 35);
    push(enrol, TODAY, fromMin(mins), `${s.id}|${TODAY}|in`);
    if (r > 0.95) push(enrol, TODAY, fromMin(mins), `${s.id}|${TODAY}|again`); // pressed twice
  }
  push("3001", TODAY, "07:59", "test");
  lines.splice(Math.min(lines.length - 3, 60), 0, `${++n},1205,04/11/2026 7:4x,FP,0,1`);
  return { fileName: `attlog_${campus}_${TODAY}.csv`, text: lines.join("\n") };
}

interface ParsedPunch {
  enrol: string;
  date: IsoDate;
  time: string;
  seconds: string;
}

const previews = new Map<string, { campus: CampusCode; fileName: string; punches: ParsedPunch[]; preview: HrImportPreview }>();

function parsePunches(text: string): { punches: ParsedPunch[]; bad: HrImportPreview["badLines"]; lines: number } {
  const rows = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const bad: HrImportPreview["badLines"] = [];
  const punches: ParsedPunch[] = [];
  if (!rows.length) return { punches, bad, lines: 0 };
  const sep = rows[0]!.includes("\t") ? "\t" : ",";
  const head = rows[0]!.split(sep).map((h) => h.trim().toLowerCase().replace(/[^a-z]/g, ""));
  const hasHeader = head.some((h) => /enroll|acno|userid|^id$/.test(h));
  const enrolCol = hasHeader ? head.findIndex((h) => /enroll|acno|userid|^id$/.test(h)) : 0;
  const timeCol = hasHeader ? head.findIndex((h) => /datetime|checktime|time|date/.test(h)) : 1;
  rows.slice(hasHeader ? 1 : 0).forEach((raw, i) => {
    const line = i + (hasHeader ? 2 : 1);
    const cols = raw.split(sep).map((c) => c.trim());
    const enrol = cols[enrolCol] ?? "";
    const dt = cols[timeCol] ?? "";
    if (!/^\d{1,8}$/.test(enrol)) return void bad.push({ line, text: raw.slice(0, 60), problem: "No enrolment number on this line." });
    let m = dt.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    let date = "";
    if (m) date = `${m[1]}-${m[2]}-${m[3]}`;
    else {
      m = dt.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2})(?::(\d{2}))?$/);
      if (m) date = `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
    }
    if (!m || !isDate(date)) return void bad.push({ line, text: raw.slice(0, 60), problem: "The date or time can't be read." });
    const hh = m[4]!;
    const mm = m[5]!;
    if (Number(hh) > 23) return void bad.push({ line, text: raw.slice(0, 60), problem: "The time can't be read." });
    if (date > TODAY) return void bad.push({ line, text: raw.slice(0, 60), problem: "The date is in the future: check the machine's clock." });
    if (date < SESSION_START(CURRENT_SESSION)) return void bad.push({ line, text: raw.slice(0, 60), problem: "The date is before this session." });
    punches.push({ enrol, date, time: `${pad(Number(hh))}:${mm}`, seconds: m[6] ?? "00" });
  });
  return { punches, bad, lines: rows.length - (hasHeader ? 1 : 0) };
}

/* ================================================================== Leave */

function workingDaysBetween(campus: CampusCode, from: IsoDate, to: IsoDate, s?: StaffRec): number {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (weekday(d) === 0 || holidayName(campus, d)) continue;
    const p = s ? postingAt(s, campus, d) : undefined;
    if (p?.workDays && !p.workDays.includes(weekday(d))) continue;
    n++;
    if (n > 400) break;
  }
  return n;
}
const leaveDays = (l: Pick<LeaveRec, "campus" | "from" | "to" | "halfDay">, s?: StaffRec) => (l.halfDay ? 0.5 : workingDaysBetween(l.campus, l.from, l.to, s));

function balancesFor(env: Env, s: StaffRec, session: number): HrLeaveBalance[] {
  return env.settings.leaveTypes
    .filter((t) => t.active)
    .map((t) => {
      const mine = env.leave.filter((l) => l.staffId === s.id && l.typeId === t.id && l.session === session);
      const taken = sum(mine.filter((l) => l.status === "APPROVED").map((l) => leaveDays(l, s)));
      const pending = sum(mine.filter((l) => l.status === "PENDING").map((l) => leaveDays(l, s)));
      const entitled = t.daysPerYear;
      return { typeId: t.id, typeName: t.name, entitled, taken, pending, left: entitled === null ? null : Math.max(0, entitled - taken) };
    });
}

function toLeave(env: Env, l: LeaveRec): HrLeaveRequest {
  const s = env.staff.find((x) => x.id === l.staffId)!;
  const p = postingAt(s, l.campus, l.from) ?? primaryPosting(s);
  const t = env.settings.leaveTypes.find((x) => x.id === l.typeId)!;
  const days = leaveDays(l, s);
  const bal = balancesFor(env, s, l.session).find((b) => b.typeId === l.typeId);
  const leftAfter = bal?.left === null || bal === undefined ? null : l.status === "PENDING" ? bal.left - days : bal.left;
  const cat = categoryOf(env.settings, s, p);
  return {
    id: l.id,
    staffId: s.id,
    staffName: s.name,
    employeeNo: s.employeeNo,
    designationId: p.designationId,
    designation: designation(env.settings, p.designationId)?.title ?? "",
    category: cat,
    campus: l.campus,
    campusName: campusName(l.campus),
    session: l.session,
    typeId: l.typeId,
    typeName: t?.name ?? "Leave",
    paid: t?.paid ?? true,
    from: l.from,
    to: l.to,
    days,
    halfDay: l.halfDay,
    reason: l.reason,
    status: l.status,
    source: l.source,
    requestedBy: l.requestedBy,
    requestedAt: l.requestedAt,
    decidedBy: l.decidedBy,
    decidedAt: l.decidedAt,
    decisionNote: l.decisionNote,
    leftAfter,
    overBalance: leftAfter !== null && leftAfter < 0,
    periodsToCover: isTeachingCat(cat) || p.designationId === "d-head" ? Math.round(days * 5) : null,
    clashes: eventsBetween(l.campus, l.from, l.to),
    history: l.history,
  };
}

function validateLeave(env: Env, s: StaffRec, body: { campus: CampusCode; typeId: string; from: string; to: string; halfDay: boolean; reason: string }, session: number, ignoreId?: string): Response | { days: number } {
  const t = env.settings.leaveTypes.find((x) => x.id === body.typeId && x.active);
  if (!t) return fail(422, "VALIDATION", "Choose the kind of leave.", { field: "typeId" });
  if (!isDate(body.from)) return fail(422, "VALIDATION", "Enter the first day of leave.", { field: "from" });
  if (!isDate(body.to)) return fail(422, "VALIDATION", "Enter the last day of leave.", { field: "to" });
  if (body.to < body.from) return fail(422, "VALIDATION", "The last day can't be before the first day.", { field: "to" });
  if (body.halfDay && body.from !== body.to) return fail(422, "VALIDATION", "A half day is one date: make the first and last day the same.", { field: "to" });
  if (body.from < SESSION_START(session) || body.to > SESSION_END(session)) return fail(422, "VALIDATION", `Leave must fall within session ${session}–${String((session + 1) % 100).padStart(2, "0")} (01-Apr to 31-Mar).`, { field: "from" });
  if ((body.reason ?? "").trim().length < 5) return fail(422, "VALIDATION", "Say why in a few words; the principal reads this.", { field: "reason" });
  const days = leaveDays({ campus: body.campus, from: body.from, to: body.to, halfDay: body.halfDay }, s);
  if (days === 0) return fail(422, "VALIDATION", "Those dates are all Sundays, holidays or days off. Nothing to apply for.", { field: "from" });
  const clash = env.leave.find((l) => l.id !== ignoreId && l.staffId === s.id && (l.status === "PENDING" || l.status === "APPROVED") && l.from <= body.to && l.to >= body.from);
  if (clash) return fail(409, "LEAVE_OVERLAP", `${s.name} already has ${clash.status === "PENDING" ? "a request waiting" : "approved leave"} from ${formatDate(clash.from)} to ${formatDate(clash.to)}. Change the dates or cancel that request first.`, { field: "from" });
  const bal = balancesFor(env, s, session).find((b) => b.typeId === t.id);
  if (bal && bal.left !== null && days > bal.left - bal.pending) {
    const left = Math.max(0, bal.left - bal.pending);
    return fail(422, "OVER_BALANCE", `Only ${left} day${left === 1 ? "" : "s"} of ${t.name.toLowerCase()} left${bal.pending ? " after requests already waiting" : ""}. Ask for ${left} day${left === 1 ? "" : "s"} now and the rest as unpaid leave.`, { field: "typeId" });
  }
  return { days };
}

/* ================================================================== Profile assembly */

function toSummary(env: Env, s: StaffRec, scope: CampusScope, showPay: boolean): HrStaffSummary {
  const p = postingFor(s, scope);
  const d = designation(env.settings, p.designationId);
  const dep = department(env.settings, p.departmentId);
  const subjects = initialSubjectsMap();
  const out: HrStaffSummary = {
    id: s.id,
    employeeNo: s.employeeNo,
    name: s.name,
    nameUrdu: s.nameUrdu,
    gender: s.gender,
    designationId: p.designationId,
    designation: d?.title ?? "",
    departmentId: p.departmentId,
    department: dep?.title ?? "",
    category: d?.category ?? "TEACHING",
    employmentType: p.employmentType,
    campus: p.campus,
    campusName: campusName(p.campus),
    otherCampuses: [...new Set(s.postings.filter((x) => x.campus !== p.campus && postingActiveOn(x, TODAY)).map((x) => x.campus))],
    status: s.status,
    joiningDate: joiningDate(s),
    leavingDate: s.leavingDate,
    serviceYears: serviceYears(s, s.status === "LEFT" && s.leavingDate ? s.leavingDate : TODAY),
    mobile: s.mobile,
    cnic: s.cnic,
    payScale: p.payScale,
    subjects: s.subjectIds.map((id) => subjects.get(id) ?? id),
    classTeacherOf: p.classTeacherOf,
    onLeaveToday: Boolean(onApprovedLeave(env, s.id, TODAY)),
    missingDocuments: s.documents.filter((x) => x.required && !x.fileName).length,
    relation: s.relation,
    guardianName: s.guardianName,
    dob: s.dob,
    highestQualification: highestQualification(s),
    teachingLevels: s.teachingLevels,
  };
  if (showPay) out.basic = basicOn(s, TODAY);
  return out;
}

/** The most recent degree on file: "M.A. (English)". */
function highestQualification(s: StaffRec): string | null {
  const q = [...s.qualifications].sort((a, b) => b.year - a.year)[0];
  if (!q) return null;
  return q.subject && !q.degree.toLowerCase().includes(q.subject.toLowerCase()) ? `${q.degree} (${q.subject})` : q.degree;
}

let subjectsCache: Map<string, string> | null = null;
const initialSubjectsMap = () => (subjectsCache ??= new Map(initialSubjects().map((x) => [x.id, x.name])));

function toPosting(st: SettingsState, p: PostingRec): HrPosting {
  const d = designation(st, p.designationId);
  return {
    id: p.id,
    campus: p.campus,
    campusName: campusName(p.campus),
    designationId: p.designationId,
    designation: d?.title ?? "",
    departmentId: p.departmentId,
    department: department(st, p.departmentId)?.title ?? "",
    category: d?.category ?? "TEACHING",
    employmentType: p.employmentType,
    payScale: p.payScale,
    startDate: p.startDate,
    endDate: p.endDate,
    endReason: p.endReason,
    primary: p.primary,
    daysPerWeek: p.daysPerWeek,
    deviceEnrolNo: p.deviceEnrolNo,
    classTeacherOf: p.classTeacherOf,
  };
}

const maskAccount = (no: string) => `•••• ${no.replace(/\D/g, "").slice(-4)}`;

function payDetails(env: Env, s: StaffRec): HrPayDetails {
  const p = primaryPosting(s);
  const basic = basicOn(s, TODAY);
  const { allowances, deductions } = standingPay(s, p, basic, env.settings.payDefaults);
  const gross = basic + sum(allowances.map((a) => a.amount));
  const sorted = [...s.salary].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const history = sorted.map((r, i) => ({ id: r.id, effectiveFrom: r.effectiveFrom, basic: r.basic, change: i === 0 ? 0 : r.basic - sorted[i - 1]!.basic, reason: r.reason, note: r.note, by: r.by }));
  const next = history.find((r) => r.effectiveFrom > TODAY) ?? null;
  const w = workStore.get();
  const slips = w.payroll
    .filter((r) => r.campus === p.campus)
    .sort((a, b) => b.month.localeCompare(a.month))
    .slice(0, 8)
    .flatMap((r) => {
      const line = runLines(r).find((l) => l.staffId === s.id);
      return line ? [{ runId: r.id, month: r.month, net: line.net, status: r.status }] : [];
    })
    .slice(0, 6);
  const cs = campusSettings(env.settings, p.campus);
  return {
    basic,
    payScale: p.payScale,
    allowances,
    deductions,
    gross,
    net: gross - sum(deductions.map((d) => d.amount)),
    paymentMethod: s.pay.paymentMethod,
    bank: s.pay.bank ? { bankName: s.pay.bank.bankName, branch: s.pay.bank.branch, accountTitle: s.pay.bank.accountTitle, accountNoMasked: maskAccount(s.pay.bank.accountNo) } : null,
    specialAllowance: s.pay.specialAllowance,
    eobi: s.pay.eobi,
    providentFund: s.pay.providentFund,
    history: history.filter((r) => r.effectiveFrom <= TODAY).reverse(),
    nextChange: next,
    children: s.children,
    loans: env.loans.filter((l) => l.staffId === s.id).map((l) => loanSummary(env, l)),
    recentSlips: slips,
    payrollNote: cs.runsPayroll ? null : `${campusName(p.campus)} doesn't prepare salaries in the system yet. Turn it on in Staff & payroll → Settings.`,
  };
}

function toProfile(env: Env, s: StaffRec, scope: CampusScope, user: SessionUser): HrStaffProfile {
  const showPay = canPay(user, scope);
  const p = postingFor(s, scope);
  const month = THIS_MONTH;
  const days: HrStaffProfile["attendance"]["days"] = {};
  const holidays: HrStaffProfile["attendance"]["holidays"] = {};
  let present = 0;
  let late = 0;
  let absent = 0;
  let leave = 0;
  const calMonth = TODAY.slice(8) <= "07" ? `${TODAY.slice(0, 4)}-${pad(Number(TODAY.slice(5, 7)) - 1)}` : month;
  for (const d of monthDates(calMonth)) {
    if (d > TODAY) break;
    const info = resolveDay(env, s, p.campus, d);
    if (!info?.status) continue;
    if (info.status === "HOLIDAY") {
      days[d] = "H";
      holidays[d] = info.note ?? "Holiday";
    } else if (info.status === "PRESENT" || info.status === "HALF_DAY") (days[d] = "P", present++);
    else if (info.status === "LATE") (days[d] = "LT", late++);
    else if (info.status === "ABSENT") (days[d] = "A", absent++);
    else if (info.status === "LEAVE") (days[d] = "L", leave++);
  }
  const docs: HrDocument[] = s.documents.map((d) => ({ ...d, status: d.fileName ? "ON_FILE" : "MISSING" }));
  return {
    ...toSummary(env, s, scope, showPay),
    relation: s.relation,
    guardianName: s.guardianName,
    dob: s.dob,
    bloodGroup: s.bloodGroup,
    maritalStatus: s.maritalStatus,
    religion: s.religion,
    mobile2: s.mobile2,
    email: s.email,
    address: s.address,
    city: s.city,
    emergency: s.emergency,
    reference: s.reference ?? null,
    caste: s.caste ?? null,
    priorServiceYears: s.priorServiceYears,
    probationEnds: s.probationEnds,
    postings: [...s.postings].sort((a, b) => Number(b.primary) - Number(a.primary) || b.startDate.localeCompare(a.startDate)).map((x) => toPosting(env.settings, x)),
    qualifications: s.qualifications,
    experience: s.experience,
    teachingLevels: s.teachingLevels,
    subjectIds: s.subjectIds,
    documents: docs,
    leave: balancesFor(env, s, sessionOf(TODAY)),
    attendance: { month: calMonth, days, holidays, present, late, absent, leave },
    pay: showPay ? payDetails(env, s) : null,
    payHidden: !showPay,
    userName: s.userName,
    history: [...s.history].reverse(),
    rowVer: s.rowVer,
    leavingReason: s.leavingReason,
  };
}

/* ================================================================== Increments */

function incrementLines(env: Env, input: Pick<IncRunRec, "campus" | "session" | "method" | "value" | "filter" | "experienceAsOf" | "effectiveFrom">, existing?: IncRunRec[], ignoreRunId?: string): HrIncrementLine[] {
  const applied = (existing ?? workStore.get().increments).filter((r) => r.id !== ignoreRunId && r.status === "APPROVED" && r.session === input.session && r.campus === input.campus);
  return env.staff
    .filter((s) => s.status === "ACTIVE" && primaryPosting(s).campus === input.campus && activeAt(s, input.campus, input.experienceAsOf))
    .filter((s) => {
      const p = primaryPosting(s);
      const cat = categoryOf(env.settings, s, p);
      const level = input.filter.teachingLevel ?? null;
      return (!input.filter.category || cat === input.filter.category) && (!input.filter.designationId || p.designationId === input.filter.designationId) && (!input.filter.payScale || p.payScale === input.filter.payScale) && (!level || s.teachingLevels.includes(level));
    })
    .map((s) => {
      const p = primaryPosting(s);
      const yrs = serviceYears(s, input.experienceAsOf);
      const current = basicOn(s, addDays(input.effectiveFrom, -1));
      let per = 0;
      let note: string | null = null;
      if (input.method === "CRITERIA") per = criteriaAmount(env.settings.criteria, p.payScale, yrs);
      if (input.method === "PERCENT") per = Math.round((current * (input.value ?? 0)) / 100);
      if (input.method === "FIXED") per = input.value ?? 0;
      const already = applied.find((r) => r.lines.some((l) => l.staffId === s.id && l.included));
      if (p.employmentType === "VISITING") note = "Visiting staff are paid a fixed fee.";
      else if (current === 0) note = "No salary set yet.";
      else if (yrs < 1) note = `Joined ${formatDate(joiningDate(s))}: less than a year before the cut-off date.`;
      else if (already) note = `Already given "${already.title}" this session.`;
      else if (input.method === "CRITERIA" && (!p.payScale || p.payScale === "0")) note = "No pay scale, so the table doesn't cover them. Use a fixed-amount run.";
      else if (per === 0) note = "No band in the table for this scale and service.";
      const included = note === null;
      const increase = included ? per : 0;
      return {
        staffId: s.id,
        name: s.name,
        employeeNo: s.employeeNo,
        designation: designation(env.settings, p.designationId)?.title ?? "",
        payScale: p.payScale,
        serviceYears: yrs,
        currentBasic: current,
        perIncrement: per,
        increments: included ? 1 : 0,
        special: 0,
        increase,
        newBasic: current + increase,
        percent: current ? round1((increase / current) * 100) : 0,
        included,
        note,
      };
    })
    .sort((a, b) => Number(b.included) - Number(a.included) || (b.payScale ?? "").localeCompare(a.payScale ?? "") || a.name.localeCompare(b.name));
}

function incTotals(lines: HrIncrementLine[]): HrIncrementRun["totals"] {
  const inc = lines.filter((l) => l.included);
  const currentBasic = sum(inc.map((l) => l.currentBasic));
  const newBasic = sum(inc.map((l) => l.newBasic));
  return { currentBasic, newBasic, monthlyIncrease: newBasic - currentBasic, yearlyCost: (newBasic - currentBasic) * 12, averagePercent: currentBasic ? round1(((newBasic - currentBasic) / currentBasic) * 100) : 0, excluded: lines.length - inc.length };
}

function incSummary(r: IncRunRec): HrIncrementRunSummary {
  return { id: r.id, campus: r.campus, campusName: campusName(r.campus), session: r.session, title: r.title, method: r.method, value: r.value, effectiveFrom: r.effectiveFrom, status: r.status, staff: r.lines.filter((l) => l.included).length, monthlyIncrease: incTotals(r.lines).monthlyIncrease, preparedBy: r.preparedBy, preparedAt: r.preparedAt, decidedBy: r.decidedBy, decidedAt: r.decidedAt };
}
const toIncRun = (r: IncRunRec): HrIncrementRun => ({ ...incSummary(r), experienceAsOf: r.experienceAsOf, filter: { ...r.filter, teachingLevel: r.filter.teachingLevel ?? null }, lines: r.lines, totals: incTotals(r.lines), decisionNote: r.decisionNote, history: r.history });

/* ================================================================== Payroll */

const historyCache = new Map<string, HrPayslip[]>();

/** Lines of a sheet: stored ones, or (for sheets paid before the demo) worked out from the starting records. */
function runLines(r: PayRunRec): HrPayslip[] {
  if (r.lines) return r.lines.some((l) => l.designationId === undefined || l.paidOn === undefined || l.cnic === undefined) ? r.lines.map(normaliseSlip) : r.lines;
  const key = `${r.campus}|${r.month}`;
  if (!historyCache.has(key)) historyCache.set(key, calcLines(pristineEnv(), r.campus, r.month, {}).lines);
  return historyCache.get(key)!;
}

/** Slips saved before a field existed (this tab's demo data): fill it in. */
function normaliseSlip(l: HrPayslip): HrPayslip {
  return { ...l, designationId: l.designationId ?? settingsStore.get().designations.find((d) => d.title === l.designation)?.id ?? "", paidOn: l.paidOn ?? null, cnic: l.cnic ?? staffById(l.staffId)?.cnic ?? "" };
}

function loanBalanceBefore(l: LoanRec, month: string) {
  return l.principal - sum(l.recoveries.filter((x) => x.month < month).map((x) => x.amount));
}

function calcSlip(env: Env, s: StaffRec, campus: CampusCode, month: string, manual: Partial<HrPayslipInput>): HrPayslip | null {
  const dates = monthDates(month);
  const first = dates[0]!;
  const last = dates.at(-1)!;
  const p = s.postings.find((x) => x.campus === campus && x.primary && x.startDate <= last && (!x.endDate || x.endDate >= first));
  if (!p) return null;
  const cs = campusSettings(env.settings, campus);
  const from = p.startDate > first ? p.startDate : first;
  const to = p.endDate && p.endDate < last ? p.endDate : last;
  const paidDays = dates.filter((d) => d >= from && d <= to).length;
  const fraction = paidDays / dates.length;
  const basicFull = basicOn(s, first > p.startDate ? first : p.startDate);
  if (!basicFull) return null;
  const { allowances, deductions: standing } = standingPay(s, p, basicFull, env.settings.payDefaults);
  const grossFull = basicFull + sum(allowances.map((a) => a.amount));
  let present = 0;
  let late = 0;
  let absent = 0;
  let half = 0;
  let paidLeave = 0;
  let unpaidLeave = 0;
  for (const d of dates) {
    if (d < from || d > to) continue;
    const info = resolveDay(env, s, campus, d);
    if (!info?.status) continue;
    if (info.status === "PRESENT") present++;
    if (info.status === "LATE") (present++, late++);
    if (info.status === "HALF_DAY") (present++, half++);
    if (info.status === "ABSENT") absent++;
    if (info.status === "LEAVE") info.paidLeave ? paidLeave++ : unpaidLeave++;
  }
  const lateDays = cs.lateRule ? Math.floor(late / cs.lateRule.lates) * cs.lateRule.days : 0;
  const halfUnpaid = half * 0.5;
  const unpaid = absent + unpaidLeave + halfUnpaid + lateDays;
  const flags: string[] = [];
  const prorate = (n: number) => Math.round(n * fraction);
  const earnings: HrPayLine[] = [{ code: "BASIC", label: "Basic pay", amount: prorate(basicFull) }, ...allowances.map((a) => ({ code: a.code, label: a.label, amount: prorate(a.amount) }))];
  const bonus = manual.bonus ?? 0;
  if (bonus > 0) earnings.push({ code: "BONUS", label: "Bonus or arrears", amount: bonus, ...(manual.note ? { note: manual.note } : {}) });
  if (paidDays < dates.length) {
    if (p.startDate > first) flags.push(`Joined ${formatDate(p.startDate)}: paid for ${paidDays} of ${dates.length} days.`);
    if (p.endDate && p.endDate < last) flags.push(`Left ${formatDate(p.endDate)}: paid for ${paidDays} of ${dates.length} days.`);
  }
  const gross = sum(earnings.map((e) => e.amount));
  const deductions: HrPayLine[] = [];
  if (unpaid > 0) {
    const parts = [absent && `${absent} day${absent === 1 ? "" : "s"} absent`, unpaidLeave && `${unpaidLeave} day${unpaidLeave === 1 ? "" : "s"} unpaid leave`, half && `${half} half day${half === 1 ? "" : "s"}`, lateDays && `${late} late arrivals = ${lateDays} day${lateDays === 1 ? "" : "s"}`].filter(Boolean);
    deductions.push({ code: "ABSENCE", label: "Absence and unpaid leave", amount: Math.round((grossFull / cs.daysDivisor) * unpaid), note: `${parts.join(", ")} × ${formatRs(Math.round(grossFull / cs.daysDivisor))} a day (pay ÷ ${cs.daysDivisor})` });
    flags.push(`${unpaid} unpaid day${unpaid === 1 ? "" : "s"}: ${parts.join(", ")}.`);
  }
  for (const d of standing) {
    if (d.code === "TAX") {
      const tax = hrMonthlyTax(gross);
      if (tax > 0) deductions.push({ code: "TAX", label: "Income tax", amount: tax });
    } else deductions.push({ code: d.code, label: d.label, amount: d.code === "PF" ? prorate(d.amount) : d.amount });
  }
  for (const l of env.loans.filter((x) => x.staffId === s.id && (x.status === "ACTIVE" || (env.pristine && x.status === "CLOSED")) && x.firstMonth <= month)) {
    const bal = loanBalanceBefore(l, month);
    if (bal <= 0) continue;
    const t = env.settings.loanTypes.find((x) => x.id === l.typeId);
    const amount = Math.min(l.installment, bal);
    const done = l.recoveries.filter((x) => x.month < month).length;
    deductions.push({ code: `LOAN:${l.id}`, label: t?.kind === "ADVANCE" ? "Salary advance" : "Loan installment", amount, note: `${l.loanNo} · ${t?.kind === "ADVANCE" ? "recovered in full" : `installment ${done + 1} of ${l.installments}`} · ${formatRs(bal - amount)} left after this` });
  }
  for (const c of s.children.filter((x) => x.adjustAgainstSalary)) {
    deductions.push({ code: `CHILD:${c.grNo}`, label: "Child's school fee", amount: c.monthlyFee, note: `${c.name} (${c.grNo}, ${c.classSection}) · ${hrMonthLabel(month)} tuition` });
  }
  const fine = manual.fine ?? 0;
  if (fine > 0) deductions.push({ code: "FINE", label: "Fine or other deduction", amount: fine, ...(manual.note ? { note: manual.note } : {}) });
  let total = sum(deductions.map((d) => d.amount));
  if (total > gross) {
    for (const d of deductions.filter((x) => x.code.startsWith("LOAN:"))) {
      const over = total - gross;
      if (over <= 0) break;
      const cut = Math.min(over, d.amount);
      d.amount -= cut;
      total -= cut;
      flags.push(`Loan deduction reduced by ${formatRs(cut)} so pay doesn't go below zero; the balance carries on.`);
    }
  }
  let method = s.pay.paymentMethod;
  if (method === "BANK" && !s.pay.bank) {
    method = "CASH";
    flags.push("No bank account on file: paid in cash.");
  }
  if (manual.hold) flags.push("Salary held: not paid with this sheet.");
  return {
    staffId: s.id,
    name: s.name,
    employeeNo: s.employeeNo,
    cnic: s.cnic,
    designationId: p.designationId,
    designation: designation(env.settings, p.designationId)?.title ?? "",
    department: department(env.settings, p.departmentId)?.title ?? "",
    payScale: p.payScale,
    monthDays: dates.length,
    paidDays,
    presentDays: present,
    leaveDays: paidLeave + unpaidLeave,
    unpaidDays: unpaid,
    lateCount: late,
    earnings,
    deductions: deductions.filter((d) => d.amount > 0 || d.code.startsWith("LOAN:")),
    gross,
    totalDeductions: total,
    net: gross - total,
    paymentMethod: method,
    bank: s.pay.bank && method === "BANK" ? { bankName: s.pay.bank.bankName, branch: s.pay.bank.branch, accountTitle: s.pay.bank.accountTitle, accountNoMasked: maskAccount(s.pay.bank.accountNo) } : null,
    flags,
    bonus,
    fine,
    note: manual.note ?? null,
    hold: Boolean(manual.hold),
    paidOn: null,
  };
}

function calcLines(env: Env, campus: CampusCode, month: string, manual: Record<string, Partial<HrPayslipInput>>): { lines: HrPayslip[]; warnings: string[] } {
  const dates = monthDates(month);
  const lines: HrPayslip[] = [];
  const noPay: string[] = [];
  for (const s of staffAtOn(env, campus, dates[0]!, dates.at(-1)!)) {
    const p = s.postings.find((x) => x.campus === campus && x.primary);
    if (!p) continue;
    const slip = calcSlip(env, s, campus, month, manual[s.id] ?? {});
    if (slip) lines.push(slip);
    else if (!s.salary.length) noPay.push(s.name);
  }
  const warnings: string[] = [];
  if (noPay.length) warnings.push(`${noPay.length} ${noPay.length === 1 ? "person has" : "people have"} no salary set and ${noPay.length === 1 ? "is" : "are"} left out: ${noPay.join(", ")}. Add their pay in the staff profile, then recalculate.`);
  const shared = env.staff.filter((s) => s.postings.some((p) => p.campus === campus && !p.primary && p.startDate <= dates.at(-1)! && (!p.endDate || p.endDate >= dates[0]!)));
  if (shared.length) warnings.push(`${shared.map((s) => s.name).join(", ")} also work${shared.length === 1 ? "s" : ""} here but ${shared.length === 1 ? "is" : "are"} paid by ${campusName(primaryPosting(shared[0]!).campus)}.`);
  return { lines, warnings };
}

function payTotals(lines: HrPayslip[]): HrPayrollTotals {
  const by = (pred: (code: string) => boolean, side: "earnings" | "deductions") => sum(lines.flatMap((l) => l[side].filter((x) => pred(x.code)).map((x) => x.amount)));
  // A held salary paid later (paidOn) moves from "held" to its payment method.
  const paid = lines.filter((l) => !l.hold || l.paidOn);
  return {
    basic: by((c) => c === "BASIC", "earnings"),
    allowances: by((c) => ["HOUSE_RENT", "CONVEYANCE", "MEDICAL", "SPECIAL"].includes(c), "earnings"),
    bonus: by((c) => c === "BONUS", "earnings"),
    gross: sum(lines.map((l) => l.gross)),
    eobi: by((c) => c === "EOBI", "deductions"),
    providentFund: by((c) => c === "PF", "deductions"),
    tax: by((c) => c === "TAX", "deductions"),
    loans: by((c) => c.startsWith("LOAN:"), "deductions"),
    childFee: by((c) => c.startsWith("CHILD:"), "deductions"),
    absence: by((c) => c === "ABSENCE", "deductions"),
    fines: by((c) => c === "FINE", "deductions"),
    deductions: sum(lines.map((l) => l.totalDeductions)),
    net: sum(lines.map((l) => l.net)),
    bank: sum(paid.filter((l) => l.paymentMethod === "BANK").map((l) => l.net)),
    cash: sum(paid.filter((l) => l.paymentMethod === "CASH").map((l) => l.net)),
    cheque: sum(paid.filter((l) => l.paymentMethod === "CHEQUE").map((l) => l.net)),
    held: sum(lines.filter((l) => l.hold && !l.paidOn).map((l) => l.net)),
  };
}

function runSummary(r: PayRunRec): HrPayrollRunSummary {
  const lines = runLines(r);
  const t = payTotals(lines);
  return { id: r.id, campus: r.campus, campusName: campusName(r.campus), month: r.month, status: r.status, staff: lines.length, gross: t.gross, deductions: t.deductions, net: t.net, preparedBy: r.preparedBy, preparedAt: r.preparedAt, decidedBy: r.decidedBy, decidedAt: r.decidedAt, paidBy: r.paidBy, paymentDate: r.paymentDate };
}

function toRun(r: PayRunRec): HrPayrollRun {
  const lines = runLines(r);
  const st = settingsStore.get();
  const warnings: string[] = [];
  if (r.status === "DRAFT" || r.status === "PENDING") {
    const env = liveEnv();
    warnings.push(...calcLines(env, r.campus, r.month, {}).warnings);
    const flagged = lines.filter((l) => l.unpaidDays > 0).length;
    if (flagged) warnings.push(`${flagged} ${flagged === 1 ? "person has" : "people have"} unpaid days this month (absence, unpaid leave or late arrivals). Check them before sending.`);
  }
  return { ...runSummary(r), daysDivisor: campusSettings(st, r.campus).daysDivisor, lines, totals: payTotals(lines), warnings, decisionNote: r.decisionNote, history: r.history };
}

/* ================================================================== Loans */

function loanSummary(env: Env, l: LoanRec): HrLoanSummary {
  const t = env.settings.loanTypes.find((x) => x.id === l.typeId);
  const recovered = sum(l.recoveries.map((x) => x.amount));
  return { id: l.id, loanNo: l.loanNo, typeName: t?.name ?? "Loan", kind: t?.kind ?? "LOAN", principal: l.principal, installment: l.installment, installments: l.installments, recovered, balance: l.principal - recovered, status: l.status, firstMonth: l.firstMonth };
}

function toLoan(env: Env, l: LoanRec): HrLoan {
  const s = env.staff.find((x) => x.id === l.staffId)!;
  const p = primaryPosting(s);
  const sm = loanSummary(env, l);
  const schedule: HrLoan["schedule"] = [];
  let left = l.principal;
  let m = l.firstMonth;
  const rec = new Map(l.recoveries.filter((x) => x.source === "PAYROLL").map((x) => [x.month, x.amount]));
  const cashTotal = sum(l.recoveries.filter((x) => x.source === "CASH").map((x) => x.amount));
  left -= cashTotal;
  for (let i = 0; i < 40 && left > 0; i++) {
    const done = rec.get(m);
    const amount = done ?? Math.min(l.installment, left);
    schedule.push({ month: m, amount, status: done !== undefined ? "RECOVERED" : m <= THIS_MONTH ? "DUE" : "UPCOMING" });
    left -= amount;
    m = nextMonth(m);
  }
  return {
    ...sm,
    staffId: s.id,
    staffName: s.name,
    employeeNo: s.employeeNo,
    designationId: p.designationId,
    designation: designation(env.settings, p.designationId)?.title ?? "",
    campus: l.campus,
    campusName: campusName(l.campus),
    typeId: l.typeId,
    reason: l.reason,
    requestedBy: l.requestedBy,
    requestedAt: l.requestedAt,
    decidedBy: l.decidedBy,
    decidedAt: l.decidedAt,
    decisionNote: l.decisionNote,
    recoveries: l.recoveries.map((x) => ({ ...x })),
    schedule: l.status === "PENDING" || l.status === "REJECTED" ? schedule.map((x) => ({ ...x, status: "UPCOMING" as const })) : schedule,
    history: l.history,
  };
}

/* ================================================================== Initial state */

function initialWork(): WorkState {
  const staff = staffStore.get();
  const leave = initialLeave(staff);
  const loans = initialLoans(staff);
  const settings = settingsStore.get();
  const env: Env = { staff, leave, loans, settings, overrides: {}, imported: {}, pristine: false };
  const w: WorkState = { leave, loans, increments: [], payroll: [], overrides: {}, imported: {}, punchKeys: {}, batches: [], childFee: [], idem: {} };

  // Salary sheets: April–September paid at Khalid and Humaira; Khalid's October sheet waits for the principal.
  for (const campus of ["KC", "HC"] as CampusCode[]) {
    const preparer = campus === "KC" ? "Nadia Shah" : "Mr Tahir Mahmood";
    const approver = campus === "KC" ? "Mrs Sadia Rehman" : "Dr Ambreen Fatima";
    for (const month of ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]) {
      const nm = nextMonth(month);
      w.payroll.push({
        id: `pr-${campus.toLowerCase()}-${month}`,
        campus,
        month,
        status: "PAID",
        lines: null,
        preparedBy: preparer,
        preparedAt: `${nm}-02T11:00:00+05:00`,
        decidedBy: approver,
        decidedAt: `${nm}-03T09:30:00+05:00`,
        decisionNote: null,
        paidBy: preparer,
        paymentDate: `${nm}-05`,
        history: [
          { id: "h1", at: `${nm}-02T11:00:00+05:00`, by: preparer, text: "Salary sheet prepared and sent for approval" },
          { id: "h2", at: `${nm}-03T09:30:00+05:00`, by: approver, text: "Approved" },
          { id: "h3", at: `${nm}-05T10:15:00+05:00`, by: preparer, text: "Marked as paid", detail: "Bank transfer list sent to the bank" },
        ],
      });
    }
  }
  // One salary was held on Khalid's September sheet and is still unpaid (Payroll → September → the slip → "Pay this held
  // salary"). Someone paid in cash with no loan or child fee, so the starting loan records stay right.
  const sept = w.payroll.find((r) => r.id === "pr-kc-2026-09");
  const pEnv = pristineEnv();
  const heldStaff = pEnv.staff.find((s) => s.status === "ACTIVE" && primaryPosting(s).campus === "KC" && s.pay.paymentMethod === "CASH" && s.salary.length > 0 && !s.children.some((c) => c.adjustAgainstSalary) && !pEnv.loans.some((l) => l.staffId === s.id));
  if (sept && heldStaff) {
    const note = "Held until the missing documents reach the staff file";
    sept.lines = calcLines(pEnv, "KC", "2026-09", { [heldStaff.id]: { hold: true, note } }).lines;
    sept.history.splice(0, 0, { id: "h0", at: "2026-10-02T10:40:00+05:00", by: "Nadia Shah", text: `${heldStaff.name}'s slip changed`, detail: "salary held" });
  }
  // Lines stay null (worked out from the starting records, like the paid months) until the sheet is changed.
  w.payroll.push({
    id: "pr-kc-2026-10",
    campus: "KC",
    month: "2026-10",
    status: "PENDING",
    lines: null,
    preparedBy: "Nadia Shah",
    preparedAt: "2026-11-03T16:20:00+05:00",
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    paidBy: null,
    paymentDate: null,
    history: [
      { id: "h1", at: "2026-11-02T15:05:00+05:00", by: "Nadia Shah", text: "Salary sheet prepared" },
      { id: "h2", at: "2026-11-03T16:20:00+05:00", by: "Nadia Shah", text: "Sent for approval", detail: "Ready for the principal" },
    ],
  });

  // Increments: last year's (applied) and this year's at Khalid (waiting), Humaira's draft.
  const kcStaff = staff.filter((s) => primaryPosting(s).campus === "KC");
  const lines2025: HrIncrementLine[] = kcStaff
    .filter((s) => joiningDate(s) <= "2025-11-30" && (s.status === "ACTIVE" || (s.leavingDate ?? "") > "2025-12-01"))
    .map((s) => {
      const p = primaryPosting(s);
      const sorted = [...s.salary].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
      const i = sorted.findIndex((r) => r.effectiveFrom === "2025-12-01" && r.reason === "INCREMENT");
      const before = i > 0 ? sorted[i - 1]!.basic : basicOn(s, "2025-11-30");
      const after = i >= 0 ? sorted[i]!.basic : before;
      const included = i >= 0;
      return {
        staffId: s.id,
        name: s.name,
        employeeNo: s.employeeNo,
        designation: designation(settings, p.designationId)?.title ?? "",
        payScale: p.payScale,
        serviceYears: serviceYears(s, "2025-11-30"),
        currentBasic: before,
        perIncrement: after - before,
        increments: included ? 1 : 0,
        special: 0,
        increase: after - before,
        newBasic: after,
        percent: before ? round1(((after - before) / before) * 100) : 0,
        included,
        note: included ? null : p.employmentType === "VISITING" ? "Visiting staff are paid a fixed fee." : !p.payScale ? "No pay scale, so the table doesn't cover them." : "Less than a year's service.",
      };
    });
  w.increments.push({
    id: "inc-kc-2025",
    campus: "KC",
    session: 2025,
    title: "Annual increment 2025–26",
    method: "CRITERIA",
    value: null,
    filter: { category: null, designationId: null, payScale: null, teachingLevel: null },
    experienceAsOf: "2025-11-30",
    effectiveFrom: "2025-12-01",
    status: "APPROVED",
    lines: lines2025,
    preparedBy: "Nadia Shah",
    preparedAt: "2025-11-18T12:00:00+05:00",
    decidedBy: "Mrs Sadia Rehman",
    decidedAt: "2025-11-20T10:00:00+05:00",
    decisionNote: null,
    history: [
      { id: "h1", at: "2025-11-18T12:00:00+05:00", by: "Nadia Shah", text: "Prepared and sent for approval" },
      { id: "h2", at: "2025-11-20T10:00:00+05:00", by: "Mrs Sadia Rehman", text: "Approved", detail: "New salaries from 01-Dec-2025" },
    ],
  });
  const base = { method: "CRITERIA" as const, value: null, filter: { category: null, designationId: null, payScale: null, teachingLevel: null }, experienceAsOf: "2026-11-30", effectiveFrom: "2026-12-01", session: 2026 };
  w.increments.push({
    id: "inc-kc-2026",
    campus: "KC",
    title: "Annual increment 2026–27",
    ...base,
    status: "PENDING",
    lines: incrementLines(env, { ...base, campus: "KC" }, w.increments),
    preparedBy: "Nadia Shah",
    preparedAt: "2026-11-03T12:40:00+05:00",
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    history: [
      { id: "h1", at: "2026-11-03T12:10:00+05:00", by: "Nadia Shah", text: "Prepared from the increment table" },
      { id: "h2", at: "2026-11-03T12:40:00+05:00", by: "Nadia Shah", text: "Sent for approval" },
    ],
  });
  w.increments.push({
    id: "inc-hc-2026",
    campus: "HC",
    title: "Annual increment 2026–27",
    ...base,
    status: "DRAFT",
    lines: incrementLines(env, { ...base, campus: "HC" }, w.increments),
    preparedBy: "Nadia Shah",
    preparedAt: "2026-11-04T09:15:00+05:00",
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    history: [{ id: "h1", at: "2026-11-04T09:15:00+05:00", by: "Nadia Shah", text: "Prepared from the increment table" }],
  });

  // Yesterday's fingerprint import at both device campuses; earlier imports listed for the record.
  for (const campus of ["KC", "HC"] as CampusCode[]) {
    for (const back of [3, 2, 1]) {
      const date = addDays(TODAY, -back);
      if (weekday(date) === 0) continue;
      const keys: string[] = [];
      let punches = 0;
      for (const s of staff.filter((x) => activeAt(x, campus, date))) {
        const p = postingAt(s, campus, date)!;
        if (!p.deviceEnrolNo) continue;
        const info = resolveDay(env, s, campus, date);
        if (!info?.timeIn) continue;
        punches += info.timeOut ? 2 : 1;
        if (back === 1) {
          keys.push(`${p.deviceEnrolNo}@${info.timeIn}:${secondsFor(`${s.id}|${date}|in`)}`);
          if (info.timeOut) keys.push(`${p.deviceEnrolNo}@${info.timeOut}:${secondsFor(`${s.id}|${date}|out`)}`);
        }
      }
      if (back === 1) w.punchKeys[dayKey(campus, date)] = keys;
      w.batches.push({ id: `imp-${campus.toLowerCase()}-${date}`, campus, fileName: `attlog_${campus}_${date}.csv`, deviceName: campusSettings(settings, campus).deviceName ?? "Fingerprint machine", importedAt: `${date}T14:05:00+05:00`, importedBy: campus === "KC" ? "Kamran Yousaf" : "Mr Tahir Mahmood", punches, newPunches: punches, duplicates: 0, ignored: 0, days: [date], staff: Math.round(punches / 2) });
    }
  }
  return w;
}

/* ================================================================== Request helpers */

const readOnly = (session: number) => (session !== CURRENT_SESSION ? fail(409, "SESSION_READ_ONLY", "2025–26 is closed. Switch to 2026–27 to make changes.") : null);
const staffById = (id: string) => staffStore.get().find((s) => s.id === id);
const saveStaff = (s: StaffRec) => staffStore.set((all) => all.map((x) => (x.id === s.id ? s : x)));
const conflict = (s: StaffRec) => fail(409, "CONCURRENCY", "Someone saved this record while you were editing. Reload to see their changes, then make yours again.", { details: { changedBy: s.history.at(-1)?.by ?? "Another user", changedAt: s.history.at(-1)?.at ?? demoNow() } });

function validatePersonal(b: Partial<HrPersonalInput>, ignoreId?: string): Response | null {
  if (!b.name || b.name.trim().length < 3) return fail(422, "VALIDATION", "Enter the full name as on the CNIC.", { field: "name" });
  if (!b.guardianName || b.guardianName.trim().length < 3) return fail(422, "VALIDATION", "Enter the father's or husband's name.", { field: "guardianName" });
  if (!b.cnic || !isValidCnic(b.cnic)) return fail(422, "VALIDATION", "Enter the 13-digit CNIC number.", { field: "cnic" });
  const dup = staffStore.get().find((s) => s.cnic === b.cnic && s.id !== ignoreId);
  if (dup) {
    const details: HrDuplicateDetails = { staffId: dup.id, name: dup.name, employeeNo: dup.employeeNo, campuses: [...new Set(dup.postings.map((p) => p.campus))], status: dup.status };
    return fail(409, "DUPLICATE_CNIC", `This CNIC belongs to ${dup.name} (${dup.employeeNo}). Add a posting to their profile instead of a second record.`, { field: "cnic", details });
  }
  if (!isDate(b.dob)) return fail(422, "VALIDATION", "Enter the date of birth.", { field: "dob" });
  const age = yearsBetween(b.dob, TODAY);
  if (age < 18 || age > 75) return fail(422, "VALIDATION", "Staff must be between 18 and 75 years old. Check the date of birth.", { field: "dob" });
  if (!b.mobile || !normalizeMobile(b.mobile)) return fail(422, "VALIDATION", "Enter a mobile number like 0300-1234567.", { field: "mobile" });
  if (b.mobile2 && !normalizeMobile(b.mobile2)) return fail(422, "VALIDATION", "The second number should look like 0300-1234567, or leave it empty.", { field: "mobile2" });
  if (b.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) return fail(422, "VALIDATION", "Enter a valid email address, or leave it empty.", { field: "email" });
  if (!b.address || b.address.trim().length < 8) return fail(422, "VALIDATION", "Enter the home address.", { field: "address" });
  if (!b.emergency?.name?.trim() || !b.emergency.mobile || !normalizeMobile(b.emergency.mobile)) return fail(422, "VALIDATION", "Enter an emergency contact with a mobile number.", { field: "emergency" });
  if (typeof b.priorServiceYears !== "number" || b.priorServiceYears < 0 || b.priorServiceYears > 40) return fail(422, "VALIDATION", "Earlier MTB service must be between 0 and 40 years.", { field: "priorServiceYears" });
  if (b.reference && b.reference.trim().length > 80) return fail(422, "VALIDATION", "Keep the reference to 80 characters.", { field: "reference" });
  if (b.caste && b.caste.trim().length > 40) return fail(422, "VALIDATION", "Keep the caste to 40 characters.", { field: "caste" });
  return null;
}

function validateBank(method: string, bank: { bankName?: string; branch?: string; accountTitle?: string; accountNo?: string | null } | null, requireNo: boolean): Response | null {
  if (method !== "BANK") return null;
  if (!bank?.bankName) return fail(422, "VALIDATION", "Choose the bank, or pay in cash.", { field: "bankName" });
  if (!bank.accountTitle?.trim()) return fail(422, "VALIDATION", "Enter the account title as the bank shows it.", { field: "accountTitle" });
  if (requireNo || bank.accountNo) {
    const digits = (bank.accountNo ?? "").replace(/[\s-]/g, "");
    if (!/^(PK\d{2}[A-Z]{4}\d{16}|\d{8,20})$/i.test(digits)) return fail(422, "VALIDATION", "Enter the account number (8 to 20 digits) or the 24-character IBAN.", { field: "accountNo" });
  }
  return null;
}

/* ================================================================== Handlers */

export const hrHandlers: HttpHandler[] = [
  /* ---------------------------------------------------------------- Directory */
  http.get("/api/hr/overview", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("hr.view", ctx.campus);
    if (user instanceof Response) return user;
    const env = liveEnv();
    const w = workStore.get();
    const people = env.staff.filter((s) => worksAt(s, ctx.campus));
    const active = people.filter((s) => s.status === "ACTIVE" && (ctx.campus === "ALL" || activeAt(s, ctx.campus)));
    const cats: HrCategory[] = ["TEACHING", "MANAGEMENT", "HIFZ", "VISITING", "NON_TEACHING"];
    const catOf = (s: StaffRec) => categoryOf(env.settings, s, postingFor(s, ctx.campus));
    const inSession = (d: string | null) => Boolean(d && d >= SESSION_START(ctx.session) && d <= SESSION_END(ctx.session));
    const camp = (c: CampusCode) => ctx.campus === "ALL" || c === ctx.campus;
    let payroll: HrOverview["payroll"] = null;
    if (ctx.campus !== "ALL" && canPay(user, ctx.campus)) {
      const cs = campusSettings(env.settings, ctx.campus);
      const prev = `${TODAY.slice(0, 4)}-${pad(Number(TODAY.slice(5, 7)) - 1)}`;
      const run = w.payroll.find((r) => r.campus === ctx.campus && r.month === prev);
      payroll = { month: prev, status: !cs.runsPayroll ? "NOT_RUN" : (run?.status ?? "NOT_STARTED") };
    }
    const out: HrOverview = {
      active: active.length,
      byCategory: cats.map((category) => ({ category, count: active.filter((s) => catOf(s) === category).length })).filter((c) => c.count > 0),
      female: active.filter((s) => s.gender === "F").length,
      male: active.filter((s) => s.gender === "M").length,
      onLeaveToday: active.filter((s) => onApprovedLeave(env, s.id, TODAY)).length,
      onProbation: active.filter((s) => postingFor(s, ctx.campus).employmentType === "PROBATION").length,
      joinedThisSession: people.filter((s) => inSession(postingFor(s, ctx.campus).startDate)).length,
      leftThisSession: people.filter((s) => s.status === "LEFT" && inSession(s.leavingDate)).length,
      sharedWithOtherCampuses: active.filter((s) => new Set(s.postings.filter((p) => postingActiveOn(p, TODAY)).map((p) => p.campus)).size > 1).length,
      missingDocuments: active.filter((s) => s.documents.some((d) => d.required && !d.fileName)).length,
      pendingLeave: w.leave.filter((l) => l.status === "PENDING" && camp(l.campus)).length,
      pendingLoans: w.loans.filter((l) => l.status === "PENDING" && camp(l.campus)).length,
      pendingIncrements: w.increments.filter((r) => r.status === "PENDING" && camp(r.campus)).length,
      payroll,
    };
    return HttpResponse.json(out);
  }),

  http.get("/api/hr/staff", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("hr.view", ctx.campus);
    if (user instanceof Response) return user;
    const env = liveEnv();
    const showPay = canPay(user, ctx.campus);
    return HttpResponse.json(env.staff.filter((s) => worksAt(s, ctx.campus)).map((s) => toSummary(env, s, ctx.campus, showPay)));
  }),

  http.get("/api/hr/staff/check-cnic", async ({ request }) => {
    await latency();
    const user = requireUser();
    if (user instanceof Response) return user;
    const cnic = (new URL(request.url).searchParams.get("cnic") ?? "").replace(/\D/g, "");
    const s = staffStore.get().find((x) => x.cnic === cnic);
    return HttpResponse.json({ match: s ? { staffId: s.id, name: s.name, employeeNo: s.employeeNo, campuses: [...new Set(s.postings.map((p) => p.campus))], status: s.status } : null });
  }),

  http.get("/api/hr/staff/:id", async ({ request, params }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("hr.view", ctx.campus);
    if (user instanceof Response) return user;
    const s = staffById(String(params.id));
    if (!s || !worksAt(s, ctx.campus)) return fail(404, "NOT_FOUND", ctx.campus === "ALL" ? "No staff record with this number." : `This person doesn't work at ${campusName(ctx.campus)}. Switch campus or open them from All campuses.`);
    return HttpResponse.json(toProfile(liveEnv(), s, ctx.campus, user));
  }),

  http.post("/api/hr/staff", async ({ request }) => {
    await latency();
    const body = (await request.json()) as HrNewStaffInput;
    const user = requirePermission("hr.manage", body.campus);
    if (user instanceof Response) return user;
    const key = request.headers.get("Idempotency-Key");
    const w = workStore.get();
    if (key && w.idem[key]) {
      const prev = staffById(w.idem[key]!);
      if (prev) return HttpResponse.json(toProfile(liveEnv(), prev, body.campus, user));
    }
    const bad = validatePersonal(body);
    if (bad) return bad;
    const st = settingsStore.get();
    const des = st.designations.find((d) => d.id === body.designationId && d.active);
    if (!des) return fail(422, "VALIDATION", "Choose the designation.", { field: "designationId" });
    if (!st.departments.some((d) => d.id === body.departmentId && d.active)) return fail(422, "VALIDATION", "Choose the department.", { field: "departmentId" });
    if (!isDate(body.joiningDate)) return fail(422, "VALIDATION", "Enter the joining date.", { field: "joiningDate" });
    if (body.joiningDate > addDays(TODAY, 60)) return fail(422, "VALIDATION", "The joining date can be at most two months ahead.", { field: "joiningDate" });
    if (yearsBetween(body.dob, body.joiningDate) < 18) return fail(422, "VALIDATION", "Staff must be at least 18 on the joining date.", { field: "dob" });
    if (body.payScale && !PAY_SCALES.includes(body.payScale)) return fail(422, "VALIDATION", "Choose a pay scale from the list.", { field: "payScale" });
    const showPay = can(user, "payroll.manage", body.campus);
    if (body.pay && showPay) {
      if (!whole(body.pay.basic) || body.pay.basic < 1000) return fail(422, "VALIDATION", "Enter the monthly basic pay in whole rupees.", { field: "basic" });
      const bb = validateBank(body.pay.paymentMethod, body.pay.bank, true);
      if (bb) return bb;
    }
    const teaching = isTeachingCat(des.category) || des.id === "d-head";
    const prefix = `${body.campus}-${teaching ? "T" : "S"}`;
    const all = staffStore.get();
    const maxNo = Math.max(0, ...all.filter((s) => s.employeeNo.startsWith(prefix)).map((s) => Number(s.employeeNo.slice(-4))));
    const employeeNo = `${prefix}-${pad(maxNo + 1, 4)}`;
    const docs: DocRec[] = (["CNIC", "PHOTO", "APPOINTMENT", ...(teaching ? (["DEGREE"] as const) : (["POLICE"] as const))] as const).map((kind, i) => ({ id: `doc-${i + 1}`, kind, title: { CNIC: "CNIC copy (both sides)", PHOTO: "Passport-size photograph", APPOINTMENT: "Signed appointment letter", DEGREE: "Highest degree", POLICE: "Police character certificate" }[kind], fileName: null, sizeKb: null, uploadedAt: null, uploadedBy: null, required: true }));
    const rec: StaffRec = {
      id: `st-${employeeNo.toLowerCase()}`,
      employeeNo,
      name: body.name.trim(),
      nameUrdu: body.nameUrdu?.trim() || null,
      gender: body.gender,
      relation: body.relation,
      guardianName: body.guardianName.trim(),
      cnic: body.cnic,
      dob: body.dob,
      bloodGroup: body.bloodGroup,
      maritalStatus: body.maritalStatus,
      religion: body.religion || "Islam",
      mobile: normalizeMobile(body.mobile)!,
      mobile2: body.mobile2 ? normalizeMobile(body.mobile2) : null,
      email: body.email?.trim() || null,
      address: body.address.trim(),
      city: body.city.trim(),
      emergency: { ...body.emergency, mobile: normalizeMobile(body.emergency.mobile)! },
      reference: body.reference?.trim() || null,
      caste: body.caste?.trim() || null,
      priorServiceYears: body.priorServiceYears,
      probationEnds: body.employmentType === "PROBATION" ? `${Number(body.joiningDate.slice(0, 4)) + (Number(body.joiningDate.slice(5, 7)) + (body.probationMonths ?? 6) > 12 ? 1 : 0)}-${pad(((Number(body.joiningDate.slice(5, 7)) - 1 + (body.probationMonths ?? 6)) % 12) + 1)}${body.joiningDate.slice(7)}` : null,
      status: "ACTIVE",
      leavingDate: null,
      leavingReason: null,
      postings: [{ id: "p1", campus: body.campus, designationId: des.id, departmentId: body.departmentId, employmentType: body.employmentType, payScale: body.payScale, startDate: body.joiningDate, endDate: null, endReason: null, primary: true, daysPerWeek: null, workDays: null, deviceEnrolNo: null, classTeacherOf: null }],
      qualifications: body.qualification ? [{ id: "q1", ...body.qualification }] : [],
      experience: [],
      teachingLevels: body.teachingLevels ?? [],
      subjectIds: body.subjectIds ?? [],
      documents: docs,
      salary: body.pay && showPay ? [{ id: "sh-1", effectiveFrom: body.joiningDate, basic: body.pay.basic, reason: "APPOINTMENT", note: "Appointed", by: user.name }] : [],
      pay: {
        specialAllowance: body.pay && showPay ? body.pay.specialAllowance || 0 : 0,
        paymentMethod: body.pay && showPay ? body.pay.paymentMethod : "BANK",
        bank: body.pay && showPay && body.pay.bank && body.pay.paymentMethod === "BANK" ? { bankName: body.pay.bank.bankName, branch: body.pay.bank.branch, accountTitle: body.pay.bank.accountTitle, accountNo: body.pay.bank.accountNo ?? "" } : null,
        eobi: body.pay && showPay ? body.pay.eobi : body.employmentType !== "VISITING",
        providentFund: body.pay && showPay ? body.pay.providentFund : false,
      },
      children: [],
      userName: null,
      history: [audit(user.name, "Staff record created", `${des.title} at ${campusName(body.campus)} from ${formatDate(body.joiningDate)}`)],
      rowVer: 1,
    };
    staffStore.set((xs) => [...xs, rec]);
    if (key) workStore.set((x) => ({ ...x, idem: { ...x.idem, [key]: rec.id } }));
    return HttpResponse.json(toProfile(liveEnv(), rec, body.campus, user), { status: 201 });
  }),

  http.put("/api/hr/staff/:id/personal", async ({ request, params }) => {
    await latency();
    const s = staffById(String(params.id));
    if (!s) return fail(404, "NOT_FOUND", "Staff record not found.");
    const user = requireFor("hr.manage", s);
    if (user instanceof Response) return user;
    const b = (await request.json()) as HrPersonalInput & { rowVer: number };
    if (b.rowVer !== s.rowVer) return conflict(s);
    const bad = validatePersonal(b, s.id);
    if (bad) return bad;
    const changed = (["name", "cnic", "mobile", "address", "dob"] as const).filter((k) => String(s[k]) !== String(k === "mobile" ? normalizeMobile(b.mobile) : b[k]));
    const next: StaffRec = {
      ...s,
      name: b.name.trim(),
      nameUrdu: b.nameUrdu?.trim() || null,
      gender: b.gender,
      relation: b.relation,
      guardianName: b.guardianName.trim(),
      cnic: b.cnic,
      dob: b.dob,
      bloodGroup: b.bloodGroup,
      maritalStatus: b.maritalStatus,
      religion: b.religion,
      mobile: normalizeMobile(b.mobile)!,
      mobile2: b.mobile2 ? normalizeMobile(b.mobile2) : null,
      email: b.email?.trim() || null,
      address: b.address.trim(),
      city: b.city.trim(),
      emergency: { ...b.emergency, mobile: normalizeMobile(b.emergency.mobile)! },
      reference: b.reference === undefined ? (s.reference ?? null) : b.reference?.trim() || null,
      caste: b.caste === undefined ? (s.caste ?? null) : b.caste?.trim() || null,
      priorServiceYears: b.priorServiceYears,
      rowVer: s.rowVer + 1,
      history: [...s.history, audit(user.name, "Personal details changed", changed.length ? `Changed: ${changed.join(", ").replace("dob", "date of birth")}` : undefined)],
    };
    saveStaff(next);
    return HttpResponse.json(toProfile(liveEnv(), next, ctxFrom(new URL(request.url)).campus, user));
  }),

  http.post("/api/hr/staff/:id/postings", async ({ request, params }) => {
    await latency();
    const s = staffById(String(params.id));
    if (!s) return fail(404, "NOT_FOUND", "Staff record not found.");
    const b = (await request.json()) as HrPostingInput;
    const user = requirePermission("hr.manage", b.campus);
    if (user instanceof Response) return user;
    if (s.status === "LEFT") return fail(409, "STAFF_LEFT", `${s.name} has left. Rejoin them before adding a posting.`);
    if (s.postings.some((p) => p.campus === b.campus && !p.endDate)) return fail(409, "ALREADY_POSTED", `${s.name} already works at ${campusName(b.campus)}. Change that posting instead.`, { field: "campus" });
    const st = settingsStore.get();
    if (!st.designations.some((d) => d.id === b.designationId && d.active)) return fail(422, "VALIDATION", "Choose the designation.", { field: "designationId" });
    if (!st.departments.some((d) => d.id === b.departmentId)) return fail(422, "VALIDATION", "Choose the department.", { field: "departmentId" });
    if (!isDate(b.startDate)) return fail(422, "VALIDATION", "Enter the start date.", { field: "startDate" });
    if (b.daysPerWeek !== null && (!whole(b.daysPerWeek) || b.daysPerWeek < 1 || b.daysPerWeek > 6)) return fail(422, "VALIDATION", "Days a week must be 1 to 6, or leave it empty for full time.", { field: "daysPerWeek" });
    const next: StaffRec = {
      ...s,
      postings: [...s.postings, { id: newId("p"), campus: b.campus, designationId: b.designationId, departmentId: b.departmentId, employmentType: b.employmentType, payScale: b.payScale, startDate: b.startDate, endDate: null, endReason: null, primary: false, daysPerWeek: b.daysPerWeek, workDays: null, deviceEnrolNo: null, classTeacherOf: null }],
      rowVer: s.rowVer + 1,
      history: [...s.history, audit(user.name, `Added a posting at ${campusName(b.campus)}`, `${designation(st, b.designationId)?.title} from ${formatDate(b.startDate)}${b.daysPerWeek ? `, ${b.daysPerWeek} days a week` : ""}. Salary stays with ${campusName(primaryPosting(s).campus)}.`)],
    };
    saveStaff(next);
    return HttpResponse.json(toProfile(liveEnv(), next, ctxFrom(new URL(request.url)).campus, user));
  }),

  http.post("/api/hr/staff/:id/postings/:pid/end", async ({ request, params }) => {
    await latency();
    const s = staffById(String(params.id));
    const p = s?.postings.find((x) => x.id === params.pid);
    if (!s || !p) return fail(404, "NOT_FOUND", "Posting not found.");
    const user = requirePermission("hr.manage", p.campus);
    if (user instanceof Response) return user;
    const b = (await request.json()) as { endDate: string; reason: string };
    if (p.primary) return fail(409, "PRIMARY_POSTING", "This is the main posting that pays the salary. Use “Mark as left” to end it.");
    if (!isDate(b.endDate) || b.endDate < p.startDate) return fail(422, "VALIDATION", "The end date must be after the posting started.", { field: "endDate" });
    if (!b.reason?.trim()) return fail(422, "VALIDATION", "Say why the posting ends.", { field: "reason" });
    const next: StaffRec = { ...s, postings: s.postings.map((x) => (x.id === p.id ? { ...x, endDate: b.endDate, endReason: b.reason.trim() } : x)), rowVer: s.rowVer + 1, history: [...s.history, audit(user.name, `Posting at ${campusName(p.campus)} ended`, `${formatDate(b.endDate)} · ${b.reason.trim()}`)] };
    saveStaff(next);
    return HttpResponse.json(toProfile(liveEnv(), next, ctxFrom(new URL(request.url)).campus, user));
  }),

  http.put("/api/hr/staff/:id/qualifications", async ({ request, params }) => {
    await latency();
    const s = staffById(String(params.id));
    if (!s) return fail(404, "NOT_FOUND", "Staff record not found.");
    const user = requireFor("hr.manage", s);
    if (user instanceof Response) return user;
    const b = (await request.json()) as { qualifications: StaffRec["qualifications"]; experience: StaffRec["experience"] };
    for (const q of b.qualifications) {
      if (!q.degree?.trim() || !q.institution?.trim()) return fail(422, "VALIDATION", "Each qualification needs the degree and the institution.", { field: "qualifications" });
      if (!whole(q.year) || q.year < 1960 || q.year > 2026) return fail(422, "VALIDATION", `Check the year for ${q.degree}.`, { field: "qualifications" });
    }
    for (const x of b.experience) {
      if (!x.organisation?.trim()) return fail(422, "VALIDATION", "Each job needs the school or organisation name.", { field: "experience" });
      if (!isDate(x.from) || !isDate(x.to) || x.to < x.from) return fail(422, "VALIDATION", `Check the dates for ${x.organisation}.`, { field: "experience" });
    }
    const next: StaffRec = { ...s, qualifications: b.qualifications.map((q, i) => ({ ...q, id: q.id || `q${i + 1}` })), experience: b.experience.map((x, i) => ({ ...x, id: x.id || `x${i + 1}` })), rowVer: s.rowVer + 1, history: [...s.history, audit(user.name, "Qualifications and experience updated")] };
    saveStaff(next);
    return HttpResponse.json(toProfile(liveEnv(), next, ctxFrom(new URL(request.url)).campus, user));
  }),

  http.put("/api/hr/staff/:id/teaching", async ({ request, params }) => {
    await latency();
    const s = staffById(String(params.id));
    if (!s) return fail(404, "NOT_FOUND", "Staff record not found.");
    const user = requireFor("hr.manage", s);
    if (user instanceof Response) return user;
    const b = (await request.json()) as { teachingLevels: string[]; subjectIds: string[] };
    const next: StaffRec = { ...s, teachingLevels: b.teachingLevels.filter((l) => TEACHING_LEVELS.includes(l)), subjectIds: b.subjectIds, rowVer: s.rowVer + 1, history: [...s.history, audit(user.name, "Teaching levels and subjects updated")] };
    saveStaff(next);
    return HttpResponse.json(toProfile(liveEnv(), next, ctxFrom(new URL(request.url)).campus, user));
  }),

  http.put("/api/hr/staff/:id/pay", async ({ request, params }) => {
    await latency();
    const s = staffById(String(params.id));
    if (!s) return fail(404, "NOT_FOUND", "Staff record not found.");
    const user = requirePermission("payroll.manage", primaryPosting(s).campus);
    if (user instanceof Response) return user;
    const b = (await request.json()) as HrPayInput;
    if (b.rowVer !== s.rowVer) return conflict(s);
    if (!whole(b.basic) || b.basic < 1000) return fail(422, "VALIDATION", "Enter the monthly basic pay in whole rupees.", { field: "basic" });
    if (!whole(b.specialAllowance) || b.specialAllowance < 0) return fail(422, "VALIDATION", "Enter the special allowance in whole rupees (0 for none).", { field: "specialAllowance" });
    const current = basicOn(s, TODAY);
    const history = [...s.history];
    let salary = s.salary;
    if (b.basic !== current) {
      if (!isDate(b.effectiveFrom)) return fail(422, "VALIDATION", "Say from when the new basic pay applies.", { field: "effectiveFrom" });
      if (b.effectiveFrom < `${THIS_MONTH}-01`) return fail(422, "VALIDATION", "Salary sheets before this month are already prepared. Choose this month or later, and pay arrears as a bonus.", { field: "effectiveFrom" });
      if (!b.reason?.trim()) return fail(422, "VALIDATION", "Say why the basic pay changes; it shows in the salary history.", { field: "reason" });
      salary = [...s.salary.filter((r) => r.effectiveFrom !== b.effectiveFrom), { id: newId("sh"), effectiveFrom: b.effectiveFrom, basic: b.basic, reason: s.salary.length ? "REVISION" : "APPOINTMENT", note: b.reason.trim(), by: user.name }];
      history.push(audit(user.name, `Basic pay ${s.salary.length ? `changed from ${formatRs(current)} ` : ""}to ${formatRs(b.basic)}`, `From ${formatDate(b.effectiveFrom)} · ${b.reason.trim()}`));
    }
    const bb = validateBank(b.paymentMethod, b.bank, !s.pay.bank);
    if (bb) return bb;
    const bank = b.paymentMethod === "BANK" && b.bank ? { bankName: b.bank.bankName, branch: b.bank.branch, accountTitle: b.bank.accountTitle, accountNo: b.bank.accountNo || s.pay.bank?.accountNo || "" } : s.pay.bank;
    if (bank?.accountNo !== s.pay.bank?.accountNo || b.paymentMethod !== s.pay.paymentMethod) history.push(audit(user.name, "Payment details changed", b.paymentMethod === "BANK" ? `${bank?.bankName} ${maskAccount(bank?.accountNo ?? "")}` : `Paid by ${b.paymentMethod.toLowerCase()}`));
    if (b.specialAllowance !== s.pay.specialAllowance) history.push(audit(user.name, `Special allowance set to ${formatRs(b.specialAllowance)}`));
    const children = s.children.map((c) => ({ ...c, adjustAgainstSalary: b.children.find((x) => x.grNo === c.grNo)?.adjustAgainstSalary ?? c.adjustAgainstSalary }));
    if (children.some((c, i) => c.adjustAgainstSalary !== s.children[i]!.adjustAgainstSalary)) history.push(audit(user.name, "Child fee adjustment changed", children.map((c) => `${c.name}: ${c.adjustAgainstSalary ? "taken from salary" : "paid at the counter"}`).join("; ")));
    const next: StaffRec = { ...s, salary, pay: { specialAllowance: b.specialAllowance, paymentMethod: b.paymentMethod, bank, eobi: b.eobi, providentFund: b.providentFund }, children, rowVer: s.rowVer + 1, history };
    saveStaff(next);
    return HttpResponse.json(toProfile(liveEnv(), next, ctxFrom(new URL(request.url)).campus, user));
  }),

  http.post("/api/hr/staff/:id/documents", async ({ request, params }) => {
    await latency();
    const s = staffById(String(params.id));
    if (!s) return fail(404, "NOT_FOUND", "Staff record not found.");
    const user = requireFor("hr.manage", s);
    if (user instanceof Response) return user;
    const b = (await request.json()) as { kind: DocRec["kind"]; title: string; fileName: string; sizeKb: number };
    if (!b.fileName) return fail(422, "VALIDATION", "Choose a file to upload.", { field: "file" });
    if (b.sizeKb > 5120) return fail(422, "VALIDATION", "Files can be up to 5 MB. Scan at a lower resolution and try again.", { field: "file" });
    if (!/\.(pdf|jpe?g|png)$/i.test(b.fileName)) return fail(422, "VALIDATION", "Upload a PDF, JPG or PNG file.", { field: "file" });
    const missing = s.documents.find((d) => d.kind === b.kind && !d.fileName);
    const doc: DocRec = { id: missing?.id ?? newId("doc"), kind: b.kind, title: missing?.title ?? (b.title.trim() || "Document"), fileName: b.fileName, sizeKb: Math.max(1, Math.round(b.sizeKb)), uploadedAt: demoNow(), uploadedBy: user.name, required: missing?.required ?? false };
    const next: StaffRec = { ...s, documents: missing ? s.documents.map((d) => (d.id === missing.id ? doc : d)) : [...s.documents, doc], rowVer: s.rowVer + 1, history: [...s.history, audit(user.name, `Uploaded ${doc.title.toLowerCase()}`, b.fileName)] };
    saveStaff(next);
    return HttpResponse.json(toProfile(liveEnv(), next, ctxFrom(new URL(request.url)).campus, user));
  }),

  http.delete("/api/hr/staff/:id/documents/:docId", async ({ request, params }) => {
    await latency();
    const s = staffById(String(params.id));
    const d = s?.documents.find((x) => x.id === params.docId);
    if (!s || !d) return fail(404, "NOT_FOUND", "Document not found.");
    const user = requireFor("hr.manage", s);
    if (user instanceof Response) return user;
    const docs = d.required ? s.documents.map((x) => (x.id === d.id ? { ...x, fileName: null, sizeKb: null, uploadedAt: null, uploadedBy: null } : x)) : s.documents.filter((x) => x.id !== d.id);
    const next: StaffRec = { ...s, documents: docs, rowVer: s.rowVer + 1, history: [...s.history, audit(user.name, `Removed ${d.title.toLowerCase()}`, d.fileName ?? undefined)] };
    saveStaff(next);
    return HttpResponse.json(toProfile(liveEnv(), next, ctxFrom(new URL(request.url)).campus, user));
  }),

  http.post("/api/hr/staff/:id/leaving", async ({ request, params }) => {
    await latency();
    const s = staffById(String(params.id));
    if (!s) return fail(404, "NOT_FOUND", "Staff record not found.");
    const user = requirePermission("hr.manage", primaryPosting(s).campus);
    if (user instanceof Response) return user;
    const b = (await request.json()) as { date: string; reason: string };
    if (s.status === "LEFT") return fail(409, "ALREADY_LEFT", `${s.name} is already marked as left.`);
    if (!isDate(b.date) || b.date < joiningDate(s)) return fail(422, "VALIDATION", "The last working day must be after the joining date.", { field: "date" });
    if (b.date > addDays(TODAY, 90)) return fail(422, "VALIDATION", "The last working day can be at most three months ahead.", { field: "date" });
    if (!b.reason?.trim()) return fail(422, "VALIDATION", "Say why they are leaving (resigned, contract ended, retired…).", { field: "reason" });
    const env = liveEnv();
    const owing = env.loans.filter((l) => l.staffId === s.id && l.status === "ACTIVE").map((l) => loanSummary(env, l)).filter((l) => l.balance > 0);
    if (owing.length) return fail(409, "LOAN_OUTSTANDING", `${s.name} still owes ${formatRs(sum(owing.map((l) => l.balance)))} on ${owing.map((l) => l.loanNo).join(", ")}. Recover it from the final salary or in cash first, then mark them as left.`);
    const next: StaffRec = { ...s, status: "LEFT", leavingDate: b.date, leavingReason: b.reason.trim(), postings: s.postings.map((p) => (p.endDate ? p : { ...p, endDate: b.date, endReason: b.reason.trim() })), rowVer: s.rowVer + 1, history: [...s.history, audit(user.name, "Marked as left", `Last working day ${formatDate(b.date)} · ${b.reason.trim()}`)] };
    saveStaff(next);
    return HttpResponse.json(toProfile(liveEnv(), next, ctxFrom(new URL(request.url)).campus, user));
  }),

  /* ---------------------------------------------------------------- Attendance */
  http.get("/api/hr/attendance/day", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const campus = url.searchParams.get("campus") as CampusCode;
    const date = url.searchParams.get("date") ?? TODAY;
    const user = requirePermission("hr.view", campus);
    if (user instanceof Response) return user;
    if (!isDate(date)) return fail(422, "VALIDATION", "Choose a date.");
    if (date > TODAY) return fail(422, "FUTURE_DATE", "That day hasn't happened yet. Choose today or an earlier day.");
    return HttpResponse.json(buildDay(campus, date));
  }),

  http.put("/api/hr/attendance/day", async ({ request }) => {
    await latency();
    const b = (await request.json()) as { campus: CampusCode; date: string; entries: HrDayEntryInput[]; reason: string };
    const user = requirePermission("hr.manage", b.campus);
    if (user instanceof Response) return user;
    if (!isDate(b.date) || b.date > TODAY) return fail(422, "VALIDATION", "You can only mark today or earlier days.");
    if (sessionOf(b.date) !== CURRENT_SESSION) return readOnly(sessionOf(b.date))!;
    const env = liveEnv();
    const hol = holidayName(b.campus, b.date, env);
    if (hol || weekday(b.date) === 0) return fail(409, "CLOSED", `${formatDate(b.date)} is ${hol ?? "a Sunday"}; there is no attendance to mark.`);
    const map = { ...(env.overrides[dayKey(b.campus, b.date)] ?? {}) };
    let deviceChanged = 0;
    const allowed: HrDayStatus[] = ["PRESENT", "LATE", "ABSENT", "HALF_DAY", "LEAVE", "OFF"];
    for (const e of b.entries) {
      const s = env.staff.find((x) => x.id === e.staffId);
      if (!s || !activeAt(s, b.campus, b.date)) return fail(422, "VALIDATION", "One of the people doesn't work at this campus on that day. Reload the list.");
      if (!allowed.includes(e.status)) return fail(422, "VALIDATION", `${s.name}: choose a status from the list.`, { field: "status", details: { staffId: s.id } });
      // A rest day given to one person: not a working day, so it is neither paid leave nor an absence.
      if (e.status === "OFF" && (e.note ?? "").trim().length < 3) return fail(422, "VALIDATION", `${s.name}: say why it is a day off (for example: rest day for Saturday duty).`, { field: "note", details: { staffId: s.id } });
      if (e.timeIn && !isTime(e.timeIn)) return fail(422, "VALIDATION", `${s.name}: enter the time in as hh:mm, for example 07:40.`, { field: "timeIn", details: { staffId: s.id } });
      if (e.timeOut && !isTime(e.timeOut)) return fail(422, "VALIDATION", `${s.name}: enter the time out as hh:mm, for example 14:10.`, { field: "timeOut", details: { staffId: s.id } });
      if (e.timeIn && e.timeOut && e.timeOut <= e.timeIn) return fail(422, "VALIDATION", `${s.name}: the time out must be after the time in.`, { field: "timeOut", details: { staffId: s.id } });
      const before = resolveDay(env, s, b.campus, b.date);
      if (before?.source === "DEVICE") deviceChanged++;
      const cs = campusSettings(env.settings, b.campus);
      let status = e.status;
      if ((status === "PRESENT" || status === "LATE") && e.timeIn) status = toMin(e.timeIn) > lateAfter(cs) ? "LATE" : "PRESENT";
      const noTimes = status === "ABSENT" || status === "LEAVE" || status === "OFF";
      map[s.id] = { status, timeIn: noTimes ? null : e.timeIn, timeOut: noTimes ? null : e.timeOut, note: e.note?.trim() || null, by: user.name };
    }
    if (deviceChanged && (b.reason ?? "").trim().length < 5) return fail(422, "REASON_REQUIRED", "You are changing what the fingerprint machine recorded. Say why (for example: machine was down, forgot to punch).", { field: "reason" });
    workStore.set((w) => ({ ...w, overrides: { ...w.overrides, [dayKey(b.campus, b.date)]: map } }));
    return HttpResponse.json(buildDay(b.campus, b.date));
  }),

  http.get("/api/hr/attendance/month", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const campus = url.searchParams.get("campus") as CampusCode;
    const month = url.searchParams.get("month") ?? THIS_MONTH;
    const user = requirePermission("hr.view", campus);
    if (user instanceof Response) return user;
    if (!/^\d{4}-\d{2}$/.test(month) || month > THIS_MONTH) return fail(422, "VALIDATION", "Choose this month or an earlier one.");
    return HttpResponse.json(buildMonth(campus, month));
  }),

  http.get("/api/hr/attendance/range", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const campus = url.searchParams.get("campus") as CampusCode;
    const user = requirePermission("hr.view", campus);
    if (user instanceof Response) return user;
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";
    if (!isDate(from)) return fail(422, "VALIDATION", "Choose the first day.", { field: "from" });
    if (!isDate(to)) return fail(422, "VALIDATION", "Choose the last day.", { field: "to" });
    if (to < from) return fail(422, "VALIDATION", "The last day can't be before the first day.", { field: "to" });
    if (to > TODAY) return fail(422, "VALIDATION", "The last day can be today at the latest.", { field: "to" });
    const span = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
    if (span > RANGE_MAX_DAYS) return fail(422, "VALIDATION", `Choose ${RANGE_MAX_DAYS} days or fewer (about three months). This range is ${span} days.`, { field: "from" });
    return HttpResponse.json(buildRange(campus, from, to, { designationId: url.searchParams.get("designationId"), staffId: url.searchParams.get("staffId") }));
  }),

  http.get("/api/hr/attendance/device-file", async ({ request }) => {
    await latency();
    const campus = new URL(request.url).searchParams.get("campus") as CampusCode;
    const user = requirePermission("hr.manage", campus);
    if (user instanceof Response) return user;
    if (!campusSettings(settingsStore.get(), campus).attendanceDevice) return fail(409, "NO_DEVICE", `${campusName(campus)} has no fingerprint machine set up. Mark attendance by hand, or add the machine in Settings.`);
    return HttpResponse.json(deviceFile(campus));
  }),

  http.post("/api/hr/attendance/import/preview", async ({ request }) => {
    await latency();
    const b = (await request.json()) as { campus: CampusCode; fileName: string; text: string };
    const user = requirePermission("hr.manage", b.campus);
    if (user instanceof Response) return user;
    if (!b.text?.trim()) return fail(422, "EMPTY_FILE", "The file is empty. Export the attendance log from the machine again.");
    if (b.text.length > 2_000_000) return fail(422, "FILE_TOO_LARGE", "The file is too large. Export one month at a time.");
    const env = liveEnv();
    const w = workStore.get();
    const { punches, bad, lines } = parsePunches(b.text);
    if (!punches.length) return fail(422, "NO_PUNCHES", bad.length ? `No line could be read. First problem: line ${bad[0]!.line} — ${bad[0]!.problem}` : "No punches found in this file.");
    const people = env.staff.filter((s) => s.postings.some((p) => p.campus === b.campus));
    const byEnrol = new Map<string, StaffRec>();
    for (const s of people) {
      const p = postingAt(s, b.campus);
      if (p?.deviceEnrolNo && activeAt(s, b.campus)) byEnrol.set(p.deviceEnrolNo, s);
    }
    const seen = new Set<string>();
    let dup = 0;
    const fresh: ParsedPunch[] = [];
    for (const p of punches) {
      const k = `${p.enrol}@${p.time}:${p.seconds}`;
      const dk = `${dayKey(b.campus, p.date)}|${k}`;
      if (seen.has(dk) || (w.punchKeys[dayKey(b.campus, p.date)] ?? []).includes(k)) {
        dup++;
        continue;
      }
      seen.add(dk);
      fresh.push(p);
    }
    const unknownMap = new Map<string, ParsedPunch[]>();
    for (const p of fresh) if (!byEnrol.has(p.enrol)) unknownMap.set(p.enrol, [...(unknownMap.get(p.enrol) ?? []), p]);
    const unknown = [...unknownMap.entries()].map(([enrol, ps]) => {
      const tail = enrol.slice(-3);
      const suggestions = people
        .filter((s) => activeAt(s, b.campus) && !postingAt(s, b.campus)?.deviceEnrolNo && s.employeeNo.endsWith(tail.padStart(4, "0").slice(-4)))
        .map((s) => ({ staffId: s.id, name: s.name, employeeNo: s.employeeNo, reason: `Employee number ${s.employeeNo} ends in ${tail}, and they have no machine number yet` }));
      return { enrolNo: enrol, punches: ps.length, firstPunch: `${formatDate(ps[0]!.date)} ${ps[0]!.time}`, suggestions };
    });
    const grouped = new Map<string, { s: StaffRec; date: string; times: string[] }>();
    for (const p of fresh) {
      const s = byEnrol.get(p.enrol);
      if (!s) continue;
      const k = `${s.id}|${p.date}`;
      grouped.set(k, { s, date: p.date, times: [...(grouped.get(k)?.times ?? []), p.time] });
    }
    const cs = campusSettings(env.settings, b.campus);
    const sample = [...grouped.values()]
      .sort((a, b2) => b2.date.localeCompare(a.date) || a.s.name.localeCompare(b2.s.name))
      .slice(0, 8)
      .map((g) => {
        const t = [...g.times].sort();
        const first = t[0]!;
        const last = t.at(-1)!;
        return { staffId: g.s.id, name: g.s.name, date: g.date, firstIn: first, lastOut: toMin(last) - toMin(first) >= 60 ? last : null, lateMinutes: toMin(first) > lateAfter(cs) ? toMin(first) - toMin(cs.dayStarts) : 0 };
      });
    const dates = punches.map((p) => p.date).sort();
    const preview: HrImportPreview = {
      previewId: newId("pv"),
      fileName: b.fileName || "attendance.csv",
      deviceName: cs.deviceName ?? "Fingerprint machine",
      lines,
      totalPunches: punches.length,
      newPunches: fresh.length,
      duplicates: dup,
      badLines: bad,
      from: dates[0] ?? null,
      to: dates.at(-1) ?? null,
      matchedStaff: new Set([...grouped.values()].map((g) => g.s.id)).size,
      unknown,
      sample,
    };
    previews.set(preview.previewId, { campus: b.campus, fileName: preview.fileName, punches: fresh, preview });
    return HttpResponse.json(preview);
  }),

  http.post("/api/hr/attendance/import/commit", async ({ request }) => {
    await latency();
    const b = (await request.json()) as HrImportCommitInput;
    const user = requirePermission("hr.manage", b.campus);
    if (user instanceof Response) return user;
    const key = request.headers.get("Idempotency-Key");
    const w0 = workStore.get();
    if (key && w0.idem[key]) {
      const batch = w0.batches.find((x) => x.id === w0.idem[key]);
      if (batch) return HttpResponse.json({ batch, daysUpdated: batch.days.length, staffUpdated: batch.staff, late: 0, mapped: 0 });
    }
    const pv = previews.get(b.previewId);
    if (!pv || pv.campus !== b.campus) return fail(410, "PREVIEW_EXPIRED", "This preview has expired (the page was reloaded). Read the file again.");
    for (const u of pv.preview.unknown) {
      const target = b.mapping[u.enrolNo];
      if (!target) return fail(422, "UNMAPPED", `Choose who machine number ${u.enrolNo} is, or choose “Ignore these punches”.`, { field: "mapping", details: { enrolNo: u.enrolNo } });
      if (target !== "IGNORE" && !staffById(target)) return fail(422, "UNMAPPED", `Machine number ${u.enrolNo}: that staff member wasn't found.`, { field: "mapping" });
    }
    const env = liveEnv();
    const byEnrol = new Map<string, string>();
    for (const s of env.staff) {
      const p = postingAt(s, b.campus);
      if (p?.deviceEnrolNo && activeAt(s, b.campus)) byEnrol.set(p.deviceEnrolNo, s.id);
    }
    let ignored = 0;
    let mapped = 0;
    for (const [enrol, target] of Object.entries(b.mapping)) if (target !== "IGNORE" && !byEnrol.has(enrol)) (byEnrol.set(enrol, target), mapped++);
    const imported = { ...w0.imported };
    const punchKeys = { ...w0.punchKeys };
    const days = new Set<string>();
    const staffTouched = new Set<string>();
    let used = 0;
    for (const p of pv.punches) {
      const sid = byEnrol.get(p.enrol);
      if (!sid) {
        ignored++;
        continue;
      }
      const dk = dayKey(b.campus, p.date);
      const day = { ...(imported[dk] ?? {}) };
      const prev = day[sid];
      const times = [prev?.firstIn, prev?.lastOut, p.time].filter((x): x is string => Boolean(x)).sort();
      const first = times[0]!;
      const last = times.at(-1)!;
      day[sid] = { firstIn: first, lastOut: toMin(last) - toMin(first) >= 60 ? last : null };
      imported[dk] = day;
      punchKeys[dk] = [...(punchKeys[dk] ?? []), `${p.enrol}@${p.time}:${p.seconds}`];
      days.add(p.date);
      staffTouched.add(sid);
      used++;
    }
    const cs = campusSettings(env.settings, b.campus);
    let late = 0;
    for (const d of days) for (const sid of staffTouched) if (imported[dayKey(b.campus, d)]?.[sid] && toMin(imported[dayKey(b.campus, d)]![sid]!.firstIn) > lateAfter(cs)) late++;
    const batch: HrImportBatch = { id: newId("imp"), campus: b.campus, fileName: pv.fileName, deviceName: pv.preview.deviceName, importedAt: demoNow(), importedBy: user.name, punches: pv.preview.totalPunches, newPunches: used, duplicates: pv.preview.duplicates, ignored, days: [...days].sort(), staff: staffTouched.size };
    workStore.set((w) => ({ ...w, imported, punchKeys, batches: [...w.batches, batch], idem: key ? { ...w.idem, [key]: batch.id } : w.idem }));
    if (b.remember && mapped) {
      staffStore.set((all) =>
        all.map((s) => {
          const enrol = Object.entries(b.mapping).find(([, t]) => t === s.id)?.[0];
          if (!enrol) return s;
          return { ...s, postings: s.postings.map((p) => (p.campus === b.campus && !p.endDate ? { ...p, deviceEnrolNo: enrol } : p)), rowVer: s.rowVer + 1, history: [...s.history, audit(user.name, `Fingerprint machine number ${enrol} linked`, `${campusName(b.campus)} · ${pv.preview.deviceName}`)] };
        }),
      );
    }
    previews.delete(b.previewId);
    return HttpResponse.json({ batch, daysUpdated: days.size, staffUpdated: staffTouched.size, late, mapped });
  }),

  http.get("/api/hr/attendance/imports", async ({ request }) => {
    await latency();
    const campus = new URL(request.url).searchParams.get("campus") as CampusCode;
    const user = requirePermission("hr.view", campus);
    if (user instanceof Response) return user;
    return HttpResponse.json(workStore.get().batches.filter((x) => x.campus === campus).sort((a, b) => b.importedAt.localeCompare(a.importedAt)));
  }),

  /* ---------------------------------------------------------------- Leave */
  http.get("/api/hr/leave", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("hr.view", ctx.campus);
    if (user instanceof Response) return user;
    const env = liveEnv();
    const mine = env.leave.filter((l) => l.session === ctx.session && (ctx.campus === "ALL" || l.campus === ctx.campus));
    const requests = mine.map((l) => toLeave(env, l)).sort((a, b) => Number(b.status === "PENDING") - Number(a.status === "PENDING") || b.requestedAt.localeCompare(a.requestedAt));
    const today = mine.filter((l) => l.status === "APPROVED" && l.from <= TODAY && l.to >= TODAY);
    const out: HrLeaveData = {
      types: env.settings.leaveTypes,
      requests,
      summary: {
        pending: requests.filter((r) => r.status === "PENDING").length,
        onLeaveToday: today.map((l) => ({ staffId: l.staffId, name: env.staff.find((s) => s.id === l.staffId)?.name ?? "", typeName: env.settings.leaveTypes.find((t) => t.id === l.typeId)?.name ?? "Leave", until: l.to })),
        daysThisMonth: sum(requests.filter((r) => r.status === "APPROVED" && r.from.slice(0, 7) === THIS_MONTH).map((r) => r.days)),
        approvedThisSession: requests.filter((r) => r.status === "APPROVED").length,
      },
    };
    return HttpResponse.json(out);
  }),

  http.get("/api/hr/leave/balances", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("hr.view", ctx.campus);
    if (user instanceof Response) return user;
    const env = liveEnv();
    const rows: HrLeaveBalanceRow[] = env.staff
      .filter((s) => s.status === "ACTIVE" && (ctx.campus === "ALL" ? true : primaryPosting(s).campus === ctx.campus))
      .map((s) => ({ staffId: s.id, name: s.name, employeeNo: s.employeeNo, designation: designation(env.settings, primaryPosting(s).designationId)?.title ?? "", balances: balancesFor(env, s, ctx.session) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return HttpResponse.json(rows);
  }),

  http.post("/api/hr/leave", async ({ request }) => {
    await latency();
    const b = (await request.json()) as HrLeaveInput;
    const user = requirePermission("hr.manage", b.campus);
    if (user instanceof Response) return user;
    const ro = readOnly(b.session);
    if (ro) return ro;
    const key = request.headers.get("Idempotency-Key");
    const w = workStore.get();
    if (key && w.idem[key]) {
      const prev = w.leave.find((l) => l.id === w.idem[key]);
      if (prev) return HttpResponse.json(toLeave(liveEnv(), prev));
    }
    const env = liveEnv();
    const s = env.staff.find((x) => x.id === b.staffId);
    if (!s || !activeAt(s, b.campus, b.from) || s.status === "LEFT") return fail(422, "VALIDATION", "Choose a staff member who works at this campus.", { field: "staffId" });
    const v = validateLeave(env, s, b, b.session);
    if (v instanceof Response) return v;
    const approve = b.approved && (can(user, "approvals.decide", b.campus) || can(user, "hr.manage", b.campus));
    const rec: LeaveRec = {
      id: newId("lv"),
      staffId: s.id,
      campus: b.campus,
      session: b.session,
      typeId: b.typeId,
      from: b.from,
      to: b.to,
      halfDay: b.halfDay,
      reason: b.reason.trim(),
      status: approve ? "APPROVED" : "PENDING",
      source: "OFFICE",
      requestedBy: user.name,
      requestedAt: demoNow(),
      decidedBy: approve ? user.name : null,
      decidedAt: approve ? demoNow() : null,
      decisionNote: approve ? "Approved on paper; recorded by the office" : null,
      history: [audit(user.name, approve ? "Recorded as approved" : "Asked for leave on their behalf")],
    };
    workStore.set((x) => ({ ...x, leave: [...x.leave, rec], idem: key ? { ...x.idem, [key]: rec.id } : x.idem }));
    return HttpResponse.json(toLeave(liveEnv(), rec), { status: 201 });
  }),

  http.post("/api/hr/leave/:id/decide", async ({ request, params }) => {
    await latency();
    const w = workStore.get();
    const l = w.leave.find((x) => x.id === params.id);
    if (!l) return fail(404, "NOT_FOUND", "Leave request not found.");
    const user = requireUser();
    if (user instanceof Response) return user;
    if (!can(user, "approvals.decide", l.campus) && !can(user, "hr.manage", l.campus)) return fail(403, "FORBIDDEN", "Only the principal or HR can decide leave.");
    const ro = readOnly(l.session);
    if (ro) return ro;
    if (l.status !== "PENDING") return fail(409, "ALREADY_DECIDED", `This request was already ${l.status.toLowerCase()} by ${l.decidedBy ?? "someone else"}.`);
    const b = (await request.json()) as { approve: boolean; note: string };
    const env = liveEnv();
    const s = env.staff.find((x) => x.id === l.staffId)!;
    if (s.userName && s.userName === user.username) return fail(409, "OWN_REQUEST", "You can't decide your own leave. Another approver must.");
    if (!b.approve && (b.note ?? "").trim().length < 5) return fail(422, "VALIDATION", "Say why it's rejected; the staff member sees this.", { field: "note" });
    if (b.approve) {
      const v = validateLeave({ ...env, leave: env.leave.filter((x) => x.id !== l.id) }, s, l, l.session, l.id);
      if (v instanceof Response) return v;
    }
    const next: LeaveRec = { ...l, status: b.approve ? "APPROVED" : "REJECTED", decidedBy: user.name, decidedAt: demoNow(), decisionNote: b.note?.trim() || null, history: [...l.history, audit(user.name, b.approve ? "Approved" : "Rejected", b.note?.trim() || undefined)] };
    workStore.set((x) => ({ ...x, leave: x.leave.map((y) => (y.id === l.id ? next : y)) }));
    return HttpResponse.json(toLeave(liveEnv(), next));
  }),

  http.post("/api/hr/leave/:id/cancel", async ({ request, params }) => {
    await latency();
    const l = workStore.get().leave.find((x) => x.id === params.id);
    if (!l) return fail(404, "NOT_FOUND", "Leave request not found.");
    const user = requireUser();
    if (user instanceof Response) return user;
    const s = staffById(l.staffId)!;
    if (!can(user, "hr.manage", l.campus) && s.userName !== user.username) return fail(403, "FORBIDDEN", "Only HR or the staff member can cancel this request.");
    if (l.status === "REJECTED" || l.status === "CANCELLED") return fail(409, "ALREADY_CLOSED", `This request is already ${l.status.toLowerCase()}.`);
    if (l.status === "APPROVED" && l.from <= TODAY) return fail(409, "STARTED", "This leave has already started. Change the attendance for the days not taken instead.");
    const b = (await request.json()) as { reason: string };
    const next: LeaveRec = { ...l, status: "CANCELLED", history: [...l.history, audit(user.name, "Cancelled", b.reason?.trim() || undefined)] };
    workStore.set((x) => ({ ...x, leave: x.leave.map((y) => (y.id === l.id ? next : y)) }));
    return HttpResponse.json(toLeave(liveEnv(), next));
  }),

  http.get("/api/hr/attendance/mine", async ({ request }) => {
    await latency();
    const user = requireUser();
    if (user instanceof Response) return user;
    const env = liveEnv();
    const s = env.staff.find((x) => x.userName === user.username);
    if (!s) return fail(404, "NOT_LINKED", "Your sign-in isn't linked to a staff record. Ask the office to link it.");
    const month = new URL(request.url).searchParams.get("month") || THIS_MONTH;
    if (!/^\d{4}-\d{2}$/.test(month) || month > THIS_MONTH) return fail(422, "VALIDATION", "Choose this month or an earlier one.", { field: "month" });
    const campus = primaryPosting(s).campus;
    const dates = monthDates(month).filter((d) => d <= TODAY);
    if (!dates.length) return fail(422, "VALIDATION", "Choose this month or an earlier one.", { field: "month" });
    const range = buildRange(campus, dates[0]!, dates.at(-1)!, { staffId: s.id });
    const row = range.rows[0];
    const body: HrMyAttendance = {
      staffId: s.id,
      name: s.name,
      campus,
      month,
      workingDays: range.workingDays,
      present: row?.present ?? 0,
      late: row?.late ?? 0,
      absent: row?.absent ?? 0,
      leave: row?.leave ?? 0,
      halfDay: row?.halfDay ?? 0,
      lateMinutes: row?.lateMinutes ?? 0,
      percent: row?.percent ?? null,
      days: range.days.map((d) => {
        const c = row?.cells[d.date];
        return { date: d.date, status: c?.status ?? null, timeIn: c?.timeIn ?? null, timeOut: c?.timeOut ?? null, lateMinutes: c?.lateMinutes ?? 0, leaveType: c?.leaveType ?? null, closed: d.holiday ?? (d.weekday === 0 ? "Sunday" : null) };
      }),
    };
    return HttpResponse.json(body);
  }),

  http.get("/api/hr/leave/mine", async () => {
    await latency();
    const user = requireUser();
    if (user instanceof Response) return user;
    const env = liveEnv();
    const s = env.staff.find((x) => x.userName === user.username);
    if (!s) return fail(404, "NOT_LINKED", "Your sign-in isn't linked to a staff record. Ask the office to link it.");
    return HttpResponse.json({ staffId: s.id, name: s.name, campus: primaryPosting(s).campus, balances: balancesFor(env, s, CURRENT_SESSION), requests: env.leave.filter((l) => l.staffId === s.id).map((l) => toLeave(env, l)).sort((a, b) => b.from.localeCompare(a.from)), types: env.settings.leaveTypes.filter((t) => t.active) });
  }),

  http.post("/api/hr/leave/mine", async ({ request }) => {
    await latency();
    const user = requireUser();
    if (user instanceof Response) return user;
    const env = liveEnv();
    const s = env.staff.find((x) => x.userName === user.username);
    if (!s) return fail(404, "NOT_LINKED", "Your sign-in isn't linked to a staff record. Ask the office to link it.");
    const b = (await request.json()) as { typeId: string; from: string; to: string; halfDay: boolean; reason: string };
    const campus = primaryPosting(s).campus;
    const v = validateLeave(env, s, { ...b, campus }, CURRENT_SESSION);
    if (v instanceof Response) return v;
    const rec: LeaveRec = { id: newId("lv"), staffId: s.id, campus, session: CURRENT_SESSION, typeId: b.typeId, from: b.from, to: b.to, halfDay: b.halfDay, reason: b.reason.trim(), status: "PENDING", source: "TEACHER_APP", requestedBy: `${s.name} (teacher app)`, requestedAt: demoNow(), decidedBy: null, decidedAt: null, decisionNote: null, history: [audit(`${s.name} (teacher app)`, "Asked for leave")] };
    workStore.set((x) => ({ ...x, leave: [...x.leave, rec] }));
    return HttpResponse.json(toLeave(liveEnv(), rec), { status: 201 });
  }),

  /* ---------------------------------------------------------------- Increments */
  http.get("/api/hr/increments", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("hr.view", ctx.campus);
    if (user instanceof Response) return user;
    if (!canPay(user, ctx.campus)) return fail(403, "FORBIDDEN", "Increments show salaries, which your role can't see.");
    const runs = workStore.get().increments.filter((r) => r.session === ctx.session && (ctx.campus === "ALL" || r.campus === ctx.campus));
    return HttpResponse.json({ runs: runs.map(incSummary).sort((a, b) => b.preparedAt.localeCompare(a.preparedAt)), criteria: settingsStore.get().criteria });
  }),

  http.get("/api/hr/increments/:id", async ({ params }) => {
    await latency();
    const r = workStore.get().increments.find((x) => x.id === params.id);
    if (!r) return fail(404, "NOT_FOUND", "Increment run not found.");
    const user = requireUser();
    if (user instanceof Response) return user;
    if (!canPay(user, r.campus)) return fail(403, "FORBIDDEN", "Increments show salaries, which your role can't see.");
    return HttpResponse.json(toIncRun(r));
  }),

  http.post("/api/hr/increments", async ({ request }) => {
    await latency();
    const b = (await request.json()) as HrIncrementInput;
    const user = requirePermission("payroll.manage", b.campus);
    if (user instanceof Response) return user;
    const ro = readOnly(b.session);
    if (ro) return ro;
    const key = request.headers.get("Idempotency-Key");
    const w = workStore.get();
    if (key && w.idem[key]) {
      const prev = w.increments.find((x) => x.id === w.idem[key]);
      if (prev) return HttpResponse.json(toIncRun(prev));
    }
    if (!b.title?.trim()) return fail(422, "VALIDATION", "Give the run a name, for example “Annual increment 2026–27”.", { field: "title" });
    if (b.method === "PERCENT" && (typeof b.value !== "number" || b.value <= 0 || b.value > 30)) return fail(422, "VALIDATION", "Enter a percentage between 0.5 and 30.", { field: "value" });
    if (b.method === "FIXED" && (!whole(b.value) || b.value < 100 || b.value > 50000)) return fail(422, "VALIDATION", "Enter an amount between Rs 100 and Rs 50,000.", { field: "value" });
    if (!isDate(b.experienceAsOf)) return fail(422, "VALIDATION", "Enter the date service is counted to.", { field: "experienceAsOf" });
    if (!isDate(b.effectiveFrom) || b.effectiveFrom.slice(8) !== "01") return fail(422, "VALIDATION", "New salaries start on the first of a month.", { field: "effectiveFrom" });
    if (b.effectiveFrom < `${THIS_MONTH}-01`) return fail(422, "VALIDATION", "Salary sheets before this month are prepared. Choose this month or later; pay arrears as a bonus.", { field: "effectiveFrom" });
    if (w.increments.some((r) => r.campus === b.campus && r.session === b.session && r.status !== "APPROVED" && r.title.trim().toLowerCase() === b.title.trim().toLowerCase())) return fail(409, "DUPLICATE", "A run with this name is already being prepared. Open it instead.", { field: "title" });
    const filter = { category: b.filter?.category ?? null, designationId: b.filter?.designationId ?? null, payScale: b.filter?.payScale ?? null, teachingLevel: b.filter?.teachingLevel ?? null };
    if (filter.teachingLevel && !TEACHING_LEVELS.includes(filter.teachingLevel)) return fail(422, "VALIDATION", "Choose a level from the list.", { field: "teachingLevel" });
    const env = liveEnv();
    const lines = incrementLines(env, { ...b, filter, value: b.method === "CRITERIA" ? null : b.value });
    if (!lines.length) return fail(422, "NO_STAFF", `Nobody matches these filters at this campus${filter.teachingLevel ? ` (nobody teaches ${filter.teachingLevel} with these choices)` : ""}.`, { field: "filter" });
    const covers = [filter.teachingLevel && `level ${filter.teachingLevel}`, filter.category && HR_CATEGORY_LABEL[filter.category].toLowerCase(), filter.designationId && designation(env.settings, filter.designationId)?.title, filter.payScale && `scale ${filter.payScale}`].filter(Boolean).join(", ");
    const rec: IncRunRec = { id: newId("inc"), campus: b.campus, session: b.session, title: b.title.trim(), method: b.method, value: b.method === "CRITERIA" ? null : b.value, filter, experienceAsOf: b.experienceAsOf, effectiveFrom: b.effectiveFrom, status: "DRAFT", lines, preparedBy: user.name, preparedAt: demoNow(), decidedBy: null, decidedAt: null, decisionNote: null, history: [audit(user.name, "Prepared", `${covers ? `Covers ${covers}. ` : ""}Nothing changes until it is approved`)] };
    workStore.set((x) => ({ ...x, increments: [...x.increments, rec], idem: key ? { ...x.idem, [key]: rec.id } : x.idem }));
    return HttpResponse.json(toIncRun(rec), { status: 201 });
  }),

  http.patch("/api/hr/increments/:id/lines/:staffId", async ({ request, params }) => {
    await latency();
    const r = workStore.get().increments.find((x) => x.id === params.id);
    if (!r) return fail(404, "NOT_FOUND", "Increment run not found.");
    const user = requirePermission("payroll.manage", r.campus);
    if (user instanceof Response) return user;
    if (r.status !== "DRAFT") return fail(409, "NOT_DRAFT", "This run has been sent for approval. Ask the approver to return it to make changes.");
    const b = (await request.json()) as { increments: number; special: number; included: boolean };
    if (!whole(b.increments) || b.increments < 0 || b.increments > 5) return fail(422, "VALIDATION", "Number of increments must be 0 to 5.", { field: "increments" });
    if (!whole(b.special) || b.special < 0 || b.special > 50000) return fail(422, "VALIDATION", "Special increment must be between Rs 0 and Rs 50,000.", { field: "special" });
    const line = r.lines.find((l) => l.staffId === params.staffId);
    if (!line) return fail(404, "NOT_FOUND", "This person isn't in the run.");
    if (b.included && line.note && line.perIncrement === 0 && b.special === 0) return fail(422, "VALIDATION", `${line.name}: ${line.note} Add a special increment to include them.`, { field: "special" });
    const included = b.included && (b.increments > 0 || b.special > 0);
    const increase = included ? line.perIncrement * b.increments + b.special : 0;
    const next: IncRunRec = { ...r, lines: r.lines.map((l) => (l.staffId === line.staffId ? { ...l, increments: b.increments, special: b.special, included, increase, newBasic: l.currentBasic + increase, percent: l.currentBasic ? round1((increase / l.currentBasic) * 100) : 0 } : l)) };
    workStore.set((x) => ({ ...x, increments: x.increments.map((y) => (y.id === r.id ? next : y)) }));
    return HttpResponse.json(toIncRun(next));
  }),

  /** Legacy "# of Increments" and "Special Increment" boxes: the same values for everyone included in the run. */
  http.patch("/api/hr/increments/:id/lines", async ({ request, params }) => {
    await latency();
    const r = workStore.get().increments.find((x) => x.id === params.id);
    if (!r) return fail(404, "NOT_FOUND", "Increment run not found.");
    const user = requirePermission("payroll.manage", r.campus);
    if (user instanceof Response) return user;
    const ro = readOnly(r.session);
    if (ro) return ro;
    if (r.status !== "DRAFT") return fail(409, "NOT_DRAFT", "This run has been sent for approval. Ask the approver to return it to make changes.");
    const b = (await request.json()) as { increments?: number; special?: number };
    if (b.increments === undefined && b.special === undefined) return fail(422, "VALIDATION", "Set the number of increments, the special increment, or both.", { field: "increments" });
    if (b.increments !== undefined && (!whole(b.increments) || b.increments < 1 || b.increments > 5)) return fail(422, "VALIDATION", "Number of increments must be 1 to 5.", { field: "increments" });
    if (b.special !== undefined && (!whole(b.special) || b.special < 0 || b.special > 50000)) return fail(422, "VALIDATION", "Special increment must be between Rs 0 and Rs 50,000.", { field: "special" });
    const included = r.lines.filter((l) => l.included);
    if (!included.length) return fail(422, "NOTHING_TO_CHANGE", "Nobody is included in this run.");
    const lines = r.lines.map((l) => {
      if (!l.included) return l;
      const increments = b.increments ?? l.increments;
      const special = b.special ?? l.special;
      const increase = l.perIncrement * increments + special;
      return { ...l, increments, special, increase, newBasic: l.currentBasic + increase, percent: l.currentBasic ? round1((increase / l.currentBasic) * 100) : 0 };
    });
    const detail = [b.increments !== undefined && `${b.increments} increment${b.increments === 1 ? "" : "s"} each`, b.special !== undefined && `special ${formatRs(b.special)} each`].filter(Boolean).join(", ");
    const next: IncRunRec = { ...r, lines, history: [...r.history, audit(user.name, `Changed for everyone included (${included.length})`, detail)] };
    workStore.set((x) => ({ ...x, increments: x.increments.map((y) => (y.id === r.id ? next : y)) }));
    return HttpResponse.json(toIncRun(next));
  }),

  http.post("/api/hr/increments/:id/submit", async ({ params }) => {
    await latency();
    const r = workStore.get().increments.find((x) => x.id === params.id);
    if (!r) return fail(404, "NOT_FOUND", "Increment run not found.");
    const user = requirePermission("payroll.manage", r.campus);
    if (user instanceof Response) return user;
    if (r.status !== "DRAFT") return fail(409, "NOT_DRAFT", "This run is already with the approver.");
    if (!r.lines.some((l) => l.included)) return fail(422, "NOTHING_TO_SEND", "Nobody is included. Include at least one person.");
    const next: IncRunRec = { ...r, status: "PENDING", history: [...r.history, audit(user.name, "Sent for approval")] };
    workStore.set((x) => ({ ...x, increments: x.increments.map((y) => (y.id === r.id ? next : y)) }));
    return HttpResponse.json(toIncRun(next));
  }),

  http.post("/api/hr/increments/:id/decide", async ({ request, params }) => {
    await latency();
    const r = workStore.get().increments.find((x) => x.id === params.id);
    if (!r) return fail(404, "NOT_FOUND", "Increment run not found.");
    const user = requirePermission("approvals.decide", r.campus);
    if (user instanceof Response) return user;
    if (r.status !== "PENDING") return fail(409, "NOT_PENDING", r.status === "APPROVED" ? `Already approved by ${r.decidedBy}.` : "This run hasn't been sent for approval yet.");
    if (r.preparedBy === user.name) return fail(409, "SAME_PERSON", "You prepared this run, so someone else must approve it.");
    const b = (await request.json()) as { approve: boolean; note: string };
    if (!b.approve && (b.note ?? "").trim().length < 5) return fail(422, "VALIDATION", "Say what needs changing; the accountant sees this.", { field: "note" });
    const next: IncRunRec = { ...r, status: b.approve ? "APPROVED" : "DRAFT", decidedBy: b.approve ? user.name : null, decidedAt: b.approve ? demoNow() : null, decisionNote: b.note?.trim() || null, history: [...r.history, audit(user.name, b.approve ? "Approved" : "Returned for changes", b.note?.trim() || (b.approve ? `New salaries from ${formatDate(r.effectiveFrom)}` : undefined))] };
    workStore.set((x) => ({ ...x, increments: x.increments.map((y) => (y.id === r.id ? next : y)) }));
    if (b.approve) {
      const by = new Map(r.lines.filter((l) => l.included).map((l) => [l.staffId, l]));
      staffStore.set((all) =>
        all.map((s) => {
          const l = by.get(s.id);
          if (!l) return s;
          return { ...s, salary: [...s.salary.filter((x) => x.effectiveFrom !== r.effectiveFrom), { id: newId("sh"), effectiveFrom: r.effectiveFrom, basic: l.newBasic, reason: "INCREMENT" as const, note: r.title, by: user.name }], rowVer: s.rowVer + 1, history: [...s.history, audit(user.name, `${r.title}: ${formatRs(l.increase)} a month`, `Basic ${formatRs(l.currentBasic)} → ${formatRs(l.newBasic)} from ${formatDate(r.effectiveFrom)}`)] };
        }),
      );
    }
    return HttpResponse.json(toIncRun(next));
  }),

  http.delete("/api/hr/increments/:id", async ({ params }) => {
    await latency();
    const r = workStore.get().increments.find((x) => x.id === params.id);
    if (!r) return fail(404, "NOT_FOUND", "Increment run not found.");
    const user = requirePermission("payroll.manage", r.campus);
    if (user instanceof Response) return user;
    if (r.status !== "DRAFT") return fail(409, "NOT_DRAFT", "Only a run that is still being prepared can be deleted.");
    workStore.set((x) => ({ ...x, increments: x.increments.filter((y) => y.id !== r.id) }));
    return HttpResponse.json({ status: "ok" });
  }),

  /* ---------------------------------------------------------------- Payroll */
  http.get("/api/hr/payroll", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("hr.view", ctx.campus);
    if (user instanceof Response) return user;
    if (!canPay(user, ctx.campus)) return fail(403, "FORBIDDEN", "Salary sheets are for the accountant and the principal.");
    const st = settingsStore.get();
    const w = workStore.get();
    const months = hrSessionMonths(ctx.session).filter((m) => m <= THIS_MONTH);
    if (ctx.campus === "ALL") {
      const campuses = st.campuses.map((c) => {
        const runs = w.payroll.filter((r) => r.campus === c.campus).sort((a, b) => b.month.localeCompare(a.month));
        return { campus: c.campus, campusName: campusName(c.campus), runsPayroll: c.runsPayroll, staff: staffStore.get().filter((s) => s.status === "ACTIVE" && primaryPosting(s).campus === c.campus).length, last: runs[0] ? runSummary(runs[0]) : null };
      });
      const out: HrPayrollOverview = { settings: null, months: [], campuses };
      return HttpResponse.json(out);
    }
    const cs = campusSettings(st, ctx.campus);
    const out: HrPayrollOverview = {
      settings: { ...cs, campusName: campusName(cs.campus), schoolAccount: cs.schoolAccount ? { bankName: cs.schoolAccount.bankName, branch: cs.schoolAccount.branch, accountTitle: cs.schoolAccount.accountTitle, accountNoMasked: maskAccount(cs.schoolAccount.accountNo) } : null },
      months: months.map((m) => {
        const r = w.payroll.find((x) => x.campus === ctx.campus && x.month === m);
        return { month: m, run: r ? runSummary(r) : null, canPrepare: !r && cs.runsPayroll && m < THIS_MONTH && ctx.session === CURRENT_SESSION && can(user, "payroll.manage", ctx.campus) };
      }),
    };
    return HttpResponse.json(out);
  }),

  http.get("/api/hr/payroll/runs/:id", async ({ params }) => {
    await latency();
    const r = workStore.get().payroll.find((x) => x.id === params.id);
    if (!r) return fail(404, "NOT_FOUND", "Salary sheet not found.");
    const user = requireUser();
    if (user instanceof Response) return user;
    if (!canPay(user, r.campus)) return fail(403, "FORBIDDEN", "Salary sheets are for the accountant and the principal.");
    return HttpResponse.json(toRun(r));
  }),

  http.post("/api/hr/payroll/runs", async ({ request }) => {
    await latency();
    const b = (await request.json()) as { campus: CampusCode; month: string };
    const user = requirePermission("payroll.manage", b.campus);
    if (user instanceof Response) return user;
    const key = request.headers.get("Idempotency-Key");
    const w = workStore.get();
    if (key && w.idem[key]) {
      const prev = w.payroll.find((x) => x.id === w.idem[key]);
      if (prev) return HttpResponse.json(toRun(prev));
    }
    const cs = campusSettings(settingsStore.get(), b.campus);
    if (!cs.runsPayroll) return fail(409, "PAYROLL_OFF", `${campusName(b.campus)} doesn't prepare salaries in the system. Turn it on in Settings first.`);
    if (!/^\d{4}-\d{2}$/.test(b.month) || b.month >= THIS_MONTH) return fail(422, "VALIDATION", `A month's salary sheet is prepared after the month ends. ${hrMonthLabel(THIS_MONTH)} can be prepared from 1-${hrMonthLabel(nextMonth(THIS_MONTH)).replace(" ", "-")}.`, { field: "month" });
    if (sessionOf(`${b.month}-01`) !== CURRENT_SESSION) return readOnly(sessionOf(`${b.month}-01`))!;
    const existing = w.payroll.find((x) => x.campus === b.campus && x.month === b.month);
    if (existing) return fail(409, "ALREADY_PREPARED", `${hrMonthLabel(b.month)} is already ${existing.status === "PAID" ? "paid" : "prepared"}. Open it instead.`);
    const { lines } = calcLines(liveEnv(), b.campus, b.month, {});
    if (!lines.length) return fail(422, "NO_STAFF", "Nobody at this campus has a salary set for that month.");
    const rec: PayRunRec = { id: `pr-${b.campus.toLowerCase()}-${b.month}`, campus: b.campus, month: b.month, status: "DRAFT", lines, preparedBy: user.name, preparedAt: demoNow(), decidedBy: null, decidedAt: null, decisionNote: null, paidBy: null, paymentDate: null, history: [audit(user.name, "Salary sheet prepared", `${lines.length} staff · from attendance, leave, loans and child fees`)] };
    workStore.set((x) => ({ ...x, payroll: [...x.payroll, rec], idem: key ? { ...x.idem, [key]: rec.id } : x.idem }));
    return HttpResponse.json(toRun(rec), { status: 201 });
  }),

  http.patch("/api/hr/payroll/runs/:id/lines/:staffId", async ({ request, params }) => {
    await latency();
    const r = workStore.get().payroll.find((x) => x.id === params.id);
    if (!r) return fail(404, "NOT_FOUND", "Salary sheet not found.");
    const user = requirePermission("payroll.manage", r.campus);
    if (user instanceof Response) return user;
    if (r.status !== "DRAFT") return fail(409, "NOT_DRAFT", r.status === "PAID" ? "This sheet is paid and can't change. Pay any difference next month as a bonus or deduction." : "This sheet is with the approver. Ask them to return it to make changes.");
    const b = (await request.json()) as HrPayslipInput;
    if (!whole(b.bonus) || b.bonus < 0) return fail(422, "VALIDATION", "Enter the bonus in whole rupees (0 for none).", { field: "bonus" });
    if (!whole(b.fine) || b.fine < 0) return fail(422, "VALIDATION", "Enter the deduction in whole rupees (0 for none).", { field: "fine" });
    if ((b.bonus > 0 || b.fine > 0) && (b.note ?? "").trim().length < 3) return fail(422, "VALIDATION", "Say what the bonus or deduction is for; it prints on the slip.", { field: "note" });
    const s = staffById(String(params.staffId));
    const lines = runLines(r);
    const old = lines.find((l) => l.staffId === params.staffId);
    if (!s || !old) return fail(404, "NOT_FOUND", "This person isn't on the sheet.");
    const slip = calcSlip(liveEnv(), s, r.campus, r.month, { bonus: b.bonus, fine: b.fine, note: b.note?.trim() || null, hold: b.hold });
    if (!slip) return fail(409, "NO_SALARY", "This person has no salary set for the month.");
    if (b.fine > slip.gross) return fail(422, "VALIDATION", "The deduction can't be more than the gross pay.", { field: "fine" });
    const next: PayRunRec = { ...r, lines: lines.map((l) => (l.staffId === s.id ? slip : l)), history: [...r.history, audit(user.name, `${s.name}'s slip changed`, [b.bonus && `bonus ${formatRs(b.bonus)}`, b.fine && `deduction ${formatRs(b.fine)}`, b.hold && "salary held"].filter(Boolean).join(", ") || "Cleared changes")] };
    workStore.set((x) => ({ ...x, payroll: x.payroll.map((y) => (y.id === r.id ? next : y)) }));
    return HttpResponse.json(toRun(next));
  }),

  http.post("/api/hr/payroll/runs/:id/recalculate", async ({ params }) => {
    await latency();
    const r = workStore.get().payroll.find((x) => x.id === params.id);
    if (!r) return fail(404, "NOT_FOUND", "Salary sheet not found.");
    const user = requirePermission("payroll.manage", r.campus);
    if (user instanceof Response) return user;
    if (r.status !== "DRAFT") return fail(409, "NOT_DRAFT", "Only a sheet being prepared can be recalculated.");
    const manual = Object.fromEntries(runLines(r).map((l) => [l.staffId, { bonus: l.bonus, fine: l.fine, note: l.note, hold: l.hold }]));
    const { lines } = calcLines(liveEnv(), r.campus, r.month, manual);
    const next: PayRunRec = { ...r, lines, history: [...r.history, audit(user.name, "Recalculated", "Latest attendance, leave, loans and pay changes picked up; bonuses and deductions kept")] };
    workStore.set((x) => ({ ...x, payroll: x.payroll.map((y) => (y.id === r.id ? next : y)) }));
    return HttpResponse.json(toRun(next));
  }),

  http.post("/api/hr/payroll/runs/:id/submit", async ({ params }) => {
    await latency();
    const r = workStore.get().payroll.find((x) => x.id === params.id);
    if (!r) return fail(404, "NOT_FOUND", "Salary sheet not found.");
    const user = requirePermission("payroll.manage", r.campus);
    if (user instanceof Response) return user;
    if (r.status !== "DRAFT") return fail(409, "NOT_DRAFT", "This sheet is already with the approver.");
    const next: PayRunRec = { ...r, status: "PENDING", history: [...r.history, audit(user.name, "Sent for approval")] };
    workStore.set((x) => ({ ...x, payroll: x.payroll.map((y) => (y.id === r.id ? next : y)) }));
    return HttpResponse.json(toRun(next));
  }),

  http.post("/api/hr/payroll/runs/:id/decide", async ({ request, params }) => {
    await latency();
    const r = workStore.get().payroll.find((x) => x.id === params.id);
    if (!r) return fail(404, "NOT_FOUND", "Salary sheet not found.");
    const user = requirePermission("approvals.decide", r.campus);
    if (user instanceof Response) return user;
    if (r.status !== "PENDING") return fail(409, "NOT_PENDING", r.status === "DRAFT" ? "This sheet hasn't been sent for approval yet." : `Already approved by ${r.decidedBy}.`);
    if (r.preparedBy === user.name) return fail(409, "SAME_PERSON", "You prepared this sheet, so someone else must approve it.");
    const b = (await request.json()) as { approve: boolean; note: string };
    if (!b.approve && (b.note ?? "").trim().length < 5) return fail(422, "VALIDATION", "Say what needs checking; the accountant sees this.", { field: "note" });
    const next: PayRunRec = { ...r, status: b.approve ? "APPROVED" : "DRAFT", decidedBy: b.approve ? user.name : null, decidedAt: b.approve ? demoNow() : null, decisionNote: b.note?.trim() || null, history: [...r.history, audit(user.name, b.approve ? "Approved" : "Returned for changes", b.note?.trim() || undefined)] };
    workStore.set((x) => ({ ...x, payroll: x.payroll.map((y) => (y.id === r.id ? next : y)) }));
    return HttpResponse.json(toRun(next));
  }),

  http.post("/api/hr/payroll/runs/:id/pay", async ({ request, params }) => {
    await latency();
    const w = workStore.get();
    const r = w.payroll.find((x) => x.id === params.id);
    if (!r) return fail(404, "NOT_FOUND", "Salary sheet not found.");
    const user = requirePermission("payroll.manage", r.campus);
    if (user instanceof Response) return user;
    const key = request.headers.get("Idempotency-Key");
    if (r.status === "PAID") return key && w.idem[key] === r.id ? HttpResponse.json(toRun(r)) : fail(409, "ALREADY_PAID", `Already marked as paid on ${formatDate(r.paymentDate ?? TODAY)}.`);
    if (r.status !== "APPROVED") return fail(409, "NOT_APPROVED", "The sheet must be approved before salaries are paid.");
    const b = (await request.json()) as { paymentDate: string };
    if (!isDate(b.paymentDate) || b.paymentDate < `${nextMonth(r.month)}-01` || b.paymentDate > addDays(TODAY, 30)) return fail(422, "VALIDATION", `The payment date must be in ${hrMonthLabel(nextMonth(r.month))} or later, and not more than a month ahead.`, { field: "paymentDate" });
    const lines = runLines(r).filter((l) => !l.hold);
    const label = `Salary sheet ${hrMonthLabel(r.month)}`;
    const loans = w.loans.map((l) => {
      const amount = sum(lines.flatMap((x) => x.deductions.filter((d) => d.code === `LOAN:${l.id}`).map((d) => d.amount)));
      if (!amount) return l;
      const recoveries = [...l.recoveries, { id: newId("r"), month: r.month, date: b.paymentDate, amount, source: "PAYROLL" as const, reference: label }];
      const closed = sum(recoveries.map((x) => x.amount)) >= l.principal;
      return { ...l, recoveries, status: closed ? ("CLOSED" as const) : l.status, history: closed ? [...l.history, audit("System", "Fully paid back; loan closed", label)] : l.history };
    });
    const childFee = lines.flatMap((l) => l.deductions.filter((d) => d.code.startsWith("CHILD:")).map((d) => ({ runId: r.id, staffId: l.staffId, grNo: d.code.slice(6), name: d.note?.split(" (")[0] ?? "", month: r.month, amount: d.amount })));
    const next: PayRunRec = { ...r, status: "PAID", paidBy: user.name, paymentDate: b.paymentDate, history: [...r.history, audit(user.name, "Marked as paid", `${formatDate(b.paymentDate)} · ${formatRs(payTotals(runLines(r)).net)}${childFee.length ? ` · ${childFee.length} child fee${childFee.length === 1 ? "" : "s"} sent to the fee office` : ""}`)] };
    workStore.set((x) => ({ ...x, loans, payroll: x.payroll.map((y) => (y.id === r.id ? next : y)), childFee: [...x.childFee, ...childFee], idem: key ? { ...x.idem, [key]: r.id } : x.idem }));
    return HttpResponse.json(toRun(next));
  }),

  /** Pays one held salary after the sheet was paid: its loan installments and child fee are recorded as /pay does. */
  http.post("/api/hr/payroll/runs/:id/lines/:staffId/release", async ({ request, params }) => {
    await latency();
    const w = workStore.get();
    const r = w.payroll.find((x) => x.id === params.id);
    if (!r) return fail(404, "NOT_FOUND", "Salary sheet not found.");
    const user = requirePermission("payroll.manage", r.campus);
    if (user instanceof Response) return user;
    const key = request.headers.get("Idempotency-Key");
    const idemKey = key ? `release:${key}` : null;
    if (idemKey && w.idem[idemKey] === `${r.id}|${params.staffId}`) return HttpResponse.json(toRun(r));
    if (sessionOf(`${r.month}-01`) !== CURRENT_SESSION) return readOnly(sessionOf(`${r.month}-01`))!;
    if (r.status !== "PAID") return fail(409, "NOT_PAID", "Held salaries are paid after the sheet itself is marked as paid. Until then, untick “Hold” on the slip.");
    const lines = runLines(r);
    const line = lines.find((l) => l.staffId === params.staffId);
    if (!line) return fail(404, "NOT_FOUND", "This person isn't on the sheet.");
    if (!line.hold) return fail(409, "NOT_HELD", `${line.name}'s salary was paid with the sheet on ${formatDate(r.paymentDate ?? TODAY)}.`);
    if (line.paidOn) return fail(409, "ALREADY_PAID", `${line.name}'s held salary was already paid on ${formatDate(line.paidOn)}.`);
    const b = (await request.json()) as { paymentDate: string };
    const earliest = r.paymentDate ?? `${nextMonth(r.month)}-01`;
    if (!isDate(b.paymentDate) || b.paymentDate < earliest || b.paymentDate > addDays(TODAY, 30)) return fail(422, "VALIDATION", `The payment date must be on or after ${formatDate(earliest)} (when the sheet was paid), and not more than a month ahead.`, { field: "paymentDate" });
    const label = `Held salary ${hrMonthLabel(r.month)}`;
    const loans = w.loans.map((l) => {
      const amount = sum(line.deductions.filter((d) => d.code === `LOAN:${l.id}`).map((d) => d.amount));
      if (!amount) return l;
      const recoveries = [...l.recoveries, { id: newId("r"), month: r.month, date: b.paymentDate, amount, source: "PAYROLL" as const, reference: label }];
      const closed = sum(recoveries.map((x) => x.amount)) >= l.principal;
      return { ...l, recoveries, status: closed ? ("CLOSED" as const) : l.status, history: closed ? [...l.history, audit("System", "Fully paid back; loan closed", label)] : l.history };
    });
    const childFee = line.deductions.filter((d) => d.code.startsWith("CHILD:")).map((d) => ({ runId: r.id, staffId: line.staffId, grNo: d.code.slice(6), name: d.note?.split(" (")[0] ?? "", month: r.month, amount: d.amount }));
    const paidLine: HrPayslip = { ...line, paidOn: b.paymentDate, flags: [...line.flags.filter((f) => !f.startsWith("Salary held")), `Held, then paid on ${formatDate(b.paymentDate)}.`] };
    const next: PayRunRec = {
      ...r,
      lines: lines.map((l) => (l.staffId === line.staffId ? paidLine : l)),
      history: [...r.history, audit(user.name, `${line.name}'s held salary paid`, `${formatDate(b.paymentDate)} · ${formatRs(line.net)} · ${line.paymentMethod === "BANK" ? "bank transfer" : line.paymentMethod.toLowerCase()}${childFee.length ? " · child fee sent to the fee office" : ""}`)],
    };
    workStore.set((x) => ({ ...x, loans, payroll: x.payroll.map((y) => (y.id === r.id ? next : y)), childFee: [...x.childFee, ...childFee], idem: idemKey ? { ...x.idem, [idemKey]: `${r.id}|${line.staffId}` } : x.idem }));
    return HttpResponse.json(toRun(next));
  }),

  http.get("/api/hr/payroll/runs/:id/bank-list", async ({ params }) => {
    await latency();
    const r = workStore.get().payroll.find((x) => x.id === params.id);
    if (!r) return fail(404, "NOT_FOUND", "Salary sheet not found.");
    const user = requirePermission("payroll.manage", r.campus);
    if (user instanceof Response) return user;
    if (r.status !== "APPROVED" && r.status !== "PAID") return fail(409, "NOT_APPROVED", "The bank list is ready once the sheet is approved.");
    const staff = (r.lines ? staffStore.get() : pristineEnv().staff).concat(staffStore.get());
    const cs = campusSettings(settingsStore.get(), r.campus);
    const lines = runLines(r);
    const rows = lines
      .filter((l) => !l.hold && l.paymentMethod === "BANK")
      .map((l) => {
        const s = staff.find((x) => x.id === l.staffId)!;
        return { staffId: l.staffId, name: l.name, employeeNo: l.employeeNo, bankName: s.pay.bank?.bankName ?? "", branch: s.pay.bank?.branch ?? "", accountTitle: s.pay.bank?.accountTitle ?? "", accountNo: s.pay.bank?.accountNo ?? "", amount: l.net };
      })
      .sort((a, b) => a.bankName.localeCompare(b.bankName) || a.name.localeCompare(b.name));
    return HttpResponse.json({
      runId: r.id,
      month: r.month,
      campus: r.campus,
      campusName: campusName(r.campus),
      paymentDate: r.paymentDate,
      schoolAccount: cs.schoolAccount,
      rows,
      total: sum(rows.map((x) => x.amount)),
      others: lines.filter((l) => l.hold || l.paymentMethod !== "BANK").map((l) => ({ staffId: l.staffId, name: l.name, employeeNo: l.employeeNo, method: l.hold && !l.paidOn ? ("HELD" as const) : l.paymentMethod, amount: l.net })),
    });
  }),

  http.get("/api/hr/payroll/structures", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("hr.view", ctx.campus);
    if (user instanceof Response) return user;
    if (!canPay(user, ctx.campus)) return fail(403, "FORBIDDEN", "Salary structures are for the accountant and the principal.");
    const env = liveEnv();
    const rows: HrSalaryStructureRow[] = env.staff
      .filter((s) => s.status === "ACTIVE" && (ctx.campus === "ALL" || primaryPosting(s).campus === ctx.campus))
      .map((s) => {
        const p = primaryPosting(s);
        const basic = basicOn(s, TODAY);
        const { allowances, deductions } = standingPay(s, p, basic, env.settings.payDefaults);
        const al = sum(allowances.map((a) => a.amount));
        const de = sum(deductions.map((d) => d.amount));
        const sorted = [...s.salary].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
        const next = sorted.find((x) => x.effectiveFrom > TODAY);
        return {
          staffId: s.id,
          name: s.name,
          employeeNo: s.employeeNo,
          designation: designation(env.settings, p.designationId)?.title ?? "",
          category: categoryOf(env.settings, s, p),
          payScale: p.payScale,
          basic,
          allowances: al,
          standingDeductions: de,
          gross: basic + al,
          net: basic + al - de,
          paymentMethod: s.pay.paymentMethod,
          bankName: s.pay.bank?.bankName ?? null,
          lastChange: sorted.filter((x) => x.effectiveFrom <= TODAY).at(-1)?.effectiveFrom ?? joiningDate(s),
          pendingChange: next ? { effectiveFrom: next.effectiveFrom, basic: next.basic } : null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return HttpResponse.json(rows);
  }),

  /* ---------------------------------------------------------------- Loans */
  http.get("/api/hr/loans", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("hr.view", ctx.campus);
    if (user instanceof Response) return user;
    if (!canPay(user, ctx.campus)) return fail(403, "FORBIDDEN", "Loans and advances are for the accountant and the principal.");
    const env = liveEnv();
    const loans = env.loans.filter((l) => ctx.campus === "ALL" || l.campus === ctx.campus).map((l) => toLoan(env, l));
    const out: HrLoanData = {
      loans: loans.sort((a, b) => Number(b.status === "PENDING") - Number(a.status === "PENDING") || Number(b.status === "ACTIVE") - Number(a.status === "ACTIVE") || b.requestedAt.localeCompare(a.requestedAt)),
      types: env.settings.loanTypes,
      summary: {
        outstanding: sum(loans.filter((l) => l.status === "ACTIVE").map((l) => l.balance)),
        active: loans.filter((l) => l.status === "ACTIVE").length,
        pending: loans.filter((l) => l.status === "PENDING").length,
        recoveredThisSession: sum(loans.flatMap((l) => l.recoveries.filter((x) => x.date >= SESSION_START(ctx.session) && x.date <= SESSION_END(ctx.session)).map((x) => x.amount))),
        nextDeduction: sum(loans.filter((l) => l.status === "ACTIVE").map((l) => l.schedule.find((x) => x.status !== "RECOVERED")?.amount ?? 0)),
      },
    };
    return HttpResponse.json(out);
  }),

  http.post("/api/hr/loans", async ({ request }) => {
    await latency();
    const b = (await request.json()) as HrLoanInput;
    const user = requirePermission("payroll.manage", b.campus);
    if (user instanceof Response) return user;
    const key = request.headers.get("Idempotency-Key");
    const w = workStore.get();
    if (key && w.idem[key]) {
      const prev = w.loans.find((x) => x.id === w.idem[key]);
      if (prev) return HttpResponse.json(toLoan(liveEnv(), prev));
    }
    const env = liveEnv();
    const s = env.staff.find((x) => x.id === b.staffId);
    if (!s || s.status !== "ACTIVE" || primaryPosting(s).campus !== b.campus) return fail(422, "VALIDATION", "Choose a staff member paid by this campus.", { field: "staffId" });
    const t = env.settings.loanTypes.find((x) => x.id === b.typeId && x.active);
    if (!t) return fail(422, "VALIDATION", "Choose the kind of loan.", { field: "typeId" });
    const basic = basicOn(s, TODAY);
    if (!basic) return fail(422, "VALIDATION", `${s.name} has no salary set, so nothing can be deducted.`, { field: "staffId" });
    const max = Math.floor(basic * t.maxTimesBasic);
    if (!whole(b.amount) || b.amount < 1000) return fail(422, "VALIDATION", "Enter the amount in whole rupees (at least Rs 1,000).", { field: "amount" });
    if (b.amount > max) return fail(422, "OVER_LIMIT", `A ${t.name.toLowerCase()} can be up to ${t.maxTimesBasic === 0.5 ? "half a month's" : `${t.maxTimesBasic} months'`} basic pay: ${formatRs(max)} for ${s.name}.`, { field: "amount" });
    if (!whole(b.installments) || b.installments < 1 || b.installments > t.maxInstallments) return fail(422, "VALIDATION", `${t.name}: 1 to ${t.maxInstallments} installment${t.maxInstallments === 1 ? "" : "s"}.`, { field: "installments" });
    if (!/^\d{4}-\d{2}$/.test(b.firstMonth) || b.firstMonth < THIS_MONTH) return fail(422, "VALIDATION", `The first deduction can be from ${hrMonthLabel(THIS_MONTH)}'s salary or later.`, { field: "firstMonth" });
    const installment = Math.ceil(b.amount / b.installments);
    const { net } = (() => {
      const p = primaryPosting(s);
      const sp = standingPay(s, p, basic, env.settings.payDefaults);
      const gross = basic + sum(sp.allowances.map((a) => a.amount));
      return { net: gross - sum(sp.deductions.map((d) => d.amount)) };
    })();
    const running = env.loans.filter((l) => l.staffId === s.id && (l.status === "ACTIVE" || l.status === "PENDING"));
    if (t.kind === "LOAN" && running.some((l) => env.settings.loanTypes.find((x) => x.id === l.typeId)?.kind === "LOAN")) return fail(409, "LOAN_RUNNING", `${s.name} already has a loan running or waiting. Finish it first, or take a salary advance.`, { field: "staffId" });
    const otherInstallments = sum(running.map((l) => l.installment));
    if (installment + otherInstallments > Math.round(net * 0.4)) return fail(422, "TOO_HIGH", `Installments would take more than 40% of take-home pay (${formatRs(net)}). Spread it over more months.`, { field: "installments" });
    const n = Math.max(0, ...w.loans.filter((l) => l.campus === b.campus).map((l) => Number(l.loanNo.slice(-4)))) + 1;
    const rec: LoanRec = { id: newId("ln"), loanNo: `LN-${b.campus}-${pad(n, 4)}`, staffId: s.id, campus: b.campus, typeId: t.id, principal: b.amount, installment, installments: b.installments, firstMonth: b.firstMonth, status: "PENDING", reason: (b.reason ?? "").trim(), requestedBy: user.name, requestedAt: demoNow(), decidedBy: null, decidedAt: null, decisionNote: null, recoveries: [], history: [audit(user.name, "Loan requested", `${formatRs(b.amount)} in ${b.installments} × ${formatRs(installment)} from ${hrMonthLabel(b.firstMonth)}`)] };
    if (rec.reason.length < 5) return fail(422, "VALIDATION", "Say what the loan is for; the principal reads this.", { field: "reason" });
    workStore.set((x) => ({ ...x, loans: [...x.loans, rec], idem: key ? { ...x.idem, [key]: rec.id } : x.idem }));
    return HttpResponse.json(toLoan(liveEnv(), rec), { status: 201 });
  }),

  http.post("/api/hr/loans/:id/decide", async ({ request, params }) => {
    await latency();
    const l = workStore.get().loans.find((x) => x.id === params.id);
    if (!l) return fail(404, "NOT_FOUND", "Loan not found.");
    const user = requirePermission("approvals.decide", l.campus);
    if (user instanceof Response) return user;
    if (l.status !== "PENDING") return fail(409, "ALREADY_DECIDED", `This loan was already ${l.status === "REJECTED" ? "rejected" : "approved"} by ${l.decidedBy}.`);
    if (l.requestedBy === user.name) return fail(409, "SAME_PERSON", "You entered this request, so someone else must approve it.");
    const b = (await request.json()) as { approve: boolean; note: string };
    if (!b.approve && (b.note ?? "").trim().length < 5) return fail(422, "VALIDATION", "Say why it's rejected.", { field: "note" });
    const next: LoanRec = { ...l, status: b.approve ? "ACTIVE" : "REJECTED", decidedBy: user.name, decidedAt: demoNow(), decisionNote: b.note?.trim() || null, history: [...l.history, audit(user.name, b.approve ? "Approved" : "Rejected", b.note?.trim() || (b.approve ? `Deductions start with ${hrMonthLabel(l.firstMonth)}'s salary` : undefined))] };
    workStore.set((x) => ({ ...x, loans: x.loans.map((y) => (y.id === l.id ? next : y)) }));
    return HttpResponse.json(toLoan(liveEnv(), next));
  }),

  http.post("/api/hr/loans/:id/repay", async ({ request, params }) => {
    await latency();
    const w = workStore.get();
    const l = w.loans.find((x) => x.id === params.id);
    if (!l) return fail(404, "NOT_FOUND", "Loan not found.");
    const user = requirePermission("payroll.manage", l.campus);
    if (user instanceof Response) return user;
    const key = request.headers.get("Idempotency-Key");
    if (key && w.idem[key] === l.id) return HttpResponse.json(toLoan(liveEnv(), l));
    if (l.status !== "ACTIVE") return fail(409, "NOT_ACTIVE", "Only a running loan can be paid back.");
    const b = (await request.json()) as { amount: number; date: string; note: string };
    const env = liveEnv();
    const bal = loanSummary(env, l).balance;
    if (!whole(b.amount) || b.amount < 1) return fail(422, "VALIDATION", "Enter the amount received in whole rupees.", { field: "amount" });
    if (b.amount > bal) return fail(422, "VALIDATION", `Only ${formatRs(bal)} is left on this loan.`, { field: "amount" });
    if (!isDate(b.date) || b.date > TODAY) return fail(422, "VALIDATION", "Enter the date the money was received (today or earlier).", { field: "date" });
    const recoveries = [...l.recoveries, { id: newId("r"), month: b.date.slice(0, 7), date: b.date, amount: b.amount, source: "CASH" as const, reference: b.note?.trim() || "Paid in cash at the office" }];
    const closed = sum(recoveries.map((x) => x.amount)) >= l.principal;
    const next: LoanRec = { ...l, recoveries, status: closed ? "CLOSED" : "ACTIVE", history: [...l.history, audit(user.name, `${formatRs(b.amount)} paid back in cash`, closed ? "Loan closed" : `${formatRs(bal - b.amount)} left`)] };
    workStore.set((x) => ({ ...x, loans: x.loans.map((y) => (y.id === l.id ? next : y)), idem: key ? { ...x.idem, [key]: l.id } : x.idem }));
    return HttpResponse.json(toLoan(liveEnv(), next));
  }),

  /* ---------------------------------------------------------------- Reports */
  http.get("/api/hr/reports/strength", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("hr.view", ctx.campus);
    if (user instanceof Response) return user;
    const env = liveEnv();
    const campuses: CampusCode[] = ctx.campus === "ALL" ? ["KC", "SM", "UC", "MC", "HC"] : [ctx.campus];
    const rows = new Map<string, HrStrengthReport["rows"][number]>();
    const people = new Set<string>();
    for (const s of env.staff.filter((x) => x.status === "ACTIVE")) {
      for (const p of s.postings.filter((x) => campuses.includes(x.campus) && postingActiveOn(x, TODAY))) {
        const d = designation(env.settings, p.designationId);
        const row = rows.get(p.designationId) ?? { designationId: p.designationId, designation: d?.title ?? "", category: d?.category ?? "TEACHING", byCampus: {}, total: 0, female: 0, male: 0 };
        row.byCampus[p.campus] = (row.byCampus[p.campus] ?? 0) + 1;
        row.total++;
        if (s.gender === "F") row.female++;
        else row.male++;
        rows.set(p.designationId, row);
        people.add(s.id);
      }
    }
    const list = [...rows.values()].sort((a, b) => env.settings.designations.findIndex((d) => d.id === a.designationId) - env.settings.designations.findIndex((d) => d.id === b.designationId));
    const byCampus: Partial<Record<CampusCode, number>> = {};
    for (const r of list) for (const [c, n] of Object.entries(r.byCampus)) byCampus[c as CampusCode] = (byCampus[c as CampusCode] ?? 0) + (n ?? 0);
    const cats: HrCategory[] = ["TEACHING", "MANAGEMENT", "HIFZ", "VISITING", "NON_TEACHING"];
    const out: HrStrengthReport = {
      campuses,
      rows: list,
      totals: { byCampus, total: sum(list.map((r) => r.total)), people: people.size, female: sum(list.map((r) => r.female)), male: sum(list.map((r) => r.male)) },
      byCategory: cats.map((category) => ({ category, count: sum(list.filter((r) => r.category === category).map((r) => r.total)) })).filter((x) => x.count > 0),
    };
    return HttpResponse.json(out);
  }),

  http.get("/api/hr/reports/experience", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("hr.view", ctx.campus);
    if (user instanceof Response) return user;
    const url = new URL(request.url);
    const asOf = url.searchParams.get("asOf") || TODAY;
    const level = url.searchParams.get("level") || null;
    const gender = url.searchParams.get("gender") || null;
    if (!isDate(asOf)) return fail(422, "VALIDATION", "Enter the date service is counted to.", { field: "asOf" });
    if (asOf < "2000-01-01" || asOf > addDays(TODAY, 2 * 366)) return fail(422, "VALIDATION", "Count service to a date within the next two years.", { field: "asOf" });
    if (level && !TEACHING_LEVELS.includes(level)) return fail(422, "VALIDATION", "Choose a level from the list.", { field: "level" });
    if (gender && gender !== "F" && gender !== "M") return fail(422, "VALIDATION", "Choose women or men.", { field: "gender" });
    const env = liveEnv();
    const showPay = canPay(user, ctx.campus);
    const rows: HrExperienceReport["rows"] = env.staff
      // Working on the as-of date (a later joiner has no service to count yet).
      .filter((s) => s.status === "ACTIVE" && (ctx.campus === "ALL" || activeAt(s, ctx.campus)) && joiningDate(s) <= asOf)
      .filter((s) => (!level || s.teachingLevels.includes(level)) && (!gender || s.gender === gender))
      .map((s) => {
        const p = postingFor(s, ctx.campus);
        const mtb = Math.max(0, round1(yearsBetween(joiningDate(s), asOf)));
        const total = round1(mtb + s.priorServiceYears);
        const row: HrExperienceReport["rows"][number] = { staffId: s.id, name: s.name, employeeNo: s.employeeNo, designation: designation(env.settings, p.designationId)?.title ?? "", payScale: p.payScale, joiningDate: joiningDate(s), mtbYears: mtb, priorYears: s.priorServiceYears, totalYears: total };
        if (showPay) {
          const basic = basicOn(s, asOf < TODAY ? asOf : TODAY);
          const due = p.payScale && p.payScale !== "0" && total >= 1 ? criteriaAmount(env.settings.criteria, p.payScale, total) : 0;
          Object.assign(row, { basic, incrementDue: due, newBasic: basic + due });
        }
        return row;
      })
      .sort((a, b) => b.totalYears - a.totalYears);
    const bands: Array<[string, number, number]> = [
      ["Under 1 year", 0, 1],
      ["1–3 years", 1, 3],
      ["3–6 years", 3, 6],
      ["6–10 years", 6, 10],
      ["10–15 years", 10, 15],
      ["15 years and more", 15, 99],
    ];
    const out: HrExperienceReport = { asOf, rows, bands: bands.map(([label, a, b]) => ({ label, count: rows.filter((r) => r.totalYears >= a && r.totalYears < b).length })) };
    return HttpResponse.json(out);
  }),

  /** Net salary paid per person per month, from approved and paid salary sheets (legacy staff-wise salary payment report). */
  http.get("/api/hr/reports/salary-history", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requirePermission("hr.view", ctx.campus);
    if (user instanceof Response) return user;
    if (!canPay(user, ctx.campus)) return fail(403, "FORBIDDEN", "Salary history is for the accountant and the principal.");
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";
    const designationId = url.searchParams.get("designationId") || null;
    const staffId = url.searchParams.get("staffId") || null;
    if (!/^\d{4}-\d{2}$/.test(from)) return fail(422, "VALIDATION", "Choose the first month.", { field: "from" });
    if (!/^\d{4}-\d{2}$/.test(to)) return fail(422, "VALIDATION", "Choose the last month.", { field: "to" });
    if (to < from) return fail(422, "VALIDATION", "The last month can't be before the first month.", { field: "to" });
    const months: string[] = [];
    for (let m = from; m <= to && months.length < 25; m = nextMonth(m)) months.push(m);
    if (months.length > 24) return fail(422, "VALIDATION", "Choose 24 months or fewer.", { field: "from" });
    const st = settingsStore.get();
    const runs = workStore.get().payroll.filter((r) => (ctx.campus === "ALL" || r.campus === ctx.campus) && (r.status === "APPROVED" || r.status === "PAID") && r.month >= from && r.month <= to);
    const rows = new Map<string, HrSalaryHistory["rows"][number]>();
    for (const r of runs) {
      for (const l of runLines(r)) {
        // A held salary counts once it is paid.
        if (l.hold && !l.paidOn) continue;
        if (staffId && l.staffId !== staffId) continue;
        const desId = l.designationId || st.designations.find((d) => d.title === l.designation)?.id || "";
        if (designationId && desId !== designationId) continue;
        const row = rows.get(l.staffId) ?? { staffId: l.staffId, name: l.name, employeeNo: l.employeeNo, designationId: desId, designation: l.designation, byMonth: {}, total: 0 };
        row.byMonth[r.month] = (row.byMonth[r.month] ?? 0) + l.net;
        row.total += l.net;
        rows.set(l.staffId, row);
      }
    }
    const list = [...rows.values()].sort((a, b) => a.name.replace(/^(Mr|Ms|Mrs|Dr|Qari)\s+/, "").localeCompare(b.name.replace(/^(Mr|Ms|Mrs|Dr|Qari)\s+/, "")));
    const byMonth: Partial<Record<string, number>> = {};
    for (const m of months) byMonth[m] = sum(list.map((x) => x.byMonth[m] ?? 0));
    const covered = new Set(runs.map((r) => r.month));
    const out: HrSalaryHistory = { months, rows: list, totals: { byMonth, total: sum(list.map((x) => x.total)) }, missing: months.filter((m) => !covered.has(m)) };
    return HttpResponse.json(out);
  }),

  /* ---------------------------------------------------------------- Settings */
  http.get("/api/hr/settings", async () => {
    await latency();
    const user = requireUser();
    if (user instanceof Response) return user;
    if (!["KC", "SM", "UC", "MC", "HC", "ALL"].some((c) => can(user, "hr.view", c as CampusScope))) return fail(403, "FORBIDDEN", "Your role can't open staff settings.");
    return HttpResponse.json(await fetchSettings());
  }),

  http.put("/api/hr/settings/:section", async ({ request, params }) => {
    await latency();
    const section = String(params.section) as HrSettingsSection;
    const b = (await request.json()) as { value: unknown; rowVer: number };
    const st = settingsStore.get();
    const payrollSection = section === "criteria" || section === "payDefaults" || section === "loanTypes" || section === "campus";
    const campus = section === "campus" ? ((b.value as { campus?: CampusCode })?.campus ?? "ALL") : "ALL";
    const user = requirePermission(payrollSection ? "payroll.manage" : "hr.manage", campus);
    if (user instanceof Response) return user;
    if (b.rowVer !== st.rowVer) return fail(409, "CONCURRENCY", `${st.updatedBy} changed the settings while you were editing. Reload and make your change again.`, { details: { changedBy: st.updatedBy, changedAt: st.updatedAt } });
    const next: SettingsState = { ...st, rowVer: st.rowVer + 1, updatedBy: user.name, updatedAt: demoNow() };
    const dupTitle = (xs: Array<{ title?: string; name?: string }>) => {
      const seen = new Set<string>();
      for (const x of xs) {
        const t = (x.title ?? x.name ?? "").trim().toLowerCase();
        if (!t) return "Every row needs a name.";
        if (seen.has(t)) return `“${x.title ?? x.name}” is listed twice.`;
        seen.add(t);
      }
      return null;
    };
    if (section === "designations") {
      const v = b.value as SettingsState["designations"];
      const e = dupTitle(v);
      if (e) return fail(422, "VALIDATION", e, { field: "designations" });
      next.designations = v.map((d) => ({ id: d.id || newId("d"), title: d.title.trim(), category: d.category, active: d.active }));
    } else if (section === "departments") {
      const v = b.value as SettingsState["departments"];
      const e = dupTitle(v);
      if (e) return fail(422, "VALIDATION", e, { field: "departments" });
      next.departments = v.map((d) => ({ id: d.id || newId("dp"), title: d.title.trim(), active: d.active }));
    } else if (section === "leaveTypes") {
      const v = b.value as HrLeaveType[];
      const e = dupTitle(v);
      if (e) return fail(422, "VALIDATION", e, { field: "leaveTypes" });
      for (const t of v) if (t.daysPerYear !== null && (!whole(t.daysPerYear) || t.daysPerYear < 0 || t.daysPerYear > 365)) return fail(422, "VALIDATION", `${t.name}: days a year must be 0 to 365, or empty for no limit.`, { field: "leaveTypes" });
      next.leaveTypes = v.map((t) => ({ ...t, id: t.id || newId("lt"), code: t.code || t.name.toUpperCase().replace(/[^A-Z]+/g, "_") }));
    } else if (section === "loanTypes") {
      const v = b.value as HrLoanType[];
      const e = dupTitle(v);
      if (e) return fail(422, "VALIDATION", e, { field: "loanTypes" });
      for (const t of v) {
        if (!(t.maxTimesBasic > 0 && t.maxTimesBasic <= 12)) return fail(422, "VALIDATION", `${t.name}: the limit must be between 0.5 and 12 months' basic pay.`, { field: "loanTypes" });
        if (!whole(t.maxInstallments) || t.maxInstallments < 1 || t.maxInstallments > 36) return fail(422, "VALIDATION", `${t.name}: installments must be 1 to 36.`, { field: "loanTypes" });
      }
      next.loanTypes = v.map((t) => ({ ...t, id: t.id || newId("ln") }));
    } else if (section === "criteria") {
      const v = b.value as HrIncrementCriteria[];
      for (const c of v) {
        if (!PAY_SCALES.includes(c.payScale)) return fail(422, "VALIDATION", "Each band needs a pay scale from the list.", { field: "criteria" });
        if (!(c.fromYears >= 0 && c.toYears > c.fromYears)) return fail(422, "VALIDATION", `Scale ${c.payScale}: “to” must be more than “from”.`, { field: "criteria" });
        if (!whole(c.amount) || c.amount < 0) return fail(422, "VALIDATION", `Scale ${c.payScale}: the amount must be whole rupees.`, { field: "criteria" });
      }
      for (const scale of PAY_SCALES) {
        const bands = v.filter((c) => c.payScale === scale && c.active).sort((a, b2) => a.fromYears - b2.fromYears);
        for (let i = 1; i < bands.length; i++) if (bands[i]!.fromYears < bands[i - 1]!.toYears) return fail(422, "OVERLAP", `Scale ${scale}: the bands ${bands[i - 1]!.fromYears}–${bands[i - 1]!.toYears} and ${bands[i]!.fromYears}–${bands[i]!.toYears} years overlap. Each year of service must fall in one band only.`, { field: "criteria" });
      }
      next.criteria = v.map((c) => ({ ...c, id: c.id || newId("ic") }));
    } else if (section === "payDefaults") {
      const v = b.value as HrPayDefaults;
      if (!(v.houseRentPct >= 0 && v.houseRentPct <= 100) || !(v.providentFundPct >= 0 && v.providentFundPct <= 20)) return fail(422, "VALIDATION", "Check the percentages: house rent 0–100%, provident fund 0–20%.", { field: "payDefaults" });
      if (![v.conveyance, v.medical, v.eobi].every((x) => whole(x) && x >= 0)) return fail(422, "VALIDATION", "Amounts must be whole rupees.", { field: "payDefaults" });
      next.payDefaults = v;
    } else if (section === "campus") {
      const v = b.value as Omit<HrCampusSettings, "schoolAccount" | "campusName">;
      const cur = campusSettings(st, v.campus);
      if (!cur) return fail(404, "NOT_FOUND", "Campus not found.");
      if (!isTime(v.dayStarts)) return fail(422, "VALIDATION", "Enter the time the day starts as hh:mm.", { field: "dayStarts" });
      if (!whole(v.graceMinutes) || v.graceMinutes < 0 || v.graceMinutes > 60) return fail(422, "VALIDATION", "Grace minutes must be 0 to 60.", { field: "graceMinutes" });
      if (!whole(v.daysDivisor) || v.daysDivisor < 20 || v.daysDivisor > 31) return fail(422, "VALIDATION", "Days in a pay month must be 20 to 31 (the old system used 26).", { field: "daysDivisor" });
      if (!whole(v.salaryDay) || v.salaryDay < 1 || v.salaryDay > 15) return fail(422, "VALIDATION", "Salaries are paid between the 1st and the 15th.", { field: "salaryDay" });
      if (v.lateRule && (!whole(v.lateRule.lates) || v.lateRule.lates < 1 || !(v.lateRule.days > 0 && v.lateRule.days <= 1))) return fail(422, "VALIDATION", "Late rule: at least 1 late arrival, up to one day's pay.", { field: "lateRule" });
      if (v.attendanceDevice && !v.deviceName?.trim()) return fail(422, "VALIDATION", "Name the fingerprint machine (make and where it is).", { field: "deviceName" });
      const w = workStore.get();
      if (!v.runsPayroll && cur.runsPayroll && w.payroll.some((r) => r.campus === v.campus && (r.status === "PENDING" || r.status === "APPROVED"))) return fail(409, "PAYROLL_IN_PROGRESS", "A salary sheet is waiting for approval or payment. Finish it before turning payroll off.", { field: "runsPayroll" });
      next.campuses = st.campuses.map((c) => (c.campus === v.campus ? { ...c, runsPayroll: v.runsPayroll, attendanceDevice: v.attendanceDevice, deviceName: v.attendanceDevice ? (v.deviceName?.trim() ?? null) : null, dayStarts: v.dayStarts, graceMinutes: v.graceMinutes, daysDivisor: v.daysDivisor, lateRule: v.lateRule, salaryDay: v.salaryDay } : c));
    } else return fail(404, "NOT_FOUND", "Unknown settings section.");
    settingsStore.set(next);
    const res = await fetchSettings();
    return HttpResponse.json(res);
  }),
];

/** The settings response after a save (same shape as GET /hr/settings). */
async function fetchSettings(): Promise<HrSettings> {
  const st = settingsStore.get();
  const staff = staffStore.get().filter((s) => s.status === "ACTIVE");
  return {
    designations: st.designations.map((d) => ({ ...d, staff: staff.filter((s) => s.postings.some((p) => p.designationId === d.id && !p.endDate)).length })),
    departments: st.departments.map((d) => ({ ...d, staff: staff.filter((s) => s.postings.some((p) => p.departmentId === d.id && !p.endDate)).length })),
    leaveTypes: st.leaveTypes,
    loanTypes: st.loanTypes,
    criteria: st.criteria,
    payDefaults: st.payDefaults,
    campuses: st.campuses.map((c) => ({ ...c, campusName: campusName(c.campus), schoolAccount: c.schoolAccount ? { bankName: c.schoolAccount.bankName, branch: c.schoolAccount.branch, accountTitle: c.schoolAccount.accountTitle, accountNoMasked: maskAccount(c.schoolAccount.accountNo) } : null })),
    payScales: PAY_SCALES,
    teachingLevels: TEACHING_LEVELS,
    subjects: initialSubjects().filter((x) => x.active).map((x) => ({ id: x.id, name: x.name })),
    banks: BANKS,
    rowVer: st.rowVer,
    updatedBy: st.updatedBy,
    updatedAt: st.updatedAt,
  };
}

/** Child fees taken from salaries, for the fee office to post as receipts (exposed for the fees feature). */
export function hrChildFeeAdjustments() {
  return workStore.get().childFee;
}

/** Today's staff attendance at one campus, for the dashboard. present counts everyone who came in (late and half day too). */
export function hrStaffToday(campus: CampusCode): { total: number; present: number; late: number; onLeave: number; notMarked: number } {
  const s = buildDay(campus, TODAY).summary;
  return { total: s.total, present: s.present + s.late + s.halfDay, late: s.late, onLeave: s.leave, notMarked: s.notMarked };
}

/** A staff record by employee number, for linking sign-in accounts to staff (Setup → Users). */
export function hrStaffByNo(employeeNo: string): { id: string; name: string; designation: string; campus: CampusCode; campusName: string; left: boolean } | null {
  const no = employeeNo.trim().toUpperCase();
  if (!no) return null;
  const env = liveEnv();
  const s = env.staff.find((x) => x.employeeNo.toUpperCase() === no);
  if (!s) return null;
  const p = primaryPosting(s);
  return { id: s.id, name: s.name, designation: designation(env.settings, p.designationId)?.title ?? "", campus: p.campus, campusName: campusName(p.campus), left: s.status === "LEFT" };
}

void HR_CATEGORY_LABEL;
