import { authQueries, can, CURRENT_SESSION, metaQueries, roleLabel, type CampusScope, type Ctx, type Permission, type SessionInfo, type SessionUser } from "@mtb/api";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState, useSearch } from "@tanstack/react-router";
import type { ReactNode } from "react";

/** The signed-in user. Inside the app shell the session is already loaded. */
export function useSessionUser(): SessionUser | undefined {
  return useQuery(authQueries.session()).data;
}

/** Default campus: the user's first grant ("ALL" for all-campus roles). */
export function defaultCampus(user: SessionUser | undefined): CampusScope {
  return user?.roles[0]?.campus ?? "KC";
}

/** Campus and session from the URL (retained across every link). */
export function useCtx(): Ctx {
  const user = useSessionUser();
  const search = useSearch({ strict: false }) as { campus?: CampusScope; session?: number };
  const allowed = campusesFor(user);
  const campus = search.campus && allowed.includes(search.campus) ? search.campus : defaultCampus(user);
  return { campus, session: search.session ?? CURRENT_SESSION };
}

export function useSetCtx() {
  const navigate = useNavigate();
  return (next: Partial<Ctx>) =>
    navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => ({ ...prev, ...(next.campus ? { campus: next.campus } : {}), ...(next.session ? { session: next.session === CURRENT_SESSION ? undefined : next.session } : {}) }),
    } as never);
}

/** Campuses a user may switch to: their granted campuses, plus "ALL" for all-campus roles. */
export function campusesFor(user: SessionUser | undefined): CampusScope[] {
  if (!user) return [];
  if (user.roles.some((g) => g.campus === "ALL")) return ["ALL", "KC", "SM", "UC", "MC", "HC"];
  return [...new Set(user.roles.map((g) => g.campus))];
}

export function useCan(permission: Permission): boolean {
  const user = useSessionUser();
  const { campus } = useCtx();
  return can(user, permission, campus);
}

export function useRoleLabel(): string {
  const user = useSessionUser();
  const { campus } = useCtx();
  return roleLabel(user, campus);
}

export type SessionStatus = SessionInfo["status"];

/** The open session's status from Setup → Sessions (planned, current, ended, closed). Before it loads, judged by the year. */
export function useSessionStatus(): SessionStatus {
  const { session } = useCtx();
  const sessions = useQuery(metaQueries.sessions()).data;
  const found = sessions?.find((s) => s.startYear === session);
  if (found) return found.status;
  return session === CURRENT_SESSION ? "CURRENT" : session > CURRENT_SESSION ? "PLANNED" : "ENDED";
}

/**
 * Pages where next year is prepared while it is still planned: its sections, seats, rooms and teachers, and its intake
 * (Admissions takes applications, tests, merit lists, offers and admissions for next year during this year).
 */
const PLANNED_EDITABLE = ["/setup/classes", "/setup/teachers", "/admissions"];

/**
 * Editing and posting are switched off outside the current session. A planned session stays editable on the pages
 * that prepare it (Setup → Classes, Teacher allotment and Admissions); ended and closed sessions are read-only everywhere.
 */
export function useReadOnly(): boolean {
  const status = useSessionStatus();
  const path = useRouterState({ select: (s) => s.location.pathname });
  if (status === "CURRENT") return false;
  if (status === "PLANNED") return !PLANNED_EDITABLE.some((p) => path === p || path.startsWith(`${p}/`));
  return true;
}

/** Shows children only when the user has the permission at the current campus. Convenience only; the API enforces it too. */
export function Can({ permission, children, fallback = null }: { permission: Permission; children: ReactNode; fallback?: ReactNode }) {
  return useCan(permission) ? <>{children}</> : <>{fallback}</>;
}
