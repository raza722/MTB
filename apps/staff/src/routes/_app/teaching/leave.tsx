import { createFileRoute } from "@tanstack/react-router";
import { LeavePage } from "../../../features/teaching";

/** /teaching/leave — the teacher's own leave and attendance. */
export const Route = createFileRoute("/_app/teaching/leave")({ component: LeavePage });
