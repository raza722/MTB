import type { DashboardSummary } from "@mtb/api";
import { formatLakh, formatRs } from "@mtb/domain";
import { DataTable, Segmented } from "@mtb/ui";
import { useState, type CSSProperties } from "react";
import { DashCard } from "./DashCard";
import { percentOrDash, stagger } from "./format";

/** Collected as a whole percentage of the target, or null when the campus has no target this month. */
const ofTarget = (collected: number, target: number) => (target > 0 ? Math.round((collected / target) * 100) : null);

/** The campuses where the caller has fees.view, so every money figure is there. */
type Rows = Array<NonNullable<DashboardSummary["campuses"]>[number] & { collected: number; target: number; arrears: number }>;

/** With "All campuses": each campus's collection against its own target, with attendance and arrears beside it. */
export function CampusComparison({ rows }: { rows: Rows }) {
  const [view, setView] = useState("chart");
  const max = Math.max(0, ...rows.map((r) => r.target));
  return (
    <DashCard
      id="compare"
      title="Campuses compared"
      description="This month: collected against each campus's target. Track length shows the target."
      style={stagger(8)}
      actions={<Segmented aria-label="Show campuses as" value={view} onChange={setView} options={[{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }]} />}
    >
      {view === "chart" ? (
        <ul className="mtb-dash-compare" aria-label="Collected against target by campus">
          {rows.map((r, i) => {
            const pct = ofTarget(r.collected, r.target);
            return (
              <li key={r.campus} className="mtb-slide-in" style={stagger(i + 8)}>
                <div className="mtb-dash-compare-head">
                  <span className="font-medium text-ink">{r.name}</span>
                  <span className="tabular-nums text-small text-ink-muted">
                    {formatLakh(r.collected)} of {formatLakh(r.target)} · <span className="font-medium text-ink">{pct === null ? "—" : `${pct}%`}</span>
                  </span>
                </div>
                <div className="mtb-dash-compare-track" style={{ width: `${max > 0 ? (r.target / max) * 100 : 0}%` }} role="img" aria-label={`${r.name}: ${formatRs(r.collected)} of ${formatRs(r.target)}${pct === null ? "" : `, ${pct}%`}`}>
                  <span style={{ width: `${Math.min(100, pct ?? 0)}%`, animationDelay: `${300 + i * 90}ms` } as CSSProperties} />
                </div>
                <div className="mtb-dash-compare-meta">
                  <span>Attendance {percentOrDash(r.attendancePercent)}</span>
                  <span>Arrears {formatLakh(r.arrears)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <DataTable
          rows={rows}
          rowKey="campus"
          stickyHeader={false}
          density="dense"
          caption="Campus comparison"
          columns={[
            { key: "name", header: "Campus", render: (r) => <span className="mtb-cell-primary">{r.name}</span> },
            { key: "att", header: "Attendance", align: "right", render: (r) => percentOrDash(r.attendancePercent) },
            { key: "collected", header: "Collected", align: "right", render: (r) => formatRs(r.collected) },
            { key: "target", header: "Target", align: "right", render: (r) => formatRs(r.target) },
            { key: "pct", header: "Of target", align: "right", render: (r) => { const p = ofTarget(r.collected, r.target); return p === null ? "—" : `${p}%`; } },
            { key: "arrears", header: "Arrears", align: "right", render: (r) => formatRs(r.arrears) },
          ]}
        />
      )}
    </DashCard>
  );
}
