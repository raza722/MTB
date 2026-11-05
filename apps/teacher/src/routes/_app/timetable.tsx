import { createFileRoute } from "@tanstack/react-router";
import { TimetablePage } from "../../features/timetable/TimetablePage";

export const Route = createFileRoute("/_app/timetable")({
  component: TimetablePage,
});
