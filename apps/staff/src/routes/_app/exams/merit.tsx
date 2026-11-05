import { createFileRoute } from "@tanstack/react-router";
import { MeritPage } from "../../../features/exams/MeritPage";

export const Route = createFileRoute("/_app/exams/merit")({ component: MeritPage });
