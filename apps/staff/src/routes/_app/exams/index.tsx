import { createFileRoute, redirect } from "@tanstack/react-router";
import { ExamsPage } from "../../../features/exams/ExamsPage";

/** Old links: /exams?exam=<id> opens that exam; /exams?view=grading opens the grading rules. */
interface LegacySearch {
  exam?: string;
  view?: "grading";
}

export const Route = createFileRoute("/_app/exams/")({
  validateSearch: (s: Record<string, unknown>): LegacySearch => ({
    ...(typeof s.exam === "string" && s.exam ? { exam: s.exam } : {}),
    ...(s.view === "grading" ? { view: "grading" as const } : {}),
  }),
  beforeLoad: ({ search }) => {
    if (search.exam) throw redirect({ to: "/exams/$examId", params: { examId: search.exam } });
    if (search.view === "grading") throw redirect({ to: "/exams/grading" });
  },
  component: ExamsPage,
});
