import { createFileRoute } from "@tanstack/react-router";
import { MarksEntryPage } from "../../../../features/teaching";

/** /teaching/marks/<exam>/<class>/<subject> — marks entry for one paper. */
export const Route = createFileRoute("/_app/teaching/marks/$examId/$classSection/$subjectId")({
  component: function TeachingMarksEntryRoute() {
    const { examId, classSection, subjectId } = Route.useParams();
    return <MarksEntryPage examId={examId} classSection={classSection} subjectId={subjectId} />;
  },
});
