import { createFileRoute } from "@tanstack/react-router";
import { ComposePage, type ComposeSearch } from "../../../features/sms";

/** /sms/compose — write or pick a message, choose who gets it, how (SMS or app) and when. */
export const Route = createFileRoute("/_app/sms/compose")({
  validateSearch: (s: Record<string, unknown>): ComposeSearch => ({
    ...(typeof s.template === "string" && s.template ? { template: s.template } : {}),
    ...(typeof s.to === "string" && ["CLASS", "DEFAULTERS", "ALL_PARENTS", "STAFF", "NUMBERS", "CANDIDATES", "LEFT"].includes(s.to) ? { to: s.to as ComposeSearch["to"] } : {}),
    ...(typeof s.sections === "string" && s.sections ? { sections: s.sections } : {}),
    ...(typeof s.exam === "string" && s.exam ? { exam: s.exam } : {}),
  }),
  component: function ComposeRoute() {
    return <ComposePage search={Route.useSearch()} />;
  },
});
