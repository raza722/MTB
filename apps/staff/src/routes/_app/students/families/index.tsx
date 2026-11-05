import { createFileRoute } from "@tanstack/react-router";
import { FamiliesPage } from "../../../../features/students/families/FamiliesPage";

export const Route = createFileRoute("/_app/students/families/")({
  validateSearch: (s: Record<string, unknown>): { q?: string } => (typeof s.q === "string" && s.q ? { q: s.q } : {}),
  component: function FamiliesRoute() {
    const { q } = Route.useSearch();
    const navigate = Route.useNavigate();
    return <FamiliesPage q={q ?? ""} setQ={(next) => navigate({ search: (prev) => ({ ...prev, q: next || undefined }), replace: true })} />;
  },
});
