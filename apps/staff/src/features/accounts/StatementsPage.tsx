import { accountsQueries, type AccountsStatementGroup } from "@mtb/api";
import { formatDate, formatLakh, formatRs } from "@mtb/domain";
import { AnimatedNumber, Banner, Button, ColumnChart, DataTable, DatePicker, Money, Panel, Segmented, SegmentedBar, Skeleton, StatCard } from "@mtb/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { useCtx } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import { AccLink, AccountsShell, accToday, addDays, asOfFor, DocFoot, DocHead, lakhTick, LoadError, monthName, monthShort, sessionStartOf, slide } from "./shared";

export interface StatementsSearch {
  view?: "ie" | "bs";
  from?: string;
  to?: string;
  asOf?: string;
}

/** Groups with their accounts; each account opens its ledger for the same dates. */
function StatementRows({ groups, from, to, sign }: { groups: AccountsStatementGroup[]; from?: string; to: string; sign?: string }) {
  return (
    <>
      {groups.map((g) => (
        <Fragment key={g.code}>
          <tr className="grp">
            <td>{g.name}</td>
            <td className="num" />
          </tr>
          {g.accounts.map((a) => (
            <tr key={a.code} className="sub">
              <td>
                <AccLink to="/accounts/ledger" search={{ account: a.code, ...(from ? { from } : {}), to }} className="">
                  <span className="mtb-mono">{a.code}</span> {a.name}
                </AccLink>
              </td>
              <td className="num">{a.amount < 0 ? `(${formatRs(-a.amount)})` : formatRs(a.amount)}</td>
            </tr>
          ))}
          <tr className="tot">
            <td>
              Total {g.name.toLowerCase()}
              {sign ? ` ${sign}` : ""}
            </td>
            <td className="num">{g.amount < 0 ? `(${formatRs(-g.amount)})` : formatRs(g.amount)}</td>
          </tr>
        </Fragment>
      ))}
    </>
  );
}

/** /accounts/statements — income and expenditure for any dates, and the balance sheet at a date. */
export function StatementsPage({ search, setSearch }: { search: StatementsSearch; setSearch: (next: StatementsSearch) => void }) {
  const view = search.view ?? "ie";
  return (
    <AccountsShell
      title="Financial statements"
      actions={
        <Button icon="printer" onClick={() => window.print()}>
          Print
        </Button>
      }
    >
      <Segmented
        aria-label="Statement"
        value={view}
        onChange={(v) => setSearch({ view: v as StatementsSearch["view"] })}
        options={[
          { value: "ie", label: "Income and expenditure" },
          { value: "bs", label: "Balance sheet" },
        ]}
      />
      {view === "ie" ? <IncomeExpenditure search={search} setSearch={setSearch} /> : <BalanceSheet search={search} setSearch={setSearch} />}
    </AccountsShell>
  );
}

function IncomeExpenditure({ search, setSearch }: { search: StatementsSearch; setSearch: (next: StatementsSearch) => void }) {
  const ctx = useCtx();
  const start = sessionStartOf(ctx.session);
  const end = asOfFor(ctx.session);
  const from = search.from ?? start;
  const to = search.to ?? end;
  const q = useQuery({ ...accountsQueries.incomeExpenditure(ctx, { from, to }), placeholderData: keepPreviousData });
  const [chart, setChart] = useState("chart");
  const d = q.data;
  const monthStart = `${end.slice(0, 7)}-01`;
  const lastMonthEnd = addDays(monthStart, -1);
  const lastMonthStart = `${lastMonthEnd.slice(0, 7)}-01`;
  const preset = from === start && to === end ? "session" : from === monthStart && to === end ? "month" : from === lastMonthStart && to === lastMonthEnd ? "last" : "custom";

  return (
    <>
      <section className="mtb-card mtb-rise flex flex-wrap items-end gap-4 p-5" aria-label="Dates">
        <div className="w-44">
          <DatePicker label="From" value={from} onValueChange={(v) => setSearch({ ...search, from: v ?? undefined })} today={accToday()} minDate={start} maxDate={end} />
        </div>
        <div className="w-44">
          <DatePicker label="To" value={to} onValueChange={(v) => setSearch({ ...search, to: v ?? undefined })} today={accToday()} minDate={start} maxDate={end} />
        </div>
        <Segmented
          aria-label="Period"
          value={preset}
          onChange={(v) =>
            setSearch(v === "month" ? { ...search, from: monthStart, to: undefined } : v === "last" ? { ...search, from: lastMonthStart, to: lastMonthEnd } : { ...search, from: undefined, to: undefined })
          }
          options={[
            { value: "month", label: "This month" },
            { value: "last", label: "Last month" },
            { value: "session", label: "Session to date" },
            ...(preset === "custom" ? [{ value: "custom", label: "Custom" }] : []),
          ]}
        />
        <p className="m-0 ms-auto max-w-sm text-small text-ink-muted">{campusLabel(ctx.campus)}. Fee income is counted when it is received (cash basis), as in the old system.</p>
      </section>

      {q.error && !d ? (
        <LoadError what="Income and expenditure" error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { label: "Income", value: d?.totalIncome, icon: "trendUp" as const, foot: "Fees and other income" },
              { label: "Expenditure", value: d?.totalExpenses, icon: "trendDown" as const, foot: "Salaries, utilities and running costs" },
              { label: d && d.surplus < 0 ? "Deficit" : "Surplus", value: d ? Math.abs(d.surplus) : undefined, icon: "award" as const, foot: d && d.totalIncome > 0 ? `${Math.round((d.surplus / d.totalIncome) * 100)}% of income` : "", tone: d && d.surplus < 0 ? ("danger" as const) : undefined },
            ].map((c, i) => (
              <div key={c.label} className="mtb-rise" style={slide(i)}>
                <StatCard label={c.label} icon={c.icon} {...(c.tone ? { tone: c.tone } : {})} loading={!d} value={c.value === undefined ? "" : <AnimatedNumber value={c.value} format={formatRs} />} foot={c.foot} />
              </div>
            ))}
          </div>

          <Panel
            id="ie-months"
            rise={3}
            title="Month by month"
            description="Columns are income; the bar across each column is that month's expenditure."
            actions={<Segmented aria-label="Show months as" value={chart} onChange={setChart} options={[{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }]} />}
          >
            {!d ? (
              <Skeleton height={260} />
            ) : chart === "chart" ? (
              <ColumnChart
                data={d.months}
                value={(m) => m.income}
                target={(m) => m.expenses}
                axisLabel={(m) => monthShort(m.month)}
                formatAxis={lakhTick}
                valueLabel="Income"
                targetLabel="Expenditure"
                partial={(m) => m.month === accToday().slice(0, 7)}
                partialLabel="Month in progress"
                tooltip={(m) => (
                  <>
                    <div className="mtb-chart-tip-title">{monthName(m.month)}</div>
                    <div className="mtb-chart-tip-row">
                      <span>Income</span>
                      <span>{formatRs(m.income)}</span>
                    </div>
                    <div className="mtb-chart-tip-row">
                      <span>Expenditure</span>
                      <span>{formatRs(m.expenses)}</span>
                    </div>
                    <div className="mtb-chart-tip-row">
                      <span>{m.income >= m.expenses ? "Surplus" : "Deficit"}</span>
                      <span>{formatRs(Math.abs(m.income - m.expenses))}</span>
                    </div>
                  </>
                )}
                describe={(m) => `${monthName(m.month)}: income ${formatRs(m.income)}, expenditure ${formatRs(m.expenses)}`}
                label="Income and expenditure by month"
              />
            ) : (
              <DataTable
                rows={d.months}
                rowKey="month"
                density="dense"
                caption="Income and expenditure by month"
                columns={[
                  { key: "month", header: "Month", render: (m) => monthName(m.month) },
                  { key: "income", header: "Income", align: "right", render: (m) => <Money value={m.income} /> },
                  { key: "expenses", header: "Expenditure", align: "right", render: (m) => <Money value={m.expenses} /> },
                  { key: "surplus", header: "Surplus", align: "right", render: (m) => <Money value={m.income - m.expenses} /> },
                ]}
              />
            )}
          </Panel>

          {d?.campuses && (
            <Panel id="ie-campuses" rise={4} title="By campus" description="The same dates, campus by campus." flush>
              <DataTable
                rows={d.campuses}
                rowKey="campus"
                caption="Income and expenditure by campus"
                columns={[
                  { key: "campus", header: "Campus", render: (c) => c.campusName },
                  { key: "income", header: "Income", align: "right", render: (c) => <Money value={c.income} /> },
                  { key: "expenses", header: "Expenditure", align: "right", render: (c) => <Money value={c.expenses} /> },
                  { key: "surplus", header: "Surplus", align: "right", render: (c) => <Money value={c.surplus} /> },
                  { key: "share", header: "Share of income", align: "right", render: (c) => (d.totalIncome > 0 ? `${Math.round((c.income / d.totalIncome) * 100)}%` : "—") },
                ]}
                footer={{ campus: "All campuses", income: <Money value={d.totalIncome} />, expenses: <Money value={d.totalExpenses} />, surplus: <Money value={d.surplus} /> }}
              />
            </Panel>
          )}

          <Panel id="ie-statement" rise={5} title={`Income and expenditure account, ${formatDate(from)} to ${formatDate(to)}`} description="Click an account to see the vouchers behind it.">
            {!d ? (
              <Skeleton height={300} />
            ) : (
              <table className="acc-stmt">
                <tbody>
                  <StatementRows groups={d.income} from={from} to={to} />
                  <tr className="tot">
                    <td>Total income</td>
                    <td className="num">{formatRs(d.totalIncome)}</td>
                  </tr>
                  <StatementRows groups={d.expenses} from={from} to={to} />
                  <tr className="tot">
                    <td>Total expenditure</td>
                    <td className="num">{formatRs(d.totalExpenses)}</td>
                  </tr>
                  <tr className="grand">
                    <td>{d.surplus >= 0 ? "Surplus for the period" : "Deficit for the period"}</td>
                    <td className="num">{formatRs(Math.abs(d.surplus))}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </Panel>

          {d && (
            <div className="acc-print-only mtb-print-area" aria-hidden="true">
              <article className="acc-doc">
                <DocHead title="Income and expenditure account" subtitle={`${formatDate(from)} to ${formatDate(to)}`} />
                <PrintStatement groups={[...d.income]} label="Total income" total={d.totalIncome} />
                <PrintStatement groups={[...d.expenses]} label="Total expenditure" total={d.totalExpenses} />
                <p className="m-0 mt-2 text-[14px] font-bold">
                  {d.surplus >= 0 ? "Surplus" : "Deficit"} for the period: {formatRs(Math.abs(d.surplus))} ({formatLakh(Math.abs(d.surplus))})
                </p>
                <DocFoot />
              </article>
            </div>
          )}
        </>
      )}
    </>
  );
}

function PrintStatement({ groups, label, total }: { groups: AccountsStatementGroup[]; label: string; total: number }) {
  return (
    <table style={{ marginBottom: 10 }}>
      <tbody>
        {groups.map((g) => (
          <Fragment key={g.code}>
            <tr>
              <th colSpan={2}>{g.name}</th>
            </tr>
            {g.accounts.map((a) => (
              <tr key={a.code}>
                <td>
                  {a.code} {a.name}
                </td>
                <td className="num">{a.amount < 0 ? `(${formatRs(-a.amount)})` : formatRs(a.amount)}</td>
              </tr>
            ))}
            <tr>
              <td style={{ fontWeight: 600 }}>Total {g.name.toLowerCase()}</td>
              <td className="num" style={{ fontWeight: 600 }}>
                {formatRs(g.amount)}
              </td>
            </tr>
          </Fragment>
        ))}
        <tr>
          <td style={{ fontWeight: 700 }}>{label}</td>
          <td className="num" style={{ fontWeight: 700 }}>
            {formatRs(total)}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

const ASSET_COLORS: Record<string, string> = { "11": "var(--chart-1)", "12": "var(--chart-2)", "13": "var(--chart-3)" };

function BalanceSheet({ search, setSearch }: { search: StatementsSearch; setSearch: (next: StatementsSearch) => void }) {
  const ctx = useCtx();
  const asOf = search.asOf ?? asOfFor(ctx.session);
  const q = useQuery({ ...accountsQueries.balanceSheet(ctx, asOf), placeholderData: keepPreviousData });
  const d = q.data;
  return (
    <>
      <section className="mtb-card mtb-rise flex flex-wrap items-end gap-4 p-5" aria-label="Date">
        <div className="w-44">
          <DatePicker label="As of" value={asOf} onValueChange={(v) => setSearch({ ...search, asOf: v ?? undefined })} today={accToday()} minDate={sessionStartOf(ctx.session)} maxDate={asOfFor(ctx.session)} />
        </div>
        <p className="m-0 ms-auto max-w-md text-small text-ink-muted">{campusLabel(ctx.campus)}. A summary of what the trust owns and owes; the surplus so far this session is shown under the trust's funds.</p>
      </section>
      {q.error && !d ? (
        <LoadError what="The balance sheet" error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          {d &&
            (d.balanced ? (
              <Banner tone="success" icon="checkCircle" title="Balanced.">
                What the trust owns ({formatRs(d.totalAssets)}) equals what it owes plus its own funds.
              </Banner>
            ) : (
              <Banner tone="danger" title="The two sides differ.">
                Assets {formatRs(d.totalAssets)}; liabilities and funds {formatRs(d.totalLiabilities + d.totalEquity)}.
              </Banner>
            ))}
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { label: "What the trust owns", value: d?.totalAssets, foot: "Cash, bank, buildings and equipment" },
              { label: "What it owes", value: d?.totalLiabilities, foot: "Salaries due, deposits, advances" },
              { label: "Trust funds and surplus", value: d?.totalEquity, foot: d ? `Includes ${formatRs(d.surplusThisSession)} surplus this session` : "" },
            ].map((c, i) => (
              <div key={c.label} className="mtb-rise" style={slide(i)}>
                <StatCard label={c.label} loading={!d} value={c.value === undefined ? "" : <AnimatedNumber value={c.value} format={formatRs} />} foot={c.foot} />
              </div>
            ))}
          </div>
          {d && (
            <Panel id="bs-assets" rise={3} title="What the assets are made of" description={`At ${formatDate(d.asOf)}.`}>
              <div className="grid gap-3">
                <SegmentedBar label="Assets" format={formatRs} segments={d.assets.map((g) => ({ key: g.code, label: g.name, value: Math.max(0, g.amount), color: ASSET_COLORS[g.code] ?? "var(--chart-4)" }))} />
                <ul className="m-0 flex list-none flex-wrap gap-x-6 gap-y-1 p-0 text-small text-ink-muted">
                  {d.assets.map((g) => (
                    <li key={g.code} className="inline-flex items-center gap-1.5">
                      <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: ASSET_COLORS[g.code] ?? "var(--chart-4)" }} />
                      {g.name} · <span className="text-ink">{formatRs(g.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Panel>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel id="bs-left" rise={4} title="Assets">
              {!d ? (
                <Skeleton height={260} />
              ) : (
                <table className="acc-stmt">
                  <tbody>
                    <StatementRows groups={d.assets} to={asOf} />
                    <tr className="grand">
                      <td>Total assets</td>
                      <td className="num">{formatRs(d.totalAssets)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </Panel>
            <Panel id="bs-right" rise={5} title="Liabilities and funds">
              {!d ? (
                <Skeleton height={260} />
              ) : (
                <table className="acc-stmt">
                  <tbody>
                    <StatementRows groups={d.liabilities} to={asOf} />
                    <StatementRows groups={d.equity} to={asOf} />
                    <tr className="sub">
                      <td>Surplus this session (from the income and expenditure account)</td>
                      <td className="num">{formatRs(d.surplusThisSession)}</td>
                    </tr>
                    <tr className="grand">
                      <td>Total liabilities and funds</td>
                      <td className="num">{formatRs(d.totalLiabilities + d.totalEquity)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </Panel>
          </div>
          {d && (
            <Banner tone="neutral" icon="info" title={`Unpaid fees: ${formatRs(d.feeArrears)} (memo).`}>
              The books are kept on a cash basis, so fees still owed by families are not counted as an asset. The fee office's defaulter reports track them.
            </Banner>
          )}
          {d && (
            <div className="acc-print-only mtb-print-area" aria-hidden="true">
              <article className="acc-doc">
                <DocHead title="Balance sheet (summary)" subtitle={`As of ${formatDate(d.asOf)}`} />
                <h2 style={{ marginTop: 8 }}>Assets</h2>
                <PrintStatement groups={d.assets} label="Total assets" total={d.totalAssets} />
                <h2>Liabilities and funds</h2>
                <PrintStatement groups={[...d.liabilities, ...d.equity, { code: "S", name: "Surplus this session", amount: d.surplusThisSession, accounts: [] }]} label="Total liabilities and funds" total={d.totalLiabilities + d.totalEquity} />
                <p className="m-0">Memo: unpaid fees in the fee office {formatRs(d.feeArrears)} (not in the books; cash basis).</p>
                <DocFoot />
              </article>
            </div>
          )}
        </>
      )}
    </>
  );
}
