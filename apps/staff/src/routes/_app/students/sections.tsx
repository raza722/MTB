import { createFileRoute } from "@tanstack/react-router";
import { SectionsPage } from "../../../features/students/sections/SectionsPage";
import { idParam } from "../../../app/search";

export const Route = createFileRoute("/_app/students/sections")({
  // Any class: real ones include "Play", "SY" and "BS-Chemistry", which the old "Prep or a number" pattern dropped.
  validateSearch: (s: Record<string, unknown>): { cls?: string } => (idParam(s.cls) ? { cls: idParam(s.cls)! } : {}),
  component: function SectionsRoute() {
    const { cls } = Route.useSearch();
    const navigate = Route.useNavigate();
    // Picking a class keeps the page where it is.
    return <SectionsPage cls={cls ?? ""} setCls={(next) => navigate({ resetScroll: false, search: (prev) => ({ ...prev, cls: next || undefined }), replace: true })} />;
  },
});
