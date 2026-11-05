import { createFileRoute } from "@tanstack/react-router";
import { RequirePermission } from "../../../app/shell/page";
import { CampusSettingsPage } from "../../../features/setup";

export const Route = createFileRoute("/_app/setup/campus-settings")({
  component: () => (
    <RequirePermission permission="settings.manage" page="Campus settings">
      <CampusSettingsPage />
    </RequirePermission>
  ),
});
