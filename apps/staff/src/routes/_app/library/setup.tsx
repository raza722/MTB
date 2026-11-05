import { createFileRoute } from "@tanstack/react-router";
import { LibrarySetupPage } from "../../../features/library";

export const Route = createFileRoute("/_app/library/setup")({
  component: LibrarySetupPage,
});
