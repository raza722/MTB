import { createFileRoute } from "@tanstack/react-router";
import { LibraryOverviewPage } from "../../../features/library";

export const Route = createFileRoute("/_app/library/")({
  component: LibraryOverviewPage,
});
