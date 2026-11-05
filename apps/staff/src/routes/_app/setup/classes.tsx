import { createFileRoute } from "@tanstack/react-router";
import { useCan } from "../../../app/session";
import { ClassesPage, RequireAny, type ClassesTab } from "../../../features/setup";

interface ClassesSearch {
  tab?: ClassesTab;
}

export const Route = createFileRoute("/_app/setup/classes")({
  validateSearch: (s: Record<string, unknown>): ClassesSearch => (s.tab === "classes" || s.tab === "sections" || s.tab === "levels" ? { tab: s.tab } : {}),
  component: ClassesRoute,
});

function ClassesRoute() {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  // Campus-level setup (the principal) works on sections; classes are head office's.
  const first: ClassesTab = useCan("setup.manage") ? "classes" : "sections";
  return (
    <RequireAny any={["setup.manage", "setup.campus"]} page="Classes and sections">
      <ClassesPage tab={tab ?? first} onTab={(t) => void navigate({ search: (prev) => ({ ...prev, tab: t === first ? undefined : t }) })} />
    </RequireAny>
  );
}
