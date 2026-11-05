import type { Permission, RoleCode, RoleGrant, SessionUser } from "@mtb/api";
import { campusName } from "./campuses";

/**
 * Fictional demo accounts for the mock server only. Every account uses DEMO_PASSWORD; two-factor accounts
 * accept DEMO_MFA_CODE. These values exist only in this file and never reach a real server.
 */
export const DEMO_PASSWORD = "Mtb@Demo2026";
export const DEMO_MFA_CODE = "246810";

export const ROLE_PERMISSIONS: Record<RoleCode, Permission[]> = {
  CASHIER: ["dashboard.view", "students.view", "fees.view", "fees.collect", "fees.cancel.request", "fees.reports", "reports.view", "sms.send"],
  PRINCIPAL: [
    "dashboard.view",
    "students.view",
    "students.edit",
    "fees.view",
    "fees.cancel.request",
    "approvals.decide",
    "attendance.view",
    "attendance.mark",
    "attendance.calendar",
    "exams.view",
    "exams.manage",
    "exams.declare",
    "admissions.view",
    "admissions.manage",
    "sms.view",
    "sms.send",
    "users.manage",
    "setup.campus",
    "timetable.view",
    "timetable.manage",
    "activities.view",
    "activities.manage",
    "fees.reports",
    "hr.view",
    "library.view",
    "warehouse.view",
    "transport.view",
    "reports.view",
  ],
  ACCOUNTANT: ["dashboard.view", "students.view", "fees.view", "fees.setup", "fees.reports", "accounts.view", "accounts.post", "hr.view", "payroll.manage", "reports.view"],
  ADMIN: [
    "dashboard.view",
    "students.view",
    "students.edit",
    "fees.view",
    "approvals.decide",
    "attendance.view",
    "attendance.mark",
    "attendance.calendar",
    "exams.view",
    "exams.manage",
    "exams.declare",
    "admissions.view",
    "admissions.manage",
    "accounts.view",
    "sms.view",
    "sms.send",
    "sms.pause",
    "settings.manage",
    "setup.manage",
    "users.manage",
    "timetable.view",
    "timetable.manage",
    "activities.view",
    "activities.manage",
    "fees.setup",
    "fees.reports",
    "hr.view",
    "hr.manage",
    "payroll.manage",
    "library.view",
    "library.manage",
    "warehouse.view",
    "warehouse.manage",
    "transport.view",
    "transport.manage",
    "reports.view",
  ],
  TEACHER: ["dashboard.view", "students.view", "attendance.view", "timetable.view", "teacher.app"],
  OFFICE: [
    "dashboard.view",
    "students.view",
    "students.edit",
    "admissions.view",
    "admissions.manage",
    "attendance.view",
    "attendance.mark",
    "timetable.view",
    "activities.view",
    "hr.view",
    "library.view",
    "library.manage",
    "warehouse.view",
    "warehouse.manage",
    "transport.view",
    "transport.manage",
    "reports.view",
    "sms.view",
    "sms.send",
  ],
};

const ROLE_NAME: Record<RoleCode, string> = { CASHIER: "Cashier", PRINCIPAL: "Principal", ACCOUNTANT: "Accountant", ADMIN: "Admin", TEACHER: "Teacher", OFFICE: "Office staff" };

const grant = (role: RoleCode, campus: RoleGrant["campus"]): RoleGrant => ({
  role,
  roleName: ROLE_NAME[role],
  campus,
  campusName: campusName(campus),
  permissions: ROLE_PERMISSIONS[role],
});

/** Custom roles seeded in Setup → Roles. Accounts holding them sign in with these permissions (or with later edits in Setup). */
export interface CustomRoleSeed {
  id: string;
  code: string;
  name: string;
  description: string;
  scope: "CAMPUS" | "ANY";
  permissions: Permission[];
  twoStepRequired: boolean;
}

export const CUSTOM_ROLES: CustomRoleSeed[] = [
  {
    id: "role-exam-office",
    code: "EXAM_OFFICE",
    name: "Exam office",
    description: "Prepares exams, date sheets and marks entry for a campus, prints result sheets and sends result SMS. Cannot declare results.",
    scope: "CAMPUS",
    permissions: ["dashboard.view", "students.view", "attendance.view", "exams.view", "exams.manage", "timetable.view", "reports.view", "sms.view", "sms.send"],
    twoStepRequired: false,
  },
  {
    id: "role-office-admin",
    code: "OFFICE_ADMIN",
    name: "Office admin",
    description: "Senior front office: everything Office staff do, plus result sheets, houses and scholarships, timetables, staff records and staff attendance, and the student fee card.",
    scope: "CAMPUS",
    permissions: [...ROLE_PERMISSIONS.OFFICE, "exams.view", "activities.manage", "timetable.manage", "hr.manage", "fees.card"],
    twoStepRequired: false,
  },
];

const customGrant = (code: string, campus: RoleGrant["campus"]): RoleGrant => {
  const r = CUSTOM_ROLES.find((x) => x.code === code)!;
  return { role: r.code, roleName: r.name, campus, campusName: campusName(campus), permissions: [...r.permissions] };
};

export interface DemoUser extends SessionUser {
  mobile: string;
  mfa: boolean;
  mustChangePassword: boolean;
  /** One line shown on the sign-in page's demo account list. */
  demoNote: string;
}

export const USERS: DemoUser[] = [
  { id: "u-usman", username: "usman.ali", name: "Usman Ali", mobile: "0301-5550142", mfa: true, mustChangePassword: false, roles: [grant("CASHIER", "KC")], demoNote: "Flow 1: fee counter" },
  { id: "u-sadia", username: "sadia.rehman", name: "Mrs Sadia Rehman", mobile: "0302-5550178", mfa: true, mustChangePassword: false, roles: [grant("PRINCIPAL", "KC")], demoNote: "Approvals, declare results" },
  { id: "u-nadia", username: "nadia.shah", name: "Nadia Shah", mobile: "0303-5550113", mfa: true, mustChangePassword: false, roles: [grant("ACCOUNTANT", "ALL")], demoNote: "Journal vouchers, all campuses" },
  { id: "u-kamran", username: "kamran.yousaf", name: "Kamran Yousaf", mobile: "0304-5550190", mfa: true, mustChangePassword: false, roles: [grant("ADMIN", "ALL")], demoNote: "Pause all SMS, all campuses" },
  { id: "u-hina", username: "hina.javed", name: "Ms Hina Javed", mobile: "0305-5550166", mfa: false, mustChangePassword: true, roles: [grant("TEACHER", "KC")], demoNote: "First sign-in: forced password reset" },
  { id: "u-farah", username: "farah.naz", name: "Farah Naz", mobile: "0306-5550121", mfa: true, mustChangePassword: false, roles: [grant("OFFICE", "KC")], demoNote: "Library, warehouse, transport" },
  { id: "u-saima", username: "saima.akram", name: "Ms Saima Akram", mobile: "0312-5550118", mfa: true, mustChangePassword: false, roles: [customGrant("EXAM_OFFICE", "KC"), grant("TEACHER", "KC")], demoNote: "Exam office: marks entry, result sheets, results SMS" },
  { id: "u-rehana", username: "rehana.kausar", name: "Ms Rehana Kausar", mobile: "0309-5550187", mfa: true, mustChangePassword: false, roles: [customGrant("OFFICE_ADMIN", "KC")], demoNote: "Office admin: front office, results, houses, staff, fee card" },
];

export function toSessionUser(u: DemoUser): SessionUser {
  return { id: u.id, username: u.username, name: u.name, roles: u.roles };
}
