import { attendanceQueries, dashboardQueries, type AttendanceCampusRow, type AttendanceClassRow, type AttendanceRegisterStatus } from "@mtb/api";
import { formatCount, formatLongDate, formatPercent, formatTime, type IsoDate } from "@mtb/domain";
import { AnimatedNumber, Banner, Button, buttonClassName, DataTable, DatePicker, DeviationChart, EmptyState, Panel, Segmented, StatCard, StatusBadge, type Column } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { campusLabel } from "../../app/shell/campus";
import { RequireSingleCampus } from "../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { AttendanceShell, PastSessionNote, QueryError, SESSION_START, stagger, TODAY, useCanMark } from "./shared";

const pct = (attended: number, of: number) => (of === 0 ? null : Math.round((attended / of) * 1000) / 10);

function RegisterBadge({ status, row }: { status: AttendanceRegisterStatus; row: AttendanceClassRow }) {
  if (status === "NOT_MARKED")
    return (
      <StatusBadge status="warning" dot={false}>
        Not marked
      </StatusBadge>
    );
  return (
    <span className="grid justify-items-start gap-0.5">
      {status === "CHANGE_PENDING" ? <StatusBadge status="pending">Change pending</StatusBadge> : <StatusBadge status="approved">Submitted</StatusBadge>}
      {row.submittedAt && (
        <span className="mtb-cell-secondary">
          <span className="mtb-num">{formatTime(row.submittedAt)}</span> · {row.source}
        </span>
      )}
    </span>
  );
}

function Meter({ value }: { value: number | null }) {
  if (value === null) return <span className="text-ink-muted">—</span>;
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="mtb-num">{formatPercent(value)}</span>
      <span className="mtb-meter mtb-meter-animate w-16" role="img" aria-label={`${formatPercent(value)} attended`}>
        <span style={{ width: `${value}%` }} />
      </span>
    </span>
  );
}

const count = (n: number, marked: boolean) => (marked ? <span className="mtb-num">{n}</span> : <span className="text-ink-muted">—</span>);

export interface AttendanceTodayProps {
  date: IsoDate | undefined;
  onDate: (date: IsoDate | undefined) => void;
}

/** Registers for one day by class (one campus) or by campus (all campuses). Opens a class register. */
export function AttendancePage({ date, onDate }: AttendanceTodayProps) {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const canApprove = useCan("approvals.decide");
  const canMark = useCanMark();
  const navigate = useNavigate();
  const [view, setView] = useState("table");
  const day = date ?? TODAY;
  const isToday = day === TODAY;
  const q = useQuery({ ...attendanceQueries.day(ctx, isToday ? undefined : day), enabled: !readOnly });
  const approvals = useQuery({ ...dashboardQueries.approvals(ctx), enabled: canApprove && !readOnly });
  const corrections = useQuery({ ...attendanceQueries.corrections(ctx), enabled: !readOnly });

  const header = {
    title: "Attendance",
    meta: (
      <span className="text-small text-ink-muted">
        {formatLongDate(day)}
        {isToday ? " · today" : " · an earlier day"} · teachers mark registers in the teacher app
      </span>
    ),
    actions: readOnly ? undefined : (
      <div className="flex flex-wrap items-end gap-2">
        {!isToday && (
          <Button size="sm" variant="quiet" icon="refresh" onClick={() => onDate(undefined)}>
            Back to today
          </Button>
        )}
        <div className="w-44">
          <DatePicker aria-label="Day" value={day} today={TODAY} minDate={SESSION_START} maxDate={TODAY} onValueChange={(d) => onDate(d && d !== TODAY ? d : undefined)} />
        </div>
      </div>
    ),
  };

  if (readOnly) {
    return (
      <AttendanceShell title={header.title}>
        <PastSessionNote what="The day's registers by class" />
      </AttendanceShell>
    );
  }

  const data = q.data;
  const pendingApprovals = (approvals.data ?? []).filter((a) => a.kind === "ATTENDANCE_CORRECTION");
  // A register shows "Change pending" until its correction is decided on the dashboard.
  const pendingClasses = new Set(pendingApprovals.filter((a) => a.kind === "ATTENDANCE_CORRECTION" && a.date === day).map((a) => a.student.classSection));
  const officePending = new Set((corrections.data ?? []).filter((c) => c.status === "PENDING" && c.date === day && c.id.startsWith("att-o-")).map((c) => c.classSection));
  const statusOf = (r: AttendanceClassRow): AttendanceRegisterStatus =>
    r.status === "CHANGE_PENDING" && approvals.data && !pendingClasses.has(r.classSection) && !officePending.has(r.classSection) ? "SUBMITTED" : r.status;
  const waiting = (corrections.data ?? []).filter((c) => c.status === "PENDING" && (!approvals.data || c.id.startsWith("att-o-") || pendingApprovals.some((a) => a.id === c.id)));

  const t = data?.totals;
  const notMarked = (data?.rows ?? []).filter((r) => r.status === "NOT_MARKED");
  const openRegister = (classSection: string) =>
    void navigate({ to: "/attendance/register/$classSection", params: { classSection }, search: (prev: Record<string, unknown>) => ({ ...prev, date: isToday ? undefined : day }) } as never);

  const columns: Array<Column<AttendanceClassRow>> = [
    {
      key: "classSection",
      header: "Class",
      render: (r) => (
        <span className="grid">
          <span className="mtb-cell-primary">{r.classSection}</span>
          <span className="mtb-cell-secondary">{r.classTeacher}</span>
        </span>
      ),
    },
    { key: "status", header: "Register", width: 190, render: (r) => <RegisterBadge status={statusOf(r)} row={r} /> },
    { key: "enrolled", header: "Students", align: "right", width: 96, render: (r) => <span className="mtb-num">{r.enrolled}</span> },
    { key: "present", header: "Present", align: "right", width: 90, render: (r) => count(r.present, r.status !== "NOT_MARKED") },
    { key: "absent", header: "Absent", align: "right", width: 90, render: (r) => count(r.absent, r.status !== "NOT_MARKED") },
    { key: "leave", header: "Leave", align: "right", width: 80, render: (r) => count(r.leave, r.status !== "NOT_MARKED") },
    { key: "late", header: "Late", align: "right", width: 80, render: (r) => count(r.late, r.status !== "NOT_MARKED") },
    { key: "attended", header: "Attended", align: "right", width: 150, render: (r) => <Meter value={r.status === "NOT_MARKED" ? null : pct(r.present + r.late, r.enrolled)} /> },
  ];

  const campusColumns: Array<Column<AttendanceCampusRow>> = [
    { key: "name", header: "Campus", render: (c) => <span className="mtb-cell-primary">{c.name}</span> },
    {
      key: "registers",
      header: "Registers",
      width: 200,
      render: (c) =>
        c.notMarked > 0 ? (
          <StatusBadge status="warning" dot={false}>
            {c.registers - c.notMarked} of {c.registers} submitted
          </StatusBadge>
        ) : (
          <StatusBadge status="approved">All {c.registers} submitted</StatusBadge>
        ),
    },
    { key: "marked", header: "Students marked", align: "right", width: 140, render: (c) => <span className="mtb-num">{formatCount(c.marked)}</span> },
    { key: "attended", header: "Attended", align: "right", width: 110, render: (c) => <span className="mtb-num">{formatCount(c.attended)}</span> },
    { key: "absent", header: "Absent", align: "right", width: 100, render: (c) => <span className="mtb-num">{formatCount(c.absent)}</span> },
    { key: "percent", header: "Attended %", align: "right", width: 150, render: (c) => <Meter value={c.percent} /> },
  ];

  return (
    <AttendanceShell title={header.title} meta={header.meta} actions={header.actions}>
      {q.isError && <QueryError what="Attendance" error={q.error} onRetry={() => void q.refetch()} />}

      {data?.closed ? (
        <div className="mtb-card">
          <EmptyState
            icon="calendar"
            title={`No attendance on ${formatLongDate(day)} — ${data.closed.name}`}
            description={data.closed.kind === "WEEKLY_OFF" ? "Sunday is the weekly holiday. Registers are closed." : "The school calendar closes registers on this day. Teachers see the same message in the teacher app."}
            action={
              <Link to="/attendance/calendar" className={buttonClassName({ size: "sm" })}>
                Open the school calendar
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <div className="att-kpis">
            {!t ? (
              [0, 1, 2, 3, 4].map((i) => <StatCard key={i} label="" loading />)
            ) : (
              <>
                <div style={stagger(0)}>
                  <StatCard label={isToday ? "Attended today" : "Attended"} icon="attendance" value={<AnimatedNumber value={t.percent} decimals={1} format={(v) => formatPercent(v)} />} meter={t.percent} meterLabel="Attended" foot={`${formatCount(t.attended)} of ${formatCount(t.marked)} marked`} />
                </div>
                <div style={stagger(1)}>
                  <StatCard
                    label="Absent"
                    icon="alertCircle"
                    tone="danger"
                    value={<AnimatedNumber value={t.absent} format={formatCount} />}
                    foot={
                      ctx.campus !== "ALL" ? (
                        <Link to="/attendance/absentees" className="text-brand-ink underline-offset-2 hover:underline">
                          See absentees and parent SMS
                        </Link>
                      ) : (
                        "Parents get an SMS"
                      )
                    }
                  />
                </div>
                <div style={stagger(2)}>
                  <StatCard label="On leave" icon="calendar" tone="info" value={<AnimatedNumber value={t.leave} format={formatCount} />} foot="Approved leave" />
                </div>
                <div style={stagger(3)}>
                  <StatCard label="Late" icon="clock" tone="warning" value={<AnimatedNumber value={t.late} format={formatCount} />} foot="Counted as attended" />
                </div>
                <div style={stagger(4)}>
                  <StatCard
                    label="Registers"
                    icon="listChecks"
                    tone={t.notMarked > 0 ? "warning" : "neutral"}
                    value={`${t.registers - t.notMarked} of ${t.registers}`}
                    meter={t.registers ? ((t.registers - t.notMarked) / t.registers) * 100 : 0}
                    meterLabel="Registers submitted"
                    foot={t.notMarked > 0 ? `${t.notMarked} not marked yet` : "All submitted"}
                  />
                </div>
              </>
            )}
          </div>

          {notMarked.length > 0 && (
            <Banner
              tone="warning"
              title={`${notMarked.length} ${notMarked.length === 1 ? "register is" : "registers are"} not marked yet:`}
              actions={
                canMark && isToday && notMarked.length === 1 ? (
                  <Button size="sm" variant="primary" icon="edit" onClick={() => openRegister(notMarked[0]!.classSection)}>
                    Mark {notMarked[0]!.classSection} now
                  </Button>
                ) : undefined
              }
            >
              {notMarked.map((r) => `${r.classSection} (${r.classTeacher})`).join(", ")}. These students aren't counted in the percentage until the register is submitted.
              {canMark && isToday ? " The office can mark a register for a teacher who is away." : ""}
            </Banner>
          )}

          {ctx.campus !== "ALL" && waiting.length > 0 && (
            <Banner
              tone="info"
              title={`${waiting.length} attendance ${waiting.length === 1 ? "change is" : "changes are"} waiting for the principal.`}
              actions={
                canApprove ? (
                  <Link to="/dashboard" hash="approvals" className={buttonClassName({ size: "sm" })}>
                    Review on dashboard
                  </Link>
                ) : undefined
              }
            >
              A register can't be edited after it is submitted. Teachers and the office request a change; nothing changes until the principal approves it on the dashboard.
            </Banner>
          )}

          {ctx.campus === "ALL" && data?.campuses && (
            <Panel
              id="att-campuses"
              rise={1}
              flush={view === "table"}
              title="By campus"
              description={`${formatLongDate(day)}: attended out of students in submitted registers, against all campuses at ${formatPercent(data.totals.percent)}.`}
              actions={<Segmented aria-label="Show campuses as" value={view} onChange={setView} options={[{ value: "table", label: "Table" }, { value: "chart", label: "Chart" }]} />}
            >
              {view === "chart" ? (
                <DeviationChart
                  data={data.campuses}
                  value={(c) => c.percent}
                  axisLabel={(c) => c.name.replace(" Campus", "")}
                  reference={data.totals.percent}
                  referenceLabel="All campuses"
                  format={(v) => formatPercent(v)}
                  formatAxis={(v) => `${v}%`}
                  tooltip={(c) => (
                    <>
                      <div className="mtb-chart-tip-title">{c.name}</div>
                      <div className="mtb-chart-tip-value">{formatPercent(c.percent)}</div>
                      <div className="mtb-chart-tip-row">
                        <span>Attended</span>
                        <span>
                          {formatCount(c.attended)} of {formatCount(c.marked)}
                        </span>
                      </div>
                    </>
                  )}
                  describe={(c) => `${c.name}: ${formatPercent(c.percent)}`}
                  label={`Attendance by campus compared with ${formatPercent(data.totals.percent)}`}
                />
              ) : (
                <DataTable
                  caption="Attendance by campus"
                  columns={campusColumns}
                  rows={data.campuses}
                  rowKey="campus"
                  footer={{ name: "All campuses", marked: formatCount(data.totals.marked), attended: formatCount(data.totals.attended), absent: formatCount(data.totals.absent), percent: formatPercent(data.totals.percent) }}
                />
              )}
            </Panel>
          )}

          <RequireSingleCampus action="the class registers">
            <Panel id="att-classes" rise={2} flush title={`Registers by class, ${campusLabel(ctx.campus)}`} description="Open a class to see each student, mark a register that is still open, or request a change.">
              <DataTable
                caption={`Attendance by class, ${campusLabel(ctx.campus)}, ${formatLongDate(day)}`}
                columns={columns}
                rows={data?.rows ?? []}
                rowKey="classSection"
                loading={q.isLoading}
                skeletonRows={10}
                maxHeight={620}
                onRowClick={(r) => openRegister(r.classSection)}
                rowClassName={(r) => (r.status === "NOT_MARKED" ? "is-muted" : undefined)}
                empty={<EmptyState icon="attendance" title="No registers on this day" description="Registers appear here as teachers submit them." />}
                footer={
                  t
                    ? {
                        classSection: `${t.registers} registers`,
                        enrolled: formatCount(t.enrolled),
                        present: formatCount(t.present),
                        absent: formatCount(t.absent),
                        leave: formatCount(t.leave),
                        late: formatCount(t.late),
                        attended: `${formatPercent(t.percent)} of marked`,
                      }
                    : undefined
                }
              />
            </Panel>
          </RequireSingleCampus>
        </>
      )}
    </AttendanceShell>
  );
}
