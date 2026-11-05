import { createFileRoute } from "@tanstack/react-router";
import { StaffDirectoryPage } from "../../../features/hr";

/** /hr — the staff directory across campuses. */
export const Route = createFileRoute("/_app/hr/")({ component: StaffDirectoryPage });
