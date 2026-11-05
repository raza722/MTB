import { createFileRoute } from "@tanstack/react-router";
import { TrialBalancePage, type TrialDepth, type TrialSearch } from "../../../features/accounts";

const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
const DEPTHS: TrialDepth[] = ["1", "2", "3", "4", "5"];

/** /accounts/trial-balance — the trial balance at a date, with the movement for a period and a roll-up level. */
export const Route = createFileRoute("/_app/accounts/trial-balance")({
  validateSearch: (s: Record<string, unknown>): TrialSearch => {
    const from = date(s.from);
    const asOf = date(s.asOf);
    const depth = String(s.depth ?? "");
    return {
      ...(from ? { from } : {}),
      ...(asOf ? { asOf } : {}),
      ...(DEPTHS.includes(depth as TrialDepth) ? { depth: depth as TrialDepth } : {}),
      ...(s.view === "movement" || s.view === "period" ? { view: s.view } : {}),
    };
  },
  component: function TrialRoute() {
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    return <TrialBalancePage search={search} setSearch={(next) => void navigate({ search: next as never })} />;
  },
});
