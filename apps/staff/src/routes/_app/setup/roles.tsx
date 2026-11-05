import { createFileRoute } from "@tanstack/react-router";
import { RequireAny, RolesPage } from "../../../features/setup";

export const Route = createFileRoute("/_app/setup/roles")({
  component: () => (
    <RequireAny any={["setup.manage", "users.manage"]} page="Roles and permissions">
      <RolesPage />
    </RequireAny>
  ),
});
