import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RequirePermission } from "../../app/shell/page";

/** /reports — the report centre: every report across modules, downloads and scheduled reports. */
export const Route = createFileRoute("/_app/reports")({
  component: () => (
    <RequirePermission permission="reports.view" page="Reports">
      <Outlet />
    </RequirePermission>
  ),
});
