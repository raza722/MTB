import { createFileRoute } from "@tanstack/react-router";
import { PROFILE_TABS, StudentProfilePage, type ProfileTab } from "../../../features/students/StudentProfilePage";

export const Route = createFileRoute("/_app/students/$grNo")({
  validateSearch: (s: Record<string, unknown>): { tab?: ProfileTab } => (PROFILE_TABS.includes(s.tab as ProfileTab) ? { tab: s.tab as ProfileTab } : {}),
  component: function ProfileRoute() {
    const { grNo } = Route.useParams();
    const { tab } = Route.useSearch();
    const navigate = Route.useNavigate();
    return <StudentProfilePage grNo={grNo.toUpperCase()} tab={tab ?? "enrolment"} setTab={(t) => navigate({ search: (prev) => ({ ...prev, tab: t === "enrolment" ? undefined : t }), replace: true })} />;
  },
});
