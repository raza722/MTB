import {
  ApiError,
  metaQueries,
  REPORT_BACKGROUND_NOTE,
  REPORT_SUBTOTAL_KEY,
  reportsApi,
  reportsQueries,
  type ReportCatalogueItem,
  type ReportCell,
  type ReportColumnDef,
  type ReportFilterDef,
  type ReportFilterValues,
  type ReportFormat,
  type ReportResult,
  type ReportRunRequest,
} from "@mtb/api";
import { daysBetween, formatCount, formatDate, formatPercent, formatRs, formatSession, pakistanToday, type IsoDate } from "@mtb/domain";
import {
  AreaChart,
  Banner,
  Button,
  buttonClassName,
  ColumnChart,
  DataTable,
  DatePicker,
  DateText,
  EmptyState,
  Icon,
  IconButton,
  Input,
  Menu,
  MenuItem,
  Money,
  Pagination,
  Panel,
  Segmented,
  Select,
  Skeleton,
  StatusBadge,
  Urdu,
  useToast,
  type Column,
  type SortState,
} from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCtx, useReadOnly } from "../../app/session";
import { RequireSingleCampus } from "../../app/shell/page";
import { downloadExcel } from "./export";
import { ReportDocument } from "./ReportDocument";
import { ScheduleEditor } from "./SchedulesPage";
import { cellText, errorText, formatLabel, LoadError, MODULE_ICON, moduleLabel, ReportsShell, statusTone, timeText } from "./shell";

export interface ViewerSearch {
  /** Show the copy a background job prepared. */
  job?: string;
  /** Open the print dialog once the copy has loaded (PDF downloads). */
  print?: 1;
  /** Filters to start with, e.g. from a module page's "Open as report" link: { class: "9", range: "2026-04-01|2026-11-04" }. */
  f?: Record<string, string>;
}

/** Filters given in the link, only for keys the report has. */
const startFilters = (filters: ReportFilterDef[], given: Record<string, string> | undefined): ReportFilterValues => {
  const out = defaultsOf(filters);
  for (const f of filters) if (given && typeof given[f.key] === "string") out[f.key] = given[f.key]!;
  return out;
};

const PAGE = 50;

/**
 * Today in Pakistan (the server's "today"). Only for default dates, picker limits and the checks next to the
 * filters: the server resolves and validates the filters again.
 */
const today = (): IsoDate => pakistanToday();
const monthStartOf = (d: IsoDate): IsoDate => `${d.slice(0, 7)}-01`;

/** The last day of the month before the one `d` falls in, and that month's first day. */
function prevMonthOf(d: IsoDate): { from: IsoDate; to: IsoDate } {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  const mm = String(pm).padStart(2, "0");
  return { from: `${py}-${mm}-01`, to: `${py}-${mm}-${String(last).padStart(2, "0")}` };
}

/**
 * Turns the "today" / "monthStart" defaults into dates the pickers understand (the contract's two tokens; the
 * server sends every other default already resolved).
 */
function defaultsOf(filters: ReportFilterDef[]): ReportFilterValues {
  const t = today();
  const out: ReportFilterValues = {};
  for (const f of filters) out[f.key] = (f.default ?? "").replace(/monthStart/g, monthStartOf(t)).replace(/today/g, t);
  return out;
}

/** Plain-English checks next to the filters, in the server's order and wording (the server checks again). */
function check(filters: ReportFilterDef[], v: ReportFilterValues): Record<string, string> {
  const t = today();
  const e: Record<string, string> = {};
  for (const f of filters) {
    const val = v[f.key] ?? "";
    if (f.required && !val) {
      e[f.key] = `Choose ${f.label.toLowerCase()}.`;
      continue;
    }
    if (f.kind === "dateRange") {
      const [from = "", to = ""] = val.split("|");
      if (!from || !to) e[f.key] = "Choose both dates.";
      else if (from > to) e[f.key] = "The first date must be on or before the second.";
      else if (to > t) e[f.key] = `Choose dates up to today (${formatDate(t)}).`;
      else if (daysBetween(from, to) > 366) e[f.key] = "Choose a period of one year or less.";
      continue;
    }
    if (f.kind === "date" && val > t && !f.allowFuture) e[f.key] = `Choose today (${formatDate(t)}) or an earlier date.`;
    else if (f.kind === "number" && val && !/^\d+$/.test(val)) e[f.key] = `${f.label}: enter a whole number.`;
  }
  return e;
}

/** /reports/$reportId — filters, then the report on screen; export to PDF or Excel; big ones run in the background. */
export function ReportViewerPage({ reportId, search, setSearch }: { reportId: string; search: ViewerSearch; setSearch: (next: ViewerSearch) => void }) {
  const ctx = useCtx();
  const cat = useQuery(reportsQueries.catalogue(ctx));
  const def = cat.data?.reports.find((r) => r.id === reportId);

  if (cat.isPending)
    return (
      <ReportsShell title="Report">
        <Skeleton height={120} />
        <Skeleton height={360} />
      </ReportsShell>
    );
  if (cat.error && !cat.data)
    return (
      <ReportsShell title="Report">
        <LoadError what="This report" error={cat.error} onRetry={() => void cat.refetch()} />
      </ReportsShell>
    );
  if (!def)
    return (
      <ReportsShell title="Report">
        <div className="mtb-card">
          <EmptyState
            icon="lock"
            title="This report isn't available to you here"
            description="It may need a permission your role doesn't have at this campus, or the link is out of date."
            action={
              <Link to="/reports" className={buttonClassName({ variant: "primary", size: "sm" })}>
                All reports
              </Link>
            }
          />
        </div>
      </ReportsShell>
    );
  return <Viewer key={`${def.id}:${ctx.campus}:${ctx.session}`} def={def} search={search} setSearch={setSearch} />;
}

function Viewer({ def, search, setSearch }: { def: ReportCatalogueItem; search: ViewerSearch; setSearch: (next: ViewerSearch) => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ReportFilterValues>(() => startFilters(def.filters, search.f));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const needsCampus = Boolean(def.singleCampus) && ctx.campus === "ALL";
  // Small reports run straight away with the default filters; large ones wait for the user.
  const [applied, setApplied] = useState<ReportFilterValues | null>(() => (def.background || search.job ? null : startFilters(def.filters, search.f)));
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const readOnly = useReadOnly();

  const request: ReportRunRequest | null = applied && !needsCampus && !search.job ? { reportId: def.id, campus: ctx.campus, session: ctx.session, filters: applied } : null;
  const run = useQuery(reportsQueries.run(request));
  const jobs = useQuery({ ...reportsQueries.jobs(ctx), refetchInterval: (q) => (search.job && q.state.data?.find((j) => j.id === search.job && (j.status === "QUEUED" || j.status === "RUNNING")) ? 1000 : false) });
  const job = search.job ? jobs.data?.find((j) => j.id === search.job) : undefined;
  const jobResult = useQuery(reportsQueries.jobResult(ctx, job?.status === "READY" ? job.id : null));
  const result: ReportResult | undefined = search.job ? jobResult.data : run.data;

  // A prepared copy shows the filters it was made with.
  const jobId = job?.id;
  useEffect(() => {
    if (job) setDraft({ ...defaultsOf(def.filters), ...job.filters });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  // Field errors from the server go next to the filter.
  useEffect(() => {
    const e = run.error;
    if (e instanceof ApiError && e.field) setErrors((prev) => ({ ...prev, [e.field!]: e.message }));
  }, [run.error]);

  // PDF downloads open the print dialog once the copy is on screen.
  const printed = useRef(false);
  useEffect(() => {
    if (search.print && result && !printed.current) {
      printed.current = true;
      setTimeout(() => window.print(), 400);
    }
  }, [search.print, result]);

  const fav = useMutation({
    mutationFn: () => reportsApi.setFavourite(def.id, !def.favourite),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: reportsQueries.catalogue(ctx).queryKey }),
  });

  const startJob = useMutation({
    mutationFn: (format: ReportFormat | "SCREEN") => reportsApi.startJob({ reportId: def.id, campus: ctx.campus, session: ctx.session, filters: draft, format }),
    onSuccess: async (j, format) => {
      await queryClient.invalidateQueries({ queryKey: reportsQueries.jobs(ctx).queryKey });
      if (format === "SCREEN") {
        setSearch({ job: j.id });
        return;
      }
      if (j.status === "READY") {
        // Small reports: the file is ready straight away. What is on screen is reused when the filters match.
        const onScreen = !search.job && run.data && JSON.stringify(draft) === JSON.stringify(applied) ? run.data : undefined;
        if (format === "EXCEL") {
          const data = onScreen ?? (await reportsApi.jobResult(j.id));
          downloadExcel(data, ctx.campus);
          toast({ title: `Excel file saved · ${def.name}`, message: `${formatCount(data.rows.length)} rows. Opens in Excel; also kept in Downloads for 7 days.` });
        } else if (onScreen) setTimeout(() => window.print(), 100);
        else setSearch({ job: j.id, print: 1 });
        return;
      }
      toast({ tone: "info", title: `Preparing ${formatLabel(format)} · ${def.name}`, message: "Large reports are prepared in the background. Keep working — you'll be told when it is ready.", duration: 6000 });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.field) setErrors({ [e.field]: e.message });
      else toast({ tone: "danger", title: "Not started", message: errorText(e) });
    },
  });

  const apply = () => {
    const e = check(def.filters, draft);
    setErrors(e);
    if (Object.keys(e).length) return;
    if (def.background) {
      startJob.mutate("SCREEN");
      return;
    }
    if (search.job) setSearch({});
    setApplied({ ...draft });
  };

  const exportAs = (format: ReportFormat) => {
    const e = check(def.filters, draft);
    setErrors(e);
    if (Object.keys(e).length) return;
    startJob.mutate(format);
  };

  const owner = (
    <Link to={def.ownerPath as never} className="inline-flex items-center gap-1 font-medium text-brand-ink">
      Open in {def.ownerLabel} <Icon name="arrowRight" size={14} />
    </Link>
  );

  return (
    <ReportsShell
      title={def.name}
      context={
        <span className="inline-flex flex-wrap items-center gap-x-2">
          <Icon name={MODULE_ICON[def.module]} size={14} /> {moduleLabel(def.module)} · {def.description}
        </span>
      }
      meta={
        <>
          {def.isNew && <StatusBadge status="brand" dot={false}>New report</StatusBadge>}
          {def.improvement && <StatusBadge status="success" dot={false}>Fixed</StatusBadge>}
          {def.background && <StatusBadge status="info" dot={false}>Runs in background</StatusBadge>}
          <span className="text-small text-ink-muted">{owner}</span>
        </>
      }
      actions={
        <>
          <IconButton icon="star" label={def.favourite ? "Remove from favourites" : "Add to favourites"} aria-pressed={def.favourite} className="rpt-star" onClick={() => fav.mutate()} />
          <Button icon="clock" onClick={() => setScheduleOpen(true)} disabled={needsCampus || readOnly} title={readOnly ? "Schedules run in the current session. Switch session to schedule." : undefined}>
            Schedule
          </Button>
          <Menu
            label="Export"
            align="end"
            trigger={
              <Button variant="primary" icon="download" iconRight="chevronDown" loading={startJob.isPending && startJob.variables !== "SCREEN"} loadingLabel="Preparing…" disabled={needsCampus}>
                Export
              </Button>
            }
          >
            {def.formats.includes("PDF") && (
              <MenuItem icon="printer" onSelect={() => exportAs("PDF")}>
                PDF — print or save, A4{def.paper === "A4_LANDSCAPE" ? " landscape" : ""}
              </MenuItem>
            )}
            {def.formats.includes("EXCEL") && (
              <MenuItem icon="listChecks" onSelect={() => exportAs("EXCEL")}>
                Excel spreadsheet
              </MenuItem>
            )}
          </Menu>
        </>
      }
    >
      {(def.improvement || def.replaces.length > 0) && (
        <Banner tone="neutral" icon="info" title={def.improvement ? "What changed" : "In the old software"}>
          {def.improvement ? `${def.improvement} ` : ""}
          {def.replaces.length > 0 && <>Replaces: {def.replaces.join(", ")}.</>}
        </Banner>
      )}

      {needsCampus ? (
        <RequireSingleCampus action="this report">
          <span />
        </RequireSingleCampus>
      ) : (
        <>
          {def.filters.length > 0 && (
            <Panel id="rpt-filters" rise={0} title="Filters" description={def.background ? REPORT_BACKGROUND_NOTE : "Change the filters, then run the report."}>
              <form
                className="grid gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  apply();
                }}
              >
                <div className="rpt-filters">
                  {def.filters.map((f) => (
                    <FilterControl key={f.key} def={f} value={draft[f.key] ?? ""} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} error={errors[f.key]} classFilter={draft.class ?? ""} />
                  ))}
                </div>
                <div className="rpt-filters-actions">
                  <Button type="submit" variant="primary" icon={def.background ? "clock" : "play"} loading={def.background ? startJob.isPending && startJob.variables === "SCREEN" : run.isFetching} loadingLabel={def.background ? "Starting…" : "Running…"}>
                    {def.background ? "Prepare in the background" : "Run report"}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setDraft(defaultsOf(def.filters));
                      setErrors({});
                    }}
                  >
                    Reset filters
                  </Button>
                </div>
              </form>
            </Panel>
          )}

          {search.job ? (
            !job ? (
              jobs.isPending ? (
                <Skeleton height={240} />
              ) : (
                <Banner tone="warning" title="That copy is no longer available." actions={<Button size="sm" onClick={() => setSearch({})}>Run it again</Button>}>
                  Files are kept for 7 days, only for the person who asked for them and the people a scheduled report was sent to.
                </Banner>
              )
            ) : job.status === "QUEUED" || job.status === "RUNNING" ? (
              <div className="mtb-card rpt-wait" aria-live="polite">
                <span className="rpt-pulse">
                  <Icon name="clock" size={24} />
                </span>
                <h2 className="m-0 text-title-3">Preparing {def.name}</h2>
                <p className="m-0 max-w-xl text-small text-ink-muted">{REPORT_BACKGROUND_NOTE}</p>
                <div className="mtb-meter mtb-meter-lg" role="progressbar" aria-valuenow={job.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${job.progress}% prepared`}>
                  <span style={{ width: `${job.progress}%` }} />
                </div>
                <span className="text-small text-ink-muted">{job.status === "QUEUED" ? "Waiting to start…" : `${job.progress}% · ${job.filterSummary}`}</span>
                <Link to="/reports" className={buttonClassName({ variant: "secondary", size: "sm" })}>
                  Keep working — open another report
                </Link>
              </div>
            ) : job.status === "FAILED" || job.status === "EXPIRED" ? (
              <Banner tone={job.status === "FAILED" ? "danger" : "warning"} title={job.status === "FAILED" ? "This report could not be prepared." : "This copy has expired."} actions={<Button size="sm" onClick={() => setSearch({})}>Run it again</Button>}>
                {job.error ?? "Files are kept for 7 days. Run the report again for a fresh copy."}
              </Banner>
            ) : jobResult.error ? (
              <LoadError what="The prepared report" error={jobResult.error} onRetry={() => void jobResult.refetch()} />
            ) : !result ? (
              <Skeleton height={300} />
            ) : (
              <>
                <Banner tone="success" icon="checkCircle" title={`Prepared ${timeText(job.readyAt ?? job.requestedAt)}.`} actions={<Button size="sm" onClick={() => setSearch({})}>Change filters</Button>}>
                  {job.filterSummary}. This copy is kept in Downloads until {job.expiresAt ? formatDate(job.expiresAt) : "next week"}.
                </Banner>
                <ResultView result={result} def={def} />
              </>
            )
          ) : !request ? (
            <div className="mtb-card">
              <EmptyState icon={def.background ? "clock" : "file"} title={def.background ? "Choose the filters, then prepare it" : "Choose the filters, then run the report"} description={def.background ? "It is prepared in the background; you can keep working and open it from the bell or Downloads." : "The report opens here, on screen, before you print or export it."} />
            </div>
          ) : run.error && !run.data ? (
            <Banner tone="danger" title="The report couldn't be run." actions={<Button size="sm" icon="refresh" onClick={() => void run.refetch()}>Try again</Button>}>
              {errorText(run.error)}
            </Banner>
          ) : !result ? (
            <div className="grid gap-3" aria-busy="true">
              <div className="rpt-summary">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} width={140} height={52} />
                ))}
              </div>
              <Skeleton height={360} />
            </div>
          ) : (
            <ResultView result={result} def={def} busy={run.isFetching} />
          )}
        </>
      )}

      {result && <ReportDocument result={result} landscape={def.paper === "A4_LANDSCAPE"} />}
      <ScheduleEditor open={scheduleOpen} onClose={() => setScheduleOpen(false)} schedule={null} preset={{ reportId: def.id, filters: draft }} />
    </ReportsShell>
  );
}

function FilterControl({ def, value, onChange, error, classFilter }: { def: ReportFilterDef; value: string; onChange: (v: string) => void; error: string | undefined; classFilter: string }) {
  const ctx = useCtx();
  const classes = useQuery(metaQueries.classes(ctx.campus));
  const todayIso = today();
  const errorProps = error ? { error } : {};
  const helpProps = def.help ? { help: def.help } : {};
  switch (def.kind) {
    case "date":
      return <DatePicker label={def.label} value={value || null} onValueChange={(v) => onChange(v ?? "")} today={todayIso} {...(def.allowFuture ? {} : { maxDate: todayIso })} {...helpProps} {...errorProps} />;
    case "dateRange": {
      const [from = "", to = ""] = value.split("|");
      return (
        <div className="grid gap-1.5" style={{ gridColumn: "span 2" }}>
          <div className="grid grid-cols-2 gap-2">
            <DatePicker label="From" value={from || null} onValueChange={(v) => onChange(`${v ?? ""}|${to}`)} today={todayIso} maxDate={todayIso} {...errorProps} />
            <DatePicker label="To" value={to || null} onValueChange={(v) => onChange(`${from}|${v ?? ""}`)} today={todayIso} maxDate={todayIso} />
          </div>
          <div className="flex flex-wrap gap-1">
            {quickRanges(todayIso, ctx.session).map(([label, v]) => (
              <button key={label} type="button" className="rpt-module" aria-pressed={value === v} onClick={() => onChange(v!)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      );
    }
    case "month":
      return <Select label={def.label} value={value} onChange={(e) => onChange(e.target.value)} options={def.options ?? []} {...errorProps} />;
    case "class":
      return <Select label={def.label} value={value} onChange={(e) => onChange(e.target.value)} options={[...(def.required ? [] : [{ value: "", label: "All classes" }]), ...(classes.data ?? []).map((c) => ({ value: c.short, label: c.name }))]} {...errorProps} />;
    case "section": {
      // The chosen class's sections; with no class chosen, every section name at the campus.
      const sections = classFilter ? (classes.data?.find((c) => c.short === classFilter)?.sections ?? []) : [...new Set((classes.data ?? []).flatMap((c) => c.sections))].sort();
      return <Select label={def.label} value={value} onChange={(e) => onChange(e.target.value)} options={[...(def.required ? [] : [{ value: "", label: "All sections" }]), ...sections.map((s) => ({ value: s, label: s }))]} {...errorProps} />;
    }
    case "classSection":
      return <Select label={def.label} value={value} onChange={(e) => onChange(e.target.value)} options={(classes.data ?? []).flatMap((c) => c.sections.map((s) => ({ value: `${c.short}-${s}`, label: `${c.short === "Prep" ? "Prep" : `Class ${c.short}`}-${s}` })))} {...errorProps} />;
    case "gender":
      return <Select label={def.label} value={value} onChange={(e) => onChange(e.target.value)} options={[{ value: "", label: "Everyone" }, { value: "F", label: "Girls" }, { value: "M", label: "Boys" }]} {...errorProps} />;
    case "select":
      return <Select label={def.label} value={value} onChange={(e) => onChange(e.target.value)} options={def.options ?? []} {...errorProps} />;
    case "number":
      return <Input label={def.label} inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))} {...helpProps} {...errorProps} />;
    case "text":
      return <Input label={def.label} mono value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} {...helpProps} {...errorProps} />;
  }
}

/**
 * Quick date ranges: this month and last month up to today, and the chosen session (1 April, as the server's
 * session start) up to today or the session's last day. Only ranges that end on or before today are offered.
 */
function quickRanges(t: IsoDate, session: number): Array<[string, string]> {
  const prev = prevMonthOf(t);
  const sessionFrom = `${session}-04-01`;
  const sessionEnd = `${session + 1}-03-31`;
  const sessionTo = sessionEnd < t ? sessionEnd : t;
  const out: Array<[string, string]> = [
    ["This month", `${monthStartOf(t)}|${t}`],
    ["Last month", `${prev.from}|${prev.to}`],
  ];
  if (sessionFrom <= t) out.push([sessionEnd < t ? `Session ${formatSession(session)}` : "This session", `${sessionFrom}|${sessionTo}`]);
  return out;
}

const DAY_CODE: Record<string, string> = { A: "text-danger-ink font-semibold", L: "text-info-ink", Lt: "text-warning-ink" };

function renderCell(c: ReportColumnDef, v: ReportCell) {
  // A blank column is left empty for ticks, signatures or marks written in by hand.
  if (c.kind === "blank") return <span className="rpt-blank" aria-hidden="true" />;
  if (v === null || v === undefined || v === "") return <span className="text-ink-subtle">—</span>;
  if (typeof v === "number") {
    if (c.kind === "money") return <Money value={v} />;
    if (c.kind === "percent") return <span className="mtb-num">{formatPercent(v)}</span>;
    return <span className="mtb-num">{c.kind === "count" ? formatCount(v) : v}</span>;
  }
  if (c.kind === "date") return <DateText value={v} />;
  if (c.kind === "mono") return <span className="mtb-mono">{v}</span>;
  if (c.kind === "status") return <StatusBadge status={statusTone(v)}>{v}</StatusBadge>;
  if (c.kind === "urdu") return <Urdu size="small">{v}</Urdu>;
  if (/^d\d\d$/.test(c.key)) return <span className={`rpt-code ${DAY_CODE[v] ?? "text-ink-muted"}`}>{v}</span>;
  return v;
}

const shortDay = (d: string) => formatDate(d).slice(0, 6).replace("-", " ");

function ResultView({ result, def, busy }: { result: ReportResult; def: ReportCatalogueItem; busy?: boolean }) {
  const [view, setView] = useState<"table" | "chart">("table");
  const [sort, setSort] = useState<SortState | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [find, setFind] = useState("");
  useEffect(() => setPage(1), [result, find, sort]);

  const rows = useMemo(() => {
    const q = find.trim().toLowerCase();
    type Row = Record<string, ReportCell> & { __id: number };
    let list: Row[] = result.rows.map((r, i) => ({ ...r, __id: i }) as Row);
    if (q) list = list.filter((r) => result.columns.some((c) => cellText(r[c.key] ?? null, c.kind).toLowerCase().includes(q)));
    if (sort) {
      const dir = sort.dir === "asc" ? 1 : -1;
      list = [...list].sort((a, b) => {
        const x = a[sort.key];
        const y = b[sort.key];
        if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
        return String(x ?? "").localeCompare(String(y ?? ""), "en", { numeric: true }) * dir;
      });
    }
    return list;
  }, [result, find, sort]);

  const columns: Array<Column<Record<string, ReportCell> & { __id: number }>> = result.columns.map((c) => ({
    key: c.key,
    header: c.label,
    sortable: true,
    ...(c.kind === "money" || c.kind === "count" || c.kind === "percent" ? { align: "right" as const } : {}),
    // Subtotal lines leave empty cells empty (no dash).
    render: (r) => (r[REPORT_SUBTOTAL_KEY] && (r[c.key] ?? "") === "" ? null : renderCell(c, r[c.key] ?? null)),
  }));
  const footer = result.totals
    ? Object.fromEntries(
        result.columns.map((c, i) => [c.key, c.key in result.totals! ? (c.kind === "money" ? <Money value={result.totals![c.key]!} /> : <span className="mtb-num">{formatCount(result.totals![c.key]!)}</span>) : i === 0 ? "Total" : ""]),
      )
    : undefined;

  const chart = result.chart;
  const chartRows = chart ? result.rows.filter((r) => typeof r[chart.y] === "number" && !r[REPORT_SUBTOTAL_KEY]).slice(0, chart.kind === "column" ? 30 : 120) : [];
  const yCol = chart ? result.columns.find((c) => c.key === chart.y) : undefined;
  const fmt = (v: number) => (yCol?.kind === "money" ? formatRs(v) : yCol?.kind === "percent" ? formatPercent(v) : formatCount(v));
  const axis = (v: number) => (yCol?.kind === "money" ? (v >= 100000 ? `${(v / 100000).toFixed(v % 100000 === 0 ? 0 : 1)} lakh` : formatCount(v)) : yCol?.kind === "percent" ? `${v}%` : formatCount(v));
  const totalsShown = result.columns.filter((c) => result.totals && c.key in result.totals).slice(0, 4);

  return (
    <Panel
      id="rpt-result"
      rise={1}
      title={result.title}
      description={result.subtitle}
      flush
      actions={
        chart && chartRows.length > 1 ? (
          <Segmented
            aria-label="Show as"
            value={view}
            onChange={(v) => setView(v as "table" | "chart")}
            options={[
              { value: "table", label: "Table" },
              { value: "chart", label: "Chart" },
            ]}
          />
        ) : undefined
      }
    >
      <div className="grid gap-4 p-5 pb-0" aria-busy={busy || undefined}>
        <div className="rpt-summary">
          <div className="rpt-chip mtb-slide-in">
            <span>Rows</span>
            <b>{formatCount(result.rows.length)}</b>
          </div>
          {totalsShown.map((c, i) => (
            <div key={c.key} className="rpt-chip mtb-slide-in" style={{ ["--i" as string]: i + 1 }}>
              <span>{c.label}</span>
              <b>{c.kind === "money" ? formatRs(result.totals![c.key]!) : formatCount(result.totals![c.key]!)}</b>
            </div>
          ))}
        </div>
        {view === "chart" && chart && yCol && (
          <div className="pb-4">
            {chart.kind === "area" ? (
              <AreaChart
                data={chartRows}
                value={(r) => Number(r[chart.y])}
                axisLabel={(r) => shortDay(String(r[chart.x]))}
                formatAxis={axis}
                label={chart.label}
                describe={(r) => `${formatDate(String(r[chart.x]))}: ${fmt(Number(r[chart.y]))}`}
                tooltip={(r) => (
                  <>
                    <div className="mtb-chart-tip-title">{formatDate(String(r[chart.x]))}</div>
                    <div className="mtb-chart-tip-value">{fmt(Number(r[chart.y]))}</div>
                  </>
                )}
              />
            ) : (
              <ColumnChart
                data={chartRows}
                value={(r) => Number(r[chart.y])}
                axisLabel={(r) => String(r[chart.x]).replace(/^Class /, "").slice(0, 10)}
                formatAxis={axis}
                label={chart.label}
                valueLabel={yCol.label}
                describe={(r) => `${r[chart.x]}: ${fmt(Number(r[chart.y]))}`}
                tooltip={(r) => (
                  <>
                    <div className="mtb-chart-tip-title">{String(r[chart.x])}</div>
                    <div className="mtb-chart-tip-value">{fmt(Number(r[chart.y]))}</div>
                  </>
                )}
              />
            )}
            {result.rows.length > chartRows.length && <p className="m-0 mt-2 text-small text-ink-muted">The chart shows the first {chartRows.length}. The table has all {formatCount(result.rows.length)}.</p>}
          </div>
        )}
      </div>
      {view === "table" && (
        <div className="rpt-table-wrap">
          <DataTable
            caption={result.title}
            columns={columns}
            rows={rows.slice((page - 1) * PAGE, page * PAGE)}
            rowKey="__id"
            rowClassName={(r) => (r[REPORT_SUBTOTAL_KEY] ? "rpt-subtotal" : undefined)}
            density="dense"
            stickyHeader
            maxHeight={620}
            sort={sort}
            onSortChange={setSort}
            {...(footer && !find ? { footer } : {})}
            empty={<EmptyState icon="file" title={find ? "No rows match" : "Nothing to show"} description={find ? "Clear the search." : (result.notes?.[0] ?? "No records for these filters. Try a wider date range or another class.")} />}
            toolbar={
              <div className="w-72">
                <Input aria-label="Find in this report" icon="search" placeholder="Find a name, number or class" value={find} onChange={(e) => setFind(e.target.value)} />
              </div>
            }
            pagination={rows.length > PAGE ? <Pagination page={page} pageSize={PAGE} total={rows.length} onPageChange={setPage} /> : undefined}
          />
        </div>
      )}
      {(result.notes?.length ?? 0) > 0 && (
        <ul className="m-0 grid list-none gap-1 px-5 py-3 text-small text-ink-muted">
          {result.notes!.map((n) => (
            <li key={n}>· {n}</li>
          ))}
        </ul>
      )}
      <p className="m-0 px-5 pb-4 text-small text-ink-subtle">
        Prepared by {result.generatedBy}, {timeText(result.generatedAt)} · {def.paper === "A4_LANDSCAPE" ? "Prints on A4 landscape" : "Prints on A4"}
      </p>
    </Panel>
  );
}
