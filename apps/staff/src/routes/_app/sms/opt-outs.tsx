import { createFileRoute } from "@tanstack/react-router";
import { OptOutsPage } from "../../../features/sms";

/** /sms/opt-outs — guardians who asked not to get notices. */
export const Route = createFileRoute("/_app/sms/opt-outs")({
  component: OptOutsPage,
});
