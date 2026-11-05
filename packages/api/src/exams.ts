// Exams API — owned by the exams feature. One exam engine for term exams, class tests, board exams, entrance tests
// and university semesters; grading and pass rules are data; results are frozen as a snapshot when declared.
import type { IsoDate, IsoDateTime } from "@mtb/domain";
import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { ctxKey, ctxQuery, type CampusCode, type Ctx } from "./context";

/* ================================================================================================ Exam types */

export type ExamsCategory = "TERM" | "TEST" | "BOARD" | "ENTRANCE" | "UNIVERSITY";

export const EXAMS_CATEGORY_LABEL: Record<ExamsCategory, string> = {
  TERM: "Term exam",
  TEST: "Class test",
  BOARD: "Board exam",
  ENTRANCE: "Entrance test",
  UNIVERSITY: "University semester",
};

export const EXAMS_CATEGORY_HELP: Record<ExamsCategory, string> = {
  TERM: "First term, mid term, send-up and annual exams. Positions are worked out per exam.",
  TEST: "Monthly, weekly, morning and chapter tests. Positions can be worked out per month.",
  BOARD: "Marks received from the board (Matric, Intermediate) recorded against last year's class.",
  ENTRANCE: "Admission tests for applicants. The merit list is drawn in Admissions.",
  UNIVERSITY: "Degree programmes: the mid and final semester papers, and internal-assessment types (Quiz, Test, Assignment …). Each internal-assessment type becomes a marks column of a course in University → Marks entry.",
};

export type ExamsRankScope = "EXAM" | "MONTH";

export interface ExamsType {
  id: string;
  name: string;
  nameUrdu: string;
  category: ExamsCategory;
  /** EXAM: positions within this exam. MONTH: positions over all class tests of the same month. */
  rankScope: ExamsRankScope;
  /** Counts towards promotion at the end of the session. */
  countsForPromotion: boolean;
  /** Rs per paper missed without leave; 0 means no fine. */
  absenceFine: number;
  active: boolean;
  /** Exams of this type this session. */
  exams: number;
  /** A programme test (Diamond Minds): set up under Exams → Programmes, not New exam. */
  programme?: boolean;
  /**
   * The type's own papers (Hifz: Manzil 1–7, Tajweed, Dua/Namaz/Kalimay 1–5 …). When set, a new exam of this type
   * uses these papers instead of the class's subjects. Ids with a number suffix ("manzil-1") print as one group.
   */
  papers?: ExamsSubject[];
}

export type ExamsTypeInput = Omit<ExamsType, "id" | "exams">;

/* ================================================================================================ Exams */

export type ExamsResultStatus = "DRAFT" | "DECLARED";

/** A paper: one subject of an exam, with its date-sheet slot. */
export interface ExamsSubject {
  id: string;
  name: string;
  maxMarks: number;
  nameUrdu?: string;
  date?: IsoDate;
  /** "09:00" */
  startTime?: string;
  durationMins?: number;
  /** Invigilator for the paper. */
  supervisor?: string;
  /**
   * Groups (streams) that sit this paper, e.g. ["Science"] for Biology in classes 9–10. Empty or missing means
   * everyone sits it. A student outside these groups doesn't take the paper: it is neither missing nor failed.
   */
  groups?: string[];
}

/** True when a student of this group sits the paper. */
export function examsSits(subject: Pick<ExamsSubject, "groups">, group: string | undefined | null): boolean {
  if (!subject.groups || subject.groups.length === 0) return true;
  return group != null && subject.groups.includes(group);
}

const GROUP_SHORT: Record<string, string> = { "Science (Biology)": "Bio", "Science (Computer)": "Comp", Humanities: "Hum", Science: "Bio", "Computer Science": "Comp" };

/** Short group code for narrow print columns (Setup's short names): "Science (Biology)" → "Bio". */
export function examsGroupShort(group: string | undefined | null): string {
  if (!group) return "";
  return GROUP_SHORT[group] ?? (group.length > 6 ? group.slice(0, 5) + "." : group);
}

export interface ExamsReopenRequest {
  id: string;
  reason: string;
  requestedBy: string;
  requestedAt: IsoDateTime;
  status: "PENDING" | "APPROVED" | "REJECTED";
  decidedBy?: string;
  decidedAt?: IsoDateTime;
}

export interface ExamsHistoryItem {
  id: string;
  at: IsoDateTime;
  by: string;
  action: string;
  detail?: string;
}

/** Where one class-section's marks for one subject stand. */
export type ExamsPaperStatus = "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED" | "CHECKED";

export const EXAMS_PAPER_STATUS_LABEL: Record<ExamsPaperStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Submitted",
  CHECKED: "Checked",
};

export interface ExamsPaper {
  classSection: string;
  subjectId: string;
  subjectName: string;
  maxMarks: number;
  /** Subject teacher for this section. */
  teacher: string | null;
  status: ExamsPaperStatus;
  /** Marks entered (absent and leave count as entered). */
  entered: number;
  candidates: number;
  absent: number;
  leave: number;
  updatedAt?: IsoDateTime;
  updatedBy?: string;
  /** Why the exam office returned it to the teacher. */
  note?: string;
}

export interface ExamSummary {
  id: string;
  name: string;
  category: ExamsCategory;
  typeId?: string;
  typeName?: string;
  campus: CampusCode;
  session: number;
  /** "7-A", "7-B" … (applicant groups for entrance tests) */
  classes: string[];
  subjects: ExamsSubject[];
  totalMax: number;
  startDate: IsoDate;
  endDate?: IsoDate;
  status: ExamsResultStatus;
  students: number;
  /** Marks not yet entered. Declaring is blocked until this is 0. Absent and leave are entered values, not missing. */
  missingMarks: number;
  /** Class-section × subject papers, and how many are submitted or checked. */
  papersTotal: number;
  papersDone: number;
  declaredOn?: IsoDateTime;
  declaredBy?: string;
  reopen?: ExamsReopenRequest;
  /** For entrance tests: candidates are applicants, not enrolled students. Programme tests (Diamond Minds) have participants. */
  candidateLabel?: "Student" | "Applicant" | "Participant";
  /** Set for a programme test (Diamond Minds): its sections are test centres. */
  programmeId?: string;
  /** Board results: the session the students sat the board exam in (last year's class). */
  sourceSession?: number;
  /** Groups (streams) among the candidates, when the class has any. */
  groups?: string[];
  /** Name of the grade scale the results use. */
  scaleName?: string;
}

/**
 * One mark: a number, "A" for absent (counts as 0, is different from 0 and may be fined), "L" for on leave
 * (counts as 0, never fined), or null when not entered yet.
 */
export type ExamsMark = number | "A" | "L" | null;

export type ExamsResultCode = "PASS" | "SUPPLY" | "FAIL" | "INCOMPLETE" | "WITHHELD";

export const EXAMS_RESULT_LABEL: Record<ExamsResultCode, string> = {
  PASS: "Pass",
  SUPPLY: "Re-sit",
  FAIL: "Fail",
  INCOMPLETE: "Incomplete",
  WITHHELD: "Withheld",
};

export const EXAMS_RESULT_LABEL_UR: Record<ExamsResultCode, string> = {
  PASS: "کامیاب",
  SUPPLY: "سپلی",
  FAIL: "ناکام",
  INCOMPLETE: "نامکمل",
  WITHHELD: "روکا گیا",
};

export interface ExamsResultRow {
  /** G.R. number, or application number for entrance tests. */
  id: string;
  name: string;
  father?: string;
  classSection: string;
  rollNo: number;
  /** True when this person has a student profile to open. */
  hasProfile: boolean;
  marks: Record<string, ExamsMark>;
  obtained: number;
  max: number;
  /** null while marks are missing. */
  percent: number | null;
  grade: string | null;
  /** Dense rank by % within the class-section; null while marks are missing or the result is withheld. */
  position: number | null;
  /** Dense rank by % across every section of the exam. */
  classPosition?: number | null;
  missing: number;
  result?: ExamsResultCode;
  /** Subjects below the pass mark (absent and leave included). */
  failedSubjects?: string[];
  absentPapers?: number;
  leavePapers?: number;
  /** Reason the result is withheld (unpaid dues, unfair means …). */
  withheld?: string;
  /** Group (stream) for classes 9–10. Papers outside it are left out of `marks`, `max` and `missing`. */
  group?: string;
  /** Free-text remark from the class teacher, printed on the result card. */
  teacherRemark?: string;
  /** Board roll number (board results only). */
  boardRollNo?: string;
  /** Home address, for the result card (students with a profile). */
  address?: string;
  /** Boy or girl, for the gender filter on prints and analysis. */
  gender?: ExamsGender;
  /** Guardian's mobile, for the Contact column of the master sheet. */
  guardianMobile?: string;
}

export interface ExamsPassRules {
  /** % of a paper's maximum needed to pass that subject. */
  subjectPassPercent: number;
  /** Overall % needed to pass. */
  overallPassPercent: number;
  /** Failing this many subjects or fewer (and at least one) means a re-sit ("supply"), not a fail. */
  supplyMaxSubjects: number;
}

export const EXAMS_DEFAULT_PASS_RULES: ExamsPassRules = { subjectPassPercent: 33, overallPassPercent: 33, supplyMaxSubjects: 2 };

export interface ExamDetail extends ExamSummary {
  rows: ExamsResultRow[];
  history: ExamsHistoryItem[];
  papers?: ExamsPaper[];
  /** The grade bands the results use: frozen at declaration, the current rules while in draft. */
  bands?: ExamsGradeBand[];
  passRules?: ExamsPassRules;
  /** Rs per paper missed without leave. */
  absenceFine?: number;
}

export interface ExamsCreateInput {
  typeId: string;
  name: string;
  /** Class-sections, e.g. ["9-A", "9-B"]. For a programme test: centre ids. */
  classes: string[];
  subjects: ExamsSubject[];
  /**
   * Board results only: the session the students sat the board exam in. The roster comes from that session's
   * sections (students since promoted are included), and the exam is labelled with last year's class.
   */
  sourceSession?: number;
  /** A programme test (Diamond Minds): candidates are the programme's participants at the chosen centres. */
  programmeId?: string;
}

/** Subjects and sections of one class at a campus, used to start a new exam. */
export interface ExamsClassTemplate {
  classShort: string;
  className: string;
  /** `groups`: students per group (stream), for classes that have groups. */
  sections: Array<{ classSection: string; students: number; groups?: Record<string, number> }>;
  subjects: ExamsSubject[];
  /** Groups (streams) offered in this class; papers with `groups` are sat only by those groups. */
  groups?: string[];
}

export interface ExamsMarksInput {
  classSection: string;
  subjectId: string;
  /** personId → mark; only the people sent are changed. */
  marks: Record<string, ExamsMark>;
  /** Board exams only: personId → board roll no. (4 to 9 digits; "" clears it). Kept on the student's record too. */
  boardRollNos?: Record<string, string>;
}

export interface ExamsMarksSaved {
  savedAt: IsoDateTime;
  saved: number;
  paper: ExamsPaper;
  missingMarks: number;
}

export type ExamsPaperAction = "SUBMIT" | "CHECK" | "RETURN";

/* ================================================================================================ Grading */

export interface ExamsGradeBand {
  grade: string;
  /** Lowest whole %, inclusive. */
  min: number;
  /** Highest whole %, inclusive: 79 means everything below 80. */
  max: number;
  remark: string;
}

/**
 * One grade scale. There can be several: the most specific scale whose `appliesTo` matches an exam's kind and
 * class is used (a class match beats a kind-only match; "Standard" applies to everything else).
 */
export interface ExamsGradeScale {
  id: string;
  name: string;
  /** Empty lists mean "every kind" / "every class". */
  appliesTo: { categories: ExamsCategory[]; classes: string[] };
  bands: ExamsGradeBand[];
  passRules?: ExamsPassRules;
  updatedBy: string;
  updatedAt: IsoDateTime;
  rowVer: number;
  /** The fallback scale: it can't be removed and applies to everything. */
  standard?: boolean;
}

export interface ExamsGradeScaleInput {
  name: string;
  appliesTo: { categories: ExamsCategory[]; classes: string[] };
  bands: ExamsGradeBand[];
  passRules: ExamsPassRules;
  /** rowVer the edit started from (409 when someone else saved in between). */
  rowVer?: number;
}

/** Picks the scale for an exam: a class match beats a kind match; the standard scale is the fallback. */
export function examsScaleFor<T extends Pick<ExamsGradeScale, "appliesTo" | "standard">>(scales: T[], category: ExamsCategory, classShort: string): T | undefined {
  const score = (s: T) => {
    const cats = s.appliesTo.categories;
    const cls = s.appliesTo.classes;
    if (cats.length && !cats.includes(category)) return -1;
    if (cls.length && !cls.includes(classShort)) return -1;
    return (cls.length ? 2 : 0) + (cats.length ? 1 : 0);
  };
  return [...scales].map((s) => ({ s, n: score(s) })).filter((x) => x.n >= 0).sort((a, b) => b.n - a.n || Number(Boolean(a.s.standard)) - Number(Boolean(b.s.standard)))[0]?.s ?? scales.find((s) => s.standard);
}

/** The brief's scale (§7.9). */
export const EXAMS_DEFAULT_SCALE: ExamsGradeBand[] = [
  { grade: "A+", min: 80, max: 100, remark: "Outstanding" },
  { grade: "A", min: 70, max: 79, remark: "Excellent" },
  { grade: "B", min: 60, max: 69, remark: "Very good" },
  { grade: "C", min: 50, max: 59, remark: "Good" },
  { grade: "D", min: 40, max: 49, remark: "Fair" },
  { grade: "E", min: 33, max: 39, remark: "Pass" },
  { grade: "F", min: 0, max: 32, remark: "Fail" },
];

/** The old desktop system's scale (≥ thresholds, no D), shown for comparison only — not yet decided. */
export const EXAMS_LEGACY_SCALE: ExamsGradeBand[] = [
  { grade: "A+", min: 80, max: 100, remark: "" },
  { grade: "A", min: 70, max: 79, remark: "" },
  { grade: "B", min: 60, max: 69, remark: "" },
  { grade: "C", min: 45, max: 59, remark: "" },
  { grade: "E", min: 33, max: 44, remark: "" },
  { grade: "F", min: 0, max: 32, remark: "" },
];

/** Grade for a %: a band covers min ≤ % < max + 1 (100 included in the top band). */
export function examsGradeFor(percent: number, bands: ExamsGradeBand[]): string | null {
  const hit = bands.find((b) => percent >= b.min && (percent < b.max + 1 || (b.max >= 100 && percent <= 100)));
  return hit?.grade ?? null;
}

export interface ExamsBandIssue {
  /** Row indexes the issue is about (for highlighting). */
  rows: number[];
  message: string;
}

/** Live checks for the grading table: every whole % from 0 to 100 has exactly one grade. */
export function examsValidateBands(bands: ExamsGradeBand[]): ExamsBandIssue[] {
  const issues: ExamsBandIssue[] = [];
  bands.forEach((b, i) => {
    if (!b.grade.trim()) issues.push({ rows: [i], message: `Row ${i + 1} has no grade name.` });
    if (!Number.isInteger(b.min) || !Number.isInteger(b.max) || b.min < 0 || b.max > 100) issues.push({ rows: [i], message: `${b.grade || `Row ${i + 1}`}: use whole numbers from 0 to 100.` });
    else if (b.min > b.max) issues.push({ rows: [i], message: `${b.grade || `Row ${i + 1}`}: the minimum (${b.min}%) is above the maximum (${b.max}%).` });
  });
  const names = bands.map((b) => b.grade.trim().toUpperCase());
  names.forEach((n, i) => {
    const j = names.indexOf(n);
    if (n && j !== i) issues.push({ rows: [j, i], message: `Grade ${bands[i]!.grade} appears twice.` });
  });
  const order = bands
    .map((b, i) => ({ ...b, i }))
    .filter((b) => Number.isInteger(b.min) && Number.isInteger(b.max) && b.min <= b.max)
    .sort((a, b) => a.min - b.min);
  const first = order[0];
  const last = order[order.length - 1];
  if (first && first.min > 0) issues.push({ rows: [first.i], message: `Gap: no grade for 0–${first.min - 1}%.` });
  if (last && last.max < 100) issues.push({ rows: [last.i], message: `Gap: no grade for ${last.max + 1}–100%.` });
  for (let k = 1; k < order.length; k++) {
    const prev = order[k - 1]!;
    const cur = order[k]!;
    if (cur.min <= prev.max) issues.push({ rows: [prev.i, cur.i], message: `Overlap: ${prev.grade} (${prev.min}–${prev.max}%) and ${cur.grade} (${cur.min}–${cur.max}%) both cover ${cur.min}–${Math.min(prev.max, cur.max)}%.` });
    else if (cur.min > prev.max + 1) issues.push({ rows: [prev.i, cur.i], message: `Gap: no grade for ${prev.max + 1}–${cur.min - 1}% (between ${cur.grade} and ${prev.grade}).` });
  }
  return issues;
}

/** Plain-English checks for the pass rules. */
export function examsValidatePassRules(r: ExamsPassRules): string[] {
  const out: string[] = [];
  if (!Number.isInteger(r.subjectPassPercent) || r.subjectPassPercent < 1 || r.subjectPassPercent > 100) out.push("Subject pass mark: use a whole % from 1 to 100.");
  if (!Number.isInteger(r.overallPassPercent) || r.overallPassPercent < 1 || r.overallPassPercent > 100) out.push("Overall pass mark: use a whole % from 1 to 100.");
  if (!Number.isInteger(r.supplyMaxSubjects) || r.supplyMaxSubjects < 0 || r.supplyMaxSubjects > 5) out.push("Re-sit subjects: use a whole number from 0 to 5.");
  return out;
}

/** Marks for one subject mark: a mark of 30 out of 75 at 33% → pass mark 25 (rounded up). */
export const examsPassMark = (maxMarks: number, rules: ExamsPassRules) => Math.ceil((maxMarks * rules.subjectPassPercent) / 100);

/* ================================================================================================ Analysis (pure) */

export interface ExamsSubjectStat {
  subjectId: string;
  name: string;
  maxMarks: number;
  /** Students with a mark (absent and leave count as sat with 0 for averages). */
  sat: number;
  absent: number;
  average: number;
  averagePercent: number;
  passRate: number;
  passed: number;
  /** Students who sat the paper and scored below the pass mark (absent and leave are counted in `absent`). */
  failed: number;
  highest: number;
  lowest: number;
  top?: { name: string; classSection: string; mark: number };
  /** Subject teacher, when one section is analysed. */
  teacher?: string | null;
}

export interface ExamsSectionStat {
  classSection: string;
  subjectId: string;
  subjectName: string;
  teacher: string | null;
  averagePercent: number;
  passRate: number;
  sat: number;
}

export interface ExamsAnalysis {
  complete: number;
  averagePercent: number | null;
  passRate: number | null;
  counts: Record<ExamsResultCode, number>;
  grades: Array<{ grade: string; count: number }>;
  subjects: ExamsSubjectStat[];
  sections: ExamsSectionStat[];
  top: ExamsResultRow[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Rows of one gender, or everyone (gender undefined). */
export const examsOfGender = (gender: ExamsGender | undefined) => (r: { gender?: ExamsGender }) => !gender || r.gender === gender;

/** Subject-wise analysis for an exam (optionally one section, boys or girls only): averages, pass rates, top ten, grade spread. */
export function examsAnalyse(exam: Pick<ExamDetail, "rows" | "subjects" | "papers" | "bands" | "passRules">, section = "ALL", opts: { gender?: ExamsGender } = {}): ExamsAnalysis {
  const rules = exam.passRules ?? EXAMS_DEFAULT_PASS_RULES;
  const rows = exam.rows.filter((r) => (section === "ALL" || r.classSection === section) && examsOfGender(opts.gender)(r));
  const complete = rows.filter((r) => r.percent !== null && r.result !== "WITHHELD");
  const counts: Record<ExamsResultCode, number> = { PASS: 0, SUPPLY: 0, FAIL: 0, INCOMPLETE: 0, WITHHELD: 0 };
  for (const r of rows) counts[r.result ?? (r.percent === null ? "INCOMPLETE" : "PASS")]++;
  const bandOrder = (exam.bands ?? EXAMS_DEFAULT_SCALE).map((b) => b.grade);
  const grades = bandOrder.map((g) => ({ grade: g, count: complete.filter((r) => r.grade === g).length }));
  const subjects: ExamsSubjectStat[] = exam.subjects.map((s) => {
    const pass = examsPassMark(s.maxMarks, rules);
    const vals = rows.map((r) => ({ r, m: r.marks[s.id] ?? null })).filter((x) => x.m !== null);
    const nums = vals.map((x) => (typeof x.m === "number" ? x.m : 0));
    const absent = vals.filter((x) => x.m === "A" || x.m === "L").length;
    const passed = vals.filter((x) => typeof x.m === "number" && x.m >= pass).length;
    const failed = vals.filter((x) => typeof x.m === "number" && x.m < pass).length;
    const best = vals.filter((x) => typeof x.m === "number").sort((a, b) => (b.m as number) - (a.m as number))[0];
    const avg = nums.length ? nums.reduce((a, v) => a + v, 0) / nums.length : 0;
    return {
      subjectId: s.id,
      name: s.name,
      maxMarks: s.maxMarks,
      sat: vals.length,
      absent,
      average: round1(avg),
      averagePercent: round1((avg / s.maxMarks) * 100),
      passRate: vals.length ? round1((passed / vals.length) * 100) : 0,
      passed,
      failed,
      highest: nums.length ? Math.max(...nums) : 0,
      lowest: nums.length ? Math.min(...nums) : 0,
      ...(best ? { top: { name: best.r.name, classSection: best.r.classSection, mark: best.m as number } } : {}),
      ...(section !== "ALL" ? { teacher: exam.papers?.find((p) => p.classSection === section && p.subjectId === s.id)?.teacher ?? null } : {}),
    };
  });
  const sectionNames = [...new Set(rows.map((r) => r.classSection))];
  const sections: ExamsSectionStat[] = [];
  for (const cs of sectionNames) {
    for (const s of exam.subjects) {
      const pass = examsPassMark(s.maxMarks, rules);
      const vals = rows.filter((r) => r.classSection === cs).map((r) => r.marks[s.id] ?? null).filter((m) => m !== null);
      const nums = vals.map((m) => (typeof m === "number" ? m : 0));
      const avg = nums.length ? nums.reduce((a, v) => a + v, 0) / nums.length : 0;
      sections.push({
        classSection: cs,
        subjectId: s.id,
        subjectName: s.name,
        teacher: exam.papers?.find((p) => p.classSection === cs && p.subjectId === s.id)?.teacher ?? null,
        averagePercent: round1((avg / s.maxMarks) * 100),
        passRate: vals.length ? round1((vals.filter((m) => typeof m === "number" && m >= pass).length / vals.length) * 100) : 0,
        sat: vals.length,
      });
    }
  }
  const passedAll = complete.filter((r) => r.result === "PASS").length;
  return {
    complete: complete.length,
    averagePercent: complete.length ? round1(complete.reduce((a, r) => a + (r.percent ?? 0), 0) / complete.length) : null,
    passRate: complete.length ? round1((passedAll / complete.length) * 100) : null,
    counts,
    grades,
    subjects,
    sections,
    top: [...complete].sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0) || a.name.localeCompare(b.name)).slice(0, 10),
  };
}

/* ================================================================================================ Combined results */

export interface ExamsCombinedPart {
  id: string;
  name: string;
  category: ExamsCategory;
  /** Share of the combined result, in %. */
  weight: number;
  totalMax: number;
  status: ExamsResultStatus;
  startDate?: IsoDate;
  typeName?: string;
}

/** One subject of a combined result: each part's mark (null when the exam had no such paper for the student). */
export interface ExamsCombinedSubject {
  parts: Record<string, { mark: ExamsMark; max: number } | null>;
  obtained: number;
  max: number;
}

export interface ExamsCombinedRow {
  id: string;
  name: string;
  father?: string;
  classSection: string;
  rollNo: number;
  hasProfile: boolean;
  /** examId → result in that exam, or null when the student has no complete result in it. */
  parts: Record<string, { obtained: number; max: number; percent: number; grade?: string | null; position?: number | null; result?: ExamsResultCode } | null>;
  /** Weighted % (or the plain average of the parts the student has); null while a part is missing in weighted mode. */
  percent: number | null;
  grade: string | null;
  position: number | null;
  classPosition: number | null;
  result: "PASS" | "FAIL" | "INCOMPLETE";
  /** Sum of the parts' obtained and maximum marks. */
  obtained?: number;
  max?: number;
  /** subjectId → marks in each part and the cumulative total. */
  bySubject?: Record<string, ExamsCombinedSubject>;
  gender?: ExamsGender;
  group?: string;
  /** Last session's final (latest declared term exam) %, when asked for. Not counted in the combined result. */
  lastPercent?: number | null;
  /** Parts the student has a result in (average mode). */
  partsCounted?: number;
}

export type ExamsCombinedMode = "WEIGHTED" | "AVERAGE";

export interface ExamsCombinedOptions {
  /** Add each student's last-session final %. */
  includeLast?: boolean;
  /** AVERAGE: plain mean over the parts a student has, instead of incomplete when one is missing. */
  mode?: ExamsCombinedMode;
}

export interface ExamsCombined {
  classShort: string;
  parts: ExamsCombinedPart[];
  rows: ExamsCombinedRow[];
  /** Every subject across the parts, in paper order. */
  subjects?: Array<{ id: string; name: string }>;
  mode?: ExamsCombinedMode;
  /** The exam the "Last exam %" column comes from, when asked for. */
  lastExam?: { name: string; session: number } | null;
}

/** Exams that can be combined for one class (the picker on the combined-results page). */
export interface ExamsCombinable {
  classShort: string;
  className: string;
  exams: Array<{ id: string; name: string; category: ExamsCategory; status: ExamsResultStatus; startDate: IsoDate; totalMax: number }>;
}

/* ================================================================================================ Merit lists */

export interface ExamsMeritRow {
  /** Standard competition rank: equal % share a rank and the next rank is skipped (1, 2, 2, 4). */
  rank: number;
  id: string;
  name: string;
  father?: string;
  classSection: string;
  obtained: number;
  max: number;
  percent: number;
  grade: string | null;
  hasProfile: boolean;
}

export interface ExamsMeritList {
  /** Set once the list is saved. */
  id?: string;
  /** "MER-KC-2627-003" */
  listNo?: string;
  title: string;
  purpose?: string;
  examId: string;
  examName: string;
  classes: string[];
  top: number;
  rows: ExamsMeritRow[];
  campus: CampusCode;
  session: number;
  createdAt?: IsoDateTime;
  createdBy?: string;
  /** Rows beyond `top` included because they tie at the cut-off. */
  tiedAtCutOff: number;
}

export interface ExamsMeritQuery {
  examId: string;
  /** Class-sections to include; empty means every section of the exam. */
  classes?: string[];
  top: number;
}

export interface ExamsMeritSaveInput extends ExamsMeritQuery {
  title: string;
  purpose: string;
}

/* ================================================================================================ Student history */

export interface ExamsPersonHit {
  id: string;
  name: string;
  father?: string;
  classSection: string;
  campus: CampusCode;
  hasProfile: boolean;
  /** A university student: open their transcript (University → Transcripts) instead. */
  university?: { semesterId: string; programmeShort: string };
}

export interface ExamsHistoryEntry {
  examId: string;
  exam: string;
  category: ExamsCategory;
  typeId?: string;
  /** Exam type name ("Monthly Test"), for the exam-type filter. */
  typeName?: string;
  session: number;
  classSection: string;
  startDate: IsoDate;
  declaredOn?: IsoDateTime;
  obtained: number;
  max: number;
  percent: number | null;
  grade: string | null;
  position: number | null;
  classPosition: number | null;
  result: ExamsResultCode;
  /** Each paper: its date, mark, % and grade (A and L count as 0 %). */
  subjects: Array<{ subjectId: string; name: string; mark: ExamsMark; max: number; date?: IsoDate; percent?: number | null; grade?: string | null }>;
}

export interface ExamsStudentHistory {
  person: ExamsPersonHit & { group?: string; guardianMobile?: string; address?: string };
  entries: ExamsHistoryEntry[];
}

/* ================================================================================================ Teacher performance */

export type ExamsClassLevel = "PRIMARY" | "MIDDLE" | "SECONDARY";

export const EXAMS_LEVEL_LABEL: Record<ExamsClassLevel, string> = { PRIMARY: "Primary (Prep–5)", MIDDLE: "Middle (6–8)", SECONDARY: "Secondary (9–10)" };

/** Class level of a class: Prep–5 primary, 6–8 middle, 9–10 secondary. */
export function examsLevelOf(classShort: string): ExamsClassLevel {
  const n = classShort === "Prep" ? 0 : Number(classShort);
  return n <= 5 ? "PRIMARY" : n <= 8 ? "MIDDLE" : "SECONDARY";
}

/** One teacher's paper in one exam and section. */
export interface ExamsTeacherPerfRow {
  teacher: string;
  subjectId: string;
  subjectName: string;
  classSection: string;
  examId: string;
  examName: string;
  examType: string;
  startDate: IsoDate;
  status: ExamsResultStatus;
  /** Students with a mark (absent and leave included). */
  sat: number;
  averagePercent: number;
  passRate: number;
  absent: number;
  failed: number;
  /** Students below the pass mark (names). */
  failedNames: string[];
}

export interface ExamsTeacherPerfQuery {
  teacher?: string;
  subject?: string;
  level?: ExamsClassLevel;
  examTypeId?: string;
  /** "2026-10" */
  month?: string;
  gender?: ExamsGender;
}

export interface ExamsTeacherPerf {
  rows: ExamsTeacherPerfRow[];
  /** Every teacher, subject and exam type in scope, for the filters. */
  teachers: string[];
  subjects: Array<{ id: string; name: string }>;
  examTypes: Array<{ id: string; name: string }>;
  months: string[];
}

/* ================================================================================================ University */

export interface ExamsUniGpaBand {
  grade: string;
  min: number;
  points: number;
}

/** University grade points (4.0 scale), applied to each course's total %. */
export const EXAMS_UNI_GPA_SCALE: ExamsUniGpaBand[] = [
  { grade: "A", min: 85, points: 4.0 },
  { grade: "A-", min: 80, points: 3.7 },
  { grade: "B+", min: 75, points: 3.3 },
  { grade: "B", min: 70, points: 3.0 },
  { grade: "B-", min: 65, points: 2.7 },
  { grade: "C+", min: 61, points: 2.3 },
  { grade: "C", min: 58, points: 2.0 },
  { grade: "C-", min: 55, points: 1.7 },
  { grade: "D+", min: 53, points: 1.3 },
  { grade: "D", min: 50, points: 1.0 },
  { grade: "F", min: 0, points: 0 },
];

/** Minimum class attendance to sit the final exam. */
export const EXAMS_UNI_MIN_ATTENDANCE = 75;
/** CGPA below this puts a student on probation. */
export const EXAMS_UNI_PROBATION_CGPA = 2.0;

export function examsUniGradeFor(percent: number): ExamsUniGpaBand {
  return EXAMS_UNI_GPA_SCALE.find((b) => percent >= b.min) ?? EXAMS_UNI_GPA_SCALE[EXAMS_UNI_GPA_SCALE.length - 1]!;
}

/**
 * One internal-assessment component of a course (Quiz, Test, Assignment, Presentation, General Behaviour). The
 * components come from the University exam types; their maxima add up to the course's sessional maximum.
 */
export interface ExamsUniComponent {
  typeId: string;
  label: string;
  max: number;
  /** When it was taken, for the student history. */
  date?: IsoDate;
}

export interface ExamsUniCourse {
  id: string;
  code: string;
  title: string;
  creditHours: number;
  /**
   * The course is a class subject in Setup, which holds its credit hours: they show read-only here and a save must
   * send the same value (change them in Setup › Subjects › Class subjects). Set while the semester is open.
   */
  creditHoursFromSetup?: boolean;
  teacher: string;
  /** Sum of the components' maxima. */
  sessionalMax: number;
  midMax: number;
  finalMax: number;
  components: ExamsUniComponent[];
  /** Exam supervisor (invigilator) for the mid and final papers. */
  supervisor?: string;
  midDate?: IsoDate;
  finalDate?: IsoDate;
  durationMins?: number;
}

/** One component mark: a number, A (absent), L (leave, counts as 0 like absent) or not entered. */
export type ExamsUniPart = number | "A" | "L" | null;

/** Marks for one course: internal assessment (one mark per component; `sessional` is their sum), mid and final papers, and class attendance %. */
export interface ExamsUniMark {
  sessional: number | null;
  mid: ExamsUniPart;
  final: ExamsUniPart;
  attendance: number | null;
  /** typeId → mark. `sessional` is worked out from these when the course has components. */
  parts?: Record<string, ExamsUniPart>;
  /** Teacher's note for this student in this course. */
  remark?: string;
}

export type ExamsUniCourseStatus = "PASS" | "FAIL" | "SHORT_ATTENDANCE" | "INCOMPLETE";

export interface ExamsUniCourseResult {
  total: number | null;
  percent: number | null;
  grade: string | null;
  points: number | null;
  status: ExamsUniCourseStatus;
}

export type ExamsUniStanding = "GOOD" | "PROBATION" | "INCOMPLETE";

export interface ExamsUniStudentRow {
  /** Registration number, e.g. "KC-BSCS-25-014". */
  id: string;
  name: string;
  father: string;
  marks: Record<string, ExamsUniMark>;
  results: Record<string, ExamsUniCourseResult>;
  /** Mid-semester % (sessional + mid only), for the mid master sheet. */
  midPercent: number | null;
  /** Sessional + mid over every course, for the mid master sheet. */
  midObtained: number;
  midMax: number;
  /** Grade for the mid % on the school scale; null while marks are missing. */
  midGrade: string | null;
  /** Dense rank by mid %; null while marks are missing. */
  midPosition: number | null;
  /** Guardian's mobile, for the Contact column. */
  guardianMobile?: string;
  /** Course codes where sessional + mid is below the pass mark (remarks column). */
  belowPassCourses: string[];
  gpa: number | null;
  cgpa: number | null;
  creditsAttempted: number;
  creditsEarned: number;
  standing: ExamsUniStanding;
}

export interface ExamsUniSemesterSummary {
  id: string;
  programmeId: string;
  number: number;
  /** "Semester 3 · Fall 2026" */
  label: string;
  session: number;
  status: ExamsResultStatus;
  students: number;
  courseCount: number;
  missing: number;
  declaredOn?: IsoDateTime;
}

export interface ExamsUniProgramme {
  id: string;
  campus: CampusCode;
  /** "BSCS" */
  short: string;
  name: string;
  years: number;
  semesters: ExamsUniSemesterSummary[];
  /** Default internal-assessment components for new courses (BSCS: Quiz, Test, Assignment). */
  components: ExamsUniComponent[];
  /** Students enrolled in the programme (any semester), for setting up the next semester. */
  students: Array<{ id: string; name: string; father: string }>;
}

export interface ExamsUniProgrammeInput {
  short: string;
  name: string;
  years: number;
  /** University exam type ids for the default components, with their maxima. */
  components: Array<{ typeId: string; max: number }>;
}

export interface ExamsUniSemesterInput {
  programmeId: string;
  number: number;
  /** "Fall 2026" (the semester number is added in front). */
  label: string;
  session: number;
  /** Students carried over from the programme. */
  studentIds: string[];
  /** New students joining this semester; registration numbers are given automatically. */
  newStudents?: Array<{ name: string; father: string }>;
}

export interface ExamsUniCourseInput {
  /** Keep the id to edit an existing course; leave it out to add one. */
  id?: string;
  code: string;
  title: string;
  creditHours: number;
  teacher: string;
  /** Internal assessment; the sessional maximum is their sum. */
  components: Array<{ typeId: string; max: number; date?: IsoDate }>;
  midMax: number;
  finalMax: number;
  midDate?: IsoDate;
  finalDate?: IsoDate;
  durationMins?: number;
  supervisor?: string;
}

/** One assessment in a university student's history. */
export interface ExamsUniAssessment {
  date?: IsoDate;
  semesterId: string;
  semesterLabel: string;
  courseCode: string;
  courseTitle: string;
  /** University exam type id ("et-uni-quiz", "et-uni-mid" …) and its name. */
  typeId: string;
  examType: string;
  obtained: number | "A" | "L";
  max: number;
  percent: number;
  grade: string | null;
}

export interface ExamsUniSemester extends ExamsUniSemesterSummary {
  programmeShort: string;
  programmeName: string;
  campus: CampusCode;
  courses: ExamsUniCourse[];
  rows: ExamsUniStudentRow[];
  history: ExamsHistoryItem[];
  declaredBy?: string;
}

export interface ExamsUniMarksInput {
  courseId: string;
  marks: Record<string, ExamsUniMark>;
}

export interface ExamsUniTranscript {
  id: string;
  name: string;
  father: string;
  programmeShort: string;
  programmeName: string;
  campus: CampusCode;
  semesters: Array<{
    id: string;
    label: string;
    status: ExamsResultStatus;
    courses: Array<{ code: string; title: string; creditHours: number; grade: string | null; points: number | null; status: ExamsUniCourseStatus }>;
    gpa: number | null;
    cgpa: number | null;
    credits: number;
  }>;
  cgpa: number | null;
  creditsEarned: number;
  /** Every marked assessment (components, mid and final papers), oldest first. */
  assessments: ExamsUniAssessment[];
  counts: { tests: number; absents: number; leaves: number };
}

/* ================================================================================================ Programmes (Diamond Minds) */

/** A test centre: a school where the talent test is held. */
export interface ExamsProgrammeCentre {
  id: string;
  /** School name. */
  name: string;
  city: string;
}

/** An assessment programme for outside children (the Diamond Minds talent test). */
export interface ExamsProgramme {
  id: string;
  campus: CampusCode;
  session: number;
  name: string;
  kind: "TALENT_TEST";
  centres: ExamsProgrammeCentre[];
  participants: number;
  /** The programme's test in the exam engine, once set up. */
  examId?: string;
  examStatus?: ExamsResultStatus;
}

export type ExamsGender = "M" | "F";

/** A child registered for a programme. Not a student: no G.R. number until admitted. */
export interface ExamsParticipant {
  /** "DM-26-0001" */
  regNo: string;
  name: string;
  father: string;
  dob: IsoDate;
  gender: ExamsGender;
  /** B-form or CNIC, when given. */
  cnic?: string;
  mobile?: string;
  address: string;
  /** School the child attends now. */
  previousSchool: string;
  /** Class the child is in now ("Class 9"). */
  currentClass: string;
  city: string;
  centreId: string;
  /** Group (stream) for classes 9–10. */
  group?: string;
  /** Admissions applicant created from this participant. */
  applicantId?: string;
  applicationNo?: string;
  rowVer: number;
  /** Test result once marks are in (null while incomplete). */
  result?: { obtained: number; max: number; percent: number | null; grade: string | null; position: number | null; failedSubjects: string[] };
}

export type ExamsParticipantInput = Omit<ExamsParticipant, "regNo" | "applicantId" | "applicationNo" | "rowVer" | "result">;

export interface ExamsParticipantQuery {
  q?: string;
  centre?: string;
  gender?: ExamsGender;
  group?: string;
  school?: string;
}

/* ================================================================================================ Client */

const j = encodeURIComponent;

export const examsApi = {
  list: (ctx: Ctx) => apiFetch<ExamSummary[]>("/exams", { query: ctxQuery(ctx) }),
  get: (id: string) => apiFetch<ExamDetail>(`/exams/${j(id)}`),
  create: (ctx: Ctx, body: ExamsCreateInput) => apiFetch<ExamDetail>("/exams", { method: "POST", body, query: ctxQuery(ctx) }),
  templates: (ctx: Ctx) => apiFetch<ExamsClassTemplate[]>("/exams-templates", { query: ctxQuery(ctx) }),
  saveDateSheet: (id: string, subjects: ExamsSubject[]) => apiFetch<ExamDetail>(`/exams/${j(id)}/datesheet`, { method: "PUT", body: { subjects } }),
  saveMarks: (id: string, body: ExamsMarksInput) => apiFetch<ExamsMarksSaved>(`/exams/${j(id)}/marks`, { method: "PUT", body }),
  paperAction: (id: string, body: { classSection: string; subjectId: string; action: ExamsPaperAction; note?: string }) => apiFetch<ExamDetail>(`/exams/${j(id)}/papers`, { method: "POST", body }),
  withhold: (id: string, personId: string, reason: string | null) => apiFetch<ExamDetail>(`/exams/${j(id)}/withhold`, { method: "POST", body: { personId, reason } }),
  declare: (id: string, opts: { notifyParents?: boolean } = {}) => apiFetch<ExamDetail>(`/exams/${j(id)}/declare`, { method: "POST", body: opts }),
  requestReopen: (id: string, reason: string) => apiFetch<ExamDetail>(`/exams/${j(id)}/reopen`, { method: "POST", body: { reason } }),
  decideReopen: (id: string, decision: "APPROVE" | "REJECT") => apiFetch<ExamDetail>(`/exams/${j(id)}/reopen/decide`, { method: "POST", body: { decision } }),

  types: (ctx: Ctx) => apiFetch<ExamsType[]>("/exams-types", { query: ctxQuery(ctx) }),
  saveType: (ctx: Ctx, body: ExamsTypeInput, id?: string) => apiFetch<ExamsType>(id ? `/exams-types/${j(id)}` : "/exams-types", { method: id ? "PUT" : "POST", body, query: ctxQuery(ctx) }),

  /** Every grade scale, the standard one first. */
  grading: () => apiFetch<ExamsGradeScale[]>("/exams-grading"),
  /** Adds a scale (no id) or saves one (409 when it changed since `rowVer`). */
  saveGrading: (ctx: Ctx, body: ExamsGradeScaleInput, id?: string) =>
    apiFetch<ExamsGradeScale>(id ? `/exams-grading/${j(id)}` : "/exams-grading", { method: id ? "PUT" : "POST", body, query: ctxQuery(ctx) }),
  saveRemark: (id: string, personId: string, text: string) => apiFetch<ExamDetail>(`/exams/${j(id)}/remarks`, { method: "POST", body: { personId, text } }),

  programmes: (ctx: Ctx) => apiFetch<ExamsProgramme[]>("/exams-programmes", { query: ctxQuery(ctx) }),
  participants: (id: string, q: ExamsParticipantQuery = {}) =>
    apiFetch<ExamsParticipant[]>(`/exams-programmes/${j(id)}/participants`, { query: { q: q.q ?? "", centre: q.centre ?? "", gender: q.gender ?? "", group: q.group ?? "", school: q.school ?? "" } }),
  saveParticipant: (id: string, body: ExamsParticipantInput & { rowVer?: number }, regNo?: string) =>
    apiFetch<ExamsParticipant>(regNo ? `/exams-programmes/${j(id)}/participants/${j(regNo)}` : `/exams-programmes/${j(id)}/participants`, { method: regNo ? "PUT" : "POST", body }),
  /** Creates an admissions applicant (Diamond Minds) from a participant. */
  startAdmission: (id: string, regNo: string, classApplied: string) =>
    apiFetch<ExamsParticipant>(`/exams-programmes/${j(id)}/participants/${j(regNo)}/admission`, { method: "POST", body: { classApplied } }),
  /** Sets up the programme's test: papers, and the centres that sit it. */
  createProgrammeExam: (ctx: Ctx, id: string, body: { name: string; centreIds: string[]; subjects: ExamsSubject[] }) =>
    apiFetch<ExamDetail>("/exams", { method: "POST", body: { typeId: "et-diamond", name: body.name, classes: body.centreIds, subjects: body.subjects, programmeId: id } satisfies ExamsCreateInput, query: ctxQuery(ctx) }),

  combinable: (ctx: Ctx) => apiFetch<ExamsCombinable[]>("/exams-combined/options", { query: ctxQuery(ctx) }),
  combined: (ctx: Ctx, parts: Array<{ examId: string; weight: number }>, opts: ExamsCombinedOptions = {}) =>
    apiFetch<ExamsCombined>("/exams-combined", {
      query: { ...ctxQuery(ctx), parts: parts.map((p) => `${p.examId}:${p.weight}`).join(","), ...(opts.includeLast ? { last: "1" } : {}), ...(opts.mode === "AVERAGE" ? { mode: "AVERAGE" } : {}) },
    }),
  /** Every teacher's papers across the exams of the campus and session (teacher performance reports). */
  teacherPerformance: (ctx: Ctx, q: ExamsTeacherPerfQuery = {}) =>
    apiFetch<ExamsTeacherPerf>("/exams-teacher-performance", {
      query: { ...ctxQuery(ctx), teacher: q.teacher ?? "", subject: q.subject ?? "", level: q.level ?? "", examTypeId: q.examTypeId ?? "", month: q.month ?? "", gender: q.gender ?? "" },
    }),

  merit: (ctx: Ctx, q: ExamsMeritQuery) => apiFetch<ExamsMeritList>("/exams-merit", { query: { ...ctxQuery(ctx), examId: q.examId, classes: (q.classes ?? []).join(","), top: q.top } }),
  meritLists: (ctx: Ctx) => apiFetch<ExamsMeritList[]>("/exams-merit-lists", { query: ctxQuery(ctx) }),
  saveMeritList: (ctx: Ctx, body: ExamsMeritSaveInput) => apiFetch<ExamsMeritList>("/exams-merit-lists", { method: "POST", body, query: ctxQuery(ctx) }),

  searchPeople: (ctx: Ctx, q: string) => apiFetch<ExamsPersonHit[]>("/exams-history", { query: { ...ctxQuery(ctx), q } }),
  history: (id: string) => apiFetch<ExamsStudentHistory>(`/exams-history/${j(id)}`),

  uniProgrammes: (ctx: Ctx) => apiFetch<ExamsUniProgramme[]>("/exams-uni", { query: ctxQuery(ctx) }),
  uniSemester: (id: string) => apiFetch<ExamsUniSemester>(`/exams-uni/semesters/${j(id)}`),
  uniSaveMarks: (id: string, body: ExamsUniMarksInput) => apiFetch<ExamsUniSemester>(`/exams-uni/semesters/${j(id)}/marks`, { method: "PUT", body }),
  uniDeclare: (id: string) => apiFetch<ExamsUniSemester>(`/exams-uni/semesters/${j(id)}/declare`, { method: "POST" }),
  uniTranscript: (studentId: string) => apiFetch<ExamsUniTranscript>(`/exams-uni/transcripts/${j(studentId)}`),
  uniCreateProgramme: (ctx: Ctx, body: ExamsUniProgrammeInput) => apiFetch<ExamsUniProgramme>("/exams-uni/programmes", { method: "POST", body, query: ctxQuery(ctx) }),
  uniCreateSemester: (ctx: Ctx, body: ExamsUniSemesterInput) => apiFetch<ExamsUniSemester>("/exams-uni/semesters", { method: "POST", body, query: ctxQuery(ctx) }),
  uniSaveCourses: (id: string, courses: ExamsUniCourseInput[]) => apiFetch<ExamsUniSemester>(`/exams-uni/semesters/${j(id)}/courses`, { method: "PUT", body: { courses } }),
};

export const examsQueries = {
  list: (ctx: Ctx) => queryOptions({ queryKey: ["exams", ...ctxKey(ctx), "list"], queryFn: () => examsApi.list(ctx) }),
  detail: (id: string) => queryOptions({ queryKey: ["exams", "detail", id], queryFn: () => examsApi.get(id) }),
  templates: (ctx: Ctx) => queryOptions({ queryKey: ["exams", ...ctxKey(ctx), "templates"], queryFn: () => examsApi.templates(ctx) }),
  types: (ctx: Ctx) => queryOptions({ queryKey: ["exams", ...ctxKey(ctx), "types"], queryFn: () => examsApi.types(ctx) }),
  grading: () => queryOptions({ queryKey: ["exams", "grading"], queryFn: examsApi.grading }),
  combinable: (ctx: Ctx) => queryOptions({ queryKey: ["exams", ...ctxKey(ctx), "combinable"], queryFn: () => examsApi.combinable(ctx) }),
  combined: (ctx: Ctx, parts: Array<{ examId: string; weight: number }>, opts: ExamsCombinedOptions = {}) =>
    queryOptions({
      queryKey: ["exams", ...ctxKey(ctx), "combined", parts.map((p) => `${p.examId}:${p.weight}`).join(","), opts.includeLast ? "last" : "", opts.mode ?? "WEIGHTED"],
      queryFn: () => examsApi.combined(ctx, parts, opts),
      enabled: parts.length > 0,
    }),
  teacherPerformance: (ctx: Ctx, q: ExamsTeacherPerfQuery = {}) =>
    queryOptions({
      queryKey: ["exams", ...ctxKey(ctx), "teacher-performance", q.teacher ?? "", q.subject ?? "", q.level ?? "", q.examTypeId ?? "", q.month ?? "", q.gender ?? ""],
      queryFn: () => examsApi.teacherPerformance(ctx, q),
    }),
  merit: (ctx: Ctx, q: ExamsMeritQuery) =>
    queryOptions({ queryKey: ["exams", ...ctxKey(ctx), "merit", q.examId, (q.classes ?? []).join(","), q.top], queryFn: () => examsApi.merit(ctx, q), enabled: q.examId !== "" }),
  /** Saved merit lists — Activities reads these for scholarships. */
  meritLists: (ctx: Ctx) => queryOptions({ queryKey: ["exams", ...ctxKey(ctx), "merit-lists"], queryFn: () => examsApi.meritLists(ctx) }),
  searchPeople: (ctx: Ctx, q: string) => queryOptions({ queryKey: ["exams", ...ctxKey(ctx), "people", q], queryFn: () => examsApi.searchPeople(ctx, q), enabled: q.trim().length >= 2 }),
  history: (ctx: Ctx, id: string) => queryOptions({ queryKey: ["exams", ...ctxKey(ctx), "history", id], queryFn: () => examsApi.history(id), enabled: id !== "" }),
  uniProgrammes: (ctx: Ctx) => queryOptions({ queryKey: ["exams", ...ctxKey(ctx), "uni"], queryFn: () => examsApi.uniProgrammes(ctx) }),
  uniSemester: (ctx: Ctx, id: string) => queryOptions({ queryKey: ["exams", ...ctxKey(ctx), "uni", "semester", id], queryFn: () => examsApi.uniSemester(id), enabled: id !== "" }),
  uniTranscript: (ctx: Ctx, studentId: string) => queryOptions({ queryKey: ["exams", ...ctxKey(ctx), "uni", "transcript", studentId], queryFn: () => examsApi.uniTranscript(studentId), enabled: studentId !== "" }),
  programmes: (ctx: Ctx) => queryOptions({ queryKey: ["exams", ...ctxKey(ctx), "programmes"], queryFn: () => examsApi.programmes(ctx) }),
  participants: (ctx: Ctx, id: string, q: ExamsParticipantQuery = {}) =>
    queryOptions({ queryKey: ["exams", ...ctxKey(ctx), "programmes", id, "participants", q.q ?? "", q.centre ?? "", q.gender ?? "", q.group ?? "", q.school ?? ""], queryFn: () => examsApi.participants(id, q), enabled: id !== "" }),
};
