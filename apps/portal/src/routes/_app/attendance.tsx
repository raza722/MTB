import { createFileRoute } from "@tanstack/react-router";
import { AttendancePage } from "../../features/attendance/AttendancePage";

export const Route = createFileRoute("/_app/attendance")({
  validateSearch: (s: Record<string, unknown>): { month?: string } => (typeof s.month === "string" && /^\d{4}-\d{2}$/.test(s.month) ? { month: s.month } : {}),
  component: function AttendanceRoute() {
    const { month } = Route.useSearch();
    return <AttendancePage {...(month ? { month } : {})} />;
  },
});
