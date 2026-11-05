import { createFileRoute } from "@tanstack/react-router";
import { HistoryPage } from "../../../features/exams/HistoryPage";

export const Route = createFileRoute("/_app/exams/history")({
  validateSearch: (s: Record<string, unknown>): { id?: string } => (typeof s.id === "string" && s.id ? { id: s.id } : {}),
  component: function HistoryRoute() {
    const { id } = Route.useSearch();
    const navigate = Route.useNavigate();
    return <HistoryPage id={id} onPick={(next) => void navigate({ search: (prev) => ({ ...prev, id: next }) })} />;
  },
});
