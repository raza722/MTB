import { attendanceQueries, type AttendanceMonthlySheet } from "@mtb/api";
import { formatCount, formatDate } from "@mtb/domain";
import { AttendanceLegend, Button, EmptyState, Panel, Select, Skeleton, StatCard } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type CSSProperties } from "react";
import { Letterhead } from "../../app/print/letterhead";
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

        {sheet && (blank ? <BlankRegisterPrint sheet={sheet} /> : <AttendanceReportPrint sheet={sheet} />)}
      </RequireSingleCampus>
    </AttendanceShell>
  );
}

const codeClass = (c?: string) => (c === "A" ? "att-old-a" : undefined);

/** "7" and "B" from "7-B" (section names may contain dashes). */
function splitClass(classSection: string) {
  const i = classSection.indexOf("-");
  return i < 0 ? { cls: classSection, section: "" } : { cls: classSection.slice(0, i), section: classSection.slice(i + 1) };
}

/**
 * The month filled in, as the old "Student Attendance Report": the class's school days across the top (weekday over
 * the date), each student's mark per day, total attended (T.A) and the percentage.
 */
function AttendanceReportPrint({ sheet }: { sheet: AttendanceMonthlySheet }) {
  // The days a register was taken, as the old report listed them.
  const days = sheet.days.filter((d) => d.kind === "SCHOOL" && ((sheet.dayTotals[d.date]?.marked ?? 0) > 0 || sheet.students.some((s) => s.codes[d.date])));
  const first = sheet.days[0]?.date;
  const last = sheet.days[sheet.days.length - 1]?.date;
  const { cls, section } = splitClass(sheet.classSection);
  return (
    <PrintSheet
      landscape
      title="Student Attendance Report"
      scope=""
      signatures={[]}
      head={
        <header className="att-old-head">
          <h1>Student Attendance Report</h1>
          <p>
            <b>Date From:</b> <span>{first ? formatDate(first) : ""}</span> <b>Date To:</b> <span>{last ? formatDate(last) : ""}</span>
          </p>
          <p>
            <b>
              {cls}
              {section ? ` - ${section}` : ""}
            </b>
          </p>
        </header>
      }
    >
      <table className="att-old-table">
        <thead>
          <tr>
            <th rowSpan={2}>Sr. #</th>
            <th rowSpan={2}>G.R.No</th>
            <th rowSpan={2} className="att-old-name">
              Name
            </th>
            {days.map((d) => (
              <th key={d.date} className="att-old-day">
                {d.weekday}
              </th>
            ))}
            <th rowSpan={2}>T.A</th>
            <th rowSpan={2}>%age</th>
          </tr>
          <tr>
            {days.map((d) => (
              <th key={d.date} className="att-old-day">
                {formatDate(d.date).slice(0, 6).replace("-", " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sheet.students.map((s, i) => (
            <tr key={s.grNo}>
              <td>{i + 1}</td>
              <td className="att-old-gr">{s.grNo}</td>
              <td className="l">
                {s.name}
                {s.father ? ` - ${s.father}` : ""}
              </td>
              {days.map((d) => (
                <td key={d.date} className={codeClass(s.codes[d.date])}>
                  {s.codes[d.date] ?? ""}
                </td>
              ))}
              <td>{s.totals.present + s.totals.late}</td>
              <td>{pctText(s.totals.percent)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </PrintSheet>
  );
}

/**
 * The blank register to fill by hand, as the old "Attendance Register": class, section, total students and month,
 * lines for lessons delivered and the vice principal's and class in-charge's signatures, one box per day.
 */
function BlankRegisterPrint({ sheet }: { sheet: AttendanceMonthlySheet }) {
  const ctx = useCtx();
  const { cls, section } = splitClass(sheet.classSection);
  const line = <span className="att-old-line" />;
  return (
    <PrintSheet
      landscape
      title="Attendance Register"
      scope=""
      signatures={[]}
      head={
        <header className="att-reg-head">
          <Letterhead campus={ctx.campus} campusName={sheet.campusName} title="Attendance Register" titleCase="as-is" />
          <div className="att-reg-fields">
            <span>
              <b>Class:</b> {cls}
            </span>
            <span>
              <b>Section:</b> {section}
            </span>
            <span>
              <b>Total Students:</b> {sheet.students.length}
            </span>
            <span>
              <b>Month:</b> {monthLabel(sheet.month)}
            </span>
            <span className="att-reg-signs">
              <span>
                <b>Sign. Vice Principal:</b> {line}
              </span>
              <span>
                <b>Sign. Class Incharge:</b> {line}
              </span>
            </span>
          </div>
          <div className="att-reg-fields">
            <span>
              <b>Lessons Delivered This Month:</b> {line}
            </span>
            <span>
              <b>Lessons Delivered Previous Month:</b> {line}
            </span>
            <span>
              <b>Total Lessons Delivered:</b> {line}
            </span>
            <span>
              <b>Date:</b> {line}
            </span>
          </div>
        </header>
      }
    >
      <table className="att-old-table">
        <thead>
          <tr>
            <th rowSpan={2}>Sr.#</th>
            <th rowSpan={2}>GRNo.</th>
            <th rowSpan={2}>Student Name</th>
            <th rowSpan={2}>Father Name</th>
            {sheet.days.map((d) => (
              <th key={d.date} rowSpan={2} className={d.kind === "OFF" ? "shade" : d.kind === "CLOSED" ? "hatch" : undefined}>
                {Number(d.date.slice(8))}
              </th>
            ))}
            <th colSpan={3}>Attendances</th>
          </tr>
          <tr>
            <th>This Month</th>
            <th>Previous Month</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {sheet.students.map((s, i) => (
            <tr key={s.grNo}>
              <td>{i + 1}</td>
              <td>{s.grNo}</td>
              <td className="l">{s.name}</td>
              <td className="l">{s.father}</td>
              {sheet.days.map((d) => (
                <td key={d.date} className={d.kind === "OFF" ? "shade" : d.kind === "CLOSED" ? "hatch" : undefined} />
              ))}
              <td />
              <td />
              <td />
            </tr>
          ))}
        </tbody>
      </table>
    </PrintSheet>
  );
}
