import {
  SETUP_SECTION_NAME_RULE,
  setupApi,
  setupQueries,
  setupSectionLabel,
  setupSectionNameOk,
  type SetupClass,
  type SetupClassInput,
  type SetupClassLevel,
  type SetupClassLevelInput,
  type SetupSection,
  type SetupSectionInput,
  type SetupSectionKind,
  type SetupShift,
} from "@mtb/api";
import { formatCount, formatSession } from "@mtb/domain";
import { Banner, Button, cx, DataTable, EmptyState, Input, Panel, Select, SidePanel, StatCard, StatusBadge, Switch, TabPanel, Tabs, Urdu, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import { apiFieldError, ConflictBanner, conflictOf, EditButton, err, errorText, QueryError, SetupPage, useCanAny, zodErrors, type Conflict, type FieldErrors } from "./shared";

export type ClassesTab = "classes" | "sections" | "levels";

const SHIFT_LABEL: Record<SetupShift, string> = { MORNING: "Morning", EVENING: "Evening" };
const HEAD_OFFICE_ONLY = "Classes and levels are shared by every campus. Only head office can change them.";

/* ------------------------------------------------------------------ Class editor */

const classSchema = z.object({
  name: z.string().trim().min(1, { error: "Enter the class name, e.g. Class 7." }),
  short: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{1,6}$/, { error: "Use 1 to 6 letters or numbers, e.g. 7 or Prep." }),
  levelId: z.string().min(1, { error: "Choose the level this class belongs to." }),
  maxAge: z.number().int().min(3, { error: "Enter an age between 3 and 30, or leave it empty." }).max(30, { error: "Enter an age between 3 and 30, or leave it empty." }).nullable(),
});

function ClassEditor({ cls, onClose }: { cls: SetupClass | null; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const levels = useQuery(setupQueries.levels(ctx)).data ?? [];
  const classes = useQuery(setupQueries.classes(ctx)).data ?? [];
  const [form, setForm] = useState<Omit<SetupClassInput, "rowVer">>(() =>
    cls
      ? { name: cls.name, short: cls.short, nameUrdu: cls.nameUrdu, levelId: cls.levelId, order: cls.order, maxAge: cls.maxAge, shift: cls.shift, active: cls.active }
      : { name: "", short: "", nameUrdu: "", levelId: "", order: classes.length + 1, maxAge: null, shift: "MORNING", active: true },
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };
  const save = useMutation({
    mutationFn: () => setupApi.saveClass({ ...form, ...(cls ? { rowVer: cls.rowVer } : {}) }, cls?.id),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ["setup"] });
      toast({ title: cls ? `${c.name} saved` : `${c.name} added`, message: cls ? "Every campus sees the change." : "Add sections at the campuses that teach it." });
      onClose();
    },
    onError: (e) => {
      const c = conflictOf(e);
      if (c) return setConflict(c);
      const f = apiFieldError(e);
      if (f) return setErrors(f);
      setFailure(errorText(e));
    },
  });
  const submit = () => {
    setFailure(null);
    const r = classSchema.safeParse(form);
    if (!r.success) return setErrors(zodErrors(r.error));
    save.mutate();
  };
  // A level that is not in use can't take new classes, but a class already in it keeps showing it.
  const levelOptions = levels.filter((l) => l.active || l.id === cls?.levelId);
  return (
    <SidePanel
      open
      onClose={onClose}
      title={cls ? `Edit ${cls.name}` : "Add class"}
      description="Classes are shared by every campus. Each campus decides its own sections."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="check" onClick={submit} loading={save.isPending} disabled={Boolean(conflict)}>
            {cls ? "Save class" : "Add class"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {conflict && <ConflictBanner conflict={conflict} onReload={() => void qc.invalidateQueries({ queryKey: ["setup"] }).then(onClose)} />}
        {failure && <Banner tone="danger" title="Not saved.">{failure}</Banner>}
        <Input label="Class name" required value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Class 11" {...err(errors, "name")} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Short name" required value={form.short} onChange={(e) => set("short", e.target.value)} placeholder="11" {...(errors.short ? { error: errors.short } : { help: `Used in section names, e.g. ${form.short || "11"}-A.` })} />
          <Input label="Name in Urdu" urdu value={form.nameUrdu} onChange={(e) => set("nameUrdu", e.target.value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Level" required value={form.levelId} onChange={(e) => set("levelId", e.target.value)} options={[{ value: "", label: "Choose…" }, ...levelOptions.map((l) => ({ value: l.id, label: l.active ? l.name : `${l.name} (not in use)` }))]} {...err(errors, "levelId")} />
          <Select label="Shift" value={form.shift} onChange={(e) => set("shift", e.target.value as SetupShift)} options={[{ value: "MORNING", label: "Morning" }, { value: "EVENING", label: "Evening" }]} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Maximum age at admission"
            inputMode="numeric"
            value={form.maxAge === null ? "" : String(form.maxAge)}
            onChange={(e) => set("maxAge", e.target.value.trim() === "" ? null : Number(e.target.value.replace(/\D/g, "")))}
            {...(errors.maxAge ? { error: errors.maxAge } : { help: "Admissions warns when a child is older. Leave empty for no limit." })}
          />
          <Input label="Display order" inputMode="numeric" value={String(form.order)} onChange={(e) => set("order", Number(e.target.value.replace(/\D/g, "")) || 0)} help="Position in lists and reports." />
        </div>
        <Switch label="In use" checked={form.active} onChange={(e) => set("active", e.target.checked)} />
        {errors.active && <Banner tone="warning">{errors.active}</Banner>}
      </div>
    </SidePanel>
  );
}

/* ------------------------------------------------------------------ Section editor */

const sectionSchema = z.object({
  classId: z.string().min(1, { error: "Choose a class." }),
  name: z.string().refine(setupSectionNameOk, { error: SETUP_SECTION_NAME_RULE }),
  seats: z.number({ error: "Enter the number of seats." }).int().min(1, { error: "Enter the number of seats, from 1 to 200." }).max(200, { error: "Enter the number of seats, from 1 to 200." }),
  room: z.string().trim().max(30, { error: "Keep the room name under 30 characters." }),
});

function SectionEditor({ section, classes, levels, onClose }: { section: SetupSection | null; classes: SetupClass[]; levels: SetupClassLevel[]; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const groups = useQuery(setupQueries.groups(ctx)).data ?? [];
  const [form, setForm] = useState<Omit<SetupSectionInput, "rowVer">>(() =>
    section
      ? { classId: section.classId, name: section.name, kind: section.kind ?? "SECTION", groupId: section.groupId, seats: section.seats, room: section.room, active: section.active }
      : { classId: "", name: "", kind: "SECTION", groupId: null, seats: 40, room: "", active: true },
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const cls = classes.find((c) => c.id === form.classId);
  const degree = Boolean(cls && levels.find((l) => l.id === cls.levelId)?.degree);
  const classGroups = groups.filter((g) => g.active && cls?.groupIds.includes(g.id));
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };
  const name = form.name.trim().replace(/\s+/g, " ");
  const kind: SetupSectionKind = degree ? (form.kind ?? "SECTION") : "SECTION";
  const save = useMutation({
    mutationFn: () => setupApi.saveSection(ctx, { ...form, name, kind, ...(section ? { rowVer: section.rowVer } : {}) }, section?.id),
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: ["setup"] });
      toast({ title: section ? `${s.label} saved` : `${s.label} added`, message: `${s.campusName}, ${formatSession(s.session)}.` });
      onClose();
    },
    onError: (e) => {
      const c = conflictOf(e);
      if (c) return setConflict(c);
      const f = apiFieldError(e);
      if (f) return setErrors(f);
      setFailure(errorText(e));
    },
  });
  const submit = () => {
    setFailure(null);
    const r = sectionSchema.safeParse({ ...form, name });
    const next = r.success ? {} : zodErrors(r.error);
    if (classGroups.length && !form.groupId) next.groupId = `${cls?.name} has groups. Choose the group this section studies.`;
    if (section && form.seats < section.strength) next.seats = `${section.strength} students are already in ${section.label}. Seats can't be fewer than that.`;
    if (Object.keys(next).length) return setErrors(next);
    save.mutate();
  };
  const label = cls ? setupSectionLabel(cls, name || (kind === "BATCH" ? "Batch …" : "?")) : "New section";
  const noun = kind === "BATCH" ? "batch" : "section";
  return (
    <SidePanel
      open
      onClose={onClose}
      title={section ? `Edit ${section.label}` : "Add section"}
      description={`${campusLabel(ctx.campus)} · ${formatSession(ctx.session)}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="check" onClick={submit} loading={save.isPending} disabled={Boolean(conflict)}>
            {section ? `Save ${noun}` : `Add ${noun}`}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {conflict && <ConflictBanner conflict={conflict} onReload={() => void qc.invalidateQueries({ queryKey: ["setup"] }).then(onClose)} />}
        {failure && <Banner tone="danger" title="Not saved.">{failure}</Banner>}
        <Select
          label="Class"
          required
          value={form.classId}
          disabled={Boolean(section)}
          onChange={(e) => set("classId", e.target.value)}
          options={[{ value: "", label: "Choose…" }, ...classes.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }))]}
          {...err(errors, "classId")}
        />
        {degree && (
          <Select
            label="Kind"
            value={kind}
            onChange={(e) => set("kind", e.target.value as SetupSectionKind)}
            options={[
              { value: "BATCH", label: "Batch (one intake of the programme)" },
              { value: "SECTION", label: "Section" },
            ]}
            {...(errors.kind ? { error: errors.kind } : { help: "Degree programmes usually run one batch a year, e.g. Batch 2026." })}
          />
        )}
        <Input
          label={kind === "BATCH" ? "Batch name" : "Section name"}
          required
          maxLength={40}
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder={kind === "BATCH" ? "Batch 2026" : "D or Khadija"}
          {...(errors.name ? { error: errors.name } : { help: <>Shows as <b className="text-ink">{label}</b>. A letter, a word or a batch name; up to 40 characters.</> })}
        />
        {classGroups.length > 0 && <Select label="Group" required value={form.groupId ?? ""} onChange={(e) => set("groupId", e.target.value || null)} options={[{ value: "", label: "Choose…" }, ...classGroups.map((g) => ({ value: g.id, label: g.name }))]} {...err(errors, "groupId")} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Seats" required inputMode="numeric" value={String(form.seats || "")} onChange={(e) => set("seats", Number(e.target.value.replace(/\D/g, "")) || 0)} {...(errors.seats ? { error: errors.seats } : { help: section ? `${section.strength} students now.` : "Admissions stops at this number." })} />
          <Input label="Room" value={form.room} onChange={(e) => set("room", e.target.value)} placeholder="Room 12" {...err(errors, "room")} />
        </div>
        <Switch label="Open for this session" checked={form.active} onChange={(e) => set("active", e.target.checked)} />
        {errors.active && <Banner tone="warning">{errors.active}</Banner>}
      </div>
    </SidePanel>
  );
}

/* ------------------------------------------------------------------ Level editor */

const levelSchema = z.object({
  name: z.string().trim().min(1, { error: "Enter the level name, e.g. Intermediate." }).max(40, { error: "Keep the level name to 40 characters." }),
  order: z.number().int().min(1, { error: "Enter a display order from 1 to 99." }).max(99, { error: "Enter a display order from 1 to 99." }),
});

function LevelEditor({ level, count, onClose }: { level: SetupClassLevel | null; count: number; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<Omit<SetupClassLevelInput, "rowVer">>(() => (level ? { name: level.name, order: level.order, active: level.active, degree: level.degree } : { name: "", order: count + 1, active: true, degree: false }));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };
  const save = useMutation({
    mutationFn: () => setupApi.saveLevel({ ...form, name: form.name.trim(), ...(level ? { rowVer: level.rowVer } : {}) }, level?.id),
    onSuccess: (l) => {
      void qc.invalidateQueries({ queryKey: ["setup"] });
      toast({ title: level ? `${l.name} saved` : `${l.name} added`, message: level ? "Every campus sees the change." : "Choose it for a class under Classes." });
      onClose();
    },
    onError: (e) => {
      const c = conflictOf(e);
      if (c) return setConflict(c);
      const f = apiFieldError(e);
      if (f) return setErrors(f);
      setFailure(errorText(e));
    },
  });
  const submit = () => {
    setFailure(null);
    const r = levelSchema.safeParse(form);
    if (!r.success) return setErrors(zodErrors(r.error));
    if (level && level.active && !form.active && level.classCount > 0) {
      return setErrors({ active: `${level.classCount} class${level.classCount === 1 ? " is" : "es are"} still in ${level.name}. Move ${level.classCount === 1 ? "it" : "them"} to another level or switch ${level.classCount === 1 ? "it" : "them"} off first.` });
    }
    save.mutate();
  };
  return (
    <SidePanel
      open
      onClose={onClose}
      title={level ? `Edit ${level.name}` : "Add level"}
      description="Levels group classes on reports and dashboards, for every campus."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="check" onClick={submit} loading={save.isPending} disabled={Boolean(conflict)}>
            {level ? "Save level" : "Add level"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {conflict && <ConflictBanner conflict={conflict} onReload={() => void qc.invalidateQueries({ queryKey: ["setup"] }).then(onClose)} />}
        {failure && <Banner tone="danger" title="Not saved.">{failure}</Banner>}
        <Input label="Level name" required maxLength={40} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Intermediate" {...err(errors, "name")} />
        <Input label="Display order" required inputMode="numeric" value={String(form.order || "")} onChange={(e) => set("order", Number(e.target.value.replace(/\D/g, "")) || 0)} {...(errors.order ? { error: errors.order } : { help: "Position in lists and reports." })} />
        <div className="grid gap-1">
          <Switch label="Degree programmes" checked={Boolean(form.degree)} onChange={(e) => set("degree", e.target.checked)} />
          <span className="text-small text-ink-muted">Class subjects get credit hours, and sections can be batches.</span>
        </div>
        <Switch label="In use" checked={form.active} onChange={(e) => set("active", e.target.checked)} />
        {errors.active && <Banner tone="warning">{errors.active}</Banner>}
      </div>
    </SidePanel>
  );
}

/* ------------------------------------------------------------------ Tabs */

function ClassesTable({ onEdit }: { onEdit: (c: SetupClass | null) => void }) {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const canManage = useCan("setup.manage");
  const q = useQuery(setupQueries.classes(ctx));
  const groups = useQuery(setupQueries.groups(ctx)).data ?? [];
  const levels = useQuery(setupQueries.levels(ctx)).data ?? [];
  const [level, setLevel] = useState("");
  const rows = (q.data ?? []).filter((c) => !level || c.levelId === level);
  return (
    <div className="grid gap-4">
      {q.isError && <QueryError what="The classes" error={q.error} onRetry={() => void q.refetch()} />}
      <DataTable
        rows={rows}
        loading={q.isLoading}
        caption="Classes"
        {...(readOnly || !canManage ? {} : { onRowClick: (c: SetupClass) => onEdit(c) })}
        toolbar={
          <>
            <div className="w-56">
              <Select aria-label="Level" value={level} onChange={(e) => setLevel(e.target.value)} options={[{ value: "", label: "All levels" }, ...levels.map((l) => ({ value: l.id, label: l.name }))]} />
            </div>
            <EditButton size="sm" variant="primary" icon="plus" onClick={() => onEdit(null)} reason={canManage ? null : HEAD_OFFICE_ONLY}>
              Add class
            </EditButton>
          </>
        }
        empty={<EmptyState icon="layers" title="No classes at this level" description="Choose another level, or add a class." />}
        columns={[
          { key: "order", header: "#", width: 48, render: (c) => <span className="tabular-nums text-ink-muted">{c.order}</span> },
          {
            key: "name",
            header: "Class",
            render: (c) => (
              <span className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-medium">{c.name}</span>
                {c.nameUrdu && <Urdu size="small" className="text-ink-muted">{c.nameUrdu}</Urdu>}
              </span>
            ),
          },
          { key: "levelName", header: "Level" },
          { key: "shift", header: "Shift", render: (c) => SHIFT_LABEL[c.shift] },
          { key: "groups", header: "Groups", render: (c) => (c.groupIds.length ? <span className="text-small">{c.groupIds.map((g) => groups.find((x) => x.id === g)?.name ?? g).join(", ")}</span> : <span className="text-ink-subtle">—</span>) },
          { key: "maxAge", header: "Max age", align: "right", render: (c) => (c.maxAge === null ? "—" : `${c.maxAge} yrs`) },
          { key: "sections", header: `Sections ${ctx.campus === "ALL" ? "(all campuses)" : "here"}`, align: "right", render: (c) => formatCount(c.sectionCount) },
          { key: "active", header: "Status", render: (c) => (c.active ? <StatusBadge status="success">In use</StatusBadge> : <StatusBadge status="neutral">Off</StatusBadge>) },
        ]}
      />
      <p className="m-0 text-small text-ink-muted">
        One list for every campus. The old software had different class lists at each campus, with test and dummy classes mixed in.{!canManage && " Only head office can change it."}
      </p>
    </div>
  );
}

function SectionsTable({ onEdit }: { onEdit: (s: SetupSection | null) => void }) {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  // Head office, or the principal at their own campus (campus-level setup).
  const canEdit = useCanAny(["setup.manage", "setup.campus"]);
  const q = useQuery(setupQueries.sections(ctx));
  const classes = useQuery(setupQueries.classes(ctx)).data ?? [];
  const [classId, setClassId] = useState("");
  const [search, setSearch] = useState("");
  const all = q.data ?? [];
  const rows = all.filter((s) => (!classId || s.classId === classId) && (!search.trim() || `${s.label} ${s.room} ${s.classTeacherName ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())));
  const seats = all.filter((s) => s.active).reduce((a, s) => a + s.seats, 0);
  const students = all.filter((s) => s.active).reduce((a, s) => a + s.strength, 0);
  const full = all.filter((s) => s.active && s.strength >= s.seats).length;
  const single = ctx.campus !== "ALL";
  return (
    <div className="grid gap-4">
      {q.isError && <QueryError what="The sections" error={q.error} onRetry={() => void q.refetch()} />}
      <div className="setup-stats">
        <StatCard label="Sections" icon="layers" loading={q.isLoading} value={formatCount(all.filter((s) => s.active).length)} foot={`${campusLabel(ctx.campus)} · ${formatSession(ctx.session)}`} />
        <StatCard label="Students" icon="students" loading={q.isLoading} value={formatCount(students)} foot={`in ${formatCount(seats)} seats`} />
        <StatCard
          label="Seats filled"
          icon="trendUp"
          loading={q.isLoading}
          value={`${seats ? Math.round((students / seats) * 100) : 0}%`}
          meter={seats ? (students / seats) * 100 : 0}
          meterLabel="Seats filled"
          foot={full ? `${full} section${full === 1 ? " is" : "s are"} full` : "No section is full"}
          {...(full ? { tone: "warning" as const } : {})}
        />
      </div>
      <DataTable
        rows={rows}
        loading={q.isLoading}
        caption="Sections"
        {...(readOnly || !single || !canEdit ? {} : { onRowClick: (s: SetupSection) => onEdit(s) })}
        toolbar={
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="w-56">
                <Input aria-label="Search sections" icon="search" placeholder="Section, room or teacher" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="w-44">
                <Select aria-label="Class" value={classId} onChange={(e) => setClassId(e.target.value)} options={[{ value: "", label: "All classes" }, ...classes.map((c) => ({ value: c.id, label: c.name }))]} />
              </div>
            </div>
            <EditButton size="sm" variant="primary" icon="plus" onClick={() => onEdit(null)} reason={!canEdit ? "Your role can't add sections at this campus." : single ? null : "Choose one campus in the campus switcher to add a section."}>
              Add section
            </EditButton>
          </>
        }
        empty={<EmptyState icon="layers" title={all.length ? "No sections match" : "No sections in this session yet"} description={all.length ? "Clear the search or choose another class." : "Create the session with sections copied, or add them one by one."} />}
        columns={[
          {
            key: "label",
            header: "Section",
            render: (s) => (
              <span className="grid">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{s.label}</span>
                  {s.kind === "BATCH" && (
                    <StatusBadge status="brand" dot={false}>
                      Batch
                    </StatusBadge>
                  )}
                </span>
                {s.groupName && <span className="mtb-cell-secondary">{s.groupName}</span>}
              </span>
            ),
          },
          ...(single ? [] : [{ key: "campus", header: "Campus", render: (s: SetupSection) => s.campusName }]),
          { key: "room", header: "Room", render: (s) => s.room || <span className="text-ink-subtle">—</span> },
          { key: "teacher", header: "Class teacher", render: (s) => s.classTeacherName ?? <StatusBadge status="warning">Not assigned</StatusBadge> },
          {
            key: "fill",
            header: "Students / seats",
            width: 220,
            render: (s) => {
              const pct = s.seats ? Math.min(100, (s.strength / s.seats) * 100) : 0;
              return (
                <span className="setup-bar">
                  <span className={cx("mtb-meter", pct >= 100 ? "tone-danger" : pct >= 92 && "tone-warning")} role="img" aria-label={`${s.strength} of ${s.seats} seats filled`}>
                    <span style={{ width: `${pct}%` }} />
                  </span>
                  <span className="text-small tabular-nums">
                    {s.strength}/{s.seats}
                  </span>
                </span>
              );
            },
          },
          { key: "active", header: "Status", render: (s) => (!s.active ? <StatusBadge status="neutral">Closed</StatusBadge> : s.strength >= s.seats ? <StatusBadge status="warning">Full</StatusBadge> : <StatusBadge status="success">Open</StatusBadge>) },
        ]}
      />
    </div>
  );
}

function LevelsList({ onEdit }: { onEdit: (l: SetupClassLevel | null) => void }) {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const canManage = useCan("setup.manage");
  const q = useQuery(setupQueries.levels(ctx));
  const classes = useQuery(setupQueries.classes(ctx)).data ?? [];
  return (
    <div className="grid gap-4">
      {q.isError && <QueryError what="The levels" error={q.error} onRetry={() => void q.refetch()} />}
      <DataTable
        rows={q.data ?? []}
        loading={q.isLoading}
        caption="Class levels"
        stickyHeader={false}
        {...(readOnly || !canManage ? {} : { onRowClick: (l: SetupClassLevel) => onEdit(l) })}
        toolbar={
          <>
            <span className="text-small text-ink-muted">{formatCount(q.data?.length ?? 0)} levels</span>
            <EditButton size="sm" variant="primary" icon="plus" onClick={() => onEdit(null)} reason={canManage ? null : HEAD_OFFICE_ONLY}>
              Add level
            </EditButton>
          </>
        }
        empty={<EmptyState icon="folder" title="No levels yet" description="Add the levels your classes are grouped by, such as Primary and Middle." />}
        columns={[
          { key: "order", header: "#", width: 48, render: (l) => <span className="tabular-nums text-ink-muted">{l.order}</span> },
          {
            key: "name",
            header: "Level",
            render: (l) => (
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{l.name}</span>
                {l.degree && (
                  <StatusBadge status="brand" dot={false}>
                    Degree
                  </StatusBadge>
                )}
              </span>
            ),
          },
          { key: "classes", header: "Classes", render: (l) => <span className="text-small">{classes.filter((c) => c.levelId === l.id).map((c) => c.name).join(", ") || "—"}</span> },
          { key: "classCount", header: "Count", align: "right" },
          { key: "active", header: "Status", render: (l) => (l.active ? <StatusBadge status="success">In use</StatusBadge> : <StatusBadge status="neutral">Off</StatusBadge>) },
        ]}
      />
      <p className="m-0 text-small text-ink-muted">Levels group classes on reports and dashboards. Staff categories (teaching, non-teaching, management) were mixed into this list in the old software; they now live in Staff &amp; payroll.</p>
    </div>
  );
}

export function ClassesPage({ tab, onTab }: { tab: ClassesTab; onTab: (t: ClassesTab) => void }) {
  const ctx = useCtx();
  const canManage = useCan("setup.manage");
  const [editClass, setEditClass] = useState<SetupClass | null | undefined>(undefined);
  const [editSection, setEditSection] = useState<SetupSection | null | undefined>(undefined);
  const [editLevel, setEditLevel] = useState<SetupClassLevel | null | undefined>(undefined);
  const classes = useQuery(setupQueries.classes(ctx)).data ?? [];
  const levels = useQuery(setupQueries.levels(ctx)).data ?? [];
  return (
    <SetupPage title="Classes and sections">
      {!canManage && (
        <Banner tone="info" icon="building">
          You can set up {campusLabel(ctx.campus)}'s sections: names, seats, rooms, groups and open or closed. Classes and levels are shared by every campus, so head office changes them.
        </Banner>
      )}
      <div>
        <Tabs
          aria-label="Classes"
          idPrefix="cls-"
          value={tab}
          onChange={(id) => onTab(id as ClassesTab)}
          tabs={[
            { id: "classes", label: "Classes", icon: "layers" },
            { id: "sections", label: "Sections", icon: "students" },
            { id: "levels", label: "Levels", icon: "folder" },
          ]}
        />
        <TabPanel id="classes" idPrefix="cls-" active={tab === "classes"} className="pt-4">
          <Panel id="classes-list" title="Classes" description={canManage ? "Shared by every campus. Click a class to edit it." : "Shared by every campus."} flush rise={0}>
            <ClassesTable onEdit={setEditClass} />
          </Panel>
        </TabPanel>
        <TabPanel id="sections" idPrefix="cls-" active={tab === "sections"} className="pt-4">
          <SectionsTable onEdit={setEditSection} />
        </TabPanel>
        <TabPanel id="levels" idPrefix="cls-" active={tab === "levels"} className="pt-4">
          <Panel id="levels-list" title="Class levels" description={canManage ? "Click a level to rename, reorder or switch it off." : "Shared by every campus."} flush rise={0}>
            <LevelsList onEdit={setEditLevel} />
          </Panel>
        </TabPanel>
      </div>
      {editClass !== undefined && <ClassEditor key={editClass?.id ?? "new"} cls={editClass} onClose={() => setEditClass(undefined)} />}
      {editSection !== undefined && <SectionEditor key={editSection?.id ?? "new"} section={editSection} classes={classes} levels={levels} onClose={() => setEditSection(undefined)} />}
      {editLevel !== undefined && <LevelEditor key={editLevel?.id ?? "new"} level={editLevel} count={levels.length} onClose={() => setEditLevel(undefined)} />}
    </SetupPage>
  );
}
