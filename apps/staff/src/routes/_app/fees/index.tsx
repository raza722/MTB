import { createFileRoute } from "@tanstack/react-router";
import { FeesIndex } from "../../../features/fees/FeesIndex";

export const Route = createFileRoute("/_app/fees/")({ component: FeesIndex });
