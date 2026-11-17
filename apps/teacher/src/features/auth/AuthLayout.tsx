import { AuthScene, Icon, type AuthSceneHighlight } from "@mtb/ui";
import { useEffect, type ReactNode } from "react";
import { useOnline } from "../../app/sync/network";

const HIGHLIGHTS: readonly AuthSceneHighlight[] = [
  { icon: "listChecks", text: "Take the register in a few taps" },
  { icon: "edit", text: "Enter marks class by class" },
  { icon: "cloudOff", text: "Keeps working offline and sends when you are back online" },
];

/** The shared sign-in frame (school crest and the MTB Teacher name above the form on a phone) with help underneath. */
export function AuthLayout({ title, subtitle, children, aside }: { title: string; subtitle?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  const online = useOnline();
  useEffect(() => {
    document.title = `${title} · MTB Teacher`;
  }, [title]);
  return (
    <AuthScene name="MTB Teacher" tagline="Registers and marks on your phone" highlights={HIGHLIGHTS} motto="Inspiring success & changing lives · since 1907">
      <main id="main" className="mtb-card mtb-auth-card grid gap-5 p-5 sm:p-8">
        {!online && (
          <p className="m-0 flex items-center gap-2 rounded-md bg-warning-tint px-3 py-2 text-small text-warning-ink" role="status">
            <Icon name="cloudOff" size={16} /> This phone is offline. Signing in needs a connection.
          </p>
        )}
        <div className="grid gap-1">
          <h1 className="m-0 text-title-1 tracking-tight">{title}</h1>
          {subtitle && <p className="m-0 text-ink-muted">{subtitle}</p>}
        </div>
        {children}
      </main>
      {aside}
      <p className="mtb-auth-foot m-0 text-center text-small text-ink-muted">Trouble signing in? Ask your campus office.</p>
    </AuthScene>
  );
}
