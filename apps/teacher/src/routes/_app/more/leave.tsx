import { createFileRoute } from "@tanstack/react-router";
import { LeavePage } from "../../../features/more/LeavePage";

export const Route = createFileRoute("/_app/more/leave")({
  staticData: { hideNav: true },
  component: LeavePage,
});
