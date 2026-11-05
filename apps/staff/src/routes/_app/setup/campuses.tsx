import { createFileRoute } from "@tanstack/react-router";
import { CampusesPage, RequireAny } from "../../../features/setup";

export const Route = createFileRoute("/_app/setup/campuses")({
  component: () => (
    <RequireAny any={["setup.manage", "setup.campus"]} page="Campuses">
      <CampusesPage />
    </RequireAny>
  ),
});
