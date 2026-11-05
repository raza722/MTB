import { can, type CampusScope, type Ctx, type Permission, type SessionUser } from "@mtb/api";
import { delay, HttpResponse } from "msw";
import { currentUser } from "./handlers/auth-state";

/** Every mocked request waits a little, like a real server. */
export const latency = () => delay(180 + Math.round(Math.random() * 260));

export function fail(status: number, code: string, message: string, extra: { field?: string; details?: unknown } = {}) {
  return HttpResponse.json({ code, message, ...extra }, { status });
}

export function ctxFrom(url: URL): Ctx {
  const campus = (url.searchParams.get("campus") ?? "KC") as CampusScope;
  const session = Number(url.searchParams.get("session") ?? 2026);
  return { campus, session };
}

/** Returns the signed-in user, or a 401 response. */
export function requireUser(): SessionUser | Response {
  return currentUser() ?? fail(401, "UNAUTHENTICATED", "Please sign in.");
}

/** The server enforces permissions too; hiding buttons is only a convenience. */
export function requirePermission(permission: Permission, campus: CampusScope): SessionUser | Response {
  const user = requireUser();
  if (user instanceof Response) return user;
  if (!can(user, permission, campus)) return fail(403, "FORBIDDEN", "Your role can't do this at this campus.");
  return user;
}

export { HttpResponse };
