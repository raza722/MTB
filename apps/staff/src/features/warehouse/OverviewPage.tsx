import { WAREHOUSE_MOVEMENT_LABEL, warehouseQueries, type WarehouseOverview } from "@mtb/api";
import { formatCount, formatDateTime, formatLakh, formatRs } from "@mtb/domain";
import { AnimatedNumber, Banner, buttonClassName, ColumnChart, DataTable, EmptyState, Icon, Panel, Skeleton, StatCard } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { LoadError, monthShort, opsToday, slide, ViewToggle } from "../library/common";
import { StockBadge, WarehouseShell } from "./shared";

const lakhTick = (v: number) => (v === 0 ? "0" : v >= 100_000 ? `${(v / 100_000).toFixed(1).replace(/\.0$/, "")} lakh` : `${Math.round(v / 1000)}k`);

/** "2026-11" → "November" */
const monthLong = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString("en-GB", { month: "long", timeZone: "UTC" });

function MoneyByMonth({ o }: { o: WarehouseOverview }) {
  const [view, setView] = useState("chart");
  const thisMonth = opsToday().slice(0, 7);
  return (
    <Panel id="wh-months" rise={1} title="Stock received and issued" description="Value per month this session, at cost." actions={<ViewToggle value={view} onChange={setView} label="Show stock movement as" />}>
      {view === "chart" ? (
        <ColumnChart
          data={o.byMonth}
          value={(d) => d.issued}
          target={(d) => d.received}
          valueLabel="Issued to departments"
          targetLabel="Received from suppliers"
          partial={(d) => d.month === thisMonth}
          partialLabel={`${monthLong(thisMonth)} so far`}
          axisLabel={(d) => monthShort(d.month)}
          formatAxis={lakhTick}
          tooltip={(d) => (
            <>
              <div className="mtb-chart-tip-title">{monthShort(d.month)} {d.month.slice(0, 4)}</div>
              <div className="mtb-chart-tip-row">
                <span>Issued</span>
                <span>{formatRs(d.issued)}</span>
              </div>
              <div className="mtb-chart-tip-row">
                <span>Received</span>
                <span>{formatRs(d.received)}</span>
              </div>
            </>
          )}
          describe={(d) => `${monthShort(d.month)}: issued ${formatRs(d.issued)}, received ${formatRs(d.received)}`}
          label="Stock value issued and received per month"
          height={240}
        />
      ) : (
        <DataTable
          caption="Stock value issued and received per month"
          rowKey="month"
          rows={o.byMonth}
          density="dense"
          columns={[
            { key: "month", header: "Month", render: (d) => `${monthShort(d.month)} ${d.month.slice(0, 4)}` },
            { key: "received", header: "Received", align: "right", render: (d) => <span className="mtb-num">{formatRs(d.received)}</span> },
            { key: "issued", header: "Issued", align: "right", render: (d) => <span className="mtb-num">{formatRs(d.issued)}</span> },
          ]}
        />
      )}
    </Panel>
  );
}

export function WarehouseOverviewPage() {
  const ctx = useCtx();
  const navigate = useNavigate();
  const readOnly = useReadOnly();
  const canManage = useCan("warehouse.manage") && !readOnly && ctx.campus !== "ALL";
  const canApprove = useCan("approvals.decide");
  const q = useQuery(warehouseQueries.overview(ctx));
  const o = q.data;
  const go = (to: string, search: Record<string, string> = {}) => void navigate({ to: to as never, search: search as never });
  const maxDept = Math.max(1, ...(o?.byDepartment.map((d) => d.value) ?? [1]));

  return (
    <WarehouseShell
      title="Warehouse"
      actions={
        canManage ? (
          <>
            <Link to="/warehouse/receive" search={{ new: 1 } as never} className={buttonClassName({})}>
              <Icon name="download" size={16} />
              Receive goods
            </Link>
            <Link to="/warehouse/issue" search={{ new: 1 } as never} className={buttonClassName({ variant: "primary" })}>
              <Icon name="upload" size={16} />
              Issue stock
            </Link>
          </>
        ) : undefined
      }
    >
      {q.isError && <LoadError what="The warehouse summary" error={q.error} onRetry={() => void q.refetch()} />}
      {o && o.countsAwaitingApproval > 0 && canApprove && (
        <Banner
          tone="warning"
          icon="checkSquare"
          title={`${o.countsAwaitingApproval} stock ${o.countsAwaitingApproval === 1 ? "count is" : "counts are"} waiting for your approval.`}
          actions={
            <Link to="/warehouse/counts" className={buttonClassName({ size: "sm" })}>
              Review
            </Link>
          }
        >
          Stock figures change only after a second person approves the difference.
        </Banner>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="mtb-rise" style={slide(0)}>
          <StatCard loading={!o} label="Stock in the store" icon="warehouse" value={o && <AnimatedNumber value={o.stockValue} format={formatRs} />} foot={o && `${formatCount(o.items)} items · at average cost`} onClick={() => go("/warehouse/stock")} />
        </div>
        <div className="mtb-rise" style={slide(1)}>
          <StatCard loading={!o} label="Low or out of stock" icon="alert" tone={o && o.outOfStock > 0 ? "danger" : o && o.lowStock > 0 ? "warning" : undefined} value={o && <AnimatedNumber value={o.lowStock + o.outOfStock} format={formatCount} />} foot={o && `${o.outOfStock} out · ${o.lowStock} below reorder level`} onClick={() => go("/warehouse/stock", { status: "LOW" })} />
        </div>
        <div className="mtb-rise" style={slide(2)}>
          <StatCard loading={!o} label="Requests waiting" icon="inbox" tone={o && o.openRequests > 0 ? "info" : undefined} value={o && <AnimatedNumber value={o.openRequests} format={formatCount} />} foot="From departments and classes" onClick={() => go("/warehouse/issue", { tab: "requests" })} />
        </div>
        <div className="mtb-rise" style={slide(3)}>
          <StatCard loading={!o} label="Issued in the last 30 days" icon="upload" value={o && <AnimatedNumber value={o.issuedLast30} format={formatRs} />} foot={o && `Received ${formatLakh(o.receivedLast30)} · shop today ${formatRs(o.shopToday)}`} />
        </div>
      </div>

      {o && ctx.campus === "ALL" && (
        <Panel id="wh-campus" rise={0} title="Stock at each campus" description="Value in each campus store at average cost, and items running low." flush>
          <DataTable
            caption="Stock at each campus"
            rowKey="campus"
            rows={o.byCampus}
            density="dense"
            columns={[
              { key: "name", header: "Campus", render: (c) => <span className="font-medium">{c.name}</span> },
              { key: "items", header: "Items", align: "right", render: (c) => <span className="mtb-num">{formatCount(c.items)}</span> },
              { key: "low", header: "Running low", align: "right", render: (c) => <span className={`mtb-num ${c.low ? "font-medium text-warning-ink" : ""}`}>{formatCount(c.low)}</span> },
              { key: "value", header: "Stock value", align: "right", render: (c) => <span className="mtb-num font-medium">{formatRs(c.value)}</span> },
            ]}
            footer={{ name: <span className="font-semibold">All campuses</span>, value: <span className="mtb-num font-semibold">{formatRs(o.stockValue)}</span> }}
          />
        </Panel>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {o ? <MoneyByMonth o={o} /> : <Skeleton height={320} />}
        <Panel
          id="wh-low"
          rise={2}
          title="Running low"
          description="At or below the reorder level. Receive more before they run out."
          actions={
            <Link to="/warehouse/stock" search={{ status: "LOW" } as never} className="text-small font-medium text-brand-ink underline-offset-2 hover:underline">
              All low items
            </Link>
          }
          flush
        >
          {!o ? (
            <Skeleton height={200} />
          ) : o.lowItems.length === 0 ? (
            <EmptyState icon="checkCircle" title="Nothing is running low" />
          ) : (
            <ul className="m-0 list-none p-0">
              {o.lowItems.map((it, i) => (
                <li key={it.id} className="mtb-slide-in flex items-center gap-3 border-b border-border px-5 py-2.5 last:border-b-0" style={slide(i)}>
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate font-medium">{it.name}</span>
                    <span className="text-small text-ink-muted">
                      {formatCount(it.onHand)} left · reorder at {formatCount(it.reorderLevel)}
                    </span>
                  </span>
                  <StockBadge status={it.status} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel id="wh-dept" rise={3} title="Issued by department" description="Value at cost this session, after returns.">
          {!o ? (
            <Skeleton height={200} />
          ) : o.byDepartment.length === 0 ? (
            <EmptyState icon="inbox" title="Nothing issued this session" />
          ) : (
            <div className="grid gap-3">
              {o.byDepartment.map((d, i) => (
                <div key={d.name} className="mtb-slide-in grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1" style={slide(i)}>
                  <span className="truncate text-small">{d.name}</span>
                  <span className="mtb-num text-small">{formatRs(d.value)}</span>
                  <div className="col-span-2 ops-meter" aria-hidden="true">
                    <span style={{ width: `${Math.round((d.value / maxDept) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel id="wh-recent" rise={4} title="Latest stock movements" description="Every change is a row in the stock ledger; none is ever overwritten." flush>
          {!o ? (
            <Skeleton height={200} />
          ) : (
            <ul className="m-0 list-none p-0">
              {o.recent.map((m, i) => (
                <li key={m.id} className="mtb-slide-in flex items-start gap-3 border-b border-border px-5 py-2.5 last:border-b-0" style={slide(i)}>
                  <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-content-center rounded-full ${m.qtyIn > 0 ? "bg-status-paid-tint text-status-paid-ink" : "bg-surface-sunken text-ink-muted"}`}>
                    <Icon name={m.qtyIn > 0 ? "arrowDown" : "arrowUp"} size={14} />
                  </span>
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate">{m.party}</span>
                    <span className="text-small text-ink-muted">
                      {WAREHOUSE_MOVEMENT_LABEL[m.type]} · {m.docNo} · {formatDateTime(m.at)}
                    </span>
                  </span>
                  <span className={`mtb-num font-medium ${m.qtyIn > 0 ? "text-status-paid-ink" : ""}`}>{m.qtyIn > 0 ? `+${formatCount(m.qtyIn)}` : `−${formatCount(m.qtyOut)}`}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </WarehouseShell>
  );
}
