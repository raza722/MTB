import { STUDENT_DOC_LABEL, type StudentDocDetails, type StudentDocSnapshot, type StudentDocType, type StudentFamilyDetail, type StudentMovement } from "@mtb/api";
import { formatCnic, formatDate, formatMobile, formatRs, formatSession, type IsoDate } from "@mtb/domain";
import { Fragment, type ReactNode } from "react";
import { classShortOf, sectionOf } from "../shared";

/** What every document needs to render: the frozen snapshot plus issue details. */
export interface DocInput {
  type: StudentDocType;
  serialNo: string;
  issuedOn: IsoDate;
  issuedBy?: string;
  details: StudentDocDetails;
  snapshot: StudentDocSnapshot;
  /** 1 = original; 2+ = reprint copy number. */
  copy?: number;
  cancelled?: boolean;
}

const pron = (s: StudentDocSnapshot) =>
  s.gender === "F" ? { he: "She", his: "her", him: "her", title: "Ms" } : { he: "He", his: "his", him: "him", title: "Mr" };

/** The principal's name from the snapshot (spec 01_students C6), else the post and campus. */
const principalOf = (s: StudentDocSnapshot) => s.principalName ?? `Principal, ${s.campusName}`;

/** Date of birth as printed: many migrated records have none (C1), and a blank line is left to fill in by hand. */
const dobOf = (s: StudentDocSnapshot, empty = "") => (s.dob ? formatDate(s.dob) : empty);

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

function Marks({ d }: { d: DocInput }) {
  return (
    <>
      {d.cancelled && <span className="mtb-doc-mark">CANCELLED</span>}
      {(d.copy ?? 1) > 1 && <span className="mtb-doc-copy">Copy {d.copy} · reprint</span>}
    </>
  );
}

function Letterhead({ s, serialNo, issuedOn, title, sub }: { s: StudentDocSnapshot; serialNo: string; issuedOn: IsoDate; title: string; sub?: ReactNode }) {
  return (
    <>
      <header className="flex items-center gap-4 border-b-2 border-brand pb-3">
        <span className="mtb-doc-seal">MTB</span>
        <div className="grid min-w-0 flex-1 leading-tight">
          <span className="text-[15pt] font-bold text-brand-ink">MTB Schools and Colleges</span>
          <span className="font-semibold">{s.campusName}</span>
          <span className="text-[9pt] text-ink-muted">{s.campusAddress}</span>
          {(s.campusPhone || s.campusEmail) && (
            <span className="text-[9pt] text-ink-muted">
              {[s.campusPhone ? `Phone ${s.campusPhone}` : "", s.campusEmail ? `Email ${s.campusEmail}` : ""].filter(Boolean).join(" · ")}
            </span>
          )}
        </div>
        <div className="grid justify-items-end gap-0.5 text-[9pt]">
          <span>
            Ref. no. <b className="mtb-mono">{serialNo}</b>
          </span>
          <span>
            Date <b className="tabular-nums">{formatDate(issuedOn)}</b>
          </span>
        </div>
      </header>
      <div className="mt-5 grid justify-items-center gap-1 text-center">
        <h1 className="m-0 text-[17pt] font-bold uppercase tracking-wide">{title}</h1>
        {sub && <p className="m-0 text-[10pt] text-ink-muted">{sub}</p>}
      </div>
    </>
  );
}

function Row({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2 flex items-end gap-2" : "flex items-end gap-2"}>
      <span className="shrink-0 text-ink-muted">{label}</span>
      <span className="mtb-doc-line flex-1 text-left">{children}</span>
    </div>
  );
}

function Signatures({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <footer className="mt-auto flex items-end justify-between gap-6 pt-14">
      <div className="mtb-doc-sign">{left}</div>
      <div className="mtb-doc-sign">{right}</div>
    </footer>
  );
}

/* ---------------------------------------------------------------- ID card (CR80) */

export function IdCard({ d }: { d: DocInput }) {
  const s = d.snapshot;
  return (
    <article className="mtb-idcard" aria-label={`ID card ${s.name}`}>
      {d.cancelled && <span className="mtb-doc-mark" style={{ fontSize: "20pt" }}>CANCELLED</span>}
      <div className="mtb-idcard-head">
        <span className="mtb-doc-seal" style={{ width: "7mm", height: "7mm", fontSize: "6pt", background: "var(--on-brand)", color: "var(--brand-ink)" }}>
          MTB
        </span>
        <span className="grid leading-tight">
          <b style={{ fontSize: "8pt" }}>MTB · {s.campusName}</b>
          <span style={{ fontSize: "6.4pt", opacity: 0.9 }}>Student identity card · {formatSession(s.session)}</span>
        </span>
      </div>
      <div className="mtb-idcard-body">
        <span className="mtb-idcard-photo" aria-hidden="true">
          {initialsOf(s.name)}
        </span>
        <div className="grid content-start gap-0.5">
          <span className="flex items-baseline justify-between gap-1">
            <b style={{ fontSize: "9pt" }}>{s.name}</b>
            {s.nameUr && (
              <span lang="ur" dir="rtl" className="urdu-small" style={{ fontSize: "8pt" }}>
                {s.nameUr}
              </span>
            )}
          </span>
          <dl>
            <dt>G.R. no.</dt>
            <dd className="mtb-mono">{s.grNo}</dd>
            <dt>Class</dt>
            <dd>
              {s.classSection} · Roll {s.rollNo || "—"}
              {s.stream ? ` · ${s.stream}` : ""}
            </dd>
            <dt>{s.relation}</dt>
            <dd>{s.father}</dd>
            <dt>Born</dt>
            <dd className="tabular-nums">
              {dobOf(s, "—")}
              {s.bloodGroup ? ` · Blood ${s.bloodGroup}` : ""}
            </dd>
            <dt>Issued</dt>
            <dd className="tabular-nums">{formatDate(d.issuedOn)}</dd>
            {s.address && (
              <>
                <dt>Address</dt>
                <dd style={{ fontWeight: 500, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.address}</dd>
              </>
            )}
          </dl>
        </div>
      </div>
      <div className="mtb-idcard-foot">
        <span>
          Valid until <b className="tabular-nums">{d.details.validUntil ? formatDate(d.details.validUntil) : "—"}</b>
        </span>
        <span className="tabular-nums">Emergency {formatMobile(s.guardianMobile)}</span>
        <span className="mtb-mono">{d.serialNo}</span>
      </div>
    </article>
  );
}

/** The back of an ID card: card no., dates, where to return it, the school seal and the holder's signature. */
export function IdCardBack({ d }: { d: DocInput }) {
  const s = d.snapshot;
  return (
    <article className="mtb-idcard mtb-idcard-back" aria-label={`ID card back ${s.name}`}>
      {d.cancelled && <span className="mtb-doc-mark" style={{ fontSize: "20pt" }}>CANCELLED</span>}
      <div className="mtb-idcard-back-body">
        <div className="grid content-start gap-1">
          <dl>
            <dt>Card no.</dt>
            <dd className="mtb-mono">{d.serialNo}</dd>
            <dt>G.R. no.</dt>
            <dd className="mtb-mono">{s.grNo}</dd>
            <dt>Issued</dt>
            <dd className="tabular-nums">{formatDate(d.issuedOn)}</dd>
            <dt>Valid until</dt>
            <dd className="tabular-nums">{d.details.validUntil ? formatDate(d.details.validUntil) : "—"}</dd>
          </dl>
          <p className="m-0" style={{ fontSize: "6.2pt", lineHeight: 1.3 }}>
            This card belongs to MTB {s.campusName}. If found, please return it to the school office: {s.campusAddress}
            {s.campusPhone ? ` · ${s.campusPhone}` : ""}.
          </p>
        </div>
        <span className="mtb-idcard-seal" aria-label="Space for the school seal">
          School seal
        </span>
      </div>
      <div className="mtb-idcard-signs">
        <span className="mtb-idcard-sign">Signature of holder</span>
        <span className="mtb-idcard-sign">Principal</span>
      </div>
    </article>
  );
}

/**
 * Ten cards to an A4 sheet; later cards go on the next sheet. With `backs`, each sheet of fronts is followed by a
 * sheet of backs in mirrored order (left and right swapped in each row), so a two-sided print lines up.
 */
export function IdCardSheets({ cards, backs = false }: { cards: DocInput[]; backs?: boolean }) {
  const pages: DocInput[][] = [];
  for (let i = 0; i < cards.length; i += 10) pages.push(cards.slice(i, i + 10));
  const total = pages.length * (backs ? 2 : 1);
  return (
    <>
      {pages.map((p, i) => {
        const mirrored: Array<DocInput | null> = [];
        for (let r = 0; r < p.length; r += 2) mirrored.push(p[r + 1] ?? null, p[r]!);
        return (
          <Fragment key={i}>
            <section className="mtb-idsheet" aria-label={`Sheet ${i * (backs ? 2 : 1) + 1} of ${total}${backs ? ", fronts" : ""}`}>
              {p.map((c) => (
                <IdCard key={c.serialNo + c.snapshot.grNo} d={c} />
              ))}
            </section>
            {backs && (
              <section className="mtb-idsheet" aria-label={`Sheet ${i * 2 + 2} of ${total}, backs (mirrored for two-sided printing)`}>
                {mirrored.map((c, k) => (c ? <IdCardBack key={`b-${c.serialNo}${c.snapshot.grNo}`} d={c} /> : <span key={`blank-${k}`} className="mtb-idcard-blank" aria-hidden="true" />))}
              </section>
            )}
          </Fragment>
        );
      })}
    </>
  );
}

/* ---------------------------------------------------------------- Admission slip (A5) */

export function AdmissionSlip({ d }: { d: DocInput }) {
  const s = d.snapshot;
  return (
    <article className="mtb-doc mtb-doc-a5 flex flex-col" aria-label={`Admission slip ${s.name}`}>
      <Marks d={d} />
      <Letterhead s={s} serialNo={d.serialNo} issuedOn={d.issuedOn} title="Admission slip" sub={`New admission · Session ${formatSession(s.session)}`} />
      <table className="mt-5 w-full border-collapse text-[10pt]">
        <tbody>
          {(
            [
              ["G.R. no.", <span className="mtb-mono font-semibold">{s.grNo}</span>],
              [
                "Name",
                <span className="flex flex-wrap items-baseline justify-between gap-2 font-semibold">
                  {s.name}
                  {s.nameUr && (
                    <span lang="ur" dir="rtl" className="urdu-small">
                      {s.nameUr}
                    </span>
                  )}
                </span>,
              ],
              ["Father's name", s.father],
              ["Class", s.className],
              ["Section allotted", <b>{s.classSection}</b>],
              ["Roll no.", <span className="tabular-nums">{s.rollNo || "—"}</span>],
              ["Date of admission", <span className="tabular-nums">{formatDate(s.admissionDate)}</span>],
              ["Guardian mobile", <span className="tabular-nums">{formatMobile(s.guardianMobile)}</span>],
            ] as Array<[string, ReactNode]>
          ).map(([k, v]) => (
            <tr key={k}>
              <th scope="row" className="w-[38%] border border-border px-2 py-1.5 text-left font-medium text-ink-muted">
                {k}
              </th>
              <td className="border border-border px-2 py-1.5">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[9pt] text-ink-muted">Please bring this slip to the class in-charge on the first day. Fees are paid at the fee counter against the student's G.R. number.</p>
      <footer className="mt-auto grid grid-cols-3 gap-3 pt-10">
        <div className="mtb-doc-sign" style={{ minWidth: 0 }}>
          Vice Principal
        </div>
        <div className="mtb-doc-sign" style={{ minWidth: 0 }}>
          Class in-charge
        </div>
        <div className="mtb-doc-sign" style={{ minWidth: 0 }}>
          Office superintendent
        </div>
      </footer>
    </article>
  );
}

/* ---------------------------------------------------------------- School leaving certificate (A4) */

export function LeavingCertificate({ d }: { d: DocInput }) {
  const s = d.snapshot;
  return (
    <article className="mtb-doc mtb-doc-a4 mtb-doc-frame flex flex-col" aria-label={`Leaving certificate ${s.name}`}>
      <Marks d={d} />
      <Letterhead s={s} serialNo={d.serialNo} issuedOn={d.issuedOn} title="School leaving certificate" sub={`Session ${formatSession(s.session)}`} />
      <div className="mt-8 grid grid-cols-2 gap-x-8 gap-y-4">
        <Row label="Student's name" wide>
          {s.name}
        </Row>
        <Row label="G.R. no.">
          <span className="mtb-mono">{s.grNo}</span>
        </Row>
        <Row label="Father's name">{s.father}</Row>
        <Row label="Date of birth (in figures)">{dobOf(s)}</Row>
        <Row label="Gender">{s.gender === "F" ? "Female" : "Male"}</Row>
        <Row label="(in words)" wide>
          {s.dobInWords}
        </Row>
        <Row label="Class at admission">{s.admittedInClass}</Row>
        <Row label="Class at leaving">{s.className}</Row>
        <Row label="Category" wide>
          {s.readmitted ? "Re-admission" : "Fresh"}
        </Row>
        <Row label="Date of admission">{formatDate(s.admissionDate)}</Row>
        <Row label="Date of leaving">{formatDate(s.leftOn ?? d.issuedOn)}</Row>
        <Row label="School dues cleared up to" wide>
          {s.duesClearedUpTo}
        </Row>
        <Row label="Reason for leaving" wide>
          {d.details.leavingReason ?? "—"}
        </Row>
        <Row label="Character and conduct">{d.details.character ?? "Good"}</Row>
        <Row label="Session">{formatSession(s.session)}</Row>
        <Row label="Remarks" wide>
          {d.details.remarks || "—"}
        </Row>
      </div>
      <p className="mt-8 text-[10pt] text-ink-muted">
        Certified that the above particulars are correct according to the school's General Register. This certificate is issued once; any further copy is marked as a reprint.
      </p>
      <Signatures
        left={
          <>
            Prepared by
            <br />
            <b className="text-ink">{d.issuedBy ?? "Office"}</b>
          </>
        }
        right={
          <>
            Principal (signature and stamp)
            <br />
            <b className="text-ink">{principalOf(s)}</b>
          </>
        }
      />
    </article>
  );
}

/* ---------------------------------------------------------------- Character certificate (A4) */

export function CharacterCertificate({ d }: { d: DocInput }) {
  const s = d.snapshot;
  const p = pron(s);
  const still = !s.leftOn;
  return (
    <article className="mtb-doc mtb-doc-a4 mtb-doc-frame flex flex-col" aria-label={`Character certificate ${s.name}`}>
      <Marks d={d} />
      <Letterhead s={s} serialNo={d.serialNo} issuedOn={d.issuedOn} title="Character certificate" sub={`Session ${formatSession(s.session)}`} />
      <div className="mt-10 grid gap-5 text-justify text-[12pt] leading-[2]">
        <p className="m-0">
          This is to certify that <span className="mtb-doc-line">{s.name}</span> {s.relation} <span className="mtb-doc-line">{s.father}</span>, G.R. no. <span className="mtb-mono">{s.grNo}</span>, {still ? "is" : "has been"} a bonafide student of this
          school from <b>{formatDate(s.admissionDate)}</b> {still ? <>and is at present studying in <b>{s.classSection}</b></> : <>to <b>{formatDate(s.leftOn!)}</b>, having last studied in <b>{s.className}</b></>}.
        </p>
        {d.details.boardExam && (
          <p className="m-0">
            {p.he} appeared in the <b>{d.details.boardExam}</b>
            {d.details.boardRollNo ? (
              <>
                , roll no. <span className="mtb-doc-line">{d.details.boardRollNo}</span>
              </>
            ) : null}
            {d.details.boardMarks ? (
              <>
                , securing <span className="mtb-doc-line">{d.details.boardMarks}</span> marks
              </>
            ) : null}
            .
          </p>
        )}
        {s.dob && (
          <p className="m-0">
            {p.his.charAt(0).toUpperCase() + p.his.slice(1)} date of birth, according to the school's General Register, is <b>{formatDate(s.dob)}</b> ({s.dobInWords}).
          </p>
        )}
        <p className="m-0">
          {p.he} bears a <b>{(d.details.character ?? "good").toLowerCase()}</b> moral character and {p.his} conduct in the school has been commendable. I wish {p.him} success in {p.his} future studies and career.
        </p>
        {d.details.remarks && <p className="m-0 text-ink-muted">{d.details.remarks}</p>}
      </div>
      <Signatures
        left={
          <>
            Dated
            <br />
            <b className="tabular-nums text-ink">{formatDate(d.issuedOn)}</b>
          </>
        }
        right={
          <>
            Principal
            <br />
            <b className="text-ink">{principalOf(s)}</b>
          </>
        }
      />
    </article>
  );
}

/* ---------------------------------------------------------------- Appreciation letter (A4) */

export function AppreciationLetter({ d }: { d: DocInput }) {
  const s = d.snapshot;
  const p = pron(s);
  const present = d.details.attendanceDays ?? 0;
  const total = d.details.totalDays ?? 0;
  const pct = total ? Math.round((present / total) * 1000) / 10 : 0;
  return (
    <article className="mtb-doc mtb-doc-a4 flex flex-col" aria-label={`Appreciation letter ${s.name}`}>
      <Marks d={d} />
      <Letterhead s={s} serialNo={d.serialNo} issuedOn={d.issuedOn} title="Appreciation letter" />
      <div className="mt-12 grid gap-6 text-justify text-[12pt] leading-[2]">
        <p className="m-0">
          This is to certify that <b>{s.name}</b> {s.relation} <b>{s.father}</b> of <b>{s.classSection}</b> remained the most regular student of {p.his} class during the session <b>{formatSession(s.session)}</b> with{" "}
          <b className="tabular-nums">{pct}%</b> attendance, i.e. <b className="tabular-nums">{present}</b> of <b className="tabular-nums">{total}</b> school days.
        </p>
        <p className="m-0">
          {p.he} has been issued this letter of appreciation as a token of acknowledgement for {p.his} commitment, hard work and regularity.
        </p>
        {d.details.remarks && <p className="m-0">{d.details.remarks}</p>}
        <p className="m-0">I pray for {p.his} success in {p.his} future career.</p>
      </div>
      <Signatures
        left={
          <>
            Prepared by
            <br />
            <b className="text-ink">{d.issuedBy ?? "Office superintendent"}</b>
          </>
        }
        right={
          <>
            Principal
            <br />
            <b className="text-ink">{principalOf(s)}</b>
          </>
        }
      />
    </article>
  );
}

/* ---------------------------------------------------------------- Date of birth certificate (A4) */

export function BirthCertificate({ d }: { d: DocInput }) {
  const s = d.snapshot;
  const p = pron(s);
  return (
    <article className="mtb-doc mtb-doc-a4 mtb-doc-frame flex flex-col" aria-label={`Date of birth certificate ${s.name}`}>
      <Marks d={d} />
      <Letterhead s={s} serialNo={d.serialNo} issuedOn={d.issuedOn} title="Date of birth certificate" sub="From the school's General Register" />
      <div className="mt-10 grid gap-5 text-justify text-[12pt] leading-[2]">
        <p className="m-0">
          This is to certify that <span className="mtb-doc-line">{s.name}</span> {s.relation} <span className="mtb-doc-line">{s.father}</span>, G.R. no. <span className="mtb-mono">{s.grNo}</span>, {s.leftOn ? "was" : "is"} a student of this school
          {s.leftOn ? "" : <>, at present in <b>{s.classSection}</b></>}.
        </p>
        <p className="m-0">
          According to the school's General Register, {p.his} date of birth is {s.dob ? <><b className="tabular-nums">{formatDate(s.dob)}</b> (in words: <b>{s.dobInWords}</b>)</> : <b>not recorded</b>}, as recorded on admission on <b className="tabular-nums">{formatDate(s.admissionDate)}</b> in {s.admittedInClass}.
        </p>
        <p className="m-0">This certificate is issued on the request of the parent{d.details.remarks ? ` for ${d.details.remarks}` : ""}.</p>
      </div>
      <Signatures
        left={
          <>
            Prepared by
            <br />
            <b className="text-ink">{d.issuedBy ?? "Office"}</b>
          </>
        }
        right={
          <>
            Principal
            <br />
            <b className="text-ink">{principalOf(s)}</b>
          </>
        }
      />
    </article>
  );
}

export function DocumentView({ d, backs = false }: { d: DocInput; backs?: boolean }) {
  switch (d.type) {
    case "ID_CARD":
      return <IdCardSheets cards={[d]} backs={backs} />;
    case "ADMISSION_SLIP":
      return <AdmissionSlip d={d} />;
    case "LEAVING_CERT":
      return <LeavingCertificate d={d} />;
    case "CHARACTER_CERT":
      return <CharacterCertificate d={d} />;
    case "DOB_CERT":
      return <BirthCertificate d={d} />;
    case "APPRECIATION_LETTER":
      return <AppreciationLetter d={d} />;
    // Board documents are handed over, not printed by the school.
    case "ROLL_NO_SLIP":
    case "RESULT_CARD":
    case "BOARD_CERTIFICATE":
      return null;
  }
}

export const docPaper = (type: StudentDocType) => (type === "ID_CARD" ? "ID_SHEET" : type === "ADMISSION_SLIP" ? "A5" : "A4") as "A4" | "A5" | "ID_SHEET";

export const docTitle = (type: StudentDocType) => STUDENT_DOC_LABEL[type];

/* ---------------------------------------------------------------- Family sibling sheet (A4) */

/** The family's children with their class and this session's fee after concessions (legacy sibling sheet). */
export function FamilySheet({ f, session, printedOn }: { f: StudentFamilyDetail; session: number; printedOn: IsoDate }) {
  const kids = f.children.filter((c) => c.status === "ACTIVE");
  const campuses = new Set(kids.map((c) => c.campusName));
  const total = kids.reduce((a, c) => a + c.sessionFee.net, 0);
  const off = kids.reduce((a, c) => a + c.sessionFee.concession, 0);
  return (
    <article className="mtb-doc mtb-doc-a4 flex flex-col" aria-label={`Family sheet ${f.fatherName}`}>
      <header className="flex items-center gap-4 border-b-2 border-brand pb-3">
        <span className="mtb-doc-seal">MTB</span>
        <div className="grid min-w-0 flex-1 leading-tight">
          <span className="text-[15pt] font-bold text-brand-ink">MTB Schools and Colleges</span>
          <span className="font-semibold">{[...campuses].join(" · ") || "—"}</span>
        </div>
        <div className="grid justify-items-end gap-0.5 text-[9pt]">
          <span>
            Family <b className="mtb-mono">{f.id}</b>
          </span>
          <span>
            Date <b className="tabular-nums">{formatDate(printedOn)}</b>
          </span>
        </div>
      </header>
      <h1 className="m-0 mt-5 text-center text-[16pt] font-bold uppercase tracking-wide">Family sheet · session {formatSession(session)}</h1>
      <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-2 text-[11pt]">
        <Row label="Father's name">{f.fatherName}</Row>
        <Row label="Father's CNIC">{f.fatherCnic ? formatCnic(f.fatherCnic) : "—"}</Row>
        <Row label="Number of children">{kids.length}</Row>
        <Row label="Address">{f.address}</Row>
      </div>
      <table className="mtb-collect mt-6" style={{ fontSize: "10.5pt" }}>
        <thead>
          <tr>
            <th style={{ width: "8mm" }}>Sr</th>
            <th style={{ width: "26mm" }}>G.R. no.</th>
            <th>Student</th>
            <th style={{ width: "18mm" }}>Class</th>
            <th style={{ width: "16mm" }}>Section</th>
            {campuses.size > 1 && <th style={{ width: "30mm" }}>Campus</th>}
            <th style={{ width: "34mm" }}>Session fee (Rs)</th>
          </tr>
        </thead>
        <tbody>
          {kids.map((c, i) => {
            const cls = classShortOf(c.classSection);
            const sec = sectionOf(c.classSection);
            return (
              <tr key={c.grNo}>
                <td className="mid">{i + 1}</td>
                <td className="mtb-mono">{c.grNo}</td>
                <td>{c.name}</td>
                <td className="mid">{cls}</td>
                <td className="mid">{sec}</td>
                {campuses.size > 1 && <td>{c.campusName}</td>}
                <td className="num">
                  {formatRs(c.sessionFee.net)}
                  {c.sessionFee.concession > 0 && <span className="block text-[8pt] text-ink-muted">after {formatRs(c.sessionFee.concession)} concession</span>}
                </td>
              </tr>
            );
          })}
          <tr>
            <td colSpan={campuses.size > 1 ? 6 : 5} className="num font-semibold">
              Total for the family
            </td>
            <td className="num font-semibold">{formatRs(total)}</td>
          </tr>
        </tbody>
      </table>
      <p className="m-0 mt-3 text-[9pt] text-ink-muted">
        Session fee: the class's fees for the session from the fee structure{off > 0 ? `, less concessions of ${formatRs(off)}` : ""}. Transport and one-off charges are not included.
      </p>
      <Signatures
        left={
          <>
            Prepared by
            <br />
            <b className="text-ink">Accounts office</b>
          </>
        }
        right={
          <>
            Checked by
            <br />
            <b className="text-ink">Principal</b>
          </>
        }
      />
    </article>
  );
}

/* ---------------------------------------------------------------- Notice to parents (A5): struck off or expelled */

/** Letterhead of a notice or statement: the campus address, phone and email from Setup (none printed when missing). */
function noticeHead(m: StudentMovement): StudentDocSnapshot {
  const lh = m.letterhead;
  return {
    campusName: m.campusName,
    campusAddress: lh?.address ?? m.campusName,
    ...(lh?.phone ? { campusPhone: lh.phone } : {}),
    ...(lh?.email ? { campusEmail: lh.email } : {}),
  } as StudentDocSnapshot;
}

export function StatusNotice({ m, mobile }: { m: StudentMovement; mobile?: string }) {
  const struck = m.kind === "STRUCK_OFF";
  const snap = noticeHead(m);
  return (
    <article className="mtb-doc mtb-doc-a5 flex flex-col" aria-label={`Notice ${m.name}`}>
      <Letterhead s={snap} serialNo={m.id.toUpperCase().slice(0, 14)} issuedOn={m.date} title={struck ? "Notice: struck off the rolls" : "Notice of expulsion"} />
      <div className="mt-6 grid gap-3 text-[10.5pt] leading-[1.8]">
        <p className="m-0">
          Dear <b>{m.father}</b>
          {mobile ? <span className="text-ink-muted"> ({formatMobile(mobile)})</span> : null},
        </p>
        <p className="m-0">
          This is to inform you that <b>{m.name}</b> ({m.classSection}, G.R. no. <span className="mtb-mono">{m.grNo}</span>) has been {struck ? "struck off the school rolls" : "expelled from the school"} with effect from{" "}
          <b className="tabular-nums">{formatDate(m.date)}</b>.
        </p>
        <p className="m-0">
          Reason: <b>{m.reason}</b>
          {m.remarks ? `. ${m.remarks}` : ""}
        </p>
        {m.balanceAtTime > 0 && (
          <p className="m-0">
            Dues outstanding on that date: <b className="tabular-nums">{formatRs(m.balanceAtTime)}</b>.
          </p>
        )}
        {struck && <p className="m-0">To restore the admission, please meet the principal within seven days. The seat is held until then.</p>}
      </div>
      <footer className="mt-auto grid grid-cols-3 items-end gap-3 pt-12">
        <div className="mtb-doc-sign" style={{ minWidth: 0 }}>
          Office superintendent
        </div>
        <div className="mtb-doc-sign" style={{ minWidth: 0 }}>
          Accountant / Vice Principal
        </div>
        <div className="mtb-doc-sign" style={{ minWidth: 0 }}>
          Principal
          {m.approvedBy ? (
            <>
              <br />
              <b className="text-ink">{m.approvedBy}</b>
            </>
          ) : null}
        </div>
      </footer>
      <p className="m-0 mt-4 text-[8.5pt] leading-snug text-ink-muted">
        <b className="text-ink">Copy to:</b> School office · Accounts branch · Exam branch · Head teacher · Notice board · Vice Principal · Student's parents
      </p>
    </article>
  );
}

/* ---------------------------------------------------------------- Re-admission statement (A4): restored to the rolls */

export function ReadmissionStatement({ m, previous }: { m: StudentMovement; previous?: { on: IsoDate; reason: string } }) {
  const snap = noticeHead(m);
  const sign = (role: string) => (
    <div className="grid gap-3" style={{ minWidth: 0 }}>
      <div className="mtb-doc-sign" style={{ minWidth: 0 }}>
        {role}
      </div>
      <div className="flex items-end gap-2 text-[9.5pt]">
        <span className="text-ink-muted">Date</span>
        <span className="mtb-doc-line flex-1" />
      </div>
    </div>
  );
  return (
    <article className="mtb-doc flex flex-col" aria-label={`Re-admission statement ${m.name}`}>
      <Letterhead s={snap} serialNo={m.id.toUpperCase().slice(0, 14)} issuedOn={m.date} title="Admission / re-admission statement" />
      <div className="mt-6 grid gap-4 text-[10.5pt] leading-[1.8]">
        <p className="m-0">
          This is to notify that the following student has been re-admitted to the school rolls with effect from <b className="tabular-nums">{formatDate(m.date)}</b>, for the reasons stated below.
        </p>
        <table className="w-full border-collapse text-[10pt]">
          <tbody>
            <tr>
              <th className="border border-border-strong bg-surface-sunken px-2 py-1 text-left font-semibold">Student's name</th>
              <td className="border border-border-strong px-2 py-1">{m.name}</td>
              <th className="border border-border-strong bg-surface-sunken px-2 py-1 text-left font-semibold">G.R. no.</th>
              <td className="border border-border-strong px-2 py-1 mtb-mono">{m.grNo}</td>
            </tr>
            <tr>
              <th className="border border-border-strong bg-surface-sunken px-2 py-1 text-left font-semibold">Father's name</th>
              <td className="border border-border-strong px-2 py-1">{m.father}</td>
              <th className="border border-border-strong bg-surface-sunken px-2 py-1 text-left font-semibold">Class and section</th>
              <td className="border border-border-strong px-2 py-1">{m.classSection}</td>
            </tr>
          </tbody>
        </table>
        <div className="grid gap-1">
          <b>Reasons</b>
          <p className="m-0">
            {m.reason}
            {m.remarks ? `. ${m.remarks}` : ""}
            {previous ? ` (struck off on ${formatDate(previous.on)}: ${previous.reason.toLowerCase()})` : ""}
          </p>
        </div>
      </div>
      <footer className="mt-12 grid grid-cols-3 items-end gap-6">
        {sign("Class in-charge")}
        {sign("Vice Principal")}
        {sign("Office superintendent / Accountant")}
      </footer>
      <p className="m-0 mt-8 text-[8.5pt] leading-snug text-ink-muted">
        <b className="text-ink">Copy to:</b> School office · Accounts branch · Exam branch · Head teacher · Notice board · Vice Principal · Student's parents
      </p>
    </article>
  );
}

/* ---------------------------------------------------------------- Board-document collection sheet (A4 landscape) */

export interface CollectionSheetInput {
  campusName: string;
  session: number;
  className: string;
  section?: string;
  stream?: string;
  gender?: "F" | "M";
  rows: Array<{ grNo: string; name: string; classSection: string; rollPartI?: string; rollPartII?: string; handed: { slipI?: IsoDate; slipII?: IsoDate; resultCard?: IsoDate; certificate?: IsoDate } }>;
}

/**
 * "Roll No. slip / result card / certificate issuance form": one line per student with the board roll numbers,
 * and a signature and date box for each document. Signature boxes stay empty; a date already in the register is
 * filled in. The heading is part of the table head, so it repeats on every printed page.
 */
export function CollectionSheet({ sheet, printedAt, classLabel }: { sheet: CollectionSheetInput; printedAt: string; /** The class's name from Setup, e.g. "Class 9" or "First Year". */ classLabel?: string }) {
  const cls = classLabel ?? sheet.className;
  const date = (d?: IsoDate) => (d ? formatDate(d) : "");
  return (
    <article className="mtb-doc mtb-doc-a4l" aria-label={`Collection sheet ${cls}`}>
      <table className="mtb-collect">
        <colgroup>
          <col style={{ width: "8mm" }} />
          <col />
          {["roll", "sig", "date", "roll", "sig", "date", "sig", "date", "sig", "date"].map((k, i) => (
            <col key={i} style={{ width: k === "sig" ? "20mm" : "18mm" }} />
          ))}
        </colgroup>
        <thead>
          <tr className="mtb-collect-head">
            <th colSpan={12}>
              <div className="grid justify-items-center gap-0.5 text-center">
                <span className="text-[13pt] font-bold text-brand-ink">MTB Schools and Colleges, {sheet.campusName}</span>
                <span className="text-[11pt] font-semibold">Roll No. slip / result card / certificate issuance form</span>
              </div>
              <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-[9.5pt]">
                <span>
                  Class: <span className="mtb-collect-field">{cls}{sheet.section ? `-${sheet.section}` : ""}</span>
                </span>
                <span>
                  Group: <span className="mtb-collect-field">{sheet.stream ?? "All groups"}</span>
                </span>
                <span>
                  Gender: <span className="mtb-collect-field">{sheet.gender === "F" ? "Female" : sheet.gender === "M" ? "Male" : "All"}</span>
                </span>
                <span>
                  Session: <span className="mtb-collect-field">{formatSession(sheet.session)}</span>
                </span>
              </div>
            </th>
          </tr>
          <tr>
            <th rowSpan={2}>Sr.#</th>
            <th rowSpan={2}>Student name (G.R. no.)</th>
            <th rowSpan={2}>Roll No. Part-I</th>
            <th colSpan={2}>Slip</th>
            <th rowSpan={2}>Roll No. Part-II</th>
            <th colSpan={2}>Slip</th>
            <th colSpan={2}>Result card</th>
            <th colSpan={2}>Certificate</th>
          </tr>
          <tr>
            <th>Signature</th>
            <th>Date</th>
            <th>Signature</th>
            <th>Date</th>
            <th>Signature</th>
            <th>Date</th>
            <th>Signature</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {sheet.rows.map((r, i) => (
            <tr key={r.grNo}>
              <td className="num">{i + 1}</td>
              <td>
                {r.name} <span className="mtb-mono text-[8pt] text-ink-muted">({r.grNo}{sheet.section ? "" : ` · ${r.classSection}`})</span>
              </td>
              <td className="mid mtb-mono">{r.rollPartI ?? ""}</td>
              <td />
              <td className="mid">{date(r.handed.slipI)}</td>
              <td className="mid mtb-mono">{r.rollPartII ?? ""}</td>
              <td />
              <td className="mid">{date(r.handed.slipII)}</td>
              <td />
              <td className="mid">{date(r.handed.resultCard)}</td>
              <td />
              <td className="mid">{date(r.handed.certificate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mtb-doc-screen-only m-0 mt-3 flex justify-between text-[8pt] text-ink-muted">
        <span>Printed {printedAt}</span>
        <span>Page numbers are added when printed</span>
      </p>
    </article>
  );
}

/* ---------------------------------------------------------------- Postal address labels (8 to an A4 sheet) */

export interface AddressLabelInput {
  grNo: string;
  name: string;
  father: string;
  className: string;
  section: string;
  address: string;
  mobile: string;
  campusName: string;
}

export function AddressLabel({ l }: { l: AddressLabelInput }) {
  return (
    <article className="mtb-addr-label" aria-label={`Address label ${l.name}`}>
      <dl>
        <dt>Student</dt>
        <dd>
          {l.name} – <span className="mtb-mono">{l.grNo}</span>
        </dd>
        <dt>Father</dt>
        <dd>{l.father}</dd>
        <dt>Class</dt>
        <dd>{l.className}</dd>
        <dt>Section</dt>
        <dd>{l.section}</dd>
        <dt>Address</dt>
        <dd>{l.address || " "}</dd>
        <dt>Contact</dt>
        <dd className="tabular-nums">{l.mobile ? formatMobile(l.mobile) : " "}</dd>
      </dl>
      <span className="mtb-addr-label-from">From: MTB Schools and Colleges, {l.campusName}</span>
    </article>
  );
}

/** Eight labels to an A4 sheet; more go on the next sheet. Dashed lines show where to cut. */
export function AddressLabelSheets({ labels }: { labels: AddressLabelInput[] }) {
  const pages: AddressLabelInput[][] = [];
  for (let i = 0; i < labels.length; i += 8) pages.push(labels.slice(i, i + 8));
  return (
    <>
      {pages.map((p, i) => (
        <section key={i} className="mtb-labelsheet" aria-label={`Label sheet ${i + 1} of ${pages.length}`}>
          {p.map((l) => (
            <AddressLabel key={l.grNo} l={l} />
          ))}
        </section>
      ))}
    </>
  );
}

/* ---------------------------------------------------------------- Admission form: the full student record (A4) */

function FormSection({ letter, title, children }: { letter?: string; title: string; children: ReactNode }) {
  return (
    <section className="mt-3 break-inside-avoid">
      <h2 className="m-0 mb-1.5 bg-surface-sunken px-2 py-1 text-[10pt] font-bold uppercase tracking-wide">
        {letter ? `Section ${letter} · ` : ""}
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Two columns of "Label: value" lines; an empty value prints a line to write on. */
function FieldGrid({ rows }: { rows: Array<[string, ReactNode] | null> }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[9.5pt]">
      {rows
        .filter((r): r is [string, ReactNode] => r !== null)
        .map(([k, v]) => (
          <div key={k} className="flex items-end gap-2">
            <span className="shrink-0 text-ink-muted">{k}</span>
            <span className="min-h-[5mm] flex-1 border-b border-dotted border-ink-subtle px-1 font-semibold">{v}</span>
          </div>
        ))}
    </div>
  );
}

const yesNo = (v: boolean | undefined) => (v === undefined ? "" : v ? "Yes" : "No");

/**
 * The legacy "Admission Form" / "Student Registration Print": one A4 page per student with the whole record —
 * personal, academic, family and guardian, emergency contact, siblings at MTB and other information — and the
 * guardian's signature. Prints for one student (profile) or a whole section (Documents).
 */
export function StudentRecordForm({ s, printedOn }: { s: StudentDocSnapshot; printedOn: IsoDate }) {
  const r = s.record;
  return (
    <article className="mtb-doc mtb-doc-a4 flex flex-col" style={{ fontSize: "10pt" }} aria-label={`Admission form ${s.name}`}>
      <header className="flex items-center gap-4 border-b-2 border-brand pb-3">
        <span className="mtb-doc-seal">MTB</span>
        <div className="grid min-w-0 flex-1 leading-tight">
          <span className="text-[15pt] font-bold text-brand-ink">MTB Schools and Colleges</span>
          <span className="font-semibold">{s.campusName}</span>
          <span className="text-[9pt] text-ink-muted">{s.campusAddress}</span>
        </div>
        <span className="grid h-[32mm] w-[26mm] shrink-0 place-content-center rounded border border-dashed border-border-strong text-center text-[8pt] text-ink-muted">Photo</span>
      </header>
      <div className="mt-3 flex items-end justify-between gap-4">
        <h1 className="m-0 text-[15pt] font-bold uppercase tracking-wide">Admission form</h1>
        <span className="text-[9.5pt]">
          G.R. no. <b className="mtb-mono">{s.grNo}</b> · Session {formatSession(s.session)}
        </span>
      </div>
      <FormSection title="Personal information">
        <FieldGrid
          rows={[
            ["Name", <span className="flex flex-wrap items-baseline justify-between gap-2">{s.name}{s.nameUr && <span lang="ur" dir="rtl" className="urdu-small">{s.nameUr}</span>}</span>],
            ["Gender", s.gender === "F" ? "Female" : "Male"],
            ["Date of birth", <span className="tabular-nums">{dobOf(s)}</span>],
            ["Religion", r?.religion ?? ""],
            ["Date of birth in words", s.dobInWords],
            ["B-form no.", r?.bForm ? <span className="mtb-mono">{formatCnic(r.bForm)}</span> : ""],
            ["Birth certificate no.", r?.birthCertificateNo ?? ""],
            ["Blood group", s.bloodGroup ?? ""],
            ["Disability", r?.disability ?? "None"],
            ["Mark of identification", r?.identificationMark ?? ""],
            ["Mobile", <span className="tabular-nums">{formatMobile(s.guardianMobile)}</span>],
            ["Home phone", r?.homePhone ?? ""],
            ["Email", r?.email ?? ""],
            ["City", r?.city ?? ""],
          ]}
        />
        <div className="mt-1.5 grid gap-1.5 text-[9.5pt]">
          <div className="flex items-end gap-2">
            <span className="shrink-0 text-ink-muted">Permanent address</span>
            <span className="min-h-[5mm] flex-1 border-b border-dotted border-ink-subtle px-1 font-semibold">{s.address}</span>
          </div>
          <div className="flex items-end gap-2">
            <span className="shrink-0 text-ink-muted">Temporary address</span>
            <span className="min-h-[5mm] flex-1 border-b border-dotted border-ink-subtle px-1 font-semibold">{r?.tempAddress ?? ""}</span>
          </div>
        </div>
      </FormSection>
      <FormSection title="Academic information">
        <FieldGrid
          rows={[
            ["Previous school", r?.previousSchool ?? ""],
            ["Admitted in", s.admittedInClass],
            ["Present class and section", s.classSection],
            ["Roll no.", <span className="tabular-nums">{s.rollNo || "—"}</span>],
            ["Group", s.stream ?? "—"],
            ["House", r?.house ?? ""],
          ]}
        />
      </FormSection>
      <FormSection title="Family and guardian">
        <FieldGrid
          rows={[
            ["Father's name", s.father],
            ["Father's CNIC", r?.fatherCnic ? <span className="mtb-mono">{formatCnic(r.fatherCnic)}</span> : ""],
            ["Father's occupation", r?.fatherOccupation ?? ""],
            ["Father's qualification", r?.fatherQualification ?? ""],
            ["Mother's name", r?.mother ?? ""],
            ["Mother's occupation", r?.motherOccupation ?? ""],
            ["Mother's qualification", r?.motherQualification ?? ""],
            null,
            ["Guardian", r?.guardian.name ?? s.father],
            ["Relation", r?.guardian.relation ?? ""],
            ["Guardian's CNIC", r?.guardian.cnic ? <span className="mtb-mono">{formatCnic(r.guardian.cnic)}</span> : ""],
            ["Guardian's occupation", r?.guardian.occupation ?? ""],
          ]}
        />
      </FormSection>
      <FormSection title="Emergency contact">
        <FieldGrid rows={[["Name", r?.emergencyContact?.name ?? ""], ["Mobile 1", r?.emergencyContact ? formatMobile(r.emergencyContact.mobile1) : ""], ["Mobile 2", r?.emergencyContact?.mobile2 ? formatMobile(r.emergencyContact.mobile2) : ""]]} />
      </FormSection>
      <FormSection title="Brothers and sisters at MTB">
        <table className="w-full border-collapse text-[9pt]">
          <thead>
            <tr>
              {["Name", "Relation", "G.R. no.", "Class and section", "Campus"].map((h) => (
                <th key={h} className="border border-border bg-surface-sunken px-2 py-1 text-left">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(r?.siblings.length ? r.siblings : [null]).map((x, i) => (
              <tr key={x?.grNo ?? i}>
                <td className="border border-border px-2 py-1">{x?.name ?? "None at MTB"}</td>
                <td className="border border-border px-2 py-1">{x?.relation ?? ""}</td>
                <td className="mtb-mono border border-border px-2 py-1">{x?.grNo ?? ""}</td>
                <td className="border border-border px-2 py-1">{x?.classSection ?? ""}</td>
                <td className="border border-border px-2 py-1">{x?.campusName ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </FormSection>
      <FormSection title="Other information">
        <FieldGrid rows={[["Admission date", <span className="tabular-nums">{formatDate(s.admissionDate)}</span>], ["Hostel", yesNo(r?.hostel) || "No"], ["Admission reference", r?.admissionReference ?? ""], ["Guardian mobile", <span className="tabular-nums">{formatMobile(s.guardianMobile)}</span>]]} />
      </FormSection>
      <footer className="mt-auto grid grid-cols-3 items-end gap-6 pt-10 text-[9pt]">
        <div className="mtb-doc-sign" style={{ minWidth: 0 }}>
          Guardian's signature
        </div>
        <div className="mtb-doc-sign" style={{ minWidth: 0 }}>
          Filled by
        </div>
        <div className="text-right text-ink-muted">Printed {formatDate(printedOn)}</div>
      </footer>
    </article>
  );
}

/** A blank line to write on, with its label. */
function Blank({ label, wide }: { label: string; wide?: boolean }) {
  return (
    <div className={`flex items-end gap-2 ${wide ? "col-span-2" : ""}`}>
      <span className="shrink-0 text-ink-muted">{label}</span>
      <span className="min-h-[6mm] flex-1 border-b border-ink-subtle" />
    </div>
  );
}

/** Yes / No tick boxes. */
function Tick({ label, options = ["Yes", "No"] }: { label: string; options?: string[] }) {
  return (
    <div className="flex items-end gap-3">
      <span className="shrink-0 text-ink-muted">{label}</span>
      {options.map((o) => (
        <span key={o} className="inline-flex items-center gap-1">
          <span className="inline-block h-[4mm] w-[4mm] border border-ink" /> {o}
        </span>
      ))}
    </div>
  );
}

const ATTACHMENTS = ["Birth certificate", "Declaration (birth certificate)", "Emergency information form", "Permission to use photographs", "Emergency medical procedure", "Vaccination record", "NADRA B-form", "Previous result card"];

function BlankHead({ campusName, page }: { campusName: string; page: number }) {
  return (
    <>
      <header className="flex items-center gap-4 border-b-2 border-brand pb-3">
        <span className="mtb-doc-seal">MTB</span>
        <div className="grid min-w-0 flex-1 leading-tight">
          <span className="text-[16pt] font-bold text-brand-ink">MTB Schools and Colleges</span>
          <span className="font-semibold">{campusName}</span>
        </div>
        <div className="grid justify-items-end gap-1 text-[9pt]">
          <span>
            Form no. <span className="inline-block w-[28mm] border-b border-ink-subtle" />
          </span>
          <span>
            Date <span className="inline-block w-[28mm] border-b border-ink-subtle" />
          </span>
          {page === 1 && (
            <span>
              G.R. no. <span className="inline-block w-[28mm] border-b border-ink-subtle" />
            </span>
          )}
        </div>
      </header>
      <h1 className="m-0 mt-3 text-center text-[15pt] font-bold uppercase tracking-wide">Admission form · page {page} of 2</h1>
    </>
  );
}

/**
 * The legacy blank admission form, two A4 pages, for families to fill in by hand: student, guardian, emergency
 * contact, additional information, siblings, the attachments checklist and the previous academic record.
 */
export function BlankAdmissionForm({ campusName, session }: { campusName: string; session: number }) {
  return (
    <>
      <article className="mtb-doc mtb-doc-a4 flex flex-col" style={{ fontSize: "10pt" }} aria-label="Blank admission form, page 1">
        <BlankHead campusName={campusName} page={1} />
        <p className="m-0 mt-1 text-center text-[9pt] text-ink-muted">Session {formatSession(session)} · write in capital letters</p>
        <FormSection letter="A" title="Student">
          <div className="flex gap-4">
            <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2.5 text-[9.5pt]">
              <Blank label="Student's name" wide />
              <Blank label="Date of birth" />
              <Tick label="Gender" options={["Male", "Female"]} />
              <Blank label="Date of birth in words" wide />
              <Blank label="B-form no." />
              <Blank label="Religion" />
              <Blank label="Birth certificate no." />
              <Blank label="City" />
              <Tick label="Disability" />
              <Blank label="If yes, which" />
              <Blank label="Mark of identification" wide />
              <Blank label="Mobile" />
              <Blank label="Email" />
              <Blank label="Home phone" />
              <Blank label="Blood group" />
              <Blank label="Previous school" />
              <Blank label="Admission in class" />
              <Blank label="Group (9, 10, college)" />
              <Tick label="Hostel" />
            </div>
            <span className="grid h-[38mm] w-[30mm] shrink-0 place-content-center border border-dashed border-border-strong text-center text-[8pt] text-ink-muted">Paste photo</span>
          </div>
          <div className="mt-2.5 grid gap-2.5 text-[9.5pt]">
            <Blank label="Permanent address" />
            <Blank label="" />
            <Blank label="Temporary address" />
          </div>
        </FormSection>
        <FormSection letter="B" title="Parents and guardian">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-[9.5pt]">
            <Blank label="Father's name" />
            <Blank label="Father's CNIC" />
            <Blank label="Father's occupation" />
            <Blank label="Father's qualification" />
            <Blank label="Mother's name" />
            <Blank label="Mother's CNIC" />
            <Blank label="Mother's occupation" />
            <Blank label="Mother's qualification" />
            <Blank label="Guardian's name" />
            <Blank label="Relation" />
            <Blank label="Guardian's CNIC" />
            <Blank label="Guardian's mobile" />
            <Blank label="Guardian's email" />
            <Blank label="Guardian's occupation" />
          </div>
        </FormSection>
        <footer className="mt-auto flex justify-between pt-6 text-[8.5pt] text-ink-muted">
          <span>Please turn over.</span>
          <span>Page 1 of 2</span>
        </footer>
      </article>
      <article className="mtb-doc mtb-doc-a4 flex flex-col" style={{ fontSize: "10pt", breakBefore: "page" }} aria-label="Blank admission form, page 2">
        <BlankHead campusName={campusName} page={2} />
        <FormSection letter="C" title="Emergency contact">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-[9.5pt]">
            <Blank label="Name" wide />
            <Blank label="Mobile 1" />
            <Blank label="Mobile 2" />
          </div>
        </FormSection>
        <FormSection letter="D" title="Additional information">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-[9.5pt]">
            <Blank label="Admission reference" />
            <Tick label="Pick and drop" />
            <Blank label="Pick and drop by" />
          </div>
        </FormSection>
        <FormSection letter="E" title="Brothers and sisters already at MTB">
          <table className="w-full border-collapse text-[9pt]">
            <thead>
              <tr>
                {["Name", "Class", "Section", "Relation"].map((h) => (
                  <th key={h} className="border border-border bg-surface-sunken px-2 py-1 text-left">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2].map((i) => (
                <tr key={i}>
                  {[0, 1, 2, 3].map((j) => (
                    <td key={j} className="h-[7mm] border border-border" />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </FormSection>
        <FormSection letter="F" title="Attachments (checked by the admissions office)">
          <table className="w-full border-collapse text-[9.5pt]">
            <tbody>
              {ATTACHMENTS.map((a, i) => (
                <tr key={a}>
                  <td className="w-[8mm] border border-border px-2 py-1 text-center tabular-nums">{i + 1}</td>
                  <td className="border border-border px-2 py-1">{a}</td>
                  <td className="w-[12mm] border border-border px-2 py-1 text-center">
                    <span className="inline-block h-[4mm] w-[4mm] border border-ink" aria-label="Received" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </FormSection>
        <FormSection letter="G" title="Previous academic record">
          <table className="w-full border-collapse text-[9pt]">
            <thead>
              <tr>
                {["Examination passed", "Year", "Board / university", "Roll no.", "Marks obtained", "Total marks", "%"].map((h) => (
                  <th key={h} className="border border-border bg-surface-sunken px-2 py-1 text-left">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[0, 1].map((i) => (
                <tr key={i}>
                  {[0, 1, 2, 3, 4, 5, 6].map((j) => (
                    <td key={j} className="h-[8mm] border border-border" />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </FormSection>
        <p className="mt-3 text-[9pt] text-ink-muted">I confirm the details above are correct and agree to the school's rules.</p>
        <footer className="mt-auto grid grid-cols-3 gap-6 pt-12 text-[9pt]">
          <div className="mtb-doc-sign" style={{ minWidth: 0 }}>
            Parent or guardian
          </div>
          <div className="mtb-doc-sign" style={{ minWidth: 0 }}>
            Admissions office
          </div>
          <div className="mtb-doc-sign" style={{ minWidth: 0 }}>
            Principal
          </div>
        </footer>
      </article>
    </>
  );
}
