import { REPORT_SUBTOTAL_KEY, type ReportResult } from "@mtb/api";
import { formatDateTime } from "@mtb/domain";
import { cellText } from "./shell";

const NUMERIC = new Set(["money", "count", "percent"]);

/**
 * The printable report (A4 portrait or landscape): campus heading, title, the filters used, the table with
 * totals, notes and who printed it. Hidden on screen; only it prints. "Save as PDF" in the print dialog
 * gives the PDF.
 */
export function ReportDocument({ result, landscape }: { result: ReportResult; landscape: boolean }) {
  return (
    <div className={`rpt-print-only mtb-print-area ${landscape ? "rpt-landscape" : "rpt-portrait"}`} aria-hidden="true">
      <div className={result.ruled ? "rpt-doc rpt-ruled" : "rpt-doc"}>
        <header className="rpt-doc-head">
          <div>
            <h1>{result.campusHeading}</h1>
            <h2>{result.title}</h2>
            <div>{result.subtitle}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div>{result.rows.length.toLocaleString("en-PK")} rows</div>
            <div>Prepared {formatDateTime(result.generatedAt)}</div>
          </div>
        </header>
        <table>
          <thead>
            <tr>
              {result.columns.map((c) => (
                <th key={c.key} className={NUMERIC.has(c.kind) ? "num" : undefined}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r, i) => (
              <tr key={i} className={r[REPORT_SUBTOTAL_KEY] ? "rpt-subtotal" : undefined}>
                {result.columns.map((c) => (
                  <td key={c.key} className={NUMERIC.has(c.kind) ? "num" : c.kind === "blank" ? "rpt-blank-cell" : undefined} {...(c.kind === "urdu" ? { lang: "ur", dir: "rtl" } : {})}>
                    {c.kind === "blank" ? "" : cellText(r[c.key] ?? null, c.kind)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {result.totals && (
            <tfoot>
              <tr>
                {result.columns.map((c, i) => (
                  <td key={c.key} className={NUMERIC.has(c.kind) ? "num" : undefined}>
                    {c.key in result.totals! ? cellText(result.totals![c.key]!, c.kind) : i === 0 ? "Total" : ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
        {result.notes?.map((n) => (
          <p key={n} style={{ margin: "8px 0 0" }}>
            {n}
          </p>
        ))}
        {result.signatures?.length ? (
          <div className="rpt-signatures">
            {result.signatures.map((s) => (
              <span key={s}>{s}</span>
            ))}
          </div>
        ) : null}
        <footer className="rpt-doc-foot">
          <span>Printed by {result.generatedBy}</span>
          <span>MTB School &amp; College Management System</span>
        </footer>
      </div>
    </div>
  );
}
