import { notificationsApi, notificationsQueries, reportsApi, reportsQueries, type ReportJob } from "@mtb/api";
import { formatCount, formatDate } from "@mtb/domain";
import { Button, DataTable, EmptyState, Icon, Segmented, useToast, type Column } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useCtx } from "../../app/session";
import { downloadExcel } from "./export";
import { errorText, FormatIcon, formatLabel, JobStatus, LoadError, ReportsShell, slide, timeText } from "./shell";

/** /reports/jobs — reports prepared in the background and exports: progress, download, retry. Kept 7 days. */
export function JobsPage() {
  const ctx = useCtx();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const jobs = useQuery({ ...reportsQueries.jobs(ctx), refetchInterval: (q) => (q.state.data?.some((j) => j.status === "QUEUED" || j.status === "RUNNING") ? 1200 : 20_000) });
  const notes = useQuery(notificationsQueries.list());
  const [show, setShow] = useState<"all" | "ready" | "running">("all");
  const list = (jobs.data ?? []).filter((j) => show === "all" || (show === "ready" ? j.status === "READY" : j.status === "QUEUED" || j.status === "RUNNING"));
  const unread = (notes.data ?? []).filter((n) => !n.read).length;

  const refresh = () => queryClient.invalidateQueries({ queryKey: reportsQueries.jobs(ctx).queryKey });
  const get = useMutation({
    mutationFn: async (j: ReportJob) => {
      if (j.format === "EXCEL") downloadExcel(await reportsApi.jobResult(j.id), j.campus);
      return j;
    },
    onSuccess: (j) => {
      if (j.format === "EXCEL") toast({ title: `Excel file saved · ${j.reportName}`, message: j.fileName ?? "" });
      else void navigate({ to: "/reports/$reportId", params: { reportId: j.reportId }, search: { job: j.id, ...(j.format === "PDF" ? { print: 1 } : {}) } } as never);
    },
    onError: async (e) => {
      // An expired or removed copy: refresh the list so its status shows.
      await refresh();
      toast({ tone: "danger", title: "Download failed", message: errorText(e) });
    },
  });
  const retry = useMutation({
    mutationFn: (j: ReportJob) => reportsApi.retryJob(j.id),
    onSuccess: async (j) => {
      await refresh();
      toast({ tone: "info", title: `Preparing again · ${j.reportName}`, message: "You'll be told when it is ready." });
    },
    onError: async (e) => {
      await refresh();
      toast({ tone: "danger", title: "Not started", message: errorText(e) });
    },
  });
  const remove = useMutation({
    mutationFn: (j: ReportJob) => reportsApi.removeJob(j.id),
    onSuccess: () => refresh(),
    onError: (e) => toast({ tone: "danger", title: "Not removed", message: errorText(e) }),
  });
  const readAll = useMutation({
    mutationFn: notificationsApi.markAllRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationsQueries.list().queryKey }),
    onError: (e) => toast({ tone: "danger", title: "Not marked read", message: errorText(e) }),
  });

  const columns: Array<Column<ReportJob>> = [
    {
      key: "report",
      header: "Report",
      render: (j) => (
        <span className="grid min-w-0">
          <Link to="/reports/$reportId" params={{ reportId: j.reportId }} className="mtb-cell-primary truncate text-brand-ink">
            {j.reportName}
          </Link>
          <span className="mtb-cell-secondary truncate">{j.filterSummary}</span>
        </span>
      ),
    },
    {
      key: "format",
      header: "As",
      width: 110,
      render: (j) => (
        <span className="inline-flex items-center gap-1.5 text-small">
          <FormatIcon f={j.format} /> {formatLabel(j.format)}
        </span>
      ),
    },
    { key: "asked", header: "Asked", width: 150, render: (j) => <span className="grid"><span className="mtb-num text-small">{timeText(j.requestedAt)}</span>{j.scheduleId && <span className="mtb-cell-secondary">Scheduled</span>}</span> },
    { key: "status", header: "Status", width: 200, render: (j) => <JobStatus job={j} /> },
    {
      key: "size",
      header: "Size",
      width: 140,
      render: (j) => (j.status === "READY" ? <span className="grid text-small"><span className="mtb-num">{formatCount(j.rowCount ?? 0)} rows{j.sizeKb ? ` · ${formatCount(j.sizeKb)} KB` : ""}</span>{j.expiresAt && <span className="mtb-cell-secondary">Kept until {formatDate(j.expiresAt)}</span>}</span> : j.status === "FAILED" ? <span className="text-small text-danger-ink">{j.error}</span> : <span className="text-small text-ink-subtle">—</span>),
    },
    {
      key: "actions",
      header: "",
      width: 230,
      className: "mtb-td-actions",
      render: (j) => (
        <span className="flex justify-end gap-2">
          {j.status === "READY" && (
            <Button size="sm" variant="primary" icon={j.format === "SCREEN" ? "eye" : j.format === "PDF" ? "printer" : "download"} loading={get.isPending && get.variables?.id === j.id} loadingLabel="Getting…" onClick={() => get.mutate(j)}>
              {j.format === "SCREEN" ? "Open" : j.format === "PDF" ? "Open PDF" : "Download"}
            </Button>
          )}
          {(j.status === "FAILED" || j.status === "EXPIRED") && (
            <Button size="sm" icon="refresh" loading={retry.isPending && retry.variables?.id === j.id} loadingLabel="Starting…" onClick={() => retry.mutate(j)}>
              Prepare again
            </Button>
          )}
          {j.status !== "QUEUED" && j.status !== "RUNNING" && <Button size="sm" variant="quiet" icon="x" aria-label={`Remove ${j.reportName}`} onClick={() => remove.mutate(j)} />}
        </span>
      ),
    },
  ];

  return (
    <ReportsShell
      title="Downloads"
      {...(unread
        ? {
            actions: (
              <Button icon="bell" onClick={() => readAll.mutate()} loading={readAll.isPending}>
                Mark {unread} notification{unread === 1 ? "" : "s"} read
              </Button>
            ),
          }
        : {})}
    >
      <p className="m-0 max-w-3xl text-small text-ink-muted">
        Reports you exported or prepared in the background. Large reports are prepared here so the screen never freezes; you get a notification when one is ready. Files are kept for 7 days. Only you can see yours; a scheduled report also shows here for the people it was sent to.
      </p>
      {jobs.error && !jobs.data ? (
        <LoadError what="Your downloads" error={jobs.error} onRetry={() => void jobs.refetch()} />
      ) : (
        <DataTable
          caption="Your downloads"
          columns={columns}
          rows={list}
          rowKey="id"
          loading={jobs.isPending}
          stickyHeader={false}
          rowClassName={(j) => (j.status === "EXPIRED" ? "opacity-60" : undefined)}
          toolbar={
            <Segmented
              aria-label="Show"
              value={show}
              onChange={(v) => setShow(v as typeof show)}
              options={[
                { value: "all", label: "All" },
                { value: "running", label: `Preparing (${(jobs.data ?? []).filter((j) => j.status === "QUEUED" || j.status === "RUNNING").length})` },
                { value: "ready", label: "Ready" },
              ]}
            />
          }
          empty={
            <EmptyState
              icon="download"
              title={show === "all" ? "No downloads yet" : show === "ready" ? "Nothing ready yet" : "Nothing is being prepared"}
              description="Export a report to PDF or Excel, or run a large one in the background; it appears here."
              action={
                <Link to="/reports" className="inline-flex items-center gap-1 font-medium text-brand-ink">
                  <Icon name="file" size={16} /> All reports
                </Link>
              }
            />
          }
        />
      )}
      {(notes.data?.length ?? 0) > 0 && (
        <section className="grid gap-2" aria-labelledby="rpt-notes">
          <h2 id="rpt-notes" className="m-0 text-title-3">
            Notifications
          </h2>
          <ul className="m-0 grid list-none gap-2 p-0">
            {notes.data!.slice(0, 6).map((n, i) => (
              <li key={n.id} className="mtb-slide-in flex items-center gap-3 rounded-md border border-border bg-surface-raised px-3 py-2" style={slide(i)}>
                <Icon name={n.kind === "REPORT_FAILED" ? "alertCircle" : "bell"} size={16} className={n.read ? "text-ink-subtle" : "text-brand-ink"} />
                <span className="grid min-w-0 flex-1">
                  <span className={n.read ? "text-ink-muted" : "font-medium text-ink"}>{n.title}</span>
                  <span className="truncate text-small text-ink-muted">{n.body}</span>
                </span>
                <span className="mtb-num text-small text-ink-subtle">{timeText(n.at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </ReportsShell>
  );
}
