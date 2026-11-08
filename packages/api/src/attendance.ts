// Attendance API (staff app). Teachers mark registers in the teacher app; the office can mark a register that a
// teacher could not, and every change after a register is submitted goes through a correction request that the
// principal approves on the dashboard. The school calendar (holidays, vacations, events) closes registers.
// Served by the real backend (backend/docs/modules/04_attendance.md). Every percentage here is attended ÷ marked
// (attended = present + late), one decimal, and null when nothing was marked: the UI shows "—" for null.
import type { AttendanceCode, IsoDate, IsoDateTime } from "@mtb/domain";
import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { ctxKey, ctxQuery, type CampusCode, type CampusScope, type Ctx } from "./context";

export type AttendanceRegisterStatus = "SUBMITTED" | "NOT_MARKED" | "CHANGE_PENDING";

/** Codes a register can hold (holidays come from the calendar, never from a register). */
export type RegisterCode = Exclude<AttendanceCode, "H">;

/** A class teacher's name; "" (or omitted) while Setup › Teachers has no class teacher for the section. */
export type ClassTeacherName = string | undefined;

export interface AttendanceClassRow {
  /** "7-B" */
  classSection: string;
  classTeacher?: ClassTeacherName;
  status: AttendanceRegisterStatus;
  submittedAt?: IsoDateTime;
  /** Where the register was taken. */
  source?: "Teacher app" | "Office";
  enrolled: number;
  present: number;
  absent: number;
  leave: number;
  late: number;
}

export interface AttendanceTotals {
  enrolled: number;
  /** Students in registers that have been submitted. */
  marked: number;
  present: number;
  absent: number;
  leave: number;
  late: number;
  /** Present + late. */
  attended: number;
  /** attended ÷ marked, one decimal; null when nobody was marked. */
  percent: number | null;
  registers: number;
  notMarked: number;
}

export interface AttendanceCampusRow extends AttendanceTotals {
  campus: CampusCode;
  name: string;
}

/** A day on which the calendar closes registers. */
export interface AttendanceClosedDay {
  name: string;
  kind: SchoolEventKind | "WEEKLY_OFF";
}

export interface AttendanceDay {
  date: IsoDate;
  /** Empty with "All campuses": choose a campus to see classes. On a closed day only the classes that took a register that day (old-system Sunday registers). */
  rows: AttendanceClassRow[];
  totals: AttendanceTotals;
  campuses?: AttendanceCampusRow[];
  /** Set when the calendar closes registers on this date (the weekly day off, Iqbal Day, winter vacation…). Registers already taken that day still count and are listed. */
  closed?: AttendanceClosedDay;
}

/* ------------------------------------------------------------------ Class register */

export interface AttendanceRegisterStudent {
  grNo: string;
  name: string;
  /** 0 when the student has no roll number. */
  rollNo: number;
  /** null while the register is not marked. */
  code: RegisterCode | null;
  /** A change waiting for the principal. */
  pending?: { id: string; to: RegisterCode; reason: string; requestedBy: string; requestedAt: IsoDateTime };
}

export interface AttendanceRegisterEvent {
  id: string;
  at: IsoDateTime;
  by: string;
  action: string;
  detail?: string;
}

export interface AttendanceRegister {
  campus: CampusCode;
  campusName: string;
  classSection: string;
  date: IsoDate;
  status: AttendanceRegisterStatus;
  classTeacher?: ClassTeacherName;
  submittedAt?: IsoDateTime;
  submittedBy?: string;
  /** Omitted for registers carried over from the old desktop software. */
  source?: "Teacher app" | "Office";
  /** Set when the calendar closes registers on this date. */
  closed?: AttendanceClosedDay;
  students: AttendanceRegisterStudent[];
  history: AttendanceRegisterEvent[];
}

export interface AttendanceSaveBody {
  campus: CampusCode;
  session: number;
  date: IsoDate;
  marks: Array<{ grNo: string; code: RegisterCode }>;
}

export interface AttendanceSaveResult {
  register: AttendanceRegister;
  /**
   * "Absent today" messages written for the parents of absent students. SMS sending starts with the Messages module,
   * so they are held, not sent.
   */
  smsQueued: number;
  /** True when any absence message was held (smsQueued > 0). */
  smsHeld: boolean;
}

export interface AttendanceCorrectionBody {
  campus: CampusCode;
  session: number;
  classSection: string;
  date: IsoDate;
  grNo: string;
  to: RegisterCode;
  reason: string;
}

/** A change to a submitted register, approved or rejected by the principal on the dashboard. */
export interface AttendanceCorrection {
  id: string;
  campus: CampusCode;
  classSection: string;
  date: IsoDate;
  grNo: string;
  studentName: string;
  from: RegisterCode;
  to: RegisterCode;
  reason: string;
  requestedBy: string;
  requestedAt: IsoDateTime;
  status: "PENDING" | "APPROVED" | "REJECTED";
  /** Who approved or rejected it, and when (decided requests only). */
  decidedBy?: string;
  decidedAt?: IsoDateTime;
}

/* ------------------------------------------------------------------ Sections, monthly sheet, reports */

export interface AttendanceSection {
  classSection: string;
  classTeacher?: ClassTeacherName;
  enrolled: number;
}

export type AttendanceSheetDayKind = "SCHOOL" | "OFF" | "CLOSED" | "FUTURE";

export interface AttendanceSheetDay {
  date: IsoDate;
  /** "Mon" */
  weekday: string;
  kind: AttendanceSheetDayKind;
  /** Holiday or event name on a CLOSED day; the weekday's name ("Sunday") on the campus's weekly day off. */
  label?: string;
}

export interface AttendanceCodeTotals {
  present: number;
  absent: number;
  leave: number;
  late: number;
  schoolDays: number;
  /** (present + late) ÷ school days, one decimal; null with no school days. */
  percent: number | null;
}

export interface AttendanceSheetStudent {
  grNo: string;
  name: string;
  /** "" when not on record. */
  father: string;
  rollNo: number;
  codes: Partial<Record<IsoDate, RegisterCode>>;
  totals: AttendanceCodeTotals;
  /** Days attended (present or late) in the month before, within the session. */
  previousMonth: { attended: number };
  /** Days attended from the start of the session to the end of this month (or today). */
  sessionToDate: { attended: number };
}

/** Monthly attendance sheet for one class: students × days (the legacy "Attendance Register" print). */
export interface AttendanceMonthlySheet {
  campus: CampusCode;
  campusName: string;
  classSection: string;
  classTeacher?: ClassTeacherName;
  /** "2026-10" */
  month: string;
  days: AttendanceSheetDay[];
  students: AttendanceSheetStudent[];
  /** Per school day: students present or late, and students in the register. */
  dayTotals: Partial<Record<IsoDate, { attended: number; marked: number }>>;
  totals: AttendanceCodeTotals;
  /** Registers taken ("lessons delivered") in the month before, within the session; 0 in the session's first month. */
  schoolDaysPreviousMonth: number;
  /** Registers taken from the start of the session to the end of this month (or today). */
  schoolDaysSessionToDate: number;
}

export interface AttendanceStudentReport {
  grNo: string;
  name: string;
  father: string;
  classSection: string;
  campus: CampusCode;
  campusName: string;
  from: IsoDate;
  to: IsoDate;
  totals: AttendanceCodeTotals;
  holidays: number;
  /** One entry per month in the range: the codes and holiday names, for month calendars. */
  months: Array<{ month: string; days: Partial<Record<IsoDate, AttendanceCode>>; holidayNames: Partial<Record<IsoDate, string>> }>;
  /** Days the student was absent, on leave or late, newest first. */
  marks: Array<{ date: IsoDate; code: RegisterCode }>;
  /** Longest run of school days absent in the range. */
  longestAbsence: number;
}

export interface AttendanceClassReportRow {
  grNo: string;
  name: string;
  father: string;
  rollNo: number;
  /** The guardian's mobile; "" when none is on record. */
  mobile: string;
  totals: AttendanceCodeTotals;
}

export interface AttendanceClassReport {
  campus: CampusCode;
  classSection: string;
  classTeacher?: ClassTeacherName;
  from: IsoDate;
  to: IsoDate;
  schoolDays: number;
  rows: AttendanceClassReportRow[];
}

/* ------------------------------------------------------------------ Absentees and SMS */

/**
 * HELD: written and waiting, because SMS sending starts with the Messages module (or a change to the mark is
 * pending). SENT, QUEUED and FAILED appear only once the Messages module sends (and for the old system's log).
 */
export type AttendanceSmsStatus = "SENT" | "QUEUED" | "NOT_SENT" | "FAILED" | "HELD";

export interface AttendanceAbsentee {
  grNo: string;
  name: string;
  classSection: string;
  classTeacher?: ClassTeacherName;
  code: RegisterCode;
  /** The family's primary contact; "" when none is on record. */
  guardian: string;
  /** That contact's mobile; "" when none is on record (no message can be written). */
  mobile: string;
  /** School days absent in a row, including today (absent only). */
  daysInRow: number;
  /** A correction is waiting: the parent message waits too. */
  changePending: boolean;
  sms: { status: AttendanceSmsStatus; at?: IsoDateTime; by?: string; error?: string };
}

export interface AttendanceAbsenteesDay {
  date: IsoDate;
  /** Set when the calendar closes registers on this date; rows still list absences from registers taken that day. */
  closed?: AttendanceClosedDay;
  rows: AttendanceAbsentee[];
  /** The "Absent today" template, so the preview matches what parents receive. */
  template: { en: string; ur: string };
}

export interface AttendanceSmsBody {
  campus: CampusCode;
  session: number;
  date: IsoDate;
  grNos: string[];
  language: "en" | "ur";
}

export interface AttendanceSmsResult {
  /** Messages written (held until SMS sending starts with the Messages module). */
  queued: number;
  /** Skipped: not absent (only Absent gets the message), already held today, a change pending, or no mobile. */
  skipped: number;
}

/* ------------------------------------------------------------------ Calendar */

export type SchoolEventKind = "HOLIDAY" | "VACATION" | "EXAM" | "EVENT";

export const SCHOOL_EVENT_KIND_LABEL: Record<SchoolEventKind, string> = {
  HOLIDAY: "Public holiday",
  VACATION: "Vacation",
  EXAM: "Exams",
  EVENT: "School event",
};

export interface SchoolEvent {
  /** Exam days from the exam date sheets (TERM / BOARD papers) come as kind EXAM with id "exam-{examId}-{yyyymmdd}", locked:
   * they change only through the exam's date sheet (exams module). */
  id: string;
  /** "ALL" applies at every campus. */
  campus: CampusScope;
  session: number;
  from: IsoDate;
  to: IsoDate;
  kind: SchoolEventKind;
  name: string;
  nameUr?: string;
  /** No school: registers are closed and teachers see "No attendance today". */
  closesRegisters: boolean;
  note?: string;
  updatedBy: string;
  updatedAt: IsoDateTime;
  /** The entry can no longer be changed or removed (it has started and closed registers, or came from the old system). */
  locked?: boolean;
  lockedReason?: string;
}

export interface SchoolEventBody {
  campus: CampusScope;
  session: number;
  from: IsoDate;
  to: IsoDate;
  kind: SchoolEventKind;
  name: string;
  nameUr?: string;
  closesRegisters: boolean;
  note?: string;
}

export interface AttendanceCalendarData {
  session: number;
  /** First and last day of the session. */
  starts: IsoDate;
  ends: IsoDate;
  events: SchoolEvent[];
  /** School days so far and still to come in the session (minus the weekly day off and closed days). */
  schoolDaysSoFar: number;
  schoolDaysLeft: number;
  /**
   * The days the session's registers can be read for: from the earlier of the session's first day and its first
   * register, to the later of its last day and its last register (old classes sometimes ran outside April–March).
   * Optional until every server sends it (spec 04 §5.2 C5): without it the UI uses `starts` / `ends`.
   */
  registersFrom?: IsoDate;
  registersTo?: IsoDate;
  /** The campus's weekly days off, 0 = Sunday … 6 = Saturday (C5; without it the UI assumes Sunday). */
  weeklyOff?: number[];
}

/* ------------------------------------------------------------------ Summary */

export interface AttendanceGroupRow {
  /** "7-B", "Class 7" or "Khalid Campus" */
  label: string;
  attended: number;
  marked: number;
  /** null when nobody was marked. */
  percent: number | null;
}

export interface AttendanceOverview {
  date: IsoDate;
  today: AttendanceTotals;
  /**
   * Last 14 school days (the dashboard's attendance trend); percent null on a day with nothing marked.
   * Every window below is the campus's own (a day with a register counts as a school day). All campuses:
   * each campus counts over its own last 5 / 14 / 26 school days, so the trend lists every date in some
   * campus's last 14 (14 dates when the calendars agree, more when they differ) and a campus's figures
   * equal its one-campus figures (spec 04 §11 F2).
   */
  trend: Array<{ date: IsoDate; percent: number | null }>;
  /** Attended ÷ marked over the last 5 and the last 14 school days (weighted, not an average of daily figures). */
  weekPercent: number | null;
  fortnightPercent: number | null;
  /** By campus (All campuses; a campus's row = the sum of its class rows) or by class (one campus), over the last 26 school days. */
  groups: AttendanceGroupRow[];
  groupsPercent: number | null;
  /** Session to date, month by month. schoolDays: the campus calendar (All campuses: the all-campuses calendar), plus any closed day on which a register was taken. */
  months: Array<{ month: string; schoolDays: number; percent: number | null; note?: string }>;
  /** Students below the low-attendance line (75%) over the last 26 school days (one campus only), lowest first. */
  lowStudents: Array<{ grNo: string; name: string; classSection: string; percent: number; absent: number }>;
  /** Registers submitted by 09:00 AM today. */
  onTime: { submitted: number; byNine: number };
}

/* ------------------------------------------------------------------ Client */

const q = (ctx: Ctx, extra: Record<string, string | number | undefined> = {}) => ({ ...ctxQuery(ctx), ...extra });

export const attendanceApi = {
  day: (ctx: Ctx, date?: IsoDate) => apiFetch<AttendanceDay>("/attendance/day", { query: q(ctx, { date }) }),
  sections: (ctx: Ctx) => apiFetch<AttendanceSection[]>("/attendance/sections", { query: q(ctx) }),
  register: (ctx: Ctx, classSection: string, date: IsoDate) => apiFetch<AttendanceRegister>(`/attendance/registers/${encodeURIComponent(classSection)}`, { query: q(ctx, { date }) }),
  saveRegister: (classSection: string, body: AttendanceSaveBody, idempotencyKey: string) =>
    apiFetch<AttendanceSaveResult>(`/attendance/registers/${encodeURIComponent(classSection)}`, { method: "POST", body, idempotencyKey }),
  requestCorrection: (body: AttendanceCorrectionBody, idempotencyKey: string) => apiFetch<AttendanceCorrection>("/attendance/corrections", { method: "POST", body, idempotencyKey }),
  corrections: (ctx: Ctx) => apiFetch<AttendanceCorrection[]>("/attendance/corrections", { query: q(ctx) }),
  monthly: (ctx: Ctx, classSection: string, month: string) => apiFetch<AttendanceMonthlySheet>("/attendance/monthly", { query: q(ctx, { classSection, month }) }),
  student: (ctx: Ctx, grNo: string, from: IsoDate, to: IsoDate) => apiFetch<AttendanceStudentReport>(`/attendance/students/${encodeURIComponent(grNo)}`, { query: q(ctx, { from, to }) }),
  classReport: (ctx: Ctx, classSection: string, from: IsoDate, to: IsoDate) => apiFetch<AttendanceClassReport>("/attendance/class-report", { query: q(ctx, { classSection, from, to }) }),
  absentees: (ctx: Ctx, date?: IsoDate) => apiFetch<AttendanceAbsenteesDay>("/attendance/absentees", { query: q(ctx, { date }) }),
  smsAbsentees: (body: AttendanceSmsBody, idempotencyKey: string) => apiFetch<AttendanceSmsResult>("/attendance/absentees/sms", { method: "POST", body, idempotencyKey }),
  calendar: (ctx: Ctx) => apiFetch<AttendanceCalendarData>("/attendance/calendar", { query: q(ctx) }),
  createEvent: (body: SchoolEventBody) => apiFetch<SchoolEvent>("/attendance/calendar", { method: "POST", body }),
  updateEvent: (id: string, body: SchoolEventBody) => apiFetch<SchoolEvent>(`/attendance/calendar/${encodeURIComponent(id)}`, { method: "PUT", body }),
  deleteEvent: (id: string) => apiFetch<{ status: "ok" }>(`/attendance/calendar/${encodeURIComponent(id)}`, { method: "DELETE" }),
  summary: (ctx: Ctx) => apiFetch<AttendanceOverview>("/attendance/summary", { query: q(ctx) }),
};

export const attendanceQueries = {
  day: (ctx: Ctx, date?: IsoDate) => queryOptions({ queryKey: ["attendance", ...ctxKey(ctx), "day", date ?? "today"], queryFn: () => attendanceApi.day(ctx, date) }),
  sections: (ctx: Ctx) => queryOptions({ queryKey: ["attendance", ...ctxKey(ctx), "sections"], queryFn: () => attendanceApi.sections(ctx), staleTime: 60_000 }),
  register: (ctx: Ctx, classSection: string, date: IsoDate) =>
    queryOptions({ queryKey: ["attendance", ...ctxKey(ctx), "register", classSection, date], queryFn: () => attendanceApi.register(ctx, classSection, date) }),
  corrections: (ctx: Ctx) => queryOptions({ queryKey: ["attendance", ...ctxKey(ctx), "corrections"], queryFn: () => attendanceApi.corrections(ctx) }),
  monthly: (ctx: Ctx, classSection: string, month: string) =>
    queryOptions({ queryKey: ["attendance", ...ctxKey(ctx), "monthly", classSection, month], queryFn: () => attendanceApi.monthly(ctx, classSection, month) }),
  student: (ctx: Ctx, grNo: string, from: IsoDate, to: IsoDate) =>
    queryOptions({ queryKey: ["attendance", ...ctxKey(ctx), "student", grNo, from, to], queryFn: () => attendanceApi.student(ctx, grNo, from, to) }),
  classReport: (ctx: Ctx, classSection: string, from: IsoDate, to: IsoDate) =>
    queryOptions({ queryKey: ["attendance", ...ctxKey(ctx), "class-report", classSection, from, to], queryFn: () => attendanceApi.classReport(ctx, classSection, from, to) }),
  absentees: (ctx: Ctx, date?: IsoDate) => queryOptions({ queryKey: ["attendance", ...ctxKey(ctx), "absentees", date ?? "today"], queryFn: () => attendanceApi.absentees(ctx, date) }),
  calendar: (ctx: Ctx) => queryOptions({ queryKey: ["attendance", ...ctxKey(ctx), "calendar"], queryFn: () => attendanceApi.calendar(ctx), staleTime: 60_000 }),
  summary: (ctx: Ctx) => queryOptions({ queryKey: ["attendance", ...ctxKey(ctx), "summary"], queryFn: () => attendanceApi.summary(ctx) }),
};

/** "P" → "Present". */
export const REGISTER_CODE_LABEL: Record<RegisterCode, string> = { P: "Present", A: "Absent", L: "Leave", LT: "Late" };

/** Totals for a list of codes: present and late count as attended; holidays are not school days. */
export function attendanceCodeTotals(codes: Iterable<RegisterCode | undefined>): AttendanceCodeTotals {
  const t = { present: 0, absent: 0, leave: 0, late: 0 };
  for (const c of codes) {
    if (c === "P") t.present++;
    else if (c === "A") t.absent++;
    else if (c === "L") t.leave++;
    else if (c === "LT") t.late++;
  }
  const schoolDays = t.present + t.absent + t.leave + t.late;
  return { ...t, schoolDays, percent: schoolDays === 0 ? null : Math.round(((t.present + t.late) / schoolDays) * 1000) / 10 };
}
