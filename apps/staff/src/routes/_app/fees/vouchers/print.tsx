import { createFileRoute } from "@tanstack/react-router";
import { PrintVouchersPage } from "../../../../features/fees/vouchers/PrintVouchersPage";

/** /fees/vouchers/print?run= — a whole run on A4 landscape, three copies a sheet. */
export const Route = createFileRoute("/_app/fees/vouchers/print")({
  validateSearch: (s: Record<string, unknown>): { run?: string } => (typeof s.run === "string" && s.run ? { run: s.run } : {}),
  component: function PrintRoute() {
    const { run } = Route.useSearch();
    return <PrintVouchersPage runId={run ?? ""} />;
  },
});
