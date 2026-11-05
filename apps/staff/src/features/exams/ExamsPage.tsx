import { EXAMS_CATEGORY_LABEL, examsQueries, type ExamsCategory, type ExamSummary } from "@mtb/api";
import { formatCount, formatDate, formatSession } from "@mtb/domain";
import { AnimatedNumber, Button, buttonClassName, DataTable, EmptyState, Icon, Input, Panel, Segmented, Select, StatCard, type Column } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type CSSProperties } from "react";
import { campusLabel } from "../../app/shell/campus";
import { Page, PageHeader } from "../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { ExamsNav, ExamStatus, examTitle, LoadError } from "./shared";

const CATEGORY_OPTIONS: Array<{ value: "ALL" | ExamsCategory; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "TERM", label: "Term" },
  { value: "TEST", label: "Class test" },
  { value: "BOARD", label: "Board" },
  { value: "ENTRANCE", label: "Entrance" },
];

type StatusFilter = "ALL" | "MISSING" | "READY" | "DECLARED";

/** Exams of the session: what needs doing first, then every exam with its progress. */
export function ExamsPage() {
  const ctx = useCtx();
  const navigate = useNavigate();
  const canManage = useCan("exams.manage");
  const readOnly = useReadOnly();
  const exams = useQuery(examsQueries.list(ctx));
  const [category, setCategory] = useState<"ALL" | ExamsCategory>("ALL");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [query, setQuery] = useState("");

  const open = (id: string) => void navigate({ to: "/exams/$examId", params: { examId: id } });

  const list = exams.data ?? [];
  const q = query.trim().toLowerCase();
  const rows = list.filter(
    (e) =>
      (category === "ALL" || e.category === category) &&
      (status === "ALL" || (status === "MISSING" && e.status === "DRAFT" && e.missingMarks > 0) || (status === "READY" && e.status === "DRAFT" && e.missingMarks === 0) || (status === "DECLARED" && e.status === "DECLARED")) &&
      (!q || `${e.name} ${e.classes.join(" ")} ${e.typeName ?? ""}`.toLowerCase().includes(q)),
  );
  const drafts = list.filter((e) => e.status === "DRAFT");
  const ready = drafts.filter((e) => e.missingMarks === 0);
  const missing = drafts.reduce((a, e) => a + e.missingMarks, 0);
  const reopen = list.filter((e) => e.reopen?.status === "PENDING");
  const todo = [
    ...reopen.map((e) => ({ e, icon: "unlock" as const, tone: "warning", text: `Reopen requested by ${e.reopen!.requestedBy}`, cta: "Review" })),
    ...ready.map((e) => ({ e, icon: "lock" as const, tone: "success", text: `All ${formatCount(e.students * e.subjects.length)} marks are in — ready to declare`, cta: "Open" })),
    ...drafts
      .filter((e) => e.missingMarks > 0)
      .map((e) => ({ e, icon: "alertCircle" as const, tone: "warning", text: `${formatCount(e.missingMarks)} ${e.missingMarks === 1 ? "mark" : "marks"} missing · ${e.papersDone} of ${e.papersTotal} papers submitted`, cta: "Progress" })),
  ];

  const columns: Array<Column<ExamSummary>> = [
    {
      key: "name",
      header: "Exam",
      render: (e) => (
        <span className="grid">
          <span className="mtb-cell-primary">{examTitle(e)}</span>
          <span className="mtb-cell-secondary">
            {e.typeName ?? EXAMS_CATEGORY_LABEL[e.category]} · <span className="mtb-num">{formatDate(e.startDate)}</span>
            {e.endDate && e.endDate !== e.startDate ? (
              <>
                {" "}
                to <span className="mtb-num">{formatDate(e.endDate)}</span>
              </>
            ) : null}
            {ctx.campus === "ALL" ? ` · ${campusLabel(e.campus)}` : ""}
          </span>
        </span>
      ),
    },
    { key: "classes", header: "Sections", width: 150, render: (e) => e.classes.join(", ") },
    {
      key: "subjects",
      header: "Papers",
      width: 220,
      render: (e) => (
        <span className="grid">
          <span>
            {e.subjects.length} {e.subjects.length === 1 ? "subject" : "subjects"} · <span className="mtb-num">{e.totalMax}</span> marks
          </span>
          <span className="mtb-cell-secondary truncate">{e.subjects.map((s) => s.name).join(", ")}</span>
        </span>
      ),
    },
    {
      key: "progress",
      header: "Marks submitted",
      width: 170,
      render: (e) => {
        const pct = e.papersTotal ? Math.round((e.papersDone / e.papersTotal) * 100) : 0;
        return (
          <span className="grid gap-1">
            <span className="text-small text-ink-muted">
              <span className="mtb-num text-ink">{e.papersDone}</span> of {e.papersTotal} papers
            </span>
            <span className="mtb-meter" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${pct}% of papers submitted`}>
              <span style={{ width: `${pct}%` }} />
            </span>
          </span>
        );
      },
    },
    { key: "students", header: "Candidates", align: "right", width: 104, render: (e) => <span className="mtb-num">{formatCount(e.students)}</span> },
    { key: "status", header: "Status", width: 230, render: (e) => <ExamStatus exam={e} /> },
  ];

  return (
    <Page>
      <PageHeader
        title="Exams"
        actions={
          canManage && !readOnly ? (
            <Link to="/exams/new" className={buttonClassName({ variant: "primary" })}>
              <Icon name="plus" size={18} />
              New exam
            </Link>
          ) : undefined
        }
      />
      <ExamsNav />

      {exams.isError && <LoadError what="Exams" error={exams.error} onRetry={() => void exams.refetch()} />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Exams this session" icon="exams" loading={exams.isLoading} value={<AnimatedNumber value={list.length} format={formatCount} />} foot={`${list.filter((e) => e.status === "DECLARED").length} declared · ${drafts.length} in draft`} />
        <StatCard label="Ready to declare" icon="lock" loading={exams.isLoading} value={<AnimatedNumber value={ready.length} format={formatCount} />} foot={ready.length ? "Every mark is in" : "None waiting"} onClick={() => setStatus("READY")} />
        <StatCard label="Marks missing" icon="alertCircle" tone={missing > 0 ? "warning" : "neutral"} loading={exams.isLoading} value={<AnimatedNumber value={missing} format={formatCount} />} foot="Across draft exams" onClick={() => setStatus("MISSING")} />
        <StatCard label="Reopen requests" icon="unlock" tone={reopen.length ? "warning" : "neutral"} loading={exams.isLoading} value={<AnimatedNumber value={reopen.length} format={formatCount} />} foot="Need an admin's decision" />
      </div>

      {todo.length > 0 && (
        <Panel id="exams-todo" title="What needs doing" description="Exams that are waiting on someone, most urgent first." rise={1}>
          <ul className="m-0 grid list-none gap-2 p-0">
            {todo.slice(0, 6).map((t, i) => (
              <li key={`${t.e.id}-${t.cta}`} className="mtb-slide-in" style={{ "--i": i } as CSSProperties}>
                <button type="button" onClick={() => open(t.e.id)} className="flex w-full items-center gap-3 rounded-md border border-border bg-surface-raised px-3 py-2.5 text-left hover:border-brand">
                  <span className={`grid size-9 shrink-0 place-content-center rounded-full ${t.tone === "success" ? "bg-success-tint text-success-ink" : "bg-warning-tint text-warning-ink"}`}>
                    <Icon name={t.icon} size={18} />
                  </span>
                  <span className="grid min-w-0 flex-1">
                    <span className="font-medium">{examTitle(t.e)}</span>
                    <span className="truncate text-small text-ink-muted">
                      {t.text}
                      {ctx.campus === "ALL" ? ` · ${campusLabel(t.e.campus)}` : ""}
                    </span>
                  </span>
                  <span className="text-small font-medium text-brand-ink">{t.cta}</span>
                  <Icon name="chevronRight" size={16} className="text-ink-subtle" />
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <DataTable
        caption={`Exams, ${campusLabel(ctx.campus)}, Session ${formatSession(ctx.session)}`}
        columns={columns}
        rows={rows}
        loading={exams.isLoading}
        skeletonRows={5}
        onRowClick={(e) => open(e.id)}
        toolbar={
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="w-64">
                <Input aria-label="Search exams" placeholder="Search exam, type or section" icon="search" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <Segmented aria-label="Exam type" value={category} onChange={(v) => setCategory(v as typeof category)} options={CATEGORY_OPTIONS} />
            </div>
            <div className="w-52">
              <Select
                aria-label="Status"
                value={status}
                onChange={(e) => setStatus(e.target.value as StatusFilter)}
                options={[
                  { value: "ALL", label: "Every status" },
                  { value: "MISSING", label: "Marks missing" },
                  { value: "READY", label: "Ready to declare" },
                  { value: "DECLARED", label: "Declared" },
                ]}
              />
            </div>
          </>
        }
        empty={
          exams.isError ? (
            <EmptyState icon="alertCircle" title="Exams couldn't be loaded" description="Check the connection and try again." action={<Button onClick={() => void exams.refetch()}>Try again</Button>} />
          ) : (
            <EmptyState
              icon="exams"
              title={q || category !== "ALL" || status !== "ALL" ? "No exams match" : `No exams for ${campusLabel(ctx.campus)} in ${formatSession(ctx.session)}`}
              description={q || category !== "ALL" || status !== "ALL" ? "Clear the search or choose another type or status." : "Set up an exam with its subjects and date sheet, and it appears here."}
              action={
                canManage && !readOnly && !q && category === "ALL" && status === "ALL" ? (
                  <Link to="/exams/new" className={buttonClassName({ variant: "primary" })}>
                    New exam
                  </Link>
                ) : undefined
              }
            />
          )
        }
      />
    </Page>
  );
}
