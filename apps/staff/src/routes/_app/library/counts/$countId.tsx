import { createFileRoute } from "@tanstack/react-router";
import { CountPage } from "../../../../features/library";

/** /library/counts/<id> — scan shelves, see what is missing or misplaced, close to correct the catalogue. */
export const Route = createFileRoute("/_app/library/counts/$countId")({
  component: function CountRoute() {
    const { countId } = Route.useParams();
    return <CountPage countId={countId} />;
  },
});
