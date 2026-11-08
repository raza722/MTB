import { EXAMS_CATEGORY_HELP, EXAMS_CATEGORY_LABEL, examsApi, examsQueries, setupQueries, type ExamsCategory, type ExamsType, type ExamsTypeInput } from "@mtb/api";
import { formatRs } from "@mtb/domain";
import { Banner, Button, Checkbox, DataTable, EmptyState, Input, Panel, Segmented, Select, SidePanel, StatusBadge, Switch, Urdu, useToast, type Column } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { Page, PageHeader } from "../../app/shell/page";
import { useCtx, useReadOnly } from "../../app/session";
import { errorText, ExamsNav, LoadError, useCanEditShared } from "./shared";

const CATEGORIES: ExamsCategory[] = ["TERM", "TEST", "BOARD", "ENTRANCE", "UNIVERSITY"];

const typeSchema = z.object({
  name: z.string().trim().min(3, "Give the type a name, for example “Second Term”."),
  nameUrdu: z.string().trim().max(60, "Keep the Urdu name short."),
  absenceFine: z.coerce.number({ error: "Type the fine in rupees, or 0 for none." }).int("Whole rupees only.").min(0, "Can't be below 0.").max(5000, "No more than Rs 5,000."),
});

/** One paper of a type's own paper list (Hifz): a subject from Setup › Subjects and its maximum. */
const paperSchema = z.object({
  id: z.string().min(1, "Choose the subject."),
  max: z.coerce.number({ error: "Type the maximum marks." }).int("Whole marks only.").min(1, "At least 1 mark.").max(1000, "No more than 1,000."),
});

interface PaperRow {
  id: string;
  name: string;
  max: string;
}

/** Exam types (the old Exam Type screens, school and university): what kind of exam, how positions work, absence fine. */
export function ExamTypesPage() {
  const ctx = useCtx();
  // Exam types are shared by every campus: only head office (an all-campus grant) changes them.
  const canManage = useCanEditShared();
  const readOnly = useReadOnly();
  const types = useQuery(examsQueries.types(ctx));
  const templates = useQuery(examsQueries.templates(ctx));
  const [editing, setEditing] = useState<ExamsType | "new" | null>(null);
  const [category, setCategory] = useState<"ALL" | ExamsCategory>("ALL");
  const rows = (types.data ?? []).filter((t) => category === "ALL" || t.category === category);

  const columns: Array<Column<ExamsType>> = [
    {
      key: "name",
      header: "Exam type",
      render: (t) => (
        <span className="grid">
          <span className="mtb-cell-primary">{t.name}</span>
          {t.nameUrdu && <Urdu size="small">{t.nameUrdu}</Urdu>}
          {t.papers?.length ? (
            <span className="mtb-cell-secondary">
              Own papers: {t.papers.length} · {t.papers.reduce((a, p) => a + p.maxMarks, 0)} marks
            </span>
          ) : null}
        </span>
      ),
    },
    { key: "category", header: "Kind", width: 160, render: (t) => EXAMS_CATEGORY_LABEL[t.category] },
    { key: "rank", header: "Positions", width: 170, render: (t) => (t.category === "TEST" && t.rankScope === "MONTH" ? "Over the month's tests" : "Within the exam") },
    { key: "promo", header: "Promotion", width: 110, render: (t) => (t.countsForPromotion ? "Counts" : "—") },
    { key: "fine", header: "Absence fine", align: "right", width: 130, render: (t) => (t.absenceFine ? <span className="mtb-num">{formatRs(t.absenceFine)}</span> : <span className="text-ink-muted">None</span>) },
    { key: "exams", header: "Exams this session", align: "right", width: 150, render: (t) => <span className="mtb-num">{t.exams}</span> },
    { key: "active", header: "Status", width: 110, render: (t) => (t.active ? <StatusBadge status="success">In use</StatusBadge> : <StatusBadge status="neutral">Switched off</StatusBadge>) },
  ];

  return (
    <Page>
      <PageHeader
        title="Exam types"
        actions={
          canManage && !readOnly ? (
            <Button variant="primary" icon="plus" onClick={() => setEditing("new")}>
              Add exam type
            </Button>
          ) : undefined
        }
      />
      <ExamsNav />
      {!canManage && !readOnly && <Banner tone="neutral">Exam types are shared by every campus. Only head office can change them.</Banner>}
      {types.isError && <LoadError what="Exam types" error={types.error} onRetry={() => void types.refetch()} />}
      <Panel
        id="types"
        title="Types of exam"
        description={
          category === "UNIVERSITY"
            ? "University types: Mid Semester and Final Semester are the papers; every other University type (Quiz, Test, Assignment, Presentation, General Behaviour) becomes an internal-assessment marks column for the courses that use it."
            : "Every exam is one of these. The kind decides how results work; the old system's duplicate types (two “Monthly Test”, two “Annual”) are merged."
        }
        rise={0}
        flush
      >
        <DataTable
          caption="Exam types"
          columns={columns}
          rows={rows}
          loading={types.isLoading}
          density="dense"
          onRowClick={canManage && !readOnly ? (t) => setEditing(t) : undefined}
          toolbar={<Segmented aria-label="Kind" value={category} onChange={(v) => setCategory(v as typeof category)} options={[{ value: "ALL", label: "All" }, ...CATEGORIES.map((c) => ({ value: c, label: EXAMS_CATEGORY_LABEL[c] }))]} />}
          empty={<EmptyState icon="listChecks" title="No exam types of this kind" description="Add one, or choose another kind." />}
        />
      </Panel>

      <Panel id="class-subjects" title="Subjects and maximum marks by class" description="A new exam copies these; each exam can change a paper's maximum. The lists themselves are kept in Setup → Subjects, shared by every campus." rise={1}>
        {templates.isLoading ? null : (templates.data ?? []).length === 0 ? (
          <EmptyState icon="building" title="Choose a campus" description="Class subjects are shown for one campus at a time." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(templates.data ?? []).map((t) => (
              <div key={t.classShort} className="rounded-md border border-border p-3">
                <div className="mb-1 flex items-baseline justify-between">
                  <b>{t.className}</b>
                  <span className="text-small text-ink-muted">{t.subjects.filter((s) => !s.groups?.length || s.groups.includes(t.groups?.[0] ?? "")).reduce((a, s) => a + s.maxMarks, 0)} marks{t.groups?.length ? " per group" : ""}</span>
                </div>
                <p className="m-0 text-small text-ink-muted">{t.subjects.map((s) => `${s.name} ${s.maxMarks}${s.groups?.length ? ` (${s.groups.join(", ")} only)` : ""}`).join(" · ")}</p>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {editing && <TypePanel type={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </Page>
  );
}

function TypePanel({ type, onClose }: { type: ExamsType | null; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ExamsTypeInput & { fine: string }>({
    name: type?.name ?? "",
    nameUrdu: type?.nameUrdu ?? "",
    category: type?.category ?? "TERM",
    rankScope: type?.rankScope ?? "EXAM",
    countsForPromotion: type?.countsForPromotion ?? false,
    absenceFine: type?.absenceFine ?? 0,
    active: type?.active ?? true,
    fine: String(type?.absenceFine ?? 0),
  });
  const [tried, setTried] = useState(false);
  // A type's own papers are subjects from Setup › Subjects (Hifz: Manzil 1–7, Tajweed … are added there first).
  const subjects = useQuery(setupQueries.subjects(ctx));
  const subjectOptions = (subjects.data ?? []).filter((s) => s.active).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const subjectName = (id: string) => subjects.data?.find((s) => s.id === id)?.name;
  // The type's own papers (Hifz). Off: new exams copy the class's subjects.
  const [ownPapers, setOwnPapers] = useState(Boolean(type?.papers?.length));
  const [papers, setPapers] = useState<PaperRow[]>((type?.papers ?? []).map((p) => ({ id: p.id, name: p.name, max: String(p.maxMarks) })));
  const paperChecks = papers.map((p) => paperSchema.safeParse(p));
  const paperErrs = paperChecks.map((c) => (c.success ? {} : Object.fromEntries(c.error.issues.map((i) => [String(i.path[0]), i.message]))));
  const papersOk = !ownPapers || (papers.length > 0 && paperChecks.every((c) => c.success));
  const check = typeSchema.safeParse({ name: form.name, nameUrdu: form.nameUrdu, absenceFine: form.fine });
  const errs = check.success ? {} : Object.fromEntries(check.error.issues.map((i) => [String(i.path[0]), i.message]));
  const ownAllowed = form.category !== "UNIVERSITY" && form.category !== "BOARD";
  const save = useMutation({
    mutationFn: () => {
      const { fine, papers: _old, ...rest } = form;
      const own = ownPapers && ownAllowed ? papers.map((p) => ({ id: p.id, name: subjectName(p.id) ?? p.name, maxMarks: Number(p.max) })) : [];
      return examsApi.saveType(ctx, { ...rest, name: rest.name.trim(), nameUrdu: rest.nameUrdu.trim(), absenceFine: Number(fine), ...(own.length ? { papers: own } : {}) }, type?.id);
    },
    onSuccess: (t) => {
      void queryClient.invalidateQueries({ queryKey: ["exams"] });
      toast({ title: type ? "Exam type saved" : "Exam type added", message: t.name });
      onClose();
    },
  });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  return (
    <SidePanel
      open
      onClose={onClose}
      title={type ? `Edit ${type.name}` : "Add exam type"}
      description={type && type.exams > 0 ? `Used by ${type.exams} ${type.exams === 1 ? "exam" : "exams"} this session.` : "Shared by every campus."}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => {
              setTried(true);
              if (check.success && (papersOk || !ownAllowed)) save.mutate();
            }}
          >
            {type ? "Save" : "Add type"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Input label="Name" required value={form.name} onChange={(e) => set({ name: e.target.value })} error={tried ? errs.name : undefined} />
        <Input label="Name in Urdu" urdu value={form.nameUrdu} onChange={(e) => set({ nameUrdu: e.target.value })} error={tried ? errs.nameUrdu : undefined} help="Printed on Urdu result cards and date sheets." />
        <Select label="Kind" value={form.category} onChange={(e) => set({ category: e.target.value as ExamsCategory })} help={EXAMS_CATEGORY_HELP[form.category]} options={CATEGORIES.map((c) => ({ value: c, label: EXAMS_CATEGORY_LABEL[c] }))} />
        {form.category === "TEST" && (
          <Select
            label="Positions"
            value={form.rankScope}
            onChange={(e) => set({ rankScope: e.target.value as "EXAM" | "MONTH" })}
            options={[
              { value: "MONTH", label: "Over all class tests of the month" },
              { value: "EXAM", label: "Within this test only" },
            ]}
          />
        )}
        <Input label="Absence fine per paper" prefix="Rs" amount inputMode="numeric" value={form.fine} onChange={(e) => set({ fine: e.target.value.replace(/\D/g, "") })} error={tried ? errs.absenceFine : undefined} help="Charged for each paper missed without leave. Leave is never fined. 0 means no fine." />
        <Checkbox label="Counts towards promotion at the end of the session" checked={form.countsForPromotion} onChange={(e) => set({ countsForPromotion: e.target.checked })} />
        <Switch label={form.active ? "In use: can be chosen for new exams" : "Switched off: kept for old exams only"} checked={form.active} onChange={(e) => set({ active: e.target.checked })} />
        {ownAllowed && (
          <fieldset className="grid gap-3 rounded-md border border-border p-3">
            <legend className="px-1 text-small font-medium">Papers</legend>
            <Checkbox
              label="This type has its own papers (for example Hifz: Manzil 1–7, Tajweed)"
              checked={ownPapers}
              onChange={(e) => {
                setOwnPapers(e.target.checked);
                if (e.target.checked && papers.length === 0) setPapers([{ id: "", name: "", max: "10" }]);
              }}
            />
            {ownPapers ? (
              <>
                <p className="m-0 text-small text-ink-muted">New exams of this type use these papers instead of the class's subjects. Exams already set up keep their papers. Each paper is a subject from Setup › Subjects; names ending in a number (Manzil 1, Manzil 2) print as one group with a total.</p>
                {subjects.isError && <Banner tone="warning">The subject list couldn't be loaded: {errorText(subjects.error)}</Banner>}
                <ul className="m-0 grid list-none gap-2 p-0">
                  {papers.map((p, i) => (
                    <li key={i} className="grid grid-cols-[minmax(0,1fr)_96px_auto] items-start gap-2">
                      <Select
                        aria-label={`Paper ${i + 1} subject`}
                        value={p.id}
                        onChange={(e) => setPapers((l) => l.map((x, j) => (j === i ? { ...x, id: e.target.value, name: subjectName(e.target.value) ?? "" } : x)))}
                        error={tried ? paperErrs[i]?.id : undefined}
                        options={[
                          { value: "", label: subjects.isLoading ? "Loading subjects…" : "Choose a subject…" },
                          // A paper whose subject is no longer listed stays shown as it was saved.
                          ...(p.id && !subjectOptions.some((s) => s.id === p.id) ? [{ value: p.id, label: p.name || p.id }] : []),
                          ...subjectOptions.map((s) => ({ value: s.id, label: s.name })),
                        ]}
                      />
                      <Input aria-label={`Paper ${i + 1} maximum marks`} value={p.max} inputMode="numeric" amount onChange={(e) => setPapers((l) => l.map((x, j) => (j === i ? { ...x, max: e.target.value.replace(/\D/g, "") } : x)))} error={tried ? paperErrs[i]?.max : undefined} />
                      <Button size="sm" variant="ghost" icon="trash" aria-label={`Remove ${p.name || `paper ${i + 1}`}`} onClick={() => setPapers((l) => l.filter((_, j) => j !== i))} />
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button size="sm" icon="plus" onClick={() => setPapers((l) => [...l, { id: "", name: "", max: "10" }])}>
                    Add paper
                  </Button>
                  <span className="text-small text-ink-muted">
                    {papers.length} {papers.length === 1 ? "paper" : "papers"} · {papers.reduce((a, p) => a + (Number(p.max) || 0), 0)} marks
                  </span>
                </div>
                {tried && papers.length === 0 && <p className="m-0 text-small font-medium text-danger-ink">Add at least one paper, or untick “own papers”.</p>}
              </>
            ) : (
              <p className="m-0 text-small text-ink-muted">New exams copy the class's subjects (Setup → Subjects).</p>
            )}
          </fieldset>
        )}
        {save.isError && <Banner tone="danger">{errorText(save.error)}</Banner>}
      </div>
    </SidePanel>
  );
}
