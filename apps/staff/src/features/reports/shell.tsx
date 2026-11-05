import { ApiError, notificationsApi, notificationsQueries, REPORT_MODULE_LABEL, reportsQueries, type ReportCell, type ReportColumnKind, type ReportJob, type ReportModule } from "@mtb/api";
import { formatCount, formatDate, formatPercent, formatRs, formatTime } from "@mtb/domain";
import { Banner, Button, Icon, MenuItem, MenuLabel, StatusBadge, useToast, type IconName } from "@mtb/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { useCtx } from "../../app/session";
import { Page, PageHeader } from "../../app/shell/page";
import { SubNav, type SubNavItem } from "../../app/shell/SubNav";
import "./reports.css";

export const MODULE_ICON: Record<ReportModule, IconName> = {
  FEES: "fees",
  STUDENTS: "students",
  ADMISSIONS: "admissions",
  ATTENDANCE: "attendance",
  EXAMS: "exams",
  ACCOUNTS: "accounts",
  HR: "hr",
  TIMETABLE: "calendar",
  LIBRARY: "book",
  WAREHOUSE: "warehouse",
  TRANSPORT: "mapPin",
  MESSAGES: "sms",
};

export const moduleLabel = (m: ReportModule) => REPORT_MODULE_LABEL[m];

/** Page, header and the report centre's tabs; watches background jobs and says when one is ready. */
export function ReportsShell({ title, context, actions, meta, children }: { title: string; context?: ReactNode; actions?: ReactNode; meta?: ReactNode; children: ReactNode }) {
  const ctx = useCtx();
  const jobs = useQuery({ ...reportsQueries.jobs(ctx), refetchInterval: (q) => (q.state.data?.some((j) => j.status === "QUEUED" || j.status === "RUNNING") ? 1500 : 20_000) });
  const running = jobs.data?.filter((j) => j.status === "QUEUED" || j.status === "RUNNING").length ?? 0;
  const ready = jobs.data?.filter((j) => j.status === "READY").length ?? 0;
  const nav: SubNavItem[] = [
    { to: "/reports", label: "All reports", icon: "file", exact: true },
    { to: "/reports/jobs", label: running ? `Downloads · ${running} preparing` : `Downloads${ready ? ` (${ready})` : ""}`, icon: "download" },
    { to: "/reports/scheduled", label: "Scheduled", icon: "clock" },
  ];
  return (
    <Page>
      <PageHeader title={title} {...(context !== undefined ? { context } : {})} {...(actions ? { actions } : {})} {...(meta ? { meta } : {})} />
      <SubNav items={nav} label="Reports" />
      <ReportJobsWatcher jobs={jobs.data} />
      {children}
    </Page>
  );
}

/**
 * Tells the user when a background report finishes (a toast with a link), and refreshes the bell.
 * The staff shell can mount it on every page; the report centre mounts it on its own pages.
 */
export function ReportJobsWatcher({ jobs }: { jobs: ReportJob[] | undefined }) {
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const seen = useRef<Map<string, ReportJob["status"]> | null>(null);
  useEffect(() => {
    if (!jobs) return;
    const before = seen.current;
    const next = new Map(jobs.map((j) => [j.id, j.status] as const));
    seen.current = next;
    if (!before) return;
    for (const j of jobs) {
      const was = before.get(j.id);
      if ((was === "QUEUED" || was === "RUNNING") && j.status === "READY") {
        void queryClient.invalidateQueries({ queryKey: notificationsQueries.list().queryKey });
        toast({
          title: `${j.reportName} is ready`,
          message: `${j.format === "SCREEN" ? "Open it on screen" : j.format === "EXCEL" ? "Excel file" : "PDF"} · ${formatCount(j.rowCount ?? 0)} rows. It is also under the bell and in Downloads.`,
          duration: 9000,
          action: (
            <Button size="sm" onClick={() => void navigate({ to: j.format === "SCREEN" || j.format === "PDF" ? "/reports/$reportId" : "/reports/jobs", ...(j.format === "SCREEN" || j.format === "PDF" ? { params: { reportId: j.reportId }, search: { job: j.id } } : {}) } as never)}>
              {j.format === "EXCEL" ? "Go to Downloads" : "Open"}
            </Button>
          ),
        });
      }
      if ((was === "QUEUED" || was === "RUNNING") && j.status === "FAILED") toast({ tone: "danger", title: `${j.reportName} could not be prepared`, message: j.error ?? "Open it on screen to see why, then try again." });
    }
  }, [jobs, toast, navigate, queryClient]);
  return null;
}

/**
 * Bell items for the staff shell: "Your report is ready". Drop into the shell's Notifications menu;
 * `useReportNotificationCount()` gives the unread number for the badge.
 */
export function ReportNotificationItems() {
  const q = useQuery(notificationsQueries.list());
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const list = (q.data ?? []).slice(0, 5);
  if (!list.length) return null;
  return (
    <>
      <MenuLabel>Reports</MenuLabel>
      {list.map((n) => (
        <MenuItem
          key={n.id}
          icon={n.kind === "REPORT_FAILED" ? "alertCircle" : "download"}
          onSelect={() => {
            void notificationsApi.markRead(n.id).then(() => queryClient.invalidateQueries({ queryKey: notificationsQueries.list().queryKey }));
            if (n.link) void navigate({ to: n.link } as never);
          }}
        >
          {n.read ? n.title : <b>{n.title}</b>}
        </MenuItem>
      ))}
    </>
  );
}

export function useReportNotificationCount(): number {
  const q = useQuery(notificationsQueries.list());
  return (q.data ?? []).filter((n) => !n.read).length;
}

export const slide = (i: number) => ({ "--i": Math.min(i, 12) }) as CSSProperties;

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.isNetwork ? "No response from the server; nothing was changed. Try again." : e.message;
  return "Something went wrong. Try again.";
}

export function LoadError({ what, error, onRetry }: { what: string; error: unknown; onRetry: () => void }) {
  return (
    <Banner
      tone="danger"
      title={`${what} couldn't be loaded.`}
      actions={
        <Button size="sm" icon="refresh" onClick={onRetry}>
          Try again
        </Button>
      }
    >
      {errorText(error)}
    </Banner>
  );
}

/** A cell as text (Excel export, print, search). */
export function cellText(v: ReportCell, kind: ReportColumnKind): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") {
    if (kind === "money") return formatRs(v);
    if (kind === "percent") return formatPercent(v);
    if (kind === "count") return formatCount(v);
    return String(v);
  }
  if (kind === "date" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return formatDate(v);
  return v;
}

const STATUS_TONES: Array<[RegExp, "success" | "warning" | "danger" | "info" | "neutral"]> = [
  [/^(approved|offered|delivered|posted|admitted|paid|present)$/i, "success"],
  [/^(waiting|waiting list|registered|queued|sent)$/i, "warning"],
  [/^(failed|not selected|not approved|expelled|struck off|cancelled)$/i, "danger"],
  [/^(left|passed out)$/i, "neutral"],
];
export function statusTone(text: string): "success" | "warning" | "danger" | "info" | "neutral" {
  return STATUS_TONES.find(([re]) => re.test(text))?.[1] ?? "info";
}

export function JobStatus({ job }: { job: ReportJob }) {
  if (job.status === "READY") return <StatusBadge status="success">Ready</StatusBadge>;
  if (job.status === "FAILED") return <StatusBadge status="danger">Failed</StatusBadge>;
  if (job.status === "EXPIRED") return <StatusBadge status="neutral">Expired</StatusBadge>;
  return (
    <span className="grid gap-1">
      <span className="text-small text-ink-muted">{job.status === "QUEUED" ? "Waiting to start…" : `Preparing · ${job.progress}%`}</span>
      <span className="mtb-meter rpt-progress" role="progressbar" aria-valuenow={job.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${job.reportName}: ${job.progress}% prepared`}>
        <span style={{ width: `${job.progress}%` }} />
      </span>
    </span>
  );
}

export const formatLabel = (f: ReportJob["format"]) => (f === "EXCEL" ? "Excel" : f === "PDF" ? "PDF" : "On screen");
export const FormatIcon = ({ f }: { f: ReportJob["format"] }) => <Icon name={f === "EXCEL" ? "listChecks" : f === "PDF" ? "printer" : "eye"} size={14} />;
export const timeText = (iso: string) => (iso.startsWith("2026-11-04") ? `Today ${formatTime(iso)}` : `${formatDate(iso)} ${formatTime(iso)}`);
