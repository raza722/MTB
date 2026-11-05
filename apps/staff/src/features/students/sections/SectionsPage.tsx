import {
  metaQueries,
  newIdempotencyKey,
  SECTION_ALLOTMENT_ROLL_ORDER_LABEL,
  sectionAllotmentApi,
  sectionAllotmentQueries,
  studentsQueries,
  type SectionAllotmentRollOrder,
  type SectionAllotmentSection,
  type SectionAllotmentStudent,
} from "@mtb/api";
import { formatDate } from "@mtb/domain";
import { Banner, Button, buttonClassName, Checkbox, ConfirmDialog, cx, DatePicker, EmptyState, Modal, Panel, Radio, Segmented, Select, Skeleton, StatusBadge, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Page, PageHeader, RequirePermission, RequireSingleCampus } from "../../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../../app/session";
import { apiMessage, LoadError, SeatMeter, stagger, StudentsSubNav, today, useClassLabel } from "../shared";

const REASONS = ["Class strength balancing", "Parent's request", "Sibling in the same section", "Group change", "Discipline", "Other"];

/** "Science (Biology)" → "Biology"; "Humanities" stays. For the small badge beside each name. */
const groupShort = (g: string) => /\(([^)]+)\)/.exec(g)?.[1] ?? g;

function sortForRolls(list: SectionAllotmentStudent[], order: SectionAllotmentRollOrder) {
  return [...list].sort((a, b) => {
    if (order === "GR") return Number(a.grNo.replace(/\D/g, "")) - Number(b.grNo.replace(/\D/g, ""));
    if (order === "ADMISSION") return a.admissionDate.localeCompare(b.admissionDate) || a.name.localeCompare(b.name);
    if (order === "GIRLS_FIRST") return (a.gender === b.gender ? 0 : a.gender === "F" ? -1 : 1) || a.name.localeCompare(b.name);
    return a.name.localeCompare(b.name);
  });
}

function RollNumbersModal({ section, open, onClose }: { section: SectionAllotmentSection | null; open: boolean; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [order, setOrder] = useState<SectionAllotmentRollOrder>("NAME");
  const [confirming, setConfirming] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  useEffect(() => {
    if (open) {
      setOrder("NAME");
      setConfirming(false);
      setKey(newIdempotencyKey());
    }
  }, [open]);
  const assign = useMutation({
    mutationFn: () => sectionAllotmentApi.assignRollNumbers(ctx, { classSection: section!.classSection, order }, key),
    onSuccess: (r) => {
      setConfirming(false);
      onClose();
      void queryClient.invalidateQueries({ queryKey: sectionAllotmentQueries.all() });
      void queryClient.invalidateQueries({ queryKey: studentsQueries.all() });
      toast({ title: `Roll numbers given in ${r.classSection}`, message: `1 to ${r.assigned}, ${SECTION_ALLOTMENT_ROLL_ORDER_LABEL[order].toLowerCase()}.` });
    },
  });
  if (!section) return null;
  const preview = sortForRolls(section.students, order);
  const changed = preview.filter((s, i) => s.rollNo !== i + 1).length;
  return (
    <>
      <Modal
        open={open && !confirming}
        onClose={onClose}
        title={`Roll numbers for ${section.classSection}`}
        description={`${section.students.length} students · registers, attendance and result cards follow this order`}
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={changed === 0} onClick={() => setConfirming(true)}>
              {changed === 0 ? "Already in this order" : `Give roll numbers · ${changed} change`}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <fieldset className="m-0 grid gap-2 border-0 p-0">
            <legend className="mtb-label mb-1">Order</legend>
            {(Object.keys(SECTION_ALLOTMENT_ROLL_ORDER_LABEL) as SectionAllotmentRollOrder[]).map((o) => (
              <Radio key={o} name="roll-order" label={SECTION_ALLOTMENT_ROLL_ORDER_LABEL[o]} checked={order === o} onChange={() => setOrder(o)} />
            ))}
          </fieldset>
          <div className="grid gap-1">
            <span className="mtb-label">Preview</span>
            <ol className="m-0 grid max-h-64 list-none gap-0.5 overflow-y-auto rounded-md bg-surface-sunken p-2 text-small">
              {preview.map((s, i) => (
                <li key={s.grNo} className="flex items-center gap-3">
                  <b className="w-6 text-right tabular-nums text-ink">{i + 1}</b>
                  <span className="flex-1 text-ink">{s.name}</span>
                  {s.rollNo !== i + 1 && <span className="text-ink-muted tabular-nums">was {s.rollNo || "—"}</span>}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </Modal>
      <ConfirmDialog
        open={open && confirming}
        onClose={() => {
          setConfirming(false);
          assign.reset();
        }}
        onConfirm={() => assign.mutate()}
        icon="listChecks"
        title={`Give new roll numbers in ${section.classSection}?`}
        message="Every student gets the roll number shown in the preview. Attendance and marks already entered stay with the student, not the number."
        details={[
          ["Order", SECTION_ALLOTMENT_ROLL_ORDER_LABEL[order]],
          ["Students", String(section.students.length)],
          ["Numbers changing", String(changed)],
        ]}
        confirmLabel="Give roll numbers"
        loading={assign.isPending}
        loadingLabel="Saving…"
        error={assign.error ? apiMessage(assign.error) : undefined}
      />
    </>
  );
}

function MoveModal({
  className,
  sections,
  streams,
  students,
  open,
  onClose,
  onMoved,
}: {
  className: string;
  sections: SectionAllotmentSection[];
  /** Groups offered in this class (from Setup), the same list everywhere. */
  streams: string[];
  students: SectionAllotmentStudent[];
  open: boolean;
  onClose: () => void;
  onMoved: () => void;
}) {
  const ctx = useCtx();
  const classLabel = useClassLabel(ctx.campus);
  const toast = useToast();
  const queryClient = useQueryClient();
  const [toSection, setToSection] = useState("");
  const [date, setDate] = useState<string | null>(today());
  const [reason, setReason] = useState("");
  const [stream, setStream] = useState("");
  const [tried, setTried] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  useEffect(() => {
    if (open) {
      setToSection("");
      setDate(today());
      setReason("");
      setStream("");
      setTried(false);
      setKey(newIdempotencyKey());
    }
  }, [open]);
  const target = sections.find((s) => s.section === toSection);
  const from = new Map(sections.flatMap((s) => s.students.map((x) => [x.grNo, s.classSection] as const)));
  const movers = students.filter((s) => from.get(s.grNo) !== `${className}-${toSection}`);
  const free = target ? target.seats - target.students.length : 0;
  const move = useMutation({
    mutationFn: () => sectionAllotmentApi.move(ctx, { grNos: students.map((s) => s.grNo), toSection, effectiveDate: date ?? today(), reason, ...(stream ? { stream } : {}) }, key),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: sectionAllotmentQueries.all() });
      void queryClient.invalidateQueries({ queryKey: studentsQueries.all() });
      onMoved();
      onClose();
      toast({ title: `${r.moved} ${r.moved === 1 ? "student" : "students"} moved to ${r.toClassSection}`, message: "Each student's class history keeps the old section and the reason." });
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Move ${students.length} ${students.length === 1 ? "student" : "students"}`}
      description={`${classLabel(className)} · the move is dated and kept in each student's history`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon="split"
            loading={move.isPending}
            disabled={Boolean(target) && movers.length > free}
            onClick={() => {
              setTried(true);
              if (toSection && reason && date && movers.length > 0) move.mutate();
            }}
          >
            {toSection ? `Move to ${className}-${toSection}` : "Move"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="To section" required value={toSection} error={tried && !toSection ? "Choose a section." : undefined} onChange={(e) => setToSection(e.target.value)} options={[{ value: "", label: "Choose…" }, ...sections.map((s) => ({ value: s.section, label: `${s.classSection} · ${s.students.length}/${s.seats}` }))]} />
          <DatePicker label="From" required value={date} onValueChange={setDate} error={tried && !date ? "Choose the date." : undefined} />
          <Select label="Reason" required value={reason} error={tried && !reason ? "Choose a reason." : undefined} onChange={(e) => setReason(e.target.value)} options={[{ value: "", label: "Choose…" }, ...REASONS]} />
          {streams.length > 0 && <Select label="Group (optional)" value={stream} onChange={(e) => setStream(e.target.value)} options={[{ value: "", label: "Keep each student's group" }, ...streams]} />}
        </div>
        {target && movers.length > free && <Banner tone="danger">{`${target.classSection} has ${free} free ${free === 1 ? "seat" : "seats"}; you selected ${movers.length}. Move fewer students.`}</Banner>}
        {target && movers.length === 0 && tried && <Banner tone="warning">{`Everyone selected is already in ${target.classSection}.`}</Banner>}
        <ul className="m-0 grid max-h-52 list-none gap-0.5 overflow-y-auto rounded-md bg-surface-sunken p-2 text-small">
          {students.map((s) => (
            <li key={s.grNo} className="flex items-center gap-2">
              <span className="flex-1 text-ink">{s.name}</span>
              <span className="text-ink-muted">
                {from.get(s.grNo)} → {toSection ? `${className}-${toSection}` : "?"}
              </span>
            </li>
          ))}
        </ul>
        {move.error && <Banner tone="danger">{apiMessage(move.error)}</Banner>}
      </div>
    </Modal>
  );
}

export function SectionsPage({ cls, setCls }: { cls: string; setCls: (c: string) => void }) {
  const ctx = useCtx();
  const canEdit = useCan("students.edit");
  const readOnly = useReadOnly();
  const editable = canEdit && !readOnly;
  const classes = useQuery(metaQueries.classes(ctx.campus));
  // The class in the URL, else the first class at this campus with sections (Setup order).
  const classList = (classes.data ?? []).filter((c) => c.sections.length > 0);
  const className = cls || classList[0]?.short || "";
  const board = useQuery({ ...sectionAllotmentQueries.board(ctx, className), enabled: ctx.campus !== "ALL" && Boolean(className) });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState(false);
  const [rolls, setRolls] = useState<SectionAllotmentSection | null>(null);
  useEffect(() => setSelected(new Set()), [className, ctx.campus]);
  const b = board.data;
  const all = useMemo(() => b?.sections.flatMap((s) => s.students) ?? [], [b]);
  const chosen = all.filter((s) => selected.has(s.grNo));
  const toggle = (grNo: string) =>
    setSelected((x) => {
      const n = new Set(x);
      if (n.has(grNo)) n.delete(grNo);
      else n.add(grNo);
      return n;
    });

  return (
    <RequirePermission permission="students.view" page="Sections and roll numbers">
      <Page>
        <PageHeader
          title="Sections & roll numbers"
          actions={
            <>
              {(b?.streams.length ?? 0) > 0 && (
                <Link to="/reports/$reportId" params={{ reportId: "students-group-wise" }} search={(prev: Record<string, unknown>) => ({ ...prev, f: { class: className } }) as never} className={buttonClassName({ variant: "secondary" })}>
                  Group-wise list
                </Link>
              )}
              <Link to="/reports/$reportId" params={{ reportId: "students-strength" }} search={(prev: Record<string, unknown>) => ({ ...prev, f: { class: className } }) as never} className={buttonClassName({ variant: "secondary" })}>
                Strength report
              </Link>
            </>
          }
        />
        <StudentsSubNav />
        <RequireSingleCampus action="section allotment">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="grid gap-1.5">
              <span className="mtb-label">Class</span>
              {classList.length > 12 ? (
                <Select aria-label="Class" value={className} onChange={(e) => setCls(e.target.value)} options={classList.map((c) => ({ value: c.short, label: c.name }))} />
              ) : (
                <Segmented aria-label="Class" value={className} onChange={setCls} options={classList.map((c) => ({ value: c.short, label: c.short }))} />
              )}
            </div>
            {editable && (
              <div className="flex flex-wrap items-center gap-2" aria-live="polite">
                <span className="text-small text-ink-muted">{chosen.length ? `${chosen.length} selected` : "Select students to move them"}</span>
                {chosen.length > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                    Clear
                  </Button>
                )}
                <Button variant="primary" icon="split" disabled={!chosen.length} onClick={() => setMoving(true)}>
                  Move to section…
                </Button>
              </div>
            )}
          </div>
          {readOnly && <Banner tone="info">Past sessions are read-only. Sections and roll numbers can be changed in the current session.</Banner>}
          {board.isError && <LoadError what="sections" error={board.error} onRetry={() => void board.refetch()} />}
          {!b ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height={360} style={{ borderRadius: "var(--radius-lg)" }} />
              ))}
            </div>
          ) : (
            <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
              {b.sections.map((s, i) => {
                const allIn = s.students.length > 0 && s.students.every((x) => selected.has(x.grNo));
                return (
                  <Panel
                    key={s.section}
                    id={`sec-${s.section}`}
                    rise={i + 1}
                    title={s.classSection}
                    description={s.classTeacher ? `Class teacher: ${s.classTeacher}` : "No class teacher set"}
                    actions={
                      editable && s.students.length > 0 ? (
                        <Button size="sm" icon="listChecks" onClick={() => setRolls(s)}>
                          Roll numbers
                        </Button>
                      ) : undefined
                    }
                  >
                    <div className="grid gap-3">
                      <SeatMeter enrolled={s.students.length} seats={s.seats} label={s.classSection} />
                      <div className="flex flex-wrap items-center gap-2 text-small text-ink-muted">
                        <span>{s.students.filter((x) => x.gender === "F").length} girls</span>·<span>{s.students.filter((x) => x.gender === "M").length} boys</span>
                        {s.rollIssues > 0 && <StatusBadge status="warning">{`${s.rollIssues} roll number ${s.rollIssues === 1 ? "issue" : "issues"}`}</StatusBadge>}
                      </div>
                      {s.students.length === 0 ? (
                        <EmptyState icon="students" title="No students" description={`Nobody is placed in ${s.classSection} yet.`} />
                      ) : (
                        <ul className="m-0 grid list-none gap-0.5 p-0">
                          {editable && (
                            <li className="flex items-center gap-2 border-b border-border px-1 pb-1.5">
                              <Checkbox aria-label={`Select everyone in ${s.classSection}`} checked={allIn} onChange={() => setSelected((x) => { const n = new Set(x); s.students.forEach((st) => (allIn ? n.delete(st.grNo) : n.add(st.grNo))); return n; })} />
                              <span className="text-caption uppercase text-ink-muted">Roll · Name</span>
                            </li>
                          )}
                          {s.students.map((st, j) => (
                            <li key={st.grNo} className={cx("mtb-slide-in flex items-center gap-2 rounded-md px-1 py-1", selected.has(st.grNo) && "bg-surface-selected")} style={stagger(j)}>
                              {editable && <Checkbox aria-label={`Select ${st.name}`} checked={selected.has(st.grNo)} onChange={() => toggle(st.grNo)} />}
                              <b className="w-6 text-right tabular-nums text-ink">{st.rollNo || "—"}</b>
                              <Link to="/students/$grNo" params={{ grNo: st.grNo }} className="min-w-0 flex-1 truncate text-ink underline-offset-2 hover:underline">
                                {st.name}
                              </Link>
                              {st.stream && (
                                <span title={`${st.stream} group`}>
                                  <StatusBadge status="neutral">{groupShort(st.stream)}</StatusBadge>
                                </span>
                              )}
                              <span className="mtb-mono text-small text-ink-muted">{st.grNo}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </Panel>
                );
              })}
            </div>
          )}
          {b && (
            <Panel id="recent-moves" rise={5} title="Recent changes" description="Section moves and roll-number runs in this class">
              {b.recentMoves.length === 0 ? (
                <p className="m-0 text-small text-ink-muted">No changes in {b.label} yet this session. Every move is kept in the student's class history, so nothing is overwritten.</p>
              ) : (
                <ul className="m-0 grid list-none gap-1 p-0">
                  {b.recentMoves.map((m, i) => (
                    <li key={m.id} className="mtb-slide-in flex flex-wrap items-center gap-x-3 border-b border-border py-1.5 text-small last:border-b-0" style={stagger(i)}>
                      <span className="tabular-nums text-ink-muted">{formatDate(m.date)}</span>
                      <b className="text-ink">{m.name}</b>
                      {m.from !== m.to && (
                        <span className="text-ink-muted">
                          {m.from} → {m.to}
                        </span>
                      )}
                      <span className="flex-1 text-ink-muted">{m.reason}</span>
                      <span className="text-ink-muted">{m.by}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
          {b && <MoveModal className={className} sections={b.sections} streams={b.streams} students={chosen} open={moving} onClose={() => setMoving(false)} onMoved={() => setSelected(new Set())} />}
          <RollNumbersModal section={rolls} open={rolls !== null} onClose={() => setRolls(null)} />
        </RequireSingleCampus>
      </Page>
    </RequirePermission>
  );
}
