import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RequirePermission } from "../../app/shell/page";

/** Admissions: enquiry → application → entrance test → merit list → offer → admission. Each step is a page under /admissions. */
export const Route = createFileRoute("/_app/admissions")({
  component: function AdmissionsLayout() {
    return (
      <RequirePermission permission="admissions.view" page="Admissions">
        <Outlet />
      </RequirePermission>
    );
  },
});
