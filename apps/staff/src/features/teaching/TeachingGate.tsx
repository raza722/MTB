import type { ReactNode } from "react";
import { RequirePermission, RequireSingleCampus } from "../../app/shell/page";
import { canTeach, useCtx, useSessionUser } from "../../app/session";

/**
 * The Teaching pages need the teacher.app right at the campus on screen. A teacher works at one campus, so with
 * "All campuses" selected the page asks for one first.
 */
export function TeachingGate({ children }: { children: ReactNode }) {
  const { campus } = useCtx();
  const user = useSessionUser();
  if (campus === "ALL" && canTeach(user, "ALL")) return <RequireSingleCampus action="your teaching pages">{children}</RequireSingleCampus>;
  return (
    <RequirePermission permission="teacher.app" page="Teaching">
      {children}
    </RequirePermission>
  );
}
