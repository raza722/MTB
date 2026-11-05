import { createFileRoute, Outlet } from "@tanstack/react-router";

/** /hr — staff and payroll: directory and profiles, attendance, leave, payroll, increments, loans, reports and settings. Each page guards itself. */
export const Route = createFileRoute("/_app/hr")({ component: () => <Outlet /> });
