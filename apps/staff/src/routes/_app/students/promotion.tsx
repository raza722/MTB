import { createFileRoute } from "@tanstack/react-router";
import { PromotionPage } from "../../../features/students/promotion/PromotionPage";

export const Route = createFileRoute("/_app/students/promotion")({
  validateSearch: (s: Record<string, unknown>): { cls?: string } => (typeof s.cls === "string" && /^(Prep|\d{1,2})-[A-Z]$/.test(s.cls) ? { cls: s.cls } : {}),
  component: function PromotionRoute() {
    const { cls } = Route.useSearch();
    const navigate = Route.useNavigate();
    return <PromotionPage cls={cls ?? ""} setCls={(next) => navigate({ search: (prev) => ({ ...prev, cls: next || undefined }), replace: true })} />;
  },
});
