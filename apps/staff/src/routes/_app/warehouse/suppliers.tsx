import { createFileRoute } from "@tanstack/react-router";
import { SuppliersPage } from "../../../features/warehouse";

export const Route = createFileRoute("/_app/warehouse/suppliers")({
  component: SuppliersPage,
});
