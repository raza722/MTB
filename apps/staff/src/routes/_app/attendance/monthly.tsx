import { createFileRoute } from "@tanstack/react-router";
import { MonthlySheetPage, type MonthlySearch } from "../../../features/attendance";

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** /attendance/monthly — students × days for a class and month (printable register). */
export const Route = createFileRoute("/_app/attendance/monthly")({
  validateSearch: (s: Record<string, unknown>): MonthlySearch => {
    const out: MonthlySearch = {};
    const cls = str(s.cls);
    if (cls) out.cls = cls;
    const month = str(s.month);
    if (month && /^\d{4}-\d{2}$/.test(month)) out.month = month;
    return out;
  },
  component: function MonthlyRoute() {
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    return <MonthlySheetPage search={search} setSearch={(next) => void navigate({ search: (prev) => ({ ...prev, cls: next.cls, month: next.month }) })} />;
  },
});
