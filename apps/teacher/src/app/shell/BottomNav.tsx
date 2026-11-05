import { teacherQueries } from "@mtb/api";
import { Icon, type IconName } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useCtx } from "../session";

interface Item {
  to: "/today" | "/registers" | "/marks" | "/timetable" | "/more";
  label: string;
  icon: IconName;
}

const ITEMS: Item[] = [
  { to: "/today", label: "Today", icon: "home" },
  { to: "/registers", label: "Registers", icon: "listChecks" },
  { to: "/marks", label: "Marks", icon: "edit" },
  { to: "/timetable", label: "Timetable", icon: "calendar" },
  { to: "/more", label: "More", icon: "menu" },
];

/** Five destinations within thumb reach. A dot on Registers until today's register is in; unread count on More. */
export function BottomNav() {
  const ctx = useCtx();
  const today = useQuery(teacherQueries.today(ctx)).data;
  const registerDue = !!today && !today.closed && today.registers.some((r) => r.status === "NOT_MARKED");
  const unread = today?.unread ?? 0;

  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface-raised/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="mx-auto grid max-w-[560px] list-none grid-cols-5 p-0 px-1">
        {ITEMS.map((it) => (
          <li key={it.to}>
            <Link
              to={it.to}
              className="group flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-md text-caption text-ink-muted no-underline outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring aria-[current=page]:text-brand-ink"
              activeOptions={{ exact: it.to === "/today" }}
            >
              <span className="relative grid h-8 w-14 place-items-center rounded-full transition-colors group-aria-[current=page]:bg-brand-tint">
                <Icon name={it.icon} size={22} />
                {it.to === "/registers" && registerDue && <span className="absolute top-1 right-3 size-2 rounded-full bg-status-unpaid ring-2 ring-surface-raised" aria-hidden="true" />}
                {it.to === "/more" && unread > 0 && (
                  <span className="absolute -top-0.5 right-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[11px] leading-none font-semibold text-on-danger tabular-nums" aria-hidden="true">
                    {unread}
                  </span>
                )}
              </span>
              <span className="font-medium">{it.label}</span>
              {it.to === "/registers" && registerDue && <span className="mtb-sr-only">, today's register is not marked yet</span>}
              {it.to === "/more" && unread > 0 && <span className="mtb-sr-only">, {unread} unread notifications</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
