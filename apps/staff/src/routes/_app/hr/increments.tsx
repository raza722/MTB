import { createFileRoute } from "@tanstack/react-router";
import { IncrementsPage } from "../../../features/hr";

/** /hr/increments?run= — annual and special increment runs: prepare, approve, apply. */
export const Route = createFileRoute("/_app/hr/increments")({
  validateSearch: (s: Record<string, unknown>): { run?: string } => (typeof s.run === "string" && s.run ? { run: s.run } : {}),
  component: function IncrementsRoute() {
    const { run } = Route.useSearch();
    const navigate = Route.useNavigate();
    return <IncrementsPage runId={run} setRunId={(id) => void navigate({ search: (prev) => ({ ...prev, run: id }) })} />;
  },
});
