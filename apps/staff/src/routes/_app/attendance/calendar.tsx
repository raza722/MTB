import { createFileRoute } from "@tanstack/react-router";
import { CalendarPage } from "../../../features/attendance";

/** /attendance/calendar — public holidays, vacations, exams and school events; closed days close registers. */
export const Route = createFileRoute("/_app/attendance/calendar")({ component: CalendarPage });
