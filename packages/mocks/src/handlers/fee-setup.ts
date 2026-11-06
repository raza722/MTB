// Fee office mock server: structure, plans and due dates, concessions, bank vouchers, fine rules and waivers,
// student fines, defaulters and reminders, candidate fees and the fee reports.
// Charges live in the fees store (fees-state.ts): generating vouchers, charging fines, approving waivers and
// concessions all change real charges, so the fee counter, the ledger and the dashboard see the same figures.
import {
  can,
  ENROLMENT_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  type CampusCode,
  type CampusScope,
  type Charge,
  type FeeAuditEntry,
  type FeeBankDetails,
  type FeeCandidate,
  type FeeCandidateLine,
  type FeeCandidatePayRequest,
  type FeeCandidatesData,
  type FeeCashClosing,
  type FeeCashClosingInput,
  type FeeClassArrears,
  type FeeClassArrearsRow,
  type FeeClassStructureInput,
  type FeeCollectionGroup,
  type FeeCollectionLine,
  type FeeCollectionReport,
  type FeeCollectionRow,
  type FeeConcession,
  type FeeConcessionInput,
  type FeeConcessionsData,
  type FeeConcessionStatus,
  type FeeConcessionSuggestion,
  type FeeConcessionSummary,
  type FeeConcessionType,
  type FeeCopyPreview,
  type FeeCopyRequest,
  type FeeDefaulter,
  type FeeDefaultersData,
  type FeeDueDateInput,
  type FeeHead,
  type FeeHeadInput,
  type FeeSectionOverride,
  type FeeFineRule,
  type FeeFineRuleInput,
  type FeeFinesData,
  type FeeFineScope,
  type FeeInstallmentPlan,
  type FeeMonthlyReport,
  type FeeOverview,
  type FeeReminderRequest,
  type FeeStructure,
  type FeeStructureComparison,
  type FeeStudentFine,
  type FeeStudentFineInput,
  type FeeStudentOption,
  type FeeVoucher,
  type FeeVoucherLine,
  type FeeVoucherList,
  type FeeVoucherPreview,
  type FeeVoucherRequest,
  type FeeVoucherRun,
  type FeeVoucherStatus,
  type FeeWaiver,
  type FeeWaiverInput,
  type Permission,
  type Receipt,
  type SessionUser,
} from "@mtb/api";
import { FEE_BILLING_LABEL, FEE_STUDENT_FINE_LABEL, splitRupees } from "@mtb/api";
import { calculateLateFine, daysBetween, formatDate, formatReceiptNo, formatRs, formatSession, type IsoDate, type IsoDateTime, type LateFinePolicy } from "@mtb/domain";
import { http, type HttpHandler } from "msw";
import { CURRENT_SESSION, DEMO_TODAY, demoNow } from "../clock";
import { createStore } from "../db";
import { campusName, campusOf, CLASSES } from "../fixtures/campuses";
import {
  addDays,
  amountsFor,
  boardDueDate,
  CANDIDATE_HEAD_AMOUNTS,
  CASHIERS,
  CLASS_SHORTS,
  classNameOf,
  CONCESSION_TYPES,
  dayFigure,
  defaultIncomeAccount,
  FEE_HEADS,
  figuresFor,
  FINE_DEFAULTS,
  isSchoolDay,
  monthEnd,
  monthFigure,
  monthShort,
  monthTarget,
  plansFor,
  RECEIPT_SEQ_AT_START,
  roundTo,
  sessionMonths,
  STRUCTURE_HEADS,
  syntheticRows,
  TRANSPORT_RANGE,
  weekday,
} from "../fixtures/fee-setup";
import { initialCampusSettings, SETTING_DEFS } from "../fixtures/setup";
import { findStudent, STUDENTS, type StudentRecord } from "../fixtures/students";
import { ctxFrom, fail, HttpResponse, latency, requireUser } from "../util";
import { admissionsStore } from "./admissions-model";
import { chargesOf, feesStore, receiptsOf } from "./fees-state";
import { liveTemplate, queueBatch, smsStatusStore } from "./sms";

const ALL_CAMPUSES: CampusCode[] = ["KC", "SM", "UC", "MC", "HC"];
const campusesIn = (scope: CampusScope): CampusCode[] => (scope === "ALL" ? ALL_CAMPUSES : [scope]);
const live = (s: StudentRecord) => !s.mergedInto;
const classOf = (cs: string) => cs.split("-")[0] ?? cs;
const sKey = (campus: CampusCode, session: number) => `${campus}:${session}`;
const SESSION_START = (session: number): IsoDate => `${session}-04-01`;
const SESSION_END = (session: number): IsoDate => `${session + 1}-03-31`;

/* ================================================================== State */

interface ClassRecord {
  lines: Record<string, number>;
  /** Heads kept on record but not billed this session. */
  inactive?: string[];
  /** Annual / one-off heads split into parts (1, 2, 4 or 12). */
  installments?: Record<string, number>;
  /** Different amounts for one section. */
  sections?: FeeSectionOverride[];
  updatedAt: IsoDateTime;
  updatedBy: string;
}

interface StructureRecord {
  classes: Record<string, ClassRecord>;
  rowVer: number;
}

interface ConcessionRecord {
  id: string;
  campus: CampusCode;
  session: number;
  grNo: string;
  type: FeeConcessionType;
  pct: number;
  heads: string[];
  validFrom: IsoDate;
  validTo: IsoDate;
  reference?: string;
  reason: string;
  status: FeeConcessionStatus;
  requestedBy: string;
  requestedAt: IsoDateTime;
  decidedBy?: string;
  decidedAt?: IsoDateTime;
  decisionNote?: string;
  history: FeeAuditEntry[];
}

interface VoucherRecord {
  voucherNo: string;
  runId: string;
  campus: CampusCode;
  session: number;
  month: string;
  grNo: string;
  issueDate: IsoDate;
  dueDate: IsoDate;
  validUntil: IsoDate;
  lines: FeeVoucherLine[];
  printCount: number;
  cancelled?: { reason: string; by: string; at: IsoDateTime };
}

interface RunRecord {
  id: string;
  campus: CampusCode;
  session: number;
  month: string;
  scope: string;
  dueDate: IsoDate;
  generatedBy: string;
  generatedAt: IsoDateTime;
  voucherNos: string[];
}

interface RuleCore {
  ratePerDay: number;
  graceDays: number;
  maxFine: number | null;
  appliesTo: FeeFineScope;
  effectiveFrom: IsoDate;
  updatedBy: string;
  updatedAt: IsoDateTime;
}

interface RuleRecord extends RuleCore {
  upcoming?: RuleCore;
  history: FeeAuditEntry[];
}

interface FeeSetupState {
  /** The fee head list (one for every campus). Missing in a tab started before heads could be edited. */
  heads?: FeeHead[];
  /** History of changes to the head list. */
  headHistory?: FeeAuditEntry[];
  structures: Record<string, StructureRecord>;
  plans: Record<string, FeeInstallmentPlan[]>;
  history: Record<string, FeeAuditEntry[]>;
  concessions: ConcessionRecord[];
  /** Charges re-priced by a concession: the amount before it. */
  repriced: Record<string, { gross: number; concessionId: string }>;
  vouchers: Record<string, VoucherRecord>;
  runs: RunRecord[];
  voucherSeq: Partial<Record<CampusCode, number>>;
  rules: Record<CampusCode, RuleRecord>;
  waivers: FeeWaiver[];
  fines: FeeStudentFine[];
  reminders: Record<string, { at: IsoDateTime; count: number }>;
  closings: FeeCashClosing[];
  seq: number;
  idem: Record<string, string>;
}

/* ================================================================== Small helpers */

function requireAny(perms: Permission[], campus: CampusScope): SessionUser | Response {
  const user = requireUser();
  if (user instanceof Response) return user;
  if (!perms.some((p) => can(user, p, campus))) return fail(403, "FORBIDDEN", "Your role can't do this at this campus.");
  return user;
}

function readOnly(session: number): Response | null {
  return session !== CURRENT_SESSION ? fail(409, "SESSION_READ_ONLY", `${formatSession(session)} is closed and read-only. Switch to ${formatSession(CURRENT_SESSION)} to make changes.`) : null;
}

function singleCampus(campus: CampusScope): Response | null {
  return campus === "ALL" ? fail(422, "CHOOSE_CAMPUS", "Choose one campus first. This action always belongs to one campus.") : null;
}

const audit = (at: IsoDateTime, by: string, text: string, detail?: string): FeeAuditEntry => ({ id: `a-${at}-${text.length}-${by.length}`, at, by, text, ...(detail ? { detail } : {}) });

/** The fee head list, in order (one list for every campus). */
export function feeHeads(): FeeHead[] {
  const saved = feeSetupStore.get().heads;
  const list = saved ?? FEE_HEADS;
  return [...list].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

export const feeHeadByCode = (code: string): FeeHead | undefined => feeHeads().find((h) => h.code === code);

/** Which structure head a charge belongs to, from its label. */
export function headCodeOf(head: string): string {
  if (head.startsWith("Tuition fee")) return "TUITION";
  if (head.startsWith("Annual charges")) return "ANNUAL";
  if (head.startsWith("Exam fee")) return "EXAM";
  if (head.startsWith("Board registration")) return "BOARD";
  if (head.startsWith("Transport fee")) return "TRANSPORT";
  if (head.startsWith("Admission fee")) return "ADMISSION";
  // Heads added by the office: the label starts with the head's title (longest title first).
  const own = feeHeads()
    .filter((h) => h.category !== "FINE")
    .sort((a, b) => b.title.length - a.title.length)
    .find((h) => head.startsWith(h.title));
  if (own) return own.code;
  if (head.includes("fine")) return "FINE";
  return "OTHER";
}

/** For Accounts → Fee posting: heads added by the office, each with the income account it posts to by default. */
export function feeHeadsForPosting(core: string[]): Array<{ head: string; title: string; category: FeeHead["category"]; accountCode: string }> {
  return feeHeads()
    .filter((h) => !core.includes(h.code) && h.code !== "FINE_EXAM" && !h.linked)
    .map((h) => ({ head: h.code, title: h.title, category: h.category, accountCode: defaultIncomeAccount(h) }));
}

const HEAD_GROUP_LABEL: Record<string, string> = {
  TUITION: "Tuition fee",
  ANNUAL: "Annual charges",
  EXAM: "Exam fee",
  BOARD: "Board registration fee",
  TRANSPORT: "Transport fee",
  ADMISSION: "Admission fee",
  FINE: "Student fines",
  LATE_FINE: "Late fines",
  OTHER: "Other",
};

const groupLabel = (k: string) => HEAD_GROUP_LABEL[k] ?? feeHeadByCode(k)?.title ?? k;

/** The same rounding every time: concession = gross × % ÷ 100, to the nearest rupee. */
export const concessionOff = (gross: number, pct: number) => Math.round((gross * pct) / 100);

const typeInfo = (t: FeeConcessionType) => CONCESSION_TYPES.find((x) => x.code === t)!;

/**
 * A campus setting (the campus's own value, else the default), from the fictional fixtures. Setup → Campus settings is
 * served by the real backend now; this mock keeps the fixture values until Fee setup is built.
 */
export function campusSetting(campus: CampusCode, key: string): string {
  const own: Record<string, string> = initialCampusSettings()[campus] ?? {};
  return own[key] ?? SETTING_DEFS.find((d) => d.key === key)?.defaultValue ?? "";
}

/** Notes printed at the foot of every receipt (Setup → Campus settings → Receipts), then the footer. */
export function receiptNotesFor(campus: CampusCode): string[] {
  const notes = campusSetting(campus, "receipt.policyNotes")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
  const footer = campusSetting(campus, "receipt.footer").trim();
  // The footer often repeats the first note ("Fee once paid is not refundable…"): print it once.
  const repeats = notes.some((n) => footer.toLowerCase().startsWith(n.toLowerCase().replace(/[.\s]+$/, "")));
  return footer && !repeats ? [...notes, footer] : notes;
}

/** Bank details from the campus settings fixtures (Setup → Campus settings lives on the real backend now). */
function bankFor(campus: CampusCode): FeeBankDetails {
  const own: Record<string, string> = initialCampusSettings()[campus] ?? {};
  const val = (key: string) => own[key] ?? SETTING_DEFS.find((d) => d.key === key)?.defaultValue ?? "";
  const copies = Math.min(3, Math.max(1, Number(val("voucher.copies")) || 3));
  const labels = val("voucher.copyLabels")
    .split("·")
    .map((x) => x.trim())
    .filter(Boolean);
  const title = val("voucher.title");
  return {
    title: !title || title === "MTB" ? `MTB ${campusName(campus)}` : title,
    bankName: val("voucher.bankName"),
    accountTitle: val("voucher.accountTitle"),
    accountNo: val("voucher.accountNo"),
    copyLabels: Array.from({ length: copies }, (_, i) => labels[i] ?? `Copy ${i + 1}`),
  };
}

/* ================================================================== Initial data */

function structureFor(session: number, at: IsoDateTime, by: string): StructureRecord {
  const classes: Record<string, ClassRecord> = {};
  for (const cls of CLASS_SHORTS) {
    const a = amountsFor(session, cls);
    classes[cls] = { lines: Object.fromEntries(STRUCTURE_HEADS.map((h) => [h, a[h] ?? 0])), updatedAt: at, updatedBy: by };
  }
  return { classes, rowVer: 1 };
}

const KC_NAMED = new Set(["KC-14823", "KC-15102", "KC-14650", "KC-14911", "KC-14377", "KC-15230", "KC-14502", "KC-14988", "KC-14215", "KC-14108", "KC-13981", "KC-14598"]);

/** Generated classmates at a campus (not the brief's named cast), in G.R. order. */
function generatedAt(campus: CampusCode): StudentRecord[] {
  return STUDENTS.filter((s) => live(s) && s.campus === campus && s.status === "ACTIVE" && !KC_NAMED.has(s.grNo)).sort((a, b) => a.grNo.localeCompare(b.grNo));
}

/** Date a charge was paid (the first receipt that covered it), if it was paid. */
function paidOn(grNo: string, chargeId: string): IsoDate | null {
  const r = receiptsOf(grNo)
    .filter((x) => x.status !== "CANCELLED" && x.lines.some((l) => l.chargeId === chargeId))
    .sort((a, b) => a.postedAt.localeCompare(b.postedAt))[0];
  return r ? r.postedAt.slice(0, 10) : null;
}

/** The October and November runs that were printed before the demo starts. */
function fixtureRun(campus: CampusCode, month: string, issueDate: IsoDate, dueDate: IsoDate, by: string, at: IsoDateTime, seqStart: number, id: string): { run: RunRecord; vouchers: VoucherRecord[]; next: number } {
  const prefix = campusOf(campus).docPrefix;
  const vouchers: VoucherRecord[] = [];
  let n = seqStart;
  const monthStart = `${month}-01`;
  const students = STUDENTS.filter((s) => live(s) && s.campus === campus && s.status === "ACTIVE").sort((a, b) => a.classSection.localeCompare(b.classSection, "en", { numeric: true }) || a.name.localeCompare(b.name));
  for (const s of students) {
    const lines: FeeVoucherLine[] = chargesOf(s.grNo)
      .filter((c) => c.status !== "CANCELLED" && c.dueDate <= dueDate)
      .filter((c) => {
        if (c.status === "OPEN") return true;
        const paid = paidOn(s.grNo, c.id);
        return paid !== null && paid >= issueDate;
      })
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .map((c) => ({ chargeId: c.id, head: c.head, dueDate: c.dueDate, amount: c.amount, arrears: c.dueDate < monthStart }));
    if (lines.length === 0) continue;
    n += 1;
    vouchers.push({ voucherNo: `${prefix}-FV-2627-${String(n).padStart(6, "0")}`, runId: id, campus, session: 2026, month, grNo: s.grNo, issueDate, dueDate, validUntil: monthEnd(month), lines, printCount: 1 });
  }
  return { run: { id, campus, session: 2026, month, scope: "Whole campus", dueDate, generatedBy: by, generatedAt: at, voucherNos: vouchers.map((v) => v.voucherNo) }, vouchers, next: n };
}

function initialRules(): Record<CampusCode, RuleRecord> {
  const base = (campus: CampusCode): RuleRecord => ({
    ratePerDay: 10,
    graceDays: 0,
    maxFine: null,
    appliesTo: "ALL",
    effectiveFrom: "2026-04-01",
    updatedBy: "Kamran Yousaf",
    updatedAt: "2026-03-25T10:15:00+05:00",
    history: [audit("2026-03-25T10:15:00+05:00", "Kamran Yousaf", `Rule for ${formatSession(2026)} at ${campusName(campus)}: Rs 10 a day after the due date, on every fee head`, "No grace days, no maximum")],
  });
  const rules = { KC: base("KC"), SM: base("SM"), UC: base("UC"), MC: base("MC"), HC: base("HC") };
  rules.HC = {
    ...rules.HC,
    upcoming: { ratePerDay: 10, graceDays: 5, maxFine: null, appliesTo: "ALL", effectiveFrom: "2026-12-01", updatedBy: "Kamran Yousaf", updatedAt: "2026-10-29T15:40:00+05:00" },
    history: [...rules.HC.history, audit("2026-10-29T15:40:00+05:00", "Kamran Yousaf", "Change saved: 5 grace days from 01-Dec-2026", "Requested by the Humaira Campus principal for parents paid by salary on the 10th")],
  };
  return rules;
}

function initialState(): FeeSetupState {
  const structures: Record<string, StructureRecord> = {};
  const plans: Record<string, FeeInstallmentPlan[]> = {};
  const history: Record<string, FeeAuditEntry[]> = {};
  for (const c of ALL_CAMPUSES) {
    structures[sKey(c, 2025)] = structureFor(2025, "2025-03-18T10:00:00+05:00", "Nadia Shah");
    plans[sKey(c, 2025)] = plansFor(2025);
    plans[sKey(c, 2026)] = plansFor(2026);
    history[sKey(c, 2025)] = [audit("2025-03-18T10:00:00+05:00", "Nadia Shah", `Fee structure for ${formatSession(2025)} entered`)];
    // Majeed Campus hasn't entered 2026–27 yet: the page offers "Copy from 2025–26".
    if (c !== "MC") {
      structures[sKey(c, 2026)] = structureFor(2026, "2026-03-20T11:00:00+05:00", "Nadia Shah");
      history[sKey(c, 2026)] = [
        audit("2026-03-20T11:00:00+05:00", "Nadia Shah", `Copied from ${formatSession(2025)} with a 6% increase, rounded to Rs 500`, "Every class"),
        audit("2026-03-22T09:40:00+05:00", "Nadia Shah", "Board registration fee set for Class 9 and 10", "Rs 2,200 → Rs 2,500"),
        audit("2026-08-30T12:05:00+05:00", "Kamran Yousaf", "Annual charges confirmed for every class", "Rs 3,000"),
      ];
    } else {
      history[sKey(c, 2026)] = [];
    }
  }

  // Concessions. Most start in December so this month's counter figures stay as they are.
  const gen = generatedAt("KC");
  const staffChild = gen[2];
  const concessions: ConcessionRecord[] = [
    {
      id: "con-1",
      campus: "KC",
      session: 2026,
      grNo: "KC-14988",
      type: "SIBLING",
      pct: 10,
      heads: ["TUITION"],
      validFrom: "2026-11-01",
      validTo: "2027-03-31",
      reason: "Second child at MTB: her elder brother studies at Ubaid Campus. Checked by the office against the father's CNIC.",
      status: "APPROVED",
      requestedBy: "Usman Ali",
      requestedAt: "2026-10-30T11:05:00+05:00",
      decidedBy: "Mrs Sadia Rehman",
      decidedAt: "2026-11-02T12:40:00+05:00",
      decisionNote: "Approved from November.",
      history: [audit("2026-10-30T11:05:00+05:00", "Usman Ali", "Requested: sibling 10% on tuition from 01-Nov-2026"), audit("2026-11-02T12:40:00+05:00", "Mrs Sadia Rehman", "Approved", "Approved from November.")],
    },
    {
      id: "con-2",
      campus: "KC",
      session: 2026,
      grNo: "KC-15230",
      type: "SCHOLARSHIP",
      pct: 25,
      heads: ["TUITION"],
      validFrom: "2026-12-01",
      validTo: "2027-03-31",
      reference: "SCH-2627-014",
      reason: "Merit scholarship: first in Class 6 in the First Term exams.",
      status: "APPROVED",
      requestedBy: "Nadia Shah",
      requestedAt: "2026-10-24T10:20:00+05:00",
      decidedBy: "Mrs Sadia Rehman",
      decidedAt: "2026-10-28T13:15:00+05:00",
      decisionNote: "Scholarship committee minutes of 22-Oct are on file.",
      history: [audit("2026-10-24T10:20:00+05:00", "Nadia Shah", "Requested: scholarship 25% on tuition from 01-Dec-2026", "Award SCH-2627-014"), audit("2026-10-28T13:15:00+05:00", "Mrs Sadia Rehman", "Approved", "Scholarship committee minutes of 22-Oct are on file.")],
    },
    {
      id: "con-3",
      campus: "KC",
      session: 2026,
      grNo: "KC-14650",
      type: "HARDSHIP",
      pct: 50,
      heads: ["TUITION"],
      validFrom: "2026-11-01",
      validTo: "2027-03-31",
      reason: "Father's shop was closed for two months after the market fire; the family asked for help until March.",
      status: "PENDING",
      requestedBy: "Usman Ali",
      requestedAt: "2026-11-03T14:10:00+05:00",
      history: [audit("2026-11-03T14:10:00+05:00", "Usman Ali", "Requested: hardship 50% on tuition from 01-Nov-2026")],
    },
    {
      id: "con-4",
      campus: "KC",
      session: 2026,
      grNo: "KC-15102",
      type: "SIBLING",
      pct: 10,
      heads: ["TUITION"],
      validFrom: "2026-12-01",
      validTo: "2027-03-31",
      reason: "Younger brother of Ayesha Khan (7-B); the system found the family by the father's CNIC.",
      status: "PENDING",
      requestedBy: "Usman Ali",
      requestedAt: "2026-11-04T09:30:00+05:00",
      history: [audit("2026-11-04T09:30:00+05:00", "Usman Ali", "Requested: sibling 10% on tuition from 01-Dec-2026")],
    },
    {
      id: "con-5",
      campus: "KC",
      session: 2026,
      grNo: "KC-14377",
      type: "SPECIAL",
      pct: 30,
      heads: ["TUITION"],
      validFrom: "2026-11-01",
      validTo: "2027-03-31",
      reason: "Father asked for a reduction; two months of fees are overdue.",
      status: "REJECTED",
      requestedBy: "Usman Ali",
      requestedAt: "2026-10-15T12:00:00+05:00",
      decidedBy: "Mrs Sadia Rehman",
      decidedAt: "2026-10-20T11:30:00+05:00",
      decisionNote: "Clear the overdue fees first, then apply again with the father's letter.",
      history: [audit("2026-10-15T12:00:00+05:00", "Usman Ali", "Requested: special approval 30% on tuition from 01-Nov-2026"), audit("2026-10-20T11:30:00+05:00", "Mrs Sadia Rehman", "Rejected", "Clear the overdue fees first, then apply again with the father's letter.")],
    },
  ];
  if (staffChild) {
    concessions.push({
      id: "con-6",
      campus: "KC",
      session: 2026,
      grNo: staffChild.grNo,
      type: "STAFF_CHILD",
      pct: 50,
      heads: ["TUITION"],
      validFrom: "2026-12-01",
      validTo: "2027-03-31",
      reference: "KC-ST-0142",
      reason: "Mother joined Khalid Campus as a junior-school teacher on 01-Nov-2026.",
      status: "APPROVED",
      requestedBy: "Nadia Shah",
      requestedAt: "2026-11-02T09:10:00+05:00",
      decidedBy: "Mrs Sadia Rehman",
      decidedAt: "2026-11-02T15:00:00+05:00",
      history: [audit("2026-11-02T09:10:00+05:00", "Nadia Shah", "Requested: staff child 50% on tuition from 01-Dec-2026", "Staff number KC-ST-0142"), audit("2026-11-02T15:00:00+05:00", "Mrs Sadia Rehman", "Approved")],
    });
  }

  // Voucher runs: Khalid Campus started bulk vouchers in October; the other campuses joined in November.
  const vouchers: Record<string, VoucherRecord> = {};
  const runs: RunRecord[] = [];
  const voucherSeq: Partial<Record<CampusCode, number>> = {};
  const add = (r: ReturnType<typeof fixtureRun>, campus: CampusCode) => {
    runs.push(r.run);
    for (const v of r.vouchers) vouchers[v.voucherNo] = v;
    voucherSeq[campus] = r.next;
  };
  const oct = fixtureRun("KC", "2026-10", "2026-09-26", "2026-10-10", "Usman Ali", "2026-09-26T12:30:00+05:00", 0, "run-kc-2026-10");
  add(oct, "KC");
  add(fixtureRun("KC", "2026-11", "2026-10-27", "2026-11-10", "Usman Ali", "2026-10-27T11:45:00+05:00", oct.next, "run-kc-2026-11"), "KC");
  add(fixtureRun("SM", "2026-11", "2026-10-28", "2026-11-10", "Asma Rauf", "2026-10-28T10:05:00+05:00", 0, "run-sm-2026-11"), "SM");
  add(fixtureRun("UC", "2026-11", "2026-10-28", "2026-11-10", "Tariq Javed", "2026-10-28T12:20:00+05:00", 0, "run-uc-2026-11"), "UC");
  add(fixtureRun("HC", "2026-11", "2026-10-27", "2026-11-10", "Saima Qureshi", "2026-10-27T09:50:00+05:00", 0, "run-hc-2026-11"), "HC");

  // Waiver and due-date requests.
  const overdueGen = gen.filter((s) => s.feeStatus === "overdue");
  const charge = (grNo: string, id: string) => chargesOf(grNo).find((c) => c.id === `${grNo}:${id}`);
  const waivers: FeeWaiver[] = [];
  const ali = charge("KC-14377", "oct");
  if (ali) {
    waivers.push({
      id: "wv-1",
      campus: "KC",
      grNo: "KC-14377",
      studentName: "Ali Raza",
      classSection: "8-C",
      chargeId: ali.id,
      chargeHead: ali.head,
      chargeAmount: ali.amount,
      dueDate: ali.dueDate,
      kind: "WAIVE",
      fineToDate: calculateLateFine(ali.dueDate, DEMO_TODAY).fine,
      amount: calculateLateFine(ali.dueDate, DEMO_TODAY).fine,
      reason: "Father was in hospital for most of October; the discharge slip was seen at the counter.",
      status: "PENDING",
      requestedBy: "Usman Ali",
      requestedAt: "2026-11-04T08:40:00+05:00",
    });
  }
  const bilal = charge("KC-14650", "nov");
  if (bilal) {
    waivers.push({
      id: "wv-2",
      campus: "KC",
      grNo: "KC-14650",
      studentName: "Muhammad Bilal",
      classSection: "7-B",
      chargeId: bilal.id,
      chargeHead: bilal.head,
      chargeAmount: bilal.amount,
      dueDate: bilal.dueDate,
      kind: "EXTEND",
      fineToDate: 0,
      newDueDate: "2026-11-25",
      reason: "Family asked for time until the 25th, when the father's wages are paid.",
      status: "PENDING",
      requestedBy: "Usman Ali",
      requestedAt: "2026-11-03T14:15:00+05:00",
    });
  }
  const approvedFor = overdueGen[0];
  const approvedCharge = approvedFor ? charge(approvedFor.grNo, "oct") : undefined;
  const shifted: Record<string, IsoDate> = {};
  if (approvedFor && approvedCharge) {
    waivers.push({
      id: "wv-3",
      campus: "KC",
      grNo: approvedFor.grNo,
      studentName: approvedFor.name,
      classSection: approvedFor.classSection,
      chargeId: approvedCharge.id,
      chargeHead: approvedCharge.head,
      chargeAmount: approvedCharge.amount,
      dueDate: approvedCharge.dueDate,
      kind: "WAIVE",
      fineToDate: 110,
      amount: 100,
      reason: "Bank deposit made on 12-Oct but the slip reached the office late.",
      status: "APPROVED",
      requestedBy: "Usman Ali",
      requestedAt: "2026-10-21T10:00:00+05:00",
      decidedBy: "Mrs Sadia Rehman",
      decidedAt: "2026-10-21T13:20:00+05:00",
      decisionNote: "Approved; slip checked.",
    });
    shifted[approvedCharge.id] = addDays(approvedCharge.dueDate, 10);
  }
  const rejectedFor = overdueGen[1];
  const rejectedCharge = rejectedFor ? charge(rejectedFor.grNo, "oct") : undefined;
  if (rejectedFor && rejectedCharge) {
    waivers.push({
      id: "wv-4",
      campus: "KC",
      grNo: rejectedFor.grNo,
      studentName: rejectedFor.name,
      classSection: rejectedFor.classSection,
      chargeId: rejectedCharge.id,
      chargeHead: rejectedCharge.head,
      chargeAmount: rejectedCharge.amount,
      dueDate: rejectedCharge.dueDate,
      kind: "WAIVE",
      fineToDate: 170,
      amount: 170,
      reason: "Father asked for the whole fine to be dropped.",
      status: "REJECTED",
      requestedBy: "Usman Ali",
      requestedAt: "2026-10-27T09:30:00+05:00",
      decidedBy: "Mrs Sadia Rehman",
      decidedAt: "2026-10-27T12:10:00+05:00",
      decisionNote: "The family was reminded twice in October; the fine stands.",
    });
  }
  // The approved waiver already moved its charge's fine start.
  if (Object.keys(shifted).length) {
    feesStore.set((st) => {
      const chargesByStudent = { ...st.charges };
      for (const [id, due] of Object.entries(shifted)) {
        const gr = id.split(":")[0]!;
        chargesByStudent[gr] = (chargesByStudent[gr] ?? []).map((c) => (c.id === id ? { ...c, dueDate: due } : c));
      }
      return { ...st, charges: chargesByStudent };
    });
  }

  // Student fines: exam absences from the First Term waiting to be charged, one breakage, history.
  const fines: FeeStudentFine[] = [];
  const subjects = ["Mathematics", "English", "Science", "Urdu", "Islamiat"];
  gen.slice(5, 10).forEach((s, i) =>
    fines.push({
      id: `fn-${i + 1}`,
      campus: "KC",
      grNo: s.grNo,
      studentName: s.name,
      classSection: s.classSection,
      kind: "EXAM_ABSENCE",
      reason: `First Term · ${subjects[i % subjects.length]} paper, absent without leave`,
      amount: 300,
      raisedBy: "Exams office",
      raisedAt: `2026-10-${String(20 + i).padStart(2, "0")}T14:00:00+05:00`,
      status: "PENDING",
    }),
  );
  fines.push({
    id: "fn-6",
    campus: "KC",
    grNo: "KC-14377",
    studentName: "Ali Raza",
    classSection: "8-C",
    kind: "BREAKAGE",
    reason: "Broke a window pane in the science lab on 29-Oct",
    amount: 1500,
    raisedBy: "Mr Adeel Anwar",
    raisedAt: "2026-10-29T12:30:00+05:00",
    status: "PENDING",
  });
  const waivedFor = gen[11];
  if (waivedFor) {
    fines.push({
      id: "fn-7",
      campus: "KC",
      grNo: waivedFor.grNo,
      studentName: waivedFor.name,
      classSection: waivedFor.classSection,
      kind: "EXAM_ABSENCE",
      reason: "First Term · Science paper, absent without leave",
      amount: 300,
      raisedBy: "Exams office",
      raisedAt: "2026-10-22T14:00:00+05:00",
      status: "WAIVED",
      note: "Medical certificate submitted on 24-Oct.",
    });
  }

  return {
    heads: FEE_HEADS.map((h) => ({ ...h, rowVer: 1 })),
    headHistory: [audit("2026-03-18T09:30:00+05:00", "Nadia Shah", "Fee head list set up for every campus", `${FEE_HEADS.length} heads`)],
    structures,
    plans,
    history,
    concessions,
    repriced: {},
    vouchers,
    runs,
    voucherSeq,
    rules: initialRules(),
    waivers,
    fines,
    reminders: { "KC-14823": { at: "2026-10-20T16:00:00+05:00", count: 1 } },
    closings: [
      { id: "cl-1", campus: "KC", date: "2026-11-03", cashier: "Usman Ali", expected: 512500, counted: 512500, difference: 0, closedAt: "2026-11-03T14:05:00+05:00" },
      { id: "cl-2", campus: "KC", date: "2026-11-03", cashier: "Rizwan Haider", expected: 214000, counted: 213500, difference: -500, note: "Rs 500 short; counter 2 gave change twice to one parent. Recovered next morning.", closedAt: "2026-11-03T14:12:00+05:00" },
    ],
    seq: 100,
    idem: {},
  };
}

export const feeSetupStore = createStore<FeeSetupState>("fee-setup", initialState);

const nextId = (prefix: string) => {
  const n = feeSetupStore.get().seq + 1;
  feeSetupStore.set((s) => ({ ...s, seq: n }));
  return `${prefix}-${n}`;
};

const remember = (key: string | null, value: string) => {
  if (key) feeSetupStore.set((s) => ({ ...s, idem: { ...s.idem, [key]: value } }));
};

/* ================================================================== Rules and fines */

function currentRule(campus: CampusCode): RuleCore {
  const r = feeSetupStore.get().rules[campus];
  return r.upcoming && r.upcoming.effectiveFrom <= DEMO_TODAY ? r.upcoming : r;
}

const policyOf = (r: RuleCore): LateFinePolicy => ({ ratePerDay: r.ratePerDay, graceDays: r.graceDays, maxFine: r.maxFine });

/** Late fine on a charge on a date, by the campus's own rule. */
export function campusFine(campus: CampusCode, head: string, dueDate: IsoDate, on: IsoDate): number {
  const r = currentRule(campus);
  if (r.appliesTo === "TUITION" && !head.startsWith("Tuition fee")) return 0;
  return calculateLateFine(dueDate, on, policyOf(r)).fine;
}

/** For other modules (fee counter, Setup → Campus settings): the late-fine rule in force at a campus today. */
export function feeFineRuleFor(campus: CampusCode): LateFinePolicy & { appliesTo: FeeFineScope } {
  const r = currentRule(campus);
  return { ...policyOf(r), appliesTo: r.appliesTo };
}

function ruleText(r: RuleCore): string {
  const parts = [`Late fine ${formatRs(r.ratePerDay)} a day after the due date${r.appliesTo === "TUITION" ? " on tuition" : ""}`];
  if (r.graceDays > 0) parts.push(`after ${r.graceDays} grace ${r.graceDays === 1 ? "day" : "days"}`);
  if (r.maxFine !== null) parts.push(`up to ${formatRs(r.maxFine)} per charge`);
  return parts.join(", ");
}

function toRule(campus: CampusCode): FeeFineRule {
  const r = feeSetupStore.get().rules[campus];
  const cur = currentRule(campus);
  return {
    campus,
    campusName: campusName(campus),
    ratePerDay: cur.ratePerDay,
    graceDays: cur.graceDays,
    maxFine: cur.maxFine,
    appliesTo: cur.appliesTo,
    effectiveFrom: cur.effectiveFrom,
    updatedBy: cur.updatedBy,
    updatedAt: cur.updatedAt,
    ...(r.upcoming && r.upcoming.effectiveFrom > DEMO_TODAY ? { upcoming: r.upcoming } : {}),
    history: [...r.history].reverse(),
  };
}

/* ================================================================== Structure */

function structureRecord(campus: CampusCode, session: number): StructureRecord | undefined {
  return feeSetupStore.get().structures[sKey(campus, session)];
}

/** Amount of a head for a class (or one section of it, when the section has its own amount). 0 when not billed. */
function amountOf(campus: CampusCode, session: number, cls: string, head: string, section?: string): number {
  const c = structureRecord(campus, session)?.classes[cls];
  if (!c || c.inactive?.includes(head)) return 0;
  const own = section ? c.sections?.find((o) => o.section === section && o.head === head) : undefined;
  return own ? own.amount : (c.lines[head] ?? 0);
}

function plansOf(campus: CampusCode, session: number): FeeInstallmentPlan[] {
  return feeSetupStore.get().plans[sKey(campus, session)] ?? plansFor(session);
}

/** Heads that can carry an amount per class: fee and application heads not priced elsewhere (transport is by route). */
const isStructureHead = (h: FeeHead) => (h.category === "FEE" || h.category === "APPLICATION") && !h.linked;

/** How many times a head is billed in a session (0 for one-off heads, which are not part of the session total). */
function timesBilled(h: FeeHead | undefined, plans: FeeInstallmentPlan[]): number {
  if (!h) return 0;
  const count = (code: FeeInstallmentPlan["code"]) => plans.find((p) => p.code === code)?.count ?? 1;
  if (h.billing === "MONTHLY") return count("MONTHLY");
  if (h.billing === "QUARTERLY") return count("QUARTERLY");
  if (h.billing === "TERMLY") return count("TERMLY");
  if (h.billing === "ANNUAL") return 1;
  return 0;
}

/** Charges a student pays in a session for one class (before concessions; transport and one-off heads excluded). */
function yearTotal(c: Pick<ClassRecord, "lines" | "inactive" | "sections">, cls: string, session: number, section?: string): number {
  const plans = plansFor(session);
  let total = 0;
  for (const [code, base] of Object.entries(c.lines)) {
    if (c.inactive?.includes(code)) continue;
    const h = feeHeadByCode(code) ?? FEE_HEADS.find((x) => x.code === code);
    if (!h || h.category !== "FEE" || h.linked) continue;
    if (h.classes?.length && !h.classes.includes(cls)) continue;
    const own = section ? c.sections?.find((o) => o.section === section && o.head === code) : undefined;
    total += (own ? own.amount : base) * timesBilled(h, plans);
  }
  return total;
}

function sectionsOfClass(cls: string): string[] {
  return CLASSES.find((c) => c.short === cls)?.sections ?? ["A"];
}

/** Unpaid charges under a head across the demo's ledgers (a head in use can't be deactivated). */
function openChargesUnder(code: string): number {
  let n = 0;
  for (const list of Object.values(feesStore.get().charges)) for (const c of list) if (c.status === "OPEN" && (c.headCode ?? headCodeOf(c.head)) === code) n += 1;
  return n;
}

const headOut = (h: FeeHead): FeeHead => ({ ...h, openCharges: openChargesUnder(h.code), rowVer: h.rowVer ?? 1 });

const BILLINGS: FeeHead["billing"][] = ["MONTHLY", "QUARTERLY", "TERMLY", "ANNUAL", "ON_ADMISSION", "ON_APPLICATION", "WHEN_RAISED"];

function cleanHead(input: FeeHeadInput): Omit<FeeHead, "code"> {
  const classes = (input.classes ?? []).filter((c) => CLASS_SHORTS.includes(c));
  return {
    title: input.title.trim(),
    titleUr: (input.titleUr ?? "").trim(),
    shortTitle: input.shortTitle.trim(),
    category: input.category,
    billing: input.billing,
    concessionEligible: input.category === "FEE" && Boolean(input.concessionEligible),
    lateFine: input.category === "FEE" && Boolean(input.lateFine),
    ...(classes.length && classes.length < CLASS_SHORTS.length ? { classes: CLASS_SHORTS.filter((c) => classes.includes(c)) } : {}),
    order: input.order,
    active: Boolean(input.active),
    note: (input.note ?? "").trim(),
  };
}

function validateHead(input: FeeHeadInput, self: FeeHead | null): Response | null {
  const title = (input.title ?? "").trim();
  const short = (input.shortTitle ?? "").trim();
  const others = feeHeads().filter((h) => h.code !== self?.code);
  if (title.length < 3) return fail(422, "VALIDATION", "Enter the head's title, at least 3 letters.", { field: "title" });
  if (title.length > 60) return fail(422, "VALIDATION", "Keep the title to 60 characters.", { field: "title" });
  if (others.some((h) => h.title.toLowerCase() === title.toLowerCase())) return fail(422, "VALIDATION", `There is already a head called ${title}.`, { field: "title" });
  if (short.length < 2) return fail(422, "VALIDATION", "Enter a short title for vouchers and reports.", { field: "shortTitle" });
  if (short.length > 16) return fail(422, "VALIDATION", "Keep the short title to 16 characters.", { field: "shortTitle" });
  if (others.some((h) => h.shortTitle.toLowerCase() === short.toLowerCase())) return fail(422, "VALIDATION", `${others.find((h) => h.shortTitle.toLowerCase() === short.toLowerCase())?.title} already uses the short title ${short}.`, { field: "shortTitle" });
  if (!["FEE", "FINE", "APPLICATION"].includes(input.category)) return fail(422, "VALIDATION", "Choose fee, fine or application.", { field: "category" });
  if (!BILLINGS.includes(input.billing)) return fail(422, "VALIDATION", "Choose how often it is billed.", { field: "billing" });
  if (input.category !== "FEE" && ["MONTHLY", "QUARTERLY", "TERMLY", "ANNUAL"].includes(input.billing)) return fail(422, "VALIDATION", "Only fee heads are billed on a plan. Fines and application heads are charged when raised.", { field: "billing" });
  if (!Number.isInteger(input.order) || input.order < 1 || input.order > 999) return fail(422, "VALIDATION", "Order is a whole number from 1 to 999.", { field: "order" });
  if ((input.note ?? "").length > 160) return fail(422, "VALIDATION", "Keep the note to one line (160 characters).", { field: "note" });
  return null;
}

function deactivateBlock(h: FeeHead): Response | null {
  if (h.system) return fail(409, "BUILT_IN", `${h.title} is built in and can't be switched off. You can rename it.`);
  const open = openChargesUnder(h.code);
  if (open > 0) return fail(409, "IN_USE", `${open} unpaid ${open === 1 ? "charge uses" : "charges use"} ${h.title}. Collect or cancel ${open === 1 ? "it" : "them"} first, then switch the head off.`);
  return null;
}

function toStructure(campus: CampusCode, session: number): FeeStructure {
  const rec = structureRecord(campus, session);
  const prev = structureRecord(campus, session - 1);
  const plans = plansOf(campus, session);
  const heads = feeHeads();
  const priced = heads.filter(isStructureHead);
  const byBilling = (b: FeeHead["billing"]) => heads.filter((h) => h.category === "FEE" && h.active && h.billing === b).map((h) => h.code);
  return {
    campus,
    campusName: campusName(campus),
    session,
    status: rec ? "SET" : "NOT_SET",
    heads: heads.map((h) => ({ ...h, openCharges: openChargesUnder(h.code), rowVer: h.rowVer ?? 1 })),
    classes: rec
      ? CLASS_SHORTS.map((cls) => {
          const c = rec.classes[cls] ?? { lines: {}, updatedAt: demoNow(), updatedBy: "" };
          return {
            classShort: cls,
            className: classNameOf(cls),
            sections: sectionsOfClass(cls),
            lines: priced
              .filter((h) => h.code in c.lines || STRUCTURE_HEADS.includes(h.code as (typeof STRUCTURE_HEADS)[number]))
              .map((h) => ({
                head: h.code,
                amount: c.lines[h.code] ?? 0,
                ...(c.inactive?.includes(h.code) ? { active: false } : {}),
                ...(c.installments?.[h.code] ? { installments: c.installments[h.code] } : {}),
              })),
            sectionOverrides: c.sections ?? [],
            monthly: c.inactive?.includes("TUITION") ? 0 : (c.lines.TUITION ?? 0),
            yearTotal: yearTotal(c, cls, session),
            updatedAt: c.updatedAt,
            updatedBy: c.updatedBy,
          };
        })
      : [],
    plans: plans.map((p) => {
      const own = p.code === "ANNUAL" ? byBilling("ANNUAL") : byBilling(p.code);
      return { ...p, heads: own.length ? own : p.code === "MONTHLY" ? p.heads : [] };
    }),
    transport: TRANSPORT_RANGE[campus],
    canCopyFrom: prev ? session - 1 : null,
    history: [...(feeSetupStore.get().history[sKey(campus, session)] ?? [])].reverse(),
    rowVer: rec?.rowVer ?? 0,
  };
}

function copyPreview(body: FeeCopyRequest): FeeCopyPreview | Response {
  const src = structureRecord(body.campus, body.fromSession);
  if (!src) return fail(404, "NOT_FOUND", `${campusName(body.campus)} has no fee structure for ${formatSession(body.fromSession)} to copy.`);
  if (!Number.isInteger(body.increasePct) || body.increasePct < 0 || body.increasePct > 25) return fail(422, "VALIDATION", "Enter an increase between 0% and 25%.", { field: "increasePct" });
  if (![50, 100, 500].includes(body.roundTo)) return fail(422, "VALIDATION", "Round to Rs 50, Rs 100 or Rs 500.", { field: "roundTo" });
  const rows: FeeCopyPreview["rows"] = [];
  const classes: FeeCopyPreview["classes"] = [];
  const bump = (old: number) => (old === 0 ? 0 : Math.max(body.roundTo, roundTo(old * (1 + body.increasePct / 100), body.roundTo)));
  for (const cls of CLASS_SHORTS) {
    const fromRec = src.classes[cls] ?? { lines: {}, updatedAt: "", updatedBy: "" };
    const from = fromRec.lines;
    const to: Record<string, number> = {};
    const codes = [...new Set([...STRUCTURE_HEADS, ...Object.keys(from)])];
    for (const h of codes) {
      const old = from[h] ?? 0;
      const next = bump(old);
      to[h] = next;
      rows.push({ classShort: cls, className: classNameOf(cls), head: h, headTitle: feeHeadByCode(h)?.title ?? h, from: old, to: next });
    }
    classes.push({ classShort: cls, className: classNameOf(cls), from: yearTotal(fromRec, cls, body.toSession), to: yearTotal({ ...fromRec, lines: to, sections: (fromRec.sections ?? []).map((o) => ({ ...o, amount: bump(o.amount) })) }, cls, body.toSession) });
  }
  return { rows, classes };
}

/* ================================================================== Concessions */

/** The largest approved concession on a head for a charge due on a date. */
function bestConcession(grNo: string, headCode: string, dueDate: IsoDate): ConcessionRecord | undefined {
  return feeSetupStore
    .get()
    .concessions.filter((c) => c.grNo === grNo && c.status === "APPROVED" && c.heads.includes(headCode) && c.validFrom <= dueDate && dueDate <= c.validTo)
    .sort((a, b) => b.pct - a.pct)[0];
}

/** Re-prices a student's unpaid charges to their best approved concession (or back to full fee). */
function syncStudentConcessions(grNo: string): number {
  const st = feeSetupStore.get();
  const list = chargesOf(grNo);
  const repriced = { ...st.repriced };
  let changed = 0;
  const next = list.map((c) => {
    if (c.status !== "OPEN" || c.settledAmount > 0) return c;
    const code = headCodeOf(c.head);
    const prior = repriced[c.id];
    const gross = prior?.gross ?? c.amount;
    const best = bestConcession(grNo, code, c.dueDate);
    const net = best ? gross - concessionOff(gross, best.pct) : gross;
    if (best) repriced[c.id] = { gross, concessionId: best.id };
    else delete repriced[c.id];
    if (net === c.amount) return c;
    changed += 1;
    return { ...c, amount: net };
  });
  if (changed > 0) feesStore.set((fs) => ({ ...fs, charges: { ...fs.charges, [grNo]: next } }));
  if (JSON.stringify(repriced) !== JSON.stringify(st.repriced)) feeSetupStore.set((s) => ({ ...s, repriced }));
  return changed;
}

/** For the fee counter: re-price a student's unpaid charges to their approved concessions before showing them. */
export const applyFeeConcessions = (grNo: string) => syncStudentConcessions(grNo);

/** Every student with a concession, so approvals and stops always show at the counter. */
function syncConcessions() {
  const students = new Set([...feeSetupStore.get().concessions.map((c) => c.grNo), ...Object.keys(feeSetupStore.get().repriced).map((id) => id.split(":")[0]!)]);
  for (const gr of students) syncStudentConcessions(gr);
}

/** Every installment of a head for a class (or section) in a session: due date and amount before concessions. */
function headSchedule(campus: CampusCode, session: number, cls: string, section: string | undefined, code: string): Array<{ dueDate: IsoDate; gross: number }> {
  const h = feeHeadByCode(code);
  if (!h || h.category !== "FEE" || h.linked) return [];
  if (h.classes?.length && !h.classes.includes(cls)) return [];
  const amount = amountOf(campus, session, cls, code, section);
  if (amount <= 0) return [];
  if (code === "BOARD") return [{ dueDate: boardDueDate(session), gross: amount }];
  const parts = structureRecord(campus, session)?.classes[cls]?.installments?.[code];
  const planCode = planFor(h, parts);
  const plan = planCode ? plansOf(campus, session).find((p) => p.code === planCode) : undefined;
  if (!plan) return [];
  if (parts && parts > 1 && h.billing === "ANNUAL") {
    const split = splitRupees(amount, parts);
    return plan.installments.map((i, k) => ({ dueDate: i.dueDate, gross: split[k] ?? 0 }));
  }
  return plan.installments.map((i) => ({ dueDate: i.dueDate, gross: amount }));
}

/** Rupees a concession takes off over its dates (or a window inside them), head by head. */
function concessionValue(c: Pick<ConcessionRecord, "campus" | "session" | "grNo" | "heads" | "pct" | "validFrom" | "validTo">, from: IsoDate, to: IsoDate, onlyHeads?: string[]): Record<string, number> {
  const s = findStudent(c.grNo);
  if (!s) return {};
  const cls = classOf(s.classSection);
  const section = s.classSection.split("-")[1];
  const lo = from > c.validFrom ? from : c.validFrom;
  const hi = to < c.validTo ? to : c.validTo;
  const out: Record<string, number> = {};
  for (const code of c.heads) {
    if (onlyHeads && !onlyHeads.includes(code)) continue;
    out[code] = headSchedule(c.campus, c.session, cls, section, code)
      .filter((i) => i.dueDate >= lo && i.dueDate <= hi)
      .reduce((a, i) => a + concessionOff(i.gross, c.pct), 0);
  }
  return out;
}

/**
 * A student's session fee (Students → family sheet): the class's session total from the fee structure, with the
 * student's section's own amounts, less the approved concessions of that session. Transport and one-off heads are
 * not part of it.
 */
export function studentSessionFee(grNo: string, session: number): { gross: number; concession: number; net: number } {
  const s = findStudent(grNo);
  if (!s) return { gross: 0, concession: 0, net: 0 };
  const cls = classOf(s.classSection);
  const section = s.classSection.split("-")[1];
  const rec = structureRecord(s.campus, session)?.classes[cls];
  const gross = rec ? yearTotal(rec, cls, session, section) : 0;
  const off = feeSetupStore
    .get()
    .concessions.filter((c) => c.grNo === s.grNo && c.session === session && c.status === "APPROVED")
    .reduce((a, c) => a + Object.values(concessionValue(c, c.validFrom, c.validTo)).reduce((x, v) => x + v, 0), 0);
  const concession = Math.min(gross, off);
  return { gross, concession, net: gross - concession };
}

function toConcession(c: ConcessionRecord): FeeConcession {
  const s = findStudent(c.grNo);
  const cls = classOf(s?.classSection ?? "");
  const section = s?.classSection.split("-")[1];
  const gross = amountOf(c.campus, c.session, cls, "TUITION", section) || 0;
  const off = concessionOff(gross, c.pct);
  const value = concessionValue(c, c.validFrom, c.validTo);
  const rec = structureRecord(c.campus, c.session)?.classes[cls];
  return {
    id: c.id,
    campus: c.campus,
    campusName: campusName(c.campus),
    session: c.session,
    grNo: c.grNo,
    studentName: s?.name ?? c.grNo,
    classSection: s?.classSection ?? "",
    father: s?.father ?? "",
    type: c.type,
    pct: c.pct,
    heads: c.heads,
    validFrom: c.validFrom,
    validTo: c.validTo,
    ...(c.reference ? { reference: c.reference } : {}),
    reason: c.reason,
    status: c.status,
    requestedBy: c.requestedBy,
    requestedAt: c.requestedAt,
    ...(c.decidedBy ? { decidedBy: c.decidedBy } : {}),
    ...(c.decidedAt ? { decidedAt: c.decidedAt } : {}),
    ...(c.decisionNote ? { decisionNote: c.decisionNote } : {}),
    example: { head: "Tuition fee (a month)", gross, concession: off, net: gross - off },
    monthlyValue: c.heads.includes("TUITION") ? off : 0,
    sessionFee: rec ? yearTotal(rec, cls, c.session, section) : 0,
    sessionValue: Object.values(value).reduce((a, v) => a + v, 0),
    byHead: Object.entries(value).map(([head, amount]) => ({ head, title: feeHeadByCode(head)?.title ?? head, amount })),
    repriced: Object.values(feeSetupStore.get().repriced).filter((r) => r.concessionId === c.id).length,
    history: [...c.history].reverse(),
  };
}

function suggestionsFor(campus: CampusCode, session: number): FeeConcessionSuggestion[] {
  const families = new Map<string, StudentRecord[]>();
  for (const s of STUDENTS) {
    if (!live(s) || s.status !== "ACTIVE" || !s.fatherCnic) continue;
    families.set(s.fatherCnic, [...(families.get(s.fatherCnic) ?? []), s]);
  }
  const taken = new Set(feeSetupStore.get().concessions.filter((c) => c.type === "SIBLING" && c.session === session && (c.status === "APPROVED" || c.status === "PENDING")).map((c) => c.grNo));
  const out: FeeConcessionSuggestion[] = [];
  for (const kids of families.values()) {
    if (kids.length < 2) continue;
    const sorted = [...kids].sort((a, b) => a.dob.localeCompare(b.dob));
    const eldest = sorted[0]!;
    for (const k of sorted.slice(1)) {
      if (k.campus !== campus || taken.has(k.grNo)) continue;
      out.push({
        grNo: k.grNo,
        studentName: k.name,
        classSection: k.classSection,
        father: k.father,
        type: "SIBLING",
        pct: typeInfo("SIBLING").defaultPct,
        reason: `${eldest.gender === "F" ? "Elder sister" : "Elder brother"} ${eldest.name} is in ${eldest.classSection} at ${eldest.campusName} (same father's CNIC).`,
      });
    }
  }
  return out;
}

/**
 * Concessions added up by class for a period (Class Wise Discount, Annual Fee Concession, Student Discount).
 * Billed = the chosen heads' installments falling due in the period; discount = what approved concessions take off them.
 * Exported for the report centre, so both read the same live figures.
 */
export function feeConcessionSummary(scope: CampusScope, session: number, from: IsoDate, to: IsoDate, opts: { heads?: string[]; classes?: string[]; section?: string } = {}): FeeConcessionSummary {
  const eligible = feeHeads().filter((h) => h.concessionEligible);
  const heads = opts.heads?.length ? eligible.filter((h) => opts.heads!.includes(h.code)) : eligible;
  const codes = heads.map((h) => h.code);
  const campuses = campusesIn(scope);
  const concessions = feeSetupStore.get().concessions.filter((c) => campuses.includes(c.campus) && c.session === session && (c.status === "APPROVED" || c.status === "STOPPED") && c.validFrom <= to && c.validTo >= from);
  const students = STUDENTS.filter((s) => live(s) && s.status === "ACTIVE" && campuses.includes(s.campus))
    .filter((s) => !opts.classes?.length || opts.classes.includes(classOf(s.classSection)))
    .filter((s) => !opts.section || s.classSection.split("-")[1] === opts.section);
  const byClass = new Map<string, FeeSetupClassAcc>();
  const kindRows = new Map<string, { strength: number; counts: Partial<Record<FeeConcessionType, number>>; total: number }>();
  const studentRows: FeeConcessionSummary["students"] = [];
  const kinds = new Set<FeeConcessionType>();
  for (const s of students) {
    const cls = classOf(s.classSection);
    const section = s.classSection.split("-")[1];
    const g = byClass.get(cls) ?? { strength: 0, students: 0, billed: 0, discount: 0 };
    const k = kindRows.get(cls) ?? { strength: 0, counts: {}, total: 0 };
    g.strength += 1;
    k.strength += 1;
    const billedByHead: Record<string, number> = {};
    for (const code of codes) billedByHead[code] = headSchedule(s.campus, session, cls, section, code).filter((i) => i.dueDate >= from && i.dueDate <= to).reduce((a, i) => a + i.gross, 0);
    const billed = Object.values(billedByHead).reduce((a, v) => a + v, 0);
    g.billed += billed;
    const mine = concessions.filter((c) => c.grNo === s.grNo).sort((a, b) => b.pct - a.pct);
    if (mine.length) {
      // The larger concession applies when two run at once (same rule as the counter).
      const best = mine[0]!;
      const off = concessionValue(best, from, to, codes);
      const discount = Object.values(off).reduce((a, v) => a + v, 0);
      g.students += 1;
      g.discount += discount;
      k.counts[best.type] = (k.counts[best.type] ?? 0) + 1;
      k.total += 1;
      kinds.add(best.type);
      studentRows.push({
        grNo: s.grNo,
        studentName: s.name,
        father: s.father,
        classSection: s.classSection,
        type: best.type,
        pct: best.pct,
        ...(best.reference ? { reference: best.reference } : {}),
        sessionFee: billed,
        concession: discount,
        payable: billed - discount,
        byHead: off,
      });
    }
    byClass.set(cls, g);
    kindRows.set(cls, k);
  }
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
  const order = (a: string, b: string) => CLASS_SHORTS.indexOf(a) - CLASS_SHORTS.indexOf(b);
  const classRows = [...byClass.entries()].sort(([a], [b]) => order(a, b)).map(([cls, g]) => ({ classShort: cls, className: classNameOf(cls), ...g, remaining: g.billed - g.discount, pct: pct(g.discount, g.billed) }));
  const sum = (f: (r: (typeof classRows)[number]) => number) => classRows.reduce((a, r) => a + f(r), 0);
  const kindList = CONCESSION_TYPES.map((t) => t.code).filter((t) => kinds.has(t));
  const kRows = [...kindRows.entries()].sort(([a], [b]) => order(a, b)).map(([cls, k]) => ({ classShort: cls, className: classNameOf(cls), strength: k.strength, counts: k.counts, total: k.total, pct: pct(k.total, k.strength) }));
  const totalCounts: Partial<Record<FeeConcessionType, number>> = {};
  for (const r of kRows) for (const [t, n] of Object.entries(r.counts)) totalCounts[t as FeeConcessionType] = (totalCounts[t as FeeConcessionType] ?? 0) + (n ?? 0);
  const kStrength = kRows.reduce((a, r) => a + r.strength, 0);
  const kTotal = kRows.reduce((a, r) => a + r.total, 0);
  return {
    campus: scope,
    session,
    from,
    to,
    heads: heads.map((h) => ({ code: h.code, title: h.title })),
    byClass: classRows,
    totals: { strength: sum((r) => r.strength), students: sum((r) => r.students), billed: sum((r) => r.billed), discount: sum((r) => r.discount), remaining: sum((r) => r.remaining), pct: pct(sum((r) => r.discount), sum((r) => r.billed)) },
    byClassKind: { kinds: kindList, rows: kRows, totals: { strength: kStrength, counts: totalCounts, total: kTotal, pct: pct(kTotal, kStrength) } },
    students: studentRows.sort((a, b) => a.classSection.localeCompare(b.classSection, "en", { numeric: true }) || a.studentName.localeCompare(b.studentName)),
  };
}

interface FeeSetupClassAcc {
  strength: number;
  students: number;
  billed: number;
  discount: number;
}

/* ================================================================== Vouchers */

function voucherStatus(v: VoucherRecord): { status: FeeVoucherStatus; receiptNos: string[] } {
  if (v.cancelled) return { status: "CANCELLED", receiptNos: [] };
  const byId = new Map(chargesOf(v.grNo).map((c) => [c.id, c]));
  let paid = 0;
  let partly = false;
  for (const l of v.lines) {
    const c = byId.get(l.chargeId);
    if (!c || c.status !== "OPEN") paid += 1;
    else if (c.settledAmount > 0) partly = true;
  }
  const ids = new Set(v.lines.map((l) => l.chargeId));
  const receiptNos = receiptsOf(v.grNo)
    .filter((r) => r.status !== "CANCELLED" && r.postedAt.slice(0, 10) >= v.issueDate && r.lines.some((l) => ids.has(l.chargeId)))
    .map((r) => r.receiptNo);
  const status: FeeVoucherStatus = paid === v.lines.length ? "PAID" : paid > 0 || partly ? "PART_PAID" : DEMO_TODAY > v.dueDate ? "OVERDUE" : "ISSUED";
  return { status, receiptNos };
}

/** The voucher number of an unpaid, uncancelled voucher that carries a charge (a charge on one can't be cancelled). */
export function openVoucherWith(grNo: string, chargeId: string): string | null {
  const v = Object.values(feeSetupStore.get().vouchers).find((x) => x.grNo === grNo && !x.cancelled && x.lines.some((l) => l.chargeId === chargeId));
  if (!v) return null;
  const { status } = voucherStatus(v);
  return status === "PAID" || status === "CANCELLED" ? null : v.voucherNo;
}

function fineTableOf(campus: CampusCode, lines: FeeVoucherLine[], dueDate: IsoDate) {
  const base = lines.reduce((a, l) => a + l.amount, 0);
  return [0, 5, 10, 15, 20].map((k) => {
    const upTo = addDays(dueDate, k);
    const fine = lines.reduce((a, l) => a + campusFine(campus, l.head, l.dueDate, upTo), 0);
    return { upTo, fine, amount: base + fine };
  });
}

/** An unpaid charge on the voucher now has a different amount or due date (concession, waiver, due-date move). */
function changedSinceIssue(v: VoucherRecord): boolean {
  if (v.cancelled || !v.runId) return false;
  const byId = new Map(chargesOf(v.grNo).map((c) => [c.id, c]));
  return v.lines.some((l) => {
    const c = byId.get(l.chargeId);
    return c !== undefined && c.status === "OPEN" && c.settledAmount === 0 && (c.amount !== l.amount || c.dueDate !== l.dueDate);
  });
}

function toVoucher(v: VoucherRecord, bank = bankFor(v.campus)): FeeVoucher {
  const s = findStudent(v.grNo);
  const { status, receiptNos } = voucherStatus(v);
  const table = fineTableOf(v.campus, v.lines, v.dueDate);
  const changed = status !== "PAID" && changedSinceIssue(v);
  return {
    voucherNo: v.voucherNo,
    runId: v.runId,
    campus: v.campus,
    campusName: campusName(v.campus),
    session: v.session,
    month: v.month,
    grNo: v.grNo,
    studentName: s?.name ?? v.grNo,
    ...(s?.nameUr ? { studentNameUr: s.nameUr } : {}),
    relation: s?.relation ?? "s/o",
    father: s?.father ?? "",
    classSection: s?.classSection ?? "",
    issueDate: v.issueDate,
    dueDate: v.dueDate,
    validUntil: v.validUntil,
    lines: v.lines,
    fineOnArrears: table[0]!.fine,
    payableByDue: table[0]!.amount,
    fineTable: table,
    status,
    receiptNos,
    ...(v.cancelled ? { cancelledReason: v.cancelled.reason } : {}),
    ...(changed ? { changedSinceIssue: true } : {}),
    printCount: v.printCount,
    bank,
    fineRule: ruleText(currentRule(v.campus)),
  };
}

function toRun(r: RunRecord): FeeVoucherRun {
  const st = feeSetupStore.get();
  const counts: Record<FeeVoucherStatus, number> = { ISSUED: 0, PART_PAID: 0, PAID: 0, OVERDUE: 0, CANCELLED: 0 };
  let total = 0;
  let collected = 0;
  for (const no of r.voucherNos) {
    const v = st.vouchers[no];
    if (!v) continue;
    const { status } = voucherStatus(v);
    counts[status] += 1;
    if (status === "CANCELLED") continue;
    const amount = v.lines.reduce((a, l) => a + l.amount, 0);
    total += amount;
    if (status === "PAID") collected += amount;
    else if (status === "PART_PAID") {
      const byId = new Map(chargesOf(v.grNo).map((c) => [c.id, c]));
      collected += v.lines.reduce((a, l) => {
        const c = byId.get(l.chargeId);
        return a + (!c || c.status !== "OPEN" ? l.amount : Math.min(l.amount, c.settledAmount));
      }, 0);
    }
  }
  return { id: r.id, campus: r.campus, session: r.session, month: r.month, scope: r.scope, dueDate: r.dueDate, count: r.voucherNos.length, total, generatedBy: r.generatedBy, generatedAt: r.generatedAt, counts, collected };
}

interface Plan {
  student: StudentRecord;
  newCharges: Charge[];
  lines: FeeVoucherLine[];
  repriced: Record<string, { gross: number; concessionId: string }>;
  skip?: string;
}

function headLabel(code: string, month: string, session: number, part?: { k: number; n: number }): string {
  if (code === "TUITION") return `Tuition fee – ${monthShort(month)}`;
  if (code === "EXAM") return `Exam fee – ${monthShort(month)}`;
  if (code === "ANNUAL") return `Annual charges ${formatSession(session)}${part && part.n > 1 ? ` (part ${part.k} of ${part.n})` : ""}`;
  if (code === "BOARD") return `Board registration fee ${formatSession(session)}`;
  const h = feeHeadByCode(code);
  const title = h?.title ?? code;
  if (h?.billing === "ANNUAL" || part) return `${title} ${formatSession(session)}${part && part.n > 1 ? ` (part ${part.k} of ${part.n})` : ""}`;
  return `${title} – ${monthShort(month)}`;
}

/** Which plan a head (or a head split into n parts) is billed on. */
function planFor(h: FeeHead, parts: number | undefined): FeeInstallmentPlan["code"] | null {
  if (h.billing === "MONTHLY" || h.billing === "QUARTERLY" || h.billing === "TERMLY") return h.billing;
  // Admission fees are raised when a student is admitted, never on a monthly voucher.
  if (h.billing === "ANNUAL") {
    if (!parts || parts === 1) return "ANNUAL";
    return parts === 12 ? "MONTHLY" : parts === 4 ? "QUARTERLY" : "TERMLY";
  }
  return null;
}

/** What a student is billed in a voucher month: head, amount and which part, from the class structure. */
function billedIn(campus: CampusCode, session: number, s: StudentRecord, month: string): Array<{ code: string; gross: number; part?: { k: number; n: number } }> {
  const cls = classOf(s.classSection);
  const section = s.classSection.split("-")[1];
  const rec = structureRecord(campus, session)?.classes[cls];
  if (!rec) return [];
  const plans = plansOf(campus, session);
  const out: Array<{ code: string; gross: number; part?: { k: number; n: number } }> = [];
  for (const h of feeHeads()) {
    if (h.category !== "FEE" || h.linked || !h.active) continue;
    if (h.classes?.length && !h.classes.includes(cls)) continue;
    const amount = amountOf(campus, session, cls, h.code, section);
    if (amount <= 0) continue;
    // Board registration is a one-off in January for Class 9 and 10.
    if (h.code === "BOARD") {
      if (boardDueDate(session).slice(0, 7) === month) out.push({ code: h.code, gross: amount });
      continue;
    }
    const parts = rec.installments?.[h.code];
    const planCode = planFor(h, parts);
    if (!planCode) continue;
    const plan = plans.find((p) => p.code === planCode);
    const idx = plan?.installments.findIndex((i) => i.dueDate.slice(0, 7) === month) ?? -1;
    if (idx < 0) continue;
    if (parts && parts > 1 && h.billing === "ANNUAL") {
      const split = splitRupees(amount, parts);
      out.push({ code: h.code, gross: split[idx] ?? 0, part: { k: idx + 1, n: parts } });
    } else out.push({ code: h.code, gross: amount });
  }
  return out;
}

function planStudent(s: StudentRecord, req: FeeVoucherRequest): Plan {
  const empty = { student: s, newCharges: [], lines: [], repriced: {} };
  if (s.status !== "ACTIVE") return { ...empty, skip: `${ENROLMENT_STATUS_LABEL[s.status]}: collect any dues at the counter` };
  const existingVoucher = Object.values(feeSetupStore.get().vouchers).find((v) => v.grNo === s.grNo && v.month === req.month && !v.cancelled);
  if (existingVoucher) return { ...empty, skip: `Already has voucher ${existingVoucher.voucherNo} for ${monthShort(req.month)}` };
  const charges = chargesOf(s.grNo);
  const newCharges: Charge[] = [];
  const lines: FeeVoucherLine[] = [];
  const repriced: Plan["repriced"] = {};
  for (const { code, gross, part } of billedIn(req.campus, req.session, s, req.month)) {
    if (gross <= 0) continue;
    const head = headLabel(code, req.month, req.session, part);
    if (charges.some((c) => c.head === head && c.status !== "CANCELLED")) continue;
    const best = feeHeadByCode(code)?.concessionEligible ? bestConcession(s.grNo, code, req.dueDate) : undefined;
    const off = best ? concessionOff(gross, best.pct) : 0;
    const id = `${s.grNo}:${code.toLowerCase()}-${req.month}`;
    newCharges.push({ id, grNo: s.grNo, session: req.session, head, kind: "FEE", amount: gross - off, dueDate: req.dueDate, status: "OPEN", settledAmount: 0, ...(code !== headCodeOf(head) ? { headCode: code } : {}) });
    if (best) repriced[id] = { gross, concessionId: best.id };
    lines.push({ chargeId: id, head, dueDate: req.dueDate, amount: gross - off, arrears: false, ...(best ? { gross, concession: { label: `${typeInfo(best.type).title} ${best.pct}%`, amount: off } } : {}) });
  }
  const monthStart = `${req.month}-01`;
  for (const c of charges.filter((x) => x.status === "OPEN").sort((a, b) => a.dueDate.localeCompare(b.dueDate))) {
    const due = c.amount - c.settledAmount;
    if (due <= 0) continue;
    if (c.dueDate >= monthStart && c.dueDate <= monthEnd(req.month)) lines.push({ chargeId: c.id, head: c.head, dueDate: c.dueDate, amount: due, arrears: false });
    else if (c.dueDate < monthStart && req.includeArrears) lines.push({ chargeId: c.id, head: c.head, dueDate: c.dueDate, amount: due, arrears: true });
  }
  lines.sort((a, b) => Number(b.arrears) - Number(a.arrears) || a.dueDate.localeCompare(b.dueDate));
  if (lines.length === 0) return { ...empty, skip: "Nothing to pay for this month" };
  return { student: s, newCharges, lines, repriced };
}

function validateVoucherRequest(req: FeeVoucherRequest): Response | null {
  const months = sessionMonths(req.session);
  if (!months.includes(req.month)) return fail(422, "VALIDATION", `Choose a month inside ${formatSession(req.session)}.`, { field: "month" });
  if (req.month < DEMO_TODAY.slice(0, 7)) return fail(422, "VALIDATION", "That month is over. Vouchers can only be issued for this month or a later one.", { field: "month" });
  if (!req.dueDate || req.dueDate < DEMO_TODAY) return fail(422, "VALIDATION", "The due date can't be in the past.", { field: "dueDate" });
  if (req.dueDate > addDays(monthEnd(req.month), 15)) return fail(422, "VALIDATION", `Choose a due date in ${monthShort(req.month)} or early the next month.`, { field: "dueDate" });
  if (!req.validUntil || req.validUntil < req.dueDate) return fail(422, "VALIDATION", "The bank must accept the voucher at least until the due date.", { field: "validUntil" });
  return null;
}

function studentsFor(req: FeeVoucherRequest): StudentRecord[] {
  return STUDENTS.filter((s) => live(s) && s.campus === req.campus && (s.status === "ACTIVE" || s.status === "STRUCK_OFF"))
    .filter((s) => req.classes.length === 0 || req.classes.includes(s.classSection) || req.classes.includes(classOf(s.classSection)))
    .sort((a, b) => a.classSection.localeCompare(b.classSection, "en", { numeric: true }) || a.name.localeCompare(b.name));
}

function scopeLabel(classes: string[]): string {
  if (classes.length === 0) return "Whole campus";
  return classes.map((c) => (c.includes("-") ? c : classNameOf(c))).join(", ");
}

function preview(req: FeeVoucherRequest): FeeVoucherPreview {
  const blockers: string[] = [];
  if (!structureRecord(req.campus, req.session)) blockers.push(`${campusName(req.campus)} has no fee structure for ${formatSession(req.session)} yet. Set it up under Structure first.`);
  const students = studentsFor(req);
  const plans = students.map((s) => planStudent(s, req));
  const ok = plans.filter((p) => !p.skip);
  if (students.length === 0) blockers.push("No students match. Choose another class or the whole campus.");
  const heads = new Map<string, { head: string; title: string; count: number; amount: number }>();
  const byClass = new Map<string, { classSection: string; students: number; total: number }>();
  let total = 0;
  let arrearsTotal = 0;
  let withArrears = 0;
  let withConcession = 0;
  let concessionTotal = 0;
  for (const p of ok) {
    const fineOnArrears = p.lines.reduce((a, l) => a + campusFine(req.campus, l.head, l.dueDate, req.dueDate), 0);
    const sum = p.lines.reduce((a, l) => a + l.amount, 0) + fineOnArrears;
    total += sum;
    const arrears = p.lines.filter((l) => l.arrears).reduce((a, l) => a + l.amount, 0);
    if (arrears > 0) {
      withArrears += 1;
      arrearsTotal += arrears;
    }
    const conc = p.lines.reduce((a, l) => a + (l.concession?.amount ?? 0), 0);
    if (conc > 0) {
      withConcession += 1;
      concessionTotal += conc;
    }
    for (const c of p.newCharges) {
      const code = headCodeOf(c.head);
      const h = heads.get(code) ?? { head: code, title: groupLabel(code), count: 0, amount: 0 };
      h.count += 1;
      h.amount += c.amount;
      heads.set(code, h);
    }
    const g = byClass.get(p.student.classSection) ?? { classSection: p.student.classSection, students: 0, total: 0 };
    g.students += 1;
    g.total += sum;
    byClass.set(p.student.classSection, g);
  }
  const samplePlan = ok.find((p) => p.student.grNo === "KC-14823") ?? ok[0];
  const sample: FeeVoucher | null = samplePlan
    ? toVoucherDraft(samplePlan, req)
    : null;
  return {
    month: req.month,
    dueDate: req.dueDate,
    students: ok.length,
    total,
    newCharges: ok.reduce((a, p) => a + p.newCharges.length, 0),
    heads: [...heads.values()],
    withArrears,
    arrearsTotal,
    withConcession,
    concessionTotal,
    byClass: [...byClass.values()].sort((a, b) => a.classSection.localeCompare(b.classSection, "en", { numeric: true })),
    skipped: plans.filter((p) => p.skip).map((p) => ({ grNo: p.student.grNo, name: p.student.name, classSection: p.student.classSection, reason: p.skip! })),
    sample,
    blockers: ok.length === 0 && students.length > 0 && blockers.length === 0 ? ["Every student in this choice already has a voucher for the month or has nothing to pay."] : blockers,
  };
}

/** A voucher before it is generated (number shown as "Assigned on generating"). */
function toVoucherDraft(p: Plan, req: FeeVoucherRequest): FeeVoucher {
  const draft: VoucherRecord = { voucherNo: "Assigned on generating", runId: "", campus: req.campus, session: req.session, month: req.month, grNo: p.student.grNo, issueDate: DEMO_TODAY, dueDate: req.dueDate, validUntil: req.validUntil, lines: p.lines, printCount: 0 };
  const v = toVoucher(draft);
  return { ...v, status: "ISSUED", receiptNos: [] };
}

/* ================================================================== Defaulters */

interface DefaulterFilter {
  /** Head codes; empty = every head. */
  heads?: string[];
  dueFrom?: IsoDate;
  dueTo?: IsoDate;
  classShort?: string;
  section?: string;
  /** Several class-sections at once ("7-A", "8-B"). */
  sections?: string[];
}

const chargeCode = (c: Charge) => c.headCode ?? headCodeOf(c.head);

function defaulterRows(scope: CampusScope, session: number, includeLeft: boolean, filter: DefaulterFilter = {}): FeeDefaulter[] {
  const reminders = feeSetupStore.get().reminders;
  const out: FeeDefaulter[] = [];
  const headOk = (c: Charge) => !filter.heads?.length || filter.heads.includes(chargeCode(c)) || (filter.heads.includes("FINE") && chargeCode(c) === "FINE");
  const dueOk = (c: Charge) => (!filter.dueFrom || c.dueDate >= filter.dueFrom) && (!filter.dueTo || c.dueDate <= filter.dueTo);
  for (const s of STUDENTS) {
    if (!live(s) || (scope !== "ALL" && s.campus !== scope)) continue;
    if (s.status !== "ACTIVE" && !includeLeft) continue;
    if (filter.classShort && classOf(s.classSection) !== filter.classShort) continue;
    if (filter.section && s.classSection.split("-")[1] !== filter.section) continue;
    if (filter.sections?.length && !filter.sections.includes(s.classSection)) continue;
    const all = chargesOf(s.grNo).filter((c) => c.session <= session && headOk(c));
    const open = all.filter((c) => c.status === "OPEN" && dueOk(c));
    const overdue = open.filter((c) => c.dueDate < DEMO_TODAY);
    if (overdue.length === 0) continue;
    const outstanding = overdue.reduce((a, c) => a + c.amount - c.settledAmount, 0);
    const fine = overdue.reduce((a, c) => a + campusFine(s.campus, c.head, c.dueDate, DEMO_TODAY), 0);
    const oldestDue = overdue.map((c) => c.dueDate).sort()[0]!;
    const days = daysBetween(oldestDue, DEMO_TODAY);
    const rem = reminders[s.grNo];
    const sessionTotal = all.filter((c) => c.session === session && c.status !== "CANCELLED").reduce((a, c) => a + c.amount, 0);
    const previousSessionArrears = overdue.filter((c) => c.session < session).reduce((a, c) => a + c.amount - c.settledAmount, 0);
    out.push({
      sessionTotal,
      previousSessionArrears,
      installments: [...overdue].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map((c) => ({ label: c.head, dueDate: c.dueDate, amount: c.amount - c.settledAmount })),
      grNo: s.grNo,
      studentName: s.name,
      classSection: s.classSection,
      campus: s.campus,
      campusName: s.campusName,
      father: s.father,
      mobile: s.guardian.mobile,
      enrolment: s.status,
      overdueCharges: overdue.length,
      oldestDue,
      daysOverdue: days,
      monthsOverdue: Math.max(1, Math.ceil(days / 30)),
      outstanding,
      fine,
      total: outstanding + fine,
      upcoming: open.filter((c) => c.dueDate >= DEMO_TODAY).reduce((a, c) => a + c.amount - c.settledAmount, 0),
      ...(rem ? { lastReminderAt: rem.at } : {}),
      reminders: rem?.count ?? 0,
    });
  }
  return out.sort((a, b) => b.total - a.total);
}

/** Billed, paid and arrears per class-section (Class Wise Arrear). Exported for the report centre. */
export function feeClassArrears(scope: CampusScope, session: number, filter: DefaulterFilter = {}): FeeClassArrears {
  const headOk = (c: Charge) => !filter.heads?.length || filter.heads.includes(chargeCode(c));
  const dueOk = (c: Charge) => (!filter.dueFrom || c.dueDate >= filter.dueFrom) && (!filter.dueTo || c.dueDate <= filter.dueTo);
  const m = new Map<string, FeeClassArrearsRow>();
  for (const s of STUDENTS) {
    if (!live(s) || s.status !== "ACTIVE" || (scope !== "ALL" && s.campus !== scope)) continue;
    const cls = classOf(s.classSection);
    const section = s.classSection.split("-")[1] ?? "";
    if (filter.classShort && cls !== filter.classShort) continue;
    if (filter.section && section !== filter.section) continue;
    if (filter.sections?.length && !filter.sections.includes(s.classSection)) continue;
    const key = scope === "ALL" ? `${s.campus}:${s.classSection}` : s.classSection;
    const g = m.get(key) ?? { classSection: scope === "ALL" ? `${s.classSection} · ${campusName(s.campus).replace(" Campus", "")}` : s.classSection, classShort: cls, section, strength: 0, students: 0, billed: 0, paid: 0, arrears: 0, pct: 0 };
    g.strength += 1;
    const charges = chargesOf(s.grNo).filter((c) => c.session === session && c.status !== "CANCELLED" && c.dueDate <= DEMO_TODAY && headOk(c) && dueOk(c));
    const billed = charges.reduce((a, c) => a + c.amount, 0);
    const paid = charges.reduce((a, c) => a + (c.status === "SETTLED" ? c.amount : c.settledAmount), 0);
    const arrears = charges.filter((c) => c.status === "OPEN" && c.dueDate < DEMO_TODAY).reduce((a, c) => a + c.amount - c.settledAmount, 0);
    g.billed += billed;
    g.paid += paid;
    g.arrears += arrears;
    if (arrears > 0) g.students += 1;
    m.set(key, g);
  }
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
  const rows = [...m.values()]
    .map((r) => ({ ...r, pct: pct(r.arrears, r.billed) }))
    .sort((a, b) => CLASS_SHORTS.indexOf(a.classShort) - CLASS_SHORTS.indexOf(b.classShort) || a.classSection.localeCompare(b.classSection));
  const sum = (f: (r: FeeClassArrearsRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  return {
    campus: scope,
    session,
    today: DEMO_TODAY,
    rows,
    totals: { strength: sum((r) => r.strength), students: sum((r) => r.students), billed: sum((r) => r.billed), paid: sum((r) => r.paid), arrears: sum((r) => r.arrears), pct: pct(sum((r) => r.arrears), sum((r) => r.billed)) },
  };
}

/** Defaulter filters from a query string. */
function defaulterFilter(sp: URLSearchParams): DefaulterFilter {
  const heads = (sp.get("heads") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const sections = (sp.get("sections") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return {
    ...(heads.length ? { heads } : {}),
    ...(sections.length ? { sections } : {}),
    ...(sp.get("dueFrom") ? { dueFrom: sp.get("dueFrom")! } : {}),
    ...(sp.get("dueTo") ? { dueTo: sp.get("dueTo")! } : {}),
    ...(sp.get("classShort") ? { classShort: sp.get("classShort")! } : {}),
    ...(sp.get("section") ? { section: sp.get("section")! } : {}),
  };
}

/** For the report centre: the fee module's own defaulter rows. */
export const feeDefaulterRows = (scope: CampusScope, session: number, includeLeft: boolean, filter: DefaulterFilter = {}) => defaulterRows(scope, session, includeLeft, filter);

/* ================================================================== Candidate fees */

type Applicant = ReturnType<typeof admissionsStore.get>["applicants"][number];

/** Candidate heads (application category) with their usual amounts; the test fee is by class. */
function candidateHeads(): Array<{ code: string; title: string; amount: number }> {
  return feeHeads()
    .filter((h) => h.category === "APPLICATION" && h.active)
    .map((h) => ({ code: h.code, title: h.title, amount: CANDIDATE_HEAD_AMOUNTS[h.code] ?? 0 }));
}

function candidateRow(a: Applicant): FeeCandidate {
  const fee = a.fee!;
  const title = (code: string) => feeHeadByCode(code)?.title ?? code;
  const paid = fee.status === "PAID";
  const lines: FeeCandidateLine[] = (fee.lines ?? [{ head: "CANDIDATE", amount: fee.amount, paid: paid ? fee.amount : 0 }]).map((l) => ({ ...l, title: title(l.head) }));
  // Fees paid before the fee office recorded the cashier: the campus's counter staff (fictional).
  const hash = [...a.id].reduce((s, ch) => s + ch.charCodeAt(0), 0);
  const cashiers = CASHIERS[a.campus];
  return {
    id: a.id,
    applicationNo: a.applicationNo,
    name: a.name,
    father: a.father,
    classApplied: a.classApplied,
    campus: a.campus,
    campusName: a.campusName,
    appliedOn: a.appliedOn,
    ...(a.testDate ? { testDate: a.testDate } : {}),
    amount: lines.reduce((s, l) => s + l.amount, 0),
    status: fee.status,
    ...(fee.receiptNo ? { receiptNo: fee.receiptNo } : {}),
    ...(fee.paidOn ? { paidOn: fee.paidOn } : {}),
    lines,
    received: lines.reduce((s, l) => s + l.paid, 0),
    ...(paid ? { receivedBy: fee.receivedBy ?? cashiers[hash % cashiers.length]!, paymentMethod: fee.paymentMethod ?? "CASH" } : {}),
    ...(fee.bankChallanNo ? { bankChallanNo: fee.bankChallanNo } : {}),
    ...(fee.paidBy ? { paidBy: fee.paidBy } : {}),
  };
}

/** For the report centre: candidate fees paid in a period. */
export function feeCandidateRows(scope: CampusScope, session: number): FeeCandidate[] {
  const campuses = campusesIn(scope);
  return admissionsStore
    .get()
    .applicants.filter((a) => campuses.includes(a.campus) && a.session === session && a.fee && a.fee.amount > 0)
    .map(candidateRow);
}

/* ================================================================== Collections */

const SEQ_2025_END: Record<CampusCode, number> = { KC: 9910, SM: 3950, UC: 5230, MC: 2610, HC: 7480 };

function receiptsByDay(campus: CampusCode): Map<IsoDate, Receipt[]> {
  const m = new Map<IsoDate, Receipt[]>();
  for (const r of Object.values(feesStore.get().receipts)) {
    if (r.campus !== campus) continue;
    const d = r.postedAt.slice(0, 10);
    m.set(d, [...(m.get(d) ?? []), r]);
  }
  return m;
}

const nowMinutes = () => {
  const t = demoNow().slice(11, 16);
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
};

/** "Tuition fee – Nov 2026" → head TUITION, "Tuition fee", installment "Nov 2026". */
function splitLabel(label: string): Pick<FeeCollectionLine, "head" | "headTitle" | "installment"> {
  const code = headCodeOf(label);
  const h = feeHeadByCode(code);
  if (!h || code === "FINE" || code === "OTHER") return { head: code, headTitle: groupLabel(code), installment: label };
  const rest = label.startsWith(h.title) ? label.slice(h.title.length).replace(/^[\s–-]+/, "") : label;
  return { head: code, headTitle: h.title, installment: rest };
}

/** A fictional bank slip, cheque or transaction number for a carried-over receipt (same every time). */
function syntheticRef(method: string, key: string): string {
  let h = 2166136261;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const n = String((h >>> 0) % 900000 + 100000);
  return method === "BANK" ? `SL-${n}` : method === "CHEQUE" ? `CHQ-${n.slice(0, 6)}` : `RST-${n}`;
}

/** Every receipt of a campus for the days asked for: the system's own receipts plus the day's carried-over figure. */
function campusRows(campus: CampusCode, from: IsoDate, to: IsoDate): FeeCollectionRow[] {
  const f = figuresFor(campus, feesStore.get().postedToday[campus]);
  const real = receiptsByDay(campus);
  const taken = new Set(Object.keys(feesStore.get().receipts));
  const students = STUDENTS.filter((s) => live(s) && s.campus === campus && s.status === "ACTIVE").map((s) => ({ grNo: s.grNo, name: s.name, classSection: s.classSection }));
  const genders = new Map(STUDENTS.map((s) => [s.grNo, s.gender]));
  const prefix = campusOf(campus).docPrefix;
  const out: FeeCollectionRow[] = [];

  // Number the carried-over receipts backwards from the last number used, session by session.
  for (const session of [2026, 2025]) {
    const segFrom = session === 2026 ? "2026-04-01" : "2025-04-01";
    const segTo = session === 2026 ? DEMO_TODAY : "2026-03-31";
    if (to < segFrom || from > segTo) continue;
    let n = session === 2026 ? RECEIPT_SEQ_AT_START[campus] : SEQ_2025_END[campus];
    for (let d = segTo; d >= segFrom && d >= from; d = addDays(d, -1)) {
      if (!isSchoolDay(d)) continue;
      const fig = dayFigure(campus, d, f);
      const mine = real.get(d) ?? [];
      const realAmount = mine.reduce((a, r) => a + r.total, 0);
      const count = Math.max(0, fig.receipts - mine.length);
      const amount = Math.max(0, fig.amount - realAmount);
      const rows = syntheticRows(campus, d, amount > 0 ? Math.max(1, count) : 0, amount, students);
      const nums: number[] = [];
      for (let k = 0; k < rows.length; k++) {
        while (n > 1 && taken.has(formatReceiptNo(prefix, session, n))) n -= 1;
        nums.push(n);
        n = Math.max(1, n - 1);
      }
      if (d > to) continue;
      // Today: carried-over receipts fall between opening time and now.
      if (d === DEMO_TODAY) {
        const end = Math.max(500, Math.min(nowMinutes() - 5, 13 * 60 + 40));
        rows.forEach((r, i) => (r.minutes = 485 + Math.round(((i + 0.5) * (end - 485)) / Math.max(1, rows.length))));
      }
      nums.reverse();
      rows.forEach((r, i) => {
        if (r.amount <= 0) return;
        const hh = String(Math.floor(r.minutes / 60)).padStart(2, "0");
        const mm = String(r.minutes % 60).padStart(2, "0");
        out.push({
          receiptNo: formatReceiptNo(prefix, session, nums[i] ?? 1),
          at: `${d}T${hh}:${mm}:00+05:00`,
          campus,
          grNo: r.grNo,
          studentName: r.name,
          classSection: r.classSection,
          cashier: r.cashier,
          method: r.method,
          heads: r.fine > 0 ? `${r.head}, late fine` : r.head,
          fine: r.fine,
          amount: r.amount,
          status: "POSTED",
          openable: false,
          gender: genders.get(r.grNo) ?? "M",
          lines: [{ ...splitLabel(r.head), amount: r.amount - r.fine, fine: r.fine }],
          ...(r.method !== "CASH" ? { bankRef: syntheticRef(r.method, `${d}:${i}:${r.grNo}`) } : {}),
        });
      });
      for (const r of mine) {
        out.push({
          receiptNo: r.receiptNo,
          at: r.postedAt,
          campus,
          grNo: r.grNo,
          studentName: r.studentName,
          classSection: r.classSection,
          cashier: r.cashier,
          method: r.payment.method,
          heads: r.lines.map((l) => l.head).join(", ") + (r.lines.some((l) => l.lateFine > 0) ? ", late fine" : ""),
          fine: r.lines.reduce((a, l) => a + Math.min(l.lateFine, l.applied), 0),
          amount: r.total,
          status: r.status,
          openable: true,
          gender: genders.get(r.grNo) ?? "M",
          lines: r.lines.map((l) => ({ ...splitLabel(l.head), amount: Math.max(0, l.applied - l.lateFine), fine: Math.min(l.lateFine, l.applied) })),
          ...(r.payment.method === "BANK" ? { bankRef: r.payment.slipNo } : r.payment.method === "CHEQUE" ? { bankRef: r.payment.chequeNo } : r.payment.method === "ONLINE" ? { bankRef: r.payment.transactionId } : {}),
        });
      }
    }
  }
  return out;
}

/** For the report centre: every receipt in a period (the system's own and the carried-over figure), newest first. */
export function feeCollectionRows(scope: CampusScope, from: IsoDate, to: IsoDate): FeeCollectionRow[] {
  return campusesIn(scope)
    .flatMap((c) => campusRows(c, from, to))
    .sort((a, b) => b.at.localeCompare(a.at));
}

function group(rows: FeeCollectionRow[], key: (r: FeeCollectionRow) => string, label: (k: string) => string): FeeCollectionGroup[] {
  const m = new Map<string, FeeCollectionGroup>();
  for (const r of rows) {
    const k = key(r);
    const g = m.get(k) ?? { key: k, label: label(k), receipts: 0, amount: 0 };
    g.receipts += 1;
    g.amount += r.amount;
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount);
}

function byHeadGroups(rows: FeeCollectionRow[]): FeeCollectionGroup[] {
  const m = new Map<string, FeeCollectionGroup>();
  const add = (k: string, amount: number) => {
    if (amount <= 0) return;
    const g = m.get(k) ?? { key: k, label: groupLabel(k), receipts: 0, amount: 0 };
    g.receipts += 1;
    g.amount += amount;
    m.set(k, g);
  };
  const receipts = feesStore.get().receipts;
  for (const r of rows) {
    const real = r.openable ? receipts[r.receiptNo] : undefined;
    if (real) {
      const per = new Map<string, number>();
      for (const l of real.lines) {
        const fee = Math.max(0, l.applied - l.lateFine);
        per.set(headCodeOf(l.head), (per.get(headCodeOf(l.head)) ?? 0) + fee);
        per.set("LATE_FINE", (per.get("LATE_FINE") ?? 0) + Math.min(l.applied, l.lateFine));
      }
      for (const [k, v] of per) add(k, v);
    } else {
      add("TUITION", r.amount - r.fine);
      add("LATE_FINE", r.fine);
    }
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount);
}

/* ================================================================== Handlers */

const BASE = "/api/fee-setup";

async function body<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}

export const feeSetupHandlers: HttpHandler[] = [
  /* ---------------- Overview and pickers */
  http.get(`${BASE}/overview`, async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requireAny(["fees.view", "fees.reports"], ctx.campus);
    if (user instanceof Response) return user;
    syncConcessions();
    const campuses = campusesIn(ctx.campus);
    const st = feeSetupStore.get();
    const today = { amount: 0, receipts: 0 };
    const month = { collected: 0, target: 0 };
    for (const c of campuses) {
      const f = figuresFor(c, feesStore.get().postedToday[c]);
      today.amount += f.today.amount;
      today.receipts += f.today.receipts;
      month.collected += f.month.collected;
      month.target += f.month.target;
    }
    const rows = defaulterRows(ctx.campus, ctx.session, false);
    const vouchers = Object.values(st.vouchers).filter((v) => campuses.includes(v.campus) && v.session === ctx.session);
    let open = 0;
    let overdue = 0;
    for (const v of vouchers) {
      const { status } = voucherStatus(v);
      if (status === "ISSUED" || status === "PART_PAID") open += 1;
      if (status === "OVERDUE") overdue += 1;
    }
    const data: FeeOverview = {
      campus: ctx.campus,
      session: ctx.session,
      today,
      month,
      defaulters: { students: rows.length, amount: rows.reduce((a, r) => a + r.total, 0) },
      vouchers: { open, overdue },
      approvals: {
        concessions: st.concessions.filter((c) => campuses.includes(c.campus) && c.status === "PENDING").length,
        waivers: st.waivers.filter((w) => campuses.includes(w.campus) && w.status === "PENDING").length,
      },
      pendingFines: st.fines.filter((x) => campuses.includes(x.campus) && x.status === "PENDING").length,
    };
    return HttpResponse.json(data);
  }),

  http.get(`${BASE}/students`, async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requireAny(["fees.view"], ctx.campus);
    if (user instanceof Response) return user;
    const list: FeeStudentOption[] = STUDENTS.filter((s) => live(s) && (ctx.campus === "ALL" || s.campus === ctx.campus) && s.status !== "PASSED_OUT")
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => ({ grNo: s.grNo, name: s.name, classSection: s.classSection, father: s.father, campus: s.campus }));
    return HttpResponse.json(list);
  }),

  /* ---------------- Structure */
  http.get(`${BASE}/structure/comparison`, async ({ request }) => {
    await latency();
    const session = Number(new URL(request.url).searchParams.get("session") ?? CURRENT_SESSION);
    const user = requireAny(["fees.view"], "ALL");
    if (user instanceof Response) return user;
    const data: FeeStructureComparison = {
      session,
      campuses: ALL_CAMPUSES.map((c) => ({ campus: c, name: campusName(c), status: structureRecord(c, session) ? "SET" : "NOT_SET" })),
      rows: CLASS_SHORTS.map((cls) => {
        const monthly: Partial<Record<CampusCode, number>> = {};
        const total: Partial<Record<CampusCode, number>> = {};
        for (const c of ALL_CAMPUSES) {
          const rec = structureRecord(c, session);
          if (!rec) continue;
          const cr: Pick<ClassRecord, "lines" | "inactive" | "sections"> = rec.classes[cls] ?? { lines: {} };
          monthly[c] = cr.lines.TUITION ?? 0;
          total[c] = yearTotal(cr, cls, session);
        }
        return { classShort: cls, className: classNameOf(cls), monthly, yearTotal: total };
      }),
    };
    return HttpResponse.json(data);
  }),

  http.get(`${BASE}/structure`, async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const campus = (url.searchParams.get("campus") ?? "KC") as CampusCode;
    const session = Number(url.searchParams.get("session") ?? CURRENT_SESSION);
    const user = requireAny(["fees.view"], campus);
    if (user instanceof Response) return user;
    return HttpResponse.json(toStructure(campus, session));
  }),

  http.put(`${BASE}/structure/classes/:cls`, async ({ request, params }) => {
    await latency();
    const url = new URL(request.url);
    const campus = (url.searchParams.get("campus") ?? "KC") as CampusCode;
    const session = Number(url.searchParams.get("session") ?? CURRENT_SESSION);
    const user = requireAny(["fees.setup"], campus);
    if (user instanceof Response) return user;
    const ro = readOnly(session);
    if (ro) return ro;
    const key = request.headers.get("Idempotency-Key");
    if (key && feeSetupStore.get().idem[key]) return HttpResponse.json(toStructure(campus, session));
    const cls = String(params.cls);
    const rec = structureRecord(campus, session);
    if (!rec || !rec.classes[cls]) return fail(404, "NOT_FOUND", "Set up this session's structure first (copy from last session).");
    const input = await body<FeeClassStructureInput>(request);
    if (input.rowVer !== rec.rowVer) return fail(409, "CONFLICT", "Someone else changed this fee structure while you were editing. Reload to see their changes, then make yours again.");
    const old = rec.classes[cls]!;
    const next: Record<string, number> = { ...old.lines };
    const inactive = new Set(old.inactive ?? []);
    const installments: Record<string, number> = { ...(old.installments ?? {}) };
    for (const l of input.lines ?? []) {
      const h = feeHeadByCode(l.head);
      if (!h || !isStructureHead(h)) return fail(422, "VALIDATION", `${l.head} is not a fee head that can be priced by class.`, { field: l.head });
      if (!Number.isSafeInteger(l.amount) || l.amount < 0 || l.amount > 500000) return fail(422, "VALIDATION", "Amounts are whole rupees between Rs 0 and Rs 500,000.", { field: l.head });
      if (h.classes?.length && !h.classes.includes(cls) && l.amount > 0) return fail(422, "VALIDATION", `${h.title} is only for ${h.classes.map(classNameOf).join(", ")}. Change the head's classes first.`, { field: l.head });
      if (!h.active && l.amount > 0 && (old.lines[l.head] ?? 0) === 0) return fail(422, "VALIDATION", `${h.title} is switched off. Switch the head on before adding it to a class.`, { field: l.head });
      next[l.head] = l.amount;
      if (l.active === false) inactive.add(l.head);
      else inactive.delete(l.head);
      if (l.installments !== undefined) {
        if (h.billing !== "ANNUAL" && h.billing !== "ON_ADMISSION") return fail(422, "VALIDATION", `${h.title} is billed ${FEE_BILLING_LABEL[h.billing].toLowerCase()}; only yearly and one-off heads can be split.`, { field: l.head });
        if (![1, 2, 4, 12].includes(l.installments)) return fail(422, "VALIDATION", "Split into 1, 2, 4 or 12 parts.", { field: l.head });
        if (l.installments === 1) delete installments[l.head];
        else installments[l.head] = l.installments;
      }
    }
    if ((next.TUITION ?? 0) <= 0) return fail(422, "VALIDATION", "Enter the monthly tuition fee.", { field: "TUITION" });
    const sections: FeeSectionOverride[] = input.sectionOverrides ? [] : (old.sections ?? []);
    for (const o of input.sectionOverrides ?? []) {
      if (!sectionsOfClass(cls).includes(o.section)) return fail(422, "VALIDATION", `${classNameOf(cls)} has no section ${o.section}.`, { field: "sectionOverrides" });
      const h = feeHeadByCode(o.head);
      if (!h || !isStructureHead(h)) return fail(422, "VALIDATION", "Choose a fee head for each section amount.", { field: "sectionOverrides" });
      if (!Number.isSafeInteger(o.amount) || o.amount < 0 || o.amount > 500000) return fail(422, "VALIDATION", "Section amounts are whole rupees between Rs 0 and Rs 500,000.", { field: "sectionOverrides" });
      if (sections.some((x) => x.section === o.section && x.head === o.head)) return fail(422, "VALIDATION", `Section ${o.section} has ${h.title} twice. Keep one amount.`, { field: "sectionOverrides" });
      sections.push({ section: o.section, head: o.head, amount: o.amount });
    }
    const title = (h: string) => feeHeadByCode(h)?.title ?? h;
    const changes = [...new Set([...Object.keys(old.lines), ...Object.keys(next)])]
      .filter((h) => (old.lines[h] ?? 0) !== (next[h] ?? 0))
      .map((h) => `${title(h)} ${formatRs(old.lines[h] ?? 0)} → ${formatRs(next[h] ?? 0)}`);
    for (const h of inactive) if (!(old.inactive ?? []).includes(h)) changes.push(`${title(h)} switched off`);
    for (const h of old.inactive ?? []) if (!inactive.has(h)) changes.push(`${title(h)} switched on`);
    for (const h of Object.keys({ ...installments, ...(old.installments ?? {}) })) if ((installments[h] ?? 1) !== (old.installments?.[h] ?? 1)) changes.push(`${title(h)} in ${installments[h] ?? 1} ${(installments[h] ?? 1) === 1 ? "payment" : "parts"}`);
    if (JSON.stringify(sections) !== JSON.stringify(old.sections ?? [])) changes.push(sections.length ? `Section amounts: ${sections.map((o) => `${cls}-${o.section} ${title(o.head)} ${formatRs(o.amount)}`).join(", ")}` : "Section amounts removed");
    const at = demoNow();
    const nextClass: ClassRecord = {
      lines: next,
      ...(inactive.size ? { inactive: [...inactive] } : {}),
      ...(Object.keys(installments).length ? { installments } : {}),
      ...(sections.length ? { sections } : {}),
      updatedAt: at,
      updatedBy: user.name,
    };
    feeSetupStore.set((s) => ({
      ...s,
      structures: { ...s.structures, [sKey(campus, session)]: { rowVer: rec.rowVer + 1, classes: { ...rec.classes, [cls]: nextClass } } },
      history: changes.length ? { ...s.history, [sKey(campus, session)]: [...(s.history[sKey(campus, session)] ?? []), audit(at, user.name, `${classNameOf(cls)} fees changed`, changes.join(" · "))] } : s.history,
    }));
    remember(key, "saved");
    return HttpResponse.json(toStructure(campus, session));
  }),

  /* ---------------- Fee heads (one list for every campus) */
  http.post(`${BASE}/structure/heads`, async ({ request }) => {
    await latency();
    const campus = (new URL(request.url).searchParams.get("campus") ?? "KC") as CampusCode;
    const user = requireAny(["fees.setup"], campus);
    if (user instanceof Response) return user;
    const key = request.headers.get("Idempotency-Key");
    const done = key ? feeSetupStore.get().idem[key] : undefined;
    const prior = done ? feeHeadByCode(done) : undefined;
    if (prior) return HttpResponse.json(headOut(prior));
    const input = await body<FeeHeadInput>(request);
    const bad = validateHead(input, null);
    if (bad) return bad;
    const base = (input.shortTitle || input.title).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 20) || "HEAD";
    let code = base;
    for (let i = 2; feeHeadByCode(code); i++) code = `${base}_${i}`;
    const head: FeeHead = { code, ...cleanHead(input), rowVer: 1 };
    const at = demoNow();
    feeSetupStore.set((s) => ({
      ...s,
      heads: [...(s.heads ?? FEE_HEADS), head],
      headHistory: [...(s.headHistory ?? []), audit(at, user.name, `Fee head added: ${head.title}`, `${FEE_BILLING_LABEL[head.billing]} · posts to account ${defaultIncomeAccount(head)} until Accounts changes it`)],
      history: { ...s.history, [sKey(campus, CURRENT_SESSION)]: [...(s.history[sKey(campus, CURRENT_SESSION)] ?? []), audit(at, user.name, `Fee head added: ${head.title}`, `${head.shortTitle} · ${FEE_BILLING_LABEL[head.billing]}`)] },
    }));
    remember(key, code);
    return HttpResponse.json(headOut(head), { status: 201 });
  }),

  http.put(`${BASE}/structure/heads/:code`, async ({ request, params }) => {
    await latency();
    const campus = (new URL(request.url).searchParams.get("campus") ?? "KC") as CampusCode;
    const user = requireAny(["fees.setup"], campus);
    if (user instanceof Response) return user;
    const old = feeHeadByCode(String(params.code));
    if (!old) return fail(404, "NOT_FOUND", "This fee head is no longer on record.");
    const key = request.headers.get("Idempotency-Key");
    if (key && feeSetupStore.get().idem[key]) return HttpResponse.json(headOut(old));
    const input = await body<FeeHeadInput>(request);
    if (input.rowVer !== undefined && input.rowVer !== (old.rowVer ?? 1)) return fail(409, "CONFLICT", `Someone else changed ${old.title} while you were editing. Reload to see their changes, then make yours again.`);
    const bad = validateHead(input, old);
    if (bad) return bad;
    const next: FeeHead = { ...old, ...cleanHead(input), code: old.code, ...(old.linked ? { linked: old.linked } : {}), ...(old.system ? { system: true } : {}), rowVer: (old.rowVer ?? 1) + 1 };
    if (old.system && (next.category !== old.category || next.billing !== old.billing)) return fail(422, "VALIDATION", `${old.title} is built in: its type and billing can't change. You can rename it.`, { field: "billing" });
    if (old.active && !next.active) {
      const blocked = deactivateBlock(old);
      if (blocked) return blocked;
    }
    const diff: string[] = [];
    if (next.title !== old.title) diff.push(`renamed from "${old.title}"`);
    if (next.shortTitle !== old.shortTitle) diff.push(`short title ${next.shortTitle}`);
    if (next.billing !== old.billing) diff.push(FEE_BILLING_LABEL[next.billing].toLowerCase());
    if (next.order !== old.order) diff.push(`order ${old.order} → ${next.order}`);
    if (next.concessionEligible !== old.concessionEligible) diff.push(next.concessionEligible ? "concessions now reduce it" : "concessions no longer reduce it");
    if (next.lateFine !== old.lateFine) diff.push(next.lateFine ? "late fine now runs on it" : "no late fine on it");
    if (next.active !== old.active) diff.push(next.active ? "switched on" : "switched off");
    if (JSON.stringify(next.classes ?? []) !== JSON.stringify(old.classes ?? [])) diff.push(next.classes?.length ? `classes ${next.classes.map(classNameOf).join(", ")}` : "every class");
    const at = demoNow();
    const text = `Fee head changed: ${next.title}`;
    feeSetupStore.set((s) => ({
      ...s,
      heads: (s.heads ?? FEE_HEADS).map((h) => (h.code === old.code ? next : h)),
      headHistory: [...(s.headHistory ?? []), audit(at, user.name, text, diff.join(" · ") || undefined)],
      history: { ...s.history, [sKey(campus, CURRENT_SESSION)]: [...(s.history[sKey(campus, CURRENT_SESSION)] ?? []), audit(at, user.name, text, diff.join(" · ") || undefined)] },
    }));
    remember(key, old.code);
    return HttpResponse.json(headOut(next));
  }),

  http.post(`${BASE}/structure/heads/:code/active`, async ({ request, params }) => {
    await latency();
    const campus = (new URL(request.url).searchParams.get("campus") ?? "KC") as CampusCode;
    const user = requireAny(["fees.setup"], campus);
    if (user instanceof Response) return user;
    const old = feeHeadByCode(String(params.code));
    if (!old) return fail(404, "NOT_FOUND", "This fee head is no longer on record.");
    const { active, rowVer } = await body<{ active: boolean; rowVer: number }>(request);
    if (rowVer !== undefined && rowVer !== (old.rowVer ?? 1)) return fail(409, "CONFLICT", `Someone else changed ${old.title} while you were looking at it. Reload, then try again.`);
    if (old.active === Boolean(active)) return HttpResponse.json(headOut(old));
    if (!active) {
      const blocked = deactivateBlock(old);
      if (blocked) return blocked;
    }
    const next: FeeHead = { ...old, active: Boolean(active), rowVer: (old.rowVer ?? 1) + 1 };
    const at = demoNow();
    const text = `Fee head ${active ? "switched on" : "switched off"}: ${old.title}`;
    feeSetupStore.set((s) => ({
      ...s,
      heads: (s.heads ?? FEE_HEADS).map((h) => (h.code === old.code ? next : h)),
      headHistory: [...(s.headHistory ?? []), audit(at, user.name, text)],
      history: { ...s.history, [sKey(campus, CURRENT_SESSION)]: [...(s.history[sKey(campus, CURRENT_SESSION)] ?? []), audit(at, user.name, text)] },
    }));
    return HttpResponse.json(headOut(next));
  }),

  http.post(`${BASE}/structure/copy/preview`, async ({ request }) => {
    await latency();
    const req = await body<FeeCopyRequest>(request);
    const user = requireAny(["fees.setup"], req.campus);
    if (user instanceof Response) return user;
    const p = copyPreview(req);
    return p instanceof Response ? p : HttpResponse.json(p);
  }),

  http.post(`${BASE}/structure/copy`, async ({ request }) => {
    await latency();
    const req = await body<FeeCopyRequest>(request);
    const user = requireAny(["fees.setup"], req.campus);
    if (user instanceof Response) return user;
    const ro = readOnly(req.toSession);
    if (ro) return ro;
    const key = request.headers.get("Idempotency-Key");
    if (key && feeSetupStore.get().idem[key]) return HttpResponse.json(toStructure(req.campus, req.toSession));
    const p = copyPreview(req);
    if (p instanceof Response) return p;
    const at = demoNow();
    const classes: Record<string, ClassRecord> = {};
    const src = structureRecord(req.campus, req.fromSession)!;
    const bump = (old: number) => (old === 0 ? 0 : Math.max(req.roundTo, roundTo(old * (1 + req.increasePct / 100), req.roundTo)));
    for (const cls of CLASS_SHORTS) {
      const from = src.classes[cls];
      classes[cls] = {
        lines: Object.fromEntries(p.rows.filter((r) => r.classShort === cls).map((r) => [r.head, r.to])),
        ...(from?.inactive?.length ? { inactive: from.inactive } : {}),
        ...(from?.installments ? { installments: from.installments } : {}),
        ...(from?.sections?.length ? { sections: from.sections.map((o) => ({ ...o, amount: bump(o.amount) })) } : {}),
        updatedAt: at,
        updatedBy: user.name,
      };
    }
    const k = sKey(req.campus, req.toSession);
    const had = Boolean(structureRecord(req.campus, req.toSession));
    feeSetupStore.set((s) => ({
      ...s,
      structures: { ...s.structures, [k]: { classes, rowVer: (s.structures[k]?.rowVer ?? 0) + 1 } },
      plans: { ...s.plans, [k]: s.plans[k] ?? plansFor(req.toSession) },
      history: { ...s.history, [k]: [...(s.history[k] ?? []), audit(at, user.name, `${had ? "Replaced with a copy" : "Copied"} from ${formatSession(req.fromSession)} with a ${req.increasePct}% increase, rounded to ${formatRs(req.roundTo)}`, "Every class")] },
    }));
    remember(key, "copied");
    return HttpResponse.json(toStructure(req.campus, req.toSession));
  }),

  http.post(`${BASE}/structure/due-dates`, async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const campus = (url.searchParams.get("campus") ?? "KC") as CampusCode;
    const session = Number(url.searchParams.get("session") ?? CURRENT_SESSION);
    const user = requireAny(["fees.setup"], campus);
    if (user instanceof Response) return user;
    const ro = readOnly(session);
    if (ro) return ro;
    const input = await body<FeeDueDateInput>(request);
    const plans = plansOf(campus, session);
    const plan = plans.find((p) => p.code === input.plan);
    const inst = plan?.installments.find((i) => i.no === input.no);
    if (!plan || !inst) return fail(404, "NOT_FOUND", "That installment doesn't exist.");
    if (inst.dueDate < DEMO_TODAY) return fail(409, "ALREADY_DUE", `${inst.label} fell due on ${formatDate(inst.dueDate)}. Past due dates can't be moved; ask for a waiver for one student instead.`);
    if (!input.dueDate || input.dueDate < DEMO_TODAY) return fail(422, "VALIDATION", "The new due date can't be in the past.", { field: "dueDate" });
    if (input.dueDate > SESSION_END(session) || input.dueDate < SESSION_START(session)) return fail(422, "VALIDATION", `Choose a date inside ${formatSession(session)}.`, { field: "dueDate" });
    const old = inst.dueDate;
    // Heads on this plan (as the structure page shows them); one head when the user chose one.
    const planHeads = toStructure(campus, session).plans.find((p) => p.code === plan.code)?.heads ?? plan.heads;
    if (input.head && !planHeads.includes(input.head)) return fail(422, "VALIDATION", `${feeHeadByCode(input.head)?.title ?? input.head} is not billed on the ${plan.title.toLowerCase()} plan.`, { field: "head" });
    if (input.section && !input.classShort) return fail(422, "VALIDATION", "Choose the class first, then the section.", { field: "classShort" });
    if (input.classShort && !CLASS_SHORTS.includes(input.classShort)) return fail(422, "VALIDATION", "Choose a class.", { field: "classShort" });
    if (input.section && !sectionsOfClass(input.classShort!).includes(input.section)) return fail(422, "VALIDATION", `${classNameOf(input.classShort!)} has no section ${input.section}.`, { field: "section" });
    const heads = input.head ? [input.head] : planHeads;
    const matches = (head: string) => {
      const code = headCodeOf(head);
      if (!heads.includes(code)) return false;
      // Monthly heads carry the month in the label ("Tuition fee – Nov 2026").
      return plan.code === "MONTHLY" ? head.endsWith(inst.label) : true;
    };
    const scoped = Boolean(input.classShort || input.head);
    const inScope = (s: StudentRecord) => s.campus === campus && (!input.classShort || classOf(s.classSection) === input.classShort) && (!input.section || s.classSection === `${input.classShort}-${input.section}`);
    let chargesMoved = 0;
    const scopeGrs = new Set(STUDENTS.filter(inScope).map((s) => s.grNo));
    feesStore.set((fs) => {
      const charges = { ...fs.charges };
      for (const [gr, list] of Object.entries(fs.charges)) {
        if (!scopeGrs.has(gr)) continue;
        charges[gr] = list.map((c) => {
          if (c.status !== "OPEN" || c.settledAmount > 0 || c.dueDate !== old || !matches(c.head)) return c;
          chargesMoved += 1;
          return { ...c, dueDate: input.dueDate };
        });
      }
      return { ...fs, charges };
    });
    let vouchersMoved = 0;
    const at = demoNow();
    // The plan's own date changes only when the whole campus and every head move.
    const nextPlans = scoped ? plans : plans.map((p) => (p.code === plan.code ? { ...p, installments: p.installments.map((i) => (i.no === inst.no ? { ...i, dueDate: input.dueDate } : i)) } : p));
    const scopeText = [input.classShort ? (input.section ? `${input.classShort}-${input.section}` : classNameOf(input.classShort)) : "Whole campus", input.head ? (feeHeadByCode(input.head)?.title ?? input.head) : "every head on the plan"].join(" · ");
    feeSetupStore.set((s) => {
      const vouchers = { ...s.vouchers };
      for (const v of Object.values(s.vouchers)) {
        if (v.campus !== campus || v.cancelled || !scopeGrs.has(v.grNo)) continue;
        if (!v.lines.some((l) => l.dueDate === old && matches(l.head))) continue;
        if (voucherStatus(v).status !== "ISSUED") continue;
        vouchersMoved += 1;
        const lines = v.lines.map((l) => (l.dueDate === old && matches(l.head) ? { ...l, dueDate: input.dueDate } : l));
        const due = v.dueDate === old ? input.dueDate : v.dueDate;
        vouchers[v.voucherNo] = { ...v, dueDate: due, validUntil: v.validUntil < due ? due : v.validUntil, lines };
      }
      return {
        ...s,
        vouchers,
        plans: { ...s.plans, [sKey(campus, session)]: nextPlans },
        history: { ...s.history, [sKey(campus, session)]: [...(s.history[sKey(campus, session)] ?? []), audit(at, user.name, `${plan.title} · ${inst.label}: due date moved${scoped ? ` for ${scopeText.split(" · ")[0]}` : ""}`, `${formatDate(old)} → ${formatDate(input.dueDate)} · ${scopeText} · ${chargesMoved} charges, ${vouchersMoved} vouchers`)] },
      };
    });
    return HttpResponse.json({ plan: nextPlans.find((p) => p.code === plan.code)!, chargesMoved, vouchersMoved });
  }),

  /* ---------------- Concessions */
  http.get(`${BASE}/concessions`, async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requireAny(["fees.view"], ctx.campus);
    if (user instanceof Response) return user;
    syncConcessions();
    const campuses = campusesIn(ctx.campus);
    const list = feeSetupStore
      .get()
      .concessions.filter((c) => campuses.includes(c.campus) && c.session === ctx.session)
      .map(toConcession)
      .sort((a, b) => (a.status === "PENDING" ? 0 : 1) - (b.status === "PENDING" ? 0 : 1) || b.requestedAt.localeCompare(a.requestedAt));
    const active = list.filter((c) => c.status === "APPROVED" && c.validTo >= DEMO_TODAY);
    const byType = CONCESSION_TYPES.map((t) => ({ type: t.code, count: active.filter((c) => c.type === t.code).length, monthlyValue: active.filter((c) => c.type === t.code).reduce((a, c) => a + c.monthlyValue, 0) })).filter((x) => x.count > 0);
    const data: FeeConcessionsData = {
      campus: ctx.campus,
      session: ctx.session,
      types: CONCESSION_TYPES,
      heads: feeHeads()
        .filter((h) => h.concessionEligible && h.active)
        .map((h) => ({ code: h.code, title: h.title })),
      concessions: list,
      suggestions: ctx.campus === "ALL" || ctx.session !== CURRENT_SESSION ? [] : suggestionsFor(ctx.campus, ctx.session),
      summary: { active: active.length, pending: list.filter((c) => c.status === "PENDING").length, monthlyValue: active.reduce((a, c) => a + c.monthlyValue, 0), byType },
    };
    return HttpResponse.json(data);
  }),

  http.post(`${BASE}/concessions`, async ({ request }) => {
    await latency();
    const input = await body<FeeConcessionInput>(request);
    const user = requireAny(["fees.collect", "fees.setup", "approvals.decide"], input.campus);
    if (user instanceof Response) return user;
    const ro = readOnly(input.session);
    if (ro) return ro;
    const key = request.headers.get("Idempotency-Key");
    const done = key ? feeSetupStore.get().idem[key] : undefined;
    const prior = done ? feeSetupStore.get().concessions.find((c) => c.id === done) : undefined;
    if (prior) return HttpResponse.json(toConcession(prior));
    const s = findStudent(input.grNo ?? "");
    if (!s || s.campus !== input.campus) return fail(422, "VALIDATION", "Choose a student at this campus.", { field: "grNo" });
    if (s.status !== "ACTIVE") return fail(422, "VALIDATION", `${s.name} is not enrolled now (${ENROLMENT_STATUS_LABEL[s.status]}).`, { field: "grNo" });
    const t = CONCESSION_TYPES.find((x) => x.code === input.type);
    if (!t) return fail(422, "VALIDATION", "Choose the kind of concession.", { field: "type" });
    if (!Number.isInteger(input.pct) || input.pct < 1 || input.pct > t.maxPct) return fail(422, "VALIDATION", `Enter a whole percentage from 1% to ${t.maxPct}%.`, { field: "pct" });
    if (t.needsReference && !input.reference?.trim()) return fail(422, "VALIDATION", `Enter the ${t.referenceLabel?.toLowerCase() ?? "reference"}.`, { field: "reference" });
    if (!input.heads?.length) return fail(422, "VALIDATION", "Choose at least one fee head.", { field: "heads" });
    const notEligible = input.heads.map((h) => feeHeadByCode(h)).find((h) => !h || !h.concessionEligible);
    if (notEligible !== undefined) return fail(422, "VALIDATION", `${notEligible?.title ?? "That head"} can't be reduced by a concession.`, { field: "heads" });
    const monthStart = `${DEMO_TODAY.slice(0, 7)}-01`;
    if (!input.validFrom || input.validFrom < monthStart) return fail(422, "VALIDATION", "A concession starts this month or later. Receipts already posted are never changed.", { field: "validFrom" });
    if (!input.validTo || input.validTo < input.validFrom) return fail(422, "VALIDATION", "The end date must be after the start date.", { field: "validTo" });
    if (input.validTo > SESSION_END(input.session)) return fail(422, "VALIDATION", `Concessions end with the session (${formatDate(SESSION_END(input.session))}). Renew it next session.`, { field: "validTo" });
    if ((input.reason ?? "").trim().length < 10) return fail(422, "VALIDATION", "Say why in a sentence; the principal reads this when deciding.", { field: "reason" });
    const clash = feeSetupStore.get().concessions.find((c) => c.grNo === s.grNo && c.type === input.type && (c.status === "PENDING" || c.status === "APPROVED") && c.validFrom <= input.validTo && input.validFrom <= c.validTo);
    if (clash) return fail(409, "DUPLICATE", `${s.name} already has a ${t.title.toLowerCase()} concession ${clash.status === "PENDING" ? "waiting for approval" : "for these dates"}.`);
    const at = demoNow();
    const rec: ConcessionRecord = {
      id: nextId("con"),
      campus: input.campus,
      session: input.session,
      grNo: s.grNo,
      type: input.type,
      pct: input.pct,
      heads: input.heads,
      validFrom: input.validFrom,
      validTo: input.validTo,
      ...(input.reference?.trim() ? { reference: input.reference.trim() } : {}),
      reason: input.reason.trim(),
      status: "PENDING",
      requestedBy: user.name,
      requestedAt: at,
      history: [
        audit(
          at,
          user.name,
          `Requested: ${t.title.toLowerCase()} ${input.pct}% on ${input.heads.map((h) => (feeHeadByCode(h)?.title ?? h).toLowerCase()).join(" and ")} from ${formatDate(input.validFrom)}`,
          input.reference?.trim() ? `${t.referenceLabel} ${input.reference.trim()}` : undefined,
        ),
      ],
    };
    feeSetupStore.set((st) => ({ ...st, concessions: [...st.concessions, rec] }));
    remember(key, rec.id);
    return HttpResponse.json(toConcession(rec), { status: 201 });
  }),

  http.post(`${BASE}/concessions/:id/decide`, async ({ request, params }) => {
    await latency();
    const c = feeSetupStore.get().concessions.find((x) => x.id === String(params.id));
    if (!c) return fail(404, "NOT_FOUND", "This concession is no longer on record.");
    const user = requireAny(["approvals.decide"], c.campus);
    if (user instanceof Response) return user;
    if (c.status !== "PENDING") return HttpResponse.json(toConcession(c));
    const { approve, note } = await body<{ approve: boolean; note: string }>(request);
    if (!approve && !note?.trim()) return fail(422, "VALIDATION", "Say why it is rejected; the office tells the family.", { field: "note" });
    const at = demoNow();
    const next: ConcessionRecord = {
      ...c,
      status: approve ? "APPROVED" : "REJECTED",
      decidedBy: user.name,
      decidedAt: at,
      ...(note?.trim() ? { decisionNote: note.trim() } : {}),
      history: [...c.history, audit(at, user.name, approve ? "Approved" : "Rejected", note?.trim() || undefined)],
    };
    feeSetupStore.set((st) => ({ ...st, concessions: st.concessions.map((x) => (x.id === c.id ? next : x)) }));
    const repriced = approve ? syncStudentConcessions(c.grNo) : 0;
    if (repriced > 0) {
      feeSetupStore.set((st) => ({ ...st, concessions: st.concessions.map((x) => (x.id === c.id ? { ...x, history: [...x.history, audit(at, "System", `${repriced} unpaid ${repriced === 1 ? "charge" : "charges"} re-priced`)] } : x)) }));
    }
    return HttpResponse.json(toConcession(feeSetupStore.get().concessions.find((x) => x.id === c.id)!));
  }),

  http.post(`${BASE}/concessions/:id/stop`, async ({ request, params }) => {
    await latency();
    const c = feeSetupStore.get().concessions.find((x) => x.id === String(params.id));
    if (!c) return fail(404, "NOT_FOUND", "This concession is no longer on record.");
    const user = requireAny(["fees.setup", "approvals.decide"], c.campus);
    if (user instanceof Response) return user;
    if (c.status !== "APPROVED") return fail(409, "NOT_ACTIVE", "Only an approved concession can be stopped.");
    const { reason, from } = await body<{ reason: string; from: IsoDate }>(request);
    if (!reason?.trim()) return fail(422, "VALIDATION", "Say why the concession stops.", { field: "reason" });
    if (!from || from < DEMO_TODAY) return fail(422, "VALIDATION", "A concession can stop from today or a later date.", { field: "from" });
    const at = demoNow();
    const validTo = addDays(from, -1);
    const next: ConcessionRecord = {
      ...c,
      status: from <= DEMO_TODAY || validTo < c.validFrom ? "STOPPED" : "APPROVED",
      validTo: validTo < c.validFrom ? c.validFrom : validTo,
      history: [...c.history, audit(at, user.name, `Stopped from ${formatDate(from)}`, reason.trim())],
    };
    feeSetupStore.set((st) => ({ ...st, concessions: st.concessions.map((x) => (x.id === c.id ? next : x)) }));
    syncStudentConcessions(c.grNo);
    return HttpResponse.json(toConcession(next));
  }),

  http.get(`${BASE}/reports/concessions`, async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requireAny(["fees.view", "fees.reports"], ctx.campus);
    if (user instanceof Response) return user;
    syncConcessions();
    const sp = url.searchParams;
    const from = sp.get("from") || SESSION_START(ctx.session);
    const to = sp.get("to") || SESSION_END(ctx.session);
    if (from > to) return fail(422, "VALIDATION", "The start date must be on or before the end date.", { field: "from" });
    if (from < SESSION_START(ctx.session) || to > SESSION_END(ctx.session)) return fail(422, "VALIDATION", `Choose dates inside ${formatSession(ctx.session)}.`, { field: "from" });
    const list = (k: string) => (sp.get(k) ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    return HttpResponse.json(feeConcessionSummary(ctx.campus, ctx.session, from, to, { heads: list("heads"), classes: list("classes"), section: sp.get("section") ?? "" }));
  }),

  /* ---------------- Vouchers */
  http.get(`${BASE}/vouchers`, async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requireAny(["fees.view"], ctx.campus);
    if (user instanceof Response) return user;
    syncConcessions();
    const sp = url.searchParams;
    const campuses = campusesIn(ctx.campus);
    const st = feeSetupStore.get();
    const runs = st.runs.filter((r) => campuses.includes(r.campus) && r.session === ctx.session).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
    const banks = new Map(campuses.map((c) => [c, bankFor(c)]));
    const all = Object.values(st.vouchers)
      .filter((v) => campuses.includes(v.campus) && v.session === ctx.session)
      .map((v) => toVoucher(v, banks.get(v.campus)));
    const month = sp.get("month") ?? "";
    const runId = sp.get("runId") ?? "";
    const cls = sp.get("classShort") ?? "";
    const status = sp.get("status") ?? "";
    const q = (sp.get("q") ?? "").trim().toLowerCase();
    const filtered = all
      .filter((v) => !runId || v.runId === runId)
      .filter((v) => !month || v.month === month)
      .filter((v) => !cls || classOf(v.classSection) === cls || v.classSection === cls)
      .filter((v) => !status || v.status === status)
      .filter((v) => !q || v.studentName.toLowerCase().includes(q) || v.grNo.toLowerCase().includes(q) || v.voucherNo.toLowerCase().includes(q) || v.father.toLowerCase().includes(q))
      .sort((a, b) => b.month.localeCompare(a.month) || a.classSection.localeCompare(b.classSection, "en", { numeric: true }) || a.studentName.localeCompare(b.studentName));
    const page = Math.max(1, Number(sp.get("page") ?? 1));
    const pageSize = 25;
    const scoped = all.filter((v) => !month || v.month === month);
    const live2 = scoped.filter((v) => v.status !== "CANCELLED");
    const data: FeeVoucherList = {
      campus: ctx.campus,
      session: ctx.session,
      runs: runs.map(toRun),
      months: [...new Set(all.map((v) => v.month))].sort().reverse(),
      vouchers: filtered.slice((page - 1) * pageSize, page * pageSize),
      total: filtered.length,
      page,
      pageSize,
      summary: {
        issued: live2.length,
        payable: live2.reduce((a, v) => a + v.payableByDue, 0),
        paid: live2.filter((v) => v.status === "PAID").length,
        collected: live2.filter((v) => v.status === "PAID").reduce((a, v) => a + v.lines.reduce((x, l) => x + l.amount, 0), 0),
        overdue: live2.filter((v) => v.status === "OVERDUE").length,
        overdueAmount: live2.filter((v) => v.status === "OVERDUE").reduce((a, v) => a + v.payableByDue, 0),
      },
    };
    return HttpResponse.json(data);
  }),

  http.get(`${BASE}/vouchers/runs/:runId`, async ({ params }) => {
    await latency();
    const r = feeSetupStore.get().runs.find((x) => x.id === String(params.runId));
    if (!r) return fail(404, "NOT_FOUND", "This voucher run is no longer on record.");
    const user = requireAny(["fees.view"], r.campus);
    if (user instanceof Response) return user;
    const bank = bankFor(r.campus);
    const vouchers = r.voucherNos.map((no) => feeSetupStore.get().vouchers[no]).filter((v): v is VoucherRecord => Boolean(v)).map((v) => toVoucher(v, bank));
    return HttpResponse.json({ run: toRun(r), vouchers });
  }),

  http.get(`${BASE}/vouchers/:voucherNo`, async ({ params }) => {
    await latency();
    const v = feeSetupStore.get().vouchers[String(params.voucherNo).toUpperCase()];
    if (!v) return fail(404, "NOT_FOUND", "No voucher with this number. Check the number printed at the top of the voucher.");
    const user = requireAny(["fees.view"], v.campus);
    if (user instanceof Response) return user;
    return HttpResponse.json(toVoucher(v));
  }),

  http.post(`${BASE}/vouchers/preview`, async ({ request }) => {
    await latency();
    const req = await body<FeeVoucherRequest>(request);
    const user = requireAny(["fees.collect", "fees.setup"], req.campus);
    if (user instanceof Response) return user;
    const ro = readOnly(req.session);
    if (ro) return ro;
    const bad = validateVoucherRequest(req);
    if (bad) return bad;
    syncConcessions();
    return HttpResponse.json(preview(req));
  }),

  http.post(`${BASE}/vouchers/generate`, async ({ request }) => {
    await latency();
    const req = await body<FeeVoucherRequest>(request);
    const user = requireAny(["fees.collect", "fees.setup"], req.campus);
    if (user instanceof Response) return user;
    const ro = readOnly(req.session);
    if (ro) return ro;
    const key = request.headers.get("Idempotency-Key");
    if (!key) return fail(400, "IDEMPOTENCY_KEY_REQUIRED", "Missing idempotency key.");
    const done = feeSetupStore.get().idem[key];
    const doneRun = done ? feeSetupStore.get().runs.find((r) => r.id === done) : undefined;
    if (doneRun) return HttpResponse.json({ run: toRun(doneRun), vouchers: doneRun.voucherNos.map((no) => toVoucher(feeSetupStore.get().vouchers[no]!)) });
    const bad = validateVoucherRequest(req);
    if (bad) return bad;
    if (!structureRecord(req.campus, req.session)) return fail(409, "NO_STRUCTURE", `Set up the ${formatSession(req.session)} fee structure for ${campusName(req.campus)} first.`);
    syncConcessions();
    const plans = studentsFor(req)
      .map((s) => planStudent(s, req))
      .filter((p) => !p.skip);
    if (plans.length === 0) return fail(422, "NOTHING_TO_GENERATE", "Every student in this choice already has a voucher for the month or has nothing to pay.");
    const prefix = campusOf(req.campus).docPrefix;
    let n = feeSetupStore.get().voucherSeq[req.campus] ?? 0;
    const at = demoNow();
    const runId = nextId(`run-${req.campus.toLowerCase()}-${req.month}`);
    const records: VoucherRecord[] = plans.map((p) => {
      n += 1;
      return { voucherNo: `${prefix}-FV-2627-${String(n).padStart(6, "0")}`, runId, campus: req.campus, session: req.session, month: req.month, grNo: p.student.grNo, issueDate: DEMO_TODAY, dueDate: req.dueDate, validUntil: req.validUntil, lines: p.lines, printCount: 0 };
    });
    // Raise the month's charges on each student's ledger.
    feesStore.set((fs) => {
      const charges = { ...fs.charges };
      for (const p of plans) {
        if (p.newCharges.length === 0) continue;
        charges[p.student.grNo] = [...(charges[p.student.grNo] ?? []), ...p.newCharges];
      }
      return { ...fs, charges };
    });
    const run: RunRecord = { id: runId, campus: req.campus, session: req.session, month: req.month, scope: scopeLabel(req.classes), dueDate: req.dueDate, generatedBy: user.name, generatedAt: at, voucherNos: records.map((r) => r.voucherNo) };
    feeSetupStore.set((s) => ({
      ...s,
      runs: [...s.runs, run],
      vouchers: { ...s.vouchers, ...Object.fromEntries(records.map((r) => [r.voucherNo, r])) },
      voucherSeq: { ...s.voucherSeq, [req.campus]: n },
      repriced: { ...s.repriced, ...Object.assign({}, ...plans.map((p) => p.repriced)) },
      idem: { ...s.idem, [key]: runId },
    }));
    const bank = bankFor(req.campus);
    return HttpResponse.json({ run: toRun(run), vouchers: records.map((r) => toVoucher(r, bank)) }, { status: 201 });
  }),

  http.post(`${BASE}/vouchers/print`, async ({ request }) => {
    await latency();
    const { voucherNos } = await body<{ voucherNos: string[] }>(request);
    const st = feeSetupStore.get();
    let printed = 0;
    const vouchers = { ...st.vouchers };
    for (const no of voucherNos ?? []) {
      const v = vouchers[no];
      if (!v) continue;
      vouchers[no] = { ...v, printCount: v.printCount + 1 };
      printed += 1;
    }
    feeSetupStore.set((s) => ({ ...s, vouchers }));
    return HttpResponse.json({ printed });
  }),

  http.post(`${BASE}/vouchers/:voucherNo/cancel`, async ({ request, params }) => {
    await latency();
    const no = String(params.voucherNo);
    const v = feeSetupStore.get().vouchers[no];
    if (!v) return fail(404, "NOT_FOUND", "No voucher with this number.");
    const user = requireAny(["fees.collect", "fees.setup"], v.campus);
    if (user instanceof Response) return user;
    const ro = readOnly(v.session);
    if (ro) return ro;
    if (v.cancelled) return HttpResponse.json(toVoucher(v));
    const { status } = voucherStatus(v);
    if (status === "PAID" || status === "PART_PAID") return fail(409, "PAID", "Money has been received against this voucher, so it can't be cancelled. Cancel the receipt instead if it was posted by mistake.");
    const { reason } = await body<{ reason: string }>(request);
    if (!reason?.trim()) return fail(422, "VALIDATION", "Say why the voucher is cancelled.", { field: "reason" });
    const next = { ...v, cancelled: { reason: reason.trim(), by: user.name, at: demoNow() } };
    feeSetupStore.set((s) => ({ ...s, vouchers: { ...s.vouchers, [no]: next } }));
    return HttpResponse.json(toVoucher(next));
  }),

  /* ---------------- Fines */
  http.get(`${BASE}/fines`, async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requireAny(["fees.view"], ctx.campus);
    if (user instanceof Response) return user;
    const campuses = campusesIn(ctx.campus);
    const st = feeSetupStore.get();
    const data: FeeFinesData = {
      campus: ctx.campus,
      session: ctx.session,
      today: DEMO_TODAY,
      rules: campuses.map(toRule),
      waivers: st.waivers.filter((w) => campuses.includes(w.campus)).sort((a, b) => (a.status === "PENDING" ? 0 : 1) - (b.status === "PENDING" ? 0 : 1) || b.requestedAt.localeCompare(a.requestedAt)),
      fines: st.fines.filter((f) => campuses.includes(f.campus)).sort((a, b) => (a.status === "PENDING" ? 0 : 1) - (b.status === "PENDING" ? 0 : 1) || b.raisedAt.localeCompare(a.raisedAt)),
      defaults: FINE_DEFAULTS,
    };
    return HttpResponse.json(data);
  }),

  http.put(`${BASE}/fines/rules/:campus`, async ({ request, params }) => {
    await latency();
    const campus = String(params.campus) as CampusCode;
    const user = requireAny(["fees.setup"], campus);
    if (user instanceof Response) return user;
    const input = await body<FeeFineRuleInput>(request);
    if (!Number.isSafeInteger(input.ratePerDay) || input.ratePerDay < 1 || input.ratePerDay > 500) return fail(422, "VALIDATION", "Enter a fine from Rs 1 to Rs 500 a day.", { field: "ratePerDay" });
    if (!Number.isInteger(input.graceDays) || input.graceDays < 0 || input.graceDays > 30) return fail(422, "VALIDATION", "Grace days are a whole number from 0 to 30.", { field: "graceDays" });
    if (input.maxFine !== null && (!Number.isSafeInteger(input.maxFine) || input.maxFine < input.ratePerDay)) return fail(422, "VALIDATION", "The maximum must be at least one day's fine, or leave it empty for no maximum.", { field: "maxFine" });
    if (!input.effectiveFrom || input.effectiveFrom < DEMO_TODAY) return fail(422, "VALIDATION", "A new rule starts today or later. Fines on receipts already posted never change.", { field: "effectiveFrom" });
    const at = demoNow();
    const core: RuleCore = { ratePerDay: input.ratePerDay, graceDays: input.graceDays, maxFine: input.maxFine, appliesTo: input.appliesTo === "TUITION" ? "TUITION" : "ALL", effectiveFrom: input.effectiveFrom, updatedBy: user.name, updatedAt: at };
    const r = feeSetupStore.get().rules[campus];
    const now = input.effectiveFrom <= DEMO_TODAY;
    const text = ruleText(core);
    const next: RuleRecord = now
      ? { ...core, history: [...r.history, audit(at, user.name, `Rule changed from ${formatDate(input.effectiveFrom)}`, text)] }
      : { ...r, upcoming: core, history: [...r.history, audit(at, user.name, `Change saved: starts ${formatDate(input.effectiveFrom)}`, text)] };
    if (now) delete next.upcoming;
    feeSetupStore.set((s) => ({ ...s, rules: { ...s.rules, [campus]: next } }));
    return HttpResponse.json(toRule(campus));
  }),

  http.post(`${BASE}/fines/waivers`, async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const single = singleCampus(ctx.campus);
    if (single) return single;
    const campus = ctx.campus as CampusCode;
    const user = requireAny(["fees.collect", "fees.setup", "fees.cancel.request"], campus);
    if (user instanceof Response) return user;
    const ro = readOnly(ctx.session);
    if (ro) return ro;
    const key = request.headers.get("Idempotency-Key");
    const done = key ? feeSetupStore.get().idem[key] : undefined;
    const prior = done ? feeSetupStore.get().waivers.find((w) => w.id === done) : undefined;
    if (prior) return HttpResponse.json(prior);
    const input = await body<FeeWaiverInput>(request);
    const s = findStudent(input.grNo ?? "");
    if (!s || s.campus !== campus) return fail(422, "VALIDATION", "Choose a student at this campus.", { field: "grNo" });
    const c = chargesOf(s.grNo).find((x) => x.id === input.chargeId);
    if (!c || c.status !== "OPEN") return fail(422, "VALIDATION", "Choose an unpaid charge.", { field: "chargeId" });
    if (feeSetupStore.get().waivers.some((w) => w.chargeId === c.id && w.status === "PENDING")) return fail(409, "DUPLICATE", "A request for this charge is already waiting for approval.");
    const fineToDate = campusFine(campus, c.head, c.dueDate, DEMO_TODAY);
    const rate = currentRule(campus).ratePerDay;
    if (input.kind === "WAIVE") {
      if (fineToDate <= 0) return fail(422, "VALIDATION", "This charge has no late fine yet. To give more time, ask for a later due date instead.", { field: "kind" });
      if (!Number.isSafeInteger(input.amount) || (input.amount ?? 0) <= 0 || (input.amount ?? 0) > fineToDate) return fail(422, "VALIDATION", `Enter an amount up to ${formatRs(fineToDate)}, the fine so far.`, { field: "amount" });
      if ((input.amount ?? 0) % rate !== 0) return fail(422, "VALIDATION", `Enter a multiple of ${formatRs(rate)}: the fine grows by ${formatRs(rate)} a day.`, { field: "amount" });
    } else {
      if (!input.newDueDate || input.newDueDate <= c.dueDate) return fail(422, "VALIDATION", `Choose a date after the current due date (${formatDate(c.dueDate)}).`, { field: "newDueDate" });
      if (input.newDueDate < DEMO_TODAY) return fail(422, "VALIDATION", "The new due date can't be in the past.", { field: "newDueDate" });
      if (input.newDueDate > addDays(DEMO_TODAY, 60)) return fail(422, "VALIDATION", "Give at most 60 days from today. For longer, set up a concession or speak to the principal.", { field: "newDueDate" });
    }
    if ((input.reason ?? "").trim().length < 10) return fail(422, "VALIDATION", "Say why in a sentence; the principal reads this when deciding.", { field: "reason" });
    const w: FeeWaiver = {
      id: nextId("wv"),
      campus,
      grNo: s.grNo,
      studentName: s.name,
      classSection: s.classSection,
      chargeId: c.id,
      chargeHead: c.head,
      chargeAmount: c.amount - c.settledAmount,
      dueDate: c.dueDate,
      kind: input.kind === "EXTEND" ? "EXTEND" : "WAIVE",
      fineToDate,
      ...(input.kind === "WAIVE" ? { amount: input.amount } : { newDueDate: input.newDueDate }),
      reason: input.reason.trim(),
      status: "PENDING",
      requestedBy: user.name,
      requestedAt: demoNow(),
    };
    feeSetupStore.set((st) => ({ ...st, waivers: [...st.waivers, w] }));
    remember(key, w.id);
    return HttpResponse.json(w, { status: 201 });
  }),

  http.post(`${BASE}/fines/waivers/:id/decide`, async ({ request, params }) => {
    await latency();
    const w = feeSetupStore.get().waivers.find((x) => x.id === String(params.id));
    if (!w) return fail(404, "NOT_FOUND", "This request is no longer on record.");
    const user = requireAny(["approvals.decide"], w.campus);
    if (user instanceof Response) return user;
    if (w.status !== "PENDING") return HttpResponse.json(w);
    const { approve, note } = await body<{ approve: boolean; note: string }>(request);
    if (!approve && !note?.trim()) return fail(422, "VALIDATION", "Say why it is rejected; the cashier tells the family.", { field: "note" });
    if (approve) {
      const c = chargesOf(w.grNo).find((x) => x.id === w.chargeId);
      if (!c || c.status !== "OPEN") return fail(409, "ALREADY_PAID", "This charge has been paid since the request was made, so there is nothing to waive. Reject the request instead.");
      const rate = currentRule(w.campus).ratePerDay;
      const newDue = w.kind === "EXTEND" ? w.newDueDate! : addDays(c.dueDate, Math.round((w.amount ?? 0) / rate));
      feesStore.set((fs) => ({ ...fs, charges: { ...fs.charges, [w.grNo]: (fs.charges[w.grNo] ?? []).map((x) => (x.id === c.id ? { ...x, dueDate: newDue } : x)) } }));
    }
    const next: FeeWaiver = { ...w, status: approve ? "APPROVED" : "REJECTED", decidedBy: user.name, decidedAt: demoNow(), ...(note?.trim() ? { decisionNote: note.trim() } : {}) };
    feeSetupStore.set((st) => ({ ...st, waivers: st.waivers.map((x) => (x.id === w.id ? next : x)) }));
    return HttpResponse.json(next);
  }),

  http.post(`${BASE}/fines/student/charge`, async ({ request }) => {
    await latency();
    const key = request.headers.get("Idempotency-Key");
    const { ids, dueDate } = await body<{ ids: string[]; dueDate?: IsoDate }>(request);
    const st = feeSetupStore.get();
    const picked = st.fines.filter((f) => (ids ?? []).includes(f.id) && f.status === "PENDING");
    if (key && st.idem[key]) return HttpResponse.json({ charged: 0, amount: 0 });
    if (picked.length === 0) return fail(422, "VALIDATION", "Choose at least one fine that is waiting to be charged.");
    for (const f of picked) {
      const user = requireAny(["fees.collect", "fees.setup"], f.campus);
      if (user instanceof Response) return user;
    }
    const due = dueDate || addDays(DEMO_TODAY, 7);
    if (due < DEMO_TODAY) return fail(422, "VALIDATION", "The due date can't be in the past.", { field: "dueDate" });
    if (due > SESSION_END(CURRENT_SESSION)) return fail(422, "VALIDATION", `Choose a due date inside ${formatSession(CURRENT_SESSION)}.`, { field: "dueDate" });
    const user = requireUser() as SessionUser;
    const at = demoNow();
    // Materialise each student's charges first (this may write the fees store), then add the fines.
    for (const f of picked) chargesOf(f.grNo);
    feesStore.set((fs) => {
      const charges = { ...fs.charges };
      for (const f of picked) {
        const short = f.reason.split(",")[0]?.split("·")[0]?.trim() ?? "";
        const head = `${FEE_STUDENT_FINE_LABEL[f.kind]} fine${f.kind === "EXAM_ABSENCE" && short ? ` – ${short}` : ""}`;
        const ch: Charge = { id: `${f.grNo}:fine-${f.id}`, grNo: f.grNo, session: CURRENT_SESSION, head, kind: "FEE", amount: f.amount, dueDate: due, status: "OPEN", settledAmount: 0 };
        charges[f.grNo] = [...(charges[f.grNo] ?? []).filter((c) => c.id !== ch.id), ch];
      }
      return { ...fs, charges };
    });
    feeSetupStore.set((s) => ({
      ...s,
      fines: s.fines.map((f) => (picked.some((p) => p.id === f.id) ? { ...f, status: "CHARGED", chargedAt: at, chargeId: `${f.grNo}:fine-${f.id}`, note: `Charged by ${user.name}; due ${formatDate(due)}` } : f)),
      ...(key ? { idem: { ...s.idem, [key]: "charged" } } : {}),
    }));
    return HttpResponse.json({ charged: picked.length, amount: picked.reduce((a, f) => a + f.amount, 0) });
  }),

  http.post(`${BASE}/fines/student/:id/waive`, async ({ request, params }) => {
    await latency();
    const f = feeSetupStore.get().fines.find((x) => x.id === String(params.id));
    if (!f) return fail(404, "NOT_FOUND", "This fine is no longer on record.");
    const user = requireAny(["approvals.decide", "fees.setup"], f.campus);
    if (user instanceof Response) return user;
    if (f.status !== "PENDING") return fail(409, "NOT_PENDING", f.status === "CHARGED" ? "This fine is already on the student's fees. Ask for a waiver from the fee counter instead." : "This fine was already waived.");
    const { note } = await body<{ note: string }>(request);
    if (!note?.trim()) return fail(422, "VALIDATION", "Say why the fine is waived.", { field: "note" });
    const next: FeeStudentFine = { ...f, status: "WAIVED", note: `${note.trim()} (${user.name})` };
    feeSetupStore.set((s) => ({ ...s, fines: s.fines.map((x) => (x.id === f.id ? next : x)) }));
    return HttpResponse.json(next);
  }),

  http.post(`${BASE}/fines/student`, async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const single = singleCampus(ctx.campus);
    if (single) return single;
    const campus = ctx.campus as CampusCode;
    const user = requireAny(["fees.collect", "fees.setup", "students.edit"], campus);
    if (user instanceof Response) return user;
    const ro = readOnly(ctx.session);
    if (ro) return ro;
    const key = request.headers.get("Idempotency-Key");
    const done = key ? feeSetupStore.get().idem[key] : undefined;
    const prior = done ? feeSetupStore.get().fines.find((f) => f.id === done) : undefined;
    if (prior) return HttpResponse.json(prior);
    const input = await body<FeeStudentFineInput>(request);
    const s = findStudent(input.grNo ?? "");
    if (!s || s.campus !== campus) return fail(422, "VALIDATION", "Choose a student at this campus.", { field: "grNo" });
    if (!FEE_STUDENT_FINE_LABEL[input.kind]) return fail(422, "VALIDATION", "Choose the kind of fine.", { field: "kind" });
    if (!Number.isSafeInteger(input.amount) || input.amount < 50 || input.amount > 10000) return fail(422, "VALIDATION", "Enter an amount from Rs 50 to Rs 10,000.", { field: "amount" });
    if ((input.reason ?? "").trim().length < 5) return fail(422, "VALIDATION", "Say what happened, in a few words.", { field: "reason" });
    const f: FeeStudentFine = { id: nextId("fn"), campus, grNo: s.grNo, studentName: s.name, classSection: s.classSection, kind: input.kind, reason: input.reason.trim(), amount: input.amount, raisedBy: user.name, raisedAt: demoNow(), status: "PENDING" };
    feeSetupStore.set((st) => ({ ...st, fines: [...st.fines, f] }));
    remember(key, f.id);
    return HttpResponse.json(f, { status: 201 });
  }),

  /* ---------------- Defaulters */
  http.get(`${BASE}/defaulters`, async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requireAny(["fees.reports"], ctx.campus);
    if (user instanceof Response) return user;
    syncConcessions();
    const sp = url.searchParams;
    const minMonths = Number(sp.get("minMonths") ?? 0);
    const minAmount = Number(sp.get("minAmount") ?? 0);
    const includeLeft = sp.get("includeLeft") === "true";
    const filter = defaulterFilter(sp);
    if (filter.dueFrom && filter.dueTo && filter.dueFrom > filter.dueTo) return fail(422, "VALIDATION", "The first due date must be on or before the second.", { field: "dueFrom" });
    const rows = defaulterRows(ctx.campus, ctx.session, includeLeft, filter).filter((r) => r.monthsOverdue >= minMonths && r.total >= minAmount);
    const tpl = liveTemplate("tpl-fee-overdue");
    const data: FeeDefaultersData = {
      campus: ctx.campus,
      session: ctx.session,
      today: DEMO_TODAY,
      rows,
      summary: { students: rows.length, outstanding: rows.reduce((a, r) => a + r.outstanding, 0), fine: rows.reduce((a, r) => a + r.fine, 0), threePlus: rows.filter((r) => r.monthsOverdue >= 3).length },
      heads: [...feeHeads().filter((h) => h.category === "FEE" && h.active).map((h) => ({ code: h.code, title: h.title })), { code: "FINE", title: "Student fines" }],
      smsPaused: smsStatusStore.get().paused,
      template: { en: tpl?.en ?? "", ur: tpl?.ur ?? "" },
    };
    return HttpResponse.json(data);
  }),

  http.get(`${BASE}/reports/class-arrears`, async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requireAny(["fees.reports"], ctx.campus);
    if (user instanceof Response) return user;
    syncConcessions();
    const filter = defaulterFilter(url.searchParams);
    if (filter.dueFrom && filter.dueTo && filter.dueFrom > filter.dueTo) return fail(422, "VALIDATION", "The first due date must be on or before the second.", { field: "dueFrom" });
    return HttpResponse.json(feeClassArrears(ctx.campus, ctx.session, filter));
  }),

  http.post(`${BASE}/defaulters/remind`, async ({ request }) => {
    await latency();
    const req = await body<FeeReminderRequest>(request);
    const user = requireAny(["sms.send"], req.campus);
    if (user instanceof Response) return user;
    const key = request.headers.get("Idempotency-Key");
    if (!key) return fail(400, "IDEMPOTENCY_KEY_REQUIRED", "Missing idempotency key.");
    if (feeSetupStore.get().idem[key]) return HttpResponse.json(JSON.parse(feeSetupStore.get().idem[key]!));
    if (smsStatusStore.get().paused) return fail(423, "SMS_PAUSED", "All SMS are paused by the admin, so nothing was sent. Ask an admin to resume SMS, then send again.");
    const ro = readOnly(req.session);
    if (ro) return ro;
    if (!req.grNos?.length) return fail(422, "VALIDATION", "Choose at least one student.");
    const rows = new Map(defaulterRows(req.campus, req.session, true).map((r) => [r.grNo, r]));
    const skipped: Array<{ grNo: string; name: string; reason: string }> = [];
    const at = demoNow();
    const sent: string[] = [];
    for (const gr of req.grNos) {
      const r = rows.get(gr);
      const s = findStudent(gr);
      if (!s || !r) {
        skipped.push({ grNo: gr, name: s?.name ?? gr, reason: "Nothing overdue now" });
        continue;
      }
      if (!s.guardian.mobile) {
        skipped.push({ grNo: gr, name: s.name, reason: "No mobile number on record" });
        continue;
      }
      sent.push(gr);
    }
    // The reminders go through Messages: outbox, delivery report, pause and opt-out rules. One send per campus.
    const custom = req.customText && (req.customText.en.trim() || req.customText.ur.trim()) ? req.customText : null;
    const byCampus = new Map<CampusCode, string[]>();
    for (const gr of sent) {
      const c = rows.get(gr)!.campus;
      byCampus.set(c, [...(byCampus.get(c) ?? []), gr]);
    }
    const batchIds: string[] = [];
    for (const [campus, grNos] of byCampus) {
      const queued = queueBatch(
        {
          campus,
          session: req.session,
          templateId: custom ? "custom" : "tpl-fee-overdue",
          language: req.language,
          audience: { kind: "STUDENTS", grNos, label: `Fee defaulters chosen in Fees → Defaulters (${grNos.length})`, amounts: Object.fromEntries(grNos.map((g) => [g, rows.get(g)!.total])), dueDates: Object.fromEntries(grNos.map((g) => [g, rows.get(g)!.oldestDue])) },
          channel: "SMS",
          title: custom ? "Fee reminder (own wording)" : "Fee overdue",
          source: "Fees",
          ...(custom ? { customText: { en: custom.en, ur: custom.ur, category: "FEE" as const } } : {}),
        },
        user,
      );
      if (queued instanceof Response) return queued;
      batchIds.push(queued.batchId);
    }
    feeSetupStore.set((st) => ({ ...st, reminders: { ...st.reminders, ...Object.fromEntries(sent.map((gr) => [gr, { at, count: (st.reminders[gr]?.count ?? 0) + 1 }])) } }));
    const result = { batchId: batchIds[0] ?? `fr-${Date.now().toString(36)}`, queued: sent.length, skipped };
    feeSetupStore.set((st) => ({ ...st, idem: { ...st.idem, [key]: JSON.stringify(result) } }));
    return HttpResponse.json(result, { status: 201 });
  }),

  /* ---------------- Candidate (test) fees */
  http.get(`${BASE}/candidates`, async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requireAny(["fees.view"], ctx.campus);
    if (user instanceof Response) return user;
    const campuses = campusesIn(ctx.campus);
    const rows: FeeCandidate[] = admissionsStore
      .get()
      .applicants.filter((a) => campuses.includes(a.campus) && a.session === ctx.session && a.fee && a.fee.amount > 0)
      .map(candidateRow)
      .sort((x, y) => (x.status === "DUE" ? 0 : 1) - (y.status === "DUE" ? 0 : 1) || (y.paidOn ?? y.appliedOn).localeCompare(x.paidOn ?? x.appliedOn));
    const paid = rows.filter((r) => r.status === "PAID");
    const due = rows.filter((r) => r.status === "DUE");
    const today = paid.filter((r) => r.paidOn === DEMO_TODAY);
    const data: FeeCandidatesData = {
      campus: ctx.campus,
      session: ctx.session,
      rows,
      summary: {
        paidToday: { count: today.length, amount: today.reduce((a, r) => a + r.received, 0) },
        paidSession: { count: paid.length, amount: paid.reduce((a, r) => a + r.received, 0) },
        due: { count: due.length, amount: due.reduce((a, r) => a + r.amount, 0) },
      },
      heads: candidateHeads(),
      cashiers: [...new Set([...campuses.flatMap((c) => CASHIERS[c]), ...paid.map((r) => r.receivedBy ?? "").filter(Boolean)])],
    };
    return HttpResponse.json(data);
  }),

  http.post(`${BASE}/candidates/:id/pay`, async ({ params, request }) => {
    await latency();
    const st = admissionsStore.get();
    const a = st.applicants.find((x) => x.id === String(params.id));
    if (!a || !a.fee) return fail(404, "NOT_FOUND", "This application is no longer on record.");
    const user = requireAny(["fees.collect"], a.campus);
    if (user instanceof Response) return user;
    const ro = readOnly(a.session);
    if (ro) return ro;
    if (a.fee.status !== "DUE") return HttpResponse.json(candidateRow(a));
    const input = await body<Partial<FeeCandidatePayRequest>>(request);
    const known = new Map(candidateHeads().map((h) => [h.code, h]));
    // An older client sends no body: the test fee in cash.
    const lines = input.lines?.length ? input.lines : [{ head: "CANDIDATE", amount: a.fee.amount, paid: a.fee.amount }];
    for (const l of lines) {
      if (!known.has(l.head)) return fail(422, "VALIDATION", "Choose a candidate fee head (test fee, prospectus or form fee).", { field: "lines" });
      if (!Number.isSafeInteger(l.amount) || l.amount < 0 || l.amount > 50000) return fail(422, "VALIDATION", `${known.get(l.head)!.title}: enter whole rupees up to Rs 50,000.`, { field: "lines" });
      if (!Number.isSafeInteger(l.paid) || l.paid < 0 || l.paid > l.amount) return fail(422, "VALIDATION", `${known.get(l.head)!.title}: the amount paid can't be more than the fee.`, { field: "lines" });
    }
    if (new Set(lines.map((l) => l.head)).size !== lines.length) return fail(422, "VALIDATION", "Each head once, please.", { field: "lines" });
    if (!lines.some((l) => l.head === "CANDIDATE")) return fail(422, "VALIDATION", "The test fee must be on the slip.", { field: "lines" });
    const received = lines.reduce((s, l) => s + l.paid, 0);
    if (received <= 0) return fail(422, "VALIDATION", "Enter the amount paid.", { field: "lines" });
    const payment = input.payment ?? { method: "CASH" as const };
    if (payment.method === "BANK") {
      if (!payment.challanNo?.trim()) return fail(422, "VALIDATION", "Enter the bank challan number.", { field: "challanNo" });
      if (!payment.date || payment.date > DEMO_TODAY) return fail(422, "VALIDATION", "Enter the day it was paid at the bank (today or earlier).", { field: "date" });
      if (payment.date < SESSION_START(a.session)) return fail(422, "VALIDATION", `Choose a date inside ${formatSession(a.session)}.`, { field: "date" });
    }
    const n = (st.feeSeq[a.campus] ?? 400) + 1;
    const receiptNo = `${a.campus}-CF-2627-${String(n).padStart(6, "0")}`;
    const paidOn = payment.method === "BANK" ? payment.date : DEMO_TODAY;
    const text = `Candidate fee Rs ${received.toLocaleString("en-US")} paid${payment.method === "BANK" ? ` at the bank (challan ${payment.challanNo.trim()})` : ""} · ${receiptNo}`;
    const next = {
      ...a,
      fee: {
        ...a.fee,
        amount: lines.reduce((s, l) => s + l.amount, 0),
        status: "PAID" as const,
        receiptNo,
        paidOn,
        lines: lines.map((l) => ({ head: l.head, amount: l.amount, paid: l.paid })),
        receivedBy: user.name,
        paymentMethod: payment.method,
        ...(payment.method === "BANK" ? { bankChallanNo: payment.challanNo.trim() } : {}),
        ...(input.paidBy?.trim() ? { paidBy: input.paidBy.trim() } : {}),
      },
      // Applicants with a recorded history get the payment added; the others rebuild it from the fee fields.
      ...(a.history?.length ? { history: [...a.history, { at: demoNow(), text, by: user.name }] } : {}),
    };
    admissionsStore.set((s) => ({ ...s, feeSeq: { ...s.feeSeq, [a.campus]: n }, applicants: s.applicants.map((x) => (x.id === a.id ? next : x)) }));
    return HttpResponse.json(candidateRow(next), { status: 201 });
  }),

  /* ---------------- Reports */
  http.get(`${BASE}/reports/collection`, async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requireAny(["fees.reports"], ctx.campus);
    if (user instanceof Response) return user;
    const sp = url.searchParams;
    const from = sp.get("from") ?? DEMO_TODAY;
    const to = sp.get("to") ?? from;
    if (from > to) return fail(422, "VALIDATION", "The start date must be on or before the end date.", { field: "from" });
    if (to > DEMO_TODAY) return fail(422, "VALIDATION", "The report runs up to today.", { field: "to" });
    if (from < "2025-04-01") return fail(422, "VALIDATION", "Reports start from 01-Apr-2025, when records moved to this system.", { field: "from" });
    if (daysBetween(from, to) > 92) return fail(422, "VALIDATION", "Choose at most three months at a time.", { field: "to" });
    const campuses = campusesIn(ctx.campus);
    const all: FeeCollectionRow[] = campuses.flatMap((c) => campusRows(c, from, to));
    const dayMap = new Map<IsoDate, { date: IsoDate; receipts: number; amount: number }>();
    for (let d = from; d <= to; d = addDays(d, 1)) if (weekday(d) !== 0) dayMap.set(d, { date: d, receipts: 0, amount: 0 });
    for (const r of all) {
      const d = dayMap.get(r.at.slice(0, 10));
      if (d) {
        d.receipts += 1;
        d.amount += r.amount;
      }
    }
    const cashier = sp.get("cashier") ?? "";
    const method = sp.get("method") ?? "";
    const head = sp.get("head") ?? "";
    const cls = sp.get("classShort") ?? "";
    const section = sp.get("section") ?? "";
    const gender = sp.get("gender") ?? "";
    const q = (sp.get("q") ?? "").trim().toLowerCase();
    const filtered = all
      .filter((r) => !cashier || r.cashier === cashier)
      .filter((r) => !method || r.method === method)
      .filter((r) => !head || r.lines.some((l) => l.head === head && l.amount > 0))
      .filter((r) => !cls || classOf(r.classSection) === cls)
      .filter((r) => !section || r.classSection.split("-")[1] === section)
      .filter((r) => !gender || r.gender === gender)
      .filter((r) => !q || r.receiptNo.toLowerCase().includes(q) || r.studentName.toLowerCase().includes(q) || r.grNo.toLowerCase().includes(q))
      .sort((a, b) => b.at.localeCompare(a.at));
    const order = new Map(feeHeads().map((h, i) => [h.code, i]));
    const seen = new Map<string, string>();
    for (const r of all) for (const l of r.lines) if (l.amount > 0 && !seen.has(l.head)) seen.set(l.head, l.headTitle);
    const headList = [...seen.entries()]
      .sort(([a], [b]) => (order.get(a) ?? 99) - (order.get(b) ?? 99))
      .map(([code, title]) => ({ code, title, short: feeHeadByCode(code)?.shortTitle ?? title }));
    const page = Math.max(1, Number(sp.get("page") ?? 1));
    const pageSize = Math.min(2000, Math.max(10, Number(sp.get("pageSize") ?? 50)));
    const store = Object.values(feesStore.get().receipts).filter((r) => campuses.includes(r.campus));
    const cancelled = store.filter((r) => r.status === "CANCELLED" && r.cancellation?.decidedAt && r.cancellation.decidedAt.slice(0, 10) >= from && r.cancellation.decidedAt.slice(0, 10) <= to);
    const closings = feeSetupStore.get().closings.filter((c) => campuses.includes(c.campus) && c.date >= from && c.date <= to);
    const data: FeeCollectionReport = {
      campus: ctx.campus,
      from,
      to,
      days: [...dayMap.values()],
      total: { receipts: all.length, amount: all.reduce((a, r) => a + r.amount, 0), fine: all.reduce((a, r) => a + r.fine, 0) },
      byCashier: group(all, (r) => r.cashier, (k) => k),
      byMethod: group(all, (r) => r.method, (k) => PAYMENT_METHOD_LABEL[k as keyof typeof PAYMENT_METHOD_LABEL] ?? k),
      byHead: byHeadGroups(all),
      byCampus: group(all, (r) => r.campus, (k) => campusName(k as CampusCode)),
      byClass: group(all, (r) => classOf(r.classSection), (k) => classNameOf(k)).sort((a, b) => CLASS_SHORTS.indexOf(a.key) - CLASS_SHORTS.indexOf(b.key)),
      cancelled: {
        count: cancelled.length,
        amount: cancelled.reduce((a, r) => a + r.total, 0),
        items: cancelled.map((r) => ({
          receiptNo: r.receiptNo,
          cnNo: r.cancellation!.cnNo,
          studentName: r.studentName,
          grNo: r.grNo,
          classSection: r.classSection,
          amount: r.total,
          reason: r.cancellation!.note,
          approvedBy: r.cancellation!.decidedBy ?? "",
          at: r.cancellation!.decidedAt!,
          paidOn: r.postedAt.slice(0, 10),
          cashier: r.cashier,
          heads: r.lines.map((l) => l.head).join(", "),
        })),
      },
      heads: headList,
      ...(head ? { headAmount: filtered.reduce((a, r) => a + r.lines.filter((l) => l.head === head).reduce((x, l) => x + l.amount, 0), 0) } : {}),
      pendingCancellations: store.filter((r) => r.status === "CANCEL_PENDING").length,
      ...(from === DEMO_TODAY && to === DEMO_TODAY
        ? {
            dashboardToday: campuses.reduce(
              (a, c) => {
                const f = figuresFor(c, feesStore.get().postedToday[c]);
                return { amount: a.amount + f.today.amount, receipts: a.receipts + f.today.receipts };
              },
              { amount: 0, receipts: 0 },
            ),
          }
        : {}),
      rows: filtered.slice((page - 1) * pageSize, page * pageSize),
      rowsTotal: filtered.length,
      rowsAmount: filtered.reduce((a, r) => a + r.amount, 0),
      page,
      pageSize,
      cashiers: [...new Set([...campuses.flatMap((c) => CASHIERS[c]), ...all.map((r) => r.cashier)])],
      closings,
    };
    return HttpResponse.json(data);
  }),

  http.post(`${BASE}/reports/closings`, async ({ request }) => {
    await latency();
    const input = await body<FeeCashClosingInput>(request);
    const user = requireAny(["fees.collect"], input.campus);
    if (user instanceof Response) return user;
    const key = request.headers.get("Idempotency-Key");
    const done = key ? feeSetupStore.get().idem[key] : undefined;
    const prior = done ? feeSetupStore.get().closings.find((c) => c.id === done) : undefined;
    if (prior) return HttpResponse.json(prior);
    if (input.date !== DEMO_TODAY) return fail(422, "VALIDATION", "Only today's cash can be closed.", { field: "date" });
    if (!Number.isSafeInteger(input.counted) || input.counted < 0) return fail(422, "VALIDATION", "Enter the cash you counted, in whole rupees.", { field: "counted" });
    const already = feeSetupStore.get().closings.find((c) => c.campus === input.campus && c.date === input.date && c.cashier === user.name);
    if (already) return fail(409, "ALREADY_CLOSED", `You closed today's cash at ${already.closedAt.slice(11, 16)}. Ask the accountant if it needs reopening.`);
    const expected = campusRows(input.campus, input.date, input.date)
      .filter((r) => r.cashier === user.name && r.method === "CASH" && r.status !== "CANCELLED")
      .reduce((a, r) => a + r.amount, 0);
    const difference = input.counted - expected;
    if (difference !== 0 && !input.note?.trim()) return fail(422, "VALIDATION", `The cash is ${difference < 0 ? "short" : "over"} by ${formatRs(Math.abs(difference))}. Say why before closing.`, { field: "note" });
    const closing: FeeCashClosing = { id: nextId("cl"), campus: input.campus, date: input.date, cashier: user.name, expected, counted: input.counted, difference, ...(input.note?.trim() ? { note: input.note.trim() } : {}), closedAt: demoNow() };
    feeSetupStore.set((s) => ({ ...s, closings: [...s.closings, closing] }));
    remember(key, closing.id);
    return HttpResponse.json(closing, { status: 201 });
  }),

  http.get(`${BASE}/reports/monthly`, async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requireAny(["fees.reports"], ctx.campus);
    if (user instanceof Response) return user;
    const campuses = campusesIn(ctx.campus);
    const current = DEMO_TODAY.slice(0, 7);
    const months = sessionMonths(ctx.session).filter((m) => m <= current);
    const figs = new Map(campuses.map((c) => [c, figuresFor(c, feesStore.get().postedToday[c])]));
    const rows = months.map((m) => {
      let target = 0;
      let collected = 0;
      let receipts = 0;
      for (const c of campuses) {
        target += monthTarget(c, m);
        const f = monthFigure(c, m, figs.get(c)!);
        collected += f.amount;
        receipts += f.receipts;
      }
      return { month: m, target, collected, receipts, current: m === current };
    });
    const last = months.at(-1) ?? current;
    const data: FeeMonthlyReport = {
      campus: ctx.campus,
      session: ctx.session,
      months: rows,
      total: { target: rows.reduce((a, r) => a + r.target, 0), collected: rows.reduce((a, r) => a + r.collected, 0) },
      byCampus: campuses.map((c) => ({ campus: c, name: campusName(c), target: monthTarget(c, last), collected: monthFigure(c, last, figs.get(c)!).amount })),
    };
    return HttpResponse.json(data);
  }),
];
