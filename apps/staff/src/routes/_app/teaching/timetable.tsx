import { createFileRoute } from "@tanstack/react-router";
import { TimetablePage } from "../../../features/teaching";

/** /teaching/timetable — the teacher's own week. */
export const Route = createFileRoute("/_app/teaching/timetable")({ component: TimetablePage });
