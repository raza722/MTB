import { createFileRoute } from "@tanstack/react-router";
import { RequirePermission } from "../../../app/shell/page";
import { NewExamPage } from "../../../features/exams/NewExamPage";

export const Route = createFileRoute("/_app/exams/new")({
  component: () => (
    <RequirePermission permission="exams.manage" page="New exam">
      <NewExamPage />
    </RequirePermission>
  ),
});
