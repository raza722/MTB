import { ApiError, authApi, authQueries, roleLabel } from "@mtb/api";
import { Button, PermissionDenied } from "@mtb/ui";
import { onlineManager, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { clearPersisted } from "../app/persist";
import { CtxProvider, rememberedCampus, useSessionUser } from "../app/session";
import { AppShell } from "../app/shell/AppShell";
import { clearOutbox } from "../app/sync/outbox";

/** Signed-in area: needs a session (kept on the phone, so it opens offline) and the teacher-app permission. */
export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context, location }) => {
    const opts = authQueries.session();
    const cached = context.queryClient.getQueryData(opts.queryKey);
    if (cached) {
      // Open straight away with the saved session; check it in the background when online.
      if (onlineManager.isOnline()) void context.queryClient.prefetchQuery({ ...opts, staleTime: 60_000 });
      return { user: cached };
    }
    try {
      const user = await context.queryClient.fetchQuery({ ...opts, networkMode: "always" });
      return { user };
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.isNetwork)) throw redirect({ to: "/login", search: { redirect: location.href } });
      throw e;
    }
  },
  component: AppLayout,
});

function AppLayout() {
  const user = useSessionUser() ?? Route.useRouteContext().user;
  const campus = rememberedCampus(user);
  if (!campus) return <NoAccess />;
  return (
    <CtxProvider initial={campus}>
      <AppShell />
    </CtxProvider>
  );
}

/** Signed in, but the role has no teacher app (a cashier, an accountant). */
function NoAccess() {
  const user = useSessionUser() ?? Route.useRouteContext().user;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const signOut = async () => {
    try {
      await authApi.logout();
    } catch {
      /* signing out locally is enough */
    }
    await clearOutbox();
    await clearPersisted();
    queryClient.clear();
    await navigate({ to: "/login" });
  };
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-4">
      <div className="mtb-card max-w-[420px] p-2">
        <PermissionDenied
          role={roleLabel(user, user?.roles[0]?.campus ?? "ALL")}
          page="the teacher app"
          grantedBy="your campus office"
          action={
            <Button variant="primary" size="touch" onClick={() => void signOut()}>
              Sign out
            </Button>
          }
        />
      </div>
    </main>
  );
}
