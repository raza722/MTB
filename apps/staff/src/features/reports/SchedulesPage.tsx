import { ApiError, reportsApi, reportsQueries, type CampusScope, type ReportFilterValues, type ReportFormat, type ReportFrequency, type ReportSchedule } from "@mtb/api";
import { formatSession } from "@mtb/domain";
import { Banner, Button, Checkbox, ConfirmDialog, DataTable, EmptyState, Field, Select, SidePanel, Switch, useToast, type Column } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { useCtx, useReadOnly } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import { errorText, LoadError, moduleLabel, ReportsShell, timeText } from "./shell";

const WEEKDAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TIMES = Array.from({ length: 15 }, (_, i) => {
  const h = 7 + i;
  return { value: `${String(h).padStart(2, "0")}:00`, label: `${((h + 11) % 12) + 1}:00 ${h < 12 ? "AM" : "PM"}` };
});
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

export function whenRuns(s: Pick<ReportSchedule, "frequency" | "weekday" | "dayOfMonth" | "time">): string {
  const t = TIMES.find((x) => x.value === s.time)?.label ?? s.time;
  if (s.frequency === "DAILY") return `Every school day at ${t}`;
  if (s.frequency === "WEEKLY") return `Every ${WEEKDAYS[s.weekday ?? 1]} at ${t}`;
  return `On the ${ordinal(s.dayOfMonth ?? 1)} of every month at ${t}`;
}

/** /reports/scheduled — reports that go out by themselves (under the bell in the app; email is kept on hold) on a timetable. */
export function SchedulesPage() {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const list = useQuery(reportsQueries.schedules(ctx));
  const readOnly = useReadOnly();
  const [editing, setEditing] = useState<ReportSchedule | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ReportSchedule | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: reportsQueries.schedules(ctx).queryKey });

  const toggle = useMutation({
    mutationFn: (s: ReportSchedule) => reportsApi.updateSchedule(s.id, { active: !s.active }),
    onSuccess: async (s) => {
      await refresh();
      toast({ title: s.active ? `Resumed · ${s.reportName}` : `Paused · ${s.reportName}`, message: s.active ? `Next: ${timeText(s.nextRunAt)}.` : "It won't run until you resume it." });
    },
    onError: (e) => toast({ tone: "danger", title: "Not changed", message: errorText(e) }),
  });
  const runNow = useMutation({
    mutationFn: (s: ReportSchedule) => reportsApi.runScheduleNow(s.id),
    onSuccess: async (j) => {
      await refresh();
      await queryClient.invalidateQueries({ queryKey: reportsQueries.jobs(ctx).queryKey });
      toast({ tone: "info", title: `Running now · ${j.reportName}`, message: "You'll be told when it is ready; the people on the list get it too." });
    },
    onError: (e) => toast({ tone: "danger", title: "Not started", message: errorText(e) }),
  });
  const remove = useMutation({
    mutationFn: () => reportsApi.deleteSchedule(deleting!.id),
    onSuccess: async () => {
      const name = deleting?.reportName;
      setDeleting(null);
      await refresh();
      toast({ title: "Schedule deleted", message: name });
    },
  });

  const columns: Array<Column<ReportSchedule>> = [
    {
      key: "report",
      header: "Report",
      render: (s) => (
        <span className="grid min-w-0">
          <Link to="/reports/$reportId" params={{ reportId: s.reportId }} className="mtb-cell-primary truncate text-brand-ink">
            {s.reportName}
          </Link>
          <span className="mtb-cell-secondary truncate">
            {moduleLabel(s.module)} · {campusLabel(s.campus)} · {s.filterSummary}
          </span>
        </span>
      ),
    },
    { key: "when", header: "When", width: 230, render: (s) => <span className="grid"><span>{whenRuns(s)}</span><span className="mtb-cell-secondary">{s.active ? `Next ${timeText(s.nextRunAt)}` : "Paused"}</span></span> },
    { key: "format", header: "As", width: 70, render: (s) => (s.format === "EXCEL" ? "Excel" : "PDF") },
    { key: "to", header: "Sent to", width: 210, render: (s) => <span className="text-small">{s.recipients.join(", ")}</span> },
    { key: "last", header: "Last sent", width: 150, render: (s) => <span className="mtb-num text-small">{s.lastRunAt ? timeText(s.lastRunAt) : "Not yet"}</span> },
    {
      key: "actions",
      header: "",
      width: 280,
      className: "mtb-td-actions",
      render: (s) => (
        <span className="flex items-center justify-end gap-2">
          <Switch aria-label={s.active ? `Pause ${s.reportName}` : `Resume ${s.reportName}`} checked={s.active} onChange={() => toggle.mutate(s)} />
          <Button size="sm" variant="ghost" onClick={() => runNow.mutate(s)} loading={runNow.isPending && runNow.variables?.id === s.id} loadingLabel="Starting…">
            Run now
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
            Change
          </Button>
          <Button size="sm" variant="quiet" icon="trash" aria-label={`Delete ${s.reportName} schedule`} onClick={() => { remove.reset(); setDeleting(s); }} />
        </span>
      ),
    },
  ];

  return (
    <ReportsShell
      title="Scheduled reports"
      actions={
        <Button variant="primary" icon="plus" disabled={readOnly} title={readOnly ? "Switch to the current session to schedule reports." : undefined} onClick={() => setCreating(true)}>
          Schedule a report
        </Button>
      }
    >
      <p className="m-0 max-w-3xl text-small text-ink-muted">
        Scheduled reports are prepared on time by themselves and sent to the people on the list, under the bell in the app. Email is kept on hold (not sent). For example, the day's collection to the principal every evening, or the defaulter list on the 15th.
      </p>
      {list.error && !list.data ? (
        <LoadError what="Scheduled reports" error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <DataTable
          caption="Scheduled reports"
          columns={columns}
          rows={list.data ?? []}
          rowKey="id"
          loading={list.isPending}
          stickyHeader={false}
          rowClassName={(s) => (s.active ? undefined : "opacity-60")}
          empty={<EmptyState icon="clock" title="No scheduled reports" description="Open any report and choose “Schedule”, or use “Schedule a report”." />}
        />
      )}
      <ScheduleEditor open={creating || editing !== null} onClose={() => { setCreating(false); setEditing(null); }} schedule={editing} preset={null} />
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => remove.mutate()}
        tone="danger"
        icon="trash"
        title="Delete this schedule?"
        message="The report stops going out. Files already sent stay in people's downloads until they expire."
        details={deleting ? [["Report", deleting.reportName], ["When", whenRuns(deleting)], ["Sent to", deleting.recipients.join(", ")]] : []}
        confirmLabel="Delete schedule"
        loading={remove.isPending}
        loadingLabel="Deleting…"
        error={remove.error ? errorText(remove.error) : undefined}
      />
    </ReportsShell>
  );
}

const schema = z
  .object({
    reportId: z.string().min(1, "Choose a report."),
    frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
    recipients: z.array(z.string()).min(1, "Choose at least one person to send it to."),
    background: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.background && v.frequency === "DAILY") ctx.addIssue({ code: "custom", path: ["frequency"], message: "This report is large; schedule it weekly or monthly." });
  });

/** New or changed schedule. `preset` comes from a report page (that report and its current filters). */
export function ScheduleEditor({ open, onClose, schedule, preset }: { open: boolean; onClose: () => void; schedule: ReportSchedule | null; preset: { reportId: string; filters: ReportFilterValues } | null }) {
  return open ? <EditorBody key={schedule?.id ?? preset?.reportId ?? "new"} onClose={onClose} schedule={schedule} preset={preset} /> : <SidePanel open={false} onClose={onClose} title="" />;
}

function EditorBody({ onClose, schedule, preset }: { onClose: () => void; schedule: ReportSchedule | null; preset: { reportId: string; filters: ReportFilterValues } | null }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const cat = useQuery(reportsQueries.catalogue(ctx));
  const people = useQuery(reportsQueries.recipients());
  const [reportId, setReportId] = useState(schedule?.reportId ?? preset?.reportId ?? "");
  const [frequency, setFrequency] = useState<ReportFrequency>(schedule?.frequency ?? "DAILY");
  const [weekday, setWeekday] = useState(String(schedule?.weekday ?? 1));
  const [dayOfMonth, setDayOfMonth] = useState(String(schedule?.dayOfMonth ?? 1));
  const [time, setTime] = useState(schedule?.time ?? "18:00");
  const [format, setFormat] = useState<ReportFormat>(schedule?.format ?? "PDF");
  const [recipients, setRecipients] = useState<string[]>(schedule?.recipients ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const def = cat.data?.reports.find((r) => r.id === reportId);
  const campus: CampusScope = schedule?.campus ?? ctx.campus;

  const save = useMutation({
    mutationFn: () => {
      // Daily reports cover the day they run, whatever date was on screen.
      const filters: ReportFilterValues = { ...(schedule?.filters ?? preset?.filters ?? {}) };
      for (const f of def?.filters ?? []) {
        if (f.kind === "date") filters[f.key] = "today";
        if (f.kind === "dateRange" && frequency !== "MONTHLY") filters[f.key] = "monthStart|today";
      }
      const body = { reportId, campus, session: ctx.session, filters, frequency, ...(frequency === "WEEKLY" ? { weekday: Number(weekday) } : {}), ...(frequency === "MONTHLY" ? { dayOfMonth: Number(dayOfMonth) } : {}), time, format, recipients };
      return schedule ? reportsApi.updateSchedule(schedule.id, body) : reportsApi.createSchedule(body);
    },
    onSuccess: async (s) => {
      await queryClient.invalidateQueries({ queryKey: reportsQueries.schedules(ctx).queryKey });
      onClose();
      toast({ title: schedule ? `Schedule changed · ${s.reportName}` : `Scheduled · ${s.reportName}`, message: `${whenRuns(s)}. Next: ${timeText(s.nextRunAt)}.` });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.field) setErrors({ [e.field]: e.message });
    },
  });

  const submit = () => {
    const r = schema.safeParse({ reportId, frequency, recipients, background: Boolean(def?.background) });
    const next: Record<string, string> = {};
    if (!r.success) for (const i of r.error.issues) next[String(i.path[0])] ??= i.message;
    setErrors(next);
    if (!Object.keys(next).length) save.mutate();
  };

  return (
    <SidePanel
      open
      onClose={onClose}
      title={schedule ? "Change schedule" : "Schedule a report"}
      description={`${campusLabel(campus)} · Session ${formatSession(ctx.session)}. It is prepared by itself and sent to the people you choose.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="check" loading={save.isPending} loadingLabel="Saving…" onClick={submit}>
            {schedule ? "Save changes" : "Schedule"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {save.error && !(save.error instanceof ApiError && save.error.field) && <Banner tone="danger">{errorText(save.error)}</Banner>}
        <Select
          label="Report"
          value={reportId}
          disabled={Boolean(schedule)}
          onChange={(e) => setReportId(e.target.value)}
          options={[{ value: "", label: "Choose…" }, ...(cat.data?.reports ?? []).map((r) => ({ value: r.id, label: `${moduleLabel(r.module)} · ${r.name}` }))]}
          {...(def?.background ? { help: "A large report: weekly or monthly works best." } : {})}
          {...(errors.reportId ? { error: errors.reportId } : {})}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="How often" value={frequency} onChange={(e) => setFrequency(e.target.value as ReportFrequency)} options={[{ value: "DAILY", label: "Every school day" }, { value: "WEEKLY", label: "Every week" }, { value: "MONTHLY", label: "Every month" }]} {...(errors.frequency ? { error: errors.frequency } : {})} />
          {frequency === "WEEKLY" && <Select label="On" value={weekday} onChange={(e) => setWeekday(e.target.value)} options={WEEKDAYS.slice(1).map((d, i) => ({ value: String(i + 1), label: d }))} />}
          {frequency === "MONTHLY" && <Select label="On the" value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} options={Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: `${ordinal(i + 1)} of the month` }))} />}
          <Select label="At" value={time} onChange={(e) => setTime(e.target.value)} options={TIMES} />
          <Select label="As" value={format} onChange={(e) => setFormat(e.target.value as ReportFormat)} options={(def?.formats ?? ["PDF", "EXCEL"]).map((f) => ({ value: f, label: f === "EXCEL" ? "Excel spreadsheet" : "PDF" }))} />
        </div>
        <Field label="Send to" help="They get it under the bell in the app. Email is kept on hold (not sent)." {...(errors.recipients ? { error: errors.recipients } : {})}>
          {() => (
            <div className="grid gap-1.5">
              {(people.data ?? []).map((p) => (
                <Checkbox key={p.name} label={`${p.name} · ${p.role}`} checked={recipients.includes(p.name)} onChange={(e) => setRecipients((prev) => (e.target.checked ? [...prev, p.name] : prev.filter((x) => x !== p.name)))} />
              ))}
            </div>
          )}
        </Field>
        {def && (
          <p className="m-0 text-small text-ink-muted">
            {def.filters.some((f) => f.kind === "date" || f.kind === "dateRange") ? "Dates move with the schedule: a daily report covers the day it runs; a weekly one covers the month so far. " : ""}
            Other filters stay as they were on the report page.
          </p>
        )}
      </div>
    </SidePanel>
  );
}
