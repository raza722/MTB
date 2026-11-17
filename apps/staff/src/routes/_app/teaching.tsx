import { createFileRoute, Outlet } from "@tanstack/react-router";
import { TeachingGate } from "../../features/teaching";

/** /teaching — the teacher's own work: today, registers, marks, timetable, classes, notifications and leave. */
export const Route = createFileRoute("/_app/teaching")({
  component: () => (
    <TeachingGate>
      <Outlet />
    </TeachingGate>
  ),
});
