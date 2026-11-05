import { createFileRoute } from "@tanstack/react-router";
import { FeePostingPage, type FeePostingSearch } from "../../../features/accounts";

/** /accounts/fee-posting — daily fee batches and their reconciliation with the fee office. */
export const Route = createFileRoute("/_app/accounts/fee-posting")({
  validateSearch: (s: Record<string, unknown>): FeePostingSearch => ({
    ...(typeof s.month === "string" && /^\d{4}-\d{2}$/.test(s.month) ? { month: s.month } : {}),
    ...(typeof s.batch === "string" && /^(KC|SM|UC|MC|HC):\d{4}-\d{2}-\d{2}$/.test(s.batch) ? { batch: s.batch } : {}),
  }),
  component: function FeePostingRoute() {
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    return <FeePostingPage search={search} setSearch={(next) => void navigate({ search: next as never })} />;
  },
});
