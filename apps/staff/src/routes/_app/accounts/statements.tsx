import { createFileRoute } from "@tanstack/react-router";
import { StatementsPage, type StatementsSearch } from "../../../features/accounts";

const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

/** /accounts/statements — income and expenditure, and the balance sheet. */
export const Route = createFileRoute("/_app/accounts/statements")({
  validateSearch: (s: Record<string, unknown>): StatementsSearch => {
    const out: StatementsSearch = {};
    if (s.view === "bs") out.view = "bs";
    const from = date(s.from);
    if (from) out.from = from;
    const to = date(s.to);
    if (to) out.to = to;
    const asOf = date(s.asOf);
    if (asOf) out.asOf = asOf;
    return out;
  },
  component: function StatementsRoute() {
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    return <StatementsPage search={search} setSearch={(next) => void navigate({ search: next as never })} />;
  },
});
