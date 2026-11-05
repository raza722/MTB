import { clockTime } from "@mtb/api";

/** Minutes since midnight, Pakistan time. The demo's date is fixed (04-Nov-2026); the time of day is real. */
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

/** Now as a moment with offset, for the register's "taken at". */
export const nowIso = () => new Date().toISOString();
