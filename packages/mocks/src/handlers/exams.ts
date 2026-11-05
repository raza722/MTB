import {
  examsGradeFor,
  examsLevelOf,
  examsScaleFor,
  examsSits,
  type ExamsTeacherPerf,
  type ExamsTeacherPerfQuery,
  type ExamsTeacherPerfRow,
  examsValidateBands,
  examsValidatePassRules,
  EXAMS_DEFAULT_PASS_RULES,
  EXAMS_DEFAULT_SCALE,
  type AdmissionsApplicant,
  type CampusCode,
  type ExamsCategory,
  type ExamsGradeScaleInput,
  type ExamsParticipant,
  type ExamsParticipantInput,
  type ExamsProgramme,
  type ExamsUniAssessment,
  type ExamsUniComponent,
  type ExamsUniCourse,
  type ExamsUniCourseInput,
  type ExamsUniPart,
  type ExamsUniProgrammeInput,
  type ExamsUniSemesterInput,
  type DeclaredResult,
  type ExamDetail,
  type ExamsClassTemplate,
  type ExamsCombinable,
  type ExamsCombined,
  type ExamsCombinedRow,
  type ExamsCreateInput,
  type ExamsGradeScale,
  type ExamsHistoryEntry,
  type ExamsMark,
  type ExamsMarksSaved,
  type ExamsMeritList,
  type ExamsMeritRow,
  type ExamsMeritSaveInput,
  type ExamsPaper,
  type ExamsPaperAction,
  type ExamsPaperStatus,
  type ExamsPassRules,
  type ExamsPersonHit,
  type ExamsResultRow,
  type ExamsStudentHistory,
  type ExamsSubject,
  type ExamsType,
  type ExamsTypeInput,
  type ExamSummary,
  type ExamsUniMark,
  type ExamsUniProgramme,
  type ExamsUniSemester,
  type ExamsUniSemesterSummary,
  type ExamsUniTranscript,
  type SessionUser,
} from "@mtb/api";
import { formatSession, isValidCnic, normalizeCnic, normalizeMobile, type IsoDate } from "@mtb/domain";
import { http, type HttpHandler } from "msw";
import { CURRENT_SESSION, DEMO_TODAY, demoNow } from "../clock";
import { createStore } from "../db";
import { ruleFor, subjectsFor } from "../fixtures/admissions";
import { campusName } from "../fixtures/campuses";
import {
  classGroups,
  CLASS_SUBJECTS,
  computeRows,
  computeUniRows,
  examRoster,
  EXAM_FIXTURES,
  initialExamTypes,
  initialGradeScales,
  initialProgrammes,
  initialUniversity,
  paperKey,
  participantRoster,
  sectionsOfClass,
  subjectTeacher,
  uniCourseResult,
  uniGpa,
  uniSessional,
  UNI_PAPER_TYPES,
  type ExamRecord,
  type ExamsMeritRecord,
  type ExamsPaperState,
  type ExamsRosterEntry,
  type ExamsTypeRecord,
  type ParticipantRecord,
  type ProgrammeRecord,
  type UniSemesterRecord,
} from "../fixtures/exams";
import { findStudent, STUDENTS } from "../fixtures/students";
import { ctxFrom, fail, HttpResponse, latency, requirePermission, requireUser } from "../util";
import { admissionsStore } from "./admissions";
import { setupCreditHours } from "../fixtures/setup";
import { genderOfName, queueBatch } from "./sms";
import { patchStudent } from "./student-records-model";

// Exams: one engine for term exams, class tests, board exams and entrance tests, plus university semesters.
// The stores and helpers below are exported so the teacher app and parent portal mocks share the same marks.

/** Every exam record (marks, papers, declarations). Shared with the teacher app and parent portal mocks. */
export const examsStore = createStore<ExamRecord[]>("exams.v3", EXAM_FIXTURES);

/**
 * A student moved to another group (Students → Sections, promotion): this session's open exams follow, so the profile
 * and the marks grid show the same group. Declared exams keep the group they were declared with.
 */
export function followGroupChange(grNo: string, group: string) {
  const hit = (e: ExamRecord) => e.status === "DRAFT" && e.session === CURRENT_SESSION && e.roster.some((p) => p.id === grNo && p.group && p.group !== group);
  if (!examsStore.get().some(hit)) return;
  examsStore.set((list) => list.map((e) => (hit(e) ? { ...e, roster: e.roster.map((p) => (p.id === grNo && p.group ? { ...p, group } : p)) } : e)));
}

/** Grade scales: Standard plus scales for some kinds and classes (the most specific match is used). */
const gradingStore = createStore<ExamsGradeScale[]>("exams-grading.v2", initialGradeScales);
const typesStore = createStore<ExamsTypeRecord[]>("exams-types.v3", initialExamTypes);
const meritStore = createStore<ExamsMeritRecord[]>("exams-merit", () => []);
const uniRaw = createStore("exams-uni.v2", initialUniversity);
type UniState = ReturnType<typeof initialUniversity>;
/**
 * While a semester is open its course credit hours come from Setup → Class subjects (degree courses), so GPA follows
 * Setup. Every save writes the credits in force, so a declared semester keeps the ones it was declared with.
 */
function withSetupCredits(st: UniState): UniState {
  const credits = setupCreditHours();
  if (!credits.size) return st;
  return { ...st, semesters: st.semesters.map((s) => (s.status === "DECLARED" ? s : { ...s, courses: s.courses.map((c) => (credits.has(c.id) ? { ...c, creditHours: credits.get(c.id)! } : c)) })) };
}
const uniStore: typeof uniRaw = {
  ...uniRaw,
  get: () => withSetupCredits(uniRaw.get()),
  set: (next) => uniRaw.set(typeof next === "function" ? (prev) => next(withSetupCredits(prev)) : next),
};
/** Diamond Minds: programmes, their centres and participants. */
const programmeStore = createStore<{ programmes: ProgrammeRecord[]; participants: ParticipantRecord[] }>("exams-programmes", initialProgrammes);

const newId = () => Math.random().toString(36).slice(2, 10);
/** Class of an exam for picking its grade scale ("" for programme tests and applicant groups). */
const examClass = (e: Pick<ExamRecord, "classes" | "programmeId">) => (e.programmeId ? "" : (e.classes[0] ?? "").split("-")[0] ?? "");
/** The grade scale an exam uses while in draft. */
function scaleOf(e: Pick<ExamRecord, "category" | "classes" | "programmeId">): ExamsGradeScale {
  const all = gradingStore.get();
  // A programme test (Diamond Minds) is graded like a school exam, not as an admission pass/fail.
  if (e.programmeId) return all.find((s) => s.standard) ?? all[0]!;
  return examsScaleFor(all, e.category, examClass(e)) ?? all[0]!;
}
const bands = (e: Pick<ExamRecord, "category" | "classes" | "programmeId">) => scaleOf(e).bands;
const rules = (e: Pick<ExamRecord, "category" | "classes" | "programmeId">): ExamsPassRules => scaleOf(e).passRules ?? EXAMS_DEFAULT_PASS_RULES;
const typeOf = (e: ExamRecord) => (e.typeId ? typesStore.get().find((t) => t.id === e.typeId) : undefined);
/** Papers a roster entry sits (all of them unless the paper is for some groups only). */
const papersFor = (e: Pick<ExamRecord, "subjects">, p: Pick<ExamsRosterEntry, "group">) => e.subjects.filter((s) => examsSits(s, p.group));
const findExam = (id: string) => examsStore.get().find((e) => e.id === id);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function update(id: string, fn: (e: ExamRecord) => ExamRecord): ExamRecord | undefined {
  let out: ExamRecord | undefined;
  examsStore.set((list) =>
    list.map((e) => {
      if (e.id !== id) return e;
      out = fn(e);
      return out;
    }),
  );
  return out;
}

/** Adds a history line, or refreshes the last one when it is the same action on the same paper by the same person. */
function log(e: ExamRecord, by: string, action: string, detail?: string): ExamRecord["history"] {
  const at = demoNow();
  const last = e.history[e.history.length - 1];
  if (last && last.by === by && last.action === action && last.detail === detail) return [...e.history.slice(0, -1), { ...last, at }];
  return [...e.history, { id: newId(), at, by, action, ...(detail ? { detail } : {}) }];
}

// ---------------------------------------------------------------------------------------------------------
// Results, papers and summaries
// ---------------------------------------------------------------------------------------------------------

/** Boy or girl: the student record for students with a profile, otherwise the register's (fictional) first name. */
export function examGenderOf(p: Pick<ExamsRosterEntry, "id" | "name" | "hasProfile">): "M" | "F" {
  return (p.hasProfile ? findStudent(p.id)?.gender : undefined) ?? genderOfName(p.name);
}

/** Adds gender and the guardian's mobile from the roster (prints filter boys/girls and show a Contact column). */
function decorate(e: ExamRecord, rows: ExamsResultRow[]): ExamsResultRow[] {
  if (e.candidateLabel === "Applicant") return rows;
  const people = new Map(e.roster.map((p) => [p.id, p]));
  // Programme participants (Diamond Minds) carry their own gender.
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
  // Candidates of the section who sit this paper (their group takes it).
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
  const missingMarks = e.status === "DECLARED" ? 0 : missingOf(e);
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
    missingMarks,
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

/** An exam as the exam pages see it (rows, papers with teachers, grade bands, pass rules): the report centre uses it too. */
export const examDetail = (e: ExamRecord): ExamDetail => detail(e);

function detail(e: ExamRecord): ExamDetail {
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

// ---------------------------------------------------------------------------------------------------------
// Shared helpers for the teacher app and parent portal mocks
// ---------------------------------------------------------------------------------------------------------

export type ExamsWriteResult<T> = { ok: true; value: T } | { ok: false; status: number; code: string; message: string; details?: unknown };

/** Checks one mark against the paper's maximum. Returns a plain-English problem, or null when it is fine. */
export function checkMark(v: unknown, max: number): string | null {
  if (v === null || v === "A" || v === "L") return null;
  if (typeof v !== "number" || !Number.isFinite(v)) return "Type a number, A for absent or L for leave.";
  if (v < 0) return "Marks can't be below 0.";
  if (v > max) return `Maximum is ${max}.`;
  if (Math.round(v * 2) !== v * 2) return "Use whole or half marks (for example 32.5).";
  return null;
}

/** Saves marks for one class-section × subject. Used by the staff grid and the teacher app. */
export function saveExamMarks(examId: string, classSection: string, subjectId: string, marks: Record<string, ExamsMark>, by: string): ExamsWriteResult<ExamsMarksSaved> {
  const e = findExam(examId);
  if (!e) return { ok: false, status: 404, code: "NOT_FOUND", message: "No exam with this reference." };
  if (e.session !== CURRENT_SESSION) return { ok: false, status: 409, code: "SESSION_READ_ONLY", message: "This session is closed. Marks can't be changed." };
  if (e.status === "DECLARED") return { ok: false, status: 409, code: "DECLARED", message: "Results are declared and locked. Ask for the results to be reopened first." };
  const subject = e.subjects.find((s) => s.id === subjectId);
  if (!subject) return { ok: false, status: 422, code: "VALIDATION", message: "This exam has no such subject." };
  if (!e.classes.includes(classSection)) return { ok: false, status: 422, code: "VALIDATION", message: `${classSection} doesn't sit this exam.` };
  const people = new Map(e.roster.filter((p) => p.classSection === classSection).map((p) => [p.id, p]));
  const problems: Array<{ personId: string; name: string; message: string }> = [];
  for (const [pid, v] of Object.entries(marks)) {
    const p = people.get(pid);
    if (!p) problems.push({ personId: pid, name: pid, message: `Not in ${classSection}.` });
    else if (!examsSits(subject, p.group)) {
      // A paper outside the student's group: only "not entered" is accepted.
      if (v !== null) problems.push({ personId: pid, name: p.name, message: `${subject.name} isn't a ${p.group ?? "group"} paper, so it takes no mark.` });
    } else {
      const msg = checkMark(v, subject.maxMarks);
      if (msg) problems.push({ personId: pid, name: p.name, message: msg });
    }
  }
  if (problems.length) {
    const first = problems[0]!;
    return { ok: false, status: 422, code: "VALIDATION", message: `${first.name}: ${first.message}${problems.length > 1 ? ` (and ${plural(problems.length - 1, "more mark")})` : ""} Nothing was saved for those students.`, details: problems };
  }
  const at = demoNow();
  const key = paperKey(classSection, subjectId);
  const updated = update(e.id, (x) => {
    const nextMarks = { ...x.marks };
    for (const [pid, v] of Object.entries(marks)) if (examsSits(subject, people.get(pid)?.group)) nextMarks[pid] = { ...(nextMarks[pid] ?? {}), [subjectId]: v };
    const prev = x.papers?.[key];
    const keep = prev && (prev.status === "SUBMITTED" || prev.status === "CHECKED");
    const papers = { ...(x.papers ?? {}), [key]: { ...(prev ?? {}), status: keep ? prev.status : ("IN_PROGRESS" as const), by, at } };
    return { ...x, marks: nextMarks, papers, history: log(x, by, keep ? "Marks corrected" : "Marks saved", `${subject.name} · ${classSection}`) };
  })!;
  return { ok: true, value: { savedAt: at, saved: Object.keys(marks).length, paper: paperOf(updated, classSection, subject), missingMarks: summary(updated).missingMarks } };
}

/** Which board roll number a board exam carries on the student's record: Part-I (Class 9) or Part-II (Class 10). */
const boardPartOf = (e: Pick<ExamRecord, "classes" | "typeId">): "partI" | "partII" => (e.typeId === "et-board2" || classOf(e.classes[0] ?? "") === "10" ? "partII" : "partI");

/**
 * Board roll numbers of one section's candidates in a board exam (the legacy board-candidate roll no.). "" clears one.
 * Students with a record get the number on their record too (Part-I or Part-II), so the profile, the collection sheet
 * and the certificates show the same number.
 */
export function saveBoardRollNos(examId: string, classSection: string, rolls: Record<string, string>, by: string): ExamsWriteResult<number> {
  const e = findExam(examId);
  if (!e) return { ok: false, status: 404, code: "NOT_FOUND", message: "No exam with this reference." };
  if (e.category !== "BOARD") return { ok: false, status: 422, code: "VALIDATION", message: "Board roll numbers are for board exams only." };
  if (e.session !== CURRENT_SESSION) return { ok: false, status: 409, code: "SESSION_READ_ONLY", message: "This session is closed. Roll numbers can't be changed." };
  if (e.status === "DECLARED") return { ok: false, status: 409, code: "DECLARED", message: "Results are declared and locked. Ask for the results to be reopened first." };
  const people = new Map(e.roster.filter((p) => p.classSection === classSection).map((p) => [p.id, p]));
  const part = boardPartOf(e);
  const next = { ...(e.boardRollNos ?? {}) };
  const problems: Array<{ personId: string; name: string; message: string }> = [];
  for (const [pid, raw] of Object.entries(rolls)) {
    const p = people.get(pid);
    const v = (raw ?? "").replace(/\s/g, "");
    if (!p) problems.push({ personId: pid, name: pid, message: `Not in ${classSection}.` });
    else if (v && !/^\d{4,9}$/.test(v)) problems.push({ personId: pid, name: p.name, message: "A board roll no. is 4 to 9 digits." });
    else if (v) next[pid] = v;
    else delete next[pid];
  }
  // Each number once: in this exam, and on no other student's record.
  for (const pid of Object.keys(rolls)) {
    const v = next[pid];
    const p = people.get(pid);
    if (!v || !p || problems.some((x) => x.personId === pid)) continue;
    const other = STUDENTS.find((s) => !s.mergedInto && s.grNo !== pid && (s.boardRollNo?.partI === v || s.boardRollNo?.partII === v));
    if (Object.entries(next).some(([o, n]) => o !== pid && n === v)) problems.push({ personId: pid, name: p.name, message: `Roll no. ${v} is given to another candidate in this exam.` });
    else if (other) problems.push({ personId: pid, name: p.name, message: `Roll no. ${v} is on ${other.name}'s record (${other.grNo}).` });
  }
  if (problems.length) {
    const first = problems[0]!;
    return { ok: false, status: 422, code: "VALIDATION", message: `${first.name}: ${first.message}${problems.length > 1 ? ` (and ${plural(problems.length - 1, "more roll no.", "more roll nos.")})` : ""} Nothing was saved for those students.`, details: problems };
  }
  update(e.id, (x) => ({ ...x, boardRollNos: next, history: log(x, by, "Board roll numbers saved", classSection) }));
  for (const pid of Object.keys(rolls)) {
    const s = people.get(pid)?.hasProfile ? findStudent(pid) : undefined;
    if (!s) continue;
    const v = next[pid] ?? "";
    if ((s.boardRollNo?.[part] ?? "") === v) continue;
    const rec = { ...(s.boardRollNo ?? {}) };
    if (v) rec[part] = v;
    else delete rec[part];
    patchStudent(s.grNo, { boardRollNo: rec });
  }
  return { ok: true, value: Object.keys(rolls).length };
}

/** Submit (teacher), check or return (exam office) one paper. */
export function setExamPaperStatus(examId: string, classSection: string, subjectId: string, action: ExamsPaperAction, by: string, note?: string): ExamsWriteResult<ExamRecord> {
  const e = findExam(examId);
  if (!e) return { ok: false, status: 404, code: "NOT_FOUND", message: "No exam with this reference." };
  if (e.session !== CURRENT_SESSION) return { ok: false, status: 409, code: "SESSION_READ_ONLY", message: "This session is closed." };
  if (e.status === "DECLARED") return { ok: false, status: 409, code: "DECLARED", message: "Results are declared and locked." };
  const subject = e.subjects.find((s) => s.id === subjectId);
  if (!subject || !e.classes.includes(classSection)) return { ok: false, status: 422, code: "VALIDATION", message: "This exam has no such paper." };
  const paper = paperOf(e, classSection, subject);
  const missing = paper.candidates - paper.entered;
  if ((action === "SUBMIT" || action === "CHECK") && missing > 0)
    return { ok: false, status: 409, code: "MARKS_MISSING", message: `${plural(missing, "mark is", "marks are")} still missing in ${subject.name} · ${classSection}. Enter them (A for absent, L for leave) first.` };
  if (action === "RETURN" && !note?.trim()) return { ok: false, status: 422, code: "VALIDATION", message: "Say what the teacher needs to correct." };
  const status: ExamsPaperStatus = action === "SUBMIT" ? "SUBMITTED" : action === "CHECK" ? "CHECKED" : "IN_PROGRESS";
  const at = demoNow();
  const label = action === "SUBMIT" ? "Marks submitted" : action === "CHECK" ? "Marks checked by the exam office" : "Marks returned to the teacher";
  const updated = update(e.id, (x) => ({
    ...x,
    papers: { ...(x.papers ?? {}), [paperKey(classSection, subjectId)]: { status, by, at, ...(action === "RETURN" && note ? { note: note.trim() } : {}) } },
    history: [...x.history, { id: newId(), at, by, action: label, detail: `${subject.name} · ${classSection}${action === "RETURN" && note ? ` · ${note.trim()}` : ""}` }],
  }))!;
  return { ok: true, value: updated };
}

/** Papers a teacher marks, across the open exams of the current session (for the teacher app). */
export function examPapersForTeacher(teacherName: string, campus?: CampusCode): Array<ExamsPaper & { examId: string; examName: string; category: ExamRecord["category"]; examStatus: ExamRecord["status"] }> {
  return examsStore
    .get()
    .filter((e) => e.session === CURRENT_SESSION && (!campus || e.campus === campus) && e.category !== "ENTRANCE")
    .flatMap((e) => papersOf(e).map((p) => ({ ...p, examId: e.id, examName: e.name, category: e.category, examStatus: e.status })))
    .filter((p) => p.teacher === teacherName);
}

/** Declared results for one student, newest first — what the parent portal and profile may show (drafts and withheld results never). */
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
          // Only the papers of the student's group.
          subjects: e.subjects.filter((s) => examsSits(s, row.group)).map((s) => {
            const m = row.marks[s.id] ?? null;
            const n = typeof m === "number" ? m : null;
            return { subject: s.name, obtained: n, max: s.maxMarks, grade: n === null ? "F" : (examsGradeFor((n / s.maxMarks) * 100, usedBands) ?? ""), ...(m === "A" || m === "L" ? { absent: true } : {}) };
          }),
        },
      ];
    });
}

// ---------------------------------------------------------------------------------------------------------
// Handler helpers
// ---------------------------------------------------------------------------------------------------------

const respond = <T>(r: ExamsWriteResult<T>, map: (v: T) => unknown, status = 200) => (r.ok ? HttpResponse.json(map(r.value) as object, { status }) : fail(r.status, r.code, r.message, r.details ? { details: r.details } : {}));

function guardExam(id: string, perm: "exams.view" | "exams.manage" | "exams.declare"): { e: ExamRecord; user: SessionUser } | Response {
  const e = findExam(id);
  if (!e) return fail(404, "NOT_FOUND", "No exam with this reference.");
  const user = requirePermission(perm, e.campus);
  if (user instanceof Response) return user;
  return { e, user };
}

const inScope = (campus: string, session: number) => (e: { campus: CampusCode; session: number }) => (campus === "ALL" || e.campus === campus) && e.session === session;

const classLabel = (short: string) => (short === "Prep" ? "Prep" : `Class ${short}`);
const classOf = (cs: string) => cs.split("-")[0] ?? cs;

const CLASS_ORDER = ["Prep", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
/**
 * Last session's sections of a class, as the students are now (everyone was promoted: last year's 9-A is this
 * year's 10-A). Class 10 has left the school, so it has none in the demo; the real backend reads last session's
 * enrolments.
 */
function lastSessionSections(campus: CampusCode, classShort: string): Array<{ label: string; now: string }> {
  const next = CLASS_ORDER[CLASS_ORDER.indexOf(classShort) + 1];
  if (!next) return [];
  return sectionsOfClass(campus, next).map((now) => ({ label: `${classShort}-${now.split("-")[1] ?? ""}`, now }));
}

/** Students per group in a roster (only for classes with groups). */
function groupCounts(list: ExamsRosterEntry[]): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const p of list) if (p.group) out[p.group] = (out[p.group] ?? 0) + 1;
  return Object.keys(out).length ? out : undefined;
}

// ---------------------------------------------------------------------------------------------------------
// Combined results and merit lists
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

function buildMerit(e: ExamRecord, classes: string[], top: number): Omit<ExamsMeritList, "title"> {
  const rows = examRows(e).filter((r) => r.percent !== null && !r.withheld && (classes.length === 0 || classes.includes(r.classSection)));
  const sorted = [...rows].sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0) || b.obtained - a.obtained || a.name.localeCompare(b.name));
  const ranked: ExamsMeritRow[] = [];
  sorted.forEach((r, i) => {
    const prev = ranked[i - 1];
    const rank = prev && prev.percent === r.percent ? prev.rank : i + 1;
    ranked.push({ rank, id: r.id, name: r.name, ...(r.father ? { father: r.father } : {}), classSection: r.classSection, obtained: r.obtained, max: r.max, percent: r.percent ?? 0, grade: r.grade, hasProfile: r.hasProfile });
  });
  const cut = ranked[top - 1];
  const included = cut ? ranked.filter((r, i) => i < top || r.rank === cut.rank) : ranked;
  return {
    examId: e.id,
    examName: `${e.name} · ${e.classes.length > 1 ? classLabel(classOf(e.classes[0]!)) : e.classes[0]}`,
    classes: classes.length ? classes : e.classes,
    top,
    rows: included,
    campus: e.campus,
    session: e.session,
    tiedAtCutOff: Math.max(0, included.length - Math.min(top, ranked.length)),
  };
}

function toMeritList(r: ExamsMeritRecord): ExamsMeritList {
  const e = findExam(r.examId);
  return {
    id: r.id,
    listNo: r.listNo,
    title: r.title,
    purpose: r.purpose,
    examId: r.examId,
    examName: e ? `${e.name} · ${e.classes.length > 1 ? classLabel(classOf(e.classes[0]!)) : e.classes[0]}` : r.examId,
    classes: r.classes,
    top: r.top,
    rows: r.rows,
    campus: r.campus,
    session: r.session,
    createdAt: r.createdAt,
    createdBy: r.createdBy,
    tiedAtCutOff: r.tiedAtCutOff,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Teacher performance (the old teacher/lecturer, department-wise and class-level reports)
// ---------------------------------------------------------------------------------------------------------

/** Every teacher's paper (exam × section × subject) with marks, across the exams of a campus and session. */
export function examTeacherPerformance(campus: CampusCode | "ALL", session: number, q: ExamsTeacherPerfQuery = {}): ExamsTeacherPerf {
  const exams = examsStore
    .get()
    .filter((e) => inScope(campus, session)(e) && e.category !== "ENTRANCE" && !e.programmeId)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const all: ExamsTeacherPerfRow[] = [];
  const typeIds = new Map<string, string>();
  for (const e of exams) {
    const type = typeOf(e);
    if (type) typeIds.set(type.id, type.name);
    const passRules = rules(e);
    const rows = examRows(e).filter((r) => !q.gender || r.gender === q.gender);
    for (const cs of e.classes)
      for (const s of e.subjects) {
        const teacher = subjectTeacher(e.campus, cs, s.id);
        const pass = Math.ceil((s.maxMarks * passRules.subjectPassPercent) / 100);
        const vals = rows.filter((r) => r.classSection === cs && s.id in r.marks).map((r) => ({ r, m: r.marks[s.id] ?? null })).filter((x) => x.m !== null);
        if (!vals.length) continue;
        const nums = vals.map((x) => (typeof x.m === "number" ? x.m : 0));
        const below = vals.filter((x) => typeof x.m === "number" && x.m < pass);
        const passed = vals.filter((x) => typeof x.m === "number" && x.m >= pass).length;
        const avg = nums.reduce((a, v) => a + v, 0) / nums.length;
        all.push({
          teacher,
          subjectId: s.id,
          subjectName: s.name,
          classSection: cs,
          examId: e.id,
          examName: e.name,
          examType: type?.name ?? e.name,
          startDate: e.startDate,
          status: e.status,
          sat: vals.length,
          averagePercent: Math.round((avg / s.maxMarks) * 1000) / 10,
          passRate: Math.round((passed / vals.length) * 1000) / 10,
          absent: vals.filter((x) => x.m === "A" || x.m === "L").length,
          failed: below.length,
          failedNames: below.map((x) => x.r.name),
        });
      }
  }
  const rows = all.filter(
    (r) =>
      (!q.teacher || r.teacher === q.teacher) &&
      (!q.subject || r.subjectId === q.subject) &&
      (!q.level || examsLevelOf(classOf(r.classSection)) === q.level) &&
      (!q.examTypeId || exams.find((e) => e.id === r.examId)?.typeId === q.examTypeId) &&
      (!q.month || r.startDate.slice(0, 7) === q.month),
  );
  const subjects = new Map<string, string>();
  for (const r of all) subjects.set(r.subjectId, r.subjectName);
  return {
    rows,
    teachers: [...new Set(all.map((r) => r.teacher))].sort((a, b) => a.localeCompare(b)),
    subjects: [...subjects.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    examTypes: [...typeIds.entries()].map(([id, name]) => ({ id, name })),
    months: [...new Set(all.map((r) => r.startDate.slice(0, 7)))].sort(),
  };
}

// ---------------------------------------------------------------------------------------------------------
// University
// ---------------------------------------------------------------------------------------------------------

function uniEarlier(sem: UniSemesterRecord): UniSemesterRecord[] {
  return uniStore
    .get()
    .semesters.filter((s) => s.programmeId === sem.programmeId && s.number < sem.number && s.status === "DECLARED" && s.students.some((st) => sem.students.some((x) => x.id === st.id)));
}

function uniMissing(sem: UniSemesterRecord): number {
  let n = 0;
  for (const st of sem.students) for (const c of sem.courses) if (uniCourseResult(c, sem.marks[st.id]?.[c.id]).status === "INCOMPLETE") n++;
  return n;
}

function uniSummary(sem: UniSemesterRecord): ExamsUniSemesterSummary {
  return {
    id: sem.id,
    programmeId: sem.programmeId,
    number: sem.number,
    label: sem.label,
    session: sem.session,
    status: sem.status,
    students: sem.students.length,
    courseCount: sem.courses.length,
    missing: sem.status === "DECLARED" ? 0 : uniMissing(sem),
    ...(sem.declaredOn ? { declaredOn: sem.declaredOn } : {}),
  };
}

/** Courses as sent: those Setup knows (by id) carry Setup's credit hours, read-only in the course panel while the semester is open. */
function uniCoursesOut(sem: UniSemesterRecord): ExamsUniCourse[] {
  if (sem.status === "DECLARED") return sem.courses.map(({ creditHoursFromSetup: _f, ...c }) => c);
  const credits = setupCreditHours();
  return sem.courses.map(({ creditHoursFromSetup: _f, ...c }) => (credits.has(c.id) ? { ...c, creditHoursFromSetup: true } : c));
}

function uniDetail(sem: UniSemesterRecord): ExamsUniSemester {
  const prog = uniStore.get().programmes.find((p) => p.id === sem.programmeId)!;
  return {
    ...uniSummary(sem),
    programmeShort: prog.short,
    programmeName: prog.name,
    campus: sem.campus,
    courses: uniCoursesOut(sem),
    rows: computeUniRows(sem, uniEarlier(sem)),
    history: [...sem.history].sort((a, b) => b.at.localeCompare(a.at)),
    ...(sem.declaredBy ? { declaredBy: sem.declaredBy } : {}),
  };
}

function updateUni(id: string, fn: (s: UniSemesterRecord) => UniSemesterRecord): UniSemesterRecord | undefined {
  let out: UniSemesterRecord | undefined;
  uniStore.set((st) => ({
    ...st,
    semesters: st.semesters.map((s) => {
      if (s.id !== id) return s;
      out = fn(s);
      return out;
    }),
  }));
  return out;
}

function checkUniPart(v: unknown, max: number, label: string, allowAbsent: boolean): string | null {
  if (v === null) return null;
  // A (absent) and L (leave) both count as 0; leave is recorded so it isn't treated as a missed paper.
  if ((v === "A" || v === "L") && allowAbsent) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) return `${label}: type a number${allowAbsent ? ", A for absent or L for leave" : ""}.`;
  if (v < 0) return `${label}: can't be below 0.`;
  if (v > max) return `${label}: maximum is ${max}.`;
  if (Math.round(v * 2) !== v * 2) return `${label}: use whole or half marks.`;
  return null;
}

/** Internal-assessment components from University exam types (Quiz, Test …), checked. Returns a problem or the list. */
function uniComponents(list: Array<{ typeId: string; max: number; date?: IsoDate }>): ExamsUniComponent[] | string {
  const types = typesStore.get();
  const out: ExamsUniComponent[] = [];
  for (const x of list) {
    const t = types.find((y) => y.id === x.typeId);
    if (!t || t.category !== "UNIVERSITY" || UNI_PAPER_TYPES.includes(t.id)) return "choose internal-assessment types from Exam types (University).";
    if (out.some((y) => y.typeId === t.id)) return `${t.name} is listed twice.`;
    if (!Number.isInteger(x.max) || x.max < 1 || x.max > 50) return `${t.name}: the maximum is a whole number from 1 to 50.`;
    out.push({ typeId: t.id, label: t.name, max: x.max, ...(x.date ? { date: x.date } : {}) });
  }
  if (!out.length) return "add at least one internal-assessment component (for example Quiz).";
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Programmes (Diamond Minds talent test)
// ---------------------------------------------------------------------------------------------------------

const programmeExam = (id: string) => examsStore.get().find((e) => e.programmeId === id);

function toProgramme(p: ProgrammeRecord): ExamsProgramme {
  const exam = programmeExam(p.id);
  return {
    id: p.id,
    campus: p.campus,
    session: p.session,
    name: p.name,
    kind: p.kind,
    centres: p.centres,
    participants: programmeStore.get().participants.filter((x) => x.programmeId === p.id).length,
    ...(exam ? { examId: exam.id, examStatus: exam.status } : {}),
  };
}

function toParticipant(rec: ParticipantRecord, rows: Map<string, ExamsResultRow>): ExamsParticipant {
  const r = rows.get(rec.regNo);
  const { programmeId: _p, ...rest } = rec;
  return {
    ...rest,
    ...(r ? { result: { obtained: r.obtained, max: r.max, percent: r.withheld ? null : r.percent, grade: r.withheld ? null : r.grade, position: r.withheld ? null : (r.classPosition ?? null), failedSubjects: r.failedSubjects ?? [] } } : {}),
  };
}

/** Keeps a draft programme test's roster in step with the participant list. */
function syncProgrammeRoster(programmeId: string) {
  const exam = programmeExam(programmeId);
  const prog = programmeStore.get().programmes.find((p) => p.id === programmeId);
  if (!exam || !prog || exam.status !== "DRAFT") return;
  const centreIds = prog.centres.filter((c) => exam.classes.includes(c.name)).map((c) => c.id);
  const roster = participantRoster(
    programmeStore.get().participants.filter((p) => p.programmeId === programmeId && centreIds.includes(p.centreId)),
    prog.centres,
  );
  update(exam.id, (x) => ({ ...x, roster }));
}

function checkParticipant(body: ExamsParticipantInput, prog: ProgrammeRecord): Response | null {
  const err = (field: string, message: string) => fail(422, "VALIDATION", message, { field });
  if (!body.name?.trim() || body.name.trim().length < 3) return err("name", "Enter the child's full name.");
  if (!body.father?.trim() || body.father.trim().length < 3) return err("father", "Enter the father's name.");
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(body.dob ?? "") || body.dob > DEMO_TODAY) return err("dob", "Enter the date of birth.");
  if (body.gender !== "M" && body.gender !== "F") return err("gender", "Choose boy or girl.");
  if (body.cnic && !isValidCnic(normalizeCnic(body.cnic))) return err("cnic", "A B-form or CNIC has 13 digits, for example 31303-1234567-1.");
  if (body.mobile && !normalizeMobile(body.mobile)) return err("mobile", "Enter a Pakistani mobile number, for example 0300-1234567.");
  if (!body.address?.trim() || body.address.trim().length < 8) return err("address", "Enter the home address: house, street and area.");
  if (!body.previousSchool?.trim()) return err("previousSchool", "Enter the school the child attends now.");
  if (!body.city?.trim()) return err("city", "Enter the city.");
  if (!prog.centres.some((c) => c.id === body.centreId)) return err("centreId", "Choose a test centre.");
  return null;
}

function cleanParticipant(body: ExamsParticipantInput): Omit<ParticipantRecord, "programmeId" | "regNo" | "rowVer"> {
  const cnic = body.cnic ? normalizeCnic(body.cnic) : "";
  const mobile = body.mobile ? normalizeMobile(body.mobile) : "";
  return {
    name: body.name.trim(),
    father: body.father.trim(),
    dob: body.dob,
    gender: body.gender,
    ...(cnic ? { cnic } : {}),
    ...(mobile ? { mobile } : {}),
    address: body.address.trim(),
    previousSchool: body.previousSchool.trim(),
    currentClass: body.currentClass?.trim() || "Class 9",
    city: body.city.trim(),
    centreId: body.centreId,
    ...(body.group ? { group: body.group } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------------------------------------

export const examsHandlers: HttpHandler[] = [
  http.get("/api/exams", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("exams.view", ctx.campus);
    if (user instanceof Response) return user;
    const list = examsStore
      .get()
      .filter(inScope(ctx.campus, ctx.session))
      .sort((a, b) => b.startDate.localeCompare(a.startDate) || a.classes[0]!.localeCompare(b.classes[0]!))
      .map(summary);
    return HttpResponse.json(list);
  }),

  http.post("/api/exams", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    if (ctx.campus === "ALL") return fail(422, "CAMPUS_REQUIRED", "Choose a campus first. An exam belongs to one campus.");
    const user = requirePermission("exams.manage", ctx.campus);
    if (user instanceof Response) return user;
    if (ctx.session !== CURRENT_SESSION) return fail(409, "SESSION_READ_ONLY", "Past sessions are read-only. Switch to the current session to set up an exam.");
    const body = (await request.json()) as ExamsCreateInput;
    const type = typesStore.get().find((t) => t.id === body.typeId);
    if (!type || !type.active) return fail(422, "VALIDATION", "Choose an exam type.", { field: "typeId" });
    if (type.category === "UNIVERSITY") return fail(422, "VALIDATION", "Semester exams are set up under University.", { field: "typeId" });
    if (type.programme && !body.programmeId) return fail(422, "VALIDATION", `${type.name} is set up under Exams → Programmes.`, { field: "typeId" });
    const name = body.name?.trim();
    if (!name) return fail(422, "VALIDATION", "Give the exam a name, for example “Second Term 2026–27”.", { field: "name" });
    if (!body.classes?.length) return fail(422, "VALIDATION", body.programmeId ? "Tick at least one test centre." : "Choose at least one section.", { field: "classes" });
    // A programme test (Diamond Minds): the "sections" are test centres and the candidates are participants.
    const programme = body.programmeId ? programmeStore.get().programmes.find((p) => p.id === body.programmeId && p.campus === ctx.campus) : undefined;
    if (body.programmeId && !programme) return fail(404, "NOT_FOUND", "This programme isn't at this campus.");
    // Board results: the students who sat the board exam last session, as they were then (promoted since).
    const source = body.sourceSession;
    if (source !== undefined && type.category !== "BOARD") return fail(422, "VALIDATION", "Only board results are recorded against an earlier session.", { field: "sourceSession" });
    if (source !== undefined && (source !== ctx.session - 1)) return fail(422, "VALIDATION", `Board results are recorded against session ${formatSession(ctx.session - 1)} (last year's class).`, { field: "sourceSession" });
    let classes: string[];
    let roster: ExamsRosterEntry[];
    if (programme) {
      const unknownCentre = body.classes.find((id) => !programme.centres.some((c) => c.id === id));
      if (unknownCentre) return fail(422, "VALIDATION", "One of the test centres isn't part of this programme.", { field: "classes" });
      if (examsStore.get().some((e) => e.programmeId === programme.id)) return fail(409, "DUPLICATE", `${programme.name} already has its test. Open it instead.`);
      const centres = programme.centres.filter((c) => body.classes.includes(c.id));
      classes = centres.map((c) => c.name);
      roster = participantRoster(programmeStore.get().participants.filter((p) => p.programmeId === programme.id && body.classes.includes(p.centreId)), programme.centres);
      if (!roster.length) return fail(422, "VALIDATION", "No participants are registered at these centres yet.", { field: "classes" });
    } else {
      const known = new Set(Object.keys(CLASS_SUBJECTS).flatMap((c) => sectionsOfClass(ctx.campus as CampusCode, c)));
      const lastYear = source !== undefined ? new Set(Object.keys(CLASS_SUBJECTS).flatMap((c) => lastSessionSections(ctx.campus as CampusCode, c).map((x) => x.label))) : null;
      const unknown = body.classes.find((cs) => !(lastYear ?? known).has(cs));
      if (unknown) return fail(422, "VALIDATION", `${unknown} ${lastYear ? `was not a section in ${formatSession(source!)}` : "is not a section at this campus"}.`, { field: "classes" });
      if (new Set(body.classes.map(classOf)).size > 1) return fail(422, "VALIDATION", "Set up one class at a time (its sections sit the same papers).", { field: "classes" });
      classes = [...body.classes].sort();
      roster = lastYear
        ? body.classes.flatMap((label) => {
            const from = lastSessionSections(ctx.campus as CampusCode, classOf(label)).find((x) => x.label === label)!;
            return examRoster(ctx.campus as CampusCode, from.now, label);
          })
        : body.classes.flatMap((cs) => examRoster(ctx.campus as CampusCode, cs));
    }
    if (!body.subjects?.length) return fail(422, "VALIDATION", "Add at least one subject.", { field: "subjects" });
    const offered = new Set(programme ? roster.map((p) => p.group).filter(Boolean) : classGroups(classOf(classes[0] ?? "")));
    const seen = new Set<string>();
    for (const [i, s] of body.subjects.entries()) {
      if (seen.has(s.id)) return fail(422, "VALIDATION", `${s.name} is listed twice.`, { field: "subjects", details: { line: i } });
      seen.add(s.id);
      if (!Number.isInteger(s.maxMarks) || s.maxMarks < 1 || s.maxMarks > 1000) return fail(422, "VALIDATION", `${s.name}: maximum marks must be a whole number from 1 to 1000.`, { field: "subjects", details: { line: i } });
      const badGroup = (s.groups ?? []).find((g) => !offered.has(g));
      if (badGroup) return fail(422, "VALIDATION", `${s.name}: ${badGroup} isn't a group in this class.`, { field: "subjects", details: { line: i } });
    }
    if (roster.some((p) => papersFor({ subjects: body.subjects }, p).length === 0)) return fail(422, "VALIDATION", "Some students sit none of these papers. Give every group at least one paper.", { field: "subjects" });
    const dup = examsStore.get().find((e) => e.campus === ctx.campus && e.session === ctx.session && e.name.toLowerCase() === name.toLowerCase() && e.classes.some((c) => classes.includes(c)));
    if (dup) return fail(409, "DUPLICATE", `${dup.name} already exists for ${dup.classes.join(", ")}. Open it instead, or use a different name.`);
    const dates = body.subjects.map((s) => s.date).filter((d): d is string => Boolean(d)).sort();
    const at = demoNow();
    const rec: ExamRecord = {
      id: `ex-${newId()}`,
      name,
      category: type.category,
      typeId: type.id,
      campus: ctx.campus as CampusCode,
      session: ctx.session,
      classes,
      subjects: body.subjects.map((s) => ({ ...s, name: s.name.trim(), ...(s.groups?.length ? { groups: s.groups } : {}) })),
      startDate: dates[0] ?? at.slice(0, 10),
      ...(dates.length ? { endDate: dates[dates.length - 1]! } : {}),
      status: "DRAFT",
      roster,
      marks: {},
      papers: {},
      history: [
        {
          id: newId(),
          at,
          by: user.name,
          action: "Exam created",
          detail: `${plural(body.subjects.length, "subject")} · ${body.subjects.reduce((a, s) => a + s.maxMarks, 0)} marks · ${programme ? plural(classes.length, "test centre") : classes.join(", ")}${source !== undefined ? ` · students of ${formatSession(source)}` : ""}`,
        },
      ],
      ...(type.category === "ENTRANCE" ? { candidateLabel: programme ? ("Participant" as const) : ("Applicant" as const) } : {}),
      ...(programme ? { programmeId: programme.id } : {}),
      ...(source !== undefined ? { sourceSession: source } : {}),
    };
    // Board results start with the board roll numbers already on the students' records.
    if (rec.category === "BOARD") {
      const part = boardPartOf(rec);
      const rolls = Object.fromEntries(roster.flatMap((p) => {
        const n = p.hasProfile ? findStudent(p.id)?.boardRollNo?.[part] : undefined;
        return n ? [[p.id, n]] : [];
      }));
      if (Object.keys(rolls).length) rec.boardRollNos = rolls;
    }
    examsStore.set((list) => [rec, ...list]);
    return HttpResponse.json(detail(rec), { status: 201 });
  }),

  http.get("/api/exams-templates", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("exams.view", ctx.campus);
    if (user instanceof Response) return user;
    if (ctx.campus === "ALL") return HttpResponse.json([]);
    const campus = ctx.campus as CampusCode;
    // Last session (board results): each class's sections as they were then, with the students now promoted.
    const past = ctx.session === CURRENT_SESSION - 1;
    if (ctx.session < CURRENT_SESSION - 1) return HttpResponse.json([]);
    const list: ExamsClassTemplate[] = Object.keys(CLASS_SUBJECTS)
      .map((c) => {
        const sections = past
          ? lastSessionSections(campus, c).map(({ label, now }) => {
              const roster = examRoster(campus, now, label);
              const groups = groupCounts(roster);
              return { classSection: label, students: roster.length, ...(groups ? { groups } : {}) };
            })
          : sectionsOfClass(campus, c).map((cs) => {
              const roster = examRoster(campus, cs);
              const groups = groupCounts(roster);
              return { classSection: cs, students: roster.length, ...(groups ? { groups } : {}) };
            });
        const groups = classGroups(c);
        return { classShort: c, className: classLabel(c), sections, subjects: CLASS_SUBJECTS[c]!, ...(groups.length ? { groups } : {}) };
      })
      .filter((t) => t.sections.length > 0);
    return HttpResponse.json(list);
  }),

  http.get("/api/exams/:id", async ({ params }) => {
    await latency();
    const g = guardExam(String(params.id), "exams.view");
    if (g instanceof Response) return g;
    return HttpResponse.json(detail(g.e));
  }),

  http.put("/api/exams/:id/datesheet", async ({ params, request }) => {
    await latency();
    const g = guardExam(String(params.id), "exams.manage");
    if (g instanceof Response) return g;
    const { e, user } = g;
    if (e.session !== CURRENT_SESSION) return fail(409, "SESSION_READ_ONLY", "This session is closed. The date sheet can't be changed.");
    if (e.status === "DECLARED") return fail(409, "DECLARED", "Results are declared. The date sheet is locked.");
    const { subjects } = (await request.json()) as { subjects: ExamsSubject[] };
    if (subjects.length !== e.subjects.length || subjects.some((s) => !e.subjects.some((x) => x.id === s.id))) return fail(422, "VALIDATION", "Papers can't be added or removed once the exam is set up.");
    for (const s of subjects) {
      if (!Number.isInteger(s.maxMarks) || s.maxMarks < 1 || s.maxMarks > 1000) return fail(422, "VALIDATION", `${s.name}: maximum marks must be a whole number from 1 to 1000.`, { field: s.id });
      const over = e.roster.filter((p) => {
        const m = e.marks[p.id]?.[s.id];
        return typeof m === "number" && m > s.maxMarks;
      }).length;
      if (over > 0) return fail(422, "VALIDATION", `${s.name}: ${plural(over, "mark")} already entered ${over === 1 ? "is" : "are"} above ${s.maxMarks}. Correct ${over === 1 ? "it" : "them"} first.`, { field: s.id });
      if (s.durationMins !== undefined && (!Number.isInteger(s.durationMins) || s.durationMins < 10 || s.durationMins > 300)) return fail(422, "VALIDATION", `${s.name}: the paper should last 10 to 300 minutes.`, { field: s.id });
    }
    const dates = subjects.map((s) => s.date).filter((d): d is string => Boolean(d)).sort();
    const updated = update(e.id, (x) => ({
      ...x,
      subjects: x.subjects.map((s) => {
        const n = subjects.find((y) => y.id === s.id)!;
        return { ...s, maxMarks: n.maxMarks, ...(n.date ? { date: n.date } : {}), ...(n.startTime ? { startTime: n.startTime } : {}), ...(n.durationMins ? { durationMins: n.durationMins } : {}), ...(n.supervisor !== undefined ? { supervisor: n.supervisor } : {}) };
      }),
      ...(dates.length ? { startDate: dates[0]!, endDate: dates[dates.length - 1]! } : {}),
      history: log(x, user.name, "Date sheet updated"),
    }));
    return HttpResponse.json(detail(updated!));
  }),

  http.put("/api/exams/:id/marks", async ({ params, request }) => {
    await latency();
    const g = guardExam(String(params.id), "exams.manage");
    if (g instanceof Response) return g;
    const body = (await request.json()) as { classSection: string; subjectId: string; marks: Record<string, ExamsMark>; boardRollNos?: Record<string, string> };
    // Board exams: the candidates' board roll numbers travel with the marks (or on their own).
    if (body.boardRollNos && Object.keys(body.boardRollNos).length) {
      const r = saveBoardRollNos(g.e.id, body.classSection, body.boardRollNos, g.user.name);
      if (!r.ok) return respond(r, (v) => v);
      if (!Object.keys(body.marks ?? {}).length) {
        const e = findExam(g.e.id)!;
        const subject = e.subjects.find((s) => s.id === body.subjectId) ?? e.subjects[0]!;
        return HttpResponse.json({ savedAt: demoNow(), saved: r.value, paper: paperOf(e, body.classSection, subject), missingMarks: summary(e).missingMarks });
      }
    }
    return respond(saveExamMarks(g.e.id, body.classSection, body.subjectId, body.marks ?? {}, g.user.name), (v) => v);
  }),

  http.post("/api/exams/:id/papers", async ({ params, request }) => {
    await latency();
    const g = guardExam(String(params.id), "exams.manage");
    if (g instanceof Response) return g;
    const body = (await request.json()) as { classSection: string; subjectId: string; action: ExamsPaperAction; note?: string };
    return respond(setExamPaperStatus(g.e.id, body.classSection, body.subjectId, body.action, g.user.name, body.note), (v) => detail(v));
  }),

  http.post("/api/exams/:id/withhold", async ({ params, request }) => {
    await latency();
    const g = guardExam(String(params.id), "exams.declare");
    if (g instanceof Response) return g;
    const { e, user } = g;
    if (e.session !== CURRENT_SESSION) return fail(409, "SESSION_READ_ONLY", "This session is closed.");
    if (e.status === "DECLARED") return fail(409, "DECLARED", "Results are declared. Reopen them to withhold or release a result.");
    const { personId, reason } = (await request.json()) as { personId: string; reason: string | null };
    const person = e.roster.find((p) => p.id === personId);
    if (!person) return fail(404, "NOT_FOUND", "This student doesn't sit this exam.");
    if (reason !== null && !reason.trim()) return fail(422, "VALIDATION", "Say why the result is withheld.", { field: "reason" });
    const updated = update(e.id, (x) => {
      const withheld = { ...(x.withheld ?? {}) };
      if (reason === null) delete withheld[personId];
      else withheld[personId] = reason.trim();
      return {
        ...x,
        withheld,
        history: [...x.history, { id: newId(), at: demoNow(), by: user.name, action: reason === null ? "Result released" : "Result withheld", detail: `${person.name} (${person.classSection})${reason ? ` · ${reason.trim()}` : ""}` }],
      };
    });
    return HttpResponse.json(detail(updated!));
  }),

  // Class teacher's remark for one student's result card (locked once declared; logged).
  http.post("/api/exams/:id/remarks", async ({ params, request }) => {
    await latency();
    const g = guardExam(String(params.id), "exams.manage");
    if (g instanceof Response) return g;
    const { e, user } = g;
    if (e.session !== CURRENT_SESSION) return fail(409, "SESSION_READ_ONLY", "This session is closed.");
    if (e.status === "DECLARED") return fail(409, "DECLARED", "Results are declared. Reopen them to change a remark.");
    const { personId, text } = (await request.json()) as { personId: string; text: string };
    const person = e.roster.find((p) => p.id === personId);
    if (!person) return fail(404, "NOT_FOUND", "This student doesn't sit this exam.");
    const clean = (text ?? "").trim();
    if (clean.length > 200) return fail(422, "VALIDATION", `Keep the remark to 200 characters (it has ${clean.length}).`, { field: "text" });
    const before = e.remarks?.[personId] ?? "";
    if (before === clean) return HttpResponse.json(detail(e));
    const updated = update(e.id, (x) => {
      const remarks = { ...(x.remarks ?? {}) };
      if (clean) remarks[personId] = clean;
      else delete remarks[personId];
      return { ...x, remarks, history: [...x.history, { id: newId(), at: demoNow(), by: user.name, action: clean ? "Teacher remark saved" : "Teacher remark removed", detail: `${person.name} (${person.classSection})` }] };
    });
    return HttpResponse.json(detail(updated!));
  }),

  http.post("/api/exams/:id/declare", async ({ params, request }) => {
    await latency();
    const g = guardExam(String(params.id), "exams.declare");
    if (g instanceof Response) return g;
    const { e, user } = g;
    if (e.session !== CURRENT_SESSION) return fail(409, "SESSION_READ_ONLY", "This session is closed. Results can't be declared.");
    if (e.status === "DECLARED") return HttpResponse.json(detail(e));
    const s = summary(e);
    if (s.missingMarks > 0) return fail(409, "MARKS_MISSING", `${plural(s.missingMarks, "mark is", "marks are")} missing. Ask the exam office to complete them before declaring.`);
    let notify = false;
    try {
      const body = (await request.json()) as { notifyParents?: boolean } | null;
      notify = Boolean(body?.notifyParents);
    } catch {
      /* no body: an older client */
    }
    const at = demoNow();
    const used = bands(e);
    const frozen = computeRows(e, used, rules(e));
    const who = e.candidateLabel === "Applicant" ? "applicants" : "students";
    const updated = update(e.id, (x) => ({
      ...x,
      status: "DECLARED",
      declaredOn: at,
      declaredBy: user.name,
      frozen,
      frozenBands: used,
      history: [
        ...x.history,
        { id: newId(), at, by: user.name, action: "Results declared", detail: `${plural(x.roster.length, who.slice(0, -1), who)} · visible in the parent portal${Object.keys(x.withheld ?? {}).length ? ` · ${plural(Object.keys(x.withheld ?? {}).length, "result")} withheld` : ""}` },
      ],
    }));
    // Result messages go through Messages (outbox, delivery report, pause and opt-out rules); the SMS mock logs the send here.
    if (notify && e.category !== "ENTRANCE" && !e.programmeId) {
      const sent = queueBatch(
        { campus: e.campus, session: e.session, templateId: "tpl-result", language: "en", audience: { kind: "EXAM", examId: e.id }, channel: "APP_FIRST", title: `${e.name} result`, source: "Exams" },
        user,
      );
      if (sent instanceof Response) {
        const reason = ((await sent.clone().json().catch(() => null)) as { message?: string } | null)?.message ?? "Messages couldn't queue them.";
        update(e.id, (x) => ({ ...x, history: [...x.history, { id: newId(), at, by: user.name, action: "Result messages not sent", detail: `${reason} Send them from “Send result messages”.` }] }));
      }
    }
    return HttpResponse.json(detail(findExam(e.id) ?? updated!));
  }),

  http.post("/api/exams/:id/reopen", async ({ params, request }) => {
    await latency();
    const g = guardExam(String(params.id), "exams.declare");
    if (g instanceof Response) return g;
    const { e, user } = g;
    if (e.session !== CURRENT_SESSION) return fail(409, "SESSION_READ_ONLY", "This session is closed. Results can't be reopened.");
    if (e.status !== "DECLARED") return fail(409, "NOT_DECLARED", "Only declared results can be reopened.");
    if (e.reopen?.status === "PENDING") return fail(409, "ALREADY_REQUESTED", "A reopen request is already waiting for an admin.");
    const { reason } = (await request.json()) as { reason: string };
    if (!reason?.trim()) return fail(422, "VALIDATION", "Say why the results need to be reopened.", { field: "reason" });
    const at = demoNow();
    const updated = update(e.id, (x) => ({
      ...x,
      reopen: { id: newId(), reason: reason.trim(), requestedBy: user.name, requestedAt: at, status: "PENDING" },
      history: [...x.history, { id: newId(), at, by: user.name, action: "Reopen requested", detail: reason.trim() }],
    }));
    return HttpResponse.json(detail(updated!), { status: 201 });
  }),

  http.post("/api/exams/:id/reopen/decide", async ({ params, request }) => {
    await latency();
    const e = findExam(String(params.id));
    if (!e) return fail(404, "NOT_FOUND", "No exam with this reference.");
    // Only an admin can reopen declared results.
    const user = requirePermission("settings.manage", e.campus);
    if (user instanceof Response) return user;
    if (e.reopen?.status !== "PENDING") return fail(409, "ALREADY_DECIDED", "There is no reopen request waiting.");
    const { decision } = (await request.json()) as { decision: "APPROVE" | "REJECT" };
    const at = demoNow();
    const approve = decision === "APPROVE";
    const updated = update(e.id, (x) => {
      const { frozen: _f, frozenBands: _fb, declaredOn: _d, declaredBy: _b, ...rest } = x;
      const reopen = { ...x.reopen!, status: approve ? ("APPROVED" as const) : ("REJECTED" as const), decidedBy: user.name, decidedAt: at };
      const history = [...x.history, { id: newId(), at, by: user.name, action: approve ? "Reopen approved — results back to draft" : "Reopen rejected", detail: x.reopen!.reason }];
      return approve ? { ...rest, status: "DRAFT", reopen, history } : { ...x, reopen, history };
    });
    return HttpResponse.json(detail(updated!));
  }),

  // ---- exam types ----
  http.get("/api/exams-types", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("exams.view", ctx.campus);
    if (user instanceof Response) return user;
    const exams = examsStore.get().filter(inScope(ctx.campus, ctx.session));
    const uni = uniStore.get().semesters.filter(inScope(ctx.campus, ctx.session));
    // University types: semesters that use them (every semester has a mid; declared ones had a final; components by course).
    const uniCount = (id: string) => (id === "et-uni-mid" ? uni.length : id === "et-uni-final" ? uni.filter((s) => s.status === "DECLARED").length : uni.filter((s) => s.courses.some((c) => c.components.some((x) => x.typeId === id))).length);
    const list: ExamsType[] = typesStore.get().map((t) => ({ ...t, exams: t.category === "UNIVERSITY" ? uniCount(t.id) : exams.filter((e) => e.typeId === t.id).length }));
    return HttpResponse.json(list);
  }),

  http.post("/api/exams-types", async ({ request }) => saveType(request, undefined)),
  http.put("/api/exams-types/:id", async ({ request, params }) => saveType(request, String(params.id))),

  // ---- grading and pass rules (several scales; the most specific one for an exam's kind and class is used) ----
  http.get("/api/exams-grading", async () => {
    await latency();
    // Grading scales are the same at every campus; anyone signed in may read them (result cards show them).
    const user = requireUser();
    if (user instanceof Response) return user;
    return HttpResponse.json(gradingStore.get().map((g) => ({ ...g, passRules: g.passRules ?? EXAMS_DEFAULT_PASS_RULES })));
  }),

  http.post("/api/exams-grading", async ({ request }) => saveScale(request, undefined)),
  http.put("/api/exams-grading/:id", async ({ request, params }) => saveScale(request, String(params.id))),

  // ---- combined (cumulative) results ----
  http.get("/api/exams-combined/options", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("exams.view", ctx.campus);
    if (user instanceof Response) return user;
    const exams = examsStore.get().filter((e) => inScope(ctx.campus, ctx.session)(e) && e.category !== "ENTRANCE");
    const byClass = new Map<string, ExamsCombinable>();
    for (const e of exams) {
      const c = classOf(e.classes[0] ?? "");
      const key = ctx.campus === "ALL" ? `${e.campus} ${c}` : c;
      const entry = byClass.get(key) ?? { classShort: key, className: ctx.campus === "ALL" ? `${classLabel(c)} · ${e.campus}` : classLabel(c), exams: [] };
      entry.exams.push({ id: e.id, name: e.name, category: e.category, status: e.status, startDate: e.startDate, totalMax: e.subjects.reduce((a, s) => a + s.maxMarks, 0) });
      byClass.set(key, entry);
    }
    const order = (k: string) => {
      const n = Number(k.split(" ").pop());
      return Number.isNaN(n) ? 0 : n;
    };
    return HttpResponse.json([...byClass.values()].map((x) => ({ ...x, exams: x.exams.sort((a, b) => a.startDate.localeCompare(b.startDate)) })).sort((a, b) => order(a.classShort) - order(b.classShort)));
  }),

  http.get("/api/exams-combined", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requirePermission("exams.view", ctx.campus);
    if (user instanceof Response) return user;
    const parts = (url.searchParams.get("parts") ?? "")
      .split(",")
      .filter(Boolean)
      .map((p) => {
        const [examId, w] = p.split(":");
        return { examId: examId ?? "", weight: Number(w) };
      });
    if (parts.length < 1) return fail(422, "VALIDATION", "Choose at least one exam to combine.");
    const exams = parts.map((p) => findExam(p.examId));
    if (exams.some((e) => !e)) return fail(404, "NOT_FOUND", "One of the exams no longer exists.");
    const list = exams as ExamRecord[];
    if (new Set(list.map((e) => `${e.campus}|${classOf(e.classes[0] ?? "")}`)).size > 1) return fail(422, "VALIDATION", "Combine exams of one class at one campus.");
    if (parts.some((p) => !Number.isInteger(p.weight) || p.weight < 1)) return fail(422, "VALIDATION", "Give each exam a whole-number weight of at least 1%.");
    const total = parts.reduce((a, p) => a + p.weight, 0);
    if (total !== 100) return fail(422, "VALIDATION", `The weights must add up to 100% (they add up to ${total}% now).`);
    const mode = url.searchParams.get("mode") === "AVERAGE" ? "AVERAGE" : "WEIGHTED";
    const rowsBy = list.map((e) => new Map(examRows(e).map((r) => [r.id, r])));
    const people = new Map<string, ExamsResultRow>();
    for (const m of rowsBy) for (const r of m.values()) if (!people.has(r.id)) people.set(r.id, r);
    const passRule = rules(list[0]!);
    const combinedBands = bands(list[0]!);
    // Every subject across the parts, in paper order.
    const subjects: Array<{ id: string; name: string }> = [];
    for (const e of list) for (const s of e.subjects) if (!subjects.some((x) => x.id === s.id)) subjects.push({ id: s.id, name: s.name });
    // Last session's final: the latest declared term exam of the previous session that each student sat.
    const wantLast = url.searchParams.get("last") === "1";
    const lastExams = wantLast
      ? examsStore
          .get()
          .filter((e) => e.campus === list[0]!.campus && e.session === list[0]!.session - 1 && e.status === "DECLARED" && e.category === "TERM")
          .sort((a, b) => b.startDate.localeCompare(a.startDate))
      : [];
    const lastRows = lastExams.map((e) => new Map(examRows(e).map((r) => [r.id, r])));
    const rows: ExamsCombinedRow[] = [...people.values()].map((p) => {
      const partsOut: ExamsCombinedRow["parts"] = {};
      let pct = 0;
      let complete = true;
      let failed = false;
      let counted = 0;
      let sum = 0;
      let obtained = 0;
      let max = 0;
      list.forEach((e, i) => {
        const r = rowsBy[i]!.get(p.id);
        if (!r || r.percent === null || r.withheld) {
          partsOut[e.id] = null;
          complete = false;
        } else {
          partsOut[e.id] = { obtained: r.obtained, max: r.max, percent: r.percent, grade: r.grade, position: r.position, ...(r.result ? { result: r.result } : {}) };
          pct += (r.percent * parts[i]!.weight) / 100;
          sum += r.percent;
          counted++;
          obtained += r.obtained;
          max += r.max;
          if (r.result === "FAIL") failed = true;
        }
      });
      const bySubject: NonNullable<ExamsCombinedRow["bySubject"]> = {};
      for (const s of subjects) {
        const entry: NonNullable<ExamsCombinedRow["bySubject"]>[string] = { parts: {}, obtained: 0, max: 0 };
        list.forEach((e, i) => {
          const r = rowsBy[i]!.get(p.id);
          const paper = e.subjects.find((x) => x.id === s.id);
          // Not sat: the exam had no such paper, or it is outside the student's group.
          if (!r || !paper || !(s.id in r.marks) || partsOut[e.id] === null) {
            entry.parts[e.id] = null;
            return;
          }
          const m = r.marks[s.id] ?? null;
          entry.parts[e.id] = { mark: m, max: paper.maxMarks };
          entry.obtained += typeof m === "number" ? m : 0;
          entry.max += paper.maxMarks;
        });
        if (entry.max > 0) bySubject[s.id] = entry;
      }
      const percent = mode === "AVERAGE" ? (counted > 0 ? Math.round((sum / counted) * 10) / 10 : null) : complete ? Math.round(pct * 10) / 10 : null;
      let lastPercent: number | null | undefined;
      if (wantLast) {
        lastPercent = null;
        for (const m of lastRows) {
          const r = m.get(p.id);
          if (r && r.percent !== null && !r.withheld) {
            lastPercent = r.percent;
            break;
          }
        }
      }
      return {
        id: p.id,
        name: p.name,
        ...(p.father ? { father: p.father } : {}),
        classSection: p.classSection,
        rollNo: p.rollNo,
        hasProfile: p.hasProfile,
        parts: partsOut,
        percent,
        grade: percent === null ? null : examsGradeFor(percent, combinedBands),
        position: null,
        classPosition: null,
        result: percent === null ? "INCOMPLETE" : failed || percent < passRule.overallPassPercent ? "FAIL" : "PASS",
        obtained,
        max,
        bySubject,
        ...(p.gender ? { gender: p.gender } : {}),
        ...(p.group ? { group: p.group } : {}),
        ...(lastPercent !== undefined ? { lastPercent } : {}),
        partsCounted: counted,
      };
    });
    const ranked = rows.filter((r) => r.percent !== null);
    for (const cs of new Set(rows.map((r) => r.classSection)))
      denseRank(
        ranked.filter((r) => r.classSection === cs),
        (r) => r.percent ?? 0,
        (r, n) => (r.position = n),
      );
    denseRank(
      ranked,
      (r) => r.percent ?? 0,
      (r, n) => (r.classPosition = n),
    );
    const out: ExamsCombined = {
      classShort: classOf(list[0]!.classes[0] ?? ""),
      parts: list.map((e, i) => {
        const type = typeOf(e);
        return { id: e.id, name: e.name, category: e.category, weight: parts[i]!.weight, totalMax: e.subjects.reduce((a, s) => a + s.maxMarks, 0), status: e.status, startDate: e.startDate, ...(type ? { typeName: type.name } : {}) };
      }),
      rows: rows.sort((a, b) => a.classSection.localeCompare(b.classSection) || a.rollNo - b.rollNo),
      subjects,
      mode,
      ...(wantLast ? { lastExam: lastExams[0] ? { name: lastExams[0].name, session: lastExams[0].session } : null } : {}),
    };
    return HttpResponse.json(out);
  }),

  // ---- merit lists ----
  http.get("/api/exams-merit", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requirePermission("exams.view", ctx.campus);
    if (user instanceof Response) return user;
    const e = findExam(url.searchParams.get("examId") ?? "");
    if (!e) return fail(404, "NOT_FOUND", "Choose an exam.");
    if (e.status !== "DECLARED") return fail(409, "NOT_DECLARED", "Merit lists use declared results only. Declare this exam's results first.");
    const top = Number(url.searchParams.get("top") ?? 10);
    if (!Number.isInteger(top) || top < 1 || top > 200) return fail(422, "VALIDATION", "Show between 1 and 200 students.", { field: "top" });
    const classes = (url.searchParams.get("classes") ?? "").split(",").filter(Boolean);
    return HttpResponse.json({ title: "", ...buildMerit(e, classes, top) });
  }),

  http.get("/api/exams-merit-lists", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requireUser();
    if (user instanceof Response) return user;
    // Activities (scholarships) reads saved lists too.
    return HttpResponse.json(
      meritStore
        .get()
        .filter(inScope(ctx.campus, ctx.session))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(toMeritList),
    );
  }),

  http.post("/api/exams-merit-lists", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const body = (await request.json()) as ExamsMeritSaveInput;
    const e = findExam(body.examId);
    if (!e) return fail(404, "NOT_FOUND", "Choose an exam.");
    const user = requirePermission("exams.manage", e.campus);
    if (user instanceof Response) return user;
    if (ctx.session !== CURRENT_SESSION) return fail(409, "SESSION_READ_ONLY", "Past sessions are read-only.");
    if (e.status !== "DECLARED") return fail(409, "NOT_DECLARED", "Merit lists use declared results only.");
    if (!body.title?.trim()) return fail(422, "VALIDATION", "Give the list a title, for example “Talent scholarship 2026–27 · Class 7”.", { field: "title" });
    const built = buildMerit(e, body.classes ?? [], body.top);
    const count = meritStore.get().filter((m) => m.campus === e.campus && m.session === e.session).length + 1;
    const yy = String(e.session % 100).padStart(2, "0") + String((e.session + 1) % 100).padStart(2, "0");
    const rec: ExamsMeritRecord = {
      id: `mer-${newId()}`,
      listNo: `MER-${e.campus}-${yy}-${String(count).padStart(3, "0")}`,
      title: body.title.trim(),
      purpose: body.purpose?.trim() ?? "",
      examId: e.id,
      classes: built.classes,
      top: body.top,
      campus: e.campus,
      session: e.session,
      createdAt: demoNow(),
      createdBy: user.name,
      rows: built.rows,
      tiedAtCutOff: built.tiedAtCutOff,
    };
    meritStore.set((list) => [rec, ...list]);
    update(e.id, (x) => ({ ...x, history: [...x.history, { id: newId(), at: rec.createdAt, by: user.name, action: "Merit list saved", detail: `${rec.listNo} · ${rec.title} · ${plural(rec.rows.length, "student")}` }] }));
    return HttpResponse.json(toMeritList(rec), { status: 201 });
  }),

  // ---- student history ----
  http.get("/api/exams-history", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requirePermission("exams.view", ctx.campus);
    if (user instanceof Response) return user;
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    if (q.length < 2) return HttpResponse.json([]);
    const hits = new Map<string, ExamsPersonHit>();
    const exams = examsStore
      .get()
      .filter((e) => (ctx.campus === "ALL" || e.campus === ctx.campus) && e.category !== "ENTRANCE")
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
    for (const e of exams)
      for (const p of e.roster) {
        if (hits.has(p.id)) continue;
        if (p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)) hits.set(p.id, { id: p.id, name: p.name, ...(p.father ? { father: p.father } : {}), classSection: p.classSection, campus: e.campus, hasProfile: p.hasProfile });
      }
    // University students too: they open their transcript and assessment history.
    const uni = uniStore.get();
    const sems = [...uni.semesters].filter((s) => ctx.campus === "ALL" || s.campus === ctx.campus).sort((a, b) => b.session - a.session || b.number - a.number);
    for (const sem of sems)
      for (const st of sem.students) {
        if (hits.has(st.id)) continue;
        if (!st.name.toLowerCase().includes(q) && !st.id.toLowerCase().includes(q)) continue;
        const prog = uni.programmes.find((x) => x.id === sem.programmeId);
        hits.set(st.id, { id: st.id, name: st.name, father: st.father, classSection: `${prog?.short ?? ""} · Semester ${sem.number}`, campus: sem.campus, hasProfile: false, university: { semesterId: sem.id, programmeShort: prog?.short ?? "" } });
      }
    return HttpResponse.json([...hits.values()].sort((a, b) => Number(b.hasProfile) - Number(a.hasProfile) || a.name.localeCompare(b.name)).slice(0, 12));
  }),

  http.get("/api/exams-history/:id", async ({ params }) => {
    await latency();
    const id = String(params.id);
    const exams = examsStore
      .get()
      .filter((e) => e.roster.some((p) => p.id === id))
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
    const first = exams[0];
    if (!first) return fail(404, "NOT_FOUND", "No exam results for this student.");
    const user = requirePermission("exams.view", first.campus);
    if (user instanceof Response) return user;
    const p = first.roster.find((x) => x.id === id)!;
    const entries: ExamsHistoryEntry[] = exams
      .filter((e) => e.status === "DECLARED")
      .flatMap((e) => {
        const r = examRows(e).find((x) => x.id === id);
        if (!r) return [];
        const type = typeOf(e);
        const usedBands = e.frozenBands ?? bands(e);
        return [
          {
            examId: e.id,
            exam: e.name,
            category: e.category,
            ...(e.typeId ? { typeId: e.typeId } : {}),
            ...(type ? { typeName: type.name } : {}),
            session: e.session,
            classSection: r.classSection,
            startDate: e.startDate,
            ...(e.declaredOn ? { declaredOn: e.declaredOn } : {}),
            obtained: r.obtained,
            max: r.max,
            percent: r.withheld ? null : r.percent,
            grade: r.withheld ? null : r.grade,
            position: r.position,
            classPosition: r.classPosition ?? null,
            result: r.result ?? (r.percent === null ? "INCOMPLETE" : "PASS"),
            subjects: e.subjects
              .filter((s) => examsSits(s, r.group))
              .map((s) => {
                const mark = r.marks[s.id] ?? null;
                // Absent and leave count as 0 %; a mark not entered has no % or grade.
                const percent = mark === null ? null : Math.round(((typeof mark === "number" ? mark : 0) / s.maxMarks) * 1000) / 10;
                return { subjectId: s.id, name: s.name, mark, max: s.maxMarks, ...(s.date ? { date: s.date } : {}), percent, grade: percent === null ? null : examsGradeFor(percent, usedBands) };
              }),
          },
        ];
      });
    // Group, contact and address from the latest exam (the student's current details).
    const group = p.group ?? examRows(first).find((x) => x.id === id)?.group;
    const address = p.address ?? (p.hasProfile ? findStudent(p.id)?.guardian.address : undefined);
    const out: ExamsStudentHistory = {
      person: {
        id: p.id,
        name: p.name,
        ...(p.father ? { father: p.father } : {}),
        classSection: p.classSection,
        campus: first.campus,
        hasProfile: p.hasProfile,
        ...(group ? { group } : {}),
        ...(p.mobile ? { guardianMobile: p.mobile } : {}),
        ...(address ? { address } : {}),
      },
      entries,
    };
    return HttpResponse.json(out);
  }),

  // ---- teacher performance across exams, classes and departments ----
  http.get("/api/exams-teacher-performance", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requirePermission("exams.view", ctx.campus);
    if (user instanceof Response) return user;
    const p = url.searchParams;
    const level = p.get("level");
    const gender = p.get("gender");
    const q: ExamsTeacherPerfQuery = {
      ...(p.get("teacher") ? { teacher: p.get("teacher")! } : {}),
      ...(p.get("subject") ? { subject: p.get("subject")! } : {}),
      ...(level === "PRIMARY" || level === "MIDDLE" || level === "SECONDARY" ? { level } : {}),
      ...(p.get("examTypeId") ? { examTypeId: p.get("examTypeId")! } : {}),
      ...(p.get("month") ? { month: p.get("month")! } : {}),
      ...(gender === "M" || gender === "F" ? { gender } : {}),
    };
    return HttpResponse.json(examTeacherPerformance(ctx.campus, ctx.session, q));
  }),

  // ---- programmes (Diamond Minds) ----
  http.get("/api/exams-programmes", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("exams.view", ctx.campus);
    if (user instanceof Response) return user;
    return HttpResponse.json(programmeStore.get().programmes.filter(inScope(ctx.campus, ctx.session)).map(toProgramme));
  }),

  http.get("/api/exams-programmes/:id/participants", async ({ params, request }) => {
    await latency();
    const url = new URL(request.url);
    const prog = programmeStore.get().programmes.find((p) => p.id === String(params.id));
    if (!prog) return fail(404, "NOT_FOUND", "No programme with this reference.");
    const user = requirePermission("exams.view", prog.campus);
    if (user instanceof Response) return user;
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const centre = url.searchParams.get("centre") ?? "";
    const gender = url.searchParams.get("gender") ?? "";
    const group = url.searchParams.get("group") ?? "";
    const school = (url.searchParams.get("school") ?? "").trim().toLowerCase();
    const exam = programmeExam(prog.id);
    const rows = new Map(exam ? examRows(exam).map((r) => [r.id, r]) : []);
    const list = programmeStore
      .get()
      .participants.filter((p) => p.programmeId === prog.id)
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.regNo.toLowerCase().includes(q))
      .filter((p) => !centre || p.centreId === centre)
      .filter((p) => !gender || p.gender === gender)
      .filter((p) => !group || p.group === group)
      .filter((p) => !school || p.previousSchool.toLowerCase() === school)
      .sort((a, b) => a.regNo.localeCompare(b.regNo))
      .map((p) => toParticipant(p, rows));
    return HttpResponse.json(list);
  }),

  http.post("/api/exams-programmes/:id/participants", async ({ params, request }) => {
    await latency();
    const prog = programmeStore.get().programmes.find((p) => p.id === String(params.id));
    if (!prog) return fail(404, "NOT_FOUND", "No programme with this reference.");
    const user = requirePermission("exams.manage", prog.campus);
    if (user instanceof Response) return user;
    if (prog.session !== CURRENT_SESSION) return fail(409, "SESSION_READ_ONLY", "This programme belongs to a closed session.");
    const body = (await request.json()) as ExamsParticipantInput;
    const bad = checkParticipant(body, prog);
    if (bad) return bad;
    const clean = cleanParticipant(body);
    const st = programmeStore.get();
    const dup = st.participants.find((p) => p.programmeId === prog.id && p.name.toLowerCase() === clean.name.toLowerCase() && p.father.toLowerCase() === clean.father.toLowerCase() && p.dob === clean.dob);
    if (dup) return fail(409, "DUPLICATE", `${dup.name} (${dup.regNo}) is already registered. Open that record instead.`);
    const yy = String(prog.session % 100).padStart(2, "0");
    const next = Math.max(0, ...st.participants.filter((p) => p.programmeId === prog.id).map((p) => Number(p.regNo.split("-").pop()) || 0)) + 1;
    const rec: ParticipantRecord = { programmeId: prog.id, regNo: `DM-${yy}-${String(next).padStart(4, "0")}`, ...clean, rowVer: 1 };
    programmeStore.set((s) => ({ ...s, participants: [...s.participants, rec] }));
    syncProgrammeRoster(prog.id);
    const exam = programmeExam(prog.id);
    if (exam) update(exam.id, (x) => ({ ...x, history: [...x.history, { id: newId(), at: demoNow(), by: user.name, action: "Participant registered", detail: `${rec.regNo} · ${rec.name}` }] }));
    return HttpResponse.json(toParticipant(rec, new Map()), { status: 201 });
  }),

  http.put("/api/exams-programmes/:id/participants/:regNo", async ({ params, request }) => {
    await latency();
    const prog = programmeStore.get().programmes.find((p) => p.id === String(params.id));
    if (!prog) return fail(404, "NOT_FOUND", "No programme with this reference.");
    const user = requirePermission("exams.manage", prog.campus);
    if (user instanceof Response) return user;
    if (prog.session !== CURRENT_SESSION) return fail(409, "SESSION_READ_ONLY", "This programme belongs to a closed session.");
    const existing = programmeStore.get().participants.find((p) => p.programmeId === prog.id && p.regNo === String(params.regNo));
    if (!existing) return fail(404, "NOT_FOUND", "This participant is no longer registered.");
    const body = (await request.json()) as ExamsParticipantInput & { rowVer?: number };
    if (body.rowVer !== undefined && body.rowVer !== existing.rowVer) return fail(409, "CONFLICT", `${existing.name}'s record was changed by someone else since you opened it. Reload to see the changes.`);
    const bad = checkParticipant(body, prog);
    if (bad) return bad;
    const exam = programmeExam(prog.id);
    if (exam?.status === "DECLARED" && body.centreId !== existing.centreId) return fail(409, "DECLARED", "The test results are declared, so the centre can't change.", { field: "centreId" });
    const rec: ParticipantRecord = { programmeId: prog.id, regNo: existing.regNo, ...cleanParticipant(body), ...(existing.applicantId ? { applicantId: existing.applicantId, applicationNo: existing.applicationNo } : {}), rowVer: existing.rowVer + 1 };
    programmeStore.set((s) => ({ ...s, participants: s.participants.map((p) => (p.programmeId === prog.id && p.regNo === rec.regNo ? rec : p)) }));
    syncProgrammeRoster(prog.id);
    if (exam) update(exam.id, (x) => ({ ...x, history: log(x, user.name, "Participant updated", `${rec.regNo} · ${rec.name}`) }));
    const rows = new Map(exam ? examRows(programmeExam(prog.id)!).map((r) => [r.id, r]) : []);
    return HttpResponse.json(toParticipant(rec, rows));
  }),

  // A participant who wants to join MTB: an admissions applicant (Diamond Minds), filled in from the participant.
  http.post("/api/exams-programmes/:id/participants/:regNo/admission", async ({ params, request }) => {
    await latency();
    const prog = programmeStore.get().programmes.find((p) => p.id === String(params.id));
    if (!prog) return fail(404, "NOT_FOUND", "No programme with this reference.");
    const user = requirePermission("admissions.manage", prog.campus);
    if (user instanceof Response) return user;
    if (prog.session !== CURRENT_SESSION) return fail(409, "SESSION_READ_ONLY", "This programme belongs to a closed session.");
    const rec = programmeStore.get().participants.find((p) => p.programmeId === prog.id && p.regNo === String(params.regNo));
    if (!rec) return fail(404, "NOT_FOUND", "This participant is no longer registered.");
    if (rec.applicantId) return fail(409, "DUPLICATE", `${rec.name} already has application ${rec.applicationNo ?? ""}. Open it in Admissions.`);
    const { classApplied } = (await request.json()) as { classApplied: string };
    const rule = ruleFor(classApplied);
    if (rule.classApplied !== classApplied) return fail(422, "VALIDATION", "Choose the class the child is applying for.", { field: "classApplied" });
    if (!rec.mobile) return fail(422, "VALIDATION", "Add the family's mobile number to the participant first. Admissions needs it.", { field: "mobile" });
    const st = admissionsStore.get();
    const n = (st.appSeq[prog.campus] ?? 400) + 1;
    const applicationNo = `${prog.campus}-APP-${String(prog.session % 100).padStart(2, "0")}${String((prog.session + 1) % 100).padStart(2, "0")}-${String(n).padStart(4, "0")}`;
    const result = (() => {
      const exam = programmeExam(prog.id);
      const r = exam ? examRows(exam).find((x) => x.id === rec.regNo) : undefined;
      return r && r.percent !== null ? ` · test ${r.obtained}/${r.max} (${r.percent}%)` : "";
    })();
    const applicant: AdmissionsApplicant = {
      id: `adm-${prog.campus}-${n}`,
      applicationNo,
      name: rec.name,
      relation: rec.gender === "F" ? "d/o" : "s/o",
      father: rec.father,
      fatherCnic: "",
      dob: rec.dob,
      gender: rec.gender,
      ...(rec.cnic ? { bForm: rec.cnic } : {}),
      previousSchool: rec.previousSchool,
      campus: prog.campus,
      campusName: campusName(prog.campus),
      session: prog.session,
      classApplied: rule.classApplied,
      stage: "APPLIED",
      appliedOn: DEMO_TODAY,
      source: "DESK",
      testScore: null,
      testMax: subjectsFor(rule.classApplied).reduce((x, s) => x + s.max, 0),
      ...(rule.testRequired ? {} : { directAdmission: true }),
      ...(rule.testRequired && rule.candidateFee > 0 ? { fee: { amount: rule.candidateFee, status: "DUE" as const } } : {}),
      diamondMinds: true,
      mobile: rec.mobile,
      address: rec.address,
      history: [{ at: demoNow(), by: user.name, text: `Application ${applicationNo} started from Diamond Minds participant ${rec.regNo}${result}` }],
    } as AdmissionsApplicant;
    admissionsStore.set({ ...st, applicants: [applicant, ...st.applicants], appSeq: { ...st.appSeq, [prog.campus]: n } });
    const next: ParticipantRecord = { ...rec, applicantId: applicant.id, applicationNo, rowVer: rec.rowVer + 1 };
    programmeStore.set((s) => ({ ...s, participants: s.participants.map((p) => (p.programmeId === prog.id && p.regNo === rec.regNo ? next : p)) }));
    const exam = programmeExam(prog.id);
    if (exam) update(exam.id, (x) => ({ ...x, history: [...x.history, { id: newId(), at: demoNow(), by: user.name, action: "Admission started", detail: `${rec.regNo} · ${rec.name} → ${applicationNo} (${rule.classApplied})` }] }));
    return HttpResponse.json(toParticipant(next, new Map(exam ? examRows(exam).map((r) => [r.id, r]) : [])), { status: 201 });
  }),

  // ---- university ----
  http.get("/api/exams-uni", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("exams.view", ctx.campus);
    if (user instanceof Response) return user;
    const st = uniStore.get();
    const list: ExamsUniProgramme[] = st.programmes
      .filter((p) => ctx.campus === "ALL" || p.campus === ctx.campus)
      .map((p) => {
        const sems = st.semesters.filter((s) => s.programmeId === p.id);
        const students = new Map<string, { id: string; name: string; father: string }>();
        for (const s of [...sems].sort((a, b) => b.number - a.number)) for (const x of s.students) if (!students.has(x.id)) students.set(x.id, { id: x.id, name: x.name, father: x.father });
        return { ...p, semesters: [...sems].sort((a, b) => b.number - a.number).map(uniSummary), students: [...students.values()].sort((a, b) => a.id.localeCompare(b.id)) };
      });
    return HttpResponse.json(list);
  }),

  http.post("/api/exams-uni/programmes", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    if (ctx.campus === "ALL") return fail(422, "CAMPUS_REQUIRED", "Choose a campus first. A programme belongs to one campus.");
    const user = requirePermission("exams.manage", ctx.campus);
    if (user instanceof Response) return user;
    if (ctx.session !== CURRENT_SESSION) return fail(409, "SESSION_READ_ONLY", "Past sessions are read-only.");
    const body = (await request.json()) as ExamsUniProgrammeInput;
    const short = body.short?.trim();
    const name = body.name?.trim();
    if (!short || short.length > 12) return fail(422, "VALIDATION", "Give the programme a short name of up to 12 characters, for example MCS.", { field: "short" });
    if (!name || name.length < 4) return fail(422, "VALIDATION", "Give the programme its full name, for example Master of Computer Science.", { field: "name" });
    if (!Number.isInteger(body.years) || body.years < 1 || body.years > 6) return fail(422, "VALIDATION", "A programme lasts 1 to 6 years.", { field: "years" });
    const st = uniStore.get();
    if (st.programmes.some((p) => p.campus === ctx.campus && p.short.toLowerCase() === short.toLowerCase())) return fail(409, "DUPLICATE", `${short} already runs at this campus.`, { field: "short" });
    const components = uniComponents(body.components ?? []);
    if (typeof components === "string") return fail(422, "VALIDATION", components, { field: "components" });
    const rec = { id: `uni-${newId()}`, campus: ctx.campus as CampusCode, short, name, years: body.years, components };
    uniStore.set((s) => ({ ...s, programmes: [...s.programmes, rec] }));
    return HttpResponse.json({ ...rec, semesters: [], students: [] } satisfies ExamsUniProgramme, { status: 201 });
  }),

  http.post("/api/exams-uni/semesters", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const body = (await request.json()) as ExamsUniSemesterInput;
    const st = uniStore.get();
    const prog = st.programmes.find((p) => p.id === body.programmeId);
    if (!prog) return fail(404, "NOT_FOUND", "Choose a programme.", { field: "programmeId" });
    const user = requirePermission("exams.manage", prog.campus);
    if (user instanceof Response) return user;
    if (ctx.session !== CURRENT_SESSION || body.session !== CURRENT_SESSION) return fail(409, "SESSION_READ_ONLY", "New semesters are set up in the current session.");
    if (!Number.isInteger(body.number) || body.number < 1 || body.number > prog.years * 2) return fail(422, "VALIDATION", `${prog.short} has semesters 1 to ${prog.years * 2}.`, { field: "number" });
    if (st.semesters.some((s) => s.programmeId === prog.id && s.number === body.number && s.session === body.session)) return fail(409, "DUPLICATE", `Semester ${body.number} of ${prog.short} is already set up this session.`, { field: "number" });
    const label = body.label?.trim();
    if (!label) return fail(422, "VALIDATION", "Say which term it is, for example Spring 2027.", { field: "label" });
    const known = new Map<string, { id: string; name: string; father: string; mobile?: string }>();
    for (const s of st.semesters.filter((x) => x.programmeId === prog.id)) for (const x of s.students) known.set(x.id, x);
    const carried = (body.studentIds ?? []).map((id) => known.get(id));
    if (carried.some((x) => !x)) return fail(422, "VALIDATION", "One of the students isn't enrolled in this programme.", { field: "studentIds" });
    const fresh = (body.newStudents ?? []).map((x) => ({ name: x.name?.trim() ?? "", father: x.father?.trim() ?? "" }));
    const badNew = fresh.findIndex((x) => x.name.length < 3 || x.father.length < 3);
    if (badNew >= 0) return fail(422, "VALIDATION", `New student ${badNew + 1}: write the name and the father's name, separated by a comma.`, { field: "newStudents" });
    const yy = String(body.session % 100).padStart(2, "0");
    const prefix = `${prog.campus}-${prog.short.replace(/[^A-Za-z]/g, "").toUpperCase()}-${yy}-`;
    const taken = [...known.keys()].filter((id) => id.startsWith(prefix)).map((id) => Number(id.slice(prefix.length)) || 0);
    let seq = Math.max(0, ...taken);
    const students = [...(carried as Array<{ id: string; name: string; father: string; mobile?: string }>), ...fresh.map((x) => ({ id: `${prefix}${String(++seq).padStart(3, "0")}`, ...x }))];
    if (!students.length) return fail(422, "VALIDATION", "Add at least one student.", { field: "studentIds" });
    const at = demoNow();
    const rec: UniSemesterRecord = {
      id: `${prog.id}-s${body.number}-${newId().slice(0, 4)}`,
      programmeId: prog.id,
      number: body.number,
      label: `Semester ${body.number} · ${label}`,
      session: body.session,
      campus: prog.campus,
      status: "DRAFT",
      courses: [],
      students,
      marks: {},
      history: [{ id: newId(), at, by: user.name, action: "Semester opened", detail: `${plural(students.length, "student")}${fresh.length ? ` (${fresh.length} new)` : ""} · add the courses next` }],
    };
    uniStore.set((s) => ({ ...s, semesters: [...s.semesters, rec] }));
    return HttpResponse.json(uniDetail(rec), { status: 201 });
  }),

  http.put("/api/exams-uni/semesters/:id/courses", async ({ params, request }) => {
    await latency();
    const sem = uniStore.get().semesters.find((s) => s.id === String(params.id));
    if (!sem) return fail(404, "NOT_FOUND", "No semester with this reference.");
    const user = requirePermission("exams.manage", sem.campus);
    if (user instanceof Response) return user;
    if (sem.session !== CURRENT_SESSION) return fail(409, "SESSION_READ_ONLY", "This session is closed. Courses can't be changed.");
    if (sem.status === "DECLARED") return fail(409, "DECLARED", "This semester's results are declared, so its courses are locked.");
    const { courses } = (await request.json()) as { courses: ExamsUniCourseInput[] };
    if (!courses?.length) return fail(422, "VALIDATION", "Add at least one course.", { field: "courses" });
    const codes = new Set<string>();
    const out: ExamsUniCourse[] = [];
    const setupCredits = setupCreditHours();
    for (const [i, c] of courses.entries()) {
      const where = (msg: string) => fail(422, "VALIDATION", `${c.code?.trim() || `Course ${i + 1}`}: ${msg}`, { field: "courses", details: { line: i } });
      const code = c.code?.trim().toUpperCase() ?? "";
      if (!/^[A-Z]{2,5}-?[0-9]{3}$/.test(code)) return where("use a course code like CS-401.");
      if (codes.has(code)) return where("this course code is used twice.");
      codes.add(code);
      if (!c.title?.trim() || c.title.trim().length < 3) return where("give the course a title.");
      if (!Number.isInteger(c.creditHours) || c.creditHours < 1 || c.creditHours > 6) return where("credit hours are a whole number from 1 to 6.");
      // Setup holds the credit hours of courses it knows: a different value here is refused, not silently replaced.
      const fromSetup = c.id ? setupCredits.get(c.id) : undefined;
      if (fromSetup !== undefined && c.creditHours !== fromSetup) return where(`credit hours come from Setup › Subjects › Class subjects (${fromSetup}). Change them there.`);
      if (!c.teacher?.trim()) return where("name the course teacher.");
      const components = uniComponents(c.components ?? []);
      if (typeof components === "string") return where(components);
      const sessionalMax = components.reduce((a, x) => a + x.max, 0);
      if (![c.midMax, c.finalMax].every((n) => Number.isInteger(n) && n >= 0)) return where("maximum marks must be whole numbers.");
      if (sessionalMax + c.midMax + c.finalMax !== 100) return where(`internal assessment (${sessionalMax}), mid (${c.midMax}) and final (${c.finalMax}) must add up to 100 (they add up to ${sessionalMax + c.midMax + c.finalMax}).`);
      if (c.durationMins !== undefined && (!Number.isInteger(c.durationMins) || c.durationMins < 30 || c.durationMins > 300)) return where("a paper lasts 30 to 300 minutes.");
      if (c.midDate && c.finalDate && c.finalDate <= c.midDate) return where("the final paper must come after the mid paper.");
      const prev = c.id ? sem.courses.find((x) => x.id === c.id) : undefined;
      if (c.id && !prev) return where("this course is no longer in the semester. Reload and try again.");
      // Marks already entered must still fit the new maxima.
      if (prev) {
        const over = sem.students.find((st) => {
          const m = sem.marks[st.id]?.[prev.id];
          if (!m) return false;
          const partOver = components.some((x) => {
            const v = m.parts?.[x.typeId];
            return typeof v === "number" && v > x.max;
          });
          return partOver || (typeof m.mid === "number" && m.mid > c.midMax) || (typeof m.final === "number" && m.final > c.finalMax);
        });
        if (over) return where(`${over.name}'s marks are above the new maximum. Correct them first.`);
      }
      out.push({
        id: prev?.id ?? `c-${newId()}`,
        code,
        title: c.title.trim(),
        creditHours: c.creditHours,
        teacher: c.teacher.trim(),
        sessionalMax,
        midMax: c.midMax,
        finalMax: c.finalMax,
        components,
        ...(c.supervisor?.trim() ? { supervisor: c.supervisor.trim() } : {}),
        ...(c.midDate ? { midDate: c.midDate } : {}),
        ...(c.finalDate ? { finalDate: c.finalDate } : {}),
        ...(c.durationMins ? { durationMins: c.durationMins } : {}),
      });
    }
    const removed = sem.courses.filter((c) => !out.some((x) => x.id === c.id));
    const withMarks = removed.find((c) => sem.students.some((st) => sem.marks[st.id]?.[c.id]));
    if (withMarks) return fail(409, "IN_USE", `${withMarks.code} already has marks, so it can't be removed.`, { field: "courses" });
    const updated = updateUni(sem.id, (s) => ({
      ...s,
      courses: out,
      history: [...s.history, { id: newId(), at: demoNow(), by: user.name, action: "Courses saved", detail: `${plural(out.length, "course")} · ${out.reduce((a, c) => a + c.creditHours, 0)} credit hours` }],
    }));
    return HttpResponse.json(uniDetail(updated!));
  }),

  http.get("/api/exams-uni/semesters/:id", async ({ params }) => {
    await latency();
    const sem = uniStore.get().semesters.find((s) => s.id === String(params.id));
    if (!sem) return fail(404, "NOT_FOUND", "No semester with this reference.");
    const user = requirePermission("exams.view", sem.campus);
    if (user instanceof Response) return user;
    return HttpResponse.json(uniDetail(sem));
  }),

  http.put("/api/exams-uni/semesters/:id/marks", async ({ params, request }) => {
    await latency();
    const sem = uniStore.get().semesters.find((s) => s.id === String(params.id));
    if (!sem) return fail(404, "NOT_FOUND", "No semester with this reference.");
    const user = requirePermission("exams.manage", sem.campus);
    if (user instanceof Response) return user;
    if (sem.session !== CURRENT_SESSION) return fail(409, "SESSION_READ_ONLY", "This session is closed. Marks can't be changed.");
    if (sem.status === "DECLARED") return fail(409, "DECLARED", "This semester's results are declared and locked.");
    const body = (await request.json()) as { courseId: string; marks: Record<string, ExamsUniMark> };
    const course = sem.courses.find((c) => c.id === body.courseId);
    if (!course) return fail(422, "VALIDATION", "This semester has no such course.");
    const clean: Record<string, ExamsUniMark> = {};
    for (const [sid, m] of Object.entries(body.marks ?? {})) {
      const st = sem.students.find((x) => x.id === sid);
      if (!st) return fail(422, "VALIDATION", `${sid} is not enrolled in this semester.`);
      const msg =
        (course.components.length
          ? course.components.map((x) => checkUniPart(m.parts?.[x.typeId] ?? null, x.max, x.label, true)).find((x) => x !== null) ?? null
          : checkUniPart(m.sessional, course.sessionalMax, "Sessional", false)) ??
        checkUniPart(m.mid, course.midMax, "Mid", true) ??
        checkUniPart(m.final, course.finalMax, "Final", true) ??
        (m.attendance !== null && (typeof m.attendance !== "number" || m.attendance < 0 || m.attendance > 100) ? "Attendance: use a % from 0 to 100." : null) ??
        ((m.remark ?? "").length > 120 ? "Remarks: keep it to 120 characters." : null);
      if (msg) return fail(422, "VALIDATION", `${st.name}: ${msg} Nothing was saved for this student.`, { details: [{ personId: sid, message: msg }] });
      // Sessional is always the sum of the components (A and L count as 0).
      const parts = course.components.length ? Object.fromEntries(course.components.map((x) => [x.typeId, m.parts?.[x.typeId] ?? null])) : undefined;
      const next: ExamsUniMark = { ...m, ...(parts ? { parts } : {}), ...(m.remark?.trim() ? { remark: m.remark.trim() } : { remark: undefined }) };
      next.sessional = parts ? uniSessional(course, next) : m.sessional;
      if (!next.remark) delete next.remark;
      clean[sid] = next;
    }
    const updated = updateUni(sem.id, (s) => {
      const marks = { ...s.marks };
      for (const [sid, m] of Object.entries(clean)) marks[sid] = { ...(marks[sid] ?? {}), [course.id]: m };
      const last = s.history[s.history.length - 1];
      const detailText = `${course.code} ${course.title}`;
      const history = last && last.by === user.name && last.action === "Marks saved" && last.detail === detailText ? [...s.history.slice(0, -1), { ...last, at: demoNow() }] : [...s.history, { id: newId(), at: demoNow(), by: user.name, action: "Marks saved", detail: detailText }];
      return { ...s, marks, history };
    });
    return HttpResponse.json(uniDetail(updated!));
  }),

  http.post("/api/exams-uni/semesters/:id/declare", async ({ params }) => {
    await latency();
    const sem = uniStore.get().semesters.find((s) => s.id === String(params.id));
    if (!sem) return fail(404, "NOT_FOUND", "No semester with this reference.");
    const user = requirePermission("exams.declare", sem.campus);
    if (user instanceof Response) return user;
    if (sem.session !== CURRENT_SESSION) return fail(409, "SESSION_READ_ONLY", "This session is closed.");
    if (sem.status === "DECLARED") return HttpResponse.json(uniDetail(sem));
    if (!sem.courses.length) return fail(409, "NO_COURSES", "This semester has no courses yet. Add them under Courses first.");
    const missing = uniMissing(sem);
    if (missing > 0) return fail(409, "MARKS_MISSING", `${plural(missing, "course result is", "course results are")} incomplete (final papers not yet marked). Results can be declared once every mark is in.`);
    const at = demoNow();
    const updated = updateUni(sem.id, (s) => ({ ...s, status: "DECLARED", declaredOn: at, declaredBy: user.name, history: [...s.history, { id: newId(), at, by: user.name, action: "Results declared", detail: "GPA and CGPA locked" }] }));
    return HttpResponse.json(uniDetail(updated!));
  }),

  http.get("/api/exams-uni/transcripts/:id", async ({ params }) => {
    await latency();
    const id = String(params.id);
    const st = uniStore.get();
    const sems = st.semesters.filter((s) => s.students.some((x) => x.id === id)).sort((a, b) => a.number - b.number);
    const first = sems[0];
    if (!first) return fail(404, "NOT_FOUND", "No semester results for this registration number.");
    const user = requirePermission("exams.view", first.campus);
    if (user instanceof Response) return user;
    const prog = st.programmes.find((p) => p.id === first.programmeId)!;
    const student = first.students.find((x) => x.id === id)!;
    const typeName = (tid: string) => typesStore.get().find((t) => t.id === tid)?.name ?? tid;
    let ch = 0;
    let qp = 0;
    let earned = 0;
    const assessments: ExamsUniAssessment[] = [];
    const semesters: ExamsUniTranscript["semesters"] = sems.map((s) => {
      const results = Object.fromEntries(s.courses.map((c) => [c.id, uniCourseResult(c, s.marks[id]?.[c.id])]));
      const declared = s.status === "DECLARED";
      const gpa = declared ? uniGpa(s.courses, results) : null;
      if (declared && gpa !== null)
        for (const c of s.courses) {
          const r = results[c.id]!;
          ch += c.creditHours;
          qp += (r.points ?? 0) * c.creditHours;
          if ((r.points ?? 0) > 0) earned += c.creditHours;
        }
      // Every marked assessment of the semester: components, then the mid and final papers.
      for (const c of s.courses) {
        const m = s.marks[id]?.[c.id];
        if (!m) continue;
        const add = (typeId: string, v: ExamsUniPart | undefined, max: number, date: IsoDate | undefined) => {
          if (v === null || v === undefined || max <= 0) return;
          const pct = typeof v === "number" ? Math.round((v / max) * 1000) / 10 : 0;
          assessments.push({ ...(date ? { date } : {}), semesterId: s.id, semesterLabel: s.label, courseCode: c.code, courseTitle: c.title, typeId, examType: typeName(typeId), obtained: v, max, percent: pct, grade: typeof v === "number" ? examsGradeFor(pct, EXAMS_DEFAULT_SCALE) : "F" });
        };
        for (const comp of c.components) add(comp.typeId, m.parts?.[comp.typeId], comp.max, comp.date);
        if (!c.components.length && m.sessional !== null) add("et-uni-sessional", m.sessional, c.sessionalMax, undefined);
        add("et-uni-mid", m.mid, c.midMax, c.midDate);
        add("et-uni-final", m.final, c.finalMax, c.finalDate);
      }
      return {
        id: s.id,
        label: s.label,
        status: s.status,
        courses: s.courses.map((c) => {
          const r = results[c.id]!;
          return { code: c.code, title: c.title, creditHours: c.creditHours, grade: declared ? r.grade : null, points: declared ? r.points : null, status: declared ? r.status : "INCOMPLETE" };
        }),
        gpa,
        cgpa: declared && ch ? Math.round((qp / ch) * 100) / 100 : null,
        credits: s.courses.reduce((a, c) => a + c.creditHours, 0),
      };
    });
    assessments.sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999") || a.courseCode.localeCompare(b.courseCode));
    const out: ExamsUniTranscript = {
      id,
      name: student.name,
      father: student.father,
      programmeShort: prog.short,
      programmeName: prog.name,
      campus: first.campus,
      semesters,
      cgpa: ch ? Math.round((qp / ch) * 100) / 100 : null,
      creditsEarned: earned,
      assessments,
      counts: { tests: assessments.length, absents: assessments.filter((a) => a.obtained === "A").length, leaves: assessments.filter((a) => a.obtained === "L").length },
    };
    return HttpResponse.json(out);
  }),
];

async function saveType(request: Request, id: string | undefined) {
  await latency();
  const ctx = ctxFrom(new URL(request.url));
  const user = requirePermission("exams.manage", ctx.campus === "ALL" ? "ALL" : ctx.campus);
  if (user instanceof Response) return user;
  if (ctx.session !== CURRENT_SESSION) return fail(409, "SESSION_READ_ONLY", `Session ${formatSession(ctx.session)} is read-only.`);
  const body = (await request.json()) as ExamsTypeInput;
  const name = body.name?.trim();
  if (!name) return fail(422, "VALIDATION", "Give the exam type a name.", { field: "name" });
  if (typesStore.get().some((t) => t.id !== id && t.name.toLowerCase() === name.toLowerCase())) return fail(409, "DUPLICATE", `There is already an exam type called ${name}. Use that one, or choose another name.`, { field: "name" });
  if (!Number.isInteger(body.absenceFine) || body.absenceFine < 0 || body.absenceFine > 5000) return fail(422, "VALIDATION", "The absence fine must be a whole number of rupees from 0 to 5,000.", { field: "absenceFine" });
  const existing = id ? typesStore.get().find((t) => t.id === id) : undefined;
  if (id && !existing) return fail(404, "NOT_FOUND", "No exam type with this reference.");
  if (existing && existing.category !== body.category && examsStore.get().some((e) => e.typeId === existing.id)) return fail(409, "IN_USE", `${existing.name} is used by exams already, so its category can't change. Add a new type instead.`, { field: "category" });
  // The type's own papers (Hifz): checked like an exam's papers. Exams already set up keep their papers.
  const papers: ExamsSubject[] = [];
  for (const [i, s] of (body.papers ?? []).entries()) {
    const pname = s.name?.trim();
    if (!pname) return fail(422, "VALIDATION", `Paper ${i + 1} has no name.`, { field: "papers", details: { line: i } });
    if (!Number.isInteger(s.maxMarks) || s.maxMarks < 1 || s.maxMarks > 1000) return fail(422, "VALIDATION", `${pname}: maximum marks must be a whole number from 1 to 1000.`, { field: "papers", details: { line: i } });
    const pid = (s.id || pname.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")) || `p${i + 1}`;
    if (papers.some((x) => x.id === pid || x.name.toLowerCase() === pname.toLowerCase())) return fail(422, "VALIDATION", `${pname} is listed twice.`, { field: "papers", details: { line: i } });
    papers.push({ id: pid, name: pname, maxMarks: s.maxMarks, ...(s.nameUrdu?.trim() ? { nameUrdu: s.nameUrdu.trim() } : {}) });
  }
  if (papers.length && (body.category === "UNIVERSITY" || body.category === "BOARD")) return fail(422, "VALIDATION", "Board and university types take their papers from the class or course, not the type.", { field: "papers" });
  const rec: ExamsTypeRecord = {
    id: existing?.id ?? `et-${newId()}`,
    name,
    nameUrdu: body.nameUrdu?.trim() ?? "",
    category: body.category,
    rankScope: body.category === "TEST" ? body.rankScope : "EXAM",
    countsForPromotion: Boolean(body.countsForPromotion),
    absenceFine: body.absenceFine,
    active: body.active,
    ...(existing?.programme ? { programme: true } : {}),
    ...(papers.length ? { papers } : {}),
  };
  typesStore.set((list) => (existing ? list.map((t) => (t.id === existing.id ? rec : t)) : [...list, rec]));
  const exams = examsStore.get().filter((e) => e.typeId === rec.id && e.session === ctx.session).length;
  return HttpResponse.json({ ...rec, exams } satisfies ExamsType, { status: existing ? 200 : 201 });
}

async function saveScale(request: Request, id: string | undefined) {
  await latency();
  const ctx = ctxFrom(new URL(request.url));
  const user = requirePermission("exams.manage", ctx.campus);
  if (user instanceof Response) return user;
  if (ctx.session !== CURRENT_SESSION) return fail(409, "SESSION_READ_ONLY", "Grading rules can only be changed in the current session.");
  const body = (await request.json()) as ExamsGradeScaleInput;
  const existing = id ? gradingStore.get().find((g) => g.id === id) : undefined;
  if (id && !existing) return fail(404, "NOT_FOUND", "No grade scale with this reference.");
  if (existing && body.rowVer !== undefined && body.rowVer !== existing.rowVer)
    return fail(409, "CONFLICT", `${existing.name} was changed by ${existing.updatedBy} since you opened it. Reload to see their changes.`, { details: { updatedBy: existing.updatedBy, updatedAt: existing.updatedAt } });
  const name = body.name?.trim();
  if (!name) return fail(422, "VALIDATION", "Give the scale a name, for example “Progress report”.", { field: "name" });
  if (gradingStore.get().some((g) => g.id !== id && g.name.toLowerCase() === name.toLowerCase())) return fail(409, "DUPLICATE", `There is already a scale called ${name}.`, { field: "name" });
  const issues = examsValidateBands(body.bands ?? []);
  if (issues.length > 0) return fail(422, "VALIDATION", issues[0]!.message, { field: "bands" });
  const problems = examsValidatePassRules(body.passRules ?? EXAMS_DEFAULT_PASS_RULES);
  if (problems.length) return fail(422, "VALIDATION", problems[0]!, { field: "passRules" });
  const standard = Boolean(existing?.standard);
  const appliesTo = standard ? { categories: [] as ExamsCategory[], classes: [] as string[] } : { categories: [...new Set(body.appliesTo?.categories ?? [])], classes: [...new Set(body.appliesTo?.classes ?? [])] };
  if (!standard && appliesTo.categories.length === 0 && appliesTo.classes.length === 0) return fail(422, "VALIDATION", "Tick the exam kinds or classes this scale is for. Everything else uses the Standard scale.", { field: "appliesTo" });
  const clash = gradingStore.get().find((g) => g.id !== id && !g.standard && JSON.stringify([...g.appliesTo.categories].sort()) === JSON.stringify([...appliesTo.categories].sort()) && JSON.stringify([...g.appliesTo.classes].sort()) === JSON.stringify([...appliesTo.classes].sort()));
  if (clash) return fail(409, "DUPLICATE", `${clash.name} already applies to the same kinds and classes. Change that scale instead.`, { field: "appliesTo" });
  const rec: ExamsGradeScale = {
    id: existing?.id ?? `gs-${newId()}`,
    name,
    appliesTo,
    bands: [...body.bands].sort((a, b) => b.min - a.min),
    passRules: body.passRules,
    updatedBy: user.name,
    updatedAt: demoNow(),
    rowVer: (existing?.rowVer ?? 0) + 1,
    ...(standard ? { standard: true } : {}),
  };
  gradingStore.set((list) => (existing ? list.map((g) => (g.id === existing.id ? rec : g)) : [...list, rec]));
  return HttpResponse.json(rec, { status: existing ? 200 : 201 });
}
