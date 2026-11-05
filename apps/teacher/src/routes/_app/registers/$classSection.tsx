import { createFileRoute } from "@tanstack/react-router";
import { RegisterPage } from "../../../features/registers/RegisterPage";

interface RegisterSearch {
  /** An earlier school day (read-only, change requests only). Today when omitted. */
  date?: string;
}

export const Route = createFileRoute("/_app/registers/$classSection")({
  validateSearch: (s: Record<string, unknown>): RegisterSearch => (typeof s.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? { date: s.date } : {}),
  staticData: { hideNav: true },
  component: function RegisterRoute() {
    const { classSection } = Route.useParams();
    const { date } = Route.useSearch();
    return <RegisterPage key={`${classSection}|${date ?? "today"}`} classSection={classSection} {...(date ? { date } : {})} />;
  },
});
