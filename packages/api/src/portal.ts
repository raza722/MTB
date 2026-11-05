// Parent and student portal: one-time SMS code sign-in, children, fees, attendance, results, notices, contacts.
// Parents and students never pick a campus or session: every request names one child (by G.R. number), the server
// checks the child is linked to the signed-in account, and the child's campus and current session come with it.
// Query keys still carry the session, so a new session never shows last session's cached pages.
import type { AttendanceCode, AttendanceSummary, IsoDate, IsoDateTime, Rupees } from "@mtb/domain";
import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { CURRENT_SESSION, type CampusCode } from "./context";
import type { ExamsCategory } from "./exams";
import type { FeeVoucher } from "./fee-setup";
import type { PaymentMethod, Receipt } from "./fees";
import type { NoticeCategory } from "./notices";

export type PortalLang = "en" | "ur";
export type PortalAccountKind = "PARENT" | "STUDENT";
export type PortalRelation = "Father" | "Mother" | "Guardian";

/** A child as the portal shows it in the switcher and page headers. */
export interface PortalChild {
  grNo: string;
  name: string;
  /** Empty when the school has no Urdu spelling on record. */
  nameUr: string;
  relation: "s/o" | "d/o";
  gender: "M" | "F";
  campus: CampusCode;
  campusName: string;
  campusNameUr: string;
  classSection: string;
  rollNo: number;
  /** Start year of the child's current session (2026 = 2026–27). */
  session: number;
  /** For the switcher: what is due now. */
  due: Rupees;
  feeStatus: "paid" | "unpaid" | "overdue";
}

/** The signed-in parent or student. Students see only themselves. */
export interface PortalAccount {
  id: string;
  kind: PortalAccountKind;
  name: string;
  nameUr: string;
  relation?: PortalRelation;
  /** The family's registered mobile, "03001234567": codes and school SMS go here. */
  mobile: string;
  children: PortalChild[];
  /** Language of SMS from the school (set by the parent). */
  smsLanguage: PortalLang;
  signedInAt: IsoDateTime;
  /** The sign-in before this one. */
  lastSignInAt?: IsoDateTime;
}

// ---------------------------------------------------------------------------------------------------------
// Sign-in with a one-time SMS code
// ---------------------------------------------------------------------------------------------------------

export type PortalCodeRequest = { kind: "PARENT"; mobile: string } | { kind: "STUDENT"; grNo: string };

export interface PortalChallenge {
  challengeId: string;
  kind: PortalAccountKind;
  /** "0300-•••••67" */
  maskedPhone: string;
  /** The code stops working at this moment (5 minutes). */
  expiresAt: IsoDateTime;
  /** A new code can be asked for after this many seconds. */
  resendAfterSec: number;
}

/** Error codes the sign-in pages turn into plain English or Urdu. */
export type PortalAuthErrorCode = "NOT_REGISTERED" | "GR_NOT_FOUND" | "PORTAL_NOT_ENABLED" | "CODE_INVALID" | "CODE_LOCKED" | "CODE_EXPIRED" | "TOO_SOON" | "VALIDATION";

export interface PortalCodeErrorDetails {
  attemptsLeft: number;
}

/** Mock mode only: who can sign in to the demo and the one-time code (the real server never sends this). */
export interface PortalDemoHint {
  code: string;
  parents: Array<{ name: string; mobile: string; children: string[] }>;
  students: Array<{ name: string; grNo: string; classSection: string; campusName: string }>;
}

// ---------------------------------------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------------------------------------

export interface PortalNotice {
  id: string;
  title: string;
  titleUr: string;
  body: string;
  bodyUr: string;
  /** The day the notice is about (holiday, meeting, deadline). */
  date: IsoDate;
  publishedAt: IsoDateTime;
  publishedBy: string;
  publishedByUr?: string;
  category: NoticeCategory;
  pinned: boolean;
  /** Opened by this account. */
  read: boolean;
}

export interface PortalResultSubject {
  subject: string;
  subjectUr: string;
  /** null when absent. */
  obtained: number | null;
  max: number;
  grade: string;
  absent?: boolean;
}

export interface PortalResult {
  examId: string;
  exam: string;
  examUr: string;
  category: ExamsCategory;
  session: number;
  classSection: string;
  declaredOn: IsoDate;
  obtained: number;
  total: number;
  percent: number;
  grade: string;
  /** Position in the class-section, when the exam ranks. */
  position?: number;
  subjects: PortalResultSubject[];
}

export type PortalResultSummary = Omit<PortalResult, "subjects">;

export interface PortalHome {
  child: PortalChild;
  today: IsoDate;
  fees: {
    due: Rupees;
    /** The part of `due` that is past its due date (with fines). */
    overdue: Rupees;
    /** Earliest due date of what is still open. */
    payBy: IsoDate | null;
    status: "paid" | "unpaid" | "overdue";
    lastReceipt: { receiptNo: string; postedAt: IsoDateTime; total: Rupees } | null;
  };
  attendance: {
    date: IsoDate;
    /** null: the register is not marked yet. */
    code: AttendanceCode | null;
    holiday?: { name: string; nameUr: string };
    month: AttendanceSummary;
  };
  result: PortalResultSummary | null;
  /** Newest first, pinned on top, at most three. */
  notices: PortalNotice[];
  unreadNotices: number;
}

export interface PortalDue {
  chargeId: string;
  head: string;
  headUr: string;
  dueDate: IsoDate;
  amount: Rupees;
  /** Late fine up to today (Rs 10 a day from the day after the due date). */
  lateFine: Rupees;
  daysOverdue: number;
  total: Rupees;
  status: "unpaid" | "overdue";
}

export interface PortalReceiptRow {
  receiptNo: string;
  session: number;
  postedAt: IsoDateTime;
  total: Rupees;
  method: PaymentMethod["method"];
  heads: Array<{ head: string; headUr: string }>;
  status: Receipt["status"];
}

export interface PortalFees {
  child: PortalChild;
  today: IsoDate;
  dues: PortalDue[];
  totalDue: Rupees;
  lateFineSoFar: Rupees;
  payBy: IsoDate | null;
  finePerDay: Rupees;
  /** Bank shown on the voucher ("Meezan Bank, Sadiqabad Branch"). */
  bankName: string;
  session: { charged: Rupees; paid: Rupees };
  /** Newest first, this session and earlier ones. */
  receipts: PortalReceiptRow[];
}

/** A receipt as printed for the family: the counter's receipt plus when it was downloaded. */
export interface PortalReceipt extends Receipt {
  downloadedAt: IsoDateTime;
}

export interface PortalAttendanceMonth {
  child: PortalChild;
  /** "2026-11" */
  month: string;
  firstMonth: string;
  lastMonth: string;
  today: IsoDate;
  days: Partial<Record<IsoDate, AttendanceCode>>;
  holidays: Array<{ date: IsoDate; name: string; nameUr: string }>;
  summary: AttendanceSummary;
  /** Absent, leave and late days this month, oldest first. */
  marks: Array<{ date: IsoDate; code: "A" | "L" | "LT" }>;
  /** Every month of the session so far. */
  months: Array<{ month: string; schoolDays: number; percent: number | null; note?: string; noteUr?: string }>;
  sessionSummary: AttendanceSummary;
  classTeacher: string;
  classTeacherUr?: string;
  officePhone: string;
}

export interface PortalResults {
  child: PortalChild;
  latest: PortalResult | null;
  /** Earlier declared results, newest first (drafts and withheld results never appear). */
  earlier: PortalResult[];
}

export interface PortalNotices {
  child: PortalChild;
  notices: PortalNotice[];
  unread: number;
}

export interface PortalProfile {
  child: PortalChild & {
    dob: IsoDate;
    admissionDate: IsoDate;
    house?: string;
    houseUr?: string;
    father: string;
    fatherUr?: string;
    mother?: string;
    motherUr?: string;
  };
  guardian: { name: string; nameUr?: string; relation: string; mobile: string; address: string };
  school: {
    campusName: string;
    campusNameUr: string;
    address: string;
    addressUr: string;
    phone: string;
    principal: string;
    principalUr?: string;
    classTeacher: string;
    classTeacherUr?: string;
    /** "07:45" (24-hour) */
    assembly: string;
    dayStarts: string;
    dayEnds: string;
    officeOpens: string;
    officeCloses: string;
  };
}

export interface PortalPreferences {
  smsLanguage: PortalLang;
}

const child = (grNo: string) => `/portal/children/${encodeURIComponent(grNo)}`;

export const portalApi = {
  /** Mock mode only. */
  demo: () => apiFetch<PortalDemoHint>("/portal/demo"),
  requestCode: (body: PortalCodeRequest) => apiFetch<PortalChallenge>("/portal/auth/code", { method: "POST", body }),
  resendCode: (challengeId: string) => apiFetch<PortalChallenge>("/portal/auth/code/resend", { method: "POST", body: { challengeId } }),
  verifyCode: (body: { challengeId: string; code: string }) => apiFetch<PortalAccount>("/portal/auth/verify", { method: "POST", body }),
  session: () => apiFetch<PortalAccount>("/portal/session"),
  signOut: () => apiFetch<{ status: "ok" }>("/portal/auth/sign-out", { method: "POST" }),
  savePreferences: (body: PortalPreferences) => apiFetch<PortalAccount>("/portal/preferences", { method: "PUT", body }),

  home: (grNo: string) => apiFetch<PortalHome>(`${child(grNo)}/home`),
  fees: (grNo: string) => apiFetch<PortalFees>(`${child(grNo)}/fees`),
  receipt: (grNo: string, receiptNo: string) => apiFetch<PortalReceipt>(`${child(grNo)}/receipts/${encodeURIComponent(receiptNo)}`),
  voucher: (grNo: string) => apiFetch<FeeVoucher>(`${child(grNo)}/voucher`),
  attendance: (grNo: string, month: string) => apiFetch<PortalAttendanceMonth>(`${child(grNo)}/attendance`, { query: { month } }),
  results: (grNo: string) => apiFetch<PortalResults>(`${child(grNo)}/results`),
  notices: (grNo: string) => apiFetch<PortalNotices>(`${child(grNo)}/notices`),
  markNoticeRead: (grNo: string, noticeId: string) => apiFetch<{ unread: number }>(`${child(grNo)}/notices/${encodeURIComponent(noticeId)}/read`, { method: "POST" }),
  markAllNoticesRead: (grNo: string) => apiFetch<{ unread: number }>(`${child(grNo)}/notices/read-all`, { method: "POST" }),
  profile: (grNo: string) => apiFetch<PortalProfile>(`${child(grNo)}/profile`),
};

const key = (grNo: string, ...rest: Array<string | number>) => ["portal", "child", grNo, CURRENT_SESSION, ...rest] as const;

export const portalQueries = {
  /** Everything the portal caches starts with this key (cleared on sign-out). */
  all: () => ["portal"] as const,
  demo: () => queryOptions({ queryKey: ["portal", "demo"], queryFn: portalApi.demo, staleTime: Infinity, retry: false }),
  session: () => queryOptions({ queryKey: ["portal", "session"], queryFn: portalApi.session, retry: false, staleTime: 5 * 60_000 }),
  child: (grNo: string) => key(grNo),
  home: (grNo: string) => queryOptions({ queryKey: key(grNo, "home"), queryFn: () => portalApi.home(grNo) }),
  fees: (grNo: string) => queryOptions({ queryKey: key(grNo, "fees"), queryFn: () => portalApi.fees(grNo) }),
  receipt: (grNo: string, receiptNo: string) => queryOptions({ queryKey: key(grNo, "receipt", receiptNo), queryFn: () => portalApi.receipt(grNo, receiptNo) }),
  voucher: (grNo: string) => queryOptions({ queryKey: key(grNo, "voucher"), queryFn: () => portalApi.voucher(grNo) }),
  attendance: (grNo: string, month: string) => queryOptions({ queryKey: key(grNo, "attendance", month), queryFn: () => portalApi.attendance(grNo, month) }),
  results: (grNo: string) => queryOptions({ queryKey: key(grNo, "results"), queryFn: () => portalApi.results(grNo) }),
  notices: (grNo: string) => queryOptions({ queryKey: key(grNo, "notices"), queryFn: () => portalApi.notices(grNo) }),
  profile: (grNo: string) => queryOptions({ queryKey: key(grNo, "profile"), queryFn: () => portalApi.profile(grNo) }),
};
