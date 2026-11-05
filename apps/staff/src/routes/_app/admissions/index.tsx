import { createFileRoute, redirect } from "@tanstack/react-router";
import { AdmissionsPage } from "../../../features/admissions";

interface OverviewSearch {
  view?: "table";
  /** Applicant open in the side panel. */
  applicant?: string;
}

export const Route = createFileRoute("/_app/admissions/")({
  validateSearch: (s: Record<string, unknown>): OverviewSearch & { tab?: string; cls?: string } => ({
    ...(s.view === "table" ? { view: "table" as const } : {}),
    ...(typeof s.applicant === "string" && s.applicant ? { applicant: s.applicant } : {}),
    ...(typeof s.tab === "string" ? { tab: s.tab } : {}),
    ...(typeof s.cls === "string" ? { cls: s.cls } : {}),
  }),
  // Old links (?tab=merit, ?tab=duplicates) open the pages that replaced the tabs.
  beforeLoad: ({ search }) => {
    if (search.tab === "merit") throw redirect({ to: "/admissions/merit", search: (prev: Record<string, unknown>) => ({ ...prev, tab: undefined, ...(search.cls ? { cls: search.cls } : {}) }) } as never);
    if (search.tab === "duplicates") throw redirect({ to: "/admissions/duplicates", search: (prev: Record<string, unknown>) => ({ ...prev, tab: undefined }) } as never);
  },
  component: function AdmissionsRoute() {
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    return (
      <AdmissionsPage
        view={search.view ?? "board"}
        applicant={search.applicant ?? ""}
        onChange={(patch) =>
          void navigate({
            replace: true,
            search: (prev) => ({
              ...prev,
              ...("view" in patch ? { view: patch.view === "table" ? ("table" as const) : undefined } : {}),
              ...("applicant" in patch ? { applicant: patch.applicant || undefined } : {}),
            }),
          })
        }
      />
    );
  },
});
