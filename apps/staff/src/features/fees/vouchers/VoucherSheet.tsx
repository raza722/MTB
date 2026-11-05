import { feeMonthLongLabel, type FeeVoucher } from "@mtb/api";
import { amountInWords, formatCount, formatDate, formatRs, formatSession } from "@mtb/domain";
import { Urdu } from "@mtb/ui";
import type { CSSProperties } from "react";

function Copy({ v, label }: { v: FeeVoucher; label: string }) {
  const thisMonth = v.lines.filter((l) => !l.arrears);
  const arrears = v.lines.filter((l) => l.arrears);
  const arrearsTotal = arrears.reduce((a, l) => a + l.amount, 0);
  return (
    <section className="fees-voucher-copy fees-voucher" aria-label={`${label}, voucher ${v.voucherNo}`}>
      {v.status === "CANCELLED" && <span className="fees-voucher-mark">CANCELLED</span>}
      <header className="fees-voucher-head">
        <div>
          <strong>{v.bank.title}</strong>
          <span className="text-ink-muted">
            Fee voucher · {feeMonthLongLabel(v.month)} · Session {formatSession(v.session)}
          </span>
        </div>
        <span className="fees-voucher-tag">{label}</span>
      </header>

      <dl className="fees-voucher-kv">
        <dt>Voucher no.</dt>
        <dd>{v.voucherNo}</dd>
        <dt>Issued</dt>
        <dd>{formatDate(v.issueDate)}</dd>
        <dt>Due date</dt>
        <dd>{formatDate(v.dueDate)}</dd>
        <dt>Bank accepts until</dt>
        <dd>{formatDate(v.validUntil)}</dd>
      </dl>

      <div className="fees-voucher-bank">
        <span className="font-semibold">{v.bank.bankName || "Bank details not set: see Setup → Campus settings"}</span>
        <span>Account title: {v.bank.accountTitle || "—"}</span>
        <span className="tabular-nums">Account no.: {v.bank.accountNo || "—"}</span>
      </div>

      <dl className="fees-voucher-kv">
        <dt>Student</dt>
        <dd>
          {v.studentName}
          {v.studentNameUr && (
            <>
              {" "}
              · <Urdu size="small">{v.studentNameUr}</Urdu>
            </>
          )}
        </dd>
        <dt>{v.relation === "d/o" ? "Daughter of" : "Son of"}</dt>
        <dd>{v.father}</dd>
        <dt>G.R. no. · Class</dt>
        <dd>
          {v.grNo} · {v.classSection}
        </dd>
      </dl>

      <table>
        <thead>
          <tr>
            <th>Charge</th>
            <th className="n">Rs</th>
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
            </tr>
          ))}
          {arrears.length > 0 && (
            <tr>
              <td>
                Arrears ({arrears.map((l) => l.head.replace("Tuition fee – ", "Tuition ")).join(", ")})
              </td>
              <td className="n">{formatCount(arrearsTotal)}</td>
            </tr>
          )}
          {v.fineOnArrears > 0 && (
            <tr>
              <td>Late fine on arrears to {formatDate(v.dueDate)}</td>
              <td className="n">{formatCount(v.fineOnArrears)}</td>
            </tr>
          )}
          <tr className="fees-voucher-total">
            <td>Pay by {formatDate(v.dueDate)}</td>
            <td className="n">{formatRs(v.payableByDue)}</td>
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

      <div className="fees-voucher-sign">
        <div>Bank stamp and signature</div>
        <div>Depositor's signature</div>
      </div>
    </section>
  );
}

/** One voucher: the campus's tear-off copies side by side on A4 landscape. Always printed in the light theme. */
export function VoucherSheet({ voucher }: { voucher: FeeVoucher }) {
  const labels = voucher.bank.copyLabels.length ? voucher.bank.copyLabels : ["Bank copy", "School copy", "Parent copy"];
  return (
    <div data-theme="light" className="fees-voucher-sheet" style={{ "--copies": labels.length } as CSSProperties}>
      {labels.map((label) => (
        <Copy key={label} v={voucher} label={label} />
      ))}
    </div>
  );
}
