import { Crest } from "@mtb/ui";
import type { ReactNode } from "react";

/** Centred card on the page background with the school crest (the old system's logo) and the MTB name. */
export function AuthLayout({ title, subtitle, children, aside }: { title: string; subtitle?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-surface px-4 py-10">
      <div className="grid w-full max-w-[420px] gap-6">
        <div className="grid justify-items-center gap-1 text-center">
          <Crest size={88} />
          <span className="text-display tracking-tight text-brand-ink">MTB</span>
          <span className="text-small text-ink-muted">Madrasat-ul-Banat Schools and Colleges</span>
        </div>
        <main className="mtb-card grid gap-5 p-6">
          <div className="grid gap-1">
            <h1 className="m-0 text-title-2">{title}</h1>
            {subtitle && <p className="m-0 text-ink-muted">{subtitle}</p>}
          </div>
          {children}
        </main>
        {aside}
        <p className="m-0 text-center text-small text-ink-muted">Trouble signing in? Ask your campus admin.</p>
      </div>
    </div>
  );
}
