import { Icon, type IconName } from "@mtb/ui";
import { Link, useRouterState } from "@tanstack/react-router";

export interface SubNavItem {
  /** A route path, e.g. "/fees/structure". */
  to: string;
  label: string;
  icon?: IconName;
  /** Marks the tab active when the path starts with this (defaults to `to`). */
  match?: string;
  /** Exact match only (for an index page such as "/hr"). */
  exact?: boolean;
}

/** A module's own pages as tabs under the page header (Fees: Counter · Structure · Vouchers · …). */
export function SubNav({ items, label }: { items: SubNavItem[]; label: string }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav className="mtb-subnav" aria-label={label}>
      {items.map((item) => {
        const m = item.match ?? item.to;
        const active = item.exact ? path === m || path === `${m}/` : path === m || path.startsWith(`${m}/`);
        return (
          <Link key={item.to} to={item.to as never} aria-current={active ? "page" : undefined}>
            {item.icon && <Icon name={item.icon} size={16} />}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
