import { createFileRoute } from "@tanstack/react-router";
import { MonthlyReport } from "../../../../features/fees/reports/MonthlyReport";

export const Route = createFileRoute("/_app/fees/reports/monthly")({ component: MonthlyReport });
