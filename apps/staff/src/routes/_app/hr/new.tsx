import { createFileRoute } from "@tanstack/react-router";
import { NewStaffPage } from "../../../features/hr";

/** /hr/new — add a staff member. */
export const Route = createFileRoute("/_app/hr/new")({ component: NewStaffPage });
