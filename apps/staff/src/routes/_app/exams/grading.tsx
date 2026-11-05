import { createFileRoute } from "@tanstack/react-router";
import { GradingPage } from "../../../features/exams/GradingRules";

export const Route = createFileRoute("/_app/exams/grading")({ component: GradingPage });
