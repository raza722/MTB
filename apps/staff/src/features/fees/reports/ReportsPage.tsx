import { feeSetupQueries } from "@mtb/api";
import { formatCount, formatPercent, formatRs } from "@mtb/domain";
import { AnimatedNumber, Icon, Panel, StatCard, type IconName } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Page, PageHeader, RequirePermission } from "../../../app/shell/page";
import { useCtx } from "../../../app/session";
import { FeesNav, LoadError, slide } from "../shared";

interface ReportCard {
  to: string;
  title: string;
  icon: IconName;
  what: string;
  /** Old-system reports this one replaces. */
  replaces: string;
}

const GROUPS: Array<{ id: string; title: string; description: string; cards: ReportCard[] }> = [
  {
    id: "collection",
    title: "Money received",
    description: "What came in, from whom, how and by which cashier. Always matches the receipts and the dashboard.",
    cards: [
      {
        to: "/fees/reports/collection",
        title: "Daily collection",
        icon: "receipt",
        what: "One day or a date range: totals by cashier, payment method, fee head and campus, every receipt, cancellations and the cash closing.",
        replaces: "Daily Fee Summary, Daily Fee Submission, Daily Fee, Fee Submission and Fee Summary between dates, Fee Collection (Head Wise), Daily Fee Cancellation",
      },
      {
        to: "/fees/reports/monthly",
        title: "Collection against target",
        icon: "trendUp",
        what: "Each month of the session: what was billed, what was collected and the gap, by campus.",
        replaces: "Class Monthly Fee (did not run on the Main campus)",
      },
      {
        to: "/fees/candidates",
        title: "Candidate (test) fees",
        icon: "admissions",
        what: "Test fees received and still due, with the candidate fee slip.",
        replaces: "Candidate Fee Voucher, Daily Candidate Fee Submission, Candidate Fee Submission between dates, Candidate Fee Slip",
      },
    ],
  },
  {
    id: "arrears",
    title: "Money owed",
    description: "Worked out from each student's ledger with today's late fine; never typed in.",
    cards: [
      {
        to: "/fees/reports/arrears",
        title: "Arrears by class and student",
        icon: "layers",
        what: "Overdue fees and late fine by class, then student by student, including families who have left.",
        replaces: "Student Wise Arrears (both versions), Class Wise Arrear",
      },
      {
        to: "/fees/defaulters",
        title: "Defaulters and reminders",
        icon: "alertCircle",
        what: "Filter by class, months overdue and amount, then send the reminder SMS in English or Urdu.",
        replaces: "Tuition Fee Defaulter and Fund Defaulter (both failed on the Main campus), Arrears SMS, Fee Defaulter SMS",
      },
      {
        to: "/fees/vouchers",
        title: "Voucher runs",
        icon: "file",
        what: "Every run of bank vouchers with how many are paid, part paid or overdue.",
        replaces: "New: the old system had no bank vouchers",
      },
    ],
  },
  {
    id: "concessions",
    title: "Concessions and fines",
    description: "Who pays less and why, and every fine raised or waived, with who approved it.",
    cards: [
      {
        to: "/fees/concessions",
        title: "Concessions and scholarships",
        icon: "award",
        what: "Every concession by kind and class with its monthly value, approvals and history; siblings found automatically.",
        replaces: "Student Discount, Class Wise Discount I and II, Annual Fee Concession, Scholarship List, Sibling report",
      },
      {
        to: "/fees/fines",
        title: "Fines, waivers and extra time",
        icon: "clock",
        what: "Late-fine rule per campus, waiver requests with the principal's decision, and student fines.",
        replaces: "Student Fine Calculation, Fee Due Date Customization",
      },
      {
        to: "/fees/structure",
        title: "Fee structure",
        icon: "listChecks",
        what: "Fees by class and campus, due dates and every change made, with a campus comparison for head office.",
        replaces: "Fee Type, Class Fee Type, Student Fee Type, voucher settings",
      },
    ],
  },
];

export function ReportsPage() {
  const ctx = useCtx();
  const navigate = useNavigate();
  const q = useQuery(feeSetupQueries.overview(ctx));
  const o = q.data;
  const pct = o && o.month.target ? (o.month.collected / o.month.target) * 100 : 0;
  return (
    <RequirePermission permission="fees.reports" page="fee reports">
      <Page>
        <PageHeader title="Fee reports" />
        <FeesNav />
        {q.isError && <LoadError what="Today's figures" error={q.error} onRetry={() => void q.refetch()} />}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Collected today" icon="receipt" loading={q.isLoading} value={<AnimatedNumber value={o?.today.amount ?? 0} format={formatRs} />} foot={`${formatCount(o?.today.receipts ?? 0)} receipts`} onClick={() => void navigate({ to: "/fees/reports/collection" })} />
          <StatCard
            label="This month"
            icon="trendUp"
            loading={q.isLoading}
            value={<AnimatedNumber value={o?.month.collected ?? 0} format={formatRs} />}
            meter={pct}
            meterLabel={`${formatPercent(pct, 0)} of the ${formatRs(o?.month.target ?? 0)} target`}
            foot={`${formatPercent(pct, 0)} of ${formatRs(o?.month.target ?? 0)}`}
            onClick={() => void navigate({ to: "/fees/reports/monthly" })}
          />
          <StatCard label="Students with overdue fees" icon="alertCircle" tone="warning" loading={q.isLoading} value={<AnimatedNumber value={o?.defaulters.students ?? 0} format={formatCount} />} foot={`${formatRs(o?.defaulters.amount ?? 0)} with late fine`} onClick={() => void navigate({ to: "/fees/defaulters" })} />
          <StatCard
            label="Waiting for a decision"
            icon="shield"
            tone={(o?.approvals.concessions ?? 0) + (o?.approvals.waivers ?? 0) > 0 ? "info" : "neutral"}
            loading={q.isLoading}
            value={<AnimatedNumber value={(o?.approvals.concessions ?? 0) + (o?.approvals.waivers ?? 0)} format={formatCount} />}
            foot={`${formatCount(o?.approvals.concessions ?? 0)} concessions · ${formatCount(o?.approvals.waivers ?? 0)} fine waivers`}
          />
        </div>
        {GROUPS.map((g, gi) => (
          <Panel key={g.id} id={`reports-${g.id}`} title={g.title} description={g.description} rise={gi + 1}>
            <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 xl:grid-cols-3">
              {g.cards.map((c, i) => (
                <li key={c.to} className="mtb-slide-in" style={slide(i + gi * 3)}>
                  <Link to={c.to as never} className="group grid h-full content-start gap-2 rounded-lg border border-border bg-surface-raised p-4 no-underline transition-colors hover:border-brand">
                    <span className="flex items-center gap-3">
                      <span className="grid size-9 shrink-0 place-content-center rounded-full bg-brand-tint text-brand-ink">
                        <Icon name={c.icon} size={18} />
                      </span>
                      <span className="font-medium text-ink">{c.title}</span>
                      <Icon name="arrowRight" size={16} className="ml-auto text-ink-subtle transition-transform group-hover:translate-x-0.5" />
                    </span>
                    <span className="text-small text-ink">{c.what}</span>
                    <span className="text-small text-ink-muted">Replaces: {c.replaces}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
        <Panel id="reports-student" title="One student" description="Statements and receipts for a single family." rise={4}>
          <p className="m-0 text-small text-ink-muted">
            Open the student's profile and choose Fees for the running ledger, the printable statement and every receipt; or search a receipt number from the top bar. These replace the old Student Fee Card, Student Fee Detail, Individual Fee Ledger and Fee Slip reprint.
          </p>
        </Panel>
      </Page>
    </RequirePermission>
  );
}
