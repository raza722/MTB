import { activitiesApi, activitiesQueries, ACTIVITIES_FEE_HEAD_LABEL, ACTIVITIES_FEE_HEADS, type ActivitiesAwardInput, type ActivitiesFeeHead, type ActivitiesHeadValues, type ActivitiesPerson } from "@mtb/api";
import { formatRs } from "@mtb/domain";
import { Banner, Button, Checkbox, DatePicker, Input, Segmented, Select, SidePanel, Skeleton, StatusBadge, Textarea, useToast } from "@mtb/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { z } from "zod";
import { useCtx } from "../../app/session";
import { dateLimits, errorField, errorText, monthStart, nextMonthStart, PersonChip, StudentSearch, useRefresh, useSessionDays, useToday } from "./shared";

const schema = z.object({
  student: z.string().min(1, "Search for the student or applicant and pick them from the list."),
  scheme: z.string().min(1, "Choose the scheme."),
  value: z.number({ error: "Enter the amount." }),
  feeHeads: z.array(z.string()).min(1, "Tick at least one fee."),
  from: z.string({ error: "Choose the first day it applies." }).min(1, "Choose the first day it applies."),
  reason: z.string().trim().min(10, "Say why in a sentence: the family's situation, the result or the relationship."),
});

/** The application form's details (legacy Scholarship Application): all optional except the date when the section is open. */
const applicationSchema = z
  .object({
    submittedOn: z.string({ error: "Choose the date the form was handed in." }).min(1, "Choose the date the form was handed in."),
    examName: z.string(),
    obtained: z.string(),
    total: z.string(),
  })
  .superRefine((v, ctx) => {
    if (!v.examName.trim() && !v.obtained && !v.total) return;
    if (!v.examName.trim()) ctx.addIssue({ code: "custom", path: ["examName"], message: "Name the last examination, for example “Class 8 annual 2026”." });
    const o = Number(v.obtained);
    const t = Number(v.total);
    if (!v.total || !Number.isFinite(t) || t <= 0) ctx.addIssue({ code: "custom", path: ["total"], message: "Enter the total marks." });
    else if (v.obtained === "" || !Number.isFinite(o) || o < 0 || o > t) ctx.addIssue({ code: "custom", path: ["obtained"], message: `Enter the marks obtained, from 0 to ${t}.` });
  });

const HEAD_SHORT: Record<ActivitiesFeeHead, string> = { TUITION: "Tuition", ANNUAL: "Annual charges", ADMISSION: "Admission fee" };

/** Propose a scholarship or concession for one student or admission applicant. It waits for the principal's or admin's approval. */
export function NewAwardPanel({ onClose }: { onClose: (createdId?: string) => void }) {
  const ctx = useCtx();
  const today = useToday();
  const { ends } = useSessionDays();
  // This month's vouchers may still be open; the first voucher not yet raised is next month's.
  const firstOpen = monthStart(today);
  const toast = useToast();
  const refresh = useRefresh();
  const schemes = useQuery(activitiesQueries.schemes(ctx));
  const choosable = (schemes.data ?? []).filter((s) => s.active && !s.needsTest);
  const [person, setPerson] = useState<ActivitiesPerson | null>(null);
  const [schemeId, setSchemeId] = useState("");
  const [value, setValue] = useState("");
  const [heads, setHeads] = useState<ActivitiesFeeHead[]>([]);
  const [perHead, setPerHead] = useState(false);
  const [headValues, setHeadValues] = useState<Partial<Record<ActivitiesFeeHead, string>>>({});
  const [from, setFrom] = useState<string | null>(nextMonthStart(today));
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [appOpen, setAppOpen] = useState(false);
  const [app, setApp] = useState({ submittedOn: today as string | null, receiptNo: "", examName: "", rollNo: "", obtained: "", total: "", previousSchool: "", staffParentId: "", subjectGroup: "" });
  const [tried, setTried] = useState(false);
  const scheme = choosable.find((s) => s.id === schemeId);
  const fixed = scheme?.basis === "FIXED";
  const applicant = Boolean(person?.isApplicant);
  const staffChild = scheme?.kind === "STAFF_CHILD";
  const staff = useQuery({ ...activitiesQueries.staff(ctx), enabled: appOpen && Boolean(staffChild) });
  // The admission fee can only be reduced for someone not yet admitted.
  const headChoices = ACTIVITIES_FEE_HEADS.filter((h) => h !== "ADMISSION" || applicant);
  const ticked = headChoices.filter((h) => heads.includes(h));
  const usePer = !fixed && perHead && ticked.length > 0;
  const perNums: ActivitiesHeadValues = Object.fromEntries(ticked.map((h) => [h, Number(headValues[h] ?? "")]));
  // With a % per fee, the award's headline % is the tuition one (else the first fee ticked).
  const num = usePer ? (perNums.TUITION ?? perNums[ticked[0]!] ?? 0) : Number(value);

  const check = schema.safeParse({ student: person?.id ?? "", scheme: schemeId, value: usePer ? num : value === "" ? undefined : num, feeHeads: fixed ? ["TUITION"] : ticked, from: from ?? "", reason });
  const errs: Record<string, string> = check.success ? {} : Object.fromEntries(check.error.issues.map((i) => [String(i.path[0]), i.message]));
  if (scheme && !usePer && value !== "") {
    if (!fixed && (!Number.isInteger(num) || num < 1 || num > 100)) errs.value = "Enter a whole percentage from 1 to 100.";
    if (fixed && (!Number.isInteger(num) || num < 100)) errs.value = "Enter whole rupees, at least Rs 100.";
  }
  if (usePer) {
    delete errs.value;
    for (const h of ticked) {
      const raw = headValues[h] ?? "";
      const n = Number(raw);
      if (raw === "" || !Number.isInteger(n) || n < 1 || n > 100) errs[`values.${h}`] = `Enter the % off ${HEAD_SHORT[h].toLowerCase()}, a whole number from 1 to 100.`;
    }
  }
  if (scheme && scheme.evidence.length > 0 && !evidence.trim()) errs.evidence = `Note the documents you have seen (${scheme.evidence.join(", ").toLowerCase()}).`;
  if (appOpen) {
    const a = applicationSchema.safeParse({ submittedOn: app.submittedOn ?? "", examName: app.examName, obtained: app.obtained, total: app.total });
    if (!a.success) for (const i of a.error.issues) errs[`app.${String(i.path[0])}`] ??= i.message;
    if (app.submittedOn && app.submittedOn > today) errs["app.submittedOn"] ??= "The date can't be after today.";
  }
  const valid = Object.keys(errs).length === 0;

  const valuesOut: ActivitiesHeadValues | undefined = usePer ? perNums : undefined;
  const okForPreview = usePer ? ticked.every((h) => !errs[`values.${h}`]) : value !== "" && !errs.value;
  const preview = useDeferredValue(person && scheme && okForPreview && from ? { studentId: person.id, schemeId: scheme.id, value: num, feeHeads: fixed ? (["TUITION"] as ActivitiesFeeHead[]) : ticked, effectiveFrom: from, ...(valuesOut ? { values: valuesOut } : {}) } : null);
  const fx = useQuery(activitiesQueries.feePreview(ctx, preview));

  const application: ActivitiesAwardInput["application"] | undefined = appOpen
    ? {
        submittedOn: app.submittedOn!,
        ...(app.receiptNo.trim() ? { receiptNo: app.receiptNo.trim() } : {}),
        ...(app.examName.trim() ? { lastExam: { name: app.examName.trim(), ...(app.rollNo.trim() ? { rollNo: app.rollNo.trim() } : {}), obtained: Number(app.obtained), total: Number(app.total) } } : {}),
        ...(app.previousSchool.trim() ? { previousSchool: app.previousSchool.trim() } : {}),
        ...(staffChild && app.staffParentId ? { staffParentId: app.staffParentId } : {}),
        ...(app.subjectGroup.trim() ? { subjectGroup: app.subjectGroup.trim() } : {}),
      }
    : undefined;

  const save = useMutation({
    mutationFn: () =>
      activitiesApi.proposeAward(ctx, {
        studentId: person!.id,
        schemeId,
        value: num,
        feeHeads: fixed ? ["TUITION"] : ticked,
        effectiveFrom: from!,
        reason: reason.trim(),
        evidence: evidence.trim(),
        ...(valuesOut ? { values: valuesOut } : {}),
        ...(application ? { application } : {}),
      }),
    onSuccess: (a) => {
      refresh();
      toast({ title: "Scholarship proposed", message: `${a.studentName} · ${a.awardNo}. It now waits for the principal's or admin's approval.${a.isApplicant ? " It applies once the applicant is admitted." : ""}` });
      onClose(a.id);
    },
  });
  const serverField = save.isError ? errorField(save.error) : undefined;
  const show = (f: string) => (tried ? errs[f] : undefined) ?? (serverField === f || (f === "student" && serverField === "studentId") || (f === "scheme" && serverField === "schemeId") || (f === "from" && serverField === "effectiveFrom") ? errorText(save.error) : undefined);

  return (
    <SidePanel
      open
      wide
      onClose={() => onClose()}
      title="Propose a scholarship"
      description="For a student or an admission applicant: need, Hafiz, sibling, staff-child and other concessions. Merit scholarships come from a scholarship test's merit list."
      footer={
        <>
          <Button onClick={() => onClose()}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            loadingLabel="Sending…"
            onClick={() => {
              setTried(true);
              if (valid) save.mutate();
            }}
          >
            Send for approval
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {person ? (
          <div className="grid gap-1">
            <span className="mtb-label">{applicant ? "Applicant" : "Student"}</span>
            <div className="flex flex-wrap items-center gap-2">
              <PersonChip person={person} onRemove={() => setPerson(null)} />
              {applicant && (
                <StatusBadge status="info" dot={false}>
                  Applicant
                </StatusBadge>
              )}
            </div>
            <span className="text-small text-ink-muted">
              {applicant ? `${person.father} · applying for ${person.classSection}${person.previousSchool ? ` · from ${person.previousSchool}` : ""}. The award applies once admitted.` : `${person.father} · ${person.house ?? "No house"}`}
            </span>
          </div>
        ) : (
          <StudentSearch
            label="Student or applicant"
            applicants
            onPick={(p) => {
              setPerson(p);
              if (p.isApplicant && p.previousSchool) setApp((a) => ({ ...a, previousSchool: a.previousSchool || p.previousSchool! }));
            }}
            placeholder="Name, G.R. or application number, or father's name"
            error={show("student")}
          />
        )}

        <Select
          label="Scheme"
          required
          value={schemeId}
          onChange={(e) => {
            const s = choosable.find((x) => x.id === e.target.value);
            setSchemeId(e.target.value);
            if (s) {
              setValue(String(s.value));
              setHeads(s.feeHeads);
              setHeadValues(Object.fromEntries(s.feeHeads.map((h) => [h, String(s.value)])));
            }
          }}
          error={show("scheme")}
          help={scheme ? scheme.criteria : "Only schemes that are switched on are listed."}
          options={[{ value: "", label: schemes.isLoading ? "Loading…" : "Choose…" }, ...choosable.map((s) => ({ value: s.id, label: `${s.name} (${s.basis === "FIXED" ? `${formatRs(s.value)} a month` : `${s.value}%`})` }))]}
        />

        {scheme && (
          <>
            {!fixed && (
              <fieldset className="m-0 grid gap-2 border-0 p-0">
                <legend className="mtb-label mb-1">Fees it takes money off</legend>
                {headChoices.map((h) => (
                  <Checkbox
                    key={h}
                    label={ACTIVITIES_FEE_HEAD_LABEL[h]}
                    checked={heads.includes(h)}
                    onChange={(e) => {
                      setHeads((x) => (e.target.checked ? [...x, h] : x.filter((y) => y !== h)));
                      if (e.target.checked && headValues[h] === undefined) setHeadValues((v) => ({ ...v, [h]: value || String(scheme.value) }));
                    }}
                  />
                ))}
                {tried && errs.feeHeads && <span className="mtb-error">{errs.feeHeads}</span>}
              </fieldset>
            )}
            {!fixed && ticked.length > 1 && (
              <Segmented
                aria-label="Percentage"
                value={perHead ? "per" : "same"}
                onChange={(v) => {
                  setPerHead(v === "per");
                  if (v === "per") setHeadValues((hv) => Object.fromEntries(ticked.map((h) => [h, hv[h] ?? value])));
                }}
                options={[
                  { value: "same", label: "Same % for every fee" },
                  { value: "per", label: "Different % per fee" },
                ]}
              />
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {usePer ? (
                ticked.map((h) => (
                  <Input
                    key={h}
                    label={`${HEAD_SHORT[h]} off`}
                    required
                    inputMode="numeric"
                    suffix="%"
                    amount
                    value={headValues[h] ?? ""}
                    onChange={(e) => setHeadValues((v) => ({ ...v, [h]: e.target.value.replace(/[^\d.]/g, "") }))}
                    error={show(`values.${h}`)}
                  />
                ))
              ) : (
                <Input
                  label={fixed ? "Off the tuition each month" : "Percentage off"}
                  required
                  inputMode="numeric"
                  prefix={fixed ? "Rs" : undefined}
                  suffix={fixed ? undefined : "%"}
                  amount
                  value={value}
                  onChange={(e) => setValue(e.target.value.replace(fixed ? /\D/g : /[^\d.]/g, ""))}
                  error={show("value")}
                  help={`The scheme's usual figure is ${fixed ? formatRs(scheme.value) : `${scheme.value}%`}.`}
                />
              )}
              <DatePicker label="Applies from" required value={from} onValueChange={setFrom} {...dateLimits(firstOpen, ends)} today={today} error={show("from")} help="Vouchers already posted are not changed." />
            </div>
          </>
        )}

        <Textarea label="Why" required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} error={show("reason")} placeholder="For example: father lost his job at the sugar mill in September; four children at school." />
        <Input label="Documents seen" required={Boolean(scheme?.evidence.length)} value={evidence} onChange={(e) => setEvidence(e.target.value)} error={show("evidence")} help={scheme?.evidence.length ? `Keep on file: ${scheme.evidence.join(", ")}.` : undefined} />

        <section className="grid gap-3 rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="m-0 text-body-strong">Application form</h3>
            <Button size="sm" variant="ghost" icon={appOpen ? "chevronUp" : "chevronDown"} aria-expanded={appOpen} onClick={() => setAppOpen((o) => !o)}>
              {appOpen ? "Leave out" : "Add the form's details"}
            </Button>
          </div>
          {appOpen ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <DatePicker label="Handed in on" required value={app.submittedOn} onValueChange={(d) => setApp({ ...app, submittedOn: d })} maxDate={today} today={today} error={show("app.submittedOn") ?? (serverField === "submittedOn" ? errorText(save.error) : undefined)} />
              <Input label="Receipt no." mono value={app.receiptNo} onChange={(e) => setApp({ ...app, receiptNo: e.target.value })} />
              <Input label="Last examination" value={app.examName} onChange={(e) => setApp({ ...app, examName: e.target.value })} placeholder="For example: Class 8 annual 2026" error={show("app.examName")} />
              <Input label="Roll no." mono value={app.rollNo} onChange={(e) => setApp({ ...app, rollNo: e.target.value })} />
              <Input label="Marks obtained" inputMode="numeric" amount value={app.obtained} onChange={(e) => setApp({ ...app, obtained: e.target.value.replace(/[^\d.]/g, "") })} error={show("app.obtained") ?? (serverField === "lastExam" ? errorText(save.error) : undefined)} />
              <Input label="Total marks" inputMode="numeric" amount value={app.total} onChange={(e) => setApp({ ...app, total: e.target.value.replace(/\D/g, "") })} error={show("app.total")} />
              <Input label="Previous school" value={app.previousSchool} onChange={(e) => setApp({ ...app, previousSchool: e.target.value })} />
              <Input label="Subject group" value={app.subjectGroup} onChange={(e) => setApp({ ...app, subjectGroup: e.target.value })} placeholder="For example: Science (Computer)" />
              {staffChild && (
                <Select
                  label="Parent on the staff"
                  value={app.staffParentId}
                  onChange={(e) => setApp({ ...app, staffParentId: e.target.value })}
                  options={[{ value: "", label: staff.isLoading ? "Loading…" : "Choose…" }, ...(staff.data ?? []).map((s) => ({ value: s.id, label: `${s.name} · ${s.designation}` }))]}
                  error={serverField === "staffParentId" ? errorText(save.error) : undefined}
                />
              )}
            </div>
          ) : (
            <p className="m-0 text-small text-ink-muted">Optional: the date the form was handed in, its receipt no., last examination and marks, previous school{staffChild ? ", the parent on the staff" : ""} and subject group.</p>
          )}
        </section>

        <section className="grid gap-2 rounded-md border border-border p-3" aria-live="polite">
          <h3 className="m-0 text-body-strong">What it does to the fees</h3>
          {!preview ? (
            <p className="m-0 text-small text-ink-muted">Choose the student, scheme and amount to see the effect on their vouchers.</p>
          ) : fx.isLoading ? (
            <Skeleton height={60} />
          ) : fx.data ? (
            <>
              <ul className="m-0 grid list-none gap-1 p-0 text-small">
                {fx.data.lines.map((l) => (
                  <li key={l.head} className="flex justify-between gap-2">
                    <span>{l.label}</span>
                    <span className="mtb-num">
                      <span className="text-ink-muted line-through">{formatRs(l.before)}</span> → <b>{formatRs(l.after)}</b> {l.per === "month" ? "a month" : l.per === "year" ? "a year" : "once"}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="m-0 text-small">
                <b>{formatRs(fx.data.monthly)}</b> a month off tuition · <b>{formatRs(fx.data.session)}</b> this session ({fx.data.months} {fx.data.months === 1 ? "month" : "months"} from the {fx.data.firstVoucher} voucher)
              </p>
              <p className="m-0 text-small text-ink-muted">Shown for checking only. The fees office applies it once the award is approved{applicant ? " and the applicant is admitted" : ""}.</p>
            </>
          ) : (
            <p className="m-0 text-small text-ink-muted">{errorText(fx.error)}</p>
          )}
        </section>

        {save.isError && !(serverField && ["studentId", "schemeId", "effectiveFrom", "value", "reason", "evidence", "submittedOn", "lastExam", "staffParentId"].includes(serverField)) && !serverField?.startsWith("values.") && <Banner tone="danger">{errorText(save.error)}</Banner>}
      </div>
    </SidePanel>
  );
}
