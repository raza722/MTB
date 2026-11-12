// Parent and student portal: one-time SMS code sign-in, children, fees, attendance, results, notices, contacts.
// Parents and students never pick a campus or session: every request names one child (by G.R. number), the server
// checks the child is linked to the signed-in account, and the child's campus and current session come with it
// (PortalChild.campus / .session, resolved by the server on every call; the client never sends either).
//
// Session cookie (backend/docs/modules/12_portal.md D2, C4): verifyCode sets `mtb_portal` (HttpOnly, SameSite=Lax,
// Secure in production, Path=/api/portal), signOut clears it. It is separate from the staff `mtb_session`: a portal
// session never reaches a staff route and a staff session never reaches a portal route (401 UNAUTHENTICATED).
// apiFetch already sends cookies, so the client needs nothing else. No portal call carries an Idempotency-Key:
// requestCode / resendCode are rate-limited, markNoticeRead / markAllNoticesRead are idempotent by nature.
import type { AttendanceCode, AttendanceSummary, IsoDate, IsoDateTime, Rupees } from "@mtb/domain";
import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { CampusCode } from "./context";
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
  /** 0 when the school has not given a roll number (show "—"). */
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
  /** The sign-in before this one (omitted on the first sign-in). */
  lastSignInAt?: IsoDateTime;
}

// ---------------------------------------------------------------------------------------------------------
// Sign-in with a one-time SMS code
// ---------------------------------------------------------------------------------------------------------

/**
 * `mobile`: 11 digits starting with 03 (or +92 / 92…). `grNo`: the campus code, a dash and the G.R. number as the
 * school card prints it, letters allowed ("KC-14823", "KC-C-1234"; up to 20 characters, C5).
 * The server gives the same answer for a number or G.R. it does not know (no user enumeration, D6): a challenge whose
 * code never arrives. It may answer 429 TOO_SOON (details.waitSec) when codes are asked for too often (C3).
 */
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

/**
 * Error codes the sign-in pages turn into plain English or Urdu. The server never answers "this number / G.R. is not
 * registered" (C1): an unknown mobile or G.R. number gets an ordinary challenge whose code is always wrong.
 */
export type PortalAuthErrorCode = "CODE_INVALID" | "CODE_LOCKED" | "CODE_EXPIRED" | "TOO_SOON" | "VALIDATION";

/** `details` of 401 CODE_INVALID. */
export interface PortalCodeErrorDetails {
  attemptsLeft: number;
}

/** `details` of 429 TOO_SOON (requestCode and resendCode). */
export interface PortalTooSoonDetails {
  waitSec: number;
}

/**
 * Error codes of the child pages: 403 NOT_LINKED (the child is not on this account: unknown, another family's, left
 * the school), 404 NOT_FOUND (receipt, notice), 404 NO_DUES and 404 NO_VOUCHER (voucher, C2), 422 VALIDATION (month).
 */
export type PortalPageErrorCode = "NOT_LINKED" | "NOT_FOUND" | "NO_DUES" | "NO_VOUCHER" | "VALIDATION";

/** Mock mode only: who can sign in to the demo and the one-time code (the real server has no such endpoint: 404). */
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
  /** The child's campus's late fine rule in force (0: no fine). */
  finePerDay: Rupees;
  /** Bank shown on the voucher ("Meezan Bank, Sadiqabad Branch"); "" when the campus has none set. */
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
  /** "" when the section has no class teacher. */
  classTeacher: string;
  classTeacherUr?: string;
  /** "" when the campus has no phone on record. */
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
  /** `address` "" when the family has none on record. */
  guardian: { name: string; nameUr?: string; relation: string; mobile: string; address: string };
  school: {
    campusName: string;
    campusNameUr: string;
    address: string;
    /** "" when there is no Urdu address. */
    addressUr: string;
    /** "" when the campus has no phone on record. */
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
  /** The child's current voucher as the office issued it (module 6); 404 NO_DUES when nothing is due, 404 NO_VOUCHER when dues are open but no voucher is issued (C2). Never issues one. */
  voucher: (grNo: string) => apiFetch<FeeVoucher>(`${child(grNo)}/voucher`),
  attendance: (grNo: string, month: string) => apiFetch<PortalAttendanceMonth>(`${child(grNo)}/attendance`, { query: { month } }),
  results: (grNo: string) => apiFetch<PortalResults>(`${child(grNo)}/results`),
  notices: (grNo: string) => apiFetch<PortalNotices>(`${child(grNo)}/notices`),
  markNoticeRead: (grNo: string, noticeId: string) => apiFetch<{ unread: number }>(`${child(grNo)}/notices/${encodeURIComponent(noticeId)}/read`, { method: "POST" }),
  markAllNoticesRead: (grNo: string) => apiFetch<{ unread: number }>(`${child(grNo)}/notices/read-all`, { method: "POST" }),
  profile: (grNo: string) => apiFetch<PortalProfile>(`${child(grNo)}/profile`),
};

// The server picks the child's session; the cache is cleared on sign-out and pages go stale after 30 s.
const key = (grNo: string, ...rest: Array<string | number>) => ["portal", "child", grNo, ...rest] as const;

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
