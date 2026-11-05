import { createFileRoute } from "@tanstack/react-router";
import { FinesPage } from "../../../features/fees/fines/FinesPage";

export const Route = createFileRoute("/_app/fees/fines")({ component: FinesPage });
