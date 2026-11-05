// Small recreations of real screens, built from the same @mtb/ui components, shared by several sections
// (loading, network, dark mode). Figures are the demo's fictional Khalid Campus numbers.
import { formatCount, formatDate, formatPercent, formatRs, formatSession } from "@mtb/domain";
import { AnimatedNumber, Avatar, Checkbox, cx, DataTable, Skeleton, StatCard, StatusBadge, Tooltip, Urdu, type Column } from "@mtb/ui";
import type { ReactNode } from "react";
import { AYESHA, AYESHA_CHARGES, type DemoCharge } from "./demo";
import { stagger } from "./kit";

const KPI = {
  attendance: { percent: 92.4, present: 1148, total: 1242, deltaPts: 1.2 },
  today: { amount: 486500, receipts: 61 },
  month: { collected: 2140000, target: 6800000 },
  arrears: { amount: 4825000, students: 412 },
};

/** The dashboard's four headline cards. `animate` counts the figures up (off for the duplicated dark-mode copy). */
export function DashboardKpis({ loading, animate = true, compact }: { loading?: boolean; animate?: boolean; compact?: boolean }) {
  const monthPct = Math.round((KPI.month.collected / KPI.month.target) * 100);
  const num = (value: number, format: (v: number) => string, decimals = 0) => (animate ? <AnimatedNumber value={value} format={format} decimals={decimals} /> : format(value));
  const cards: Array<{ key: string; card: ReactNode }> = [
    {
      key: "att",
      card: (
        <StatCard
          label="Attendance today"
          icon="attendance"
          value={num(KPI.attendance.percent, (v) => formatPercent(v), 1)}
          delta={KPI.attendance.deltaPts}
          deltaLabel={`+${KPI.attendance.deltaPts} pts`}
          foot={`${formatCount(KPI.attendance.present)} of ${formatCount(KPI.attendance.total)} present`}
        />
      ),
    },
    { key: "today", card: <StatCard label="Fees collected today" icon="fees" value={num(KPI.today.amount, formatRs)} foot={`${KPI.today.receipts} receipts so far`} /> },
    {
      key: "month",
      card: (
        <StatCard
          label="Collected this month"
          icon="trendUp"
          value={num(KPI.month.collected, formatRs)}
          meter={monthPct}
          meterLabel={`${monthPct}% of the ${formatRs(KPI.month.target)} target`}
          foot={`${monthPct}% of the ${formatRs(KPI.month.target)} target`}
        />
      ),
    },
    { key: "arrears", card: <StatCard label="Outstanding arrears" icon="alert" tone="danger" value={num(KPI.arrears.amount, formatRs)} foot={`${formatCount(KPI.arrears.students)} students overdue`} /> },
  ];
  return (
    <div className={cx("grid gap-4", compact ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-[repeat(auto-fit,minmax(200px,1fr))]")} aria-busy={loading || undefined}>
      {cards.map((c, i) =>
        loading ? (
          <StatCard key={c.key} label="" loading />
        ) : (
          <div key={c.key} className={cx("grid", animate && "mtb-rise")} style={animate ? stagger(i) : undefined}>
            {c.card}
          </div>
        ),
      )}
    </div>
  );
}

/** Student profile header, as on /students/KC-14823. */
export function ProfileHeader({ loading, animate = true }: { loading?: boolean; animate?: boolean }) {
  if (loading) {
    return (
      <div className="mtb-card flex items-center gap-5 p-5" aria-busy="true" aria-label="Loading student">
        <Skeleton width={80} height={80} style={{ borderRadius: "var(--radius-lg)" }} />
        <div className="grid flex-1 gap-2">
          <Skeleton width="40%" height={24} />
          <Skeleton width="25%" />
          <Skeleton width="55%" />
        </div>
      </div>
    );
  }
  return (
    <section className={cx("mtb-card flex flex-wrap items-center gap-5 p-5", animate && "mtb-rise")} aria-label="Student">
      <Avatar name={AYESHA.name} size="xl" />
      <div className="grid min-w-0 flex-1 gap-1">
        <div className="flex flex-wrap items-baseline gap-x-4">
          <span className="text-title-1">{AYESHA.name}</span>
          <Urdu size="title">{AYESHA.nameUr}</Urdu>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-ink-muted">
          <span>
            G.R. <span className="mtb-mono text-ink">{AYESHA.grNo}</span>
          </span>
          <span>
            Class <b className="font-medium text-ink">{AYESHA.classSection}</b>
          </span>
          <span>Session {formatSession(2026)}</span>
          <span>d/o {AYESHA.father}</span>
          <StatusBadge status="success">Enrolled</StatusBadge>
          <StatusBadge status="overdue">Overdue</StatusBadge>
        </div>
      </div>
    </section>
  );
}

/** A profile tab while it loads: rows in the shape of what is coming. */
export function TabSkeleton() {
  return (
    <div className="grid gap-3 pt-4" aria-busy="true" aria-label="Loading tab">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} height={36} />
      ))}
    </div>
  );
}

/** Ayesha's unpaid charges, as the fee counter lists them: late fine calculated live, with the working in a tooltip. */
export function ChargesTable({ selected, onToggle, caption = "Unpaid charges" }: { selected: Set<string>; onToggle?: (id: string) => void; caption?: string }) {
  const chosen = AYESHA_CHARGES.filter((c) => selected.has(c.id));
  const columns: Array<Column<DemoCharge>> = [
    {
      key: "sel",
      header: <span className="mtb-sr-only">Select</span>,
      width: 44,
      render: (c) => <Checkbox aria-label={`Pay ${c.head}`} checked={selected.has(c.id)} onChange={() => onToggle?.(c.id)} disabled={!onToggle} />,
    },
    { key: "head", header: "Charge", render: (c) => <span className="font-medium text-ink">{c.head}</span> },
    { key: "due", header: "Due", render: (c) => <span className="tabular-nums">{formatDate(c.dueDate)}</span> },
    {
      key: "status",
      header: "Status",
      render: (c) => (c.overdue ? <StatusBadge status="overdue">{c.fine.daysOverdue} days overdue</StatusBadge> : <StatusBadge status="unpaid">Due in {c.fine.dueInDays} days</StatusBadge>),
    },
    { key: "amount", header: "Amount", align: "right", render: (c) => formatRs(c.amount) },
    {
      key: "fine",
      header: "Late fine",
      align: "right",
      render: (c) =>
        c.fine.fine ? (
          <Tooltip content={c.fine.explanation}>
            <button type="button" className="cursor-help font-medium tabular-nums text-status-overdue-ink underline decoration-dotted underline-offset-4">
              {formatRs(c.fine.fine)}
            </button>
          </Tooltip>
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
    },
    { key: "total", header: "Line total", align: "right", render: (c) => <b className="font-semibold">{formatRs(c.lineTotal)}</b> },
  ];
  return (
    <DataTable
      caption={caption}
      columns={columns}
      rows={AYESHA_CHARGES}
      density="roomy"
      rowClassName={(c) => (selected.has(c.id) ? "is-selected" : undefined)}
      footer={{ head: `${chosen.length} of ${AYESHA_CHARGES.length} selected`, total: formatRs(chosen.reduce((s, c) => s + c.lineTotal, 0)) }}
    />
  );
}
