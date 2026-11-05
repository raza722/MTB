import type { ReactNode } from "react";
import { Icon, type IconName } from "../icons";
import { cx } from "../lib/cx";
import { Skeleton } from "./feedback";

export interface StatCardProps {
  label: ReactNode;
  /** Already formatted: "Rs 486,500", "92.4%". */
  value?: ReactNode;
  icon?: IconName;
  tone?: "warning" | "danger" | "info" | "neutral";
  /** Positive is up, negative is down. */
  delta?: number;
  deltaLabel?: ReactNode;
  /** 0–100 against a target. */
  meter?: number;
  meterTone?: "warning" | "danger";
  /** Accessible name of the meter, e.g. "31% of the Rs 6,800,000 target". */
  meterLabel?: string;
  foot?: ReactNode;
  loading?: boolean;
  /** Makes the whole card a link into its detail page. */
  onClick?: () => void;
  children?: ReactNode;
}

/** One figure per card on a dashboard; four to six in a row. */
export function StatCard({ label, value, icon, tone, delta, deltaLabel, meter, meterTone, meterLabel, foot, loading, onClick, children }: StatCardProps) {
  if (loading) {
    return (
      <div className="mtb-stat" aria-busy="true">
        <div className="mtb-stat-top">
          <Skeleton width={120} />
          <Skeleton width={32} height={32} />
        </div>
        <Skeleton width="60%" height={32} />
        <Skeleton width="80%" />
      </div>
    );
  }
  const dir = delta === undefined ? null : delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const body = (
    <>
      <div className="mtb-stat-top">
        <span className="mtb-stat-label">{label}</span>
        {icon && (
          <span className={cx("mtb-stat-icon", tone && `tone-${tone}`)}>
            <Icon name={icon} />
          </span>
        )}
      </div>
      <div className="mtb-stat-value">{value}</div>
      {meter !== undefined && (
        <div
          className={cx("mtb-meter", meterTone && `tone-${meterTone}`)}
          role="progressbar"
          aria-valuenow={Math.round(meter)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={meterLabel}
        >
          <span style={{ width: `${Math.min(100, Math.max(0, meter))}%` }} />
        </div>
      )}
      {(dir || foot) && (
        <div className="mtb-stat-foot">
          {dir && delta !== undefined && (
            <span className={cx("mtb-delta", `mtb-delta-${dir}`)}>
              {dir !== "flat" && <Icon name={dir === "up" ? "trendUp" : "trendDown"} />}
              {deltaLabel ?? `${delta > 0 ? "+" : ""}${delta}%`}
            </span>
          )}
          {foot && <span>{foot}</span>}
        </div>
      )}
      {children}
    </>
  );
  return onClick ? (
    <button type="button" className="mtb-stat" onClick={onClick} style={{ textAlign: "left", font: "inherit", cursor: "pointer" }}>
      {body}
    </button>
  ) : (
    <div className="mtb-stat">{body}</div>
  );
}

export interface CardProps {
  title?: ReactNode;
  actions?: ReactNode;
  pad?: boolean;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
}

export function Card({ title, actions, pad = true, className, bodyClassName, children }: CardProps) {
  return (
    <section className={cx("mtb-card", className)}>
      {(title || actions) && (
        <header className="mtb-card-header">
          {typeof title === "string" ? <h2>{title}</h2> : title}
          {actions && <div className="mtb-row">{actions}</div>}
        </header>
      )}
      <div className={cx(pad && "mtb-card-body", bodyClassName)}>{children}</div>
    </section>
  );
}

export function KeyValue({ items, className }: { items: Array<[ReactNode, ReactNode]>; className?: string }) {
  return (
    <dl className={cx("mtb-kv", className)}>
      {items.map(([k, v], i) => (
        <div key={i} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
