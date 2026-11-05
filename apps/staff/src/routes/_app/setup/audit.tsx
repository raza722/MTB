import { createFileRoute } from "@tanstack/react-router";
import { AuditPage, RequireAny } from "../../../features/setup";

export const Route = createFileRoute("/_app/setup/audit")({
  component: () => (
    <RequireAny any={["setup.manage", "users.manage"]} page="the audit log">
      <AuditPage />
    </RequireAny>
  ),
});
