import { createFileRoute } from "@tanstack/react-router";
import { OffersPage } from "../../../features/admissions";

export const Route = createFileRoute("/_app/admissions/offers")({
  component: OffersPage,
});
