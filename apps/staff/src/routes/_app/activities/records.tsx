import { createFileRoute } from "@tanstack/react-router";
import { RequirePermission } from "../../../app/shell/page";
import { RecordsPage } from "../../../features/activities";

/** /activities/records — a student's co-curricular record; ?student=<G.R. number>. */
export const Route = createFileRoute("/_app/activities/records")({
  validateSearch: (s: Record<string, unknown>): { student?: string } => (typeof s.student === "string" && s.student ? { student: s.student.toUpperCase() } : {}),
  component: function RecordsRoute() {
    const { student } = Route.useSearch();
    const navigate = Route.useNavigate();
    return (
      <RequirePermission permission="activities.view" page="Student records">
        <RecordsPage studentId={student} onStudent={(id) => void navigate({ search: (prev) => ({ ...prev, student: id }) })} />
      </RequirePermission>
    );
  },
});
