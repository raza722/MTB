import {
  ApiError,
  feeSetupApi,
  feeSetupQueries,
  newIdempotencyKey,
  type CampusCode,
  type FeeClassStructure,
  type FeeCopyPreview,
  type FeeHead,
  type FeeInstallment,
  type FeeInstallmentPlan,
  type FeeSectionOverride,
  type FeeStructure,
} from "@mtb/api";
import { formatCount, formatDate, formatDateTime, formatRs, formatSession } from "@mtb/domain";
import {
  AmountInput,
  AnimatedNumber,
  Banner,
  Button,
  ConfirmDialog,
  DataTable,
  DatePicker,
  EmptyState,
  Icon,
  IconButton,
  Input,
  KeyValue,
  Modal,
  Panel,
  Segmented,
  Select,
  SidePanel,
  Skeleton,
  StatCard,
  Switch,
  Timeline,
  Tooltip,
  useToast,
  type Column,
} from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { z } from "zod";
import { campusLabel } from "../../../app/shell/campus";
import { Page, PageHeader, RequirePermission, RequireSingleCampus } from "../../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../../app/session";
import { className, errorText, feeToday, FeesNav, LoadError, slide } from "../shared";
import { HeadsPanel } from "./HeadsPanel";

/** Heads that can carry an amount per class (transport is priced by route). */
const priceable = (h: FeeHead) => (h.category === "FEE" || h.category === "APPLICATION") && !h.linked;

/** "Tuition / month", "Exam / term", "Annual" */
const perLabel = (h: FeeHead) => `${h.shortTitle}${h.billing === "MONTHLY" ? " / month" : h.billing === "TERMLY" ? " / term" : h.billing === "QUARTERLY" ? " / quarter" : ""}`;

const line = (c: FeeClassStructure, code: string) => c.lines.find((l) => l.head === code);
const amount = (c: FeeClassStructure, code: string) => line(c, code)?.amount ?? 0;

/** Grid columns: every head in general use, plus any head a class has an amount for (gym, pre-9th …). */
function columnHeads(s: FeeStructure): FeeHead[] {
  return s.heads.filter((h) => priceable(h) && ((h.active && h.category === "FEE" && !h.classes?.length && h.billing !== "WHEN_RAISED") || s.classes.some((c) => amount(c, h.code) > 0)));
}

/** How many times a head is billed in the session (0 = one-off, outside the session total). */
function timesBilled(h: FeeHead | undefined, plans: FeeInstallmentPlan[]): number {
  if (!h || h.category !== "FEE" || h.linked) return 0;
  const count = (code: FeeInstallmentPlan["code"]) => plans.find((p) => p.code === code)?.count ?? 1;
  if (h.billing === "MONTHLY" || h.billing === "QUARTERLY" || h.billing === "TERMLY") return count(h.billing);
  return h.billing === "ANNUAL" ? 1 : 0;
}

/** "month", "quarter", "term" for a periodic head; "" otherwise (the structure's amount is per installment). */
const unitOf = (h: FeeHead | undefined) => (h?.billing === "MONTHLY" ? "month" : h?.billing === "QUARTERLY" ? "quarter" : h?.billing === "TERMLY" ? "term" : "");

/** "Monthly heads × 12 months + quarterly heads × 4 quarters + …": how the session total is worked out, from the plans. */
function sessionTotalText(s: FeeStructure): string {
  const unit: Partial<Record<FeeInstallmentPlan["code"], string>> = { MONTHLY: "months", QUARTERLY: "quarters", TERMLY: "terms" };
  const periodic = (["MONTHLY", "QUARTERLY", "TERMLY"] as const)
    .filter((code) => s.heads.some((h) => h.billing === code && h.active && priceable(h) && h.category === "FEE"))
    .map((code) => `${code === "TERMLY" ? "termly" : code.toLowerCase()} heads × ${s.plans.find((p) => p.code === code)?.count ?? 1} ${unit[code]}`);
  return `${[...periodic, "yearly heads"].join(" + ").replace(/^./, (c) => c.toUpperCase())}. One-off heads (admission, test fee) are not in it.`;
}

const PARTS = [
  { value: "1", label: "In one payment" },
  { value: "2", label: "In 2 parts (each term)" },
  { value: "4", label: "In 4 parts (each quarter)" },
  { value: "12", label: "In 12 parts (each month)" },
];

/* ---------------------------------------------------------------- Edit one class */

interface LineDraft {
  amount: number | null;
  active: boolean;
  installments: number;
}

function EditClassPanel({ structure, cls, onClose }: { structure: FeeStructure; cls: FeeClassStructure; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const canEdit = useCan("fees.setup");
  const readOnly = useReadOnly();
  const editable = canEdit && !readOnly;
  const allowed = (h: FeeHead) => priceable(h) && (!h.classes?.length || h.classes.includes(cls.classShort));
  // Heads shown: the grid's columns that apply to this class, plus any head this class already has a line for.
  const initialCodes = [...new Set([...columnHeads(structure).filter(allowed).map((h) => h.code), ...cls.lines.filter((l) => l.amount > 0 || l.active === false).map((l) => l.head)])];
  const [codes, setCodes] = useState<string[]>(initialCodes);
  const [values, setValues] = useState<Record<string, LineDraft>>(() =>
    Object.fromEntries(structure.heads.map((h) => [h.code, { amount: amount(cls, h.code), active: line(cls, h.code)?.active !== false, installments: line(cls, h.code)?.installments ?? 1 }])),
  );
  const [overrides, setOverrides] = useState<Array<{ section: string; head: string; amount: number | null }>>(cls.sectionOverrides.map((o) => ({ ...o })));
  const [adding, setAdding] = useState("");
  const [tried, setTried] = useState(false);
  const addable = structure.heads.filter((h) => allowed(h) && h.active && !codes.includes(h.code));
  const shown = structure.heads.filter((h) => codes.includes(h.code));

  // Dynamic keys: one rule per head shown, tuition required; section amounts checked row by row.
  // Tuition is entered per installment of its plan ("Enter the tuition fee per quarter." where tuition is quarterly).
  const tuitionUnit = unitOf(structure.heads.find((h) => h.code === "TUITION"));
  const tuitionMsg = tuitionUnit ? `Enter the tuition fee per ${tuitionUnit}.` : "Enter the tuition fee.";
  const schema = z
    .object({
      lines: z.object(
        Object.fromEntries(
          codes.map((c) => [
            c,
            c === "TUITION"
              ? z.number({ error: tuitionMsg }).int().min(1, tuitionMsg).max(500000, "That is more than Rs 500,000. Check the figure.")
              : z.number({ error: "Enter the amount, or 0 if this class doesn't pay it." }).int().min(0).max(500000, "That is more than Rs 500,000. Check the figure."),
          ]),
        ),
      ),
      overrides: z.array(
        z.object({
          section: z.string().min(1, "Choose the section."),
          head: z.string().min(1, "Choose the fee head."),
          amount: z.number({ error: "Enter the section's amount." }).int().min(0).max(500000, "That is more than Rs 500,000. Check the figure."),
        }),
      ),
    })
    .superRefine((v, ctx) => {
      const seen = new Set<string>();
      v.overrides.forEach((o, i) => {
        const k = `${o.section}|${o.head}`;
        if (o.section && o.head && seen.has(k)) ctx.addIssue({ code: "custom", path: ["overrides", i, "head"], message: "This section already has an amount for this head." });
        seen.add(k);
      });
    });
  const parsed = schema.safeParse({ lines: Object.fromEntries(codes.map((c) => [c, values[c]?.amount ?? undefined])), overrides: overrides.map((o) => ({ ...o, amount: o.amount ?? undefined })) });
  const errors: Record<string, string> = {};
  if (!parsed.success) for (const i of parsed.error.issues) errors[i.path.join(".")] ??= i.message;

  const year = shown.reduce((a, h) => (values[h.code]?.active ? a + (values[h.code]?.amount ?? 0) * timesBilled(h, structure.plans) : a), 0);
  const body = {
    lines: shown.map((h) => ({ head: h.code, amount: values[h.code]?.amount ?? 0, active: values[h.code]?.active ?? true, ...(h.billing === "ANNUAL" ? { installments: values[h.code]?.installments ?? 1 } : {}) })),
    sectionOverrides: overrides.map((o): FeeSectionOverride => ({ section: o.section, head: o.head, amount: o.amount ?? 0 })),
    rowVer: structure.rowVer,
  };
  const key = useMemo(() => newIdempotencyKey(), [JSON.stringify(body)]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () => feeSetupApi.saveClass(structure.campus, structure.session, cls.classShort, body, key),
    onSuccess: (s) => {
      queryClient.setQueryData(feeSetupQueries.structure(structure.campus, structure.session).queryKey, s);
      void queryClient.invalidateQueries({ queryKey: ["fees", "setup"] });
      toast({ title: `${cls.className} fees saved`, message: "They apply to charges raised from now on, starting with the next voucher run." });
      onClose();
    },
  });
  const conflict = save.error instanceof ApiError && save.error.status === 409;
  const setLine = (code: string, patch: Partial<LineDraft>) => setValues((prev) => ({ ...prev, [code]: { ...(prev[code] ?? { amount: 0, active: true, installments: 1 }), ...patch } }));

  return (
    <SidePanel
      open
      wide
      onClose={onClose}
      title={`${cls.className} fees`}
      description={`${structure.campusName} · Session ${formatSession(structure.session)}`}
      footer={
        editable ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              loading={save.isPending}
              loadingLabel="Saving…"
              onClick={() => {
                setTried(true);
                if (parsed.success) save.mutate();
              }}
            >
              Save {cls.className}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Close</Button>
        )
      }
    >
      <div className="grid gap-5">
        {editable ? (
          <Banner tone="info">New amounts apply to charges raised from now on. Charges already on students' ledgers, and receipts, never change.</Banner>
        ) : (
          <Banner tone="neutral">{readOnly ? "Past sessions are read-only." : "Only the accountant or an admin can change fee amounts."}</Banner>
        )}
        <div className="grid gap-4">
          {shown.map((h) => {
            const v = values[h.code] ?? { amount: 0, active: true, installments: 1 };
            const extra = !initialCodes.includes(h.code) || (!columnHeads(structure).some((c) => c.code === h.code) && h.code !== "TUITION");
            return (
              <div key={h.code} className="grid gap-2 rounded-md border border-border p-3">
                <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <AmountInput
                    label={`${h.title}${h.billing === "MONTHLY" ? " (a month)" : h.billing === "TERMLY" ? " (each term)" : h.billing === "QUARTERLY" ? " (each quarter)" : ""}`}
                    required={h.code === "TUITION"}
                    value={v.amount}
                    onValueChange={(a) => setLine(h.code, { amount: a })}
                    disabled={!editable}
                    help={h.code === "CANDIDATE" ? "Paid with the admission application. 0 means no entrance test for this class." : h.classes?.length ? `Only ${h.classes.map(className).join(", ")}.` : undefined}
                    error={tried ? errors[`lines.${h.code}`] : undefined}
                  />
                  {h.code !== "TUITION" && (
                    <Switch label={v.active ? "Billed" : "Not billed"} checked={v.active} disabled={!editable} onChange={(e) => setLine(h.code, { active: e.target.checked })} />
                  )}
                </div>
                {(h.billing === "ANNUAL" || extra) && (
                  <div className="flex flex-wrap items-end gap-3">
                    {h.billing === "ANNUAL" && h.code !== "BOARD" && (
                      <div className="w-56">
                        <Select
                          label="Paid"
                          value={String(v.installments)}
                          disabled={!editable}
                          onChange={(e) => setLine(h.code, { installments: Number(e.target.value) })}
                          options={PARTS}
                          help={v.installments > 1 && v.amount ? `${formatRs(Math.floor(v.amount / v.installments))} a part; the last takes any remainder.` : undefined}
                        />
                      </div>
                    )}
                    {extra && editable && amount(cls, h.code) === 0 && (
                      <Button size="sm" variant="quiet" icon="x" onClick={() => setCodes((cs) => cs.filter((c) => c !== h.code))}>
                        Remove from {cls.className}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {editable && addable.length > 0 && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1">
              <Select
                label="Add a head to this class"
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
                options={[{ value: "", label: "Choose a head" }, ...addable.map((h) => ({ value: h.code, label: `${h.title} · ${h.billing === "MONTHLY" ? "monthly" : h.billing === "QUARTERLY" ? "each quarter" : h.billing === "ANNUAL" ? "yearly" : h.billing === "TERMLY" ? "each term" : "one-off"}` }))]}
              />
            </div>
            <Button
              icon="plus"
              disabled={!adding}
              onClick={() => {
                setCodes((cs) => [...cs, adding]);
                setLine(adding, { amount: values[adding]?.amount ?? 0, active: true });
                setAdding("");
              }}
            >
              Add head
            </Button>
          </div>
        )}

        <div className="grid gap-3">
          <div className="grid gap-0.5">
            <span className="font-medium">Different amount for a section</span>
            <span className="text-small text-ink-muted">For example a science section with a lab fee. The section's students are billed this amount instead of the class amount.</span>
          </div>
          {overrides.length === 0 && <p className="m-0 text-small text-ink-subtle">Every section pays the class amounts.</p>}
          {overrides.map((o, i) => (
            <div key={i} className="grid items-end gap-3 sm:grid-cols-[120px_minmax(0,1fr)_160px_auto]">
              <Select
                label="Section"
                value={o.section}
                disabled={!editable}
                onChange={(e) => setOverrides((list) => list.map((x, k) => (k === i ? { ...x, section: e.target.value } : x)))}
                options={[{ value: "", label: "Choose" }, ...cls.sections.map((s) => ({ value: s, label: `${cls.classShort}-${s}` }))]}
                error={tried ? errors[`overrides.${i}.section`] : undefined}
              />
              <Select
                label="Fee head"
                value={o.head}
                disabled={!editable}
                onChange={(e) => setOverrides((list) => list.map((x, k) => (k === i ? { ...x, head: e.target.value } : x)))}
                options={[{ value: "", label: "Choose" }, ...shown.map((h) => ({ value: h.code, label: h.title }))]}
                error={tried ? errors[`overrides.${i}.head`] : undefined}
              />
              <AmountInput
                label="Amount"
                value={o.amount}
                disabled={!editable}
                onValueChange={(a) => setOverrides((list) => list.map((x, k) => (k === i ? { ...x, amount: a } : x)))}
                error={tried ? errors[`overrides.${i}.amount`] : undefined}
              />
              {editable && <IconButton icon="trash" label={`Remove the section ${o.section || ""} amount`} onClick={() => setOverrides((list) => list.filter((_, k) => k !== i))} />}
            </div>
          ))}
          {editable && cls.sections.length > 1 && (
            <div>
              <Button size="sm" icon="plus" onClick={() => setOverrides((list) => [...list, { section: "", head: "", amount: null }])}>
                Add a section amount
              </Button>
            </div>
          )}
        </div>

        <KeyValue
          items={[
            ["A student pays in the session", <span className="font-semibold tabular-nums">{formatRs(year)}</span>],
            ["Worked out as", sessionTotalText(structure)],
            ["Last changed", `${formatDateTime(cls.updatedAt)} by ${cls.updatedBy}`],
          ]}
        />
        {save.error && (
          <Banner tone="danger" title={conflict ? "Someone else saved changes first." : "Not saved."}>
            {errorText(save.error)}
          </Banner>
        )}
      </div>
    </SidePanel>
  );
}

/* ---------------------------------------------------------------- Copy from last session */

function CopyPanel({ campus, fromSession, toSession, replacing, onClose }: { campus: CampusCode; fromSession: number; toSession: number; replacing: boolean; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [pct, setPct] = useState("6");
  // The source session's tuition head says whether the amounts are per month or per quarter.
  const tuitionHead = useQuery(feeSetupQueries.structure(campus, fromSession)).data?.heads.find((h) => h.code === "TUITION");
  const [roundTo, setRoundTo] = useState<"50" | "100" | "500">("500");
  const [preview, setPreview] = useState<FeeCopyPreview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const pctNum = Number(pct);
  const pctError = pct.trim() === "" || !Number.isInteger(pctNum) || pctNum < 0 || pctNum > 25 ? "Enter a whole number from 0 to 25." : undefined;
  const req = { campus, fromSession, toSession, increasePct: pctNum, roundTo: Number(roundTo) as 50 | 100 | 500 };
  const key = useMemo(() => newIdempotencyKey(), [JSON.stringify(req)]); // eslint-disable-line react-hooks/exhaustive-deps
  const previewM = useMutation({ mutationFn: () => feeSetupApi.copyPreview(req), onSuccess: setPreview });
  const copy = useMutation({
    mutationFn: () => feeSetupApi.copy(req, key),
    onSuccess: (s) => {
      queryClient.setQueryData(feeSetupQueries.structure(campus, toSession).queryKey, s);
      void queryClient.invalidateQueries({ queryKey: ["fees", "setup"] });
      toast({ title: `Fee structure for ${formatSession(toSession)} set`, message: `Copied from ${formatSession(fromSession)} with a ${pctNum}% increase.` });
      setConfirming(false);
      onClose();
    },
  });
  return (
    <SidePanel
      open
      wide
      onClose={onClose}
      title={`Copy from ${formatSession(fromSession)}`}
      description={`${campusLabel(campus)} · into session ${formatSession(toSession)}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {preview ? (
            <Button variant="primary" icon="copy" onClick={() => setConfirming(true)}>
              Copy to {formatSession(toSession)}
            </Button>
          ) : (
            <Button variant="primary" icon="eye" disabled={Boolean(pctError)} loading={previewM.isPending} loadingLabel="Working out…" onClick={() => previewM.mutate()}>
              Show new amounts
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-5">
        {replacing && <Banner tone="warning">This campus already has a structure for {formatSession(toSession)}. Copying replaces every class's amounts; charges already raised do not change.</Banner>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Increase"
            suffix="%"
            inputMode="numeric"
            value={pct}
            onChange={(e) => {
              setPct(e.target.value.replace(/[^\d]/g, ""));
              setPreview(null);
            }}
            error={pctError}
            help="0 copies the amounts as they are."
          />
          <Select
            label="Round new amounts to"
            value={roundTo}
            onChange={(e) => {
              setRoundTo(e.target.value as "50" | "100" | "500");
              setPreview(null);
            }}
            options={[
              { value: "50", label: "Nearest Rs 50" },
              { value: "100", label: "Nearest Rs 100" },
              { value: "500", label: "Nearest Rs 500" },
            ]}
          />
        </div>
        {previewM.error && <Banner tone="danger">{errorText(previewM.error)}</Banner>}
        {preview && (
          <DataTable
            caption="Session total per student, before and after"
            rows={preview.classes.map((c) => ({ ...c, tuitionFrom: preview.rows.find((r) => r.classShort === c.classShort && r.head === "TUITION")?.from ?? 0, tuitionTo: preview.rows.find((r) => r.classShort === c.classShort && r.head === "TUITION")?.to ?? 0 }))}
            rowKey="classShort"
            density="dense"
            columns={[
              { key: "className", header: "Class", render: (c) => c.className },
              { key: "t", header: tuitionHead ? perLabel(tuitionHead) : "Tuition", align: "right", render: (c) => `${formatRs(c.tuitionFrom)} → ${formatRs(c.tuitionTo)}` },
              { key: "y", header: "Session total", align: "right", render: (c) => `${formatRs(c.from)} → ${formatRs(c.to)}` },
              { key: "d", header: "Change", align: "right", render: (c) => <span className="text-ink-muted">{formatRs(c.to - c.from, { sign: "always" })}</span> },
            ]}
          />
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => copy.mutate()}
        title={`Set ${formatSession(toSession)} fees for ${campusLabel(campus)}?`}
        message={`Every class gets ${formatSession(fromSession)}'s amounts plus ${pctNum}%, rounded to Rs ${roundTo}.`}
        confirmLabel={replacing ? "Replace structure" : "Copy structure"}
        tone={replacing ? "danger" : "brand"}
        {...(replacing ? { requireText: "REPLACE" } : {})}
        loading={copy.isPending}
        loadingLabel="Copying…"
        warning="Charges already on students' ledgers keep their amounts. The change is recorded under Changes."
        {...(copy.error ? { error: errorText(copy.error) } : {})}
      />
    </SidePanel>
  );
}

/* ---------------------------------------------------------------- Due dates */

function DueDateModal({ structure, plan, inst, onClose }: { structure: FeeStructure; plan: FeeInstallmentPlan; inst: FeeInstallment; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [date, setDate] = useState<string | null>(inst.dueDate);
  const [scope, setScope] = useState<"CAMPUS" | "CLASS" | "SECTION">("CAMPUS");
  const [cls, setCls] = useState("");
  const [section, setSection] = useState("");
  const [head, setHead] = useState("");
  const [tried, setTried] = useState(false);
  const sections = structure.classes.find((c) => c.classShort === cls)?.sections ?? [];
  const headTitle = (code: string) => structure.heads.find((h) => h.code === code)?.title ?? code;
  const schema = z
    .object({
      date: z
        .string({ error: "Enter the new due date." })
        .min(1, "Enter the new due date.")
        .refine((d) => d >= feeToday(), "The new due date can't be in the past.")
        .refine((d) => scope !== "CAMPUS" || head !== "" || d !== inst.dueDate, "Choose a different date."),
      cls: z.string(),
      section: z.string(),
    })
    .refine((v) => scope === "CAMPUS" || v.cls !== "", { path: ["cls"], message: "Choose the class." })
    .refine((v) => scope !== "SECTION" || v.section !== "", { path: ["section"], message: "Choose the section." });
  const parsed = schema.safeParse({ date: date ?? "", cls, section });
  const errors: Record<string, string> = {};
  if (!parsed.success) for (const i of parsed.error.issues) errors[String(i.path[0])] ??= i.message;
  const input = { plan: plan.code, no: inst.no, dueDate: date ?? "", ...(scope !== "CAMPUS" && cls ? { classShort: cls } : {}), ...(scope === "SECTION" && section ? { section } : {}), ...(head ? { head } : {}) };
  const key = useMemo(() => newIdempotencyKey(), [JSON.stringify(input)]); // eslint-disable-line react-hooks/exhaustive-deps
  const who = scope === "CAMPUS" ? structure.campusName : scope === "CLASS" ? (structure.classes.find((c) => c.classShort === cls)?.className ?? className(cls || "?")) : `${cls}-${section}`;
  const save = useMutation({
    mutationFn: () => feeSetupApi.setDueDate(structure.campus, structure.session, input, key),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ["fees"] });
      toast({
        title: `${inst.label}${head ? ` · ${headTitle(head)}` : ""}: due ${formatDate(date!)}${scope === "CAMPUS" ? "" : ` for ${who}`}`,
        message: `${formatCount(r.chargesMoved)} unpaid charges and ${formatCount(r.vouchersMoved)} vouchers moved to the new date.`,
      });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Move the ${inst.label} due date`}
      description={`${plan.title} · ${structure.campusName}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            loadingLabel="Moving…"
            onClick={() => {
              setTried(true);
              if (parsed.success) save.mutate();
            }}
          >
            Move due date
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <p className="m-0 text-ink-muted">
          Now due {formatDate(inst.dueDate)}. Unpaid charges for {inst.label}, and vouchers not yet paid, move to the new date. The late fine starts the day after it. Paid charges don't change.
        </p>
        <Segmented
          aria-label="Move it for"
          value={scope}
          onChange={(v) => setScope(v as typeof scope)}
          options={[
            { value: "CAMPUS", label: "Whole campus" },
            { value: "CLASS", label: "One class" },
            { value: "SECTION", label: "One section" },
          ]}
        />
        {scope !== "CAMPUS" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Class"
              required
              value={cls}
              onChange={(e) => {
                setCls(e.target.value);
                setSection("");
              }}
              options={[{ value: "", label: "Choose the class" }, ...structure.classes.map((c) => ({ value: c.classShort, label: c.className }))]}
              error={tried ? errors.cls : undefined}
            />
            {scope === "SECTION" && (
              <Select
                label="Section"
                required
                value={section}
                disabled={!cls}
                onChange={(e) => setSection(e.target.value)}
                options={[{ value: "", label: cls ? "Choose the section" : "Choose the class first" }, ...sections.map((s) => ({ value: s, label: `${cls}-${s}` }))]}
                error={tried ? errors.section : undefined}
              />
            )}
          </div>
        )}
        {plan.heads.length > 1 && (
          <Select
            label="Fee head"
            value={head}
            onChange={(e) => setHead(e.target.value)}
            options={[{ value: "", label: "Every head on this plan" }, ...plan.heads.map((h) => ({ value: h, label: headTitle(h) }))]}
            help="Choose one head to move only its charges."
          />
        )}
        <DatePicker label="New due date" required value={date} onValueChange={setDate} today={feeToday()} minDate={feeToday()} error={tried ? errors.date : undefined} />
        {scope !== "CAMPUS" || head ? (
          <p className="m-0 text-small text-ink-muted">Only {who}{head ? `'s ${headTitle(head).toLowerCase()}` : ""} moves. The plan's date for everyone else stays {formatDate(inst.dueDate)}.</p>
        ) : null}
        {save.error && <Banner tone="danger">{errorText(save.error)}</Banner>}
      </div>
    </Modal>
  );
}

function PlansPanel({ structure, editable }: { structure: FeeStructure; editable: boolean }) {
  const [editing, setEditing] = useState<{ plan: FeeInstallmentPlan; inst: FeeInstallment } | null>(null);
  const heads = new Map(structure.heads.map((h) => [h.code, h.title]));
  return (
    <Panel id="plans" title="Due dates" description="When each installment falls due this session. Moving a date moves every unpaid charge and voucher for it; past dates stay as they were." rise={3}>
      <div className="grid gap-5">
        {structure.plans
          .filter((p) => p.heads.length > 0)
          .map((p) => (
            <div key={p.code} className="grid gap-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{p.title}</span>
                <span className="text-small text-ink-muted">
                  {p.count} {p.count === 1 ? "installment" : "installments"} · {p.heads.map((h) => heads.get(h) ?? h).join(", ")}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {p.installments.map((i, k) => {
                  const past = i.dueDate < feeToday();
                  const chip = (
                    <span className="grid gap-0.5 text-left">
                      <span className="text-small font-medium">{i.label}</span>
                      <span className="text-small text-ink-muted tabular-nums">{formatDate(i.dueDate)}</span>
                    </span>
                  );
                  return editable && !past ? (
                    <button
                      key={i.no}
                      type="button"
                      onClick={() => setEditing({ plan: p, inst: i })}
                      className="mtb-slide-in flex items-center gap-2 rounded-md border border-border bg-surface-raised px-3 py-1.5 hover:border-brand"
                      style={slide(k)}
                      aria-label={`${i.label}, due ${formatDate(i.dueDate)}. Move this due date`}
                    >
                      {chip}
                      <Icon name="edit" size={14} className="text-ink-subtle" />
                    </button>
                  ) : (
                    <span key={i.no} className={`mtb-slide-in flex items-center gap-2 rounded-md border border-border px-3 py-1.5 ${past ? "bg-surface-sunken" : "bg-surface-raised"}`} style={slide(k)}>
                      {chip}
                      {past && <Icon name="lock" size={14} className="text-ink-subtle" aria-label="Already due" />}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        <p className="m-0 text-small text-ink-muted">Installment amounts are always whole rupees; when a total is split, the last installment takes any remainder so the parts add up exactly.</p>
      </div>
      {editing && <DueDateModal structure={structure} plan={editing.plan} inst={editing.inst} onClose={() => setEditing(null)} />}
    </Panel>
  );
}

/* ---------------------------------------------------------------- One campus */

function CampusStructure({ campus }: { campus: CampusCode }) {
  const { session } = useCtx();
  const readOnly = useReadOnly();
  const canEdit = useCan("fees.setup");
  const editable = canEdit && !readOnly;
  const q = useQuery(feeSetupQueries.structure(campus, session));
  const [editing, setEditing] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const s = q.data;

  if (q.isLoading)
    return (
      <div className="grid gap-4" aria-busy="true">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={110} />
          ))}
        </div>
        <Skeleton height={420} />
      </div>
    );
  if (q.error || !s) return <LoadError what="The fee structure" error={q.error} onRetry={() => void q.refetch()} />;

  if (s.status === "NOT_SET")
    return (
      <div className="mtb-card">
        <EmptyState
          icon="layers"
          title={`No fee structure for ${formatSession(session)} at ${s.campusName} yet`}
          description={s.canCopyFrom ? `Start from ${formatSession(s.canCopyFrom)}'s amounts with an increase, then adjust any class. Vouchers can't be generated until this is set.` : "Enter each class's fees to start."}
          action={
            editable && s.canCopyFrom ? (
              <Button variant="primary" icon="copy" onClick={() => setCopying(true)}>
                Copy from {formatSession(s.canCopyFrom)}
              </Button>
            ) : !canEdit ? (
              <span className="text-small text-ink-muted">Ask the accountant to set it up.</span>
            ) : undefined
          }
        />
        {copying && s.canCopyFrom && <CopyPanel campus={campus} fromSession={s.canCopyFrom} toSession={session} replacing={false} onClose={() => setCopying(false)} />}
      </div>
    );

  // Only classes with an amount: a class the office has not priced yet shows 0 and would pull the range down.
  const monthly = s.classes.map((c) => c.monthly).filter((v) => v > 0);
  const years = s.classes.map((c) => c.yearTotal).filter((v) => v > 0);
  const range = (xs: number[]) => (xs.length ? `${formatRs(Math.min(...xs))} – ${formatRs(Math.max(...xs))}` : "—");
  const priced = s.classes.filter((c) => c.monthly > 0);
  const tuitionUnit = unitOf(s.heads.find((h) => h.code === "TUITION"));
  const tuitionFoot = [
    priced.length ? `${priced[0]!.className} to ${priced.at(-1)!.className}` : "No class priced yet",
    tuitionUnit && tuitionUnit !== "month" ? `billed every ${tuitionUnit}` : "",
    priced.length && priced.length < s.classes.length ? `${s.classes.length - priced.length} classes not priced` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const last = s.history[0];
  const editingClass = s.classes.find((c) => c.classShort === editing);

  const columns: Array<Column<FeeClassStructure>> = [
    { key: "className", header: "Class", render: (c) => <span className="font-medium">{c.className}</span> },
    ...columnHeads(s).map(
      (h): Column<FeeClassStructure> => ({
        key: h.code,
        header: perLabel(h),
        align: "right",
        render: (c) => {
          const v = amount(c, h.code);
          const off = line(c, h.code)?.active === false;
          const parts = line(c, h.code)?.installments ?? 1;
          const own = c.sectionOverrides.filter((o) => o.head === h.code);
          if (!v && own.length === 0) return <span className="text-ink-subtle">—</span>;
          return (
            <span className="inline-grid justify-items-end">
              <span className={`mtb-num ${off ? "text-ink-subtle line-through" : ""}`}>{formatRs(v)}</span>
              {(off || parts > 1 || own.length > 0) && (
                <Tooltip content={[off ? "Not billed this session" : "", parts > 1 ? `Paid in ${parts} parts` : "", ...own.map((o) => `${c.classShort}-${o.section}: ${formatRs(o.amount)}`)].filter(Boolean).join(" · ")}>
                  <span className="text-small text-ink-muted" tabIndex={0}>
                    {off ? "off" : [parts > 1 ? `${parts} parts` : "", own.length ? `+${own.length} section` : ""].filter(Boolean).join(" · ")}
                  </span>
                </Tooltip>
              )}
            </span>
          );
        },
      }),
    ),
    { key: "yearTotal", header: "Session total", align: "right", render: (c) => <span className="mtb-num font-semibold">{formatRs(c.yearTotal)}</span> },
  ];

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Tuition a month" icon="fees" value={range(monthly)} foot={tuitionFoot} />
        <StatCard label="A student pays in the session" icon="layers" value={range(years)} foot={s.transport ? "Before concessions; transport extra" : "Before concessions"} />
        <StatCard label="Fee heads in use" icon="listChecks" value={<AnimatedNumber value={s.heads.filter((h) => h.active).length} format={formatCount} />} foot="Fees, fines and the test fee" />
        <StatCard label="Last changed" icon="clock" value={last ? formatDate(last.at) : "—"} foot={last ? `by ${last.by}` : "No changes yet"} />
      </div>

      <Panel
        id="by-class"
        title="Fees by class"
        description={editable ? "Choose a class to change its fees. New amounts apply to charges raised from now on." : "Amounts for each class this session."}
        flush
        rise={1}
        actions={
          editable && s.canCopyFrom ? (
            <Button size="sm" icon="copy" onClick={() => setCopying(true)}>
              Copy from {formatSession(s.canCopyFrom)}
            </Button>
          ) : undefined
        }
      >
        <DataTable caption={`Fees by class, ${s.campusName}, ${formatSession(session)}`} columns={columns} rows={s.classes} rowKey="classShort" onRowClick={(c) => setEditing(c.classShort)} />
      </Panel>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <HeadsPanel structure={s} editable={editable} />
        <div className="grid gap-6">
          <PlansPanel structure={s} editable={editable} />
          <Panel id="changes" title="Changes" description="Every change to this campus's fees, with who made it." rise={4}>
            {s.history.length === 0 ? (
              <p className="m-0 text-small text-ink-muted">No changes yet.</p>
            ) : (
              <Timeline
                label="Fee structure changes"
                items={s.history.slice(0, 8).map((h) => ({ id: h.id, date: h.at.slice(0, 10), title: h.text, description: `${h.by}${h.detail ? ` · ${h.detail}` : ""}`, icon: "edit" as const, tone: "neutral" as const }))}
              />
            )}
          </Panel>
        </div>
      </div>

      {editingClass && <EditClassPanel structure={s} cls={editingClass} onClose={() => setEditing(null)} />}
      {copying && s.canCopyFrom && <CopyPanel campus={campus} fromSession={s.canCopyFrom} toSession={session} replacing onClose={() => setCopying(false)} />}
    </>
  );
}

/* ---------------------------------------------------------------- All campuses */

function Comparison() {
  const { session } = useCtx();
  const q = useQuery(feeSetupQueries.comparison(session));
  const [view, setView] = useState("monthly");
  if (q.isLoading) return <Skeleton height={360} />;
  if (q.error || !q.data) return <LoadError what="The campus comparison" error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  type Row = (typeof d.rows)[number];
  const columns: Array<Column<Row>> = [
    { key: "className", header: "Class", render: (r) => <span className="font-medium">{r.className}</span> },
    ...d.campuses.map(
      (c): Column<Row> => ({
        key: c.campus,
        header: c.name.replace(" Campus", ""),
        align: "right",
        render: (r) => {
          const v = view === "monthly" ? r.monthly[c.campus] : r.yearTotal[c.campus];
          return v === undefined ? <span className="text-ink-subtle">Not set</span> : <span className="mtb-num">{formatRs(v)}</span>;
        },
      }),
    ),
  ];
  return (
    <Panel
      id="comparison"
      title="Fees across campuses"
      description={`Session ${formatSession(session)}. Choose a campus at the top to see or change its structure.`}
      flush
      rise={0}
      actions={<Segmented aria-label="Show" value={view} onChange={setView} options={[{ value: "monthly", label: "Tuition a month" }, { value: "year", label: "Session total" }]} />}
    >
      {d.campuses.some((c) => c.status === "NOT_SET") && (
        <div className="px-5 pb-3">
          <Banner tone="warning">
            {d.campuses
              .filter((c) => c.status === "NOT_SET")
              .map((c) => c.name)
              .join(", ")}{" "}
            {d.campuses.filter((c) => c.status === "NOT_SET").length === 1 ? "has" : "have"} no structure for {formatSession(session)} yet, so vouchers can't be generated there.
          </Banner>
        </div>
      )}
      <DataTable caption="Fees by class and campus" columns={columns} rows={d.rows} rowKey="classShort" />
    </Panel>
  );
}

export function StructurePage() {
  const { campus } = useCtx();
  return (
    <RequirePermission permission="fees.view" page="the fee structure">
      <Page>
        <PageHeader title="Fee structure" />
        <FeesNav />
        {campus === "ALL" ? (
          <>
            <Comparison />
            <RequireSingleCampus action="the fee structure editor">
              <span />
            </RequireSingleCampus>
          </>
        ) : (
          <CampusStructure campus={campus} />
        )}
      </Page>
    </RequirePermission>
  );
}
