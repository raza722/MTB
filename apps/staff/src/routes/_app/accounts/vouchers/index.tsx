import type { AccountsStatusFilter, AccountsTypeFilter } from "@mtb/api";
import { createFileRoute } from "@tanstack/react-router";
import { VouchersPage, type VouchersSearch } from "../../../../features/accounts";

const TYPES: AccountsTypeFilter[] = ["ALL", "MANUAL", "SYSTEM", "JV", "CP", "CR", "BP", "BR", "FEE", "FEE_CANCEL", "OPENING"];
const STATUSES: AccountsStatusFilter[] = ["ALL", "DRAFT", "SUBMITTED", "APPROVED", "POSTED", "REVERSED"];
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

/** /accounts/vouchers — every voucher, with filters. */
export const Route = createFileRoute("/_app/accounts/vouchers/")({
  validateSearch: (s: Record<string, unknown>): VouchersSearch => {
    const out: VouchersSearch = {};
    if (TYPES.includes(s.type as AccountsTypeFilter)) out.type = s.type as AccountsTypeFilter;
    if (STATUSES.includes(s.status as AccountsStatusFilter)) out.status = s.status as AccountsStatusFilter;
    const from = date(s.from);
    if (from) out.from = from;
    const to = date(s.to);
    if (to) out.to = to;
    const q = str(s.q);
    if (q) out.q = q;
    const account = str(s.account);
    if (account) out.account = account;
    const page = Number(s.page);
    if (Number.isInteger(page) && page > 1) out.page = page;
    return out;
  },
  component: function VouchersRoute() {
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    return <VouchersPage search={search} setSearch={(next) => void navigate({ search: next as never })} />;
  },
});
