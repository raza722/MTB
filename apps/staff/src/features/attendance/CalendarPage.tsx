import { ApiError, attendanceApi, attendanceQueries, can, SCHOOL_EVENT_KIND_LABEL, type CampusScope, type SchoolEvent, type SchoolEventBody, type SchoolEventKind } from "@mtb/api";
import { daysBetween, formatCount, formatDate, formatLongDate } from "@mtb/domain";
import { Banner, Button, ConfirmDialog, DataTable, DatePicker, EmptyState, Input, Panel, Segmented, Select, SidePanel, Skeleton, StatCard, StatusBadge, Switch, Textarea, Urdu, useToast, type Column } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type CSSProperties } from "react";
import { z } from "zod";
import { campusLabel } from "../../app/shell/campus";
import { useCan, useCtx, useReadOnly, useSessionUser } from "../../app/session";
import { AttendanceShell, errorText, monthLabel, monthsBetween, QueryError, useToday } from "./shared";

const KINDS: SchoolEventKind[] = ["HOLIDAY", "VACATION", "EXAM", "EVENT"];
const pad = (n: number) => String(n).padStart(2, "0");
const daysIn = (e: Pick<SchoolEvent, "from" | "to">) => daysBetween(e.from, e.to) + 1;
/** The server says whether an entry is locked (started and closing registers, or from the old system). */
const locked = (e: SchoolEvent, today: string) => e.locked ?? (e.closesRegisters && e.from <= today);
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The fields the calendar endpoints take (not the entry's id, author or lock). */
const bodyOf = (e: SchoolEvent): SchoolEventBody => ({
  campus: e.campus,
  session: e.session,
  from: e.from,
  to: e.to,
  kind: e.kind,
  name: e.name,
  nameUr: e.nameUr ?? "",
  closesRegisters: e.closesRegisters,
  note: e.note ?? "",
});

function sessionMonthList(session: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const m = ((3 + i) % 12) + 1;
    const y = m >= 4 ? session : session + 1;
    out.push(`${y}-${pad(m)}`);
  }
  return out;
}

function KindLabel({ kind }: { kind: SchoolEventKind }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`att-kind-dot k-${kind}`} aria-hidden="true" />
      {SCHOOL_EVENT_KIND_LABEL[kind]}
    </span>
  );
}

function MonthGrid({ month, events, weeklyOff, today, onPick }: { month: string; events: SchoolEvent[]; weeklyOff: number[]; today: string; onPick: (e: SchoolEvent) => void }) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  return (
    <div className="grid gap-1" role="grid" aria-label={`School calendar, ${monthLabel(month)}`}>
      <div className="att-cal" role="row">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="att-cal-wd" role="columnheader">
            {d}
          </div>
        ))}
      </div>
      <div className="att-cal">
        {Array.from({ length: lead }, (_, i) => (
          <div key={`p${i}`} className="att-cal-day is-pad" aria-hidden="true" />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const date = `${month}-${pad(i + 1)}`;
          const weekday = (((lead + i) % 7) + 1) % 7;
          const off = weeklyOff.includes(weekday);
          const here = events.filter((e) => e.from <= date && date <= e.to);
          const closed = here.some((e) => e.closesRegisters);
          return (
            <div
              key={date}
              role="gridcell"
              aria-label={`${formatLongDate(date)}${here.length ? `: ${here.map((e) => e.name).join(", ")}` : off ? `: ${WEEKDAY_NAMES[weekday]}, weekly day off` : ""}`}
              className={`att-cal-day ${off ? "is-sun" : ""} ${closed ? "is-closed" : ""} ${date === today ? "is-today" : ""}`}
            >
              <span className="d">{i + 1}</span>
              {here.map((e) => (
                <button key={e.id} type="button" className={`att-chip k-${e.kind}`} title={e.name} onClick={() => onPick(e)}>
                  {e.name}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const schema = z
  .object({
    name: z.string().trim().min(3, { error: "Give the day a name, such as “Iqbal Day”." }),
    from: z.string({ error: "Choose the first day." }).min(10, { error: "Choose the first day." }),
    to: z.string({ error: "Choose the last day." }).min(10, { error: "Choose the last day." }),
  })
  .refine((v) => v.to >= v.from, { path: ["to"], error: "The last day is before the first day." });

type Draft = SchoolEventBody;

function EventForm({ event, draftCampus, canAll, onClose }: { event: SchoolEvent | "new" | null; draftCampus: CampusScope; canAll: boolean; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const canManage = useCan("attendance.calendar");
  const today = useToday();
  const existing = event && event !== "new" ? event : null;
  const blank: Draft = { campus: draftCampus, session: ctx.session, from: "", to: "", kind: "HOLIDAY", name: "", nameUr: "", closesRegisters: true, note: "" };
  const [draft, setDraft] = useState<Draft>(existing ? bodyOf(existing) : blank);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isLocked = !!existing && locked(existing, today);
  const editable = canManage && !readOnly && !isLocked;
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const done = (title: string, message: string) => {
    void qc.invalidateQueries({ queryKey: ["attendance"] });
    toast({ title, message });
    onClose();
  };
  const save = useMutation({
    mutationFn: () => (existing ? attendanceApi.updateEvent(existing.id, draft) : attendanceApi.createEvent(draft)),
    onSuccess: (e) => done(existing ? `${e.name} updated` : `${e.name} added`, e.closesRegisters ? `Registers are closed from ${formatDate(e.from)} to ${formatDate(e.to)}; teachers see “No attendance today”.` : "Registers stay open on these days."),
    onError: (e) => {
      if (e instanceof ApiError && e.field) setErrors({ [e.field]: e.message });
    },
  });
  const remove = useMutation({
    mutationFn: () => attendanceApi.deleteEvent(existing!.id),
    onSuccess: () => done(`${existing!.name} removed`, "The days are school days again."),
  });

  const submit = () => {
    const parsed = schema.safeParse(draft);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const i of parsed.error.issues) next[String(i.path[0])] ??= i.message;
      setErrors(next);
      return;
    }
    setErrors({});
    save.mutate();
  };

  return (
    <SidePanel
      open={event !== null}
      onClose={onClose}
      title={existing ? existing.name : "Add a day to the calendar"}
      description={existing ? `${formatDate(existing.from)}${existing.to !== existing.from ? ` to ${formatDate(existing.to)}` : ""} · ${existing.campus === "ALL" ? "All campuses" : campusLabel(existing.campus)}` : "Holidays and vacations close registers; exams and events can keep them open."}
      footer={
        editable ? (
          <>
            {existing ? (
              <Button variant="danger-quiet" icon="trash" onClick={() => setConfirmDelete(true)}>
                Remove
              </Button>
            ) : (
              <Button variant="quiet" onClick={onClose}>
                Cancel
              </Button>
            )}
            <Button variant="primary" icon="check" loading={save.isPending} loadingLabel="Saving…" onClick={submit}>
              {existing ? "Save changes" : "Add to calendar"}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Close</Button>
        )
      }
    >
      <div className="grid gap-4">
        {existing && isLocked && (
          <Banner tone="info" icon="lock" title="This entry can't be changed.">
            {existing.lockedReason ?? "Registers were closed for these days, so this entry can no longer be changed."}
          </Banner>
        )}
        {!canManage && <p className="m-0 text-small text-ink-muted">The principal or an admin keeps the calendar.</p>}
        <Input label="Name" required disabled={!editable} value={draft.name} onChange={(e) => set({ name: e.target.value })} error={errors.name} placeholder="Iqbal Day" />
        <Input label="Name in Urdu" urdu disabled={!editable} value={draft.nameUr ?? ""} onChange={(e) => set({ nameUr: e.target.value })} help="Shown to parents in the portal." />
        <Select
          label="Kind"
          disabled={!editable}
          value={draft.kind}
          onChange={(e) => {
            const kind = e.target.value as SchoolEventKind;
            set({ kind, closesRegisters: kind === "HOLIDAY" || kind === "VACATION" ? true : draft.closesRegisters });
          }}
          options={KINDS.map((k) => ({ value: k, label: SCHOOL_EVENT_KIND_LABEL[k] }))}
        />
        <div className="grid grid-cols-2 gap-3">
          <DatePicker label="First day" required disabled={!editable} value={draft.from || null} today={today} onValueChange={(d) => set({ from: d ?? "", ...(d && (!draft.to || draft.to < d) ? { to: d } : {}) })} error={errors.from} />
          <DatePicker label="Last day" required disabled={!editable} value={draft.to || null} today={today} minDate={draft.from || undefined} onValueChange={(d) => set({ to: d ?? "" })} error={errors.to} />
        </div>
        {draft.from && draft.to && draft.to >= draft.from && <span className="text-small text-ink-muted">{daysIn(draft)} {daysIn(draft) === 1 ? "day" : "days"}</span>}
        <Switch label="No school: close registers on these days" disabled={!editable} checked={draft.closesRegisters} onChange={(e) => set({ closesRegisters: e.target.checked })} />
        <Select
          label="Applies to"
          disabled={!editable || !canAll || ctx.campus === "ALL"}
          value={draft.campus === "ALL" ? "ALL" : "CAMPUS"}
          onChange={(e) => set({ campus: e.target.value === "ALL" ? "ALL" : (ctx.campus as CampusScope) })}
          options={[
            ...(ctx.campus !== "ALL" ? [{ value: "CAMPUS", label: campusLabel(ctx.campus) }] : []),
            { value: "ALL", label: "All campuses", disabled: !canAll },
          ]}
          help={canAll ? undefined : "Only head office can add a day for every campus."}
        />
        <Textarea label="Note" disabled={!editable} rows={2} value={draft.note ?? ""} onChange={(e) => set({ note: e.target.value })} help="For example: “Date depends on the moon sighting.”" />
        {save.isError && !(save.error instanceof ApiError && save.error.field) && (
          <Banner tone="danger" title="Not saved.">
            {errorText(save.error)}
          </Banner>
        )}
      </div>
      {existing && (
        <ConfirmDialog
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => remove.mutate()}
          tone="danger"
          title={`Remove ${existing.name}?`}
          message={existing.closesRegisters ? "These days become school days again: registers open and teachers are expected to mark them." : "The entry is removed from the calendar."}
          confirmLabel="Remove"
          loading={remove.isPending}
          error={remove.isError ? errorText(remove.error) : undefined}
        />
      )}
    </SidePanel>
  );
}

/** Public holidays, vacations, exams and school events. Days without school close the registers everywhere. */
export function CalendarPage() {
  const ctx = useCtx();
  const user = useSessionUser();
  const readOnly = useReadOnly();
  const canManage = useCan("attendance.calendar");
  const canAll = can(user, "attendance.calendar", "ALL");
  const today = useToday();
  const q = useQuery(attendanceQueries.calendar(ctx));
  const data = q.data;
  // The session's months from its real dates (April–March until the calendar answers).
  const months = data ? monthsBetween(data.starts, data.ends) : sessionMonthList(ctx.session);
  const [view, setView] = useState("month");
  const [picked, setMonth] = useState<string | null>(null);
  const month = picked && months.includes(picked) ? picked : !readOnly && months.includes(today.slice(0, 7)) ? today.slice(0, 7) : months[0]!;
  const [open, setOpen] = useState<SchoolEvent | "new" | null>(null);
  const events = data?.events ?? [];
  // The campus's weekly days off (Sunday until the server sends them).
  const weeklyOff = data?.weeklyOff ?? [0];
  const at = months.indexOf(month);
  const upcoming = events.filter((e) => e.to >= today).slice(0, 4);
  const closedDays = events.filter((e) => e.closesRegisters && e.kind !== "EXAM").reduce((a, e) => a + daysIn(e), 0);

  const columns: Array<Column<SchoolEvent>> = [
    {
      key: "from",
      header: "Dates",
      width: 230,
      render: (e) => (
        <span className="mtb-num">
          {formatDate(e.from)}
          {e.to !== e.from && ` to ${formatDate(e.to)}`}
        </span>
      ),
    },
    {
      key: "name",
      header: "Day",
      render: (e) => (
        <span className="grid">
          <span className="mtb-cell-primary">{e.name}</span>
          {e.nameUr && (
            <Urdu size="small" className="text-ink-muted">
              {e.nameUr}
            </Urdu>
          )}
        </span>
      ),
    },
    { key: "kind", header: "Kind", width: 150, render: (e) => <KindLabel kind={e.kind} /> },
    { key: "campus", header: "Campus", width: 150, render: (e) => (e.campus === "ALL" ? "All campuses" : campusLabel(e.campus)) },
    { key: "closes", header: "Registers", width: 130, render: (e) => (e.closesRegisters ? <StatusBadge status="holiday">Closed</StatusBadge> : <StatusBadge status="success">Open</StatusBadge>) },
    { key: "days", header: "Days", align: "right", width: 70, render: (e) => <span className="mtb-num">{daysIn(e)}</span> },
  ];

  return (
    <AttendanceShell
      title="School calendar"
      actions={
        canManage && !readOnly ? (
          <Button variant="primary" icon="plus" onClick={() => setOpen("new")}>
            Add a day
          </Button>
        ) : undefined
      }
    >
      {q.isError && <QueryError what="The school calendar" error={q.error} onRetry={() => void q.refetch()} />}
      <div className="att-kpis">
        {!data ? (
          [0, 1, 2, 3].map((i) => <StatCard key={i} label="" loading />)
        ) : (
          <>
            <div style={{ "--i": 0 } as CSSProperties}>
              <StatCard label={readOnly ? "School days in the session" : "School days so far"} icon="calendar" value={formatCount(data.schoolDaysSoFar)} foot={`Session ${formatDate(data.starts)} to ${formatDate(data.ends)}`} />
            </div>
            <div style={{ "--i": 1 } as CSSProperties}>
              <StatCard
                label="School days left"
                icon="clock"
                value={formatCount(data.schoolDaysLeft)}
                foot={`Minus ${weeklyOff.length ? weeklyOff.map((d) => `${WEEKDAY_NAMES[d]}s`).join(" and ") : "weekly days off"} and closed days`}
              />
            </div>
            <div style={{ "--i": 2 } as CSSProperties}>
              <StatCard label="Days without school" icon="flag" tone="info" value={formatCount(closedDays)} foot="Holidays, vacations and closed events" />
            </div>
            <div style={{ "--i": 3 } as CSSProperties}>
              <StatCard label="Next" icon="bolt" tone="warning" value={upcoming[0] ? formatDate(upcoming[0].from) : "—"} foot={upcoming[0] ? `${upcoming[0].name}${upcoming[0].from > today ? ` · in ${daysBetween(today, upcoming[0].from)} days` : " · today"}` : "Nothing else this session"} />
            </div>
          </>
        )}
      </div>

      <div className="att-grid-2">
        <Panel
          id="att-cal"
          rise={1}
          flush={view === "list"}
          title={view === "month" ? monthLabel(month) : `All of ${data ? `${formatDate(data.starts).slice(-4)}–${formatDate(data.ends).slice(-2)}` : "the session"}`}
          description={ctx.campus === "ALL" ? "Days for every campus. Choose a campus to see its own events too." : `${campusLabel(ctx.campus)}, including days set for every campus.`}
          actions={
            <div className="flex items-center gap-2">
              {view === "month" && (
                <>
                  <Button size="sm" variant="quiet" icon="chevronLeft" aria-label="Previous month" disabled={at <= 0} onClick={() => setMonth(months[at - 1]!)} />
                  <Button size="sm" variant="quiet" icon="chevronRight" aria-label="Next month" disabled={at >= months.length - 1} onClick={() => setMonth(months[at + 1]!)} />
                </>
              )}
              <Segmented aria-label="View" value={view} onChange={setView} options={[{ value: "month", label: "Month" }, { value: "list", label: "List" }]} />
            </div>
          }
        >
          {!data ? (
            <Skeleton height={420} />
          ) : view === "month" ? (
            <MonthGrid month={month} events={events} weeklyOff={weeklyOff} today={today} onPick={setOpen} />
          ) : (
            <DataTable caption="School calendar" columns={columns} rows={events} rowKey="id" onRowClick={setOpen} maxHeight={560} empty={<EmptyState icon="calendar" title="Nothing on the calendar" description="Add public holidays, vacations and school events." />} />
          )}
        </Panel>

        <Panel id="att-cal-next" rise={2} title="Coming up" description="Teachers see “No attendance today” on closed days, and parents see the day in the portal.">
          {upcoming.length === 0 ? (
            <EmptyState icon="calendar" title="Nothing coming up" />
          ) : (
            <ul className="att-list">
              {upcoming.map((e) => (
                <li key={e.id}>
                  <span className="att-when">
                    <b>{e.from.slice(8)}</b>
                    <span>{formatDate(e.from).slice(3, 6)}</span>
                  </span>
                  <button type="button" className="grid min-w-0 cursor-pointer border-0 bg-transparent p-0 text-left" onClick={() => setOpen(e)}>
                    <span className="font-medium text-ink">{e.name}</span>
                    <span className="text-small text-ink-muted">
                      {SCHOOL_EVENT_KIND_LABEL[e.kind]} · {daysIn(e)} {daysIn(e) === 1 ? "day" : "days"} · {e.closesRegisters ? "no school" : "registers open"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <ul className="att-list mt-3">
            {KINDS.map((k) => (
              <li key={k} className="text-small text-ink-muted">
                <KindLabel kind={k} />
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      {open !== null && <EventForm key={open === "new" ? "new" : open.id} event={open} draftCampus={ctx.campus} canAll={canAll} onClose={() => setOpen(null)} />}
    </AttendanceShell>
  );
}
