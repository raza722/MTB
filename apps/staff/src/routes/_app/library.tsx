import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RequirePermission } from "../../app/shell/page";

/** /library — overview, issue and return desk, catalogue, loans, overdue, member history, stock counts, setup. */
export const Route = createFileRoute("/_app/library")({
  component: () => (
    <RequirePermission permission="library.view" page="Library">
      <Outlet />
    </RequirePermission>
  ),
});
