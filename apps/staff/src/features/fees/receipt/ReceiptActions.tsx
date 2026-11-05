import { feesApi, feesQueries, type Receipt } from "@mtb/api";
import { formatMobile } from "@mtb/domain";
import { Button, useToast } from "@mtb/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";

/** Print (the first print is the original; later prints are DUPLICATE), PDF and SMS to guardian. */
export function useReceiptActions(receipt: Receipt | undefined, onPrinted?: (printCount: number) => void) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const print = useMutation({
    mutationFn: async () => {
      // Print first so the original prints without the watermark; then record the print.
      window.print();
      return feesApi.markPrinted(receipt!.receiptNo);
    },
    onSuccess: (r) => {
      onPrinted?.(r.printCount);
      void queryClient.invalidateQueries({ queryKey: feesQueries.receipt(receipt!.receiptNo).queryKey });
    },
  });
  const sms = useMutation({
    mutationFn: () => feesApi.smsReceipt(receipt!.receiptNo),
    onSuccess: (r) => toast({ title: "Receipt SMS queued", message: `To ${formatMobile(r.to)}. It will arrive in a minute.` }),
    onError: () => toast({ tone: "danger", title: "SMS not queued", message: "Try again in a moment." }),
  });
  const pdf = () => {
    toast({ tone: "info", title: "Choose “Save as PDF” in the print dialog", message: "In the live system the server generates the official PDF." });
    window.print();
  };
  return { print, sms, pdf };
}

export function ReceiptActionButtons({ receipt, onPrinted, extra }: { receipt: Receipt; onPrinted?: (printCount: number) => void; extra?: React.ReactNode }) {
  const { print, sms, pdf } = useReceiptActions(receipt, onPrinted);
  return (
    <>
      <Button variant="primary" icon="printer" onClick={() => print.mutate()} loading={print.isPending}>
        Print
      </Button>
      <Button icon="download" onClick={pdf}>
        Download PDF
      </Button>
      <Button icon="send" onClick={() => sms.mutate()} loading={sms.isPending} disabled={receipt.status === "CANCELLED"}>
        SMS to guardian
      </Button>
      {extra}
    </>
  );
}
