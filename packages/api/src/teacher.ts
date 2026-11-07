// Teacher app (mobile PWA): today's classes, the class register with change requests, marks entry for the
// teacher's own papers, the week timetable, classes and student contacts, and notifications.
// Writes carry an Idempotency-Key, because the phone keeps them in an offline outbox and replays them when the
// connection comes back: a replay must never create a second register or a second set of marks.
// The registers (registers, register, submitRegister, requestChange) are served by the real backend (Attendance,
// backend/docs/modules/04_attendance.md); today, papers, timetable, classes and notifications are still mocked.
import type { AttendanceCode, IsoDate, IsoDateTime } from "@mtb/domain";
import { queryOptions } from "@tanstack/react-query";
import type { RegisterCode } from "./attendance";
import { apiFetch } from "./client";
import { ctxKey, ctxQuery, type CampusCode, type Ctx } from "./context";
import type { ExamsCategory, ExamsMark, ExamsPaperStatus } from "./exams";
import type { BellDay } from "./timetable";

/* ------------------------------------------------------------------ Days and periods */

/** Why there is no register on a day: a holiday from the school calendar, Sunday, or the demo's holiday switch. */
export interface TeacherClosedDay {
  name: string;
  nameUr?: string;
  kind: string;
}

export type TeacherRegisterStatus = "NOT_MARKED" | "SUBMITTED" | "CHANGE_PENDING";

export const TEACHER_REGISTER_STATUS_LABEL: Record<TeacherRegisterStatus, string> = {
  NOT_MARKED: "Not marked",
  SUBMITTED: "Submitted",
  CHANGE_PENDING: "Change pending",
};

/** One period in the teacher's day (own lesson or cover for an absent colleague). */
export interface TeacherPeriod {
  period: number;
  /** "08:00" (24-hour) */
  start: string;
  end: string;
  classSection: string;
  /** The group taught when the class is split for this period, e.g. "Science (Biology)". */
  stream?: string;
  subject: string;
  room: string;
  /** Covering for a colleague who is away today. */
  cover: boolean;
  /** The class's register today: taken by this teacher (mine) or by the class teacher. */
  register?: {
    status: TeacherRegisterStatus;
    mine: boolean;
    classTeacher: string;
    submittedAt?: IsoDateTime;
  };
}

export interface TeacherCounts {
  present: number;
  absent: number;
  leave: number;
  late: number;
}

/** A register this teacher takes (class teacher), as a card. */
export interface TeacherRegisterCard {
  classSection: string;
  date: IsoDate;
  status: TeacherRegisterStatus;
  enrolled: number;
  /** null until the register is submitted. */
  counts: TeacherCounts | null;
  submittedAt?: IsoDateTime;
  pendingChanges: number;
  /** Set when there is no school that day (the register is closed). */
  closed?: TeacherClosedDay;
}

/* ------------------------------------------------------------------ Today */

export interface TeacherToday {
  date: IsoDate;
  campus: CampusCode;
  campusName: string;
  session: number;
  teacherName: string;
  /** Set when there is no school today; registers are closed. */
  closed: TeacherClosedDay | null;
  periods: TeacherPeriod[];
  registers: TeacherRegisterCard[];
  /** Papers still open for marks (not submitted). */
  papers: TeacherPaper[];
  unread: number;
  /** The next day the school is closed (not a Sunday). */
  nextClosed: { date: IsoDate; name: string } | null;
}

/* ------------------------------------------------------------------ Registers */

export interface TeacherChangeRequest {
  id: string;
  campus: CampusCode;
  classSection: string;
  date: IsoDate;
  grNo: string;
  studentName: string;
  from: RegisterCode;
  to: RegisterCode;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requestedBy: string;
  requestedAt: IsoDateTime;
  decidedBy?: string;
  decidedAt?: IsoDateTime;
}

export interface TeacherRegisterStudent {
  grNo: string;
  rollNo: number;
  name: string;
  father: string;
  /** The mark in the register (everyone is Present until marked otherwise). */
  mark: RegisterCode;
  /** A change waiting for the principal. */
  pending?: { id: string; to: RegisterCode };
}

export interface TeacherRegister {
  campus: CampusCode;
  campusName: string;
  classSection: string;
  date: IsoDate;
  status: TeacherRegisterStatus;
  closed: TeacherClosedDay | null;
  enrolled: number;
  students: TeacherRegisterStudent[];
  counts: TeacherCounts | null;
  submittedAt?: IsoDateTime;
  submittedBy?: string;
  source?: "Teacher app" | "Office";
  /** Taken while the phone was offline and sent later. */
  takenOffline?: boolean;
  /**
   * Absence messages written for parents when the register was submitted. SMS sending starts with the Messages
   * module, so they are held, not sent (the name is kept from the first contract).
   */
  smsSent?: number;
  changes: TeacherChangeRequest[];
  /** The teacher can mark it now (open, not closed, current session). */
  canMark: boolean;
  /** Why it can't be marked, in plain words. */
  lockedReason?: string;
}

/** One past school day of a register, for the history list and chart. */
export interface TeacherRegisterDay {
  date: IsoDate;
  status: TeacherRegisterStatus;
  /** null (or zeros) when the register was not taken that day. */
  counts: TeacherCounts | null;
  /** Present + late as a share of the students marked, one decimal; null when the register was not taken. */
  percent: number | null;
  submittedAt?: IsoDateTime;
  by?: string;
  pending: number;
}

export interface TeacherRegisterOverview {
  classSection: string;
  enrolled: number;
  today: TeacherRegisterCard;
  /** The last school days before today, newest first. */
  days: TeacherRegisterDay[];
  changes: TeacherChangeRequest[];
}

export interface TeacherRegisterSubmit {
  date: IsoDate;
  /**
   * G.R. number → code; a student left out is Present. A code other than P/A/L/LT, or a G.R. number not on
   * the roster, is 422 VALIDATION with `field: "grNo"` (the input, as everywhere else) and the student's G.R.
   * number in `details.grNo`; the message names the student, so the app shows it as the form's error.
   */
  marks: Record<string, RegisterCode>;
  /** When the teacher pressed Submit on the phone (it may reach the server later). */
  takenAt: IsoDateTime;
  savedOffline: boolean;
}

export interface TeacherChangeInput {
  date: IsoDate;
  grNo: string;
  to: RegisterCode;
  reason: string;
}

/* ------------------------------------------------------------------ Marks */

export interface TeacherPaper {
  examId: string;
  examName: string;
  category: ExamsCategory;
  examStatus: "DRAFT" | "DECLARED";
  classSection: string;
  subjectId: string;
  subjectName: string;
  maxMarks: number;
  status: ExamsPaperStatus;
  /** Marks entered (absent and leave count as entered). */
  entered: number;
  candidates: number;
  absent: number;
  leave: number;
  /** The day the paper was sat. */
  paperDate?: IsoDate;
  updatedAt?: IsoDateTime;
  updatedBy?: string;
  /** Why the exam office returned it. */
  note?: string;
  /** The teacher can't change the marks (submitted, checked, declared or a closed session). */
  locked: boolean;
  lockedReason?: string;
}

export interface TeacherPaperStudent {
  id: string;
  rollNo: number;
  name: string;
  mark: ExamsMark;
}

export interface TeacherPaperSheet extends TeacherPaper {
  students: TeacherPaperStudent[];
}

/** Identifies one paper: an exam, a class-section and a subject. */
export interface TeacherPaperRef {
  examId: string;
  classSection: string;
  subjectId: string;
}

/* ------------------------------------------------------------------ Timetable */

export interface TeacherWeekDay {
  date: IsoDate;
  /** 1 = Monday … 6 = Saturday. */
  day: number;
  dayName: string;
  closed: TeacherClosedDay | null;
  periods: TeacherPeriod[];
}

export interface TeacherWeek {
  weekOf: IsoDate;
  today: IsoDate;
  days: TeacherWeekDay[];
  normal: BellDay;
  friday: BellDay;
  periodsThisWeek: number;
}

/* ------------------------------------------------------------------ Classes and contacts */

export type TeacherClassRole = "CLASS_TEACHER" | "SUBJECT_TEACHER";

export interface TeacherClass {
  classSection: string;
  roles: TeacherClassRole[];
  subjects: string[];
  periodsPerWeek: number;
  enrolled: number;
  room: string;
  /** Present + late this session, one decimal; null before the first school day. */
  attendancePercent: number | null;
}

export interface TeacherStudentContact {
  grNo: string;
  rollNo: number;
  name: string;
  father: string;
  /** Guardian's mobile, digits only: "03001234567". */
  guardianMobile: string;
  attendancePercent: number | null;
  absentDays: number;
  lateDays: number;
  todayMark: AttendanceCode | null;
}

export interface TeacherClassDetail {
  classSection: string;
  roles: TeacherClassRole[];
  subjects: string[];
  enrolled: number;
  /** Attendance figures run from this date. */
  since: IsoDate;
  schoolDays: number;
  students: TeacherStudentContact[];
}

/* ------------------------------------------------------------------ Notifications */

export type TeacherNotificationKind = "ATTENDANCE" | "MARKS" | "CALENDAR" | "LEAVE" | "NOTICE";

export interface TeacherNotification {
  id: string;
  at: IsoDateTime;
  kind: TeacherNotificationKind;
  title: string;
  body?: string;
  read: boolean;
  /** An app path to open, e.g. "/marks". */
  link?: string;
}

/* ------------------------------------------------------------------ Demo (mock server only) */

/** Presenter switches, answered by the mock server only. The real backend has no such endpoint. */
export interface TeacherDemoState {
  /** Today becomes a holiday (Quaid-e-Azam Day) to show the closed state. */
  holiday: boolean;
  /** The next write fails with a server error, to show "Sync failed — Retry". */
  failNextSync: boolean;
}

/* ------------------------------------------------------------------ Client */

const base = "/teacher";
const paperPath = (r: TeacherPaperRef) => `${base}/papers/${encodeURIComponent(r.examId)}/${encodeURIComponent(r.classSection)}/${encodeURIComponent(r.subjectId)}`;

export const teacherApi = {
  today: (ctx: Ctx) => apiFetch<TeacherToday>(`${base}/today`, { query: ctxQuery(ctx) }),
  registers: (ctx: Ctx) => apiFetch<TeacherRegisterOverview[]>(`${base}/registers`, { query: ctxQuery(ctx) }),
  register: (ctx: Ctx, classSection: string, date?: IsoDate) => apiFetch<TeacherRegister>(`${base}/registers/${encodeURIComponent(classSection)}`, { query: { ...ctxQuery(ctx), date } }),
  submitRegister: (ctx: Ctx, classSection: string, body: TeacherRegisterSubmit, idempotencyKey: string) =>
    apiFetch<TeacherRegister>(`${base}/registers/${encodeURIComponent(classSection)}/submit`, { method: "POST", query: ctxQuery(ctx), body, idempotencyKey }),
  requestChange: (ctx: Ctx, classSection: string, body: TeacherChangeInput, idempotencyKey: string) =>
    apiFetch<TeacherChangeRequest>(`${base}/registers/${encodeURIComponent(classSection)}/changes`, { method: "POST", query: ctxQuery(ctx), body, idempotencyKey }),

  papers: (ctx: Ctx) => apiFetch<TeacherPaper[]>(`${base}/papers`, { query: ctxQuery(ctx) }),
  paper: (ctx: Ctx, ref: TeacherPaperRef) => apiFetch<TeacherPaperSheet>(paperPath(ref), { query: ctxQuery(ctx) }),
  saveMarks: (ctx: Ctx, ref: TeacherPaperRef, marks: Record<string, ExamsMark>, idempotencyKey: string) =>
    apiFetch<TeacherPaperSheet>(paperPath(ref), { method: "PUT", query: ctxQuery(ctx), body: { marks }, idempotencyKey }),
  submitMarks: (ctx: Ctx, ref: TeacherPaperRef, marks: Record<string, ExamsMark>, idempotencyKey: string) =>
    apiFetch<TeacherPaperSheet>(`${paperPath(ref)}/submit`, { method: "POST", query: ctxQuery(ctx), body: { marks }, idempotencyKey }),

  timetable: (ctx: Ctx) => apiFetch<TeacherWeek>(`${base}/timetable`, { query: ctxQuery(ctx) }),
  classes: (ctx: Ctx) => apiFetch<TeacherClass[]>(`${base}/classes`, { query: ctxQuery(ctx) }),
  classDetail: (ctx: Ctx, classSection: string) => apiFetch<TeacherClassDetail>(`${base}/classes/${encodeURIComponent(classSection)}`, { query: ctxQuery(ctx) }),

  notifications: (ctx: Ctx) => apiFetch<TeacherNotification[]>(`${base}/notifications`, { query: ctxQuery(ctx) }),
  markRead: (ctx: Ctx, ids?: string[]) => apiFetch<{ unread: number }>(`${base}/notifications/read`, { method: "POST", query: ctxQuery(ctx), body: { ids: ids ?? null } }),
};

/** Mock mode only: the presenter's switches (Demo controls in the More tab). */
export const teacherDemoApi = {
  get: () => apiFetch<TeacherDemoState>(`${base}/demo`),
  set: (body: Partial<TeacherDemoState>) => apiFetch<TeacherDemoState>(`${base}/demo`, { method: "PUT", body }),
};

export const teacherQueries = {
  all: (ctx: Ctx) => ["teacher", ...ctxKey(ctx)] as const,
  today: (ctx: Ctx) => queryOptions({ queryKey: ["teacher", ...ctxKey(ctx), "today"], queryFn: () => teacherApi.today(ctx) }),
  registers: (ctx: Ctx) => queryOptions({ queryKey: ["teacher", ...ctxKey(ctx), "registers"], queryFn: () => teacherApi.registers(ctx) }),
  register: (ctx: Ctx, classSection: string, date?: IsoDate) =>
    queryOptions({ queryKey: ["teacher", ...ctxKey(ctx), "register", classSection, date ?? "today"], queryFn: () => teacherApi.register(ctx, classSection, date) }),
  papers: (ctx: Ctx) => queryOptions({ queryKey: ["teacher", ...ctxKey(ctx), "papers"], queryFn: () => teacherApi.papers(ctx) }),
  paper: (ctx: Ctx, ref: TeacherPaperRef) =>
    queryOptions({ queryKey: ["teacher", ...ctxKey(ctx), "paper", ref.examId, ref.classSection, ref.subjectId], queryFn: () => teacherApi.paper(ctx, ref) }),
  timetable: (ctx: Ctx) => queryOptions({ queryKey: ["teacher", ...ctxKey(ctx), "timetable"], queryFn: () => teacherApi.timetable(ctx), staleTime: 10 * 60_000 }),
  classes: (ctx: Ctx) => queryOptions({ queryKey: ["teacher", ...ctxKey(ctx), "classes"], queryFn: () => teacherApi.classes(ctx), staleTime: 5 * 60_000 }),
  classDetail: (ctx: Ctx, classSection: string) =>
    queryOptions({ queryKey: ["teacher", ...ctxKey(ctx), "class", classSection], queryFn: () => teacherApi.classDetail(ctx, classSection), staleTime: 5 * 60_000 }),
  notifications: (ctx: Ctx) => queryOptions({ queryKey: ["teacher", ...ctxKey(ctx), "notifications"], queryFn: () => teacherApi.notifications(ctx) }),
  demo: () => queryOptions({ queryKey: ["teacher", "demo"], queryFn: teacherDemoApi.get }),
};

/** "31 P · 2 A · 1 L · 0 LT" — the register summary with the brief's separators. */
export function teacherCountsLine(c: TeacherCounts): string {
  return `${c.present} P · ${c.absent} A · ${c.leave} L · ${c.late} LT`;
}

/** Counts of a register's marks. */
export function teacherCountMarks(marks: Iterable<RegisterCode>): TeacherCounts {
  const c: TeacherCounts = { present: 0, absent: 0, leave: 0, late: 0 };
  for (const m of marks) {
    if (m === "P") c.present++;
    else if (m === "A") c.absent++;
    else if (m === "L") c.leave++;
    else if (m === "LT") c.late++;
  }
  return c;
}
