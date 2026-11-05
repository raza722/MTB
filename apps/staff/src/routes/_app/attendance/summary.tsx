import { createFileRoute } from "@tanstack/react-router";
import { SummaryPage } from "../../../features/attendance";

/** /attendance/summary — today, the last two weeks, month by month, by class or campus. */
export const Route = createFileRoute("/_app/attendance/summary")({ component: SummaryPage });
