// English and Urdu messages and right-to-left helpers for the portal (and later the other apps).
// No dependencies: the language lives in a tiny store that React apps read with useSyncExternalStore
// (the portal's useLang hook in apps/portal/src/app/i18n.tsx), so this package stays framework-free.
import { en, type MessageKey } from "./en";
import { ur } from "./ur";

export { en, ur, type MessageKey };

export type Lang = "en" | "ur";
export const LANGS: readonly Lang[] = ["en", "ur"];

export const dirOf = (lang: Lang): "ltr" | "rtl" => (lang === "ur" ? "rtl" : "ltr");

export const MESSAGES: Record<Lang, Record<MessageKey, string>> = { en, ur };

export type Vars = Record<string, string | number>;

/** Fills {name} placeholders. Unknown placeholders are left as they are, so a missing value is visible, not silent. */
export function interpolate(template: string, vars: Vars = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/** The message for a key in a language, with placeholders filled. Falls back to English. */
export function t(lang: Lang, key: MessageKey, vars?: Vars): string {
  return interpolate(MESSAGES[lang][key] ?? en[key], vars);
}

/** One/other plural: tp(lang, "home.daysLeft", 6) reads "home.daysLeft.one" or "home.daysLeft.other". */
export function pluralKey<K extends string>(base: K, n: number): `${K}.one` | `${K}.other` {
  return n === 1 ? `${base}.one` : `${base}.other`;
}

export type MessagePart = { text: string } | { slot: string };

/** A message split into text and {slots}, so an app can put left-to-right pieces (amounts, dates) into the slots. */
export function messageParts(lang: Lang, key: MessageKey): MessagePart[] {
  const template = MESSAGES[lang][key] ?? en[key];
  const parts: MessagePart[] = [];
  let last = 0;
  for (const m of template.matchAll(/\{(\w+)\}/g)) {
    if (m.index > last) parts.push({ text: template.slice(last, m.index) });
    parts.push({ slot: m[1]! });
    last = m.index + m[0].length;
  }
  if (last < template.length) parts.push({ text: template.slice(last) });
  return parts;
}

// ---------------------------------------------------------------------------------------------------------
// Calendar words. Dates themselves stay "04-Nov-2026" in both languages (brief §7.13); these are for headings.
// ---------------------------------------------------------------------------------------------------------

const MONTHS: Record<Lang, string[]> = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  ur: ["جنوری", "فروری", "مارچ", "اپریل", "مئی", "جون", "جولائی", "اگست", "ستمبر", "اکتوبر", "نومبر", "دسمبر"],
};
const MONTHS_SHORT_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Sunday first, as Date.getDay() counts. */
const WEEKDAYS: Record<Lang, string[]> = {
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  ur: ["اتوار", "پیر", "منگل", "بدھ", "جمعرات", "جمعہ", "ہفتہ"],
};

/** "November" / "نومبر" (month 0 = January). Short English form: "Nov". */
export function monthName(lang: Lang, month: number, short = false): string {
  if (short && lang === "en") return MONTHS_SHORT_EN[month] ?? "";
  return MONTHS[lang][month] ?? "";
}

/** "Wednesday" / "بدھ" for an ISO date ("2026-11-04"), with no time-zone shift. */
export function weekdayName(lang: Lang, isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number) as [number, number, number];
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return WEEKDAYS[lang][day] ?? "";
}

// ---------------------------------------------------------------------------------------------------------
// The chosen language: one small store per app, saved on this device, applied to <html lang dir>.
// ---------------------------------------------------------------------------------------------------------

export interface LangStore {
  get(): Lang;
  set(lang: Lang): void;
  subscribe(listener: () => void): () => void;
}

/** Sets lang and dir on <html>, so the whole layout mirrors (logical CSS does the rest). */
export function applyLang(lang: Lang, root: HTMLElement | null = typeof document !== "undefined" ? document.documentElement : null) {
  if (!root) return;
  root.setAttribute("lang", lang);
  root.setAttribute("dir", dirOf(lang));
}

export function readSavedLang(storageKey: string): Lang | null {
  try {
    const v = localStorage.getItem(storageKey);
    return v === "en" || v === "ur" ? v : null;
  } catch {
    return null;
  }
}

/** A language store saved under `storageKey` (per device). Starts from the saved choice or `fallback`. */
export function createLangStore(storageKey: string, fallback: Lang = "en"): LangStore {
  let lang: Lang = readSavedLang(storageKey) ?? fallback;
  const listeners = new Set<() => void>();
  applyLang(lang);
  return {
    get: () => lang,
    set(next) {
      if (next === lang) return;
      lang = next;
      try {
        localStorage.setItem(storageKey, next);
      } catch {
        /* this page only */
      }
      applyLang(next);
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
