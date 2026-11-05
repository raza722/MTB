// Setup and user management mock handlers and store — owned by the setup feature.
// Mirrors the real backend: permission checks per campus, rowVer with 409 CONCURRENCY, 422 field errors,
// idempotency keys on creates, and an audit entry for every change.
import {
  bellDay,
  can,
  grantsFor,
  SEASON_LABEL,
  SETUP_MODULES,
  SETUP_SECTION_NAME_RULE,
  setupIsEmail,
  setupIsMobile,
  setupIsPhone,
  setupPasswordChecks,
  setupSectionLabel,
  setupSectionNameOk,
  type CampusCode,
  type CampusScope,
  type Permission,
  type RoleGrant,
  type SessionInfo,
  type SessionUser,
  type SetupAttention,
  type SetupAuditChange,
  type SetupAuditEntry,
  type BellSchedule,
  type SetupCampus,
  type SetupCampusInput,
  type SetupCampusTimings,
  type SetupClass,
  type SetupClassInput,
  type SetupClassLevel,
  type SetupClassLevelInput,
  type SetupClassSubjects,
  type SetupGroup,
  type SetupGroupInput,
  type SetupModuleCode,
  type SetupNewSessionInput,
  type SetupNewUserInput,
  type SetupOverview,
  type SetupResetPasswordInput,
  type SetupRole,
  type SetupRoleInput,
  type SetupSection,
  type SetupSectionInput,
  type SetupSectionStaffing,
  type SetupSession,
  type SetupSettings,
  type SetupSettingsInput,
  type SetupSignIn,
  type SetupSignInDay,
  type SetupStaffing,
  type SetupStaffingInput,
  type SetupSubject,
  type SetupSubjectInput,
  type SetupUser,
  type SetupUserAction,
  type SetupUserDetail,
  type SetupUserFilter,
  type SetupUserInput,
} from "@mtb/api";
import { daysBetween, DEFAULT_LATE_FINE_POLICY, formatDate, formatSession, formatTime, type IsoDate, type IsoDateTime } from "@mtb/domain";
import { http, type HttpHandler } from "msw";
import { DEMO_TODAY, demoNow } from "../clock";
import { createStore } from "../db";
import { campusName } from "../fixtures/campuses";
import {
  CAMPUS_CODES,
  initialAudit,
  initialCampuses,
  initialCampusSettings,
  initialClasses,
  initialClassSubjects,
  initialCourseSubjects,
  initialDegreeClassSubjects,
  initialDegreeTeachers,
  initialExtraSections,
  initialGroups,
  initialLevels,
  initialRoles,
  initialSections,
  initialSessions,
  initialSubjects,
  initialSubjectTeachers,
  initialTeachers,
  initialUsers,
  SETTING_DEFS,
  type CampusRecord,
  type ClassRecord,
  type ClassSubjectsRecord,
  type GroupRecord,
  type LevelRecord,
  type RoleRecord,
  type SectionRecord,
  type SessionRecord,
  type SubjectRecord,
  type TeacherRecord,
  type UserRecord,
} from "../fixtures/setup";
import { toSessionUser, USERS } from "../fixtures/users";
import { ctxFrom, fail, HttpResponse, latency, requireUser } from "../util";
import { registerAccountSource } from "./auth-state";
import { feeFineRuleFor } from "./fee-setup";
import { hrStaffByNo } from "./hr";
import { timingsInUse } from "./timetable";

/* ------------------------------------------------------------------ Store */

interface SettingsMeta {
  rowVer: number;
  updatedAt: IsoDateTime;
  updatedBy: string;
}

interface SetupState {
  campuses: CampusRecord[];
  sessions: SessionRecord[];
  levels: LevelRecord[];
  classes: ClassRecord[];
  groups: GroupRecord[];
  subjects: SubjectRecord[];
  classSubjects: ClassSubjectsRecord[];
  sections: SectionRecord[];
  teachers: TeacherRecord[];
  /** sectionId → subjectId → teacherId */
  subjectTeachers: Record<string, Record<string, string | null>>;
  staffingRowVer: Record<string, number>;
  roles: RoleRecord[];
  users: UserRecord[];
  settings: Record<CampusCode, Record<string, string>>;
  settingDefaults: Record<string, string>;
  settingsMeta: Record<string, SettingsMeta>;
  audit: SetupAuditEntry[];
  /** Records whose first save meets a change by someone else (shows the 409 "changed by" banner). */
  conflictOnce: string[];
  idem: Record<string, string>;
  seq: number;
}

function initialState(): SetupState {
  const sections = initialSections();
  const teachers = initialTeachers();
  const classSubjects = [...initialClassSubjects(), ...initialDegreeClassSubjects()];
  // Setup-only additions (a word-named section, degree batches and their lecturers) get their own subject teachers,
  // so the school sections keep the same allotment as Timetable's.
  const extraSections = initialExtraSections();
  const allTeachers = [...teachers, ...initialDegreeTeachers()];
  const meta = (by: string, at: IsoDateTime): SettingsMeta => ({ rowVer: 2, updatedAt: at, updatedBy: by });
  return {
    campuses: initialCampuses(),
    sessions: initialSessions(),
    levels: initialLevels(),
    classes: initialClasses(),
    groups: initialGroups(),
    subjects: [...initialSubjects(), ...initialCourseSubjects()],
    classSubjects,
    sections: [...sections, ...extraSections],
    teachers: allTeachers,
    subjectTeachers: { ...initialSubjectTeachers(sections, teachers, classSubjects), ...initialSubjectTeachers(extraSections, allTeachers, classSubjects) },
    staffingRowVer: {},
    roles: initialRoles(),
    users: initialUsers(),
    settings: initialCampusSettings(),
    settingDefaults: {},
    settingsMeta: {
      ALL: meta("Kamran Yousaf", "2026-09-01T10:00:00+05:00"),
      KC: meta("Kamran Yousaf", "2026-09-01T10:00:00+05:00"),
      SM: meta("Kamran Yousaf", "2026-09-01T10:00:00+05:00"),
      UC: meta("Kamran Yousaf", "2026-09-01T10:00:00+05:00"),
      MC: meta("Kamran Yousaf", "2026-11-02T09:31:00+05:00"),
      HC: meta("Kamran Yousaf", "2026-09-01T10:00:00+05:00"),
    },
    audit: initialAudit(),
    conflictOnce: ["campus:SM", "user:u-sana", "settings:UC", "role:role-exam-office"],
    idem: {},
    seq: 100,
  };
}

const store = createStore<SetupState>("setup", initialState);

/* ------------------------------------------------------------------ Helpers */

const ok = <T>(body: T) => HttpResponse.json(body as never);
const nextId = (prefix: string) => {
  const n = store.get().seq + 1;
  store.set((s) => ({ ...s, seq: n }));
  return `${prefix}-${n}`;
};

function requireAny(perms: Permission[], campus: CampusScope): SessionUser | Response {
  const user = requireUser();
  if (user instanceof Response) return user;
  if (!perms.some((p) => can(user, p, campus))) return fail(403, "FORBIDDEN", "Your role can't do this at this campus.");
  return user;
}

/** "Admin" — the role the user is acting in at this campus. */
function roleOf(user: SessionUser, campus: CampusScope): string {
  return (grantsFor(user, campus)[0] ?? user.roles[0])?.roleName ?? "Staff";
}

/** Someone other than the signed-in user, for the simulated concurrent edit. */
function otherUser(user: SessionUser): SessionUser {
  const other = USERS.find((u) => u.id === (user.id === "u-kamran" ? "u-farah" : "u-kamran"))!;
  return toSessionUser(other);
}

function conflict(changedBy: string, changedAt: IsoDateTime) {
  return fail(409, "CONCURRENCY", `This record was changed by ${changedBy} at ${formatTime(changedAt)}. Reload to see their change, then make yours again.`, {
    details: { changedBy, changedAt },
  });
}

/** True (and removes the flag) the first time a flagged record is saved. */
function takeConflict(key: string): boolean {
  const s = store.get();
  if (!s.conflictOnce.includes(key)) return false;
  store.set((st) => ({ ...st, conflictOnce: st.conflictOnce.filter((k) => k !== key) }));
  return true;
}

function addAudit(user: SessionUser, campus: CampusScope, entry: Omit<SetupAuditEntry, "id" | "at" | "actor" | "actorRole" | "campus" | "device" | "tone" | "changes"> & Partial<Pick<SetupAuditEntry, "tone" | "changes">>) {
  const full: SetupAuditEntry = {
    id: nextId("a"),
    at: demoNow(),
    actor: user.name,
    actorRole: roleOf(user, campus),
    campus,
    device: `Chrome on Windows · ${campus === "ALL" ? "Head office" : `${campusName(campus)} office`}`,
    tone: entry.tone ?? "neutral",
    changes: entry.changes ?? [],
    area: entry.area,
    action: entry.action,
    target: entry.target,
    summary: entry.summary,
  };
  store.set((s) => ({ ...s, audit: [full, ...s.audit] }));
}

function diff(pairs: Array<[string, unknown, unknown]>): SetupAuditChange[] {
  const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v));
  return pairs.filter(([, a, b]) => show(a) !== show(b)).map(([field, a, b]) => ({ field, from: show(a), to: show(b) }));
}

const vfail = (field: string, message: string) => fail(422, "VALIDATION", message, { field });
const isMobile = setupIsMobile;
const formatMobile = (m: string) => {
  const d = m.replace(/\D/g, "");
  return d.length === 11 ? `${d.slice(0, 4)}-${d.slice(4)}` : m.trim();
};
/** Mobiles as 0300-5550101; landlines are kept as typed. */
const formatPhone = (m: string) => (isMobile(m) ? formatMobile(m) : m.trim());

/** Stores saved before levels were editable have none; fall back to the starting list. */
const levelsOf = (s: SetupState): LevelRecord[] => s.levels ?? initialLevels();
const levelOf = (s: SetupState, classId: string) => {
  const cls = s.classes.find((c) => c.id === classId);
  return cls ? levelsOf(s).find((l) => l.id === cls.levelId) : undefined;
};
const sectionLabel = (s: SetupState, x: Pick<SectionRecord, "classId" | "name">) => {
  const cls = s.classes.find((c) => c.id === x.classId);
  return cls ? setupSectionLabel(cls, x.name) : `?-${x.name}`;
};

const currentSession = (s: SetupState) => s.sessions.find((x) => x.status === "CURRENT")!;
/** Session-bound records can change in the current session and in a planned one. */
function sessionEditable(s: SetupState, year: number): Response | null {
  const ses = s.sessions.find((x) => x.startYear === year);
  if (!ses) return fail(404, "NOT_FOUND", `Session ${formatSession(year)} doesn't exist.`);
  if (ses.status === "ENDED" || ses.status === "CLOSED") return fail(409, "SESSION_READ_ONLY", `${formatSession(year)} is read-only. Switch to ${formatSession(currentSession(s).startYear)} to make changes.`);
  return null;
}

const inScope = (campus: CampusScope, c: CampusCode) => campus === "ALL" || campus === c;

/* ------------------------------------------------------------------ Mappers */

/** One set of bell timings as Setup shows it (read from Timetable › Bell timings: one source for school-day times). */
function timingOf(b: BellSchedule): SetupCampusTimings {
  const day = bellDay(b, b.normal);
  const fri = bellDay(b, b.friday);
  return { name: b.name, assembly: b.assemblyStart, firstPeriod: day.periods[0]?.start ?? b.assemblyStart, breakStart: day.breakStart, breakEnd: day.breakEnd, dayEnds: day.offTime, fridayEnds: fri.offTime, periods: b.normal.periods, sections: b.sections };
}

function toCampus(s: SetupState, c: CampusRecord): SetupCampus {
  const cur = currentSession(s).startYear;
  const secs = s.sections.filter((x) => x.campus === c.code && x.session === cur && x.active);
  const bells = timingsInUse(c.code);
  return {
    code: c.code,
    name: c.name,
    nameUrdu: c.nameUrdu,
    city: c.city,
    address: c.address,
    phone: c.phone,
    smsPhone: c.smsPhone,
    ownerName: c.ownerName ?? "",
    foundedOn: c.foundedOn ?? null,
    phone2: c.phone2 ?? "",
    mobile1: c.mobile1 ?? "",
    mobile2: c.mobile2 ?? "",
    email: c.email ?? "",
    docPrefix: c.docPrefix,
    reportHeading: c.reportHeading,
    reportHeadingUrdu: c.reportHeadingUrdu,
    isMain: c.isMain,
    timings: timingOf(bells[0]!),
    otherTimings: bells.slice(1).map(timingOf),
    timingsSeason: SEASON_LABEL[bells[0]!.season],
    modules: c.modules,
    active: c.active,
    counts: {
      students: secs.reduce((a, x) => a + x.strength, 0),
      sections: secs.length,
      staff: c.staff,
      users: s.users.filter((u) => u.status !== "DISABLED" && u.grants.some((g) => g.campus === c.code)).length,
    },
    rowVer: c.rowVer,
    updatedAt: c.updatedAt,
    updatedBy: c.updatedBy,
  };
}

function toSession(s: SetupState, r: SessionRecord): SetupSession {
  return {
    startYear: r.startYear,
    label: formatSession(r.startYear),
    status: r.status,
    startsOn: r.startsOn,
    endsOn: r.endsOn,
    campuses: CAMPUS_CODES.map((c) => {
      const dates = r.campusDates[c] ?? { startsOn: r.startsOn, endsOn: r.endsOn };
      const secs = s.sections.filter((x) => x.campus === c && x.session === r.startYear && x.active);
      const arch = r.archived?.[c];
      return {
        campus: c,
        campusName: campusName(c),
        startsOn: dates.startsOn,
        endsOn: dates.endsOn,
        sections: secs.length || arch?.sections || 0,
        students: secs.reduce((a, x) => a + x.strength, 0) || arch?.students || 0,
      };
    }),
    createdAt: r.createdAt,
    createdBy: r.createdBy,
    closedAt: r.closedAt,
    closedBy: r.closedBy,
    rowVer: r.rowVer,
  };
}

function toLevel(s: SetupState, l: LevelRecord): SetupClassLevel {
  return { id: l.id, name: l.name, order: l.order, active: l.active ?? true, degree: l.degree ?? false, classCount: s.classes.filter((c) => c.levelId === l.id && c.active).length, rowVer: l.rowVer ?? 1 };
}

function toClass(s: SetupState, c: ClassRecord, campus: CampusScope, session: number): SetupClass {
  return {
    id: c.id,
    name: c.name,
    short: c.short,
    nameUrdu: c.nameUrdu,
    levelId: c.levelId,
    levelName: levelsOf(s).find((l) => l.id === c.levelId)?.name ?? "",
    order: c.order,
    maxAge: c.maxAge,
    shift: c.shift,
    active: c.active,
    groupIds: s.groups.filter((g) => g.classIds.includes(c.id)).map((g) => g.id),
    sectionCount: s.sections.filter((x) => x.classId === c.id && x.session === session && x.active && inScope(campus, x.campus)).length,
    rowVer: c.rowVer,
  };
}

function toSection(s: SetupState, x: SectionRecord): SetupSection {
  const cls = s.classes.find((c) => c.id === x.classId);
  const teacher = x.classTeacherId ? s.teachers.find((t) => t.id === x.classTeacherId) : undefined;
  return {
    id: x.id,
    campus: x.campus,
    campusName: campusName(x.campus),
    session: x.session,
    classId: x.classId,
    className: cls?.name ?? x.classId,
    classShort: cls?.short ?? "",
    name: x.name,
    label: sectionLabel(s, x),
    kind: x.kind ?? "SECTION",
    groupId: x.groupId,
    groupName: x.groupId ? (s.groups.find((g) => g.id === x.groupId)?.name ?? null) : null,
    seats: x.seats,
    room: x.room,
    strength: x.strength,
    classTeacherId: x.classTeacherId,
    classTeacherName: teacher?.name ?? null,
    active: x.active,
    rowVer: x.rowVer,
  };
}

const classSubjectKey = (classId: string, groupId: string | null) => `${classId}|${groupId ?? ""}`;

function subjectsFor(s: SetupState, classId: string, groupId: string | null) {
  return s.classSubjects.find((c) => c.key === classSubjectKey(classId, groupId))?.subjects ?? [];
}

function toClassSubjects(s: SetupState, classId: string, groupId: string | null): SetupClassSubjects {
  const rec = s.classSubjects.find((c) => c.key === classSubjectKey(classId, groupId));
  return {
    classId,
    className: s.classes.find((c) => c.id === classId)?.name ?? classId,
    groupId,
    groupName: groupId ? (s.groups.find((g) => g.id === groupId)?.name ?? null) : null,
    subjects: (rec?.subjects ?? [])
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((r) => ({ ...r, creditHours: r.creditHours ?? 0, subjectName: s.subjects.find((x) => x.id === r.subjectId)?.name ?? r.subjectId })),
    rowVer: rec?.rowVer ?? 0,
    updatedAt: rec?.updatedAt ?? "2026-02-01T09:00:00+05:00",
    updatedBy: rec?.updatedBy ?? "System",
  };
}

function toRole(s: SetupState, r: RoleRecord): SetupRole {
  return {
    ...r,
    userCount: s.users.filter((u) => u.status !== "DISABLED" && u.grants.some((g) => g.roleId === r.id)).length,
  };
}

function toUser(s: SetupState, u: UserRecord, viewer: SessionUser): SetupUser {
  const grants = u.grants.map((g) => {
    const role = s.roles.find((r) => r.id === g.roleId);
    return { roleId: g.roleId, roleName: role?.name ?? "Unknown role", campus: g.campus, campusName: campusName(g.campus) };
  });
  const { signIns: _s, grants: _g, ...rest } = u;
  const staff = u.staffNo ? hrStaffByNo(u.staffNo) : null;
  return {
    ...rest,
    staff: staff ? { name: staff.name, designation: staff.designation, campusName: staff.campusName, left: staff.left } : null,
    grants,
    twoStepRequired: u.grants.some((g) => s.roles.find((r) => r.id === g.roleId)?.twoStepRequired),
    managedHere: u.grants.every((g) => can(viewer, "users.manage", g.campus)),
  };
}

const toUserDetail = (s: SetupState, u: UserRecord, viewer: SessionUser): SetupUserDetail => ({ ...toUser(s, u, viewer), signIns: u.signIns });

function userVisible(u: UserRecord, campus: CampusScope) {
  return campus === "ALL" || u.grants.some((g) => g.campus === campus || g.campus === "ALL");
}

function matchesFilter(s: SetupState, u: UserRecord, filter: SetupUserFilter): boolean {
  switch (filter) {
    case "ALL":
      return true;
    case "NO_TWO_STEP":
      return u.status !== "DISABLED" && !u.twoStep && u.grants.some((g) => s.roles.find((r) => r.id === g.roleId)?.twoStepRequired);
    case "MUST_CHANGE":
      return u.status !== "DISABLED" && u.mustChangePassword;
    case "STAFF_LEFT":
      return u.status !== "DISABLED" && Boolean(u.staffNo && hrStaffByNo(u.staffNo)?.left);
    default:
      return u.status === filter;
  }
}

/** Teachers' weekly periods from the current session's subject allotments. */
function teacherLoads(s: SetupState, campus: CampusCode, session: number): Map<string, number> {
  const loads = new Map<string, number>();
  for (const x of s.sections.filter((y) => y.campus === campus && y.session === session && y.active)) {
    const subjects = subjectsFor(s, x.classId, x.groupId);
    const map = s.subjectTeachers[x.id] ?? {};
    for (const row of subjects) {
      const t = map[row.subjectId];
      if (t) loads.set(t, (loads.get(t) ?? 0) + row.periodsPerWeek);
    }
  }
  return loads;
}

function toStaffing(s: SetupState, x: SectionRecord): SetupSectionStaffing {
  const sec = toSection(s, x);
  const map = s.subjectTeachers[x.id] ?? {};
  return {
    sectionId: x.id,
    label: sec.label,
    className: sec.className,
    strength: x.strength,
    classTeacherId: x.classTeacherId,
    classTeacherName: sec.classTeacherName,
    subjects: toClassSubjects(s, x.classId, x.groupId).subjects.map((row) => {
      const tid = map[row.subjectId] ?? null;
      return { subjectId: row.subjectId, subjectName: row.subjectName, periodsPerWeek: row.periodsPerWeek, teacherId: tid, teacherName: tid ? (s.teachers.find((t) => t.id === tid)?.name ?? null) : null };
    }),
    rowVer: s.staffingRowVer[x.id] ?? 1,
  };
}

/** Effective settings for a campus (or the defaults for "ALL"). */
function toSettings(s: SetupState, scope: CampusScope): SetupSettings {
  const meta = s.settingsMeta[scope] ?? { rowVer: 1, updatedAt: "2026-09-01T10:00:00+05:00", updatedBy: "System" };
  const own = scope === "ALL" ? {} : (s.settings[scope] ?? {});
  return {
    scope,
    items: SETTING_DEFS.map((d) => {
      const def = s.settingDefaults[d.key] ?? d.defaultValue;
      const has = Object.prototype.hasOwnProperty.call(own, d.key);
      return {
        key: d.key,
        group: d.group,
        label: d.label,
        help: d.help,
        type: d.type,
        ...(d.options ? { options: d.options } : {}),
        ...(d.maxLength ? { maxLength: d.maxLength } : {}),
        defaultValue: def,
        value: has ? own[d.key]! : def,
        overridden: has,
      };
    }),
    // The campus's own rule from Fees → Fine rules; the school-wide default when All campuses is selected.
    lateFine: scope === "ALL" ? { ...DEFAULT_LATE_FINE_POLICY } : (({ ratePerDay, graceDays, maxFine }) => ({ ratePerDay, graceDays, maxFine }))(feeFineRuleFor(scope)),
    docPrefix: scope === "ALL" ? null : (s.campuses.find((c) => c.code === scope)?.docPrefix ?? null),
    rowVer: meta.rowVer,
    updatedAt: meta.updatedAt,
    updatedBy: meta.updatedBy,
  };
}

/* ------------------------------------------------------------------ Handlers */

const SETUP_OR_USERS: Permission[] = ["setup.manage", "users.manage"];
/** Head-office setup, or campus-level setup at the user's own campus (sections, teachers, school-day times). */
const SETUP_OR_CAMPUS: Permission[] = ["setup.manage", "setup.campus"];
const SETUP_ANY: Permission[] = [...SETUP_OR_USERS, "setup.campus"];

export const setupHandlers: HttpHandler[] = [
  /* ---------------- Overview */
  http.get("/api/setup/overview", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requireAny(SETUP_ANY, ctx.campus);
    if (user instanceof Response) return user;
    const s = store.get();
    const cur = currentSession(s);
    const users = s.users.filter((u) => userVisible(u, ctx.campus));
    const secs = s.sections.filter((x) => x.session === ctx.session && x.active && inScope(ctx.campus, x.campus));
    const noTeacher = secs.filter((x) => !x.classTeacherId);
    const gaps = secs.reduce((a, x) => a + subjectsFor(s, x.classId, x.groupId).filter((r) => !(s.subjectTeachers[x.id] ?? {})[r.subjectId]).length, 0);
    const count = (f: SetupUserFilter) => users.filter((u) => matchesFilter(s, u, f)).length;
    const attention: SetupAttention[] = [];
    if (count("LOCKED")) attention.push({ id: "locked", tone: "danger", title: `${count("LOCKED")} account${count("LOCKED") === 1 ? " is" : "s are"} locked`, detail: "Locked after too many wrong passwords. Check with the person, then unlock.", to: "/setup/users", search: { filter: "LOCKED" }, action: "Review" });
    if (count("NO_TWO_STEP")) attention.push({ id: "2fa", tone: "warning", title: `${count("NO_TWO_STEP")} ${count("NO_TWO_STEP") === 1 ? "person has" : "people have"} not set up two-step sign-in`, detail: "Their role needs a code from their phone at sign-in.", to: "/setup/users", search: { filter: "NO_TWO_STEP" }, action: "See who" });
    if (noTeacher.length) attention.push({ id: "ct", tone: "warning", title: `${noTeacher.length} section${noTeacher.length === 1 ? " has" : "s have"} no class teacher`, detail: noTeacher.map((x) => `${toSection(s, x).label} (${campusName(x.campus)})`).join(", "), to: "/setup/teachers", action: "Assign" });
    if (gaps) attention.push({ id: "st", tone: "warning", title: `${gaps} subject${gaps === 1 ? "" : "s"} without a teacher`, detail: "Marks entry and timetables need a teacher for every subject.", to: "/setup/teachers", action: "Assign" });
    if (count("INVITED")) attention.push({ id: "inv", tone: "info", title: `${count("INVITED")} invited ${count("INVITED") === 1 ? "person hasn't" : "people haven't"} signed in yet`, detail: "Resend the sign-in code if it has been more than two days.", to: "/setup/users", search: { filter: "INVITED" }, action: "Open" });
    if (count("STAFF_LEFT")) attention.push({ id: "left", tone: "warning", title: `${count("STAFF_LEFT")} ${count("STAFF_LEFT") === 1 ? "account belongs" : "accounts belong"} to staff who have left`, detail: "Staff & payroll shows they left, but they can still sign in. Disable the account.", to: "/setup/users", search: { filter: "STAFF_LEFT" }, action: "Review" });
    const ended = s.sessions.filter((x) => x.status === "ENDED").map((x) => x.startYear);
    for (const y of ended) attention.push({ id: `close-${y}`, tone: "info", title: `${formatSession(y)} has ended but is not closed`, detail: "Close it once late corrections are done, so nothing can change it.", to: "/setup/sessions", action: "Review" });
    const next = s.sessions.find((x) => x.status === "PLANNED")?.startYear ?? null;
    if (!next) attention.push({ id: "next", tone: "info", title: `Create ${formatSession(cur.startYear + 1)} before admissions open`, detail: `${formatSession(cur.startYear)} ends on ${formatDate(cur.endsOn)}. Copy sections and teachers in one step.`, to: "/setup/sessions", action: "Create" });

    const body: SetupOverview = {
      campuses: { total: s.campuses.filter((c) => inScope(ctx.campus, c.code)).length, active: s.campuses.filter((c) => c.active && inScope(ctx.campus, c.code)).length },
      session: { current: cur.startYear, startsOn: cur.startsOn, endsOn: cur.endsOn, day: Math.max(1, daysBetween(cur.startsOn, DEMO_TODAY) + 1), days: daysBetween(cur.startsOn, cur.endsOn) + 1, next, toClose: ended },
      classes: s.classes.filter((c) => c.active).length,
      sections: secs.length,
      subjects: s.subjects.filter((x) => x.active).length,
      sectionsWithoutClassTeacher: noTeacher.length,
      users: {
        total: users.length,
        active: count("ACTIVE"),
        invited: count("INVITED"),
        locked: count("LOCKED"),
        disabled: count("DISABLED"),
        twoStep: users.filter((u) => u.status !== "DISABLED" && u.twoStep).length,
        mustChange: count("MUST_CHANGE"),
      },
      roles: { total: s.roles.length, custom: s.roles.filter((r) => !r.system).length },
      attention,
      recent: s.audit.filter((a) => ctx.campus === "ALL" || a.campus === ctx.campus).slice(0, 6),
      backup: { lastAt: `${DEMO_TODAY}T03:00:00+05:00`, nextAt: "2026-11-05T03:00:00+05:00", keepDays: 30, restoreWindowDays: 7, size: "4.2 GB" },
    };
    return ok(body);
  }),

  /* ---------------- Campuses */
  http.get("/api/setup/campuses", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requireAny(SETUP_ANY, ctx.campus);
    if (user instanceof Response) return user;
    const s = store.get();
    return ok(s.campuses.filter((c) => inScope(ctx.campus, c.code)).map((c) => toCampus(s, c)));
  }),

  http.put("/api/setup/campuses/:code", async ({ request, params }) => {
    await latency();
    const code = params.code as CampusCode;
    const user = requireAny(SETUP_OR_CAMPUS, code);
    if (user instanceof Response) return user;
    // The campus details belong to head office. School-day times are kept in Timetable › Bell timings, not here.
    const headOffice = can(user, "setup.manage", code);
    const body = (await request.json()) as SetupCampusInput;
    const s = store.get();
    const rec = s.campuses.find((c) => c.code === code);
    if (!rec) return fail(404, "NOT_FOUND", "That campus doesn't exist.");
    if (takeConflict(`campus:${code}`)) {
      const other = otherUser(user);
      const by = other.name;
      const at = demoNow();
      store.set((st) => ({ ...st, campuses: st.campuses.map((c) => (c.code === code ? { ...c, smsPhone: "0300-5550299", rowVer: c.rowVer + 1, updatedAt: at, updatedBy: by } : c)) }));
      addAudit(other, code, { area: "Campuses", action: "Changed campus", target: rec.name, summary: "Changed the number parents call back.", changes: [{ field: "SMS call-back number", from: rec.smsPhone, to: "0300-5550299" }] });
      return conflict(by, at);
    }
    if (body.rowVer !== rec.rowVer) return conflict(rec.updatedBy, rec.updatedAt);
    const before = toCampus(s, rec);
    const text = (v: string | null | undefined) => (v ?? "").trim();
    if (!headOffice) {
      const details: Array<[string, string | null, string | null]> = [
        ["name", before.name, body.name],
        ["nameUrdu", before.nameUrdu, body.nameUrdu],
        ["city", before.city, body.city],
        ["address", before.address, body.address],
        ["phone", before.phone, formatPhone(text(body.phone))],
        ["smsPhone", before.smsPhone, formatPhone(text(body.smsPhone))],
        ["ownerName", before.ownerName, body.ownerName],
        ["foundedOn", before.foundedOn, body.foundedOn],
        ["phone2", before.phone2, formatPhone(text(body.phone2))],
        ["mobile1", before.mobile1, formatPhone(text(body.mobile1))],
        ["mobile2", before.mobile2, formatPhone(text(body.mobile2))],
        ["email", before.email, text(body.email).toLowerCase()],
        ["docPrefix", before.docPrefix, text(body.docPrefix).toUpperCase()],
        ["reportHeading", before.reportHeading, body.reportHeading],
        ["reportHeadingUrdu", before.reportHeadingUrdu, body.reportHeadingUrdu],
      ];
      const changed = details.find(([, a, b]) => text(a) !== text(b));
      if (changed) return fail(403, "FORBIDDEN", "Only head office can change the campus details. School-day times are set in Timetable › Bell timings.", { field: changed[0] });
    }
    if (!text(body.name)) return vfail("name", "Enter the campus name.");
    if (!text(body.nameUrdu)) return vfail("nameUrdu", "Enter the campus name in Urdu. It prints on Urdu result cards and certificates.");
    if (!text(body.ownerName)) return vfail("ownerName", "Enter who runs the campus, e.g. the trust or society.");
    if (text(body.ownerName).length > 80) return vfail("ownerName", "Keep it to 80 characters.");
    if (body.foundedOn && body.foundedOn > DEMO_TODAY) return vfail("foundedOn", "The start date can't be after today.");
    const prefix = text(body.docPrefix).toUpperCase();
    if (!/^[A-Z]{2,4}$/.test(prefix)) return vfail("docPrefix", "Use 2 to 4 capital letters, e.g. KC.");
    if (s.campuses.some((c) => c.code !== code && c.docPrefix === prefix)) return vfail("docPrefix", `${prefix} is already used by another campus. Choose a different prefix.`);
    if (!text(body.reportHeading)) return vfail("reportHeading", "Enter the heading printed on reports.");
    for (const [field, v] of [["phone", body.phone], ["phone2", body.phone2]] as const) {
      if (text(v) && !setupIsPhone(text(v))) return vfail(field, "Enter a landline with its area code, e.g. 068-5550100, or an 11-digit mobile starting with 03.");
    }
    for (const [field, v] of [["smsPhone", body.smsPhone], ["mobile1", body.mobile1], ["mobile2", body.mobile2]] as const) {
      if (text(v) && !isMobile(text(v))) return vfail(field, field === "smsPhone" ? "Parents call back on a mobile. Enter an 11-digit number starting with 03, e.g. 0300-5550101." : "Enter an 11-digit mobile starting with 03, e.g. 0300-5550101.");
    }
    const email = text(body.email).toLowerCase();
    if (email && !setupIsEmail(email)) return vfail("email", "Enter an email like office@school.pk, or leave it empty.");
    const next: CampusRecord = {
      ...rec,
      name: text(body.name),
      nameUrdu: text(body.nameUrdu),
      city: text(body.city),
      address: text(body.address),
      phone: formatPhone(text(body.phone)),
      smsPhone: formatPhone(text(body.smsPhone)),
      ownerName: text(body.ownerName),
      foundedOn: body.foundedOn || null,
      phone2: formatPhone(text(body.phone2)),
      mobile1: formatPhone(text(body.mobile1)),
      mobile2: formatPhone(text(body.mobile2)),
      email,
      docPrefix: prefix,
      reportHeading: text(body.reportHeading),
      reportHeadingUrdu: text(body.reportHeadingUrdu),
      rowVer: rec.rowVer + 1,
      updatedAt: demoNow(),
      updatedBy: user.name,
    };
    const changes = diff([
      ["Name", rec.name, next.name],
      ["Name in Urdu", rec.nameUrdu, next.nameUrdu],
      ["Run by", before.ownerName, next.ownerName],
      ["Started on", before.foundedOn ? formatDate(before.foundedOn) : "", next.foundedOn ? formatDate(next.foundedOn) : ""],
      ["City", rec.city, next.city],
      ["Address", rec.address, next.address],
      ["Office phone", rec.phone, next.phone],
      ["Second phone", before.phone2, next.phone2],
      ["Mobile 1", before.mobile1, next.mobile1],
      ["Mobile 2", before.mobile2, next.mobile2],
      ["Email", before.email, next.email],
      ["SMS call-back number", rec.smsPhone, next.smsPhone],
      ["Document prefix", rec.docPrefix, next.docPrefix],
      ["Report heading", rec.reportHeading, next.reportHeading],
      ["Report heading in Urdu", rec.reportHeadingUrdu, next.reportHeadingUrdu],
    ]);
    store.set((st) => ({ ...st, campuses: st.campuses.map((c) => (c.code === code ? next : c)) }));
    if (changes.length) addAudit(user, code, { area: "Campuses", action: "Changed campus", target: next.name, summary: `${changes.length} detail${changes.length === 1 ? "" : "s"} changed.`, changes });
    return ok(toCampus(store.get(), next));
  }),

  http.put("/api/setup/campuses/:code/modules", async ({ request, params }) => {
    await latency();
    const code = params.code as CampusCode;
    const user = requireAny(["setup.manage"], "ALL");
    if (user instanceof Response) return fail(403, "FORBIDDEN", "Only head office can switch modules on or off for a campus.");
    const body = (await request.json()) as { modules: SetupModuleCode[]; rowVer: number };
    const s = store.get();
    const rec = s.campuses.find((c) => c.code === code);
    if (!rec) return fail(404, "NOT_FOUND", "That campus doesn't exist.");
    if (body.rowVer !== rec.rowVer) return conflict(rec.updatedBy, rec.updatedAt);
    const missingCore = SETUP_MODULES.filter((m) => m.core && !body.modules.includes(m.code));
    if (missingCore.length) return vfail("modules", `${missingCore.map((m) => m.name).join(", ")} can't be switched off; every campus needs ${missingCore.length === 1 ? "it" : "them"}.`);
    const valid = body.modules.filter((m) => SETUP_MODULES.some((x) => x.code === m));
    const on = valid.filter((m) => !rec.modules.includes(m));
    const off = rec.modules.filter((m) => !valid.includes(m));
    const name = (c: SetupModuleCode) => SETUP_MODULES.find((m) => m.code === c)?.name ?? c;
    const next = { ...rec, modules: valid, rowVer: rec.rowVer + 1, updatedAt: demoNow(), updatedBy: user.name };
    store.set((st) => ({ ...st, campuses: st.campuses.map((c) => (c.code === code ? next : c)) }));
    if (on.length || off.length) {
      addAudit(user, code, {
        area: "Campuses",
        action: "Changed modules",
        target: rec.name,
        summary: [on.length ? `Switched on: ${on.map(name).join(", ")}.` : "", off.length ? `Switched off: ${off.map(name).join(", ")}.` : ""].filter(Boolean).join(" "),
        changes: [...on.map((m) => ({ field: name(m), from: "Off", to: "On" })), ...off.map((m) => ({ field: name(m), from: "On", to: "Off" }))],
        tone: off.length ? "warning" : "neutral",
      });
    }
    return ok(toCampus(store.get(), next));
  }),

  /* ---------------- Sessions */
  http.get("/api/setup/sessions", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requireAny(["setup.manage"], ctx.campus);
    if (user instanceof Response) return user;
    const s = store.get();
    return ok(s.sessions.slice().sort((a, b) => b.startYear - a.startYear).map((r) => toSession(s, r)));
  }),

  http.post("/api/setup/sessions", async ({ request }) => {
    await latency();
    const user = requireAny(["setup.manage"], "ALL");
    if (user instanceof Response) return fail(403, "FORBIDDEN", "Only head office can create a session.");
    const key = request.headers.get("Idempotency-Key");
    const s = store.get();
    if (key && s.idem[key]) {
      const done = s.sessions.find((x) => String(x.startYear) === s.idem[key]);
      if (done) return ok(toSession(s, done));
    }
    const body = (await request.json()) as SetupNewSessionInput;
    const newest = Math.max(...s.sessions.map((x) => x.startYear));
    if (body.startYear !== newest + 1) return vfail("startYear", `The next session is ${formatSession(newest + 1)}.`);
    if (!body.startsOn) return vfail("startsOn", "Enter the first day of the session.");
    if (!body.endsOn) return vfail("endsOn", "Enter the last day of the session.");
    if (body.endsOn <= body.startsOn) return vfail("endsOn", "The last day must be after the first day.");
    const len = daysBetween(body.startsOn, body.endsOn);
    if (len < 270 || len > 400) return vfail("endsOn", "A session normally runs about a year. Check the dates.");
    const cur = currentSession(s);
    if (body.startsOn <= cur.startsOn) return vfail("startsOn", `It must start after ${formatSession(cur.startYear)} starts (${formatDate(cur.startsOn)}).`);

    const rec: SessionRecord = { startYear: body.startYear, status: "PLANNED", startsOn: body.startsOn, endsOn: body.endsOn, campusDates: {}, createdAt: demoNow(), createdBy: user.name, closedAt: null, closedBy: null, rowVer: 1 };
    let copied: SectionRecord[] = [];
    const subjectTeachers: Record<string, Record<string, string | null>> = {};
    if (body.copySections) {
      copied = s.sections
        .filter((x) => x.session === cur.startYear && x.active)
        .map((x) => {
          const id = x.id.replace(`-${cur.startYear}-`, `-${body.startYear}-`);
          if (body.copySubjectTeachers) subjectTeachers[id] = { ...(s.subjectTeachers[x.id] ?? {}) };
          return { ...x, id, session: body.startYear, strength: 0, classTeacherId: body.copyClassTeachers ? x.classTeacherId : null, rowVer: 1 };
        });
    }
    store.set((st) => ({
      ...st,
      sessions: [rec, ...st.sessions],
      sections: [...st.sections, ...copied],
      subjectTeachers: { ...st.subjectTeachers, ...subjectTeachers },
      idem: key ? { ...st.idem, [key]: String(body.startYear) } : st.idem,
    }));
    addAudit(user, "ALL", {
      area: "Sessions",
      action: "Created session",
      target: formatSession(body.startYear),
      summary: body.copySections
        ? `${copied.length} sections copied from ${formatSession(cur.startYear)}${body.copyClassTeachers ? ", with class teachers" : ""}${body.copySubjectTeachers ? " and subject teachers" : ""}. Students join when they are promoted.`
        : "Created empty. Add sections before promotion.",
      tone: "success",
    });
    return ok(toSession(store.get(), rec));
  }),

  http.post("/api/setup/sessions/:year/current", async ({ request, params }) => {
    await latency();
    const user = requireAny(["setup.manage"], "ALL");
    if (user instanceof Response) return fail(403, "FORBIDDEN", "Only head office can change the current session.");
    const year = Number(params.year);
    const { rowVer } = (await request.json()) as { rowVer: number };
    const s = store.get();
    const target = s.sessions.find((x) => x.startYear === year);
    if (!target) return fail(404, "NOT_FOUND", `Session ${formatSession(year)} doesn't exist.`);
    if (target.rowVer !== rowVer) return conflict(target.closedBy ?? target.createdBy, target.closedAt ?? target.createdAt);
    const cur = currentSession(s);
    if (target.status === "CURRENT") return ok(toSession(s, target));
    if (target.status === "CLOSED") return fail(409, "SESSION_CLOSED", `${formatSession(year)} is closed and locked. It can't become current again.`);
    let curNext: SessionRecord["status"];
    if (target.status === "PLANNED") curNext = "ENDED";
    else if (target.startYear === cur.startYear - 1) curNext = "PLANNED";
    else return fail(409, "SESSION_ENDED", `Only ${formatSession(cur.startYear - 1)} can be made current again, to undo a change made by mistake.`);
    store.set((st) => ({
      ...st,
      sessions: st.sessions.map((x) =>
        x.startYear === year ? { ...x, status: "CURRENT", rowVer: x.rowVer + 1 } : x.startYear === cur.startYear ? { ...x, status: curNext, rowVer: x.rowVer + 1 } : x,
      ),
    }));
    addAudit(user, "ALL", {
      area: "Sessions",
      action: "Made current",
      target: formatSession(year),
      summary: `Everyone now opens ${formatSession(year)} by default. ${formatSession(cur.startYear)} is ${curNext === "ENDED" ? "read-only for daily work" : "planned again"}.`,
      changes: [{ field: "Current session", from: formatSession(cur.startYear), to: formatSession(year) }],
      tone: "warning",
    });
    const after = store.get();
    return ok(toSession(after, after.sessions.find((x) => x.startYear === year)!));
  }),

  http.post("/api/setup/sessions/:year/close", async ({ request, params }) => {
    await latency();
    const user = requireAny(["setup.manage"], "ALL");
    if (user instanceof Response) return fail(403, "FORBIDDEN", "Only head office can close a session.");
    const year = Number(params.year);
    const { rowVer } = (await request.json()) as { rowVer: number };
    const s = store.get();
    const target = s.sessions.find((x) => x.startYear === year);
    if (!target) return fail(404, "NOT_FOUND", `Session ${formatSession(year)} doesn't exist.`);
    if (target.rowVer !== rowVer) return conflict(target.createdBy, target.createdAt);
    if (target.status === "CURRENT") return fail(409, "SESSION_CURRENT", `${formatSession(year)} is the current session. Make the next session current first.`);
    if (target.status === "PLANNED") return fail(409, "SESSION_PLANNED", `${formatSession(year)} hasn't started yet, so there is nothing to close.`);
    if (target.status === "CLOSED") return ok(toSession(s, target));
    const at = demoNow();
    store.set((st) => ({ ...st, sessions: st.sessions.map((x) => (x.startYear === year ? { ...x, status: "CLOSED", closedAt: at, closedBy: user.name, rowVer: x.rowVer + 1 } : x)) }));
    addAudit(user, "ALL", {
      area: "Sessions",
      action: "Closed and locked",
      target: formatSession(year),
      summary: "No one can change its attendance, results, fees or classes any more. Reports stay available.",
      changes: [{ field: "Status", from: "Ended", to: "Closed" }],
      tone: "danger",
    });
    const after = store.get();
    return ok(toSession(after, after.sessions.find((x) => x.startYear === year)!));
  }),

  http.put("/api/setup/sessions/:year/campuses/:campus", async ({ request, params }) => {
    await latency();
    const year = Number(params.year);
    const campus = params.campus as CampusCode;
    const user = requireAny(["setup.manage"], campus);
    if (user instanceof Response) return user;
    const body = (await request.json()) as { startsOn: IsoDate; endsOn: IsoDate; rowVer: number };
    const s = store.get();
    const target = s.sessions.find((x) => x.startYear === year);
    if (!target) return fail(404, "NOT_FOUND", `Session ${formatSession(year)} doesn't exist.`);
    if (target.rowVer !== body.rowVer) return conflict(target.createdBy, target.createdAt);
    if (target.status === "CLOSED" || target.status === "ENDED") return fail(409, "SESSION_READ_ONLY", `${formatSession(year)} has ended. Its dates can't change.`);
    if (!body.startsOn) return vfail("startsOn", "Enter the first day.");
    if (!body.endsOn) return vfail("endsOn", "Enter the last day.");
    if (body.endsOn <= body.startsOn) return vfail("endsOn", "The last day must be after the first day.");
    if (Math.abs(daysBetween(target.startsOn, body.startsOn)) > 60) return vfail("startsOn", `Keep it within two months of the session's start (${formatDate(target.startsOn)}).`);
    const old = target.campusDates[campus] ?? { startsOn: target.startsOn, endsOn: target.endsOn };
    const same = body.startsOn === target.startsOn && body.endsOn === target.endsOn;
    const campusDates = { ...target.campusDates };
    if (same) delete campusDates[campus];
    else campusDates[campus] = { startsOn: body.startsOn, endsOn: body.endsOn };
    store.set((st) => ({ ...st, sessions: st.sessions.map((x) => (x.startYear === year ? { ...x, campusDates, rowVer: x.rowVer + 1 } : x)) }));
    addAudit(user, campus, {
      area: "Sessions",
      action: "Changed campus dates",
      target: `${formatSession(year)} · ${campusName(campus)}`,
      summary: same ? "Back on the session's own dates." : "This campus runs on its own dates.",
      changes: diff([
        ["Starts on", formatDate(old.startsOn), formatDate(body.startsOn)],
        ["Ends on", formatDate(old.endsOn), formatDate(body.endsOn)],
      ]),
    });
    const after = store.get();
    return ok(toSession(after, after.sessions.find((x) => x.startYear === year)!));
  }),

  /* ---------------- Levels and classes */
  http.get("/api/setup/levels", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requireAny(SETUP_OR_CAMPUS, ctx.campus);
    if (user instanceof Response) return user;
    const s = store.get();
    return ok(levelsOf(s).slice().sort((a, b) => a.order - b.order).map((l) => toLevel(s, l)));
  }),

  ...(["post", "put"] as const).map((method) =>
    http[method](method === "post" ? "/api/setup/levels" : "/api/setup/levels/:id", async ({ request, params }) => {
      await latency();
      const user = requireAny(["setup.manage"], "ALL");
      if (user instanceof Response) return fail(403, "FORBIDDEN", "Class levels are shared by every campus. Only head office can change them.");
      const body = (await request.json()) as SetupClassLevelInput;
      const s = store.get();
      const levels = levelsOf(s);
      const id = params.id as string | undefined;
      const rec = id ? levels.find((l) => l.id === id) : undefined;
      if (id && !rec) return fail(404, "NOT_FOUND", "That level doesn't exist.");
      if (rec && body.rowVer !== rec.rowVer) return conflict("Kamran Yousaf", "2026-10-20T09:05:00+05:00");
      const name = (body.name ?? "").trim();
      if (!name) return vfail("name", "Enter the level name, e.g. Intermediate.");
      if (name.length > 40) return vfail("name", "Keep the level name to 40 characters.");
      if (levels.some((l) => l.id !== id && l.name.toLowerCase() === name.toLowerCase())) return vfail("name", `${name} already exists.`);
      if (!Number.isInteger(body.order) || body.order < 1 || body.order > 99) return vfail("order", "Enter a display order from 1 to 99.");
      if (rec && rec.active && !body.active) {
        const using = s.classes.filter((c) => c.levelId === rec.id && c.active);
        if (using.length) return vfail("active", `${using.length} class${using.length === 1 ? " is" : "es are"} still in ${rec.name} (${using.slice(0, 3).map((c) => c.name).join(", ")}${using.length > 3 ? " …" : ""}). Move ${using.length === 1 ? "it" : "them"} to another level or switch ${using.length === 1 ? "it" : "them"} off first.`);
      }
      const next: LevelRecord = {
        id: rec?.id ?? `lv-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 20) || s.seq}`,
        name,
        order: body.order,
        active: body.active,
        degree: body.degree ?? rec?.degree ?? false,
        rowVer: (rec?.rowVer ?? 0) + 1,
      };
      if (!rec && levels.some((l) => l.id === next.id)) next.id = `${next.id}-${s.seq}`;
      store.set((st) => ({ ...st, levels: rec ? levelsOf(st).map((l) => (l.id === rec.id ? next : l)) : [...levelsOf(st), next] }));
      addAudit(user, "ALL", {
        area: "Classes",
        action: rec ? "Changed level" : "Added level",
        target: name,
        summary: rec ? "Levels group classes on reports and dashboards." : "Choose it for a class under Classes.",
        changes: rec ? diff([["Name", rec.name, next.name], ["Display order", rec.order, next.order], ["In use", rec.active, next.active], ["Degree programmes", rec.degree, next.degree]]) : [],
        tone: rec ? (rec.active && !next.active ? "warning" : "neutral") : "success",
      });
      return ok(toLevel(store.get(), next));
    }),
  ),

  http.get("/api/setup/classes", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requireAny(SETUP_OR_CAMPUS, ctx.campus);
    if (user instanceof Response) return user;
    const s = store.get();
    return ok(s.classes.slice().sort((a, b) => a.order - b.order).map((c) => toClass(s, c, ctx.campus, ctx.session)));
  }),

  ...(["post", "put"] as const).map((method) =>
    http[method](method === "post" ? "/api/setup/classes" : "/api/setup/classes/:id", async ({ request, params }) => {
      await latency();
      const user = requireAny(["setup.manage"], "ALL");
      if (user instanceof Response) return fail(403, "FORBIDDEN", "Classes are shared by every campus. Only head office can change them.");
      const body = (await request.json()) as SetupClassInput;
      const s = store.get();
      const id = params.id as string | undefined;
      const rec = id ? s.classes.find((c) => c.id === id) : undefined;
      if (id && !rec) return fail(404, "NOT_FOUND", "That class doesn't exist.");
      if (rec && body.rowVer !== rec.rowVer) return conflict("Kamran Yousaf", "2026-10-20T09:05:00+05:00");
      const name = body.name.trim();
      const short = body.short.trim();
      if (!name) return vfail("name", "Enter the class name, e.g. Class 7.");
      if (s.classes.some((c) => c.id !== id && c.name.toLowerCase() === name.toLowerCase())) return vfail("name", `${name} already exists.`);
      if (!/^[A-Za-z0-9]{1,6}$/.test(short)) return vfail("short", "Use 1 to 6 letters or numbers, e.g. 7 or Prep. It appears in section names like 7-B.");
      if (s.classes.some((c) => c.id !== id && c.short.toLowerCase() === short.toLowerCase())) return vfail("short", `${short} is already used by another class.`);
      const level = levelsOf(s).find((l) => l.id === body.levelId);
      if (!level) return vfail("levelId", "Choose the level this class belongs to.");
      if (!level.active && body.active && rec?.levelId !== level.id) return vfail("levelId", `${level.name} is not in use. Choose another level, or switch it on under Levels.`);
      if (body.maxAge !== null && (!Number.isInteger(body.maxAge) || body.maxAge < 3 || body.maxAge > 30)) return vfail("maxAge", "Enter an age between 3 and 30, or leave it empty.");
      if (rec && rec.active && !body.active) {
        const open = s.sections.filter((x) => x.classId === rec.id && x.active && (x.session === currentSession(s).startYear)).length;
        if (open) return fail(409, "IN_USE", `${rec.name} has ${open} section${open === 1 ? "" : "s"} this session. Close them first.`, { field: "active" });
      }
      const next: ClassRecord = {
        id: rec?.id ?? `c-${short.toLowerCase()}`,
        name,
        short,
        nameUrdu: body.nameUrdu.trim(),
        levelId: body.levelId,
        order: Number.isFinite(body.order) ? body.order : s.classes.length + 1,
        maxAge: body.maxAge,
        shift: body.shift,
        active: body.active,
        rowVer: (rec?.rowVer ?? 0) + 1,
      };
      store.set((st) => ({ ...st, classes: rec ? st.classes.map((c) => (c.id === rec.id ? next : c)) : [...st.classes, next] }));
      addAudit(user, "ALL", {
        area: "Classes",
        action: rec ? "Changed class" : "Added class",
        target: name,
        summary: rec ? "Shared by every campus." : "Available to every campus. Add sections where it is taught.",
        changes: rec ? diff([["Name", rec.name, next.name], ["Short name", rec.short, next.short], ["Urdu name", rec.nameUrdu, next.nameUrdu], ["Level", rec.levelId, next.levelId], ["Maximum age", rec.maxAge, next.maxAge], ["Active", rec.active, next.active]]) : [],
        tone: rec ? "neutral" : "success",
      });
      const ctx = ctxFrom(new URL(request.url));
      return ok(toClass(store.get(), next, ctx.campus, ctx.session));
    }),
  ),

  /* ---------------- Sections */
  http.get("/api/setup/sections", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requireAny(SETUP_OR_CAMPUS, ctx.campus);
    if (user instanceof Response) return user;
    const s = store.get();
    const order = new Map(s.classes.map((c) => [c.id, c.order]));
    return ok(
      s.sections
        .filter((x) => x.session === ctx.session && inScope(ctx.campus, x.campus))
        .sort((a, b) => a.campus.localeCompare(b.campus) || (order.get(a.classId) ?? 0) - (order.get(b.classId) ?? 0) || a.name.localeCompare(b.name))
        .map((x) => toSection(s, x)),
    );
  }),

  ...(["post", "put"] as const).map((method) =>
    http[method](method === "post" ? "/api/setup/sections" : "/api/setup/sections/:id", async ({ request, params }) => {
      await latency();
      const ctx = ctxFrom(new URL(request.url));
      if (ctx.campus === "ALL") return fail(422, "CAMPUS_REQUIRED", "Choose a campus first. Sections always belong to one campus.");
      // Head office, or the campus's own principal (setup.campus) for sections at their campus.
      const user = requireAny(SETUP_OR_CAMPUS, ctx.campus);
      if (user instanceof Response) return user;
      const s = store.get();
      const ro = sessionEditable(s, ctx.session);
      if (ro) return ro;
      const body = (await request.json()) as SetupSectionInput;
      const id = params.id as string | undefined;
      const rec = id ? s.sections.find((x) => x.id === id) : undefined;
      if (id && !rec) return fail(404, "NOT_FOUND", "That section doesn't exist.");
      if (rec && rec.campus !== ctx.campus) return fail(404, "NOT_FOUND", "That section isn't at this campus.");
      if (rec && body.rowVer !== rec.rowVer) return conflict("Mrs Sadia Rehman", "2026-10-20T09:05:00+05:00");
      const cls = s.classes.find((c) => c.id === body.classId);
      if (!cls) return vfail("classId", "Choose a class.");
      if (!cls.active) return vfail("classId", `${cls.name} is switched off. Switch it on in Classes first.`);
      const name = (body.name ?? "").trim().replace(/\s+/g, " ");
      if (!setupSectionNameOk(name)) return vfail("name", SETUP_SECTION_NAME_RULE);
      const clash = s.sections.find((x) => x.id !== id && x.campus === ctx.campus && x.session === ctx.session && x.classId === cls.id && x.name.toLowerCase() === name.toLowerCase());
      if (clash) return vfail("name", `${setupSectionLabel(cls, clash.name)} already exists at ${campusName(ctx.campus)}.`);
      const degree = Boolean(levelOf(s, cls.id)?.degree);
      const kind = body.kind ?? rec?.kind ?? "SECTION";
      if (kind === "BATCH" && !degree) return vfail("kind", `Batches are for degree programmes. ${cls.name} has sections.`);
      const label = setupSectionLabel(cls, name);
      const groups = s.groups.filter((g) => g.classIds.includes(cls.id) && g.active);
      if (groups.length && !body.groupId) return vfail("groupId", `${cls.name} has groups. Choose the group this section studies.`);
      if (body.groupId && !groups.some((g) => g.id === body.groupId)) return vfail("groupId", `That group isn't offered in ${cls.name}.`);
      if (!Number.isInteger(body.seats) || body.seats < 1 || body.seats > 200) return vfail("seats", "Enter the number of seats, from 1 to 200.");
      if (rec && body.seats < rec.strength) return vfail("seats", `${rec.strength} students are already in ${sectionLabel(s, rec)}. Seats can't be fewer than that.`);
      if (body.room.trim().length > 30) return vfail("room", "Keep the room name under 30 characters.");
      if (rec && rec.active && !body.active && rec.strength > 0) return fail(409, "IN_USE", `${rec.strength} students are in ${sectionLabel(s, rec)}. Move them to another section first.`, { field: "active" });
      let newId = `${ctx.campus}-${ctx.session}-${cls.short}-${name.replace(/[^A-Za-z0-9]+/g, "")}`;
      if (!rec && s.sections.some((x) => x.id === newId)) newId = `${newId}-${s.seq}`;
      const next: SectionRecord = {
        id: rec?.id ?? newId,
        campus: ctx.campus,
        session: ctx.session,
        classId: cls.id,
        name,
        groupId: body.groupId || null,
        seats: body.seats,
        room: body.room.trim(),
        strength: rec?.strength ?? 0,
        classTeacherId: rec?.classTeacherId ?? null,
        active: body.active,
        kind,
        rowVer: (rec?.rowVer ?? 0) + 1,
      };
      store.set((st) => ({ ...st, sections: rec ? st.sections.map((x) => (x.id === rec.id ? next : x)) : [...st.sections, next] }));
      addAudit(user, ctx.campus, {
        area: "Classes",
        action: rec ? (kind === "BATCH" ? "Changed batch" : "Changed section") : kind === "BATCH" ? "Added batch" : "Added section",
        target: label,
        summary: `${campusName(ctx.campus)}, ${formatSession(ctx.session)}.`,
        changes: rec ? diff([["Section", rec.name, next.name], ["Kind", rec.kind === "BATCH" ? "Batch" : "Section", kind === "BATCH" ? "Batch" : "Section"], ["Group", rec.groupId, next.groupId], ["Seats", rec.seats, next.seats], ["Room", rec.room, next.room], ["Open", rec.active, next.active]]) : [],
        tone: rec ? "neutral" : "success",
      });
      return ok(toSection(store.get(), next));
    }),
  ),

  /* ---------------- Subjects and groups */
  http.get("/api/setup/subjects", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requireAny(["setup.manage"], ctx.campus);
    if (user instanceof Response) return user;
    const s = store.get();
    return ok(
      s.subjects
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((x): SetupSubject => ({ ...x, classCount: new Set(s.classSubjects.filter((c) => c.subjects.some((r) => r.subjectId === x.id)).map((c) => c.classId)).size })),
    );
  }),

  ...(["post", "put"] as const).map((method) =>
    http[method](method === "post" ? "/api/setup/subjects" : "/api/setup/subjects/:id", async ({ request, params }) => {
      await latency();
      const user = requireAny(["setup.manage"], "ALL");
      if (user instanceof Response) return fail(403, "FORBIDDEN", "Subjects are shared by every campus. Only head office can change them.");
      const body = (await request.json()) as SetupSubjectInput;
      const s = store.get();
      const id = params.id as string | undefined;
      const rec = id ? s.subjects.find((x) => x.id === id) : undefined;
      if (id && !rec) return fail(404, "NOT_FOUND", "That subject doesn't exist.");
      if (rec && body.rowVer !== rec.rowVer) return conflict("Kamran Yousaf", "2026-10-21T15:10:00+05:00");
      const name = body.name.trim();
      const code = body.code.trim().toUpperCase();
      if (!name) return vfail("name", "Enter the subject name.");
      if (s.subjects.some((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) return vfail("name", `${name} already exists.`);
      if (!/^[A-Z][A-Z0-9]{1,5}$/.test(code)) return vfail("code", "Use 2 to 6 capital letters or numbers, starting with a letter, e.g. MATH or CS301.");
      if (s.subjects.some((x) => x.id !== id && x.code === code)) return vfail("code", `${code} is already used by another subject.`);
      if (rec && rec.active && !body.active) {
        const used = new Set(s.classSubjects.filter((c) => c.subjects.some((r) => r.subjectId === rec.id)).map((c) => c.classId)).size;
        if (used) return fail(409, "IN_USE", `${rec.name} is taught in ${used} class${used === 1 ? "" : "es"}. Remove it from those classes first.`, { field: "active" });
      }
      const next: SubjectRecord = { id: rec?.id ?? code.toLowerCase(), code, name, nameUrdu: body.nameUrdu.trim(), medium: body.medium, order: body.order, active: body.active, rowVer: (rec?.rowVer ?? 0) + 1 };
      if (!rec && s.subjects.some((x) => x.id === next.id)) next.id = `${next.id}-${s.seq}`;
      store.set((st) => ({ ...st, subjects: rec ? st.subjects.map((x) => (x.id === rec.id ? next : x)) : [...st.subjects, next] }));
      addAudit(user, "ALL", {
        area: "Subjects",
        action: rec ? "Changed subject" : "Added subject",
        target: name,
        summary: rec ? "Shared by every campus." : "Add it to the classes that study it.",
        changes: rec ? diff([["Name", rec.name, next.name], ["Code", rec.code, next.code], ["Urdu name", rec.nameUrdu, next.nameUrdu], ["Medium", rec.medium, next.medium], ["Active", rec.active, next.active]]) : [],
        tone: rec ? "neutral" : "success",
      });
      return ok({ ...next, classCount: 0 } satisfies SetupSubject);
    }),
  ),

  http.get("/api/setup/groups", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requireAny(SETUP_OR_CAMPUS, ctx.campus);
    if (user instanceof Response) return user;
    return ok(store.get().groups.map((g): SetupGroup => ({ ...g, short: g.short ?? "" })));
  }),

  ...(["post", "put"] as const).map((method) =>
    http[method](method === "post" ? "/api/setup/groups" : "/api/setup/groups/:id", async ({ request, params }) => {
      await latency();
      const user = requireAny(["setup.manage"], "ALL");
      if (user instanceof Response) return fail(403, "FORBIDDEN", "Groups are shared by every campus. Only head office can change them.");
      const body = (await request.json()) as SetupGroupInput;
      const s = store.get();
      const id = params.id as string | undefined;
      const rec = id ? s.groups.find((g) => g.id === id) : undefined;
      if (id && !rec) return fail(404, "NOT_FOUND", "That group doesn't exist.");
      if (rec && body.rowVer !== rec.rowVer) return conflict("Kamran Yousaf", "2026-10-21T15:10:00+05:00");
      const name = body.name.trim();
      if (!name) return vfail("name", "Enter the group name, e.g. Science (Biology).");
      if (s.groups.some((g) => g.id !== id && g.name.toLowerCase() === name.toLowerCase())) return vfail("name", `${name} already exists.`);
      const short = (body.short ?? "").trim();
      if (!/^[A-Za-z0-9 .()-]{1,8}$/.test(short)) return vfail("short", "Use 1 to 8 letters or numbers, e.g. Bio.");
      if (s.groups.some((g) => g.id !== id && (g.short ?? "").toLowerCase() === short.toLowerCase())) return vfail("short", `${short} is already used by another group.`);
      if (!body.classIds.length) return vfail("classIds", "Choose at least one class that offers this group.");
      const next: GroupRecord = { id: rec?.id ?? nextId("g"), name, short, classIds: body.classIds.filter((c) => s.classes.some((x) => x.id === c)), active: body.active, rowVer: (rec?.rowVer ?? 0) + 1 };
      store.set((st) => ({ ...st, groups: rec ? st.groups.map((g) => (g.id === rec.id ? next : g)) : [...st.groups, next] }));
      addAudit(user, "ALL", {
        area: "Subjects",
        action: rec ? "Changed group" : "Added group",
        target: name,
        summary: `Offered in ${next.classIds.map((c) => s.classes.find((x) => x.id === c)?.name ?? c).join(", ")}.`,
        changes: rec ? diff([["Name", rec.name, next.name], ["Short title", rec.short, next.short], ["In use", rec.active, next.active]]) : [],
        tone: rec ? "neutral" : "success",
      });
      return ok(next satisfies SetupGroup);
    }),
  ),

  http.get("/api/setup/class-subjects", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requireAny(SETUP_OR_CAMPUS, ctx.campus);
    if (user instanceof Response) return user;
    const classId = url.searchParams.get("classId") ?? "";
    const groupId = url.searchParams.get("groupId") || null;
    const s = store.get();
    if (!s.classes.some((c) => c.id === classId)) return fail(404, "NOT_FOUND", "That class doesn't exist.");
    return ok(toClassSubjects(s, classId, groupId));
  }),

  http.put("/api/setup/class-subjects", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const user = requireAny(["setup.manage"], "ALL");
    if (user instanceof Response) return fail(403, "FORBIDDEN", "Class subjects are shared by every campus. Only head office can change them.");
    const classId = url.searchParams.get("classId") ?? "";
    const groupId = url.searchParams.get("groupId") || null;
    const body = (await request.json()) as { subjects: Array<{ subjectId: string; maxMarks: number; passMarks: number; periodsPerWeek: number; creditHours?: number; order: number; optional: boolean }>; rowVer: number };
    const s = store.get();
    const cls = s.classes.find((c) => c.id === classId);
    if (!cls) return fail(404, "NOT_FOUND", "That class doesn't exist.");
    const degree = Boolean(levelOf(s, cls.id)?.degree);
    const key = classSubjectKey(classId, groupId);
    const rec = s.classSubjects.find((c) => c.key === key);
    if ((rec?.rowVer ?? 0) !== body.rowVer) return conflict(rec?.updatedBy ?? "Kamran Yousaf", rec?.updatedAt ?? demoNow());
    const seen = new Set<string>();
    for (const [i, r] of body.subjects.entries()) {
      const sub = s.subjects.find((x) => x.id === r.subjectId);
      const line = { details: { line: i } };
      if (!sub) return fail(422, "VALIDATION", `Row ${i + 1}: choose a subject.`, { field: "subjects", ...line });
      if (seen.has(r.subjectId)) return fail(422, "VALIDATION", `${sub.name} is listed twice.`, { field: "subjects", ...line });
      seen.add(r.subjectId);
      if (!Number.isInteger(r.maxMarks) || r.maxMarks < 1 || r.maxMarks > 1000) return fail(422, "VALIDATION", `${sub.name}: maximum marks must be a whole number from 1 to 1000.`, { field: "subjects", ...line });
      if (!Number.isInteger(r.passMarks) || r.passMarks < 0 || r.passMarks > r.maxMarks) return fail(422, "VALIDATION", `${sub.name}: pass marks must be between 0 and ${r.maxMarks}.`, { field: "subjects", ...line });
      if (!Number.isInteger(r.periodsPerWeek) || r.periodsPerWeek < 0 || r.periodsPerWeek > 12) return fail(422, "VALIDATION", `${sub.name}: periods a week must be from 0 to 12.`, { field: "subjects", ...line });
      const ch = r.creditHours ?? 0;
      if (!Number.isInteger(ch) || ch < 0 || ch > 6) return fail(422, "VALIDATION", `${sub.name}: credit hours must be a whole number from 0 to 6.`, { field: "subjects", ...line });
      if (degree && ch < 1) return fail(422, "VALIDATION", `${sub.name}: ${cls.name} is a degree programme, so give at least 1 credit hour.`, { field: "subjects", ...line });
    }
    const before = toClassSubjects(s, classId, groupId).subjects;
    const nameOf = (id: string) => s.subjects.find((x) => x.id === id)?.name ?? id;
    const changes: SetupAuditChange[] = [];
    for (const r of body.subjects) {
      const old = before.find((b) => b.subjectId === r.subjectId);
      if (!old) changes.push({ field: nameOf(r.subjectId), from: "—", to: `Added · ${r.maxMarks} marks` });
      else {
        if (old.maxMarks !== r.maxMarks) changes.push({ field: `${nameOf(r.subjectId)} maximum marks`, from: String(old.maxMarks), to: String(r.maxMarks) });
        if (old.passMarks !== r.passMarks) changes.push({ field: `${nameOf(r.subjectId)} pass marks`, from: String(old.passMarks), to: String(r.passMarks) });
        if (old.periodsPerWeek !== r.periodsPerWeek) changes.push({ field: `${nameOf(r.subjectId)} periods a week`, from: String(old.periodsPerWeek), to: String(r.periodsPerWeek) });
        if (old.creditHours !== (r.creditHours ?? 0)) changes.push({ field: `${nameOf(r.subjectId)} credit hours`, from: String(old.creditHours), to: String(r.creditHours ?? 0) });
      }
    }
    for (const b of before) if (!body.subjects.some((r) => r.subjectId === b.subjectId)) changes.push({ field: b.subjectName, from: `${b.maxMarks} marks`, to: "Removed" });
    const next: ClassSubjectsRecord = {
      key,
      classId,
      groupId,
      subjects: body.subjects.map((r, i) => ({ subjectId: r.subjectId, maxMarks: r.maxMarks, passMarks: r.passMarks, periodsPerWeek: r.periodsPerWeek, creditHours: r.creditHours ?? 0, order: i + 1, optional: r.optional })),
      rowVer: (rec?.rowVer ?? 0) + 1,
      updatedAt: demoNow(),
      updatedBy: user.name,
    };
    store.set((st) => ({ ...st, classSubjects: rec ? st.classSubjects.map((c) => (c.key === key ? next : c)) : [...st.classSubjects, next] }));
    const target = `${cls.name}${groupId ? ` · ${s.groups.find((g) => g.id === groupId)?.name ?? ""}` : ""}`;
    if (changes.length) addAudit(user, "ALL", { area: "Subjects", action: "Changed class subjects", target, summary: `Total ${body.subjects.reduce((a, r) => a + r.maxMarks, 0)} marks. New exams use these marks; exams already created keep theirs.`, changes });
    return ok(toClassSubjects(store.get(), classId, groupId));
  }),

  /* ---------------- Teacher allotment */
  http.get("/api/setup/staffing", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    if (ctx.campus === "ALL") return fail(422, "CAMPUS_REQUIRED", "Choose a campus first. Teachers are allotted campus by campus.");
    const user = requireAny(SETUP_OR_CAMPUS, ctx.campus);
    if (user instanceof Response) return user;
    const s = store.get();
    const order = new Map(s.classes.map((c) => [c.id, c.order]));
    const sections = s.sections
      .filter((x) => x.campus === ctx.campus && x.session === ctx.session && x.active)
      .sort((a, b) => (order.get(a.classId) ?? 0) - (order.get(b.classId) ?? 0) || a.name.localeCompare(b.name));
    const loads = teacherLoads(s, ctx.campus, ctx.session);
    const body: SetupStaffing = {
      sections: sections.map((x) => toStaffing(s, x)),
      teachers: s.teachers
        .filter((t) => t.campus === ctx.campus)
        .map((t) => {
          const ct = sections.find((x) => x.classTeacherId === t.id);
          return { id: t.id, name: t.name, campus: t.campus, subjectIds: t.subjectIds, periodsPerWeek: loads.get(t.id) ?? 0, classTeacherOf: ct ? toSection(s, ct).label : null };
        })
        .sort((a, b) => a.name.replace(/^(Mr|Ms|Mrs|Dr)\s+/, "").localeCompare(b.name.replace(/^(Mr|Ms|Mrs|Dr)\s+/, ""))),
      maxPeriods: 36,
    };
    return ok(body);
  }),

  http.put("/api/setup/staffing/:sectionId", async ({ request, params }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    if (ctx.campus === "ALL") return fail(422, "CAMPUS_REQUIRED", "Choose a campus first.");
    // Head office, or the campus's own principal (setup.campus) for sections at their campus.
    const user = requireAny(SETUP_OR_CAMPUS, ctx.campus);
    if (user instanceof Response) return user;
    const s = store.get();
    const ro = sessionEditable(s, ctx.session);
    if (ro) return ro;
    const body = (await request.json()) as SetupStaffingInput;
    const sec = s.sections.find((x) => x.id === params.sectionId);
    if (!sec || sec.campus !== ctx.campus) return fail(404, "NOT_FOUND", "That section isn't at this campus.");
    if ((s.staffingRowVer[sec.id] ?? 1) !== body.rowVer) return conflict("Kamran Yousaf", "2026-11-03T16:20:00+05:00");
    const label = toSection(s, sec).label;
    const teacherAt = (id: string) => s.teachers.find((t) => t.id === id && t.campus === ctx.campus);
    if (body.classTeacherId) {
      const t = teacherAt(body.classTeacherId);
      if (!t) return vfail("classTeacherId", "Choose a teacher from this campus.");
      const other = s.sections.find((x) => x.id !== sec.id && x.campus === ctx.campus && x.session === ctx.session && x.active && x.classTeacherId === t.id);
      if (other) return vfail("classTeacherId", `${t.name} is already class teacher of ${toSection(s, other).label}. Choose someone else, or change ${toSection(s, other).label} first.`);
    }
    for (const r of body.subjects) if (r.teacherId && !teacherAt(r.teacherId)) return fail(422, "VALIDATION", "Choose subject teachers from this campus.", { field: "subjects" });
    const beforeMap = s.subjectTeachers[sec.id] ?? {};
    const nameOf = (id: string | null | undefined) => (id ? (s.teachers.find((t) => t.id === id)?.name ?? "—") : "—");
    const subName = (id: string) => s.subjects.find((x) => x.id === id)?.name ?? id;
    const changes: SetupAuditChange[] = [];
    if ((sec.classTeacherId ?? null) !== (body.classTeacherId ?? null)) changes.push({ field: "Class teacher", from: nameOf(sec.classTeacherId), to: nameOf(body.classTeacherId) });
    const map: Record<string, string | null> = {};
    for (const r of body.subjects) {
      map[r.subjectId] = r.teacherId;
      if ((beforeMap[r.subjectId] ?? null) !== (r.teacherId ?? null)) changes.push({ field: subName(r.subjectId), from: nameOf(beforeMap[r.subjectId]), to: nameOf(r.teacherId) });
    }
    store.set((st) => ({
      ...st,
      sections: st.sections.map((x) => (x.id === sec.id ? { ...x, classTeacherId: body.classTeacherId } : x)),
      subjectTeachers: { ...st.subjectTeachers, [sec.id]: map },
      staffingRowVer: { ...st.staffingRowVer, [sec.id]: (st.staffingRowVer[sec.id] ?? 1) + 1 },
    }));
    if (changes.length) addAudit(user, ctx.campus, { area: "Teachers", action: "Changed teachers", target: label, summary: `${campusName(ctx.campus)}, ${formatSession(ctx.session)}. Timetables and marks entry follow these teachers.`, changes });
    const after = store.get();
    return ok(toStaffing(after, after.sections.find((x) => x.id === sec.id)!));
  }),

  /* ---------------- Users */
  http.get("/api/setup/users", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requireAny(["users.manage"], ctx.campus);
    if (user instanceof Response) return user;
    const s = store.get();
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const role = url.searchParams.get("role") ?? "";
    const filter = (url.searchParams.get("filter") ?? "ALL") as SetupUserFilter;
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const pageSize = Math.min(100, Math.max(5, Number(url.searchParams.get("pageSize") ?? 25)));
    const digits = q.replace(/\D/g, "");
    const base = s.users
      .filter((u) => userVisible(u, ctx.campus))
      .filter((u) => !q || u.name.toLowerCase().includes(q) || u.username.includes(q) || (digits.length >= 3 && u.mobile.replace(/\D/g, "").includes(digits)) || (u.staffNo ?? "").toLowerCase().includes(q))
      .filter((u) => !role || u.grants.some((g) => g.roleId === role));
    const filters: SetupUserFilter[] = ["ALL", "ACTIVE", "INVITED", "LOCKED", "DISABLED", "NO_TWO_STEP", "MUST_CHANGE", "STAFF_LEFT"];
    const counts = Object.fromEntries(filters.map((f) => [f, base.filter((u) => matchesFilter(s, u, f)).length])) as Record<SetupUserFilter, number>;
    const sortName = (n: string) => n.replace(/^(Mr|Ms|Mrs|Dr)\s+/, "");
    const items = base.filter((u) => matchesFilter(s, u, filter)).sort((a, b) => sortName(a.name).localeCompare(sortName(b.name)));
    return ok({ items: items.slice((page - 1) * pageSize, page * pageSize).map((u) => toUser(s, u, user)), total: items.length, page, pageSize, counts });
  }),

  http.get("/api/setup/users/:id", async ({ request, params }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requireAny(["users.manage"], ctx.campus);
    if (user instanceof Response) return user;
    const s = store.get();
    const u = s.users.find((x) => x.id === params.id);
    if (!u || !userVisible(u, ctx.campus)) return fail(404, "NOT_FOUND", "That account doesn't exist at this campus.");
    return ok(toUserDetail(s, u, user));
  }),

  http.post("/api/setup/users", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requireAny(["users.manage"], ctx.campus);
    if (user instanceof Response) return user;
    const key = request.headers.get("Idempotency-Key");
    const s = store.get();
    if (key && s.idem[key]) {
      const done = s.users.find((u) => u.id === s.idem[key]);
      if (done) return ok(toUserDetail(s, done, user));
    }
    const body = (await request.json()) as SetupNewUserInput;
    const invalid = validateUser(s, user, body, null);
    if (invalid) return invalid;
    if (body.setup === "PASSWORD") {
      const failed = setupPasswordChecks(body.temporaryPassword ?? "", body.username).find((c) => !c.ok);
      if (failed) return vfail("temporaryPassword", `The temporary password doesn't meet the rules: ${failed.label.toLowerCase()}.`);
    }
    const now = demoNow();
    const id = nextId("u");
    const required = body.grants.some((g) => s.roles.find((r) => r.id === g.roleId)?.twoStepRequired);
    const rec: UserRecord = {
      id,
      username: body.username.trim().toLowerCase(),
      name: body.name.trim(),
      mobile: formatMobile(body.mobile),
      email: body.email?.trim() || null,
      staffNo: body.staffNo?.trim().toUpperCase() || null,
      status: body.setup === "INVITE" ? "INVITED" : "ACTIVE",
      grants: body.grants.map((g) => ({ roleId: g.roleId, campus: g.campus })),
      twoStep: required || body.twoStep,
      mustChangePassword: body.setup === "INVITE" ? true : body.mustChangePassword,
      lastSignInAt: null,
      lastSignInDevice: null,
      failedAttempts: 0,
      lockedAt: null,
      disabledReason: null,
      passwordChangedAt: body.setup === "PASSWORD" ? now : null,
      createdAt: now,
      createdBy: user.name,
      updatedAt: now,
      updatedBy: user.name,
      rowVer: 1,
      signIns: [],
    };
    store.set((st) => ({ ...st, users: [...st.users, rec], idem: key ? { ...st.idem, [key]: id } : st.idem }));
    const after = store.get();
    const roles = toUser(after, rec, user).grants.map((g) => `${g.roleName} — ${g.campusName}`).join("; ");
    addAudit(user, rec.grants[0]?.campus ?? ctx.campus, {
      area: "Users",
      action: body.setup === "INVITE" ? "Invited" : "Created account",
      target: rec.name,
      summary: body.setup === "INVITE" ? `A one-time sign-in code was sent to ${rec.mobile.slice(0, 5)}•••••${rec.mobile.slice(-2)}.` : `Temporary password set${rec.mustChangePassword ? "; must be changed at first sign-in" : ""}.`,
      changes: [{ field: "Roles", from: "—", to: roles }],
      tone: "success",
    });
    return ok(toUserDetail(after, rec, user));
  }),

  http.put("/api/setup/users/:id", async ({ request, params }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requireAny(["users.manage"], ctx.campus);
    if (user instanceof Response) return user;
    const s = store.get();
    const rec = s.users.find((u) => u.id === params.id);
    if (!rec) return fail(404, "NOT_FOUND", "That account doesn't exist.");
    const managed = rec.grants.every((g) => can(user, "users.manage", g.campus));
    if (!managed) return fail(403, "FORBIDDEN", "This account is managed by head office. Ask them to change it.");
    if (takeConflict(`user:${rec.id}`)) {
      const other = otherUser(user);
      const by = other.name;
      const at = demoNow();
      store.set((st) => ({ ...st, users: st.users.map((u) => (u.id === rec.id ? { ...u, mobile: "0308-5550174", rowVer: u.rowVer + 1, updatedAt: at, updatedBy: by } : u)) }));
      addAudit(other, rec.grants[0]?.campus ?? ctx.campus, { area: "Users", action: "Changed account", target: rec.name, summary: "New mobile number from the staff office.", changes: [{ field: "Mobile", from: rec.mobile, to: "0308-5550174" }] });
      return conflict(by, at);
    }
    const body = (await request.json()) as SetupUserInput;
    if (body.rowVer !== rec.rowVer) return conflict(rec.updatedBy, rec.updatedAt);
    const invalid = validateUser(s, user, body, rec);
    if (invalid) return invalid;
    const required = body.grants.some((g) => s.roles.find((r) => r.id === g.roleId)?.twoStepRequired);
    const next: UserRecord = {
      ...rec,
      name: body.name.trim(),
      username: body.username.trim().toLowerCase(),
      mobile: formatMobile(body.mobile),
      email: body.email?.trim() || null,
      staffNo: body.staffNo?.trim().toUpperCase() || null,
      grants: body.grants.map((g) => ({ roleId: g.roleId, campus: g.campus })),
      twoStep: required || body.twoStep,
      rowVer: rec.rowVer + 1,
      updatedAt: demoNow(),
      updatedBy: user.name,
    };
    const roleText = (u: UserRecord) => toUser(s, u, user).grants.map((g) => `${g.roleName} — ${g.campusName}`).join("; ");
    const changes = diff([
      ["Name", rec.name, next.name],
      ["Username", rec.username, next.username],
      ["Mobile", rec.mobile, next.mobile],
      ["Email", rec.email, next.email],
      ["Staff number", rec.staffNo, next.staffNo],
      ["Roles", roleText(rec), roleText(next)],
      ["Two-step sign-in", rec.twoStep, next.twoStep],
    ]);
    store.set((st) => ({ ...st, users: st.users.map((u) => (u.id === rec.id ? next : u)) }));
    if (changes.length) addAudit(user, next.grants[0]?.campus ?? ctx.campus, { area: "Users", action: changes.some((c) => c.field === "Roles") ? "Changed roles" : "Changed account", target: next.name, summary: changes.some((c) => c.field === "Roles") ? "Takes effect at the next page they open." : `${changes.length} detail${changes.length === 1 ? "" : "s"} changed.`, changes, tone: changes.some((c) => c.field === "Roles") ? "warning" : "neutral" });
    return ok(toUserDetail(store.get(), next, user));
  }),

  http.post("/api/setup/users/:id/actions", async ({ request, params }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requireAny(["users.manage"], ctx.campus);
    if (user instanceof Response) return user;
    const s = store.get();
    const rec = s.users.find((u) => u.id === params.id);
    if (!rec) return fail(404, "NOT_FOUND", "That account doesn't exist.");
    if (!rec.grants.every((g) => can(user, "users.manage", g.campus))) return fail(403, "FORBIDDEN", "This account is managed by head office. Ask them to change it.");
    const body = (await request.json()) as SetupUserAction & { rowVer: number };
    if (body.rowVer !== rec.rowVer) return conflict(rec.updatedBy, rec.updatedAt);
    const self = rec.id === user.id;
    const now = demoNow();
    let next: UserRecord = { ...rec, rowVer: rec.rowVer + 1, updatedAt: now, updatedBy: user.name };
    let audit: { action: string; summary: string; tone: SetupAuditEntry["tone"]; changes?: SetupAuditChange[] };
    const required = rec.grants.some((g) => s.roles.find((r) => r.id === g.roleId)?.twoStepRequired);
    switch (body.type) {
      case "LOCK":
        if (self) return fail(422, "VALIDATION", "You can't lock your own account.");
        next = { ...next, status: "LOCKED", lockedAt: now };
        audit = { action: "Locked", summary: "Signed out everywhere. They can't sign in until someone unlocks the account.", tone: "danger", changes: [{ field: "Status", from: "Active", to: "Locked" }] };
        break;
      case "UNLOCK":
        if (rec.status !== "LOCKED") return fail(409, "NOT_LOCKED", "This account isn't locked.");
        next = { ...next, status: "ACTIVE", lockedAt: null, failedAttempts: 0 };
        audit = { action: "Unlocked", summary: "They can sign in again with their current password.", tone: "success", changes: [{ field: "Status", from: "Locked", to: "Active" }] };
        break;
      case "DISABLE":
        if (self) return fail(422, "VALIDATION", "You can't disable your own account.");
        if (!body.reason.trim()) return vfail("reason", "Say why, e.g. \"Left the school on 30-Nov-2026\".");
        next = { ...next, status: "DISABLED", disabledReason: body.reason.trim() };
        audit = { action: "Disabled", summary: `${body.reason.trim()}. Their past work stays on record under their name.`, tone: "danger", changes: [{ field: "Status", from: rec.status === "LOCKED" ? "Locked" : "Active", to: "Disabled" }] };
        break;
      case "ENABLE":
        next = { ...next, status: rec.lastSignInAt ? "ACTIVE" : "INVITED", disabledReason: null, mustChangePassword: true };
        audit = { action: "Enabled", summary: "They must choose a new password at the next sign-in.", tone: "success", changes: [{ field: "Status", from: "Disabled", to: "Active" }] };
        break;
      case "TWO_STEP":
        if (!body.on && required) return fail(422, "TWO_STEP_REQUIRED", "Their role needs two-step sign-in, so it can't be turned off. Change the role first.");
        next = { ...next, twoStep: body.on };
        audit = { action: body.on ? "Turned on two-step sign-in" : "Turned off two-step sign-in", summary: body.on ? "They will set it up at the next sign-in." : "They sign in with a password only.", tone: body.on ? "success" : "warning", changes: [{ field: "Two-step sign-in", from: body.on ? "Off" : "On", to: body.on ? "On" : "Off" }] };
        break;
      case "FORCE_CHANGE":
        next = { ...next, mustChangePassword: body.on };
        audit = { action: body.on ? "Asked to change password" : "Cancelled password change", summary: body.on ? "They must choose a new password at the next sign-in." : "", tone: "neutral" };
        break;
      case "SIGN_OUT_EVERYWHERE":
        audit = { action: "Signed out everywhere", summary: "Every computer and phone they were signed in on has been signed out.", tone: "warning" };
        break;
      case "RESEND_INVITE":
        if (rec.status !== "INVITED") return fail(409, "NOT_INVITED", "This person has already signed in.");
        audit = { action: "Resent sign-in code", summary: `A new one-time code was sent to ${rec.mobile.slice(0, 5)}•••••${rec.mobile.slice(-2)}. It works for 48 hours.`, tone: "neutral" };
        break;
      default:
        return fail(422, "VALIDATION", "Unknown action.");
    }
    store.set((st) => ({ ...st, users: st.users.map((u) => (u.id === rec.id ? next : u)) }));
    addAudit(user, rec.grants[0]?.campus ?? ctx.campus, { area: "Users", action: audit.action, target: rec.name, summary: audit.summary, tone: audit.tone, ...(audit.changes ? { changes: audit.changes } : {}) });
    return ok(toUserDetail(store.get(), next, user));
  }),

  http.post("/api/setup/users/:id/password", async ({ request, params }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requireAny(["users.manage"], ctx.campus);
    if (user instanceof Response) return user;
    const s = store.get();
    const rec = s.users.find((u) => u.id === params.id);
    if (!rec) return fail(404, "NOT_FOUND", "That account doesn't exist.");
    if (!rec.grants.every((g) => can(user, "users.manage", g.campus))) return fail(403, "FORBIDDEN", "This account is managed by head office. Ask them to reset it.");
    if (rec.status === "DISABLED") return fail(409, "DISABLED", "This account is disabled. Enable it first.");
    const body = (await request.json()) as SetupResetPasswordInput;
    if (body.rowVer !== rec.rowVer) return conflict(rec.updatedBy, rec.updatedAt);
    const failed = setupPasswordChecks(body.temporaryPassword, rec.username).find((c) => !c.ok);
    if (failed) return vfail("temporaryPassword", `The password doesn't meet the rules: ${failed.label.toLowerCase()}.`);
    const now = demoNow();
    // The password itself is never stored or shown back; only the fact it was reset.
    const next: UserRecord = { ...rec, status: rec.status === "LOCKED" ? "ACTIVE" : rec.status, lockedAt: null, failedAttempts: 0, mustChangePassword: body.mustChangePassword, passwordChangedAt: now, rowVer: rec.rowVer + 1, updatedAt: now, updatedBy: user.name };
    store.set((st) => ({ ...st, users: st.users.map((u) => (u.id === rec.id ? next : u)) }));
    addAudit(user, rec.grants[0]?.campus ?? ctx.campus, {
      area: "Users",
      action: "Reset password",
      target: rec.name,
      summary: [body.mustChangePassword ? "Must choose their own password at the next sign-in." : "Temporary password set.", rec.status === "LOCKED" ? "Account unlocked." : "", body.signOutEverywhere ? "Signed out everywhere." : ""].filter(Boolean).join(" "),
      changes: diff([["Must change password", rec.mustChangePassword, body.mustChangePassword], ["Status", rec.status === "LOCKED" ? "Locked" : "", rec.status === "LOCKED" ? "Active" : ""]]),
      tone: "warning",
    });
    return ok(toUserDetail(store.get(), next, user));
  }),

  /* ---------------- Roles */
  http.get("/api/setup/roles", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requireAny(SETUP_OR_USERS, ctx.campus);
    if (user instanceof Response) return user;
    const s = store.get();
    return ok(s.roles.map((r) => toRole(s, r)));
  }),

  ...(["post", "put"] as const).map((method) =>
    http[method](method === "post" ? "/api/setup/roles" : "/api/setup/roles/:id", async ({ request, params }) => {
      await latency();
      const user = requireAny(["setup.manage"], "ALL");
      if (user instanceof Response) return fail(403, "FORBIDDEN", "Only head office can create or change roles.");
      const body = (await request.json()) as SetupRoleInput;
      const s = store.get();
      const id = params.id as string | undefined;
      const rec = id ? s.roles.find((r) => r.id === id) : undefined;
      if (id && !rec) return fail(404, "NOT_FOUND", "That role doesn't exist.");
      if (rec?.system) return fail(403, "SYSTEM_ROLE", "System roles can't be changed. Copy it to make your own role.");
      if (rec && takeConflict(`role:${rec.id}`)) {
        const other = otherUser(user);
        const by = other.name;
        const at = demoNow();
        const perms: Permission[] = rec.permissions.includes("activities.view") ? rec.permissions : [...rec.permissions, "activities.view"];
        store.set((st) => ({ ...st, roles: st.roles.map((r) => (r.id === rec.id ? { ...r, permissions: perms, rowVer: r.rowVer + 1, updatedAt: at, updatedBy: by } : r)) }));
        addAudit(other, "ALL", { area: "Roles", action: "Changed role", target: rec.name, summary: "Can now see scholarship test results.", changes: [{ field: "Permissions added", from: "—", to: "View scholarships, houses and events" }] });
        return conflict(by, at);
      }
      if (rec && body.rowVer !== rec.rowVer) return conflict(rec.updatedBy, rec.updatedAt);
      const name = body.name.trim();
      if (!name) return vfail("name", "Enter a name for the role, e.g. Exam office.");
      if (s.roles.some((r) => r.id !== id && r.name.toLowerCase() === name.toLowerCase())) return vfail("name", `A role called ${name} already exists.`);
      if (!body.permissions.length) return vfail("permissions", "Tick at least one thing this role can do.");
      const next: RoleRecord = {
        id: rec?.id ?? nextId("role"),
        code: rec?.code ?? name.toUpperCase().replace(/[^A-Z]+/g, "_"),
        name,
        description: body.description.trim(),
        system: false,
        scope: body.scope,
        permissions: [...new Set(body.permissions)],
        twoStepRequired: body.twoStepRequired,
        rowVer: (rec?.rowVer ?? 0) + 1,
        updatedAt: demoNow(),
        updatedBy: user.name,
      };
      const added = next.permissions.filter((p) => !rec?.permissions.includes(p));
      const removed = (rec?.permissions ?? []).filter((p) => !next.permissions.includes(p));
      store.set((st) => ({ ...st, roles: rec ? st.roles.map((r) => (r.id === rec.id ? next : r)) : [...st.roles, next] }));
      addAudit(user, "ALL", {
        area: "Roles",
        action: rec ? "Changed role" : "Created role",
        target: name,
        summary: rec ? `${toRole(store.get(), next).userCount} people have this role; changes apply at their next page.` : `${next.permissions.length} permissions.`,
        changes: rec
          ? [
              ...diff([["Name", rec.name, next.name], ["Two-step sign-in required", rec.twoStepRequired, next.twoStepRequired], ["Can be given for all campuses", rec.scope === "ANY", next.scope === "ANY"]]),
              ...(added.length ? [{ field: "Permissions added", from: "—", to: added.length > 3 ? `${added.length} permissions` : added.join(", ") }] : []),
              ...(removed.length ? [{ field: "Permissions removed", from: removed.length > 3 ? `${removed.length} permissions` : removed.join(", "), to: "—" }] : []),
            ]
          : [],
        tone: rec ? "warning" : "success",
      });
      return ok(toRole(store.get(), next));
    }),
  ),

  http.delete("/api/setup/roles/:id", async ({ request, params }) => {
    await latency();
    const user = requireAny(["setup.manage"], "ALL");
    if (user instanceof Response) return fail(403, "FORBIDDEN", "Only head office can delete roles.");
    const rowVer = Number(new URL(request.url).searchParams.get("rowVer"));
    const s = store.get();
    const rec = s.roles.find((r) => r.id === params.id);
    if (!rec) return fail(404, "NOT_FOUND", "That role doesn't exist.");
    if (rec.system) return fail(403, "SYSTEM_ROLE", "System roles can't be deleted.");
    if (rec.rowVer !== rowVer) return conflict(rec.updatedBy, rec.updatedAt);
    const holders = s.users.filter((u) => u.grants.some((g) => g.roleId === rec.id));
    if (holders.length) return fail(409, "IN_USE", `${holders.length} ${holders.length === 1 ? "person has" : "people have"} this role (${holders.slice(0, 3).map((u) => u.name).join(", ")}${holders.length > 3 ? " …" : ""}). Give them another role first.`);
    store.set((st) => ({ ...st, roles: st.roles.filter((r) => r.id !== rec.id) }));
    addAudit(user, "ALL", { area: "Roles", action: "Deleted role", target: rec.name, summary: "No one had this role.", tone: "danger" });
    return ok({ status: "ok" });
  }),

  /* ---------------- Settings */
  http.get("/api/setup/settings", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requireAny(["settings.manage"], ctx.campus);
    if (user instanceof Response) return user;
    return ok(toSettings(store.get(), ctx.campus));
  }),

  http.put("/api/setup/settings", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requireAny(["settings.manage"], ctx.campus);
    if (user instanceof Response) return user;
    const body = (await request.json()) as SetupSettingsInput;
    const s = store.get();
    const scope = ctx.campus;
    const meta = s.settingsMeta[scope] ?? { rowVer: 1, updatedAt: demoNow(), updatedBy: "System" };
    if (scope !== "ALL" && takeConflict(`settings:${scope}`)) {
      const other = otherUser(user);
      const by = other.name;
      const at = demoNow();
      store.set((st) => ({
        ...st,
        settings: { ...st.settings, [scope]: { ...st.settings[scope], "voucher.copies": "2", "voucher.copyLabels": "Bank copy · Parent copy" } },
        settingsMeta: { ...st.settingsMeta, [scope]: { rowVer: meta.rowVer + 1, updatedAt: at, updatedBy: by } },
      }));
      addAudit(other, scope, { area: "Settings", action: "Changed setting", target: campusName(scope), summary: "Vouchers now print two copies.", changes: [{ field: "Copies on each voucher", from: "Three copies", to: "Two copies" }] });
      return conflict(by, at);
    }
    if (body.rowVer !== meta.rowVer) return conflict(meta.updatedBy, meta.updatedAt);
    const before = toSettings(s, scope);
    for (const [key, value] of Object.entries(body.values)) {
      const def = SETTING_DEFS.find((d) => d.key === key);
      if (!def) return vfail(key, "Unknown setting.");
      if (value === null) continue;
      if (def.maxLength && value.length > def.maxLength) return vfail(key, `${def.label}: keep it to ${def.maxLength} characters (now ${value.length}).`);
      if (def.options && !def.options.some((o) => o.value === value)) return vfail(key, `${def.label}: choose one of the options.`);
      if (def.type === "switch" && value !== "true" && value !== "false") return vfail(key, `${def.label}: on or off.`);
      if (key === "sms.senderName" && !/^[A-Za-z0-9 ]{2,11}$/.test(value)) return vfail(key, "Use 2 to 11 letters, numbers or spaces. SMS companies don't allow other characters.");
    }
    const now = demoNow();
    store.set((st) => {
      if (scope === "ALL") {
        const defaults = { ...st.settingDefaults };
        for (const [k, v] of Object.entries(body.values)) {
          if (v === null) delete defaults[k];
          else defaults[k] = v;
        }
        return { ...st, settingDefaults: defaults, settingsMeta: { ...st.settingsMeta, ALL: { rowVer: meta.rowVer + 1, updatedAt: now, updatedBy: user.name } } };
      }
      const own = { ...st.settings[scope] };
      for (const [k, v] of Object.entries(body.values)) {
        if (v === null) delete own[k];
        else own[k] = v;
      }
      return { ...st, settings: { ...st.settings, [scope]: own }, settingsMeta: { ...st.settingsMeta, [scope]: { rowVer: meta.rowVer + 1, updatedAt: now, updatedBy: user.name } } };
    });
    const after = toSettings(store.get(), scope);
    const label = (key: string, v: string) => {
      const def = SETTING_DEFS.find((d) => d.key === key);
      return def?.options?.find((o) => o.value === v)?.label ?? (def?.type === "switch" ? (v === "true" ? "On" : "Off") : v);
    };
    const changes: SetupAuditChange[] = after.items.flatMap((it) => {
      const old = before.items.find((b) => b.key === it.key)!;
      if (old.value === it.value && old.overridden === it.overridden) return [];
      return [{ field: it.label, from: `${label(it.key, old.value) || "—"}${scope !== "ALL" && !old.overridden ? " (default)" : ""}`, to: `${label(it.key, it.value) || "—"}${scope !== "ALL" && !it.overridden ? " (default)" : ""}` }];
    });
    if (changes.length) addAudit(user, scope, { area: "Settings", action: scope === "ALL" ? "Changed defaults" : "Changed settings", target: scope === "ALL" ? "Every campus" : campusName(scope), summary: `${changes.length} setting${changes.length === 1 ? "" : "s"} changed.`, changes });
    return ok(after);
  }),

  /* ---------------- Audit log */
  http.get("/api/setup/audit", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requireAny(SETUP_OR_USERS, ctx.campus);
    if (user instanceof Response) return user;
    const s = store.get();
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const area = url.searchParams.get("area") ?? "";
    const actor = url.searchParams.get("actor") ?? "";
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const pageSize = Math.min(100, Math.max(5, Number(url.searchParams.get("pageSize") ?? 20)));
    const scoped = s.audit.filter((a) => ctx.campus === "ALL" || a.campus === ctx.campus);
    const items = scoped
      .filter((a) => !area || a.area === area)
      .filter((a) => !actor || a.actor === actor)
      .filter((a) => !from || a.at.slice(0, 10) >= from)
      .filter((a) => !to || a.at.slice(0, 10) <= to)
      .filter((a) => !q || `${a.actor} ${a.action} ${a.target} ${a.summary} ${a.changes.map((c) => `${c.field} ${c.from} ${c.to}`).join(" ")}`.toLowerCase().includes(q))
      .sort((a, b) => b.at.localeCompare(a.at));
    return ok({ items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize, actors: [...new Set(scoped.map((a) => a.actor))].sort() });
  }),

  http.get("/api/setup/audit/sign-ins", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requireAny(SETUP_OR_USERS, ctx.campus);
    if (user instanceof Response) return user;
    const scale: Record<CampusScope, number> = { ALL: 1, KC: 0.38, SM: 0.14, UC: 0.16, MC: 0.1, HC: 0.22 };
    const days: SetupSignInDay[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.UTC(2026, 10, 4 - i));
      const iso = d.toISOString().slice(0, 10) as IsoDate;
      const sunday = d.getUTCDay() === 0;
      const base = sunday ? 9 : 168 + ((i * 37) % 23) - (d.getUTCDay() === 6 ? 40 : 0);
      const success = Math.max(1, Math.round(base * scale[ctx.campus]));
      const failed = Math.round((sunday ? 0 : 3 + ((i * 11) % 7)) * Math.max(0.3, scale[ctx.campus])) + (i === 0 && (ctx.campus === "KC" || ctx.campus === "ALL") ? 5 : 0);
      days.push({ date: iso, success, failed });
    }
    return ok(days);
  }),
];

/* ------------------------------------------------------------------ Validation */

function validateUser(s: SetupState, actor: SessionUser, body: SetupUserInput, rec: UserRecord | null): Response | null {
  if (!body.name.trim()) return vfail("name", "Enter the person's full name.");
  const username = body.username.trim().toLowerCase();
  if (!/^[a-z][a-z0-9.]{2,29}$/.test(username)) return vfail("username", "Use 3 to 30 small letters, numbers or dots, starting with a letter, e.g. hina.javed.");
  if (s.users.some((u) => u.id !== rec?.id && u.username === username) || USERS.some((u) => u.username === username && u.id !== rec?.id)) return vfail("username", `${username} is already taken. Try adding a middle initial, e.g. ${username.replace(".", ".a.")}.`);
  if (!isMobile(body.mobile)) return vfail("mobile", "Enter an 11-digit mobile number starting with 03, e.g. 0300-5550101. Sign-in codes go to this number.");
  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) return vfail("email", "Enter a full email address, or leave it empty.");
  // The staff link must be a real staff record, and one person has one account (docs/40).
  const staffNo = (body.staffNo ?? "").trim().toUpperCase();
  if (staffNo && staffNo !== (rec?.staffNo ?? "").toUpperCase()) {
    const staff = hrStaffByNo(staffNo);
    if (!staff) return vfail("staffNo", "No staff member has this number. Choose the person from the staff list, or leave it empty for someone who isn't staff.");
    if (staff.left) return vfail("staffNo", `${staff.name} has left the school, so a new account can't be linked to them.`);
    const other = s.users.find((u) => u.id !== rec?.id && u.status !== "DISABLED" && (u.staffNo ?? "").toUpperCase() === staffNo);
    if (other) return fail(409, "DUPLICATE_ACCOUNT", `${staff.name} already has an account (${other.username}). One account per person: add the role or campus to that account instead.`, { field: "staffNo" });
  }
  if (!body.grants.length) return vfail("grants", "Give at least one role, so the person can open something after signing in.");
  const seen = new Set<string>();
  for (const g of body.grants) {
    const role = s.roles.find((r) => r.id === g.roleId);
    if (!role) return vfail("grants", "Choose a role for every row.");
    const key = `${g.roleId}|${g.campus}`;
    if (seen.has(key)) return vfail("grants", `${role.name} — ${campusName(g.campus)} is listed twice.`);
    seen.add(key);
    if (g.campus === "ALL" && role.scope !== "ANY") return vfail("grants", `${role.name} is given one campus at a time. Choose a campus.`);
    if (!can(actor, "users.manage", g.campus)) {
      const own = actor.roles.map((r) => r.campusName).join(", ");
      return fail(403, "FORBIDDEN", `You can give roles at ${own} only. Ask head office to give access at ${campusName(g.campus)}.`, { field: "grants" });
    }
    if (role.code === "ADMIN" && !can(actor, "setup.manage", "ALL")) return fail(403, "FORBIDDEN", "Only head office can make someone an Admin.", { field: "grants" });
  }
  return null;
}

/* ------------------------------------------------------------------ Shared with other mocks */

/** Sessions for the header switcher (/api/meta/sessions): newest first, with Setup's status. */
export function setupSessions(): SessionInfo[] {
  return store
    .get()
    .sessions.slice()
    .sort((a, b) => b.startYear - a.startYear)
    .map((r) => ({ startYear: r.startYear, label: formatSession(r.startYear), current: r.status === "CURRENT", status: r.status }));
}

/** Credit hours per subject id from Setup → Class subjects (degree courses); University exams weight GPA by them. */
export function setupCreditHours(): Map<string, number> {
  const out = new Map<string, number>();
  for (const cs of store.get().classSubjects) for (const r of cs.subjects) if ((r.creditHours ?? 0) > 0 && !out.has(r.subjectId)) out.set(r.subjectId, r.creditHours!);
  return out;
}

/** A campus's office phone and email as Setup holds them now, for letterheads on prints ("" when not recorded). */
export function setupCampusContact(code: CampusCode): { phone: string; email: string } {
  const c = store.get().campuses.find((x) => x.code === code);
  return { phone: c?.phone ?? "", email: c?.email ?? "" };
}

/* ------------------------------------------------------------------ Sign-in (the auth mock reads Setup's accounts) */

const MAX_WRONG_PASSWORDS = 5;
const SIGN_IN_DEVICE = "Chrome on Windows";

/** The account for a username. Sign-in reads Setup's users, so locks, disabling and resets made there apply. */
export function setupAccountByUsername(username: string): UserRecord | undefined {
  const name = username.trim().toLowerCase();
  return store.get().users.find((u) => u.username === name);
}

export function setupAccountById(id: string): UserRecord | undefined {
  return store.get().users.find((u) => u.id === id);
}

/** Grants with permissions from Setup's roles, so matrix edits and custom roles apply from the next page. */
function grantsOf(s: SetupState, u: UserRecord): RoleGrant[] {
  return u.grants.flatMap((g) => {
    const r = s.roles.find((x) => x.id === g.roleId);
    return r ? [{ role: r.code, roleName: r.name, campus: g.campus, campusName: campusName(g.campus), permissions: [...r.permissions] }] : [];
  });
}

/** The signed-in user built from Setup: null when the account is locked or disabled (signed out), undefined when Setup doesn't know it. */
export function setupSessionUser(id: string): SessionUser | null | undefined {
  const s = store.get();
  const u = s.users.find((x) => x.id === id);
  if (!u) return undefined;
  if (u.status === "LOCKED" || u.status === "DISABLED") return null;
  return { id: u.id, username: u.username, name: u.name, roles: grantsOf(s, u) };
}

/** Records a sign-in attempt in the account's history and the audit log. Five wrong passwords in a row lock the account. */
export function setupRecordSignIn(id: string, outcome: "SUCCESS" | "WRONG_PASSWORD" | "WRONG_CODE"): { locked: boolean; attemptsLeft: number } {
  const s = store.get();
  const u = s.users.find((x) => x.id === id);
  if (!u) return { locked: false, attemptsLeft: MAX_WRONG_PASSWORDS };
  const at = demoNow();
  const campus: CampusScope = u.grants[0]?.campus ?? "KC";
  const place = campus === "ALL" ? "Head office" : `${campusName(campus)} office`;
  const entry = (o: SetupSignIn["outcome"]): SetupSignIn => ({ at, outcome: o, device: SIGN_IN_DEVICE, place });
  const actor: SessionUser = { id: u.id, username: u.username, name: u.name, roles: grantsOf(s, u) };
  // Sign-in details don't change rowVer: they aren't edited in the account panel, so they never cause a 409.
  let next: UserRecord = u;
  let locked = false;
  if (outcome === "SUCCESS") {
    next = { ...u, failedAttempts: 0, lastSignInAt: at, lastSignInDevice: `${SIGN_IN_DEVICE} · ${place}`, status: u.status === "INVITED" ? "ACTIVE" : u.status, signIns: [entry("SUCCESS"), ...u.signIns].slice(0, 12) };
  } else if (outcome === "WRONG_CODE") {
    next = { ...u, signIns: [entry("WRONG_CODE"), ...u.signIns].slice(0, 12) };
    addAudit(actor, campus, { area: "Sign-in", action: "Wrong two-step code", target: u.name, summary: "The password was right but the code from their phone was not.", tone: "warning" });
  } else {
    const failed = u.failedAttempts + 1;
    locked = failed >= MAX_WRONG_PASSWORDS;
    next = {
      ...u,
      failedAttempts: failed,
      ...(locked ? { status: "LOCKED" as const, lockedAt: at } : {}),
      signIns: [...(locked ? [entry("LOCKED")] : []), entry("WRONG_PASSWORD"), ...u.signIns].slice(0, 12),
    };
    addAudit(actor, campus, { area: "Sign-in", action: "Wrong password", target: u.name, summary: `Wrong password ${failed} of ${MAX_WRONG_PASSWORDS}.`, tone: "warning" });
    if (locked) addAudit(actor, campus, { area: "Sign-in", action: "Account locked", target: u.name, summary: `Locked after ${MAX_WRONG_PASSWORDS} wrong passwords. Unlock it from Users once you have spoken to them.`, changes: [{ field: "Status", from: "Active", to: "Locked" }], tone: "danger" });
  }
  const saved = next;
  store.set((st) => ({ ...st, users: st.users.map((x) => (x.id === saved.id ? saved : x)) }));
  return { locked, attemptsLeft: Math.max(0, MAX_WRONG_PASSWORDS - saved.failedAttempts) };
}

/** After the person chooses their own password at sign-in: no more forced change, and an invited account becomes active. */
export function setupPasswordChosen(id: string) {
  const at = demoNow();
  store.set((st) => ({ ...st, users: st.users.map((u) => (u.id === id ? { ...u, mustChangePassword: false, passwordChangedAt: at, status: u.status === "INVITED" ? "ACTIVE" : u.status } : u)) }));
}

registerAccountSource(setupSessionUser);
