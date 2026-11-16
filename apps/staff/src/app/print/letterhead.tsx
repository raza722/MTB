import type { CampusCode } from "@mtb/api";
import "./letterhead.css";
import type { ReactNode } from "react";
import crest from "../../assets/mtb-crest.png";

/**
 * The letterhead and footer of every printed document, as the old desktop system printed them (its report designs and
 * tbl0_01InstituteInfo.InstituteHeading): the Madrasat-ul-Banat crest on the left, then
 * "MTB-Madrasat-ul-Banat Schools and Colleges, Khalid Campus, Sadikabad" in bold, the document's title under it,
 * and at the foot of every page "Print DateTime 11/3/2026 4:28:21 PM" on the left and "Page No 1 of 2" on the right.
 */
export const SCHOOL_NAME = "MTB-Madrasat-ul-Banat Schools and Colleges";
export const SCHOOL_TITLE = "MTB, MADRASAT-UL-BANAT SCHOOLS AND COLLEGES";
export const CREST_SRC = crest;

const CAMPUS: Record<string, { name: string; city?: string }> = {
  KC: { name: "Khalid Campus", city: "Sadikabad" },
  SM: { name: "Sugar Mill Campus" },
  UC: { name: "Ubaid Campus" },
  MC: { name: "Majeed Campus" },
  HC: { name: "Humaira Campus", city: "Lahore" },
};

/** "Khalid Campus, Sadikabad" (the old heading's campus part); a campus name passed in wins over the built-in one. */
export function campusPlace(campus: CampusCode | string, campusName?: string): string {
  const c = CAMPUS[campus];
  const name = campusName && campusName !== campus ? campusName.replace(/,.*$/, "") : (c?.name ?? campus);
  return c?.city ? `${name}, ${c.city}` : name;
}

/** The old printed heading: "MTB-Madrasat-ul-Banat Schools and Colleges, Khalid Campus, Sadikabad". */
export function schoolHeading(campus: CampusCode | string, campusName?: string): string {
  return campus === "ALL" ? SCHOOL_NAME : `${SCHOOL_NAME}, ${campusPlace(campus, campusName)}`;
}

/** "11/3/2026 4:28:21 PM", the old footer's date and time format (Pakistan time). */
export function printStamp(d: Date = new Date()): string {
  return d.toLocaleString("en-US", { timeZone: "Asia/Karachi", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true }).replace(",", "");
}

const cssText = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * The old footer as @page margin boxes, to put inside an @page rule: "Print DateTime …" bottom left and
 * "Page No x of y" bottom right on every printed page. `note` replaces the left text when a document needs its own.
 */
export function footerBoxes(note?: string, opts: { pageNoLeft?: boolean } = {}): string {
  const stamp = `content: ${cssText(note ?? `Print DateTime ${printStamp()}`)}; font: 8pt Arial, sans-serif; color: #000;`;
  const pageNo = `content: "Page No " counter(page) " of " counter(pages); font: 8pt Arial, sans-serif; color: #000;`;
  // the old library reports printed the page number on the left and the print time on the right
  return opts.pageNoLeft
    ? ` @bottom-left { ${pageNo} } @bottom-right { ${stamp} }`
    : ` @bottom-left { ${stamp} } @bottom-right { ${pageNo} }`;
}

/**
 * The old letterhead. `variant`:
 *  - "report" (default): crest at the left, the heading centred and bold, the title centred under it, an optional
 *    line under that (class, merit list…), as on the old reports;
 *  - "certificate": crest centred above the heading, for certificates and letters;
 *  - "slip": a smaller crest and heading for slips several to a page.
 */
export function Letterhead({ campus, campusName, title, sub, variant = "report", right, titleCase = "upper" }: {
  campus: CampusCode | string;
  campusName?: string;
  title?: ReactNode;
  sub?: ReactNode;
  variant?: "report" | "certificate" | "slip";
  /** Something to show at the top right (a reference number, a photo box…). */
  right?: ReactNode;
  /** "upper" (default) prints the title in capitals as most old reports did; "as-is" keeps it as written ("Journal Voucher"). */
  titleCase?: "upper" | "as-is";
}) {
  const heading = schoolHeading(campus, campusName);
  const titleClass = titleCase === "as-is" ? "mtb-lh-title mtb-lh-title-asis" : "mtb-lh-title";
  if (variant === "certificate")
    return (
      <header className="mtb-lh mtb-lh-cert">
        <img src={crest} alt="" className="mtb-lh-crest" />
        <div className="mtb-lh-heading">{heading}</div>
        {title && <div className={titleClass}>{title}</div>}
        {sub && <div className="mtb-lh-sub">{sub}</div>}
        {right && <div className="mtb-lh-right">{right}</div>}
      </header>
    );
  return (
    <header className={variant === "slip" ? "mtb-lh mtb-lh-slip" : "mtb-lh"}>
      <img src={crest} alt="" className="mtb-lh-crest" />
      <div className="mtb-lh-text">
        <div className="mtb-lh-heading">{heading}</div>
        {title && <div className={titleClass}>{title}</div>}
        {sub && <div className="mtb-lh-sub">{sub}</div>}
      </div>
      {right ? <div className="mtb-lh-right">{right}</div> : <span className="mtb-lh-crest-space" aria-hidden />}
    </header>
  );
}
