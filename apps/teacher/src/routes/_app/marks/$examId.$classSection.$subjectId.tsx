import { createFileRoute } from "@tanstack/react-router";
import { MarksEntryPage } from "../../../features/marks/MarksEntryPage";

export const Route = createFileRoute("/_app/marks/$examId/$classSection/$subjectId")({
  staticData: { hideNav: true },
  component: function MarksEntryRoute() {
    const { examId, classSection, subjectId } = Route.useParams();
    return <MarksEntryPage examId={examId} classSection={classSection} subjectId={subjectId} />;
  },
});
