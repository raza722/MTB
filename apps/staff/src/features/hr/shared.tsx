import { ApiError, HR_CATEGORY_LABEL, HR_EMPLOYMENT_LABEL, hrMonthLabel, hrQueries, type CampusCode, type HrCategory, type HrLeaveStatus, type HrLoanStatus, type HrMonth, type HrPayrollStatus, type HrRunStatus, type HrStaffSummary } from "@mtb/api";
import { formatCnic, formatDate, formatMobile, formatRs, formatSession, pakistanToday, type IsoDate } from "@mtb/domain";
import { Banner, Button, Select, StatusBadge, type ComboboxOption } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { campusLabel } from "../../app/shell/campus";
import { Page, PageHeader } from "../../app/shell/page";
import { SubNav, type SubNavItem } from "../../app/shell/SubNav";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import "./hr.css";

/** Today in Pakistan ("2026-11-06"). Only for form defaults and limits; the server decides. */
export const today = (): IsoDate => pakistanToday();
/** This month in Pakistan ("2026-11"). */
export const thisMonth = (): HrMonth => today().slice(0, 7);
/** The session (April to March, by its start year) a date falls in: "2027-02-10" → 2026. */
export function sessionOf(date: IsoDate): number {
  const y = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 4 ? y : y - 1;
}
/** Last month in Pakistan ("2026-10"). */
export const lastMonth = (): HrMonth => addMonths(thisMonth(), -1);
/** "2026-11" + 1 → "2026-12". */
export function addMonths(month: HrMonth, n: number): HrMonth {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}
/** The last calendar day of a month: "2026-11" → "2026-11-30". */
export function monthEnd(month: HrMonth): IsoDate {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

/** Pay, bank details, loans and salary sheets: the accountant (payroll) and the principal (approvals). */
export function usePayAccess(): boolean {
  const payroll = useCan("payroll.manage");
  const approve = useCan("approvals.decide");
  return payroll || approve;
}

/** Staff & payroll pages under every page header. Pay pages are left out for roles that can't see pay. */
export function HrNav() {
  const pay = usePayAccess();
  const items: SubNavItem[] = [
    { to: "/hr", label: "Staff", icon: "hr", exact: true },
    { to: "/hr/attendance", label: "Attendance", icon: "clock" },
    { to: "/hr/leave", label: "Leave", icon: "calendar" },
    ...(pay
      ? [
          { to: "/hr/payroll", label: "Payroll", icon: "fees" as const },
          { to: "/hr/increments", label: "Increments", icon: "trendUp" as const },
          { to: "/hr/loans", label: "Loans and advances", icon: "receipt" as const },
        ]
      : []),
    { to: "/hr/reports", label: "Reports", icon: "file" },
    { to: "/hr/settings", label: "Settings", icon: "settings" },
  ];
  return <SubNav label="Staff and payroll" items={items} />;
}

/** Page frame: header with campus and session, the module tabs, then the content. */
export function HrShell({ title, context, actions, meta, children }: { title: string; context?: ReactNode; actions?: ReactNode; meta?: ReactNode; children: ReactNode }) {
  const readOnly = useReadOnly();
  const { session } = useCtx();
  return (
    <Page>
      <PageHeader
        title={title}
        {...(context !== undefined ? { context } : {})}
        {...(actions ? { actions } : {})}
        meta={
          meta || readOnly ? (
            <>
              {meta}
              {readOnly && (
                <StatusBadge status="neutral" icon="lock">
                  Session {formatSession(session)} is closed · read-only
                </StatusBadge>
              )}
            </>
          ) : undefined
        }
      />
      <HrNav />
      {children}
    </Page>
  );
}

/** Plain-English text for a failed request. */
export const errorText = (e: unknown) => (e instanceof ApiError ? (e.isNetwork ? "No response from the server; nothing was changed. Try again." : e.message) : "Something went wrong. Try again.");
export const errorField = (e: unknown) => (e instanceof ApiError ? e.field : undefined);

export function LoadError({ what, error, onRetry }: { what: string; error: unknown; onRetry: () => void }) {
  return (
    <Banner
      tone="danger"
      title={`${what} couldn't be loaded.`}
      actions={
        <Button size="sm" icon="refresh" onClick={onRetry}>
          Try again
        </Button>
      }
    >
      {errorText(error)}
    </Banner>
  );
}

/** Stagger style for list rows (.mtb-slide-in). */
export const slide = (i: number) => ({ "--i": Math.min(i, 14) }) as CSSProperties;

/** A value that may be missing on migrated records ("" or null): shown as "—". */
export const orDash = (v: string | null | undefined) => (v && v.trim() ? v : "—");
/** A date that may be missing on migrated records (date of birth): shown as "—". */
export const dateOrDash = (v: IsoDate | null | undefined) => (v ? formatDate(v) : "—");
/** CNIC / mobile that may be "" on migrated records: shown as "—". */
export const cnicOrDash = (v: string | null | undefined) => (v ? formatCnic(v) : "—");
export const mobileOrDash = (v: string | null | undefined) => (v ? formatMobile(v) : "—");
/** Basic pay (or pay worked out from it): 0 means "no salary set yet" (migrated staff), shown as "—" rather than "Rs 0". */
export const basicRs = (n: number | null | undefined) => (n ? formatRs(n) : "—");

export const years = (n: number) => `${n.toFixed(1)} ${n === 1 ? "year" : "years"}`;
export const categoryLabel = (c: HrCategory) => HR_CATEGORY_LABEL[c];
export const employmentLabel = HR_EMPLOYMENT_LABEL;
export { hrMonthLabel as monthLabel };

/** "Every designation" filter (legacy "Staff Type"), fed from Settings → Designations. */
export function DesignationSelect({ value, onChange, label, className = "w-48" }: { value: string; onChange: (id: string) => void; label?: string; className?: string }) {
  const settings = useQuery(hrQueries.settings());
  const options = (settings.data?.designations ?? []).filter((d) => d.active || d.id === value).map((d) => ({ value: d.id, label: d.title }));
  return (
    <div className={className}>
      <Select {...(label ? { label } : { "aria-label": "Designation" })} value={value} onChange={(e) => onChange(e.target.value)} options={[{ value: "", label: "Every designation" }, ...options]} />
    </div>
  );
}

/** The designation's title for printed headings ("" when no filter). */
export function useDesignationTitle(id: string): string {
  const settings = useQuery(hrQueries.settings());
  return id ? (settings.data?.designations.find((d) => d.id === id)?.title ?? "") : "";
}

/** "Accountant · Approved · 01-Oct-2026 to 31-Oct-2026" — the filters a printout was made with. */
export const filterNote = (parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" · ");

/** "Ms Hina Javed (KC-T-0142)" options for staff pickers. */
export function staffOptions(staff: HrStaffSummary[] | undefined, filter: (s: HrStaffSummary) => boolean = (s) => s.status === "ACTIVE"): ComboboxOption[] {
  return (staff ?? []).filter(filter).map((s) => ({ value: s.id, label: s.name, hint: `${s.employeeNo} · ${s.designation}`, keywords: [s.employeeNo, s.designation, s.cnic] }));
}

export function CampusTags({ campus, others }: { campus: CampusCode; others: CampusCode[] }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className="text-small">{campusLabel(campus)}</span>
      {others.map((c) => (
        <StatusBadge key={c} status="info" dot={false}>
          Also {campusLabel(c)}
        </StatusBadge>
      ))}
    </span>
  );
}

export function StaffStatusBadge({ s }: { s: Pick<HrStaffSummary, "status" | "employmentType" | "onLeaveToday"> }) {
  if (s.status === "LEFT") return <StatusBadge status="cancelled">Left</StatusBadge>;
  if (s.onLeaveToday) return <StatusBadge status="leave">On leave today</StatusBadge>;
  if (s.employmentType === "PROBATION") return <StatusBadge status="warning">On probation</StatusBadge>;
  return <StatusBadge status="success">Active</StatusBadge>;
}

export function RunBadge({ status }: { status: HrRunStatus | HrPayrollStatus }) {
  if (status === "DRAFT") return <StatusBadge status="draft">Being prepared</StatusBadge>;
  if (status === "PENDING") return <StatusBadge status="pending">Waiting for approval</StatusBadge>;
  if (status === "APPROVED") return <StatusBadge status="approved" icon="check">Approved</StatusBadge>;
  return <StatusBadge status="paid" icon="check">Paid</StatusBadge>;
}

export function LeaveBadge({ status }: { status: HrLeaveStatus }) {
  if (status === "PENDING") return <StatusBadge status="pending">Waiting</StatusBadge>;
  if (status === "APPROVED") return <StatusBadge status="approved" icon="check" />;
  if (status === "REJECTED") return <StatusBadge status="rejected" />;
  return <StatusBadge status="cancelled">Cancelled</StatusBadge>;
}

export function LoanBadge({ status }: { status: HrLoanStatus }) {
  if (status === "PENDING") return <StatusBadge status="pending">Waiting for approval</StatusBadge>;
  if (status === "ACTIVE") return <StatusBadge status="info">Being repaid</StatusBadge>;
  if (status === "CLOSED") return <StatusBadge status="paid" icon="check">Paid back</StatusBadge>;
  return <StatusBadge status="rejected" />;
}

/** A labelled figure inside a panel. */
export function Figure({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-small text-ink-muted">{label}</span>
      <span className="text-title-3 tabular-nums">{children}</span>
      {hint && <span className="text-small text-ink-muted">{hint}</span>}
    </div>
  );
}

/** Western numbers and dates inside Urdu or mixed text. */
export const Ltr = ({ children }: { children: ReactNode }) => <bdi dir="ltr">{children}</bdi>;

/** Saves rows as a CSV file that opens in Excel. */
export function downloadCsv(fileName: string, header: string[], rows: Array<Array<string | number | null | undefined>>) {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = "﻿" + [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type PaperKind = "A4" | "A4L" | "A5" | "CARD";
const PAGE: Record<PaperKind, string> = {
  A4: "@page { size: A4 portrait; margin: 10mm; }",
  A4L: "@page { size: A4 landscape; margin: 8mm; }",
  A5: "@page { size: A5 portrait; margin: 6mm; }",
  CARD: "@page { size: 86mm 54mm; margin: 0; }",
};

/**
 * Prints one document: it is rendered into a print-only area, the browser's print dialog opens, and it is removed
 * afterwards. Only the document prints (the app is hidden by the print styles).
 */
export function usePrint() {
  const [job, setJob] = useState<{ node: ReactNode; paper: PaperKind } | null>(null);
  useEffect(() => {
    if (!job) return;
    const t = window.setTimeout(() => window.print(), 80);
    const done = () => setJob(null);
    window.addEventListener("afterprint", done);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("afterprint", done);
    };
  }, [job]);
  const area = job
    ? createPortal(
        <div className="mtb-print-area hr-print" data-theme="light">
          <style>{PAGE[job.paper]}</style>
          {job.node}
        </div>,
        document.body,
      )
    : null;
  return { print: (node: ReactNode, paper: PaperKind) => setJob({ node, paper }), area, printing: job !== null };
}

/** "Khalid Campus, Sadiqabad" for printed headings. */
export const campusHeading = (c: CampusCode) => (c === "KC" ? "Khalid Campus, Sadiqabad" : c === "HC" ? "Humaira Campus, Lahore" : campusLabel(c));

export const rs = (n: number) => `Rs ${new Intl.NumberFormat("en-US").format(n)}`;
