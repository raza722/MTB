import { accountsQueries } from "@mtb/api";
import { formatCount, formatDate, formatLakh, formatRs, formatWeekday } from "@mtb/domain";
import { AnimatedNumber, AreaChart, Button, DataTable, EmptyState, Panel, Segmented, Skeleton, Sparkline, StatCard } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useCan, useCtx } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import { AccLink, AccountsShell, Bal, balText, lakhTick, LoadError, monthName, shortDate, slide, Todo, TypeChip, useGo, useOpenVoucher, VoucherStatus } from "./shared";
import { NewVoucherMenu, OutOfBalanceBanners } from "./VouchersPage";

/** /accounts — cash and bank at a glance, this month's income and spending, and what needs attention. */
export function OverviewPage() {
  const ctx = useCtx();
  const go = useGo();
  const openVoucher = useOpenVoucher();
  const canApprove = useCan("approvals.decide");
  const q = useQuery(accountsQueries.overview(ctx));
  const [view, setView] = useState("chart");
  const d = q.data;
  const a = d?.attention;

  const todos: Array<{ key: string; icon: Parameters<typeof Todo>[0]["icon"]; tone?: "warning" | "danger" | "info" | "success"; title: string; desc: string; onClick: () => void }> = [];
  if (a) {
    if (a.waitingApproval)
      todos.push({
        key: "approve",
        icon: "clock",
        tone: "info",
        title: `${a.waitingApproval} voucher${a.waitingApproval === 1 ? "" : "s"} waiting for approval`,
        desc: canApprove ? "Check them and approve, or send them back with a note." : "An admin approves cash and bank vouchers before they are posted.",
        onClick: () => go("/accounts/vouchers", { status: "SUBMITTED" }),
      });
    if (a.approved) todos.push({ key: "post", icon: "lock", tone: "success", title: `${a.approved} approved voucher${a.approved === 1 ? "" : "s"} ready to post`, desc: "Posting gives each one its number and puts it in the ledger.", onClick: () => go("/accounts/vouchers", { status: "APPROVED" }) });
    if (a.rejected) todos.push({ key: "rejected", icon: "x", tone: "danger", title: `${a.rejected} voucher${a.rejected === 1 ? "" : "s"} sent back`, desc: "The approver asked for a correction.", onClick: () => go("/accounts/vouchers", { status: "DRAFT" }) });
    for (const f of a.feeDifferences)
      todos.push({
        key: `fee-${f.campus}-${f.date}`,
        icon: "alertCircle",
        tone: "warning",
        title: `${f.campusName}, ${formatDate(f.date)}: ledger ${formatRs(Math.abs(f.difference))} ${f.difference > 0 ? "short of" : "over"} the fee office`,
        desc: "Post the difference so the day agrees.",
        onClick: () => go("/accounts/fee-posting", { month: f.date.slice(0, 7), batch: `${f.campus}:${f.date}` }),
      });
    if (a.openFeeBatches.length)
      todos.push({
        key: "open-batches",
        icon: "fees",
        title: `Fee collection not posted yet: ${formatRs(a.openFeeBatches.reduce((s, b) => s + b.amount, 0))}`,
        desc: `${formatCount(a.openFeeBatches.reduce((s, b) => s + b.receipts, 0))} receipts at ${a.openFeeBatches.length === 1 ? a.openFeeBatches[0]!.campusName : `${a.openFeeBatches.length} campuses`}. Today's posts by itself when the counter closes.`,
        onClick: () => go("/accounts/fee-posting"),
      });
    if (a.cashToDeposit > 0) todos.push({ key: "deposit", icon: "building", title: `${formatRs(a.cashToDeposit)} cash to deposit`, desc: "Yesterday's counter cash, above the overnight float. Deposited with a journal voucher.", onClick: () => go("/accounts/ledger", { account: "1101" }) });
    if (a.unmatchedBank) todos.push({ key: "bank", icon: "listChecks", tone: "warning", title: `${a.unmatchedBank} bank statement line${a.unmatchedBank === 1 ? "" : "s"} to match`, desc: "Match them to vouchers, or record what isn't in the books yet.", onClick: () => go("/accounts/bank") });
    for (const p of a.periodsToClose) todos.push({ key: `close-${p.campus}`, icon: "lock", title: `Close ${monthName(p.month)} for ${p.campusName}`, desc: "The month has ended. Closing it stops anything being back-dated into it.", onClick: () => go("/accounts/periods") });
  }

  return (
    <AccountsShell title="Accounts" actions={<NewVoucherMenu />}>
      <OutOfBalanceBanners />
      {q.error && !d ? (
        <LoadError what="The accounts overview" error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="mtb-rise" style={slide(0)}>
              <StatCard
                label="Cash and bank"
                icon="accounts"
                loading={!d}
                value={d ? <AnimatedNumber value={d.cashBank.total} format={formatRs} /> : ""}
                foot={d ? `Cash ${formatLakh(d.cashBank.cash)} · bank ${formatLakh(d.cashBank.bank)}` : ""}
                {...(d ? { onClick: () => go("/accounts/ledger", { account: "1101" }) } : {})}
              >
                {d && <Sparkline values={d.cashBank.trend.map((t) => t.balance)} label={`Last 30 days: ${formatRs(d.cashBank.trend[0]?.balance ?? 0)} to ${formatRs(d.cashBank.total)}`} height={36} />}
              </StatCard>
            </div>
            <div className="mtb-rise" style={slide(1)}>
              <StatCard label={`Income, ${d ? monthName(d.month.month) : "this month"}`} icon="trendUp" loading={!d} value={d ? <AnimatedNumber value={d.month.income} format={formatRs} /> : ""} foot="Fees and other income, month to date" {...(d ? { onClick: () => go("/accounts/statements", { view: "ie", from: `${d.month.month}-01` }) } : {})} />
            </div>
            <div className="mtb-rise" style={slide(2)}>
              <StatCard label={`Spent, ${d ? monthName(d.month.month) : "this month"}`} icon="trendDown" loading={!d} value={d ? <AnimatedNumber value={d.month.expenses} format={formatRs} /> : ""} foot="Salaries are booked when payroll pays them" {...(d ? { onClick: () => go("/accounts/statements", { view: "ie", from: `${d.month.month}-01` }) } : {})} />
            </div>
            <div className="mtb-rise" style={slide(3)}>
              <StatCard
                label="Surplus this session"
                icon="award"
                {...(d && d.sessionToDate.surplus < 0 ? { tone: "danger" as const } : {})}
                loading={!d}
                value={d ? <AnimatedNumber value={Math.abs(d.sessionToDate.surplus)} format={formatRs} /> : ""}
                foot={d ? `Income ${formatLakh(d.sessionToDate.income)} · spent ${formatLakh(d.sessionToDate.expenses)}` : ""}
                {...(d ? { onClick: () => go("/accounts/statements", { view: "ie" }) } : {})}
              />
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Panel
              id="acc-cash"
              rise={4}
              title="Cash and bank, last 30 days"
              description={`${campusLabel(ctx.campus)}. Rises as fees come in; drops on salary day.`}
              actions={<Segmented aria-label="Show cash and bank as" value={view} onChange={setView} options={[{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }]} />}
            >
              {!d ? (
                <Skeleton height={260} />
              ) : view === "chart" ? (
                <AreaChart
                  data={d.cashBank.trend}
                  value={(t) => Math.max(0, t.balance)}
                  axisLabel={(t) => (t.date === d.asOf ? "Today" : shortDate(t.date))}
                  formatAxis={lakhTick}
                  peakLabel={(t) => formatLakh(t.balance)}
                  tooltip={(t) => (
                    <>
                      <div className="mtb-chart-tip-title">
                        {formatWeekday(t.date)} {formatDate(t.date)}
                      </div>
                      <div className="mtb-chart-tip-value">{formatRs(t.balance)}</div>
                    </>
                  )}
                  describe={(t) => `${formatDate(t.date)}: cash and bank ${formatRs(t.balance)}`}
                  label="Cash and bank balance over the last 30 days"
                />
              ) : (
                <DataTable
                  rows={[...d.cashBank.trend].reverse()}
                  rowKey="date"
                  density="dense"
                  maxHeight={300}
                  caption="Cash and bank at the end of each day"
                  columns={[
                    { key: "date", header: "Day", render: (t) => `${formatWeekday(t.date).slice(0, 3)} ${formatDate(t.date)}` },
                    { key: "balance", header: "Cash and bank", align: "right", render: (t) => formatRs(t.balance) },
                  ]}
                />
              )}
            </Panel>

            <Panel id="acc-todo" rise={5} title="Needs attention" description="Work waiting in the accounts, most urgent first.">
              {!a ? (
                <div className="grid gap-2">
                  <Skeleton height={56} />
                  <Skeleton height={56} />
                  <Skeleton height={56} />
                </div>
              ) : todos.length === 0 ? (
                <EmptyState icon="checkCircle" title="Nothing waiting" description="Vouchers are posted, fee days agree and the bank is matched." />
              ) : (
                <ul className="acc-todo">
                  {todos.map((t, i) => (
                    <Todo key={t.key} i={i} icon={t.icon} {...(t.tone ? { tone: t.tone } : {})} title={t.title} desc={t.desc} onClick={t.onClick} />
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel id="acc-banks" rise={6} title="Cash and bank accounts" description="Each account's balance today, with its last 30 days. Click one for its ledger.">
              {!d ? (
                <Skeleton height={200} />
              ) : d.cashBank.accounts.length === 0 ? (
                <EmptyState icon="building" title="No cash or bank accounts" description="Add them in the chart of accounts under 11 Cash and bank." />
              ) : (
                <ul className="acc-banks">
                  {d.cashBank.accounts.map((acc, i) => (
                    <li key={acc.code} className="mtb-slide-in" style={slide(i)}>
                      <AccLink to="/accounts/ledger" search={{ account: acc.code }} className="">
                        <span className="grid min-w-0">
                          <span className="acc-bank-name truncate font-medium">{acc.name}</span>
                          <span className="text-small text-ink-muted">
                            <span className="mtb-mono">{acc.code}</span> · {acc.kind === "CASH" ? "Cash" : "Bank"}
                            {acc.campus ? ` · ${campusLabel(acc.campus)}` : ctx.campus === "ALL" ? " · all campuses" : ""}
                          </span>
                        </span>
                        <Sparkline values={acc.trend} label={`${acc.name}, last 30 days`} height={32} />
                        <span className="text-right" aria-label={balText(acc.balance)}>
                          <Bal value={acc.balance} />
                        </span>
                      </AccLink>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel
              id="acc-recent"
              rise={7}
              title="Recent vouchers"
              description="Entered or posted by staff, newest first."
              actions={
                <Button size="sm" variant="ghost" iconRight="arrowRight" onClick={() => go("/accounts/vouchers")}>
                  All vouchers
                </Button>
              }
              flush
            >
              <DataTable
                rows={d?.recent ?? []}
                rowKey="id"
                loading={!d}
                skeletonRows={5}
                density="dense"
                caption="Recent vouchers"
                onRowClick={(v) => openVoucher(v.id)}
                rowClassName={() => "mtb-slide-in"}
                columns={[
                  { key: "type", header: "Type", width: 56, render: (v) => <TypeChip type={v.type} /> },
                  {
                    key: "what",
                    header: "Voucher",
                    render: (v) => (
                      <span className="grid min-w-0">
                        <span className="mtb-cell-primary truncate">{v.narration}</span>
                        <span className="mtb-cell-secondary">
                          {v.voucherNo ?? "Not posted yet"} · {formatDate(v.date)}
                        </span>
                      </span>
                    ),
                  },
                  { key: "amount", header: "Amount", align: "right", width: 120, render: (v) => formatRs(v.amount) },
                  { key: "status", header: "Status", width: 190, render: (v) => <VoucherStatus status={v.status} totalDebit={v.totalDebit} totalCredit={v.totalCredit} rejected={v.rejected} type={v.type} /> },
                ]}
                empty={<EmptyState icon="file" title="No vouchers yet" description="Vouchers entered by staff will appear here." />}
              />
            </Panel>
          </div>
        </>
      )}
    </AccountsShell>
  );
}
