import { Avatar, buttonClassName, Icon, PermissionDenied } from "@mtb/ui";
import { Link } from "@tanstack/react-router";
import { ROLE_MENUS } from "../catalogue";
import { AppFrame, Specimen, stagger, StateGroupSection } from "../kit";

/** The sidebar the role sees: the page they tried to open isn't in it. */
function RoleSidebar({ role, missing }: { role: keyof typeof ROLE_MENUS; missing: string }) {
  return (
    <nav className="mtb-states-side" aria-label={`Menu for this ${role}`}>
      {ROLE_MENUS[role].map((m, i) => (
        <span key={m.label} className="mtb-slide-in" style={stagger(i)}>
          <Icon name={m.icon} size={16} />
          {m.label}
        </span>
      ))}
      <span className="is-missing mtb-slide-in" style={stagger(ROLE_MENUS[role].length)} title={`${missing} is not in this menu`}>
        <Icon name="lock" size={16} />
        {missing}
        <span className="mtb-sr-only"> (not in this menu)</span>
      </span>
    </nav>
  );
}

function DeniedSpecimen({ id, rise, role, roleLabel, who, page }: { id: string; rise: number; role: keyof typeof ROLE_MENUS; roleLabel: string; who: string; page: string }) {
  return (
    <Specimen id={id} rise={rise}>
      <AppFrame
        title={page}
        right={
          <span className="inline-flex items-center gap-2 text-ink-muted">
            <Avatar name={who} size="sm" />
            {who}
          </span>
        }
        side={<RoleSidebar role={role} missing={page} />}
      >
        <div className="mtb-card">
          <PermissionDenied
            role={roleLabel}
            page={page}
            action={
              <Link to="/dashboard" preload={false} className={buttonClassName({ variant: "primary", size: "sm" })}>
                Go to dashboard
              </Link>
            }
          />
        </div>
      </AppFrame>
    </Specimen>
  );
}

export function DeniedSection() {
  return (
    <StateGroupSection id="denied">
      <DeniedSpecimen id="denied-teacher" rise={0} role="teacher" roleLabel="Teacher — Khalid Campus" who="Ms Hina Javed" page="Accounts" />
      <DeniedSpecimen id="denied-cashier" rise={1} role="cashier" roleLabel="Cashier — Khalid Campus" who="Usman Ali" page="Exams" />
      <p className="mtb-states-wide m-0 flex items-start gap-2 text-small text-ink-muted">
        <Icon name="shield" size={16} className="mt-0.5 shrink-0" />
        The server checks the same permission on every request, so hiding a button is never the only protection. In the old desktop app most screens only hid their buttons.
      </p>
    </StateGroupSection>
  );
}
