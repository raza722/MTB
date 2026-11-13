import { HR_CATEGORY_LABEL, HR_INCREMENT_METHOD_LABEL, hrApi, hrQueries, newIdempotencyKey, type CampusCode, type HrCategory, type HrIncrementLine, type HrIncrementMethod, type HrIncrementRun } from "@mtb/api";
import { formatCount, formatDate, formatDateTime, formatPercent, formatRs, formatSession } from "@mtb/domain";
import { AmountInput, AnimatedNumber, Banner, Button, Checkbox, ColumnChart, ConfirmDialog, DataTable, DatePicker, EmptyState, Input, Panel, Segmented, Select, SidePanel, Skeleton, StatCard, Textarea, Timeline, useToast, type Column } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { z } from "zod";
import { campusLabel } from "../../app/shell/campus";
import { RequirePermission } from "../../app/shell/page";
import { useCan, useCtx, useReadOnly, useSessionUser } from "../../app/session";
import { ReportDoc } from "./print";
import { issues, useHrSettings } from "./StaffPanels";
import { addMonths, basicRs, campusHeading, errorField, errorText, filterNote, HrShell, LoadError, monthEnd, RunBadge, slide, thisMonth, today, usePayAccess, usePrint, years } from "./shared";

/* ---------------------------------------------------------------- New run */

function NewRunPanel({ campus, onClose, onCreated }: { campus: CampusCode; onClose: () => void; onCreated: (id: string) => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const settings = useHrSettings();
  const [title, setTitle] = useState(`Annual increment ${formatSession(ctx.session)}`);
  const [method, setMethod] = useState<HrIncrementMethod>("CRITERIA");
  const [value, setValue] = useState("5");
  const [category, setCategory] = useState<HrCategory | "">("");
  const [designationId, setDesignation] = useState("");
  const [payScale, setPayScale] = useState("");
  const [level, setLevel] = useState("");
  // Service counted to the end of this month; new salaries from the 1st of a coming month (or this month's 1st).
  const [asOf, setAsOf] = useState<string | null>(() => monthEnd(thisMonth()));
  const [from, setFrom] = useState(() => `${addMonths(thisMonth(), 1)}-01`);
  const [tried, setTried] = useState(false);
  const schema = z.object({
    title: z.string().trim().min(3, "Give the run a name."),
    value: method === "PERCENT" ? z.coerce.number({ error: "Enter a percentage." }).min(0.5, "At least 0.5%.").max(30, "At most 30%.") : method === "FIXED" ? z.coerce.number({ error: "Enter an amount." }).int("Whole rupees.").min(100, "At least Rs 100.").max(50000, "At most Rs 50,000.") : z.any(),
    asOf: z.string({ error: "Enter the date service is counted to." }).min(1, "Enter the date service is counted to."),
  });
  const values = { title, value, asOf: asOf ?? "" };
  const parsed = schema.safeParse(values);
  const errors = issues(parsed);
  const key = useMemo(() => newIdempotencyKey(), [JSON.stringify(values), method, category, designationId, payScale, level, from]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: () => hrApi.createIncrement({ campus, session: ctx.session, title: title.trim(), method, value: method === "CRITERIA" ? null : Number(value), filter: { category: category || null, designationId: designationId || null, payScale: payScale || null, teachingLevel: level || null }, experienceAsOf: asOf!, effectiveFrom: from }, key),
    onSuccess: (r) => {
      toast({ title: "Increment run prepared", message: `${r.staff} staff · ${formatRs(r.monthlyIncrease)} more a month. Nothing changes until it is approved.` });
      void queryClient.invalidateQueries({ queryKey: ["hr"] });
      onCreated(r.id);
    },
  });
  const sf = errorField(save.error);
  const err = (k: string) => (tried ? (errors[k] ?? (sf === k ? errorText(save.error) : undefined)) : undefined);
  const months = [1, 2, 3, 4, 0].map((n) => `${addMonths(thisMonth(), n)}-01`);
  return (
    <SidePanel
      open
      onClose={onClose}
      title="New increment run"
      description={`${campusLabel(campus)} · a preview: salaries change only after approval`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon="check"
            loading={save.isPending}
            loadingLabel="Working out…"
            onClick={() => {
              setTried(true);
              if (parsed.success) save.mutate();
            }}
          >
            Work out the increments
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Input label="Name" required value={title} onChange={(e) => setTitle(e.target.value)} error={err("title")} />
        <div className="grid gap-2">
          <span className="text-small font-medium">How the increase is worked out</span>
          <Segmented aria-label="Method" value={method} onChange={(v) => setMethod(v as HrIncrementMethod)} options={[{ value: "CRITERIA", label: "Scale and service" }, { value: "PERCENT", label: "% of basic" }, { value: "FIXED", label: "Fixed amount" }]} />
          <span className="text-small text-ink-muted">
            {method === "CRITERIA" ? "Each person gets the amount for their pay scale and years of service from the increment table (Settings)." : method === "PERCENT" ? "Everyone included gets the same percentage of their basic pay." : "Everyone included gets the same rupee amount, including staff without a pay scale."}
          </span>
        </div>
        {method !== "CRITERIA" && <Input label={method === "PERCENT" ? "Percentage" : "Amount a month"} required inputMode="decimal" suffix={method === "PERCENT" ? "%" : undefined} prefix={method === "FIXED" ? "Rs" : undefined} value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))} error={err("value")} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Kind of staff" value={category} onChange={(e) => setCategory(e.target.value as HrCategory | "")} options={[{ value: "", label: "Everyone" }, ...(Object.keys(HR_CATEGORY_LABEL) as HrCategory[]).map((c) => ({ value: c, label: HR_CATEGORY_LABEL[c] }))]} />
          <Select label="Level taught" value={level} onChange={(e) => setLevel(e.target.value)} options={[{ value: "", label: "Every level" }, ...(settings.data?.teachingLevels ?? []).map((l) => ({ value: l, label: l }))]} help={level ? "Only staff who teach this level." : undefined} error={err("teachingLevel")} />
          <Select label="Designation" value={designationId} onChange={(e) => setDesignation(e.target.value)} options={[{ value: "", label: "Every designation" }, ...(settings.data?.designations ?? []).filter((d) => d.active).map((d) => ({ value: d.id, label: d.title }))]} />
          <Select label="Pay scale" value={payScale} onChange={(e) => setPayScale(e.target.value)} options={[{ value: "", label: "Every scale" }, ...(settings.data?.payScales ?? []).map((s) => ({ value: s, label: `Scale ${s}` }))]} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <DatePicker label="Count service up to" required value={asOf} onValueChange={setAsOf} today={today()} error={err("asOf") ?? err("experienceAsOf")} help="Less than a year by then: left out." />
          <Select label="New salaries from" value={from} onChange={(e) => setFrom(e.target.value)} options={months.map((m) => ({ value: m, label: formatDate(m) }))} error={err("effectiveFrom")} />
        </div>
        {save.error && !sf && <Banner tone="danger">{errorText(save.error)}</Banner>}
        {save.error && sf && !["title", "value", "experienceAsOf", "effectiveFrom", "teachingLevel"].includes(sf) && <Banner tone="danger">{errorText(save.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

/* ---------------------------------------------------------------- Adjust one line */

function LinePanel({ run, line, onClose }: { run: HrIncrementRun; line: HrIncrementLine; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [n, setN] = useState(String(line.increments));
  const [special, setSpecial] = useState<number | null>(line.special);
  const [included, setIncluded] = useState(line.included);
  const save = useMutation({
    mutationFn: () => hrApi.updateIncrementLine(run.id, line.staffId, { increments: Number(n), special: special ?? 0, included }),
    onSuccess: (r) => {
      queryClient.setQueryData(hrQueries.increment(run.id).queryKey, r);
      void queryClient.invalidateQueries({ queryKey: ["hr"] });
      onClose();
    },
  });
  const increase = included ? line.perIncrement * Number(n) + (special ?? 0) : 0;
  return (
    <SidePanel
      open
      onClose={onClose}
      title={line.name}
      description={`${line.employeeNo} · ${line.designation}${line.payScale ? ` · scale ${line.payScale}` : ""} · ${years(line.serviceYears)}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="check" loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {line.note && <Banner tone="info">{line.note}</Banner>}
        <Checkbox label="Include in this run" checked={included} onChange={(e) => setIncluded(e.target.checked)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Number of increments" value={n} onChange={(e) => setN(e.target.value)} options={["0", "1", "2", "3"]} help={`${formatRs(line.perIncrement)} each`} />
          <AmountInput label="Special increment" value={special} onValueChange={setSpecial} help="One-off amount on top, for merit or a promotion." />
        </div>
        <div className="rounded-md border border-border bg-surface-sunken p-4 text-small">
          {basicRs(line.currentBasic)} + {formatRs(line.perIncrement)} × {n} + {formatRs(special ?? 0)} = <span className="font-semibold">{formatRs(line.currentBasic + increase)}</span> from {formatDate(run.effectiveFrom)}
        </div>
        {save.error && <Banner tone="danger">{errorText(save.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

/* ---------------------------------------------------------------- Page */

export function IncrementsPage({ runId, setRunId }: { runId: string | undefined; setRunId: (id: string | undefined) => void }) {
  const ctx = useCtx();
  const user = useSessionUser();
  const readOnly = useReadOnly();
  const payAccess = usePayAccess();
  const canPrepare = useCan("payroll.manage");
  const canDecide = useCan("approvals.decide");
  const toast = useToast();
  const queryClient = useQueryClient();
  const list = useQuery({ ...hrQueries.increments(ctx), enabled: payAccess });
  const runs = list.data?.runs ?? [];
  const selected = runId && runs.some((r) => r.id === runId) ? runId : runs[0]?.id;
  const run = useQuery(hrQueries.increment(selected ?? ""));
  const { print, area } = usePrint();
  const [creating, setCreating] = useState(false);
  const [line, setLine] = useState<HrIncrementLine | null>(null);
  const [show, setShow] = useState<"included" | "excluded">("included");
  const [confirm, setConfirm] = useState<null | "approve" | "return" | "delete" | "submit" | "bulk">(null);
  const [note, setNote] = useState("");
  const [bulkN, setBulkN] = useState("");
  const [bulkSpecial, setBulkSpecial] = useState<number | null>(null);
  const [bulkTried, setBulkTried] = useState(false);
  const settings = useHrSettings();
  const r = run.data;
  const covers = r
    ? filterNote([
        r.filter.teachingLevel && `Level ${r.filter.teachingLevel}`,
        r.filter.category && HR_CATEGORY_LABEL[r.filter.category],
        r.filter.designationId && (settings.data?.designations.find((d) => d.id === r.filter.designationId)?.title ?? ""),
        r.filter.payScale && `Scale ${r.filter.payScale}`,
      ]) || "Everyone"
    : "";
  const bulkSchema = z
    .object({ n: z.string(), special: z.number().int("Whole rupees.").min(0).max(50000, "At most Rs 50,000.").nullable() })
    .refine((v) => v.n !== "" || v.special !== null, { path: ["n"], message: "Choose a number of increments or enter a special increment." });
  const bulkParsed = bulkSchema.safeParse({ n: bulkN, special: bulkSpecial });
  const bulkErrors = issues(bulkParsed);
  const bulk = useMutation({
    mutationFn: () => hrApi.updateIncrementLines(r!.id, { ...(bulkN ? { increments: Number(bulkN) } : {}), ...(bulkSpecial !== null ? { special: bulkSpecial } : {}) }),
    onSuccess: (x) => {
      queryClient.setQueryData(hrQueries.increment(x.id).queryKey, x);
      setBulkN("");
      setBulkSpecial(null);
      setBulkTried(false);
      done("Changed for everyone included", `${x.staff} staff · ${formatRs(x.totals.monthlyIncrease)} more a month`);
    },
  });
  const done = (title: string, message?: string) => {
    toast({ title, ...(message ? { message } : {}) });
    setConfirm(null);
    setNote("");
    void queryClient.invalidateQueries({ queryKey: ["hr"] });
  };
  const submit = useMutation({ mutationFn: () => hrApi.submitIncrement(r!.id), onSuccess: () => done("Sent for approval", "The principal approves increments.") });
  const decide = useMutation({ mutationFn: (approve: boolean) => hrApi.decideIncrement(r!.id, { approve, note }), onSuccess: (x) => done(x.status === "APPROVED" ? `${x.title} approved` : "Returned for changes", x.status === "APPROVED" ? `${x.staff} salaries change from ${formatDate(x.effectiveFrom)}.` : undefined) });
  const remove = useMutation({
    mutationFn: () => hrApi.deleteIncrement(r!.id),
    onSuccess: () => {
      setRunId(undefined);
      done("Draft deleted");
    },
  });
  const actionError = submit.error ?? decide.error ?? remove.error;

  const byScale = useMemo(() => {
    const m = new Map<string, { scale: string; staff: number; increase: number }>();
    for (const l of r?.lines.filter((x) => x.included) ?? []) {
      const k = l.payScale ?? "—";
      const x = m.get(k) ?? { scale: k, staff: 0, increase: 0 };
      x.staff++;
      x.increase += l.increase;
      m.set(k, x);
    }
    return [...m.values()].sort((a, b) => a.scale.localeCompare(b.scale));
  }, [r]);

  const editable = r?.status === "DRAFT" && canPrepare && !readOnly;
  const columns: Array<Column<HrIncrementLine>> = [
    { key: "name", header: "Staff", render: (l) => <span className="grid"><span className="font-medium">{l.name}</span><span className="text-small text-ink-muted">{l.employeeNo} · {l.designation}</span></span> },
    { key: "scale", header: "Scale", render: (l) => l.payScale ?? "—" },
    { key: "service", header: "Service", align: "right", render: (l) => <span className="mtb-num">{years(l.serviceYears)}</span> },
    { key: "current", header: "Basic now", align: "right", render: (l) => <span className="mtb-num">{basicRs(l.currentBasic)}</span> },
    { key: "per", header: "Increment", align: "right", render: (l) => <span className="mtb-num">{l.included ? `${formatRs(l.perIncrement)}${l.increments > 1 ? ` × ${l.increments}` : ""}${l.special ? ` + ${formatRs(l.special)}` : ""}` : "—"}</span> },
    { key: "new", header: "New basic", align: "right", render: (l) => <span className="mtb-num font-medium">{basicRs(l.newBasic)}</span> },
    { key: "pct", header: "Rise", align: "right", render: (l) => <span className="mtb-num text-small">{l.included ? (l.currentBasic ? formatPercent(l.percent) : "—") : ""}</span> },
    ...(show === "excluded" ? [{ key: "note", header: "Why left out", render: (l: HrIncrementLine) => <span className="text-small text-ink-muted">{l.note}</span> }] : []),
  ];

  if (!payAccess)
    return (
      <RequirePermission permission="payroll.manage" page="Increments">
        <span />
      </RequirePermission>
    );

  return (
    <RequirePermission permission="hr.view" page="Increments">
      <HrShell
        title="Increments"
        actions={
          canPrepare &&
          !readOnly &&
          ctx.campus !== "ALL" && (
            <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
              New increment run
            </Button>
          )
        }
      >
        {list.isError && <LoadError what="Increment runs" error={list.error} onRetry={() => void list.refetch()} />}
        <Banner tone="info" title="Prepared, then approved, then applied: once a year per person.">
          A run works out each new salary from the pay scale and years of service (or a % or fixed amount). Nothing changes until the principal approves it; then the new basic pay starts on the date set and shows in each salary history. A person can only get one annual increment a session.
        </Banner>
        <div className="grid items-start gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
          <Panel id="runs" title={`Runs · ${formatSession(ctx.session)}`} rise={0} flush>
            {list.isLoading ? (
              <div className="p-4">
                <Skeleton height={120} />
              </div>
            ) : runs.length === 0 ? (
              <EmptyState icon="trendUp" title="No increment runs this session" description={canPrepare && !readOnly ? "Prepare one to see the new salaries before approving." : undefined} />
            ) : (
              <ul className="m-0 grid list-none gap-1 p-2">
                {runs.map((x, i) => (
                  <li key={x.id} className="mtb-slide-in" style={slide(i)}>
                    <button type="button" onClick={() => setRunId(x.id)} aria-current={x.id === selected ? "true" : undefined} className={`grid w-full gap-1 rounded-md px-3 py-2 text-left ${x.id === selected ? "bg-brand-tint" : "hover:bg-surface-hover"}`}>
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-medium">{x.title}</span>
                      </span>
                      <span className="text-small text-ink-muted">
                        {ctx.campus === "ALL" ? `${x.campusName} · ` : ""}
                        {x.staff} staff · +{formatRs(x.monthlyIncrease)} a month
                      </span>
                      <RunBadge status={x.status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {!selected ? (
            <div />
          ) : !r ? (
            <Skeleton height={400} />
          ) : (
            <div className="grid gap-6">
              <section className="mtb-card mtb-rise grid gap-4 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="grid gap-1">
                    <span className="text-title-2">{r.title}</span>
                    <span className="text-small text-ink-muted">
                      {r.campusName} · {HR_INCREMENT_METHOD_LABEL[r.method]}
                      {r.method === "PERCENT" ? ` (${r.value}%)` : r.method === "FIXED" ? ` (${formatRs(r.value ?? 0)})` : ""} · {covers} · service counted to {formatDate(r.experienceAsOf)} · new salaries from {formatDate(r.effectiveFrom)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      icon="printer"
                      onClick={() =>
                        print(
                          <ReportDoc
                            campus={campusHeading(r.campus)}
                            title={`Staff salary increment · ${r.title}`}
                            sub={filterNote([`Session ${formatSession(r.session)}`, covers, `service counted to ${formatDate(r.experienceAsOf)}`, `${HR_INCREMENT_METHOD_LABEL[r.method]}${r.method === "PERCENT" ? ` (${r.value}%)` : r.method === "FIXED" ? ` (${formatRs(r.value ?? 0)})` : ""}`, `new salaries from ${formatDate(r.effectiveFrom)}`, `prepared ${formatDate(r.preparedAt.slice(0, 10))}`, r.status === "APPROVED" ? `approved by ${r.decidedBy}` : "not approved yet"])}
                            small
                            head={["#", "Emp. no", "Name", "Scale", "Service", "Basic now", "Increment", "No.", "Annual × no.", "Special", "Total", "New basic"]}
                            numeric={[4, 5, 6, 7, 8, 9, 10, 11]}
                            rows={r.lines.filter((l) => l.included).map((l, i) => [i + 1, l.employeeNo, l.name, l.payScale ?? "", l.serviceYears.toFixed(1), basicRs(l.currentBasic), formatRs(l.perIncrement), l.increments, formatRs(l.perIncrement * l.increments), l.special ? formatRs(l.special) : "", formatRs(l.increase), basicRs(l.newBasic)])}
                            total={["", "", "Total", "", "", formatRs(r.totals.currentBasic), "", "", formatRs(r.lines.filter((l) => l.included).reduce((a, l) => a + l.perIncrement * l.increments, 0)), formatRs(r.lines.filter((l) => l.included).reduce((a, l) => a + l.special, 0)), formatRs(r.totals.monthlyIncrease), formatRs(r.totals.newBasic)]}
                            signatures={["Prepared by (Accountant)", "Checked by", "Approved by (Principal)"]}
                          />,
                          "A4L",
                        )
                      }
                    >
                      Print
                    </Button>
                    {r.status === "DRAFT" && canPrepare && !readOnly && (
                      <>
                        <Button variant="danger-quiet" icon="trash" onClick={() => setConfirm("delete")}>
                          Delete draft
                        </Button>
                        <Button variant="primary" icon="send" onClick={() => setConfirm("submit")}>
                          Send for approval
                        </Button>
                      </>
                    )}
                    {r.status === "PENDING" && canDecide && !readOnly && (
                      <>
                        <Button variant="danger-quiet" onClick={() => setConfirm("return")}>
                          Return for changes
                        </Button>
                        <Button variant="primary" icon="check" onClick={() => setConfirm("approve")} disabled={r.preparedBy === user?.name}>
                          Approve
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                <div className="hr-steps" aria-label="Progress">
                  <span className={`hr-step ${r.status === "DRAFT" ? "is-now" : "is-done"}`}>1 · Prepared by {r.preparedBy}</span>
                  <span className={`hr-step ${r.status === "PENDING" ? "is-now" : r.status === "APPROVED" ? "is-done" : ""}`}>2 · {r.status === "APPROVED" ? `Approved by ${r.decidedBy}` : "Principal approves"}</span>
                  <span className={`hr-step ${r.status === "APPROVED" ? (r.effectiveFrom <= today() ? "is-done" : "is-now") : ""}`}>3 · New salaries from {formatDate(r.effectiveFrom)}</span>
                </div>
                {r.status === "PENDING" && r.preparedBy === user?.name && <Banner tone="info">You prepared this run, so someone else (the principal) approves it.</Banner>}
                {r.decisionNote && r.status === "DRAFT" && <Banner tone="warning" title="Returned for changes">{r.decisionNote}</Banner>}
                {actionError && <Banner tone="danger">{errorText(actionError)}</Banner>}
              </section>

              <div className="hr-kpis">
                <StatCard label="Staff getting an increment" icon="hr" value={<AnimatedNumber value={r.staff} format={formatCount} />} foot={`${r.totals.excluded} left out`} onClick={() => setShow("excluded")} />
                <StatCard label="More a month" icon="trendUp" value={<AnimatedNumber value={r.totals.monthlyIncrease} format={formatRs} />} foot={`${formatRs(r.totals.currentBasic)} → ${formatRs(r.totals.newBasic)}`} />
                <StatCard label="Cost over a year" icon="fees" value={<AnimatedNumber value={r.totals.yearlyCost} format={formatRs} />} foot="Basic pay only; house rent follows" />
                <StatCard label="Average rise" icon="trendUp" value={r.totals.averagePercent == null ? "—" : formatPercent(r.totals.averagePercent)} foot="Of basic pay" />
              </div>

              {byScale.length > 1 && (
                <Panel id="by-scale" title="Increase by pay scale" description="Rupees a month added to basic pay, per scale." rise={1}>
                  <ColumnChart data={byScale} value={(x) => x.increase} axisLabel={(x) => (x.scale === "—" ? "None" : `Sc ${x.scale}`)} formatAxis={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} tooltip={(x) => <><div className="mtb-chart-tip-title">Scale {x.scale}</div><div className="mtb-chart-tip-value">{formatRs(x.increase)}</div><div className="mtb-chart-tip-row"><span>Staff</span><span>{x.staff}</span></div></>} describe={(x) => `Scale ${x.scale}: ${formatRs(x.increase)} for ${x.staff} staff`} label="Monthly increase by pay scale" height={200} />
                </Panel>
              )}

              <DataTable
                caption={`${r.title}, lines`}
                columns={columns}
                rows={r.lines.filter((l) => (show === "included" ? l.included : !l.included))}
                rowKey="staffId"
                onRowClick={editable ? (l) => setLine(l) : undefined}
                toolbar={
                  <div className="flex w-full flex-wrap items-center gap-3">
                    <Segmented aria-label="Show" value={show} onChange={(v) => setShow(v as "included" | "excluded")} options={[{ value: "included", label: `Included (${r.staff})` }, { value: "excluded", label: `Left out (${r.totals.excluded})` }]} />
                    {editable && <span className="text-small text-ink-muted">Click a person to change their number of increments or add a special increment.</span>}
                    {editable && r.staff > 0 && (
                      <Button size="sm" icon="listChecks" className="ml-auto" onClick={() => setConfirm("bulk")}>
                        Set for everyone included
                      </Button>
                    )}
                  </div>
                }
                empty={<EmptyState icon="hr" title={show === "included" ? "Nobody included" : "Nobody left out"} />}
              />
              <Panel id="inc-history" title="History" rise={2}>
                <Timeline label="Run history" items={r.history.map((h) => ({ id: h.id, date: h.at.slice(0, 10), title: h.text, description: `${h.by} · ${formatDateTime(h.at)}${h.detail ? ` · ${h.detail}` : ""}` }))} />
                <Link to="/hr/settings" className="mt-3 inline-block text-small text-brand-ink">
                  See or change the increment table
                </Link>
              </Panel>

              <ConfirmDialog
                open={confirm === "approve"}
                onClose={() => setConfirm(null)}
                onConfirm={() => decide.mutate(true)}
                title={`Approve ${r.title}?`}
                message={`New basic pay for ${r.staff} staff from ${formatDate(r.effectiveFrom)}. It shows in each salary history and in salary sheets from then.`}
                details={[
                  ["Staff", formatCount(r.staff)],
                  ["More a month", formatRs(r.totals.monthlyIncrease)],
                  ["Cost over a year", formatRs(r.totals.yearlyCost)],
                ]}
                confirmLabel={`Approve · ${formatRs(r.totals.monthlyIncrease)} a month`}
                requireText="APPROVE"
                loading={decide.isPending}
                loadingLabel="Approving…"
                error={decide.error ? errorText(decide.error) : undefined}
              />
              <ConfirmDialog open={confirm === "submit"} onClose={() => setConfirm(null)} onConfirm={() => submit.mutate()} title="Send for approval?" message="The principal is asked to approve it. You can't change it while it waits; they can return it to you." confirmLabel="Send for approval" icon="send" loading={submit.isPending} error={submit.error ? errorText(submit.error) : undefined} />
              <ConfirmDialog
                open={confirm === "bulk"}
                onClose={() => {
                  setConfirm(null);
                  setBulkTried(false);
                }}
                onConfirm={() => {
                  setBulkTried(true);
                  if (bulkParsed.success) bulk.mutate();
                }}
                icon="listChecks"
                title="Set for everyone included?"
                message={`Applies to the ${r.staff} people included in this run. Leave a box empty to keep each person's own value. You can still change one person afterwards.`}
                confirmLabel="Apply to everyone included"
                loading={bulk.isPending}
                error={bulk.error ? errorText(bulk.error) : undefined}
              >
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <Select label="Number of increments" value={bulkN} onChange={(e) => setBulkN(e.target.value)} options={[{ value: "", label: "Keep as they are" }, ...["1", "2", "3"].map((v) => ({ value: v, label: v }))]} error={bulkTried ? bulkErrors.n : undefined} />
                  <AmountInput label="Special increment" value={bulkSpecial} onValueChange={setBulkSpecial} help="Empty keeps each person's own." error={bulkTried ? bulkErrors.special : undefined} />
                </div>
              </ConfirmDialog>
              <ConfirmDialog open={confirm === "delete"} onClose={() => setConfirm(null)} onConfirm={() => remove.mutate()} tone="danger" title="Delete this draft?" message="Nothing has changed yet, so deleting it only removes the preview." confirmLabel="Delete draft" loading={remove.isPending} />
              <ConfirmDialog open={confirm === "return"} onClose={() => setConfirm(null)} onConfirm={() => decide.mutate(false)} tone="warning" title="Return it for changes?" message="The accountant sees your note and can change the run, then send it again." confirmLabel="Return" loading={decide.isPending} error={decide.error ? errorText(decide.error) : undefined}>
                <Textarea label="What needs changing?" required rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
              </ConfirmDialog>
            </div>
          )}
        </div>
        {creating && ctx.campus !== "ALL" && (
          <NewRunPanel
            campus={ctx.campus}
            onClose={() => setCreating(false)}
            onCreated={(id) => {
              setCreating(false);
              setRunId(id);
            }}
          />
        )}
        {line && r && <LinePanel run={r} line={line} onClose={() => setLine(null)} />}
        {run.isError && <LoadError what="This run" error={run.error} onRetry={() => void run.refetch()} />}
        {area}
      </HrShell>
    </RequirePermission>
  );
}
