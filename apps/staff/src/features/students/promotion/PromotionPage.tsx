import {
  newIdempotencyKey,
  STUDENT_PROMOTION_OUTCOME_LABEL,
  studentPromotionApi,
  studentPromotionQueries,
  studentsQueries,
  type StudentPromotionCandidate,
  type StudentPromotionClassDetail,
  type StudentPromotionItem,
  type StudentPromotionOutcome,
} from "@mtb/api";
import { formatCount, formatDate, formatDateTime, formatSession } from "@mtb/domain";
import { AnimatedNumber, Banner, Button, buttonClassName, ConfirmDialog, cx, DataTable, EmptyState, Icon, Modal, Panel, Segmented, Select, Skeleton, StatCard, StatusBadge, useToast, type Column } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Page, PageHeader, RequirePermission, RequireSingleCampus } from "../../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../../app/session";
import { apiMessage, classShortOf, LoadError, SeatMeter, sectionOf, stagger, StudentsSubNav, useClassLabel } from "../shared";

type Decision = { outcome: StudentPromotionOutcome; toSection: string; stream: string };
type Gender = "all" | "M" | "F";

const GRADE_TONE = (g: string) => (g === "A+" || g === "A" ? "success" : g === "B" || g === "C" ? "info" : g === "D" ? "warning" : "danger");

function ClassDetail({ cs, detail, onDone }: { cs: string; detail: StudentPromotionClassDetail; onDone: () => void }) {
  const ctx = useCtx();
  const classLabel = useClassLabel(ctx.campus);
  const toast = useToast();
  const queryClient = useQueryClient();
  const canEdit = useCan("students.edit");
  const readOnly = useReadOnly();
  const curShort = classShortOf(cs);
  const curSec = sectionOf(cs);
  const next = detail.nextClass;
  const destSections = detail.destination.map((d) => d.section);
  // Groups of the class each student lands in: next class when promoted, this class when repeating.
  const groupsFor = (o: StudentPromotionOutcome) => (o === "PROMOTE" ? detail.nextGroups : o === "DETAIN" ? detail.groups : []);
  const hasGroups = detail.nextGroups.length > 0 || detail.groups.length > 0;
  const allGroups = detail.nextGroups.length ? detail.nextGroups : detail.groups;
  const groupIn = (c: StudentPromotionCandidate, o: StudentPromotionOutcome, cur?: string) => {
    const list = groupsFor(o);
    if (!list.length) return "";
    return [cur, c.stream, c.suggestedStream].find((g) => g && list.includes(g)) ?? list[0] ?? "";
  };
  const initial = () => new Map<string, Decision>(detail.candidates.map((c) => [c.grNo, { outcome: c.suggestion, toSection: destSections.includes(curSec) ? curSec : (destSections[0] ?? curSec), stream: groupIn(c, c.suggestion) }]));
  const [decisions, setDecisions] = useState<Map<string, Decision>>(initial);
  const [filter, setFilter] = useState<"all" | "review">("all");
  const [gender, setGender] = useState<Gender>("all");
  const [bulkFrom, setBulkFrom] = useState("*");
  const [bulkTo, setBulkTo] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  useEffect(() => {
    setDecisions(initial());
    setFilter("all");
    setGender("all");
    setBulkFrom("*");
    setBulkTo("");
    setKey(newIdempotencyKey());
  }, [cs, detail.done?.id, detail.candidates.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const items: StudentPromotionItem[] = detail.candidates.map((c) => {
    const d = decisions.get(c.grNo)!;
    return { grNo: c.grNo, outcome: d.outcome, ...(d.outcome === "PROMOTE" || d.outcome === "DETAIN" ? { toSection: d.toSection } : {}), ...(d.stream && groupsFor(d.outcome).includes(d.stream) ? { stream: d.stream } : {}) };
  });
  const groupCount = (g: string) => items.filter((i) => i.outcome === (next ? "PROMOTE" : "DETAIN") && i.stream === g).length;
  const groupLine = allGroups.length ? allGroups.map((g) => `${g} ${groupCount(g)}`).join(" · ") : "";
  const count = (o: StudentPromotionOutcome) => items.filter((i) => i.outcome === o).length;
  const toNext = (sec: string) => items.filter((i) => i.outcome === "PROMOTE" && i.toSection === sec).length;
  const overfull = detail.destination.filter((d) => d.placed + toNext(d.section) > d.seats);
  const review = detail.candidates.filter((c) => c.suggestion !== (next ? "PROMOTE" : "PASS_OUT") || c.note);
  const rows = (filter === "review" ? review : detail.candidates).filter((c) => gender === "all" || c.gender === gender);
  const boys = detail.candidates.filter((c) => c.gender === "M").length;
  const nowGroups = [...new Set(detail.candidates.map((c) => c.stream).filter((g): g is string => Boolean(g)))].sort();
  const bulkRows = rows.filter((c) => (bulkFrom === "*" ? true : bulkFrom === "" ? !c.stream : c.stream === bulkFrom) && groupsFor(decisions.get(c.grNo)!.outcome).includes(bulkTo));
  const setGroupFor = () => {
    setDecisions((m) => {
      const n = new Map(m);
      for (const c of bulkRows) n.set(c.grNo, { ...n.get(c.grNo)!, stream: bulkTo });
      return n;
    });
    toast({ title: `Group set for ${bulkRows.length} ${bulkRows.length === 1 ? "student" : "students"}`, message: `${bulkTo}. Nothing is saved until you promote the class.` });
  };
  const byGr = new Map(detail.candidates.map((c) => [c.grNo, c]));
  const changes = items.filter((i) => i.toSection && i.toSection !== curSec);

  const run = useMutation({
    mutationFn: () => studentPromotionApi.run(ctx, cs, items, key),
    onSuccess: (batch) => {
      setConfirming(false);
      setPreviewing(false);
      void queryClient.invalidateQueries({ queryKey: studentPromotionQueries.all() });
      void queryClient.invalidateQueries({ queryKey: studentsQueries.all() });
      toast({ title: `${cs} promoted to ${formatSession(batch.toSession)}`, message: batch.summary });
      onDone();
    },
  });

  const set = (grNo: string, patch: Partial<Decision>) =>
    setDecisions((m) => {
      const n = new Map(m);
      const cur = n.get(grNo)!;
      const outcome = patch.outcome ?? cur.outcome;
      const c = byGr.get(grNo)!;
      // Repeating stays in this class: default back to the student's own section.
      n.set(grNo, {
        outcome,
        toSection: patch.toSection ?? (patch.outcome === "DETAIN" ? curSec : patch.outcome === "PROMOTE" ? cur.toSection : cur.toSection),
        stream: patch.stream ?? groupIn(c, outcome, cur.stream),
      });
      return n;
    });
  const setAll = (outcome: StudentPromotionOutcome) => setDecisions(new Map(detail.candidates.map((c) => [c.grNo, { outcome, toSection: decisions.get(c.grNo)?.toSection ?? curSec, stream: groupIn(c, outcome, decisions.get(c.grNo)?.stream) }])));

  if (detail.done) {
    const b = detail.done;
    return (
      <div className="grid gap-4">
        <Banner tone="success" title={`${cs} was promoted on ${formatDate(b.at.slice(0, 10))}`}>
          {b.summary}. Recorded by {b.by} at {formatDateTime(b.at)}. Each student's class history shows the decision.
        </Banner>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ["Promoted", b.promoted],
              ["Repeating", b.detained],
              ["Passing out", b.passedOut],
              ["Leaving", b.left],
            ] as Array<[string, number]>
          ).map(([k, v]) => (
            <div key={k} className="grid rounded-lg bg-surface-sunken px-3 py-2">
              <span className="text-small text-ink-muted">{k}</span>
              <b className="text-title-2 tabular-nums">{v}</b>
            </div>
          ))}
        </div>
        <Link to="/students" search={(prev: Record<string, unknown>) => ({ ...prev, cls: curShort, sec: curSec }) as never} className={buttonClassName({ size: "sm" })}>
          Show the students of {cs}
        </Link>
      </div>
    );
  }
  if (detail.candidates.length === 0) return <EmptyState icon="students" title="No students to promote" description={`Nobody is enrolled in ${cs} right now.`} />;

  const outcomeOptions: StudentPromotionOutcome[] = next ? ["PROMOTE", "DETAIN", "LEFT"] : ["PASS_OUT", "DETAIN", "LEFT"];
  const columns: Array<Column<StudentPromotionCandidate>> = [
    { key: "rollNo", header: "Roll", align: "right", width: 56, render: (c) => <span className="tabular-nums">{c.rollNo || "—"}</span> },
    {
      key: "name",
      header: "Student",
      render: (c) => (
        <span className="grid">
          <Link to="/students/$grNo" params={{ grNo: c.grNo }} className="mtb-cell-primary text-ink underline-offset-2 hover:underline">
            {c.name}
          </Link>
          <span className="mtb-cell-secondary">
            {c.relation} {c.father} · <span className="mtb-mono">{c.grNo}</span>
            {c.stream && ` · ${c.stream} now`}
          </span>
        </span>
      ),
    },
    {
      key: "result",
      header: "First Term",
      width: 130,
      render: (c) =>
        c.latestResult ? (
          <span className="flex items-center gap-2">
            <span className="tabular-nums">{c.latestResult.percent}%</span>
            <StatusBadge status={GRADE_TONE(c.latestResult.grade)}>{c.latestResult.grade}</StatusBadge>
          </span>
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
    },
    { key: "att", header: "Attendance", align: "right", width: 100, render: (c) => (c.attendancePercent === null ? <span className="text-ink-subtle" title="No attendance registers for this session yet">—</span> : <span className={cx("tabular-nums", c.attendancePercent < 75 && "font-semibold text-warning-ink")}>{c.attendancePercent}%</span>) },
    { key: "fee", header: "Fees", width: 100, render: (c) => <StatusBadge status={c.feeStatus} /> },
    {
      key: "outcome",
      header: "Decision",
      width: 160,
      render: (c) => {
        const d = decisions.get(c.grNo)!;
        return (
          <Select
            aria-label={`Decision for ${c.name}`}
            value={d.outcome}
            disabled={readOnly || !canEdit}
            onChange={(e) => set(c.grNo, { outcome: e.target.value as StudentPromotionOutcome })}
            options={outcomeOptions.map((o) => ({ value: o, label: STUDENT_PROMOTION_OUTCOME_LABEL[o] }))}
          />
        );
      },
    },
    {
      key: "toSection",
      header: next ? `Section in ${classLabel(next)}` : "Section",
      width: 130,
      render: (c) => {
        const d = decisions.get(c.grNo)!;
        if (d.outcome === "LEFT" || d.outcome === "PASS_OUT") return <span className="text-small text-ink-muted">—</span>;
        const opts = d.outcome === "PROMOTE" ? destSections.map((s) => ({ value: s, label: `${next}-${s}` })) : [{ value: curSec, label: `${curShort}-${curSec}` }];
        return <Select aria-label={`Section for ${c.name}`} value={d.toSection} disabled={readOnly || !canEdit || d.outcome === "DETAIN"} onChange={(e) => set(c.grNo, { toSection: e.target.value })} options={opts} />;
      },
    },
    ...(hasGroups
      ? [
          {
            key: "stream",
            header: "Group",
            width: 190,
            render: (c: StudentPromotionCandidate) => {
              const d = decisions.get(c.grNo)!;
              const list = groupsFor(d.outcome);
              if (!list.length) return <span className="text-small text-ink-muted">—</span>;
              return <Select aria-label={`Group for ${c.name}`} value={d.stream} disabled={readOnly || !canEdit} onChange={(e) => set(c.grNo, { stream: e.target.value })} options={list} />;
            },
          } as Column<StudentPromotionCandidate>,
        ]
      : []),
    { key: "note", header: "Advice", render: (c) => (c.note ? <span className="flex items-start gap-1.5 text-small text-warning-ink"><Icon name="alert" size={14} />{c.note}</span> : <span className="text-small text-ink-subtle">—</span>) },
  ];

  return (
    <div className="grid gap-4">
      <Banner tone="info" icon="info">
        Promotion is the school's decision. The First Term result and attendance are shown only as advice; the annual result has not been declared yet. Nothing changes until you confirm, and the move takes effect on 01-Apr-{detail.toSession}.
      </Banner>
      {next && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {detail.destination.map((d) => (
            <div key={d.section} className="rounded-lg border border-border p-3">
              <span className="text-small font-medium text-ink">
                {next}-{d.section} in {formatSession(detail.toSession)}
              </span>
              <SeatMeter enrolled={d.placed + toNext(d.section)} seats={d.seats} label={`${next}-${d.section}`} />
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <Segmented
            aria-label="Show"
            value={filter}
            onChange={(v) => setFilter(v as "all" | "review")}
            options={[
              { value: "all", label: `Everyone · ${detail.candidates.length}` },
              { value: "review", label: `Needs a look · ${review.length}` },
            ]}
          />
          <Segmented
            aria-label="Boys or girls"
            value={gender}
            onChange={(v) => setGender(v as Gender)}
            options={[
              { value: "all", label: "Boys and girls" },
              { value: "M", label: `Boys · ${boys}` },
              { value: "F", label: `Girls · ${detail.candidates.length - boys}` },
            ]}
          />
        </div>
        {canEdit && !readOnly && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setDecisions(initial())}>
              Use advice
            </Button>
            <Button size="sm" onClick={() => setAll(next ? "PROMOTE" : "PASS_OUT")}>
              {next ? "Promote everyone" : "Everyone passes out"}
            </Button>
          </div>
        )}
      </div>
      {hasGroups && canEdit && !readOnly && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border px-4 py-3">
          <Select
            label="Set group for"
            value={bulkFrom}
            onChange={(e) => setBulkFrom(e.target.value)}
            options={[
              { value: "*", label: `Everyone shown (${rows.length})` },
              ...nowGroups.map((g) => ({ value: g, label: `Now in ${g}` })),
              ...(nowGroups.length && detail.candidates.some((c) => !c.stream) ? [{ value: "", label: "No group yet" }] : []),
            ]}
          />
          <Select label="Group" value={bulkTo} onChange={(e) => setBulkTo(e.target.value)} options={[{ value: "", label: "Choose…" }, ...allGroups]} />
          <Button size="sm" disabled={!bulkTo || bulkRows.length === 0} onClick={setGroupFor}>
            {bulkTo ? `Set for ${bulkRows.length} ${bulkRows.length === 1 ? "student" : "students"}` : "Set group"}
          </Button>
          <span className="text-small text-ink-muted">Follows the boys/girls and "Needs a look" filters. Students leaving or passing out get no group.</span>
        </div>
      )}
      <DataTable caption={`Students of ${cs}`} rows={rows} rowKey="grNo" columns={columns} density="dense" maxHeight={520} rowClassName={(c) => (decisions.get(c.grNo)?.outcome !== (next ? "PROMOTE" : "PASS_OUT") ? "is-selected" : undefined)} empty={<EmptyState icon="checkCircle" title="Nothing needs a look" description="Every student here can go up with the class." />} />
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-sunken px-4 py-3">
        <span className="text-small text-ink-muted" aria-live="polite">
          {next ? (
            <>
              <b className="text-ink">{count("PROMOTE")}</b> promote to {classLabel(next)} ·{" "}
            </>
          ) : (
            <>
              <b className="text-ink">{count("PASS_OUT")}</b> pass out ·{" "}
            </>
          )}
          <b className="text-ink">{count("DETAIN")}</b> repeat · <b className="text-ink">{count("LEFT")}</b> leaving
          {changes.length > 0 && ` · ${changes.length} change section`}
          {groupLine && ` · ${groupLine}`}
        </span>
        {canEdit && !readOnly ? (
          <Button variant="primary" icon="arrowUp" disabled={overfull.length > 0} onClick={() => setPreviewing(true)}>
            Review promotion
          </Button>
        ) : (
          <span className="text-small text-ink-muted">{readOnly ? "Past sessions are read-only." : "Only the principal or office can promote."}</span>
        )}
      </div>
      {overfull.length > 0 && <Banner tone="danger">{`${overfull.map((d) => `${next}-${d.section}`).join(" and ")} would be over its seats. Move some students to another section first.`}</Banner>}

      <Modal
        open={previewing}
        onClose={() => setPreviewing(false)}
        size="lg"
        title={`Preview: promote ${cs} to ${formatSession(detail.toSession)}`}
        description="Check the exceptions. Everyone not listed below goes up with the class."
        footer={
          <>
            <Button onClick={() => setPreviewing(false)}>Back to the list</Button>
            <Button variant="primary" icon="arrowUp" onClick={() => setConfirming(true)}>
              Promote {cs}…
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                [next ? "Promote" : "Pass out", next ? count("PROMOTE") : count("PASS_OUT")],
                ["Repeat", count("DETAIN")],
                ["Leaving", count("LEFT")],
                ["Section change", changes.length],
              ] as Array<[string, number]>
            ).map(([k, v]) => (
              <div key={k} className="grid rounded-lg bg-surface-sunken px-3 py-2">
                <span className="text-small text-ink-muted">{k}</span>
                <b className="text-title-2 tabular-nums">{v}</b>
              </div>
            ))}
          </div>
          {next && (
            <p className="m-0 text-small text-ink-muted">
              Next session: {detail.destination.map((d) => `${next}-${d.section} gets ${toNext(d.section)} (${d.placed + toNext(d.section)} of ${d.seats} seats)`).join(" · ")}
            </p>
          )}
          {groupLine && <p className="m-0 text-small text-ink-muted">Groups{next ? ` in ${classLabel(next)}` : ""}: {groupLine}</p>}
          <ul className="m-0 grid list-none gap-1 p-0">
            {items
              .filter((i) => i.outcome !== (next ? "PROMOTE" : "PASS_OUT") || (i.toSection && i.toSection !== curSec))
              .map((i, n) => {
                const c = byGr.get(i.grNo)!;
                const text = i.outcome === "DETAIN" ? `Repeats ${classLabel(curShort)} (${curShort}-${i.toSection})` : i.outcome === "LEFT" ? "Leaving at the end of the session" : i.outcome === "PASS_OUT" ? "Passes out" : `${cs} → ${next}-${i.toSection}`;
                return (
                  <li key={i.grNo} className="mtb-slide-in flex flex-wrap items-center gap-x-3 border-b border-border py-1.5 text-small last:border-b-0" style={stagger(n)}>
                    <b className="text-ink">{c.name}</b>
                    <span className="text-ink-muted">{text}</span>
                    {c.note && <span className="text-warning-ink">· {c.note}</span>}
                  </li>
                );
              })}
            {items.every((i) => i.outcome === (next ? "PROMOTE" : "PASS_OUT") && (!i.toSection || i.toSection === curSec)) && <li className="text-small text-ink-muted">No exceptions: the whole class goes up together.</li>}
          </ul>
        </div>
      </Modal>
      <ConfirmDialog
        open={confirming}
        onClose={() => {
          setConfirming(false);
          run.reset();
        }}
        onConfirm={() => run.mutate()}
        icon="arrowUp"
        title={`Promote all ${detail.candidates.length} students of ${cs}?`}
        message={`Every student's next-session class is set in one step and recorded in their class history. The seat check covers the whole class: if any section is over, nothing is saved.`}
        details={[
          ["From", `${cs} · ${formatSession(detail.fromSession)}`],
          ["To", next ? `${classLabel(next)} · ${formatSession(detail.toSession)}` : "Passing out"],
          ["Promote / pass out", String(next ? count("PROMOTE") : count("PASS_OUT"))],
          ["Repeat · leaving", `${count("DETAIN")} · ${count("LEFT")}`],
          ...(groupLine ? ([["Groups", groupLine]] as Array<[string, string]>) : []),
        ]}
        requireText="PROMOTE"
        confirmLabel={`Promote ${cs}`}
        loading={run.isPending}
        loadingLabel="Promoting…"
        error={run.error ? apiMessage(run.error) : undefined}
      />
    </div>
  );
}

export function PromotionPage({ cls, setCls }: { cls: string; setCls: (cs: string) => void }) {
  const ctx = useCtx();
  const classLabel = useClassLabel(ctx.campus);
  const readOnly = useReadOnly();
  const overview = useQuery({ ...studentPromotionQueries.overview(ctx), enabled: ctx.campus !== "ALL" });
  const o = overview.data;
  const selected = cls || o?.classes.find((c) => c.status === "NOT_STARTED")?.classSection || o?.classes[0]?.classSection || "";
  const detail = useQuery({ ...studentPromotionQueries.classDetail(ctx, selected), enabled: ctx.campus !== "ALL" && Boolean(selected) });
  const doneCount = o?.totals.classesDone ?? 0;
  const total = o?.classes.length ?? 0;
  const nextOpen = useMemo(() => o?.classes.find((c) => c.status === "NOT_STARTED" && c.classSection !== selected)?.classSection, [o, selected]);

  return (
    <RequirePermission permission="students.view" page="Promotion">
      <Page>
        <PageHeader title="Promotion" meta={o ? <StatusBadge status="info">{`${formatSession(o.fromSession)} → ${formatSession(o.toSession)}`}</StatusBadge> : undefined} />
        <StudentsSubNav />
        <RequireSingleCampus action="promotion">
          {overview.isError && <LoadError what="promotion overview" error={overview.error} onRetry={() => void overview.refetch()} />}
          {readOnly && <Banner tone="info">{`Session ${formatSession(ctx.session)} is closed. This is the record of how its classes were promoted.`}</Banner>}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="mtb-rise" style={stagger(1)}>
              <StatCard label="Classes promoted" icon="listChecks" loading={!o} value={o ? `${doneCount} of ${total}` : undefined} meter={total ? (doneCount / total) * 100 : 0} meterLabel={`${doneCount} of ${total} classes promoted`} />
            </div>
            <div className="mtb-rise" style={stagger(2)}>
              <StatCard label="Promoted" icon="arrowUp" tone="info" loading={!o} value={o ? <AnimatedNumber value={o.totals.promoted} format={formatCount} /> : undefined} foot={o ? `of ${formatCount(o.totals.students)} students` : undefined} />
            </div>
            <div className="mtb-rise" style={stagger(3)}>
              <StatCard label="Repeating a class" icon="refresh" tone="warning" loading={!o} value={o ? <AnimatedNumber value={o.totals.detained} format={formatCount} /> : undefined} foot="decided class by class" />
            </div>
            <div className="mtb-rise" style={stagger(4)}>
              <StatCard label="Passing out or leaving" icon="award" loading={!o} value={o ? <AnimatedNumber value={o.totals.passedOut + o.totals.left} format={formatCount} /> : undefined} foot={o ? `${o.totals.passedOut} pass out · ${o.totals.left} leaving` : undefined} />
            </div>
          </div>
          <div className="grid items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
            <Panel id="promo-classes" rise={5} title="Classes" description="Promote one class at a time" flush>
              {!o ? (
                <div className="grid gap-2 p-4">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} height={44} />
                  ))}
                </div>
              ) : o.classes.length === 0 ? (
                <EmptyState icon="students" title="No classes" description="No students are enrolled at this campus." />
              ) : (
                <ul className="m-0 grid max-h-[640px] list-none gap-1 overflow-y-auto p-2">
                  {o.classes.map((c, i) => {
                    const active = c.classSection === selected;
                    return (
                      <li key={c.classSection} className="mtb-slide-in" style={stagger(i)}>
                        <button type="button" onClick={() => setCls(c.classSection)} aria-current={active ? "true" : undefined} className={cx("flex w-full items-center gap-3 rounded-md px-3 py-2 text-left", active ? "bg-surface-selected" : "hover:bg-surface-hover")}>
                          <span className="grid flex-1">
                            <b className="font-medium text-ink">{c.classSection}</b>
                            <span className="text-small text-ink-muted">
                              {c.students} students · to {c.nextClass ? classLabel(c.nextClass) : "pass out"}
                            </span>
                          </span>
                          {c.status === "DONE" ? <StatusBadge status="success" icon="check">Done</StatusBadge> : <StatusBadge status="pending">To do</StatusBadge>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
            <Panel
              id="promo-detail"
              rise={6}
              title={selected ? `${selected} → ${detail.data?.nextClass ? classLabel(detail.data.nextClass) : "passing out"}` : "Choose a class"}
              description={o ? `From ${formatSession(o.fromSession)} into ${formatSession(o.toSession)}` : undefined}
            >
              {detail.isError ? (
                <LoadError what="class" error={detail.error} onRetry={() => void detail.refetch()} />
              ) : !detail.data ? (
                <div className="grid gap-3">
                  <Skeleton height={56} />
                  <Skeleton height={320} />
                </div>
              ) : (
                <ClassDetail cs={selected} detail={detail.data} onDone={() => nextOpen && setCls(nextOpen)} />
              )}
            </Panel>
          </div>
          {o && o.batches.length > 0 && (
            <Panel id="promo-log" rise={7} title="Promotion log" description="Every class promoted this session, who did it and when">
              <ul className="m-0 grid list-none gap-1 p-0">
                {o.batches.map((b, i) => (
                  <li key={b.id} className="mtb-slide-in flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border py-2 text-small last:border-b-0" style={stagger(i)}>
                    <StatusBadge status="success" icon="arrowUp">
                      {b.fromClassSection}
                    </StatusBadge>
                    <span className="flex-1 text-ink">{b.summary}</span>
                    <span className="text-ink-muted">
                      {b.by} · <span className="tabular-nums">{formatDateTime(b.at)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </RequireSingleCampus>
      </Page>
    </RequirePermission>
  );
}
