import { createFileRoute, redirect } from "@tanstack/react-router";
import { ResetPasswordPage } from "../../features/auth/ResetPasswordPage";

export const Route = createFileRoute("/login/reset-password")({
  validateSearch: (s: Record<string, unknown>): { token?: string; username?: string } => ({
    ...(typeof s.token === "string" ? { token: s.token } : {}),
    ...(typeof s.username === "string" ? { username: s.username } : {}),
  }),
  beforeLoad: ({ search }) => {
    if (!search.token) throw redirect({ to: "/login" });
  },
  component: function ResetRoute() {
    const { token, username } = Route.useSearch();
    return <ResetPasswordPage token={token ?? ""} {...(username ? { username } : {})} />;
  },
});
