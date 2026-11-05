import { createFileRoute } from "@tanstack/react-router";
import { HrReportsPage, type HrReport } from "../../../features/hr";

const REPORTS: HrReport[] = ["strength", "salary", "salary-history", "attendance", "experience"];

/** /hr/reports?report= — staff strength, salary register, salary history (staff × month), attendance summary, experience. */
export const Route = createFileRoute("/_app/hr/reports")({
  validateSearch: (s: Record<string, unknown>): { report?: HrReport } => (REPORTS.includes(s.report as HrReport) ? { report: s.report as HrReport } : {}),
  component: function ReportsRoute() {
    const { report } = Route.useSearch();
    const navigate = Route.useNavigate();
    return <HrReportsPage report={report ?? "strength"} setReport={(r) => void navigate({ search: (prev) => ({ ...prev, report: r }) })} />;
  },
});
