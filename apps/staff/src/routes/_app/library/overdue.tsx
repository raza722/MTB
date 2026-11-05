import { createFileRoute } from "@tanstack/react-router";
import { OverduePage } from "../../../features/library";

export const Route = createFileRoute("/_app/library/overdue")({
  component: OverduePage,
});
