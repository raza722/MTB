import { admissionsPapersFor, type AdmissionsApplicant, type AdmissionsFee, type AdmissionsMeritList, type AdmissionsTest } from "@mtb/api";
import { formatCnic, formatDate, formatRs, formatSession } from "@mtb/domain";
import { Children, type ReactNode } from "react";
import { footerBoxes, Letterhead } from "../../app/print/letterhead";
import "./admissions-print.css";
import { dateOrBlank, mobileOrDash, orDash, scoreOf, sittingWhenWhere } from "./shared";

/** Printable admissions papers: application form, entrance-test slip, merit list and the test's attendance sheet. */

/** The old footer on every printed page: "Print DateTime …" bottom left, "Page No x of y" bottom right. */
export function PageFoot() {
  return <style>{`@page { ${footerBoxes()} }`}</style>;
}

/** "Rs 1,500 paid · KC-CF-2627-000401", "Rs 1,500 paid · challan 12345" (old-system payments have no receipt), "Rs 1,500 due". */
function feeLine(f: AdmissionsFee): string {
  if (f.status === "WAIVED") return `${formatRs(f.amount)} waived`;
  if (f.status !== "PAID") return `${formatRs(f.amount)} due`;
  const ref = f.receiptNo ?? (f.bankChallanNo ? `challan ${f.bankChallanNo}` : "");
  return `${formatRs(f.amount)} paid${ref ? ` · ${ref}` : ""}`;
}

/** The old letterhead (crest, "MTB-Madrasat-ul-Banat Schools and Colleges, Khalid Campus, Sadikabad", title), with the
 * document's number and date at the top right when it has them. */
function Header({ campus, campusName, title, sub, refNo, date }: { campus: string; campusName: string; title: string; sub?: ReactNode; refNo?: string; date?: string }) {
  return (
    <div className="mb-1">
      <Letterhead
        campus={campus}
        campusName={campusName}
        title={title}
        {...(sub ? { sub } : {})}
        {...(refNo || date
          ? {
              right: (
                <div className="grid justify-items-end gap-0.5 whitespace-nowrap text-[9pt]">
                  {refNo && (
                    <span>
                      No. <b className="mtb-mono">{refNo}</b>
                    </span>
                  )}
                  {date && (
                    <span>
                      Date <b className="tabular-nums">{formatDate(date)}</b>
                    </span>
                  )}
                </div>
              ),
            }
          : {})}
      />
    </div>
  );
}

function Table({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <table className="mt-4 w-full border-collapse text-[9.5pt]">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <th scope="row" className="w-[38%] border border-border px-2 py-1.5 text-left font-medium text-ink-muted">
              {k}
            </th>
            <td className="border border-border px-2 py-1.5">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ApplicationForm({ a }: { a: AdmissionsApplicant }) {
  return (
    <article className="mtb-doc mtb-doc-a4 adm-appform flex flex-col" aria-label={`Application ${a.applicationNo}`}>
      <Header campus={a.campus} campusName={a.campusName} title="Application for admission" sub={`Session ${formatSession(a.session)} · ${a.classApplied}`} refNo={a.applicationNo} date={a.appliedOn} />
      <Table
        rows={[
          ["Child's name", <span className="flex flex-wrap items-baseline justify-between gap-2 font-semibold">{a.name}{a.nameUr && <span lang="ur" dir="rtl" className="urdu-small">{a.nameUr}</span>}</span>],
          ["Date of birth", <span className="tabular-nums">{dateOrBlank(a.dob)}</span>],
          ["Gender", a.gender === "F" ? "Female" : "Male"],
          ["B-form no.", a.bForm ? <span className="mtb-mono">{formatCnic(a.bForm)}</span> : "Not given"],
          ["Father's name", orDash(a.father)],
          ["Father's CNIC", a.fatherCnic ? <span className="mtb-mono">{formatCnic(a.fatherCnic)}</span> : "Not given"],
          ...(a.mother ? ([["Mother's name", a.mother]] as Array<[string, string]>) : []),
          ["Mobile", <span className="tabular-nums">{mobileOrDash(a.mobile)}</span>],
          ...(a.email ? ([["Email", a.email]] as Array<[string, string]>) : []),
          ["Address", [a.address, a.city].filter((x) => x?.trim()).join(", ") || "—"],
          ["Previous school", a.previousSchool ?? "—"],
          ["Class applied for", <b>{`${a.classApplied}${a.stream ? ` · ${a.stream}` : ""}`}</b>],
          ["Entrance test", a.directAdmission ? "No test for this class (interview)" : a.testDate ? `${formatDate(a.testDate)}${a.testRollNo ? ` · seat ${a.testRollNo}` : ""}` : "To be booked"],
          ...(a.fee ? ([["Candidate fee", feeLine(a.fee)]] as Array<[string, string]>) : []),
        ]}
      />
      {a.siblings && a.siblings.length > 0 && <p className="mt-3 text-[9pt]">Siblings at MTB: {a.siblings.map((s) => `${s.name} (${s.grNo}, ${s.classSection})`).join(", ")}.</p>}
      <p className="mt-3 text-[9pt] text-ink-muted">I confirm the details above are correct. Admission is offered on merit and available seats; an offer must be accepted by the date written on it.</p>
      <div className="mt-3 grid gap-1 text-[9pt]">
        <span className="text-ink-muted">Principal's remarks</span>
        <span className="block h-[12mm] border border-border" />
      </div>
      <footer className="mt-auto grid grid-cols-3 gap-x-4 gap-y-8 pt-8 text-[8.5pt]">
        <div className="mtb-doc-sign" style={{ minWidth: 0 }}>
          Parent's signature
        </div>
        <div className="mtb-doc-sign" style={{ minWidth: 0 }}>
          Student's signature
        </div>
        <div className="mtb-doc-sign" style={{ minWidth: 0 }}>
          Admissions office
        </div>
        <div className="mtb-doc-sign" style={{ minWidth: 0 }}>
          Accountant
        </div>
        <div className="mtb-doc-sign" style={{ minWidth: 0 }}>
          Office superintendent
        </div>
        <div className="mtb-doc-sign" style={{ minWidth: 0 }}>
          Principal
        </div>
      </footer>
    </article>
  );
}

/** A tick box with its label, for the blank form. */
function Tick({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-[4mm] w-[6mm] border border-black" />
      {label}
    </span>
  );
}

/**
 * The application form blank, for a family to fill in by hand at the desk or at home (the old "REGISTRATION FORM" was
 * printed blank): the same boxes and signatures as the filled form, City on its own line, gender to tick and the
 * test, seat and candidate fee left for the office. A4, like the old registration form and the filled one.
 */
export function BlankApplicationForm({ campus, campusName, session }: { campus: string; campusName: string; session: number }) {
  const line = <span className="block h-[5mm]" />;
  return (
    <article className="mtb-doc mtb-doc-a4 adm-appform flex flex-col" aria-label="Blank application form">
      <Header campus={campus} campusName={campusName} title="Application for admission" sub={`Session ${formatSession(session)}`} />
      <Table
        rows={[
          ["Form no. and date (office)", line],
          ["Child's name", line],
          ["Date of birth", line],
          [
            "Gender",
            <span className="flex gap-6">
              <Tick label="Male" />
              <Tick label="Female" />
            </span>,
          ],
          ["B-form no.", line],
          ["Father's name", line],
          ["Father's CNIC", line],
          ["Mother's name", line],
          ["Mobile", line],
          ["Email", line],
          ["Address", line],
          ["City", line],
          ["Previous school", line],
          ["Class applied for", line],
          ["Entrance test (office)", line],
          ["Candidate fee (office)", line],
        ]}
      />
      <p className="mt-3 text-[9pt] text-ink-muted">I confirm the details above are correct. Admission is offered on merit and available seats; an offer must be accepted by the date written on it.</p>
      <div className="mt-3 grid gap-1 text-[9pt]">
        <span className="text-ink-muted">Principal's remarks</span>
        <span className="block h-[12mm] border border-border" />
      </div>
      <footer className="mt-auto grid grid-cols-3 gap-x-4 gap-y-8 pt-8 text-[8.5pt]">
        {["Parent's signature", "Student's signature", "Admissions office", "Accountant", "Office superintendent", "Principal"].map((l) => (
          <div key={l} className="mtb-doc-sign" style={{ minWidth: 0 }}>
            {l}
          </div>
        ))}
      </footer>
    </article>
  );
}

/** Whole years between the date of birth and the test (the old slip's Age); blank without a date of birth. */
function ageOn(dob: string | null | undefined, on: string): string {
  if (!dob) return "";
  const [y1, m1, d1] = dob.slice(0, 10).split("-").map(Number);
  const [y2, m2, d2] = on.slice(0, 10).split("-").map(Number);
  if (!y1 || !y2) return "";
  const years = y2 - y1 - ((m2 ?? 0) < (m1 ?? 0) || ((m2 ?? 0) === (m1 ?? 0) && (d2 ?? 0) < (d1 ?? 0)) ? 1 : 0);
  return years >= 0 ? String(years) : "";
}

/**
 * One admission test slip, as the old AdmissionTestSlip report printed it: a ruled box with the crest and heading,
 * "Admission Test Slip", "Admission Test For Class: Nine", one row of Date, Name, Father Name, Age, Previous School and
 * Mobile, and "Office Suptt.Sign:" with a line. The seat number (new) is at the top right; the sitting's time and venue
 * (new) are on the signature row's empty left side. Put slips in a TestSlipSheet: four to an A4 page.
 */
export function TestSlip({ a, test }: { a: AdmissionsApplicant; test?: AdmissionsTest | undefined }) {
  const date = test?.date ?? a.testDate ?? "";
  const when = [test?.time, test?.venue].filter((x) => x?.trim()).join(" · ");
  return (
    <section className="adm-tslip" aria-label={`Test slip ${a.name}`}>
      <Letterhead
        campus={a.campus}
        campusName={a.campusName}
        variant="slip"
        title="Admission Test Slip"
        sub={`Admission Test For Class: ${a.classApplied}`}
        right={
          // the application number too, so a slip is matched to its application (test run F-026)
          <span className="adm-tslip-seat">
            {a.testRollNo && (
              <>
                Seat No.
                <br />
                <b className="text-[11pt]">{a.testRollNo}</b>
                <br />
              </>
            )}
            <span className="tabular-nums">{a.applicationNo}</span>
          </span>
        }
      />
      <table>
        <colgroup>
          <col style={{ width: "12.5%" }} />
          <col style={{ width: "24%" }} />
          <col style={{ width: "19.5%" }} />
          <col style={{ width: "5%" }} />
          <col style={{ width: "24%" }} />
          <col style={{ width: "15%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>Date</th>
            <th>Name</th>
            <th>Father Name</th>
            <th>Age</th>
            <th>Previous School</th>
            <th>Mobile</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="tabular-nums">{date ? formatDate(date) : ""}</td>
            <td>{a.name}</td>
            <td>{a.father}</td>
            <td className="tabular-nums">{ageOn(a.dob, date || new Date().toISOString())}</td>
            <td>{a.previousSchool ?? ""}</td>
            <td className="tabular-nums">{a.mobile ?? ""}</td>
          </tr>
        </tbody>
      </table>
      <div className="adm-tslip-foot">
        <span className="adm-tslip-when">{when ? `Test: ${when}` : ""}</span>
        <span>Office Suptt.Sign:</span>
        <span className="adm-tslip-line" />
      </div>
    </section>
  );
}

/** Test slips four to an A4 page, a dotted cut line under each, with the old page footer. Print it on A4 portrait. */
export function TestSlipSheet({ children }: { children: ReactNode }) {
  const slips = Children.toArray(children);
  const pages: ReactNode[][] = [];
  for (let i = 0; i < slips.length; i += 4) pages.push(slips.slice(i, i + 4));
  return (
    <>
      <PageFoot />
      {pages.map((p, i) => (
        <div key={i} className="adm-tslip-page">
          {p.map((s, j) => (
            <div key={j}>
              {s}
              <hr className="adm-tslip-cut" />
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

/** "86.7" — a candidate's score as a share of their own papers. */
export const meritPercent = (a: AdmissionsApplicant) => (a.testScore === null || !a.testMax ? null : Math.round((a.testScore / a.testMax) * 1000) / 10);

/** "Selected", "Waiting list" or "Not selected", by rank against the seats (the waiting band is as many again). */
export const meritRemark = (rank: number, seats: number) => (rank <= seats ? "Selected" : rank <= seats * 2 ? "Waiting list" : "Not selected");

/** "15.0", as the old list printed marks; blank when there is none. */
const mark1 = (v: number | null | undefined) => (v === undefined || v === null ? "" : v.toFixed(1));

/**
 * The merit list as the old "PRE-ENTRANCE TEST MERIT LIST" printed it: heading, "Class : Nine   Merit List : Ist Merit
 * List", then Sr.#, Name, a column per paper, Total ("74.0/150"), %Age ("49.33 %") and Remarks. The seat number (new) is
 * a narrow column after Sr.#; the group (new) is under the name; Remarks says Selected, Waiting list, Offered or Admitted.
 */
export function MeritListPrint({ m, campus, campusName, title }: { m: AdmissionsMeritList; campus: string; campusName: string; title?: string }) {
  const papers = m.subjects;
  const seatCol = m.rows.some((r) => r.applicant.testRollNo);
  return (
    <article className="adm-merit" aria-label={`Merit list ${m.classApplied}`}>
      <PageFoot />
      <Letterhead campus={campus} campusName={campusName} title="PRE-ENTRANCE TEST MERIT LIST" />
      <div className="adm-merit-meta">
        <span>
          <span>Class :</span>
          <span>{m.classApplied}</span>
        </span>
        <span>
          <span>Merit List :</span>
          <span>{title ?? ""}</span>
        </span>
      </div>
      <table>
        <thead>
          <tr>
            <th style={{ width: "6mm" }}>Sr.#</th>
            {seatCol && <th style={{ width: "12mm" }}>Seat No.</th>}
            <th>Name</th>
            {papers.map((p) => (
              <th key={p.subject}>{p.subject}</th>
            ))}
            <th style={{ width: "18mm" }}>Total</th>
            <th style={{ width: "15mm" }}>%Age</th>
            <th style={{ width: "22mm" }}>Remarks</th>
          </tr>
        </thead>
        <tbody>
          {m.rows.map((r) => {
            const a = r.applicant;
            const max = a.testMax ?? papers.reduce((x, p) => x + p.max, 0);
            const pct = a.testScore !== null && a.testMax ? (a.testScore / a.testMax) * 100 : 0;
            return (
              <tr key={a.id}>
                <td>{r.rank}</td>
                {seatCol && <td>{a.testRollNo ?? ""}</td>}
                <td className="l">
                  {a.name}
                  {a.stream && <small>{a.stream}</small>}
                </td>
                {papers.map((p) => (
                  <td key={p.subject}>{mark1(a.marks?.[p.subject])}</td>
                ))}
                <td>{a.testScore !== null ? `${a.testScore.toFixed(1)}/${max}` : `0/${max}`}</td>
                <td>{pct.toFixed(2)} %</td>
                <td>{a.stage === "OFFERED" || a.stage === "ADMITTED" ? (a.stage === "ADMITTED" ? "Admitted" : "Offered") : meritRemark(r.rank, m.seats)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </article>
  );
}

/** "Class 4 entrance test · Test 3 · Girls only · 15-Jan-2026": the sitting line under a print's title. */
const sittingLine = (test: AdmissionsTest, group?: string) => `${test.name}${group ? ` · ${group} only` : ""} · ${sittingWhenWhere(test)}`;

/**
 * The marks sheet of one sitting: per-paper marks, total, percentage and absentees, with the sitting's remarks.
 * `group` ("Boys" or "Girls") is printed under the title when the sheet is for one of them.
 */
export function MarksSheetPrint({ test, rows, campusName, group }: { test: AdmissionsTest; rows: AdmissionsApplicant[]; campusName: string; group?: string }) {
  const appeared = rows.filter((a) => !a.absentFromTest && a.testScore !== null).length;
  const absent = rows.filter((a) => a.absentFromTest).length;
  return (
    <article className="mtb-doc mtb-doc-a4 flex flex-col" aria-label={`Marks sheet ${test.name}`}>
      <PageFoot />
      <Header campus={test.campus} campusName={campusName} title="Entrance test result" sub={sittingLine(test, group)} />
      <table className="mt-5 w-full border-collapse text-[9pt]">
        <thead>
          <tr>
            {["Seat no.", "Name", "Father's name", ...test.subjects.map((s) => `${s.subject} (${s.max})${s.stream ? ` · ${s.stream}` : ""}`), "Total", "%"].map((h) => (
              <th key={h} className="border border-border bg-surface-sunken px-1.5 py-1 text-left">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const mine = admissionsPapersFor(test.subjects, a.stream);
            return (
              <tr key={a.id}>
                <td className="border border-border px-1.5 py-1 mtb-mono">{a.testRollNo ?? "—"}</td>
                <td className="border border-border px-1.5 py-1 font-medium">{a.name}</td>
                <td className="border border-border px-1.5 py-1">{orDash(a.father)}</td>
                {test.subjects.map((s) => (
                  <td key={s.subject} className="border border-border px-1.5 py-1 tabular-nums">
                    {a.absentFromTest ? "Absent" : !mine.includes(s) ? "·" : (a.marks?.[s.subject] ?? "—")}
                  </td>
                ))}
                <td className="border border-border px-1.5 py-1 tabular-nums">{a.absentFromTest ? "—" : scoreOf(a)}</td>
                <td className="border border-border px-1.5 py-1 tabular-nums">{meritPercent(a)?.toFixed(1) ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 text-[9pt]">
        Candidates {rows.length} · appeared {appeared} · absent {absent}
        {test.remarks ? ` · Remarks: ${test.remarks}` : ""}
      </p>
      <footer className="mt-auto flex items-end justify-between gap-6 pt-12">
        <div className="mtb-doc-sign">Examiner</div>
        <div className="mtb-doc-sign">Principal</div>
      </footer>
    </article>
  );
}

/** The legacy "New Admission List": students admitted in a period, with the total. */
export function AdmittedListPrint({ rows, campus, campusName, scope }: { rows: AdmissionsApplicant[]; campus: string; campusName: string; scope: string }) {
  return (
    <article className="mtb-doc mtb-doc-a4l flex flex-col" style={{ minHeight: "180mm" }} aria-label="New admission list">
      <PageFoot />
      <Header campus={campus} campusName={campusName} title="New admission list" sub={`${scope} · total students ${rows.length}`} />
      <table className="mt-5 w-full border-collapse text-[8.5pt]">
        <thead>
          <tr>
            {["#", "G.R. no.", "Student", "Father's name", "Gender", "Class", "Group", "Admitted", "Previous school", "Mobile", "Test"].map((h) => (
              <th key={h} className="border border-border bg-surface-sunken px-1.5 py-1 text-left">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((a, i) => (
            <tr key={a.id}>
              <td className="border border-border px-1.5 py-1 tabular-nums">{i + 1}</td>
              <td className="border border-border px-1.5 py-1 mtb-mono">{a.grNo ?? "—"}</td>
              <td className="border border-border px-1.5 py-1 font-medium">{a.name}</td>
              <td className="border border-border px-1.5 py-1">{orDash(a.father)}</td>
              <td className="border border-border px-1.5 py-1">{a.gender === "F" ? "Girl" : "Boy"}</td>
              <td className="border border-border px-1.5 py-1">{a.admittedClassSection ?? a.classApplied}</td>
              <td className="border border-border px-1.5 py-1">{a.stream ?? "—"}</td>
              <td className="border border-border px-1.5 py-1 tabular-nums">{a.admittedOn ? formatDate(a.admittedOn) : "—"}</td>
              <td className="border border-border px-1.5 py-1">{a.previousSchool ?? "—"}</td>
              <td className="border border-border px-1.5 py-1 tabular-nums">{mobileOrDash(a.mobile)}</td>
              <td className="border border-border px-1.5 py-1 tabular-nums">{a.testScore !== null && a.testMax ? scoreOf(a, "/") : "Interview"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[9pt] font-semibold">Total students: {rows.length}</p>
      <footer className="mt-auto flex items-end justify-between gap-6 pt-12">
        <div className="mtb-doc-sign">Admissions office</div>
        <div className="mtb-doc-sign">Principal</div>
      </footer>
    </article>
  );
}

/**
 * One candidate's entrance-test result, the marks sheet a family takes home (user request, 20-Nov-2026): the same
 * heading as the sitting's marks sheet, the candidate's details, then only the papers they sat, each with its total
 * and the marks obtained, the total and the percentage. A paper not marked yet prints "—"; an absent candidate prints
 * "Absent". It shows the saved marks. A5 portrait.
 */
export function ResultSlip({ a, test }: { a: AdmissionsApplicant; test: AdmissionsTest }) {
  const papers = admissionsPapersFor(test.subjects, a.stream);
  const max = a.testMax ?? papers.reduce((x, s) => x + s.max, 0);
  const pct = meritPercent(a);
  const cell = "border border-border px-2 py-1.5";
  return (
    <article className="mtb-doc mtb-doc-a5 flex flex-col" aria-label={`Test result ${a.name}`}>
      <PageFoot />
      <Header campus={a.campus} campusName={a.campusName} title="Entrance test result" sub={`Admission test for class: ${a.classApplied}`} refNo={a.applicationNo} date={test.date} />
      <Table
        rows={[
          ["Name", <span className="flex flex-wrap items-baseline justify-between gap-2 font-semibold">{a.name}{a.nameUr && <span lang="ur" dir="rtl" className="urdu-small">{a.nameUr}</span>}</span>],
          ["Father's name", orDash(a.father)],
          ["Seat no.", <span className="mtb-mono">{a.testRollNo ?? "—"}</span>],
          ["Class applied for", `${a.classApplied}${a.stream ? ` · ${a.stream}` : ""}`],
          ["Test", sittingWhenWhere(test)],
        ]}
      />
      <table className="mt-4 w-full border-collapse text-[9.5pt]">
        <thead>
          <tr>
            <th className={`${cell} bg-surface-sunken text-left`}>Paper</th>
            <th className={`${cell} w-[26mm] bg-surface-sunken text-right`}>Total marks</th>
            <th className={`${cell} w-[30mm] bg-surface-sunken text-right`}>Marks obtained</th>
          </tr>
        </thead>
        <tbody>
          {papers.map((s) => (
            <tr key={s.subject}>
              <td className={cell}>
                {s.subject}
                {s.stream && <span className="text-ink-muted"> · {s.stream}</span>}
              </td>
              <td className={`${cell} text-right tabular-nums`}>{s.max}</td>
              <td className={`${cell} text-right tabular-nums`}>{a.absentFromTest ? "Absent" : (a.marks?.[s.subject] ?? "—")}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className={`${cell} text-left`}>
              Total
            </th>
            <td className={`${cell} text-right font-semibold tabular-nums`}>{max}</td>
            <td className={`${cell} text-right font-semibold tabular-nums`}>{a.absentFromTest ? "Absent" : (a.testScore ?? "—")}</td>
          </tr>
          <tr>
            <th scope="row" className={`${cell} text-left`}>
              Percentage
            </th>
            <td colSpan={2} className={`${cell} text-right font-semibold tabular-nums`}>
              {a.absentFromTest || pct === null ? "—" : `${pct.toFixed(1)}%`}
            </td>
          </tr>
        </tfoot>
      </table>
      {!a.absentFromTest && a.testScore === null && <p className="mt-2 text-[8.5pt] text-ink-muted">Not every paper is marked yet: the total shows once all are.</p>}
      <div className="mt-4 grid gap-1 text-[9pt]">
        <span className="text-ink-muted">Remarks</span>
        <span className="block h-[12mm] border border-border" />
      </div>
      <footer className="mt-auto flex items-end justify-between gap-6 pt-10">
        <div className="mtb-doc-sign">Examiner</div>
        <div className="mtb-doc-sign">Principal</div>
      </footer>
    </article>
  );
}

export function AttendanceSheet({ test, rows, campusName, group }: { test: AdmissionsTest; rows: AdmissionsApplicant[]; campusName: string; group?: string }) {
  return (
    <article className="mtb-doc mtb-doc-a4 flex flex-col" aria-label={`Attendance sheet ${test.name}`}>
      <PageFoot />
      <Header campus={test.campus} campusName={campusName} title="Entrance test attendance sheet" sub={sittingLine(test, group)} />
      <table className="mt-5 w-full border-collapse text-[10pt]">
        <thead>
          <tr>
            {["Seat no.", "Name", "Father's name", "Fee", "Signature"].map((h) => (
              <th key={h} className="border border-border bg-surface-sunken px-2 py-1.5 text-left">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td className="border border-border px-2 py-2 mtb-mono">{a.testRollNo ?? "—"}</td>
              <td className="border border-border px-2 py-2 font-medium">{a.name}</td>
              <td className="border border-border px-2 py-2">{orDash(a.father)}</td>
              <td className="border border-border px-2 py-2">{!a.fee ? "—" : a.fee.status === "DUE" ? "Due" : a.fee.status === "WAIVED" ? "Waived" : "Paid"}</td>
              <td className="w-[38mm] border border-border px-2 py-2" />
            </tr>
          ))}
        </tbody>
      </table>
      <footer className="mt-auto flex items-end justify-between gap-6 pt-12">
        <div className="mtb-doc-sign">Invigilator</div>
        <div className="mtb-doc-sign">Admissions office</div>
      </footer>
    </article>
  );
}
