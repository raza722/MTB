import { createFileRoute } from "@tanstack/react-router";
import { LoansPage } from "../../../features/hr";

/** /hr/loans — staff loans and salary advances. */
export const Route = createFileRoute("/_app/hr/loans")({ component: LoansPage });
