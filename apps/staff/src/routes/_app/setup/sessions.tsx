import { createFileRoute } from "@tanstack/react-router";
import { RequirePermission } from "../../../app/shell/page";
import { SessionsPage } from "../../../features/setup";

export const Route = createFileRoute("/_app/setup/sessions")({
  component: () => (
    <RequirePermission permission="setup.manage" page="Academic sessions">
      <SessionsPage />
    </RequirePermission>
  ),
});
