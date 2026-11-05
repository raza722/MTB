import type { AttendanceCode, IsoDate, IsoDateTime, Rupees } from "@mtb/domain";
import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { ctxKey, ctxQuery, type CampusCode, type Ctx } from "./context";

export interface CampusComparisonRow {
  campus: CampusCode;
  name: string;
  attendancePercent: number;
  collected: Rupees;
  target: Rupees;
  arrears: Rupees;
}

/** One school day (Sundays are closed and left out). The last point is today, so far. */
export interface CollectionDay {
  date: IsoDate;
  amount: Rupees;
  receipts: number;
}

export interface AttendanceTrendDay {
  date: IsoDate;
  percent: number;
}

/** Attendance today by class (one campus) or by campus (all campuses). */
export interface AttendanceGroup {
  label: string;
  attended: number;
  marked: number;
  percent: number;
}

export type DashboardActivityKind = "RECEIPT" | "CANCELLATION" | "ATTENDANCE" | "CORRECTION" | "SMS" | "ADMISSION" | "RESULT";

export interface DashboardActivity {
  id: string;
  kind: DashboardActivityKind;
  at: IsoDateTime;
  campus: CampusCode;
  title: string;
  detail: string;
  by?: string;
  amount?: Rupees;
  /** A document the row opens, e.g. a receipt number. */
  receiptNo?: string;
}

export interface DashboardEvent {
  id: string;
  date: IsoDate;
  title: string;
  detail: string;
  kind: "FEE_DUE" | "LATE_FINE" | "TEST" | "EXAM" | "MEETING";
}

export interface DashboardSummary {
  attendance: { percent: number; present: number; total: number; deltaPts: number };
  feesToday: { amount: Rupees; receipts: number };
  month: { collected: Rupees; target: Rupees };
  arrears: { amount: Rupees; students: number };
  admissions: { session: number; week: number };
  sms: { delivered: number; failed: number; queued: number };
  /** Staff on roll today and how many came in (Staff & payroll attendance). present includes late arrivals. */
  staff?: { total: number; present: number; late: number; onLeave: number; notMarked: number };
  /** School days in the last 30 calendar days, oldest first. */
  collectionsTrend: CollectionDay[];
  /** Last 14 school days, oldest first; the last point is today. */
  attendanceTrend: AttendanceTrendDay[];
  /** Students by fee status this month. */
  feeStatus: { paid: number; unpaid: number; overdue: number };
  attendanceGroups: AttendanceGroup[];
  /** Newest first. */
  activity: DashboardActivity[];
  /** Soonest first. */
  upcoming: DashboardEvent[];
  /** Only with "All campuses". */
  campuses?: CampusComparisonRow[];
}

interface ApprovalBase {
  id: string;
  campus: CampusCode;
  campusName: string;
  requestedBy: string;
  requestedAt: IsoDateTime;
  student: { name: string; grNo: string; classSection: string };
  status: "PENDING" | "APPROVED" | "REJECTED";
  decidedBy?: string;
  decidedAt?: IsoDateTime;
}

export interface AttendanceCorrectionApproval extends ApprovalBase {
  kind: "ATTENDANCE_CORRECTION";
  date: IsoDate;
  from: AttendanceCode;
  to: AttendanceCode;
  reason: string;
}

export interface ReceiptCancellationApproval extends ApprovalBase {
  kind: "RECEIPT_CANCELLATION";
  cnNo: string;
  receiptNo: string;
  amount: Rupees;
  reason: string;
  note: string;
}

/** Cancel an unpaid one-off charge on a student's ledger (fee office request). */
export interface ChargeCancellationApproval extends ApprovalBase {
  kind: "CHARGE_CANCELLATION";
  chargeId: string;
  /** "Re-admission fee" */
  head: string;
  amount: Rupees;
  dueDate: IsoDate;
  reason: string;
}

export type Approval = AttendanceCorrectionApproval | ReceiptCancellationApproval | ChargeCancellationApproval;

export const dashboardApi = {
  summary: (ctx: Ctx) => apiFetch<DashboardSummary>("/dashboard", { query: ctxQuery(ctx) }),
  approvals: (ctx: Ctx) => apiFetch<Approval[]>("/approvals", { query: { ...ctxQuery(ctx), status: "PENDING" } }),
  decide: (id: string, decision: "APPROVE" | "REJECT", note?: string) => apiFetch<Approval>(`/approvals/${encodeURIComponent(id)}/decide`, { method: "POST", body: { decision, note } }),
};

export const dashboardQueries = {
  summary: (ctx: Ctx) => queryOptions({ queryKey: ["dashboard", ...ctxKey(ctx)], queryFn: () => dashboardApi.summary(ctx) }),
  approvals: (ctx: Ctx) => queryOptions({ queryKey: ["approvals", ...ctxKey(ctx)], queryFn: () => dashboardApi.approvals(ctx) }),
};
