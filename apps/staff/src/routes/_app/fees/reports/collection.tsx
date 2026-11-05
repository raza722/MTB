import type { CampusScope } from "@mtb/api";
import { createFileRoute } from "@tanstack/react-router";
import { CollectionReport, type CollectionSearch } from "../../../../features/fees/reports/CollectionReport";

const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
const CAMPUSES: CampusScope[] = ["ALL", "KC", "SM", "UC", "MC", "HC"];

/**
 * /fees/reports/collection — the daily collection (every receipt). `from`, `to` and `campus` open it on one day's
 * receipts, e.g. from a fee batch line in the accounts cash book.
 */
export const Route = createFileRoute("/_app/fees/reports/collection")({
  validateSearch: (s: Record<string, unknown>): CollectionSearch => {
    const out: CollectionSearch = {};
    const from = date(s.from);
    if (from) out.from = from;
    const to = date(s.to);
    if (to) out.to = to;
    if (typeof s.campus === "string" && CAMPUSES.includes(s.campus as CampusScope)) out.campus = s.campus as CampusScope;
    return out;
  },
  component: function CollectionRoute() {
    const search = Route.useSearch();
    // A new link (another day) starts the report afresh on its dates.
    return <CollectionReport key={`${search.from ?? ""}|${search.to ?? ""}`} search={search} />;
  },
});
