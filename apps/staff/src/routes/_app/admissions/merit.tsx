import { createFileRoute } from "@tanstack/react-router";
import { MeritPage } from "../../../features/admissions";

export const Route = createFileRoute("/_app/admissions/merit")({
  validateSearch: (s: Record<string, unknown>): { cls?: string } => (typeof s.cls === "string" && s.cls ? { cls: s.cls } : {}),
  component: function MeritRoute() {
    const { cls } = Route.useSearch();
    const navigate = Route.useNavigate();
    return <MeritPage cls={cls ?? ""} setCls={(c) => navigate({ search: (prev) => ({ ...prev, cls: c || undefined }), replace: true })} />;
  },
});
