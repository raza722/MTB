import { createFileRoute } from "@tanstack/react-router";
import { MarksPage } from "../../../../features/teaching";

interface MarksSearch {
  exam?: string;
  cls?: string;
}

/** /teaching/marks?exam=&cls= — choose the exam, the class and the subject. */
export const Route = createFileRoute("/_app/teaching/marks/")({
  validateSearch: (s: Record<string, unknown>): MarksSearch => ({
    ...(typeof s.exam === "string" && s.exam ? { exam: s.exam } : {}),
    ...(typeof s.cls === "string" && s.cls ? { cls: s.cls } : {}),
  }),
  component: function TeachingMarksRoute() {
    const { exam, cls } = Route.useSearch();
    return <MarksPage exam={exam} cls={cls} />;
  },
});
