import { onlineManager } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

/**
 * Online means the browser has a connection and the presenter hasn't switched the demo offline. TanStack Query's
 * onlineManager carries the answer, so screens pause their refreshes and the outbox waits while offline.
 */
const KEY = "mtb.teacher.offline";
let simulated = readSimulated();
let push: ((online: boolean) => void) | null = null;
const listeners = new Set<() => void>();

function readSimulated(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

const computeOnline = () => (typeof navigator === "undefined" || navigator.onLine) && !simulated;

/** Call once at start-up, before the first query runs. */
export function installNetwork() {
  onlineManager.setEventListener((setOnline) => {
    const update = () => setOnline(computeOnline());
    push = setOnline;
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    update();
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      push = null;
    };
  });
}

/** Demo control: behave as if the phone lost its signal (it survives a reload of this tab). */
export function setSimulatedOffline(value: boolean) {
  simulated = value;
  try {
    if (value) sessionStorage.setItem(KEY, "1");
    else sessionStorage.removeItem(KEY);
  } catch {
    /* this page only */
  }
  (push ?? ((o: boolean) => onlineManager.setOnline(o)))(computeOnline());
  listeners.forEach((l) => l());
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
    () => true,
  );
}

export function useSimulatedOffline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => simulated,
    () => false,
  );
}
