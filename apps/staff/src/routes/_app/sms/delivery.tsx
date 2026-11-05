import { createFileRoute } from "@tanstack/react-router";
import { DeliveryPage, type DeliverySearch } from "../../../features/sms";

const STATUSES = ["queued", "sent", "delivered", "failed", "optedout"];

/** /sms/delivery — today's messages one by one with their delivery status; retry failed. */
export const Route = createFileRoute("/_app/sms/delivery")({
  validateSearch: (s: Record<string, unknown>): DeliverySearch => ({
    ...(typeof s.status === "string" && STATUSES.includes(s.status) ? { status: s.status as DeliverySearch["status"] } : {}),
    ...(typeof s.batch === "string" && s.batch ? { batch: s.batch } : {}),
  }),
  component: function DeliveryRoute() {
    const navigate = Route.useNavigate();
    return <DeliveryPage search={Route.useSearch()} setSearch={(next) => void navigate({ search: next as never })} />;
  },
});
