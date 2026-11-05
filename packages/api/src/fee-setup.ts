// Fee office: fee heads and structure, installment plans, concessions, bank vouchers, late-fine rules and
// waivers, student fines, defaulters and reminders, candidate (test) fees, and the fee reports.
// The counter, receipts and the student ledger live in fees.ts. Every export here starts with "fee" / "Fee"
// so `export *` in index.ts never collides with another module.
import type { IsoDate, IsoDateTime, Rupees } from "@mtb/domain";
import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { ctxKey, ctxQuery, type CampusCode, type CampusScope, type Ctx } from "./context";
import type { PaymentMethod, Receipt } from "./fees";

/* ================================================================== Shared */

/** One line in an audit trail: who did what, when. */
export interface FeeAuditEntry {
  id: string;
  at: IsoDateTime;
  by: string;
  text: string;
  /** "Rs 8,000 → Rs 8,500" */
  detail?: string;
}

/** A student in a picker. */
export interface FeeStudentOption {
  grNo: string;
  name: string;
  classSection: string;
  father: string;
  campus: CampusCode;
}

/** "2026-12" → "Dec 2026" */
export function feeMonthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[(m ?? 1) - 1] ?? ""} ${y ?? ""}`;
}

/** "2026-12" → "December 2026" */
export function feeMonthLongLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${names[(m ?? 1) - 1] ?? ""} ${y ?? ""}`;
}

/* ================================================================== Fee heads and structure */

export type FeeHeadCategory = "FEE" | "FINE" | "APPLICATION";

/** How often a head is billed. */
export type FeeBilling = "MONTHLY" | "QUARTERLY" | "TERMLY" | "ANNUAL" | "ON_ADMISSION" | "ON_APPLICATION" | "WHEN_RAISED";

export const FEE_BILLING_LABEL: Record<FeeBilling, string> = {
  MONTHLY: "Every month",
  QUARTERLY: "Every quarter",
  TERMLY: "Each term",
  ANNUAL: "Once a year",
  ON_ADMISSION: "On admission",
  ON_APPLICATION: "With the application",
  WHEN_RAISED: "When raised",
};

export interface FeeHead {
  /** "TUITION" */
  code: string;
  title: string;
  titleUr: string;
  /** Printed where space is short (vouchers, report columns): "Tuition", "Gym adm." */
  shortTitle: string;
  category: FeeHeadCategory;
  billing: FeeBilling;
  /** Concessions and scholarships can reduce it. */
  concessionEligible: boolean;
  /** The late fine runs on it once it is overdue. */
  lateFine: boolean;
  /** Amount set elsewhere: transport by route, candidate fee by admissions. */
  linked?: "TRANSPORT";
  /** Classes it applies to; omitted = every class. */
  classes?: string[];
  order: number;
  active: boolean;
  /** One line for staff: what it is for. */
  note: string;
  /** Built in (tuition, annual charges …): can be renamed but not deactivated. */
  system?: boolean;
  /** Unpaid charges on students' ledgers under this head (a head in use can't be deactivated). */
  openCharges?: number;
  rowVer?: number;
}

/** Add or change a fee head. Heads are one list for every campus. */
export interface FeeHeadInput {
  title: string;
  titleUr: string;
  shortTitle: string;
  category: FeeHeadCategory;
  billing: FeeBilling;
  order: number;
  concessionEligible: boolean;
  lateFine: boolean;
  /** Empty = every class. */
  classes: string[];
  active: boolean;
  note: string;
  /** Required when changing a head. */
  rowVer?: number;
}

export interface FeeInstallment {
  no: number;
  /** "Dec 2026", "Term 1" */
  label: string;
  dueDate: IsoDate;
}

/** When each installment falls due in a session at a campus. */
export interface FeeInstallmentPlan {
  code: Extract<FeeBilling, "MONTHLY" | "QUARTERLY" | "TERMLY" | "ANNUAL">;
  title: string;
  count: number;
  installments: FeeInstallment[];
  /** Heads billed on this plan. */
  heads: string[];
}

export interface FeeStructureLine {
  head: string;
  /** Per installment (per month for tuition). 0 = not charged for this class. */
  amount: Rupees;
  /** Off: kept on record but not billed this session. Default on. */
  active?: boolean;
  /** Annual and one-off heads only: split into 1, 2, 4 or 12 parts (default: the head's own plan). */
  installments?: number;
}

/** A different amount for one section of a class (for example a science section's lab fee). */
export interface FeeSectionOverride {
  /** "B" */
  section: string;
  head: string;
  amount: Rupees;
}

export interface FeeClassStructure {
  /** "Prep", "1" … "10" */
  classShort: string;
  className: string;
  /** Sections of the class at this campus ("A", "B" …). */
  sections: string[];
  lines: FeeStructureLine[];
  sectionOverrides: FeeSectionOverride[];
  /** Tuition per month. */
  monthly: Rupees;
  /** Everything a student pays in the session (before concessions, transport excluded). */
  yearTotal: Rupees;
  updatedAt: IsoDateTime;
  updatedBy: string;
}

export interface FeeStructure {
  campus: CampusCode;
  campusName: string;
  session: number;
  /** NOT_SET: nothing entered for this session yet (copy from last session). */
  status: "SET" | "NOT_SET";
  heads: FeeHead[];
  classes: FeeClassStructure[];
  plans: FeeInstallmentPlan[];
  /** Transport is charged by route; the range shows what families pay. */
  transport: { routes: number; from: Rupees; to: Rupees };
  /** The previous session has a structure to copy from. */
  canCopyFrom: number | null;
  history: FeeAuditEntry[];
  rowVer: number;
}

/** Tuition per class across campuses (head office view). */
export interface FeeStructureComparison {
  session: number;
  campuses: Array<{ campus: CampusCode; name: string; status: "SET" | "NOT_SET" }>;
  rows: Array<{ classShort: string; className: string; monthly: Partial<Record<CampusCode, Rupees>>; yearTotal: Partial<Record<CampusCode, Rupees>> }>;
}

export interface FeeClassStructureInput {
  /** Any fee head code; a head left out keeps its amount. */
  lines: FeeStructureLine[];
  /** Replaces the class's section amounts when sent. */
  sectionOverrides?: FeeSectionOverride[];
  rowVer: number;
}

export interface FeeCopyRequest {
  campus: CampusCode;
  fromSession: number;
  toSession: number;
  /** Whole percent, 0–25. */
  increasePct: number;
  /** New amounts are rounded to the nearest 50, 100 or 500 rupees. */
  roundTo: 50 | 100 | 500;
}

export interface FeeCopyPreview {
  rows: Array<{ classShort: string; className: string; head: string; headTitle: string; from: Rupees; to: Rupees }>;
  /** Session total for one student per class, before → after. */
  classes: Array<{ classShort: string; className: string; from: Rupees; to: Rupees }>;
}

export interface FeeDueDateInput {
  plan: FeeInstallmentPlan["code"];
  no: number;
  dueDate: IsoDate;
  /** Only this class ("7"); omitted = the whole campus (and the plan's date changes). */
  classShort?: string;
  /** Only this section of the class ("B"). Needs classShort. */
  section?: string;
  /** Only this fee head (one of the plan's heads); omitted = every head on the plan. */
  head?: string;
}

export interface FeeDueDateResult {
  plan: FeeInstallmentPlan;
  /** Unpaid charges and vouchers moved to the new date. */
  chargesMoved: number;
  vouchersMoved: number;
}

/* ================================================================== Concessions */

export type FeeConcessionType =
  | "SIBLING"
  | "STAFF_CHILD"
  | "TEACHER_CHILD"
  | "SCHOLARSHIP"
  | "TALENT"
  | "ARMED_FORCES"
  | "GOVT_SERVANT"
  | "ORPHAN"
  | "PERIPHERY"
  | "KINSHIP"
  | "HARDSHIP"
  | "SPECIAL";

export interface FeeConcessionTypeInfo {
  code: FeeConcessionType;
  title: string;
  description: string;
  /** Suggested percentage; staff may change it within the limit. */
  defaultPct: number;
  maxPct: number;
  /** A scholarship award or staff number must be quoted. */
  needsReference: boolean;
  referenceLabel?: string;
}

export type FeeConcessionStatus = "PENDING" | "APPROVED" | "REJECTED" | "STOPPED";

export interface FeeConcession {
  id: string;
  campus: CampusCode;
  campusName: string;
  session: number;
  grNo: string;
  studentName: string;
  classSection: string;
  father: string;
  type: FeeConcessionType;
  pct: number;
  /** Head codes it reduces (tuition by default). */
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
  /** Worked example on the monthly tuition, with the same rounding every time. */
  example: { head: string; gross: Rupees; concession: Rupees; net: Rupees };
  /** Rupees off each month while it runs. */
  monthlyValue: Rupees;
  /** The session's fee for the class (before concessions, transport excluded). */
  sessionFee: Rupees;
  /** Rupees off over the whole session, every head it covers. */
  sessionValue: Rupees;
  /** Off by head over the session: [{ head: "TUITION", title, amount }]. */
  byHead: Array<{ head: string; title: string; amount: Rupees }>;
  /** Unpaid charges already re-priced by this concession. */
  repriced: number;
  history: FeeAuditEntry[];
}

/** A child the rules say qualifies but who has no concession yet. */
export interface FeeConcessionSuggestion {
  grNo: string;
  studentName: string;
  classSection: string;
  father: string;
  type: FeeConcessionType;
  pct: number;
  reason: string;
}

export interface FeeConcessionsData {
  campus: CampusScope;
  session: number;
  types: FeeConcessionTypeInfo[];
  /** Heads a concession can reduce (tuition, annual charges …), in order. */
  heads: Array<{ code: string; title: string }>;
  concessions: FeeConcession[];
  suggestions: FeeConcessionSuggestion[];
  summary: { active: number; pending: number; monthlyValue: Rupees; byType: Array<{ type: FeeConcessionType; count: number; monthlyValue: Rupees }> };
}

export interface FeeConcessionInput {
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
}

/** Concessions and discounts added up by class for a period (Class Wise Discount, Annual Fee Concession). */
export interface FeeConcessionSummaryQuery {
  from: IsoDate;
  to: IsoDate;
  /** Comma-separated head codes; empty = every head a concession can reduce. */
  heads?: string;
  /** Comma-separated class shorts; empty = every class. */
  classes?: string;
  section?: string;
}

export interface FeeConcessionClassRow {
  classShort: string;
  className: string;
  /** Students enrolled in the class (class strength). */
  strength: number;
  /** Students with a concession running in the period. */
  students: number;
  /** Fees billed for the period before concessions (chosen heads). */
  billed: Rupees;
  discount: Rupees;
  remaining: Rupees;
  /** Discount as a share of billed, one decimal. */
  pct: number;
}

export interface FeeConcessionStudentRow {
  grNo: string;
  studentName: string;
  father: string;
  classSection: string;
  type: FeeConcessionType;
  pct: number;
  reference?: string;
  /** Fees for the period before the concession (chosen heads). */
  sessionFee: Rupees;
  concession: Rupees;
  payable: Rupees;
  /** Discount by head for the period. */
  byHead: Record<string, Rupees>;
}

export interface FeeConcessionSummary {
  campus: CampusScope;
  session: number;
  from: IsoDate;
  to: IsoDate;
  heads: Array<{ code: string; title: string }>;
  byClass: FeeConcessionClassRow[];
  totals: Omit<FeeConcessionClassRow, "classShort" | "className">;
  /** Class × kind: how many students have each kind of concession. */
  byClassKind: {
    kinds: FeeConcessionType[];
    rows: Array<{ classShort: string; className: string; strength: number; counts: Partial<Record<FeeConcessionType, number>>; total: number; pct: number }>;
    totals: { strength: number; counts: Partial<Record<FeeConcessionType, number>>; total: number; pct: number };
  };
  students: FeeConcessionStudentRow[];
}

/* ================================================================== Bank vouchers */

export type FeeVoucherStatus = "ISSUED" | "PART_PAID" | "PAID" | "OVERDUE" | "CANCELLED";

export const FEE_VOUCHER_STATUS_LABEL: Record<FeeVoucherStatus, string> = {
  ISSUED: "Issued",
  PART_PAID: "Part paid",
  PAID: "Paid",
  OVERDUE: "Overdue",
  CANCELLED: "Cancelled",
};

export interface FeeBankDetails {
  /** Printed above the bank details: "MTB Khalid Campus, Sadiqabad". */
  title: string;
  bankName: string;
  accountTitle: string;
  accountNo: string;
  /** "Bank copy", "School copy", "Parent copy" */
  copyLabels: string[];
}

export interface FeeVoucherLine {
  chargeId: string;
  head: string;
  dueDate: IsoDate;
  /** Still to pay on this charge. */
  amount: Rupees;
  /** Overdue from an earlier month. */
  arrears: boolean;
  /** Before the concession. */
  gross?: Rupees;
  concession?: { label: string; amount: Rupees };
}

export interface FeeVoucher {
  voucherNo: string;
  runId: string;
  campus: CampusCode;
  campusName: string;
  session: number;
  /** "2026-12" */
  month: string;
  grNo: string;
  studentName: string;
  studentNameUr?: string;
  relation: "s/o" | "d/o";
  father: string;
  classSection: string;
  issueDate: IsoDate;
  dueDate: IsoDate;
  /** The bank accepts it until this date. */
  validUntil: IsoDate;
  lines: FeeVoucherLine[];
  /** Late fine already run up on the arrears by the due date. */
  fineOnArrears: Rupees;
  /** Pay this by the due date. */
  payableByDue: Rupees;
  /** Amount payable on later dates (late fine Rs 10 a day per charge). */
  fineTable: Array<{ upTo: IsoDate; amount: Rupees; fine: Rupees }>;
  status: FeeVoucherStatus;
  /** Receipts that paid its charges. */
  receiptNos: string[];
  cancelledReason?: string;
  /** A charge on it was re-priced or moved after issue (concession, waiver): reissue before handing it out again. */
  changedSinceIssue?: boolean;
  printCount: number;
  bank: FeeBankDetails;
  /** "Rs 10 a day after the due date" — the rule printed on the voucher. */
  fineRule: string;
}

export interface FeeVoucherRun {
  id: string;
  campus: CampusCode;
  session: number;
  month: string;
  /** "Whole campus", "Class 7", "7-B, 7-C" */
  scope: string;
  dueDate: IsoDate;
  count: number;
  total: Rupees;
  generatedBy: string;
  generatedAt: IsoDateTime;
  counts: Record<FeeVoucherStatus, number>;
  /** Paid so far against this run. */
  collected: Rupees;
}

export interface FeeVoucherQuery {
  runId?: string;
  month?: string;
  classShort?: string;
  status?: FeeVoucherStatus | "";
  q?: string;
  page?: number;
}

export interface FeeVoucherList {
  campus: CampusScope;
  session: number;
  runs: FeeVoucherRun[];
  months: string[];
  vouchers: FeeVoucher[];
  total: number;
  page: number;
  pageSize: number;
  summary: { issued: number; payable: Rupees; paid: number; collected: Rupees; overdue: number; overdueAmount: Rupees };
}

export interface FeeVoucherRequest {
  campus: CampusCode;
  session: number;
  /** "2026-12" */
  month: string;
  /** Class shorts ("7") or sections ("7-B"); empty = whole campus. */
  classes: string[];
  dueDate: IsoDate;
  validUntil: IsoDate;
  /** Add unpaid charges from earlier months to the voucher. */
  includeArrears: boolean;
}

export interface FeeVoucherPreview {
  month: string;
  dueDate: IsoDate;
  students: number;
  total: Rupees;
  /** Charges that generating will raise on student ledgers. */
  newCharges: number;
  heads: Array<{ head: string; title: string; count: number; amount: Rupees }>;
  withArrears: number;
  arrearsTotal: Rupees;
  withConcession: number;
  concessionTotal: Rupees;
  byClass: Array<{ classSection: string; students: number; total: Rupees }>;
  /** Students left out, with the reason. */
  skipped: Array<{ grNo: string; name: string; classSection: string; reason: string }>;
  sample: FeeVoucher | null;
  /** Problems that stop generation. */
  blockers: string[];
}

export interface FeeVoucherGenerateResult {
  run: FeeVoucherRun;
  vouchers: FeeVoucher[];
}

/* ================================================================== Late fines, waivers, student fines */

/** "ALL" fines every fee head; "TUITION" only monthly tuition (the legacy Main-campus rule). */
export type FeeFineScope = "ALL" | "TUITION";

export interface FeeFineRule {
  campus: CampusCode;
  campusName: string;
  ratePerDay: Rupees;
  graceDays: number;
  maxFine: Rupees | null;
  appliesTo: FeeFineScope;
  effectiveFrom: IsoDate;
  updatedBy: string;
  updatedAt: IsoDateTime;
  /** A saved change that starts later. */
  upcoming?: Omit<FeeFineRule, "campus" | "campusName" | "upcoming" | "history">;
  history: FeeAuditEntry[];
}

export interface FeeFineRuleInput {
  ratePerDay: Rupees;
  graceDays: number;
  maxFine: Rupees | null;
  appliesTo: FeeFineScope;
  effectiveFrom: IsoDate;
}

export type FeeWaiverKind = "WAIVE" | "EXTEND";
export type FeeDecisionStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface FeeWaiver {
  id: string;
  campus: CampusCode;
  grNo: string;
  studentName: string;
  classSection: string;
  chargeId: string;
  chargeHead: string;
  chargeAmount: Rupees;
  /** Due date when the request was made. */
  dueDate: IsoDate;
  kind: FeeWaiverKind;
  /** Late fine on the day of the request. */
  fineToDate: Rupees;
  /** WAIVE: rupees of fine to forgive. */
  amount?: Rupees;
  /** EXTEND: the new due date. */
  newDueDate?: IsoDate;
  reason: string;
  status: FeeDecisionStatus;
  requestedBy: string;
  requestedAt: IsoDateTime;
  decidedBy?: string;
  decidedAt?: IsoDateTime;
  decisionNote?: string;
}

export interface FeeWaiverInput {
  grNo: string;
  chargeId: string;
  kind: FeeWaiverKind;
  amount?: Rupees;
  newDueDate?: IsoDate;
  reason: string;
}

export type FeeStudentFineKind = "EXAM_ABSENCE" | "BREAKAGE" | "MOBILE" | "ID_CARD" | "OTHER";

export const FEE_STUDENT_FINE_LABEL: Record<FeeStudentFineKind, string> = {
  EXAM_ABSENCE: "Exam absence",
  BREAKAGE: "Breakage",
  MOBILE: "Mobile phone",
  ID_CARD: "Lost ID card",
  OTHER: "Other",
};

export interface FeeStudentFine {
  id: string;
  campus: CampusCode;
  grNo: string;
  studentName: string;
  classSection: string;
  kind: FeeStudentFineKind;
  reason: string;
  amount: Rupees;
  raisedBy: string;
  raisedAt: IsoDateTime;
  /** PENDING: not on the ledger yet. CHARGED: added to the student's fees. WAIVED: forgiven. */
  status: "PENDING" | "CHARGED" | "WAIVED";
  chargedAt?: IsoDateTime;
  chargeId?: string;
  note?: string;
}

export interface FeeFinesData {
  campus: CampusScope;
  session: number;
  today: IsoDate;
  rules: FeeFineRule[];
  waivers: FeeWaiver[];
  fines: FeeStudentFine[];
  /** Default amounts by kind, for the raise-fine form. */
  defaults: Record<FeeStudentFineKind, Rupees>;
}

export interface FeeStudentFineInput {
  grNo: string;
  kind: FeeStudentFineKind;
  amount: Rupees;
  reason: string;
}

/* ================================================================== Defaulters and reminders */

export interface FeeDefaulter {
  grNo: string;
  studentName: string;
  classSection: string;
  campus: CampusCode;
  campusName: string;
  father: string;
  mobile: string;
  /** ACTIVE, or LEFT / STRUCK_OFF with dues still open. */
  enrolment: "ACTIVE" | "LEFT" | "STRUCK_OFF" | "EXPELLED" | "PASSED_OUT";
  overdueCharges: number;
  oldestDue: IsoDate;
  daysOverdue: number;
  monthsOverdue: number;
  /** Overdue fees. */
  outstanding: Rupees;
  /** Late fine run up to today. */
  fine: Rupees;
  total: Rupees;
  /** Due but not yet overdue. */
  upcoming: Rupees;
  lastReminderAt?: IsoDateTime;
  reminders: number;
  /** Everything charged this session (paid or not, chosen heads). */
  sessionTotal: Rupees;
  /** Still owed from an earlier session (last class), inside outstanding. */
  previousSessionArrears: Rupees;
  /** Each overdue charge: "Tuition fee – Oct 2026" and what is left of it. */
  installments: Array<{ label: string; dueDate: IsoDate; amount: Rupees }>;
}

export interface FeeDefaultersQuery {
  classShort?: string;
  /** "B" (with a class). */
  section?: string;
  /** Several class-sections at once, comma-separated ("7-A,8-B"); used instead of class and section. */
  sections?: string;
  minMonths?: number;
  minAmount?: number;
  includeLeft?: boolean;
  /** Comma-separated head codes ("TUITION,ANNUAL"); empty = every head. */
  heads?: string;
  /** Only charges falling due in this window. */
  dueFrom?: IsoDate;
  dueTo?: IsoDate;
}

/** Arrears against what was billed, per class and section (Class Wise Arrear). */
export interface FeeClassArrearsRow {
  /** "7-B" */
  classSection: string;
  classShort: string;
  section: string;
  /** Students in the section. */
  strength: number;
  /** Students owing something overdue. */
  students: number;
  billed: Rupees;
  paid: Rupees;
  arrears: Rupees;
  /** Arrears as a share of billed, one decimal. */
  pct: number;
}

export interface FeeClassArrears {
  campus: CampusScope;
  session: number;
  today: IsoDate;
  rows: FeeClassArrearsRow[];
  totals: Omit<FeeClassArrearsRow, "classSection" | "classShort" | "section">;
}

export interface FeeDefaultersData {
  campus: CampusScope;
  session: number;
  today: IsoDate;
  rows: FeeDefaulter[];
  summary: { students: number; outstanding: Rupees; fine: Rupees; threePlus: number };
  /** Heads that can be filtered on (fee heads in use, and student fines). */
  heads: Array<{ code: string; title: string }>;
  smsPaused: boolean;
  /** The fee-overdue SMS as saved in the SMS centre. */
  template: { en: string; ur: string };
}

export interface FeeReminderRequest {
  campus: CampusScope;
  session: number;
  grNos: string[];
  language: "en" | "ur";
  /** Wording for this send only (variables {student_name}, {class}, {amount_due}, {due_date}, {campus}); omitted = the Fee overdue template. */
  customText?: { en: string; ur: string };
}

export interface FeeReminderResult {
  batchId: string;
  queued: number;
  skipped: Array<{ grNo: string; name: string; reason: string }>;
}

/* ================================================================== Candidate (test) fees */

export interface FeeCandidate {
  id: string;
  applicationNo: string;
  name: string;
  father: string;
  classApplied: string;
  campus: CampusCode;
  campusName: string;
  appliedOn: IsoDate;
  testDate?: IsoDate;
  /** Total of the lines (what the candidate should pay). */
  amount: Rupees;
  status: "PAID" | "DUE" | "WAIVED";
  receiptNo?: string;
  paidOn?: IsoDate;
  /** One line per head: prospectus, form, test fee. */
  lines: FeeCandidateLine[];
  /** What was received (can be less than amount when a head is not taken). */
  received: Rupees;
  /** Cashier who took the money. */
  receivedBy?: string;
  paymentMethod?: "CASH" | "BANK";
  bankChallanNo?: string;
  /** Paid by (person name). */
  paidBy?: string;
}

export interface FeeCandidateLine {
  /** "CANDIDATE", "PROSPECTUS", "FORM" */
  head: string;
  title: string;
  amount: Rupees;
  paid: Rupees;
}

export interface FeeCandidatesData {
  campus: CampusScope;
  session: number;
  rows: FeeCandidate[];
  summary: { paidToday: { count: number; amount: Rupees }; paidSession: { count: number; amount: Rupees }; due: { count: number; amount: Rupees } };
  /** Heads a candidate can pay, with the usual amount. */
  heads: Array<{ code: string; title: string; amount: Rupees }>;
  /** Cashiers who took candidate fees this session. */
  cashiers: string[];
}

export type FeeCandidatePayment = { method: "CASH" } | { method: "BANK"; challanNo: string; date: IsoDate };

export interface FeeCandidatePayRequest {
  lines: Array<{ head: string; amount: Rupees; paid: Rupees }>;
  payment: FeeCandidatePayment;
  paidBy?: string;
}

/* ================================================================== Reports */

export type FeeCollectionMethod = PaymentMethod["method"];

export interface FeeCollectionRow {
  receiptNo: string;
  at: IsoDateTime;
  campus: CampusCode;
  grNo: string;
  studentName: string;
  classSection: string;
  cashier: string;
  method: FeeCollectionMethod;
  /** "Tuition fee – Nov 2026, Annual charges" */
  heads: string;
  /** Late fine inside the amount. */
  fine: Rupees;
  amount: Rupees;
  status: Receipt["status"];
  /** The receipt can be opened (posted in this system, not part of the day's carried-over figure). */
  openable: boolean;
  /** "F" or "M" */
  gender: "F" | "M";
  /** What the receipt paid, head by head (fee part; late fine apart). */
  lines: FeeCollectionLine[];
  /** Bank slip, cheque or transaction number. */
  bankRef?: string;
}

export interface FeeCollectionLine {
  /** Head code ("TUITION") */
  head: string;
  /** "Tuition fee" */
  headTitle: string;
  /** "Nov 2026", "2026–27", "" */
  installment: string;
  amount: Rupees;
  fine: Rupees;
}

export interface FeeCollectionGroup {
  key: string;
  label: string;
  receipts: number;
  amount: Rupees;
}

export interface FeeCollectionQuery {
  from: IsoDate;
  to: IsoDate;
  cashier?: string;
  method?: FeeCollectionMethod | "";
  /** Only receipts with a line under this head; amounts then show that head only. */
  head?: string;
  classShort?: string;
  /** "B" (with a class). */
  section?: string;
  gender?: "F" | "M" | "";
  q?: string;
  page?: number;
  /** 50 by default; up to 2,000 for a print-out. */
  pageSize?: number;
}

export interface FeeCollectionReport {
  campus: CampusScope;
  from: IsoDate;
  to: IsoDate;
  days: Array<{ date: IsoDate; receipts: number; amount: Rupees }>;
  total: { receipts: number; amount: Rupees; fine: Rupees };
  byCashier: FeeCollectionGroup[];
  byMethod: FeeCollectionGroup[];
  byHead: FeeCollectionGroup[];
  byCampus: FeeCollectionGroup[];
  /** By class (Prep, Class 1 … Class 10), in class order. */
  byClass: FeeCollectionGroup[];
  /** Receipts cancelled (approved) in the period. */
  cancelled: {
    count: number;
    amount: Rupees;
    items: Array<{ receiptNo: string; cnNo: string; studentName: string; grNo: string; classSection: string; amount: Rupees; reason: string; approvedBy: string; at: IsoDateTime; paidOn: IsoDate; cashier: string; heads: string }>;
  };
  /** Head codes and titles seen in the period, in head order (for the "Show by head" columns). */
  heads: Array<{ code: string; title: string; short: string }>;
  /** Sum of every matching row's amount for the chosen head (when a head is chosen). */
  headAmount?: Rupees;
  pendingCancellations: number;
  /** What the dashboard shows for today, when the period is today. */
  dashboardToday?: { amount: Rupees; receipts: number };
  rows: FeeCollectionRow[];
  rowsTotal: number;
  /** Sum of every row matching the filters (all pages). */
  rowsAmount: Rupees;
  page: number;
  pageSize: number;
  cashiers: string[];
  /** Cash closings recorded for the period. */
  closings: FeeCashClosing[];
}

export interface FeeCashClosing {
  id: string;
  campus: CampusCode;
  date: IsoDate;
  cashier: string;
  expected: Rupees;
  counted: Rupees;
  difference: Rupees;
  note?: string;
  closedAt: IsoDateTime;
}

export interface FeeCashClosingInput {
  campus: CampusCode;
  date: IsoDate;
  counted: Rupees;
  note?: string;
}

export interface FeeMonthRow {
  /** "2026-04" */
  month: string;
  target: Rupees;
  collected: Rupees;
  receipts: number;
  /** The month in progress. */
  current: boolean;
}

export interface FeeMonthlyReport {
  campus: CampusScope;
  session: number;
  months: FeeMonthRow[];
  total: { target: Rupees; collected: Rupees };
  /** This month by campus (all-campus view). */
  byCampus: Array<{ campus: CampusCode; name: string; target: Rupees; collected: Rupees }>;
}

/** Headline figures for the reports catalogue. */
export interface FeeOverview {
  campus: CampusScope;
  session: number;
  today: { amount: Rupees; receipts: number };
  month: { collected: Rupees; target: Rupees };
  defaulters: { students: number; amount: Rupees };
  vouchers: { open: number; overdue: number };
  approvals: { concessions: number; waivers: number };
  pendingFines: number;
}

/* ================================================================== Client */

const base = "/fee-setup";

export const feeSetupApi = {
  overview: (ctx: Ctx) => apiFetch<FeeOverview>(`${base}/overview`, { query: ctxQuery(ctx) }),
  students: (ctx: Ctx) => apiFetch<FeeStudentOption[]>(`${base}/students`, { query: ctxQuery(ctx) }),

  structure: (campus: CampusCode, session: number) => apiFetch<FeeStructure>(`${base}/structure`, { query: { campus, session } }),
  comparison: (session: number) => apiFetch<FeeStructureComparison>(`${base}/structure/comparison`, { query: { session } }),
  saveClass: (campus: CampusCode, session: number, classShort: string, body: FeeClassStructureInput, idempotencyKey: string) =>
    apiFetch<FeeStructure>(`${base}/structure/classes/${encodeURIComponent(classShort)}`, { method: "PUT", query: { campus, session }, body, idempotencyKey }),
  copyPreview: (body: FeeCopyRequest) => apiFetch<FeeCopyPreview>(`${base}/structure/copy/preview`, { method: "POST", body }),
  copy: (body: FeeCopyRequest, idempotencyKey: string) => apiFetch<FeeStructure>(`${base}/structure/copy`, { method: "POST", body, idempotencyKey }),
  setDueDate: (campus: CampusCode, session: number, body: FeeDueDateInput, idempotencyKey: string) =>
    apiFetch<FeeDueDateResult>(`${base}/structure/due-dates`, { method: "POST", query: { campus, session }, body, idempotencyKey }),
  /** Fee heads are one list for every campus; campus is where the user's permission is checked. */
  createHead: (campus: CampusCode, body: FeeHeadInput, idempotencyKey: string) => apiFetch<FeeHead>(`${base}/structure/heads`, { method: "POST", query: { campus }, body, idempotencyKey }),
  updateHead: (campus: CampusCode, code: string, body: FeeHeadInput, idempotencyKey: string) =>
    apiFetch<FeeHead>(`${base}/structure/heads/${encodeURIComponent(code)}`, { method: "PUT", query: { campus }, body, idempotencyKey }),
  setHeadActive: (campus: CampusCode, code: string, body: { active: boolean; rowVer: number }, idempotencyKey: string) =>
    apiFetch<FeeHead>(`${base}/structure/heads/${encodeURIComponent(code)}/active`, { method: "POST", query: { campus }, body, idempotencyKey }),

  concessions: (ctx: Ctx) => apiFetch<FeeConcessionsData>(`${base}/concessions`, { query: ctxQuery(ctx) }),
  concessionSummary: (ctx: Ctx, q: FeeConcessionSummaryQuery) => apiFetch<FeeConcessionSummary>(`${base}/reports/concessions`, { query: { ...ctxQuery(ctx), ...q } }),
  requestConcession: (body: FeeConcessionInput, idempotencyKey: string) => apiFetch<FeeConcession>(`${base}/concessions`, { method: "POST", body, idempotencyKey }),
  decideConcession: (id: string, body: { approve: boolean; note: string }, idempotencyKey: string) =>
    apiFetch<FeeConcession>(`${base}/concessions/${encodeURIComponent(id)}/decide`, { method: "POST", body, idempotencyKey }),
  stopConcession: (id: string, body: { reason: string; from: IsoDate }, idempotencyKey: string) =>
    apiFetch<FeeConcession>(`${base}/concessions/${encodeURIComponent(id)}/stop`, { method: "POST", body, idempotencyKey }),

  vouchers: (ctx: Ctx, q: FeeVoucherQuery) => apiFetch<FeeVoucherList>(`${base}/vouchers`, { query: { ...ctxQuery(ctx), ...q } }),
  voucher: (voucherNo: string) => apiFetch<FeeVoucher>(`${base}/vouchers/${encodeURIComponent(voucherNo)}`),
  printRun: (runId: string) => apiFetch<{ run: FeeVoucherRun; vouchers: FeeVoucher[] }>(`${base}/vouchers/runs/${encodeURIComponent(runId)}`),
  previewVouchers: (body: FeeVoucherRequest) => apiFetch<FeeVoucherPreview>(`${base}/vouchers/preview`, { method: "POST", body }),
  generateVouchers: (body: FeeVoucherRequest, idempotencyKey: string) => apiFetch<FeeVoucherGenerateResult>(`${base}/vouchers/generate`, { method: "POST", body, idempotencyKey }),
  cancelVoucher: (voucherNo: string, reason: string, idempotencyKey: string) =>
    apiFetch<FeeVoucher>(`${base}/vouchers/${encodeURIComponent(voucherNo)}/cancel`, { method: "POST", body: { reason }, idempotencyKey }),
  markVouchersPrinted: (voucherNos: string[]) => apiFetch<{ printed: number }>(`${base}/vouchers/print`, { method: "POST", body: { voucherNos } }),

  fines: (ctx: Ctx) => apiFetch<FeeFinesData>(`${base}/fines`, { query: ctxQuery(ctx) }),
  saveFineRule: (campus: CampusCode, body: FeeFineRuleInput, idempotencyKey: string) =>
    apiFetch<FeeFineRule>(`${base}/fines/rules/${campus}`, { method: "PUT", body, idempotencyKey }),
  requestWaiver: (ctx: Ctx, body: FeeWaiverInput, idempotencyKey: string) => apiFetch<FeeWaiver>(`${base}/fines/waivers`, { method: "POST", query: ctxQuery(ctx), body, idempotencyKey }),
  decideWaiver: (id: string, body: { approve: boolean; note: string }, idempotencyKey: string) =>
    apiFetch<FeeWaiver>(`${base}/fines/waivers/${encodeURIComponent(id)}/decide`, { method: "POST", body, idempotencyKey }),
  raiseFine: (ctx: Ctx, body: FeeStudentFineInput, idempotencyKey: string) => apiFetch<FeeStudentFine>(`${base}/fines/student`, { method: "POST", query: ctxQuery(ctx), body, idempotencyKey }),
  chargeFines: (body: { ids: string[]; dueDate: IsoDate }, idempotencyKey: string) => apiFetch<{ charged: number; amount: Rupees }>(`${base}/fines/student/charge`, { method: "POST", body, idempotencyKey }),
  waiveFine: (id: string, note: string, idempotencyKey: string) =>
    apiFetch<FeeStudentFine>(`${base}/fines/student/${encodeURIComponent(id)}/waive`, { method: "POST", body: { note }, idempotencyKey }),

  defaulters: (ctx: Ctx, q: FeeDefaultersQuery) => apiFetch<FeeDefaultersData>(`${base}/defaulters`, { query: { ...ctxQuery(ctx), ...q } }),
  classArrears: (ctx: Ctx, q: FeeDefaultersQuery) => apiFetch<FeeClassArrears>(`${base}/reports/class-arrears`, { query: { ...ctxQuery(ctx), ...q } }),
  remind: (body: FeeReminderRequest, idempotencyKey: string) => apiFetch<FeeReminderResult>(`${base}/defaulters/remind`, { method: "POST", body, idempotencyKey }),

  candidates: (ctx: Ctx) => apiFetch<FeeCandidatesData>(`${base}/candidates`, { query: ctxQuery(ctx) }),
  payCandidate: (id: string, body: FeeCandidatePayRequest, idempotencyKey: string) => apiFetch<FeeCandidate>(`${base}/candidates/${encodeURIComponent(id)}/pay`, { method: "POST", body, idempotencyKey }),

  collection: (ctx: Ctx, q: FeeCollectionQuery) => apiFetch<FeeCollectionReport>(`${base}/reports/collection`, { query: { ...ctxQuery(ctx), ...q } }),
  closeCash: (body: FeeCashClosingInput, idempotencyKey: string) => apiFetch<FeeCashClosing>(`${base}/reports/closings`, { method: "POST", body, idempotencyKey }),
  monthly: (ctx: Ctx) => apiFetch<FeeMonthlyReport>(`${base}/reports/monthly`, { query: ctxQuery(ctx) }),
};

/** Every key starts with "fees", so posting a receipt (which invalidates ["fees"]) refreshes these pages too. */
export const feeSetupQueries = {
  all: () => ["fees", "setup"] as const,
  overview: (ctx: Ctx) => queryOptions({ queryKey: ["fees", "setup", ...ctxKey(ctx), "overview"], queryFn: () => feeSetupApi.overview(ctx) }),
  students: (ctx: Ctx) => queryOptions({ queryKey: ["fees", "setup", ...ctxKey(ctx), "students"], queryFn: () => feeSetupApi.students(ctx), staleTime: 60_000 }),
  structure: (campus: CampusCode, session: number) =>
    queryOptions({ queryKey: ["fees", "setup", campus, session, "structure"], queryFn: () => feeSetupApi.structure(campus, session) }),
  comparison: (session: number) => queryOptions({ queryKey: ["fees", "setup", "ALL", session, "comparison"], queryFn: () => feeSetupApi.comparison(session) }),
  concessions: (ctx: Ctx) => queryOptions({ queryKey: ["fees", "setup", ...ctxKey(ctx), "concessions"], queryFn: () => feeSetupApi.concessions(ctx) }),
  vouchers: (ctx: Ctx, q: FeeVoucherQuery) => queryOptions({ queryKey: ["fees", "setup", ...ctxKey(ctx), "vouchers", q], queryFn: () => feeSetupApi.vouchers(ctx, q) }),
  voucher: (voucherNo: string) => queryOptions({ queryKey: ["fees", "setup", "voucher", voucherNo], queryFn: () => feeSetupApi.voucher(voucherNo), enabled: voucherNo !== "" }),
  printRun: (runId: string) => queryOptions({ queryKey: ["fees", "setup", "run", runId], queryFn: () => feeSetupApi.printRun(runId), enabled: runId !== "" }),
  fines: (ctx: Ctx) => queryOptions({ queryKey: ["fees", "setup", ...ctxKey(ctx), "fines"], queryFn: () => feeSetupApi.fines(ctx) }),
  defaulters: (ctx: Ctx, q: FeeDefaultersQuery) => queryOptions({ queryKey: ["fees", "setup", ...ctxKey(ctx), "defaulters", q], queryFn: () => feeSetupApi.defaulters(ctx, q) }),
  classArrears: (ctx: Ctx, q: FeeDefaultersQuery) => queryOptions({ queryKey: ["fees", "setup", ...ctxKey(ctx), "class-arrears", q], queryFn: () => feeSetupApi.classArrears(ctx, q) }),
  concessionSummary: (ctx: Ctx, q: FeeConcessionSummaryQuery) =>
    queryOptions({ queryKey: ["fees", "setup", ...ctxKey(ctx), "concession-summary", q], queryFn: () => feeSetupApi.concessionSummary(ctx, q) }),
  candidates: (ctx: Ctx) => queryOptions({ queryKey: ["fees", "setup", ...ctxKey(ctx), "candidates"], queryFn: () => feeSetupApi.candidates(ctx) }),
  collection: (ctx: Ctx, q: FeeCollectionQuery) => queryOptions({ queryKey: ["fees", "setup", ...ctxKey(ctx), "collection", q], queryFn: () => feeSetupApi.collection(ctx, q) }),
  monthly: (ctx: Ctx) => queryOptions({ queryKey: ["fees", "setup", ...ctxKey(ctx), "monthly"], queryFn: () => feeSetupApi.monthly(ctx) }),
};
