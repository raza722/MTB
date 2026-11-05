import { portalQueries } from "@mtb/api";
import { createFileRoute, redirect } from "@tanstack/react-router";

/** Signed in → home; otherwise → sign in. */
export const Route = createFileRoute("/")({
  beforeLoad: async ({ context }) => {
    let signedIn = false;
    try {
      await context.queryClient.ensureQueryData(portalQueries.session());
      signedIn = true;
    } catch {
      signedIn = false;
    }
    throw redirect({ to: signedIn ? "/home" : "/sign-in" });
  },
});
