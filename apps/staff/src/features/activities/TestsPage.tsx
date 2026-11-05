import { activitiesApi, activitiesQueries, type ActivitiesTestSource, type ActivitiesTestSummary } from "@mtb/api";
import { formatCount, formatDate, formatSession } from "@mtb/domain";
import { AnimatedNumber, Banner, Button, DataTable, DatePicker, EmptyState, IconButton, Input, Modal, Segmented, Select, StatCard, useToast, type Column } from "@mtb/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { campusLabel } from "../../app/shell/campus";
import { Page, PageHeader } from "../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { ActivitiesNav, errorField, errorText, LoadError, TestBadge, useRefresh } from "./shared";

/** Scholarship tests and merit lists: from declared exam results, or a dedicated test with its own papers. */
export function TestsPage({ creating, onCreating }: { creating: boolean; onCreating: (open: boolean) => void }) {
  const ctx = useCtx();
  const navigate = useNavigate();
  const canManage = useCan("activities.manage");
  const readOnly = useReadOnly();
  const tests = useQuery(activitiesQueries.tests(ctx));
  const list = tests.data ?? [];
  const open = (id: string) => void navigate({ to: "/activities/tests/$testId", params: { testId: id } });

  const columns: Array<Column<ActivitiesTestSummary>> = [
    {
      key: "title",
      header: "Test",
      render: (t) => (
        <span className="grid">
          <span className="mtb-cell-primary">{t.title}</span>
          <span className="mtb-cell-secondary">
            <span className="mtb-num">{t.testNo}</span> · {t.source === "EXAM" ? `From ${t.examName ?? "exam results"}` : `Test on ${t.date ? formatDate(t.date) : "—"}${t.venue ? `, ${t.venue}` : ""}`}
            {ctx.campus === "ALL" ? ` · ${campusLabel(t.campus)}` : ""}
          </span>
        </span>
      ),
    },
    { key: "scheme", header: "Scheme", width: 170, render: (t) => t.schemeName },
    { key: "rules", header: "Seats · pass mark", width: 150, render: (t) => `${t.seats === null ? "Every qualifier" : `${t.seats} seats`} · ${t.passPercent}%` },
    {
      key: "cands",
      header: "Candidates",
      width: 170,
      render: (t) => {
        const pct = t.candidateCount ? Math.round((t.marked / t.candidateCount) * 100) : 0;
        return (
          <span className="grid gap-1">
            <span className="text-small text-ink-muted">
              <span className="mtb-num text-ink">{t.marked}</span> of {t.candidateCount} marked · {t.qualified} qualify
            </span>
            <span className="mtb-meter" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${pct}% marked`}>
              <span style={{ width: `${pct}%` }} />
            </span>
          </span>
        );
      },
    },
    { key: "proposed", header: "Awards", align: "right", width: 90, render: (t) => <span className="mtb-num">{t.proposed}</span> },
    { key: "status", header: "Status", width: 170, render: (t) => <TestBadge status={t.status} /> },
  ];

  return (
    <Page>
      <PageHeader
        title="Scholarship tests"
        actions={
          canManage && !readOnly && ctx.campus !== "ALL" ? (
            <Button variant="primary" icon="plus" onClick={() => onCreating(true)}>
              New merit list or test
            </Button>
          ) : undefined
        }
      />
      <ActivitiesNav />
      {tests.isError && <LoadError what="Scholarship tests" error={tests.error} onRetry={() => void tests.refetch()} />}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Taking names" icon="admissions" loading={tests.isLoading} value={<AnimatedNumber value={list.filter((t) => t.status === "REGISTRATION").length} format={formatCount} />} foot="Registration open" />
        <StatCard label="Being marked" icon="edit" loading={tests.isLoading} value={<AnimatedNumber value={list.filter((t) => t.status === "MARKING").length} format={formatCount} />} foot="Marks still coming in" />
        <StatCard label="Merit lists ready" icon="award" tone={list.some((t) => t.status === "RESULT") ? "info" : "neutral"} loading={tests.isLoading} value={<AnimatedNumber value={list.filter((t) => t.status === "RESULT").length} format={formatCount} />} foot="Waiting for awards to be proposed" />
      </div>
      <DataTable
        caption={`Scholarship tests, ${campusLabel(ctx.campus)}, session ${formatSession(ctx.session)}`}
        columns={columns}
        rows={list}
        loading={tests.isLoading}
        onRowClick={(t) => open(t.id)}
        empty={
          <EmptyState
            icon="listChecks"
            title={`No scholarship tests in ${formatSession(ctx.session)}`}
            description="Make a merit list straight from a declared exam, or set up a dedicated test with its own papers."
            action={
              canManage && !readOnly && ctx.campus !== "ALL" ? (
                <Button variant="primary" onClick={() => onCreating(true)}>
                  New merit list or test
                </Button>
              ) : undefined
            }
          />
        }
      />
      {creating && ctx.campus !== "ALL" && <NewTestModal onClose={(id) => (onCreating(false), id ? open(id) : undefined)} />}
    </Page>
  );
}

const base = z.object({
  title: z.string().trim().min(3, "Give it a title, for example “Talent scholarship · Class 7”."),
  schemeId: z.string().min(1, "Choose the scheme the awards come from."),
  pass: z.number({ error: "Enter the pass mark." }).min(0, "From 0 to 100.").max(100, "From 0 to 100."),
});

interface PaperRow {
  name: string;
  max: string;
}

function NewTestModal({ onClose }: { onClose: (id?: string) => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const refresh = useRefresh();
  const schemes = useQuery(activitiesQueries.schemes(ctx));
  const exams = useQuery(activitiesQueries.examOptions(ctx));
  const catalogue = useQuery(activitiesQueries.catalogue(ctx));
  const [source, setSource] = useState<ActivitiesTestSource>("EXAM");
  const [title, setTitle] = useState("");
  const [examId, setExamId] = useState("");
  const [schemeId, setSchemeId] = useState("sc-merit");
  const [seats, setSeats] = useState("3");
  const [pass, setPass] = useState("80");
  const [classLabel, setClassLabel] = useState("");
  const [date, setDate] = useState<string | null>(null);
  const [venue, setVenue] = useState("");
  const [papers, setPapers] = useState<PaperRow[]>([
    { name: "English", max: "50" },
    { name: "Mathematics", max: "50" },
  ]);
  const [tried, setTried] = useState(false);
  const active = (schemes.data ?? []).filter((s) => s.active);
  const check = base.safeParse({ title, schemeId, pass: pass === "" ? undefined : Number(pass) });
  const errs: Record<string, string> = check.success ? {} : Object.fromEntries(check.error.issues.map((i) => [String(i.path[0]), i.message]));
  if (seats !== "" && (Number(seats) < 1 || Number(seats) > 50)) errs.seats = "From 1 to 50, or leave empty to award everyone who passes.";
  if (source === "EXAM" && !examId) errs.examId = "Choose the declared exam.";
  if (source === "DEDICATED") {
    if (classLabel.trim().length < 3) errs.classLabel = "Say who may sit, for example “Class 9 (students and applicants)”.";
    if (!date) errs.date = "Choose the test date.";
    if (papers.length === 0 || papers.some((p) => !p.name.trim() || !(Number(p.max) >= 5 && Number(p.max) <= 200))) errs.papers = "Each paper needs a name and maximum marks from 5 to 200.";
  }

  const save = useMutation({
    mutationFn: () =>
      activitiesApi.createTest(ctx, {
        title: title.trim(),
        source,
        schemeId,
        seats: seats === "" ? null : Number(seats),
        passPercent: Number(pass),
        ...(source === "EXAM" ? { examId } : { classLabel: classLabel.trim(), date: date!, venue, papers: papers.map((p, i) => ({ id: `p${i + 1}`, name: p.name.trim(), maxMarks: Number(p.max) })) }),
      }),
    onSuccess: (t) => {
      refresh();
      toast({ title: t.source === "EXAM" ? "Merit list made" : "Test set up", message: t.source === "EXAM" ? `${t.testNo}: ${t.candidateCount} students ranked from ${t.examName}.` : `${t.testNo}: register candidates next.` });
      onClose(t.id);
    },
  });
  const sf = save.isError ? errorField(save.error) : undefined;
  const err = (k: string) => (tried ? errs[k] : undefined) ?? (sf === k ? errorText(save.error) : undefined);

  return (
    <Modal
      open
      size="lg"
      onClose={() => onClose()}
      title="New merit list or test"
      description="A merit list from results ranks students at once. A dedicated test takes registrations, then marks."
      footer={
        <>
          <Button onClick={() => onClose()}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => {
              setTried(true);
              if (Object.keys(errs).length === 0) save.mutate();
            }}
          >
            {source === "EXAM" ? "Make merit list" : "Set up test"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Segmented
          aria-label="Source"
          value={source}
          onChange={(v) => {
            setSource(v as ActivitiesTestSource);
            setTried(false);
          }}
          options={[
            { value: "EXAM", label: "From exam results" },
            { value: "DEDICATED", label: "Dedicated test" },
          ]}
        />
        {source === "EXAM" ? (
          <Select
            label="Declared exam"
            required
            value={examId}
            onChange={(e) => {
              setExamId(e.target.value);
              const ex = exams.data?.find((x) => x.id === e.target.value);
              if (ex && !title) setTitle(`Talent scholarship · ${ex.classes.length > 1 ? `Class ${ex.classes[0]!.split("-")[0]}` : ex.classes[0]}`);
            }}
            error={err("examId")}
            help={exams.data && exams.data.length === 0 ? "No declared results yet this session. Declare an exam first, or set up a dedicated test." : "Only declared results can make a merit list."}
            options={[{ value: "", label: exams.isLoading ? "Loading…" : "Choose…" }, ...(exams.data ?? []).map((x) => ({ value: x.id, label: `${x.name} · ${x.classes.join(", ")} (${x.candidates} students)` }))]}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Who may sit" required value={classLabel} onChange={(e) => setClassLabel(e.target.value)} error={err("classLabel")} placeholder="Class 9 (students and applicants)" />
            <DatePicker label="Test date" required value={date} onValueChange={setDate} minDate="2026-04-01" maxDate="2027-03-31" today="2026-11-04" error={err("date")} />
            <Select label="Where" value={venue} onChange={(e) => setVenue(e.target.value)} options={[{ value: "", label: "Choose…" }, ...(catalogue.data?.venues ?? []).filter((v) => v.active).map((v) => ({ value: v.name, label: v.name }))]} />
          </div>
        )}
        <Input label="Title" required value={title} onChange={(e) => setTitle(e.target.value)} error={err("title")} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Select label="Scheme" required value={schemeId} onChange={(e) => setSchemeId(e.target.value)} error={err("schemeId")} options={active.map((s) => ({ value: s.id, label: s.name }))} />
          <Input label="Seats" inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value.replace(/\D/g, ""))} error={err("seats")} help="Empty = everyone who passes." />
          <Input label="Pass mark" required inputMode="numeric" suffix="%" value={pass} onChange={(e) => setPass(e.target.value.replace(/\D/g, ""))} error={err("pass") ?? err("passPercent")} />
        </div>
        {source === "DEDICATED" && (
          <section className="grid gap-2">
            <div className="flex items-center justify-between">
              <span className="mtb-label">Papers</span>
              <Button size="sm" icon="plus" onClick={() => setPapers((p) => [...p, { name: "", max: "50" }])}>
                Add paper
              </Button>
            </div>
            {papers.map((p, i) => (
              <div key={i} className="grid grid-cols-[1fr_120px_auto] items-end gap-2">
                <Input aria-label={`Paper ${i + 1} name`} placeholder="Paper name" value={p.name} onChange={(e) => setPapers((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
                <Input aria-label={`Paper ${i + 1} maximum marks`} suffix="marks" inputMode="numeric" value={p.max} onChange={(e) => setPapers((x) => x.map((y, j) => (j === i ? { ...y, max: e.target.value.replace(/\D/g, "") } : y)))} />
                <IconButton icon="trash" label={`Remove paper ${i + 1}`} onClick={() => setPapers((x) => x.filter((_, j) => j !== i))} />
              </div>
            ))}
            {err("papers") && <span className="mtb-error">{err("papers")}</span>}
          </section>
        )}
        {save.isError && !sf && <Banner tone="danger">{errorText(save.error)}</Banner>}
      </div>
    </Modal>
  );
}
