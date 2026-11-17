import { createFileRoute } from "@tanstack/react-router";
import { NotificationsPage } from "../../../features/teaching";

/** /teaching/notifications — the teacher's notifications. */
export const Route = createFileRoute("/_app/teaching/notifications")({ component: NotificationsPage });
