import { accountsApi, accountsQueries, type AccountsBankRec, type AccountsBookLine, type AccountsStatementLine } from "@mtb/api";
import { formatCount, formatDate, formatDateTime, formatRs } from "@mtb/domain";
import { AnimatedNumber, Banner, Button, ConfirmDialog, DataTable, EmptyState, Icon, Panel, Segmented, Select, SidePanel, Skeleton, StatCard, StatusBadge, useToast, type Column } from "@mtb/ui";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import { AccountsShell, DocFoot, DocHead, errorText, LoadError, monthEnd, monthName, slide, useGo } from "./shared";
import { VoucherPeek } from "./VoucherPeek";

export interface BankSearch {
  account?: string;
  month?: string;
}

/** /accounts/bank — each bank statement line matched against the books, and the reconciliation statement. */
export function BankRecPage({ search, setSearch }: { search: BankSearch; setSearch: (next: BankSearch) => void }) {
  const ctx = useCtx();
  const banks = useQuery(accountsQueries.bankAccounts(ctx));
  const list = banks.data ?? [];
  const account = search.account && list.some((b) => b.code === search.account) ? search.account : (list.find((b) => b.unmatched > 0)?.code ?? list[0]?.code ?? "");
  const sessionMonth = ctx.session === 2026 ? "2026-10" : `${ctx.session + 1}-03`;
  const month = search.month ?? sessionMonth;
  const q = useQuery({ ...accountsQueries.bankRec(account, month), placeholderData: keepPreviousData });

  return (
    <AccountsShell title="Bank reconciliation">
      <section className="mtb-card mtb-rise flex flex-wrap items-end gap-4 p-5" aria-label="Bank account and month">
        <div className="w-80 max-w-full">
          <Select
            label="Bank account"
            value={account}
            onChange={(e) => setSearch({ ...search, account: e.target.value })}
            disabled={banks.isLoading}
            options={banks.isLoading ? [{ value: "", label: "Loading…" }] : list.map((b) => ({ value: b.code, label: `${b.name} · ${b.bank.accountNoMasked}${b.unmatched ? ` · ${b.unmatched} to match` : ""}` }))}
          />
        </div>
        <div className="w-48">
          <Select label="Statement month" value={month} onChange={(e) => setSearch({ ...search, month: e.target.value })} options={[...(q.data?.months ?? [month])].reverse().map((m) => ({ value: m, label: monthName(m) }))} />
        </div>
        <p className="m-0 ms-auto max-w-md text-small text-ink-muted">
          Statements are imported from each bank's file. Lines match when the amount is the same; the dates can differ by a few days while a cheque clears.
        </p>
      </section>
      {banks.error ? (
        <LoadError what="Bank accounts" error={banks.error} onRetry={() => void banks.refetch()} />
      ) : !banks.isLoading && list.length === 0 ? (
        <div className="mtb-card">
          <EmptyState icon="building" title="No bank accounts here" description={`${campusLabel(ctx.campus)} has no bank account in the chart of accounts. Add one under 11 Cash and bank.`} />
        </div>
      ) : q.error && !q.data ? (
        <LoadError what="The reconciliation" error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <div className="grid gap-4">
          <Skeleton height={110} />
          <Skeleton height={320} />
        </div>
      ) : (
        <Reconciliation rec={q.data} />
      )}
    </AccountsShell>
  );
}

function Reconciliation({ rec }: { rec: AccountsBankRec }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const go = useGo();
  const canPost = useCan("accounts.post");
  const readOnly = useReadOnly();
  const editable = canPost && !readOnly && !rec.signedOff;
  const [stFilter, setStFilter] = useState("open");
  const [bkFilter, setBkFilter] = useState("open");
  const [pick, setPick] = useState<AccountsStatementLine | null>(null);
  const [peek, setPeek] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const s = rec.summary;
  const bookByKey = useMemo(() => new Map(rec.book.map((b) => [b.key, b])), [rec.book]);
  const setRec = (r: AccountsBankRec) => {
    queryClient.setQueryData(accountsQueries.bankRec(rec.account.code, rec.month).queryKey, r);
    void queryClient.invalidateQueries({ queryKey: ["accounts"], predicate: (qq) => qq.queryKey[1] !== "bank-rec" });
  };
  const body = { account: rec.account.code, month: rec.month };

  const auto = useMutation({
    mutationFn: () => accountsApi.autoMatch(body),
    onSuccess: (r) => {
      setRec(r);
      toast({ title: r.matched ? `${formatCount(r.matched)} lines matched` : "Nothing more to match", message: r.summary.unmatchedStatement ? `${r.summary.unmatchedStatement} statement line${r.summary.unmatchedStatement === 1 ? "" : "s"} still need a voucher or a decision.` : "Every statement line is matched." });
    },
    onError: (e) => toast({ tone: "danger", title: "Not matched", message: errorText(e) }),
  });
  const match = useMutation({
    mutationFn: (v: { st: string; bk: string }) => accountsApi.match({ ...body, statementLineId: v.st, bookLineKey: v.bk }),
    onSuccess: (r) => {
      setPick(null);
      setRec(r);
      toast({ title: "Matched" });
    },
    onError: (e) => toast({ tone: "danger", title: "Not matched", message: errorText(e) }),
  });
  const unmatch = useMutation({
    mutationFn: (st: string) => accountsApi.unmatch({ ...body, statementLineId: st }),
    onSuccess: (r) => {
      setRec(r);
      toast({ title: "Unmatched", message: "Both lines are back in the to-match lists." });
    },
    onError: (e) => toast({ tone: "danger", title: "Not unmatched", message: errorText(e) }),
  });
  const signOff = useMutation({
    mutationFn: () => accountsApi.signOff(body),
    onSuccess: (r) => {
      setSigning(false);
      setRec(r);
      toast({ title: `${monthName(rec.month)} reconciled`, message: `${rec.account.name}: signed off.` });
    },
  });

  /**
   * Statement-only line: book it with a journal voucher (bank items have no cheque or payee, so no approval step).
   * Profit goes to Bank profit; charges to Bank charges; anything else is left for the accountant to choose.
   */
  const record = (l: AccountsStatementLine) => {
    const inflow = l.credit > 0;
    const profit = l.description.startsWith("PROFIT");
    const charge = /CHARGE|EXCISE|FEE/.test(l.description) && !inflow;
    const sentence = `${l.description.charAt(0)}${l.description.slice(1).toLowerCase()}`;
    go(
      "/accounts/vouchers/$voucherId",
      {
        type: "JV",
        date: l.date,
        amount: l.credit || l.debit,
        account: rec.account.code,
        reference: l.reference,
        ...(inflow ? { inflow: 1 } : {}),
        contra: profit ? "4201" : charge ? "5304" : "",
        narration: profit ? `Profit for ${monthName(rec.month)} credited by ${rec.account.bank.bankName}` : `${sentence}, as per ${rec.account.bank.bankName} statement`,
      },
      { voucherId: "new" },
    );
  };

  const stRows = rec.statement.filter((l) => (stFilter === "open" ? !l.matchedTo : true));
  const bkRows = rec.book.filter((l) => (bkFilter === "open" ? !l.matchedTo : true));

  const stColumns: Array<Column<AccountsStatementLine>> = [
    { key: "date", header: "Date", width: 104, render: (l) => <span className="mtb-num">{formatDate(l.date)}</span> },
    {
      key: "desc",
      header: "Statement line",
      render: (l) => (
        <span className="grid min-w-0">
          <span className="mtb-cell-primary truncate">{l.description}</span>
          <span className="mtb-cell-secondary truncate">
            {l.reference}
            {l.matchedTo ? ` · matched to ${bookByKey.get(l.matchedTo)?.voucherNo ?? "an earlier book line"}` : l.suggested ? ` · looks like ${bookByKey.get(l.suggested)?.voucherNo ?? "a book line"}` : ""}
          </span>
        </span>
      ),
    },
    { key: "in", header: "In", align: "right", width: 110, render: (l) => (l.credit ? formatRs(l.credit) : "") },
    { key: "out", header: "Out", align: "right", width: 110, render: (l) => (l.debit ? formatRs(l.debit) : "") },
    {
      key: "act",
      header: <span className="mtb-sr-only">Action</span>,
      width: 150,
      render: (l) =>
        l.matchedTo ? (
          editable ? (
            <Button size="sm" variant="quiet" icon="x" onClick={() => unmatch.mutate(l.id)} aria-label={`Unmatch ${l.description}`}>
              Unmatch
            </Button>
          ) : (
            <StatusBadge status="approved" icon="check">
              Matched
            </StatusBadge>
          )
        ) : editable ? (
          l.suggested ? (
            <Button size="sm" icon="check" onClick={() => match.mutate({ st: l.id, bk: l.suggested! })} aria-label={`Match ${l.description}`}>
              Match
            </Button>
          ) : (
            <Button size="sm" variant="secondary" icon="plus" onClick={() => setPick(l)}>
              Find or record
            </Button>
          )
        ) : (
          <StatusBadge status="pending">Not matched</StatusBadge>
        ),
    },
  ];

  const bkColumns: Array<Column<AccountsBookLine>> = [
    { key: "date", header: "Date", width: 104, render: (l) => <span className="mtb-num">{formatDate(l.date)}</span> },
    {
      key: "desc",
      header: "Voucher",
      render: (l) => (
        <span className="grid min-w-0">
          <span className="mtb-cell-primary truncate">
            <span className="mtb-mono">{l.voucherNo}</span>
          </span>
          <span className="mtb-cell-secondary truncate">
            {l.carried ? "From an earlier month · " : ""}
            {l.description}
          </span>
        </span>
      ),
    },
    { key: "in", header: "In", align: "right", width: 110, render: (l) => (l.debit ? formatRs(l.debit) : "") },
    { key: "out", header: "Out", align: "right", width: 110, render: (l) => (l.credit ? formatRs(l.credit) : "") },
    {
      key: "state",
      header: "Status",
      width: 150,
      render: (l) =>
        l.matchedTo ? (
          <StatusBadge status="approved" icon="check">
            On statement
          </StatusBadge>
        ) : (
          <StatusBadge status="pending">{l.debit ? "Deposit in transit" : "Not yet presented"}</StatusBadge>
        ),
    },
  ];

  const candidates = pick ? rec.book.filter((b) => !b.matchedTo && b.debit === pick.credit && b.credit === pick.debit) : [];

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Bank statement balance", value: rec.statementClosing, foot: `At ${formatDate(rec.statementTo)}` },
          { label: "Balance in our books", value: rec.bookClosing, foot: `At ${formatDate(monthEnd(rec.month) < rec.statementTo ? monthEnd(rec.month) : rec.statementTo)}` },
          { label: "Statement lines to match", value: s.unmatchedStatement, foot: s.suggestions ? `${s.suggestions} with a likely match` : "None with an obvious match", count: true, tone: s.unmatchedStatement ? ("warning" as const) : undefined },
          { label: "Unexplained difference", value: Math.abs(s.difference), foot: s.difference === 0 ? "Every rupee is explained" : "Check the matches", tone: s.difference !== 0 ? ("danger" as const) : undefined },
        ].map((c, i) => (
          <div key={c.label} className="mtb-rise" style={slide(i)}>
            <StatCard label={c.label} {...(c.tone ? { tone: c.tone } : {})} value={<AnimatedNumber value={c.value} format={c.count ? formatCount : formatRs} />} foot={c.foot} />
          </div>
        ))}
      </div>

      {rec.signedOff ? (
        <Banner tone="success" icon="checkCircle" title={`${monthName(rec.month)} is reconciled.`}>
          Signed off by {rec.signedOff.by} on {formatDateTime(rec.signedOff.at)}. Matches for the month are locked.
        </Banner>
      ) : rec.canSignOff ? (
        <Banner
          tone="info"
          icon="checkCircle"
          title="Every statement line is matched."
          actions={
            editable ? (
              <Button size="sm" variant="primary" onClick={() => setSigning(true)}>
                Mark {monthName(rec.month)} reconciled
              </Button>
            ) : undefined
          }
        >
          Items still in the books but not on the statement are normal: deposits and cheques that clear next month.
        </Banner>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel
          id="bank-statement"
          rise={4}
          title={`Bank statement, ${monthName(rec.month)}`}
          description={`${rec.account.bank.bankName}, ${rec.account.bank.branch} · ${rec.account.bank.accountNoMasked}`}
          actions={
            <>
              <Segmented aria-label="Show statement lines" value={stFilter} onChange={setStFilter} options={[{ value: "open", label: `To match · ${s.unmatchedStatement}` }, { value: "all", label: `All · ${rec.statement.length}` }]} />
              {editable && s.suggestions > 0 && (
                <Button size="sm" variant="primary" icon="checkSquare" loading={auto.isPending} loadingLabel="Matching…" onClick={() => auto.mutate()}>
                  Match all suggested ({s.suggestions})
                </Button>
              )}
            </>
          }
          flush
        >
          <DataTable
            caption="Bank statement lines"
            columns={stColumns}
            rows={stRows}
            rowKey="id"
            density="dense"
            maxHeight={460}
            rowClassName={() => "mtb-slide-in"}
            empty={<EmptyState icon="checkCircle" title="Every statement line is matched" description="Switch to All to see the matched lines." />}
          />
        </Panel>

        <Panel id="bank-summary" rise={5} title="Reconciliation statement" description={`At ${formatDate(monthEnd(rec.month))}`}>
          <table className="acc-stmt">
            <tbody>
              <tr>
                <td>Balance as per bank statement</td>
                <td className="num">{formatRs(rec.statementClosing)}</td>
              </tr>
              <tr className="sub">
                <td>Add: deposits not yet on the statement</td>
                <td className="num">{formatRs(s.depositsInTransit)}</td>
              </tr>
              <tr className="sub">
                <td>Less: cheques not yet presented</td>
                <td className="num">({formatRs(s.chequesNotPresented)})</td>
              </tr>
              <tr className="sub">
                <td>Less: bank credits not yet in the books</td>
                <td className="num">({formatRs(s.bankCreditsNotBooked)})</td>
              </tr>
              <tr className="sub">
                <td>Add: bank charges not yet in the books</td>
                <td className="num">{formatRs(s.bankDebitsNotBooked)}</td>
              </tr>
              <tr className="tot">
                <td>Adjusted bank balance</td>
                <td className="num">{formatRs(s.adjustedStatement)}</td>
              </tr>
              <tr>
                <td>Balance as per our books</td>
                <td className="num">{formatRs(rec.bookClosing)}</td>
              </tr>
              <tr className="grand">
                <td>
                  <span className="inline-flex items-center gap-1.5">
                    {s.difference === 0 && <Icon name="checkCircle" size={16} className="text-success-ink" />} Difference
                  </span>
                </td>
                <td className="num">{formatRs(s.difference)}</td>
              </tr>
            </tbody>
          </table>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" icon="printer" onClick={() => window.print()}>
              Print statement
            </Button>
          </div>
        </Panel>
      </div>

      <Panel
        id="bank-books"
        rise={6}
        title={`Our books: ${rec.account.name}`}
        description="Bank lines from posted vouchers. Click one to see its voucher."
        actions={<Segmented aria-label="Show book lines" value={bkFilter} onChange={setBkFilter} options={[{ value: "open", label: `Not on the statement · ${s.unmatchedBook}` }, { value: "all", label: `All · ${rec.book.length}` }]} />}
        flush
      >
        <DataTable
          caption="Book lines on this bank account"
          columns={bkColumns}
          rows={bkRows}
          rowKey="key"
          density="dense"
          maxHeight={420}
          onRowClick={(l) => setPeek(l.voucherId)}
          rowClassName={() => "mtb-slide-in"}
          empty={<EmptyState icon="checkCircle" title="Everything in the books is on the statement" />}
        />
      </Panel>

      <SidePanel
        open={Boolean(pick)}
        onClose={() => setPick(null)}
        title="Match this statement line"
        description={pick ? `${formatDate(pick.date)} · ${pick.description} · ${formatRs(pick.credit || pick.debit)} ${pick.credit ? "in" : "out"}` : ""}
        footer={
          <>
            <Button onClick={() => setPick(null)}>Cancel</Button>
            {pick && (
              <Button variant="primary" icon="plus" onClick={() => record(pick)}>
                Record it with a voucher
              </Button>
            )}
          </>
        }
      >
        {candidates.length === 0 ? (
          <div className="grid gap-3">
            <Banner tone="neutral" title="Nothing in the books has this amount.">
              {pick?.credit ? "The bank received money that isn't in the books yet, such as profit or a direct transfer." : "The bank took money that isn't in the books yet, such as a charge."} Record it with a voucher; once it is posted, it can be matched here.
            </Banner>
          </div>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {candidates.map((b, i) => (
              <li key={b.key} className="mtb-slide-in flex items-center justify-between gap-3 rounded-md border border-border p-3" style={slide(i)}>
                <span className="grid">
                  <span className="mtb-mono">{b.voucherNo}</span>
                  <span className="text-small text-ink-muted">
                    {formatDate(b.date)} · {b.description}
                  </span>
                </span>
                <Button size="sm" icon="check" loading={match.isPending} onClick={() => pick && match.mutate({ st: pick.id, bk: b.key })}>
                  Match
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SidePanel>

      <VoucherPeek id={peek} onClose={() => setPeek(null)} />

      <ConfirmDialog
        open={signing}
        onClose={() => setSigning(false)}
        onConfirm={() => signOff.mutate()}
        title={`Mark ${monthName(rec.month)} reconciled?`}
        message="The month's matches are locked and the month-close check for this bank is ticked."
        details={[
          ["Bank account", rec.account.name],
          ["Statement balance", formatRs(rec.statementClosing)],
          ["Book balance", formatRs(rec.bookClosing)],
          ["Difference", formatRs(s.difference)],
        ]}
        confirmLabel="Mark reconciled"
        loading={signOff.isPending}
        loadingLabel="Saving…"
        {...(signOff.error ? { error: errorText(signOff.error) } : {})}
      />

      <div className="acc-print-only mtb-print-area" aria-hidden="true">
        <article className="acc-doc">
          <DocHead title="Bank reconciliation statement" subtitle={`${rec.account.name} (${rec.account.bank.accountNoMasked}) · ${monthName(rec.month)}`} />
          <table>
            <tbody>
              <tr>
                <td>Balance as per bank statement</td>
                <td className="num">{formatRs(rec.statementClosing)}</td>
              </tr>
              <tr>
                <td>Add: deposits not yet on the statement</td>
                <td className="num">{formatRs(s.depositsInTransit)}</td>
              </tr>
              <tr>
                <td>Less: cheques not yet presented</td>
                <td className="num">({formatRs(s.chequesNotPresented)})</td>
              </tr>
              <tr>
                <td>Less: bank credits not yet in the books</td>
                <td className="num">({formatRs(s.bankCreditsNotBooked)})</td>
              </tr>
              <tr>
                <td>Add: bank charges not yet in the books</td>
                <td className="num">{formatRs(s.bankDebitsNotBooked)}</td>
              </tr>
              <tr>
                <td>
                  <b>Balance as per books</b>
                </td>
                <td className="num">
                  <b>{formatRs(rec.bookClosing)}</b>
                </td>
              </tr>
              <tr>
                <td>Difference</td>
                <td className="num">{formatRs(s.difference)}</td>
              </tr>
            </tbody>
          </table>
          <h2 style={{ marginTop: 12 }}>Items in the books, not on the statement</h2>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Voucher</th>
                <th>Description</th>
                <th className="num">In</th>
                <th className="num">Out</th>
              </tr>
            </thead>
            <tbody>
              {rec.book
                .filter((b) => !b.matchedTo)
                .map((b) => (
                  <tr key={b.key}>
                    <td>{formatDate(b.date)}</td>
                    <td>{b.voucherNo}</td>
                    <td>{b.description}</td>
                    <td className="num">{b.debit ? formatRs(b.debit) : ""}</td>
                    <td className="num">{b.credit ? formatRs(b.credit) : ""}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <DocFoot />
        </article>
      </div>
    </>
  );
}
