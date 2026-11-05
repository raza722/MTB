import { createFileRoute, redirect } from "@tanstack/react-router";
import { MfaPage } from "../../features/auth/MfaPage";

interface MfaSearch {
  challenge?: string;
  phone?: string;
  redirect?: string;
}

export const Route = createFileRoute("/login/mfa")({
  validateSearch: (s: Record<string, unknown>): MfaSearch => ({
    ...(typeof s.challenge === "string" ? { challenge: s.challenge } : {}),
    ...(typeof s.phone === "string" ? { phone: s.phone } : {}),
    ...(typeof s.redirect === "string" && s.redirect.startsWith("/") ? { redirect: s.redirect } : {}),
  }),
  beforeLoad: ({ search }) => {
    if (!search.challenge) throw redirect({ to: "/login" });
  },
  component: function MfaRoute() {
    const s = Route.useSearch();
    return <MfaPage challenge={s.challenge ?? ""} phone={s.phone ?? "your mobile"} {...(s.redirect ? { redirectTo: s.redirect } : {})} />;
  },
});
