import { libraryQueries, type LibraryActivity, type LibraryOverview } from "@mtb/api";
import { formatCount, formatDate, formatDateTime, formatRs } from "@mtb/domain";
import { AnimatedNumber, buttonClassName, ColumnChart, DataTable, EmptyState, Icon, Panel, SegmentedBar, Skeleton, StatCard, type IconName } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { LoadError, shortDate, slide, ViewToggle } from "./common";
import { LibraryShell } from "./shared";

const ACTIVITY_ICON: Record<LibraryActivity["kind"], IconName> = { ISSUE: "arrowRight", RETURN: "arrowLeft", LOST: "alert", ADDED: "plus", COUNT: "checkSquare", REMINDER: "send" };

function Circulation({ o }: { o: LibraryOverview }) {
  const [view, setView] = useState("chart");
  return (
    <Panel id="lib-circulation" rise={1} title="Books going out and coming back" description="Issues and returns per week, last ten weeks." actions={<ViewToggle value={view} onChange={setView} label="Show circulation as" />}>
      {view === "chart" ? (
        <ColumnChart
          data={o.byWeek}
          value={(d) => d.issued}
          target={(d) => d.returned}
          valueLabel="Issued"
          targetLabel="Returned"
          axisLabel={(d) => shortDate(d.weekStart)}
          formatAxis={(v) => formatCount(v)}
          tooltip={(d) => (
            <>
              <div className="mtb-chart-tip-title">Week of {formatDate(d.weekStart)}</div>
              <div className="mtb-chart-tip-row">
                <span>Issued</span>
                <span>{d.issued}</span>
              </div>
              <div className="mtb-chart-tip-row">
                <span>Returned</span>
                <span>{d.returned}</span>
              </div>
            </>
          )}
          describe={(d) => `Week of ${formatDate(d.weekStart)}: ${d.issued} issued, ${d.returned} returned`}
          label="Books issued and returned per week"
          height={230}
        />
      ) : (
        <DataTable
          caption="Books issued and returned per week"
          rowKey="weekStart"
          rows={[...o.byWeek].reverse()}
          density="dense"
          columns={[
            { key: "weekStart", header: "Week of", render: (d) => formatDate(d.weekStart) },
            { key: "issued", header: "Issued", align: "right", render: (d) => <span className="mtb-num">{d.issued}</span> },
            { key: "returned", header: "Returned", align: "right", render: (d) => <span className="mtb-num">{d.returned}</span> },
          ]}
        />
      )}
    </Panel>
  );
}

export function LibraryOverviewPage() {
  const ctx = useCtx();
  const navigate = useNavigate();
  const readOnly = useReadOnly();
  const canManage = useCan("library.manage");
  const q = useQuery(libraryQueries.overview(ctx));
  const o = q.data;
  const go = (to: string) => void navigate({ to: to as never });

  return (
    <LibraryShell
      title="Library"
      actions={
        canManage && !readOnly && ctx.campus !== "ALL" ? (
          <Link to="/library/desk" className={buttonClassName({ variant: "primary" })}>
            <Icon name="refresh" size={16} />
            Issue or return a book
          </Link>
        ) : undefined
      }
    >
      {q.isError && <LoadError what="The library summary" error={q.error} onRetry={() => void q.refetch()} />}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="mtb-rise" style={slide(0)}>
          <StatCard loading={!o} label="Books in the catalogue" icon="book" value={o && <AnimatedNumber value={o.copies} format={formatCount} />} foot={o && `${formatCount(o.titles)} titles · ${formatCount(o.available)} on the shelves`} />
        </div>
        <div className="mtb-rise" style={slide(1)}>
          <StatCard loading={!o} label="On loan now" icon="arrowRight" tone="info" value={o && <AnimatedNumber value={o.onLoan} format={formatCount} />} foot={o && `${o.dueToday} due back today`} onClick={() => go("/library/loans")} />
        </div>
        <div className="mtb-rise" style={slide(2)}>
          <StatCard loading={!o} label="Overdue" icon="clock" tone={o && o.overdue > 0 ? "danger" : undefined} value={o && <AnimatedNumber value={o.overdue} format={formatCount} />} foot="Remind families by SMS" onClick={() => go("/library/overdue")} />
        </div>
        <div className="mtb-rise" style={slide(3)}>
          <StatCard loading={!o} label="Fines in the last 30 days" icon="fees" value={o && <AnimatedNumber value={o.finesLast30} format={formatRs} />} foot={o && `${o.issuedLast30} issued · ${o.returnedLast30} returned`} />
        </div>
      </div>

      {o?.openCount && (
        <Panel id="lib-count-open" rise={0} title="A stock count is in progress" description={`${o.openCount.name}: ${o.openCount.scanned} of ${o.openCount.expected} expected copies scanned.`} actions={<Link to={"/library/counts/$countId" as never} params={{ countId: o.openCount.id } as never} className={buttonClassName({ size: "sm" })}>Continue the count</Link>}>
          <div className="ops-meter" role="img" aria-label={`${o.openCount.scanned} of ${o.openCount.expected} scanned`}>
            <span style={{ width: `${Math.min(100, Math.round((o.openCount.scanned / Math.max(1, o.openCount.expected)) * 100))}%` }} />
          </div>
        </Panel>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {o ? <Circulation o={o} /> : <Skeleton height={300} />}
        <Panel id="lib-shelves" rise={2} title="Where the books are" description="Every copy at this campus, by what it is doing now.">
          {!o ? (
            <Skeleton height={200} />
          ) : (
            <div className="grid gap-5">
              <SegmentedBar
                label="Copies"
                format={formatCount}
                segments={[
                  { key: "shelf", label: "On the shelves", value: o.available, color: "var(--status-paid)" },
                  { key: "loan", label: "On loan", value: o.onLoan, color: "var(--chart-2)" },
                  { key: "out", label: "Missing, lost or damaged", value: o.outOfUse, color: "var(--status-overdue)" },
                ]}
              />
              <ul className="m-0 grid list-none gap-1 p-0 text-small">
                {[
                  ["On the shelves", o.available, "var(--status-paid)"],
                  ["On loan", o.onLoan, "var(--chart-2)"],
                  ["Missing, lost or damaged", o.outOfUse, "var(--status-overdue)"],
                ].map(([label, value, color]) => (
                  <li key={String(label)} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2">
                      <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: String(color) }} />
                      {label}
                    </span>
                    <span className="mtb-num">{formatCount(Number(value))}</span>
                  </li>
                ))}
              </ul>
              <div className="grid gap-2">
                <h3 className="m-0 text-small font-semibold text-ink-muted">By subject</h3>
                {o.byCategory.map((c, i) => (
                  <div key={c.name} className="mtb-slide-in grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1" style={slide(i)}>
                    <span className="truncate text-small">{c.name}</span>
                    <span className="mtb-num text-small text-ink-muted">
                      {c.onLoan} of {c.copies} out
                    </span>
                    <div className="col-span-2 ops-meter" aria-hidden="true">
                      <span style={{ width: `${Math.round((c.copies / Math.max(1, o.copies)) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>
      </div>

      <Panel id="lib-recent" rise={3} title="Recent activity" description="Issues, returns, reminders and counts at the desk.">
        {!o ? (
          <Skeleton height={160} />
        ) : o.recent.length === 0 ? (
          <EmptyState icon="inbox" title="Nothing yet" description="Issues and returns show here as they happen." />
        ) : (
          <ul className="m-0 grid list-none gap-0 p-0">
            {o.recent.map((a, i) => (
              <li key={a.id} className="mtb-slide-in flex items-start gap-3 border-b border-border py-2.5 last:border-b-0" style={slide(i)}>
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-content-center rounded-full bg-surface-sunken text-ink-muted">
                  <Icon name={ACTIVITY_ICON[a.kind]} size={14} />
                </span>
                <span className="grid min-w-0 flex-1">
                  <span>{a.text}</span>
                  <span className="text-small text-ink-muted">
                    {formatDateTime(a.at)} · {a.by}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </LibraryShell>
  );
}
