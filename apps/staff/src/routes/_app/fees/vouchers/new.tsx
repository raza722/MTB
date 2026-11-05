import { createFileRoute } from "@tanstack/react-router";
import { GenerateVouchersPage } from "../../../../features/fees/vouchers/GenerateVouchersPage";

/** /fees/vouchers/new — choose, check, generate and print a month's vouchers. */
export const Route = createFileRoute("/_app/fees/vouchers/new")({ component: GenerateVouchersPage });
