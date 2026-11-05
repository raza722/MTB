import { createFileRoute } from "@tanstack/react-router";
import { RequirePermission } from "../../../app/shell/page";
import { HousesScreen } from "../../../features/activities";

/** /activities/houses — standings, points table and members of one campus's houses; ?tab=members. */
export const Route = createFileRoute("/_app/activities/houses")({
  validateSearch: (s: Record<string, unknown>): { tab?: "members" } => (s.tab === "members" ? { tab: "members" } : {}),
  component: function HousesRoute() {
    const { tab } = Route.useSearch();
    const navigate = Route.useNavigate();
    return (
      <RequirePermission permission="activities.view" page="Houses">
        <HousesScreen tab={tab ?? "standings"} onTab={(t) => void navigate({ search: (prev) => ({ ...prev, tab: t === "members" ? ("members" as const) : undefined }), replace: true })} />
      </RequirePermission>
    );
  },
});
