import { dashboardApi, dashboardQueries, type Approval } from "@mtb/api";
import { formatDate, formatDateTime, formatRs, formatTime } from "@mtb/domain";
import { ATTENDANCE_CODE_LABEL, Button, ConfirmDialog, EmptyState, Icon, KeyValue, Segmented, SidePanel, Skeleton, StatusBadge, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useCtx, useReadOnly } from "../../app/session";

const CODE_STATUS = { P: "present", A: "absent", L: "leave", LT: "late", H: "holiday" } as const;

function title(a: Approval) {
  return a.kind === "ATTENDANCE_CORRECTION" ? "Attendance correction" : a.kind === "CHARGE_CANCELLATION" ? "Charge cancellation" : "Receipt cancellation";
}

/** Receipt and charge cancellations are both fee requests. */
const isFee = (a: Approval) => a.kind === "RECEIPT_CANCELLATION" || a.kind === "CHARGE_CANCELLATION";

function Summary({ a }: { a: Approval }) {
  if (a.kind === "ATTENDANCE_CORRECTION") {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="tabular-nums">{formatDate(a.date)}:</span>
        <StatusBadge status={CODE_STATUS[a.from]} /> <Icon name="arrowRight" size={14} className="text-ink-muted" /> <StatusBadge status={CODE_STATUS[a.to]} />
      </span>
    );
  }
  if (a.kind === "CHARGE_CANCELLATION") {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        {a.head} · <span className="tabular-nums">{formatRs(a.amount)}</span> · {a.reason}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="mtb-mono">{a.receiptNo}</span> · <span className="tabular-nums">{formatRs(a.amount)}</span> · {a.reason}
    </span>
  );
}

/**
 * Principal's queue: attendance corrections and receipt cancellations. Approve or reject inline, or open the
 * detail panel. Approving a cancellation is irreversible, so it is confirmed first.
 */
export function ApprovalsCard() {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const toast = useToast();
  const queryClient = useQueryClient();
  const approvals = useQuery(dashboardQueries.approvals(ctx));
  const [filter, setFilter] = useState<"all" | "ATTENDANCE_CORRECTION" | "RECEIPT_CANCELLATION">("all");
  const [detail, setDetail] = useState<Approval | null>(null);
  const [confirming, setConfirming] = useState<Approval | null>(null);

  const decide = useMutation({
    mutationFn: ({ a, decision }: { a: Approval; decision: "APPROVE" | "REJECT" }) => dashboardApi.decide(a.id, decision),
    onSuccess: (res, { a, decision }) => {
      setDetail(null);
      setConfirming(null);
      if (a.kind === "RECEIPT_CANCELLATION") {
        toast(
          decision === "APPROVE"
            ? { title: `Receipt ${a.receiptNo} cancelled`, message: `${a.cnNo} approved. ${a.student.name}'s charges are open again.` }
            : { tone: "info", title: `Cancellation ${a.cnNo} rejected`, message: `Receipt ${a.receiptNo} stands.` },
        );
      } else if (a.kind === "CHARGE_CANCELLATION") {
        toast(
          decision === "APPROVE"
            ? { title: "Charge cancelled", message: `${a.head} (${formatRs(a.amount)}) is off ${a.student.name}'s ledger.` }
            : { tone: "info", title: "Charge cancellation rejected", message: `${a.head} stays on ${a.student.name}'s ledger.` },
        );
      } else {
        toast(
          decision === "APPROVE"
            ? { title: "Correction approved", message: `${a.student.name} · ${formatDate(a.date)} · ${ATTENDANCE_CODE_LABEL[a.from]} → ${ATTENDANCE_CODE_LABEL[a.to]}` }
            : { tone: "info", title: "Correction rejected", message: `${a.student.name} stays ${ATTENDANCE_CODE_LABEL[a.from]} for ${formatDate(a.date)}.` },
        );
      }
      void res;
      void queryClient.invalidateQueries({ queryKey: ["approvals"] });
      void queryClient.invalidateQueries({ queryKey: ["fees"] });
      void queryClient.invalidateQueries({ queryKey: ["students"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
    onError: () => toast({ tone: "danger", title: "Not saved", message: "Someone may have decided this already. Refresh and try again." }),
  });

  const approve = (a: Approval) => (isFee(a) ? setConfirming(a) : decide.mutate({ a, decision: "APPROVE" }));
  const list = (approvals.data ?? []).filter((a) => filter === "all" || a.kind === filter || (filter === "RECEIPT_CANCELLATION" && isFee(a)));
  const counts = {
    att: (approvals.data ?? []).filter((a) => a.kind === "ATTENDANCE_CORRECTION").length,
    cn: (approvals.data ?? []).filter(isFee).length,
  };
  const busyId = decide.isPending ? decide.variables?.a.id : undefined;

  return (
    <section id="approvals" className="mtb-card" aria-labelledby="approvals-title">
      <header className="mtb-card-header flex-wrap">
        <div className="grid">
          <h2 id="approvals-title">Pending approvals</h2>
          <span className="text-small text-ink-muted">
            {counts.att} attendance corrections · {counts.cn} fee cancellations
          </span>
        </div>
        <Segmented
          aria-label="Show"
          value={filter}
          onChange={(v) => setFilter(v as typeof filter)}
          options={[
            { value: "all", label: "All" },
            { value: "ATTENDANCE_CORRECTION", label: `Attendance (${counts.att})` },
            { value: "RECEIPT_CANCELLATION", label: `Fees (${counts.cn})` },
          ]}
        />
      </header>
      {approvals.isLoading && (
        <div className="grid gap-3 p-5" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} height={44} />
          ))}
        </div>
      )}
      {approvals.data && list.length === 0 && <EmptyState icon="checkCircle" title="Nothing waiting for you" description="New corrections and cancellations will appear here." />}
      <ul className="m-0 list-none p-0">
        {list.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3 last:border-b-0">
            <span className={`grid h-9 w-9 place-content-center rounded-full ${isFee(a) ? "bg-warning-tint text-warning-ink" : "bg-info-tint text-info-ink"}`} aria-hidden="true">
              <Icon name={isFee(a) ? "receipt" : "attendance"} size={18} />
            </span>
            <button type="button" onClick={() => setDetail(a)} className="grid min-w-0 flex-1 text-left">
              <span className="font-medium text-ink">
                {title(a)} · {a.student.name} <span className="font-normal text-ink-muted">({a.student.classSection})</span>
              </span>
              <span className="text-small text-ink-muted">
                <Summary a={a} />
              </span>
              <span className="text-small text-ink-muted">
                {a.requestedBy} · {formatDate(a.requestedAt)}, {formatTime(a.requestedAt)}
                {ctx.campus === "ALL" ? ` · ${a.campusName}` : ""}
              </span>
            </button>
            {!readOnly && (
              <span className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={busyId === a.id} onClick={() => decide.mutate({ a, decision: "REJECT" })}>
                  Reject
                </Button>
                <Button size="sm" variant="primary" loading={busyId === a.id && decide.variables?.decision === "APPROVE"} onClick={() => approve(a)}>
                  Approve
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>

      <SidePanel
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? title(detail) : ""}
        description={detail ? `Requested by ${detail.requestedBy} · ${formatDateTime(detail.requestedAt)}` : undefined}
        footer={
          detail && !readOnly ? (
            <>
              <Button onClick={() => decide.mutate({ a: detail, decision: "REJECT" })}>Reject</Button>
              <Button variant="primary" onClick={() => approve(detail)}>
                Approve
              </Button>
            </>
          ) : undefined
        }
      >
        {detail?.kind === "ATTENDANCE_CORRECTION" && (
          <KeyValue
            items={[
              ["Student", <Link to="/students/$grNo" params={{ grNo: detail.student.grNo }} className="text-brand-ink underline-offset-2 hover:underline">{`${detail.student.name} (${detail.student.grNo})`}</Link>],
              ["Class", detail.student.classSection],
              ["Date", formatDate(detail.date)],
              ["Change", <Summary a={detail} />],
              ["Reason", detail.reason],
              ["Campus", detail.campusName],
            ]}
          />
        )}
        {detail?.kind === "RECEIPT_CANCELLATION" && (
          <div className="grid gap-4">
            <KeyValue
              items={[
                ["Cancellation", <span className="mtb-mono">{detail.cnNo}</span>],
                ["Receipt", <Link to="/fees/receipts/$receiptNo" params={{ receiptNo: detail.receiptNo }} className="mtb-mono text-brand-ink underline-offset-2 hover:underline">{detail.receiptNo}</Link>],
                ["Student", `${detail.student.name} (${detail.student.grNo}) · ${detail.student.classSection}`],
                ["Amount", formatRs(detail.amount)],
                ["Reason", detail.reason],
                ["Note", detail.note],
              ]}
            />
            <p className="m-0 text-small text-ink-muted">Approving marks the receipt Cancelled and reopens its charges. The receipt number is never reused.</p>
          </div>
        )}
        {detail?.kind === "CHARGE_CANCELLATION" && (
          <div className="grid gap-4">
            <KeyValue
              items={[
                ["Student", <Link to="/students/$grNo" params={{ grNo: detail.student.grNo }} search={(prev: Record<string, unknown>) => ({ ...prev, tab: "ledger" }) as never} className="text-brand-ink underline-offset-2 hover:underline">{`${detail.student.name} (${detail.student.grNo})`}</Link>],
                ["Class", detail.student.classSection],
                ["Charge", detail.head],
                ["Amount", formatRs(detail.amount)],
                ["Due", formatDate(detail.dueDate)],
                ["Reason", detail.reason],
              ]}
            />
            <p className="m-0 text-small text-ink-muted">Approving takes the unpaid charge off the student's ledger. It stays on record as cancelled.</p>
          </div>
        )}
      </SidePanel>

      <ConfirmDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        onConfirm={() => confirming && decide.mutate({ a: confirming, decision: "APPROVE" })}
        tone="danger"
        title={confirming?.kind === "RECEIPT_CANCELLATION" ? `Cancel receipt ${confirming.receiptNo}?` : confirming?.kind === "CHARGE_CANCELLATION" ? `Cancel ${confirming.head}?` : "Approve?"}
        message={
          confirming?.kind === "CHARGE_CANCELLATION"
            ? "The unpaid charge comes off the student's ledger and stays on record as cancelled. This can't be undone."
            : "The receipt will be marked Cancelled and its charges reopen in the student's ledger. This can't be undone."
        }
        details={
          confirming && confirming.kind !== "ATTENDANCE_CORRECTION"
            ? [
                ["Student", `${confirming.student.name} (${confirming.student.grNo})`],
                ["Amount", formatRs(confirming.amount)],
                ["Reason", confirming.reason],
                ["Requested by", confirming.requestedBy],
              ]
            : []
        }
        confirmLabel="Approve cancellation"
        loading={decide.isPending}
        loadingLabel="Approving…"
      />
    </section>
  );
}
