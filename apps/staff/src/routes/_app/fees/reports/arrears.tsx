import { createFileRoute } from "@tanstack/react-router";
import { ArrearsReport } from "../../../../features/fees/reports/ArrearsReport";

export const Route = createFileRoute("/_app/fees/reports/arrears")({ component: ArrearsReport });
