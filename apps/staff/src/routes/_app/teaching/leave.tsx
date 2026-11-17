import { createFileRoute } from "@tanstack/react-router";
import { RequirePermission } from "../../../app/shell/page";
import { LeavePage } from "../../../features/teaching";

/** /teaching/leave — the teacher's own leave and attendance. Needs teacher.leave: in the old software the office recorded staff leave. */
export const Route = createFileRoute("/_app/teaching/leave")({
  component: function TeachingLeaveRoute() {
    return (
      <RequirePermission permission="teacher.leave" page="Leave">
        <LeavePage />
      </RequirePermission>
    );
  },
});
