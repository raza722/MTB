import { createFileRoute, redirect } from "@tanstack/react-router";
import { OverviewPage } from "../../../features/sms";

/** Old links: /sms?tab=templates|report|optouts|send open the matching page. */
const LEGACY: Record<string, string> = { send: "/sms/compose", templates: "/sms/templates", report: "/sms/delivery", optouts: "/sms/opt-outs" };

export const Route = createFileRoute("/_app/sms/")({
  validateSearch: (s: Record<string, unknown>): { tab?: string } => (typeof s.tab === "string" && s.tab in LEGACY ? { tab: s.tab } : {}),
  beforeLoad: ({ search }) => {
    if (search.tab) throw redirect({ to: LEGACY[search.tab]! } as never);
  },
  component: OverviewPage,
});
