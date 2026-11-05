import type { CollectionDay, DashboardSummary } from "@mtb/api";
import { formatCount, formatDate, formatLakh, formatRs, formatWeekday } from "@mtb/domain";
import { AnimatedNumber, AreaChart, DataTable, Segmented, Skeleton } from "@mtb/ui";
import { useState } from "react";
import { DashCard } from "./DashCard";
import { lakhTick, shortDate, stagger, TODAY } from "./format";

const isToday = (d: CollectionDay) => d.date === TODAY;

function Tip({ d }: { d: CollectionDay }) {
  return (
    <>
      <div className="mtb-chart-tip-title">
        {formatWeekday(d.date)} {formatDate(d.date)}
        {isToday(d) && " · so far"}
      </div>
      <div className="mtb-chart-tip-value">{formatRs(d.amount)}</div>
      <div className="mtb-chart-tip-row">
        <span>Receipts</span>
        <span>{formatCount(d.receipts)}</span>
      </div>
    </>
  );
}

/** Daily collections for the last 30 days: total, busiest day and daily average, then the trend or a table. */
export function CollectionsCard({ s }: { s: DashboardSummary | undefined }) {
  const [view, setView] = useState("chart");
  const data = s?.collectionsTrend ?? [];
  const total = data.reduce((a, d) => a + d.amount, 0);
  const past = data.filter((d) => !isToday(d));
  const best = past.reduce<CollectionDay | undefined>((a, d) => (!a || d.amount > a.amount ? d : a), undefined);
  const average = past.length ? Math.round(past.reduce((a, d) => a + d.amount, 0) / past.length) : 0;

  return (
    <DashCard
      id="collections"
      title="Collections"
      description="Last 30 days, school days only. Fees are due on the 10th of each month."
      style={stagger(5)}
      actions={<Segmented aria-label="Show collections as" value={view} onChange={setView} options={[{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }]} />}
    >
      {!s ? (
        <div className="grid gap-4">
          <Skeleton width="40%" height={32} />
          <Skeleton height={240} />
        </div>
      ) : (
        <div className="grid gap-5">
          <dl className="mtb-dash-figures">
            <div>
              <dt>Collected in 30 days</dt>
              <dd className="mtb-dash-figure-lg">
                <AnimatedNumber value={total} format={formatRs} />
              </dd>
            </div>
            {best && (
              <div>
                <dt>Busiest day</dt>
                <dd>
                  {formatLakh(best.amount)} <span className="text-ink-muted">· {shortDate(best.date)}</span>
                </dd>
              </div>
            )}
            <div>
              <dt>Average school day</dt>
              <dd>{formatLakh(average)}</dd>
            </div>
          </dl>
          {view === "chart" ? (
            <AreaChart
              data={data}
              value={(d) => d.amount}
              axisLabel={(d) => (isToday(d) ? "Today" : shortDate(d.date))}
              formatAxis={lakhTick}
              peakLabel={(d) => formatLakh(d.amount)}
              tooltip={(d) => <Tip d={d} />}
              describe={(d) => `${formatWeekday(d.date)} ${formatDate(d.date)}${isToday(d) ? ", so far" : ""}: ${formatRs(d.amount)} from ${formatCount(d.receipts)} receipts`}
              label={`Daily collections from ${formatDate(data[0]?.date ?? TODAY)} to today`}
            />
          ) : (
            <DataTable
                rows={[...data].reverse()}
                rowKey="date"
                density="dense"
                maxHeight={300}
                caption="Daily collections, newest first"
                columns={[
                  { key: "date", header: "Day", render: (d) => `${formatWeekday(d.date).slice(0, 3)} ${formatDate(d.date)}${isToday(d) ? " (so far)" : ""}` },
                  { key: "receipts", header: "Receipts", align: "right", render: (d) => formatCount(d.receipts) },
                  { key: "amount", header: "Collected", align: "right", render: (d) => formatRs(d.amount) },
                ]}
              />
          )}
        </div>
      )}
    </DashCard>
  );
}
