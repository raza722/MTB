import {
  examsGradeFor,
  examsScaleFor,
  examsSits,
  EXAMS_DEFAULT_PASS_RULES,
  type CampusCode,
  type DeclaredResult,
  type ExamDetail,
  type ExamsGradeScale,
  type ExamsPaper,
  type ExamsPaperStatus,
  type ExamsPassRules,
  type ExamsResultRow,
  type ExamsSubject,
  type ExamSummary,
} from "@mtb/api";
import { CURRENT_SESSION } from "../clock";
import { createStore } from "../db";
import {
  computeRows,
  EXAM_FIXTURES,
  initialExamTypes,
  initialGradeScales,
  initialProgrammes,
  paperKey,
  subjectTeacher,
  type ExamRecord,
  type ExamsPaperState,
  type ExamsRosterEntry,
  type ExamsTypeRecord,
  type ParticipantRecord,
  type ProgrammeRecord,
} from "../fixtures/exams";
import { findStudent } from "../fixtures/students";
import { genderOfName } from "./sms";

// Exams are real now (/api/exams*, /api/exams-*, and the teacher app's /api/teacher/papers*): their routes were
// removed, so those requests fall through to the backend (backend/docs/modules/05_exams.md). What stays here is the
// fictional exam store and the pure helpers the unfinished modules' mocks still read (no routes): the parent portal's
// results (module 12), the report centre's exam reports (module 13), Messages' exam audience (module 10), Activities'
// test figures (module 9) and the teacher app's Today papers (module 8). Their exam ids and G.R.s are fictional, so
// they do not match the real exams until those modules read the real views.

/** Every fictional exam record (marks, papers, declarations), shared by the unfinished modules' mocks. */
export const examsStore = createStore<ExamRecord[]>("exams.v3", EXAM_FIXTURES);

const gradingStore = createStore<ExamsGradeScale[]>("exams-grading.v2", initialGradeScales);
const typesStore = createStore<ExamsTypeRecord[]>("exams-types.v3", initialExamTypes);
const programmeStore = createStore<{ programmes: ProgrammeRecord[]; participants: ParticipantRecord[] }>("exams-programmes", initialProgrammes);

/** Class of an exam for picking its grade scale ("" for programme tests and applicant groups). */
const examClass = (e: Pick<ExamRecord, "classes" | "programmeId">) => (e.programmeId ? "" : (e.classes[0] ?? "").split("-")[0] ?? "");
/** The grade scale an exam uses while in draft. */
function scaleOf(e: Pick<ExamRecord, "category" | "classes" | "programmeId">): ExamsGradeScale {
  const all = gradingStore.get();
  if (e.programmeId) return all.find((s) => s.standard) ?? all[0]!;
  return examsScaleFor(all, e.category, examClass(e)) ?? all[0]!;
}
const bands = (e: Pick<ExamRecord, "category" | "classes" | "programmeId">) => scaleOf(e).bands;
const rules = (e: Pick<ExamRecord, "category" | "classes" | "programmeId">): ExamsPassRules => scaleOf(e).passRules ?? EXAMS_DEFAULT_PASS_RULES;
const typeOf = (e: ExamRecord) => (e.typeId ? typesStore.get().find((t) => t.id === e.typeId) : undefined);
/** Papers a roster entry sits (all of them unless the paper is for some groups only). */
const papersFor = (e: Pick<ExamRecord, "subjects">, p: Pick<ExamsRosterEntry, "group">) => e.subjects.filter((s) => examsSits(s, p.group));

/** Boy or girl: the student record for students with a profile, otherwise the register's (fictional) first name. */
function examGenderOf(p: Pick<ExamsRosterEntry, "id" | "name" | "hasProfile">): "M" | "F" {
  return (p.hasProfile ? findStudent(p.id)?.gender : undefined) ?? genderOfName(p.name);
}

/** Adds gender and the guardian's mobile from the roster (prints filter boys/girls and show a Contact column). */
function decorate(e: ExamRecord, rows: ExamsResultRow[]): ExamsResultRow[] {
  if (e.candidateLabel === "Applicant") return rows;
  const people = new Map(e.roster.map((p) => [p.id, p]));
  const registered = e.programmeId ? new Map(programmeStore.get().participants.map((x) => [x.regNo, x.gender])) : null;
  return rows.map((r) => {
    const p = people.get(r.id);
    if (!p) return r;
    const gender = r.gender ?? (registered ? registered.get(r.id) : examGenderOf(p));
    return { ...r, ...(gender ? { gender } : {}), ...(p.mobile && !r.guardianMobile ? { guardianMobile: p.mobile } : {}) };
  });
}

/** Result rows: frozen at declaration, worked out live while in draft. */
export function examRows(e: ExamRecord): ExamsResultRow[] {
  if (e.status === "DECLARED" && e.frozen) return decorate(e, e.frozen);
  return decorate(e, computeRows(e, e.status === "DECLARED" ? (e.frozenBands ?? bands(e)) : bands(e), rules(e)));
}

/** Marks not yet entered: only papers each candidate sits count. */
const missingOf = (e: ExamRecord) => e.roster.reduce((a, p) => a + papersFor(e, p).filter((s) => (e.marks[p.id]?.[s.id] ?? null) === null).length, 0);

function paperOf(e: ExamRecord, classSection: string, s: ExamsSubject): ExamsPaper {
  const people = e.roster.filter((p) => p.classSection === classSection && examsSits(s, p.group));
  const values = people.map((p) => e.marks[p.id]?.[s.id] ?? null);
  const entered = values.filter((v) => v !== null).length;
  const stored: ExamsPaperState | undefined = e.papers?.[paperKey(classSection, s.id)];
  let status: ExamsPaperStatus = stored?.status ?? (entered === 0 ? "NOT_STARTED" : "IN_PROGRESS");
  if ((status === "SUBMITTED" || status === "CHECKED") && entered < people.length) status = "IN_PROGRESS";
  if (status === "NOT_STARTED" && entered > 0) status = "IN_PROGRESS";
  return {
    classSection,
    subjectId: s.id,
    subjectName: s.name,
    maxMarks: s.maxMarks,
    teacher: e.category === "ENTRANCE" ? null : subjectTeacher(e.campus, classSection, s.id),
    status,
    entered,
    candidates: people.length,
    absent: values.filter((v) => v === "A").length,
    leave: values.filter((v) => v === "L").length,
    ...(stored?.at ? { updatedAt: stored.at } : {}),
    ...(stored?.by ? { updatedBy: stored.by } : {}),
    ...(stored?.note ? { note: stored.note } : {}),
  };
}

function papersOf(e: ExamRecord): ExamsPaper[] {
  return e.classes.flatMap((cs) => e.subjects.map((s) => paperOf(e, cs, s)));
}

function summary(e: ExamRecord): ExamSummary {
  const papers = papersOf(e);
  const type = typeOf(e);
  const groups = [...new Set(e.roster.map((p) => p.group).filter((g): g is string => Boolean(g)))].sort();
  return {
    id: e.id,
    name: e.name,
    category: e.category,
    ...(e.typeId ? { typeId: e.typeId } : {}),
    ...(type ? { typeName: type.name } : {}),
    campus: e.campus,
    session: e.session,
    classes: e.classes,
    subjects: e.subjects,
    totalMax: e.subjects.reduce((a, s) => a + s.maxMarks, 0),
    startDate: e.startDate,
    ...(e.endDate ? { endDate: e.endDate } : {}),
    status: e.status,
    students: e.roster.length,
    missingMarks: e.status === "DECLARED" ? 0 : missingOf(e),
    papersTotal: papers.length,
    papersDone: papers.filter((p) => p.status === "SUBMITTED" || p.status === "CHECKED").length,
    ...(e.declaredOn ? { declaredOn: e.declaredOn } : {}),
    ...(e.declaredBy ? { declaredBy: e.declaredBy } : {}),
    ...(e.reopen ? { reopen: e.reopen } : {}),
    ...(e.candidateLabel ? { candidateLabel: e.candidateLabel } : {}),
    ...(e.programmeId ? { programmeId: e.programmeId } : {}),
    ...(e.sourceSession !== undefined ? { sourceSession: e.sourceSession } : {}),
    ...(groups.length ? { groups } : {}),
    scaleName: scaleOf(e).name,
  };
}

/** A fictional exam as the exam pages saw it (rows, papers with teachers, grade bands, pass rules): the report centre's mock reads it. */
export function examDetail(e: ExamRecord): ExamDetail {
  return {
    ...summary(e),
    rows: examRows(e),
    history: [...e.history].sort((a, b) => b.at.localeCompare(a.at)),
    papers: papersOf(e),
    bands: e.status === "DECLARED" ? (e.frozenBands ?? bands(e)) : bands(e),
    passRules: rules(e),
    absenceFine: typeOf(e)?.absenceFine ?? 0,
  };
}

/** Papers a teacher marks across the fictional open exams of the current session (the teacher app's Today mock, module 8). */
export function examPapersForTeacher(teacherName: string, campus?: CampusCode): Array<ExamsPaper & { examId: string; examName: string; category: ExamRecord["category"]; examStatus: ExamRecord["status"] }> {
  return examsStore
    .get()
    .filter((e) => e.session === CURRENT_SESSION && (!campus || e.campus === campus) && e.category !== "ENTRANCE")
    .flatMap((e) => papersOf(e).map((p) => ({ ...p, examId: e.id, examName: e.name, category: e.category, examStatus: e.status })))
    .filter((p) => p.teacher === teacherName);
}

/** Declared fictional results for one person, newest first (the parent portal's and Messages' mocks; drafts and withheld results never). */
export function declaredResultsFor(personId: string): DeclaredResult[] {
  return examsStore
    .get()
    .filter((e) => e.status === "DECLARED" && e.roster.some((p) => p.id === personId))
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
    .flatMap<DeclaredResult>((e) => {
      const row = examRows(e).find((r) => r.id === personId);
      if (!row || row.percent === null || row.withheld) return [];
      const usedBands = e.frozenBands ?? bands(e);
      return [
        {
          examId: e.id,
          exam: e.name,
          session: e.session,
          declaredOn: (e.declaredOn ?? e.startDate).slice(0, 10),
          obtained: row.obtained,
          total: row.max,
          percent: row.percent,
          grade: row.grade ?? "",
          ...(row.position !== null ? { position: row.position } : {}),
          subjects: e.subjects.filter((s) => examsSits(s, row.group)).map((s) => {
            const m = row.marks[s.id] ?? null;
            const n = typeof m === "number" ? m : null;
            return { subject: s.name, obtained: n, max: s.maxMarks, grade: n === null ? "F" : (examsGradeFor((n / s.maxMarks) * 100, usedBands) ?? ""), ...(m === "A" || m === "L" ? { absent: true } : {}) };
          }),
        },
      ];
    });
}
