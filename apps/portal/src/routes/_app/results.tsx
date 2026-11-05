import { createFileRoute } from "@tanstack/react-router";
import { ResultsPage } from "../../features/results/ResultsPage";

export const Route = createFileRoute("/_app/results")({
  component: ResultsPage,
});
