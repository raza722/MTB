import { createFileRoute } from "@tanstack/react-router";
import { OutboxPage, type OutboxSearch } from "../../../features/sms";

const STATUSES = ["AWAITING_APPROVAL", "SCHEDULED", "SENDING", "SENT", "CANCELLED", "REJECTED"];

/** /sms/outbox — every send: waiting for approval, scheduled, sending and sent. */
export const Route = createFileRoute("/_app/sms/outbox")({
  validateSearch: (s: Record<string, unknown>): OutboxSearch => ({
    ...(typeof s.status === "string" && STATUSES.includes(s.status) ? { status: s.status as OutboxSearch["status"] } : {}),
    ...(typeof s.batch === "string" && s.batch ? { batch: s.batch } : {}),
  }),
  component: function OutboxRoute() {
    const navigate = Route.useNavigate();
    return <OutboxPage search={Route.useSearch()} setSearch={(next) => void navigate({ search: next as never })} />;
  },
});
