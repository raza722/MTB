import { type Charge, type CounterData, type CounterFine } from "@mtb/api";
import { calculateLateFine, formatRs, sumRs, type LateFine } from "@mtb/domain";
import { useMemo, useState } from "react";
import { z } from "zod";
import { EMPTY_PAYMENT, validatePayment, type PaymentDraft } from "../schemas";
import { useIdempotencyKey } from "../../../app/idempotency";

/** Who paid and the cashier's remarks: optional, printed on the receipt. */
const extrasSchema = z.object({
  paidBy: z.string().trim().max(60, "Keep the name to 60 characters."),
  note: z.string().trim().max(160, "Keep the remarks to one line (160 characters)."),
});

export interface PreviewLine {
  charge: Charge;
  fine: LateFine;
  outstanding: number;
  lineTotal: number;
}

/** "6 days × Rs 10", "6 days × Rs 10, Rs 60 already charged", "No late fine on this fee". */
function serverFineText(f: CounterFine): string {
  if (!f.fined) return f.daysOverdue > 0 ? "No late fine on this fee" : "No late fine";
  if (f.chargeableDays <= 0) return f.daysOverdue > 0 ? "No late fine yet" : "No late fine";
  const base = `${f.chargeableDays} ${f.chargeableDays === 1 ? "day" : "days"} × ${formatRs(f.ratePerDay)}`;
  return f.raised > 0 ? `${base}, ${formatRs(f.raised)} already charged` : base;
}

/** A charge's late fine today: the server's figure when it sent one (it leaves out heads the rule does not fine, the
 *  cut-over for charges from the old system and fines already raised), else the browser's preview by the rule. */
export function chargeLateFine(data: Pick<CounterData, "today" | "policy" | "fines">, charge: Charge): LateFine {
  const local = calculateLateFine(charge.dueDate, data.today, data.policy);
  // The server's figure when it sent one (test run F-036): the local sum fined every head from the due date.
  const f = data.fines?.find((x) => x.id === charge.id);
  return f ? { ...local, chargeableDays: f.chargeableDays, fine: f.fine, capped: false, explanation: serverFineText(f) } : local;
}

/** Part-payment preview: oldest line first; each line's late fine is paid before its fee (same rule as the server). */
export function allocate(lines: PreviewLine[], amount: number) {
  let left = amount;
  return lines.map((l) => {
    const applied = Math.min(left, l.lineTotal);
    left -= applied;
    return { line: l, applied, status: applied === 0 ? ("none" as const) : applied < l.lineTotal ? ("part" as const) : ("full" as const) };
  });
}

/**
 * Everything the fee counter tracks for one student. The browser computes late fines only for the live
 * preview, with the same rule as the server (@mtb/domain); the server decides the real figures on posting.
 */
export function useFeeCounter(data: CounterData | undefined) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [payment, setPayment] = useState<PaymentDraft>(EMPTY_PAYMENT);
  const [oldestFirst, setOldestFirst] = useState(true);
  const [partial, setPartial] = useState(false);
  const [partialAmount, setPartialAmount] = useState<number | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [paidBy, setPaidBy] = useState("");
  const [note, setNote] = useState("");

  const lines: PreviewLine[] = useMemo(() => {
    return (data?.charges ?? []).map((charge) => {
      const fine = chargeLateFine(data!, charge);
      const outstanding = charge.amount - charge.settledAmount;
      return { charge, fine, outstanding, lineTotal: outstanding + fine.fine };
    });
  }, [data]);

  const chosen = lines.filter((l) => selected.has(l.charge.id));
  const fees = sumRs(chosen.map((l) => l.outstanding));
  const fines = sumRs(chosen.map((l) => l.fine.fine));
  const total = fees + fines;
  const payNow = partial && partialAmount !== null ? partialAmount : total;
  const check = validatePayment(payment, payNow);
  const partialError = partial ? (partialAmount === null || partialAmount <= 0 ? "Enter the amount being paid." : partialAmount > total ? "That is more than the selected charges." : undefined) : undefined;
  const extras = extrasSchema.safeParse({ paidBy, note });
  const extraErrors: Record<string, string> = {};
  if (!extras.success) for (const i of extras.error.issues) extraErrors[String(i.path[0])] ??= i.message;
  const canReview = chosen.length > 0 && check.ok && !partialError && extras.success;

  // A new idempotency key for every new draft; the same key for retries of the same draft.
  const signature = JSON.stringify([data?.student.grNo, [...selected].sort(), payment, partial ? partialAmount : null, paidBy.trim(), note.trim()]);
  const idempotencyKey = useIdempotencyKey(signature);

  const toggle = (id: string) => {
    const idx = lines.findIndex((l) => l.charge.id === id);
    setSelected((prev) => {
      const next = new Set(prev);
      const turningOn = !next.has(id);
      if (!oldestFirst) {
        if (turningOn) next.add(id);
        else next.delete(id);
        return next;
      }
      // Oldest first: selecting a charge also selects every older one; clearing one clears every newer one.
      lines.forEach((l, i) => {
        if (turningOn && i <= idx) next.add(l.charge.id);
        if (!turningOn && i >= idx) next.delete(l.charge.id);
      });
      return next;
    });
  };

  const reset = () => {
    setSelected(new Set());
    setPayment(EMPTY_PAYMENT);
    setPartial(false);
    setPartialAmount(null);
    setShowErrors(false);
    setPaidBy("");
    setNote("");
  };

  return {
    lines,
    selected,
    setSelected,
    toggle,
    chosen,
    fees,
    fines,
    total,
    payNow,
    payment,
    setPayment,
    errors: showErrors ? { ...(!check.ok ? check.errors : {}), ...extraErrors } : {},
    partialError: showErrors ? partialError : undefined,
    checked: check,
    canReview,
    showErrors,
    setShowErrors,
    oldestFirst,
    setOldestFirst,
    partial,
    setPartial,
    partialAmount,
    setPartialAmount,
    idempotencyKey,
    reset,
    paidBy,
    setPaidBy,
    note,
    setNote,
    /** The guardian on record: the default payer. */
    guardianName: data?.student.father ?? "",
  };
}

export type FeeCounterState = ReturnType<typeof useFeeCounter>;
