import { createFileRoute } from "@tanstack/react-router";
import { SectionsPage } from "../../../features/students/sections/SectionsPage";

export const Route = createFileRoute("/_app/students/sections")({
  validateSearch: (s: Record<string, unknown>): { cls?: string } => (typeof s.cls === "string" && /^(Prep|\d{1,2})$/.test(s.cls) ? { cls: s.cls } : {}),
  component: function SectionsRoute() {
    const { cls } = Route.useSearch();
    const navigate = Route.useNavigate();
    return <SectionsPage cls={cls ?? ""} setCls={(next) => navigate({ search: (prev) => ({ ...prev, cls: next || undefined }), replace: true })} />;
  },
});
