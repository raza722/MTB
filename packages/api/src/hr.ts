// Staff and payroll API — owned by the hr feature.
// One profile per person (hr.Staff) with a posting per campus (hr.Employment), so a teacher who works at two campuses
// has one record. Salary is effective-dated (salary history), increments and salary sheets go draft → approval →
// applied/paid, and every amount is whole rupees. Modernization doc 30 §e; legacy doc 03 §2 and H1–H5.
import type { IsoDate, IsoDateTime, Rupees } from "@mtb/domain";
import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { ctxKey, ctxQuery, type CampusCode, type CampusScope, type Ctx } from "./context";

/* ================================================================== Shared */

export type HrCategory = "TEACHING" | "NON_TEACHING" | "MANAGEMENT" | "VISITING" | "HIFZ";

export const HR_CATEGORY_LABEL: Record<HrCategory, string> = {
  TEACHING: "Teaching",
  NON_TEACHING: "Non-teaching",
  MANAGEMENT: "Management",
  VISITING: "Visiting",
  HIFZ: "Hifz (Quran)",
};

export type HrEmploymentType = "PERMANENT" | "CONTRACT" | "PROBATION" | "VISITING";

export const HR_EMPLOYMENT_LABEL: Record<HrEmploymentType, string> = {
  PERMANENT: "Permanent",
  CONTRACT: "Contract",
  PROBATION: "On probation",
  VISITING: "Visiting",
};

export type HrStaffStatus = "ACTIVE" | "LEFT";
export type HrGender = "F" | "M";
export type HrRelation = "s/o" | "d/o" | "w/o";
export type HrMaritalStatus = "SINGLE" | "MARRIED" | "WIDOWED" | "DIVORCED";
export type HrPaymentMethod = "BANK" | "CASH" | "CHEQUE";

export const HR_PAYMENT_LABEL: Record<HrPaymentMethod, string> = { BANK: "Bank transfer", CASH: "Cash", CHEQUE: "Cheque" };

export interface HrAuditEntry {
  id: string;
  at: IsoDateTime;
  by: string;
  text: string;
  detail?: string;
}

/** "2026-10" → used by salary sheets, monthly attendance and loan schedules. */
export type HrMonth = string;

/** Sent back with 409 CONCURRENCY: who saved the record since it was opened. */
export interface HrConflictDetails {
  changedBy: string;
  changedAt: IsoDateTime;
}

/** 409 DUPLICATE_CNIC details: the person already has a profile (one profile per person, across campuses). */
export interface HrDuplicateDetails {
  staffId: string;
  name: string;
  employeeNo: string;
  campuses: CampusCode[];
  status: HrStaffStatus;
}

/* ================================================================== Staff directory and profile */

export interface HrPosting {
  id: string;
  campus: CampusCode;
  campusName: string;
  designationId: string;
  designation: string;
  /** null = no department yet (postings migrated from the old system had none). */
  departmentId: string | null;
  department: string | null;
  category: HrCategory;
  employmentType: HrEmploymentType;
  /** "0" or null = no pay scale. */
  payScale: string | null;
  startDate: IsoDate;
  endDate: IsoDate | null;
  endReason: string | null;
  /** The campus that pays the salary and keeps the file. */
  primary: boolean;
  /** For staff shared between campuses: days a week at this campus. */
  daysPerWeek: number | null;
  /** Enrolment number on this campus's fingerprint machine. */
  deviceEnrolNo: string | null;
  classTeacherOf: string | null;
}

export interface HrStaffSummary {
  id: string;
  employeeNo: string;
  name: string;
  nameUrdu: string | null;
  gender: HrGender;
  designationId: string;
  designation: string;
  /** null = no department yet (migrated staff). */
  departmentId: string | null;
  department: string | null;
  category: HrCategory;
  employmentType: HrEmploymentType;
  /** The posting shown for the campus being viewed (the primary posting with "All campuses"). */
  campus: CampusCode;
  campusName: string;
  /** Other campuses this person works at right now. */
  otherCampuses: CampusCode[];
  status: HrStaffStatus;
  joiningDate: IsoDate;
  leavingDate: IsoDate | null;
  /** Years of service at MTB plus earlier MTB service, one decimal. */
  serviceYears: number;
  /** "" when not on file (migrated staff); shown as "—". */
  mobile: string;
  /** "" when not on file (migrated staff); shown as "—". */
  cnic: string;
  payScale: string | null;
  subjects: string[];
  classTeacherOf: string | null;
  onLeaveToday: boolean;
  missingDocuments: number;
  /** Monthly basic pay — only for roles that may see pay. 0 = no salary set yet (shown as "—", not "Rs 0"). */
  basic?: Rupees;
  /** Bio-data for the printed staff list. */
  relation: HrRelation;
  guardianName: string;
  /** null when not on file (migrated staff). */
  dob: IsoDate | null;
  /** "M.A. (English)": the most recent degree on file. */
  highestQualification: string | null;
  teachingLevels: string[];
}

/** Qualifications migrated from the old system are free text: the degree only, subject/institution/result "" and year null. */
export interface HrQualification {
  id: string;
  degree: string;
  subject: string;
  institution: string;
  year: number | null;
  result: string;
}

export interface HrExperience {
  id: string;
  organisation: string;
  role: string;
  from: IsoDate;
  to: IsoDate;
}

export type HrDocumentKind = "CNIC" | "PHOTO" | "DEGREE" | "EXPERIENCE" | "APPOINTMENT" | "POLICE" | "MEDICAL" | "CONTRACT" | "OTHER";

export const HR_DOCUMENT_LABEL: Record<HrDocumentKind, string> = {
  CNIC: "CNIC copy",
  PHOTO: "Photograph",
  DEGREE: "Highest degree",
  EXPERIENCE: "Experience letter",
  APPOINTMENT: "Signed appointment letter",
  POLICE: "Police verification",
  MEDICAL: "Medical certificate",
  CONTRACT: "Contract",
  OTHER: "Other document",
};

export interface HrDocument {
  id: string;
  kind: HrDocumentKind;
  title: string;
  fileName: string | null;
  sizeKb: number | null;
  uploadedAt: IsoDateTime | null;
  uploadedBy: string | null;
  required: boolean;
  status: "ON_FILE" | "MISSING";
}

export type HrSalaryReason = "APPOINTMENT" | "INCREMENT" | "REVISION" | "LEGACY";

export interface HrSalaryHistoryRow {
  id: string;
  effectiveFrom: IsoDate;
  basic: Rupees;
  change: Rupees;
  reason: HrSalaryReason;
  note: string;
  by: string;
}

export interface HrPayItem {
  code: string;
  label: string;
  amount: Rupees;
  /** How it is worked out: "45% of basic". */
  basis?: string;
}

export interface HrBankAccount {
  bankName: string;
  branch: string;
  accountTitle: string;
  /** Only the last four digits are shown: "•••• 4417". */
  accountNoMasked: string;
}

/** A staff member's child at an MTB campus; the monthly fee can be taken from salary. */
export interface HrStaffChild {
  grNo: string;
  name: string;
  classSection: string;
  campus: CampusCode;
  monthlyFee: Rupees;
  adjustAgainstSalary: boolean;
}

export interface HrPayDetails {
  /** 0 = no salary set yet (shown as "—"; gross and net are then shown as "—" too). */
  basic: Rupees;
  payScale: string | null;
  allowances: HrPayItem[];
  deductions: HrPayItem[];
  /** Basic + allowances for a full month. */
  gross: Rupees;
  /** Gross minus standing deductions (before loans, absences and child fees). */
  net: Rupees;
  paymentMethod: HrPaymentMethod;
  bank: HrBankAccount | null;
  specialAllowance: Rupees;
  eobi: boolean;
  providentFund: boolean;
  history: HrSalaryHistoryRow[];
  /** An approved change that starts later (an increment from 01-Dec). */
  nextChange: HrSalaryHistoryRow | null;
  children: HrStaffChild[];
  loans: HrLoanSummary[];
  recentSlips: Array<{ runId: string; month: HrMonth; net: Rupees; status: HrPayrollStatus }>;
  /** Pay is handled by another campus's payroll (shared staff), or the campus doesn't run payroll. */
  payrollNote: string | null;
}

export interface HrEmergencyContact {
  name: string;
  relation: string;
  mobile: string;
}

export interface HrStaffProfile extends HrStaffSummary {
  relation: HrRelation;
  guardianName: string;
  dob: IsoDate | null;
  bloodGroup: string;
  /** null when not on file (the old system did not record it); editing the record asks for it. */
  maritalStatus: HrMaritalStatus | null;
  religion: string;
  mobile2: string | null;
  email: string | null;
  address: string;
  city: string;
  /** null when not on file (most migrated staff); editing the record asks for it. */
  emergency: HrEmergencyContact | null;
  /** Who recommended the candidate. */
  reference: string | null;
  caste: string | null;
  priorServiceYears: number;
  probationEnds: IsoDate | null;
  postings: HrPosting[];
  qualifications: HrQualification[];
  experience: HrExperience[];
  teachingLevels: string[];
  subjectIds: string[];
  documents: HrDocument[];
  leave: HrLeaveBalance[];
  attendance: {
    month: HrMonth;
    days: Partial<Record<IsoDate, "P" | "A" | "L" | "LT" | "H">>;
    holidays: Partial<Record<IsoDate, string>>;
    present: number;
    late: number;
    absent: number;
    leave: number;
  };
  /** null when the viewer may not see salary and bank details. */
  pay: HrPayDetails | null;
  payHidden: boolean;
  /** Linked sign-in account, if any. */
  userName: string | null;
  history: HrAuditEntry[];
  rowVer: number;
  /** Reason the staff member left, when status is LEFT. */
  leavingReason: string | null;
  /** Signs the appointment letter: the Principal posted at the primary campus; left out when there is none ("Principal"). */
  principalName?: string;
}

export interface HrPersonalInput {
  name: string;
  nameUrdu: string | null;
  gender: HrGender;
  relation: HrRelation;
  guardianName: string;
  /** 13 digits, no dashes. */
  cnic: string;
  dob: IsoDate;
  bloodGroup: string;
  maritalStatus: HrMaritalStatus;
  religion: string;
  /** 11 digits: 03001234567 */
  mobile: string;
  mobile2: string | null;
  email: string | null;
  address: string;
  city: string;
  emergency: HrEmergencyContact;
  priorServiceYears: number;
  /** Who recommended the candidate (legacy "Reference"). */
  reference?: string | null;
  caste?: string | null;
}

export interface HrBankInput {
  bankName: string;
  branch: string;
  accountTitle: string;
  /** Full number; null keeps the number on file. */
  accountNo: string | null;
}

export interface HrNewStaffInput extends HrPersonalInput {
  campus: CampusCode;
  designationId: string;
  departmentId: string;
  employmentType: HrEmploymentType;
  payScale: string | null;
  joiningDate: IsoDate;
  probationMonths: number | null;
  teachingLevels: string[];
  subjectIds: string[];
  qualification: (Omit<HrQualification, "id" | "year"> & { year: number }) | null;
  /** Only roles that run payroll can set pay; others leave it for the accountant. */
  pay: { basic: Rupees; specialAllowance: Rupees; paymentMethod: HrPaymentMethod; bank: HrBankInput | null; eobi: boolean; providentFund: boolean } | null;
}

export interface HrPostingInput {
  campus: CampusCode;
  designationId: string;
  departmentId: string;
  employmentType: HrEmploymentType;
  payScale: string | null;
  startDate: IsoDate;
  daysPerWeek: number | null;
}

export interface HrPayInput {
  basic: Rupees;
  /** Needed when the basic changes. */
  effectiveFrom: IsoDate | null;
  reason: string;
  specialAllowance: Rupees;
  paymentMethod: HrPaymentMethod;
  bank: HrBankInput | null;
  eobi: boolean;
  providentFund: boolean;
  children: Array<{ grNo: string; adjustAgainstSalary: boolean }>;
  rowVer: number;
}

export interface HrOverview {
  active: number;
  byCategory: Array<{ category: HrCategory; count: number }>;
  female: number;
  male: number;
  onLeaveToday: number;
  onProbation: number;
  joinedThisSession: number;
  leftThisSession: number;
  sharedWithOtherCampuses: number;
  missingDocuments: number;
  pendingLeave: number;
  pendingLoans: number;
  pendingIncrements: number;
  payroll: { month: HrMonth; status: HrPayrollStatus | "NOT_STARTED" | "NOT_RUN" } | null;
}

/* ================================================================== Staff attendance */

export type HrDayStatus = "PRESENT" | "LATE" | "ABSENT" | "LEAVE" | "HALF_DAY" | "HOLIDAY" | "OFF";

export const HR_DAY_LABEL: Record<HrDayStatus, string> = {
  PRESENT: "Present",
  LATE: "Late",
  ABSENT: "Absent",
  LEAVE: "On leave",
  HALF_DAY: "Half day",
  HOLIDAY: "Holiday",
  OFF: "Not a working day",
};

export interface HrDayRow {
  staffId: string;
  name: string;
  employeeNo: string;
  designationId: string;
  designation: string;
  category: HrCategory;
  deviceEnrolNo: string | null;
  /** "07:42" (24-hour, Pakistan time). */
  timeIn: string | null;
  timeOut: string | null;
  /** null = not marked yet. */
  status: HrDayStatus | null;
  lateMinutes: number;
  source: "DEVICE" | "MANUAL" | "LEAVE" | "CALENDAR" | null;
  leaveType: string | null;
  note: string | null;
  editedBy: string | null;
}

export interface HrImportBatch {
  id: string;
  campus: CampusCode;
  fileName: string;
  deviceName: string;
  importedAt: IsoDateTime;
  importedBy: string;
  punches: number;
  newPunches: number;
  duplicates: number;
  ignored: number;
  days: IsoDate[];
  staff: number;
}

export interface HrAttendanceDay {
  campus: CampusCode;
  date: IsoDate;
  /** Holiday or weekly off for everyone. */
  closed: { name: string } | null;
  dayStarts: string;
  graceMinutes: number;
  /** Arriving after this is late: "07:55". */
  lateAfter: string;
  rows: HrDayRow[];
  summary: { total: number; present: number; late: number; absent: number; leave: number; halfDay: number; notMarked: number };
  deviceName: string | null;
  lastImport: HrImportBatch | null;
}

export interface HrDayEntryInput {
  staffId: string;
  status: HrDayStatus;
  timeIn: string | null;
  timeOut: string | null;
  note: string | null;
}

export type HrMonthCode = "P" | "LT" | "A" | "LV" | "HD" | "H" | "OFF";

export interface HrMonthRow {
  staffId: string;
  name: string;
  employeeNo: string;
  designationId: string;
  designation: string;
  codes: Partial<Record<IsoDate, HrMonthCode>>;
  present: number;
  late: number;
  absent: number;
  leave: number;
  halfDay: number;
  lateMinutes: number;
  /** Present + late + half days as a share of working days. */
  percent: number | null;
  /** Legacy monthly attendance columns: name in Urdu, hours worked (from time in/out) and rest days given by hand. */
  nameUrdu: string | null;
  workedMinutes: number;
  offDays: number;
}

export interface HrLateEvent {
  staffId: string;
  name: string;
  designation: string;
  date: IsoDate;
  timeIn: string;
  lateMinutes: number;
}

export interface HrAttendanceMonth {
  campus: CampusCode;
  month: HrMonth;
  days: Array<{ date: IsoDate; weekday: number; holiday: string | null; future: boolean }>;
  rows: HrMonthRow[];
  late: HrLateEvent[];
  byDay: Array<{ date: IsoDate; present: number; late: number; absent: number; leave: number }>;
  workingDays: number;
}

/** One person's day in the date-range report. */
export interface HrRangeCell {
  status: HrDayStatus | null;
  timeIn: string | null;
  timeOut: string | null;
  lateMinutes: number;
  /** Minutes between time in and time out (0 when either is missing). */
  workedMinutes: number;
  leaveType: string | null;
  source: HrDayRow["source"];
  note: string | null;
}

export interface HrRangeRow {
  staffId: string;
  name: string;
  employeeNo: string;
  designationId: string;
  designation: string;
  cells: Partial<Record<IsoDate, HrRangeCell>>;
  present: number;
  late: number;
  absent: number;
  leave: number;
  halfDay: number;
  lateMinutes: number;
  workedMinutes: number;
  /** Present + late + half days as a share of working days. */
  percent: number | null;
}

/** Staff attendance for any date range (up to 93 days): status and time in/out per day. */
export interface HrAttendanceRange {
  campus: CampusCode;
  from: IsoDate;
  to: IsoDate;
  days: Array<{ date: IsoDate; weekday: number; holiday: string | null }>;
  rows: HrRangeRow[];
  workingDays: number;
}

export interface HrImportUnknown {
  enrolNo: string;
  punches: number;
  firstPunch: string;
  suggestions: Array<{ staffId: string; name: string; employeeNo: string; reason: string }>;
}

export interface HrImportPreview {
  previewId: string;
  fileName: string;
  deviceName: string;
  lines: number;
  totalPunches: number;
  newPunches: number;
  duplicates: number;
  badLines: Array<{ line: number; text: string; problem: string }>;
  from: IsoDate | null;
  to: IsoDate | null;
  matchedStaff: number;
  unknown: HrImportUnknown[];
  sample: Array<{ staffId: string; name: string; date: IsoDate; firstIn: string; lastOut: string | null; lateMinutes: number }>;
}

export interface HrImportCommitInput {
  campus: CampusCode;
  previewId: string;
  /** enrolment number → staff id, or "IGNORE". */
  mapping: Record<string, string>;
  /** Save the mapping on the staff profile for next time. */
  remember: boolean;
}

export interface HrImportResult {
  batch: HrImportBatch;
  daysUpdated: number;
  staffUpdated: number;
  late: number;
  mapped: number;
}

/* ================================================================== Leave */

export interface HrLeaveType {
  id: string;
  code: string;
  name: string;
  /** null = no yearly limit (unpaid leave). */
  daysPerYear: number | null;
  paid: boolean;
  /** Ask for a medical certificate or proof after this many days. */
  proofAfterDays: number | null;
  active: boolean;
}

export type HrLeaveStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface HrLeaveBalance {
  typeId: string;
  typeName: string;
  entitled: number | null;
  taken: number;
  pending: number;
  left: number | null;
}

export interface HrLeaveRequest {
  id: string;
  staffId: string;
  staffName: string;
  employeeNo: string;
  designationId: string;
  designation: string;
  category: HrCategory;
  campus: CampusCode;
  campusName: string;
  session: number;
  typeId: string;
  typeName: string;
  paid: boolean;
  from: IsoDate;
  to: IsoDate;
  /** Working days (Sundays and holidays don't count); 0.5 for a half day. */
  days: number;
  halfDay: boolean;
  reason: string;
  status: HrLeaveStatus;
  source: "TEACHER_APP" | "OFFICE";
  requestedBy: string;
  requestedAt: IsoDateTime;
  decidedBy: string | null;
  decidedAt: IsoDateTime | null;
  decisionNote: string | null;
  /** Days of this type left after this request. */
  leftAfter: number | null;
  /** Exceeds what is left of the yearly allowance. */
  overBalance: boolean;
  /** Teaching periods someone has to cover. */
  periodsToCover: number | null;
  /** Events on those days: "Annual sports day (27-Nov)". */
  clashes: string[];
  history: HrAuditEntry[];
}

export interface HrLeaveData {
  types: HrLeaveType[];
  requests: HrLeaveRequest[];
  summary: {
    pending: number;
    onLeaveToday: Array<{ staffId: string; name: string; typeName: string; until: IsoDate }>;
    daysThisMonth: number;
    approvedThisSession: number;
  };
}

export interface HrLeaveBalanceRow {
  staffId: string;
  name: string;
  employeeNo: string;
  designation: string;
  balances: HrLeaveBalance[];
}

export interface HrLeaveInput {
  campus: CampusCode;
  session: number;
  staffId: string;
  typeId: string;
  from: IsoDate;
  to: IsoDate;
  halfDay: boolean;
  reason: string;
  /** Already approved on paper: record it as approved (needs the right to decide). */
  approved: boolean;
}

/** One day of the signed-in person's own attendance. code is null for a day not marked yet. */
export interface HrMyAttendanceDay {
  date: IsoDate;
  status: HrDayStatus | null;
  timeIn: string | null;
  timeOut: string | null;
  lateMinutes: number;
  leaveType: string | null;
  /** Holiday name, or "Sunday". */
  closed: string | null;
}

/** The signed-in person's own staff attendance for a month, from HR (teacher app › More › My attendance). */
export interface HrMyAttendance {
  staffId: string;
  name: string;
  campus: CampusCode;
  /** "2026-11" */
  month: string;
  /** School days up to today (or the month's end). */
  workingDays: number;
  present: number;
  late: number;
  absent: number;
  leave: number;
  halfDay: number;
  lateMinutes: number;
  percent: number | null;
  /** Day by day, up to today. */
  days: HrMyAttendanceDay[];
}

/** The signed-in person's own leave (teacher app). */
export interface HrMyLeave {
  staffId: string;
  name: string;
  campus: CampusCode;
  balances: HrLeaveBalance[];
  requests: HrLeaveRequest[];
  types: HrLeaveType[];
}

/* ================================================================== Increments */

export type HrIncrementMethod = "CRITERIA" | "PERCENT" | "FIXED";

export const HR_INCREMENT_METHOD_LABEL: Record<HrIncrementMethod, string> = {
  CRITERIA: "By pay scale and years of service",
  PERCENT: "Percentage of basic",
  FIXED: "Same amount for everyone",
};

/** DRAFT → PENDING (sent for approval) → APPROVED (salaries change from the effective date) or back to DRAFT. */
export type HrRunStatus = "DRAFT" | "PENDING" | "APPROVED";

export interface HrIncrementCriteria {
  id: string;
  payScale: string;
  /** Half-open band: from ≤ years < to. */
  fromYears: number;
  toYears: number;
  amount: Rupees;
  active: boolean;
}

export interface HrIncrementLine {
  staffId: string;
  name: string;
  employeeNo: string;
  designation: string;
  payScale: string | null;
  serviceYears: number;
  currentBasic: Rupees;
  /** One increment's amount (criteria amount, % of basic, or the fixed amount). */
  perIncrement: Rupees;
  increments: number;
  special: Rupees;
  increase: Rupees;
  newBasic: Rupees;
  percent: number;
  included: boolean;
  /** Why someone is left out or flagged. */
  note: string | null;
}

export interface HrIncrementRunSummary {
  id: string;
  campus: CampusCode;
  campusName: string;
  session: number;
  title: string;
  method: HrIncrementMethod;
  value: number | null;
  effectiveFrom: IsoDate;
  status: HrRunStatus;
  staff: number;
  monthlyIncrease: Rupees;
  preparedBy: string;
  preparedAt: IsoDateTime;
  decidedBy: string | null;
  decidedAt: IsoDateTime | null;
}

/** Who a run covers. `teachingLevel` keeps staff who teach that level (legacy "Level"). */
export interface HrIncrementFilter {
  category: HrCategory | null;
  designationId: string | null;
  payScale: string | null;
  teachingLevel: string | null;
}

export interface HrIncrementRun extends HrIncrementRunSummary {
  experienceAsOf: IsoDate;
  filter: HrIncrementFilter;
  lines: HrIncrementLine[];
  totals: { currentBasic: Rupees; newBasic: Rupees; monthlyIncrease: Rupees; yearlyCost: Rupees; averagePercent: number | null; excluded: number };
  decisionNote: string | null;
  history: HrAuditEntry[];
}

export interface HrIncrementInput {
  campus: CampusCode;
  session: number;
  title: string;
  method: HrIncrementMethod;
  /** Percent (PERCENT) or rupees (FIXED); null for CRITERIA. */
  value: number | null;
  filter: HrIncrementFilter;
  experienceAsOf: IsoDate;
  effectiveFrom: IsoDate;
}

export interface HrIncrementData {
  runs: HrIncrementRunSummary[];
  criteria: HrIncrementCriteria[];
}

/* ================================================================== Payroll */

export type HrPayrollStatus = "DRAFT" | "PENDING" | "APPROVED" | "PAID";

export const HR_PAYROLL_STATUS_LABEL: Record<HrPayrollStatus, string> = {
  DRAFT: "Being prepared",
  PENDING: "Waiting for approval",
  APPROVED: "Approved — not paid yet",
  PAID: "Paid",
};

export interface HrPayLine {
  code: string;
  label: string;
  amount: Rupees;
  note?: string;
}

export interface HrPayslip {
  staffId: string;
  name: string;
  employeeNo: string;
  /** 13 digits; printed on the slip (legacy salary card). */
  cnic: string;
  designationId: string;
  designation: string;
  department: string;
  payScale: string | null;
  /** Calendar days in the month. */
  monthDays: number;
  /** Days paid for (less when someone joined or left during the month). */
  paidDays: number;
  presentDays: number;
  leaveDays: number;
  unpaidDays: number;
  lateCount: number;
  /** Working days in the month with no attendance marked (paid as present). */
  notMarkedDays?: number;
  earnings: HrPayLine[];
  deductions: HrPayLine[];
  gross: Rupees;
  totalDeductions: Rupees;
  net: Rupees;
  paymentMethod: HrPaymentMethod;
  bank: HrBankAccount | null;
  flags: string[];
  bonus: Rupees;
  fine: Rupees;
  note: string | null;
  hold: boolean;
  /** A held salary paid after the sheet was paid: the date it was handed over. */
  paidOn: IsoDate | null;
}

export interface HrPayrollRunSummary {
  id: string;
  campus: CampusCode;
  campusName: string;
  month: HrMonth;
  status: HrPayrollStatus;
  staff: number;
  gross: Rupees;
  deductions: Rupees;
  net: Rupees;
  preparedBy: string;
  preparedAt: IsoDateTime;
  decidedBy: string | null;
  decidedAt: IsoDateTime | null;
  paidBy: string | null;
  paymentDate: IsoDate | null;
}

export interface HrPayrollTotals {
  basic: Rupees;
  allowances: Rupees;
  bonus: Rupees;
  gross: Rupees;
  eobi: Rupees;
  providentFund: Rupees;
  tax: Rupees;
  loans: Rupees;
  childFee: Rupees;
  absence: Rupees;
  fines: Rupees;
  deductions: Rupees;
  net: Rupees;
  bank: Rupees;
  cash: Rupees;
  cheque: Rupees;
  held: Rupees;
}

export interface HrPayrollRun extends HrPayrollRunSummary {
  daysDivisor: number;
  lines: HrPayslip[];
  totals: HrPayrollTotals;
  warnings: string[];
  decisionNote: string | null;
  history: HrAuditEntry[];
}

export interface HrPayrollOverview {
  settings: HrCampusSettings | null;
  /** The session's months, oldest first, with the sheet for each (if any). */
  months: Array<{ month: HrMonth; run: HrPayrollRunSummary | null; canPrepare: boolean }>;
  /** Only with "All campuses". */
  campuses?: Array<{ campus: CampusCode; campusName: string; runsPayroll: boolean; staff: number; last: HrPayrollRunSummary | null }>;
}

export interface HrPayslipInput {
  bonus: Rupees;
  fine: Rupees;
  note: string | null;
  hold: boolean;
}

export interface HrBankList {
  runId: string;
  month: HrMonth;
  campus: CampusCode;
  campusName: string;
  paymentDate: IsoDate | null;
  schoolAccount: { bankName: string; branch: string; accountTitle: string; accountNo: string } | null;
  rows: Array<{ staffId: string; name: string; employeeNo: string; bankName: string; branch: string; accountTitle: string; accountNo: string; amount: Rupees }>;
  total: Rupees;
  others: Array<{ staffId: string; name: string; employeeNo: string; method: HrPaymentMethod | "HELD"; amount: Rupees }>;
}

export interface HrSalaryStructureRow {
  staffId: string;
  name: string;
  employeeNo: string;
  designation: string;
  category: HrCategory;
  payScale: string | null;
  basic: Rupees;
  allowances: Rupees;
  standingDeductions: Rupees;
  gross: Rupees;
  net: Rupees;
  paymentMethod: HrPaymentMethod;
  bankName: string | null;
  lastChange: IsoDate;
  pendingChange: { effectiveFrom: IsoDate; basic: Rupees } | null;
}

/* ================================================================== Loans and advances */

export interface HrLoanType {
  id: string;
  name: string;
  /** ADVANCE: taken back from the next salary. LOAN: paid back in monthly installments. */
  kind: "ADVANCE" | "LOAN";
  /** Up to this many months' basic pay. */
  maxTimesBasic: number;
  maxInstallments: number;
  active: boolean;
}

export type HrLoanStatus = "PENDING" | "ACTIVE" | "CLOSED" | "REJECTED";

export interface HrLoanSummary {
  id: string;
  loanNo: string;
  typeName: string;
  kind: "ADVANCE" | "LOAN";
  principal: Rupees;
  installment: Rupees;
  installments: number;
  recovered: Rupees;
  balance: Rupees;
  status: HrLoanStatus;
  firstMonth: HrMonth;
}

export interface HrLoanRecovery {
  id: string;
  month: HrMonth;
  date: IsoDate;
  amount: Rupees;
  source: "PAYROLL" | "CASH";
  reference: string;
}

export interface HrLoan extends HrLoanSummary {
  staffId: string;
  staffName: string;
  employeeNo: string;
  designationId: string;
  designation: string;
  campus: CampusCode;
  campusName: string;
  typeId: string;
  reason: string;
  requestedBy: string;
  requestedAt: IsoDateTime;
  decidedBy: string | null;
  decidedAt: IsoDateTime | null;
  decisionNote: string | null;
  recoveries: HrLoanRecovery[];
  schedule: Array<{ month: HrMonth; amount: Rupees; status: "RECOVERED" | "DUE" | "UPCOMING" }>;
  history: HrAuditEntry[];
}

export interface HrLoanData {
  loans: HrLoan[];
  types: HrLoanType[];
  summary: { outstanding: Rupees; active: number; pending: number; recoveredThisSession: Rupees; nextDeduction: Rupees };
}

export interface HrLoanInput {
  campus: CampusCode;
  staffId: string;
  typeId: string;
  amount: Rupees;
  installments: number;
  firstMonth: HrMonth;
  reason: string;
}

/* ================================================================== Reports */

export interface HrStrengthReport {
  campuses: CampusCode[];
  rows: Array<{ designationId: string; designation: string; category: HrCategory; byCampus: Partial<Record<CampusCode, number>>; total: number; female: number; male: number }>;
  /** total = posts filled (a person at two campuses counts twice); people = distinct staff. */
  totals: { byCampus: Partial<Record<CampusCode, number>>; total: number; people: number; female: number; male: number };
  byCategory: Array<{ category: HrCategory; count: number }>;
}

export interface HrExperienceParams {
  /** Service is counted up to this date (legacy "Till Date"); today when left out. */
  asOf?: IsoDate;
  /** Only staff who teach this level. */
  level?: string;
  gender?: HrGender;
}

export interface HrExperienceReport {
  asOf: IsoDate;
  rows: Array<{
    staffId: string;
    name: string;
    employeeNo: string;
    designation: string;
    payScale: string | null;
    joiningDate: IsoDate;
    mtbYears: number;
    priorYears: number;
    totalYears: number;
    /** Pay roles only: basic pay on the as-of date, the increment-table amount for the scale and service, and the two added. */
    basic?: Rupees;
    incrementDue?: Rupees;
    newBasic?: Rupees;
  }>;
  bands: Array<{ label: string; count: number }>;
}

export interface HrSalaryHistoryParams {
  from: HrMonth;
  to: HrMonth;
  designationId?: string;
  staffId?: string;
}

/** Net salary paid to each person, month by month (legacy "Staff Wise Salary Payment Report"). */
export interface HrSalaryHistory {
  months: HrMonth[];
  rows: Array<{ staffId: string; name: string; employeeNo: string; designationId: string; designation: string; byMonth: Partial<Record<HrMonth, Rupees>>; total: Rupees }>;
  totals: { byMonth: Partial<Record<HrMonth, Rupees>>; total: Rupees };
  /** Months in the range with no approved or paid sheet. */
  missing: HrMonth[];
}

export interface HrAttendanceRangeParams {
  from: IsoDate;
  to: IsoDate;
  designationId?: string;
  staffId?: string;
}

/* ================================================================== Settings */

export interface HrDesignation {
  id: string;
  title: string;
  category: HrCategory;
  active: boolean;
  /** Active staff with this designation (all campuses). */
  staff: number;
}

export interface HrDepartment {
  id: string;
  title: string;
  active: boolean;
  staff: number;
}

export interface HrCampusSettings {
  campus: CampusCode;
  campusName: string;
  /** Salaries are prepared in the system for this campus. */
  runsPayroll: boolean;
  /** Staff punch in on a fingerprint machine. */
  attendanceDevice: boolean;
  deviceName: string | null;
  dayStarts: string;
  graceMinutes: number;
  /** One day's pay = monthly pay ÷ this (legacy: 26). */
  daysDivisor: number;
  /** Every `lates` late arrivals cost `days` of pay; null = no deduction. */
  lateRule: { lates: number; days: number } | null;
  /** Salaries are paid on this day of the next month. */
  salaryDay: number;
  schoolAccount: { bankName: string; branch: string; accountTitle: string; accountNoMasked: string } | null;
}

export interface HrPayDefaults {
  /** House rent as % of basic for postings with a pay scale. */
  houseRentPct: number;
  /** House rent as % of basic for postings without a pay scale (support staff). */
  houseRentPctNoScale: number;
  conveyance: Rupees;
  medical: Rupees;
  eobi: Rupees;
  providentFundPct: number;
}

export interface HrSettings {
  designations: HrDesignation[];
  departments: HrDepartment[];
  leaveTypes: HrLeaveType[];
  loanTypes: HrLoanType[];
  criteria: HrIncrementCriteria[];
  payDefaults: HrPayDefaults;
  campuses: HrCampusSettings[];
  payScales: string[];
  /** Academic level names (acad.Level: Montessori, Primary, … Masters); staff teaching levels and increment filters use these labels. */
  teachingLevels: string[];
  subjects: Array<{ id: string; name: string }>;
  banks: string[];
  rowVer: number;
  updatedBy: string;
  updatedAt: IsoDateTime;
}

export type HrSettingsSection = "designations" | "departments" | "leaveTypes" | "loanTypes" | "criteria" | "payDefaults" | "campus";

/* ================================================================== Client */

const q = (ctx: Ctx, extra: Record<string, string | number | undefined> = {}) => ({ ...ctxQuery(ctx), ...extra });

export const hrApi = {
  overview: (ctx: Ctx) => apiFetch<HrOverview>("/hr/overview", { query: q(ctx) }),
  staff: (ctx: Ctx) => apiFetch<HrStaffSummary[]>("/hr/staff", { query: q(ctx) }),
  profile: (ctx: Ctx, id: string) => apiFetch<HrStaffProfile>(`/hr/staff/${encodeURIComponent(id)}`, { query: q(ctx) }),
  checkCnic: (cnic: string) => apiFetch<{ match: HrDuplicateDetails | null }>("/hr/staff/check-cnic", { query: { cnic } }),
  create: (body: HrNewStaffInput, idempotencyKey: string) => apiFetch<HrStaffProfile>("/hr/staff", { method: "POST", body, idempotencyKey }),
  updatePersonal: (id: string, body: HrPersonalInput & { rowVer: number }) => apiFetch<HrStaffProfile>(`/hr/staff/${id}/personal`, { method: "PUT", body }),
  addPosting: (id: string, body: HrPostingInput) => apiFetch<HrStaffProfile>(`/hr/staff/${id}/postings`, { method: "POST", body }),
  /** Brings back someone who has left, on the same record: a new main (salary) posting at `campus`. 409 NOT_LEFT while they still work here. */
  rejoin: (id: string, body: HrPostingInput) => apiFetch<HrStaffProfile>(`/hr/staff/${id}/rejoin`, { method: "POST", body }),
  endPosting: (id: string, postingId: string, body: { endDate: IsoDate; reason: string }) => apiFetch<HrStaffProfile>(`/hr/staff/${id}/postings/${postingId}/end`, { method: "POST", body }),
  setQualifications: (id: string, body: { qualifications: HrQualification[]; experience: HrExperience[] }) => apiFetch<HrStaffProfile>(`/hr/staff/${id}/qualifications`, { method: "PUT", body }),
  setTeaching: (id: string, body: { teachingLevels: string[]; subjectIds: string[] }) => apiFetch<HrStaffProfile>(`/hr/staff/${id}/teaching`, { method: "PUT", body }),
  setPay: (ctx: Ctx, id: string, body: HrPayInput) => apiFetch<HrStaffProfile>(`/hr/staff/${id}/pay`, { method: "PUT", body, query: q(ctx) }),
  addDocument: (id: string, body: { kind: HrDocumentKind; title: string; fileName: string; sizeKb: number }) => apiFetch<HrStaffProfile>(`/hr/staff/${id}/documents`, { method: "POST", body }),
  removeDocument: (id: string, docId: string) => apiFetch<HrStaffProfile>(`/hr/staff/${id}/documents/${docId}`, { method: "DELETE" }),
  markLeft: (id: string, body: { date: IsoDate; reason: string }) => apiFetch<HrStaffProfile>(`/hr/staff/${id}/leaving`, { method: "POST", body }),

  attendanceDay: (campus: CampusCode, date: IsoDate) => apiFetch<HrAttendanceDay>("/hr/attendance/day", { query: { campus, date } }),
  saveAttendance: (body: { campus: CampusCode; date: IsoDate; entries: HrDayEntryInput[]; reason: string }) => apiFetch<HrAttendanceDay>("/hr/attendance/day", { method: "PUT", body }),
  attendanceMonth: (campus: CampusCode, month: HrMonth) => apiFetch<HrAttendanceMonth>("/hr/attendance/month", { query: { campus, month } }),
  attendanceRange: (campus: CampusCode, p: HrAttendanceRangeParams) => apiFetch<HrAttendanceRange>("/hr/attendance/range", { query: { campus, from: p.from, to: p.to, designationId: p.designationId, staffId: p.staffId } }),
  importPreview: (body: { campus: CampusCode; fileName: string; text: string }) => apiFetch<HrImportPreview>("/hr/attendance/import/preview", { method: "POST", body }),
  importCommit: (body: HrImportCommitInput, idempotencyKey: string) => apiFetch<HrImportResult>("/hr/attendance/import/commit", { method: "POST", body, idempotencyKey }),
  imports: (campus: CampusCode) => apiFetch<HrImportBatch[]>("/hr/attendance/imports", { query: { campus } }),

  leave: (ctx: Ctx) => apiFetch<HrLeaveData>("/hr/leave", { query: q(ctx) }),
  leaveBalances: (ctx: Ctx) => apiFetch<HrLeaveBalanceRow[]>("/hr/leave/balances", { query: q(ctx) }),
  requestLeave: (body: HrLeaveInput, idempotencyKey: string) => apiFetch<HrLeaveRequest>("/hr/leave", { method: "POST", body, idempotencyKey }),
  decideLeave: (id: string, body: { approve: boolean; note: string }) => apiFetch<HrLeaveRequest>(`/hr/leave/${id}/decide`, { method: "POST", body }),
  cancelLeave: (id: string, body: { reason: string }) => apiFetch<HrLeaveRequest>(`/hr/leave/${id}/cancel`, { method: "POST", body }),
  /** The signed-in person's own leave. 404 NOT_LINKED without a staff record. */
  myLeave: () => apiFetch<HrMyLeave>("/hr/leave/mine"),
  /** The signed-in person's own attendance for a month (this month when left out). 404 NOT_LINKED without a staff record. */
  myAttendance: (month?: string) => apiFetch<HrMyAttendance>("/hr/attendance/mine", { query: { month } }),
  requestMyLeave: (body: { typeId: string; from: IsoDate; to: IsoDate; halfDay: boolean; reason: string }, idempotencyKey: string) =>
    apiFetch<HrLeaveRequest>("/hr/leave/mine", { method: "POST", body, idempotencyKey }),

  increments: (ctx: Ctx) => apiFetch<HrIncrementData>("/hr/increments", { query: q(ctx) }),
  increment: (id: string) => apiFetch<HrIncrementRun>(`/hr/increments/${id}`),
  createIncrement: (body: HrIncrementInput, idempotencyKey: string) => apiFetch<HrIncrementRun>("/hr/increments", { method: "POST", body, idempotencyKey }),
  updateIncrementLine: (id: string, staffId: string, body: { increments: number; special: Rupees; included: boolean }) =>
    apiFetch<HrIncrementRun>(`/hr/increments/${id}/lines/${staffId}`, { method: "PATCH", body }),
  /** Same number of increments and/or special increment for everyone included in a draft run. */
  updateIncrementLines: (id: string, body: { increments?: number; special?: Rupees }) => apiFetch<HrIncrementRun>(`/hr/increments/${id}/lines`, { method: "PATCH", body }),
  submitIncrement: (id: string) => apiFetch<HrIncrementRun>(`/hr/increments/${id}/submit`, { method: "POST" }),
  decideIncrement: (id: string, body: { approve: boolean; note: string }) => apiFetch<HrIncrementRun>(`/hr/increments/${id}/decide`, { method: "POST", body }),
  deleteIncrement: (id: string) => apiFetch<{ status: "ok" }>(`/hr/increments/${id}`, { method: "DELETE" }),

  payroll: (ctx: Ctx) => apiFetch<HrPayrollOverview>("/hr/payroll", { query: q(ctx) }),
  payrollRun: (id: string) => apiFetch<HrPayrollRun>(`/hr/payroll/runs/${id}`),
  preparePayroll: (body: { campus: CampusCode; month: HrMonth }, idempotencyKey: string) => apiFetch<HrPayrollRun>("/hr/payroll/runs", { method: "POST", body, idempotencyKey }),
  updatePayslip: (id: string, staffId: string, body: HrPayslipInput) => apiFetch<HrPayrollRun>(`/hr/payroll/runs/${id}/lines/${staffId}`, { method: "PATCH", body }),
  recalculatePayroll: (id: string) => apiFetch<HrPayrollRun>(`/hr/payroll/runs/${id}/recalculate`, { method: "POST" }),
  submitPayroll: (id: string) => apiFetch<HrPayrollRun>(`/hr/payroll/runs/${id}/submit`, { method: "POST" }),
  decidePayroll: (id: string, body: { approve: boolean; note: string }) => apiFetch<HrPayrollRun>(`/hr/payroll/runs/${id}/decide`, { method: "POST", body }),
  payPayroll: (id: string, body: { paymentDate: IsoDate }, idempotencyKey: string) => apiFetch<HrPayrollRun>(`/hr/payroll/runs/${id}/pay`, { method: "POST", body, idempotencyKey }),
  /** Pays one held salary after the sheet has been paid. */
  releaseHeld: (runId: string, staffId: string, body: { paymentDate: IsoDate }, idempotencyKey: string) =>
    apiFetch<HrPayrollRun>(`/hr/payroll/runs/${runId}/lines/${staffId}/release`, { method: "POST", body, idempotencyKey }),
  bankList: (id: string) => apiFetch<HrBankList>(`/hr/payroll/runs/${id}/bank-list`),
  structures: (ctx: Ctx) => apiFetch<HrSalaryStructureRow[]>("/hr/payroll/structures", { query: q(ctx) }),

  loans: (ctx: Ctx) => apiFetch<HrLoanData>("/hr/loans", { query: q(ctx) }),
  requestLoan: (body: HrLoanInput, idempotencyKey: string) => apiFetch<HrLoan>("/hr/loans", { method: "POST", body, idempotencyKey }),
  decideLoan: (id: string, body: { approve: boolean; note: string }) => apiFetch<HrLoan>(`/hr/loans/${id}/decide`, { method: "POST", body }),
  repayLoan: (id: string, body: { amount: Rupees; date: IsoDate; note: string }, idempotencyKey: string) => apiFetch<HrLoan>(`/hr/loans/${id}/repay`, { method: "POST", body, idempotencyKey }),

  strength: (ctx: Ctx) => apiFetch<HrStrengthReport>("/hr/reports/strength", { query: q(ctx) }),
  experience: (ctx: Ctx, p: HrExperienceParams = {}) => apiFetch<HrExperienceReport>("/hr/reports/experience", { query: q(ctx, { asOf: p.asOf, level: p.level, gender: p.gender }) }),
  salaryHistory: (ctx: Ctx, p: HrSalaryHistoryParams) => apiFetch<HrSalaryHistory>("/hr/reports/salary-history", { query: q(ctx, { from: p.from, to: p.to, designationId: p.designationId, staffId: p.staffId }) }),

  settings: () => apiFetch<HrSettings>("/hr/settings"),
  saveSettings: (section: HrSettingsSection, body: { value: unknown; rowVer: number }) => apiFetch<HrSettings>(`/hr/settings/${section}`, { method: "PUT", body }),
};

export const hrQueries = {
  overview: (ctx: Ctx) => queryOptions({ queryKey: ["hr", ...ctxKey(ctx), "overview"], queryFn: () => hrApi.overview(ctx) }),
  staff: (ctx: Ctx) => queryOptions({ queryKey: ["hr", ...ctxKey(ctx), "staff"], queryFn: () => hrApi.staff(ctx) }),
  profile: (ctx: Ctx, id: string) => queryOptions({ queryKey: ["hr", ...ctxKey(ctx), "staff", id], queryFn: () => hrApi.profile(ctx, id) }),
  attendanceDay: (ctx: Ctx, date: IsoDate) =>
    queryOptions({ queryKey: ["hr", ...ctxKey(ctx), "attendance", "day", date], queryFn: () => hrApi.attendanceDay(ctx.campus as CampusCode, date), enabled: ctx.campus !== "ALL" }),
  attendanceMonth: (ctx: Ctx, month: HrMonth) =>
    queryOptions({ queryKey: ["hr", ...ctxKey(ctx), "attendance", "month", month], queryFn: () => hrApi.attendanceMonth(ctx.campus as CampusCode, month), enabled: ctx.campus !== "ALL" }),
  attendanceRange: (ctx: Ctx, p: HrAttendanceRangeParams) =>
    queryOptions({
      queryKey: ["hr", ...ctxKey(ctx), "attendance", "range", p.from, p.to, p.designationId ?? "", p.staffId ?? ""],
      queryFn: () => hrApi.attendanceRange(ctx.campus as CampusCode, p),
      enabled: ctx.campus !== "ALL" && p.from !== "" && p.to !== "" && p.from <= p.to,
      retry: false,
    }),
  imports: (ctx: Ctx) => queryOptions({ queryKey: ["hr", ...ctxKey(ctx), "attendance", "imports"], queryFn: () => hrApi.imports(ctx.campus as CampusCode), enabled: ctx.campus !== "ALL" }),
  leave: (ctx: Ctx) => queryOptions({ queryKey: ["hr", ...ctxKey(ctx), "leave"], queryFn: () => hrApi.leave(ctx) }),
  leaveBalances: (ctx: Ctx) => queryOptions({ queryKey: ["hr", ...ctxKey(ctx), "leave", "balances"], queryFn: () => hrApi.leaveBalances(ctx) }),
  myLeave: () => queryOptions({ queryKey: ["hr", "my-leave"], queryFn: hrApi.myLeave, retry: false }),
  myAttendance: (month?: string) => queryOptions({ queryKey: ["hr", "my-attendance", month ?? "this"], queryFn: () => hrApi.myAttendance(month), retry: false }),
  increments: (ctx: Ctx) => queryOptions({ queryKey: ["hr", ...ctxKey(ctx), "increments"], queryFn: () => hrApi.increments(ctx) }),
  increment: (id: string) => queryOptions({ queryKey: ["hr", "increment", id], queryFn: () => hrApi.increment(id), enabled: id !== "" }),
  payroll: (ctx: Ctx) => queryOptions({ queryKey: ["hr", ...ctxKey(ctx), "payroll"], queryFn: () => hrApi.payroll(ctx) }),
  payrollRun: (id: string) => queryOptions({ queryKey: ["hr", "payroll-run", id], queryFn: () => hrApi.payrollRun(id), enabled: id !== "" }),
  bankList: (id: string) => queryOptions({ queryKey: ["hr", "payroll-run", id, "bank"], queryFn: () => hrApi.bankList(id), enabled: id !== "" }),
  structures: (ctx: Ctx) => queryOptions({ queryKey: ["hr", ...ctxKey(ctx), "structures"], queryFn: () => hrApi.structures(ctx) }),
  loans: (ctx: Ctx) => queryOptions({ queryKey: ["hr", ...ctxKey(ctx), "loans"], queryFn: () => hrApi.loans(ctx) }),
  strength: (ctx: Ctx) => queryOptions({ queryKey: ["hr", ...ctxKey(ctx), "strength"], queryFn: () => hrApi.strength(ctx) }),
  experience: (ctx: Ctx, p: HrExperienceParams = {}) => queryOptions({ queryKey: ["hr", ...ctxKey(ctx), "experience", p.asOf ?? "", p.level ?? "", p.gender ?? ""], queryFn: () => hrApi.experience(ctx, p) }),
  salaryHistory: (ctx: Ctx, p: HrSalaryHistoryParams) =>
    queryOptions({ queryKey: ["hr", ...ctxKey(ctx), "salary-history", p.from, p.to, p.designationId ?? "", p.staffId ?? ""], queryFn: () => hrApi.salaryHistory(ctx, p), enabled: p.from !== "" && p.to !== "" }),
  settings: () => queryOptions({ queryKey: ["hr", "settings"], queryFn: hrApi.settings, staleTime: 60_000 }),
};

/* ================================================================== Pure helpers (shared by screens and mocks) */

/** "2026-10" → "October 2026" */
export function hrMonthLabel(month: HrMonth): string {
  const [y, m] = month.split("-").map(Number);
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${names[(m ?? 1) - 1]} ${y}`;
}

/** "2026-10" → "Oct" */
export function hrMonthShort(month: HrMonth): string {
  return hrMonthLabel(month).slice(0, 3);
}

/** The twelve months of a session (April to March): 2026 → 2026-04 … 2027-03. */
export function hrSessionMonths(session: number): HrMonth[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((3 + i) % 12) + 1;
    const y = session + (3 + i >= 12 ? 1 : 0);
    return `${y}-${String(m).padStart(2, "0")}`;
  });
}

/** Income tax on a monthly salary, worked out on the yearly figure (salaried slabs; the accountant confirms each budget). */
export function hrMonthlyTax(monthlyGross: Rupees): Rupees {
  const y = monthlyGross * 12;
  let tax = 0;
  if (y <= 600_000) tax = 0;
  else if (y <= 1_200_000) tax = (y - 600_000) * 0.01;
  else if (y <= 2_200_000) tax = 6_000 + (y - 1_200_000) * 0.11;
  else if (y <= 3_200_000) tax = 116_000 + (y - 2_200_000) * 0.23;
  else tax = 346_000 + (y - 3_200_000) * 0.3;
  return Math.round(tax / 12);
}

/** Campus scope helper for screens: a campus code or null for "All campuses". */
export const hrCampusOrNull = (c: CampusScope): CampusCode | null => (c === "ALL" ? null : c);
