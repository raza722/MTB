import { createFileRoute } from "@tanstack/react-router";
import { ExamLayout } from "../../../features/exams/ExamLayout";

/** One exam: header with declare / reopen, and its pages (overview, marks entry, results, analysis, print). */
export const Route = createFileRoute("/_app/exams/$examId")({
  component: function ExamRoute() {
    const { examId } = Route.useParams();
    return <ExamLayout key={examId} examId={examId} />;
  },
});
