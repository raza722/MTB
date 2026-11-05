import {
  HR_EMPLOYMENT_LABEL,
  HR_PAYMENT_LABEL,
  hrApi,
  hrQueries,
  type CampusCode,
  type HrEmploymentType,
  type HrExperience,
  type HrGender,
  type HrMaritalStatus,
  type HrPaymentMethod,
  type HrPersonalInput,
  type HrQualification,
  type HrRelation,
  type HrSettings,
  type HrStaffProfile,
} from "@mtb/api";
import { formatDate, formatRs, isValidCnic, normalizeMobile, type IsoDate } from "@mtb/domain";
import { AmountInput, Banner, Button, Checkbox, CnicInput, DatePicker, IconButton, Input, KeyValue, Select, SidePanel, Switch, Textarea, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { z } from "zod";
import { campusLabel } from "../../app/shell/campus";
import { useCtx } from "../../app/session";
import { errorField, errorText, TODAY } from "./shared";

/* ================================================================== Personal details (add and edit) */

export interface PersonalForm {
  name: string;
  nameUrdu: string;
  gender: HrGender;
  relation: HrRelation;
  guardianName: string;
  cnic: string;
  dob: IsoDate | null;
  bloodGroup: string;
  maritalStatus: HrMaritalStatus;
  religion: string;
  mobile: string;
  mobile2: string;
  email: string;
  address: string;
  city: string;
  emergencyName: string;
  emergencyRelation: string;
  emergencyMobile: string;
  priorServiceYears: string;
  /** Who recommended the candidate (legacy "Reference"). */
  reference: string;
  caste: string;
}

export const emptyPersonal = (city = "Sadiqabad"): PersonalForm => ({
  name: "",
  nameUrdu: "",
  gender: "F",
  relation: "d/o",
  guardianName: "",
  cnic: "",
  dob: null,
  bloodGroup: "B+",
  maritalStatus: "SINGLE",
  religion: "Islam",
  mobile: "",
  mobile2: "",
  email: "",
  address: "",
  city,
  emergencyName: "",
  emergencyRelation: "Father",
  emergencyMobile: "",
  priorServiceYears: "0",
  reference: "",
  caste: "",
});

export const personalFromProfile = (s: HrStaffProfile): PersonalForm => ({
  name: s.name,
  nameUrdu: s.nameUrdu ?? "",
  gender: s.gender,
  relation: s.relation,
  guardianName: s.guardianName,
  cnic: s.cnic,
  dob: s.dob,
  bloodGroup: s.bloodGroup,
  maritalStatus: s.maritalStatus,
  religion: s.religion,
  mobile: s.mobile,
  mobile2: s.mobile2 ?? "",
  email: s.email ?? "",
  address: s.address,
  city: s.city,
  emergencyName: s.emergency.name,
  emergencyRelation: s.emergency.relation,
  emergencyMobile: s.emergency.mobile,
  priorServiceYears: String(s.priorServiceYears),
  reference: s.reference ?? "",
  caste: s.caste ?? "",
});

const ageOn = (dob: string, on: string) => (Date.parse(`${on}T00:00:00Z`) - Date.parse(`${dob}T00:00:00Z`)) / (365.25 * 86_400_000);
const mobileOk = (v: string) => normalizeMobile(v) !== null;

export const personalSchema = z.object({
  name: z.string().trim().min(3, "Enter the full name as on the CNIC."),
  guardianName: z.string().trim().min(3, "Enter the father's or husband's name."),
  cnic: z.string().refine((v) => isValidCnic(v), "Enter all 13 digits of the CNIC."),
  dob: z
    .string({ error: "Enter the date of birth." })
    .min(1, "Enter the date of birth.")
    .refine((d) => ageOn(d, TODAY) >= 18 && ageOn(d, TODAY) <= 75, "Staff must be between 18 and 75. Check the date of birth."),
  mobile: z.string().refine(mobileOk, "Enter a mobile number like 0300-1234567."),
  mobile2: z.string().refine((v) => !v.trim() || mobileOk(v), "Should look like 0300-1234567, or leave it empty."),
  email: z.string().refine((v) => !v.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()), "Enter a valid email address, or leave it empty."),
  address: z.string().trim().min(8, "Enter the home address (house, street, area)."),
  city: z.string().trim().min(2, "Enter the city."),
  emergencyName: z.string().trim().min(3, "Enter someone to call in an emergency."),
  emergencyMobile: z.string().refine(mobileOk, "Enter their mobile number like 0300-1234567."),
  priorServiceYears: z.coerce.number({ error: "Enter a number of years (0 if none)." }).min(0, "Can't be negative.").max(40, "At most 40 years."),
  reference: z.string().trim().max(80, "Keep it to 80 characters."),
  caste: z.string().trim().max(40, "Keep it to 40 characters."),
});

export function issues(result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }): Record<string, string> {
  const out: Record<string, string> = {};
  if (!result.success && result.error) for (const i of result.error.issues) out[String(i.path[0])] ??= i.message;
  return out;
}

export const toPersonalInput = (f: PersonalForm): HrPersonalInput => ({
  name: f.name.trim(),
  nameUrdu: f.nameUrdu.trim() || null,
  gender: f.gender,
  relation: f.relation,
  guardianName: f.guardianName.trim(),
  cnic: f.cnic,
  dob: f.dob ?? "",
  bloodGroup: f.bloodGroup,
  maritalStatus: f.maritalStatus,
  religion: f.religion,
  mobile: normalizeMobile(f.mobile) ?? f.mobile,
  mobile2: f.mobile2.trim() ? (normalizeMobile(f.mobile2) ?? f.mobile2) : null,
  email: f.email.trim() || null,
  address: f.address.trim(),
  city: f.city.trim(),
  emergency: { name: f.emergencyName.trim(), relation: f.emergencyRelation, mobile: normalizeMobile(f.emergencyMobile) ?? f.emergencyMobile },
  priorServiceYears: Number(f.priorServiceYears) || 0,
  reference: f.reference.trim() || null,
  caste: f.caste.trim() || null,
});

const BLOOD = ["A+", "A−", "B+", "B−", "O+", "O−", "AB+", "AB−"];

/** The personal-details fields, used by "Add staff" and "Edit personal details". */
export function PersonalFields({ f, set, err, cnicHelp }: { f: PersonalForm; set: (patch: Partial<PersonalForm>) => void; err: (k: string) => string | undefined; cnicHelp?: ReactNode }) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Full name" required value={f.name} onChange={(e) => set({ name: e.target.value })} error={err("name")} placeholder="As on the CNIC, with Mr / Ms" />
        <Input label="Name in Urdu" urdu value={f.nameUrdu} onChange={(e) => set({ nameUrdu: e.target.value })} help="Printed on the ID card and Urdu letters." />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Select
          label="Gender"
          value={f.gender}
          onChange={(e) => {
            const g = e.target.value as HrGender;
            set({ gender: g, relation: g === "M" ? "s/o" : f.maritalStatus === "MARRIED" ? "w/o" : "d/o" });
          }}
          options={[
            { value: "F", label: "Female" },
            { value: "M", label: "Male" },
          ]}
        />
        <Select
          label="Relation"
          value={f.relation}
          onChange={(e) => set({ relation: e.target.value as HrRelation })}
          options={[
            { value: "s/o", label: "Son of" },
            { value: "d/o", label: "Daughter of" },
            { value: "w/o", label: "Wife of" },
          ]}
        />
        <Input label={f.relation === "w/o" ? "Husband's name" : "Father's name"} required value={f.guardianName} onChange={(e) => set({ guardianName: e.target.value })} error={err("guardianName")} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <CnicInput label="CNIC" required value={f.cnic} onValueChange={(cnic) => set({ cnic })} error={err("cnic")} help={cnicHelp ?? "Checked against every campus: one profile per person."} />
        <DatePicker label="Date of birth" required value={f.dob} onValueChange={(dob) => set({ dob })} today={TODAY} maxDate={TODAY} error={err("dob")} />
        <Select label="Blood group" value={f.bloodGroup} onChange={(e) => set({ bloodGroup: e.target.value })} options={BLOOD} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Select
          label="Marital status"
          value={f.maritalStatus}
          onChange={(e) => set({ maritalStatus: e.target.value as HrMaritalStatus })}
          options={[
            { value: "SINGLE", label: "Single" },
            { value: "MARRIED", label: "Married" },
            { value: "WIDOWED", label: "Widowed" },
            { value: "DIVORCED", label: "Divorced" },
          ]}
        />
        <Input label="Mobile" required inputMode="tel" value={f.mobile} onChange={(e) => set({ mobile: e.target.value })} error={err("mobile")} placeholder="0300-1234567" />
        <Input label="Second mobile" inputMode="tel" value={f.mobile2} onChange={(e) => set({ mobile2: e.target.value })} error={err("mobile2")} />
      </div>
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <Input label="Home address" required value={f.address} onChange={(e) => set({ address: e.target.value })} error={err("address")} placeholder="House, street, area" />
        <Input label="City" required value={f.city} onChange={(e) => set({ city: e.target.value })} error={err("city")} />
      </div>
      <Input label="Email" type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} error={err("email")} help="Optional. Payslips can be emailed later." />
      <div className="grid gap-4 sm:grid-cols-3">
        <Input label="Emergency contact" required value={f.emergencyName} onChange={(e) => set({ emergencyName: e.target.value })} error={err("emergencyName")} />
        <Select label="Relation to staff" value={f.emergencyRelation} onChange={(e) => set({ emergencyRelation: e.target.value })} options={["Father", "Mother", "Husband", "Wife", "Brother", "Sister", "Son", "Daughter", "Other"]} />
        <Input label="Their mobile" required inputMode="tel" value={f.emergencyMobile} onChange={(e) => set({ emergencyMobile: e.target.value })} error={err("emergencyMobile")} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Reference" value={f.reference} onChange={(e) => set({ reference: e.target.value })} error={err("reference")} help="Optional. Who recommended the candidate." />
        <Input label="Caste" value={f.caste} onChange={(e) => set({ caste: e.target.value })} error={err("caste")} help="Optional." />
      </div>
      <Input label="Earlier service at MTB" suffix="years" inputMode="decimal" value={f.priorServiceYears} onChange={(e) => set({ priorServiceYears: e.target.value.replace(/[^\d.]/g, "") })} error={err("priorServiceYears")} help="Years served at MTB before a break (counts towards increments). 0 if none." className="sm:max-w-xs" />
    </div>
  );
}

/* ================================================================== Edit panels used on the profile */

function useSaved(onClose: () => void, message: string) {
  const toast = useToast();
  const queryClient = useQueryClient();
  return () => {
    toast({ title: message });
    void queryClient.invalidateQueries({ queryKey: ["hr"] });
    onClose();
  };
}

export function EditPersonalPanel({ s, onClose }: { s: HrStaffProfile; onClose: () => void }) {
  const [f, setF] = useState<PersonalForm>(() => personalFromProfile(s));
  const [tried, setTried] = useState(false);
  const parsed = personalSchema.safeParse(f);
  const errors = issues(parsed);
  const done = useSaved(onClose, `${s.name}: personal details saved`);
  const save = useMutation({ mutationFn: () => hrApi.updatePersonal(s.id, { ...toPersonalInput(f), rowVer: s.rowVer }), onSuccess: done });
  const sf = errorField(save.error);
  const err = (k: string) => (tried ? (errors[k] ?? (sf === k ? errorText(save.error) : undefined)) : undefined);
  return (
    <SidePanel
      open
      wide
      onClose={onClose}
      title="Edit personal details"
      description={`${s.name} · ${s.employeeNo}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon="check"
            loading={save.isPending}
            loadingLabel="Saving…"
            onClick={() => {
              setTried(true);
              if (parsed.success) save.mutate();
            }}
          >
            Save details
          </Button>
        </>
      }
    >
      <PersonalFields f={f} set={(p) => setF((x) => ({ ...x, ...p }))} err={err} />
      {save.error && !(sf && sf in f) && <Banner tone="danger" className="mt-4">{errorText(save.error)}</Banner>}
    </SidePanel>
  );
}

export function AddPostingPanel({ s, settings, onClose }: { s: HrStaffProfile; settings: HrSettings; onClose: () => void }) {
  const taken = new Set(s.postings.filter((p) => !p.endDate).map((p) => p.campus));
  const free = (["KC", "SM", "UC", "MC", "HC"] as CampusCode[]).filter((c) => !taken.has(c));
  const [campus, setCampus] = useState<CampusCode>(free[0] ?? "SM");
  const [designationId, setDesignation] = useState("d-visiting");
  const [departmentId, setDepartment] = useState(s.departmentId);
  const [type, setType] = useState<HrEmploymentType>("VISITING");
  const [start, setStart] = useState<IsoDate | null>(TODAY);
  const [days, setDays] = useState("2");
  const done = useSaved(onClose, `Posting added at ${campusLabel(campus)}`);
  const save = useMutation({ mutationFn: () => hrApi.addPosting(s.id, { campus, designationId, departmentId, employmentType: type, payScale: null, startDate: start ?? "", daysPerWeek: days ? Number(days) : null }), onSuccess: done });
  return (
    <SidePanel
      open
      onClose={onClose}
      title="Add a posting at another campus"
      description={`${s.name} keeps one profile; salary stays with ${s.postings.find((p) => p.primary)?.campusName}.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="plus" loading={save.isPending} disabled={!free.length || !start} onClick={() => save.mutate()}>
            Add posting
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {!free.length && <Banner tone="info">{s.name} already works at every campus.</Banner>}
        <Select label="Campus" value={campus} onChange={(e) => setCampus(e.target.value as CampusCode)} options={free.map((c) => ({ value: c, label: campusLabel(c) }))} />
        <Select label="Designation" value={designationId} onChange={(e) => setDesignation(e.target.value)} options={settings.designations.filter((d) => d.active).map((d) => ({ value: d.id, label: d.title }))} />
        <Select label="Department" value={departmentId} onChange={(e) => setDepartment(e.target.value)} options={settings.departments.filter((d) => d.active).map((d) => ({ value: d.id, label: d.title }))} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Type" value={type} onChange={(e) => setType(e.target.value as HrEmploymentType)} options={(Object.keys(HR_EMPLOYMENT_LABEL) as HrEmploymentType[]).map((k) => ({ value: k, label: HR_EMPLOYMENT_LABEL[k] }))} />
          <Input label="Days a week" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, "").slice(0, 1))} help="Empty for full time." error={save.error && errorField(save.error) === "daysPerWeek" ? errorText(save.error) : undefined} />
        </div>
        <DatePicker label="Starts" required value={start} onValueChange={setStart} today={TODAY} />
        {save.error && errorField(save.error) !== "daysPerWeek" && <Banner tone="danger">{errorText(save.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

export function QualificationsPanel({ s, onClose }: { s: HrStaffProfile; onClose: () => void }) {
  const [quals, setQuals] = useState<HrQualification[]>(s.qualifications.map((q) => ({ ...q })));
  const [exp, setExp] = useState<HrExperience[]>(s.experience.map((x) => ({ ...x })));
  const done = useSaved(onClose, "Qualifications and experience saved");
  const save = useMutation({ mutationFn: () => hrApi.setQualifications(s.id, { qualifications: quals, experience: exp }), onSuccess: done });
  const setQ = (i: number, p: Partial<HrQualification>) => setQuals((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const setX = (i: number, p: Partial<HrExperience>) => setExp((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <SidePanel
      open
      wide
      onClose={onClose}
      title="Qualifications and experience"
      description={s.name}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="check" loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <div className="grid gap-3">
          <span className="text-small font-medium">Qualifications</span>
          {quals.map((q, i) => (
            <div key={i} className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-[2fr_2fr_90px_1fr_auto]">
              <Input label="Degree" value={q.degree} onChange={(e) => setQ(i, { degree: e.target.value, subject: q.subject || e.target.value })} placeholder="M.Sc. Mathematics" />
              <Input label="Institution" value={q.institution} onChange={(e) => setQ(i, { institution: e.target.value })} />
              <Input label="Year" inputMode="numeric" value={String(q.year || "")} onChange={(e) => setQ(i, { year: Number(e.target.value.replace(/\D/g, "").slice(0, 4)) })} />
              <Input label="Result" value={q.result} onChange={(e) => setQ(i, { result: e.target.value })} placeholder="First division" />
              <IconButton icon="trash" label="Remove this qualification" className="self-end" onClick={() => setQuals((xs) => xs.filter((_, j) => j !== i))} />
            </div>
          ))}
          <Button size="sm" icon="plus" className="justify-self-start" onClick={() => setQuals((xs) => [...xs, { id: "", degree: "", subject: "", institution: "", year: 2020, result: "" }])}>
            Add qualification
          </Button>
        </div>
        <div className="grid gap-3">
          <span className="text-small font-medium">Experience before MTB</span>
          {exp.map((x, i) => (
            <div key={i} className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
              <Input label="School or organisation" value={x.organisation} onChange={(e) => setX(i, { organisation: e.target.value })} />
              <Input label="Role" value={x.role} onChange={(e) => setX(i, { role: e.target.value })} />
              <DatePicker label="From" value={x.from || null} onValueChange={(d) => setX(i, { from: d ?? "" })} today={TODAY} />
              <DatePicker label="To" value={x.to || null} onValueChange={(d) => setX(i, { to: d ?? "" })} today={TODAY} />
              <IconButton icon="trash" label="Remove this job" className="self-end" onClick={() => setExp((xs) => xs.filter((_, j) => j !== i))} />
            </div>
          ))}
          <Button size="sm" icon="plus" className="justify-self-start" onClick={() => setExp((xs) => [...xs, { id: "", organisation: "", role: "Teacher", from: "", to: "" }])}>
            Add experience
          </Button>
        </div>
        {save.error && <Banner tone="danger">{errorText(save.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

export function TeachingPanel({ s, settings, onClose }: { s: HrStaffProfile; settings: HrSettings; onClose: () => void }) {
  const [levels, setLevels] = useState<string[]>(s.teachingLevels);
  const [subjects, setSubjects] = useState<string[]>(s.subjectIds);
  const done = useSaved(onClose, "Teaching levels and subjects saved");
  const save = useMutation({ mutationFn: () => hrApi.setTeaching(s.id, { teachingLevels: levels, subjectIds: subjects }), onSuccess: done });
  const toggle = (xs: string[], v: string) => (xs.includes(v) ? xs.filter((x) => x !== v) : [...xs, v]);
  return (
    <SidePanel
      open
      onClose={onClose}
      title="Levels and subjects taught"
      description="Used by the timetable to suggest teachers, and by increment runs filtered by level."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="check" loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <fieldset className="grid gap-2 border-0 p-0">
          <legend className="mb-2 text-small font-medium">Levels</legend>
          {settings.teachingLevels.map((l) => (
            <Checkbox key={l} label={l} checked={levels.includes(l)} onChange={() => setLevels((x) => toggle(x, l))} />
          ))}
        </fieldset>
        <fieldset className="grid gap-2 border-0 p-0 sm:grid-cols-2">
          <legend className="mb-2 text-small font-medium">Subjects</legend>
          {settings.subjects.map((x) => (
            <Checkbox key={x.id} label={x.name} checked={subjects.includes(x.id)} onChange={() => setSubjects((v) => toggle(v, x.id))} />
          ))}
        </fieldset>
        {save.error && <Banner tone="danger">{errorText(save.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

/** Salary structure, bank account, child fee adjustment — the accountant only. */
export function PayPanel({ s, settings, onClose }: { s: HrStaffProfile; settings: HrSettings; onClose: () => void }) {
  const ctx = useCtx();
  const pay = s.pay!;
  const [basic, setBasic] = useState<number | null>(pay.basic || pay.nextChange?.basic || null);
  const [from, setFrom] = useState<IsoDate | null>(null);
  const [reason, setReason] = useState("");
  const [special, setSpecial] = useState<number | null>(pay.specialAllowance);
  const [method, setMethod] = useState<HrPaymentMethod>(pay.paymentMethod);
  const [bankName, setBankName] = useState(pay.bank?.bankName ?? settings.banks[0]!);
  const [branch, setBranch] = useState(pay.bank?.branch ?? "");
  const [title, setTitle] = useState(pay.bank?.accountTitle ?? s.name.replace(/^(Mr|Ms|Mrs|Dr|Qari)\s+/, ""));
  const [accountNo, setAccountNo] = useState("");
  const [eobi, setEobi] = useState(pay.eobi);
  const [pf, setPf] = useState(pay.providentFund);
  const [children, setChildren] = useState(pay.children.map((c) => ({ grNo: c.grNo, adjustAgainstSalary: c.adjustAgainstSalary })));
  const [tried, setTried] = useState(false);
  const basicChanged = basic !== null && basic !== pay.basic;
  const schema = z.object({
    basic: z.number({ error: "Enter the monthly basic pay." }).int().min(1000, "Enter the monthly basic pay in rupees."),
    from: basicChanged ? z.string({ error: "Say from when the new pay applies." }).min(1, "Say from when the new pay applies.").refine((d) => d >= `${TODAY.slice(0, 7)}-01`, "Earlier salary sheets are prepared. Choose this month or later.") : z.any(),
    reason: basicChanged ? z.string().trim().min(5, "Say why the pay changes; it shows in the salary history.") : z.any(),
    accountNo: method === "BANK" && !pay.bank ? z.string().refine((v) => /^(PK\d{2}[A-Z]{4}\d{16}|\d{8,20})$/i.test(v.replace(/[\s-]/g, "")), "Enter the account number (8–20 digits) or the IBAN.") : z.any(),
    title: method === "BANK" ? z.string().trim().min(3, "Enter the account title as the bank shows it.") : z.any(),
  });
  const parsed = schema.safeParse({ basic: basic ?? undefined, from: from ?? undefined, reason, accountNo, title });
  const errors = issues(parsed);
  const done = useSaved(onClose, "Pay details saved");
  const save = useMutation({
    mutationFn: () =>
      hrApi.setPay(ctx, s.id, {
        basic: basic ?? 0,
        effectiveFrom: basicChanged ? from : null,
        reason: reason.trim(),
        specialAllowance: special ?? 0,
        paymentMethod: method,
        bank: method === "BANK" ? { bankName, branch, accountTitle: title.trim(), accountNo: accountNo.trim() || null } : null,
        eobi,
        providentFund: pf,
        children,
        rowVer: s.rowVer,
      }),
    onSuccess: done,
  });
  const sf = errorField(save.error);
  const err = (k: string) => (tried ? (errors[k] ?? (sf === k ? errorText(save.error) : undefined)) : undefined);
  const hra = Math.round(((basic ?? 0) * settings.payDefaults.houseRentPct) / 100);
  return (
    <SidePanel
      open
      wide
      onClose={onClose}
      title="Pay and bank details"
      description={`${s.name} · ${s.employeeNo}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon="check"
            loading={save.isPending}
            loadingLabel="Saving…"
            onClick={() => {
              setTried(true);
              if (parsed.success) save.mutate();
            }}
          >
            Save pay details
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <AmountInput label="Basic pay a month" required value={basic} onValueChange={setBasic} error={err("basic")} help={pay.payScale ? `Pay scale ${pay.payScale}. Yearly increments are added by an increment run.` : "No pay scale."} />
          <AmountInput label="Special allowance" value={special} onValueChange={setSpecial} help="Responsibility allowance, if any." error={err("specialAllowance")} />
        </div>
        {basicChanged && (
          <div className="grid gap-4 rounded-md border border-border bg-surface-sunken p-4 sm:grid-cols-2">
            <DatePicker label="New basic applies from" required value={from} onValueChange={setFrom} today={TODAY} minDate={`${TODAY.slice(0, 7)}-01`} error={err("from") ?? err("effectiveFrom")} />
            <Input label="Why it changes" required value={reason} onChange={(e) => setReason(e.target.value)} error={err("reason")} placeholder="Promotion to senior teacher" />
            <p className="m-0 text-small text-ink-muted sm:col-span-2">
              {formatRs(pay.basic)} → {formatRs(basic ?? 0)}. The old figure stays in the salary history; salary sheets from that month use the new one.
            </p>
          </div>
        )}
        <KeyValue
          items={[
            [`House rent (${settings.payDefaults.houseRentPct}% of basic)`, formatRs(pay.payScale ? hra : Math.round(((basic ?? 0) * 30) / 100))],
            ["Conveyance and medical", formatRs(settings.payDefaults.conveyance + settings.payDefaults.medical)],
          ]}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Switch label={`EOBI (${formatRs(settings.payDefaults.eobi)} a month)`} checked={eobi} onChange={(e) => setEobi(e.target.checked)} />
          <Switch label={`Provident fund (${settings.payDefaults.providentFundPct}% of basic)`} checked={pf} onChange={(e) => setPf(e.target.checked)} />
        </div>
        <div className="grid gap-4">
          <Select label="Salary paid by" value={method} onChange={(e) => setMethod(e.target.value as HrPaymentMethod)} options={(Object.keys(HR_PAYMENT_LABEL) as HrPaymentMethod[]).map((k) => ({ value: k, label: HR_PAYMENT_LABEL[k] }))} />
          {method === "BANK" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Select label="Bank" value={bankName} onChange={(e) => setBankName(e.target.value)} options={settings.banks} />
              <Input label="Branch" value={branch} onChange={(e) => setBranch(e.target.value)} />
              <Input label="Account title" required value={title} onChange={(e) => setTitle(e.target.value)} error={err("title") ?? err("accountTitle")} />
              <Input label={pay.bank ? `Account number (on file: ${pay.bank.accountNoMasked})` : "Account number or IBAN"} required={!pay.bank} mono value={accountNo} onChange={(e) => setAccountNo(e.target.value)} error={err("accountNo")} help={pay.bank ? "Leave empty to keep the number on file." : "Only the last four digits are shown after saving."} />
            </div>
          )}
        </div>
        {pay.children.length > 0 && (
          <fieldset className="grid gap-2 border-0 p-0">
            <legend className="mb-1 text-small font-medium">Children at MTB</legend>
            {pay.children.map((c) => (
              <Switch
                key={c.grNo}
                label={`Take ${c.name}'s fee (${formatRs(c.monthlyFee)} a month, ${c.classSection}) from salary`}
                checked={children.find((x) => x.grNo === c.grNo)?.adjustAgainstSalary ?? false}
                onChange={(e) => setChildren((xs) => xs.map((x) => (x.grNo === c.grNo ? { ...x, adjustAgainstSalary: e.target.checked } : x)))}
              />
            ))}
          </fieldset>
        )}
        {save.error && !sf && <Banner tone="danger">{errorText(save.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

export function EndPostingPanel({ s, postingId, onClose }: { s: HrStaffProfile; postingId: string; onClose: () => void }) {
  const p = s.postings.find((x) => x.id === postingId)!;
  const [date, setDate] = useState<IsoDate | null>(TODAY);
  const [reason, setReason] = useState("");
  const done = useSaved(onClose, `Posting at ${p.campusName} ended`);
  const save = useMutation({ mutationFn: () => hrApi.endPosting(s.id, p.id, { endDate: date ?? "", reason }), onSuccess: done });
  return (
    <SidePanel
      open
      onClose={onClose}
      title={`End the posting at ${p.campusName}`}
      description={`${s.name} keeps their profile and main posting.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={save.isPending} disabled={!date || reason.trim().length < 3} onClick={() => save.mutate()}>
            End posting
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <DatePicker label="Last day at this campus" required value={date} onValueChange={setDate} today={TODAY} />
        <Textarea label="Reason" required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Timetable changed; no computer classes at this campus" />
        {save.error && <Banner tone="danger">{errorText(save.error)}</Banner>}
        <p className="m-0 text-small text-ink-muted">Started {formatDate(p.startDate)}.</p>
      </div>
    </SidePanel>
  );
}

/** Loads the shared HR settings (designations, departments, subjects, banks) once. */
export const useHrSettings = () => useQuery(hrQueries.settings());
