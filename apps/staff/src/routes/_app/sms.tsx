import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RequirePermission } from "../../app/shell/page";

/** /sms — Messages: overview, compose, outbox, delivery, notices, templates, opt-outs and SMS company settings. */
export const Route = createFileRoute("/_app/sms")({
  component: () => (
    <RequirePermission permission="sms.view" page="Messages">
      <Outlet />
    </RequirePermission>
  ),
});
