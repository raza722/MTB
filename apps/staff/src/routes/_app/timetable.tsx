import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RequirePermission } from "../../app/shell/page";

/** /timetable — class and teacher timetables, cover for absent teachers, periods per subject and bell timings. */
export const Route = createFileRoute("/_app/timetable")({
  component: () => (
    <RequirePermission permission="timetable.view" page="Timetable">
      <Outlet />
    </RequirePermission>
  ),
});
