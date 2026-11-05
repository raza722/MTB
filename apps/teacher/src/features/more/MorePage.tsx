import { authApi, roleLabel, teacherQueries, type CampusCode } from "@mtb/api";
import { formatTime } from "@mtb/domain";
import { Avatar, Button, ConfirmDialog, Icon, Panel, Segmented, Select, cx, type IconName } from "@mtb/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useState, type CSSProperties } from "react";
import { setMotion, setTheme, useAppearance, type MotionChoice, type ThemeChoice } from "../../app/appearance";
import { clearPersisted } from "../../app/persist";
import { isStandalone, useInstallPrompt } from "../../app/pwa";
import { teacherCampuses, useCtx, useSessionUser, useSetCampus } from "../../app/session";
import { Screen } from "../../app/shell/Screen";
import { useOnline } from "../../app/sync/network";
import { clearOutbox, retrySync, useSync } from "../../app/sync/outbox";
import { MyAttendanceCard } from "./MyAttendanceCard";

const DemoPanel = lazy(() => import("./DemoPanel"));

export function MorePage() {
  const user = useSessionUser();
  const ctx = useCtx();
  const setCampus = useSetCampus();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const today = useQuery(teacherQueries.today(ctx)).data;
  const appearance = useAppearance();
  const install = useInstallPrompt();
  const sync = useSync();
  const online = useOnline();
  const [confirmOut, setConfirmOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const campuses = teacherCampuses(user);
  const unread = today?.unread ?? 0;

  const signOut = async () => {
    setSigningOut(true);
    try {
      await authApi.logout();
    } catch {
      /* offline: the phone forgets the session anyway */
    }
    await clearOutbox();
    await clearPersisted();
    queryClient.clear();
    setSigningOut(false);
    await navigate({ to: "/login" });
  };

  const links: Array<{ to: "/more/classes" | "/more/notifications" | "/more/leave"; icon: IconName; label: string; hint: string; badge?: number }> = [
    { to: "/more/classes", icon: "students", label: "My classes and students", hint: "Class lists, parents' numbers, attendance" },
    { to: "/more/notifications", icon: "bell", label: "Notifications", hint: unread ? `${unread} unread` : "All read", badge: unread },
    { to: "/more/leave", icon: "calendar", label: "My leave", hint: "Ask for leave, see what's left" },
  ];

  return (
    <Screen title="More" documentTitle="More">
      <div className="grid gap-5">
        <div className="mtb-card mtb-rise flex items-center gap-3 p-4">
          <Avatar name={user?.name ?? "?"} size="lg" />
          <div className="min-w-0">
            <p className="m-0 truncate text-title-2 text-ink">{user?.name}</p>
            <p className="m-0 truncate text-small text-ink-muted">{roleLabel(user, ctx.campus)}</p>
            <p className="m-0 truncate text-small text-ink-muted">
              Signed in as <span className="mtb-mono">{user?.username}</span>
            </p>
          </div>
        </div>

        <nav aria-label="More" className="mtb-card mtb-rise overflow-hidden" style={{ "--i": 1 } as CSSProperties}>
          <ul className="m-0 list-none p-0">
            {links.map((l) => (
              <li key={l.to} className="border-t border-border first:border-t-0">
                <Link to={l.to} className="flex min-h-16 items-center gap-3 px-4 py-2 text-inherit no-underline hover:bg-surface-hover">
                  <span className="grid size-10 shrink-0 place-items-center rounded-md bg-brand-tint text-brand-ink">
                    <Icon name={l.icon} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-ink">{l.label}</span>
                    <span className="block truncate text-small text-ink-muted">{l.hint}</span>
                  </span>
                  {l.badge ? (
                    <span className="grid h-6 min-w-6 place-items-center rounded-full bg-danger px-1.5 text-caption text-on-danger tabular-nums" aria-hidden="true">
                      {l.badge}
                    </span>
                  ) : null}
                  <Icon name="chevronRight" size={18} className="text-ink-muted" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <MyAttendanceCard rise={2} />

        {campuses.length > 1 && (
          <Panel id="campus" title="Campus" description="You teach at more than one campus. Registers and marks follow the campus chosen here." rise={2}>
            <Select
              aria-label="Campus"
              value={ctx.campus}
              onChange={(e) => {
                setCampus(e.target.value as CampusCode);
              }}
              options={campuses.map((c) => ({ value: c, label: user?.roles.find((r) => r.campus === c)?.campusName ?? c }))}
            />
          </Panel>
        )}

        <Panel id="appearance" title="Appearance" description="Saved on this phone." rise={3}>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <span className="mtb-label" id="theme-label">
                Theme
              </span>
              <Segmented
                touch
                aria-label="Theme"
                className="w-full [&>button]:flex-1"
                value={appearance.theme}
                onChange={(v) => setTheme(v as ThemeChoice)}
                options={[
                  { value: "system", label: "Phone setting" },
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                ]}
              />
            </div>
            <div className="grid gap-1.5">
              <span className="mtb-label">Motion</span>
              <Segmented
                touch
                aria-label="Motion"
                className="w-full [&>button]:flex-1"
                value={appearance.motion}
                onChange={(v) => setMotion(v as MotionChoice)}
                options={[
                  { value: "system", label: "Phone setting" },
                  { value: "reduce", label: "Reduce motion" },
                ]}
              />
            </div>
          </div>
        </Panel>

        <Panel id="phone" title="This phone" description="Registers and marks are saved here first, then sent to the school." rise={4}>
          <div className="grid gap-3">
            <p className={cx("m-0 flex items-center gap-2", sync.items.length ? "text-warning-ink" : "text-ink-muted")}>
              <Icon name={sync.items.length ? "cloudOff" : "checkCircle"} size={18} />
              {sync.items.length
                ? `${sync.items.length} ${sync.items.length === 1 ? "item is" : "items are"} waiting to send.`
                : sync.lastSyncedAt
                  ? `Everything is sent. Last sync ${formatTime(new Date(sync.lastSyncedAt))}.`
                  : "Nothing waiting to send."}
            </p>
            {sync.items.length > 0 && (
              <Button size="touch" icon="refresh" disabled={!online} loading={sync.phase === "syncing"} loadingLabel="Syncing…" onClick={() => void retrySync()}>
                {online ? "Sync now" : "Waiting for a connection"}
              </Button>
            )}
            {install && !isStandalone() && (
              <Button size="touch" icon="smartphone" onClick={() => void install()}>
                Install on this phone
              </Button>
            )}
            {!install && !isStandalone() && <p className="m-0 text-small text-ink-muted">To keep MTB Teacher on your home screen, use your browser's "Add to Home screen".</p>}
          </div>
        </Panel>

        {import.meta.env.VITE_USE_MOCKS !== "false" && (
          <Suspense fallback={null}>
            <DemoPanel />
          </Suspense>
        )}

        <Button
          variant="danger-quiet"
          size="touch"
          block
          icon="logout"
          loading={signingOut}
          loadingLabel="Signing out…"
          onClick={() => (sync.items.length ? setConfirmOut(true) : void signOut())}
        >
          Sign out
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOut}
        onClose={() => setConfirmOut(false)}
        onConfirm={() => {
          setConfirmOut(false);
          void signOut();
        }}
        tone="danger"
        title="Sign out with work not sent?"
        message={`${sync.items.length} ${sync.items.length === 1 ? "item is" : "items are"} saved only on this phone. Signing out deletes ${sync.items.length === 1 ? "it" : "them"}. Connect to the internet and sync first if you can.`}
        confirmLabel="Sign out and delete"
        cancelLabel="Stay signed in"
      />
    </Screen>
  );
}
