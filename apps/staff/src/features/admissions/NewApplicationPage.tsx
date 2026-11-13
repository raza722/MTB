import { admissionsApi, admissionsMatchLabel, admissionsQueries, ApiError, newIdempotencyKey, type AdmissionsApplicant, type AdmissionsApplicationInput } from "@mtb/api";
import { formatCnic, formatDate, formatRs, isValidCnic, normalizeMobile } from "@mtb/domain";
import { Avatar, Banner, Button, buttonClassName, CnicInput, DatePicker, EmptyState, Icon, Input, KeyValue, Modal, Panel, Radio, Select, Skeleton, StatusBadge, Stepper, Switch, Textarea, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { campusLabel } from "../../app/shell/campus";
import { Page, PageHeader, RequireSingleCampus } from "../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { PrintSheet, printNow } from "../students/documents/print";
import { BlankAdmissionForm } from "../students/documents/templates";
import { apiMessage, fieldError } from "../students/shared";
import { ChildExtrasFields, childExtrasSchema, EMPTY_EXTRAS, extrasBody, FamilyExtrasFields, familyExtrasSchema, type ExtrasForm } from "./extras";
import { AdmissionsSubNav, feeOrDash, sittingWhen, sittingWhenWhere, today } from "./shared";
import { ApplicationForm, TestSlip } from "./slips";

const CHILD_FIELDS = ["name", "dob", "classApplied", "bForm", "birthCertificateNo", "religion", "disability", "identificationMark"];
const FAMILY_FIELDS = ["father", "fatherCnic", "mobile", "address", "email", "homePhone", "city", "tempAddress", "emergencyName", "emergencyMobile1", "emergencyMobile2"];

const STEPS = ["Child", "Family", "Class, test and fee", "Review"];

type Form = AdmissionsApplicationInput;

const EMPTY: Form = { name: "", nameUr: "", gender: "F", dob: "", bForm: "", previousSchool: "", classApplied: "", father: "", fatherCnic: "", mother: "", mobile: "", address: "", feePaidNow: true };

const childSchema = z.object({
  name: z.string().trim().min(3, { error: "Enter the child's full name." }),
  dob: z.string().min(1, { error: "Enter the date of birth." }),
  classApplied: z.string().min(1, { error: "Choose the class applied for." }),
  bForm: z.string().refine((v) => !v || isValidCnic(v), { error: "A B-form number has 13 digits." }),
});
const familySchema = z.object({
  father: z.string().trim().min(3, { error: "Enter the father's name." }),
  fatherCnic: z.string().refine((v) => !v || isValidCnic(v), { error: "A CNIC has 13 digits, e.g. 36302-4567890-1." }),
  mobile: z.string().refine((v) => normalizeMobile(v) !== null, { error: "Enter a Pakistani mobile number, e.g. 0300-1234567." }),
  address: z.string().trim().min(8, { error: "Enter the full address: house, street and area." }),
});

/** Age on 1 April of the session applied for, the way admission rules count it. */
function ageOn(dob: string, session: number): string {
  if (!dob) return "";
  const [y, m, d] = dob.split("-").map(Number) as [number, number, number];
  let years = session - y;
  if (m > 4 || (m === 4 && d > 1)) years -= 1;
  return `${years} ${years === 1 ? "year" : "years"} on 01-Apr-${session}`;
}

/** The blank two-page admission form, for families who fill it in by hand. */
export function BlankFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ctx = useCtx();
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Blank admission form"
      description="Two A4 pages: the family fills them in by hand; the office types them into a new application."
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" icon="printer" onClick={printNow}>
            Print
          </Button>
        </>
      }
    >
      {open && (
        <PrintSheet paper="A4" label="Blank admission form" zoom={0.55}>
          <BlankAdmissionForm campusName={ctx.campus === "ALL" ? "" : campusLabel(ctx.campus)} session={ctx.session} />
        </PrintSheet>
      )}
    </Modal>
  );
}

export function NewApplicationPage({ enquiryId }: { enquiryId: string }) {
  const ctx = useCtx();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canManage = useCan("admissions.manage");
  const readOnly = useReadOnly();
  const setup = useQuery({ ...admissionsQueries.setup(ctx), enabled: ctx.campus !== "ALL" });
  const enquiries = useQuery({ ...admissionsQueries.enquiries(ctx), enabled: Boolean(enquiryId) });
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>(EMPTY);
  const [extras, setExtras] = useState<ExtrasForm>(EMPTY_EXTRAS);
  const [blankForm, setBlankForm] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [key, setKey] = useState(newIdempotencyKey);
  const [done, setDone] = useState<AdmissionsApplicant | null>(null);
  const [printing, setPrinting] = useState<null | "form" | "slip">(null);

  // Start from the enquiry when there is one.
  useEffect(() => {
    const e = enquiries.data?.find((x) => x.id === enquiryId);
    if (!e) return;
    setForm((f) => ({ ...f, name: e.childName, gender: e.gender, father: e.parentName, mobile: e.mobile, classApplied: e.classInterest, enquiryId: e.id }));
  }, [enquiries.data, enquiryId]);

  const check = useQuery({ ...admissionsQueries.check(ctx, { name: form.name, father: form.father, fatherCnic: form.fatherCnic, dob: form.dob }), enabled: step >= 1 && (form.fatherCnic.length === 13 || (form.name.trim().length >= 3 && form.father.trim().length >= 3)) });
  const rule = setup.data?.classes.find((c) => c.classApplied === form.classApplied);
  const sittings = (setup.data?.tests ?? []).filter((t) => t.classApplied === form.classApplied && t.date >= today()).sort((a, b) => a.date.localeCompare(b.date));
  const chosenTest = sittings.find((t) => t.id === form.testId);
  const streams = rule?.streams ?? [];
  const groupPapers = Boolean(chosenTest?.subjects.some((s) => s.stream));

  const apply = useMutation({
    mutationFn: () => admissionsApi.apply(ctx, { ...form, ...extrasBody(extras), ...(form.stream ? { stream: form.stream } : {}), ...(rule?.testRequired ? {} : { feePaidNow: false }) }, key),
    onSuccess: (a) => {
      setDone(a);
      void queryClient.invalidateQueries({ queryKey: admissionsQueries.all() });
      toast({ title: `Application ${a.applicationNo} saved`, message: a.testDate ? `Entrance test on ${formatDate(a.testDate)}${a.testRollNo ? ` · seat ${a.testRollNo}` : ""}` : a.directAdmission ? "No test for this class: the principal can offer a seat after the interview." : "Book the entrance test when the fee is paid." });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.field) setStep(CHILD_FIELDS.includes(e.field) ? 0 : FAMILY_FIELDS.includes(e.field) ? 1 : 2);
    },
  });

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const setX = (patch: Partial<ExtrasForm>) => setExtras((x) => ({ ...x, ...patch }));
  const err = (f: string) => errors[f] ?? fieldError(apply.error, f);
  const next = () => {
    const found: Record<string, string> = {};
    const check = (r: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }) => {
      if (!r.success) for (const i of r.error!.issues) found[String(i.path[0])] ??= i.message;
    };
    if (step === 0) {
      check(childSchema.safeParse(form));
      check(childExtrasSchema.safeParse(extras));
    }
    if (step === 1) {
      check(familySchema.safeParse(form));
      check(familyExtrasSchema.safeParse(extras));
    }
    if (step === 2 && groupPapers && !form.stream) found.stream = "This sitting has a paper for each group. Choose the child's group.";
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }
    setErrors({});
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };
  const reset = () => {
    setForm(EMPTY);
    setExtras(EMPTY_EXTRAS);
    setStep(0);
    setDone(null);
    setErrors({});
    setKey(newIdempotencyKey());
    apply.reset();
  };

  const classes = setup.data?.classes ?? [];
  const family = check.data?.family;
  const matches = (check.data?.matches ?? []).filter((m) => m.strength >= 60);

  return (
    <Page>
      <PageHeader
        title="New application"
        actions={
          <Button icon="printer" variant="quiet" onClick={() => setBlankForm(true)}>
            Print blank form
          </Button>
        }
      />
      <AdmissionsSubNav />
      <RequireSingleCampus action="new applications">
        {!canManage || readOnly ? (
          <Banner tone="info">{readOnly ? "Past sessions are read-only. Switch to the current session, or next year's planned session, to take applications." : "Only the admissions office, the principal or an admin can take applications."}</Banner>
        ) : done ? (
          <Panel id="app-done" rise={0} title="Application saved" description="Hand the family their copy and the test slip.">
            <div className="grid gap-5">
              <div className="flex flex-wrap items-center gap-4 rounded-lg bg-success-tint p-4">
                <span className="grid h-12 w-12 place-content-center rounded-full bg-success text-on-brand" aria-hidden="true">
                  <Icon name="check" size={24} />
                </span>
                <div className="grid flex-1">
                  <span className="text-title-2 text-success-ink">{done.applicationNo}</span>
                  <span className="text-small text-success-ink">
                    {done.name} · {done.classApplied}
                    {done.testDate ? ` · entrance test ${formatDate(done.testDate)}${done.testRollNo ? `, seat ${done.testRollNo}` : ""}` : done.directAdmission ? " · admitted on interview, no test" : " · test not booked yet"}
                    {done.fee ? ` · candidate fee ${done.fee.status === "PAID" ? `paid${done.fee.receiptNo ? ` (${done.fee.receiptNo})` : ""}` : "due"}` : ""}
                  </span>
                </div>
              </div>
              {done.siblings && done.siblings.length > 0 && <Banner tone="info" icon="home">{`Linked to the family of ${done.siblings.map((s) => `${s.name} (${s.classSection})`).join(", ")}.`}</Banner>}
              <div className="flex flex-wrap gap-2">
                <Button icon="printer" onClick={() => setPrinting("form")}>
                  Print application form
                </Button>
                {done.testRollNo && done.fee?.status === "PAID" && (
                  <Button icon="printer" onClick={() => setPrinting("slip")}>
                    Print test slip
                  </Button>
                )}
                <Link to="/admissions" search={(prev: Record<string, unknown>) => ({ ...prev, applicant: done.id }) as never} className={buttonClassName({})}>
                  Open in the pipeline
                </Link>
                <Button variant="primary" icon="plus" onClick={reset}>
                  Next application
                </Button>
              </div>
            </div>
          </Panel>
        ) : (
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Panel id="app-form" rise={0} title={STEPS[step]!} description={`Step ${step + 1} of ${STEPS.length}`} actions={<Stepper steps={STEPS} current={step} label="Application steps" />}>
              <div className="grid gap-5">
                {step === 0 && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input label="Child's full name" required value={form.name} error={err("name")} onChange={(e) => set({ name: e.target.value })} />
                    <Input label="Name in Urdu" urdu value={form.nameUr ?? ""} onChange={(e) => set({ nameUr: e.target.value })} />
                    <fieldset className="m-0 flex items-center gap-4 border-0 p-0">
                      <legend className="mtb-label mb-1">Gender</legend>
                      <Radio name="app-gender" label="Girl" checked={form.gender === "F"} onChange={() => set({ gender: "F" })} />
                      <Radio name="app-gender" label="Boy" checked={form.gender === "M"} onChange={() => set({ gender: "M" })} />
                    </fieldset>
                    <DatePicker label="Date of birth" required value={form.dob || null} maxDate={today()} onValueChange={(v) => set({ dob: v ?? "" })} error={err("dob")} help={ageOn(form.dob, ctx.session) || "As on the B-form or birth certificate."} />
                    <CnicInput label="B-form number" value={form.bForm ?? ""} onValueChange={(v) => set({ bForm: v })} error={err("bForm")} help="Optional. 13 digits, from NADRA." />
                    <Input label="Previous school" value={form.previousSchool ?? ""} onChange={(e) => set({ previousSchool: e.target.value })} placeholder="None for a first school" />
                    <Select label="Class applied for" required value={form.classApplied} error={err("classApplied")} onChange={(e) => set({ classApplied: e.target.value, testId: undefined, stream: undefined })} options={[{ value: "", label: "Choose…" }, ...classes.map((c) => ({ value: c.classApplied, label: `${c.classApplied}${c.testRequired ? " · entrance test" : " · interview"}` }))]} />
                    <ChildExtrasFields value={extras} onChange={setX} errors={{ birthCertificateNo: err("birthCertificateNo") }} />
                  </div>
                )}
                {step === 1 && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input label="Father's name" required value={form.father} error={err("father")} onChange={(e) => set({ father: e.target.value })} />
                    <CnicInput label="Father's CNIC" value={form.fatherCnic} onValueChange={(v) => set({ fatherCnic: v })} error={err("fatherCnic")} help="Links brothers and sisters already at MTB, at any campus." />
                    <Input label="Mother's name" value={form.mother ?? ""} onChange={(e) => set({ mother: e.target.value })} />
                    <Input label="Mobile for SMS" required inputMode="tel" value={form.mobile} error={err("mobile")} onChange={(e) => set({ mobile: e.target.value })} />
                    <div className="sm:col-span-2">
                      <Textarea label="Home address" required rows={2} value={form.address} error={err("address")} onChange={(e) => set({ address: e.target.value })} />
                    </div>
                    <FamilyExtrasFields
                      value={extras}
                      onChange={setX}
                      errors={{ email: err("email"), homePhone: err("homePhone"), emergencyName: err("emergencyName"), emergencyMobile1: err("emergencyMobile1"), emergencyMobile2: err("emergencyMobile2") }}
                    />
                    {!form.fatherCnic && <div className="sm:col-span-2"><Banner tone="warning">Without the father's CNIC, siblings can't be linked and the record is harder to match later. Ask the family for it if they have it.</Banner></div>}
                  </div>
                )}
                {step === 2 && (
                  <div className="grid gap-4">
                    {rule && streams.length > 0 && (
                      <Select
                        label="Group"
                        value={form.stream ?? ""}
                        onChange={(e) => set({ stream: e.target.value || undefined })}
                        options={[{ value: "", label: "Choose later (before admission)" }, ...streams.map((s) => ({ value: s, label: s }))]}
                        {...(err("stream") ? { error: err("stream") } : { help: `${form.classApplied} is taught in groups. The group decides some test papers and the subjects after admission.` })}
                      />
                    )}
                    <Input label="Admission reference" value={extras.admissionReference} onChange={(e) => setX({ admissionReference: e.target.value })} placeholder="e.g. Parent of a student, website, newspaper" help="Who told the family about MTB. Optional." />
                    {!rule ? (
                      <Banner tone="warning">Choose the class on the first step.</Banner>
                    ) : rule.testRequired ? (
                      <>
                        <Banner tone="info" title={`${form.classApplied} admits through an entrance test`}>
                          {`${rule.candidateFee > 0 ? `Candidate fee ${formatRs(rule.candidateFee)}.` : "No candidate fee."} ${rule.seatsOnMeritList > 0 ? `The merit list offers ${rule.seatsOnMeritList} seats` : "Seats on the merit list are set per list"}; ties go to the older child.`}
                        </Banner>
                        <Select
                          label="Test sitting"
                          value={form.testId ?? ""}
                          onChange={(e) => set({ testId: e.target.value || undefined })}
                          options={[{ value: "", label: sittings.length ? "Book later" : "No upcoming sitting — book later" }, ...sittings.map((t) => ({ value: t.id, label: `${sittingWhenWhere(t)} · ${t.candidates} booked` }))]}
                        />
                        {chosenTest && (
                          <p className="m-0 text-small text-ink-muted">
                            Papers: {chosenTest.subjects.filter((s) => !s.stream || !form.stream || s.stream === form.stream).map((s) => `${s.subject} (${s.max}${s.stream ? `, ${s.stream} only` : ""})`).join(", ")} · {chosenTest.max} marks in all.
                          </p>
                        )}
                        {rule.candidateFee > 0 && <Switch label={`Candidate fee of ${formatRs(rule.candidateFee)} paid now at the desk`} checked={form.feePaidNow} onChange={(e) => set({ feePaidNow: e.target.checked })} />}
                        {rule.candidateFee > 0 && !form.feePaidNow && form.testId && <Banner tone="warning">The test is booked, but the slip is printed only after the fee is paid.</Banner>}
                      </>
                    ) : (
                      <Banner tone="info" title={`${form.classApplied} has no entrance test`}>
                        The principal meets the family and offers a seat if one is free.{" "}
                        {rule.admissionFee ? `The admission fee of ${feeOrDash(rule.admissionFee)} is charged on admission.` : "The admission fee is charged on admission."}
                      </Banner>
                    )}
                  </div>
                )}
                {step === 3 && (
                  <KeyValue
                    items={[
                      ["Child", `${form.name}${form.nameUr ? ` · ${form.nameUr}` : ""} (${form.gender === "F" ? "girl" : "boy"})`],
                      ["Date of birth", form.dob ? `${formatDate(form.dob)} · ${ageOn(form.dob, ctx.session)}` : "—"],
                      ["Class", `${form.classApplied}${form.stream ? ` · ${form.stream}` : streams.length ? " · group to be chosen" : ""}`],
                      ...(extras.religion || extras.disability || extras.identificationMark || extras.birthCertificateNo
                        ? ([["More about the child", [extras.religion, extras.birthCertificateNo && `birth certificate ${extras.birthCertificateNo}`, extras.disability && `disability: ${extras.disability}`, extras.identificationMark && `mark: ${extras.identificationMark}`].filter(Boolean).join(" · ")]] as Array<[string, string]>)
                        : []),
                      ["Father", `${form.father}${form.fatherCnic ? ` · ${formatCnic(form.fatherCnic)}` : " · CNIC not given"}${extras.fatherOccupation ? ` · ${extras.fatherOccupation}` : ""}${extras.fatherQualification ? ` · ${extras.fatherQualification}` : ""}`],
                      ...(form.mother || extras.motherOccupation || extras.motherQualification ? ([["Mother", [form.mother, extras.motherOccupation, extras.motherQualification].filter(Boolean).join(" · ")]] as Array<[string, string]>) : []),
                      ["Mobile", `${form.mobile}${extras.homePhone ? ` · home ${extras.homePhone}` : ""}${extras.email ? ` · ${extras.email}` : ""}`],
                      ["Address", `${form.address}${extras.city ? `, ${extras.city}` : ""}${extras.tempAddress ? ` · for now: ${extras.tempAddress}` : ""}`],
                      ...(extras.emergencyName ? ([["Emergency contact", `${extras.emergencyName} · ${extras.emergencyMobile1}${extras.emergencyMobile2 ? ` / ${extras.emergencyMobile2}` : ""}`]] as Array<[string, string]>) : []),
                      ...(extras.admissionReference ? ([["Admission reference", extras.admissionReference]] as Array<[string, string]>) : []),
                      ["Entrance test", rule?.testRequired ? (chosenTest ? sittingWhen(chosenTest) : "Book later") : "None (interview)"],
                      ...(rule?.testRequired && rule.candidateFee > 0 ? ([["Candidate fee", form.feePaidNow ? `${formatRs(rule.candidateFee)} paid now` : `${formatRs(rule.candidateFee)} due`]] as Array<[string, string]>) : []),
                      ...(family ? ([["Family", `Joins ${family.fatherName}'s family (${family.children.length} at MTB)`]] as Array<[string, string]>) : []),
                    ]}
                  />
                )}
                {apply.error && !(apply.error instanceof ApiError && apply.error.field) && <Banner tone="danger">{apiMessage(apply.error)}</Banner>}
                <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-4">
                  <Button disabled={step === 0} icon="arrowLeft" onClick={() => setStep((s) => Math.max(0, s - 1))}>
                    Back
                  </Button>
                  {step < STEPS.length - 1 ? (
                    <Button variant="primary" iconRight="arrowRight" disabled={!setup.data} onClick={next}>
                      Continue
                    </Button>
                  ) : (
                    <Button variant="primary" icon="check" loading={apply.isPending} loadingLabel="Saving…" onClick={() => apply.mutate()}>
                      Save application
                    </Button>
                  )}
                </div>
              </div>
            </Panel>

            <Panel id="app-checks" rise={1} title="Checks as you type" description="Family already at MTB and possible duplicates">
              {!setup.data ? (
                <Skeleton height={120} />
              ) : step === 0 ? (
                <p className="m-0 text-small text-ink-muted">On the next step, the father's CNIC finds brothers and sisters already at MTB, and the name and date of birth are checked against every student and applicant.</p>
              ) : check.isFetching && !check.data ? (
                <Skeleton height={120} />
              ) : (
                <div className="grid gap-3">
                  {family ? (
                    <div className="grid gap-2 rounded-lg border border-border p-3">
                      <span className="flex items-center gap-2 font-medium text-ink">
                        <Icon name="home" size={16} /> {family.fatherName}'s family is already at MTB
                      </span>
                      <ul className="m-0 grid list-none gap-1 p-0">
                        {family.children.map((c) => (
                          <li key={c.grNo} className="flex items-center gap-2 text-small">
                            <Avatar name={c.name} size="sm" />
                            <span className="flex-1">
                              {c.name} <span className="text-ink-muted">· {c.classSection} · {c.campusName}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                      <span className="text-small text-ink-muted">The new child will be linked to this family. Siblings may qualify for the sibling concession.</span>
                    </div>
                  ) : form.fatherCnic.length === 13 ? (
                    <p className="m-0 text-small text-ink-muted">No other child is registered with this CNIC: a new family record will be created.</p>
                  ) : null}
                  {matches.length > 0 ? (
                    <div className="grid gap-2">
                      <Banner tone="warning" title="This child may already be on record">
                        Check before saving. If you save anyway, the pair goes to Possible duplicates for the principal to merge or keep apart.
                      </Banner>
                      {matches.map((m) => (
                        <div key={m.ref} className="grid gap-1 rounded-lg border border-border p-3 text-small">
                          <span className="flex flex-wrap items-center justify-between gap-2">
                            <b className="text-ink">{m.name}</b>
                            <StatusBadge status={m.strength >= 90 ? "danger" : "warning"}>{`${admissionsMatchLabel(m.strength)} · ${m.strength}%`}</StatusBadge>
                          </span>
                          <span className="text-ink-muted">
                            <span className="mtb-mono">{m.ref}</span> · {m.context} · {m.campusName}
                          </span>
                          <span className="text-ink-muted">{m.reasons.join(" · ")}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    check.data && <EmptyState icon="checkCircle" title="No possible duplicates" description="Nobody on record has a matching name, date of birth and father." />
                  )}
                </div>
              )}
            </Panel>
          </div>
        )}
      </RequireSingleCampus>
      <Modal
        open={printing !== null}
        onClose={() => setPrinting(null)}
        size="lg"
        title={printing === "slip" ? "Entrance test slip" : "Application form"}
        footer={
          <>
            <Button onClick={() => setPrinting(null)}>Close</Button>
            <Button variant="primary" icon="printer" onClick={printNow}>
              Print
            </Button>
          </>
        }
      >
        {done && (
          <PrintSheet paper="A5" label="Application papers" zoom={0.7}>
            {printing === "slip" ? <TestSlip a={done} test={setup.data?.tests.find((t) => t.id === done.testId)} /> : <ApplicationForm a={done} />}
          </PrintSheet>
        )}
      </Modal>
      <BlankFormModal open={blankForm} onClose={() => setBlankForm(false)} />
    </Page>
  );
}
