import { createFileRoute } from "@tanstack/react-router";
import { PrintVouchersPage } from "../../../../features/fees/vouchers/PrintVouchersPage";
import { idParam } from "../../../../app/search";

/** /fees/vouchers/print?run= — a whole run on A4 landscape, three copies a sheet. */
export const Route = createFileRoute("/_app/fees/vouchers/print")({
  validateSearch: (s: Record<string, unknown>): { run?: string } => (idParam(s.run) ? { run: idParam(s.run)! } : {}),
  component: function PrintRoute() {
    const { run } = Route.useSearch();
    return <PrintVouchersPage runId={run ?? ""} />;
  },
});
