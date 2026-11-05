import { createFileRoute } from "@tanstack/react-router";
import { LoginPage } from "../../features/auth/LoginPage";

interface LoginSearch {
  redirect?: string;
  username?: string;
  changed?: boolean;
}

export const Route = createFileRoute("/login/")({
  validateSearch: (s: Record<string, unknown>): LoginSearch => ({
    ...(typeof s.redirect === "string" && s.redirect.startsWith("/") && !s.redirect.startsWith("/login") ? { redirect: s.redirect } : {}),
    ...(typeof s.username === "string" ? { username: s.username } : {}),
    ...(s.changed === true || s.changed === "true" ? { changed: true } : {}),
  }),
  component: function LoginRoute() {
    const { redirect, username, changed } = Route.useSearch();
    return <LoginPage {...(redirect ? { redirectTo: redirect } : {})} {...(username ? { username } : {})} {...(changed ? { changed } : {})} />;
  },
});
