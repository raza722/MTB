// Notices published by the school (staff app: Messages → Notices) and read by parents and students (portal).
// Shared contract between the comms module (owner, writes notices) and the portal (reads published notices).
// Fields are only ever added (optional), never renamed or removed: the portal reads this type.
import type { IsoDate, IsoDateTime } from "@mtb/domain";
import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { ctxKey, ctxQuery, type CampusCode, type Ctx } from "./context";

export type NoticeAudience = "ALL_PARENTS" | "CLASS" | "STAFF";

export type NoticeCategory = "GENERAL" | "HOLIDAY" | "FEES" | "EXAMS" | "EVENT" | "MEETING";

export const NOTICE_CATEGORY_LABEL: Record<NoticeCategory, string> = {
  GENERAL: "General",
  HOLIDAY: "Holiday",
  FEES: "Fees",
  EXAMS: "Exams and results",
  EVENT: "Event",
  MEETING: "Meeting",
};

export const NOTICE_AUDIENCE_LABEL: Record<NoticeAudience, string> = {
  ALL_PARENTS: "All parents",
  CLASS: "Selected classes",
  STAFF: "Staff",
};

export interface Notice {
  id: string;
  campus: CampusCode;
  /** English title; the Urdu title is shown when the reader switches to اردو. */
  title: string;
  titleUr: string;
  body: string;
  bodyUr: string;
  /** The date the notice is about (holiday, meeting, deadline). */
  date: IsoDate;
  publishedAt: IsoDateTime;
  publishedBy: string;
  audience: NoticeAudience;
  /** Class sections when audience is CLASS, e.g. ["7-B"]. */
  classSections?: string[];
  status: "DRAFT" | "PUBLISHED";

  // ---- Added by the comms module (all optional) ----
  category?: NoticeCategory;
  createdAt?: IsoDateTime;
  createdBy?: string;
  updatedAt?: IsoDateTime;
  updatedBy?: string;
  /** Set when a published notice was taken down; it is then a DRAFT again and hidden from the portal. */
  unpublishedAt?: IsoDateTime;
  unpublishedBy?: string;
  unpublishReason?: string;
  /** Hidden from the portal after this day. */
  expiresOn?: IsoDate;
  /** Shown first on the portal home page. */
  pinned?: boolean;
  /** Also sent as an app notification and/or SMS when published. */
  sendApp?: boolean;
  sendSms?: boolean;
  /** The message batch created when it was published with app/SMS. */
  batchId?: string;
  /** Families or staff the notice reaches. */
  audienceCount?: number;
  /** Families who opened it in the app. */
  readCount?: number;
}

export interface NoticeInput {
  campus: CampusCode;
  title: string;
  titleUr: string;
  body: string;
  bodyUr: string;
  date: IsoDate;
  category: NoticeCategory;
  audience: NoticeAudience;
  classSections?: string[];
  expiresOn?: IsoDate;
  pinned?: boolean;
  sendApp?: boolean;
  sendSms?: boolean;
}

export type NoticeFilter = "PUBLISHED" | "DRAFT" | "ALL";

export const noticesApi = {
  list: (ctx: Ctx) => apiFetch<Notice[]>("/notices", { query: ctxQuery(ctx) }),
  create: (body: NoticeInput & { publish: boolean }) => apiFetch<Notice>("/notices", { method: "POST", body }),
  update: (id: string, body: NoticeInput) => apiFetch<Notice>(`/notices/${encodeURIComponent(id)}`, { method: "PUT", body }),
  publish: (id: string) => apiFetch<Notice>(`/notices/${encodeURIComponent(id)}/publish`, { method: "POST" }),
  unpublish: (id: string, reason: string) => apiFetch<Notice>(`/notices/${encodeURIComponent(id)}/unpublish`, { method: "POST", body: { reason } }),
  remove: (id: string) => apiFetch<{ status: "ok" }>(`/notices/${encodeURIComponent(id)}`, { method: "DELETE" }),
};

export const noticesQueries = {
  list: (ctx: Ctx) => queryOptions({ queryKey: ["notices", ...ctxKey(ctx)], queryFn: () => noticesApi.list(ctx) }),
};

/** A notice the portal should show: published, not expired, for this campus and (for CLASS) this section. */
export function noticeVisibleTo(n: Notice, campus: CampusCode, classSection: string | null, today: IsoDate): boolean {
  if (n.status !== "PUBLISHED" || n.campus !== campus) return false;
  if (n.expiresOn && n.expiresOn < today) return false;
  if (n.audience === "STAFF") return false;
  if (n.audience === "CLASS") return classSection !== null && (n.classSections ?? []).includes(classSection);
  return true;
}
