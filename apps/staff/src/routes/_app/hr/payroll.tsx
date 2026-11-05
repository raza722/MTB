import { createFileRoute } from "@tanstack/react-router";
import { PayrollPage, type PayrollSearch } from "../../../features/hr";

/** /hr/payroll?month=&view= — monthly salary sheets (prepare, approve, pay), slips, bank list and salary structures. */
export const Route = createFileRoute("/_app/hr/payroll")({
  validateSearch: (s: Record<string, unknown>): PayrollSearch => ({
    ...(typeof s.month === "string" && /^\d{4}-\d{2}$/.test(s.month) ? { month: s.month } : {}),
    ...(s.view === "structures" || s.view === "sheet" ? { view: s.view } : {}),
  }),
  component: function PayrollRoute() {
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    return <PayrollPage search={search} setSearch={(next) => void navigate({ search: (prev) => ({ ...prev, month: next.month, view: next.view }) })} />;
  },
});
