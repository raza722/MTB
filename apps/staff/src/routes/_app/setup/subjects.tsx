import { createFileRoute } from "@tanstack/react-router";
import { RequirePermission } from "../../../app/shell/page";
import { SubjectsPage, type SubjectsTab } from "../../../features/setup";

interface SubjectsSearch {
  tab?: SubjectsTab;
}

export const Route = createFileRoute("/_app/setup/subjects")({
  validateSearch: (s: Record<string, unknown>): SubjectsSearch => (s.tab === "subjects" || s.tab === "groups" ? { tab: s.tab } : {}),
  component: SubjectsRoute,
});

function SubjectsRoute() {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <RequirePermission permission="setup.manage" page="Subjects and marks">
      <SubjectsPage tab={tab ?? "classes"} onTab={(t) => void navigate({ search: (prev) => ({ ...prev, tab: t === "classes" ? undefined : t }) })} />
    </RequirePermission>
  );
}
