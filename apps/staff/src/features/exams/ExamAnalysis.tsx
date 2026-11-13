import { examsAnalyse, examsOfGender, EXAMS_DEFAULT_PASS_RULES, type ExamsGender, type ExamsSectionStat, type ExamsSubjectStat } from "@mtb/api";
import { formatCount, formatPercent } from "@mtb/domain";
import { AnimatedNumber, buttonClassName, DataTable, DeviationChart, EmptyState, Panel, Segmented, StatCard } from "@mtb/ui";
import { Link } from "@tanstack/react-router";
import { useState, type CSSProperties } from "react";
import { ordinal, ResultBadge, useExam } from "./shared";

/** A % that may have no base yet (nobody has a mark): "—", never 0. */
const pct = (v: number | null) => (v === null ? "—" : formatPercent(v));
const orDash = (v: number | null) => (v === null ? "—" : v);

/** Subject-wise analysis: averages and pass rates, grade spread, top ten, subject teachers, and who needs a re-sit. */
export function ExamAnalysis() {
  const exam = useExam();
  const [section, setSection] = useState("ALL");
  const [view, setView] = useState("chart");
  const [genderPick, setGender] = useState("");
  const hasGender = exam.rows.some((r) => r.gender);
  const gender: ExamsGender | undefined = hasGender && (genderPick === "M" || genderPick === "F") ? genderPick : undefined;
  const a = examsAnalyse(exam, section, { gender });
  const rules = exam.passRules ?? EXAMS_DEFAULT_PASS_RULES;
  const needs = exam.rows
    .filter((r) => (section === "ALL" || r.classSection === section) && examsOfGender(gender)(r) && (r.result === "FAIL" || r.result === "SUPPLY"))
    .sort((x, y) => (x.result === y.result ? (x.percent ?? 0) - (y.percent ?? 0) : x.result === "FAIL" ? -1 : 1));
  const maxGrade = Math.max(1, ...a.grades.map((g) => g.count));
  // Subjects nobody has a mark in yet have no average to chart.
  const charted = a.subjects.filter((s) => s.averagePercent !== null);
  const subjectName = (id: string) => exam.subjects.find((s) => s.id === id)?.name ?? id;
  const printLink = (doc: string) => (
    <Link to="/exams/$examId/print" params={{ examId: exam.id }} search={{ doc, ...(section !== "ALL" ? { section } : {}), ...(gender ? { gender } : {}) } as never} className={buttonClassName({ size: "sm", variant: "ghost" })}>
      Print
    </Link>
  );

  const filters = (exam.classes.length > 1 || hasGender) && (
    <div className="flex flex-wrap items-center gap-3">
      {exam.classes.length > 1 && <Segmented aria-label="Section" value={section} onChange={setSection} options={[{ value: "ALL", label: "Whole class" }, ...exam.classes.map((c) => ({ value: c, label: c }))]} />}
      {hasGender && (
        <Segmented
          aria-label="Boys or girls"
          value={gender ?? ""}
          onChange={setGender}
          options={[
            { value: "", label: "Boys and girls" },
            { value: "M", label: "Boys" },
            { value: "F", label: "Girls" },
          ]}
        />
      )}
    </div>
  );

  if (a.complete === 0) {
    return (
      <>
        {filters}
        <div className="mtb-card">
          <EmptyState icon="trendUp" title="Nothing to analyse yet" description={gender ? "No complete result for these students yet. Try boys and girls together." : "The analysis appears once at least one student has every mark entered."} />
        </div>
      </>
    );
  }

  return (
    <>
      {filters}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Average" icon="trendUp" tone="info" value={a.averagePercent === null ? "—" : <AnimatedNumber value={a.averagePercent} format={(v) => formatPercent(v)} />} foot={`${formatCount(a.complete)} complete results`} />
        <StatCard label="Pass rate" icon="checkCircle" value={a.passRate === null ? "—" : <AnimatedNumber value={a.passRate} format={(v) => formatPercent(v)} />} meter={Math.round(a.passRate ?? 0)} meterLabel={a.passRate === null ? "No results yet" : `${formatPercent(a.passRate)} passed`} foot={`${formatCount(a.counts.PASS)} passed every subject`} />
        <StatCard label="Re-sit" icon="refresh" tone={a.counts.SUPPLY ? "warning" : "neutral"} value={<AnimatedNumber value={a.counts.SUPPLY} format={formatCount} />} foot={`Failed ${rules.supplyMaxSubjects} subjects or fewer`} />
        <StatCard label="Failed" icon="alert" tone={a.counts.FAIL ? "danger" : "neutral"} value={<AnimatedNumber value={a.counts.FAIL} format={formatCount} />} foot={a.counts.WITHHELD ? `${a.counts.WITHHELD} withheld` : "Below the pass rules"} />
      </div>

      <Panel
        id="analysis-subjects"
        title="Subjects"
        description={`Each subject's average against the whole ${section === "ALL" ? "class" : "section"} at ${pct(a.averagePercent)}. Lowest: ${[...charted].sort((x, y) => (x.averagePercent ?? 0) - (y.averagePercent ?? 0))[0]?.name ?? "—"}.`}
        rise={0}
        actions={
          <>
            <Segmented aria-label="Show subjects as" value={view} onChange={setView} options={[{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }]} />
            {printLink("subjects")}
          </>
        }
      >
        {view === "chart" ? (
          <DeviationChart<ExamsSubjectStat>
            data={charted}
            value={(s) => s.averagePercent ?? 0}
            axisLabel={(s) => s.name.split(" ")[0]!}
            reference={a.averagePercent ?? 0}
            referenceLabel="Average of all subjects"
            format={(v) => formatPercent(v)}
            formatAxis={(v) => `${v}%`}
            tooltip={(s) => (
              <>
                <div className="mtb-chart-tip-title">{s.name}</div>
                <div className="mtb-chart-tip-value">{pct(s.averagePercent)}</div>
                <div className="mtb-chart-tip-row">
                  <span>Pass rate</span>
                  <span>{pct(s.passRate)}</span>
                </div>
                <div className="mtb-chart-tip-row">
                  <span>Highest</span>
                  <span>
                    {orDash(s.highest)} of {s.maxMarks}
                  </span>
                </div>
              </>
            )}
            describe={(s) => `${s.name}: average ${pct(s.averagePercent)}, pass rate ${pct(s.passRate)}`}
            label={`Subject averages compared with ${formatPercent(a.averagePercent ?? 0)}`}
          />
        ) : (
          <DataTable
            caption="Subject results"
            rows={a.subjects}
            rowKey="subjectId"
            density="dense"
            columns={[
              { key: "name", header: "Subject", render: (s) => <span className="mtb-cell-primary">{s.name}</span> },
              ...(section !== "ALL" ? [{ key: "teacher", header: "Teacher", render: (s: ExamsSubjectStat) => s.teacher ?? "—" }] : []),
              { key: "avg", header: "Average", align: "right", render: (s) => (s.average === null ? "—" : `${s.average} / ${s.maxMarks}`) },
              { key: "pct", header: "Average %", align: "right", render: (s) => pct(s.averagePercent) },
              { key: "pass", header: "Pass rate", align: "right", render: (s) => <span className={s.passRate !== null && s.passRate < 70 ? "font-semibold text-danger-ink" : undefined}>{pct(s.passRate)}</span> },
              { key: "hi", header: "Highest", align: "right", render: (s) => orDash(s.highest) },
              { key: "lo", header: "Lowest", align: "right", render: (s) => orDash(s.lowest) },
              { key: "abs", header: "Absent", align: "right", render: (s) => s.absent },
              { key: "failed", header: "Failures", align: "right", render: (s) => <span className={s.failed > 0 ? "font-semibold text-danger-ink" : undefined}>{s.failed}</span> },
              { key: "top", header: "Top mark", render: (s) => (s.top ? `${s.top.name} (${s.top.classSection})` : "—") },
            ]}
          />
        )}
      </Panel>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel id="analysis-grades" title="Grade spread" description="How many students got each grade." rise={1}>
          <ul className="exams-bars" aria-label="Students by grade">
            {a.grades.map((g, i) => (
              <li key={g.grade} className="mtb-slide-in" style={{ "--i": i } as CSSProperties}>
                <span className="font-semibold">{g.grade}</span>
                <span className="exams-bar" aria-hidden="true">
                  <span className={g.grade === "F" ? "is-fail" : undefined} style={{ width: `${(g.count / maxGrade) * 100}%` }} />
                </span>
                <span className="text-right tabular-nums">
                  {g.count} <span className="text-ink-muted">· {a.complete ? Math.round((g.count / a.complete) * 100) : 0}%</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel id="analysis-top" title="Top ten" description={`Highest percentages ${section === "ALL" ? "in the class" : `in ${section}`}. Equal percentages share a position.`} rise={2} actions={printLink("positions")}>
          <ol className="m-0 grid list-none gap-1.5 p-0">
            {a.top.map((r, i) => (
              <li key={r.id} className="mtb-slide-in flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-surface-hover" style={{ "--i": i } as CSSProperties}>
                <span className="grid size-8 place-content-center rounded-full bg-brand-tint text-small font-semibold text-brand-ink">{section === "ALL" ? r.classPosition : r.position}</span>
                <span className="grid min-w-0 flex-1">
                  <span className="truncate font-medium">{r.name}</span>
                  <span className="text-small text-ink-muted">
                    {r.classSection} · {r.id}
                  </span>
                </span>
                <span className="text-right">
                  <span className="mtb-num font-semibold">{pct(r.percent)}</span>
                  <span className="block text-small text-ink-muted">Grade {r.grade}</span>
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      <Panel id="analysis-teachers" title="Subject teachers" description="Average and pass rate of each section's paper, with the teacher who taught it — the old teacher performance reports." rise={3} flush actions={printLink("teachers")}>
        <DataTable<ExamsSectionStat & { id: string }>
          caption="Results by subject teacher"
          rows={a.sections.map((s) => ({ ...s, id: `${s.classSection}-${s.subjectId}` }))}
          density="dense"
          maxHeight={420}
          columns={[
            { key: "subject", header: "Subject", render: (s) => <span className="mtb-cell-primary">{s.subjectName}</span> },
            { key: "cs", header: "Section", width: 90, render: (s) => s.classSection },
            { key: "teacher", header: "Teacher", render: (s) => s.teacher ?? "—" },
            { key: "avg", header: "Average", align: "right", width: 110, render: (s) => pct(s.averagePercent) },
            { key: "pass", header: "Pass rate", align: "right", width: 110, render: (s) => <span className={s.passRate !== null && s.passRate < 70 ? "font-semibold text-danger-ink" : undefined}>{pct(s.passRate)}</span> },
          ]}
        />
      </Panel>

      <Panel id="analysis-needs" title="Re-sit and failed" description={`Students below the pass rules (${rules.subjectPassPercent}% a subject, ${rules.overallPassPercent}% overall) — the old failed-students and supply-holder lists.`} rise={4} flush actions={printLink("failed")}>
        {needs.length === 0 ? (
          <EmptyState icon="checkCircle" title="Everyone passed" description="No student is below the pass rules." />
        ) : (
          <DataTable
            caption="Students to re-sit or failed"
            rows={needs}
            density="dense"
            maxHeight={420}
            columns={[
              { key: "name", header: "Student", render: (r) => <span className="grid"><span className="mtb-cell-primary">{r.name}</span><span className="mtb-cell-secondary">{r.classSection} · <span className="mtb-mono">{r.id}</span></span></span> },
              { key: "pct", header: "%", align: "right", width: 80, render: (r) => pct(r.percent) },
              { key: "pos", header: "Position", align: "right", width: 90, render: (r) => (r.position ? ordinal(r.position) : "—") },
              { key: "subjects", header: "Subjects below the pass mark", render: (r) => (r.failedSubjects ?? []).map(subjectName).join(", ") },
              { key: "result", header: "Result", width: 100, render: (r) => <ResultBadge result={r.result} /> },
            ]}
          />
        )}
      </Panel>
    </>
  );
}
