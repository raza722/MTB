import { createFileRoute } from "@tanstack/react-router";
import { ExamOverview } from "../../../../features/exams/ExamOverview";

export const Route = createFileRoute("/_app/exams/$examId/")({ component: ExamOverview });
