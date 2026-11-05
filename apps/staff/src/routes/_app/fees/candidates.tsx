import { createFileRoute } from "@tanstack/react-router";
import { CandidatesPage } from "../../../features/fees/candidates/CandidatesPage";

export const Route = createFileRoute("/_app/fees/candidates")({ component: CandidatesPage });
