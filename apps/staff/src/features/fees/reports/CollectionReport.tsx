import { COUNTER_PAYMENT_METHODS, feeSetupApi, feeSetupQueries, newIdempotencyKey, PAYMENT_METHOD_LABEL, type CampusCode, type CampusScope, type FeeCollectionGroup, type FeeCollectionMethod, type FeeCollectionRow } from "@mtb/api";
import { formatCount, formatDate, formatDateTime, formatLongDate, formatRs, formatTime, formatWeekday, type IsoDate } from "@mtb/domain";
import {
  AmountInput,
  AnimatedNumber,
  AreaChart,
  Banner,
  Button,
  DataTable,
  DatePicker,
  EmptyState,
  Icon,
  Input,
  KeyValue,
  Pagination,
  Panel,
  Segmented,
  SegmentedBar,
  Select,
  SidePanel,
  Skeleton,
  StatCard,
  StatusBadge,
  Switch,
  Textarea,
  useToast,
  type Column,
} from "@mtb/ui";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { campusLabel } from "../../../app/shell/campus";
import { Page, PageHeader, RequirePermission } from "../../../app/shell/page";
import { useCan, useCtx, useReadOnly, useSessionUser } from "../../../app/session";
import { addDaysIso, errorText, feeToday, FeesNav, lakhTick, LoadError, PaperSize, slide, useFeeClasses } from "../shared";

type Preset = "TODAY" | "YESTERDAY" | "MONTH" | "CUSTOM";

const yesterday = () => {
  let d = addDaysIso(feeToday(), -1);
  if (new Date(`${d}T00:00:00Z`).getUTCDay() === 0) d = addDaysIso(d, -1);
  return d;
};

const METHOD_COLOR: Record<FeeCollectionMethod, string> = { CASH: "var(--chart-1)", BANK: "var(--chart-2)", ONLINE: "var(--chart-3)", CHEQUE: "var(--chart-4)", SALARY: "var(--chart-5)", LEGACY: "var(--ink-subtle)" };

function GroupList({ groups, total }: { groups: FeeCollectionGroup[]; total: number }) {
  return (
    <ul className="m-0 grid list-none gap-2.5 p-0">
      {groups.map((g, i) => {
        const pct = total ? (g.amount / total) * 100 : 0;
        return (
          <li key={g.key} className="mtb-slide-in grid gap-1" style={slide(i)}>
            <div className="flex items-baseline justify-between gap-3 text-small">
              <span className="font-medium">{g.label}</span>
              <span className="tabular-nums">
                {formatRs(g.amount)} <span className="text-ink-muted">· {formatCount(g.receipts)}</span>
              </span>
            </div>
            <div className="fees-meter" role="img" aria-label={`${g.label}: ${Math.round(pct)}% of the total`}>
              <span style={{ width: `${pct}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function CloseCashPanel({ campus, onClose }: { campus: CampusCode; onClose: () => void }) {
  const ctx = useCtx();
  const user = useSessionUser();
  const toast = useToast();
  const queryClient = useQueryClient();
  const mine = useQuery(feeSetupQueries.collection(ctx, { from: feeToday(), to: feeToday(), cashier: user?.name ?? "", method: "CASH", pageSize: 10 }));
  const expected = mine.data?.rowsAmount ?? 0;
  const [counted, setCounted] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const diff = counted === null ? 0 : counted - expected;
  const key = useMemo(() => newIdempotencyKey(), [counted, note]);
  const errors: Record<string, string> = {};
  if (counted === null) errors.counted = "Enter the cash you counted.";
  if (counted !== null && diff !== 0 && !note.trim()) errors.note = `The cash is ${diff < 0 ? "short" : "over"} by ${formatRs(Math.abs(diff))}. Say why before closing.`;
  const save = useMutation({
    mutationFn: () => feeSetupApi.closeCash({ campus, date: feeToday(), counted: counted!, ...(note.trim() ? { note: note.trim() } : {}) }, key),
    onSuccess: (c) => {
      toast({ title: "Today's cash closed", message: c.difference === 0 ? `${formatRs(c.counted)} handed over; it matches the receipts.` : `${formatRs(c.counted)} handed over, ${formatRs(Math.abs(c.difference))} ${c.difference < 0 ? "short" : "over"}. The accountant sees the note.` });
      void queryClient.invalidateQueries({ queryKey: ["fees", "setup"] });
      onClose();
    },
  });
  return (
    <SidePanel
      open
      onClose={onClose}
      title="Close today's cash"
      description={`${user?.name ?? ""} · ${campusLabel(campus)} · ${formatDate(feeToday())}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon="lock"
            loading={save.isPending}
            loadingLabel="Closing…"
            onClick={() => {
              setTried(true);
              if (Object.keys(errors).length === 0) save.mutate();
            }}
          >
            Close and hand over
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <p className="m-0 text-ink-muted">Count the cash in the drawer. The system already knows what your cash receipts add up to; any difference needs a note for the accountant.</p>
        {mine.isLoading ? (
          <Skeleton height={60} />
        ) : (
          <KeyValue
            items={[
              ["Your cash receipts today", formatCount(mine.data?.rowsTotal ?? 0)],
              ["Cash you should have", <span className="font-semibold tabular-nums">{formatRs(expected)}</span>],
            ]}
          />
        )}
        <AmountInput label="Cash counted" required value={counted} onValueChange={setCounted} error={tried ? errors.counted : undefined} />
        {counted !== null && (
          <Banner tone={diff === 0 ? "success" : "warning"} title={diff === 0 ? "Matches the receipts." : `${formatRs(Math.abs(diff))} ${diff < 0 ? "short" : "over"}.`}>
            {diff === 0 ? "Hand the cash to the accountant with the day's report." : "Count again. If it is still different, say why below."}
          </Banner>
        )}
        <Textarea label="Note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} required={diff !== 0} error={tried ? errors.note : undefined} placeholder="For example: gave change twice to one parent; recovered next morning." />
        {save.error && <Banner tone="danger">{errorText(save.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

/** Starting dates from the link (`campus` is read by the campus switcher, like every page). */
export interface CollectionSearch {
  from?: IsoDate;
  to?: IsoDate;
  campus?: CampusScope;
}

/** The link's dates when they make a period up to today; otherwise today. (Receipts go back to the old system's first, 2017.) */
function startingDates(search: CollectionSearch): { preset: Preset; from: string; to: string } {
  const from = search.from ?? search.to;
  const to = search.to ?? search.from;
  if (!from || !to || from > to || to > feeToday()) return { preset: "TODAY", from: feeToday(), to: feeToday() };
  return { preset: from === feeToday() && to === feeToday() ? "TODAY" : "CUSTOM", from, to };
}

export function CollectionReport({ search = {} }: { search?: CollectionSearch }) {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const canCollect = useCan("fees.collect");
  const classList = useFeeClasses(ctx.campus);
  const [start] = useState(() => startingDates(search));
  const [preset, setPreset] = useState<Preset>(start.preset);
  const [from, setFrom] = useState<string | null>(start.from);
  const [to, setTo] = useState<string | null>(start.to);
  const [cashier, setCashier] = useState("");
  const [method, setMethod] = useState<FeeCollectionMethod | "">("");
  const [head, setHead] = useState("");
  const [cls, setCls] = useState("");
  const [section, setSection] = useState("");
  const [gender, setGender] = useState<"" | "F" | "M">("");
  const [byHead, setByHead] = useState(false);
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [view, setView] = useState("chart");
  const [closing, setClosing] = useState(false);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (preset === "TODAY") {
      setFrom(feeToday());
      setTo(feeToday());
    } else if (preset === "YESTERDAY") {
      setFrom(yesterday());
      setTo(yesterday());
    } else if (preset === "MONTH") {
      setFrom(`${feeToday().slice(0, 7)}-01`);
      setTo(feeToday());
    }
  }, [preset]);
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => setPage(1), [from, to, cashier, method, head, cls, section, gender, q, ctx.campus]);

  const rangeError = !from || !to ? "Choose both dates." : from > to ? "The start date must be on or before the end date." : to > feeToday() ? "The report runs up to today." : undefined;
  const params = { from: from ?? feeToday(), to: to ?? feeToday(), cashier, method, head, classShort: cls, section, gender, q, page };
  const report = useQuery({ ...feeSetupQueries.collection(ctx, params), enabled: !rangeError, placeholderData: keepPreviousData });
  const printQ = useQuery({ ...feeSetupQueries.collection(ctx, { ...params, page: 1, pageSize: 2000 }), enabled: printing && !rangeError });
  useEffect(() => {
    if (printing && printQ.data) {
      const t = setTimeout(() => {
        window.print();
        setPrinting(false);
      }, 100);
      return () => clearTimeout(t);
    }
  }, [printing, printQ.data]);

  const r = report.data;
  const oneDay = from === to;
  const isToday = oneDay && from === feeToday();
  const matches = r?.dashboardToday ? r.dashboardToday.amount === r.total.amount && r.dashboardToday.receipts === r.total.receipts : null;
  const printRows = printQ.data?.rows ?? [];
  const heads = r?.heads ?? [];
  const headTitle = heads.find((h) => h.code === head)?.title ?? "";
  const headAmount = (x: FeeCollectionRow, code: string) => x.lines.filter((l) => l.head === code).reduce((a, l) => a + l.amount, 0);
  const installmentOf = (x: FeeCollectionRow, code: string) => [...new Set(x.lines.filter((l) => l.head === code).map((l) => l.installment).filter(Boolean))].join(", ");
  const filtersOn = Boolean(cashier || method || head || cls || section || gender || q);
  const cancelledItems = (r?.cancelled.items ?? []).filter((c) => !cashier || c.cashier === cashier);
  const sectionOptions = classList.sectionsOf(cls);
  // Methods to filter on: the counter's, plus any other the period's receipts used (salary deductions, old system).
  const methodOptions = [...new Set<FeeCollectionMethod>([...COUNTER_PAYMENT_METHODS, ...((r?.byMethod ?? []).map((m) => m.key).filter((k): k is FeeCollectionMethod => k in PAYMENT_METHOD_LABEL))])];

  const columns: Array<Column<FeeCollectionRow>> = [
    {
      key: "receiptNo",
      header: "Receipt",
      width: 160,
      // Every row is a real receipt (old-system receipts too), so every row opens.
      render: (x) => (
        <Link to="/fees/receipts/$receiptNo" params={{ receiptNo: x.receiptNo }} className="mtb-num text-brand-ink underline-offset-2 hover:underline" onClick={(e) => e.stopPropagation()}>
          {x.receiptNo}
        </Link>
      ),
    },
    { key: "at", header: oneDay ? "Time" : "When", width: oneDay ? 90 : 170, render: (x) => <span className="mtb-num">{oneDay ? formatTime(x.at) : formatDateTime(x.at)}</span> },
    {
      key: "student",
      header: "Student",
      render: (x) => (
        <span className="grid">
          <span className="font-medium">{x.studentName}</span>
          <span className="text-small text-ink-muted">
            {x.grNo} · {x.classSection}
            {ctx.campus === "ALL" ? ` · ${campusLabel(x.campus)}` : ""}
          </span>
        </span>
      ),
    },
    ...(byHead
      ? heads.map(
          (h): Column<FeeCollectionRow> => ({
            key: `h-${h.code}`,
            header: h.short,
            align: "right",
            render: (x) => {
              const v = headAmount(x, h.code);
              return v ? (
                <span className="grid justify-items-end">
                  <span className="mtb-num">{formatRs(v)}</span>
                  <span className="text-small text-ink-muted">{installmentOf(x, h.code)}</span>
                </span>
              ) : (
                ""
              );
            },
          }),
        )
      : [{ key: "heads", header: "For", render: (x: FeeCollectionRow) => <span className="text-small">{x.heads}</span> }]),
    { key: "fine", header: "Fine", align: "right", render: (x) => (x.fine ? <span className="mtb-num">{formatRs(x.fine)}</span> : "") },
    { key: "cashier", header: "Cashier", render: (x) => <span className="text-small">{x.cashier}</span> },
    {
      key: "method",
      header: "Paid by",
      render: (x) => (
        <span className="grid text-small">
          <span>{PAYMENT_METHOD_LABEL[x.method]}</span>
          {x.bankRef && <span className="mtb-mono text-ink-muted">{x.bankRef}</span>}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      render: (x) => (
        <span className="grid justify-items-end">
          <span className={`mtb-num ${x.status === "CANCELLED" ? "line-through text-ink-muted" : ""}`}>{formatRs(x.amount)}</span>
          {x.status === "CANCEL_PENDING" && (
            <StatusBadge status="pending" dot={false}>
              Cancellation pending
            </StatusBadge>
          )}
          {x.status === "CANCELLED" && <StatusBadge status="cancelled" />}
        </span>
      ),
    },
  ];

  // With one fee head chosen the list is the head-wise student list (legacy Fee Collection Report, Head Wise).
  const headColumns: Array<Column<FeeCollectionRow>> = [
    { key: "grNo", header: "G.R. No.", width: 110, render: (x) => <span className="mtb-mono">{x.grNo}</span> },
    { key: "student", header: "Student", render: (x) => <span className="font-medium">{x.studentName}</span> },
    { key: "class", header: "Class", render: (x) => classList.nameOf(x.classSection.split("-")[0] ?? "") },
    { key: "section", header: "Section", render: (x) => x.classSection },
    { key: "at", header: "Payment date", render: (x) => <span className="mtb-num">{formatDate(x.at)}</span> },
    {
      key: "receiptNo",
      header: "Receipt",
      render: (x) => (
        <Link to="/fees/receipts/$receiptNo" params={{ receiptNo: x.receiptNo }} className="mtb-num text-brand-ink underline-offset-2 hover:underline">
          {x.receiptNo}
        </Link>
      ),
    },
    { key: "inst", header: "For", render: (x) => <span className="text-small">{installmentOf(x, head)}</span> },
    { key: "amount", header: headTitle || "Amount", align: "right", render: (x) => <span className={`mtb-num ${x.status === "CANCELLED" ? "line-through text-ink-muted" : ""}`}>{formatRs(headAmount(x, head))}</span> },
  ];

  const title = oneDay ? `Collection on ${formatDate(from ?? feeToday())}` : `Collection ${formatDate(from ?? feeToday())} to ${formatDate(to ?? feeToday())}`;

  return (
    <RequirePermission permission="fees.reports" page="the collection report">
      <Page>
        <PageHeader
          title="Daily collection"
          actions={
            <>
              <Button icon="printer" onClick={() => setPrinting(true)} loading={printing} loadingLabel="Preparing…" disabled={!r}>
                Print report
              </Button>
              {isToday && canCollect && !readOnly && ctx.campus !== "ALL" && (
                <Button variant="primary" icon="lock" onClick={() => setClosing(true)}>
                  Close today's cash
                </Button>
              )}
            </>
          }
        />
        <FeesNav />
        <div className="flex flex-wrap items-end gap-3">
          <Segmented
            aria-label="Period"
            value={preset}
            onChange={(v) => setPreset(v as Preset)}
            options={[
              { value: "TODAY", label: "Today" },
              { value: "YESTERDAY", label: "Last school day" },
              { value: "MONTH", label: "This month" },
              { value: "CUSTOM", label: "Choose dates" },
            ]}
          />
          {preset === "CUSTOM" && (
            <>
              <div className="w-48">
                <DatePicker label="From" value={from} onValueChange={setFrom} today={feeToday()} maxDate={feeToday()} />
              </div>
              <div className="w-48">
                <DatePicker label="To" value={to} onValueChange={setTo} today={feeToday()} maxDate={feeToday()} error={rangeError} />
              </div>
            </>
          )}
        </div>
        {report.isError && <LoadError what="The collection report" error={report.error} onRetry={() => void report.refetch()} />}
        {r && matches !== null && (
          <Banner tone={matches ? "success" : "warning"} icon={matches ? "checkCircle" : "alert"} title={matches ? "Matches the dashboard and the receipts." : "Doesn't match the dashboard."}>
            {matches
              ? `${formatRs(r.total.amount)} from ${formatCount(r.total.receipts)} receipts, the same figure the principal sees on the dashboard. Every receipt is listed below.`
              : `The dashboard shows ${formatRs(r.dashboardToday!.amount)}; this report adds up to ${formatRs(r.total.amount)}. Reload both pages; if it still differs, tell the accountant.`}
          </Banner>
        )}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label={oneDay ? "Collected" : "Collected in the period"} icon="receipt" loading={report.isLoading} value={<AnimatedNumber value={r?.total.amount ?? 0} format={formatRs} />} foot={oneDay ? formatLongDate(from ?? feeToday()) : `${formatCount(r?.days.length ?? 0)} school days`} />
          <StatCard label="Receipts" icon="file" loading={report.isLoading} value={<AnimatedNumber value={r?.total.receipts ?? 0} format={formatCount} />} foot={r && r.total.receipts ? `Average ${formatRs(Math.round(r.total.amount / r.total.receipts))}` : "—"} />
          <StatCard label="Late fine inside it" icon="clock" loading={report.isLoading} value={<AnimatedNumber value={r?.total.fine ?? 0} format={formatRs} />} foot="Worked out by the campus rule" />
          <StatCard label="Cancelled" icon="ban" tone={(r?.cancelled.count ?? 0) > 0 ? "warning" : "neutral"} loading={report.isLoading} value={<AnimatedNumber value={r?.cancelled.count ?? 0} format={formatCount} />} foot={`${formatRs(r?.cancelled.amount ?? 0)} · ${formatCount(r?.pendingCancellations ?? 0)} waiting for approval`} />
        </div>

        {r && (
          <div className="grid items-start gap-6 xl:grid-cols-3">
            <Panel id="by-cashier" title="By cashier" description="Each counter's receipts." rise={1}>
              <GroupList groups={r.byCashier} total={r.total.amount} />
            </Panel>
            <Panel id="by-method" title="By payment method" description="Cash to hand over, and what the bank should show." rise={2}>
              <div className="grid gap-4">
                <SegmentedBar label="Collection by payment method" format={formatRs} segments={r.byMethod.map((m) => ({ key: m.key, label: m.label, value: m.amount, color: METHOD_COLOR[m.key as FeeCollectionMethod] ?? "var(--chart-5)" }))} />
                <ul className="m-0 grid list-none gap-1.5 p-0 text-small">
                  {r.byMethod.map((m, i) => (
                    <li key={m.key} className="mtb-slide-in flex items-center justify-between gap-3" style={slide(i)}>
                      <span className="flex items-center gap-2">
                        <span className="mtb-chart-key" style={{ background: METHOD_COLOR[m.key as FeeCollectionMethod] ?? "var(--chart-5)" }} aria-hidden="true" />
                        {m.label} · {formatCount(m.receipts)}
                      </span>
                      <span className="tabular-nums">{formatRs(m.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Panel>
            <Panel id="by-head" title="By fee head" description="Late fine shown on its own line." rise={3}>
              <GroupList groups={r.byHead} total={r.total.amount} />
            </Panel>
          </div>
        )}

        {r && (
          <div className={`grid items-start gap-6 ${ctx.campus === "ALL" ? "xl:grid-cols-2" : ""}`}>
            <Panel id="by-class" title="By class" description="Whose fees came in, by class." rise={4}>
              <GroupList groups={r.byClass} total={r.total.amount} />
            </Panel>
            {ctx.campus === "ALL" && (
              <Panel id="by-campus" title="By campus" rise={5}>
                <GroupList groups={r.byCampus} total={r.total.amount} />
              </Panel>
            )}
          </div>
        )}

        {r && !oneDay && r.days.length > 1 && (
          <Panel
            id="by-day"
            title="Day by day"
            description="School days only. Collections peak just before the fee due dates."
            rise={4}
            actions={<Segmented aria-label="Show days as" value={view} onChange={setView} options={[{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }]} />}
          >
            {view === "chart" ? (
              <AreaChart
                data={r.days}
                value={(d) => d.amount}
                axisLabel={(d) => formatDate(d.date).slice(0, 6)}
                formatAxis={lakhTick}
                tooltip={(d) => (
                  <>
                    <div className="mtb-chart-tip-title">
                      {formatWeekday(d.date)} {formatDate(d.date)}
                    </div>
                    <div className="mtb-chart-tip-value">{formatRs(d.amount)}</div>
                    <div className="mtb-chart-tip-row">
                      <span>Receipts</span>
                      <span>{formatCount(d.receipts)}</span>
                    </div>
                  </>
                )}
                describe={(d) => `${formatWeekday(d.date)} ${formatDate(d.date)}: ${formatRs(d.amount)} from ${formatCount(d.receipts)} receipts`}
                label={`Daily collection from ${formatDate(r.from)} to ${formatDate(r.to)}`}
              />
            ) : (
              <DataTable
                rows={[...r.days].reverse()}
                rowKey="date"
                density="dense"
                maxHeight={320}
                columns={[
                  { key: "date", header: "Day", render: (d) => `${formatWeekday(d.date).slice(0, 3)} ${formatDate(d.date)}` },
                  { key: "receipts", header: "Receipts", align: "right", render: (d) => formatCount(d.receipts) },
                  { key: "amount", header: "Collected", align: "right", render: (d) => formatRs(d.amount) },
                ]}
              />
            )}
          </Panel>
        )}

        <DataTable
          caption={head ? `${title}, ${headTitle} by student` : `${title}, every receipt`}
          columns={head ? headColumns : columns}
          rows={r?.rows ?? []}
          rowKey="receiptNo"
          loading={report.isLoading}
          toolbar={
            <div className="flex w-full flex-wrap items-end gap-3">
              <div className="w-60">
                <Input aria-label="Search receipts" placeholder="Receipt no., student or G.R." icon="search" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <div className="w-44">
                <Select aria-label="Cashier" value={cashier} onChange={(e) => setCashier(e.target.value)} options={[{ value: "", label: "Every cashier" }, ...(r?.cashiers ?? []).map((c) => ({ value: c, label: c }))]} />
              </div>
              <div className="w-48">
                <Select aria-label="Payment method" value={method} onChange={(e) => setMethod(e.target.value as FeeCollectionMethod | "")} options={[{ value: "", label: "Every method" }, ...methodOptions.map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))]} />
              </div>
              <div className="w-48">
                <Select aria-label="Fee head" value={head} onChange={(e) => setHead(e.target.value)} options={[{ value: "", label: "Every fee head" }, ...heads.map((h) => ({ value: h.code, label: h.title }))]} />
              </div>
              <div className="w-36">
                <Select
                  aria-label="Class"
                  value={cls}
                  onChange={(e) => {
                    setCls(e.target.value);
                    setSection("");
                  }}
                  options={[{ value: "", label: "Every class" }, ...classList.options]}
                />
              </div>
              <div className="w-32">
                <Select aria-label="Section" value={section} disabled={!cls} onChange={(e) => setSection(e.target.value)} options={[{ value: "", label: cls ? "Every section" : "Section" }, ...sectionOptions.map((x) => ({ value: x, label: `${cls}-${x}` }))]} />
              </div>
              <div className="w-36">
                <Select aria-label="Boys or girls" value={gender} onChange={(e) => setGender(e.target.value as "" | "F" | "M")} options={[{ value: "", label: "Boys and girls" }, { value: "M", label: "Boys" }, { value: "F", label: "Girls" }]} />
              </div>
              {!head && <Switch label="Show by head" checked={byHead} onChange={(e) => setByHead(e.target.checked)} />}
              {r && filtersOn && (
                <span className="text-small text-ink-muted">
                  {formatCount(r.rowsTotal)} receipts · {head && r.headAmount !== undefined ? `${formatRs(r.headAmount)} ${headTitle.toLowerCase()}` : formatRs(r.rowsAmount)}
                </span>
              )}
            </div>
          }
          footer={
            r && r.rowsTotal > 0
              ? head
                ? { grNo: `${formatCount(r.rowsTotal)} receipts`, amount: formatRs(r.headAmount ?? 0) }
                : { receiptNo: `${formatCount(r.rowsTotal)} receipts`, amount: formatRs(r.rowsAmount), fine: formatRs(r.rows.reduce((a, x) => a + x.fine, 0)) }
              : undefined
          }
          empty={<EmptyState icon="receipt" title={filtersOn ? "No receipts match" : "No receipts on these days"} description={filtersOn ? "Clear the filters to see every receipt." : "Sundays and holidays have no collection."} />}
          pagination={r && r.rowsTotal > r.pageSize ? <Pagination page={r.page} pageSize={r.pageSize} total={r.rowsTotal} onPageChange={setPage} /> : undefined}
        />

        {r && (r.cancelled.count > 0 || r.closings.length > 0) && (
          <div className="grid items-start gap-6 xl:grid-cols-2">
            {r.cancelled.count > 0 && (
              <Panel id="cancelled" title="Cancelled receipts" description={cashier ? `Taken by ${cashier}, cancelled in this period.` : "Approved by the principal in this period. The numbers are never reused."} rise={5}>
                {cancelledItems.length === 0 ? (
                  <p className="m-0 text-small text-ink-muted">None of {cashier}'s receipts were cancelled in this period.</p>
                ) : (
                  <ul className="m-0 grid list-none gap-2 p-0 text-small">
                    {cancelledItems.map((c, i) => (
                      <li key={c.receiptNo} className="mtb-slide-in flex flex-wrap justify-between gap-2 rounded-md border border-border px-3 py-2" style={slide(i)}>
                        <span className="grid">
                          <span className="font-medium">
                            {c.receiptNo} · {c.studentName} <span className="font-normal text-ink-muted">({c.grNo}, {c.classSection})</span>
                          </span>
                          <span className="text-ink-muted">
                            Paid {formatDate(c.paidOn)} by {c.cashier} · cancelled {formatDate(c.at)} · {c.cnNo || "—"}
                          </span>
                          <span className="text-ink-muted">
                            {c.heads} · {c.reason} · approved by {c.approvedBy}
                          </span>
                        </span>
                        <span className="tabular-nums line-through">{formatRs(c.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            )}
            {r.closings.length > 0 && (
              <Panel id="closings" title="Cash closings" description="Cash counted by each cashier at the end of the day." rise={6}>
                <ul className="m-0 grid list-none gap-2 p-0 text-small">
                  {r.closings.map((c, i) => (
                    <li key={c.id} className="mtb-slide-in grid gap-0.5 rounded-md border border-border px-3 py-2" style={slide(i)}>
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">
                          {c.cashier} · {formatDate(c.date)}
                        </span>
                        {c.difference === 0 ? (
                          <StatusBadge status="success" icon="check">
                            Matches
                          </StatusBadge>
                        ) : (
                          <StatusBadge status="warning">{`${formatRs(Math.abs(c.difference))} ${c.difference < 0 ? "short" : "over"}`}</StatusBadge>
                        )}
                      </span>
                      <span className="text-ink-muted">
                        Expected {formatRs(c.expected)} · counted {formatRs(c.counted)} · closed {formatTime(c.closedAt)}
                        {c.note ? ` · ${c.note}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>
        )}

        {printing && printQ.isLoading && (
          <p className="m-0 flex items-center gap-2 text-small text-ink-muted">
            <Icon name="printer" size={16} /> Preparing every receipt for the print-out…
          </p>
        )}
        {r && (
          <div className="fees-print-only mtb-print-area fees-print-a4">
            <PaperSize size={byHead && !head ? "A4L" : "A4"} />
            <div className="fees-doc" data-theme="light">
              <div className="fees-doc-head">
                <div>
                  <h1>{title}</h1>
                  <p>
                    {campusLabel(ctx.campus)} · fee collection report
                    {[cashier, method ? PAYMENT_METHOD_LABEL[method] : "", headTitle, cls ? `${classList.nameOf(cls)}${section ? `-${section}` : ""}` : "", gender === "F" ? "Girls" : gender === "M" ? "Boys" : ""].filter(Boolean).map((x) => ` · ${x}`).join("")}
                  </p>
                </div>
                <p>Printed {formatDate(feeToday())}</p>
              </div>
              <table>
                <tbody>
                  <tr>
                    <th>Receipts</th>
                    <td className="n">{formatCount(r.total.receipts)}</td>
                    <th>Collected</th>
                    <td className="n">{formatRs(r.total.amount)}</td>
                  </tr>
                  <tr>
                    <th>Late fine inside it</th>
                    <td className="n">{formatRs(r.total.fine)}</td>
                    <th>Cancelled</th>
                    <td className="n">
                      {formatCount(r.cancelled.count)} · {formatRs(r.cancelled.amount)}
                    </td>
                  </tr>
                </tbody>
              </table>
              <h2>By cashier and payment method</h2>
              <table>
                <thead>
                  <tr>
                    <th>Cashier</th>
                    <th className="n">Receipts</th>
                    <th className="n">Amount</th>
                    <th>Method</th>
                    <th className="n">Receipts</th>
                    <th className="n">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: Math.max(r.byCashier.length, r.byMethod.length) }, (_, i) => (
                    <tr key={i}>
                      <td>{r.byCashier[i]?.label ?? ""}</td>
                      <td className="n">{r.byCashier[i] ? formatCount(r.byCashier[i]!.receipts) : ""}</td>
                      <td className="n">{r.byCashier[i] ? formatRs(r.byCashier[i]!.amount) : ""}</td>
                      <td>{r.byMethod[i]?.label ?? ""}</td>
                      <td className="n">{r.byMethod[i] ? formatCount(r.byMethod[i]!.receipts) : ""}</td>
                      <td className="n">{r.byMethod[i] ? formatRs(r.byMethod[i]!.amount) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h2>By fee head</h2>
              <table>
                <tbody>
                  {r.byHead.map((h) => (
                    <tr key={h.key}>
                      <td>{h.label}</td>
                      <td className="n">{formatRs(h.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h2>By class</h2>
              <table>
                <thead>
                  <tr>
                    <th>Class</th>
                    <th className="n">Receipts</th>
                    <th className="n">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {r.byClass.map((g) => (
                    <tr key={g.key}>
                      <td>{g.label}</td>
                      <td className="n">{formatCount(g.receipts)}</td>
                      <td className="n">{formatRs(g.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {cancelledItems.length > 0 && (
                <>
                  <h2>Cancelled receipts</h2>
                  <table>
                    <thead>
                      <tr>
                        <th>Cashier</th>
                        <th>Receipt</th>
                        <th>Paid on</th>
                        <th>Cancelled on</th>
                        <th>G.R. no.</th>
                        <th>Student</th>
                        <th>Class</th>
                        <th>For</th>
                        <th>Reason</th>
                        <th className="n">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...cancelledItems].sort((a, b) => a.cashier.localeCompare(b.cashier)).map((c) => (
                        <tr key={c.receiptNo}>
                          <td>{c.cashier}</td>
                          <td>{c.receiptNo}</td>
                          <td>{formatDate(c.paidOn)}</td>
                          <td>{formatDate(c.at)}</td>
                          <td>{c.grNo}</td>
                          <td>{c.studentName}</td>
                          <td>{c.classSection}</td>
                          <td>{c.heads}</td>
                          <td>{c.reason}</td>
                          <td className="n">{formatRs(c.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
              {printRows.length > 0 && head && (
                <>
                  <h2>{headTitle}: students who paid</h2>
                  <table>
                    <thead>
                      <tr>
                        <th>No.</th>
                        <th>G.R. no.</th>
                        <th>Student</th>
                        <th>Class</th>
                        <th>Payment date</th>
                        <th>Receipt</th>
                        <th className="n">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {printRows.map((x, i) => (
                        <tr key={x.receiptNo}>
                          <td>{i + 1}</td>
                          <td>{x.grNo}</td>
                          <td>{x.studentName}</td>
                          <td>{x.classSection}</td>
                          <td>{formatDate(x.at)}</td>
                          <td>{x.receiptNo}</td>
                          <td className="n">{formatRs(headAmount(x, head))}</td>
                        </tr>
                      ))}
                      <tr>
                        <td colSpan={6}>
                          <strong>{formatCount(printRows.length)} receipts</strong>
                        </td>
                        <td className="n">
                          <strong>{formatRs(printRows.reduce((a, x) => a + headAmount(x, head), 0))}</strong>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </>
              )}
              {printRows.length > 0 && !head && byHead && (
                <>
                  <h2>Receipts by fee head</h2>
                  <table>
                    <thead>
                      <tr>
                        <th>Cashier</th>
                        <th>Receipt</th>
                        <th>G.R. no.</th>
                        <th>Student</th>
                        {heads.map((h) => (
                          <th key={h.code} className="n">
                            {h.short}
                          </th>
                        ))}
                        <th className="n">Fine</th>
                        <th className="n">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...printRows]
                        .sort((a, b) => a.cashier.localeCompare(b.cashier) || a.at.localeCompare(b.at))
                        .map((x) => (
                          <tr key={x.receiptNo}>
                            <td>{x.cashier}</td>
                            <td>{x.receiptNo}</td>
                            <td>{x.grNo}</td>
                            <td>
                              {x.studentName} ({x.classSection})
                            </td>
                            {heads.map((h) => (
                              <td key={h.code} className="n">
                                {headAmount(x, h.code) ? formatRs(headAmount(x, h.code)) : ""}
                              </td>
                            ))}
                            <td className="n">{x.fine ? formatRs(x.fine) : ""}</td>
                            <td className="n">
                              {formatRs(x.amount)}
                              {x.status === "CANCELLED" ? " (cancelled)" : ""}
                            </td>
                          </tr>
                        ))}
                      <tr>
                        <td colSpan={4}>
                          <strong>{formatCount(printRows.length)} receipts</strong>
                        </td>
                        {heads.map((h) => (
                          <td key={h.code} className="n">
                            <strong>{formatRs(printRows.reduce((a, x) => a + headAmount(x, h.code), 0))}</strong>
                          </td>
                        ))}
                        <td className="n">
                          <strong>{formatRs(printRows.reduce((a, x) => a + x.fine, 0))}</strong>
                        </td>
                        <td className="n">
                          <strong>{formatRs(printRows.reduce((a, x) => a + x.amount, 0))}</strong>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </>
              )}
              {printRows.length > 0 && !head && !byHead && (
                <>
                  <h2>Receipts</h2>
                  <table>
                    <thead>
                      <tr>
                        <th>Receipt</th>
                        <th>{oneDay ? "Time" : "Date"}</th>
                        <th>Student</th>
                        <th>For</th>
                        <th>Cashier</th>
                        <th>Method</th>
                        <th className="n">Fine</th>
                        <th className="n">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {printRows.map((x) => (
                        <tr key={x.receiptNo}>
                          <td>{x.receiptNo}</td>
                          <td>{oneDay ? formatTime(x.at) : formatDate(x.at)}</td>
                          <td>
                            {x.studentName} ({x.grNo}, {x.classSection})
                          </td>
                          <td>{x.lines.map((l) => `${l.headTitle}${l.installment && l.installment !== l.headTitle ? ` ${l.installment}` : ""} ${formatRs(l.amount)}`).join(" · ")}</td>
                          <td>{x.cashier}</td>
                          <td>
                            {PAYMENT_METHOD_LABEL[x.method]}
                            {x.bankRef ? ` ${x.bankRef}` : ""}
                          </td>
                          <td className="n">{x.fine ? formatRs(x.fine) : ""}</td>
                          <td className="n">
                            {formatRs(x.amount)}
                            {x.status === "CANCELLED" ? " (cancelled)" : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
              <div className="fees-doc-sign">
                <div>Cashier</div>
                <div>Accountant</div>
                <div>Principal</div>
              </div>
            </div>
          </div>
        )}
        {closing && ctx.campus !== "ALL" && <CloseCashPanel campus={ctx.campus} onClose={() => setClosing(false)} />}
      </Page>
    </RequirePermission>
  );
}
