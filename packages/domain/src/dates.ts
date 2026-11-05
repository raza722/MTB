import { TZDate } from "@date-fns/tz";
import { differenceInCalendarDays, format, isValid, parse } from "date-fns";

/** All times are shown in Pakistan time. */
export const PK_TIME_ZONE = "Asia/Karachi";

/** A calendar date with no time, e.g. a due date: "2026-11-04". */
export type IsoDate = string;
/** A moment in time with offset, e.g. a posting time: "2026-11-04T10:39:00+05:00". */
export type IsoDateTime = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function fromIsoDate(value: IsoDate): Date {
  const d = parse(value, "yyyy-MM-dd", new Date(2000, 0, 1));
  if (!isValid(d)) throw new RangeError(`Not a calendar date: ${value}`);
  return d;
}

/** Date-only values are calendar dates (no time-zone shift). Moments are converted to Pakistan time. */
function toDisplayDate(value: IsoDate | IsoDateTime | Date): Date {
  if (typeof value === "string" && ISO_DATE.test(value)) return fromIsoDate(value);
  const moment = typeof value === "string" ? new Date(value) : value;
  if (!isValid(moment)) throw new RangeError(`Not a date: ${String(value)}`);
  return new TZDate(moment, PK_TIME_ZONE);
}

/** "04-Nov-2026" */
export function formatDate(value: IsoDate | IsoDateTime | Date): string {
  return format(toDisplayDate(value), "dd-MMM-yyyy");
}

/** "10:39 AM" (Pakistan time) */
export function formatTime(value: IsoDateTime | Date): string {
  return format(toDisplayDate(value), "hh:mm a");
}

/** "04-Nov-2026, 10:39 AM" */
export function formatDateTime(value: IsoDateTime | Date): string {
  return `${formatDate(value)}, ${formatTime(value)}`;
}

/** "Wednesday" */
export function formatWeekday(value: IsoDate | IsoDateTime | Date): string {
  return format(toDisplayDate(value), "EEEE");
}

/** "Wednesday 04-Nov-2026" */
export function formatLongDate(value: IsoDate | IsoDateTime | Date): string {
  return `${formatWeekday(value)} ${formatDate(value)}`;
}

/** Academic session label: 2026 → "2026–27" (en dash). */
export function formatSession(startYear: number): string {
  return `${startYear}–${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** Session code used inside document numbers: 2026 → "2627". */
export function sessionCode(startYear: number): string {
  return `${String(startYear % 100).padStart(2, "0")}${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** Calendar days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return differenceInCalendarDays(fromIsoDate(to), fromIsoDate(from));
}

export function toIsoDate(date: Date): IsoDate {
  return format(date, "yyyy-MM-dd");
}

export function isoDateToLocalDate(value: IsoDate): Date {
  return fromIsoDate(value);
}

const INPUT_PATTERNS = ["dd-MMM-yyyy", "d-MMM-yyyy", "dd MMM yyyy", "d MMM yyyy", "dd/MM/yyyy", "d/M/yyyy", "dd-MM-yyyy", "d-M-yyyy", "dd.MM.yyyy", "d.M.yyyy", "yyyy-MM-dd"];

/**
 * Parse what staff type into a date field. Accepts "04-Nov-2026", "4 nov 2026", "04/11/2026", "4-11-2026", "2026-11-04".
 * Day comes before month (Pakistani convention). Returns an IsoDate or null.
 */
export function parseDateInput(input: string): IsoDate | null {
  const text = input.trim().replace(/\s+/g, " ");
  if (text === "") return null;
  // Title-case month names so "nov" and "NOV" parse.
  const normalised = text.replace(/[a-z]+/gi, (m) => m.charAt(0).toUpperCase() + m.slice(1).toLowerCase());
  for (const pattern of INPUT_PATTERNS) {
    const d = parse(normalised, pattern, new Date(2000, 0, 1));
    if (isValid(d) && d.getFullYear() >= 1900 && d.getFullYear() <= 2100) return toIsoDate(d);
  }
  return null;
}
