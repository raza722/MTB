import { createFileRoute } from "@tanstack/react-router";
import { WarehouseOverviewPage } from "../../../features/warehouse";

export const Route = createFileRoute("/_app/warehouse/")({
  component: WarehouseOverviewPage,
});
