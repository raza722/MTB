import { createFileRoute } from "@tanstack/react-router";
import { RidersPage } from "../../../features/transport";

/** /transport/riders?route=<id>&assign=1 — who rides which route; assign=1 opens the assign panel. */
export const Route = createFileRoute("/_app/transport/riders")({
  validateSearch: (s: Record<string, unknown>): { route?: string; assign?: 1 } => ({
    ...(typeof s.route === "string" && s.route ? { route: s.route } : {}),
    ...(s.assign === 1 || s.assign === "1" ? { assign: 1 as const } : {}),
  }),
  component: function RidersRoute() {
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    const keep = (patch: { route?: string; assign?: 1 }) => {
      const next = { ...search, ...patch };
      if (!next.route) delete next.route;
      if (!next.assign) delete next.assign;
      void navigate({ search: next as never, replace: true });
    };
    return (
      <RidersPage
        assignOpen={search.assign === 1}
        setAssignOpen={(v) => keep(v ? { assign: 1 } : { assign: undefined as never })}
        routeId={search.route ?? ""}
        setRouteId={(id) => keep({ route: id })}
      />
    );
  },
});
