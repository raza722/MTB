import { createFileRoute } from "@tanstack/react-router";
import { BankRecPage, type BankSearch } from "../../../features/accounts";

/** /accounts/bank — bank reconciliation. */
export const Route = createFileRoute("/_app/accounts/bank")({
  validateSearch: (s: Record<string, unknown>): BankSearch => ({
    ...(typeof s.account === "string" && /^\d{4}$/.test(s.account) ? { account: s.account } : typeof s.account === "number" ? { account: String(s.account) } : {}),
    ...(typeof s.month === "string" && /^\d{4}-\d{2}$/.test(s.month) ? { month: s.month } : {}),
  }),
  component: function BankRoute() {
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    return <BankRecPage search={search} setSearch={(next) => void navigate({ search: next as never })} />;
  },
});
