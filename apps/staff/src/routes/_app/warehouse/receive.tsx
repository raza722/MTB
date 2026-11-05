import { createFileRoute } from "@tanstack/react-router";
import { ReceivePage } from "../../../features/warehouse";

/** /warehouse/receive?new=1 — goods received notes; new=1 opens the receive form. */
export const Route = createFileRoute("/_app/warehouse/receive")({
  validateSearch: (s: Record<string, unknown>): { new?: 1 } => (s.new === 1 || s.new === "1" ? { new: 1 } : {}),
  component: function ReceiveRoute() {
    const search = Route.useSearch();
    const navigate = Route.useNavigate();
    return <ReceivePage openNew={search.new === 1} setOpenNew={(v) => void navigate({ search: (v ? { new: 1 } : {}) as never, replace: true })} />;
  },
});
