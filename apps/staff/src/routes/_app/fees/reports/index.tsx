import { createFileRoute } from "@tanstack/react-router";
import { ReportsPage } from "../../../../features/fees/reports/ReportsPage";

/** /fees/reports — the fee office's report catalogue with today's figures. */
export const Route = createFileRoute("/_app/fees/reports/")({ component: ReportsPage });
