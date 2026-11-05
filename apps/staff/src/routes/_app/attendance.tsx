import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RequirePermission } from "../../app/shell/page";

/** /attendance — today's registers, class registers, monthly sheets, reports, absentees, the school calendar and the summary. */
export const Route = createFileRoute("/_app/attendance")({
  component: () => (
    <RequirePermission permission="attendance.view" page="Attendance">
      <Outlet />
    </RequirePermission>
  ),
});
