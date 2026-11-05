import { portalQueries } from "@mtb/api";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { PortalShell } from "../app/shell/PortalShell";

/** Everything behind sign-in. No session → the sign-in page. */
export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context }) => {
    try {
      await context.queryClient.ensureQueryData(portalQueries.session());
    } catch {
      throw redirect({ to: "/sign-in" });
    }
  },
  component: PortalShell,
});
