import { EXAMS_CATEGORY_LABEL, examsQueries, type ExamsCategory, type ExamsListStatus, type ExamSummary } from "@mtb/api";
import { formatCount, formatDate, formatSession } from "@mtb/domain";
import { AnimatedNumber, Button, buttonClassName, DataTable, EmptyState, Icon, Input, Pagination, Panel, Segmented, Select, StatCard, type Column } from "@mtb/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useDeferredValue, useState, type CSSProperties } from "react";
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

type StatusFilter = ExamsListStatus;

/**
 * Rows per page. A campus session can hold thousands of exams (Khalid Campus: about 6,900 class tests a session), so the
 * server filters and pages the list (contract change C9) and sends the counts and the to-do list with every page.
 */
const PAGE = 50;

/** Exams of the session: what needs doing first, then every exam with its progress. */
export function ExamsPage() {
  const ctx = useCtx();
  const navigate = useNavigate();
  const canManage = useCan("exams.manage");
  const readOnly = useReadOnly();
  const [category, setCategory] = useState<"ALL" | ExamsCategory>("ALL");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const q = useDeferredValue(query.trim());
  const exams = useQuery({ ...examsQueries.list(ctx, { q, category, status, page, pageSize: PAGE }), placeholderData: keepPreviousData });

  const open = (id: string) => void navigate({ to: "/exams/$examId", params: { examId: id } });

  const data = exams.data;
  const counts = data?.counts;
  const pageRows = data?.items ?? [];
  const total = data?.total ?? 0;
  const shownPage = data?.page ?? page;
  const todo = (data?.todo ?? []).map((e) =>
    e.reopen?.status === "PENDING"
      ? { e, icon: "unlock" as const, tone: "warning", text: `Reopen requested by ${e.reopen.requestedBy}`, cta: "Review" }
      : e.missingMarks === 0
        ? { e, icon: "lock" as const, tone: "success", text: "Every mark is in — ready to declare", cta: "Open" }
        : { e, icon: "alertCircle" as const, tone: "warning", text: `${formatCount(e.missingMarks)} ${e.missingMarks === 1 ? "mark" : "marks"} missing · ${e.papersDone} of ${e.papersTotal} papers submitted`, cta: "Progress" },
  );

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
        <StatCard label="Exams this session" icon="exams" loading={exams.isLoading} value={<AnimatedNumber value={counts?.exams ?? 0} format={formatCount} />} foot={`${counts?.declared ?? 0} declared · ${counts?.draft ?? 0} in draft`} />
        <StatCard label="Ready to declare" icon="lock" loading={exams.isLoading} value={<AnimatedNumber value={counts?.ready ?? 0} format={formatCount} />} foot={counts?.ready ? "Every mark is in" : "None waiting"} onClick={() => {
            setStatus("READY");
            setPage(1);
          }} />
        <StatCard label="Marks missing" icon="alertCircle" tone={(counts?.missingMarks ?? 0) > 0 ? "warning" : "neutral"} loading={exams.isLoading} value={<AnimatedNumber value={counts?.missingMarks ?? 0} format={formatCount} />} foot="Across draft exams" onClick={() => {
            setStatus("MISSING");
            setPage(1);
          }} />
        <StatCard label="Reopen requests" icon="unlock" tone={counts?.reopenPending ? "warning" : "neutral"} loading={exams.isLoading} value={<AnimatedNumber value={counts?.reopenPending ?? 0} format={formatCount} />} foot="Need an admin's decision" />
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
        rows={pageRows}
        loading={exams.isLoading}
        skeletonRows={5}
        pagination={total > PAGE ? <Pagination page={shownPage} pageSize={PAGE} total={total} onPageChange={setPage} /> : undefined}
        onRowClick={(e) => open(e.id)}
        toolbar={
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="w-64">
                <Input aria-label="Search exams" placeholder="Search exam, type or section" icon="search" value={query} onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }} />
              </div>
              <Segmented
                aria-label="Exam type"
                value={category}
                onChange={(v) => {
                  setCategory(v as typeof category);
                  setPage(1);
                }}
                options={CATEGORY_OPTIONS}
              />
            </div>
            <div className="w-52">
              <Select
                aria-label="Status"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as StatusFilter);
                  setPage(1);
                }}
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
