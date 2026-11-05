import { createFileRoute } from "@tanstack/react-router";
import { StockPage } from "../../../features/warehouse";

/** /warehouse/stock?status=LOW — stock balance per item, with the stock ledger in a side panel. */
export const Route = createFileRoute("/_app/warehouse/stock")({
  validateSearch: (s: Record<string, unknown>): { status?: "LOW" | "OUT" } => (s.status === "LOW" || s.status === "OUT" ? { status: s.status } : {}),
  component: function StockRoute() {
    const { status } = Route.useSearch();
    const navigate = Route.useNavigate();
    return <StockPage status={status ?? ""} setStatus={(v) => void navigate({ search: (v ? { status: v } : {}) as never, replace: true })} />;
  },
});
