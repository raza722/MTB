import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { CampusCode, CampusScope } from "./context";

/** feature.action permissions, granted through roles per campus. */
export type Permission =
  | "dashboard.view"
  | "students.view"
  | "students.edit"
  | "fees.view"
  | "fees.collect"
  | "fees.cancel.request"
  | "approvals.decide"
  | "attendance.view"
  /** Mark a register the class teacher could not, and request changes to a submitted one (office). */
  | "attendance.mark"
  /** Add, change or remove holidays, vacations and events in the school calendar. */
  | "attendance.calendar"
  | "exams.view"
  | "exams.manage"
  | "exams.declare"
  | "admissions.view"
  | "admissions.manage"
  | "accounts.view"
  | "accounts.post"
  | "sms.view"
  | "sms.send"
  | "sms.pause"
  | "settings.manage"
  | "setup.manage"
  | "users.manage"
  | "timetable.view"
  | "timetable.manage"
  | "activities.view"
  | "activities.manage"
  | "fees.setup"
  | "fees.reports"
  | "hr.view"
  | "hr.manage"
  | "payroll.manage"
  | "library.view"
  | "library.manage"
  | "warehouse.view"
  | "warehouse.manage"
  | "transport.view"
  | "transport.manage"
  | "reports.view"
  | "teacher.app"
  /** Campus-level setup at the user's own campus: sections, seats, rooms, class and subject teachers, school-day times. */
  | "setup.campus"
  /** Read-only fee card: the Fee ledger tab on a student's profile, nothing else in Fees. */
  | "fees.card";

export type RoleCode = "PRINCIPAL" | "CASHIER" | "ACCOUNTANT" | "ADMIN" | "TEACHER" | "OFFICE";

export interface RoleGrant {
  /** A system RoleCode, or the code of a custom role made in Setup → Roles (e.g. "EXAM_OFFICE"). */
  role: RoleCode | (string & {});
  /** "Cashier" */
  roleName: string;
  /** "ALL" = every campus. */
  campus: CampusScope;
  /** "Khalid Campus" or "All campuses" */
  campusName: string;
  /** For an all-campus grant: what it allows with "All campuses" selected. For a campus grant: what it allows there. */
  permissions: Permission[];
  /**
   * All-campus grants only: what the grant allows at each campus, with that campus's module switches applied
   * (e.g. no payroll.manage where Payroll is switched off). `can()` uses it when one campus is selected.
   */
  campusPermissions?: Partial<Record<CampusCode, Permission[]>>;
}

export interface SessionUser {
  id: string;
  username: string;
  name: string;
  roles: RoleGrant[];
}

export type LoginResult =
  | { status: "mfa_required"; challengeId: string; maskedPhone: string }
  | { status: "password_reset_required"; resetToken: string }
  | { status: "ok"; user: SessionUser };

export interface MfaErrorDetails {
  attemptsLeft: number;
}

export const authApi = {
  session: () => apiFetch<SessionUser>("/auth/session"),
  login: (body: { username: string; password: string }) => apiFetch<LoginResult>("/auth/login", { method: "POST", body }),
  verifyMfa: (body: { challengeId: string; code: string; method: "app" | "sms" }) => apiFetch<SessionUser>("/auth/mfa", { method: "POST", body }),
  sendSmsCode: (challengeId: string) => apiFetch<{ maskedPhone: string }>("/auth/mfa/sms", { method: "POST", body: { challengeId } }),
  resetPassword: (body: { resetToken: string; newPassword: string }) => apiFetch<{ status: "ok" }>("/auth/reset-password", { method: "POST", body }),
  logout: () => apiFetch<{ status: "ok" }>("/auth/logout", { method: "POST" }),
};

export const authQueries = {
  session: () =>
    queryOptions({
      queryKey: ["auth", "session"],
      queryFn: authApi.session,
      retry: false,
      staleTime: 5 * 60_000,
    }),
};

/** Grants that apply to a campus scope. With "ALL" selected only all-campus grants apply. */
export function grantsFor(user: SessionUser | undefined, campus: CampusScope): RoleGrant[] {
  if (!user) return [];
  return user.roles.filter((g) => g.campus === "ALL" || (campus !== "ALL" && g.campus === campus));
}

/** What one grant allows in a campus scope: an all-campus grant at one campus follows that campus's module switches. */
export function grantPermissions(g: RoleGrant, campus: CampusScope): Permission[] {
  if (g.campus !== "ALL" || campus === "ALL") return g.permissions;
  return g.campusPermissions?.[campus] ?? g.permissions;
}

/** The single permission check used by menus, buttons and route guards. The API enforces it again. */
export function can(user: SessionUser | undefined, permission: Permission, campus: CampusScope): boolean {
  return grantsFor(user, campus).some((g) => grantPermissions(g, campus).includes(permission));
}

/** "Cashier — Khalid Campus" */
export function roleLabel(user: SessionUser | undefined, campus: CampusScope): string {
  const g = grantsFor(user, campus)[0] ?? user?.roles[0];
  return g ? `${g.roleName} — ${g.campusName}` : "No role";
}
