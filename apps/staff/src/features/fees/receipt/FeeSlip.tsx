import { formatDate } from "@mtb/domain";
import type { ReactNode } from "react";
import { Letterhead, printStamp } from "../../../app/print/letterhead";

/** "14,800", as the old slip printed amounts (no "Rs"). */
export const slipAmount = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** "07 - Oct - 2026", the old slip's date (Pakistan time). */
export function slipDate(iso: string | undefined | null): string {
  return iso ? formatDate(iso).replace(/-/g, " - ") : "";
}

export interface FeeSlipRow {
  key: string;
  description: ReactNode;
  amount: number;
  fine?: number;
}

/**
 * The old "SCHOOLS/COLLEGES FEE SLIP — Fee Payment Report" (FeeSlip.rdlc, Candidate Fee Slip.rdlc), printed at the top
 * of an A4 portrait page: letterhead, Name / Class/Section, GR No: / Date: / V.No. on underlined fields, a ruled table of
 * Description, Amount (and Fine on the student slip), Total Amount and Paid Amount rows, the notes, and "Print Date : …".
 * `extra` holds what the new process adds (payment method, cashier, remarks) on one small line under the table.
 */
export function FeeSlip({
  campus,
  campusName,
  name,
  classSection,
  grNo,
  date,
  vNo,
  rows,
  withFine,
  paid,
  notes,
  extra,
  watermark,
  label,
}: {
  campus: string;
  campusName?: string;
  name: ReactNode;
  classSection: ReactNode;
  grNo: ReactNode;
  date: string;
  vNo: ReactNode;
  rows: FeeSlipRow[];
  withFine: boolean;
  paid: number;
  notes: string[];
  extra?: ReactNode;
  watermark?: { text: string; danger?: boolean } | null;
  label: string;
}) {
  const total = rows.reduce((x, r) => x + r.amount, 0);
  const fine = rows.reduce((x, r) => x + (r.fine ?? 0), 0);
  return (
    <article className="fees-fslip" aria-label={label}>
      <style>{"@page { size: A4 portrait; margin: 2.5mm; }"}</style>
      {watermark && (
        <span aria-hidden="true" className="fees-fslip-mark" style={{ color: watermark.danger ? "#c00" : "#777" }}>
          {watermark.text}
        </span>
      )}
      <Letterhead campus={campus} {...(campusName ? { campusName } : {})} title="SCHOOLS/COLLEGES FEE SLIP" />
      <div className="fees-fslip-red">Fee Payment Report</div>
      <div className="fees-fslip-fields fees-fslip-row1">
        <b>Name</b>
        <span className="fees-fslip-val">{name}</span>
        <b>Class/Section</b>
        <span className="fees-fslip-val">{classSection}</span>
      </div>
      <div className="fees-fslip-fields fees-fslip-row2">
        <b>GR No:</b>
        <span className="fees-fslip-val">{grNo}</span>
        <b>Date:</b>
        <span className="fees-fslip-val">{slipDate(date)}</span>
        <b>V.No.</b>
        <span className="fees-fslip-val">{vNo}</span>
      </div>
      <table className="fees-fslip-table">
        <colgroup>
          <col />
          <col style={{ width: "15%" }} />
          {withFine && <col style={{ width: "17%" }} />}
        </colgroup>
        <thead>
          <tr>
            <th>Description</th>
            <th>Amount</th>
            {withFine && <th>Fine</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="l">{r.description}</td>
              <td>{slipAmount(r.amount)}</td>
              {withFine && <td>{slipAmount(r.fine ?? 0)}</td>}
            </tr>
          ))}
          <tr>
            <th className="r">Total Amount :</th>
            <td>{slipAmount(total)}</td>
            {withFine && <td>{slipAmount(fine)}</td>}
          </tr>
          <tr>
            <th className="r">Paid Amount :</th>
            <td>{slipAmount(paid)}</td>
            {withFine && <td />}
          </tr>
        </tbody>
      </table>
      {extra && <div className="fees-fslip-extra">{extra}</div>}
      <div className="fees-fslip-notes">
        {notes.map((n, i) =>
          i === 0 ? (
            <p key={n}>
              <b>Note:</b>&nbsp; {n}
            </p>
          ) : (
            <p key={n}>{n}</p>
          ),
        )}
      </div>
      <p className="fees-fslip-stamp">Print Date : {printStamp()}</p>
    </article>
  );
}
