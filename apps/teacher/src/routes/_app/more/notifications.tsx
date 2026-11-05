import { createFileRoute } from "@tanstack/react-router";
import { NotificationsPage } from "../../../features/more/NotificationsPage";

export const Route = createFileRoute("/_app/more/notifications")({
  component: NotificationsPage,
});
