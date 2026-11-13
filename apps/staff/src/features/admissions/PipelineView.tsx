import { admissionsApi, admissionsQueries, ADMISSIONS_STAGE_LABEL, ADMISSIONS_STAGES, type AdmissionsApplicant, type AdmissionsPipelineQuery, type AdmissionsPipelineSort, type AdmissionsStage } from "@mtb/api";
import { formatCnic, formatDate, formatMobile } from "@mtb/domain";
import { Button, Checkbox, cx, DataTable, DateText, EmptyState, Icon, Input, Pagination, Segmented, Select, Skeleton, StatusBadge, type Column, type SortState } from "@mtb/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import { useCtx } from "../../app/session";
import { LoadError, stagger } from "../students/shared";
import { DiamondMindsBadge, downloadCsv, mobileOrDash, offerDeadline, orDash, relationName, scoreOf, scoreShare, scoreText, StageBadge } from "./shared";

/** Cards per board column (the server sends the newest of each stage: a session can hold thousands of applications; the table pages through all). */
const BOARD_LIMIT = 60;

/** Columns the table can add (the legacy Candidate Detail report's fields). */
const EXTRA_COLUMNS = [
  { key: "dob", label: "Date of birth" },
  { key: "bForm", label: "B-form" },
  { key: "previousSchool", label: "Previous school" },
  { key: "mobile", label: "Mobile" },
  { key: "address", label: "Address" },
] as const;
type ExtraKey = (typeof EXTRA_COLUMNS)[number]["key"];

function ApplicantCard({ a, i, showCampus, onOpen }: { a: AdmissionsApplicant; i: number; showCampus: boolean; onOpen: (id: string) => void }) {
  const deadline = a.stage === "OFFERED" ? offerDeadline(a.offerValidUntil) : null;
  return (
    <li className="mtb-slide-in" style={stagger(i)}>
      <button type="button" onClick={() => onOpen(a.id)} className="grid w-full gap-2 rounded-lg border border-border bg-surface-raised p-3 text-left shadow-sm transition-colors hover:border-brand" aria-label={`${a.name}, ${a.classApplied}. Open application`}>
        <div className="flex items-start justify-between gap-2">
          <span className="grid min-w-0">
            <span className="truncate font-medium text-ink">{a.name}</span>
            <span className="truncate text-small text-ink-muted">{relationName(a) || "Father not on record"}</span>
          </span>
          {a.diamondMinds && <DiamondMindsBadge />}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small">
          <span className="rounded-sm bg-surface-sunken px-2 py-0.5 font-medium text-ink">{a.classApplied}</span>
          <span className={cx("mtb-num", a.testScore !== null && a.testMax ? "font-medium text-ink" : "text-ink-muted")}>{a.testScore !== null && a.testMax ? `Test ${scoreText(a)}` : scoreText(a)}</span>
          {a.fee?.status === "DUE" && <StatusBadge status="unpaid">Fee due</StatusBadge>}
          {a.siblings && a.siblings.length > 0 && (
            <span className="flex items-center gap-1 text-ink-muted" title="Siblings already at MTB">
              <Icon name="home" size={14} /> {a.siblings.length}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-2 text-small text-ink-muted">
          <span className="mtb-mono" style={{ fontSize: 12 }}>
            {a.applicationNo}
          </span>
          {a.stage === "ADMITTED" ? (
            <span>
              G.R. <span className="mtb-mono" style={{ fontSize: 12 }}>{a.grNo}</span>
            </span>
          ) : deadline ? (
            <span className={deadline.urgent ? "font-medium text-warning-ink" : undefined}>{deadline.text}</span>
          ) : (
            <span className="mtb-num">Applied {formatDate(a.appliedOn)}</span>
          )}
        </div>
        {showCampus && <span className="text-small text-ink-muted">{a.campusName}</span>}
      </button>
    </li>
  );
}

function Board({ applicants, matched, showCampus, onOpen }: { applicants: AdmissionsApplicant[]; matched: Record<AdmissionsStage, number>; showCampus: boolean; onOpen: (id: string) => void }) {
  return (
    <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-5">
      {ADMISSIONS_STAGES.map((s) => {
        const list = applicants.filter((a) => a.stage === s);
        const all = matched[s] ?? list.length;
        return (
          <section key={s} aria-labelledby={`stage-${s}`} className="grid gap-3 rounded-lg bg-surface-sunken p-3">
            <header className="flex items-center justify-between">
              <h3 id={`stage-${s}`} className="m-0 text-title-3">
                {ADMISSIONS_STAGE_LABEL[s]}
              </h3>
              <span className="grid h-6 min-w-6 place-content-center rounded-full bg-neutral-tint px-2 text-small font-medium text-neutral-ink tabular-nums" aria-label={`${all} applicants`}>
                {all}
              </span>
            </header>
            {list.length === 0 ? (
              <p className="m-0 rounded-md border border-dashed border-border-strong px-3 py-6 text-center text-small text-ink-muted">No applicants at this stage.</p>
            ) : (
              <ul className="m-0 grid max-h-[620px] list-none gap-2 overflow-y-auto p-0">
                {list.map((a, i) => (
                  <ApplicantCard key={a.id} a={a} i={i} showCampus={showCampus} onOpen={onOpen} />
                ))}
                {all > list.length && (
                  <li className="px-1 py-2 text-center text-small text-ink-muted">
                    {all - list.length} more · search, filter by class or use the table to see them
                  </li>
                )}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** The table's rows come sorted and paged from the server (contract C8); the header only shows the order. */
function Table({ applicants, showCampus, onOpen, extra, sort, onSortChange, pagination }: { applicants: AdmissionsApplicant[]; showCampus: boolean; onOpen: (id: string) => void; extra: Set<ExtraKey>; sort: SortState; onSortChange: (s: SortState) => void; pagination: ReactNode }) {
  const columns: Array<Column<AdmissionsApplicant>> = [
    {
      key: "name",
      header: "Applicant",
      sortable: true,
      render: (a) => (
        <span className="grid">
          <span className="mtb-cell-primary flex items-center gap-2">
            {a.name} {a.diamondMinds && <DiamondMindsBadge />}
          </span>
          <span className="mtb-cell-secondary">{relationName(a) || "—"}</span>
        </span>
      ),
    },
    { key: "applicationNo", header: "Application", width: 170, render: (a) => <span className="mtb-mono">{a.applicationNo}</span> },
    { key: "classApplied", header: "Class", width: 100, sortable: true },
    { key: "stage", header: "Stage", width: 120, sortable: true, render: (a) => <StageBadge stage={a.stage} /> },
    { key: "fee", header: "Candidate fee", width: 130, render: (a) => (a.fee ? <StatusBadge status={a.fee.status === "DUE" ? "unpaid" : a.fee.status === "WAIVED" ? "neutral" : "paid"}>{a.fee.status === "DUE" ? "Due" : a.fee.status === "WAIVED" ? "Waived" : "Paid"}</StatusBadge> : <span className="text-ink-subtle">—</span>) },
    { key: "score", header: "Test score", align: "right", width: 170, sortable: true, render: (a) => <span className={scoreShare(a) === null ? "text-ink-muted" : undefined}>{scoreText(a)}</span> },
    { key: "appliedOn", header: "Applied on", width: 130, sortable: true, render: (a) => <DateText value={a.appliedOn} /> },
    ...(extra.has("dob") ? [{ key: "dob", header: "Date of birth", width: 130, render: (a: AdmissionsApplicant) => (a.dob ? <DateText value={a.dob} /> : <span className="text-ink-subtle">—</span>) }] : []),
    ...(extra.has("bForm") ? [{ key: "bForm", header: "B-form", width: 160, render: (a: AdmissionsApplicant) => (a.bForm ? <span className="mtb-mono">{formatCnic(a.bForm)}</span> : <span className="text-ink-subtle">—</span>) }] : []),
    ...(extra.has("previousSchool") ? [{ key: "previousSchool", header: "Previous school", width: 190, render: (a: AdmissionsApplicant) => a.previousSchool ?? <span className="text-ink-subtle">—</span> }] : []),
    ...(extra.has("mobile") ? [{ key: "mobile", header: "Mobile", width: 140, render: (a: AdmissionsApplicant) => <span className="tabular-nums">{mobileOrDash(a.mobile)}</span> }] : []),
    ...(extra.has("address") ? [{ key: "address", header: "Address", width: 260, render: (a: AdmissionsApplicant) => orDash(a.address) }] : []),
    ...(showCampus ? [{ key: "campus", header: "Campus", width: 150, render: (a: AdmissionsApplicant) => a.campusName }] : []),
  ];
  return <DataTable caption="Applicants" columns={columns} rows={applicants} sort={sort} onSortChange={onSortChange} maxHeight={560} onRowClick={(a) => onOpen(a.id)} pagination={pagination} empty={<EmptyState icon="admissions" title="No applicants" description="No applications match the search and filters." />} />;
}

function csvOf(list: AdmissionsApplicant[], showCampus: boolean) {
  downloadCsv(
    "applicants.csv",
    ["Application no.", "Name", "Relation", "Father", "Father's CNIC", "Gender", "Date of birth", "B-form", "Class applied", "Group", "Stage", "Test score", "Previous school", "Mobile", "Address", "Applied on", ...(showCampus ? ["Campus"] : [])],
    list.map((a) => [
      a.applicationNo,
      a.name,
      a.relation,
      a.father,
      a.fatherCnic ? formatCnic(a.fatherCnic) : "",
      a.gender === "F" ? "Girl" : "Boy",
      a.dob ? formatDate(a.dob) : "",
      a.bForm ? formatCnic(a.bForm) : "",
      a.classApplied,
      a.stream ?? "",
      ADMISSIONS_STAGE_LABEL[a.stage],
      scoreShare(a) === null ? "" : scoreOf(a, "/"),
      a.previousSchool ?? "",
      a.mobile ? formatMobile(a.mobile) : "",
      a.address,
      formatDate(a.appliedOn),
      ...(showCampus ? [a.campusName] : []),
    ]),
  );
}

const SORTS: Record<string, AdmissionsPipelineSort> = { appliedOn: "appliedOn", name: "name", classApplied: "classApplied", stage: "stage", score: "score" };

/** The pipeline of the campus and session in the header: a board (the newest cards of each stage) or a paged table. Filters, search and order run on the server (contract C8). */
export function PipelineView({ counts, view, onViewChange, showCampus, onOpen }: { counts: Record<AdmissionsStage, number> | undefined; view: "board" | "table"; onViewChange: (v: "board" | "table") => void; showCampus: boolean; onOpen: (id: string) => void }) {
  const ctx = useCtx();
  const [cls, setCls] = useState("");
  const [gender, setGender] = useState<"" | "F" | "M">("");
  const [q, setQ] = useState("");
  const term = useDeferredValue(q.trim());
  const [withdrawn, setWithdrawn] = useState(false);
  const [extra, setExtra] = useState<Set<ExtraKey>>(new Set());
  const [sort, setSort] = useState<SortState>({ key: "appliedOn", dir: "desc" });
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(50);
  const [exporting, setExporting] = useState(false);
  useEffect(() => setPage(1), [cls, gender, term, withdrawn, sort, size, ctx.campus, ctx.session]);

  const setup = useQuery({ ...admissionsQueries.setup(ctx), enabled: ctx.campus !== "ALL" });
  const classes = useMemo(() => (setup.data?.classes ?? []).map((c) => c.classApplied), [setup.data]);
  const filters: AdmissionsPipelineQuery = { ...(cls ? { class: cls } : {}), ...(gender ? { gender } : {}), ...(term ? { q: term } : {}) };
  // The table leaves withdrawn applications out unless asked (a search finds them too, as before).
  const tableStages: AdmissionsPipelineQuery = withdrawn || term ? {} : { stage: ADMISSIONS_STAGES };
  const order: AdmissionsPipelineQuery = { sort: SORTS[sort.key] ?? "appliedOn", dir: sort.dir };
  const board = useQuery({ ...admissionsQueries.pipeline(ctx, { ...filters, stage: ADMISSIONS_STAGES, perStage: BOARD_LIMIT }), enabled: view === "board", placeholderData: keepPreviousData });
  const table = useQuery({ ...admissionsQueries.pipeline(ctx, { ...filters, ...tableStages, ...order, page, pageSize: size }), enabled: view === "table", placeholderData: keepPreviousData });
  const current = view === "board" ? board : table;
  const data = current.data;
  const everyone = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : undefined;

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all = await admissionsApi.pipelineAll(ctx, { ...filters, ...tableStages, ...order });
      csvOf(all.applicants, showCampus);
    } finally {
      setExporting(false);
    }
  };

  if (current.isError) return <LoadError what="applicants" error={current.error} onRetry={() => void current.refetch()} />;
  if (!data) {
    return (
      <div className="grid gap-4" aria-busy="true" aria-label="Loading applicants">
        <Skeleton height={44} />
        <Skeleton height={320} style={{ borderRadius: "var(--radius-lg)" }} />
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-64">
            <Input label="Search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, application no., father, CNIC or mobile" />
          </div>
          {classes.length > 0 && (
            <div className="w-48">
              <Select label="Class applied for" value={cls} onChange={(e) => setCls(e.target.value)} options={[{ value: "", label: "All classes" }, ...classes.map((c) => ({ value: c, label: c }))]} />
            </div>
          )}
          <div className="w-36">
            <Select
              label="Boys or girls"
              value={gender}
              onChange={(e) => setGender(e.target.value as "" | "F" | "M")}
              options={[
                { value: "", label: "Both" },
                { value: "F", label: "Girls" },
                { value: "M", label: "Boys" },
              ]}
            />
          </div>
          {view === "table" && <Checkbox label={`Show withdrawn (${data.counts.WITHDRAWN})`} checked={withdrawn} onChange={(e) => setWithdrawn(e.target.checked)} />}
          {view === "table" && (
            <Button size="sm" icon="download" disabled={data.total === 0 || exporting} onClick={() => void exportCsv()}>
              {exporting ? "Preparing CSV…" : `Download CSV (${data.total})`}
            </Button>
          )}
        </div>
        <Segmented
          aria-label="View"
          value={view}
          onChange={(v) => onViewChange(v as "board" | "table")}
          options={[
            { value: "board", label: "Board" },
            { value: "table", label: "Table" },
          ]}
        />
      </div>
      {view === "table" && data.total > 0 && (
        <fieldset className="m-0 flex flex-wrap items-center gap-4 border-0 p-0">
          <legend className="mtb-label float-left mr-2">More columns</legend>
          {EXTRA_COLUMNS.map((c) => (
            <Checkbox key={c.key} label={c.label} checked={extra.has(c.key)} onChange={(e) => setExtra((s) => (e.target.checked ? new Set([...s, c.key]) : new Set([...s].filter((x) => x !== c.key))))} />
          ))}
        </fieldset>
      )}
      {everyone === 0 ? (
        <EmptyState icon="admissions" title="No applications this session" description="Applications for this campus and session appear here as the office enters them." />
      ) : term && data.total === 0 ? (
        <EmptyState icon="search" title="No applicant matches" description={`Nobody matches “${term}”. Check the spelling, or search by the application or mobile number.`} />
      ) : view === "board" ? (
        <Board applicants={data.applicants} matched={data.matched} showCampus={showCampus} onOpen={onOpen} />
      ) : (
        <Table
          applicants={data.applicants}
          showCampus={showCampus}
          onOpen={onOpen}
          extra={extra}
          sort={sort}
          onSortChange={setSort}
          pagination={data.total > size || page > 1 ? <Pagination page={page} pageSize={size} total={data.total} onPageChange={setPage} pageSizes={[50, 100, 200]} onPageSizeChange={setSize} /> : undefined}
        />
      )}
    </div>
  );
}
