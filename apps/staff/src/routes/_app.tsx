import { authQueries } from "@mtb/api";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "../app/shell/AppShell";

/** Everything behind sign-in. No session → the sign-in page, then back here. */
export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context, location }) => {
    try {
      await context.queryClient.ensureQueryData(authQueries.session());
    } catch {
      throw redirect({ to: "/login", search: { redirect: location.href } as never });
    }
  },
  component: () => <AppShell />,
});
