import { bellDay, isFriday, periodsOn, reqKey, setupSectionLabel, streamShort, toMinutes, type BellDay, type BellSchedule, type CampusCode, type TimetableDay, type TimetableRequirement, type TimetableSection, type TimetableSlot, type TimetableSubject, type TimetableTeacher } from "@mtb/api";
import { initialStaff } from "./hr";
import { campusSections, DEGREE_COURSES, initialClasses, initialClassSubjects, initialCourseSubjects, initialDegreeClassSubjects, initialDegreeTeachers, initialExtraSections, initialGroups, initialLevels, initialSections, initialSubjects, initialSubjectTeachers, initialTeachers, teacherId, type SectionRecord } from "./setup";

/**
 * Timetable fixtures — owned by the timetable feature. Built from Setup's teachers, sections, class subjects
 * (periods a week) and subject-teacher allotments, so a teacher's timetable matches what Setup allots.
 * Classes 9 and 10 hold two groups (Science (Biology) and Science (Computer)): the group subjects are taught
 * side by side in the same periods, as in the old class timetable's "G" rows.
 * Fictional data only.
 */

/* ------------------------------------------------------------------ Bell schedules */

const rule = (periodMins: number, periods: number, breakAfter: number, breakMins: number) => ({ periodMins, periods, breakAfter, breakMins });

/** Sections of classes 9 and 10 at a campus: they follow the senior timings. */
export const seniorSections = (campus: CampusCode) => campusSections(campus).map((s) => s.label).filter((l) => /^(9|10)-/.test(l));

function sched(campus: CampusCode, season: BellSchedule["season"], active: boolean, assemblyStart: string, senior: boolean): BellSchedule {
  return {
    id: `bell-${campus.toLowerCase()}-${season.toLowerCase()}${senior ? "-senior" : ""}`,
    campus,
    season,
    active,
    name: senior ? "Senior classes (9 and 10)" : "School day",
    main: !senior,
    assemblyStart,
    assemblyMins: 15,
    firstLectureStart: null,
    // Seniors have eight shorter periods (the practical subjects need more of them) and a later break.
    normal: senior ? rule(35, 8, 5, 25) : rule(40, 7, 4, 30),
    friday: senior ? rule(30, 6, 4, 15) : rule(35, 5, 4, 15),
    sections: senior ? seniorSections(campus) : [],
    rowVer: 3,
    updatedAt: "2026-03-30T10:15:00+05:00",
    updatedBy: "Kamran Yousaf",
  };
}

/* Evening shift: sections of classes whose shift is Evening in Setup (the ADP batch at Khalid Campus). */

/** This session's sections of evening-shift classes at a campus, with Setup's section label. */
function eveningRecords(campus: CampusCode): Array<{ rec: SectionRecord; label: string }> {
  const classes = initialClasses();
  return initialExtraSections().flatMap((rec) => {
    const cls = classes.find((c) => c.id === rec.classId);
    return rec.campus === campus && rec.session === 2026 && rec.active && cls?.shift === "EVENING" ? [{ rec, label: setupSectionLabel(cls, rec.name) }] : [];
  });
}

/** Labels of the evening-shift sections at a campus: they follow the evening timings. */
export const eveningSections = (campus: CampusCode) => eveningRecords(campus).map((x) => x.label);

/** Evening timings: an afternoon roll call, four lectures of 50 minutes (45 on Friday), one break. */
function eveningSched(campus: CampusCode, season: BellSchedule["season"], active: boolean): BellSchedule {
  return {
    id: `bell-${campus.toLowerCase()}-${season.toLowerCase()}-evening`,
    campus,
    season,
    active,
    name: "Evening shift",
    main: false,
    assemblyStart: "14:00",
    assemblyMins: 10,
    firstLectureStart: null,
    normal: rule(50, 4, 2, 20),
    friday: rule(45, 4, 2, 15),
    sections: eveningSections(campus),
    rowVer: 2,
    updatedAt: "2026-09-01T09:30:00+05:00",
    updatedBy: "Kamran Yousaf",
  };
}

/**
 * Normal timings are in use; winter timings (half an hour later) are ready for December. Each season has the school day
 * and senior timings, and an evening shift where a campus has evening classes.
 */
export function scheduleSeed(): BellSchedule[] {
  const starts: Record<CampusCode, [string, string]> = { KC: ["07:45", "08:15"], SM: ["07:45", "08:15"], UC: ["07:40", "08:10"], MC: ["08:00", "08:30"], HC: ["07:50", "08:20"] };
  const codes = Object.keys(starts) as CampusCode[];
  return [
    ...codes.flatMap((c) => [sched(c, "GENERAL", true, starts[c][0], false), sched(c, "GENERAL", true, starts[c][0], true), sched(c, "WINTER", false, starts[c][1], false), sched(c, "WINTER", false, starts[c][1], true)]),
    // After the day timings, so the first active timing of a campus stays its main school day.
    ...codes.filter((c) => eveningSections(c).length).flatMap((c) => [eveningSched(c, "GENERAL", true), eveningSched(c, "WINTER", false)]),
  ];
}

/** Timings in use at a campus (the active season), with the main ones first. */
export const inUse = (schedules: BellSchedule[], campus: CampusCode) => {
  const list = schedules.filter((s) => s.campus === campus && s.active);
  const pick = list.length ? list : schedules.filter((s) => s.campus === campus && s.season === "GENERAL");
  return [...pick].sort((a, b) => Number(b.main) - Number(a.main));
};

/** Which timing a section follows: the one that lists it, otherwise the season's main timings. */
export function scheduleIdFor(list: BellSchedule[], classSection: string): string {
  return (list.find((s) => !s.main && s.sections.includes(classSection)) ?? list.find((s) => s.main) ?? list[0])?.id ?? "";
}

/** Bell times per schedule id. */
export const daysOf = (list: BellSchedule[]): Record<string, { normal: BellDay; friday: BellDay }> => Object.fromEntries(list.map((s) => [s.id, { normal: bellDay(s, s.normal), friday: bellDay(s, s.friday) }]));

/* ------------------------------------------------------------------ Subjects, teachers, sections */

const SHORT: Record<string, string> = {
  eng: "English",
  urd: "Urdu",
  mat: "Maths",
  sci: "Science",
  sst: "Social St.",
  isl: "Islamiyat",
  phy: "Physics",
  che: "Chemistry",
  bio: "Biology",
  cmp: "Computer",
  pst: "Pak Studies",
  tqn: "Tarjuma Quran",
  naz: "Nazra",
  gk: "Gen. Knowledge",
  drw: "Drawing",
  chn: "Chinese",
  // Evening (ADP) courses
  cs111: "ICT",
  cs112: "Programming",
  mt111: "Basic Maths",
  en111: "English Comp.",
  is111: "Islamic St.",
};

/** School subjects, plus the courses of evening-shift degree classes (they are on the timetable too). */
export function timetableSubjects(): TimetableSubject[] {
  const evening = new Set(initialClasses().filter((c) => c.shift === "EVENING").map((c) => c.id));
  const courses = new Set(DEGREE_COURSES.filter((c) => evening.has(c.classId)).map((c) => c.id));
  return [...initialSubjects(), ...initialCourseSubjects().filter((s) => courses.has(s.id))]
    .filter((s) => s.active)
    .map((s) => ({ id: s.id, name: s.name, short: SHORT[s.id] ?? s.name, nameUr: s.nameUrdu }));
}

export const labelOf = (s: Pick<SectionRecord, "classId" | "name">) => `${s.classId === "c-prep" ? "Prep" : s.classId.slice(2)}-${s.name}`;

/** Specialist rooms: computer and science labs are shared, so two classes can't use one at the same time. */
export function labFor(subjectId: string, classSection: string): string | null {
  const upper = classSection.startsWith("9-") || classSection.startsWith("10-");
  if (subjectId === "cmp") return "Computer lab";
  if (upper && subjectId === "phy") return "Physics lab";
  if (upper && subjectId === "che") return "Chemistry lab";
  if (upper && subjectId === "bio") return "Biology lab";
  return null;
}

export const LAB_ROOMS = ["Computer lab", "Physics lab", "Chemistry lab", "Biology lab"];

/** Part-time staff have a lower weekly maximum. */
const PART_TIME = new Set([teacherId("KC", "Ms Nighat Perveen")]);

/** Most periods a teacher takes in one day: part-time staff four, everyone else the whole day. */
export const dayCapOf = (id: string) => (PART_TIME.has(id) ? 4 : 7);

interface CampusFixtures {
  teachers: TimetableTeacher[];
  /** scheduleId is filled in from the timings in use (the handler knows them). */
  sections: TimetableSection[];
}

const cache = new Map<string, CampusFixtures>();

let genders: Map<string, "F" | "M"> | null = null;
/** A teacher's gender from their staff record (HR), or from the title. */
function genderOf(name: string): "F" | "M" {
  if (!genders) {
    genders = new Map();
    for (const s of initialStaff()) if (!genders.has(s.name)) genders.set(s.name, s.gender === "F" ? "F" : "M");
  }
  return genders.get(name) ?? (/^(Ms|Mrs)\s/.test(name) || name === "Dr Saima Rafique" ? "F" : "M");
}

/** Teachers and sections (with periods a week and allotted teachers) for one campus and session. */
export function campusFixtures(campus: CampusCode, session: number): CampusFixtures {
  const key = `${campus}|${session}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const allSections = initialSections();
  const allTeachers = initialTeachers();
  const classSubjects = initialClassSubjects();
  const classes = initialClasses();
  const groups = initialGroups();
  const levels = initialLevels();
  const allotments = initialSubjectTeachers(allSections, allTeachers, classSubjects);
  const current = allSections.filter((s) => s.campus === campus && s.session === 2026);
  const list = allSections.filter((s) => s.campus === campus && s.session === session);
  /** A teacher for a group subject the section's own Setup group doesn't list: whoever teaches it in another section here. */
  const fallback = (subjectId: string): string | null => {
    for (const c of current) {
      const t = allotments[c.id]?.[subjectId];
      if (t) return t;
    }
    return allTeachers.find((t) => t.campus === campus && t.subjectIds.includes(subjectId))?.id ?? null;
  };
  const sections: TimetableSection[] = list.map((s) => {
    const label = labelOf(s);
    const now = current.find((c) => labelOf(c) === label);
    const allot = (now && allotments[now.id]) ?? {};
    const cls = classes.find((c) => c.id === s.classId);
    const level = levels.find((l) => l.id === cls?.levelId);
    const grouped = classSubjects.filter((cs) => cs.classId === s.classId && cs.groupId);
    let streams: string[] = [];
    let requirements: TimetableRequirement[];
    if (grouped.length > 1) {
      // Both groups sit in the section: common subjects for the whole class, group subjects side by side.
      streams = grouped.map((g) => groups.find((x) => x.id === g.groupId)?.name ?? g.groupId!);
      const common = grouped[0]!.subjects.filter((r) => grouped.every((g) => g.subjects.some((x) => x.subjectId === r.subjectId)));
      const own = s.groupId ? (grouped.find((g) => g.groupId === s.groupId)?.subjects ?? []) : [];
      const teacherFor = (subjectId: string) => (subjectId in allot ? (allot[subjectId] ?? null) : own.some((x) => x.subjectId === subjectId) ? null : fallback(subjectId));
      requirements = [
        ...common.map((r) => ({ subjectId: r.subjectId, stream: null, periodsPerWeek: r.periodsPerWeek, teacherId: allot[r.subjectId] ?? null })),
        ...grouped.flatMap((g, gi) => g.subjects.filter((r) => !common.some((c) => c.subjectId === r.subjectId)).map((r) => ({ subjectId: r.subjectId, stream: streams[gi]!, periodsPerWeek: r.periodsPerWeek, teacherId: teacherFor(r.subjectId) }))),
      ];
    } else {
      const rows = classSubjects.find((cs) => cs.classId === s.classId && cs.groupId === s.groupId)?.subjects ?? [];
      requirements = rows.map((r) => ({ subjectId: r.subjectId, stream: null, periodsPerWeek: r.periodsPerWeek, teacherId: allot[r.subjectId] ?? null }));
    }
    return {
      classSection: label,
      levelId: cls?.levelId ?? "",
      level: level?.name ?? "",
      shift: cls?.shift ?? "MORNING",
      streams,
      scheduleId: "",
      room: s.room,
      classTeacherId: s.classTeacherId,
      strength: s.strength,
      requirements,
    };
  });
  // Evening-shift classes (this session): their courses and lecturers, allotted as in Setup › Teachers.
  const evening = session === 2026 ? eveningRecords(campus) : [];
  const lecturers = initialDegreeTeachers().filter((t) => t.campus === campus && !allTeachers.some((x) => x.id === t.id));
  const degreeRows = [...classSubjects, ...initialDegreeClassSubjects()];
  const eveningAllot = evening.length ? initialSubjectTeachers(initialExtraSections(), [...allTeachers, ...lecturers], degreeRows) : {};
  for (const { rec, label } of evening) {
    const cls = classes.find((c) => c.id === rec.classId);
    const rows = degreeRows.find((cs) => cs.classId === rec.classId && cs.groupId === rec.groupId)?.subjects ?? [];
    sections.push({
      classSection: label,
      levelId: cls?.levelId ?? "",
      level: levels.find((l) => l.id === cls?.levelId)?.name ?? "",
      shift: "EVENING",
      streams: [],
      scheduleId: "",
      room: rec.room,
      classTeacherId: rec.classTeacherId,
      strength: rec.strength,
      requirements: rows.map((r) => ({ subjectId: r.subjectId, stream: null, periodsPerWeek: r.periodsPerWeek, teacherId: eveningAllot[rec.id]?.[r.subjectId] ?? null })),
    });
  }
  const eveningStaff = new Set(sections.filter((s) => s.shift === "EVENING").flatMap((s) => [s.classTeacherId, ...s.requirements.map((r) => r.teacherId)]));
  const teachers: TimetableTeacher[] = [...allTeachers.filter((t) => t.campus === campus), ...lecturers.filter((t) => eveningStaff.has(t.id))]
    .map((t) => {
      const ct = current.find((s) => s.classTeacherId === t.id);
      const eveningCt = evening.find((e) => e.rec.classTeacherId === t.id);
      const partTime = PART_TIME.has(t.id);
      return { id: t.id, name: t.name, gender: genderOf(t.name), subjectIds: t.subjectIds, classTeacherOf: ct ? labelOf(ct) : (eveningCt?.label ?? null), maxPerWeek: partTime ? 18 : 36, maxPerDay: dayCapOf(t.id), partTime };
    })
    .sort((a, b) => a.name.replace(/^(Mr|Ms|Mrs)\s+/, "").localeCompare(b.name.replace(/^(Mr|Ms|Mrs)\s+/, "")));
  const out = { teachers, sections };
  cache.set(key, out);
  return out;
}

/** Sections with the timing each one follows. */
export const withSchedules = (sections: TimetableSection[], list: BellSchedule[]): TimetableSection[] => sections.map((s) => ({ ...s, scheduleId: scheduleIdFor(list, s.classSection) }));

export function campusRooms(sections: TimetableSection[]): string[] {
  return [...new Set(sections.map((s) => s.room))].sort().concat(LAB_ROOMS);
}

/* ------------------------------------------------------------------ Timetable generation */

const CORE = new Set(["eng", "urd", "mat", "sci", "phy", "che", "bio"]);

function preferredPeriods(subjectId: string, n: number, offset: number): number[] {
  const early = [1, 2, 3, 4].filter((p) => p <= n);
  const late = Array.from({ length: Math.max(0, n - 4) }, (_, i) => i + 5);
  const rot = (xs: number[]) => (xs.length ? xs.map((_, i) => xs[(i + offset) % xs.length]!) : xs);
  return CORE.has(subjectId) ? [...rot(early), ...rot(late)] : [...rot(late), ...rot(early)];
}

export const slotId = (classSection: string, day: TimetableDay, period: number, stream?: string | null) => `s-${classSection}-${day}-${period}${stream ? `-${streamShort(stream).toLowerCase().replace(/[^a-z]+/g, "")}` : ""}`;

/** Clock span of a section's period, in minutes. */
export function spanFinder(sections: TimetableSection[], list: BellSchedule[]) {
  const days = daysOf(list);
  const sched = new Map(sections.map((s) => [s.classSection, s.scheduleId]));
  return (cs: string, day: TimetableDay, period: number): [number, number] => {
    const d = days[sched.get(cs) ?? ""] ?? Object.values(days)[0]!;
    const p = (isFriday(day) ? d.friday : d.normal).periods.find((x) => x.no === period);
    return p ? [toMinutes(p.start), toMinutes(p.end)] : [100_000 + period * 10, 100_000 + period * 10 + 1];
  };
}

interface Part {
  stream: string | null;
  r: TimetableRequirement;
  tid: string;
  room: string;
  placed: number;
}

/**
 * A weekly timetable that respects every rule: no teacher or lab in two places at once (by clock time, since
 * seniors run on their own bell), at most a day's cap per teacher, a subject spread across the week. Group subjects
 * of a split class go into the same periods. Subjects with no teacher allotted are left for the office to plan.
 */
export function generateSlots(campus: CampusCode, sections: TimetableSection[], schedules: BellSchedule[], variant = 0): TimetableSlot[] {
  const DAYS: TimetableDay[] = [1, 2, 3, 4, 5, 6];
  const span = spanFinder(sections, schedules);
  const schedOf = new Map(sections.map((s) => [s.classSection, schedules.find((x) => x.id === s.scheduleId) ?? schedules[0]!]));
  const periodsFor = (cs: string, day: TimetableDay) => periodsOn(schedOf.get(cs)!, day);
  const cells = new Map<string, TimetableSlot[]>(); // class|day|period
  const busy = new Map<string, TimetableSlot[]>(); // teacher|day or lab|day
  const dayLoad = new Map<string, number>(); // teacher|day
  const subjectDay = new Map<string, number>(); // class|req|day
  const all: TimetableSlot[] = [];
  const bump = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);
  const overlaps = (list: TimetableSlot[] | undefined, a: number, b: number) => (list ?? []).find((s) => {
    const [x, y] = span(s.classSection, s.day, s.period);
    return x < b && a < y;
  });

  const put = (s: TimetableSlot) => {
    cells.set(`${s.classSection}|${s.day}|${s.period}`, [...(cells.get(`${s.classSection}|${s.day}|${s.period}`) ?? []), s]);
    if (s.teacherId) {
      busy.set(`${s.teacherId}|${s.day}`, [...(busy.get(`${s.teacherId}|${s.day}`) ?? []), s]);
      bump(dayLoad, `${s.teacherId}|${s.day}`, 1);
    }
    if (s.room.endsWith(" lab")) busy.set(`${s.room}|${s.day}`, [...(busy.get(`${s.room}|${s.day}`) ?? []), s]);
    bump(subjectDay, `${s.classSection}|${reqKey(s.subjectId, s.stream)}|${s.day}`, 1);
    all.push(s);
  };
  const take = (s: TimetableSlot) => {
    cells.set(`${s.classSection}|${s.day}|${s.period}`, (cells.get(`${s.classSection}|${s.day}|${s.period}`) ?? []).filter((x) => x !== s));
    if (s.teacherId) {
      busy.set(`${s.teacherId}|${s.day}`, (busy.get(`${s.teacherId}|${s.day}`) ?? []).filter((x) => x !== s));
      bump(dayLoad, `${s.teacherId}|${s.day}`, -1);
    }
    if (s.room.endsWith(" lab")) busy.set(`${s.room}|${s.day}`, (busy.get(`${s.room}|${s.day}`) ?? []).filter((x) => x !== s));
    bump(subjectDay, `${s.classSection}|${reqKey(s.subjectId, s.stream)}|${s.day}`, -1);
    all.splice(all.indexOf(s), 1);
  };
  const make = (cs: string, p: Part, day: TimetableDay, period: number): TimetableSlot => ({ id: slotId(cs, day, period, p.stream), classSection: cs, stream: p.stream, day, period, subjectId: p.r.subjectId, teacherId: p.tid, room: p.room });
  /** Can these lessons (one, or the groups side by side) go into this cell? `perDay` limits the same subject on one day. */
  const fits = (cs: string, parts: Part[], day: TimetableDay, period: number, perDay: number, ignore: TimetableSlot[] = []) => {
    if (period > periodsFor(cs, day) || (cells.get(`${cs}|${day}|${period}`) ?? []).some((x) => !ignore.includes(x))) return false;
    const [a, b] = span(cs, day, period);
    return parts.every(
      (p) =>
        !overlaps((busy.get(`${p.tid}|${day}`) ?? []).filter((x) => !ignore.includes(x)), a, b) &&
        (dayLoad.get(`${p.tid}|${day}`) ?? 0) < dayCapOf(p.tid) &&
        !(p.room.endsWith(" lab") && overlaps((busy.get(`${p.room}|${day}`) ?? []).filter((x) => !ignore.includes(x)), a, b)) &&
        (subjectDay.get(`${cs}|${reqKey(p.r.subjectId, p.stream)}|${day}`) ?? 0) < perDay,
    );
  };

  // A lesson is one whole-class subject, or the group subjects of a split class taught side by side.
  const lessons = sections.flatMap((sec, si) => {
    const whole = sec.requirements.filter((r) => !r.stream && r.teacherId).map((r, ri) => ({ sec, si, ri, parts: [{ stream: null, r, tid: r.teacherId!, room: labFor(r.subjectId, sec.classSection) ?? sec.room, placed: 0 }] as Part[] }));
    const byStream = sec.streams.map((st) => sec.requirements.filter((r) => r.stream === st && r.teacherId));
    const pairs = Array.from({ length: Math.max(0, ...byStream.map((x) => x.length)) }, (_, k) => ({
      sec,
      si,
      ri: whole.length + k,
      parts: byStream.flatMap((list) => (list[k] ? [{ stream: list[k]!.stream, r: list[k]!, tid: list[k]!.teacherId!, room: labFor(list[k]!.subjectId, sec.classSection) ?? sec.room, placed: 0 }] : [])) as Part[],
    }));
    return [...whole, ...pairs.filter((p) => p.parts.length)];
  });
  const load = new Map<string, number>();
  for (const L of lessons) for (const p of L.parts) bump(load, p.tid, p.r.periodsPerWeek);
  const need = new Map(sections.map((s) => [s.classSection, s.requirements.reduce((a, r) => a + (r.teacherId ? r.periodsPerWeek : 0), 0)]));
  const pinOf = (L: (typeof lessons)[number]) => campus === "KC" && L.sec.classSection === "7-B" && L.parts[0]!.r.subjectId === "mat";
  const weekOf = (L: (typeof lessons)[number]) => Math.max(...L.parts.map((p) => p.r.periodsPerWeek));
  lessons.sort((a, b) => Number(pinOf(b)) - Number(pinOf(a)) || Math.max(...b.parts.map((p) => load.get(p.tid) ?? 0)) - Math.max(...a.parts.map((p) => load.get(p.tid) ?? 0)) || (need.get(b.sec.classSection) ?? 0) - (need.get(a.sec.classSection) ?? 0) || weekOf(b) - weekOf(a));

  const missing: Array<{ sec: TimetableSection; part: Part }> = [];
  for (const L of lessons) {
    // Ms Hina Javed teaches 7-B Mathematics first thing every day (the teacher app's "7-B Mathematics 08:00").
    const pinned = pinOf(L);
    const total = weekOf(L);
    let placed = 0;
    for (let pass = 0; pass < 3 && placed < total; pass++) {
      const perDay = Math.ceil(total / 6) + pass;
      for (let k = 0; k < 6 && placed < total; k++) {
        const day = DAYS[(k + L.si + L.ri * 2 + variant) % 6]!;
        const live = L.parts.filter((p) => p.placed < p.r.periodsPerWeek);
        const prefs = pinned ? [1] : preferredPeriods(live[0]!.r.subjectId, periodsFor(L.sec.classSection, day), L.si + L.ri + placed + variant);
        const p = prefs.find((x) => fits(L.sec.classSection, live, day, x, perDay));
        if (p === undefined) continue;
        for (const part of live) {
          put(make(L.sec.classSection, part, day, p));
          part.placed++;
        }
        placed++;
      }
    }
    for (const part of L.parts) for (let i = part.placed; i < part.r.periodsPerWeek; i++) missing.push({ sec: L.sec, part });
  }

  // Repair: free the teacher in an empty cell of the class by moving their other (whole-class) lesson somewhere they can use.
  for (const { sec, part } of missing) {
    const cs = sec.classSection;
    let done = false;
    for (const day of DAYS) {
      for (let p = 1; p <= periodsFor(cs, day) && !done; p++) {
        if (fits(cs, [part], day, p, 2)) {
          put(make(cs, part, day, p));
          done = true;
          break;
        }
        if ((cells.get(`${cs}|${day}|${p}`) ?? []).length || part.stream) continue;
        if ((subjectDay.get(`${cs}|${reqKey(part.r.subjectId, null)}|${day}`) ?? 0) >= 2) continue;
        const [a, b] = span(cs, day, p);
        const blocker = overlaps(busy.get(`${part.tid}|${day}`), a, b);
        if (!blocker || blocker.stream || (campus === "KC" && blocker.classSection === "7-B" && blocker.subjectId === "mat")) continue;
        if ((busy.get(`${part.tid}|${day}`) ?? []).filter((x) => x !== blocker && overlaps([x], a, b)).length) continue;
        take(blocker);
        const bp: Part = { stream: null, r: { subjectId: blocker.subjectId, stream: null, periodsPerWeek: 0, teacherId: blocker.teacherId }, tid: blocker.teacherId!, room: blocker.room, placed: 0 };
        let moved: TimetableSlot | null = null;
        for (const d2 of DAYS) {
          for (let p2 = 1; p2 <= periodsFor(blocker.classSection, d2) && !moved; p2++) {
            if (d2 === day && p2 === p && blocker.classSection === cs) continue;
            if (fits(blocker.classSection, [bp], d2, p2, 2)) {
              moved = { ...blocker, id: slotId(blocker.classSection, d2, p2), day: d2, period: p2 };
              put(moved);
            }
          }
          if (moved) break;
        }
        if (!moved) {
          put(blocker);
          continue;
        }
        if (fits(cs, [part], day, p, 2)) {
          put(make(cs, part, day, p));
          done = true;
        }
      }
      if (done) break;
    }
  }
  return all;
}

/** Moves a whole-class slot to another cell of the same class, swapping with whatever is there. */
function swapInto(slots: TimetableSlot[], moving: TimetableSlot, day: TimetableDay, period: number): void {
  const other = slots.find((s) => s.classSection === moving.classSection && s.day === day && s.period === period);
  const from = { day: moving.day, period: moving.period };
  moving.day = day;
  moving.period = period;
  moving.id = slotId(moving.classSection, day, period);
  if (other && other !== moving) {
    other.day = from.day;
    other.period = from.period;
    other.id = slotId(other.classSection, from.day, from.period);
  }
}

/**
 * Two clashes that came across from the old timetable (it only warned and let users click "Yes"):
 * a teacher in two classes at once, and two classes booked into the computer lab at the same time.
 */
export function seedLegacyClashes(slots: TimetableSlot[], span: (cs: string, day: TimetableDay, period: number) => [number, number]): void {
  const cellOf = (cs: string, day: TimetableDay, period: number) => slots.filter((s) => s.classSection === cs && s.day === day && s.period === period);
  const over = (s: TimetableSlot, cs: string, day: TimetableDay, period: number) => {
    if (s.day !== day) return false;
    const [a, b] = span(cs, day, period);
    const [x, y] = span(s.classSection, s.day, s.period);
    return x < b && a < y;
  };
  /** Would this lesson, moved to (cs, day, period), meet its teacher or lab elsewhere? */
  const busyAt = (m: TimetableSlot, cs: string, day: TimetableDay, period: number, except: TimetableSlot[]) =>
    slots.some((s) => !except.includes(s) && over(s, cs, day, period) && ((m.teacherId && s.teacherId === m.teacherId) || (m.room.endsWith(" lab") && s.room === m.room)));
  /** Swap only when the lesson pushed out lands somewhere its own teacher and room are free (one clash, not three). */
  const cleanSwap = (y: TimetableSlot, day: TimetableDay, period: number) => {
    const there = cellOf(y.classSection, day, period);
    if (there.some((s) => s.stream) || there.length > 1) return false;
    const z = there[0];
    if (z && busyAt(z, y.classSection, y.day, y.period, [y, z])) return false;
    swapInto(slots, y, day, period);
    return true;
  };
  // 1. A teacher in 9-A and 10-A in the same period.
  outer: for (const x of slots.filter((s) => s.classSection === "9-A" && s.teacherId && !s.stream)) {
    for (const y of slots.filter((s) => s.classSection === "10-A" && s.teacherId === x.teacherId && !s.stream)) {
      if (cleanSwap(y, x.day, x.period)) break outer;
    }
  }
  // 2. Two classes in the computer lab at once, with different teachers.
  const cmp = slots.filter((s) => s.subjectId === "cmp" && !s.stream && !s.classSection.startsWith("9-") && !s.classSection.startsWith("10-"));
  for (const x of cmp) {
    for (const y of cmp.filter((s) => s.classSection !== x.classSection && s.teacherId !== x.teacherId)) {
      if (busyAt({ ...y, room: "" }, y.classSection, x.day, x.period, [y])) continue;
      if (cleanSwap(y, x.day, x.period)) return;
    }
  }
}
