import { useSyncExternalStore } from "react";

/**
 * Installable app and app-shell cache. The production build registers /sw.js, which keeps the app's files on the
 * phone so it opens with no signal. In the mock demo the Mock Service Worker owns the page's service-worker slot
 * (one per site), so the shell cache is left out there and offline is shown with More → Demo → Go offline.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || import.meta.env.VITE_USE_MOCKS !== "false") return;
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      /* the app still works online without it */
    });
  });
}

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

/** Remembers the browser's install offer so More can show "Install on this phone". */
export function captureInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

export function useInstallPrompt(): (() => Promise<void>) | null {
  const available = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => deferred !== null,
    () => false,
  );
  if (!available) return null;
  return async () => {
    const e = deferred;
    if (!e) return;
    await e.prompt();
    await e.userChoice;
    deferred = null;
    listeners.forEach((l) => l());
  };
}

/** True when the app runs from the home screen (installed), not a browser tab. */
export const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches ?? false;
