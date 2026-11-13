import { ApiError, feesApi, feesQueries, PAYMENT_METHOD_LABEL, type Receipt } from "@mtb/api";
import { formatDate, formatRs, RECEIPT_NUMBER_PLACEHOLDER } from "@mtb/domain";
import { Banner, Button, ConfirmDialog, EmptyState, Modal, ShortcutHints, Skeleton, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Page, PageHeader, RequirePermission, RequireSingleCampus } from "../../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../../app/session";
import { ReceiptA5 } from "../receipt/ReceiptA5";
import { AddChargePanel } from "../ledger/ChargePanels";
import { FeesNav, useCanAny } from "../shared";
import { ReceiptActionButtons } from "../receipt/ReceiptActions";
import { ChargeTable } from "./ChargeTable";
import { PaymentPanel } from "./PaymentPanel";
import { LeftStudentBanner, StudentSearch, StudentSummaryCard } from "./StudentPanel";
import { useFeeCounter } from "./useFeeCounter";

const SHORTCUTS = [
  { keys: ["F2"], label: "Search" },
  { keys: ["↑", "↓"], label: "Move" },
  { keys: ["Space"], label: "Select" },
  { keys: ["Enter"], label: "Continue" },
  { keys: ["Esc"], label: "Back" },
];

function paymentSummary(state: ReturnType<typeof useFeeCounter>): string {
  const p = state.payment;
  if (p.method === "CASH") return `Cash · received ${formatRs(p.received ?? 0)} · change ${formatRs((p.received ?? 0) - state.payNow)}`;
  if (p.method === "BANK") return `Bank deposit · ${p.bank} · slip ${p.slipNo} · ${p.depositDate ? formatDate(p.depositDate) : ""}`;
  if (p.method === "CHEQUE") return `Cheque ${p.chequeNo} · ${p.chequeBank} · ${p.chequeDate ? formatDate(p.chequeDate) : ""}`;
  return `${PAYMENT_METHOD_LABEL.ONLINE} · ${p.transactionId}`;
}

function CounterBody({ grNo, setGr }: { grNo: string; setGr: (gr: string | undefined) => void }) {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const toast = useToast();
  const queryClient = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);
  const firstPaymentField = useRef<HTMLInputElement>(null);
  const data = useQuery(feesQueries.counter(ctx, grNo));
  const state = useFeeCounter(data.data);
  const [reviewing, setReviewing] = useState(false);
  const [posted, setPosted] = useState<Receipt | null>(null);
  const [addingCharge, setAddingCharge] = useState(false);
  const canCharge = useCanAny(["fees.setup", "fees.collect"]);

  // Start fresh whenever the student changes.
  useEffect(() => {
    state.reset();
    setPosted(null);
    if (!grNo) searchRef.current?.focus();
  }, [grNo]); // eslint-disable-line react-hooks/exhaustive-deps

  // F2 focuses search from anywhere on the counter; Esc goes back a step.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
      if (e.key === "Escape" && !reviewing && !posted && document.activeElement?.closest("[data-counter]")) {
        if (state.selected.size > 0) state.setSelected(new Set());
        else searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const post = useMutation({
    mutationFn: () =>
      feesApi.postReceipt(
        {
          grNo,
          campus: data.data!.student.campus,
          session: ctx.session,
          chargeIds: state.chosen.map((l) => l.charge.id),
          ...(state.partial && state.partialAmount !== null ? { amount: state.partialAmount } : {}),
          payment: (state.checked as { ok: true; payment: Parameters<typeof feesApi.postReceipt>[0]["payment"] }).payment,
          ...(state.paidBy.trim() ? { paidBy: state.paidBy.trim() } : {}),
          ...(state.note.trim() ? { note: state.note.trim() } : {}),
        },
        state.idempotencyKey,
      ),
    onSuccess: (receipt) => {
      setReviewing(false);
      setPosted(receipt);
      toast({ title: `Receipt ${receipt.receiptNo} posted`, message: `${receipt.studentName} · ${formatRs(receipt.total)}` });
      void queryClient.invalidateQueries({ queryKey: ["fees"] });
      void queryClient.invalidateQueries({ queryKey: ["students"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["search"] });
    },
  });

  const continueToPayment = () => {
    if (state.chosen.length === 0) return;
    if (state.canReview) {
      post.reset();
      setReviewing(true);
    } else {
      state.setShowErrors(true);
      firstPaymentField.current?.focus();
    }
  };

  const nextStudent = () => {
    setPosted(null);
    setGr(undefined);
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  const err = post.error instanceof ApiError ? post.error : null;
  const errorText = err ? (err.isNetwork ? "Receipt not posted — safe to try again. The connection dropped before the server replied; nothing was saved." : err.message) : undefined;

  return (
    <div className="grid gap-4" data-counter>
      <ShortcutHints items={SHORTCUTS} />
      {/* Below 1680px the payment box sits under the student card so the charges table keeps room for every column. */}
      <div className="grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)] min-[1680px]:grid-cols-[300px_minmax(0,1fr)_340px]">
        <div className="grid gap-4">
          <StudentSearch inputRef={searchRef} onPick={(gr) => setGr(gr)} />
          {grNo && <StudentSummaryCard grNo={grNo} onSwitch={(gr) => setGr(gr)} {...(canCharge && !readOnly && data.data ? { onAddCharge: () => setAddingCharge(true) } : {})} />}
        </div>

        <div className="grid min-w-0 gap-4 lg:row-span-2 min-[1680px]:row-span-1">
          {!grNo && (
            <div className="mtb-card">
              <EmptyState icon="fees" title="Find a student to start" description="Search by name, G.R. number or father's CNIC. Press F2 to jump to the search box from anywhere on this page." />
            </div>
          )}
          {grNo && data.isLoading && (
            <div className="mtb-card grid gap-3 p-5" aria-busy="true" aria-label="Loading charges">
              <Skeleton width={200} height={20} />
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} height={40} />
              ))}
            </div>
          )}
          {grNo && data.error instanceof ApiError && (
            <div className="mtb-card">
              <EmptyState icon="alertCircle" title={data.error.status === 403 ? "This student belongs to another campus" : "Couldn't load this student"} description={data.error.message} action={<Button onClick={() => setGr(undefined)}>Find another student</Button>} />
            </div>
          )}
          {data.data?.otherCampusDues ? (
            <Banner tone="info" title={`${formatRs(data.data.otherCampusDues)} is also owed at another campus.`}>
              Those dues are collected at the campus that charged them; the fee ledger lists them.
            </Banner>
          ) : null}
          {data.data?.left && <LeftStudentBanner on={formatDate(data.data.left.on)} reason={data.data.left.reason} {...(data.data.left.status ? { status: data.data.left.status } : {})} />}
          {data.data && data.data.charges.length === 0 && (
            <div className="mtb-card">
              <EmptyState
                icon="checkCircle"
                title="All dues cleared"
                description={`${data.data.student.name} (${data.data.student.grNo}, ${data.data.student.classSection}) has nothing to pay.`}
                action={
                  <Button variant="primary" onClick={nextStudent} iconRight="arrowRight">
                    Next student
                  </Button>
                }
              />
            </div>
          )}
          {data.data && data.data.charges.length > 0 && <ChargeTable state={state} readOnly={readOnly} onContinue={continueToPayment} />}
        </div>

        {data.data && data.data.charges.length > 0 && (
          <div className="min-w-0">
            <PaymentPanel state={state} today={data.data.today} onReview={continueToPayment} readOnly={readOnly} firstFieldRef={firstPaymentField} />
          </div>
        )}
      </div>

      {data.data && (
        <ConfirmDialog
          open={reviewing}
          onClose={() => setReviewing(false)}
          onConfirm={() => post.mutate()}
          title="Post this receipt?"
          message={`${data.data.student.name} (${data.data.student.grNo}) · ${data.data.student.classSection} · ${data.data.student.campusName}`}
          details={[
            ...state.chosen.map(
              (l): [string, string] => [l.charge.head + (l.fine.fine ? ` + late fine ${formatRs(l.fine.fine)}` : ""), formatRs(l.lineTotal)],
            ),
            ["Receipt number", RECEIPT_NUMBER_PLACEHOLDER],
            ["Payment", paymentSummary(state)],
            ["Paid by", state.paidBy.trim() || `${state.guardianName} (guardian)`],
            ...(state.note.trim() ? ([["Remarks", state.note.trim()]] as Array<[string, string]>) : []),
          ]}
          confirmLabel={`Post receipt · ${formatRs(state.payNow)}`}
          loading={post.isPending}
          loadingLabel="Posting…"
          warning="Posting can't be undone. To reverse it, cancel the receipt — this needs approval."
          {...(errorText ? { error: errorText } : {})}
        >
          <div className="mt-3 flex items-baseline justify-between rounded-md border border-border px-4 py-3">
            <span className="font-medium">{state.partial ? "Paying now" : "Total"}</span>
            <span className="text-display tabular-nums">{formatRs(state.payNow)}</span>
          </div>
        </ConfirmDialog>
      )}

      {addingCharge && data.data && (
        <AddChargePanel student={{ grNo: data.data.student.grNo, name: data.data.student.name, classSection: data.data.student.classSection, campus: data.data.student.campus }} onClose={() => setAddingCharge(false)} />
      )}

      {posted && (
        <Modal open onClose={nextStudent} size="xl" title={`Receipt ${posted.receiptNo} posted`} description={`${posted.studentName} · ${formatRs(posted.total)} · ${posted.amountInWords}`} footer={<ReceiptActionButtons receipt={posted} onPrinted={(n) => setPosted({ ...posted, printCount: n })} extra={<Button onClick={nextStudent} iconRight="arrowRight">Next student</Button>} />}>
          <div className="overflow-x-auto bg-surface-sunken p-4">
            <ReceiptA5 receipt={posted} duplicate={posted.printCount > 0} />
          </div>
        </Modal>
      )}
    </div>
  );
}

export function FeeCounterPage({ grNo, setGr }: { grNo: string; setGr: (gr: string | undefined) => void }) {
  const navigate = useNavigate();
  const collect = useCan("fees.collect");
  const view = useCan("fees.view");
  // The sidebar's Fees entry opens the counter. Fee office staff who don't take payments
  // (accountant, principal, admin) go to /fees, which sends them to reports or vouchers.
  if (!collect && view) return <Navigate to="/fees" replace />;
  return (
    <RequirePermission permission="fees.collect" page="the fee counter">
      <Page>
        <PageHeader title="Fee counter" actions={grNo ? <Button icon="students" onClick={() => navigate({ to: "/students/$grNo", params: { grNo } })}>Student profile</Button> : undefined} />
        <FeesNav />
        <RequireSingleCampus action="the fee counter">
          <CounterBody grNo={grNo} setGr={setGr} />
        </RequireSingleCampus>
      </Page>
    </RequirePermission>
  );
}
