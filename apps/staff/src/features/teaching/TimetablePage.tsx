import { teacherQueries, type BellDay, type TeacherPeriod, type TeacherWeek, type TeacherWeekDay } from "@mtb/api";
import { formatDate, formatLongDate } from "@mtb/domain";
import { EmptyState, Icon, Panel, PHONE_QUERY, Segmented, Skeleton, StatusBadge, cx, useMediaQuery } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { useState, type CSSProperties } from "react";
import { useCtx } from "../../app/session";
import { Page, PageHeader, useContextLine } from "../../app/shell/page";
import { clock, periodPhase, QueryState } from "./shared";

/** /teaching/timetable — the teacher's week: the whole week as a grid, or one day period by period. */
export function TimetablePage() {
  const ctx = useCtx();
  const line = useContextLine();
  const q = useQuery(teacherQueries.timetable(ctx));
  const w = q.data;
  return (
    <Page>
      <PageHeader title="Timetable" context={w ? `Week of ${formatDate(w.weekOf)} · ${w.periodsThisWeek} ${w.periodsThisWeek === 1 ? "period" : "periods"} · ${line}` : line} />
      <QueryState
        query={q}
        what="Your timetable"
        skeleton={
          <div className="grid gap-2" aria-busy="true" aria-label="Loading your timetable">
            <Skeleton height={56} className="rounded-lg" />
            {Array.from({ length: 7 }, (_, i) => (
              <Skeleton key={i} height={64} className="rounded-lg" />
            ))}
          </div>
        }
      >
        {(week) => <Week w={week} />}
      </QueryState>
    </Page>
  );
}

function Week({ w }: { w: TeacherWeek }) {
  const phone = useMediaQuery(PHONE_QUERY);
  // A phone opens on today; a wider screen on the whole week.
  const [view, setView] = useState<"day" | "week">(phone ? "day" : "week");
  const [date, setDate] = useState(w.today);
  const day = w.days.find((d) => d.date === date) ?? w.days[0]!;
  return (
    <Panel
      id="teacher-week"
      title={view === "week" ? "Whole week" : formatLongDate(day.date)}
      description={view === "week" ? "Choose a day to see it period by period." : day.date === w.today ? "Today" : undefined}
      actions={
        <Segmented
          aria-label="View"
          value={view}
          onChange={(v) => setView(v === "week" ? "week" : "day")}
          options={[
            { value: "week", label: "Whole week" },
            { value: "day", label: "Day" },
          ]}
        />
      }
    >
      {view === "day" ? (
        <div className="grid gap-4">
          <div className="grid grid-cols-6 gap-1" role="group" aria-label="Day">
            {w.days.map((d) => {
              const on = d.date === date;
              return (
                <button
                  key={d.date}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setDate(d.date)}
                  aria-label={`${d.dayName} ${formatDate(d.date)}${d.date === w.today ? ", today" : ""}${d.closed ? `, ${d.closed.name}` : `, ${d.periods.length} ${d.periods.length === 1 ? "period" : "periods"}`}`}
                  className={cx(
                    "relative grid min-h-12 place-items-center rounded-lg border py-1.5 transition-colors",
                    on ? "border-brand bg-brand text-on-brand" : "border-border bg-surface-raised text-ink hover:bg-surface-hover",
                  )}
                >
                  <span className="text-caption">
                    <span className="sm:hidden">{d.dayName.slice(0, 3)}</span>
                    <span className="hidden sm:inline">{d.dayName}</span>
                  </span>
                  <span className="text-title-3 tabular-nums">{d.date.slice(8)}</span>
                  {d.date === w.today && <span className={cx("absolute bottom-1 size-1.5 rounded-full", on ? "bg-on-brand" : "bg-brand")} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
          <DayList key={day.date} day={day} bell={day.day === 5 ? w.friday : w.normal} isToday={day.date === w.today} />
        </div>
      ) : (
        <WeekGrid
          w={w}
          onPick={(d) => {
            setDate(d);
            setView("day");
          }}
        />
      )}
    </Panel>
  );
}

function DayList({ day, bell, isToday }: { day: TeacherWeekDay; bell: BellDay; isToday: boolean }) {
  if (day.closed) return <EmptyState icon="calendar" title={`No school — ${day.closed.name}`} description={`${formatLongDate(day.date)}. No lessons and no register.`} />;
  type Row = { kind: "lesson"; p: TeacherPeriod; start: string } | { kind: "free"; no: number; start: string; end: string } | { kind: "break"; start: string; end: string };
  // Each lesson keeps its own class's times: a class on other bell timings (or a cover in a
  // period the campus's normal bell doesn't have) is placed by its time, never dropped.
  const overlaps = (a: { start: string; end: string }, b: { start: string; end: string }) => a.start < b.end && b.start < a.end;
  const rows: Row[] = day.periods.map((p) => ({ kind: "lesson", p, start: p.start }));
  for (const bp of bell.periods) {
    if (!day.periods.some((p) => p.period === bp.no || overlaps(p, bp))) rows.push({ kind: "free", no: bp.no, start: bp.start, end: bp.end });
  }
  const brk = bell.breakStart ? { start: bell.breakStart, end: bell.breakEnd ?? bell.breakStart } : null;
  if (brk && !day.periods.some((p) => overlaps(p, brk))) rows.push({ kind: "break", ...brk });
  const order = { lesson: 0, break: 1, free: 2 } as const;
  rows.sort((a, b) => (a.start === b.start ? order[a.kind] - order[b.kind] : a.start < b.start ? -1 : 1));
  return (
    <div className="grid gap-2">
      <p className="m-0 px-1 text-small text-ink-muted">
        Assembly {clock(bell.assemblyStart)} · home time {clock(bell.offTime)}
      </p>
      <ol className="m-0 grid list-none gap-1.5 p-0">
        {rows.map((r, i) => {
          const style = { "--i": i } as CSSProperties;
          if (r.kind === "break")
            return (
              <li key={`b-${i}`} style={style} className="mtb-slide-in flex items-center gap-3 rounded-lg bg-surface-sunken px-3 py-2 text-small text-ink-muted">
                <span className="w-[4.5rem] tabular-nums">{clock(r.start)}</span>
                <Icon name="clock" size={16} /> Break until {clock(r.end)}
              </li>
            );
          if (r.kind === "free")
            return (
              <li key={`f-${r.no}`} style={style} className="mtb-slide-in flex min-h-12 items-center gap-3 rounded-lg border border-dashed border-border px-3 py-2 text-ink-muted">
                <span className="grid w-[4.5rem] shrink-0">
                  <span className="text-small tabular-nums">{clock(r.start)}</span>
                  <span className="text-caption">Period {r.no}</span>
                </span>
                Free period
              </li>
            );
          const p = r.p;
          const phase = isToday ? periodPhase(p.start, p.end) : "later";
          return (
            <li key={`l-${p.period}`} style={style} className={cx("mtb-slide-in flex items-center gap-3 rounded-lg border border-border bg-surface-raised p-3", phase === "now" && "border-brand", phase === "done" && "opacity-80")}>
              <span className="grid w-[4.5rem] shrink-0">
                <span className="text-body-strong tabular-nums text-ink">{clock(p.start)}</span>
                <span className="text-caption text-ink-muted">Period {p.period}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-ink">
                  {p.classSection} · {p.subject}
                  {p.stream && <span className="block text-small font-normal text-ink-muted">{p.stream} group</span>}
                </span>
                <span className="block text-small text-ink-muted">
                  {p.room ? `${p.room} · ` : ""}until {clock(p.end)}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                {p.cover && <StatusBadge status="info">Cover</StatusBadge>}
                {phase === "now" && <StatusBadge status="brand">Now</StatusBadge>}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Six days by the periods of the day. Short subject names on a phone; choose a day to see it in full. */
function WeekGrid({ w, onPick }: { w: TeacherWeek; onPick: (date: string) => void }) {
  // Rows run to the highest period of the week: a class on other bell timings (KC's have up to 14) or a cover there still shows.
  const maxPeriods = Math.max(w.normal.periods.length, w.friday.periods.length, ...w.days.flatMap((d) => d.periods.map((p) => p.period)));
  const short = (s: string) => (s.length > 7 ? `${s.slice(0, 5)}.` : s);
  return (
    <div className="grid gap-2">
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-1 text-center" aria-label={`Week of ${formatDate(w.weekOf)}`}>
          <thead>
            <tr>
              <th scope="col" className="w-10 text-caption font-medium text-ink-muted">
                Period
              </th>
              {w.days.map((d) => (
                <th key={d.date} scope="col" className={cx("text-caption font-medium", d.date === w.today ? "text-brand-ink" : "text-ink-muted")}>
                  <button type="button" onClick={() => onPick(d.date)} className="min-h-10 w-full rounded-md hover:bg-surface-hover">
                    <span className="sm:hidden">{d.dayName.slice(0, 3)}</span>
                    <span className="hidden sm:inline">{d.dayName}</span>
                    <span className="block tabular-nums">{formatDate(d.date).slice(0, 6)}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: maxPeriods }, (_, i) => i + 1).map((no) => (
              <tr key={no}>
                <th scope="row" className="text-caption font-medium text-ink-muted tabular-nums">
                  {no}
                </th>
                {w.days.map((d) => {
                  const p = d.periods.find((x) => x.period === no);
                  const exists = (d.day === 5 ? w.friday : w.normal).periods.some((x) => x.no === no);
                  return (
                    <td key={d.date} className="p-0">
                      {d.closed ? (
                        <span className="grid h-12 place-items-center rounded-md bg-status-holiday-tint text-[11px] text-status-holiday-ink">
                          <span className="sm:hidden">H</span>
                          <span className="hidden sm:inline">Holiday</span>
                        </span>
                      ) : p ? (
                        <button
                          type="button"
                          onClick={() => onPick(d.date)}
                          className={cx("grid h-12 w-full place-content-center rounded-md px-1 leading-tight", p.cover ? "bg-info-tint text-info-ink" : "bg-brand-tint text-brand-ink", d.date === w.today && "ring-1 ring-brand")}
                          aria-label={`${d.dayName} period ${no}: ${p.classSection}${p.stream ? ` ${p.stream} group` : ""} ${p.subject}${p.cover ? ", cover" : ""}`}
                        >
                          <span className="text-[12px] font-semibold">
                            {p.classSection}
                            {p.stream && <span className="font-normal"> · {/\(([^)]+)\)/.exec(p.stream)?.[1] ?? p.stream}</span>}
                          </span>
                          <span className="truncate text-[11px]">
                            <span className="md:hidden">{short(p.subject)}</span>
                            <span className="hidden md:inline">{p.subject}</span>
                          </span>
                        </button>
                      ) : (
                        <span className={cx("grid h-12 place-items-center rounded-md text-[11px]", exists ? "bg-surface-sunken text-ink-subtle" : "text-transparent")}>{exists ? "Free" : "·"}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="m-0 flex flex-wrap gap-x-3 gap-y-1 px-1 text-caption text-ink-muted">
        <span className="inline-flex items-center gap-1">
          <span className="size-2.5 rounded-sm bg-brand-tint ring-1 ring-brand/40" /> Your lesson
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2.5 rounded-sm bg-info-tint" /> Cover
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2.5 rounded-sm bg-surface-sunken" /> Free
        </span>
      </p>
    </div>
  );
}
