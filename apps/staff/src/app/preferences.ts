import { useSyncExternalStore } from "react";

/** Per-browser display preferences for the open decisions (Settings → Open decisions). */
export interface Preferences {
  /** Open decision: show large totals in lakh too ("Rs 48.25 lakh"). */
  showLakh: boolean;
}

const KEY = "mtb.preferences";
const DEFAULTS: Preferences = { showLakh: false };
const listeners = new Set<() => void>();
let cache: Preferences | null = null;

function read(): Preferences {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Preferences>) };
  } catch {
    cache = DEFAULTS;
  }
  return cache;
}

export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]) {
  cache = { ...read(), [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* storage blocked: lasts for this page */
  }
  listeners.forEach((l) => l());
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => DEFAULTS,
  );
}
