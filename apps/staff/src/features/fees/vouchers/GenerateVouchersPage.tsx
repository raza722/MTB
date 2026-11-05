import { feeMonthLabel, feeMonthLongLabel, feeSetupApi, newIdempotencyKey, type CampusCode, type FeeVoucherGenerateResult, type FeeVoucherPreview, type FeeVoucherRequest } from "@mtb/api";
import { formatCount, formatDate, formatRs, formatSession } from "@mtb/domain";
import {
  AnimatedNumber,
  Banner,
  Button,
  buttonClassName,
  Checkbox,
  ConfirmDialog,
  DataTable,
  DatePicker,
  Field,
  Icon,
  Panel,
  Segmented,
  Select,
  StatCard,
  Stepper,
  Switch,
  useToast,
} from "@mtb/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { z } from "zod";
import { campusLabel } from "../../../app/shell/campus";
import { Page, PageHeader, RequirePermission, RequireSingleCampus } from "../../../app/shell/page";
import { useCtx, useReadOnly } from "../../../app/session";
import { addDaysIso, CLASS_SHORTS, className, errorField, errorText, FeesNav, monthEndIso, sessionMonthList, slide, TODAY, useCanAny } from "../shared";
import { VoucherSheet } from "./VoucherSheet";

const schema = z
  .object({
    month: z.string().min(1, "Choose the month."),
    classes: z.array(z.string()),
    scope: z.enum(["ALL", "CLASSES"]),
    dueDate: z.string({ error: "Enter the due date." }).min(1, "Enter the due date.").refine((d) => d >= TODAY, "The due date can't be in the past."),
    validUntil: z.string({ error: "Enter the last date the bank accepts it." }).min(1, "Enter the last date the bank accepts it."),
  })
  .refine((v) => v.scope === "ALL" || v.classes.length > 0, { path: ["classes"], message: "Choose at least one class, or the whole campus." })
  .refine((v) => v.validUntil >= v.dueDate, { path: ["validUntil"], message: "The bank must accept it at least until the due date." });

const defaultDue = (month: string) => {
  const tenth = `${month}-10`;
  return tenth >= TODAY ? tenth : addDaysIso(TODAY, 7);
};

function Form({ campus }: { campus: CampusCode }) {
  const ctx = useCtx();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const months = sessionMonthList(ctx.session).filter((m) => m >= TODAY.slice(0, 7)).slice(0, 4);
  const [month, setMonth] = useState(months[1] ?? months[0] ?? "");
  const [scope, setScope] = useState<"ALL" | "CLASSES">("ALL");
  const [classes, setClasses] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState<string | null>(defaultDue(month));
  const [validUntil, setValidUntil] = useState<string | null>(monthEndIso(month));
  const [includeArrears, setIncludeArrears] = useState(true);
  const [tried, setTried] = useState(false);
  const [preview, setPreview] = useState<FeeVoucherPreview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<FeeVoucherGenerateResult | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);

  const req: FeeVoucherRequest = { campus, session: ctx.session, month, classes: scope === "ALL" ? [] : classes, dueDate: dueDate ?? "", validUntil: validUntil ?? "", includeArrears };
  const parsed = schema.safeParse({ month, classes, scope, dueDate: dueDate ?? "", validUntil: validUntil ?? "" });
  const errors = useMemo(() => {
    const out: Record<string, string> = {};
    if (!parsed.success) for (const i of parsed.error.issues) out[String(i.path[0])] ??= i.message;
    return out;
  }, [parsed]);
  const key = useMemo(() => newIdempotencyKey(), [JSON.stringify(req)]); // eslint-disable-line react-hooks/exhaustive-deps

  const previewM = useMutation({ mutationFn: () => feeSetupApi.previewVouchers(req), onSuccess: setPreview });
  const generate = useMutation({
    mutationFn: () => feeSetupApi.generateVouchers(req, key),
    onSuccess: (r) => {
      setConfirming(false);
      setResult(r);
      toast({ title: `${formatCount(r.run.count)} vouchers generated`, message: `${feeMonthLabel(r.run.month)} · ${r.run.scope} · ${formatRs(r.run.total)} payable` });
      void queryClient.invalidateQueries({ queryKey: ["fees"] });
      void queryClient.invalidateQueries({ queryKey: ["students"] });
    },
  });

  const change = (fn: () => void) => {
    fn();
    setPreview(null);
    previewM.reset();
  };
  const onPreview = () => {
    setTried(true);
    if (parsed.success) previewM.mutate();
  };
  const serverField = errorField(previewM.error);
  const step = result ? 2 : preview ? 1 : 0;

  if (result) {
    return (
      <div className="grid gap-6">
        <Stepper steps={["Choose", "Check", "Print"]} current={2} label="Generating vouchers" />
        <Banner tone="success" title={`${formatCount(result.run.count)} vouchers for ${feeMonthLongLabel(result.run.month)} are ready.`}>
          Each student's {feeMonthLabel(result.run.month)} charges are now on their fee ledger and at the counter. Print the run and hand the vouchers out through the class teachers.
        </Banner>
        <div className="flex flex-wrap gap-2">
          <Link to="/fees/vouchers/print" search={{ run: result.run.id }} className={buttonClassName({ variant: "primary" })}>
            <Icon name="printer" size={18} />
            Print all {formatCount(result.run.count)} vouchers
          </Link>
          <Button onClick={() => void navigate({ to: "/fees/vouchers" })}>Back to vouchers</Button>
        </div>
        {result.vouchers[0] && (
          <Panel id="gen-sample" title="First voucher in the run" description={`${result.vouchers[0].studentName} · ${result.vouchers[0].voucherNo}`} rise={0}>
            <div className="fees-desk" style={{ ["--doc-zoom" as string]: 0.62 }}>
              <div className="fees-desk-zoom">
                <VoucherSheet voucher={result.vouchers[0]} />
              </div>
            </div>
          </Panel>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <Stepper steps={["Choose", "Check", "Print"]} current={step} label="Generating vouchers" />
      <Panel id="gen-choose" title="Who and when" description={`Vouchers for ${campusLabel(campus)}, session ${formatSession(ctx.session)}. Each one lists the month's fees, any unpaid arrears and the late-fine table.`} rise={0}>
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="grid content-start gap-4">
            <Select
              label="Month"
              required
              value={month}
              onChange={(e) =>
                change(() => {
                  setMonth(e.target.value);
                  setDueDate(defaultDue(e.target.value));
                  setValidUntil(monthEndIso(e.target.value));
                })
              }
              options={months.map((m) => ({ value: m, label: feeMonthLongLabel(m) }))}
              error={tried ? (errors.month ?? (serverField === "month" ? errorText(previewM.error) : undefined)) : undefined}
            />
            <Field label="For" required error={tried ? errors.classes : undefined}>
              <div className="grid gap-3">
                <Segmented aria-label="Students" value={scope} onChange={(v) => change(() => setScope(v as "ALL" | "CLASSES"))} options={[{ value: "ALL", label: "Whole campus" }, { value: "CLASSES", label: "Choose classes" }]} />
                {scope === "CLASSES" && (
                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    {CLASS_SHORTS.map((c) => (
                      <Checkbox
                        key={c}
                        label={className(c)}
                        checked={classes.includes(c)}
                        onChange={(e) => change(() => setClasses((prev) => (e.target.checked ? [...prev, c] : prev.filter((x) => x !== c))))}
                      />
                    ))}
                  </div>
                )}
              </div>
            </Field>
            <Switch label="Add unpaid arrears from earlier months to each voucher" checked={includeArrears} onChange={(e) => change(() => setIncludeArrears(e.target.checked))} />
          </div>
          <div className="grid content-start gap-4">
            <DatePicker
              label="Due date"
              required
              value={dueDate}
              onValueChange={(v) => change(() => setDueDate(v))}
              today={TODAY}
              minDate={TODAY}
              help="Fees are due on the 10th. The late fine starts the day after."
              error={tried ? (errors.dueDate ?? (serverField === "dueDate" ? errorText(previewM.error) : undefined)) : undefined}
            />
            <DatePicker
              label="Bank accepts it until"
              required
              value={validUntil}
              onValueChange={(v) => change(() => setValidUntil(v))}
              today={TODAY}
              minDate={dueDate ?? TODAY}
              help="After this date parents pay at the school office."
              error={tried ? (errors.validUntil ?? (serverField === "validUntil" ? errorText(previewM.error) : undefined)) : undefined}
            />
          </div>
        </div>
        {previewM.error && !serverField && (
          <Banner tone="danger" className="mt-4">
            {errorText(previewM.error)}
          </Banner>
        )}
        {!preview && (
          <div className="mt-5 flex justify-end">
            <Button variant="primary" icon="eye" onClick={onPreview} loading={previewM.isPending} loadingLabel="Checking…">
              Check before generating
            </Button>
          </div>
        )}
      </Panel>

      {preview && (
        <>
          {preview.blockers.map((b) => (
            <Banner key={b} tone="warning" title="Nothing can be generated yet.">
              {b}
            </Banner>
          ))}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Vouchers" icon="file" value={<AnimatedNumber value={preview.students} format={formatCount} />} foot={`${formatCount(preview.newCharges)} new charges go on the ledgers`} />
            <StatCard label="Payable by the due date" icon="fees" value={<AnimatedNumber value={preview.total} format={formatRs} />} foot={`Due ${formatDate(preview.dueDate)}`} />
            <StatCard label="With arrears" icon="alertCircle" tone={preview.withArrears ? "warning" : "neutral"} value={<AnimatedNumber value={preview.withArrears} format={formatCount} />} foot={`${formatRs(preview.arrearsTotal)} carried from earlier months`} />
            <StatCard label="With a concession" icon="award" value={<AnimatedNumber value={preview.withConcession} format={formatCount} />} foot={`${formatRs(preview.concessionTotal)} off this month`} />
          </div>
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="grid gap-6">
              <Panel id="gen-heads" title="What is charged" description={`New charges for ${feeMonthLongLabel(preview.month)}, after concessions.`} flush rise={1}>
                <DataTable
                  rows={preview.heads}
                  rowKey="head"
                  density="dense"
                  columns={[
                    { key: "title", header: "Fee head", render: (h) => h.title },
                    { key: "count", header: "Students", align: "right", render: (h) => formatCount(h.count) },
                    { key: "amount", header: "Amount", align: "right", render: (h) => formatRs(h.amount) },
                  ]}
                  empty={<p className="m-0 p-4 text-small text-ink-muted">No new charges: the month's fees are already on the ledgers. The vouchers carry what is still unpaid.</p>}
                />
              </Panel>
              <Panel id="gen-classes" title="By class" flush rise={2}>
                <DataTable
                  rows={preview.byClass}
                  rowKey="classSection"
                  density="dense"
                  maxHeight={320}
                  columns={[
                    { key: "classSection", header: "Class", render: (c) => c.classSection },
                    { key: "students", header: "Vouchers", align: "right", render: (c) => formatCount(c.students) },
                    { key: "total", header: "Payable", align: "right", render: (c) => formatRs(c.total) },
                  ]}
                />
              </Panel>
              {preview.skipped.length > 0 && (
                <Panel
                  id="gen-skipped"
                  title={`${formatCount(preview.skipped.length)} students left out`}
                  description="They get no voucher in this run; the reason is beside each name."
                  rise={3}
                  actions={
                    <Button size="sm" variant="quiet" onClick={() => setShowSkipped((s) => !s)}>
                      {showSkipped ? "Hide" : "Show"}
                    </Button>
                  }
                >
                  {showSkipped ? (
                    <ul className="m-0 grid list-none gap-1.5 p-0 text-small">
                      {preview.skipped.slice(0, 40).map((s, i) => (
                        <li key={s.grNo} className="mtb-slide-in flex flex-wrap justify-between gap-2" style={slide(i)}>
                          <span>
                            {s.name} <span className="text-ink-muted">({s.grNo}, {s.classSection})</span>
                          </span>
                          <span className="text-ink-muted">{s.reason}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="m-0 text-small text-ink-muted">Students who already have a voucher for the month, have nothing to pay, or are no longer enrolled.</p>
                  )}
                </Panel>
              )}
            </div>
            {preview.sample && (
              <Panel id="gen-sample" title="How the voucher looks" description={`${preview.sample.studentName} (${preview.sample.classSection}). The number is given when the run is generated.`} rise={1}>
                <div className="fees-desk" style={{ ["--doc-zoom" as string]: 0.56 }}>
                  <div className="fees-desk-zoom">
                    <VoucherSheet voucher={preview.sample} />
                  </div>
                </div>
              </Panel>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={() => setPreview(null)}>Change choices</Button>
            <Button variant="primary" icon="check" disabled={preview.students === 0 || preview.blockers.length > 0} onClick={() => setConfirming(true)}>
              Generate {formatCount(preview.students)} vouchers
            </Button>
          </div>
        </>
      )}

      {preview && (
        <ConfirmDialog
          open={confirming}
          onClose={() => setConfirming(false)}
          onConfirm={() => generate.mutate()}
          title={`Generate ${formatCount(preview.students)} vouchers?`}
          message={`${campusLabel(campus)} · ${feeMonthLongLabel(preview.month)} · ${scope === "ALL" ? "whole campus" : classes.map(className).join(", ")}`}
          details={[
            ["New charges on student ledgers", formatCount(preview.newCharges)],
            ["Payable by the due date", formatRs(preview.total)],
            ["Due date", formatDate(preview.dueDate)],
          ]}
          confirmLabel={`Generate ${formatCount(preview.students)} vouchers`}
          loading={generate.isPending}
          loadingLabel="Generating…"
          warning="The month's charges go on each student's ledger and show at the fee counter. A voucher can be cancelled later, but its number is never reused."
          {...(generate.error ? { error: errorText(generate.error) } : {})}
        />
      )}
    </div>
  );
}

export function GenerateVouchersPage() {
  const { campus } = useCtx();
  const readOnly = useReadOnly();
  const allowed = useCanAny(["fees.collect", "fees.setup"]);
  return (
    <RequirePermission permission="fees.view" page="voucher generation">
      <Page>
        <PageHeader title="Generate fee vouchers" />
        <FeesNav />
        {!allowed ? (
          <Banner tone="warning" title="Your role can view vouchers but not generate them.">
            The cashier or the accountant generates each month's vouchers.
          </Banner>
        ) : readOnly ? (
          <Banner tone="info" title="Past session: read-only.">
            Switch to the current session to generate vouchers.
          </Banner>
        ) : (
          <RequireSingleCampus action="voucher generation">{campus !== "ALL" && <Form campus={campus} />}</RequireSingleCampus>
        )}
      </Page>
    </RequirePermission>
  );
}
