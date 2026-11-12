import { feeMonthLongLabel, PAYMENT_METHOD_LABEL, type FeeVoucher, type PortalReceipt } from "@mtb/api";
import { amountInWords, formatCount, formatDate, formatRs, formatSession, formatTime } from "@mtb/domain";
import { useElementWidth } from "@mtb/ui";
import type { CSSProperties, ReactNode } from "react";

/**
 * Official documents (receipt, fee voucher) print in English, left to right and in the light theme, whatever language
 * or display the portal is in, so they match what the counter and the bank see. On screen they are scaled to fit.
 */
export function DocFrame({ widthPx, children }: { widthPx: number; children: ReactNode }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const zoom = width > 0 ? Math.min(1, (width - 24) / widthPx) : 1;
  return (
    <div ref={ref} className="portal-doc-desk">
      <div className="portal-doc-zoom mx-auto w-fit" style={{ "--doc-zoom": zoom } as CSSProperties}>
        {children}
      </div>
    </div>
  );
}

function PaymentDetails({ r }: { r: PortalReceipt }) {
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

/** The A5 portrait receipt, the same layout as the counter prints, marked as the parent's copy. */
export function ReceiptA5({ receipt: r }: { receipt: PortalReceipt }) {
  const watermark = r.status === "CANCELLED" ? "CANCELLED" : r.status === "CANCEL_PENDING" ? "UNDER REVIEW" : null;
  return (
    <div data-theme="light" lang="en" dir="ltr" className="portal-doc">
      <article
        className="relative grid gap-3 overflow-hidden border border-border bg-surface-raised p-6 text-ink shadow-sm"
        style={{ width: "148mm", minHeight: "200mm", fontSize: 12, lineHeight: "16px" }}
        aria-label={`Receipt ${r.receiptNo}`}
      >
        {watermark && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 grid place-content-center text-[56px] font-semibold tracking-[0.2em]"
            style={{ color: r.status === "CANCELLED" ? "var(--danger)" : "var(--ink-subtle)", opacity: 0.16, transform: "rotate(-24deg)" }}
          >
            {watermark}
          </span>
        )}
        <header className="flex items-start justify-between gap-4 border-b border-border-strong pb-3">
          <div className="grid">
            <span className="text-[20px] leading-6 font-semibold text-brand-ink">MTB</span>
            <span className="font-medium">{r.campusName}</span>
            <span className="text-ink-muted">{r.campusAddress}</span>
          </div>
          <div className="grid justify-items-end gap-1 text-right">
            <span className="rounded-sm border border-border-strong px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase">Parent copy</span>
            <span className="text-[15px] leading-5 font-semibold">Fee receipt</span>
          </div>
        </header>

        <dl className="m-0 grid grid-cols-[auto_1fr_auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-ink-muted">Receipt no.</dt>
          <dd className="m-0 font-[family-name:var(--font-mono)] font-medium">{r.receiptNo}</dd>
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
              G.R. <span className="font-[family-name:var(--font-mono)] text-ink">{r.grNo}</span>
            </span>
            <span>
              Class <span className="text-ink">{r.classSection}</span>
            </span>
            <span>
              {r.relation} <span className="text-ink">{r.father}</span>
            </span>
          </div>
        </section>

        <table className="w-full border-collapse tabular-nums">
          <thead>
            <tr className="border-b border-border-strong text-left text-[11px] tracking-wide text-ink-muted uppercase">
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
                  {l.applied < l.lineTotal && (
                    <span className="block text-[11px] text-ink-muted">
                      Part payment: {formatRs(l.applied)} of {formatRs(l.lineTotal)}
                    </span>
                  )}
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

        <p className="m-0 border-y border-border py-2 font-medium">{r.amountInWords}</p>

        <div className="grid grid-cols-[1fr_auto] items-end gap-6">
          <PaymentDetails r={r} />
          <div className="grid justify-items-center gap-1 text-[11px] text-ink-muted">
            <span className="block h-10 w-36 border-b border-border-strong" />
            Cashier's signature
          </div>
        </div>

        <footer className="mt-auto grid gap-0.5 border-t border-border pt-2 text-[10px] text-ink-muted">
          <span>Computer-generated receipt. Keep it safe; it is your proof of payment. Receipt numbers are never reused.</span>
          <span>
            Downloaded from the MTB parent portal on {formatDate(r.downloadedAt)}, {formatTime(r.downloadedAt)}. The campus office can check it by the receipt number.
          </span>
        </footer>
      </article>
    </div>
  );
}

function VoucherCopy({ v, label }: { v: FeeVoucher; label: string }) {
  const thisMonth = v.lines.filter((l) => !l.arrears);
  const arrears = v.lines.filter((l) => l.arrears);
  const arrearsTotal = arrears.reduce((a, l) => a + l.amount, 0);
  return (
    <section className="portal-voucher-copy portal-voucher" aria-label={`${label}, voucher ${v.voucherNo}`}>
      <header className="portal-voucher-head">
        <div>
          <strong>{v.bank.title}</strong>
          <span className="text-ink-muted">
            Fee voucher · {feeMonthLongLabel(v.month)} · Session {formatSession(v.session)}
          </span>
        </div>
        <span className="portal-voucher-tag">{label}</span>
      </header>

      <dl className="portal-voucher-kv">
        <dt>Voucher no.</dt>
        <dd>{v.voucherNo}</dd>
        <dt>Issued</dt>
        <dd>{formatDate(v.issueDate)}</dd>
        <dt>Due date</dt>
        <dd>{formatDate(v.dueDate)}</dd>
        <dt>Bank accepts until</dt>
        <dd>{formatDate(v.validUntil)}</dd>
      </dl>

      <div className="portal-voucher-bank">
        <span className="font-semibold">{v.bank.bankName}</span>
        <span>Account title: {v.bank.accountTitle}</span>
        <span className="tabular-nums">Account no.: {v.bank.accountNo}</span>
      </div>

      <dl className="portal-voucher-kv">
        <dt>Student</dt>
        <dd>
          {v.studentName}
          {v.studentNameUr && (
            <>
              {" "}
              ·{" "}
              <span lang="ur" dir="rtl" className="urdu-small">
                {v.studentNameUr}
              </span>
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
              <td>{l.head}</td>
              <td className="n">{formatCount(l.amount)}</td>
            </tr>
          ))}
          {arrears.length > 0 && (
            <tr>
              <td>Arrears ({arrears.map((l) => l.head.replace("Tuition fee – ", "Tuition ")).join(", ")})</td>
              <td className="n">{formatCount(arrearsTotal)}</td>
            </tr>
          )}
          {v.fineOnArrears > 0 && (
            <tr>
              <td>Late fine on arrears to {formatDate(v.dueDate)}</td>
              <td className="n">{formatCount(v.fineOnArrears)}</td>
            </tr>
          )}
          <tr className="total">
            <td>Pay by {formatDate(v.dueDate)}</td>
            <td className="n">{formatRs(v.payableByDue)}</td>
          </tr>
        </tbody>
      </table>
      <span className="portal-voucher-words">{amountInWords(v.payableByDue)}</span>

      <table aria-label="Amount if paid late">
        <thead>
          <tr>
            <th>If paid on or before</th>
            <th className="n">Amount</th>
          </tr>
        </thead>
        <tbody>
          {v.fineTable.slice(1).map((row) => (
            <tr key={row.upTo}>
              <td>{formatDate(row.upTo)}</td>
              <td className="n">{formatRs(row.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <span className="text-ink-muted">
        {v.fineRule}. After {formatDate(v.validUntil)} pay at the school office.
      </span>

      <div className="portal-voucher-sign">
        <div>Bank stamp and signature</div>
        <div>Depositor's signature</div>
      </div>
    </section>
  );
}

/** The fee voucher: bank, school and parent copies side by side on A4 landscape, as the office prints them. */
export function VoucherSheet({ voucher }: { voucher: FeeVoucher }) {
  const labels = voucher.bank.copyLabels.length ? voucher.bank.copyLabels : ["Bank copy", "School copy", "Parent copy"];
  return (
    <div data-theme="light" lang="en" dir="ltr" className="portal-doc portal-voucher-sheet" style={{ "--copies": labels.length } as CSSProperties}>
      {labels.map((label) => (
        <VoucherCopy key={label} v={voucher} label={label} />
      ))}
    </div>
  );
}
