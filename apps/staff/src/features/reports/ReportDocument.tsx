import { REPORT_SUBTOTAL_KEY, type ReportCell, type ReportColumnDef, type ReportFilterDef, type ReportResult } from "@mtb/api";
import { useEffect, useState } from "react";
import { footerBoxes, Letterhead } from "../../app/print/letterhead";
import { StudentPhoto } from "../../app/print/photo";
import { cellText } from "./shell";

/** Counts, percentages and dates sit in the middle of their cells and money on the right, as on the old reports. */
const CENTRED = new Set(["count", "percent", "date"]);
const cellClass = (c: ReportColumnDef) =>
  c.kind === "money" ? "num" : CENTRED.has(c.kind) || /^d\d\d$/.test(c.key) ? "mid" : c.kind === "blank" ? "rpt-blank-cell" : c.kind === "mono" ? "nw" : undefined;

/**
 * The old reports start nearly every table with a running number. Every printed report gets it as the first column
 * ("Sr. No." unless the old report worded it otherwise, listed here); it counts the detail lines and starts again
 * after each subtotal line (one group). Reports whose rows already carry their own number (Sr., rank) and those in
 * NO_SERIAL (a timetable's rows are days; the positions list is numbered by its Position column) do not get it.
 */
const SERIAL_DEFAULT = "Sr. No.";
const OWN_NUMBER = new Set(["sr", "rank"]);
const NO_SERIAL = new Set(["tt-class", "exam-positions"]);
const SERIAL: Record<string, string> = {
  "students-list": "Sr.#",
  "students-register": "Sr.#",
  "students-new-admissions": "Sr.#",
  "students-left": "Sr.#",
  "students-siblings": "Sr.#",
  "portal-accounts": "Sr #",
  "adm-candidates": "Sr. No",
  "adm-test-appearance": "Sr.#",
  "att-monthly-register": "Sr.#",
  "att-leave": "Sr.#",
  "att-low": "Sr.#",
  "exam-master-sheet": "Sr.#",
  "exam-failed": "Sr.#",
  "exam-tests-cumulative": "Sr. No.",
  "exam-subject-tests": "Sr.#",
  "hr-staff-list": "Sr#",
  "hr-staff-attendance": "Sr. #",
  "hr-salary-sheet": "Sr.#",
  "hr-loans": "SNO",
  "hr-increments": "Sr #",
  "hr-leave": "Sr.#",
  "msg-log": "Sr.No",
  "lib-issued": "Sr #",
  "lib-catalogue": "Sr #",
  "wh-stock": "Sr #",
  "wh-issued": "Sr #",
  "wh-purchases": "Sr #",
  "trn-riders": "Sr.#",
};

/** The running-number column's heading for this report, or null when it has none (see SERIAL). */
export function serialLabel(result: ReportResult): string | null {
  if (NO_SERIAL.has(result.reportId) || result.columns.some((c) => OWN_NUMBER.has(c.key))) return null;
  return SERIAL[result.reportId] ?? SERIAL_DEFAULT;
}

/** The old date stamp: "04-Nov-2026". */
const DAY = /\d{2}-[A-Z][a-z]{2}-\d{4}/.source;

/**
 * The line of report parameters under the title, as the old reports printed them ("Class : Nine   Merit List : Ist
 * Merit List", "Date From : 01-Apr-2026   Date To : 02-Nov-2026"). Built from the server's subtitle
 * ("Khalid Campus · Session 2026–27 · 01-Apr-2026 to 02-Nov-2026 · Class 9 · Girls · 46 students"): the campus is
 * dropped (it is in the heading) and each filter gets its label back; a select filter's choice is matched to the
 * filter it came from. Anything else (the report's own extras) prints as it is.
 */
export function filterLine(subtitle: string, filters: ReportFilterDef[] = []): Array<[string | null, string]> {
  const out: Array<[string | null, string]> = [];
  const parts = subtitle.split(" · ").slice(1);
  for (const p of parts) {
    let m: RegExpMatchArray | null;
    // the exam reports repeat the chosen exam's id ("781"): the exam's title follows, so the id is left out (test run F-149)
    if (/^\d+$/.test(p) && filters.some((x) => x.key === "exam")) continue;
    // the same for a bank account's code ("1102") when another part names it ("Bank account: 1102 Hbl Bank")
    if (/^\d+$/.test(p) && parts.some((q) => q !== p && q.includes(`${p} `))) continue;
    if ((m = p.match(/^Session (.+)$/))) out.push(["Session", m[1]!]);
    else if ((m = p.match(new RegExp(`^(${DAY}) to (${DAY})$`)))) out.push(["Date From", m[1]!], ["Date To", m[2]!]);
    else if (new RegExp(`^${DAY}$`).test(p)) out.push([filters.find((f) => f.kind === "date")?.label ?? "Date", p]);
    else if ((m = p.match(new RegExp(`^(.+) (${DAY})$`)))) out.push([m[1]!, m[2]!]);
    else if ((m = p.match(/^(Class|Section) (.+)$/))) out.push([m[1]!, m[2]!]);
    else if (p === "Prep" || p === "Play") out.push(["Class", p]);
    else if (p === "Girls" || p === "Boys") out.push(["Gender", p]);
    else {
      const f = filters.find((x) => (x.kind === "select" || x.kind === "month") && x.options?.some((o) => o.label === p));
      if (f) out.push([f.label, p]);
      else if ((m = p.match(/^([^:]{1,40}): (.+)$/))) out.push([m[1]!, m[2]!]);
      // the exam reports name the exam they show first among their own extras ("Exam : MID TERM/SEMESTER" on the old ones)
      else if (filters.some((x) => x.key === "exam") && !out.some(([l]) => l === "Exam")) out.push(["Exam", p]);
      else out.push([null, p]);
    }
  }
  // a report's own extras can repeat a filter ("Class 9" twice on the exam reports): print each once
  // (the exam reports also name their exam twice once the filter summary names it: print each value once)
  return out.filter(([, v], i) => out.findIndex(([, v2]) => v2 === v) === i);
}

/**
 * The old report's own title where it differs from the report's name in the catalogue (printed in capitals). Several
 * old reports became one new report: the filters pick the old title ("Expelled Students" when the report is of
 * expulsions, "Top Three Positions" for the top 3, student- or staff-wise book issuance).
 */
export function printTitle(result: ReportResult): string {
  const parts = result.subtitle.split(" · ");
  const has = (p: string) => parts.includes(p);
  const session = parts.find((p) => p.startsWith("Session "))?.slice(8) ?? "";
  switch (result.reportId) {
    case "students-new-admission-count":
      return "New Admission Report";
    case "students-new-admissions":
      return "New Admission List";
    case "students-register":
      return "Students List (General)";
    case "students-list":
      return "Register Report";
    case "students-group-wise":
      return "Group/Subject wise List";
    case "students-strength":
      return `Student Count Summary - Session: ${session}`;
    case "students-left":
      return has("Expelled") ? "Expelled Students" : result.title;
    case "students-ptm-sheet":
      return "Parents/Teachers Meeting";
    case "students-siblings":
      return "Sibling Report";
    case "portal-accounts":
      return "Android App Students LogIn Credentials";
    case "adm-candidates":
      return "Candidate Detail";
    case "adm-merit":
      return "Pre-Entrance Test Merit List";
    case "adm-test-appearance":
      return "Pre-Entrance Test Appearance";
    case "att-monthly-register":
      return "Attendance Register";
    case "exam-master-sheet":
      return `Master Sheet For Session ${session}`;
    case "exam-positions":
      return has("Top 3") ? "Top Three Positions (Exam Wise)" : has("Top 10") ? "Top Ten Positions (Class-Wise)" : "Top Positions (Class-Wise)";
    case "exam-failed":
      return "Failed Students";
    case "exam-subject-analysis":
      return "Class-wise Subject Performance Report";
    case "exam-tests-cumulative":
      return "Student Academic History Report";
    case "tt-class":
      return "Class Time Table";
    case "hr-staff-list":
      return "Bio Data Report";
    case "hr-staff-attendance":
      return "Staff Monthly Attendance Report";
    case "hr-leave":
      return "Staff Leave Report";
    case "hr-loans":
      return "Advance Salary Report";
    case "hr-increments":
      return "Staff Salary Increment";
    case "hr-salary-sheet":
      return "Staff Salary Report";
    case "msg-log":
      return "SMS Log Report";
    case "lib-issued":
      return `Book Issuance History Report${has("Students") ? " (Student Wise)" : has("Staff") ? " (Staff Wise)" : ""}`;
    case "wh-stock":
      return "Ware House Current Stock Report";
    case "wh-issued":
      return "Ware House Items Issuance Report";
    case "wh-purchases":
      return "Ware House Purchase Invoice Report";
    // the fee and accounts reports (their procs are another helper's; the title is the print's): the closest old report
    case "fee-daily-summary":
      return "Daily Fee Summary";
    case "fee-collection-period":
      return "Fee Collection";
    case "fee-collection-heads":
      return "Fee Collection Report (Head Wise)";
    case "fee-class-arrears":
      return "Class Wise Arrears Report";
    case "fee-student-arrears":
      return "Student Wise Arrears Report";
    case "fee-cancellations":
      return "Daily Fee Cancel Report";
    case "fee-concessions":
      return "Student Scholarship/Discount Report";
    case "fee-concessions-class":
      return "Class Wise Discount Report";
    case "fee-candidate":
      return "Candidate Fee Collection Report";
    case "fee-student-ledger":
      return "Student Annual Fee Card";
    case "fee-receipt-register":
      return "Student Fee Submission Report";
    case "acc-bank-book":
      return "Bank Ledger";
    case "acc-cash-book":
      return "Cash Ledger";
    case "acc-trial-balance":
      return "Trial Balance Level Wise";
    default:
      return result.title;
  }
}

/**
 * Old titles printed in capitals ("PRE-ENTRANCE TEST MERIT LIST", "BANK LEDGER"); the others kept their own capitals
 * ("New Admission List"). A report with no old title of its own (the catalogue name) prints in capitals.
 */
const UPPER_TITLE = new Set(["adm-merit", "adm-test-appearance", "adm-candidates", "acc-bank-book", "acc-cash-book"]);
export function titleInCapitals(result: ReportResult): boolean {
  return UPPER_TITLE.has(result.reportId) || printTitle(result) === result.title;
}

/** Signature lines the old report printed under its table, for reports whose result brings none. */
const SIGNATURES: Record<string, string[]> = {
  "wh-stock": ["Store Incharge", "Sr. Vice Principal", "Principal"],
  "wh-issued": ["Store Incharge", "Sr. Vice Principal", "Principal"],
  "wh-purchases": ["Store Incharge", "Sr. Vice Principal", "Principal"],
  "att-monthly-register": ["Sign. Vice Principal"],
};

/** Old reports printed on their side: subjects across the top, the figures down the side ("Class-wise Subject Performance"). */
const TRANSPOSE: Record<string, string> = { "exam-subject-analysis": "subject" };

/** Narrow columns whose heading the old master sheet printed turned on its side. */
const VERTICAL: Record<string, RegExp> = { "exam-master-sheet": /^(s-\d+|group|roll|total|max|percent|grade|position)$/ };

/** "11/3/2026 4:28:21 PM" at the moment of printing: the footer is refreshed when the print dialog opens. */
function usePrintFooter(): string {
  const [css, setCss] = useState(() => footerBoxes());
  useEffect(() => {
    const refresh = () => setCss(footerBoxes());
    window.addEventListener("beforeprint", refresh);
    return () => window.removeEventListener("beforeprint", refresh);
  }, []);
  return css;
}

const text = (r: Record<string, ReportCell>, c: ReportColumnDef) => (c.kind === "blank" ? "" : cellText(r[c.key] ?? null, c.kind));

/** The ordinary report table: header row repeated on every page, the totals line at the end. */
function Table({ result }: { result: ReportResult }) {
  const serial = serialLabel(result);
  const showSerial = serial !== null;
  const vertical = VERTICAL[result.reportId];
  let n = 0;
  return (
    <table>
      <thead>
        <tr>
          {showSerial && <th className="sr">{serial}</th>}
          {result.columns.map((c) => (
            <th key={c.key} className={vertical?.test(c.key) ? "vert" : undefined}>
              {vertical?.test(c.key) ? <span>{c.label}</span> : c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {result.rows.map((r, i) => {
          const sub = Boolean(r[REPORT_SUBTOTAL_KEY]);
          // a subtotal line closes its group: "Total :" as on the old reports, and the next group counts from 1
          const no = sub ? "Total :" : ++n;
          if (sub) n = 0;
          return (
            <tr key={i} className={sub ? "rpt-subtotal" : undefined}>
              {showSerial && <td className="sr">{no}</td>}
              {result.columns.map((c) =>
                c.kind === "photo" ? (
                  <td key={c.key} className="rpt-photo-cell">
                    {!sub && <StudentPhoto grNo={typeof r[c.key] === "string" ? (r[c.key] as string) : null} className="rpt-photo" />}
                  </td>
                ) : (
                  <td key={c.key} className={cellClass(c)} {...(c.kind === "urdu" ? { lang: "ur", dir: "rtl" } : {})}>
                    {text(r, c)}
                  </td>
                ),
              )}
            </tr>
          );
        })}
      </tbody>
      {result.totals && (
        <tfoot>
          <tr>
            {showSerial && <td className="sr">Grand Total :</td>}
            {result.columns.map((c, i) => (
              <td key={c.key} className={cellClass(c)}>
                {c.key in result.totals! ? cellText(result.totals![c.key]!, c.kind) : i === 0 && !showSerial ? "Grand Total :" : ""}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  );
}

/** The table turned on its side: one column per row of the result, one line per figure. */
function SideTable({ result, keyCol }: { result: ReportResult; keyCol: string }) {
  const head = result.columns.find((c) => c.key === keyCol)!;
  const rows = result.rows.filter((r) => !r[REPORT_SUBTOTAL_KEY]);
  return (
    <table className="rpt-side">
      <thead>
        <tr>
          <th>{head.label}</th>
          {rows.map((r, i) => (
            <th key={i}>{text(r, head)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {result.columns
          .filter((c) => c.key !== keyCol)
          .map((c) => (
            <tr key={c.key}>
              <th>{c.label}</th>
              {rows.map((r, i) => (
                <td key={i} className={c.kind === "text" ? undefined : "mid"}>
                  {text(r, c)}
                </td>
              ))}
            </tr>
          ))}
      </tbody>
    </table>
  );
}

/**
 * The old "Address Post": one label per student (Student Name - G.R. No., Father Name, Class, Address, Contact), with
 * a cut line between labels and no letterhead.
 */
function AddressLabels({ result }: { result: ReportResult }) {
  const v = (r: Record<string, ReportCell>, k: string) => String(r[k] ?? "");
  return (
    <div className="rpt-labels">
      {result.rows.map((r, i) => (
        <dl key={i} className="rpt-label">
          <dt>Student Name:</dt>
          <dd>
            {v(r, "student")}
            {v(r, "grNo") && ` - ${v(r, "grNo")}`}
          </dd>
          <dt>{v(r, "relation") && v(r, "relation") !== "Father" ? `Guardian (${v(r, "relation")}):` : "Father Name:"}</dt>
          <dd>{v(r, "guardian")}</dd>
          <dt>Class:</dt>
          <dd>{v(r, "classSection")}</dd>
          <dt>Address:</dt>
          <dd>{v(r, "address")}</dd>
          <dt>Contact:</dt>
          <dd>{v(r, "mobile")}</dd>
        </dl>
      ))}
    </div>
  );
}

/**
 * The printable report, laid out like the old desktop reports: the letterhead (crest and "MTB-Madrasat-ul-Banat
 * Schools and Colleges, Khalid Campus, Sadikabad"), the old title (in capitals where the old one was), the line of parameters, then the ruled
 * table with its header row repeated on every page, the old signature lines, and "Print DateTime … / Page No x of y"
 * at the foot of each page. A4 portrait or landscape. Hidden on screen; only it prints, and "Save as PDF" in the
 * print dialog gives the PDF. An empty value prints an empty cell, as the old reports did.
 */
export function ReportDocument({ result, landscape, campus, filters }: { result: ReportResult; landscape: boolean; campus: string; filters?: ReportFilterDef[] }) {
  const footer = usePrintFooter();
  const params = filterLine(result.subtitle, filters);
  const labels = result.reportId === "students-contacts";
  const side = TRANSPOSE[result.reportId];
  const signatures = result.signatures?.length ? result.signatures : SIGNATURES[result.reportId];
  return (
    <div className={`rpt-print-only mtb-print-area ${landscape ? "rpt-landscape" : "rpt-portrait"}`} aria-hidden="true">
      <style>{`@page { size: A4 ${landscape ? "landscape" : "portrait"}; margin: ${landscape ? "7mm 7mm 10mm" : "8mm 8mm 11mm"}; ${footer} }`}</style>
      <div className={result.ruled ? "rpt-doc rpt-ruled" : "rpt-doc"}>
        {labels ? (
          <AddressLabels result={result} />
        ) : (
          <>
            <Letterhead campus={campus} title={printTitle(result)} titleCase={titleInCapitals(result) ? "upper" : "as-is"} />
            {params.length > 0 && (
              <div className="rpt-params">
                {params.map(([label, value], i) => (
                  <span key={i}>
                    {label && <b>{label} :</b>} {value}
                  </span>
                ))}
              </div>
            )}
            {side && result.columns.some((c) => c.key === side) ? <SideTable result={result} keyCol={side} /> : <Table result={result} />}
            {result.notes?.map((n) => (
              <p key={n} className="rpt-note">
                {n}
              </p>
            ))}
            {signatures?.length ? (
              <div className="rpt-signatures">
                {signatures.map((s) => (
                  <span key={s}>{s}</span>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
