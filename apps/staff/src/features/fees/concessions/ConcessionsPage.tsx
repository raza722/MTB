import {
  feeSetupApi,
  feeSetupQueries,
  newIdempotencyKey,
  type CampusCode,
  type FeeConcession,
  type FeeConcessionClassRow,
  type FeeConcessionSuggestion,
  type FeeConcessionType,
  type FeeConcessionTypeInfo,
} from "@mtb/api";
import { formatCount, formatDate, formatDateTime, formatRs, formatSession } from "@mtb/domain";
import {
  AnimatedNumber,
  Banner,
  Button,
  Checkbox,
  ColumnChart,
  Combobox,
  DataTable,
  DatePicker,
  EmptyState,
  Input,
  KeyValue,
  Pagination,
  Panel,
  Segmented,
  SegmentedBar,
  Select,
  SidePanel,
  Skeleton,
  StatCard,
  StatusBadge,
  Textarea,
  Timeline,
  useToast,
  type Column,
} from "@mtb/ui";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { campusLabel } from "../../../app/shell/campus";
import { Page, PageHeader, RequirePermission } from "../../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../../app/session";
import { addDaysIso, DecisionBadge, errorField, errorText, feeToday, FeesNav, lakhTick, LoadError, monthEndIso, PaperSize, pctText, slide, useCanAny, useFeeClasses } from "../shared";

const TYPE_COLOR: Record<FeeConcessionType, string> = {
  SIBLING: "var(--chart-1)",
  STAFF_CHILD: "var(--chart-2)",
  TEACHER_CHILD: "var(--brand)",
  SCHOLARSHIP: "var(--chart-3)",
  TALENT: "var(--success)",
  ARMED_FORCES: "var(--info)",
  GOVT_SERVANT: "var(--warning)",
  ORPHAN: "var(--status-leave)",
  PERIPHERY: "var(--status-late)",
  KINSHIP: "var(--chart-4)",
  HARDSHIP: "var(--chart-5)",
  SPECIAL: "var(--ink-subtle)",
  MARTYR_CHILD: "var(--chart-2)",
  CENTRE_HOLDER: "var(--chart-3)",
  DM_CENTRE_HOLDER: "var(--chart-4)",
  COVID: "var(--chart-5)",
};

const off = (gross: number, pct: number) => Math.round((gross * pct) / 100);

/* ---------------------------------------------------------------- Request a concession */

function NewConcessionPanel({ campus, types, heads, prefill, onClose }: { campus: CampusCode; types: FeeConcessionTypeInfo[]; heads: Array<{ code: string; title: string }>; prefill?: FeeConcessionSuggestion; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const students = useQuery(feeSetupQueries.students(ctx));
  const structure = useQuery(feeSetupQueries.structure(campus, ctx.session));
  const nextMonth = addDaysIso(monthEndIso(feeToday().slice(0, 7)), 1);
  const [grNo, setGrNo] = useState<string | null>(prefill?.grNo ?? null);
  const [type, setType] = useState<FeeConcessionType>(prefill?.type ?? "SIBLING");
  const info = types.find((t) => t.code === type)!;
  const [pct, setPct] = useState(String(prefill?.pct ?? info.defaultPct));
  const [chosenHeads, setChosenHeads] = useState<string[]>(["TUITION"]);
  const [from, setFrom] = useState<string | null>(nextMonth);
  // Ends with the session (Setup's dates when the structure has them; April–March otherwise).
  const [to, setTo] = useState<string | null>(structure.data?.sessionEnd ?? `${ctx.session + 1}-03-31`);
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState(prefill?.reason ?? "");
  const [tried, setTried] = useState(false);

  const schema = z
    .object({
      grNo: z.string({ error: "Choose the student." }).min(1, "Choose the student."),
      pct: z.number({ error: "Enter the percentage." }).int("Use a whole percentage.").min(1, "Enter at least 1%.").max(info.maxPct, `${info.title} concessions go up to ${info.maxPct}%.`),
      heads: z.array(z.string()).min(1, "Choose at least one fee head."),
      from: z.string({ error: "Enter the start date." }).min(1, "Enter the start date.").refine((d) => d >= `${feeToday().slice(0, 7)}-01`, "Start this month or later; posted receipts never change."),
      to: z.string({ error: "Enter the end date." }).min(1, "Enter the end date."),
      reference: info.needsReference ? z.string().trim().min(1, `Enter the ${info.referenceLabel?.toLowerCase() ?? "reference"}.`) : z.string(),
      reason: z.string().trim().min(10, "Say why in a sentence; the principal reads this when deciding."),
    })
    .refine((v) => v.to >= v.from, { path: ["to"], message: "The end date must be after the start date." });
  const values = { grNo: grNo ?? "", pct: pct === "" ? undefined : Number(pct), heads: chosenHeads, from: from ?? "", to: to ?? "", reference, reason };
  const parsed = schema.safeParse(values);
  const errors: Record<string, string> = {};
  if (!parsed.success) for (const i of parsed.error.issues) errors[String(i.path[0])] ??= i.message;

  const student = students.data?.find((s) => s.grNo === grNo);
  const cls = student?.classSection.split("-")[0] ?? "";
  const classLine = (code: string) => structure.data?.classes.find((c) => c.classShort === cls)?.lines.find((l) => l.head === code)?.amount ?? 0;
  // The structure's amount is per installment of the head's plan (tuition is billed quarterly at some campuses).
  const perText = (code: string) => {
    const billing = structure.data?.heads.find((h) => h.code === code)?.billing;
    return billing === "MONTHLY" ? " (a month)" : billing === "QUARTERLY" ? " (a quarter)" : billing === "TERMLY" ? " (a term)" : "";
  };
  const pctNum = Number(pct) || 0;
  const key = useMemo(() => newIdempotencyKey(), [JSON.stringify(values), type]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () => feeSetupApi.requestConcession({ campus, session: ctx.session, grNo: grNo!, type, pct: pctNum, heads: chosenHeads, validFrom: from!, validTo: to!, ...(reference.trim() ? { reference: reference.trim() } : {}), reason: reason.trim() }, key),
    onSuccess: (c) => {
      toast({ title: "Concession sent for approval", message: `${c.studentName} · ${c.pct}% ${types.find((t) => t.code === c.type)?.title.toLowerCase()} · the principal decides.` });
      void queryClient.invalidateQueries({ queryKey: ["fees", "setup"] });
      onClose();
    },
  });
  const serverField = errorField(save.error);
  const err = (f: string) => (tried ? (errors[f] ?? (serverField === f ? errorText(save.error) : undefined)) : undefined);

  return (
    <SidePanel
      open
      onClose={onClose}
      title="New concession"
      description={`${campusLabel(campus)} · Session ${formatSession(ctx.session)}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon="send"
            loading={save.isPending}
            loadingLabel="Sending…"
            onClick={() => {
              setTried(true);
              if (parsed.success) save.mutate();
            }}
          >
            Send for approval
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <Combobox
          label="Student"
          required
          value={grNo}
          onValueChange={setGrNo}
          placeholder={students.isLoading ? "Loading students…" : "Search by name or G.R. number"}
          options={(students.data ?? []).map((s) => ({ value: s.grNo, label: `${s.name} (${s.classSection})`, hint: s.grNo, keywords: [s.grNo, s.father] }))}
          error={err("grNo")}
        />
        <Select
          label="Kind of concession"
          required
          value={type}
          onChange={(e) => {
            const t = e.target.value as FeeConcessionType;
            setType(t);
            setPct(String(types.find((x) => x.code === t)?.defaultPct ?? 10));
          }}
          options={types.map((t) => ({ value: t.code, label: t.title }))}
          help={info.description}
        />
        <Input label="Percentage off" required suffix="%" inputMode="numeric" value={pct} onChange={(e) => setPct(e.target.value.replace(/[^\d]/g, ""))} error={err("pct")} help={`Usually ${info.defaultPct}%, up to ${info.maxPct}%.`} />
        <fieldset className="m-0 grid gap-2 border-0 p-0">
          <legend className="mtb-label mb-1">
            Applies to <span className="text-danger-ink">*</span>
          </legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {heads.map((h) => (
              <Checkbox key={h.code} label={h.title} checked={chosenHeads.includes(h.code)} onChange={() => setChosenHeads((list) => (list.includes(h.code) ? list.filter((x) => x !== h.code) : [...list, h.code]))} />
            ))}
          </div>
          <span className={`text-small ${err("heads") ? "text-danger-ink" : "text-ink-muted"}`}>{err("heads") ?? "Only heads that concessions can reduce are listed (Structure → Fee heads)."}</span>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <DatePicker label="From" required value={from} onValueChange={setFrom} today={feeToday()} minDate={`${feeToday().slice(0, 7)}-01`} error={err("from")} />
          <DatePicker label="Until" required value={to} onValueChange={setTo} today={feeToday()} error={err("to")} help="Concessions end with the session." />
        </div>
        {info.needsReference && <Input label={info.referenceLabel} required value={reference} onChange={(e) => setReference(e.target.value)} error={err("reference")} />}
        <Textarea label="Reason" required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: father's shop closed after the market fire; help asked until March." error={err("reason")} />
        {student && chosenHeads.some((h) => classLine(h) > 0) && (
          <div className="rounded-md border border-border bg-surface-sunken p-4">
            <p className="m-0 mb-2 text-small font-medium">Worked out the same way every time</p>
            <KeyValue
              items={chosenHeads
                .filter((h) => classLine(h) > 0)
                .flatMap((h): Array<[string, string]> => {
                  const gross = classLine(h);
                  const title = heads.find((x) => x.code === h)?.title ?? h;
                  return [
                    [`${title}${perText(h)}`, formatRs(gross)],
                    [`Concession ${pctNum}%`, `− ${formatRs(off(gross, pctNum))}`],
                    ["Family pays", formatRs(gross - off(gross, pctNum))],
                  ];
                })}
            />
            <p className="m-0 mt-2 text-small text-ink-muted">Fee × % ÷ 100, rounded to the nearest rupee, on each installment that falls due while it runs. If a student has two concessions, the larger one applies.</p>
          </div>
        )}
        {save.error && !serverField && <Banner tone="danger">{errorText(save.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

/* ---------------------------------------------------------------- One concession */

function ConcessionPanel({ c, types, onClose }: { c: FeeConcession; types: FeeConcessionTypeInfo[]; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const readOnly = useReadOnly();
  const canDecide = useCan("approvals.decide");
  const canStop = useCanAny(["fees.setup", "approvals.decide"]);
  const [mode, setMode] = useState<"view" | "reject" | "stop">("view");
  const [note, setNote] = useState("");
  const [stopFrom, setStopFrom] = useState<string | null>(addDaysIso(monthEndIso(feeToday().slice(0, 7)), 1));
  const [tried, setTried] = useState(false);
  const key = useMemo(() => newIdempotencyKey(), [c.id, mode]);
  const t = types.find((x) => x.code === c.type);
  const done = (title: string, message: string) => {
    toast({ title, message });
    void queryClient.invalidateQueries({ queryKey: ["fees"] });
    onClose();
  };
  const decide = useMutation({
    mutationFn: (approve: boolean) => feeSetupApi.decideConcession(c.id, { approve, note }, key),
    onSuccess: (r) => done(r.status === "APPROVED" ? "Concession approved" : "Concession rejected", r.status === "APPROVED" ? `${r.studentName} pays ${formatRs(r.example.net)} a month from ${formatDate(r.validFrom)}.${r.repriced ? ` ${r.repriced} unpaid charges re-priced.` : ""}` : `${r.studentName}: the office tells the family.`),
  });
  const stop = useMutation({
    mutationFn: () => feeSetupApi.stopConcession(c.id, { reason: note, from: stopFrom! }, key),
    onSuccess: (r) => done("Concession stopped", `${r.studentName} pays the full fee from ${formatDate(stopFrom!)}.`),
  });
  const error = decide.error ?? stop.error;
  return (
    <SidePanel
      open
      onClose={onClose}
      title={`${c.studentName} · ${t?.title ?? c.type} ${c.pct}%`}
      description={`${c.grNo} · ${c.classSection} · ${c.campusName}`}
      footer={
        !readOnly && c.status === "PENDING" && canDecide ? (
          mode === "reject" ? (
            <>
              <Button onClick={() => setMode("view")}>Back</Button>
              <Button
                variant="danger"
                loading={decide.isPending}
                loadingLabel="Rejecting…"
                onClick={() => {
                  setTried(true);
                  if (note.trim()) decide.mutate(false);
                }}
              >
                Reject
              </Button>
            </>
          ) : (
            <>
              <Button variant="danger-quiet" icon="x" onClick={() => setMode("reject")}>
                Reject
              </Button>
              <Button variant="primary" icon="check" loading={decide.isPending} loadingLabel="Approving…" onClick={() => decide.mutate(true)}>
                Approve {c.pct}%
              </Button>
            </>
          )
        ) : !readOnly && c.status === "APPROVED" && canStop ? (
          mode === "stop" ? (
            <>
              <Button onClick={() => setMode("view")}>Back</Button>
              <Button
                variant="danger"
                loading={stop.isPending}
                loadingLabel="Stopping…"
                onClick={() => {
                  setTried(true);
                  if (note.trim() && stopFrom) stop.mutate();
                }}
              >
                Stop concession
              </Button>
            </>
          ) : (
            <>
              <span />
              <Button variant="danger-quiet" icon="ban" onClick={() => setMode("stop")}>
                Stop concession
              </Button>
            </>
          )
        ) : (
          <Button onClick={onClose}>Close</Button>
        )
      }
    >
      <div className="grid gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <DecisionBadge status={c.status} />
          {c.reference && (
            <StatusBadge status="neutral" dot={false}>
              {t?.referenceLabel}: {c.reference}
            </StatusBadge>
          )}
        </div>
        <KeyValue
          items={[
            ["Runs", `${formatDate(c.validFrom)} to ${formatDate(c.validTo)}`],
            ["Applies to", c.byHead.length ? c.byHead.map((h) => h.title).join(", ") : c.heads.join(", ")],
            ["Father", c.father],
            ["Session fee for the class", formatRs(c.sessionFee)],
            ["Off while it runs", c.byHead.map((h) => `${h.title} ${formatRs(h.amount)}`).join(" · ") || formatRs(0)],
            ["Reason", c.reason],
            ["Requested", `${c.requestedBy}, ${formatDateTime(c.requestedAt)}`],
            ...(c.decidedBy ? ([["Decided", `${c.decidedBy}, ${c.decidedAt ? formatDateTime(c.decidedAt) : ""}${c.decisionNote ? ` · ${c.decisionNote}` : ""}`]] as Array<[string, string]>) : []),
            ...(c.repriced ? ([["Unpaid charges re-priced", formatCount(c.repriced)]] as Array<[string, string]>) : []),
          ]}
        />
        <div className="rounded-md border border-border bg-surface-sunken p-4">
          <p className="m-0 mb-2 text-small font-medium">Worked example</p>
          <KeyValue
            items={[
              [c.example.head, formatRs(c.example.gross)],
              [`Concession ${c.pct}%`, `− ${formatRs(c.example.concession)}`],
              ["Family pays", <span className="font-semibold">{formatRs(c.example.net)}</span>],
            ]}
          />
        </div>
        {mode === "reject" && <Textarea label="Why is it rejected?" required rows={3} value={note} onChange={(e) => setNote(e.target.value)} error={tried && !note.trim() ? "Say why; the office tells the family." : undefined} />}
        {mode === "stop" && (
          <div className="grid gap-4">
            <DatePicker label="Full fee again from" required value={stopFrom} onValueChange={setStopFrom} today={feeToday()} minDate={feeToday()} error={tried && !stopFrom ? "Enter the date." : undefined} />
            <Textarea label="Why does it stop?" required rows={3} value={note} onChange={(e) => setNote(e.target.value)} error={tried && !note.trim() ? "Say why the concession stops." : undefined} />
          </div>
        )}
        {error && <Banner tone="danger">{errorText(error)}</Banner>}
        <div className="grid gap-2">
          <span className="text-small font-medium">History</span>
          <Timeline label="Concession history" items={c.history.map((h) => ({ id: h.id, date: h.at.slice(0, 10), title: h.text, description: `${h.by}${h.detail ? ` · ${h.detail}` : ""}`, tone: h.text.startsWith("Approved") ? ("success" as const) : h.text.startsWith("Rejected") || h.text.startsWith("Stopped") ? ("danger" as const) : ("neutral" as const) }))} />
        </div>
      </div>
    </SidePanel>
  );
}

/* ---------------------------------------------------------------- Page */

export function ConcessionsPage() {
  const ctx = useCtx();
  const classList = useFeeClasses(ctx.campus);
  const readOnly = useReadOnly();
  const canRequest = useCanAny(["fees.collect", "fees.setup", "approvals.decide"]);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [type, setType] = useState<FeeConcessionType | "">("");
  const [status, setStatus] = useState<FeeConcession["status"] | "">("");
  const [cls, setCls] = useState("");
  const [section, setSection] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => setPage(1), [search, type, status, cls, section, ctx.campus, ctx.session]);
  // Filtered and paged on the server (contract C12); the summary cards cover every concession of the scope.
  const q = useQuery({ ...feeSetupQueries.concessions(ctx, { q: search, type, status, classShort: cls, section, page, pageSize: 50 }), placeholderData: keepPreviousData });
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState<FeeConcessionSuggestion | true | null>(null);
  // By class: a period inside the session and the heads to count.
  const [from, setFrom] = useState<string | null>(`${ctx.session}-04-01`);
  const [to, setTo] = useState<string | null>(`${ctx.session + 1}-03-31`);
  const [sumHeads, setSumHeads] = useState<string[]>([]);
  const [view, setView] = useState("table");
  useEffect(() => {
    setOpenId(null);
    setFrom(`${ctx.session}-04-01`);
    setTo(`${ctx.session + 1}-03-31`);
  }, [ctx.campus, ctx.session]);
  const rangeError = !from || !to ? "Choose both dates." : from > to ? "The start date must be on or before the end date." : from < `${ctx.session}-04-01` || to > `${ctx.session + 1}-03-31` ? `Choose dates inside ${formatSession(ctx.session)}.` : undefined;
  const summaryQ = useQuery({
    ...feeSetupQueries.concessionSummary(ctx, { from: from ?? "", to: to ?? "", heads: sumHeads.join(","), classes: cls, section }),
    enabled: !rangeError,
    placeholderData: keepPreviousData,
  });
  const sum = summaryQ.data;
  const d = q.data;
  const typeTitle = (t: FeeConcessionType) => d?.types.find((x) => x.code === t)?.title ?? t;
  const rows = d?.concessions ?? [];
  const open = d?.concessions.find((c) => c.id === openId);
  const canCreate = canRequest && !readOnly && ctx.campus !== "ALL";
  const sections = classList.sectionsOf(cls);
  const filtered = Boolean(query || type || status || cls || section);

  const columns: Array<Column<FeeConcession>> = [
    {
      key: "student",
      header: "Student",
      render: (c) => (
        <span className="grid">
          <span className="font-medium">{c.studentName}</span>
          <span className="text-small text-ink-muted">
            {c.grNo} · {c.classSection}
            {ctx.campus === "ALL" ? ` · ${c.campusName}` : ""}
          </span>
        </span>
      ),
    },
    { key: "father", header: "Father", render: (c) => <span className="text-small">{c.father}</span> },
    {
      key: "type",
      header: "Concession",
      render: (c) => (
        <span className="grid">
          <span className="flex items-center gap-2">
            <span className="mtb-chart-key" style={{ background: TYPE_COLOR[c.type] }} aria-hidden="true" />
            {typeTitle(c.type)} {c.pct}%
          </span>
          <span className="text-small text-ink-muted">{c.byHead.map((h) => h.title).join(", ")}</span>
        </span>
      ),
    },
    { key: "value", header: "Off each month", align: "right", render: (c) => <span className="mtb-num">{formatRs(c.monthlyValue)}</span> },
    { key: "session", header: "Off while it runs", align: "right", render: (c) => <span className="mtb-num">{formatRs(c.sessionValue)}</span> },
    { key: "runs", header: "Runs", render: (c) => <span className="mtb-num text-small">{`${formatDate(c.validFrom)} – ${formatDate(c.validTo)}`}</span> },
    { key: "status", header: "Status", render: (c) => <DecisionBadge status={c.status} /> },
    { key: "by", header: "Requested by", render: (c) => <span className="text-small">{c.requestedBy}</span> },
  ];

  const classCols: Array<Column<FeeConcessionClassRow>> = [
    { key: "className", header: "Class", render: (r) => <span className="font-medium">{r.className}</span> },
    { key: "strength", header: "Students", align: "right", render: (r) => formatCount(r.strength) },
    { key: "students", header: "With a concession", align: "right", render: (r) => formatCount(r.students) },
    { key: "billed", header: "Total amount", align: "right", render: (r) => <span className="mtb-num">{formatRs(r.billed)}</span> },
    { key: "discount", header: "Discount", align: "right", render: (r) => <span className="mtb-num">{formatRs(r.discount)}</span> },
    { key: "remaining", header: "Remaining", align: "right", render: (r) => <span className="mtb-num">{formatRs(r.remaining)}</span> },
    { key: "pct", header: "Discount %", align: "right", render: (r) => <span className="mtb-num">{pctText(r.pct)}</span> },
  ];

  const active = rows.filter((c) => c.status === "APPROVED");
  const periodText = from && to ? `${formatDate(from)} to ${formatDate(to)}` : "";
  const headsText = sum ? (sumHeads.length ? sum.heads.map((h) => h.title).join(", ") : "every head a concession can reduce") : "";

  return (
    <RequirePermission permission="fees.view" page="concessions">
      <Page>
        <PageHeader
          title="Concessions and scholarships"
          actions={
            <>
              <Button icon="printer" onClick={() => window.print()} disabled={!d}>
                Print list
              </Button>
              {canCreate && (
                <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
                  New concession
                </Button>
              )}
            </>
          }
        />
        <FeesNav />
        {q.isError && <LoadError what="Concessions" error={q.error} onRetry={() => void q.refetch()} />}
        <Banner tone="info" title="The same rule every time.">
          Concession = fee × % ÷ 100, rounded to the nearest rupee, taken off each chosen head (tuition, annual charges) while it runs. Every concession is approved by the principal and keeps a history. Receipts already posted never change.
        </Banner>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Active concessions" icon="award" loading={q.isLoading} value={<AnimatedNumber value={d?.summary.active ?? 0} format={formatCount} />} foot={campusLabel(ctx.campus)} onClick={() => setStatus("APPROVED")} />
          <StatCard label="Off tuition each month" icon="fees" loading={q.isLoading} value={<AnimatedNumber value={d?.summary.monthlyValue ?? 0} format={formatRs} />} foot="While they run" />
          <StatCard label="Waiting for approval" icon="clock" tone={(d?.summary.pending ?? 0) > 0 ? "warning" : "neutral"} loading={q.isLoading} value={<AnimatedNumber value={d?.summary.pending ?? 0} format={formatCount} />} foot="The principal decides" onClick={() => setStatus("PENDING")} />
          <StatCard label="Siblings without one" icon="students" tone={(d?.suggestions.length ?? 0) > 0 ? "info" : "neutral"} loading={q.isLoading} value={<AnimatedNumber value={d?.suggestions.length ?? 0} format={formatCount} />} foot="Found by father's CNIC" />
        </div>

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {d && d.summary.byType.length > 0 && (
            <Panel id="by-type" title="Where the concession goes" description="Rupees off tuition each month, by kind." rise={1}>
              <div className="grid gap-4">
                <SegmentedBar label="Monthly concession by kind" format={formatRs} segments={d.summary.byType.map((b) => ({ key: b.type, label: typeTitle(b.type), value: b.monthlyValue, color: TYPE_COLOR[b.type] }))} />
                <ul className="m-0 grid list-none gap-1.5 p-0 text-small">
                  {d.summary.byType.map((b, i) => (
                    <li key={b.type} className="mtb-slide-in flex items-center justify-between gap-3" style={slide(i)}>
                      <span className="flex items-center gap-2">
                        <span className="mtb-chart-key" style={{ background: TYPE_COLOR[b.type] }} aria-hidden="true" />
                        {typeTitle(b.type)} · {formatCount(b.count)} {b.count === 1 ? "student" : "students"}
                      </span>
                      <span className="tabular-nums">{formatRs(b.monthlyValue)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Panel>
          )}
          {d && d.suggestions.length > 0 && (
            <Panel id="suggest" title="Brothers and sisters without a sibling concession" description="The eldest child pays full fee; each younger one qualifies. Found by the father's CNIC across every campus." rise={2}>
              <ul className="m-0 grid list-none gap-2 p-0">
                {d.suggestions.map((s, i) => (
                  <li key={s.grNo} className="mtb-slide-in flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5" style={slide(i)}>
                    <span className="grid min-w-0">
                      <span className="font-medium">
                        {s.studentName} <span className="text-ink-muted">({s.classSection})</span>
                      </span>
                      <span className="text-small text-ink-muted">{s.reason}</span>
                    </span>
                    {canCreate && (
                      <Button size="sm" icon="plus" onClick={() => setCreating(s)}>
                        Request {s.pct}%
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>

        <Panel
          id="by-class"
          title="By class"
          description="Fees falling due in the period against the discount approved concessions take off them, class by class."
          rise={3}
          actions={<Segmented aria-label="Show as" value={view} onChange={setView} options={[{ value: "table", label: "Table" }, { value: "chart", label: "Chart" }, { value: "kinds", label: "By kind" }]} />}
        >
          <div className="grid gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-44">
                <DatePicker label="From" value={from} onValueChange={setFrom} today={feeToday()} minDate={`${ctx.session}-04-01`} maxDate={`${ctx.session + 1}-03-31`} />
              </div>
              <div className="w-44">
                <DatePicker label="To" value={to} onValueChange={setTo} today={feeToday()} minDate={`${ctx.session}-04-01`} maxDate={`${ctx.session + 1}-03-31`} error={rangeError} />
              </div>
              <fieldset className="m-0 flex flex-wrap items-center gap-x-4 gap-y-2 border-0 p-0">
                <legend className="mtb-label mb-1">Fee heads</legend>
                {(d?.heads ?? []).map((h) => (
                  <Checkbox key={h.code} label={h.title} checked={sumHeads.length === 0 || sumHeads.includes(h.code)} onChange={() => setSumHeads((list) => {
                    const all = (d?.heads ?? []).map((x) => x.code);
                    const cur = list.length ? list : all;
                    const next = cur.includes(h.code) ? cur.filter((x) => x !== h.code) : [...cur, h.code];
                    return next.length === all.length || next.length === 0 ? [] : next;
                  })} />
                ))}
              </fieldset>
            </div>
            {summaryQ.isError && <LoadError what="The class summary" error={summaryQ.error} onRetry={() => void summaryQ.refetch()} />}
            {summaryQ.isLoading && <Skeleton height={220} />}
            {sum && view === "table" && (
              <DataTable
                caption={`Concessions by class, ${periodText}`}
                rows={sum.byClass}
                rowKey="classShort"
                columns={classCols}
                density="dense"
                onRowClick={(r) => setCls(r.classShort)}
                footer={{ className: "Total", strength: formatCount(sum.totals.strength), students: formatCount(sum.totals.students), billed: formatRs(sum.totals.billed), discount: formatRs(sum.totals.discount), remaining: formatRs(sum.totals.remaining), pct: `${pctText(sum.totals.pct)}` }}
                empty={<EmptyState icon="award" title="No students match" description="Choose another class or period." />}
              />
            )}
            {sum && view === "chart" && (
              sum.byClass.some((r) => r.discount > 0) ? (
                <ColumnChart
                  data={sum.byClass}
                  value={(r) => r.discount}
                  axisLabel={(r) => (r.classShort === "Prep" ? "Prep" : r.classShort)}
                  formatAxis={lakhTick}
                  tooltip={(r) => (
                    <>
                      <div className="mtb-chart-tip-title">{r.className}</div>
                      <div className="mtb-chart-tip-value">{formatRs(r.discount)}</div>
                      <div className="mtb-chart-tip-row">
                        <span>Of billed</span>
                        <span>{pctText(r.pct)}</span>
                      </div>
                      <div className="mtb-chart-tip-row">
                        <span>Students</span>
                        <span>{formatCount(r.students)} of {formatCount(r.strength)}</span>
                      </div>
                    </>
                  )}
                  describe={(r) => `${r.className}: ${formatRs(r.discount)} discount, ${pctText(r.pct)} of ${formatRs(r.billed)}`}
                  label="Discount by class"
                  height={240}
                />
              ) : (
                <EmptyState icon="award" title="No discount in this period" description="No approved concession runs in these dates." />
              )
            )}
            {sum && view === "kinds" && (
              <div className="mtb-table-wrap">
                <div className="mtb-table-scroll">
                  <table className="mtb-table mtb-table-dense">
                    <caption className="mtb-sr-only">Students with each kind of concession, by class</caption>
                    <thead>
                      <tr>
                        <th scope="col">Class</th>
                        <th scope="col" className="mtb-th-num">
                          Class strength
                        </th>
                        {sum.byClassKind.kinds.map((k) => (
                          <th key={k} scope="col" className="mtb-th-num">
                            {typeTitle(k)}
                          </th>
                        ))}
                        <th scope="col" className="mtb-th-num">
                          Total
                        </th>
                        <th scope="col" className="mtb-th-num">
                          % with one
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sum.byClassKind.rows.map((r) => (
                        <tr key={r.classShort}>
                          <td className="font-medium">{r.className}</td>
                          <td className="mtb-td-num">{formatCount(r.strength)}</td>
                          {sum.byClassKind.kinds.map((k) => (
                            <td key={k} className="mtb-td-num">
                              {r.counts[k] ? formatCount(r.counts[k]!) : ""}
                            </td>
                          ))}
                          <td className="mtb-td-num font-medium">{formatCount(r.total)}</td>
                          <td className="mtb-td-num">{pctText(r.pct)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td className="font-semibold">Total</td>
                        <td className="mtb-td-num font-semibold">{formatCount(sum.byClassKind.totals.strength)}</td>
                        {sum.byClassKind.kinds.map((k) => (
                          <td key={k} className="mtb-td-num font-semibold">
                            {formatCount(sum.byClassKind.totals.counts[k] ?? 0)}
                          </td>
                        ))}
                        <td className="mtb-td-num font-semibold">{formatCount(sum.byClassKind.totals.total)}</td>
                        <td className="mtb-td-num font-semibold">{pctText(sum.byClassKind.totals.pct)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
            {sum && <p className="m-0 text-small text-ink-muted">Counting {headsText} falling due {periodText}. Students: enrolled now. Discount: approved concessions, the larger one when two run at once.</p>}
          </div>
        </Panel>

        <DataTable
          caption={`Concessions, ${campusLabel(ctx.campus)}, ${formatSession(ctx.session)}`}
          columns={columns}
          rows={rows}
          loading={q.isLoading}
          onRowClick={(c) => setOpenId(c.id)}
          pagination={d && d.total > d.pageSize ? <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPageChange={setPage} /> : undefined}
          toolbar={
            <div className="flex w-full flex-wrap items-end gap-3">
              <div className="w-60">
                <Input aria-label="Search" placeholder="Student, G.R. or father" icon="search" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <div className="w-36">
                <Select
                  aria-label="Class"
                  value={cls}
                  onChange={(e) => {
                    setCls(e.target.value);
                    setSection("");
                  }}
                  options={[{ value: "", label: "Every class" }, ...classList.options]}
                />
              </div>
              <div className="w-32">
                <Select aria-label="Section" value={section} disabled={!cls} onChange={(e) => setSection(e.target.value)} options={[{ value: "", label: cls ? "Every section" : "Section" }, ...sections.map((x) => ({ value: x, label: `${cls}-${x}` }))]} />
              </div>
              <div className="w-44">
                <Select aria-label="Kind" value={type} onChange={(e) => setType(e.target.value as FeeConcessionType | "")} options={[{ value: "", label: "Every kind" }, ...(d?.types ?? []).map((t) => ({ value: t.code, label: t.title }))]} />
              </div>
              <div className="w-48">
                <Select
                  aria-label="Status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as FeeConcession["status"] | "")}
                  options={[
                    { value: "", label: "Every status" },
                    { value: "PENDING", label: "Waiting for approval" },
                    { value: "APPROVED", label: "Approved" },
                    { value: "REJECTED", label: "Rejected" },
                    { value: "STOPPED", label: "Stopped" },
                  ]}
                />
              </div>
              {filtered && (
                <Button
                  size="sm"
                  variant="quiet"
                  icon="x"
                  onClick={() => {
                    setQuery("");
                    setType("");
                    setStatus("");
                    setCls("");
                    setSection("");
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          }
          empty={
            <EmptyState
              icon="award"
              title={filtered ? "No concessions match" : "No concessions this session"}
              description={filtered ? "Clear the filters to see them all." : "Sibling, staff-child, scholarship and hardship concessions appear here once requested."}
              action={canCreate && !filtered ? <Button variant="primary" onClick={() => setCreating(true)}>New concession</Button> : undefined}
            />
          }
        />

        {d && (
          <div className="fees-print-only mtb-print-area fees-print-a4">
            <PaperSize size="A4" />
            <div className="fees-doc" data-theme="light">
              <div className="fees-doc-head">
                <div>
                  <h1>Concessions and scholarships</h1>
                  <p>
                    {campusLabel(ctx.campus)} · Session {formatSession(ctx.session)}
                    {cls ? ` · ${classList.nameOf(cls)}${section ? `-${section}` : ""}` : ""}
                  </p>
                </div>
                <p>Printed {formatDate(feeToday())}</p>
              </div>
              {sum && (
                <>
                  <h2>
                    By class · {periodText}
                  </h2>
                  <table>
                    <thead>
                      <tr>
                        <th>Class</th>
                        <th className="n">Students</th>
                        <th className="n">Total amount</th>
                        <th className="n">Discount</th>
                        <th className="n">Remaining</th>
                        <th className="n">Disc. %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sum.byClass.map((r) => (
                        <tr key={r.classShort}>
                          <td>{r.className}</td>
                          <td className="n">{formatCount(r.strength)}</td>
                          <td className="n">{formatRs(r.billed)}</td>
                          <td className="n">{formatRs(r.discount)}</td>
                          <td className="n">{formatRs(r.remaining)}</td>
                          <td className="n">{pctText(r.pct)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td>
                          <strong>Total</strong>
                        </td>
                        <td className="n">
                          <strong>{formatCount(sum.totals.strength)}</strong>
                        </td>
                        <td className="n">
                          <strong>{formatRs(sum.totals.billed)}</strong>
                        </td>
                        <td className="n">
                          <strong>{formatRs(sum.totals.discount)}</strong>
                        </td>
                        <td className="n">
                          <strong>{formatRs(sum.totals.remaining)}</strong>
                        </td>
                        <td className="n">
                          <strong>{pctText(sum.totals.pct)}</strong>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <h2>Students</h2>
                  <table>
                    <thead>
                      <tr>
                        <th>Class</th>
                        <th>G.R. no.</th>
                        <th>Student</th>
                        <th>Father</th>
                        <th>Concession</th>
                        <th className="n">Fee</th>
                        <th className="n">Concession</th>
                        <th className="n">Payable</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sum.students.map((s) => (
                        <tr key={s.grNo}>
                          <td>{s.classSection}</td>
                          <td>{s.grNo}</td>
                          <td>{s.studentName}</td>
                          <td>{s.father}</td>
                          <td>
                            {typeTitle(s.type)} {s.pct}%{s.reference ? ` (${s.reference})` : ""}
                          </td>
                          <td className="n">{formatRs(s.sessionFee)}</td>
                          <td className="n">{formatRs(s.concession)}</td>
                          <td className="n">{formatRs(s.payable)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td colSpan={5}>
                          <strong>{formatCount(sum.students.length)} students</strong>
                        </td>
                        <td className="n">
                          <strong>{formatRs(sum.students.reduce((a, s) => a + s.sessionFee, 0))}</strong>
                        </td>
                        <td className="n">
                          <strong>{formatRs(sum.students.reduce((a, s) => a + s.concession, 0))}</strong>
                        </td>
                        <td className="n">
                          <strong>{formatRs(sum.students.reduce((a, s) => a + s.payable, 0))}</strong>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </>
              )}
              <h2>Approved concessions{d && d.total > rows.length ? ` (page ${d.page} of the list)` : ""}</h2>
              <table>
                <thead>
                  <tr>
                    <th>Class</th>
                    <th>G.R. no.</th>
                    <th>Student</th>
                    <th>Concession</th>
                    <th>Runs</th>
                    <th className="n">Off a month</th>
                  </tr>
                </thead>
                <tbody>
                  {[...active]
                    .filter((c) => (!cls || c.classSection.split("-")[0] === cls) && (!section || c.classSection.split("-")[1] === section))
                    .sort((a, b) => a.classSection.localeCompare(b.classSection, "en", { numeric: true }))
                    .map((c) => (
                      <tr key={c.id}>
                        <td>{c.classSection}</td>
                        <td>{c.grNo}</td>
                        <td>{c.studentName}</td>
                        <td>
                          {typeTitle(c.type)} {c.pct}%{c.reference ? ` (${c.reference})` : ""}
                        </td>
                        <td>
                          {formatDate(c.validFrom)} – {formatDate(c.validTo)}
                        </td>
                        <td className="n">{formatRs(c.monthlyValue)}</td>
                      </tr>
                    ))}
                  <tr>
                    <td colSpan={5}>
                      <strong>Total off tuition each month</strong>
                    </td>
                    <td className="n">
                      <strong>{formatRs(active.reduce((a, c) => a + c.monthlyValue, 0))}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div className="fees-doc-sign">
                <div>Accountant</div>
                <div>Principal</div>
                <div>Date</div>
              </div>
            </div>
          </div>
        )}

        {open && d && <ConcessionPanel c={open} types={d.types} onClose={() => setOpenId(null)} />}
        {creating && d && ctx.campus !== "ALL" && <NewConcessionPanel campus={ctx.campus} types={d.types} heads={d.heads} {...(creating !== true ? { prefill: creating } : {})} onClose={() => setCreating(null)} />}
      </Page>
    </RequirePermission>
  );
}
