import { REPORT_SUBTOTAL_KEY, type ReportFilterDef, type ReportResult } from "@mtb/api";
import { formatDate } from "@mtb/domain";
import { schoolHeading } from "../../app/print/letterhead";
import { filterLine, printTitle, serialLabel, titleInCapitals } from "./ReportDocument";
import { cellText } from "./shell";

/**
 * "daily-fee-collection-summary-kc-04-nov-2026": the server's `ReportJob.fileName` form, with the date the report
 * was prepared in Pakistan (`generatedAt` is UTC).
 */
export function fileBase(result: ReportResult, campus: string): string {
  const slug = result.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `${slug}-${campus === "ALL" ? "all-campuses" : campus.toLowerCase()}-${formatDate(result.generatedAt).toLowerCase()}`;
}

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/**
 * The report as a CSV file that opens in Excel (UTF-8 with a byte-order mark, so Urdu names survive).
 * Numbers are written plain (no "Rs", no commas) so Excel can add them up. It opens with the printed report's
 * heading: the school and campus, the old report's title (in capitals where the old one was) and the line of parameters ("Class : 9   Section : Barni").
 */
export function toCsv(full: ReportResult, campus?: string, filters?: ReportFilterDef[]): string {
  // a CSV cannot hold pictures: the "Picture" column stays on the printed report only
  const result: ReportResult = { ...full, columns: full.columns.filter((c) => c.kind !== "photo") };
  const lines: string[] = [];
  lines.push(csvCell(campus ? schoolHeading(campus) : result.campusHeading));
  lines.push(csvCell(titleInCapitals(result) ? printTitle(result).toUpperCase() : printTitle(result)));
  lines.push(csvCell(filterLine(result.subtitle, filters).map(([l, v]) => (l ? `${l} : ${v}` : v)).join("   ")));
  lines.push(csvCell(`Prepared by ${result.generatedBy} on ${formatDate(result.generatedAt)}`));
  lines.push("");
  // the running number of the printed report ("Sr. No."), counting again after each subtotal line ("Total :")
  const serial = serialLabel(result);
  let n = 0;
  lines.push([...(serial ? [csvCell(serial)] : []), ...result.columns.map((c) => csvCell(c.label))].join(","));
  for (const row of result.rows) {
    const sub = Boolean(row[REPORT_SUBTOTAL_KEY]);
    const no = sub ? "Total :" : String(++n);
    if (sub) n = 0;
    lines.push(
      [
        ...(serial ? [no] : []),
        ...result.columns.map((c) => {
          const v = row[c.key];
          if (v === null || v === undefined) return "";
          if (typeof v === "number") return String(v);
          return csvCell(c.kind === "date" ? cellText(v, "date") : v);
        }),
      ].join(","),
    );
  }
  if (result.totals)
    lines.push(
      [...(serial ? ["Grand Total :"] : []), ...result.columns.map((c, i) => (c.key in result.totals! ? String(result.totals![c.key]) : i === 0 && !serial ? "Grand Total :" : ""))].join(","),
    );
  for (const n of result.notes ?? []) lines.push(csvCell(n));
  return `﻿${lines.join("\r\n")}`;
}

/** Saves a file through the browser's normal download. */
export function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadExcel(result: ReportResult, campus: string, filters?: ReportFilterDef[]) {
  download(`${fileBase(result, campus)}.csv`, toCsv(result, campus, filters), "text/csv;charset=utf-8");
}
