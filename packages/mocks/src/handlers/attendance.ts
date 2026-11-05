import {
  attendanceCodeTotals,
  type AttendanceAbsentee,
  type AttendanceAbsenteesDay,
  type AttendanceCalendarData,
  type AttendanceCampusRow,
  type AttendanceClassReport,
  type AttendanceClassRow,
  type AttendanceClosedDay,
  type AttendanceCorrection,
  type AttendanceCorrectionApproval,
  type AttendanceCorrectionBody,
  type AttendanceDay,
  type AttendanceGroupRow,
  type AttendanceMonthlySheet,
  type AttendanceOverview,
  type AttendanceRegister,
  type AttendanceRegisterEvent,
  type AttendanceSaveBody,
  type AttendanceSaveResult,
  type AttendanceSection,
  type AttendanceSheetDay,
  type AttendanceSmsBody,
  type AttendanceSmsResult,
  type AttendanceSmsStatus,
  type AttendanceStudentReport,
  type AttendanceTotals,
  type CampusCode,
  type CampusScope,
  type RegisterCode,
  type SchoolEvent,
  type SchoolEventBody,
  type SessionUser,
} from "@mtb/api";
import type { AttendanceCode, IsoDate, IsoDateTime } from "@mtb/domain";
import { formatDate, formatSession, formatTime } from "@mtb/domain";
import { http, type HttpHandler } from "msw";
import { CURRENT_SESSION, DEMO_TODAY, demoNow } from "../clock";
import { createStore } from "../db";
import {
  addDays,
  calendarSeed,
  campusRoster,
  hash32,
  mix,
  pastMark,
  pastSubmission,
  registersFor,
  rosterFor,
  SESSION_DATES,
  todayMarks,
  totalsOf,
  weekdayOf,
  type RosterEntry,
} from "../fixtures/attendance";
import { CAMPUSES, campusName } from "../fixtures/campuses";
import { findStudent } from "../fixtures/students";
import { ctxFrom, fail, HttpResponse, latency, requirePermission } from "../util";
import { attendanceTrendFor, type DayFigures } from "./dashboard-data";
import { liveTemplate, queueBatch, smsStatusStore } from "./sms";

// Staff attendance: today's registers by class, the class register (office marking and change requests), monthly
// sheets, student and class reports, absentees with parent SMS, the school calendar and the campus summary.

/* ------------------------------------------------------------------ State */

interface StoredRegister {
  marks: Record<string, RegisterCode>;
  at: IsoDateTime;
  by: string;
  source: "Office" | "Teacher app";
}

interface SmsMark {
  status: Exclude<AttendanceSmsStatus, "NOT_SENT">;
  at: IsoDateTime;
  by: string;
  /** Date.now() when queued: shown as sent a few seconds later. */
  queuedAt?: number;
  error?: string;
}

interface AttendanceState {
  /** Registers marked in this demo (the office marking for a teacher): campus|class|date. */
  registers: Record<string, StoredRegister>;
  /** Marks that differ from the generated ones: campus|class|date|grNo (as submitted, or after an approved change). */
  overrides: Record<string, RegisterCode>;
  corrections: AttendanceCorrection[];
  /** Parent SMS for an absence: campus|date|grNo. */
  sms: Record<string, SmsMark>;
  events: SchoolEvent[];
  history: Record<string, AttendanceRegisterEvent[]>;
  idem: Record<string, unknown>;
  seq: number;
}

const correction = (id: string, grNo: string, date: IsoDate, from: RegisterCode, to: RegisterCode, by: string, at: IsoDateTime, reason: string): AttendanceCorrection => {
  const s = findStudent(grNo);
  return { id, campus: "KC", classSection: s?.classSection ?? "", date, grNo, studentName: s?.name ?? grNo, from, to, reason, requestedBy: by, requestedAt: at, status: "PENDING" };
};

/** The seven teacher requests waiting at Khalid Campus (the same ones the principal sees on the dashboard). */
function seedCorrections(): AttendanceCorrection[] {
  return [
    correction("att-1", "KC-14650", "2026-11-04", "A", "LT", "Ms Hina Javed", "2026-11-04T08:47:00+05:00", "Arrived at 08:20 AM with his father; marked absent before he reached class."),
    correction("att-2", "KC-14988", "2026-11-03", "A", "L", "Ms Hina Javed", "2026-11-03T13:02:00+05:00", "Leave application from her mother received after the register was submitted."),
    correction("att-3", "KC-14911", "2026-11-03", "P", "A", "Mr Adeel Anwar", "2026-11-03T12:15:00+05:00", "Marked present by mistake; she was absent all day."),
    correction("att-4", "KC-14377", "2026-11-02", "A", "P", "Mr Adeel Anwar", "2026-11-02T14:40:00+05:00", "Was at the inter-school debate with the sports teacher."),
    correction("att-5", "KC-15230", "2026-11-02", "LT", "P", "Ms Sana Tariq", "2026-11-02T10:05:00+05:00", "School van was late; all van students arrived together."),
    correction("att-6", "KC-14823", "2026-11-02", "LT", "P", "Ms Hina Javed", "2026-11-02T09:31:00+05:00", "School van was late; all van students arrived together."),
    correction("att-7", "KC-15102", "2026-10-31", "A", "L", "Ms Sana Tariq", "2026-10-31T11:20:00+05:00", "Medical certificate submitted by his father."),
  ];
}

function initialState(): AttendanceState {
  const corrections = seedCorrections();
  // The registers as submitted: each request's "from" mark is what the register holds until it is decided.
  const overrides: Record<string, RegisterCode> = {};
  for (const c of corrections) if (c.date !== DEMO_TODAY) overrides[`${c.campus}|${c.classSection}|${c.date}|${c.grNo}`] = c.from;
  return { registers: {}, overrides, corrections, sms: {}, events: calendarSeed(), history: {}, idem: {}, seq: 100 };
}

const store = createStore<AttendanceState>("attendance", initialState);

/* ------------------------------------------------------------------ Calendar rules */

function eventsAt(campus: CampusScope, session?: number): SchoolEvent[] {
  return store.get().events.filter((e) => (session === undefined || e.session === session) && (campus === "ALL" ? e.campus === "ALL" : e.campus === "ALL" || e.campus === campus));
}

/** Why registers are closed on a date at a campus, or null on a school day. */
export function closedOn(campus: CampusScope, date: IsoDate): AttendanceClosedDay | null {
  if (weekdayOf(date) === 0) return { name: "Sunday", kind: "WEEKLY_OFF" };
  const e = eventsAt(campus).find((x) => x.closesRegisters && x.from <= date && date <= x.to);
  return e ? { name: e.name, kind: e.kind } : null;
}

/**
 * The live school calendar's entries at a campus that overlap from–to (any session), as edited at /attendance/calendar.
 * Staff attendance, leave day counts and payroll read holidays and events from here.
 */
export function calendarEventsBetween(campus: CampusCode, from: IsoDate, to: IsoDate): SchoolEvent[] {
  return eventsAt(campus).filter((e) => e.from <= to && e.to >= from);
}

const isSchoolDay = (campus: CampusScope, date: IsoDate) => closedOn(campus, date) === null;

/** School days from `from` to `to`, both included. */
function schoolDays(campus: CampusScope, from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isSchoolDay(campus, d)) out.push(d);
  return out;
}

/** The last n school days up to and including `to`, not before `from` (the session's first day). */
function lastSchoolDays(campus: CampusScope, to: IsoDate, n: number, from: IsoDate = SESSION_DATES[CURRENT_SESSION]!.starts): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = to; out.length < n && d >= from; d = addDays(d, -1)) if (isSchoolDay(campus, d)) out.unshift(d);
  return out;
}

/* ------------------------------------------------------------------ Sessions */

/**
 * The days a session's registers cover: its first day, and the last day with registers (today in the current
 * session, the session's last day in an earlier one). Null for a session the demo has no registers for.
 */
function sessionSpan(session: number): { starts: IsoDate; ends: IsoDate; last: IsoDate } | null {
  const r = SESSION_DATES[session];
  if (!r) return null;
  return { starts: r.starts, ends: r.ends, last: r.ends < DEMO_TODAY ? r.ends : DEMO_TODAY };
}

/** Before the current session: the register came over from the old desktop software. */
const isCarriedOver = (date: IsoDate) => date < SESSION_DATES[CURRENT_SESSION]!.starts;

/* ------------------------------------------------------------------ Registers */

const regKey =(campus: CampusCode, cs: string, date: IsoDate) => `${campus}|${cs}|${date}`;
const pastCache = new Map<string, Record<string, RegisterCode>>();

function generatedPast(campus: CampusCode, cs: string, date: IsoDate): Record<string, RegisterCode> {
  const key = regKey(campus, cs, date);
  const hit = pastCache.get(key);
  if (hit) return hit;
  const marks = Object.fromEntries(rosterFor(campus, cs).map((e) => [e.grNo, pastMark(e, date)]));
  pastCache.set(key, marks);
  return marks;
}

const pendingFor = (campus: CampusCode, cs: string, date: IsoDate) => store.get().corrections.filter((c) => c.status === "PENDING" && c.campus === campus && c.classSection === cs && c.date === date);

interface RegisterState {
  marks: Record<string, RegisterCode> | null;
  status: AttendanceClassRow["status"];
  at?: IsoDateTime;
  by?: string;
  source?: "Office" | "Teacher app";
}

/** A register on a school day that is today or earlier. */
function registerState(campus: CampusCode, cs: string, date: IsoDate): RegisterState {
  const st = store.get();
  const key = regKey(campus, cs, date);
  const stored = st.registers[key];
  let base: RegisterState;
  if (stored) base = { marks: { ...stored.marks }, status: "SUBMITTED", at: stored.at, by: stored.by, source: stored.source };
  else if (date === DEMO_TODAY) {
    const row = registersFor(campus).find((r) => r.classSection === cs);
    const marks = todayMarks(campus, cs);
    base = marks && row ? { marks, status: "SUBMITTED", ...(row.submittedAt ? { at: row.submittedAt } : {}), by: row.classTeacher, ...(row.source ? { source: row.source } : {}) } : { marks: null, status: "NOT_MARKED" };
  } else {
    const sub = pastSubmission(campus, cs, date);
    // Registers from before this session were carried over from the old desktop software (no teacher app then).
    base = { marks: { ...generatedPast(campus, cs, date) }, status: "SUBMITTED", at: sub.at, by: sub.by, ...(isCarriedOver(date) ? {} : { source: sub.source }) };
  }
  if (base.marks) {
    for (const grNo of Object.keys(base.marks)) {
      const o = st.overrides[`${key}|${grNo}`];
      if (o) base.marks[grNo] = o;
    }
    if (pendingFor(campus, cs, date).length > 0) base.status = "CHANGE_PENDING";
  }
  return base;
}

const sectionTeacher = (campus: CampusCode, cs: string) => registersFor(campus).find((r) => r.classSection === cs)?.classTeacher ?? "";

function rowFrom(campus: CampusCode, cs: string, date: IsoDate): AttendanceClassRow {
  const roster = rosterFor(campus, cs);
  const r = registerState(campus, cs, date);
  const teacher = sectionTeacher(campus, cs);
  if (!r.marks) return { classSection: cs, classTeacher: teacher, status: "NOT_MARKED", enrolled: roster.length, present: 0, absent: 0, leave: 0, late: 0 };
  const codes = Object.values(r.marks);
  const n = (c: RegisterCode) => codes.filter((x) => x === c).length;
  return {
    classSection: cs,
    classTeacher: teacher,
    status: r.status,
    ...(r.at ? { submittedAt: r.at } : {}),
    ...(r.source ? { source: r.source } : {}),
    enrolled: roster.length,
    present: n("P"),
    absent: n("A"),
    leave: n("L"),
    late: n("LT"),
  };
}

/**
 * Today's rows stay exactly as the fixtures (and the dashboard) have them until something changes in this demo:
 * the office marks a register, a change is requested, or the principal decides one (approved or rejected).
 */
function rowsOn(campus: CampusCode, date: IsoDate): AttendanceClassRow[] {
  if (date !== DEMO_TODAY) return registersFor(campus).map((r) => rowFrom(campus, r.classSection, date));
  const st = store.get();
  return registersFor(campus).map((base) => {
    const key = regKey(campus, base.classSection, date);
    const touched = st.registers[key] || (st.history[key]?.length ?? 0) > 0 || Object.keys(st.overrides).some((k) => k.startsWith(`${key}|`));
    return touched ? rowFrom(campus, base.classSection, date) : base;
  });
}

const ZERO: AttendanceTotals = { enrolled: 0, marked: 0, present: 0, absent: 0, leave: 0, late: 0, attended: 0, percent: 0, registers: 0, notMarked: 0 };

function codeOf(campus: CampusCode, cs: string, date: IsoDate, grNo: string): RegisterCode | null {
  return registerState(campus, cs, date).marks?.[grNo] ?? null;
}

function buildRegister(campus: CampusCode, cs: string, date: IsoDate): AttendanceRegister {
  const st = store.get();
  const roster = rosterFor(campus, cs);
  const closed = closedOn(campus, date);
  const teacher = sectionTeacher(campus, cs);
  const head = { campus, campusName: campusName(campus), classSection: cs, date, classTeacher: teacher };
  if (closed || date > DEMO_TODAY) {
    return {
      ...head,
      status: "NOT_MARKED",
      ...(closed ? { closed } : {}),
      students: roster.map((e) => ({ grNo: e.grNo, name: e.name, rollNo: e.rollNo, hasProfile: e.hasProfile, code: null })),
      history: [],
    };
  }
  const r = registerState(campus, cs, date);
  const pending = pendingFor(campus, cs, date);
  const history: AttendanceRegisterEvent[] = [];
  if (r.marks && r.at) {
    const action = isCarriedOver(date) ? "Carried over from the old software" : r.source === "Office" ? "Marked by the office" : "Submitted in the teacher app";
    history.push({ id: "submitted", at: r.at, by: r.by ?? teacher, action, detail: `${roster.length} students` });
  }
  history.push(...(st.history[regKey(campus, cs, date)] ?? []));
  for (const c of st.corrections.filter((x) => x.campus === campus && x.classSection === cs && x.date === date && !x.id.startsWith("att-o-"))) {
    history.push({ id: c.id, at: c.requestedAt, by: c.requestedBy, action: `Change requested for ${c.studentName}`, detail: `${c.from} → ${c.to}: ${c.reason}` });
  }
  history.sort((a, b) => b.at.localeCompare(a.at));
  return {
    ...head,
    status: r.status,
    ...(r.at ? { submittedAt: r.at } : {}),
    ...(r.by ? { submittedBy: r.by } : {}),
    ...(r.source ? { source: r.source } : {}),
    students: roster.map((e) => {
      const p = pending.find((c) => c.grNo === e.grNo);
      return {
        grNo: e.grNo,
        name: e.name,
        rollNo: e.rollNo,
        hasProfile: e.hasProfile,
        code: r.marks?.[e.grNo] ?? null,
        ...(p ? { pending: { id: p.id, to: p.to, reason: p.reason, requestedBy: p.requestedBy, requestedAt: p.requestedAt } } : {}),
      };
    }),
    history,
  };
}

/* ------------------------------------------------------------------ SMS for absences */

const smsKey = (campus: CampusCode, date: IsoDate, grNo: string) => `${campus}|${date}|${grNo}`;

function smsOf(campus: CampusCode, date: IsoDate, row: AttendanceClassRow, grNo: string, code: RegisterCode, changePending: boolean): AttendanceAbsentee["sms"] {
  const stored = store.get().sms[smsKey(campus, date, grNo)];
  if (stored) {
    if (stored.status === "QUEUED" && stored.queuedAt && Date.now() - stored.queuedAt > 5000) return { status: "SENT", at: stored.at, by: stored.by };
    return { status: stored.status, at: stored.at, by: stored.by, ...(stored.error ? { error: stored.error } : {}) };
  }
  if (code !== "A") return { status: "NOT_SENT" };
  if (changePending) return { status: "HELD", error: "A change to this mark is waiting for the principal." };
  if (row.source === "Office") return { status: "NOT_SENT" };
  if (hash32(grNo) % 23 === 0) return { status: "FAILED", at: row.submittedAt ?? `${date}T08:10:00+05:00`, by: "Automatic", error: "Phone switched off — no delivery report from the network." };
  const at = row.submittedAt ? new Date(new Date(row.submittedAt).getTime() + 120_000) : null;
  return { status: "SENT", at: at ? `${date}T${formatHm(at)}:00+05:00` : `${date}T08:12:00+05:00`, by: "Automatic" };
}

/**
 * Queues "Absent today" through Messages (the template as worded in Messages → Templates), so the messages show in
 * Messages → Outbox and the delivery report and follow its pause and channel rules. Attendance keeps its own
 * per-student status for the Absentees page.
 */
function sendAbsenceSms(campus: CampusCode, session: number, user: SessionUser, language: "en" | "ur", people: Array<{ grNo: string; classSection: string }>) {
  if (people.length === 0) return;
  const sections = [...new Set(people.map((p) => p.classSection))];
  queueBatch(
    {
      campus,
      session,
      templateId: "tpl-absent",
      language,
      audience: { kind: "STUDENTS", grNos: people.map((p) => p.grNo), label: `Guardians of today's absent students · ${sections.length === 1 ? sections[0] : `${sections.length} classes`}` },
      channel: "SMS",
      title: "Absent today",
      source: "Attendance",
    },
    user,
  );
}

function formatHm(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  return `${parts.find((p) => p.type === "hour")?.value ?? "08"}:${parts.find((p) => p.type === "minute")?.value ?? "10"}`;
}

function daysAbsentInRow(campus: CampusCode, cs: string, grNo: string, date: IsoDate): number {
  let n = 0;
  let d = date;
  for (let guard = 0; guard < 40 && d >= SESSION_DATES[2026]!.starts; guard++) {
    if (isSchoolDay(campus, d)) {
      if (codeOf(campus, cs, d, grNo) !== "A") break;
      n++;
    }
    d = addDays(d, -1);
  }
  return n;
}

function absenteesOn(campus: CampusCode, date: IsoDate): AttendanceAbsentee[] {
  const out: AttendanceAbsentee[] = [];
  for (const row of rowsOn(campus, date)) {
    if (row.status === "NOT_MARKED") continue;
    const r = registerState(campus, row.classSection, date);
    const pending = pendingFor(campus, row.classSection, date);
    for (const e of rosterFor(campus, row.classSection)) {
      const code = r.marks?.[e.grNo];
      if (!code || code === "P") continue;
      const changePending = pending.some((p) => p.grNo === e.grNo);
      const guardian = e.hasProfile ? (findStudent(e.grNo)?.guardian.name ?? e.father) : e.father;
      out.push({
        grNo: e.grNo,
        name: e.name,
        classSection: row.classSection,
        classTeacher: row.classTeacher,
        code,
        hasProfile: e.hasProfile,
        guardian,
        mobile: e.mobile,
        daysInRow: code === "A" ? daysAbsentInRow(campus, row.classSection, e.grNo, date) : 0,
        changePending,
        sms: smsOf(campus, date, row, e.grNo, code, changePending),
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ Request helpers */

function idem<T>(request: Request): { key: string | null; done: T | undefined } {
  const key = request.headers.get("Idempotency-Key");
  return { key, done: key ? (store.get().idem[key] as T | undefined) : undefined };
}

const remember = (key: string | null, value: unknown) => {
  if (key) store.set((s) => ({ ...s, idem: { ...s.idem, [key]: value } }));
};

const isIso = (v: unknown): v is IsoDate => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Writes, today's registers and today's absentees belong to the current session. */
function pastSessionError(session: number) {
  return session !== CURRENT_SESSION ? fail(409, "SESSION_ENDED", `Session ${formatSession(session)} has ended and is read-only. Its registers and reports can still be opened; switch to ${formatSession(CURRENT_SESSION)} to mark or change registers.`) : null;
}

/** Reads (registers, monthly sheets, reports, summary) work for any session the demo keeps. */
function spanOrError(session: number): { starts: IsoDate; ends: IsoDate; last: IsoDate } | Response {
  return sessionSpan(session) ?? fail(404, "NO_REGISTERS", `No registers are kept for session ${formatSession(session)}. Choose session ${formatSession(CURRENT_SESSION)} or ${formatSession(CURRENT_SESSION - 1)}.`);
}

/** The simulated network delay. (Decisions made on the dashboard call decideAttendanceCorrection directly.) */
async function ready() {
  await latency();
}

function needCampus(campus: CampusScope, what: string) {
  return campus === "ALL" ? fail(400, "CAMPUS_REQUIRED", `Choose a campus to see ${what}.`) : null;
}

function findInRegisters(scope: CampusScope, grNo: string): (RosterEntry & { classSection: string; campus: CampusCode }) | null {
  const want = grNo.replace(/[^a-z0-9]/gi, "").toUpperCase();
  const campuses = scope === "ALL" ? CAMPUSES.map((c) => c.code as CampusCode) : [scope];
  for (const c of campuses) {
    const hit = campusRoster(c).find((e) => e.grNo.replace(/[^a-z0-9]/gi, "").toUpperCase() === want);
    if (hit) return { ...hit, campus: c };
  }
  return null;
}

function clampRange(fromRaw: string | null, toRaw: string | null, span: { starts: IsoDate; last: IsoDate }): { from: IsoDate; to: IsoDate } | Response {
  const from = isIso(fromRaw) ? fromRaw : span.starts;
  const to = isIso(toRaw) ? toRaw : span.last;
  if (from > to) return fail(422, "VALIDATION", "The start date is after the end date. Choose a start date on or before the end date.", { field: "from" });
  if (from > span.last || to < span.starts) return fail(422, "OUTSIDE_SESSION", `These dates are outside the session (${formatDate(span.starts)} to ${formatDate(span.last)}). Choose dates inside it.`, { field: "from" });
  return { from: from < span.starts ? span.starts : from, to: to > span.last ? span.last : to };
}

const monthsIn = (from: IsoDate, to: IsoDate) => {
  const out: string[] = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); ) {
    out.push(m);
    const [y, mo] = m.split("-").map(Number) as [number, number];
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  }
  return out;
};

/* ------------------------------------------------------------------ Dashboard and other modules */

/**
 * Every correction waiting for the principal, as dashboard approvals: the seven teacher requests seeded here
 * (att-1 … att-7) and the ones the office raises on the register page (att-o-*). This store is the single source:
 * the dashboard's approval queue lists these and calls decideAttendanceCorrection (as for receipt cancellations).
 */
export function attendanceCorrectionApprovals(): AttendanceCorrectionApproval[] {
  return store
    .get()
    .corrections.filter((c) => c.status === "PENDING")
    .map((c) => ({
      id: c.id,
      kind: "ATTENDANCE_CORRECTION",
      campus: c.campus,
      campusName: campusName(c.campus),
      requestedBy: c.requestedBy,
      requestedAt: c.requestedAt,
      student: { name: c.studentName, grNo: c.grNo, classSection: c.classSection },
      date: c.date,
      from: c.from as AttendanceCode,
      to: c.to as AttendanceCode,
      reason: c.reason,
      status: "PENDING",
    }));
}

/** Approve or reject a correction; an approved change is written into the register. */
export function decideAttendanceCorrection(id: string, approve: boolean, by: string, at: IsoDateTime = demoNow()): AttendanceCorrection | null {
  const c = store.get().corrections.find((x) => x.id === id && x.status === "PENDING");
  if (!c) return null;
  const decided: AttendanceCorrection = { ...c, status: approve ? "APPROVED" : "REJECTED" };
  const key = regKey(c.campus, c.classSection, c.date);
  store.set((s) => ({
    ...s,
    corrections: s.corrections.map((x) => (x.id === id ? decided : x)),
    overrides: approve ? { ...s.overrides, [`${key}|${c.grNo}`]: c.to } : s.overrides,
    history: { ...s.history, [key]: [...(s.history[key] ?? []), { id: `${id}-d`, at, by, action: `${approve ? "Change approved" : "Change rejected"} for ${c.studentName}`, detail: `${c.from} → ${c.to}` }] },
  }));
  return decided;
}

/** For the teacher app, the parent portal and the student profile: one student's mark on a date (null when not marked or closed). */
export function attendanceMarkOf(campus: CampusCode, classSection: string, date: IsoDate, grNo: string): AttendanceCode | null {
  if (closedOn(campus, date)) return "H";
  if (date > DEMO_TODAY) return null;
  return codeOf(campus, classSection, date, grNo);
}

/* ------------------------------------------------------------------ Summary helpers */

/** Change since yesterday per campus, as on the dashboard (handlers/dashboard.ts BASE), so the trends match. */
const DELTA: Record<CampusCode, number> = { KC: 1.2, SM: -0.6, UC: 0.4, MC: -1.9, HC: 0.8 };

function trendOf(campus: CampusCode, todayPercent: number) {
  return attendanceTrendFor(campus, { attendance: { percent: todayPercent, deltaPts: DELTA[campus] } } as DayFigures);
}

/** Month by month for a session up to its last day with registers, around the latest figure (seasonal dips). */
function monthPercents(campus: CampusScope, latestPercent: number, session: number = CURRENT_SESSION): AttendanceOverview["months"] {
  const span = sessionSpan(session) ?? sessionSpan(CURRENT_SESSION)!;
  const { starts, last } = span;
  const seasonal: Record<string, number> = { "01": -1.1, "02": 0.2, "03": -0.4, "04": 0.7, "05": -0.8, "06": 0, "07": 0, "08": -0.5, "09": 0.3, "10": 0.1, "11": 0, "12": -0.9 };
  return monthsIn(starts, last).map((m) => {
    const [y, mo] = m.split("-").map(Number) as [number, number];
    const end = m === last.slice(0, 7) ? last : `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0")}`;
    const days = schoolDays(campus, `${m}-01`, end).filter((d) => d >= starts);
    if (days.length === 0) {
      const v = eventsAt(campus, session).find((e) => e.kind === "VACATION" && e.from.slice(0, 7) <= m && m <= e.to.slice(0, 7));
      return { month: m, schoolDays: 0, percent: null, ...(v ? { note: v.name } : {}) };
    }
    const noise = (mix(hash32(`${campus}:${m}`), 7) - 0.5) * 0.9;
    const p = m === last.slice(0, 7) ? latestPercent - 0.3 : latestPercent - 0.6 + (seasonal[m.slice(5)] ?? 0) + noise;
    return { month: m, schoolDays: days.length, percent: Math.round(p * 10) / 10 };
  });
}

/* ------------------------------------------------------------------ Handlers */

export const attendanceHandlers: HttpHandler[] = [
  http.get("/api/attendance/day", async ({ request }) => {
    await ready();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requirePermission("attendance.view", ctx.campus);
    if (user instanceof Response) return user;
    const past = pastSessionError(ctx.session);
    if (past) return past;
    const date = isIso(url.searchParams.get("date")) ? url.searchParams.get("date")! : DEMO_TODAY;
    if (date > DEMO_TODAY) return fail(422, "FUTURE_DATE", "Registers open on the day. Choose today or an earlier date.", { field: "date" });
    if (date < SESSION_DATES[2026]!.starts) return fail(422, "OUTSIDE_SESSION", "This date is before the session started. Choose a date from 01-Apr-2026.", { field: "date" });
    const closed = closedOn(ctx.campus, date);
    if (closed) {
      const day: AttendanceDay = { date, rows: [], totals: ZERO, closed };
      return HttpResponse.json(day);
    }
    if (ctx.campus !== "ALL") {
      const rows = rowsOn(ctx.campus, date);
      const day: AttendanceDay = { date, rows, totals: totalsOf(rows) };
      return HttpResponse.json(day);
    }
    const open = CAMPUSES.filter((c) => !closedOn(c.code, date));
    const campuses: AttendanceCampusRow[] = open.map((c) => ({ campus: c.code, name: c.name, ...totalsOf(rowsOn(c.code, date)) }));
    const all = open.flatMap((c) => rowsOn(c.code, date));
    const day: AttendanceDay = { date, rows: [], totals: totalsOf(all), campuses };
    return HttpResponse.json(day);
  }),

  http.get("/api/attendance/sections", async ({ request }) => {
    await ready();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("attendance.view", ctx.campus);
    if (user instanceof Response) return user;
    const scope = needCampus(ctx.campus, "classes");
    if (scope) return scope;
    const list: AttendanceSection[] = registersFor(ctx.campus as CampusCode).map((r) => ({ classSection: r.classSection, classTeacher: r.classTeacher, enrolled: r.enrolled }));
    return HttpResponse.json(list);
  }),

  http.get("/api/attendance/registers/:cs", async ({ params, request }) => {
    await ready();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requirePermission("attendance.view", ctx.campus);
    if (user instanceof Response) return user;
    const scope = needCampus(ctx.campus, "a register");
    if (scope) return scope;
    const span = spanOrError(ctx.session);
    if (span instanceof Response) return span;
    const campus = ctx.campus as CampusCode;
    const cs = String(params.cs);
    if (!registersFor(campus).some((r) => r.classSection === cs)) return fail(404, "NOT_FOUND", `There is no class ${cs} at ${campusName(campus)}. Choose a class from the list.`);
    const date = isIso(url.searchParams.get("date")) ? url.searchParams.get("date")! : span.last;
    if (date < span.starts || date > span.ends) return fail(422, "OUTSIDE_SESSION", `This date is not in session ${formatSession(ctx.session)}. Choose a day from ${formatDate(span.starts)} to ${formatDate(span.last)}.`, { field: "date" });
    return HttpResponse.json(buildRegister(campus, cs, date));
  }),

  http.post("/api/attendance/registers/:cs", async ({ params, request }) => {
    await ready();
    const { key, done } = idem<AttendanceSaveResult>(request);
    if (!key) return fail(400, "IDEMPOTENCY_KEY_REQUIRED", "Missing idempotency key.");
    if (done) return HttpResponse.json(done);
    const body = (await request.json()) as AttendanceSaveBody;
    const user = requirePermission("attendance.mark", body.campus);
    if (user instanceof Response) return user;
    const past = pastSessionError(body.session);
    if (past) return past;
    const cs = String(params.cs);
    const campus = body.campus;
    if (!registersFor(campus).some((r) => r.classSection === cs)) return fail(404, "NOT_FOUND", `There is no class ${cs} at ${campusName(campus)}.`);
    if (body.date !== DEMO_TODAY) return fail(409, "NOT_TODAY", "Only today's register can be marked here. To change an earlier day, request a change for the student.");
    const closed = closedOn(campus, body.date);
    if (closed) return fail(409, "REGISTERS_CLOSED", `No attendance today — ${closed.name}. Registers are closed.`);
    const current = registerState(campus, cs, body.date);
    if (current.marks) {
      const when = current.at ? ` at ${formatTime(current.at)}` : "";
      return fail(409, "REGISTER_SUBMITTED", `${current.by ?? "The class teacher"} already submitted this register${when}. Request a change for a student instead.`);
    }
    const roster = rosterFor(campus, cs);
    const marks: Record<string, RegisterCode> = {};
    for (const m of body.marks ?? []) if (["P", "A", "L", "LT"].includes(m.code)) marks[m.grNo] = m.code;
    const missing = roster.filter((e) => !marks[e.grNo]);
    if (missing.length > 0) return fail(422, "INCOMPLETE", `${missing.length} ${missing.length === 1 ? "student has" : "students have"} no mark. Mark every student, then submit.`);
    const at = demoNow();
    const absent = roster.filter((e) => marks[e.grNo] === "A");
    const paused = smsStatusStore.get().paused;
    const now = Date.now();
    const rk = regKey(campus, cs, body.date);
    store.set((s) => {
      const sms = { ...s.sms };
      absent.forEach((e, i) => {
        sms[smsKey(campus, body.date, e.grNo)] = paused ? { status: "HELD", at, by: user.name, error: "All SMS are paused. Send again after an admin resumes SMS." } : { status: "QUEUED", at, by: user.name, queuedAt: now + i * 200 };
      });
      return {
        ...s,
        registers: { ...s.registers, [rk]: { marks: Object.fromEntries(roster.map((e) => [e.grNo, marks[e.grNo]!])), at, by: user.name, source: "Office" } },
        sms,
      };
    });
    if (!paused) {
      const guardianOf = (e: RosterEntry) => (e.hasProfile ? (findStudent(e.grNo)?.guardian.name ?? e.father) : e.father);
      sendAbsenceSms(campus, body.session, user, "ur", absent.map((e) => ({ grNo: e.grNo, name: e.name, classSection: cs, guardian: guardianOf(e), mobile: e.mobile })));
    }
    const result: AttendanceSaveResult = { register: buildRegister(campus, cs, body.date), smsQueued: paused ? 0 : absent.length, smsHeld: paused && absent.length > 0 };
    remember(key, result);
    return HttpResponse.json(result, { status: 201 });
  }),

  http.get("/api/attendance/corrections", async ({ request }) => {
    await ready();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("attendance.view", ctx.campus);
    if (user instanceof Response) return user;
    const list = store
      .get()
      .corrections.filter((c) => ctx.campus === "ALL" || c.campus === ctx.campus)
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
    return HttpResponse.json(list);
  }),

  http.post("/api/attendance/corrections", async ({ request }) => {
    await ready();
    const { key, done } = idem<AttendanceCorrection>(request);
    if (!key) return fail(400, "IDEMPOTENCY_KEY_REQUIRED", "Missing idempotency key.");
    if (done) return HttpResponse.json(done);
    const body = (await request.json()) as AttendanceCorrectionBody;
    const user = requirePermission("attendance.mark", body.campus);
    if (user instanceof Response) return user;
    const past = pastSessionError(body.session);
    if (past) return past;
    const { campus, classSection: cs, date, grNo, to } = body;
    if (!isIso(date) || date > DEMO_TODAY) return fail(422, "VALIDATION", "Changes can only be requested for today or an earlier day.", { field: "date" });
    const entry = rosterFor(campus, cs).find((e) => e.grNo === grNo);
    if (!entry) return fail(404, "NOT_FOUND", "This student is not in this register.");
    if (closedOn(campus, date)) return fail(409, "REGISTERS_CLOSED", "There was no register on this day.");
    const r = registerState(campus, cs, date);
    const from = r.marks?.[grNo];
    if (!from) return fail(409, "NOT_MARKED", "This register has not been submitted yet. Mark the register instead of requesting a change.");
    if (from === to) return fail(422, "VALIDATION", `${entry.name} is already marked ${to}. Choose a different status.`, { field: "to" });
    if (!body.reason || body.reason.trim().length < 10) return fail(422, "VALIDATION", "Write the reason in a few words (at least 10 letters), so the principal can decide.", { field: "reason" });
    if (pendingFor(campus, cs, date).some((p) => p.grNo === grNo)) return fail(409, "ALREADY_PENDING", `A change for ${entry.name} on ${formatDate(date)} is already waiting for the principal.`);
    const seq = store.get().seq + 1;
    const created: AttendanceCorrection = { id: `att-o-${seq}`, campus, classSection: cs, date, grNo, studentName: entry.name, from, to, reason: body.reason.trim(), requestedBy: user.name, requestedAt: demoNow(), status: "PENDING" };
    const rk = regKey(campus, cs, date);
    store.set((s) => ({
      ...s,
      seq,
      corrections: [created, ...s.corrections],
      history: { ...s.history, [rk]: [...(s.history[rk] ?? []), { id: created.id, at: created.requestedAt, by: user.name, action: `Change requested for ${entry.name}`, detail: `${from} → ${to}: ${created.reason}` }] },
    }));
    remember(key, created);
    return HttpResponse.json(created, { status: 201 });
  }),

  http.get("/api/attendance/monthly", async ({ request }) => {
    await ready();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requirePermission("attendance.view", ctx.campus);
    if (user instanceof Response) return user;
    const scope = needCampus(ctx.campus, "a monthly sheet");
    if (scope) return scope;
    const span = spanOrError(ctx.session);
    if (span instanceof Response) return span;
    const campus = ctx.campus as CampusCode;
    const cs = url.searchParams.get("classSection") ?? "";
    if (!registersFor(campus).some((r) => r.classSection === cs)) return fail(404, "NOT_FOUND", "Choose a class from the list.", { field: "classSection" });
    const month = url.searchParams.get("month") ?? span.last.slice(0, 7);
    const { starts } = span;
    if (!/^\d{4}-\d{2}$/.test(month) || month < starts.slice(0, 7) || month > span.last.slice(0, 7)) {
      return fail(422, "VALIDATION", `Choose a month in session ${formatSession(ctx.session)}, from ${formatDate(starts)} to ${formatDate(span.last)}.`, { field: "month" });
    }
    const [y, m] = month.split("-").map(Number) as [number, number];
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const days: AttendanceSheetDay[] = [];
    for (let d = 1; d <= last; d++) {
      const date = `${month}-${String(d).padStart(2, "0")}`;
      const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekdayOf(date)]!;
      const closed = closedOn(campus, date);
      if (date > span.last) days.push({ date, weekday, kind: closed?.kind === "WEEKLY_OFF" ? "OFF" : "FUTURE", ...(closed ? { label: closed.name } : {}) });
      else if (closed) days.push({ date, weekday, kind: closed.kind === "WEEKLY_OFF" ? "OFF" : "CLOSED", label: closed.name });
      else if (date < starts) days.push({ date, weekday, kind: "CLOSED", label: "Before the session" });
      else days.push({ date, weekday, kind: "SCHOOL" });
    }
    const school = days.filter((d) => d.kind === "SCHOOL").map((d) => d.date);
    const states = new Map(school.map((d) => [d, registerState(campus, cs, d)]));
    const roster = rosterFor(campus, cs);
    // The month before (within the session) and the session to date, for the register's "Attendances" columns.
    const prevMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    const prevLast = new Date(Date.UTC(Number(prevMonth.slice(0, 4)), Number(prevMonth.slice(5, 7)), 0)).getUTCDate();
    const prevFrom = `${prevMonth}-01` < starts ? starts : (`${prevMonth}-01` as IsoDate);
    const prevTo = `${prevMonth}-${String(prevLast).padStart(2, "0")}` as IsoDate;
    const monthEnd = `${month}-${String(last).padStart(2, "0")}` as IsoDate;
    const toDate = monthEnd > span.last ? span.last : monthEnd;
    const prevStates = prevTo < starts ? [] : schoolDays(campus, prevFrom, prevTo > span.last ? span.last : prevTo).map((d) => registerState(campus, cs, d)).filter((st) => st.marks);
    const sessionStates = schoolDays(campus, starts, toDate).map((d) => registerState(campus, cs, d)).filter((st) => st.marks);
    const attendedIn = (list: typeof sessionStates, grNo: string) => list.filter((st) => st.marks?.[grNo] === "P" || st.marks?.[grNo] === "LT").length;
    const students = roster.map((e) => {
      const codes: Partial<Record<IsoDate, RegisterCode>> = {};
      for (const d of school) {
        const c = states.get(d)?.marks?.[e.grNo];
        if (c) codes[d] = c;
      }
      return {
        grNo: e.grNo,
        name: e.name,
        father: e.father,
        rollNo: e.rollNo,
        hasProfile: e.hasProfile,
        codes,
        totals: attendanceCodeTotals(Object.values(codes)),
        previousMonth: { attended: attendedIn(prevStates, e.grNo) },
        sessionToDate: { attended: attendedIn(sessionStates, e.grNo) },
      };
    });
    const dayTotals: AttendanceMonthlySheet["dayTotals"] = {};
    for (const d of school) {
      const marks = states.get(d)?.marks;
      if (!marks) continue;
      const vals = Object.values(marks);
      dayTotals[d] = { attended: vals.filter((c) => c === "P" || c === "LT").length, marked: vals.length };
    }
    const sheet: AttendanceMonthlySheet = {
      campus,
      campusName: campusName(campus),
      classSection: cs,
      classTeacher: sectionTeacher(campus, cs),
      month,
      days,
      students,
      dayTotals,
      totals: attendanceCodeTotals(students.flatMap((s) => Object.values(s.codes))),
      schoolDaysPreviousMonth: prevStates.length,
      schoolDaysSessionToDate: sessionStates.length,
    };
    return HttpResponse.json(sheet);
  }),

  http.get("/api/attendance/students/:grNo", async ({ params, request }) => {
    await ready();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requirePermission("attendance.view", ctx.campus);
    if (user instanceof Response) return user;
    const span = spanOrError(ctx.session);
    if (span instanceof Response) return span;
    const hit = findInRegisters(ctx.campus, String(params.grNo));
    if (!hit) return fail(404, "NOT_FOUND", `No student with G.R. number ${String(params.grNo)} in ${ctx.campus === "ALL" ? "any campus's" : `${campusName(ctx.campus)}'s`} registers. Check the number, or choose the student from the class list.`);
    const range = clampRange(url.searchParams.get("from"), url.searchParams.get("to"), span);
    if (range instanceof Response) return range;
    const months: AttendanceStudentReport["months"] = [];
    const codes: Array<{ date: IsoDate; code: RegisterCode }> = [];
    let holidays = 0;
    for (const m of monthsIn(range.from, range.to)) {
      const days: Partial<Record<IsoDate, AttendanceCode>> = {};
      const holidayNames: Partial<Record<IsoDate, string>> = {};
      const [y, mo] = m.split("-").map(Number) as [number, number];
      const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      for (let d = 1; d <= lastDay; d++) {
        const date = `${m}-${String(d).padStart(2, "0")}`;
        if (date < range.from || date > range.to) continue;
        const closed = closedOn(hit.campus, date);
        if (closed) {
          if (closed.kind !== "WEEKLY_OFF") {
            days[date] = "H";
            holidayNames[date] = closed.name;
            holidays++;
          }
          continue;
        }
        const c = codeOf(hit.campus, hit.classSection, date, hit.grNo);
        if (c) {
          days[date] = c;
          codes.push({ date, code: c });
        }
      }
      months.push({ month: m, days, holidayNames });
    }
    let longest = 0;
    let run = 0;
    for (const c of codes) {
      run = c.code === "A" ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    const report: AttendanceStudentReport = {
      grNo: hit.grNo,
      name: hit.name,
      father: hit.father,
      classSection: hit.classSection,
      campus: hit.campus,
      campusName: campusName(hit.campus),
      hasProfile: hit.hasProfile,
      from: range.from,
      to: range.to,
      totals: attendanceCodeTotals(codes.map((c) => c.code)),
      holidays,
      months,
      marks: codes.filter((c) => c.code !== "P").reverse(),
      longestAbsence: longest,
    };
    return HttpResponse.json(report);
  }),

  http.get("/api/attendance/class-report", async ({ request }) => {
    await ready();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requirePermission("attendance.view", ctx.campus);
    if (user instanceof Response) return user;
    const scope = needCampus(ctx.campus, "a class report");
    if (scope) return scope;
    const span = spanOrError(ctx.session);
    if (span instanceof Response) return span;
    const campus = ctx.campus as CampusCode;
    const cs = url.searchParams.get("classSection") ?? "";
    if (!registersFor(campus).some((r) => r.classSection === cs)) return fail(404, "NOT_FOUND", "Choose a class from the list.", { field: "classSection" });
    const range = clampRange(url.searchParams.get("from"), url.searchParams.get("to"), span);
    if (range instanceof Response) return range;
    const days = schoolDays(campus, range.from, range.to);
    const states = days.map((d) => registerState(campus, cs, d));
    const report: AttendanceClassReport = {
      campus,
      classSection: cs,
      classTeacher: sectionTeacher(campus, cs),
      from: range.from,
      to: range.to,
      schoolDays: days.length,
      rows: rosterFor(campus, cs).map((e) => ({ grNo: e.grNo, name: e.name, father: e.father, rollNo: e.rollNo, hasProfile: e.hasProfile, mobile: e.mobile, totals: attendanceCodeTotals(states.map((s) => s.marks?.[e.grNo])) })),
    };
    return HttpResponse.json(report);
  }),

  http.get("/api/attendance/absentees", async ({ request }) => {
    await ready();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requirePermission("attendance.view", ctx.campus);
    if (user instanceof Response) return user;
    const past = pastSessionError(ctx.session) ?? needCampus(ctx.campus, "absent students");
    if (past) return past;
    const campus = ctx.campus as CampusCode;
    const date = isIso(url.searchParams.get("date")) ? url.searchParams.get("date")! : DEMO_TODAY;
    if (date > DEMO_TODAY) return fail(422, "FUTURE_DATE", "Choose today or an earlier date.", { field: "date" });
    const tpl = liveTemplate("tpl-absent");
    const closed = closedOn(campus, date);
    const day: AttendanceAbsenteesDay = { date, ...(closed ? { closed } : {}), rows: closed ? [] : absenteesOn(campus, date), template: { en: tpl?.en ?? "", ur: tpl?.ur ?? "" } };
    return HttpResponse.json(day);
  }),

  http.post("/api/attendance/absentees/sms", async ({ request }) => {
    await ready();
    const { key, done } = idem<AttendanceSmsResult>(request);
    if (!key) return fail(400, "IDEMPOTENCY_KEY_REQUIRED", "Missing idempotency key.");
    if (done) return HttpResponse.json(done);
    const body = (await request.json()) as AttendanceSmsBody;
    const user = requirePermission("sms.send", body.campus);
    if (user instanceof Response) return user;
    const past = pastSessionError(body.session);
    if (past) return past;
    const status = smsStatusStore.get();
    if (status.paused) return fail(423, "SMS_PAUSED", `All SMS are paused${status.pausedBy ? ` by ${status.pausedBy}` : ""}. Ask an admin to resume SMS, then send again.`);
    if (body.date !== DEMO_TODAY) return fail(409, "NOT_TODAY", "Parent messages go out for today's absences only.");
    if (!body.grNos?.length) return fail(422, "VALIDATION", "Choose at least one student.");
    const rows = absenteesOn(body.campus, body.date);
    const at = demoNow();
    const now = Date.now();
    let queued = 0;
    let skipped = 0;
    const next: Record<string, SmsMark> = {};
    for (const grNo of body.grNos) {
      const row = rows.find((r) => r.grNo === grNo);
      if (!row || row.changePending || row.sms.status === "SENT" || row.sms.status === "QUEUED") {
        skipped++;
        continue;
      }
      next[smsKey(body.campus, body.date, grNo)] = { status: "QUEUED", at, by: user.name, queuedAt: now + queued * 200 };
      queued++;
    }
    store.set((s) => ({ ...s, sms: { ...s.sms, ...next } }));
    const sentNow = rows.filter((r) => next[smsKey(body.campus, body.date, r.grNo)]);
    sendAbsenceSms(body.campus, body.session, user, body.language === "ur" ? "ur" : "en", sentNow.map((r) => ({ grNo: r.grNo, name: r.name, classSection: r.classSection, guardian: r.guardian, mobile: r.mobile })));
    const result: AttendanceSmsResult = { queued, skipped };
    remember(key, result);
    return HttpResponse.json(result, { status: 201 });
  }),

  http.get("/api/attendance/calendar", async ({ request }) => {
    await ready();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("attendance.view", ctx.campus);
    if (user instanceof Response) return user;
    const range = SESSION_DATES[ctx.session] ?? SESSION_DATES[2026]!;
    const events = (ctx.campus === "ALL" ? store.get().events.filter((e) => e.session === ctx.session) : eventsAt(ctx.campus, ctx.session)).sort((a, b) => a.from.localeCompare(b.from));
    const today = DEMO_TODAY;
    const soFar = ctx.session === CURRENT_SESSION ? schoolDays(ctx.campus, range.starts, today).length : schoolDays(ctx.campus, range.starts, range.ends).length;
    const left = ctx.session === CURRENT_SESSION ? schoolDays(ctx.campus, addDays(today, 1), range.ends).length : 0;
    const data: AttendanceCalendarData = { session: ctx.session, starts: range.starts, ends: range.ends, events, schoolDaysSoFar: soFar, schoolDaysLeft: left };
    return HttpResponse.json(data);
  }),

  http.post("/api/attendance/calendar", async ({ request }) => {
    await ready();
    const body = (await request.json()) as SchoolEventBody;
    const checked = checkEvent(body, null);
    if (checked instanceof Response) return checked;
    const seq = store.get().seq + 1;
    const created: SchoolEvent = { ...clean(body), id: `cal-n${seq}`, updatedBy: checked.name, updatedAt: demoNow() };
    store.set((s) => ({ ...s, seq, events: [...s.events, created] }));
    pastCache.clear();
    return HttpResponse.json(created, { status: 201 });
  }),

  http.put("/api/attendance/calendar/:id", async ({ params, request }) => {
    await ready();
    const body = (await request.json()) as SchoolEventBody;
    const existing = store.get().events.find((e) => e.id === String(params.id));
    if (!existing) return fail(404, "NOT_FOUND", "This calendar entry was deleted. Reload the calendar.");
    const checked = checkEvent(body, existing);
    if (checked instanceof Response) return checked;
    const updated: SchoolEvent = { ...clean(body), id: existing.id, updatedBy: checked.name, updatedAt: demoNow() };
    store.set((s) => ({ ...s, events: s.events.map((e) => (e.id === existing.id ? updated : e)) }));
    pastCache.clear();
    return HttpResponse.json(updated);
  }),

  http.delete("/api/attendance/calendar/:id", async ({ params }) => {
    await ready();
    const existing = store.get().events.find((e) => e.id === String(params.id));
    if (!existing) return fail(404, "NOT_FOUND", "This calendar entry was already deleted.");
    const user = requirePermission("attendance.calendar", existing.campus);
    if (user instanceof Response) return user;
    if (existing.session !== CURRENT_SESSION) return fail(409, "SESSION_ENDED", "Past sessions are read-only.");
    if (existing.closesRegisters && existing.from <= DEMO_TODAY) return fail(409, "ALREADY_STARTED", `${existing.name} has already started, so it stays on the calendar. Registers for those days were closed.`);
    store.set((s) => ({ ...s, events: s.events.filter((e) => e.id !== existing.id) }));
    return HttpResponse.json({ status: "ok" });
  }),

  http.get("/api/attendance/summary", async ({ request }) => {
    await ready();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("attendance.view", ctx.campus);
    if (user instanceof Response) return user;
    const span = spanOrError(ctx.session);
    if (span instanceof Response) return span;
    const current = ctx.session === CURRENT_SESSION;
    // The current session is summarised as of today; an earlier one as of its last school day (read-only).
    const date = current ? DEMO_TODAY : (lastSchoolDays(ctx.campus, span.last, 1, span.starts)[0] ?? span.last);
    const codes = ctx.campus === "ALL" ? CAMPUSES.map((c) => c.code as CampusCode) : [ctx.campus];
    const todayRows = codes.map((c) => ({ c, rows: !current && closedOn(c, date) ? [] : rowsOn(c, date) }));
    const today = totalsOf(todayRows.flatMap((x) => x.rows));
    const avg = (xs: number[]) => Math.round((xs.reduce((a, v) => a + v, 0) / Math.max(1, xs.length)) * 10) / 10;
    const pct = (attended: number, marked: number) => (marked === 0 ? 0 : Math.round((attended / marked) * 1000) / 10);

    let trend: Array<{ date: IsoDate; percent: number }>;
    let groups: AttendanceGroupRow[];
    let lowStudents: AttendanceOverview["lowStudents"] = [];
    if (current) {
      // Trend: the dashboard's 14 school days; all campuses are weighted by students marked.
      const perCampus = todayRows.map(({ c, rows }) => {
        const t = totalsOf(rows);
        return { c, t, trend: trendOf(c, t.percent) };
      });
      const weight = perCampus.reduce((a, x) => a + x.t.marked, 0) || 1;
      trend = perCampus[0]!.trend.map((d, i) => ({ date: d.date, percent: Math.round((perCampus.reduce((a, x) => a + x.trend[i]!.percent * x.t.marked, 0) / weight) * 10) / 10 }));
      trend[trend.length - 1] = { date: trend.at(-1)!.date, percent: today.percent };
      groups = perCampus.map(({ c, t, trend: tr }) => ({ label: campusName(c), attended: Math.round((avg(tr.map((d) => d.percent)) * t.marked) / 100), marked: t.marked, percent: avg(tr.map((d) => d.percent)) }));
    } else {
      // Past session: the last 14 school days straight from the registers kept for it.
      const days = lastSchoolDays(ctx.campus, date, 14, span.starts);
      const perCampus = codes.map((c) => ({ c, days: days.map((d) => (closedOn(c, d) ? totalsOf([]) : totalsOf(rowsOn(c, d)))) }));
      trend = days.map((d, i) => ({ date: d, percent: pct(perCampus.reduce((a, x) => a + x.days[i]!.attended, 0), perCampus.reduce((a, x) => a + x.days[i]!.marked, 0)) }));
      groups = perCampus.map(({ c, days: ds }) => {
        const attended = ds.reduce((a, t) => a + t.attended, 0);
        const marked = ds.reduce((a, t) => a + t.marked, 0);
        return { label: campusName(c), attended, marked, percent: pct(attended, marked) };
      });
    }

    if (ctx.campus !== "ALL") {
      const campus = ctx.campus;
      const days = lastSchoolDays(campus, date, 26, span.starts);
      groups = [];
      const students: AttendanceOverview["lowStudents"] = [];
      for (const r of todayRows[0]!.rows) {
        const states = days.map((d) => registerState(campus, r.classSection, d));
        let attended = 0;
        let marked = 0;
        for (const e of rosterFor(campus, r.classSection)) {
          const t = attendanceCodeTotals(states.map((s) => s.marks?.[e.grNo]));
          attended += t.present + t.late;
          marked += t.schoolDays;
          if (t.percent !== null && t.percent < 75) students.push({ grNo: e.grNo, name: e.name, classSection: r.classSection, hasProfile: e.hasProfile, percent: t.percent, absent: t.absent });
        }
        groups.push({ label: r.classSection, attended, marked, percent: pct(attended, marked) });
      }
      lowStudents = students.sort((a, b) => a.percent - b.percent).slice(0, 8);
    }
    const gA = groups.reduce((a, g) => a + g.attended, 0);
    const gM = groups.reduce((a, g) => a + g.marked, 0);
    const submitted = todayRows.flatMap((x) => x.rows).filter((r) => r.status !== "NOT_MARKED");
    const byNine = submitted.filter((r) => r.submittedAt && r.submittedAt.slice(11, 16) <= "09:00").length;
    const overview: AttendanceOverview = {
      date,
      today,
      trend,
      weekPercent: avg(trend.slice(-5).map((d) => d.percent)),
      fortnightPercent: avg(trend.map((d) => d.percent)),
      groups,
      groupsPercent: gM === 0 ? 0 : Math.round((gA / gM) * 1000) / 10,
      months: monthPercents(ctx.campus, current ? today.percent : avg(trend.map((d) => d.percent)), ctx.session),
      lowStudents,
      onTime: { submitted: submitted.length, byNine },
    };
    return HttpResponse.json(overview);
  }),
];

/* ------------------------------------------------------------------ Calendar validation */

function clean(body: SchoolEventBody): Omit<SchoolEvent, "id" | "updatedBy" | "updatedAt"> {
  return {
    campus: body.campus,
    session: body.session,
    from: body.from,
    to: body.to,
    kind: body.kind,
    name: body.name.trim(),
    ...(body.nameUr?.trim() ? { nameUr: body.nameUr.trim() } : {}),
    closesRegisters: body.closesRegisters,
    ...(body.note?.trim() ? { note: body.note.trim() } : {}),
  };
}

function checkEvent(body: SchoolEventBody, existing: SchoolEvent | null) {
  const user = requirePermission("attendance.calendar", body.campus);
  if (user instanceof Response) return user;
  if (existing && existing.campus !== body.campus) {
    const also = requirePermission("attendance.calendar", existing.campus);
    if (also instanceof Response) return also;
  }
  if (body.session !== CURRENT_SESSION || (existing && existing.session !== CURRENT_SESSION)) return fail(409, "SESSION_ENDED", "Past sessions are read-only.");
  if (!body.name || body.name.trim().length < 3) return fail(422, "VALIDATION", "Give the day a name, such as “Iqbal Day”.", { field: "name" });
  if (!isIso(body.from)) return fail(422, "VALIDATION", "Choose the first day.", { field: "from" });
  if (!isIso(body.to)) return fail(422, "VALIDATION", "Choose the last day.", { field: "to" });
  if (body.to < body.from) return fail(422, "VALIDATION", "The last day is before the first day.", { field: "to" });
  const range = SESSION_DATES[CURRENT_SESSION]!;
  if (body.from < range.starts || body.to > range.ends) return fail(422, "VALIDATION", `Choose dates inside this session (${formatDate(range.starts)} to ${formatDate(range.ends)}).`, { field: "from" });
  if (existing && existing.closesRegisters && existing.from <= DEMO_TODAY) return fail(409, "ALREADY_STARTED", `${existing.name} has already started, so it can't be changed. Registers for those days were closed.`);
  if (body.closesRegisters && body.from <= DEMO_TODAY) {
    return fail(409, "REGISTERS_TAKEN", `Registers were already taken on ${formatDate(body.from)}. A day without school can start tomorrow (${formatDate(addDays(DEMO_TODAY, 1))}) at the earliest.`, { field: "from" });
  }
  return user;
}

/** The day's registers for other modules (teacher app home): rows, or the reason there is no school. */
export function attendanceDayFor(campus: CampusCode, date: IsoDate): { rows: AttendanceClassRow[]; closed: AttendanceClosedDay | null } {
  const closed = closedOn(campus, date);
  return { rows: closed ? [] : rowsOn(campus, date), closed };
}
