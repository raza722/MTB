import { REPORT_MODULES, type ReportModule } from "@mtb/api";
import { createFileRoute } from "@tanstack/react-router";
import { CataloguePage, type CatalogueSearch } from "../../../features/reports";

/** /reports — the catalogue: search, favourites, module filter. */
export const Route = createFileRoute("/_app/reports/")({
  validateSearch: (s: Record<string, unknown>): CatalogueSearch => ({
    ...(typeof s.q === "string" && s.q ? { q: s.q } : {}),
    ...(typeof s.module === "string" && (REPORT_MODULES as string[]).includes(s.module) ? { module: s.module as ReportModule } : {}),
    ...(s.show === "fav" || s.show === "recent" || s.show === "new" || s.show === "fixed" ? { show: s.show } : {}),
  }),
  component: function CatalogueRoute() {
    const navigate = Route.useNavigate();
    return <CataloguePage search={Route.useSearch()} setSearch={(next) => void navigate({ search: Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined && v !== "")) as never, replace: true })} />;
  },
});
