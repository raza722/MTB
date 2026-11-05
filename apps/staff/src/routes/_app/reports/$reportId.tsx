import { createFileRoute } from "@tanstack/react-router";
import { ReportViewerPage, type ViewerSearch } from "../../../features/reports";

/** /reports/:reportId — one report: filters, on-screen result, chart, export, schedule. */
export const Route = createFileRoute("/_app/reports/$reportId")({
  validateSearch: (s: Record<string, unknown>): ViewerSearch => ({
    ...(typeof s.job === "string" && s.job ? { job: s.job } : {}),
    ...(s.print === 1 || s.print === "1" ? { print: 1 as const } : {}),
    // Starting filters carried by a module page's "Open as report" link (strings only).
    ...(s.f && typeof s.f === "object" && !Array.isArray(s.f) ? { f: Object.fromEntries(Object.entries(s.f as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string")) } : {}),
  }),
  component: function ReportRoute() {
    const { reportId } = Route.useParams();
    const navigate = Route.useNavigate();
    return <ReportViewerPage reportId={reportId} search={Route.useSearch()} setSearch={(next) => void navigate({ search: next as never })} />;
  },
});
