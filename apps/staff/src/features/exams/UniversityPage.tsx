import {
  ApiError,
  examsApi,
  examsGradeFor,
  examsQueries,
  examsUniGradeFor,
  EXAMS_DEFAULT_PASS_RULES,
  EXAMS_DEFAULT_SCALE,
  EXAMS_UNI_MIN_ATTENDANCE,
  examsPassMark,
  type ExamsMark,
  type ExamsUniCourse,
  type ExamsUniCourseInput,
  type ExamsUniMark,
  type ExamsUniPart,
  type ExamsUniProgramme,
  type ExamsUniSemester,
  type ExamsUniStudentRow,
} from "@mtb/api";
import { formatCount, formatDate, formatDateTime, formatSession, type IsoDate } from "@mtb/domain";
import { AnimatedNumber, Banner, Button, Checkbox, ConfirmDialog, DataTable, DatePicker, EmptyState, Input, Panel, Segmented, Select, SidePanel, Skeleton, StatCard, StatusBadge, Textarea, Tooltip, useToast, type Column } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useCallback, useState, type CSSProperties } from "react";
import { z } from "zod";
import { campusLabel } from "../../app/shell/campus";
import { Page, PageHeader } from "../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { cellText, MarksGrid, parseCell, type GridCol, type GridValues } from "./MarksGrid";
import { EXAMS_TODAY } from "./NewExamPage";
import { DocHead, PRINTED_ON } from "./print/docs";
import { PrintSheet, printNow } from "./print/PrintSheet";
import { errorText, ExamsNav, LoadError, ordinal } from "./shared";
import { useAutosave } from "./useAutosave";

export interface UniversitySearch {
  semester?: string;
  tab?: "marks" | "results" | "courses" | "sheet" | "transcript";
  course?: string;
  student?: string;
  sheet?: "mid" | "final" | "course" | "award";
  /** Transcripts tab: the transcript, or every assessment taken. */
  view?: "transcript" | "history";
}

const gpaText = (n: number | null) => (n === null ? "—" : n.toFixed(2));
/** University paper types; every other University type is an internal-assessment component. */
const MID = "et-uni-mid";
const FINAL = "et-uni-final";

/** University semester exams for campuses with degree programmes: courses, credit hours, GPA and CGPA, transcripts. */
export function UniversityPage({ search, onSearch }: { search: UniversitySearch; onSearch: (next: UniversitySearch) => void }) {
  const ctx = useCtx();
  const canManage = useCan("exams.manage");
  const readOnly = useReadOnly();
  const editable = canManage && !readOnly;
  const programmes = useQuery(examsQueries.uniProgrammes(ctx));
  const [adding, setAdding] = useState<"programme" | { programmeId: string } | null>(null);
  const all = (programmes.data ?? []).flatMap((p) => p.semesters.map((s) => ({ ...s, programme: p })));
  const selected = all.find((s) => s.id === search.semester) ?? all.find((s) => s.session === ctx.session && s.status === "DRAFT") ?? all.find((s) => s.session === ctx.session) ?? all[0];

  return (
    <Page>
      <PageHeader
        title="University exams"
        actions={
          editable && ctx.campus !== "ALL" ? (
            <Button icon="plus" onClick={() => setAdding("programme")}>
              Add programme
            </Button>
          ) : undefined
        }
      />
      <ExamsNav />
      {programmes.isError && <LoadError what="Degree programmes" error={programmes.error} onRetry={() => void programmes.refetch()} />}
      {programmes.isLoading ? (
        <Skeleton height={180} />
      ) : (programmes.data ?? []).length === 0 ? (
        <div className="mtb-card">
          <EmptyState
            icon="book"
            title={`No degree programmes at ${campusLabel(ctx.campus)}`}
            description="University exams run only at campuses that offer degree programmes. Khalid Campus runs BS Computer Science, BS Zoology, the Associate Degree and MCS."
          />
        </div>
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            {programmes.data!.map((p, pi) => (
              <Panel
                key={p.id}
                id={`prog-${p.id}`}
                title={`${p.short} · ${p.name}`}
                description={`${p.years}-year programme · ${campusLabel(p.campus)} · assessment: ${p.components.map((c) => `${c.label} ${c.max}`).join(", ")}`}
                rise={pi}
                actions={
                  editable ? (
                    <Button size="sm" icon="plus" onClick={() => setAdding({ programmeId: p.id })}>
                      Add semester
                    </Button>
                  ) : undefined
                }
              >
                {p.semesters.length === 0 ? (
                  <p className="m-0 text-small text-ink-muted">No semesters yet. Add the first one to start entering marks.</p>
                ) : (
                  <ul className="m-0 grid list-none gap-2 p-0">
                    {p.semesters.map((s, i) => (
                      <li key={s.id} className="mtb-slide-in" style={{ "--i": i } as CSSProperties}>
                        <button
                          type="button"
                          onClick={() => onSearch({ semester: s.id })}
                          className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left ${selected?.id === s.id ? "border-brand bg-brand-tint" : "border-border hover:bg-surface-hover"}`}
                        >
                          <span className="grid min-w-0 flex-1">
                            <span className="font-medium">{s.label}</span>
                            <span className="text-small text-ink-muted">
                              {s.students} students · {s.courseCount} courses · Session {formatSession(s.session)}
                            </span>
                          </span>
                          {s.status === "DECLARED" ? (
                            <StatusBadge status="declared" icon="lock" />
                          ) : s.courseCount === 0 ? (
                            <StatusBadge status="neutral" dot={false}>
                              Add courses
                            </StatusBadge>
                          ) : s.missing > 0 ? (
                            <StatusBadge status="warning" dot={false}>
                              {formatCount(s.missing)} results open
                            </StatusBadge>
                          ) : (
                            <StatusBadge status="success" dot={false}>
                              Ready to declare
                            </StatusBadge>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            ))}
          </div>
          {selected && <SemesterView key={selected.id} id={selected.id} search={search} onSearch={(next) => onSearch({ ...next, semester: selected.id })} />}
        </>
      )}
      {adding === "programme" && <ProgrammePanel onClose={() => setAdding(null)} />}
      {adding && adding !== "programme" && programmes.data && (
        <SemesterPanel programmes={programmes.data} programmeId={adding.programmeId} onClose={() => setAdding(null)} onCreated={(id) => onSearch({ semester: id, tab: "courses" })} />
      )}
    </Page>
  );
}

// ------------------------------------------------------------------ Set up: programme, semester, courses

function useUniTypes() {
  const ctx = useCtx();
  const types = useQuery(examsQueries.types(ctx));
  return (types.data ?? []).filter((t) => t.category === "UNIVERSITY" && t.active && t.id !== MID && t.id !== FINAL);
}

const programmeSchema = z.object({
  short: z.string().trim().min(2, "Give a short name, for example MCS.").max(12, "Keep the short name to 12 characters."),
  name: z.string().trim().min(4, "Give the programme its full name."),
  years: z.coerce.number({ error: "Type the number of years." }).int("Use whole years.").min(1, "At least 1 year.").max(6, "No more than 6 years."),
});

function ProgrammePanel({ onClose }: { onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const types = useUniTypes();
  const [form, setForm] = useState({ short: "", name: "", years: "2" });
  const [parts, setParts] = useState<Record<string, string>>({ "et-uni-quiz": "5", "et-uni-test": "5", "et-uni-assign": "10" });
  const [tried, setTried] = useState(false);
  const parsed = programmeSchema.safeParse(form);
  const errs: Record<string, string> = parsed.success ? {} : Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]));
  const chosen = Object.entries(parts).filter(([, v]) => v !== "");
  const partErr = chosen.length === 0 ? "Tick at least one internal-assessment type." : chosen.some(([, v]) => !/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 50) ? "Each maximum is a whole number from 1 to 50." : null;
  const save = useMutation({
    mutationFn: () => examsApi.uniCreateProgramme(ctx, { short: form.short.trim(), name: form.name.trim(), years: Number(form.years), components: chosen.map(([typeId, v]) => ({ typeId, max: Number(v) })) }),
    onSuccess: (p) => {
      void queryClient.invalidateQueries({ queryKey: ["exams"] });
      toast({ title: "Programme added", message: `${p.short} · ${p.name}. Add its first semester next.` });
      onClose();
    },
  });
  return (
    <SidePanel
      open
      onClose={onClose}
      title="Add a degree programme"
      description={`${campusLabel(ctx.campus)} · for example MCS or BS Zoology`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon="check"
            loading={save.isPending}
            onClick={() => {
              setTried(true);
              if (parsed.success && !partErr) save.mutate();
            }}
          >
            Add programme
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
          <Input label="Short name" required value={form.short} onChange={(e) => setForm((f) => ({ ...f, short: e.target.value }))} error={tried ? errs.short : save.error instanceof ApiError && save.error.field === "short" ? save.error.message : undefined} />
          <Input label="Full name" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} error={tried ? errs.name : undefined} />
        </div>
        <Input label="Length" suffix="years" amount inputMode="numeric" value={form.years} onChange={(e) => setForm((f) => ({ ...f, years: e.target.value.replace(/\D/g, "") }))} error={tried ? errs.years : undefined} help="Two semesters a year." />
        <fieldset className="m-0 grid gap-2 border-0 p-0">
          <legend className="mb-1 text-small font-medium">Internal assessment for new courses</legend>
          <p className="m-0 text-small text-ink-muted">Each type becomes a marks column. Courses can change these later.</p>
          {types.map((t) => (
            <div key={t.id} className="flex items-center gap-3">
              <div className="w-48">
                <Checkbox label={t.name} checked={parts[t.id] !== undefined} onChange={(e) => setParts((p) => (e.target.checked ? { ...p, [t.id]: "5" } : Object.fromEntries(Object.entries(p).filter(([k]) => k !== t.id))))} />
              </div>
              {parts[t.id] !== undefined && (
                <div className="w-28">
                  <Input aria-label={`${t.name} maximum`} suffix="marks" amount inputMode="numeric" value={parts[t.id]} onChange={(e) => setParts((p) => ({ ...p, [t.id]: e.target.value.replace(/\D/g, "") }))} />
                </div>
              )}
            </div>
          ))}
          {tried && partErr && <p className="m-0 text-small text-danger-ink">{partErr}</p>}
        </fieldset>
        {save.isError && !(save.error instanceof ApiError && save.error.field === "short") && <Banner tone="danger">{errorText(save.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

function SemesterPanel({ programmes, programmeId, onClose, onCreated }: { programmes: ExamsUniProgramme[]; programmeId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const prog = programmes.find((p) => p.id === programmeId)!;
  const next = (prog.semesters[0]?.number ?? 0) + 1;
  const [number, setNumber] = useState(String(Math.min(next, prog.years * 2)));
  const [label, setLabel] = useState(next % 2 === 0 ? "Spring 2027" : "Fall 2026");
  const [ids, setIds] = useState<string[]>(() => prog.students.map((s) => s.id));
  const [fresh, setFresh] = useState("");
  const [tried, setTried] = useState(false);
  const newStudents = fresh
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [name, father] = l.split(",").map((x) => x.trim());
      return { name: name ?? "", father: father ?? "" };
    });
  const badLine = newStudents.findIndex((s) => s.name.length < 3 || s.father.length < 3);
  const schema = z.object({
    number: z.coerce.number().int("Use a whole number.").min(1, "From semester 1.").max(prog.years * 2, `${prog.short} has ${prog.years * 2} semesters.`),
    label: z.string().trim().min(4, "Say which term it is, for example Spring 2027."),
  });
  const parsed = schema.safeParse({ number, label });
  const errs: Record<string, string> = parsed.success ? {} : Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]));
  const studentErr = badLine >= 0 ? `Line ${badLine + 1}: write the name, a comma, then the father's name.` : ids.length + newStudents.length === 0 ? "Add at least one student." : null;
  const save = useMutation({
    mutationFn: () => examsApi.uniCreateSemester(ctx, { programmeId: prog.id, number: Number(number), label: label.trim(), session: ctx.session, studentIds: ids, newStudents }),
    onSuccess: (s) => {
      void queryClient.invalidateQueries({ queryKey: ["exams"] });
      toast({ title: "Semester opened", message: `${s.programmeShort} · ${s.label} · ${s.students} students. Add its courses now.` });
      onCreated(s.id);
      onClose();
    },
  });
  return (
    <SidePanel
      open
      onClose={onClose}
      wide
      title={`Add a semester to ${prog.short}`}
      description={`Session ${formatSession(ctx.session)} · courses are added after`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon="check"
            loading={save.isPending}
            onClick={() => {
              setTried(true);
              if (parsed.success && !studentErr) save.mutate();
            }}
          >
            Open semester
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Semester number" required amount inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value.replace(/\D/g, ""))} error={tried ? errs.number : undefined} />
          <Input label="Term" required value={label} onChange={(e) => setLabel(e.target.value)} error={tried ? errs.label : undefined} help={`Shown as “Semester ${number || "…"} · ${label || "…"}”.`} />
        </div>
        {prog.students.length > 0 && (
          <fieldset className="m-0 grid gap-2 border-0 p-0">
            <legend className="mb-1 text-small font-medium">Students carried over ({ids.length} of {prog.students.length})</legend>
            <Checkbox label="Check all" checked={ids.length === prog.students.length} onChange={(e) => setIds(e.target.checked ? prog.students.map((s) => s.id) : [])} />
            <div className="grid max-h-64 gap-1 overflow-auto rounded-md border border-border p-2 sm:grid-cols-2">
              {prog.students.map((s) => (
                <Checkbox key={s.id} label={`${s.name} · ${s.id}`} checked={ids.includes(s.id)} onChange={(e) => setIds((l) => (e.target.checked ? [...l, s.id] : l.filter((x) => x !== s.id)))} />
              ))}
            </div>
          </fieldset>
        )}
        <Textarea
          label="New students"
          rows={4}
          value={fresh}
          onChange={(e) => setFresh(e.target.value)}
          placeholder={"One per line: name, father's name\nFor example: Sana Ijaz, Ijaz Ahmed"}
          help="Registration numbers are given on saving."
          error={tried && badLine >= 0 ? (studentErr ?? undefined) : undefined}
        />
        {tried && studentErr && badLine < 0 && <p className="m-0 text-small text-danger-ink">{studentErr}</p>}
        {save.isError && <Banner tone="danger">{errorText(save.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

function SemesterView({ id, search, onSearch }: { id: string; search: UniversitySearch; onSearch: (next: UniversitySearch) => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canDeclare = useCan("exams.declare");
  const canManage = useCan("exams.manage");
  const readOnly = useReadOnly();
  const sem = useQuery(examsQueries.uniSemester(ctx, id));
  const programmes = useQuery(examsQueries.uniProgrammes(ctx));
  const [confirming, setConfirming] = useState(false);
  const declare = useMutation({
    mutationFn: () => examsApi.uniDeclare(id),
    onSuccess: (data) => {
      queryClient.setQueryData(examsQueries.uniSemester(ctx, id).queryKey, data);
      void queryClient.invalidateQueries({ queryKey: ["exams"], refetchType: "active" });
      setConfirming(false);
      toast({ title: "Semester results declared", message: `${data.programmeShort} · ${data.label}. GPA and CGPA are locked.` });
    },
  });

  if (sem.isLoading) return <Skeleton height={360} />;
  if (sem.isError || !sem.data) return <LoadError what="This semester" error={sem.error} onRetry={() => void sem.refetch()} />;
  const s = sem.data;
  const noCourses = s.courses.length === 0;
  const tab = search.tab ?? (noCourses ? "courses" : "results");
  const declared = s.status === "DECLARED";
  const credits = s.courses.reduce((a, c) => a + c.creditHours, 0);
  const gpas = s.rows.map((r) => r.gpa).filter((g): g is number => g !== null);
  const probation = s.rows.filter((r) => r.standing === "PROBATION").length;
  const blocked = noCourses ? "Add the semester's courses first." : s.missing > 0 ? `${formatCount(s.missing)} course results are open: final papers aren't marked yet.` : readOnly ? "Past sessions are read-only." : null;
  const programme = programmes.data?.find((p) => p.id === s.programmeId);

  return (
    <>
      <Panel
        id="semester"
        title={`${s.programmeShort} · ${s.label}`}
        description={`${s.programmeName} · ${campusLabel(s.campus)} · Session ${formatSession(s.session)}${declared && s.declaredOn ? ` · declared ${formatDateTime(s.declaredOn)} by ${s.declaredBy ?? "—"}` : ""}`}
        rise={2}
        actions={
          <>
            {declared ? <StatusBadge status="declared" icon="lock" /> : <StatusBadge status="draft" />}
            {!declared &&
              canDeclare &&
              (blocked ? (
                <Tooltip content={blocked}>
                  <span tabIndex={0} className="inline-flex rounded-md" aria-label={`Declare results — not available: ${blocked}`}>
                    <Button variant="primary" icon="lock" disabled tabIndex={-1}>
                      Declare results
                    </Button>
                  </span>
                </Tooltip>
              ) : (
                <Button variant="primary" icon="lock" onClick={() => setConfirming(true)}>
                  Declare results
                </Button>
              ))}
          </>
        }
      >
        <div className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Students" icon="students" value={<AnimatedNumber value={s.students} format={formatCount} />} foot={`${s.courses.length} courses · ${credits} credit hours`} />
            <StatCard label="Results open" icon="alertCircle" tone={s.missing > 0 ? "warning" : "neutral"} value={<AnimatedNumber value={s.missing} format={formatCount} />} foot={noCourses ? "No courses yet" : s.missing > 0 ? "Final papers to mark" : "Every course result is in"} />
            <StatCard label="Average GPA" icon="trendUp" tone="info" value={gpas.length ? (gpas.reduce((a, g) => a + g, 0) / gpas.length).toFixed(2) : "—"} foot={gpas.length ? `${gpas.length} students with a GPA` : "After final papers"} />
            <StatCard label="On probation" icon="alert" tone={probation ? "danger" : "neutral"} value={probation} foot="CGPA below 2.0" />
          </div>
          <Segmented
            aria-label="Semester view"
            value={tab}
            onChange={(v) => onSearch({ tab: v as UniversitySearch["tab"] })}
            options={[
              { value: "results", label: "Results" },
              { value: "marks", label: "Marks entry" },
              { value: "courses", label: "Courses" },
              { value: "sheet", label: "Master sheet" },
              { value: "transcript", label: "Transcripts" },
            ]}
          />
          {noCourses && tab !== "courses" && tab !== "transcript" ? (
            <EmptyState icon="book" title="No courses yet" description="Add the semester's courses (code, credit hours, teacher, assessment and paper dates) under Courses." />
          ) : (
            <>
              {tab === "marks" && <UniMarks key={`${s.id}:${search.course ?? ""}:${s.courses.map((c) => c.id + c.components.length).join(",")}`} sem={s} courseId={search.course} locked={declared || readOnly || !canManage} onCourse={(c) => onSearch({ tab: "marks", course: c })} />}
              {tab === "results" && <UniResults sem={s} />}
              {tab === "courses" && <UniCourses sem={s} programme={programme} locked={declared || readOnly || !canManage} />}
              {tab === "sheet" &&
                (search.sheet === "award" ? (
                  <UniAwardList sem={s} courseId={search.course} onChange={(next) => onSearch({ tab: "sheet", sheet: "award", ...next })} />
                ) : search.sheet === "course" ? (
                  <UniCourseSheet sem={s} courseId={search.course} onChange={(next) => onSearch({ tab: "sheet", sheet: "course", ...next })} />
                ) : (
                  <UniSheet sem={s} variant={search.sheet ?? (s.missing > 0 ? "mid" : "final")} onVariant={(v) => onSearch({ tab: "sheet", sheet: v })} />
                ))}
              {tab === "transcript" && <UniTranscript sem={s} studentId={search.student ?? s.rows[0]?.id ?? ""} view={search.view ?? "transcript"} onChange={(next) => onSearch({ tab: "transcript", student: search.student, view: search.view, ...next })} />}
            </>
          )}
        </div>
      </Panel>
      <ConfirmDialog
        open={confirming}
        onClose={() => {
          if (!declare.isPending) setConfirming(false);
        }}
        onConfirm={() => declare.mutate()}
        title={`Declare ${s.programmeShort} ${s.label} results?`}
        message="GPA and CGPA are locked and the semester appears on transcripts. Reopening needs admin approval."
        details={[
          ["Students", formatCount(s.students)],
          ["Courses", `${s.courses.length} · ${credits} credit hours`],
          ["Open results", formatCount(s.missing)],
        ]}
        confirmLabel="Declare results"
        requireText="DECLARE"
        loading={declare.isPending}
        loadingLabel="Declaring…"
        error={declare.isError ? errorText(declare.error) : undefined}
      />
    </>
  );
}

// ------------------------------------------------------------------ Courses

function UniCourses({ sem, programme, locked }: { sem: ExamsUniSemester; programme: ExamsUniProgramme | undefined; locked: boolean }) {
  const [editing, setEditing] = useState<ExamsUniCourse | "new" | null>(null);
  const columns: Array<Column<ExamsUniCourse>> = [
    { key: "code", header: "Code", width: 100, render: (c) => <span className="mtb-mono">{c.code}</span> },
    { key: "title", header: "Course", width: 230, render: (c) => <span className="mtb-cell-primary">{c.title}</span> },
    { key: "ch", header: "CH", align: "right", width: 60, render: (c) => (c.creditHoursFromSetup ? <span title="From Setup › Subjects › Class subjects">{c.creditHours}</span> : c.creditHours) },
    { key: "teacher", header: "Teacher", width: 170, render: (c) => c.teacher },
    { key: "assess", header: "Internal assessment", width: 260, render: (c) => <span className="text-small">{c.components.map((x) => `${x.label} ${x.max}`).join(" · ")}</span> },
    { key: "papers", header: "Mid · final", width: 110, render: (c) => `${c.midMax} · ${c.finalMax}` },
    { key: "dates", header: "Paper dates", width: 190, render: (c) => <span className="text-small">{c.midDate ? formatDate(c.midDate) : "—"} · {c.finalDate ? formatDate(c.finalDate) : "—"}</span> },
    { key: "sup", header: "Supervisor", width: 160, render: (c) => <span className="text-small">{c.supervisor ?? "—"}</span> },
  ];
  return (
    <div className="grid gap-3">
      <DataTable
        caption={`${sem.programmeShort} ${sem.label} courses`}
        columns={columns}
        rows={sem.courses}
        density="dense"
        onRowClick={locked ? undefined : (c) => setEditing(c)}
        toolbar={
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <span className="text-small text-ink-muted">
              {sem.courses.length} courses · {sem.courses.reduce((a, c) => a + c.creditHours, 0)} credit hours. Internal assessment, mid and final add up to 100 in each course.
            </span>
            {!locked && (
              <Button size="sm" icon="plus" onClick={() => setEditing("new")}>
                Add course
              </Button>
            )}
          </div>
        }
        empty={<EmptyState icon="book" title="No courses yet" description={locked ? "Courses can't be added here." : "Add the first course."} />}
      />
      {locked && <Banner tone="neutral">Courses are read-only here{sem.status === "DECLARED" ? ": this semester is declared." : "."}</Banner>}
      {editing && <CoursePanel sem={sem} programme={programme} course={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

const courseSchema = z.object({
  code: z.string().trim().regex(/^[A-Za-z]{2,5}-?\d{3}$/, "Use a course code like CS-401."),
  title: z.string().trim().min(3, "Give the course a title."),
  creditHours: z.coerce.number({ error: "Type the credit hours." }).int("Use whole credit hours.").min(1, "At least 1.").max(6, "No more than 6."),
  teacher: z.string().trim().min(3, "Name the course teacher."),
  midMax: z.coerce.number({ error: "Type the mid maximum." }).int("Use whole marks.").min(0, "Can't be below 0."),
  finalMax: z.coerce.number({ error: "Type the final maximum." }).int("Use whole marks.").min(0, "Can't be below 0."),
  durationMins: z.coerce.number({ error: "Type the minutes." }).int("Use whole minutes.").min(30, "At least 30 minutes.").max(300, "No more than 300 minutes."),
});

function CoursePanel({ sem, programme, course, onClose }: { sem: ExamsUniSemester; programme: ExamsUniProgramme | undefined; course: ExamsUniCourse | null; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const types = useUniTypes();
  const defaults = course?.components ?? programme?.components ?? [];
  const [form, setForm] = useState({
    code: course?.code ?? "",
    title: course?.title ?? "",
    creditHours: String(course?.creditHours ?? 3),
    teacher: course?.teacher ?? "",
    midMax: String(course?.midMax ?? 30),
    finalMax: String(course?.finalMax ?? 50),
    durationMins: String(course?.durationMins ?? 120),
    supervisor: course?.supervisor ?? "",
    midDate: (course?.midDate ?? null) as IsoDate | null,
    finalDate: (course?.finalDate ?? null) as IsoDate | null,
  });
  const [parts, setParts] = useState<Record<string, { max: string; date: IsoDate | null }>>(() => Object.fromEntries(defaults.map((c) => [c.typeId, { max: String(c.max), date: c.date ?? null }])));
  const [tried, setTried] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const parsed = courseSchema.safeParse(form);
  const errs: Record<string, string> = parsed.success ? {} : Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]));
  const chosen = Object.entries(parts);
  const sessional = chosen.reduce((a, [, p]) => a + (Number(p.max) || 0), 0);
  const total = sessional + (Number(form.midMax) || 0) + (Number(form.finalMax) || 0);
  const otherCodes = sem.courses.filter((c) => c.id !== course?.id).map((c) => c.code.toUpperCase());
  const problems = [
    chosen.length === 0 ? "Tick at least one internal-assessment type." : null,
    chosen.some(([, p]) => !/^\d+$/.test(p.max) || Number(p.max) < 1 || Number(p.max) > 50) ? "Each assessment maximum is a whole number from 1 to 50." : null,
    total !== 100 ? `Internal assessment (${sessional}), mid (${form.midMax || 0}) and final (${form.finalMax || 0}) must add up to 100; they add up to ${total}.` : null,
    otherCodes.includes(form.code.trim().toUpperCase()) ? `${form.code.trim().toUpperCase()} is already a course in this semester.` : null,
    form.midDate && form.finalDate && form.finalDate <= form.midDate ? "The final paper must come after the mid paper." : null,
  ].filter((x): x is string => Boolean(x));
  const typeName = (id: string) => types.find((t) => t.id === id)?.name ?? defaults.find((d) => d.typeId === id)?.label ?? id;
  // Setup holds the credit hours of courses it knows: read-only here, so the two never disagree.
  const fromSetup = Boolean(course?.creditHoursFromSetup);
  const canSetupAll = useCan("setup.manage");
  const canSetupCampus = useCan("setup.campus");
  const canSetup = canSetupAll || canSetupCampus;

  const save = useMutation({
    mutationFn: () => {
      const toInput = (c: ExamsUniCourse): ExamsUniCourseInput => ({
        id: c.id,
        code: c.code,
        title: c.title,
        creditHours: c.creditHours,
        teacher: c.teacher,
        components: c.components.map((x) => ({ typeId: x.typeId, max: x.max, ...(x.date ? { date: x.date } : {}) })),
        midMax: c.midMax,
        finalMax: c.finalMax,
        ...(c.midDate ? { midDate: c.midDate } : {}),
        ...(c.finalDate ? { finalDate: c.finalDate } : {}),
        ...(c.durationMins ? { durationMins: c.durationMins } : {}),
        ...(c.supervisor ? { supervisor: c.supervisor } : {}),
      });
      const mine: ExamsUniCourseInput = {
        ...(course ? { id: course.id } : {}),
        code: form.code.trim().toUpperCase(),
        title: form.title.trim(),
        creditHours: Number(form.creditHours),
        teacher: form.teacher.trim(),
        components: chosen.map(([typeId, p]) => ({ typeId, max: Number(p.max), ...(p.date ? { date: p.date } : {}) })),
        midMax: Number(form.midMax),
        finalMax: Number(form.finalMax),
        ...(form.midDate ? { midDate: form.midDate } : {}),
        ...(form.finalDate ? { finalDate: form.finalDate } : {}),
        durationMins: Number(form.durationMins),
        ...(form.supervisor.trim() ? { supervisor: form.supervisor.trim() } : {}),
      };
      const list = course ? sem.courses.map((c) => (c.id === course.id ? mine : toInput(c))) : [...sem.courses.map(toInput), mine];
      return examsApi.uniSaveCourses(sem.id, list);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(examsQueries.uniSemester(ctx, sem.id).queryKey, data);
      void queryClient.invalidateQueries({ queryKey: examsQueries.uniProgrammes(ctx).queryKey });
      toast({ title: course ? "Course saved" : "Course added", message: `${form.code.trim().toUpperCase()} ${form.title.trim()}` });
      onClose();
    },
  });

  return (
    <SidePanel
      open
      onClose={onClose}
      wide
      title={course ? `${course.code} ${course.title}` : "Add a course"}
      description={`${sem.programmeShort} · ${sem.label}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon="check"
            loading={save.isPending}
            onClick={() => {
              setTried(true);
              if (parsed.success && problems.length === 0) save.mutate();
            }}
          >
            {course ? "Save course" : "Add course"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-[140px_1fr_100px]">
          <Input label="Code" required mono value={form.code} onChange={(e) => set({ code: e.target.value })} error={tried ? errs.code : undefined} />
          <Input label="Title" required value={form.title} onChange={(e) => set({ title: e.target.value })} error={tried ? errs.title : undefined} />
          <Input label="Credit hours" required amount inputMode="numeric" value={form.creditHours} readOnly={fromSetup} disabled={fromSetup} onChange={(e) => set({ creditHours: e.target.value.replace(/\D/g, "") })} error={tried ? errs.creditHours : undefined} />
        </div>
        {fromSetup && (
          <p className="m-0 text-small text-ink-muted">
            Credit hours come from Setup, where this course is a class subject.{" "}
            {canSetup ? (
              <Link to="/setup/subjects" className="font-medium text-brand-ink underline-offset-2 hover:underline">
                Change them in Setup › Subjects
              </Link>
            ) : (
              "Ask head office to change them in Setup › Subjects."
            )}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Course teacher (instructor)" required value={form.teacher} onChange={(e) => set({ teacher: e.target.value })} error={tried ? errs.teacher : undefined} />
          <Input label="Exam supervisor" value={form.supervisor} onChange={(e) => set({ supervisor: e.target.value })} placeholder="Optional" />
        </div>
        <fieldset className="m-0 grid gap-2 rounded-md border border-border p-3">
          <legend className="px-1 text-small font-medium">Internal assessment · {sessional} marks</legend>
          {types.map((t) => {
            const p = parts[t.id];
            return (
              <div key={t.id} className="flex flex-wrap items-end gap-3">
                <div className="w-48 pb-2">
                  <Checkbox label={t.name} checked={Boolean(p)} onChange={(e) => setParts((x) => (e.target.checked ? { ...x, [t.id]: { max: "5", date: null } } : Object.fromEntries(Object.entries(x).filter(([k]) => k !== t.id))))} />
                </div>
                {p && (
                  <>
                    <div className="w-28">
                      <Input aria-label={`${typeName(t.id)} maximum`} suffix="marks" amount inputMode="numeric" value={p.max} onChange={(e) => setParts((x) => ({ ...x, [t.id]: { ...p, max: e.target.value.replace(/\D/g, "") } }))} />
                    </div>
                    <div className="w-44">
                      <DatePicker aria-label={`${typeName(t.id)} date`} value={p.date} onValueChange={(d) => setParts((x) => ({ ...x, [t.id]: { ...p, date: d } }))} today={EXAMS_TODAY} />
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Mid maximum" required amount inputMode="numeric" value={form.midMax} onChange={(e) => set({ midMax: e.target.value.replace(/\D/g, "") })} error={tried ? errs.midMax : undefined} />
          <Input label="Final maximum" required amount inputMode="numeric" value={form.finalMax} onChange={(e) => set({ finalMax: e.target.value.replace(/\D/g, "") })} error={tried ? errs.finalMax : undefined} />
          <Input label="Paper length" suffix="minutes" amount inputMode="numeric" value={form.durationMins} onChange={(e) => set({ durationMins: e.target.value.replace(/\D/g, "") })} error={tried ? errs.durationMins : undefined} />
          <DatePicker label="Mid paper on" value={form.midDate} onValueChange={(d) => set({ midDate: d })} today={EXAMS_TODAY} />
          <DatePicker label="Final paper on" value={form.finalDate} onValueChange={(d) => set({ finalDate: d })} today={EXAMS_TODAY} />
        </div>
        <p className={total === 100 ? "m-0 text-small text-ink-muted" : "m-0 text-small font-medium text-warning-ink"}>
          Total: {sessional} + {form.midMax || 0} + {form.finalMax || 0} = {total} of 100.
        </p>
        {tried && problems.length > 0 && (
          <Banner tone="danger" title="Fix these first">
            <ul className="m-0 mt-1 grid gap-0.5 ps-5">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Banner>
        )}
        {save.isError && <Banner tone="danger">{errorText(save.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

// ------------------------------------------------------------------ Marks entry

/** Grid columns for a course: one per internal-assessment component, then Mid, Final and Attendance. */
const UNI_COLS = (c: ExamsUniCourse): GridCol[] => [
  ...(c.components.length ? c.components.map<GridCol>((x) => ({ key: x.typeId, label: x.label, max: x.max, allowAbsent: true, allowLeave: true })) : [{ key: "sessional", label: "Sessional", max: c.sessionalMax }]),
  { key: "mid", label: "Mid", max: c.midMax, allowAbsent: true, allowLeave: true },
  { key: "final", label: "Final", max: c.finalMax, allowAbsent: true, allowLeave: true },
  { key: "attendance", label: "Attendance", max: 100, percent: true },
];

function UniMarks({ sem, courseId, locked, onCourse }: { sem: ExamsUniSemester; courseId: string | undefined; locked: boolean; onCourse: (c: string) => void }) {
  const ctx = useCtx();
  const queryClient = useQueryClient();
  const course = sem.courses.find((c) => c.id === courseId) ?? sem.courses[0]!;
  const cols = UNI_COLS(course);
  const compCols = cols.filter((c) => c.key !== "mid" && c.key !== "final" && c.key !== "attendance");
  const [values, setValues] = useState<GridValues>(() =>
    Object.fromEntries(
      sem.rows.map((r) => {
        const m = r.marks[course.id];
        const comp = course.components.length ? Object.fromEntries(course.components.map((x) => [x.typeId, cellText((m?.parts?.[x.typeId] ?? null) as ExamsMark)])) : { sessional: cellText(m?.sessional ?? null) };
        return [r.id, { ...comp, mid: cellText((m?.mid ?? null) as ExamsMark), final: cellText((m?.final ?? null) as ExamsMark), attendance: cellText(m?.attendance ?? null) }];
      }),
    ),
  );
  const [remarks, setRemarks] = useState<Record<string, string>>(() => Object.fromEntries(sem.rows.map((r) => [r.id, r.marks[course.id]?.remark ?? ""])));
  const toMark = useCallback(
    (rowId: string): ExamsUniMark | null => {
      const v = values[rowId] ?? {};
      const p = Object.fromEntries(cols.map((c) => [c.key, parseCell(v[c.key] ?? "", c)]));
      if (Object.values(p).some((x) => x.error)) return null;
      const parts = course.components.length ? (Object.fromEntries(compCols.map((c) => [c.key, p[c.key]!.value as ExamsUniPart])) as Record<string, ExamsUniPart>) : undefined;
      const sessional = parts ? (Object.values(parts).some((x) => x === null) ? null : Object.values(parts).reduce<number>((a, x) => a + (typeof x === "number" ? x : 0), 0)) : (p.sessional!.value as number | null);
      const remark = (remarks[rowId] ?? "").trim();
      return { sessional, ...(parts ? { parts } : {}), mid: p.mid!.value as ExamsUniPart, final: p.final!.value as ExamsUniPart, attendance: p.attendance!.value as number | null, ...(remark ? { remark } : {}) };
    },
    [values, cols, compCols, course.components.length, remarks],
  );
  const flush = useCallback(
    async (keys: string[]) => {
      const marks: Record<string, ExamsUniMark> = {};
      for (const rowId of new Set(keys.map((k) => k.split("|")[0]!))) {
        const m = toMark(rowId);
        if (m) marks[rowId] = m;
      }
      if (!Object.keys(marks).length) return;
      const data = await examsApi.uniSaveMarks(sem.id, { courseId: course.id, marks });
      queryClient.setQueryData(examsQueries.uniSemester(ctx, sem.id).queryKey, data);
      void queryClient.invalidateQueries({ queryKey: examsQueries.uniProgrammes(ctx).queryKey, exact: true });
    },
    [toMark, sem.id, course.id, queryClient, ctx],
  );
  const autosave = useAutosave(flush);
  const onChange = (rowId: string, key: string, raw: string) => {
    if (locked) return;
    setValues((v) => ({ ...v, [rowId]: { ...(v[rowId] ?? {}), [key]: raw } }));
    const col = cols.find((c) => c.key === key)!;
    if (parseCell(raw, col).error) autosave.forget(`${rowId}|${key}`);
    else autosave.mark(`${rowId}|${key}`);
  };
  const st = autosave.state;
  const max = course.sessionalMax + course.midMax + course.finalMax;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-96">
          <Select label="Course" value={course.id} onChange={(e) => onCourse(e.target.value)} options={sem.courses.map((c) => ({ value: c.id, label: `${c.code} ${c.title} · ${c.creditHours} CH · ${c.teacher}` }))} />
        </div>
        {!locked && (
          <span className="text-small text-ink-muted" role="status">
            {st.status === "saving" || st.status === "pending" ? "Saving…" : st.status === "error" ? `Not saved: ${errorText(st.error)}` : st.status === "saved" ? "All changes saved" : "Changes save on their own"}
          </span>
        )}
      </div>
      <p className="m-0 text-small text-ink-muted">
        {course.supervisor ? `Supervisor ${course.supervisor} · ` : ""}
        Mid {course.midDate ? formatDate(course.midDate) : "date not set"} · Final {course.finalDate ? formatDate(course.finalDate) : "date not set"}
        {course.durationMins ? ` · ${course.durationMins} minutes` : ""}
      </p>
      {locked && <Banner tone="neutral">Marks are read-only here{sem.status === "DECLARED" ? ": this semester is declared." : "."}</Banner>}
      <MarksGrid
        caption={`${course.code} marks`}
        rows={sem.rows.map((r, i) => ({ id: r.id, name: r.name, roll: i + 1, sub: <span className="mtb-mono">{r.id}</span> }))}
        cols={cols}
        values={values}
        onChange={onChange}
        readOnly={locked}
        trailingHead={
          <span className="exams-grid-head">
            <b>Total</b>
            <span>out of {max}</span>
          </span>
        }
        trailing={(row) => {
          const m = toMark(row.id);
          if (!m) return <span className="text-small text-danger-ink">Fix marks</span>;
          const total = (m.sessional ?? 0) + (typeof m.mid === "number" ? m.mid : 0) + (typeof m.final === "number" ? m.final : 0);
          const complete = m.sessional !== null && m.mid !== null && m.final !== null && m.attendance !== null;
          const short = m.attendance !== null && m.attendance < EXAMS_UNI_MIN_ATTENDANCE;
          return (
            <span className="grid justify-items-end gap-1">
              <span className="mtb-num font-semibold">{total}</span>
              <span className={short ? "text-[12px] font-medium text-danger-ink" : "text-[12px] text-ink-muted"}>{short ? "Short attendance: F" : complete ? `Grade ${examsUniGradeFor((total / max) * 100).grade}` : "final pending"}</span>
              <input
                className="exams-cell"
                style={{ width: 150, textAlign: "left" }}
                aria-label={`${row.name}, remarks`}
                placeholder="Remarks"
                value={remarks[row.id] ?? ""}
                readOnly={locked}
                maxLength={120}
                onChange={(e) => {
                  if (locked) return;
                  setRemarks((x) => ({ ...x, [row.id]: e.target.value }));
                  autosave.mark(`${row.id}|remark`);
                }}
              />
            </span>
          );
        }}
      />
      <p className="m-0 text-small text-ink-muted">
        {course.components.length ? `Internal assessment is ${course.components.map((x) => x.label).join(", ")}; their sum is the sessional mark. ` : "Sessional is assignments and quizzes. "}
        Type A for absent or L for leave (both count as 0). Attendance below {EXAMS_UNI_MIN_ATTENDANCE}% makes the course an F whatever the marks.
      </p>
    </div>
  );
}

function UniResults({ sem }: { sem: ExamsUniSemester }) {
  const columns: Array<Column<ExamsUniStudentRow>> = [
    {
      key: "name",
      header: "Student",
      width: 220,
      render: (r) => (
        <span className="grid">
          <span className="mtb-cell-primary">{r.name}</span>
          <span className="mtb-cell-secondary mtb-mono">{r.id}</span>
        </span>
      ),
    },
    ...sem.courses.map<Column<ExamsUniStudentRow>>((c) => ({
      key: c.id,
      header: (
        <span title={`${c.title} · ${c.creditHours} credit hours`}>
          {c.code} <span className="normal-case">· {c.creditHours}</span>
        </span>
      ),
      align: "right",
      width: 96,
      render: (r) => {
        const x = r.results[c.id];
        if (!x || x.status === "INCOMPLETE") return <span className="text-small text-ink-muted">{r.marks[c.id]?.mid != null ? "Mid done" : "—"}</span>;
        return (
          <span className={x.points === 0 ? "font-semibold text-danger-ink" : "font-semibold"} title={x.status === "SHORT_ATTENDANCE" ? "Short attendance" : `${x.percent}% · ${x.points?.toFixed(1)} points`}>
            {x.grade}
            {x.status === "SHORT_ATTENDANCE" ? "*" : ""}
          </span>
        );
      },
    })),
    { key: "mid", header: "Mid %", align: "right", width: 80, render: (r) => (r.midPercent === null ? "—" : `${r.midPercent}%`) },
    { key: "gpa", header: "GPA", align: "right", width: 70, render: (r) => <span className="mtb-num font-semibold">{gpaText(r.gpa)}</span> },
    { key: "cgpa", header: "CGPA", align: "right", width: 70, render: (r) => <span className="mtb-num">{gpaText(r.cgpa)}</span> },
    { key: "cr", header: "Credits", align: "right", width: 90, render: (r) => `${r.creditsEarned}` },
    {
      key: "standing",
      header: "Standing",
      width: 120,
      render: (r) =>
        r.standing === "PROBATION" ? (
          <StatusBadge status="danger" dot={false}>
            Probation
          </StatusBadge>
        ) : r.standing === "GOOD" ? (
          <StatusBadge status="success" dot={false}>
            Good
          </StatusBadge>
        ) : (
          <span className="text-small text-ink-muted">Pending</span>
        ),
    },
  ];
  return (
    <div className="grid gap-2">
      <DataTable caption={`${sem.programmeShort} ${sem.label} results`} columns={columns} rows={sem.rows} density="dense" maxHeight={560} />
      <p className="m-0 text-small text-ink-muted">* Short attendance (below {EXAMS_UNI_MIN_ATTENDANCE}%). Course grades appear once the final paper is marked; the mid-semester % shows progress before that. Credits are earned credits so far in the programme.</p>
    </div>
  );
}

// ------------------------------------------------------------------ Master sheets and award list

type SheetKind = NonNullable<UniversitySearch["sheet"]>;
const SHEET_OPTIONS: Array<{ value: SheetKind; label: string }> = [
  { value: "mid", label: "Mid-semester sheet" },
  { value: "final", label: "Final sheet" },
  { value: "course", label: "Course sheet" },
  { value: "award", label: "Award list" },
];

const partText = (v: ExamsUniPart | undefined) => (v === null || v === undefined ? "" : String(v));
const num = (v: ExamsUniPart | undefined) => (typeof v === "number" ? v : 0);

/** Blank award (script marking) list for one course, for the teacher to fill in while marking. */
function UniAwardList({ sem, courseId, onChange }: { sem: ExamsUniSemester; courseId: string | undefined; onChange: (next: { sheet?: SheetKind; course?: string }) => void }) {
  const course = sem.courses.find((c) => c.id === courseId) ?? sem.courses[0]!;
  // Mid and final marks, or one paper split into subjective and objective parts (the old term/semester list).
  const [split, setSplit] = useState(false);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Segmented aria-label="Sheet" value="award" onChange={(v) => onChange({ sheet: v as SheetKind })} options={SHEET_OPTIONS} />
        <div className="w-80">
          <Select label="Course" value={course.id} onChange={(e) => onChange({ sheet: "award", course: e.target.value })} options={sem.courses.map((c) => ({ value: c.id, label: `${c.code} ${c.title}` }))} />
        </div>
        <Segmented
          aria-label="Columns"
          value={split ? "split" : "marks"}
          onChange={(v) => setSplit(v === "split")}
          options={[
            { value: "marks", label: "Mid and final" },
            { value: "split", label: "Subjective, objective, total" },
          ]}
        />
        <Button variant="primary" icon="printer" onClick={printNow}>
          Print award list
        </Button>
      </div>
      <PrintSheet paper="A4" label="Award list preview">
        <article className="exams-doc exams-doc-a4" aria-label="Award list">
          <DocHead campus={sem.campus} title="Award list (script marking list)" sub={`${sem.programmeShort} · ${sem.label}`} />
          <dl className="exams-doc-info">
            <div>
              <dt>Course</dt>
              <dd>
                {course.code} {course.title}
              </dd>
            </div>
            <div>
              <dt>Teacher</dt>
              <dd>{course.teacher}</dd>
            </div>
            <div>
              <dt>Credit hours</dt>
              <dd>{course.creditHours}</dd>
            </div>
            <div>
              <dt>Supervisor</dt>
              <dd>{course.supervisor ?? "—"}</dd>
            </div>
            <div>
              <dt>Students</dt>
              <dd>{sem.rows.length}</dd>
            </div>
          </dl>
          <table>
            <thead>
              <tr>
                <th>Reg. no.</th>
                <th>Student</th>
                <th>Father's name</th>
                <th style={{ width: "22mm" }}>Sign.</th>
                {split ? (
                  <>
                    <th className="c">Subjective</th>
                    <th className="c">Objective</th>
                    <th className="c">Total</th>
                  </>
                ) : (
                  <>
                    <th className="c">Mid /{course.midMax}</th>
                    <th className="c">Final /{course.finalMax}</th>
                    <th className="c">Attendance %</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {sem.rows.map((r) => (
                <tr key={r.id}>
                  <td className="mtb-mono">{r.id}</td>
                  <td>{r.name}</td>
                  <td>{r.father}</td>
                  <td />
                  <td />
                  <td />
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
          <div className="exams-doc-summary" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            {["Present", "Absent", "Blank sheets", "Answer sheets"].map((t) => (
              <div key={t}>
                <span>{t}</span>
                <b>&nbsp;</b>
              </div>
            ))}
          </div>
          <p className="exams-doc-key">Write A for absent and L for leave. Printed {PRINTED_ON}.</p>
          <div className="exams-doc-signs" style={{ gridTemplateColumns: "repeat(4, 1fr)", gap: "6mm" }}>
            <div>
              {course.supervisor && <b style={{ display: "block", color: "var(--ink)" }}>{course.supervisor}</b>}
              Invigilator
            </div>
            <div>Checker</div>
            <div>Rechecker</div>
            <div>Head of department</div>
          </div>
        </article>
      </PrintSheet>
    </div>
  );
}

/** One course's master sheet: internal assessment by component, mid, internal total, final and attendance. */
function UniCourseSheet({ sem, courseId, onChange }: { sem: ExamsUniSemester; courseId: string | undefined; onChange: (next: { sheet?: SheetKind; course?: string }) => void }) {
  const course = sem.courses.find((c) => c.id === courseId) ?? sem.courses[0]!;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Segmented aria-label="Sheet" value="course" onChange={(v) => onChange({ sheet: v as SheetKind })} options={SHEET_OPTIONS} />
        <div className="w-80">
          <Select label="Course" value={course.id} onChange={(e) => onChange({ sheet: "course", course: e.target.value })} options={sem.courses.map((c) => ({ value: c.id, label: `${c.code} ${c.title}` }))} />
        </div>
        <Button variant="primary" icon="printer" onClick={printNow}>
          Print course sheet
        </Button>
      </div>
      <PrintSheet paper="A4L" label="Course master sheet preview">
        <article className="exams-doc exams-doc-land" aria-label="Course master sheet">
          <DocHead campus={sem.campus} title={`${sem.programmeShort} master sheet`} sub={`${course.code} ${course.title}`} />
          <dl className="exams-doc-info">
            <div>
              <dt>Session</dt>
              <dd>{formatSession(sem.session)}</dd>
            </div>
            <div>
              <dt>Subject</dt>
              <dd>{course.title}</dd>
            </div>
            <div>
              <dt>Instructor</dt>
              <dd>{course.teacher}</dd>
            </div>
            <div>
              <dt>Semester</dt>
              <dd>{ordinal(sem.number)}</dd>
            </div>
            <div>
              <dt>Course code</dt>
              <dd>
                {course.code} · {course.creditHours} credit hours
              </dd>
            </div>
            <div>
              <dt>Exam supervisor</dt>
              <dd>{course.supervisor ?? "—"}</dd>
            </div>
          </dl>
          <table>
            <thead>
              <tr>
                <th rowSpan={2} className="n">
                  Sr.
                </th>
                <th rowSpan={2}>Reg. no.</th>
                <th rowSpan={2}>Name</th>
                <th colSpan={course.components.length + 2} className="c">
                  Marks of internal assessment
                </th>
                <th rowSpan={2} className="n">
                  Final
                </th>
                <th rowSpan={2} className="n">
                  Attendance %
                </th>
              </tr>
              <tr>
                {course.components.map((x) => (
                  <th key={x.typeId} className="n">
                    {x.label}
                  </th>
                ))}
                <th className="n">Mid semester</th>
                <th className="n">Total</th>
              </tr>
              <tr>
                <th colSpan={3} className="n">
                  Max. marks
                </th>
                {course.components.map((x) => (
                  <th key={x.typeId} className="n">
                    {x.max}
                  </th>
                ))}
                <th className="n">{course.midMax}</th>
                <th className="n">{course.sessionalMax + course.midMax}</th>
                <th className="n">{course.finalMax}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sem.rows.map((r, i) => {
                const m = r.marks[course.id];
                const ia = course.components.reduce((a, x) => a + num(m?.parts?.[x.typeId]), 0) + num(m?.mid);
                return (
                  <tr key={r.id}>
                    <td className="n">{i + 1}</td>
                    <td className="mtb-mono">{r.id}</td>
                    <td>{r.name}</td>
                    {course.components.map((x) => (
                      <td key={x.typeId} className="n">
                        {partText(m?.parts?.[x.typeId])}
                      </td>
                    ))}
                    <td className="n">{partText(m?.mid)}</td>
                    <td className="n">{m ? ia : ""}</td>
                    <td className="n">{partText(m?.final)}</td>
                    <td className={m?.attendance != null && m.attendance < EXAMS_UNI_MIN_ATTENDANCE ? "n fail" : "n"}>{m?.attendance ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="exams-doc-key">
            A = absent, L = leave (both count as 0). Attendance below {EXAMS_UNI_MIN_ATTENDANCE}% (in red) makes the course an F. Printed {PRINTED_ON}.
          </p>
          <div className="exams-doc-signs" style={{ marginTop: "10mm" }}>
            <div>Course teacher</div>
            <div />
            <div>Controller of examinations</div>
          </div>
        </article>
      </PrintSheet>
    </div>
  );
}

interface MidCell {
  s: number;
  sMax: number;
  m: ExamsUniPart | undefined;
  mMax: number;
  total: number;
  max: number;
  complete: boolean;
}

/** Mid-semester figures for one course under an assessment filter (one type, or everything) and a date range. */
function midCell(c: ExamsUniCourse, mark: ExamsUniMark | undefined, assess: string, from: IsoDate | null, to: IsoDate | null): MidCell {
  const inRange = (d: IsoDate | undefined) => (!from && !to) || (d !== undefined && (!from || d >= from) && (!to || d <= to));
  const comps = c.components.filter((x) => (assess === "ALL" || assess === x.typeId) && inRange(x.date));
  const useMid = (assess === "ALL" || assess === MID) && inRange(c.midDate);
  const legacy = !c.components.length && assess === "ALL";
  const s = legacy ? (mark?.sessional ?? 0) : comps.reduce((a, x) => a + num(mark?.parts?.[x.typeId]), 0);
  const sMax = legacy ? c.sessionalMax : comps.reduce((a, x) => a + x.max, 0);
  const m = useMid ? mark?.mid : undefined;
  const mMax = useMid ? c.midMax : 0;
  const complete = Boolean(mark) && (legacy ? mark!.sessional !== null : comps.every((x) => (mark!.parts?.[x.typeId] ?? null) !== null)) && (!useMid || (mark!.mid ?? null) !== null);
  return { s, sMax, m, mMax, total: s + num(m), max: sMax + mMax, complete };
}

function UniSheet({ sem, variant, onVariant }: { sem: ExamsUniSemester; variant: "mid" | "final"; onVariant: (v: SheetKind) => void }) {
  const [assess, setAssess] = useState("ALL");
  const [from, setFrom] = useState<IsoDate | null>(null);
  const [to, setTo] = useState<IsoDate | null>(null);
  const types = [...new Map(sem.courses.flatMap((c) => c.components.map((x) => [x.typeId, x.label] as const))).entries()];
  const filtered = assess !== "ALL" || from !== null || to !== null;
  // Per student and course, under the filter; totals, % and dense positions over the filtered marks.
  const lines = sem.rows.map((r) => {
    const cells = sem.courses.map((c) => midCell(c, r.marks[c.id], assess, from, to));
    const obtained = cells.reduce((a, x) => a + x.total, 0);
    const max = cells.reduce((a, x) => a + x.max, 0);
    const complete = cells.every((x) => x.complete);
    const pct = complete && max ? Math.round((obtained / max) * 10000) / 100 : null;
    const below = sem.courses.filter((_c, i) => cells[i]!.complete && cells[i]!.max > 0 && cells[i]!.total < examsPassMark(cells[i]!.max, EXAMS_DEFAULT_PASS_RULES)).map((c) => c.title);
    return { r, cells, obtained, max, pct, below };
  });
  const ranked = [...lines.filter((l) => l.pct !== null)].sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
  const pos = new Map<string, number>();
  let rank = 0;
  let last: number | null = null;
  for (const l of ranked) {
    if (l.pct !== last) {
      rank++;
      last = l.pct;
    }
    pos.set(l.r.id, rank);
  }
  const showSM = assess === "ALL";
  const assessLabel = assess === "ALL" ? "Every assessment" : assess === MID ? "Mid semester" : (types.find(([id]) => id === assess)?.[1] ?? assess);
  const avg = (i: number) => {
    const vals = lines.map((l) => l.cells[i]!).filter((x) => x.complete);
    if (!vals.length) return { a: "", p: "" };
    const a = vals.reduce((s, x) => s + x.total, 0) / vals.length;
    const mx = vals[0]!.max;
    return { a: a.toFixed(1), p: mx ? `${Math.round((a / mx) * 100)}` : "" };
  };
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Segmented aria-label="Sheet" value={variant} onChange={(v) => onVariant(v as SheetKind)} options={SHEET_OPTIONS} />
        {variant === "mid" && (
          <>
            <div className="w-48">
              <Select label="Assessment" value={assess} onChange={(e) => setAssess(e.target.value)} options={[{ value: "ALL", label: "Every assessment" }, ...types.map(([id, label]) => ({ value: id, label })), { value: MID, label: "Mid semester" }]} />
            </div>
            <div className="w-44">
              <DatePicker label="From" value={from} onValueChange={setFrom} today={EXAMS_TODAY} />
            </div>
            <div className="w-44">
              <DatePicker label="To" value={to} onValueChange={setTo} today={EXAMS_TODAY} {...(from ? { minDate: from } : {})} />
            </div>
          </>
        )}
        <Button variant="primary" icon="printer" onClick={printNow}>
          Print master sheet
        </Button>
      </div>
      {variant === "final" && sem.missing > 0 && <Banner tone="warning">Final papers aren't all marked yet: open results print blank.</Banner>}
      <PrintSheet paper="A4L" label="University master sheet preview">
        <article className="exams-doc exams-doc-land" aria-label="University master sheet">
          <DocHead
            campus={sem.campus}
            title={variant === "mid" ? "Mid-semester master sheet" : "Master sheet"}
            sub={`${sem.programmeShort} · ${sem.label}${variant === "mid" && filtered ? ` · ${assessLabel}${from || to ? ` · ${from ? formatDate(from) : "start"} to ${to ? formatDate(to) : "now"}` : ""}` : ""}`}
          />
          {variant === "mid" ? (
            <table>
              <thead>
                <tr>
                  <th rowSpan={2} className="n">
                    Sr.
                  </th>
                  <th rowSpan={2}>Reg. no.</th>
                  <th rowSpan={2}>Student</th>
                  {sem.courses.map((c) => (
                    <th key={c.id} colSpan={showSM ? 3 : 1} className="c">
                      {c.code}
                    </th>
                  ))}
                  <th rowSpan={2} className="n">
                    Obt.
                  </th>
                  <th rowSpan={2} className="n">
                    %
                  </th>
                  <th rowSpan={2} className="c">
                    Grd
                  </th>
                  <th rowSpan={2} className="n">
                    Pos.
                  </th>
                  <th rowSpan={2}>Contact</th>
                  <th rowSpan={2}>Remarks</th>
                </tr>
                <tr>
                  {sem.courses.flatMap((c) =>
                    showSM
                      ? [
                          <th key={`${c.id}s`} className="n">
                            S
                          </th>,
                          <th key={`${c.id}m`} className="n">
                            M
                          </th>,
                          <th key={`${c.id}t`} className="n">
                            Tot.
                          </th>,
                        ]
                      : [
                          <th key={`${c.id}x`} className="n">
                            {assess === MID ? "M" : "Obt."}
                          </th>,
                        ],
                  )}
                </tr>
                <tr>
                  <th colSpan={3} className="n">
                    Max. marks
                  </th>
                  {sem.courses.flatMap((c, i) => {
                    const x = lines[0]?.cells[i] ?? midCell(c, undefined, assess, from, to);
                    return showSM
                      ? [
                          <th key={`${c.id}s`} className="n">
                            {x.sMax}
                          </th>,
                          <th key={`${c.id}m`} className="n">
                            {x.mMax}
                          </th>,
                          <th key={`${c.id}t`} className="n">
                            {x.max}
                          </th>,
                        ]
                      : [
                          <th key={`${c.id}x`} className="n">
                            {x.max}
                          </th>,
                        ];
                  })}
                  <th className="n">{lines[0]?.max ?? ""}</th>
                  <th colSpan={5} />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.r.id}>
                    <td className="n">{i + 1}</td>
                    <td className="mtb-mono">{l.r.id}</td>
                    <td>{l.r.name}</td>
                    {l.cells.flatMap((x, ci) => {
                      const c = sem.courses[ci]!;
                      return showSM
                        ? [
                            <td key={`${c.id}s`} className="n">
                              {l.r.marks[c.id] ? x.s : ""}
                            </td>,
                            <td key={`${c.id}m`} className="n">
                              {partText(x.m)}
                            </td>,
                            <td key={`${c.id}t`} className={x.complete && x.max && x.total < examsPassMark(x.max, EXAMS_DEFAULT_PASS_RULES) ? "n fail" : "n"}>
                              {x.complete ? x.total : ""}
                            </td>,
                          ]
                        : [
                            <td key={`${c.id}x`} className="n">
                              {assess === MID ? partText(x.m) : x.complete ? x.total : ""}
                            </td>,
                          ];
                    })}
                    <td className="n">{l.obtained}</td>
                    <td className="n">{l.pct === null ? "" : `${l.pct.toFixed(2)}`}</td>
                    <td className="c">{l.pct === null ? "" : examsGradeFor(l.pct, EXAMS_DEFAULT_SCALE)}</td>
                    <td className="n">{pos.get(l.r.id) ? ordinal(pos.get(l.r.id)!) : ""}</td>
                    <td className="mtb-mono">{l.r.guardianMobile ?? ""}</td>
                    <td style={{ fontSize: "7.5pt" }}>{l.below.join(", ")}</td>
                  </tr>
                ))}
                <tr>
                  <th colSpan={3} className="n">
                    Average
                  </th>
                  {sem.courses.flatMap((c, i) => {
                    const a = avg(i);
                    return showSM
                      ? [<th key={`${c.id}s`} />, <th key={`${c.id}m`} />, <th key={`${c.id}t`} className="n">{a.a}</th>]
                      : [<th key={`${c.id}x`} className="n">{a.a}</th>];
                  })}
                  <th colSpan={6} />
                </tr>
                <tr>
                  <th colSpan={3} className="n">
                    Average %
                  </th>
                  {sem.courses.flatMap((c, i) => {
                    const a = avg(i);
                    return showSM
                      ? [<th key={`${c.id}s`} />, <th key={`${c.id}m`} />, <th key={`${c.id}t`} className="n">{a.p}</th>]
                      : [<th key={`${c.id}x`} className="n">{a.p}</th>];
                  })}
                  <th colSpan={6} />
                </tr>
              </tbody>
            </table>
          ) : (
            <table>
              <thead>
                <tr>
                  <th rowSpan={2}>Reg. no.</th>
                  <th rowSpan={2}>Student</th>
                  {sem.courses.map((c) => (
                    <th key={c.id} colSpan={3} className="c">
                      {c.code} ({c.creditHours})
                    </th>
                  ))}
                  <th rowSpan={2} className="n">
                    GPA
                  </th>
                  <th rowSpan={2} className="n">
                    CGPA
                  </th>
                </tr>
                <tr>
                  {sem.courses.flatMap((c) => [
                    <th key={`${c.id}t`} className="n">
                      /{c.sessionalMax + c.midMax + c.finalMax}
                    </th>,
                    <th key={`${c.id}g`} className="c">
                      Gr.
                    </th>,
                    <th key={`${c.id}p`} className="n">
                      Pts
                    </th>,
                  ])}
                </tr>
              </thead>
              <tbody>
                {sem.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="mtb-mono">{r.id}</td>
                    <td>{r.name}</td>
                    {sem.courses.flatMap((c) => {
                      const x = r.results[c.id];
                      return [
                        <td key={`${c.id}t`} className="n">
                          {x?.total ?? ""}
                        </td>,
                        <td key={`${c.id}g`} className={x?.points === 0 ? "c fail" : "c"}>
                          {x?.grade ?? ""}
                        </td>,
                        <td key={`${c.id}p`} className="n">
                          {x?.points != null ? x.points.toFixed(1) : ""}
                        </td>,
                      ];
                    })}
                    <td className="n">{r.gpa !== null ? r.gpa.toFixed(2) : ""}</td>
                    <td className="n">{r.cgpa !== null ? r.cgpa.toFixed(2) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="exams-doc-key">
            {variant === "mid"
              ? `S = internal assessment (${[...new Set(sem.courses.flatMap((c) => c.components.map((x) => x.label)))].join(", ")}), M = mid-semester paper, Tot. = S + M; A = absent, L = leave. Grade on the school scale; equal percentages share a position. Remarks list courses below the pass mark (${EXAMS_DEFAULT_PASS_RULES.subjectPassPercent}%).`
              : `Grade points on a 4.0 scale; attendance below ${EXAMS_UNI_MIN_ATTENDANCE}% is an F.`}{" "}
            Printed {PRINTED_ON}.
          </p>
          <div className="exams-doc-signs" style={{ marginTop: "10mm" }}>
            <div>{variant === "mid" ? "Class in-charge" : "Prepared by"}</div>
            <div>Controller of examinations</div>
            <div>Principal</div>
          </div>
        </article>
      </PrintSheet>
    </div>
  );
}

// ------------------------------------------------------------------ Transcript and assessment history

function UniTranscript({ sem, studentId, view, onChange }: { sem: ExamsUniSemester; studentId: string; view: "transcript" | "history"; onChange: (next: { student?: string; view?: "transcript" | "history" }) => void }) {
  const ctx = useCtx();
  const t = useQuery(examsQueries.uniTranscript(ctx, studentId));
  const [types, setTypes] = useState<string[] | null>(null);
  const [semesterId, setSemesterId] = useState("ALL");
  const [from, setFrom] = useState<IsoDate | null>(null);
  const [to, setTo] = useState<IsoDate | null>(null);
  const allTypes = [...new Map((t.data?.assessments ?? []).map((a) => [a.typeId, a.examType] as const)).entries()];
  const picked = types ?? allTypes.map(([id]) => id);
  const history = (t.data?.assessments ?? []).filter((a) => picked.includes(a.typeId) && (semesterId === "ALL" || a.semesterId === semesterId) && (!from || (a.date ?? "") >= from) && (!to || (a.date ?? "9999") <= to));
  const counts = { tests: history.length, absents: history.filter((a) => a.obtained === "A").length, leaves: history.filter((a) => a.obtained === "L").length };
  const inStudent = sem.rows.some((r) => r.id === studentId);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-80">
          <Select label="Student" value={studentId} onChange={(e) => onChange({ student: e.target.value })} options={[...(inStudent ? [] : [{ value: studentId, label: studentId }]), ...sem.rows.map((r) => ({ value: r.id, label: `${r.name} · ${r.id}` }))]} />
        </div>
        <Segmented aria-label="Show" value={view} onChange={(v) => onChange({ view: v as "transcript" | "history" })} options={[{ value: "transcript", label: "Transcript" }, { value: "history", label: "Assessment history" }]} />
        <Button variant="primary" icon="printer" onClick={printNow} disabled={!t.data}>
          Print {view === "history" ? "history" : "transcript"}
        </Button>
      </div>
      {view === "history" && t.data && (
        <div className="grid gap-3 rounded-md border border-border p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-56">
              <Select label="Semester" value={semesterId} onChange={(e) => setSemesterId(e.target.value)} options={[{ value: "ALL", label: "Every semester" }, ...t.data.semesters.map((s) => ({ value: s.id, label: s.label }))]} />
            </div>
            <div className="w-44">
              <DatePicker label="From" value={from} onValueChange={setFrom} today={EXAMS_TODAY} />
            </div>
            <div className="w-44">
              <DatePicker label="To" value={to} onValueChange={setTo} today={EXAMS_TODAY} {...(from ? { minDate: from } : {})} />
            </div>
          </div>
          <fieldset className="m-0 flex flex-wrap gap-x-5 gap-y-2 border-0 p-0">
            <legend className="mb-1 text-small font-medium">Exam types</legend>
            <Checkbox label="Check all" checked={picked.length === allTypes.length} onChange={(e) => setTypes(e.target.checked ? null : [])} />
            {allTypes.map(([id, name]) => (
              <Checkbox key={id} label={name} checked={picked.includes(id)} onChange={(e) => setTypes(e.target.checked ? [...picked, id] : picked.filter((x) => x !== id))} />
            ))}
          </fieldset>
        </div>
      )}
      {t.isLoading ? (
        <Skeleton height={300} />
      ) : t.isError || !t.data ? (
        <LoadError what="The transcript" error={t.error} onRetry={() => void t.refetch()} />
      ) : view === "history" ? (
        <PrintSheet paper="A4" label="Student history preview">
          <article className="exams-doc exams-doc-a4" aria-label="Student history">
            <DocHead campus={t.data.campus} title="Student history" sub={`${t.data.programmeName}`} />
            <dl className="exams-doc-info">
              <div>
                <dt>Registration no.</dt>
                <dd className="mtb-mono">{t.data.id}</dd>
              </div>
              <div>
                <dt>Name</dt>
                <dd>{t.data.name}</dd>
              </div>
              <div>
                <dt>Father's name</dt>
                <dd>{t.data.father}</dd>
              </div>
              <div>
                <dt>Programme (class)</dt>
                <dd>{t.data.programmeShort}</dd>
              </div>
              <div>
                <dt>Semester</dt>
                <dd>{semesterId === "ALL" ? "Every semester" : (t.data.semesters.find((s) => s.id === semesterId)?.label ?? "")}</dd>
              </div>
              <div>
                <dt>Session</dt>
                <dd>{formatSession(sem.session)}</dd>
              </div>
            </dl>
            <div className="exams-doc-summary" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: "4mm" }}>
              <div>
                <span>No. of tests</span>
                <b>{counts.tests}</b>
              </div>
              <div>
                <span>No. of absents</span>
                <b>{counts.absents}</b>
              </div>
              <div>
                <span>No. of leaves</span>
                <b>{counts.leaves}</b>
              </div>
            </div>
            {history.length === 0 ? (
              <p>No assessments match these filters.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Course</th>
                    <th>Exam</th>
                    <th className="n">Obt.</th>
                    <th className="n">Total</th>
                    <th className="n">%</th>
                    <th className="c">Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((a, i) => (
                    <tr key={`${a.semesterId}-${a.courseCode}-${a.typeId}-${i}`}>
                      <td>{a.date ? formatDate(a.date) : "—"}</td>
                      <td>
                        {a.courseCode} {a.courseTitle}
                      </td>
                      <td>{a.examType}</td>
                      <td className={typeof a.obtained === "number" ? "n" : "n fail"}>{a.obtained}</td>
                      <td className="n">{a.max}</td>
                      <td className="n">{typeof a.obtained === "number" ? `${Math.round(a.percent)}%` : ""}</td>
                      <td className="c">{a.grade ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="exams-doc-key">A = absent, L = leave (counted as 0). Grade on the school scale for each assessment. Printed {PRINTED_ON}.</p>
          </article>
        </PrintSheet>
      ) : (
        <PrintSheet paper="A4" label="Transcript preview">
          <article className="exams-doc exams-doc-a4" aria-label="Transcript">
            <DocHead campus={t.data.campus} title="Transcript" sub={`${t.data.programmeName}`} />
            <dl className="exams-doc-info">
              <div>
                <dt>Student</dt>
                <dd>{t.data.name}</dd>
              </div>
              <div>
                <dt>Father's name</dt>
                <dd>{t.data.father}</dd>
              </div>
              <div>
                <dt>Registration no.</dt>
                <dd className="mtb-mono">{t.data.id}</dd>
              </div>
            </dl>
            {t.data.semesters.map((s) => (
              <section key={s.id} style={{ marginBottom: "4mm", breakInside: "avoid" }}>
                <p style={{ margin: "0 0 1mm", display: "flex", justifyContent: "space-between" }}>
                  <b>{s.label}</b>
                  <span>{s.status === "DECLARED" ? `GPA ${gpaText(s.gpa)} · CGPA ${gpaText(s.cgpa)} · ${s.credits} credit hours` : "In progress — not declared"}</span>
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Course</th>
                      <th className="n">Credit hours</th>
                      <th className="c">Grade</th>
                      <th className="n">Points</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.courses.map((c) => (
                      <tr key={c.code}>
                        <td>{c.code}</td>
                        <td>{c.title}</td>
                        <td className="n">{c.creditHours}</td>
                        <td className={c.points === 0 ? "c fail" : "c"}>{c.grade ?? "—"}</td>
                        <td className="n">{c.points != null ? c.points.toFixed(1) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
            <div className="exams-doc-summary" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
              <div>
                <span>CGPA</span>
                <b>{gpaText(t.data.cgpa)}</b>
              </div>
              <div>
                <span>Credits earned</span>
                <b>{t.data.creditsEarned}</b>
              </div>
              <div>
                <span>Semesters declared</span>
                <b>{t.data.semesters.filter((s) => s.status === "DECLARED").length}</b>
              </div>
            </div>
            <p className="exams-doc-key">Declared semesters only count towards the CGPA. Printed {PRINTED_ON}.</p>
            <div className="exams-doc-signs">
              <div />
              <div>Controller of examinations</div>
              <div>Principal</div>
            </div>
          </article>
        </PrintSheet>
      )}
    </div>
  );
}
