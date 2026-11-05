import { createFileRoute, Outlet } from "@tanstack/react-router";

/** /setup — campuses, sessions, classes, subjects, teachers, users, roles, campus settings and the audit log. Each page guards itself. */
export const Route = createFileRoute("/_app/setup")({ component: () => <Outlet /> });
