import { attendanceQueries, REGISTER_CODE_LABEL, type AttendanceClassReportRow, type AttendanceStudentReport } from "@mtb/api";
import { formatCount, formatDate, formatLongDate, formatMobile, type IsoDate } from "@mtb/domain";
import { AttendanceCalendar, AttendanceLegend, Button, buttonClassName, DataTable, DatePicker, EmptyState, Input, KeyValue, Panel, Segmented, Select, Skeleton, StatCard, Switch, Tabs, type Column } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type CSSProperties } from "react";
import { RequireSingleCampus } from "../../app/shell/page";
import { useCtx } from "../../app/session";
import { AttendanceShell, CodeBadge, monthLabel, pctText, PrintSheet, QueryError, TODAY, useSections, useSessionSpan, type SessionSpan } from "./shared";

export interface StudentReportSearch {
  view?: "student" | "class";
  grNo?: string;
  cls?: string;
  from?: IsoDate;
  to?: IsoDate;
  below?: number;
}

type RangeKey = "month" | "last" | "session" | "custom";
type Ranges = Record<Exclude<RangeKey, "custom">, { from: IsoDate; to: IsoDate; label: string }>;

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-10" → last day of that month. */
const monthEnd = (m: string) => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0")}`;
};

/** Quick periods for the selected session: its latest month, the month before, and the whole session so far. */
function rangesFor(span: SessionSpan): Ranges {
  const latest = span.last.slice(0, 7);
  const [y, m] = latest.split("-").map(Number) as [number, number];
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  return {
    month: { from: `${latest}-01`, to: span.last, label: span.readOnly ? MONTH_NAMES[m - 1]! : "This month" },
    last: { from: `${prev}-01`, to: monthEnd(prev), label: MONTH_NAMES[Number(prev.slice(5)) - 1]! },
    session: { from: span.starts, to: span.last, label: span.readOnly ? "Whole session" : "Session to date" },
  };
}

/** The class in the URL, else 7-B where it exists, else the campus's first class. */
function defaultClass(cls: string | undefined, sections: Array<{ classSection: string }> | undefined): string | undefined {
  if (cls && (!sections || sections.some((s) => s.classSection === cls))) return cls;
  return sections?.some((s) => s.classSection === "7-B") ? "7-B" : sections?.[0]?.classSection;
}

/** The period in the URL, or the whole session when it is missing or belongs to another session. */
function rangeOf(s: StudentReportSearch, span: SessionSpan): { key: RangeKey; from: IsoDate; to: IsoDate } {
  const ranges = rangesFor(span);
  const inside = (d: IsoDate | undefined) => !!d && d >= span.starts && d <= span.last;
  const from = inside(s.from) ? s.from! : ranges.session.from;
  const to = inside(s.to) ? s.to! : ranges.session.to;
  const key = (Object.entries(ranges).find(([, r]) => r.from === from && r.to === to)?.[0] as RangeKey | undefined) ?? "custom";
  return { key, from, to };
}

function RangePicker({ search, setSearch }: { search: StudentReportSearch; setSearch: (s: StudentReportSearch) => void }) {
  const span = useSessionSpan();
  const RANGES = rangesFor(span);
  const r = rangeOf(search, span);
  const [custom, setCustom] = useState(r.key === "custom");
  return (
    <>
      <div className="grid gap-1">
        <span className="text-small font-medium text-ink">Period</span>
        <Segmented
          aria-label="Period"
          value={custom ? "custom" : r.key}
          onChange={(v) => {
            if (v === "custom") return setCustom(true);
            setCustom(false);
            const x = RANGES[v as Exclude<RangeKey, "custom">];
            setSearch({ ...search, from: x.from, to: x.to });
          }}
          options={[...Object.entries(RANGES).map(([k, x]) => ({ value: k, label: x.label })), { value: "custom", label: "Dates…" }]}
        />
      </div>
      {custom && (
        <>
          <div className="w-44">
            <DatePicker label="From" value={r.from} today={TODAY} minDate={span.starts} maxDate={span.last} onValueChange={(d) => d && setSearch({ ...search, from: d })} />
          </div>
          <div className="w-44">
            <DatePicker label="To" value={r.to} today={TODAY} minDate={r.from} maxDate={span.last} onValueChange={(d) => d && setSearch({ ...search, to: d })} />
          </div>
        </>
      )}
    </>
  );
}

function StudentReport({ report }: { report: AttendanceStudentReport }) {
  const [allMonths, setAllMonths] = useState(false);
  const months = [...report.months].reverse();
  const shown = allMonths ? months : months.slice(0, 2);
  const t = report.totals;
  return (
    <>
      <div className="att-kpis">
        <div style={{ "--i": 0 } as CSSProperties}>
          <StatCard label="Attended" icon="attendance" tone={t.percent !== null && t.percent < 75 ? "danger" : undefined} value={pctText(t.percent)} {...(t.percent !== null ? { meter: t.percent, meterLabel: "Attended", ...(t.percent < 75 ? { meterTone: "danger" as const } : {}) } : {})} foot={`${t.present + t.late} of ${t.schoolDays} school days`} />
        </div>
        <div style={{ "--i": 1 } as CSSProperties}>
          <StatCard label="Absent" icon="alertCircle" tone="danger" value={formatCount(t.absent)} foot={report.longestAbsence > 1 ? `Longest run: ${report.longestAbsence} days in a row` : "No absence runs"} />
        </div>
        <div style={{ "--i": 2 } as CSSProperties}>
          <StatCard label="Leave" icon="calendar" tone="info" value={formatCount(t.leave)} foot="Not counted as attended" />
        </div>
        <div style={{ "--i": 3 } as CSSProperties}>
          <StatCard label="Late" icon="clock" tone="warning" value={formatCount(t.late)} foot={`${report.holidays} holiday${report.holidays === 1 ? "" : "s"} in this period`} />
        </div>
      </div>
      <div className="att-grid-2">
        <Panel
          id="att-student-months"
          rise={1}
          title="Month by month"
          description={`${formatDate(report.from)} to ${formatDate(report.to)}. Every school day has a letter; holidays are hatched.`}
          actions={
            months.length > 2 ? (
              <Button size="sm" variant="quiet" onClick={() => setAllMonths((v) => !v)}>
                {allMonths ? "Latest two months" : `All ${months.length} months`}
              </Button>
            ) : undefined
          }
        >
          <div className="att-months">
            {shown.map((m) => {
              const [y, mo] = m.month.split("-").map(Number) as [number, number];
              return <AttendanceCalendar key={m.month} year={y} month={mo - 1} days={m.days} holidayNames={m.holidayNames} today={TODAY} hideLegend />;
            })}
          </div>
          <div className="mt-4">
            <AttendanceLegend counts={{ present: t.present, absent: t.absent, leave: t.leave, late: t.late, holiday: report.holidays }} />
          </div>
        </Panel>
        <Panel id="att-student-marks" rise={2} flush title="Days not present" description={report.marks.length ? `${report.marks.length} days absent, on leave or late, newest first.` : "Present on every school day in this period."}>
          <DataTable
            caption="Days not present"
            density="dense"
            maxHeight={460}
            rowKey="date"
            rows={report.marks}
            empty={<EmptyState icon="checkCircle" title="Full attendance" description="No absences, leave or late arrivals in this period." />}
            columns={[
              { key: "date", header: "Date", render: (m) => <span className="mtb-num">{formatLongDate(m.date)}</span> },
              { key: "code", header: "Mark", align: "right", render: (m) => <CodeBadge code={m.code} /> },
            ]}
          />
        </Panel>
      </div>
      <PrintSheet title="Student attendance report" scope={`${formatDate(report.from)} to ${formatDate(report.to)}`} signatures={["Class teacher", "Principal"]}>
        <dl className="att-print-kv">
          <dt>G.R. no.</dt>
          <dd>{report.grNo}</dd>
          <dt>Student's name</dt>
          <dd>{report.name}</dd>
          <dt>Father's name</dt>
          <dd>{report.father}</dd>
          <dt>Class / section</dt>
          <dd>{report.classSection}</dd>
          <dt>School days</dt>
          <dd>{t.schoolDays}</dd>
          <dt>Present</dt>
          <dd>{t.present}</dd>
          <dt>Late</dt>
          <dd>{t.late}</dd>
          <dt>Leave</dt>
          <dd>{t.leave}</dd>
          <dt>Absent</dt>
          <dd>{t.absent}</dd>
          <dt>Attendance</dt>
          <dd>{pctText(t.percent)}</dd>
        </dl>
        {report.marks.length > 0 && (
          <table>
            <thead>
              <tr>
                <th className="l">Date</th>
                <th className="l">Mark</th>
              </tr>
            </thead>
            <tbody>
              {report.marks.slice(0, 40).map((m) => (
                <tr key={m.date}>
                  <td className="l">{formatLongDate(m.date)}</td>
                  <td className="l">{REGISTER_CODE_LABEL[m.code]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p>This report is produced from the daily registers. Late counts as attended; leave does not.</p>
      </PrintSheet>
    </>
  );
}

function OneStudent({ search, setSearch }: { search: StudentReportSearch; setSearch: (s: StudentReportSearch) => void }) {
  const ctx = useCtx();
  const sections = useSections();
  const r = rangeOf(search, useSessionSpan());
  const cls = defaultClass(search.cls, sections.data);
  const roster = useQuery({ ...attendanceQueries.classReport(ctx, cls ?? "", r.from, r.to), enabled: ctx.campus !== "ALL" && !!cls });
  const [typed, setTyped] = useState("");
  const grNo = search.grNo;
  const q = useQuery({ ...attendanceQueries.student(ctx, grNo ?? "", r.from, r.to), enabled: !!grNo, placeholderData: (p) => (p && p.grNo === grNo ? p : undefined) });
  const rep = q.data;
  return (
    <>
      <div className="att-filters">
        {ctx.campus !== "ALL" && (
          <>
            <div className="att-f">
              <Select label="Class" value={cls ?? ""} onChange={(e) => setSearch({ ...search, cls: e.target.value, grNo: undefined })} options={(sections.data ?? []).map((s) => ({ value: s.classSection, label: s.classSection }))} />
            </div>
            <div className="att-f" style={{ minWidth: 240 }}>
              <Select
                label="Student"
                value={grNo ?? ""}
                onChange={(e) => setSearch({ ...search, grNo: e.target.value || undefined })}
                options={[{ value: "", label: roster.isLoading ? "Loading…" : "Choose a student" }, ...(roster.data?.rows ?? []).map((s) => ({ value: s.grNo, label: `${s.rollNo}. ${s.name}` }))]}
              />
            </div>
          </>
        )}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.trim()) setSearch({ ...search, grNo: typed.trim().toUpperCase() });
          }}
        >
          <div className="w-40">
            <Input label="Or G.R. no." placeholder="KC-14823" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </div>
          <Button type="submit" icon="search">
            Find
          </Button>
        </form>
        <RangePicker search={search} setSearch={setSearch} />
      </div>
      {!grNo ? (
        <div className="mtb-card">
          <EmptyState icon="user" title="Choose a student" description="Pick a class and a student, or type a G.R. number, to see their attendance for any period." />
        </div>
      ) : q.isError ? (
        <QueryError what="The student's attendance" error={q.error} onRetry={() => void q.refetch()} />
      ) : !rep ? (
        <div className="grid gap-4">
          <Skeleton height={120} />
          <Skeleton height={360} />
        </div>
      ) : (
        <>
          <Panel
            id="att-student-head"
            rise={0}
            title={rep.name}
            description={`${rep.classSection} · ${rep.campusName}`}
            actions={
              <div className="flex gap-2">
                {rep.hasProfile && (
                  <Link to="/students/$grNo" params={{ grNo: rep.grNo }} className={buttonClassName({ size: "sm", variant: "quiet" })}>
                    Open profile
                  </Link>
                )}
                <Button size="sm" icon="printer" onClick={() => window.print()}>
                  Print report
                </Button>
              </div>
            }
          >
            <KeyValue
              items={[
                ["G.R. no.", <span className="mtb-num">{rep.grNo}</span>],
                ["Father", rep.father],
                ["Period", `${formatDate(rep.from)} to ${formatDate(rep.to)}`],
              ]}
            />
          </Panel>
          <StudentReport report={rep} />
        </>
      )}
    </>
  );
}

function ClassReport({ search, setSearch }: { search: StudentReportSearch; setSearch: (s: StudentReportSearch) => void }) {
  const ctx = useCtx();
  const sections = useSections();
  const r = rangeOf(search, useSessionSpan());
  const cls = defaultClass(search.cls, sections.data);
  const below = search.below ?? 75;
  const [onlyBelow, setOnlyBelow] = useState(true);
  const q = useQuery({ ...attendanceQueries.classReport(ctx, cls ?? "", r.from, r.to), enabled: !!cls, placeholderData: (p) => p });
  const all = [...(q.data?.rows ?? [])].sort((a, b) => (a.totals.percent ?? 101) - (b.totals.percent ?? 101) || a.rollNo - b.rollNo);
  const low = all.filter((x) => x.totals.percent !== null && x.totals.percent < below);
  const rows = onlyBelow ? low : all;
  const columns: Array<Column<AttendanceClassReportRow>> = [
    { key: "rollNo", header: "Roll", width: 60, align: "right", render: (x) => <span className="mtb-num">{x.rollNo}</span> },
    {
      key: "name",
      header: "Student",
      render: (x) => (
        <span className="grid">
          <span className="mtb-cell-primary">{x.name}</span>
          <span className="mtb-cell-secondary">{x.father}</span>
          <span className="mtb-cell-secondary mtb-num">
            {x.grNo} · {formatMobile(x.mobile)}
          </span>
        </span>
      ),
    },
    { key: "present", header: "Present", align: "right", width: 90, render: (x) => <span className="mtb-num">{x.totals.present}</span> },
    { key: "absent", header: "Absent", align: "right", width: 90, render: (x) => <span className="mtb-num">{x.totals.absent}</span> },
    { key: "leave", header: "Leave", align: "right", width: 80, render: (x) => <span className="mtb-num">{x.totals.leave}</span> },
    { key: "late", header: "Late", align: "right", width: 80, render: (x) => <span className="mtb-num">{x.totals.late}</span> },
    {
      key: "percent",
      header: "Attended",
      align: "right",
      width: 170,
      render: (x) => (
        <span className="inline-flex items-center justify-end gap-2">
          <span className={`mtb-num ${x.totals.percent !== null && x.totals.percent < below ? "text-danger-ink font-semibold" : ""}`}>{pctText(x.totals.percent)}</span>
          <span className={`mtb-meter w-16 ${x.totals.percent !== null && x.totals.percent < below ? "tone-danger" : ""}`} role="img" aria-label={`${pctText(x.totals.percent)} attended`}>
            <span style={{ width: `${x.totals.percent ?? 0}%` }} />
          </span>
        </span>
      ),
    },
  ];
  return (
    <>
      <div className="att-filters">
        <div className="att-f">
          <Select label="Class" value={cls ?? ""} onChange={(e) => setSearch({ ...search, cls: e.target.value })} options={(sections.data ?? []).map((s) => ({ value: s.classSection, label: s.classSection }))} />
        </div>
        <RangePicker search={search} setSearch={setSearch} />
        <div className="w-36">
          <Input label="Below (%)" inputMode="numeric" amount value={String(below)} onChange={(e) => setSearch({ ...search, below: Math.max(0, Math.min(100, Number(e.target.value.replace(/\D/g, "")) || 0)) })} />
        </div>
        <div className="pb-2">
          <Switch label="Only students below" checked={onlyBelow} onChange={(e) => setOnlyBelow(e.target.checked)} />
        </div>
      </div>
      {q.isError && <QueryError what="The class report" error={q.error} onRetry={() => void q.refetch()} />}
      <Panel
        id="att-class-report"
        rise={0}
        flush
        title={`${cls ?? "Class"}: ${low.length} ${low.length === 1 ? "student" : "students"} below ${below}%`}
        description={q.data ? `${formatDate(q.data.from)} to ${formatDate(q.data.to)} · ${q.data.schoolDays} school days · class teacher ${q.data.classTeacher}. Lowest first.` : undefined}
        actions={
          <Button size="sm" icon="printer" disabled={!q.data} onClick={() => window.print()}>
            Print list
          </Button>
        }
      >
        <DataTable
          caption={`Attendance report for ${cls ?? "the class"}`}
          columns={columns}
          rows={rows}
          rowKey="grNo"
          loading={q.isLoading}
          maxHeight={560}
          onRowClick={(x) => setSearch({ ...search, view: "student", grNo: x.grNo })}
          rowClassName={(x) => (x.totals.percent !== null && x.totals.percent < below ? "att-low" : undefined)}
          empty={<EmptyState icon="checkCircle" title={`Nobody is below ${below}%`} description="Every student in this class is above the line for this period." />}
        />
      </Panel>
      {q.data && (
        <PrintSheet title={`Attendance below ${below}% · ${cls ?? ""}`} scope={`${formatDate(q.data.from)} to ${formatDate(q.data.to)} · ${q.data.schoolDays} school days · Class teacher ${q.data.classTeacher}`}>
          <table>
            <thead>
              <tr>
                <th>Roll</th>
                <th className="l">G.R. no.</th>
                <th className="l">Student</th>
                <th className="l">Father</th>
                <th className="l">Mobile</th>
                <th>P</th>
                <th>A</th>
                <th>L</th>
                <th>LT</th>
                <th>%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.grNo}>
                  <td>{x.rollNo}</td>
                  <td className="l">{x.grNo}</td>
                  <td className="l">{x.name}</td>
                  <td className="l">{x.father}</td>
                  <td className="l">{formatMobile(x.mobile)}</td>
                  <td>{x.totals.present}</td>
                  <td>{x.totals.absent}</td>
                  <td>{x.totals.leave}</td>
                  <td>{x.totals.late}</td>
                  <td>{pctText(x.totals.percent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </PrintSheet>
      )}
    </>
  );
}

/** One student's attendance for any period (with a printable slip), or a class list of students below a line. */
export function StudentReportPage({ search, setSearch }: { search: StudentReportSearch; setSearch: (s: StudentReportSearch) => void }) {
  const span = useSessionSpan();
  const view = search.view ?? "student";
  return (
    <AttendanceShell title="Student attendance reports">
      <Tabs
        aria-label="Report"
        value={view}
        onChange={(v) => setSearch({ ...search, view: v as "student" | "class" })}
        tabs={[
          { id: "student", label: "One student", icon: "user" },
          { id: "class", label: "Class: below a percentage", icon: "students" },
        ]}
      />
      {view === "student" ? (
        <OneStudent search={search} setSearch={setSearch} />
      ) : (
        <RequireSingleCampus action="class reports">
          <ClassReport search={search} setSearch={setSearch} />
        </RequireSingleCampus>
      )}
      <p className="m-0 text-small text-ink-muted">
        Months available: {monthLabel(span.starts.slice(0, 7))} to {monthLabel(span.last.slice(0, 7))}
        {span.readOnly ? ", read-only (carried over from the old software)" : ""}. The old monthly report counted days by hand and could not be run for a date range or a percentage line.
      </p>
    </AttendanceShell>
  );
}
