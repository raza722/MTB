import { createFileRoute } from "@tanstack/react-router";
import { TeacherPerformancePage } from "../../../features/exams/TeacherPerformancePage";

export const Route = createFileRoute("/_app/exams/teachers")({ component: TeacherPerformancePage });
