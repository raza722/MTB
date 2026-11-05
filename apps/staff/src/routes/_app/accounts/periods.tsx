import { createFileRoute } from "@tanstack/react-router";
import { PeriodsPage } from "../../../features/accounts";

/** /accounts/periods — month close. */
export const Route = createFileRoute("/_app/accounts/periods")({ component: PeriodsPage });
