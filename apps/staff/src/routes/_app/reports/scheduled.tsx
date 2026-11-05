import { createFileRoute } from "@tanstack/react-router";
import { SchedulesPage } from "../../../features/reports";

/** /reports/scheduled — reports sent automatically on a timetable. */
export const Route = createFileRoute("/_app/reports/scheduled")({
  component: SchedulesPage,
});
