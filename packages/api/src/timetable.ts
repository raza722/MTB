// Timetable API: bell schedules (period timings per campus, Friday short day), the weekly class timetable with
// clash rules, teacher timetables, and dated cover (substitutions) for teachers who are away.
// The clash rules and bell times are pure functions here, so the editor shows a clash the moment a teacher is
// picked and the server applies exactly the same rules when the cell is saved.
import type { IsoDate, IsoDateTime } from "@mtb/domain";
import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { ctxKey, ctxQuery, type CampusCode, type Ctx } from "./context";

/** ISO weekday: 1 = Monday … 6 = Saturday. Sunday is the weekly holiday. */
export type TimetableDay = 1 | 2 | 3 | 4 | 5 | 6;

export const TIMETABLE_DAYS: Array<{ day: TimetableDay; short: string; long: string }> = [
  { day: 1, short: "Mon", long: "Monday" },
  { day: 2, short: "Tue", long: "Tuesday" },
  { day: 3, short: "Wed", long: "Wednesday" },
  { day: 4, short: "Thu", long: "Thursday" },
  { day: 5, short: "Fri", long: "Friday" },
  { day: 6, short: "Sat", long: "Saturday" },
];

export const FRIDAY: TimetableDay = 5;

/* ------------------------------------------------------------------ Bell schedules */

export type TimetableSeason = "GENERAL" | "WINTER";

export const SEASON_LABEL: Record<TimetableSeason, string> = { GENERAL: "Normal timings", WINTER: "Winter timings" };

export interface BellDayRule {
  /** Minutes per period. */
  periodMins: number;
  periods: number;
  /** The break comes after this period. */
  breakAfter: number;
  breakMins: number;
}

export interface BellSchedule {
  id: string;
  campus: CampusCode;
  season: TimetableSeason;
  /** The campus is on this season's timings now. */
  active: boolean;
  /** "School day", "Senior classes" */
  name: string;
  /** The season's main timings: every section not put on other timings follows them. */
  main: boolean;
  /** "07:45" (24-hour) */
  assemblyStart: string;
  assemblyMins: number;
  /** Period 1 starts at this time instead of straight after assembly; null = straight after assembly. */
  firstLectureStart: string | null;
  /** Monday to Thursday and Saturday. */
  normal: BellDayRule;
  /** Friday: shorter periods, home before Jumu'ah. */
  friday: BellDayRule;
  /** Sections on these timings. For the main timings, every section not on other timings. */
  sections: string[];
  rowVer: number;
  updatedAt: IsoDateTime;
  updatedBy: string;
}

export interface BellPeriod {
  no: number;
  start: string;
  end: string;
}

export interface BellDay {
  assemblyStart: string;
  periods: BellPeriod[];
  breakStart: string | null;
  breakEnd: string | null;
  /** School closes. */
  offTime: string;
}

export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
};

export const fromMinutes = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

/** "13:10" → "01:10 PM" */
export function clockTime(hhmm: string): string {
  const mins = toMinutes(hhmm);
  const h = Math.floor(mins / 60);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** The periods of one day from the schedule's rule: assembly, periods, one break. */
export function bellDay(s: Pick<BellSchedule, "assemblyStart" | "assemblyMins"> & { firstLectureStart?: string | null }, rule: BellDayRule): BellDay {
  const afterAssembly = toMinutes(s.assemblyStart) + s.assemblyMins;
  let t = s.firstLectureStart && /^\d{2}:\d{2}$/.test(s.firstLectureStart) ? Math.max(afterAssembly, toMinutes(s.firstLectureStart)) : afterAssembly;
  const periods: BellPeriod[] = [];
  let breakStart: string | null = null;
  let breakEnd: string | null = null;
  for (let no = 1; no <= rule.periods; no++) {
    periods.push({ no, start: fromMinutes(t), end: fromMinutes(t + rule.periodMins) });
    t += rule.periodMins;
    if (no === rule.breakAfter && no < rule.periods && rule.breakMins > 0) {
      breakStart = fromMinutes(t);
      t += rule.breakMins;
      breakEnd = fromMinutes(t);
    }
  }
  return { assemblyStart: s.assemblyStart, periods, breakStart, breakEnd, offTime: fromMinutes(t) };
}

export const isFriday = (day: TimetableDay) => day === FRIDAY;

/* ------------------------------------------------------------------ Board */

export interface TimetableSubject {
  id: string;
  name: string;
  /** "Maths" — fits in a timetable cell. */
  short: string;
  nameUr: string;
}

export interface TimetableTeacher {
  id: string;
  name: string;
  /** From the staff record (HR). */
  gender: "F" | "M";
  subjectIds: string[];
  classTeacherOf: string | null;
  maxPerWeek: number;
  maxPerDay: number;
  partTime: boolean;
}

export interface TimetableRequirement {
  subjectId: string;
  /** The group (stream) that studies it, e.g. "Science (Biology)"; null when the whole class does. */
  stream: string | null;
  periodsPerWeek: number;
  /** The teacher allotted in Setup › Teachers, or null when nobody is allotted yet. */
  teacherId: string | null;
}

export interface TimetableSection {
  classSection: string;
  /** "lv-mid" */
  levelId: string;
  /** "Middle" */
  level: string;
  shift: "MORNING" | "EVENING";
  /** Groups (streams) taught apart in some periods, e.g. Science (Biology) and Science (Computer). Empty for one group. */
  streams: string[];
  /** The bell timings this section follows (a schedule id in the season in use). */
  scheduleId: string;
  room: string;
  classTeacherId: string | null;
  strength: number;
  requirements: TimetableRequirement[];
}

export interface TimetableSlot {
  id: string;
  classSection: string;
  /** The group taught in this period; null (or missing) when the whole class is. */
  stream?: string | null;
  day: TimetableDay;
  period: number;
  subjectId: string;
  teacherId: string | null;
  room: string;
  /** Kept on purpose despite a clash (combined class, legacy arrangement). */
  override?: { reason: string; by: string; at: IsoDateTime };
}

export interface TimetableBoard {
  campus: CampusCode;
  campusName: string;
  session: number;
  readOnly: boolean;
  /** The main timings in use (the season the campus is on now). */
  schedule: BellSchedule;
  /** Bell times of the main timings. */
  normal: BellDay;
  friday: BellDay;
  /** Every timing in use this season; each section follows one (section.scheduleId). */
  schedules: BellSchedule[];
  /** Bell times per schedule id. */
  days: Record<string, { normal: BellDay; friday: BellDay }>;
  subjects: TimetableSubject[];
  teachers: TimetableTeacher[];
  sections: TimetableSection[];
  rooms: string[];
  slots: TimetableSlot[];
  updatedAt: IsoDateTime;
  updatedBy: string;
}

export type TimetableClashKind = "CLASS_DOUBLE_BOOKED" | "TEACHER_DOUBLE_BOOKED" | "ROOM_DOUBLE_BOOKED" | "TEACHER_OVER_WEEK" | "TEACHER_OVER_DAY" | "SUBJECT_OVER" | "NOT_QUALIFIED" | "NO_TEACHER";

export interface TimetableClash {
  kind: TimetableClashKind;
  /** BLOCK clashes need a reason to keep; WARN ones are shown but don't stop saving. */
  severity: "BLOCK" | "WARN";
  slotIds: string[];
  message: string;
  /** Kept on purpose (override reason given). */
  kept?: string;
}

export const CLASH_LABEL: Record<TimetableClashKind, string> = {
  CLASS_DOUBLE_BOOKED: "Class has two lessons at once",
  TEACHER_DOUBLE_BOOKED: "Teacher double-booked",
  ROOM_DOUBLE_BOOKED: "Room double-booked",
  TEACHER_OVER_WEEK: "Over weekly maximum",
  TEACHER_OVER_DAY: "Over daily maximum",
  SUBJECT_OVER: "More periods than needed",
  NOT_QUALIFIED: "Teacher not set up for subject",
  NO_TEACHER: "No teacher",
};

type ClashInput = Pick<TimetableBoard, "slots" | "teachers" | "sections" | "subjects"> & Partial<Pick<TimetableBoard, "days">>;

const dayName = (d: TimetableDay) => TIMETABLE_DAYS.find((x) => x.day === d)?.long ?? "";

/** "Science (Biology)" → "Biology": fits in a timetable cell. */
export const streamShort = (stream: string) => /\(([^)]+)\)/.exec(stream)?.[1] ?? stream;

/** Key of one requirement (subject, and the group that studies it). */
export const reqKey = (subjectId: string, stream?: string | null) => (stream ? `${subjectId}|${stream}` : subjectId);

/** "9-A" or "9-A (Biology)" */
export const slotClassLabel = (s: Pick<TimetableSlot, "classSection" | "stream">) => (s.stream ? `${s.classSection} (${streamShort(s.stream)})` : s.classSection);

/** Clock span of a slot in minutes from midnight, from its section's bell timings; by period number when no times are known. */
function spanFinder(board: ClashInput) {
  const sched = new Map(board.sections.map((s) => [s.classSection, s.scheduleId]));
  return (s: TimetableSlot): [number, number] => {
    if (!board.days) return [s.period * 1000, s.period * 1000 + 1];
    const d = board.days[sched.get(s.classSection) ?? ""];
    const p = d ? (isFriday(s.day) ? d.friday : d.normal).periods.find((x) => x.no === s.period) : undefined;
    return p ? [toMinutes(p.start), toMinutes(p.end)] : [100_000 + s.period * 10, 100_000 + s.period * 10 + 1];
  };
}

/** Groups of slots whose clock times overlap (one list per group of two or more). */
function overlapping(list: TimetableSlot[], span: (s: TimetableSlot) => [number, number]): TimetableSlot[][] {
  const sorted = [...list].sort((a, b) => span(a)[0] - span(b)[0]);
  const out: TimetableSlot[][] = [];
  let cur: TimetableSlot[] = [];
  let end = -1;
  for (const s of sorted) {
    const [a, b] = span(s);
    if (cur.length && a < end) {
      cur.push(s);
      end = Math.max(end, b);
    } else {
      if (cur.length > 1) out.push(cur);
      cur = [s];
      end = b;
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/** "on Monday, period 3" or, across bell timings, "on Monday at 09:10 AM (…)". */
function whenText(list: TimetableSlot[], span: (s: TimetableSlot) => [number, number]) {
  const s0 = list[0]!;
  if (list.every((s) => s.period === s0.period)) return `on ${dayName(s0.day)}, period ${s0.period}`;
  const start = Math.max(...list.map((s) => span(s)[0]));
  return start < 100_000 ? `on ${dayName(s0.day)} at ${clockTime(fromMinutes(start))} (${list.map((s) => `${slotClassLabel(s)} period ${s.period}`).join(", ")})` : `on ${dayName(s0.day)}`;
}

/** Every clash on a board. Pure: the editor runs it on a draft, the server on the saved board. */
export function findTimetableClashes(board: ClashInput): TimetableClash[] {
  const out: TimetableClash[] = [];
  const teacher = new Map(board.teachers.map((t) => [t.id, t]));
  const subject = new Map(board.subjects.map((s) => [s.id, s]));
  const subj = (id: string) => subject.get(id)?.name ?? id;
  const span = spanFinder(board);

  const byCell = new Map<string, TimetableSlot[]>();
  const byTeacherDay = new Map<string, TimetableSlot[]>();
  const byRoomDay = new Map<string, TimetableSlot[]>();
  const byTeacherWeek = new Map<string, TimetableSlot[]>();
  const bySectionSubject = new Map<string, TimetableSlot[]>();
  const push = (m: Map<string, TimetableSlot[]>, k: string, s: TimetableSlot) => m.set(k, [...(m.get(k) ?? []), s]);

  for (const s of board.slots) {
    push(byCell, `${s.classSection}|${s.day}|${s.period}`, s);
    if (s.teacherId) {
      push(byTeacherDay, `${s.teacherId}|${s.day}`, s);
      push(byTeacherWeek, s.teacherId, s);
    }
    if (s.room) push(byRoomDay, `${s.room}|${s.day}`, s);
    push(bySectionSubject, `${s.classSection}|${reqKey(s.subjectId, s.stream)}`, s);
  }

  // One class, one period: a whole-class lesson takes every group; two lessons for the same group clash.
  for (const list of byCell.values()) {
    if (list.length < 2) continue;
    const whole = list.some((s) => !s.stream);
    const streams = list.map((s) => s.stream ?? "");
    if (!whole && new Set(streams).size === streams.length) continue;
    const s0 = list[0]!;
    out.push({
      kind: "CLASS_DOUBLE_BOOKED",
      severity: "BLOCK",
      slotIds: list.map((s) => s.id),
      message: `${s0.classSection} has ${list.map((s) => subj(s.subjectId)).join(" and ")} at the same time on ${dayName(s0.day)}, period ${s0.period}${whole ? "; a whole-class lesson takes every group" : ""}.`,
    });
  }

  // A teacher in two places at once: compared by clock time, so classes on different bell timings are checked too.
  for (const list of byTeacherDay.values()) {
    for (const group of overlapping(list, span)) {
      const kept = group.every((s) => s.override) ? group[0]!.override!.reason : undefined;
      out.push({
        kind: "TEACHER_DOUBLE_BOOKED",
        severity: kept ? "WARN" : "BLOCK",
        slotIds: group.map((s) => s.id),
        message: `${teacher.get(group[0]!.teacherId!)?.name ?? "A teacher"} is in ${group.map(slotClassLabel).join(" and ")} ${whenText(group, span)}.`,
        ...(kept ? { kept } : {}),
      });
    }
  }
  for (const list of byRoomDay.values()) {
    for (const group of overlapping(list, span)) {
      const s0 = group[0]!;
      // Two classes taught together by one teacher in one room is a combined class, reported once above.
      if (group.every((s) => s.teacherId && s.teacherId === s0.teacherId)) continue;
      const kept = group.every((s) => s.override) ? s0.override!.reason : undefined;
      out.push({
        kind: "ROOM_DOUBLE_BOOKED",
        severity: kept ? "WARN" : "BLOCK",
        slotIds: group.map((s) => s.id),
        message: `${s0.room} has ${group.map(slotClassLabel).join(" and ")} ${whenText(group, span)}.`,
        ...(kept ? { kept } : {}),
      });
    }
  }
  for (const [id, list] of byTeacherWeek) {
    const t = teacher.get(id);
    if (t && list.length > t.maxPerWeek) {
      out.push({ kind: "TEACHER_OVER_WEEK", severity: "WARN", slotIds: list.map((s) => s.id), message: `${t.name} has ${list.length} periods a week; the maximum is ${t.maxPerWeek}${t.partTime ? " (part-time)" : ""}.` });
    }
  }
  for (const list of byTeacherDay.values()) {
    const s0 = list[0]!;
    const t = teacher.get(s0.teacherId!);
    if (t && list.length > t.maxPerDay) {
      out.push({ kind: "TEACHER_OVER_DAY", severity: "WARN", slotIds: list.map((s) => s.id), message: `${t.name} has ${list.length} periods on ${dayName(s0.day)}; the most in one day is ${t.maxPerDay}.` });
    }
  }
  for (const list of bySectionSubject.values()) {
    const s0 = list[0]!;
    const need = board.sections.find((x) => x.classSection === s0.classSection)?.requirements.find((r) => r.subjectId === s0.subjectId && (r.stream ?? null) === (s0.stream ?? null))?.periodsPerWeek;
    if (need !== undefined && list.length > need) {
      out.push({ kind: "SUBJECT_OVER", severity: "WARN", slotIds: list.map((s) => s.id), message: `${slotClassLabel(s0)} has ${list.length} ${subj(s0.subjectId)} periods; the curriculum asks for ${need}.` });
    }
  }
  for (const s of board.slots) {
    if (!s.teacherId) {
      out.push({ kind: "NO_TEACHER", severity: "WARN", slotIds: [s.id], message: `${slotClassLabel(s)} ${subj(s.subjectId)} on ${dayName(s.day)}, period ${s.period} has no teacher.` });
      continue;
    }
    const t = teacher.get(s.teacherId);
    if (t && !t.subjectIds.includes(s.subjectId)) {
      out.push({ kind: "NOT_QUALIFIED", severity: "WARN", slotIds: [s.id], message: `${t.name} is not set up to teach ${subj(s.subjectId)} (${slotClassLabel(s)}, ${dayName(s.day)} period ${s.period}).` });
    }
  }
  return out;
}

/** Periods placed per requirement (subject, and group when taught apart) for one section; keyed by reqKey. */
export function placedBySubject(board: Pick<TimetableBoard, "slots">, classSection: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of board.slots) if (s.classSection === classSection) m.set(reqKey(s.subjectId, s.stream), (m.get(reqKey(s.subjectId, s.stream)) ?? 0) + 1);
  return m;
}

/** Periods in a school week for this schedule (Friday is shorter). */
export const periodsInWeek = (s: Pick<BellSchedule, "normal" | "friday">) => s.normal.periods * 5 + s.friday.periods;

/** Number of periods on a given weekday. */
export const periodsOn = (s: Pick<BellSchedule, "normal" | "friday">, day: TimetableDay) => (isFriday(day) ? s.friday.periods : s.normal.periods);

type ScheduleBoard = Pick<TimetableBoard, "schedule" | "schedules" | "sections" | "days" | "normal" | "friday">;

/** The bell timings a section follows (the main timings when it has none of its own). */
export function scheduleOf(board: Pick<TimetableBoard, "schedule" | "schedules" | "sections">, classSection: string): BellSchedule {
  const id = board.sections.find((s) => s.classSection === classSection)?.scheduleId;
  return board.schedules?.find((s) => s.id === id) ?? board.schedule;
}

/** A section's bell times on one day. */
export function dayPlanOf(board: ScheduleBoard, classSection: string, day: TimetableDay): BellDay {
  const d = board.days?.[scheduleOf(board, classSection).id];
  return d ? (isFriday(day) ? d.friday : d.normal) : isFriday(day) ? board.friday : board.normal;
}

/** Periods a section has on one weekday. */
export const sectionPeriodsOn = (board: ScheduleBoard, classSection: string, day: TimetableDay) => periodsOn(scheduleOf(board, classSection), day);

/** Start and end of a section's period. */
export const periodTime = (board: ScheduleBoard, classSection: string, day: TimetableDay, period: number): BellPeriod | undefined => dayPlanOf(board, classSection, day).periods.find((p) => p.no === period);

/** The most periods any timing in use has on one day. */
export const maxPeriodsOf = (board: Pick<TimetableBoard, "schedule" | "schedules">) => Math.max(...(board.schedules?.length ? board.schedules : [board.schedule]).flatMap((s) => [s.normal.periods, s.friday.periods]));

/* ------------------------------------------------------------------ Requests */

export interface TimetableSlotBody {
  campus: CampusCode;
  session: number;
  classSection: string;
  /** The group taught; null for the whole class (it takes every group). */
  stream: string | null;
  day: TimetableDay;
  period: number;
  /** null clears the cell. */
  subjectId: string | null;
  teacherId: string | null;
  room: string;
  /** Required to keep a BLOCK clash. */
  overrideReason?: string;
}

export interface TimetableSlotResult {
  slot: TimetableSlot | null;
  /** Clashes on the board after the save (the editor refreshes its list). */
  clashes: TimetableClash[];
}

/** 409 TIMETABLE_CLASH details. */
export interface TimetableClashDetails {
  clashes: TimetableClash[];
}

export interface BellScheduleBody {
  name: string;
  assemblyStart: string;
  assemblyMins: number;
  firstLectureStart: string | null;
  normal: BellDayRule;
  friday: BellDayRule;
  rowVer: number;
}

/** New timings for some sections: blank, or a copy of other timings. */
export interface NewBellScheduleBody {
  campus: CampusCode;
  session: number;
  season: TimetableSeason;
  name: string;
  /** Copy the times of these timings; null starts from the main timings. */
  copyFrom: string | null;
}

/** Sections that follow these timings. For the main timings, sections moved back from other timings. */
export interface BellSectionsBody {
  sections: string[];
  rowVer: number;
}

/** 409 PERIODS_IN_USE details: lessons sit in periods the new timings remove. */
export interface PeriodsInUseDetails {
  lessons: number;
  classes: string[];
}

export interface TeacherAway {
  teacherId: string;
  name: string;
  reason: string;
  /** "HR" when it came from staff leave; "Office" when marked here. */
  source: "HR" | "Office";
  markedBy: string;
  markedAt: IsoDateTime;
}

export interface TimetableCover {
  id: string;
  date: IsoDate;
  slotId: string;
  period: number;
  classSection: string;
  subjectId: string;
  absentTeacherId: string;
  substituteId: string;
  substituteName: string;
  note?: string;
  by: string;
  at: IsoDateTime;
}

export interface TimetableCoverDay {
  date: IsoDate;
  /** null on Sunday. */
  day: TimetableDay | null;
  /** No school (holiday, Sunday): no cover needed. */
  closed?: { name: string };
  away: TeacherAway[];
  covers: TimetableCover[];
}

export interface TeacherAwayBody {
  campus: CampusCode;
  session: number;
  date: IsoDate;
  teacherId: string;
  reason: string;
}

export interface CoverBody {
  campus: CampusCode;
  session: number;
  date: IsoDate;
  slotId: string;
  substituteId: string;
  note?: string;
}

export interface HandOverBody {
  campus: CampusCode;
  session: number;
  fromTeacherId: string;
  toTeacherId: string;
  slotIds: string[];
  reason: string;
  overrideReason?: string;
}

export interface HandOverResult {
  moved: number;
  clashes: TimetableClash[];
}

/* ------------------------------------------------------------------ Text teachers their day (legacy "SMS Staff Lectures") */

export interface TeacherDayLesson {
  period: number;
  /** "07:55" (24-hour) */
  start: string;
  classSection: string;
  /** Short subject name, as it fits in an SMS. */
  subject: string;
  room: string;
  /** Covering for a teacher who is away. */
  cover: boolean;
}

/** CHANGED: texted already, but the day changed since (cover added or removed), so it can be sent again. */
export type TeacherTextStatus = "NOT_SENT" | "QUEUED" | "SENT" | "CHANGED";

export interface TeacherDayText {
  teacherId: string;
  name: string;
  mobile: string;
  /** Why the teacher is away that day (their own periods are covered), or null. */
  away: string | null;
  lessons: TeacherDayLesson[];
  /** The SMS exactly as the teacher receives it. */
  message: string;
  sms: { status: TeacherTextStatus; at?: IsoDateTime; by?: string };
}

export interface TeacherDayTexts {
  date: IsoDate;
  /** null on Sunday. */
  day: TimetableDay | null;
  /** No school (holiday, Sunday): nothing to send. */
  closed?: { name: string };
  rows: TeacherDayText[];
}

export interface TeacherSmsBody {
  campus: CampusCode;
  session: number;
  date: IsoDate;
  teacherIds: string[];
}

export interface TeacherSmsResult {
  queued: number;
  /** Away, free all day, or already texted this same message for the day. */
  skipped: number;
}

/** SMS parts a message takes (160 letters for one, 153 a part when longer). */
export const smsParts = (text: string) => (text.length <= 160 ? 1 : Math.ceil(text.length / 153));

/* ------------------------------------------------------------------ Client */

export const timetableApi = {
  board: (ctx: Ctx) => apiFetch<TimetableBoard>("/timetable/board", { query: ctxQuery(ctx) }),
  saveSlot: (body: TimetableSlotBody) => apiFetch<TimetableSlotResult>("/timetable/slots", { method: "PUT", body }),
  schedules: (ctx: Ctx) => apiFetch<BellSchedule[]>("/timetable/schedules", { query: ctxQuery(ctx) }),
  saveSchedule: (id: string, body: BellScheduleBody) => apiFetch<BellSchedule>(`/timetable/schedules/${encodeURIComponent(id)}`, { method: "PUT", body }),
  activateSchedule: (id: string) => apiFetch<BellSchedule[]>(`/timetable/schedules/${encodeURIComponent(id)}/activate`, { method: "POST" }),
  /** New timings (blank or copied); returns every timing of the campus. */
  createSchedule: (body: NewBellScheduleBody) => apiFetch<BellSchedule[]>("/timetable/schedules", { method: "POST", body }),
  /** Put sections on these timings. 409 PERIODS_IN_USE when a section has lessons in periods the timings don't have. */
  assignSections: (id: string, body: BellSectionsBody) => apiFetch<BellSchedule[]>(`/timetable/schedules/${encodeURIComponent(id)}/sections`, { method: "PUT", body }),
  /** Remove timings that are not the main ones; their sections go back to the main timings. */
  deleteSchedule: (id: string) => apiFetch<BellSchedule[]>(`/timetable/schedules/${encodeURIComponent(id)}`, { method: "DELETE" }),
  cover: (ctx: Ctx, date: IsoDate) => apiFetch<TimetableCoverDay>("/timetable/cover", { query: { ...ctxQuery(ctx), date } }),
  markAway: (body: TeacherAwayBody) => apiFetch<TimetableCoverDay>("/timetable/cover/away", { method: "POST", body }),
  clearAway: (body: Omit<TeacherAwayBody, "reason">) => apiFetch<TimetableCoverDay>("/timetable/cover/away/clear", { method: "POST", body }),
  assignCover: (body: CoverBody, idempotencyKey: string) => apiFetch<TimetableCover>("/timetable/cover", { method: "POST", body, idempotencyKey }),
  removeCover: (id: string) => apiFetch<{ status: "ok" }>(`/timetable/cover/${encodeURIComponent(id)}`, { method: "DELETE" }),
  handOver: (body: HandOverBody) => apiFetch<HandOverResult>("/timetable/hand-over", { method: "POST", body }),
  /** Each teacher's periods on a date as the SMS they would receive, with what was already sent. */
  teacherTexts: (ctx: Ctx, date: IsoDate) => apiFetch<TeacherDayTexts>("/timetable/teacher-sms", { query: { ...ctxQuery(ctx), date } }),
  /** Text the chosen teachers their periods for the day. 423 SMS_PAUSED while all SMS are paused. */
  smsTeachers: (body: TeacherSmsBody, idempotencyKey: string) => apiFetch<TeacherSmsResult>("/timetable/teacher-sms", { method: "POST", body, idempotencyKey }),
};

export const timetableQueries = {
  board: (ctx: Ctx) => queryOptions({ queryKey: ["timetable", ...ctxKey(ctx), "board"], queryFn: () => timetableApi.board(ctx) }),
  schedules: (ctx: Ctx) => queryOptions({ queryKey: ["timetable", ...ctxKey(ctx), "schedules"], queryFn: () => timetableApi.schedules(ctx) }),
  cover: (ctx: Ctx, date: IsoDate) => queryOptions({ queryKey: ["timetable", ...ctxKey(ctx), "cover", date], queryFn: () => timetableApi.cover(ctx, date) }),
  teacherTexts: (ctx: Ctx, date: IsoDate) => queryOptions({ queryKey: ["timetable", ...ctxKey(ctx), "teacher-sms", date], queryFn: () => timetableApi.teacherTexts(ctx, date) }),
};
