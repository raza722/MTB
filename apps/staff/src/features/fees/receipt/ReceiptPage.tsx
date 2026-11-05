import { ApiError, CANCEL_REASON_LABEL, feesApi, feesQueries, newIdempotencyKey, type CancelReason, type Receipt } from "@mtb/api";
import { formatDate, formatDateTime, formatRs } from "@mtb/domain";
import { Banner, Button, EmptyState, KeyValue, Select, SidePanel, Skeleton, StatusBadge, Textarea, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Page, PageHeader, RequirePermission } from "../../../app/shell/page";
import { useCan, useReadOnly } from "../../../app/session";
import { ReceiptA5 } from "./ReceiptA5";
import { ReceiptActionButtons } from "./ReceiptActions";
import { FeesNav } from "../shared";

const STATUS: Record<Receipt["status"], { status: "paid" | "pending" | "cancelled"; label: string }> = {
  POSTED: { status: "paid", label: "Posted" },
  CANCEL_PENDING: { status: "pending", label: "Cancellation pending approval" },
  CANCELLED: { status: "cancelled", label: "Cancelled" },
};

/** Cancel receipt: pick a reason, add a note, and a cancellation document goes to the principal for approval. */
function CancelReceiptPanel({ receipt, open, onClose }: { receipt: Receipt; open: boolean; onClose: () => void }) {
  const [reason, setReason] = useState<CancelReason | "">("");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const toast = useToast();
  const queryClient = useQueryClient();
  const key = useMemo(() => newIdempotencyKey(), [receipt.receiptNo, open]); // eslint-disable-line react-hooks/exhaustive-deps
  const cancel = useMutation({
    mutationFn: () => feesApi.requestCancellation(receipt.receiptNo, { reason: reason as CancelReason, note }, key),
    onSuccess: (cn) => {
      toast({ title: `Cancellation ${cn.cnNo} sent for approval`, message: `Receipt ${receipt.receiptNo} stays valid until the principal approves.` });
      void queryClient.invalidateQueries({ queryKey: ["fees"] });
      void queryClient.invalidateQueries({ queryKey: ["approvals"] });
      onClose();
    },
  });
  const submit = () => {
    setTried(true);
    if (reason && note.trim()) cancel.mutate();
  };
  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title="Cancel receipt"
      description={`${receipt.receiptNo} · ${receipt.studentName} · ${formatRs(receipt.total)}`}
      footer={
        <>
          <Button onClick={onClose}>Keep receipt</Button>
          <Button variant="danger" onClick={submit} loading={cancel.isPending} loadingLabel="Sending…">
            Request cancellation
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <Banner tone="info">
          This creates a cancellation document for the principal to approve. When approved, the receipt is marked Cancelled (its number is never reused) and its charges reopen in the ledger.
        </Banner>
        <KeyValue
          items={[
            ["Posted", formatDateTime(receipt.postedAt)],
            ["Cashier", receipt.cashier],
            ["Charges", receipt.lines.map((l) => l.head).join(", ")],
            ["Total", formatRs(receipt.total)],
          ]}
        />
        <Select
          label="Reason"
          required
          value={reason}
          onChange={(e) => setReason(e.target.value as CancelReason)}
          error={tried && !reason ? "Choose a reason." : undefined}
          options={[{ value: "", label: "Choose…" }, ...(Object.keys(CANCEL_REASON_LABEL) as CancelReason[]).map((r) => ({ value: r, label: CANCEL_REASON_LABEL[r] }))]}
        />
        <Textarea
          label="Note"
          required
          rows={4}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What went wrong, in a sentence. For example: the concession of Rs 850 was not applied."
          error={tried && !note.trim() ? "Add a note saying what went wrong." : undefined}
          help="The principal sees this note when approving."
        />
        {cancel.error instanceof ApiError && <Banner tone="danger">{cancel.error.isNetwork ? "Not sent — safe to try again." : cancel.error.message}</Banner>}
      </div>
    </SidePanel>
  );
}

export function ReceiptPage({ receiptNo }: { receiptNo: string }) {
  const receipt = useQuery(feesQueries.receipt(receiptNo));
  const canCancel = useCan("fees.cancel.request");
  const readOnly = useReadOnly();
  const [cancelling, setCancelling] = useState(false);
  const r = receipt.data;

  return (
    <RequirePermission permission="fees.view" page="receipts">
      <Page>
        <PageHeader
          title={`Receipt ${receiptNo}`}
          {...(r ? { context: `${r.campusName} · ${r.studentName} (${r.grNo}) · ${formatDateTime(r.postedAt)}` } : {})}
          meta={r ? <StatusBadge status={STATUS[r.status].status}>{STATUS[r.status].label}</StatusBadge> : undefined}
          actions={
            r ? (
              <ReceiptActionButtons
                receipt={r}
                extra={
                  canCancel && r.status === "POSTED" && !readOnly ? (
                    <Button variant="danger-quiet" icon="ban" onClick={() => setCancelling(true)}>
                      Cancel receipt
                    </Button>
                  ) : undefined
                }
              />
            ) : undefined
          }
        />
        <FeesNav />
        {receipt.isLoading && <Skeleton height={600} />}
        {receipt.error && (
          <div className="mtb-card">
            <EmptyState icon="receipt" title="Receipt not found" description={`There is no receipt numbered ${receiptNo}. Check the number on the parent's copy.`} />
          </div>
        )}
        {r?.status === "CANCEL_PENDING" && r.cancellation && (
          <Banner tone="warning" title={`Cancellation ${r.cancellation.cnNo} is waiting for the principal's approval.`}>
            Requested by {r.cancellation.requestedBy} on {formatDateTime(r.cancellation.requestedAt)} · {CANCEL_REASON_LABEL[r.cancellation.reason]}: {r.cancellation.note} The receipt stays valid until it is approved.
          </Banner>
        )}
        {r?.status === "CANCELLED" && r.cancellation && (
          <Banner tone="neutral" title={`Cancelled by ${r.cancellation.cnNo}.`}>
            Approved by {r.cancellation.decidedBy} on {r.cancellation.decidedAt ? formatDate(r.cancellation.decidedAt) : ""}. Its charges are open again in the ledger; this receipt number is never reused.
          </Banner>
        )}
        {r?.cancellation?.status === "REJECTED" && (
          <Banner tone="info" title={`Cancellation ${r.cancellation.cnNo} was rejected.`}>
            Rejected by {r.cancellation.decidedBy}. The receipt stands.
          </Banner>
        )}
        {r && (
          <div className="grid items-start gap-6 xl:grid-cols-[auto_minmax(0,1fr)]">
            <div className="overflow-x-auto rounded-lg bg-surface-sunken p-4">
              <ReceiptA5 receipt={r} duplicate={r.printCount > 0} />
            </div>
            <div className="mtb-card grid gap-3 p-5">
              <h2 className="m-0 text-title-3">About this receipt</h2>
              <KeyValue
                items={[
                  ["Student", <Link to="/students/$grNo" params={{ grNo: r.grNo }} className="text-brand-ink underline-offset-2 hover:underline">{`${r.studentName} (${r.grNo})`}</Link>],
                  ["Class", r.classSection],
                  ["Printed", r.printCount === 0 ? "Not printed yet" : `${r.printCount} ${r.printCount === 1 ? "time" : "times"} — reprints say DUPLICATE`],
                  ["Total", formatRs(r.total)],
                ]}
              />
              <p className="m-0 text-small text-ink-muted">Posted receipts can't be edited. To reverse one, cancel it; the principal approves the cancellation.</p>
            </div>
          </div>
        )}
        {r && <CancelReceiptPanel receipt={r} open={cancelling} onClose={() => setCancelling(false)} />}
      </Page>
    </RequirePermission>
  );
}
