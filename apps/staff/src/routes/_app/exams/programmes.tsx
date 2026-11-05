import { createFileRoute } from "@tanstack/react-router";
import { ProgrammesPage, type ProgrammesSearch } from "../../../features/exams/ProgrammesPage";

export const Route = createFileRoute("/_app/exams/programmes")({
  validateSearch: (s: Record<string, unknown>): ProgrammesSearch => ({
    ...(typeof s.programme === "string" && s.programme ? { programme: s.programme } : {}),
    ...(s.tab === "participants" || s.tab === "print" ? { tab: s.tab } : {}),
    ...(s.doc === "list" || s.doc === "sheet" || s.doc === "top" ? { doc: s.doc } : {}),
    ...(typeof s.centre === "string" && s.centre ? { centre: s.centre } : {}),
  }),
  component: function ProgrammesRoute() {
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    return <ProgrammesPage search={search} onSearch={(next) => void navigate({ search: () => next, replace: true })} />;
  },
});
