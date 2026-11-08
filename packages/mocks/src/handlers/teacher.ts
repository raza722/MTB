// Teacher app: today's classes, timetable, classes and notifications.
// The registers (/api/teacher/registers*) and the papers and marks (/api/teacher/papers*) are real now: they fall
// through to the backend (Attendance, backend/docs/modules/04_attendance.md; Exams, backend/docs/modules/05_exams.md).
// Today's register cards and papers, the periods' register badges and the classes' attendance figures below stay
// fictional (fixture rosters, the fictional exams of handlers/exams-model.ts, the demo's fixed date) until module 8
// reads the real attendance and exam views, so the Today card and the Registers / Marks tabs can disagree meanwhile.
// Timetables, rosters and the school calendar come from the timetable mock and handlers/attendance-model.ts.
import {
  bellDay,
  teacherCountMarks,
  type CampusCode,
  type RegisterCode,
  type SessionUser,
  type TeacherChangeRequest,
  type TeacherClass,
  type TeacherClassDetail,
  type TeacherClassRole,
  type TeacherClosedDay,
  type TeacherCounts,
  type TeacherDemoState,
  type TeacherNotification,
  type TeacherPaper,
  type TeacherPeriod,
  type TeacherRegisterCard,
  type TeacherRegisterStatus,
  type TeacherStudentContact,
  type TeacherToday,
  type TeacherWeek,
  type TeacherWeekDay,
} from "@mtb/api";
import { formatDate, formatTime, summariseAttendance, type AttendanceCode, type IsoDate } from "@mtb/domain";
import { http, type HttpHandler } from "msw";
import { CURRENT_SESSION, DEMO_TODAY } from "../clock";
import { createStore } from "../db";
import { addDays, pastMark, registersFor, rosterFor, SESSION_DATES, weekdayOf, type RosterEntry } from "../fixtures/attendance";
import { campusName } from "../fixtures/campuses";
import type { ExamRecord } from "../fixtures/exams";
import { seedTeacherChanges, seedTeacherNotifications, TEACHER_DEMO_HOLIDAY } from "../fixtures/teacher";
import { scheduleSeed } from "../fixtures/timetable";
import { ctxFrom, fail, HttpResponse, latency, requirePermission, requireUser } from "../util";
import { attendanceDayFor, closedOn } from "./attendance-model";
import { examPapersForTeacher, examsStore } from "./exams-model";
import { teacherDay } from "./timetable";

/* ------------------------------------------------------------------ State */

interface TeacherState {
  /** The fictional change requests today's cards count (the real ones are the backend's). */
  changes: TeacherChangeRequest[];
  /** Notifications per teacher name (seeded on first read). */
  notifications: Record<string, TeacherNotification[]>;
  demo: TeacherDemoState;
  seq: number;
}

/** Today's (fictional) registers start Not marked: submitting happens in the real backend, which this mock never sees. */
const store = createStore<TeacherState>("teacher", () => ({
  changes: seedTeacherChanges(),
  notifications: {},
  demo: { holiday: false },
  seq: 100,
}));


/* ------------------------------------------------------------------ Request helpers */

type Ok = { user: SessionUser; campus: CampusCode; session: number };

function context(request: Request): Ok | Response {
  const ctx = ctxFrom(new URL(request.url));
  if (ctx.campus === "ALL") return fail(400, "CAMPUS_REQUIRED", "Choose your campus first.");
  const user = requirePermission("teacher.app", ctx.campus);
  if (user instanceof Response) return user;
  return { user, campus: ctx.campus, session: ctx.session };
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

/** A student's (fictional) mark on a date: none yet today, earlier days from the attendance fixtures. */
function markOf(campus: CampusCode, cs: string, e: RosterEntry, date: IsoDate): RegisterCode | null {
  if (date === DEMO_TODAY) return null;
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
  if (date === DEMO_TODAY) return "NOT_MARKED";
  return pendingOn(campus, cs, date).length ? "CHANGE_PENDING" : "SUBMITTED";
}

function countsOn(campus: CampusCode, cs: string, date: IsoDate): TeacherCounts | null {
  const marks = rosterFor(campus, cs).map((e) => markOf(campus, cs, e, date));
  if (marks.some((m) => m === null)) return null;
  return teacherCountMarks(marks as RegisterCode[]);
}

function card(campus: CampusCode, cs: string, date: IsoDate): TeacherRegisterCard {
  const closed = closedDay(campus, date);
  return {
    ...(closed ? { closed } : {}),
    classSection: cs,
    date,
    status: statusOn(campus, cs, date),
    enrolled: rosterFor(campus, cs).length,
    counts: countsOn(campus, cs, date),
    pendingChanges: pendingOn(campus, cs, date).length,
  };
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

/* ------------------------------------------------------------------ Papers (Today only) */

// The Papers tab and marks entry are real (/api/teacher/papers*). Today's "papers" list stays fictional until module 8
// assembles Today from exam.vw_TeacherPaper: its exam ids are the fictional store's, so tapping one opens a paper the
// backend does not know ("This exam no longer exists").

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
      schoolDays: sessionSchoolDays(c.campus).length,
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
      },
    }));
    return HttpResponse.json(store.get().demo);
  }),
];
