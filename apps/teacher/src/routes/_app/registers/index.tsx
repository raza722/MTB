import { createFileRoute } from "@tanstack/react-router";
import { RegistersPage } from "../../../features/registers/RegistersPage";

export const Route = createFileRoute("/_app/registers/")({
  component: RegistersPage,
});
