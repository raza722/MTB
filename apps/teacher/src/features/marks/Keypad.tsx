import { Button, Icon, cx } from "@mtb/ui";

export type PadKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "back" | "A" | "L" | "next";

/** What a typed value means: a mark, Absent (A), Leave (L), nothing yet, or a problem to fix before Next. */
export function checkBuffer(buffer: string, max: number): { value: number | "A" | "L" | null; error: string | null } {
  if (buffer === "") return { value: null, error: null };
  if (buffer === "A" || buffer === "L") return { value: buffer, error: null };
  if (!/^\d{1,3}(\.\d?)?$/.test(buffer)) return { value: null, error: "Type a number, or tap Absent." };
  const n = Number(buffer.endsWith(".") ? buffer.slice(0, -1) : buffer);
  if (n > max) return { value: n, error: `Maximum is ${max}` };
  if (Math.round(n * 2) !== n * 2) return { value: n, error: "Use whole or half marks, for example 12.5." };
  return { value: n, error: null };
}

/** Applies one key to the typed value (Absent, Leave and Next are handled by the caller). */
export function typeKey(buffer: string, key: PadKey): string {
  const base = buffer === "A" || buffer === "L" ? "" : buffer;
  if (key === "back") return base.slice(0, -1);
  if (key === ".") return base.includes(".") ? base : `${base || "0"}.`;
  if (!/^\d$/.test(key)) return base;
  if (base === "0") return key;
  if (base.includes(".") && (base.split(".")[1] ?? "").length >= 1) return base;
  return base.length >= 5 ? base : base + key;
}

export function displayOf(buffer: string): string {
  if (buffer === "A") return "Absent";
  if (buffer === "L") return "Leave";
  return buffer;
}

/**
 * The large number pad for marks: 0–9, decimal point, Absent, Leave and Next, every key at least 48px tall so it
 * works one-handed. The phone's own keyboard never opens. A value above the maximum shows "Maximum is 75" and
 * blocks Next.
 */
export function Keypad({
  who,
  buffer,
  error,
  max,
  progress,
  onKey,
  onDone,
}: {
  who: string;
  buffer: string;
  error: string | null;
  max: number;
  progress: string;
  onKey: (k: PadKey) => void;
  onDone: () => void;
}) {
  const digit = "h-12 rounded-md bg-surface-sunken text-title-1 font-medium text-ink tabular-nums hover:bg-surface-hover active:bg-surface-selected";
  const keys: Array<{ k: PadKey; label: string; cls?: string; aria?: string }> = [
    { k: "1", label: "1" },
    { k: "2", label: "2" },
    { k: "3", label: "3" },
    { k: "back", label: "⌫", aria: "Delete", cls: "text-title-2 text-ink-muted" },
    { k: "4", label: "4" },
    { k: "5", label: "5" },
    { k: "6", label: "6" },
    { k: "A", label: "Absent", cls: "bg-status-absent-tint text-status-absent-ink text-small font-semibold hover:bg-status-absent-tint" },
    { k: "7", label: "7" },
    { k: "8", label: "8" },
    { k: "9", label: "9" },
    { k: "L", label: "Leave", cls: "bg-status-leave-tint text-status-leave-ink text-small font-semibold hover:bg-status-leave-tint" },
    { k: ".", label: ".", aria: "Decimal point" },
    { k: "0", label: "0" },
  ];
  return (
    <div className="grid gap-2" role="group" aria-label={`Number pad for ${who}`}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate font-medium text-ink">{who}</p>
          <p className="m-0 text-small text-ink-muted tabular-nums">
            {progress} · Max {max}
          </p>
        </div>
        <output
          className={cx("grid h-12 min-w-24 place-items-center rounded-md border-2 bg-surface-raised px-3 text-title-1 tabular-nums", error ? "border-danger text-danger-ink" : "border-brand text-ink")}
          aria-live="polite"
          aria-label={`Mark for ${who}`}
        >
          {displayOf(buffer) || <span className="text-ink-subtle">—</span>}
        </output>
        <Button size="touch" variant="ghost" onClick={onDone}>
          Done
        </Button>
      </div>
      <p role="alert" className={cx("m-0 flex min-h-5 items-center gap-1.5 text-small font-medium text-danger-ink", !error && "invisible")}>
        <Icon name="alertCircle" size={16} />
        {error ?? "No problem"}
      </p>
      <div className="grid grid-cols-4 gap-1.5">
        {keys.map((key) => (
          <button key={key.k} type="button" className={cx(digit, key.cls)} aria-label={key.aria} onClick={() => onKey(key.k)}>
            {key.label}
          </button>
        ))}
        <Button variant="primary" size="touch" className="col-span-2 h-12" iconRight="arrowRight" disabled={Boolean(error)} onClick={() => onKey("next")}>
          Next
        </Button>
      </div>
    </div>
  );
}
