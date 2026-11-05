import { createFileRoute } from "@tanstack/react-router";
import { DefaultersPage } from "../../../features/fees/defaulters/DefaultersPage";

export const Route = createFileRoute("/_app/fees/defaulters")({ component: DefaultersPage });
