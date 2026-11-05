import { setupPasswordChecks, type LoginResult } from "@mtb/api";
import { http } from "msw";
import { DEMO_MFA_CODE, DEMO_PASSWORD, USERS } from "../fixtures/users";
import { fail, HttpResponse, latency } from "../util";
import { authStore, currentUser } from "./auth-state";
import { setupAccountById, setupAccountByUsername, setupPasswordChosen, setupRecordSignIn } from "./setup";

const mask = (mobile: string) => `${mobile.slice(0, 4)}-•••••${mobile.slice(-2)}`;
const id = () => Math.random().toString(36).slice(2, 10);

async function digestOf(password: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The password that works for this account: the one the person chose at first sign-in, or the demo password if they
 * haven't chosen one (or an admin reset it in Setup since).
 */
async function passwordMatches(userId: string, password: string) {
  const chosen = authStore.get().chosenPasswords?.[userId];
  const setup = setupAccountById(userId);
  const resetSince = setup ? (setup.passwordChangedAt ?? null) !== chosen?.at || setup.mustChangePassword : false;
  if (!chosen || resetSince) return password === DEMO_PASSWORD;
  return (await digestOf(password)) === chosen.digest;
}

/**
 * Sign-in reads the accounts in Setup → Users (disabled and locked accounts are refused, five wrong passwords lock an
 * account, "must change password" and two-step follow the account), falling back to the demo fixtures for anyone Setup
 * doesn't know. Every demo account starts with the demo password and two-step code in fixtures/users.ts; a password
 * chosen at first sign-in replaces the demo one for that account until an admin resets it in Setup.
 */
function accountFor(username: string) {
  const name = username.trim().toLowerCase();
  const setup = setupAccountByUsername(name);
  if (setup) return { id: setup.id, username: setup.username, mobile: setup.mobile, mfa: setup.twoStep, mustChange: setup.mustChangePassword, status: setup.status, inSetup: true };
  const demo = USERS.find((u) => u.username === name);
  if (!demo) return null;
  const changed = authStore.get().passwordChanged.includes(demo.id);
  return { id: demo.id, username: demo.username, mobile: demo.mobile, mfa: demo.mfa, mustChange: demo.mustChangePassword && !changed, status: "ACTIVE" as const, inSetup: false };
}

function accountById(userId: string) {
  const setup = setupAccountById(userId);
  if (setup) return { username: setup.username, mobile: setup.mobile };
  const demo = USERS.find((u) => u.id === userId);
  return demo ? { username: demo.username, mobile: demo.mobile } : null;
}

export const authHandlers = [
  http.get("/api/auth/session", async () => {
    await latency();
    const user = currentUser();
    return user ? HttpResponse.json(user) : fail(401, "UNAUTHENTICATED", "Please sign in.");
  }),

  http.post("/api/auth/login", async ({ request }) => {
    await latency();
    const { username, password } = (await request.json()) as { username: string; password: string };
    const account = accountFor(username ?? "");
    if (!account) return fail(401, "INVALID_CREDENTIALS", "Username or password is incorrect. Check Caps Lock and try again.");
    if (account.status === "DISABLED") return fail(423, "ACCOUNT_DISABLED", "This account is disabled. Ask your campus admin.");
    if (account.status === "LOCKED") return fail(423, "ACCOUNT_LOCKED", "This account is locked after too many wrong passwords. Ask your campus admin to unlock it.");
    if (!(await passwordMatches(account.id, password ?? ""))) {
      if (!account.inSetup) return fail(401, "INVALID_CREDENTIALS", "Username or password is incorrect. Check Caps Lock and try again.");
      const r = setupRecordSignIn(account.id, "WRONG_PASSWORD");
      if (r.locked) return fail(423, "ACCOUNT_LOCKED", "Too many wrong passwords, so this account is now locked. Ask your campus admin to unlock it.");
      const warn = r.attemptsLeft <= 2 ? ` ${r.attemptsLeft} more wrong ${r.attemptsLeft === 1 ? "try locks" : "tries lock"} the account.` : "";
      return fail(401, "INVALID_CREDENTIALS", `Username or password is incorrect. Check Caps Lock and try again.${warn}`);
    }

    let result: LoginResult;
    if (account.mustChange) {
      const token = id();
      authStore.set((s) => ({ ...s, resetTokens: { ...s.resetTokens, [token]: account.id } }));
      result = { status: "password_reset_required", resetToken: token };
    } else if (account.mfa) {
      const challengeId = id();
      authStore.set((s) => ({ ...s, challenges: { ...s.challenges, [challengeId]: { userId: account.id, attemptsLeft: 3 } } }));
      result = { status: "mfa_required", challengeId, maskedPhone: mask(account.mobile) };
    } else {
      if (account.inSetup) setupRecordSignIn(account.id, "SUCCESS");
      authStore.set((s) => ({ ...s, userId: account.id }));
      const user = currentUser();
      if (!user) return fail(500, "ERROR", "Sign-in failed. Try again.");
      result = { status: "ok", user };
    }
    return HttpResponse.json(result);
  }),

  http.post("/api/auth/mfa/sms", async ({ request }) => {
    await latency();
    const { challengeId } = (await request.json()) as { challengeId: string };
    const ch = authStore.get().challenges[challengeId];
    const user = ch && accountById(ch.userId);
    if (!user) return fail(410, "CHALLENGE_EXPIRED", "This sign-in has expired. Start again.");
    return HttpResponse.json({ maskedPhone: mask(user.mobile) });
  }),

  http.post("/api/auth/mfa", async ({ request }) => {
    await latency();
    const { challengeId, code } = (await request.json()) as { challengeId: string; code: string };
    const ch = authStore.get().challenges[challengeId];
    if (!ch) return fail(410, "CHALLENGE_EXPIRED", "This sign-in has expired. Start again.");
    if (ch.attemptsLeft <= 0) return fail(423, "MFA_LOCKED", "Too many incorrect codes. Try again in 15 minutes, or ask your campus admin to unlock your account.");
    if (code !== DEMO_MFA_CODE) {
      const attemptsLeft = ch.attemptsLeft - 1;
      authStore.set((s) => ({ ...s, challenges: { ...s.challenges, [challengeId]: { ...ch, attemptsLeft } } }));
      if (setupAccountById(ch.userId)) setupRecordSignIn(ch.userId, "WRONG_CODE");
      if (attemptsLeft <= 0) return fail(423, "MFA_LOCKED", "Too many incorrect codes. Try again in 15 minutes, or ask your campus admin to unlock your account.");
      return fail(401, "MFA_INVALID", `Incorrect code. ${attemptsLeft} ${attemptsLeft === 1 ? "attempt" : "attempts"} left.`, { details: { attemptsLeft } });
    }
    authStore.set((s) => {
      const { [challengeId]: _used, ...rest } = s.challenges;
      return { ...s, userId: ch.userId, challenges: rest };
    });
    if (setupAccountById(ch.userId)) setupRecordSignIn(ch.userId, "SUCCESS");
    const user = currentUser();
    return user ? HttpResponse.json(user) : fail(423, "ACCOUNT_LOCKED", "This account can't be used right now. Ask your campus admin.");
  }),

  http.post("/api/auth/reset-password", async ({ request }) => {
    await latency();
    const { resetToken, newPassword } = (await request.json()) as { resetToken: string; newPassword: string };
    const userId = authStore.get().resetTokens[resetToken];
    if (!userId) return fail(410, "RESET_EXPIRED", "This reset link has expired. Sign in again to get a new one.");
    const username = accountById(userId)?.username ?? "";
    const failed = setupPasswordChecks(newPassword ?? "", username).find((c) => !c.ok);
    if (failed) {
      const fix: Record<string, string> = {
        length: "Use 8 to 72 characters.",
        letter: "Add at least one letter.",
        digit: "Add at least one number.",
        username: "Choose a password that doesn't contain your username.",
      };
      return fail(422, "WEAK_PASSWORD", `This password can't be used. ${fix[failed.id] ?? failed.label}`, { field: "newPassword" });
    }
    if (setupAccountById(userId)) setupPasswordChosen(userId);
    const digest = await digestOf(newPassword);
    const at = setupAccountById(userId)?.passwordChangedAt ?? null;
    authStore.set((s) => {
      const { [resetToken]: _used, ...rest } = s.resetTokens;
      return { ...s, resetTokens: rest, passwordChanged: [...s.passwordChanged, userId], chosenPasswords: { ...s.chosenPasswords, [userId]: { digest, at } } };
    });
    return HttpResponse.json({ status: "ok" });
  }),

  http.post("/api/auth/logout", async () => {
    await latency();
    authStore.set((s) => ({ ...s, userId: null }));
    return HttpResponse.json({ status: "ok" });
  }),
];
