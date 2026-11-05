import type { ReportResult } from "@mtb/api";
import { cellText } from "./shell";

/** "daily-fee-collection-summary-kc-04-nov-2026" */
export function fileBase(result: ReportResult, campus: string): string {
  const slug = result.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `${slug}-${campus === "ALL" ? "all-campuses" : campus.toLowerCase()}-${result.generatedAt.slice(0, 10)}`;
}

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/**
 * The report as a CSV file that opens in Excel (UTF-8 with a byte-order mark, so Urdu names survive).
 * Numbers are written plain (no "Rs", no commas) so Excel can add them up.
 */
export function toCsv(result: ReportResult): string {
  const lines: string[] = [];
  lines.push(csvCell(result.campusHeading));
  lines.push(csvCell(result.title));
  lines.push(csvCell(result.subtitle));
  lines.push(csvCell(`Prepared by ${result.generatedBy} on ${result.generatedAt.slice(0, 10)}`));
  lines.push("");
  lines.push(result.columns.map((c) => csvCell(c.label)).join(","));
  for (const row of result.rows) {
    lines.push(
      result.columns
        .map((c) => {
          const v = row[c.key];
          if (v === null || v === undefined) return "";
          if (typeof v === "number") return String(v);
          return csvCell(c.kind === "date" ? cellText(v, "date") : v);
        })
        .join(","),
    );
  }
  if (result.totals) lines.push(result.columns.map((c, i) => (i === 0 ? "Total" : c.key in result.totals! ? String(result.totals![c.key]) : "")).join(","));
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

export function downloadExcel(result: ReportResult, campus: string) {
  download(`${fileBase(result, campus)}.csv`, toCsv(result), "text/csv;charset=utf-8");
}
