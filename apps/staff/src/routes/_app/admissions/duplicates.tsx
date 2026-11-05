import { createFileRoute } from "@tanstack/react-router";
import { DuplicatesPage } from "../../../features/admissions";

export const Route = createFileRoute("/_app/admissions/duplicates")({
  component: DuplicatesPage,
});
