import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RequirePermission } from "../../app/shell/page";

/** /transport — riders with the transport fee sent to Fees, routes and stops with route sheets, vehicles and papers, trips and fuel. */
export const Route = createFileRoute("/_app/transport")({
  component: () => (
    <RequirePermission permission="transport.view" page="Transport">
      <Outlet />
    </RequirePermission>
  ),
});
