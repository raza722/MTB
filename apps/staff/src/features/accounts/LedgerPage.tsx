import { ACCOUNTS_ALL_BANKS, ACCOUNTS_CONTROL_LABEL, accountsQueries, type AccountsLedgerLine } from "@mtb/api";
import { formatCount, formatDate, formatRs, formatWeekday } from "@mtb/domain";
import { AnimatedNumber, AreaChart, Button, Combobox, DataTable, DatePicker, EmptyState, Pagination, Panel, Segmented, Skeleton, StatCard, type Column } from "@mtb/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useCtx } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import { accountOptions, AccountsShell, asOfFor, Bal, balText, DocFoot, DocHead, lakhTick, LoadError, sessionStartOf, shortDate, slide, TODAY, TypeChip, useChart } from "./shared";
import { VoucherPeek } from "./VoucherPeek";

export interface LedgerSearch {
  account?: string;
  from?: string;
  to?: string;
}

const PAGE = 100;

/** /accounts/ledger — one account's movements with a running balance; every line opens its voucher. */
export function LedgerPage({ search, setSearch }: { search: LedgerSearch; setSearch: (next: LedgerSearch) => void }) {
  const ctx = useCtx();
  const { accounts, byCode, q: chartQ } = useChart();
  const asOf = asOfFor(ctx.session);
  const start = sessionStartOf(ctx.session);
  // The books here go back to 2025–26, so a ledger can start in the session before the one chosen.
  const earliest = ctx.session > 2025 ? sessionStartOf(ctx.session - 1) : start;
  const account = search.account ?? "";
  const from = search.from ?? start;
  const to = search.to ?? asOf;
  const q = useQuery({ ...accountsQueries.ledger(ctx, { account, from, to }), placeholderData: keepPreviousData });
  const [view, setView] = useState("chart");
  const [page, setPage] = useState(1);
  const [peek, setPeek] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  useEffect(() => setPage(1), [account, from, to, ctx.campus]);
  useEffect(() => {
    if (!printing) return;
    window.print();
    setPrinting(false);
  }, [printing]);

  const cashBank = accounts.filter((a) => a.postable && a.active && a.kind !== "OTHER");
  const banks = cashBank.filter((a) => a.kind === "BANK");
  const allBanks = account === ACCOUNTS_ALL_BANKS;
  const l = q.data;
  const acc = byCode.get(account) ?? l?.account;
  const isBank = acc?.kind === "BANK";
  /** The old "Manual #": the cheque or slip on a bank book, the bill or reference elsewhere. */
  const refOf = (r: AccountsLedgerLine) => (isBank ? (r.cheque ?? r.reference) : (r.reference ?? r.cheque)) ?? "";
  const normalSign = acc?.normalSide === "CREDIT" ? -1 : 1;
  const rows = l ? [...l.lines].reverse() : [];
  const pageRows = rows.slice((page - 1) * PAGE, page * PAGE);
  const monthStart = `${asOf.slice(0, 7)}-01`;

  const quick = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-small text-ink-muted">Quick:</span>
      {cashBank.map((a) => (
        <Button key={a.code} size="sm" variant={a.code === account ? "primary" : "secondary"} icon={a.kind === "CASH" ? "fees" : "building"} onClick={() => setSearch({ ...search, account: a.code })}>
          {a.kind === "CASH" ? (a.code === "1101" ? "Cash book" : a.name) : a.name.split(" — ")[0]}
        </Button>
      ))}
      {banks.length > 1 && (
        <Button size="sm" variant={allBanks ? "primary" : "secondary"} icon="building" onClick={() => setSearch({ ...search, account: ACCOUNTS_ALL_BANKS })}>
          All banks
        </Button>
      )}
    </div>
  );

  const columns: Array<Column<AccountsLedgerLine>> = [
    { key: "date", header: "Date", width: 118, render: (r) => <span className="mtb-num">{formatDate(r.date)}</span> },
    {
      key: "no",
      header: "Voucher",
      width: 220,
      render: (r) => (
        <span className="flex items-center gap-2">
          <TypeChip type={r.type} />
          <span className="mtb-mono text-ink">{r.voucherNo}</span>
        </span>
      ),
    },
    { key: "ref", header: "Bill / ref no.", width: 130, render: (r) => <span className="mtb-mono">{refOf(r)}</span> },
    ...(allBanks
      ? [
          {
            key: "account",
            header: "Bank account",
            width: 190,
            render: (r: AccountsLedgerLine) => (
              <span className="grid min-w-0">
                <span className="mtb-mono text-ink-muted">{r.accountCode}</span>
                <span className="truncate">{(r.accountName ?? "").split(" — ")[0]}</span>
              </span>
            ),
          },
        ]
      : []),
    ...(ctx.campus === "ALL" ? [{ key: "campus", header: "Campus", width: 70, render: (r: AccountsLedgerLine) => r.campus }] : []),
    {
      key: "narration",
      header: "Narration",
      render: (r) => (
        <span className="grid min-w-0">
          <span className="mtb-cell-primary truncate">{r.narration}</span>
          {r.description && <span className="mtb-cell-secondary truncate">{r.description}</span>}
        </span>
      ),
    },
    { key: "debit", header: "Debit", align: "right", width: 130, render: (r) => (r.debit ? formatRs(r.debit) : "") },
    { key: "credit", header: "Credit", align: "right", width: 130, render: (r) => (r.credit ? formatRs(r.credit) : "") },
    { key: "balance", header: "Balance", align: "right", width: 170, render: (r) => <Bal value={r.balance} /> },
  ];

  return (
    <AccountsShell title="Ledger" actions={l && l.lines.length > 0 ? <Button icon="printer" onClick={() => setPrinting(true)}>Print ledger</Button> : undefined}>
      <section className="mtb-card mtb-rise grid gap-4 p-5" aria-label="Choose the account and dates">
        <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_180px_180px_auto] md:items-end">
          <Combobox
            label="Account"
            options={accountOptions(accounts)}
            value={account && !allBanks ? account : null}
            onValueChange={(v) => setSearch({ ...search, account: v })}
            placeholder={chartQ.isLoading ? "Loading accounts…" : allBanks ? "All bank accounts" : "Choose an account…"}
            searchPlaceholder="Type a code or name"
          />
          <DatePicker label="From" value={from} onValueChange={(v) => setSearch({ ...search, from: v ?? undefined })} today={TODAY} minDate={earliest} maxDate={asOf} {...(from < start ? { help: "Starts in the previous session; the year-end close shows as one line." } : {})} />
          <DatePicker label="To" value={to} onValueChange={(v) => setSearch({ ...search, to: v ?? undefined })} today={TODAY} minDate={start} maxDate={asOf} />
          <Segmented
            aria-label="Period"
            value={from === start && to === asOf ? "session" : from === monthStart && to === asOf ? "month" : "custom"}
            onChange={(v) => setSearch({ ...search, from: v === "month" ? monthStart : undefined, to: undefined })}
            options={[
              { value: "month", label: "This month" },
              { value: "session", label: "Session" },
              ...(from === start && to === asOf ? [] : from === monthStart && to === asOf ? [] : [{ value: "custom", label: "Custom" }]),
            ]}
          />
        </div>
        {quick}
      </section>

      {!account ? (
        <div className="mtb-card">
          <EmptyState icon="book" title="Choose an account" description="Pick any account to see every voucher that touched it, with the running balance. The cash book and bank books are one click away above." />
        </div>
      ) : q.error && !l ? (
        <LoadError what="The ledger" error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Opening balance", value: l?.opening, hint: `Before ${formatDate(from)}` },
              { label: "Debits", value: l?.totalDebit, hint: `${formatCount(l?.lines.filter((x) => x.debit).length ?? 0)} lines` },
              { label: "Credits", value: l?.totalCredit, hint: `${formatCount(l?.lines.filter((x) => x.credit).length ?? 0)} lines` },
              { label: "Closing balance", value: l?.closing, hint: `At ${formatDate(to)}` },
            ].map((c, i) => (
              <div key={c.label} className="mtb-rise" style={slide(i)}>
                <StatCard
                  label={c.label}
                  loading={!l}
                  value={c.value === undefined ? "" : i === 1 || i === 2 ? <AnimatedNumber value={c.value} format={formatRs} /> : <span>{<AnimatedNumber value={Math.abs(c.value)} format={formatRs} />}<span className="acc-side">{c.value > 0 ? "Dr" : c.value < 0 ? "Cr" : ""}</span></span>}
                  foot={c.hint}
                />
              </div>
            ))}
          </div>

          {acc && (
            <Panel
              id="ledger-trend"
              rise={1}
              title={allBanks ? "All bank accounts" : `${acc.code} ${acc.name}`}
              description={
                allBanks ? (
                  <>
                    {(l?.accounts ?? []).map((b) => `${b.code} ${b.name}`).join(", ")} · showing {campusLabel(ctx.campus)} · balances added together
                  </>
                ) : (
                  <>
                    {acc.campus ? `${campusLabel(acc.campus)} only` : `All campuses · showing ${campusLabel(ctx.campus)}`}
                    {acc.control ? ` · Control account (${ACCOUNTS_CONTROL_LABEL[acc.control]})` : ""}
                    {acc.bank ? ` · ${acc.bank.bankName} ${acc.bank.accountNoMasked}` : ""} · normally a {acc.normalSide === "DEBIT" ? "debit" : "credit"} balance
                  </>
                )
              }
              actions={<Segmented aria-label="Show the balance as" value={view} onChange={setView} options={[{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }]} />}
            >
              {!l ? (
                <Skeleton height={240} />
              ) : view === "chart" ? (
                <AreaChart
                  data={l.trend}
                  value={(d) => Math.max(0, d.balance * normalSign)}
                  axisLabel={(d) => shortDate(d.date)}
                  formatAxis={lakhTick}
                  tooltip={(d) => (
                    <>
                      <div className="mtb-chart-tip-title">
                        {formatWeekday(d.date)} {formatDate(d.date)}
                      </div>
                      <div className="mtb-chart-tip-value">{balText(d.balance)}</div>
                    </>
                  )}
                  describe={(d) => `${formatDate(d.date)}: balance ${balText(d.balance)}`}
                  label={`Balance of ${acc.name} from ${formatDate(from)} to ${formatDate(to)}`}
                  height={240}
                />
              ) : (
                <DataTable
                  rows={[...l.trend].reverse()}
                  rowKey="date"
                  density="dense"
                  maxHeight={280}
                  caption="Balance at the end of each day with movement"
                  columns={[
                    { key: "date", header: "Day", render: (d) => `${formatWeekday(d.date).slice(0, 3)} ${formatDate(d.date)}` },
                    { key: "balance", header: "Balance", align: "right", render: (d) => <Bal value={d.balance} /> },
                  ]}
                />
              )}
            </Panel>
          )}

          <DataTable
            caption={`Ledger of ${acc?.name ?? account}, newest first`}
            columns={columns}
            rows={pageRows}
            rowKey="key"
            loading={!l}
            onRowClick={(r) => setPeek(r.voucherId)}
            rowClassName={() => "mtb-slide-in"}
            toolbar={
              <div className="flex w-full flex-wrap items-center justify-between gap-2 text-small text-ink-muted">
                <span>Newest first. Click a line to see its voucher.</span>
                {l && (
                  <span>
                    Opening {balText(l.opening)} · closing <b className="text-ink">{balText(l.closing)}</b>
                  </span>
                )}
              </div>
            }
            empty={<EmptyState icon="book" title="No movement in these dates" description={`Nothing was posted to ${acc?.name ?? "this account"} between ${formatDate(from)} and ${formatDate(to)}. The balance stayed at ${balText(l?.opening ?? 0)}.`} />}
            footer={l ? { narration: "Totals for the period", debit: formatRs(l.totalDebit), credit: formatRs(l.totalCredit), balance: <Bal value={l.closing} strong /> } : undefined}
            pagination={rows.length > PAGE ? <Pagination page={page} pageSize={PAGE} total={rows.length} onPageChange={setPage} /> : undefined}
          />
        </>
      )}

      <VoucherPeek id={peek} onClose={() => setPeek(null)} />

      {printing && l && acc && (
        <div className="acc-print-only mtb-print-area" aria-hidden="true">
          <article className="acc-doc">
            <DocHead title={allBanks ? "Bank book: all bank accounts" : `${isBank ? "Bank book" : acc.kind === "CASH" ? "Cash book" : "Ledger"}: ${acc.code} ${acc.name}`} subtitle={`${formatDate(from)} to ${formatDate(to)}`} />
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Voucher</th>
                  <th>Bill / ref no.</th>
                  {allBanks && <th>Bank account</th>}
                  <th>Narration</th>
                  <th className="num">Debit</th>
                  <th className="num">Credit</th>
                  <th className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{formatDate(from)}</td>
                  <td />
                  <td />
                  {allBanks && <td />}
                  <td>
                    <b>Opening balance</b>
                  </td>
                  <td />
                  <td />
                  <td className="num">{balText(l.opening)}</td>
                </tr>
                {l.lines.map((r) => (
                  <tr key={r.key}>
                    <td>{formatDate(r.date)}</td>
                    <td>{r.voucherNo}</td>
                    <td>{refOf(r)}</td>
                    {allBanks && <td>{r.accountCode}</td>}
                    <td>
                      {r.narration}
                      {r.description ? ` — ${r.description}` : ""}
                    </td>
                    <td className="num">{r.debit ? formatRs(r.debit) : ""}</td>
                    <td className="num">{r.credit ? formatRs(r.credit) : ""}</td>
                    <td className="num">{balText(r.balance)}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={allBanks ? 5 : 4} style={{ textAlign: "right", fontWeight: 600 }}>
                    Totals and closing balance
                  </td>
                  <td className="num">{formatRs(l.totalDebit)}</td>
                  <td className="num">{formatRs(l.totalCredit)}</td>
                  <td className="num" style={{ fontWeight: 600 }}>
                    {balText(l.closing)}
                  </td>
                </tr>
              </tbody>
            </table>
            <DocFoot />
          </article>
        </div>
      )}
    </AccountsShell>
  );
}
