import { TRANSPORT_DOC_LABEL, type TransportAlert, type TransportRoute } from "@mtb/api";
import { formatDate } from "@mtb/domain";
import { StatusBadge } from "@mtb/ui";
import type { ReactNode } from "react";
import type { SubNavItem } from "../../app/shell/SubNav";
import { Meter, ModuleShell } from "../library/common";

export const TRANSPORT_NAV: SubNavItem[] = [
  { to: "/transport", label: "Overview", icon: "dashboard", exact: true },
  { to: "/transport/riders", label: "Students on transport", icon: "students" },
  { to: "/transport/routes", label: "Routes and stops", icon: "mapPin" },
  { to: "/transport/vehicles", label: "Vehicles", icon: "key" },
  { to: "/transport/logbook", label: "Trips and fuel", icon: "clock" },
];

export function TransportShell(props: { title: string; context?: ReactNode; actions?: ReactNode; meta?: ReactNode; children: ReactNode }) {
  return <ModuleShell nav={TRANSPORT_NAV} navLabel="Transport" readOnlyNote="Routes, riders, trips and fuel stay available to read and print." {...props} />;
}

/** "Expired 7 days ago" / "Expires in 12 days" for a vehicle document. */
export function AlertBadge({ a }: { a: TransportAlert }) {
  const text = a.days < 0 ? `${TRANSPORT_DOC_LABEL[a.kind]} expired ${formatDate(a.expiresOn)}` : `${TRANSPORT_DOC_LABEL[a.kind]} expires ${a.days === 0 ? "today" : `in ${a.days} days`}`;
  return <StatusBadge status={a.days < 0 ? "overdue" : a.days <= 14 ? "warning" : "pending"}>{text}</StatusBadge>;
}

export function DateDue({ date, today }: { date: string; today: string }) {
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return (
    <span className={`mtb-num ${days < 0 ? "font-medium text-status-overdue-ink" : days <= 30 ? "text-warning-ink" : ""}`}>
      {formatDate(date)}
      {days < 0 ? " · expired" : days <= 30 ? ` · ${days} days` : ""}
    </span>
  );
}

/** Seats filled on a route: "9 of 9 seats" with a bar that turns red when full. */
export function Load({ r }: { r: Pick<TransportRoute, "riders" | "capacity"> }) {
  const full = r.capacity > 0 && r.riders >= r.capacity;
  const warn = r.capacity > 0 && r.riders / r.capacity >= 0.85;
  return (
    <span className="grid min-w-[110px] gap-1">
      <span className={`mtb-num text-small ${full ? "font-semibold text-status-overdue-ink" : ""}`}>
        {r.riders} of {r.capacity || "—"} seats{full ? " · full" : ""}
      </span>
      <Meter value={r.riders} max={Math.max(1, r.capacity)} label={`${r.riders} of ${r.capacity} seats taken`} {...(full ? { tone: "full" as const } : warn ? { tone: "warn" as const } : {})} />
    </span>
  );
}
