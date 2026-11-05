import { DEMO_PASSWORD, USERS } from "@mtb/mocks";

/** Mock mode only: fill the form with a fictional cast account. */
export default function DemoAccounts({ onPick }: { onPick: (username: string, password: string) => void }) {
  return (
    <section className="mtb-card grid gap-2 p-4" aria-labelledby="demo-accounts">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="demo-accounts" className="m-0 text-title-3">
          Demo accounts
        </h2>
        <span className="text-small text-ink-muted">
          Password and code: <span className="mtb-mono">packages/mocks/src/fixtures/users.ts</span>
        </span>
      </div>
      <ul className="m-0 grid list-none gap-1 p-0">
        {USERS.map((u) => (
          <li key={u.id}>
            <button type="button" onClick={() => onPick(u.username, DEMO_PASSWORD)} className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left hover:bg-surface-hover">
              <span className="grid">
                <span className="font-medium text-ink">{u.name}</span>
                <span className="text-small text-ink-muted">
                  {u.roles[0]?.roleName} — {u.roles[0]?.campusName}
                </span>
              </span>
              <span className="mtb-mono text-small text-ink-muted">{u.username}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="m-0 text-small text-ink-muted">Fictional people and data. Clicking an account fills the form.</p>
    </section>
  );
}
