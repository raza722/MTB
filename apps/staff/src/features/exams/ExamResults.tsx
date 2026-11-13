import { examsApi, examsPassMark, examsQueries, examsSits, EXAMS_DEFAULT_PASS_RULES, EXAMS_RESULT_LABEL, type ExamDetail, type ExamsMark, type ExamsResultRow } from "@mtb/api";
import { formatPercent } from "@mtb/domain";
import { AnimatedNumber, Banner, Button, buttonClassName, DataTable, EmptyState, Input, KeyValue, Segmented, Select, SidePanel, StatCard, StatusBadge, Textarea, useToast, type Column } from "@mtb/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { useReadOnly } from "../../app/session";
import { errorText, markText, ordinal, ResultBadge, useCanOnExam, useExam } from "./shared";

type SortKey = "position" | "name" | "roll";

function MarkCell({ mark, pass }: { mark: ExamsMark; pass: number }) {
  if (mark === null) return <span className="inline-flex rounded-sm bg-warning-tint px-1.5 text-small font-medium text-warning-ink">Missing</span>;
  if (mark === "A")
    return (
      <StatusBadge status="absent" dot={false}>
        Absent
      </StatusBadge>
    );
  if (mark === "L")
    return (
      <StatusBadge status="leave" dot={false}>
        Leave
      </StatusBadge>
    );
  return <span className={mark < pass ? "mtb-num font-semibold text-danger-ink" : "mtb-num"}>{mark}</span>;
}

/** The results grid: totals, %, grade, positions (section and class) and pass / re-sit / fail. */
export function ExamResults() {
  const exam = useExam();
  const [section, setSection] = useState("ALL");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("position");
  const [open, setOpen] = useState<ExamsResultRow | null>(null);
  const rules = exam.passRules ?? EXAMS_DEFAULT_PASS_RULES;
  const declared = exam.status === "DECLARED";
  const candidate = exam.candidateLabel ?? "Student";
  const sections = exam.classes;
  const grouped = Boolean(exam.groups?.length);

  const scoped = exam.rows.filter((r) => section === "ALL" || r.classSection === section);
  const complete = scoped.filter((r) => r.percent !== null && !r.withheld);
  const average = complete.length ? Math.round((complete.reduce((a, r) => a + (r.percent ?? 0), 0) / complete.length) * 10) / 10 : null;
  const passed = complete.filter((r) => r.result === "PASS").length;
  const supply = complete.filter((r) => r.result === "SUPPLY").length;
  const failed = complete.filter((r) => r.result === "FAIL").length;
  const top = [...complete].sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0))[0];

  const q = query.trim().toLowerCase();
  const visible = scoped
    .filter((r) => !q || `${r.name} ${r.id}`.toLowerCase().includes(q))
    .sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "roll") return a.classSection.localeCompare(b.classSection) || a.rollNo - b.rollNo;
      const pa = section === "ALL" ? a.classPosition : a.position;
      const pb = section === "ALL" ? b.classPosition : b.position;
      return (pa ?? 999) - (pb ?? 999) || a.classSection.localeCompare(b.classSection) || a.name.localeCompare(b.name);
    });

  const columns: Array<Column<ExamsResultRow>> = [
    { key: "rollNo", header: "Roll", align: "right", width: 60, render: (r) => <span className="mtb-num">{r.rollNo}</span> },
    {
      key: "name",
      header: candidate,
      width: 210,
      render: (r) => (
        <span className="grid">
          <span className="mtb-cell-primary">{r.name}</span>
          <span className="mtb-cell-secondary">
            <span className="mtb-mono">{r.id}</span>
            {sections.length > 1 && section === "ALL" ? ` · ${r.classSection}` : ""}
          </span>
        </span>
      ),
    },
    ...(grouped ? [{ key: "group", header: "Group", width: 130, render: (r: ExamsResultRow) => <span className="text-small">{r.group ?? "—"}</span> } as Column<ExamsResultRow>] : []),
    ...exam.subjects.map<Column<ExamsResultRow>>((s) => ({
      key: `s-${s.id}`,
      header: (
        <span title={`${s.name}, out of ${s.maxMarks}; pass mark ${examsPassMark(s.maxMarks, rules)}`}>
          {s.name} <span className="normal-case">/{s.maxMarks}</span>
        </span>
      ),
      align: "right",
      width: 100,
      // A paper outside the student's group: not taken (not missing, not failed).
      render: (r) =>
        examsSits(s, r.group) ? (
          <MarkCell mark={r.marks[s.id] ?? null} pass={examsPassMark(s.maxMarks, rules)} />
        ) : (
          <span className="text-ink-muted" title={`${r.group ?? "This group"} doesn't take ${s.name}`}>
            —
          </span>
        ),
    })),
    {
      key: "total",
      header: grouped ? "Total" : `Total /${exam.totalMax}`,
      align: "right",
      width: 96,
      render: (r) => (
        <span className="mtb-num font-medium">
          {r.obtained}
          {grouped ? <span className="font-normal text-ink-muted">/{r.max}</span> : null}
        </span>
      ),
    },
    { key: "percent", header: "%", align: "right", width: 76, render: (r) => (r.percent === null ? <span className="text-ink-muted">—</span> : <span className="mtb-num">{formatPercent(r.percent)}</span>) },
    { key: "grade", header: "Grade", width: 70, render: (r) => (r.grade === null || r.withheld ? <span className="text-ink-muted">—</span> : <span className={r.grade === "F" ? "font-semibold text-danger-ink" : "font-semibold"}>{r.grade}</span>) },
    { key: "position", header: "Section pos.", align: "right", width: 96, render: (r) => (r.position == null ? <span className="text-ink-muted">—</span> : <span className="mtb-num">{r.position}</span>) },
    { key: "classPosition", header: "Class pos.", align: "right", width: 88, render: (r) => (r.classPosition == null ? <span className="text-ink-muted">—</span> : <span className="mtb-num">{r.classPosition}</span>) },
    { key: "result", header: "Result", width: 110, render: (r) => <ResultBadge result={r.result} /> },
  ];

  const footer: Record<string, string> = { name: `Average of ${visible.length}` };
  for (const s of exam.subjects) {
    const vals = visible.map((r) => r.marks[s.id]).filter((m): m is number => typeof m === "number");
    footer[`s-${s.id}`] = vals.length ? (Math.round((vals.reduce((a, v) => a + v, 0) / vals.length) * 10) / 10).toFixed(1) : "—";
  }
  const vc = visible.filter((r) => r.percent !== null);
  footer.percent = vc.length ? formatPercent(vc.reduce((a, r) => a + (r.percent ?? 0), 0) / vc.length) : "—";

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Average" icon="trendUp" tone="info" value={average === null ? "—" : <AnimatedNumber value={average} format={(v) => formatPercent(v)} />} foot={`${complete.length} complete results`} />
        <StatCard label="Passed" icon="checkCircle" value={<AnimatedNumber value={passed} format={String} />} meter={complete.length ? Math.round((passed / complete.length) * 100) : 0} meterLabel={`${passed} of ${complete.length} passed`} foot={complete.length ? `${formatPercent((passed / complete.length) * 100)} pass rate` : "No complete results yet"} />
        <StatCard label="Re-sit or fail" icon="alert" tone={failed + supply > 0 ? "danger" : "neutral"} value={<AnimatedNumber value={failed + supply} format={String} />} foot={`${supply} re-sit (${rules.supplyMaxSubjects} subjects or fewer) · ${failed} failed`} />
        <StatCard label="Highest" icon="award" value={top?.percent != null ? formatPercent(top.percent) : "—"} foot={top ? `${top.name} · ${top.classSection}` : undefined} />
      </div>

      <DataTable
        caption={`${exam.name} results`}
        columns={columns}
        rows={visible}
        density="dense"
        maxHeight={600}
        footer={footer}
        onRowClick={(r) => setOpen(r)}
        rowClassName={(r) => (r.missing > 0 ? "[&>td]:bg-warning-tint" : r.withheld ? "[&>td]:bg-surface-sunken" : undefined)}
        toolbar={
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="w-60">
                <Input aria-label={`Search ${candidate.toLowerCase()}s`} placeholder={`Search ${candidate.toLowerCase()} or number`} icon="search" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              {sections.length > 1 && <Segmented aria-label="Section" value={section} onChange={setSection} options={[{ value: "ALL", label: "Whole class" }, ...sections.map((s) => ({ value: s, label: s }))]} />}
            </div>
            <div className="w-48">
              <Select aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} options={[{ value: "position", label: "Sort by position" }, { value: "name", label: "Sort by name" }, { value: "roll", label: "Sort by roll number" }]} />
            </div>
          </>
        }
        empty={<EmptyState icon="search" title="No one matches" description="Clear the search or choose another section." />}
      />
      <p className="m-0 text-small text-ink-muted">
        Pass mark: {rules.subjectPassPercent}% in every subject and {rules.overallPassPercent}% overall; failing {rules.supplyMaxSubjects} subjects or fewer means a re-sit. Marks in red are below the pass mark. Equal percentages share a position.{" "}
        {declared ? "Declared results don't change if the grading rules change later." : "Grades follow the current grading rules until the results are declared."}
      </p>

      {open && <StudentResultPanel exam={exam} row={exam.rows.find((r) => r.id === open.id) ?? open} onClose={() => setOpen(null)} />}
    </>
  );
}

/** One student's result, with withhold / release for the principal while the exam is in draft. */
function StudentResultPanel({ exam, row, onClose }: { exam: ExamDetail; row: ExamsResultRow; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const canDeclare = useCanOnExam("exams.declare", exam.campus);
  const readOnly = useReadOnly();
  const rules = exam.passRules ?? EXAMS_DEFAULT_PASS_RULES;
  const [reason, setReason] = useState("");
  const [withholding, setWithholding] = useState(false);
  const [tried, setTried] = useState(false);
  const canWithhold = canDeclare && !readOnly && exam.status === "DRAFT";
  const canManage = useCanOnExam("exams.manage", exam.campus);
  const canRemark = canManage && !readOnly && exam.status === "DRAFT";
  const [remark, setRemark] = useState(row.teacherRemark ?? "");
  const remarkCheck = z.string().max(200, "Keep the remark to 200 characters.").safeParse(remark.trim());
  const saveRemark = useMutation({
    mutationFn: () => examsApi.saveRemark(exam.id, row.id, remark.trim()),
    onSuccess: (data) => {
      queryClient.setQueryData(examsQueries.detail(exam.id).queryKey, data);
      toast({ title: remark.trim() ? "Remark saved" : "Remark removed", message: `${row.name}'s result card ${remark.trim() ? "shows it" : "has no teacher remark"}.` });
    },
  });
  const act = useMutation({
    mutationFn: (r: string | null) => examsApi.withhold(exam.id, row.id, r),
    onSuccess: (data, r) => {
      queryClient.setQueryData(examsQueries.detail(exam.id).queryKey, data);
      void queryClient.invalidateQueries({ queryKey: ["exams"], refetchType: "active" });
      toast(r === null ? { title: "Result released", message: `${row.name}'s result will be declared with the others.` } : { tone: "info", title: "Result withheld", message: `${row.name}'s result won't show in the parent portal until released.` });
      setWithholding(false);
    },
  });
  const failed = new Set(row.failedSubjects ?? []);
  return (
    <SidePanel
      open
      onClose={onClose}
      title={row.name}
      description={`${row.classSection} · Roll ${row.rollNo} · ${row.id}`}
      footer={
        <>
          {row.hasProfile ? (
            <Link to="/students/$grNo" params={{ grNo: row.id }} className={buttonClassName()}>
              Student profile
            </Link>
          ) : (
            <span />
          )}
          <Link to="/exams/$examId/print" params={{ examId: exam.id }} search={{ doc: "card", section: row.classSection, student: row.id } as never} className={buttonClassName({ variant: "primary" })}>
            Result card
          </Link>
        </>
      }
    >
      <div className="grid gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <ResultBadge result={row.result} />
          {row.withheld && <span className="text-small text-ink-muted">Reason: {row.withheld}</span>}
        </div>
        <KeyValue
          items={[
            ["Total", `${row.obtained} of ${row.max}`],
            ["Percentage", row.percent === null ? "Incomplete" : formatPercent(row.percent)],
            ["Grade", row.grade ?? "—"],
            ["Position", row.position ? `${ordinal(row.position)} in ${row.classSection}${row.classPosition ? ` · ${ordinal(row.classPosition)} in the class` : ""}` : "—"],
            ["Result", row.result ? EXAMS_RESULT_LABEL[row.result] : "—"],
            ...(row.group ? ([["Group", row.group]] as Array<[string, string]>) : []),
            ...(row.boardRollNo ? ([["Board roll no.", row.boardRollNo]] as Array<[string, string]>) : []),
          ]}
        />
        <table className="mtb-table mtb-table-dense">
          <caption className="mtb-sr-only">Subject marks</caption>
          <thead>
            <tr>
              <th scope="col" style={{ position: "static" }}>
                Subject
              </th>
              <th scope="col" className="mtb-th-num" style={{ position: "static" }}>
                Marks
              </th>
              <th scope="col" className="mtb-th-num" style={{ position: "static" }}>
                Pass mark
              </th>
            </tr>
          </thead>
          <tbody>
            {exam.subjects.filter((s) => examsSits(s, row.group)).map((s) => (
              <tr key={s.id}>
                <td className={failed.has(s.id) ? "font-medium text-danger-ink" : "font-medium"}>{s.name}</td>
                <td className="mtb-td-num">
                  {markText(row.marks[s.id])} <span className="text-ink-muted">/ {s.maxMarks}</span>
                </td>
                <td className="mtb-td-num text-ink-muted">{examsPassMark(s.maxMarks, rules)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid gap-2">
          <Textarea
            label="Teacher remarks"
            rows={3}
            value={remark}
            disabled={!canRemark}
            onChange={(e) => setRemark(e.target.value)}
            maxLength={220}
            placeholder={canRemark ? "For example: Works hard; needs more practice in written English." : "No remark."}
            help={canRemark ? `Printed on the result card under the result. ${remark.trim().length}/200 characters.` : exam.status === "DECLARED" ? "Locked: the results are declared." : undefined}
            error={!remarkCheck.success ? remarkCheck.error.issues[0]?.message : saveRemark.isError ? errorText(saveRemark.error) : undefined}
          />
          {canRemark && (
            <div>
              <Button size="sm" loading={saveRemark.isPending} disabled={!remarkCheck.success || remark.trim() === (row.teacherRemark ?? "")} onClick={() => saveRemark.mutate()}>
                Save remark
              </Button>
            </div>
          )}
        </div>
        {canWithhold &&
          (row.withheld ? (
            <Button icon="unlock" loading={act.isPending} onClick={() => act.mutate(null)}>
              Release result
            </Button>
          ) : withholding ? (
            <div className="grid gap-3">
              <Textarea label="Why is this result withheld?" required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: dues outstanding since August; parent asked to meet the principal." error={tried && !reason.trim() ? "Say why, in a sentence. It is logged." : undefined} />
              <div className="flex gap-2">
                <Button onClick={() => setWithholding(false)}>Cancel</Button>
                <Button
                  variant="danger"
                  loading={act.isPending}
                  onClick={() => {
                    setTried(true);
                    if (reason.trim()) act.mutate(reason);
                  }}
                >
                  Withhold result
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <Button variant="danger-quiet" icon="flag" onClick={() => setWithholding(true)}>
                Withhold this result…
              </Button>
              <p className="m-0 mt-1 text-small text-ink-muted">A withheld result is left out of positions and the parent portal until it is released.</p>
            </div>
          ))}
        {act.isError && <Banner tone="danger">{errorText(act.error)}</Banner>}
      </div>
    </SidePanel>
  );
}
