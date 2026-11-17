import { createFileRoute } from "@tanstack/react-router";
import { ClassPage } from "../../../../features/teaching";

/** /teaching/classes/7-B — the class list and parents' contacts. */
export const Route = createFileRoute("/_app/teaching/classes/$classSection")({
  component: function TeachingClassRoute() {
    const { classSection } = Route.useParams();
    return <ClassPage classSection={classSection} />;
  },
});
