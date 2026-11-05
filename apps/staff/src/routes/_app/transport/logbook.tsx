import { createFileRoute } from "@tanstack/react-router";
import { LogbookPage } from "../../../features/transport";

/** /transport/logbook — trips (the old Tours screen) and fuel. */
export const Route = createFileRoute("/_app/transport/logbook")({
  component: LogbookPage,
});
