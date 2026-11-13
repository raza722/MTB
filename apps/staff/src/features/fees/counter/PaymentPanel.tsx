import { COUNTER_PAYMENT_METHODS, PAYMENT_METHOD_LABEL } from "@mtb/api";
import { formatRs } from "@mtb/domain";
import { AmountInput, Button, DatePicker, Input, Radio, Select, StatusBadge, Switch } from "@mtb/ui";
import type { RefObject } from "react";
import { BANKS } from "../schemas";
import { allocate, type FeeCounterState } from "./useFeeCounter";


/** Sticky payment summary: totals, the payment method and only that method's fields (all required). */
export function PaymentPanel({ state, today, onReview, readOnly, firstFieldRef }: { state: FeeCounterState; today: string; onReview: () => void; readOnly: boolean; firstFieldRef: RefObject<HTMLInputElement | null> }) {
  const { payment: p, setPayment, errors } = state;
  const set = (patch: Partial<typeof p>) => setPayment({ ...p, ...patch });
  const change = p.method === "CASH" && p.received !== null ? p.received - state.payNow : null;
  const nothing = state.chosen.length === 0;

  return (
    <aside className="mtb-card sticky top-16 grid gap-4 p-5" aria-label="Payment">
      <div className="grid gap-2">
        <h2 className="m-0 text-title-3">Payment</h2>
        <dl className="m-0 grid grid-cols-[1fr_auto] gap-y-1 tabular-nums">
          <dt className="text-ink-muted">Fees ({state.chosen.length})</dt>
          <dd className="m-0 text-right">{formatRs(state.fees)}</dd>
          <dt className="text-ink-muted">Late fines</dt>
          <dd className="m-0 text-right">{formatRs(state.fines)}</dd>
          <dt className="border-t border-border pt-2 font-semibold">Total</dt>
          <dd className="m-0 border-t border-border pt-2 text-right text-numeric-large">{formatRs(state.total)}</dd>
        </dl>
      </div>

      <div className="grid gap-2 rounded-md border border-dashed border-border-strong p-3">
        <div className="flex items-center justify-between gap-2">
          <Switch label="Part payment" checked={state.partial} disabled={nothing || readOnly} onChange={(e) => state.setPartial(e.target.checked)} />
          <StatusBadge status="neutral" dot={false}>
            Not yet decided
          </StatusBadge>
        </div>
        {state.partial && (
          <>
            <AmountInput label="Amount being paid" value={state.partialAmount} onValueChange={state.setPartialAmount} error={state.partialError} />
            {state.partialAmount !== null && state.partialAmount > 0 && state.partialAmount <= state.total && (
              <ul className="m-0 grid list-none gap-1 p-0 text-small" aria-label="What this payment covers">
                {allocate(state.chosen, state.partialAmount).map(({ line, applied, status }) => (
                  <li key={line.charge.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{line.charge.head}</span>
                    <StatusBadge status={status === "full" ? "paid" : status === "part" ? "unpaid" : "neutral"} dot={status !== "none"}>
                      {status === "full" ? "Fully paid" : status === "part" ? `${formatRs(applied)} of ${formatRs(line.lineTotal)}` : "Not covered"}
                    </StatusBadge>
                  </li>
                ))}
                <li className="flex justify-between border-t border-border pt-1 font-medium tabular-nums">
                  <span>Remaining after this payment</span>
                  <span>{formatRs(state.total - state.partialAmount)}</span>
                </li>
              </ul>
            )}
          </>
        )}
      </div>

      <fieldset className="m-0 grid gap-2 border-0 p-0" disabled={readOnly}>
        <legend className="mtb-label mb-2">Payment method</legend>
        <div className="grid grid-cols-2 gap-2">
          {COUNTER_PAYMENT_METHODS.map((m) => (
            <Radio key={m} name="method" value={m} label={PAYMENT_METHOD_LABEL[m]} checked={p.method === m} onChange={() => set({ method: m })} />
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3">
        {p.method === "CASH" && (
          <>
            <AmountInput ref={firstFieldRef} label="Amount received" required size="lg" value={p.received} onValueChange={(v) => set({ received: v })} error={errors.received} disabled={readOnly} />
            <div className="flex items-center justify-between rounded-md bg-surface-sunken px-3 py-2 tabular-nums">
              <span className="text-ink-muted">Change to return</span>
              <span className="text-title-3">{change === null ? "—" : change < 0 ? `Short by ${formatRs(-change)}` : formatRs(change)}</span>
            </div>
          </>
        )}
        {p.method === "BANK" && (
          <>
            <Select label="Bank" required value={p.bank} onChange={(e) => set({ bank: e.target.value })} error={errors.bank} options={[{ value: "", label: "Choose…" }, ...BANKS]} />
            <Input ref={firstFieldRef} label="Slip number" required value={p.slipNo} onChange={(e) => set({ slipNo: e.target.value })} error={errors.slipNo} mono />
            <DatePicker label="Deposit date" required value={p.depositDate} onValueChange={(v) => set({ depositDate: v })} error={errors.depositDate} today={today} maxDate={today} />
          </>
        )}
        {p.method === "CHEQUE" && (
          <>
            <Input ref={firstFieldRef} label="Cheque number" required value={p.chequeNo} onChange={(e) => set({ chequeNo: e.target.value })} error={errors.chequeNo} mono inputMode="numeric" />
            <Select label="Bank" required value={p.chequeBank} onChange={(e) => set({ chequeBank: e.target.value })} error={errors.chequeBank} options={[{ value: "", label: "Choose…" }, ...BANKS]} />
            <DatePicker label="Cheque date" required value={p.chequeDate} onValueChange={(v) => set({ chequeDate: v })} error={errors.chequeDate} today={today} />
          </>
        )}
        {p.method === "ONLINE" && <Input ref={firstFieldRef} label="Transaction ID" required value={p.transactionId} onChange={(e) => set({ transactionId: e.target.value })} error={errors.transactionId} mono help="From the Raast or bank app confirmation." />}
      </div>

      <div className="grid gap-3 border-t border-border pt-3">
        <Input label="Paid by" value={state.paidBy} onChange={(e) => state.setPaidBy(e.target.value)} placeholder={state.guardianName || "Guardian"} help="Leave empty when the guardian on record pays." error={errors.paidBy} disabled={readOnly} maxLength={60} />
        <Input label="Remarks" value={state.note} onChange={(e) => state.setNote(e.target.value)} placeholder="Printed on the receipt" error={errors.note} disabled={readOnly} maxLength={160} />
      </div>

      <Button variant="primary" size="lg" block disabled={nothing || readOnly} onClick={onReview} iconRight="arrowRight">
        {nothing ? "Select charges to pay" : `Review · ${formatRs(state.payNow)}`}
      </Button>
      {readOnly && <p className="m-0 text-small text-ink-muted">Fees can't be collected in a past session.</p>}
    </aside>
  );
}
