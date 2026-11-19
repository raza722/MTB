import { authQueries } from "@mtb/api";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "../app/shell/AppShell";

/** Everything behind sign-in. No session → the sign-in page, then back here. */
export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context, location }) => {
    try {
      await context.queryClient.ensureQueryData(authQueries.session());
    } catch {
      // replace: the signed-out page swaps itself for the sign-in page, so Back after sign-out never lands on an address
      // that only shows the sign-in form (and the address bar always reads /login)
      throw redirect({ to: "/login", search: { redirect: location.href } as never, replace: true });
    }
  },
  component: () => <AppShell />,
});
