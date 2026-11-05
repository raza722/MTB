import { createFileRoute } from "@tanstack/react-router";
import { SubstitutionsPage } from "../../../features/timetable";

const iso = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

/** /timetable/substitutions — teachers away, their periods to cover, and who is free. */
export const Route = createFileRoute("/_app/timetable/substitutions")({
  validateSearch: (s: Record<string, unknown>): { date?: string } => (iso(s.date) ? { date: iso(s.date)! } : {}),
  component: function SubstitutionsRoute() {
    const { date } = Route.useSearch();
    const navigate = Route.useNavigate();
    return <SubstitutionsPage date={date} onDate={(d) => void navigate({ search: (prev) => ({ ...prev, date: d }) })} />;
  },
});
