import { cx } from "@mtb/ui";
import type { CSSProperties, ReactNode } from "react";

/** A dashboard panel: title and one-line description on the left, controls on the right, no divider. */
export function DashCard({
  title,
  description,
  actions,
  className,
  style,
  children,
  id,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  id: string;
}) {
  return (
    <section className={cx("mtb-card mtb-dash-card mtb-rise", className)} style={style} aria-labelledby={`${id}-title`}>
      <header className="mtb-dash-card-head">
        <div className="min-w-0">
          <h2 id={`${id}-title`}>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className="mtb-dash-card-body">{children}</div>
    </section>
  );
}
