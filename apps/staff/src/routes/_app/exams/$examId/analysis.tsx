import { createFileRoute } from "@tanstack/react-router";
import { ExamAnalysis } from "../../../../features/exams/ExamAnalysis";

export const Route = createFileRoute("/_app/exams/$examId/analysis")({ component: ExamAnalysis });
