import { createFileRoute } from "@tanstack/react-router";
import { WhCountPage } from "../../../../features/warehouse";

/** /warehouse/counts/<id> — the count sheet; submitted counts are approved by the principal or an admin. */
export const Route = createFileRoute("/_app/warehouse/counts/$countId")({
  component: function CountRoute() {
    const { countId } = Route.useParams();
    return <WhCountPage countId={countId} />;
  },
});
