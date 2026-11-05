import { createFileRoute } from "@tanstack/react-router";
import { LedgerPage, type LedgerSearch } from "../../../features/accounts";

const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

/** /accounts/ledger — one account's ledger (or every bank account together) with a running balance. */
export const Route = createFileRoute("/_app/accounts/ledger")({
  validateSearch: (s: Record<string, unknown>): LedgerSearch => {
    const out: LedgerSearch = {};
    // An account code (sub-group accounts run to 6 digits or more), or BANK for every bank account in one book.
    if (typeof s.account === "string" && (/^\d{1,10}$/.test(s.account) || s.account === "BANK")) out.account = s.account;
    else if (typeof s.account === "number") out.account = String(s.account);
    const from = date(s.from);
    if (from) out.from = from;
    const to = date(s.to);
    if (to) out.to = to;
    return out;
  },
  component: function LedgerRoute() {
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    return <LedgerPage search={search} setSearch={(next) => void navigate({ search: next as never })} />;
  },
});
