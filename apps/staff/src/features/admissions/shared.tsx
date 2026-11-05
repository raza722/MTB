import { ADMISSIONS_STAGE_LABEL, admissionsQueries, type AdmissionsApplicant, type AdmissionsStage } from "@mtb/api";
import { formatDate } from "@mtb/domain";
import { StatusBadge, type Status } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { SubNav } from "../../app/shell/SubNav";
import { useCtx } from "../../app/session";

/** Today in the Admissions demo (the mock server's clock). Admissions is still mocked; it moves to the real date with its module. */
export const TODAY = "2026-11-04";

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

/** "88 / 100" — or what's next when there is no score yet. */
export function scoreText(a: AdmissionsApplicant): string {
  if (a.testScore !== null) return `${a.testScore} / ${a.testMax}`;
  if (a.absentFromTest) return "Absent from the test";
  if (a.directAdmission) return "No test for this class";
  if (a.testDate) return `Test on ${formatDate(a.testDate)}`;
  return "Not tested yet";
}

export const relationName = (a: Pick<AdmissionsApplicant, "relation" | "father">) => `${a.relation} ${a.father}`;

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
    (digits.length >= 4 && (a.fatherCnic.includes(digits) || a.mobile.includes(digits) || (a.bForm ?? "").includes(digits)))
  );
}

/** "Ends today", "Ends in 2 days", "Ended 3 days ago". */
export function offerDeadline(until: string | undefined, today = "2026-11-04"): { text: string; urgent: boolean } | null {
  if (!until) return null;
  const days = Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
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
