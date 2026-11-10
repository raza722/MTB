import { accountsApi, accountsQueries, newIdempotencyKey, type AccountsFeeBatch, type AccountsPostingRule, type CampusCode } from "@mtb/api";
import { formatCount, formatDate, formatDateTime, formatRs, formatWeekday } from "@mtb/domain";
import {
  AnimatedNumber,
  Banner,
  Button,
  ColumnChart,
  Combobox,
  ConfirmDialog,
  DataTable,
  EmptyState,
  KeyValue,
  Money,
  Panel,
  Segmented,
  Select,
  SidePanel,
  Skeleton,
  StatCard,
  StatusBadge,
  useToast,
  type Column,
} from "@mtb/ui";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { accountOptions, AccountsShell, accToday, asOfFor, errorText, lakhTick, LoadError, monthName, monthsSoFar, shortDate, slide, useChart } from "./shared";
import { DayReceiptsLink, VoucherPeek } from "./VoucherPeek";

export interface FeePostingSearch {
  month?: string;
  /** "KC:2026-10-28" opens that day's batch. */
  batch?: string;
}

/** Cash or bank of a batch: "—" on a day of the old system, which kept no payment method (the server sends null). */
const rsOrDash = (v: number | null) => (v === null ? "—" : formatRs(v));

function BatchStatus({ b }: { b: AccountsFeeBatch }) {
  if (b.status === "OPEN") return <StatusBadge status="pending">{b.date === accToday() ? "Counter open" : "Not posted yet"}</StatusBadge>;
  if (b.status === "DIFFERENCE")
    return (
      <StatusBadge status="overdue" icon="alertCircle">
        {b.difference > 0 ? `${formatRs(b.difference)} not posted` : `${formatRs(-b.difference)} too much`}
      </StatusBadge>
    );
  return (
    <StatusBadge status="approved" icon="check">
      Agrees
    </StatusBadge>
  );
}

/** /accounts/fee-posting — each day's fee collection, posted to the ledger, checked against the fee office's own total. */
export function FeePostingPage({ search, setSearch }: { search: FeePostingSearch; setSearch: (next: FeePostingSearch) => void }) {
  const ctx = useCtx();
  const months = monthsSoFar(ctx.session);
  const month = search.month && months.includes(search.month) ? search.month : (months.at(-1) ?? asOfFor(ctx.session).slice(0, 7));
  const q = useQuery({ ...accountsQueries.feeMonth(ctx, month), placeholderData: keepPreviousData });
  const [only, setOnly] = useState("all");
  const [chart, setChart] = useState("chart");
  const [closing, setClosing] = useState<AccountsFeeBatch | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const toast = useToast();
  const queryClient = useQueryClient();
  const canPost = useCan("accounts.post");
  const readOnly = useReadOnly();
  const d = q.data;

  const open = (d?.batches ?? []).filter((b) => b.status === "OPEN");
  const list = (d?.batches ?? []).filter((b) => (only === "attention" ? b.status !== "POSTED" || b.cancellations.pending > 0 : true));
  const byDay = useMemo(() => {
    const m = new Map<string, { date: string; feeOffice: number; ledger: number; receipts: number }>();
    for (const b of d?.batches ?? []) {
      const x = m.get(b.date) ?? { date: b.date, feeOffice: 0, ledger: 0, receipts: 0 };
      x.feeOffice += b.feeOfficeTotal;
      x.ledger += b.ledgerTotal;
      x.receipts += b.receipts;
      m.set(b.date, x);
    }
    return [...m.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [d]);

  const closeDay = useMutation({
    mutationFn: ({ b, k }: { b: AccountsFeeBatch; k: string }) => accountsApi.postFeeBatch(b.campus, b.date, k),
    onSuccess: (r) => {
      setClosing(null);
      setKey(null);
      void queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast({ title: `${r.campusName}: ${formatDate(r.date)} posted`, message: `${formatRs(r.ledgerTotal)} from ${formatCount(r.receipts)} receipts is now in the ledger.` });
    },
  });

  const columns: Array<Column<AccountsFeeBatch>> = [
    { key: "date", header: "Day", width: 150, render: (b) => <span className="mtb-num">{`${formatWeekday(b.date).slice(0, 3)} ${formatDate(b.date)}`}</span> },
    ...(ctx.campus === "ALL" ? [{ key: "campus", header: "Campus", width: 150, render: (b: AccountsFeeBatch) => b.campusName }] : []),
    { key: "receipts", header: "Receipts", align: "right", width: 90, render: (b) => formatCount(b.receipts) },
    { key: "office", header: "Fee office total", align: "right", width: 150, render: (b) => <Money value={b.feeOfficeTotal} /> },
    { key: "ledger", header: "Posted to ledger", align: "right", width: 150, render: (b) => <Money value={b.ledgerTotal} /> },
    { key: "diff", header: "Difference", align: "right", width: 120, render: (b) => (b.difference ? <span className="font-semibold text-danger-ink">{formatRs(b.difference)}</span> : <span className="text-ink-muted">—</span>) },
    {
      key: "status",
      header: "Status",
      width: 220,
      render: (b) => (
        <span className="flex flex-wrap gap-1.5">
          <BatchStatus b={b} />
          {b.cancellations.pending > 0 && <StatusBadge status="pending">{b.cancellations.pending} cancellation waiting</StatusBadge>}
        </span>
      ),
    },
  ];

  return (
    <AccountsShell title="Fee posting">
      <section className="mtb-card mtb-rise flex flex-wrap items-end gap-4 p-5" aria-label="Month">
        <div className="w-48">
          <Select label="Month" value={month} onChange={(e) => setSearch({ month: e.target.value })} options={[...months].reverse().map((m) => ({ value: m, label: monthName(m) }))} />
        </div>
        <p className="m-0 max-w-2xl text-small text-ink-muted">
          Every receipt the fee office posts is added to the day's batch. When the counter closes at 6:00 PM the batch posts to the ledger by itself: cash to Cash in hand, bank challans and online payments to the campus bank, and each fee head to its income account. A day agrees when the fee office's total equals what reached the ledger.
        </p>
      </section>

      {q.error && !d ? (
        <LoadError what="Fee postings" error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Fee office total", value: d?.totals.feeOffice, icon: "fees" as const, foot: `${monthName(month)}, ${formatCount(d?.totals.days ?? 0)} collection days` },
              { label: "Posted to the ledger", value: d?.totals.ledger, icon: "book" as const, foot: `${formatCount(d?.totals.posted ?? 0)} batches agree` },
              { label: "Difference", value: d ? Math.abs(d.totals.difference) : undefined, icon: d && d.totals.difference !== 0 ? ("alertCircle" as const) : ("checkCircle" as const), tone: d && d.totals.differences > 0 ? ("danger" as const) : undefined, foot: d ? (d.totals.differences ? `${d.totals.differences} day${d.totals.differences === 1 ? "" : "s"} to put right` : d.totals.open ? "Today's counter is still open" : "Every day agrees") : "" },
              { label: "Days agreeing", value: d ? d.totals.posted : undefined, icon: "listChecks" as const, foot: d ? `of ${formatCount(d.batches.length)} batches` : "", count: true },
            ].map((c, i) => (
              <div key={c.label} className="mtb-rise" style={slide(i)}>
                <StatCard label={c.label} icon={c.icon} {...(c.tone ? { tone: c.tone } : {})} loading={!d} value={c.value === undefined ? "" : <AnimatedNumber value={c.value} format={c.count ? formatCount : formatRs} />} foot={c.foot} />
              </div>
            ))}
          </div>

          {open.length > 0 && (
            <Panel
              id="fee-today"
              rise={4}
              title={open.every((b) => b.date === accToday()) ? "Today at the counter" : "Not posted yet"}
              description={
                open.every((b) => b.date === accToday())
                  ? `${formatDate(accToday())}. Receipts are still being taken; the batch posts by itself at 6:00 PM.`
                  : "Today's batch posts by itself at 6:00 PM. An earlier day still here could not post by itself (for example, the campus's bank account isn't set up in Accounts)."
              }
            >
              <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 xl:grid-cols-3">
                {open.map((b, i) => (
                  <li key={b.key} className="mtb-slide-in grid gap-2 rounded-md border border-border p-4" style={slide(i)}>
                    <span className="text-small font-medium text-ink-muted">
                      {b.campusName}
                      {b.date === accToday() ? "" : ` · ${formatDate(b.date)}`}
                    </span>
                    <span className="text-title-3 tabular-nums">
                      <AnimatedNumber value={b.feeOfficeTotal} format={formatRs} />
                    </span>
                    <span className="text-small text-ink-muted">
                      {formatCount(b.receipts)} receipts{b.date === accToday() ? " so far" : ""}
                    </span>
                    {canPost && !readOnly && (
                      <Button
                        size="sm"
                        icon="lock"
                        onClick={() => {
                          setKey(newIdempotencyKey());
                          closeDay.reset();
                          setClosing(b);
                        }}
                      >
                        {b.date === accToday() ? "Close the day and post now" : "Post now"}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel
            id="fee-days"
            rise={5}
            title="Fee office against the ledger, day by day"
            description="Columns are what reached the ledger; the bar across each is the fee office's total. A gap means part of a day wasn't posted."
            actions={<Segmented aria-label="Show days as" value={chart} onChange={setChart} options={[{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }]} />}
          >
            {!d ? (
              <Skeleton height={240} />
            ) : byDay.length === 0 ? (
              <EmptyState icon="fees" title="No fee collections this month" description="Days appear here as the fee office takes receipts." />
            ) : chart === "chart" ? (
              <ColumnChart
                data={byDay}
                value={(x) => x.ledger}
                target={(x) => x.feeOffice}
                axisLabel={(x) => (x.date === accToday() ? "Today" : shortDate(x.date).slice(0, 2))}
                formatAxis={lakhTick}
                valueLabel="Posted to the ledger"
                targetLabel="Fee office total"
                partial={(x) => x.date === accToday()}
                partialLabel="Counter still open"
                tooltip={(x) => (
                  <>
                    <div className="mtb-chart-tip-title">
                      {formatWeekday(x.date)} {formatDate(x.date)}
                    </div>
                    <div className="mtb-chart-tip-row">
                      <span>Fee office</span>
                      <span>{formatRs(x.feeOffice)}</span>
                    </div>
                    <div className="mtb-chart-tip-row">
                      <span>Ledger</span>
                      <span>{formatRs(x.ledger)}</span>
                    </div>
                    {x.feeOffice !== x.ledger && (
                      <div className="mtb-chart-tip-row">
                        <span>Difference</span>
                        <span>{formatRs(x.feeOffice - x.ledger)}</span>
                      </div>
                    )}
                  </>
                )}
                describe={(x) => `${formatDate(x.date)}: fee office ${formatRs(x.feeOffice)}, ledger ${formatRs(x.ledger)}`}
                label={`Fee office total and ledger postings by day, ${monthName(month)}`}
              />
            ) : (
              <DataTable
                rows={[...byDay].reverse()}
                rowKey="date"
                density="dense"
                maxHeight={300}
                caption="Totals by day"
                columns={[
                  { key: "date", header: "Day", render: (x) => `${formatWeekday(x.date).slice(0, 3)} ${formatDate(x.date)}` },
                  { key: "receipts", header: "Receipts", align: "right", render: (x) => formatCount(x.receipts) },
                  { key: "office", header: "Fee office", align: "right", render: (x) => <Money value={x.feeOffice} /> },
                  { key: "ledger", header: "Ledger", align: "right", render: (x) => <Money value={x.ledger} /> },
                ]}
              />
            )}
          </Panel>

          <DataTable
            caption={`Fee batches, ${monthName(month)}`}
            columns={columns}
            rows={list}
            rowKey="key"
            loading={!d}
            onRowClick={(b) => setSearch({ month, batch: b.key })}
            rowClassName={(b) => (b.status === "DIFFERENCE" ? "mtb-slide-in bg-status-overdue-tint" : "mtb-slide-in")}
            toolbar={
              <div className="flex w-full flex-wrap items-center justify-between gap-3">
                <Segmented aria-label="Show" value={only} onChange={setOnly} options={[{ value: "all", label: "Every day" }, { value: "attention", label: "Needs attention" }]} />
                <span className="text-small text-ink-muted">Click a day to see its heads, payment methods and vouchers.</span>
              </div>
            }
            empty={<EmptyState icon="checkCircle" title={only === "attention" ? "Every day agrees" : "No fee collections this month"} description={only === "attention" ? "The fee office's totals equal the ledger for every day this month." : "Days appear here as the fee office takes receipts."} />}
          />
        </>
      )}

      <PostingRules />

      {search.batch && <BatchPanel batchKey={search.batch} onClose={() => setSearch({ month })} />}

      <ConfirmDialog
        open={Boolean(closing)}
        onClose={() => setClosing(null)}
        onConfirm={() => closing && key && closeDay.mutate({ b: closing, k: key })}
        title={closing && closing.date !== accToday() ? `Post ${formatDate(closing.date)} at ${closing.campusName} now?` : `Close the day at ${closing?.campusName ?? ""} and post now?`}
        message={
          closing && closing.date !== accToday()
            ? "The day's batch posts to the ledger with the fee office's total for that day."
            : "Today's batch posts to the ledger with the fee office's total so far. Receipts taken after this go into a second batch for the difference."
        }
        details={closing ? [["Fee office so far", formatRs(closing.feeOfficeTotal)], ["Receipts", formatCount(closing.receipts)], ["Date", formatDate(closing.date)]] : []}
        confirmLabel={`Post ${closing ? formatRs(closing.feeOfficeTotal) : ""}`}
        icon="lock"
        loading={closeDay.isPending}
        loadingLabel="Posting…"
        {...(closeDay.error ? { error: errorText(closeDay.error) } : {})}
      />
    </AccountsShell>
  );
}

/** One day's batch: heads, payment methods, vouchers, cancellations, and the fix when it doesn't agree. */
function BatchPanel({ batchKey, onClose }: { batchKey: string; onClose: () => void }) {
  const [campus, date] = batchKey.split(":") as [CampusCode, string];
  const q = useQuery(accountsQueries.feeBatch(campus, date ?? ""));
  const b = q.data;
  const toast = useToast();
  const queryClient = useQueryClient();
  const canPost = useCan("accounts.post");
  const readOnly = useReadOnly();
  const [peek, setPeek] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [key] = useState(() => newIdempotencyKey());
  const post = useMutation({
    mutationFn: () => accountsApi.postFeeBatch(campus, date ?? "", key),
    onSuccess: (r) => {
      setConfirm(false);
      queryClient.setQueryData(accountsQueries.feeBatch(campus, date ?? "").queryKey, r);
      void queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast({ title: "Difference posted", message: `${r.campusName}, ${formatDate(r.date)} now agrees with the fee office: ${formatRs(r.ledgerTotal)}.` });
    },
  });
  return (
    <SidePanel
      open
      onClose={onClose}
      wide
      title={b ? `${b.campusName}: ${formatWeekday(b.date)} ${formatDate(b.date)}` : "Fee batch"}
      description="What the fee office collected, and how it reached the ledger."
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          {b && b.status !== "POSTED" && b.difference > 0 && canPost && !readOnly && (
            <Button variant="primary" icon="lock" onClick={() => setConfirm(true)}>
              {b.status === "OPEN" ? `Post ${formatRs(b.feeOfficeTotal)} now` : `Post the difference · ${formatRs(b.difference)}`}
            </Button>
          )}
        </>
      }
    >
      {q.isLoading ? (
        <div className="grid gap-3" aria-busy="true">
          <Skeleton height={20} width="50%" />
          <Skeleton height={140} />
        </div>
      ) : !b ? (
        <p className="m-0 text-ink-muted">{q.error ? errorText(q.error) : "No collection that day."}</p>
      ) : (
        <div className="grid gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <BatchStatus b={b} />
            {b.postedBy && (
              <span className="text-small text-ink-muted">
                Last posted by {b.postedBy}, {formatDateTime(b.postedAt ?? "")}
              </span>
            )}
            <span className="ms-auto">
              <DayReceiptsLink campus={b.campus} date={b.date} />
            </span>
          </div>
          {b.status === "DIFFERENCE" && (
            <Banner tone="warning" title={`The ledger is ${formatRs(Math.abs(b.difference))} ${b.difference > 0 ? "short" : "over"}.`}>
              {b.note ?? "Receipts were taken after the batch posted."} Posting the difference brings the day into agreement; nothing is changed in the fee office.
            </Banner>
          )}
          <KeyValue
            items={[
              ["Fee office total", formatRs(b.feeOfficeTotal)],
              ["Posted to the ledger", formatRs(b.ledgerTotal)],
              ["Receipts", formatCount(b.receipts)],
              ["Cash / bank in the ledger", `${rsOrDash(b.cash)} / ${rsOrDash(b.bank)}`],
            ]}
          />
          {b.note && b.status !== "DIFFERENCE" && <p className="m-0 text-small text-ink-muted">{b.note}</p>}
          <div className="grid gap-2">
            <h3 className="m-0 text-title-3">By fee head</h3>
            <DataTable
              rows={b.heads}
              rowKey="head"
              density="dense"
              stickyHeader={false}
              caption="Collection by fee head"
              columns={[
                { key: "title", header: "Fee head", render: (h) => h.title },
                { key: "acc", header: "Posts to", render: (h) => <span className="text-ink-muted"><span className="mtb-mono">{h.accountCode}</span> {h.accountName}</span> },
                { key: "amount", header: "Amount", align: "right", width: 130, render: (h) => <Money value={h.amount} /> },
              ]}
              footer={{ title: "Total", amount: <Money value={b.feeOfficeTotal} /> }}
            />
          </div>
          <div className="grid gap-2">
            <h3 className="m-0 text-title-3">By payment method</h3>
            <DataTable
              rows={b.methods}
              rowKey="method"
              density="dense"
              stickyHeader={false}
              caption="Collection by payment method"
              columns={[
                { key: "label", header: "Method", render: (m) => m.label },
                { key: "acc", header: "Goes to", render: (m) => <span className="text-ink-muted">{m.accountName}</span> },
                { key: "amount", header: "Amount", align: "right", width: 130, render: (m) => <Money value={m.amount} /> },
              ]}
              empty={<p className="m-0 p-3 text-small text-ink-muted">Not known: the old system did not record how parents paid.</p>}
            />
          </div>
          <div className="grid gap-2">
            <h3 className="m-0 text-title-3">Vouchers</h3>
            {b.vouchers.length === 0 ? (
              <p className="m-0 text-small text-ink-muted">
                {b.ledgerTotal > 0 ? "Posted by the old system, one voucher per receipt." : b.date === accToday() ? "Nothing posted yet: the counter is still open." : "Nothing posted yet."}
              </p>
            ) : (
              <ul className="m-0 grid list-none gap-1 p-0">
                {b.vouchers.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-3">
                    <Button size="sm" variant="quiet" onClick={() => setPeek(v.id)}>
                      <span className="mtb-mono">{v.voucherNo}</span>
                      {v.supplement ? " · difference" : ""}
                    </Button>
                    <Money value={v.amount} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          {b.cancellationList.length > 0 && (
            <div className="grid gap-2">
              <h3 className="m-0 text-title-3">Receipt cancellations</h3>
              <ul className="m-0 grid list-none gap-2 p-0">
                {b.cancellationList.map((c) => (
                  <li key={c.receiptNo} className="flex flex-wrap items-center justify-between gap-2 text-small">
                    <span>
                      <span className="mtb-mono">{c.receiptNo}</span> · {c.studentName} · {formatRs(c.amount)}
                    </span>
                    {c.status === "PENDING" ? <StatusBadge status="pending">Waiting for the principal</StatusBadge> : <StatusBadge status="approved">Reversed in {c.voucherNo ?? "the ledger"}</StatusBadge>}
                  </li>
                ))}
              </ul>
              <span className="text-small text-ink-muted">When the principal approves a cancellation, its income is reversed in the ledger automatically.</span>
            </div>
          )}
        </div>
      )}
      <VoucherPeek id={peek} onClose={() => setPeek(null)} />
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => post.mutate()}
        title="Post to the ledger?"
        message="A fee batch voucher is posted for the amount below, so the day agrees with the fee office."
        details={b ? [["Day", `${b.campusName}, ${formatDate(b.date)}`], ["Amount", formatRs(b.difference)]] : []}
        confirmLabel={b ? `Post ${formatRs(b.difference)}` : "Post"}
        icon="lock"
        loading={post.isPending}
        loadingLabel="Posting…"
        {...(post.error ? { error: errorText(post.error) } : {})}
      />
    </SidePanel>
  );
}

/** Which account each fee head posts to (data, not code: the old system had these fixed in the program). */
function PostingRules() {
  const q = useQuery(accountsQueries.postingRules());
  const canPost = useCan("accounts.post");
  const readOnly = useReadOnly();
  const [edit, setEdit] = useState<AccountsPostingRule | null>(null);
  return (
    <Panel id="fee-rules" rise={6} title="Where fee collections post" description="Each fee head has its own account. Changes apply to batches posted from now on; posted vouchers never change." flush>
      <DataTable
        rows={q.data ?? []}
        rowKey="head"
        loading={q.isLoading}
        caption="Posting rules for fee collections"
        columns={[
          { key: "title", header: "Fee head or payment", render: (r) => <span className="grid"><span className="mtb-cell-primary">{r.title}</span>{r.note && <span className="mtb-cell-secondary">{r.note}</span>}</span> },
          { key: "acc", header: "Account", render: (r) => (r.accountCode ? <span><span className="mtb-mono text-ink-muted">{r.accountCode}</span> {r.accountName}</span> : r.accountName) },
          {
            key: "edit",
            header: <span className="mtb-sr-only">Change</span>,
            width: 110,
            render: (r) =>
              canPost && !readOnly && r.category !== "PAYMENT" ? (
                <Button size="sm" variant="quiet" icon="edit" onClick={() => setEdit(r)} aria-label={`Change the account for ${r.title}`}>
                  Change
                </Button>
              ) : null,
          },
        ]}
      />
      {edit && <RulePanel rule={edit} onClose={() => setEdit(null)} />}
    </Panel>
  );
}

function RulePanel({ rule, onClose }: { rule: AccountsPostingRule; onClose: () => void }) {
  const { accounts } = useChart();
  const [code, setCode] = useState<string | null>(rule.accountCode);
  const toast = useToast();
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: () => accountsApi.updatePostingRule(rule.head, code ?? ""),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast({ title: `${r.title} now posts to ${r.accountCode} ${r.accountName}`, message: "From the next fee batch onwards." });
      onClose();
    },
  });
  return (
    <SidePanel
      open
      onClose={onClose}
      title={`Posting rule: ${rule.title}`}
      description="The account this fee head's collections are credited to."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} loadingLabel="Saving…" disabled={!code || code === rule.accountCode} onClick={() => save.mutate()}>
            Save rule
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Combobox
          label="Account"
          required
          options={accountOptions(accounts, (a) => !a.campus && (a.accountClass === "INCOME" || a.accountClass === "LIABILITY"))}
          value={code}
          onValueChange={setCode}
          placeholder="Choose an income account…"
          searchPlaceholder="Type a code or name"
          {...(save.error ? { error: errorText(save.error) } : {})}
        />
        <Banner tone="neutral" title="Posted vouchers stay as they are.">
          To move what was already posted, use a journal voucher.
        </Banner>
      </div>
    </SidePanel>
  );
}
