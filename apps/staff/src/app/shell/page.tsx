import type { CampusScope, Permission } from "@mtb/api";
import { formatSession } from "@mtb/domain";
import { buttonClassName, EmptyState, PermissionDenied, Select, type IconName } from "@mtb/ui";
import { Link } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { campusLabel } from "./campus";
import { campusesFor, useCan, useCtx, useRoleLabel, useSessionUser, useSetCtx } from "../session";

/** "Khalid Campus · Session 2026–27" — every page states what it is showing. */
export function useContextLine(): string {
  const { campus, session } = useCtx();
  return `${campusLabel(campus)} · Session ${formatSession(session)}`;
}

export interface PageHeaderProps {
  title: string;
  /** Overrides the default campus · session line. */
  context?: ReactNode;
  actions?: ReactNode;
  /** Small row under the title (badges, status). */
  meta?: ReactNode;
}

/** Page title, campus and session context, and the page's actions (primary on the right). */
export function PageHeader({ title, context, actions, meta }: PageHeaderProps) {
  const line = useContextLine();
  useEffect(() => {
    document.title = `${title} · MTB`;
  }, [title]);
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="grid min-w-0 gap-1">
        <h1 className="m-0 text-title-1">{title}</h1>
        <p className="m-0 text-small text-ink-muted">{context ?? line}</p>
        {meta && <div className="mt-1 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Standard page body: header, then content stacked with 24px gaps. */
export function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto grid w-full max-w-[1400px] grid-cols-[minmax(0,1fr)] gap-6">{children}</div>;
}

/** Shown instead of a page the user's role can't open (for example after following a link). */
export function RequirePermission({ permission, page, children }: { permission: Permission; page: string; children: ReactNode }) {
  const allowed = useCan(permission);
  const role = useRoleLabel();
  if (allowed) return <>{children}</>;
  return (
    <Page>
      <div className="mtb-card">
        <PermissionDenied
          role={role}
          page={page}
          action={
            <Link to="/dashboard" className={buttonClassName({ variant: "primary", size: "sm" })}>
              Go to dashboard
            </Link>
          }
        />
      </div>
    </Page>
  );
}

/** Campus-specific actions (fee counter, attendance correction) need one campus, not "All campuses". */
export function RequireSingleCampus({ action, children }: { action: string; children: ReactNode }) {
  const { campus } = useCtx();
  const user = useSessionUser();
  const setCtx = useSetCtx();
  if (campus !== "ALL") return <>{children}</>;
  const options = campusesFor(user).filter((c): c is Exclude<CampusScope, "ALL"> => c !== "ALL");
  return (
    <div className="mtb-card">
      <EmptyState
        icon="building"
        title={`Choose a campus to use ${action}`}
        description="You are viewing all campuses. This work always belongs to one campus, so pick it here."
        action={
          <div className="mt-2 w-64 text-left">
            <Select label="Campus" defaultValue="" onChange={(e) => e.target.value && setCtx({ campus: e.target.value as CampusScope })} options={[{ value: "", label: "Choose…" }, ...options.map((c) => ({ value: c, label: campusLabel(c) }))]} />
          </div>
        }
      />
    </div>
  );
}

/** A tidy page for modules outside this release. */
export function PlannedPage({ title, icon, description, items }: { title: string; icon: IconName; description: string; items: string[] }) {
  return (
    <Page>
      <PageHeader title={title} />
      <div className="mtb-card">
        <EmptyState
          icon={icon}
          title="Planned for phase 2"
          description={description}
          action={
            <ul className="m-0 mt-2 grid list-none gap-1 p-0 text-left text-small text-ink-muted">
              {items.map((i) => (
                <li key={i}>· {i}</li>
              ))}
            </ul>
          }
        />
      </div>
    </Page>
  );
}
