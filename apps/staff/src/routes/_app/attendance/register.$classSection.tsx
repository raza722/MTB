import { createFileRoute } from "@tanstack/react-router";
import { RegisterPage } from "../../../features/attendance";

const iso = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

/** /attendance/register/7-B?date= — one class's register for a day. */
export const Route = createFileRoute("/_app/attendance/register/$classSection")({
  validateSearch: (s: Record<string, unknown>): { date?: string } => (iso(s.date) ? { date: iso(s.date)! } : {}),
  component: function RegisterRoute() {
    const { classSection } = Route.useParams();
    const { date } = Route.useSearch();
    const navigate = Route.useNavigate();
    return <RegisterPage key={`${classSection}|${date ?? ""}`} classSection={classSection} date={date} onDate={(d) => void navigate({ search: (prev) => ({ ...prev, date: d }) })} />;
  },
});
