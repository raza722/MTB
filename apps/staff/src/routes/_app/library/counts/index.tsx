import { createFileRoute } from "@tanstack/react-router";
import { CountsPage } from "../../../../features/library";

export const Route = createFileRoute("/_app/library/counts/")({
  component: CountsPage,
});
