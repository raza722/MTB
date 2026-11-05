// Teacher app: today's classes, registers, offline sync, marks entry.
// The phone's outbox replays writes with the same Idempotency-Key, so every write here answers a replay with the
// response it gave the first time. Marks go into the shared exams store (handlers/exams.ts); timetables, rosters and
// the school calendar come from the timetable and attendance modules.
import {
  bellDay,
  examsSits,
  teacherCountMarks,
  type CampusCode,
  type ExamsMark,
  type RegisterCode,
  type SessionUser,
  type TeacherChangeInput,
  type TeacherChangeRequest,
  type TeacherClass,
  type TeacherClassDetail,
  type TeacherClassRole,
  type TeacherClosedDay,
  type TeacherCounts,
  type TeacherDemoState,
  type TeacherNotification,
  type TeacherPaper,
  type TeacherPaperSheet,
  type TeacherPeriod,
  type TeacherRegister,
  type TeacherRegisterCard,
  type TeacherRegisterDay,
  type TeacherRegisterOverview,
  type TeacherRegisterStatus,
  type TeacherRegisterSubmit,
  type TeacherStudentContact,
  type TeacherToday,
  type TeacherWeek,
  type TeacherWeekDay,
} from "@mtb/api";
import { formatDate, formatTime, summariseAttendance, type AttendanceCode, type IsoDate, type IsoDateTime } from "@mtb/domain";
import { http, type HttpHandler } from "msw";
import { CURRENT_SESSION, DEMO_TODAY, demoNow } from "../clock";
import { createStore } from "../db";
import { addDays, pastMark, pastSubmission, registersFor, rosterFor, SESSION_DATES, weekdayOf, type RosterEntry } from "../fixtures/attendance";
import { campusName } from "../fixtures/campuses";
import type { ExamRecord } from "../fixtures/exams";
import { CAMPUS_PRINCIPAL, seedTeacherChanges, seedTeacherNotifications, TEACHER_DEMO_HOLIDAY } from "../fixtures/teacher";
import { scheduleSeed } from "../fixtures/timetable";
import { ctxFrom, fail, HttpResponse, latency, requirePermission, requireUser } from "../util";
import { attendanceDayFor, closedOn, decideAttendanceCorrection } from "./attendance";
import { examPapersForTeacher, examsStore, saveExamMarks, setExamPaperStatus } from "./exams";
import { teacherDay } from "./timetable";

/* ------------------------------------------------------------------ State */

interface StoredRegister {
  marks: Record<string, RegisterCode>;
  submittedAt: IsoDateTime;
  submittedBy: string;
  takenOffline: boolean;
  smsSent: number;
}

interface TeacherState {
  /** Registers taken in the teacher app, by `campus|classSection|date`. */
  registers: Record<string, StoredRegister>;
  changes: TeacherChangeRequest[];
  /** Notifications per teacher name (seeded on first read). */
  notifications: Record<string, TeacherNotification[]>;
  demo: TeacherDemoState;
  idem: Record<string, { status: number; body: unknown }>;
  seq: number;
}

/**
 * The teacher app keeps its own register store. In the staff fixtures (fixtures/attendance.ts registersFor) 7-B's
 * register is already submitted this morning with a change pending, which is what the principal's dashboard shows.
 * Here 7-B starts Not marked so the teacher-attendance flow (brief §9 flow 3) can be walked from the beginning:
 * Today → 7-B register → mark → Submit → offline → synced → Request change.
 */
const store = createStore<TeacherState>("teacher", () => ({
  registers: {},
  changes: seedTeacherChanges(),
  notifications: {},
  demo: { holiday: false, failNextSync: false },
  idem: {},
  seq: 100,
}));

const regKey = (campus: CampusCode, cs: string, date: IsoDate) => `${campus}|${cs}|${date}`;
const CODES: RegisterCode[] = ["P", "A", "L", "LT"];
const CODE_WORD: Record<RegisterCode, string> = { P: "Present", A: "Absent", L: "Leave", LT: "Late" };

/* ------------------------------------------------------------------ Request helpers */

type Ok = { user: SessionUser; campus: CampusCode; session: number };

function context(request: Request): Ok | Response {
  const ctx = ctxFrom(new URL(request.url));
  if (ctx.campus === "ALL") return fail(400, "CAMPUS_REQUIRED", "Choose your campus first.");
  const user = requirePermission("teacher.app", ctx.campus);
  if (user instanceof Response) return user;
  return { user, campus: ctx.campus, session: ctx.session };
}

function readOnly(session: number): Response | null {
  return session !== CURRENT_SESSION ? fail(409, "SESSION_READ_ONLY", "That session is closed. Marks and registers can only change in the current session.") : null;
}

/** A replayed write gets the first answer back. */
function replay(key: string | null): Response | null {
  if (!key) return null;
  const hit = store.get().idem[key];
  return hit ? HttpResponse.json(hit.body as object, { status: hit.status }) : null;
}

function answer(key: string | null, status: number, body: unknown): Response {
  if (key) store.set((s) => ({ ...s, idem: { ...s.idem, [key]: { status, body } } }));
  return HttpResponse.json(body as object, { status });
}

/** Demo switch: the next write fails before anything is saved (shows "Sync failed — Retry"). */
function demoFailure(): Response | null {
  if (!store.get().demo.failNextSync) return null;
  store.set((s) => ({ ...s, demo: { ...s.demo, failNextSync: false } }));
  return fail(503, "UNAVAILABLE", "The school server didn't answer. Nothing was lost: your work is still on this phone. Try again in a moment.");
}

function notify(teacher: string, item: Omit<TeacherNotification, "id" | "read" | "at">) {
  store.set((s) => {
    const list = s.notifications[teacher] ?? seedTeacherNotifications(teacher);
    return { ...s, seq: s.seq + 1, notifications: { ...s.notifications, [teacher]: [{ ...item, id: `tn-${s.seq + 1}`, at: demoNow(), read: false }, ...list] } };
  });
}

function notificationsOf(teacher: string): TeacherNotification[] {
  const s = store.get();
  const list = s.notifications[teacher];
  if (list) return list;
  const seeded = seedTeacherNotifications(teacher);
  store.set((x) => ({ ...x, notifications: { ...x.notifications, [teacher]: seeded } }));
  return seeded;
}

/* ------------------------------------------------------------------ Calendar and registers */

const classTeacherCache = new Map<CampusCode, Map<string, string>>();

/** Class-section → class teacher at a campus (from the attendance registers). */
function classTeachers(campus: CampusCode): Map<string, string> {
  const hit = classTeacherCache.get(campus);
  if (hit) return hit;
  const map = new Map(registersFor(campus).map((r) => [r.classSection, r.classTeacher]));
  classTeacherCache.set(campus, map);
  return map;
}

/** Sections whose daily register this teacher takes. */
function mySections(campus: CampusCode, teacher: string): string[] {
  return [...classTeachers(campus).entries()].filter(([, t]) => t === teacher).map(([cs]) => cs);
}

function closedDay(campus: CampusCode, date: IsoDate): TeacherClosedDay | null {
  if (date === DEMO_TODAY && store.get().demo.holiday) return TEACHER_DEMO_HOLIDAY;
  const c = closedOn(campus, date);
  return c ? { name: c.name, kind: String(c.kind) } : null;
}

function changeFor(campus: CampusCode, cs: string, date: IsoDate, grNo: string, statuses: Array<TeacherChangeRequest["status"]>) {
  return store.get().changes.find((c) => c.campus === campus && c.classSection === cs && c.date === date && c.grNo === grNo && statuses.includes(c.status));
}

/** A student's mark on a date: today from this app's store, earlier days from the attendance record. */
function markOf(campus: CampusCode, cs: string, e: RosterEntry, date: IsoDate): RegisterCode | null {
  if (date === DEMO_TODAY) return store.get().registers[regKey(campus, cs, date)]?.marks[e.grNo] ?? null;
  // The register keeps the original mark until the principal approves a change.
  const approved = changeFor(campus, cs, date, e.grNo, ["APPROVED"]);
  if (approved) return approved.to;
  const waiting = changeFor(campus, cs, date, e.grNo, ["PENDING", "REJECTED"]);
  if (waiting) return waiting.from;
  return pastMark(e, date);
}

function pendingOn(campus: CampusCode, cs: string, date: IsoDate): TeacherChangeRequest[] {
  return store.get().changes.filter((c) => c.campus === campus && c.classSection === cs && c.date === date && c.status === "PENDING");
}

function statusOn(campus: CampusCode, cs: string, date: IsoDate): TeacherRegisterStatus {
  if (date === DEMO_TODAY && !store.get().registers[regKey(campus, cs, date)]) return "NOT_MARKED";
  return pendingOn(campus, cs, date).length ? "CHANGE_PENDING" : "SUBMITTED";
}

function countsOn(campus: CampusCode, cs: string, date: IsoDate): TeacherCounts | null {
  const marks = rosterFor(campus, cs).map((e) => markOf(campus, cs, e, date));
  if (marks.some((m) => m === null)) return null;
  return teacherCountMarks(marks as RegisterCode[]);
}

function card(campus: CampusCode, cs: string, date: IsoDate): TeacherRegisterCard {
  const stored = date === DEMO_TODAY ? store.get().registers[regKey(campus, cs, date)] : undefined;
  const closed = closedDay(campus, date);
  return {
    ...(closed ? { closed } : {}),
    classSection: cs,
    date,
    status: statusOn(campus, cs, date),
    enrolled: rosterFor(campus, cs).length,
    counts: countsOn(campus, cs, date),
    ...(stored ? { submittedAt: stored.submittedAt } : {}),
    pendingChanges: pendingOn(campus, cs, date).length,
  };
}

function buildRegister(campus: CampusCode, cs: string, date: IsoDate, session: number): TeacherRegister {
  const roster = rosterFor(campus, cs);
  const closed = closedDay(campus, date);
  const stored = date === DEMO_TODAY ? store.get().registers[regKey(campus, cs, date)] : undefined;
  const status = closed ? "NOT_MARKED" : statusOn(campus, cs, date);
  const pending = pendingOn(campus, cs, date);
  const students = roster.map((e) => {
    const mark = closed ? "P" : (markOf(campus, cs, e, date) ?? "P");
    const p = pending.find((c) => c.grNo === e.grNo);
    return { grNo: e.grNo, rollNo: e.rollNo, name: e.name, father: e.father, mark, ...(p ? { pending: { id: p.id, to: p.to } } : {}) };
  });
  const counts = closed || status === "NOT_MARKED" ? null : teacherCountMarks(students.map((s) => s.mark));
  const past = date !== DEMO_TODAY ? pastSubmission(campus, cs, date) : null;
  const submittedAt = stored?.submittedAt ?? past?.at;
  const submittedBy = stored?.submittedBy ?? past?.by;
  let lockedReason: string | undefined;
  if (session !== CURRENT_SESSION) lockedReason = "That session is closed. Registers can't change.";
  else if (closed) lockedReason = `No attendance today — ${closed.name}.`;
  else if (status !== "NOT_MARKED") lockedReason = `Submitted${submittedAt ? ` at ${formatTime(submittedAt)}` : ""}. To correct a mark, request a change.`;
  return {
    campus,
    campusName: campusName(campus),
    classSection: cs,
    date,
    status,
    closed,
    enrolled: roster.length,
    students,
    counts,
    ...(submittedAt && status !== "NOT_MARKED" ? { submittedAt } : {}),
    ...(submittedBy && status !== "NOT_MARKED" ? { submittedBy } : {}),
    ...(status !== "NOT_MARKED" ? { source: stored ? ("Teacher app" as const) : (past?.source ?? "Teacher app") } : {}),
    ...(stored ? { takenOffline: stored.takenOffline, smsSent: stored.smsSent } : {}),
    changes: store
      .get()
      .changes.filter((c) => c.campus === campus && c.classSection === cs && c.date === date)
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)),
    canMark: lockedReason === undefined,
    ...(lockedReason ? { lockedReason } : {}),
  };
}

/** The last `count` school days before today, newest first. */
function schoolDaysBefore(campus: CampusCode, count: number): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = addDays(DEMO_TODAY, -1); out.length < count && d >= SESSION_DATES[CURRENT_SESSION]!.starts; d = addDays(d, -1)) {
    if (!closedOn(campus, d)) out.push(d);
  }
  return out;
}

const sessionDaysCache = new Map<CampusCode, IsoDate[]>();

/** School days this session up to yesterday. */
function sessionSchoolDays(campus: CampusCode): IsoDate[] {
  const hit = sessionDaysCache.get(campus);
  if (hit) return hit;
  const out: IsoDate[] = [];
  for (let d = SESSION_DATES[CURRENT_SESSION]!.starts; d < DEMO_TODAY; d = addDays(d, 1)) if (!closedOn(campus, d)) out.push(d);
  sessionDaysCache.set(campus, out);
  return out;
}

/* ------------------------------------------------------------------ Periods and the week */

function periodsOf(campus: CampusCode, teacher: string, date: IsoDate, withRegister: boolean): TeacherPeriod[] {
  if (closedDay(campus, date)) return [];
  let list: Array<Omit<TeacherPeriod, "register">> = teacherDay(campus, teacher, date);
  if (!list.length) {
    // Not in the timetable yet (a new teacher): show the class they take the register for, first period.
    list = mySections(campus, teacher).map((cs) => ({ period: 1, start: "08:00", end: "08:40", classSection: cs, subject: "Class register", room: `Room ${cs}`, cover: false }));
  }
  if (!withRegister) return list;
  const mine = new Set(mySections(campus, teacher));
  const rows = attendanceDayFor(campus, date).rows;
  return list.map((p) => {
    if (mine.has(p.classSection)) {
      const c = card(campus, p.classSection, date);
      return { ...p, register: { status: c.status, mine: true, classTeacher: teacher, ...(c.submittedAt ? { submittedAt: c.submittedAt } : {}) } };
    }
    const r = rows.find((x) => x.classSection === p.classSection);
    return r ? { ...p, register: { status: r.status, mine: false, classTeacher: r.classTeacher, ...(r.submittedAt ? { submittedAt: r.submittedAt } : {}) } } : p;
  });
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function week(campus: CampusCode, teacher: string): TeacherWeek {
  const monday = addDays(DEMO_TODAY, -((weekdayOf(DEMO_TODAY) + 6) % 7));
  const days: TeacherWeekDay[] = [0, 1, 2, 3, 4, 5].map((i) => {
    const date = addDays(monday, i);
    return { date, day: i + 1, dayName: DAY_NAMES[weekdayOf(date)] ?? "", closed: closedDay(campus, date), periods: periodsOf(campus, teacher, date, date === DEMO_TODAY) };
  });
  const sched = scheduleSeed().find((s) => s.campus === campus && s.active) ?? scheduleSeed()[0]!;
  return {
    weekOf: monday,
    today: DEMO_TODAY,
    days,
    normal: bellDay(sched, sched.normal),
    friday: bellDay(sched, sched.friday),
    periodsThisWeek: days.reduce((a, d) => a + d.periods.length, 0),
  };
}

/** Sections the teacher teaches this week or takes the register for, with subjects and periods. */
function myClasses(campus: CampusCode, teacher: string): TeacherClass[] {
  const w = week(campus, teacher);
  const map = new Map<string, { subjects: Set<string>; periods: number; rooms: Map<string, number> }>();
  for (const d of w.days)
    for (const p of d.periods) {
      if (p.cover) continue;
      const x = map.get(p.classSection) ?? { subjects: new Set<string>(), periods: 0, rooms: new Map<string, number>() };
      x.subjects.add(p.subject);
      x.periods++;
      x.rooms.set(p.room, (x.rooms.get(p.room) ?? 0) + 1);
      map.set(p.classSection, x);
    }
  const mine = mySections(campus, teacher);
  for (const cs of mine) if (!map.has(cs)) map.set(cs, { subjects: new Set(), periods: 0, rooms: new Map([[`Room ${cs}`, 1]]) });
  return [...map.entries()]
    .map(([cs, x]) => {
      const roles: TeacherClassRole[] = [...(mine.includes(cs) ? (["CLASS_TEACHER"] as const) : []), ...(x.subjects.size ? (["SUBJECT_TEACHER"] as const) : [])];
      const room = [...x.rooms.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
      return { classSection: cs, roles, subjects: [...x.subjects], periodsPerWeek: x.periods, enrolled: rosterFor(campus, cs).length, room, attendancePercent: classPercent(campus, cs) };
    })
    .sort((a, b) => Number(b.roles.includes("CLASS_TEACHER")) - Number(a.roles.includes("CLASS_TEACHER")) || a.classSection.localeCompare(b.classSection, "en", { numeric: true }));
}

function studentCodes(campus: CampusCode, cs: string, e: RosterEntry): AttendanceCode[] {
  const codes: AttendanceCode[] = sessionSchoolDays(campus).map((d) => markOf(campus, cs, e, d) ?? "P");
  const today = markOf(campus, cs, e, DEMO_TODAY);
  if (today && !closedDay(campus, DEMO_TODAY)) codes.push(today);
  return codes;
}

function classPercent(campus: CampusCode, cs: string): number | null {
  const all = rosterFor(campus, cs).flatMap((e) => studentCodes(campus, cs, e));
  return summariseAttendance(all).percent;
}

/* ------------------------------------------------------------------ Papers */

function examOf(id: string): ExamRecord | undefined {
  return examsStore.get().find((e) => e.id === id);
}

function teacherPapers(campus: CampusCode, teacher: string): TeacherPaper[] {
  const rank = (p: TeacherPaper) => (p.examStatus === "DECLARED" ? 3 : p.locked ? 2 : 1);
  return examPapersForTeacher(teacher, campus)
    .map((p): TeacherPaper => {
      const exam = examOf(p.examId);
      const paperDate = exam?.subjects.find((s) => s.id === p.subjectId)?.date;
      let lockedReason: string | undefined;
      if (p.examStatus === "DECLARED") lockedReason = `Results declared${exam?.declaredOn ? ` on ${formatDate(exam.declaredOn)}` : ""}. The marks are locked.`;
      else if (p.status === "SUBMITTED") lockedReason = `Submitted to the exam office${p.updatedAt ? ` on ${formatDate(p.updatedAt)} at ${formatTime(p.updatedAt)}` : ""}. Ask the exam office to return it if a mark needs correcting.`;
      else if (p.status === "CHECKED") lockedReason = "Checked by the exam office. Ask them to return it if a mark needs correcting.";
      return {
        examId: p.examId,
        examName: p.examName,
        category: p.category,
        examStatus: p.examStatus,
        classSection: p.classSection,
        subjectId: p.subjectId,
        subjectName: p.subjectName,
        maxMarks: p.maxMarks,
        status: p.status,
        entered: p.entered,
        candidates: p.candidates,
        absent: p.absent,
        leave: p.leave,
        ...(paperDate ? { paperDate } : {}),
        ...(p.updatedAt ? { updatedAt: p.updatedAt } : {}),
        ...(p.updatedBy ? { updatedBy: p.updatedBy } : {}),
        ...(p.note ? { note: p.note } : {}),
        locked: lockedReason !== undefined,
        ...(lockedReason ? { lockedReason } : {}),
      };
    })
    .sort((a, b) => rank(a) - rank(b) || (b.paperDate ?? "").localeCompare(a.paperDate ?? ""));
}

function sheetOf(campus: CampusCode, teacher: string, examId: string, cs: string, subjectId: string): TeacherPaperSheet | Response {
  const paper = teacherPapers(campus, teacher).find((p) => p.examId === examId && p.classSection === cs && p.subjectId === subjectId);
  const exam = examOf(examId);
  if (!exam) return fail(404, "NOT_FOUND", "This exam no longer exists. Go back and pick it again.");
  if (!paper) return fail(403, "NOT_YOUR_PAPER", "This paper is marked by another teacher. You can enter marks only for your own classes and subjects.");
  // Only the students whose group sits this paper (Biology or Computer Science in classes 9–10).
  const subject = exam.subjects.find((s) => s.id === subjectId);
  const students = exam.roster
    .filter((p) => p.classSection === cs && (!subject || examsSits(subject, p.group)))
    .sort((a, b) => a.rollNo - b.rollNo)
    .map((p) => ({ id: p.id, rollNo: p.rollNo, name: p.name, mark: (exam.marks[p.id]?.[subjectId] ?? null) as ExamsMark }));
  return { ...paper, students };
}

/* ------------------------------------------------------------------ Handlers */

const params = (p: Record<string, string | readonly string[] | undefined>, k: string) => decodeURIComponent(String(p[k] ?? ""));

export const teacherHandlers: HttpHandler[] = [
  /* ---------------- Today */
  http.get("/api/teacher/today", async ({ request }) => {
    await latency();
    const c = context(request);
    if (c instanceof Response) return c;
    const { campus, user } = c;
    const closed = closedDay(campus, DEMO_TODAY);
    let nextClosed: TeacherToday["nextClosed"] = null;
    for (let i = 1; i <= 60 && !nextClosed; i++) {
      const d = addDays(DEMO_TODAY, i);
      const x = weekdayOf(d) !== 0 ? closedOn(campus, d) : null;
      if (x) nextClosed = { date: d, name: x.name };
    }
    const body: TeacherToday = {
      date: DEMO_TODAY,
      campus,
      campusName: campusName(campus),
      session: c.session,
      teacherName: user.name,
      closed,
      periods: periodsOf(campus, user.name, DEMO_TODAY, true),
      registers: mySections(campus, user.name).map((cs) => card(campus, cs, DEMO_TODAY)),
      papers: c.session === CURRENT_SESSION ? teacherPapers(campus, user.name).filter((p) => !p.locked) : [],
      unread: notificationsOf(user.name).filter((n) => !n.read).length,
      nextClosed,
    };
    return HttpResponse.json(body);
  }),

  /* ---------------- Registers */
  http.get("/api/teacher/registers", async ({ request }) => {
    await latency();
    const c = context(request);
    if (c instanceof Response) return c;
    const { campus, user } = c;
    const out: TeacherRegisterOverview[] = mySections(campus, user.name).map((cs) => {
      const roster = rosterFor(campus, cs);
      const days: TeacherRegisterDay[] = schoolDaysBefore(campus, 10).map((date) => {
        const counts = countsOn(campus, cs, date) ?? { present: roster.length, absent: 0, leave: 0, late: 0 };
        const sub = pastSubmission(campus, cs, date);
        return {
          date,
          status: statusOn(campus, cs, date),
          counts,
          percent: Math.round(((counts.present + counts.late) / Math.max(1, roster.length)) * 1000) / 10,
          submittedAt: sub.at,
          by: sub.by,
          pending: pendingOn(campus, cs, date).length,
        };
      });
      return {
        classSection: cs,
        enrolled: roster.length,
        today: card(campus, cs, DEMO_TODAY),
        days,
        changes: store
          .get()
          .changes.filter((x) => x.campus === campus && x.classSection === cs)
          .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)),
      };
    });
    return HttpResponse.json(out);
  }),

  http.get("/api/teacher/registers/:cs", async ({ request, params: p }) => {
    await latency();
    const c = context(request);
    if (c instanceof Response) return c;
    const cs = params(p, "cs");
    const date = new URL(request.url).searchParams.get("date") || DEMO_TODAY;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(422, "VALIDATION", "That isn't a date.", { field: "date" });
    if (date > DEMO_TODAY) return fail(422, "FUTURE_DATE", "A register can't be opened for a day that hasn't come yet.", { field: "date" });
    if (!classTeachers(c.campus).has(cs)) return fail(404, "NOT_FOUND", `There is no class ${cs} at ${campusName(c.campus)}.`);
    if (!mySections(c.campus, c.user.name).includes(cs)) {
      return fail(403, "NOT_CLASS_TEACHER", `${classTeachers(c.campus).get(cs)} takes the ${cs} register. If you're covering for them today, ask the office to add you.`);
    }
    return HttpResponse.json(buildRegister(c.campus, cs, date, c.session));
  }),

  http.post("/api/teacher/registers/:cs/submit", async ({ request, params: p }) => {
    await latency();
    const key = request.headers.get("Idempotency-Key");
    const again = replay(key);
    if (again) return again;
    const c = context(request);
    if (c instanceof Response) return c;
    const ro = readOnly(c.session);
    if (ro) return ro;
    const down = demoFailure();
    if (down) return down;
    const cs = params(p, "cs");
    if (!mySections(c.campus, c.user.name).includes(cs)) return fail(403, "NOT_CLASS_TEACHER", `Only the class teacher submits the ${cs} register.`);
    const body = (await request.json()) as TeacherRegisterSubmit;
    if (body.date !== DEMO_TODAY) return fail(409, "NOT_TODAY", `Registers are submitted on the day. For ${formatDate(body.date)}, ask the office to enter the register.`);
    const closed = closedDay(c.campus, body.date);
    if (closed) return fail(409, "REGISTER_CLOSED", `No attendance today — ${closed.name}. Nothing was saved.`);
    const existing = store.get().registers[regKey(c.campus, cs, body.date)];
    if (existing) return fail(409, "ALREADY_SUBMITTED", `The ${cs} register was already submitted at ${formatTime(existing.submittedAt)}. To correct a mark, request a change.`);
    const roster = rosterFor(c.campus, cs);
    const marks: Record<string, RegisterCode> = {};
    for (const e of roster) {
      const m = body.marks?.[e.grNo] ?? "P";
      if (!CODES.includes(m)) return fail(422, "VALIDATION", `${e.name}: choose Present, Absent, Leave or Late.`, { field: e.grNo });
      marks[e.grNo] = m;
    }
    const unknown = Object.keys(body.marks ?? {}).find((g) => !roster.some((e) => e.grNo === g));
    if (unknown) return fail(422, "VALIDATION", `${unknown} isn't in ${cs}. Refresh the register and try again.`);
    const absent = Object.values(marks).filter((m) => m === "A").length;
    store.set((s) => ({
      ...s,
      registers: { ...s.registers, [regKey(c.campus, cs, body.date)]: { marks, submittedAt: demoNow(), submittedBy: c.user.name, takenOffline: Boolean(body.savedOffline), smsSent: absent } },
    }));
    return answer(key, 200, buildRegister(c.campus, cs, body.date, c.session));
  }),

  http.post("/api/teacher/registers/:cs/changes", async ({ request, params: p }) => {
    await latency();
    const key = request.headers.get("Idempotency-Key");
    const again = replay(key);
    if (again) return again;
    const c = context(request);
    if (c instanceof Response) return c;
    const ro = readOnly(c.session);
    if (ro) return ro;
    const down = demoFailure();
    if (down) return down;
    const cs = params(p, "cs");
    if (!mySections(c.campus, c.user.name).includes(cs)) return fail(403, "NOT_CLASS_TEACHER", `Only the class teacher can ask to change the ${cs} register.`);
    const body = (await request.json()) as TeacherChangeInput;
    const e = rosterFor(c.campus, cs).find((x) => x.grNo === body.grNo);
    if (!e) return fail(422, "VALIDATION", "Choose a student from the list.", { field: "grNo" });
    if (!CODES.includes(body.to)) return fail(422, "VALIDATION", "Choose the new status.", { field: "to" });
    if ((body.reason ?? "").trim().length < 5) return fail(422, "VALIDATION", "Say why the mark should change, in a few words.", { field: "reason" });
    if (statusOn(c.campus, cs, body.date) === "NOT_MARKED" && body.date === DEMO_TODAY) return fail(409, "NOT_SUBMITTED", "This register isn't submitted yet. Change the mark in the register itself.");
    const current = markOf(c.campus, cs, e, body.date);
    if (current === body.to) return fail(422, "VALIDATION", `${e.name} is already marked ${CODE_WORD[body.to]}. Choose a different status.`, { field: "to" });
    if (changeFor(c.campus, cs, body.date, e.grNo, ["PENDING"])) return fail(409, "ALREADY_PENDING", `A change for ${e.name} on ${formatDate(body.date)} is already waiting for approval.`);
    const seq = store.get().seq + 1;
    const req: TeacherChangeRequest = {
      id: `tc-${seq}`,
      campus: c.campus,
      classSection: cs,
      date: body.date,
      grNo: e.grNo,
      studentName: e.name,
      from: current ?? "P",
      to: body.to,
      reason: body.reason.trim(),
      status: "PENDING",
      requestedBy: c.user.name,
      requestedAt: demoNow(),
    };
    store.set((s) => ({ ...s, seq, changes: [req, ...s.changes] }));
    return answer(key, 201, req);
  }),

  /* ---------------- Marks */
  http.get("/api/teacher/papers", async ({ request }) => {
    await latency();
    const c = context(request);
    if (c instanceof Response) return c;
    return HttpResponse.json(c.session === CURRENT_SESSION ? teacherPapers(c.campus, c.user.name) : []);
  }),

  http.get("/api/teacher/papers/:examId/:cs/:subjectId", async ({ request, params: p }) => {
    await latency();
    const c = context(request);
    if (c instanceof Response) return c;
    const sheet = sheetOf(c.campus, c.user.name, params(p, "examId"), params(p, "cs"), params(p, "subjectId"));
    return sheet instanceof Response ? sheet : HttpResponse.json(sheet);
  }),

  ...(["save", "submit"] as const).map((mode) =>
    (mode === "save" ? http.put : http.post)(mode === "save" ? "/api/teacher/papers/:examId/:cs/:subjectId" : "/api/teacher/papers/:examId/:cs/:subjectId/submit", async ({ request, params: p }) => {
      await latency();
      const key = request.headers.get("Idempotency-Key");
      const again = replay(key);
      if (again) return again;
      const c = context(request);
      if (c instanceof Response) return c;
      const ro = readOnly(c.session);
      if (ro) return ro;
      const down = demoFailure();
      if (down) return down;
      const examId = params(p, "examId");
      const cs = params(p, "cs");
      const subjectId = params(p, "subjectId");
      const before = sheetOf(c.campus, c.user.name, examId, cs, subjectId);
      if (before instanceof Response) return before;
      if (before.locked) return fail(409, "LOCKED", before.lockedReason ?? "These marks are locked.");
      const { marks } = (await request.json()) as { marks: Record<string, ExamsMark> };
      const changed = Object.fromEntries(Object.entries(marks ?? {}).filter(([id, v]) => before.students.find((s) => s.id === id)?.mark !== v));
      if (Object.keys(changed).length) {
        const saved = saveExamMarks(examId, cs, subjectId, changed, c.user.name);
        if (!saved.ok) return fail(saved.status, saved.code, saved.message, saved.details !== undefined ? { details: saved.details } : {});
      }
      if (mode === "submit") {
        const done = setExamPaperStatus(examId, cs, subjectId, "SUBMIT", c.user.name);
        if (!done.ok) return fail(done.status, done.code, done.message, done.details !== undefined ? { details: done.details } : {});
      }
      const after = sheetOf(c.campus, c.user.name, examId, cs, subjectId);
      if (after instanceof Response) return after;
      return answer(key, 200, after);
    }),
  ),

  /* ---------------- Timetable, classes, contacts */
  http.get("/api/teacher/timetable", async ({ request }) => {
    await latency();
    const c = context(request);
    if (c instanceof Response) return c;
    return HttpResponse.json(week(c.campus, c.user.name));
  }),

  http.get("/api/teacher/classes", async ({ request }) => {
    await latency();
    const c = context(request);
    if (c instanceof Response) return c;
    return HttpResponse.json(myClasses(c.campus, c.user.name));
  }),

  http.get("/api/teacher/classes/:cs", async ({ request, params: p }) => {
    await latency();
    const c = context(request);
    if (c instanceof Response) return c;
    const cs = params(p, "cs");
    const cls = myClasses(c.campus, c.user.name).find((x) => x.classSection === cs);
    if (!cls) return fail(403, "NOT_YOUR_CLASS", `You don't teach ${cs}, so its contact list isn't shown. Ask the office if you need it.`);
    const closedToday = closedDay(c.campus, DEMO_TODAY);
    const students: TeacherStudentContact[] = rosterFor(c.campus, cs).map((e) => {
      const s = summariseAttendance(studentCodes(c.campus, cs, e));
      const today = closedToday ? "H" : markOf(c.campus, cs, e, DEMO_TODAY);
      // Parents' numbers go to the class teacher only; subject teachers ask the class teacher or the office.
      const mobile = cls.roles.includes("CLASS_TEACHER") ? e.mobile : "";
      return { grNo: e.grNo, rollNo: e.rollNo, name: e.name, father: e.father, guardianMobile: mobile, attendancePercent: s.percent, absentDays: s.absent, lateDays: s.late, todayMark: today };
    });
    const body: TeacherClassDetail = {
      classSection: cs,
      roles: cls.roles,
      subjects: cls.subjects,
      enrolled: students.length,
      since: SESSION_DATES[CURRENT_SESSION]!.starts,
      schoolDays: sessionSchoolDays(c.campus).length + (closedToday || !store.get().registers[regKey(c.campus, cs, DEMO_TODAY)] ? 0 : 1),
      students,
    };
    return HttpResponse.json(body);
  }),

  /* ---------------- Notifications */
  http.get("/api/teacher/notifications", async ({ request }) => {
    await latency();
    const c = context(request);
    if (c instanceof Response) return c;
    return HttpResponse.json([...notificationsOf(c.user.name)].sort((a, b) => b.at.localeCompare(a.at)));
  }),

  http.post("/api/teacher/notifications/read", async ({ request }) => {
    await latency();
    const c = context(request);
    if (c instanceof Response) return c;
    const { ids } = (await request.json()) as { ids: string[] | null };
    const list = notificationsOf(c.user.name).map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n));
    store.set((s) => ({ ...s, notifications: { ...s.notifications, [c.user.name]: list } }));
    return HttpResponse.json({ unread: list.filter((n) => !n.read).length });
  }),

  /* ---------------- Demo switches (mock server only) */
  http.get("/api/teacher/demo", async () => {
    await latency();
    const user = requireUser();
    if (user instanceof Response) return user;
    return HttpResponse.json(store.get().demo);
  }),

  http.put("/api/teacher/demo", async ({ request }) => {
    await latency();
    const user = requireUser();
    if (user instanceof Response) return user;
    const body = (await request.json()) as Partial<TeacherDemoState>;
    store.set((s) => ({
      ...s,
      demo: {
        holiday: typeof body.holiday === "boolean" ? body.holiday : s.demo.holiday,
        failNextSync: typeof body.failNextSync === "boolean" ? body.failNextSync : s.demo.failNextSync,
      },
    }));
    return HttpResponse.json(store.get().demo);
  }),

  http.post("/api/teacher/demo/decide-changes", async ({ request }) => {
    await latency();
    const user = requireUser();
    if (user instanceof Response) return user;
    const { approve } = (await request.json()) as { approve: boolean };
    const pending = store.get().changes.filter((x) => x.status === "PENDING");
    for (const ch of pending) {
      const by = CAMPUS_PRINCIPAL[ch.campus] ?? "The principal";
      const decided: TeacherChangeRequest = { ...ch, status: approve ? "APPROVED" : "REJECTED", decidedBy: by, decidedAt: demoNow() };
      store.set((s) => {
        const key = regKey(ch.campus, ch.classSection, ch.date);
        const reg = s.registers[key];
        return {
          ...s,
          changes: s.changes.map((x) => (x.id === ch.id ? decided : x)),
          // An approved change is written into today's register; earlier days read it from the request.
          registers: approve && reg ? { ...s.registers, [key]: { ...reg, marks: { ...reg.marks, [ch.grNo]: ch.to } } } : s.registers,
        };
      });
      // Requests that are also in the staff app's attendance queue are decided there too.
      if (ch.id.startsWith("att-")) decideAttendanceCorrection(ch.id, approve, by);
      notify(ch.requestedBy, {
        kind: "ATTENDANCE",
        title: `Change ${approve ? "approved" : "rejected"}: ${ch.studentName}, ${formatDate(ch.date)}`,
        body: `${CODE_WORD[ch.from]} → ${CODE_WORD[ch.to]}. ${approve ? "Approved" : "Rejected"} by ${by}.`,
        link: "/registers",
      });
    }
    return HttpResponse.json({ decided: pending.length });
  }),
];
