// The fictional timetable the unfinished mocks still read (no routes). The Timetable module is real now
// (backend/docs/modules/08_timetable.md): /api/timetable/* and the teacher app's /api/teacher/timetable fall through
// to the backend. What stays here until those modules are built:
// - timetableReportBoard: the report centre's class timetable and teacher load reports (module 13);
// - teacherDay: the teacher app's Today and Classes (T02–T04, spec 08 Q1), still mocked.
// Read-only: no away marks or cover (those live in the backend now), the boards are generated once per tab.
import { bellDay, periodTime, type BellSchedule, type CampusCode, type TimetableBoard, type TimetableDay, type TimetableSlot } from "@mtb/api";
import type { IsoDate } from "@mtb/domain";
import { CURRENT_SESSION } from "../clock";
import { weekdayOf } from "../fixtures/attendance";
import { campusName } from "../fixtures/campuses";
import { campusFixtures, campusRooms, daysOf, generateSlots, inUse, scheduleSeed, seedLegacyClashes, spanFinder, timetableSubjects, withSchedules } from "../fixtures/timetable";
import { closedOn } from "./attendance-model";

/** Every section label at a campus this session. */
const labelsOf = (campus: CampusCode) => campusFixtures(campus, CURRENT_SESSION).sections.map((s) => s.classSection);

/** Timings with the main ones' section list filled in: every section not on other timings of the same season. */
function schedulesOf(campus: CampusCode): BellSchedule[] {
  const mine = scheduleSeed().filter((s) => s.campus === campus);
  const labels = labelsOf(campus);
  return mine
    .map((s) => (s.main ? { ...s, sections: labels.filter((l) => !mine.some((o) => !o.main && o.season === s.season && o.sections.includes(l))) } : { ...s, sections: s.sections.filter((l) => labels.includes(l)) }))
    .sort((a, b) => a.season.localeCompare(b.season) || Number(b.main) - Number(a.main) || a.name.localeCompare(b.name));
}

const boards = new Map<string, TimetableBoard>();

function boardFor(campus: CampusCode, session: number): TimetableBoard {
  const key = `${campus}|${session}`;
  const hit = boards.get(key);
  if (hit) return hit;
  const fx = campusFixtures(campus, session);
  const list = inUse(schedulesOf(campus), campus);
  const schedule = list.find((s) => s.main) ?? list[0]!;
  const sections = withSchedules(fx.sections, list);
  const current = session === CURRENT_SESSION;
  const slots: TimetableSlot[] = generateSlots(campus, sections, list, current ? 0 : 1);
  if (current && campus === "KC") seedLegacyClashes(slots, spanFinder(sections, list));
  const board: TimetableBoard = {
    campus,
    campusName: campusName(campus),
    session,
    readOnly: !current,
    schedule,
    normal: bellDay(schedule, schedule.normal),
    friday: bellDay(schedule, schedule.friday),
    schedules: list,
    days: daysOf(list),
    subjects: timetableSubjects(),
    teachers: fx.teachers,
    sections,
    rooms: campusRooms(sections),
    slots,
    updatedAt: current ? "2026-04-03T15:40:00+05:00" : "2025-04-02T14:00:00+05:00",
    updatedBy: "Kamran Yousaf",
  };
  boards.set(key, board);
  return board;
}

/** A campus's (fictional) timetable board for the report centre (class timetable and teacher load reports). */
export const timetableReportBoard = (campus: CampusCode, session: number): TimetableBoard => boardFor(campus, session);

/** One teacher's (fictional) periods on a date, for the teacher app's Today and Classes. No cover: that is real now. */
export function teacherDay(campus: CampusCode, teacherName: string, date: IsoDate): Array<{ period: number; start: string; end: string; classSection: string; stream?: string; subject: string; room: string; cover: boolean }> {
  if (closedOn(campus, date)) return [];
  const wd = weekdayOf(date) as TimetableDay;
  const board = boardFor(campus, CURRENT_SESSION);
  const t = board.teachers.find((x) => x.name === teacherName);
  if (!t) return [];
  // Each class's own bell: seniors run on their timings.
  const at = (cs: string, p: number) => periodTime(board, cs, wd, p);
  const subject = (id: string) => board.subjects.find((s) => s.id === id)?.name ?? id;
  return board.slots
    .filter((s) => s.teacherId === t.id && s.day === wd)
    .map((s) => ({ period: s.period, start: at(s.classSection, s.period)?.start ?? "", end: at(s.classSection, s.period)?.end ?? "", classSection: s.classSection, ...(s.stream ? { stream: s.stream } : {}), subject: subject(s.subjectId), room: s.room, cover: false }))
    .sort((a, b) => a.start.localeCompare(b.start) || a.period - b.period);
}
