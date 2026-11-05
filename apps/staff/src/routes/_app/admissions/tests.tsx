import { createFileRoute } from "@tanstack/react-router";
import { TestsPage } from "../../../features/admissions";

export const Route = createFileRoute("/_app/admissions/tests")({
  validateSearch: (s: Record<string, unknown>): { test?: string } => (typeof s.test === "string" && s.test ? { test: s.test } : {}),
  component: function TestsRoute() {
    const { test } = Route.useSearch();
    const navigate = Route.useNavigate();
    return <TestsPage testId={test ?? ""} setTestId={(id) => navigate({ search: (prev) => ({ ...prev, test: id || undefined }), replace: true })} />;
  },
});
