import { createFileRoute } from "@tanstack/react-router";
import { VoucherPage } from "../../../features/fees/VoucherPage";

export const Route = createFileRoute("/_app/fees/voucher")({
  component: VoucherPage,
});
