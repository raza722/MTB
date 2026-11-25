import { CLASH_LABEL, clockTime, isFriday, periodsInWeek, periodsOn, placedBySubject, reqKey, scheduleOf, streamShort, TIMETABLE_DAYS, type BellDay, type TimetableBoard, type TimetableClash, type TimetableDay, type TimetableSection, type TimetableSlot } from "@mtb/api";
import { Button, cx, Icon, Input, Segmented, Select, StatusBadge, Switch } from "@mtb/ui";
import { Link } from "@tanstack/react-router";
import { useMemo, useState, type CSSProperties } from "react";
import { useCan } from "../../app/session";
import { cellSlots, dayLong, teacherShort, useTodayDay, type BoardIndex } from "./shared";
import type { SlotTarget } from "./SlotEditor";

/*
 * The "One class" view of Class timetables, redesigned 24-Nov-2026 (design: "Class timetable redesign" canvas):
 * a class-then-section picker, a summary of the section, the week with double periods joined and full subject names,
 * a bar for the chosen lesson, the subjects with their teachers, and the section's own checks. Warnings (amber) stay
 * hidden until asked for; clashes (red) always show.
 */

/** "7-B" → "7"; a long section name keeps its class: "ADP Computer Science – Batch 2026" → "ADP Computer Science". */
export const classOf = (cs: string) => (cs.includes(" – ") ? cs.split(" – ")[0]! : cs.split("-")[0]!);
export const classLabel = (k: string) => (/^\d+$/.test(k) ? `Class ${k}` : k);
/** "Normal timings", "Timings 13" — a bell-timings name, with "timings" added only when the name lacks it. */
export const timingsName = (name: string) => (/timings/i.test(name) ? name : `${name} timings`);
/** "a 72-period week", "an 84-period week", "an 11-period week". */
export const aPeriodWeek = (n: number) => `${/^8/.test(String(n)) || n === 11 || n === 18 ? "an" : "a"} ${n}-period week`;

/** "Asma Rauf" → "A. Rauf": a name that fits a one-period cell. */
export const teacherInitialName = (name: string) => {
  const parts = teacherShort(name).trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]!.charAt(0)}. ${parts.slice(1).join(" ")}` : (parts[0] ?? "");
};

export interface SectionState {
  need: number;
  have: number;
  short: number;
  clashes: number;
}

/** Days of a section's bell timings (its own when it has them). */
function daysOf(board: TimetableBoard, cs: string): { normal: BellDay; friday: BellDay } {
  const sc = scheduleOf(board, cs);
  return board.days?.[sc.id] ?? { normal: board.normal, friday: board.friday };
}

/* ------------------------------------------------------------------ Section picker */

export function SectionPicker({
  board,
  current,
  statusOf,
  onPick,
}: {
  board: TimetableBoard;
  current: string;
  statusOf: (s: TimetableSection) => SectionState;
  onPick: (classSection: string) => void;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "work">("all");
  const classes = useMemo(() => [...new Set(board.sections.map((s) => classOf(s.classSection)))], [board.sections]);
  const klass = classOf(current);
  const needle = q.trim().toLowerCase();
  // Typing searches every class; otherwise the chosen class's sections.
  const scope = needle ? board.sections.filter((s) => s.classSection.toLowerCase().includes(needle)) : board.sections.filter((s) => classOf(s.classSection) === klass);
  const rows = scope.map((s) => ({ s, x: statusOf(s) }));
  const work = rows.filter((r) => r.x.short > 0 || r.x.clashes > 0);
  const shown = filter === "work" ? work : rows;
  return (
    <div className="mtb-card tt-picker p-0">
      <div className="tt-picker-head">
        <Select
          label="Class"
          value={klass}
          onChange={(e) => {
            const first = board.sections.find((s) => classOf(s.classSection) === e.target.value);
            if (first) onPick(first.classSection);
          }}
          options={classes.map((c) => ({ value: c, label: classLabel(c) }))}
        />
        <Input label="Find a section" type="search" icon="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Any class" />
        <Segmented
          aria-label="Sections to show"
          className="tt-picker-seg"
          value={filter}
          onChange={(v) => setFilter(v as "all" | "work")}
          options={[
            { value: "all", label: `All · ${rows.length}` },
            { value: "work", label: `Needs work · ${work.length}` },
          ]}
        />
      </div>
      {shown.length === 0 ? (
        <p className="tt-picker-empty">{needle ? "No section matches. Check the spelling or clear the search." : "Every section here has all its periods and no clashes."}</p>
      ) : (
        <ul className="tt-sections" aria-label={needle ? "Sections found" : `${classLabel(klass)} sections`}>
          {shown.map(({ s, x }) => (
            <li key={s.classSection}>
              <button type="button" aria-current={s.classSection === current} title={`${x.have} of ${x.need} periods${s.streams.length ? ` · ${s.streams.length} groups` : ""}`} onClick={() => onPick(s.classSection)}>
                <span className="min-w-0">
                  <span className="tt-picker-name">{s.classSection}</span>
                  <small>
                    {x.have} of {x.need} periods
                    {s.streams.length ? ` · ${s.streams.length} groups` : ""}
                  </small>
                </span>
                {x.clashes > 0 ? (
                  <StatusBadge status="danger">{x.clashes === 1 ? "1 clash" : `${x.clashes} clashes`}</StatusBadge>
                ) : x.short > 0 ? (
                  <StatusBadge status="warning">{x.short} to place</StatusBadge>
                ) : (
                  <Icon name="checkCircle" size={18} className="flex-none text-success" label="All periods placed" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Summary */

/** May open Setup › Teacher allotment, where the class teacher is set. */
function useCanSetup() {
  const all = useCan("setup.manage");
  const campus = useCan("setup.campus");
  return all || campus;
}

export function SectionSummary({ board, idx, section, st }: { board: TimetableBoard; idx: BoardIndex; section: TimetableSection; st: SectionState }) {
  const canSetup = useCanSetup();
  const sc = scheduleOf(board, section.classSection);
  const days = daysOf(board, section.classSection);
  const ct = idx.teacher(section.classTeacherId);
  const week = periodsInWeek(sc);
  const used = new Set(board.slots.filter((s) => s.classSection === section.classSection).map((s) => `${s.day}|${s.period}`)).size;
  const pct = Math.min(100, Math.round((st.have / Math.max(1, st.need)) * 100));
  return (
    <section className="mtb-card tt-summary" aria-labelledby="tt-summary-title">
      <div className="tt-summary-top">
        <h2 id="tt-summary-title">{section.classSection}</h2>
        {st.clashes > 0 ? (
          <StatusBadge status="danger">{st.clashes === 1 ? "1 clash to fix" : `${st.clashes} clashes to fix`}</StatusBadge>
        ) : st.short > 0 ? (
          <StatusBadge status="warning">{st.short === 1 ? "1 period to place" : `${st.short} periods to place`}</StatusBadge>
        ) : (
          <StatusBadge status="success">All {st.need} periods placed</StatusBadge>
        )}
      </div>
      <dl className="tt-facts">
        <div>
          <dt>Class teacher</dt>
          <dd>
            {ct ? (
              <span className="font-medium">{ct.name}</span>
            ) : (
              <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="inline-flex items-center gap-1 font-medium text-warning-ink">
                  <Icon name="alert" size={16} />
                  Not set
                </span>
                {canSetup && (
                  <Link to="/setup/teachers" className="tt-fact-link">
                    Set class teacher
                  </Link>
                )}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>Students</dt>
          <dd className="mtb-num font-medium">{section.strength}</dd>
        </div>
        {section.room && (
          <div>
            <dt>Room</dt>
            <dd className="font-medium">{section.room}</dd>
          </div>
        )}
        <div>
          <dt>Bell timings</dt>
          <dd>
            <span className="font-medium">{timingsName(sc.name)}</span>
            <span className="text-ink-muted"> · Friday closes {clockTime(days.friday.offTime)}</span>
          </dd>
        </div>
        <div>
          <dt>Periods placed</dt>
          <dd className="tt-fact-meter">
            <span className="mtb-num font-medium">
              {st.have} of {st.need}
            </span>
            <span className={cx("mtb-meter", st.clashes > 0 ? "tone-danger" : st.short > 0 && "tone-warning")} role="img" aria-label={`${st.have} of ${st.need} periods placed`}>
              <span style={{ width: `${pct}%` }} />
            </span>
          </dd>
          <dd className="text-small text-ink-muted">
            {week - used} free in {aPeriodWeek(week)}
          </dd>
        </div>
        {section.streams.length > 0 && (
          <div>
            <dt>Groups</dt>
            <dd className="font-medium">{section.streams.join(", ")}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

/* ------------------------------------------------------------------ Week */

interface WeekCell {
  key: string;
  day: TimetableDay;
  /** First period of the run. */
  period: number;
  /** Periods joined: a double period is 2. */
  len: number;
  /** The group of a split period; null for the whole class. */
  stream: string | null;
  row: number;
  rowSpan: number;
  kind: "lesson" | "free" | "closed";
  /** One lesson per period of the run. */
  slots: TimetableSlot[];
}

interface Piece {
  lane: string | null;
  slot: TimetableSlot | null;
  closed?: boolean;
}

const sameLesson = (a: TimetableSlot, b: TimetableSlot) => a.subjectId === b.subjectId && a.teacherId === b.teacherId && a.room === b.room;

/** The section's week as runs: the same lesson in periods next to each other (not across the break) is one cell. */
function buildWeek(board: TimetableBoard, section: TimetableSection, max: number, breakAfter: number, join: boolean): Map<TimetableDay, WeekCell[]> {
  const cs = section.classSection;
  const sc = scheduleOf(board, cs);
  const groups = section.streams;
  const rows = groups.length || 1;
  const halves: Array<[number, number]> = breakAfter ? [[1, breakAfter], [breakAfter + 1, max]] : [[1, max]];
  const out = new Map<TimetableDay, WeekCell[]>();
  for (const { day } of TIMETABLE_DAYS) {
    const pieces = new Map<number, Piece[]>();
    for (let p = 1; p <= max; p++) {
      if (p > periodsOn(sc, day)) {
        pieces.set(p, [{ lane: null, slot: null, closed: true }]);
        continue;
      }
      const list = cellSlots(board, cs, day, p);
      pieces.set(p, groups.length && list.some((s) => s.stream) ? groups.map((g) => ({ lane: g, slot: list.find((s) => s.stream === g) ?? null })) : [{ lane: null, slot: list.find((s) => !s.stream) ?? null }]);
    }
    const cells: WeekCell[] = [];
    for (const [a, b] of halves) {
      for (const lane of [null, ...groups]) {
        let p = a;
        while (p <= b) {
          const piece = pieces.get(p)!.find((x) => x.lane === lane);
          if (!piece) {
            p++;
            continue;
          }
          const slots = piece.slot ? [piece.slot] : [];
          let len = 1;
          while (p + len <= b) {
            const next = pieces.get(p + len)!.find((x) => x.lane === lane);
            if (!next) break;
            if (piece.closed && next.closed) len++;
            else if (join && piece.slot && next.slot && sameLesson(piece.slot, next.slot)) {
              slots.push(next.slot);
              len++;
            } else break;
          }
          cells.push({
            key: `${day}-${p}-${lane ?? ""}`,
            day,
            period: p,
            len,
            stream: lane,
            row: lane ? groups.indexOf(lane) + 1 : 1,
            rowSpan: lane ? 1 : rows,
            kind: piece.closed ? "closed" : piece.slot ? "lesson" : "free",
            slots,
          });
          p += len;
        }
      }
    }
    out.set(day, cells);
  }
  return out;
}

type Severity = "BLOCK" | "WARN" | undefined;
/** Red for a clash; amber for a warning about this lesson (a teacher's weekly total is not one lesson's fault). */
const severityOf = (clashes: TimetableClash[]): Severity => (clashes.some((c) => c.severity === "BLOCK") ? "BLOCK" : clashes.some((c) => c.kind !== "TEACHER_OVER_WEEK") ? "WARN" : undefined);

export function ClassWeek({ board, idx, section, canEdit, onEdit }: { board: TimetableBoard; idx: BoardIndex; section: TimetableSection; canEdit: boolean; onEdit: (t: SlotTarget) => void }) {
  const todayDay = useTodayDay();
  const [sel, setSel] = useState<{ day: TimetableDay; period: number; stream: string | null } | null>(null);
  const [showWarnings, setShowWarnings] = useState(false);
  const cs = section.classSection;
  const sc = scheduleOf(board, cs);
  const days = daysOf(board, cs);
  const max = Math.max(sc.normal.periods, sc.friday.periods);
  const breakAfter = sc.normal.breakAfter > 0 && sc.normal.breakAfter < max ? sc.normal.breakAfter : 0;
  const groups = section.streams;
  const rows = groups.length || 1;
  const week = useMemo(() => buildWeek(board, section, max, breakAfter, true), [board, section, max, breakAfter]);

  const lead = groups.length ? 3 : 2;
  const colOf = (p: number) => lead + (p - 1) + (breakAfter && p > breakAfter ? 1 : 0);
  // 12 periods fit in about 930px: the week scrolls sideways only on a narrower screen.
  const template = `104px ${groups.length ? "64px " : ""}${breakAfter ? `repeat(${breakAfter}, minmax(60px, 1fr)) 24px repeat(${max - breakAfter}, minmax(60px, 1fr))` : `repeat(${max}, minmax(60px, 1fr))`}`;
  const minWidth = 104 + (groups.length ? 70 : 0) + (breakAfter ? 30 : 0) + max * 66;
  const planOf = (day: TimetableDay) => (isFriday(day) ? days.friday : days.normal);
  const timesOf = (c: Pick<WeekCell, "day" | "period" | "len">) => {
    const plan = planOf(c.day);
    return { start: plan.periods.find((x) => x.no === c.period)?.start, end: plan.periods.find((x) => x.no === c.period + c.len - 1)?.end };
  };

  const ownSlots = board.slots.filter((s) => s.classSection === cs);
  const warnCount = ownSlots.filter((s) => severityOf(idx.clashOf(s.id)) === "WARN").length;

  const picked = sel ? (week.get(sel.day) ?? []).find((c) => c.kind !== "closed" && c.stream === sel.stream && sel.period >= c.period && sel.period < c.period + c.len) : undefined;
  const target = (c: WeekCell, period = c.period): SlotTarget => ({ section, day: c.day, period, stream: c.stream });

  const describe = (c: WeekCell) => {
    const { start, end } = timesOf(c);
    const when = c.len > 1 ? `periods ${c.period} to ${c.period + c.len - 1}` : `period ${c.period}`;
    const who = c.stream ? ` (${c.stream})` : "";
    const at = start && end ? `, ${clockTime(start)} to ${clockTime(end)}` : "";
    if (c.kind === "free") return `${dayLong(c.day)}, ${when}${who}${at}: free${canEdit ? ". Choose to add a lesson." : ""}`;
    const first = c.slots[0]!;
    const clashes = [...new Set(c.slots.flatMap((s) => idx.clashOf(s.id)).map((x) => x.message))];
    return `${dayLong(c.day)}, ${when}${who}${at}: ${idx.subject(first.subjectId).name} with ${idx.teacher(first.teacherId)?.name ?? "no teacher"}${first.room && first.room !== section.room ? ` in ${first.room}` : ""}${clashes.length ? `. ${clashes.join(" ")}` : ""}`;
  };

  return (
    <section className="mtb-card tt-week" aria-labelledby="tt-week-title">
      <div className="tt-week-head">
        <div className="grid gap-0.5">
          <h3 id="tt-week-title">Week</h3>
          <p className="text-small text-ink-muted">
            Monday to Saturday, {max} periods a day. Each Friday lesson shows its own time.
            {groups.length ? " On a split period each group has its own row." : ""}
            {canEdit ? " Choose a lesson to see it and change it." : " Choose a lesson to see it."}
          </p>
        </div>
        {warnCount > 0 && (
          <span className="tt-warn-switch">
            <Switch label="Show warnings" checked={showWarnings} onChange={(e) => setShowWarnings(e.target.checked)} />
            <StatusBadge status="warning" dot={false} title={`${warnCount} ${warnCount === 1 ? "period has" : "periods have"} a warning`}>
              {warnCount}
            </StatusBadge>
          </span>
        )}
      </div>

      <PickedBar idx={idx} section={section} cell={picked} times={picked ? timesOf(picked) : undefined} canEdit={canEdit} onEdit={(p) => picked && onEdit(target(picked, p))} />

      <div className="tt-week-scroll">
        <div className="tt-week-grid" style={{ minWidth }}>
          <div className="tt-week-row tt-week-headrow" style={{ gridTemplateColumns: template }}>
            <span className="tt-week-cap" style={{ gridColumn: 1 }}>
              Day
            </span>
            {groups.length > 0 && (
              <span className="tt-week-cap" style={{ gridColumn: 2 }}>
                Group
              </span>
            )}
            {Array.from({ length: max }, (_, i) => i + 1).map((p) => {
              const t = days.normal.periods.find((x) => x.no === p);
              return (
                <span key={p} className="tt-week-period" style={{ gridColumn: colOf(p) }}>
                  <span className="tt-week-cap">Period</span>
                  <b>{p}</b>
                  <span className="mtb-num">{t ? clockTime(t.start) : "—"}</span>
                </span>
              );
            })}
            {breakAfter > 0 && (
              <span className="tt-week-break is-head" style={{ gridColumn: lead + breakAfter }} title={days.normal.breakStart && days.normal.breakEnd ? `Break ${clockTime(days.normal.breakStart)} to ${clockTime(days.normal.breakEnd)}` : "Break"}>
                <span>Break</span>
              </span>
            )}
          </div>

          {TIMETABLE_DAYS.map(({ day }) => {
            const today = day === todayDay;
            return (
              <div key={day} className="tt-week-row" style={{ gridTemplateColumns: template, gridTemplateRows: `repeat(${rows}, minmax(60px, auto))` }}>
                <div className={cx("tt-week-day", today && "is-today")} style={{ gridColumn: 1, gridRow: `1 / span ${rows}` }}>
                  <b>{dayLong(day)}</b>
                  {today && <span className="tt-week-today">Today</span>}
                  {isFriday(day) && <span className="text-small text-ink-muted">Closes {clockTime(days.friday.offTime)}</span>}
                </div>
                {groups.map((g, gi) => (
                  <span key={g} className="tt-week-group" style={{ gridColumn: 2, gridRow: gi + 1 }} title={g}>
                    {streamShort(g)}
                  </span>
                ))}
                {breakAfter > 0 && <span className="tt-week-break" aria-hidden="true" style={{ gridColumn: lead + breakAfter, gridRow: `1 / span ${rows}` }} />}
                {(week.get(day) ?? []).map((c) => {
                  // Runs never cross the break, so a run's columns are side by side.
                  const place: CSSProperties = { gridColumn: `${colOf(c.period)} / span ${c.len}`, gridRow: `${c.row} / span ${c.rowSpan}` };
                  if (c.kind === "closed")
                    return (
                      <span key={c.key} className="tt-wk is-closed" style={place} aria-label={`${dayLong(day)}: no period`}>
                        —
                      </span>
                    );
                  const first = c.slots[0];
                  const subj = first ? idx.subject(first.subjectId) : null;
                  const teacher = first ? (idx.teacher(first.teacherId)?.name ?? "No teacher") : "";
                  const sev = severityOf(c.slots.flatMap((s) => idx.clashOf(s.id)));
                  const flag = sev === "BLOCK" ? "BLOCK" : sev === "WARN" && showWarnings ? "WARN" : undefined;
                  const isPicked = picked?.key === c.key;
                  // A double period has room for the whole name; a single one shows the code until it is wide enough.
                  // ("Drawing" was cut to "Draw…" in a 68px cell, so only names of five letters or fewer always show.)
                  const fullName = !subj || c.len > 1 || subj.name.length <= 5 || subj.name === subj.short;
                  const { start, end } = timesOf(c);
                  const select = () => {
                    setSel({ day: c.day, period: c.period, stream: c.stream });
                    if (c.kind === "free" && canEdit) onEdit(target(c));
                  };
                  return (
                    <button
                      key={c.key}
                      type="button"
                      className={cx("tt-wk", subj ? `tt-c${subj.tint}` : "is-free", !fullName && "has-code", flag === "BLOCK" && "is-clash", flag === "WARN" && "is-warn")}
                      style={place}
                      aria-pressed={isPicked}
                      aria-label={describe(c)}
                      title={subj ? `${subj.name} · ${teacher}` : undefined}
                      onClick={select}
                      onDoubleClick={canEdit && c.kind === "lesson" ? () => onEdit(target(c)) : undefined}
                    >
                      {isFriday(day) && start && end && (
                        <span className="tt-wk-time mtb-num">
                          {/* A one-period cell has room for the start only; a double shows from–to. */}
                          {c.len > 1 ? `${clockTime(start).slice(0, 5)}–${clockTime(end).slice(0, 5)}` : clockTime(start).slice(0, 5)}
                        </span>
                      )}
                      {subj ? (
                        <>
                          {fullName ? (
                            <b>{subj.name}</b>
                          ) : (
                            <>
                              <b className="tt-wk-code">{subj.short}</b>
                              <b className="tt-wk-long">{subj.name}</b>
                            </>
                          )}
                          <span>{c.len > 1 ? teacherShort(teacher) : teacherInitialName(teacher)}</span>
                          {first!.room && first!.room !== section.room && <span>{first!.room}</span>}
                        </>
                      ) : (
                        <span className="tt-wk-free">
                          {canEdit && <Icon name="plus" size={14} />}
                          Free
                        </span>
                      )}
                      {flag && <Icon name={flag === "BLOCK" ? "alertCircle" : "alert"} size={14} className="tt-wk-flag" />}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function PickedBar({
  idx,
  section,
  cell,
  times,
  canEdit,
  onEdit,
}: {
  idx: BoardIndex;
  section: TimetableSection;
  cell: WeekCell | undefined;
  times: { start?: string | undefined; end?: string | undefined } | undefined;
  canEdit: boolean;
  onEdit: (period: number) => void;
}) {
  if (!cell) {
    return (
      <div className="tt-pick is-empty" aria-live="polite">
        <Icon name="info" size={18} className="flex-none text-ink-muted" />
        <span className="text-small text-ink-muted">{canEdit ? "Choose a lesson to see who teaches it and any warning on it, then change it. A free period opens straight away." : "Choose a lesson to see who teaches it and any warning on it."}</span>
      </div>
    );
  }
  const first = cell.slots[0];
  const subj = first ? idx.subject(first.subjectId) : null;
  const teacher = first ? (idx.teacher(first.teacherId)?.name ?? "No teacher") : "";
  const clashes = cell.slots.flatMap((s) => idx.clashOf(s.id));
  const issues = [...new Map(clashes.map((c) => [c.message, c])).values()].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "BLOCK" ? -1 : 1));
  const periods = Array.from({ length: cell.len }, (_, i) => cell.period + i);
  const head = `${dayLong(cell.day)} · ${cell.len > 1 ? `Periods ${cell.period}–${cell.period + cell.len - 1}` : `Period ${cell.period}`}${cell.stream ? ` · ${streamShort(cell.stream)} group` : ""}`;
  return (
    <div className="tt-pick" aria-live="polite">
      <div className="tt-pick-item">
        <span className="tt-week-cap">{head}</span>
        <b className="mtb-num">{times?.start && times.end ? `${clockTime(times.start)} – ${clockTime(times.end)}` : "—"}</b>
      </div>
      <div className="tt-pick-item">
        <span className="tt-week-cap">Lesson</span>
        <b>{subj ? `${subj.name} · ${teacher}` : "Free period"}</b>
        {first?.room && first.room !== section.room && <span className="text-small text-ink-muted">In {first.room}</span>}
      </div>
      {issues.length > 0 && (
        <ul className="tt-pick-issues">
          {issues.slice(0, 3).map((c) => (
            <li key={c.message} className={c.severity === "BLOCK" ? "text-danger-ink" : "text-warning-ink"}>
              <Icon name={c.severity === "BLOCK" ? "alertCircle" : "alert"} size={16} className="flex-none" />
              <span>
                <b>{CLASH_LABEL[c.kind]}.</b> {c.message}
              </span>
            </li>
          ))}
          {issues.length > 3 && <li className="text-small text-ink-muted">…and {issues.length - 3} more below.</li>}
        </ul>
      )}
      {canEdit && (
        <div className="tt-pick-actions">
          {subj ? (
            periods.map((p) => (
              <Button key={p} variant={p === cell.period ? "primary" : "secondary"} icon="edit" onClick={() => onEdit(p)}>
                {cell.len > 1 ? `Change period ${p}` : "Change lesson"}
              </Button>
            ))
          ) : (
            <Button variant="primary" icon="plus" onClick={() => onEdit(cell.period)}>
              Add a lesson
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Subjects and checks */

export function SubjectsTable({ board, idx, section }: { board: TimetableBoard; idx: BoardIndex; section: TimetableSection }) {
  const placed = placedBySubject(board, section.classSection);
  return (
    <section className="mtb-card tt-side-card" aria-labelledby="tt-subjects-title">
      <div className="grid gap-0.5">
        <h3 id="tt-subjects-title">Subjects and teachers</h3>
        <p className="text-small text-ink-muted">Periods this week against the class's subjects in Setup. The colours match the week above.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="tt-subjects">
          <thead>
            <tr>
              <th scope="col">Subject</th>
              <th scope="col">Teacher</th>
              <th scope="col" className="text-right">
                Periods a week
              </th>
            </tr>
          </thead>
          <tbody>
            {section.requirements.map((r) => {
              const subj = idx.subject(r.subjectId);
              const n = placed.get(reqKey(r.subjectId, r.stream)) ?? 0;
              const tone = n > r.periodsPerWeek ? "danger" : n < r.periodsPerWeek ? "warning" : "success";
              const teacher = idx.teacher(r.teacherId)?.name;
              return (
                <tr key={reqKey(r.subjectId, r.stream)}>
                  <td>
                    <span className="flex items-center gap-2.5">
                      <span className={cx("tt-swatch", `tt-c${subj.tint}`)} aria-hidden="true" />
                      <span className="min-w-0">
                        <span className="font-medium">{subj.name}</span>
                        {r.stream && <span className="block text-small text-ink-muted">{r.stream} group</span>}
                      </span>
                    </span>
                  </td>
                  <td>{teacher ?? <span className="text-ink-muted">No teacher allotted in Setup</span>}</td>
                  <td>
                    <span className="flex items-center justify-end gap-2.5">
                      <span className={cx("mtb-meter tt-subject-meter", tone === "danger" ? "tone-danger" : tone === "warning" && "tone-warning")} role="img" aria-label={`${n} of ${r.periodsPerWeek} periods`}>
                        <span style={{ width: `${Math.min(100, (n / Math.max(1, r.periodsPerWeek)) * 100)}%` }} />
                      </span>
                      <span className={cx("mtb-num min-w-[52px] text-right font-medium", tone === "danger" ? "text-danger-ink" : tone === "warning" ? "text-warning-ink" : "text-success-ink")}>
                        {n} / {r.periodsPerWeek}
                      </span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function SectionChecks({ board, idx, section, onOpen }: { board: TimetableBoard; idx: BoardIndex; section: TimetableSection; onOpen: (c: TimetableClash) => void }) {
  const canSetup = useCanSetup();
  const ids = new Set(board.slots.filter((s) => s.classSection === section.classSection).map((s) => s.id));
  const mine = idx.clashes.filter((c) => c.slotIds.some((id) => ids.has(id)));
  const block = mine.filter((c) => c.severity === "BLOCK");
  const warn = mine.filter((c) => c.severity === "WARN");
  const kinds = [...new Set(warn.map((c) => c.kind))];
  const noTeacher = !idx.teacher(section.classTeacherId);
  return (
    <section className="mtb-card tt-side-card" aria-labelledby="tt-checks-title">
      <div className="grid gap-0.5">
        <h3 id="tt-checks-title">Checks for this section</h3>
        <p className="text-small text-ink-muted">Run across the campus each time a period is saved.</p>
      </div>
      <ul className="tt-list">
        {block.length === 0 ? (
          <li>
            <Icon name="checkCircle" size={20} className="flex-none text-success" />
            <span className="grid min-w-0">
              <b>No clashes</b>
              <span className="text-small text-ink-muted">No teacher or room of this section is booked twice.</span>
            </span>
          </li>
        ) : (
          block.map((c, i) => (
            <li key={`b${i}`}>
              <Icon name="alertCircle" size={20} className="flex-none text-danger-ink" />
              <button type="button" className="tt-link grid min-w-0" onClick={() => onOpen(c)}>
                <b>{CLASH_LABEL[c.kind]}</b>
                <span className="text-small text-ink-muted">{c.message}</span>
              </button>
              <StatusBadge status="danger" className="ml-auto">
                Fix
              </StatusBadge>
            </li>
          ))
        )}
        {kinds.map((k) => {
          const list = warn.filter((c) => c.kind === k);
          return (
            <li key={k}>
              <Icon name="alert" size={20} className="flex-none text-warning-ink" />
              <span className="grid min-w-0 gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <b>{CLASH_LABEL[k]}</b>
                  <StatusBadge status="warning" dot={false}>
                    {list.length}
                  </StatusBadge>
                </span>
                <span className="text-small text-ink-muted">
                  {list
                    .slice(0, 2)
                    .map((c) => c.message)
                    .join(" ")}
                  {list.length > 2 ? ` …and ${list.length - 2} more.` : ""}
                </span>
              </span>
            </li>
          );
        })}
        {noTeacher && (
          <li>
            <Icon name="alert" size={20} className="flex-none text-warning-ink" />
            <span className="grid min-w-0 gap-0.5">
              <b>No class teacher</b>
              <span className="text-small text-ink-muted">This section has no class teacher yet.</span>
              {canSetup && (
                <Link to="/setup/teachers" className="tt-fact-link text-small">
                  Set class teacher
                </Link>
              )}
            </span>
          </li>
        )}
      </ul>
    </section>
  );
}
