import { ACCOUNTS_CLASS_LABEL, ACCOUNTS_CONTROL_LABEL, type AccountsAccount, type AccountsClass } from "@mtb/api";
import { formatCount, formatDate } from "@mtb/domain";
import { Button, cx, EmptyState, Icon, Input, Segmented, SegmentedBar, Skeleton, StatusBadge } from "@mtb/ui";
import { useMemo, useState, type CSSProperties } from "react";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import { AccountPanel } from "./AccountPanel";
import { AccLink, AccountsShell, asOfFor, Bal, balText, DocFoot, DocHead, LoadError, useChart } from "./shared";

function Highlight({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-warning-tint px-0.5 text-ink">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

const CLASS_COLOR: Record<AccountsClass, string> = { ASSET: "var(--chart-1)", LIABILITY: "var(--chart-2)", EQUITY: "var(--chart-3)", INCOME: "var(--chart-4)", EXPENSE: "var(--chart-5)" };

/** /accounts/chart — the chart of accounts as a tree: groups, accounts, cash and bank, control accounts. */
export function ChartOfAccountsPage() {
  const ctx = useCtx();
  const canPost = useCan("accounts.post");
  const readOnly = useReadOnly();
  const canEdit = canPost && !readOnly;
  const { q, accounts } = useChart();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["1", "2", "3", "4", "5", "11", "41"]));
  const [search, setSearch] = useState("");
  const [show, setShow] = useState("active");
  const [panel, setPanel] = useState<{ mode: "add" | "edit"; code: string | null } | null>(null);
  const [justSaved, setJustSaved] = useState<string | null>(null);

  const byCodeAll = useMemo(() => new Map(accounts.map((a) => [a.code, a])), [accounts]);
  const byParent = useMemo(() => {
    const m = new Map<string | null, AccountsAccount[]>();
    for (const a of accounts) m.set(a.parentCode, [...(m.get(a.parentCode) ?? []), a]);
    for (const list of m.values()) list.sort((a, b) => a.code.localeCompare(b.code));
    return m;
  }, [accounts]);

  // Searching (or showing switched-off accounts) shows the matches plus their groups, with every group opened.
  const term = search.trim();
  const visibleWhileSearching = useMemo(() => {
    if (!term && show !== "inactive") return null;
    const lower = term.toLowerCase();
    const keep = new Set<string>();
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    for (const a of accounts) {
      const hit = term ? a.code.startsWith(term) || a.name.toLowerCase().includes(lower) : true;
      if (hit && (show !== "inactive" || !a.active)) {
        let cur: AccountsAccount | undefined = a;
        while (cur) {
          keep.add(cur.code);
          cur = cur.parentCode ? byCode.get(cur.parentCode) : undefined;
        }
      }
    }
    return keep;
  }, [term, accounts, show]);

  const toggle = (code: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const rows: Array<{ a: AccountsAccount; depth: number }> = [];
  const walk = (parent: string | null, depth: number) => {
    for (const a of byParent.get(parent) ?? []) {
      if (visibleWhileSearching && !visibleWhileSearching.has(a.code)) continue;
      if (show === "active" && !a.active) continue;
      rows.push({ a, depth });
      const open = visibleWhileSearching ? true : expanded.has(a.code);
      if (!a.postable && open) walk(a.code, depth + 1);
    }
  };
  walk(null, 0);
  const shownRows = rows;

  const groups = accounts.filter((a) => !a.postable);
  const leaves = accounts.filter((a) => a.postable);
  const tops = accounts.filter((a) => a.parentCode === null);
  const colSpan = canEdit ? 5 : 4;

  const afterSave = (acc: AccountsAccount) => {
    setPanel(null);
    setSearch("");
    // Open every group above it, however deep the chart goes.
    setExpanded((s) => {
      const next = new Set(s);
      const seen = new Set<string>();
      let parent = acc.parentCode;
      while (parent && !seen.has(parent)) {
        seen.add(parent);
        next.add(parent);
        parent = byCodeAll.get(parent)?.parentCode ?? null;
      }
      return next;
    });
    setJustSaved(acc.code);
    setTimeout(() => setJustSaved((c) => (c === acc.code ? null : c)), 4000);
  };

  return (
    <AccountsShell
      title="Chart of accounts"
      actions={
        <>
          <Button icon="printer" onClick={() => window.print()} disabled={q.isLoading}>
            Print
          </Button>
          {canEdit && (
            <Button variant="primary" icon="plus" onClick={() => setPanel({ mode: "add", code: null })}>
              Add account
            </Button>
          )}
        </>
      }
    >
      {q.error && !q.data ? (
        <LoadError what="The chart of accounts" error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <section className="mtb-card mtb-rise grid gap-4 p-5" aria-label="Summary">
            <dl className="acc-figures">
              <div>
                <dt>Accounts that take postings</dt>
                <dd>{q.isLoading ? <Skeleton width={40} /> : formatCount(leaves.filter((a) => a.active).length)}</dd>
              </div>
              <div>
                <dt>Groups</dt>
                <dd>{q.isLoading ? <Skeleton width={40} /> : formatCount(groups.length)}</dd>
              </div>
              <div>
                <dt>Cash and bank</dt>
                <dd>{formatCount(leaves.filter((a) => a.kind !== "OTHER").length)}</dd>
              </div>
              <div>
                <dt>One campus only</dt>
                <dd>{formatCount(leaves.filter((a) => a.campus).length)}</dd>
              </div>
              <div>
                <dt>Control accounts</dt>
                <dd>{formatCount(leaves.filter((a) => a.control).length)}</dd>
              </div>
              <div>
                <dt>Switched off</dt>
                <dd>{formatCount(accounts.filter((a) => !a.active).length)}</dd>
              </div>
            </dl>
            {!q.isLoading && (
              <SegmentedBar
                label="Accounts by class"
                format={formatCount}
                height={10}
                segments={tops.map((t) => ({ key: t.code, label: ACCOUNTS_CLASS_LABEL[t.accountClass], value: leaves.filter((a) => a.accountClass === t.accountClass).length, color: CLASS_COLOR[t.accountClass] }))}
              />
            )}
            <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-1 p-0 text-small text-ink-muted">
              {tops.map((t) => (
                <li key={t.code} className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: CLASS_COLOR[t.accountClass] }} />
                  {ACCOUNTS_CLASS_LABEL[t.accountClass]} · {formatCount(leaves.filter((a) => a.accountClass === t.accountClass).length)}
                </li>
              ))}
            </ul>
          </section>

          <div className="mtb-table-wrap mtb-rise" style={{ "--i": 1 } as CSSProperties}>
            <div className="mtb-table-toolbar">
              <div className="w-80 max-w-full">
                <Input aria-label="Search accounts" icon="search" placeholder="Search by code or name" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Segmented
                  aria-label="Show accounts"
                  value={show}
                  onChange={setShow}
                  options={[
                    { value: "active", label: "In use" },
                    { value: "all", label: "All" },
                    { value: "inactive", label: "Switched off" },
                  ]}
                />
                <Button size="sm" variant="ghost" onClick={() => setExpanded(new Set(groups.map((g) => g.code)))} disabled={Boolean(term)}>
                  Expand all
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setExpanded(new Set())} disabled={Boolean(term)}>
                  Collapse all
                </Button>
              </div>
            </div>
            <div className="mtb-table-scroll">
              <table className="mtb-table acc-stagger">
                <caption className="mtb-sr-only">Chart of accounts, {campusLabel(ctx.campus)}</caption>
                <thead>
                  <tr>
                    <th scope="col">Account</th>
                    <th scope="col" style={{ width: 230 }}>
                      Kind
                    </th>
                    <th scope="col" style={{ width: 150 }}>
                      Used by
                    </th>
                    <th scope="col" className="mtb-th-num" style={{ width: 200 }}>
                      Balance
                    </th>
                    {canEdit && (
                      <th scope="col" style={{ width: 190 }}>
                        <span className="mtb-sr-only">Actions</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {q.isLoading &&
                    Array.from({ length: 8 }, (_, i) => (
                      <tr key={i} aria-hidden="true">
                        <td>
                          <Skeleton width={`${40 + ((i * 13) % 40)}%`} />
                        </td>
                        <td>
                          <Skeleton width={80} />
                        </td>
                        <td>
                          <Skeleton width={80} />
                        </td>
                        <td>
                          <Skeleton width={110} style={{ marginLeft: "auto" }} />
                        </td>
                        {canEdit && <td />}
                      </tr>
                    ))}
                  {!q.isLoading && shownRows.length === 0 && (
                    <tr>
                      <td colSpan={colSpan} style={{ padding: 0 }}>
                        <EmptyState
                          icon="search"
                          title={term ? "No accounts match" : "Nothing to show"}
                          description={term ? `Nothing found for "${term}". Search by account code (4105) or a word in the name (fine).` : "No accounts are switched off."}
                        />
                      </td>
                    </tr>
                  )}
                  {shownRows.map(({ a, depth }) => {
                    const isGroup = !a.postable;
                    const open = visibleWhileSearching ? true : expanded.has(a.code);
                    return (
                      <tr key={a.code} className={cx(justSaved === a.code && "is-selected", !a.active && "opacity-60")}>
                        <td>
                          <div className="flex items-start gap-2" style={{ paddingLeft: depth * 22 }}>
                            {isGroup ? (
                              <button
                                type="button"
                                onClick={() => toggle(a.code)}
                                disabled={Boolean(visibleWhileSearching)}
                                aria-expanded={open}
                                aria-label={`${open ? "Collapse" : "Expand"} ${a.code} ${a.name}`}
                                className="mt-0.5 grid h-5 w-5 shrink-0 place-content-center rounded-sm text-ink-muted hover:bg-surface-hover hover:text-ink disabled:opacity-60"
                              >
                                <Icon name={open ? "chevronDown" : "chevronRight"} size={16} />
                              </button>
                            ) : (
                              <span className="w-5 shrink-0" aria-hidden="true" />
                            )}
                            <span className="grid min-w-0">
                              <span className={cx("flex flex-wrap items-baseline gap-x-3", isGroup ? "font-semibold text-ink" : "text-ink")}>
                                <span className="mtb-mono text-ink-muted">
                                  <Highlight text={a.code} q={term} />
                                </span>
                                {a.postable ? (
                                  <AccLink to="/accounts/ledger" search={{ account: a.code }} className="text-ink no-underline hover:text-brand-ink hover:underline">
                                    <Highlight text={a.name} q={term} />
                                  </AccLink>
                                ) : (
                                  <span>
                                    <Highlight text={a.name} q={term} />
                                  </span>
                                )}
                              </span>
                              {a.note && <span className="mtb-cell-secondary">{a.note}</span>}
                              {a.bank && (
                                <span className="mtb-cell-secondary">
                                  {a.bank.bankName}, {a.bank.branch} · {a.bank.accountNoMasked}
                                </span>
                              )}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className="flex flex-wrap gap-1">
                            {isGroup && <span className="acc-chip">{depth >= 2 ? "Sub-group" : "Group"}</span>}
                            {a.kind === "CASH" && (
                              <span className="acc-chip tone-brand">
                                <Icon name="fees" /> Cash
                              </span>
                            )}
                            {a.kind === "BANK" && (
                              <span className="acc-chip tone-brand">
                                <Icon name="building" /> Bank
                              </span>
                            )}
                            {a.control && (
                              <span className="acc-chip tone-info" title="Filled automatically; cash and bank vouchers can't post to it.">
                                <Icon name="bolt" /> Control · {ACCOUNTS_CONTROL_LABEL[a.control]}
                              </span>
                            )}
                            {!a.active && <StatusBadge status="cancelled">Switched off</StatusBadge>}
                            {a.postable && a.kind === "OTHER" && !a.control && a.active && (
                              <span className="text-small text-ink-muted">
                                {a.normalSide === "DEBIT" ? "Debit balance" : "Credit balance"}
                                {a.parentCode && byCodeAll.get(a.parentCode)?.normalSide !== a.normalSide ? " (contra)" : ""}
                              </span>
                            )}
                          </span>
                        </td>
                        <td>
                          {a.campus ? (
                            <StatusBadge status="info" dot={false}>
                              {campusLabel(a.campus)} only
                            </StatusBadge>
                          ) : (
                            <span className="text-small text-ink-muted">{isGroup ? "—" : "All campuses"}</span>
                          )}
                        </td>
                        <td className="mtb-td-num" aria-label={balText(a.netDebit)}>
                          <Bal value={a.netDebit} strong={isGroup} />
                        </td>
                        {canEdit && (
                          <td className="mtb-td-actions">
                            <span className="flex flex-wrap justify-end gap-1">
                              {isGroup && a.active && (
                                <Button size="sm" variant="quiet" icon="plus" aria-label={`Add an account under ${a.code} ${a.name}`} onClick={() => setPanel({ mode: "add", code: a.code })}>
                                  Add
                                </Button>
                              )}
                              {a.parentCode !== null && (
                                <Button size="sm" variant="quiet" icon="edit" aria-label={`Edit ${a.code} ${a.name}`} onClick={() => setPanel({ mode: "edit", code: a.code })}>
                                  Edit
                                </Button>
                              )}
                            </span>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mtb-table-footer">
              <span>
                Balances for {campusLabel(ctx.campus)} as at {formatDate(asOfFor(ctx.session))}. Income and expenses are session to date. Click an account to open its ledger.
              </span>
            </div>
          </div>
        </>
      )}

      {panel && (
        <AccountPanel open mode={panel.mode} code={panel.code} accounts={accounts} onClose={() => setPanel(null)} onSaved={afterSave} />
      )}

      <div className="acc-print-only mtb-print-area" aria-hidden="true">
        <article className="acc-doc">
          <DocHead title="Chart of accounts" subtitle={`Balances as at ${formatDate(asOfFor(ctx.session))}`} />
          <table>
            <thead>
              <tr>
                <th style={{ width: 60 }}>Code</th>
                <th>Account</th>
                <th>Kind</th>
                <th>Used by</th>
                <th>Status</th>
                <th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const out: Array<{ a: AccountsAccount; depth: number }> = [];
                const all = (parent: string | null, depth: number) => {
                  for (const a of byParent.get(parent) ?? []) {
                    out.push({ a, depth });
                    if (!a.postable) all(a.code, depth + 1);
                  }
                };
                all(null, 0);
                return out.map(({ a, depth }) => (
                  <tr key={a.code} style={{ fontWeight: a.postable ? 400 : 600 }}>
                    <td>{a.code}</td>
                    <td style={{ paddingLeft: 6 + depth * 12 }}>{a.name}</td>
                    <td>{a.postable ? (a.kind === "CASH" ? "Cash" : a.kind === "BANK" ? "Bank" : a.control ? `Control (${ACCOUNTS_CONTROL_LABEL[a.control]})` : a.normalSide === "DEBIT" ? "Dr" : "Cr") : depth >= 2 ? "Sub-group" : "Group"}</td>
                    <td>{a.campus ? campusLabel(a.campus) : a.postable ? "All campuses" : ""}</td>
                    <td>{a.active ? "In use" : "Switched off"}</td>
                    <td className="num">{balText(a.netDebit)}</td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
          <DocFoot />
        </article>
      </div>
    </AccountsShell>
  );
}
