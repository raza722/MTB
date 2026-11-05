import { createFileRoute } from "@tanstack/react-router";
import { FeesPage } from "../../../features/fees/FeesPage";

export const Route = createFileRoute("/_app/fees/")({
  component: FeesPage,
});
