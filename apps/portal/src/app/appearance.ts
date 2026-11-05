import { useSyncExternalStore } from "react";

/** Light or dark display, chosen on this device. "system" follows the phone or computer's own setting. */
export type ThemeChoice = "system" | "light" | "dark";

const KEY = "mtb.theme";
const listeners = new Set<() => void>();
const darkQuery = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

function read(): ThemeChoice {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

let theme: ThemeChoice = read();

export const resolvedTheme = (): "light" | "dark" => (theme === "system" ? (darkQuery?.matches ? "dark" : "light") : theme);

function apply() {
  const t = resolvedTheme();
  const root = document.documentElement;
  root.setAttribute("data-theme", t);
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute("content", getComputedStyle(root).getPropertyValue("--surface-raised").trim() || (t === "dark" ? "#121614" : "#ffffff"));
}

/** Call once at start-up. */
export function installAppearance() {
  apply();
  darkQuery?.addEventListener("change", () => {
    if (theme === "system") {
      apply();
      listeners.forEach((l) => l());
    }
  });
}

export function setTheme(next: ThemeChoice) {
  theme = next;
  try {
    if (next === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    /* this page only */
  }
  apply();
  listeners.forEach((l) => l());
}

/** The choice and what it resolves to right now. */
export function useTheme(): { theme: ThemeChoice; resolved: "light" | "dark" } {
  const snap = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => `${theme}|${resolvedTheme()}`,
    () => "system|light",
  );
  const [t, r] = snap.split("|") as [ThemeChoice, "light" | "dark"];
  return { theme: t, resolved: r };
}
