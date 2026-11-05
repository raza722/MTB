import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useCan } from "../../../app/session";
import { FeeCounterPage } from "../../../features/fees/counter/FeeCounterPage";

export const Route = createFileRoute("/_app/fees/counter")({
  validateSearch: (s: Record<string, unknown>): { gr?: string } => (typeof s.gr === "string" && s.gr ? { gr: s.gr.toUpperCase() } : {}),
  component: function CounterRoute() {
    const { gr } = Route.useSearch();
    const navigate = Route.useNavigate();
    const collect = useCan("fees.collect");
    const view = useCan("fees.view");
    // Only the cashier takes payments; other fee office roles land on /fees (reports or vouchers).
    if (!collect && view) return <Navigate to="/fees" replace />;
    return <FeeCounterPage grNo={gr ?? ""} setGr={(next) => navigate({ search: (prev) => ({ ...prev, gr: next }) })} />;
  },
});
