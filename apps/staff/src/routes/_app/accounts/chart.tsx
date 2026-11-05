import { createFileRoute } from "@tanstack/react-router";
import { ChartOfAccountsPage } from "../../../features/accounts";

/** /accounts/chart — the chart of accounts. */
export const Route = createFileRoute("/_app/accounts/chart")({ component: ChartOfAccountsPage });
