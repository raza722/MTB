import { authQueries, can, type CampusScope } from "@mtb/api";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { campusesFor, canTeach, defaultCampus } from "../../app/session";
import { DashboardPage } from "../../features/dashboard/DashboardPage";

export const Route = createFileRoute("/_app/dashboard")({
  // Sign-in lands here. A teacher who can't open the dashboard starts on Teaching › Today instead.
  beforeLoad: async ({ context, search }) => {
    const user = await context.queryClient.ensureQueryData(authQueries.session());
    const wanted = (search as { campus?: CampusScope }).campus;
    const campus = wanted && campusesFor(user).includes(wanted) ? wanted : defaultCampus(user);
    if (!can(user, "dashboard.view", campus) && canTeach(user, campus)) throw redirect({ to: "/teaching" });
  },
  component: DashboardPage,
});
