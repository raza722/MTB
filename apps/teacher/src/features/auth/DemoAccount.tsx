import { DEMO_PASSWORD, USERS } from "@mtb/mocks";
import { Icon } from "@mtb/ui";

/** Mock mode only: fill the form with a fictional cast account. Not part of the product. */
export default function DemoAccount({ onPick }: { onPick: (username: string, password: string) => void }) {
  const teacher = USERS.find((u) => u.username === "hina.javed");
  const other = USERS.find((u) => u.username === "usman.ali");
  return (
    <section className="mtb-card grid gap-2 p-4" aria-labelledby="demo-account">
      <h2 id="demo-account" className="m-0 flex items-center gap-2 text-title-3">
        <Icon name="bolt" size={16} /> Demo account
      </h2>
      {[teacher, other].filter(Boolean).map((u) => (
        <button
          key={u!.id}
          type="button"
          onClick={() => onPick(u!.username, DEMO_PASSWORD)}
          className="flex min-h-14 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-start hover:bg-surface-hover"
        >
          <span className="grid">
            <span className="font-medium text-ink">{u!.name}</span>
            <span className="text-small text-ink-muted">
              {u!.roles[0]?.roleName} — {u!.roles[0]?.campusName}
              {u!.username === "hina.javed" ? " · first sign-in asks for a new password" : " · has no teacher app, shows the no-access screen"}
            </span>
          </span>
          <Icon name="chevronRight" size={18} className="shrink-0 text-ink-muted" />
        </button>
      ))}
      <p className="m-0 text-small text-ink-muted">Fictional people and data. Tapping an account fills the form.</p>
    </section>
  );
}
