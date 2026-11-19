import { createFileRoute } from "@tanstack/react-router";
import { RequirePermission } from "../../../../app/shell/page";
import { MarksPage } from "../../../../features/teaching";
import { idParam } from "../../../../app/search";

interface MarksSearch {
  exam?: string;
  cls?: string;
}

/** /teaching/marks?exam=&cls= — choose the exam, the class and the subject. */
export const Route = createFileRoute("/_app/teaching/marks/")({
  validateSearch: (s: Record<string, unknown>): MarksSearch => ({
    ...(idParam(s.exam) ? { exam: idParam(s.exam)! } : {}),
    ...(typeof s.cls === "string" && s.cls ? { cls: s.cls } : {}),
  }),
  component: function TeachingMarksRoute() {
    const { exam, cls } = Route.useSearch();
    // Marks need teacher.marks: in the old software the exam office entered marks, not teachers.
    return (
      <RequirePermission permission="teacher.marks" page="Marks">
        <MarksPage exam={exam} cls={cls} />
      </RequirePermission>
    );
  },
});
