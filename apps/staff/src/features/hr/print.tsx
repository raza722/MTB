import { HR_PAYMENT_LABEL, hrMonthLabel, type HrBankList, type HrPayrollRun, type HrPayslip, type HrStaffProfile, photoUrl } from "@mtb/api";
import { amountInWords, formatCnic, formatDate, formatMobile, formatRs } from "@mtb/domain";
import { Urdu, PhotoBox } from "@mtb/ui";
import type { ReactNode } from "react";
import { Letterhead } from "../../app/print/letterhead";
import { campusHeading, cnicOrDash, employmentLabel, Ltr, orDash, sessionOf, today, years } from "./shared";
import { StaffPhoto } from "../../app/print/photo";

/**
 * Heading used by every printed HR document: the old letterhead (crest, "MTB-Madrasat-ul-Banat Schools and Colleges,
 * Khalid Campus, Sadikabad") with the title under it. `campus` is the campus part ("Khalid Campus, Sadikabad") or
 * "All campuses".
 */
export function DocHead({ campus, title, sub, right }: { campus: string; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="hr-doc-head">
      <Letterhead campus={campus === "All campuses" ? "ALL" : campus} title={title} sub={sub} right={right} titleCase="as-is" />
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

/**
 * Appointment letter, laid out as the old "Appointment Letter" report: the letterhead, "Subject :- APPOINTMENT", the
 * name, parentage and address on ruled lines, the appointment sentence, the pay sentence, TERMS & CONDITIONS 1 and 2,
 * "Principal" at the right and the date at the left. The old letter always said "temporary basis, with immediate
 * effect"; this one prints the posting's employment type and start date, and the reference number at the top right.
 */
export function AppointmentLetterDoc({ s, principal }: { s: HrStaffProfile; principal: string }) {
  const p = s.postings.find((x) => x.primary) ?? s.postings[0]!;
  const plain = s.name.replace(/^(Mr|Ms|Mrs|Dr|Qari)\s+/, "");
  const basis = p.employmentType === "PROBATION" ? "probation" : employmentLabel[p.employmentType].toLowerCase();
  const terms =
    p.employmentType === "PERMANENT"
      ? "The appointment is permanent; either side may end it with one month's written notice, or one month's salary instead of notice."
      : `The appointment is on purely ${basis} basis and liable to termination with or without any notice or assigning any reason at any time.`;
  return (
    <div className="hr-doc">
      <DocHead campus={campusHeading(p.campus)} title="" />
      <div className="hr-letter-old">
        <div style={{ textAlign: "right", fontSize: "9pt" }}>Ref: {s.employeeNo}</div>
        <div className="row">
          <span className="k">Subject :-</span>
          <span style={{ textDecoration: "underline" }}>APPOINTMENT</span>
        </div>
        <div className="row" style={{ gridTemplateColumns: "26mm 30mm 1fr" }}>
          <span />
          <span>Mr/Miss/Mrs.</span>
          <span className="line">{plain}</span>
        </div>
        <div className="row">
          <span className="k">{s.relation === "w/o" ? "W/O" : "S/O, D/O"}</span>
          <span className="line">{s.guardianName}</span>
        </div>
        <div className="row">
          <span className="k">resident of</span>
          <span className="line">{[s.address, s.city].filter(Boolean).join(", ")}</span>
        </div>
        <p>
          is hereby appointed as{" "}
          <span className="blank">
            {p.designation}
            {p.department ? ` (${p.department})` : ""}
          </span>{" "}
          in this institution on {basis} basis, with effect from {formatDate(p.startDate)}.
        </p>
        <p style={{ textIndent: "40mm" }}>Salary / allowances will be paid to him / her as per pay scales enforced in Education Department according to his / her qualification.</p>
        <p style={{ paddingLeft: "10mm" }}>TERMS &amp; CONDITIONS :-</p>
        <ol>
          <li>
            <span>1.</span>
            <span>
              {terms}
              {p.employmentType === "PROBATION" && s.probationEnds ? ` The probation runs until ${formatDate(s.probationEnds)}.` : ""}
            </span>
          </li>
          <li>
            <span>2.</span>
            <span>The candidate appointed in this letter will have to join his / her duties {p.startDate > today() ? `on ${formatDate(p.startDate)}` : "immediately"}.</span>
          </li>
        </ol>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 60mm", marginTop: "8mm" }}>
          <span />
          <span style={{ fontWeight: 700, textAlign: "center" }}>
            Principal
            {principal && principal !== "Principal" && <span style={{ display: "block", fontWeight: 400, fontSize: "9pt" }}>{principal}</span>}
          </span>
        </div>
        <p style={{ paddingLeft: "14mm" }}>
          Date: <span style={{ fontSize: "10pt" }}>{formatDate(today())}</span>
        </p>
      </div>
    </div>
  );
}

/**
 * Employee profile, laid out as the old "Employee Profile" report: the boxed title, the fields in the old order (name
 * and Urdu name, date of birth and shift, CNIC and caste, reference, address, contact number, other information,
 * blood group and city, email and joining date, emergency, emergency contact, salary and working hours) with the photo
 * box at the right, then "Employee's signature" and "Admin's signature". The postings and qualifications the new
 * record keeps print after the old fields. Shift and working hours are not kept now, so they print blank.
 */
export function ProfileDoc({ s }: { s: HrStaffProfile }) {
  const p = s.postings.find((x) => x.primary) ?? s.postings[0]!;
  const field = (k: string, v: ReactNode, k2?: string, v2?: ReactNode) => (
    <>
      <span className="k">{k}</span>
      <span className="v">{v}</span>
      <span className="k k2">{k2 ?? ""}</span>
      <span className="v">{v2 ?? ""}</span>
    </>
  );
  const other = [
    `${s.relation === "w/o" ? "Husband" : "Father"}: ${s.guardianName || "—"}`,
    `${p.designation}${p.department ? `, ${p.department}` : ""}`,
    s.employeeNo,
    s.maritalStatus ? s.maritalStatus.charAt(0) + s.maritalStatus.slice(1).toLowerCase() : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="hr-doc">
      <DocHead campus={campusHeading(p.campus)} title="" />
      <span className="hr-boxtitle">Employee Profile</span>
      <div className="hr-oldform">
        {field("Name :", s.name, "", s.nameUrdu ? <Urdu size="small">{s.nameUrdu}</Urdu> : "")}
        <span className="photo" aria-hidden="true">
          Photo
        </span>
        {field("Date Of Birth :", s.dob ? formatDate(s.dob) : "", "Shift :", "")}
        {field("C.N.I.C number:", s.cnic ? <Ltr>{formatCnic(s.cnic)}</Ltr> : "", "Caste :", s.caste ?? "")}
        {field("Reference", s.reference ?? "")}
        {field("Address(Home) :", s.address)}
        {field(
          "Contact Number:",
          <Ltr>
            {s.mobile ? formatMobile(s.mobile) : ""}
            {s.mobile2 ? `, ${formatMobile(s.mobile2)}` : ""}
          </Ltr>,
        )}
        {field("Other Information :", other)}
        {field("Blood Group :", s.bloodGroup, "City :", s.city)}
        {field("Email :", s.email ? <Ltr>{s.email}</Ltr> : "", "Joining Date:", formatDate(s.joiningDate))}
        {field("Emergency :", s.emergency ? `${s.emergency.name} (${s.emergency.relation})` : "")}
        {field("Emergency Contact:", s.emergency ? <Ltr>{formatMobile(s.emergency.mobile)}</Ltr> : "")}
        {/* Salary for pay roles only: the profile carries pay only when the viewer may see it. */}
        {field("Salary :", s.pay?.basic ? formatRs(s.pay.basic).slice(3) : "", "Working Hrs :", "")}
      </div>
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
      <p className="hr-doc-small">
        Service {years(s.serviceYears)}
        {s.priorServiceYears ? ` (includes ${years(s.priorServiceYears)} earlier MTB service)` : ""}
        {s.teachingLevels.length ? ` · teaches ${s.teachingLevels.join(", ")}${s.subjects.length ? `: ${s.subjects.join(", ")}` : ""}` : ""}
      </p>
      {s.qualifications.length > 0 && (
        <>
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
        </>
      )}
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
      <div className="hr-oldsign">
        <div>
          Employee's
          <br />
          signature
        </div>
        <div>Admin's signature</div>
      </div>
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
          <PhotoBox src={photoUrl.staff(s.employeeNo, p.campus)} className="hr-card-img" fallback={initials} />
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
      {/* The old "Employee Salary Card": letterhead, boxed title, then the salary month and payment. */}
      <Letterhead campus={campusHeading(run.campus)} variant="slip" />
      <span className="hr-boxtitle" style={{ margin: "0 auto", width: "70mm" }}>
        EMPLOYEE SALARY CARD
      </span>
      <div className="hr-slip-head">
        <div>
          Salary Month : <strong style={{ display: "inline" }}>{hrMonthLabel(run.month)}</strong>
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
            <td rowSpan={2} className="hr-slip-pic">
              {/* the old "Employee Salary Card" printed the staff member's photo (Snap) */}
              <StaffPhoto employeeNo={slip.employeeNo} campus={run.campus} className="hr-slip-photo" />
            </td>
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
      <Signatures labels={["Employee's signature", "Admin's signature"]} />
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
