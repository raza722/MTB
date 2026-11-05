import { useCallback, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";
export type Accent = "green" | "navy";

const root = () => document.documentElement;

function snapshot(): string {
  return `${root().getAttribute("data-theme") ?? "light"}|${root().getAttribute("data-accent") ?? "green"}`;
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(root(), { attributes: true, attributeFilter: ["data-theme", "data-accent"] });
  return () => observer.disconnect();
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked (private window): the choice lasts for this page only */
  }
}

/** Light/dark theme and the green/navy brand preview, kept on <html> and remembered per browser. */
export function useAppearance() {
  const value = useSyncExternalStore(subscribe, snapshot, () => "light|green");
  const [theme, accent] = value.split("|") as [Theme, Accent];
  const setTheme = useCallback((t: Theme) => {
    root().setAttribute("data-theme", t);
    remember("mtb.theme", t);
  }, []);
  const setAccent = useCallback((a: Accent) => {
    root().setAttribute("data-accent", a);
    remember("mtb.accent", a);
  }, []);
  return { theme, accent, setTheme, setAccent };
}
