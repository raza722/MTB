import { TRANSPORT_DOC_LABEL, transportQueries, type TransportOverview } from "@mtb/api";
import { formatCount, formatDate, formatRs } from "@mtb/domain";
import { AnimatedNumber, buttonClassName, ColumnChart, DataTable, EmptyState, Icon, Panel, Skeleton, StatCard } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { LoadError, monthShort, opsToday, slide, ViewToggle } from "../library/common";
import { AlertBadge, Load, TransportShell } from "./shared";

function RouteLoad({ o }: { o: TransportOverview }) {
  const [view, setView] = useState("chart");
  return (
    <Panel id="trn-load" rise={1} title="Seats taken on each route" description="Riders against the seats in the route's vehicle." actions={<ViewToggle value={view} onChange={setView} label="Show route load as" />}>
      {o.load.length === 0 ? (
        <EmptyState icon="mapPin" title="No routes yet" />
      ) : view === "chart" ? (
        <ColumnChart
          data={o.load}
          value={(d) => d.riders}
          target={(d) => d.capacity}
          valueLabel="Riders"
          targetLabel="Seats"
          axisLabel={(d) => d.code}
          formatAxis={(v) => formatCount(v)}
          tooltip={(d) => (
            <>
              <div className="mtb-chart-tip-title">
                {d.code} · {d.name}
              </div>
              <div className="mtb-chart-tip-value">
                {d.riders} of {d.capacity} seats
              </div>
              <div className="mtb-chart-tip-row">
                <span>Free</span>
                <span>{Math.max(0, d.capacity - d.riders)}</span>
              </div>
            </>
          )}
          describe={(d) => `${d.code} ${d.name}: ${d.riders} riders, ${d.capacity} seats`}
          label="Riders and seats per route"
          height={240}
        />
      ) : (
        <DataTable
          caption="Riders and seats per route"
          rowKey="routeId"
          rows={o.load}
          density="dense"
          columns={[
            { key: "code", header: "Route", render: (d) => `${d.code} · ${d.name}` },
            { key: "load", header: "Seats", render: (d) => <Load r={d} /> },
            { key: "free", header: "Free", align: "right", render: (d) => <span className="mtb-num">{Math.max(0, d.capacity - d.riders)}</span> },
          ]}
        />
      )}
    </Panel>
  );
}

export function TransportOverviewPage() {
  const ctx = useCtx();
  const navigate = useNavigate();
  const readOnly = useReadOnly();
  const canManage = useCan("transport.manage") && !readOnly && ctx.campus !== "ALL";
  const q = useQuery(transportQueries.overview(ctx));
  const o = q.data;
  const go = (to: string) => void navigate({ to: to as never });
  const maxFuel = Math.max(1, ...(o?.fuel.map((f) => f.amount) ?? [1]));
  const thisMonth = opsToday().slice(0, 7);
  return (
    <TransportShell
      title="Transport"
      actions={
        canManage ? (
          <>
            <Link to="/transport/routes" className={buttonClassName({})}>
              <Icon name="printer" size={16} />
              Route sheets
            </Link>
            <Link to="/transport/riders" search={{ assign: 1 } as never} className={buttonClassName({ variant: "primary" })}>
              <Icon name="plus" size={16} />
              Assign a student
            </Link>
          </>
        ) : undefined
      }
    >
      {q.isError && <LoadError what="The transport summary" error={q.error} onRetry={() => void q.refetch()} />}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="mtb-rise" style={slide(0)}>
          <StatCard loading={!o} label="Riding today" icon="students" value={o && <AnimatedNumber value={o.riders} format={formatCount} />} foot={o && `${o.routes} routes · ${o.activeVehicles} vehicles on the road`} onClick={() => go("/transport/riders")} />
        </div>
        <div className="mtb-rise" style={slide(1)}>
          <StatCard loading={!o} label="Free seats" icon="layers" value={o && <AnimatedNumber value={Math.max(0, o.seats - o.riders)} format={formatCount} />} foot={o && (o.fullRoutes ? `${o.fullRoutes} ${o.fullRoutes === 1 ? "route is" : "routes are"} full` : `of ${formatCount(o.seats)} seats`)} tone={o && o.fullRoutes ? "warning" : undefined} meter={o ? Math.round((o.riders / Math.max(1, o.seats)) * 100) : undefined} meterLabel="Seats taken" onClick={() => go("/transport/routes")} />
        </div>
        <div className="mtb-rise" style={slide(2)}>
          <StatCard loading={!o} label="Transport fee a month" icon="fees" value={o && <AnimatedNumber value={o.monthlyBilling} format={formatRs} />} foot="Charged to students with the monthly fee" />
        </div>
        <div className="mtb-rise" style={slide(3)}>
          <StatCard loading={!o} label="Vehicle papers due" icon="alert" tone={o && o.alerts.some((a) => a.days < 0) ? "danger" : o && o.alerts.length ? "warning" : undefined} value={o && <AnimatedNumber value={o.alerts.length} format={formatCount} />} foot="Fitness, insurance, licence within 30 days" onClick={() => go("/transport/vehicles")} />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {o ? <RouteLoad o={o} /> : <Skeleton height={320} />}
        <Panel id="trn-alerts" rise={2} title="Papers to renew" description="A vehicle with expired papers should not carry students." flush>
          {!o ? (
            <Skeleton height={200} />
          ) : o.alerts.length === 0 ? (
            <EmptyState icon="checkCircle" title="Every vehicle's papers are in date" />
          ) : (
            <ul className="m-0 list-none p-0">
              {o.alerts.map((a, i) => (
                <li key={`${a.vehicleId}-${a.kind}`} className="mtb-slide-in grid gap-1 border-b border-border px-5 py-3 last:border-b-0" style={slide(i)}>
                  <span className="flex items-center justify-between gap-3">
                    <span className="mtb-mono font-medium">{a.regNo}</span>
                    <AlertBadge a={a} />
                  </span>
                  <span className="text-small text-ink-muted">
                    {TRANSPORT_DOC_LABEL[a.kind]} · {a.days < 0 ? "expired" : "expires"} {formatDate(a.expiresOn)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel id="trn-fuel" rise={3} title="Fuel" description={o ? `${formatRs(o.fuelLast30)} in the last 30 days · ${o.tripsToday} trips logged today` : "Spending per month."}>
        {!o ? (
          <Skeleton height={120} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-4">
            {o.fuel.map((f, i) => (
              <div key={f.month} className="mtb-slide-in grid gap-1" style={slide(i)}>
                <span className="text-small text-ink-muted">
                  {monthShort(f.month)} {f.month.slice(0, 4)}
                  {f.month === thisMonth ? " (so far)" : ""}
                </span>
                <span className="mtb-num font-semibold">{formatRs(f.amount)}</span>
                <span className="text-small text-ink-muted">{formatCount(f.litres)} litres</span>
                <div className="ops-meter" aria-hidden="true">
                  <span style={{ width: `${Math.round((f.amount / maxFuel) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </TransportShell>
  );
}
