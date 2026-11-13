import { feesApi, feeSetupQueries, newIdempotencyKey, splitRupees, type CampusCode } from "@mtb/api";
import { formatDate, formatRs, formatSession } from "@mtb/domain";
import { AmountInput, Banner, Button, DatePicker, KeyValue, Modal, Select, SidePanel, Skeleton, Textarea, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { z } from "zod";
import { useCtx } from "../../../app/session";
import { addDaysIso, errorField, errorText, feeToday } from "../shared";

/** "2026-11-10" + n months, keeping the day (capped at the month's end), as the server does. */
function addMonthsIso(d: string, n: number): string {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return first.toISOString().slice(0, 10);
}

export interface ChargeStudent {
  grNo: string;
  name: string;
  classSection: string;
  campus: CampusCode;
}

/**
 * Put a one-off charge of any fee head on one student's ledger (legacy Student Fee Type): re-admission,
 * subject change, university exam fee … Optionally split into monthly parts; the last part takes the remainder.
 */
export function AddChargePanel({ student, onClose, initialHead }: { student: ChargeStudent; onClose: () => void; initialHead?: string }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const structure = useQuery(feeSetupQueries.structure(student.campus, ctx.session));
  const cls = student.classSection.split("-")[0] ?? "";
  const heads = (structure.data?.heads ?? []).filter((h) => h.category === "FEE" && h.active && !h.linked && (!h.classes?.length || h.classes.includes(cls)));
  const classAmount = (code: string) => structure.data?.classes.find((c) => c.classShort === cls)?.lines.find((l) => l.head === code)?.amount ?? 0;
  const [head, setHead] = useState(initialHead ?? "");
  const [amount, setAmount] = useState<number | null>(null);
  const [due, setDue] = useState<string | null>(addDaysIso(feeToday(), 7));
  const [note, setNote] = useState("");
  const [parts, setParts] = useState("1");
  const [tried, setTried] = useState(false);
  // The session's last day from Setup (through the structure loaded above); April–March until it loads.
  const sessionEnd = structure.data?.sessionEnd ?? `${ctx.session + 1}-03-31`;
  const n = Number(parts);

  const schema = z
    .object({
      head: z.string().min(1, "Choose the fee head."),
      amount: z.number({ error: "Enter the amount." }).int("Whole rupees only.").min(1, "Enter the amount.").max(500000, "That is more than Rs 500,000. Check the figure."),
      due: z.string({ error: "Enter the due date." }).min(1, "Enter the due date.").refine((d) => d >= feeToday(), "The due date can't be in the past."),
      note: z.string().trim().min(5, "Say why it is charged, in a few words; it shows on the ledger.").max(120, "Keep the reason to 120 characters."),
      parts: z.number().int().min(1).max(12),
    })
    .refine((v) => v.parts <= v.amount, { path: ["parts"], message: "Each part must be at least Rs 1." })
    .refine((v) => !v.due || addMonthsIso(v.due, v.parts - 1) <= sessionEnd, { path: ["parts"], message: `The last part would fall after the session ends (${formatDate(sessionEnd)}).` });
  const values = { head, amount: amount ?? undefined, due: due ?? "", note, parts: n };
  const parsed = schema.safeParse(values);
  const errors: Record<string, string> = {};
  if (!parsed.success) for (const i of parsed.error.issues) errors[String(i.path[0])] ??= i.message;
  const key = useMemo(() => newIdempotencyKey(), [JSON.stringify(values)]); // eslint-disable-line react-hooks/exhaustive-deps
  const split = amount && amount >= n ? splitRupees(amount, n) : [];
  const title = heads.find((h) => h.code === head)?.title ?? "";

  const save = useMutation({
    mutationFn: () => feesApi.addCharge(student.grNo, { head, amount: amount!, dueDate: due!, note: note.trim(), ...(n > 1 ? { installments: n } : {}) }, key),
    onSuccess: (r) => {
      toast({ title: `${title} added`, message: `${student.name} · ${formatRs(amount ?? 0)}${r.charges.length > 1 ? ` in ${r.charges.length} parts` : ""}, first due ${formatDate(due!)}. It shows at the counter now.` });
      void queryClient.invalidateQueries({ queryKey: ["fees"] });
      void queryClient.invalidateQueries({ queryKey: ["students"] });
      onClose();
    },
  });
  const serverField = errorField(save.error);
  const err = (f: string) => (tried ? (errors[f] ?? (serverField === f ? errorText(save.error) : undefined)) : undefined);

  return (
    <SidePanel
      open
      onClose={onClose}
      title="Add a charge"
      description={`${student.name} · ${student.grNo} · ${student.classSection} · Session ${formatSession(ctx.session)}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon="plus"
            loading={save.isPending}
            loadingLabel="Adding…"
            onClick={() => {
              setTried(true);
              if (parsed.success) save.mutate();
            }}
          >
            Add to the ledger
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <p className="m-0 text-ink-muted">For a charge only this student pays: re-admission, subject change, a university exam fee. Monthly fees come from the class structure and vouchers.</p>
        {structure.isLoading ? (
          <Skeleton height={44} />
        ) : (
          <Select
            label="Fee head"
            required
            value={head}
            onChange={(e) => {
              setHead(e.target.value);
              const a = classAmount(e.target.value);
              if (a > 0) setAmount(a);
            }}
            options={[{ value: "", label: "Choose the head" }, ...heads.map((h) => ({ value: h.code, label: h.title }))]}
            error={err("head")}
          />
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <AmountInput label="Amount" required value={amount} onValueChange={setAmount} error={err("amount")} />
          <DatePicker label={n > 1 ? "First part due" : "Due date"} required value={due} onValueChange={setDue} today={feeToday()} minDate={feeToday()} maxDate={sessionEnd} error={err("due") ?? err("dueDate")} />
        </div>
        <Select
          label="Pay in"
          value={parts}
          onChange={(e) => setParts(e.target.value)}
          options={[1, 2, 3, 4, 6, 12].map((k) => ({ value: String(k), label: k === 1 ? "One payment" : `${k} monthly parts` }))}
          error={err("parts") ?? err("installments")}
          help="Each part is due a month after the one before."
        />
        {n > 1 && split.length > 0 && due && (
          <div className="rounded-md border border-border bg-surface-sunken p-3">
            <KeyValue items={split.map((p, i): [string, string] => [`Part ${i + 1} · due ${formatDate(addMonthsIso(due, i))}`, formatRs(p)])} />
            <p className="m-0 mt-2 text-small text-ink-muted">Whole rupees; the last part takes any remainder so the parts add up to {formatRs(amount ?? 0)}.</p>
          </div>
        )}
        <Textarea label="Reason" required rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: re-admitted after the dues were cleared." error={err("note")} />
        {save.error && !serverField && <Banner tone="danger">{errorText(save.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

/** Ask to cancel an unpaid charge. Like a receipt cancellation, the principal approves it on the dashboard. */
export function CancelChargeModal({ charge, onClose }: { charge: { chargeId: string; head: string; amount: number; dueDate: string; studentName: string }; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const err = reason.trim().length < 5 ? "Say why the charge should be cancelled; the principal reads this." : undefined;
  const key = useMemo(() => newIdempotencyKey(), [charge.chargeId]);
  const send = useMutation({
    mutationFn: () => feesApi.cancelCharge(charge.chargeId, { reason: reason.trim() }, key),
    onSuccess: () => {
      toast({ title: "Sent to the principal", message: `${charge.head} stays on the ledger until the cancellation is approved.` });
      void queryClient.invalidateQueries({ queryKey: ["fees"] });
      void queryClient.invalidateQueries({ queryKey: ["approvals"] });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Cancel ${charge.head}?`}
      description={`${charge.studentName} · ${formatRs(charge.amount)} · due ${formatDate(charge.dueDate)}`}
      footer={
        <>
          <Button onClick={onClose}>Keep the charge</Button>
          <Button
            variant="danger"
            icon="send"
            loading={send.isPending}
            loadingLabel="Sending…"
            onClick={() => {
              setTried(true);
              if (!err) send.mutate();
            }}
          >
            Ask the principal
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <p className="m-0 text-ink-muted">Only an unpaid charge can be cancelled. The principal approves it, like a receipt cancellation; it then stays on the ledger as cancelled.</p>
        <Textarea label="Reason" required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} error={tried ? (err ?? (errorField(send.error) === "reason" ? errorText(send.error) : undefined)) : undefined} placeholder="For example: charged to the wrong student." />
        {send.error && errorField(send.error) !== "reason" && <Banner tone="danger">{errorText(send.error)}</Banner>}
      </div>
    </Modal>
  );
}
