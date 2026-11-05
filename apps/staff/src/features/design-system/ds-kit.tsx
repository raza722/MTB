import { cx } from "@mtb/ui";
import type { ReactNode } from "react";

/** Building blocks for the design-system page only. */

export function Section({ id, title, intro, children }: { id: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6 grid grid-cols-[minmax(0,1fr)] gap-6">
      <header className="grid gap-2">
        <h2 id={`${id}-title`} className="text-title-1 m-0">
          {title}
        </h2>
        {intro && <p className="m-0 max-w-3xl text-ink-muted">{intro}</p>}
      </header>
      {children}
    </section>
  );
}

/** A titled card. `flush` removes the body padding (for full-bleed tables). */
export function Specimen({ title, note, children, className, bodyClassName, flush }: { title: string; note?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; flush?: boolean }) {
  return (
    <div className={cx("mtb-card min-w-0", className)}>
      <div className="mtb-card-header">
        <div className="grid gap-0.5">
          <h3>{title}</h3>
          {note && <p className="m-0 text-small text-ink-muted">{note}</p>}
        </div>
      </div>
      <div className={cx(!flush && "p-5", "min-w-0", bodyClassName)}>{children}</div>
    </div>
  );
}

/** A labelled cell in a state matrix. */
export function StateCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid content-start gap-2">
      <span className="text-caption uppercase text-ink-muted">{label}</span>
      <div className="flex min-h-10 items-center">{children}</div>
    </div>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="mtb-mono text-ink-muted">{children}</code>;
}

/** A themed preview island: renders its children in a fixed theme regardless of the page theme. */
export function ThemeIsland({ theme, accent, children, className }: { theme: "light" | "dark"; accent: "green" | "navy"; children: ReactNode; className?: string }) {
  return (
    <div data-theme={theme} data-accent={accent} className={cx("rounded-lg border border-border bg-surface p-4 text-ink", className)}>
      {children}
    </div>
  );
}
