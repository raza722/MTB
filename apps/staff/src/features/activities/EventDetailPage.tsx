import {
  activitiesApi,
  activitiesQueries,
  ACTIVITIES_EVENT_KIND_LABEL,
  ACTIVITIES_ROLE_LABEL,
  type ActivitiesEventDetail,
  type ActivitiesParticipant,
  type ActivitiesPerson,
  type ActivitiesPosition,
  type ActivitiesRole,
} from "@mtb/api";
import { formatDate, formatLongDate, formatSession } from "@mtb/domain";
import { Banner, Button, ConfirmDialog, EmptyState, IconButton, KeyValue, Panel, Select, Skeleton, StatusBadge, Textarea, Timeline, Urdu, useToast, buttonClassName } from "@mtb/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { campusLabel } from "../../app/shell/campus";
import { Page, PageHeader } from "../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { EventPanel } from "./EventsPage";
import { eventListRows, SportsListDoc } from "./print";
import { ActivitiesNav, BarList, errorText, EventBadge, HouseTag, houseColor, LoadError, PersonChip, PlaceBadge, plural, PrintLayer, StudentSearch, useHouseTones, useRefresh, useToday } from "./shared";

const ROLES: ActivitiesRole[] = ["PARTICIPANT", "PLAYER", "CAPTAIN", "VOLUNTEER", "ORGANISER"];

/** One event: details, the names taken per item, results with house points, and links to certificates. */
export function EventDetailPage({ id }: { id: string }) {
  const ctx = useCtx();
  const q = useQuery(activitiesQueries.event(ctx, id));
  if (q.isLoading)
    return (
      <Page>
        <Skeleton width={360} height={32} />
        <ActivitiesNav />
        <Skeleton height={300} />
      </Page>
    );
  if (q.isError || !q.data)
    return (
      <Page>
        <PageHeader title="Event" />
        <ActivitiesNav />
        <LoadError what="This event" error={q.error} onRetry={() => void q.refetch()} />
      </Page>
    );
  return <EventView ev={q.data} />;
}

function EventView({ ev }: { ev: ActivitiesEventDetail }) {
  const toast = useToast();
  const refresh = useRefresh();
  const readOnly = useReadOnly();
  const canManage = useCan("activities.manage") && !readOnly;
  const tones = useHouseTones();
  const [editing, setEditing] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const [positions, setPositions] = useState<Record<string, ActivitiesPosition | null>>({});
  const [confirmResults, setConfirmResults] = useState(false);
  const [printing, setPrinting] = useState(false);
  const today = useToday();
  const held = ev.date <= today;
  const editableResults = canManage && held && ev.status !== "CANCELLED" && ev.participants > 0;
  const placeOf = (p: ActivitiesParticipant) => (p.id in positions ? positions[p.id]! : p.position);
  const dirty = Object.keys(positions).length > 0;

  const cancelMut = useMutation({
    mutationFn: () => activitiesApi.cancelEvent(ev.id, reason.trim()),
    onSuccess: () => {
      refresh();
      setCancel(false);
      toast({ tone: "info", title: "Event cancelled", message: ev.title });
    },
  });
  const results = useMutation({
    mutationFn: () => activitiesApi.saveResults(ev.id, { positions }),
    onSuccess: (x) => {
      refresh();
      setPositions({});
      setConfirmResults(false);
      toast({ title: ev.status === "DONE" ? "Results corrected" : "Results recorded", message: x.houseEvent ? "House points are posted to the points table." : `${x.placed} places given.` });
    },
  });
  const removeMut = useMutation({ mutationFn: (pid: string) => activitiesApi.removeParticipant(ev.id, pid), onSuccess: () => refresh() });

  // House points the current places would give (shown before saving).
  const pointsByHouse = new Map<string, { name: string; tone: ReturnType<typeof tones>; pts: number }>();
  if (ev.houseEvent)
    for (const p of ev.participantsList) {
      if (!p.houseId || !p.houseName) continue;
      const x = pointsByHouse.get(p.houseId) ?? { name: p.houseName, tone: tones(p.houseName), pts: 0 };
      const place = placeOf(p);
      x.pts += (p.role === "VOLUNTEER" ? 0 : ev.pointsRule.participation) + (place === 1 ? ev.pointsRule.first : place === 2 ? ev.pointsRule.second : place === 3 ? ev.pointsRule.third : 0);
      pointsByHouse.set(p.houseId, x);
    }
  const houseRows = [...pointsByHouse.entries()].map(([key, v]) => ({ key, label: v.name, value: v.pts, color: v.tone ? houseColor(v.tone) : "var(--brand)" })).sort((a, b) => b.value - a.value);

  return (
    <Page>
      <PageHeader
        title={ev.title}
        context={`${formatLongDate(ev.date)}${ev.time ? ` · ${ev.time}` : ""} · ${ev.venue} · ${campusLabel(ev.campus)} · Session ${formatSession(ev.session)}`}
        meta={
          <>
            <EventBadge status={ev.status} />
            <StatusBadge status="neutral" dot={false}>
              {ACTIVITIES_EVENT_KIND_LABEL[ev.kind]}
            </StatusBadge>
            {ev.houseEvent && (
              <StatusBadge status="brand" dot={false}>
                House event
              </StatusBadge>
            )}
            {ev.titleUrdu && <Urdu size="small">{ev.titleUrdu}</Urdu>}
          </>
        }
        actions={
          <>
            <Link to="/activities/events" className="mtb-btn mtb-btn-ghost">
              Calendar
            </Link>
            {ev.participants > 0 && (
              <Button icon="printer" onClick={() => setPrinting(true)} title={dirty ? "Prints the saved places. Save your changes first to print them." : undefined}>
                Print list
              </Button>
            )}
            {held && ev.participants > 0 && ev.status !== "CANCELLED" && (
              <Link to="/activities/certificates" search={((prev: Record<string, unknown>) => ({ ...prev, event: ev.id })) as never} className={buttonClassName({ variant: "secondary" })}>
                Certificates
              </Link>
            )}
            {canManage && (ev.status === "PLANNED" || ev.status === "OPEN") && (
              <>
                <Button variant="danger-quiet" onClick={() => (setTried(false), setReason(""), setCancel(true))}>
                  Cancel event
                </Button>
                <Button icon="edit" onClick={() => setEditing(true)}>
                  Edit details
                </Button>
              </>
            )}
          </>
        }
      />
      <ActivitiesNav />
      {ev.status === "CANCELLED" && <Banner tone="neutral" title="This event was cancelled">{ev.cancelReason}</Banner>}
      {ev.status === "OPEN" && !held && <Banner tone="info">Taking names until the day. Results are recorded on or after {formatDate(ev.date)}.</Banner>}
      {ev.status === "OPEN" && held && canManage && <Banner tone="warning" title="Results not recorded yet">The event day has passed. Give the places below and save to post house points.</Banner>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-6">
          {canManage && (ev.status === "PLANNED" || ev.status === "OPEN") && <AddNames ev={ev} />}
          <Panel
            id="names"
            title="Names and results"
            description={`${plural(ev.participants, "name")} across ${plural(ev.items.length, "item")}${ev.placed ? ` · ${ev.placed} places given` : ""}`}
            rise={1}
            actions={
              editableResults ? (
                <Button variant="primary" icon="award" disabled={!dirty && ev.status === "DONE"} onClick={() => setConfirmResults(true)}>
                  {ev.status === "DONE" ? "Save corrections" : "Save results"}
                </Button>
              ) : undefined
            }
          >
            {ev.participantsList.length === 0 ? (
              <EmptyState icon="students" title="No names yet" description={canManage && ev.status !== "CANCELLED" ? "Search for students above and add them to an item." : "Names appear here as the teachers in charge take them."} />
            ) : (
              <div className="grid gap-5">
                {ev.items.map((item) => {
                  const people = ev.participantsList.filter((p) => p.item === item);
                  return (
                    <section key={item} className="grid gap-2">
                      <h3 className="m-0 flex items-baseline justify-between gap-2 text-body-strong">
                        {item}
                        <span className="text-small font-normal text-ink-muted">{plural(people.length, "name")}</span>
                      </h3>
                      {people.length === 0 ? (
                        <p className="m-0 text-small text-ink-muted">Nobody yet.</p>
                      ) : (
                        <div className="overflow-hidden rounded-md border border-border">
                          <table className="mtb-table mtb-table-dense">
                            <tbody>
                              {[...people]
                                .sort((a, b) => (placeOf(a) ?? 9) - (placeOf(b) ?? 9) || a.name.localeCompare(b.name))
                                .map((p) => (
                                  <tr key={p.id}>
                                    <td>
                                      <span className="grid">
                                        <span className="font-medium">{p.name}</span>
                                        <span className="text-small text-ink-muted">
                                          <span className="mtb-num">{p.studentId}</span> · {p.classSection} · {ACTIVITIES_ROLE_LABEL[p.role]}
                                        </span>
                                      </span>
                                    </td>
                                    <td style={{ width: 170 }}>
                                      <HouseTag name={p.houseName} tone={tones(p.houseName)} />
                                    </td>
                                    <td style={{ width: 150 }}>
                                      {editableResults ? (
                                        <Select
                                          aria-label={`Place for ${p.name}`}
                                          value={String(placeOf(p) ?? "")}
                                          onChange={(e) => setPositions((x) => ({ ...x, [p.id]: e.target.value ? (Number(e.target.value) as ActivitiesPosition) : null }))}
                                          options={[
                                            { value: "", label: "Took part" },
                                            { value: "1", label: "1st place" },
                                            { value: "2", label: "2nd place" },
                                            { value: "3", label: "3rd place" },
                                          ]}
                                        />
                                      ) : (
                                        <PlaceBadge position={p.position} />
                                      )}
                                    </td>
                                    <td style={{ width: 160 }} className="text-small text-ink-muted">
                                      {p.certificateNo ?? ""}
                                    </td>
                                    {canManage && ev.status !== "DONE" && ev.status !== "CANCELLED" && (
                                      <td style={{ width: 52 }}>
                                        <IconButton icon="trash" label={`Remove ${p.name} from ${item}`} onClick={() => removeMut.mutate(p.id)} disabled={removeMut.isPending} />
                                      </td>
                                    )}
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>
                  );
                })}
                {results.isError && <Banner tone="danger">{errorText(results.error)}</Banner>}
              </div>
            )}
          </Panel>
        </div>

        <div className="grid content-start gap-6">
          <Panel id="about" title="Details" rise={2}>
            <KeyValue
              items={[
                ["When", `${formatLongDate(ev.date)}${ev.endDate && ev.endDate !== ev.date ? ` to ${formatDate(ev.endDate)}` : ""}${ev.time ? `, ${ev.time}` : ""}`],
                ["Where", ev.venue],
                ["For", ev.forClasses],
                ["In charge", ev.inCharge.join(", ") || "—"],
                ["House points", ev.houseEvent ? `1st ${ev.pointsRule.first} · 2nd ${ev.pointsRule.second} · 3rd ${ev.pointsRule.third} · taking part ${ev.pointsRule.participation}` : "Not a house event"],
                ...(ev.description ? ([["Notes", ev.description]] as Array<[string, string]>) : []),
              ]}
            />
          </Panel>
          {ev.houseEvent && houseRows.length > 0 && (
            <Panel id="ev-houses" title="House points from this event" description={dirty ? "With the places you have chosen (not saved yet)" : ev.status === "DONE" ? "Posted to the points table" : "So far, for taking part"} rise={3}>
              <BarList label="House points from this event" format={(v) => `${v} pts`} rows={houseRows} />
            </Panel>
          )}
          <Panel id="ev-history" title="History" rise={4}>
            <Timeline items={[...ev.history].reverse().map((h) => ({ id: h.id, date: h.at.slice(0, 10), title: `${h.action} · ${h.by}`, description: h.detail }))} />
          </Panel>
        </div>
      </div>

      <ConfirmDialog
        open={confirmResults}
        onClose={() => setConfirmResults(false)}
        onConfirm={() => results.mutate()}
        title={ev.status === "DONE" ? "Save corrected results?" : "Record the results?"}
        message={ev.houseEvent ? "House points are posted to the points table straight away. Certificates can then be printed for the winners." : "Certificates can then be printed for the winners."}
        details={houseRows.map((h) => [h.label, `${h.value} points`] as [string, string])}
        confirmLabel={ev.status === "DONE" ? "Save corrections" : "Record results"}
        loading={results.isPending}
        error={results.isError ? errorText(results.error) : undefined}
      />
      <ConfirmDialog
        open={cancel}
        onClose={() => setCancel(false)}
        onConfirm={() => {
          setTried(true);
          if (reason.trim().length >= 5) cancelMut.mutate();
        }}
        tone="danger"
        title={`Cancel ${ev.title}?`}
        message={ev.participants ? `${plural(ev.participants, "name")} taken will stay on record. Tell parents through SMS if needed.` : "It stays on the calendar, struck through."}
        confirmLabel="Cancel event"
        cancelLabel="Keep event"
        loading={cancelMut.isPending}
        error={cancelMut.isError ? errorText(cancelMut.error) : undefined}
      >
        <Textarea label="Reason" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} error={tried && reason.trim().length < 5 ? "Say why, so teachers and parents know." : undefined} />
      </ConfirmDialog>
      {editing && <EventPanel event={ev} onClose={() => setEditing(false)} />}
      {printing && (
        <PrintLayer paper="A4" onDone={() => setPrinting(false)}>
          <SportsListDoc
            campus={ev.campus}
            session={ev.session}
            title={ev.kind === "SPORTS" ? "Sports list" : "Participants list"}
            titleUr={ev.kind === "SPORTS" ? "کھیلوں کی فہرست" : "شرکاء کی فہرست"}
            heading={`${ev.title} · ${formatLongDate(ev.date)} · ${ev.venue}`}
            note={
              ev.status === "CANCELLED"
                ? `This event was cancelled${ev.cancelReason ? `: ${ev.cancelReason}` : "."}`
                : ev.status === "DONE"
                ? `Results recorded.${ev.houseEvent ? ` House points: 1st ${ev.pointsRule.first}, 2nd ${ev.pointsRule.second}, 3rd ${ev.pointsRule.third}, taking part ${ev.pointsRule.participation}.` : ""}`
                : "Places are not recorded yet: the Place column is left blank to fill in on the day."
            }
            rows={eventListRows(ev)}
            itemOrder={ev.items}
            signs={["Teacher in charge", "House masters", "Principal"]}
          />
        </PrintLayer>
      )}
    </Page>
  );
}

function AddNames({ ev }: { ev: ActivitiesEventDetail }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [item, setItem] = useState(ev.items[0] ?? "");
  const [role, setRole] = useState<ActivitiesRole>("PARTICIPANT");
  const [picked, setPicked] = useState<ActivitiesPerson[]>([]);
  const add = useMutation({
    mutationFn: () => activitiesApi.addParticipants(ev.id, { studentIds: picked.map((p) => p.id), item, role }),
    onSuccess: () => {
      refresh();
      toast({ title: `${plural(picked.length, "name")} added`, message: `${item} · ${picked.map((p) => p.name).join(", ")}` });
      setPicked([]);
    },
  });
  const already = new Set(ev.participantsList.filter((p) => p.item === item).map((p) => p.studentId));
  return (
    <Panel id="add-names" title="Take names" description="Pick students, choose the item and their part, then add." rise={0}>
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Item" value={item} onChange={(e) => setItem(e.target.value)} options={ev.items} />
          <Select label="Part" value={role} onChange={(e) => setRole(e.target.value as ActivitiesRole)} options={ROLES.map((r) => ({ value: r, label: ACTIVITIES_ROLE_LABEL[r] }))} />
        </div>
        <StudentSearch label="Students" onPick={(p) => setPicked((x) => (x.some((y) => y.id === p.id) ? x : [...x, p]))} exclude={new Set([...already, ...picked.map((p) => p.id)])} />
        {picked.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {picked.map((p) => (
              <PersonChip key={p.id} person={p} onRemove={() => setPicked((x) => x.filter((y) => y.id !== p.id))} />
            ))}
          </div>
        )}
        {add.isError && <Banner tone="danger">{errorText(add.error)}</Banner>}
        <div>
          <Button variant="primary" icon="plus" disabled={picked.length === 0} loading={add.isPending} onClick={() => add.mutate()}>
            Add {picked.length ? plural(picked.length, "name") : "names"} to {item}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
