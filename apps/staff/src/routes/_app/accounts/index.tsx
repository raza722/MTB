import { createFileRoute, redirect } from "@tanstack/react-router";
import { OverviewPage } from "../../../features/accounts";

/** Old links: /accounts?jv=<id> opens that voucher; /accounts?tab=chart opens the chart of accounts. */
interface LegacySearch {
  jv?: string;
  tab?: "chart";
}

export const Route = createFileRoute("/_app/accounts/")({
  validateSearch: (s: Record<string, unknown>): LegacySearch => ({
    ...(typeof s.jv === "string" && s.jv ? { jv: s.jv } : {}),
    ...(s.tab === "chart" ? { tab: "chart" as const } : {}),
  }),
  beforeLoad: ({ search }) => {
    if (search.jv) throw redirect({ to: "/accounts/vouchers/$voucherId", params: { voucherId: search.jv } } as never);
    if (search.tab === "chart") throw redirect({ to: "/accounts/chart" } as never);
  },
  component: OverviewPage,
});
