import { createFileRoute } from "@tanstack/react-router";
import { LeavePage } from "../../../features/hr";

/** /hr/leave — leave requests, approvals and balances. */
export const Route = createFileRoute("/_app/hr/leave")({ component: LeavePage });
