import { createFileRoute } from "@tanstack/react-router";
import { ExamResults } from "../../../../features/exams/ExamResults";

export const Route = createFileRoute("/_app/exams/$examId/results")({ component: ExamResults });
