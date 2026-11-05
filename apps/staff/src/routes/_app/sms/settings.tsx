import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "../../../features/sms";

/** /sms/settings — SMS companies per campus, rates, budget, approval limit, quiet hours and the kill switch. */
export const Route = createFileRoute("/_app/sms/settings")({
  component: SettingsPage,
});
