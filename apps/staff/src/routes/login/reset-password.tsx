import { createFileRoute, redirect } from "@tanstack/react-router";
import { ResetPasswordPage } from "../../features/auth/ResetPasswordPage";

export const Route = createFileRoute("/login/reset-password")({
  validateSearch: (s: Record<string, unknown>): { token?: string } => (typeof s.token === "string" ? { token: s.token } : {}),
  beforeLoad: ({ search }) => {
    if (!search.token) throw redirect({ to: "/login" });
  },
  component: function ResetRoute() {
    const { token } = Route.useSearch();
    return <ResetPasswordPage token={token ?? ""} />;
  },
});
