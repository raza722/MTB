import { HR_CATEGORY_LABEL, hrApi, type HrCampusSettings, type HrCategory, type HrIncrementCriteria, type HrLeaveType, type HrLoanType, type HrPayDefaults, type HrSettings, type HrSettingsSection } from "@mtb/api";
import { formatDateTime, formatRs } from "@mtb/domain";
import { AmountInput, Banner, Button, Checkbox, IconButton, Input, Panel, Select, SidePanel, Skeleton, StatusBadge, Switch, useToast } from "@mtb/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { RequirePermission } from "../../app/shell/page";
import { useCan, useReadOnly } from "../../app/session";
import { useHrSettings } from "./StaffPanels";
import { errorText, HrShell, LoadError, slide } from "./shared";

function useSave(section: HrSettingsSection, rowVer: number, onDone: () => void) {
  const toast = useToast();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (value: unknown) => hrApi.saveSettings(section, { value, rowVer }),
    onSuccess: (s) => {
      queryClient.setQueryData(["hr", "settings"], s);
      void queryClient.invalidateQueries({ queryKey: ["hr"] });
      toast({ title: "Settings saved" });
      onDone();
    },
  });
}

interface Col<T> {
  key: string;
  header: string;
  className?: string;
  view: (row: T) => ReactNode;
  edit: (row: T, set: (patch: Partial<T>) => void) => ReactNode;
}

/** A list setting (designations, departments, leave types…): read view, then edit rows in place and save together. */
function ListSetting<T extends { id: string }>({ id, title, description, section, rows, cols, blank, canEdit, rowVer, rise }: { id: string; title: string; description: string; section: HrSettingsSection; rows: T[]; cols: Array<Col<T>>; blank: () => T; canEdit: boolean; rowVer: number; rise: number }) {
  const [draft, setDraft] = useState<T[] | null>(null);
  const save = useSave(section, rowVer, () => setDraft(null));
  const list = draft ?? rows;
  const set = (i: number, p: Partial<T>) => setDraft((xs) => (xs ?? rows).map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Panel
      id={id}
      title={title}
      description={description}
      rise={rise}
      actions={
        canEdit &&
        (draft ? (
          <span className="flex gap-2">
            <Button size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" icon="check" loading={save.isPending} onClick={() => save.mutate(draft)}>
              Save
            </Button>
          </span>
        ) : (
          <Button size="sm" variant="quiet" icon="edit" onClick={() => setDraft(rows.map((r) => ({ ...r })))}>
            Edit
          </Button>
        ))
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-small">
          <thead>
            <tr className="text-left text-ink-muted">
              {cols.map((c) => (
                <th key={c.key} className={`py-1.5 pr-3 font-medium ${c.className ?? ""}`}>
                  {c.header}
                </th>
              ))}
              {draft && <th />}
            </tr>
          </thead>
          <tbody>
            {list.map((r, i) => (
              <tr key={r.id || `new-${i}`} className="mtb-slide-in border-t border-border" style={slide(i)}>
                {cols.map((c) => (
                  <td key={c.key} className={`py-1.5 pr-3 align-middle ${c.className ?? ""}`}>
                    {draft ? c.edit(r, (p) => set(i, p)) : c.view(r)}
                  </td>
                ))}
                {draft && <td>{!r.id && <IconButton icon="trash" label="Remove this row" onClick={() => setDraft((xs) => (xs ?? []).filter((_, j) => j !== i))} />}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {draft && (
        <Button size="sm" icon="plus" className="mt-3" onClick={() => setDraft((xs) => [...(xs ?? rows), blank()])}>
          Add a row
        </Button>
      )}
      {save.error && <Banner tone="danger" className="mt-3">{errorText(save.error)}</Banner>}
    </Panel>
  );
}

const yesNo = (v: boolean) => (v ? <StatusBadge status="success">Yes</StatusBadge> : <StatusBadge status="neutral">No</StatusBadge>);
const activeBadge = (v: boolean) => (v ? <StatusBadge status="success">In use</StatusBadge> : <StatusBadge status="neutral">Not offered</StatusBadge>);

/* ---------------------------------------------------------------- Campus payroll and attendance */

function CampusPanel({ c, rowVer, onClose }: { c: HrCampusSettings; rowVer: number; onClose: () => void }) {
  const [runs, setRuns] = useState(c.runsPayroll);
  const [device, setDevice] = useState(c.attendanceDevice);
  const [deviceName, setDeviceName] = useState(c.deviceName ?? "");
  const [dayStarts, setDayStarts] = useState(c.dayStarts);
  const [grace, setGrace] = useState(String(c.graceMinutes));
  const [divisor, setDivisor] = useState(String(c.daysDivisor));
  const [lateOn, setLateOn] = useState(Boolean(c.lateRule));
  const [lates, setLates] = useState(String(c.lateRule?.lates ?? 3));
  const [days, setDays] = useState(String(c.lateRule?.days ?? 0.5));
  const [salaryDay, setSalaryDay] = useState(String(c.salaryDay));
  const save = useSave("campus", rowVer, onClose);
  return (
    <SidePanel
      open
      onClose={onClose}
      title={`${c.campusName}: payroll and attendance`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon="check"
            loading={save.isPending}
            onClick={() =>
              save.mutate({ campus: c.campus, runsPayroll: runs, attendanceDevice: device, deviceName: device ? deviceName : null, dayStarts, graceMinutes: Number(grace), daysDivisor: Number(divisor), lateRule: lateOn ? { lates: Number(lates), days: Number(days) } : null, salaryDay: Number(salaryDay) })
            }
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <Switch label="Prepare salaries in the system" checked={runs} onChange={(e) => setRuns(e.target.checked)} />
        <p className="-mt-3 m-0 text-small text-ink-muted">Off: the campus pays salaries outside the system. Staff records, attendance, leave and increments still work.</p>
        <Switch label="Staff punch in on a fingerprint machine" checked={device} onChange={(e) => setDevice(e.target.checked)} />
        {device && <Input label="Machine" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} placeholder="ZKTeco K40 · staff room" help="Its attendance file is imported from Staff attendance." />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Day starts" mono value={dayStarts} onChange={(e) => setDayStarts(e.target.value)} help="hh:mm, 24-hour" />
          <Input label="Grace minutes" inputMode="numeric" value={grace} onChange={(e) => setGrace(e.target.value.replace(/\D/g, ""))} help="Late after this many minutes." />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="One day's pay = monthly pay ÷" inputMode="numeric" value={divisor} onChange={(e) => setDivisor(e.target.value.replace(/\D/g, ""))} help="The old system used 26." />
          <Input label="Salaries paid on day" inputMode="numeric" value={salaryDay} onChange={(e) => setSalaryDay(e.target.value.replace(/\D/g, ""))} help="Of the next month." />
        </div>
        <Checkbox label="Late arrivals cost pay" checked={lateOn} onChange={(e) => setLateOn(e.target.checked)} />
        {lateOn && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Every … late arrivals" inputMode="numeric" value={lates} onChange={(e) => setLates(e.target.value.replace(/\D/g, ""))} />
            <Select label="cost" value={days} onChange={(e) => setDays(e.target.value)} options={[{ value: "0.5", label: "Half a day's pay" }, { value: "1", label: "One day's pay" }]} />
          </div>
        )}
        {save.error && <Banner tone="danger">{errorText(save.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

/* ---------------------------------------------------------------- Pay defaults */

function PayDefaultsPanel({ s, onClose }: { s: HrSettings; onClose: () => void }) {
  const [v, setV] = useState<HrPayDefaults>({ ...s.payDefaults });
  const save = useSave("payDefaults", s.rowVer, onClose);
  return (
    <SidePanel
      open
      onClose={onClose}
      title="Allowances and deductions"
      description="Apply to everyone with a salary; individual special allowances are set on each profile."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="check" loading={save.isPending} onClick={() => save.mutate(v)}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Input label="House rent (% of basic, staff with a pay scale)" suffix="%" inputMode="numeric" value={String(v.houseRentPct)} onChange={(e) => setV({ ...v, houseRentPct: Number(e.target.value.replace(/\D/g, "")) })} />
        <Input label="House rent (% of basic, staff without a pay scale)" suffix="%" inputMode="numeric" value={String(v.houseRentPctNoScale)} onChange={(e) => setV({ ...v, houseRentPctNoScale: Number(e.target.value.replace(/\D/g, "")) })} />
        <AmountInput label="Conveyance a month" value={v.conveyance} onValueChange={(x) => setV({ ...v, conveyance: x ?? 0 })} />
        <AmountInput label="Medical a month" value={v.medical} onValueChange={(x) => setV({ ...v, medical: x ?? 0 })} />
        <AmountInput label="EOBI (employee's share) a month" value={v.eobi} onValueChange={(x) => setV({ ...v, eobi: x ?? 0 })} />
        <Input label="Provident fund (% of basic)" suffix="%" inputMode="numeric" value={String(v.providentFundPct)} onChange={(e) => setV({ ...v, providentFundPct: Number(e.target.value.replace(/\D/g, "")) })} />
        {save.error && <Banner tone="danger">{errorText(save.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

/* ---------------------------------------------------------------- Page */

export function HrSettingsPage() {
  const q = useHrSettings();
  const readOnly = useReadOnly();
  const canHr = useCan("hr.manage") && !readOnly;
  const canPay = useCan("payroll.manage") && !readOnly;
  const [campus, setCampus] = useState<HrCampusSettings | null>(null);
  const [defaults, setDefaults] = useState(false);
  const s = q.data;
  const num = (v: string) => Number(v.replace(/[^\d.]/g, ""));
  return (
    <RequirePermission permission="hr.view" page="Staff settings">
      <HrShell title="Staff and payroll settings" context={s ? `Shared by every campus · last changed by ${s.updatedBy}, ${formatDateTime(s.updatedAt)}` : "Shared by every campus"}>
        {q.isError && <LoadError what="Settings" error={q.error} onRetry={() => void q.refetch()} />}
        {!s ? (
          <Skeleton height={400} />
        ) : (
          <>
            <Panel id="campuses" title="Payroll and attendance by campus" description="Which campuses prepare salaries and use a fingerprint machine, and their rules." rise={0}>
              <div className="overflow-x-auto">
                <table className="w-full text-small">
                  <thead>
                    <tr className="text-left text-ink-muted">
                      <th className="py-1.5 pr-3 font-medium">Campus</th>
                      <th className="py-1.5 pr-3 font-medium">Payroll</th>
                      <th className="py-1.5 pr-3 font-medium">Fingerprint machine</th>
                      <th className="py-1.5 pr-3 font-medium">Day starts</th>
                      <th className="py-1.5 pr-3 font-medium">Day's pay</th>
                      <th className="py-1.5 pr-3 font-medium">Late rule</th>
                      <th className="py-1.5 pr-3 font-medium">Paid on</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {s.campuses.map((c, i) => (
                      <tr key={c.campus} className="mtb-slide-in border-t border-border" style={slide(i)}>
                        <td className="py-1.5 pr-3 font-medium">{c.campusName}</td>
                        <td className="py-1.5 pr-3">{c.runsPayroll ? <StatusBadge status="success">In the system</StatusBadge> : <StatusBadge status="neutral">Outside the system</StatusBadge>}</td>
                        <td className="py-1.5 pr-3">{c.attendanceDevice ? c.deviceName : <span className="text-ink-muted">Marked by hand</span>}</td>
                        <td className="py-1.5 pr-3 tabular-nums">
                          {c.dayStarts} (+{c.graceMinutes} min)
                        </td>
                        <td className="py-1.5 pr-3">Pay ÷ {c.daysDivisor}</td>
                        <td className="py-1.5 pr-3">{c.lateRule ? `${c.lateRule.lates} late = ${c.lateRule.days === 1 ? "1 day" : "½ day"}` : "None"}</td>
                        <td className="py-1.5 pr-3">{c.salaryDay}th of next month</td>
                        <td className="py-1.5">{canPay && <Button size="sm" variant="quiet" icon="edit" onClick={() => setCampus(c)}>Change</Button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel id="defaults" title="Allowances and standard deductions" description="Worked out on every salary sheet." rise={1} actions={canPay ? <Button size="sm" variant="quiet" icon="edit" onClick={() => setDefaults(true)}>Edit</Button> : undefined}>
              <p className="m-0 text-small">
                House rent {s.payDefaults.houseRentPct}% of basic ({s.payDefaults.houseRentPctNoScale}% for staff without a pay scale) · conveyance {formatRs(s.payDefaults.conveyance)} · medical {formatRs(s.payDefaults.medical)} · EOBI {formatRs(s.payDefaults.eobi)} · provident fund {s.payDefaults.providentFundPct}% of basic · income tax on the salaried slabs.
              </p>
            </Panel>

            <div className="grid items-start gap-6 xl:grid-cols-2">
              <ListSetting<HrSettings["designations"][number]>
                id="designations"
                title="Designations"
                description="Job titles, each with its kind of work."
                section="designations"
                rows={s.designations}
                rowVer={s.rowVer}
                canEdit={canHr}
                rise={2}
                blank={() => ({ id: "", title: "", category: "TEACHING", active: true, staff: 0 })}
                cols={[
                  { key: "title", header: "Title", view: (r) => r.title, edit: (r, set) => <Input aria-label="Title" value={r.title} onChange={(e) => set({ title: e.target.value })} /> },
                  { key: "cat", header: "Kind", view: (r) => HR_CATEGORY_LABEL[r.category], edit: (r, set) => <Select aria-label="Kind" value={r.category} onChange={(e) => set({ category: e.target.value as HrCategory })} options={(Object.keys(HR_CATEGORY_LABEL) as HrCategory[]).map((c) => ({ value: c, label: HR_CATEGORY_LABEL[c] }))} /> },
                  { key: "staff", header: "Staff", className: "text-right", view: (r) => <span className="tabular-nums">{r.staff}</span>, edit: (r) => <span className="tabular-nums">{r.staff}</span> },
                  { key: "active", header: "", view: (r) => activeBadge(r.active), edit: (r, set) => <Checkbox label="In use" checked={r.active} onChange={(e) => set({ active: e.target.checked })} /> },
                ]}
              />
              <ListSetting<HrSettings["departments"][number]>
                id="departments"
                title="Departments"
                description="Also used by rooms and the warehouse."
                section="departments"
                rows={s.departments}
                rowVer={s.rowVer}
                canEdit={canHr}
                rise={3}
                blank={() => ({ id: "", title: "", active: true, staff: 0 })}
                cols={[
                  { key: "title", header: "Department", view: (r) => r.title, edit: (r, set) => <Input aria-label="Department" value={r.title} onChange={(e) => set({ title: e.target.value })} /> },
                  { key: "staff", header: "Staff", className: "text-right", view: (r) => <span className="tabular-nums">{r.staff}</span>, edit: (r) => <span className="tabular-nums">{r.staff}</span> },
                  { key: "active", header: "", view: (r) => activeBadge(r.active), edit: (r, set) => <Checkbox label="In use" checked={r.active} onChange={(e) => set({ active: e.target.checked })} /> },
                ]}
              />
              <ListSetting<HrLeaveType>
                id="leave-types"
                title="Leave types"
                description="Days allowed each session; unpaid leave is taken off salary."
                section="leaveTypes"
                rows={s.leaveTypes}
                rowVer={s.rowVer}
                canEdit={canHr}
                rise={4}
                blank={() => ({ id: "", code: "", name: "", daysPerYear: 5, paid: true, proofAfterDays: null, active: true })}
                cols={[
                  { key: "name", header: "Leave", view: (r) => r.name, edit: (r, set) => <Input aria-label="Leave name" value={r.name} onChange={(e) => set({ name: e.target.value })} /> },
                  { key: "days", header: "Days a session", view: (r) => (r.daysPerYear === null ? "No limit" : r.daysPerYear), edit: (r, set) => <Input aria-label="Days" inputMode="numeric" value={r.daysPerYear === null ? "" : String(r.daysPerYear)} placeholder="No limit" onChange={(e) => set({ daysPerYear: e.target.value === "" ? null : num(e.target.value) })} className="w-24" /> },
                  { key: "paid", header: "Paid", view: (r) => yesNo(r.paid), edit: (r, set) => <Checkbox label="Paid" checked={r.paid} onChange={(e) => set({ paid: e.target.checked })} /> },
                  { key: "proof", header: "Proof after", view: (r) => (r.proofAfterDays ? `${r.proofAfterDays} days` : "—"), edit: (r, set) => <Input aria-label="Proof after days" inputMode="numeric" value={r.proofAfterDays ? String(r.proofAfterDays) : ""} onChange={(e) => set({ proofAfterDays: e.target.value ? num(e.target.value) : null })} className="w-20" /> },
                  { key: "active", header: "", view: (r) => activeBadge(r.active), edit: (r, set) => <Checkbox label="Offered" checked={r.active} onChange={(e) => set({ active: e.target.checked })} /> },
                ]}
              />
              <ListSetting<HrLoanType>
                id="loan-types"
                title="Loan and advance types"
                description="Limits are checked when a loan is requested."
                section="loanTypes"
                rows={s.loanTypes}
                rowVer={s.rowVer}
                canEdit={canPay}
                rise={5}
                blank={() => ({ id: "", name: "", kind: "LOAN", maxTimesBasic: 1, maxInstallments: 6, active: true })}
                cols={[
                  { key: "name", header: "Kind", view: (r) => r.name, edit: (r, set) => <Input aria-label="Name" value={r.name} onChange={(e) => set({ name: e.target.value })} /> },
                  { key: "kind", header: "Paid back", view: (r) => (r.kind === "ADVANCE" ? "From the next salary" : "In installments"), edit: (r, set) => <Select aria-label="Paid back" value={r.kind} onChange={(e) => set({ kind: e.target.value as "LOAN" | "ADVANCE" })} options={[{ value: "LOAN", label: "In installments" }, { value: "ADVANCE", label: "From the next salary" }]} /> },
                  { key: "max", header: "Up to", view: (r) => `${r.maxTimesBasic}× basic`, edit: (r, set) => <Input aria-label="Times basic" inputMode="decimal" suffix="× basic" value={String(r.maxTimesBasic)} onChange={(e) => set({ maxTimesBasic: num(e.target.value) })} className="w-32" /> },
                  { key: "inst", header: "Installments", view: (r) => r.maxInstallments, edit: (r, set) => <Input aria-label="Installments" inputMode="numeric" value={String(r.maxInstallments)} onChange={(e) => set({ maxInstallments: num(e.target.value) })} className="w-20" /> },
                ]}
              />
            </div>

            <ListSetting<HrIncrementCriteria>
              id="criteria"
              title="Annual increment table"
              description="Amount added each year by pay scale and years of service. Bands are from (included) up to (not included), so no year falls in two bands or in none."
              section="criteria"
              rows={[...s.criteria].sort((a, b) => a.payScale.localeCompare(b.payScale) || a.fromYears - b.fromYears)}
              rowVer={s.rowVer}
              canEdit={canPay}
              rise={6}
              blank={() => ({ id: "", payScale: s.payScales[0] ?? "", fromYears: 0, toYears: 3, amount: 0, active: true })}
              cols={[
                { key: "scale", header: "Pay scale", view: (r) => `Scale ${r.payScale}`, edit: (r, set) => <Select aria-label="Scale" value={r.payScale} onChange={(e) => set({ payScale: e.target.value })} options={s.payScales.map((x) => ({ value: x, label: `Scale ${x}` }))} /> },
                { key: "from", header: "From (years)", view: (r) => r.fromYears, edit: (r, set) => <Input aria-label="From years" inputMode="decimal" value={String(r.fromYears)} onChange={(e) => set({ fromYears: num(e.target.value) })} className="w-24" /> },
                { key: "to", header: "Up to (years)", view: (r) => (r.toYears >= 50 ? "and more" : r.toYears), edit: (r, set) => <Input aria-label="To years" inputMode="decimal" value={String(r.toYears)} onChange={(e) => set({ toYears: num(e.target.value) })} className="w-24" /> },
                { key: "amount", header: "Increment a month", className: "text-right", view: (r) => <span className="tabular-nums">{formatRs(r.amount)}</span>, edit: (r, set) => <AmountInput aria-label="Amount" value={r.amount} onValueChange={(x) => set({ amount: x ?? 0 })} className="w-36" /> },
                { key: "active", header: "", view: (r) => activeBadge(r.active), edit: (r, set) => <Checkbox label="In use" checked={r.active} onChange={(e) => set({ active: e.target.checked })} /> },
              ]}
            />

            {campus && <CampusPanel c={campus} rowVer={s.rowVer} onClose={() => setCampus(null)} />}
            {defaults && <PayDefaultsPanel s={s} onClose={() => setDefaults(false)} />}
          </>
        )}
      </HrShell>
    </RequirePermission>
  );
}
