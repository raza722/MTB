import { createFileRoute } from "@tanstack/react-router";
import { TransportOverviewPage } from "../../../features/transport";

export const Route = createFileRoute("/_app/transport/")({
  component: TransportOverviewPage,
});
