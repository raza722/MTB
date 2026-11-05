import { formatDate, type IsoDate } from "@mtb/domain";
import { Fragment, type CSSProperties, type ReactNode } from "react";
import { Icon, type IconName } from "../icons";
import { cx, initials } from "../lib/cx";

/** In the shape of what will appear. Never a spinner on a whole page. */
export function Skeleton({ width = "100%", height = 14, style, className }: { width?: number | string; height?: number | string; style?: CSSProperties; className?: string }) {
  return <span className={cx("mtb-skeleton", className)} style={{ width, height, ...style }} aria-hidden="true" />;
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return <span className="mtb-spinner" role="status" aria-label={label} />;
}

export interface EmptyStateProps {
  icon?: IconName;
  title?: ReactNode;
  description?: ReactNode;
  /** The one action that fills it. */
  action?: ReactNode;
  className?: string;
}

/** Says what would appear here and offers the one action that fills it. */
export function EmptyState({ icon = "inbox", title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cx("mtb-empty", className)}>
      <div className="mtb-empty-icon">
        <Icon name={icon} />
      </div>
      {title && <h3>{title}</h3>}
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export interface PermissionDeniedProps {
  /** Role and campus the user has, e.g. "Teacher — Khalid Campus". */
  role: string;
  /** What they tried to open, e.g. "Accounts". */
  page: string;
  /** Who can grant access. */
  grantedBy?: string;
  action?: ReactNode;
}

/** EmptyState with the lock icon, naming the role the user has here and who can grant more. */
export function PermissionDenied({ role, page, grantedBy = "your campus admin", action }: PermissionDeniedProps) {
  return (
    <EmptyState
      icon="lock"
      title={`You don't have access to ${page}`}
      description={
        <>
          You are signed in as <b>{role}</b>, which can't open {page}. If you need it for your work, ask {grantedBy} to add it to your role.
        </>
      }
      action={action}
    />
  );
}

export interface BannerProps {
  tone?: "info" | "warning" | "danger" | "success" | "neutral";
  icon?: IconName;
  title?: ReactNode;
  actions?: ReactNode;
  className?: string;
  role?: string;
  children?: ReactNode;
}

/** A banner describes the state the page is in; a toast describes an event. */
export function Banner({ tone = "info", icon, title, actions, className, role, children }: BannerProps) {
  const ic: IconName = icon ?? ({ info: "info", warning: "alert", danger: "alertCircle", success: "checkCircle", neutral: "info" } as const)[tone];
  return (
    <div className={cx("mtb-banner", `mtb-banner-${tone}`, className)} role={role ?? (tone === "danger" ? "alert" : "status")}>
      <Icon name={ic} />
      <div style={{ flex: 1 }}>
        {title && <b>{title} </b>}
        {children}
      </div>
      {actions && <div className="mtb-banner-actions">{actions}</div>}
    </div>
  );
}

export interface AvatarProps {
  name: string;
  size?: "sm" | "lg" | "xl";
  tone?: 1 | 2 | 3 | 4;
  src?: string;
  className?: string;
}

/** Initials when there is no photo. Decorative: the name always appears beside it. */
export function Avatar({ name, size, tone, src, className }: AvatarProps) {
  const t = tone ?? ((name.length % 4) + 1);
  return (
    <span className={cx("mtb-avatar", size && `mtb-avatar-${size}`, t > 1 && `tone-${t}`, className)} aria-hidden="true">
      {src ? <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : initials(name || "?")}
    </span>
  );
}

export function Stepper({ steps, current, label = "Progress" }: { steps: string[]; current: number; label?: string }) {
  return (
    <ol className="mtb-steps" aria-label={label} style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {steps.map((s, i) => (
        <Fragment key={s}>
          {i > 0 && <li className="mtb-step-sep" aria-hidden="true" />}
          <li className={cx("mtb-step", i === current && "is-active", i < current && "is-done")} aria-current={i === current ? "step" : undefined}>
            <span className="mtb-step-n">{i < current ? <Icon name="check" size={14} label="Done" /> : i + 1}</span>
            {s}
          </li>
        </Fragment>
      ))}
    </ol>
  );
}

export interface TimelineItem {
  id: string;
  date: IsoDate;
  title: ReactNode;
  description?: ReactNode;
  icon?: IconName;
  tone?: "brand" | "neutral" | "success" | "warning" | "danger" | "info";
}

/** Dated events, newest last: Admitted, Promoted, section changes, Transfer in, Left. */
export function Timeline({ items, label = "History" }: { items: TimelineItem[]; label?: string }) {
  return (
    <ol className="mtb-timeline" aria-label={label}>
      {items.map((item) => (
        <li key={item.id} className="mtb-timeline-item">
          <span className={cx("mtb-timeline-dot", item.tone && item.tone !== "neutral" && `tone-${item.tone}`)} aria-hidden="true">
            <Icon name={item.icon ?? "clock"} />
          </span>
          <div>
            <time className="mtb-timeline-date" dateTime={item.date}>
              {formatDate(item.date)}
            </time>
            <div className="mtb-timeline-title">{item.title}</div>
            {item.description && <div className="mtb-timeline-desc">{item.description}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** A single key: <Kbd>F2</Kbd> */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="mtb-kbd">{children}</kbd>;
}

/** On-screen keyboard hints, e.g. F2 Search · ↑ ↓ Move · Space Select · Enter Continue · Esc Back. */
export function ShortcutHints({ items, label = "Keyboard shortcuts" }: { items: Array<{ keys: string[]; label: string }>; label?: string }) {
  return (
    <ul className="mtb-shortcuts" aria-label={label}>
      {items.map((s) => (
        <li key={s.label} className="mtb-shortcut">
          {s.keys.map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
          <span>{s.label}</span>
        </li>
      ))}
    </ul>
  );
}
