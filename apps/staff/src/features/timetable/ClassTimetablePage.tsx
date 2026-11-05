import { clockTime, CLASH_LABEL, dayPlanOf, periodsInWeek, placedBySubject, reqKey, scheduleOf, sectionPeriodsOn, streamShort, TIMETABLE_DAYS, type TimetableBoard, type TimetableClash, type TimetableDay, type TimetableSection, type TimetableSlot } from "@mtb/api";
import { formatDateTime } from "@mtb/domain";
import { Banner, Button, EmptyState, Icon, Panel, Segmented, Select, Skeleton, StatusBadge } from "@mtb/ui";
import { useState, type CSSProperties } from "react";
import { RequireSingleCampus } from "../../app/shell/page";
import { useCtx } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import {
  cellSlots,
  collapseDays,
  dayLong,
  isSplit,
  LessonCell,
  PrintArea,
  PrintMatrix,
  PrintTimetable,
  printSoon,
  QueryError,
  teacherShort,
  TimetableGrid,
  TimetableShell,
  TODAY_DAY,
  useBoard,
  useBoardIndex,
  useCanEdit,
  type BoardIndex,
  type PrintMatrixRow,
} from "./shared";
import { SlotEditor, type SlotTarget } from "./SlotEditor";

export interface ClassTimetableSearch {
  cls?: string;
  view?: "class" | "day" | "week";
  day?: number;
  /** Class for the whole-week master sheet: "9", "Prep". */
  klass?: string;
}

/** "7-B" → "7"; a long section name keeps its class: "ADP Computer Science – Batch 2026" → "ADP Computer Science". */
const classOf = (cs: string) => (cs.includes(" – ") ? cs.split(" – ")[0]! : cs.split("-")[0]!);
const classLabel = (k: string) => (k === "Prep" ? "Prep" : `Class ${k}`);

function sectionStatus(board: TimetableBoard, idx: BoardIndex, s: TimetableSection) {
  const placed = placedBySubject(board, s.classSection);
  const need = s.requirements.reduce((a, r) => a + r.periodsPerWeek, 0);
  const have = s.requirements.reduce((a, r) => a + Math.min(placed.get(reqKey(r.subjectId, r.stream)) ?? 0, r.periodsPerWeek), 0);
  const ids = new Set(board.slots.filter((x) => x.classSection === s.classSection).map((x) => x.id));
  const clashes = idx.clashes.filter((c) => c.severity === "BLOCK" && c.slotIds.some((id) => ids.has(id))).length;
  return { need, have, short: need - have, clashes };
}

function ClashList({ idx, onOpen }: { idx: BoardIndex; onOpen: (c: TimetableClash) => void }) {
  const block = idx.clashes.filter((c) => c.severity === "BLOCK");
  const warn = idx.clashes.filter((c) => c.severity === "WARN" && c.kind !== "NO_TEACHER");
  if (block.length === 0 && warn.length === 0) {
    return <EmptyState icon="checkCircle" title="No clashes" description="No teacher or room is booked twice, and nobody is over their maximum." />;
  }
  const groups = [...new Set(warn.map((c) => c.kind))];
  return (
    <ul className="tt-list">
      {block.map((c, i) => (
        <li key={`b${i}`} className="mtb-slide-in" style={{ "--i": i } as CSSProperties}>
          <Icon name="alertCircle" className="text-danger-ink" />
          <button type="button" className="tt-link grid min-w-0" onClick={() => onOpen(c)}>
            <b className="text-ink">{CLASH_LABEL[c.kind]}</b>
            <span className="text-small text-ink-muted">{c.message}</span>
          </button>
          <StatusBadge status="danger" className="ml-auto">
            Fix
          </StatusBadge>
        </li>
      ))}
      {groups.map((k, i) => {
        const list = warn.filter((c) => c.kind === k);
        return (
          <li key={k} className="mtb-slide-in" style={{ "--i": block.length + i } as CSSProperties}>
            <Icon name="alert" className="text-warning-ink" />
            <span className="grid min-w-0">
              <b className="text-ink">
                {CLASH_LABEL[k]} ({list.length})
              </b>
              <span className="text-small text-ink-muted">
                {list
                  .slice(0, 3)
                  .map((c) => c.message)
                  .join(" ")}
                {list.length > 3 ? ` …and ${list.length - 3} more.` : ""}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** "Bio: Biology – Rukhsana Bibi" lines for one class period. */
const lessonLines = (idx: BoardIndex, list: TimetableSlot[], withTeacher = true) =>
  list.map((s) => `${s.stream ? `${streamShort(s.stream)}: ` : ""}${idx.subject(s.subjectId).short}${withTeacher ? ` – ${teacherShort(idx.teacher(s.teacherId)?.name ?? "—")}` : ""}`);

function DaySheet({ board, idx, day, sections, onPick, canEdit }: { board: TimetableBoard; idx: BoardIndex; day: TimetableDay; sections: TimetableSection[]; onPick: (t: SlotTarget) => void; canEdit: boolean }) {
  const max = Math.max(1, ...sections.map((s) => sectionPeriodsOn(board, s.classSection, day)));
  const plan = board.days?.[board.schedule.id] ? (day === 5 ? board.days[board.schedule.id]!.friday : board.days[board.schedule.id]!.normal) : day === 5 ? board.friday : board.normal;
  return (
    <div className="tt-matrix-wrap">
      <table className="tt-matrix">
        <caption className="mtb-sr-only">Every class on {dayLong(day)}</caption>
        <thead>
          <tr>
            <th className="tt-sticky" scope="col">
              Class
            </th>
            {Array.from({ length: max }, (_, k) => k + 1).map((p) => (
              <th key={p} scope="col">
                {p}
                <br />
                {plan.periods.find((x) => x.no === p)?.start ?? ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sections.map((s, i) => {
            const own = scheduleOf(board, s.classSection);
            const n = sectionPeriodsOn(board, s.classSection, day);
            const ownPlan = dayPlanOf(board, s.classSection, day);
            return (
              <tr key={s.classSection} style={{ "--i": i } as CSSProperties}>
                <th scope="row" className="tt-sticky">
                  {s.classSection}
                  {!own.main && <span className="block text-small font-normal text-ink-muted">{own.name}</span>}
                </th>
                {Array.from({ length: max }, (_, k) => k + 1).map((p) => {
                  if (p > n) return <td key={p} className="none" />;
                  const list = cellSlots(board, s.classSection, day, p);
                  const clash = list.some((x) => idx.clashOf(x.id).some((c) => c.severity === "BLOCK"));
                  const at = !own.main ? ownPlan.periods.find((x) => x.no === p)?.start : undefined;
                  const body = list.length ? (
                    <>
                      {list.map((x) => (
                        <span key={x.id} className="block">
                          <b>{x.stream ? `${streamShort(x.stream)}: ` : ""}{idx.subject(x.subjectId).short}</b>
                          <span className="block text-small text-ink-muted">{teacherShort(idx.teacher(x.teacherId)?.name ?? "—")}</span>
                        </span>
                      ))}
                      {at && <span className="block text-small text-ink-subtle">{at}</span>}
                    </>
                  ) : (
                    <span className="text-ink-subtle">Free</span>
                  );
                  return (
                    <td key={p} className={clash ? "over" : undefined}>
                      {canEdit ? (
                        <button type="button" className="tt-link border-0 bg-transparent p-0 text-center" style={{ font: "inherit", cursor: "pointer" }} onClick={() => onPick({ section: s, day, period: p, stream: list.length && list.every((x) => x.stream) ? (list[0]!.stream ?? null) : null })}>
                          {body}
                        </button>
                      ) : (
                        body
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Master-sheet cells for one section across the week: "Teacher: Subject: Mon–Sat" per period. */
function weekCells(board: TimetableBoard, idx: BoardIndex, cs: string, periods: number): string[] {
  return Array.from({ length: periods }, (_, k) => {
    const p = k + 1;
    const groups = new Map<string, TimetableDay[]>();
    for (const s of board.slots.filter((x) => x.classSection === cs && x.period === p)) {
      const key = `${teacherShort(idx.teacher(s.teacherId)?.name ?? "No teacher")}: ${s.stream ? `${streamShort(s.stream)} ` : ""}${idx.subject(s.subjectId).short}`;
      groups.set(key, [...(groups.get(key) ?? []), s.day]);
    }
    return [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([k, days]) => `${k}: ${collapseDays(days)}`)
      .join("\n");
  });
}

function WeekSheet({ board, idx, sections, periods }: { board: TimetableBoard; idx: BoardIndex; sections: TimetableSection[]; periods: number }) {
  return (
    <div className="tt-matrix-wrap">
      <table className="tt-matrix">
        <caption className="mtb-sr-only">Each section's week, period by period</caption>
        <thead>
          <tr>
            <th className="tt-sticky" scope="col">
              Section
            </th>
            {Array.from({ length: periods }, (_, k) => (
              <th key={k} scope="col">
                {k + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sections.map((s, i) => {
            const cells = weekCells(board, idx, s.classSection, periods);
            return (
              <tr key={s.classSection} style={{ "--i": i } as CSSProperties}>
                <th scope="row" className="tt-sticky">
                  {s.classSection}
                  <span className="block text-small font-normal text-ink-muted">{teacherShort(idx.teacher(s.classTeacherId)?.name ?? "No class teacher")}</span>
                </th>
                {cells.map((c, k) => (
                  <td key={k} className={c ? "tt-wrap" : "none"}>
                    {c ? c.split("\n").map((line, j) => <span key={j}>{line}</span>) : "·"}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Build each class's week period by period, with clashes shown as you choose; print one class or all of them. */
export function ClassTimetablePage({ search, setSearch }: { search: ClassTimetableSearch; setSearch: (s: ClassTimetableSearch) => void }) {
  const ctx = useCtx();
  const q = useBoard();
  const board = q.data;
  const idx = useBoardIndex(board);
  const canEdit = useCanEdit() && !!board && !board.readOnly;
  const [target, setTarget] = useState<SlotTarget | null>(null);
  const [printAll, setPrintAll] = useState(false);
  const view = search.view ?? "class";
  const day = (search.day && search.day >= 1 && search.day <= 6 ? search.day : TODAY_DAY) as TimetableDay;
  const section = board?.sections.find((s) => s.classSection === (search.cls ?? "7-B")) ?? board?.sections[0];
  const st = board && idx && section ? sectionStatus(board, idx, section) : null;
  const blockCount = idx?.clashes.filter((c) => c.severity === "BLOCK").length ?? 0;
  const classes = board ? [...new Set(board.sections.map((s) => classOf(s.classSection)))] : [];
  const klass = search.klass && classes.includes(search.klass) ? search.klass : (classes.find((c) => c === "9") ?? classes[0] ?? "");
  const classSections = board ? board.sections.filter((s) => classOf(s.classSection) === klass) : [];
  const weekPeriods = board ? Math.max(1, ...classSections.map((s) => { const sc = scheduleOf(board, s.classSection); return Math.max(sc.normal.periods, sc.friday.periods); })) : 0;

  const openClash = (c: TimetableClash) => {
    const slot = board?.slots.find((s) => s.id === c.slotIds[0]);
    if (!slot || !board) return;
    setSearch({ ...search, view: "class", cls: slot.classSection });
    const sec = board.sections.find((s) => s.classSection === slot.classSection);
    if (sec && canEdit) setTarget({ section: sec, day: slot.day, period: slot.period, stream: slot.stream ?? null });
  };

  const print = (all: boolean) => {
    setPrintAll(all);
    printSoon();
  };

  const classGrid = (s: TimetableSection) => ({
    schedule: scheduleOf(board!, s.classSection),
    streams: s.streams,
    split: (d: TimetableDay, p: number) => isSplit(board!, s.classSection, d, p),
  });

  return (
    <TimetableShell
      title="Class timetables"
      meta={board ? <span className="text-small text-ink-muted">Last changed by {board.updatedBy}, {formatDateTime(board.updatedAt)}</span> : undefined}
      actions={
        board && (
          <div className="flex flex-wrap gap-2">
            <Segmented
              aria-label="View"
              value={view}
              onChange={(v) => setSearch({ ...search, view: v as "class" | "day" | "week" })}
              options={[
                { value: "class", label: "One class" },
                { value: "day", label: "All classes, one day" },
                { value: "week", label: "One class, whole week" },
              ]}
            />
            <Button icon="printer" onClick={() => print(false)}>
              Print
            </Button>
            <Button icon="printer" variant="quiet" onClick={() => print(true)}>
              Print all classes
            </Button>
          </div>
        )
      }
    >
      <RequireSingleCampus action="class timetables">
        {q.isError && <QueryError what="The timetable" error={q.error} onRetry={() => void q.refetch()} />}
        {!board || !idx ? (
          <div className="tt-split">
            <Skeleton height={520} />
            <Skeleton height={520} />
          </div>
        ) : (
          <>
            {blockCount > 0 && (
              <Banner tone="danger" title={`${blockCount} ${blockCount === 1 ? "clash needs" : "clashes need"} fixing before the timetable is printed.`}>
                They came across from the old timetable, which only warned and let the clash be saved. Open one below to fix it.
              </Banner>
            )}
            {view === "day" ? (
              <Panel
                id="tt-day"
                rise={0}
                flush
                title={`Every class on ${dayLong(day)}`}
                description={`${campusLabel(ctx.campus)} · the old "class-wise master sheet", live. Times are the school day's; classes on other timings show their own.`}
                actions={<Select aria-label="Day" value={String(day)} onChange={(e) => setSearch({ ...search, day: Number(e.target.value) })} options={TIMETABLE_DAYS.map((d) => ({ value: String(d.day), label: d.long }))} />}
              >
                <DaySheet board={board} idx={idx} day={day} sections={board.sections} canEdit={canEdit} onPick={setTarget} />
              </Panel>
            ) : view === "week" ? (
              <Panel
                id="tt-week"
                rise={0}
                flush
                title={`${classLabel(klass)}: every section's week`}
                description={`${classSections.length} ${classSections.length === 1 ? "section" : "sections"}. Each cell: teacher, subject and the days of that period. Print gives the section-wise master sheet.`}
                actions={<Select aria-label="Class" value={klass} onChange={(e) => setSearch({ ...search, klass: e.target.value })} options={classes.map((c) => ({ value: c, label: classLabel(c) }))} />}
              >
                {classSections.length === 0 ? <EmptyState icon="layers" title="No sections" description="This class has no sections at this campus." /> : <WeekSheet board={board} idx={idx} sections={classSections} periods={weekPeriods} />}
              </Panel>
            ) : (
              <div className="tt-split">
                <div className="mtb-card p-0">
                  <ul className="tt-sections" aria-label="Classes">
                    {board.sections.map((s) => {
                      const x = sectionStatus(board, idx, s);
                      return (
                        <li key={s.classSection}>
                          <button type="button" aria-current={s.classSection === section?.classSection} onClick={() => setSearch({ ...search, cls: s.classSection })}>
                            <span>
                              {s.classSection}
                              <small>
                                {x.have} of {x.need} periods
                                {s.streams.length ? ` · ${s.streams.length} groups` : ""}
                              </small>
                            </span>
                            {x.clashes > 0 ? <StatusBadge status="danger">{x.clashes}</StatusBadge> : x.short > 0 ? <StatusBadge status="warning">{x.short} to place</StatusBadge> : <Icon name="checkCircle" size={16} className="text-success" label="Complete" />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
                {section && st && (
                  <div className="grid gap-4">
                    <Panel
                      id="tt-class"
                      rise={0}
                      title={`${section.classSection} timetable`}
                      description={`Class teacher ${idx.teacher(section.classTeacherId)?.name ?? "not set"} · ${section.room} · ${section.strength} students · ${scheduleOf(board, section.classSection).name} timings · ${st.have} of ${st.need} curriculum periods placed, ${periodsInWeek(scheduleOf(board, section.classSection)) - new Set(board.slots.filter((s) => s.classSection === section.classSection).map((s) => `${s.day}|${s.period}`)).size} free in a ${periodsInWeek(scheduleOf(board, section.classSection))}-period week.${section.streams.length ? ` G: the class's groups (${section.streams.join(", ")}); a split period has one lesson per group.` : ""}${canEdit ? " Choose a period to change it." : ""}`}
                    >
                      <TimetableGrid
                        board={board}
                        caption={`${section.classSection} weekly timetable`}
                        {...classGrid(section)}
                        cell={(d, p, stream) => {
                          const list = cellSlots(board, section.classSection, d, p);
                          const slot = stream ? list.find((s) => s.stream === stream) : list.find((s) => !s.stream);
                          const clashes = slot ? idx.clashOf(slot.id) : [];
                          const sev = clashes.some((c) => c.severity === "BLOCK") ? "BLOCK" : clashes.some((c) => c.kind !== "TEACHER_OVER_WEEK") ? "WARN" : undefined;
                          const open = canEdit ? () => setTarget({ section, day: d, period: p, stream }) : undefined;
                          const who = stream ? ` (${stream})` : "";
                          if (!slot)
                            return {
                              className: "is-free",
                              label: `${dayLong(d)}, period ${p}${who}: free${canEdit ? ". Choose to add a lesson." : ""}`,
                              content: canEdit ? (
                                <>
                                  <Icon name="plus" size={16} />
                                  <span>Free</span>
                                </>
                              ) : (
                                <span>Free</span>
                              ),
                              ...(open ? { onClick: open } : {}),
                            };
                          const subj = idx.subject(slot.subjectId);
                          const teacher = idx.teacher(slot.teacherId)?.name ?? "No teacher";
                          return {
                            className: `tt-c${subj.tint} ${sev === "BLOCK" ? "is-clash" : sev === "WARN" ? "is-warn" : ""}`,
                            label: `${dayLong(d)}, period ${p}${who}: ${subj.name} with ${teacher}${slot.room !== section.room ? ` in ${slot.room}` : ""}${clashes.length ? `. ${clashes.map((c) => c.message).join(" ")}` : ""}`,
                            content: <LessonCell title={subj.short} line={teacherShort(teacher)} {...(slot.room !== section.room ? { sub: slot.room } : {})} {...(sev ? { flag: sev } : {})} />,
                            ...(open ? { onClick: open } : {}),
                          };
                        }}
                      />
                    </Panel>
                    <Panel id="tt-reqs" rise={1} title="Periods this week by subject" description={section.streams.length ? "From the class's subjects in Setup. Group subjects are counted for their group. Short subjects still need periods; extra ones are flagged." : "From the class's subjects in Setup. Short subjects still need periods; extra ones are flagged."}>
                      <div className="tt-reqs">
                        {section.requirements.map((r, i) => {
                          const placed = placedBySubject(board, section.classSection).get(reqKey(r.subjectId, r.stream)) ?? 0;
                          const pct = Math.min(100, (placed / Math.max(1, r.periodsPerWeek)) * 100);
                          const teacher = idx.teacher(r.teacherId)?.name;
                          return (
                            <div key={reqKey(r.subjectId, r.stream)} className="tt-req mtb-slide-in" style={{ "--i": i } as CSSProperties}>
                              <div className="tt-req-top">
                                <b>
                                  {idx.subject(r.subjectId).name}
                                  {r.stream && <span className="block text-small font-normal text-ink-muted">{r.stream} group</span>}
                                </b>
                                <span className={`mtb-num ${placed > r.periodsPerWeek ? "text-danger-ink" : placed < r.periodsPerWeek ? "text-warning-ink" : "text-success-ink"}`}>
                                  {placed} / {r.periodsPerWeek}
                                </span>
                              </div>
                              <span className={`mtb-meter ${placed > r.periodsPerWeek ? "tone-danger" : placed < r.periodsPerWeek ? "tone-warning" : ""}`} role="img" aria-label={`${placed} of ${r.periodsPerWeek} periods`}>
                                <span style={{ width: `${pct}%` }} />
                              </span>
                              <small>{teacher ?? "No teacher allotted in Setup"}</small>
                            </div>
                          );
                        })}
                      </div>
                    </Panel>
                  </div>
                )}
              </div>
            )}

            <Panel id="tt-clashes" rise={2} title="Clashes and warnings" description="Checked across the whole campus every time a period is saved, by clock time across bell timings. Red ones must be fixed or kept with a reason.">
              <ClashList idx={idx} onOpen={openClash} />
            </Panel>

            <PrintArea>
              {view === "day"
                ? (() => {
                    const max = Math.max(1, ...board.sections.map((s) => sectionPeriodsOn(board, s.classSection, day)));
                    const plan = day === 5 ? board.friday : board.normal;
                    const rows: PrintMatrixRow[] = board.sections.map((s) => {
                      const own = scheduleOf(board, s.classSection);
                      const ownPlan = dayPlanOf(board, s.classSection, day);
                      return {
                        key: s.classSection,
                        label: s.classSection,
                        ...(own.main ? {} : { sub: own.name }),
                        cells: Array.from({ length: max }, (_, k) => {
                          const list = cellSlots(board, s.classSection, day, k + 1);
                          const at = !own.main && list.length ? ownPlan.periods.find((x) => x.no === k + 1)?.start : undefined;
                          return [...lessonLines(idx, list), ...(at ? [clockTime(at).slice(0, 5)] : [])].join("\n");
                        }),
                      };
                    });
                    return (
                      <PrintMatrix
                        board={board}
                        title={`Class timetables · ${dayLong(day)}`}
                        scope="Every class on one day: subject and teacher in each period."
                        right={`Total sections: ${board.sections.length}`}
                        rowHeader="Class"
                        columns={Array.from({ length: max }, (_, k) => {
                          const t = plan.periods.find((x) => x.no === k + 1);
                          return { no: k + 1, ...(t ? { time: `${clockTime(t.start).slice(0, 5)}–${clockTime(t.end).slice(0, 5)}` } : {}) };
                        })}
                        rows={rows}
                        note={board.schedules.length > 1 ? `Times in the heading are the ${board.schedule.name.toLowerCase()}; classes on other timings show their own start time.` : undefined}
                      />
                    );
                  })()
                : view === "week"
                  ? (printAll ? classes : [klass]).map((k) => {
                      const list = board.sections.filter((s) => classOf(s.classSection) === k);
                      const max = Math.max(1, ...list.map((s) => { const sc = scheduleOf(board, s.classSection); return Math.max(sc.normal.periods, sc.friday.periods); }));
                      return (
                        <PrintMatrix
                          key={k}
                          board={board}
                          title={`Section-wise master sheet · ${classLabel(k)}`}
                          scope="Each cell: teacher, subject and the days of that period."
                          right={`Total sections: ${list.length}`}
                          rowHeader="Section"
                          columns={Array.from({ length: max }, (_, i) => ({ no: i + 1 }))}
                          rows={list.map((s) => ({ key: s.classSection, label: s.classSection, sub: idx.teacher(s.classTeacherId)?.name ?? "", cells: weekCells(board, idx, s.classSection, max) }))}
                        />
                      );
                    })
                  : (printAll ? board.sections : section ? [section] : []).map((s) => (
                      <PrintTimetable
                        key={s.classSection}
                        board={board}
                        title={`Class timetable · ${s.classSection}`}
                        scope={`Class teacher ${idx.teacher(s.classTeacherId)?.name ?? "—"} · ${s.room}`}
                        {...classGrid(s)}
                        cell={(d, p, stream) => {
                          const list = cellSlots(board, s.classSection, d, p);
                          const slot = stream ? list.find((x) => x.stream === stream) : list.find((x) => !x.stream);
                          return slot ? { title: idx.subject(slot.subjectId).short, line: teacherShort(idx.teacher(slot.teacherId)?.name ?? "—") } : null;
                        }}
                      />
                    ))}
            </PrintArea>

            {target && <SlotEditor key={`${target.section.classSection}-${target.day}-${target.period}-${target.stream ?? ""}`} board={board} target={target} onClose={() => setTarget(null)} />}
          </>
        )}
      </RequireSingleCampus>
    </TimetableShell>
  );
}
