import { ApiError, can, CURRENT_SESSION, type Permission, type SetupConflictDetails, setupPasswordChecks } from "@mtb/api";
import { formatDate, formatSession, formatTime, type IsoDateTime } from "@mtb/domain";
import { Banner, Button, buttonClassName, Icon, PermissionDenied, Tooltip, type ButtonProps } from "@mtb/ui";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import type { z } from "zod";
import { useCtx, useReadOnly, useRoleLabel, useSessionStatus, useSessionUser } from "../../app/session";
import { SubNav, type SubNavItem } from "../../app/shell/SubNav";
import { Page, PageHeader } from "../../app/shell/page";
import "./setup.css";

/* ------------------------------------------------------------------ Navigation and guards */

interface SetupNavItem extends SubNavItem {
  any: Permission[];
}

const NAV: SetupNavItem[] = [
  { to: "/setup", label: "Overview", icon: "dashboard", exact: true, any: ["setup.manage", "setup.campus", "users.manage"] },
  { to: "/setup/campuses", label: "Campuses", icon: "building", any: ["setup.manage", "setup.campus"] },
  { to: "/setup/sessions", label: "Sessions", icon: "calendar", any: ["setup.manage"] },
  { to: "/setup/classes", label: "Classes", icon: "layers", any: ["setup.manage", "setup.campus"] },
  { to: "/setup/subjects", label: "Subjects", icon: "book", any: ["setup.manage"] },
  { to: "/setup/teachers", label: "Teachers", icon: "students", any: ["setup.manage", "setup.campus"] },
  { to: "/setup/users", label: "Users", icon: "user", any: ["users.manage"] },
  { to: "/setup/roles", label: "Roles", icon: "shield", any: ["setup.manage", "users.manage"] },
  { to: "/setup/campus-settings", label: "Campus settings", icon: "settings", any: ["settings.manage"] },
  { to: "/setup/audit", label: "Audit log", icon: "listChecks", any: ["setup.manage", "users.manage"] },
];

/** True when the user has any of the permissions at the current campus. */
export function useCanAny(perms: Permission[]): boolean {
  const user = useSessionUser();
  const { campus } = useCtx();
  return perms.some((p) => can(user, p, campus));
}

/** Setup's own pages as tabs; each tab shows only when the role can use it. */
export function SetupNav() {
  const user = useSessionUser();
  const { campus } = useCtx();
  const items = NAV.filter((n) => n.any.some((p) => can(user, p, campus))).map(({ any: _any, ...rest }) => rest);
  return <SubNav items={items} label="Setup" />;
}

/** RequirePermission for a page that more than one permission can open. */
export function RequireAny({ any, page, children }: { any: Permission[]; page: string; children: ReactNode }) {
  const allowed = useCanAny(any);
  const role = useRoleLabel();
  if (allowed) return <>{children}</>;
  return (
    <Page>
      <div className="mtb-card">
        <PermissionDenied
          role={role}
          page={page}
          grantedBy="head office"
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

/** Page shell for every Setup page: header with campus and session, then the Setup tabs, then the content. */
export function SetupPage({ title, actions, meta, context, children }: { title: string; actions?: ReactNode; meta?: ReactNode; context?: ReactNode; children: ReactNode }) {
  return (
    <Page>
      <div className="grid gap-4">
        <PageHeader title={title} {...(actions ? { actions } : {})} {...(meta ? { meta } : {})} {...(context ? { context } : {})} />
        <SetupNav />
      </div>
      {children}
    </Page>
  );
}

/* ------------------------------------------------------------------ Read-only past session */

/** Why nothing can be changed in the open session: ended, closed, or planned (only sections and teachers are prepared). */
export function useReadOnlyText(): string {
  const { session } = useCtx();
  const status = useSessionStatus();
  const now = formatSession(CURRENT_SESSION);
  if (status === "PLANNED") return `${formatSession(session)} is planned. Only its sections and teachers can be prepared now. Switch to ${now} for everything else.`;
  if (status === "CLOSED") return `${formatSession(session)} is closed and locked. Switch to ${now} to make changes.`;
  return `${formatSession(session)} is read-only. Switch to ${now} to make changes.`;
}

/** A button that is switched off (with the reason in a tooltip) while a past session is open. */
export function EditButton({ reason, ...props }: ButtonProps & { reason?: string | null }) {
  const readOnly = useReadOnly();
  const text = useReadOnlyText();
  const why = readOnly ? text : (reason ?? null);
  if (!why) return <Button {...props} />;
  return (
    <Tooltip content={why}>
      <span tabIndex={0} className="inline-flex rounded-md">
        <Button {...props} disabled />
      </span>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ Errors and conflicts */

/** Plain-English message for any failed request. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.isNetwork ? "No response from the server. Check the connection and try again." : e.message;
  return "Something went wrong. Try again.";
}

/** "The users could not be loaded." with the reason and a Try again button. */
export function QueryError({ what, error, onRetry }: { what: string; error: unknown; onRetry: () => void }) {
  return (
    <Banner
      tone="danger"
      title={`${what} could not be loaded.`}
      actions={
        <Button size="sm" variant="secondary" icon="refresh" onClick={onRetry}>
          Try again
        </Button>
      }
    >
      {errorText(error)}
    </Banner>
  );
}

export interface Conflict {
  by: string;
  at: IsoDateTime;
}

/** Reads a 409 CONCURRENCY error into who changed the record and when. */
export function conflictOf(e: unknown): Conflict | null {
  if (e instanceof ApiError && e.status === 409 && e.code === "CONCURRENCY") {
    const d = e.details as SetupConflictDetails | undefined;
    return { by: d?.changedBy ?? "someone else", at: d?.changedAt ?? new Date().toISOString() };
  }
  return null;
}

/** "This record was changed by Farah Naz at 10:42 — reload". Nothing was saved; reloading shows their change. */
export function ConflictBanner({ conflict, onReload, reloading }: { conflict: Conflict; onReload: () => void; reloading?: boolean }) {
  return (
    <Banner
      tone="warning"
      title={`This record was changed by ${conflict.by} at ${formatTime(conflict.at)} on ${formatDate(conflict.at)}.`}
      actions={
        <Button size="sm" variant="secondary" icon="refresh" onClick={onReload} loading={Boolean(reloading)}>
          Reload
        </Button>
      }
    >
      Your changes were not saved, so nothing of theirs was overwritten. Reload to see the latest version, then make your change again.
    </Banner>
  );
}

/** Field errors from a 422 (field + message) or a zod result, keyed by field name. */
export type FieldErrors = Partial<Record<string, string>>;

export function apiFieldError(e: unknown): FieldErrors | null {
  if (e instanceof ApiError && e.status === 422 && e.field) return { [e.field]: e.message };
  return null;
}

export function zodErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** Spread into a field: `{...err(errors, "name")}` adds `error` only when there is one. */
export const err = (errors: FieldErrors, key: string) => (errors[key] ? { error: errors[key] } : {});

/* ------------------------------------------------------------------ Small pieces */

/** "Today, 08:02 AM", "Yesterday, 04:48 PM" or "02-Nov-2026". */
export function whenText(at: IsoDateTime | null, today = "2026-11-04"): string {
  if (!at) return "Never";
  const day = at.slice(0, 10);
  if (day === today) return `Today, ${formatTime(at)}`;
  const y = new Date(`${today}T00:00:00Z`);
  y.setUTCDate(y.getUTCDate() - 1);
  if (day === y.toISOString().slice(0, 10)) return `Yesterday, ${formatTime(at)}`;
  return `${formatDate(at)}, ${formatTime(at)}`;
}

/** The server's password rules, ticked off live as the admin types. */
export function PasswordRules({ password, username }: { password: string; username: string }) {
  const checks = setupPasswordChecks(password, username);
  return (
    <ul className="setup-rules" aria-label="Password rules">
      {checks.map((c) => (
        <li key={c.id} className={c.ok ? "is-ok" : undefined}>
          <Icon name={c.ok ? "checkCircle" : "minus"} size={16} />
          <span>{c.label}</span>
          <span className="mtb-sr-only">{c.ok ? "met" : "not met yet"}</span>
        </li>
      ))}
    </ul>
  );
}

/** A readable temporary password that meets the rules: "Garden-7342-Lamp". */
export function suggestPassword(): string {
  const words = ["River", "Garden", "Mango", "Lamp", "Cotton", "Falcon", "Desert", "Pearl", "Cedar", "Orchid", "Kite", "Harbour"];
  const pick = () => words[Math.floor(Math.random() * words.length)]!;
  return `${pick()}-${1000 + Math.floor(Math.random() * 9000)}-${pick()}`;
}

/** Show/hide toggle inside a password field. */
export function useReveal() {
  const [shown, setShown] = useState(false);
  return {
    type: shown ? "text" : "password",
    action: (
      <button type="button" className="setup-reveal" onClick={() => setShown((s) => !s)} aria-label={shown ? "Hide password" : "Show password"} aria-pressed={shown}>
        <Icon name={shown ? "eyeOff" : "eye"} size={16} />
      </button>
    ),
  };
}

/** An A4 landscape sheet that appears only when printing (access review, roles matrix), with sign-off lines. */
export function PrintSheet({ title, scope, children, signatures = ["Prepared by", "Principal", "Head office"] }: { title: string; scope: string; children: ReactNode; signatures?: string[] }) {
  return (
    <section className="mtb-print-area setup-print-only setup-print-a4" aria-hidden="true">
      <header className="setup-print-head">
        <div>
          <div style={{ fontSize: "9pt" }}>MTB School &amp; College Management System</div>
          <h1>{title}</h1>
          <div>{scope}</div>
        </div>
        <div style={{ fontSize: "9pt" }}>Printed {formatDate("2026-11-04")}</div>
      </header>
      {children}
      <div className="setup-print-sign">
        {signatures.map((s) => (
          <div key={s}>{s}: name, signature and date</div>
        ))}
      </div>
    </section>
  );
}

/** One labelled figure inside a panel. */
export function Figure({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-caption uppercase text-ink-muted">{label}</span>
      <span className="text-numeric-large tabular-nums text-ink">{children}</span>
      {hint && <span className="text-small text-ink-muted">{hint}</span>}
    </div>
  );
}
