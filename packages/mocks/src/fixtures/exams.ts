import {
  examsGradeFor,
  examsPassMark,
  examsSits,
  EXAMS_DEFAULT_PASS_RULES,
  EXAMS_DEFAULT_SCALE,
  type CampusCode,
  type ExamsCategory,
  type ExamsGradeBand,
  type ExamsGradeScale,
  type ExamsHistoryItem,
  type ExamsMark,
  type ExamsPaperStatus,
  type ExamsPassRules,
  type ExamsRankScope,
  type ExamsReopenRequest,
  type ExamsResultCode,
  type ExamsResultRow,
  type ExamsSubject,
} from "@mtb/api";
import type { IsoDate, IsoDateTime } from "@mtb/domain";
import { ALL_SECTIONS, classTeacher, rosterFor, sectionSizes } from "./attendance";
import { groupOfStudent } from "./student-records";
import { findStudent } from "./students";

/** A roster entry: a real fixture student (has a profile) or a classmate from the attendance register. */
export interface ExamsRosterEntry {
  id: string;
  name: string;
  father?: string;
  classSection: string;
  rollNo: number;
  hasProfile: boolean;
  /** Group (stream) for classes 9–10: the student sits only the papers of this group. */
  group?: string;
  /** Home address (students with a profile), for the result card. */
  address?: string;
  /** Guardian's mobile. */
  mobile?: string;
}

/**
 * Group (stream) of a student in a class with groups: the same rule as the student profile (groupOfStudent, used by
 * handlers/student-records-model streamFor), so a student shows one group everywhere. The group stored on a student's record
 * wins; the register's classmates without a record are spread by number. The real backend reads the enrolment's group.
 */
export function groupFor(id: string, classSection: string): string | undefined {
  return groupOfStudent(id, classSection.split("-")[0] ?? "", findStudent(id)?.stream);
}
const G_BIO = "Science (Biology)";
const G_CMP = "Science (Computer)";

/** Where one class-section × subject paper stands. Missing entries are worked out from the marks. */
export interface ExamsPaperState {
  status: ExamsPaperStatus;
  by?: string;
  at?: IsoDateTime;
  note?: string;
}

export interface ExamRecord {
  id: string;
  name: string;
  category: ExamsCategory;
  typeId?: string;
  campus: CampusCode;
  session: number;
  classes: string[];
  subjects: ExamsSubject[];
  startDate: IsoDate;
  endDate?: IsoDate;
  status: "DRAFT" | "DECLARED";
  roster: ExamsRosterEntry[];
  /** marks[personId][subjectId] */
  marks: Record<string, Record<string, ExamsMark>>;
  /** papers[`${classSection}|${subjectId}`] */
  papers?: Record<string, ExamsPaperState>;
  /** personId → reason the result is withheld. */
  withheld?: Record<string, string>;
  declaredOn?: IsoDateTime;
  declaredBy?: string;
  /** Results frozen at declaration (grades and positions never change afterwards). */
  frozen?: ExamsResultRow[];
  /** The grade bands the frozen results were declared with. */
  frozenBands?: ExamsGradeBand[];
  reopen?: ExamsReopenRequest;
  history: ExamsHistoryItem[];
  candidateLabel?: "Student" | "Applicant" | "Participant";
  /** personId → class teacher's remark for the result card. */
  remarks?: Record<string, string>;
  /** personId → board roll number (board results). */
  boardRollNos?: Record<string, string>;
  /** Programme test (Diamond Minds): classes are centre ids. */
  programmeId?: string;
  /** Board results: the session the students sat the board exam in. */
  sourceSession?: number;
  /** Grade scale the draft results use (declared results keep frozenBands). */
  scaleId?: string;
}

export interface ExamsTypeRecord {
  id: string;
  name: string;
  nameUrdu: string;
  category: ExamsCategory;
  rankScope: ExamsRankScope;
  countsForPromotion: boolean;
  absenceFine: number;
  active: boolean;
  /** A programme test (Diamond Minds): set up under Exams → Programmes, not New exam. */
  programme?: boolean;
  /** The type's own papers (Hifz): a new exam of this type uses them instead of the class subjects. */
  papers?: ExamsSubject[];
}

export const paperKey = (classSection: string, subjectId: string) => `${classSection}|${subjectId}`;

// ---------------------------------------------------------------------------------------------------------
// Results: totals, %, grade from the grading scale, pass / re-sit / fail, dense positions by % within each
// class-section and across the class.
// ---------------------------------------------------------------------------------------------------------

function denseRank<T>(items: T[], value: (t: T) => number, set: (t: T, rank: number) => void) {
  const sorted = [...items].sort((a, b) => value(b) - value(a));
  let rank = 0;
  let last: number | null = null;
  for (const t of sorted) {
    const v = value(t);
    if (v !== last) {
      rank++;
      last = v;
    }
    set(t, rank);
  }
}

export function computeRows(
  exam: Pick<ExamRecord, "roster" | "marks" | "subjects"> & Partial<Pick<ExamRecord, "withheld" | "remarks" | "boardRollNos">>,
  bands: ExamsGradeBand[],
  rules: ExamsPassRules = EXAMS_DEFAULT_PASS_RULES,
): ExamsResultRow[] {
  const rows: ExamsResultRow[] = exam.roster.map((p) => {
    const marks = exam.marks[p.id] ?? {};
    // Papers outside the student's group are not taken: not missing, not in the maximum, never failed.
    const own = exam.subjects.filter((s) => examsSits(s, p.group));
    const max = own.reduce((a, s) => a + s.maxMarks, 0);
    const values = own.map((s) => ({ s, v: marks[s.id] ?? null }));
    const missing = values.filter((x) => x.v === null).length;
    const obtained = values.reduce<number>((a, x) => a + (typeof x.v === "number" ? x.v : 0), 0);
    const percent = missing > 0 || max === 0 ? null : Math.round((obtained / max) * 1000) / 10;
    const failedSubjects = values.filter((x) => x.v !== null && (typeof x.v !== "number" || x.v < examsPassMark(x.s.maxMarks, rules))).map((x) => x.s.id);
    const withheld = exam.withheld?.[p.id];
    let result: ExamsResultCode;
    if (withheld) result = "WITHHELD";
    else if (percent === null) result = "INCOMPLETE";
    else if (failedSubjects.length === 0 && percent >= rules.overallPassPercent) result = "PASS";
    else if (failedSubjects.length > 0 && failedSubjects.length <= rules.supplyMaxSubjects && percent >= rules.overallPassPercent) result = "SUPPLY";
    else result = "FAIL";
    return {
      id: p.id,
      name: p.name,
      ...(p.father ? { father: p.father } : {}),
      classSection: p.classSection,
      rollNo: p.rollNo,
      hasProfile: p.hasProfile,
      marks: Object.fromEntries(values.map((x) => [x.s.id, x.v])),
      obtained,
      max,
      percent,
      grade: percent === null ? null : examsGradeFor(percent, bands),
      position: null,
      classPosition: null,
      missing,
      result,
      failedSubjects,
      absentPapers: values.filter((x) => x.v === "A").length,
      leavePapers: values.filter((x) => x.v === "L").length,
      ...(withheld ? { withheld } : {}),
      ...(p.group ? { group: p.group } : {}),
      ...(exam.remarks?.[p.id] ? { teacherRemark: exam.remarks[p.id] } : {}),
      ...(exam.boardRollNos?.[p.id] ? { boardRollNo: exam.boardRollNos[p.id] } : {}),
      ...(p.address ? { address: p.address } : {}),
    };
  });
  const ranked = rows.filter((r) => r.percent !== null && !r.withheld);
  for (const cs of new Set(rows.map((r) => r.classSection))) {
    denseRank(
      ranked.filter((r) => r.classSection === cs),
      (r) => r.percent ?? 0,
      (r, n) => (r.position = n),
    );
  }
  denseRank(
    ranked,
    (r) => r.percent ?? 0,
    (r, n) => (r.classPosition = n),
  );
  return rows;
}

// ---------------------------------------------------------------------------------------------------------
// Rosters, subjects and subject teachers
// ---------------------------------------------------------------------------------------------------------

/**
 * The students of a class-section from the attendance register (fixture students first, so Ayesha, Bilal and
 * Areeba keep their profiles), optionally labelled as another section (last year's class).
 */
export function examRoster(campus: CampusCode, classSection: string, labelAs = classSection): ExamsRosterEntry[] {
  return rosterFor(campus, classSection).map((e) => {
    const group = groupFor(e.grNo, labelAs);
    const address = e.hasProfile ? findStudent(e.grNo)?.guardian.address : undefined;
    return { id: e.grNo, name: e.name, father: e.father, classSection: labelAs, rollNo: e.rollNo, hasProfile: e.hasProfile, ...(group ? { group } : {}), ...(address ? { address } : {}), ...(e.mobile ? { mobile: e.mobile } : {}) };
  });
}

/** Roll numbers in name order within each section. */
function renumber(list: ExamsRosterEntry[]): ExamsRosterEntry[] {
  const counters: Record<string, number> = {};
  return [...list].sort((a, b) => a.classSection.localeCompare(b.classSection) || a.name.localeCompare(b.name)).map((p) => ({ ...p, rollNo: (counters[p.classSection] = (counters[p.classSection] ?? 0) + 1) }));
}

/** Sections of a class with a register at a campus ("7" → ["7-A", "7-B", "7-C"]). */
export function sectionsOfClass(campus: CampusCode, classShort: string): string[] {
  const sizes = sectionSizes(campus);
  return ALL_SECTIONS.filter((cs) => cs.split("-")[0] === classShort && cs in sizes);
}

const SUBJECT_URDU: Record<string, string> = {
  eng: "انگریزی",
  urd: "اردو",
  mat: "ریاضی",
  sci: "سائنس",
  sst: "معاشرتی علوم",
  isl: "اسلامیات",
  phy: "طبیعیات",
  che: "کیمیا",
  bio: "حیاتیات",
  cmp: "کمپیوٹر سائنس",
  pst: "مطالعہ پاکستان",
  tqn: "ترجمۃ القرآن",
  naz: "ناظرہ قرآن",
  gk: "معلومات عامہ",
  drw: "ڈرائنگ",
};
const SUBJECT_NAME: Record<string, string> = {
  eng: "English",
  urd: "Urdu",
  mat: "Mathematics",
  sci: "Science",
  sst: "Social Studies",
  isl: "Islamiyat",
  phy: "Physics",
  che: "Chemistry",
  bio: "Biology",
  cmp: "Computer Science",
  pst: "Pakistan Studies",
  tqn: "Tarjuma-tul-Quran",
  naz: "Nazra Quran",
  gk: "General Knowledge",
  drw: "Drawing",
};
const subj = (id: string, maxMarks: number, groups?: string[]): ExamsSubject => ({ id, name: SUBJECT_NAME[id] ?? id, nameUrdu: SUBJECT_URDU[id] ?? "", maxMarks, ...(groups ? { groups } : {}) });
/** Classes 9–10: Biology for the Science (Biology) group, Computer Science for the Science (Computer) group. */
const BIO = (max: number) => subj("bio", max, [G_BIO]);
const CMP = (max: number) => subj("cmp", max, [G_CMP]);

/**
 * Subjects and maximum marks per class — the same lists as Setup → Subjects (the real backend reads the class
 * subjects directly). A new exam copies them; each exam can change a paper's maximum (a 25-mark test).
 */
export const CLASS_SUBJECTS: Record<string, ExamsSubject[]> = {
  Prep: [subj("eng", 50), subj("urd", 50), subj("mat", 50), subj("gk", 50), subj("naz", 50), subj("drw", 25)],
  ...Object.fromEntries(["1", "2", "3"].map((c) => [c, [subj("eng", 100), subj("urd", 100), subj("mat", 100), subj("gk", 50), subj("isl", 50), subj("naz", 50), subj("drw", 50)]])),
  ...Object.fromEntries(["4", "5"].map((c) => [c, [subj("eng", 100), subj("urd", 100), subj("mat", 100), subj("sci", 100), subj("sst", 100), subj("isl", 100), subj("cmp", 50)]])),
  ...Object.fromEntries(["6", "7", "8"].map((c) => [c, [subj("eng", 100), subj("urd", 100), subj("mat", 100), subj("sci", 100), subj("sst", 100), subj("isl", 100)]])),
  "9": [subj("eng", 75), subj("urd", 75), subj("isl", 50), subj("mat", 75), subj("phy", 65), subj("che", 65), BIO(65), CMP(65), subj("tqn", 50)],
  "10": [subj("eng", 75), subj("urd", 75), subj("pst", 50), subj("mat", 75), subj("phy", 65), subj("che", 65), BIO(65), CMP(65), subj("tqn", 50)],
};

/** Groups (streams) a class offers: the groups named on its papers. */
export const classGroups = (classShort: string): string[] => [...new Set((CLASS_SUBJECTS[classShort] ?? []).flatMap((s) => s.groups ?? []))];

const SUBJECT_POOL = [
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
];
const SUBJECT_ORDER = ["eng", "urd", "mat", "sci", "sst", "isl", "phy", "che", "bio", "cmp", "pst", "tqn", "naz", "gk", "drw"];

/** Subject teacher for one section: the class teacher teaches Mathematics; other subjects come from the subject staff. */
export function subjectTeacher(campus: CampusCode, classSection: string, subjectId: string): string {
  const index = Math.max(0, ALL_SECTIONS.indexOf(classSection));
  if (subjectId === "mat") return classTeacher(campus, classSection, index);
  const s = Math.max(0, SUBJECT_ORDER.indexOf(subjectId));
  const grade = Number(classSection.split("-")[0]) || 0;
  return SUBJECT_POOL[(s * 3 + grade + (campus === "KC" ? 0 : 5)) % SUBJECT_POOL.length]!;
}

// ---------------------------------------------------------------------------------------------------------
// Deterministic marks
// ---------------------------------------------------------------------------------------------------------

/** Seeded random numbers (FNV-1a hash of the seed, then mulberry32), so classmates with similar numbers still differ. */
function prng(seedText: string) {
  let h = 2166136261;
  for (const ch of seedText) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  let s = h >>> 0 || 7;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Marks for one person; `cap` keeps everyone else below the named top students. */
function generateMarks(seed: string, subjects: ExamsSubject[], cap: number): Record<string, number> {
  const rand = prng(seed);
  const ability = 0.3 + rand() * 0.52;
  const marks: Record<string, number> = {};
  for (const s of subjects) {
    const v = Math.round(s.maxMarks * (ability + (rand() - 0.5) * 0.18));
    marks[s.id] = Math.max(Math.round(s.maxMarks * 0.12), Math.min(s.maxMarks, v));
  }
  const max = subjects.reduce((a, s) => a + s.maxMarks, 0);
  const total = Object.values(marks).reduce((a, v) => a + v, 0);
  if ((total / max) * 100 >= cap) {
    const factor = (cap - 1.5) / ((total / max) * 100);
    for (const s of subjects) marks[s.id] = Math.floor((marks[s.id] ?? 0) * factor);
  }
  return marks;
}

function marksFor(exam: string, people: ExamsRosterEntry[], subjects: ExamsSubject[], fixed: Record<string, Record<string, number>>, cap: number) {
  // Each person gets marks only for the papers of their group.
  return Object.fromEntries(people.map((p) => [p.id, fixed[p.id] ?? generateMarks(`${exam}:${p.id}`, subjects.filter((s) => examsSits(s, p.group)), cap)])) as Record<string, Record<string, ExamsMark>>;
}

const SIX: ExamsSubject[] = CLASS_SUBJECTS["7"]!;
const pick = (vals: number[]) => Object.fromEntries(SIX.map((s, i) => [s.id, vals[i] ?? 0]));

/** Fixed results (they match the student profile and the parent portal). */
const AYESHA_FT = pick([88, 82, 92, 85, 79, 86]); // 512 / 600, 85.3%, A+ — third in 7-B
const AREEBA_FT = pick([94, 90, 95, 91, 85, 92]); // 547, 91.2% — first in 7-B
const BILAL_FT = pick([90, 86, 93, 88, 82, 89]); // 528, 88.0% — second in 7-B
const AYESHA_ANNUAL = pick([84, 80, 90, 81, 76, 86]); // 497 / 600, 82.8%, fifth in 6-A
const AYESHA_FT_LAST = pick([80, 77, 86, 79, 74, 82]); // 478 / 600, 79.7%
/** Hamza (4-A): 521 / 650, 80.2%, A+. Mariam (Ubaid Campus, 9-A): 429 / 520, 82.5%, A+. */
const HAMZA_FT = { eng: 81, urd: 76, mat: 88, sci: 79, sst: 72, isl: 84, cmp: 41 };
const MARIAM_FT = { eng: 62, urd: 64, isl: 44, mat: 58, phy: 51, che: 49, bio: 55, tqn: 46 };

/** A date sheet: one paper a day from `start`, skipping Sundays, 09:00 for `mins` minutes. */
function dateSheet(subjects: ExamsSubject[], start: IsoDate, mins: number, supervisors: string[] = []): ExamsSubject[] {
  let d = new Date(`${start}T00:00:00Z`);
  return subjects.map((s, i) => {
    if (i > 0) d = new Date(d.getTime() + 86400000);
    if (d.getUTCDay() === 0) d = new Date(d.getTime() + 86400000);
    const sup = supervisors[i % Math.max(1, supervisors.length)];
    return { ...s, date: d.toISOString().slice(0, 10), startTime: "09:00", durationMins: mins, ...(sup ? { supervisor: sup } : {}) };
  });
}
const lastDate = (subjects: ExamsSubject[]) => subjects.reduce<IsoDate | undefined>((a, s) => (s.date && (!a || s.date > a) ? s.date : a), undefined);

const h = (id: string, at: IsoDateTime, by: string, action: string, detail?: string): ExamsHistoryItem => ({ id, at, by, action, ...(detail ? { detail } : {}) });

/** Every paper of an exam at one status. */
function allPapers(classes: string[], subjects: ExamsSubject[], status: ExamsPaperStatus, by: string, at: IsoDateTime): Record<string, ExamsPaperState> {
  return Object.fromEntries(classes.flatMap((cs) => subjects.map((s) => [paperKey(cs, s.id), { status, by, at }])));
}

const SUPERVISORS = ["Ms Nida Hussain", "Mr Waqar Ahmed", "Ms Asma Rafiq", "Mr Zubair Aslam"];

// ---------------------------------------------------------------------------------------------------------
// Exam types
// ---------------------------------------------------------------------------------------------------------

const T = (id: string, name: string, nameUrdu: string, category: ExamsCategory, absenceFine: number, extra: Partial<ExamsTypeRecord> = {}): ExamsTypeRecord => ({
  id,
  name,
  nameUrdu,
  category,
  rankScope: category === "TEST" ? "MONTH" : "EXAM",
  countsForPromotion: false,
  absenceFine,
  active: true,
  ...extra,
});

/**
 * Shoba-e-Hifz papers (the old Hifz marking sheet): Manzil 1–7, Tajweed, Dua/Namaz/Kalimay 1–5, Encouragement,
 * English and Mathematics. Ids ending in a number print as one group with a total.
 */
export const HIFZ_PAPERS: ExamsSubject[] = [
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => ({ id: `manzil-${n}`, name: `Manzil ${n}`, nameUrdu: `منزل ${n}`, maxMarks: 10 })),
  { id: "tajweed", name: "Tajweed", nameUrdu: "تجوید", maxMarks: 10 },
  ...[1, 2, 3, 4, 5].map((n) => ({ id: `dua-${n}`, name: `Dua, Namaz, Kalimay ${n}`, nameUrdu: `دعا، نماز، کلمے ${n}`, maxMarks: 2 })),
  { id: "encourage", name: "Encouragement", nameUrdu: "حوصلہ افزائی", maxMarks: 10 },
  subj("eng", 25),
  subj("mat", 25),
];

export function initialExamTypes(): ExamsTypeRecord[] {
  return [
    T("et-first", "First Term", "پہلا ٹرم امتحان", "TERM", 200),
    T("et-mid", "Mid Term", "وسط مدتی امتحان", "TERM", 200),
    T("et-annual", "Annual", "سالانہ امتحان", "TERM", 200, { countsForPromotion: true }),
    T("et-sendup", "Send-up", "سینڈ اپ امتحان", "TEST", 200, { rankScope: "EXAM" }),
    T("et-monthly", "Monthly Test", "ماہانہ ٹیسٹ", "TEST", 50),
    T("et-weekly", "Weekly Test", "ہفتہ وار ٹیسٹ", "TEST", 0),
    T("et-morning", "Morning Test", "صبح کا ٹیسٹ", "TEST", 0),
    T("et-chapter", "Chapter-wise Test", "باب وار ٹیسٹ", "TEST", 0, { rankScope: "EXAM" }),
    T("et-hifz", "Hifz Manzil Test", "حفظ منزل ٹیسٹ", "TEST", 0, { rankScope: "EXAM", papers: HIFZ_PAPERS }),
    T("et-board1", "Matric Part I (board)", "میٹرک حصہ اوّل (بورڈ)", "BOARD", 0),
    T("et-board2", "Matric Part II (board)", "میٹرک حصہ دوم (بورڈ)", "BOARD", 0),
    T("et-entrance", "Entrance Test", "داخلہ ٹیسٹ", "ENTRANCE", 0),
    T("et-uni-mid", "Mid Semester", "وسط سمسٹر امتحان", "UNIVERSITY", 0),
    T("et-uni-final", "Final Semester", "سمسٹر کا آخری امتحان", "UNIVERSITY", 0),
    // University internal assessment: each becomes a marks column of a course.
    T("et-uni-quiz", "Quiz", "کوئز", "UNIVERSITY", 0),
    T("et-uni-test", "Test", "ٹیسٹ", "UNIVERSITY", 0),
    T("et-uni-assign", "Assignment", "اسائنمنٹ", "UNIVERSITY", 0),
    T("et-uni-pres", "Presentation", "پریزنٹیشن", "UNIVERSITY", 0),
    T("et-uni-behav", "General Behaviour", "عمومی رویہ", "UNIVERSITY", 0),
    T("et-diamond", "Diamond Minds Talent Test", "ڈائمنڈ مائنڈز ٹیسٹ", "ENTRANCE", 0, { programme: true }),
  ];
}

/** Grade scales (modernization/20 F): Standard for everything, plus an entrance pass scale and a progress-report scale. */
export function initialGradeScales(): ExamsGradeScale[] {
  return [
    { id: "gs-standard", name: "Standard", appliesTo: { categories: [], classes: [] }, bands: EXAMS_DEFAULT_SCALE, passRules: EXAMS_DEFAULT_PASS_RULES, updatedBy: "Mrs Sadia Rehman", updatedAt: "2026-08-01T10:00:00+05:00", rowVer: 1, standard: true },
    {
      id: "gs-entrance",
      name: "Entrance pass",
      appliesTo: { categories: ["ENTRANCE"], classes: [] },
      bands: [
        { grade: "A", min: 70, max: 100, remark: "Strong pass" },
        { grade: "P", min: 40, max: 69, remark: "Pass" },
        { grade: "F", min: 0, max: 39, remark: "Did not pass" },
      ],
      passRules: { subjectPassPercent: 33, overallPassPercent: 40, supplyMaxSubjects: 0 },
      updatedBy: "Mrs Sadia Rehman",
      updatedAt: "2026-08-01T10:05:00+05:00",
      rowVer: 1,
    },
    {
      id: "gs-progress",
      name: "Progress report",
      appliesTo: { categories: ["TEST"], classes: ["9", "10"] },
      bands: [
        { grade: "A", min: 80, max: 100, remark: "Excellent" },
        { grade: "B", min: 60, max: 79, remark: "Good" },
        { grade: "C", min: 45, max: 59, remark: "Satisfactory" },
        { grade: "E", min: 33, max: 44, remark: "Poor" },
        { grade: "F", min: 0, max: 32, remark: "Fail" },
      ],
      passRules: EXAMS_DEFAULT_PASS_RULES,
      updatedBy: "Mrs Sadia Rehman",
      updatedAt: "2026-08-01T10:10:00+05:00",
      rowVer: 1,
    },
  ];
}

/** University exam types that are papers, not internal-assessment components. */
export const UNI_PAPER_TYPES = ["et-uni-mid", "et-uni-final"];

// ---------------------------------------------------------------------------------------------------------
// Exams
// ---------------------------------------------------------------------------------------------------------

function buildExams(): ExamRecord[] {
  // ---- First Term 2026–27, Class 7 — declared on 20-Oct-2026 (Ayesha's latest declared result) ----
  const c7 = ["7-A", "7-B", "7-C"].flatMap((cs) => examRoster("KC", cs));
  const ftSubjects = dateSheet(SIX, "2026-10-12", 180, SUPERVISORS);
  const ft7: ExamRecord = {
    id: "ex-ft-2627",
    name: "First Term 2026–27",
    category: "TERM",
    typeId: "et-first",
    campus: "KC",
    session: 2026,
    classes: ["7-A", "7-B", "7-C"],
    subjects: ftSubjects,
    startDate: "2026-10-12",
    endDate: lastDate(ftSubjects)!,
    status: "DECLARED",
    roster: c7,
    marks: marksFor("ft7", c7, SIX, { "KC-14823": AYESHA_FT, "KC-14988": AREEBA_FT, "KC-14650": BILAL_FT }, 85.3),
    papers: allPapers(["7-A", "7-B", "7-C"], SIX, "CHECKED", "Exam office", "2026-10-16T13:20:00+05:00"),
    declaredOn: "2026-10-20T15:30:00+05:00",
    declaredBy: "Mrs Sadia Rehman",
    history: [
      h("h1", "2026-09-28T10:00:00+05:00", "Exam office", "Exam created", "6 subjects · 100 marks each"),
      h("h2", "2026-10-16T13:20:00+05:00", "Exam office", "All marks entered", "0 marks missing"),
      h("h3", "2026-10-20T15:30:00+05:00", "Mrs Sadia Rehman", "Results declared", "Visible in the parent portal"),
    ],
  };

  // ---- First Term 2026–27, Class 8 — complete, ready to declare (flow 2) ----
  const c8classes = ["8-A", "8-B", "8-C"];
  const c8 = c8classes.flatMap((cs) => examRoster("KC", cs));
  const ft8Marks = marksFor("ft8", c8, SIX, {}, 92);
  const absentee = c8.find((p) => p.classSection === "8-B" && !p.hasProfile);
  if (absentee) ft8Marks[absentee.id] = { ...ft8Marks[absentee.id], urd: "A" };
  const onLeave = c8.find((p) => p.classSection === "8-A" && !p.hasProfile && p.rollNo > 5);
  if (onLeave) ft8Marks[onLeave.id] = { ...ft8Marks[onLeave.id], sci: "L" };
  const ft8Papers = allPapers(c8classes, SIX, "SUBMITTED", "Subject teacher", "2026-10-29T14:00:00+05:00");
  for (const k of Object.keys(ft8Papers).slice(0, 15)) ft8Papers[k] = { status: "CHECKED", by: "Exam office", at: "2026-10-30T12:10:00+05:00" };
  const ft8: ExamRecord = {
    id: "ex-ft-2627-c8",
    name: "First Term 2026–27",
    category: "TERM",
    typeId: "et-first",
    campus: "KC",
    session: 2026,
    classes: c8classes,
    subjects: ftSubjects,
    startDate: "2026-10-12",
    endDate: lastDate(ftSubjects)!,
    status: "DRAFT",
    roster: c8,
    marks: ft8Marks,
    papers: ft8Papers,
    history: [
      h("h1", "2026-09-28T10:05:00+05:00", "Exam office", "Exam created", "6 subjects · 100 marks each"),
      h("h2", "2026-10-30T12:10:00+05:00", "Exam office", "All marks entered", `0 marks missing · ${absentee?.name ?? "one student"} absent in Urdu`),
    ],
  };

  // ---- First Term 2026–27, Class 4 — declared (Hamza's result in the parent portal) ----
  const c4classes = sectionsOfClass("KC", "4");
  const c4 = c4classes.flatMap((cs) => examRoster("KC", cs));
  const c4Subjects = dateSheet(CLASS_SUBJECTS["4"]!, "2026-10-12", 150, SUPERVISORS);
  const ft4: ExamRecord = {
    id: "ex-ft-2627-c4",
    name: "First Term 2026–27",
    category: "TERM",
    typeId: "et-first",
    campus: "KC",
    session: 2026,
    classes: c4classes,
    subjects: c4Subjects,
    startDate: "2026-10-12",
    endDate: lastDate(c4Subjects)!,
    status: "DECLARED",
    roster: c4,
    marks: marksFor("ft4", c4, c4Subjects, { "KC-15102": HAMZA_FT }, 97),
    papers: allPapers(c4classes, c4Subjects, "CHECKED", "Exam office", "2026-10-19T12:00:00+05:00"),
    declaredOn: "2026-10-21T14:10:00+05:00",
    declaredBy: "Mrs Sadia Rehman",
    history: [
      h("h1", "2026-09-28T10:10:00+05:00", "Exam office", "Exam created", "7 subjects · 650 marks"),
      h("h2", "2026-10-21T14:10:00+05:00", "Mrs Sadia Rehman", "Results declared", "Visible in the parent portal"),
    ],
  };

  // ---- Monthly tests, Class 7 ----
  const FOUR: ExamsSubject[] = [
    { ...subj("eng", 25) },
    { ...subj("urd", 25) },
    { ...subj("mat", 25) },
    { ...subj("sci", 25) },
  ];
  const sepSubjects = dateSheet(FOUR, "2026-09-24", 40, SUPERVISORS);
  const mtSep: ExamRecord = {
    id: "ex-mt-2609-c7",
    name: "Monthly Test – September 2026",
    category: "TEST",
    typeId: "et-monthly",
    campus: "KC",
    session: 2026,
    classes: ["7-A", "7-B", "7-C"],
    subjects: sepSubjects,
    startDate: "2026-09-24",
    endDate: lastDate(sepSubjects)!,
    status: "DECLARED",
    roster: c7,
    marks: marksFor("mt-sep", c7, FOUR, { "KC-14823": { eng: 22, urd: 20, mat: 24, sci: 21 } }, 96),
    papers: allPapers(["7-A", "7-B", "7-C"], FOUR, "CHECKED", "Exam office", "2026-09-30T11:00:00+05:00"),
    declaredOn: "2026-10-01T12:00:00+05:00",
    declaredBy: "Mrs Sadia Rehman",
    history: [
      h("h1", "2026-09-18T09:00:00+05:00", "Exam office", "Exam created", "4 subjects · 25 marks each"),
      h("h2", "2026-10-01T12:00:00+05:00", "Mrs Sadia Rehman", "Results declared", "Visible in the parent portal"),
    ],
  };

  // October: 7-B Mathematics half-entered by Ms Hina Javed (18 of 34), three Mathematics marks missing in 7-C.
  const octSubjects = dateSheet(FOUR, "2026-10-26", 40, SUPERVISORS);
  const mtMarks = marksFor("mt-oct", c7, FOUR, {}, 96);
  const c7b = c7.filter((x) => x.classSection === "7-B").sort((a, b) => a.rollNo - b.rollNo);
  for (const p of c7b.slice(18)) mtMarks[p.id] = { ...mtMarks[p.id], mat: null };
  for (const p of c7.filter((x) => x.classSection === "7-C").slice(0, 3)) mtMarks[p.id] = { ...mtMarks[p.id], mat: null };
  const mtPapers = allPapers(["7-A", "7-B", "7-C"], FOUR, "SUBMITTED", "Subject teacher", "2026-10-29T14:45:00+05:00");
  mtPapers[paperKey("7-A", "mat")] = { status: "CHECKED", by: "Exam office", at: "2026-10-30T10:00:00+05:00" };
  mtPapers[paperKey("7-B", "mat")] = { status: "IN_PROGRESS", by: "Ms Hina Javed", at: "2026-11-03T19:40:00+05:00" };
  mtPapers[paperKey("7-C", "mat")] = { status: "IN_PROGRESS", by: "Ms Sana Tariq", at: "2026-11-02T16:05:00+05:00" };
  const mt: ExamRecord = {
    id: "ex-mt-2610-c7",
    name: "Monthly Test – October 2026",
    category: "TEST",
    typeId: "et-monthly",
    campus: "KC",
    session: 2026,
    classes: ["7-A", "7-B", "7-C"],
    subjects: octSubjects,
    startDate: "2026-10-26",
    endDate: lastDate(octSubjects)!,
    status: "DRAFT",
    roster: c7,
    marks: mtMarks,
    papers: mtPapers,
    history: [
      h("h1", "2026-10-20T09:00:00+05:00", "Exam office", "Exam created", "4 subjects · 25 marks each"),
      h("h2", "2026-10-29T14:45:00+05:00", "Ms Sana Tariq", "Marks submitted", "English, Urdu, Science · 7-C"),
      h("h3", "2026-11-03T19:40:00+05:00", "Ms Hina Javed", "Marks saved as draft", "Mathematics · 7-B · 18 of 34 entered"),
    ],
  };

  // ---- Entrance test for next year's intake — applicants, not students ----
  const ENT: ExamsSubject[] = dateSheet([subj("eng", 30), subj("urd", 20), subj("mat", 50)], "2026-11-01", 60, ["Ms Uzma Shah"]).map((s) => ({ ...s, date: "2026-11-01" }));
  const applicantNames: Array<[string, string]> = [
    ["Ahsan Akram", "Muhammad Akram"],
    ["Ayeza Malik", "Tahir Malik"],
    ["Hasnain Butt", "Arshad Butt"],
    ["Maham Qureshi", "Javed Qureshi"],
    ["Junaid Sheikh", "Nasir Sheikh"],
    ["Sidra Bhatti", "Riaz Bhatti"],
    ["Wahab Chaudhry", "Aslam Chaudhry"],
    ["Rimsha Ansari", "Khalid Ansari"],
    ["Taimoor Gondal", "Zafar Gondal"],
    ["Areej Hashmi", "Saleem Hashmi"],
    ["Owais Zafar", "Zafar Iqbal"],
    ["Kinza Saleem", "Saleem Akhtar"],
  ];
  const applicants: ExamsRosterEntry[] = applicantNames.map(([n, f], i) => ({ id: `A-2728-${String(141 + i).padStart(4, "0")}`, name: n, father: f, classSection: "Class 6 applicants", rollNo: i + 1, hasProfile: false }));
  const entMarks = marksFor("ent", applicants, ENT, {}, 97);
  const entAbsent = applicants[6];
  if (entAbsent) entMarks[entAbsent.id] = { eng: "A", urd: "A", mat: "A" };
  const ent: ExamRecord = {
    id: "ex-ent-2728",
    name: "Entrance test – Admissions 2027–28",
    category: "ENTRANCE",
    typeId: "et-entrance",
    campus: "KC",
    session: 2026,
    classes: ["Class 6 applicants"],
    subjects: ENT,
    startDate: "2026-11-01",
    endDate: "2026-11-01",
    status: "DRAFT",
    roster: applicants,
    marks: entMarks,
    papers: allPapers(["Class 6 applicants"], ENT, "SUBMITTED", "Admissions office", "2026-11-02T13:00:00+05:00"),
    candidateLabel: "Applicant",
    history: [h("h1", "2026-10-15T11:00:00+05:00", "Admissions office", "Exam created", "Merit list is drawn in Admissions")],
  };

  // ---- Ubaid Campus: First Term 2026–27, Class 9 — declared (Mariam's result) ----
  const uc9classes = ["9-A"];
  const uc9 = uc9classes.flatMap((cs) => examRoster("UC", cs));
  const matricSubjects = dateSheet(CLASS_SUBJECTS["9"]!, "2026-10-12", 180, ["Ms Shazia Parveen", "Mr Arif Hussain"]);
  const uc9exam: ExamRecord = {
    id: "ex-ft-2627-uc9",
    name: "First Term 2026–27",
    category: "TERM",
    typeId: "et-first",
    campus: "UC",
    session: 2026,
    classes: uc9classes,
    subjects: matricSubjects,
    startDate: "2026-10-12",
    endDate: lastDate(matricSubjects)!,
    status: "DECLARED",
    roster: uc9,
    marks: marksFor("uc9", uc9, matricSubjects, { "UC-08831": MARIAM_FT }, 95),
    papers: allPapers(uc9classes, matricSubjects, "CHECKED", "Exam office", "2026-10-20T12:00:00+05:00"),
    declaredOn: "2026-10-22T13:00:00+05:00",
    declaredBy: "Ms Rukhsana Bibi",
    history: [h("h1", "2026-10-22T13:00:00+05:00", "Ms Rukhsana Bibi", "Results declared", "Visible in the parent portal")],
  };

  // ---- Session 2025–26 (read-only history) ----
  // Last year Ayesha was in 6-A (she moved to 7-B in Aug 2026); everyone else keeps their section.
  const c6 = renumber([
    ...examRoster("KC", "7-A", "6-A"),
    { id: "KC-14823", name: "Ayesha Khan", father: "Imran Khan", classSection: "6-A", rollNo: 0, hasProfile: true },
    ...examRoster("KC", "7-B", "6-B").filter((p) => p.id !== "KC-14823"),
    ...examRoster("KC", "7-C", "6-C"),
  ]);
  const sixA = c6.filter((p) => p.classSection === "6-A" && p.id !== "KC-14823").slice(0, 4);
  const annualFixed: Record<string, Record<string, number>> = { "KC-14823": AYESHA_ANNUAL };
  sixA.forEach((p, i) => (annualFixed[p.id] = pick([90 - i, 86, 92 - i, 88, 84, 90 - i])));
  const anSubjects = dateSheet(SIX, "2026-03-02", 180, SUPERVISORS);
  const an: ExamRecord = {
    id: "ex-an-2526",
    name: "Annual 2025–26",
    category: "TERM",
    typeId: "et-annual",
    campus: "KC",
    session: 2025,
    classes: ["6-A", "6-B", "6-C"],
    subjects: anSubjects,
    startDate: "2026-03-02",
    endDate: lastDate(anSubjects)!,
    status: "DECLARED",
    roster: c6,
    marks: marksFor("an2526", c6, SIX, annualFixed, 82.8),
    papers: allPapers(["6-A", "6-B", "6-C"], SIX, "CHECKED", "Exam office", "2026-03-20T12:00:00+05:00"),
    declaredOn: "2026-03-28T14:00:00+05:00",
    declaredBy: "Mrs Sadia Rehman",
    history: [h("h1", "2026-03-28T14:00:00+05:00", "Mrs Sadia Rehman", "Results declared", "Visible in the parent portal")],
  };
  const ftLastSubjects = dateSheet(SIX, "2025-10-13", 180, SUPERVISORS);
  const ftLast: ExamRecord = {
    id: "ex-ft-2526-c6",
    name: "First Term 2025–26",
    category: "TERM",
    typeId: "et-first",
    campus: "KC",
    session: 2025,
    classes: ["6-A", "6-B", "6-C"],
    subjects: ftLastSubjects,
    startDate: "2025-10-13",
    endDate: lastDate(ftLastSubjects)!,
    status: "DECLARED",
    roster: c6,
    marks: marksFor("ft2526", c6, SIX, { "KC-14823": AYESHA_FT_LAST }, 88),
    papers: allPapers(["6-A", "6-B", "6-C"], SIX, "CHECKED", "Exam office", "2025-10-24T12:00:00+05:00"),
    declaredOn: "2025-10-28T13:00:00+05:00",
    declaredBy: "Mrs Sadia Rehman",
    history: [h("h1", "2025-10-28T13:00:00+05:00", "Mrs Sadia Rehman", "Results declared", "Visible in the parent portal")],
  };
  const BOARD: ExamsSubject[] = [subj("eng", 75), subj("urd", 75), subj("isl", 50), subj("mat", 75), subj("phy", 65), subj("che", 65), BIO(65), CMP(65)];
  const c9 = ["10-A", "10-B"].flatMap((cs) => examRoster("KC", cs, cs.replace("10", "9")));
  const board: ExamRecord = {
    // Students with a record keep the Part-I number on their record, so the profile and the board result agree.
    boardRollNos: Object.fromEntries(c9.map((p, i) => [p.id, (p.hasProfile ? findStudent(p.id)?.boardRollNo?.partI : undefined) ?? String(412300 + i * 3)])),
    sourceSession: 2025,
    id: "ex-board-2526",
    name: "Matric Part I (Class 9) – board result 2026",
    category: "BOARD",
    typeId: "et-board1",
    campus: "KC",
    session: 2025,
    classes: ["9-A", "9-B"],
    subjects: BOARD,
    startDate: "2026-03-15",
    status: "DECLARED",
    roster: c9,
    marks: marksFor("board2526", c9, BOARD, {}, 95),
    papers: allPapers(["9-A", "9-B"], BOARD, "CHECKED", "Exam office", "2026-08-21T11:00:00+05:00"),
    declaredOn: "2026-08-21T11:00:00+05:00",
    declaredBy: "Exam office",
    history: [h("h1", "2026-08-21T11:00:00+05:00", "Exam office", "Board marks entered and declared", "Marks as received from the board")],
  };

  // ---- Khalid Campus: Monthly Test – October 2026, Class 9 — mixed groups (Biology or Computer Science) ----
  const kc9classes = sectionsOfClass("KC", "9");
  const kc9 = kc9classes.flatMap((cs) => examRoster("KC", cs));
  const NINE_TEST: ExamsSubject[] = [subj("eng", 25), subj("mat", 25), subj("phy", 25), subj("che", 25), BIO(25), CMP(25)];
  const kc9Subjects = dateSheet(NINE_TEST, "2026-10-26", 40, SUPERVISORS);
  const kc9Marks = marksFor("mt-oct-c9", kc9, NINE_TEST, {}, 96);
  // Computer Science still being marked in the second section.
  const lateSection = kc9classes[1] ?? kc9classes[0];
  for (const p of kc9.filter((x) => x.classSection === lateSection && x.group === G_CMP).slice(0, 4)) kc9Marks[p.id] = { ...kc9Marks[p.id], cmp: null };
  const kc9Papers = allPapers(kc9classes, NINE_TEST, "SUBMITTED", "Subject teacher", "2026-10-31T13:00:00+05:00");
  if (lateSection) kc9Papers[paperKey(lateSection, "cmp")] = { status: "IN_PROGRESS", by: "Subject teacher", at: "2026-11-02T15:30:00+05:00" };
  const mt9: ExamRecord = {
    id: "ex-mt-2610-c9",
    name: "Monthly Test – October 2026",
    category: "TEST",
    typeId: "et-monthly",
    campus: "KC",
    session: 2026,
    classes: kc9classes,
    subjects: kc9Subjects,
    startDate: "2026-10-26",
    endDate: lastDate(kc9Subjects)!,
    status: "DRAFT",
    roster: kc9,
    marks: kc9Marks,
    papers: kc9Papers,
    history: [h("h1", "2026-10-20T09:10:00+05:00", "Exam office", "Exam created", "6 papers · Biology for the Science (Biology) group, Computer Science for the Science (Computer) group")],
  };

  for (const e of [ft7, ft4, mtSep, uc9exam, an, ftLast, board]) {
    e.frozen = computeRows(e, EXAMS_DEFAULT_SCALE);
    e.frozenBands = EXAMS_DEFAULT_SCALE;
  }
  return [ft7, ft8, ft4, mtSep, mt, mt9, ent, diamondExam(), uc9exam, an, ftLast, board];
}

export const EXAM_FIXTURES = buildExams;

// ---------------------------------------------------------------------------------------------------------
// Diamond Minds talent test: outside children (participants) sit it at test centres (schools). All fictional.
// ---------------------------------------------------------------------------------------------------------

export interface ProgrammeRecord {
  id: string;
  campus: CampusCode;
  session: number;
  name: string;
  kind: "TALENT_TEST";
  centres: Array<{ id: string; name: string; city: string }>;
}

export interface ParticipantRecord {
  programmeId: string;
  regNo: string;
  name: string;
  father: string;
  dob: IsoDate;
  gender: "M" | "F";
  cnic?: string;
  mobile?: string;
  address: string;
  previousSchool: string;
  currentClass: string;
  city: string;
  centreId: string;
  group?: string;
  applicantId?: string;
  applicationNo?: string;
  rowVer: number;
}

export const DIAMOND_PROGRAMME_ID = "dm-2627";
export const DIAMOND_EXAM_ID = "ex-dm-2627";

const DM_CENTRES: ProgrammeRecord["centres"] = [
  { id: "dmc-1", name: "Crescent Public School", city: "Sadiqabad" },
  { id: "dmc-2", name: "Al-Huda Model School", city: "Sadiqabad" },
  { id: "dmc-3", name: "Bright Future Academy", city: "Rahim Yar Khan" },
  { id: "dmc-4", name: "Govt. Girls High School No. 4", city: "Sadiqabad" },
  { id: "dmc-5", name: "Green Valley Grammar School", city: "Khanpur" },
];

const DM_GIRLS = ["Anaya", "Bisma", "Dua", "Eshal", "Fiza", "Hareem", "Inaya", "Laiba", "Mahnoor", "Noor", "Rida", "Sana", "Tooba", "Zainab"];
const DM_BOYS = ["Abdullah", "Ahsan", "Danish", "Ehtisham", "Faizan", "Hammad", "Irfan", "Mustafa", "Nabeel", "Owais", "Rayyan", "Saad", "Usman", "Zain"];
const DM_SURNAMES = ["Khalil", "Rasheed", "Siddiqui", "Qadir", "Rehmat", "Saleem", "Haq", "Nawaz", "Butt", "Javed", "Hanif", "Yaqoob"];
const DM_FATHERS = ["Muhammad", "Abdul", "Ghulam", "Rana", "Malik", "Hafiz"];
const DM_AREAS = ["Model Town", "Satellite Town", "Gulshan Colony", "Officers Colony", "Main Bazaar", "Railway Road"];

export function initialProgrammes(): { programmes: ProgrammeRecord[]; participants: ParticipantRecord[] } {
  const programmes: ProgrammeRecord[] = [{ id: DIAMOND_PROGRAMME_ID, campus: "KC", session: 2026, name: "Diamond Minds Talent Test 2026–27", kind: "TALENT_TEST", centres: DM_CENTRES }];
  const participants: ParticipantRecord[] = [];
  let n = 0;
  DM_CENTRES.forEach((c, ci) => {
    const size = [9, 8, 7, 8, 6][ci] ?? 6;
    for (let i = 0; i < size; i++) {
      n++;
      const rand = prng(`dm:${c.id}:${i}`);
      const girl = c.id === "dmc-4" || rand() < 0.5;
      const first = (girl ? DM_GIRLS : DM_BOYS)[Math.floor(rand() * 14)]!;
      const last = DM_SURNAMES[Math.floor(rand() * DM_SURNAMES.length)]!;
      const cls = rand() < 0.55 ? "Class 10" : "Class 9";
      const year = cls === "Class 10" ? 2011 : 2012;
      const month = 1 + Math.floor(rand() * 12);
      const day = 1 + Math.floor(rand() * 27);
      const digits = String(Math.floor(rand() * 9_000_000) + 1_000_000);
      participants.push({
        programmeId: DIAMOND_PROGRAMME_ID,
        regNo: `DM-26-${String(n).padStart(4, "0")}`,
        name: `${first} ${last}`,
        father: `${DM_FATHERS[Math.floor(rand() * DM_FATHERS.length)]!} ${last}`,
        dob: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        gender: girl ? "F" : "M",
        ...(rand() < 0.6 ? { cnic: `31303-${digits}-${(n % 9) + 1}` } : {}),
        mobile: `030${Math.floor(rand() * 10)}-${String(Math.floor(rand() * 9_000_000) + 1_000_000)}`,
        address: `House ${1 + Math.floor(rand() * 90)}, ${DM_AREAS[Math.floor(rand() * DM_AREAS.length)]!}, ${c.city}`,
        previousSchool: rand() < 0.75 ? c.name : DM_CENTRES[(ci + 1) % DM_CENTRES.length]!.name,
        currentClass: cls,
        city: c.city,
        centreId: c.id,
        group: rand() < 0.6 ? G_BIO : G_CMP,
        rowVer: 1,
      });
    }
  });
  return { programmes, participants };
}

/** Papers of the talent test: 20 marks each; Biology or Computer Science by group. */
export const DIAMOND_SUBJECTS: ExamsSubject[] = [subj("eng", 20), subj("mat", 20), subj("phy", 20), subj("che", 20), BIO(20), CMP(20)];

/** A participant as an exam candidate: the centre is their "section". */
export function participantRoster(list: ParticipantRecord[], centres: ProgrammeRecord["centres"]): ExamsRosterEntry[] {
  return renumber(
    list.map((p) => ({ id: p.regNo, name: p.name, father: p.father, classSection: centres.find((c) => c.id === p.centreId)?.name ?? p.centreId, rollNo: 0, hasProfile: false, ...(p.group ? { group: p.group } : {}), ...(p.mobile ? { mobile: p.mobile } : {}) })),
  );
}

function diamondExam(): ExamRecord {
  const { participants } = initialProgrammes();
  const roster = participantRoster(participants, DM_CENTRES);
  const subjects = DIAMOND_SUBJECTS.map((s) => ({ ...s, date: "2026-10-31", startTime: "10:00", durationMins: 120, supervisor: "Ms Uzma Shah" }));
  const marks = marksFor("dm2627", roster, DIAMOND_SUBJECTS, {}, 92);
  const absent = roster[11];
  if (absent) marks[absent.id] = Object.fromEntries(DIAMOND_SUBJECTS.filter((s) => examsSits(s, absent.group)).map((s) => [s.id, "A"]));
  const classes = DM_CENTRES.map((c) => c.name);
  return {
    id: DIAMOND_EXAM_ID,
    name: "Diamond Minds Talent Test 2026–27",
    category: "ENTRANCE",
    typeId: "et-diamond",
    campus: "KC",
    session: 2026,
    classes,
    subjects,
    startDate: "2026-10-31",
    endDate: "2026-10-31",
    status: "DRAFT",
    roster,
    marks,
    papers: allPapers(classes, DIAMOND_SUBJECTS, "SUBMITTED", "Exam office", "2026-11-02T12:00:00+05:00"),
    candidateLabel: "Participant",
    programmeId: DIAMOND_PROGRAMME_ID,
    history: [
      h("h1", "2026-10-10T10:00:00+05:00", "Exam office", "Exam created", `6 papers · ${DM_CENTRES.length} test centres`),
      h("h2", "2026-11-02T12:00:00+05:00", "Exam office", "All marks entered", "Ready to declare"),
    ],
  };
}
