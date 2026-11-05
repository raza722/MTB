import { createFileRoute } from "@tanstack/react-router";
import { RequirePermission } from "../../../app/shell/page";
import { SchemesPage } from "../../../features/activities";

export const Route = createFileRoute("/_app/activities/schemes")({
  component: () => (
    <RequirePermission permission="activities.view" page="Scholarship schemes">
      <SchemesPage />
    </RequirePermission>
  ),
});
