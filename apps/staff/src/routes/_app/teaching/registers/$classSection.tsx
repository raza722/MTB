import { createFileRoute } from "@tanstack/react-router";
import { RegisterPage } from "../../../../features/teaching";

const iso = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

/** /teaching/registers/7-B?date= — one register: today's to mark, or an earlier day (change requests only). */
export const Route = createFileRoute("/_app/teaching/registers/$classSection")({
  validateSearch: (s: Record<string, unknown>): { date?: string } => (iso(s.date) ? { date: iso(s.date)! } : {}),
  component: function TeachingRegisterRoute() {
    const { classSection } = Route.useParams();
    const { date } = Route.useSearch();
    return <RegisterPage key={`${classSection}|${date ?? "today"}`} classSection={classSection} {...(date ? { date } : {})} />;
  },
});
