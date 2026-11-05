import type { IsoDate, IsoDateTime } from "@mtb/domain";

/** Today in the demo is Wednesday 04-Nov-2026 (brief §5). */
export const DEMO_TODAY: IsoDate = "2026-11-04";
export const CURRENT_SESSION = 2026;

/** Demo date with the real time of day in Pakistan, e.g. "2026-11-04T10:39:00+05:00". */
export function demoNow(): IsoDateTime {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const hh = parts.find((p) => p.type === "hour")?.value ?? "10";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "39";
  return `${DEMO_TODAY}T${hh === "24" ? "00" : hh}:${mm}:00+05:00`;
}
