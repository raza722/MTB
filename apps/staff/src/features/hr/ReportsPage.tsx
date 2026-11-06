import { HR_CATEGORY_LABEL, HR_PAYMENT_LABEL, hrMonthLabel, hrMonthShort, hrQueries, hrSessionMonths, type CampusCode, type HrCategory, type HrExperienceReport, type HrGender, type HrPayslip, type HrSalaryHistory } from "@mtb/api";
import { formatCount, formatDate, formatRs } from "@mtb/domain";
import { Banner, Button, ColumnChart, Combobox, DataTable, DatePicker, EmptyState, Panel, Segmented, SegmentedBar, Select, Skeleton, Urdu, type Column } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { z } from "zod";
import { campusLabel } from "../../app/shell/campus";
import { RequirePermission, RequireSingleCampus } from "../../app/shell/page";
import { useCtx } from "../../app/session";
import { ReportDoc, SalarySheetDoc } from "./print";
import { issues, useHrSettings } from "./StaffPanels";
import { basicRs, campusHeading, DesignationSelect, downloadCsv, errorField, errorText, filterNote, HrShell, LoadError, lastMonth, staffOptions, thisMonth, today, useDesignationTitle, usePayAccess, usePrint, years } from "./shared";

export type HrReport = "strength" | "salary" | "salary-history" | "attendance" | "experience";

type ExperienceRow = HrExperienceReport["rows"][number];

/** 9,540 minutes → "159:00" (hours and minutes worked, from time in and out). */
const hoursWorked = (min: number) => (min ? `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}` : "");

const CAT_COLOR: Record<HrCategory, string> = { TEACHING: "var(--chart-1)", MANAGEMENT: "var(--chart-2)", HIFZ: "var(--chart-3)", VISITING: "var(--chart-4)", NON_TEACHING: "var(--chart-5)" };

function Actions({ onPrint, onExport, disabled }: { onPrint: () => void; onExport: () => void; disabled?: boolean }) {
  return (
    <span className="flex gap-2">
      <Button size="sm" icon="download" onClick={onExport} disabled={disabled}>
        Export
      </Button>
      <Button size="sm" icon="printer" onClick={onPrint} disabled={disabled}>
        Print
      </Button>
    </span>
  );
}

/* ---------------------------------------------------------------- Strength */

function StrengthReport() {
  const ctx = useCtx();
  const q = useQuery(hrQueries.strength(ctx));
  const { print, area } = usePrint();
  const [show, setShow] = useState("table");
  const d = q.data;
  const cols = d?.campuses ?? [];
  const label = ctx.campus === "ALL" ? "All campuses" : campusHeading(ctx.campus);
  return (
    <>
      {q.isError && <LoadError what="Staff strength" error={q.error} onRetry={() => void q.refetch()} />}
      <Panel
        id="strength"
        title="Staff strength by designation"
        description={d ? `${formatCount(d.totals.people)} people in ${formatCount(d.totals.total)} posts · ${formatCount(d.totals.female)} women, ${formatCount(d.totals.male)} men${d.totals.total > d.totals.people ? ` · ${d.totals.total - d.totals.people} person works at two campuses` : ""}` : undefined}
        rise={0}
        actions={
          <span className="flex flex-wrap gap-2">
            <Segmented aria-label="Show as" value={show} onChange={setShow} options={[{ value: "table", label: "Table" }, { value: "chart", label: "Chart" }]} />
            <Actions
              disabled={!d}
              onExport={() => d && downloadCsv(`staff-strength-${ctx.campus.toLowerCase()}.csv`, ["Designation", "Kind", ...cols.map(campusLabel), "Total", "Women", "Men"], d.rows.map((r) => [r.designation, HR_CATEGORY_LABEL[r.category], ...cols.map((c) => r.byCampus[c] ?? 0), r.total, r.female, r.male]))}
              onPrint={() =>
                d &&
                print(
                  <ReportDoc
                    campus={label}
                    title="Staff strength"
                    sub={`${d.totals.people} people · as on today`}
                    head={["Designation", ...cols.map((c) => campusLabel(c).replace(" Campus", "")), "Total", "Women", "Men"]}
                    numeric={cols.map((_, i) => i + 1).concat([cols.length + 1, cols.length + 2, cols.length + 3])}
                    rows={d.rows.map((r) => [r.designation, ...cols.map((c) => r.byCampus[c] ?? ""), r.total, r.female, r.male])}
                    total={["Total", ...cols.map((c) => d.totals.byCampus[c] ?? 0), d.totals.total, d.totals.female, d.totals.male]}
                    signatures={["Office", "Principal"]}
                  />,
                  "A4",
                )
              }
            />
          </span>
        }
      >
        {!d ? (
          <Skeleton height={260} />
        ) : show === "chart" ? (
          <div className="grid gap-5">
            <SegmentedBar label="Staff by kind of work" format={formatCount} segments={d.byCategory.map((c) => ({ key: c.category, label: HR_CATEGORY_LABEL[c.category], value: c.count, color: CAT_COLOR[c.category] }))} />
            <ColumnChart data={d.rows.filter((r) => r.total > 0)} value={(r) => r.total} axisLabel={(r) => r.designation.split(" ")[0]!.slice(0, 8)} formatAxis={(v) => String(v)} tooltip={(r) => <><div className="mtb-chart-tip-title">{r.designation}</div><div className="mtb-chart-tip-value">{r.total}</div></>} describe={(r) => `${r.designation}: ${r.total}`} label="Staff by designation" height={220} />
          </div>
        ) : (
          <table className="w-full text-small">
            <thead>
              <tr className="text-left text-ink-muted">
                <th className="py-1.5 font-medium">Designation</th>
                {cols.map((c) => (
                  <th key={c} className="py-1.5 text-right font-medium">
                    {campusLabel(c).replace(" Campus", "")}
                  </th>
                ))}
                <th className="py-1.5 text-right font-medium">Total</th>
                <th className="py-1.5 text-right font-medium">Women</th>
                <th className="py-1.5 text-right font-medium">Men</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.designationId} className="border-t border-border">
                  <td className="py-1.5">
                    <span className="flex items-center gap-2">
                      <span className="mtb-chart-key" style={{ background: CAT_COLOR[r.category] }} aria-hidden="true" />
                      {r.designation}
                    </span>
                  </td>
                  {cols.map((c) => (
                    <td key={c} className="py-1.5 text-right tabular-nums">
                      {r.byCampus[c] ?? "—"}
                    </td>
                  ))}
                  <td className="py-1.5 text-right font-medium tabular-nums">{r.total}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.female}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.male}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-border-strong font-semibold">
                <td className="py-1.5">Total</td>
                {cols.map((c) => (
                  <td key={c} className="py-1.5 text-right tabular-nums">
                    {d.totals.byCampus[c] ?? 0}
                  </td>
                ))}
                <td className="py-1.5 text-right tabular-nums">{d.totals.total}</td>
                <td className="py-1.5 text-right tabular-nums">{d.totals.female}</td>
                <td className="py-1.5 text-right tabular-nums">{d.totals.male}</td>
              </tr>
            </tbody>
          </table>
        )}
      </Panel>
      {area}
    </>
  );
}

/* ---------------------------------------------------------------- Salary register */

function SalaryRegister() {
  const ctx = useCtx();
  const overview = useQuery(hrQueries.payroll(ctx));
  const runs = (overview.data?.months ?? []).filter((m) => m.run);
  const [month, setMonth] = useState<string | null>(null);
  const [des, setDes] = useState("");
  const desTitle = useDesignationTitle(des);
  const chosen = runs.find((m) => m.month === month) ?? runs.at(-1);
  const run = useQuery(hrQueries.payrollRun(chosen?.run?.id ?? ""));
  const { print, area } = usePrint();
  const r = run.data;
  const lines = (r?.lines ?? []).filter((l) => !des || l.designationId === des);
  const paidBy = (l: HrPayslip) => (l.hold ? (l.paidOn ? `${HR_PAYMENT_LABEL[l.paymentMethod]} (${formatDate(l.paidOn)})` : "Held") : HR_PAYMENT_LABEL[l.paymentMethod]);
  if (overview.data?.settings && !overview.data.settings.runsPayroll) return <Banner tone="info">{campusLabel(ctx.campus)} pays salaries outside the system, so there is no salary register.</Banner>;
  return (
    <>
      {(overview.isError || run.isError) && <LoadError what="The salary register" error={overview.error ?? run.error} onRetry={() => void Promise.all([overview.refetch(), run.refetch()])} />}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-52">
          <Select label="Month" value={chosen?.month ?? ""} onChange={(e) => setMonth(e.target.value)} options={runs.length ? [...runs].reverse().map((m) => ({ value: m.month, label: `${hrMonthLabel(m.month)}${m.run?.status !== "PAID" ? " (not paid yet)" : ""}` })) : [{ value: "", label: "No salary sheets" }]} />
        </div>
        <DesignationSelect label="Designation" value={des} onChange={setDes} />
        {r && (
          <Actions
            disabled={!lines.length}
            onPrint={() => print(<SalarySheetDoc run={r} lines={lines} {...(desTitle ? { note: desTitle } : {})} />, "A4L")}
            onExport={() =>
              downloadCsv(
                `salary-register-${r.campus.toLowerCase()}-${r.month}${des ? `-${desTitle.toLowerCase().replace(/[^a-z]+/g, "-")}` : ""}.csv`,
                ["Employee no", "Name", "Designation", "Days paid", "Unpaid days", ...["Basic", "House rent", "Conveyance", "Medical", "Special", "Bonus"], "Gross", "EOBI", "Provident fund", "Income tax", "Loans", "Child fee", "Absence", "Other", "Total deductions", "Net", "Paid by"],
                lines.map((l) => {
                  const e = (c: string) => l.earnings.find((x) => x.code === c)?.amount ?? 0;
                  const dd = (p: (c: string) => boolean) => l.deductions.filter((x) => p(x.code)).reduce((a, x) => a + x.amount, 0);
                  return [l.employeeNo, l.name, l.designation, l.paidDays, l.unpaidDays, e("BASIC"), e("HOUSE_RENT"), e("CONVEYANCE"), e("MEDICAL"), e("SPECIAL"), e("BONUS"), l.gross, dd((c) => c === "EOBI"), dd((c) => c === "PF"), dd((c) => c === "TAX"), dd((c) => c.startsWith("LOAN:")), dd((c) => c.startsWith("CHILD:")), dd((c) => c === "ABSENCE"), dd((c) => c === "FINE"), l.totalDeductions, l.net, paidBy(l)];
                }),
              )
            }
          />
        )}
      </div>
      {!chosen ? (
        <div className="mtb-card">
          <EmptyState icon="fees" title="No salary sheets this session" />
        </div>
      ) : !r ? (
        <Skeleton height={300} />
      ) : (
        <DataTable
          caption={`Salary register ${hrMonthLabel(r.month)}`}
          rows={lines}
          rowKey="staffId"
          empty={<EmptyState icon="fees" title="Nobody with this designation on the sheet" description="Choose another designation." />}
          columns={[
            { key: "name", header: "Staff", render: (l) => <span className="grid"><span className="font-medium">{l.name}</span><span className="text-small text-ink-muted">{l.employeeNo} · {l.designation}</span></span> },
            { key: "basic", header: "Basic", align: "right", render: (l) => <span className="mtb-num">{formatRs(l.earnings.find((e) => e.code === "BASIC")?.amount ?? 0)}</span> },
            { key: "allow", header: "Allowances", align: "right", render: (l) => <span className="mtb-num">{formatRs(l.gross - (l.earnings.find((e) => e.code === "BASIC")?.amount ?? 0))}</span> },
            { key: "gross", header: "Gross", align: "right", render: (l) => <span className="mtb-num">{formatRs(l.gross)}</span> },
            { key: "ded", header: "Deductions", align: "right", render: (l) => <span className="mtb-num">{formatRs(l.totalDeductions)}</span> },
            { key: "net", header: "Net", align: "right", render: (l) => <span className="mtb-num font-semibold">{formatRs(l.net)}</span> },
            { key: "by", header: "Paid by", render: (l) => <span className="text-small">{paidBy(l)}</span> },
          ]}
          footer={{ name: <span className="font-semibold">Total ({lines.length})</span>, gross: <span className="mtb-num font-semibold">{formatRs(lines.reduce((a, l) => a + l.gross, 0))}</span>, ded: <span className="mtb-num font-semibold">{formatRs(lines.reduce((a, l) => a + l.totalDeductions, 0))}</span>, net: <span className="mtb-num font-semibold">{formatRs(lines.reduce((a, l) => a + l.net, 0))}</span> }}
        />
      )}
      {area}
    </>
  );
}

/* ---------------------------------------------------------------- Attendance summary */

function AttendanceSummary() {
  const ctx = useCtx();
  const months = hrSessionMonths(ctx.session).filter((m) => m <= thisMonth());
  // Last month by default (the one that is complete), else the latest month of the session so far.
  const [month, setMonth] = useState(() => (months.includes(lastMonth()) ? lastMonth() : (months.at(-1) ?? thisMonth())));
  const q = useQuery(hrQueries.attendanceMonth(ctx, month));
  const { print, area } = usePrint();
  const d = q.data;
  return (
    <>
      {q.isError && <LoadError what="The attendance summary" error={q.error} onRetry={() => void q.refetch()} />}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-52">
          <Select label="Month" value={month} onChange={(e) => setMonth(e.target.value)} options={[...months].reverse().map((m) => ({ value: m, label: hrMonthLabel(m) }))} />
        </div>
        {d && (
          <Actions
            onExport={() =>
              downloadCsv(
                `attendance-summary-${ctx.campus.toLowerCase()}-${month}.csv`,
                ["Employee no", "Name", "Name in Urdu", "Designation", "Present", "Late", "Absent", "Leave", "Half days", "Rest days", "Minutes late", "Hours worked", "Attendance %"],
                d.rows.map((r) => [r.employeeNo, r.name, r.nameUrdu ?? "", r.designation, r.present, r.late, r.absent, r.leave, r.halfDay, r.offDays, r.lateMinutes, hoursWorked(r.workedMinutes), r.percent ?? ""]),
              )
            }
            onPrint={() =>
              print(
                <ReportDoc
                  campus={campusHeading(ctx.campus as CampusCode)}
                  title={`Staff attendance summary · ${hrMonthLabel(month)}`}
                  sub={`${d.workingDays} working days · hours worked from time in and out`}
                  small
                  head={["Emp. no", "Name", "Name in Urdu", "Designation", "Present", "Late", "Absent", "Leave", "Rest days", "Min. late", "Hours", "%"]}
                  numeric={[4, 5, 6, 7, 8, 9, 10, 11]}
                  rows={d.rows.map((r) => [r.employeeNo, r.name, r.nameUrdu ? <Urdu size="small">{r.nameUrdu}</Urdu> : "", r.designation, r.present, r.late, r.absent, r.leave, r.offDays || "", r.lateMinutes, hoursWorked(r.workedMinutes), r.percent ?? ""])}
                />,
                "A4L",
              )
            }
          />
        )}
      </div>
      <DataTable
        caption={`Attendance summary ${hrMonthLabel(month)}`}
        rows={d?.rows ?? []}
        rowKey="staffId"
        loading={q.isLoading}
        columns={[
          { key: "name", header: "Staff", render: (r) => <span className="grid"><span className="font-medium">{r.name}</span><span className="text-small text-ink-muted">{r.employeeNo} · {r.designation}</span></span> },
          { key: "p", header: "Present", align: "right", render: (r) => <span className="mtb-num">{r.present}</span> },
          { key: "lt", header: "Late", align: "right", render: (r) => <span className="mtb-num">{r.late}</span> },
          { key: "a", header: "Absent", align: "right", render: (r) => <span className="mtb-num">{r.absent}</span> },
          { key: "lv", header: "Leave", align: "right", render: (r) => <span className="mtb-num">{r.leave}</span> },
          { key: "off", header: "Rest days", align: "right", render: (r) => <span className="mtb-num">{r.offDays || "—"}</span> },
          { key: "min", header: "Minutes late", align: "right", render: (r) => <span className="mtb-num">{r.lateMinutes}</span> },
          { key: "hrs", header: "Hours worked", align: "right", render: (r) => <span className="mtb-num">{hoursWorked(r.workedMinutes) || "—"}</span> },
          {
            key: "pct",
            header: "Attendance",
            render: (r) => (
              <span className="flex min-w-[120px] items-center gap-2">
                <span className={`hr-meter flex-1${(r.percent ?? 100) < 90 ? " is-low" : ""}`} aria-hidden="true">
                  <span style={{ width: `${r.percent ?? 0}%` }} />
                </span>
                <span className="mtb-num text-small">{r.percent ?? "—"}%</span>
              </span>
            ),
          },
        ]}
        empty={<EmptyState icon="clock" title="No attendance for this month" />}
      />
      {area}
    </>
  );
}

/* ---------------------------------------------------------------- Experience */

const experienceSchema = z.object({ asOf: z.string({ error: "Enter the date service is counted to." }).min(1, "Enter the date service is counted to.") });

function ExperienceReport() {
  const ctx = useCtx();
  const payAccess = usePayAccess();
  const settings = useHrSettings();
  // Legacy parameters: Level, Gender and "Till Date".
  const [asOf, setAsOf] = useState<string | null>(today());
  const [level, setLevel] = useState("");
  const [gender, setGender] = useState<"" | HrGender>("");
  const parsed = experienceSchema.safeParse({ asOf: asOf ?? "" });
  const errors = issues(parsed);
  const params = { ...(asOf ? { asOf } : {}), ...(level ? { level } : {}), ...(gender ? { gender } : {}) };
  const q = useQuery({ ...hrQueries.experience(ctx, params), enabled: parsed.success });
  const { print, area } = usePrint();
  const d = q.data;
  const pay = payAccess && Boolean(d?.rows.some((r) => r.basic !== undefined));
  const sub = d ? filterNote([level ? `Level: ${level}` : "Every level", gender === "F" ? "Women" : gender === "M" ? "Men" : "Women and men", `Service counted to ${formatDate(d.asOf)}`, `${d.rows.length} staff`]) : "";
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48">
          <DatePicker label="Service counted to" required value={asOf} onValueChange={setAsOf} today={today()} error={errors.asOf ?? (errorField(q.error) === "asOf" ? errorText(q.error) : undefined)} />
        </div>
        <div className="w-52">
          <Select label="Level taught" value={level} onChange={(e) => setLevel(e.target.value)} options={[{ value: "", label: "Every level" }, ...(settings.data?.teachingLevels ?? []).map((l) => ({ value: l, label: l }))]} />
        </div>
        <div className="w-40">
          <Select label="Gender" value={gender} onChange={(e) => setGender(e.target.value as "" | HrGender)} options={[{ value: "", label: "Women and men" }, { value: "F", label: "Women" }, { value: "M", label: "Men" }]} />
        </div>
      </div>
      {q.isError && errorField(q.error) !== "asOf" && <LoadError what="The experience report" error={q.error} onRetry={() => void q.refetch()} />}
      <Panel
        id="bands"
        title="Years of service"
        description={`Service at MTB plus earlier MTB service, as counted for increments.${pay ? " Basic now, increment due and new basic come from the increment table (Settings) for the scale and service." : ""}`}
        rise={0}
        actions={
          <Actions
            disabled={!d || !d.rows.length}
            onExport={() =>
              d &&
              downloadCsv(
                `staff-experience-${ctx.campus.toLowerCase()}-${d.asOf}.csv`,
                ["Employee no", "Name", "Designation", "Scale", "Joined", "MTB years", "Earlier MTB years", "Total years", ...(pay ? ["Basic now", "Increment due", "New basic"] : [])],
                d.rows.map((r) => [r.employeeNo, r.name, r.designation, r.payScale ?? "", formatDate(r.joiningDate), r.mtbYears, r.priorYears, r.totalYears, ...(pay ? [r.basic || "", r.incrementDue || "", (r.basic && r.newBasic) || ""] : [])]),
              )
            }
            onPrint={() =>
              d &&
              print(
                <ReportDoc
                  campus={ctx.campus === "ALL" ? "All campuses" : campusHeading(ctx.campus)}
                  title="Staff experience"
                  sub={sub}
                  small={pay}
                  head={["#", "Emp. no", "Name", "Designation", "Scale", "Joined", "At MTB", "Earlier", "Total", ...(pay ? ["Basic now", "Increment", "New basic"] : [])]}
                  numeric={[6, 7, 8, 9, 10, 11]}
                  rows={d.rows.map((r, i) => [i + 1, r.employeeNo, r.name, r.designation, r.payScale ?? "", formatDate(r.joiningDate), r.mtbYears.toFixed(1), r.priorYears.toFixed(1), r.totalYears.toFixed(1), ...(pay ? [basicRs(r.basic), r.incrementDue ? formatRs(r.incrementDue) : "—", r.basic && r.newBasic ? formatRs(r.newBasic) : "—"] : [])])}
                  signatures={["Office", "Principal"]}
                />,
                pay ? "A4L" : "A4",
              )
            }
          />
        }
      >
        {!parsed.success ? (
          <EmptyState icon="calendar" title="Choose the date" description="Service is counted up to this date." />
        ) : !d ? (
          <Skeleton height={220} />
        ) : (
          <ColumnChart data={d.bands} value={(b) => b.count} axisLabel={(b) => b.label.replace(" years", "").replace("and more", "+")} formatAxis={(v) => String(v)} tooltip={(b) => <><div className="mtb-chart-tip-title">{b.label}</div><div className="mtb-chart-tip-value">{b.count} staff</div></>} describe={(b) => `${b.label}: ${b.count} staff`} label="Staff by years of service" height={220} />
        )}
      </Panel>
      <DataTable
        caption={`Staff experience${sub ? `, ${sub}` : ""}`}
        rows={d?.rows ?? []}
        rowKey="staffId"
        loading={q.isLoading}
        columns={[
          { key: "name", header: "Staff", render: (r) => <span className="grid"><span className="font-medium">{r.name}</span><span className="text-small text-ink-muted">{r.employeeNo} · {r.designation}</span></span> },
          { key: "scale", header: "Scale", render: (r) => r.payScale ?? "—" },
          { key: "joined", header: "Joined", render: (r) => <span className="mtb-num text-small">{formatDate(r.joiningDate)}</span> },
          { key: "mtb", header: "At MTB", align: "right", render: (r) => <span className="mtb-num">{years(r.mtbYears)}</span> },
          { key: "prior", header: "Earlier MTB", align: "right", render: (r) => <span className="mtb-num">{r.priorYears ? years(r.priorYears) : "—"}</span> },
          { key: "total", header: "Total", align: "right", render: (r) => <span className="mtb-num font-medium">{years(r.totalYears)}</span> },
          ...(pay
            ? [
                { key: "basic", header: "Basic now", align: "right" as const, render: (r: ExperienceRow) => <span className="mtb-num">{basicRs(r.basic)}</span> },
                { key: "due", header: "Increment due", align: "right" as const, render: (r: ExperienceRow) => <span className="mtb-num">{r.incrementDue ? formatRs(r.incrementDue) : "—"}</span> },
                { key: "new", header: "New basic", align: "right" as const, render: (r: ExperienceRow) => <span className="mtb-num font-medium">{r.basic && r.newBasic ? formatRs(r.newBasic) : "—"}</span> },
              ]
            : []),
        ]}
        empty={<EmptyState icon="hr" title="Nobody matches" description="Nobody at this campus fits the level, gender and date chosen." />}
      />
      {area}
    </>
  );
}

/* ---------------------------------------------------------------- Salary history (staff × month) */

const historySchema = z
  .object({ from: z.string().min(1, "Choose the first month."), to: z.string().min(1, "Choose the last month.") })
  .refine((v) => v.to >= v.from, { path: ["to"], message: "The last month can't be before the first month." });

type HistoryRow = HrSalaryHistory["rows"][number];

/** Net salary paid to each person month by month, from approved and paid sheets (legacy staff-wise salary payment report). */
function SalaryHistoryReport() {
  const ctx = useCtx();
  const sessionMonths = hrSessionMonths(ctx.session);
  const done = sessionMonths.filter((m) => m < thisMonth());
  const months = done.length ? done : sessionMonths;
  const [from, setFrom] = useState(months[0]!);
  const [to, setTo] = useState(months.at(-1)!);
  const [des, setDes] = useState("");
  const desTitle = useDesignationTitle(des);
  const [staffId, setStaffId] = useState("");
  const staff = useQuery(hrQueries.staff(ctx));
  const parsed = historySchema.safeParse({ from, to });
  const errors = issues(parsed);
  const q = useQuery(hrQueries.salaryHistory(ctx, parsed.success ? { from, to, ...(des ? { designationId: des } : {}), ...(staffId ? { staffId } : {}) } : { from: "", to: "" }));
  const { print, area } = usePrint();
  const d = q.data;
  const person = staff.data?.find((s) => s.id === staffId);
  const sub = d ? filterNote([`${hrMonthLabel(d.months[0] ?? from)} to ${hrMonthLabel(d.months.at(-1) ?? to)}`, desTitle, person ? `${person.name} (${person.employeeNo})` : "", `${d.rows.length} staff`, "net pay from approved and paid salary sheets"]) : "";
  const columns: Array<Column<HistoryRow>> = [
    { key: "name", header: "Staff", render: (r) => <span className="grid"><span className="font-medium">{r.name}</span><span className="text-small text-ink-muted">{r.employeeNo} · {r.designation}</span></span> },
    ...(d?.months ?? []).map((m) => ({ key: `m-${m}`, header: hrMonthShort(m) + ` ${m.slice(2, 4)}`, align: "right" as const, render: (r: HistoryRow) => <span className="mtb-num">{r.byMonth[m] ? formatRs(r.byMonth[m]!) : "—"}</span> })),
    { key: "total", header: "Total", align: "right", render: (r) => <span className="mtb-num font-semibold">{formatRs(r.total)}</span> },
  ];
  const footer: Record<string, ReactNode> = d
    ? { name: <span className="font-semibold">Total ({d.rows.length})</span>, ...Object.fromEntries(d.months.map((m) => [`m-${m}`, <span className="mtb-num font-semibold">{formatRs(d.totals.byMonth[m] ?? 0)}</span>])), total: <span className="mtb-num font-semibold">{formatRs(d.totals.total)}</span> }
    : {};
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44">
          <Select label="From month" value={from} onChange={(e) => setFrom(e.target.value)} options={sessionMonths.map((m) => ({ value: m, label: hrMonthLabel(m) }))} error={errors.from} />
        </div>
        <div className="w-44">
          <Select label="To month" value={to} onChange={(e) => setTo(e.target.value)} options={sessionMonths.map((m) => ({ value: m, label: hrMonthLabel(m) }))} error={errors.to} />
        </div>
        <DesignationSelect
          label="Designation"
          value={des}
          onChange={(v) => {
            setDes(v);
            if (v && person && person.designationId !== v) setStaffId("");
          }}
        />
        <div className="w-64">
          <Combobox label="Staff member" value={staffId} onValueChange={setStaffId} options={[{ value: "", label: "Everyone" }, ...staffOptions(staff.data, (s) => !des || s.designationId === des)]} placeholder={staff.isLoading ? "Loading staff…" : "Everyone"} />
        </div>
        {d && (
          <Actions
            disabled={!d.rows.length}
            onExport={() =>
              downloadCsv(
                `salary-history-${ctx.campus.toLowerCase()}-${from}-${to}.csv`,
                ["Employee no", "Name", "Designation", ...d.months.map(hrMonthLabel), "Total"],
                [...d.rows.map((r) => [r.employeeNo, r.name, r.designation, ...d.months.map((m) => r.byMonth[m] ?? ""), r.total]), ["", "Total", "", ...d.months.map((m) => d.totals.byMonth[m] ?? 0), d.totals.total]],
              )
            }
            onPrint={() =>
              print(
                <ReportDoc
                  campus={ctx.campus === "ALL" ? "All campuses" : campusHeading(ctx.campus)}
                  title="Staff salary payments"
                  sub={sub}
                  small
                  head={["#", "Emp. no", "Name", "Designation", ...d.months.map((m) => `${hrMonthShort(m)} ${m.slice(2, 4)}`), "Total"]}
                  numeric={d.months.map((_, i) => i + 4).concat([d.months.length + 4])}
                  rows={d.rows.map((r, i) => [i + 1, r.employeeNo, r.name, r.designation, ...d.months.map((m) => (r.byMonth[m] ? formatRs(r.byMonth[m]!).slice(3) : "")), formatRs(r.total).slice(3)])}
                  total={["", "", "Total", "", ...d.months.map((m) => formatRs(d.totals.byMonth[m] ?? 0).slice(3)), formatRs(d.totals.total).slice(3)]}
                  signatures={["Accountant", "Principal"]}
                />,
                "A4L",
              )
            }
          />
        )}
      </div>
      {q.isError && <LoadError what="Salary history" error={q.error} onRetry={() => void q.refetch()} />}
      {d && d.missing.length > 0 && (
        <Banner tone="info">
          No approved or paid salary sheet yet for {d.missing.map(hrMonthLabel).join(", ")}. Those months show as “—”.
        </Banner>
      )}
      {!parsed.success ? (
        <div className="mtb-card">
          <EmptyState icon="calendar" title="Choose the months" description="Fix the months above to see the report." />
        </div>
      ) : (
        <DataTable caption={`Salary payments${sub ? `, ${sub}` : ""}`} rows={d?.rows ?? []} rowKey="staffId" loading={q.isLoading} columns={columns} {...(d && d.rows.length ? { footer } : {})} empty={<EmptyState icon="fees" title="No salary paid in these months" description={des || staffId ? "Nobody matching the filters was paid in these months." : "No approved or paid salary sheets in these months."} />} />
      )}
      {area}
    </>
  );
}

/* ---------------------------------------------------------------- Page */

export function HrReportsPage({ report, setReport }: { report: HrReport; setReport: (r: HrReport) => void }) {
  const ctx = useCtx();
  const payAccess = usePayAccess();
  const options = [
    { value: "strength", label: "Staff strength" },
    ...(payAccess
      ? [
          { value: "salary", label: "Salary register" },
          { value: "salary-history", label: "Salary history" },
        ]
      : []),
    { value: "attendance", label: "Attendance summary" },
    { value: "experience", label: "Experience" },
  ];
  const current = (report === "salary" || report === "salary-history") && !payAccess ? "strength" : report;
  return (
    <RequirePermission permission="hr.view" page="Staff reports">
      <HrShell title="Staff reports" context={`${campusLabel(ctx.campus)} · every report opens on screen first, then prints or exports to Excel`}>
        <Segmented aria-label="Report" value={current} onChange={(v) => setReport(v as HrReport)} options={options} className="justify-self-start" />
        {current === "strength" && <StrengthReport />}
        {current === "experience" && <ExperienceReport />}
        {current === "salary" && (
          <RequireSingleCampus action="the salary register">
            <SalaryRegister />
          </RequireSingleCampus>
        )}
        {current === "salary-history" && <SalaryHistoryReport />}
        {current === "attendance" && (
          <RequireSingleCampus action="the attendance summary">
            <AttendanceSummary />
          </RequireSingleCampus>
        )}
        <p className="m-0 text-small text-ink-muted">Leave, loans and increment reports print from their own pages. Salary slips print from the salary sheet. The staff list prints from Staff.</p>
      </HrShell>
    </RequirePermission>
  );
}
