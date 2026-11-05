import { createFileRoute } from "@tanstack/react-router";
import { ConcessionsPage } from "../../../features/fees/concessions/ConcessionsPage";

export const Route = createFileRoute("/_app/fees/concessions")({ component: ConcessionsPage });
