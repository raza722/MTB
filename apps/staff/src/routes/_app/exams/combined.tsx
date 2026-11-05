import { createFileRoute } from "@tanstack/react-router";
import { CombinedPage } from "../../../features/exams/CombinedPage";

export const Route = createFileRoute("/_app/exams/combined")({ component: CombinedPage });
