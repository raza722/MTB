import { authQueries, can, CURRENT_SESSION, type CampusCode, type Ctx, type Permission, type SessionUser } from "@mtb/api";
import { formatSession } from "@mtb/domain";
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export function useSessionUser(): SessionUser | undefined {
  return useQuery(authQueries.session()).data;
}

/** Campuses where this person may use the teacher app (a teacher at two campuses has one account at both). */
export function teacherCampuses(user: SessionUser | undefined): CampusCode[] {
  if (!user) return [];
  const out = user.roles.filter((g) => g.campus !== "ALL" && g.permissions.includes("teacher.app")).map((g) => g.campus as CampusCode);
  return [...new Set(out)];
}

const CAMPUS_KEY = "mtb.teacher.campus";

export function rememberedCampus(user: SessionUser | undefined): CampusCode | null {
  const list = teacherCampuses(user);
  try {
    const saved = localStorage.getItem(CAMPUS_KEY) as CampusCode | null;
    if (saved && list.includes(saved)) return saved;
  } catch {
    /* storage blocked */
  }
  return list[0] ?? null;
}

function rememberCampus(campus: CampusCode) {
  try {
    localStorage.setItem(CAMPUS_KEY, campus);
  } catch {
    /* this page only */
  }
}

interface CtxValue {
  ctx: Ctx;
  setCampus: (campus: CampusCode) => void;
}

const CtxContext = createContext<CtxValue | null>(null);

/**
 * Campus and session for every query key. The phone works in the current session only; earlier sessions are read in
 * the staff app. A teacher posted at two campuses switches campus in More.
 */
export function CtxProvider({ initial, children }: { initial: CampusCode; children: ReactNode }) {
  const [campus, setCampusState] = useState<CampusCode>(initial);
  const value = useMemo<CtxValue>(
    () => ({
      ctx: { campus, session: CURRENT_SESSION },
      setCampus: (c) => {
        rememberCampus(c);
        setCampusState(c);
      },
    }),
    [campus],
  );
  return <CtxContext.Provider value={value}>{children}</CtxContext.Provider>;
}

export function useCtx(): Ctx {
  const v = useContext(CtxContext);
  if (!v) throw new Error("useCtx outside CtxProvider");
  return v.ctx;
}

export function useSetCampus(): (campus: CampusCode) => void {
  const v = useContext(CtxContext);
  if (!v) throw new Error("useSetCampus outside CtxProvider");
  return v.setCampus;
}

/** True when the session on screen is closed (marks and registers can't change). */
export function useReadOnly(): boolean {
  return useCtx().session !== CURRENT_SESSION;
}

export function useCan(permission: Permission): boolean {
  const user = useSessionUser();
  const v = useContext(CtxContext);
  return v ? can(user, permission, v.ctx.campus) : false;
}

/** "Khalid Campus · Session 2026–27" — the context line under a screen's title. */
export function useContextLine(): string {
  const user = useSessionUser();
  const v = useContext(CtxContext);
  if (!v) return "";
  const name = user?.roles.find((r) => r.campus === v.ctx.campus)?.campusName ?? v.ctx.campus;
  return `${name} · Session ${formatSession(v.ctx.session)}`;
}
