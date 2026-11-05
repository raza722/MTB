import { ApiError, CLASH_LABEL, clockTime, findTimetableClashes, periodTime, streamShort, timetableApi, timetableQueries, type CampusCode, type TimetableBoard, type TimetableClashDetails, type TimetableDay, type TimetableSection, type TimetableSlot } from "@mtb/api";
import { Banner, Button, Combobox, Select, SidePanel, StatusBadge, Textarea, useToast } from "@mtb/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useCtx } from "../../app/session";
import { cellSlots, dayLong, errorText } from "./shared";

const LABS: Record<string, (cs: string) => string | null> = {
  cmp: () => "Computer lab",
  phy: (cs) => (cs.startsWith("9-") || cs.startsWith("10-") ? "Physics lab" : null),
  che: (cs) => (cs.startsWith("9-") || cs.startsWith("10-") ? "Chemistry lab" : null),
  bio: (cs) => (cs.startsWith("9-") || cs.startsWith("10-") ? "Biology lab" : null),
};

export interface SlotTarget {
  section: TimetableSection;
  day: TimetableDay;
  period: number;
  /** The group chosen in a split period; null or missing for the whole class. */
  stream?: string | null;
}

/**
 * One period of a class: group (when the class has groups), subject, teacher and room. Clashes are checked while you
 * choose (teacher in two places, room double-booked, over the weekly maximum), using the same rules the server applies
 * when you save. A whole-class lesson takes every group; a group lesson leaves the other group's period free.
 */
export function SlotEditor({ board, target, onClose }: { board: TimetableBoard; target: SlotTarget; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const { section, day, period } = target;
  const inCell = cellSlots(board, section.classSection, day, period);
  const [stream, setStream] = useState<string | null>(target.stream ?? inCell.find((s) => !s.stream)?.stream ?? (inCell.length && inCell.every((s) => s.stream) ? (inCell[0]!.stream ?? null) : null));
  const existing = inCell.find((s) => (s.stream ?? null) === stream);
  const others = useMemo(() => board.slots.filter((s) => s !== existing), [board.slots, existing]);
  const reqs = section.requirements.filter((r) => (r.stream ?? null) === stream);
  const placedOf = (subjectId: string) => others.filter((s) => s.classSection === section.classSection && s.subjectId === subjectId && (s.stream ?? null) === stream).length;
  const firstReq = reqs.find((r) => placedOf(r.subjectId) < r.periodsPerWeek) ?? reqs[0];
  const [subjectId, setSubjectId] = useState(existing?.subjectId ?? firstReq?.subjectId ?? "");
  const req = reqs.find((r) => r.subjectId === subjectId);
  const [teacherId, setTeacherId] = useState<string | null>(existing?.teacherId ?? req?.teacherId ?? null);
  const [room, setRoom] = useState(existing?.room ?? LABS[subjectId]?.(section.classSection) ?? section.room);
  const [reason, setReason] = useState(existing?.override?.reason ?? "");
  const [serverError, setServerError] = useState<string | null>(null);
  const time = periodTime(board, section.classSection, day, period);
  const subjectName = (id: string) => board.subjects.find((s) => s.id === id)?.name ?? id;

  // The other lessons in this period: a whole-class lesson can't sit beside group lessons, and the other way round.
  const blockingCell = stream ? inCell.filter((s) => !s.stream) : inCell.filter((s) => s.stream);

  const pickStream = (next: string | null) => {
    setStream(next);
    const ex = inCell.find((s) => (s.stream ?? null) === next);
    const list = section.requirements.filter((r) => (r.stream ?? null) === next);
    const r = ex ? list.find((x) => x.subjectId === ex.subjectId) : (list.find((x) => others.filter((s) => s.classSection === section.classSection && s.subjectId === x.subjectId && (s.stream ?? null) === next).length < x.periodsPerWeek) ?? list[0]);
    setSubjectId(ex?.subjectId ?? r?.subjectId ?? "");
    setTeacherId(ex?.teacherId ?? r?.teacherId ?? null);
    setRoom(ex?.room ?? (r ? (LABS[r.subjectId]?.(section.classSection) ?? section.room) : section.room));
    setReason(ex?.override?.reason ?? "");
    setServerError(null);
  };

  const draftSlot: TimetableSlot | null = subjectId && teacherId ? { id: "draft", classSection: section.classSection, stream, day, period, subjectId, teacherId, room } : null;
  const clashes = draftSlot ? findTimetableClashes({ ...board, slots: [...others.filter((s) => !blockingCell.includes(s)), draftSlot] }).filter((c) => c.slotIds.includes("draft")) : [];
  const blocking = clashes.filter((c) => c.severity === "BLOCK");

  const teacherOptions = useMemo(() => {
    const load = (id: string) => others.filter((s) => s.teacherId === id).length;
    const mine = periodTime(board, section.classSection, day, period);
    const sameTime = (s: TimetableSlot) => {
      if (s.day !== day) return false;
      const t = periodTime(board, s.classSection, s.day, s.period);
      if (!mine || !t) return s.period === period;
      return t.start < mine.end && mine.start < t.end;
    };
    return [...board.teachers]
      .map((t) => {
        const busy = others.find((s) => s.teacherId === t.id && sameTime(s));
        const qualified = t.subjectIds.includes(subjectId);
        const allotted = req?.teacherId === t.id;
        const hint = busy ? `Busy: ${busy.stream ? `${busy.classSection} ${streamShort(busy.stream)}` : busy.classSection}` : load(t.id) >= t.maxPerWeek ? `Full: ${load(t.id)} a week` : `Free · ${load(t.id)} a week`;
        return { t, busy: !!busy, qualified, allotted, hint };
      })
      .sort((a, b) => Number(b.allotted) - Number(a.allotted) || Number(a.busy) - Number(b.busy) || Number(b.qualified) - Number(a.qualified) || a.t.name.localeCompare(b.t.name))
      .map((x) => ({ value: x.t.id, label: `${x.t.name}${x.allotted ? " (allotted)" : x.qualified ? "" : " · not set up for this subject"}`, hint: x.hint, keywords: [x.t.name] }));
  }, [board, others, day, period, subjectId, req?.teacherId, section.classSection]);

  const save = useMutation({
    mutationFn: (clear: boolean) =>
      timetableApi.saveSlot({
        campus: ctx.campus as CampusCode,
        session: ctx.session,
        classSection: section.classSection,
        stream,
        day,
        period,
        subjectId: clear ? null : subjectId,
        teacherId: clear ? null : teacherId,
        room,
        ...(blocking.length && reason.trim() ? { overrideReason: reason.trim() } : {}),
      }),
    onSuccess: (r, clear) => {
      void qc.invalidateQueries({ queryKey: timetableQueries.board(ctx).queryKey });
      const t = board.teachers.find((x) => x.id === teacherId);
      const who = stream ? `${section.classSection} ${streamShort(stream)}` : section.classSection;
      toast({ title: `${who} · ${dayLong(day)} period ${period} ${clear ? "cleared" : "saved"}`, message: clear ? (stream ? "This group's period is free now." : "The period is free now.") : `${subjectName(subjectId)} with ${t?.name ?? "—"}${r.slot?.override ? ". The clash is kept with your reason." : "."}` });
      onClose();
    },
    onError: (e) => {
      const d = e instanceof ApiError && e.code === "TIMETABLE_CLASH" ? (e.details as TimetableClashDetails | undefined) : undefined;
      setServerError(d?.clashes?.length ? `${errorText(e)} (${d.clashes.length} ${d.clashes.length === 1 ? "clash" : "clashes"})` : errorText(e));
    },
  });

  const needReason = blocking.length > 0;
  const reasonOk = !needReason || reason.trim().length >= 5;
  const cellBlocked = blockingCell.length > 0;

  return (
    <SidePanel
      open
      onClose={onClose}
      title={`${section.classSection} · ${dayLong(day)}, period ${period}`}
      description={time ? `${clockTime(time.start)} to ${clockTime(time.end)}${inCell.length ? ` · now ${inCell.map((s) => (s.stream ? `${streamShort(s.stream)}: ${subjectName(s.subjectId)}` : subjectName(s.subjectId))).join(", ")}` : " · free period"}` : undefined}
      footer={
        <>
          {existing ? (
            <Button variant="danger-quiet" icon="trash" onClick={() => save.mutate(true)} disabled={save.isPending}>
              {stream ? "Clear this group" : "Clear period"}
            </Button>
          ) : (
            <Button variant="quiet" onClick={onClose}>
              Cancel
            </Button>
          )}
          <Button variant="primary" icon="check" loading={save.isPending} loadingLabel="Saving…" disabled={!subjectId || !teacherId || !reasonOk || cellBlocked} onClick={() => save.mutate(false)}>
            {needReason ? "Keep with reason" : "Save"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {section.streams.length > 0 && (
          <Select
            label="Group"
            value={stream ?? ""}
            onChange={(e) => pickStream(e.target.value || null)}
            options={[{ value: "", label: "Whole class" }, ...section.streams.map((s) => ({ value: s, label: s }))]}
            help="Group subjects (for example Biology and Computer Science) are taught to each group in the same period."
          />
        )}
        {cellBlocked && (
          <Banner tone="warning" title={stream ? "The whole class has a lesson in this period." : "This period is split between groups."}>
            {stream
              ? `Clear ${subjectName(blockingCell[0]!.subjectId)} (whole class) first, then add a lesson for each group.`
              : `${blockingCell.map((s) => `${streamShort(s.stream ?? "")}: ${subjectName(s.subjectId)}`).join(", ")}. Clear the group lessons first, or choose a group above.`}
          </Banner>
        )}
        {reqs.length === 0 ? (
          <Banner tone="info" title="No subjects for this choice.">
            {stream ? `${stream} has no subjects of its own in Setup › Subjects.` : "Add the class's subjects in Setup › Subjects first."}
          </Banner>
        ) : (
          <Select
            label="Subject"
            required
            value={subjectId}
            onChange={(e) => {
              const id = e.target.value;
              setSubjectId(id);
              const r = reqs.find((x) => x.subjectId === id);
              if (r?.teacherId) setTeacherId(r.teacherId);
              setRoom(LABS[id]?.(section.classSection) ?? section.room);
            }}
            options={reqs.map((r) => ({ value: r.subjectId, label: `${subjectName(r.subjectId)} — ${placedOf(r.subjectId)} of ${r.periodsPerWeek} placed` }))}
            help={req && !req.teacherId ? "No teacher is allotted for this subject in Setup › Teachers. Choose one here." : undefined}
          />
        )}
        <Combobox label="Teacher" required value={teacherId} onValueChange={setTeacherId} options={teacherOptions} placeholder="Choose a teacher" searchPlaceholder="Type a name" />
        <Select label="Room" value={room} onChange={(e) => setRoom(e.target.value)} options={board.rooms.map((r) => ({ value: r, label: r === section.room ? `${r} (class room)` : r }))} />

        {!cellBlocked &&
          (clashes.length === 0 && draftSlot ? (
            <Banner tone="success" icon="checkCircle" title="No clashes.">
              The teacher and the room are free at this time.
            </Banner>
          ) : (
            clashes.map((c, i) => (
              <Banner key={i} tone={c.severity === "BLOCK" ? "danger" : "warning"} title={CLASH_LABEL[c.kind]}>
                {c.message}
              </Banner>
            ))
          ))}
        {needReason && !cellBlocked && (
          <Textarea
            label="Reason to keep this clash"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            help="Only for a real combined class or a deliberate arrangement, for example “9-A and 10-A sit the practical together”. The reason is kept with both periods."
            error={reason.trim() && reason.trim().length < 5 ? "Write at least 5 letters." : undefined}
          />
        )}
        {existing?.override && (
          <p className="m-0 text-small text-ink-muted">
            <StatusBadge status="warning">Kept on purpose</StatusBadge> {existing.override.reason} — {existing.override.by}
          </p>
        )}
        {serverError && (
          <Banner tone="danger" title="Not saved.">
            {serverError}
          </Banner>
        )}
      </div>
    </SidePanel>
  );
}

