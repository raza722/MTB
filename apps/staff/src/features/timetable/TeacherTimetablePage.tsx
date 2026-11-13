import { ApiError, countLessons, clockTime, periodsInWeek, periodTime, scheduleOf, timetableApi, timetableQueries, TIMETABLE_DAYS, toMinutes, type CampusCode, type TimetableBoard, type TimetableClashDetails, type TimetableDay, type TimetableSlot, type TimetableTeacher } from "@mtb/api";
import { formatCount } from "@mtb/domain";
import { AnimatedNumber, Banner, Button, Checkbox, Combobox, EmptyState, Modal, Panel, Segmented, Select, Skeleton, StatCard, Switch, Textarea, useToast } from "@mtb/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type CSSProperties } from "react";
import { RequireSingleCampus } from "../../app/shell/page";
import { useCan, useCtx } from "../../app/session";
import {
  boardLevels,
  collapseDays,
  dayLong,
  dayShort,
  errorText,
  filterTeachers,
  lessonClass,
  LessonCell,
  PrintArea,
  PrintHead,
  PrintMatrix,
  PrintTimetable,
  printSoon,
  QueryError,
  StaffFilters,
  teacherShort,
  TimetableGrid,
  TimetableShell,
  useBoard,
  useBoardIndex,
  useCanEdit,
  useToday,
  weekdayOfDate,
  type BoardIndex,
  type StaffFilter,
} from "./shared";
import { TeacherTextsDialog } from "./TeacherTextsDialog";

export interface TeacherTimetableSearch {
  teacher?: string;
  view?: "teacher" | "day" | "week";
  day?: number;
  /** Class level id for the all-teachers views and slips. */
  level?: string;
  gender?: "F" | "M";
}

/** Do two lessons overlap in clock time (each class on its own bell timings)? */
function sameTime(board: TimetableBoard, a: Pick<TimetableSlot, "classSection" | "day" | "period">, b: Pick<TimetableSlot, "classSection" | "day" | "period">) {
  if (a.day !== b.day) return false;
  const x = periodTime(board, a.classSection, a.day, a.period);
  const y = periodTime(board, b.classSection, b.day, b.period);
  if (!x || !y) return a.period === b.period;
  return toMinutes(x.start) < toMinutes(y.end) && toMinutes(y.start) < toMinutes(x.end);
}

/** Start time shown beside a lesson whose class runs on other bell timings than the main ones. */
const ownTime = (board: TimetableBoard, s: TimetableSlot) => (scheduleOf(board, s.classSection).main ? undefined : periodTime(board, s.classSection, s.day, s.period)?.start);

/** Master-sheet cells for one teacher: "7-B: Maths: Mon–Sat" per period. */
function teacherWeekCells(board: TimetableBoard, idx: BoardIndex, teacherId: string, periods: number): string[] {
  return Array.from({ length: periods }, (_, k) => {
    const groups = new Map<string, TimetableDay[]>();
    for (const s of board.slots.filter((x) => x.teacherId === teacherId && x.period === k + 1)) {
      const key = `${lessonClass(s)}: ${idx.subject(s.subjectId).short}`;
      groups.set(key, [...(groups.get(key) ?? []), s.day]);
    }
    return [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([key, days]) => `${key}: ${collapseDays(days)}`)
      .join("\n");
  });
}

/** Day-sheet cells for one teacher: "Maths – 7-B" per period (with the class's own time when it runs on other timings). */
function teacherDayCells(board: TimetableBoard, idx: BoardIndex, teacherId: string, day: TimetableDay, periods: number): string[] {
  return Array.from({ length: periods }, (_, k) =>
    board.slots
      .filter((s) => s.teacherId === teacherId && s.day === day && s.period === k + 1)
      .map((s) => {
        const at = ownTime(board, s);
        return `${idx.subject(s.subjectId).short} – ${lessonClass(s)}${at ? ` (${clockTime(at).slice(0, 5)})` : ""}`;
      })
      .join("\n"),
  );
}

function HandOver({ board, idx, fromId, onClose }: { board: TimetableBoard; idx: BoardIndex; fromId: string; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const from = idx.teacher(fromId)!;
  const mine = board.slots.filter((s) => s.teacherId === fromId).sort((a, b) => a.day - b.day || a.period - b.period);
  const [picked, setPicked] = useState<Set<string>>(new Set(mine.map((s) => s.id)));
  const [to, setTo] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState("");
  const [needOverride, setNeedOverride] = useState(false);
  const busyAt = (tid: string, m: TimetableSlot) => board.slots.find((s) => s.teacherId === tid && sameTime(board, s, m));
  const conflicts = to ? mine.filter((s) => picked.has(s.id) && busyAt(to, s)) : [];
  const options = board.teachers
    .filter((t) => t.id !== fromId)
    .map((t) => {
      const c = mine.filter((s) => picked.has(s.id) && busyAt(t.id, s)).length;
      const load = countLessons(board.slots.filter((s) => s.teacherId === t.id));
      return { t, c, load, hint: c ? `${c} clash${c === 1 ? "" : "es"}` : `${load} a week now` };
    })
    .sort((a, b) => a.c - b.c || a.load - b.load)
    .map((x) => ({ value: x.t.id, label: x.t.name, hint: x.hint }));
  const save = useMutation({
    mutationFn: () =>
      timetableApi.handOver({ campus: ctx.campus as CampusCode, session: ctx.session, fromTeacherId: fromId, toTeacherId: to!, slotIds: [...picked], reason: reason.trim(), ...(needOverride && override.trim() ? { overrideReason: override.trim() } : {}) }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: timetableQueries.board(ctx).queryKey });
      toast({ title: `${r.moved} ${r.moved === 1 ? "period" : "periods"} handed over`, message: `${from.name}'s periods now go to ${idx.teacher(to)?.name}. Both teachers' timetables are updated.` });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "TIMETABLE_CLASH" && (e.details as TimetableClashDetails | undefined)?.clashes?.length) setNeedOverride(true);
    },
  });
  const toggle = (id: string) => setPicked((p) => (p.has(id) ? new Set([...p].filter((x) => x !== id)) : new Set([...p, id])));
  return (
    <Modal
      open
      size="lg"
      onClose={() => !save.isPending && onClose()}
      title={`Hand over ${from.name}'s periods`}
      description="For a teacher who leaves or changes classes. This changes the timetable from now on; for one day, use Cover instead."
      footer={
        <>
          <Button variant="quiet" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button variant="primary" icon="merge" loading={save.isPending} loadingLabel="Handing over…" disabled={!to || picked.size === 0 || reason.trim().length < 5 || (needOverride && override.trim().length < 5)} onClick={() => save.mutate()}>
            Hand over {picked.size} {picked.size === 1 ? "period" : "periods"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Combobox label="Give the periods to" required value={to} onValueChange={(v) => { setTo(v); setNeedOverride(false); }} options={options} placeholder="Choose a teacher" />
        {to && conflicts.length > 0 && (
          <Banner tone="warning" title={`${idx.teacher(to)?.name} is busy in ${conflicts.length} of these periods.`}>
            Untick them below, or keep them with a reason (a combined class).
          </Banner>
        )}
        <div className="tt-matrix-wrap" style={{ maxHeight: 280 }}>
          <table className="tt-matrix">
            <thead>
              <tr>
                <th className="tt-sticky">
                  <Checkbox aria-label="All periods" checked={picked.size === mine.length} indeterminate={picked.size > 0 && picked.size < mine.length} onChange={(e) => setPicked(new Set(e.target.checked ? mine.map((s) => s.id) : []))} />
                </th>
                <th>Day</th>
                <th>Period</th>
                <th>Class</th>
                <th>Subject</th>
                <th>New teacher then</th>
              </tr>
            </thead>
            <tbody>
              {mine.map((s, i) => {
                const busy = to ? busyAt(to, s) : undefined;
                return (
                  <tr key={s.id} style={{ "--i": i } as CSSProperties}>
                    <td className="tt-sticky">
                      <Checkbox aria-label={`${dayLong(s.day)} period ${s.period}, ${s.classSection}`} checked={picked.has(s.id)} onChange={() => toggle(s.id)} />
                    </td>
                    <td>{dayShort(s.day)}</td>
                    <td>{s.period}</td>
                    <td>{lessonClass(s)}</td>
                    <td>{idx.subject(s.subjectId).name}</td>
                    <td className={busy && picked.has(s.id) ? "over" : to ? "ok" : "none"}>{!to ? "—" : busy ? `Busy: ${lessonClass(busy)}` : "Free"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Textarea label="Reason" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} help="Kept in the timetable's history, for example “Ms Sana Tariq moved to the junior section”." />
        {needOverride && <Textarea label="Reason to keep the clashes" required rows={2} value={override} onChange={(e) => setOverride(e.target.value)} />}
        {save.isError && (
          <Banner tone="danger" title="Not handed over.">
            {errorText(save.error)}
          </Banner>
        )}
      </div>
    </Modal>
  );
}

function MatrixSheet({ caption, rows, columns }: { caption: string; rows: Array<{ t: TimetableTeacher; cells: string[]; total: number; over?: boolean; clash?: (k: number) => boolean }>; columns: Array<{ no: number; time?: string }> }) {
  return (
    <div className="tt-matrix-wrap">
      <table className="tt-matrix">
        <caption className="mtb-sr-only">{caption}</caption>
        <thead>
          <tr>
            <th className="tt-sticky">Teacher</th>
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
            <th>Periods</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.t.id} style={{ "--i": i } as CSSProperties}>
              <th className="tt-sticky">{r.t.name}</th>
              {r.cells.map((c, k) => (
                <td key={k} className={r.clash?.(k) ? "over tt-wrap" : c ? "tt-wrap" : "none"}>
                  {c ? c.split("\n").map((line, j) => <span key={j}>{line}</span>) : "·"}
                </td>
              ))}
              <td className={r.over ? "over" : undefined}>{r.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Every teacher's week (the old teacher report that printed empty), day and master sheets for all teachers, and hand-over. */
export function TeacherTimetablePage({ search, setSearch }: { search: TeacherTimetableSearch; setSearch: (s: TeacherTimetableSearch) => void }) {
  const q = useBoard();
  const board = q.data;
  const idx = useBoardIndex(board);
  const canEdit = useCanEdit() && !!board && !board.readOnly;
  const canText = useCan("sms.send") && !!board && !board.readOnly;
  const [handOver, setHandOver] = useState(false);
  const [texting, setTexting] = useState(false);
  const [printWhat, setPrintWhat] = useState<"view" | "slips">("view");
  const [compact, setCompact] = useState(false);
  const [shift, setShift] = useState<StaffFilter["shift"]>("");
  const view = search.view ?? "teacher";
  const today = useToday();
  const todayDay = weekdayOfDate(today);
  const day = (search.day && search.day >= 1 && search.day <= 6 ? search.day : (todayDay ?? 1)) as TimetableDay;
  const filter: StaffFilter = { level: search.level ?? "", gender: search.gender ?? "", shift };
  const filtered = board ? filterTeachers(board, filter) : [];
  const filtering = Boolean(filter.level || filter.gender || filter.shift);
  const teacher = board?.teachers.find((t) => t.id === search.teacher) ?? board?.teachers[0];
  const mine = board && teacher ? board.slots.filter((s) => s.teacherId === teacher.id) : [];
  /** Periods a week: lessons (a combined class counts once). */
  const load = countLessons(mine);
  const perDay = TIMETABLE_DAYS.map((d) => ({ ...d, n: countLessons(mine.filter((s) => s.day === d.day)) }));
  const busiest = [...perDay].sort((a, b) => b.n - a.n)[0];
  const classes = [...new Set(mine.map((s) => s.classSection))];
  const totalPeriods = board ? periodsInWeek(board.schedule) : 0;
  const levelName = board && filter.level ? (boardLevels(board).levels.find((l) => l.value === filter.level)?.label ?? "") : "All levels";
  const genderName = filter.gender === "F" ? "women" : filter.gender === "M" ? "men" : "";
  const setFilter = (f: StaffFilter) => {
    setShift(f.shift);
    setSearch({ ...search, ...(f.level ? { level: f.level } : { level: undefined }), ...(f.gender ? { gender: f.gender } : { gender: undefined }) } as TeacherTimetableSearch);
  };

  const print = (what: "view" | "slips") => {
    setPrintWhat(what);
    printSoon();
  };

  const dayPlan = board ? (day === 5 ? board.friday : board.normal) : null;
  const dayCols = board ? Math.max(1, ...board.sections.map((s) => Math.max(...[scheduleOf(board, s.classSection)].map((sc) => (day === 5 ? sc.friday.periods : sc.normal.periods))))) : 0;
  const weekCols = idx?.maxPeriods ?? 0;
  const dayColumns = Array.from({ length: dayCols }, (_, k) => {
    const t = dayPlan?.periods.find((x) => x.no === k + 1);
    return { no: k + 1, ...(t ? { time: `${clockTime(t.start).slice(0, 5)}–${clockTime(t.end).slice(0, 5)}` } : {}) };
  });
  const weekColumns = Array.from({ length: weekCols }, (_, k) => ({ no: k + 1 }));
  const otherTimings = board && board.schedules.length > 1 ? `Times in the heading are the ${board.schedule.name.toLowerCase()}; lessons in classes on other timings show their own start time.` : undefined;

  return (
    <TimetableShell
      title="Teacher timetables"
      actions={
        board && (
          <div className="flex flex-wrap gap-2">
            <Segmented
              aria-label="View"
              value={view}
              onChange={(v) => setSearch({ ...search, view: v as "teacher" | "day" | "week" })}
              options={[
                { value: "teacher", label: "One teacher" },
                { value: "day", label: "All teachers, one day" },
                { value: "week", label: "All teachers, whole week" },
              ]}
            />
            <Button icon="printer" onClick={() => print("view")}>
              Print
            </Button>
            <Button icon="printer" variant="quiet" onClick={() => print("slips")}>
              Print every teacher's slip
            </Button>
            {canText && (
              <Button icon="message" onClick={() => setTexting(true)}>
                Text teachers their day
              </Button>
            )}
          </div>
        )
      }
    >
      <RequireSingleCampus action="teacher timetables">
        {q.isError && <QueryError what="The timetable" error={q.error} onRetry={() => void q.refetch()} />}
        {!board || !idx || !teacher ? (
          <Skeleton height={520} />
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <StaffFilters board={board} value={filter} onChange={setFilter} />
              <div className="flex flex-wrap items-center gap-3">
                <Switch checked={compact} onChange={(e) => setCompact(e.target.checked)} label="Compact slips (several teachers a page)" />
                <span className="text-small text-ink-muted">
                  {filtering ? `${filtered.length} of ${board.teachers.length} teachers` : `${filtered.length} teachers with lessons`}
                </span>
              </div>
            </div>
            {view === "day" ? (
              <Panel
                id="tt-teacher-day"
                rise={0}
                flush
                title={`Every teacher on ${dayLong(day)}`}
                description="Who teaches where in each period. Red cells: a teacher booked twice. A dot is a free period. Print gives the one-day timetable sheet."
                actions={<Select aria-label="Day" value={String(day)} onChange={(e) => setSearch({ ...search, day: Number(e.target.value) })} options={TIMETABLE_DAYS.map((d) => ({ value: String(d.day), label: d.long }))} />}
              >
                {filtered.length === 0 ? (
                  <EmptyState icon="user" title="No teachers match" description="No teacher of this kind has a lesson in a class of this level." />
                ) : (
                  <MatrixSheet
                    caption={`Every teacher on ${dayLong(day)}`}
                    columns={dayColumns}
                    rows={filtered.map((t) => {
                      const list = board.slots.filter((s) => s.teacherId === t.id && s.day === day);
                      const cells = teacherDayCells(board, idx, t.id, day, dayCols);
                      return { t, cells, total: countLessons(list), over: countLessons(list) > t.maxPerDay, clash: (k: number) => list.filter((s) => s.period === k + 1).some((s) => idx.clashOf(s.id).some((c) => c.kind === "TEACHER_DOUBLE_BOOKED" && c.severity === "BLOCK")) };
                    })}
                  />
                )}
              </Panel>
            ) : view === "week" ? (
              <Panel
                id="tt-teacher-week"
                rise={0}
                flush
                title={`Every teacher's week · ${levelName}`}
                description={`${filtered.length} ${filtered.length === 1 ? "teacher" : "teachers"}${genderName ? ` (${genderName})` : ""}. Each cell: class, subject and the days of that period. Print gives the teacher-wise master sheet.`}
              >
                {filtered.length === 0 ? (
                  <EmptyState icon="user" title="No teachers match" description="No teacher of this kind has a lesson in a class of this level." />
                ) : (
                  <MatrixSheet
                    caption="Every teacher's week"
                    columns={weekColumns}
                    rows={filtered.map((t) => {
                      const n = countLessons(board.slots.filter((s) => s.teacherId === t.id));
                      return { t, cells: teacherWeekCells(board, idx, t.id, weekCols), total: n, over: n > t.maxPerWeek };
                    })}
                  />
                )}
              </Panel>
            ) : (
              <>
                <div className="flex flex-wrap items-end gap-3">
                  <div style={{ minWidth: 280 }}>
                    <Combobox
                      label="Teacher"
                      value={teacher.id}
                      onValueChange={(v) => setSearch({ ...search, teacher: v })}
                      options={(filtering && filtered.length ? filtered : board.teachers).map((t) => ({ value: t.id, label: t.name, hint: `${countLessons(board.slots.filter((s) => s.teacherId === t.id))} a week`, keywords: [teacherShort(t.name)] }))}
                    />
                  </div>
                  {canEdit && mine.length > 0 && (
                    <Button icon="merge" onClick={() => setHandOver(true)}>
                      Hand over periods…
                    </Button>
                  )}
                </div>
                <div className="tt-kpis">
                  <div style={{ "--i": 0 } as CSSProperties}>
                    <StatCard
                      label="Periods a week"
                      icon="clock"
                      tone={load > teacher.maxPerWeek ? "danger" : undefined}
                      value={<AnimatedNumber value={load} format={formatCount} />}
                      meter={Math.min(100, (load / teacher.maxPerWeek) * 100)}
                      {...(load > teacher.maxPerWeek ? { meterTone: "danger" as const } : load > teacher.maxPerWeek - 4 ? { meterTone: "warning" as const } : {})}
                      meterLabel={`${load} of ${teacher.maxPerWeek}`}
                      foot={`Maximum ${teacher.maxPerWeek}${teacher.partTime ? " (part-time)" : ""}`}
                    />
                  </div>
                  <div style={{ "--i": 1 } as CSSProperties}>
                    <StatCard label="Free periods" icon="calendar" value={<AnimatedNumber value={Math.max(0, totalPeriods - load)} format={formatCount} />} foot={`of ${totalPeriods} in the school day's week`} />
                  </div>
                  <div style={{ "--i": 2 } as CSSProperties}>
                    <StatCard label="Busiest day" icon="trendUp" tone="info" value={busiest ? busiest.long : "—"} foot={busiest ? `${busiest.n} periods` : ""} />
                  </div>
                  <div style={{ "--i": 3 } as CSSProperties}>
                    <StatCard label="Classes" icon="students" value={formatCount(classes.length)} foot={classes.join(", ") || "No lessons yet"} />
                  </div>
                </div>
                <Panel
                  id="tt-teacher"
                  rise={1}
                  title={`${teacher.name}'s week`}
                  description={`${teacher.classTeacherOf ? `Class teacher of ${teacher.classTeacherOf}. ` : ""}Teaches ${teacher.subjectIds.map((s) => idx.subject(s).name).join(", ")}. The same timetable shows in the teacher app.${board.schedules.length > 1 ? " Lessons in classes on other timings show their own start time." : ""}`}
                >
                  {mine.length === 0 ? (
                    <EmptyState icon="calendar" title="No lessons yet" description="Add this teacher to class timetables, or allot subjects in Setup › Teachers." />
                  ) : (
                    <TimetableGrid
                      board={board}
                      periods={idx.maxPeriods}
                      caption={`${teacher.name} weekly timetable`}
                      cell={(d, p) => {
                        const here = mine.filter((s) => s.day === d && s.period === p);
                        if (here.length === 0) return { className: "is-free", label: `${dayLong(d)}, period ${p}: free`, content: <span>Free</span> };
                        const s = here[0]!;
                        const subj = idx.subject(s.subjectId);
                        const at = ownTime(board, s);
                        const sev = countLessons(here) > 1 || here.some((x) => idx.clashOf(x.id).some((c) => c.severity === "BLOCK")) ? "BLOCK" : undefined;
                        return {
                          className: `tt-c${subj.tint} ${sev ? "is-clash" : ""}`,
                          label: `${dayLong(d)}, period ${p}: ${here.map((x) => `${lessonClass(x)} ${idx.subject(x.subjectId).name}`).join(" and ")}${at ? ` at ${clockTime(at)}` : ""}`,
                          content: <LessonCell title={here.map(lessonClass).join(" + ")} line={subj.short} sub={s.room} {...(sev ? { flag: sev } : {})} />,
                          ...(at ? { time: clockTime(at).slice(0, 5) } : {}),
                        };
                      }}
                    />
                  )}
                </Panel>
                {handOver && <HandOver board={board} idx={idx} fromId={teacher.id} onClose={() => setHandOver(false)} />}
              </>
            )}
          </>
        )}
        {texting && <TeacherTextsDialog date={today} onClose={() => setTexting(false)} />}
        {board && idx && (
          <PrintArea>
            {printWhat === "view" && view === "day" ? (
              <PrintMatrix
                board={board}
                title={`One-day timetable · ${dayLong(day)}`}
                scope={`Class level: ${levelName}${genderName ? ` · ${genderName}` : ""}`}
                right={`Total staff: ${filtered.length}`}
                rowHeader="Teacher"
                columns={dayColumns}
                rows={filtered.map((t) => ({ key: t.id, label: t.name, cells: teacherDayCells(board, idx, t.id, day, dayCols) }))}
                {...(otherTimings ? { note: otherTimings } : {})}
              />
            ) : printWhat === "view" && view === "week" ? (
              <PrintMatrix
                board={board}
                title="Teacher-wise master sheet"
                scope={`Class level: ${levelName}${genderName ? ` · ${genderName}` : ""}`}
                right={`Total staff: ${filtered.length}`}
                rowHeader="Teacher"
                columns={weekColumns}
                rows={filtered.map((t) => ({ key: t.id, label: t.name, cells: teacherWeekCells(board, idx, t.id, weekCols) }))}
                note="Each cell: class, subject and the days of that period."
              />
            ) : printWhat === "slips" && compact ? (
              <CompactSlips board={board} idx={idx} teachers={filtered} scope={`Class level: ${levelName}${genderName ? ` · ${genderName}` : ""}`} />
            ) : (
              (printWhat === "slips" ? filtered : [teacher].filter((t): t is TimetableTeacher => !!t)).map((t) => (
                <PrintTimetable
                  key={t.id}
                  board={board}
                  periods={idx.maxPeriods}
                  title={`Teacher timetable · ${t.name}`}
                  scope={`${countLessons(board.slots.filter((s) => s.teacherId === t.id))} periods a week${t.classTeacherOf ? ` · Class teacher of ${t.classTeacherOf}` : ""}`}
                  cell={(d, p) => {
                    const here = board.slots.filter((s) => s.teacherId === t.id && s.day === d && s.period === p);
                    const at = here[0] ? ownTime(board, here[0]) : undefined;
                    return here.length ? { title: here.map(lessonClass).join(" + "), line: `${idx.subject(here[0]!.subjectId).short}${here[0]!.room ? ` · ${here[0]!.room}` : ""}`, ...(at ? { time: clockTime(at).slice(0, 5) } : {}) } : null;
                  }}
                />
              ))
            )}
          </PrintArea>
        )}
      </RequireSingleCampus>
    </TimetableShell>
  );
}

/** Several teachers on each A4 page: only the periods each one teaches, with times and days. */
function CompactSlips({ board, idx, teachers, scope }: { board: TimetableBoard; idx: BoardIndex; teachers: TimetableTeacher[]; scope: string }) {
  const pages: TimetableTeacher[][] = [];
  for (let i = 0; i < teachers.length; i += 4) pages.push(teachers.slice(i, i + 4));
  if (pages.length === 0) pages.push([]);
  return (
    <>
      {pages.map((list, pi) => {
        return (
          <div key={pi} className="tt-print-page">
            <PrintHead board={board} title="Teacher timetable slips" scope={`${scope} · page ${pi + 1} of ${pages.length}`} right={`Total staff: ${teachers.length}`} />
            {list.length === 0 && <p>Nothing to print for these filters.</p>}
            {list.map((t) => {
              const used = [...new Set(board.slots.filter((s) => s.teacherId === t.id).map((s) => s.period))].sort((a, b) => a - b);
              const cells = teacherWeekCells(board, idx, t.id, idx.maxPeriods);
              return (
                <div key={t.id} className="tt-print-slip">
                  <h2>
                    {t.name}
                    {t.classTeacherOf ? ` · class teacher of ${t.classTeacherOf}` : ""} · {countLessons(board.slots.filter((s) => s.teacherId === t.id))} periods a week
                  </h2>
                  <table className="tt-print-matrix">
                    <thead>
                      <tr>
                        {used.map((p) => {
                          const tm = board.normal.periods.find((x) => x.no === p);
                          return (
                            <th key={p}>
                              {p}
                              {tm ? ` · ${clockTime(tm.start).slice(0, 5)}` : ""}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        {used.map((p) => (
                          <td key={p} className="tt-print-small">
                            {(cells[p - 1] ?? "").split("\n").map((line, j) => (
                              <span key={j}>{line}</span>
                            ))}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
