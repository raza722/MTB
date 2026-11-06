import { HR_PAYMENT_LABEL, hrMonthLabel, type HrBankList, type HrPayrollRun, type HrPayslip, type HrStaffProfile } from "@mtb/api";
import { amountInWords, formatCnic, formatDate, formatMobile, formatRs } from "@mtb/domain";
import { Urdu } from "@mtb/ui";
import type { ReactNode } from "react";
import { campusHeading, cnicOrDash, dateOrDash, employmentLabel, Ltr, mobileOrDash, orDash, sessionOf, today, years } from "./shared";

/** Heading used by every printed HR document. */
export function DocHead({ campus, title, sub }: { campus: string; title: ReactNode; sub?: ReactNode }) {
  return (
    <div className="hr-doc-head">
      <div>
        <p>MTB Schools and Colleges · {campus}</p>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      <p>Printed {formatDate(today())}</p>
    </div>
  );
}

export function Signatures({ labels }: { labels: string[] }) {
  return (
    <div className="hr-doc-sign" style={{ gridTemplateColumns: `repeat(${labels.length}, 1fr)` }}>
      {labels.map((l) => (
        <div key={l}>{l}</div>
      ))}
    </div>
  );
}

/** A generic printed register: heading, one table, optional totals row and signatures. */
export function ReportDoc({
  campus,
  title,
  sub,
  head,
  rows,
  total,
  numeric = [],
  small,
  signatures = ["Prepared by", "Checked by", "Principal"],
  note,
}: {
  campus: string;
  title: string;
  sub?: ReactNode;
  head: string[];
  rows: Array<Array<ReactNode>>;
  total?: Array<ReactNode>;
  numeric?: number[];
  small?: boolean;
  signatures?: string[];
  note?: ReactNode;
}) {
  return (
    <div className={`hr-doc${small ? " hr-doc-small" : ""}`}>
      <DocHead campus={campus} title={title} sub={sub} />
      <table>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} className={numeric.includes(i) ? "n" : undefined}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={numeric.includes(j) ? "n" : undefined}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
          {total && (
            <tr className="tot">
              {total.map((c, j) => (
                <td key={j} className={numeric.includes(j) ? "n" : undefined}>
                  {c}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
      {note && <p className="hr-doc-small">{note}</p>}
      {signatures.length > 0 && <Signatures labels={signatures} />}
    </div>
  );
}

/** Appointment letter (legacy "Appointment Letter" report), filled from the profile. */
export function AppointmentLetterDoc({ s, principal }: { s: HrStaffProfile; principal: string }) {
  const p = s.postings.find((x) => x.primary) ?? s.postings[0]!;
  const title = s.gender === "F" ? (s.maritalStatus === "MARRIED" ? "Mrs" : s.maritalStatus === null ? "Ms" : "Miss") : "Mr";
  const plain = s.name.replace(/^(Mr|Ms|Mrs|Dr|Qari)\s+/, "");
  return (
    <div className="hr-doc hr-letter">
      <DocHead campus={campusHeading(p.campus)} title="Appointment letter" sub={`Ref: ${s.employeeNo}`} />
      <p>
        <strong>Subject: Appointment</strong>
      </p>
      <p>
        {title} {plain}
        {s.guardianName ? `, ${s.relation} ${s.guardianName}` : ""}
        {s.address ? `, resident of ${s.address}` : ""}
        {s.cnic && (
          <>
            , CNIC <Ltr>{formatCnic(s.cnic)}</Ltr>
          </>
        )}
        , is appointed as <strong>{p.designation}</strong>
        {p.department ? ` (${p.department})` : ""} at {p.campusName} on a{" "}
        {employmentLabel[p.employmentType].toLowerCase()} basis from <strong>{formatDate(p.startDate)}</strong>
        {p.payScale ? `, in pay scale ${p.payScale}` : ""}.
      </p>
      <p>Salary and allowances will be paid as per the school's pay scales and the salary structure on file, on the 5th of each month for the month before.</p>
      <p>
        <strong>Terms and conditions</strong>
      </p>
      <ol>
        {p.employmentType === "PROBATION" && <li>The first six months are a probation period{s.probationEnds ? ` (until ${formatDate(s.probationEnds)})` : ""}, after which the appointment is confirmed in writing.</li>}
        <li>Either side may end the appointment with one month's written notice, or one month's salary instead of notice.</li>
        <li>School timings, leave and conduct follow the staff rules in force. Leave is applied for through the office or the teacher app.</li>
        <li>Original documents (CNIC, degrees, experience letters) are shown at joining; copies stay on the staff file.</li>
        <li>The appointee joins duty on the date above.</li>
      </ol>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "18mm" }}>
        <div>
          <div style={{ borderTop: "0.6pt solid var(--ink)", paddingTop: "1mm", minWidth: "60mm" }}>Received and accepted</div>
          <div className="hr-doc-small">{s.name}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ borderTop: "0.6pt solid var(--ink)", paddingTop: "1mm", minWidth: "60mm" }}>Principal</div>
          <div className="hr-doc-small">{principal}</div>
        </div>
      </div>
    </div>
  );
}

/** Employee profile (legacy "Employee Profile" report). */
export function ProfileDoc({ s }: { s: HrStaffProfile }) {
  const p = s.postings.find((x) => x.primary) ?? s.postings[0]!;
  const kv = (items: Array<[string, ReactNode]>) => (
    <dl className="hr-doc-kv">
      {items.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
  return (
    <div className="hr-doc">
      <DocHead campus={campusHeading(p.campus)} title="Staff profile" sub={`${s.name} · ${s.employeeNo}`} />
      <h2>Personal</h2>
      {kv([
        ["Name", <>{s.name}{s.nameUrdu && <> · <Urdu size="small">{s.nameUrdu}</Urdu></>}</>],
        [s.relation === "w/o" ? "Husband" : "Father", orDash(s.guardianName)],
        ["CNIC", <Ltr>{cnicOrDash(s.cnic)}</Ltr>],
        ["Date of birth", dateOrDash(s.dob)],
        ["Blood group", orDash(s.bloodGroup)],
        ["Marital status", s.maritalStatus ? s.maritalStatus.charAt(0) + s.maritalStatus.slice(1).toLowerCase() : "—"],
        [
          "Mobile",
          <Ltr>
            {mobileOrDash(s.mobile)}
            {s.mobile2 ? `, ${formatMobile(s.mobile2)}` : ""}
          </Ltr>,
        ],
        ["Email", s.email ? <Ltr>{s.email}</Ltr> : "—"],
        ["Address", orDash(s.address)],
        ["City", orDash(s.city)],
        ["Emergency contact", s.emergency ? `${s.emergency.name} (${s.emergency.relation}) ${mobileOrDash(s.emergency.mobile)}` : "—"],
        ["Reference", s.reference ?? "—"],
        ["Caste", s.caste ?? "—"],
      ])}
      <h2>Employment</h2>
      <table>
        <thead>
          <tr>
            <th>Campus</th>
            <th>Designation</th>
            <th>Department</th>
            <th>Type</th>
            <th>Scale</th>
            <th>From</th>
            <th>To</th>
          </tr>
        </thead>
        <tbody>
          {s.postings.map((x) => (
            <tr key={x.id}>
              <td>
                {x.campusName}
                {x.primary ? " (main)" : ""}
              </td>
              <td>{x.designation}</td>
              <td>{orDash(x.department)}</td>
              <td>{employmentLabel[x.employmentType]}</td>
              <td>{x.payScale ?? "—"}</td>
              <td>{formatDate(x.startDate)}</td>
              <td>{x.endDate ? formatDate(x.endDate) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {kv([
        ["Joining date", formatDate(s.joiningDate)],
        ["Service", `${years(s.serviceYears)}${s.priorServiceYears ? ` (includes ${years(s.priorServiceYears)} earlier MTB service)` : ""}`],
        ["Teaching", s.teachingLevels.length ? `${s.teachingLevels.join(", ")}${s.subjects.length ? ` · ${s.subjects.join(", ")}` : ""}` : "—"],
        // Pay roles only: the profile carries pay only when the viewer may see it.
        ...(s.pay ? ([["Basic pay", `${s.pay.basic ? `${formatRs(s.pay.basic)} a month` : "Not set yet"}${s.pay.payScale ? ` · scale ${s.pay.payScale}` : ""}`]] as Array<[string, ReactNode]>) : []),
      ])}
      <h2>Qualifications</h2>
      <table>
        <thead>
          <tr>
            <th>Degree</th>
            <th>Institution</th>
            <th>Year</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {s.qualifications.map((q) => (
            <tr key={q.id}>
              <td>{q.degree}</td>
              <td>{orDash(q.institution)}</td>
              <td>{q.year ?? "—"}</td>
              <td>{orDash(q.result)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {s.experience.length > 0 && (
        <>
          <h2>Earlier experience</h2>
          <table>
            <tbody>
              {s.experience.map((x) => (
                <tr key={x.id}>
                  <td>{x.organisation}</td>
                  <td>{x.role}</td>
                  <td>
                    {formatDate(x.from)} – {formatDate(x.to)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <Signatures labels={["Employee", "Office", "Principal"]} />
    </div>
  );
}

/** Staff ID card, 86 × 54 mm (front). */
export function IdCardDoc({ s }: { s: HrStaffProfile }) {
  const p = s.postings.find((x) => x.primary) ?? s.postings[0]!;
  const initials = s.name
    .replace(/^(Mr|Ms|Mrs|Dr|Qari)\s+/, "")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("");
  return (
    <div className="hr-card">
      <div className="hr-card-band">
        <span>MTB Schools and Colleges</span>
        <span>STAFF</span>
      </div>
      <div className="hr-card-body">
        <div className="hr-card-photo" aria-hidden="true">
          {initials}
        </div>
        <div style={{ display: "grid", gap: "0.8mm" }}>
          <span className="hr-card-name">{s.name}</span>
          {s.nameUrdu && <Urdu size="small">{s.nameUrdu}</Urdu>}
          <span>{p.designation}</span>
          <span>{p.campusName}</span>
          <span>
            <Ltr>{s.employeeNo}</Ltr>
            {s.bloodGroup ? ` · Blood ${s.bloodGroup}` : ""}
          </span>
        </div>
      </div>
      <div className="hr-card-foot">
        <span>
          CNIC <Ltr>{cnicOrDash(s.cnic)}</Ltr>
        </span>
        {/* Valid to the end of the session it is printed in (sessions run April to March). */}
        <span>Valid until {formatDate(`${sessionOf(today()) + 1}-03-31`)}</span>
      </div>
    </div>
  );
}

/** Salary slip, one per A5 page. */
export function PayslipDoc({ run, slip, first }: { run: Pick<HrPayrollRun, "campus" | "month" | "status" | "paymentDate">; slip: HrPayslip; first?: boolean }) {
  return (
    <div className={`hr-slip${first ? "" : " hr-break"}`}>
      <div className="hr-slip-head">
        <div>
          <strong>Salary slip · {hrMonthLabel(run.month)}</strong>
          <span>MTB Schools and Colleges · {campusHeading(run.campus)}</span>
        </div>
        <span className="hr-slip-note" style={{ textAlign: "right" }}>
          {slip.paidOn ? `Paid ${formatDate(slip.paidOn)} (held, paid later)` : slip.hold ? "Held: not paid with the sheet" : run.status === "PAID" && run.paymentDate ? `Paid ${formatDate(run.paymentDate)}` : "Not paid yet"}
          <br />
          {HR_PAYMENT_LABEL[slip.paymentMethod]}
          {slip.bank ? ` · ${slip.bank.bankName} ${slip.bank.accountNoMasked}` : ""}
        </span>
      </div>
      <table>
        <tbody>
          <tr>
            <td>
              <strong>{slip.name}</strong> · {slip.employeeNo}
              {slip.cnic && (
                <>
                  {" "}
                  · CNIC <Ltr>{formatCnic(slip.cnic)}</Ltr>
                </>
              )}
            </td>
            <td className="n">
              {slip.designation}
              {slip.payScale ? ` · scale ${slip.payScale}` : ""}
            </td>
          </tr>
          <tr>
            <td colSpan={2} className="hr-slip-note">
              Days paid {slip.paidDays} of {slip.monthDays} · present {slip.presentDays} · leave {slip.leaveDays} · unpaid {slip.unpaidDays} · late {slip.lateCount}
              {slip.notMarkedDays ? ` · not marked ${slip.notMarkedDays}` : ""}
            </td>
          </tr>
        </tbody>
      </table>
      <div className="hr-slip-cols">
        <table>
          <thead>
            <tr>
              <th>Earnings</th>
              <th className="n">Rs</th>
            </tr>
          </thead>
          <tbody>
            {slip.earnings.map((e) => (
              <tr key={e.code}>
                <td>
                  {e.label}
                  {e.note && <div className="hr-slip-note">{e.note}</div>}
                </td>
                <td className="n">{formatRs(e.amount).slice(3)}</td>
              </tr>
            ))}
            <tr className="tot">
              <td>Gross pay</td>
              <td className="n">{formatRs(slip.gross).slice(3)}</td>
            </tr>
          </tbody>
        </table>
        <table>
          <thead>
            <tr>
              <th>Deductions</th>
              <th className="n">Rs</th>
            </tr>
          </thead>
          <tbody>
            {slip.deductions.map((d) => (
              <tr key={d.code}>
                <td>
                  {d.label}
                  {d.note && <div className="hr-slip-note">{d.note}</div>}
                </td>
                <td className="n">{formatRs(d.amount).slice(3)}</td>
              </tr>
            ))}
            <tr className="tot">
              <td>Total deductions</td>
              <td className="n">{formatRs(slip.totalDeductions).slice(3)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="hr-slip-net">
        <span>Net pay</span>
        <span>{formatRs(slip.net)}</span>
      </div>
      <span className="hr-slip-words">{amountInWords(slip.net)} only</span>
      {slip.note && !slip.bonus && !slip.fine && (
        <span>
          <strong>Remarks:</strong> {slip.note}
        </span>
      )}
      {slip.flags.length > 0 && <span className="hr-slip-note">{slip.flags.join(" ")}</span>}
      <span className="hr-slip-note">Computer-generated slip. Questions about this slip go to the accounts office within seven days.</span>
      <Signatures labels={["Received by (staff)", "Accountant"]} />
    </div>
  );
}

/** Letter to the bank with the transfer list (account numbers in full, for the bank only). */
export function BankAdviceDoc({ list }: { list: HrBankList }) {
  return (
    <div className="hr-doc">
      <DocHead campus={campusHeading(list.campus)} title={`Salary transfer · ${hrMonthLabel(list.month)}`} sub={list.paymentDate ? `Value date ${formatDate(list.paymentDate)}` : undefined} />
      <p>
        The Manager, {list.schoolAccount?.bankName ?? "the bank"}, {list.schoolAccount?.branch ?? ""}
      </p>
      <p>
        Please debit our account <strong>{list.schoolAccount?.accountTitle}</strong> (<Ltr>{list.schoolAccount?.accountNo}</Ltr>) with <strong>{formatRs(list.total)}</strong> ({amountInWords(list.total)} only) and credit the {list.rows.length} accounts below with the
        amounts shown, as salaries for {hrMonthLabel(list.month)}.
      </p>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Staff</th>
            <th>Account title</th>
            <th>Bank and branch</th>
            <th>Account number</th>
            <th className="n">Amount (Rs)</th>
          </tr>
        </thead>
        <tbody>
          {list.rows.map((r, i) => (
            <tr key={r.staffId}>
              <td>{i + 1}</td>
              <td>
                {r.name} ({r.employeeNo})
              </td>
              <td>{r.accountTitle}</td>
              <td>
                {r.bankName}, {r.branch}
              </td>
              <td>
                <Ltr>{r.accountNo}</Ltr>
              </td>
              <td className="n">{formatRs(r.amount).slice(3)}</td>
            </tr>
          ))}
          <tr className="tot">
            <td colSpan={5}>Total to transfer</td>
            <td className="n">{formatRs(list.total).slice(3)}</td>
          </tr>
        </tbody>
      </table>
      <Signatures labels={["Accountant", "Principal (authorised signatory)"]} />
    </div>
  );
}

/**
 * Monthly salary sheet (legacy "Monthly Salary" / "Full Salary" report), A4 landscape. `lines` prints part of the sheet
 * (one designation, or cash and cheque staff); totals are worked out from the lines printed. The last column is left
 * blank for each person's signature on receipt.
 */
export function SalarySheetDoc({ run, lines = run.lines, note }: { run: HrPayrollRun; lines?: HrPayslip[]; note?: string }) {
  const codes = ["BASIC", "HOUSE_RENT", "CONVEYANCE", "MEDICAL", "SPECIAL", "BONUS"];
  const amt = (l: HrPayslip, code: string) => l.earnings.find((e) => e.code === code)?.amount ?? 0;
  const ded = (l: HrPayslip, pred: (c: string) => boolean) => l.deductions.filter((d) => pred(d.code)).reduce((a, d) => a + d.amount, 0);
  const groups: Array<[string, (c: string) => boolean]> = [
    ["Absence", (c) => c === "ABSENCE"],
    ["EOBI", (c) => c === "EOBI"],
    ["PF", (c) => c === "PF"],
    ["Tax", (c) => c === "TAX"],
    ["Loans", (c) => c.startsWith("LOAN:")],
    ["Child fee", (c) => c.startsWith("CHILD:")],
    ["Other", (c) => c === "FINE"],
  ];
  const n = (v: number) => (v ? formatRs(v).slice(3) : "");
  const paidBy = (l: HrPayslip) => (l.hold ? (l.paidOn ? `${HR_PAYMENT_LABEL[l.paymentMethod]}, ${formatDate(l.paidOn)}` : "Held") : HR_PAYMENT_LABEL[l.paymentMethod]);
  return (
    <ReportDoc
      campus={campusHeading(run.campus)}
      title={`Salary sheet · ${hrMonthLabel(run.month)}`}
      sub={[`${lines.length} staff`, note, run.status === "PAID" ? `paid ${run.paymentDate ? formatDate(run.paymentDate) : ""}` : run.status === "APPROVED" ? `approved by ${run.decidedBy}` : "not approved yet"].filter(Boolean).join(" · ")}
      small
      head={["#", "Name", "Designation", "Days", "Basic", "House rent", "Conv.", "Medical", "Special", "Bonus", "Gross", ...groups.map((g) => g[0]), "Net", "Paid by", "Signature"]}
      numeric={[3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]}
      rows={lines.map((l, i) => [i + 1, `${l.name} (${l.employeeNo})`, l.designation, `${l.paidDays - l.unpaidDays}/${l.monthDays}`, ...codes.map((c) => n(amt(l, c))), n(l.gross), ...groups.map((g) => n(ded(l, g[1]))), n(l.net), paidBy(l), <span className="hr-sign-cell" />])}
      total={["", "Total", "", "", ...codes.map((c) => n(lines.reduce((a, l) => a + amt(l, c), 0))), n(lines.reduce((a, l) => a + l.gross, 0)), ...groups.map((g) => n(lines.reduce((a, l) => a + ded(l, g[1]), 0))), n(lines.reduce((a, l) => a + l.net, 0)), "", ""]}
      signatures={["Prepared by (Accountant)", "Checked by", "Approved by (Principal)"]}
    />
  );
}

export const docEmploymentLabel = employmentLabel;
