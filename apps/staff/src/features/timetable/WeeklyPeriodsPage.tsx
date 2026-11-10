import { countLessons, periodsInWeek, placedBySubject, reqKey, scheduleOf, TIMETABLE_DAYS, type TimetableTeacher } from "@mtb/api";
import { formatCount } from "@mtb/domain";
import { AnimatedNumber, buttonClassName, DataTable, Panel, Segmented, Skeleton, StatCard, type Column } from "@mtb/ui";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type CSSProperties } from "react";
import { RequireSingleCampus } from "../../app/shell/page";
import { useCan } from "../../app/session";
import { QueryError, TimetableShell, useBoard, useBoardIndex } from "./shared";

const streamTag = (s: string) => /\(([^)]+)\)/.exec(s)?.[1] ?? s;

/** Periods a week each subject needs in each class, against what the timetable gives it; and each teacher's load. */
export function WeeklyPeriodsPage() {
  const q = useBoard();
  const board = q.data;
  const idx = useBoardIndex(board);
  const navigate = useNavigate();
  const canSetup = useCan("setup.manage");
  const [only, setOnly] = useState("all");

  if (!board || !idx) {
    return (
      <TimetableShell title="Periods per subject">
        <RequireSingleCampus action="periods per subject">
          {q.isError ? <QueryError what="The timetable" error={q.error} onRetry={() => void q.refetch()} /> : <Skeleton height={480} />}
        </RequireSingleCampus>
      </TimetableShell>
    );
  }

  const subjectIds = board.subjects.map((s) => s.id).filter((id) => board.sections.some((sec) => sec.requirements.some((r) => r.subjectId === id)));
  const rows = board.sections.map((s) => {
    // Group subjects (a split class) count for their own group: Biology for the Biology group, and so on.
    const placed = placedBySubject(board, s.classSection);
    const got = (r: (typeof s.requirements)[number]) => placed.get(reqKey(r.subjectId, r.stream)) ?? 0;
    const need = s.requirements.reduce((a, r) => a + r.periodsPerWeek, 0);
    const short = s.requirements.reduce((a, r) => a + Math.max(0, r.periodsPerWeek - got(r)), 0);
    const over = s.requirements.reduce((a, r) => a + Math.max(0, got(r) - r.periodsPerWeek), 0);
    const total = new Set(board.slots.filter((x) => x.classSection === s.classSection).map((x) => `${x.day}|${x.period}`)).size;
    return { s, placed, need, short, over, total, week: periodsInWeek(scheduleOf(board, s.classSection)) };
  });
  const shown = only === "short" ? rows.filter((r) => r.short > 0 || r.over > 0) : rows;
  const need = rows.reduce((a, r) => a + r.need, 0);
  const short = rows.reduce((a, r) => a + r.short, 0);
  const complete = rows.filter((r) => r.short === 0 && r.over === 0).length;
  const week = periodsInWeek(board.schedule);
  const timings = board.schedules.length;

  const loads = board.teachers.map((t) => {
    const mine = board.slots.filter((s) => s.teacherId === t.id);
    const days = TIMETABLE_DAYS.map((d) => countLessons(mine.filter((s) => s.day === d.day)));
    return { id: t.id, t, n: countLessons(mine), busiest: Math.max(0, ...days) };
  });
  const over = loads.filter((l) => l.n > l.t.maxPerWeek).length;
  const columns: Array<Column<{ id: string; t: TimetableTeacher; n: number; busiest: number }>> = [
    {
      key: "name",
      header: "Teacher",
      render: (l) => (
        <span className="grid">
          <span className="mtb-cell-primary">{l.t.name}</span>
          <span className="mtb-cell-secondary">{l.t.subjectIds.map((s) => idx.subject(s).short).join(", ")}</span>
        </span>
      ),
    },
    { key: "ct", header: "Class teacher of", width: 140, render: (l) => l.t.classTeacherOf ?? <span className="text-ink-subtle">—</span> },
    { key: "busiest", header: "Busiest day", align: "right", width: 110, render: (l) => <span className={`mtb-num ${l.busiest > l.t.maxPerDay ? "text-danger-ink font-semibold" : ""}`}>{l.busiest}</span> },
    {
      key: "n",
      header: "Periods a week",
      width: 240,
      render: (l) => (
        <span className="flex items-center gap-2">
          <span className={`mtb-meter flex-1 ${l.n > l.t.maxPerWeek ? "tone-danger" : l.n > l.t.maxPerWeek - 4 ? "tone-warning" : ""}`} role="img" aria-label={`${l.n} of ${l.t.maxPerWeek}`}>
            <span style={{ width: `${Math.min(100, (l.n / l.t.maxPerWeek) * 100)}%` }} />
          </span>
          <span className={`mtb-num w-16 text-right ${l.n > l.t.maxPerWeek ? "text-danger-ink font-semibold" : ""}`}>
            {l.n} / {l.t.maxPerWeek}
          </span>
        </span>
      ),
    },
  ];

  return (
    <TimetableShell
      title="Periods per subject"
      actions={
        canSetup ? (
          <Link to="/setup/subjects" className={buttonClassName({ size: "sm", variant: "quiet" })}>
            Change periods a week in Setup
          </Link>
        ) : undefined
      }
    >
      <RequireSingleCampus action="periods per subject">
        <div className="tt-kpis">
          <div style={{ "--i": 0 } as CSSProperties}>
            <StatCard label="Periods the curriculum needs" icon="book" value={<AnimatedNumber value={need} format={formatCount} />} foot={`${board.sections.length} classes · ${timings > 1 ? `${timings} bell timings` : `${week} periods in a week each`}`} />
          </div>
          <div style={{ "--i": 1 } as CSSProperties}>
            <StatCard label="Still to place" icon="alert" tone={short ? "warning" : "neutral"} value={<AnimatedNumber value={short} format={formatCount} />} meter={need ? ((need - short) / need) * 100 : 100} meterLabel="Placed" foot={`${formatCount(need - short)} placed`} />
          </div>
          <div style={{ "--i": 2 } as CSSProperties}>
            <StatCard label="Classes complete" icon="checkCircle" value={`${complete} of ${rows.length}`} foot="Every subject has exactly its periods" />
          </div>
          <div style={{ "--i": 3 } as CSSProperties}>
            <StatCard label="Teachers over the maximum" icon="user" tone={over ? "danger" : "neutral"} value={formatCount(over)} foot="Weekly maximum 36 (part-time 18)" />
          </div>
        </div>

        <Panel
          id="tt-matrix"
          rise={1}
          flush
          title="Placed / needed, by class and subject"
          description="Amber: still short. Red: more periods than the curriculum asks. Group subjects of 9 and 10 count for their own group. Choose a class to open its timetable."
          actions={<Segmented aria-label="Show" value={only} onChange={setOnly} options={[{ value: "all", label: "All classes" }, { value: "short", label: "Needs attention" }]} />}
        >
          <div className="tt-matrix-wrap">
            <table className="tt-matrix">
              <caption className="mtb-sr-only">Periods placed against periods needed for each class and subject</caption>
              <thead>
                <tr>
                  <th className="tt-sticky" scope="col">
                    Class
                  </th>
                  {subjectIds.map((id) => (
                    <th key={id} scope="col" title={idx.subject(id).name}>
                      {idx.subject(id).short}
                    </th>
                  ))}
                  <th scope="col">Placed</th>
                  <th scope="col">Free periods</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={r.s.classSection} style={{ "--i": i } as CSSProperties}>
                    <th scope="row" className="tt-sticky">
                      <button type="button" className="border-0 bg-transparent p-0 font-medium text-brand-ink underline-offset-2 hover:underline" style={{ font: "inherit", cursor: "pointer" }} onClick={() => void navigate({ to: "/timetable", search: (p: Record<string, unknown>) => ({ ...p, cls: r.s.classSection, view: "class" }) } as never)}>
                        {r.s.classSection}
                      </button>
                    </th>
                    {subjectIds.map((id) => {
                      const req = r.s.requirements.find((x) => x.subjectId === id);
                      if (!req) return <td key={id} className="none">·</td>;
                      const n = r.placed.get(reqKey(id, req.stream)) ?? 0;
                      return (
                        <td key={id} className={n < req.periodsPerWeek ? "short" : n > req.periodsPerWeek ? "over" : "ok"} title={`${idx.subject(id).name}${req.stream ? ` (${req.stream} group)` : ""}: ${n} of ${req.periodsPerWeek}${req.teacherId ? ` · ${idx.teacher(req.teacherId)?.name}` : " · no teacher allotted"}`}>
                          {n}/{req.periodsPerWeek}
                          {req.stream && <span className="block text-small font-normal">{streamTag(req.stream)}</span>}
                        </td>
                      );
                    })}
                    <td className={r.short ? "short" : "ok"}>
                      {r.need - r.short}/{r.need}
                    </td>
                    <td>{r.week - r.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel id="tt-load" rise={2} flush title="Teaching load from the timetable" description="Periods each teacher actually has this week. Setup › Teachers shows the load from subject allotments; this shows what is timetabled.">
          <DataTable caption="Teaching load" rowKey="id" rows={[...loads].sort((a, b) => b.n - a.n)} columns={columns} maxHeight={460} />
        </Panel>
      </RequireSingleCampus>
    </TimetableShell>
  );
}
