import { attendanceQueries, type AttendanceMonthlySheet } from "@mtb/api";
import { formatCount, formatDate } from "@mtb/domain";
import { AttendanceLegend, Button, EmptyState, Panel, Select, Skeleton, StatCard } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type CSSProperties } from "react";
import { RequireSingleCampus } from "../../app/shell/page";
import { useCtx, useReadOnly } from "../../app/session";
import { AttendanceShell, monthLabel, pctMeter, pctText, PrintSheet, QueryError, sessionMonths, teacherText, useSections, useSessionSpan } from "./shared";

export interface MonthlySearch {
  cls?: string;
  month?: string;
}

function dayClass(sheet: AttendanceMonthlySheet, i: number, todayDate: string, code?: string) {
  const d = sheet.days[i]!;
  const today = d.date === todayDate ? " is-today" : "";
  if (d.kind === "OFF") return `att-day is-off${today}`;
  if (d.kind === "CLOSED") return `att-day is-closed${today}`;
  if (d.kind === "FUTURE") return `att-day is-future${today}`;
  return `att-day${code ? ` is-${code}` : ""}${today}`;
}

/** Students × days for one class and month, with totals: the register teachers used to keep on paper. */
export function MonthlySheetPage({ search, setSearch }: { search: MonthlySearch; setSearch: (next: MonthlySearch) => void }) {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const sections = useSections();
  const span = useSessionSpan();
  const months = sessionMonths(span);
  // The class in the address, else the campus's first class.
  const cls = search.cls ?? sections.data?.[0]?.classSection;
  const month = search.month && months.includes(search.month) ? search.month : months[0]!;
  const q = useQuery({
    ...attendanceQueries.monthly(ctx, cls ?? "", month),
    enabled: ctx.campus !== "ALL" && !!cls && span.ready,
    placeholderData: (prev) => (prev && months.includes(prev.month) ? prev : undefined),
  });
  const sheet = q.data;

  const school = sheet?.days.filter((d) => d.kind === "SCHOOL").length ?? 0;
  const lowest = sheet?.students.filter((s) => s.totals.percent !== null).sort((a, b) => (a.totals.percent ?? 0) - (b.totals.percent ?? 0))[0];
  const closed = sheet?.days.filter((d) => d.kind === "CLOSED") ?? [];
  // Print the register filled from the day's registers, or blank to fill by hand (as the old printout was used).
  const [blank, setBlank] = useState(false);
  const delivered = sheet ? `Lessons delivered: this month ${formatCount(school)} · previous month ${formatCount(sheet.schoolDaysPreviousMonth)} · total ${formatCount(sheet.schoolDaysSessionToDate)}` : "";
  const print = (asBlank: boolean) => {
    setBlank(asBlank);
    window.setTimeout(() => window.print(), 60);
  };

  return (
    <AttendanceShell
      title="Monthly attendance sheet"
      actions={
        <div className="flex flex-wrap gap-2">
          <Button icon="printer" disabled={!sheet} onClick={() => print(false)}>
            Print (A4 landscape)
          </Button>
          <Button icon="printer" variant="quiet" disabled={!sheet} onClick={() => print(true)}>
            Print blank register
          </Button>
        </div>
      }
    >
      <RequireSingleCampus action="monthly sheets">
        <div className="att-filters">
          <div className="att-f">
            <Select
              label="Class"
              value={cls ?? ""}
              onChange={(e) => setSearch({ ...search, cls: e.target.value })}
              options={(sections.data ?? []).map((s) => ({ value: s.classSection, label: s.classTeacher ? `${s.classSection} · ${s.classTeacher}` : s.classSection }))}
            />
          </div>
          <div className="att-f">
            <Select label="Month" value={month} onChange={(e) => setSearch({ ...search, month: e.target.value })} options={months.map((m) => ({ value: m, label: monthLabel(m) }))} />
          </div>
          <div className="ml-auto">
            <AttendanceLegend />
          </div>
        </div>

        {q.isError && <QueryError what="The monthly sheet" error={q.error} onRetry={() => void q.refetch()} />}

        <div className="att-kpis">
          {!sheet ? (
            [0, 1, 2, 3].map((i) => <StatCard key={i} label="" loading />)
          ) : (
            <>
              <StatCard label="School days" icon="calendar" value={formatCount(school)} foot={closed.length ? `${closed.length} closed: ${[...new Set(closed.map((d) => d.label))].join(", ")}` : "No holidays this month"} />
              <StatCard label="Class attended" icon="attendance" value={pctText(sheet.totals.percent)} {...pctMeter(sheet.totals.percent, "Attended")} foot={`${formatCount(sheet.totals.present + sheet.totals.late)} of ${formatCount(sheet.totals.schoolDays)} student-days`} />
              <StatCard label="Absences" icon="alertCircle" tone="danger" value={formatCount(sheet.totals.absent)} foot={`${formatCount(sheet.totals.leave)} on leave · ${formatCount(sheet.totals.late)} late`} />
              <StatCard label="Lowest attendance" icon="trendDown" tone="warning" value={lowest ? pctText(lowest.totals.percent) : "—"} foot={lowest ? lowest.name : "No marks yet"} />
            </>
          )}
        </div>

        <Panel
          id="att-sheet"
          rise={1}
          flush
          title={sheet ? `${sheet.classSection} · ${monthLabel(sheet.month)}` : "Monthly sheet"}
          description={sheet ? `Class teacher ${teacherText(sheet.classTeacher)} · ${sheet.students.length} students. ${delivered}. Weekly days off are shaded; holidays are hatched. Pick a student to see their report.` : undefined}
        >
          {!sheet ? (
            <div className="p-4">
              <Skeleton height={420} />
            </div>
          ) : sheet.students.length === 0 ? (
            <EmptyState icon="students" title="No students in this class" />
          ) : (
            <div className="att-sheet-wrap" style={{ opacity: q.isFetching ? 0.6 : 1, transition: "opacity 160ms ease" }}>
              <table className="att-sheet">
                <caption className="mtb-sr-only">
                  Attendance of {sheet.classSection} for {monthLabel(sheet.month)}: one row per student, one column per day
                </caption>
                <thead>
                  <tr>
                    <th className="att-sticky" scope="col" rowSpan={2}>
                      Roll · Student
                    </th>
                    <th scope="col" rowSpan={2} className="att-info">
                      G.R. No.
                    </th>
                    <th scope="col" rowSpan={2} className="att-info">
                      Father
                    </th>
                    {sheet.days.map((d) => (
                      <th key={d.date} scope="col" rowSpan={2} className={d.kind === "OFF" ? "is-off" : d.kind === "CLOSED" ? "is-closed" : undefined} title={d.label ?`${formatDate(d.date)}: ${d.label}` : `${formatDate(d.date)}: open the register`}>
                        <span className="wd">{d.weekday.slice(0, 2)}</span>
                        {d.kind === "SCHOOL" ? (
                          <Link to="/attendance/register/$classSection" params={{ classSection: sheet.classSection }} search={{ date: d.date }} className="text-inherit no-underline hover:underline" aria-label={`Open the ${sheet.classSection} register for ${formatDate(d.date)}`}>
                            {Number(d.date.slice(8))}
                          </Link>
                        ) : (
                          Number(d.date.slice(8))
                        )}
                      </th>
                    ))}
                    <th scope="colgroup" colSpan={5} className="att-tot">
                      This month
                    </th>
                    <th scope="colgroup" colSpan={3} className="att-tot">
                      Attended
                    </th>
                  </tr>
                  <tr className="att-sub">
                    <th scope="col" className="att-tot">P</th>
                    <th scope="col" className="att-tot">A</th>
                    <th scope="col" className="att-tot">L</th>
                    <th scope="col" className="att-tot">LT</th>
                    <th scope="col" className="att-tot">%</th>
                    <th scope="col" className="att-tot" title={`Days attended this month, of ${school}`}>
                      Month
                    </th>
                    <th scope="col" className="att-tot" title={`Days attended last month, of ${sheet.schoolDaysPreviousMonth}`}>
                      Prev.
                    </th>
                    <th scope="col" className="att-tot" title={`Days attended this session, of ${sheet.schoolDaysSessionToDate}`}>
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.students.map((s, si) => (
                    <tr key={s.grNo} style={{ "--i": si } as CSSProperties}>
                      <th scope="row" className="att-sticky font-normal">
                        <span className="mtb-num text-ink-muted">{s.rollNo ? String(s.rollNo).padStart(2, "0") : "—"}</span>{" "}
                        <Link to="/attendance/students" search={(p: Record<string, unknown>) => ({ ...p, grNo: s.grNo })} className="text-ink no-underline hover:underline">
                          {s.name}
                        </Link>
                      </th>
                      <td className="att-info mtb-num">{s.grNo}</td>
                      <td className="att-info">{s.father || "—"}</td>
                      {sheet.days.map((d, i) => {
                        const code = s.codes[d.date];
                        return (
                          <td key={d.date} className={dayClass(sheet, i, span.today, code)} title={d.label ?? undefined}>
                            {d.kind === "SCHOOL" ? (code === "P" ? "·" : (code ?? "")) : ""}
                            {code === "P" && <span className="mtb-sr-only">Present</span>}
                          </td>
                        );
                      })}
                      <td className="att-tot">{s.totals.present}</td>
                      <td className="att-tot">{s.totals.absent}</td>
                      <td className="att-tot">{s.totals.leave}</td>
                      <td className="att-tot">{s.totals.late}</td>
                      <td className={`att-tot ${s.totals.percent !== null && s.totals.percent < 75 ? "low" : ""}`}>{pctText(s.totals.percent)}</td>
                      <td className="att-tot">{s.totals.present + s.totals.late}</td>
                      <td className="att-tot">{s.previousMonth.attended}</td>
                      <td className="att-tot">{s.sessionToDate.attended}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="att-sticky">Attended each day</td>
                    <td />
                    <td />
                    {sheet.days.map((d) => {
                      const t = sheet.dayTotals[d.date];
                      return (
                        <td key={d.date} className={d.kind === "OFF" ? "is-off" : d.kind === "CLOSED" ? "is-closed" : undefined}>
                          {t ? t.attended : ""}
                        </td>
                      );
                    })}
                    <td className="att-tot">{sheet.totals.present}</td>
                    <td className="att-tot">{sheet.totals.absent}</td>
                    <td className="att-tot">{sheet.totals.leave}</td>
                    <td className="att-tot">{sheet.totals.late}</td>
                    <td className="att-tot">{pctText(sheet.totals.percent)}</td>
                    <td className="att-tot" title="Lessons delivered this month">
                      {school}
                    </td>
                    <td className="att-tot" title="Lessons delivered last month">
                      {sheet.schoolDaysPreviousMonth}
                    </td>
                    <td className="att-tot" title="Lessons delivered this session">
                      {sheet.schoolDaysSessionToDate}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Panel>
        <p className="m-0 text-small text-ink-muted">
          A dot means present. Pick a date to open that day's register.{" "}
          {readOnly ? "Registers of an ended session stay read-only." : "In the old software this register printed with empty boxes to fill by hand; here it fills itself from the day's registers, holidays included."}
        </p>

        {sheet && (
          <PrintSheet
            landscape
            title={`Attendance register · ${sheet.classSection} · ${monthLabel(sheet.month)}`}
            scope={
              blank
                ? `Class teacher ${teacherText(sheet.classTeacher)} · Total students ${sheet.students.length} · Lessons delivered this month ______ · previous month ______ · total ______`
                : `Class teacher ${teacherText(sheet.classTeacher)} · Total students ${sheet.students.length} · ${delivered} · Class attendance ${pctText(sheet.totals.percent)}`
            }
            signatures={["Class teacher", "Vice principal", "Principal"]}
          >
            <table>
              <thead>
                <tr>
                  <th rowSpan={2}>Roll</th>
                  <th rowSpan={2}>G.R. No.</th>
                  <th rowSpan={2} className="l">
                    Student
                  </th>
                  <th rowSpan={2} className="l">
                    Father
                  </th>
                  {sheet.days.map((d) => (
                    <th key={d.date} rowSpan={2} className={d.kind === "OFF" ? "shade" : d.kind === "CLOSED" ? "hatch" : undefined}>
                      {Number(d.date.slice(8))}
                    </th>
                  ))}
                  {!blank && <th colSpan={5}>This month</th>}
                  <th colSpan={3}>Attended</th>
                </tr>
                <tr>
                  {!blank && (
                    <>
                      <th>P</th>
                      <th>A</th>
                      <th>L</th>
                      <th>LT</th>
                      <th>%</th>
                    </>
                  )}
                  <th>This month</th>
                  <th>Previous month</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {sheet.students.map((s) => (
                  <tr key={s.grNo}>
                    <td>{s.rollNo || ""}</td>
                    <td>{s.grNo}</td>
                    <td className="l">{s.name}</td>
                    <td className="l">{s.father}</td>
                    {sheet.days.map((d) => (
                      <td key={d.date} className={d.kind === "OFF" ? "shade" : d.kind === "CLOSED" ? "hatch" : undefined}>
                        {blank ? "" : (s.codes[d.date] ?? "")}
                      </td>
                    ))}
                    {!blank && (
                      <>
                        <td>{s.totals.present}</td>
                        <td>{s.totals.absent}</td>
                        <td>{s.totals.leave}</td>
                        <td>{s.totals.late}</td>
                        <td>{pctText(s.totals.percent)}</td>
                      </>
                    )}
                    <td>{blank ? "" : s.totals.present + s.totals.late}</td>
                    <td>{blank ? "" : s.previousMonth.attended}</td>
                    <td>{blank ? "" : s.sessionToDate.attended}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PrintSheet>
        )}
      </RequireSingleCampus>
    </AttendanceShell>
  );
}
