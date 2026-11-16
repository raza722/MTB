import { feeMonthLongLabel, PAYMENT_METHOD_LABEL, type Receipt } from "@mtb/api";
import { formatDate, formatRs } from "@mtb/domain";
import { useAppearance } from "../../../app/appearance";
import { FeeSlip, slipAmount } from "./FeeSlip";

/** "Cash: received Rs 15,000, change Rs 200", "Bank: HBL, slip 4471, deposited 07-Oct-2026" … (new; the old slip had none). */
function paymentLine(r: Receipt): string {
  const p = r.payment;
  const how = PAYMENT_METHOD_LABEL[p.method];
  if (p.method === "CASH") return `${how}: received ${formatRs(p.received)}${p.change ? `, change ${formatRs(p.change)}` : ""}`;
  if (p.method === "BANK") return `${how}: ${p.bank}, slip ${p.slipNo}, deposited ${formatDate(p.depositDate)}`;
  if (p.method === "CHEQUE") return `${how}: no. ${p.chequeNo}, ${p.bank}, dated ${formatDate(p.chequeDate)}`;
  if (p.method === "ONLINE") return `${how}: transaction ${p.transactionId}`;
  if (p.method === "SALARY") return `${how}: ${feeMonthLongLabel(p.month)}`;
  // LEGACY: the old system did not record how the parent paid.
  return "";
}

/** "Nine - Barni - 2026-2027", as the old slip's Class/Section. */
const classLine = (r: Receipt) => `${r.classSection.replace(/\s*[-·]\s*/g, " - ")} - ${r.session}-${r.session + 1}`;

/**
 * The fee receipt printed at the counter, laid out as the old "Fee Slip" (Student Fee Voucher › Print): A4 portrait,
 * the slip at the top. The receipt number is the V.No. Reprints carry a DUPLICATE watermark; cancelled receipts CANCELLED.
 */
export function ReceiptA5({ receipt: r, duplicate }: { receipt: Receipt; duplicate?: boolean }) {
  const { accent } = useAppearance();
  const watermark = r.status === "CANCELLED" ? { text: "CANCELLED", danger: true } : duplicate ? { text: "DUPLICATE" } : null;
  const extra = [paymentLine(r), `Received by ${r.cashier}`, r.paidBy ? `Paid by ${r.paidBy}` : "", r.note ? `Remarks: ${r.note}` : ""].filter(Boolean).join(" · ");
  return (
    <div data-theme="light" data-accent={accent} className="mtb-receipt-print">
      <FeeSlip
        label={`Receipt ${r.receiptNo}`}
        campus={r.campus}
        campusName={r.campusName}
        name={r.studentName}
        classSection={classLine(r)}
        grNo={r.grNo}
        date={r.postedAt}
        vNo={r.receiptNo}
        withFine
        rows={r.lines.map((l) => ({
          key: l.chargeId,
          description: (
            <>
              {l.head}
              {l.applied < l.lineTotal && <small>Part payment: {slipAmount(l.applied)} of {slipAmount(l.lineTotal)}</small>}
            </>
          ),
          amount: l.amount,
          fine: l.lateFine,
        }))}
        paid={r.total}
        notes={r.policyNotes ?? []}
        extra={extra}
        watermark={watermark}
      />
    </div>
  );
}
