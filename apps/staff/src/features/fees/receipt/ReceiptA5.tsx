import { feeMonthLongLabel, PAYMENT_METHOD_LABEL, type Receipt } from "@mtb/api";
import { formatDate, formatRs, formatSession, formatTime } from "@mtb/domain";
import { cx } from "@mtb/ui";
import { useAppearance } from "../../../app/appearance";

function PaymentDetails({ r }: { r: Receipt }) {
  const p = r.payment;
  const rows: Array<[string, string]> = [["Payment", PAYMENT_METHOD_LABEL[p.method]]];
  if (p.method === "CASH") {
    rows.push(["Received", formatRs(p.received)]);
    if (p.change !== undefined) rows.push(["Change returned", formatRs(p.change)]);
  } else if (p.method === "BANK") rows.push(["Bank", p.bank], ["Slip number", p.slipNo], ["Deposit date", formatDate(p.depositDate)]);
  else if (p.method === "CHEQUE") rows.push(["Cheque number", p.chequeNo], ["Bank", p.bank], ["Cheque date", formatDate(p.chequeDate)]);
  else if (p.method === "ONLINE") rows.push(["Transaction ID", p.transactionId]);
  else if (p.method === "SALARY") rows.push(["Deducted from salary of", feeMonthLongLabel(p.month)]);
  // LEGACY: the old system did not record how the parent paid.
  return (
    <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-[12px] leading-4">
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt className="text-ink-muted">{k}</dt>
          <dd className="m-0 text-right font-medium tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The A5 portrait receipt. Always printed in the light theme. The receipt number appears only after posting.
 * Reprints carry a DUPLICATE watermark; cancelled receipts carry CANCELLED.
 */
export function ReceiptA5({ receipt: r, duplicate }: { receipt: Receipt; duplicate?: boolean }) {
  const { accent } = useAppearance();
  const watermark = r.status === "CANCELLED" ? "CANCELLED" : duplicate ? "DUPLICATE" : null;
  return (
    <div data-theme="light" data-accent={accent} className="mtb-receipt-print">
      <article
        className="relative mx-auto grid gap-3 overflow-hidden border border-border bg-surface-raised p-6 text-ink shadow-sm"
        style={{ width: "148mm", minHeight: "210mm", fontSize: 12, lineHeight: "16px" }}
        aria-label={`Receipt ${r.receiptNo}`}
      >
        {watermark && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 grid place-content-center text-[64px] font-semibold tracking-[0.2em]"
            style={{ color: r.status === "CANCELLED" ? "var(--danger)" : "var(--ink-subtle)", opacity: 0.16, transform: "rotate(-24deg)" }}
          >
            {watermark}
          </span>
        )}
        <header className="flex items-start justify-between gap-4 border-b border-border-strong pb-3">
          <div className="grid">
            <span className="text-title-2 text-brand-ink">MTB</span>
            <span className="font-medium">{r.campusName}</span>
            <span className="text-ink-muted">{r.campusAddress}</span>
          </div>
          <div className="grid justify-items-end gap-1 text-right">
            <span className="rounded-sm border border-border-strong px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide">Student copy</span>
            <span className="text-title-3">Fee receipt</span>
            {watermark && <span className="text-[11px] font-semibold text-danger-ink">{watermark}</span>}
          </div>
        </header>

        <dl className="m-0 grid grid-cols-[auto_1fr_auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-ink-muted">Receipt no.</dt>
          <dd className="m-0 mtb-mono">{r.receiptNo}</dd>
          <dt className="text-ink-muted">Date</dt>
          <dd className="m-0 tabular-nums">
            {formatDate(r.postedAt)}, {formatTime(r.postedAt)}
          </dd>
          <dt className="text-ink-muted">Session</dt>
          <dd className="m-0 tabular-nums">{formatSession(r.session)}</dd>
          <dt className="text-ink-muted">Cashier</dt>
          <dd className="m-0">{r.cashier}</dd>
        </dl>

        <section className="grid gap-1 rounded-md bg-surface-sunken px-3 py-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <span className="text-[15px] font-semibold">{r.studentName}</span>
            {r.studentNameUr && (
              <span lang="ur" dir="rtl" className="urdu-small">
                {r.studentNameUr}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 text-ink-muted">
            <span>
              G.R. <span className="mtb-mono text-ink">{r.grNo}</span>
            </span>
            <span>
              Class <span className="text-ink">{r.classSection}</span>
            </span>
            <span>
              {r.relation} <span className="text-ink">{r.father}</span>
            </span>
          </div>
          <div className="text-ink-muted">
            Paid by <span className="font-medium text-ink">{r.paidBy ?? `${r.father} (guardian)`}</span>
          </div>
        </section>

        <table className="w-full border-collapse tabular-nums">
          <thead>
            <tr className="border-b border-border-strong text-left text-[11px] uppercase tracking-wide text-ink-muted">
              <th className="py-1 font-medium">Charge</th>
              <th className="py-1 font-medium">Due</th>
              <th className="py-1 text-right font-medium">Amount</th>
              <th className="py-1 text-right font-medium">Late fine</th>
              <th className="py-1 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {r.lines.map((l) => (
              <tr key={l.chargeId} className="border-b border-border">
                <td className="py-1.5 pr-2">
                  {l.head}
                  {l.applied < l.lineTotal && <span className="block text-[11px] text-ink-muted">Part payment: {formatRs(l.applied)} of {formatRs(l.lineTotal)}</span>}
                </td>
                <td className="py-1.5 pr-2 whitespace-nowrap">{formatDate(l.dueDate)}</td>
                <td className="py-1.5 text-right">{formatRs(l.amount)}</td>
                <td className="py-1.5 text-right">
                  {l.lateFine > 0 ? formatRs(l.lateFine) : "—"}
                  {l.lateFine > 0 && <span className="block text-[10px] text-ink-muted">{l.daysOverdue} days late</span>}
                </td>
                <td className="py-1.5 text-right font-medium">{formatRs(l.applied)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="pt-2 text-right font-semibold">
                Total paid
              </td>
              <td className="pt-2 text-right text-[16px] font-semibold">{formatRs(r.total)}</td>
            </tr>
          </tfoot>
        </table>

        {r.note && (
          <p className="m-0 text-[11px]">
            <span className="text-ink-muted">Remarks: </span>
            {r.note}
          </p>
        )}

        <p className="m-0 border-y border-border py-2 font-medium">{r.amountInWords}</p>

        <div className="grid grid-cols-[1fr_auto] items-end gap-6">
          <PaymentDetails r={r} />
          <div className="grid justify-items-center gap-1 text-[11px] text-ink-muted">
            <span className="block h-10 w-36 border-b border-border-strong" />
            Cashier's signature
          </div>
        </div>

        <footer className={cx("mt-auto grid gap-1 border-t border-border pt-2 text-[10px] text-ink-muted")}>
          {(r.policyNotes ?? []).length > 0 && (
            <ul className="m-0 grid list-none gap-0.5 p-0 text-ink">
              {(r.policyNotes ?? []).map((n) => (
                <li key={n}>
                  <b>Note:</b> {n}
                </li>
              ))}
            </ul>
          )}
          <span>Computer-generated receipt. Keep it safe; it is your proof of payment. Receipt numbers are never reused.</span>
        </footer>
      </article>
    </div>
  );
}
