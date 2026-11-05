import { createFileRoute } from "@tanstack/react-router";
import { RequirePermission } from "../../../../app/shell/page";
import { EventsPage, type EventsView } from "../../../../features/activities";

interface EventsSearch {
  view?: EventsView;
  month?: string;
  new?: boolean;
}

/** /activities/events — calendar (?month=2026-11), ?view=list or catalogue, ?new=true opens the add-event form. */
export const Route = createFileRoute("/_app/activities/events/")({
  validateSearch: (s: Record<string, unknown>): EventsSearch => ({
    ...(s.view === "list" || s.view === "catalogue" ? { view: s.view } : {}),
    ...(typeof s.month === "string" && /^\d{4}-\d{2}$/.test(s.month) ? { month: s.month } : {}),
    ...(s.new === true || s.new === "true" ? { new: true } : {}),
  }),
  component: function EventsRoute() {
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    return (
      <RequirePermission permission="activities.view" page="Events">
        <EventsPage view={search.view ?? "calendar"} month={search.month} creating={Boolean(search.new)} onSearch={(patch) => void navigate({ search: (prev) => ({ ...prev, ...patch }) })} />
      </RequirePermission>
    );
  },
});
