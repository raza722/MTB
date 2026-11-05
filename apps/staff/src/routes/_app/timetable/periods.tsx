import { createFileRoute } from "@tanstack/react-router";
import { PeriodsPage } from "../../../features/timetable";

/** /timetable/periods — bell timings per campus (normal and winter), with Friday's short day. */
export const Route = createFileRoute("/_app/timetable/periods")({ component: PeriodsPage });
