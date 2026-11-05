import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { idbClear, idbDel, idbGet, idbKeys, idbSet } from "./idb";

/**
 * Keeps the last answer of each teacher screen on the phone, so the app opens with today's classes, the register and
 * the marks sheet even with no signal, then refreshes when the connection is back. Only the teacher's own data and
 * the signed-in session are kept; signing out clears them.
 */
const PREFIX = "q:";

function keep(key: QueryKey): boolean {
  const [a, b] = key as unknown[];
  if (a === "teacher") return b !== "demo";
  if (a === "auth") return b === "session";
  return a === "hr" && b === "my-leave";
}

interface Saved {
  key: QueryKey;
  data: unknown;
  at: number;
}

export async function restoreQueries(client: QueryClient): Promise<void> {
  const ids = await idbKeys(PREFIX);
  const saved = await Promise.all(ids.map((id) => idbGet<Saved>(id)));
  for (const s of saved) {
    if (s && s.data !== undefined && !client.getQueryData(s.key)) client.setQueryData(s.key, s.data, { updatedAt: s.at });
  }
}

export function persistQueries(client: QueryClient): () => void {
  return client.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success") return;
    const q = event.query;
    if (!keep(q.queryKey) || q.state.data === undefined) return;
    void idbSet(PREFIX + JSON.stringify(q.queryKey), { key: q.queryKey, data: q.state.data, at: q.state.dataUpdatedAt } satisfies Saved);
  });
}

/** Forget everything shown on this phone (sign-out, demo reset). */
export async function clearPersisted(): Promise<void> {
  await idbClear(PREFIX);
  await idbClear("draft:");
}

/** The server said the session is over: drop the saved one so the app doesn't open signed in next time. */
export async function forgetSession(): Promise<void> {
  await idbDel(PREFIX + JSON.stringify(["auth", "session"]));
}
