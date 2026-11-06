import { admissionsPapersFor, metaQueries, type AdmissionsApplicant, type AdmissionsFee, type AdmissionsMeritList, type AdmissionsTest } from "@mtb/api";
import { formatCnic, formatDate, formatRs, formatSession } from "@mtb/domain";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { dateOrBlank, mobileOrDash, orDash, scoreOf, sittingWhen, sittingWhenWhere } from "./shared";

/** Printable admissions papers: application form, entrance-test slip, merit list and the test's attendance sheet. */

/** The campus address from Setup › Campuses (as on module 1's letterheads), else the campus name only. */
function useCampusAddress(campus: string, campusName: string): string {
  const campuses = useQuery(metaQueries.campuses());
  return campuses.data?.find((c) => c.code === campus)?.address.trim() || campusName;
}

/** "Rs 1,500 paid · KC-CF-2627-000401", "Rs 1,500 paid · challan 12345" (old-system payments have no receipt), "Rs 1,500 due". */
function feeLine(f: AdmissionsFee): string {
  if (f.status === "WAIVED") return `${formatRs(f.amount)} waived`;
  if (f.status !== "PAID") return `${formatRs(f.amount)} due`;
  const ref = f.receiptNo ?? (f.bankChallanNo ? `challan ${f.bankChallanNo}` : "");
  return `${formatRs(f.amount)} paid${ref ? ` · ${ref}` : ""}`;
}

function Header({ campus, campusName, title, sub, refNo, date }: { campus: string; campusName: string; title: string; sub?: ReactNode; refNo?: string; date?: string }) {
  const address = useCampusAddress(campus, campusName);
  return (
    <>
      <header className="flex items-center gap-4 border-b-2 border-brand pb-3">
        <span className="mtb-doc-seal">MTB</span>
        <div className="grid min-w-0 flex-1 leading-tight">
          <span className="text-[14pt] font-bold text-brand-ink">MTB Schools and Colleges</span>
          <span className="font-semibold">{campusName}</span>
          {address !== campusName && <span className="text-[9pt] text-ink-muted">{address}</span>}
        </div>
        {(refNo || date) && (
          <div className="grid justify-items-end gap-0.5 text-[9pt]">
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
        )}
      </header>
      <div className="mt-4 grid justify-items-center gap-1 text-center">
        <h1 className="m-0 text-[15pt] font-bold uppercase tracking-wide">{title}</h1>
        {sub && <p className="m-0 text-[9.5pt] text-ink-muted">{sub}</p>}
      </div>
    </>
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
    <article className="mtb-doc mtb-doc-a5 flex flex-col" aria-label={`Application ${a.applicationNo}`}>
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

export function TestSlip({ a, test }: { a: AdmissionsApplicant; test?: AdmissionsTest | undefined }) {
  return (
    <article className="mtb-doc mtb-doc-a5 flex flex-col" aria-label={`Test slip ${a.name}`}>
      <Header campus={a.campus} campusName={a.campusName} title="Entrance test slip" sub={test?.name ?? `${a.classApplied} entrance test`} refNo={a.testRollNo ?? "—"} />
      <div className="mt-4 flex items-start gap-4">
        <span className="grid h-[30mm] w-[24mm] shrink-0 place-content-center rounded border border-dashed border-border-strong text-center text-[8pt] text-ink-muted">Paste photo</span>
        <Table
          rows={[
            ["Seat no.", <b className="mtb-mono text-[12pt]">{a.testRollNo ?? "—"}</b>],
            ["Name", <b>{a.name}</b>],
            ["Father's name", orDash(a.father)],
            ["Class", a.classApplied],
            ["Date and time", test ? sittingWhen(test) : a.testDate ? formatDate(a.testDate) : "—"],
            ["Venue", test?.venue || a.campusName],
          ]}
        />
      </div>
      {test && (
        <table className="mt-3 w-full border-collapse text-[9pt]">
          <thead>
            <tr>
              {["Paper", "Marks", "Time"].map((h) => (
                <th key={h} className="border border-border bg-surface-sunken px-2 py-1 text-left">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {admissionsPapersFor(test.subjects, a.stream).map((s) => (
              <tr key={s.subject}>
                <td className="border border-border px-2 py-1">{s.subject}</td>
                <td className="border border-border px-2 py-1 tabular-nums">{s.max}</td>
                <td className="border border-border px-2 py-1 tabular-nums">{s.durationMins ? `${s.durationMins} min` : "—"}</td>
              </tr>
            ))}
            <tr>
              <td className="border border-border px-2 py-1 font-semibold">Total{a.stream ? ` (${a.stream})` : ""}</td>
              <td className="border border-border px-2 py-1 font-semibold tabular-nums">{admissionsPapersFor(test.subjects, a.stream).reduce((x, s) => x + s.max, 0)}</td>
              <td className="border border-border px-2 py-1 tabular-nums">
                {admissionsPapersFor(test.subjects, a.stream).every((s) => s.durationMins) ? `${admissionsPapersFor(test.subjects, a.stream).reduce((x, s) => x + (s.durationMins ?? 0), 0)} min` : ""}
              </td>
            </tr>
          </tbody>
        </table>
      )}
      <ul className="mt-2 grid list-disc gap-0.5 pl-5 text-[9pt] text-ink-muted">
        <li>Bring this slip and a pencil, eraser and ruler. Arrive 20 minutes early.</li>
        <li>Parents wait outside the examination hall.</li>
        <li>The merit list is displayed within a week and an SMS is sent to the registered mobile.</li>
      </ul>
      <footer className="mt-auto flex items-end justify-between gap-6 pt-8">
        <div className="mtb-doc-sign">Candidate fee: {a.fee?.receiptNo ?? (a.fee?.bankChallanNo ? `challan ${a.fee.bankChallanNo}` : "—")}</div>
        <div className="mtb-doc-sign">Admissions office</div>
      </footer>
    </article>
  );
}

/** "86.7" — a candidate's score as a share of their own papers. */
export const meritPercent = (a: AdmissionsApplicant) => (a.testScore === null || !a.testMax ? null : Math.round((a.testScore / a.testMax) * 1000) / 10);

/** "Selected", "Waiting list" or "Not selected", by rank against the seats (the waiting band is as many again). */
export const meritRemark = (rank: number, seats: number) => (rank <= seats ? "Selected" : rank <= seats * 2 ? "Waiting list" : "Not selected");

export function MeritListPrint({ m, campus, campusName, title }: { m: AdmissionsMeritList; campus: string; campusName: string; title?: string }) {
  const papers = m.subjects;
  return (
    <article className="mtb-doc mtb-doc-a4 flex flex-col" aria-label={`Merit list ${m.classApplied}`}>
      <Header campus={campus} campusName={campusName} title={`${title ?? "Merit list"} · ${m.classApplied}`} sub={`${m.testName}${m.testDate ? ` · ${formatDate(m.testDate)}` : ""} · ${m.seats} seats · appeared ${m.counts.appeared}, absent ${m.counts.absent}`} />
      <table className="mt-5 w-full border-collapse text-[9pt]">
        <thead>
          <tr>
            {["Rank", "Seat no.", "Name", "Father's name", ...papers.map((p) => `${p.subject} (${p.max})`), "Total", "%", "Remarks"].map((h) => (
              <th key={h} className="border border-border bg-surface-sunken px-1.5 py-1 text-left">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {m.rows.map((r) => (
            <tr key={r.applicant.id} style={r.rank === m.seats ? { borderBottom: "2px solid var(--ink)" } : undefined}>
              <td className="border border-border px-1.5 py-1 tabular-nums">{r.rank}</td>
              <td className="border border-border px-1.5 py-1 mtb-mono">{r.applicant.testRollNo ?? "—"}</td>
              <td className="border border-border px-1.5 py-1 font-medium">
                {r.applicant.name}
                {r.applicant.stream && <span className="block text-[7.5pt] font-normal text-ink-muted">{r.applicant.stream}</span>}
              </td>
              <td className="border border-border px-1.5 py-1">{orDash(r.applicant.father)}</td>
              {papers.map((p) => {
                const v = r.applicant.marks?.[p.subject];
                return (
                  <td key={p.subject} className="border border-border px-1.5 py-1 tabular-nums">
                    {v === undefined || v === null ? "—" : v}
                  </td>
                );
              })}
              <td className="border border-border px-1.5 py-1 tabular-nums">{scoreOf(r.applicant)}</td>
              <td className="border border-border px-1.5 py-1 tabular-nums">{meritPercent(r.applicant)?.toFixed(1) ?? "—"}</td>
              <td className="border border-border px-1.5 py-1">{r.applicant.stage === "OFFERED" || r.applicant.stage === "ADMITTED" ? (r.applicant.stage === "ADMITTED" ? "Admitted" : "Offered") : meritRemark(r.rank, m.seats)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[9pt] text-ink-muted">Ranked by percentage of total marks; ties go to the older applicant, then the earlier application. Selected candidates must complete admission by the date given in their offer.</p>
      <footer className="mt-auto flex items-end justify-between gap-6 pt-12">
        <div className="mtb-doc-sign">Admissions office</div>
        <div className="mtb-doc-sign">Principal</div>
      </footer>
    </article>
  );
}

/** The marks sheet of one sitting: per-paper marks, total, percentage and absentees, with the sitting's remarks. */
export function MarksSheetPrint({ test, rows, campusName }: { test: AdmissionsTest; rows: AdmissionsApplicant[]; campusName: string }) {
  const appeared = rows.filter((a) => !a.absentFromTest && a.testScore !== null).length;
  const absent = rows.filter((a) => a.absentFromTest).length;
  return (
    <article className="mtb-doc mtb-doc-a4 flex flex-col" aria-label={`Marks sheet ${test.name}`}>
      <Header campus={test.campus} campusName={campusName} title="Entrance test result" sub={`${test.name} · ${sittingWhenWhere(test)}`} />
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

export function AttendanceSheet({ test, rows, campusName }: { test: AdmissionsTest; rows: AdmissionsApplicant[]; campusName: string }) {
  return (
    <article className="mtb-doc mtb-doc-a4 flex flex-col" aria-label={`Attendance sheet ${test.name}`}>
      <Header campus={test.campus} campusName={campusName} title="Entrance test attendance sheet" sub={`${test.name} · ${sittingWhenWhere(test)}`} />
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
