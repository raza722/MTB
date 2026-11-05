import { ApiError, ENROLMENT_STATUS_LABEL, metaQueries, type CampusCode, type ClassInfo, type EnrolmentStatusCode } from "@mtb/api";
import { formatDate, pakistanToday, type IsoDate, type IsoDateTime } from "@mtb/domain";
import { Banner, Button, StatusBadge, type Status } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { useCallback, type CSSProperties, type ReactNode } from "react";
import { SubNav } from "../../app/shell/SubNav";

/** Today in Pakistan (read on every call, so a page left open past midnight moves on). */
export const today = (): IsoDate => pakistanToday();

/** This moment (for "Printed …" lines; shown in Pakistan time by formatDateTime). */
export const nowIso = (): IsoDateTime => new Date().toISOString();

/**
 * A date that may be missing: many migrated students have no date of birth (null, or "" until the API sends null;
 * spec 01_students C1). Returns `empty` instead of throwing on a blank value.
 */
export const dateOrBlank = (value: IsoDate | null | undefined, empty = "—"): string => (value ? formatDate(value) : empty);

/** "7" from "7-B": the class short name before the first dash (short names are letters and digits only). */
export const classShortOf = (classSection: string): string => classSection.split("-")[0] ?? "";

/** "B" from "7-B": everything after the first dash (real section names may contain dashes and slashes). */
export const sectionOf = (classSection: string): string => {
  const i = classSection.indexOf("-");
  return i < 0 ? "" : classSection.slice(i + 1);
};

/**
 * Whether a class sits a board exam (Part-I or Part-II), from Setup's `boardExamPart` (spec 01_students D8).
 * `undefined` while the server does not send that field yet: then nothing is hidden and the server decides
 * (it refuses board roll numbers and board documents for other classes, with the reason).
 */
export function isBoardClass(classes: ClassInfo[] | undefined, classShort: string): boolean | undefined {
  if (!classes?.some((c) => c.boardExamPart !== undefined)) return undefined;
  return Boolean(classes.find((c) => c.short === classShort)?.boardExamPart);
}

/** The class's name from Setup ("Class 7", "Prep", "First Year"), falling back to the short name while it loads. */
export function useClassLabel(campus: CampusCode | "ALL"): (short: string) => string {
  const classes = useQuery(metaQueries.classes(campus));
  return useCallback((short: string) => classes.data?.find((c) => c.short === short)?.name ?? short, [classes.data]);
}

export const STATUS_TONE: Record<EnrolmentStatusCode, Status> = { ACTIVE: "success", LEFT: "neutral", STRUCK_OFF: "warning", PASSED_OUT: "info", EXPELLED: "danger" };

export function EnrolmentBadge({ status }: { status: EnrolmentStatusCode }) {
  return <StatusBadge status={STATUS_TONE[status]}>{ENROLMENT_STATUS_LABEL[status]}</StatusBadge>;
}

/** Stagger index for .mtb-rise / .mtb-slide-in. */
export const stagger = (i: number) => ({ "--i": i }) as CSSProperties;

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
