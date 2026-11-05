import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RequirePermission } from "../../app/shell/page";

/** /warehouse — store stock, goods received, issues and returns, stock counts with approval, the book shop, items and suppliers. */
export const Route = createFileRoute("/_app/warehouse")({
  component: () => (
    <RequirePermission permission="warehouse.view" page="Warehouse">
      <Outlet />
    </RequirePermission>
  ),
});
