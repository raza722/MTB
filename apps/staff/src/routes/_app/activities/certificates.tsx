import { createFileRoute } from "@tanstack/react-router";
import { RequirePermission } from "../../../app/shell/page";
import { CertificatesPage } from "../../../features/activities";

/** /activities/certificates — issue and reprint certificates; ?event=<id> preselects an event. */
export const Route = createFileRoute("/_app/activities/certificates")({
  validateSearch: (s: Record<string, unknown>): { event?: string } => (typeof s.event === "string" && s.event ? { event: s.event } : {}),
  component: function CertificatesRoute() {
    const { event } = Route.useSearch();
    const navigate = Route.useNavigate();
    return (
      <RequirePermission permission="activities.view" page="Certificates">
        <CertificatesPage eventId={event} onEvent={(id) => void navigate({ search: (prev) => ({ ...prev, event: id }), replace: true })} />
      </RequirePermission>
    );
  },
});
