import { createFileRoute, Outlet } from "@tanstack/react-router";

/** /activities — scholarships, tests, schemes, houses, events, student records and certificates. Each page guards itself. */
export const Route = createFileRoute("/_app/activities")({ component: () => <Outlet /> });
