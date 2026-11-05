import { setupApi, setupQueries, type SetupClassSubject, type SetupClassSubjects, type SetupGroup, type SetupGroupInput, type SetupMedium, type SetupSubject, type SetupSubjectInput } from "@mtb/api";
import { formatCount, formatDateTime } from "@mtb/domain";
import { Banner, Button, Checkbox, Combobox, DataTable, EmptyState, IconButton, Input, Panel, Select, SidePanel, Skeleton, StatusBadge, Switch, TabPanel, Tabs, Urdu, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { useCtx, useReadOnly } from "../../app/session";
import { apiFieldError, ConflictBanner, conflictOf, EditButton, err, errorText, QueryError, SetupPage, zodErrors, type Conflict, type FieldErrors } from "./shared";

export type SubjectsTab = "classes" | "subjects" | "groups";

/* ------------------------------------------------------------------ Class subjects (allotment with marks) */

type Row = Omit<SetupClassSubject, "subjectName">;

function ClassSubjectsEditor({ classId, groupId }: { classId: string; groupId: string | null }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const q = useQuery(setupQueries.classSubjects(ctx, classId, groupId));
  const subjects = useQuery(setupQueries.subjects(ctx)).data ?? [];
  const classes = useQuery(setupQueries.classes(ctx)).data ?? [];
  const levels = useQuery(setupQueries.levels(ctx)).data ?? [];
  const cls = classes.find((c) => c.id === classId);
  const degree = Boolean(cls && levels.find((l) => l.id === cls.levelId)?.degree);
  if (q.isLoading) return <Skeleton height={320} />;
  if (q.isError) return <QueryError what="This class's subjects" error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return null;
  return <ClassSubjectsForm key={`${classId}|${groupId}|${q.data.rowVer}`} data={q.data} subjects={subjects} degree={degree} readOnly={readOnly} onSaved={(total) => {
    void qc.invalidateQueries({ queryKey: ["setup"] });
    toast({ title: `${q.data!.className}${q.data!.groupName ? ` · ${q.data!.groupName}` : ""} saved`, message: `${total} marks in all. New exams use these marks; exams already created keep theirs.` });
  }} onReload={() => void qc.invalidateQueries({ queryKey: ["setup"] })} />;
}

function ClassSubjectsForm({
  data,
  subjects,
  degree,
  readOnly,
  onSaved,
  onReload,
}: {
  data: SetupClassSubjects;
  subjects: SetupSubject[];
  /** Degree programme: every course needs 1 to 6 credit hours. */
  degree: boolean;
  readOnly: boolean;
  onSaved: (total: number) => void;
  onReload: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => data.subjects.map(({ subjectName: _n, ...r }) => r));
  const [adding, setAdding] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const nameOf = (id: string) => subjects.find((s) => s.id === id)?.name ?? id;
  const dirty = JSON.stringify(rows) !== JSON.stringify(data.subjects.map(({ subjectName: _n, ...r }) => r));
  const total = rows.reduce((a, r) => a + (r.maxMarks || 0), 0);
  const periods = rows.reduce((a, r) => a + (r.periodsPerWeek || 0), 0);
  const credits = rows.reduce((a, r) => a + (r.creditHours || 0), 0);
  const update = (i: number, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setRowErrors((e) => ({ ...e, [rows[i]!.subjectId]: "" }));
  };
  const move = (i: number, d: -1 | 1) =>
    setRows((rs) => {
      const n = rs.slice();
      const j = i + d;
      if (j < 0 || j >= n.length) return rs;
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n.map((r, k) => ({ ...r, order: k + 1 }));
    });
  const save = useMutation({
    mutationFn: () => setupApi.saveClassSubjects(data.classId, data.groupId, { subjects: rows.map((r, i) => ({ ...r, order: i + 1 })), rowVer: data.rowVer }),
    onSuccess: () => onSaved(total),
    onError: (e) => {
      const c = conflictOf(e);
      if (c) return setConflict(c);
      setFailure(errorText(e));
    },
  });
  const submit = () => {
    setFailure(null);
    const errs: Record<string, string> = {};
    for (const r of rows) {
      if (!Number.isInteger(r.maxMarks) || r.maxMarks < 1 || r.maxMarks > 1000) errs[r.subjectId] = "Maximum marks must be from 1 to 1000.";
      else if (!Number.isInteger(r.passMarks) || r.passMarks < 0 || r.passMarks > r.maxMarks) errs[r.subjectId] = `Pass marks must be between 0 and ${r.maxMarks}.`;
      else if (r.periodsPerWeek < 0 || r.periodsPerWeek > 12) errs[r.subjectId] = "Periods a week must be from 0 to 12.";
      else if (!Number.isInteger(r.creditHours) || r.creditHours < 0 || r.creditHours > 6) errs[r.subjectId] = "Credit hours must be from 0 to 6.";
      else if (degree && r.creditHours < 1) errs[r.subjectId] = "A degree course needs at least 1 credit hour.";
    }
    setRowErrors(errs);
    if (Object.keys(errs).length) return;
    save.mutate();
  };
  const available = subjects.filter((s) => s.active && !rows.some((r) => r.subjectId === s.id));
  const num = (v: string) => Number(v.replace(/\D/g, "") || 0);
  return (
    <Panel
      id="class-subjects"
      title={`${data.className}${data.groupName ? ` · ${data.groupName}` : ""}`}
      description={`Last changed by ${data.updatedBy}, ${formatDateTime(data.updatedAt)}`}
      flush
      actions={
        <span className="flex flex-wrap gap-2 text-small text-ink-muted">
          <StatusBadge status="neutral" dot={false}>
            {formatCount(total)} marks
          </StatusBadge>
          <StatusBadge status="neutral" dot={false}>
            {periods} periods a week
          </StatusBadge>
          {(degree || credits > 0) && (
            <StatusBadge status="neutral" dot={false}>
              {credits} credit hours
            </StatusBadge>
          )}
        </span>
      }
    >
      <div className="grid gap-3 px-5 pb-2">
        {conflict && <ConflictBanner conflict={conflict} onReload={onReload} />}
        {failure && <Banner tone="danger" title="Not saved.">{failure}</Banner>}
      </div>
      {rows.length === 0 ? (
        <EmptyState icon="book" title="No subjects yet" description="Add the subjects this class studies. Marks entry and result cards follow this list." />
      ) : (
        <div className="mtb-table-scroll">
          <table className="mtb-table mtb-table-dense">
            <caption className="mtb-sr-only">Subjects and marks</caption>
            <thead>
              <tr>
                <th scope="col" style={{ width: 64 }}>
                  Order
                </th>
                <th scope="col">Subject</th>
                <th scope="col" className="mtb-th-num" style={{ width: 120 }}>
                  Maximum
                </th>
                <th scope="col" className="mtb-th-num" style={{ width: 120 }}>
                  Pass
                </th>
                <th scope="col" className="mtb-th-num" style={{ width: 120 }}>
                  Periods / week
                </th>
                <th scope="col" className="mtb-th-num" style={{ width: 110 }}>
                  Credit hrs
                </th>
                <th scope="col" style={{ width: 100 }}>
                  Optional
                </th>
                <th scope="col" style={{ width: 120 }}>
                  <span className="mtb-sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.subjectId} className="mtb-slide-in" style={{ ["--i" as string]: i }}>
                  <td className="tabular-nums text-ink-muted">{i + 1}</td>
                  <td>
                    <span className="grid">
                      <span className="font-medium">{nameOf(r.subjectId)}</span>
                      {rowErrors[r.subjectId] && (
                        <span className="text-small text-danger-ink" role="alert">
                          {rowErrors[r.subjectId]}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="mtb-td-num">
                    <Input aria-label={`${nameOf(r.subjectId)} maximum marks`} amount inputMode="numeric" disabled={readOnly} value={String(r.maxMarks)} onChange={(e) => update(i, { maxMarks: num(e.target.value) })} />
                  </td>
                  <td className="mtb-td-num">
                    <Input aria-label={`${nameOf(r.subjectId)} pass marks`} amount inputMode="numeric" disabled={readOnly} value={String(r.passMarks)} onChange={(e) => update(i, { passMarks: num(e.target.value) })} />
                  </td>
                  <td className="mtb-td-num">
                    <Input aria-label={`${nameOf(r.subjectId)} periods a week`} amount inputMode="numeric" disabled={readOnly} value={String(r.periodsPerWeek)} onChange={(e) => update(i, { periodsPerWeek: num(e.target.value) })} />
                  </td>
                  <td className="mtb-td-num">
                    <Input aria-label={`${nameOf(r.subjectId)} credit hours`} amount inputMode="numeric" maxLength={1} disabled={readOnly} value={String(r.creditHours)} onChange={(e) => update(i, { creditHours: num(e.target.value) })} />
                  </td>
                  <td>
                    <Checkbox aria-label={`${nameOf(r.subjectId)} is optional`} checked={r.optional} disabled={readOnly} onChange={(e) => update(i, { optional: e.target.checked })} />
                  </td>
                  <td className="mtb-td-actions">
                    {!readOnly && (
                      <>
                        <IconButton icon="arrowUp" label={`Move ${nameOf(r.subjectId)} up`} size="sm" disabled={i === 0} onClick={() => move(i, -1)} />
                        <IconButton icon="arrowDown" label={`Move ${nameOf(r.subjectId)} down`} size="sm" disabled={i === rows.length - 1} onClick={() => move(i, 1)} />
                        <IconButton icon="trash" label={`Remove ${nameOf(r.subjectId)}`} size="sm" variant="danger-quiet" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} />
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td />
                <td className="font-medium">Total</td>
                <td className="mtb-td-num font-medium">{formatCount(total)}</td>
                <td className="mtb-td-num text-ink-muted">{formatCount(rows.reduce((a, r) => a + (r.passMarks || 0), 0))}</td>
                <td className="mtb-td-num font-medium">{periods}</td>
                <td className="mtb-td-num font-medium">{credits}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {!readOnly && (
        <div className="flex flex-wrap items-end justify-between gap-3 border-t border-border px-5 py-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-64">
              <Combobox label="Add a subject" options={available.map((s) => ({ value: s.id, label: s.name, hint: s.code }))} value={adding} onValueChange={setAdding} placeholder="Choose a subject…" emptyText="Every active subject is already listed" />
            </div>
            <Button
              icon="plus"
              disabled={!adding}
              onClick={() => {
                if (!adding) return;
                setRows((rs) => [...rs, { subjectId: adding, maxMarks: 100, passMarks: degree ? 50 : 33, periodsPerWeek: degree ? 3 : 4, creditHours: degree ? 3 : 0, order: rs.length + 1, optional: false }]);
                setAdding(null);
              }}
            >
              Add
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={!dirty || save.isPending} onClick={() => setRows(data.subjects.map(({ subjectName: _n, ...r }) => r))}>
              Undo changes
            </Button>
            <Button variant="primary" icon="check" disabled={!dirty || Boolean(conflict)} loading={save.isPending} loadingLabel="Saving…" onClick={submit}>
              Save subjects
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

function ClassSubjectsView() {
  const ctx = useCtx();
  const classes = useQuery(setupQueries.classes(ctx));
  const groups = useQuery(setupQueries.groups(ctx)).data ?? [];
  const [sel, setSel] = useState<{ classId: string; groupId: string | null }>({ classId: "c-7", groupId: null });
  const list = (classes.data ?? []).filter((c) => c.active);
  return (
    <div className="setup-split">
      <div className="mtb-card">
        <div className="px-4 pt-4 text-small font-medium text-ink-muted">Classes</div>
        {classes.isLoading ? (
          <div className="grid gap-2 p-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} height={28} />
            ))}
          </div>
        ) : (
          <ul className="setup-picker" aria-label="Choose a class">
            {list.map((c) =>
              c.groupIds.length === 0 ? (
                <li key={c.id}>
                  <button type="button" aria-current={sel.classId === c.id && !sel.groupId ? "true" : undefined} onClick={() => setSel({ classId: c.id, groupId: null })}>
                    {c.name}
                  </button>
                </li>
              ) : (
                <li key={c.id}>
                  <div className="px-3 py-1 text-small font-medium text-ink-muted">{c.name}</div>
                  <ul className="m-0 grid list-none gap-0.5 p-0">
                    {c.groupIds.map((g) => (
                      <li key={g}>
                        <button type="button" className="setup-picker-sub" aria-current={sel.classId === c.id && sel.groupId === g ? "true" : undefined} onClick={() => setSel({ classId: c.id, groupId: g })}>
                          {groups.find((x) => x.id === g)?.name ?? g}
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ),
            )}
          </ul>
        )}
      </div>
      <ClassSubjectsEditor classId={sel.classId} groupId={sel.groupId} />
    </div>
  );
}

/* ------------------------------------------------------------------ Subjects master */

const subjectSchema = z.object({
  name: z.string().trim().min(1, { error: "Enter the subject name." }),
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z][A-Za-z0-9]{1,5}$/, { error: "Use 2 to 6 letters or numbers, starting with a letter, e.g. MATH or CS301." }),
});

function SubjectEditor({ subject, count, onClose }: { subject: SetupSubject | null; count: number; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<Omit<SetupSubjectInput, "rowVer">>(() =>
    subject ? { code: subject.code, name: subject.name, nameUrdu: subject.nameUrdu, medium: subject.medium, order: subject.order, active: subject.active } : { code: "", name: "", nameUrdu: "", medium: "ENGLISH", order: count + 1, active: true },
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };
  const save = useMutation({
    mutationFn: () => setupApi.saveSubject({ ...form, code: form.code.toUpperCase(), ...(subject ? { rowVer: subject.rowVer } : {}) }, subject?.id),
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: ["setup"] });
      toast({ title: subject ? `${s.name} saved` : `${s.name} added`, message: subject ? "Every campus sees the change." : "Add it to the classes that study it." });
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
    const r = subjectSchema.safeParse(form);
    if (!r.success) return setErrors(zodErrors(r.error));
    save.mutate();
  };
  return (
    <SidePanel
      open
      onClose={onClose}
      title={subject ? `Edit ${subject.name}` : "Add subject"}
      description="Subjects are shared by every campus."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="check" onClick={submit} loading={save.isPending} disabled={Boolean(conflict)}>
            {subject ? "Save subject" : "Add subject"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {conflict && <ConflictBanner conflict={conflict} onReload={() => void qc.invalidateQueries({ queryKey: ["setup"] }).then(onClose)} />}
        {failure && <Banner tone="danger" title="Not saved.">{failure}</Banner>}
        <Input label="Subject name" required value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Computer Science" {...err(errors, "name")} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Code" required mono maxLength={6} value={form.code} onChange={(e) => set("code", e.target.value.toUpperCase())} placeholder="CMP" {...err(errors, "code")} />
          <Select label="Taught in" value={form.medium} onChange={(e) => set("medium", e.target.value as SetupMedium)} options={[{ value: "ENGLISH", label: "English" }, { value: "URDU", label: "Urdu" }]} help="Result cards print the subject in this language first." />
        </div>
        <Input label="Name in Urdu" urdu value={form.nameUrdu} onChange={(e) => set("nameUrdu", e.target.value)} />
        <Switch label="In use" checked={form.active} onChange={(e) => set("active", e.target.checked)} />
        {errors.active && <Banner tone="warning">{errors.active}</Banner>}
      </div>
    </SidePanel>
  );
}

function SubjectsList() {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const q = useQuery(setupQueries.subjects(ctx));
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<SetupSubject | null | undefined>(undefined);
  const rows = (q.data ?? []).filter((s) => !search.trim() || `${s.name} ${s.code}`.toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <>
      {q.isError && <QueryError what="The subjects" error={q.error} onRetry={() => void q.refetch()} />}
      <Panel id="subjects-list" title="Subjects" description="Shared by every campus. Click a subject to edit it." flush rise={0}>
        <DataTable
          rows={rows}
          loading={q.isLoading}
          caption="Subjects"
          {...(readOnly ? {} : { onRowClick: (s: SetupSubject) => setEditing(s) })}
          toolbar={
            <>
              <div className="w-64">
                <Input aria-label="Search subjects" icon="search" placeholder="Name or code" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <EditButton size="sm" variant="primary" icon="plus" onClick={() => setEditing(null)}>
                Add subject
              </EditButton>
            </>
          }
          empty={<EmptyState icon="book" title="No subjects match" description="Search by subject name or code." />}
          columns={[
            { key: "code", header: "Code", width: 90, render: (s) => <span className="mtb-mono">{s.code}</span> },
            {
              key: "name",
              header: "Subject",
              render: (s) => (
                <span className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-medium">{s.name}</span>
                  {s.nameUrdu && <Urdu size="small" className="text-ink-muted">{s.nameUrdu}</Urdu>}
                </span>
              ),
            },
            { key: "medium", header: "Taught in", render: (s) => (s.medium === "URDU" ? "Urdu" : "English") },
            { key: "classCount", header: "Classes", align: "right", render: (s) => formatCount(s.classCount) },
            { key: "active", header: "Status", render: (s) => (s.active ? <StatusBadge status="success">In use</StatusBadge> : <StatusBadge status="neutral">Off</StatusBadge>) },
          ]}
        />
      </Panel>
      {editing !== undefined && <SubjectEditor key={editing?.id ?? "new"} subject={editing} count={q.data?.length ?? 0} onClose={() => setEditing(undefined)} />}
    </>
  );
}

/* ------------------------------------------------------------------ Groups */

function GroupEditor({ group, onClose }: { group: SetupGroup | null; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const classes = useQuery(setupQueries.classes(ctx)).data ?? [];
  const [form, setForm] = useState<Omit<SetupGroupInput, "rowVer">>(() => (group ? { name: group.name, short: group.short, classIds: group.classIds, active: group.active } : { name: "", short: "", classIds: [], active: true }));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => setupApi.saveGroup({ ...form, short: form.short.trim(), ...(group ? { rowVer: group.rowVer } : {}) }, group?.id),
    onSuccess: (g) => {
      void qc.invalidateQueries({ queryKey: ["setup"] });
      toast({ title: group ? `${g.name} saved` : `${g.name} added`, message: "Set its subjects under Class subjects." });
      onClose();
    },
    onError: (e) => {
      const f = apiFieldError(e);
      if (f) return setErrors(f);
      setFailure(conflictOf(e) ? "Someone else changed this group. Close this panel and open it again." : errorText(e));
    },
  });
  const submit = () => {
    const next: FieldErrors = {};
    if (!form.name.trim()) next.name = "Enter the group name, e.g. Science (Biology).";
    if (!/^[A-Za-z0-9 .()-]{1,8}$/.test(form.short.trim())) next.short = "Use 1 to 8 letters or numbers, e.g. Bio.";
    if (!form.classIds.length) next.classIds = "Choose at least one class that offers this group.";
    setErrors(next);
    if (!Object.keys(next).length) save.mutate();
  };
  return (
    <SidePanel
      open
      onClose={onClose}
      title={group ? `Edit ${group.name}` : "Add group"}
      description="A group (stream) is a set of subjects some sections study, such as Science (Biology) in Class 9."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="check" onClick={submit} loading={save.isPending}>
            {group ? "Save group" : "Add group"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {failure && <Banner tone="danger" title="Not saved.">{failure}</Banner>}
        <Input label="Group name" required value={form.name} onChange={(e) => { setForm((f) => ({ ...f, name: e.target.value })); setErrors((x) => ({ ...x, name: undefined })); }} {...err(errors, "name")} />
        <Input
          label="Short title"
          required
          maxLength={8}
          value={form.short}
          onChange={(e) => {
            setForm((f) => ({ ...f, short: e.target.value }));
            setErrors((x) => ({ ...x, short: undefined }));
          }}
          placeholder="Bio"
          {...(errors.short ? { error: errors.short } : { help: "Shown in tight tables and on mark sheets." })}
        />
        <fieldset className="m-0 grid gap-2 border-0 p-0">
          <legend className="mtb-label mb-1">Offered in</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {classes.map((c) => (
              <Checkbox
                key={c.id}
                label={c.name}
                checked={form.classIds.includes(c.id)}
                onChange={(e) => {
                  setForm((f) => ({ ...f, classIds: e.target.checked ? [...f.classIds, c.id] : f.classIds.filter((x) => x !== c.id) }));
                  setErrors((x) => ({ ...x, classIds: undefined }));
                }}
              />
            ))}
          </div>
          {errors.classIds && (
            <span className="text-small text-danger-ink" role="alert">
              {errors.classIds}
            </span>
          )}
        </fieldset>
        <Switch label="In use" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
      </div>
    </SidePanel>
  );
}

function GroupsList() {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const q = useQuery(setupQueries.groups(ctx));
  const classes = useQuery(setupQueries.classes(ctx)).data ?? [];
  const [editing, setEditing] = useState<SetupGroup | null | undefined>(undefined);
  return (
    <>
      {q.isError && <QueryError what="The groups" error={q.error} onRetry={() => void q.refetch()} />}
      <Panel id="groups-list" title="Groups" description="Streams some classes split into. Each group has its own subjects." flush rise={0}>
        <DataTable
          rows={q.data ?? []}
          loading={q.isLoading}
          caption="Groups"
          {...(readOnly ? {} : { onRowClick: (g: SetupGroup) => setEditing(g) })}
          toolbar={
            <>
              <span className="text-small text-ink-muted">{formatCount(q.data?.length ?? 0)} groups</span>
              <EditButton size="sm" variant="primary" icon="plus" onClick={() => setEditing(null)}>
                Add group
              </EditButton>
            </>
          }
          empty={<EmptyState icon="folder" title="No groups yet" description="Add one when a class splits into streams, such as Science and Humanities." />}
          columns={[
            { key: "name", header: "Group", render: (g) => <span className="font-medium">{g.name}</span> },
            { key: "short", header: "Short", width: 100, render: (g) => (g.short ? <span className="mtb-mono">{g.short}</span> : <span className="text-ink-subtle">—</span>) },
            { key: "classes", header: "Offered in", render: (g) => g.classIds.map((c) => classes.find((x) => x.id === c)?.name ?? c).join(", ") },
            { key: "active", header: "Status", render: (g) => (g.active ? <StatusBadge status="success">In use</StatusBadge> : <StatusBadge status="neutral">Off</StatusBadge>) },
          ]}
        />
      </Panel>
      {editing !== undefined && <GroupEditor key={editing?.id ?? "new"} group={editing} onClose={() => setEditing(undefined)} />}
    </>
  );
}

export function SubjectsPage({ tab, onTab }: { tab: SubjectsTab; onTab: (t: SubjectsTab) => void }) {
  return (
    <SetupPage title="Subjects and marks">
      <div>
        <Tabs
          aria-label="Subjects"
          idPrefix="sub-"
          value={tab}
          onChange={(id) => onTab(id as SubjectsTab)}
          tabs={[
            { id: "classes", label: "Class subjects", icon: "listChecks" },
            { id: "subjects", label: "Subjects", icon: "book" },
            { id: "groups", label: "Groups", icon: "folder" },
          ]}
        />
        <TabPanel id="classes" idPrefix="sub-" active={tab === "classes"} className="grid gap-4 pt-4">
          <ClassSubjectsView />
        </TabPanel>
        <TabPanel id="subjects" idPrefix="sub-" active={tab === "subjects"} className="grid gap-4 pt-4">
          <SubjectsList />
        </TabPanel>
        <TabPanel id="groups" idPrefix="sub-" active={tab === "groups"} className="grid gap-4 pt-4">
          <GroupsList />
        </TabPanel>
      </div>
    </SetupPage>
  );
}
