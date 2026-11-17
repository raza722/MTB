import { dashboardQueries } from "@mtb/api";
import { Banner, Button } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { RequirePermission } from "../../app/shell/page";
import { useCan, useCtx } from "../../app/session";
import { ActivityCard, UpcomingCard } from "./ActivityCard";
import { ApprovalsCard } from "./ApprovalsCard";
import { AttendanceCard } from "./AttendanceCard";
import { CampusComparison } from "./CampusComparison";
import { CollectionsCard } from "./CollectionsCard";
import { FeeStatusCard } from "./FeeStatusCard";
import { Hero } from "./Hero";
import { stagger } from "./format";
import { KpiCards } from "./KpiCards";
import "./dashboard.css";

export function DashboardPage() {
  const ctx = useCtx();
  const canApprove = useCan("approvals.decide");
  const summary = useQuery(dashboardQueries.summary(ctx));
  const approvals = useQuery({ ...dashboardQueries.approvals(ctx), enabled: canApprove });
  const s = summary.data;

  useEffect(() => {
    document.title = "Dashboard · MTB";
  }, []);

  return (
    <RequirePermission permission="dashboard.view" page="the dashboard">
      {/* Keyed by campus and session so the charts draw in again when the context changes. */}
      <div key={`${ctx.campus}:${ctx.session}`} className="mtb-dash grid w-full grid-cols-[minmax(0,1fr)] gap-6">
        <Hero s={s} approvals={approvals.data?.length} />
        {summary.isError && (
          <Banner tone="danger" title="The dashboard figures could not be loaded." actions={<Button size="sm" variant="secondary" onClick={() => void summary.refetch()}>Try again</Button>}>
            {summary.error.message}
          </Banner>
        )}
        <KpiCards s={s} />
        <div className="mtb-dash-grid">
          <CollectionsCard s={s} />
          <FeeStatusCard s={s} />
          <AttendanceCard s={s} />
          <UpcomingCard s={s} />
          {s?.campuses && s.campuses.some((r) => r.collected !== null) && (
            <div className="xl:col-span-2">
              {/* Campuses where the caller has no fees.view carry no money figures (access parity). */}
              <CampusComparison
                rows={s.campuses.flatMap((r) => (r.collected === null || r.target === null ? [] : [{ ...r, collected: r.collected, target: r.target, arrears: r.arrears ?? 0 }]))}
              />
            </div>
          )}
          {canApprove ? (
            <>
              <div className="mtb-dash-approvals mtb-rise min-w-0" style={stagger(9)}>
                <ApprovalsCard />
              </div>
              <ActivityCard s={s} />
            </>
          ) : (
            <ActivityCard s={s} wide />
          )}
        </div>
      </div>
    </RequirePermission>
  );
}
