import { createFileRoute } from "@tanstack/react-router";
import { UniversityPage, type UniversitySearch } from "../../../features/exams/UniversityPage";

const TABS = ["marks", "results", "courses", "sheet", "transcript"] as const;
const SHEETS = ["mid", "final", "course", "award"] as const;

export const Route = createFileRoute("/_app/exams/university")({
  validateSearch: (s: Record<string, unknown>): UniversitySearch => ({
    ...(typeof s.semester === "string" && s.semester ? { semester: s.semester } : {}),
    ...(TABS.includes(s.tab as (typeof TABS)[number]) ? { tab: s.tab as UniversitySearch["tab"] } : {}),
    ...(typeof s.course === "string" && s.course ? { course: s.course } : {}),
    ...(typeof s.student === "string" && s.student ? { student: s.student } : {}),
    ...(SHEETS.includes(s.sheet as (typeof SHEETS)[number]) ? { sheet: s.sheet as UniversitySearch["sheet"] } : {}),
    ...(s.view === "transcript" || s.view === "history" ? { view: s.view } : {}),
  }),
  component: function UniversityRoute() {
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    return (
      <UniversityPage
        search={search}
        onSearch={(next) =>
          void navigate({ search: (prev) => ({ ...prev, semester: next.semester, tab: next.tab, course: next.course, student: next.student, sheet: next.sheet, view: next.view }), replace: true })
        }
      />
    );
  },
});
