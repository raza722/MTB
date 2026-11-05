import type { SetupUserFilter } from "@mtb/api";
import { createFileRoute } from "@tanstack/react-router";
import { RequirePermission } from "../../../app/shell/page";
import { UsersPage } from "../../../features/setup";

const FILTERS: SetupUserFilter[] = ["ACTIVE", "INVITED", "LOCKED", "DISABLED", "NO_TWO_STEP", "MUST_CHANGE"];

interface UsersSearch {
  filter?: SetupUserFilter;
}

export const Route = createFileRoute("/_app/setup/users")({
  validateSearch: (s: Record<string, unknown>): UsersSearch => (FILTERS.includes(s.filter as SetupUserFilter) ? { filter: s.filter as SetupUserFilter } : {}),
  component: UsersRoute,
});

function UsersRoute() {
  const { filter } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <RequirePermission permission="users.manage" page="Users">
      <UsersPage filter={filter ?? "ALL"} onFilter={(f) => void navigate({ search: (prev) => ({ ...prev, filter: f === "ALL" ? undefined : f }) })} />
    </RequirePermission>
  );
}
