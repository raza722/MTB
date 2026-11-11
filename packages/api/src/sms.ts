import type { IsoDate, IsoDateTime, Rupees } from "@mtb/domain";
import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { ctxKey, ctxQuery, type CampusCode, type Ctx } from "./context";

// Messages centre (staff app → Messages): SMS and app notifications, templates, compose and send,
// scheduled sends, the outbox, delivery report, opt-outs, gateway settings and the kill switch.
// The kill switch is read by the staff shell to show "All SMS paused" on every page.
//
// SENDING IS SWITCHED OFF IN THIS SYSTEM (backend module 10, deviation D1): no SMS ever leaves the server. send,
// sendBatchNow, retryFailed, a scheduled batch whose time comes and a notice published with SMS only write messages
// that stay held in the outbox (delivery status "queued"; a released batch stays "SENDING"). Delivery statuses
// sent / delivered / failed and batch status SENT occur only on migrated history. The kill switch starts paused;
// resuming only lifts the "paused" checks. Retry-unsafe writes take an optional Idempotency-Key (contract change C2).

export interface SmsSystemStatus {
  paused: boolean;
  pausedBy?: string;
  pausedAt?: IsoDateTime;
  reason?: string;
}

export const smsStatusApi = {
  status: () => apiFetch<SmsSystemStatus>("/sms/status"),
  pause: (reason: string, idempotencyKey?: string) => apiFetch<SmsSystemStatus>("/sms/pause", { method: "POST", body: { reason }, ...(idempotencyKey ? { idempotencyKey } : {}) }),
  resume: (idempotencyKey?: string) => apiFetch<SmsSystemStatus>("/sms/resume", { method: "POST", ...(idempotencyKey ? { idempotencyKey } : {}) }),
};

export const smsStatusQueries = {
  status: () => queryOptions({ queryKey: ["sms", "status"], queryFn: smsStatusApi.status, staleTime: 15_000 }),
};

// ---------------------------------------------------------------------------------------------------
// Templates and text
// ---------------------------------------------------------------------------------------------------

export type SmsLanguage = "en" | "ur";
/** "queued" = held in the outbox (nothing sends it); sent / delivered / failed only on migrated history. */
export type SmsDeliveryStatus = "queued" | "sent" | "delivered" | "failed" | "optedout";

/** Variables a template may use. Each appears as a chip in the editor. */
export const SMS_VARIABLES = ["student_name", "class", "amount_due", "due_date", "campus", "guardian_name", "exam_name", "result", "event_date", "tests_summary", "subject_marks"] as const;
export type SmsVariable = (typeof SMS_VARIABLES)[number];
export type SmsValues = Record<SmsVariable, string>;

/**
 * NOTICE (and GENERAL) templates respect opt-outs. Fee, attendance, result, admission and discipline
 * messages are about the family's own child: guardians can't opt out of them (modernization doc 40 §4),
 * so they still reach opted-out numbers. STAFF messages go to staff only.
 */
export type SmsTemplateCategory = "FEE" | "ATTENDANCE" | "RESULT" | "NOTICE" | "ADMISSION" | "DISCIPLINE" | "STAFF" | "GENERAL";

export const SMS_CATEGORY_LABEL: Record<SmsTemplateCategory, string> = {
  FEE: "Fees",
  ATTENDANCE: "Attendance",
  RESULT: "Results",
  NOTICE: "Notice",
  ADMISSION: "Admissions",
  DISCIPLINE: "Discipline",
  STAFF: "Staff",
  GENERAL: "General",
};

/** Categories guardians can opt out of. Everything else is about their own child and always goes. */
export const SMS_OPTIONAL_CATEGORIES: readonly SmsTemplateCategory[] = ["NOTICE", "GENERAL"];

export interface SmsTemplate {
  id: string;
  name: string;
  category: SmsTemplateCategory;
  en: string;
  ur: string;
  updatedAt: IsoDateTime;
  updatedBy: string;
  /** Shipped with the system; can be reworded but not archived. */
  builtIn?: boolean;
  /** Archived templates are hidden from Compose but kept for the history of what was sent. */
  archived?: boolean;
  /** Times used this session. */
  uses?: number;
}

// ---------------------------------------------------------------------------------------------------
// Audiences, channels, sending
// ---------------------------------------------------------------------------------------------------

/** SMS costs money per part; an app notification is free and reaches families who installed the MTB app. */
export type SmsChannel = "SMS" | "APP" | "APP_FIRST";

export const SMS_CHANNEL_LABEL: Record<SmsChannel, string> = {
  APP_FIRST: "App first, SMS if no app",
  SMS: "SMS only",
  APP: "App notification only",
};

export type SmsStaffGroup = "ALL" | "TEACHING" | "NON_TEACHING";

/** Students who left, by how they left (the old Expelled Student SMS and SMS To Pass Out Student). */
export type SmsLeftStatus = "EXPELLED" | "STRUCK_OFF" | "LEFT" | "PASSED_OUT";

export const SMS_LEFT_STATUS_LABEL: Record<SmsLeftStatus, string> = {
  EXPELLED: "Expelled",
  STRUCK_OFF: "Struck off",
  LEFT: "Left the school",
  PASSED_OUT: "Passed out",
};

export type SmsAudience =
  /** className is the short class name ("7"); section omitted = all sections. */
  | { kind: "CLASS"; className: string; section?: string; gender?: "F" | "M" }
  /** Several class-sections at once, e.g. ["6-A", "7-B"] (the old "Check all" lists). */
  | { kind: "SECTIONS"; classSections: string[]; gender?: "F" | "M" }
  /** classSections omitted = every class. */
  | { kind: "DEFAULTERS"; minDaysOverdue: number; minAmount: Rupees; classSections?: string[] }
  | { kind: "ALL_PARENTS"; gender?: "F" | "M" }
  /** Staff by group, department (class level), gender, or picked one by one (staffIds). */
  | { kind: "STAFF"; group: SmsStaffGroup; departments?: string[]; gender?: "F" | "M"; staffIds?: string[] }
  /**
   * Admission applicants this session (the old "Candidate SMS"), from Admissions. classApplied is the class short
   * ("6"); omitted = every class. testFee PAID = registered (test fee paid), UNPAID = not registered.
   */
  | { kind: "CANDIDATES"; classApplied?: string; registeredFrom?: IsoDate; registeredTo?: IsoDate; testFee?: "PAID" | "UNPAID"; testDate?: IsoDate }
  /** Guardians of the students who sat a declared exam ({result} is each student's own result). */
  | { kind: "EXAM"; examId: string; classSections?: string[]; gender?: "F" | "M" }
  /** Students who left in a session: expelled, struck off, left or passed out. */
  | { kind: "LEFT"; status: SmsLeftStatus; session: number; classSections?: string[]; gender?: "F" | "M" }
  /** Chosen students (Attendance absentees, Fees defaulters). amounts / dueDates give each one's own figures. */
  | { kind: "STUDENTS"; grNos: string[]; label?: string; amounts?: Record<string, Rupees>; dueDates?: Record<string, IsoDate> }
  /** Typed, pasted or uploaded numbers (the old "Manual SMS" / Excel sheet). */
  | { kind: "NUMBERS"; numbers: string[]; label?: string };

export interface SmsAudienceRequest {
  campus: CampusCode;
  session: number;
  /** A template id, or "custom" with customText. */
  templateId: string;
  language: SmsLanguage;
  audience: SmsAudience;
  /** Defaults to SMS. */
  channel?: SmsChannel;
  /** Text written for this send only (templateId "custom"). */
  customText?: { en: string; ur: string; category?: SmsTemplateCategory };
  /** Title shown on the app notification (defaults to the template name). */
  title?: string;
  /** Send later. Omitted = now. */
  scheduledFor?: IsoDateTime;
  /** Where the send started, e.g. "Notices" (defaults to "Messages"). */
  source?: string;
  /** Values typed at compose time for {event_date} and {exam_name}; exam_id fills {result} and {subject_marks} from that exam. */
  values?: Partial<Pick<SmsValues, "event_date" | "exam_name">> & { exam_id?: string };
  /** Tests declared in these dates make up {tests_summary} (and {subject_marks} when no exam is chosen). */
  period?: { from: IsoDate; to: IsoDate };
  /** Recipients unticked on the preview (their key). */
  exclude?: string[];
  /** Rows to return in the preview (default 8, at most 500). */
  sampleSize?: number;
}

/** One member of staff for Compose's "Choose people" list. */
export interface SmsStaffMember {
  id: string;
  name: string;
  designation: string;
  department: string;
  gender: "F" | "M";
  teaching: boolean;
  mobile: string;
}

export interface SmsRecipientPreview {
  /** Stable id for unticking this recipient (G.R. no., application no., staff id or the number). */
  key?: string;
  grNo: string;
  studentName: string;
  classSection: string;
  guardian: string;
  mobile: string;
  amountDue: Rupees;
  daysOverdue: number;
  optedOut: boolean;
  message: string;
  parts: number;
  /** How this person gets it once channel rules apply. */
  channel?: "SMS" | "APP";
  /** The family has the MTB app installed. */
  hasApp?: boolean;
  /** What {result} says for this recipient, e.g. "512/700 (73.1%), Grade B". */
  result?: string;
  /** Unticked on the preview: listed so it can be ticked again, but not sent. */
  unticked?: boolean;
}

export interface SmsAudiencePreview {
  /** Students (or staff, or numbers) in the audience before exclusions. */
  recipients: number;
  /** Excluded because the guardian opted out (notices only). */
  excludedOptOut: number;
  /** Opted-out guardians who still get this message because it is transactional. */
  optedOutIncluded: number;
  /** Excluded from fee messages because nothing is due. */
  excludedNothingDue: number;
  /** People with no valid mobile number, left out before counting (contract change C4). */
  excludedNoMobile?: number;
  /** Messages that will be queued. */
  sendable: number;
  /** Estimated SMS (parts) across all messages going by SMS. */
  segments: number;
  /** First recipients, for the preview table. */
  sample: SmsRecipientPreview[];
  /** Messages going by SMS / by app notification. */
  smsRecipients?: number;
  appRecipients?: number;
  /** Estimated gateway cost for this send, whole rupees. */
  estCost?: Rupees;
  /** What it would cost if everyone got an SMS. */
  costIfAllSms?: Rupees;
  /** Rupees per 100 SMS parts at this campus. */
  ratePer100?: Rupees;
  /** Large sends by someone without approval rights wait for the principal. */
  needsApproval?: boolean;
  approvalThreshold?: number;
  /** Typed numbers that aren't Pakistani mobile numbers. */
  invalidNumbers?: string[];
  /** Duplicate numbers (several children, one phone) sent once only. */
  duplicates?: number;
  /** App-only sends: people without the app who won't be reached. */
  excludedNoApp?: number;
  /** Result messages: students with no result to send (not in the exam, withheld, or no tests in the dates). */
  excludedNoResult?: number;
  /** Unticked on the preview. */
  excludedByYou?: number;
}

export type SmsBatchStatus = "AWAITING_APPROVAL" | "SCHEDULED" | "SENDING" | "SENT" | "CANCELLED" | "REJECTED";

export const SMS_BATCH_STATUS_LABEL: Record<SmsBatchStatus, string> = {
  AWAITING_APPROVAL: "Waiting for approval",
  SCHEDULED: "Scheduled",
  /** A released batch: its messages are held in the outbox because sending is switched off (contract change C6). */
  SENDING: "Held: sending is switched off",
  SENT: "Sent",
  CANCELLED: "Cancelled",
  REJECTED: "Not approved",
};

export interface SmsSendResult {
  batchId: string;
  queued: number;
  excludedOptOut: number;
  segments: number;
  status?: SmsBatchStatus;
  scheduledFor?: IsoDateTime;
  appQueued?: number;
  estCost?: Rupees;
}

export interface SmsBatchCounts {
  queued: number;
  sent: number;
  delivered: number;
  failed: number;
  optedout: number;
  /** App notifications delivered to the phone. */
  app: number;
  /** App notifications opened. */
  appRead: number;
}

/** One send: a message to an audience (the outbox). */
export interface SmsBatch {
  id: string;
  campus: CampusCode;
  session: number;
  createdAt: IsoDateTime;
  createdBy: string;
  templateId: string;
  templateName: string;
  category: SmsTemplateCategory;
  language: SmsLanguage;
  channel: SmsChannel;
  audienceLabel: string;
  status: SmsBatchStatus;
  scheduledFor?: IsoDateTime;
  sentAt?: IsoDateTime;
  decidedBy?: string;
  decidedAt?: IsoDateTime;
  decisionNote?: string;
  recipients: number;
  smsRecipients: number;
  appRecipients: number;
  segments: number;
  estCost: Rupees;
  /** Saved by sending app notifications instead of SMS. */
  saved: Rupees;
  counts: SmsBatchCounts;
  /** The first recipient's message. */
  sampleMessage: string;
  title?: string;
  source: string;
}

export interface SmsBatchDetail extends SmsBatch {
  request: SmsAudienceRequest;
  /** First recipients with their delivery status. */
  rows: SmsDeliveryRow[];
}

export interface SmsDeliveryRow {
  id: string;
  campus: CampusCode;
  at: IsoDateTime;
  /** Masked in the report and batch rows, e.g. "0300-•••4567" (contract change C5). */
  mobile: string;
  guardian: string;
  studentName: string;
  grNo: string;
  classSection: string;
  templateName: string;
  language: SmsLanguage;
  message: string;
  status: SmsDeliveryStatus;
  /** Why it failed, in plain words. */
  error?: string;
  /** SMS or app notification (SMS when omitted). */
  channel?: "SMS" | "APP";
  batchId?: string;
  parts?: number;
}

export interface SmsReport {
  /** Today's totals, including messages older than the rows returned. */
  totals: Record<SmsDeliveryStatus, number>;
  /** Latest messages, newest first. */
  rows: SmsDeliveryRow[];
  /** App notifications delivered today. */
  appToday?: number;
}

export interface SmsOptOut {
  id: string;
  campus: CampusCode;
  mobile: string;
  guardian: string;
  students: Array<{ name: string; grNo: string; classSection: string }>;
  optedOutAt: IsoDateTime;
  via: string;
}

// ---------------------------------------------------------------------------------------------------
// Overview and settings
// ---------------------------------------------------------------------------------------------------

export interface SmsTrendDay {
  date: IsoDate;
  sms: number;
  app: number;
  failed: number;
}

export interface SmsOverview {
  today: Record<SmsDeliveryStatus, number> & { app: number };
  /** Delivered ÷ (delivered + failed) today, 0–100. */
  deliveryRate: number;
  month: { label: string; messages: number; sms: number; segments: number; app: number; cost: Rupees; saved: Rupees; budget: Rupees };
  /** Families with the MTB app installed (they get free app notifications). */
  appFamilies: { withApp: number; total: number };
  /** Last 14 days, oldest first; today last. */
  trend: SmsTrendDay[];
  /** Messages this month by category. */
  byCategory: Array<{ category: SmsTemplateCategory; count: number }>;
  awaitingApproval: SmsBatch[];
  scheduled: SmsBatch[];
  recent: SmsBatch[];
}

export type SmsProvider = "LRT" | "UFONE" | "ZONG" | "JAZZ";

export interface SmsGatewaySettings {
  campus: CampusCode;
  campusName: string;
  provider: SmsProvider;
  /** Used automatically when the main company doesn't accept a message. */
  backupProvider: SmsProvider | null;
  /** The sender name families see, e.g. "MTB-KHALID". */
  senderName: string;
  /** Rupees per 100 SMS parts. */
  ratePer100: Rupees;
  monthlyBudget: Rupees;
  /** Most SMS parts per day; the rest wait until tomorrow. */
  dailyCap: number;
  /** Sends to more people than this need the principal's approval. */
  approvalThreshold: number;
  /** No SMS between these times (24-hour "21:00" → "07:00"). */
  quietFrom: string;
  quietTo: string;
  /**
   * Account details are never shown or stored in the database. Always "NOT_SET" while sending is switched off in
   * this system (contract change C1): no SMS company account is connected.
   */
  credentials: "VERIFIED" | "NOT_SET";
  /** Absent until the first check. */
  lastCheckedAt?: IsoDateTime;
  /** Always false while sending is switched off. */
  deliveryReports: boolean;
  updatedAt: IsoDateTime;
  updatedBy: string;
}

export type SmsGatewaySettingsInput = Pick<SmsGatewaySettings, "provider" | "backupProvider" | "senderName" | "ratePer100" | "monthlyBudget" | "dailyCap" | "approvalThreshold" | "quietFrom" | "quietTo">;

export interface SmsBatchListQuery {
  status?: SmsBatchStatus | "";
}

export interface SmsReportQuery {
  batchId?: string;
}

export const smsApi = {
  templates: (ctx: Ctx) => apiFetch<SmsTemplate[]>("/sms/templates", { query: ctxQuery(ctx) }),
  saveTemplate: (id: string, body: { en: string; ur: string; name?: string }) => apiFetch<SmsTemplate>(`/sms/templates/${encodeURIComponent(id)}`, { method: "PUT", body }),
  createTemplate: (body: { name: string; category: SmsTemplateCategory; en: string; ur: string }) => apiFetch<SmsTemplate>("/sms/templates", { method: "POST", body }),
  archiveTemplate: (id: string) => apiFetch<SmsTemplate>(`/sms/templates/${encodeURIComponent(id)}/archive`, { method: "POST" }),
  staff: (ctx: Ctx) => apiFetch<SmsStaffMember[]>("/sms/staff", { query: ctxQuery(ctx) }),
  previewAudience: (body: SmsAudienceRequest) => apiFetch<SmsAudiencePreview>("/sms/audience/preview", { method: "POST", body }),
  send: (body: SmsAudienceRequest, idempotencyKey: string) => apiFetch<SmsSendResult>("/sms/send", { method: "POST", body, idempotencyKey }),
  report: (ctx: Ctx, q: SmsReportQuery = {}) => apiFetch<SmsReport>("/sms/report", { query: { ...ctxQuery(ctx), batch: q.batchId } }),
  /** Only migrated messages can have failed and they are frozen: retried is always 0 while sending is switched off. */
  retryFailed: (ctx: Ctx, batchId?: string, idempotencyKey?: string) => apiFetch<{ retried: number }>("/sms/report/retry-failed", { method: "POST", body: { campus: ctx.campus, ...(batchId ? { batchId } : {}) }, ...(idempotencyKey ? { idempotencyKey } : {}) }),
  optOuts: (ctx: Ctx) => apiFetch<SmsOptOut[]>("/sms/opt-outs", { query: ctxQuery(ctx) }),
  addOptOut: (body: { campus: CampusCode; mobile: string; via: string }, idempotencyKey?: string) => apiFetch<SmsOptOut>("/sms/opt-outs", { method: "POST", body, ...(idempotencyKey ? { idempotencyKey } : {}) }),
  removeOptOut: (id: string) => apiFetch<{ status: "ok" }>(`/sms/opt-outs/${encodeURIComponent(id)}`, { method: "DELETE" }),

  overview: (ctx: Ctx) => apiFetch<SmsOverview>("/sms/overview", { query: ctxQuery(ctx) }),
  batches: (ctx: Ctx, q: SmsBatchListQuery = {}) => apiFetch<SmsBatch[]>("/sms/batches", { query: { ...ctxQuery(ctx), status: q.status } }),
  batch: (id: string) => apiFetch<SmsBatchDetail>(`/sms/batches/${encodeURIComponent(id)}`),
  /** The person who wrote the batch can't decide it (409 OWN_BATCH). */
  decideBatch: (id: string, decision: "approve" | "reject", note?: string, idempotencyKey?: string) => apiFetch<SmsBatch>(`/sms/batches/${encodeURIComponent(id)}/decide`, { method: "POST", body: { decision, note }, ...(idempotencyKey ? { idempotencyKey } : {}) }),
  cancelBatch: (id: string, reason: string) => apiFetch<SmsBatch>(`/sms/batches/${encodeURIComponent(id)}/cancel`, { method: "POST", body: { reason } }),
  /** Releases the batch now; its messages stay held in the outbox (nothing is sent from this system). */
  sendBatchNow: (id: string, idempotencyKey?: string) => apiFetch<SmsBatch>(`/sms/batches/${encodeURIComponent(id)}/send-now`, { method: "POST", ...(idempotencyKey ? { idempotencyKey } : {}) }),
  rescheduleBatch: (id: string, scheduledFor: IsoDateTime) => apiFetch<SmsBatch>(`/sms/batches/${encodeURIComponent(id)}/reschedule`, { method: "POST", body: { scheduledFor } }),

  settings: (ctx: Ctx) => apiFetch<SmsGatewaySettings[]>("/sms/settings", { query: ctxQuery(ctx) }),
  saveSettings: (campus: CampusCode, body: SmsGatewaySettingsInput) => apiFetch<SmsGatewaySettings>(`/sms/settings/${campus}`, { method: "PUT", body }),
  /** Contacts nothing while sending is switched off: answers ok false with the reason. */
  testGateway: (campus: CampusCode) => apiFetch<{ ok: boolean; message: string; checkedAt: IsoDateTime }>(`/sms/settings/${campus}/test`, { method: "POST" }),
};

export const smsQueries = {
  templates: (ctx: Ctx) => queryOptions({ queryKey: ["sms", ...ctxKey(ctx), "templates"], queryFn: () => smsApi.templates(ctx) }),
  staff: (ctx: Ctx) => queryOptions({ queryKey: ["sms", ...ctxKey(ctx), "staff"], queryFn: () => smsApi.staff(ctx) }),
  preview: (body: SmsAudienceRequest | null) =>
    queryOptions({
      queryKey: ["sms", body?.campus, body?.session, "preview", body],
      queryFn: () => smsApi.previewAudience(body!),
      enabled: body !== null,
    }),
  report: (ctx: Ctx, q: SmsReportQuery = {}) => queryOptions({ queryKey: ["sms", ...ctxKey(ctx), "report", q.batchId ?? ""], queryFn: () => smsApi.report(ctx, q) }),
  optOuts: (ctx: Ctx) => queryOptions({ queryKey: ["sms", ...ctxKey(ctx), "opt-outs"], queryFn: () => smsApi.optOuts(ctx) }),
  overview: (ctx: Ctx) => queryOptions({ queryKey: ["sms", ...ctxKey(ctx), "overview"], queryFn: () => smsApi.overview(ctx) }),
  batches: (ctx: Ctx, q: SmsBatchListQuery = {}) => queryOptions({ queryKey: ["sms", ...ctxKey(ctx), "batches", q.status ?? ""], queryFn: () => smsApi.batches(ctx, q) }),
  batch: (ctx: Ctx, id: string | null) => queryOptions({ queryKey: ["sms", ...ctxKey(ctx), "batch", id], queryFn: () => smsApi.batch(id!), enabled: id !== null }),
  settings: (ctx: Ctx) => queryOptions({ queryKey: ["sms", ...ctxKey(ctx), "settings"], queryFn: () => smsApi.settings(ctx) }),
};

/** "0300-1234567" → "0300-•••4567" (previews show only the last four digits). */
export function smsMaskMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, "");
  if (digits.length < 8) return mobile;
  return `${digits.slice(0, 4)}-•••${digits.slice(-4)}`;
}

/** Fills {variables}; unknown ones are left as typed so the editor can flag them. */
export function smsRender(template: string, values: Partial<SmsValues>): string {
  return template.replace(/\{([a-z_]+)\}/g, (m, name: string) => (name in values ? (values[name as SmsVariable] ?? m) : m));
}

/** Variables used in a template that aren't in SMS_VARIABLES. */
export function smsUnknownVariables(template: string): string[] {
  const found = [...template.matchAll(/\{([a-z_]+)\}/gi)].map((m) => m[1] ?? "");
  return [...new Set(found.filter((v) => !(SMS_VARIABLES as readonly string[]).includes(v)))];
}

const GSM_BASIC = new Set([..."@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"]);
const GSM_EXTENSION = new Set([..."^{}\\[~]|€\f"]);

export interface SmsSegmentInfo {
  /** GSM-7 = standard SMS alphabet; UCS-2 = Unicode (Urdu, or any character outside the alphabet). */
  encoding: "GSM-7" | "UCS-2";
  /** Characters as the network counts them (extension characters count twice in GSM-7). */
  units: number;
  /** 160 (GSM-7) or 70 (UCS-2) for a single SMS. */
  perSms: number;
  /** 153 or 67 per part once a message needs more than one SMS. */
  perPart: number;
  parts: number;
  /** Characters that forced Unicode in an otherwise English message. */
  nonGsm: string[];
}

/** How many SMS a message costs: 160 per English SMS (153 per part), 70 per Unicode/Urdu SMS (67 per part). */
export function smsSegments(text: string): SmsSegmentInfo {
  const chars = [...text];
  const nonGsm = [...new Set(chars.filter((c) => !GSM_BASIC.has(c) && !GSM_EXTENSION.has(c)))];
  if (nonGsm.length === 0) {
    const units = chars.reduce((n, c) => n + (GSM_EXTENSION.has(c) ? 2 : 1), 0);
    return { encoding: "GSM-7", units, perSms: 160, perPart: 153, parts: units === 0 ? 0 : units <= 160 ? 1 : Math.ceil(units / 153), nonGsm };
  }
  const units = text.length; // UTF-16 code units
  return { encoding: "UCS-2", units, perSms: 70, perPart: 67, parts: units === 0 ? 0 : units <= 70 ? 1 : Math.ceil(units / 67), nonGsm };
}

/** Common typographic characters that silently turn an English SMS into Unicode, with their standard replacements. */
export const SMS_GSM_REPLACEMENTS: Record<string, string> = {
  "–": "-",
  "—": "-",
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "…": "...",
  " ": " ",
};

/** Whole-rupee cost of SMS parts at a campus rate (rupees per 100 parts). */
export function smsCost(parts: number, ratePer100: Rupees): Rupees {
  return Math.round((parts * ratePer100) / 100);
}
