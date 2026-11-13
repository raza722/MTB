import {
  FEE_STUDENT_FINE_LABEL,
  feeSetupApi,
  feeSetupQueries,
  feesQueries,
  newIdempotencyKey,
  type CampusCode,
  type FeeFineRule,
  type FeeFineScope,
  type FeeStudentFine,
  type FeeStudentFineKind,
  type FeeWaiver,
  type FeeWaiverKind,
} from "@mtb/api";
import { calculateLateFine, formatCount, formatDate, formatDateTime, formatRs, type LateFinePolicy } from "@mtb/domain";
import {
  AmountInput,
  AnimatedNumber,
  Banner,
  Button,
  Combobox,
  ConfirmDialog,
  DataTable,
  DatePicker,
  EmptyState,
  Input,
  KeyValue,
  Panel,
  Radio,
  Segmented,
  Select,
  SidePanel,
  Skeleton,
  StatCard,
  StatusBadge,
  TabPanel,
  Tabs,
  Textarea,
  Timeline,
  useToast,
  type Column,
} from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { z } from "zod";
import { campusLabel } from "../../../app/shell/campus";
import { Page, PageHeader, RequirePermission } from "../../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../../app/session";
import { addDaysIso, DecisionBadge, errorField, errorText, feeToday, FeesNav, LoadError, monthEndIso, slide, useCanAny, useFeeClasses, useFeeSessionDates } from "../shared";

const scopeText = (s: FeeFineScope) => (s === "ALL" ? "Every fee head" : "Tuition only");
const ruleLine = (r: Pick<FeeFineRule, "ratePerDay" | "graceDays" | "maxFine" | "appliesTo">) =>
  `${formatRs(r.ratePerDay)} a day${r.graceDays ? ` after ${r.graceDays} grace ${r.graceDays === 1 ? "day" : "days"}` : ", from the day after the due date"}${r.maxFine !== null ? `, up to ${formatRs(r.maxFine)} per charge` : ", no maximum"} · ${scopeText(r.appliesTo).toLowerCase()}`;

/* ---------------------------------------------------------------- Rule editor */

function RulePanel({ rule, onClose }: { rule: FeeFineRule; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [rate, setRate] = useState<number | null>(rule.ratePerDay);
  const [grace, setGrace] = useState(String(rule.graceDays));
  const [max, setMax] = useState<number | null>(rule.maxFine);
  const [scope, setScope] = useState<FeeFineScope>(rule.appliesTo);
  const [from, setFrom] = useState<string | null>(addDaysIso(monthEndIso(feeToday().slice(0, 7)), 1));
  const [tried, setTried] = useState(false);
  const schema = z.object({
    rate: z.number({ error: "Enter the fine per day." }).int().min(1, "Enter at least Rs 1 a day.").max(500, "More than Rs 500 a day looks wrong."),
    grace: z.number({ error: "Enter 0 or more grace days." }).int("Use whole days.").min(0, "Enter 0 or more.").max(30, "At most 30 grace days."),
    max: z.number().int().nullable(),
    from: z.string({ error: "Enter the start date." }).min(1, "Enter the start date.").refine((d) => d >= feeToday(), "A new rule starts today or later; posted receipts never change."),
  });
  const parsed = schema.safeParse({ rate: rate ?? undefined, grace: grace === "" ? undefined : Number(grace), max, from: from ?? "" });
  const errors: Record<string, string> = {};
  if (!parsed.success) for (const i of parsed.error.issues) errors[String(i.path[0])] ??= i.message;
  if (max !== null && rate !== null && max < rate) errors.max = "The maximum must be at least one day's fine.";
  const key = useMemo(() => newIdempotencyKey(), [rate, grace, max, scope, from]);
  const save = useMutation({
    mutationFn: () => feeSetupApi.saveFineRule(rule.campus, { ratePerDay: rate!, graceDays: Number(grace), maxFine: max, appliesTo: scope, effectiveFrom: from! }, key),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ["fees", "setup"] });
      toast({ title: `Fine rule saved for ${r.campusName}`, message: `Starts ${formatDate(from!)}: ${ruleLine({ ratePerDay: rate!, graceDays: Number(grace), maxFine: max, appliesTo: scope })}.` });
      onClose();
    },
  });
  const serverField = errorField(save.error);
  const err = (f: string, server = f) => (tried ? (errors[f] ?? (serverField === server ? errorText(save.error) : undefined)) : undefined);
  // A worked example on real dates: a charge that fell due 50 days ago, paid today.
  const sampleDue = addDaysIso(feeToday(), -50);
  const sample = calculateLateFine(sampleDue, feeToday(), { ratePerDay: rate ?? 0, graceDays: Number(grace) || 0, maxFine: max });
  return (
    <SidePanel
      open
      onClose={onClose}
      title={`Late fine at ${rule.campusName}`}
      description="Each campus keeps its own rule; the counter and the vouchers use it."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            loadingLabel="Saving…"
            onClick={() => {
              setTried(true);
              if (Object.keys(errors).length === 0) save.mutate();
            }}
          >
            Save rule
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <AmountInput label="Fine per day" required value={rate} onValueChange={setRate} error={err("rate", "ratePerDay")} />
        <Input label="Grace days" inputMode="numeric" value={grace} onChange={(e) => setGrace(e.target.value.replace(/[^\d]/g, ""))} error={err("grace", "graceDays")} help="Days after the due date before the fine starts. 0 = from the next day." />
        <AmountInput label="Maximum fine per charge" value={max} onValueChange={setMax} error={err("max", "maxFine")} help="Leave empty for no maximum." />
        <div className="grid gap-2">
          <span className="text-small font-medium">Fine runs on</span>
          <Segmented aria-label="Fine runs on" value={scope} onChange={(v) => setScope(v as FeeFineScope)} options={[{ value: "ALL", label: "Every fee head" }, { value: "TUITION", label: "Tuition only" }]} />
        </div>
        <DatePicker label="Starts on" required value={from} onValueChange={setFrom} today={feeToday()} minDate={feeToday()} error={err("from", "effectiveFrom")} help="Until then the current rule stays. Receipts already posted never change." />
        <div className="rounded-md border border-border bg-surface-sunken p-4 text-small">
          <p className="m-0 mb-1 font-medium">Example</p>
          <p className="m-0 text-ink-muted">
            A charge due {formatDate(sampleDue)} paid on {formatDate(feeToday())} ({sample.daysOverdue} days late): {sample.chargeableDays > 0 ? sample.explanation : "no fine"} ={" "}
            <span className="font-semibold text-ink">{formatRs(sample.fine)}</span>.
          </p>
        </div>
        {save.error && !serverField && <Banner tone="danger">{errorText(save.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

/* ---------------------------------------------------------------- Open decisions (labelled variants) */

const VARIANTS: Array<{ id: string; title: string; note: string; policy: LateFinePolicy }> = [
  { id: "A", title: "A · No grace days, no maximum", note: "Rs 10 a day from the day after the due date, no maximum.", policy: { ratePerDay: 10, graceDays: 0, maxFine: null } },
  { id: "B", title: "B · With 5 grace days", note: "Families paid by salary on the 10th aren't fined for the first few days.", policy: { ratePerDay: 10, graceDays: 5, maxFine: null } },
  { id: "C", title: "C · With a maximum", note: "The fine stops growing at Rs 300 per charge.", policy: { ratePerDay: 10, graceDays: 0, maxFine: 300 } },
  { id: "D", title: "D · Grace days and a maximum", note: "5 grace days, then up to Rs 300 per charge.", policy: { ratePerDay: 10, graceDays: 5, maxFine: 300 } },
];

/** A variant is "In use" when a campus in view runs exactly that rule today (from the server's rules). */
function DecisionsPanel({ rules }: { rules: FeeFineRule[] }) {
  const inUse = (p: LateFinePolicy) => rules.some((r) => r.ratePerDay === p.ratePerDay && r.graceDays === p.graceDays && r.maxFine === p.maxFine);
  const [due, setDue] = useState<string | null>(() => addDaysIso(feeToday(), -50));
  const [paid, setPaid] = useState<string | null>(feeToday());
  const [fee, setFee] = useState<number | null>(3000);
  const ok = due && paid && paid >= due;
  return (
    <Panel id="decisions" title="Open decisions: not yet decided" description="Shown side by side so management can choose. Nothing changes until a campus saves a new rule." rise={2}>
      <div className="grid gap-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <AmountInput label="Charge" value={fee} onValueChange={setFee} />
          <DatePicker label="Due date" value={due} onValueChange={setDue} today={feeToday()} />
          <DatePicker label="Paid on" value={paid} onValueChange={setPaid} today={feeToday()} error={due && paid && paid < due ? "Paid on must be on or after the due date." : undefined} />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {VARIANTS.map((v, i) => {
            const f = ok ? calculateLateFine(due!, paid!, v.policy) : null;
            return (
              <div key={v.id} className="mtb-slide-in grid gap-1 rounded-md border border-border p-3" style={slide(i)}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{v.title}</span>
                  {inUse(v.policy) ? <StatusBadge status="success" dot={false}>In use</StatusBadge> : <StatusBadge status="warning" dot={false}>Not decided</StatusBadge>}
                </div>
                <span className="text-small text-ink-muted">{v.note}</span>
                <span className="mt-1 text-title-3 tabular-nums">{f ? formatRs(f.fine) : "—"}</span>
                <span className="text-small text-ink-muted">{f ? `${f.explanation} · family pays ${formatRs((fee ?? 0) + f.fine)}` : "Enter the dates"}</span>
              </div>
            );
          })}
        </div>
        <Banner tone="warning" title="Also to decide: which heads carry the fine?">
          The old system fined only tuition and the Pre-9th fee at Khalid Campus from June 2026, and every head at the other campuses. Each campus can now choose "Every fee head" or "Tuition only" in its rule.
        </Banner>
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------------- Waiver request */

function NewWaiverPanel({ onClose }: { onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const students = useQuery(feeSetupQueries.students(ctx));
  const [grNo, setGrNo] = useState<string | null>(null);
  const counter = useQuery(feesQueries.counter(ctx, grNo ?? ""));
  const [chargeId, setChargeId] = useState<string | null>(null);
  const [kind, setKind] = useState<FeeWaiverKind>("WAIVE");
  const [amount, setAmount] = useState<number | null>(null);
  const [newDue, setNewDue] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const charges = (counter.data?.charges ?? []).map((c) => ({ c, f: calculateLateFine(c.dueDate, counter.data!.today, counter.data!.policy) }));
  const picked = charges.find((x) => x.c.id === chargeId);
  const rate = counter.data?.policy.ratePerDay ?? 10;
  const errors: Record<string, string> = {};
  if (!grNo) errors.grNo = "Choose the student.";
  if (!picked) errors.chargeId = "Choose the charge.";
  if (kind === "WAIVE" && picked) {
    if (picked.f.fine <= 0) errors.kind = "This charge has no late fine yet. Choose Give more time instead.";
    else if (!amount || amount <= 0) errors.amount = "Enter the fine to waive.";
    else if (amount > picked.f.fine) errors.amount = `At most ${formatRs(picked.f.fine)}, the fine so far.`;
    else if (amount % rate !== 0) errors.amount = `Enter a multiple of ${formatRs(rate)}: the fine grows by ${formatRs(rate)} a day.`;
  }
  if (kind === "EXTEND" && picked) {
    if (!newDue) errors.newDue = "Choose the new due date.";
    else if (newDue <= picked.c.dueDate) errors.newDue = `Choose a date after ${formatDate(picked.c.dueDate)}.`;
    else if (newDue < feeToday()) errors.newDue = "The new due date can't be in the past.";
  }
  if (reason.trim().length < 10) errors.reason = "Say why in a sentence; the principal reads this when deciding.";
  const key = useMemo(() => newIdempotencyKey(), [grNo, chargeId, kind, amount, newDue, reason]);
  const save = useMutation({
    mutationFn: () => feeSetupApi.requestWaiver(ctx, { grNo: grNo!, chargeId: chargeId!, kind, ...(kind === "WAIVE" ? { amount: amount! } : { newDueDate: newDue! }), reason: reason.trim() }, key),
    onSuccess: (w) => {
      toast({ title: "Request sent to the principal", message: `${w.studentName} · ${w.kind === "WAIVE" ? `waive ${formatRs(w.amount ?? 0)}` : `pay by ${formatDate(w.newDueDate ?? "")}`}` });
      void queryClient.invalidateQueries({ queryKey: ["fees", "setup"] });
      onClose();
    },
  });
  const serverField = errorField(save.error);
  const err = (f: string, server = f) => (tried ? (errors[f] ?? (serverField === server ? errorText(save.error) : undefined)) : undefined);
  return (
    <SidePanel
      open
      onClose={onClose}
      title="Waive a fine or give more time"
      description="The principal approves; the counter then shows the new figure."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon="send"
            loading={save.isPending}
            loadingLabel="Sending…"
            onClick={() => {
              setTried(true);
              if (Object.keys(errors).length === 0) save.mutate();
            }}
          >
            Send for approval
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <Combobox
          label="Student"
          required
          value={grNo}
          onValueChange={(v) => {
            setGrNo(v);
            setChargeId(null);
          }}
          placeholder="Search by name or G.R. number"
          options={(students.data ?? []).map((s) => ({ value: s.grNo, label: `${s.name} (${s.classSection})`, hint: s.grNo, keywords: [s.grNo, s.father] }))}
          error={err("grNo")}
        />
        {grNo && counter.isLoading && <Skeleton height={120} />}
        {grNo && counter.data && charges.length === 0 && <Banner tone="success">Nothing unpaid for this student.</Banner>}
        {charges.length > 0 && (
          <fieldset className="m-0 grid gap-2 border-0 p-0">
            <legend className="mb-1 text-small font-medium">Charge</legend>
            {charges.map(({ c, f }) => (
              <label key={c.id} className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-border px-3 py-2 has-[:checked]:border-brand has-[:checked]:bg-brand-tint">
                <span className="flex items-center gap-2">
                  <Radio name="waiver-charge" checked={chargeId === c.id} onChange={() => setChargeId(c.id)} aria-label={c.head} />
                  <span className="grid">
                    <span className="font-medium">{c.head}</span>
                    <span className="text-small text-ink-muted">
                      Due {formatDate(c.dueDate)} · {formatRs(c.amount - c.settledAmount)}
                    </span>
                  </span>
                </span>
                <span className="text-small tabular-nums">{f.fine > 0 ? `Fine ${formatRs(f.fine)}` : f.dueInDays !== null ? `Due in ${f.dueInDays} days` : "No fine"}</span>
              </label>
            ))}
            {tried && errors.chargeId && <span className="text-small text-danger-ink">{errors.chargeId}</span>}
          </fieldset>
        )}
        {picked && (
          <>
            <div className="grid gap-2">
              <span className="text-small font-medium">Request</span>
              <Segmented aria-label="Request" value={kind} onChange={(v) => setKind(v as FeeWaiverKind)} options={[{ value: "WAIVE", label: "Waive late fine" }, { value: "EXTEND", label: "Give more time" }]} />
              {tried && errors.kind && <span className="text-small text-danger-ink">{errors.kind}</span>}
            </div>
            {kind === "WAIVE" ? (
              <AmountInput label="Fine to waive" required value={amount} onValueChange={setAmount} error={err("amount")} help={`Fine so far ${formatRs(picked.f.fine)} (${picked.f.explanation}).`} action={picked.f.fine > 0 ? <Button size="sm" variant="quiet" onClick={() => setAmount(picked.f.fine)}>All of it</Button> : undefined} />
            ) : (
              <DatePicker label="New due date" required value={newDue} onValueChange={setNewDue} today={feeToday()} minDate={feeToday()} error={err("newDue", "newDueDate")} help="No fine until this date; after it the fine starts again." />
            )}
          </>
        )}
        <Textarea label="Reason" required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: father was in hospital; the discharge slip was seen." error={err("reason")} />
        {save.error && !serverField && <Banner tone="danger">{errorText(save.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

function WaiverPanel({ w, onClose }: { w: FeeWaiver; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const canDecide = useCan("approvals.decide");
  const readOnly = useReadOnly();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const key = useMemo(() => newIdempotencyKey(), [w.id, rejecting]);
  const decide = useMutation({
    mutationFn: (approve: boolean) => feeSetupApi.decideWaiver(w.id, { approve, note }, key),
    onSuccess: (r) => {
      toast({ title: r.status === "APPROVED" ? "Request approved" : "Request rejected", message: r.status === "APPROVED" ? `${r.studentName}: the counter now shows the new figure.` : `${r.studentName}: the cashier tells the family.` });
      void queryClient.invalidateQueries({ queryKey: ["fees"] });
      onClose();
    },
  });
  return (
    <SidePanel
      open
      onClose={onClose}
      title={w.kind === "WAIVE" ? `Waive ${formatRs(w.amount ?? 0)} of late fine` : `More time until ${formatDate(w.newDueDate ?? "")}`}
      description={`${w.studentName} · ${w.grNo} · ${w.classSection}`}
      footer={
        w.status === "PENDING" && canDecide && !readOnly ? (
          rejecting ? (
            <>
              <Button onClick={() => setRejecting(false)}>Back</Button>
              <Button
                variant="danger"
                loading={decide.isPending}
                loadingLabel="Rejecting…"
                onClick={() => {
                  setTried(true);
                  if (note.trim()) decide.mutate(false);
                }}
              >
                Reject
              </Button>
            </>
          ) : (
            <>
              <Button variant="danger-quiet" icon="x" onClick={() => setRejecting(true)}>
                Reject
              </Button>
              <Button variant="primary" icon="check" loading={decide.isPending} loadingLabel="Approving…" onClick={() => decide.mutate(true)}>
                Approve
              </Button>
            </>
          )
        ) : (
          <Button onClick={onClose}>Close</Button>
        )
      }
    >
      <div className="grid gap-5">
        <DecisionBadge status={w.status} />
        <KeyValue
          items={[
            ["Charge", `${w.chargeHead} · ${formatRs(w.chargeAmount)}`],
            ["Due date", formatDate(w.dueDate)],
            ["Fine when asked", formatRs(w.fineToDate)],
            ["Asked for", w.kind === "WAIVE" ? `Waive ${formatRs(w.amount ?? 0)}` : `Pay by ${formatDate(w.newDueDate ?? "")} without a fine`],
            ["Reason", w.reason],
            ["Requested", `${w.requestedBy}, ${formatDateTime(w.requestedAt)}`],
            ...(w.decidedBy ? ([["Decided", `${w.decidedBy}, ${w.decidedAt ? formatDateTime(w.decidedAt) : ""}${w.decisionNote ? ` · ${w.decisionNote}` : ""}`]] as Array<[string, string]>) : []),
          ]}
        />
        {w.status === "PENDING" && <Banner tone="info">When approved, the late fine for this charge is worked out from {w.kind === "WAIVE" ? `${formatRs(w.amount ?? 0)} less` : formatDate(w.newDueDate ?? "")} at the counter and on vouchers. Nothing is typed by hand.</Banner>}
        {rejecting && <Textarea label="Why is it rejected?" required rows={3} value={note} onChange={(e) => setNote(e.target.value)} error={tried && !note.trim() ? "Say why; the cashier tells the family." : undefined} />}
        {decide.error && <Banner tone="danger">{errorText(decide.error)}</Banner>}
        <Link to="/fees/counter" search={{ gr: w.grNo }} className="text-small text-brand-ink underline-offset-2 hover:underline">
          Open {w.studentName} at the fee counter
        </Link>
      </div>
    </SidePanel>
  );
}

/* ---------------------------------------------------------------- Student fines */

function RaiseFinePanel({ defaults, onClose }: { defaults: Record<FeeStudentFineKind, number>; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const students = useQuery(feeSetupQueries.students(ctx));
  const [grNo, setGrNo] = useState<string | null>(null);
  const [kind, setKind] = useState<FeeStudentFineKind>("BREAKAGE");
  const [amount, setAmount] = useState<number | null>(defaults.BREAKAGE);
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const errors: Record<string, string> = {};
  if (!grNo) errors.grNo = "Choose the student.";
  if (!amount || amount < 50) errors.amount = "Enter at least Rs 50.";
  else if (amount > 10000) errors.amount = "More than Rs 10,000 needs the principal; enter a smaller amount.";
  if (reason.trim().length < 5) errors.reason = "Say what happened, in a few words.";
  const key = useMemo(() => newIdempotencyKey(), [grNo, kind, amount, reason]);
  const save = useMutation({
    mutationFn: () => feeSetupApi.raiseFine(ctx, { grNo: grNo!, kind, amount: amount!, reason: reason.trim() }, key),
    onSuccess: (f) => {
      toast({ title: "Fine recorded", message: `${f.studentName} · ${FEE_STUDENT_FINE_LABEL[f.kind]} · ${formatRs(f.amount)}. Charge it to fees when ready.` });
      void queryClient.invalidateQueries({ queryKey: ["fees", "setup"] });
      onClose();
    },
  });
  return (
    <SidePanel
      open
      onClose={onClose}
      title="Record a fine"
      description="Breakage, mobile phone, lost ID card or an exam absence."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            loadingLabel="Saving…"
            onClick={() => {
              setTried(true);
              if (Object.keys(errors).length === 0) save.mutate();
            }}
          >
            Record fine
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <Combobox
          label="Student"
          required
          value={grNo}
          onValueChange={setGrNo}
          placeholder="Search by name or G.R. number"
          options={(students.data ?? []).map((s) => ({ value: s.grNo, label: `${s.name} (${s.classSection})`, hint: s.grNo, keywords: [s.grNo, s.father] }))}
          error={tried ? errors.grNo : undefined}
        />
        <Select
          label="Kind"
          required
          value={kind}
          onChange={(e) => {
            const k = e.target.value as FeeStudentFineKind;
            setKind(k);
            setAmount(defaults[k]);
          }}
          options={(Object.keys(FEE_STUDENT_FINE_LABEL) as FeeStudentFineKind[]).map((k) => ({ value: k, label: FEE_STUDENT_FINE_LABEL[k] }))}
        />
        <AmountInput label="Amount" required value={amount} onValueChange={setAmount} error={tried ? errors.amount : undefined} help={`Usual amount ${formatRs(defaults[kind])}.`} />
        <Textarea label="What happened" required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: broke a window pane in the science lab on 29-Oct." error={tried ? errors.reason : undefined} />
        {save.error && <Banner tone="danger">{errorText(save.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

/* ---------------------------------------------------------------- Page */

export function FinesPage() {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canSetup = useCan("fees.setup");
  const canDecide = useCan("approvals.decide");
  const canRequest = useCanAny(["fees.collect", "fees.setup", "fees.cancel.request"]);
  const canCharge = useCanAny(["fees.collect", "fees.setup"]);
  const canRaise = useCanAny(["fees.collect", "fees.setup", "students.edit"]);
  const canWaiveFine = useCanAny(["approvals.decide", "fees.setup"]);
  const q = useQuery(feeSetupQueries.fines(ctx));
  const [tab, setTab] = useState("rules");
  const [editRule, setEditRule] = useState<CampusCode | null>(null);
  const [newWaiver, setNewWaiver] = useState(false);
  const [openWaiver, setOpenWaiver] = useState<string | null>(null);
  const [raising, setRaising] = useState(false);
  const [selected, setSelected] = useState<Set<unknown>>(new Set());
  const [charging, setCharging] = useState(false);
  const [waiving, setWaiving] = useState<FeeStudentFine | null>(null);
  const [waiveNote, setWaiveNote] = useState("");
  const [fineCls, setFineCls] = useState("");
  const [fineSection, setFineSection] = useState("");
  const [fineDue, setFineDue] = useState<string | null>(addDaysIso(feeToday(), 7));
  const [chargeTried, setChargeTried] = useState(false);
  const d = q.data;
  const single = ctx.campus !== "ALL";
  const chargeKey = useMemo(() => newIdempotencyKey(), [selected, charging, fineDue]);
  const waiveKey = useMemo(() => newIdempotencyKey(), [waiving]);
  const pendingWaivers = d?.waivers.filter((w) => w.status === "PENDING").length ?? 0;
  const pendingFines = d?.fines.filter((f) => f.status === "PENDING") ?? [];
  const chosen = pendingFines.filter((f) => selected.has(f.id));
  // Class and section filters (legacy Student Fine Calculation).
  const fineRows = (d?.fines ?? []).filter((f) => (!fineCls || f.classSection.split("-")[0] === fineCls) && (!fineSection || f.classSection.split("-")[1] === fineSection));
  const shownPending = fineRows.filter((f) => f.status === "PENDING");
  const classList = useFeeClasses(ctx.campus);
  const sectionsOfFines = classList.sectionsOf(fineCls);
  const sessionEnd = useFeeSessionDates(ctx.campus, ctx.session).end;
  const dueSchema = z
    .string({ error: "Enter the due date." })
    .min(1, "Enter the due date.")
    .refine((v) => v >= feeToday(), "The due date can't be in the past.")
    .refine((v) => v <= sessionEnd, `Choose a date inside the session (up to ${formatDate(sessionEnd)}).`);
  const dueCheck = dueSchema.safeParse(fineDue ?? "");
  const dueError = dueCheck.success ? undefined : dueCheck.error.issues[0]?.message;

  const charge = useMutation({
    mutationFn: () => feeSetupApi.chargeFines({ ids: chosen.map((f) => f.id), dueDate: fineDue! }, chargeKey),
    onSuccess: (r) => {
      toast({ title: `${formatCount(r.charged)} fines added to student fees`, message: `${formatRs(r.amount)} in all, due ${formatDate(fineDue!)}. They show at the counter now.` });
      setSelected(new Set());
      setCharging(false);
      setChargeTried(false);
      void queryClient.invalidateQueries({ queryKey: ["fees"] });
    },
  });
  const waive = useMutation({
    mutationFn: () => feeSetupApi.waiveFine(waiving!.id, waiveNote, waiveKey),
    onSuccess: (f) => {
      toast({ title: "Fine waived", message: `${f.studentName} · ${formatRs(f.amount)}` });
      setWaiving(null);
      setWaiveNote("");
      void queryClient.invalidateQueries({ queryKey: ["fees", "setup"] });
    },
  });

  const waiverCols: Array<Column<FeeWaiver>> = [
    { key: "student", header: "Student", render: (w) => <span className="grid"><span className="font-medium">{w.studentName}</span><span className="text-small text-ink-muted">{w.grNo} · {w.classSection}</span></span> },
    { key: "charge", header: "Charge", render: (w) => <span className="grid"><span>{w.chargeHead}</span><span className="text-small text-ink-muted">Due {formatDate(w.dueDate)}</span></span> },
    { key: "ask", header: "Asked for", render: (w) => (w.kind === "WAIVE" ? `Waive ${formatRs(w.amount ?? 0)} of ${formatRs(w.fineToDate)}` : `Pay by ${formatDate(w.newDueDate ?? "")}`) },
    { key: "status", header: "Status", render: (w) => <DecisionBadge status={w.status} /> },
    { key: "by", header: "Requested", render: (w) => <span className="text-small">{w.requestedBy} · {formatDate(w.requestedAt)}</span> },
  ];
  const fineCols: Array<Column<FeeStudentFine>> = [
    { key: "student", header: "Student", render: (f) => <span className="grid"><span className="font-medium">{f.studentName}</span><span className="text-small text-ink-muted">{f.grNo} · {f.classSection}</span></span> },
    { key: "kind", header: "Fine", render: (f) => <span className="grid"><span>{FEE_STUDENT_FINE_LABEL[f.kind]}</span><span className="text-small text-ink-muted">{f.reason}</span></span> },
    { key: "amount", header: "Amount", align: "right", render: (f) => <span className="mtb-num">{formatRs(f.amount)}</span> },
    { key: "status", header: "Status", render: (f) => <DecisionBadge status={f.status} /> },
    { key: "raised", header: "Raised", render: (f) => <span className="text-small">{f.raisedBy} · {formatDate(f.raisedAt)}</span> },
    {
      key: "act",
      header: "",
      render: (f) =>
        f.status === "PENDING" && canWaiveFine && !readOnly ? (
          <Button
            size="sm"
            variant="quiet"
            onClick={(e) => {
              e.stopPropagation();
              setWaiving(f);
            }}
          >
            Waive
          </Button>
        ) : f.note ? (
          <span className="text-small text-ink-muted">{f.note}</span>
        ) : null,
    },
  ];

  return (
    <RequirePermission permission="fees.view" page="fines">
      <Page>
        <PageHeader
          title="Fines"
          actions={
            tab === "waivers" && canRequest && single && !readOnly ? (
              <Button variant="primary" icon="plus" onClick={() => setNewWaiver(true)}>
                Waiver or more time
              </Button>
            ) : tab === "students" && canRaise && single && !readOnly ? (
              <Button variant="primary" icon="plus" onClick={() => setRaising(true)}>
                Record a fine
              </Button>
            ) : undefined
          }
        />
        <FeesNav />
        {q.isError && <LoadError what="Fines" error={q.error} onRetry={() => void q.refetch()} />}

        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Late fine rule" icon="clock" loading={q.isLoading} value={d?.rules[0] ? `${formatRs(d.rules[0].ratePerDay)} a day` : "—"} foot={single ? `${d?.rules[0]?.graceDays ? `${d.rules[0].graceDays} grace days` : "From the day after the due date"}` : "Per campus; see the table"} onClick={() => setTab("rules")} />
          <StatCard label="Waiting for the principal" icon="shield" tone={pendingWaivers ? "warning" : "neutral"} loading={q.isLoading} value={<AnimatedNumber value={pendingWaivers} format={formatCount} />} foot="Waivers and extra time" onClick={() => setTab("waivers")} />
          <StatCard label="Fines not yet charged" icon="alertCircle" tone={pendingFines.length ? "info" : "neutral"} loading={q.isLoading} value={<AnimatedNumber value={pendingFines.length} format={formatCount} />} foot={`${formatRs(pendingFines.reduce((a, f) => a + f.amount, 0))} in all`} onClick={() => setTab("students")} />
        </div>

        <Tabs
          aria-label="Fines"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "rules", label: "Late fine rule", icon: "clock" },
            { id: "waivers", label: "Waivers and extra time", icon: "shield", count: pendingWaivers },
            { id: "students", label: "Student fines", icon: "alertCircle", count: pendingFines.length },
          ]}
        />

        <TabPanel id="rules" active={tab === "rules"}>
          {q.isLoading && <Skeleton height={320} />}
          {d && (
            <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
              <div className="grid gap-6">
                <Panel id="rule" title={single ? `Rule at ${campusLabel(ctx.campus)}` : "Rule at each campus"} description="Worked out by the system at the counter and on vouchers. Nobody types a fine by hand." rise={0}>
                  <ul className="m-0 grid list-none gap-3 p-0">
                    {d.rules.map((r, i) => (
                      <li key={r.campus} className="mtb-slide-in grid gap-2 rounded-md border border-border p-3" style={slide(i)}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">{r.campusName}</span>
                          {canSetup && !readOnly && (
                            <Button size="sm" icon="edit" onClick={() => setEditRule(r.campus)}>
                              Change
                            </Button>
                          )}
                        </div>
                        <span className="text-small">{ruleLine(r)}</span>
                        <span className="text-small text-ink-muted">
                          In force since {formatDate(r.effectiveFrom)} · set by {r.updatedBy}
                        </span>
                        {r.upcoming && (
                          <Banner tone="info" title={`Changes on ${formatDate(r.upcoming.effectiveFrom)}`}>
                            {ruleLine(r.upcoming)}. Saved by {r.upcoming.updatedBy}.
                          </Banner>
                        )}
                      </li>
                    ))}
                  </ul>
                </Panel>
                <Panel id="rule-history" title="Rule history" rise={1}>
                  <Timeline
                    label="Fine rule history"
                    items={d.rules
                      .flatMap((r) => r.history.map((h) => ({ ...h, campus: r.campusName })))
                      .sort((a, b) => b.at.localeCompare(a.at))
                      .slice(0, 8)
                      .map((h) => ({ id: `${h.campus}-${h.id}`, date: h.at.slice(0, 10), title: h.text, description: `${single ? "" : `${h.campus} · `}${h.by}${h.detail ? ` · ${h.detail}` : ""}`, icon: "clock" as const }))}
                  />
                </Panel>
              </div>
              <DecisionsPanel rules={d.rules} />
            </div>
          )}
        </TabPanel>

        <TabPanel id="waivers" active={tab === "waivers"}>
          <DataTable
            caption="Fine waivers and due-date extensions"
            columns={waiverCols}
            rows={d?.waivers ?? []}
            loading={q.isLoading}
            onRowClick={(w) => setOpenWaiver(w.id)}
            empty={<EmptyState icon="shield" title="No requests" description="When a family can't pay on time, ask here to waive the late fine or give more time. The principal decides." action={canRequest && single && !readOnly ? <Button variant="primary" onClick={() => setNewWaiver(true)}>Waiver or more time</Button> : undefined} />}
          />
          {canDecide && pendingWaivers > 0 && <p className="mt-2 text-small text-ink-muted">Open a request to approve or reject it.</p>}
        </TabPanel>

        <TabPanel id="students" active={tab === "students"}>
          <DataTable
            caption="Student fines"
            columns={fineCols}
            rows={fineRows}
            loading={q.isLoading}
            selectable={canCharge && !readOnly}
            selected={selected}
            onSelectedChange={setSelected}
            isRowSelectable={(f) => f.status === "PENDING"}
            toolbar={
              <div className="flex w-full flex-wrap items-end justify-between gap-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-36">
                    <Select
                      aria-label="Class"
                      value={fineCls}
                      onChange={(e) => {
                        setFineCls(e.target.value);
                        setFineSection("");
                      }}
                      options={[{ value: "", label: "Every class" }, ...classList.options]}
                    />
                  </div>
                  <div className="w-36">
                    <Select aria-label="Section" value={fineSection} disabled={!fineCls} onChange={(e) => setFineSection(e.target.value)} options={[{ value: "", label: fineCls ? "Every section" : "Choose a class" }, ...sectionsOfFines.map((x) => ({ value: x, label: `${fineCls}-${x}` }))]} />
                  </div>
                  {canCharge && !readOnly && (
                    <Button size="sm" variant="quiet" icon="checkSquare" disabled={shownPending.length === 0} onClick={() => setSelected(new Set([...selected, ...shownPending.map((f) => f.id)]))}>
                      Select all shown ({formatCount(shownPending.length)})
                    </Button>
                  )}
                </div>
                {canCharge && !readOnly ? (
                  <Button variant="primary" icon="plus" disabled={chosen.length === 0} onClick={() => setCharging(true)}>
                    Add {chosen.length ? formatCount(chosen.length) : ""} to fees
                  </Button>
                ) : null}
                <span className="w-full text-small text-ink-muted">Exam-absence fines arrive from the exams office. Tick the ones to add to student fees.</span>
              </div>
            }
            empty={<EmptyState icon="checkCircle" title={fineCls ? "No fines in this class" : "No student fines"} description={fineCls ? "Choose every class to see them all." : "Breakage, mobile-phone and exam-absence fines appear here before they go on the fee ledger."} />}
          />
        </TabPanel>

        {editRule && d && <RulePanel rule={d.rules.find((r) => r.campus === editRule)!} onClose={() => setEditRule(null)} />}
        {newWaiver && <NewWaiverPanel onClose={() => setNewWaiver(false)} />}
        {openWaiver && d?.waivers.find((w) => w.id === openWaiver) && <WaiverPanel w={d.waivers.find((w) => w.id === openWaiver)!} onClose={() => setOpenWaiver(null)} />}
        {raising && d && <RaiseFinePanel defaults={d.defaults} onClose={() => setRaising(false)} />}
        <ConfirmDialog
          open={charging}
          onClose={() => setCharging(false)}
          onConfirm={() => {
            setChargeTried(true);
            if (!dueError) charge.mutate();
          }}
          title={`Add ${formatCount(chosen.length)} fines to student fees?`}
          message="Each fine becomes a charge on the student's fee ledger and shows at the counter and on the next voucher."
          details={[
            ["Students", formatCount(new Set(chosen.map((f) => f.grNo)).size)],
            ["Total", formatRs(chosen.reduce((a, f) => a + f.amount, 0))],
          ]}
          confirmLabel={`Add ${formatRs(chosen.reduce((a, f) => a + f.amount, 0))} to fees`}
          loading={charge.isPending}
          loadingLabel="Adding…"
          warning="Once on the ledger, a fine can only be reduced with a waiver approved by the principal."
          {...(charge.error ? { error: errorText(charge.error) } : {})}
        >
          <DatePicker label="Due date" required value={fineDue} onValueChange={setFineDue} today={feeToday()} minDate={feeToday()} maxDate={sessionEnd} error={chargeTried ? dueError : undefined} help="The late fine starts the day after it." />
        </ConfirmDialog>
        <ConfirmDialog
          open={Boolean(waiving)}
          onClose={() => setWaiving(null)}
          onConfirm={() => waiveNote.trim() && waive.mutate()}
          title="Waive this fine?"
          message={waiving ? `${waiving.studentName} · ${FEE_STUDENT_FINE_LABEL[waiving.kind]} · ${formatRs(waiving.amount)}` : undefined}
          confirmLabel="Waive fine"
          tone="warning"
          loading={waive.isPending}
          loadingLabel="Waiving…"
          {...(waive.error ? { error: errorText(waive.error) } : {})}
        >
          <Textarea label="Why" required rows={3} value={waiveNote} onChange={(e) => setWaiveNote(e.target.value)} placeholder="For example: medical certificate submitted on 24-Oct." />
        </ConfirmDialog>
      </Page>
    </RequirePermission>
  );
}

