import { REPORT_MODULES, reportsApi, reportsQueries, type ReportCatalogue, type ReportCatalogueItem, type ReportModule } from "@mtb/api";
import { formatCount } from "@mtb/domain";
import { AnimatedNumber, EmptyState, Icon, IconButton, Input, Segmented, Skeleton, StatCard, StatusBadge, Tooltip, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useCtx } from "../../app/session";
import { errorText, LoadError, MODULE_ICON, moduleLabel, ReportsShell, slide, timeText } from "./shell";

export interface CatalogueSearch {
  q?: string;
  module?: ReportModule;
  show?: "fav" | "recent" | "new" | "fixed";
}

/** /reports — every report across modules, searchable, with favourites; each opens on screen first. */
export function CataloguePage({ search, setSearch }: { search: CatalogueSearch; setSearch: (next: CatalogueSearch) => void }) {
  const ctx = useCtx();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const cat = useQuery(reportsQueries.catalogue(ctx));
  const jobs = useQuery(reportsQueries.jobs(ctx));
  const schedules = useQuery(reportsQueries.schedules(ctx));
  const key = reportsQueries.catalogue(ctx).queryKey;

  const fav = useMutation({
    mutationFn: (r: ReportCatalogueItem) => reportsApi.setFavourite(r.id, !r.favourite),
    onMutate: async (r) => {
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<ReportCatalogue>(key);
      if (prev) queryClient.setQueryData<ReportCatalogue>(key, { ...prev, reports: prev.reports.map((x) => (x.id === r.id ? { ...x, favourite: !r.favourite } : x)) });
      return { prev };
    },
    onError: (e, _r, c) => {
      if (c?.prev) queryClient.setQueryData(key, c.prev);
      toast({ tone: "danger", title: "Favourites not saved", message: errorText(e) });
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: key }),
  });

  const all = cat.data?.reports ?? [];
  const q = (search.q ?? "").trim().toLowerCase();
  const matches = (r: ReportCatalogueItem) =>
    (!search.module || r.module === search.module) &&
    (search.show !== "fav" || r.favourite) &&
    (search.show !== "recent" || Boolean(r.lastRunAt)) &&
    (search.show !== "new" || Boolean(r.isNew)) &&
    (search.show !== "fixed" || Boolean(r.improvement)) &&
    (!q || `${r.name} ${r.description} ${r.replaces.join(" ")} ${r.tags.join(" ")} ${moduleLabel(r.module)}`.toLowerCase().includes(q));
  const rows = all.filter(matches).sort((a, b) => (search.show === "recent" ? (b.lastRunAt ?? "").localeCompare(a.lastRunAt ?? "") : 0));
  const byModule = REPORT_MODULES.map((m) => ({ m, list: rows.filter((r) => r.module === m) })).filter((g) => g.list.length);
  const counts = new Map(REPORT_MODULES.map((m) => [m, all.filter((r) => r.module === m).length]));
  const flat = Boolean(q) || Boolean(search.module) || Boolean(search.show);
  const readyJobs = (jobs.data ?? []).filter((j) => j.status === "READY").length;
  const legacyCount = all.reduce((s, r) => s + r.replaces.length, 0);

  const card = (r: ReportCatalogueItem, i: number) => (
    <article key={r.id} className="rpt-card mtb-slide-in" style={slide(i)}>
      <div className="rpt-card-head">
        <span className="rpt-card-icon" aria-hidden="true">
          <Icon name={MODULE_ICON[r.module]} size={18} />
        </span>
        <div className="grid min-w-0 gap-0.5">
          <h3 className="rpt-card-title">
            <Link to="/reports/$reportId" params={{ reportId: r.id }}>
              {r.name}
            </Link>
          </h3>
          <span className="text-small text-ink-subtle">{moduleLabel(r.module)}</span>
        </div>
        <Tooltip content={r.favourite ? "Remove from favourites" : "Add to favourites"}>
          <IconButton icon="star" label={r.favourite ? `Remove ${r.name} from favourites` : `Add ${r.name} to favourites`} className="rpt-star" aria-pressed={r.favourite} onClick={() => fav.mutate(r)} />
        </Tooltip>
      </div>
      <div className="grid content-start gap-1.5">
        <p className="rpt-card-desc">{r.description}</p>
        {r.replaces.length > 0 && (
          <p className="rpt-replaces m-0">
            Replaces {r.replaces.slice(0, 2).join(", ")}
            {r.replaces.length > 2 ? ` and ${r.replaces.length - 2} more` : ""}
          </p>
        )}
      </div>
      <div className="rpt-card-foot">
        {r.isNew && (
          <StatusBadge status="brand" dot={false}>
            New
          </StatusBadge>
        )}
        {r.improvement && (
          <StatusBadge status="success" dot={false}>
            Fixed
          </StatusBadge>
        )}
        {r.background && (
          <StatusBadge status="info" dot={false}>
            Runs in background
          </StatusBadge>
        )}
        <span>{r.formats.map((f) => (f === "EXCEL" ? "Excel" : "PDF")).join(" · ")}</span>
        {r.lastRunAt && <span>· last run {timeText(r.lastRunAt)}</span>}
      </div>
    </article>
  );

  return (
    <ReportsShell title="Reports">
      {cat.error && !cat.data ? (
        <LoadError what="The report list" error={cat.error} onRetry={() => void cat.refetch()} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="mtb-rise" style={slide(0)}>
              <StatCard label="Reports you can open" icon="file" loading={!cat.data} value={cat.data ? <AnimatedNumber value={all.length} format={formatCount} /> : ""} foot={cat.data ? `Replacing ${formatCount(legacyCount)} screens of the old software` : ""} />
            </div>
            <div className="mtb-rise" style={slide(1)}>
              <StatCard label="Favourites" icon="star" tone="warning" loading={!cat.data} value={cat.data ? <AnimatedNumber value={all.filter((r) => r.favourite).length} format={formatCount} /> : ""} foot="Click the star on any report" {...(cat.data ? { onClick: () => setSearch({ show: "fav" }) } : {})} />
            </div>
            <div className="mtb-rise" style={slide(2)}>
              <StatCard label="Ready to download" icon="download" tone="info" loading={!jobs.data} value={jobs.data ? <AnimatedNumber value={readyJobs} format={formatCount} /> : ""} foot="Kept for 7 days" {...(jobs.data ? { onClick: () => void navigate({ to: "/reports/jobs" }) } : {})} />
            </div>
            <div className="mtb-rise" style={slide(3)}>
              <StatCard label="Scheduled reports" icon="clock" tone="neutral" loading={!schedules.data} value={schedules.data ? <AnimatedNumber value={schedules.data.filter((s) => s.active).length} format={formatCount} /> : ""} foot="Sent to staff automatically" {...(schedules.data ? { onClick: () => void navigate({ to: "/reports/scheduled" }) } : {})} />
            </div>
          </div>

          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="w-80 max-w-full">
                <Input aria-label="Search reports" icon="search" placeholder="Search: defaulters, salary, attendance, old report name…" value={search.q ?? ""} onChange={(e) => setSearch({ ...search, q: e.target.value || undefined } as CatalogueSearch)} />
              </div>
              <Segmented
                aria-label="Show"
                value={search.show ?? ""}
                onChange={(v) => setSearch({ ...search, show: (v || undefined) as CatalogueSearch["show"] } as CatalogueSearch)}
                options={[
                  { value: "", label: "All" },
                  { value: "fav", label: "Favourites" },
                  { value: "recent", label: "Run recently" },
                  { value: "fixed", label: "Fixed" },
                  { value: "new", label: "New" },
                ]}
              />
            </div>
            <div className="rpt-modules" role="group" aria-label="Module">
              <button type="button" className="rpt-module" aria-pressed={!search.module} onClick={() => setSearch({ ...search, module: undefined } as CatalogueSearch)}>
                All modules <span className="rpt-module-n">{all.length}</span>
              </button>
              {REPORT_MODULES.filter((m) => counts.get(m)).map((m) => (
                <button key={m} type="button" className="rpt-module" aria-pressed={search.module === m} onClick={() => setSearch({ ...search, module: search.module === m ? undefined : m } as CatalogueSearch)}>
                  <Icon name={MODULE_ICON[m]} size={14} />
                  {moduleLabel(m)} <span className="rpt-module-n">{counts.get(m)}</span>
                </button>
              ))}
            </div>
          </div>

          {cat.isPending ? (
            <div className="rpt-grid">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} height={170} />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="mtb-card">
              <EmptyState
                icon="search"
                title={search.show === "fav" ? "No favourites yet" : search.show === "recent" ? "You haven't run a report yet" : "No report matches"}
                description={search.show === "fav" ? "Click the star on a report to keep it here." : "Try another word — the old report names work too — or clear the filters."}
              />
            </div>
          ) : flat ? (
            <div className="rpt-grid">{rows.map(card)}</div>
          ) : (
            <div className="grid gap-6">
              {byModule.map((g, gi) => (
                <section key={g.m} className="rpt-group mtb-rise" style={slide(gi + 4)} aria-labelledby={`rg-${g.m}`}>
                  <h2 id={`rg-${g.m}`} className="rpt-group-head">
                    <Icon name={MODULE_ICON[g.m]} size={18} /> {moduleLabel(g.m)} <span>{g.list.length}</span>
                  </h2>
                  <div className="rpt-grid">{g.list.map(card)}</div>
                </section>
              ))}
            </div>
          )}
          {cat.data && cat.data.hiddenCount > 0 && (
            <p className="m-0 text-small text-ink-muted">
              {formatCount(cat.data.hiddenCount)} more {cat.data.hiddenCount === 1 ? "report needs" : "reports need"} permissions your role doesn't have (for example salaries or accounts). Ask your admin if you need them.
            </p>
          )}
        </>
      )}
    </ReportsShell>
  );
}
