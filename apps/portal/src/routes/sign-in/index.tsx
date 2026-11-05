import { createFileRoute } from "@tanstack/react-router";
import { SignInPage } from "../../features/auth/SignInPage";

export const Route = createFileRoute("/sign-in/")({
  validateSearch: (s: Record<string, unknown>): { as?: "student"; expired?: boolean } => ({
    ...(s.as === "student" ? { as: "student" as const } : {}),
    ...(s.expired === true || s.expired === "true" ? { expired: true } : {}),
  }),
  component: function SignInRoute() {
    const { as, expired } = Route.useSearch();
    return <SignInPage {...(as ? { as } : {})} {...(expired ? { expired } : {})} />;
  },
});
