import { createStore, del, get, keys, set, type UseStore } from "idb-keyval";

/**
 * Everything the teacher app keeps on the phone lives in one IndexedDB database ("mtb-teacher"): the offline outbox,
 * register and marks drafts, and the last data each screen showed. It survives closing the tab. When IndexedDB is
 * blocked (some private windows) the values live in memory for this page only.
 */
let store: UseStore | null | undefined;
const memory = new Map<string, unknown>();

function db(): UseStore | null {
  if (store !== undefined) return store;
  try {
    store = typeof indexedDB === "undefined" ? null : createStore("mtb-teacher", "kv");
  } catch {
    store = null;
  }
  return store;
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  const s = db();
  if (s) {
    try {
      return await get<T>(key, s);
    } catch {
      /* fall back to memory */
    }
  }
  return memory.get(key) as T | undefined;
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  memory.set(key, value);
  const s = db();
  if (!s) return;
  try {
    await set(key, value, s);
  } catch {
    /* memory only */
  }
}

export async function idbDel(key: string): Promise<void> {
  memory.delete(key);
  const s = db();
  if (!s) return;
  try {
    await del(key, s);
  } catch {
    /* nothing stored */
  }
}

export async function idbKeys(prefix: string): Promise<string[]> {
  const s = db();
  let all: string[] = [...memory.keys()];
  if (s) {
    try {
      all = [...new Set([...all, ...(await keys<string>(s)).map(String)])];
    } catch {
      /* memory only */
    }
  }
  return all.filter((k) => k.startsWith(prefix));
}

export async function idbClear(prefix: string): Promise<void> {
  for (const k of await idbKeys(prefix)) await idbDel(k);
}
