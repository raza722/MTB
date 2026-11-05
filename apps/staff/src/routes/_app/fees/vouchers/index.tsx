import { createFileRoute } from "@tanstack/react-router";
import { VouchersPage } from "../../../../features/fees/vouchers/VouchersPage";

/** /fees/vouchers — bank voucher runs and every voucher with its status. */
export const Route = createFileRoute("/_app/fees/vouchers/")({ component: () => <VouchersPage /> });
