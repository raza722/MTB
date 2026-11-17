import { ApiError, clockTime, TEACHER_REGISTER_STATUS_LABEL, type ExamsCategory, type RegisterCode, type TeacherPaper, type TeacherRegisterStatus } from "@mtb/api";
import { Banner, Button, cx, StatusBadge } from "@mtb/ui";
import type { UseQueryResult } from "@tanstack/react-query";
import type { KeyboardEvent, ReactNode } from "react";

/*
 * Shared pieces of the Teaching area (the teacher's own registers, marks, timetable, classes, notifications and
 * leave). Ported from the teacher app; every write goes straight to the API.
 */

/* ------------------------------------------------------------------ Errors and loading */

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.isNetwork ? "No response from the server. Check the connection and try again." : e.message;
  return "Something went wrong. Try again.";
}

/** The states of a page's data: shown (with a note if a refresh failed), loading skeleton, or an error with Try again. */
export function QueryState<T>({ query, what, skeleton, children }: { query: UseQueryResult<T>; what: string; skeleton: ReactNode; children: (data: T) => ReactNode }) {
  if (query.data !== undefined) {
    return (
      <>
        {query.isError && (
          <Banner tone="warning" title="Showing the last figures loaded." actions={<Button size="sm" variant="secondary" icon="refresh" onClick={() => void query.refetch()}>Refresh</Button>}>
            {errorText(query.error)}
          </Banner>
        )}
        {children(query.data)}
      </>
    );
  }
  if (query.isError) {
    const forbidden = query.error instanceof ApiError && query.error.status === 403;
    return (
      <Banner
        tone={forbidden ? "warning" : "danger"}
        title={forbidden ? "Not available to you." : `${what} could not be loaded.`}
        actions={
          forbidden ? undefined : (
            <Button size="sm" variant="secondary" icon="refresh" onClick={() => void query.refetch()}>
              Try again
            </Button>
          )
        }
      >
        {errorText(query.error)}
      </Banner>
    );
  }
  return <>{skeleton}</>;
}

/* ------------------------------------------------------------------ Time (Pakistan) */

/** Minutes since midnight, Pakistan time. Dates come from the server, never from the computer's clock. */
export function pkMinutesNow(): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "9") % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return h * 60 + m;
}

export function greeting(): string {
  const m = pkMinutesNow();
  if (m < 12 * 60) return "Good morning";
  if (m < 17 * 60) return "Good afternoon";
  return "Good evening";
}

/** "Ms Hina Javed" → "Ms Hina" */
export function shortName(name: string): string {
  const parts = name.split(" ");
  const titled = ["Ms", "Mr", "Mrs", "Dr", "Miss"].includes(parts[0] ?? "");
  return titled ? parts.slice(0, 2).join(" ") : (parts[0] ?? name);
}

export const toMins = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** "08:00" → "08:00 AM" */
export const clock = (hhmm: string) => (hhmm ? clockTime(hhmm) : "");

/** Where a period stands against the clock today. */
export function periodPhase(start: string, end: string, now = pkMinutesNow()): "done" | "now" | "later" {
  if (now >= toMins(end)) return "done";
  if (now >= toMins(start)) return "now";
  return "later";
}

/* ------------------------------------------------------------------ Register marks */

export const CODES: RegisterCode[] = ["P", "A", "L", "LT"];

export const MARK_LABEL: Record<RegisterCode, string> = { P: "Present", A: "Absent", L: "Leave", LT: "Late" };

/** Attendance colours come from the status tokens and always sit beside the letter and the word. */
export const MARK_TONE: Record<RegisterCode, string> = {
  P: "bg-status-present-tint text-status-present-ink",
  A: "bg-status-absent-tint text-status-absent-ink",
  L: "bg-status-leave-tint text-status-leave-ink",
  LT: "bg-status-late-tint text-status-late-ink",
};

/** The register letter in its status colour, with the word for screen readers. */
export function MarkChip({ code, className }: { code: RegisterCode; className?: string }) {
  return (
    <span className={cx("inline-grid h-8 min-w-10 shrink-0 place-items-center rounded-md px-2 text-small font-semibold tabular-nums", MARK_TONE[code], className)}>
      <span aria-hidden="true">{code}</span>
      <span className="mtb-sr-only">{MARK_LABEL[code]}</span>
    </span>
  );
}

export function RegisterStatusBadge({ status, size }: { status: TeacherRegisterStatus; size?: "lg" }) {
  const map = { NOT_MARKED: "warning", SUBMITTED: "success", CHANGE_PENDING: "pending" } as const;
  return (
    <StatusBadge status={map[status]} {...(size ? { size } : {})}>
      {TEACHER_REGISTER_STATUS_LABEL[status]}
    </StatusBadge>
  );
}

/**
 * Present · Absent · Leave · Late as one row of segments (a radio group: arrow keys move, the chosen one is tinted in
 * its status colour and keeps its word). `compact` is the 32px desktop row.
 */
export function MarkControl({ value, onChange, name, autoFocus, compact }: { value: RegisterCode; onChange: (code: RegisterCode) => void; name: string; autoFocus?: boolean; compact?: boolean }) {
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = CODES[(i + step + CODES.length) % CODES.length]!;
    onChange(next);
    const group = e.currentTarget.parentElement;
    requestAnimationFrame(() => group?.querySelector<HTMLButtonElement>(`[data-code="${next}"]`)?.focus());
  };
  return (
    <div role="radiogroup" aria-label={`Mark for ${name}`} className={cx("grid grid-cols-4 gap-1 rounded-lg bg-surface-sunken p-1", compact && "w-[22rem] max-w-full")}>
      {CODES.map((c, i) => {
        const on = value === c;
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={on}
            data-code={c}
            tabIndex={on ? 0 : -1}
            autoFocus={autoFocus && on}
            onKeyDown={(e) => onKey(e, i)}
            onClick={() => onChange(c)}
            className={cx(
              "flex items-center justify-center gap-1 rounded-md px-1 text-small font-medium transition-colors",
              compact ? "h-8" : "h-11",
              on ? cx(MARK_TONE[c], "shadow-sm") : "text-ink-muted hover:bg-surface-hover hover:text-ink",
            )}
          >
            {MARK_LABEL[c]}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ Papers */

export const CATEGORY_LABEL: Record<ExamsCategory, string> = {
  TERM: "Term exam",
  TEST: "Class test",
  BOARD: "Board exam",
  ENTRANCE: "Entry test",
  UNIVERSITY: "Semester exam",
};

/** Where a paper stands for the teacher: Not started, Draft, Submitted, Checked, or Declared (locked). */
export function PaperBadge({ p }: { p: Pick<TeacherPaper, "examStatus" | "status"> }) {
  if (p.examStatus === "DECLARED")
    return (
      <StatusBadge status="declared" icon="lock">
        Declared
      </StatusBadge>
    );
  switch (p.status) {
    case "NOT_STARTED":
      return <StatusBadge status="neutral">Not started</StatusBadge>;
    case "IN_PROGRESS":
      return <StatusBadge status="draft">Draft</StatusBadge>;
    case "SUBMITTED":
      return (
        <StatusBadge status="info" icon="lock">
          Submitted
        </StatusBadge>
      );
    case "CHECKED":
      return (
        <StatusBadge status="success" icon="lock">
          Checked
        </StatusBadge>
      );
  }
}

/** "First Term · Mathematics · 7-B · Max marks 75". */
export const paperHeader = (p: Pick<TeacherPaper, "examName" | "subjectName" | "classSection" | "maxMarks">) => `${p.examName} · ${p.subjectName} · ${p.classSection} · Max marks ${p.maxMarks}`;

/* ------------------------------------------------------------------ Links */

/**
 * Notifications carry teacher-app paths ("/registers", "/marks", "/more/leave"). Here they live under /teaching.
 */
export function teachingPath(link: string): string {
  const path = link.startsWith("/") ? link : `/${link}`;
  if (path === "/today" || path === "/") return "/teaching";
  if (path.startsWith("/more/")) return `/teaching/${path.slice("/more/".length)}`;
  if (path === "/more") return "/teaching";
  if (path.startsWith("/teaching")) return path;
  return `/teaching${path}`;
}
