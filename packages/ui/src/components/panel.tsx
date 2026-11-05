import type { CSSProperties, ReactNode } from "react";
import { cx } from "../lib/cx";

export interface PanelProps {
  /** Used for the heading id (`${id}-title`) that labels the section. */
  id: string;
  title: ReactNode;
  /** One line under the title: what the panel shows and for when. */
  description?: ReactNode;
  /** Controls on the right: a Segmented chart/table switch, a link, a small button. */
  actions?: ReactNode;
  /** Entrance stagger index (adds .mtb-rise with --i). Omit for no entrance motion. */
  rise?: number;
  /** No padding around the body, for a DataTable that runs edge to edge. */
  flush?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

/**
 * MTB addition: the content panel used across modules (the dashboard's card style). Title and one-line
 * description on the left, controls on the right, no divider; built on the design system's card.
 */
export function Panel({ id, title, description, actions, rise, flush, className, style, children }: PanelProps) {
  return (
    <section
      className={cx("mtb-card mtb-block", rise !== undefined && "mtb-rise", className)}
      style={rise !== undefined ? ({ ...style, "--i": rise } as CSSProperties) : style}
      aria-labelledby={`${id}-title`}
    >
      <header className="mtb-block-head">
        <div className="min-w-0">
          <h2 id={`${id}-title`}>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {actions && <div className="mtb-block-actions">{actions}</div>}
      </header>
      <div className={cx("mtb-block-body", flush && "mtb-block-flush")}>{children}</div>
    </section>
  );
}
