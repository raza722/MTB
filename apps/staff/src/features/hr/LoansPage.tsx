import { hrApi, hrMonthLabel, hrQueries, newIdempotencyKey, type CampusCode, type HrLoan, type HrLoanStatus, type HrLoanType } from "@mtb/api";
import { formatCount, formatDate, formatDateTime, formatRs } from "@mtb/domain";
import { AmountInput, AnimatedNumber, Banner, Button, Combobox, DataTable, DatePicker, EmptyState, Input, KeyValue, Select, SidePanel, StatCard, StatusBadge, Textarea, Timeline, useToast, type Column } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { z } from "zod";
import { campusLabel } from "../../app/shell/campus";
import { RequirePermission } from "../../app/shell/page";
import { useCan, useCtx, useReadOnly, useSessionUser } from "../../app/session";
import { ReportDoc } from "./print";
import { issues } from "./StaffPanels";
import { campusHeading, DesignationSelect, errorField, errorText, filterNote, HrShell, LoadError, LoanBadge, staffOptions, THIS_MONTH, TODAY, useDesignationTitle, usePayAccess, usePrint } from "./shared";

const nextMonths = (n: number) => {
  const out: string[] = [];
  let [y, m] = THIS_MONTH.split("-").map(Number) as [number, number];
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) (m = 1, y++);
  }
  return out;
};

/* ---------------------------------------------------------------- New loan */

function NewLoanPanel({ campus, types, onClose }: { campus: CampusCode; types: HrLoanType[]; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const staff = useQuery(hrQueries.staff(ctx));
  const [staffId, setStaffId] = useState<string | null>(null);
  const [typeId, setTypeId] = useState(types.find((t) => t.active)?.id ?? "");
  const [amount, setAmount] = useState<number | null>(null);
  const [installments, setInstallments] = useState("1");
  const [firstMonth, setFirstMonth] = useState(nextMonths(2)[1]!);
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const t = types.find((x) => x.id === typeId);
  const person = staff.data?.find((s) => s.id === staffId);
  const max = person?.basic && t ? Math.floor(person.basic * t.maxTimesBasic) : null;
  const schema = z.object({
    staffId: z.string().min(1, "Choose the staff member."),
    amount: z
      .number({ error: "Enter the amount." })
      .int()
      .min(1000, "At least Rs 1,000.")
      .refine((v) => max === null || v <= max, `Up to ${formatRs(max ?? 0)} for this person (${t?.maxTimesBasic === 0.5 ? "half a month's" : `${t?.maxTimesBasic} months'`} basic pay).`),
    installments: z.coerce.number().int().min(1).max(t?.maxInstallments ?? 1, `${t?.name}: up to ${t?.maxInstallments} installments.`),
    reason: z.string().trim().min(5, "Say what it is for; the principal reads this."),
  });
  const values = { staffId: staffId ?? "", amount: amount ?? undefined, installments, reason };
  const parsed = schema.safeParse(values);
  const errors = issues(parsed);
  const per = amount && Number(installments) ? Math.ceil(amount / Number(installments)) : 0;
  const key = useMemo(() => newIdempotencyKey(), [JSON.stringify(values), typeId, firstMonth]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: () => hrApi.requestLoan({ campus, staffId: staffId!, typeId, amount: amount!, installments: Number(installments), firstMonth, reason: reason.trim() }, key),
    onSuccess: (l) => {
      toast({ title: `${l.loanNo} sent for approval`, message: `${l.staffName} · ${formatRs(l.principal)} · ${l.installments} × ${formatRs(l.installment)}` });
      void queryClient.invalidateQueries({ queryKey: ["hr"] });
      onClose();
    },
  });
  const sf = errorField(save.error);
  const err = (k: string) => (tried ? (errors[k] ?? (sf === k ? errorText(save.error) : undefined)) : undefined);
  return (
    <SidePanel
      open
      onClose={onClose}
      title="New loan or advance"
      description={`${campusLabel(campus)} · the principal approves; installments come off salary automatically`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon="send"
            loading={save.isPending}
            onClick={() => {
              setTried(true);
              if (parsed.success) save.mutate();
            }}
          >
            Send for approval
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Combobox label="Staff member" required value={staffId} onValueChange={setStaffId} options={staffOptions(staff.data, (s) => s.status === "ACTIVE" && s.campus === campus)} placeholder={staff.isLoading ? "Loading staff…" : "Search by name or employee no."} error={err("staffId")} help={person?.basic ? `Basic pay ${formatRs(person.basic)}` : undefined} />
        <Select
          label="Kind"
          value={typeId}
          onChange={(e) => {
            setTypeId(e.target.value);
            const nt = types.find((x) => x.id === e.target.value);
            if (nt?.kind === "ADVANCE") setInstallments("1");
          }}
          options={types.filter((x) => x.active).map((x) => ({ value: x.id, label: `${x.name} (up to ${x.maxTimesBasic === 0.5 ? "½" : x.maxTimesBasic}× basic, ${x.maxInstallments} installment${x.maxInstallments === 1 ? "" : "s"})` }))}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <AmountInput label="Amount" required value={amount} onValueChange={setAmount} error={err("amount")} help={max ? `Up to ${formatRs(max)}` : undefined} />
          <Select label="Installments" value={installments} onChange={(e) => setInstallments(e.target.value)} options={Array.from({ length: t?.maxInstallments ?? 1 }, (_, i) => String(i + 1))} error={err("installments")} />
        </div>
        <Select label="First deduction from the salary of" value={firstMonth} onChange={(e) => setFirstMonth(e.target.value)} options={nextMonths(4).map((m) => ({ value: m, label: hrMonthLabel(m) }))} error={err("firstMonth")} />
        <Textarea label="What it is for" required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} error={err("reason")} />
        {per > 0 && (
          <div className="rounded-md border border-border bg-surface-sunken p-4 text-small">
            {installments} × <span className="font-semibold">{formatRs(per)}</span> a month from {hrMonthLabel(firstMonth)}. The last installment is only what is left, so nobody pays back more than they borrowed.
          </div>
        )}
        {save.error && (!sf || !(sf in values)) && <Banner tone="danger">{errorText(save.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

/* ---------------------------------------------------------------- One loan */

function LoanPanel({ l, onClose }: { l: HrLoan; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const user = useSessionUser();
  const readOnly = useReadOnly();
  const canDecide = useCan("approvals.decide") && !readOnly;
  const canPayroll = useCan("payroll.manage") && !readOnly;
  const [mode, setMode] = useState<"view" | "reject" | "repay">("view");
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState<number | null>(l.balance);
  const [date, setDate] = useState<string | null>(TODAY);
  const key = useMemo(() => newIdempotencyKey(), [l.id, mode]);
  const done = (title: string, message?: string) => {
    toast({ title, ...(message ? { message } : {}) });
    void queryClient.invalidateQueries({ queryKey: ["hr"] });
    onClose();
  };
  const decide = useMutation({ mutationFn: (approve: boolean) => hrApi.decideLoan(l.id, { approve, note }), onSuccess: (x) => done(x.status === "ACTIVE" ? `${x.loanNo} approved` : `${x.loanNo} rejected`, x.status === "ACTIVE" ? `Deductions start with ${hrMonthLabel(x.firstMonth)}'s salary.` : undefined) });
  const repay = useMutation({ mutationFn: () => hrApi.repayLoan(l.id, { amount: amount ?? 0, date: date ?? "", note }, key), onSuccess: (x) => done(x.status === "CLOSED" ? `${x.loanNo} fully paid back` : "Repayment recorded", `${formatRs(x.balance)} left`) });
  const error = decide.error ?? repay.error;
  return (
    <SidePanel
      open
      onClose={onClose}
      title={`${l.loanNo} · ${l.typeName}`}
      description={`${l.staffName} · ${l.employeeNo} · ${l.designation}`}
      footer={
        l.status === "PENDING" && canDecide ? (
          mode === "reject" ? (
            <>
              <Button onClick={() => setMode("view")}>Back</Button>
              <Button variant="danger" loading={decide.isPending} disabled={note.trim().length < 5} onClick={() => decide.mutate(false)}>
                Reject
              </Button>
            </>
          ) : (
            <>
              <Button variant="danger-quiet" icon="x" onClick={() => setMode("reject")}>
                Reject
              </Button>
              <Button variant="primary" icon="check" loading={decide.isPending} disabled={l.requestedBy === user?.name} onClick={() => decide.mutate(true)}>
                Approve {formatRs(l.principal)}
              </Button>
            </>
          )
        ) : l.status === "ACTIVE" && canPayroll ? (
          mode === "repay" ? (
            <>
              <Button onClick={() => setMode("view")}>Back</Button>
              <Button variant="primary" loading={repay.isPending} disabled={!amount || !date} onClick={() => repay.mutate()}>
                Record {formatRs(amount ?? 0)}
              </Button>
            </>
          ) : (
            <>
              <Button onClick={onClose}>Close</Button>
              <Button icon="receipt" onClick={() => setMode("repay")}>
                Paid back in cash
              </Button>
            </>
          )
        ) : (
          <Button onClick={onClose}>Close</Button>
        )
      }
    >
      <div className="grid gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <LoanBadge status={l.status} />
          <StatusBadge status="neutral" dot={false}>
            {l.kind === "ADVANCE" ? "Taken back from one salary" : `${l.installments} monthly installments`}
          </StatusBadge>
        </div>
        <KeyValue
          items={[
            ["Amount", formatRs(l.principal)],
            ["Installment", `${formatRs(l.installment)} a month from ${hrMonthLabel(l.firstMonth)}`],
            ["Paid back", formatRs(l.recovered)],
            ["Still owed", <span className="font-semibold">{formatRs(l.balance)}</span>],
            ["For", l.reason],
            ["Requested", `${l.requestedBy}, ${formatDateTime(l.requestedAt)}`],
            ...(l.decidedBy ? ([["Decided", `${l.decidedBy}${l.decidedAt ? `, ${formatDateTime(l.decidedAt)}` : ""}${l.decisionNote ? ` · ${l.decisionNote}` : ""}`]] as Array<[string, string]>) : []),
          ]}
        />
        {l.status === "PENDING" && l.requestedBy === user?.name && <Banner tone="info">You entered this request, so someone else approves it.</Banner>}
        {mode === "reject" && <Textarea label="Why is it rejected?" required rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}
        {mode === "repay" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <AmountInput label="Amount received" required value={amount} onValueChange={setAmount} help={`Up to ${formatRs(l.balance)}`} />
            <DatePicker label="Received on" required value={date} onValueChange={setDate} today={TODAY} maxDate={TODAY} />
            <Input label="Receipt or note" value={note} onChange={(e) => setNote(e.target.value)} className="sm:col-span-2" />
          </div>
        )}
        {error && <Banner tone="danger">{errorText(error)}</Banner>}
        <div className="grid gap-2">
          <span className="text-small font-medium">Repayment schedule</span>
          <ul className="m-0 grid list-none gap-1 p-0 text-small">
            {l.schedule.map((s) => (
              <li key={s.month} className="flex items-center justify-between gap-2">
                <span>{hrMonthLabel(s.month)}</span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{formatRs(s.amount)}</span>
                  {s.status === "RECOVERED" ? <StatusBadge status="paid">Taken from salary</StatusBadge> : s.status === "DUE" ? <StatusBadge status="pending">In this month's sheet</StatusBadge> : <StatusBadge status="neutral">Later</StatusBadge>}
                </span>
              </li>
            ))}
          </ul>
          {l.recoveries.some((x) => x.source === "CASH") && <p className="m-0 text-small text-ink-muted">Cash repayments: {l.recoveries.filter((x) => x.source === "CASH").map((x) => `${formatRs(x.amount)} on ${formatDate(x.date)}`).join(", ")}.</p>}
        </div>
        <Timeline label="Loan history" items={l.history.map((h) => ({ id: h.id, date: h.at.slice(0, 10), title: h.text, description: `${h.by}${h.detail ? ` · ${h.detail}` : ""}` }))} />
      </div>
    </SidePanel>
  );
}

/* ---------------------------------------------------------------- Page */

export function LoansPage() {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const payAccess = usePayAccess();
  const canPayroll = useCan("payroll.manage");
  const q = useQuery({ ...hrQueries.loans(ctx), enabled: payAccess });
  const { print, area } = usePrint();
  const [status, setStatus] = useState<HrLoanStatus | "">("");
  const [query, setQuery] = useState("");
  const [des, setDes] = useState("");
  const desTitle = useDesignationTitle(des);
  const [kind, setKind] = useState<"" | "LOAN" | "ADVANCE">("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const d = q.data;
  const rows = (d?.loans ?? []).filter((l) => (!status || l.status === status) && (!kind || l.kind === kind) && (!des || l.designationId === des) && (!query || `${l.staffName} ${l.employeeNo} ${l.loanNo}`.toLowerCase().includes(query.toLowerCase())));
  const statusText = (s: HrLoanStatus) => (s === "ACTIVE" ? "Being repaid" : s === "CLOSED" ? "Paid back" : s === "PENDING" ? "Waiting" : "Rejected");
  const open = d?.loans.find((l) => l.id === openId);
  const columns: Array<Column<HrLoan>> = [
    { key: "no", header: "Loan", render: (l) => <span className="grid"><span className="mtb-num font-medium">{l.loanNo}</span><span className="text-small text-ink-muted">{l.typeName}</span></span> },
    { key: "staff", header: "Staff", render: (l) => <span className="grid"><span className="font-medium">{l.staffName}</span><span className="text-small text-ink-muted">{l.employeeNo} · {l.designation}{ctx.campus === "ALL" ? ` · ${l.campusName}` : ""}</span></span> },
    { key: "amount", header: "Amount", align: "right", render: (l) => <span className="mtb-num">{formatRs(l.principal)}</span> },
    { key: "inst", header: "Installments", align: "right", render: (l) => <span className="mtb-num text-small">{l.installments} × {formatRs(l.installment)}</span> },
    {
      key: "paid",
      header: "Paid back",
      render: (l) => (
        <span className="grid min-w-[110px] gap-1">
          <span className="text-small tabular-nums">{formatRs(l.recovered)} · {formatRs(l.balance)} left</span>
          <span className="hr-meter" aria-hidden="true"><span style={{ width: `${(l.recovered / Math.max(1, l.principal)) * 100}%` }} /></span>
        </span>
      ),
    },
    { key: "status", header: "Status", render: (l) => <LoanBadge status={l.status} /> },
  ];
  if (!payAccess)
    return (
      <RequirePermission permission="payroll.manage" page="Loans and advances">
        <span />
      </RequirePermission>
    );
  return (
    <RequirePermission permission="hr.view" page="Loans and advances">
      <HrShell
        title="Loans and advances"
        actions={
          <>
            <Button
              icon="printer"
              disabled={!d}
              onClick={() =>
                d &&
                print(
                  <ReportDoc
                    campus={ctx.campus === "ALL" ? "All campuses" : campusHeading(ctx.campus)}
                    title={kind === "ADVANCE" ? "Staff salary advances" : kind === "LOAN" ? "Staff loans" : "Staff loans and advances"}
                    sub={filterNote([desTitle, status && statusText(status), query && `matching “${query}”`, `${rows.length} ${kind === "ADVANCE" ? "advances" : "loans"}`, `${formatRs(rows.filter((l) => l.status === "ACTIVE").reduce((a, l) => a + l.balance, 0))} still owed`])}
                    small
                    head={["#", "Loan", "Staff", "Designation", "Kind", "Issued on", "First deduction", "Amount", "Installment", "Paid back", "Owed", "Status"]}
                    numeric={[7, 8, 9, 10]}
                    rows={rows.map((l, i) => [i + 1, l.loanNo, `${l.staffName} (${l.employeeNo})`, l.designation, l.typeName, l.decidedAt && l.status !== "REJECTED" ? formatDate(l.decidedAt.slice(0, 10)) : "", hrMonthLabel(l.firstMonth), formatRs(l.principal), formatRs(l.installment), formatRs(l.recovered), formatRs(l.balance), statusText(l.status)])}
                    total={["", "", "Total", "", "", "", "", formatRs(rows.reduce((a, l) => a + l.principal, 0)), "", formatRs(rows.reduce((a, l) => a + l.recovered, 0)), formatRs(rows.filter((l) => l.status === "ACTIVE").reduce((a, l) => a + l.balance, 0)), ""]}
                    signatures={["Accountant", "Principal"]}
                  />,
                  "A4L",
                )
              }
            >
              Print
            </Button>
            {canPayroll && !readOnly && ctx.campus !== "ALL" && (
              <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
                New loan or advance
              </Button>
            )}
          </>
        }
      >
        {q.isError && <LoadError what="Loans" error={q.error} onRetry={() => void q.refetch()} />}
        <div className="hr-kpis">
          <StatCard label="Still owed" icon="fees" loading={q.isLoading} value={<AnimatedNumber value={d?.summary.outstanding ?? 0} format={formatRs} />} foot={`${d?.summary.active ?? 0} loans being repaid`} onClick={() => setStatus("ACTIVE")} />
          <StatCard label="Next salary deduction" icon="receipt" loading={q.isLoading} value={<AnimatedNumber value={d?.summary.nextDeduction ?? 0} format={formatRs} />} foot="Taken automatically in the salary sheet" />
          <StatCard label="Paid back this session" icon="checkCircle" loading={q.isLoading} value={<AnimatedNumber value={d?.summary.recoveredThisSession ?? 0} format={formatRs} />} foot="From salaries and cash" onClick={() => setStatus("CLOSED")} />
          <StatCard label="Waiting for approval" icon="clock" tone={(d?.summary.pending ?? 0) > 0 ? "warning" : "neutral"} loading={q.isLoading} value={<AnimatedNumber value={d?.summary.pending ?? 0} format={formatCount} />} foot="The principal approves" onClick={() => setStatus("PENDING")} />
        </div>
        <DataTable
          caption="Loans and advances"
          columns={columns}
          rows={rows}
          loading={q.isLoading}
          onRowClick={(l) => setOpenId(l.id)}
          toolbar={
            <div className="flex w-full flex-wrap items-end gap-3">
              <div className="w-56">
                <Input aria-label="Search" placeholder="Staff or loan number" icon="search" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <div className="w-48">
                <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as HrLoanStatus | "")} options={[{ value: "", label: "Every status" }, { value: "PENDING", label: "Waiting for approval" }, { value: "ACTIVE", label: "Being repaid" }, { value: "CLOSED", label: "Paid back" }, { value: "REJECTED", label: "Rejected" }]} />
              </div>
              <div className="w-44">
                <Select
                  aria-label="Kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as typeof kind)}
                  options={[
                    { value: "", label: "Loans and advances" },
                    { value: "LOAN", label: "Loans" },
                    { value: "ADVANCE", label: "Salary advances" },
                  ]}
                />
              </div>
              <DesignationSelect value={des} onChange={setDes} />
            </div>
          }
          empty={<EmptyState icon="receipt" title={status || query || kind || des ? "No loans match" : "No loans or advances"} description={status || query || kind || des ? "Clear the filters to see them all." : undefined} />}
        />
        {open && <LoanPanel l={open} onClose={() => setOpenId(null)} />}
        {creating && d && ctx.campus !== "ALL" && <NewLoanPanel campus={ctx.campus} types={d.types} onClose={() => setCreating(false)} />}
        {area}
      </HrShell>
    </RequirePermission>
  );
}
