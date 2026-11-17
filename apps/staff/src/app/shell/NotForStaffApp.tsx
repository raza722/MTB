import { authApi, type SessionUser } from "@mtb/api";
import { Button, buttonClassName, Crest, EmptyState } from "@mtb/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

/**
 * True when no grant gives the account anything in the staff app: a teacher (the Teacher role is the teacher app only,
 * as in the old software, where teachers used the phone app and opened no desktop screen) or an account with no role.
 */
export function hasNoStaffAccess(user: SessionUser | undefined): boolean {
  if (!user) return false;
  return !user.roles.some((g) => [...g.permissions, ...Object.values(g.campusPermissions ?? {}).flat()].some((p) => p !== "teacher.app"));
}

/** The teacher app on the same host as this page (served beside the staff app), unless VITE_TEACHER_APP_URL says otherwise. */
function teacherAppUrl(): string {
  const set = import.meta.env.VITE_TEACHER_APP_URL as string | undefined;
  if (set) return set.replace(/\/$/, "");
  return `${window.location.protocol}//${window.location.hostname}:5174`;
}

/** Shown instead of the staff app to an account that has nothing in it. */
export function NotForStaffApp({ user }: { user: SessionUser }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isTeacher = user.roles.some((g) => g.permissions.includes("teacher.app"));
  const signOut = useMutation({
    mutationFn: authApi.logout,
    onSettled: async () => {
      queryClient.clear();
      await navigate({ to: "/login" });
    },
  });
  return (
    <main className="grid min-h-screen place-items-center bg-surface p-4">
      <div className="mtb-card grid max-w-lg gap-4 p-6 text-center">
        <div className="flex justify-center">
          <Crest size={56} />
        </div>
        <EmptyState
          icon={isTeacher ? "smartphone" : "lock"}
          title={isTeacher ? "This account is for the teacher app" : "This account has no access to the staff app"}
          description={
            isTeacher
              ? `${user.name}, teachers mark registers, enter marks and see their timetable in the teacher app. The staff app is for the office, fees, accounts and administration.`
              : `${user.name}, no role gives this account anything in the staff app. Ask head office to give it a role in Setup › Users.`
          }
        />
        <div className="flex flex-wrap justify-center gap-2">
          {isTeacher && (
            <a href={teacherAppUrl()} className={buttonClassName({ variant: "primary" })}>
              Open the teacher app
            </a>
          )}
          <Button variant="secondary" icon="logout" onClick={() => signOut.mutate()} loading={signOut.isPending} loadingLabel="Signing out…">
            Sign out
          </Button>
        </div>
      </div>
    </main>
  );
}
