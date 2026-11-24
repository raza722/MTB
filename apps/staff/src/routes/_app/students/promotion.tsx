import { createFileRoute } from "@tanstack/react-router";
import { PromotionPage } from "../../../features/students/promotion/PromotionPage";
import { idParam } from "../../../app/search";

export const Route = createFileRoute("/_app/students/promotion")({
  // Any class name: real ones are "Play-White", "Prep-Pearl", "SY-Rushd-II", so the old "9-B" pattern dropped them and
  // a click in the class list showed the first class again (23-Nov-2026).
  validateSearch: (s: Record<string, unknown>): { cls?: string } => (idParam(s.cls) ? { cls: idParam(s.cls)! } : {}),
  component: function PromotionRoute() {
    const { cls } = Route.useSearch();
    const navigate = Route.useNavigate();
    // Picking a class keeps the page where it is; only the decisions table changes.
    return <PromotionPage cls={cls ?? ""} setCls={(next) => navigate({ resetScroll: false, search: (prev) => ({ ...prev, cls: next || undefined }), replace: true })} />;
  },
});
