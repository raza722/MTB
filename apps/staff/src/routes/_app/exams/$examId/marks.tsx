import { createFileRoute } from "@tanstack/react-router";
import { MarksEntry, type MarksSearch } from "../../../../features/exams/MarksEntry";

export const Route = createFileRoute("/_app/exams/$examId/marks")({
  validateSearch: (s: Record<string, unknown>): MarksSearch => ({
    ...(typeof s.section === "string" && s.section ? { section: s.section } : {}),
    ...(typeof s.subject === "string" && s.subject ? { subject: s.subject } : {}),
  }),
  component: function MarksRoute() {
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    return <MarksEntry search={search} onSearch={(next) => void navigate({ search: (prev) => ({ ...prev, section: next.section, subject: next.subject }), replace: true })} />;
  },
});
