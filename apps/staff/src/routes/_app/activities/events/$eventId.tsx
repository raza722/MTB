import { createFileRoute } from "@tanstack/react-router";
import { RequirePermission } from "../../../../app/shell/page";
import { EventDetailPage } from "../../../../features/activities";

/** /activities/events/<id> — one event: names, results, house points and certificates. */
export const Route = createFileRoute("/_app/activities/events/$eventId")({
  component: function EventRoute() {
    const { eventId } = Route.useParams();
    return (
      <RequirePermission permission="activities.view" page="Event">
        <EventDetailPage key={eventId} id={eventId} />
      </RequirePermission>
    );
  },
});
