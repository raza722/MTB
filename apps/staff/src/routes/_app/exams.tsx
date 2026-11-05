import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RequirePermission } from "../../app/shell/page";

/** /exams — exams and results: the exam list, each exam's pages, combined results, merit lists, history, university, types and grading. */
export const Route = createFileRoute("/_app/exams")({
  component: () => (
    <RequirePermission permission="exams.view" page="Exams">
      <Outlet />
    </RequirePermission>
  ),
});
