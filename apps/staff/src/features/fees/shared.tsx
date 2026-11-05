import { ApiError, type Permission } from "@mtb/api";
import { formatLakh, formatRs } from "@mtb/domain";
import { Banner, Button, Menu, MenuItem, StatusBadge } from "@mtb/ui";
import type { CSSProperties, ReactNode } from "react";
import { SubNav, type SubNavItem } from "../../app/shell/SubNav";
import { useCan } from "../../app/session";
import "./fees.css";

/** The fee office's pages, shown under every fee page's header. */
export function FeesNav() {
  // Tabs a role can't open are left out (the pages check again).
  const collect = useCan("fees.collect");
  const reports = useCan("fees.reports");
  const items: SubNavItem[] = [
    ...(collect ? [{ to: "/fees/counter", label: "Counter", icon: "fees" as const }] : []),
    { to: "/fees/candidates", label: "Test fees", icon: "admissions" },
    { to: "/fees/vouchers", label: "Vouchers", icon: "file" },
    { to: "/fees/structure", label: "Structure", icon: "layers" },
    { to: "/fees/concessions", label: "Concessions", icon: "award" },
    { to: "/fees/fines", label: "Fines", icon: "clock" },
    ...(reports
      ? [
          { to: "/fees/defaulters", label: "Defaulters", icon: "alertCircle" as const },
          { to: "/fees/reports", label: "Reports", icon: "trendUp" as const },
        ]
      : []),
  ];
  return <SubNav label="Fees" items={items} />;
}

/** True when the user has any of the permissions at the current campus. The server checks too. */
export function useCanAny(perms: Permission[]): boolean {
  // The list is fixed per call site, so the hooks run in the same order every render.
  const results = perms.map((p) => useCan(p)); // eslint-disable-line react-hooks/rules-of-hooks
  return results.some(Boolean);
}

/** Plain-English text for a failed request. */
export const errorText = (e: unknown) => (e instanceof ApiError ? (e.isNetwork ? "No response from the server; nothing was changed. Try again." : e.message) : "Something went wrong. Try again.");

/** The field a server validation error points at, if any. */
export const errorField = (e: unknown) => (e instanceof ApiError ? e.field : undefined);

/** A load error with a retry button. */
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

/** "Rs 48,25,000" style axis ticks in lakh: "48 lakh". */
export const lakhTick = (v: number) => (v === 0 ? "0" : v >= 100_000 ? `${Math.round((v / 100_000) * 10) / 10} lakh` : `${Math.round(v / 1000)}k`);

/** "Rs 486,500" with the lakh figure beside it when the amount is large (open decision: show both). */
export function Amount({ value, lakh }: { value: number; lakh?: boolean }) {
  return (
    <span className="tabular-nums">
      {formatRs(value)}
      {lakh && value >= 100_000 && <span className="ml-1.5 text-small text-ink-muted">({formatLakh(value)})</span>}
    </span>
  );
}

/** A decision badge used by concessions, waivers and fines. */
export function DecisionBadge({ status }: { status: "PENDING" | "APPROVED" | "REJECTED" | "STOPPED" | "CHARGED" | "WAIVED" }) {
  if (status === "PENDING") return <StatusBadge status="pending">Waiting for approval</StatusBadge>;
  if (status === "APPROVED") return <StatusBadge status="approved" icon="check" />;
  if (status === "REJECTED") return <StatusBadge status="rejected" />;
  if (status === "CHARGED") return <StatusBadge status="info">On the fee ledger</StatusBadge>;
  if (status === "WAIVED") return <StatusBadge status="neutral">Waived</StatusBadge>;
  return <StatusBadge status="cancelled">Stopped</StatusBadge>;
}

/** Stagger style for list rows (.mtb-slide-in). */
export const slide = (i: number) => ({ "--i": Math.min(i, 12) }) as CSSProperties;

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

/** "Class 7" for "7", "Prep" stays. */
export const className = (short: string) => (short === "Prep" ? "Prep" : `Class ${short}`);

export const CLASS_SHORTS = ["Prep", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];

/** Sections of a class (the same at every campus: Classes 6–8 have three, the rest two). */
export const sectionsOf = (cls: string): string[] => (!cls ? [] : ["6", "7", "8"].includes(cls) ? ["A", "B", "C"] : ["A", "B"]);

/** Several fee heads picked from a menu; none picked = every head. */
export function HeadPicker({ heads, value, onChange, label = "Fee heads" }: { heads: Array<{ code: string; title: string }>; value: string[]; onChange: (next: string[]) => void; label?: string }) {
  const text = value.length === 0 ? `${label}: all` : value.length === 1 ? (heads.find((h) => h.code === value[0])?.title ?? value[0]) : `${label}: ${value.length}`;
  return (
    <Menu
      label={label}
      trigger={
        <Button icon="filter" aria-label={`${label}. ${text}`}>
          {text}
        </Button>
      }
    >
      <MenuItem checked={value.length === 0} onSelect={() => onChange([])}>
        Every head
      </MenuItem>
      {heads.map((h) => (
        <MenuItem
          key={h.code}
          checked={value.includes(h.code)}
          onSelect={(e?: Event) => {
            e?.preventDefault();
            onChange(value.includes(h.code) ? value.filter((x) => x !== h.code) : [...value, h.code]);
          }}
        >
          {h.title}
        </MenuItem>
      ))}
    </Menu>
  );
}

/** Paper for the print-out on this page (overrides the app's A5 receipt default while mounted). */
export function PaperSize({ size }: { size: "A4" | "A4L" }) {
  return <style>{size === "A4L" ? "@page { size: A4 landscape; margin: 6mm; }" : "@page { size: A4 portrait; margin: 10mm; }"}</style>;
}

/** The demo's today (Wednesday 04-Nov-2026). Only for defaults in forms; the server decides dates and fines. */
export const TODAY = "2026-11-04";

/** Adds days to an ISO date without time-zone drift. */
export function addDaysIso(d: string, n: number): string {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

/** "2026-12" → "2026-12-31" */
export function monthEndIso(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y ?? 2026, m ?? 1, 0)).toISOString().slice(0, 10);
}

/** Months of a session, April to March: ["2026-04", … "2027-03"]. */
export function sessionMonthList(session: number): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(session, 3 + i, 1));
    return d.toISOString().slice(0, 7);
  });
}

/** Wraps Western numbers and dates inside Urdu text. */
export function Ltr({ children }: { children: ReactNode }) {
  return <bdi dir="ltr">{children}</bdi>;
}
