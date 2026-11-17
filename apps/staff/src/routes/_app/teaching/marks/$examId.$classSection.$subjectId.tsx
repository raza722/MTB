import { createFileRoute } from "@tanstack/react-router";
import { RequirePermission } from "../../../../app/shell/page";
import { MarksEntryPage } from "../../../../features/teaching";

/** /teaching/marks/<exam>/<class>/<subject> — marks entry for one paper. */
export const Route = createFileRoute("/_app/teaching/marks/$examId/$classSection/$subjectId")({
  component: function TeachingMarksEntryRoute() {
    const { examId, classSection, subjectId } = Route.useParams();
    // Marks need teacher.marks: in the old software the exam office entered marks, not teachers.
    return (
      <RequirePermission permission="teacher.marks" page="Marks">
        <MarksEntryPage examId={examId} classSection={classSection} subjectId={subjectId} />
      </RequirePermission>
    );
  },
});
