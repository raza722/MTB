import { createFileRoute } from "@tanstack/react-router";
import { StaffAttendancePage, type AttendanceSearch, type AttendanceView } from "../../../features/hr";

const VIEWS: AttendanceView[] = ["day", "month", "range", "late", "imports"];
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * /hr/attendance?view=&date=&month=&from=&to=&staff= — staff attendance: daily register, monthly sheet, any date range
 * (one staff member gives the time in/out report), late arrivals, machine imports.
 */
export const Route = createFileRoute("/_app/hr/attendance")({
  validateSearch: (s: Record<string, unknown>): AttendanceSearch => ({
    ...(VIEWS.includes(s.view as AttendanceView) ? { view: s.view as AttendanceView } : {}),
    ...(isDate(s.date) ? { date: s.date } : {}),
    ...(typeof s.month === "string" && /^\d{4}-\d{2}$/.test(s.month) ? { month: s.month } : {}),
    ...(isDate(s.from) ? { from: s.from } : {}),
    ...(isDate(s.to) ? { to: s.to } : {}),
    ...(typeof s.staff === "string" && s.staff ? { staff: s.staff } : {}),
  }),
  component: function AttendanceRoute() {
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    return <StaffAttendancePage search={search} setSearch={(next) => void navigate({ search: (prev) => ({ ...prev, view: next.view, date: next.date, month: next.month, from: next.from, to: next.to, staff: next.staff }) })} />;
  },
});
