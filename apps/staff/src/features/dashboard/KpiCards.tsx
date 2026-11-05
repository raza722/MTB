import type { DashboardSummary } from "@mtb/api";
import { formatCount, formatPercent, formatRs } from "@mtb/domain";
import { AnimatedNumber, cx, Icon, Skeleton, Sparkline, type IconName } from "@mtb/ui";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { usePreferences } from "../../app/preferences";
import { useCan } from "../../app/session";
import { money, stagger } from "./format";

interface KpiProps {
  i: number;
  label: string;
  icon: IconName;
  tone?: "danger" | "info" | "warning";
  value: ReactNode;
  side?: ReactNode;
  meter?: { percent: number; label: string };
  delta?: { value: number; text: string };
  foot: ReactNode;
  onClick?: (() => void) | undefined;
}

/** A stat card (design-system classes) with a trend beside the figure; the whole card opens its page. */
function Kpi({ i, label, icon, tone, value, side, meter, delta, foot, onClick }: KpiProps) {
  const dir = delta ? (delta.value > 0 ? "up" : delta.value < 0 ? "down" : "flat") : null;
  const body = (
    <>
      <div className="mtb-stat-top">
        <span className="mtb-stat-label">{label}</span>
        <span className={cx("mtb-stat-icon", tone && `tone-${tone}`)}>
          <Icon name={icon} />
        </span>
      </div>
      <div className="mtb-kpi-main">
        <div className="mtb-stat-value">{value}</div>
        {side}
      </div>
      {meter && (
        <div className="mtb-meter mtb-meter-animate" role="progressbar" aria-valuenow={Math.round(meter.percent)} aria-valuemin={0} aria-valuemax={100} aria-label={meter.label}>
          <span style={{ width: `${Math.min(100, Math.max(0, meter.percent))}%` }} />
        </div>
      )}
      <div className="mtb-stat-foot">
        {dir && delta && (
          <span className={cx("mtb-delta mtb-delta-pill", `mtb-delta-${dir}`)}>
            {dir !== "flat" && <Icon name={dir === "up" ? "trendUp" : "trendDown"} />}
            {delta.text}
          </span>
        )}
        <span>{foot}</span>
      </div>
    </>
  );
  const cls = "mtb-stat mtb-kpi mtb-rise";
  return onClick ? (
    <button type="button" className={cx(cls, "mtb-kpi-link")} style={stagger(i + 1)} onClick={onClick}>
      {body}
      <Icon name="arrowRight" size={16} className="mtb-kpi-go" aria-hidden="true" />
    </button>
  ) : (
    <div className={cls} style={stagger(i + 1)}>
      {body}
    </div>
  );
}

export function KpiCards({ s }: { s: DashboardSummary | undefined }) {
  const navigate = useNavigate();
  const { showLakh } = usePreferences();
  const canFees = useCan("fees.view");
  const canStudents = useCan("students.view");
  const canAttendance = useCan("attendance.view");

  if (!s) {
    return (
      <div className="mtb-dash-kpis">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="mtb-stat" aria-busy="true">
            <div className="mtb-stat-top">
              <Skeleton width={120} />
              <Skeleton width={32} height={32} />
            </div>
            <Skeleton width="60%" height={32} />
            <Skeleton width="80%" />
          </div>
        ))}
      </div>
    );
  }

  const att = s.attendanceTrend;
  const fees = s.collectionsTrend.slice(-14);
  const monthPct = Math.round((s.month.collected / s.month.target) * 100);
  const d = s.attendance.deltaPts;

  return (
    <div className="mtb-dash-kpis">
      <Kpi
        i={0}
        label="Attendance today"
        icon="attendance"
        value={<AnimatedNumber value={s.attendance.percent} decimals={1} format={(v) => formatPercent(v)} />}
        side={<Sparkline values={att.map((a) => a.percent)} label={`Attendance over the last ${att.length} school days, from ${formatPercent(att[0]?.percent ?? 0)} to ${formatPercent(s.attendance.percent)} today`} />}
        delta={{ value: d, text: `${d > 0 ? "+" : ""}${d} pts` }}
        foot={`${formatCount(s.attendance.present)} of ${formatCount(s.attendance.total)} present`}
        onClick={canAttendance ? () => navigate({ to: "/attendance" }) : undefined}
      />
      <Kpi
        i={1}
        label="Fees collected today"
        icon="fees"
        value={<AnimatedNumber value={s.feesToday.amount} format={formatRs} />}
        side={<Sparkline values={fees.map((f) => f.amount)} label={`Collections over the last ${fees.length} school days; today so far ${formatRs(s.feesToday.amount)}`} />}
        foot={`${formatCount(s.feesToday.receipts)} receipts so far`}
        onClick={canFees ? () => navigate({ to: "/fees/counter" }) : undefined}
      />
      <Kpi
        i={2}
        label="Collected this month"
        icon="trendUp"
        value={<AnimatedNumber value={s.month.collected} format={(v) => money(v, showLakh)} />}
        meter={{ percent: monthPct, label: `${monthPct}% of the ${formatRs(s.month.target)} target` }}
        foot={`${monthPct}% of the ${money(s.month.target, showLakh)} target`}
      />
      <Kpi
        i={3}
        label="Outstanding arrears"
        icon="alert"
        tone="danger"
        value={<AnimatedNumber value={s.arrears.amount} format={(v) => money(v, showLakh)} />}
        foot={`${formatCount(s.arrears.students)} students overdue`}
        onClick={canStudents ? () => navigate({ to: "/students", search: (p: Record<string, unknown>) => ({ ...p, fee: "overdue" }) } as never) : undefined}
      />
    </div>
  );
}
