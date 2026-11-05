import { createFileRoute } from "@tanstack/react-router";
import { EnquiriesPage } from "../../../features/admissions";

export const Route = createFileRoute("/_app/admissions/enquiries")({
  validateSearch: (s: Record<string, unknown>): { new?: boolean } => (s.new === true || s.new === "true" ? { new: true } : {}),
  component: function EnquiriesRoute() {
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    return <EnquiriesPage openNew={Boolean(search.new)} setOpenNew={(v) => navigate({ search: (prev) => ({ ...prev, new: v || undefined }), replace: true })} />;
  },
});
