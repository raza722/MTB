import { createFileRoute } from "@tanstack/react-router";
import { WeeklyPeriodsPage } from "../../../features/timetable";

/** /timetable/weekly — periods a week per subject per class against the timetable, and teaching load. */
export const Route = createFileRoute("/_app/timetable/weekly")({ component: WeeklyPeriodsPage });
