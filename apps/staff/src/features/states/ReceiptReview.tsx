import { ApiError } from "@mtb/api";
import { formatRs, RECEIPT_NUMBER_PLACEHOLDER } from "@mtb/domain";
import { ConfirmDialog, useToast } from "@mtb/ui";
import { useMutation } from "@tanstack/react-query";
import { AYESHA, AYESHA_OVERDUE, OVERDUE_TOTAL, RECEIPT_NO, reviewLines } from "./demo";
import { wait } from "./kit";

/** The fee counter's wording for a dropped connection, word for word. */
export const NOT_POSTED = "Receipt not posted — safe to try again. The connection dropped before the server replied; nothing was saved.";

/**
 * The fee counter's review step, on the same ConfirmDialog: student, charges, payment and a large total, a button
 * that names the amount, the "can't be undone" warning, and "Posting…" while it works. `shouldFail` makes the
 * attempt fail as if the connection dropped, to show the network error and a safe retry.
 */
export function ReceiptReviewDialog({
  open,
  onClose,
  onPosted,
  payment,
  shouldFail,
}: {
  open: boolean;
  onClose: () => void;
  onPosted: (receiptNo: string) => void;
  /** "Cash · received Rs 13,000 · change Rs 750" */
  payment: string;
  /** Asked at the moment of posting, so a switch can change it between attempts. */
  shouldFail?: () => boolean;
}) {
  const toast = useToast();
  const post = useMutation({
    mutationFn: async () => {
      await wait(1100);
      if (shouldFail?.()) throw new ApiError(0, "NETWORK", "No response from the server.");
      return RECEIPT_NO;
    },
    onSuccess: (no) => {
      toast({ title: `Receipt ${no} posted`, message: `${AYESHA.name} · ${formatRs(OVERDUE_TOTAL)}` });
      onPosted(no);
    },
  });
  const err = post.error instanceof ApiError ? post.error : null;
  return (
    <ConfirmDialog
      open={open}
      onClose={() => {
        post.reset();
        onClose();
      }}
      onConfirm={() => post.mutate()}
      title="Post this receipt?"
      message={`${AYESHA.name} (${AYESHA.grNo}) · ${AYESHA.classSection} · ${AYESHA.campus}`}
      details={[...reviewLines(AYESHA_OVERDUE), ["Receipt number", RECEIPT_NUMBER_PLACEHOLDER], ["Payment", payment]]}
      confirmLabel={`Post receipt · ${formatRs(OVERDUE_TOTAL)}`}
      loading={post.isPending}
      loadingLabel="Posting…"
      warning="Posting can't be undone. To reverse it, cancel the receipt — this needs approval."
      {...(err ? { error: err.isNetwork ? NOT_POSTED : err.message } : {})}
    >
      <div className="mt-3 flex items-baseline justify-between rounded-md border border-border px-4 py-3">
        <span className="font-medium">Total</span>
        <span className="text-display tabular-nums">{formatRs(OVERDUE_TOTAL)}</span>
      </div>
    </ConfirmDialog>
  );
}
