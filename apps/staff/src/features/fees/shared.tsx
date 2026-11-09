import { ApiError, feeSetupQueries, metaQueries, type CampusCode, type CampusScope, type ClassInfo, type Permission } from "@mtb/api";
import { formatLakh, formatRs, pakistanToday, type IsoDate } from "@mtb/domain";
import { Banner, Button, Menu, MenuItem, StatusBadge } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo, type CSSProperties, type ReactNode } from "react";
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

/**
 * First and last day of a session at a campus, from the fee structure (Setup's session dates); April to March while it
 * loads, for ALL, or when the server does not send them.
 */
export function useFeeSessionDates(campus: CampusScope, session: number): { start: IsoDate; end: IsoDate } {
  const q = useQuery({ ...feeSetupQueries.structure(campus as CampusCode, session), enabled: campus !== "ALL" });
  return { start: q.data?.sessionStart ?? `${session}-04-01`, end: q.data?.sessionEnd ?? `${session + 1}-03-31` };
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

/** "Class 7" for "7", "Prep" stays. Only a fallback while Setup's class list loads; prefer useFeeClasses().nameOf. */
export const className = (short: string) => (short === "Prep" ? "Prep" : `Class ${short}`);

export interface FeeClasses {
  /** Classes offered at the campus (every campus for ALL), in Setup's order. */
  classes: ClassInfo[];
  /** Picker options: value = class short ("7"), label = the class's name ("Class 7", "First Year"). */
  options: Array<{ value: string; label: string }>;
  /** The class's name from Setup, or "Class 7" while it loads. */
  nameOf: (short: string) => string;
  /** Sections of a class at the campus ("A", "B" …); [] for none or while it loads. */
  sectionsOf: (short: string) => string[];
  loading: boolean;
}

/** The campus's classes and sections from Setup (GET /meta/classes), for the fee office's class and section pickers. */
export function useFeeClasses(campus: CampusScope): FeeClasses {
  const q = useQuery(metaQueries.classes(campus));
  return useMemo(() => {
    const classes = q.data ?? [];
    const byShort = new Map(classes.map((c) => [c.short, c]));
    return {
      classes,
      options: classes.map((c) => ({ value: c.short, label: c.name })),
      nameOf: (short: string) => byShort.get(short)?.name ?? className(short),
      sectionsOf: (short: string) => (short ? (byShort.get(short)?.sections ?? []) : []),
      loading: q.isLoading,
    };
  }, [q.data, q.isLoading]);
}

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

/**
 * Today in Pakistan (Asia/Karachi). Only for form defaults, date-picker limits and "printed on" lines; the server
 * decides dates and fines, and pages that receive the server's `today` (counter, fines, defaulters, arrears) use it.
 */
export const feeToday = (): IsoDate => pakistanToday();

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

/**
 * Months of a session: from its first day's month to its last day's ("2026-04" … "2027-03"). The structure sends the
 * session's dates (sessionStart / sessionEnd); without them the session runs April to March.
 */
export function sessionMonthList(session: number, start?: IsoDate, end?: IsoDate): string[] {
  const from = (start ?? `${session}-04-01`).slice(0, 7);
  const to = (end ?? `${session + 1}-03-31`).slice(0, 7);
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number) as [number, number];
  for (let guard = 0; guard < 36; guard++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (key > to) break;
    out.push(key);
    if (m === 12) {
      m = 1;
      y++;
    } else m++;
  }
  return out;
}

/** A percentage that may be missing: "12.5%", or "—" when there was nothing to divide by. */
export const pctText = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toFixed(1)}%`);

/** Wraps Western numbers and dates inside Urdu text. */
export function Ltr({ children }: { children: ReactNode }) {
  return <bdi dir="ltr">{children}</bdi>;
}
