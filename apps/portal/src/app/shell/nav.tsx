import { portalQueries } from "@mtb/api";
import type { MessageKey } from "@mtb/i18n";
import { cx, Icon, type IconName } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Ltr, useLang } from "../i18n";
import { useChild } from "../session";

export interface NavItem {
  to: "/home" | "/fees" | "/attendance" | "/results" | "/notices" | "/profile";
  label: MessageKey;
  icon: IconName;
}

export const NAV: NavItem[] = [
  { to: "/home", label: "nav.home", icon: "home" },
  { to: "/fees", label: "nav.fees", icon: "fees" },
  { to: "/attendance", label: "nav.attendance", icon: "attendance" },
  { to: "/results", label: "nav.results", icon: "exams" },
  { to: "/notices", label: "nav.notices", icon: "bell" },
  { to: "/profile", label: "nav.profileLong", icon: "user" },
];

/** Unread notices for the child on screen (a badge on Notices). */
function useUnread(): number {
  const child = useChild();
  return useQuery({ ...portalQueries.notices(child?.grNo ?? ""), enabled: !!child }).data?.unread ?? 0;
}

function UnreadBadge({ n, className }: { n: number; className?: string }) {
  const { t } = useLang();
  if (n <= 0) return null;
  return (
    <>
      <span aria-hidden="true" className={cx("grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[11px] leading-none font-semibold text-on-danger", className)}>
        <Ltr className="tabular-nums">{n}</Ltr>
      </span>
      <span className="mtb-sr-only">, {t("home.noticesUnread", { n })}</span>
    </>
  );
}

/** Desktop: the pages down the start side. */
export function SideNav() {
  const { t } = useLang();
  const unread = useUnread();
  return (
    <nav aria-label={t("nav.main")} className="grid gap-1">
      {NAV.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className="portal-nav-link flex min-h-11 items-center gap-3 rounded-md px-3 text-ink-muted no-underline transition-colors hover:bg-surface-hover hover:text-ink"
        >
          <Icon name={item.icon} size={20} />
          <span className="flex-1 font-medium">{t(item.label)}</span>
          {item.to === "/notices" && <UnreadBadge n={unread} />}
        </Link>
      ))}
    </nav>
  );
}

/** Phones: five destinations within thumb reach (Profile is in the top bar). */
export function BottomNav() {
  const { t } = useLang();
  const unread = useUnread();
  return (
    <nav aria-label={t("nav.main")} className="portal-no-print fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface-raised/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <ul className="mx-auto grid max-w-[560px] list-none grid-cols-5 p-0 px-1">
        {NAV.filter((i) => i.to !== "/profile").map((item) => (
          <li key={item.to}>
            <Link
              to={item.to}
              className="group flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-md text-caption text-ink-muted no-underline outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring aria-[current=page]:text-brand-ink"
            >
              <span className="relative grid h-8 w-14 place-items-center rounded-full transition-colors group-aria-[current=page]:bg-brand-tint">
                <Icon name={item.icon} size={22} />
                {item.to === "/notices" && <UnreadBadge n={unread} className="absolute -top-0.5 end-1.5" />}
              </span>
              <span className="font-medium">{t(item.label === "nav.profileLong" ? "nav.profile" : item.label)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
