import { createFileRoute } from "@tanstack/react-router";
import { WhCountsPage } from "../../../../features/warehouse";

export const Route = createFileRoute("/_app/warehouse/counts/")({
  component: WhCountsPage,
});
