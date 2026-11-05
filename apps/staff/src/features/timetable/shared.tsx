import {
  ApiError,
  clockTime,
  findTimetableClashes,
  isFriday,
  maxPeriodsOf,
  periodsOn,
  periodTime,
  SEASON_LABEL,
  streamShort,
  TIMETABLE_DAYS,
  timetableQueries,
  toMinutes,
  type BellSchedule,
  type TimetableBoard,
  type TimetableClash,
  type TimetableDay,
  type TimetableSlot,
  type TimetableTeacher,
} from "@mtb/api";
import { formatDate, formatSession } from "@mtb/domain";
import { Banner, Button, Icon, Select } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useMemo, type CSSProperties, type ReactNode } from "react";
import { campusLabel } from "../../app/shell/campus";
import { Page, PageHeader } from "../../app/shell/page";
import { SubNav, type SubNavItem } from "../../app/shell/SubNav";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import "./timetable.css";

export const TODAY = "2026-11-04";
/** Wednesday, the demo's today. */
export const TODAY_DAY: TimetableDay = 3;

const NAV: SubNavItem[] = [
  { to: "/timetable", label: "Class timetables", icon: "layers", exact: true },
  { to: "/timetable/teachers", label: "Teacher timetables", icon: "user" },
  { to: "/timetable/substitutions", label: "Cover for absent teachers", icon: "refresh" },
  { to: "/timetable/weekly", label: "Periods per subject", icon: "listChecks" },
  { to: "/timetable/periods", label: "Bell timings", icon: "clock" },
];

export function TimetableShell({ title, context, actions, meta, children }: { title: string; context?: ReactNode; actions?: ReactNode; meta?: ReactNode; children: ReactNode }) {
  const readOnly = useReadOnly();
  const { session } = useCtx();
  return (
    <Page>
      <PageHeader
        title={title}
        {...(context !== undefined ? { context } : {})}
        {...(actions ? { actions } : {})}
        meta={
          <>
            {meta}
            {readOnly && <span className="text-small text-ink-muted">Session {formatSession(session)} · read-only</span>}
          </>
        }
      />
      <SubNav items={NAV} label="Timetable" />
      {children}
    </Page>
  );
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.isNetwork ? "No response from the server. Check the connection and try again." : e.message;
  return "Something went wrong. Try again.";
}

export function QueryError({ what, error, onRetry }: { what: string; error: unknown; onRetry: () => void }) {
  return (
    <Banner
      tone="danger"
      title={`${what} could not be loaded.`}
      actions={
        <Button size="sm" variant="secondary" icon="refresh" onClick={onRetry}>
          Try again
        </Button>
      }
    >
      {errorText(error)}
    </Banner>
  );
}

/** The campus timetable (one query shared by every timetable page). */
export function useBoard() {
  const ctx = useCtx();
  return useQuery({ ...timetableQueries.board(ctx), enabled: ctx.campus !== "ALL" });
}

/** Can change the timetable here: permission, current session. */
export function useCanEdit(): boolean {
  const canManage = useCan("timetable.manage");
  const readOnly = useReadOnly();
  return canManage && !readOnly;
}

export const dayLong = (d: TimetableDay) => TIMETABLE_DAYS.find((x) => x.day === d)!.long;
export const dayShort = (d: TimetableDay) => TIMETABLE_DAYS.find((x) => x.day === d)!.short;

export interface BoardIndex {
  subject: (id: string) => { name: string; short: string; tint: number };
  teacher: (id: string | null) => TimetableTeacher | undefined;
  /** Clashes on the board and the slot ids they touch. */
  clashes: TimetableClash[];
  clashOf: (slotId: string) => TimetableClash[];
  maxPeriods: number;
  /** A period's time; pass the class to use its own bell timings (seniors run on their own). */
  timeOf: (day: TimetableDay, period: number, classSection?: string) => { start: string; end: string } | undefined;
}

export function useBoardIndex(board: TimetableBoard | undefined): BoardIndex | null {
  return useMemo(() => {
    if (!board) return null;
    const subjects = new Map(board.subjects.map((s, i) => [s.id, { name: s.name, short: s.short, tint: i % 8 }]));
    const teachers = new Map(board.teachers.map((t) => [t.id, t]));
    const clashes = findTimetableClashes(board);
    const bySlot = new Map<string, TimetableClash[]>();
    for (const c of clashes) for (const id of c.slotIds) bySlot.set(id, [...(bySlot.get(id) ?? []), c]);
    return {
      subject: (id: string) => subjects.get(id) ?? { name: id, short: id, tint: 0 },
      teacher: (id: string | null) => (id ? teachers.get(id) : undefined),
      clashes,
      clashOf: (id: string) => bySlot.get(id) ?? [],
      maxPeriods: maxPeriodsOf(board),
      timeOf: (day: TimetableDay, period: number, classSection?: string) => (classSection ? periodTime(board, classSection, day, period) : (isFriday(day) ? board.friday : board.normal).periods.find((p) => p.no === period)),
    };
  }, [board]);
}

export const teacherShort = (name: string) => name.replace(/^(Mr|Ms|Mrs)\s+/, "");

/** Lessons of one class in one period (whole class, or one per group). */
export const cellSlots = (board: Pick<TimetableBoard, "slots">, classSection: string, day: TimetableDay, period: number) => board.slots.filter((s) => s.classSection === classSection && s.day === day && s.period === period);

/** The period is split between groups (some lesson is for one group only). */
export const isSplit = (board: Pick<TimetableBoard, "slots">, classSection: string, day: TimetableDay, period: number) => cellSlots(board, classSection, day, period).some((s) => s.stream);

/** "9-A" or "9-A Bio" — a lesson's class, with the group when the class is split. */
export const lessonClass = (s: Pick<TimetableSlot, "classSection" | "stream">) => (s.stream ? `${s.classSection} ${streamShort(s.stream)}` : s.classSection);

/** Days as short names, runs collapsed: [1,2,3,4,5,6] → "Mon–Sat", [1,3] → "Mon, Wed". */
export function collapseDays(days: TimetableDay[]): string {
  const list = [...new Set(days)].sort((a, b) => a - b);
  const runs: Array<[TimetableDay, TimetableDay]> = [];
  for (const d of list) {
    const last = runs[runs.length - 1];
    if (last && d === last[1] + 1) last[1] = d;
    else runs.push([d, d]);
  }
  return runs.map(([a, b]) => (a === b ? dayShort(a) : b === a + 1 ? `${dayShort(a)}, ${dayShort(b)}` : `${dayShort(a)}–${dayShort(b)}`)).join(", ");
}

export interface GridCell {
  content: ReactNode;
  className?: string;
  onClick?: () => void;
  label: string;
  /** Its own start time, shown in the corner (a class on other bell timings). */
  time?: string;
}

/**
 * The weekly grid: days down the side, periods across, the break as a narrow column. Friday is the short day:
 * periods past its last one show as closed, and each Friday cell carries its own time. A class with groups gets a
 * "G" column: a period taught to the whole class spans the group rows, a split period has one cell per group.
 */
export function TimetableGrid({
  board,
  cell,
  caption,
  highlightToday = true,
  schedule = board.schedule,
  periods: periodCount,
  streams = [],
  split,
}: {
  board: TimetableBoard;
  cell: (day: TimetableDay, period: number, stream: string | null) => GridCell;
  caption: string;
  highlightToday?: boolean;
  /** Bell timings for the header and the closed periods (a class's own; the main ones by default). */
  schedule?: BellSchedule;
  /** Period columns; defaults to the schedule's longest day. */
  periods?: number;
  /** The class's groups: one row per group each day. */
  streams?: string[];
  /** Is this period split between the groups? */
  split?: (day: TimetableDay, period: number) => boolean;
}) {
  const max = periodCount ?? Math.max(schedule.normal.periods, schedule.friday.periods);
  const periods = Array.from({ length: max }, (_, i) => i + 1);
  const breakAfter = schedule.normal.breakAfter;
  const days = board.days?.[schedule.id] ?? { normal: board.normal, friday: board.friday };
  const normal = days.normal;
  const rowsPerDay = streams.length || 1;
  const open = (day: TimetableDay, p: number) => p <= (periodCount ? Math.max(...(board.schedules ?? [schedule]).map((s) => periodsOn(s, day))) : periodsOn(schedule, day));
  let n = 0;
  const renderCell = (c: GridCell | null, day: TimetableDay, p: number, long: string, rowSpan?: number) => {
    n++;
    const style = { "--i": n } as CSSProperties;
    const ft = isFriday(day) ? days.friday.periods.find((x) => x.no === p) : undefined;
    const time = c?.time ?? (ft ? clockTime(ft.start).slice(0, 5) : undefined);
    return (
      <td key={p} {...(rowSpan && rowSpan > 1 ? { rowSpan } : {})}>
        {!c ? (
          <div className="tt-cell is-closed" aria-label={`${long}, period ${p}: no period`}>
            —
          </div>
        ) : c.onClick ? (
          <button type="button" className={`tt-cell ${c.className ?? ""}`} style={style} onClick={c.onClick} aria-label={c.label}>
            {time && <span className="tt-time">{time}</span>}
            {c.content}
          </button>
        ) : (
          <div className={`tt-cell ${c.className ?? ""}`} style={style} aria-label={c.label} role="group">
            {time && <span className="tt-time">{time}</span>}
            {c.content}
          </div>
        )}
      </td>
    );
  };
  return (
    <div className="tt-scroll">
      <table className="tt-grid">
        <caption className="mtb-sr-only">{caption}</caption>
        <thead>
          <tr>
            <th className="tt-day" scope="col">
              Day
            </th>
            {streams.length > 0 && (
              <th className="tt-group" scope="col" title="Group">
                G
              </th>
            )}
            {periods.map((p) => {
              const t = normal.periods.find((x) => x.no === p);
              return (
                <Fragment key={p}>
                  <th scope="col">
                    <b>Period {p}</b>
                    {t ? `${clockTime(t.start)}` : "—"}
                  </th>
                  {p === breakAfter && <th className="tt-break" aria-label={`Break ${normal.breakStart ? clockTime(normal.breakStart) : ""}`} />}
                </Fragment>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {TIMETABLE_DAYS.flatMap(({ day, long }) =>
            Array.from({ length: rowsPerDay }, (_, gi) => {
              const stream = streams[gi] ?? null;
              const first = gi === 0;
              return (
                <tr key={`${day}-${gi}`} className={streams.length && gi === rowsPerDay - 1 ? "tt-day-end" : undefined}>
                  {first && (
                    <th scope="row" rowSpan={rowsPerDay} className={`tt-day ${highlightToday && day === TODAY_DAY ? "is-today" : ""}`}>
                      <b>{long}</b>
                      {isFriday(day) ? `Closes ${clockTime(days.friday.offTime)}` : day === TODAY_DAY && highlightToday ? "Today" : ""}
                    </th>
                  )}
                  {streams.length > 0 && (
                    <th scope="row" className="tt-group" title={stream ?? ""}>
                      {stream ? streamShort(stream) : ""}
                    </th>
                  )}
                  {periods.map((p) => {
                    const inDay = open(day, p);
                    const whole = !streams.length || !split?.(day, p);
                    if (whole && !first) return p === breakAfter ? <Fragment key={p} /> : null;
                    const c = inDay ? cell(day, p, whole ? null : stream) : null;
                    return (
                      <Fragment key={p}>
                        {renderCell(c, day, p, long, whole ? rowsPerDay : undefined)}
                        {p === breakAfter && first && (
                          <td className="tt-break" aria-hidden="true" rowSpan={rowsPerDay}>
                            {isFriday(day) ? "" : "Break"}
                          </td>
                        )}
                      </Fragment>
                    );
                  })}
                </tr>
              );
            }),
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Content of one lesson cell. */
export function LessonCell({ title, line, sub, flag }: { title: string; line?: string; sub?: string; flag?: "BLOCK" | "WARN" }) {
  return (
    <>
      <b>{title}</b>
      {line && <span>{line}</span>}
      {sub && <span>{sub}</span>}
      {flag && <Icon name={flag === "BLOCK" ? "alertCircle" : "alert"} size={14} className="tt-flag" label={flag === "BLOCK" ? "Clash" : "Warning"} />}
    </>
  );
}

/** The heading on every printed timetable page. */
export function PrintHead({ board, title, scope, right }: { board: TimetableBoard; title: string; scope: ReactNode; right?: ReactNode }) {
  return (
    <header className="tt-print-head">
      <div>
        <div style={{ fontSize: "9pt", fontWeight: 600 }}>MTB Schools &amp; Colleges · {campusLabel(board.campus)}</div>
        <h1>{title}</h1>
        <div>{scope}</div>
      </div>
      <div style={{ fontSize: "9pt", textAlign: "right" }}>
        {right && <div style={{ fontWeight: 600 }}>{right}</div>}
        Session {formatSession(board.session)} · {SEASON_LABEL[board.schedule.season]} · Printed {formatDate(TODAY)}
      </div>
    </header>
  );
}

/** A printed timetable page (A4 landscape), black on white. A class with groups prints a "G" column, one row per group. */
export function PrintTimetable({
  board,
  title,
  scope,
  cell,
  schedule = board.schedule,
  periods: periodCount,
  streams = [],
  split,
}: {
  board: TimetableBoard;
  title: string;
  scope: string;
  cell: (day: TimetableDay, period: number, stream: string | null) => { title: string; line?: string; time?: string } | null;
  schedule?: BellSchedule;
  periods?: number;
  streams?: string[];
  split?: (day: TimetableDay, period: number) => boolean;
}) {
  const max = periodCount ?? Math.max(schedule.normal.periods, schedule.friday.periods);
  const periods = Array.from({ length: max }, (_, i) => i + 1);
  const days = board.days?.[schedule.id] ?? { normal: board.normal, friday: board.friday };
  const rowsPerDay = streams.length || 1;
  const open = (day: TimetableDay, p: number) => p <= (periodCount ? Math.max(...(board.schedules ?? [schedule]).map((s) => periodsOn(s, day))) : periodsOn(schedule, day));
  return (
    <div className="tt-print-page">
      <PrintHead board={board} title={title} scope={scope} />
      <table>
        <thead>
          <tr>
            <th className="l" style={{ width: "62pt" }}>
              Day
            </th>
            {streams.length > 0 && <th style={{ width: "40pt" }}>G</th>}
            {periods.map((p) => {
              const t = days.normal.periods.find((x) => x.no === p);
              return (
                <th key={p}>
                  {p}
                  <br />
                  {t ? `${clockTime(t.start).slice(0, 5)}–${clockTime(t.end).slice(0, 5)}` : ""}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {TIMETABLE_DAYS.flatMap(({ day, long }) =>
            Array.from({ length: rowsPerDay }, (_, gi) => {
              const stream = streams[gi] ?? null;
              const first = gi === 0;
              return (
                <tr key={`${day}-${gi}`}>
                  {first && (
                    <th className="l" rowSpan={rowsPerDay}>
                      {long}
                    </th>
                  )}
                  {streams.length > 0 && <td>{stream ? streamShort(stream) : ""}</td>}
                  {periods.map((p) => {
                    const whole = !streams.length || !split?.(day, p);
                    if (whole && !first) return null;
                    const span = whole && rowsPerDay > 1 ? { rowSpan: rowsPerDay } : {};
                    if (!open(day, p)) return <td key={p} className="shade" {...span} />;
                    const c = cell(day, p, whole ? null : stream);
                    const ft = isFriday(day) ? days.friday.periods.find((x) => x.no === p) : undefined;
                    const time = c?.time ?? (ft ? clockTime(ft.start).slice(0, 5) : undefined);
                    return (
                      <td key={p} className="tt-print-cell" {...span}>
                        {c ? (
                          <>
                            <b>{c.title}</b>
                            {c.line && <span>{c.line}</span>}
                          </>
                        ) : (
                          ""
                        )}
                        {time && <span>{time}</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            }),
          )}
        </tbody>
      </table>
      <p style={{ fontSize: "8pt" }}>
        {schedule.name}: break {days.normal.breakStart ? `${clockTime(days.normal.breakStart)}–${clockTime(days.normal.breakEnd!)}` : "none"} after period {schedule.normal.breakAfter}. Friday: {schedule.friday.periods} periods of {schedule.friday.periodMins} minutes, school closes at {clockTime(days.friday.offTime)}.
        {streams.length > 0 ? ` G: group (${streams.map((s) => `${streamShort(s)} = ${s}`).join(", ")}).` : ""}
      </p>
    </div>
  );
}

export interface PrintMatrixRow {
  key: string;
  label: string;
  sub?: string;
  /** One text per period column; "" for a free period. */
  cells: string[];
}

/**
 * A printed master sheet (A4 landscape): one row per teacher or section, one column per period
 * (the old "One Day Time Table", "Teacher Wise" and "Class Wise Master Sheet").
 */
export function PrintMatrix({ board, title, scope, right, rowHeader, columns, rows, note }: { board: TimetableBoard; title: string; scope: ReactNode; right?: ReactNode; rowHeader: string; columns: Array<{ no: number; time?: string }>; rows: PrintMatrixRow[]; note?: string }) {
  return (
    <div className="tt-print-page">
      <PrintHead board={board} title={title} scope={scope} right={right} />
      {rows.length === 0 ? (
        <p>Nothing to print for these filters.</p>
      ) : (
        <table className="tt-print-matrix">
          <thead>
            <tr>
              <th style={{ width: "22pt" }}>Sr.</th>
              <th className="l" style={{ width: "92pt" }}>
                {rowHeader}
              </th>
              {columns.map((c) => (
                <th key={c.no}>
                  {c.no}
                  {c.time && (
                    <>
                      <br />
                      {c.time}
                    </>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key}>
                <td>{i + 1}</td>
                <th className="l">
                  {r.label}
                  {r.sub && <span style={{ display: "block", fontWeight: 400, fontSize: "7pt" }}>{r.sub}</span>}
                </th>
                {columns.map((c, k) => (
                  <td key={c.no} className="tt-print-small">
                    {r.cells[k] ? r.cells[k]!.split("\n").map((line, j) => <span key={j}>{line}</span>) : "–"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {note && <p style={{ fontSize: "8pt" }}>{note}</p>}
    </div>
  );
}

/** Wraps printed pages: only this appears on paper. */
export function PrintArea({ children }: { children: ReactNode }) {
  return (
    <section className="mtb-print-area tt-print-only" aria-hidden="true">
      <style>{"@page { size: A4 landscape; margin: 10mm; }"}</style>
      {children}
    </section>
  );
}

/** Print after React has drawn the print-only content. */
export function printSoon() {
  window.setTimeout(() => window.print(), 80);
}

/** Who can take a period: not away, no lesson then (by clock time), no other cover then; qualified teachers and lighter days first. */
export function freeTeachers(board: TimetableBoard, day: TimetableDay, period: number, opts: { subjectId?: string; away?: string[]; covers?: Array<{ substituteId: string; period: number; classSection?: string }>; classSection?: string } = {}) {
  const away = new Set(opts.away ?? []);
  const covers = opts.covers ?? [];
  const at = (cs: string | undefined, p: number) => (cs ? periodTime(board, cs, day, p) : undefined);
  const mine = at(opts.classSection, period);
  const overlaps = (cs: string | undefined, p: number) => {
    const t = at(cs, p);
    if (!mine || !t) return p === period;
    return toMinutes(t.start) < toMinutes(mine.end) && toMinutes(mine.start) < toMinutes(t.end);
  };
  return board.teachers
    .filter((t) => !away.has(t.id) && !board.slots.some((s) => s.teacherId === t.id && s.day === day && overlaps(s.classSection, s.period)) && !covers.some((c) => c.substituteId === t.id && overlaps(c.classSection, c.period)))
    .map((t) => {
      const lessons = board.slots.filter((s) => s.teacherId === t.id && s.day === day).length;
      const covering = covers.filter((c) => c.substituteId === t.id).length;
      return { teacher: t, today: lessons + covering, covering, qualified: opts.subjectId ? t.subjectIds.includes(opts.subjectId) : false, full: lessons + covering >= t.maxPerDay };
    })
    .sort((a, b) => Number(a.full) - Number(b.full) || Number(b.qualified) - Number(a.qualified) || a.today - b.today || a.teacher.name.localeCompare(b.teacher.name));
}

export const slotsOf = (board: TimetableBoard, pred: (s: TimetableSlot) => boolean) => board.slots.filter(pred);

/* ------------------------------------------------------------------ Filters for the all-teachers views and slips */

export interface StaffFilter {
  /** Class level id ("lv-sec"), or "" for every level. */
  level: string;
  gender: "" | "F" | "M";
  shift: "" | "MORNING" | "EVENING";
}

/** Teachers with a lesson in a section of the chosen level and shift, of the chosen gender (all teachers with lessons when no filter). */
export function filterTeachers(board: TimetableBoard, f: StaffFilter): TimetableTeacher[] {
  const ok = new Set(board.sections.filter((s) => (!f.level || s.levelId === f.level) && (!f.shift || s.shift === f.shift)).map((s) => s.classSection));
  return board.teachers.filter((t) => (!f.gender || t.gender === f.gender) && board.slots.some((s) => s.teacherId === t.id && ok.has(s.classSection)));
}

/** Levels and shifts that have sections at this campus. */
export function boardLevels(board: TimetableBoard) {
  const levels = [...new Map(board.sections.map((s) => [s.levelId, s.level])).entries()].filter(([id]) => id).map(([value, label]) => ({ value, label }));
  const shifts = [...new Set(board.sections.map((s) => s.shift))];
  return { levels, shifts };
}

export function StaffFilters({ board, value, onChange }: { board: TimetableBoard; value: StaffFilter; onChange: (f: StaffFilter) => void }) {
  const { levels, shifts } = boardLevels(board);
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Select label="Class level" value={value.level} onChange={(e) => onChange({ ...value, level: e.target.value })} options={[{ value: "", label: "All levels" }, ...levels]} />
      <Select
        label="Teachers"
        value={value.gender}
        onChange={(e) => onChange({ ...value, gender: e.target.value as StaffFilter["gender"] })}
        options={[
          { value: "", label: "Men and women" },
          { value: "F", label: "Women" },
          { value: "M", label: "Men" },
        ]}
      />
      {shifts.length > 1 && (
        <Select
          label="Class time"
          value={value.shift}
          onChange={(e) => onChange({ ...value, shift: e.target.value as StaffFilter["shift"] })}
          options={[
            { value: "", label: "Morning and evening" },
            { value: "MORNING", label: "Morning" },
            { value: "EVENING", label: "Evening" },
          ]}
        />
      )}
    </div>
  );
}
