import { createFileRoute } from "@tanstack/react-router";
import { VerifyPage } from "../../features/auth/VerifyPage";

export const Route = createFileRoute("/sign-in/verify")({
  component: VerifyPage,
});
