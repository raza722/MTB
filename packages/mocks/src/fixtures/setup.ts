import type {
  CampusCode,
  CampusScope,
  Permission,
  RoleCode,
  SetupAuditEntry,
  SetupMedium,
  SetupModuleCode,
  SetupSectionKind,
  SetupSessionStatus,
  SetupShift,
  SetupSignIn,
  SetupUserStatus,
} from "@mtb/api";
import type { IsoDate, IsoDateTime } from "@mtb/domain";
import { ALL_SECTIONS, classTeacher, sectionSizes } from "./attendance";
import { CAMPUSES, CLASSES } from "./campuses";
import { CUSTOM_ROLES, ROLE_PERMISSIONS, USERS } from "./users";

/**
 * Setup and user management fixtures — owned by the setup feature. Fictional data only.
 * Campus names and document prefixes come from fixtures/campuses.ts; demo accounts from fixtures/users.ts
 * (copied into Setup's editable users store, which sign-in reads: locks, disabling, password resets and role
 * changes made in Setup apply at the next sign-in or page).
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

/* ------------------------------------------------------------------ Sessions */

export interface SessionRecord {
  startYear: number;
  status: SetupSessionStatus;
  startsOn: IsoDate;
  endsOn: IsoDate;
  /** Campuses whose dates differ from the session's. */
  campusDates: Partial<Record<CampusCode, { startsOn: IsoDate; endsOn: IsoDate }>>;
  /** Kept counts for sessions without section records here (closed, from the old system). */
  archived?: Partial<Record<CampusCode, { sections: number; students: number }>>;
  createdAt: IsoDateTime;
  createdBy: string;
  closedAt: IsoDateTime | null;
  closedBy: string | null;
  rowVer: number;
}

const archived = (k: number): SessionRecord["archived"] => ({
  KC: { sections: 23, students: Math.round(1418 * k) },
  SM: { sections: 15, students: Math.round(731 * k) },
  UC: { sections: 17, students: Math.round(842 * k) },
  MC: { sections: 10, students: Math.round(497 * k) },
  HC: { sections: 21, students: Math.round(1155 * k) },
});

export function initialSessions(): SessionRecord[] {
  return [
    {
      startYear: 2026,
      status: "CURRENT",
      startsOn: "2026-04-01",
      endsOn: "2027-03-31",
      campusDates: { HC: { startsOn: "2026-04-06", endsOn: "2027-03-31" } },
      createdAt: "2026-02-18T10:05:00+05:00",
      createdBy: "Kamran Yousaf",
      closedAt: null,
      closedBy: null,
      rowVer: 6,
    },
    {
      startYear: 2025,
      status: "ENDED",
      startsOn: "2025-04-01",
      endsOn: "2026-03-31",
      campusDates: {},
      createdAt: "2025-02-20T09:30:00+05:00",
      createdBy: "Kamran Yousaf",
      closedAt: null,
      closedBy: null,
      rowVer: 9,
    },
    ...[2024, 2023, 2022].map(
      (y, i): SessionRecord => ({
        startYear: y,
        status: "CLOSED",
        startsOn: `${y}-04-01`,
        endsOn: `${y + 1}-03-31`,
        campusDates: {},
        archived: archived(0.97 - i * 0.03),
        createdAt: `${y}-02-15T10:00:00+05:00`,
        createdBy: "Migrated from the old system",
        closedAt: `${y + 1}-04-30T16:00:00+05:00`,
        closedBy: i === 0 ? "Kamran Yousaf" : "Migrated from the old system",
        rowVer: 12,
      }),
    ),
  ];
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

/* ------------------------------------------------------------------ Roles */

export interface RoleRecord {
  id: string;
  code: string;
  name: string;
  description: string;
  system: boolean;
  scope: "CAMPUS" | "ANY";
  permissions: Permission[];
  twoStepRequired: boolean;
  rowVer: number;
  updatedAt: IsoDateTime;
  updatedBy: string;
}

export const ROLE_ID: Record<RoleCode, string> & Record<string, string> = {
  PRINCIPAL: "role-principal",
  CASHIER: "role-cashier",
  ACCOUNTANT: "role-accountant",
  ADMIN: "role-admin",
  TEACHER: "role-teacher",
  OFFICE: "role-office",
  ...Object.fromEntries(CUSTOM_ROLES.map((r) => [r.code, r.id])),
};

const SYSTEM_ROLES: Array<[RoleCode, string, string, "CAMPUS" | "ANY", boolean]> = [
  ["ADMIN", "Admin", "Head-office administrator: campuses, sessions, users, roles and every module.", "ANY", true],
  ["PRINCIPAL", "Principal", "Runs one campus: approvals, results, admissions, staff and that campus's users.", "CAMPUS", true],
  ["ACCOUNTANT", "Accountant", "Keeps the accounts, fee structure and payroll. Usually head office.", "ANY", true],
  ["CASHIER", "Cashier", "Collects fees at the counter, prints receipts and asks for cancellations.", "CAMPUS", true],
  ["OFFICE", "Office staff", "Front office: admissions, student records, library, store and transport.", "CAMPUS", false],
  ["TEACHER", "Teacher", "Marks attendance and enters marks for their own classes from the teacher app.", "CAMPUS", false],
];

export function initialRoles(): RoleRecord[] {
  return [
    ...SYSTEM_ROLES.map(([code, name, description, scope, twoStep]) => ({
      id: ROLE_ID[code],
      code,
      name,
      description,
      system: true,
      scope,
      permissions: [...ROLE_PERMISSIONS[code]],
      twoStepRequired: twoStep,
      rowVer: 1,
      updatedAt: "2026-02-01T09:00:00+05:00",
      updatedBy: "System",
    })),
    ...CUSTOM_ROLES.map((r) => ({
      ...r,
      permissions: [...r.permissions],
      system: false,
      rowVer: r.code === "EXAM_OFFICE" ? 3 : 1,
      updatedAt: r.code === "EXAM_OFFICE" ? "2026-10-12T10:35:00+05:00" : "2026-10-28T11:00:00+05:00",
      updatedBy: "Kamran Yousaf",
    })),
  ];
}

/* ------------------------------------------------------------------ Users */

export interface UserRecord {
  id: string;
  username: string;
  name: string;
  mobile: string;
  email: string | null;
  staffNo: string | null;
  status: SetupUserStatus;
  grants: Array<{ roleId: string; campus: CampusScope }>;
  twoStep: boolean;
  mustChangePassword: boolean;
  lastSignInAt: IsoDateTime | null;
  lastSignInDevice: string | null;
  failedAttempts: number;
  lockedAt: IsoDateTime | null;
  disabledReason: string | null;
  passwordChangedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  createdBy: string;
  updatedAt: IsoDateTime;
  updatedBy: string;
  rowVer: number;
  signIns: SetupSignIn[];
}

const OFFICE_PC = "Chrome on Windows";
const PHONE_APP = "Teacher app on Android";

function history(seed: number, lastAt: IsoDateTime | null, device: string, place: string): SetupSignIn[] {
  if (!lastAt) return [];
  const out: SetupSignIn[] = [{ at: lastAt, outcome: "SUCCESS", device, place }];
  const days = ["2026-11-03", "2026-11-02", "2026-10-31", "2026-10-30", "2026-10-29"];
  days.forEach((d, i) => {
    const hh = 7 + ((seed + i) % 3);
    const mm = (seed * 7 + i * 13) % 60;
    const at = `${d}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+05:00`;
    if ((seed + i) % 6 === 4) out.push({ at, outcome: "WRONG_PASSWORD", device, place });
    out.push({ at, outcome: "SUCCESS", device, place });
  });
  return out.slice(0, 6);
}

interface UserSeed {
  id: string;
  username: string;
  name: string;
  mobile: string;
  staffNo: string;
  grants: Array<[string, CampusScope]>;
  twoStep: boolean;
  last: IsoDateTime | null;
  device?: string;
  status?: SetupUserStatus;
  mustChange?: boolean;
  disabledReason?: string;
  createdAt?: IsoDateTime;
}

const campusPlace = (campus: CampusScope) => (campus === "ALL" ? "Head office" : `${CAMPUSES.find((c) => c.code === campus)?.name ?? campus} office`);

const DEMO_EXTRA: Record<string, Pick<UserSeed, "staffNo" | "last" | "device">> = {
  "u-usman": { staffNo: "KC-S-0217", last: "2026-11-04T08:02:00+05:00" },
  "u-sadia": { staffNo: "KC-S-0009", last: "2026-11-04T07:55:00+05:00" },
  "u-nadia": { staffNo: "HO-S-0031", last: "2026-11-03T16:48:00+05:00" },
  "u-kamran": { staffNo: "HO-S-0004", last: "2026-11-04T07:40:00+05:00" },
  "u-hina": { staffNo: "KC-T-0142", last: null },
  "u-farah": { staffNo: "KC-S-0188", last: "2026-11-04T08:10:00+05:00" },
  "u-saima": { staffNo: "KC-T-0088", last: "2026-11-04T09:12:00+05:00" },
  "u-rehana": { staffNo: "KC-S-0012", last: "2026-11-03T13:05:00+05:00" },
};

const EXTRA_USERS: UserSeed[] = [
  { id: "u-adeel", username: "adeel.anwar", name: "Mr Adeel Anwar", mobile: "0307-5550133", staffNo: "KC-T-0118", grants: [["role-teacher", "KC"]], twoStep: false, last: "2026-11-04T07:58:00+05:00", device: PHONE_APP },
  { id: "u-sana", username: "sana.tariq", name: "Ms Sana Tariq", mobile: "0308-5550147", staffNo: "KC-T-0151", grants: [["role-teacher", "KC"]], twoStep: false, last: "2026-11-04T08:01:00+05:00", device: PHONE_APP },
  { id: "u-rabia", username: "rabia.nasir", name: "Ms Rabia Nasir", mobile: "0309-5550129", staffNo: "KC-T-0097", grants: [["role-teacher", "KC"]], twoStep: false, last: "2026-11-04T07:51:00+05:00", device: PHONE_APP },
  { id: "u-imran-s", username: "imran.shafiq", name: "Mr Imran Shafiq", mobile: "0310-5550175", staffNo: "KC-T-0104", grants: [["role-teacher", "KC"]], twoStep: true, last: "2026-11-03T13:40:00+05:00", device: PHONE_APP },
  { id: "u-nida", username: "nida.hussain", name: "Ms Nida Hussain", mobile: "0311-5550162", staffNo: "KC-T-0126", grants: [["role-teacher", "KC"]], twoStep: false, last: "2026-11-03T07:49:00+05:00", device: PHONE_APP, status: "LOCKED" },
  { id: "u-fahad", username: "fahad.iqbal", name: "Mr Fahad Iqbal", mobile: "0313-5550191", staffNo: "KC-T-0133", grants: [["role-teacher", "KC"], ["role-teacher", "SM"]], twoStep: false, last: "2026-11-04T07:46:00+05:00", device: PHONE_APP },
  { id: "u-mehwish", username: "mehwish.anjum", name: "Ms Mehwish Anjum", mobile: "0314-5550154", staffNo: "KC-T-0166", grants: [["role-teacher", "KC"]], twoStep: false, last: null, status: "INVITED", createdAt: "2026-11-02T11:15:00+05:00" },
  { id: "u-sohail", username: "sohail.ahmed", name: "Mr Sohail Ahmed", mobile: "0315-5550112", staffNo: "KC-S-0172", grants: [["role-cashier", "KC"]], twoStep: true, last: "2026-09-29T15:20:00+05:00", status: "DISABLED", disabledReason: "Left the school on 30-Sep-2026" },
  { id: "u-faisal", username: "faisal.mehmood", name: "Mr Faisal Mehmood", mobile: "0316-5550140", staffNo: "SM-S-0003", grants: [["role-principal", "SM"]], twoStep: true, last: "2026-11-04T08:20:00+05:00" },
  { id: "u-asif", username: "asif.raza", name: "Mr Asif Raza", mobile: "0317-5550186", staffNo: "SM-S-0021", grants: [["role-cashier", "SM"]], twoStep: true, last: "2026-11-04T08:31:00+05:00" },
  { id: "u-nasreen", username: "nasreen.akhtar", name: "Mrs Nasreen Akhtar", mobile: "0318-5550125", staffNo: "UC-S-0002", grants: [["role-principal", "UC"]], twoStep: true, last: "2026-11-04T08:05:00+05:00" },
  { id: "u-shabana", username: "shabana.kausar", name: "Ms Shabana Kausar", mobile: "0319-5550137", staffNo: "UC-S-0019", grants: [["role-cashier", "UC"]], twoStep: true, last: "2026-11-04T08:44:00+05:00" },
  { id: "u-naeem", username: "naeem.akhtar", name: "Mr Naeem Akhtar", mobile: "0320-5550158", staffNo: "UC-S-0026", grants: [["role-office", "UC"]], twoStep: false, last: "2026-11-03T12:02:00+05:00" },
  { id: "u-zahid", username: "zahid.hussain", name: "Mr Zahid Hussain", mobile: "0321-5550144", staffNo: "MC-S-0001", grants: [["role-principal", "MC"]], twoStep: false, last: "2026-11-02T09:10:00+05:00" },
  { id: "u-ghazala", username: "ghazala.parveen", name: "Ms Ghazala Parveen", mobile: "0322-5550171", staffNo: "MC-S-0011", grants: [["role-cashier", "MC"]], twoStep: true, last: "2026-11-04T09:02:00+05:00" },
  { id: "u-ambreen", username: "ambreen.fatima", name: "Dr Ambreen Fatima", mobile: "0323-5550116", staffNo: "HC-S-0001", grants: [["role-principal", "HC"]], twoStep: true, last: "2026-11-04T08:15:00+05:00" },
  { id: "u-tahir", username: "tahir.mahmood", name: "Mr Tahir Mahmood", mobile: "0324-5550193", staffNo: "HC-S-0014", grants: [["role-accountant", "HC"]], twoStep: true, last: "2026-11-03T15:05:00+05:00" },
  { id: "u-kiran", username: "kiran.javaid", name: "Ms Kiran Javaid", mobile: "0325-5550128", staffNo: "HC-T-0072", grants: [["role-teacher", "HC"]], twoStep: false, last: "2026-11-04T07:52:00+05:00", device: PHONE_APP },
  // Left the school at the end of August (Staff & payroll) but her account was never disabled: "Staff has left" finds it.
  { id: "u-atiya", username: "atiya.rasheed", name: "Ms Atiya Rasheed", mobile: "0326-5550139", staffNo: "KC-T-0062", grants: [["role-teacher", "KC"]], twoStep: false, last: "2026-08-29T13:20:00+05:00", device: PHONE_APP },
];

function fromSeed(s: UserSeed, i: number): UserRecord {
  const first = s.grants[0]?.[1] ?? "KC";
  const device = s.device ?? OFFICE_PC;
  const place = device === PHONE_APP ? "Mobile data" : campusPlace(first);
  const stale = s.last !== null && s.last < "2026-10-29";
  let signIns: SetupSignIn[] = (s.status === "DISABLED" || stale) && s.last ? [{ at: s.last, outcome: "SUCCESS" as const, device, place }] : history(i + 3, s.last, device, place);
  if (s.status === "LOCKED") {
    const locked = [8, 9, 10, 11, 12].map((m): SetupSignIn => ({ at: `2026-11-04T08:${String(m).padStart(2, "0")}:00+05:00`, outcome: "WRONG_PASSWORD", device, place }));
    const lockedAt: SetupSignIn = { at: "2026-11-04T08:12:30+05:00", outcome: "LOCKED", device, place };
    signIns = [lockedAt, ...locked.reverse(), ...signIns].slice(0, 8);
  }
  return {
    id: s.id,
    username: s.username,
    name: s.name,
    mobile: s.mobile,
    email: null,
    staffNo: s.staffNo,
    status: s.status ?? "ACTIVE",
    grants: s.grants.map(([roleId, campus]) => ({ roleId, campus })),
    twoStep: s.twoStep,
    mustChangePassword: Boolean(s.mustChange) || s.status === "INVITED",
    lastSignInAt: s.last,
    lastSignInDevice: s.last ? `${device} · ${place}` : null,
    failedAttempts: s.status === "LOCKED" ? 5 : 0,
    lockedAt: s.status === "LOCKED" ? "2026-11-04T08:12:30+05:00" : null,
    disabledReason: s.disabledReason ?? null,
    passwordChangedAt: s.status === "INVITED" ? null : `2026-0${(i % 8) + 2}-1${i % 9}T10:00:00+05:00`,
    createdAt: s.createdAt ?? "2026-02-01T09:00:00+05:00",
    createdBy: s.createdAt ? "Kamran Yousaf" : "Migrated from the old system",
    updatedAt: s.createdAt ?? "2026-10-02T10:00:00+05:00",
    updatedBy: "Kamran Yousaf",
    rowVer: 3,
    signIns,
  };
}

export function initialUsers(): UserRecord[] {
  const demo: UserSeed[] = USERS.map((u) => {
    const extra = DEMO_EXTRA[u.id] ?? { staffNo: "", last: null };
    return {
      id: u.id,
      username: u.username,
      name: u.name,
      mobile: u.mobile,
      staffNo: extra.staffNo,
      grants: u.roles.map((g): [string, CampusScope] => [ROLE_ID[g.role] ?? `role-${g.role.toLowerCase()}`, g.campus]),
      twoStep: u.mfa,
      last: extra.last,
      ...(extra.device ? { device: extra.device } : {}),
      mustChange: u.mustChangePassword,
    };
  });
  return [...demo, ...EXTRA_USERS].map(fromSeed);
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

/* ------------------------------------------------------------------ Audit log */

const A = (
  id: string,
  at: IsoDateTime,
  actor: string,
  actorRole: string,
  campus: CampusScope,
  area: SetupAuditEntry["area"],
  action: string,
  target: string,
  summary: string,
  changes: SetupAuditEntry["changes"] = [],
  tone: SetupAuditEntry["tone"] = "neutral",
  device = "Chrome on Windows · Head office",
): SetupAuditEntry => ({ id, at, actor, actorRole, campus, area, action, target, summary, changes, tone, device });

const KO = "Chrome on Windows · Khalid Campus office";

export function initialAudit(): SetupAuditEntry[] {
  return [
    A("a-40", "2026-11-04T08:12:30+05:00", "Ms Nida Hussain", "Teacher", "KC", "Sign-in", "Account locked", "Ms Nida Hussain", "Locked after 5 wrong passwords in 5 minutes. Unlock it from Users once you have spoken to her.", [], "danger", "Teacher app on Android · Mobile data"),
    A("a-39", "2026-11-04T08:08:00+05:00", "Ms Nida Hussain", "Teacher", "KC", "Sign-in", "Wrong password", "Ms Nida Hussain", "First of 5 wrong passwords this morning.", [], "warning", "Teacher app on Android · Mobile data"),
    A("a-38", "2026-11-04T07:40:00+05:00", "Kamran Yousaf", "Admin", "ALL", "Sign-in", "Signed in", "Kamran Yousaf", "Password and two-step code.", [], "success"),
    A("a-37", "2026-11-03T16:20:00+05:00", "Kamran Yousaf", "Admin", "KC", "Teachers", "Changed subject teacher", "7-B · Mathematics", "Khalid Campus, 2026–27.", [{ field: "Teacher", from: "Mr Kashif Nadeem", to: "Ms Hina Javed" }]),
    A("a-36", "2026-11-03T12:40:00+05:00", "Mrs Sadia Rehman", "Principal", "KC", "Users", "Reset password", "Ms Hina Javed", "Temporary password set. She must choose her own at the next sign-in.", [{ field: "Must change password", from: "No", to: "Yes" }], "warning", KO),
    A("a-35", "2026-11-02T11:15:00+05:00", "Kamran Yousaf", "Admin", "KC", "Users", "Invited", "Ms Mehwish Anjum", "New teacher. A one-time sign-in code was sent to 0314-•••••54.", [{ field: "Role", from: "—", to: "Teacher — Khalid Campus" }], "success"),
    A("a-34", "2026-11-02T09:31:00+05:00", "Kamran Yousaf", "Admin", "MC", "Settings", "Changed setting", "Majeed Campus", "Automatic messages now go in Urdu.", [{ field: "Language for automatic messages", from: "English and Urdu", to: "Urdu" }]),
    A("a-33", "2026-10-31T14:05:00+05:00", "Kamran Yousaf", "Admin", "SM", "Users", "Granted role", "Mr Fahad Iqbal", "He now teaches at two campuses with one account.", [{ field: "Roles", from: "Teacher — Khalid Campus", to: "Teacher — Khalid Campus; Teacher — Sugar Mill Campus" }]),
    A("a-32", "2026-10-30T10:22:00+05:00", "Nadia Shah", "Accountant", "ALL", "Sign-in", "Wrong two-step code", "Nadia Shah", "Signed in at the second try.", [], "warning", "Chrome on Windows · Head office"),
    A("a-31", "2026-10-29T15:44:00+05:00", "Kamran Yousaf", "Admin", "UC", "Campuses", "Changed campus", "Ubaid Campus", "School day times for winter.", [
      { field: "Assembly", from: "07:30", to: "07:45" },
      { field: "First period", from: "07:45", to: "08:00" },
    ]),
    A("a-30", "2026-10-21T15:10:00+05:00", "Kamran Yousaf", "Admin", "ALL", "Subjects", "Changed class subjects", "Class 9 · Science (Biology)", "Board marking scheme for 2027.", [{ field: "Physics maximum marks", from: "75", to: "65" }, { field: "Chemistry maximum marks", from: "75", to: "65" }]),
    A("a-29", "2026-10-20T09:05:00+05:00", "Mrs Sadia Rehman", "Principal", "KC", "Classes", "Changed section", "7-B", "Moved to a bigger room.", [{ field: "Room", from: "Room 21", to: "Room 16" }], "neutral", KO),
    A("a-41", "2026-10-28T11:00:00+05:00", "Kamran Yousaf", "Admin", "ALL", "Roles", "Created role", "Office admin", "Copied from Office staff, then added result sheets, houses, timetables, staff records and the fee card.", [], "success"),
    A("a-28", "2026-10-12T10:35:00+05:00", "Kamran Yousaf", "Admin", "ALL", "Roles", "Changed role", "Exam office", "Can now see timetables to plan date sheets.", [{ field: "Permissions added", from: "—", to: "View timetables" }]),
    A("a-27", "2026-10-12T10:20:00+05:00", "Kamran Yousaf", "Admin", "ALL", "Roles", "Created role", "Exam office", "Copied from Teacher, then changed.", [], "success"),
    A("a-26", "2026-10-12T11:20:00+05:00", "Kamran Yousaf", "Admin", "SM", "Campuses", "Changed campus", "Sugar Mill Campus", "New report heading for result cards.", [{ field: "Report heading", from: "MTB Sugar Mill", to: "MTB — Sugar Mill Campus" }]),
    A("a-25", "2026-10-05T12:00:00+05:00", "Kamran Yousaf", "Admin", "KC", "Users", "Disabled", "Mr Sohail Ahmed", "Left the school on 30-Sep-2026. His receipts stay on record under his name.", [{ field: "Status", from: "Active", to: "Disabled" }], "danger"),
    A("a-24", "2026-10-02T10:00:00+05:00", "Kamran Yousaf", "Admin", "ALL", "Users", "Turned on two-step sign-in", "All cashiers", "Required for every cashier from today.", [{ field: "Cashier role", from: "Two-step optional", to: "Two-step required" }], "success"),
    A("a-23", "2026-09-15T09:40:00+05:00", "Kamran Yousaf", "Admin", "ALL", "Sessions", "Changed campus dates", "2026–27 · Humaira Campus", "Humaira Campus started a week later.", [{ field: "Starts on", from: "01-Apr-2026", to: "06-Apr-2026" }]),
    A("a-22", "2026-04-01T08:00:00+05:00", "Kamran Yousaf", "Admin", "ALL", "Sessions", "Made current", "2026–27", "Everyone now opens 2026–27 by default. 2025–26 became read-only for daily work.", [{ field: "Current session", from: "2025–26", to: "2026–27" }], "success"),
    A("a-21", "2026-02-18T10:05:00+05:00", "Kamran Yousaf", "Admin", "ALL", "Sessions", "Created session", "2026–27", "Sections, class teachers and subject teachers copied from 2025–26.", [], "success"),
  ];
}
