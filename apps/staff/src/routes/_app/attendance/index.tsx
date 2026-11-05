import { createFileRoute } from "@tanstack/react-router";
import { AttendancePage } from "../../../features/attendance";

const iso = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

/** /attendance — the day's registers by class (or by campus). */
export const Route = createFileRoute("/_app/attendance/")({
  validateSearch: (s: Record<string, unknown>): { date?: string } => (iso(s.date) ? { date: iso(s.date)! } : {}),
  component: function AttendanceTodayRoute() {
    const { date } = Route.useSearch();
    const navigate = Route.useNavigate();
    return <AttendancePage date={date} onDate={(d) => void navigate({ search: (prev) => ({ ...prev, date: d }) })} />;
  },
});
