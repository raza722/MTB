import { TEACHER_REGISTER_STATUS_LABEL, type RegisterCode, type TeacherRegisterStatus } from "@mtb/api";
import { cx, StatusBadge } from "@mtb/ui";
import type { KeyboardEvent } from "react";
import { useSync, type OutboxItem } from "../../app/sync/outbox";

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
 * Present · Absent · Leave · Late as one row of 44px segments (a radio group: arrow keys move, the chosen one is
 * tinted in its status colour and keeps its word).
 */
export function MarkControl({ value, onChange, name, autoFocus }: { value: RegisterCode; onChange: (code: RegisterCode) => void; name: string; autoFocus?: boolean }) {
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
    <div role="radiogroup" aria-label={`Mark for ${name}`} className="grid grid-cols-4 gap-1 rounded-lg bg-surface-sunken p-1">
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
              "flex h-11 items-center justify-center gap-1 rounded-md px-1 text-small font-medium transition-colors",
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

/** A register submit or change waiting in the outbox for this class (and date). */
export function useQueuedFor(classSection: string, date: string | undefined) {
  const sync = useSync();
  const submit = sync.items.find((i): i is OutboxItem & { payload: { kind: "register.submit" } } => i.payload.kind === "register.submit" && i.payload.classSection === classSection && (!date || i.payload.body.date === date));
  const changes = sync.items.filter((i) => i.payload.kind === "register.change" && i.payload.classSection === classSection && (!date || i.payload.body.date === date));
  return { submit, changes };
}
