import { createFileRoute } from "@tanstack/react-router";
import { HrSettingsPage } from "../../../features/hr";

/** /hr/settings — designations, departments, leave and loan types, increment table, payroll by campus. */
export const Route = createFileRoute("/_app/hr/settings")({ component: HrSettingsPage });
