import { createFileRoute } from "@tanstack/react-router";
import { RequirePermission } from "../../../../app/shell/page";
import { TestDetailPage, type TestTab } from "../../../../features/activities";

const TABS: TestTab[] = ["merit", "candidates", "marks", "history"];

/** /activities/tests/<id> — one scholarship test; ?tab= merit | candidates | marks | history. */
export const Route = createFileRoute("/_app/activities/tests/$testId")({
  validateSearch: (s: Record<string, unknown>): { tab?: TestTab } => (TABS.includes(s.tab as TestTab) ? { tab: s.tab as TestTab } : {}),
  component: function TestRoute() {
    const { testId } = Route.useParams();
    const { tab } = Route.useSearch();
    const navigate = Route.useNavigate();
    return (
      <RequirePermission permission="activities.view" page="Scholarship test">
        <TestDetailPage key={testId} id={testId} tab={tab} onTab={(t) => void navigate({ search: (prev) => ({ ...prev, tab: t }), replace: true })} />
      </RequirePermission>
    );
  },
});
