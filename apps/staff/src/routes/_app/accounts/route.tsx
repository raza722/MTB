import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RequirePermission } from "../../../app/shell/page";

/** /accounts — vouchers, chart of accounts, ledgers, trial balance, statements, fee posting, bank reconciliation, month close. */
export const Route = createFileRoute("/_app/accounts")({
  component: () => (
    <RequirePermission permission="accounts.view" page="Accounts">
      <Outlet />
    </RequirePermission>
  ),
});
