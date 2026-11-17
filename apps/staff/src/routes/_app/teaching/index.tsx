import { createFileRoute } from "@tanstack/react-router";
import { TodayPage } from "../../../features/teaching";

/** /teaching — today's register, classes, marks to enter and the next closed day. */
export const Route = createFileRoute("/_app/teaching/")({ component: TodayPage });
