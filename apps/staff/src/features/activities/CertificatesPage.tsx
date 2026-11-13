import { activitiesApi, activitiesQueries, ACTIVITIES_CERT_TYPE_LABEL, type ActivitiesCertificate, type ActivitiesCertType, type ActivitiesPerson } from "@mtb/api";
import { formatDate, formatSession } from "@mtb/domain";
import { Banner, Button, Checkbox, DataTable, EmptyState, Input, Pagination, Panel, Segmented, Select, Skeleton, Textarea, useToast, type Column } from "@mtb/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { campusLabel } from "../../app/shell/campus";
import { Page, PageHeader, RequireSingleCampus } from "../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { CertificateDoc } from "./print";
import { ActivitiesNav, DocPreview, errorText, LoadError, PersonChip, PlaceBadge, plural, PrintLayer, StudentSearch, useRefresh, useToday } from "./shared";

type IssueType = Exclude<ActivitiesCertType, "SCHOLARSHIP">;

/** Certificates of merit, participation and appreciation: issue with a serial number, print on A4, reprint as duplicate. */
export function CertificatesPage({ eventId, onEvent }: { eventId: string | undefined; onEvent: (id: string | undefined) => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const refresh = useRefresh();
  const readOnly = useReadOnly();
  const canManage = useCan("activities.manage") && !readOnly;
  const log = useQuery(activitiesQueries.certificates(ctx));
  const [printing, setPrinting] = useState<ActivitiesCertificate[] | null>(null);
  const [selected, setSelected] = useState<Set<unknown>>(new Set());
  const [page, setPage] = useState(1);
  const [type, setType] = useState<"ALL" | ActivitiesCertType>("ALL");
  const rows = (log.data ?? []).filter((c) => type === "ALL" || c.type === type);
  const pageSize = 20;

  const reprint = useMutation({
    mutationFn: () => activitiesApi.recordPrint([...selected] as string[]),
    onSuccess: (list) => {
      refresh();
      setSelected(new Set());
      setPrinting(list);
      toast({ tone: "info", title: `${plural(list.length, "certificate")} sent to the printer`, message: "Reprints carry the word “Duplicate”." });
    },
  });

  const columns: Array<Column<ActivitiesCertificate>> = [
    { key: "no", header: "Certificate no.", width: 190, render: (c) => <span className="mtb-num">{c.certNo}</span> },
    {
      key: "student",
      header: "Student",
      render: (c) => (
        <span className="grid">
          <span className="mtb-cell-primary">{c.studentName}</span>
          <span className="mtb-cell-secondary">
            <span className="mtb-num">{c.studentId}</span> · {c.classSection}
            {ctx.campus === "ALL" ? ` · ${campusLabel(c.campus)}` : ""}
          </span>
        </span>
      ),
    },
    {
      key: "for",
      header: "For",
      render: (c) => (
        <span className="grid">
          <span>{ACTIVITIES_CERT_TYPE_LABEL[c.type]}</span>
          <span className="mtb-cell-secondary truncate">
            {c.eventTitle}
            {c.item ? ` · ${c.item}` : ""}
          </span>
        </span>
      ),
    },
    { key: "place", header: "Place", width: 90, render: (c) => <PlaceBadge position={c.position} /> },
    { key: "issued", header: "Issued", width: 170, render: (c) => <span className="grid"><span className="mtb-num">{formatDate(c.issuedOn)}</span><span className="mtb-cell-secondary">{c.issuedBy}</span></span> },
    {
      key: "prints",
      header: "Printed",
      align: "right",
      width: 120,
      render: (c) =>
        c.type === "SCHOLARSHIP" ? (
          <Link to="/activities/scholarships" search={((prev: Record<string, unknown>) => ({ ...prev, award: `aw-${(c.eventTitle.split(" · ")[1] ?? "").toLowerCase()}` })) as never} className="text-small text-brand-ink underline">
            Open award
          </Link>
        ) : (
          <span className="mtb-num">{c.prints}×</span>
        ),
    },
  ];

  return (
    <Page>
      <PageHeader title="Certificates" />
      <ActivitiesNav />
      {canManage && (
        <RequireSingleCampus action="certificates">
          <IssuePanel eventId={eventId} onEvent={onEvent} onPrint={setPrinting} />
        </RequireSingleCampus>
      )}
      {log.isError && <LoadError what="Certificates" error={log.error} onRetry={() => void log.refetch()} />}
      <Panel id="issued" title="Issued certificates" description={`Every certificate has a serial number per campus and session · ${campusLabel(ctx.campus)}, session ${formatSession(ctx.session)}`} rise={2} flush>
        <DataTable
          caption="Issued certificates"
          columns={columns}
          rows={rows.slice((page - 1) * pageSize, page * pageSize)}
          loading={log.isLoading}
          density="dense"
          selectable
          selected={selected}
          onSelectedChange={setSelected}
          isRowSelectable={(c) => c.type !== "SCHOLARSHIP"}
          toolbar={
            <>
              <Segmented
                aria-label="Type"
                value={type}
                onChange={(v) => (setType(v as typeof type), setPage(1))}
                options={[
                  { value: "ALL", label: "All" },
                  { value: "MERIT", label: "Merit" },
                  { value: "PARTICIPATION", label: "Participation" },
                  { value: "APPRECIATION", label: "Appreciation" },
                  { value: "SCHOLARSHIP", label: "Award letters" },
                ]}
              />
              <Button icon="printer" disabled={selected.size === 0} loading={reprint.isPending} onClick={() => reprint.mutate()}>
                Reprint {selected.size || ""}
              </Button>
            </>
          }
          pagination={rows.length > pageSize ? <Pagination page={page} pageSize={pageSize} total={rows.length} onPageChange={setPage} /> : undefined}
          empty={<EmptyState icon="file" title="No certificates issued" description="Issue merit and participation certificates once an event's results are recorded." />}
        />
      </Panel>
      {reprint.isError && <Banner tone="danger">{errorText(reprint.error)}</Banner>}
      {printing && (
        <PrintLayer paper="A4L" onDone={() => setPrinting(null)}>
          {printing.map((c) => (
            <CertificateDoc key={c.id} cert={c} duplicate={c.prints > 1} />
          ))}
        </PrintLayer>
      )}
    </Page>
  );
}

function IssuePanel({ eventId, onEvent, onPrint }: { eventId: string | undefined; onEvent: (id: string | undefined) => void; onPrint: (list: ActivitiesCertificate[]) => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const refresh = useRefresh();
  const today = useToday();
  const events = useQuery(activitiesQueries.events(ctx));
  const [type, setType] = useState<IssueType>("MERIT");
  const held = (events.data ?? []).filter((e) => e.date <= today && e.status !== "CANCELLED" && e.participants > 0 && (type !== "MERIT" || e.status === "DONE")).sort((a, b) => b.date.localeCompare(a.date));
  const evId = eventId && held.some((e) => e.id === eventId) ? eventId : "";
  const ev = useQuery({ ...activitiesQueries.event(ctx, evId), enabled: evId !== "" });
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [people, setPeople] = useState<ActivitiesPerson[]>([]);
  const [title, setTitle] = useState("");
  const [wording, setWording] = useState("");
  const [tried, setTried] = useState(false);
  const eligible = (ev.data?.participantsList ?? []).filter((p) => (type === "MERIT" ? p.position !== null : true));
  const issue = useMutation({
    mutationFn: async () => {
      const list = await activitiesApi.issueCertificates(ctx, type === "APPRECIATION" ? { type, studentIds: people.map((p) => p.id), title: title.trim(), ...(wording.trim() ? { wording: wording.trim() } : {}) } : { type, eventId: evId, participantIds: [...ticked] });
      return activitiesApi.recordPrint(list.map((c) => c.id));
    },
    onSuccess: (list) => {
      refresh();
      setTicked(new Set());
      setPeople([]);
      onPrint(list);
      const dup = list.filter((c) => c.prints > 1).length;
      toast({ title: `${plural(list.length, "certificate")} issued`, message: dup ? `${dup} had been issued before and print as duplicates.` : `Serial numbers ${list[0]?.certNo ?? ""}${list.length > 1 ? ` to ${list[list.length - 1]?.certNo}` : ""}.` });
    },
  });
  const count = type === "APPRECIATION" ? people.length : ticked.size;
  const appreciationError = type === "APPRECIATION" && title.trim().length < 5 ? "Say what it is for, for example “outstanding service as a library prefect”." : undefined;

  // A draft of the first certificate for the preview.
  const first = type === "APPRECIATION" ? people[0] : eligible.find((p) => ticked.has(p.id));
  const campus = ctx.campus === "ALL" ? null : ctx.campus;
  const draft: ActivitiesCertificate | null = first && campus
    ? {
        id: "draft",
        certNo: "Given when issued",
        campus,
        session: ctx.session,
        type,
        studentId: "studentId" in first ? first.studentId : first.id,
        studentName: first.name,
        father: first.father,
        relation: first.relation,
        classSection: first.classSection,
        houseName: "houseName" in first ? first.houseName : first.house,
        eventId: evId || null,
        eventTitle: type === "APPRECIATION" ? title || "…" : (ev.data?.title ?? ""),
        eventDate: ev.data?.date ?? null,
        item: "item" in first ? first.item : null,
        role: "role" in first ? first.role : null,
        position: "position" in first ? first.position : null,
        wording:
          wording.trim() ||
          (type === "MERIT" && "position" in first
            ? `for winning ${["", "1st", "2nd", "3rd"][first.position ?? 1]} place in ${first.item} at the ${ev.data?.title ?? ""} held on ${ev.data ? formatDate(ev.data.date) : ""}.`
            : type === "PARTICIPATION" && "item" in first
              ? `for taking part in ${first.item} at the ${ev.data?.title ?? ""} held on ${ev.data ? formatDate(ev.data.date) : ""}.`
              : `in appreciation of ${title.trim() || "…"}.`),
        issuedOn: today,
        issuedBy: "",
        prints: 0,
      }
    : null;

  return (
    <Panel id="issue" title="Issue certificates" description="Pick the kind, the event and the students. Each gets a serial number; the second print says “Duplicate”." rise={1}>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-4">
          <Segmented
            aria-label="Kind of certificate"
            value={type}
            onChange={(v) => {
              setType(v as IssueType);
              setTicked(new Set());
              setTried(false);
            }}
            options={[
              { value: "MERIT", label: "Merit (places)" },
              { value: "PARTICIPATION", label: "Participation" },
              { value: "APPRECIATION", label: "Appreciation" },
            ]}
          />
          {type === "APPRECIATION" ? (
            <>
              <Input label="In appreciation of" required value={title} onChange={(e) => setTitle(e.target.value)} error={tried ? appreciationError : undefined} placeholder="outstanding service as a library prefect in 2026–27" />
              <StudentSearch label="Students" onPick={(p) => setPeople((x) => (x.some((y) => y.id === p.id) ? x : [...x, p]))} exclude={new Set(people.map((p) => p.id))} />
              {people.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {people.map((p) => (
                    <PersonChip key={p.id} person={p} onRemove={() => setPeople((x) => x.filter((y) => y.id !== p.id))} />
                  ))}
                </div>
              )}
              <Textarea label="Wording (optional)" rows={2} value={wording} onChange={(e) => setWording(e.target.value)} help="Leave empty to use “in appreciation of …”." />
            </>
          ) : (
            <>
              <Select
                label="Event"
                value={evId}
                onChange={(e) => {
                  onEvent(e.target.value || undefined);
                  setTicked(new Set());
                }}
                help={type === "MERIT" ? "Events with results recorded." : "Events already held."}
                options={[{ value: "", label: events.isLoading ? "Loading…" : held.length ? "Choose…" : "No events yet" }, ...held.map((e) => ({ value: e.id, label: `${formatDate(e.date)} · ${e.title}` }))]}
              />
              {evId && ev.isLoading && <Skeleton height={120} />}
              {evId && ev.data && (
                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="mtb-label">{type === "MERIT" ? "Place winners" : "Participants"}</span>
                    <Button size="sm" variant="quiet" onClick={() => setTicked(ticked.size === eligible.length ? new Set() : new Set(eligible.map((p) => p.id)))}>
                      {ticked.size === eligible.length ? "Clear all" : "Tick all"}
                    </Button>
                  </div>
                  <ul className="m-0 grid max-h-72 list-none gap-1 overflow-auto rounded-md border border-border p-2">
                    {eligible.length === 0 && <li className="p-2 text-small text-ink-muted">Nobody to issue to.</li>}
                    {eligible.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2">
                        <Checkbox
                          label={
                            <span>
                              {p.name} <span className="text-ink-muted">· {p.classSection} · {p.item}</span>
                            </span>
                          }
                          checked={ticked.has(p.id)}
                          onChange={() =>
                            setTicked((x) => {
                              const n = new Set(x);
                              if (n.has(p.id)) n.delete(p.id);
                              else n.add(p.id);
                              return n;
                            })
                          }
                        />
                        <span className="flex items-center gap-2 text-small text-ink-muted">
                          {p.position && <PlaceBadge position={p.position} />}
                          {p.certificateNo && <span title="Issued before">{p.certificateNo}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          {issue.isError && <Banner tone="danger">{errorText(issue.error)}</Banner>}
          <div>
            <Button
              variant="primary"
              icon="printer"
              disabled={count === 0}
              loading={issue.isPending}
              onClick={() => {
                setTried(true);
                if (!appreciationError) issue.mutate();
              }}
            >
              Issue and print {count ? plural(count, "certificate") : ""}
            </Button>
          </div>
        </div>
        <div className="grid content-start gap-2">
          <span className="mtb-label">Preview (A4 landscape)</span>
          {draft ? (
            <DocPreview zoom={0.42} label="Certificate preview">
              <CertificateDoc cert={draft} />
            </DocPreview>
          ) : (
            <div className="mtb-card">
              <EmptyState icon="file" title="Nothing to preview" description="Tick a student to see their certificate." />
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
