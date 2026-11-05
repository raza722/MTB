import { createFileRoute } from "@tanstack/react-router";
import { RequireAny, SetupHome } from "../../../features/setup";

export const Route = createFileRoute("/_app/setup/")({
  component: () => (
    <RequireAny any={["setup.manage", "setup.campus", "users.manage"]} page="Setup">
      <SetupHome />
    </RequireAny>
  ),
});
