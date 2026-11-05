import { clockTime, newIdempotencyKey, periodsOn, TIMETABLE_DAYS, timetableApi, timetableQueries, type CampusCode, type TimetableBoard, type TimetableCover, type TimetableCoverDay, type TimetableDay, type TimetableSlot } from "@mtb/api";
import { formatCount, formatDate, formatLongDate, formatTime, type IsoDate } from "@mtb/domain";
import { AnimatedNumber, Avatar, Banner, Button, Combobox, DataTable, DatePicker, EmptyState, Panel, Select, SidePanel, Skeleton, StatCard, StatusBadge, Textarea, useToast, type Column } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type CSSProperties } from "react";
import { RequireSingleCampus } from "../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import { dayLong, errorText, freeTeachers, PrintArea, printSoon, QueryError, TimetableShell, TODAY, useBoard, useBoardIndex, useCanEdit, type BoardIndex } from "./shared";
import { TeacherTextsDialog } from "./TeacherTextsDialog";

const REASONS = ["Casual leave", "Sick leave", "Training", "Exam duty", "Official visit", "Late arrival"];

interface Need {
  slot: TimetableSlot;
  cover?: TimetableCover;
}

function CoverPicker({ board, idx, day, date, need, cover, onClose }: { board: TimetableBoard; idx: BoardIndex; day: TimetableDay; date: IsoDate; need: Need; cover: TimetableCoverDay; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const [key] = useState(newIdempotencyKey);
  const [note, setNote] = useState("");
  const list = freeTeachers(board, day, need.slot.period, { subjectId: need.slot.subjectId, away: cover.away.map((a) => a.teacherId), covers: cover.covers, classSection: need.slot.classSection });
  const assign = useMutation({
    mutationFn: (substituteId: string) => timetableApi.assignCover({ campus: ctx.campus as CampusCode, session: ctx.session, date, slotId: need.slot.id, substituteId, ...(note.trim() ? { note: note.trim() } : {}) }, key),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: timetableQueries.cover(ctx, date).queryKey });
      toast({ title: `${c.substituteName} covers ${c.classSection}`, message: `Period ${c.period} on ${formatDate(date)}. It shows in their teacher app now.` });
      onClose();
    },
  });
  const time = idx.timeOf(day, need.slot.period, need.slot.classSection);
  return (
    <SidePanel
      open
      onClose={onClose}
      title={`Cover for ${need.slot.classSection}, period ${need.slot.period}`}
      description={`${idx.subject(need.slot.subjectId).name}${time ? ` · ${clockTime(time.start)} to ${clockTime(time.end)}` : ""} · ${idx.teacher(need.slot.teacherId)?.name} is away`}
    >
      <div className="grid gap-4">
        <p className="m-0 text-small text-ink-muted">Teachers free in this period. Those who teach the subject and have the lightest day come first.</p>
        {list.length === 0 ? (
          <EmptyState icon="user" title="Nobody is free in this period" description="Every teacher is teaching or covering. Combine the class with its parallel section, or ask the principal." />
        ) : (
          <ul className="tt-list">
            {list.map((x, i) => (
              <li key={x.teacher.id} className="mtb-slide-in" style={{ "--i": Math.min(i, 12) } as CSSProperties}>
                <Avatar name={x.teacher.name} size="sm" />
                <span className="grid min-w-0">
                  <b className="font-medium text-ink">{x.teacher.name}</b>
                  <span className="flex flex-wrap gap-1 text-small text-ink-muted">
                    {x.qualified && <StatusBadge status="success">Teaches {idx.subject(need.slot.subjectId).short}</StatusBadge>}
                    <span>
                      {x.today} {x.today === 1 ? "period" : "periods"} on {dayLong(day)}
                      {x.covering ? ` · already covering ${x.covering}` : ""}
                    </span>
                  </span>
                </span>
                <Button size="sm" className="ml-auto" variant={i === 0 && !x.full ? "primary" : "secondary"} disabled={x.full || assign.isPending} onClick={() => assign.mutate(x.teacher.id)}>
                  {x.full ? "Day is full" : "Assign"}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Textarea label="Note for the substitute (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} help="For example: “Chapter 4 exercises are on the board.”" />
        {assign.isError && (
          <Banner tone="danger" title="Not assigned.">
            {errorText(assign.error)}
          </Banner>
        )}
      </div>
    </SidePanel>
  );
}

function MarkAway({ board, date, away, onClose }: { board: TimetableBoard; date: IsoDate; away: string[]; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const [teacherId, setTeacherId] = useState<string | null>(null);
  const [reason, setReason] = useState(REASONS[0]!);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => timetableApi.markAway({ campus: ctx.campus as CampusCode, session: ctx.session, date, teacherId: teacherId!, reason }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: timetableQueries.cover(ctx, date).queryKey });
      const t = board.teachers.find((x) => x.id === teacherId);
      toast({ title: `${t?.name} marked away`, message: "Their periods are listed below for cover." });
      onClose();
    },
    onError: (e) => setError(errorText(e)),
  });
  return (
    <SidePanel
      open
      onClose={onClose}
      title="Mark a teacher away"
      description={`${formatLongDate(date)}. Leave approved in HR appears here by itself.`}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="check" disabled={!teacherId} loading={save.isPending} onClick={() => save.mutate()}>
            Mark away
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Combobox
          label="Teacher"
          required
          value={teacherId}
          onValueChange={setTeacherId}
          options={board.teachers.filter((t) => !away.includes(t.id)).map((t) => ({ value: t.id, label: t.name, hint: `${board.slots.filter((s) => s.teacherId === t.id).length} a week` }))}
          placeholder="Choose a teacher"
        />
        <Select label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} options={REASONS} />
        {error && (
          <Banner tone="danger" title="Not saved.">
            {error}
          </Banner>
        )}
      </div>
    </SidePanel>
  );
}

/** Teachers away on a day, their periods that need cover, the free-period finder, and the printed cover list. */
export function SubstitutionsPage({ date, onDate }: { date: IsoDate | undefined; onDate: (d: IsoDate | undefined) => void }) {
  const ctx = useCtx();
  const qc = useQueryClient();
  const toast = useToast();
  const readOnly = useReadOnly();
  const canEdit = useCanEdit();
  const canText = useCan("sms.send") && !readOnly;
  const [texting, setTexting] = useState(false);
  const b = useBoard();
  const board = b.data;
  const idx = useBoardIndex(board);
  const day = date ?? TODAY;
  const c = useQuery({ ...timetableQueries.cover(ctx, day), enabled: ctx.campus !== "ALL" && !readOnly });
  const cover = c.data;
  const [picking, setPicking] = useState<Need | null>(null);
  const [marking, setMarking] = useState(false);
  const wd = (cover?.day ?? null) as TimetableDay | null;
  const [finderDay, setFinderDay] = useState<TimetableDay | null>(null);
  const [finderPeriod, setFinderPeriod] = useState(1);
  const fDay = (finderDay ?? wd ?? 3) as TimetableDay;

  const remove = useMutation({
    mutationFn: (id: string) => timetableApi.removeCover(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: timetableQueries.cover(ctx, day).queryKey });
      toast({ tone: "info", title: "Cover removed", message: "The period is open again." });
    },
  });
  const clearAway = useMutation({
    mutationFn: (teacherId: string) => timetableApi.clearAway({ campus: ctx.campus as CampusCode, session: ctx.session, date: day, teacherId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: timetableQueries.cover(ctx, day).queryKey });
      toast({ tone: "info", title: "Marked present again", message: "Their cover was removed." });
    },
    onError: (e) => toast({ tone: "danger", title: "Not changed", message: errorText(e) }),
  });

  const header = (
    <div className="flex flex-wrap items-end gap-2">
      {day !== TODAY && (
        <Button size="sm" variant="quiet" onClick={() => onDate(undefined)}>
          Today
        </Button>
      )}
      <div className="w-44">
        <DatePicker aria-label="Day" value={day} today={TODAY} minDate="2026-04-01" maxDate="2026-12-31" onValueChange={(d) => onDate(d && d !== TODAY ? d : undefined)} />
      </div>
      <Button icon="printer" disabled={!cover || !wd} onClick={printSoon}>
        Print cover list
      </Button>
      {canText && day >= TODAY && (
        <Button icon="message" disabled={!cover || !wd || !!cover.closed} onClick={() => setTexting(true)}>
          Text teachers their day
        </Button>
      )}
    </div>
  );

  if (readOnly) {
    return (
      <TimetableShell title="Cover for absent teachers">
        <div className="mtb-card">
          <EmptyState icon="lock" title="Cover is arranged in the current session" description="Switch to the current session to see who is away and who covers." />
        </div>
      </TimetableShell>
    );
  }

  const awayIds = cover?.away.map((a) => a.teacherId) ?? [];
  const needs: Need[] =
    board && wd
      ? board.slots
          .filter((s) => s.day === wd && s.teacherId && awayIds.includes(s.teacherId))
          .sort((a, x) => a.period - x.period || a.classSection.localeCompare(x.classSection))
          .map((slot) => {
            const cv = cover?.covers.find((x) => x.slotId === slot.id);
            return cv ? { slot, cover: cv } : { slot };
          })
      : [];
  const covered = needs.filter((n) => n.cover).length;
  const finder = board ? freeTeachers(board, fDay, finderPeriod, { away: fDay === wd ? awayIds : [], covers: fDay === wd ? (cover?.covers ?? []) : [] }) : [];

  const columns: Array<Column<Need & { id: string }>> = idx
    ? [
        {
          key: "period",
          header: "Period",
          width: 130,
          render: (n) => {
            const t = wd ? idx.timeOf(wd, n.slot.period, n.slot.classSection) : undefined;
            return (
              <span className="grid">
                <span className="mtb-cell-primary">Period {n.slot.period}</span>
                <span className="mtb-cell-secondary mtb-num">{t ? clockTime(t.start) : ""}</span>
              </span>
            );
          },
        },
        { key: "class", header: "Class", width: 110, render: (n) => <span className="mtb-cell-primary">{n.slot.classSection}</span> },
        { key: "subject", header: "Subject", render: (n) => idx.subject(n.slot.subjectId).name },
        { key: "away", header: "Teacher away", render: (n) => idx.teacher(n.slot.teacherId)?.name },
        {
          key: "cover",
          header: "Cover",
          width: 260,
          render: (n) =>
            n.cover ? (
              <span className="flex flex-wrap items-center gap-2">
                <StatusBadge status="approved">{n.cover.substituteName}</StatusBadge>
                {canEdit && day >= TODAY && (
                  <Button size="sm" variant="quiet" onClick={() => remove.mutate(n.cover!.id)} disabled={remove.isPending}>
                    Remove
                  </Button>
                )}
              </span>
            ) : canEdit && day >= TODAY ? (
              <Button size="sm" variant="primary" icon="user" onClick={() => setPicking(n)}>
                Choose cover
              </Button>
            ) : (
              <StatusBadge status="warning">No cover</StatusBadge>
            ),
        },
      ]
    : [];

  return (
    <TimetableShell title="Cover for absent teachers" meta={<span className="text-small text-ink-muted">{formatLongDate(day)} · {campusLabel(ctx.campus)}</span>} actions={header}>
      <RequireSingleCampus action="cover for absent teachers">
        {(b.isError || c.isError) && <QueryError what="Cover" error={b.error ?? c.error} onRetry={() => void (b.refetch(), c.refetch())} />}
        {!board || !idx || !cover ? (
          <Skeleton height={420} />
        ) : cover.closed || !wd ? (
          <div className="mtb-card">
            <EmptyState icon="calendar" title={`No school on ${formatLongDate(day)}${cover.closed ? ` — ${cover.closed.name}` : ""}`} description="No cover is needed. Choose another day." />
          </div>
        ) : (
          <>
            <div className="tt-kpis">
              <div style={{ "--i": 0 } as CSSProperties}>
                <StatCard label="Teachers away" icon="user" tone={cover.away.length ? "warning" : "neutral"} value={<AnimatedNumber value={cover.away.length} format={formatCount} />} foot={cover.away.map((a) => a.name).join(", ") || "Everyone is in"} />
              </div>
              <div style={{ "--i": 1 } as CSSProperties}>
                <StatCard label="Periods to cover" icon="clock" value={<AnimatedNumber value={needs.length} format={formatCount} />} foot={dayLong(wd)} />
              </div>
              <div style={{ "--i": 2 } as CSSProperties}>
                <StatCard label="Covered" icon="checkCircle" value={<AnimatedNumber value={covered} format={formatCount} />} meter={needs.length ? (covered / needs.length) * 100 : 100} meterLabel="Covered" foot={`${needs.length - covered} still open`} />
              </div>
              <div style={{ "--i": 3 } as CSSProperties}>
                <StatCard label="Periods in the day" icon="calendar" tone="info" value={formatCount(periodsOn(board.schedule, wd))} foot={`School closes ${clockTime((wd === 5 ? board.friday : board.normal).offTime)}`} />
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <Panel id="tt-needs" rise={1} flush title="Periods that need cover" description={needs.length ? `${needs.length - covered} of ${needs.length} still need a teacher.` : "Nobody is away, so every class has its own teacher."}>
                <DataTable caption="Periods that need cover" rowKey="id" rows={needs.map((n) => ({ ...n, id: n.slot.id }))} columns={columns} empty={<EmptyState icon="checkCircle" title="Nothing to cover" description="Mark a teacher away to list their periods." />} />
              </Panel>
              <div className="grid content-start gap-6">
                <Panel
                  id="tt-away"
                  rise={2}
                  title="Away today"
                  description="Leave approved in HR shows here by itself."
                  actions={
                    canEdit && day >= TODAY ? (
                      <Button size="sm" icon="plus" onClick={() => setMarking(true)}>
                        Mark away
                      </Button>
                    ) : undefined
                  }
                >
                  {cover.away.length === 0 ? (
                    <EmptyState icon="user" title="Everyone is in" />
                  ) : (
                    <ul className="tt-list">
                      {cover.away.map((a) => (
                        <li key={a.teacherId}>
                          <Avatar name={a.name} size="sm" />
                          <span className="grid min-w-0">
                            <b className="font-medium text-ink">{a.name}</b>
                            <span className="text-small text-ink-muted">
                              {a.reason} · {a.source === "HR" ? "from HR" : `marked by ${a.markedBy}`} · {formatTime(a.markedAt)}
                            </span>
                          </span>
                          {a.source === "Office" && canEdit && day >= TODAY ? (
                            <Button size="sm" variant="quiet" className="ml-auto" onClick={() => clearAway.mutate(a.teacherId)} disabled={clearAway.isPending}>
                              In after all
                            </Button>
                          ) : (
                            <StatusBadge status="info" className="ml-auto">
                              {a.source}
                            </StatusBadge>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
                <Panel id="tt-finder" rise={3} title="Who is free?" description="Find a free teacher in any period, for cover or a meeting.">
                  <div className="grid grid-cols-2 gap-3">
                    <Select aria-label="Day" value={String(fDay)} onChange={(e) => setFinderDay(Number(e.target.value) as TimetableDay)} options={TIMETABLE_DAYS.map((d) => ({ value: String(d.day), label: d.long }))} />
                    <Select aria-label="Period" value={String(finderPeriod)} onChange={(e) => setFinderPeriod(Number(e.target.value))} options={Array.from({ length: periodsOn(board.schedule, fDay) }, (_, i) => ({ value: String(i + 1), label: `Period ${i + 1}` }))} />
                  </div>
                  <ul className="tt-list mt-3">
                    {finder.slice(0, 8).map((x) => (
                      <li key={x.teacher.id}>
                        <span className="grid min-w-0">
                          <b className="font-medium text-ink">{x.teacher.name}</b>
                          <span className="text-small text-ink-muted">
                            {x.today} {x.today === 1 ? "period" : "periods"} that day
                          </span>
                        </span>
                      </li>
                    ))}
                    {finder.length > 8 && <li className="text-small text-ink-muted">…and {finder.length - 8} more</li>}
                    {finder.length === 0 && <li className="text-small text-ink-muted">Nobody is free in this period.</li>}
                  </ul>
                </Panel>
              </div>
            </div>

            <PrintArea>
              <div className="tt-print-page">
                <style>{"@page { size: A4 portrait; margin: 12mm; }"}</style>
                <header className="tt-print-head">
                  <div>
                    <div style={{ fontSize: "9pt", fontWeight: 600 }}>MTB Schools &amp; Colleges · {campusLabel(ctx.campus)}</div>
                    <h1>Cover list · {formatLongDate(day)}</h1>
                    <div>Away: {cover.away.map((a) => `${a.name} (${a.reason})`).join(", ") || "nobody"}</div>
                  </div>
                </header>
                <table>
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th>Time</th>
                      <th className="l">Class</th>
                      <th className="l">Subject</th>
                      <th className="l">Teacher away</th>
                      <th className="l">Covered by</th>
                      <th className="l">Signature</th>
                    </tr>
                  </thead>
                  <tbody>
                    {needs.map((n) => {
                      const t = idx.timeOf(wd, n.slot.period, n.slot.classSection);
                      return (
                        <tr key={n.slot.id}>
                          <td>{n.slot.period}</td>
                          <td>{t ? clockTime(t.start) : ""}</td>
                          <td className="l">{n.slot.classSection}</td>
                          <td className="l">{idx.subject(n.slot.subjectId).name}</td>
                          <td className="l">{idx.teacher(n.slot.teacherId)?.name}</td>
                          <td className="l">{n.cover?.substituteName ?? ""}</td>
                          <td className="l" style={{ width: "90pt" }} />
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </PrintArea>

            {picking && <CoverPicker board={board} idx={idx} day={wd} date={day} need={picking} cover={cover} onClose={() => setPicking(null)} />}
            {marking && <MarkAway board={board} date={day} away={awayIds} onClose={() => setMarking(false)} />}
            {texting && <TeacherTextsDialog date={day} preselect={[...new Set(cover.covers.map((x) => x.substituteId))]} onClose={() => setTexting(false)} />}
          </>
        )}
      </RequireSingleCampus>
    </TimetableShell>
  );
}
