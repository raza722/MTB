import type { PortalChallenge } from "@mtb/api";

/**
 * The code we are waiting for, kept in this tab only (sessionStorage) between the sign-in and code pages, so the
 * URL never carries a phone number or a challenge id.
 */
export interface PendingChallenge extends PortalChallenge {
  /** What the person typed (normalised mobile or G.R. number), to fill the form again on "Use a different number". */
  identifier: string;
  /** When the last code was sent (this device's clock), for the resend countdown. */
  sentAt: number;
}

const KEY = "mtb.portal.challenge";
let memory: PendingChallenge | null = null;

export function savePending(c: PendingChallenge) {
  memory = c;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* memory only */
  }
}

export function loadPending(): PendingChallenge | null {
  if (memory) return memory;
  try {
    const raw = sessionStorage.getItem(KEY);
    memory = raw ? (JSON.parse(raw) as PendingChallenge) : null;
  } catch {
    memory = null;
  }
  return memory;
}

export function clearPending() {
  memory = null;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
}
