import { createFileRoute } from "@tanstack/react-router";
import { RequireAny, TeachersPage } from "../../../features/setup";

export const Route = createFileRoute("/_app/setup/teachers")({
  component: () => (
    <RequireAny any={["setup.manage", "setup.campus"]} page="Teacher allotment">
      <TeachersPage />
    </RequireAny>
  ),
});
