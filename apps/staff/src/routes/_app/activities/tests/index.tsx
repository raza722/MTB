import { createFileRoute } from "@tanstack/react-router";
import { RequirePermission } from "../../../../app/shell/page";
import { TestsPage } from "../../../../features/activities";

/** /activities/tests — scholarship tests and merit lists; ?new=true opens the new test form. */
export const Route = createFileRoute("/_app/activities/tests/")({
  validateSearch: (s: Record<string, unknown>): { new?: boolean } => (s.new === true || s.new === "true" ? { new: true } : {}),
  component: function TestsRoute() {
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    return (
      <RequirePermission permission="activities.view" page="Scholarship tests">
        <TestsPage creating={Boolean(search.new)} onCreating={(open) => void navigate({ search: (prev) => ({ ...prev, new: open ? true : undefined }) })} />
      </RequirePermission>
    );
  },
});
