import type { AccountsManualType } from "@mtb/api";
import { createFileRoute } from "@tanstack/react-router";
import { VoucherPage, type Prefill } from "../../../../features/accounts";

interface VoucherSearch extends Prefill {
  /** For a new voucher: JV, CP, CR, BP or BR. */
  type?: AccountsManualType;
}

const TYPES: AccountsManualType[] = ["JV", "CP", "CR", "BP", "BR"];
const str = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? String(v) : typeof v === "string" && v.trim() ? v.trim().slice(0, 160) : undefined);

/** /accounts/vouchers/$voucherId — one voucher; "new" starts one (the bank reconciliation can fill some fields in). */
export const Route = createFileRoute("/_app/accounts/vouchers/$voucherId")({
  validateSearch: (s: Record<string, unknown>): VoucherSearch => {
    const out: VoucherSearch = {};
    if (TYPES.includes(s.type as AccountsManualType)) out.type = s.type as AccountsManualType;
    if (typeof s.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.date)) out.date = s.date;
    const amount = Number(s.amount);
    if (Number.isSafeInteger(amount) && amount > 0) out.amount = amount;
    for (const k of ["narration", "account", "contra", "party", "reference"] as const) {
      const v = str(s[k]);
      if (v) out[k] = v;
    }
    if (s.inflow === 1 || s.inflow === "1" || s.inflow === true) out.inflow = true;
    return out;
  },
  component: function VoucherRoute() {
    const { voucherId } = Route.useParams();
    const { type, ...prefill } = Route.useSearch();
    return <VoucherPage voucherId={voucherId} type={type ?? "JV"} prefill={prefill} />;
  },
});
