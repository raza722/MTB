// Report centre (staff app → Reports): one catalogue of every report across modules, each opened on screen
// with filters and exported to PDF or Excel; large reports run as background jobs; reports can be scheduled;
// staff notifications ("Your report is ready") for the bell.
import type { IsoDate, IsoDateTime } from "@mtb/domain";
import { queryOptions } from "@tanstack/react-query";
import type { Permission } from "./auth";
import { apiFetch } from "./client";
import { ctxKey, ctxQuery, type CampusScope, type Ctx } from "./context";

export type ReportModule = "FEES" | "STUDENTS" | "ADMISSIONS" | "ATTENDANCE" | "EXAMS" | "ACCOUNTS" | "HR" | "TIMETABLE" | "LIBRARY" | "WAREHOUSE" | "TRANSPORT" | "MESSAGES";

export const REPORT_MODULES: ReportModule[] = ["FEES", "STUDENTS", "ADMISSIONS", "ATTENDANCE", "EXAMS", "ACCOUNTS", "HR", "TIMETABLE", "LIBRARY", "WAREHOUSE", "TRANSPORT", "MESSAGES"];

export const REPORT_MODULE_LABEL: Record<ReportModule, string> = {
  FEES: "Fees",
  STUDENTS: "Students",
  ADMISSIONS: "Admissions",
  ATTENDANCE: "Attendance",
  EXAMS: "Exams and results",
  ACCOUNTS: "Accounts",
  HR: "Staff and payroll",
  TIMETABLE: "Timetable",
  LIBRARY: "Library",
  WAREHOUSE: "Warehouse",
  TRANSPORT: "Transport",
  MESSAGES: "Messages",
};

export type ReportFilterKind = "date" | "dateRange" | "month" | "class" | "section" | "classSection" | "gender" | "select" | "text" | "number";

export interface ReportFilterDef {
  key: string;
  label: string;
  kind: ReportFilterKind;
  /**
   * For select (and month: the months offered). Lists built from data (fee heads, concession types, the session's
   * months, cashiers) are filled in for the ctx campus and session.
   */
  options?: Array<{ value: string; label: string }>;
  /**
   * Default value; for dateRange "from|to". The tokens "today" and "monthStart" are sent as they are (the page turns
   * them into dates; the server resolves them again when the report runs). Every other default comes resolved: an
   * ISO date, or "YYYY-MM" for a month (the server's own tokens sessionStart, prevMonthStart, monthStart-2 and
   * prevMonth never reach the page). A class or section default is sent only when it exists at the campus.
   */
  default?: string;
  required?: boolean;
  help?: string;
  /** Date filters: allow dates after today (e.g. a meeting date). */
  allowFuture?: boolean;
}

/** "blank" is an empty column left for ticks, signatures or marks written in by hand on the printed sheet. */
export type ReportColumnKind = "text" | "mono" | "money" | "count" | "percent" | "date" | "status" | "urdu" | "blank";

/**
 * A row carrying this key (value 1) is a subtotal line, e.g. "Class 7 total · 3 sections". It prints in bold,
 * is left out of the totals row and the chart, and is not a column.
 */
export const REPORT_SUBTOTAL_KEY = "_subtotal";

export interface ReportColumnDef {
  key: string;
  label: string;
  kind: ReportColumnKind;
  /** Summed in the totals row. */
  total?: boolean;
}

export interface ReportChartDef {
  /** column: one bar per category; area: a value over time. */
  kind: "column" | "area";
  label: string;
  /** Column holding the category or date. */
  x: string;
  /** Column holding the value. */
  y: string;
}

export type ReportFormat = "PDF" | "EXCEL";

export interface ReportDefinition {
  id: string;
  name: string;
  module: ReportModule;
  /** One line: what it shows and who uses it. */
  description: string;
  /** What it replaces in the old software (screen titles), for staff who know the old names. */
  replaces: string[];
  /** Plain-English note on what changed, e.g. "Was missing at Khalid Campus; works at every campus now." */
  improvement?: string;
  /** The module page that owns this data. */
  ownerPath: string;
  ownerLabel: string;
  permission: Permission;
  filters: ReportFilterDef[];
  columns: ReportColumnDef[];
  chart?: ReportChartDef;
  formats: ReportFormat[];
  /** A4 portrait or landscape when printed / saved as PDF. */
  paper: "A4" | "A4_LANDSCAPE";
  /** Large: runs in the background and notifies the user when ready. */
  background: boolean;
  /** Needs one campus (not "All campuses"). */
  singleCampus?: boolean;
  tags: string[];
  /** Added in the new system (not in the old software). */
  isNew?: boolean;
  /** Signature lines printed under the table, e.g. "Class teacher signature". */
  signatures?: string[];
  /** Sign-off sheets: taller rows with ruled empty cells to write in by hand. */
  ruled?: boolean;
}

export interface ReportCatalogueItem extends ReportDefinition {
  favourite: boolean;
  lastRunAt?: IsoDateTime;
}

export interface ReportCatalogue {
  reports: ReportCatalogueItem[];
  /** Reports this user's role can't open (not listed). */
  hiddenCount: number;
}

export type ReportFilterValues = Record<string, string>;

export interface ReportRunRequest {
  reportId: string;
  campus: CampusScope;
  session: number;
  filters: ReportFilterValues;
}

export type ReportCell = string | number | null;

export interface ReportResult {
  reportId: string;
  title: string;
  /** "Khalid Campus · Session 2026–27 · 01-Nov-2026 to 04-Nov-2026 · Class 7" */
  subtitle: string;
  campusHeading: string;
  generatedAt: IsoDateTime;
  generatedBy: string;
  columns: ReportColumnDef[];
  rows: Array<Record<string, ReportCell>>;
  totals?: Record<string, number>;
  /** Plain-English notes printed under the table. */
  notes?: string[];
  chart?: ReportChartDef;
  /** Signature lines printed under the table. */
  signatures?: string[];
  /** Taller rows with ruled empty cells (sign-off sheets). */
  ruled?: boolean;
}

export type ReportJobStatus = "QUEUED" | "RUNNING" | "READY" | "FAILED" | "EXPIRED";

export interface ReportJob {
  /** A number as a string, e.g. "12". */
  id: string;
  reportId: string;
  reportName: string;
  module: ReportModule;
  campus: CampusScope;
  session: number;
  filters: ReportFilterValues;
  filterSummary: string;
  /** SCREEN = run in the background to view on screen. */
  format: ReportFormat | "SCREEN";
  status: ReportJobStatus;
  /** 0–100. An estimate while RUNNING (elapsed time against the report's recent run times, at most 95). */
  progress: number;
  requestedAt: IsoDateTime;
  requestedBy: string;
  readyAt?: IsoDateTime;
  /** Files are kept for 7 days (until 23:59 Pakistan time on the seventh day after READY). */
  expiresAt?: IsoDateTime;
  rowCount?: number;
  /** "{report}-{campus|all-campuses}-{dd-mmm-yyyy}.{csv|pdf}" (EXCEL / PDF only). The file is built in the browser. */
  fileName?: string;
  /** Size of the prepared data (EXCEL / PDF only; omitted for SCREEN). */
  sizeKb?: number;
  error?: string;
  /** Set when a schedule produced it. */
  scheduleId?: string;
}

export type ReportFrequency = "DAILY" | "WEEKLY" | "MONTHLY";

export interface ReportSchedule {
  /** A number as a string, e.g. "7". */
  id: string;
  reportId: string;
  reportName: string;
  module: ReportModule;
  campus: CampusScope;
  session: number;
  filters: ReportFilterValues;
  filterSummary: string;
  frequency: ReportFrequency;
  /** 1 = Monday … 6 = Saturday (WEEKLY). */
  weekday?: number;
  /** 1–28 (MONTHLY). */
  dayOfMonth?: number;
  /** "18:00" */
  time: string;
  format: ReportFormat;
  /**
   * Staff who get it under the bell, by name as `reportsApi.recipients()` lists them. Email is kept on hold: a held
   * email record is written, nothing is sent.
   */
  recipients: string[];
  active: boolean;
  nextRunAt: IsoDateTime;
  lastRunAt?: IsoDateTime;
  createdBy: string;
  createdAt: IsoDateTime;
}

export interface ReportScheduleInput {
  reportId: string;
  campus: CampusScope;
  session: number;
  filters: ReportFilterValues;
  frequency: ReportFrequency;
  weekday?: number;
  dayOfMonth?: number;
  time: string;
  format: ReportFormat;
  recipients: string[];
}

export type StaffNotificationKind = "REPORT_READY" | "REPORT_FAILED" | "SCHEDULE_SENT";

export interface StaffNotification {
  /** A number as a string. */
  id: string;
  kind: StaffNotificationKind;
  title: string;
  body: string;
  at: IsoDateTime;
  read: boolean;
  /** Path to open, e.g. "/reports/jobs". */
  link?: string;
  jobId?: string;
}

/** "Rows above this run in the background" — shown on screen so staff know why. */
export const REPORT_BACKGROUND_NOTE = "Large reports are prepared in the background so the screen never freezes. You can keep working; the bell tells you when it is ready.";

export const reportsApi = {
  catalogue: (ctx: Ctx) => apiFetch<ReportCatalogue>("/reports/catalogue", { query: ctxQuery(ctx) }),
  setFavourite: (reportId: string, favourite: boolean) => apiFetch<{ favourite: boolean }>(`/reports/favourites/${encodeURIComponent(reportId)}`, { method: "PUT", body: { favourite } }),
  /** A report not built yet (listed in the catalogue) answers 404 "This report is not available yet." after the filter checks. */
  run: (body: ReportRunRequest) => apiFetch<ReportResult>("/reports/run", { method: "POST", body }),
  /** Starts a background job (export, or a large report to view on screen). Small exports come back READY. */
  startJob: (body: ReportRunRequest & { format: ReportFormat | "SCREEN" }) => apiFetch<ReportJob>("/reports/jobs", { method: "POST", body }),
  jobs: (ctx: Ctx) => apiFetch<ReportJob[]>("/reports/jobs", { query: ctxQuery(ctx) }),
  job: (id: string) => apiFetch<ReportJob>(`/reports/jobs/${encodeURIComponent(id)}`),
  jobResult: (id: string) => apiFetch<ReportResult>(`/reports/jobs/${encodeURIComponent(id)}/result`),
  retryJob: (id: string) => apiFetch<ReportJob>(`/reports/jobs/${encodeURIComponent(id)}/retry`, { method: "POST" }),
  removeJob: (id: string) => apiFetch<{ status: "ok" }>(`/reports/jobs/${encodeURIComponent(id)}`, { method: "DELETE" }),
  schedules: (ctx: Ctx) => apiFetch<ReportSchedule[]>("/reports/schedules", { query: ctxQuery(ctx) }),
  createSchedule: (body: ReportScheduleInput) => apiFetch<ReportSchedule>("/reports/schedules", { method: "POST", body }),
  updateSchedule: (id: string, body: Partial<ReportScheduleInput> & { active?: boolean }) => apiFetch<ReportSchedule>(`/reports/schedules/${encodeURIComponent(id)}`, { method: "PUT", body }),
  deleteSchedule: (id: string) => apiFetch<{ status: "ok" }>(`/reports/schedules/${encodeURIComponent(id)}`, { method: "DELETE" }),
  runScheduleNow: (id: string) => apiFetch<ReportJob>(`/reports/schedules/${encodeURIComponent(id)}/run`, { method: "POST" }),
  /** Staff who may get scheduled reports: reports.view at a campus the caller can see; role "{Role}, {Campus}". */
  recipients: () => apiFetch<Array<{ name: string; role: string }>>("/reports/recipients"),
};

export const reportsQueries = {
  catalogue: (ctx: Ctx) => queryOptions({ queryKey: ["reports", ...ctxKey(ctx), "catalogue"], queryFn: () => reportsApi.catalogue(ctx) }),
  run: (req: ReportRunRequest | null) =>
    queryOptions({
      queryKey: ["reports", req?.campus, req?.session, "run", req?.reportId, req?.filters],
      queryFn: () => reportsApi.run(req!),
      enabled: req !== null,
      staleTime: 60_000,
    }),
  jobs: (ctx: Ctx) => queryOptions({ queryKey: ["reports", ...ctxKey(ctx), "jobs"], queryFn: () => reportsApi.jobs(ctx) }),
  jobResult: (ctx: Ctx, id: string | null) => queryOptions({ queryKey: ["reports", ...ctxKey(ctx), "job-result", id], queryFn: () => reportsApi.jobResult(id!), enabled: id !== null, staleTime: Infinity }),
  schedules: (ctx: Ctx) => queryOptions({ queryKey: ["reports", ...ctxKey(ctx), "schedules"], queryFn: () => reportsApi.schedules(ctx) }),
  recipients: () => queryOptions({ queryKey: ["reports", "recipients"], queryFn: reportsApi.recipients, staleTime: Infinity }),
};

// ---------------------------------------------------------------------------------------------------
// Staff notifications (the bell): reports ready, scheduled reports sent.
// ---------------------------------------------------------------------------------------------------

export const notificationsApi = {
  list: () => apiFetch<StaffNotification[]>("/notifications"),
  markRead: (id: string) => apiFetch<{ status: "ok" }>(`/notifications/${encodeURIComponent(id)}/read`, { method: "POST" }),
  markAllRead: () => apiFetch<{ status: "ok" }>("/notifications/read-all", { method: "POST" }),
};

export const notificationsQueries = {
  list: () => queryOptions({ queryKey: ["notifications"], queryFn: notificationsApi.list, refetchInterval: 15_000 }),
};

/** "2026-11-01|2026-11-04" ↔ { from, to } for dateRange filters. */
export function splitRange(value: string | undefined): { from: IsoDate | ""; to: IsoDate | "" } {
  const [from = "", to = ""] = (value ?? "").split("|");
  return { from, to };
}
