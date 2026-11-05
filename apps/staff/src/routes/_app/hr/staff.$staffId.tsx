import { createFileRoute } from "@tanstack/react-router";
import { StaffProfilePage, type ProfileTab } from "../../../features/hr";

const TABS: ProfileTab[] = ["overview", "employment", "qualifications", "pay", "leave", "documents", "history"];

/** /hr/staff/$staffId?tab= — one staff member's file. */
export const Route = createFileRoute("/_app/hr/staff/$staffId")({
  validateSearch: (s: Record<string, unknown>): { tab?: ProfileTab } => (TABS.includes(s.tab as ProfileTab) ? { tab: s.tab as ProfileTab } : {}),
  component: function StaffProfileRoute() {
    const { staffId } = Route.useParams();
    const { tab } = Route.useSearch();
    const navigate = Route.useNavigate();
    return <StaffProfilePage key={staffId} staffId={staffId} tab={tab ?? "overview"} setTab={(t) => void navigate({ search: (prev) => ({ ...prev, tab: t === "overview" ? undefined : t }), replace: true })} />;
  },
});
