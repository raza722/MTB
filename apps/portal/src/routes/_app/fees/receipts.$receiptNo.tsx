import { createFileRoute } from "@tanstack/react-router";
import { ReceiptPage } from "../../../features/fees/ReceiptPage";

export const Route = createFileRoute("/_app/fees/receipts/$receiptNo")({
  component: function ReceiptRoute() {
    const { receiptNo } = Route.useParams();
    return <ReceiptPage receiptNo={receiptNo} />;
  },
});
