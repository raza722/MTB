// The fictional attendance the unfinished modules' mocks still share (no routes).
//
// Attendance is served by the real backend now (backend/docs/modules/04_attendance.md): every /api/attendance request
// and the teacher app's /api/teacher/registers* fall through to it. What is left here is the fixture-based register
// picture other still-fictional mocks read: the teacher app's Today, Timetable and Classes (closedOn,
// attendanceDayFor), the dashboard tile (attendanceDayFor), the parent portal (attendanceMarkOf, closedOn) and
// the timetable model (closedOn). These stay fictional (fictional G.R. numbers, the demo's fixed date and calendar) until
// those modules read att.fn_DayRegisters, att.vw_RegisterTotals, att.vw_EnrolmentAttendance and att.fn_CampusDays.
// Nothing here writes: the office marking, change requests and calendar edits happen in the real backend.
import type { AttendanceClosedDay, CampusCode, CampusScope, RegisterCode, SchoolEvent } from "@mtb/api";
import type { AttendanceCode, IsoDate } from "@mtb/domain";
import { DEMO_TODAY } from "../clock";
import { calendarSeed, pastMark, pastSubmission, registersFor, rosterFor, todayMarks, weekdayOf, type FixtureClassRow } from "../fixtures/attendance";

/* ------------------------------------------------------------------ Calendar */

let events: SchoolEvent[] | null = null;
const seededEvents = () => (events ??= calendarSeed());

function eventsAt(campus: CampusScope): SchoolEvent[] {
  return seededEvents().filter((e) => (campus === "ALL" ? e.campus === "ALL" : e.campus === "ALL" || e.campus === campus));
}

/** Why registers are closed on a date at a campus in the demo's calendar (Sunday first), or null on a school day. */
export function closedOn(campus: CampusScope, date: IsoDate): AttendanceClosedDay | null {
  if (weekdayOf(date) === 0) return { name: "Sunday", kind: "WEEKLY_OFF" };
  const e = eventsAt(campus).find((x) => x.closesRegisters && x.from <= date && date <= x.to);
  return e ? { name: e.name, kind: e.kind } : null;
}

/* ------------------------------------------------------------------ Registers */

const pastCache = new Map<string, Record<string, RegisterCode>>();

/** A register's marks on a school day: today's from the fixtures (null while not marked), earlier days generated. */
function marksOn(campus: CampusCode, cs: string, date: IsoDate): Record<string, RegisterCode> | null {
  if (date === DEMO_TODAY) return todayMarks(campus, cs);
  const key = `${campus}|${cs}|${date}`;
  const hit = pastCache.get(key);
  if (hit) return hit;
  const marks = Object.fromEntries(rosterFor(campus, cs).map((e) => [e.grNo, pastMark(e, date)]));
  pastCache.set(key, marks);
  return marks;
}

function rowFrom(campus: CampusCode, base: FixtureClassRow, date: IsoDate): FixtureClassRow {
  const cs = base.classSection;
  const roster = rosterFor(campus, cs);
  const marks = marksOn(campus, cs, date);
  if (!marks) return { classSection: cs, classTeacher: base.classTeacher, status: "NOT_MARKED", enrolled: roster.length, present: 0, absent: 0, leave: 0, late: 0 };
  const codes = Object.values(marks);
  const n = (c: RegisterCode) => codes.filter((x) => x === c).length;
  const sub = pastSubmission(campus, cs, date);
  return { classSection: cs, classTeacher: base.classTeacher, status: "SUBMITTED", submittedAt: sub.at, source: sub.source, enrolled: roster.length, present: n("P"), absent: n("A"), leave: n("L"), late: n("LT") };
}

/** The day's registers for other mocks (teacher app home, dashboard tile): rows, or the reason there is no school. */
export function attendanceDayFor(campus: CampusCode, date: IsoDate): { rows: FixtureClassRow[]; closed: AttendanceClosedDay | null } {
  const closed = closedOn(campus, date);
  if (closed) return { rows: [], closed };
  // Today's rows are exactly the fixtures (the dashboard's figures); earlier days are generated from the rosters.
  const rows = date === DEMO_TODAY ? registersFor(campus) : registersFor(campus).map((r) => rowFrom(campus, r, date));
  return { rows, closed: null };
}

/** For the parent portal: one student's mark on a date ("H" when closed, null when not marked or still to come). */
export function attendanceMarkOf(campus: CampusCode, classSection: string, date: IsoDate, grNo: string): AttendanceCode | null {
  if (closedOn(campus, date)) return "H";
  if (date > DEMO_TODAY) return null;
  return marksOn(campus, classSection, date)?.[grNo] ?? null;
}
