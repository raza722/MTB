import {
  bellDay,
  clockTime,
  findTimetableClashes,
  periodsOn,
  periodTime,
  sectionPeriodsOn,
  slotClassLabel,
  streamShort,
  TIMETABLE_DAYS,
  toMinutes,
  type BellSchedule,
  type BellScheduleBody,
  type BellSectionsBody,
  type NewBellScheduleBody,
  type CampusCode,
  type CoverBody,
  type HandOverBody,
  type HandOverResult,
  type TeacherAway,
  type TeacherAwayBody,
  type TeacherDayLesson,
  type TeacherDayText,
  type TeacherDayTexts,
  type TeacherSmsBody,
  type TeacherSmsResult,
  type TimetableBoard,
  type TimetableClash,
  type TimetableCover,
  type TimetableCoverDay,
  type TimetableDay,
  type TimetableSlot,
  type TimetableSlotBody,
  type TimetableSlotResult,
} from "@mtb/api";
import { formatDate, type IsoDate, type IsoDateTime } from "@mtb/domain";
import { http, type HttpHandler } from "msw";
import { CURRENT_SESSION, DEMO_TODAY, demoNow } from "../clock";
import { createStore } from "../db";
import { hash32, SESSION_DATES, weekdayOf } from "../fixtures/attendance";
import { campusName } from "../fixtures/campuses";
import { initialStaff } from "../fixtures/hr";
import { teacherId } from "../fixtures/setup";
import { campusFixtures, campusRooms, daysOf, generateSlots, inUse, scheduleSeed, seedLegacyClashes, spanFinder, timetableSubjects, withSchedules } from "../fixtures/timetable";
import { ctxFrom, fail, HttpResponse, latency, requirePermission } from "../util";
import { closedOn } from "./attendance";
import { smsStatusStore } from "./sms";

/** The current session's last day: teacher texts and cover can't go past it. */
const SESSION_LAST_DAY: IsoDate = SESSION_DATES[CURRENT_SESSION]!.ends;

// Bell schedules, the weekly class timetable (clash rules enforced on save), and dated cover for absent teachers.

/* ------------------------------------------------------------------ State */

interface StoredBoard {
  slots: TimetableSlot[];
  updatedAt: IsoDateTime;
  updatedBy: string;
}

type StoredAway = TeacherAway & { campus: CampusCode; date: IsoDate };
type StoredCover = TimetableCover & { campus: CampusCode };

/** One "your periods today" SMS to a teacher (the legacy SMS Staff Lectures screen, rebuilt). */
interface StoredText {
  campus: CampusCode;
  date: IsoDate;
  teacherId: string;
  message: string;
  at: IsoDateTime;
  by: string;
  /** Date.now() when queued: shown as sent a few seconds later. */
  queuedAt: number;
}

interface TimetableState {
  schedules: BellSchedule[];
  boards: Partial<Record<CampusCode, StoredBoard>>;
  away: StoredAway[];
  covers: StoredCover[];
  /** Optional: a demo started before this log existed keeps working. */
  texts?: StoredText[];
  seq: number;
  idem: Record<string, unknown>;
}

const CAMPUS_CODES: CampusCode[] = ["KC", "SM", "UC", "MC", "HC"];

function initialState(): TimetableState {
  const schedules = scheduleSeed();
  const boards: Partial<Record<CampusCode, StoredBoard>> = {};
  for (const c of CAMPUS_CODES) {
    const list = inUse(schedules, c);
    const sections = withSchedules(campusFixtures(c, CURRENT_SESSION).sections, list);
    const slots = generateSlots(c, sections, list);
    if (c === "KC") seedLegacyClashes(slots, spanFinder(sections, list));
    boards[c] = { slots, updatedAt: "2026-04-03T15:40:00+05:00", updatedBy: "Kamran Yousaf" };
  }
  // Mr Imran Shafiq (class teacher of Prep-B) is on leave today; his first period is already covered.
  const imran = teacherId("KC", "Mr Imran Shafiq");
  const away: StoredAway[] = [{ campus: "KC", date: DEMO_TODAY, teacherId: imran, name: "Mr Imran Shafiq", reason: "Casual leave", source: "HR", markedBy: "Staff leave (HR)", markedAt: "2026-11-04T07:20:00+05:00" }];
  const covers: StoredCover[] = [];
  const kc = boards.KC!.slots;
  const today = weekdayOf(DEMO_TODAY) as TimetableDay;
  const first = kc.filter((s) => s.teacherId === imran && s.day === today).sort((a, b) => a.period - b.period)[0];
  if (first) {
    const { teachers } = campusFixtures("KC", CURRENT_SESSION);
    const free = teachers.find((t) => t.id !== imran && t.subjectIds.includes(first.subjectId) && !kc.some((s) => s.teacherId === t.id && s.day === today && s.period === first.period)) ?? teachers.find((t) => t.id !== imran && !kc.some((s) => s.teacherId === t.id && s.day === today && s.period === first.period));
    if (free) {
      covers.push({ id: "cov-1", campus: "KC", date: DEMO_TODAY, slotId: first.id, period: first.period, classSection: first.classSection, subjectId: first.subjectId, absentTeacherId: imran, substituteId: free.id, substituteName: free.name, by: "Farah Naz", at: "2026-11-04T07:52:00+05:00" });
    }
  }
  return { schedules, boards, away, covers, texts: [], seq: 10, idem: {} };
}

// v2: timings per section and lessons per group. v3: the evening shift (ADP batch at Khalid Campus) with its own timings.
// Older demo data in this tab is set aside.
const store = createStore<TimetableState>("timetable.v3", initialState);

/** Every section label at a campus this session. */
const labelsOf = (campus: CampusCode) => campusFixtures(campus, CURRENT_SESSION).sections.map((s) => s.classSection);

/** Timings with the main ones' section list filled in: every section not on other timings of the same season. */
function schedulesOf(campus: CampusCode, schedules = store.get().schedules): BellSchedule[] {
  const mine = schedules.filter((s) => s.campus === campus);
  const labels = labelsOf(campus);
  return mine
    .map((s) => (s.main ? { ...s, sections: labels.filter((l) => !mine.some((o) => !o.main && o.season === s.season && o.sections.includes(l))) } : { ...s, sections: s.sections.filter((l) => labels.includes(l)) }))
    .sort((a, b) => a.season.localeCompare(b.season) || Number(b.main) - Number(a.main) || a.name.localeCompare(b.name));
}

/** The timings in use at a campus (the season it is on), main timings first, with their sections. Setup › Campuses reads its school day from here. */
export const timingsInUse = (campus: CampusCode): BellSchedule[] => inUse(schedulesOf(campus), campus);

/* ------------------------------------------------------------------ Board */

const pastBoards = new Map<CampusCode, TimetableSlot[]>();

function boardFor(campus: CampusCode, session: number): TimetableBoard {
  const st = store.get();
  const fx = campusFixtures(campus, session);
  const list = inUse(schedulesOf(campus), campus);
  const schedule = list.find((s) => s.main) ?? list[0]!;
  const sections = withSchedules(fx.sections, list);
  const { teachers } = fx;
  let slots: TimetableSlot[];
  let updatedAt = "2025-04-02T14:00:00+05:00";
  let updatedBy = "Kamran Yousaf";
  if (session === CURRENT_SESSION) {
    const b = st.boards[campus]!;
    slots = b.slots;
    updatedAt = b.updatedAt;
    updatedBy = b.updatedBy;
  } else {
    slots = pastBoards.get(campus) ?? generateSlots(campus, sections, list, 1);
    pastBoards.set(campus, slots);
  }
  return {
    campus,
    campusName: campusName(campus),
    session,
    readOnly: session !== CURRENT_SESSION,
    schedule,
    normal: bellDay(schedule, schedule.normal),
    friday: bellDay(schedule, schedule.friday),
    schedules: list,
    days: daysOf(list),
    subjects: timetableSubjects(),
    teachers,
    sections,
    rooms: campusRooms(sections),
    slots,
    updatedAt,
    updatedBy,
  };
}

function saveBoard(campus: CampusCode, slots: TimetableSlot[], by: string) {
  store.set((s) => ({ ...s, boards: { ...s.boards, [campus]: { slots, updatedAt: demoNow(), updatedBy: by } } }));
}

/* ------------------------------------------------------------------ Helpers */

const fromMins = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
const isIso = (v: unknown): v is IsoDate => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const dayLong = (d: TimetableDay) => TIMETABLE_DAYS.find((x) => x.day === d)?.long ?? "";

function readOnlyError(session: number) {
  return session !== CURRENT_SESSION ? fail(409, "SESSION_READ_ONLY", "Past sessions are read-only. Switch to the current session to change the timetable.") : null;
}

const blocking = (clashes: TimetableClash[], ids: string[]) => clashes.filter((c) => c.severity === "BLOCK" && c.slotIds.some((id) => ids.includes(id)));

function coverDay(campus: CampusCode, date: IsoDate): TimetableCoverDay {
  const st = store.get();
  const wd = weekdayOf(date);
  const closed = closedOn(campus, date);
  return {
    date,
    day: wd === 0 ? null : (wd as TimetableDay),
    ...(closed ? { closed: { name: closed.name } } : {}),
    away: st.away.filter((a) => a.campus === campus && a.date === date).map(({ campus: _c, date: _d, ...a }) => a),
    covers: st.covers.filter((c) => c.campus === campus && c.date === date).map(({ campus: _c, ...c }) => c),
  };
}

function checkRule(rule: { periodMins: number; periods: number; breakAfter: number; breakMins: number }, label: string, field: string, maxPeriods: number) {
  if (!Number.isInteger(rule.periodMins) || rule.periodMins < 25 || rule.periodMins > 60) return fail(422, "VALIDATION", `${label}: a period must be 25 to 60 minutes long.`, { field: `${field}.periodMins` });
  if (!Number.isInteger(rule.periods) || rule.periods < 3 || rule.periods > maxPeriods) return fail(422, "VALIDATION", `${label}: choose 3 to ${maxPeriods} periods.`, { field: `${field}.periods` });
  if (!Number.isInteger(rule.breakAfter) || rule.breakAfter < 1 || rule.breakAfter >= rule.periods) return fail(422, "VALIDATION", `${label}: the break must come after a period from 1 to ${rule.periods - 1}.`, { field: `${field}.breakAfter` });
  if (!Number.isInteger(rule.breakMins) || rule.breakMins < 0 || rule.breakMins > 60) return fail(422, "VALIDATION", `${label}: the break can be up to 60 minutes.`, { field: `${field}.breakMins` });
  return null;
}

/** Lessons that would fall outside the periods of the timings their section would follow. */
function periodsInUse(campus: CampusCode, timingOf: (classSection: string) => Pick<BellSchedule, "normal" | "friday"> | null) {
  const slots = store.get().boards[campus]?.slots ?? [];
  const lost = slots.filter((x) => {
    const t = timingOf(x.classSection);
    return t ? x.period > periodsOn(t, x.day) : false;
  });
  return lost.length ? fail(409, "PERIODS_IN_USE", `${lost.length} ${lost.length === 1 ? "lesson is" : "lessons are"} in periods these timings remove (${[...new Set(lost.map((x) => x.classSection))].slice(0, 6).join(", ")}). Move or clear them in the class timetable first.`, { details: { lessons: lost.length, classes: [...new Set(lost.map((x) => x.classSection))] } }) : null;
}

/* ------------------------------------------------------------------ Text teachers their day */

let staffMobiles: Map<string, string> | null = null;

/** A teacher's mobile from their HR profile (same person, same number); a fictional one if HR has none. */
function mobileOf(campus: CampusCode, name: string): string {
  if (!staffMobiles) {
    staffMobiles = new Map();
    for (const s of initialStaff()) for (const p of s.postings) if (!staffMobiles.has(`${p.campus}|${s.name}`)) staffMobiles.set(`${p.campus}|${s.name}`, s.mobile);
  }
  const hit = staffMobiles.get(`${campus}|${name}`);
  if (hit) return hit;
  const h = hash32(`${campus}|${name}`);
  return `03${["00", "01", "21", "33", "45"][h % 5]}555${String(1000 + (h % 9000))}`;
}

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "08:00" → "8:00", "13:10" → "1:10": a school day's period times, short enough for one SMS line. */
const shortTime = (hhmm: string) => {
  const mins = toMinutes(hhmm);
  const h = Math.floor(mins / 60) % 12 || 12;
  return `${h}:${String(mins % 60).padStart(2, "0")}`;
};

function textMessage(campus: CampusCode, name: string, date: IsoDate, lessons: TeacherDayLesson[], plan: { assemblyStart: string; offTime: string }): string {
  const day = `${DAY_SHORT[weekdayOf(date)]} ${formatDate(date)}`;
  const list = lessons.map((l) => `P${l.period} ${shortTime(l.start)} ${l.classSection} ${l.subject.replace(/\.$/, "")}${l.cover ? " (cover)" : ""}`).join("; ");
  const covers = lessons.filter((l) => l.cover).length;
  return `MTB ${campusName(campus)}: ${name}, your periods on ${day}: ${list}.${covers ? ` Includes ${covers} cover ${covers === 1 ? "period" : "periods"}.` : ""} Assembly ${clockTime(plan.assemblyStart)}, school closes ${clockTime(plan.offTime)}.`;
}

/** Every teacher's periods on a date (own lessons, plus cover; none when away) as the SMS they would get. */
function textsFor(campus: CampusCode, date: IsoDate): TeacherDayTexts {
  const wd = weekdayOf(date);
  const closed = closedOn(campus, date);
  if (closed) return { date, day: wd === 0 ? null : (wd as TimetableDay), closed: { name: closed.name }, rows: [] };
  const day = wd as TimetableDay;
  const board = boardFor(campus, CURRENT_SESSION);
  const st = store.get();
  const plan = day === 5 ? board.friday : board.normal;
  const startOf = (cs: string, p: number) => periodTime(board, cs, day, p)?.start ?? "";
  const subject = (id: string) => board.subjects.find((s) => s.id === id)?.short ?? id;
  const log = (st.texts ?? []).filter((x) => x.campus === campus && x.date === date);
  const rows: TeacherDayText[] = board.teachers.map((t) => {
    const away = st.away.find((a) => a.campus === campus && a.date === date && a.teacherId === t.id);
    const own: TeacherDayLesson[] = away ? [] : board.slots.filter((s) => s.teacherId === t.id && s.day === day).map((s) => ({ period: s.period, start: startOf(s.classSection, s.period), classSection: s.stream ? `${s.classSection} ${streamShort(s.stream)}` : s.classSection, subject: subject(s.subjectId), room: s.room, cover: false }));
    const covering: TeacherDayLesson[] = st.covers
      .filter((c) => c.campus === campus && c.date === date && c.substituteId === t.id)
      .map((c) => ({ period: c.period, start: startOf(c.classSection, c.period), classSection: c.classSection, subject: subject(c.subjectId), room: board.slots.find((s) => s.id === c.slotId)?.room ?? "", cover: true }));
    const lessons = [...own, ...covering].sort((a, b) => a.start.localeCompare(b.start) || a.period - b.period);
    const message = lessons.length ? textMessage(campus, t.name, date, lessons, plan) : "";
    const last = log.filter((x) => x.teacherId === t.id).at(-1);
    const sms: TeacherDayText["sms"] = !last
      ? { status: "NOT_SENT" }
      : last.message !== message && lessons.length > 0
        ? { status: "CHANGED", at: last.at, by: last.by }
        : { status: Date.now() - last.queuedAt > 4000 ? "SENT" : "QUEUED", at: last.at, by: last.by };
    return { teacherId: t.id, name: t.name, mobile: mobileOf(campus, t.name), away: away?.reason ?? null, lessons, message, sms };
  });
  return { date, day, rows };
}

/** A campus's timetable board for the report centre (class timetable and teacher load reports read the same data). */
export const timetableReportBoard = (campus: CampusCode, session: number): TimetableBoard => boardFor(campus, session);

/* ------------------------------------------------------------------ For the teacher app */

/** One teacher's periods on a date (own lessons plus cover), for the teacher app's "Today's classes". */
export function teacherDay(campus: CampusCode, teacherName: string, date: IsoDate): Array<{ period: number; start: string; end: string; classSection: string; stream?: string; subject: string; room: string; cover: boolean }> {
  if (closedOn(campus, date)) return [];
  const wd = weekdayOf(date) as TimetableDay;
  const board = boardFor(campus, CURRENT_SESSION);
  const t = board.teachers.find((x) => x.name === teacherName);
  if (!t) return [];
  // Each class's own bell: seniors run on their timings.
  const at = (cs: string, p: number) => periodTime(board, cs, wd, p);
  const subject = (id: string) => board.subjects.find((s) => s.id === id)?.name ?? id;
  const st = store.get();
  const away = st.away.some((a) => a.campus === campus && a.date === date && a.teacherId === t.id);
  const own = away
    ? []
    : board.slots
        .filter((s) => s.teacherId === t.id && s.day === wd)
        .map((s) => ({ period: s.period, start: at(s.classSection, s.period)?.start ?? "", end: at(s.classSection, s.period)?.end ?? "", classSection: s.classSection, ...(s.stream ? { stream: s.stream } : {}), subject: subject(s.subjectId), room: s.room, cover: false }));
  const covers = st.covers
    .filter((c) => c.campus === campus && c.date === date && c.substituteId === t.id)
    .map((c) => ({ period: c.period, start: at(c.classSection, c.period)?.start ?? "", end: at(c.classSection, c.period)?.end ?? "", classSection: c.classSection, subject: subject(c.subjectId), room: board.slots.find((s) => s.id === c.slotId)?.room ?? "", cover: true }));
  return [...own, ...covers].sort((a, b) => a.start.localeCompare(b.start) || a.period - b.period);
}

/** Do two lessons (by section and period) overlap in clock time on one day? */
function sameTime(board: TimetableBoard, day: TimetableDay, a: { classSection: string; period: number }, b: { classSection: string; period: number }) {
  const x = periodTime(board, a.classSection, day, a.period);
  const y = periodTime(board, b.classSection, day, b.period);
  if (!x || !y) return a.period === b.period;
  return toMinutes(x.start) < toMinutes(y.end) && toMinutes(y.start) < toMinutes(x.end);
}

/* ------------------------------------------------------------------ Handlers */

export const timetableHandlers: HttpHandler[] = [
  http.get("/api/timetable/board", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("timetable.view", ctx.campus);
    if (user instanceof Response) return user;
    if (ctx.campus === "ALL") return fail(400, "CAMPUS_REQUIRED", "Each campus has its own timetable. Choose a campus.");
    return HttpResponse.json(boardFor(ctx.campus, ctx.session));
  }),

  http.put("/api/timetable/slots", async ({ request }) => {
    await latency();
    const body = (await request.json()) as TimetableSlotBody;
    const user = requirePermission("timetable.manage", body.campus);
    if (user instanceof Response) return user;
    const ro = readOnlyError(body.session);
    if (ro) return ro;
    const board = boardFor(body.campus, CURRENT_SESSION);
    const section = board.sections.find((s) => s.classSection === body.classSection);
    if (!section) return fail(404, "NOT_FOUND", `There is no class ${body.classSection} at ${board.campusName}.`);
    if (!TIMETABLE_DAYS.some((d) => d.day === body.day)) return fail(422, "VALIDATION", "Choose a day from Monday to Saturday.", { field: "day" });
    const n = sectionPeriodsOn(board, body.classSection, body.day);
    if (body.period < 1 || body.period > n) return fail(422, "VALIDATION", `${body.classSection} has ${n} periods on ${dayLong(body.day)}. Choose one of them.`, { field: "period" });
    const stream = body.stream ?? null;
    if (stream && !section.streams.includes(stream)) return fail(422, "VALIDATION", `${body.classSection} has no ${stream} group. Choose the whole class or one of its groups.`, { field: "stream" });
    // A slot is one class, day, period and group; a whole-class lesson (no group) takes every group.
    const inCell = board.slots.filter((s) => s.classSection === body.classSection && s.day === body.day && s.period === body.period);
    const old = inCell.find((s) => (s.stream ?? null) === stream);
    const others = board.slots.filter((s) => s !== old);
    if (body.subjectId === null) {
      saveBoard(body.campus, others, user.name);
      store.set((s) => ({ ...s, covers: old ? s.covers.filter((c) => c.slotId !== old.id) : s.covers }));
      const result: TimetableSlotResult = { slot: null, clashes: findTimetableClashes({ ...board, slots: others }) };
      return HttpResponse.json(result);
    }
    const subject = board.subjects.find((s) => s.id === body.subjectId);
    const subjectName = (id: string) => board.subjects.find((x) => x.id === id)?.name ?? id;
    const req = section.requirements.find((r) => r.subjectId === body.subjectId && (r.stream ?? null) === stream);
    if (!subject || !req) {
      const groupReq = section.requirements.find((r) => r.subjectId === body.subjectId);
      if (subject && groupReq) return fail(422, "VALIDATION", groupReq.stream ? `${subject.name} is a ${groupReq.stream} subject in ${body.classSection}. Choose that group.` : `${subject.name} is taught to the whole class in ${body.classSection}. Choose Whole class.`, { field: "stream" });
      return fail(422, "VALIDATION", `${subject?.name ?? "This subject"} is not taught in ${body.classSection}. Add it to the class in Setup › Subjects first.`, { field: "subjectId" });
    }
    const otherGroups = inCell.filter((s) => s !== old);
    if (!stream && otherGroups.length) return fail(409, "CELL_SPLIT", `This period is split between groups (${otherGroups.map((s) => `${streamShort(s.stream ?? "")}: ${subjectName(s.subjectId)}`).join(", ")}). Clear the group lessons first, or choose a group.`, { field: "stream" });
    const whole = otherGroups.find((s) => !s.stream);
    if (stream && whole) return fail(409, "CELL_WHOLE_CLASS", `The whole class has ${subjectName(whole.subjectId)} in this period. Clear it first to split the period between groups.`, { field: "stream" });
    if (!body.teacherId) return fail(422, "VALIDATION", "Choose the teacher for this period.", { field: "teacherId" });
    const teacher = board.teachers.find((t) => t.id === body.teacherId);
    if (!teacher) return fail(422, "VALIDATION", "This teacher is not on this campus's staff.", { field: "teacherId" });
    if (!board.rooms.includes(body.room)) return fail(422, "VALIDATION", "Choose a room from the list.", { field: "room" });
    const seq = store.get().seq + 1;
    const reason = body.overrideReason?.trim();
    const slot: TimetableSlot = { id: `s-${body.classSection}-${body.day}-${body.period}${stream ? `-g${section.streams.indexOf(stream) + 1}` : ""}-${seq}`, classSection: body.classSection, stream, day: body.day, period: body.period, subjectId: body.subjectId, teacherId: body.teacherId, room: body.room };
    const draft = [...others, slot];
    const blockers = blocking(findTimetableClashes({ ...board, slots: draft }), [slot.id]);
    if (blockers.length && !reason) return fail(409, "TIMETABLE_CLASH", `${blockers[0]!.message} Choose another teacher or room, or give a reason to keep both.`, { details: { clashes: blockers } });
    if (blockers.length && reason && reason.length < 5) return fail(422, "VALIDATION", "Write a short reason (at least 5 letters) for keeping the clash.", { field: "overrideReason" });
    const override = reason ? { reason, by: user.name, at: demoNow() } : undefined;
    const ids = new Set(blockers.flatMap((c) => c.slotIds));
    const saved = draft.map((s) => (override && ids.has(s.id) ? { ...s, override } : s));
    saveBoard(body.campus, saved, user.name);
    store.set((s) => ({ ...s, seq, covers: old ? s.covers.filter((c) => c.slotId !== old.id) : s.covers }));
    const result: TimetableSlotResult = { slot: saved.find((s) => s.id === slot.id) ?? slot, clashes: findTimetableClashes({ ...board, slots: saved }) };
    return HttpResponse.json(result);
  }),

  http.get("/api/timetable/schedules", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("timetable.view", ctx.campus);
    if (user instanceof Response) return user;
    if (ctx.campus === "ALL") return fail(400, "CAMPUS_REQUIRED", "Each campus has its own timings. Choose a campus.");
    return HttpResponse.json(schedulesOf(ctx.campus));
  }),

  http.post("/api/timetable/schedules", async ({ request }) => {
    await latency();
    const body = (await request.json()) as NewBellScheduleBody;
    const user = requirePermission("timetable.manage", body.campus);
    if (user instanceof Response) return user;
    const ro = readOnlyError(body.session);
    if (ro) return ro;
    if (body.season !== "GENERAL" && body.season !== "WINTER") return fail(422, "VALIDATION", "Choose normal or winter timings.", { field: "season" });
    const name = body.name?.trim() ?? "";
    if (name.length < 3) return fail(422, "VALIDATION", "Give the timings a name, for example “Evening shift”.", { field: "name" });
    const mine = store.get().schedules.filter((s) => s.campus === body.campus);
    if (mine.some((s) => s.season === body.season && s.name.toLowerCase() === name.toLowerCase())) return fail(422, "VALIDATION", `There are already timings called “${name}”. Choose another name.`, { field: "name" });
    if (mine.filter((s) => s.season === body.season).length >= 8) return fail(422, "VALIDATION", "A campus can keep up to 8 timings a season.", { field: "name" });
    const from = (body.copyFrom ? mine.find((s) => s.id === body.copyFrom) : null) ?? mine.find((s) => s.season === body.season && s.main);
    if (!from) return fail(404, "NOT_FOUND", "The timings to copy no longer exist. Reload the page.");
    const seq = store.get().seq + 1;
    const created: BellSchedule = {
      ...from,
      id: `bell-${body.campus.toLowerCase()}-${body.season.toLowerCase()}-${seq}`,
      season: body.season,
      active: mine.some((s) => s.season === body.season && s.active),
      name,
      main: false,
      sections: [],
      rowVer: 1,
      updatedAt: demoNow(),
      updatedBy: user.name,
    };
    store.set((s) => ({ ...s, seq, schedules: [...s.schedules, created] }));
    return HttpResponse.json(schedulesOf(body.campus), { status: 201 });
  }),

  http.put("/api/timetable/schedules/:id", async ({ params, request }) => {
    await latency();
    const body = (await request.json()) as BellScheduleBody;
    const existing = store.get().schedules.find((s) => s.id === String(params.id));
    if (!existing) return fail(404, "NOT_FOUND", "These timings no longer exist. Reload the page.");
    const user = requirePermission("timetable.manage", existing.campus);
    if (user instanceof Response) return user;
    if (body.rowVer !== existing.rowVer) return fail(409, "CONCURRENCY", `${existing.updatedBy} changed these timings at ${clockTime(existing.updatedAt.slice(11, 16))}. Reload to see their version, then make your change again.`, { details: { by: existing.updatedBy, at: existing.updatedAt } });
    const name = (body.name ?? existing.name).trim();
    if (name.length < 3) return fail(422, "VALIDATION", "Give the timings a name of at least 3 letters.", { field: "name" });
    if (store.get().schedules.some((s) => s.id !== existing.id && s.campus === existing.campus && s.season === existing.season && s.name.toLowerCase() === name.toLowerCase())) return fail(422, "VALIDATION", `There are already timings called “${name}”.`, { field: "name" });
    if (!/^\d{2}:\d{2}$/.test(body.assemblyStart) || toMinutes(body.assemblyStart) < 6 * 60 || toMinutes(body.assemblyStart) > 14 * 60) return fail(422, "VALIDATION", "Assembly must start between 06:00 AM and 02:00 PM.", { field: "assemblyStart" });
    if (!Number.isInteger(body.assemblyMins) || body.assemblyMins < 0 || body.assemblyMins > 45) return fail(422, "VALIDATION", "Assembly can last up to 45 minutes.", { field: "assemblyMins" });
    const first = body.firstLectureStart || null;
    if (first) {
      const after = toMinutes(body.assemblyStart) + body.assemblyMins;
      if (!/^\d{2}:\d{2}$/.test(first) || toMinutes(first) < after || toMinutes(first) > after + 60) return fail(422, "VALIDATION", `Period 1 must start after assembly ends (${clockTime(fromMins(after))}) and within an hour of it.`, { field: "firstLectureStart" });
    }
    const bad = checkRule(body.normal, "Monday to Saturday", "normal", 10) ?? checkRule(body.friday, "Friday", "friday", 8);
    if (bad) return bad;
    const plan = { ...body, firstLectureStart: first };
    const fri = bellDay(plan, plan.friday);
    // An evening shift starts after noon: it closes by 7 pm, and Friday's Jumu'ah rule does not apply.
    const evening = toMinutes(body.assemblyStart) >= 12 * 60;
    if (!evening && toMinutes(fri.offTime) > toMinutes("12:30")) return fail(422, "VALIDATION", `On Friday school would close at ${clockTime(fri.offTime)}. It must close by 12:30 PM for Jumu'ah: shorten the periods or have fewer.`, { field: "friday.periods" });
    const normal = bellDay(plan, plan.normal);
    const latest = evening ? "19:00" : "15:00";
    if (toMinutes(normal.offTime) > toMinutes(latest)) return fail(422, "VALIDATION", `School would close at ${clockTime(normal.offTime)}. It must close by ${clockTime(latest)}: shorten the periods or have fewer.`, { field: "normal.periods" });
    if (existing.active) {
      const assigned = new Set(schedulesOf(existing.campus).find((s) => s.id === existing.id)?.sections ?? []);
      const inUse = periodsInUse(existing.campus, (cs) => (assigned.has(cs) ? body : null));
      if (inUse) return inUse;
    }
    const saved: BellSchedule = { ...existing, name, assemblyStart: body.assemblyStart, assemblyMins: body.assemblyMins, firstLectureStart: first, normal: body.normal, friday: body.friday, rowVer: existing.rowVer + 1, updatedAt: demoNow(), updatedBy: user.name };
    store.set((s) => ({ ...s, schedules: s.schedules.map((x) => (x.id === saved.id ? saved : x)) }));
    return HttpResponse.json(schedulesOf(existing.campus).find((x) => x.id === saved.id) ?? saved);
  }),

  http.put("/api/timetable/schedules/:id/sections", async ({ params, request }) => {
    await latency();
    const body = (await request.json()) as BellSectionsBody;
    const target = store.get().schedules.find((s) => s.id === String(params.id));
    if (!target) return fail(404, "NOT_FOUND", "These timings no longer exist. Reload the page.");
    const user = requirePermission("timetable.manage", target.campus);
    if (user instanceof Response) return user;
    if (body.rowVer !== target.rowVer) return fail(409, "CONCURRENCY", `${target.updatedBy} changed these timings at ${clockTime(target.updatedAt.slice(11, 16))}. Reload to see their version, then make your change again.`, { details: { by: target.updatedBy, at: target.updatedAt } });
    const labels = labelsOf(target.campus);
    const wanted = [...new Set(body.sections ?? [])];
    const unknown = wanted.find((l) => !labels.includes(l));
    if (unknown) return fail(422, "VALIDATION", `There is no class ${unknown} at ${campusName(target.campus)}.`, { field: "sections" });
    const season = schedulesOf(target.campus).filter((s) => s.season === target.season);
    const current = season.find((s) => s.id === target.id)!;
    if (target.main && current.sections.some((l) => !wanted.includes(l))) return fail(422, "VALIDATION", "Every section follows some timings. To take a section off the main timings, put it on other timings instead.", { field: "sections" });
    // Main timings: listed sections come back to them from other timings. Other timings: exactly the listed sections.
    const next = season.map((s) => (s.main ? s : s.id === target.id ? { ...s, sections: wanted } : { ...s, sections: s.sections.filter((l) => !wanted.includes(l)) }));
    const timingFor = (cs: string) => next.find((s) => !s.main && s.sections.includes(cs)) ?? next.find((s) => s.main) ?? null;
    if (target.active) {
      const inUse = periodsInUse(target.campus, timingFor);
      if (inUse) return inUse;
    }
    const at = demoNow();
    const byId = new Map(next.map((s) => [s.id, s]));
    store.set((st) => ({
      ...st,
      schedules: st.schedules.map((x) => {
        const n = byId.get(x.id);
        if (!n) return x;
        const changed = !x.main && JSON.stringify(n.sections) !== JSON.stringify(x.sections);
        if (!changed && x.id !== target.id) return x;
        return { ...x, ...(x.main ? {} : { sections: n.sections }), rowVer: x.rowVer + 1, updatedAt: at, updatedBy: user.name };
      }),
    }));
    return HttpResponse.json(schedulesOf(target.campus));
  }),

  http.delete("/api/timetable/schedules/:id", async ({ params }) => {
    await latency();
    const target = store.get().schedules.find((s) => s.id === String(params.id));
    if (!target) return fail(404, "NOT_FOUND", "These timings were already removed.");
    const user = requirePermission("timetable.manage", target.campus);
    if (user instanceof Response) return user;
    if (target.main) return fail(409, "MAIN_TIMINGS", "The main timings can't be removed: every section without timings of its own follows them.");
    const main = store.get().schedules.find((s) => s.campus === target.campus && s.season === target.season && s.main);
    if (target.active && main) {
      const moving = new Set(target.sections);
      const inUse = periodsInUse(target.campus, (cs) => (moving.has(cs) ? main : null));
      if (inUse) return inUse;
    }
    store.set((s) => ({ ...s, schedules: s.schedules.filter((x) => x.id !== target.id) }));
    return HttpResponse.json(schedulesOf(target.campus));
  }),

  http.post("/api/timetable/schedules/:id/activate", async ({ params }) => {
    await latency();
    const target = store.get().schedules.find((s) => s.id === String(params.id));
    if (!target) return fail(404, "NOT_FOUND", "These timings no longer exist. Reload the page.");
    const user = requirePermission("timetable.manage", target.campus);
    if (user instanceof Response) return user;
    // The whole season switches: every section moves to its timings in that season.
    const season = schedulesOf(target.campus).filter((s) => s.season === target.season);
    const inUse = periodsInUse(target.campus, (cs) => season.find((s) => !s.main && s.sections.includes(cs)) ?? season.find((s) => s.main) ?? null);
    if (inUse) return inUse;
    const at = demoNow();
    store.set((s) => ({ ...s, schedules: s.schedules.map((x) => (x.campus !== target.campus ? x : { ...x, active: x.season === target.season, ...(x.id === target.id ? { updatedAt: at, updatedBy: user.name, rowVer: x.rowVer + 1 } : {}) })) }));
    return HttpResponse.json(schedulesOf(target.campus));
  }),

  http.get("/api/timetable/cover", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requirePermission("timetable.view", ctx.campus);
    if (user instanceof Response) return user;
    if (ctx.campus === "ALL") return fail(400, "CAMPUS_REQUIRED", "Cover is arranged per campus. Choose a campus.");
    const ro = readOnlyError(ctx.session);
    if (ro) return ro;
    const date = isIso(url.searchParams.get("date")) ? url.searchParams.get("date")! : DEMO_TODAY;
    return HttpResponse.json(coverDay(ctx.campus, date));
  }),

  http.post("/api/timetable/cover/away", async ({ request }) => {
    await latency();
    const body = (await request.json()) as TeacherAwayBody;
    const user = requirePermission("timetable.manage", body.campus);
    if (user instanceof Response) return user;
    const ro = readOnlyError(body.session);
    if (ro) return ro;
    if (!isIso(body.date) || body.date < DEMO_TODAY) return fail(422, "VALIDATION", "Choose today or a later date.", { field: "date" });
    const closed = closedOn(body.campus, body.date);
    if (closed) return fail(409, "NO_SCHOOL", `There is no school on ${closed.name === "Sunday" ? "Sunday" : closed.name}, so no cover is needed.`);
    const board = boardFor(body.campus, CURRENT_SESSION);
    const t = board.teachers.find((x) => x.id === body.teacherId);
    if (!t) return fail(422, "VALIDATION", "Choose a teacher from the list.", { field: "teacherId" });
    if (!body.reason?.trim()) return fail(422, "VALIDATION", "Choose why the teacher is away.", { field: "reason" });
    if (store.get().away.some((a) => a.campus === body.campus && a.date === body.date && a.teacherId === t.id)) return fail(409, "ALREADY_AWAY", `${t.name} is already marked away on this day.`);
    if (store.get().covers.some((c) => c.campus === body.campus && c.date === body.date && c.substituteId === t.id)) return fail(409, "IS_COVERING", `${t.name} is covering a class on this day. Remove that cover first.`);
    store.set((s) => ({ ...s, away: [...s.away, { campus: body.campus, date: body.date, teacherId: t.id, name: t.name, reason: body.reason.trim(), source: "Office", markedBy: user.name, markedAt: demoNow() }] }));
    return HttpResponse.json(coverDay(body.campus, body.date), { status: 201 });
  }),

  http.post("/api/timetable/cover/away/clear", async ({ request }) => {
    await latency();
    const body = (await request.json()) as Omit<TeacherAwayBody, "reason">;
    const user = requirePermission("timetable.manage", body.campus);
    if (user instanceof Response) return user;
    const ro = readOnlyError(body.session);
    if (ro) return ro;
    const a = store.get().away.find((x) => x.campus === body.campus && x.date === body.date && x.teacherId === body.teacherId);
    if (!a) return fail(404, "NOT_FOUND", "This teacher is not marked away on this day.");
    if (a.source === "HR") return fail(409, "FROM_HR", `${a.name}'s leave comes from HR. Cancel the leave in HR, and the cover list follows.`);
    store.set((s) => ({
      ...s,
      away: s.away.filter((x) => x !== a && !(x.campus === a.campus && x.date === a.date && x.teacherId === a.teacherId)),
      covers: s.covers.filter((c) => !(c.campus === body.campus && c.date === body.date && c.absentTeacherId === body.teacherId)),
    }));
    return HttpResponse.json(coverDay(body.campus, body.date));
  }),

  http.post("/api/timetable/cover", async ({ request }) => {
    await latency();
    const key = request.headers.get("Idempotency-Key");
    if (!key) return fail(400, "IDEMPOTENCY_KEY_REQUIRED", "Missing idempotency key.");
    const done = store.get().idem[key] as TimetableCover | undefined;
    if (done) return HttpResponse.json(done);
    const body = (await request.json()) as CoverBody;
    const user = requirePermission("timetable.manage", body.campus);
    if (user instanceof Response) return user;
    const ro = readOnlyError(body.session);
    if (ro) return ro;
    const board = boardFor(body.campus, CURRENT_SESSION);
    const slot = board.slots.find((s) => s.id === body.slotId);
    if (!slot || !slot.teacherId) return fail(404, "NOT_FOUND", "This period has changed in the timetable. Reload the cover list.");
    if (weekdayOf(body.date) !== slot.day) return fail(422, "VALIDATION", "This period is not on the chosen day.");
    const st = store.get();
    if (!st.away.some((a) => a.campus === body.campus && a.date === body.date && a.teacherId === slot.teacherId)) return fail(409, "NOT_AWAY", "The class's teacher is not marked away on this day.");
    if (st.covers.some((c) => c.campus === body.campus && c.date === body.date && c.slotId === slot.id)) return fail(409, "ALREADY_COVERED", `${slot.classSection} period ${slot.period} already has cover. Remove it first to choose someone else.`);
    const sub = board.teachers.find((t) => t.id === body.substituteId);
    if (!sub) return fail(422, "VALIDATION", "Choose a teacher from the list.", { field: "substituteId" });
    if (st.away.some((a) => a.campus === body.campus && a.date === body.date && a.teacherId === sub.id)) return fail(409, "SUBSTITUTE_AWAY", `${sub.name} is away on this day too.`);
    const busy = board.slots.find((s) => s.teacherId === sub.id && s.day === slot.day && sameTime(board, slot.day, s, slot));
    if (busy) return fail(409, "SUBSTITUTE_BUSY", `${sub.name} teaches ${slotClassLabel(busy)} at that time. Choose a teacher who is free then.`);
    if (st.covers.some((c) => c.campus === body.campus && c.date === body.date && c.substituteId === sub.id && sameTime(board, slot.day, c, slot))) return fail(409, "SUBSTITUTE_BUSY", `${sub.name} is already covering another class in period ${slot.period}.`);
    const load = board.slots.filter((s) => s.teacherId === sub.id && s.day === slot.day).length + st.covers.filter((c) => c.campus === body.campus && c.date === body.date && c.substituteId === sub.id).length;
    if (load >= sub.maxPerDay + 1) return fail(409, "SUBSTITUTE_FULL", `${sub.name} already has ${load} periods on ${dayLong(slot.day)}. Choose someone with a lighter day.`);
    const seq = st.seq + 1;
    const cover: TimetableCover = {
      id: `cov-${seq}`,
      date: body.date,
      slotId: slot.id,
      period: slot.period,
      classSection: slot.classSection,
      subjectId: slot.subjectId,
      absentTeacherId: slot.teacherId,
      substituteId: sub.id,
      substituteName: sub.name,
      ...(body.note?.trim() ? { note: body.note.trim() } : {}),
      by: user.name,
      at: demoNow(),
    };
    store.set((s) => ({ ...s, seq, covers: [...s.covers, { ...cover, campus: body.campus }], idem: { ...s.idem, [key]: cover } }));
    return HttpResponse.json(cover, { status: 201 });
  }),

  http.delete("/api/timetable/cover/:id", async ({ params }) => {
    await latency();
    const c = store.get().covers.find((x) => x.id === String(params.id));
    if (!c) return fail(404, "NOT_FOUND", "This cover was already removed.");
    const user = requirePermission("timetable.manage", c.campus);
    if (user instanceof Response) return user;
    if (c.date < DEMO_TODAY) return fail(409, "PAST_DAY", "Cover for an earlier day can't be changed.");
    store.set((s) => ({ ...s, covers: s.covers.filter((x) => x.id !== c.id) }));
    return HttpResponse.json({ status: "ok" });
  }),

  http.post("/api/timetable/hand-over", async ({ request }) => {
    await latency();
    const body = (await request.json()) as HandOverBody;
    const user = requirePermission("timetable.manage", body.campus);
    if (user instanceof Response) return user;
    const ro = readOnlyError(body.session);
    if (ro) return ro;
    const board = boardFor(body.campus, CURRENT_SESSION);
    const from = board.teachers.find((t) => t.id === body.fromTeacherId);
    const to = board.teachers.find((t) => t.id === body.toTeacherId);
    if (!from || !to) return fail(422, "VALIDATION", "Choose both teachers.", { field: "toTeacherId" });
    if (from.id === to.id) return fail(422, "VALIDATION", "Choose a different teacher to take the periods.", { field: "toTeacherId" });
    const ids = new Set(body.slotIds);
    const moving = board.slots.filter((s) => ids.has(s.id) && s.teacherId === from.id);
    if (moving.length === 0) return fail(422, "VALIDATION", "Choose at least one period to hand over.", { field: "slotIds" });
    if (!body.reason?.trim() || body.reason.trim().length < 5) return fail(422, "VALIDATION", "Write why the periods are handed over (at least 5 letters). It is kept in the timetable's history.", { field: "reason" });
    const draft = board.slots.map((s) => (ids.has(s.id) && s.teacherId === from.id ? { ...s, teacherId: to.id } : s));
    const blockers = blocking(findTimetableClashes({ ...board, slots: draft }), moving.map((s) => s.id));
    const override = body.overrideReason?.trim();
    if (blockers.length && !override) return fail(409, "TIMETABLE_CLASH", `${to.name} would be in two places at once ${blockers.length === 1 ? "once" : `${blockers.length} times`}. Untick those periods, or give a reason to keep them.`, { details: { clashes: blockers } });
    const clashIds = new Set(blockers.flatMap((c) => c.slotIds));
    const stamp = override ? { reason: override, by: user.name, at: demoNow() } : undefined;
    const saved = draft.map((s) => (stamp && clashIds.has(s.id) ? { ...s, override: stamp } : s));
    saveBoard(body.campus, saved, user.name);
    const result: HandOverResult = { moved: moving.length, clashes: findTimetableClashes({ ...board, slots: saved }) };
    return HttpResponse.json(result);
  }),

  http.get("/api/timetable/teacher-sms", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requirePermission("timetable.view", ctx.campus);
    if (user instanceof Response) return user;
    if (ctx.campus === "ALL") return fail(400, "CAMPUS_REQUIRED", "Teachers are texted campus by campus. Choose a campus.");
    const ro = readOnlyError(ctx.session);
    if (ro) return ro;
    const date = isIso(url.searchParams.get("date")) ? url.searchParams.get("date")! : DEMO_TODAY;
    if (date < DEMO_TODAY) return fail(422, "VALIDATION", "Choose today or a later day. Messages go out for days still to come.", { field: "date" });
    if (date > SESSION_LAST_DAY) return fail(422, "VALIDATION", `Choose a day in this session (up to ${formatDate(SESSION_LAST_DAY)}).`, { field: "date" });
    return HttpResponse.json(textsFor(ctx.campus, date));
  }),

  http.post("/api/timetable/teacher-sms", async ({ request }) => {
    await latency();
    const key = request.headers.get("Idempotency-Key");
    if (!key) return fail(400, "IDEMPOTENCY_KEY_REQUIRED", "Missing idempotency key.");
    const done = store.get().idem[key] as TeacherSmsResult | undefined;
    if (done) return HttpResponse.json(done);
    const body = (await request.json()) as TeacherSmsBody;
    const user = requirePermission("sms.send", body.campus);
    if (user instanceof Response) return user;
    const ro = readOnlyError(body.session);
    if (ro) return ro;
    const sms = smsStatusStore.get();
    if (sms.paused) return fail(423, "SMS_PAUSED", `All SMS are paused${sms.pausedBy ? ` by ${sms.pausedBy}` : ""}. Ask an admin to resume SMS, then send again.`);
    if (!isIso(body.date) || body.date < DEMO_TODAY || body.date > SESSION_LAST_DAY) return fail(422, "VALIDATION", "Choose today or a later day in this session.", { field: "date" });
    const day = textsFor(body.campus, body.date);
    if (day.closed) return fail(409, "NO_SCHOOL", `There is no school on ${formatDate(body.date)} (${day.closed.name}), so there are no periods to send.`);
    if (!body.teacherIds?.length) return fail(422, "VALIDATION", "Tick at least one teacher.", { field: "teacherIds" });
    const at = demoNow();
    const now = Date.now();
    const next: StoredText[] = [];
    let skipped = 0;
    for (const id of body.teacherIds) {
      const row = day.rows.find((r) => r.teacherId === id);
      if (!row || row.away || row.lessons.length === 0 || row.sms.status === "SENT" || row.sms.status === "QUEUED") {
        skipped++;
        continue;
      }
      next.push({ campus: body.campus, date: body.date, teacherId: id, message: row.message, at, by: user.name, queuedAt: now + next.length * 150 });
    }
    const result: TeacherSmsResult = { queued: next.length, skipped };
    store.set((s) => ({ ...s, texts: [...(s.texts ?? []), ...next], idem: { ...s.idem, [key]: result } }));
    return HttpResponse.json(result, { status: 201 });
  }),
];
