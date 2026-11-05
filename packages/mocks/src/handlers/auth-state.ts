import type { SessionUser } from "@mtb/api";
import { createStore } from "../db";
import { USERS, toSessionUser, type DemoUser } from "../fixtures/users";

interface AuthState {
  userId: string | null;
  challenges: Record<string, { userId: string; attemptsLeft: number }>;
  resetTokens: Record<string, string>;
  /** Users who already replaced their first-time password. */
  passwordChanged: string[];
  /**
   * Passwords people chose at first sign-in, as SHA-256 digests (never the text), with Setup's passwordChangedAt at
   * that moment. Once chosen, sign-in needs that password; an admin reset in Setup afterwards brings back the demo one.
   */
  chosenPasswords?: Record<string, { digest: string; at: string | null }>;
}

export const authStore = createStore<AuthState>("auth", () => ({ userId: null, challenges: {}, resetTokens: {}, passwordChanged: [] }));

/**
 * Where signed-in users come from: Setup's users and roles (handlers/setup.ts registers itself when the mock server
 * loads). Returns null for an account that can't be used now (locked or disabled), undefined for one Setup doesn't
 * know. Registered rather than imported, so this module stays free of import cycles (util.ts depends on it).
 */
type AccountSource = (userId: string) => SessionUser | null | undefined;
let accounts: AccountSource | null = null;

export function registerAccountSource(source: AccountSource) {
  accounts = source;
}

export function currentDemoUser(): DemoUser | null {
  const id = authStore.get().userId;
  return USERS.find((u) => u.id === id) ?? null;
}

/**
 * The signed-in user, with role grants and permissions from Setup (Users and Roles), so a role change or a custom
 * role applies once the session is refetched, and a locked or disabled account is signed out at its next request.
 */
export function currentUser(): SessionUser | null {
  const id = authStore.get().userId;
  if (!id) return null;
  const fromSetup = accounts?.(id);
  if (fromSetup !== undefined) return fromSetup;
  const u = currentDemoUser();
  return u ? toSessionUser(u) : null;
}
