import { examsSits, type CampusCode, type ExamsPaper, type ExamsPaperStatus, type ExamsSubject } from "@mtb/api";
import { CURRENT_SESSION } from "../clock";
import { createStore } from "../db";
import { EXAM_FIXTURES, paperKey, subjectTeacher, type ExamRecord, type ExamsPaperState } from "../fixtures/exams";

// Exams are real now (/api/exams*, /api/exams-*, and the teacher app's /api/teacher/papers*): their routes were
// removed, so those requests fall through to the backend (backend/docs/modules/05_exams.md). The report centre's exam
// reports are real too (module 13b). What stays here is the fictional exam store and the paper helpers the teacher
// app's Today mock (module 8) still reads (no routes). Its exam ids and G.R.s are fictional, so they do not match the
// real exams.

/** Every fictional exam record (marks, papers, declarations), shared by the unfinished modules' mocks. */
export const examsStore = createStore<ExamRecord[]>("exams.v3", EXAM_FIXTURES);

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

/** Papers a teacher marks across the fictional open exams of the current session (the teacher app's Today mock, module 8). */
export function examPapersForTeacher(teacherName: string, campus?: CampusCode): Array<ExamsPaper & { examId: string; examName: string; category: ExamRecord["category"]; examStatus: ExamRecord["status"] }> {
  return examsStore
    .get()
    .filter((e) => e.session === CURRENT_SESSION && (!campus || e.campus === campus) && e.category !== "ENTRANCE")
    .flatMap((e) => papersOf(e).map((p) => ({ ...p, examId: e.id, examName: e.name, category: e.category, examStatus: e.status })))
    .filter((p) => p.teacher === teacherName);
}

