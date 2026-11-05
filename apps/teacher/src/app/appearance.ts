import { useSyncExternalStore } from "react";

/** Theme and motion, chosen on this phone (More → Appearance). "system" follows the phone's own setting. */
export type ThemeChoice = "system" | "light" | "dark";
export type MotionChoice = "system" | "reduce";

const THEME_KEY = "mtb.theme";
const MOTION_KEY = "mtb.motion";
const root = () => document.documentElement;
const listeners = new Set<() => void>();
const dark = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* this page only */
  }
}

let theme: ThemeChoice = ((): ThemeChoice => {
  const t = read(THEME_KEY);
  return t === "light" || t === "dark" ? t : "system";
})();
let motion: MotionChoice = read(MOTION_KEY) === "reduce" ? "reduce" : "system";

function apply() {
  const t = theme === "system" ? (dark?.matches ? "dark" : "light") : theme;
  root().setAttribute("data-theme", t);
  if (motion === "reduce") root().setAttribute("data-motion", "reduce");
  else root().removeAttribute("data-motion");
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute("content", getComputedStyle(root()).getPropertyValue("--surface-raised").trim() || (t === "dark" ? "#121614" : "#ffffff"));
}

/** Call once at start-up. */
export function installAppearance() {
  apply();
  dark?.addEventListener("change", () => {
    if (theme === "system") {
      apply();
      listeners.forEach((l) => l());
    }
  });
}

export function setTheme(next: ThemeChoice) {
  theme = next;
  write(THEME_KEY, next === "system" ? null : next);
  apply();
  listeners.forEach((l) => l());
}

export function setMotion(next: MotionChoice) {
  motion = next;
  write(MOTION_KEY, next === "system" ? null : next);
  apply();
  listeners.forEach((l) => l());
}

export function useAppearance(): { theme: ThemeChoice; motion: MotionChoice } {
  const snap = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => `${theme}|${motion}`,
    () => "system|system",
  );
  const [t, m] = snap.split("|") as [ThemeChoice, MotionChoice];
  return { theme: t, motion: m };
}
