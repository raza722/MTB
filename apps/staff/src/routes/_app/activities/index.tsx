import { createFileRoute } from "@tanstack/react-router";
import { RequirePermission } from "../../../app/shell/page";
import { OverviewPage } from "../../../features/activities";

export const Route = createFileRoute("/_app/activities/")({
  component: () => (
    <RequirePermission permission="activities.view" page="Scholarships and activities">
      <OverviewPage />
    </RequirePermission>
  ),
});
