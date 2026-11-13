import { attendanceQueries, type AttendanceGroupRow, type AttendanceOverview } from "@mtb/api";
import { formatCount, formatDate, formatLongDate, formatPercent } from "@mtb/domain";
import { AreaChart, DataTable, DeviationChart, EmptyState, Panel, Segmented, Skeleton, Sparkline, StatCard, type Column } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type CSSProperties } from "react";
import { campusLabel } from "../../app/shell/campus";
import { useCtx, useReadOnly } from "../../app/session";
import { AttendanceShell, monthLabel, pctText, PctValue, QueryError } from "./shared";

const short = (d: string) => formatDate(d).slice(0, 6);
const round1 = (v: number) => Math.round(v * 10) / 10;
/** Lowest first; groups with nothing marked (no percentage) last. */
const byPercent = (a: AttendanceGroupRow, b: AttendanceGroupRow) => (a.percent ?? 101) - (b.percent ?? 101);
type MarkedGroup = AttendanceGroupRow & { percent: number };
const marked = (g: AttendanceGroupRow): g is MarkedGroup => g.percent !== null;

/** "the last 14 school days", or each campus's own last 14 (All campuses; spec 04 §11 F2). */
const daysText = (n: number, all: boolean, ended: boolean) =>
  all ? `each campus's last ${n} school days` : `${ended ? "the session's last" : "the last"} ${n} school days`;

function Trend({ s, all, ended }: { s: AttendanceOverview; all: boolean; ended: boolean }) {
  const [view, setView] = useState("chart");
  // Days with nothing marked have no percentage: they are left out of the chart.
  const rows = s.trend.flatMap((d) => (d.percent === null ? [] : [{ date: d.date, percent: d.percent, away: round1(100 - d.percent) }]));
  const lastLabel = ended ? "Last day" : "Today";
  return (
    <Panel
      id="att-trend"
      rise={1}
      flush={view === "table"}
      title="Students not in school, day by day"
      description={`Absent or on leave, as a share of students marked, over ${daysText(all ? 14 : s.trend.length, all, ended)}. Lower is better. ${lastLabel} ${pctText(s.today.percent === null ? null : round1(100 - s.today.percent))}.`}
      actions={<Segmented aria-label="Show trend as" value={view} onChange={setView} options={[{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }]} />}
    >
      {view === "chart" ? (
        <AreaChart
          data={rows}
          value={(d) => d.away}
          axisLabel={(d) => (d.date === s.date && !ended ? "Today" : short(d.date))}
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
          label={`Share of students not in school over ${daysText(all ? 14 : rows.length, all, ended)}`}
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
  const sorted = [...s.groups].sort(byPercent);
  const lowest = sorted.find(marked);
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
          <span className="mtb-num">{pctText(g.percent)}</span>
          {g.percent !== null && (
            <span className="mtb-meter w-16" role="img" aria-label={pctText(g.percent)}>
              <span style={{ width: `${g.percent}%` }} />
            </span>
          )}
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
      description={`${all ? "Each campus's last" : ended ? "The session's last" : "The last"} 26 school days, against ${all ? "all campuses" : "the campus"} at ${pctText(s.groupsPercent)}.${lowest ? ` Lowest: ${lowest.label} at ${formatPercent(lowest.percent)}.` : ""}`}
      actions={<Segmented aria-label="Show as" value={view} onChange={setView} options={[{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }]} />}
    >
      {view === "chart" && s.groupsPercent !== null ? (
        <DeviationChart
          data={s.groups.filter(marked)}
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
          label={`Attendance by ${all ? "campus" : "class"} compared with ${pctText(s.groupsPercent)}`}
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
  const trendValues = (s?.trend ?? []).flatMap((d) => (d.percent === null ? [] : [d.percent]));
  const weekDelta = s && s.weekPercent !== null && s.fortnightPercent !== null ? round1(s.weekPercent - s.fortnightPercent) : null;

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
              <StatCard label={ended ? "Last school day" : "Today"} icon="attendance" value={<PctValue value={s.today.percent} />} foot={s.today.marked ? `${formatCount(s.today.attended)} of ${formatCount(s.today.marked)} marked` : "No register submitted yet"}>
                {trendValues.length > 1 && <Sparkline values={trendValues} label={`${all ? "Each campus's last 14" : `Last ${s.trend.length}`} school days: ${formatPercent(trendValues[0]!)} to ${formatPercent(trendValues.at(-1)!)}`} />}
              </StatCard>
            </div>
            <div style={{ "--i": 1 } as CSSProperties}>
              <StatCard
                label="Last 5 school days"
                icon="calendar"
                value={<PctValue value={s.weekPercent} />}
                {...(weekDelta !== null ? { delta: weekDelta, deltaLabel: `${weekDelta >= 0 ? "+" : ""}${weekDelta.toFixed(1)} pts` } : {})}
                foot={weekDelta !== null ? "against the fortnight" : "Nothing marked to compare"}
              />
            </div>
            <div style={{ "--i": 2 } as CSSProperties}>
              <StatCard label="Last 14 school days" icon="trendUp" tone="info" value={<PctValue value={s.fortnightPercent} />} foot="Attended out of students marked" />
            </div>
            <div style={{ "--i": 3 } as CSSProperties}>
              <StatCard
                label="Registers in by 9:00 AM"
                icon="clock"
                tone={s.onTime.byNine < s.onTime.submitted ? "warning" : "neutral"}
                value={`${s.onTime.byNine} of ${s.onTime.submitted}`}
                {...(s.onTime.submitted ? { meter: (s.onTime.byNine / s.onTime.submitted) * 100, meterLabel: "Registers on time" } : {})}
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
            <Trend s={s} all={all} ended={ended} />
            <Groups s={s} all={all} ended={ended} />
          </div>
          <div className="att-grid-2">
            <Panel id="att-months" rise={3} flush title="Month by month" description={`Share of students attended in each month of the session. Vacation months have no school days.${all ? " School days follow the all-campuses calendar; a campus's own closures are not taken off." : ""}`}>
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
                    .sort(byPercent)
                    .slice(0, 3)
                    .map((g) => (
                      <li key={g.label}>
                        <span className="font-medium text-ink">{g.label}</span>
                        <span className="ml-auto mtb-num">{pctText(g.percent)}</span>
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
