import { metaQueries, newIdempotencyKey, studentDocsApi, studentDocsQueries, type StudentDocIssued, type StudentDocSnapshot } from "@mtb/api";
import { formatDate, formatSession } from "@mtb/domain";
import { Banner, Button, Checkbox, ConfirmDialog, DataTable, DatePicker, EmptyState, Input, Select, SidePanel, Skeleton, useToast, type Column } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useCtx } from "../../../app/session";
import { apiMessage, LoadError, today } from "../shared";
import { PrintSheet, printNow } from "./print";
import { AdmissionSlip, AppreciationLetter, StudentRecordForm, type DocInput } from "./templates";

/** First day of a session (1 April). */
const sessionStart = (session: number) => `${session}-04-01`;

const rangeSchema = z
  .object({ from: z.string().min(1, { error: "Choose the first date." }), to: z.string().min(1, { error: "Choose the last date." }) })
  .refine((v) => v.from <= v.to, { path: ["to"], error: "The last date must be on or after the first." });

/** Admission slips two to an A4 sheet (side by side, landscape). */
export function AdmissionSlipSheets({ slips }: { slips: DocInput[] }) {
  const pairs: DocInput[][] = [];
  for (let i = 0; i < slips.length; i += 2) pairs.push(slips.slice(i, i + 2));
  return (
    <>
      {pairs.map((p, i) => (
        <section key={i} className="mtb-slip-pair" aria-label={`Sheet ${i + 1} of ${pairs.length}`}>
          {p.map((d) => (
            <AdmissionSlip key={d.snapshot.grNo} d={d} />
          ))}
        </section>
      ))}
    </>
  );
}

/**
 * Admission slips for new admissions (legacy "Admission Slips"): a class and section, admitted between two dates.
 * Each student gets a slip with its own serial number, printed two to an A4 sheet. With `grNos` (ticked on the
 * Offers page) the list is exactly those students.
 */
export function AdmissionSlipsPanel({ open, onClose, grNos }: { open: boolean; onClose: () => void; grNos?: string[] }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const classes = useQuery(metaQueries.classes(ctx.campus));
  const [cls, setCls] = useState("");
  const [section, setSection] = useState("");
  const [from, setFrom] = useState<string | null>(sessionStart(ctx.session));
  const [to, setTo] = useState<string | null>(today());
  const [confirming, setConfirming] = useState(false);
  const [issued, setIssued] = useState<StudentDocIssued[] | null>(null);
  const [skipped, setSkipped] = useState<Array<{ name: string; reason: string }>>([]);
  const [key, setKey] = useState(newIdempotencyKey);
  useEffect(() => {
    if (open) {
      setIssued(null);
      setSkipped([]);
      setConfirming(false);
      setKey(newIdempotencyKey());
      if (grNos) {
        setCls("");
        setSection("");
        setFrom(sessionStart(ctx.session));
        setTo(today());
      }
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const range = rangeSchema.safeParse({ from: from ?? "", to: to ?? "" });
  const q = useQuery({ ...studentDocsQueries.newAdmissions(ctx, { className: cls, section, from: from ?? "", to: to ?? "" }), enabled: open && range.success && ctx.campus !== "ALL" });
  const rows = useMemo(() => (q.data ?? []).filter((s) => !grNos || grNos.includes(s.grNo)), [q.data, grNos]);
  const issue = useMutation({
    mutationFn: () => studentDocsApi.issue(ctx, { type: "ADMISSION_SLIP", grNos: rows.map((s) => s.grNo), details: {} }, key),
    onSuccess: (r) => {
      setConfirming(false);
      setIssued(r.issued);
      setSkipped(r.skipped);
      void queryClient.invalidateQueries({ queryKey: studentDocsQueries.all() });
      toast({ title: `${r.issued.length} admission ${r.issued.length === 1 ? "slip" : "slips"} issued`, message: r.skipped.length ? `${r.skipped.length} skipped. Printing now.` : "Printing now: two slips to an A4 sheet." });
      printNow();
    },
  });
  const cur = (classes.data ?? []).find((c) => c.short === cls);
  const preview: DocInput[] = issued ? issued.map((d) => ({ type: d.type, serialNo: d.serialNo, issuedOn: d.issuedOn, issuedBy: d.issuedBy, details: d.details, snapshot: d.snapshot, copy: 1 })) : [];
  const columns: Array<Column<StudentDocSnapshot>> = [
    { key: "grNo", header: "G.R. no.", width: 120, render: (s) => <span className="mtb-mono">{s.grNo}</span> },
    { key: "name", header: "Student", render: (s) => <span className="grid"><span className="mtb-cell-primary">{s.name}</span><span className="mtb-cell-secondary">{s.relation} {s.father}</span></span> },
    { key: "classSection", header: "Class", width: 90 },
    { key: "rollNo", header: "Roll", width: 70, align: "right", render: (s) => <span className="tabular-nums">{s.rollNo}</span> },
    { key: "admissionDate", header: "Admitted", width: 120, render: (s) => <span className="tabular-nums">{formatDate(s.admissionDate)}</span> },
  ];
  return (
    <SidePanel
      open={open}
      onClose={onClose}
      wide
      title={issued ? `${issued.length} admission slips issued` : "Admission slips for new admissions"}
      description="One slip per student with its own serial number, two to an A4 sheet. Signed by the vice principal, class in-charge and office superintendent."
      footer={
        issued ? (
          <>
            <Button onClick={onClose}>Done</Button>
            <Button variant="primary" icon="printer" onClick={() => window.print()}>
              Print again
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" icon="receipt" disabled={!rows.length || !range.success} onClick={() => setConfirming(true)}>
              Issue {rows.length} {rows.length === 1 ? "slip" : "slips"} and print
            </Button>
          </>
        )
      }
    >
      <div className="grid gap-4">
        {!issued && !grNos && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Class"
              value={cls}
              onChange={(e) => {
                setCls(e.target.value);
                setSection("");
              }}
              options={[{ value: "", label: "Every class" }, ...(classes.data ?? []).map((c) => ({ value: c.short, label: c.name }))]}
            />
            <Select label="Section" value={section} disabled={!cur} onChange={(e) => setSection(e.target.value)} options={[{ value: "", label: "Every section" }, ...(cur?.sections ?? []).map((s) => ({ value: s, label: `${cur!.short}-${s}` }))]} />
            <DatePicker label="Admitted from" required value={from} maxDate={today()} onValueChange={setFrom} error={!range.success ? range.error.issues.find((i) => i.path[0] === "from")?.message : undefined} />
            <DatePicker label="Admitted to" required value={to} maxDate={today()} onValueChange={setTo} error={!range.success ? range.error.issues.find((i) => i.path[0] === "to")?.message : undefined} />
          </div>
        )}
        {grNos && !issued && <p className="m-0 text-small text-ink-muted">{`${grNos.length} ${grNos.length === 1 ? "student" : "students"} ticked on the Offers page, session ${formatSession(ctx.session)}.`}</p>}
        {skipped.length > 0 && (
          <Banner tone="warning" title={`${skipped.length} not issued`}>
            {skipped.map((s) => `${s.name}: ${s.reason}`).join(" ")}
          </Banner>
        )}
        {q.isError && <LoadError what="new admissions" error={q.error} onRetry={() => void q.refetch()} />}
        {issued ? (
          <PrintSheet paper="A4_LANDSCAPE" label="Admission slips" zoom={0.45}>
            <AdmissionSlipSheets slips={preview} />
          </PrintSheet>
        ) : q.isLoading ? (
          <Skeleton height={240} />
        ) : (
          <DataTable
            caption="New admissions"
            columns={columns}
            rows={rows}
            rowKey="grNo"
            maxHeight={420}
            empty={<EmptyState icon="students" title="No new admissions" description="Nobody was admitted to this class between these dates. Widen the dates or choose another class." />}
          />
        )}
        {!issued && rows.length > 0 && <p className="m-0 text-small text-ink-muted">Total students: {rows.length}</p>}
      </div>
      <ConfirmDialog
        open={confirming}
        onClose={() => {
          setConfirming(false);
          issue.reset();
        }}
        onConfirm={() => issue.mutate()}
        icon="receipt"
        title={`Issue ${rows.length} admission ${rows.length === 1 ? "slip" : "slips"}?`}
        message="Each student gets an admission slip with its own serial number in the register. A reprint later is logged with a reason."
        details={[
          ["Students", String(rows.length)],
          ["A4 sheets", String(Math.ceil(rows.length / 2))],
          ["Admitted", from && to ? `${formatDate(from)} to ${formatDate(to)}` : "—"],
        ]}
        confirmLabel="Issue and print"
        loading={issue.isPending}
        loadingLabel="Issuing…"
        error={issue.error ? apiMessage(issue.error) : undefined}
      />
    </SidePanel>
  );
}

const lettersSchema = (session: number, ticked: string[]) =>
  z
    .object({
      totalDays: z.number({ error: "Enter the school days." }).int().min(1, { error: "Enter the school days." }),
      dated: z
        .string({ error: "Choose the date on the letters." })
        .min(1, { error: "Choose the date on the letters." })
        .refine((v) => v <= today(), { error: "The date can't be in the future." })
        .refine((v) => v >= sessionStart(session), { error: `Choose a date in this session (from ${formatDate(sessionStart(session))}).` }),
      days: z.record(z.string(), z.number()),
    })
    .superRefine((v, c) => {
      if (!ticked.length) c.addIssue({ code: "custom", path: ["students"], message: "Tick at least one student." });
      for (const g of ticked) {
        const n = v.days[g];
        if (n === undefined || n < 1) c.addIssue({ code: "custom", path: [`days:${g}`], message: "Enter the days present." });
        else if (n > v.totalDays) c.addIssue({ code: "custom", path: [`days:${g}`], message: "More than the school days." });
      }
    });

const digits = (v: string) => (v.replace(/\D/g, "") ? Number(v.replace(/\D/g, "")) : NaN);

/**
 * Appreciation letters for a class (legacy "Appreciation Letter" for the most regular students): pick a section, tick
 * the students with their days present (suggested from attendance), the school days and the date on the letters,
 * then issue and print every letter in one batch. Each letter gets its own serial number.
 */
export function LettersPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const classes = useQuery(metaQueries.classes(ctx.campus));
  const [cs, setCs] = useState("");
  const roster = useQuery({ ...studentDocsQueries.classRoster(ctx, cs), enabled: open && Boolean(cs) });
  const att = useQuery({ ...studentDocsQueries.classAttendance(ctx, cs), enabled: open && Boolean(cs) });
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [days, setDays] = useState<Record<string, string>>({});
  const [totalDays, setTotalDays] = useState("");
  const [dated, setDated] = useState<string | null>(today());
  const [remarks, setRemarks] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [initFor, setInitFor] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [issued, setIssued] = useState<StudentDocIssued[] | null>(null);
  const [skipped, setSkipped] = useState<Array<{ name: string; reason: string }>>([]);
  const [key, setKey] = useState(newIdempotencyKey);
  useEffect(() => {
    if (!open) return;
    setIssued(null);
    setSkipped([]);
    setConfirming(false);
    setErrors({});
    setDated(today());
    setRemarks("");
    setKey(newIdempotencyKey());
  }, [open]);
  // Suggest from attendance once per section: days present each, the school days, and the three most regular ticked.
  useEffect(() => {
    if (!cs || !att.data || initFor === cs) return;
    const list = [...att.data].sort((a, b) => b.present - a.present);
    setDays(Object.fromEntries(att.data.map((a) => [a.grNo, String(a.present)])));
    setTotalDays(String(Math.max(0, ...att.data.map((a) => a.total))));
    setTicked(new Set(list.slice(0, 3).map((a) => a.grNo)));
    setErrors({});
    setInitFor(cs);
  }, [cs, att.data, initFor]);

  const present = useMemo(() => new Map((att.data ?? []).map((a) => [a.grNo, a])), [att.data]);
  const rows = useMemo(() => [...(roster.data ?? [])].sort((a, b) => (present.get(b.grNo)?.present ?? 0) - (present.get(a.grNo)?.present ?? 0) || a.rollNo - b.rollNo), [roster.data, present]);
  const chosen = rows.filter((s) => ticked.has(s.grNo)).map((s) => s.grNo);
  const total = digits(totalDays);

  const review = () => {
    const r = lettersSchema(ctx.session, chosen).safeParse({ totalDays: total, dated: dated ?? "", days: Object.fromEntries(chosen.map((g) => [g, digits(days[g] ?? "") || 0])) });
    if (!r.success) {
      setErrors(Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setConfirming(true);
  };
  const issue = useMutation({
    mutationFn: () =>
      studentDocsApi.issue(
        ctx,
        {
          type: "APPRECIATION_LETTER",
          grNos: chosen,
          details: { totalDays: total, ...(dated ? { dated } : {}), ...(remarks.trim() ? { remarks: remarks.trim() } : {}) },
          detailsByGrNo: Object.fromEntries(chosen.map((g) => [g, { attendanceDays: digits(days[g] ?? "") }])),
        },
        key,
      ),
    onSuccess: (r) => {
      setConfirming(false);
      setIssued(r.issued);
      setSkipped(r.skipped);
      void queryClient.invalidateQueries({ queryKey: studentDocsQueries.all() });
      toast({ title: `${r.issued.length} appreciation ${r.issued.length === 1 ? "letter" : "letters"} issued for ${cs}`, message: r.skipped.length ? `${r.skipped.length} skipped. Printing now.` : "Printing now: one A4 page each." });
      printNow();
    },
  });
  const options = (classes.data ?? []).flatMap((c) => c.sections.map((s) => `${c.short}-${s}`));
  const editing = !issued;
  const columns: Array<Column<StudentDocSnapshot>> = [
    {
      key: "tick",
      header: "Letter",
      width: 70,
      render: (s) => (
        <Checkbox
          aria-label={`Letter for ${s.name}`}
          checked={ticked.has(s.grNo)}
          onChange={(e) =>
            setTicked((t) => {
              const n = new Set(t);
              if (e.target.checked) n.add(s.grNo);
              else n.delete(s.grNo);
              return n;
            })
          }
        />
      ),
    },
    { key: "rollNo", header: "Roll", width: 60, align: "right", render: (s) => <span className="tabular-nums">{s.rollNo}</span> },
    { key: "name", header: "Student", render: (s) => <span className="grid"><span className="mtb-cell-primary">{s.name}</span><span className="mtb-cell-secondary">{s.relation} {s.father} · <span className="mtb-mono">{s.grNo}</span></span></span> },
    {
      key: "days",
      header: "Days present",
      width: 150,
      render: (s) => (
        <Input
          aria-label={`Days present, ${s.name}`}
          inputMode="numeric"
          disabled={!ticked.has(s.grNo)}
          value={days[s.grNo] ?? ""}
          error={errors[`days:${s.grNo}`]}
          onChange={(e) => setDays((d) => ({ ...d, [s.grNo]: e.target.value.replace(/\D/g, "") }))}
          suffix={Number.isFinite(total) && total > 0 ? `/ ${total}` : undefined}
        />
      ),
    },
    {
      key: "att",
      header: "Attendance",
      width: 100,
      align: "right",
      render: (s) => {
        const n = digits(days[s.grNo] ?? "");
        return Number.isFinite(n) && total > 0 ? <span className="tabular-nums">{Math.round((n / total) * 1000) / 10}%</span> : <span className="text-ink-subtle">—</span>;
      },
    },
  ];
  const letters: DocInput[] = (issued ?? []).map((d) => ({ type: d.type, serialNo: d.serialNo, issuedOn: d.issuedOn, issuedBy: d.issuedBy, details: d.details, snapshot: d.snapshot, copy: 1 }));
  return (
    <SidePanel
      open={open}
      onClose={onClose}
      wide
      title={issued ? `${issued.length} appreciation letters issued` : "Appreciation letters for a class"}
      description="One letter per student, each with its own serial number, printed on A4."
      footer={
        issued ? (
          <>
            <Button onClick={onClose}>Done</Button>
            <Button variant="primary" icon="printer" onClick={() => window.print()}>
              Print again
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" icon="star" disabled={!rows.length} onClick={review}>
              Issue {chosen.length} {chosen.length === 1 ? "letter" : "letters"} and print
            </Button>
          </>
        )
      }
    >
      <div className="grid gap-4">
        {editing && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Class and section"
              required
              value={cs}
              onChange={(e) => {
                setCs(e.target.value);
                setInitFor("");
              }}
              options={[{ value: "", label: "Choose…" }, ...options]}
            />
            <DatePicker label="Date on the letters" required value={dated} onValueChange={setDated} today={today()} minDate={sessionStart(ctx.session)} maxDate={today()} error={errors.dated} help="Today, or the day they were signed." />
            <Input label="School days in the session" required inputMode="numeric" value={totalDays} error={errors.totalDays} onChange={(e) => setTotalDays(e.target.value.replace(/\D/g, ""))} help="From attendance; the same for every letter." />
            <Input label="Remarks (printed on every letter)" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
        )}
        {skipped.length > 0 && (
          <Banner tone="warning" title={`${skipped.length} not issued`}>
            {skipped.map((s) => `${s.name}: ${s.reason}`).join(" ")}
          </Banner>
        )}
        {(roster.isError || att.isError) && <LoadError what="class list" error={roster.error ?? att.error} onRetry={() => void Promise.all([roster.refetch(), att.refetch()])} />}
        {issued ? (
          <PrintSheet paper="A4" label={`Appreciation letters ${cs}`} zoom={0.5}>
            {letters.map((d) => (
              <AppreciationLetter key={d.serialNo} d={d} />
            ))}
          </PrintSheet>
        ) : !cs ? (
          <EmptyState icon="star" title="Choose a class and section" description="The students are listed with their days present this session; the three most regular are ticked." />
        ) : roster.isLoading || att.isLoading ? (
          <Skeleton height={280} />
        ) : (
          <>
            {errors.students && <Banner tone="danger">{errors.students}</Banner>}
            <DataTable caption={`Students of ${cs}`} columns={columns} rows={rows} rowKey="grNo" density="dense" maxHeight={440} empty={<EmptyState icon="students" title="No students" description={`Nobody is enrolled in ${cs}.`} />} />
            <p className="m-0 text-small text-ink-muted">{`${chosen.length} ticked of ${rows.length}. Most regular first.`}</p>
          </>
        )}
        {issue.error && !confirming && <Banner tone="danger">{apiMessage(issue.error)}</Banner>}
      </div>
      <ConfirmDialog
        open={confirming}
        onClose={() => {
          setConfirming(false);
          issue.reset();
        }}
        onConfirm={() => issue.mutate()}
        icon="star"
        title={`Issue ${chosen.length} appreciation ${chosen.length === 1 ? "letter" : "letters"} for ${cs}?`}
        message="Each student gets a letter with its own serial number in the register. A reprint later is logged with a reason."
        details={[
          ["Class", cs],
          ["Letters", String(chosen.length)],
          ["School days", String(total)],
          ["Date on the letters", dated ? formatDate(dated) : "—"],
        ]}
        confirmLabel="Issue and print"
        loading={issue.isPending}
        loadingLabel="Issuing…"
        error={issue.error ? apiMessage(issue.error) : undefined}
      />
    </SidePanel>
  );
}

/** Admission forms (the full student record) for every student of a section, one A4 page each. */
export function AdmissionFormsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ctx = useCtx();
  const classes = useQuery(metaQueries.classes(ctx.campus));
  const [cs, setCs] = useState("");
  const roster = useQuery({ ...studentDocsQueries.classRoster(ctx, cs, true), enabled: open && Boolean(cs) });
  const options = (classes.data ?? []).flatMap((c) => c.sections.map((s) => `${c.short}-${s}`));
  return (
    <SidePanel
      open={open}
      onClose={onClose}
      wide
      title="Admission forms for a class"
      description="The full record of each student on one A4 page: personal, academic, family and guardian, emergency contact, siblings and other information."
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" icon="printer" disabled={!roster.data?.length} onClick={printNow}>
            Print {roster.data?.length ?? 0} {roster.data?.length === 1 ? "form" : "forms"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Select label="Class and section" value={cs} onChange={(e) => setCs(e.target.value)} options={[{ value: "", label: "Choose…" }, ...options]} />
        {roster.isError && <LoadError what="class list" error={roster.error} onRetry={() => void roster.refetch()} />}
        {cs && roster.isLoading && <Skeleton height={320} />}
        {cs && roster.data?.length === 0 && <EmptyState icon="students" title="No students" description={`Nobody is enrolled in ${cs}.`} />}
        {roster.data && roster.data.length > 0 && (
          <PrintSheet paper="A4" label={`Admission forms ${cs}`} zoom={0.5}>
            {roster.data.map((s) => (
              <StudentRecordForm key={s.grNo} s={s} printedOn={today()} />
            ))}
          </PrintSheet>
        )}
      </div>
    </SidePanel>
  );
}
