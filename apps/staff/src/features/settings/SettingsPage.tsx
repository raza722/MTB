import { calculateLateFine, formatLakh, formatRs } from "@mtb/domain";
import { Card, DataTable, Icon, KeyValue, Segmented, StatusBadge, Switch } from "@mtb/ui";
import { Link } from "@tanstack/react-router";
import { useAppearance, type Theme } from "../../app/appearance";
import { setPreference, usePreferences } from "../../app/preferences";
import { Page, PageHeader } from "../../app/shell/page";
import { useCan, useSessionUser } from "../../app/session";

const TODAY = "2026-11-04";
const DUE = "2026-09-15"; // Ayesha's annual charges

const FINE_VARIANTS = [
  { id: "now", rule: "Rs 10 a day from the day after the due date (today's rule)", policy: { ratePerDay: 10, graceDays: 0, maxFine: null } },
  { id: "grace", rule: "Same, after 5 grace days", policy: { ratePerDay: 10, graceDays: 5, maxFine: null } },
  { id: "cap", rule: "Same, capped at Rs 300 per charge", policy: { ratePerDay: 10, graceDays: 0, maxFine: 300 } },
  { id: "both", rule: "5 grace days and capped at Rs 300", policy: { ratePerDay: 10, graceDays: 5, maxFine: 300 } },
];

/** Links into Setup for roles that manage the school (principals reach Users from here). */
function SetupLinks() {
  const canSetup = useCan("setup.manage");
  const canUsers = useCan("users.manage");
  const canSettings = useCan("settings.manage");
  if (!canSetup && !canUsers && !canSettings) return null;
  const links: Array<{ to: string; label: string; detail: string; show: boolean }> = [
    { to: "/setup", label: "Setup overview", detail: "Campuses, sessions, classes, subjects and teachers", show: canSetup || canUsers },
    { to: "/setup/users", label: "Users", detail: "Accounts, roles, passwords and two-step sign-in", show: canUsers },
    { to: "/setup/roles", label: "Roles and permissions", detail: "What each role can do", show: canSetup || canUsers },
    { to: "/setup/campus-settings", label: "Campus settings", detail: "SMS sender name, receipt footer, voucher bank details", show: canSettings },
  ];
  return (
    <Card title="Running the school">
      <ul className="m-0 grid list-none gap-1 p-0">
        {links
          .filter((l) => l.show)
          .map((l) => (
            <li key={l.to}>
              <Link to={l.to as never} className="flex items-center gap-3 rounded-md px-2 py-2 text-ink no-underline hover:bg-surface-hover">
                <span className="grid min-w-0 flex-1">
                  <span className="font-medium">{l.label}</span>
                  <span className="text-small text-ink-muted">{l.detail}</span>
                </span>
                <Icon name="chevronRight" size={16} className="text-ink-subtle" />
              </Link>
            </li>
          ))}
      </ul>
    </Card>
  );
}

function Undecided() {
  return (
    <StatusBadge status="neutral" dot={false}>
      Not yet decided
    </StatusBadge>
  );
}

export function SettingsPage() {
  const user = useSessionUser();
  const { theme, setTheme } = useAppearance();
  const prefs = usePreferences();
  return (
    <Page>
      <PageHeader title="Settings" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Appearance">
          <div className="grid gap-3">
            <span className="mtb-label">Theme</span>
            <Segmented
              aria-label="Theme"
              value={theme}
              onChange={(v) => setTheme(v as Theme)}
              options={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
            />
            <p className="m-0 text-small text-ink-muted">
              Saved on this computer. Colours, type and components follow the{" "}
              <Link to="/design-system" className="text-brand-ink underline underline-offset-2">
                MTB Campus design system
              </Link>
              .
            </p>
          </div>
        </Card>
        <Card title="Your account">
          <KeyValue
            items={[
              ["Name", user?.name ?? ""],
              ["Username", <span className="mtb-mono">{user?.username}</span>],
              ...(user?.roles.map((r): [string, string] => ["Role", `${r.roleName} — ${r.campusName}`]) ?? []),
              ["Sign-in", "Password and two-step verification"],
            ]}
          />
        </Card>
        <SetupLinks />
      </div>

      <Card
        title={
          <div className="grid">
            <h2 className="m-0 text-title-3">Open decisions</h2>
            <span className="text-small font-normal text-ink-muted">Shown as labelled variants so MTB can choose. Nothing here changes posted figures.</span>
          </div>
        }
      >
        <div className="grid gap-6">
          <section className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="m-0 text-title-3">Show large totals in lakh too</h3>
              <Undecided />
            </div>
            <Switch label={`Show “${formatLakh(4825000)}” beside ${formatRs(4825000)} on the dashboard`} checked={prefs.showLakh} onChange={(e) => setPreference("showLakh", e.target.checked)} />
          </section>

          <section className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="m-0 text-title-3">Late fine: maximum or grace days?</h3>
              <Undecided />
            </div>
            <p className="m-0 text-small text-ink-muted">Ayesha Khan's annual charges were due 15-Sep-2026 (50 days ago). What each rule would charge today:</p>
            <DataTable
              rows={FINE_VARIANTS}
              stickyHeader={false}
              density="dense"
              columns={[
                { key: "rule", header: "Rule", render: (v) => (v.id === "now" ? <span className="font-medium">{v.rule}</span> : v.rule) },
                { key: "working", header: "Working", render: (v) => <span className="text-small text-ink-muted">{calculateLateFine(DUE, TODAY, v.policy).explanation}</span> },
                { key: "fine", header: "Late fine", align: "right", render: (v) => formatRs(calculateLateFine(DUE, TODAY, v.policy).fine) },
              ]}
            />
          </section>

          <section className="grid gap-2 md:grid-cols-3">
            {[
              ["Partial payments", "Try it on the fee counter: the Part payment switch shows what an amount would cover and what stays due."],
              ["Oldest charges first", "On by default at the fee counter; switch it off there to see free selection."],
              ["One receipt for several siblings", "Today each child gets their own receipt. A family receipt would need its own number series."],
              ["Principals and staff records", "The old campus Admin could register staff. Principals now see staff records and set up their own campus's sections and teachers; adding and editing staff stays with head office unless MTB gives principals Staff records › Edit."],
            ].map(([t, d]) => (
              <div key={t} className="grid content-start gap-1 rounded-md border border-dashed border-border-strong p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{t}</span>
                  <Undecided />
                </div>
                <span className="text-small text-ink-muted">{d}</span>
              </div>
            ))}
          </section>
        </div>
      </Card>
    </Page>
  );
}
