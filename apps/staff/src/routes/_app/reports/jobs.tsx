import { createFileRoute } from "@tanstack/react-router";
import { JobsPage } from "../../../features/reports";

/** /reports/jobs — background reports and exports, with progress and downloads. */
export const Route = createFileRoute("/_app/reports/jobs")({
  component: JobsPage,
});
