import { ApiError, newIdempotencyKey, teacherApi, type Ctx, type ExamsMark, type TeacherChangeInput, type TeacherPaperRef, type TeacherRegisterSubmit } from "@mtb/api";
import { onlineManager, type QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { idbGet, idbSet } from "../idb";

/**
 * The offline outbox. Every write the teacher makes (submit a register, ask for a change, save or submit marks) is
 * first stored on the phone in IndexedDB, then sent in order. Offline, it waits and the app says "Offline — saved on
 * this phone"; when the connection returns it sends everything ("Syncing…", then "Synced 08:42 AM"). Each item keeps
 * one Idempotency-Key for all its attempts, so a retry after a timeout can't create a second register.
 */

export type OutboxPayload =
  | { kind: "register.submit"; classSection: string; body: TeacherRegisterSubmit }
  | { kind: "register.change"; classSection: string; studentName: string; body: TeacherChangeInput }
  | { kind: "marks.save"; ref: TeacherPaperRef; marks: Record<string, ExamsMark> }
  | { kind: "marks.submit"; ref: TeacherPaperRef; marks: Record<string, ExamsMark> };

export interface OutboxItem {
  /** Also the Idempotency-Key. */
  id: string;
  ctx: Ctx;
  payload: OutboxPayload;
  /** "7-B register · 04-Nov-2026" */
  label: string;
  /** Items with the same key replace each other while waiting (autosaved marks). */
  coalesceKey?: string;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

export type OutboxResult =
  | { status: "sent"; data: unknown }
  | { status: "queued"; reason: "offline" | "failed"; message?: string }
  | { status: "superseded" }
  | { status: "rejected"; error: ApiError };

export interface SyncState {
  items: OutboxItem[];
  phase: "idle" | "syncing" | "failed";
  lastSyncedAt: number | null;
  error: string | null;
  loaded: boolean;
}

let state: SyncState = { items: [], phase: "idle", lastSyncedAt: null, error: null, loaded: false };
const listeners = new Set<() => void>();
const waiters = new Map<string, (r: OutboxResult) => void>();
const rejectListeners = new Set<(item: OutboxItem, error: ApiError) => void>();
const sentListeners = new Set<(item: OutboxItem) => void>();
let client: QueryClient | null = null;
let flushing: Promise<void> | null = null;
let inFlight: string | null = null;

function emit(next: Partial<SyncState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

const persist = () => idbSet("outbox", state.items);

function settle(id: string, result: OutboxResult) {
  const w = waiters.get(id);
  waiters.delete(id);
  w?.(result);
}

function send(item: OutboxItem): Promise<unknown> {
  const p = item.payload;
  switch (p.kind) {
    case "register.submit":
      return teacherApi.submitRegister(item.ctx, p.classSection, p.body, item.id);
    case "register.change":
      return teacherApi.requestChange(item.ctx, p.classSection, p.body, item.id);
    case "marks.save":
      return teacherApi.saveMarks(item.ctx, p.ref, p.marks, item.id);
    case "marks.submit":
      return teacherApi.submitMarks(item.ctx, p.ref, p.marks, item.id);
  }
}

/** Loads the waiting items from the phone and sends them whenever the connection is there. Call once. */
export async function initOutbox(qc: QueryClient): Promise<void> {
  client = qc;
  const items = (await idbGet<OutboxItem[]>("outbox")) ?? [];
  const lastSyncedAt = (await idbGet<number>("lastSyncedAt")) ?? null;
  emit({ items, lastSyncedAt, loaded: true });
  onlineManager.subscribe((online) => {
    if (online) void flush();
  });
  if (onlineManager.isOnline() && items.length) void flush();
}

/** Stores a write on the phone and sends it if there is a connection. */
export function enqueue(input: { ctx: Ctx; payload: OutboxPayload; label: string; coalesceKey?: string }): Promise<OutboxResult> {
  const item: OutboxItem = { id: newIdempotencyKey(), createdAt: Date.now(), attempts: 0, ...input };
  let items = state.items;
  if (item.coalesceKey) {
    for (const old of items.filter((i) => i.coalesceKey === item.coalesceKey && i.id !== inFlight)) settle(old.id, { status: "superseded" });
    items = items.filter((i) => i.coalesceKey !== item.coalesceKey || i.id === inFlight);
  }
  emit({ items: [...items, item] });
  void persist();
  const result = new Promise<OutboxResult>((resolve) => waiters.set(item.id, resolve));
  if (onlineManager.isOnline()) void flush();
  else settle(item.id, { status: "queued", reason: "offline" });
  return result;
}

/** Sends every waiting item, oldest first. Stops at the first item the server couldn't take (it stays on the phone). */
export function flush(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    if (!state.items.length || !onlineManager.isOnline()) return;
    emit({ phase: "syncing", error: null });
    let failed = false;
    let sent = 0;
    while (state.items.length && onlineManager.isOnline()) {
      const item = state.items[0]!;
      inFlight = item.id;
      try {
        const data = await send(item);
        sent++;
        const at = Date.now();
        emit({ items: state.items.filter((i) => i.id !== item.id), lastSyncedAt: at });
        void idbSet("lastSyncedAt", at);
        const watched = waiters.has(item.id);
        settle(item.id, { status: "sent", data });
        if (!watched) sentListeners.forEach((l) => l(item));
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError(0, "NETWORK", "No response from the server.");
        if (err.isNetwork || err.status >= 500 || err.status === 401 || err.status === 408 || err.status === 429) {
          // The server didn't take it: keep it on the phone and try again later.
          emit({ items: state.items.map((i) => (i.id === item.id ? { ...i, attempts: i.attempts + 1, lastError: err.message } : i)), phase: "failed", error: err.message });
          settle(item.id, { status: "queued", reason: "failed", message: err.message });
          failed = true;
          break;
        }
        // The server said no (already submitted, not allowed, invalid): it won't work on a retry either.
        emit({ items: state.items.filter((i) => i.id !== item.id) });
        // A screen waiting for this answer shows the error itself; items sent later in the background are reported by the shell.
        const watched = waiters.has(item.id);
        settle(item.id, { status: "rejected", error: err });
        if (!watched) rejectListeners.forEach((l) => l(item, err));
      } finally {
        inFlight = null;
        void persist();
      }
    }
    if (!failed) emit({ phase: "idle", error: null });
    if (sent) await client?.invalidateQueries({ queryKey: ["teacher"] });
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

/** "Sync failed — Retry". */
export const retrySync = () => flush();

/** Drops a waiting item (the teacher decided not to send it). */
export function discard(id: string) {
  emit({ items: state.items.filter((i) => i.id !== id || i.id === inFlight) });
  settle(id, { status: "superseded" });
  void persist();
  if (!state.items.length) emit({ phase: "idle", error: null });
}

/** Forget everything waiting (sign-out, demo reset). */
export async function clearOutbox() {
  for (const i of state.items) settle(i.id, { status: "superseded" });
  emit({ items: [], phase: "idle", error: null, lastSyncedAt: null });
  await idbSet("outbox", []);
  await idbSet("lastSyncedAt", null);
}

/** Called when the server turns down a waiting item, so the shell can tell the teacher. */
export function onRejected(listener: (item: OutboxItem, error: ApiError) => void): () => void {
  rejectListeners.add(listener);
  return () => rejectListeners.delete(listener);
}

/** Called when an item saved earlier (offline) reaches the server in the background, so the shell can say so. */
export function onSent(listener: (item: OutboxItem) => void): () => void {
  sentListeners.add(listener);
  return () => sentListeners.delete(listener);
}

export function useSync(): SyncState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state,
  );
}

export const syncSnapshot = () => state;
