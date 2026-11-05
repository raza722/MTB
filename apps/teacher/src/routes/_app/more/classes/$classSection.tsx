import { createFileRoute } from "@tanstack/react-router";
import { ClassPage } from "../../../../features/more/ClassPage";

export const Route = createFileRoute("/_app/more/classes/$classSection")({
  component: function ClassRoute() {
    const { classSection } = Route.useParams();
    return <ClassPage classSection={classSection} />;
  },
});
