import type { AttendanceClassRow, AttendanceTotals, CampusCode, RegisterCode, SchoolEvent } from "@mtb/api";
import type { IsoDate } from "@mtb/domain";
import { CLASSES } from "./campuses";
import { STUDENTS } from "./students";

/**
 * Today's registers (04-Nov-2026) by class. Campus totals must match the dashboard figures in
 * handlers/dashboard.ts (attended = present + late, out of students in submitted registers):
 * Khalid 1,286 of 1,392 (92.4%), Sugar Mill 612/679, Ubaid 744/791, Majeed 402/453, Humaira 1,018/1,092.
 */
export const ATTENDANCE_TARGETS: Record<CampusCode, { attended: number; marked: number }> = {
  KC: { attended: 1286, marked: 1392 },
  SM: { attended: 612, marked: 679 },
  UC: { attended: 744, marked: 791 },
  MC: { attended: 402, marked: 453 },
  HC: { attended: 1018, marked: 1092 },
};

/** Every class-section in the meta classes list: Prep-A … 10-B. */
export const ALL_SECTIONS: string[] = CLASSES.flatMap((c) => c.sections.map((s) => `${c.short}-${s}`));

/** Fixed sizes from the brief: 7-B has 34 students (teacher register); its neighbours are similar. */
const FIXED_KC: Record<string, number> = { "7-A": 33, "7-B": 34, "7-C": 33 };

const TEACHERS = [
  "Ms Rabia Nasir",
  "Mr Imran Shafiq",
  "Ms Saima Akram",
  "Mr Fahad Iqbal",
  "Ms Nida Hussain",
  "Mr Waqar Ahmed",
  "Ms Asma Rafiq",
  "Ms Kiran Javaid",
  "Mr Zubair Aslam",
  "Ms Farzana Bibi",
  "Mr Naveed Sadiq",
  "Ms Uzma Shah",
  "Mr Shahid Mehmood",
  "Ms Lubna Tariq",
  "Ms Mehwish Anjum",
  "Mr Tariq Jamil",
  "Ms Sumaira Khalid",
  "Mr Bilal Hassan",
  "Ms Tahira Yasmin",
  "Mr Arif Hussain",
  "Ms Shazia Parveen",
  "Mr Usman Ghani",
];

/** Class teachers named in the brief and the approvals queue keep their sections at Khalid Campus. */
const KC_TEACHERS: Record<string, string> = { "7-A": "Mr Adeel Anwar", "7-B": "Ms Hina Javed", "7-C": "Ms Sana Tariq" };

export function classTeacher(campus: CampusCode, classSection: string, index: number): string {
  if (campus === "KC" && KC_TEACHERS[classSection]) return KC_TEACHERS[classSection]!;
  const offset = { KC: 0, SM: 5, UC: 9, MC: 13, HC: 17 }[campus];
  return TEACHERS[(index + offset) % TEACHERS.length]!;
}

/** Sections per campus: Khalid uses every section; smaller campuses use the first few. */
function sectionsFor(campus: CampusCode): string[] {
  if (campus === "KC") return ALL_SECTIONS;
  const count = Math.max(8, Math.round(ATTENDANCE_TARGETS[campus].marked / 52));
  return ALL_SECTIONS.slice(0, count);
}

/** Registers not yet marked this morning. */
const NOT_MARKED: Partial<Record<CampusCode, Record<string, number>>> = { KC: { "Prep-B": 30 }, MC: { "2-A": 41 } };

/** Registers with a correction waiting for approval (7-B: Muhammad Bilal, absent → late). */
const CHANGE_PENDING: Partial<Record<CampusCode, string[]>> = { KC: ["7-B"] };

/** Section sizes for one campus, summing exactly to the campus's marked total. */
export function sectionSizes(campus: CampusCode): Record<string, number> {
  const sections = sectionsFor(campus);
  const notMarked = NOT_MARKED[campus] ?? {};
  const fixed = campus === "KC" ? FIXED_KC : {};
  const flexible = sections.filter((s) => !(s in fixed) && !(s in notMarked));
  const remaining = ATTENDANCE_TARGETS[campus].marked - Object.values(fixed).reduce((a, n) => a + n, 0);
  // Younger classes are slightly larger.
  const weights = flexible.map((_, i) => 1.15 - (i / Math.max(1, flexible.length - 1)) * 0.3);
  const wsum = weights.reduce((a, w) => a + w, 0);
  const sizes: Record<string, number> = { ...fixed, ...notMarked };
  let given = 0;
  flexible.forEach((s, i) => {
    const n = Math.floor((remaining * weights[i]!) / wsum);
    sizes[s] = n;
    given += n;
  });
  let k = 0;
  while (given < remaining) {
    const s = flexible[k % flexible.length]!;
    sizes[s] = (sizes[s] ?? 0) + 1;
    given++;
    k++;
  }
  return sizes;
}

const at = (minutes: number) => {
  const h = 7 + Math.floor((48 + minutes) / 60);
  const m = (48 + minutes) % 60;
  return `2026-11-04T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+05:00`;
};

/** Today's registers for a campus, with counts that add up to the dashboard figures. */
export function registersFor(campus: CampusCode): AttendanceClassRow[] {
  const sizes = sectionSizes(campus);
  const sections = sectionsFor(campus);
  const notMarked = NOT_MARKED[campus] ?? {};
  const pending = CHANGE_PENDING[campus] ?? [];
  const rows: AttendanceClassRow[] = sections.map((cs, i) => {
    const enrolled = sizes[cs] ?? 0;
    const teacher = classTeacher(campus, cs, i);
    if (cs in notMarked) return { classSection: cs, classTeacher: teacher, status: "NOT_MARKED", enrolled, present: 0, absent: 0, leave: 0, late: 0 };
    if (campus === "KC" && cs === "7-B") {
      // The brief's register: 31 present, 2 absent, 1 on leave, 0 late.
      return { classSection: cs, classTeacher: teacher, status: "CHANGE_PENDING", submittedAt: "2026-11-04T08:05:00+05:00", source: "Teacher app", enrolled, present: 31, absent: 2, leave: 1, late: 0 };
    }
    const absent = Math.round(enrolled * (0.045 + ((i * 7) % 5) / 200));
    const leave = Math.round(enrolled * 0.018);
    const late = Math.round(enrolled * (0.02 + ((i * 3) % 4) / 200));
    return {
      classSection: cs,
      classTeacher: teacher,
      status: pending.includes(cs) ? "CHANGE_PENDING" : "SUBMITTED",
      submittedAt: at((i * 11) % 47),
      source: i % 17 === 5 ? "Office" : "Teacher app",
      enrolled,
      present: enrolled - absent - leave - late,
      absent,
      leave,
      late,
    };
  });

  // Nudge absences so present + late matches the campus target exactly (7-B stays as in the brief).
  const target = ATTENDANCE_TARGETS[campus].attended;
  const adjustable = rows.filter((r) => r.status !== "NOT_MARKED" && !(campus === "KC" && r.classSection === "7-B"));
  let diff = target - rows.reduce((a, r) => a + r.present + r.late, 0);
  let k = 0;
  while (diff !== 0 && k < 10000) {
    const r = adjustable[k % adjustable.length]!;
    if (diff > 0 && r.absent > 0) {
      r.absent--;
      r.present++;
      diff--;
    } else if (diff < 0 && r.present > 1) {
      r.present--;
      r.absent++;
      diff++;
    }
    k++;
  }
  return rows;
}

export function totalsOf(rows: AttendanceClassRow[]): AttendanceTotals {
  const marked = rows.filter((r) => r.status !== "NOT_MARKED");
  const sum = (pick: (r: AttendanceClassRow) => number, list = marked) => list.reduce((a, r) => a + pick(r), 0);
  const markedCount = sum((r) => r.enrolled);
  const attended = sum((r) => r.present + r.late);
  return {
    enrolled: sum((r) => r.enrolled, rows),
    marked: markedCount,
    present: sum((r) => r.present),
    absent: sum((r) => r.absent),
    leave: sum((r) => r.leave),
    late: sum((r) => r.late),
    attended,
    percent: markedCount === 0 ? 0 : Math.round((attended / markedCount) * 1000) / 10,
    registers: rows.length,
    notMarked: rows.length - marked.length,
  };
}

/* ==================================================================================================
 * Registers, rosters and day-by-day marks (attendance module). Everything below is deterministic, so a
 * monthly sheet, a student's report and the class register always agree, and today's registers add up
 * to the counts above (and therefore to the dashboard).
 * ================================================================================================== */

/** First and last day of each session the demo knows. */
export const SESSION_DATES: Record<number, { starts: IsoDate; ends: IsoDate }> = {
  2026: { starts: "2026-04-01", ends: "2027-03-31" },
  2025: { starts: "2025-04-01", ends: "2026-03-31" },
};

// ---------- dates (UTC arithmetic: the machine's time zone never shifts a day) ----------

const DAY_MS = 86_400_000;
const utc = (d: IsoDate) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
export const dayIndex = (d: IsoDate) => Math.round(utc(d) / DAY_MS);
/** 0 = Sunday … 6 = Saturday */
export const weekdayOf = (d: IsoDate) => new Date(utc(d)).getUTCDay();
export const addDays = (d: IsoDate, n: number): IsoDate => new Date(utc(d) + n * DAY_MS).toISOString().slice(0, 10);
export function datesBetween(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// ---------- small deterministic randomness ----------

export function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A number in [0, 1) from two integers. */
export function mix(a: number, b: number): number {
  let h = Math.imul(a ^ Math.imul(b, 2654435761), 2246822507);
  h ^= h >>> 15;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  h = Math.imul(h ^ (h >>> 13), 2246822507);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---------- rosters ----------

export interface RosterEntry {
  grNo: string;
  name: string;
  father: string;
  rollNo: number;
  /** A fixture student with a profile page. */
  hasProfile: boolean;
  mobile: string;
  seed: number;
  /** About one classmate in eighteen misses school often (shows on the low-attendance report). */
  chronic: boolean;
}

const GIRL_NAMES = ["Hania", "Aiza", "Minahil", "Alishba", "Abeera", "Haleema", "Mishal", "Rameen", "Arfa", "Dua", "Sehar", "Javeria", "Maheen", "Iqra", "Komal", "Rabia", "Shiza", "Tayyaba", "Umaima", "Wajiha"];
const BOY_NAMES = ["Ahmad", "Arslan", "Hasnain", "Muneeb", "Rohan", "Saim", "Taimoor", "Waleed", "Yahya", "Zohaib", "Abdul Rehman", "Huzaifa", "Moiz", "Shahzaib", "Hamdan", "Fahad", "Junaid", "Musa", "Rafay", "Sufyan"];
const SURNAMES = ["Akhtar", "Aslam", "Bashir", "Farooq", "Ghafoor", "Habib", "Jamil", "Latif", "Majeed", "Nadeem", "Rafiq", "Saeed", "Shafi", "Tufail", "Younas", "Zaheer", "Anwar", "Iqbal", "Mushtaq", "Sarwar"];
const FATHER_FIRST = ["Muhammad", "Ghulam", "Abdul", "Mian", "Rana", "Malik", "Chaudhry", "Hafiz", "Sheikh", "Syed"];
const NETWORKS = ["0300", "0301", "0302", "0311", "0321", "0333", "0345"];

/** Class-sections with a register at a campus (today's order). */
export function registerSections(campus: CampusCode): string[] {
  return registersFor(campus).map((r) => r.classSection);
}

const rosterCache = new Map<string, RosterEntry[]>();

/**
 * The students in a class-section: fixture students first (they keep their roll numbers and open a profile),
 * then classmates generated up to today's class size. Generated G.R. numbers start with 3 so they never
 * collide with fixture students.
 */
export function rosterFor(campus: CampusCode, classSection: string): RosterEntry[] {
  const key = `${campus}|${classSection}`;
  const hit = rosterCache.get(key);
  if (hit) return hit;
  const size = sectionSizes(campus)[classSection] ?? 30;
  const sectionNo = Math.max(0, ALL_SECTIONS.indexOf(classSection));
  const real = STUDENTS.filter((s) => s.campus === campus && s.classSection === classSection && s.status === "ACTIVE").slice(0, size);
  const used = new Set<number>();
  const entries: RosterEntry[] = real.map((s) => {
    const keep = s.rollNo >= 1 && s.rollNo <= size && !used.has(s.rollNo);
    if (keep) used.add(s.rollNo);
    return { grNo: s.grNo, name: s.name, father: s.father, rollNo: keep ? s.rollNo : 0, hasProfile: true, mobile: s.guardian.mobile, seed: hash32(s.grNo), chronic: false };
  });
  let i = 0;
  while (entries.length < size) {
    i++;
    const seed = hash32(`${campus}:${classSection}:${i}`);
    const girl = mix(seed, 1) < 0.5;
    const first = (girl ? GIRL_NAMES : BOY_NAMES)[Math.floor(mix(seed, 2) * 20)]!;
    const last = SURNAMES[Math.floor(mix(seed, 3) * 20)]!;
    const grNo = `${campus}-3${String(sectionNo).padStart(2, "0")}${String(i).padStart(2, "0")}`;
    entries.push({
      grNo,
      name: `${first} ${last}`,
      father: `${FATHER_FIRST[Math.floor(mix(seed, 4) * 10)]!} ${last}`,
      rollNo: 0,
      hasProfile: false,
      mobile: `${NETWORKS[Math.floor(mix(seed, 5) * NETWORKS.length)]!}555${String(1000 + Math.floor(mix(seed, 6) * 9000))}`,
      seed: hash32(grNo),
      chronic: hash32(grNo) % 18 === 0,
    });
  }
  // Fixture students keep their roll numbers; everyone else takes the free numbers in name order.
  let n = 1;
  for (const e of entries.filter((x) => x.rollNo === 0).sort((a, b) => a.name.localeCompare(b.name))) {
    while (used.has(n)) n++;
    e.rollNo = n;
    used.add(n);
  }
  const list = entries.sort((a, b) => a.rollNo - b.rollNo);
  rosterCache.set(key, list);
  return list;
}

/** Every student in a campus's registers, for lookups by G.R. number. */
export function campusRoster(campus: CampusCode): Array<RosterEntry & { classSection: string }> {
  return registerSections(campus).flatMap((cs) => rosterFor(campus, cs).map((e) => ({ ...e, classSection: cs })));
}

// ---------- marks ----------

/** Ayesha's marks this session (they match her profile's attendance calendar). */
const AYESHA: Record<IsoDate, RegisterCode> = {
  "2026-09-22": "A",
  "2026-10-07": "A",
  "2026-10-08": "L",
  "2026-10-14": "LT",
  "2026-10-21": "A",
  "2026-10-28": "LT",
  "2026-11-02": "LT",
};

/** Today's marks for one register, or null when it is not marked. Counts match registersFor exactly. */
export function todayMarks(campus: CampusCode, classSection: string): Record<string, RegisterCode> | null {
  const row = registersFor(campus).find((r) => r.classSection === classSection);
  if (!row || row.status === "NOT_MARKED") return null;
  const roster = rosterFor(campus, classSection);
  const marks: Record<string, RegisterCode> = Object.fromEntries(roster.map((e) => [e.grNo, "P" as RegisterCode]));
  let absent = row.absent;
  if (campus === "KC" && classSection === "7-B" && marks["KC-14650"]) {
    // Muhammad Bilal: marked absent before he reached class (a correction to "Late" is waiting).
    marks["KC-14650"] = "A";
    absent--;
  }
  // Generated classmates take the absences (in a fixed shuffled order); fixture students stay present.
  const pool = roster.filter((e) => !e.hasProfile).sort((a, b) => mix(a.seed, 777) - mix(b.seed, 777));
  const fallback = roster.filter((e) => e.hasProfile && e.grNo !== "KC-14823" && e.grNo !== "KC-14650");
  const order = [...pool, ...fallback];
  let k = 0;
  const give = (code: RegisterCode, count: number) => {
    for (let j = 0; j < count && k < order.length; j++, k++) marks[order[k]!.grNo] = code;
  };
  give("A", absent);
  give("L", row.leave);
  give("LT", row.late);
  return marks;
}

/** Absent-streak classmates: absent on the two school days before today too (a "3rd day absent" case). */
let streaks: Map<string, Set<IsoDate>> | null = null;
function streakDays(): Map<string, Set<IsoDate>> {
  if (streaks) return streaks;
  const found = new Map<string, Set<IsoDate>>();
  for (const cs of ["7-B", "3-A"]) {
    const marks = todayMarks("KC", cs);
    const first = marks && Object.entries(marks).find(([gr, c]) => c === "A" && gr.startsWith("KC-3"));
    if (first) found.set(first[0], new Set<IsoDate>(["2026-11-02", "2026-11-03"]));
  }
  streaks = found;
  return found;
}

/** A student's mark on a past school day (the caller skips Sundays and closed days). */
export function pastMark(e: RosterEntry, date: IsoDate): RegisterCode {
  if (e.grNo === "KC-14823") return AYESHA[date] ?? "P";
  if (e.hasProfile) return Number(date.slice(8)) % 11 === 0 ? "A" : "P";
  if (streakDays().get(e.grNo)?.has(date)) return "A";
  const r = mix(e.seed, dayIndex(date));
  const absentRate = e.chronic ? 0.26 : 0.038;
  if (r < absentRate) return "A";
  if (r < absentRate + 0.016) return "L";
  if (r < absentRate + 0.042) return "LT";
  return "P";
}

/** Who submitted a past register, and when (mostly the teacher app, 07:58–08:35 AM). */
export function pastSubmission(campus: CampusCode, classSection: string, date: IsoDate) {
  const r = mix(hash32(`${campus}:${classSection}`), dayIndex(date));
  const minutes = 478 + Math.floor(r * 37);
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  const index = Math.max(0, ALL_SECTIONS.indexOf(classSection));
  return { at: `${date}T${hh}:${mm}:00+05:00`, by: classTeacher(campus, classSection, index), source: r < 0.06 ? ("Office" as const) : ("Teacher app" as const) };
}

// ---------- calendar ----------

const ev = (
  id: string,
  campus: SchoolEvent["campus"],
  session: number,
  from: IsoDate,
  to: IsoDate,
  kind: SchoolEvent["kind"],
  name: string,
  nameUr: string,
  closesRegisters: boolean,
  note?: string,
): SchoolEvent => ({ id, campus, session, from, to, kind, name, nameUr, closesRegisters, ...(note ? { note } : {}), updatedBy: "Kamran Yousaf", updatedAt: "2026-03-28T11:20:00+05:00" });

/** The school calendar: national holidays (Islamic dates are approximate until the moon is sighted), vacations and events. */
export function calendarSeed(): SchoolEvent[] {
  return [
    ev("cal-01", "ALL", 2026, "2026-06-01", "2026-07-31", "VACATION", "Summer vacation", "موسمِ گرما کی تعطیلات", true),
    ev("cal-02", "ALL", 2026, "2026-08-14", "2026-08-14", "HOLIDAY", "Independence Day", "یومِ آزادی", true),
    ev("cal-03", "ALL", 2026, "2026-08-26", "2026-08-26", "HOLIDAY", "Eid Milad-un-Nabi (12 Rabi-ul-Awwal)", "عید میلاد النبی", true, "Date depends on the moon sighting."),
    ev("cal-04", "ALL", 2026, "2026-09-06", "2026-09-06", "HOLIDAY", "Defence Day", "یومِ دفاع", true),
    ev("cal-05", "ALL", 2026, "2026-10-12", "2026-10-17", "EXAM", "First term exams", "پہلی ٹرم کے امتحانات", false, "Registers stay open: students sit papers in their own rooms."),
    ev("cal-06", "KC", 2026, "2026-10-24", "2026-10-24", "EVENT", "Parent–teacher day (no classes)", "والدین اور اساتذہ کی ملاقات", true),
    ev("cal-07", "ALL", 2026, "2026-11-09", "2026-11-09", "HOLIDAY", "Iqbal Day", "یومِ اقبال", true),
    ev("cal-08", "KC", 2026, "2026-11-27", "2026-11-27", "EVENT", "Annual sports day", "سالانہ کھیلوں کا دن", false, "Registers are taken in the morning before the events start."),
    ev("cal-09", "HC", 2026, "2026-12-18", "2026-12-18", "EVENT", "Campus annual day", "کیمپس کا سالانہ دن", true),
    ev("cal-10", "ALL", 2026, "2026-12-21", "2026-12-31", "VACATION", "Winter vacation", "موسمِ سرما کی تعطیلات", true),
    ev("cal-11", "ALL", 2026, "2026-12-25", "2026-12-25", "HOLIDAY", "Quaid-e-Azam Day", "یومِ قائدِ اعظم", true),
    ev("cal-12", "ALL", 2026, "2027-02-05", "2027-02-05", "HOLIDAY", "Kashmir Solidarity Day", "یومِ یکجہتیِ کشمیر", true),
    ev("cal-13", "ALL", 2026, "2027-02-22", "2027-03-04", "EXAM", "Annual exams", "سالانہ امتحانات", false),
    ev("cal-14", "ALL", 2026, "2027-03-09", "2027-03-11", "HOLIDAY", "Eid-ul-Fitr", "عید الفطر", true, "Date depends on the moon sighting."),
    ev("cal-15", "ALL", 2026, "2027-03-23", "2027-03-23", "HOLIDAY", "Pakistan Day", "یومِ پاکستان", true),
    // Last session (read-only)
    ev("cal-p1", "ALL", 2025, "2025-06-01", "2025-07-31", "VACATION", "Summer vacation", "موسمِ گرما کی تعطیلات", true),
    ev("cal-p2", "ALL", 2025, "2025-08-14", "2025-08-14", "HOLIDAY", "Independence Day", "یومِ آزادی", true),
    ev("cal-p3", "ALL", 2025, "2025-11-10", "2025-11-10", "HOLIDAY", "Iqbal Day (observed)", "یومِ اقبال", true),
    ev("cal-p4", "ALL", 2025, "2025-12-22", "2025-12-31", "VACATION", "Winter vacation", "موسمِ سرما کی تعطیلات", true),
    ev("cal-p5", "ALL", 2025, "2026-02-05", "2026-02-05", "HOLIDAY", "Kashmir Solidarity Day", "یومِ یکجہتیِ کشمیر", true),
    ev("cal-p6", "ALL", 2025, "2026-03-20", "2026-03-23", "HOLIDAY", "Eid-ul-Fitr and Pakistan Day", "عید الفطر اور یومِ پاکستان", true),
  ];
}
