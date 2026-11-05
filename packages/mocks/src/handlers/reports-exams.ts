// Report centre: the Exams reports. They read the exams store (the same results, positions and grades as the
// Exams pages and their prints), not marks of their own.
import { examsAnalyse, examsGroupShort, type CampusCode, type CampusScope, type ExamsResultRow, type ReportCell, type ReportColumnDef, type ReportDefinition, type ReportFilterValues } from "@mtb/api";
import { formatDate, formatSession } from "@mtb/domain";
import { registerSections } from "../fixtures/attendance";
import { campusName } from "../fixtures/campuses";
import type { ExamRecord } from "../fixtures/exams";
import { examDetail, examRows, examsStore } from "./exams";

type Row = Record<string, ReportCell>;
interface ExamGen {
  campuses: CampusCode[];
  session: number;
  f: ReportFilterValues;
}
interface ExamGenOut {
  rows: Row[];
  columns?: ReportColumnDef[];
  notes?: string[];
  subtitle?: string[];
}
/** Throws the report centre's plain-English filter error. */
type Raise = (message: string, field?: string) => never;

const classOf = (cs: string) => cs.split("-")[0] ?? "";
const classLabel = (c: string) => (c === "Prep" ? "Prep" : `Class ${c}`);
const examClass = (e: Pick<ExamRecord, "classes">) => classOf(e.classes[0] ?? "");
const CLASS_ORDER = ["Prep", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];

/** School exams (not entrance tests or programme tests) of a campus and session, newest first. */
function schoolExams(campus: CampusScope, session: number): ExamRecord[] {
  return examsStore
    .get()
    .filter((e) => (campus === "ALL" || e.campus === campus) && e.session === session && e.category !== "ENTRANCE" && !e.programmeId)
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
}

/** The catalogue's exam choices come from the exams of the campus and session (declared, or marked provisional). */
export function liveExamDefinition(def: ReportDefinition, campus: CampusScope, session: number): ReportDefinition {
  if (!def.filters.some((x) => x.key === "exam")) return def;
  const options = [
    { value: "", label: "Latest exam of the class" },
    ...schoolExams(campus, session).map((e) => ({ value: e.id, label: `${e.name} · ${classLabel(examClass(e))}${campus === "ALL" ? ` · ${campusName(e.campus).replace(" Campus", "")}` : ""}${e.status === "DECLARED" ? "" : " · provisional"}` })),
  ];
  return { ...def, filters: def.filters.map((x) => (x.key === "exam" ? { ...x, options, default: "" } : x)) };
}

/** The exam a report is about: the one chosen, or the latest exam of the class (declared first). */
function pickExam(campus: CampusCode, session: number, examId: string | undefined, cls: string, raise: Raise): ExamRecord | null {
  if (examId) {
    const e = examsStore.get().find((x) => x.id === examId);
    if (!e) return raise("That exam no longer exists. Choose another exam.", "exam");
    if (e.campus !== campus) return null;
    if (cls && examClass(e) !== cls) return raise(`${e.name} is for ${classLabel(examClass(e))}, not ${classLabel(cls)}. Choose another exam or class.`, "exam");
    return e;
  }
  const list = schoolExams(campus, session).filter((e) => examClass(e) === cls);
  return list.find((e) => e.status === "DECLARED") ?? list[0] ?? null;
}

const ofGender = (f: ReportFilterValues) => (r: ExamsResultRow) => !f.gender || r.gender === f.gender;
const markCell = (m: ExamsResultRow["marks"][string] | undefined): ReportCell => (m === null || m === undefined ? "" : m);
const examLine = (e: ExamRecord) => `${e.name}${e.status === "DECLARED" ? "" : " (provisional: not declared)"}`;
const RESULT: Record<string, string> = { PASS: "Pass", SUPPLY: "Re-sit", FAIL: "Fail", INCOMPLETE: "Incomplete", WITHHELD: "Withheld" };

/** The Exams report generators, keyed by report id. */
export function examReportGenerators(raise: Raise): Record<string, (g: ExamGen) => ExamGenOut> {
  /** One section's exam, checked. */
  const sectionExam = (campus: CampusCode, session: number, f: ReportFilterValues) => {
    const cs = f.classSection ?? "";
    if (!registerSections(campus).includes(cs)) return raise(`There is no class ${cs} at ${campusName(campus)}.`, "classSection");
    const e = pickExam(campus, session, f.exam || undefined, classOf(cs), raise);
    if (!e) return raise(`${classLabel(classOf(cs))} has no exam at ${campusName(campus)} in ${formatSession(session)}.`, "exam");
    if (!e.classes.includes(cs)) return raise(`${cs} doesn't sit ${e.name}.`, "classSection");
    return { cs, e };
  };
  /** The exams of a class at each campus (the chosen one, or each campus's latest). */
  const classExams = (campuses: CampusCode[], session: number, f: ReportFilterValues) => {
    const out: Array<{ campus: CampusCode; e: ExamRecord }> = [];
    for (const campus of campuses) {
      const classes = f.class ? [f.class] : f.exam ? [""] : CLASS_ORDER;
      for (const cls of classes) {
        const e = pickExam(campus, session, f.exam || undefined, cls, raise);
        if (e && !out.some((x) => x.e.id === e.id)) out.push({ campus, e });
      }
    }
    if (f.exam && !out.length) return raise("That exam is at another campus. Choose its campus at the top of the page.", "exam");
    return out;
  };

  return {
    "exam-master-sheet": ({ campuses, session, f }) => {
      const { cs, e } = sectionExam(campuses[0]!, session, f);
      const rows = examRows(e)
        .filter((r) => r.classSection === cs && ofGender(f)(r))
        .sort((a, b) => a.rollNo - b.rollNo);
      const grouped = rows.some((r) => r.group);
      const maxes = new Set(rows.map((r) => r.max));
      const name = (id: string) => e.subjects.find((s) => s.id === id)?.name ?? id;
      const columns: ReportColumnDef[] = [
        { key: "roll", label: "Roll", kind: "count" },
        { key: "grNo", label: "G.R. No.", kind: "mono" },
        { key: "student", label: "Student", kind: "text" },
        ...(grouped ? [{ key: "group", label: "Grp", kind: "text" as const }] : []),
        ...e.subjects.map((s) => ({ key: `s-${s.id}`, label: `${s.name} /${s.maxMarks}`, kind: "count" as const })),
        { key: "total", label: maxes.size === 1 ? `Total /${[...maxes][0]}` : "Total", kind: "count" },
        ...(maxes.size > 1 ? [{ key: "max", label: "Out of", kind: "count" as const }] : []),
        { key: "percent", label: "%", kind: "percent" },
        { key: "grade", label: "Grade", kind: "text" },
        { key: "position", label: "Position", kind: "count" },
        { key: "result", label: "Result", kind: "text" },
        { key: "failed", label: "Failed subjects", kind: "text" },
      ];
      const out = rows.map((r) => {
        const row: Row = { roll: r.rollNo, grNo: r.id, student: r.name, ...(grouped ? { group: examsGroupShort(r.group) } : {}) };
        // A paper outside the student's group is blank, not missing.
        for (const s of e.subjects) row[`s-${s.id}`] = s.id in r.marks ? markCell(r.marks[s.id]) : null;
        return { ...row, total: r.obtained, ...(maxes.size > 1 ? { max: r.max } : {}), percent: r.percent, grade: r.withheld ? "" : (r.grade ?? ""), position: r.withheld ? null : r.position, result: RESULT[r.result ?? ""] ?? "", failed: (r.failedSubjects ?? []).map(name).join(", ") };
      });
      return { rows: out, columns, subtitle: [examLine(e)], notes: ["A = absent, L = leave. Same marks, positions and grades as Exams → Results and the printed master sheet."] };
    },

    "exam-positions": ({ campuses, session, f }) => {
      const top = Number(f.top || 10);
      const rows: Row[] = [];
      const names: string[] = [];
      for (const { campus, e } of classExams(campuses, session, f)) {
        names.push(examLine(e));
        const list = examRows(e)
          .filter((r) => r.percent !== null && !r.withheld && ofGender(f)(r))
          .sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0) || a.name.localeCompare(b.name));
        const cut = list[top - 1]?.classPosition ?? Infinity;
        list
          .filter((r, i) => i < top || r.classPosition === cut)
          .forEach((r) => rows.push({ campus, position: r.classPosition ?? null, grNo: r.id, student: r.name, classSection: r.classSection, group: examsGroupShort(r.group), total: r.obtained, max: r.max, percent: r.percent, grade: r.grade ?? "" }));
      }
      return { rows, subtitle: names, notes: ["Class positions from the exam (equal percentages share a position, so more students can be listed at the cut-off)."] };
    },

    "exam-failed": ({ campuses, session, f }) => {
      const rows: Row[] = [];
      const names: string[] = [];
      for (const { campus, e } of classExams(campuses, session, f)) {
        names.push(`${examLine(e)} · ${classLabel(examClass(e))}`);
        const name = (id: string) => e.subjects.find((s) => s.id === id)?.name ?? id;
        for (const r of examRows(e).filter((x) => (x.result === "FAIL" || x.result === "SUPPLY") && ofGender(f)(x) && (!f.section || x.classSection.endsWith(`-${f.section}`))))
          rows.push({ campus, grNo: r.id, student: r.name, classSection: r.classSection, group: examsGroupShort(r.group), failed: (r.failedSubjects ?? []).map(name).join(", "), count: (r.failedSubjects ?? []).length, obtained: r.obtained, max: r.max, percent: r.percent, grade: r.grade ?? "", result: RESULT[r.result ?? ""] ?? "" });
      }
      rows.sort((a, b) => String(a.classSection).localeCompare(String(b.classSection)) || Number(b.count) - Number(a.count));
      return { rows, subtitle: names, ...(rows.length ? {} : { notes: ["Every student met the pass rules."] }) };
    },

    "exam-subject-analysis": ({ campuses, session, f }) => {
      const rows: Row[] = [];
      const names: string[] = [];
      for (const { campus, e } of classExams(campuses, session, f)) {
        names.push(examLine(e));
        const d = examDetail(e);
        const a = examsAnalyse(d, "ALL", f.gender === "M" || f.gender === "F" ? { gender: f.gender } : {});
        for (const s of a.subjects) {
          if (!s.sat) continue;
          const teachers = [...new Set(a.sections.filter((x) => x.subjectId === s.subjectId).map((x) => x.teacher).filter((t): t is string => Boolean(t)))];
          rows.push({ campus, subject: s.name, teacher: teachers.join(", ") || "—", students: s.sat, average: s.averagePercent, pass: s.passRate, highest: s.highest, lowest: s.lowest, absent: s.absent, failures: s.failed });
        }
      }
      return { rows, subtitle: names };
    },

    "exam-result-cards": ({ campuses, session, f }) => {
      const { cs, e } = sectionExam(campuses[0]!, session, f);
      const rows = examRows(e)
        .filter((r) => r.classSection === cs)
        .sort((a, b) => a.rollNo - b.rollNo)
        .map((r) => ({ roll: r.rollNo, grNo: r.id, student: r.name, total: r.obtained, max: r.max, percent: r.withheld ? null : r.percent, grade: r.withheld ? "" : (r.grade ?? ""), position: r.withheld ? null : r.position, result: RESULT[r.result ?? ""] ?? "" }));
      return { rows, subtitle: [examLine(e)], notes: ["One A4 result card per student, with subject marks, the position in the section and the class teacher's remarks (Exams → Print)."] };
    },

    "exam-tests-cumulative": ({ campuses, session, f }) => {
      const campus = campuses[0]!;
      const cs = f.classSection ?? "";
      if (!registerSections(campus).includes(cs)) return raise(`There is no class ${cs} at ${campusName(campus)}.`, "classSection");
      const tests = schoolExams(campus, session)
        .filter((e) => e.category === "TEST" && e.classes.includes(cs))
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
      // Last session's final: the latest declared term exam each student sat (not counted in the average).
      const finals = examsStore
        .get()
        .filter((e) => e.campus === campus && e.session === session - 1 && e.status === "DECLARED" && e.category === "TERM")
        .sort((a, b) => b.startDate.localeCompare(a.startDate))
        .map((e) => new Map(examRows(e).map((r) => [r.id, r])));
      const testRows = tests.map((e) => new Map(examRows(e).map((r) => [r.id, r])));
      const roster = new Map<string, ExamsResultRow>();
      for (const m of testRows) for (const r of m.values()) if (r.classSection === cs && !roster.has(r.id)) roster.set(r.id, r);
      const columns: ReportColumnDef[] = [
        { key: "roll", label: "Roll", kind: "count" },
        { key: "grNo", label: "G.R. No.", kind: "mono" },
        { key: "student", label: "Student", kind: "text" },
        { key: "last", label: "Last exam %", kind: "percent" },
        ...tests.map((e) => ({ key: e.id, label: e.name.replace(/^Monthly Test – /, ""), kind: "percent" as const })),
        { key: "average", label: "Average", kind: "percent" },
      ];
      const rows = [...roster.values()]
        .sort((a, b) => a.rollNo - b.rollNo)
        .map((p) => {
          const row: Row = { roll: p.rollNo, grNo: p.id, student: p.name };
          const last = finals.map((m) => m.get(p.id)).find((r) => r && r.percent !== null && !r.withheld);
          row.last = last?.percent ?? null;
          const got: number[] = [];
          tests.forEach((e, i) => {
            const r = testRows[i]!.get(p.id);
            const v = r && r.percent !== null && !r.withheld ? r.percent : null;
            row[e.id] = v;
            if (v !== null) got.push(v);
          });
          // Average of the tests the student has (a missing test is left out, not counted as 0).
          row.average = got.length ? Math.round((got.reduce((a, v) => a + v, 0) / got.length) * 10) / 10 : null;
          return row;
        });
      return {
        rows,
        columns,
        subtitle: [`${rows.length} students`, `${tests.length} ${tests.length === 1 ? "test" : "tests"}`],
        notes: tests.length ? [`Tests: ${tests.map(examLine).join(", ")}. The average is over the tests each student has.`] : [`${cs} has no class tests in ${formatSession(session)} yet.`],
      };
    },

    "exam-subject-tests": ({ campuses, session, f }) => {
      const campus = campuses[0]!;
      const cs = f.classSection ?? "";
      if (!registerSections(campus).includes(cs)) return raise(`There is no class ${cs} at ${campusName(campus)}.`, "classSection");
      const [from = "", to = ""] = (f.range ?? "").split("|");
      const subject = f.subject ?? "";
      const tests = schoolExams(campus, session)
        .filter((e) => e.category === "TEST" && e.classes.includes(cs) && (!f.examType || e.typeId === f.examType))
        .filter((e) => e.subjects.some((s) => s.id === subject && (s.date ?? e.startDate) >= from && (s.date ?? e.startDate) <= to))
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
      const subjectName = tests.flatMap((e) => e.subjects).find((s) => s.id === subject)?.name ?? subject;
      const per = new Map<string, { r: ExamsResultRow; tests: number; absent: number; obtained: number; max: number }>();
      for (const e of tests) {
        const paper = e.subjects.find((s) => s.id === subject)!;
        for (const r of examRows(e).filter((x) => x.classSection === cs && subject in x.marks)) {
          const m = r.marks[subject] ?? null;
          if (m === null) continue;
          const acc = per.get(r.id) ?? { r, tests: 0, absent: 0, obtained: 0, max: 0 };
          acc.tests++;
          acc.max += paper.maxMarks;
          // Absent and leave count as 0 and as absent.
          if (typeof m === "number") acc.obtained += m;
          else acc.absent++;
          per.set(r.id, acc);
        }
      }
      const rows = [...per.values()]
        .sort((a, b) => a.r.rollNo - b.r.rollNo)
        .map((x) => ({ grNo: x.r.id, student: x.r.name, group: examsGroupShort(x.r.group), tests: x.tests, absent: x.absent, average: Math.round((x.obtained / x.tests) * 10) / 10, obtained: x.obtained, max: x.max, percent: x.max ? Math.round((x.obtained / x.max) * 1000) / 10 : null }));
      return {
        rows,
        subtitle: [subjectName, `${tests.length} ${tests.length === 1 ? "test" : "tests"}`],
        notes: tests.length
          ? [`Tests: ${tests.map((e) => `${e.name} on ${formatDate(e.subjects.find((s) => s.id === subject)?.date ?? e.startDate)}${e.status === "DECLARED" ? "" : " (provisional)"}`).join(", ")}. Absent and leave count as 0.`]
          : [`No class test of ${subjectName} for ${cs} in these dates. Widen the dates or choose every test type.`],
      };
    },
  };
}
