import { Icon } from "@mtb/ui";
import { useEffect, type CSSProperties, type ReactNode } from "react";
import { useOnline } from "../../app/sync/network";

/** Phone sign-in frame: the MTB wordmark (the official logo was not supplied), the form, and help underneath. */
export function AuthLayout({ title, subtitle, children, aside }: { title: string; subtitle?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  const online = useOnline();
  useEffect(() => {
    document.title = `${title} · MTB Teacher`;
  }, [title]);
  return (
    <div className="min-h-dvh bg-surface px-4 pt-[calc(env(safe-area-inset-top)+32px)] pb-[calc(env(safe-area-inset-bottom)+24px)]">
      <div className="mx-auto grid w-full max-w-[420px] gap-5">
        <div className="mtb-rise flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-lg bg-brand text-on-brand" aria-hidden="true">
            <Icon name="book" size={26} />
          </span>
          <span className="grid">
            <span className="text-title-1 tracking-tight text-brand-ink">MTB Teacher</span>
            <span className="text-small text-ink-muted">Registers and marks on your phone</span>
          </span>
        </div>
        {!online && (
          <p className="m-0 flex items-center gap-2 rounded-md bg-warning-tint px-3 py-2 text-small text-warning-ink" role="status">
            <Icon name="cloudOff" size={16} /> This phone is offline. Signing in needs a connection.
          </p>
        )}
        <main id="main" className="mtb-card mtb-rise grid gap-5 p-5" style={{ "--i": 1 } as CSSProperties}>
          <div className="grid gap-1">
            <h1 className="m-0 text-title-2">{title}</h1>
            {subtitle && <p className="m-0 text-ink-muted">{subtitle}</p>}
          </div>
          {children}
        </main>
        {aside}
        <p className="m-0 text-center text-small text-ink-muted">Trouble signing in? Ask your campus office.</p>
      </div>
    </div>
  );
}
