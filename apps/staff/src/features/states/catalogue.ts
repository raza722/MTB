// Every state on the States page (brief §8, plus the few the screens added), where it appears in the real app
// and how to reach it. One list feeds the table of contents, the specimens and the index at the bottom.
import type { IconName } from "@mtb/ui";

export type GroupId = "empty" | "loading" | "validation" | "toasts" | "confirm" | "denied" | "network" | "offline" | "context" | "dark";

export interface StateGroup {
  id: GroupId;
  title: string;
  icon: IconName;
  intro: string;
}

export const GROUPS: StateGroup[] = [
  { id: "empty", title: "Empty states", icon: "inbox", intro: "Say what would appear here and offer the one action that fills it. A list is never just blank." },
  { id: "loading", title: "Loading skeletons", icon: "refresh", intro: "Grey shapes where the content will appear, so nothing jumps when it arrives. Never a spinner over a whole page." },
  { id: "validation", title: "Validation errors", icon: "alertCircle", intro: "Checked as you type and explained next to the field in plain words. The button that would save a mistake stays off until it is fixed." },
  { id: "toasts", title: "Success toasts", icon: "checkCircle", intro: "A short note in the corner that carries the record number. It never blocks the next action and goes away on its own." },
  { id: "confirm", title: "Confirmations", icon: "shield", intro: "Anything that can't be undone restates the figures first. The most serious actions also ask you to type a word." },
  { id: "denied", title: "Permission denied", icon: "lock", intro: "Menus hide what a role can't use. Opening such a page from a link says who you are signed in as and who can grant access." },
  { id: "network", title: "Network errors", icon: "wifiOff", intro: "Say what happened, whether anything was saved, and what to do next." },
  { id: "offline", title: "Offline and syncing", icon: "cloudOff", intro: "The teacher app keeps working without a signal and always says where the teacher's work is." },
  { id: "context", title: "Read-only and campus", icon: "building", intro: "Every page says which campus and session it shows. Past sessions can be viewed and printed but not changed." },
  { id: "dark", title: "Dark mode", icon: "moon", intro: "Every colour has a light and a dark value, and each text colour is checked for contrast in both. Drag the divider to compare." },
];

/** A screen in the staff app (same tab, keeps the demo data) or in the teacher app (new tab). */
export type LiveLink =
  | { app: "staff"; to: string; search?: Record<string, string | number>; signInAs?: string; hint?: string }
  | { app: "teacher"; path: string; signInAs?: string; hint?: string };

export interface StateEntry {
  id: string;
  group: GroupId;
  title: string;
  /** One line: where it appears in the app. */
  where: string;
  live: LiveLink;
  /** "brief" = listed in §8 of the design brief; "added" = a state the screens needed beyond that list. */
  source: "brief" | "added";
}

/** The teacher app's dev server (brief: http://localhost:5174). Override with VITE_TEACHER_APP_URL when hosted. */
export const TEACHER_APP_URL = ((import.meta.env.VITE_TEACHER_APP_URL as string | undefined) ?? "http://localhost:5174").replace(/\/$/, "");

const COUNTER = (gr: string, signInAs = "usman.ali", hint?: string): LiveLink => ({ app: "staff", to: "/fees/counter", search: { gr }, signInAs, ...(hint ? { hint } : {}) });

export const STATES: StateEntry[] = [
  // Empty
  { id: "all-dues-cleared", group: "empty", source: "brief", title: "All dues cleared", where: "Fee counter, when the student has nothing to pay (Hamza Khan, KC-15102).", live: COUNTER("KC-15102") },
  { id: "no-duplicates", group: "empty", source: "brief", title: "No possible duplicates to review", where: "Admissions → Possible duplicates, once every suggested pair has been decided.", live: { app: "staff", to: "/admissions/duplicates", signInAs: "sadia.rehman", hint: "Decide the Muhammad Bilal pair first" } },
  { id: "no-opt-outs", group: "empty", source: "brief", title: "No SMS opt-outs", where: "SMS → Opt-outs, when every guardian at the campus gets notices.", live: { app: "staff", to: "/sms/opt-outs", signInAs: "kamran.yousaf", hint: "Remove the listed opt-outs to see it" } },
  { id: "holiday", group: "empty", source: "added", title: "No attendance today (holiday)", where: "Teacher app register on a public holiday.", live: { app: "teacher", path: "/registers/7-B", signInAs: "hina.javed", hint: "More → Demo → Today is a holiday" } },

  // Loading
  { id: "dashboard-loading", group: "loading", source: "brief", title: "Dashboard cards", where: "Dashboard, while today's figures load.", live: { app: "staff", to: "/dashboard", signInAs: "sadia.rehman" } },
  { id: "profile-loading", group: "loading", source: "brief", title: "Student profile tabs", where: "Student profile, while the record and each tab load.", live: { app: "staff", to: "/students/KC-14823", signInAs: "sadia.rehman" } },

  // Validation
  { id: "mfa-wrong", group: "validation", source: "brief", title: "Wrong two-step code", where: "Sign in → two-step verification, for admin and finance roles.", live: { app: "staff", to: "/login", signInAs: "usman.ali", hint: "Type any wrong code" } },
  { id: "jv-balance", group: "validation", source: "brief", title: "Journal voucher out of balance", where: "Accounts → Vouchers → the draft for October's utility bills.", live: { app: "staff", to: "/accounts/vouchers/jv-draft-1", signInAs: "nadia.shah" } },
  { id: "marks-max", group: "validation", source: "brief", title: "Marks above the maximum", where: "Teacher app marks entry; the exam office's marks grid shows the same message.", live: { app: "teacher", path: "/marks", signInAs: "hina.javed" } },
  { id: "cheque-missing", group: "validation", source: "brief", title: "Missing cheque number", where: "Fee counter → payment method Cheque.", live: COUNTER("KC-14823") },

  // Toasts
  { id: "toast-receipt", group: "toasts", source: "brief", title: "Receipt posted", where: "Fee counter, straight after Post receipt.", live: COUNTER("KC-14823") },
  { id: "toast-attendance", group: "toasts", source: "brief", title: "Attendance submitted", where: "Teacher app, after submitting a register.", live: { app: "teacher", path: "/registers/7-B", signInAs: "hina.javed" } },
  { id: "toast-results", group: "toasts", source: "brief", title: "Results declared", where: "Exams → an exam → Declare results.", live: { app: "staff", to: "/exams/ex-ft-2627-c8", signInAs: "sadia.rehman" } },

  // Confirmations
  { id: "confirm-post", group: "confirm", source: "brief", title: "Post receipt (the review step)", where: "Fee counter → Review. The review is the confirmation; there is no second “Are you sure?”.", live: COUNTER("KC-14823") },
  { id: "confirm-declare", group: "confirm", source: "brief", title: "Declare results (type DECLARE)", where: "Exams → First Term · Class 8 → Declare results.", live: { app: "staff", to: "/exams/ex-ft-2627-c8", signInAs: "sadia.rehman" } },
  { id: "confirm-pause", group: "confirm", source: "brief", title: "Pause all SMS (type PAUSE)", where: "SMS → danger zone, admin only. The banner then shows on every staff page.", live: { app: "staff", to: "/sms", signInAs: "kamran.yousaf" } },
  { id: "confirm-merge", group: "confirm", source: "brief", title: "Merge records", where: "Admissions → Possible duplicates → Review merge.", live: { app: "staff", to: "/admissions/duplicates", signInAs: "sadia.rehman" } },

  // Permission denied
  { id: "denied-teacher", group: "denied", source: "brief", title: "A teacher opens Accounts", where: "Any page outside the role, opened from a link or a bookmark.", live: { app: "staff", to: "/accounts", signInAs: "hina.javed" } },
  { id: "denied-cashier", group: "denied", source: "brief", title: "A cashier opens Exams", where: "Any page outside the role, opened from a link or a bookmark.", live: { app: "staff", to: "/exams", signInAs: "usman.ali" } },

  // Network
  { id: "network-receipt", group: "network", source: "brief", title: "Receipt not posted — safe to try again", where: "Fee counter, when the connection drops while posting.", live: COUNTER("KC-14823", "usman.ali", "Demo button → Make the next receipt post fail") },
  { id: "network-load", group: "network", source: "added", title: "A page couldn't load", where: "Every page, when its figures don't arrive.", live: { app: "staff", to: "/dashboard", signInAs: "sadia.rehman" } },
  { id: "network-conflict", group: "network", source: "added", title: "Someone else saved first", where: "Records two people can edit at once, such as Fees → Fee structure.", live: { app: "staff", to: "/fees/structure", signInAs: "nadia.shah" } },

  // Offline
  { id: "offline-sync", group: "offline", source: "brief", title: "Online, offline, syncing, synced, sync failed", where: "Teacher app: the sync pill at the top of every screen, and a register submitted with no signal.", live: { app: "teacher", path: "/today", signInAs: "hina.javed", hint: "Tap the sync pill → Demo: this phone has no signal" } },

  // Context
  { id: "readonly", group: "context", source: "brief", title: "Read-only past session", where: "Every staff page while 2025–26 is chosen in the top bar.", live: { app: "staff", to: "/fees/counter", search: { gr: "KC-14823", session: 2025 }, signInAs: "usman.ali" } },
  { id: "choose-campus", group: "context", source: "added", title: "Choose a campus first", where: "Campus-only work (fee counter, class registers, corrections) while All campuses is selected.", live: { app: "staff", to: "/attendance", signInAs: "kamran.yousaf" } },
  { id: "left-student", group: "context", source: "added", title: "Student has left", where: "Fee counter, for a student who has left with dues outstanding (Hassan Iqbal, KC-14502).", live: COUNTER("KC-14502") },

  // Dark mode
  { id: "dark-dashboard", group: "dark", source: "brief", title: "Dashboard", where: "Dashboard. Dark mode is in the user menu and is remembered on this computer.", live: { app: "staff", to: "/dashboard", signInAs: "sadia.rehman" } },
  { id: "dark-counter", group: "dark", source: "brief", title: "Fee counter", where: "Fees → Fee counter with Ayesha Khan loaded.", live: COUNTER("KC-14823") },
  { id: "dark-profile", group: "dark", source: "brief", title: "Student profile", where: "Students → Ayesha Khan → Attendance tab.", live: { app: "staff", to: "/students/KC-14823", search: { tab: "attendance" }, signInAs: "sadia.rehman" } },
];

export function stateById(id: string): StateEntry {
  const s = STATES.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown state ${id}`);
  return s;
}

export function statesIn(group: GroupId): StateEntry[] {
  return STATES.filter((s) => s.group === group);
}

/** Who to sign in as, in words: "usman.ali" → "Usman Ali (cashier)". Usernames only; the demo password lives in the mocks. */
export const ACCOUNT_LABEL: Record<string, string> = {
  "usman.ali": "Usman Ali, cashier",
  "sadia.rehman": "Mrs Sadia Rehman, principal",
  "nadia.shah": "Nadia Shah, accountant",
  "kamran.yousaf": "Kamran Yousaf, admin",
  "hina.javed": "Ms Hina Javed, teacher",
  "farah.naz": "Farah Naz, office",
};

/**
 * The sidebar each role sees (mirrors the role grants in the demo fixtures). Shown beside the permission-denied
 * specimens: the page is missing from the menu, and only a link or bookmark reaches it.
 */
export const ROLE_MENUS: Record<"teacher" | "cashier", Array<{ label: string; icon: IconName }>> = {
  teacher: [
    { label: "Dashboard", icon: "dashboard" },
    { label: "Students", icon: "students" },
    { label: "Attendance", icon: "attendance" },
    { label: "Timetable", icon: "calendar" },
    { label: "Settings", icon: "settings" },
  ],
  cashier: [
    { label: "Dashboard", icon: "dashboard" },
    { label: "Students", icon: "students" },
    { label: "Fees", icon: "fees" },
    { label: "Reports", icon: "file" },
    { label: "Settings", icon: "settings" },
  ],
};
