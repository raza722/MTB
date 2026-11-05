import { attendanceQueries, type AttendanceGroupRow, type AttendanceOverview } from "@mtb/api";
import { formatCount, formatDate, formatLongDate, formatPercent } from "@mtb/domain";
import { AnimatedNumber, AreaChart, DataTable, DeviationChart, EmptyState, Panel, Segmented, Skeleton, Sparkline, StatCard, type Column } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type CSSProperties } from "react";
import { campusLabel } from "../../app/shell/campus";
import { useCtx, useReadOnly } from "../../app/session";
import { AttendanceShell, monthLabel, pctText, QueryError } from "./shared";

const short = (d: string) => formatDate(d).slice(0, 6);

function Trend({ s, ended }: { s: AttendanceOverview; ended: boolean }) {
  const [view, setView] = useState("chart");
  const rows = s.trend.map((d) => ({ ...d, away: Math.round((100 - d.percent) * 10) / 10 }));
  const lastLabel = ended ? "Last day" : "Today";
  return (
    <Panel
      id="att-trend"
      rise={1}
      flush={view === "table"}
      title="Students not in school, day by day"
      description={`Absent or on leave, as a share of students marked, over the ${ended ? "session's last" : "last"} ${s.trend.length} school days. Lower is better. ${lastLabel} ${pctText(Math.round((100 - s.today.percent) * 10) / 10)}.`}
      actions={<Segmented aria-label="Show trend as" value={view} onChange={setView} options={[{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }]} />}
    >
      {view === "chart" ? (
        <AreaChart
          data={rows}
          value={(d) => d.away}
          axisLabel={(d, i) => (i === rows.length - 1 && !ended ? "Today" : short(d.date))}
          formatAxis={(v) => `${v}%`}
          tooltip={(d) => (
            <>
              <div className="mtb-chart-tip-title">{formatLongDate(d.date)}</div>
              <div className="mtb-chart-tip-value">{formatPercent(d.away)} not in school</div>
              <div className="mtb-chart-tip-row">
                <span>Attended</span>
                <span>{formatPercent(d.percent)}</span>
              </div>
            </>
          )}
          describe={(d) => `${formatLongDate(d.date)}: ${formatPercent(d.percent)} attended, ${formatPercent(d.away)} not in school`}
          label={`Share of students not in school over the ${ended ? "session's last" : "last"} ${rows.length} school days`}
          peakLabel={(d) => `${formatPercent(d.away)}`}
          height={260}
        />
      ) : (
        <DataTable
          caption="Daily attendance"
          density="dense"
          rowKey="date"
          rows={[...rows].reverse()}
          columns={[
            { key: "date", header: "Day", render: (d) => formatLongDate(d.date) },
            { key: "percent", header: "Attended", align: "right", render: (d) => <span className="mtb-num">{formatPercent(d.percent)}</span> },
            { key: "away", header: "Not in school", align: "right", render: (d) => <span className="mtb-num">{formatPercent(d.away)}</span> },
          ]}
        />
      )}
    </Panel>
  );
}

function Groups({ s, all, ended }: { s: AttendanceOverview; all: boolean; ended: boolean }) {
  const [view, setView] = useState("chart");
  const sorted = [...s.groups].sort((a, b) => a.percent - b.percent);
  const lowest = sorted[0];
  const columns: Array<Column<AttendanceGroupRow>> = [
    { key: "label", header: all ? "Campus" : "Class", render: (g) => <span className="mtb-cell-primary">{g.label}</span> },
    { key: "attended", header: "Attended", align: "right", render: (g) => <span className="mtb-num">{formatCount(g.attended)}</span> },
    { key: "marked", header: all ? "Students marked" : "Student-days", align: "right", render: (g) => <span className="mtb-num">{formatCount(g.marked)}</span> },
    {
      key: "percent",
      header: "Attended %",
      align: "right",
      width: 170,
      render: (g) => (
        <span className="inline-flex items-center justify-end gap-2">
          <span className="mtb-num">{formatPercent(g.percent)}</span>
          <span className="mtb-meter w-16" role="img" aria-label={`${formatPercent(g.percent)}`}>
            <span style={{ width: `${g.percent}%` }} />
          </span>
        </span>
      ),
    },
  ];
  return (
    <Panel
      id="att-groups"
      rise={2}
      flush={view === "table"}
      title={all ? "Campuses compared" : "Classes compared"}
      description={`${all ? `${ended ? "The session's last" : "The last"} 14 school days` : `${ended ? "The session's last" : "Last"} 26 school days`}, against ${all ? "all campuses" : "the campus"} at ${formatPercent(s.groupsPercent)}.${lowest ? ` Lowest: ${lowest.label} at ${formatPercent(lowest.percent)}.` : ""}`}
      actions={<Segmented aria-label="Show as" value={view} onChange={setView} options={[{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }]} />}
    >
      {view === "chart" ? (
        <DeviationChart
          data={s.groups}
          value={(g) => g.percent}
          axisLabel={(g) => g.label.replace(" Campus", "")}
          reference={s.groupsPercent}
          referenceLabel={all ? "All campuses" : "Campus"}
          format={(v) => formatPercent(v)}
          formatAxis={(v) => `${v}%`}
          tooltip={(g) => (
            <>
              <div className="mtb-chart-tip-title">{g.label}</div>
              <div className="mtb-chart-tip-value">{formatPercent(g.percent)}</div>
              <div className="mtb-chart-tip-row">
                <span>Attended</span>
                <span>
                  {formatCount(g.attended)} of {formatCount(g.marked)}
                </span>
              </div>
            </>
          )}
          describe={(g) => `${g.label}: ${formatPercent(g.percent)}`}
          label={`Attendance by ${all ? "campus" : "class"} compared with ${formatPercent(s.groupsPercent)}`}
          height={260}
        />
      ) : (
        <DataTable caption={all ? "Attendance by campus" : "Attendance by class"} density="dense" rowKey="label" rows={sorted} columns={columns} maxHeight={320} />
      )}
    </Panel>
  );
}

/** The principal's and head office's view: today, the last two weeks, month by month, and who needs attention. */
export function SummaryPage() {
  const ctx = useCtx();
  const ended = useReadOnly();
  const all = ctx.campus === "ALL";
  const q = useQuery(attendanceQueries.summary(ctx));
  const s = q.data;

  return (
    <AttendanceShell
      title="Attendance summary"
      meta={
        <span className="text-small text-ink-muted">
          {all ? "All campuses" : campusLabel(ctx.campus)} · {ended ? "session ended" : "as of"} {s ? formatLongDate(s.date) : ""}
        </span>
      }
    >
      {q.isError && <QueryError what="The attendance summary" error={q.error} onRetry={() => void q.refetch()} />}
      <div className="att-kpis">
        {!s ? (
          [0, 1, 2, 3].map((i) => <StatCard key={i} label="" loading />)
        ) : (
          <>
            <div style={{ "--i": 0 } as CSSProperties}>
              <StatCard label={ended ? "Last school day" : "Today"} icon="attendance" value={<AnimatedNumber value={s.today.percent} decimals={1} format={(v) => formatPercent(v)} />} foot={`${formatCount(s.today.attended)} of ${formatCount(s.today.marked)} marked`}>
                <Sparkline values={s.trend.map((d) => d.percent)} label={`Last ${s.trend.length} school days: ${formatPercent(s.trend[0]!.percent)} to ${formatPercent(s.today.percent)}`} />
              </StatCard>
            </div>
            <div style={{ "--i": 1 } as CSSProperties}>
              <StatCard label="Last 5 school days" icon="calendar" value={<AnimatedNumber value={s.weekPercent} decimals={1} format={(v) => formatPercent(v)} />} delta={Math.round((s.weekPercent - s.fortnightPercent) * 10) / 10} deltaLabel={`${s.weekPercent >= s.fortnightPercent ? "+" : ""}${(Math.round((s.weekPercent - s.fortnightPercent) * 10) / 10).toFixed(1)} pts`} foot="against the fortnight" />
            </div>
            <div style={{ "--i": 2 } as CSSProperties}>
              <StatCard label="Last 14 school days" icon="trendUp" tone="info" value={<AnimatedNumber value={s.fortnightPercent} decimals={1} format={(v) => formatPercent(v)} />} foot="Average attended" />
            </div>
            <div style={{ "--i": 3 } as CSSProperties}>
              <StatCard
                label="Registers in by 9:00 AM"
                icon="clock"
                tone={s.onTime.byNine < s.onTime.submitted ? "warning" : "neutral"}
                value={`${s.onTime.byNine} of ${s.onTime.submitted}`}
                meter={s.onTime.submitted ? (s.onTime.byNine / s.onTime.submitted) * 100 : 0}
                meterLabel="Registers on time"
                foot={ended ? `On ${formatDate(s.date)}` : `${s.today.notMarked} not marked yet`}
              />
            </div>
          </>
        )}
      </div>

      {!s ? (
        <div className="att-grid-2">
          <Skeleton height={320} />
          <Skeleton height={320} />
        </div>
      ) : (
        <>
          <div className="att-grid-2">
            <Trend s={s} ended={ended} />
            <Groups s={s} all={all} ended={ended} />
          </div>
          <div className="att-grid-2">
            <Panel id="att-months" rise={3} flush title="Month by month" description="Share of students attended in each month of the session. Vacation months have no school days.">
              <DataTable
                caption="Attendance by month"
                density="dense"
                rowKey="month"
                rows={[...s.months].reverse()}
                columns={[
                  { key: "month", header: "Month", render: (m) => <span className="mtb-cell-primary">{monthLabel(m.month)}</span> },
                  { key: "days", header: "School days", align: "right", render: (m) => <span className="mtb-num">{m.schoolDays}</span> },
                  {
                    key: "percent",
                    header: "Attended",
                    align: "right",
                    width: 200,
                    render: (m) =>
                      m.percent === null ? (
                        <span className="text-ink-muted">{m.note ?? "No school days"}</span>
                      ) : (
                        <span className="inline-flex items-center justify-end gap-2">
                          <span className="mtb-num">{formatPercent(m.percent)}</span>
                          <span className="mtb-meter w-16" role="img" aria-label={formatPercent(m.percent)}>
                            <span style={{ width: `${m.percent}%` }} />
                          </span>
                        </span>
                      ),
                  },
                ]}
              />
            </Panel>
            <Panel id="att-low" rise={4} title={all ? "Lowest campuses" : "Students below 75%"} description={all ? "Choose a campus to see the students who need a call home." : ended ? "The session's last 26 school days." : "Last 26 school days. Call home before it becomes a struck-off case."}>
              {all ? (
                <ul className="att-list">
                  {[...s.groups]
                    .sort((a, b) => a.percent - b.percent)
                    .slice(0, 3)
                    .map((g) => (
                      <li key={g.label}>
                        <span className="font-medium text-ink">{g.label}</span>
                        <span className="ml-auto mtb-num">{formatPercent(g.percent)}</span>
                      </li>
                    ))}
                </ul>
              ) : s.lowStudents.length === 0 ? (
                <EmptyState icon="checkCircle" title="Everyone is above 75%" />
              ) : (
                <ul className="att-list">
                  {s.lowStudents.map((x, i) => (
                    <li key={x.grNo} className="mtb-slide-in" style={{ "--i": i } as CSSProperties}>
                      <span className="grid min-w-0">
                        <Link to="/attendance/students" search={(p: Record<string, unknown>) => ({ ...p, view: "student" as const, grNo: x.grNo, cls: x.classSection })} className="font-medium text-ink no-underline hover:underline">
                          {x.name}
                        </Link>
                        <span className="text-small text-ink-muted">
                          {x.classSection} · {x.absent} days absent
                        </span>
                      </span>
                      <span className="ml-auto mtb-num font-semibold text-danger-ink">{formatPercent(x.percent)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </>
      )}
    </AttendanceShell>
  );
}
