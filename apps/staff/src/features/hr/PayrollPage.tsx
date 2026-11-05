import { HR_CATEGORY_LABEL, HR_PAYMENT_LABEL, HR_PAYROLL_STATUS_LABEL, hrApi, hrMonthLabel, hrMonthShort, hrQueries, newIdempotencyKey, type HrPayrollRun, type HrPayslip, type HrSalaryStructureRow } from "@mtb/api";
import { formatCount, formatDate, formatDateTime, formatLakh, formatRs, formatSession } from "@mtb/domain";
import {
  AmountInput,
  AnimatedNumber,
  AreaChart,
  Banner,
  Button,
  Checkbox,
  ConfirmDialog,
  DataTable,
  DatePicker,
  EmptyState,
  Input,
  KeyValue,
  Menu,
  MenuItem,
  Panel,
  Segmented,
  SegmentedBar,
  SidePanel,
  Skeleton,
  StatCard,
  StatusBadge,
  Textarea,
  Timeline,
  useToast,
  buttonClassName,
  type Column,
} from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { z } from "zod";
import { campusLabel } from "../../app/shell/campus";
import { RequirePermission } from "../../app/shell/page";
import { useCan, useCtx, useReadOnly, useSessionUser } from "../../app/session";
import { BankAdviceDoc, PayslipDoc, SalarySheetDoc } from "./print";
import { issues } from "./StaffPanels";
import { DesignationSelect, downloadCsv, errorField, errorText, filterNote, HrShell, LoadError, RunBadge, slide, TODAY, useDesignationTitle, usePayAccess, usePrint } from "./shared";

export interface PayrollSearch {
  month?: string;
  view?: "sheet" | "structures";
}

const lakhTick = (v: number) => (v === 0 ? "0" : `${Math.round((v / 100_000) * 10) / 10} lakh`);

/* ---------------------------------------------------------------- One payslip */

function PayslipPanel({ run, slip, onClose, onPrint }: { run: HrPayrollRun; slip: HrPayslip; onClose: () => void; onPrint: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const canPayroll = useCan("payroll.manage");
  const readOnly = useReadOnly();
  const canEdit = canPayroll && run.status === "DRAFT" && !readOnly;
  const [bonus, setBonus] = useState<number | null>(slip.bonus);
  const [fine, setFine] = useState<number | null>(slip.fine);
  const [note, setNote] = useState(slip.note ?? "");
  const [hold, setHold] = useState(slip.hold);
  // A held salary paid after the sheet itself was paid.
  const canRelease = canPayroll && !readOnly && run.status === "PAID" && slip.hold && !slip.paidOn;
  const [releasing, setReleasing] = useState(false);
  const [releaseTried, setReleaseTried] = useState(false);
  const [releaseDate, setReleaseDate] = useState<string | null>(TODAY);
  const earliest = run.paymentDate ?? `${run.month}-28`;
  const releaseSchema = z.object({ paymentDate: z.string({ error: "Enter the date it was paid." }).min(1, "Enter the date it was paid.").refine((v) => v >= earliest, `Can't be before the sheet was paid (${formatDate(earliest)}).`) });
  const releaseParsed = releaseSchema.safeParse({ paymentDate: releaseDate ?? "" });
  const releaseKey = useMemo(() => newIdempotencyKey(), [run.id, slip.staffId]);
  const release = useMutation({
    mutationFn: () => hrApi.releaseHeld(run.id, slip.staffId, { paymentDate: releaseDate ?? "" }, releaseKey),
    onSuccess: (r) => {
      queryClient.setQueryData(hrQueries.payrollRun(run.id).queryKey, r);
      void queryClient.invalidateQueries({ queryKey: ["hr"] });
      toast({ title: `${slip.name}'s held salary paid`, message: `${formatRs(slip.net)} · ${HR_PAYMENT_LABEL[slip.paymentMethod]} · ${formatDate(releaseDate ?? TODAY)}` });
      setReleasing(false);
      onClose();
    },
  });
  const releaseError = releaseTried ? (issues(releaseParsed).paymentDate ?? (errorField(release.error) === "paymentDate" ? errorText(release.error) : undefined)) : undefined;
  const save = useMutation({
    mutationFn: () => hrApi.updatePayslip(run.id, slip.staffId, { bonus: bonus ?? 0, fine: fine ?? 0, note: note.trim() || null, hold }),
    onSuccess: (r) => {
      queryClient.setQueryData(hrQueries.payrollRun(run.id).queryKey, r);
      void queryClient.invalidateQueries({ queryKey: ["hr"] });
      toast({ title: `${slip.name}'s slip updated`, message: `Net ${formatRs(r.lines.find((l) => l.staffId === slip.staffId)?.net ?? 0)}` });
      onClose();
    },
  });
  const sf = errorField(save.error);
  return (
    <SidePanel
      open
      wide
      onClose={onClose}
      title={`${slip.name} · ${hrMonthLabel(run.month)}`}
      description={`${slip.employeeNo} · ${slip.designation} · ${slip.department}`}
      footer={
        <>
          <Button icon="printer" onClick={onPrint}>
            Print slip
          </Button>
          {canEdit ? (
            <Button variant="primary" icon="check" loading={save.isPending} onClick={() => save.mutate()}>
              Save and recalculate
            </Button>
          ) : (
            <Button onClick={onClose}>Close</Button>
          )}
        </>
      }
    >
      <div className="grid gap-5">
        <dl className="m-0 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            ["Days paid", `${slip.paidDays} of ${slip.monthDays}`],
            ["Present", slip.presentDays],
            ["Leave", slip.leaveDays],
            ["Unpaid", slip.unpaidDays],
            ["Late", slip.lateCount],
          ].map(([k, v]) => (
            <div key={k as string} className="rounded-md bg-surface-sunken p-2 text-center">
              <dt className="text-small text-ink-muted">{k}</dt>
              <dd className="m-0 font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        {slip.flags.length > 0 && (
          <Banner tone="info" title="Worth checking">
            {slip.flags.map((f) => (
              <div key={f}>{f}</div>
            ))}
          </Banner>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid content-start gap-1">
            <span className="text-small font-medium">Earnings</span>
            <KeyValue items={[...slip.earnings.map((e): [string, string] => [e.label, formatRs(e.amount)]), ["Gross pay", formatRs(slip.gross)]]} />
          </div>
          <div className="grid content-start gap-1">
            <span className="text-small font-medium">Deductions</span>
            <KeyValue
              items={[
                ...slip.deductions.map((d): [ReactNode, string] => [
                  <span className="grid">
                    <span>{d.label}</span>
                    {d.note && <span className="text-small text-ink-muted">{d.note}</span>}
                  </span>,
                  formatRs(d.amount),
                ]),
                ["Total deductions", formatRs(slip.totalDeductions)],
              ]}
            />
          </div>
        </div>
        <div className="flex items-center justify-between rounded-md border border-border bg-surface-sunken px-4 py-3">
          <span className="font-medium">Net pay · {slip.paidOn ? `${HR_PAYMENT_LABEL[slip.paymentMethod]}, paid ${formatDate(slip.paidOn)}` : slip.hold ? "held" : HR_PAYMENT_LABEL[slip.paymentMethod]}</span>
          <span className="text-title-2 tabular-nums">{formatRs(slip.net)}</span>
        </div>
        {slip.paidOn && <Banner tone="success" title={`Held, then paid on ${formatDate(slip.paidOn)}`}>Its loan installments and child fee were recorded on that date.</Banner>}
        {run.status === "PAID" && slip.hold && !slip.paidOn && (
          <div className="grid gap-3 rounded-md border border-border p-4">
            <span className="text-small font-medium">This salary was held when the sheet was paid{run.paymentDate ? ` on ${formatDate(run.paymentDate)}` : ""}.</span>
            {canRelease ? (
              <>
                <span className="text-small text-ink-muted">Pay it now in {HR_PAYMENT_LABEL[slip.paymentMethod].toLowerCase()}. Its loan installments and child fee are recorded with it, and the slip prints the date.</span>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-48">
                    <DatePicker label="Paid on" required value={releaseDate} onValueChange={setReleaseDate} today={TODAY} minDate={earliest} error={releaseError} />
                  </div>
                  <Button
                    variant="primary"
                    icon="checkCircle"
                    onClick={() => {
                      setReleaseTried(true);
                      if (releaseParsed.success) setReleasing(true);
                    }}
                  >
                    Pay this held salary
                  </Button>
                </div>
                {release.error && errorField(release.error) !== "paymentDate" && <Banner tone="danger">{errorText(release.error)}</Banner>}
              </>
            ) : (
              <span className="text-small text-ink-muted">{readOnly ? "This session is closed." : "The accountant pays it from here."}</span>
            )}
          </div>
        )}
        <ConfirmDialog
          open={releasing}
          onClose={() => setReleasing(false)}
          onConfirm={() => release.mutate()}
          tone="warning"
          icon="checkCircle"
          title={`Pay ${slip.name}'s held salary?`}
          message="Do this once the money is handed over or transferred. It can't be undone."
          details={[
            ["Month", hrMonthLabel(run.month)],
            ["Net pay", formatRs(slip.net)],
            ["Paid by", HR_PAYMENT_LABEL[slip.paymentMethod]],
            ["Paid on", formatDate(releaseDate ?? TODAY)],
          ]}
          confirmLabel={`Pay ${formatRs(slip.net)}`}
          loading={release.isPending}
          loadingLabel="Saving…"
          error={release.error ? errorText(release.error) : undefined}
        />
        {canEdit && (
          <div className="grid gap-4 rounded-md border border-border p-4">
            <span className="text-small font-medium">Changes for this month only</span>
            <div className="grid gap-4 sm:grid-cols-2">
              <AmountInput label="Bonus or arrears" value={bonus} onValueChange={setBonus} error={sf === "bonus" ? errorText(save.error) : undefined} />
              <AmountInput label="Fine or other deduction" value={fine} onValueChange={setFine} error={sf === "fine" ? errorText(save.error) : undefined} />
            </div>
            <Input label="What it is for" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Eid bonus / broken lab equipment" help="Printed on the slip." error={sf === "note" ? errorText(save.error) : undefined} />
            <Checkbox label="Hold this salary (not paid with this sheet)" checked={hold} onChange={(e) => setHold(e.target.checked)} />
            {save.error && !sf && <Banner tone="danger">{errorText(save.error)}</Banner>}
          </div>
        )}
      </div>
    </SidePanel>
  );
}

/* ---------------------------------------------------------------- Sheet for one month */

function RunView({ runId }: { runId: string }) {
  const user = useSessionUser();
  const toast = useToast();
  const queryClient = useQueryClient();
  const readOnly = useReadOnly();
  const canPayroll = useCan("payroll.manage") && !readOnly;
  const canDecide = useCan("approvals.decide") && !readOnly;
  const q = useQuery(hrQueries.payrollRun(runId));
  const { print, area } = usePrint();
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState(false);
  const [des, setDes] = useState("");
  const desTitle = useDesignationTitle(des);
  const [confirm, setConfirm] = useState<null | "submit" | "approve" | "return" | "pay">(null);
  const [note, setNote] = useState("");
  const [payDate, setPayDate] = useState<string | null>(TODAY);
  const r = q.data;
  const payKey = useMemo(() => newIdempotencyKey(), [runId]);
  const done = (title: string, message?: string) => {
    toast({ title, ...(message ? { message } : {}) });
    setConfirm(null);
    setNote("");
    void queryClient.invalidateQueries({ queryKey: ["hr"] });
  };
  const recalc = useMutation({ mutationFn: () => hrApi.recalculatePayroll(runId), onSuccess: () => done("Recalculated", "Latest attendance, leave, loans and pay picked up.") });
  const submit = useMutation({ mutationFn: () => hrApi.submitPayroll(runId), onSuccess: () => done("Sent for approval", "The principal approves the salary sheet.") });
  const decide = useMutation({ mutationFn: (approve: boolean) => hrApi.decidePayroll(runId, { approve, note }), onSuccess: (x) => done(x.status === "APPROVED" ? "Salary sheet approved" : "Returned to the accountant", x.status === "APPROVED" ? `${formatRs(x.net)} for ${x.staff} staff. The accountant can now pay.` : undefined) });
  const pay = useMutation({ mutationFn: () => hrApi.payPayroll(runId, { paymentDate: payDate ?? "" }, payKey), onSuccess: (x) => done(`${hrMonthLabel(x.month)} salaries marked as paid`, `${formatRs(x.net)} · loan installments recorded and child fees sent to the fee office.`) });
  const bank = useQuery({ ...hrQueries.bankList(runId), enabled: Boolean(r && (r.status === "APPROVED" || r.status === "PAID") && canPayroll) });
  const error = recalc.error ?? submit.error ?? decide.error ?? pay.error;

  if (q.isError) return <LoadError what="The salary sheet" error={q.error} onRetry={() => void q.refetch()} />;
  if (!r) return <Skeleton height={420} />;
  const byDesignation = r.lines.filter((l) => !des || l.designationId === des);
  const lines = byDesignation.filter((l) => (!query || `${l.name} ${l.employeeNo}`.toLowerCase().includes(query.toLowerCase())) && (!only || l.flags.length > 0 || l.bonus > 0 || l.fine > 0));
  const slip = r.lines.find((l) => l.staffId === open);
  const t = r.totals;
  const printSlips = (which: HrPayslip[]) => print(<>{which.map((l, i) => <PayslipDoc key={l.staffId} run={r} slip={l} first={i === 0} />)}</>, "A5");
  // Staff who sign for their salary: paid in cash or by cheque with the sheet (not by bank, not held).
  const signLines = byDesignation.filter((l) => !l.hold && l.paymentMethod !== "BANK");

  const columns: Array<Column<HrPayslip>> = [
    { key: "name", header: "Staff", render: (l) => <span className="grid"><span className="font-medium">{l.name}</span><span className="text-small text-ink-muted">{l.employeeNo} · {l.designation}</span></span> },
    { key: "days", header: "Days", align: "right", render: (l) => <span className="mtb-num text-small">{l.paidDays - l.unpaidDays}/{l.monthDays}</span> },
    { key: "gross", header: "Gross", align: "right", render: (l) => <span className="mtb-num">{formatRs(l.gross)}</span> },
    { key: "ded", header: "Deductions", align: "right", render: (l) => <span className="mtb-num">{formatRs(l.totalDeductions)}</span> },
    { key: "net", header: "Net pay", align: "right", render: (l) => <span className="mtb-num font-semibold">{formatRs(l.net)}</span> },
    { key: "method", header: "Paid by", render: (l) => (l.hold ? l.paidOn ? <StatusBadge status="paid">Paid later · {formatDate(l.paidOn)}</StatusBadge> : <StatusBadge status="warning">Held</StatusBadge> : <span className="text-small">{HR_PAYMENT_LABEL[l.paymentMethod]}{l.bank ? ` · ${l.bank.bankName}` : ""}</span>) },
    { key: "flags", header: "Notes", render: (l) => <span className="text-small text-ink-muted">{[l.bonus && `Bonus ${formatRs(l.bonus)}`, l.fine && `Deduction ${formatRs(l.fine)}`, ...l.flags.map((f) => f.split(":")[0])].filter(Boolean).slice(0, 2).join(" · ")}</span> },
  ];

  const steps = [
    { label: `Prepared by ${r.preparedBy}`, state: r.status === "DRAFT" ? "is-now" : "is-done" },
    { label: r.decidedBy ? `Approved by ${r.decidedBy}` : "Principal approves", state: r.status === "PENDING" ? "is-now" : r.status === "APPROVED" || r.status === "PAID" ? "is-done" : "" },
    { label: r.status === "PAID" ? `Paid ${formatDate(r.paymentDate ?? TODAY)}` : "Salaries paid", state: r.status === "APPROVED" ? "is-now" : r.status === "PAID" ? "is-done" : "" },
  ];

  return (
    <div className="grid gap-6">
      <section className="mtb-card mtb-rise grid gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <span className="flex flex-wrap items-center gap-2 text-title-2">
              Salary sheet · {hrMonthLabel(r.month)} <RunBadge status={r.status} />
            </span>
            <span className="text-small text-ink-muted">
              {r.campusName} · {r.staff} staff · one day's pay = monthly pay ÷ {r.daysDivisor}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Menu
              trigger={
                <Button icon="printer" iconRight="chevronDown">
                  Print
                </Button>
              }
            >
              <MenuItem icon="file" onSelect={() => print(<SalarySheetDoc run={r} lines={byDesignation} {...(desTitle ? { note: desTitle } : {})} />, "A4L")}>
                Salary sheet (A4 landscape){desTitle ? ` · ${desTitle}` : ""}
              </MenuItem>
              <MenuItem icon="edit" disabled={!signLines.length} onSelect={() => print(<SalarySheetDoc run={r} lines={signLines} note={filterNote([desTitle, "cash and cheque staff: sign on receipt"])} />, "A4L")}>
                Salary sheet with signature column (cash and cheque staff)
              </MenuItem>
              <MenuItem icon="receipt" onSelect={() => printSlips(byDesignation.filter((l) => !l.hold || l.paidOn))}>
                {desTitle ? `Salary slips · ${desTitle} (A5)` : "All salary slips (A5)"}
              </MenuItem>
              {bank.data && (
                <MenuItem icon="building" onSelect={() => print(<BankAdviceDoc list={bank.data} />, "A4")}>
                  Letter to the bank with the transfer list
                </MenuItem>
              )}
            </Menu>
            {bank.data && (
              <Button
                icon="download"
                onClick={() =>
                  downloadCsv(
                    `salary-transfer-${r.campus.toLowerCase()}-${r.month}.csv`,
                    ["Account title", "Account number", "Bank", "Branch", "Amount", "Employee no", "Narration"],
                    bank.data.rows.map((x) => [x.accountTitle, x.accountNo, x.bankName, x.branch, x.amount, x.employeeNo, `Salary ${hrMonthLabel(r.month)}`]),
                  )
                }
              >
                Bank file
              </Button>
            )}
            {r.status === "DRAFT" && canPayroll && (
              <>
                <Button icon="refresh" loading={recalc.isPending} onClick={() => recalc.mutate()}>
                  Recalculate
                </Button>
                <Button variant="primary" icon="send" onClick={() => setConfirm("submit")}>
                  Send for approval
                </Button>
              </>
            )}
            {r.status === "PENDING" && canDecide && (
              <>
                <Button variant="danger-quiet" onClick={() => setConfirm("return")}>
                  Return for changes
                </Button>
                <Button variant="primary" icon="check" disabled={r.preparedBy === user?.name} onClick={() => setConfirm("approve")}>
                  Approve sheet
                </Button>
              </>
            )}
            {r.status === "APPROVED" && canPayroll && (
              <Button variant="primary" icon="checkCircle" onClick={() => setConfirm("pay")}>
                Mark as paid
              </Button>
            )}
          </div>
        </div>
        <div className="hr-steps" aria-label="Progress">
          {steps.map((s, i) => (
            <span key={s.label} className={`hr-step ${s.state}`}>
              {i + 1} · {s.label}
            </span>
          ))}
        </div>
        {r.status === "PENDING" && r.preparedBy === user?.name && <Banner tone="info">You prepared this sheet, so the principal approves it.</Banner>}
        {r.status === "PENDING" && !canDecide && r.preparedBy !== user?.name && <Banner tone="info">Waiting for the principal to approve. Nothing can change while it waits.</Banner>}
        {r.decisionNote && r.status === "DRAFT" && <Banner tone="warning" title="Returned for changes">{r.decisionNote}</Banner>}
        {r.warnings.map((w) => (
          <Banner key={w} tone="warning">
            {w}
          </Banner>
        ))}
        {error && <Banner tone="danger">{errorText(error)}</Banner>}
      </section>

      <div className="hr-kpis">
        <StatCard label="Net pay" icon="fees" value={<AnimatedNumber value={t.net} format={formatRs} />} foot={formatLakh(t.net)} />
        <StatCard label="By bank transfer" icon="building" value={<AnimatedNumber value={t.bank} format={formatRs} />} foot={`${r.lines.filter((l) => (!l.hold || l.paidOn) && l.paymentMethod === "BANK").length} staff`} />
        <StatCard label="In cash" icon="receipt" value={<AnimatedNumber value={t.cash + t.cheque} format={formatRs} />} foot={`${r.lines.filter((l) => (!l.hold || l.paidOn) && l.paymentMethod !== "BANK").length} staff${t.held ? ` · ${formatRs(t.held)} held` : ""}`} />
        <StatCard label="Deductions" icon="minus" value={<AnimatedNumber value={t.deductions} format={formatRs} />} foot={`From ${formatRs(t.gross)} gross`} />
      </div>

      <Panel id="split" title="Where the gross pay goes" description="Take-home pay and every deduction, for the whole sheet." rise={1}>
        <SegmentedBar
          label="Gross pay split"
          format={formatRs}
          segments={[
            { key: "net", label: "Take-home pay", value: t.net, color: "var(--chart-1)" },
            { key: "tax", label: "Income tax", value: t.tax, color: "var(--chart-2)" },
            { key: "eobi", label: "EOBI and provident fund", value: t.eobi + t.providentFund, color: "var(--chart-3)" },
            { key: "loans", label: "Loans and advances", value: t.loans, color: "var(--chart-4)" },
            { key: "child", label: "Children's fees", value: t.childFee, color: "var(--chart-5)" },
            { key: "abs", label: "Absence and fines", value: t.absence + t.fines, color: "var(--ink-subtle)" },
          ].filter((s) => s.value > 0)}
        />
      </Panel>

      <DataTable
        caption={`Salary sheet ${hrMonthLabel(r.month)}`}
        columns={columns}
        rows={lines}
        rowKey="staffId"
        onRowClick={(l) => setOpen(l.staffId)}
        footer={{ name: <span className="font-semibold">Total ({lines.length})</span>, gross: <span className="mtb-num font-semibold">{formatRs(lines.reduce((a, l) => a + l.gross, 0))}</span>, ded: <span className="mtb-num font-semibold">{formatRs(lines.reduce((a, l) => a + l.totalDeductions, 0))}</span>, net: <span className="mtb-num font-semibold">{formatRs(lines.reduce((a, l) => a + l.net, 0))}</span> }}
        toolbar={
          <div className="flex w-full flex-wrap items-center gap-3">
            <div className="w-56">
              <Input aria-label="Search" placeholder="Name or employee no." icon="search" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <DesignationSelect value={des} onChange={setDes} />
            <Checkbox label="Only slips with notes or changes" checked={only} onChange={(e) => setOnly(e.target.checked)} />
            <span className="ml-auto text-small text-ink-muted">Click a row to see the slip{r.status === "DRAFT" && canPayroll ? ", add a bonus or a deduction" : ""}.</span>
          </div>
        }
        empty={<EmptyState icon="receipt" title="No slips match" />}
      />

      <Panel id="pay-history" title="History" rise={2}>
        <Timeline label="Salary sheet history" items={r.history.map((h) => ({ id: h.id, date: h.at.slice(0, 10), title: h.text, description: `${h.by} · ${formatDateTime(h.at)}${h.detail ? ` · ${h.detail}` : ""}` }))} />
      </Panel>

      {slip && <PayslipPanel run={r} slip={slip} onClose={() => setOpen(null)} onPrint={() => printSlips([slip])} />}
      <ConfirmDialog open={confirm === "submit"} onClose={() => setConfirm(null)} onConfirm={() => submit.mutate()} icon="send" title={`Send ${hrMonthLabel(r.month)} for approval?`} message="The principal checks and approves it. It can't change while it waits, but they can return it to you." details={[["Staff", formatCount(r.staff)], ["Net pay", formatRs(t.net)]]} confirmLabel="Send for approval" loading={submit.isPending} error={submit.error ? errorText(submit.error) : undefined} />
      <ConfirmDialog
        open={confirm === "approve"}
        onClose={() => setConfirm(null)}
        onConfirm={() => decide.mutate(true)}
        title={`Approve salaries for ${hrMonthLabel(r.month)}?`}
        message="After approval the accountant sends the transfer list to the bank and marks the sheet as paid."
        details={[
          ["Staff", formatCount(r.staff)],
          ["Gross pay", formatRs(t.gross)],
          ["Deductions", formatRs(t.deductions)],
          ["Net pay", formatRs(t.net)],
        ]}
        confirmLabel={`Approve · ${formatRs(t.net)}`}
        loading={decide.isPending}
        loadingLabel="Approving…"
        error={decide.error ? errorText(decide.error) : undefined}
      />
      <ConfirmDialog open={confirm === "return"} onClose={() => setConfirm(null)} onConfirm={() => decide.mutate(false)} tone="warning" title="Return the sheet for changes?" message="The accountant sees your note, makes the changes and sends it again." confirmLabel="Return" loading={decide.isPending} error={decide.error ? errorText(decide.error) : undefined}>
        <Textarea label="What needs checking?" required rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === "pay"}
        onClose={() => setConfirm(null)}
        onConfirm={() => pay.mutate()}
        tone="warning"
        icon="checkCircle"
        title={`Mark ${hrMonthLabel(r.month)} salaries as paid?`}
        message="Do this after the bank transfer goes through and cash salaries are handed over. Loan installments are recorded and children's fees go to the fee office. A paid sheet can't be changed."
        details={[
          ["Bank transfer", formatRs(t.bank)],
          ["Cash and cheque", formatRs(t.cash + t.cheque)],
          ...(t.held ? ([["Held (not paid)", formatRs(t.held)]] as Array<[string, string]>) : []),
        ]}
        confirmLabel="Mark as paid"
        requireText="PAID"
        loading={pay.isPending}
        loadingLabel="Saving…"
        error={pay.error ? errorText(pay.error) : undefined}
      >
        <div className="mt-3">
          <DatePicker label="Paid on" required value={payDate} onValueChange={setPayDate} today={TODAY} />
        </div>
      </ConfirmDialog>
      {area}
    </div>
  );
}

/* ---------------------------------------------------------------- Salary structures */

function StructuresView() {
  const ctx = useCtx();
  const navigate = useNavigate();
  const q = useQuery(hrQueries.structures(ctx));
  const [query, setQuery] = useState("");
  const rows = (q.data ?? []).filter((r) => !query || `${r.name} ${r.employeeNo} ${r.designation}`.toLowerCase().includes(query.toLowerCase()));
  const columns: Array<Column<HrSalaryStructureRow>> = [
    { key: "name", header: "Staff", render: (r) => <span className="grid"><span className="font-medium">{r.name}</span><span className="text-small text-ink-muted">{r.employeeNo} · {r.designation}</span></span> },
    { key: "cat", header: "Kind", render: (r) => <span className="text-small">{HR_CATEGORY_LABEL[r.category]}</span> },
    { key: "scale", header: "Scale", render: (r) => r.payScale ?? "—" },
    { key: "basic", header: "Basic", align: "right", render: (r) => <span className="mtb-num">{formatRs(r.basic)}</span> },
    { key: "allow", header: "Allowances", align: "right", render: (r) => <span className="mtb-num">{formatRs(r.allowances)}</span> },
    { key: "gross", header: "Gross", align: "right", render: (r) => <span className="mtb-num">{formatRs(r.gross)}</span> },
    { key: "ded", header: "Standing deductions", align: "right", render: (r) => <span className="mtb-num">{formatRs(r.standingDeductions)}</span> },
    { key: "net", header: "Usual take-home", align: "right", render: (r) => <span className="mtb-num font-medium">{formatRs(r.net)}</span> },
    { key: "pay", header: "Paid by", render: (r) => <span className="text-small">{HR_PAYMENT_LABEL[r.paymentMethod]}{r.bankName ? ` · ${r.bankName}` : ""}</span> },
    { key: "change", header: "Last change", render: (r) => <span className="grid text-small"><span className="mtb-num">{formatDate(r.lastChange)}</span>{r.pendingChange && <span className="text-success-ink">{formatRs(r.pendingChange.basic)} from {formatDate(r.pendingChange.effectiveFrom)}</span>}</span> },
  ];
  return (
    <>
      {q.isError && <LoadError what="Salary structures" error={q.error} onRetry={() => void q.refetch()} />}
      <DataTable
        caption="Salary structures"
        columns={columns}
        rows={rows}
        rowKey="staffId"
        loading={q.isLoading}
        onRowClick={(r) => void navigate({ to: "/hr/staff/$staffId", params: { staffId: r.staffId }, search: { tab: "pay" } })}
        footer={{ name: <span className="font-semibold">Total ({rows.length})</span>, basic: <span className="mtb-num font-semibold">{formatRs(rows.reduce((a, r) => a + r.basic, 0))}</span>, gross: <span className="mtb-num font-semibold">{formatRs(rows.reduce((a, r) => a + r.gross, 0))}</span>, net: <span className="mtb-num font-semibold">{formatRs(rows.reduce((a, r) => a + r.net, 0))}</span> }}
        toolbar={
          <div className="flex w-full flex-wrap items-center gap-3">
            <div className="w-64">
              <Input aria-label="Search" placeholder="Name, employee no. or designation" icon="search" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <span className="text-small text-ink-muted">Basic pay plus house rent, conveyance, medical and any special allowance. Click someone to change their pay.</span>
          </div>
        }
        empty={<EmptyState icon="fees" title="No staff" />}
      />
    </>
  );
}

/* ---------------------------------------------------------------- Page */

export function PayrollPage({ search, setSearch }: { search: PayrollSearch; setSearch: (s: PayrollSearch) => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const payAccess = usePayAccess();
  const canPayroll = useCan("payroll.manage");
  const readOnly = useReadOnly();
  const q = useQuery({ ...hrQueries.payroll(ctx), enabled: payAccess });
  const [chart, setChart] = useState("chart");
  const view = search.view ?? "sheet";
  const d = q.data;
  const months = d?.months ?? [];
  const withRun = months.filter((m) => m.run);
  const fallback = months.find((m) => m.canPrepare)?.month ?? withRun.at(-1)?.month ?? months.at(-1)?.month;
  const month = search.month && months.some((m) => m.month === search.month) ? search.month : fallback;
  const current = months.find((m) => m.month === month);
  const key = useMemo(() => newIdempotencyKey(), [month, ctx.campus]);
  const prepare = useMutation({
    mutationFn: () => hrApi.preparePayroll({ campus: ctx.campus as "KC", month: month! }, key),
    onSuccess: (r) => {
      toast({ title: `${hrMonthLabel(r.month)} salary sheet prepared`, message: `${r.staff} staff · ${formatRs(r.net)} net. Check it, then send it for approval.` });
      void queryClient.invalidateQueries({ queryKey: ["hr"] });
    },
  });

  if (!payAccess)
    return (
      <RequirePermission permission="payroll.manage" page="Payroll">
        <span />
      </RequirePermission>
    );

  return (
    <RequirePermission permission="hr.view" page="Payroll">
      <HrShell title="Payroll" actions={ctx.campus !== "ALL" && d?.settings?.runsPayroll ? <Segmented aria-label="Show" value={view} onChange={(v) => setSearch({ ...search, view: v as PayrollSearch["view"] })} options={[{ value: "sheet", label: "Salary sheets" }, { value: "structures", label: "Salary structures" }]} /> : undefined}>
        {q.isError && <LoadError what="Payroll" error={q.error} onRetry={() => void q.refetch()} />}
        {ctx.campus === "ALL" ? (
          <>
            <Banner tone="info">Salary sheets are prepared per campus. Choose a campus at the top to open its sheets.</Banner>
            <DataTable
              caption="Payroll by campus"
              rows={d?.campuses ?? []}
              rowKey="campus"
              loading={q.isLoading}
              columns={[
                { key: "campus", header: "Campus", render: (c) => <span className="font-medium">{c.campusName}</span> },
                { key: "runs", header: "Payroll in the system", render: (c) => (c.runsPayroll ? <StatusBadge status="success">On</StatusBadge> : <StatusBadge status="neutral">Paid outside the system</StatusBadge>) },
                { key: "staff", header: "Staff paid here", align: "right", render: (c) => <span className="mtb-num">{c.staff}</span> },
                { key: "last", header: "Latest sheet", render: (c) => (c.last ? <span className="flex items-center gap-2">{hrMonthLabel(c.last.month)} <RunBadge status={c.last.status} /></span> : "—") },
                { key: "net", header: "Net pay", align: "right", render: (c) => <span className="mtb-num">{c.last ? formatRs(c.last.net) : "—"}</span> },
              ]}
            />
          </>
        ) : d && d.settings && !d.settings.runsPayroll ? (
          <div className="mtb-card">
            <EmptyState
              icon="fees"
              title={`${campusLabel(ctx.campus)} pays salaries outside the system`}
              description="Payroll is switched on per campus. Staff records, attendance, leave and increments still work here."
              action={
                canPayroll ? (
                  <Link to="/hr/settings" className={buttonClassName({ variant: "primary", size: "sm" })}>
                    Turn on payroll in Settings
                  </Link>
                ) : undefined
              }
            />
          </div>
        ) : view === "structures" ? (
          <StructuresView />
        ) : (
          <>
            <div className="grid items-start gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
              <Panel id="months" title={`Months · ${formatSession(ctx.session)}`} rise={0} flush>
                {q.isLoading ? (
                  <div className="p-4">
                    <Skeleton height={200} />
                  </div>
                ) : months.length === 0 ? (
                  <EmptyState icon="calendar" title="No months yet" />
                ) : (
                  <ul className="m-0 grid list-none gap-1 p-2">
                    {[...months].reverse().map((m, i) => (
                      <li key={m.month} className="mtb-slide-in" style={slide(i)}>
                        <button type="button" onClick={() => setSearch({ ...search, month: m.month })} aria-current={m.month === month ? "true" : undefined} className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left ${m.month === month ? "bg-brand-tint" : "hover:bg-surface-hover"}`}>
                          <span className="grid">
                            <span className="font-medium">{hrMonthLabel(m.month)}</span>
                            <span className="text-small text-ink-muted tabular-nums">{m.run ? formatRs(m.run.net) : m.canPrepare ? "Ready to prepare" : m.month >= TODAY.slice(0, 7) ? "Month not over" : "Not prepared"}</span>
                          </span>
                          {m.run && <RunBadge status={m.run.status} />}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
              <div className="grid gap-6">
                {withRun.length > 1 && (
                  <Panel id="trend" title="Net salaries by month" description={`${campusLabel(ctx.campus)} · paid and prepared sheets this session`} rise={1} actions={<Segmented aria-label="Show as" value={chart} onChange={setChart} options={[{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }]} />}>
                    {chart === "chart" ? (
                      <AreaChart
                        data={withRun}
                        value={(m) => m.run!.net}
                        axisLabel={(m) => hrMonthShort(m.month)}
                        formatAxis={lakhTick}
                        peakLabel={(m) => formatLakh(m.run!.net)}
                        tooltip={(m) => (
                          <>
                            <div className="mtb-chart-tip-title">{hrMonthLabel(m.month)}</div>
                            <div className="mtb-chart-tip-value">{formatRs(m.run!.net)}</div>
                            <div className="mtb-chart-tip-row"><span>Staff</span><span>{m.run!.staff}</span></div>
                            <div className="mtb-chart-tip-row"><span>Status</span><span>{HR_PAYROLL_STATUS_LABEL[m.run!.status]}</span></div>
                          </>
                        )}
                        describe={(m) => `${hrMonthLabel(m.month)}: ${formatRs(m.run!.net)} for ${m.run!.staff} staff, ${HR_PAYROLL_STATUS_LABEL[m.run!.status].toLowerCase()}`}
                        label="Net salaries each month"
                        height={200}
                      />
                    ) : (
                      <table className="w-full text-small">
                        <thead>
                          <tr className="text-left text-ink-muted">
                            <th className="py-1 font-medium">Month</th>
                            <th className="py-1 text-right font-medium">Staff</th>
                            <th className="py-1 text-right font-medium">Gross</th>
                            <th className="py-1 text-right font-medium">Net</th>
                            <th className="py-1 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {withRun.map((m) => (
                            <tr key={m.month} className="border-t border-border">
                              <td className="py-1">{hrMonthLabel(m.month)}</td>
                              <td className="py-1 text-right tabular-nums">{m.run!.staff}</td>
                              <td className="py-1 text-right tabular-nums">{formatRs(m.run!.gross)}</td>
                              <td className="py-1 text-right tabular-nums">{formatRs(m.run!.net)}</td>
                              <td className="py-1">{HR_PAYROLL_STATUS_LABEL[m.run!.status]}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </Panel>
                )}
                {current?.run ? (
                  <RunView key={current.run.id} runId={current.run.id} />
                ) : current?.canPrepare ? (
                  <div className="mtb-card">
                    <EmptyState
                      icon="fees"
                      title={`${hrMonthLabel(current.month)} isn't prepared yet`}
                      description="The sheet is worked out from each person's salary structure, the month's attendance and unpaid leave, loan installments and children's fees. You can check and change it before sending it for approval."
                      action={
                        <>
                          <Button variant="primary" icon="fees" loading={prepare.isPending} loadingLabel="Working out…" onClick={() => prepare.mutate()} disabled={readOnly}>
                            Prepare {hrMonthLabel(current.month)} salaries
                          </Button>
                          {prepare.error && <Banner tone="danger" className="mt-3 text-left">{errorText(prepare.error)}</Banner>}
                        </>
                      }
                    />
                  </div>
                ) : current ? (
                  <div className="mtb-card">
                    <EmptyState icon="calendar" title={current.month >= TODAY.slice(0, 7) ? `${hrMonthLabel(current.month)} isn't over yet` : `No salary sheet for ${hrMonthLabel(current.month)}`} description={current.month >= TODAY.slice(0, 7) ? "A month's sheet is prepared after it ends." : readOnly ? "This session is closed." : "Only the accountant prepares salary sheets."} />
                  </div>
                ) : null}
              </div>
            </div>
          </>
        )}
      </HrShell>
    </RequirePermission>
  );
}
