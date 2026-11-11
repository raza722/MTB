import { newIdempotencyKey, smsApi, smsQueries, smsStatusQueries, type SmsDeliveryRow, type SmsDeliveryStatus } from "@mtb/api";
import { formatCount } from "@mtb/domain";
import { Banner, Button, DataTable, EmptyState, Input, Pagination, Segmented, StatCard, StatusBadge, useToast, type Column } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { campusLabel } from "../../app/shell/campus";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { errorText, LoadError, MessagesShell, slide, whenText } from "./shell";

export interface DeliverySearch {
  status?: SmsDeliveryStatus;
  batch?: string;
}

type Filter = "all" | SmsDeliveryStatus;
const PAGE_SIZE = 25;

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "failed", label: "Failed" },
  { value: "queued", label: "Held" },
  { value: "sent", label: "Sent" },
  { value: "delivered", label: "Delivered" },
  { value: "optedout", label: "Opted out" },
];

/**
 * /sms/delivery — the latest messages one by one with today's totals. Nothing is sent from this system: new messages
 * are held ("queued"); sent / failed come from the old system's log.
 */
export function DeliveryPage({ search, setSearch }: { search: DeliverySearch; setSearch: (next: DeliverySearch) => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canSend = useCan("sms.send");
  const readOnly = useReadOnly();
  const status = useQuery(smsStatusQueries.status());
  const report = useQuery(smsQueries.report(ctx, search.batch ? { batchId: search.batch } : {}));
  const filter: Filter = search.status ?? "all";
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  // Kept until the retry succeeds, so a retry after a lost reply can't act twice.
  const retryKey = useRef(newIdempotencyKey());
  const retry = useMutation({
    mutationFn: () => smsApi.retryFailed(ctx, search.batch, retryKey.current),
    onSuccess: async ({ retried }) => {
      retryKey.current = newIdempotencyKey();
      await queryClient.invalidateQueries({ queryKey: ["sms"] });
      toast(retried ? { title: `Retrying ${formatCount(retried)} failed SMS`, message: "They are held in the outbox: nothing is sent from this system." } : { tone: "info", title: "Nothing to retry", message: "Failed messages from the old system are kept as they were. Nothing is sent from this system." });
    },
    onError: (e) => toast({ tone: "danger", title: "Retry not started", message: errorText(e) }),
  });

  const data = report.data;
  const totals = data?.totals;
  const all = data?.rows ?? [];
  const q = query.trim().toLowerCase();
  const rows = all.filter((r) => (filter === "all" || r.status === filter) && (!q || `${r.studentName} ${r.grNo} ${r.mobile} ${r.guardian} ${r.templateName}`.toLowerCase().includes(q)));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const failedCount = totals?.failed ?? 0;
  const paused = Boolean(status.data?.paused);
  const grandTotal = totals ? totals.delivered + totals.failed + totals.queued + totals.sent + totals.optedout : 0;
  const batchName = search.batch ? all[0]?.templateName : undefined;

  const columns: Array<Column<SmsDeliveryRow>> = [
    { key: "at", header: "Time", width: 150, render: (r) => <time className="mtb-num" dateTime={r.at}>{whenText(r.at)}</time> },
    {
      key: "to",
      header: "To",
      width: 170,
      render: (r) => (
        <span className="grid">
          <span className="mtb-mono">{r.mobile}</span>
          <span className="mtb-cell-secondary">{r.guardian || "—"}</span>
        </span>
      ),
    },
    {
      key: "student",
      header: "Student",
      width: 180,
      render: (r) => (
        <span className="grid">
          <span className="mtb-cell-primary">{r.studentName || "—"}</span>
          <span className="mtb-cell-secondary">
            {r.classSection || "—"}
            {ctx.campus === "ALL" ? ` · ${campusLabel(r.campus)}` : ""}
          </span>
        </span>
      ),
    },
    {
      key: "message",
      header: "Message",
      render: (r) => (
        <span className="grid min-w-0">
          <span className="font-medium">
            {r.templateName} · {r.language === "ur" ? "Urdu" : "English"} · {r.channel === "APP" ? "App" : `SMS${r.parts && r.parts > 1 ? ` (${r.parts} parts)` : ""}`}
          </span>
          <span className="mtb-cell-secondary block max-w-[420px] truncate" title={r.message} {...(r.language === "ur" ? { lang: "ur", dir: "rtl" } : {})}>
            {r.message}
          </span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: 230,
      render: (r) => (
        <span className="grid justify-items-start gap-1">
          <StatusBadge status={r.status} />
          {r.error && <span className="mtb-cell-secondary">{r.error}</span>}
        </span>
      ),
    },
  ];

  return (
    <MessagesShell title="Delivery report">
      {search.batch && (
        <Banner
          tone="info"
          title={`Showing one message${batchName ? `: ${batchName}` : ""}.`}
          actions={
            <Button size="sm" onClick={() => setSearch({ ...(search.status ? { status: search.status } : {}) })}>
              Show all of today
            </Button>
          }
        >
          Every recipient of this send, with their status. <Link to="/sms/outbox" search={{ batch: search.batch } as never} className="font-medium text-brand-ink">Open it in the Outbox</Link>.
        </Banner>
      )}
      {report.error && !data ? (
        <LoadError what="The delivery report" error={report.error} onRetry={() => void report.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
            {[
              <StatCard key="d" label={search.batch ? "Delivered" : "Delivered today"} icon="checkCircle" value={totals ? formatCount(totals.delivered) : undefined} loading={!totals} foot="No delivery reports: nothing is sent from this system" />,
              <StatCard key="f" label="Failed" icon="alertCircle" tone="danger" value={totals ? formatCount(totals.failed) : undefined} loading={!totals} foot="Old system: recorded as not sent" />,
              <StatCard key="q" label="Held" icon="clock" tone="neutral" value={totals ? formatCount(totals.queued) : undefined} loading={!totals} foot="In the outbox: nothing is sent from this system" />,
              <StatCard key="s" label="Sent" icon="send" tone="info" value={totals ? formatCount(totals.sent) : undefined} loading={!totals} foot="Old system: accepted by the SMS company" />,
              <StatCard key="o" label="Opted out" icon="ban" tone="neutral" value={totals ? formatCount(totals.optedout) : undefined} loading={!totals} foot="Skipped notices" />,
              <StatCard key="a" label="By app" icon="smartphone" tone="info" value={data ? formatCount(data.appToday ?? 0) : undefined} loading={!data} foot="Free app notifications" />,
            ].map((card, i) => (
              <div key={i} className="mtb-rise" style={slide(i)}>
                {card}
              </div>
            ))}
          </div>

          {totals && totals.queued > 0 && (
            <Banner tone="warning" title={`${formatCount(totals.queued)} messages are held.`}>
              Sending is switched off in this system{paused ? " and all SMS are paused" : ""}: they stay in the outbox.
            </Banner>
          )}

          <DataTable
            caption={search.batch ? "Recipients of this message" : "Latest messages"}
            columns={columns}
            rows={pageRows}
            rowKey="id"
            loading={report.isPending}
            stickyHeader
            maxHeight={560}
            empty={
              <EmptyState
                icon="message"
                title={filter === "all" && !q ? "No messages yet" : "No messages match"}
                description={filter === "all" && !q ? "Messages appear here as soon as they are written to the outbox." : "Try another status or clear the search."}
              />
            }
            toolbar={
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <Segmented
                    aria-label="Filter by status"
                    value={filter}
                    onChange={(v) => {
                      setSearch({ ...(search.batch ? { batch: search.batch } : {}), ...(v !== "all" ? { status: v as SmsDeliveryStatus } : {}) });
                      setPage(1);
                    }}
                    options={FILTERS.map((f) => ({ value: f.value, label: f.value === "failed" && failedCount ? `Failed (${failedCount})` : f.label }))}
                  />
                  <div className="w-64">
                    <Input
                      aria-label="Search messages"
                      icon="search"
                      placeholder="Student, G.R. or mobile"
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setPage(1);
                      }}
                    />
                  </div>
                </div>
                {canSend && (
                  <Button icon="refresh" disabled={failedCount === 0 || paused || readOnly} loading={retry.isPending} loadingLabel="Retrying…" onClick={() => retry.mutate()} title={paused ? "SMS is paused" : undefined}>
                    Retry failed{failedCount ? ` (${failedCount})` : ""}
                  </Button>
                )}
              </>
            }
            pagination={rows.length > PAGE_SIZE ? <Pagination page={page} pageSize={PAGE_SIZE} total={rows.length} onPageChange={setPage} /> : undefined}
          />
          {data && (
            <p className="m-0 text-small text-ink-muted">
              Showing the latest {formatCount(all.length)} messages{search.batch ? ` of ${formatCount(grandTotal)} in this message` : `; ${formatCount(grandTotal)} today`}. The totals above count every message{search.batch ? "" : " of today"}. For earlier days, run the <Link to="/reports/$reportId" params={{ reportId: "msg-log" } as never} className="font-medium text-brand-ink">Message log</Link> report.
            </p>
          )}
        </>
      )}
    </MessagesShell>
  );
}
