import type { ActivitiesAwardStatus } from "@mtb/api";
import { createFileRoute } from "@tanstack/react-router";
import { RequirePermission } from "../../../app/shell/page";
import { ScholarshipsPage, type ScholarshipsSearch } from "../../../features/activities";

const STATUSES: ActivitiesAwardStatus[] = ["PENDING", "APPROVED", "REJECTED", "ENDED"];

/** /activities/scholarships — awards (?status, ?scheme), ?award=<id> opens one, ?view=renewals the renewal review, ?new=true the proposal form. */
export const Route = createFileRoute("/_app/activities/scholarships")({
  validateSearch: (s: Record<string, unknown>): ScholarshipsSearch => ({
    ...(s.view === "renewals" ? { view: "renewals" as const } : {}),
    // Ids are numeric text ("12"): a typed or pasted link reaches the router as a number.
    ...(typeof s.award === "string" && s.award ? { award: s.award } : typeof s.award === "number" ? { award: String(s.award) } : {}),
    ...(STATUSES.includes(s.status as ActivitiesAwardStatus) ? { status: s.status as ActivitiesAwardStatus } : {}),
    ...(typeof s.scheme === "string" && s.scheme ? { scheme: s.scheme } : typeof s.scheme === "number" ? { scheme: String(s.scheme) } : {}),
    ...(s.new === true || s.new === "true" ? { new: true } : {}),
  }),
  component: function ScholarshipsRoute() {
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    return (
      <RequirePermission permission="activities.view" page="Scholarships">
        <ScholarshipsPage search={search} onSearch={(patch) => void navigate({ search: (prev) => ({ ...prev, ...patch }) })} />
      </RequirePermission>
    );
  },
});
