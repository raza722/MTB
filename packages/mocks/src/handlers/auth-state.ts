import type { LoginResult, SessionUser } from "@mtb/api";
import { bypass, http, type HttpHandler } from "msw";
import { createStore } from "../db";

/**
 * Sign-in is real now (staff and teacher apps): the backend answers /api/auth/*. The mocks of the modules that are not
 * built yet still need to know who is signed in, so these handlers tap the real auth calls on their way through:
 * each request goes to the backend unchanged (`bypass`), the SessionUser from a successful answer is remembered here,
 * and the real response goes back to the app as it came. Mock permission checks then use the real user's grants
 * (same campus codes and permission codes as the backend). The portal's own sign-in (/api/portal/*) stays mocked.
 */
interface AuthState {
  user: SessionUser | null;
}

// Kept when the demo data is reset: the real sign-in does not change when the fictional data does.
export const authStore = createStore<AuthState>("auth", () => ({ user: null }), { keepOnReset: true });

/** The signed-in user as the real backend last reported it, or null. */
export function currentUser(): SessionUser | null {
  return authStore.get().user;
}

const remember = (user: SessionUser | null) => authStore.set({ user });

/** The session call on its way to the backend right now, so mocked requests made meanwhile can wait for it. */
let inFlight: Promise<unknown> | null = null;

/**
 * Lets a mocked request that arrives while the real session call is still running wait for it (the teacher app, for
 * one, opens with its saved session and checks it in the background while the first screen loads its data).
 */
export async function sessionSettled(): Promise<void> {
  if (inFlight) await inFlight.catch(() => undefined);
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.clone().json();
  } catch {
    return null;
  }
}

/**
 * Sends the request to the real backend and returns its response unchanged; `onAnswer` sees the status and JSON body.
 * No answer at all (backend down) comes back to the app as a network error, as it would without the mock server.
 */
async function passThrough(request: Request, onAnswer: (status: number, body: unknown) => void): Promise<Response> {
  const call = (async () => {
    let res: Response;
    try {
      res = await fetch(bypass(request));
    } catch {
      return Response.error();
    }
    onAnswer(res.status, await readJson(res));
    return res;
  })();
  inFlight = call;
  try {
    return await call;
  } finally {
    if (inFlight === call) inFlight = null;
  }
}

const isUser = (x: unknown): x is SessionUser => typeof x === "object" && x !== null && "id" in x && Array.isArray((x as SessionUser).roles);

export const authTapHandlers: HttpHandler[] = [
  http.get("/api/auth/session", ({ request }) =>
    passThrough(request, (status, body) => {
      if (status === 200 && isUser(body)) remember(body);
      else if (status === 401) remember(null);
    }),
  ),

  http.post("/api/auth/login", ({ request }) =>
    passThrough(request, (status, body) => {
      const result = body as LoginResult | null;
      if (status === 200 && result?.status === "ok" && isUser(result.user)) remember(result.user);
    }),
  ),

  // Two-step sign-in ends here, not at /login: a verified code returns the SessionUser.
  http.post("/api/auth/mfa", ({ request }) =>
    passThrough(request, (status, body) => {
      if (status === 200 && isUser(body)) remember(body);
    }),
  ),

  // Signed out for the mocks even if the backend can't be reached: the app signs out locally either way.
  http.post("/api/auth/logout", ({ request }) => {
    remember(null);
    return passThrough(request, () => undefined);
  }),
];
