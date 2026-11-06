import { ADMISSIONS_STAGE_LABEL, admissionsQueries, type AdmissionsApplicant, type AdmissionsStage, type AdmissionsTest } from "@mtb/api";
import { formatDate, formatMobile, formatRs, type IsoDate } from "@mtb/domain";
import { StatusBadge, type Status } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { SubNav } from "../../app/shell/SubNav";
import { useCtx } from "../../app/session";
import { today } from "../students/shared";

export { dateOrBlank, today } from "../students/shared";

const STAGE_STATUS: Record<AdmissionsStage, Status> = { APPLIED: "neutral", TEST: "info", MERIT: "pending", OFFERED: "warning", ADMITTED: "success", WITHDRAWN: "cancelled" };

export function StageBadge({ stage }: { stage: AdmissionsStage }) {
  return <StatusBadge status={STAGE_STATUS[stage]}>{ADMISSIONS_STAGE_LABEL[stage]}</StatusBadge>;
}

/** Talent-test takers: applicants from other schools, not students until admitted. */
export function DiamondMindsBadge() {
  return (
    <StatusBadge status="neutral" icon="award" title="Took the Diamond Minds talent test">
      Diamond Minds
    </StatusBadge>
  );
}

/** "88 / 100", or "—" when there is no complete score (or no paper total to score against). */
export function scoreOf(a: Pick<AdmissionsApplicant, "testScore" | "testMax">, sep = " / "): string {
  return a.testScore !== null && a.testMax ? `${a.testScore}${sep}${a.testMax}` : "—";
}

/** Score as a share of the papers' total, 0–1; null without a complete score or a total (never a 0 base). */
export function scoreShare(a: Pick<AdmissionsApplicant, "testScore" | "testMax">): number | null {
  return a.testScore !== null && a.testMax ? a.testScore / a.testMax : null;
}

/** A text the record may not have (most migrated applicants have no father's name, mobile or address): "—". */
export const orDash = (v: string | null | undefined): string => (v?.trim() ? v : "—");

/** "0300-1234567", or "—" when there is no mobile on record. */
export const mobileOrDash = (m: string | null | undefined): string => (m?.trim() ? formatMobile(m) : "—");

/** An amount Fees has not set yet (null, or 0 until module 6) reads "—", not "Rs 0". */
export const feeOrDash = (amount: number | null | undefined): string => (amount ? formatRs(amount) : "—");

/** "07-Nov-2026, 9:00 am" (the time only when the sitting has one; migrated sittings have none). */
export const sittingWhen = (t: Pick<AdmissionsTest, "date" | "time">): string => `${formatDate(t.date)}${t.time ? `, ${t.time}` : ""}`;

/** "07-Nov-2026, 9:00 am · Examination hall" (venue only when recorded). */
export const sittingWhenWhere = (t: Pick<AdmissionsTest, "date" | "time" | "venue">): string => `${sittingWhen(t)}${t.venue ? ` · ${t.venue}` : ""}`;

/** "88 / 100" — or what's next when there is no score yet. */
export function scoreText(a: AdmissionsApplicant): string {
  if (a.testScore !== null && a.testMax) return `${a.testScore} / ${a.testMax}`;
  if (a.absentFromTest) return "Absent from the test";
  if (a.directAdmission) return "No test for this class";
  if (a.testDate) return `${a.testDate > today() ? "Test on" : "Tested"} ${formatDate(a.testDate)}${a.testScore === null ? (a.testDate > today() ? "" : " · not marked yet") : ""}`;
  return "Not tested yet";
}

/** "s/o Faisal Nawaz", or "" when no father is on record (most migrated applicants). */
export const relationName = (a: Pick<AdmissionsApplicant, "relation" | "father">) => (a.father.trim() ? `${a.relation} ${a.father}` : "");

/** Saves rows as a CSV file (Excel opens it; the byte-order mark keeps Urdu and symbols intact). */
export function downloadCsv(fileName: string, header: string[], rows: Array<Array<string | number | null | undefined>>) {
  const esc = (v: string | number | null | undefined) => {
    const t = v === null || v === undefined ? "" : String(v);
    return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const text = [header.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\r\n");
  const url = URL.createObjectURL(new Blob([`﻿${text}`], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Matches an applicant by name, application no., father, father's CNIC or mobile (digits only for numbers). */
export function matchesApplicant(a: AdmissionsApplicant, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  const digits = t.replace(/\D/g, "");
  return (
    a.name.toLowerCase().includes(t) ||
    a.father.toLowerCase().includes(t) ||
    a.applicationNo.toLowerCase().includes(t) ||
    (digits.length >= 4 && (a.fatherCnic.includes(digits) || a.mobile.replace(/\D/g, "").includes(digits) || (a.bForm ?? "").includes(digits)))
  );
}

/** "Ends today", "Ends in 2 days", "Ended 3 days ago" (none for offers without an expiry, e.g. migrated ones). */
export function offerDeadline(until: IsoDate | undefined, on: IsoDate = today()): { text: string; urgent: boolean } | null {
  if (!until) return null;
  const days = Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${on}T00:00:00Z`)) / 86_400_000);
  if (days < 0) return { text: `Offer ended ${-days} ${days === -1 ? "day" : "days"} ago`, urgent: true };
  if (days === 0) return { text: "Offer ends today", urgent: true };
  return { text: `Offer ends in ${days} ${days === 1 ? "day" : "days"}`, urgent: days <= 2 };
}

/** Admissions pages as tabs under the page header. */
export function AdmissionsSubNav() {
  const ctx = useCtx();
  const dups = useQuery(admissionsQueries.duplicates(ctx));
  const n = dups.data?.cases.length ?? 0;
  return (
    <SubNav
      label="Admissions"
      items={[
        { to: "/admissions", label: "Overview", icon: "admissions", exact: true },
        { to: "/admissions/enquiries", label: "Enquiries", icon: "phone" },
        { to: "/admissions/new", label: "New application", icon: "plus" },
        { to: "/admissions/tests", label: "Entrance tests", icon: "edit" },
        { to: "/admissions/merit", label: "Merit list", icon: "listChecks" },
        { to: "/admissions/offers", label: "Offers & admission", icon: "checkCircle" },
        { to: "/admissions/duplicates", label: n ? `Possible duplicates · ${n}` : "Possible duplicates", icon: "merge" },
      ]}
    />
  );
}
