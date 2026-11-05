import { ApiError, ENROLMENT_STATUS_LABEL, type EnrolmentStatusCode } from "@mtb/api";
import { Banner, Button, StatusBadge, type Status } from "@mtb/ui";
import type { CSSProperties, ReactNode } from "react";
import { SubNav } from "../../app/shell/SubNav";

/** Today in the demo (the mock server's clock). */
export const TODAY = "2026-11-04";

/** Now, on the demo's date with the real time of day in Pakistan (for "Printed …" lines). */
export function nowIso(): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const hh = parts.find((p) => p.type === "hour")?.value ?? "10";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${TODAY}T${hh === "24" ? "00" : hh}:${mm}:00+05:00`;
}

export const STATUS_TONE: Record<EnrolmentStatusCode, Status> = { ACTIVE: "success", LEFT: "neutral", STRUCK_OFF: "warning", PASSED_OUT: "info", EXPELLED: "danger" };

export function EnrolmentBadge({ status }: { status: EnrolmentStatusCode }) {
  return <StatusBadge status={STATUS_TONE[status]}>{ENROLMENT_STATUS_LABEL[status]}</StatusBadge>;
}

/** Stagger index for .mtb-rise / .mtb-slide-in. */
export const stagger = (i: number) => ({ "--i": i }) as CSSProperties;

/** "Prep" or "Class 7". */
export const classLabel = (short: string) => (short === "Prep" ? "Prep" : `Class ${short}`);

/** The server's message, or a plain retry hint when the connection dropped. */
export function apiMessage(error: unknown, fallback = "Something went wrong. Try again."): string | undefined {
  if (!error) return undefined;
  if (error instanceof ApiError) return error.isNetwork ? "No connection — nothing was saved. It's safe to try again." : error.message;
  return fallback;
}

/** The server's message when it is about this field (422 with `field`). */
export function fieldError(error: unknown, field: string): string | undefined {
  return error instanceof ApiError && error.field === field ? error.message : undefined;
}

/** A load error with a retry button, for the top of a page or panel. */
export function LoadError({ what, error, onRetry }: { what: string; error: unknown; onRetry: () => void }) {
  return (
    <Banner
      tone="danger"
      title={`The ${what} could not be loaded.`}
      actions={
        <Button size="sm" variant="secondary" icon="refresh" onClick={onRetry}>
          Try again
        </Button>
      }
    >
      {apiMessage(error, "Check the connection and try again.")}
    </Banner>
  );
}

/** Students module pages as tabs under the page header. */
export function StudentsSubNav() {
  return (
    <SubNav
      label="Students"
      items={[
        { to: "/students", label: "All students", icon: "students", exact: true },
        { to: "/students/families", label: "Families", icon: "home" },
        { to: "/students/sections", label: "Sections & roll numbers", icon: "layers" },
        { to: "/students/promotion", label: "Promotion", icon: "arrowUp" },
        { to: "/students/leaving", label: "Leaving & transfers", icon: "logout" },
        { to: "/students/documents", label: "ID cards & certificates", icon: "idCard" },
      ]}
    />
  );
}

/** A small label/value row used in panels. */
export function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-caption uppercase text-ink-muted">{label}</span>
      <span className="text-ink">{children}</span>
    </div>
  );
}

/** Seats filled in a section or class, as a meter with words. */
export function SeatMeter({ enrolled, seats, label }: { enrolled: number; seats: number; label: string }) {
  const pct = seats ? Math.min(100, Math.round((enrolled / seats) * 100)) : 0;
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between gap-2 text-small">
        <span className="text-ink-muted">
          <b className="font-semibold text-ink tabular-nums">{enrolled}</b> of {seats} seats
        </span>
        <span className="tabular-nums text-ink-muted">{seats - enrolled >= 0 ? `${seats - enrolled} free` : `${enrolled - seats} over`}</span>
      </div>
      <div className="mtb-meter mtb-meter-animate" role="meter" aria-valuenow={enrolled} aria-valuemin={0} aria-valuemax={seats} aria-label={`${label}: ${enrolled} of ${seats} seats`}>
        <span style={{ width: `${pct}%`, ...(enrolled > seats ? { background: "var(--danger)" } : pct >= 95 ? { background: "var(--warning)" } : {}) }} />
      </div>
    </div>
  );
}
