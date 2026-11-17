import type { DashboardSummary } from "@mtb/api";
import { formatCount, formatRs } from "@mtb/domain";
import { AnimatedNumber, Icon, SegmentedBar, Skeleton, StatusBadge } from "@mtb/ui";
import { Link } from "@tanstack/react-router";
import { usePreferences } from "../../app/preferences";
import { useCan } from "../../app/session";
import { DashCard } from "./DashCard";
import { money, stagger } from "./format";

const PARTS = [
  { key: "paid", label: "Paid", color: "var(--status-paid)", note: "Nothing owed" },
  { key: "unpaid", label: "Unpaid", color: "var(--status-unpaid)", note: "This month's fee due" },
  { key: "overdue", label: "Overdue", color: "var(--status-overdue)", note: "Past months unpaid" },
] as const;

/** Students by fee status as one bar with a legend that opens the filtered student list, then the month's target. */
export function FeeStatusCard({ s }: { s: DashboardSummary | undefined }) {
  const canStudents = useCan("students.view");
  const { showLakh } = usePreferences();
  const canFees = useCan("fees.view");
  // Sent only to fees.view holders (access parity): no card without it.
  if (!canFees || (s && (!s.feeStatus || !s.month))) return null;
  const fs = s?.feeStatus ?? { paid: 0, unpaid: 0, overdue: 0 };
  const month = s?.month ?? { collected: 0, target: 0 };
  const total = fs.paid + fs.unpaid + fs.overdue;
  // No target this month (no charges raised yet): "—" rather than a division by zero.
  const monthPct = s && month.target > 0 ? Math.round((month.collected / month.target) * 100) : null;

  return (
    <DashCard id="fee-status" title="Fee status" description="Students on roll by fee status (the Students list's fee filter)" style={stagger(6)}>
      {!s ? (
        <div className="grid gap-4">
          <Skeleton height={14} />
          <Skeleton height={120} />
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
            <p className="m-0 flex flex-wrap items-baseline gap-x-2">
              <span className="mtb-dash-figure-lg">
                <AnimatedNumber value={fs.unpaid + fs.overdue} format={formatCount} />
              </span>
              <span className="text-small text-ink-muted">of {formatCount(total)} students still to pay</span>
            </p>
            <SegmentedBar label="Students by fee status" height={14} format={formatCount} segments={PARTS.map((p) => ({ key: p.key, label: p.label, color: p.color, value: fs[p.key] }))} />
          </div>
          <ul className="mtb-dash-legend" aria-label="Fee status legend">
            {PARTS.map((p, i) => {
              const n = fs[p.key];
              const row = (
                <>
                  <span className="mtb-chart-key" style={{ background: p.color }} aria-hidden="true" />
                  <StatusBadge status={p.key} />
                  <span className="min-w-0 flex-1 truncate text-small text-ink-muted">{p.note}</span>
                  <span className="mtb-dash-legend-n">{formatCount(n)}</span>
                  <span className="mtb-dash-legend-pct">{total ? Math.round((n / total) * 100) : 0}%</span>
                  {canStudents && <Icon name="chevronRight" size={16} className="text-ink-subtle" />}
                </>
              );
              return (
                <li key={p.key} className="mtb-slide-in" style={stagger(i + 6)}>
                  {canStudents ? (
                    <Link to="/students" search={(prev: Record<string, unknown>) => ({ ...prev, fee: p.key }) as never} className="mtb-dash-legend-row" aria-label={`${p.label}: ${formatCount(n)} students. Open the list`}>
                      {row}
                    </Link>
                  ) : (
                    <div className="mtb-dash-legend-row">{row}</div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="mtb-dash-target">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-small font-medium text-ink-muted">Month target</span>
              <span className="text-small tabular-nums text-ink-muted">{monthPct === null ? "—" : `${monthPct}%`}</span>
            </div>
            {monthPct !== null && (
              <div className="mtb-meter mtb-meter-lg mtb-meter-animate" role="progressbar" aria-valuenow={monthPct} aria-valuemin={0} aria-valuemax={100} aria-label={`${monthPct}% of the month's target collected`}>
                <span style={{ width: `${Math.min(100, monthPct)}%` }} />
              </div>
            )}
            <p className="m-0 text-small text-ink-muted">
              <span className="font-medium text-ink">{money(month.collected, showLakh)}</span> of {formatRs(month.target)}
            </p>
          </div>
        </div>
      )}
    </DashCard>
  );
}
