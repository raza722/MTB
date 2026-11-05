import { createFileRoute } from "@tanstack/react-router";
import { LoansPage } from "../../../features/library";

export const Route = createFileRoute("/_app/library/loans")({
  component: LoansPage,
});
