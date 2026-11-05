import { createFileRoute } from "@tanstack/react-router";
import { LoginPage } from "../../features/auth/LoginPage";

export const Route = createFileRoute("/login/")({
  validateSearch: (s: Record<string, unknown>): { redirect?: string } => (typeof s.redirect === "string" && s.redirect.startsWith("/") && !s.redirect.startsWith("/login") ? { redirect: s.redirect } : {}),
  component: function LoginRoute() {
    const { redirect } = Route.useSearch();
    return <LoginPage {...(redirect ? { redirectTo: redirect } : {})} />;
  },
});
