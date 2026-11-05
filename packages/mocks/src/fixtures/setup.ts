import type { CampusCode, SetupMedium, SetupModuleCode, SetupSectionKind, SetupShift } from "@mtb/api";
import type { IsoDate, IsoDateTime } from "@mtb/domain";
import { ALL_SECTIONS, classTeacher, sectionSizes } from "./attendance";
import { CAMPUSES, CLASSES } from "./campuses";

/**
 * Setup fixtures still used by the unfinished modules' mocks (campuses, classes, subjects, sections, teachers and
 * campus settings). Fictional data only. Setup itself, sign-in, users, roles, sessions and the audit log are served by
 * the real backend now, so their fixtures are gone; what is left here only seeds the other modules' demo data.
 * Campus names and document prefixes come from fixtures/campuses.ts.
 */

export const CAMPUS_CODES: CampusCode[] = ["KC", "SM", "UC", "MC", "HC"];

/* ------------------------------------------------------------------ Campuses */

export interface CampusRecord {
  code: CampusCode;
  name: string;
  nameUrdu: string;
  city: string;
  address: string;
  phone: string;
  smsPhone: string;
  ownerName: string;
  foundedOn: IsoDate | null;
  phone2: string;
  mobile1: string;
  mobile2: string;
  /** Office email; missing on campuses saved before Setup had it. School-day times are not kept here: Timetable › Bell timings holds them. */
  email?: string;
  docPrefix: string;
  reportHeading: string;
  reportHeadingUrdu: string;
  isMain: boolean;
  modules: SetupModuleCode[];
  active: boolean;
  staff: number;
  rowVer: number;
  updatedAt: IsoDateTime;
  updatedBy: string;
}

const URDU_NAME: Record<CampusCode, string> = { KC: "خالد کیمپس", SM: "شوگر مل کیمپس", UC: "عبید کیمپس", MC: "مجید کیمپس", HC: "حمیرا کیمپس" };
const URDU_CITY: Partial<Record<CampusCode, string>> = { KC: "صادق آباد", HC: "لاہور" };

const ALL_MODULES: SetupModuleCode[] = [
  "STUDENTS",
  "ADMISSIONS",
  "ATTENDANCE",
  "TIMETABLE",
  "EXAMS",
  "UNIVERSITY_EXAMS",
  "ACTIVITIES",
  "FEES",
  "ACCOUNTS",
  "HR",
  "PAYROLL",
  "STAFF_ATTENDANCE",
  "LIBRARY",
  "WAREHOUSE",
  "TRANSPORT",
  "SMS",
  "PORTAL",
  "TEACHER_APP",
];
const without = (...off: SetupModuleCode[]) => ALL_MODULES.filter((m) => !off.includes(m));

/**
 * Starting module switches. Khalid Campus follows the legacy usage evidence (payroll, staff attendance devices and
 * transport have almost no data there; university exams are in use). The other campuses are placeholders to confirm.
 */
const MODULES: Record<CampusCode, SetupModuleCode[]> = {
  KC: without("PAYROLL", "STAFF_ATTENDANCE", "TRANSPORT"),
  SM: without("UNIVERSITY_EXAMS", "PAYROLL", "STAFF_ATTENDANCE", "TRANSPORT", "LIBRARY"),
  UC: without("UNIVERSITY_EXAMS", "PAYROLL", "STAFF_ATTENDANCE", "TRANSPORT"),
  MC: without("UNIVERSITY_EXAMS", "PAYROLL", "STAFF_ATTENDANCE", "TRANSPORT", "LIBRARY", "WAREHOUSE", "ACCOUNTS"),
  HC: without("PAYROLL", "TRANSPORT"),
};

const STAFF: Record<CampusCode, number> = { KC: 96, SM: 41, UC: 48, MC: 30, HC: 74 };
const PHONE: Record<CampusCode, string> = { KC: "0300-5550101", SM: "0300-5550202", UC: "0300-5550303", MC: "0300-5550404", HC: "0300-5550505" };
/** Office landlines (fictional). Khalid Campus's office number is a landline, as most campus offices have. */
const OFFICE_PHONE: Partial<Record<CampusCode, string>> = { KC: "068-5550100", HC: "042-35550500" };
/** Office emails (fictional, on the reserved .example domain). Majid Campus has none yet. */
const EMAIL: Partial<Record<CampusCode, string>> = { KC: "office.kc@mtb-school.example", SM: "office.sm@mtb-school.example", UC: "office.uc@mtb-school.example", HC: "office.hc@mtb-school.example" };
const FOUNDED: Record<CampusCode, IsoDate> = { KC: "1989-04-01", SM: "1998-04-01", UC: "2004-04-01", MC: "2011-04-01", HC: "2008-04-01" };

export function initialCampuses(): CampusRecord[] {
  return CAMPUSES.map((c) => ({
    code: c.code,
    name: c.name,
    nameUrdu: URDU_NAME[c.code],
    city: c.city,
    address: c.address,
    phone: OFFICE_PHONE[c.code] ?? PHONE[c.code],
    smsPhone: PHONE[c.code],
    ownerName: "MTB Education Trust",
    foundedOn: FOUNDED[c.code],
    phone2: c.code === "KC" ? "068-5550102" : "",
    mobile1: c.code === "KC" ? "0300-5550111" : "",
    mobile2: "",
    email: EMAIL[c.code] ?? "",
    docPrefix: c.docPrefix,
    reportHeading: `MTB — ${c.name}${c.city ? `, ${c.city}` : ""}`,
    reportHeadingUrdu: `ایم ٹی بی — ${URDU_NAME[c.code]}${URDU_CITY[c.code] ? `، ${URDU_CITY[c.code]}` : ""}`,
    isMain: c.code === "KC",
    modules: MODULES[c.code],
    active: true,
    staff: STAFF[c.code],
    rowVer: 4,
    updatedAt: "2026-10-12T11:20:00+05:00",
    updatedBy: "Kamran Yousaf",
  }));
}

/* ------------------------------------------------------------------ Classes, groups, subjects */

export interface LevelRecord {
  id: string;
  name: string;
  order: number;
  active: boolean;
  /** Degree programmes: credit hours on class subjects, batches as sections. */
  degree: boolean;
  rowVer: number;
}

/** Class levels (editable in Setup → Classes → Levels). Masters is kept but not in use yet. */
export function initialLevels(): LevelRecord[] {
  const L = (id: string, name: string, order: number, degree = false, active = true): LevelRecord => ({ id, name, order, active, degree, rowVer: 1 });
  return [
    L("lv-pre", "Pre-primary", 1),
    L("lv-pri", "Primary", 2),
    L("lv-mid", "Middle", 3),
    L("lv-sec", "Secondary (Matric)", 4),
    L("lv-int", "Intermediate (College)", 5),
    L("lv-grad", "Graduation (University)", 6, true),
    L("lv-mas", "Masters", 7, true, false),
  ];
}

export interface ClassRecord {
  id: string;
  name: string;
  short: string;
  nameUrdu: string;
  levelId: string;
  order: number;
  maxAge: number | null;
  shift: SetupShift;
  active: boolean;
  rowVer: number;
}

const CLASS_URDU = ["پریپ", "جماعت اوّل", "جماعت دوم", "جماعت سوم", "جماعت چہارم", "جماعت پنجم", "جماعت ششم", "جماعت ہفتم", "جماعت ہشتم", "جماعت نہم", "جماعت دہم"];

export function initialClasses(): ClassRecord[] {
  return [
    ...CLASSES.map(
      (c, i): ClassRecord => ({
        id: `c-${c.short.toLowerCase()}`,
        name: c.name,
        short: c.short,
        nameUrdu: CLASS_URDU[i] ?? c.name,
        levelId: i === 0 ? "lv-pre" : i <= 5 ? "lv-pri" : i <= 8 ? "lv-mid" : "lv-sec",
        order: i + 1,
        maxAge: 6 + i,
        shift: "MORNING",
        active: true,
        rowVer: 2,
      }),
    ),
    // Degree programmes at Khalid Campus (University exams). Each intake is a batch section.
    { id: "c-bscs", name: "BS Computer Science", short: "BSCS", nameUrdu: "بی ایس کمپیوٹر سائنس", levelId: "lv-grad", order: 12, maxAge: null, shift: "MORNING", active: true, rowVer: 1 },
    { id: "c-adpcs", name: "ADP Computer Science", short: "ADPCS", nameUrdu: "اے ڈی پی کمپیوٹر سائنس", levelId: "lv-grad", order: 13, maxAge: null, shift: "EVENING", active: true, rowVer: 1 },
  ];
}

export interface GroupRecord {
  id: string;
  name: string;
  short: string;
  classIds: string[];
  active: boolean;
  rowVer: number;
}

export function initialGroups(): GroupRecord[] {
  return [
    { id: "g-bio", name: "Science (Biology)", short: "Bio", classIds: ["c-9", "c-10"], active: true, rowVer: 1 },
    { id: "g-cmp", name: "Science (Computer)", short: "Comp", classIds: ["c-9", "c-10"], active: true, rowVer: 1 },
    { id: "g-hum", name: "Humanities", short: "Hum", classIds: ["c-9", "c-10"], active: true, rowVer: 1 },
  ];
}

export interface SubjectRecord {
  id: string;
  code: string;
  name: string;
  nameUrdu: string;
  medium: SetupMedium;
  order: number;
  active: boolean;
  rowVer: number;
}

const S = (id: string, name: string, nameUrdu: string, medium: SetupMedium, order: number): SubjectRecord => ({ id, code: id.toUpperCase(), name, nameUrdu, medium, order, active: true, rowVer: 1 });

export function initialSubjects(): SubjectRecord[] {
  return [
    S("eng", "English", "انگریزی", "ENGLISH", 1),
    S("urd", "Urdu", "اردو", "URDU", 2),
    S("mat", "Mathematics", "ریاضی", "ENGLISH", 3),
    S("sci", "Science", "سائنس", "ENGLISH", 4),
    S("sst", "Social Studies", "معاشرتی علوم", "ENGLISH", 5),
    S("isl", "Islamiyat", "اسلامیات", "URDU", 6),
    S("phy", "Physics", "طبیعیات", "ENGLISH", 7),
    S("che", "Chemistry", "کیمیا", "ENGLISH", 8),
    S("bio", "Biology", "حیاتیات", "ENGLISH", 9),
    S("cmp", "Computer Science", "کمپیوٹر سائنس", "ENGLISH", 10),
    S("pst", "Pakistan Studies", "مطالعہ پاکستان", "URDU", 11),
    S("tqn", "Tarjuma-tul-Quran", "ترجمۃ القرآن", "URDU", 12),
    S("naz", "Nazra Quran", "ناظرہ قرآن", "URDU", 13),
    S("gk", "General Knowledge", "معلومات عامہ", "ENGLISH", 14),
    { ...S("drw", "Drawing", "ڈرائنگ", "ENGLISH", 15) },
    { ...S("chn", "Chinese language", "چینی زبان", "ENGLISH", 16), active: false },
  ];
}

/**
 * Degree-programme courses this semester (Setup's own list; school modules keep using initialSubjects).
 * Ids match the University exams course ids, so semester GPA reads its credit hours from Setup.
 */
export const DEGREE_COURSES: Array<{ id: string; name: string; classId: string; creditHours: number }> = [
  { id: "cs301", name: "Data Structures and Algorithms", classId: "c-bscs", creditHours: 4 },
  { id: "cs302", name: "Database Systems", classId: "c-bscs", creditHours: 4 },
  { id: "cs303", name: "Computer Organization", classId: "c-bscs", creditHours: 3 },
  { id: "mt301", name: "Probability and Statistics", classId: "c-bscs", creditHours: 3 },
  { id: "ss301", name: "Professional Practices", classId: "c-bscs", creditHours: 2 },
  { id: "cs111", name: "Introduction to ICT", classId: "c-adpcs", creditHours: 3 },
  { id: "cs112", name: "Programming Fundamentals", classId: "c-adpcs", creditHours: 4 },
  { id: "mt111", name: "Basic Mathematics", classId: "c-adpcs", creditHours: 3 },
  { id: "en111", name: "English Composition", classId: "c-adpcs", creditHours: 3 },
  { id: "is111", name: "Islamic Studies", classId: "c-adpcs", creditHours: 2 },
];

export function initialCourseSubjects(): SubjectRecord[] {
  return DEGREE_COURSES.map((c, i) => ({ id: c.id, code: c.id.toUpperCase(), name: c.name, nameUrdu: "", medium: "ENGLISH", order: 17 + i, active: true, rowVer: 1 }));
}

export const PERIODS: Record<string, number> = { eng: 6, urd: 6, mat: 6, sci: 5, sst: 4, isl: 3, phy: 5, che: 5, bio: 5, cmp: 3, pst: 3, tqn: 2, naz: 4, gk: 2, drw: 2, chn: 2 };

export interface ClassSubjectRow {
  subjectId: string;
  maxMarks: number;
  passMarks: number;
  periodsPerWeek: number;
  /** 0 for school classes; degree courses need at least 1. Older stored rows may not have it. */
  creditHours?: number;
  order: number;
  optional: boolean;
}

export interface ClassSubjectsRecord {
  /** `${classId}|${groupId ?? ""}` */
  key: string;
  classId: string;
  groupId: string | null;
  subjects: ClassSubjectRow[];
  rowVer: number;
  updatedAt: IsoDateTime;
  updatedBy: string;
}

/** 33% to pass, rounded up. */
export const passFor = (max: number) => Math.ceil(max * 0.33);

const rows = (list: Array<[string, number]>, optional: string[] = []): ClassSubjectRow[] =>
  list.map(([subjectId, maxMarks], i) => ({ subjectId, maxMarks, passMarks: passFor(maxMarks), periodsPerWeek: PERIODS[subjectId] ?? 3, order: i + 1, optional: optional.includes(subjectId) }));

export function initialClassSubjects(): ClassSubjectsRecord[] {
  const rec = (classId: string, groupId: string | null, subjects: ClassSubjectRow[], updatedAt: IsoDateTime = "2026-03-20T12:00:00+05:00", updatedBy = "Kamran Yousaf"): ClassSubjectsRecord => ({
    key: `${classId}|${groupId ?? ""}`,
    classId,
    groupId,
    subjects,
    rowVer: 3,
    updatedAt,
    updatedBy,
  });
  const early: Array<[string, number]> = [["eng", 100], ["urd", 100], ["mat", 100], ["gk", 50], ["isl", 50], ["naz", 50], ["drw", 50]];
  const upperPrimary: Array<[string, number]> = [["eng", 100], ["urd", 100], ["mat", 100], ["sci", 100], ["sst", 100], ["isl", 100], ["cmp", 50]];
  const middle: Array<[string, number]> = [["eng", 100], ["urd", 100], ["mat", 100], ["sci", 100], ["sst", 100], ["isl", 100]];
  const matric = (third: "isl" | "pst", stream: "bio" | "cmp"): Array<[string, number]> => [["eng", 75], ["urd", 75], [third, 50], ["mat", 75], ["phy", 65], ["che", 65], [stream, 65], ["tqn", 50]];
  return [
    rec("c-prep", null, rows([["eng", 50], ["urd", 50], ["mat", 50], ["gk", 50], ["naz", 50], ["drw", 25]])),
    ...["c-1", "c-2", "c-3"].map((c) => rec(c, null, rows(early, ["drw"]))),
    ...["c-4", "c-5"].map((c) => rec(c, null, rows(upperPrimary, ["cmp"]))),
    ...["c-6", "c-7", "c-8"].map((c) => rec(c, null, rows(middle))),
    rec("c-9", "g-bio", rows(matric("isl", "bio")), "2026-10-21T15:10:00+05:00"),
    rec("c-9", "g-cmp", rows(matric("isl", "cmp")), "2026-10-21T15:12:00+05:00"),
    rec("c-10", "g-bio", rows(matric("pst", "bio"))),
    rec("c-10", "g-cmp", rows(matric("pst", "cmp"))),
  ];
}

/** This semester's courses for the degree programmes: 100 marks (20 sessional, 30 mid, 50 final), 50 to pass. */
export function initialDegreeClassSubjects(): ClassSubjectsRecord[] {
  return ["c-bscs", "c-adpcs"].map((classId) => ({
    key: `${classId}|`,
    classId,
    groupId: null,
    subjects: DEGREE_COURSES.filter((c) => c.classId === classId).map((c, i) => ({ subjectId: c.id, maxMarks: 100, passMarks: 50, periodsPerWeek: c.creditHours, creditHours: c.creditHours, order: i + 1, optional: false })),
    rowVer: 2,
    updatedAt: "2026-09-01T09:00:00+05:00",
    updatedBy: "Kamran Yousaf",
  }));
}

/* ------------------------------------------------------------------ Sections and teachers */

export interface SectionRecord {
  id: string;
  campus: CampusCode;
  session: number;
  classId: string;
  name: string;
  groupId: string | null;
  seats: number;
  room: string;
  strength: number;
  classTeacherId: string | null;
  active: boolean;
  /** Missing on older records: a SECTION. */
  kind?: SetupSectionKind;
  rowVer: number;
}

export interface TeacherRecord {
  id: string;
  name: string;
  campus: CampusCode;
  subjectIds: string[];
}

const slug = (s: string) => s.toLowerCase().replace(/^(mr|ms|mrs|dr)\s+/, "").replace(/[^a-z]+/g, "-").replace(/(^-|-$)/g, "");
export const teacherId = (campus: CampusCode, name: string) => `t-${campus.toLowerCase()}-${slug(name)}`;

/** Upper classes at the smaller campuses (not in today's attendance registers, which list the first few sections only). */
const EXTRA_UPPER: Partial<Record<CampusCode, Record<string, number>>> = {
  SM: { "9-A": 31, "10-A": 28 },
  UC: { "9-A": 38, "10-A": 35 },
  MC: { "9-A": 24, "10-A": 22 },
  HC: { "9-A": 41, "10-A": 39, "9-B": 36, "10-B": 33 },
};

/** Sections per campus in the attendance order, with today's strengths. */
export function campusSections(campus: CampusCode): Array<{ label: string; strength: number; teacher: string }> {
  const sizes = sectionSizes(campus);
  const base = ALL_SECTIONS.filter((s) => s in sizes).map((label, i) => ({ label, strength: sizes[label] ?? 0, teacher: classTeacher(campus, label, i) }));
  const extra = Object.entries(EXTRA_UPPER[campus] ?? {})
    .filter(([label]) => !(label in sizes))
    .map(([label, strength], i) => ({ label, strength, teacher: classTeacher(campus, label, base.length + i + 3) }));
  return [...base, ...extra];
}

const SUBJECT_ROTATION: string[][] = [
  ["eng", "sst"],
  ["urd", "isl"],
  ["mat", "sci"],
  ["sci", "gk"],
  ["eng", "drw"],
  ["mat", "cmp"],
  ["urd", "naz"],
  ["isl", "sst"],
];

const NAMED_SUBJECTS: Record<string, string[]> = {
  "Ms Hina Javed": ["mat", "sci"],
  "Mr Adeel Anwar": ["eng", "sst", "isl"],
  "Ms Sana Tariq": ["eng", "urd", "sci"],
};

const SPECIALISTS: Record<CampusCode, Array<[string, string[]]>> = {
  KC: [
    ["Mr Kashif Nadeem", ["cmp", "mat"]],
    ["Ms Ambreen Saleem", ["phy", "che"]],
    ["Ms Rukhsana Bibi", ["bio", "sci"]],
    ["Mr Ehsan Ullah", ["isl", "tqn", "naz", "pst"]],
    ["Ms Nighat Perveen", ["drw", "gk"]],
  ],
  SM: [
    ["Mr Adnan Sabir", ["cmp", "mat", "phy"]],
    ["Ms Hafsa Noreen", ["isl", "naz", "tqn", "che", "bio", "pst"]],
  ],
  UC: [
    ["Mr Ghulam Murtaza", ["phy", "che", "mat"]],
    ["Ms Aqsa Jabeen", ["bio", "sci", "tqn", "pst"]],
  ],
  MC: [["Mr Riaz Ahmad", ["isl", "naz", "tqn", "phy", "che", "bio", "pst"]]],
  HC: [
    ["Ms Sadaf Iqbal", ["cmp", "mat"]],
    ["Mr Nadeem Abbas", ["phy", "che", "pst"]],
    ["Ms Farhat Naz", ["bio", "tqn", "isl"]],
  ],
};

export function initialTeachers(): TeacherRecord[] {
  const out: TeacherRecord[] = [];
  for (const campus of CAMPUS_CODES) {
    const seen = new Set<string>();
    campusSections(campus).forEach((s, i) => {
      const id = teacherId(campus, s.teacher);
      if (seen.has(id)) return;
      seen.add(id);
      out.push({ id, name: s.teacher, campus, subjectIds: NAMED_SUBJECTS[s.teacher] ?? SUBJECT_ROTATION[i % SUBJECT_ROTATION.length]! });
    });
    for (const [name, subjectIds] of SPECIALISTS[campus]) out.push({ id: teacherId(campus, name), name, campus, subjectIds });
  }
  return out;
}

const classIdOf = (label: string) => `c-${label.split("-")[0]!.toLowerCase()}`;
const sectionNameOf = (label: string) => label.split("-")[1]!;
const groupOf = (label: string): string | null => (label.startsWith("9-") || label.startsWith("10-") ? (sectionNameOf(label) === "A" ? "g-bio" : "g-cmp") : null);
const seatsFor = (strength: number) => Math.max(30, Math.ceil((strength + 2) / 5) * 5);

/** Current and last session's sections at every campus. One section at Ubaid Campus has no class teacher yet. */
export function initialSections(): SectionRecord[] {
  const out: SectionRecord[] = [];
  for (const campus of CAMPUS_CODES) {
    const list = campusSections(campus);
    list.forEach((s, i) => {
      for (const session of [2026, 2025]) {
        const strength = session === 2026 ? s.strength : Math.round(s.strength * 0.96);
        const missingTeacher = session === 2026 && campus === "UC" && i === list.length - 1;
        out.push({
          id: `${campus}-${session}-${s.label}`,
          campus,
          session,
          classId: classIdOf(s.label),
          name: sectionNameOf(s.label),
          groupId: groupOf(s.label),
          seats: seatsFor(s.strength),
          room: `Room ${String(i + 1).padStart(2, "0")}`,
          strength,
          classTeacherId: missingTeacher ? null : teacherId(campus, s.teacher),
          active: true,
          rowVer: 2,
        });
      }
    });
  }
  return out;
}

/** Degree-programme lecturers at Khalid Campus (Setup's teacher list only; they teach the courses above). */
export function initialDegreeTeachers(): TeacherRecord[] {
  const T = (name: string, subjectIds: string[]): TeacherRecord => ({ id: teacherId("KC", name), name, campus: "KC", subjectIds });
  return [T("Ms Mehreen Aslam", ["cs301", "cs112"]), T("Mr Junaid Akram", ["mt301", "mt111"]), T("Ms Rubina Kausar", ["ss301", "en111"]), T("Mr Asad Ullah", ["is111"]), T("Dr Saima Rafique", ["cs303", "cs302", "cs111"])];
}

/**
 * Sections beyond the attendance registers: a word-named section (legacy section titles are often words) and one batch
 * per degree programme at Khalid Campus, this session.
 */
export function initialExtraSections(): SectionRecord[] {
  const S = (classId: string, name: string, kind: SetupSectionKind, seats: number, room: string, strength: number, teacher: string): SectionRecord => ({
    id: `KC-2026-${classId.slice(2).toUpperCase()}-${name.replace(/[^A-Za-z0-9]+/g, "")}`,
    campus: "KC",
    session: 2026,
    classId,
    name,
    groupId: null,
    seats,
    room,
    strength,
    classTeacherId: teacherId("KC", teacher),
    active: true,
    kind,
    rowVer: 1,
  });
  return [
    S("c-prep", "Yellow", "SECTION", 30, "Room 24", 0, "Ms Nighat Perveen"),
    S("c-bscs", "Batch 2025", "BATCH", 50, "Computer Lab 1", 22, "Mr Kashif Nadeem"),
    S("c-adpcs", "Batch 2026", "BATCH", 40, "Computer Lab 2", 16, "Ms Mehreen Aslam"),
  ];
}

/** Subject teachers for current sections: sectionId → subjectId → teacherId (or null). */
export function initialSubjectTeachers(sections: SectionRecord[], teachers: TeacherRecord[], classSubjects: ClassSubjectsRecord[]): Record<string, Record<string, string | null>> {
  const out: Record<string, Record<string, string | null>> = {};
  const gaps = new Set(["KC-2026-9-B:cmp", "KC-2026-Prep-B:drw", "SM-2026-6-A:sci"]);
  const current = sections.filter((s) => s.session === 2026);
  const rowsOf = (s: SectionRecord) => classSubjects.find((cs) => cs.classId === s.classId && cs.groupId === s.groupId)?.subjects ?? [];
  const load = new Map<string, number>();
  const give = (s: SectionRecord, row: ClassSubjectRow, id: string | null) => {
    out[s.id] = { ...out[s.id], [row.subjectId]: id };
    if (id) load.set(id, (load.get(id) ?? 0) + row.periodsPerWeek);
  };
  // First pass: class teachers take the subjects they teach in their own section (up to 30 periods a week).
  for (const s of current) {
    out[s.id] = {};
    for (const row of rowsOf(s)) {
      if (gaps.has(`${s.id}:${row.subjectId}`)) continue;
      const own = teachers.find((t) => t.id === s.classTeacherId && t.subjectIds.includes(row.subjectId));
      if (own && (load.get(own.id) ?? 0) + row.periodsPerWeek <= 30) give(s, row, own.id);
    }
  }
  // Second pass: everything else goes to the least-loaded qualified teacher at the campus.
  for (const s of current) {
    for (const row of rowsOf(s)) {
      if (row.subjectId in (out[s.id] ?? {})) continue;
      if (gaps.has(`${s.id}:${row.subjectId}`)) {
        give(s, row, null);
        continue;
      }
      const pool = teachers.filter((t) => t.campus === s.campus && t.subjectIds.includes(row.subjectId)).sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || a.id.localeCompare(b.id));
      give(s, row, pool[0]?.id ?? null);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ Campus settings */

export interface SettingDef {
  key: string;
  group: "Messages" | "Receipts" | "Fee vouchers";
  label: string;
  help: string;
  type: "text" | "textUrdu" | "longText" | "longTextUrdu" | "choice" | "switch";
  options?: Array<{ value: string; label: string }>;
  maxLength?: number;
  defaultValue: string;
}

export const SETTING_DEFS: SettingDef[] = [
  { key: "sms.senderName", group: "Messages", label: "SMS sender name", help: "Shown as the sender on parents' phones. Up to 11 letters or numbers, as the SMS company allows.", type: "text", maxLength: 11, defaultValue: "MTB" },
  { key: "sms.signature", group: "Messages", label: "Message signature", help: "Added at the end of every message from this campus.", type: "text", maxLength: 40, defaultValue: "Regards, MTB" },
  {
    key: "sms.language",
    group: "Messages",
    label: "Language for automatic messages",
    help: "Absence, fee reminder and result messages use this language unless a template says otherwise.",
    type: "choice",
    options: [
      { value: "en", label: "English" },
      { value: "ur", label: "Urdu" },
      { value: "both", label: "English and Urdu" },
    ],
    defaultValue: "both",
  },
  { key: "receipt.footer", group: "Receipts", label: "Receipt footer", help: "Printed at the bottom of every fee receipt.", type: "longText", maxLength: 160, defaultValue: "Fee once paid is not refundable or transferable. Please keep this receipt safe." },
  { key: "receipt.footerUrdu", group: "Receipts", label: "Receipt footer in Urdu", help: "Printed under the English footer.", type: "longTextUrdu", maxLength: 160, defaultValue: "ادا شدہ فیس ناقابلِ واپسی اور ناقابلِ منتقلی ہے۔ براہِ کرم یہ رسید سنبھال کر رکھیں۔" },
  { key: "receipt.showCashier", group: "Receipts", label: "Print the cashier's name on receipts", help: "Parents can see who took the payment.", type: "switch", defaultValue: "true" },
  {
    key: "receipt.policyNotes",
    group: "Receipts",
    label: "Notes printed on receipts",
    help: "Fee rules parents should see, one note per line. Printed above the receipt footer.",
    type: "longText",
    maxLength: 400,
    defaultValue: "Fee once paid is not refundable.\nA scholarship or concession continues only while the student keeps the required marks, attendance and conduct.",
  },
  {
    key: "voucher.copies",
    group: "Fee vouchers",
    label: "Copies on each voucher",
    help: "How many tear-off copies print on one page.",
    type: "choice",
    options: [
      { value: "1", label: "One copy" },
      { value: "2", label: "Two copies" },
      { value: "3", label: "Three copies" },
    ],
    defaultValue: "3",
  },
  { key: "voucher.copyLabels", group: "Fee vouchers", label: "Copy labels", help: "Separate with a middle dot (·), one label per copy.", type: "text", maxLength: 60, defaultValue: "Bank copy · School copy · Parent copy" },
  { key: "voucher.title", group: "Fee vouchers", label: "School name on vouchers", help: "Printed above the bank details.", type: "text", maxLength: 60, defaultValue: "MTB" },
  { key: "voucher.bankName", group: "Fee vouchers", label: "Bank and branch", help: "Where parents deposit fees.", type: "text", maxLength: 60, defaultValue: "" },
  { key: "voucher.accountTitle", group: "Fee vouchers", label: "Account title", help: "Exactly as the bank has it.", type: "text", maxLength: 60, defaultValue: "" },
  { key: "voucher.accountNo", group: "Fee vouchers", label: "Account number", help: "Printed on every voucher. Check it twice.", type: "text", maxLength: 30, defaultValue: "" },
];

export function initialCampusSettings(): Record<CampusCode, Record<string, string>> {
  return {
    KC: {
      "voucher.title": "MTB Khalid Campus, Sadiqabad",
      "voucher.bankName": "Meezan Bank, Sadiqabad Branch",
      "voucher.accountTitle": "MTB Khalid Campus Fee Collection",
      "voucher.accountNo": "0101-0012345678",
    },
    SM: { "voucher.bankName": "HBL, Sugar Mill Branch", "voucher.accountTitle": "MTB Sugar Mill Campus", "voucher.accountNo": "0202-0023456789", "voucher.copies": "2", "voucher.copyLabels": "Bank copy · Parent copy" },
    UC: { "voucher.bankName": "UBL, Main Branch", "voucher.accountTitle": "MTB Ubaid Campus", "voucher.accountNo": "0303-0034567890" },
    MC: { "sms.senderName": "MTB Country", "sms.signature": "Regards, MTB Country", "sms.language": "ur", "voucher.bankName": "National Bank of Pakistan", "voucher.accountTitle": "MTB Majeed Campus", "voucher.accountNo": "0404-0045678901" },
    HC: { "voucher.title": "MTB Humaira Campus, Lahore", "voucher.bankName": "Bank Alfalah, Lahore", "voucher.accountTitle": "MTB Humaira Campus", "voucher.accountNo": "0505-0056789012" },
  };
}

/* ------------------------------------------------------------------ Shared with other mocks */

/** Credit hours per subject id from the class-subject fixtures (degree courses); University exams weight GPA by them. */
export function setupCreditHours(): Map<string, number> {
  const out = new Map<string, number>();
  for (const cs of [...initialClassSubjects(), ...initialDegreeClassSubjects()]) for (const r of cs.subjects) if ((r.creditHours ?? 0) > 0 && !out.has(r.subjectId)) out.set(r.subjectId, r.creditHours!);
  return out;
}
