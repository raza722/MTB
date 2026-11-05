import { feeMonthLabel, feeMonthLongLabel, feeSetupQueries, type FeeMonthRow } from "@mtb/api";
import { formatCount, formatLakh, formatPercent, formatRs, formatSession } from "@mtb/domain";
import { AnimatedNumber, Button, ColumnChart, DataTable, Panel, Segmented, Skeleton, StatCard, type Column } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { campusLabel } from "../../../app/shell/campus";
import { Page, PageHeader, RequirePermission } from "../../../app/shell/page";
import { useCtx } from "../../../app/session";
import { FeesNav, lakhTick, LoadError, PaperSize, slide, TODAY } from "../shared";

const pctOf = (r: { collected: number; target: number }) => (r.target ? (r.collected / r.target) * 100 : 0);

export function MonthlyReport() {
  const ctx = useCtx();
  const q = useQuery(feeSetupQueries.monthly(ctx));
  const [view, setView] = useState("chart");
  const d = q.data;
  const current = d?.months.find((m) => m.current);
  const closed = d?.months.filter((m) => !m.current) ?? [];
  const best = closed.reduce<FeeMonthRow | undefined>((a, m) => (!a || pctOf(m) > pctOf(a) ? m : a), undefined);
  const avg = closed.length ? closed.reduce((a, m) => a + pctOf(m), 0) / closed.length : 0;

  const columns: Array<Column<FeeMonthRow>> = [
    { key: "month", header: "Month", render: (m) => <span className="font-medium">{feeMonthLongLabel(m.month)}{m.current ? " (so far)" : ""}</span> },
    { key: "target", header: "Target", align: "right", render: (m) => <span className="mtb-num">{formatRs(m.target)}</span> },
    { key: "collected", header: "Collected", align: "right", render: (m) => <span className="mtb-num">{formatRs(m.collected)}</span> },
    { key: "pct", header: "Of target", align: "right", render: (m) => <span className="mtb-num">{formatPercent(pctOf(m))}</span> },
    { key: "gap", header: "Still to collect", align: "right", render: (m) => <span className="mtb-num text-ink-muted">{formatRs(Math.max(0, m.target - m.collected))}</span> },
    { key: "receipts", header: "Receipts", align: "right", render: (m) => <span className="mtb-num">{formatCount(m.receipts)}</span> },
  ];

  return (
    <RequirePermission permission="fees.reports" page="collection against target">
      <Page>
        <PageHeader title="Collection against target" actions={<Button icon="printer" onClick={() => window.print()} disabled={!d}>Print report</Button>} />
        <FeesNav />
        {q.isError && <LoadError what="Monthly collection" error={q.error} onRetry={() => void q.refetch()} />}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label={current ? `${feeMonthLongLabel(current.month)} so far` : "Latest month"}
            icon="trendUp"
            loading={q.isLoading}
            value={<AnimatedNumber value={current?.collected ?? 0} format={formatRs} />}
            meter={current ? pctOf(current) : 0}
            meterLabel={`${formatPercent(current ? pctOf(current) : 0, 0)} of the month's target`}
            foot={current ? `${formatPercent(pctOf(current), 0)} of ${formatRs(current.target)}` : "—"}
          />
          <StatCard label={`Session ${formatSession(ctx.session)} to date`} icon="layers" loading={q.isLoading} value={<AnimatedNumber value={d?.total.collected ?? 0} format={formatRs} />} foot={d ? `${formatPercent(pctOf(d.total), 0)} of ${formatLakh(d.total.target)}` : "—"} />
          <StatCard label="Best month" icon="award" loading={q.isLoading} value={best ? feeMonthLongLabel(best.month) : "—"} foot={best ? `${formatPercent(pctOf(best))} of target` : "—"} />
          <StatCard label="Average month" icon="checkCircle" loading={q.isLoading} value={formatPercent(avg)} foot="Of target, months already closed" />
        </div>
        {q.isLoading && <Skeleton height={320} />}
        {d && (
          <Panel
            id="monthly"
            title="Collected against target, month by month"
            description="The target is what was billed for the month; the late payers of one month show in the next."
            rise={1}
            actions={<Segmented aria-label="Show as" value={view} onChange={setView} options={[{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }]} />}
          >
            {view === "chart" ? (
              <ColumnChart
                data={d.months}
                value={(m) => m.collected}
                target={(m) => m.target}
                axisLabel={(m) => feeMonthLabel(m.month).slice(0, 3)}
                formatAxis={lakhTick}
                valueLabel="Collected"
                targetLabel="Target"
                partial={(m) => m.current}
                partialLabel={`${feeMonthLabel(TODAY.slice(0, 7))} so far`}
                tooltip={(m) => (
                  <>
                    <div className="mtb-chart-tip-title">
                      {feeMonthLongLabel(m.month)}
                      {m.current ? " · so far" : ""}
                    </div>
                    <div className="mtb-chart-tip-value">{formatRs(m.collected)}</div>
                    <div className="mtb-chart-tip-row">
                      <span>Target</span>
                      <span>{formatRs(m.target)}</span>
                    </div>
                    <div className="mtb-chart-tip-row">
                      <span>Of target</span>
                      <span>{formatPercent(pctOf(m))}</span>
                    </div>
                  </>
                )}
                describe={(m) => `${feeMonthLongLabel(m.month)}: ${formatRs(m.collected)} collected of a ${formatRs(m.target)} target, ${formatPercent(pctOf(m))}`}
                label={`Monthly collection against target, ${campusLabel(ctx.campus)}`}
              />
            ) : (
              <DataTable rows={d.months} rowKey="month" density="dense" columns={columns} footer={{ month: "Session to date", target: formatRs(d.total.target), collected: formatRs(d.total.collected), pct: formatPercent(pctOf(d.total)) }} />
            )}
          </Panel>
        )}
        {d && ctx.campus === "ALL" && (
          <Panel id="by-campus" title={`${current ? feeMonthLongLabel(current.month) : "This month"} by campus`} description="Each campus against its own target." rise={2}>
            <ul className="m-0 grid list-none gap-3 p-0">
              {d.byCampus.map((c, i) => {
                const p = pctOf(c);
                return (
                  <li key={c.campus} className="mtb-slide-in grid gap-1" style={slide(i)}>
                    <div className="flex justify-between text-small">
                      <span className="font-medium">{c.name}</span>
                      <span className="tabular-nums">
                        {formatRs(c.collected)} <span className="text-ink-muted">of {formatRs(c.target)} · {formatPercent(p, 0)}</span>
                      </span>
                    </div>
                    <span className="mtb-meter" role="progressbar" aria-valuenow={Math.round(p)} aria-valuemin={0} aria-valuemax={100} aria-label={`${c.name}: ${Math.round(p)}% of target`}>
                      <span style={{ width: `${Math.min(100, p)}%` }} />
                    </span>
                  </li>
                );
              })}
            </ul>
          </Panel>
        )}
        {d && (
          <div className="fees-print-only mtb-print-area fees-print-a4">
            <PaperSize size="A4" />
            <div className="fees-doc" data-theme="light">
              <div className="fees-doc-head">
                <div>
                  <h1>Collection against target</h1>
                  <p>
                    {campusLabel(ctx.campus)} · Session {formatSession(ctx.session)}
                  </p>
                </div>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="n">Target</th>
                    <th className="n">Collected</th>
                    <th className="n">Of target</th>
                    <th className="n">Still to collect</th>
                  </tr>
                </thead>
                <tbody>
                  {d.months.map((m) => (
                    <tr key={m.month}>
                      <td>
                        {feeMonthLongLabel(m.month)}
                        {m.current ? " (so far)" : ""}
                      </td>
                      <td className="n">{formatRs(m.target)}</td>
                      <td className="n">{formatRs(m.collected)}</td>
                      <td className="n">{formatPercent(pctOf(m))}</td>
                      <td className="n">{formatRs(Math.max(0, m.target - m.collected))}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>
                      <strong>Session to date</strong>
                    </td>
                    <td className="n">
                      <strong>{formatRs(d.total.target)}</strong>
                    </td>
                    <td className="n">
                      <strong>{formatRs(d.total.collected)}</strong>
                    </td>
                    <td className="n">
                      <strong>{formatPercent(pctOf(d.total))}</strong>
                    </td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Page>
    </RequirePermission>
  );
}
