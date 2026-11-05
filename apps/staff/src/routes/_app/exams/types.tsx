import { createFileRoute } from "@tanstack/react-router";
import { ExamTypesPage } from "../../../features/exams/ExamTypesPage";

export const Route = createFileRoute("/_app/exams/types")({ component: ExamTypesPage });
