import { createFileRoute } from "@tanstack/react-router";
import { HistoryPage } from "../../../features/exams/HistoryPage";
import { idParam } from "../../../app/search";

export const Route = createFileRoute("/_app/exams/history")({
  validateSearch: (s: Record<string, unknown>): { id?: string } => (idParam(s.id) ? { id: idParam(s.id)! } : {}),
  component: function HistoryRoute() {
    const { id } = Route.useSearch();
    const navigate = Route.useNavigate();
    return <HistoryPage id={id} onPick={(next) => void navigate({ search: (prev) => ({ ...prev, id: next }) })} />;
  },
});
