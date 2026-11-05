import { ApiError, bellDay, clockTime, periodsInWeek, SEASON_LABEL, timetableApi, timetableQueries, toMinutes, type BellDay, type BellDayRule, type BellSchedule, type BellScheduleBody, type CampusCode, type PeriodsInUseDetails, type TimetableSeason } from "@mtb/api";
import { formatDateTime } from "@mtb/domain";
import { Banner, Button, Checkbox, ConfirmDialog, Input, Modal, Panel, Segmented, Select, Skeleton, StatusBadge, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type CSSProperties } from "react";
import { z } from "zod";
import { campusLabel } from "../../app/shell/campus";
import { RequireSingleCampus } from "../../app/shell/page";
import { useCtx } from "../../app/session";
import { errorText, QueryError, TimetableShell, useBoard, useCanEdit } from "./shared";

const rule = (label: string, maxPeriods: number) =>
  z
    .object({
      periodMins: z.number({ error: `${label}: enter minutes.` }).int().min(25, { error: `${label}: a period must be at least 25 minutes.` }).max(60, { error: `${label}: a period can be up to 60 minutes.` }),
      periods: z.number({ error: `${label}: enter the number of periods.` }).int().min(3, { error: `${label}: at least 3 periods.` }).max(maxPeriods, { error: `${label}: at most ${maxPeriods} periods.` }),
      breakAfter: z.number().int().min(1, { error: "The break comes after period 1 at the earliest." }),
      breakMins: z.number().int().min(0).max(60, { error: "The break can be up to 60 minutes." }),
    })
    .refine((r) => r.breakAfter < r.periods, { path: ["breakAfter"], error: `${label}: the break must come before the last period.` });

const isEvening = (v: { assemblyStart: string }) => /^\d{2}:\d{2}$/.test(v.assemblyStart) && toMinutes(v.assemblyStart) >= 12 * 60;

const schema = z
  .object({
    name: z.string().trim().min(3, { error: "Give the timings a name of at least 3 letters." }),
    assemblyStart: z.string().regex(/^\d{2}:\d{2}$/, { error: "Enter a time such as 07:45." }),
    assemblyMins: z.number().int().min(0).max(45, { error: "Assembly can last up to 45 minutes." }),
    firstLectureStart: z.string().nullable(),
    normal: rule("Monday to Saturday", 10),
    friday: rule("Friday", 8),
  })
  .refine((v) => toMinutes(v.assemblyStart) >= 360 && toMinutes(v.assemblyStart) <= 840, { path: ["assemblyStart"], error: "Assembly must start between 06:00 AM and 02:00 PM." })
  .refine((v) => !v.firstLectureStart || (/^\d{2}:\d{2}$/.test(v.firstLectureStart) && toMinutes(v.firstLectureStart) >= toMinutes(v.assemblyStart) + v.assemblyMins && toMinutes(v.firstLectureStart) <= toMinutes(v.assemblyStart) + v.assemblyMins + 60), {
    path: ["firstLectureStart"],
    error: "Period 1 must start after assembly ends, and within an hour of it.",
  })
  .refine((v) => isEvening(v) || toMinutes(bellDay(v, v.friday).offTime) <= toMinutes("12:30"), { path: ["friday", "periods"], error: "On Friday school must close by 12:30 PM for Jumu'ah. Shorten the periods or have fewer." })
  .refine((v) => toMinutes(bellDay(v, v.normal).offTime) <= toMinutes(isEvening(v) ? "19:00" : "15:00"), { path: ["normal", "periods"], error: "School would close too late. Shorten the periods or have fewer." });

type Draft = Omit<BellScheduleBody, "rowVer">;

const draftOf = (s: BellSchedule): Draft => ({ name: s.name, assemblyStart: s.assemblyStart, assemblyMins: s.assemblyMins, firstLectureStart: s.firstLectureStart, normal: s.normal, friday: s.friday });

function Preview({ normal, friday }: { normal: BellDay; friday: BellDay }) {
  const rows: Array<{ key: string; label: string; a: string; b: string; kind?: "break" | "off" }> = [];
  rows.push({ key: "as", label: "Assembly", a: clockTime(normal.assemblyStart), b: clockTime(friday.assemblyStart) });
  const n = Math.max(normal.periods.length, friday.periods.length);
  for (let i = 1; i <= n; i++) {
    const p = normal.periods.find((x) => x.no === i);
    const f = friday.periods.find((x) => x.no === i);
    rows.push({ key: `p${i}`, label: `Period ${i}`, a: p ? `${clockTime(p.start)} – ${clockTime(p.end)}` : "—", b: f ? `${clockTime(f.start)} – ${clockTime(f.end)}` : "—" });
    const nb = normal.breakStart && normal.periods.find((x) => x.no === i)?.end === normal.breakStart;
    const fb = friday.breakStart && friday.periods.find((x) => x.no === i)?.end === friday.breakStart;
    if (nb || fb) rows.push({ key: `b${i}`, label: "Break", a: nb ? `${clockTime(normal.breakStart!)} – ${clockTime(normal.breakEnd!)}` : "", b: fb ? `${clockTime(friday.breakStart!)} – ${clockTime(friday.breakEnd!)}` : "", kind: "break" });
  }
  rows.push({ key: "off", label: "School closes", a: clockTime(normal.offTime), b: clockTime(friday.offTime), kind: "off" });
  return (
    <table className="tt-preview">
      <caption className="mtb-sr-only">Period times for Monday to Saturday and Friday</caption>
      <thead>
        <tr>
          <th scope="col" />
          <th scope="col">Mon–Thu and Sat</th>
          <th scope="col">Friday</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.key} className={r.kind === "break" ? "is-break" : r.kind === "off" ? "is-off" : undefined} style={{ "--i": i } as CSSProperties}>
            <th scope="row">{r.label}</th>
            <td className="mtb-num">{r.a}</td>
            <td className="mtb-num">{r.b}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const num = (v: string) => (v.trim() === "" ? Number.NaN : Number(v));

function RuleFields({ title, value, onChange, errors, prefix, disabled }: { title: string; value: BellDayRule; onChange: (r: BellDayRule) => void; errors: Record<string, string>; prefix: "normal" | "friday"; disabled: boolean }) {
  const set = (k: keyof BellDayRule, v: string) => onChange({ ...value, [k]: num(v) });
  return (
    <>
      <h3>{title}</h3>
      <Input label="Minutes a period" amount inputMode="numeric" disabled={disabled} value={Number.isNaN(value.periodMins) ? "" : String(value.periodMins)} onChange={(e) => set("periodMins", e.target.value)} error={errors[`${prefix}.periodMins`]} />
      <Input label="Periods" amount inputMode="numeric" disabled={disabled} value={Number.isNaN(value.periods) ? "" : String(value.periods)} onChange={(e) => set("periods", e.target.value)} error={errors[`${prefix}.periods`]} />
      <Input label="Break after period" amount inputMode="numeric" disabled={disabled} value={Number.isNaN(value.breakAfter) ? "" : String(value.breakAfter)} onChange={(e) => set("breakAfter", e.target.value)} error={errors[`${prefix}.breakAfter`]} />
      <Input label="Break minutes" amount inputMode="numeric" disabled={disabled} value={Number.isNaN(value.breakMins) ? "" : String(value.breakMins)} onChange={(e) => set("breakMins", e.target.value)} error={errors[`${prefix}.breakMins`]} />
    </>
  );
}

/** The server's message; for lessons in periods the timings remove it names the classes to fix. */
function inUseText(e: unknown) {
  if (e instanceof ApiError && e.code === "PERIODS_IN_USE") {
    const d = e.details as PeriodsInUseDetails | undefined;
    return d && d.classes.length > 6 ? `${e.message} All classes: ${d.classes.join(", ")}.` : e.message;
  }
  return errorText(e);
}

function ScheduleEditor({ schedule, onSaved }: { schedule: BellSchedule; onSaved: () => void }) {
  const toast = useToast();
  const canEdit = useCanEdit();
  const [draft, setDraft] = useState<Draft>(draftOf(schedule));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const valid = schema.safeParse(draft);
  const ok = valid.success;
  const normal = ok ? bellDay(draft, draft.normal) : bellDay(schedule, schedule.normal);
  const friday = ok ? bellDay(draft, draft.friday) : bellDay(schedule, schedule.friday);
  const changed = JSON.stringify(draft) !== JSON.stringify(draftOf(schedule));
  const save = useMutation({
    mutationFn: () => timetableApi.saveSchedule(schedule.id, { ...draft, name: draft.name.trim(), firstLectureStart: draft.firstLectureStart || null, rowVer: schedule.rowVer }),
    onSuccess: (s) => {
      toast({ title: `${s.name} saved`, message: `School closes at ${clockTime(bellDay(s, s.normal).offTime)} (Friday ${clockTime(bellDay(s, s.friday).offTime)}). ${s.active ? `${s.sections.length} ${s.sections.length === 1 ? "class follows" : "classes follow"} these times now.` : ""}` });
      onSaved();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.field) setErrors({ [e.field]: e.message });
    },
  });
  const conflict = save.error instanceof ApiError && save.error.code === "CONCURRENCY";
  const submit = () => {
    if (!valid.success) {
      const next: Record<string, string> = {};
      for (const i of valid.error.issues) next[i.path.join(".")] ??= i.message;
      setErrors(next);
      return;
    }
    setErrors({});
    save.mutate();
  };
  const disabled = !canEdit;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="grid gap-4">
        <div className="tt-form">
          <h3>Name and assembly</h3>
          <Input label="Name" disabled={disabled} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} error={errors.name} />
          <Input label="Assembly starts" type="time" disabled={disabled} value={draft.assemblyStart} onChange={(e) => setDraft({ ...draft, assemblyStart: e.target.value })} error={errors.assemblyStart} />
          <Input label="Assembly minutes" amount inputMode="numeric" disabled={disabled} value={Number.isNaN(draft.assemblyMins) ? "" : String(draft.assemblyMins)} onChange={(e) => setDraft({ ...draft, assemblyMins: num(e.target.value) })} error={errors.assemblyMins} />
          <Input
            label="Period 1 starts"
            type="time"
            disabled={disabled}
            value={draft.firstLectureStart ?? ""}
            onChange={(e) => setDraft({ ...draft, firstLectureStart: e.target.value || null })}
            {...(errors.firstLectureStart ? { error: errors.firstLectureStart } : { help: "Leave empty to start straight after assembly." })}
          />
          <RuleFields title="Monday to Thursday and Saturday" prefix="normal" value={draft.normal} onChange={(normalRule) => setDraft({ ...draft, normal: normalRule })} errors={errors} disabled={disabled} />
          <RuleFields title={isEvening(draft) ? "Friday" : "Friday (short day)"} prefix="friday" value={draft.friday} onChange={(fridayRule) => setDraft({ ...draft, friday: fridayRule })} errors={errors} disabled={disabled} />
        </div>
        {!ok && changed && (
          <Banner tone="warning" title="These timings don't work yet.">
            {valid.error.issues[0]?.message}
          </Banner>
        )}
        {conflict ? (
          <Banner
            tone="warning"
            title="Not saved: someone else changed these timings."
            actions={
              <Button size="sm" variant="secondary" icon="refresh" onClick={onSaved}>
                Reload
              </Button>
            }
          >
            {errorText(save.error)}
          </Banner>
        ) : (
          save.isError &&
          !(save.error instanceof ApiError && save.error.field) && (
            <Banner tone="danger" title="Not saved.">
              {inUseText(save.error)}
            </Banner>
          )
        )}
        {canEdit && (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" icon="check" disabled={!changed} loading={save.isPending} loadingLabel="Saving…" onClick={submit}>
              Save timings
            </Button>
            {changed && (
              <Button variant="quiet" onClick={() => setDraft(draftOf(schedule))}>
                Undo changes
              </Button>
            )}
            <span className="text-small text-ink-muted">
              {periodsInWeek(draft)} periods a week · last saved by {schedule.updatedBy}, {formatDateTime(schedule.updatedAt)}
            </span>
          </div>
        )}
      </div>
      <div className="grid content-start gap-2">
        <span className="text-small font-medium text-ink">{ok ? "How the day runs" : "Saved times (fix the fields to preview)"}</span>
        <Preview normal={normal} friday={friday} />
      </div>
    </div>
  );
}

/** Which classes follow these timings: a multi-select with Check all, as on the old Classes Timing Info screen. */
function SectionPicker({ schedule, all, onSaved }: { schedule: BellSchedule; all: BellSchedule[]; onSaved: () => void }) {
  const toast = useToast();
  const canEdit = useCanEdit();
  const board = useBoard();
  const labels = board.data?.sections.map((s) => s.classSection) ?? [];
  const levels = board.data ? [...new Map(board.data.sections.map((s) => [s.levelId, s.level])).entries()] : [];
  const [picked, setPicked] = useState<Set<string>>(new Set(schedule.sections));
  const [level, setLevel] = useState("");
  const shown = labels.filter((l) => !level || board.data?.sections.find((s) => s.classSection === l)?.levelId === level);
  const elsewhere = (l: string) => all.find((s) => s.id !== schedule.id && s.season === schedule.season && s.sections.includes(l));
  const changed = [...picked].sort().join() !== [...schedule.sections].sort().join();
  const save = useMutation({
    mutationFn: () => timetableApi.assignSections(schedule.id, { sections: [...picked], rowVer: schedule.rowVer }),
    onSuccess: (list) => {
      const mine = list.find((s) => s.id === schedule.id);
      toast({ title: `${schedule.name}: ${mine?.sections.length ?? picked.size} classes`, message: schedule.active ? "Their timetables, slips and the teacher app show these times now." : "They follow these times when the season is switched." });
      onSaved();
    },
  });
  const toggle = (l: string) => setPicked((p) => (p.has(l) ? new Set([...p].filter((x) => x !== l)) : new Set([...p, l])));
  const allShown = shown.length > 0 && shown.every((l) => picked.has(l));
  const someShown = shown.some((l) => picked.has(l));
  if (board.isError) return <QueryError what="The class list" error={board.error} onRetry={() => void board.refetch()} />;
  if (!board.data) return <Skeleton height={160} />;
  const readOnly = !canEdit;
  return (
    <div className="grid gap-4">
      {schedule.main ? (
        <p className="m-0 text-small text-ink-muted">
          The main timings: every class not put on other timings follows them ({schedule.sections.length} now). To move a class onto other timings, open those timings and tick it there. Ticking a class here brings it back from other timings.
        </p>
      ) : (
        <p className="m-0 text-small text-ink-muted">Tick the classes that follow these timings. A class can follow one set of timings a season; ticking it here moves it off its other timings.</p>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <Select label="Class level" value={level} onChange={(e) => setLevel(e.target.value)} options={[{ value: "", label: "All levels" }, ...levels.map(([value, label]) => ({ value, label }))]} />
        <Checkbox label="Check all" disabled={readOnly || shown.length === 0} checked={allShown} indeterminate={someShown && !allShown} onChange={(e) => setPicked((p) => (e.target.checked ? new Set([...p, ...shown]) : new Set([...p].filter((x) => !shown.includes(x)))))} />
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
        {shown.map((l) => {
          const other = elsewhere(l);
          const locked = schedule.main && !other;
          return (
            <Checkbox
              key={l}
              disabled={readOnly || locked}
              checked={picked.has(l)}
              onChange={() => toggle(l)}
              label={
                <span>
                  {l}
                  {other && !picked.has(l) && <span className="block text-small text-ink-muted">on {other.name}</span>}
                </span>
              }
            />
          );
        })}
      </div>
      {save.isError && (
        <Banner
          tone={save.error instanceof ApiError && save.error.code === "CONCURRENCY" ? "warning" : "danger"}
          title="Classes not moved."
          {...(save.error instanceof ApiError && save.error.code === "CONCURRENCY"
            ? {
                actions: (
                  <Button size="sm" variant="secondary" icon="refresh" onClick={onSaved}>
                    Reload
                  </Button>
                ),
              }
            : {})}
        >
          {inUseText(save.error)}
        </Banner>
      )}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" icon="check" disabled={!changed} loading={save.isPending} loadingLabel="Saving…" onClick={() => save.mutate()}>
            Save classes
          </Button>
          {changed && (
            <Button variant="quiet" onClick={() => setPicked(new Set(schedule.sections))}>
              Undo
            </Button>
          )}
          <span className="text-small text-ink-muted">{picked.size} ticked</span>
        </div>
      )}
    </div>
  );
}

const newSchema = z.object({ name: z.string().trim().min(3, { error: "Give the timings a name of at least 3 letters, for example “Evening shift”." }) });

function NewScheduleModal({ season, list, onClose, onDone }: { season: TimetableSeason; list: BellSchedule[]; onClose: () => void; onDone: (id: string | null) => void }) {
  const ctx = useCtx();
  const [name, setName] = useState("");
  const [copyFrom, setCopyFrom] = useState(list.find((s) => s.season === season && s.main)?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => timetableApi.createSchedule({ campus: ctx.campus as CampusCode, session: ctx.session, season, name: name.trim(), copyFrom: copyFrom || null }),
    onSuccess: (all) => onDone(all.find((s) => s.season === season && s.name.toLowerCase() === name.trim().toLowerCase())?.id ?? null),
    onError: (e) => setError(e instanceof ApiError && e.field === "name" ? e.message : null),
  });
  const submit = () => {
    const v = newSchema.safeParse({ name });
    if (!v.success) {
      setError(v.error.issues[0]?.message ?? "Enter a name.");
      return;
    }
    setError(null);
    create.mutate();
  };
  return (
    <Modal
      open
      onClose={() => !create.isPending && onClose()}
      title={`New ${SEASON_LABEL[season].toLowerCase()}`}
      description="For classes that keep different hours: seniors with more periods, an evening shift, or a later break."
      footer={
        <>
          <Button variant="quiet" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button variant="primary" icon="plus" loading={create.isPending} loadingLabel="Creating…" onClick={submit}>
            Create timings
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Input label="Name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Evening shift" {...(error ? { error } : {})} />
        <Select label="Start from a copy of" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} options={list.map((s) => ({ value: s.id, label: `${s.name} (${SEASON_LABEL[s.season].toLowerCase()})` }))} help="You can change every time after creating it, then tick the classes that follow it." />
        {create.isError && !error && (
          <Banner tone="danger" title="Not created.">
            {errorText(create.error)}
          </Banner>
        )}
      </div>
    </Modal>
  );
}

/** Period timings per campus: assembly, period length, the break, and Friday's short day; several timings for classes with other hours; winter timings ready to switch. */
export function PeriodsPage() {
  const ctx = useCtx();
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = useCanEdit();
  const q = useQuery({ ...timetableQueries.schedules(ctx), enabled: ctx.campus !== "ALL" });
  const [selected, setSelected] = useState<string | null>(null);
  const [activate, setActivate] = useState<BellSchedule | null>(null);
  const [remove, setRemove] = useState<BellSchedule | null>(null);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<"times" | "classes">("times");
  const list = q.data ?? [];
  const activeSeason = list.find((s) => s.active)?.season ?? "GENERAL";
  const current = list.find((s) => s.id === selected) ?? list.find((s) => s.active && s.main) ?? list[0];
  const season = current?.season ?? activeSeason;
  const inSeason = list.filter((s) => s.season === season);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["timetable"] });
  };
  const use = useMutation({
    mutationFn: (id: string) => timetableApi.activateSchedule(id),
    onSuccess: (all) => {
      const on = all.find((s) => s.active)!;
      setActivate(null);
      refresh();
      toast({ title: `${SEASON_LABEL[on.season]} in use`, message: `From today, timetables, the teacher app and printed slips show ${SEASON_LABEL[on.season].toLowerCase()}.` });
    },
  });
  const del = useMutation({
    mutationFn: (id: string) => timetableApi.deleteSchedule(id),
    onSuccess: () => {
      const name = remove?.name;
      setRemove(null);
      setSelected(null);
      refresh();
      toast({ title: `${name ?? "Timings"} removed`, message: "Its classes follow the main timings now." });
    },
  });

  return (
    <TimetableShell title="Bell timings">
      <RequireSingleCampus action="bell timings">
        {q.isError && <QueryError what="Bell timings" error={q.error} onRetry={() => void q.refetch()} />}
        {!current ? (
          <Skeleton height={420} />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Segmented
                aria-label="Season"
                value={season}
                onChange={(v) => setSelected(list.find((s) => s.season === v && s.main)?.id ?? null)}
                options={(["GENERAL", "WINTER"] as TimetableSeason[]).map((s) => ({ value: s, label: `${SEASON_LABEL[s]}${s === activeSeason ? " · in use" : ""}` }))}
              />
              <div className="flex flex-wrap gap-2">
                {canEdit && season !== activeSeason && (
                  <Button icon="play" onClick={() => setActivate(inSeason.find((s) => s.main) ?? inSeason[0]!)}>
                    Use {SEASON_LABEL[season].toLowerCase()}
                  </Button>
                )}
                {canEdit && (
                  <Button icon="plus" onClick={() => setCreating(true)}>
                    New timings
                  </Button>
                )}
              </div>
            </div>
            <div className="tt-schedules">
              {inSeason.map((s, i) => {
                const n = bellDay(s, s.normal);
                const f = bellDay(s, s.friday);
                return (
                  <div key={s.id} className={`tt-schedule mtb-rise ${current.id === s.id ? "is-on" : ""}`} style={{ "--i": i } as CSSProperties}>
                    <div className="flex items-center justify-between gap-2">
                      <b className="text-body-strong">{s.name}</b>
                      <span className="flex gap-1">
                        {s.main && <StatusBadge status="info">Main</StatusBadge>}
                        {s.active ? <StatusBadge status="success">In use</StatusBadge> : <StatusBadge status="neutral">Ready</StatusBadge>}
                      </span>
                    </div>
                    <span className="text-small text-ink-muted">
                      Assembly {clockTime(s.assemblyStart)}
                      {s.firstLectureStart ? ` · period 1 at ${clockTime(s.firstLectureStart)}` : ""} · {s.normal.periods} periods of {s.normal.periodMins} min · break {s.normal.breakMins} min after period {s.normal.breakAfter} · closes {clockTime(n.offTime)}
                    </span>
                    <span className="text-small text-ink-muted">
                      Friday: {s.friday.periods} periods of {s.friday.periodMins} min · closes {clockTime(f.offTime)}
                    </span>
                    <span className="text-small text-ink">
                      {s.sections.length} {s.sections.length === 1 ? "class" : "classes"}: {s.sections.slice(0, 8).join(", ")}
                      {s.sections.length > 8 ? ` and ${s.sections.length - 8} more` : ""}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant={current.id === s.id ? "secondary" : "quiet"} icon="edit" onClick={() => setSelected(s.id)} aria-pressed={current.id === s.id}>
                        {canEdit ? "Edit" : "View"}
                      </Button>
                      {canEdit && !s.main && (
                        <Button size="sm" variant="danger-quiet" icon="trash" onClick={() => setRemove(s)}>
                          Remove
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <Panel
              id="tt-bell"
              rise={2}
              title={`${current.name} · ${SEASON_LABEL[current.season]} · ${campusLabel(ctx.campus)}`}
              description="Times are worked out from these few numbers, so every class, teacher and printed slip shows the same bell. Classes with other hours (seniors, an evening shift) get their own timings."
              actions={<Segmented aria-label="Show" value={tab} onChange={(v) => setTab(v as "times" | "classes")} options={[{ value: "times", label: "Times" }, { value: "classes", label: `Classes (${current.sections.length})` }]} />}
            >
              {tab === "times" ? <ScheduleEditor key={`${current.id}:${current.rowVer}`} schedule={current} onSaved={refresh} /> : <SectionPicker key={`${current.id}:${current.rowVer}`} schedule={current} all={list} onSaved={refresh} />}
            </Panel>
          </>
        )}
        {activate && (
          <ConfirmDialog
            open
            onClose={() => setActivate(null)}
            onConfirm={() => use.mutate(activate.id)}
            title={`Switch to ${SEASON_LABEL[activate.season].toLowerCase()}?`}
            message={`Every class moves to its ${SEASON_LABEL[activate.season].toLowerCase()} (assembly at ${clockTime(activate.assemblyStart)} on the main timings). Lessons keep their periods; only the times change.`}
            confirmLabel="Switch timings"
            loading={use.isPending}
            error={use.isError ? inUseText(use.error) : undefined}
          />
        )}
        {remove && (
          <ConfirmDialog
            open
            tone="danger"
            onClose={() => setRemove(null)}
            onConfirm={() => del.mutate(remove.id)}
            title={`Remove ${remove.name}?`}
            message={`Its ${remove.sections.length} ${remove.sections.length === 1 ? "class goes" : "classes go"} back to the main timings.`}
            confirmLabel="Remove timings"
            loading={del.isPending}
            error={del.isError ? inUseText(del.error) : undefined}
          />
        )}
        {creating && (
          <NewScheduleModal
            season={season}
            list={list}
            onClose={() => setCreating(false)}
            onDone={(id) => {
              setCreating(false);
              refresh();
              if (id) {
                setSelected(id);
                setTab("classes");
              }
              toast({ title: "Timings created", message: "Change the times if needed, then tick the classes that follow them." });
            }}
          />
        )}
      </RequireSingleCampus>
    </TimetableShell>
  );
}
