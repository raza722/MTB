// Setup and user management — owned by the setup feature.
// Campuses, academic sessions, classes, sections, groups, subjects, teacher allotment, users, roles,
// campus settings and the audit log. Every editable record carries `rowVer`; saving with an old rowVer
// returns 409 CONCURRENCY with `details: SetupConflictDetails`, as the real backend does.
import type { IsoDate, IsoDateTime } from "@mtb/domain";
import { queryOptions } from "@tanstack/react-query";
import type { Permission } from "./auth";
import { apiFetch } from "./client";
import { ctxKey, ctxQuery, type CampusCode, type CampusScope, type Ctx } from "./context";

/* ------------------------------------------------------------------ Shared */

/** Sent back with a 409 CONCURRENCY error: who saved the record since it was opened. */
export interface SetupConflictDetails {
  changedBy: string;
  changedAt: IsoDateTime;
}

export interface SetupPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/* ------------------------------------------------------------------ Modules */

export type SetupModuleCode =
  | "STUDENTS"
  | "ADMISSIONS"
  | "ATTENDANCE"
  | "TIMETABLE"
  | "EXAMS"
  | "UNIVERSITY_EXAMS"
  | "ACTIVITIES"
  | "FEES"
  | "ACCOUNTS"
  | "HR"
  | "PAYROLL"
  | "STAFF_ATTENDANCE"
  | "LIBRARY"
  | "WAREHOUSE"
  | "TRANSPORT"
  | "SMS"
  | "PORTAL"
  | "TEACHER_APP";

export interface SetupModuleInfo {
  code: SetupModuleCode;
  name: string;
  description: string;
  group: "Academics" | "Finance and staff" | "Campus operations" | "Families and messages";
  /** Core modules are always on. */
  core: boolean;
}

export const SETUP_MODULES: SetupModuleInfo[] = [
  { code: "STUDENTS", name: "Students", description: "Student records, families, promotion, certificates", group: "Academics", core: true },
  { code: "ADMISSIONS", name: "Admissions", description: "Enquiries, entry tests, merit lists, admission", group: "Academics", core: false },
  { code: "ATTENDANCE", name: "Attendance", description: "Daily registers and corrections", group: "Academics", core: true },
  { code: "TIMETABLE", name: "Timetable", description: "Class and teacher timetables, substitutions", group: "Academics", core: false },
  { code: "EXAMS", name: "Exams and results", description: "Term exams, tests, result cards, positions", group: "Academics", core: true },
  { code: "UNIVERSITY_EXAMS", name: "University exams", description: "Semester exams for degree programmes", group: "Academics", core: false },
  { code: "ACTIVITIES", name: "Scholarships and activities", description: "Scholarship tests, houses, events, sports", group: "Academics", core: false },
  { code: "FEES", name: "Fees", description: "Fee structure, vouchers, collection, fines", group: "Finance and staff", core: true },
  { code: "ACCOUNTS", name: "Accounts", description: "Journal vouchers, ledgers, trial balance", group: "Finance and staff", core: false },
  { code: "HR", name: "Staff records", description: "Staff profiles, qualifications, postings", group: "Finance and staff", core: false },
  { code: "PAYROLL", name: "Payroll", description: "Salary sheets, slips, loans and advances", group: "Finance and staff", core: false },
  { code: "STAFF_ATTENDANCE", name: "Staff attendance devices", description: "Fingerprint machines for staff attendance", group: "Finance and staff", core: false },
  { code: "LIBRARY", name: "Library", description: "Catalogue, issue and return, overdue lists", group: "Campus operations", core: false },
  { code: "WAREHOUSE", name: "Warehouse", description: "Stock received, issued and remaining", group: "Campus operations", core: false },
  { code: "TRANSPORT", name: "Transport", description: "Vehicles, routes and students who use them", group: "Campus operations", core: false },
  { code: "SMS", name: "SMS and notifications", description: "Templates, sending, delivery reports", group: "Families and messages", core: false },
  { code: "PORTAL", name: "Parent and student portal", description: "Results, attendance and fees for families", group: "Families and messages", core: false },
  { code: "TEACHER_APP", name: "Teacher app", description: "Attendance and marks from teachers' phones", group: "Families and messages", core: false },
];

/* ------------------------------------------------------------------ Permissions catalogue */

export interface SetupPermissionInfo {
  code: Permission;
  label: string;
  /** Sensitive actions: role changes are recorded and need head office. */
  sensitive?: boolean;
}

export interface SetupPermissionGroup {
  module: string;
  permissions: SetupPermissionInfo[];
}

/** Every permission in plain words, grouped by module, as the roles matrix shows them. */
export const SETUP_PERMISSION_GROUPS: SetupPermissionGroup[] = [
  { module: "Dashboard", permissions: [{ code: "dashboard.view", label: "See the dashboard" }] },
  {
    module: "Students",
    permissions: [
      { code: "students.view", label: "View student records" },
      { code: "students.edit", label: "Edit student records" },
    ],
  },
  {
    module: "Admissions",
    permissions: [
      { code: "admissions.view", label: "View enquiries and applications" },
      { code: "admissions.manage", label: "Run admissions and merit lists" },
    ],
  },
  {
    module: "Attendance",
    permissions: [
      { code: "attendance.view", label: "View registers and attendance reports" },
      { code: "attendance.mark", label: "Mark registers and request changes" },
      { code: "attendance.calendar", label: "Edit the school calendar" },
    ],
  },
  {
    module: "Timetable",
    permissions: [
      { code: "timetable.view", label: "View timetables" },
      { code: "timetable.manage", label: "Build timetables and substitutions" },
    ],
  },
  {
    module: "Exams",
    permissions: [
      { code: "exams.view", label: "View exams and results" },
      { code: "exams.manage", label: "Create exams and enter marks" },
      { code: "exams.declare", label: "Declare results to families", sensitive: true },
    ],
  },
  {
    module: "Scholarships and activities",
    permissions: [
      { code: "activities.view", label: "View scholarships, houses and events" },
      { code: "activities.manage", label: "Manage scholarships, houses and events" },
    ],
  },
  {
    module: "Fees",
    permissions: [
      { code: "fees.view", label: "View fees and ledgers" },
      { code: "fees.card", label: "See a student's fee card (read only)" },
      { code: "fees.collect", label: "Collect fees and post receipts" },
      { code: "fees.cancel.request", label: "Ask to cancel a receipt" },
      { code: "fees.setup", label: "Set fee structure, fines and vouchers", sensitive: true },
      { code: "fees.reports", label: "Run fee reports" },
    ],
  },
  { module: "Approvals", permissions: [{ code: "approvals.decide", label: "Approve corrections and cancellations", sensitive: true }] },
  {
    module: "Accounts",
    permissions: [
      { code: "accounts.view", label: "View ledgers and statements" },
      { code: "accounts.post", label: "Post journal vouchers", sensitive: true },
    ],
  },
  {
    module: "Staff and payroll",
    permissions: [
      { code: "hr.view", label: "View staff records" },
      { code: "hr.manage", label: "Edit staff records" },
      { code: "payroll.manage", label: "Prepare and approve salaries", sensitive: true },
    ],
  },
  {
    module: "Library",
    permissions: [
      { code: "library.view", label: "View the library catalogue" },
      { code: "library.manage", label: "Issue, return and catalogue books" },
    ],
  },
  {
    module: "Warehouse",
    permissions: [
      { code: "warehouse.view", label: "View stock" },
      { code: "warehouse.manage", label: "Receive and issue stock" },
    ],
  },
  {
    module: "Transport",
    permissions: [
      { code: "transport.view", label: "View vehicles and routes" },
      { code: "transport.manage", label: "Manage vehicles, routes and riders" },
    ],
  },
  {
    module: "SMS",
    permissions: [
      { code: "sms.view", label: "View messages and delivery" },
      { code: "sms.send", label: "Send messages to families and staff" },
      { code: "sms.pause", label: "Pause all SMS", sensitive: true },
    ],
  },
  { module: "Reports", permissions: [{ code: "reports.view", label: "Open reports" }] },
  { module: "Teacher app", permissions: [{ code: "teacher.app", label: "Use the teacher app" }] },
  {
    module: "Setup and security",
    permissions: [
      { code: "setup.manage", label: "Manage campuses, sessions, classes and roles", sensitive: true },
      { code: "setup.campus", label: "Set up sections and teachers at their own campus" },
      { code: "users.manage", label: "Manage user accounts", sensitive: true },
      { code: "settings.manage", label: "Change campus settings" },
    ],
  },
];

export const SETUP_PERMISSIONS: SetupPermissionInfo[] = SETUP_PERMISSION_GROUPS.flatMap((g) => g.permissions);

export function setupPermissionLabel(code: Permission): string {
  return SETUP_PERMISSIONS.find((p) => p.code === code)?.label ?? code;
}

/* ------------------------------------------------------------------ Password rules */

export interface SetupPasswordCheck {
  id: "length" | "letter" | "digit" | "username";
  label: string;
  ok: boolean;
}

/** The server's password rules (8–72 characters, a letter and a digit, not containing the username). Shown live while typing. */
export function setupPasswordChecks(password: string, username: string): SetupPasswordCheck[] {
  const u = username.trim().toLowerCase();
  return [
    { id: "length", label: "8 to 72 characters", ok: password.length >= 8 && password.length <= 72 },
    { id: "letter", label: "At least one letter", ok: /[A-Za-z]/.test(password) },
    { id: "digit", label: "At least one number", ok: /\d/.test(password) },
    { id: "username", label: "Does not contain the username", ok: password.length > 0 && (u === "" || !password.toLowerCase().includes(u)) },
  ];
}

export const setupPasswordOk = (password: string, username: string) => setupPasswordChecks(password, username).every((c) => c.ok);

/* ------------------------------------------------------------------ Phone numbers */

/** An 11-digit mobile number starting with 03: "0300-5550101". */
export const setupIsMobile = (v: string) => /^03\d{2}-?\d{7}$/.test(v.trim());

/** A mobile, or a landline with its area code: 9 to 11 digits starting with 0, one hyphen allowed ("068-5550100"). */
export function setupIsPhone(v: string): boolean {
  const t = v.trim();
  if (setupIsMobile(t)) return true;
  if (!/^0\d{1,4}-?\d{5,9}$/.test(t)) return false;
  const digits = t.replace(/\D/g, "").length;
  return digits >= 9 && digits <= 11;
}

/* ------------------------------------------------------------------ Section names */

/**
 * Section names: a letter ("B"), a word ("Khadija"), a batch ("BSCS (5th) 2026") or a legacy name such as
 * "P.G (New)" or "Pre-College Girls ICS+GS-I". 1 to 60 characters; the server applies the same rule.
 */
export const SETUP_SECTION_NAME_MAX = 60;
export const SETUP_SECTION_NAME_RULE = "Use 1 to 60 letters, numbers, spaces or - ' ( ) . / , + &, e.g. B, Khadija or Batch 2026.";

export function setupSectionNameOk(name: string): boolean {
  const t = name.trim().replace(/\s+/g, " ");
  return t.length >= 1 && t.length <= SETUP_SECTION_NAME_MAX && /^[A-Za-z0-9 '()./,+&-]+$/.test(t) && /[A-Za-z0-9]/.test(t);
}

/** "7-B" for short section names, "BS Computer Science – Batch 2025" for words and batches. */
export function setupSectionLabel(cls: { name: string; short: string }, name: string): string {
  const t = name.trim();
  return t.length <= 3 ? `${cls.short}-${t}` : `${cls.name} – ${t}`;
}

/* ------------------------------------------------------------------ Overview */

export interface SetupAttention {
  id: string;
  tone: "warning" | "danger" | "info";
  title: string;
  detail: string;
  /** Route that fixes it, e.g. "/setup/users". */
  to: string;
  search?: Record<string, string>;
  action: string;
}

export interface SetupOverview {
  campuses: { total: number; active: number };
  session: { current: number; startsOn: IsoDate; endsOn: IsoDate; day: number; days: number; next: number | null; toClose: number[] };
  classes: number;
  sections: number;
  subjects: number;
  sectionsWithoutClassTeacher: number;
  users: { total: number; active: number; invited: number; locked: number; disabled: number; twoStep: number; mustChange: number };
  roles: { total: number; custom: number };
  attention: SetupAttention[];
  recent: SetupAuditEntry[];
  /** Central backup status. null until backups are reported by the server (none are today). */
  backup: { lastAt: IsoDateTime; nextAt: IsoDateTime; keepDays: number; restoreWindowDays: number; size: string } | null;
}

/* ------------------------------------------------------------------ Campuses */

/**
 * One set of bell timings as Setup › Campuses shows it. The times are kept in one place, Timetable › Bell timings;
 * Setup reads them from there and does not keep a copy.
 */
export interface SetupCampusTimings {
  /** "School day", "Evening shift": the timings' name in Timetable. */
  name: string;
  /** "07:45" (24-hour). */
  assembly: string;
  /** Period 1 starts. */
  firstPeriod: string;
  /** null when the timings have no break. */
  breakStart: string | null;
  breakEnd: string | null;
  /** School closes, Monday to Thursday and Saturday. */
  dayEnds: string;
  /** School closes on Friday. */
  fridayEnds: string;
  /** Periods a day (Monday to Thursday and Saturday). */
  periods: number;
  /** Sections on these timings. For the main timings, every section not on other timings. */
  sections: string[];
}

export interface SetupCampus {
  code: CampusCode;
  name: string;
  nameUrdu: string;
  city: string;
  address: string;
  /** Office phone: a landline ("068-5550100") or a mobile. */
  phone: string;
  /** Number shown on SMS and vouchers for parents to call back. Mobile only. */
  smsPhone: string;
  /** "Run by": the trust or society that owns the campus. */
  ownerName: string;
  /** The day the campus started. */
  foundedOn: IsoDate | null;
  phone2: string;
  mobile1: string;
  mobile2: string;
  /** Office email, printed on letterheads when set; "" when there is none. */
  email: string;
  /** Campus code inside G.R., receipt and voucher numbers: "KC". */
  docPrefix: string;
  /** Printed at the top of every report and certificate. */
  reportHeading: string;
  reportHeadingUrdu: string;
  isMain: boolean;
  /**
   * The school day: the campus's main bell timings in use, read from Timetable › Bell timings (read-only here).
   * null until bell timings are set up in Timetable.
   */
  timings: SetupCampusTimings | null;
  /** Other timings in use this season, e.g. senior classes or an evening shift. */
  otherTimings: SetupCampusTimings[];
  /** "Normal timings" or "Winter timings": the season the campus is on; "" while timings are not set. */
  timingsSeason: string;
  modules: SetupModuleCode[];
  active: boolean;
  counts: { students: number; sections: number; staff: number; users: number };
  rowVer: number;
  updatedAt: IsoDateTime;
  updatedBy: string;
}

export interface SetupCampusInput {
  name: string;
  nameUrdu: string;
  city: string;
  address: string;
  phone: string;
  smsPhone: string;
  ownerName: string;
  foundedOn: IsoDate | null;
  phone2: string;
  mobile1: string;
  mobile2: string;
  /** Optional; "" for none. */
  email: string;
  docPrefix: string;
  reportHeading: string;
  reportHeadingUrdu: string;
  rowVer: number;
}

/** A plain office email check (optional field: "" is allowed by the caller). */
export const setupIsEmail = (v: string) => v.length <= 80 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

/* ------------------------------------------------------------------ Sessions */

/** PLANNED → CURRENT → ENDED (read-only for daily work, approved corrections only) → CLOSED (locked). */
export type SetupSessionStatus = "PLANNED" | "CURRENT" | "ENDED" | "CLOSED";

export interface SetupCampusSession {
  campus: CampusCode;
  campusName: string;
  startsOn: IsoDate;
  endsOn: IsoDate;
  sections: number;
  students: number;
}

export interface SetupSession {
  startYear: number;
  /** "2026–27" */
  label: string;
  status: SetupSessionStatus;
  startsOn: IsoDate;
  endsOn: IsoDate;
  campuses: SetupCampusSession[];
  createdAt: IsoDateTime;
  createdBy: string;
  closedAt: IsoDateTime | null;
  closedBy: string | null;
  rowVer: number;
}

export interface SetupNewSessionInput {
  startYear: number;
  startsOn: IsoDate;
  endsOn: IsoDate;
  /** Copy every campus's sections (seats and rooms) from the current session. */
  copySections: boolean;
  copyClassTeachers: boolean;
  copySubjectTeachers: boolean;
}

/* ------------------------------------------------------------------ Classes, sections, groups, subjects */

export interface SetupClassLevel {
  id: string;
  name: string;
  order: number;
  /** In use. A level that active classes use can't be switched off. */
  active: boolean;
  /** Degree programmes: class subjects carry credit hours and sections can be batches. */
  degree: boolean;
  classCount: number;
  rowVer: number;
}

export interface SetupClassLevelInput {
  name: string;
  order: number;
  active: boolean;
  degree?: boolean;
  rowVer?: number;
}

export type SetupShift = "MORNING" | "EVENING";

export interface SetupClass {
  id: string;
  /** "Class 7" */
  name: string;
  /** "7" — combined with a section: "7-B" */
  short: string;
  nameUrdu: string;
  levelId: string;
  levelName: string;
  order: number;
  maxAge: number | null;
  shift: SetupShift;
  active: boolean;
  /** Groups (streams) offered in this class, e.g. Science (Biology). */
  groupIds: string[];
  /** Sections at the requested campus and session. */
  sectionCount: number;
  rowVer: number;
}

export interface SetupClassInput {
  name: string;
  short: string;
  nameUrdu: string;
  levelId: string;
  order: number;
  maxAge: number | null;
  shift: SetupShift;
  active: boolean;
  rowVer?: number;
}

/** SECTION: a class section ("B", "Khadija"). BATCH: a degree-programme intake ("Batch 2025"). */
export type SetupSectionKind = "SECTION" | "BATCH";

export interface SetupSection {
  id: string;
  campus: CampusCode;
  campusName: string;
  session: number;
  classId: string;
  className: string;
  classShort: string;
  /** "B", "Khadija" or "Batch 2025" */
  name: string;
  /** "7-B", or "Prep – Yellow" for longer names (see setupSectionLabel) */
  label: string;
  kind?: SetupSectionKind;
  groupId: string | null;
  groupName: string | null;
  seats: number;
  room: string;
  /** Students enrolled now. */
  strength: number;
  classTeacherId: string | null;
  classTeacherName: string | null;
  active: boolean;
  rowVer: number;
}

export interface SetupSectionInput {
  classId: string;
  name: string;
  kind?: SetupSectionKind;
  groupId: string | null;
  seats: number;
  room: string;
  active: boolean;
  rowVer?: number;
}

export type SetupMedium = "ENGLISH" | "URDU";

export interface SetupSubject {
  id: string;
  code: string;
  name: string;
  nameUrdu: string;
  medium: SetupMedium;
  order: number;
  active: boolean;
  /** Classes that study it. */
  classCount: number;
  rowVer: number;
}

export interface SetupSubjectInput {
  code: string;
  name: string;
  nameUrdu: string;
  medium: SetupMedium;
  order: number;
  active: boolean;
  rowVer?: number;
}

export interface SetupGroup {
  id: string;
  name: string;
  /** Compact label for tight tables and sheets: "Bio". */
  short: string;
  classIds: string[];
  active: boolean;
  rowVer: number;
}

export interface SetupGroupInput {
  name: string;
  short: string;
  classIds: string[];
  active: boolean;
  rowVer?: number;
}

export interface SetupClassSubject {
  subjectId: string;
  subjectName: string;
  maxMarks: number;
  passMarks: number;
  periodsPerWeek: number;
  /** Credit hours (0 to 6). Degree-programme courses need at least 1; GPA is weighted by them. */
  creditHours: number;
  order: number;
  /** Optional subjects are not added to every student's result card. */
  optional: boolean;
}

/** Subjects one class (and group) studies. Kept across sessions until changed. */
export interface SetupClassSubjects {
  classId: string;
  className: string;
  groupId: string | null;
  groupName: string | null;
  subjects: SetupClassSubject[];
  rowVer: number;
  updatedAt: IsoDateTime;
  updatedBy: string;
}

/* ------------------------------------------------------------------ Teacher allotment */

export interface SetupTeacher {
  id: string;
  name: string;
  campus: CampusCode;
  /** Subjects the teacher is qualified to teach. */
  subjectIds: string[];
  /** Periods a week from current subject allotments. */
  periodsPerWeek: number;
  classTeacherOf: string | null;
}

export interface SetupSectionStaffing {
  sectionId: string;
  label: string;
  className: string;
  strength: number;
  classTeacherId: string | null;
  classTeacherName: string | null;
  subjects: Array<{ subjectId: string; subjectName: string; periodsPerWeek: number; teacherId: string | null; teacherName: string | null }>;
  rowVer: number;
}

export interface SetupStaffing {
  sections: SetupSectionStaffing[];
  teachers: SetupTeacher[];
  /** A teacher above this many periods a week is flagged. */
  maxPeriods: number;
}

export interface SetupStaffingInput {
  classTeacherId: string | null;
  subjects: Array<{ subjectId: string; teacherId: string | null }>;
  rowVer: number;
}

/* ------------------------------------------------------------------ Users */

export type SetupUserStatus = "ACTIVE" | "INVITED" | "LOCKED" | "DISABLED";

export interface SetupUserGrant {
  roleId: string;
  roleName: string;
  campus: CampusScope;
  campusName: string;
}

export interface SetupSignIn {
  at: IsoDateTime;
  outcome: "SUCCESS" | "WRONG_PASSWORD" | "WRONG_CODE" | "LOCKED";
  /** "Chrome on Windows" */
  device: string;
  /** "Khalid Campus office" */
  place: string;
}

export interface SetupUser {
  id: string;
  username: string;
  name: string;
  mobile: string;
  email: string | null;
  /** Staff number when the account belongs to a staff member. */
  staffNo: string | null;
  /** The linked staff record (Staff & payroll), when staffNo matches one. */
  staff: { name: string; designation: string; campusName: string; left: boolean } | null;
  status: SetupUserStatus;
  grants: SetupUserGrant[];
  twoStep: boolean;
  /** One of the user's roles requires two-step sign-in. */
  twoStepRequired: boolean;
  mustChangePassword: boolean;
  lastSignInAt: IsoDateTime | null;
  lastSignInDevice: string | null;
  failedAttempts: number;
  lockedAt: IsoDateTime | null;
  disabledReason: string | null;
  passwordChangedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  createdBy: string;
  updatedAt: IsoDateTime;
  updatedBy: string;
  /** False for head-office accounts viewed by a campus admin: shown, not editable. */
  managedHere: boolean;
  rowVer: number;
}

export interface SetupUserDetail extends SetupUser {
  signIns: SetupSignIn[];
}

/** STAFF_LEFT: accounts still open whose staff member has left (Staff & payroll). */
export type SetupUserFilter = "ALL" | SetupUserStatus | "NO_TWO_STEP" | "MUST_CHANGE" | "STAFF_LEFT";

export interface SetupUserFilters {
  q?: string;
  role?: string;
  filter?: SetupUserFilter;
  page?: number;
  pageSize?: number;
}

export interface SetupUserList extends SetupPage<SetupUser> {
  counts: Record<SetupUserFilter, number>;
}

export interface SetupUserInput {
  name: string;
  username: string;
  mobile: string;
  email: string | null;
  staffNo: string | null;
  grants: Array<{ roleId: string; campus: CampusScope }>;
  twoStep: boolean;
  rowVer?: number;
}

export interface SetupNewUserInput extends Omit<SetupUserInput, "rowVer"> {
  /** INVITE: a one-time sign-in code goes to the mobile; PASSWORD: the admin sets a temporary password. */
  setup: "INVITE" | "PASSWORD";
  temporaryPassword?: string;
  mustChangePassword: boolean;
}

export type SetupUserAction =
  | { type: "LOCK" }
  | { type: "UNLOCK" }
  | { type: "DISABLE"; reason: string }
  | { type: "ENABLE" }
  | { type: "TWO_STEP"; on: boolean }
  | { type: "FORCE_CHANGE"; on: boolean }
  | { type: "SIGN_OUT_EVERYWHERE" }
  | { type: "RESEND_INVITE" };

export interface SetupResetPasswordInput {
  temporaryPassword: string;
  mustChangePassword: boolean;
  signOutEverywhere: boolean;
  rowVer: number;
}

/* ------------------------------------------------------------------ Roles */

export interface SetupRole {
  id: string;
  code: string;
  name: string;
  description: string;
  /** System roles come with the software and can't be changed; copy one to make a custom role. */
  system: boolean;
  /** ANY: may be granted for all campuses (head office). CAMPUS: one campus at a time. */
  scope: "CAMPUS" | "ANY";
  permissions: Permission[];
  twoStepRequired: boolean;
  userCount: number;
  rowVer: number;
  updatedAt: IsoDateTime;
  updatedBy: string;
}

export interface SetupRoleInput {
  name: string;
  description: string;
  scope: "CAMPUS" | "ANY";
  permissions: Permission[];
  twoStepRequired: boolean;
  rowVer?: number;
}

/* ------------------------------------------------------------------ Campus settings */

export type SetupSettingType = "text" | "textUrdu" | "longText" | "longTextUrdu" | "choice" | "switch";

export interface SetupSetting {
  key: string;
  group: "Messages" | "Receipts" | "Fee vouchers";
  label: string;
  help: string;
  type: SetupSettingType;
  options?: Array<{ value: string; label: string }>;
  maxLength?: number;
  /** Organisation default (or the value itself when editing defaults). */
  defaultValue: string;
  value: string;
  /** This campus has its own value instead of the default. */
  overridden: boolean;
}

export interface SetupSettings {
  /** "ALL" = organisation defaults. */
  scope: CampusScope;
  items: SetupSetting[];
  /** Fees owns the fine rule; shown here read-only with a link. */
  lateFine: { ratePerDay: number; graceDays: number; maxFine: number | null };
  docPrefix: string | null;
  rowVer: number;
  updatedAt: IsoDateTime;
  updatedBy: string;
}

export interface SetupSettingsInput {
  /** key → value; null puts the campus back on the default. */
  values: Record<string, string | null>;
  rowVer: number;
}

/* ------------------------------------------------------------------ Audit log */

export type SetupAuditArea = "Campuses" | "Sessions" | "Classes" | "Subjects" | "Teachers" | "Users" | "Roles" | "Settings" | "Sign-in";

export const SETUP_AUDIT_AREAS: SetupAuditArea[] = ["Campuses", "Sessions", "Classes", "Subjects", "Teachers", "Users", "Roles", "Settings", "Sign-in"];

export interface SetupAuditChange {
  field: string;
  from: string;
  to: string;
}

export interface SetupAuditEntry {
  id: string;
  at: IsoDateTime;
  actor: string;
  actorRole: string;
  campus: CampusScope;
  area: SetupAuditArea;
  /** "Changed", "Reset password", "Locked" … */
  action: string;
  /** What was changed: "Sugar Mill Campus", "Ms Hina Javed". */
  target: string;
  summary: string;
  changes: SetupAuditChange[];
  tone: "neutral" | "warning" | "danger" | "success";
  device: string;
}

export interface SetupAuditFilters {
  q?: string;
  area?: SetupAuditArea;
  actor?: string;
  from?: IsoDate;
  to?: IsoDate;
  page?: number;
  pageSize?: number;
}

export interface SetupAuditPageResult extends SetupPage<SetupAuditEntry> {
  actors: string[];
}

export interface SetupSignInDay {
  date: IsoDate;
  success: number;
  failed: number;
}

/* ------------------------------------------------------------------ API */

const j = (s: string) => encodeURIComponent(s);

export const setupApi = {
  overview: (ctx: Ctx) => apiFetch<SetupOverview>("/setup/overview", { query: ctxQuery(ctx) }),

  campuses: (ctx: Ctx) => apiFetch<SetupCampus[]>("/setup/campuses", { query: ctxQuery(ctx) }),
  updateCampus: (code: CampusCode, body: SetupCampusInput) => apiFetch<SetupCampus>(`/setup/campuses/${code}`, { method: "PUT", body }),
  setModules: (code: CampusCode, body: { modules: SetupModuleCode[]; rowVer: number }) => apiFetch<SetupCampus>(`/setup/campuses/${code}/modules`, { method: "PUT", body }),

  sessions: (ctx: Ctx) => apiFetch<SetupSession[]>("/setup/sessions", { query: ctxQuery(ctx) }),
  createSession: (body: SetupNewSessionInput, idempotencyKey: string) => apiFetch<SetupSession>("/setup/sessions", { method: "POST", body, idempotencyKey }),
  setCurrentSession: (startYear: number, rowVer: number) => apiFetch<SetupSession>(`/setup/sessions/${startYear}/current`, { method: "POST", body: { rowVer } }),
  closeSession: (startYear: number, rowVer: number) => apiFetch<SetupSession>(`/setup/sessions/${startYear}/close`, { method: "POST", body: { rowVer } }),
  updateCampusSession: (startYear: number, campus: CampusCode, body: { startsOn: IsoDate; endsOn: IsoDate; rowVer: number }) =>
    apiFetch<SetupSession>(`/setup/sessions/${startYear}/campuses/${campus}`, { method: "PUT", body }),

  levels: (ctx: Ctx) => apiFetch<SetupClassLevel[]>("/setup/levels", { query: ctxQuery(ctx) }),
  saveLevel: (body: SetupClassLevelInput, id?: string) => apiFetch<SetupClassLevel>(id ? `/setup/levels/${j(id)}` : "/setup/levels", { method: id ? "PUT" : "POST", body }),
  classes: (ctx: Ctx) => apiFetch<SetupClass[]>("/setup/classes", { query: ctxQuery(ctx) }),
  saveClass: (body: SetupClassInput, id?: string) => apiFetch<SetupClass>(id ? `/setup/classes/${j(id)}` : "/setup/classes", { method: id ? "PUT" : "POST", body }),
  sections: (ctx: Ctx) => apiFetch<SetupSection[]>("/setup/sections", { query: ctxQuery(ctx) }),
  saveSection: (ctx: Ctx, body: SetupSectionInput, id?: string) =>
    apiFetch<SetupSection>(id ? `/setup/sections/${j(id)}` : "/setup/sections", { method: id ? "PUT" : "POST", body, query: ctxQuery(ctx) }),

  subjects: (ctx: Ctx) => apiFetch<SetupSubject[]>("/setup/subjects", { query: ctxQuery(ctx) }),
  saveSubject: (body: SetupSubjectInput, id?: string) => apiFetch<SetupSubject>(id ? `/setup/subjects/${j(id)}` : "/setup/subjects", { method: id ? "PUT" : "POST", body }),
  groups: (ctx: Ctx) => apiFetch<SetupGroup[]>("/setup/groups", { query: ctxQuery(ctx) }),
  saveGroup: (body: SetupGroupInput, id?: string) => apiFetch<SetupGroup>(id ? `/setup/groups/${j(id)}` : "/setup/groups", { method: id ? "PUT" : "POST", body }),
  classSubjects: (ctx: Ctx, classId: string, groupId: string | null) =>
    apiFetch<SetupClassSubjects>("/setup/class-subjects", { query: { ...ctxQuery(ctx), classId, groupId: groupId ?? "" } }),
  saveClassSubjects: (classId: string, groupId: string | null, body: { subjects: Array<Omit<SetupClassSubject, "subjectName">>; rowVer: number }) =>
    apiFetch<SetupClassSubjects>("/setup/class-subjects", { method: "PUT", body, query: { classId, groupId: groupId ?? "" } }),

  staffing: (ctx: Ctx) => apiFetch<SetupStaffing>("/setup/staffing", { query: ctxQuery(ctx) }),
  saveStaffing: (ctx: Ctx, sectionId: string, body: SetupStaffingInput) => apiFetch<SetupSectionStaffing>(`/setup/staffing/${j(sectionId)}`, { method: "PUT", body, query: ctxQuery(ctx) }),

  users: (ctx: Ctx, filters: SetupUserFilters) =>
    apiFetch<SetupUserList>("/setup/users", { query: { ...ctxQuery(ctx), q: filters.q, role: filters.role, filter: filters.filter, page: filters.page, pageSize: filters.pageSize } }),
  user: (ctx: Ctx, id: string) => apiFetch<SetupUserDetail>(`/setup/users/${j(id)}`, { query: ctxQuery(ctx) }),
  createUser: (ctx: Ctx, body: SetupNewUserInput, idempotencyKey: string) => apiFetch<SetupUserDetail>("/setup/users", { method: "POST", body, idempotencyKey, query: ctxQuery(ctx) }),
  updateUser: (ctx: Ctx, id: string, body: SetupUserInput) => apiFetch<SetupUserDetail>(`/setup/users/${j(id)}`, { method: "PUT", body, query: ctxQuery(ctx) }),
  userAction: (ctx: Ctx, id: string, action: SetupUserAction, rowVer: number) =>
    apiFetch<SetupUserDetail>(`/setup/users/${j(id)}/actions`, { method: "POST", body: { ...action, rowVer }, query: ctxQuery(ctx) }),
  resetPassword: (ctx: Ctx, id: string, body: SetupResetPasswordInput) => apiFetch<SetupUserDetail>(`/setup/users/${j(id)}/password`, { method: "POST", body, query: ctxQuery(ctx) }),

  roles: (ctx: Ctx) => apiFetch<SetupRole[]>("/setup/roles", { query: ctxQuery(ctx) }),
  saveRole: (body: SetupRoleInput, id?: string) => apiFetch<SetupRole>(id ? `/setup/roles/${j(id)}` : "/setup/roles", { method: id ? "PUT" : "POST", body }),
  deleteRole: (id: string, rowVer: number) => apiFetch<{ status: "ok" }>(`/setup/roles/${j(id)}`, { method: "DELETE", query: { rowVer } }),

  settings: (ctx: Ctx) => apiFetch<SetupSettings>("/setup/settings", { query: ctxQuery(ctx) }),
  saveSettings: (ctx: Ctx, body: SetupSettingsInput) => apiFetch<SetupSettings>("/setup/settings", { method: "PUT", body, query: ctxQuery(ctx) }),

  audit: (ctx: Ctx, filters: SetupAuditFilters) =>
    apiFetch<SetupAuditPageResult>("/setup/audit", {
      query: { ...ctxQuery(ctx), q: filters.q, area: filters.area, actor: filters.actor, from: filters.from, to: filters.to, page: filters.page, pageSize: filters.pageSize },
    }),
  signIns: (ctx: Ctx) => apiFetch<SetupSignInDay[]>("/setup/audit/sign-ins", { query: ctxQuery(ctx) }),
};

export const setupQueries = {
  overview: (ctx: Ctx) => queryOptions({ queryKey: ["setup", ...ctxKey(ctx), "overview"], queryFn: () => setupApi.overview(ctx) }),
  campuses: (ctx: Ctx) => queryOptions({ queryKey: ["setup", ...ctxKey(ctx), "campuses"], queryFn: () => setupApi.campuses(ctx) }),
  sessions: (ctx: Ctx) => queryOptions({ queryKey: ["setup", ...ctxKey(ctx), "sessions"], queryFn: () => setupApi.sessions(ctx) }),
  levels: (ctx: Ctx) => queryOptions({ queryKey: ["setup", ...ctxKey(ctx), "levels"], queryFn: () => setupApi.levels(ctx) }),
  classes: (ctx: Ctx) => queryOptions({ queryKey: ["setup", ...ctxKey(ctx), "classes"], queryFn: () => setupApi.classes(ctx) }),
  sections: (ctx: Ctx) => queryOptions({ queryKey: ["setup", ...ctxKey(ctx), "sections"], queryFn: () => setupApi.sections(ctx) }),
  subjects: (ctx: Ctx) => queryOptions({ queryKey: ["setup", ...ctxKey(ctx), "subjects"], queryFn: () => setupApi.subjects(ctx) }),
  groups: (ctx: Ctx) => queryOptions({ queryKey: ["setup", ...ctxKey(ctx), "groups"], queryFn: () => setupApi.groups(ctx) }),
  classSubjects: (ctx: Ctx, classId: string, groupId: string | null) =>
    queryOptions({ queryKey: ["setup", ...ctxKey(ctx), "class-subjects", classId, groupId ?? ""], queryFn: () => setupApi.classSubjects(ctx, classId, groupId), enabled: classId !== "" }),
  staffing: (ctx: Ctx) => queryOptions({ queryKey: ["setup", ...ctxKey(ctx), "staffing"], queryFn: () => setupApi.staffing(ctx) }),
  users: (ctx: Ctx, filters: SetupUserFilters) => queryOptions({ queryKey: ["setup", ...ctxKey(ctx), "users", filters], queryFn: () => setupApi.users(ctx, filters) }),
  user: (ctx: Ctx, id: string) => queryOptions({ queryKey: ["setup", ...ctxKey(ctx), "user", id], queryFn: () => setupApi.user(ctx, id), enabled: id !== "" }),
  roles: (ctx: Ctx) => queryOptions({ queryKey: ["setup", ...ctxKey(ctx), "roles"], queryFn: () => setupApi.roles(ctx) }),
  settings: (ctx: Ctx) => queryOptions({ queryKey: ["setup", ...ctxKey(ctx), "settings"], queryFn: () => setupApi.settings(ctx) }),
  audit: (ctx: Ctx, filters: SetupAuditFilters) => queryOptions({ queryKey: ["setup", ...ctxKey(ctx), "audit", filters], queryFn: () => setupApi.audit(ctx, filters) }),
  signIns: (ctx: Ctx) => queryOptions({ queryKey: ["setup", ...ctxKey(ctx), "sign-ins"], queryFn: () => setupApi.signIns(ctx) }),
};
