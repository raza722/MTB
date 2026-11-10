import { activitiesApi, activitiesQueries, ACTIVITIES_ROLE_LABEL, type ActivitiesPosition, type ActivitiesRecordEntry, type ActivitiesRole } from "@mtb/api";
import { formatCount, formatDate, formatSession } from "@mtb/domain";
import { AnimatedNumber, Avatar, Banner, Button, Combobox, DataTable, DatePicker, EmptyState, Input, Panel, Select, SidePanel, StatCard, StatusBadge, Textarea, useToast, type Column } from "@mtb/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { campusLabel } from "../../app/shell/campus";
import { Page, PageHeader } from "../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { RecordDoc } from "./print";
import { ActivitiesNav, AwardBadge, dateLimits, errorField, errorText, HouseTag, LoadError, PlaceBadge, PrintLayer, StudentSearch, useHouseTones, useRefresh, useSessionDays, useToday } from "./shared";

/** A student's co-curricular record across sessions: events, places, house, certificates and scholarships. */
export function RecordsPage({ studentId, onStudent }: { studentId: string | undefined; onStudent: (id: string | undefined) => void }) {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const canManage = useCan("activities.manage") && !readOnly;
  const tones = useHouseTones();
  const q = useQuery(activitiesQueries.record(ctx, studentId ?? ""));
  const [adding, setAdding] = useState(false);
  const [printing, setPrinting] = useState(false);
  const r = q.data;

  const columns: Array<Column<ActivitiesRecordEntry>> = [
    { key: "date", header: "Date", width: 120, render: (e) => <span className="mtb-num">{formatDate(e.date)}</span> },
    {
      key: "title",
      header: "Activity",
      render: (e) => (
        <span className="grid">
          <span className="mtb-cell-primary">
            {e.eventId ? (
              <Link to="/activities/events/$eventId" params={{ eventId: e.eventId }} className="hover:underline">
                {e.title}
              </Link>
            ) : (
              e.title
            )}
          </span>
          <span className="mtb-cell-secondary">
            {e.kindLabel}
            {e.item ? ` · ${e.item}` : ""} · {ACTIVITIES_ROLE_LABEL[e.role]}
          </span>
        </span>
      ),
    },
    {
      key: "result",
      header: "Result",
      width: 280,
      render: (e) => (
        <span className="flex items-center gap-2">
          {e.position ? <PlaceBadge position={e.position} /> : null}
          <span className="text-small">{e.position ? e.achievement.replace(/^\w+ place$/, "") || "" : e.achievement}</span>
        </span>
      ),
    },
    { key: "pts", header: "House points", align: "right", width: 110, render: (e) => (e.housePoints ? <span className="mtb-num">+{e.housePoints}</span> : <span className="text-ink-subtle">—</span>) },
    { key: "cert", header: "Certificate", width: 170, render: (e) => (e.certificateNo ? <span className="mtb-num text-small">{e.certificateNo}</span> : <span className="text-ink-subtle">—</span>) },
  ];

  return (
    <Page>
      <PageHeader
        title="Student records"
        actions={
          r ? (
            <>
              <Button icon="printer" onClick={() => setPrinting(true)}>
                Print record
              </Button>
              {canManage && (
                <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
                  Add a record
                </Button>
              )}
            </>
          ) : undefined
        }
      />
      <ActivitiesNav />
      <Panel id="find" title="Find a student" description="Every event, place, house and certificate is kept with the student, across sessions." rise={0}>
        <div className="max-w-xl">
          <StudentSearch label="Student" onPick={(p) => onStudent(p.id)} />
        </div>
      </Panel>

      {!studentId ? (
        <div className="mtb-card">
          <EmptyState icon="star" title="Search for a student" description="Their co-curricular record appears here: events and places, house history, certificates and scholarships." />
        </div>
      ) : q.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <StatCard key={i} label="" loading />
          ))}
        </div>
      ) : q.isError || !r ? (
        <LoadError what="The record" error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <section className="mtb-card mtb-rise flex flex-wrap items-center gap-4 p-4">
            <Avatar name={r.person.name} size="lg" />
            <div className="grid min-w-0 flex-1">
              <h2 className="m-0 text-title-2">{r.person.name}</h2>
              <p className="m-0 text-small text-ink-muted">
                <span className="mtb-num">{r.person.id}</span> · Class {r.person.classSection} · {r.person.father} · {campusLabel(r.person.campus)}
              </p>
            </div>
            <HouseTag name={r.person.house} tone={tones(r.person.house)} />
            {r.person.hasProfile && (
              <Link to="/students/$grNo" params={{ grNo: r.person.id }} className="text-small font-medium text-brand-ink">
                Student profile
              </Link>
            )}
            <Button size="sm" variant="ghost" icon="x" onClick={() => onStudent(undefined)}>
              Clear
            </Button>
          </section>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Activities" icon="star" value={<AnimatedNumber value={r.totals.events} format={formatCount} />} foot="Events, teams and clubs" />
            <StatCard label="Places won" icon="award" value={<AnimatedNumber value={r.totals.places} format={formatCount} />} foot="1st, 2nd or 3rd" />
            <StatCard label="Certificates" icon="file" value={<AnimatedNumber value={r.totals.certificates} format={formatCount} />} foot="Issued with a serial number" />
            <StatCard label="House points earned" icon="flag" value={<AnimatedNumber value={r.totals.housePoints} format={formatCount} />} foot={r.person.house ?? "Not in a house"} />
          </div>

          <Panel id="record" title="Co-curricular record" description="Newest first, every session" rise={1} flush>
            <DataTable caption={`Co-curricular record, ${r.person.name}`} columns={columns} rows={r.entries} density="dense" empty={<EmptyState icon="star" title="Nothing recorded yet" description="Taking names for an event adds it here; teachers can add outside achievements too." />} />
          </Panel>

          <div className="grid gap-6 xl:grid-cols-2">
            <Panel id="rec-awards" title="Scholarships" rise={2}>
              {r.awards.length === 0 ? (
                <EmptyState icon="award" title="No scholarships" />
              ) : (
                <ul className="m-0 grid list-none gap-2 p-0">
                  {r.awards.map((a) => (
                    <li key={a.id}>
                      <Link to="/activities/scholarships" search={((prev: Record<string, unknown>) => ({ ...prev, award: a.id })) as never} className="act-row">
                        <span className="grid min-w-0 flex-1">
                          <span className="font-medium">{a.schemeName}</span>
                          <span className="text-small text-ink-muted">
                            {a.valueText} · session {formatSession(a.session)} · <span className="mtb-num">{a.awardNo}</span>
                          </span>
                        </span>
                        <AwardBadge status={a.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel id="rec-house" title="House history" rise={3}>
              {r.houseHistory.length === 0 ? (
                <EmptyState icon="flag" title="Not in a house yet" description="Put the student in a house from Houses → Members." />
              ) : (
                <ul className="m-0 grid list-none gap-2 p-0">
                  {[...r.houseHistory].reverse().map((h) => (
                    <li key={`${h.houseName}-${h.from}`} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                      <HouseTag name={h.houseName} tone={tones(h.houseName)} />
                      <span className="text-small text-ink-muted">
                        <span className="mtb-num">{formatDate(h.from)}</span> to {h.to ? <span className="mtb-num">{formatDate(h.to)}</span> : "now"}
                      </span>
                      {!h.to && <StatusBadge status="success">Current</StatusBadge>}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
          {adding && <AddRecordPanel studentId={r.person.id} name={r.person.name} onClose={() => setAdding(false)} />}
          {printing && (
            <PrintLayer paper="A4" onDone={() => setPrinting(false)}>
              <RecordDoc record={r} />
            </PrintLayer>
          )}
        </>
      )}
    </Page>
  );
}

const recordSchema = z.object({
  title: z.string().trim().min(3, "Say what the activity was, for example “Inter-school cricket tournament”."),
  date: z.string({ error: "Choose the date." }).min(1, "Choose the date."),
  achievement: z.string().trim().min(3, "Describe the part played or the result."),
});

function AddRecordPanel({ studentId, name, onClose }: { studentId: string; name: string; onClose: () => void }) {
  const ctx = useCtx();
  const today = useToday();
  const { starts } = useSessionDays();
  const toast = useToast();
  const refresh = useRefresh();
  const catalogue = useQuery(activitiesQueries.catalogue(ctx));
  const [f, setF] = useState({ activityId: "", title: "", date: null as string | null, role: "PARTICIPANT" as ActivitiesRole, position: "", achievement: "" });
  const [tried, setTried] = useState(false);
  const check = recordSchema.safeParse({ title: f.title, date: f.date ?? "", achievement: f.achievement });
  const errs: Record<string, string> = check.success ? {} : Object.fromEntries(check.error.issues.map((i) => [String(i.path[0]), i.message]));
  const save = useMutation({
    mutationFn: () => activitiesApi.addRecord(ctx, studentId, { title: f.title.trim(), activityId: f.activityId || null, date: f.date!, role: f.role, position: f.position ? (Number(f.position) as ActivitiesPosition) : null, achievement: f.achievement.trim() }),
    onSuccess: () => {
      refresh();
      toast({ title: "Added to the record", message: `${name}: ${f.title.trim()}` });
      onClose();
    },
  });
  const sf = save.isError ? errorField(save.error) : undefined;
  const err = (k: string) => (tried ? errs[k] : undefined) ?? (sf === k ? errorText(save.error) : undefined);
  return (
    <SidePanel
      open
      onClose={onClose}
      title={`Add to ${name}'s record`}
      description="For achievements outside the school calendar: inter-school matches, clubs, competitions elsewhere."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => {
              setTried(true);
              if (check.success) save.mutate();
            }}
          >
            Add to record
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Combobox
          label="Activity"
          value={f.activityId || null}
          onValueChange={(v) => {
            const a = catalogue.data?.activities.find((x) => x.id === v);
            setF({ ...f, activityId: v, title: f.title || (a?.name ?? "") });
          }}
          options={(catalogue.data?.activities ?? []).filter((a) => a.active && a.kind !== "DUTY").map((a) => ({ value: a.id, label: a.name, hint: a.kind === "SPORT" ? "Sport" : a.kind === "CLUB" ? "Club" : "Competition" }))}
          placeholder="Choose from the list (optional)"
          help="Keeps the sports and clubs lists tidy for reports."
        />
        <Input label="What it was" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} error={err("title")} placeholder="Inter-school cricket tournament, Sadiqabad (Under-15)" />
        <div className="grid gap-4 sm:grid-cols-3">
          <DatePicker label="Date" required value={f.date} onValueChange={(d) => setF({ ...f, date: d })} {...dateLimits(starts, today)} today={today} error={err("date")} />
          <Select label="Part" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as ActivitiesRole })} options={(Object.keys(ACTIVITIES_ROLE_LABEL) as ActivitiesRole[]).map((r) => ({ value: r, label: ACTIVITIES_ROLE_LABEL[r] }))} />
          <Select
            label="Place"
            value={f.position}
            onChange={(e) => setF({ ...f, position: e.target.value })}
            options={[
              { value: "", label: "None" },
              { value: "1", label: "1st" },
              { value: "2", label: "2nd" },
              { value: "3", label: "3rd" },
            ]}
          />
        </div>
        <Textarea label="Result or part played" required rows={3} value={f.achievement} onChange={(e) => setF({ ...f, achievement: e.target.value })} error={err("achievement")} placeholder="Played as wicket-keeper; the school team reached the semi-final." />
        {save.isError && !sf && <Banner tone="danger">{errorText(save.error)}</Banner>}
      </div>
    </SidePanel>
  );
}
