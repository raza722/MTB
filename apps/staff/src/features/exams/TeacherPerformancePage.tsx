import { EXAMS_LEVEL_LABEL, examsQueries, type CampusCode, type ExamsClassLevel, type ExamsGender, type ExamsTeacherPerfQuery, type ExamsTeacherPerfRow } from "@mtb/api";
import { formatPercent, formatSession } from "@mtb/domain";
import { Banner, Button, DataTable, EmptyState, Panel, Segmented, Select, Skeleton } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { campusLabel } from "../../app/shell/campus";
import { Page, PageHeader } from "../../app/shell/page";
import { useCtx } from "../../app/session";
import { DocHead, PRINTED_ON } from "./print/docs";
import { PrintSheet, printNow } from "./print/PrintSheet";
import { ExamsNav, LoadError } from "./shared";

type View = "teacher" | "department" | "detail";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1] ?? ""} ${m.slice(0, 4)}`;
const LEVELS: ExamsClassLevel[] = ["PRIMARY", "MIDDLE", "SECONDARY"];
const sortCs = (a: string, b: string) => {
  const n = (s: string) => (s.startsWith("Prep") ? 0 : Number(s.split("-")[0]) || 0);
  return n(a) - n(b) || a.localeCompare(b);
};

/** Pass % and average of several papers, weighted by the students who sat each. */
function combine(list: ExamsTeacherPerfRow[]) {
  const sat = list.reduce((a, r) => a + r.sat, 0);
  if (!sat) return { average: null, pass: null };
  return { average: Math.round((list.reduce((a, r) => a + r.averagePercent * r.sat, 0) / sat) * 10) / 10, pass: Math.round((list.reduce((a, r) => a + r.passRate * r.sat, 0) / sat) * 10) / 10 };
}
const pctText = (n: number | null) => (n === null ? "" : formatPercent(n));

/**
 * Teacher performance across exams, classes and departments: the old Teacher/Lecturer academic report (one teacher's
 * sections), the department-wise report (a subject's teachers × exams) and the class-level report (failed students).
 */
export function TeacherPerformancePage() {
  const ctx = useCtx();
  const [view, setView] = useState<View>("teacher");
  const [q, setQ] = useState<ExamsTeacherPerfQuery>({});
  const [printing, setPrinting] = useState(false);
  // Filter lists come from the unfiltered call; the rows from the filtered one.
  const lists = useQuery(examsQueries.teacherPerformance(ctx, {}));
  const data = useQuery(examsQueries.teacherPerformance(ctx, q));
  const set = (patch: Partial<ExamsTeacherPerfQuery>) => setQ((x) => {
    const next = { ...x, ...patch };
    for (const k of Object.keys(next) as Array<keyof ExamsTeacherPerfQuery>) if (!next[k]) delete next[k];
    return next;
  });
  const opts = lists.data;
  const rows = data.data?.rows ?? [];
  // One-teacher view needs a teacher, department view a subject: default to the first one with papers.
  const teacher = q.teacher ?? rows[0]?.teacher ?? opts?.teachers[0];
  const subject = q.subject ?? rows[0]?.subjectId ?? opts?.subjects[0]?.id;
  const subjectName = opts?.subjects.find((s) => s.id === subject)?.name ?? "";
  const campus: CampusCode = ctx.campus === "ALL" ? "KC" : ctx.campus;
  const filterText = [
    q.level ? EXAMS_LEVEL_LABEL[q.level] : "",
    q.examTypeId ? (opts?.examTypes.find((t) => t.id === q.examTypeId)?.name ?? "") : "",
    q.month ? monthLabel(q.month) : "",
    q.gender === "M" ? "Boys" : q.gender === "F" ? "Girls" : "",
    `Session ${formatSession(ctx.session)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const teacherRows = rows.filter((r) => r.teacher === teacher);
  const deptRows = rows.filter((r) => r.subjectId === subject);

  return (
    <Page>
      <PageHeader title="Teacher performance" />
      <ExamsNav />
      {lists.isError && <LoadError what="Teacher results" error={lists.error} onRetry={() => void lists.refetch()} />}
      <Panel id="perf-filters" title="Filters" description={`Every exam of ${campusLabel(ctx.campus)} in ${formatSession(ctx.session)} with marks entered. Drafts count as provisional.`} rise={0}>
        {lists.isLoading ? (
          <Skeleton height={80} />
        ) : !opts || opts.teachers.length === 0 ? (
          <EmptyState icon="user" title="No papers with marks yet" description="Teacher results appear once marks are entered in an exam." />
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              <Select label="Teacher" value={q.teacher ?? ""} onChange={(e) => set({ teacher: e.target.value })} options={[{ value: "", label: "Every teacher" }, ...opts.teachers.map((t) => ({ value: t, label: t }))]} />
              <Select label="Subject (department)" value={q.subject ?? ""} onChange={(e) => set({ subject: e.target.value })} options={[{ value: "", label: "Every subject" }, ...opts.subjects.map((s) => ({ value: s.id, label: s.name }))]} />
              <Select label="Class level" value={q.level ?? ""} onChange={(e) => set({ level: (LEVELS.find((l) => l === e.target.value) ?? "") as ExamsClassLevel })} options={[{ value: "", label: "Every level" }, ...LEVELS.map((l) => ({ value: l, label: EXAMS_LEVEL_LABEL[l] }))]} />
              <Select label="Exam type" value={q.examTypeId ?? ""} onChange={(e) => set({ examTypeId: e.target.value })} options={[{ value: "", label: "Every exam type" }, ...opts.examTypes.map((t) => ({ value: t.id, label: t.name }))]} />
              <Select label="Month" value={q.month ?? ""} onChange={(e) => set({ month: e.target.value })} options={[{ value: "", label: "Every month" }, ...opts.months.map((m) => ({ value: m, label: monthLabel(m) }))]} />
              <Select
                label="Boys or girls"
                value={q.gender ?? ""}
                onChange={(e) => set({ gender: (e.target.value === "M" || e.target.value === "F" ? e.target.value : "") as ExamsGender })}
                options={[
                  { value: "", label: "Boys and girls" },
                  { value: "M", label: "Boys" },
                  { value: "F", label: "Girls" },
                ]}
              />
            </div>
          </div>
        )}
      </Panel>

      {opts && opts.teachers.length > 0 && (
        <Panel
          id="perf-result"
          title={view === "teacher" ? `Teacher: ${teacher ?? "—"}` : view === "department" ? `Department: ${subjectName || "—"}` : "Detail by teacher, class, exam and section"}
          description={
            view === "teacher"
              ? "Average and pass % of each class-section the teacher taught. Choose an exam type and month for one exam."
              : view === "department"
                ? "Pass % of each teacher's sections in every exam of the session, with the average of each exam."
                : "Pass %, absences, failures and the names of failed students for each paper."
          }
          rise={1}
          actions={
            <>
              <Segmented
                aria-label="Report"
                value={view}
                onChange={(v) => setView(v === "department" ? "department" : v === "detail" ? "detail" : "teacher")}
                options={[
                  { value: "teacher", label: "One teacher" },
                  { value: "department", label: "Department" },
                  { value: "detail", label: "Detail" },
                ]}
              />
              <Button size="sm" icon="printer" onClick={() => setPrinting((p) => !p)} disabled={rows.length === 0}>
                {printing ? "Hide print" : "Print"}
              </Button>
            </>
          }
        >
          {data.isLoading ? (
            <Skeleton height={200} />
          ) : data.isError ? (
            <LoadError what="Teacher results" error={data.error} onRetry={() => void data.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState icon="filter" title="Nothing in these filters" description="Widen the filters: every exam type, month or level." />
          ) : view === "teacher" ? (
            <TeacherTables rows={teacherRows} />
          ) : view === "department" ? (
            <DepartmentTables rows={deptRows} />
          ) : (
            <DetailTable rows={rows} />
          )}
        </Panel>
      )}

      {printing && rows.length > 0 && (
        <div className="grid gap-3">
          <div>
            <Button variant="primary" icon="printer" onClick={printNow}>
              Print report
            </Button>
          </div>
          <PrintSheet paper={view === "detail" ? "A4L" : "A4"} label="Teacher performance preview">
            <article className={view === "detail" ? "exams-doc exams-doc-land" : "exams-doc exams-doc-a4"} aria-label="Teacher performance report">
              <DocHead
                campus={campus}
                title={view === "teacher" ? "Teacher / lecturer academic report" : view === "department" ? "Teachers' performance (department-wise)" : "Teachers' performance (class level / subject)"}
                sub={[view === "teacher" ? teacher : view === "department" ? subjectName : q.teacher ?? "", filterText].filter(Boolean).join(" · ")}
              />
              {view === "teacher" ? <TeacherTables rows={teacherRows} print /> : view === "department" ? <DepartmentTables rows={deptRows} print /> : <DetailTable rows={rows} print />}
              <p className="exams-doc-key">Pass % is the share of students with a mark (absent included) at or above the pass mark. Printed {PRINTED_ON}.</p>
              <div className="exams-doc-signs">
                <div>Head of department</div>
                <div>Controller of examinations</div>
                <div>Principal</div>
              </div>
            </article>
          </PrintSheet>
        </div>
      )}
    </Page>
  );
}

/** #34: one teacher, per subject: class-sections as columns, Average and Pass % rows. */
function TeacherTables({ rows, print }: { rows: ExamsTeacherPerfRow[]; print?: boolean }) {
  if (!rows.length) return <EmptyState icon="user" title="No papers for this teacher" description="Choose another teacher or widen the filters." />;
  const subjects = [...new Set(rows.map((r) => r.subjectName))].sort();
  const exams = [...new Set(rows.map((r) => r.examName))];
  return (
    <div className={print ? "" : "grid gap-4 p-4"} style={print ? { display: "grid", gap: "4mm" } : undefined}>
      {exams.length > 1 && <p className={print ? "m-0" : "m-0 text-small text-ink-muted"}>Over {exams.length} exams: {exams.join(", ")}. Choose an exam type and month to see one exam.</p>}
      {subjects.map((sn) => {
        const list = rows.filter((r) => r.subjectName === sn);
        const sections = [...new Set(list.map((r) => r.classSection))].sort(sortCs);
        return (
          <div key={sn} className={print ? "" : "mtb-table-wrap overflow-x-auto"}>
            <table className={print ? undefined : "mtb-table mtb-table-dense"} style={print ? undefined : { width: "100%" }}>
              <caption style={{ textAlign: "left", fontWeight: 600, padding: "4px 0" }}>Subject: {sn}</caption>
              <thead>
                <tr>
                  <th />
                  {sections.map((cs) => (
                    <th key={cs} className="c" style={{ textAlign: "center" }}>
                      {cs}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>Average</th>
                  {sections.map((cs) => (
                    <td key={cs} className="c" style={{ textAlign: "center" }}>
                      {pctText(combine(list.filter((r) => r.classSection === cs)).average)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th>Pass %age</th>
                  {sections.map((cs) => (
                    <td key={cs} className="c" style={{ textAlign: "center" }}>
                      {pctText(combine(list.filter((r) => r.classSection === cs)).pass)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

/** #35: a subject's teachers: rows = their class-sections, columns = the session's exams (pass %), plus an Average row. */
function DepartmentTables({ rows, print }: { rows: ExamsTeacherPerfRow[]; print?: boolean }) {
  if (!rows.length) return <EmptyState icon="book" title="No papers in this subject" description="Choose another subject or widen the filters." />;
  const teachers = [...new Set(rows.map((r) => r.teacher))].sort((a, b) => a.localeCompare(b));
  const exams = [...new Map(rows.map((r) => [r.examId, { id: r.examId, name: r.examName, date: r.startDate }])).values()].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div className={print ? "" : "grid gap-4 p-4"} style={print ? { display: "grid", gap: "4mm" } : undefined}>
      {teachers.map((t) => {
        const list = rows.filter((r) => r.teacher === t);
        const sections = [...new Set(list.map((r) => r.classSection))].sort(sortCs);
        const mine = exams.filter((e) => list.some((r) => r.examId === e.id));
        return (
          <div key={t} className={print ? "" : "mtb-table-wrap overflow-x-auto"} style={{ breakInside: "avoid" }}>
            <table className={print ? undefined : "mtb-table mtb-table-dense"} style={print ? undefined : { width: "100%" }}>
              <caption style={{ textAlign: "left", fontWeight: 600, padding: "4px 0" }}>Teacher: {t}</caption>
              <thead>
                <tr>
                  <th>Class</th>
                  {mine.map((e) => (
                    <th key={e.id} className="c" style={{ textAlign: "center" }}>
                      {e.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sections.map((cs) => (
                  <tr key={cs}>
                    <th>{cs}</th>
                    {mine.map((e) => {
                      const hit = list.filter((r) => r.classSection === cs && r.examId === e.id);
                      return (
                        <td key={e.id} className="c" style={{ textAlign: "center" }}>
                          {pctText(combine(hit).pass)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <th>Average</th>
                  {mine.map((e) => (
                    <th key={e.id} className="c" style={{ textAlign: "center" }}>
                      {pctText(combine(list.filter((r) => r.examId === e.id)).pass)}
                    </th>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

/** #36: per teacher, class, exam and section: pass %, absents, failed and the failed students' names. */
function DetailTable({ rows, print }: { rows: ExamsTeacherPerfRow[]; print?: boolean }) {
  const sorted = [...rows].sort((a, b) => a.teacher.localeCompare(b.teacher) || a.subjectName.localeCompare(b.subjectName) || sortCs(a.classSection, b.classSection) || a.startDate.localeCompare(b.startDate));
  if (print) {
    const teachers = [...new Set(sorted.map((r) => r.teacher))];
    return (
      <table style={{ fontSize: "8pt" }}>
        <thead>
          <tr>
            <th>Subject</th>
            <th>Class</th>
            <th>Exam</th>
            <th>Section</th>
            <th className="n">Pass %age</th>
            <th className="n">Absents</th>
            <th className="n">Failed</th>
            <th>Failed students' names</th>
          </tr>
        </thead>
        <tbody>
          {teachers.flatMap((t) => [
            <tr key={`h-${t}`}>
              <th colSpan={8}>Teacher: {t}</th>
            </tr>,
            ...sorted
              .filter((r) => r.teacher === t)
              .map((r) => (
                <tr key={`${r.examId}-${r.classSection}-${r.subjectId}`}>
                  <td>{r.subjectName}</td>
                  <td>{r.classSection.split("-")[0]}</td>
                  <td>{r.examName}</td>
                  <td>{r.classSection}</td>
                  <td className="n">{formatPercent(r.passRate)}</td>
                  <td className="n">{r.absent}</td>
                  <td className="n">{r.failed}</td>
                  <td>{r.failedNames.join(", ")}</td>
                </tr>
              )),
          ])}
        </tbody>
      </table>
    );
  }
  return (
    <>
      {sorted.length > 400 && <Banner tone="info">Showing the first 400 papers. Choose a teacher or subject to narrow the list.</Banner>}
      <DataTable<ExamsTeacherPerfRow & { id: string }>
        caption="Teacher performance detail"
        rows={sorted.slice(0, 400).map((r) => ({ ...r, id: `${r.examId}-${r.classSection}-${r.subjectId}` }))}
        density="dense"
        maxHeight={560}
        columns={[
          { key: "teacher", header: "Teacher", width: 170, render: (r) => <span className="mtb-cell-primary">{r.teacher}</span> },
          { key: "subject", header: "Subject", width: 130, render: (r) => r.subjectName },
          { key: "exam", header: "Exam", render: (r) => <span className="grid"><span>{r.examName}</span><span className="mtb-cell-secondary">{r.examType}{r.status === "DRAFT" ? " · provisional" : ""}</span></span> },
          { key: "cs", header: "Section", width: 80, render: (r) => r.classSection },
          { key: "pass", header: "Pass %", align: "right", width: 90, render: (r) => <span className={r.passRate < 70 ? "font-semibold text-danger-ink" : undefined}>{formatPercent(r.passRate)}</span> },
          { key: "abs", header: "Absents", align: "right", width: 80, render: (r) => r.absent },
          { key: "failed", header: "Failed", align: "right", width: 70, render: (r) => r.failed },
          { key: "names", header: "Failed students", render: (r) => (r.failedNames.length ? <span className="text-small">{r.failedNames.join(", ")}</span> : <span className="text-ink-muted">—</span>) },
        ]}
      />
    </>
  );
}
