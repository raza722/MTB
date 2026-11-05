import { createFileRoute } from "@tanstack/react-router";
import { NoticesPage } from "../../features/notices/NoticesPage";

export const Route = createFileRoute("/_app/notices")({
  component: NoticesPage,
});
