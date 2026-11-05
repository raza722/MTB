import { authApi, can, CURRENT_SESSION, dashboardQueries, metaQueries, smsStatusApi, smsStatusQueries, type CampusScope, type Permission, type SessionInfo } from "@mtb/api";
import { formatSession, formatTime } from "@mtb/domain";
import { Avatar, Banner, Button, cx, Icon, IconButton, Menu, MenuItem, MenuLabel, MenuSeparator, Tooltip, useToast, type IconName } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { lazy, Suspense, useState, type ReactNode } from "react";
import { useAppearance } from "../appearance";
import { campusesFor, useCan, useCtx, useReadOnly, useRoleLabel, useSessionStatus, useSessionUser, useSetCtx, type SessionStatus } from "../session";
import { campusLabel } from "./campus";
import { GlobalSearch, SearchTrigger } from "./GlobalSearch";

// Presenter's panel: only loaded in mock mode, so it never ships with the real app.
const DemoControls = lazy(() => import("./DemoControls"));

interface NavItem {
  to:
    | "/dashboard"
    | "/students"
    | "/admissions"
    | "/attendance"
    | "/timetable"
    | "/exams"
    | "/activities"
    | "/fees"
    | "/accounts"
    | "/hr"
    | "/library"
    | "/warehouse"
    | "/transport"
    | "/sms"
    | "/reports"
    | "/setup"
    | "/settings";
  match: string;
  label: string;
  icon: IconName;
  /** Shown when the user has this permission (or any one of these). */
  permission?: Permission | Permission[];
}

/** Active for the item's own path and every sub-page under it (/students/KC-14823, /fees/reports/arrears …). */
const isActive = (path: string, match: string) => path === match || path.startsWith(`${match}/`);

/** Sidebar order from the brief. Items a role can't use are hidden. */
const NAV: NavItem[] = [
  { to: "/dashboard", match: "/dashboard", label: "Dashboard", icon: "dashboard", permission: "dashboard.view" },
  { to: "/students", match: "/students", label: "Students", icon: "students", permission: "students.view" },
  { to: "/admissions", match: "/admissions", label: "Admissions", icon: "admissions", permission: "admissions.view" },
  { to: "/attendance", match: "/attendance", label: "Attendance", icon: "attendance", permission: "attendance.view" },
  { to: "/timetable", match: "/timetable", label: "Timetable", icon: "calendar", permission: "timetable.view" },
  { to: "/exams", match: "/exams", label: "Exams", icon: "exams", permission: "exams.view" },
  { to: "/activities", match: "/activities", label: "Activities", icon: "award", permission: "activities.view" },
  // /fees sends cashiers to the counter and everyone else (principal, accountant, admin) to the fee reports.
  { to: "/fees", match: "/fees", label: "Fees", icon: "fees", permission: "fees.view" },
  { to: "/accounts", match: "/accounts", label: "Accounts", icon: "accounts", permission: "accounts.view" },
  { to: "/hr", match: "/hr", label: "Staff & payroll", icon: "hr", permission: "hr.view" },
  { to: "/library", match: "/library", label: "Library", icon: "book", permission: "library.view" },
  { to: "/warehouse", match: "/warehouse", label: "Warehouse", icon: "warehouse", permission: "warehouse.view" },
  { to: "/transport", match: "/transport", label: "Transport", icon: "mapPin", permission: "transport.view" },
  { to: "/sms", match: "/sms", label: "SMS", icon: "sms", permission: "sms.view" },
  { to: "/reports", match: "/reports", label: "Reports", icon: "file", permission: "reports.view" },
  { to: "/setup", match: "/setup", label: "Setup", icon: "layers", permission: ["setup.manage", "setup.campus", "users.manage"] },
  { to: "/settings", match: "/settings", label: "Settings", icon: "settings" },
];

function readCollapsed(): boolean {
  try {
    return localStorage.getItem("mtb.sidebar") === "collapsed";
  } catch {
    return false;
  }
}

function NavLink({ item, collapsed, active }: { item: NavItem; collapsed: boolean; active: boolean }) {
  const link = (
    <Link
      to={item.to}
      aria-current={active ? "page" : undefined}
      className={cx(
        "mtb-nav-link relative z-[1] flex h-10 items-center gap-3 rounded-md px-3 font-medium no-underline",
        active ? "text-brand-ink" : "text-ink-muted hover:bg-surface-hover hover:text-ink",
        collapsed && "justify-center px-0",
      )}
    >
      <Icon name={item.icon} size={20} className="mtb-nav-icon" />
      {!collapsed && <span>{item.label}</span>}
      {collapsed && <span className="mtb-sr-only">{item.label}</span>}
    </Link>
  );
  return collapsed ? (
    <Tooltip content={item.label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const user = useSessionUser();
  const { campus } = useCtx();
  const items = NAV.filter((n) => !n.permission || (Array.isArray(n.permission) ? n.permission : [n.permission]).some((p) => can(user, p, campus)));
  // The active highlight is one element that slides to the current item (40px rows, 4px apart).
  const activeIndex = items.findIndex((n) => isActive(path, n.match));
  return (
    <aside className={cx("sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-surface-raised md:flex", collapsed ? "w-16" : "w-60")} aria-label="Main">
      <div className={cx("flex h-12 items-center border-b border-border", collapsed ? "justify-center" : "justify-between px-4")}>
        {!collapsed && <span className="text-title-1">MTB</span>}
        <IconButton icon={collapsed ? "chevronRight" : "chevronLeft"} label={collapsed ? "Expand sidebar" : "Collapse sidebar"} size="sm" onClick={onToggle} />
      </div>
      <nav className="relative grid flex-1 content-start gap-1 overflow-y-auto p-2">
        {activeIndex >= 0 && <span className="mtb-nav-indicator" style={{ transform: `translateY(${activeIndex * 44}px)` }} aria-hidden="true" />}
        {items.map((item) => (
          <NavLink key={item.to} item={item} collapsed={collapsed} active={isActive(path, item.match)} />
        ))}
      </nav>
    </aside>
  );
}

function CampusSwitcher() {
  const user = useSessionUser();
  const { campus } = useCtx();
  const setCtx = useSetCtx();
  const options = campusesFor(user);
  const pill = (
    <span className="inline-flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-brand-tint px-3 font-medium text-brand-ink">
      <Icon name="building" size={16} />
      {campusLabel(campus)}
      {options.length > 1 && <Icon name="chevronDown" size={16} />}
    </span>
  );
  if (options.length <= 1) return pill;
  return (
    <Menu
      label="Campus"
      trigger={
        <button type="button" className="rounded-full" aria-label={`Campus: ${campusLabel(campus)}. Change campus`}>
          {pill}
        </button>
      }
    >
      <MenuLabel>Campus</MenuLabel>
      {options.map((c: CampusScope) => (
        <MenuItem key={c} checked={c === campus} onSelect={() => setCtx({ campus: c })}>
          {campusLabel(c)}
        </MenuItem>
      ))}
    </Menu>
  );
}

const SESSION_STATUS_TEXT: Record<SessionStatus, string> = { CURRENT: "current", PLANNED: "planned", ENDED: "ended, read-only", CLOSED: "closed" };

/** Sessions from Setup → Sessions: planned and current first, then ended; closed years under "Older sessions". */
function SessionSwitcher() {
  const { session } = useCtx();
  const setCtx = useSetCtx();
  const status = useSessionStatus();
  const q = useQuery(metaQueries.sessions());
  const fallback: SessionInfo[] = [
    { startYear: CURRENT_SESSION, label: formatSession(CURRENT_SESSION), current: true, status: "CURRENT" },
    { startYear: CURRENT_SESSION - 1, label: formatSession(CURRENT_SESSION - 1), current: false, status: "ENDED" },
  ];
  const list = q.data ?? fallback;
  const recent = list.filter((s) => s.status !== "CLOSED");
  const older = list.filter((s) => s.status === "CLOSED");
  const item = (s: SessionInfo) => (
    <MenuItem key={s.startYear} checked={s.startYear === session} onSelect={() => setCtx({ session: s.startYear })}>
      {s.label} <span className="text-ink-muted">({SESSION_STATUS_TEXT[s.status]})</span>
    </MenuItem>
  );
  return (
    <Menu
      label="Session"
      trigger={
        <Button variant="ghost" size="sm" iconRight="chevronDown" className="shrink-0" aria-label={`Session ${formatSession(session)}, ${SESSION_STATUS_TEXT[status]}. Change session`}>
          <span className="mtb-num">Session {formatSession(session)}</span>
          {status !== "CURRENT" && <span className="hidden text-small font-normal text-ink-muted sm:inline">· {SESSION_STATUS_TEXT[status]}</span>}
        </Button>
      }
    >
      <MenuLabel>Academic session</MenuLabel>
      {recent.map(item)}
      {older.length > 0 && (
        <>
          <MenuSeparator />
          <MenuLabel>Older sessions</MenuLabel>
          {older.map(item)}
        </>
      )}
    </Menu>
  );
}

function Notifications() {
  const ctx = useCtx();
  const canApprove = useCan("approvals.decide");
  const approvals = useQuery({ ...dashboardQueries.approvals(ctx), enabled: canApprove });
  const summary = useQuery(dashboardQueries.summary(ctx));
  const count = (approvals.data?.length ?? 0) + (summary.data?.sms.failed ? 1 : 0);
  return (
    <Menu
      label="Notifications"
      align="end"
      trigger={
        <span className="relative inline-flex">
          <IconButton icon="bell" label={`Notifications${count ? `, ${count} new` : ""}`} />
          {count > 0 && (
            <span className="pointer-events-none absolute right-1 top-1 grid h-4 min-w-4 place-content-center rounded-full bg-danger px-1 text-[11px] font-semibold leading-none text-on-danger" aria-hidden="true">
              {count}
            </span>
          )}
        </span>
      }
    >
      <MenuLabel>Notifications</MenuLabel>
      {canApprove && approvals.data && approvals.data.length > 0 && (
        <MenuItem icon="checkSquare" onSelect={() => document.getElementById("approvals")?.scrollIntoView({ behavior: "smooth" })}>
          {approvals.data.length} approvals waiting for you
        </MenuItem>
      )}
      {summary.data && summary.data.sms.failed > 0 && <MenuItem icon="alertCircle">{summary.data.sms.failed} SMS failed today</MenuItem>}
      {count === 0 && <MenuItem icon="checkCircle">You're all caught up</MenuItem>}
    </Menu>
  );
}

function UserMenu() {
  const user = useSessionUser();
  const role = useRoleLabel();
  const { theme, setTheme } = useAppearance();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const signOut = useMutation({
    mutationFn: authApi.logout,
    onSettled: async () => {
      queryClient.clear();
      await navigate({ to: "/login" });
    },
  });
  if (!user) return null;
  return (
    <Menu
      label="Account"
      align="end"
      trigger={
        <button type="button" className="flex shrink-0 items-center gap-2 rounded-md px-2 py-1 hover:bg-surface-hover" aria-label={`${user.name}, ${role}. Account menu`}>
          <Avatar name={user.name.replace(/^(Mrs|Mr|Ms)\s+/, "")} size="sm" />
          <span className="hidden whitespace-nowrap text-left leading-tight xl:grid">
            <span className="font-medium text-ink">{user.name}</span>
            <span className="text-small text-ink-muted">{role}</span>
          </span>
          <Icon name="chevronDown" size={16} className="text-ink-muted" />
        </button>
      }
    >
      <MenuLabel>{role}</MenuLabel>
      <MenuItem icon={theme === "dark" ? "sun" : "moon"} onSelect={() => setTheme(theme === "dark" ? "light" : "dark")}>
        {theme === "dark" ? "Light mode" : "Dark mode"}
      </MenuItem>
      <MenuItem icon="layers" onSelect={() => navigate({ to: "/design-system" })}>
        Design system
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon="logout" onSelect={() => signOut.mutate()}>
        Sign out
      </MenuItem>
    </Menu>
  );
}

/** "All SMS paused by Admin at 10:41 AM · Resume" on every staff page while the kill switch is on. */
function SmsPausedBanner() {
  const status = useQuery(smsStatusQueries.status());
  const canResume = useCan("sms.pause");
  const queryClient = useQueryClient();
  const toast = useToast();
  const resume = useMutation({
    mutationFn: smsStatusApi.resume,
    onSuccess: (data) => {
      queryClient.setQueryData(smsStatusQueries.status().queryKey, data);
      toast({ title: "SMS resumed", message: "Queued messages will start sending." });
    },
  });
  const s = status.data;
  if (!s?.paused) return null;
  return (
    <Banner
      tone="danger"
      title={`All SMS paused by ${s.pausedBy ?? "Admin"}${s.pausedAt ? ` at ${formatTime(s.pausedAt)}` : ""}.`}
      actions={
        canResume ? (
          <Button size="sm" variant="secondary" loading={resume.isPending} onClick={() => resume.mutate()}>
            Resume
          </Button>
        ) : undefined
      }
    >
      {s.reason ? `Reason: ${s.reason}. ` : ""}No messages will be sent until SMS is resumed.
    </Banner>
  );
}

function ReadOnlyBanner() {
  const readOnly = useReadOnly();
  const status = useSessionStatus();
  const { session } = useCtx();
  const setCtx = useSetCtx();
  if (status === "CURRENT") return null;
  const back = (
    <Button size="sm" variant="secondary" onClick={() => setCtx({ session: CURRENT_SESSION })}>
      Switch to {formatSession(CURRENT_SESSION)}
    </Button>
  );
  if (status === "PLANNED") {
    return (
      <Banner tone="info" title={readOnly ? `Viewing ${formatSession(session)} — planned.` : `Preparing ${formatSession(session)} — planned.`} actions={back}>
        {readOnly
          ? "Daily work opens when it becomes the current session. Its sections and teachers can be prepared in Setup → Classes and Teacher allotment."
          : "Sections, seats, rooms and teachers set up here are ready when the session becomes current."}
      </Banner>
    );
  }
  return (
    <Banner tone="info" title={status === "CLOSED" ? `Viewing ${formatSession(session)} — closed and locked.` : `Viewing ${formatSession(session)} — read-only.`} actions={back}>
      Past sessions can be viewed and printed but not changed.
    </Banner>
  );
}

export function AppShell({ children }: { children?: ReactNode }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [searchOpen, setSearchOpen] = useState(false);
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("mtb.sidebar", c ? "open" : "collapsed");
      } catch {
        /* storage blocked */
      }
      return !c;
    });
  };
  return (
    <div className="flex min-h-screen bg-surface">
      <a href="#main" className="mtb-sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface-raised focus:p-2">
        Skip to content
      </a>
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="mtb-topbar sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-border px-4 shadow-sm">
          <CampusSwitcher />
          <SessionSwitcher />
          <div className="mx-auto w-full min-w-0 max-w-md">
            <SearchTrigger onOpen={() => setSearchOpen(true)} />
          </div>
          <Notifications />
          <UserMenu />
        </header>
        <main id="main" tabIndex={-1} className="mtb-page grid min-w-0 flex-1 content-start gap-4 p-6 outline-none">
          <SmsPausedBanner />
          <ReadOnlyBanner />
          {children ?? <Outlet />}
        </main>
      </div>
      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
      {import.meta.env.VITE_USE_MOCKS !== "false" && (
        <Suspense fallback={null}>
          <DemoControls />
        </Suspense>
      )}
    </div>
  );
}
