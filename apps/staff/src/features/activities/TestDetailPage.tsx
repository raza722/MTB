import { activitiesApi, activitiesQueries, type ActivitiesCandidate, type ActivitiesFeeHead, type ActivitiesMark, type ActivitiesProposeOverride, type ActivitiesTestDetail } from "@mtb/api";
import { formatDate, formatSession } from "@mtb/domain";
import { Banner, Button, ConfirmDialog, DataTable, EmptyState, IconButton, Input, Modal, Panel, Select, Skeleton, StatusBadge, Stepper, TabPanel, Tabs, Timeline, useToast, type Column } from "@mtb/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { campusLabel } from "../../app/shell/campus";
import { Page, PageHeader } from "../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { MeritListDoc } from "./print";
import { ActivitiesNav, AwardBadge, BarList, errorField, errorText, LoadError, plural, PrintLayer, StudentSearch, TestBadge, useRefresh, valueShort, ViewToggle } from "./shared";

export type TestTab = "merit" | "candidates" | "marks" | "history";

/** One scholarship test: candidates, marks, the automatic merit list and proposing awards from it. */
export function TestDetailPage({ id, tab, onTab }: { id: string; tab: TestTab | undefined; onTab: (t: TestTab) => void }) {
  const ctx = useCtx();
  const q = useQuery(activitiesQueries.test(ctx, id));
  const t = q.data;
  if (q.isLoading)
    return (
      <Page>
        <Skeleton width={320} height={32} />
        <ActivitiesNav />
        <Skeleton height={320} />
      </Page>
    );
  if (q.isError || !t)
    return (
      <Page>
        <PageHeader title="Scholarship test" />
        <ActivitiesNav />
        <LoadError what="This test" error={q.error} onRetry={() => void q.refetch()} />
      </Page>
    );
  const fallback: TestTab = t.status === "REGISTRATION" ? "candidates" : t.status === "MARKING" ? "marks" : "merit";
  return <TestView test={t} tab={tab ?? fallback} onTab={onTab} />;
}

function TestView({ test: t, tab, onTab }: { test: ActivitiesTestDetail; tab: TestTab; onTab: (t: TestTab) => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const readOnly = useReadOnly();
  const canManage = useCan("activities.manage") && !readOnly;
  const [confirm, setConfirm] = useState<"CLOSE_REGISTRATION" | "PUBLISH" | "REOPEN_MARKING" | null>(null);
  const [printing, setPrinting] = useState(false);
  const schemesQ = useQuery(activitiesQueries.schemes(useCtx()));
  const printHeads = schemesQ.data?.find((s) => s.id === t.schemeId)?.feeHeads;
  const action = useMutation({
    mutationFn: (a: "CLOSE_REGISTRATION" | "PUBLISH" | "REOPEN_MARKING") => activitiesApi.testAction(t.id, a),
    onSuccess: (x, a) => {
      refresh();
      setConfirm(null);
      toast({ title: a === "CLOSE_REGISTRATION" ? "Registration closed" : a === "PUBLISH" ? "Merit list published" : "Marking reopened", message: a === "PUBLISH" ? `${x.qualified} of ${x.candidateCount} reached ${x.passPercent}%.` : `${t.testNo} · ${t.title}` });
      onTab(a === "CLOSE_REGISTRATION" ? "marks" : a === "PUBLISH" ? "merit" : "marks");
    },
  });
  const steps = t.source === "EXAM" ? ["Declared result", "Merit list", "Awards proposed"] : ["Registration", "Marking", "Merit list", "Awards proposed"];
  const current = t.source === "EXAM" ? (t.status === "AWARDED" ? 2 : 1) : { REGISTRATION: 0, MARKING: 1, RESULT: 2, AWARDED: 3 }[t.status];
  const tabs = [
    { id: "merit", label: "Merit list", icon: "award" as const },
    ...(t.source === "DEDICATED" ? [{ id: "candidates", label: "Candidates", icon: "students" as const, count: t.candidateCount }] : []),
    { id: "marks", label: "Marks", icon: "edit" as const },
    { id: "history", label: "History", icon: "clock" as const },
  ];

  return (
    <Page>
      <PageHeader
        title={t.title}
        context={`${t.testNo} · ${campusLabel(t.campus)} · Session ${formatSession(t.session)}`}
        meta={
          <>
            <TestBadge status={t.status} />
            <StatusBadge status="neutral" dot={false}>
              {t.source === "EXAM" ? "From exam results" : "Dedicated test"}
            </StatusBadge>
          </>
        }
        actions={
          <>
            <Link to="/activities/tests" className="mtb-btn mtb-btn-ghost">
              All tests
            </Link>
            <Button icon="printer" onClick={() => setPrinting(true)} disabled={t.marked === 0}>
              Print merit list
            </Button>
            {canManage && t.status === "REGISTRATION" && (
              <Button variant="primary" onClick={() => setConfirm("CLOSE_REGISTRATION")} disabled={t.candidateCount === 0}>
                Close registration
              </Button>
            )}
            {canManage && t.status === "MARKING" && (
              <Button variant="primary" icon="award" onClick={() => setConfirm("PUBLISH")}>
                Publish merit list
              </Button>
            )}
            {canManage && t.status === "RESULT" && t.source === "DEDICATED" && t.proposed === 0 && <Button onClick={() => setConfirm("REOPEN_MARKING")}>Reopen marking</Button>}
          </>
        }
      />
      <ActivitiesNav />

      <Panel id="test-info" title="About this test" rise={0}>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <dl className="mtb-kv">
            <dt>Who</dt>
            <dd>{t.classLabel}</dd>
            <dt>{t.source === "EXAM" ? "Results from" : "Held on"}</dt>
            <dd>{t.source === "EXAM" ? t.examName : `${t.date ? formatDate(t.date) : "—"}${t.venue ? `, ${t.venue}` : ""}`}</dd>
            <dt>Papers</dt>
            <dd>
              {t.papers.map((p) => `${p.name} ${p.maxMarks}`).join(" · ")} = {t.maxMarks} marks
            </dd>
            <dt>Awards from</dt>
            <dd>
              {t.schemeName} · {t.seats === null ? "everyone who passes" : `${t.seats} seats`} · pass mark {t.passPercent}%
            </dd>
          </dl>
          <div className="grid content-start gap-3">
            <Stepper steps={steps} current={current} label="Test progress" />
            <p className="m-0 text-small text-ink-muted">
              {plural(t.candidateCount, "candidate")} · {t.marked} marked · {t.qualified} qualify · {plural(t.proposed, "award")} proposed
            </p>
          </div>
        </div>
      </Panel>

      <Tabs aria-label="Test sections" idPrefix="test-" value={tab} onChange={(v) => onTab(v as TestTab)} tabs={tabs} />
      <TabPanel id={tab} idPrefix="test-" active>
        {tab === "merit" && <MeritTab test={t} canManage={canManage} />}
        {tab === "candidates" && t.source === "DEDICATED" && <CandidatesTab test={t} canManage={canManage} />}
        {tab === "marks" && <MarksTab test={t} canManage={canManage} />}
        {tab === "history" && (
          <Panel id="test-history" title="History" rise={1}>
            <Timeline items={[...t.history].reverse().map((h) => ({ id: h.id, date: h.at.slice(0, 10), title: `${h.action} · ${h.by}`, description: h.detail }))} />
          </Panel>
        )}
      </TabPanel>

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && action.mutate(confirm)}
        title={confirm === "CLOSE_REGISTRATION" ? "Close registration?" : confirm === "PUBLISH" ? "Publish the merit list?" : "Reopen marking?"}
        message={
          confirm === "CLOSE_REGISTRATION"
            ? "No more candidates can be added. Marks can be entered next."
            : confirm === "PUBLISH"
              ? "Candidates are ranked by percentage; ties share a rank. Awards can then be proposed for those inside the seats."
              : "Marks can be changed again; the merit list goes back to provisional."
        }
        details={confirm === "PUBLISH" ? [["Candidates", String(t.candidateCount)], ["Marked", String(t.marked)]] : [["Candidates", String(t.candidateCount)]]}
        confirmLabel={confirm === "CLOSE_REGISTRATION" ? "Close registration" : confirm === "PUBLISH" ? "Publish merit list" : "Reopen marking"}
        loading={action.isPending}
        error={action.isError ? errorText(action.error) : undefined}
      />
      {printing && (
        <PrintLayer paper="A4" onDone={() => setPrinting(false)}>
          <MeritListDoc test={t} feeHeads={printHeads} />
        </PrintLayer>
      )}
    </Page>
  );
}

// ------------------------------------------------------------------ Merit list

const HEAD_ABBR: Record<ActivitiesFeeHead, string> = { TUITION: "Tuition", ANNUAL: "Annual", ADMISSION: "Admission" };

function MeritTab({ test: t, canManage }: { test: ActivitiesTestDetail; canManage: boolean }) {
  const ctx = useCtx();
  const toast = useToast();
  const refresh = useRefresh();
  const [selected, setSelected] = useState<Set<unknown>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [tried, setTried] = useState(false);
  const [view, setView] = useState<"chart" | "table">("table");
  const [round, setRound] = useState("1");
  // Award figures changed on the list before proposing: candidate id → % (or Rs), or a % per fee head.
  const [edits, setEdits] = useState<Record<string, { value?: string; values?: Partial<Record<ActivitiesFeeHead, string>> }>>({});
  const schemes = useQuery(activitiesQueries.schemes(ctx));
  const scheme = schemes.data?.find((s) => s.id === t.schemeId);
  const fixed = t.schemeBasis === "FIXED";
  const headsFor = (c: ActivitiesCandidate): ActivitiesFeeHead[] => (fixed || !scheme ? [] : c.isApplicant ? [...new Set([...scheme.feeHeads, "ADMISSION" as const])] : scheme.feeHeads);
  const ready = t.status === "RESULT" || t.status === "AWARDED";
  const rows = t.candidates;
  const picked = rows.filter((c) => selected.has(c.id));
  const editable = (c: ActivitiesCandidate) => canManage && ready && selected.has(c.id) && c.withinSeats && !c.awardId;
  const figureOf = (c: ActivitiesCandidate, head?: ActivitiesFeeHead) => {
    const e = edits[c.id];
    const raw = head ? (e?.values?.[head] ?? e?.value) : e?.value;
    return raw ?? String(c.suggestedValue ?? scheme?.value ?? "");
  };
  const problem = (raw: string): string | null => {
    const n = Number(raw);
    if (raw === "" || !Number.isFinite(n)) return fixed ? "Enter rupees." : "Enter a %.";
    if (fixed) return Number.isInteger(n) && n >= 100 ? null : "At least Rs 100.";
    return n >= 1 && n <= 100 ? null : "1 to 100.";
  };
  const errorsOf = (c: ActivitiesCandidate) => {
    const heads = headsFor(c);
    return heads.length > 1 ? heads.map((h) => problem(figureOf(c, h))).filter(Boolean) : [problem(figureOf(c))].filter(Boolean);
  };
  const hasErrors = picked.some((c) => errorsOf(c).length > 0);
  const overrides = (): Record<string, ActivitiesProposeOverride> => {
    const out: Record<string, ActivitiesProposeOverride> = {};
    for (const c of picked) {
      const heads = headsFor(c);
      if (heads.length > 1) {
        const values = Object.fromEntries(heads.map((h) => [h, Number(figureOf(c, h))])) as Partial<Record<ActivitiesFeeHead, number>>;
        const main = values.TUITION ?? values[heads[0]!]!;
        if (heads.some((h) => values[h] !== c.suggestedValue)) out[c.id] = { value: main, values };
      } else if (Number(figureOf(c)) !== c.suggestedValue) out[c.id] = { value: Number(figureOf(c)) };
    }
    return out;
  };
  const shown = (c: ActivitiesCandidate) => {
    const heads = headsFor(c);
    if (heads.length > 1) {
      const per = heads.map((h) => figureOf(c, h));
      return per.every((v) => v === per[0]) ? valueShort(t.schemeBasis, Number(per[0])) : heads.map((h, i) => `${per[i]}% ${HEAD_ABBR[h].toLowerCase()}`).join(", ");
    }
    return valueShort(t.schemeBasis, Number(figureOf(c)));
  };
  const propose = useMutation({
    mutationFn: () => activitiesApi.proposeFromTest(t.id, picked.map((c) => c.id), overrides(), Number(round)),
    onSuccess: () => {
      refresh();
      setConfirm(false);
      setSelected(new Set());
      setEdits({});
      setTried(false);
      toast({ title: `${plural(picked.length, "award")} proposed`, message: "They now wait for the principal's or admin's approval in Scholarships." });
    },
  });
  const bands = [
    { key: "90", label: "90% and above", value: rows.filter((c) => (c.percent ?? -1) >= 90).length },
    { key: "80", label: "80–89%", value: rows.filter((c) => (c.percent ?? -1) >= 80 && (c.percent ?? 0) < 90).length },
    { key: "70", label: "70–79%", value: rows.filter((c) => (c.percent ?? -1) >= 70 && (c.percent ?? 0) < 80).length },
    { key: "60", label: "60–69%", value: rows.filter((c) => (c.percent ?? -1) >= 60 && (c.percent ?? 0) < 70).length },
    { key: "0", label: "Below 60%", value: rows.filter((c) => c.percent !== null && c.percent < 60).length },
  ];

  const columns: Array<Column<ActivitiesCandidate>> = [
    { key: "rank", header: "Rank", align: "right", width: 70, render: (c) => <span className="mtb-num font-semibold">{c.rank ?? "—"}</span> },
    {
      key: "name",
      header: "Candidate",
      render: (c) => (
        <span className="grid">
          <span className="mtb-cell-primary">{c.name}</span>
          <span className="mtb-cell-secondary">
            {c.isApplicant ? `Applicant · ${c.previousSchool ?? ""}` : <span className="mtb-num">{c.id}</span>} · {c.classSection}
          </span>
        </span>
      ),
    },
    { key: "marks", header: "Marks", align: "right", width: 110, render: (c) => <span className="mtb-num">{c.percent === null ? "—" : `${c.obtained} / ${t.maxMarks}`}</span> },
    { key: "pct", header: "%", align: "right", width: 80, render: (c) => <span className="mtb-num">{c.percent === null ? "—" : c.percent.toFixed(1)}</span> },
    {
      key: "result",
      header: "Result",
      width: 160,
      render: (c) =>
        c.percent === null ? (
          <StatusBadge status="neutral">Marks missing</StatusBadge>
        ) : c.withinSeats ? (
          <StatusBadge status="success">Selected</StatusBadge>
        ) : c.qualifies ? (
          <StatusBadge status="info">Waiting list</StatusBadge>
        ) : (
          <StatusBadge status="neutral" dot={false}>
            Below {t.passPercent}%
          </StatusBadge>
        ),
    },
    { key: "suggest", header: "Suggested award", width: 150, render: (c) => (c.withinSeats && c.suggestedValue !== null ? valueShort(t.schemeBasis, c.suggestedValue) : "—") },
    {
      key: "award",
      header: "Award",
      width: 220,
      render: (c) =>
        editable(c) ? (
          <span className="flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
            {(headsFor(c).length > 1 ? headsFor(c) : [undefined]).map((h) => {
              const raw = figureOf(c, h);
              const bad = tried ? problem(raw) : null;
              return (
                <span key={h ?? "one"} className={h ? "w-[92px]" : "w-[110px]"}>
                  <Input
                    aria-label={`${c.name}: ${h ? `% off ${HEAD_ABBR[h].toLowerCase()}` : fixed ? "rupees a month" : "% off"}`}
                    title={h ? HEAD_ABBR[h] : undefined}
                    inputMode="numeric"
                    amount
                    {...(fixed ? { prefix: "Rs" } : { suffix: h ? `% ${HEAD_ABBR[h].slice(0, 3)}` : "%" })}
                    value={raw}
                    onChange={(e) => {
                      const v = e.target.value.replace(fixed ? /\D/g : /[^\d.]/g, "");
                      setEdits((x) => ({ ...x, [c.id]: h ? { ...x[c.id], values: { ...x[c.id]?.values, [h]: v } } : { ...x[c.id], value: v } }));
                    }}
                    {...(bad ? { error: bad } : {})}
                  />
                </span>
              );
            })}
          </span>
        ) : c.awardId && c.awardStatus ? (
          <Link to="/activities/scholarships" search={((prev: Record<string, unknown>) => ({ ...prev, award: c.awardId })) as never} className="inline-flex">
            <AwardBadge status={c.awardStatus} />
          </Link>
        ) : (
          <span className="text-ink-subtle">—</span>
        ),
    },
  ];

  return (
    <Panel
      id="merit"
      title={ready ? "Merit list" : "Merit list (provisional)"}
      description={`Ranked by percentage; equal percentages share a rank. ${t.tiedAtCutOff > 0 ? `${plural(t.tiedAtCutOff, "extra candidate")} included because of a tie at the cut-off.` : ""}`}
      rise={1}
      flush={view === "table"}
      actions={<ViewToggle value={view} onChange={setView} label="Merit list view" />}
    >
      {!ready && (
        <div className="p-4 pb-0">
          <Banner tone="info">Marks are still coming in. Awards can be proposed once the merit list is published.</Banner>
        </div>
      )}
      {view === "chart" ? (
        <div className="grid gap-3">
          <BarList label="Candidates by percentage" format={(v) => `${v}`} rows={bands} />
          <p className="m-0 text-small text-ink-muted">
            Pass mark {t.passPercent}% · {t.qualified} of {t.marked} marked candidates qualify
          </p>
        </div>
      ) : (
        <DataTable
          caption={`Merit list, ${t.title}`}
          columns={columns}
          rows={rows}
          density="dense"
          selectable={canManage && ready}
          selected={selected}
          onSelectedChange={setSelected}
          isRowSelectable={(c) => c.withinSeats && !c.awardId}
          rowClassName={(c) => (c.withinSeats ? undefined : "text-ink-muted")}
          toolbar={
            canManage && ready ? (
              <>
                <span className="text-small text-ink-muted">{selected.size ? `${selected.size} ticked · change the award in the row if needed` : "Tick students inside the seats to propose their awards."}</span>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="w-32">
                    <Select
                      aria-label="List"
                      value={round}
                      onChange={(e) => setRound(e.target.value)}
                      options={[
                        { value: "1", label: "1st list" },
                        { value: "2", label: "2nd list" },
                        { value: "3", label: "3rd list" },
                      ]}
                    />
                  </span>
                  <Button
                    variant="primary"
                    icon="award"
                    disabled={picked.length === 0}
                    onClick={() => {
                      setTried(true);
                      if (!hasErrors) setConfirm(true);
                    }}
                  >
                    Propose {picked.length ? plural(picked.length, "award") : "awards"}
                  </Button>
                </span>
              </>
            ) : undefined
          }
          empty={<EmptyState icon="listChecks" title="No candidates yet" description="Register candidates, enter marks and publish the list." />}
        />
      )}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => propose.mutate()}
        title={`Propose ${plural(picked.length, "award")} (${["", "1st", "2nd", "3rd"][Number(round)]} list)?`}
        message="Each award goes to the principal or admin for approval. Fee relief starts from next month's voucher once approved."
        details={picked.map((c) => [c.name, `${c.rank ? `Rank ${c.rank} · ` : ""}${shown(c)}`] as [string, string])}
        confirmLabel={`Propose ${plural(picked.length, "award")}`}
        loading={propose.isPending}
        error={propose.isError ? errorText(propose.error) : undefined}
      />
    </Panel>
  );
}

// ------------------------------------------------------------------ Candidates (dedicated tests)

const applicantSchema = z.object({
  name: z.string().trim().min(3, "Enter the applicant's full name."),
  father: z.string().trim().min(3, "Enter the father's name."),
  previousSchool: z.string().trim().min(3, "Enter the school they come from."),
  mobile: z.string().regex(/^03\d{2}-?\d{7}$/, "Enter an 11-digit mobile number, for example 0300-1234567."),
});

function CandidatesTab({ test: t, canManage }: { test: ActivitiesTestDetail; canManage: boolean }) {
  const toast = useToast();
  const refresh = useRefresh();
  const open = t.status === "REGISTRATION" && canManage;
  const [applicant, setApplicant] = useState(false);
  const [form, setForm] = useState({ name: "", father: "", previousSchool: "", mobile: "" });
  const [tried, setTried] = useState(false);
  const add = useMutation({
    mutationFn: (body: Parameters<typeof activitiesApi.addCandidate>[1]) => activitiesApi.addCandidate(t.id, body),
    onSuccess: (x) => {
      refresh();
      setApplicant(false);
      const c = x.candidates.find((y) => !t.candidates.some((z) => z.id === y.id));
      toast({ title: "Candidate registered", message: c ? `${c.name} · ${c.classSection}` : undefined });
    },
  });
  const remove = useMutation({ mutationFn: (cid: string) => activitiesApi.removeCandidate(t.id, cid), onSuccess: () => refresh() });
  const check = applicantSchema.safeParse(form);
  const errs: Record<string, string> = check.success ? {} : Object.fromEntries(check.error.issues.map((i) => [String(i.path[0]), i.message]));
  const sf = add.isError ? errorField(add.error) : undefined;

  const columns: Array<Column<ActivitiesCandidate>> = [
    { key: "roll", header: "Roll no.", align: "right", width: 80, render: (c) => <span className="mtb-num">{c.rollNo}</span> },
    {
      key: "name",
      header: "Candidate",
      render: (c) => (
        <span className="grid">
          <span className="mtb-cell-primary">{c.name}</span>
          <span className="mtb-cell-secondary">
            {c.father} · {c.isApplicant ? `from ${c.previousSchool}` : <span className="mtb-num">{c.id}</span>}
          </span>
        </span>
      ),
    },
    { key: "class", header: "Class", width: 180, render: (c) => c.classSection },
    { key: "kind", header: "", width: 120, render: (c) => (c.isApplicant ? <StatusBadge status="info">Applicant</StatusBadge> : <StatusBadge status="neutral">Student</StatusBadge>) },
    ...(open ? [{ key: "x", header: "", width: 56, render: (c: ActivitiesCandidate) => <IconButton icon="trash" label={`Remove ${c.name}`} onClick={() => remove.mutate(c.id)} disabled={remove.isPending} /> }] : []),
  ];

  return (
    <div className="grid gap-6">
      {open && (
        <Panel id="register" title="Register candidates" description="Current students by search; applicants from other schools with their details." rise={1}>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
            <StudentSearch label="Add a student" onPick={(p) => add.mutate({ studentId: p.id })} exclude={new Set(t.candidates.map((c) => c.id))} error={add.isError && sf === "studentId" ? errorText(add.error) : undefined} />
            <Button
              icon="plus"
              className="md:mt-6"
              onClick={() => {
                setTried(false);
                add.reset();
                setForm({ name: "", father: "", previousSchool: "", mobile: "" });
                setApplicant(true);
              }}
            >
              Add an applicant
            </Button>
          </div>
          {add.isError && !sf && <Banner tone="danger">{errorText(add.error)}</Banner>}
        </Panel>
      )}
      {t.status !== "REGISTRATION" && <Banner tone="neutral">Registration is closed: {plural(t.candidateCount, "candidate")} sat the test.</Banner>}
      <DataTable caption="Candidates" columns={columns} rows={[...t.candidates].sort((a, b) => a.rollNo - b.rollNo)} density="dense" empty={<EmptyState icon="students" title="No candidates yet" description="Register students and applicants before the test day." />} />
      <Modal
        open={applicant}
        onClose={() => setApplicant(false)}
        title="Add an applicant"
        description="Someone from another school sitting the test. If they win an award it applies once they are admitted."
        footer={
          <>
            <Button onClick={() => setApplicant(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={add.isPending}
              onClick={() => {
                setTried(true);
                if (check.success) add.mutate({ applicant: form });
              }}
            >
              Register applicant
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Input label="Full name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={(tried ? errs.name : undefined) ?? (sf === "name" ? errorText(add.error) : undefined)} />
          <Input label="Father's name" required value={form.father} onChange={(e) => setForm({ ...form, father: e.target.value })} error={(tried ? errs.father : undefined) ?? (sf === "father" ? errorText(add.error) : undefined)} />
          <Input label="Present school" required value={form.previousSchool} onChange={(e) => setForm({ ...form, previousSchool: e.target.value })} error={(tried ? errs.previousSchool : undefined) ?? (sf === "previousSchool" ? errorText(add.error) : undefined)} />
          <Input label="Parent's mobile" required inputMode="tel" placeholder="0300-1234567" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} error={(tried ? errs.mobile : undefined) ?? (sf === "mobile" ? errorText(add.error) : undefined)} />
        </div>
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------ Marks

function MarksTab({ test: t, canManage }: { test: ActivitiesTestDetail; canManage: boolean }) {
  const toast = useToast();
  const refresh = useRefresh();
  const editable = canManage && t.source === "DEDICATED" && t.status === "MARKING";
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});
  const save = useMutation({
    mutationFn: () => {
      const marks: Record<string, Record<string, ActivitiesMark>> = {};
      for (const [cid, row] of Object.entries(draft)) marks[cid] = Object.fromEntries(Object.entries(row).map(([pid, v]) => [pid, v === "" ? null : v.toUpperCase() === "A" ? "A" : Number(v)]));
      return activitiesApi.saveTestMarks(t.id, marks);
    },
    onSuccess: (x) => {
      refresh();
      setDraft({});
      toast({ title: "Marks saved", message: `${x.marked} of ${x.candidateCount} candidates complete.` });
    },
  });
  const valueOf = (c: ActivitiesCandidate, pid: string) => draft[c.id]?.[pid] ?? (c.marks[pid] === null || c.marks[pid] === undefined ? "" : String(c.marks[pid]));
  const invalid = (v: string, max: number) => v !== "" && v.toUpperCase() !== "A" && !(/^\d+$/.test(v) && Number(v) <= max);
  const bad = t.candidates.some((c) => t.papers.some((p) => invalid(valueOf(c, p.id), p.maxMarks)));
  const dirty = Object.keys(draft).length > 0;
  const total = (c: ActivitiesCandidate) => t.papers.reduce((s, p) => s + (Number(valueOf(c, p.id)) || 0), 0);
  const rows = [...t.candidates].sort((a, b) => a.rollNo - b.rollNo || a.name.localeCompare(b.name));

  return (
    <Panel
      id="marks"
      title="Marks"
      description={t.source === "EXAM" ? `From ${t.examName}. Change marks in Exams; the merit list updates by itself.` : editable ? "Type marks; A for absent. Totals update as you type. Save, then publish the merit list." : "Read-only."}
      rise={1}
      actions={
        editable ? (
          <Button variant="primary" icon="check" disabled={!dirty || bad} loading={save.isPending} onClick={() => save.mutate()}>
            Save marks
          </Button>
        ) : undefined
      }
    >
      <div className="grid gap-3">
        {bad && <Banner tone="danger">Some marks are above the paper's maximum or not a number. Fix the red boxes, then save.</Banner>}
        {save.isError && <Banner tone="danger">{errorText(save.error)}</Banner>}
        <div className="act-grid-wrap">
          <table className="act-grid">
            <thead>
              <tr>
                <th className="n">Roll</th>
                <th>Candidate</th>
                {t.papers.map((p) => (
                  <th key={p.id} className="n">
                    {p.name}
                    <br />
                    <span className="font-normal">/ {p.maxMarks}</span>
                  </th>
                ))}
                <th className="n">Total</th>
                <th className="n">%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="n">{c.rollNo}</td>
                  <td>
                    <span className="grid">
                      <span className="font-medium">{c.name}</span>
                      <span className="text-small text-ink-muted">{c.classSection}</span>
                    </span>
                  </td>
                  {t.papers.map((p) => {
                    const v = valueOf(c, p.id);
                    return (
                      <td key={p.id} className="n">
                        {editable ? (
                          <input
                            className={`act-cell${invalid(v, p.maxMarks) ? " is-invalid" : v === "" ? " is-missing" : ""}`}
                            inputMode="numeric"
                            aria-label={`${c.name}, ${p.name}, out of ${p.maxMarks}`}
                            aria-invalid={invalid(v, p.maxMarks) || undefined}
                            value={v}
                            onChange={(e) => setDraft((d) => ({ ...d, [c.id]: { ...d[c.id], [p.id]: e.target.value.replace(/[^\daA]/g, "").slice(0, 3) } }))}
                          />
                        ) : (
                          <span className="mtb-num">{v === "" ? "—" : v.toUpperCase() === "A" ? "Abs" : v}</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="n font-semibold">{total(c)}</td>
                  <td className="n">{t.maxMarks ? ((total(c) / t.maxMarks) * 100).toFixed(1) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {t.candidates.length === 0 && <EmptyState icon="edit" title="No candidates" description="Register candidates first." />}
        {!editable && t.source === "DEDICATED" && t.status === "REGISTRATION" && <p className="m-0 text-small text-ink-muted">Close registration to start entering marks.</p>}
      </div>
    </Panel>
  );
}

