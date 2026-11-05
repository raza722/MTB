import { createFileRoute } from "@tanstack/react-router";
import { ItemsPage } from "../../../features/warehouse";

export const Route = createFileRoute("/_app/warehouse/items")({
  component: ItemsPage,
});
