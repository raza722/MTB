import { formatDate, formatLakh, formatRs, type IsoDate } from "@mtb/domain";
import type { CSSProperties } from "react";

export const TODAY: IsoDate = "2026-11-04";

/** Axis ticks in lakh, the unit people at MTB count fees in: 0, 2 lakh, 4 lakh … */
export function lakhTick(v: number): string {
  if (v === 0) return "0";
  const lakh = v / 100_000;
  return `${Number.isInteger(lakh) ? lakh : lakh.toFixed(1).replace(/\.0$/, "")} lakh`;
}

/** "06 Oct" */
export function shortDate(d: IsoDate): string {
  return formatDate(d).slice(0, 6).replace("-", " ");
}

/** Rupees with lakh alongside when the preference is on: "Rs 2,140,000 (Rs 21.4 lakh)". */
export function money(amount: number, lakh: boolean): string {
  return lakh && amount >= 100_000 ? `${formatRs(amount)} (${formatLakh(amount)})` : formatRs(amount);
}

/** Days from today, in words: "Today", "Tomorrow", "In 3 days". */
export function fromToday(d: IsoDate): string {
  const days = Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${TODAY}T00:00:00Z`)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days < 0) return `${-days} days ago`;
  return `In ${days} days`;
}

/** "Good morning" by the time of day in Pakistan. */
export function greeting(now = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", hour: "2-digit", hour12: false }).format(now));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

/** "Mrs Sadia Rehman" → "Sadia". */
export function firstName(name: string): string {
  return name.replace(/^(Mr|Mrs|Ms|Miss|Dr)\.?\s+/i, "").split(/\s+/)[0] ?? name;
}

/** Stagger index for .mtb-rise / .mtb-slide-in. */
export const stagger = (i: number) => ({ "--i": i }) as CSSProperties;
