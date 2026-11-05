import {
  ApiError,
  CURRENT_SESSION,
  isHandoverDoc,
  metaQueries,
  newIdempotencyKey,
  STUDENT_DOC_LABEL,
  STUDENT_DOC_TYPES,
  STUDENT_PROMOTION_OUTCOME_LABEL,
  sectionAllotmentApi,
  sectionAllotmentQueries,
  studentDocsQueries,
  studentFamiliesQueries,
  studentMovementsAllowed,
  studentsApi,
  studentsQueries,
  type EnrolmentEvent,
  type StudentDocType,
  type StudentMovementChange,
  type StudentProfile,
  type StudentQualification,
} from "@mtb/api";
import { formatCnic, formatDate, formatDateTime, formatMobile, formatPercent, formatRs, formatSession, formatTime, isValidCnic, normalizeMobile } from "@mtb/domain";
import {
  AttendanceCalendar,
  Avatar,
  Banner,
  Button,
  buttonClassName,
  CnicInput,
  DataTable,
  DatePicker,
  EmptyState,
  Icon,
  Input,
  KeyValue,
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Modal,
  Segmented,
  Select,
  SidePanel,
  Skeleton,
  StatusBadge,
  Switch,
  TabPanel,
  Tabs,
  Textarea,
  Timeline,
  Tooltip,
  Urdu,
  useToast,
  type TimelineItem,
} from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Page, PageHeader, RequirePermission } from "../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { LedgerTable } from "../fees/ledger/LedgerTable";
import { ChildExtrasFields, childExtrasSchema, extrasFrom, FamilyExtrasFields, familyExtrasSchema, type ExtrasForm } from "../admissions/extras";
import { AddressLabelsPanel } from "./documents/AddressLabelsPanel";
import { AdmissionFormModal } from "./documents/AdmissionFormModal";
import { IssueDocumentPanel } from "./documents/IssueDocumentPanel";
import { StatusChangePanel } from "./movements/StatusChangePanel";
import { apiMessage, EnrolmentBadge, fieldError, LoadError, stagger, TODAY } from "./shared";

export type ProfileTab = "enrolment" | "attendance" | "results" | "ledger" | "sms" | "family" | "documents";

export const PROFILE_TABS: ProfileTab[] = ["enrolment", "attendance", "results", "ledger", "sms", "family", "documents"];

const EVENT_LOOK: Record<EnrolmentEvent["kind"], Pick<TimelineItem, "icon" | "tone">> = {
  ADMITTED: { icon: "admissions", tone: "brand" },
  PROMOTED: { icon: "arrowUp", tone: "success" },
  SECTION_CHANGE: { icon: "split", tone: "info" },
  TRANSFER_IN: { icon: "building", tone: "info" },
  TRANSFER_OUT: { icon: "building", tone: "neutral" },
  LEFT: { icon: "logout", tone: "warning" },
  STRUCK_OFF: { icon: "ban", tone: "warning" },
  RESTORED: { icon: "refresh", tone: "success" },
  EXPELLED: { icon: "ban", tone: "danger" },
  DETAINED: { icon: "refresh", tone: "warning" },
  PASSED_OUT: { icon: "award", tone: "success" },
  ROLL_NO: { icon: "listChecks", tone: "neutral" },
  NOTE: { icon: "edit", tone: "neutral" },
};

function HeaderSkeleton() {
  return (
    <div className="mtb-card flex items-center gap-5 p-5" aria-busy="true" aria-label="Loading student">
      <Skeleton width={80} height={80} style={{ borderRadius: "var(--radius-lg)" }} />
      <div className="grid flex-1 gap-2">
        <Skeleton width="40%" height={24} />
        <Skeleton width="25%" />
        <Skeleton width="55%" />
      </div>
    </div>
  );
}

function TabSkeleton() {
  return (
    <div className="grid gap-3 pt-5" aria-busy="true">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} height={36} />
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- Class history and transfers */

function ClassHistoryTab({ p }: { p: StudentProfile }) {
  const rows = [...(p.history ?? [])].reverse().map((r, i) => ({ ...r, id: `${r.session}-${r.classSection}-${i}` }));
  const campuses = new Set((p.history ?? []).map((r) => r.campus));
  return (
    <div className="grid gap-5 pt-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <section className="grid content-start gap-3" aria-labelledby="hist-title">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="hist-title" className="m-0 text-title-3">
            Class history
          </h3>
          <span className="text-small text-ink-muted">
            {(p.history ?? []).length} placements · {campuses.size} {campuses.size === 1 ? "campus" : "campuses"} · kept for every section change and transfer
          </span>
        </div>
        <DataTable
          caption="Class history"
          rows={rows}
          stickyHeader={false}
          density="dense"
          empty={<EmptyState icon="layers" title="No class history" description="Placements appear here from admission onwards." />}
          rowClassName={(r) => (!r.to && r.session === CURRENT_SESSION ? "is-selected" : undefined)}
          columns={[
            { key: "session", header: "Session", width: 90, render: (r) => <span className="tabular-nums">{formatSession(r.session)}</span> },
            {
              key: "classSection",
              header: "Class",
              width: 110,
              render: (r) => (
                <span className="grid">
                  <b className="font-medium">{r.classSection}</b>
                  {campuses.size > 1 && <span className="mtb-cell-secondary">{r.campusName}</span>}
                  {r.stream && <span className="mtb-cell-secondary">{r.stream}</span>}
                </span>
              ),
            },
            { key: "rollNo", header: "Roll", align: "right", width: 60, render: (r) => (r.rollNo ? <span className="tabular-nums">{r.rollNo}</span> : <span className="text-ink-subtle">—</span>) },
            {
              key: "from",
              header: "Dates",
              width: 190,
              render: (r) => (
                <span className="tabular-nums text-small">
                  {formatDate(r.from)} – {r.to ? formatDate(r.to) : r.session > CURRENT_SESSION ? "next session" : "now"}
                </span>
              ),
            },
            { key: "reason", header: "How", render: (r) => <span className="text-small">{r.reason}</span> },
            { key: "outcome", header: "Outcome", width: 130, render: (r) => (r.outcome ? <StatusBadge status={r.outcome === "Promoted" || r.outcome === "Passed out" ? "success" : r.outcome === "Expelled" ? "danger" : "neutral"}>{r.outcome}</StatusBadge> : r.session > CURRENT_SESSION ? <StatusBadge status="info">Next session</StatusBadge> : <StatusBadge status="pending">Current</StatusBadge>) },
          ]}
        />
      </section>
      <section className="grid content-start gap-3" aria-labelledby="events-title">
        <h3 id="events-title" className="m-0 text-title-3">
          Enrolment history
        </h3>
        <Timeline
          label="Enrolment history"
          items={[...p.enrolment]
            .reverse()
            .map((e) => ({ id: e.id, date: e.date, title: e.title, ...(e.description || e.by ? { description: [e.description, e.by ? `Recorded by ${e.by}` : ""].filter(Boolean).join(" · ") } : {}), ...EVENT_LOOK[e.kind] }))}
        />
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- Attendance, results, SMS (unchanged behaviour) */

function AttendanceTab({ grNo }: { grNo: string }) {
  const [month, setMonth] = useState("2026-10");
  const data = useQuery(studentsQueries.attendance(grNo, month));
  const [y, m] = month.split("-").map(Number) as [number, number];
  return (
    <div className="grid max-w-3xl gap-4 pt-5">
      <Segmented
        aria-label="Month"
        value={month}
        onChange={setMonth}
        options={[
          { value: "2026-09", label: "Sep 2026" },
          { value: "2026-10", label: "Oct 2026" },
          { value: "2026-11", label: "Nov 2026" },
        ]}
      />
      {data.isError && <LoadError what="attendance" error={data.error} onRetry={() => void data.refetch()} />}
      {data.isLoading || !data.data ? <TabSkeleton /> : <AttendanceCalendar year={y} month={m - 1} days={data.data.days} holidayNames={data.data.holidayNames} today={TODAY} />}
    </div>
  );
}

/* ---------------------------------------------------------------- Board exams (earlier qualifications) */

const THIS_YEAR = Number(TODAY.slice(0, 4));
const num = (v: string) => (v.trim() === "" ? Number.NaN : Number(v));

const qualSchema = z
  .object({
    exam: z.string().trim().min(3, { error: "Enter the exam, e.g. SSC Part-I (Class 9) Annual 2026." }).max(80, { error: "Keep the exam under 80 letters." }),
    board: z.string().trim().min(3, { error: "Enter the board, e.g. BISE Bahawalpur." }).max(60, { error: "Keep the board under 60 letters." }),
    year: z.number({ error: "Enter the year of the exam." }).int({ error: "Enter the year of the exam." }).min(1990, { error: `Enter a year from 1990 to ${THIS_YEAR}.` }).max(THIS_YEAR, { error: `Enter a year from 1990 to ${THIS_YEAR}.` }),
    rollNo: z.string().trim().regex(/^[A-Za-z0-9-]{3,12}$/, { error: "The roll no. is 3 to 12 letters or digits." }),
    total: z.number({ error: "Enter the total marks." }).int({ error: "Total marks are a whole number." }).min(1, { error: "Enter the total marks." }).max(2000, { error: "Total marks are 2,000 at most." }),
    obtained: z.number({ error: "Enter the marks obtained." }).min(0, { error: "Marks can't be below 0." }),
  })
  .refine((v) => v.obtained <= v.total, { path: ["obtained"], error: "Marks obtained can't be more than the total." });

type QualForm = { exam: string; board: string; year: string; rollNo: string; obtained: string; total: string; group: string };
const qualForm = (q: StudentQualification | null, p: StudentProfile): QualForm =>
  q
    ? { exam: q.exam, board: q.board, year: String(q.year), rollNo: q.rollNo, obtained: String(q.obtained), total: String(q.total), group: q.group ?? "" }
    : { exam: "", board: p.campus === "HC" ? "BISE Lahore" : "BISE Bahawalpur", year: String(THIS_YEAR), rollNo: "", obtained: "", total: "", group: p.stream ?? "" };

/** "Changed by … Reload": a correction refused because someone else saved the entry first (409 CONCURRENCY). */
function StaleBanner({ error, onReload, reloading }: { error: unknown; onReload: () => void; reloading: boolean }) {
  if (!(error instanceof ApiError && error.status === 409 && error.code === "CONCURRENCY")) return null;
  const d = error.details as { changedBy?: string; changedAt?: string } | undefined;
  return (
    <Banner
      tone="warning"
      title={`This entry was changed by ${d?.changedBy ?? "someone else"}${d?.changedAt ? ` at ${formatTime(d.changedAt)} on ${formatDate(d.changedAt)}` : ""}.`}
      actions={
        <Button size="sm" variant="secondary" icon="refresh" loading={reloading} onClick={onReload}>
          Reload
        </Button>
      }
    >
      Your changes were not saved, so nothing of theirs was overwritten. Reload to see the latest version, then make your change again.
    </Banner>
  );
}

function QualificationPanel({ p, row, open, onClose }: { p: StudentProfile; row: StudentQualification | null; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const ctx = useCtx();
  const classes = useQuery(metaQueries.classes(ctx.campus));
  const groups = classes.data?.find((c) => c.short === "9")?.groups ?? [];
  const [form, setForm] = useState<QualForm>(() => qualForm(row, p));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [key, setKey] = useState(newIdempotencyKey);
  const [rowVer, setRowVer] = useState(row?.rowVer ?? 0);
  useEffect(() => {
    if (!open) return;
    setForm(qualForm(row, p));
    setRowVer(row?.rowVer ?? 0);
    setErrors({});
    setKey(newIdempotencyKey());
  }, [open, row?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const input = () => ({ exam: form.exam.trim(), board: form.board.trim(), year: num(form.year), rollNo: form.rollNo.trim(), obtained: num(form.obtained), total: num(form.total), ...(form.group ? { group: form.group } : {}) });
  const save = useMutation({
    mutationFn: () => (row ? studentsApi.updateQualification(p.grNo, row.id, { ...input(), rowVer }, key) : studentsApi.addQualification(p.grNo, input(), key)),
    onSuccess: (next) => {
      queryClient.setQueryData(studentsQueries.profile(p.grNo).queryKey, next);
      void queryClient.invalidateQueries({ queryKey: studentsQueries.all() });
      void queryClient.invalidateQueries({ queryKey: studentDocsQueries.all() });
      onClose();
      toast({ title: row ? "Board exam corrected" : "Board exam added", message: "The character certificate starts from the latest one." });
    },
  });
  const reload = useMutation({
    mutationFn: () => studentsApi.get(p.grNo),
    onSuccess: (fresh) => {
      queryClient.setQueryData(studentsQueries.profile(p.grNo).queryKey, fresh);
      const latest = fresh.qualifications?.find((q) => q.id === row?.id) ?? null;
      setForm(qualForm(latest, fresh));
      setRowVer(latest?.rowVer ?? 0);
      setKey(newIdempotencyKey());
      save.reset();
    },
  });
  const submit = () => {
    const r = qualSchema.safeParse(input());
    if (!r.success) {
      setErrors(Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    save.mutate();
  };
  const err = (f: string) => errors[f] ?? fieldError(save.error, f);
  const set = (patch: Partial<QualForm>) => setForm((f) => ({ ...f, ...patch }));
  const stale = save.error instanceof ApiError && save.error.code === "CONCURRENCY";
  const pct = num(form.total) > 0 && Number.isFinite(num(form.obtained)) ? formatPercent((num(form.obtained) / num(form.total)) * 100) : null;
  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={row ? "Correct board exam" : "Add board exam"}
      description={`${p.name} · ${p.grNo}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} loadingLabel="Saving…" disabled={stale} onClick={submit}>
            {row ? "Save correction" : "Add to record"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <StaleBanner error={save.error} onReload={() => reload.mutate()} reloading={reload.isPending} />
        <Input label="Exam" required placeholder="SSC Part-I (Class 9) Annual 2026" value={form.exam} error={err("exam")} onChange={(e) => set({ exam: e.target.value })} />
        <Input label="Board" required value={form.board} error={err("board")} onChange={(e) => set({ board: e.target.value })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Year" required inputMode="numeric" value={form.year} error={err("year")} onChange={(e) => set({ year: e.target.value.replace(/\D/g, "").slice(0, 4) })} />
          <Input label="Roll no." required mono value={form.rollNo} error={err("rollNo")} onChange={(e) => set({ rollNo: e.target.value })} />
          <Input label="Marks obtained" required inputMode="decimal" value={form.obtained} error={err("obtained")} onChange={(e) => set({ obtained: e.target.value.replace(/[^0-9.]/g, "") })} help={pct ? `${pct}` : undefined} />
          <Input label="Total marks" required inputMode="numeric" value={form.total} error={err("total")} onChange={(e) => set({ total: e.target.value.replace(/\D/g, "") })} />
        </div>
        {groups.length > 0 && <Select label="Group (if any)" value={form.group} error={err("group")} onChange={(e) => set({ group: e.target.value })} options={[{ value: "", label: "No group" }, ...groups]} />}
        <p className="m-0 text-small text-ink-muted">Kept on the student's record. The character certificate takes its board exam, roll no. and marks from the latest entry.</p>
        {save.error && !stale && !Object.keys(errors).length && !(save.error instanceof ApiError && save.error.field) && <Banner tone="danger">{apiMessage(save.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

function QualificationsCard({ p }: { p: StudentProfile }) {
  const canEdit = useCan("students.edit");
  const readOnly = useReadOnly();
  const editable = canEdit && !readOnly && p.status !== "PASSED_OUT";
  const [editing, setEditing] = useState<StudentQualification | null>(null);
  const [adding, setAdding] = useState(false);
  const rows = [...(p.qualifications ?? [])].reverse();
  return (
    <section className="mtb-card" aria-labelledby="quals-title">
      <header className="mtb-card-header flex-wrap">
        <div className="grid">
          <h3 id="quals-title">Board exams and earlier results</h3>
          <span className="text-small text-ink-muted">From other schools or boards. The character certificate starts from the latest one.</span>
        </div>
        {editable && (
          <Button size="sm" icon="plus" onClick={() => setAdding(true)}>
            Add board exam
          </Button>
        )}
      </header>
      <DataTable
        caption="Board exams and earlier results"
        rows={rows}
        stickyHeader={false}
        density="dense"
        empty={<EmptyState icon="award" title="No board exams on record" description="Add the student's earlier board results, for example Class 8 or Matric Part-I." />}
        columns={[
          { key: "exam", header: "Exam", render: (q) => <span className="grid"><span className="mtb-cell-primary">{q.exam}</span><span className="mtb-cell-secondary">{q.board}</span></span> },
          { key: "year", header: "Year", width: 70, render: (q) => <span className="tabular-nums">{q.year}</span> },
          { key: "rollNo", header: "Roll no.", width: 120, render: (q) => <span className="mtb-mono">{q.rollNo}</span> },
          { key: "marks", header: "Marks", width: 150, align: "right", render: (q) => <span className="tabular-nums">{q.obtained} / {q.total} · {formatPercent((q.obtained / q.total) * 100)}</span> },
          { key: "group", header: "Group", width: 150, render: (q) => q.group ?? <span className="text-ink-subtle">—</span> },
          ...(editable
            ? [
                {
                  key: "edit",
                  header: "",
                  width: 90,
                  align: "right" as const,
                  render: (q: StudentQualification) => (
                    <Button size="sm" variant="ghost" icon="edit" aria-label={`Correct ${q.exam}`} onClick={() => setEditing(q)}>
                      Correct
                    </Button>
                  ),
                },
              ]
            : []),
        ]}
      />
      <QualificationPanel p={p} row={editing ?? null} open={adding || editing !== null} onClose={() => {
          setAdding(false);
          setEditing(null);
        }} />
    </section>
  );
}

function ResultsTab({ grNo, p }: { grNo: string; p?: StudentProfile | undefined }) {
  return (
    <>
      {p && (
        <div className="pt-5">
          <QualificationsCard p={p} />
        </div>
      )}
      <DeclaredResults grNo={grNo} />
    </>
  );
}

function DeclaredResults({ grNo }: { grNo: string }) {
  const results = useQuery(studentsQueries.results(grNo));
  if (results.isLoading) return <TabSkeleton />;
  if (results.isError) return <LoadError what="results" error={results.error} onRetry={() => void results.refetch()} />;
  if (!results.data?.length) return <EmptyState icon="exams" title="No declared results yet" description="Results appear here once the exam office declares them. Drafts are never shown." />;
  return (
    <div className="grid gap-4 pt-5">
      {results.data.map((r) => (
        <section key={r.examId} className="mtb-card" aria-label={r.exam}>
          <header className="mtb-card-header flex-wrap">
            <div className="grid">
              <h3>{r.exam}</h3>
              <span className="text-small text-ink-muted">Declared {formatDate(r.declaredOn)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="mtb-num font-medium">
                {r.obtained} / {r.total} · {formatPercent(r.percent)}
              </span>
              <StatusBadge status="success" size="lg">
                Grade {r.grade}
              </StatusBadge>
              {r.position && <StatusBadge status="info">Position {r.position}</StatusBadge>}
              <StatusBadge status="declared" icon="lock" />
            </div>
          </header>
          <DataTable
            rows={r.subjects.map((s) => ({ ...s, id: s.subject }))}
            stickyHeader={false}
            density="dense"
            columns={[
              { key: "subject", header: "Subject" },
              { key: "obtained", header: "Marks", align: "right", render: (s) => (s.absent ? "Absent" : `${s.obtained} / ${s.max}`) },
              { key: "pct", header: "%", align: "right", render: (s) => (s.obtained === null ? "—" : formatPercent((s.obtained / s.max) * 100)) },
              { key: "grade", header: "Grade", align: "right" },
            ]}
          />
        </section>
      ))}
    </div>
  );
}

function SmsTab({ grNo }: { grNo: string }) {
  const sms = useQuery(studentsQueries.sms(grNo));
  if (sms.isLoading) return <TabSkeleton />;
  if (sms.isError) return <LoadError what="SMS history" error={sms.error} onRetry={() => void sms.refetch()} />;
  return (
    <div className="pt-5">
      <DataTable
        caption="SMS history"
        rows={sms.data ?? []}
        empty={<EmptyState icon="sms" title="No SMS sent yet" description="Fee reminders, absence alerts and results sent to this guardian will appear here." />}
        columns={[
          {
            key: "message",
            header: "Message",
            render: (m) =>
              m.language === "ur" ? (
                <Urdu size="small" as="p" className="m-0 max-w-xl">
                  {m.message}
                </Urdu>
              ) : (
                <span className="block max-w-xl text-small">{m.message}</span>
              ),
          },
          { key: "language", header: "Language", width: 100, render: (m) => (m.language === "ur" ? "Urdu" : "English") },
          { key: "sentAt", header: "Sent", width: 170, render: (m) => <span className="tabular-nums">{formatDateTime(m.sentAt)}</span> },
          { key: "status", header: "Status", width: 120, render: (m) => <StatusBadge status={m.status} /> },
        ]}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- Family and siblings */

function FamilyTab({ p }: { p: StudentProfile }) {
  const family = useQuery({ ...studentFamiliesQueries.detail(p.familyId ?? ""), enabled: Boolean(p.familyId) });
  const canFees = useCan("fees.view");
  if (!p.familyId) return <EmptyState icon="home" title="No family record" description="This student has no father's CNIC or guardian mobile to group a family by." />;
  if (family.isLoading) return <TabSkeleton />;
  if (family.isError || !family.data) return <LoadError what="family" error={family.error} onRetry={() => void family.refetch()} />;
  const f = family.data;
  return (
    <div className="grid gap-5 pt-5 lg:grid-cols-2">
      <section className="grid content-start gap-3" aria-labelledby="fam-children">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="fam-children" className="m-0 text-title-3">
            Children at MTB
          </h3>
          <Link to="/students/families/$familyId" params={{ familyId: f.id }} className="text-small font-medium text-brand-ink underline-offset-2 hover:underline">
            Open family record {f.id}
          </Link>
        </div>
        <ul className="m-0 grid list-none gap-2 p-0">
          {f.children.map((c, i) => (
            <li key={c.grNo} className="mtb-slide-in" style={stagger(i)}>
              <Link to="/students/$grNo" params={{ grNo: c.grNo }} className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 no-underline hover:bg-surface-hover ${c.grNo === p.grNo ? "border-brand bg-brand-tint" : "border-border"}`}>
                <Avatar name={c.name} size="sm" />
                <span className="grid min-w-0 flex-1">
                  <span className="font-medium text-ink">
                    {c.name} {c.grNo === p.grNo && <span className="text-small text-ink-muted">(this student)</span>}
                  </span>
                  <span className="text-small text-ink-muted">
                    <span className="mtb-mono">{c.grNo}</span> · {c.classSection} · {c.campusName}
                  </span>
                </span>
                <EnrolmentBadge status={c.status} />
                {canFees && <StatusBadge status={c.feeStatus} />}
              </Link>
            </li>
          ))}
        </ul>
        {canFees && (
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-surface-sunken p-3 text-small sm:grid-cols-3">
            <span className="grid">
              <span className="text-ink-muted">Family balance</span>
              <b className="tabular-nums text-ink">{formatRs(f.fees.balance)}</b>
            </span>
            <span className="grid">
              <span className="text-ink-muted">Monthly tuition</span>
              <b className="tabular-nums text-ink">{formatRs(f.fees.monthly)}</b>
            </span>
            <span className="grid">
              <span className="text-ink-muted">Overdue</span>
              <b className="tabular-nums text-ink">{f.fees.overdueChildren} {f.fees.overdueChildren === 1 ? "child" : "children"}</b>
            </span>
          </div>
        )}
      </section>
      <section className="grid content-start gap-3" aria-labelledby="fam-guardians">
        <h3 id="fam-guardians" className="m-0 text-title-3">
          Parents and guardians
        </h3>
        <ul className="m-0 grid list-none gap-2 p-0">
          {f.guardians.map((g) => (
            <li key={g.id} className="grid gap-1 rounded-lg border border-border px-3 py-2.5">
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-ink">
                  {g.name} <span className="text-small font-normal text-ink-muted">· {g.relation}</span>
                </span>
                <span className="flex flex-wrap gap-1">
                  {g.isPrimaryContact && <StatusBadge status="info">Primary contact</StatusBadge>}
                  {g.isFeePayer && <StatusBadge status="neutral">Fee payer</StatusBadge>}
                  {g.isEmergencyContact && <StatusBadge status="warning">Emergency</StatusBadge>}
                </span>
              </span>
              <span className="text-small text-ink-muted">
                {g.mobile ? <span className="tabular-nums">{formatMobile(g.mobile)}</span> : "No mobile"}
                {g.cnic ? (
                  <>
                    {" "}
                    · CNIC <span className="mtb-mono">{formatCnic(g.cnic)}</span>
                  </>
                ) : null}
                {g.occupation ? ` · ${g.occupation}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- Documents issued */

function DocumentsTab({ p, onIssue }: { p: StudentProfile; onIssue: (t: StudentDocType) => void }) {
  const docs = useQuery(studentDocsQueries.forStudent(p.grNo));
  const canEdit = useCan("students.edit");
  const readOnly = useReadOnly();
  if (docs.isLoading) return <TabSkeleton />;
  if (docs.isError || !docs.data) return <LoadError what="documents" error={docs.error} onRetry={() => void docs.refetch()} />;
  const d = docs.data;
  return (
    <div className="grid gap-5 pt-5">
      {canEdit && !readOnly && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Issue a document">
          {STUDENT_DOC_TYPES.filter((t) => !isHandoverDoc(t) || /^(9|10)-/.test(p.classSection)).map((t) => {
            const block = d.blocks[t];
            const btn = (
              <Button key={t} size="sm" icon={t === "ID_CARD" ? "idCard" : t === "APPRECIATION_LETTER" ? "star" : isHandoverDoc(t) ? "checkCircle" : "file"} disabled={Boolean(block)} onClick={() => onIssue(t)}>
                {isHandoverDoc(t) ? `Hand over ${STUDENT_DOC_LABEL[t].replace("Board ", "").toLowerCase()}` : STUDENT_DOC_LABEL[t]}
              </Button>
            );
            return block ? (
              <Tooltip key={t} content={block}>
                <span>{btn}</span>
              </Tooltip>
            ) : (
              btn
            );
          })}
        </div>
      )}
      <DataTable
        caption="Documents issued"
        rows={d.issued}
        empty={<EmptyState icon="file" title="No documents issued yet" description="ID cards, admission slips, certificates and letters issued to this student appear here with their serial numbers." />}
        columns={[
          { key: "serialNo", header: "Serial no.", width: 170, render: (x) => <span className="mtb-mono">{x.serialNo}</span> },
          { key: "type", header: "Document", render: (x) => `${STUDENT_DOC_LABEL[x.type]}${x.details.part ? ` Part-${x.details.part}` : ""}` },
          { key: "issuedOn", header: "Issued", width: 120, render: (x) => <span className="tabular-nums">{formatDate(x.issuedOn)}</span> },
          { key: "issuedBy", header: "By", width: 140, render: (x) => (isHandoverDoc(x.type) && x.details.receivedBy ? `${x.issuedBy} · to ${x.details.receivedBy}` : x.issuedBy) },
          { key: "prints", header: "Prints", align: "right", width: 80, render: (x) => (isHandoverDoc(x.type) ? <span className="text-ink-subtle">—</span> : <span className="tabular-nums">{x.prints.length}</span>) },
          {
            key: "status",
            header: "Status",
            width: 120,
            render: (x) =>
              x.status === "CANCELLED" ? (
                <Tooltip content={x.cancelledReason ?? "Cancelled"}>
                  <span>
                    <StatusBadge status="cancelled" />
                  </span>
                </Tooltip>
              ) : (
                <StatusBadge status="success">{isHandoverDoc(x.type) ? "Handed over" : "Issued"}</StatusBadge>
              ),
          },
        ]}
      />
      <p className="m-0 text-small text-ink-muted">
        Reprints and cancellations are made from the{" "}
        <Link to="/students/documents" className="text-brand-ink underline-offset-2 hover:underline">
          issue register
        </Link>
        , where every copy is logged with a reason.
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- Cards under the header */

function GuardianCard({ p }: { p: StudentProfile }) {
  return (
    <section className="mtb-card mtb-rise" style={stagger(1)} aria-labelledby="guardian-title">
      <header className="mtb-card-header">
        <h2 id="guardian-title">Guardian</h2>
        <span className="text-small text-ink-muted">Primary contact for calls and SMS</span>
      </header>
      <div className="p-5">
        <KeyValue
          items={[
            [
              p.guardian.relation,
              <span className="flex flex-wrap items-baseline gap-x-3">
                {p.guardian.name}
                {p.guardian.nameUr && <Urdu size="small">{p.guardian.nameUr}</Urdu>}
              </span>,
            ],
            ["CNIC", p.guardian.cnic ? <span className="mtb-mono">{formatCnic(p.guardian.cnic)}</span> : "—"],
            ["Mobile", <span className="tabular-nums">{formatMobile(p.guardian.mobile)}</span>],
            ["Address", p.guardian.address || "—"],
            ...(p.mother ? ([["Mother", p.mother]] as Array<[string, string]>) : []),
          ]}
        />
      </div>
    </section>
  );
}

function SiblingsCard({ p }: { p: StudentProfile }) {
  return (
    <section className="mtb-card mtb-rise" style={stagger(2)} aria-labelledby="siblings-title">
      <header className="mtb-card-header">
        <h2 id="siblings-title">Siblings</h2>
        {p.familyId ? (
          <Link to="/students/families/$familyId" params={{ familyId: p.familyId }} className="text-small font-medium text-brand-ink underline-offset-2 hover:underline">
            Family {p.familyId}
          </Link>
        ) : (
          <span className="text-small text-ink-muted">By father's CNIC, all campuses</span>
        )}
      </header>
      {p.siblings.length === 0 ? (
        <EmptyState icon="students" title="No siblings found" description="No other student is registered with this father's CNIC." />
      ) : (
        <ul className="m-0 list-none p-0">
          {p.siblings.map((s, i) => (
            <li key={s.grNo} className="mtb-slide-in border-b border-border last:border-b-0" style={stagger(i)}>
              <Link to="/students/$grNo" params={{ grNo: s.grNo }} className="flex items-center gap-3 px-5 py-3 no-underline hover:bg-surface-hover">
                <Avatar name={s.name} size="sm" />
                <span className="grid min-w-0 flex-1">
                  <span className="font-medium text-ink">{s.name}</span>
                  <span className="text-small text-ink-muted">
                    <span className="mtb-mono">{s.grNo}</span> · {s.classSection} · {s.campusName}
                  </span>
                </span>
                {s.status !== "ACTIVE" ? <EnrolmentBadge status={s.status} /> : <StatusBadge status={s.feeStatus} />}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SendSmsModal({ p, open, onClose }: { p: StudentProfile; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [text, setText] = useState(`Dear Parent, `);
  const parts = Math.max(1, Math.ceil(text.length / (text.length > 160 ? 153 : 160)));
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Send SMS to guardian"
      description={`${p.guardian.name} · ${formatMobile(p.guardian.mobile)}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon="send"
            disabled={text.trim().length < 15}
            onClick={() => {
              onClose();
              toast({ title: "SMS queued", message: `To ${formatMobile(p.guardian.mobile)} · ${parts} SMS` });
            }}
          >
            Send SMS
          </Button>
        </>
      }
    >
      <Textarea label="Message" rows={4} value={text} onChange={(e) => setText(e.target.value)} help={`${text.length} characters · ${parts} SMS (160 characters per English SMS)`} />
    </Modal>
  );
}

/* ---------------------------------------------------------------- Edit (contact and identity corrections) */

const editSchema = z.object({
  mobile: z.string().refine((v) => normalizeMobile(v) !== null, { error: "Enter a Pakistani mobile number, e.g. 0300-1234567." }),
  address: z.string().trim().min(8, { error: "Enter the full address: house, street and area." }),
  fatherCnic: z.string().refine((v) => isValidCnic(v), { error: "A CNIC has 13 digits, e.g. 36302-4567890-1." }),
  bForm: z.string().refine((v) => !v || isValidCnic(v), { error: "A B-form number has 13 digits." }),
  boardRollPartI: z.string().trim().refine((v) => !v || /^\d{4,9}$/.test(v), { error: "The board roll no. Part-I is 4 to 9 digits." }),
  boardRollPartII: z.string().trim().refine((v) => !v || /^\d{4,9}$/.test(v), { error: "The board roll no. Part-II is 4 to 9 digits." }),
});

const BLOOD = ["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

function EditPanel({ p, open, onClose }: { p: StudentProfile; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const initial = () => ({
    mobile: formatMobile(p.guardian.mobile),
    address: p.guardian.address,
    occupation: p.guardian.occupation ?? "",
    nameUr: p.nameUr ?? "",
    mother: p.mother ?? "",
    fatherCnic: p.fatherCnic,
    bloodGroup: p.bloodGroup ?? "",
    bForm: p.bForm ?? "",
    boardRollPartI: p.boardRollNo?.partI ?? "",
    boardRollPartII: p.boardRollNo?.partII ?? "",
  });
  // Board roll numbers belong to Class 9 and 10 (the board exam classes).
  const boardClass = /^(9|10)-/.test(p.classSection);
  const [form, setForm] = useState(initial);
  // The rest of the admission form: religion, contact, parents' work and education, emergency contact, hostel.
  const [extras, setExtras] = useState<ExtrasForm>(() => extrasFrom(p));
  const [hostel, setHostel] = useState(Boolean(p.hostel));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [key, setKey] = useState(newIdempotencyKey);
  useEffect(() => {
    if (open) {
      setForm(initial());
      setExtras(extrasFrom(p));
      setHostel(Boolean(p.hostel));
      setErrors({});
      setKey(newIdempotencyKey());
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: () => {
      const { boardRollPartI, boardRollPartII, ...rest } = form;
      const { emergencyName, emergencyMobile1, emergencyMobile2, ...more } = extras;
      return studentsApi.update(
        p.grNo,
        {
          ...rest,
          ...more,
          hostel,
          emergencyContact: emergencyName.trim() || emergencyMobile1.trim() ? { name: emergencyName.trim(), mobile1: emergencyMobile1.trim(), ...(emergencyMobile2.trim() ? { mobile2: emergencyMobile2.trim() } : {}) } : null,
          ...(boardClass ? { boardRollNo: { partI: boardRollPartI.trim(), partII: boardRollPartII.trim() } } : {}),
        },
        key,
      );
    },
    onSuccess: (next) => {
      queryClient.setQueryData(studentsQueries.profile(p.grNo).queryKey, next);
      void queryClient.invalidateQueries({ queryKey: studentsQueries.all() });
      void queryClient.invalidateQueries({ queryKey: studentFamiliesQueries.all() });
      onClose();
      toast({ title: "Record saved", message: next.fatherCnic !== p.fatherCnic ? "The father's CNIC changed, so the family link was updated." : "The change is recorded in the student's history." });
    },
  });
  const submit = () => {
    const found: Record<string, string> = {};
    for (const r of [editSchema.safeParse(form), childExtrasSchema.safeParse(extras), familyExtrasSchema.safeParse(extras)]) if (!r.success) for (const i of r.error.issues) found[String(i.path[0])] ??= i.message;
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }
    setErrors({});
    save.mutate();
  };
  const err = (f: string) => errors[f] ?? fieldError(save.error, f);
  const set = (patch: Partial<ReturnType<typeof initial>>) => setForm((f) => ({ ...f, ...patch }));
  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title="Edit student record"
      description={`${p.name} · ${p.grNo}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} loadingLabel="Saving…" onClick={submit}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Input label="Guardian mobile" required inputMode="tel" value={form.mobile} error={err("mobile")} onChange={(e) => set({ mobile: e.target.value })} help="SMS for fees, absence and results go to this number." />
        <Textarea label="Address" required rows={3} value={form.address} error={err("address")} onChange={(e) => set({ address: e.target.value })} />
        <Input label="Guardian's occupation" value={form.occupation} onChange={(e) => set({ occupation: e.target.value })} />
        <Input label="Mother's name" value={form.mother} onChange={(e) => set({ mother: e.target.value })} />
        <Input label="Name in Urdu" urdu value={form.nameUr} onChange={(e) => set({ nameUr: e.target.value })} />
        <CnicInput label="Father's CNIC" required value={form.fatherCnic} onValueChange={(v) => set({ fatherCnic: v })} error={err("fatherCnic")} help="Siblings are grouped by this number. Changing it moves the child to that family." />
        {form.fatherCnic !== p.fatherCnic && isValidCnic(form.fatherCnic) && <Banner tone="warning">The child will move to the family registered with {formatCnic(form.fatherCnic)}.</Banner>}
        <CnicInput label="Child's B-form number" value={form.bForm} onValueChange={(v) => set({ bForm: v })} error={err("bForm")} />
        {boardClass && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Board roll no. Part-I" inputMode="numeric" mono value={form.boardRollPartI} error={err("boardRollPartI")} onChange={(e) => set({ boardRollPartI: e.target.value.replace(/\D/g, "") })} help="Class 9 board exam" />
            <Input label="Board roll no. Part-II" inputMode="numeric" mono value={form.boardRollPartII} error={err("boardRollPartII")} onChange={(e) => set({ boardRollPartII: e.target.value.replace(/\D/g, "") })} help="Class 10 board exam" />
          </div>
        )}
        <Select label="Blood group" value={form.bloodGroup} onChange={(e) => set({ bloodGroup: e.target.value })} options={BLOOD.map((b) => ({ value: b, label: b || "Not known" }))} />
        <div className="grid gap-4 sm:grid-cols-2">
          <ChildExtrasFields value={extras} onChange={(x) => setExtras((v) => ({ ...v, ...x }))} errors={{ birthCertificateNo: err("birthCertificateNo") }} />
          <FamilyExtrasFields value={extras} onChange={(x) => setExtras((v) => ({ ...v, ...x }))} errors={{ email: err("email"), homePhone: err("homePhone"), emergencyName: err("emergencyName"), emergencyMobile1: err("emergencyMobile1"), emergencyMobile2: err("emergencyMobile2") }} />
          <Input label="Admission reference" value={extras.admissionReference} onChange={(e) => setExtras((v) => ({ ...v, admissionReference: e.target.value }))} />
        </div>
        <Switch label="Lives in the school hostel" checked={hostel} onChange={(e) => setHostel(e.target.checked)} />
        <p className="m-0 text-small text-ink-muted">Name, G.R. number and class are changed through Admissions, Sections and Leaving & transfers, so every change keeps its history.</p>
        {save.error && !Object.keys(errors).length && !(save.error instanceof ApiError && save.error.field) && <Banner tone="danger">{apiMessage(save.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

/* ---------------------------------------------------------------- Change section (one student) */

const REASONS = ["Class strength balancing", "Parent's request", "Sibling in the same section", "Group change", "Discipline", "Other"];

function ChangeSectionModal({ p, open, onClose }: { p: StudentProfile; open: boolean; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const classes = useQuery(metaQueries.classes(p.campus));
  const [short, current] = p.classSection.split("-") as [string, string];
  const sections = (classes.data?.find((c) => c.short === short)?.sections ?? []).filter((s) => s !== current);
  const [toSection, setToSection] = useState("");
  const [date, setDate] = useState<string | null>(TODAY);
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  useEffect(() => {
    if (open) {
      setToSection("");
      setReason("");
      setDate(TODAY);
      setTried(false);
      setKey(newIdempotencyKey());
    }
  }, [open]);
  const move = useMutation({
    mutationFn: () => sectionAllotmentApi.move({ campus: p.campus, session: ctx.session }, { grNos: [p.grNo], toSection, effectiveDate: date ?? TODAY, reason }, key),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: studentsQueries.all() });
      void queryClient.invalidateQueries({ queryKey: sectionAllotmentQueries.all() });
      onClose();
      toast({ title: `${p.name} moved to ${r.toClassSection}`, message: "The old section stays in the class history." });
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change section"
      description={`${p.name} · now in ${p.classSection}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={move.isPending}
            onClick={() => {
              setTried(true);
              if (toSection && reason && date) move.mutate();
            }}
          >
            Move to {toSection ? `${short}-${toSection}` : "section"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Select label="New section" required value={toSection} error={tried && !toSection ? "Choose a section." : undefined} onChange={(e) => setToSection(e.target.value)} options={[{ value: "", label: "Choose…" }, ...sections.map((s) => ({ value: s, label: `${short}-${s}` }))]} />
        <DatePicker label="From" required value={date} onValueChange={setDate} error={tried && !date ? "Choose the date." : undefined} />
        <Select label="Reason" required value={reason} error={tried && !reason ? "Choose a reason." : undefined} onChange={(e) => setReason(e.target.value)} options={[{ value: "", label: "Choose…" }, ...REASONS]} />
        <p className="m-0 text-small text-ink-muted">A new roll number is given in the new section. Attendance and marks already entered stay with the old section.</p>
        {move.error && <Banner tone="danger">{apiMessage(move.error)}</Banner>}
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- The page */

export function StudentProfilePage({ grNo, tab, setTab }: { grNo: string; tab: ProfileTab; setTab: (t: ProfileTab) => void }) {
  const ctx = useCtx();
  const navigate = useNavigate();
  const profile = useQuery(studentsQueries.profile(grNo));
  const canCollect = useCan("fees.collect");
  const canSms = useCan("sms.send");
  const canEdit = useCan("students.edit");
  const canFees = useCan("fees.view");
  // The read-only fee card (fees.card) opens the Fee ledger tab only; the rest of Fees stays closed.
  const canFeeCard = useCan("fees.card");
  const canLedger = canFees || canFeeCard;
  const readOnly = useReadOnly();
  const [smsOpen, setSmsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [sectionOpen, setSectionOpen] = useState(false);
  const [statusKind, setStatusKind] = useState<StudentMovementChange["kind"] | null>(null);
  const [issueType, setIssueType] = useState<StudentDocType | null>(null);
  const [labelOpen, setLabelOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const p = profile.data;
  const allowed = p ? studentMovementsAllowed(p.status) : [];
  const editable = canEdit && !readOnly;

  if (profile.error instanceof ApiError && profile.error.status !== 0) {
    return (
      <Page>
        <div className="mtb-card">
          <EmptyState
            icon="students"
            title={profile.error.status === 403 ? "This student belongs to another campus" : "Student not found"}
            description={profile.error.status === 403 ? "Switch to that campus to open the record, if your role covers it." : `No student has the G.R. number ${grNo}.`}
            action={
              <Link to="/students" className={buttonClassName({ size: "sm" })}>
                Back to students
              </Link>
            }
          />
        </div>
      </Page>
    );
  }

  return (
    <RequirePermission permission="students.view" page="student records">
      <Page>
        <PageHeader
          title={p?.name ?? "Student"}
          context={p ? `${p.campusName} · Session ${formatSession(p.session)}` : undefined}
          actions={
            p ? (
              <>
                {canCollect && p.campus === ctx.campus && (
                  <Button variant="primary" icon="fees" onClick={() => navigate({ to: "/fees/counter", search: (prev: Record<string, unknown>) => ({ ...prev, gr: p.grNo }) } as never)}>
                    Collect fee
                  </Button>
                )}
                {canSms && (
                  <Button icon="send" onClick={() => setSmsOpen(true)}>
                    Send SMS
                  </Button>
                )}
                {canEdit && (
                  <Button icon="edit" disabled={readOnly} onClick={() => setEditOpen(true)}>
                    Edit
                  </Button>
                )}
                {editable && (
                  <Menu
                    align="end"
                    label="More actions"
                    trigger={
                      <Button icon="more" aria-label="More actions">
                        More
                      </Button>
                    }
                  >
                    <MenuLabel>Class</MenuLabel>
                    <MenuItem icon="split" disabled={p.status !== "ACTIVE"} onSelect={() => setSectionOpen(true)}>
                      Change section
                    </MenuItem>
                    <MenuItem icon="building" disabled={!allowed.includes("TRANSFER")} onSelect={() => setStatusKind("TRANSFER")}>
                      Transfer to another campus
                    </MenuItem>
                    <MenuSeparator />
                    <MenuLabel>Status</MenuLabel>
                    {allowed.includes("RESTORED") && (
                      <MenuItem icon="refresh" onSelect={() => setStatusKind("RESTORED")}>
                        Restore to class
                      </MenuItem>
                    )}
                    {allowed.includes("LEFT") && (
                      <MenuItem icon="logout" onSelect={() => setStatusKind("LEFT")}>
                        Record leaving
                      </MenuItem>
                    )}
                    {allowed.includes("STRUCK_OFF") && (
                      <MenuItem icon="ban" onSelect={() => setStatusKind("STRUCK_OFF")}>
                        Strike off
                      </MenuItem>
                    )}
                    {allowed.includes("EXPELLED") && (
                      <MenuItem icon="ban" onSelect={() => setStatusKind("EXPELLED")}>
                        Expel…
                      </MenuItem>
                    )}
                    <MenuSeparator />
                    <MenuLabel>Documents</MenuLabel>
                    {STUDENT_DOC_TYPES.filter((t) => !isHandoverDoc(t) || /^(9|10)-/.test(p.classSection)).map((t) => (
                      <MenuItem key={t} icon={t === "ID_CARD" ? "idCard" : "file"} onSelect={() => setIssueType(t)}>
                        {isHandoverDoc(t) ? `Hand over: ${STUDENT_DOC_LABEL[t].toLowerCase()}` : STUDENT_DOC_LABEL[t]}
                      </MenuItem>
                    ))}
                    <MenuItem icon="mapPin" onSelect={() => setLabelOpen(true)}>
                      Print address label
                    </MenuItem>
                    <MenuItem icon="printer" onSelect={() => setFormOpen(true)}>
                      Print admission form
                    </MenuItem>
                  </Menu>
                )}
              </>
            ) : undefined
          }
        />
        {profile.isError && <LoadError what="student record" error={profile.error} onRetry={() => void profile.refetch()} />}
        {!p ? (
          <HeaderSkeleton />
        ) : (
          <section className="mtb-card mtb-rise flex flex-wrap items-center gap-5 p-5" style={stagger(0)} aria-label="Student">
            <Avatar name={p.name} size="xl" />
            <div className="grid min-w-0 flex-1 gap-1">
              <div className="flex flex-wrap items-baseline gap-x-4">
                <span className="text-title-1">{p.name}</span>
                {p.nameUr && <Urdu size="title">{p.nameUr}</Urdu>}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-ink-muted">
                <span>
                  G.R. <span className="mtb-mono text-ink">{p.grNo}</span>
                </span>
                <span>
                  Class <b className="font-medium text-ink">{p.classSection}</b>
                </span>
                {p.stream && <span>{p.stream} group</span>}
                {(p.boardRollNo?.partI || p.boardRollNo?.partII) && (
                  <span>
                    Board roll no.{" "}
                    <span className="mtb-mono text-ink">{[p.boardRollNo.partI ? `${p.boardRollNo.partI} (I)` : "", p.boardRollNo.partII ? `${p.boardRollNo.partII} (II)` : ""].filter(Boolean).join(" · ")}</span>
                  </span>
                )}
                <span>Session {formatSession(p.session)}</span>
                <span>Roll no. {p.rollNo}</span>
                {p.house && <span>{p.house}</span>}
                <EnrolmentBadge status={p.status} />
              </div>
              <span className="text-small text-ink-muted">
                {p.relation} {p.father} · born <bdi dir="ltr">{formatDate(p.dob)}</bdi> · admitted <bdi dir="ltr">{formatDate(p.admissionDate)}</bdi>
                {p.admittedInClass ? ` in ${p.admittedInClass}` : ""}
                {p.bloodGroup ? ` · blood group ${p.bloodGroup}` : ""}
              </span>
            </div>
            {canFees && (
              <div className="grid justify-items-end gap-1 text-right">
                <span className="mtb-label">Balance</span>
                <span className="text-title-1 tabular-nums">{formatRs(p.balance)}</span>
                <span className="flex items-center gap-2">
                  <StatusBadge status={p.feeStatus} />
                  <span className="flex items-center gap-1 text-small text-ink-muted">
                    <Icon name="lock" size={14} /> Calculated
                  </span>
                </span>
              </div>
            )}
          </section>
        )}

        {p && p.status !== "ACTIVE" && p.statusNote && (
          <Banner
            tone={p.status === "EXPELLED" ? "danger" : p.status === "PASSED_OUT" ? "info" : "warning"}
            title={`${p.status === "PASSED_OUT" ? "Passed out" : p.status === "LEFT" ? "Left the school" : p.status === "EXPELLED" ? "Expelled" : "Struck off"} on ${formatDate(p.statusNote.on)}`}
            actions={
              editable && allowed.includes("RESTORED") ? (
                <Button size="sm" variant="secondary" icon="refresh" onClick={() => setStatusKind("RESTORED")}>
                  Restore to class
                </Button>
              ) : undefined
            }
          >
            {p.statusNote.reason}
            {p.statusNote.remarks ? ` · ${p.statusNote.remarks}` : ""}
            {p.balance > 0 ? ` · ${formatRs(p.balance)} still due` : ""}
          </Banner>
        )}
        {p?.nextSession && (
          <Banner tone="info" icon="arrowUp" title={`Next session ${formatSession(p.nextSession.session)}: ${STUDENT_PROMOTION_OUTCOME_LABEL[p.nextSession.outcome]}${p.nextSession.classSection ? ` · ${p.nextSession.classSection}` : ""}${p.nextSession.stream ? ` · ${p.nextSession.stream}` : ""}`}>
            Decided on {formatDate(p.nextSession.decidedOn)} by {p.nextSession.decidedBy}. It takes effect when the new session starts on 01-Apr-{p.nextSession.session}.
          </Banner>
        )}

        {p && (
          <div className="grid gap-4 lg:grid-cols-2">
            <GuardianCard p={p} />
            <SiblingsCard p={p} />
          </div>
        )}

        <section className="mtb-card mtb-rise px-5 pb-5" style={stagger(3)} aria-label="Student records">
          <Tabs
            aria-label="Student records"
            value={tab}
            onChange={(t) => setTab(t as ProfileTab)}
            tabs={[
              { id: "enrolment", label: "Class history" },
              { id: "attendance", label: "Attendance" },
              { id: "results", label: "Results" },
              ...(canLedger ? [{ id: "ledger", label: "Fee ledger" }] : []),
              { id: "family", label: "Family" },
              { id: "documents", label: "Documents", ...(p?.documentsIssued ? { count: p.documentsIssued } : {}) },
              { id: "sms", label: "SMS history" },
            ]}
          />
          <TabPanel id="enrolment" active={tab === "enrolment"}>
            {!p ? <TabSkeleton /> : <ClassHistoryTab p={p} />}
          </TabPanel>
          <TabPanel id="attendance" active={tab === "attendance"}>
            <AttendanceTab grNo={grNo} />
          </TabPanel>
          <TabPanel id="results" active={tab === "results"}>
            <ResultsTab grNo={grNo} p={p} />
          </TabPanel>
          {canLedger && (
            <TabPanel id="ledger" active={tab === "ledger"}>
              <div className="pt-5">
                <LedgerTable
                  grNo={grNo}
                  defaultSession={ctx.session}
                  {...(p ? { student: { grNo: p.grNo, name: p.name, relation: p.relation, father: p.father, classSection: p.classSection, campus: p.campus, campusName: p.campusName, status: p.status } } : {})}
                />
              </div>
            </TabPanel>
          )}
          <TabPanel id="family" active={tab === "family"}>
            {!p ? <TabSkeleton /> : <FamilyTab p={p} />}
          </TabPanel>
          <TabPanel id="documents" active={tab === "documents"}>
            {!p ? <TabSkeleton /> : <DocumentsTab p={p} onIssue={setIssueType} />}
          </TabPanel>
          <TabPanel id="sms" active={tab === "sms"}>
            <SmsTab grNo={grNo} />
          </TabPanel>
        </section>

        {p && <SendSmsModal p={p} open={smsOpen} onClose={() => setSmsOpen(false)} />}
        {p && <EditPanel p={p} open={editOpen} onClose={() => setEditOpen(false)} />}
        {p && <AdmissionFormModal grNo={p.grNo} open={formOpen} onClose={() => setFormOpen(false)} />}
        {p && <ChangeSectionModal p={p} open={sectionOpen} onClose={() => setSectionOpen(false)} />}
        {p && <StatusChangePanel open={statusKind !== null} onClose={() => setStatusKind(null)} grNo={p.grNo} {...(statusKind ? { initialKind: statusKind } : {})} />}
        {p && <IssueDocumentPanel open={issueType !== null} onClose={() => setIssueType(null)} grNo={p.grNo} {...(issueType ? { initialType: issueType } : {})} />}
        {p && <AddressLabelsPanel open={labelOpen} onClose={() => setLabelOpen(false)} query={{ grNos: [p.grNo] }} title={`${p.name} · ${p.grNo}`} />}
      </Page>
    </RequirePermission>
  );
}
