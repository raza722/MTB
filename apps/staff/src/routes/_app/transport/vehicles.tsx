import { createFileRoute } from "@tanstack/react-router";
import { VehiclesPage } from "../../../features/transport";

export const Route = createFileRoute("/_app/transport/vehicles")({
  component: VehiclesPage,
});
