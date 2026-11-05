import { createFileRoute } from "@tanstack/react-router";
import { RoutesPage } from "../../../features/transport";

/** /transport/routes — routes, stops and pickup times; route sheets print on A4. */
export const Route = createFileRoute("/_app/transport/routes")({
  component: RoutesPage,
});
