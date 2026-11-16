import { feeMonthLongLabel, type FeeVoucher } from "@mtb/api";
import { amountInWords, formatCount, formatDate, formatRs, formatSession } from "@mtb/domain";
import { Urdu } from "@mtb/ui";
import type { CSSProperties } from "react";
import { Letterhead, printStamp } from "../../../app/print/letterhead";

const ROMAN = ["I", "II", "III", "IV", "V"];

/**
 * One tear-off copy, in the order of the old three-box fee voucher (FeeSlipNew.rdlc): copy number and name, the bank
 * (name, account no., account title), the school heading, "Issue Date : … Due Date : …", Name, Father Name, Roll No.,
 * Class, Fee for the Month of, then Detail of Dues / Amount / Fine with Total Amount, the note and "Print Date : …".
 * New, kept because the bank and the late-fine rule need them: voucher number, last date the bank accepts it, the amount
 * payable by the due date in words, the late-payment table and the two signature boxes.
 */
function Copy({ v, label, n }: { v: FeeVoucher; label: string; n: number }) {
  const thisMonth = v.lines.filter((l) => !l.arrears);
  const arrears = v.lines.filter((l) => l.arrears);
  const arrearsTotal = arrears.reduce((a, l) => a + l.amount, 0);
  const amountTotal = thisMonth.reduce((a, l) => a + l.amount, 0) + arrearsTotal;
  return (
    <section className="fees-voucher-copy fees-voucher" aria-label={`${label}, voucher ${v.voucherNo}`}>
      {v.status === "CANCELLED" && <span className="fees-voucher-mark">CANCELLED</span>}
      <header className="fees-voucher-head">
        <b>{ROMAN[n] ?? n + 1}</b>
        <b className="fees-voucher-copyname">{label}</b>
      </header>
      <div className="fees-voucher-bank">
        <strong className="fees-voucher-bankname">{v.bank.bankName || "Bank details not set: see Setup → Campus settings"}</strong>
        <span className="tabular-nums">Account No. {v.bank.accountNo || "—"}</span>
        <span>{v.bank.accountTitle || ""}</span>
      </div>
      <Letterhead campus={v.campus} campusName={v.campusName} variant="slip" />
      <div className="fees-voucher-dates">
        Issue Date : {formatDate(v.issueDate)}
        <span>Due Date : {formatDate(v.dueDate)}</span>
      </div>

      <dl className="fees-voucher-kv">
        <dt>Name</dt>
        <dd>
          {v.studentName}
          {v.studentNameUr && (
            <>
              {" "}
              · <Urdu size="small">{v.studentNameUr}</Urdu>
            </>
          )}
        </dd>
        <dt>Father Name</dt>
        <dd>{v.father}</dd>
        <dt>Roll No.</dt>
        <dd>{v.grNo}</dd>
        <dt>Class</dt>
        <dd>{v.classSection}</dd>
        <dt>Fee for the Month of</dt>
        <dd>
          {feeMonthLongLabel(v.month)} · {formatSession(v.session)}
        </dd>
        <dt>Voucher No.</dt>
        <dd>{v.voucherNo}</dd>
        <dt>Bank accepts until</dt>
        <dd>{formatDate(v.validUntil)}</dd>
      </dl>

      <table className="fees-voucher-dues">
        <thead>
          <tr>
            <th>Detail of Dues</th>
            <th className="n">Amount</th>
            <th className="n">Fine</th>
          </tr>
        </thead>
        <tbody>
          {thisMonth.map((l) => (
            <tr key={l.chargeId}>
              <td>
                {l.head}
                {l.concession && (
                  <div className="text-ink-muted">
                    {l.concession.label}: {formatRs(l.gross ?? 0)} − {formatRs(l.concession.amount)}
                  </div>
                )}
              </td>
              <td className="n">{formatCount(l.amount)}</td>
              <td className="n">0</td>
            </tr>
          ))}
          {arrears.length > 0 && (
            <tr>
              <td>
                Arrears ({arrears.map((l) => l.head.replace("Tuition fee – ", "Tuition ")).join(", ")})
                {v.fineOnArrears > 0 && <div className="text-ink-muted">Fine to {formatDate(v.dueDate)}</div>}
              </td>
              <td className="n">{formatCount(arrearsTotal)}</td>
              <td className="n">{formatCount(v.fineOnArrears)}</td>
            </tr>
          )}
          <tr className="fees-voucher-sub">
            <th>Total Amount :</th>
            <td className="n">{formatCount(amountTotal)}</td>
            <td className="n">{formatCount(v.fineOnArrears)}</td>
          </tr>
          <tr className="fees-voucher-total">
            <th>Pay by {formatDate(v.dueDate)} :</th>
            <td className="n" colSpan={2}>
              {formatRs(v.payableByDue)}
            </td>
          </tr>
          <tr className="fees-voucher-sub">
            <th>Paid Amount :</th>
            <td colSpan={2} />
          </tr>
        </tbody>
      </table>
      <span className="fees-voucher-words">{amountInWords(v.payableByDue)}</span>

      <table aria-label="Amount if paid late">
        <thead>
          <tr>
            <th>If paid on or before</th>
            <th className="n">Amount</th>
          </tr>
        </thead>
        <tbody>
          {v.fineTable.slice(1).map((r) => (
            <tr key={r.upTo}>
              <td>{formatDate(r.upTo)}</td>
              <td className="n">{formatRs(r.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <span className="text-ink-muted">{v.fineRule}. After {formatDate(v.validUntil)} pay at the school office.</span>
      <span>
        <b>Note:</b>&nbsp; Once fee paid then not refundable in any case.
      </span>

      <div className="fees-voucher-sign">
        <div>Bank stamp and signature</div>
        <div>Depositor&apos;s signature</div>
      </div>
      <span className="fees-voucher-stamp">Print Date : {printStamp()}</span>
    </section>
  );
}

/** One voucher: the campus's tear-off copies side by side on A4 landscape. Always printed in the light theme. */
export function VoucherSheet({ voucher }: { voucher: FeeVoucher }) {
  const labels = voucher.bank.copyLabels.length ? voucher.bank.copyLabels : ["Bank copy", "School copy", "Parent copy"];
  return (
    <div data-theme="light" className="fees-voucher-sheet" style={{ "--copies": labels.length } as CSSProperties}>
      {labels.map((label, i) => (
        <Copy key={label} v={voucher} label={label} n={i} />
      ))}
    </div>
  );
}
