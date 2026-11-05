import { createFileRoute } from "@tanstack/react-router";
import { StructurePage } from "../../../features/fees/structure/StructurePage";

export const Route = createFileRoute("/_app/fees/structure")({ component: StructurePage });
