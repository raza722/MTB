import { ApiError, attendanceQueries, CURRENT_SESSION, type RegisterCode } from "@mtb/api";
import { formatDate, formatPercent, formatSession, pakistanToday, type AttendanceCode, type IsoDate } from "@mtb/domain";
import { AnimatedNumber, Banner, Button, buttonClassName, EmptyState, StatusBadge, type AttendanceStatus } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { CSSProperties, ReactNode } from "react";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import { Page, PageHeader } from "../../app/shell/page";
import { SubNav, type SubNavItem } from "../../app/shell/SubNav";
import "./attendance.css";

/** Today in Pakistan (the backend's "today" too). */
export function useToday(): IsoDate {
  return pakistanToday();
}

const NAV: SubNavItem[] = [
  { to: "/attendance", label: "Today", icon: "attendance", exact: true },
  { to: "/attendance/monthly", label: "Monthly sheet", icon: "calendar" },
  { to: "/attendance/students", label: "Student reports", icon: "user" },
  { to: "/attendance/absentees", label: "Absentees", icon: "message" },
  { to: "/attendance/calendar", label: "School calendar", icon: "flag" },
  { to: "/attendance/summary", label: "Summary", icon: "trendUp" },
];

/** Page, header with campus and session (and a read-only note for an earlier session), and the module's tabs. */
export function AttendanceShell({ title, context, actions, meta, children }: { title: string; context?: ReactNode; actions?: ReactNode; meta?: ReactNode; children: ReactNode }) {
  const readOnly = useReadOnly();
  const { session } = useCtx();
  const note = readOnly ? (
    <StatusBadge status="neutral" icon="lock" title={`Registers of ${formatSession(session)} can be read and printed, not changed. Switch to ${formatSession(CURRENT_SESSION)} to mark registers.`}>
      Session {formatSession(session)} is read-only
    </StatusBadge>
  ) : null;
  const headMeta = meta || note ? (
    <>
      {note}
      {meta}
    </>
  ) : undefined;
  return (
    <Page>
      <PageHeader title={title} {...(context !== undefined ? { context } : {})} {...(actions ? { actions } : {})} {...(headMeta ? { meta: headMeta } : {})} />
      <SubNav items={NAV} label="Attendance" />
      {children}
    </Page>
  );
}

/** Today's registers and today's absentees only exist in the current session; the rest stays open to read. */
export function PastSessionNote({ what }: { what: string }) {
  const { session } = useCtx();
  return (
    <div className="mtb-card">
      <EmptyState
        icon="lock"
        title={`Session ${formatSession(session)} is read-only`}
        description={`${what} belong to the current session. The ${formatSession(session)} registers, monthly sheets, student reports and summary stay open to read and print.`}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Link to="/attendance/monthly" className={buttonClassName({ size: "sm", variant: "primary" })}>
              Open monthly sheets
            </Link>
            <Link to="/attendance/students" className={buttonClassName({ size: "sm" })}>
              Student reports
            </Link>
          </div>
        }
      />
    </div>
  );
}

export interface SessionSpan {
  session: number;
  readOnly: boolean;
  /** Today in Pakistan. */
  today: IsoDate;
  /**
   * First day the session's registers can be read for (the server's read span: the session's first day, or an
   * earlier first register: old classes sometimes started before April).
   */
  starts: IsoDate;
  /** Last day with registers: today in the current session, the read span's last day in an earlier one. */
  last: IsoDate;
  /** The campus's weekly days off, 0 = Sunday … 6 = Saturday. */
  weeklyOff: number[];
  /** False until the school calendar has answered; queries that depend on the span wait for it. */
  ready: boolean;
}

/**
 * The days the selected session's registers cover, from the school calendar (GET /attendance/calendar: registersFrom,
 * registersTo, weeklyOff). Until it answers, the session's April–March dates stand in and `ready` is false.
 */
export function useSessionSpan(): SessionSpan {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const today = useToday();
  const cal = useQuery(attendanceQueries.calendar(ctx));
  const d = cal.data;
  const starts = d?.registersFrom ?? d?.starts ?? `${ctx.session}-04-01`;
  const ends = d?.registersTo ?? d?.ends ?? `${ctx.session + 1}-03-31`;
  return {
    session: ctx.session,
    readOnly,
    today,
    starts,
    last: ends < today ? ends : today,
    weeklyOff: d?.weeklyOff ?? [0],
    ready: !!d,
  };
}

/** The last day on or before a date that is not a weekly day off (the server knows the holidays). */
export function lastOpenDay(d: IsoDate, weeklyOff: number[]): IsoDate {
  const x = new Date(`${d}T00:00:00Z`);
  for (let i = 0; i < 7 && weeklyOff.includes(x.getUTCDay()); i++) x.setUTCDate(x.getUTCDate() - 1);
  return x.toISOString().slice(0, 10);
}

/** A class teacher's name, or "—" while the section has none. */
export const teacherText = (name: string | undefined) => (name ? name : "—");

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.isNetwork ? "No response from the server. Check the connection and try again." : e.message;
  return "Something went wrong. Try again.";
}

export function QueryError({ what, error, onRetry }: { what: string; error: unknown; onRetry: () => void }) {
  return (
    <Banner
      tone="danger"
      title={`${what} could not be loaded.`}
      actions={
        <Button size="sm" variant="secondary" icon="refresh" onClick={onRetry}>
          Try again
        </Button>
      }
    >
      {errorText(error)}
    </Banner>
  );
}

export const CODE_STATUS: Record<AttendanceCode, AttendanceStatus> = { P: "present", A: "absent", L: "leave", LT: "late", H: "holiday" };

export function CodeBadge({ code, compact }: { code: AttendanceCode; compact?: boolean }) {
  return (
    <StatusBadge status={CODE_STATUS[code]} dot={!compact}>
      {compact ? code : undefined}
    </StatusBadge>
  );
}

/** Office staff, the principal and admins can mark a register for a teacher and request changes (teachers use the teacher app). */
export function useCanMark(): boolean {
  return useCan("attendance.mark");
}

/** Class-sections at the current campus (for pickers). */
export function useSections() {
  const ctx = useCtx();
  return useQuery({ ...attendanceQueries.sections(ctx), enabled: ctx.campus !== "ALL" });
}

/** "2026-10" → "October 2026" */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1]} ${y}`;
}

/** "2026-04" … "2026-11": every month from one date's month to another's, oldest first. */
export function monthsBetween(from: IsoDate, to: IsoDate): string[] {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number) as [number, number];
  for (let guard = 0; guard < 120 && `${y}-${String(m).padStart(2, "0")}` <= to.slice(0, 7); guard++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (m === 12) {
      m = 1;
      y++;
    } else m++;
  }
  return out;
}

/** Months of the session's registers up to its last day with registers (this month in the current session), newest first. */
export function sessionMonths(span: SessionSpan): string[] {
  return monthsBetween(span.starts, span.last).reverse();
}

export const pctText = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toFixed(1)}%`);

/** A percentage stat: the animated figure, or "—" when there is nothing to divide by. */
export function PctValue({ value }: { value: number | null | undefined }) {
  return value === null || value === undefined ? <>—</> : <AnimatedNumber value={value} decimals={1} format={(v) => formatPercent(v)} />;
}

/** StatCard meter props for a percentage that may be missing (no meter then). */
export const pctMeter = (value: number | null | undefined, meterLabel: string) => (value === null || value === undefined ? {} : { meter: value, meterLabel });

export const stagger = (i: number) => ({ "--i": i }) as CSSProperties;

/** The register codes in the order staff mark them. */
export const MARK_ORDER: RegisterCode[] = ["P", "A", "L", "LT"];

/**
 * A printed sheet: appears only when printing, always black on white, with the school's heading and sign-off lines.
 * `landscape` for wide grids (monthly register), portrait for slips and lists.
 */
export function PrintSheet({ title, scope, landscape, signatures = ["Class teacher", "Principal"], children }: { title: string; scope: string; landscape?: boolean; signatures?: string[]; children: ReactNode }) {
  const { campus } = useCtx();
  return (
    <section className={`mtb-print-area att-print-only ${landscape ? "att-print-landscape" : "att-print-portrait"}`} aria-hidden="true">
      <style>{landscape ? "@page { size: A4 landscape; margin: 10mm; }" : "@page { size: A4 portrait; margin: 12mm; }"}</style>
      <header className="att-print-head">
        <div>
          <div className="att-print-school">MTB Schools &amp; Colleges · {campusLabel(campus)}</div>
          <h1>{title}</h1>
          <div>{scope}</div>
        </div>
        <div className="att-print-date">Printed {formatDate(pakistanToday())}</div>
      </header>
      {children}
      {signatures.length > 0 && (
        <div className="att-print-sign">
          {signatures.map((s) => (
            <div key={s}>{s}: signature and date</div>
          ))}
        </div>
      )}
    </section>
  );
}
