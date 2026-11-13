import { newIdempotencyKey, SMS_CATEGORY_LABEL, smsApi, smsQueries, type SmsBatch, type SmsBatchStatus, type SmsChannel, type SmsDeliveryRow } from "@mtb/api";
import { formatCount, formatDateTime, formatRs, pakistanToday, type IsoDate } from "@mtb/domain";
import { Banner, Button, ConfirmDialog, DataTable, DatePicker, EmptyState, Input, KeyValue, Modal, Pagination, Segmented, SegmentedBar, Select, SidePanel, Skeleton, StatusBadge, Textarea, useToast, type Column } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import { BatchProgress, BatchStatus, ChannelLabel, errorField, errorText, isLaterThanNow, isoAt, LoadError, MessagesShell, pkDateOf, pkTimeOf, TIME_SLOTS, whenText } from "./shell";
import { SmsBubble } from "./sms-text";

export interface OutboxSearch {
  status?: SmsBatchStatus;
  batch?: string;
}

const PAGE = 20;

/** /sms/outbox — every send with its status: waiting for approval, scheduled, sending, sent, cancelled. */
export function OutboxPage({ search, setSearch }: { search: OutboxSearch; setSearch: (next: OutboxSearch) => void }) {
  const ctx = useCtx();
  // Nothing sends from this system (a released batch stays held), so there is no progress to follow closely.
  const all = useQuery({ ...smsQueries.batches(ctx), refetchInterval: 15_000 });
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState<"" | SmsChannel>("");
  const [page, setPage] = useState(1);
  const list = all.data ?? [];
  const count = (s: SmsBatchStatus) => list.filter((b) => b.status === s).length;
  const q = query.trim().toLowerCase();
  const rows = list.filter((b) => (!search.status || b.status === search.status) && (!channel || b.channel === channel) && (!q || `${b.templateName} ${b.audienceLabel} ${b.createdBy} ${b.source}`.toLowerCase().includes(q)));
  const pageRows = rows.slice((page - 1) * PAGE, page * PAGE);

  const columns: Array<Column<SmsBatch>> = [
    {
      key: "when",
      header: "When",
      width: 150,
      render: (b) => (
        <span className="grid">
          <span className="mtb-num">{whenText(b.status === "SCHEDULED" || (b.status === "AWAITING_APPROVAL" && b.scheduledFor) ? (b.scheduledFor ?? b.createdAt) : (b.sentAt ?? b.createdAt))}</span>
          <span className="mtb-cell-secondary">{b.status === "SCHEDULED" ? "scheduled" : b.createdBy}</span>
        </span>
      ),
    },
    {
      key: "message",
      header: "Message",
      render: (b) => (
        <span className="grid min-w-0">
          <span className="mtb-cell-primary truncate">{b.templateName}</span>
          <span className="mtb-cell-secondary truncate">
            {b.audienceLabel}
            {ctx.campus === "ALL" ? ` · ${campusLabel(b.campus)}` : ""}
          </span>
        </span>
      ),
    },
    { key: "channel", header: "Sent as", width: 120, render: (b) => <ChannelLabel channel={b.channel} short /> },
    { key: "recipients", header: "Recipients", align: "right", width: 100, render: (b) => <span className="mtb-num">{formatCount(b.recipients)}</span> },
    { key: "delivery", header: "Delivery", width: 210, render: (b) => <BatchProgress b={b} /> },
    { key: "cost", header: "Cost", align: "right", width: 90, render: (b) => <span className="mtb-num">{formatRs(b.estCost)}</span> },
    { key: "status", header: "Status", width: 170, render: (b) => <BatchStatus status={b.status} /> },
  ];

  return (
    <MessagesShell title="Outbox">
      {all.error && !all.data ? (
        <LoadError what="The outbox" error={all.error} onRetry={() => void all.refetch()} />
      ) : (
        <DataTable
          caption="Messages sent and waiting"
          columns={columns}
          rows={pageRows}
          rowKey="id"
          loading={all.isPending}
          onRowClick={(b) => setSearch({ ...search, batch: b.id })}
          empty={<EmptyState icon="inbox" title={search.status || q || channel ? "No messages match" : "Nothing sent yet"} description={search.status || q || channel ? "Try another status or clear the search." : "Messages you send or schedule appear here."} />}
          toolbar={
            <div className="flex flex-wrap items-center gap-3">
              <Segmented
                aria-label="Show"
                value={search.status ?? ""}
                onChange={(v) => {
                  setPage(1);
                  setSearch({ ...(v ? { status: v as SmsBatchStatus } : {}) });
                }}
                options={[
                  { value: "", label: "All" },
                  { value: "AWAITING_APPROVAL", label: `Waiting${count("AWAITING_APPROVAL") ? ` (${count("AWAITING_APPROVAL")})` : ""}` },
                  { value: "SCHEDULED", label: `Scheduled${count("SCHEDULED") ? ` (${count("SCHEDULED")})` : ""}` },
                  { value: "SENT", label: "Sent" },
                  { value: "CANCELLED", label: "Cancelled" },
                ]}
              />
              <div className="w-56">
                <Select aria-label="Sent as" value={channel} onChange={(e) => setChannel(e.target.value as "" | SmsChannel)} options={[{ value: "", label: "SMS and app" }, { value: "APP_FIRST", label: "App first, then SMS" }, { value: "SMS", label: "SMS only" }, { value: "APP", label: "App only" }]} />
              </div>
              <div className="w-64">
                <Input aria-label="Search the outbox" icon="search" placeholder="Message, class or sender" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} />
              </div>
            </div>
          }
          pagination={rows.length > PAGE ? <Pagination page={page} pageSize={PAGE} total={rows.length} onPageChange={setPage} /> : undefined}
        />
      )}
      <BatchPanel id={search.batch ?? null} onClose={() => setSearch({ ...(search.status ? { status: search.status } : {}) })} />
    </MessagesShell>
  );
}

const CANCEL_REASONS = ["Wrong message or wrong date", "Sent to the wrong classes", "No longer needed", "Will send it another way"];

function BatchPanel({ id, onClose }: { id: string | null; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canApprove = useCan("approvals.decide");
  const canSend = useCan("sms.send");
  const readOnly = useReadOnly();
  const q = useQuery(smsQueries.batch(ctx, id));
  const b = q.data;
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [note, setNote] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState(CANCEL_REASONS[0]!);
  const [moveOpen, setMoveOpen] = useState(false);
  const [date, setDate] = useState<IsoDate | null>(null);
  const [time, setTime] = useState("08:00");
  const [moveError, setMoveError] = useState<string | null>(null);
  // One key per retry-unsafe action until it succeeds, so a retry after a lost reply can't act twice.
  const keys = useRef<Record<string, string>>({});
  const keyOf = (action: string) => (keys.current[`${id}:${action}`] ??= newIdempotencyKey());
  const doneKey = (action: string) => delete keys.current[`${id}:${action}`];

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["sms"] });
  };
  const decide = useMutation({
    mutationFn: (d: "approve" | "reject") => smsApi.decideBatch(id!, d, d === "reject" ? note : undefined, keyOf(`decide-${d}`)),
    onSuccess: async (r, d) => {
      doneKey(`decide-${d}`);
      setApproveOpen(false);
      setRejectOpen(false);
      await refresh();
      toast(d === "approve" ? { title: r.status === "SCHEDULED" ? `Approved · goes ${whenText(r.scheduledFor!)}` : `Approved · ${formatCount(r.recipients)} messages held`, message: `${r.templateName}. The messages stay in the Outbox: nothing is sent from this system.` } : { tone: "warning", title: "Not approved", message: `${r.createdBy} will see your note in the Outbox.` });
    },
  });
  const cancel = useMutation({
    mutationFn: () => smsApi.cancelBatch(id!, reason),
    onSuccess: async (r) => {
      setCancelOpen(false);
      await refresh();
      toast({ title: "Message cancelled", message: `${r.templateName} won't be sent. Nothing was charged.` });
    },
  });
  const now = useMutation({
    mutationFn: () => smsApi.sendBatchNow(id!, keyOf("send-now")),
    onSuccess: async (r) => {
      doneKey("send-now");
      await refresh();
      toast({ title: `Released · ${formatCount(r.recipients)} messages held`, message: `${r.templateName}. Nothing is sent from this system.` });
    },
    onError: (e) => toast({ tone: "danger", title: "Not released", message: errorText(e) }),
  });
  const move = useMutation({
    mutationFn: (at: string) => smsApi.rescheduleBatch(id!, at),
    onSuccess: async (r) => {
      setMoveOpen(false);
      await refresh();
      toast({ title: `Moved to ${whenText(r.scheduledFor!)}`, message: r.templateName });
    },
    onError: (e) => setMoveError(errorText(e)),
  });
  const retry = useMutation({
    mutationFn: () => smsApi.retryFailed(ctx, id!, keyOf("retry")),
    onSuccess: async ({ retried }) => {
      doneKey("retry");
      await refresh();
      toast(retried ? { title: `Retrying ${formatCount(retried)} failed SMS`, message: "They are held in the outbox: nothing is sent from this system." } : { tone: "info", title: "Nothing to retry", message: "Failed messages from the old system are kept as they were. Nothing is sent from this system." });
    },
    onError: (e) => toast({ tone: "danger", title: "Retry not started", message: errorText(e) }),
  });

  const c = b?.counts;
  const smsTotal = c ? c.delivered + c.failed + c.sent + c.queued : 0;

  const rowColumns: Array<Column<SmsDeliveryRow>> = [
    { key: "who", header: "To", render: (r) => <span className="grid"><span className="mtb-cell-primary">{r.studentName}</span><span className="mtb-cell-secondary"><span className="mtb-mono">{r.mobile}</span></span></span> },
    { key: "via", header: "By", width: 70, render: (r) => (r.channel === "APP" ? "App" : `SMS · ${r.parts ?? 1}`) },
    { key: "status", header: "Status", width: 120, render: (r) => <StatusBadge status={r.status} /> },
  ];

  const footer = b && !readOnly && (
    <>
      {b.status === "AWAITING_APPROVAL" && (
        <>
          {canSend && (
            <Button variant="quiet" onClick={() => setCancelOpen(true)}>
              Cancel message
            </Button>
          )}
          {canApprove ? (
            <div className="flex gap-2">
              <Button onClick={() => { setNote(""); decide.reset(); setRejectOpen(true); }}>Don't approve</Button>
              <Button variant="primary" icon="check" onClick={() => { decide.reset(); setApproveOpen(true); }}>
                Approve
              </Button>
            </div>
          ) : (
            <span className="text-small text-ink-muted">Waiting for the principal.</span>
          )}
        </>
      )}
      {b.status === "SCHEDULED" && canSend && (
        <>
          <Button variant="quiet" onClick={() => setCancelOpen(true)}>
            Cancel message
          </Button>
          <div className="flex gap-2">
            <Button
              icon="clock"
              onClick={() => {
                setDate(b.scheduledFor ? pkDateOf(b.scheduledFor) : null);
                const t = b.scheduledFor ? pkTimeOf(b.scheduledFor) : "08:00";
                setTime(TIME_SLOTS.some((x) => x.value === t) ? t : "08:00");
                setMoveError(null);
                setMoveOpen(true);
              }}
            >
              Change time
            </Button>
            <Button variant="primary" icon="send" loading={now.isPending} loadingLabel="Releasing…" onClick={() => now.mutate()}>
              Send now
            </Button>
          </div>
        </>
      )}
      {(b.status === "SENDING" || b.status === "SENT") && (
        <>
          <Link to="/sms/delivery" search={{ batch: b.id } as never} className="text-small font-medium text-brand-ink">
            See every recipient
          </Link>
          {canSend && c && c.failed > 0 && (
            <Button icon="refresh" loading={retry.isPending} loadingLabel="Retrying…" onClick={() => retry.mutate()}>
              Retry {formatCount(c.failed)} failed
            </Button>
          )}
        </>
      )}
    </>
  );

  return (
    <SidePanel open={id !== null} onClose={onClose} title={b?.templateName ?? "Message"} description={b ? b.audienceLabel : undefined} wide {...(footer ? { footer } : {})}>
      {q.isPending ? (
        <div className="grid gap-3">
          <Skeleton height={24} />
          <Skeleton height={120} />
          <Skeleton height={160} />
        </div>
      ) : q.error || !b ? (
        <LoadError what="This message" error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="grid gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <BatchStatus status={b.status} />
            <span className="text-small text-ink-muted">
              {b.status === "SCHEDULED" ? `Goes ${whenText(b.scheduledFor!)}` : b.status === "AWAITING_APPROVAL" ? `Asked ${whenText(b.createdAt)}${b.scheduledFor ? ` · to go ${whenText(b.scheduledFor)}` : ""}` : b.sentAt ? `Sent ${whenText(b.sentAt)}` : ""}
            </span>
          </div>
          {b.status === "REJECTED" && b.decisionNote && <Banner tone="danger" title={`Not approved by ${b.decidedBy}.`}>{b.decisionNote}</Banner>}
          {b.status === "CANCELLED" && <Banner tone="neutral" title={`Cancelled by ${b.decidedBy ?? "staff"}.`}>{b.decisionNote ?? "Nothing was sent or charged."}</Banner>}

          {(b.status === "SENDING" || b.status === "SENT") && c && (
            <section className="grid gap-2" aria-label="Delivery">
              <SegmentedBar
                label="Delivery"
                format={formatCount}
                segments={[
                  { key: "app", label: "App delivered", value: c.app, color: "var(--chart-1)" },
                  { key: "delivered", label: "SMS sent", value: c.delivered + c.sent, color: "var(--status-paid)" },
                  { key: "way", label: "Held in the outbox", value: c.queued, color: "var(--info)" },
                  { key: "failed", label: "Failed", value: c.failed, color: "var(--danger)" },
                  { key: "optedout", label: "Opted out", value: c.optedout, color: "var(--ink-subtle)" },
                ]}
              />
              <ul className="sms-legend">
                <li><span className="mtb-chart-key" style={{ background: "var(--chart-1)" }} aria-hidden="true" />App notifications delivered<b>{formatCount(c.app)}</b><span className="w-24 text-right">{formatCount(c.appRead)} opened</span></li>
                <li><span className="mtb-chart-key" style={{ background: "var(--status-paid)" }} aria-hidden="true" />SMS sent<b>{formatCount(c.delivered + c.sent)}</b><span className="w-24 text-right">of {formatCount(smsTotal)}</span></li>
                <li><span className="mtb-chart-key" style={{ background: "var(--info)" }} aria-hidden="true" />Held in the outbox<b>{formatCount(c.queued)}</b><span className="w-24" /></li>
                <li><span className="mtb-chart-key" style={{ background: "var(--danger)" }} aria-hidden="true" />Failed<b>{formatCount(c.failed)}</b><span className="w-24" /></li>
                {c.optedout > 0 && <li><span className="mtb-chart-key" style={{ background: "var(--ink-subtle)" }} aria-hidden="true" />Opted out, skipped<b>{formatCount(c.optedout)}</b><span className="w-24" /></li>}
              </ul>
            </section>
          )}

          <KeyValue
            items={[
              ["Kind", SMS_CATEGORY_LABEL[b.category]],
              ["Sent as", <ChannelLabel key="c" channel={b.channel} />],
              ["Recipients", `${formatCount(b.recipients)} · ${formatCount(b.appRecipients)} by app, ${formatCount(b.smsRecipients)} by SMS`],
              ["SMS parts", formatCount(b.segments)],
              ["Cost", `${formatRs(b.estCost)}${b.saved ? ` · the app saved ${formatRs(b.saved)}` : ""}`],
              ["Language", b.language === "ur" ? "Urdu" : "English"],
              ["Asked by", `${b.createdBy} · ${formatDateTime(b.createdAt)}`],
              ...(b.decidedBy && b.status !== "CANCELLED" && b.status !== "REJECTED" ? ([["Approved by", `${b.decidedBy}${b.decidedAt ? ` · ${formatDateTime(b.decidedAt)}` : ""}`]] as Array<[string, string]>) : []),
              ["Started from", b.source],
              ...(ctx.campus === "ALL" ? ([["Campus", campusLabel(b.campus)]] as Array<[string, string]>) : []),
            ]}
          />

          <div className="grid gap-1.5">
            <span className="mtb-label">Message{b.title ? ` · app title “${b.title}”` : ""}</span>
            <SmsBubble text={b.sampleMessage} language={b.language} />
          </div>

          {b.rows.length > 0 && <DataTable caption="First recipients" columns={rowColumns} rows={b.rows.slice(0, 12)} rowKey="id" density="dense" stickyHeader={false} />}
        </div>
      )}

      <ConfirmDialog
        open={approveOpen}
        onClose={() => setApproveOpen(false)}
        onConfirm={() => decide.mutate("approve")}
        icon="check"
        title={`Approve the message to ${formatCount(b?.recipients ?? 0)} recipients?`}
        message={b?.scheduledFor && isLaterThanNow(b.scheduledFor) ? `It is released ${whenText(b.scheduledFor)}. It is held in the outbox; nothing is sent from this system.` : "It is held in the outbox; nothing is sent from this system."}
        details={b ? [["Message", b.templateName], ["To", b.audienceLabel], ["Cost", formatRs(b.estCost)], ["Asked by", b.createdBy]] : []}
        confirmLabel="Approve"
        loading={decide.isPending}
        loadingLabel="Approving…"
        error={decide.error ? errorText(decide.error) : undefined}
      />
      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="Don't approve this message?"
        description="It won't be sent. Your note is shown to the person who asked."
        footer={
          <>
            <Button onClick={() => setRejectOpen(false)}>Back</Button>
            <Button variant="danger" loading={decide.isPending} loadingLabel="Saving…" disabled={!note.trim()} onClick={() => decide.mutate("reject")}>
              Don't approve
            </Button>
          </>
        }
      >
        <Textarea label="Why" required rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: the meeting date has changed to Saturday." {...(errorField(decide.error) === "note" ? { error: errorText(decide.error) } : {})} />
      </Modal>
      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={() => cancel.mutate()}
        tone="danger"
        icon="x"
        title="Cancel this message?"
        message="Nobody will receive it and nothing is charged. It stays in the Outbox as cancelled."
        confirmLabel="Cancel message"
        cancelLabel="Keep it"
        loading={cancel.isPending}
        loadingLabel="Cancelling…"
        error={cancel.error ? errorText(cancel.error) : undefined}
      >
        <div className="mt-4">
          <Select label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} options={CANCEL_REASONS} />
        </div>
      </ConfirmDialog>
      <Modal
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        title="Change when it goes out"
        footer={
          <>
            <Button onClick={() => setMoveOpen(false)}>Back</Button>
            <Button
              variant="primary"
              loading={move.isPending}
              loadingLabel="Saving…"
              onClick={() => {
                if (!date) return setMoveError("Choose the day.");
                const at = isoAt(date, time);
                if (!isLaterThanNow(at)) return setMoveError("Choose a time later than now.");
                setMoveError(null);
                move.mutate(at);
              }}
            >
              Save new time
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <DatePicker label="Day" value={date} onValueChange={setDate} today={pakistanToday()} minDate={pakistanToday()} {...(b ? { maxDate: `${b.session + 1}-03-31` } : {})} />
          <Select label="Time" value={time} onChange={(e) => setTime(e.target.value)} options={TIME_SLOTS} />
        </div>
        {moveError && <p className="m-0 mt-3 text-small text-danger-ink" role="alert">{moveError}</p>}
      </Modal>
    </SidePanel>
  );
}
