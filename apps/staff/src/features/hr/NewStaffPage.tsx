import { ApiError, can, CURRENT_SESSION, HR_EMPLOYMENT_LABEL, HR_PAYMENT_LABEL, hrApi, newIdempotencyKey, type CampusCode, type HrDuplicateDetails, type HrEmploymentType, type HrPaymentMethod } from "@mtb/api";
import { formatSession, isValidCnic, type IsoDate } from "@mtb/domain";
import { AmountInput, Banner, Button, Checkbox, DatePicker, Input, Panel, Select, Skeleton, Switch, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { z } from "zod";
import { campusLabel } from "../../app/shell/campus";
import { RequirePermission } from "../../app/shell/page";
import { useCtx, useReadOnly, useSessionUser } from "../../app/session";
import { emptyPersonal, issues, PersonalFields, personalSchema, toPersonalInput, useHrSettings, type PersonalForm } from "./StaffPanels";
import { errorField, errorText, HrShell, today } from "./shared";

const CAMPUSES: CampusCode[] = ["KC", "SM", "UC", "MC", "HC"];

/** Add a staff member: personal, employment, qualification and (for the accountant) pay — checked as you go. */
export function NewStaffPage() {
  const ctx = useCtx();
  const user = useSessionUser();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const readOnly = useReadOnly();
  const settings = useHrSettings();
  const [f, setF] = useState<PersonalForm>(() => emptyPersonal());
  // With "All campuses": the first campus where this user may add staff.
  const [campus, setCampus] = useState<CampusCode>(() => (ctx.campus === "ALL" ? (CAMPUSES.find((c) => can(user, "hr.manage", c)) ?? CAMPUSES[0]!) : ctx.campus));
  // Pay is set only where this user manages payroll at the campus being joined (its Payroll switch included);
  // elsewhere the pay section is left out and the API would refuse it.
  const canPayroll = can(user, "payroll.manage", campus);
  const [designationId, setDesignation] = useState("");
  const [departmentId, setDepartment] = useState("");
  const [type, setType] = useState<HrEmploymentType>("PROBATION");
  const [scale, setScale] = useState<string>("");
  const [joining, setJoining] = useState<IsoDate | null>(today());
  const [levels, setLevels] = useState<string[]>([]);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [degree, setDegree] = useState("");
  const [institution, setInstitution] = useState("");
  const [year, setYear] = useState("");
  const [result, setResult] = useState("");
  const [basic, setBasic] = useState<number | null>(null);
  const [special, setSpecial] = useState<number | null>(0);
  const [method, setMethod] = useState<HrPaymentMethod>("BANK");
  const [bankName, setBankName] = useState("");
  const [branch, setBranch] = useState("");
  const [accountTitle, setAccountTitle] = useState("");
  const [accountNo, setAccountNo] = useState("");
  const [eobi, setEobi] = useState(true);
  const [pf, setPf] = useState(false);
  const [tried, setTried] = useState(false);

  const des = settings.data?.designations.find((d) => d.id === designationId);
  const teaching = des ? des.category !== "NON_TEACHING" : true;
  const cnicDone = isValidCnic(f.cnic);
  const dup = useQuery({ queryKey: ["hr", "check-cnic", f.cnic], queryFn: () => hrApi.checkCnic(f.cnic), enabled: cnicDone, staleTime: 30_000 });
  const match: HrDuplicateDetails | null = dup.data?.match ?? null;

  const thisYear = Number(today().slice(0, 4));
  const bank = bankName || settings.data?.banks[0] || "";
  const hasDegree = degree.trim() !== "";
  const schema = personalSchema.extend({
    designationId: z.string().min(1, "Choose the designation."),
    departmentId: z.string().min(1, "Choose the department."),
    joining: z.string({ error: "Enter the joining date." }).min(1, "Enter the joining date."),
    degree: z.string(),
    // A qualification needs the degree, the institution and the year (no year is assumed).
    institution: hasDegree ? z.string().trim().min(2, "Enter the institution.") : z.any(),
    year: hasDegree ? z.string().refine((y) => Number(y) >= 1960 && Number(y) <= thisYear, `Enter a year between 1960 and ${thisYear}.`) : z.any(),
    basic: canPayroll ? z.number({ error: "Enter the monthly basic pay." }).int().min(1000, "Enter the monthly basic pay in rupees.") : z.any(),
    accountTitle: canPayroll && method === "BANK" ? z.string().trim().min(3, "Enter the account title as the bank shows it.") : z.any(),
    accountNo: canPayroll && method === "BANK" ? z.string().refine((v) => /^(PK\d{2}[A-Z]{4}\d{16}|\d{8,20})$/i.test(v.replace(/[\s-]/g, "")), "Enter the account number (8–20 digits) or the IBAN.") : z.any(),
  });
  const values = { ...f, dob: f.dob ?? "", designationId, departmentId, joining: joining ?? "", degree, institution, year, basic: basic ?? undefined, accountTitle, accountNo };
  const parsed = schema.safeParse(values);
  const errors = issues(parsed);
  const key = useMemo(() => newIdempotencyKey(), [JSON.stringify(values), campus, designationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () =>
      hrApi.create(
        {
          ...toPersonalInput(f),
          campus,
          designationId,
          departmentId,
          employmentType: type,
          payScale: scale || null,
          joiningDate: joining ?? "",
          probationMonths: type === "PROBATION" ? 6 : null,
          teachingLevels: teaching ? levels : [],
          subjectIds: teaching ? subjects : [],
          qualification: hasDegree ? { degree: degree.trim(), subject: degree.trim(), institution: institution.trim(), year: Number(year), result: result.trim() } : null,
          pay: canPayroll ? { basic: basic ?? 0, specialAllowance: special ?? 0, paymentMethod: method, bank: method === "BANK" ? { bankName: bank, branch: branch.trim(), accountTitle: accountTitle.trim(), accountNo: accountNo.trim() } : null, eobi, providentFund: pf } : null,
        },
        key,
      ),
    onSuccess: (s) => {
      toast({ title: `${s.name} added · ${s.employeeNo}`, message: canPayroll ? "Upload their documents and link the fingerprint machine number after the first import." : "The accountant adds pay details before the next salary sheet." });
      void queryClient.invalidateQueries({ queryKey: ["hr"] });
      void navigate({ to: "/hr/staff/$staffId", params: { staffId: s.id }, search: { tab: "documents" } });
    },
  });
  const serverField = errorField(save.error);
  const dupErr = save.error instanceof ApiError && save.error.code === "DUPLICATE_CNIC" ? (save.error.details as HrDuplicateDetails) : null;
  const err = (k: string) => (tried ? (errors[k] ?? (serverField === k ? errorText(save.error) : undefined)) : undefined);
  const set = (p: Partial<PersonalForm>) => setF((x) => ({ ...x, ...p }));
  const shown = match ?? dupErr;
  const toggle = (xs: string[], v: string) => (xs.includes(v) ? xs.filter((x) => x !== v) : [...xs, v]);

  return (
    <RequirePermission permission="hr.manage" page="Add staff">
      <HrShell
        title="Add staff"
        context={`New staff record · ${campusLabel(campus)}`}
        actions={
          <Link to="/hr" className="mtb-btn mtb-btn-ghost mtb-btn-sm">
            Cancel
          </Link>
        }
      >
        {readOnly ? (
          <Banner tone="info">
            Session {formatSession(ctx.session)} is read-only. Switch to {formatSession(CURRENT_SESSION)} to add staff.
          </Banner>
        ) : !settings.data ? (
          <Skeleton height={400} />
        ) : (
          <form
            className="grid gap-6"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              setTried(true);
              if (parsed.success && !match) save.mutate();
            }}
          >
            <Panel id="new-personal" title="Personal details" description="As on the CNIC. The CNIC is checked across every campus, so a person is never entered twice." rise={0}>
              <PersonalFields f={f} set={set} err={err} />
              {shown && (
                <Banner
                  tone="warning"
                  className="mt-4"
                  title={`${shown.name} (${shown.employeeNo}) already has a profile`}
                  actions={
                    <Link to="/hr/staff/$staffId" params={{ staffId: shown.staffId }} search={{ tab: "employment" }} className="mtb-btn mtb-btn-secondary mtb-btn-sm">
                      Open their profile
                    </Link>
                  }
                >
                  {shown.status === "LEFT"
                    ? `Worked at ${shown.campuses.map(campusLabel).join(" and ")} and has left. One person keeps one profile: use Rejoin on their profile instead of a new record.`
                    : `Works at ${shown.campuses.map(campusLabel).join(" and ")}. One person keeps one profile: add a posting at ${campusLabel(campus)} on their profile instead of a new record.`}
                </Banner>
              )}
            </Panel>

            <Panel id="new-job" title="Job" description="Where they work and what they do. A second campus is added later as a posting." rise={1}>
              <div className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Select label="Campus" required value={campus} onChange={(e) => setCampus(e.target.value as CampusCode)} options={CAMPUSES.map((c) => ({ value: c, label: campusLabel(c) }))} />
                  <Select
                    label="Designation"
                    required
                    value={designationId}
                    onChange={(e) => {
                      setDesignation(e.target.value);
                      const d = settings.data!.designations.find((x) => x.id === e.target.value);
                      if (d?.category === "NON_TEACHING") setScale("");
                      if (d?.category === "VISITING") setType("VISITING");
                    }}
                    options={[...(designationId ? [] : [{ value: "", label: "Choose…" }]), ...settings.data.designations.filter((d) => d.active).map((d) => ({ value: d.id, label: d.title }))]}
                    error={err("designationId")}
                  />
                  <Select
                    label="Department"
                    required
                    value={departmentId}
                    onChange={(e) => setDepartment(e.target.value)}
                    options={[...(departmentId ? [] : [{ value: "", label: "Choose…" }]), ...settings.data.departments.filter((d) => d.active).map((d) => ({ value: d.id, label: d.title }))]}
                    error={err("departmentId")}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Select label="Type" value={type} onChange={(e) => setType(e.target.value as HrEmploymentType)} options={(Object.keys(HR_EMPLOYMENT_LABEL) as HrEmploymentType[]).map((k) => ({ value: k, label: HR_EMPLOYMENT_LABEL[k] }))} help={type === "PROBATION" ? "Six months' probation, then confirmed." : undefined} />
                  <Select label="Pay scale" value={scale} onChange={(e) => setScale(e.target.value)} options={[{ value: "", label: "No pay scale" }, ...settings.data.payScales.map((x) => ({ value: x, label: `Scale ${x}` }))]} help="Increments by scale and service use this." error={err("payScale")} />
                  <DatePicker label="Joining date" required value={joining} onValueChange={setJoining} today={today()} error={err("joining") ?? err("joiningDate")} />
                </div>
                {teaching && (
                  <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
                    <fieldset className="grid gap-1.5 border-0 p-0">
                      <legend className="mb-1 text-small font-medium">Levels taught</legend>
                      {settings.data.teachingLevels.map((l) => (
                        <Checkbox key={l} label={l} checked={levels.includes(l)} onChange={() => setLevels((x) => toggle(x, l))} />
                      ))}
                    </fieldset>
                    <fieldset className="grid content-start gap-1.5 border-0 p-0 sm:grid-cols-3">
                      <legend className="mb-1 text-small font-medium">Subjects</legend>
                      {settings.data.subjects.map((x) => (
                        <Checkbox key={x.id} label={x.name} checked={subjects.includes(x.id)} onChange={() => setSubjects((v) => toggle(v, x.id))} />
                      ))}
                    </fieldset>
                  </div>
                )}
              </div>
            </Panel>

            <Panel id="new-qual" title="Highest qualification" description="More qualifications and earlier jobs can be added on the profile." rise={2}>
              <div className="grid gap-4 sm:grid-cols-[2fr_2fr_100px_1fr]">
                <Input label="Degree" value={degree} onChange={(e) => setDegree(e.target.value)} placeholder="M.Sc. Mathematics" />
                <Input label="Institution" required={hasDegree} value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="Islamia University, Bahawalpur" error={err("institution")} />
                <Input label="Year" required={hasDegree} inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} error={err("year") ?? err("qualification")} />
                <Input label="Result" value={result} onChange={(e) => setResult(e.target.value)} placeholder="First division" />
              </div>
            </Panel>

            {canPayroll ? (
              <Panel id="new-pay" title="Pay" description="Starting salary and how it is paid. Allowances follow the defaults in Settings." rise={3}>
                <div className="grid gap-4">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <AmountInput label="Basic pay a month" required value={basic} onValueChange={setBasic} error={err("basic")} />
                    <AmountInput label="Special allowance" value={special} onValueChange={setSpecial} />
                    <Select label="Salary paid by" value={method} onChange={(e) => setMethod(e.target.value as HrPaymentMethod)} options={(Object.keys(HR_PAYMENT_LABEL) as HrPaymentMethod[]).map((k) => ({ value: k, label: HR_PAYMENT_LABEL[k] }))} />
                  </div>
                  {method === "BANK" && (
                    <div className="grid gap-4 sm:grid-cols-4">
                      <Select label="Bank" required value={bank} onChange={(e) => setBankName(e.target.value)} options={settings.data.banks} error={err("bankName")} />
                      <Input label="Branch" value={branch} onChange={(e) => setBranch(e.target.value)} />
                      <Input label="Account title" required value={accountTitle} onChange={(e) => setAccountTitle(e.target.value)} error={err("accountTitle")} />
                      <Input label="Account number or IBAN" required mono value={accountNo} onChange={(e) => setAccountNo(e.target.value)} error={err("accountNo")} />
                    </div>
                  )}
                  <div className="flex flex-wrap gap-6">
                    <Switch label="EOBI" checked={eobi} onChange={(e) => setEobi(e.target.checked)} />
                    <Switch label="Provident fund" checked={pf} onChange={(e) => setPf(e.target.checked)} />
                  </div>
                </div>
              </Panel>
            ) : (
              <Banner tone="info">Pay and bank details are added by the accountant. The new record shows “Pay not set” until then.</Banner>
            )}

            {save.error && !serverField && !dupErr && <Banner tone="danger">{errorText(save.error)}</Banner>}
            {tried && !parsed.success && <Banner tone="warning">Some details need fixing: {Object.keys(errors).length} field{Object.keys(errors).length === 1 ? "" : "s"} above are marked.</Banner>}
            <div className="flex flex-wrap justify-end gap-3">
              <Link to="/hr" className="mtb-btn mtb-btn-secondary">
                Cancel
              </Link>
              <Button type="submit" variant="primary" icon="check" loading={save.isPending} loadingLabel="Saving…" disabled={Boolean(match)}>
                Save staff record
              </Button>
            </div>
          </form>
        )}
      </HrShell>
    </RequirePermission>
  );
}
