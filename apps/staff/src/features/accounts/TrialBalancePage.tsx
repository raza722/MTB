import { accountsQueries, ApiError, type AccountsTrialRow } from "@mtb/api";
import { formatCount, formatDate, formatRs } from "@mtb/domain";
import { AnimatedNumber, Banner, Button, cx, DatePicker, EmptyState, Icon, Segmented, Skeleton, StatCard } from "@mtb/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { z } from "zod";
import { useCtx } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import { AccountsShell, accToday, asOfFor, Bal, DocFoot, DocHead, LoadError, sessionStartOf, slide, useGo } from "./shared";

export type TrialDepth = "1" | "2" | "3" | "4" | "5" | "all";
export type TrialView = "balances" | "movement" | "period";

export interface TrialSearch {
  /** Start of the movement columns; the session start when left out. */
  from?: string;
  asOf?: string;
  /** Roll up to this level (1 = classes, 2 = groups, 3 = sub-groups), or every account. */
  depth?: TrialDepth;
  view?: TrialView;
}

const dr = (n: number) => (n > 0 ? n : 0);
const cr = (n: number) => (n < 0 ? -n : 0);
const amt = (n: number) => (n ? formatRs(n) : "");

const LEVEL_NAME = ["classes", "groups", "sub-groups", "level 4", "level 5"];

const rangeSchema = z
  .object({ from: z.string(), asOf: z.string() })
  .refine((r) => r.from <= r.asOf, { path: ["from"], message: "From must be on or before To." });

/**
 * /accounts/trial-balance — every account's balance at a date, for one campus or all together; it must balance.
 * A From date gives the movement for a period (the old "Trial Balance" of one month), and the level picker rolls the
 * figures up to classes, groups or sub-groups (the old "Trial Balance Level Wise").
 */
export function TrialBalancePage({ search, setSearch }: { search: TrialSearch; setSearch: (next: TrialSearch) => void }) {
  const ctx = useCtx();
  const go = useGo();
  const start = sessionStartOf(ctx.session);
  const end = asOfFor(ctx.session);
  const monthStart = `${end.slice(0, 7)}-01`;
  const from = search.from ?? start;
  const asOf = search.asOf ?? end;
  const depth: TrialDepth = search.depth ?? "all";
  const view: TrialView = search.view ?? "balances";
  const range = rangeSchema.safeParse({ from, asOf });
  const rangeError = range.success ? undefined : range.error.issues[0]?.message;
  const q = useQuery({ ...accountsQueries.trialBalance(ctx, { from, asOf }), enabled: range.success, placeholderData: keepPreviousData });
  const tb = range.success ? q.data : undefined;
  const serverFromError = q.error instanceof ApiError && q.error.field === "from" ? q.error.message : undefined;
  const fromError = rangeError ?? serverFromError;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  // Levels the chart has: one per group depth, then every account.
  const maxGroupDepth = useMemo(() => Math.max(1, ...(tb?.rows ?? []).filter((r) => !r.postable).map((r) => r.depth)), [tb]);
  const maxLevel = Math.min(maxGroupDepth + 1, 5);
  const level = depth === "all" ? "all" : String(Math.min(Number(depth), maxLevel));
  const levelOptions = [
    ...Array.from({ length: maxLevel }, (_, i) => ({ value: String(i + 1), label: `Level ${i + 1} · ${LEVEL_NAME[i] ?? ""}` })),
    { value: "all", label: "Every account" },
  ];

  const byCode = useMemo(() => new Map((tb?.rows ?? []).map((r) => [r.code, r])), [tb]);
  const inLevel = (r: AccountsTrialRow) => (level === "all" ? true : !r.postable && r.depth < Number(level));
  const moved = (r: AccountsTrialRow) => r.debit !== 0 || r.credit !== 0;
  const hiddenByParent = (r: AccountsTrialRow) => {
    let p = r.parentCode;
    while (p) {
      if (collapsed.has(p)) return true;
      p = byCode.get(p)?.parentCode ?? null;
    }
    return false;
  };
  const levelRows = (tb?.rows ?? []).filter((r) => inLevel(r) && (view !== "period" || moved(r)));
  const rows = levelRows.filter((r) => !hiddenByParent(r));
  const hasChildren = (r: AccountsTrialRow) => !r.postable && levelRows.some((x) => x.parentCode === r.code);
  const toggle = (code: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const openLedger = (r: AccountsTrialRow) => r.postable && go("/accounts/ledger", { account: r.code, from: from === start ? undefined : from, to: asOf });
  const period = from === start && asOf === end ? "session" : from === monthStart && asOf === end ? "month" : "custom";
  const cols = view === "movement" ? 5 : 3;
  const periodText = `${formatDate(from)} to ${formatDate(asOf)}`;

  const cards =
    view === "period"
      ? [
          { label: "Debits in the period", value: tb?.totals.debit, foot: periodText },
          { label: "Credits in the period", value: tb?.totals.credit, foot: periodText },
          { label: "Vouchers in the period", value: tb?.vouchers, foot: "Posted vouchers, by voucher date", count: true },
        ]
      : [
          { label: "Total debits", value: tb?.totals.closingDebit, foot: `Accounts with a debit balance at ${formatDate(asOf)}` },
          { label: "Total credits", value: tb?.totals.closingCredit, foot: `Accounts with a credit balance at ${formatDate(asOf)}` },
          { label: from === start ? "Posted this session" : "Posted in the period", value: tb ? tb.totals.debit : undefined, foot: `${formatCount(tb?.vouchers ?? 0)} vouchers, ${periodText}` },
        ];

  return (
    <AccountsShell
      title="Trial balance"
      actions={
        <Button icon="printer" onClick={() => window.print()} disabled={!tb}>
          Print
        </Button>
      }
    >
      <section className="mtb-card mtb-rise grid gap-4 p-5" aria-label="Options">
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-44">
            <DatePicker
              label="From"
              value={from}
              onValueChange={(v) => setSearch({ ...search, from: v && v !== start ? v : undefined })}
              today={accToday()}
              minDate={start}
              maxDate={asOf}
              {...(fromError ? { error: fromError } : {})}
            />
          </div>
          <div className="w-44">
            <DatePicker label="To" value={asOf} onValueChange={(v) => setSearch({ ...search, asOf: v && v !== end ? v : undefined })} today={accToday()} minDate={from <= end ? from : start} maxDate={end} />
          </div>
          <Segmented
            aria-label="Period"
            value={period}
            onChange={(v) => setSearch({ ...search, from: v === "month" ? monthStart : undefined, asOf: undefined })}
            options={[
              { value: "month", label: "This month" },
              { value: "session", label: "Session" },
              ...(period === "custom" ? [{ value: "custom", label: "Custom" }] : []),
            ]}
          />
          <p className="m-0 ms-auto max-w-sm text-small text-ink-muted">
            {campusLabel(ctx.campus)}. Balances are at the To date; movement runs From to To. Uses each voucher's own date, so back-dated vouchers land in the right month.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="grid gap-1">
            <span className="text-small font-medium">Roll up to</span>
            <Segmented
              aria-label="Roll up to"
              value={level}
              onChange={(v) => {
                setCollapsed(new Set());
                setSearch({ ...search, depth: v === "all" ? undefined : (v as TrialDepth) });
              }}
              options={levelOptions}
            />
          </div>
          <div className="grid gap-1">
            <span className="text-small font-medium">Columns</span>
            <Segmented
              aria-label="Columns"
              value={view}
              onChange={(v) => setSearch({ ...search, view: v === "balances" ? undefined : (v as TrialView) })}
              options={[
                { value: "balances", label: "Balances" },
                { value: "period", label: "Period movement" },
                { value: "movement", label: "Opening, movement, closing" },
              ]}
            />
          </div>
          {collapsed.size > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setCollapsed(new Set())}>
              Expand all
            </Button>
          )}
        </div>
      </section>

      {q.error && !tb && !serverFromError ? (
        <LoadError what="The trial balance" error={q.error} onRetry={() => void q.refetch()} />
      ) : fromError ? (
        <div className="mtb-card">
          <EmptyState icon="calendar" title="Check the dates" description={`${fromError} Pick a From date on or before ${formatDate(asOf)}.`} />
        </div>
      ) : (
        <>
          {tb &&
            (tb.balanced ? (
              <Banner tone="success" icon="checkCircle" title="Balanced.">
                Debits equal credits at {formatDate(tb.asOf)}: {formatRs(tb.totals.closingDebit)} on each side. {formatCount(tb.vouchers)} vouchers were posted from {formatDate(tb.from)} to {formatDate(tb.asOf)}.
              </Banner>
            ) : (
              <Banner tone="danger" title={`Out of balance by ${formatRs(Math.abs(tb.difference))}.`}>
                Every posted voucher balances, so this needs the support team. Nothing is lost.
              </Banner>
            ))}
          <div className="grid gap-4 sm:grid-cols-3">
            {cards.map((c, i) => (
              <div key={c.label} className="mtb-rise" style={slide(i)}>
                <StatCard label={c.label} loading={!tb} value={c.value === undefined ? "" : <AnimatedNumber value={c.value} format={"count" in c ? formatCount : formatRs} />} foot={c.foot} />
              </div>
            ))}
          </div>

          <div className="mtb-table-wrap mtb-rise" style={slide(3)}>
            <div className="mtb-table-scroll">
              <table className="mtb-table acc-stagger">
                <caption className="mtb-sr-only">
                  Trial balance, {campusLabel(ctx.campus)}, {view === "balances" ? `as of ${formatDate(asOf)}` : periodText}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Account</th>
                    {view === "movement" && (
                      <>
                        <th scope="col" className="mtb-th-num" style={{ width: 170 }}>
                          Opening
                        </th>
                        <th scope="col" className="mtb-th-num" style={{ width: 150 }}>
                          Debits
                        </th>
                        <th scope="col" className="mtb-th-num" style={{ width: 150 }}>
                          Credits
                        </th>
                        <th scope="col" className="mtb-th-num" style={{ width: 170 }}>
                          Closing
                        </th>
                      </>
                    )}
                    {view !== "movement" && (
                      <>
                        <th scope="col" className="mtb-th-num" style={{ width: 170 }}>
                          Debit
                        </th>
                        <th scope="col" className="mtb-th-num" style={{ width: 170 }}>
                          Credit
                        </th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {!tb &&
                    Array.from({ length: 10 }, (_, i) => (
                      <tr key={i} aria-hidden="true">
                        <td>
                          <Skeleton width={`${40 + ((i * 13) % 40)}%`} />
                        </td>
                        {Array.from({ length: cols - 1 }, (_, j) => (
                          <td key={j}>
                            <Skeleton width={100} style={{ marginLeft: "auto" }} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  {tb && rows.length === 0 && (
                    <tr>
                      <td colSpan={cols} style={{ padding: 0 }}>
                        {view === "period" ? (
                          <EmptyState icon="listChecks" title="Nothing posted in these dates" description={`No vouchers were posted from ${periodText}. Choose other dates, or switch to Balances.`} />
                        ) : (
                          <EmptyState icon="listChecks" title="Nothing posted yet" description="Balances appear here once vouchers are posted." />
                        )}
                      </td>
                    </tr>
                  )}
                  {tb &&
                    rows.map((r) => {
                      const strong = !r.postable;
                      const canToggle = hasChildren(r);
                      const open = !collapsed.has(r.code);
                      return (
                        <tr key={r.code} className={cx(r.postable && "is-clickable")} onClick={() => openLedger(r)} tabIndex={r.postable ? 0 : undefined} onKeyDown={(e) => e.key === "Enter" && openLedger(r)}>
                          <td>
                            <span className="flex items-start gap-2" style={{ paddingLeft: r.depth * 20 }}>
                              {canToggle ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggle(r.code);
                                  }}
                                  aria-expanded={open}
                                  aria-label={`${open ? "Collapse" : "Expand"} ${r.code} ${r.name}`}
                                  className="mt-0.5 grid h-5 w-5 shrink-0 place-content-center rounded-sm text-ink-muted hover:bg-surface-hover hover:text-ink"
                                >
                                  <Icon name={open ? "chevronDown" : "chevronRight"} size={16} />
                                </button>
                              ) : (
                                <span className="w-5 shrink-0" aria-hidden="true" />
                              )}
                              <span className="grid min-w-0">
                                <span className={cx("flex flex-wrap items-baseline gap-x-3", strong && "font-semibold")}>
                                  <span className="mtb-mono text-ink-muted">{r.code}</span>
                                  <span>{r.name}</span>
                                </span>
                                {r.note && <span className="mtb-cell-secondary">{r.note}</span>}
                              </span>
                            </span>
                          </td>
                          {view === "movement" ? (
                            <>
                              <td className="mtb-td-num">
                                <Bal value={r.opening} strong={strong} />
                              </td>
                              <td className="mtb-td-num">{amt(r.debit)}</td>
                              <td className="mtb-td-num">{amt(r.credit)}</td>
                              <td className="mtb-td-num">
                                <Bal value={r.closing} strong={strong} />
                              </td>
                            </>
                          ) : view === "period" ? (
                            <>
                              <td className={cx("mtb-td-num", strong && "font-semibold")}>{amt(r.debit)}</td>
                              <td className={cx("mtb-td-num", strong && "font-semibold")}>{amt(r.credit)}</td>
                            </>
                          ) : (
                            <>
                              <td className={cx("mtb-td-num", strong && "font-semibold")}>{amt(dr(r.closing))}</td>
                              <td className={cx("mtb-td-num", strong && "font-semibold")}>{amt(cr(r.closing))}</td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                </tbody>
                {tb && rows.length > 0 && (
                  <tfoot>
                    <tr>
                      <td>{view === "period" ? "Grand total" : "Totals (accounts that take postings)"}</td>
                      {view === "movement" ? (
                        <>
                          <td className="mtb-td-num">
                            {formatRs(tb.totals.openingDebit)} Dr / {formatRs(tb.totals.openingCredit)} Cr
                          </td>
                          <td className="mtb-td-num">{formatRs(tb.totals.debit)}</td>
                          <td className="mtb-td-num">{formatRs(tb.totals.credit)}</td>
                          <td className="mtb-td-num">
                            {formatRs(tb.totals.closingDebit)} Dr / {formatRs(tb.totals.closingCredit)} Cr
                          </td>
                        </>
                      ) : view === "period" ? (
                        <>
                          <td className="mtb-td-num">{formatRs(tb.totals.debit)}</td>
                          <td className="mtb-td-num">{formatRs(tb.totals.credit)}</td>
                        </>
                      ) : (
                        <>
                          <td className="mtb-td-num">{formatRs(tb.totals.closingDebit)}</td>
                          <td className="mtb-td-num">{formatRs(tb.totals.closingCredit)}</td>
                        </>
                      )}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <div className="mtb-table-footer">
              <span>
                Click an account to open its ledger for {periodText}. Group rows add up the accounts under them; use the arrows to fold a group.
                {view === "period" ? " Only accounts with movement in the period are listed." : ""}
              </span>
            </div>
          </div>
        </>
      )}

      {tb && !fromError && (
        <div className="acc-print-only mtb-print-area" aria-hidden="true">
          <article className="acc-doc">
            <DocHead
              title={level === "all" ? "Trial balance" : `Trial balance, level ${level}`}
              subtitle={`${periodText} · ${view === "period" ? "Movement in the period" : view === "movement" ? "Opening, movement and closing" : `Balances at ${formatDate(tb.asOf)}`} · ${tb.balanced ? "Balanced" : `Out of balance by ${formatRs(Math.abs(tb.difference))}`}`}
            />
            <table>
              <thead>
                <tr>
                  <th style={{ width: 70 }}>Code</th>
                  <th>Account</th>
                  {view === "movement" ? (
                    <>
                      <th className="num">Opening</th>
                      <th className="num">Debits</th>
                      <th className="num">Credits</th>
                      <th className="num">Closing</th>
                    </>
                  ) : (
                    <>
                      <th className="num">Debit</th>
                      <th className="num">Credit</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.code} style={{ fontWeight: r.postable ? 400 : 600 }}>
                    <td>{r.code}</td>
                    <td style={{ paddingLeft: 6 + r.depth * 12 }}>{r.name}</td>
                    {view === "movement" ? (
                      <>
                        <td className="num">{r.opening ? `${formatRs(Math.abs(r.opening))} ${r.opening > 0 ? "Dr" : "Cr"}` : ""}</td>
                        <td className="num">{amt(r.debit)}</td>
                        <td className="num">{amt(r.credit)}</td>
                        <td className="num">{r.closing ? `${formatRs(Math.abs(r.closing))} ${r.closing > 0 ? "Dr" : "Cr"}` : ""}</td>
                      </>
                    ) : view === "period" ? (
                      <>
                        <td className="num">{amt(r.debit)}</td>
                        <td className="num">{amt(r.credit)}</td>
                      </>
                    ) : (
                      <>
                        <td className="num">{amt(dr(r.closing))}</td>
                        <td className="num">{amt(cr(r.closing))}</td>
                      </>
                    )}
                  </tr>
                ))}
                <tr style={{ fontWeight: 700 }}>
                  <td colSpan={2} style={{ textAlign: "right" }}>
                    {view === "period" ? "Grand total" : "Totals"}
                  </td>
                  {view === "movement" ? (
                    <>
                      <td className="num">
                        {formatRs(tb.totals.openingDebit)} Dr / {formatRs(tb.totals.openingCredit)} Cr
                      </td>
                      <td className="num">{formatRs(tb.totals.debit)}</td>
                      <td className="num">{formatRs(tb.totals.credit)}</td>
                      <td className="num">
                        {formatRs(tb.totals.closingDebit)} Dr / {formatRs(tb.totals.closingCredit)} Cr
                      </td>
                    </>
                  ) : view === "period" ? (
                    <>
                      <td className="num">{formatRs(tb.totals.debit)}</td>
                      <td className="num">{formatRs(tb.totals.credit)}</td>
                    </>
                  ) : (
                    <>
                      <td className="num">{formatRs(tb.totals.closingDebit)}</td>
                      <td className="num">{formatRs(tb.totals.closingCredit)}</td>
                    </>
                  )}
                </tr>
              </tbody>
            </table>
            <p className="m-0 mt-2">
              Group rows are subtotals and are not added into the totals.
              {view === "period" ? " Only accounts with movement in the period are listed." : ` Difference between the two sides: ${formatRs(Math.abs(tb.difference))}.`}
            </p>
            <DocFoot />
          </article>
        </div>
      )}
    </AccountsShell>
  );
}
