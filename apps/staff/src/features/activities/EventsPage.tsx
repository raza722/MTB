import {
  activitiesApi,
  activitiesQueries,
  attendanceQueries,
  ACTIVITIES_CATALOG_KIND_LABEL,
  ACTIVITIES_EVENT_KIND_LABEL,
  ACTIVITIES_EVENT_KINDS,
  type ActivitiesCatalogItem,
  type ActivitiesCatalogKind,
  type ActivitiesEventDetail,
  type ActivitiesEventInput,
  type ActivitiesEventKind,
  type ActivitiesEventSummary,
  type ActivitiesVenue,
} from "@mtb/api";
import { formatDate, formatSession } from "@mtb/domain";
import { Banner, Button, Checkbox, DataTable, DatePicker, EmptyState, IconButton, Input, Panel, Segmented, Select, SidePanel, Skeleton, StatusBadge, Switch, Textarea, Urdu, useToast, type Column } from "@mtb/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { campusLabel } from "../../app/shell/campus";
import { Page, PageHeader } from "../../app/shell/page";
import { useCan, useCtx, useReadOnly, useSessionStatus } from "../../app/session";
import { EventsByTeacherDoc } from "./print";
import { ActivitiesNav, dateLimits, errorField, errorText, EventBadge, LoadError, plural, PrintLayer, useRefresh, useSessionDays, useToday } from "./shared";

export type EventsView = "calendar" | "list" | "catalogue";
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
function addMonths(month: string, n: number) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** The events calendar (sports day, debates, national days, science fair) with a list view and the activity and venue lists. */
export function EventsPage({ view, month, creating, onSearch }: { view: EventsView; month: string | undefined; creating: boolean; onSearch: (patch: { view?: EventsView | undefined; month?: string | undefined; new?: boolean | undefined }) => void }) {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const canManage = useCan("activities.manage") && !readOnly;
  const events = useQuery(activitiesQueries.events(ctx));
  const today = useToday();
  const status = useSessionStatus();
  const { starts, ends } = useSessionDays();
  // This month while the session is running; otherwise the month of the session's first event (or its first month).
  const inSession = starts && ends ? starts <= today && today <= ends : status === "CURRENT";
  const firstEvent = (events.data ?? []).reduce<string | undefined>((m, e) => (m === undefined || e.date < m ? e.date : m), undefined);
  const defaultMonth = (inSession ? today : (firstEvent ?? starts ?? today)).slice(0, 7);
  const shown = month ?? defaultMonth;

  return (
    <Page>
      <PageHeader
        title="Events"
        actions={
          canManage && ctx.campus !== "ALL" ? (
            <Button variant="primary" icon="plus" onClick={() => onSearch({ new: true })}>
              Add event
            </Button>
          ) : undefined
        }
      />
      <ActivitiesNav />
      {events.isError && <LoadError what="Events" error={events.error} onRetry={() => void events.refetch()} />}
      <Segmented
        aria-label="Events view"
        value={view}
        onChange={(v) => onSearch({ view: v === "calendar" ? undefined : (v as EventsView) })}
        options={[
          { value: "calendar", label: "Calendar" },
          { value: "list", label: "List" },
          { value: "catalogue", label: "Activities and places" },
        ]}
      />
      {view === "calendar" && <CalendarView events={events.data ?? []} loading={events.isLoading} month={shown} onMonth={(m) => onSearch({ month: m === defaultMonth ? undefined : m })} />}
      {view === "list" && <ListView events={events.data ?? []} loading={events.isLoading} />}
      {view === "catalogue" && <CatalogueView canManage={canManage} />}
      {creating && ctx.campus !== "ALL" && <EventPanel event={null} onClose={() => onSearch({ new: undefined })} />}
    </Page>
  );
}

// ------------------------------------------------------------------ Calendar

function CalendarView({ events, loading, month, onMonth }: { events: ActivitiesEventSummary[]; loading: boolean; month: string; onMonth: (m: string) => void }) {
  const ctx = useCtx();
  const today = useToday();
  const navigate = useNavigate();
  const canAttendance = useCan("attendance.view");
  const cal = useQuery({ ...attendanceQueries.calendar(ctx), enabled: canAttendance && ctx.campus !== "ALL" });
  const [y, m] = month.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: Array<{ date: string; inMonth: boolean; day: number }> = [];
  for (let i = -lead; cells.length < Math.ceil((lead + daysIn) / 7) * 7; i++) {
    const d = new Date(Date.UTC(y, m - 1, 1 + i));
    cells.push({ date: iso(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), inMonth: d.getUTCMonth() === m - 1, day: d.getUTCDate() });
  }
  const on = (date: string) => events.filter((e) => e.date <= date && date <= (e.endDate ?? e.date));
  const closed = (date: string) => (cal.data?.events ?? []).find((e) => e.closesRegisters && e.from <= date && date <= e.to);
  const inMonth = events.filter((e) => e.date.startsWith(month));

  return (
    <Panel
      id="calendar"
      title={`${MONTH_NAMES[m - 1]} ${y}`}
      description={`${plural(inMonth.length, "event")} this month${canAttendance && ctx.campus !== "ALL" ? " · school holidays shaded" : ""}${ctx.campus === "ALL" ? " · every campus" : ""}`}
      rise={1}
      actions={
        <div className="flex items-center gap-2">
          <IconButton icon="chevronLeft" label="Previous month" variant="secondary" onClick={() => onMonth(addMonths(month, -1))} />
          <Button size="sm" onClick={() => onMonth(today.slice(0, 7))}>
            This month
          </Button>
          <IconButton icon="chevronRight" label="Next month" variant="secondary" onClick={() => onMonth(addMonths(month, 1))} />
        </div>
      }
    >
      {loading ? (
        <Skeleton height={384} />
      ) : (
        <div className="act-cal">
          {WEEKDAYS.map((w) => (
            <div key={w} className="act-cal-wd" aria-hidden="true">
              {w}
            </div>
          ))}
          {cells.map((c) => {
            const list = on(c.date);
            const h = closed(c.date);
            return (
              <div key={c.date} className={`act-cal-day${c.inMonth ? "" : " is-outside"}${h ? " is-closed" : ""}${c.date === today ? " is-today" : ""}`}>
                <span className="act-cal-num">
                  <b aria-hidden="true">{c.day}</b>
                  <span className="mtb-sr-only">
                    {formatDate(c.date)}
                    {h ? `, ${h.name}` : ""}
                    {list.length ? `, ${plural(list.length, "event")}` : ""}
                  </span>
                </span>
                {h && c.inMonth && <span className="act-cal-holiday" title={h.name}>{h.name}</span>}
                {list.map((e) => (
                  <button key={e.id} type="button" className="act-cal-ev" data-status={e.status} title={`${e.title} · ${e.time ?? ""} · ${e.venue}`} onClick={() => void navigate({ to: "/activities/events/$eventId", params: { eventId: e.id } })}>
                    {e.time ? `${e.time} ` : ""}
                    {e.title}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-3 text-small text-ink-muted" aria-label="Legend">
        <span className="inline-flex items-center gap-1.5">
          <span className="mtb-chart-key" style={{ background: "var(--surface-sunken)", border: "1px solid var(--border-strong)" }} /> Planned
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="mtb-chart-key" style={{ background: "var(--brand)" }} /> Taking names
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="mtb-chart-key" style={{ background: "var(--success)" }} /> Results recorded
        </span>
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------------ List

/** Sorting key for a teacher's name without the title. */
const bareName = (n: string) => n.replace(/^(Mr|Ms|Mrs|Dr|Miss)\.?\s+/i, "");

const rangeSchema = z.object({ from: z.string().nullable(), to: z.string().nullable() }).refine((r) => !r.from || !r.to || r.from <= r.to, { path: ["to"], error: "The end date is before the start date." });

/** "09:00 · period 3" */
const whenText = (e: Pick<ActivitiesEventSummary, "time" | "period">) => [e.time ?? "", e.period ? `period ${e.period}` : ""].filter(Boolean).join(" · ") || "—";

function ListView({ events, loading }: { events: ActivitiesEventSummary[]; loading: boolean }) {
  const ctx = useCtx();
  const navigate = useNavigate();
  const today = useToday();
  const { starts, ends } = useSessionDays();
  const [when, setWhen] = useState<"UPCOMING" | "HELD" | "ALL">("UPCOMING");
  const [kind, setKind] = useState("");
  // The old staff activity log: one teacher's events between two dates.
  const [teacher, setTeacher] = useState("");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const range = rangeSchema.safeParse({ from, to });
  const rangeError = range.success ? undefined : range.error.issues[0]?.message;
  const teachers = [...new Set(events.flatMap((e) => e.inCharge))].sort((a, b) => bareName(a).localeCompare(bareName(b)));
  const rows = events
    .filter((e) => (when === "ALL" ? true : when === "UPCOMING" ? e.date >= today && e.status !== "CANCELLED" : e.date < today || e.status === "DONE") && (!kind || e.kind === kind))
    .filter((e) => (!teacher || e.inCharge.includes(teacher)) && (rangeError || ((!from || (e.endDate ?? e.date) >= from) && (!to || e.date <= to))))
    .sort((a, b) => (when === "HELD" ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)));
  const filtered = Boolean(teacher || from || to);
  const period = from || to ? `${from ? formatDate(from) : "Session start"} to ${to ? formatDate(to) : "session end"}` : `Session ${formatSession(ctx.session)}`;
  const heading = `${teacher || "Every teacher in charge"} · ${period}${kind ? ` · ${ACTIVITIES_EVENT_KIND_LABEL[kind as ActivitiesEventKind]}` : ""}${when === "UPCOMING" ? " · coming up" : when === "HELD" ? " · held" : ""}`;
  const columns: Array<Column<ActivitiesEventSummary>> = [
    { key: "date", header: "Date", width: 130, render: (e) => <span className="mtb-num">{formatDate(e.date)}</span> },
    { key: "when", header: "Time", width: 130, render: (e) => <span className="mtb-num text-small">{whenText(e)}</span> },
    {
      key: "title",
      header: "Event",
      render: (e) => (
        <span className="grid">
          <span className="mtb-cell-primary">
            {e.title} {e.titleUrdu && <Urdu size="small">{e.titleUrdu}</Urdu>}
          </span>
          <span className="mtb-cell-secondary truncate">
            {ACTIVITIES_EVENT_KIND_LABEL[e.kind]} · {e.items.join(", ")}
            {ctx.campus === "ALL" ? ` · ${campusLabel(e.campus)}` : ""}
          </span>
        </span>
      ),
    },
    { key: "venue", header: "Where", width: 160, render: (e) => e.venue },
    { key: "who", header: "In charge", width: 180, render: (e) => <span className="text-small">{e.inCharge.join(", ") || "—"}</span> },
    { key: "names", header: "Names", align: "right", width: 80, render: (e) => <span className="mtb-num">{e.participants}</span> },
    { key: "status", header: "Status", width: 170, render: (e) => <EventBadge status={e.status} /> },
  ];
  return (
    <>
      <DataTable
        caption={`Events, ${campusLabel(ctx.campus)}, session ${formatSession(ctx.session)}`}
        columns={columns}
        rows={rows}
        loading={loading}
        onRowClick={(e) => void navigate({ to: "/activities/events/$eventId", params: { eventId: e.id } })}
        toolbar={
          <div className="flex w-full flex-wrap items-end gap-3">
            <Segmented
              aria-label="When"
              value={when}
              onChange={(v) => setWhen(v as typeof when)}
              options={[
                { value: "UPCOMING", label: "Coming up" },
                { value: "HELD", label: "Held" },
                { value: "ALL", label: "All" },
              ]}
            />
            <div className="w-48">
              <Select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)} options={[{ value: "", label: "Every kind" }, ...ACTIVITIES_EVENT_KINDS.map((k) => ({ value: k, label: ACTIVITIES_EVENT_KIND_LABEL[k] }))]} />
            </div>
            <div className="w-56">
              <Select aria-label="Teacher in charge" value={teacher} onChange={(e) => setTeacher(e.target.value)} options={[{ value: "", label: "Every teacher in charge" }, ...teachers.map((t) => ({ value: t, label: t }))]} />
            </div>
            <div className="w-40">
              <DatePicker aria-label="From" placeholder="From" value={from} onValueChange={setFrom} {...dateLimits(starts, ends)} today={today} />
            </div>
            <div className="w-40">
              <DatePicker aria-label="To" placeholder="To" value={to} onValueChange={setTo} {...dateLimits(starts, ends)} today={today} {...(rangeError ? { error: rangeError } : {})} />
            </div>
            {filtered && (
              <Button
                size="sm"
                variant="quiet"
                onClick={() => {
                  setTeacher("");
                  setFrom(null);
                  setTo(null);
                }}
              >
                Clear
              </Button>
            )}
            <span className="ms-auto">
              <Button size="sm" icon="printer" disabled={ctx.campus === "ALL" || rows.length === 0 || Boolean(rangeError)} title={ctx.campus === "ALL" ? "Choose a campus to print its list." : undefined} onClick={() => setPrinting(true)}>
                Print
              </Button>
            </span>
          </div>
        }
        empty={<EmptyState icon="calendar" title={filtered ? "No events for this choice" : when === "UPCOMING" ? "Nothing coming up" : "No events"} description={filtered ? "Choose another teacher or other dates, or set When to All." : "Add sports day, debates, national days or the science fair to the calendar."} />}
      />
      {printing && ctx.campus !== "ALL" && (
        <PrintLayer paper="A4" onDone={() => setPrinting(false)}>
          <EventsByTeacherDoc campus={ctx.campus} session={ctx.session} heading={heading} events={rows} {...(teacher ? { teacher } : {})} />
        </PrintLayer>
      )}
    </>
  );
}

// ------------------------------------------------------------------ Catalogue (old Sports Info, Activity Info, Place Info)

function CatalogueView({ canManage }: { canManage: boolean }) {
  const ctx = useCtx();
  const q = useQuery(activitiesQueries.catalogue(ctx));
  const [kind, setKind] = useState<"ALL" | ActivitiesCatalogKind>("ALL");
  const [editing, setEditing] = useState<{ type: "activity"; item: ActivitiesCatalogItem | null } | { type: "venue"; item: ActivitiesVenue | null } | null>(null);
  const acts = (q.data?.activities ?? []).filter((a) => kind === "ALL" || a.kind === kind);
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      {q.isError && <LoadError what="Activities and places" error={q.error} onRetry={() => void q.refetch()} />}
      <Panel
        id="catalogue"
        title="Activities"
        description="Sports, competitions, clubs and staff duties, shared by every campus. Spelling variants from the old lists are merged."
        rise={1}
        flush
        actions={
          canManage ? (
            <Button size="sm" icon="plus" onClick={() => setEditing({ type: "activity", item: null })}>
              Add
            </Button>
          ) : undefined
        }
      >
        <DataTable
          caption="Activities"
          density="dense"
          rows={acts}
          loading={q.isLoading}
          onRowClick={canManage ? (a) => setEditing({ type: "activity", item: a }) : undefined}
          toolbar={<Segmented aria-label="Kind" value={kind} onChange={(v) => setKind(v as typeof kind)} options={[{ value: "ALL", label: "All" }, ...(Object.keys(ACTIVITIES_CATALOG_KIND_LABEL) as ActivitiesCatalogKind[]).map((k) => ({ value: k, label: ACTIVITIES_CATALOG_KIND_LABEL[k] }))]} />}
          columns={[
            { key: "name", header: "Activity", render: (a) => a.name },
            { key: "kind", header: "Kind", width: 150, render: (a) => ACTIVITIES_CATALOG_KIND_LABEL[a.kind] },
            { key: "uses", header: "Used", align: "right", width: 80, render: (a) => <span className="mtb-num">{a.uses}</span> },
            { key: "active", header: "Status", width: 130, render: (a) => (a.active ? <StatusBadge status="success">In use</StatusBadge> : <StatusBadge status="neutral">Switched off</StatusBadge>) },
          ]}
        />
      </Panel>
      <Panel
        id="venues"
        title="Places"
        description={ctx.campus === "ALL" ? "Every campus" : `Grounds, halls and rooms at ${campusLabel(ctx.campus)}`}
        rise={2}
        flush
        actions={
          canManage && ctx.campus !== "ALL" ? (
            <Button size="sm" icon="plus" onClick={() => setEditing({ type: "venue", item: null })}>
              Add
            </Button>
          ) : undefined
        }
      >
        <DataTable
          caption="Places"
          density="dense"
          rows={q.data?.venues ?? []}
          loading={q.isLoading}
          onRowClick={canManage ? (v) => setEditing({ type: "venue", item: v }) : undefined}
          columns={[
            { key: "name", header: "Place", render: (v) => v.name },
            { key: "short", header: "Short", width: 110, render: (v) => <span className="text-small">{v.shortName || "—"}</span> },
            ...(ctx.campus === "ALL" ? [{ key: "campus", header: "Campus", width: 150, render: (v: ActivitiesVenue) => campusLabel(v.campus) }] : []),
            { key: "uses", header: "Events", align: "right", width: 80, render: (v) => <span className="mtb-num">{v.uses}</span> },
            { key: "active", header: "Status", width: 130, render: (v) => (v.active ? <StatusBadge status="success">In use</StatusBadge> : <StatusBadge status="neutral">Switched off</StatusBadge>) },
          ]}
        />
      </Panel>
      {editing && <CatalogPanel editing={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function CatalogPanel({ editing, onClose }: { editing: { type: "activity"; item: ActivitiesCatalogItem | null } | { type: "venue"; item: ActivitiesVenue | null }; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const refresh = useRefresh();
  const [name, setName] = useState(editing.item?.name ?? "");
  const [shortName, setShortName] = useState(editing.type === "venue" ? (editing.item?.shortName ?? "") : "");
  const [kind, setKind] = useState<ActivitiesCatalogKind>(editing.type === "activity" ? (editing.item?.kind ?? "SPORT") : "SPORT");
  const [active, setActive] = useState(editing.item?.active ?? true);
  const [tried, setTried] = useState(false);
  const save = useMutation({
    mutationFn: async (): Promise<void> => {
      if (editing.type === "activity") await activitiesApi.saveActivity({ name: name.trim(), kind, active }, editing.item?.id);
      else await activitiesApi.saveVenue(ctx, { name: name.trim(), shortName: shortName.trim(), active }, editing.item?.id);
    },
    onSuccess: () => {
      refresh();
      toast({ title: editing.item ? "Saved" : "Added", message: name.trim() });
      onClose();
    },
  });
  const nameErr = name.trim().length < 2 ? "Enter the name." : undefined;
  const shortErr = shortName.trim().length > 12 ? "Keep it to 12 letters, for example “Hall”." : undefined;
  return (
    <SidePanel
      open
      onClose={onClose}
      title={editing.item ? `Edit ${editing.item.name}` : editing.type === "activity" ? "Add activity" : "Add place"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => {
              setTried(true);
              if (!nameErr && !shortErr) save.mutate();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Input label="Name" required value={name} onChange={(e) => setName(e.target.value)} error={(tried ? nameErr : undefined) ?? (save.isError && errorField(save.error) === "name" ? errorText(save.error) : undefined)} />
        {editing.type === "venue" && (
          <Input
            label="Short title"
            value={shortName}
            maxLength={12}
            onChange={(e) => setShortName(e.target.value)}
            placeholder="Hall"
            {...((tried ? shortErr : undefined) ?? (save.isError && errorField(save.error) === "shortName" ? errorText(save.error) : undefined) ? { error: (tried ? shortErr : undefined) ?? errorText(save.error) } : { help: "Optional. Used where space is tight, such as slips and narrow tables." })}
          />
        )}
        {editing.type === "activity" && <Select label="Kind" value={kind} onChange={(e) => setKind(e.target.value as ActivitiesCatalogKind)} options={(Object.keys(ACTIVITIES_CATALOG_KIND_LABEL) as ActivitiesCatalogKind[]).map((k) => ({ value: k, label: ACTIVITIES_CATALOG_KIND_LABEL[k] }))} />}
        <Switch label={active ? "In use" : "Switched off: kept for old records"} checked={active} onChange={(e) => setActive(e.target.checked)} />
        {save.isError && errorField(save.error) !== "name" && errorField(save.error) !== "shortName" && <Banner tone="danger">{errorText(save.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

// ------------------------------------------------------------------ Event form (add and edit)

const eventSchema = z.object({
  title: z.string().trim().min(3, "Give the event a name, for example “Annual sports day”."),
  date: z.string({ error: "Choose the date." }).min(1, "Choose the date."),
  venue: z.string().min(1, "Choose where it takes place."),
  inCharge: z.string().trim().min(3, "Name at least one teacher in charge."),
  items: z.array(z.string()).min(1, "Add at least one item, one per line."),
});

export function EventPanel({ event, onClose }: { event: ActivitiesEventDetail | null; onClose: (id?: string) => void }) {
  const ctx = useCtx();
  const today = useToday();
  const { starts, ends } = useSessionDays();
  const toast = useToast();
  const refresh = useRefresh();
  const navigate = useNavigate();
  const catalogue = useQuery(activitiesQueries.catalogue(ctx));
  const [f, setF] = useState({
    title: event?.title ?? "",
    titleUrdu: event?.titleUrdu ?? "",
    kind: event?.kind ?? ("SPORTS" as ActivitiesEventKind),
    date: event?.date ?? (null as string | null),
    endDate: event?.endDate ?? (null as string | null),
    time: event?.time ?? "09:00",
    period: event?.period ? String(event.period) : "",
    // A migrated event has no place ("—"): one of the campus's places must be chosen before it is saved.
    venue: event && event.venue !== "—" ? event.venue : "",
    inCharge: event?.inCharge.join(", ") ?? "",
    forClasses: event?.forClasses ?? "",
    houseEvent: event?.houseEvent ?? true,
    items: event?.items.join("\n") ?? "",
    description: event?.description ?? "",
    first: String(event?.pointsRule.first ?? 10),
    second: String(event?.pointsRule.second ?? 6),
    third: String(event?.pointsRule.third ?? 3),
    participation: String(event?.pointsRule.participation ?? 1),
  });
  const [tried, setTried] = useState(false);
  const items = f.items.split("\n").map((x) => x.trim()).filter(Boolean);
  const check = eventSchema.safeParse({ title: f.title, date: f.date ?? "", venue: f.venue, inCharge: f.inCharge, items });
  const errs: Record<string, string> = check.success ? {} : Object.fromEntries(check.error.issues.map((i) => [String(i.path[0]), i.message]));
  if (f.endDate && f.date && f.endDate < f.date) errs.endDate = "The last day can't be before the first day.";
  if (f.period !== "" && !(Number(f.period) >= 1 && Number(f.period) <= 10)) errs.period = "A lecture number from 1 to 10, or leave it empty.";
  if ([f.first, f.second, f.third, f.participation].some((x) => x === "" || Number(x) > 50)) errs.pointsRule = "House points must be whole numbers from 0 to 50.";
  const body = (): ActivitiesEventInput => ({
    title: f.title.trim(),
    titleUrdu: f.titleUrdu.trim(),
    kind: f.kind,
    date: f.date!,
    endDate: f.endDate,
    time: f.time || null,
    period: f.period === "" ? null : Number(f.period),
    venue: f.venue,
    inCharge: f.inCharge.split(",").map((x) => x.trim()).filter(Boolean),
    forClasses: f.forClasses.trim(),
    houseEvent: f.houseEvent,
    items,
    description: f.description.trim(),
    pointsRule: { first: Number(f.first), second: Number(f.second), third: Number(f.third), participation: Number(f.participation) },
  });
  const save = useMutation({
    mutationFn: () => activitiesApi.saveEvent(ctx, body(), event?.id),
    onSuccess: (e) => {
      refresh();
      toast({ title: event ? "Event saved" : "Event added to the calendar", message: `${e.title} · ${formatDate(e.date)}` });
      onClose(e.id);
      if (!event) void navigate({ to: "/activities/events/$eventId", params: { eventId: e.id } });
    },
  });
  const sf = save.isError ? errorField(save.error) : undefined;
  const err = (k: string) => (tried ? errs[k] : undefined) ?? (sf === k ? errorText(save.error) : undefined);
  const venues = (catalogue.data?.venues ?? []).filter((v) => v.active && (ctx.campus === "ALL" || v.campus === ctx.campus));
  return (
    <SidePanel
      open
      wide
      onClose={() => onClose()}
      title={event ? `Edit ${event.title}` : "Add event"}
      description="Dates on school holidays are refused. Names and results are added on the event's page."
      footer={
        <>
          <Button onClick={() => onClose()}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => {
              setTried(true);
              if (Object.keys(errs).length === 0) save.mutate();
            }}
          >
            {event ? "Save" : "Add to calendar"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Event" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} error={err("title")} />
          <Input label="Name in Urdu" urdu value={f.titleUrdu} onChange={(e) => setF({ ...f, titleUrdu: e.target.value })} help="Shown on notices and certificates." />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Select label="Kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as ActivitiesEventKind })} options={ACTIVITIES_EVENT_KINDS.map((k) => ({ value: k, label: ACTIVITIES_EVENT_KIND_LABEL[k] }))} />
          <DatePicker label="Date" required value={f.date} onValueChange={(d) => setF({ ...f, date: d })} {...dateLimits(starts, ends)} today={today} error={err("date")} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Starts at" type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />
            <Input label="Period" inputMode="numeric" maxLength={2} value={f.period} onChange={(e) => setF({ ...f, period: e.target.value.replace(/\D/g, "") })} placeholder="—" {...(err("period") ? { error: err("period") } : { help: "Optional" })} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <DatePicker label="Last day (if longer)" value={f.endDate} onValueChange={(d) => setF({ ...f, endDate: d })} {...dateLimits(f.date ?? starts, ends)} today={today} error={err("endDate")} />
          <Select label="Where" required value={f.venue} onChange={(e) => setF({ ...f, venue: e.target.value })} error={err("venue")} options={[{ value: "", label: "Choose…" }, ...venues.map((v) => ({ value: v.name, label: v.name }))]} />
          <Input label="For" value={f.forClasses} onChange={(e) => setF({ ...f, forClasses: e.target.value })} placeholder="Classes 6–10" />
        </div>
        <Input label="Teachers in charge" required value={f.inCharge} onChange={(e) => setF({ ...f, inCharge: e.target.value })} error={err("inCharge")} help="Separate names with commas." />
        <Textarea label="Items" required rows={4} value={f.items} onChange={(e) => setF({ ...f, items: e.target.value })} error={err("items")} help="One per line: “100 m race (girls)”, “English debate”. Places are given per item." />
        <Textarea label="Notes" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <Checkbox label="House event: places and taking part earn house points" checked={f.houseEvent} onChange={(e) => setF({ ...f, houseEvent: e.target.checked })} />
        {f.houseEvent && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Input label="1st place" inputMode="numeric" suffix="pts" value={f.first} onChange={(e) => setF({ ...f, first: e.target.value.replace(/\D/g, "") })} />
            <Input label="2nd place" inputMode="numeric" suffix="pts" value={f.second} onChange={(e) => setF({ ...f, second: e.target.value.replace(/\D/g, "") })} />
            <Input label="3rd place" inputMode="numeric" suffix="pts" value={f.third} onChange={(e) => setF({ ...f, third: e.target.value.replace(/\D/g, "") })} />
            <Input label="Taking part" inputMode="numeric" suffix="pts" value={f.participation} onChange={(e) => setF({ ...f, participation: e.target.value.replace(/\D/g, "") })} />
          </div>
        )}
        {err("pointsRule") && <span className="mtb-error">{err("pointsRule")}</span>}
        {save.isError && !sf && <Banner tone="danger">{errorText(save.error)}</Banner>}
      </div>
    </SidePanel>
  );
}
