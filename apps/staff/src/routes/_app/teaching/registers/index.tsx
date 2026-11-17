import { createFileRoute } from "@tanstack/react-router";
import { RegistersPage } from "../../../../features/teaching";

/** /teaching/registers — the class teacher's registers: today, the last school days and change requests. */
export const Route = createFileRoute("/_app/teaching/registers/")({ component: RegistersPage });
