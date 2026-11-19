import { newIdempotencyKey } from "@mtb/api";
import { useState } from "react";

/**
 * One Idempotency-Key per draft: the same key while the inputs stay the same (a double click or a retry
 * after a timeout replays the first answer), a new key as soon as any input changes.
 *
 * Do not write `useMemo(() => newIdempotencyKey(), [a, b])`: the React Compiler memoises on what the
 * callback reads, and this callback reads nothing, so it keeps ONE key for the whole life of the
 * component. The second document posted from the same screen then reuses the first one's key and the
 * server refuses it ("This idempotency key was already used for a different request.").
 *
 * The inputs are compared by value (their JSON), so a list rebuilt with the same content keeps the key,
 * and the last signature is kept in state (React's "information from previous renders" pattern). The
 * hook is kept out of the compiler ("use no memo"): it treats newIdempotencyKey() as a pure call and
 * caches its first answer, so every "new" key would be the same one.
 */
const spelledOut = (_key: string, value: unknown): unknown =>
  value instanceof Set ? { set: [...value] } : value instanceof Map ? { map: [...value] } : value; // JSON writes both as {}

export function useIdempotencyKey(...inputs: unknown[]): string {
  "use no memo"; // the compiler takes newIdempotencyKey() for pure and would cache one key for good
  const signature = JSON.stringify(inputs, spelledOut);
  const [draft, setDraft] = useState(() => ({ signature, key: newIdempotencyKey() }));
  if (draft.signature === signature) return draft.key;
  const next = { signature, key: newIdempotencyKey() };
  setDraft(next);
  return next.key;
}
