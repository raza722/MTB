import { setupQueries, type Permission, type SetupAttention, type SetupOverview } from "@mtb/api";
import { formatCount, formatDate, formatDateTime, formatSession } from "@mtb/domain";
import { AnimatedNumber, buttonClassName, cx, EmptyState, Icon, Panel, SegmentedBar, Skeleton, StatCard, StatusBadge, type IconName } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { useCan, useCtx } from "../../app/session";
import { AuditRow } from "./AuditPage";
import { QueryError, SetupPage, useCanAny } from "./shared";

const stagger = (i: number) => ({ "--i": i }) as CSSProperties;

interface Tile {
  to: string;
  icon: IconName;
  title: string;
  desc: string;
  count?: (o: SetupOverview) => string;
  any: Permission[];
}

const TILES: Tile[] = [
  { to: "/setup/campuses", icon: "building", title: "Campuses", desc: "Names, addresses, report headings, Urdu names, document prefixes and the modules each campus uses.", count: (o) => `${o.campuses.total}`, any: ["setup.manage", "setup.campus"] },
  { to: "/setup/sessions", icon: "calendar", title: "Academic sessions", desc: "Create next year in one step, make it current, and close and lock old years.", count: (o) => formatSession(o.session.current), any: ["setup.manage"] },
  { to: "/setup/classes", icon: "layers", title: "Classes and sections", desc: "Classes shared by every campus; each campus's sections, seats, rooms and fill.", count: (o) => `${o.sections} sections`, any: ["setup.manage", "setup.campus"] },
  { to: "/setup/subjects", icon: "book", title: "Subjects and marks", desc: "Subjects, groups, and what each class studies with maximum and pass marks.", count: (o) => `${o.subjects}`, any: ["setup.manage"] },
  { to: "/setup/teachers", icon: "students", title: "Teacher allotment", desc: "Class teachers and subject teachers per section, with each teacher's weekly load.", any: ["setup.manage", "setup.campus"] },
  { to: "/setup/users", icon: "user", title: "Users", desc: "Accounts, roles per campus, passwords, locks, two-step sign-in and sign-in history.", count: (o) => `${o.users.total}`, any: ["users.manage"] },
  { to: "/setup/roles", icon: "shield", title: "Roles and permissions", desc: "What each role can do, module by module. Make your own roles from a copy.", count: (o) => `${o.roles.total}`, any: ["setup.manage", "users.manage"] },
  { to: "/setup/campus-settings", icon: "settings", title: "Campus settings", desc: "SMS sender name, receipt footer and voucher bank details, per campus.", any: ["settings.manage"] },
  { to: "/setup/audit", icon: "listChecks", title: "Audit log", desc: "Who changed what and when, with before and after values. Sign-ins too.", any: ["setup.manage", "users.manage"] },
];

function SetupTile({ tile, o, i }: { tile: Tile; o: SetupOverview | undefined; i: number }) {
  const allowed = useCanAny(tile.any);
  if (!allowed) return null;
  return (
    <Link to={tile.to as never} className="setup-tile mtb-rise" style={stagger(i + 4)}>
      <span className="setup-tile-icon" aria-hidden="true">
        <Icon name={tile.icon} size={18} />
      </span>
      <span className="setup-tile-title">
        {tile.title}
        {tile.count && o && <span className="setup-tile-count">{tile.count(o)}</span>}
      </span>
      <span className="setup-tile-desc">{tile.desc}</span>
    </Link>
  );
}

const TONE_ICON: Record<SetupAttention["tone"], IconName> = { danger: "lock", warning: "alert", info: "info" };

function AttentionList({ items }: { items: SetupAttention[] }) {
  if (items.length === 0) return <EmptyState icon="checkCircle" title="Everything is in order" description="No locked accounts, missing teachers or unfinished sessions." />;
  return (
    <ul className="setup-list">
      {items.map((a, i) => (
        <li key={a.id} className="setup-row mtb-slide-in" style={stagger(i)}>
          <span className={cx("setup-row-icon", `tone-${a.tone}`)} aria-hidden="true">
            <Icon name={TONE_ICON[a.tone]} size={16} />
          </span>
          <div className="grid min-w-0 flex-1 gap-0.5">
            <span className="font-medium text-ink">{a.title}</span>
            <span className="truncate text-small text-ink-muted">{a.detail}</span>
          </div>
          <Link to={a.to as never} search={((prev: Record<string, unknown>) => ({ ...prev, ...(a.search ?? {}) })) as never} className={buttonClassName({ size: "sm", variant: "secondary" })}>
            {a.action}
          </Link>
        </li>
      ))}
    </ul>
  );
}

const ACCOUNT_PARTS = [
  { key: "active", label: "Active", color: "var(--status-paid)", status: "success" as const },
  { key: "invited", label: "Invited, not signed in yet", color: "var(--info)", status: "info" as const },
  { key: "locked", label: "Locked", color: "var(--status-overdue)", status: "danger" as const },
  { key: "disabled", label: "Disabled (left)", color: "var(--status-cancelled)", status: "neutral" as const },
] as const;

function AccountsPanel({ o }: { o: SetupOverview }) {
  const live = o.users.total - o.users.disabled;
  const pct = live ? Math.round((o.users.twoStep / live) * 100) : 0;
  return (
    <div className="grid gap-4">
      <SegmentedBar label="User accounts by status" format={formatCount} height={12} segments={ACCOUNT_PARTS.map((p) => ({ key: p.key, label: p.label, color: p.color, value: o.users[p.key] }))} />
      <ul className="setup-legend" aria-label="Account status legend">
        {ACCOUNT_PARTS.map((p) => (
          <li key={p.key}>
            <span className="mtb-chart-key" style={{ background: p.color }} aria-hidden="true" />
            {p.label}
            <b>{formatCount(o.users[p.key])}</b>
          </li>
        ))}
      </ul>
      <div className="grid gap-2 rounded-md bg-surface-sunken p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-small font-medium text-ink">Two-step sign-in</span>
          <span className="text-small tabular-nums text-ink-muted">
            {o.users.twoStep} of {live} accounts
          </span>
        </div>
        <div className={cx("mtb-meter setup-meter-grow", pct < 60 && "tone-warning")} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${pct}% of accounts use two-step sign-in`}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <span className="text-small text-ink-muted">Required for admins, principals, accountants and cashiers. Optional for teachers and office staff.</span>
      </div>
    </div>
  );
}

const ELSEWHERE: Array<{ to: string; label: string; detail: string; perm: "fees.view" | "sms.view" | "activities.view" | "timetable.view" | "hr.view" | "exams.view" }> = [
  { to: "/fees/structure", label: "Fee heads, fee structure and fine rules", detail: "Fees", perm: "fees.view" },
  { to: "/exams/types", label: "Exam types and grading rules", detail: "Exams", perm: "exams.view" },
  { to: "/timetable", label: "Class timings, periods and timetables", detail: "Timetable", perm: "timetable.view" },
  { to: "/activities", label: "Houses, sports, events and scholarship rules", detail: "Activities", perm: "activities.view" },
  { to: "/hr", label: "Staff types, departments and increment rules", detail: "Staff & payroll", perm: "hr.view" },
  { to: "/sms", label: "Message templates and SMS companies", detail: "SMS", perm: "sms.view" },
];

function ElsewhereRow({ item }: { item: (typeof ELSEWHERE)[number] }) {
  const allowed = useCan(item.perm);
  if (!allowed) return null;
  return (
    <li>
      <Link to={item.to as never} className="setup-row no-underline hover:bg-surface-hover" style={{ color: "inherit", marginInline: "calc(var(--space-2) * -1)", paddingInline: "var(--space-2)", borderRadius: "var(--radius-md)" }}>
        <span className="min-w-0 flex-1 text-ink">{item.label}</span>
        <span className="text-small text-ink-muted">{item.detail}</span>
        <Icon name="chevronRight" size={16} className="text-ink-subtle" />
      </Link>
    </li>
  );
}

export function SetupHome() {
  const ctx = useCtx();
  const navigate = useNavigate();
  const q = useQuery(setupQueries.overview(ctx));
  const o = q.data;
  const canAudit = useCanAny(["setup.manage", "users.manage"]);
  const canSetup = useCan("setup.manage");
  // Campus-level setup (the principal): sections, teachers and school-day times at their own campus.
  const canCampusSetup = useCanAny(["setup.manage", "setup.campus"]);
  const canUsers = useCan("users.manage");
  const live = o ? o.users.total - o.users.disabled : 0;

  return (
    <SetupPage
      title="Setup"
      actions={
        canAudit && (
          <Link to="/setup/audit" className={buttonClassName({ variant: "secondary" })}>
            <Icon name="listChecks" />
            Audit log
          </Link>
        )
      }
    >
      {q.isError && <QueryError what="The setup overview" error={q.error} onRetry={() => void q.refetch()} />}

      <div className="setup-stats">
        {!o ? (
          [0, 1, 2, 3].map((i) => <StatCard key={i} label="" loading />)
        ) : (
          <>
            <div className="mtb-rise" style={stagger(0)}>
              <StatCard
                label="Campuses"
                icon="building"
                value={<AnimatedNumber value={o.campuses.total} format={formatCount} />}
                foot={`${o.campuses.active} active · one system for all`}
                {...(canSetup ? { onClick: () => void navigate({ to: "/setup/campuses" as never }) } : {})}
              />
            </div>
            <div className="mtb-rise" style={stagger(1)}>
              <StatCard
                label="Current session"
                icon="calendar"
                value={formatSession(o.session.current)}
                meter={(o.session.day / o.session.days) * 100}
                meterLabel={`Day ${o.session.day} of ${o.session.days}`}
                foot={`Day ${o.session.day} of ${o.session.days} · ends ${formatDate(o.session.endsOn)}`}
                {...(canSetup ? { onClick: () => void navigate({ to: "/setup/sessions" as never }) } : {})}
              />
            </div>
            <div className="mtb-rise" style={stagger(2)}>
              <StatCard
                label="Sections this session"
                icon="layers"
                value={<AnimatedNumber value={o.sections} format={formatCount} />}
                foot={`${o.classes} classes · ${o.subjects} subjects`}
                {...(o.sectionsWithoutClassTeacher ? { tone: "warning" as const } : {})}
                {...(canCampusSetup ? { onClick: () => void navigate({ to: "/setup/classes" as never }) } : {})}
              />
            </div>
            <div className="mtb-rise" style={stagger(3)}>
              <StatCard
                label="People who can sign in"
                icon="user"
                value={<AnimatedNumber value={o.users.active} format={formatCount} />}
                foot={`${live} accounts · ${o.users.locked} locked · ${o.users.invited} invited`}
                {...(o.users.locked ? { tone: "danger" as const } : {})}
                {...(canUsers ? { onClick: () => void navigate({ to: "/setup/users" as never }) } : {})}
              />
            </div>
          </>
        )}
      </div>

      <div className="setup-grid">
        <Panel id="setup-attention" title="Needs attention" description="Things to fix before they cause a problem at the counter or in class." rise={4}>
          {!o ? (
            <div className="grid gap-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height={40} />
              ))}
            </div>
          ) : (
            <AttentionList items={o.attention.filter((a) => (a.to === "/setup/users" ? canUsers : a.to === "/setup/teachers" || a.to === "/setup/classes" ? canCampusSetup : canSetup))} />
          )}
        </Panel>
        <Panel id="setup-accounts" title="Accounts" description={o ? `${o.users.total} accounts${ctx.campus === "ALL" ? " across all campuses" : " at this campus"}` : "Loading…"} rise={5}>
          {!o ? <Skeleton height={160} /> : <AccountsPanel o={o} />}
        </Panel>
      </div>

      <Panel id="setup-areas" title="Everything you can set up" description="One place for what used to be spread over the Main and Security tabs of the old software." rise={6}>
        <div className="setup-tiles">
          {TILES.map((t, i) => (
            <SetupTile key={t.to} tile={t} o={o} i={i} />
          ))}
          <Link to="/settings" className="setup-tile mtb-rise" style={stagger(14)}>
            <span className="setup-tile-icon" aria-hidden="true">
              <Icon name="sun" size={18} />
            </span>
            <span className="setup-tile-title">Your preferences</span>
            <span className="setup-tile-desc">Light or dark theme, your account, and the open decisions for MTB.</span>
          </Link>
        </div>
      </Panel>

      <div className="setup-grid">
        <Panel
          id="setup-recent"
          title="Recent changes"
          description="Every change to setup and users is recorded with who made it."
          rise={7}
          actions={
            canAudit && (
              <Link to="/setup/audit" className={buttonClassName({ size: "sm", variant: "ghost" })}>
                See all
              </Link>
            )
          }
        >
          {!o ? (
            <Skeleton height={160} />
          ) : o.recent.length === 0 ? (
            <EmptyState icon="listChecks" title="No changes yet" />
          ) : (
            <ul className="setup-list">
              {o.recent.map((a, i) => (
                <li key={a.id} className="mtb-slide-in" style={stagger(i)}>
                  <AuditRow entry={a} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <div className="grid content-start gap-6">
          {/* Shown only once the server reports central backups; today it sends backup: null (spec 00_setup C2). */}
          {o?.backup && (
            <Panel id="setup-backup" title="Backups" description="Automatic, for every campus, in one central place." rise={8}>
              <div className="grid gap-3">
                <div className="flex items-center gap-2">
                  <StatusBadge status="success">Backed up</StatusBadge>
                  <span className="text-small text-ink-muted">{formatDateTime(o.backup.lastAt)}</span>
                </div>
                <ul className="setup-legend">
                  <li>
                    Next backup<b>{formatDateTime(o.backup.nextAt)}</b>
                  </li>
                  <li>
                    Kept for<b>{o.backup.keepDays} days</b>
                  </li>
                  <li>
                    Restore to any minute in the last<b>{o.backup.restoreWindowDays} days</b>
                  </li>
                  <li>
                    Size<b>{o.backup.size}</b>
                  </li>
                </ul>
                <p className="m-0 text-small text-ink-muted">Replaces the Backup button on each campus computer. Nobody has to remember to press it.</p>
              </div>
            </Panel>
          )}
          <Panel id="setup-elsewhere" title="Set up in their own modules" description="Rules that belong to one module live next to the work." rise={9}>
            <ul className="setup-list">
              {ELSEWHERE.map((e) => (
                <ElsewhereRow key={e.to} item={e} />
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </SetupPage>
  );
}
