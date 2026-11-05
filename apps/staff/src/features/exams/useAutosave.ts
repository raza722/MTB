import { useCallback, useEffect, useRef, useState } from "react";

export interface AutosaveState {
  status: "idle" | "pending" | "saving" | "saved" | "error";
  savedAt?: Date;
  error?: unknown;
}

/**
 * Saves changed cells a moment after typing stops. Saves run one after another (never two at once), failed
 * keys are kept for the next attempt, and anything unsaved is sent when the page is left.
 */
export function useAutosave(flush: (keys: string[]) => Promise<void>, delay = 900) {
  const dirty = useRef(new Set<string>());
  const timer = useRef<number | undefined>(undefined);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const flushRef = useRef(flush);
  const [state, setState] = useState<AutosaveState>({ status: "idle" });

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const run = useCallback(() => {
    window.clearTimeout(timer.current);
    chain.current = chain.current.then(async () => {
      const keys = [...dirty.current];
      if (keys.length === 0) return;
      dirty.current.clear();
      setState({ status: "saving" });
      try {
        await flushRef.current(keys);
        setState(dirty.current.size ? { status: "pending" } : { status: "saved", savedAt: new Date() });
      } catch (error) {
        for (const k of keys) dirty.current.add(k);
        setState({ status: "error", error });
      }
    });
    return chain.current;
  }, []);

  const mark = useCallback(
    (key: string) => {
      dirty.current.add(key);
      setState((s) => (s.status === "saving" ? s : { status: "pending" }));
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void run(), delay);
    },
    [delay, run],
  );

  /** Drops a key that can't be saved as typed (for example a mark over the maximum). */
  const forget = useCallback((key: string) => {
    dirty.current.delete(key);
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      if (dirty.current.size) void flushRef.current([...dirty.current]).catch(() => undefined);
    },
    [],
  );

  return { state, mark, forget, saveNow: run };
}
