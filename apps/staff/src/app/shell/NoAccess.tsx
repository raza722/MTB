import { authApi, type SessionUser } from "@mtb/api";
import { Button, Crest, EmptyState } from "@mtb/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

/** True when no grant gives the account any right at all (no role, or a role with nothing switched on). */
export function hasNoAccess(user: SessionUser | undefined): boolean {
  if (!user) return false;
  return !user.roles.some((g) => g.permissions.length > 0 || Object.values(g.campusPermissions ?? {}).some((p) => (p?.length ?? 0) > 0));
}

/** Shown instead of the app to an account that has no rights. */
export function NoAccess({ user }: { user: SessionUser }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const signOut = useMutation({
    mutationFn: authApi.logout,
    onSettled: async () => {
      queryClient.clear();
      await navigate({ to: "/login", replace: true });
    },
  });
  return (
    <main className="grid min-h-screen place-items-center bg-surface p-4">
      <div className="mtb-card grid max-w-lg gap-4 p-6 text-center">
        <div className="flex justify-center">
          <Crest size={56} />
        </div>
        <EmptyState icon="lock" title="This account has no access" description={`${user.name}, no role gives this account anything to open. Ask head office to give it a role in Setup › Users.`} />
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="secondary" icon="logout" onClick={() => signOut.mutate()} loading={signOut.isPending} loadingLabel="Signing out…">
            Sign out
          </Button>
        </div>
      </div>
    </main>
  );
}
