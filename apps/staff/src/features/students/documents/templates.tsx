import { STUDENT_DOC_LABEL, type StudentDocDetails, type StudentDocSnapshot, type StudentDocType, type StudentFamilyDetail, type StudentMovement, photoUrl } from "@mtb/api";
import { formatCnic, formatDate, formatMobile, formatRs, pakistanToday, type IsoDate } from "@mtb/domain";
import { Fragment, useId, type ReactNode } from "react";
import { CREST_SRC, Letterhead, printStamp, SCHOOL_NAME, schoolHeading } from "../../../app/print/letterhead";
import { CAMPUS_CODES, CAMPUS_LABEL } from "../../../app/shell/campus";
import { classShortOf, sectionOf } from "../shared";
import { PhotoBox } from "@mtb/ui";

/*
 * Printed student documents, laid out as the old desktop system printed them (its report designs and the printouts
 * the school kept): same titles, wording, field order, boxes and signature lines. What the new process adds (serial
 * numbers, reprint and cancelled marks) sits where it disturbs the old look least.
 */

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

const pron = (s: { gender: "F" | "M" }) =>
  s.gender === "F" ? { he: "She", his: "her", His: "Her", him: "her", title: "Ms.", rel: "d/o", REL: "D/O" } : { he: "He", his: "his", His: "His", him: "him", title: "Mr.", rel: "s/o", REL: "S/O" };

/** The principal's name from the snapshot (spec 01_students C6), else the post and campus. */
const principalOf = (s: StudentDocSnapshot) => s.principalName ?? `Principal, ${s.campusName}`;

/** Date of birth as printed: many migrated records have none (C1), and a blank line is left to fill in by hand. */
const dobOf = (s: StudentDocSnapshot, empty = "") => (s.dob ? formatDate(s.dob) : empty);

/** The old reports' date: "24 - Mar - 2017". */
const oldDate = (d?: IsoDate | null) => (d ? formatDate(d).replace(/-/g, " - ") : "");

/** The old reports' session: "2026-2027". */
const fullSession = (y: number) => `${y}-${y + 1}`;

/** The session a date falls in (sessions start on 1 April). */
const sessionOfDate = (d: IsoDate) => {
  const y = Number(d.slice(0, 4));
  return Number(d.slice(5, 7)) >= 4 ? y : y - 1;
};

/** "Nine" from "Class Nine"; class names print as the school names them. */
const classWord = (c: string) => c.replace(/^class\s+/i, "");

/** "Khalid Campus, Sadikabad" split into the campus and the city, as the old arched headings print them. */
function campusParts(s: { campus: string; campusName: string }) {
  const place = schoolHeading(s.campus, s.campusName).slice(SCHOOL_NAME.length).replace(/^,\s*/, "");
  const i = place.lastIndexOf(",");
  return i < 0 ? { campus: place, city: "" } : { campus: place.slice(0, i).trim(), city: place.slice(i + 1).trim() };
}

/** A value written on a dashed line, as the old certificates print their fields. */
function Fill({ children, w, grow, bold, basis }: { children?: ReactNode; w?: string; grow?: boolean; bold?: boolean; /** A fixed width in a row of fields. */ basis?: string }) {
  return (
    <span className={`od-fill${grow ? " od-fill-grow" : ""}${bold ? " od-fill-bold" : ""}`} style={basis ? { flex: `0 0 ${basis}` } : w ? { minWidth: w } : undefined}>
      {children || " "}
    </span>
  );
}

function Marks({ d }: { d: DocInput }) {
  return (
    <>
      {d.cancelled && <span className="mtb-doc-mark">CANCELLED</span>}
      {(d.copy ?? 1) > 1 && <span className="mtb-doc-copy">Copy {d.copy} · reprint</span>}
    </>
  );
}

/** A grey head-and-shoulders outline where the old card and certificates printed the photo. */
function Silhouette() {
  return (
    <svg viewBox="0 0 60 60" className="od-silhouette" aria-hidden="true">
      <circle cx="30" cy="20" r="11" />
      <path d="M8 60 C8 44 16 36 30 36 C44 36 52 44 52 60 Z" />
    </svg>
  );
}

/* ---------------------------------------------------------------- ID card (CR80): "Students Identity Card" */

export function IdCard({ d }: { d: DocInput }) {
  const s = d.snapshot;
  return (
    <article className="mtb-idcard od-card" aria-label={`ID card ${s.name}`}>
      {d.cancelled && <span className="mtb-doc-mark" style={{ fontSize: "20pt" }}>CANCELLED</span>}
      <div className="od-card-title">Students Identity Card</div>
      <div className="od-card-rows">
        <span className="od-card-l">Name:</span>
        <span className="od-card-v od-card-wide">{s.name}</span>
        <span className="od-card-l">Father&apos;s Name:</span>
        <span className="od-card-v od-card-wide">{s.father}</span>
        <span className="od-card-l">Class:</span>
        <span className="od-card-v">{classWord(s.className)}</span>
        <span className="od-card-l">Group:</span>
        <span className="od-card-v">{s.stream ?? sectionOf(s.classSection)}</span>
        <span className="od-card-l">G.R. No:</span>
        <span className="od-card-v">{s.grNo}</span>
        <span className="od-card-l">Date Of Birth:</span>
        <span className="od-card-v">{dobOf(s)}</span>
        <span className="od-card-l">Date Of Issue:</span>
        <span className="od-card-v">{formatDate(d.issuedOn)}</span>
        <span className="od-card-l">Valid up to:</span>
        <span className="od-card-v">{d.details.validUntil ? formatDate(d.details.validUntil) : ""}</span>
        <span className="od-card-l">Address:</span>
        <span className="od-card-v od-card-wide od-card-addr">{s.address}</span>
      </div>
      <span className="od-card-serial">{d.serialNo}</span>
    </article>
  );
}

/** The back of the card, as the old one: photo space and the school crest, the date, card no. and holder's signature. */
export function IdCardBack({ d }: { d: DocInput }) {
  const s = d.snapshot;
  return (
    <article className="mtb-idcard od-card od-card-back" aria-label={`ID card back ${s.name}`}>
      {d.cancelled && <span className="mtb-doc-mark" style={{ fontSize: "20pt" }}>CANCELLED</span>}
      <div className="od-card-pics">
        <Silhouette />
        <img src={CREST_SRC} alt="" className="od-card-crest" />
      </div>
      <div className="od-card-foot">
        <span className="od-card-l">Date:</span>
        <span className="od-card-v">{formatDate(d.issuedOn)}</span>
        <span className="od-card-sign" />
        <span className="od-card-l">Card No:</span>
        <span className="od-card-v">{d.serialNo}</span>
        <span className="od-card-l od-card-holder">Signature Of Holder</span>
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

/* ---------------------------------------------------------------- Admission slip: half an A4 sheet */

/** The old slip took half an A4 page (two to a sheet with a dashed cut line), whatever paper the caller asked for. */
const SLIP_PAGE = "@page { size: A4 portrait; margin: 10mm; }";

export function AdmissionSlip({ d }: { d: DocInput }) {
  const s = d.snapshot;
  return (
    <article className="mtb-doc od od-slip" aria-label={`Admission slip ${s.name}`}>
      <style>{SLIP_PAGE}</style>
      <Marks d={d} />
      <Letterhead campus={s.campus} campusName={s.campusName} title="Admission Slip" titleCase="as-is" />
      <span className="od-ref od-ref-line">Slip No. {d.serialNo}</span>
      <p className="od-slip-session">
        <b>New Admission:</b>
        <b>Session</b>
        <span>{fullSession(s.session)}</span>
      </p>
      <table className="od-grid od-grid-light">
        <thead>
          <tr>
            <th style={{ width: "16%" }}>G.R.No</th>
            <th style={{ width: "34%" }}>Name</th>
            <th style={{ width: "34%" }}>Father Name</th>
            <th>Class</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="c">{s.grNo}</td>
            <td>{s.name}</td>
            <td>{s.father}</td>
            <td className="c">{classWord(s.className)}</td>
          </tr>
        </tbody>
      </table>
      <h2 className="od-slip-h">Section Allotted</h2>
      <p className="od-slip-section">
        <b>Section:</b> <u>{sectionOf(s.classSection)}</u>
        {s.rollNo ? (
          <>
            <b className="ml-8">Roll No.:</b> <u>{s.rollNo}</u>
          </>
        ) : null}
      </p>
      <div className="od-slip-signs">
        <span>V.P Sign:</span>
        <span>Class Incharge Sign:</span>
        <span>Office Suptt. Sign:</span>
      </div>
    </article>
  );
}

/* ---------------------------------------------------------------- School/College leaving certificate */

export function LeavingCertificate({ d }: { d: DocInput }) {
  const s = d.snapshot;
  const remarks = [d.details.leavingReason, d.details.remarks].filter(Boolean).join(". ");
  return (
    <article className="mtb-doc od od-slc" aria-label={`Leaving certificate ${s.name}`}>
      <Marks d={d} />
      <div className="od-slc-frame">
        <header className="od-slc-head">
          <img src={CREST_SRC} alt="" className="od-slc-crest" />
          <div className="od-slc-school">
            <div className="od-slc-name">{schoolHeading(s.campus, s.campusName)}</div>
            <div className="od-slc-contact">
              <span>
                Email: <span className="od-slc-c">{s.campusEmail ?? ""}</span>
              </span>
              <span>
                Phone/Mobile: <span className="od-slc-c">{s.campusPhone ?? ""}</span>
              </span>
            </div>
            <div className="od-slc-ref">
              <span>
                Date: <Fill w="30mm">{formatDate(d.issuedOn)}</Fill>
              </span>
              <span>
                Ref No. <Fill w="30mm">{d.serialNo}</Fill>
              </span>
            </div>
          </div>
          <span className="od-photo od-slc-photo" aria-label="Photo">
            <Silhouette />
          </span>
        </header>
        <h1 className="od-slc-title">School/College Leaving Certificate For Class {classWord(s.className)}</h1>
        <div className="od-slc-rows">
          <div className="od-slc-row">
            <span className="od-slc-l">Student Name :</span>
            <Fill grow>{s.name}</Fill>
            <span className="od-slc-l od-slc-l2">GRNo.:</span>
            <Fill basis="30mm">{s.grNo}</Fill>
          </div>
          <div className="od-slc-row">
            <span className="od-slc-l">Father&apos;s Name :</span>
            <Fill grow>{s.father}</Fill>
          </div>
          <div className="od-slc-row">
            <span className="od-slc-l od-slc-lw">Date of Birth (in figures)</span>
            <Fill grow>{oldDate(s.dob)}</Fill>
          </div>
          <div className="od-slc-row">
            <span className="od-slc-l od-slc-lw" style={{ paddingLeft: "6mm" }}>
              (in words)
            </span>
            <Fill grow>{s.dobInWords}</Fill>
          </div>
          <div className="od-slc-row">
            <span className="od-slc-l od-slc-lw">Class In which Admitted:</span>
            <Fill grow>{classWord(s.admittedInClass)}</Fill>
            <span className="od-slc-l od-slc-l2">Class In which Studying:</span>
            <Fill basis="28mm">{classWord(s.className)}</Fill>
          </div>
          <div className="od-slc-row">
            <span className="od-slc-l">Category:</span>
            <span className="od-slc-cat">
              Fresh <span className="od-box">{s.readmitted ? "" : "✓"}</span>
              Re-admission <span className="od-box">{s.readmitted ? "✓" : ""}</span>
            </span>
          </div>
          <div className="od-slc-row">
            <span className="od-slc-l">Enrolment Date:</span>
            <Fill grow>{oldDate(s.admissionDate)}</Fill>
            <span className="od-slc-l od-slc-l2">Left Date:</span>
            <Fill grow>{oldDate(s.leftOn ?? d.issuedOn)}</Fill>
          </div>
          <div className="od-slc-row">
            <span className="od-slc-l">School dues cleared up to :</span>
            <Fill grow>{s.duesClearedUpTo}</Fill>
            <span className="od-slc-l od-slc-l2">Session:</span>
            <Fill grow>{fullSession(s.session)}</Fill>
          </div>
          <div className="od-slc-row">
            <span className="od-slc-l">Personal character :</span>
            <Fill grow>{d.details.character ?? ""}</Fill>
          </div>
          <div className="od-slc-row">
            <span className="od-slc-l">Remarks :</span>
            <Fill grow>{remarks}</Fill>
          </div>
        </div>
        <footer className="od-slc-foot">
          <b>Prepared by</b>
          <b className="text-center">
            Principal
            <br />
            Signature/Stamp
          </b>
        </footer>
      </div>
    </article>
  );
}

/* ---------------------------------------------------------------- Provisional / character certificate */

/**
 * The old system had one character certificate per level: Matric (Secondary School Certificate), FA/FSc (Higher
 * Secondary, boys/girls) and graduation (BA/BSc/ADP, college, boys/girls). The board exam typed on the certificate
 * picks the level, else the student's class; the student's gender picks the girls' heading and wording.
 */
export type CharacterCertLevel = "MATRIC" | "INTER" | "GRAD";

export function characterCertLevel(s: StudentDocSnapshot, details: StudentDocDetails): CharacterCertLevel {
  const exam = (details.boardExam ?? "").toLowerCase();
  if (/graduat|universit|\badp\b|associate degree|bachelor|\bb\.?\s?a\b|\bb\.?\s?sc\b/.test(exam)) return "GRAD";
  if (/higher secondary|intermediate|\bhssc\b|\bf\.?\s?sc\b|\bf\.?\s?a\b|\bi\.?\s?com\b|\bics\b/.test(exam)) return "INTER";
  if (exam) return "MATRIC";
  const cls = `${s.className} ${classShortOf(s.classSection)}`.toLowerCase();
  if (/\badp\b|\bb\.?\s?a\b|\bb\.?\s?sc\b|third year|fourth year|3rd year|4th year|\b1[34]\b/.test(cls)) return "GRAD";
  if (/first year|second year|1st year|2nd year|\bxi\b|\bxii\b|\b1[12]\b|eleven|twelve|\bf\.?\s?sc\b|\bf\.?\s?a\b|\bics\b/.test(cls)) return "INTER";
  return "MATRIC";
}

/** The exam year in the board exam text ("… Annual 2026" → "2026"). */
const examYear = (exam?: string) => (exam?.match(/\b(?:19|20)\d{2}\b/g) ?? []).pop() ?? "";

/** The arched heading of the FA/FSc and graduation certificates: the school's name around the crest. */
function ArchHead({ text, city, title }: { text: string; city?: string; title: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 190 104" className="od-arch" role="img" aria-label={`${text}${city ? `, ${city}` : ""}. ${title}`}>
      <defs>
        <path id={`arc${id}`} d="M 21.5 100 A 75 75 0 1 1 168.5 100" />
      </defs>
      <text className="od-arch-text">
        <textPath href={`#arc${id}`} startOffset="50%" textAnchor="middle" textLength="250" lengthAdjust="spacingAndGlyphs">
          {text}
        </textPath>
      </text>
      <image href={CREST_SRC} x={city ? 72 : 68} y={city ? 17 : 18} width={city ? 46 : 54} height={city ? 52 : 60} preserveAspectRatio="xMidYMid meet" />
      {city && (
        <text x="95" y="80" textAnchor="middle" className="od-arch-city">
          {city}
        </text>
      )}
      <text x="95" y={city ? 93 : 91} textAnchor="middle" className="od-arch-title">
        {title}
      </text>
    </svg>
  );
}

export function CharacterCertificate({ d }: { d: DocInput }) {
  const s = d.snapshot;
  const level = characterCertLevel(s, d.details);
  if (level === "INTER") return <InterCharacterCertificate d={d} />;
  if (level === "GRAD") return <GradCharacterCertificate d={d} />;
  const p = pron(s);
  return (
    <article className="mtb-doc mtb-doc-a4 od od-cc od-cc-boxed flex flex-col" aria-label={`Character certificate ${s.name}`}>
      <Marks d={d} />
      <header className="od-cc-head">
        <span className="od-cc-crest">
          <img src={CREST_SRC} alt="" />
        </span>
        <div className="od-cc-school">{schoolHeading(s.campus, s.campusName).toUpperCase()}</div>
        <span className="od-cc-ref">
          <b>Ref.No:</b>
          <span>{d.serialNo}</span>
        </span>
        <div className="od-cc-title">PROVISIONAL/CHARACTER CERTIFICATE</div>
      </header>
      <p className="od-cc-session">
        Session: <Fill w="34mm">{fullSession(s.session)}</Fill>
      </p>
      <div className="od-cc-body">
        <p>
          This is certified that {p.title} <Fill w="128mm">{s.name}</Fill>
        </p>
        <p>
          {p.rel} <Fill w="90mm">{s.father}</Fill> has been a bonafide student of this school.
        </p>
        <p>
          {p.he} appeared in the Secondary School Certificate exam held in <Fill w="52mm">{examYear(d.details.boardExam)}</Fill>
        </p>
        <p>
          Roll No. <Fill w="48mm">{d.details.boardRollNo}</Fill> from the Board of Intermediate and Secondary Education, Bahawalpur. {p.he} passed the exam securing <Fill w="32mm">{d.details.boardMarks}</Fill> marks. {p.His} date of birth, according to the General School Register, is ( in figures ){" "}
          <Fill w="52mm">{dobOf(s)}</Fill>
        </p>
        <p>
          ( in words ) <Fill w="146mm">{s.dobInWords}</Fill>
        </p>
        <p>
          {p.he} bears <b>{(d.details.character ?? "good").toLowerCase()}</b> moral character and {p.his} conduct in the school has been commendable. I wish {p.him} success in {p.his} future studies and career.
        </p>
        {d.details.remarks && <p>{d.details.remarks}</p>}
      </div>
      <footer className="od-cc-foot">
        <b>PRINCIPAL</b>
        <span>
          <b>Dated:</b> <Fill w="55mm">{formatDate(d.issuedOn)}</Fill>
        </span>
      </footer>
    </article>
  );
}

/** FA/FSc: "Higher Secondary School for Boys/Girls" (girls: "for Girls"), the BISE Bahawalpur exam. */
function InterCharacterCertificate({ d }: { d: DocInput }) {
  const s = d.snapshot;
  const p = pron(s);
  const girls = s.gender === "F";
  const cp = campusParts(s);
  return (
    <article className="mtb-doc mtb-doc-a4 od od-cc od-cc-boxed flex flex-col" aria-label={`Character certificate ${s.name}`}>
      <Marks d={d} />
      <span className="od-cc-ref-small">Ref. No. {d.serialNo}</span>
      <ArchHead text={`MTB-MADRASAT-UL-BANAT HIGHER SECONDARY SCHOOL FOR ${girls ? "GIRLS" : "BOYS/GIRLS"}, ${cp.campus.toUpperCase()}`} city={cp.city.toUpperCase()} title="PROVISIONAL / CHARACTER CERTIFICATE" />
      <div className="od-cc-body od-cc-body-tight">
        <p>
          This is certified that <Fill w="140mm">{s.name}</Fill>
        </p>
        <p>
          {p.rel} <Fill w="60mm">{s.father}</Fill> was a bonafide student of MTB - Madrasat-Ul-Banat Higher Secondary Schools for {girls ? "Girls" : "Boys / Girls"}, {cp.campus}
          {cp.city ? `, ${cp.city}` : ""}. {p.he} appeared in the Higher Secondary Final exam held by the Board of Intermediate and Secondary Education, Bahawalpur in, <Fill w="18mm">{examYear(d.details.boardExam)}</Fill> under Roll #{" "}
          <Fill w="22mm">{d.details.boardRollNo}</Fill>. {p.he} passed the exam in {s.stream ?? "Pre-Medical / Pre-Engineering / ICS"} Group, securing <Fill w="24mm">{d.details.boardMarks}</Fill> marks. {p.His} date of birth according to the General
          School Register is (in figures) <Fill w="26mm">{dobOf(s)}</Fill> and (in words).
        </p>
        <p>
          <Fill w="140mm">{s.dobInWords}</Fill>.
        </p>
        <p>
          {p.he} bears {(d.details.character ?? "good").toLowerCase()} moral character and {p.his} conduct in the school has been commendable.
        </p>
        <p>
          I wish {p.him} success in {p.his} future studies and career.
        </p>
        {d.details.remarks && <p>{d.details.remarks}</p>}
      </div>
      <footer className="od-cc-foot od-cc-foot-swap">
        <span>
          <b>Dated:</b> <Fill w="26mm">{formatDate(d.issuedOn)}</Fill>
        </span>
        <b>PRINCIPAL</b>
      </footer>
    </article>
  );
}

/** BA/BSc/ADP: "College for Boys/Girls" (girls: "for Girls"), the Islamia University Bahawalpur exam. */
function GradCharacterCertificate({ d }: { d: DocInput }) {
  const s = d.snapshot;
  const p = pron(s);
  const girls = s.gender === "F";
  const cp = campusParts(s);
  const adp = /\badp\b/i.test(`${d.details.boardExam ?? ""} ${s.className}`);
  const group = s.stream ?? (adp ? "ADP (ADA / ADS)" : "");
  return (
    <article className="mtb-doc mtb-doc-a4 od od-cc od-cc-boxed flex flex-col" aria-label={`Character certificate ${s.name}`}>
      <Marks d={d} />
      <span className="od-cc-ref-small">Ref. No. {d.serialNo}</span>
      <ArchHead text={`MTB-MADRASAT-UL-BANAT COLLEGE FOR ${girls ? "GIRLS" : "BOYS/GIRLS"}, ${cp.campus.toUpperCase()}${cp.city ? `, ${cp.city.toUpperCase()}` : ""}`} title="PROVISIONAL / CHARACTER CERTIFICATE" />
      <p className="od-cc-session">
        Session: <Fill w="40mm">{fullSession(s.session)}</Fill>
      </p>
      <div className="od-cc-body od-cc-body-tight">
        <p>
          This is certified that <Fill w="140mm" bold>{s.name}</Fill>
        </p>
        <p>
          {p.rel} <Fill w="70mm" bold>{s.father}</Fill> was a bonafide student of MTB-Madrasat-Ul-Banat, College for {girls ? "Girls" : "Boys / Girls"}, {cp.city || cp.campus}. {p.he} appeared in the Graduation Final Exam held by the Islamia University Bahawalpur in{" "}
          <Fill w="26mm" bold>{examYear(d.details.boardExam)}</Fill> under Roll No. <Fill w="48mm" bold>{d.details.boardRollNo}</Fill>
        </p>
        <p>
          {p.he} passed the exam in <Fill w="34mm" bold>{group}</Fill> Group securing <Fill w="24mm" bold>{d.details.boardMarks}</Fill> {p.His} date of birth according to the Secondary School Certificate is (in figures) <Fill w="54mm" bold>{dobOf(s)}</Fill>
        </p>
        <p>
          and (in words) <Fill w="140mm" bold>{s.dobInWords}</Fill>
        </p>
        <p>
          {p.he} bears {(d.details.character ?? "good").toLowerCase()} moral character and {p.his} conduct in the institution has been commendable.
        </p>
        <p>
          I wish {p.him} success in {p.his} future studies and career.
        </p>
        {d.details.remarks && <p>{d.details.remarks}</p>}
      </div>
      <footer className="od-cc-foot od-cc-foot-swap">
        <span>
          <b>Dated:</b> <Fill w="56mm">{formatDate(d.issuedOn)}</Fill>
        </span>
        <b>PRINCIPAL</b>
      </footer>
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
    <article className="mtb-doc mtb-doc-a4 od od-letter flex flex-col" aria-label={`Appreciation letter ${s.name}`}>
      <Marks d={d} />
      <Letterhead campus={s.campus} campusName={s.campusName} />
      <span className="od-ref od-ref-line">Ref. No. {d.serialNo}</span>
      <h1 className="od-letter-title">Appreciation Letter</h1>
      <div className="od-letter-body">
        <p>
          This is certified that {s.name} {p.rel} {s.father} of {classShortOf(s.classSection)} ({sectionOf(s.classSection)}) remained the most regular student of {p.his} class during the session {fullSession(s.session)} with {pct}% attendance i.e {present}/{total} days.{" "}
          {p.he} has been issued a letter of appreciation as a token of acknowledgement for {p.his} commitment, hard work and regularity.
        </p>
        {d.details.remarks && <p>{d.details.remarks}</p>}
        <p className="od-letter-gap">I pray for success in {p.his} future career.</p>
      </div>
      <footer className="od-letter-foot">
        <span>
          Dated :<span className="ml-6">{formatDate(d.issuedOn)}</span>
        </span>
        <span className="od-letter-principal">
          ( {principalOf(s)} )
          <br />
          Principal
        </span>
      </footer>
      <p className="od-letter-prepared">Prepared By: Office Superintendent</p>
    </article>
  );
}

/* ---------------------------------------------------------------- Date of birth certificate: "To Whom It May Concern" */

export function BirthCertificate({ d }: { d: DocInput }) {
  const s = d.snapshot;
  const p = pron(s);
  const cls = classShortOf(s.classSection);
  const sec = sectionOf(s.classSection);
  return (
    <article className="mtb-doc mtb-doc-a4 od od-dob flex flex-col" aria-label={`Date of birth certificate ${s.name}`}>
      <Marks d={d} />
      <Letterhead campus={s.campus} campusName={s.campusName} />
      <span className="od-ref od-ref-line">Ref. No. {d.serialNo}</span>
      <h1 className="od-dob-title">To Whom It May Concern</h1>
      <p className="od-dob-text">
        It is certified that {s.name} {p.REL} {s.father} {s.leftOn ? "was" : "is"} a regular Student of this institution. {p.he} {s.leftOn ? "was" : "is"} Studying in Class {cls}
        {sec ? ` (${sec})` : ""}. {p.His} Date Of Birth According To the General School Register Is {s.dob ? formatDate(s.dob) : "not recorded"}
        {s.dob ? ` (In Words) ${s.dobInWords}` : ""}.{d.details.remarks ? ` This certificate is issued for ${d.details.remarks}.` : ""}
      </p>
      <table className="od-grid od-dob-table">
        <thead>
          <tr>
            <th style={{ width: "11%" }}>G.R.No</th>
            <th>Name</th>
            <th style={{ width: "17%" }}>Class</th>
            <th style={{ width: "20%" }}>section</th>
            <th style={{ width: "19%" }} className="od-dob-pic">
              Pic
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="c">{s.grNo}</td>
            <td className="c">{s.name}</td>
            <td className="c">{cls}</td>
            <td className="c">{sec}</td>
            <td className="od-dob-photo">
              {/* the old certificate printed the student's photo from the record (Student_Snap) */}
              <PhotoBox src={photoUrl.student(s.grNo)} className="od-dob-img" fallback={<Silhouette />} />
            </td>
          </tr>
        </tbody>
      </table>
      <p className="od-dob-wish">I Wish For Success In {p.His} Future Career</p>
      <footer className="od-dob-foot">
        <span>
          Dated:<span className="od-dob-date">{oldDate(d.issuedOn)}</span>
        </span>
        <b>Principal</b>
      </footer>
      <p className="od-dob-prepared">Prepared By: Office Superintendent</p>
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

/** Every printed student document is on A4 portrait (the admission slip takes its top half), cards ten to a sheet. */
export const docPaper = (type: StudentDocType) => (type === "ID_CARD" ? "ID_SHEET" : "A4") as "A4" | "A5" | "ID_SHEET";

export const docTitle = (type: StudentDocType) => STUDENT_DOC_LABEL[type];

/* ---------------------------------------------------------------- Family sibling sheet (A4) */

function Signatures({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <footer className="mt-auto flex items-end justify-between gap-6 pt-14">
      <div className="mtb-doc-sign">{left}</div>
      <div className="mtb-doc-sign">{right}</div>
    </footer>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-end gap-2">
      <span className="shrink-0 text-ink-muted">{label}</span>
      <span className="mtb-doc-line flex-1 text-left">{children}</span>
    </div>
  );
}

/** The family's children with their class and this session's fee after concessions (legacy sibling sheet). */
export function FamilySheet({ f, session, printedOn }: { f: StudentFamilyDetail; session: number; printedOn: IsoDate }) {
  const kids = f.children.filter((c) => c.status === "ACTIVE");
  const campuses = [...new Set(kids.map((c) => c.campusName))];
  const campus = kids[0]?.campus ?? "ALL";
  const total = kids.reduce((a, c) => a + c.sessionFee.net, 0);
  const off = kids.reduce((a, c) => a + c.sessionFee.concession, 0);
  return (
    <article className="mtb-doc mtb-doc-a4 od flex flex-col" aria-label={`Family sheet ${f.fatherName}`}>
      <Letterhead
        campus={campuses.length === 1 ? campus : "ALL"}
        {...(campuses.length === 1 && campuses[0] ? { campusName: campuses[0] } : {})}
        title={`Family Sheet · Session ${fullSession(session)}`}
        titleCase="as-is"
      />
      <span className="od-ref od-ref-line">
        Family <b>{f.id}</b> · Date {formatDate(printedOn)}
      </span>
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
            {campuses.length > 1 && <th style={{ width: "30mm" }}>Campus</th>}
            <th style={{ width: "34mm" }}>Session fee (Rs)</th>
          </tr>
        </thead>
        <tbody>
          {kids.map((c, i) => (
            <tr key={c.grNo}>
              <td className="mid">{i + 1}</td>
              <td className="mtb-mono">{c.grNo}</td>
              <td>{c.name}</td>
              <td className="mid">{classShortOf(c.classSection)}</td>
              <td className="mid">{sectionOf(c.classSection)}</td>
              {campuses.length > 1 && <td>{c.campusName}</td>}
              <td className="num">
                {formatRs(c.sessionFee.net)}
                {c.sessionFee.concession > 0 && <span className="block text-[8pt] text-ink-muted">after {formatRs(c.sessionFee.concession)} concession</span>}
              </td>
            </tr>
          ))}
          <tr>
            <td colSpan={campuses.length > 1 ? 6 : 5} className="num font-semibold">
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

/* ---------------------------------------------------------------- Expulsion notice and re-admission statement (top of an A4 sheet) */

const COPY_TO = "->School Office/-> Accounts Branch/-> Exam Branch/-> Head Teacher/-> Notice Board/-> Vice Principal/-> Student's Parents";

/** The old "Print Date/Time : 03-Nov-2026 03:17 PM". */
const noticeStamp = () => {
  const time = new Date().toLocaleTimeString("en-US", { timeZone: "Asia/Karachi", hour: "2-digit", minute: "2-digit", hour12: true });
  return `${formatDate(pakistanToday())} ${time}`;
};

function NoticeTable({ m }: { m: StudentMovement }) {
  return (
    <table className="od-grid od-grid-light od-notice-table">
      <tbody>
        <tr>
          <th>Student&apos;s Name</th>
          <td>{m.name}</td>
          <th>G.R.No.</th>
          <td>{m.grNo}</td>
        </tr>
        <tr>
          <th>Father&apos;s Name</th>
          <td>{m.father}</td>
          <th>Class &amp; Section</th>
          <td>
            {m.classSection} - {fullSession(sessionOfDate(m.date))}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function NoticeCopyTo() {
  return (
    <div className="od-notice-copy">
      <b>
        <u>Copy to:</u>
      </b>
      <p>{COPY_TO}</p>
      <p>Print Date/Time : {noticeStamp()}</p>
    </div>
  );
}

/** "Expulsion Notice": struck off the rolls or expelled. `mobile` is accepted for callers; the old notice did not print it. */
export function StatusNotice(props: { m: StudentMovement; mobile?: string }) {
  const m = props.m;
  const struck = m.kind === "STRUCK_OFF";
  return (
    <article className="mtb-doc od od-notice" aria-label={`Notice ${m.name}`}>
      <div className="od-notice-school">{schoolHeading(m.campus, m.campusName)}</div>
      <h1 className="od-notice-title">Expulsion Notice</h1>
      <p className="od-notice-text">
        This is hereby notified that the following student&apos;s name has been {struck ? "struck off the school/college rolls" : "expelled from the school/college rolls"} w.e.f <u className="ml-6 mr-1">{oldDate(m.date)}</u> for reasons stated as under:
      </p>
      <NoticeTable m={m} />
      <div className="od-notice-reasons">
        <b>Reasons:</b>
        <p>
          {m.reason}
          {m.remarks ? `. ${m.remarks}` : ""}
        </p>
        {m.balanceAtTime > 0 && <p className="od-notice-small">Dues outstanding on that date: {formatRs(m.balanceAtTime)}.</p>}
        {struck && <p className="od-notice-small">To restore the admission, please meet the principal within seven days.</p>}
      </div>
      <div className="od-notice-signs od-notice-signs-2">
        <div>
          <span className="od-notice-sign">Accountant / V.P</span>
        </div>
        <div>
          <span className="od-notice-sign">Principal</span>
          <span className="od-notice-date">
            <b>Date:</b>
            <span className="od-notice-dline" />
          </span>
        </div>
      </div>
      <NoticeCopyTo />
    </article>
  );
}

/** "Admission/Re-admission Statement": restored to the rolls. */
export function ReadmissionStatement({ m, previous }: { m: StudentMovement; previous?: { on: IsoDate; reason: string } }) {
  return (
    <article className="mtb-doc od od-notice" aria-label={`Re-admission statement ${m.name}`}>
      <div className="od-notice-school">{schoolHeading(m.campus, m.campusName)}</div>
      <h1 className="od-notice-title">Admission/Re-admission Statement</h1>
      <p className="od-notice-text od-serif">
        This is hereby notified that the following student&apos;s name has been admitted/re-admitted to the school/college rolls w.e.f <u className="ml-2 mr-4">{oldDate(m.date)}</u> for reasons stated as under:
      </p>
      <NoticeTable m={m} />
      <div className="od-notice-reasons">
        <b>Reasons:</b>
        <p>
          {m.reason}
          {m.remarks ? `. ${m.remarks}` : ""}
          {previous ? ` (struck off on ${formatDate(previous.on)}: ${previous.reason.toLowerCase()})` : ""}
        </p>
      </div>
      <div className="od-notice-signs od-notice-signs-3">
        {["Class In-charge", "V.P", "Office Suptt/Accountant"].map((role) => (
          <div key={role}>
            <span className="od-notice-sign">{role}</span>
            <span className="od-notice-date">
              <b>Date:</b>
              <span className="od-notice-dline" />
            </span>
          </div>
        ))}
      </div>
      <NoticeCopyTo />
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
 * "Roll No. Slip/Result Card/Certificate Issuance Form": one line per student with the board roll numbers, and a
 * signature and date box for each document. Signature boxes stay empty; a date already in the register is filled
 * in. The heading is part of the table head, so it repeats on every printed page.
 */
export function CollectionSheet({ sheet, printedAt, classLabel, campus }: { sheet: CollectionSheetInput; printedAt: string; /** The class's name from Setup, e.g. "Class 9" or "First Year". */ classLabel?: string; /** The campus code, for the letterhead's town. */ campus?: string }) {
  const cls = classLabel ?? sheet.className;
  const date = (d?: IsoDate) => (d ? formatDate(d) : "");
  return (
    <article className="mtb-doc mtb-doc-a4l od" aria-label={`Collection sheet ${cls}`}>
      <table className="mtb-collect od-collect">
        <colgroup>
          <col style={{ width: "9mm" }} />
          <col />
          {["roll", "sig", "date", "roll", "sig", "date", "sig", "date", "sig", "date"].map((k, i) => (
            <col key={i} style={{ width: k === "sig" ? "20mm" : k === "roll" ? "22mm" : "16mm" }} />
          ))}
        </colgroup>
        <thead>
          <tr className="mtb-collect-head">
            <th colSpan={12}>
              <div className="grid justify-items-center gap-1 text-center">
                <span className="od-collect-school">{schoolHeading(campus ?? "", sheet.campusName)}</span>
                <span className="od-collect-title">Roll No. Slip/Result Card/Certificate Issuance Form</span>
              </div>
              <div className="od-collect-fields">
                <span>
                  <b>Class :</b> <span className="mtb-collect-field">{cls}{sheet.section ? `-${sheet.section}` : ""}</span>
                </span>
                <span>
                  <b>Group :</b> <span className="mtb-collect-field">{sheet.stream ?? "All groups"}</span>
                </span>
                <span>
                  <b>Gender:</b> <span className="mtb-collect-field">{sheet.gender === "F" ? "Female" : sheet.gender === "M" ? "Male" : "All"}</span>
                </span>
                <span>
                  <b>Session:</b> <span className="mtb-collect-field">{fullSession(sheet.session)}</span>
                </span>
              </div>
            </th>
          </tr>
          <tr>
            <th rowSpan={2}>Sr.#</th>
            <th rowSpan={2}>Student Name</th>
            <th rowSpan={2}>Roll No. Part-I</th>
            <th colSpan={2}>Slip</th>
            <th rowSpan={2}>Roll No. Part-II</th>
            <th colSpan={2}>Slip</th>
            <th colSpan={2}>Result Card</th>
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
                {r.name} <span className="od-collect-gr">({r.grNo}{sheet.section ? "" : ` · ${r.classSection}`})</span>
              </td>
              <td className="mid">{r.rollPartI ?? ""}</td>
              <td />
              <td className="mid">{date(r.handed.slipI)}</td>
              <td className="mid">{r.rollPartII ?? ""}</td>
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
      <p className="mtb-doc-screen-only m-0 mt-3 flex justify-between text-[8pt]">
        <span>Print DateTime {printedAt}</span>
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
      <span className="mtb-addr-label-from">
        From: {SCHOOL_NAME}, {l.campusName}
      </span>
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

/* ---------------------------------------------------------------- Admission form: the student's record filled in (A4) */

/** A grey section bar of the old filled admission form. */
function RecBar({ children }: { children: ReactNode }) {
  return <h2 className="od-rec-bar">{children}</h2>;
}

type RecRow = [string, ReactNode] | [string, ReactNode, string, ReactNode];

/** "Label : value" pairs, two to a line, label right-aligned and bold, value underlined (blank when not on record). */
function RecRows({ rows }: { rows: RecRow[] }) {
  return (
    <div className="od-rec-rows">
      {rows.map((r) => (
        <Fragment key={r[0]}>
          <span className="od-rec-l">{r[0]}</span>
          <span className={r.length === 2 ? "od-rec-v od-rec-wide" : "od-rec-v"}>
            <u>{r[1]}</u>
          </span>
          {r.length === 4 && (
            <>
              <span className="od-rec-l">{r[2]}</span>
              <span className="od-rec-v">
                <u>{r[3]}</u>
              </span>
            </>
          )}
        </Fragment>
      ))}
    </div>
  );
}

const yesNo = (v: boolean | undefined) => (v === undefined ? "" : v ? "Yes" : "No");

/**
 * The legacy "Admission Form" (Student Registration Print): one A4 page per student with the record filled in —
 * personal, academic, family and guardian and other information — as the old report printed it, plus the facts of
 * the full (blank) admission form that the record holds: parents' qualifications and CNIC, city, house, the emergency
 * contact and the brothers and sisters at MTB. A fact not on record prints as an empty line, to fill in by hand.
 * Prints for one student (profile) or a whole section (Documents).
 */
export function StudentRecordForm({ s, printedOn }: { s: StudentDocSnapshot; printedOn: IsoDate }) {
  const r = s.record;
  const brothers = r ? r.siblings.filter((x) => x.relation === "Brother").length : "";
  const sisters = r ? r.siblings.filter((x) => x.relation === "Sister").length : "";
  const ec = r?.emergencyContact;
  return (
    <article className="mtb-doc mtb-doc-a4 od od-rec flex flex-col" aria-label={`Admission form ${s.name}`}>
      <Letterhead campus={s.campus} campusName={s.campusName} />
      <div className="od-rec-top">
        <div className="od-rec-reg">
          <span className="od-rec-l">Registration Number :</span>
          <span className="od-rec-v">
            <u>{s.grNo}</u>
          </span>
        </div>
        <span className="od-photo od-rec-photo" aria-label="Photo">
          <Silhouette />
        </span>
      </div>
      <RecBar>Personal Information</RecBar>
      <RecRows
        rows={[
          ["First Name :", s.name, "Last Name :", ""],
          ["Father Name :", s.father, "Mother Name :", r?.mother ?? ""],
          ["Father Occupation:", r?.fatherOccupation ?? "", "Mother Occupation:", r?.motherOccupation ?? ""],
          ["Father Qualification:", r?.fatherQualification ?? "", "Mother Qualification:", r?.motherQualification ?? ""],
          ["Father's CNIC :", r?.fatherCnic ? formatCnic(r.fatherCnic) : "", "City :", r?.city ?? ""],
          ["DOB :", dobOf(s), "Gender :", s.gender === "F" ? "Female" : "Male"],
          ["Cast:", r?.caste ?? "", "Disability :", r?.disability && r.disability !== "None" ? r.disability : ""],
          ["CNIC :", r?.bForm ? formatCnic(r.bForm) : "", "Blood Group :", s.bloodGroup ?? ""],
          ["No Of Brothers :", brothers, "No Of Sisters:", sisters],
          ["Mobile No.", s.guardianMobile ? formatMobile(s.guardianMobile) : "", "Home Phone :", r?.homePhone ?? ""],
          ["Email :", r?.email ?? "", "Religion :", r?.religion ?? ""],
          ["Hostelized", yesNo(r?.hostel) || "No", "House :", r?.house ?? ""],
          ["Permanent Address :", s.address],
          ["Temporary Address:", r?.tempAddress ?? ""],
        ]}
      />
      <RecBar>Academic Information</RecBar>
      <RecRows rows={[["Previous School Name:", r?.previousSchool ?? "", "Admission Class:", classWord(s.admittedInClass)]]} />
      <RecBar>Family &amp; Guardian Information</RecBar>
      <RecRows
        rows={[
          ["Guardian Name :", r?.guardian.name ?? "", "Relation :", r?.guardian.relation ?? ""],
          ["Guardian CNIC :", r?.guardian.cnic ? formatCnic(r.guardian.cnic) : "", "Profession :", r?.guardian.occupation ?? ""],
          ["Mobile No :", r?.guardian.mobile ? formatMobile(r.guardian.mobile) : "", "Email :", r?.guardian.email ?? ""],
          ["Emergency Contact :", ec?.name ?? "", "Emergency Mobile :", [ec?.mobile1, ec?.mobile2].filter((m): m is string => Boolean(m)).map(formatMobile).join(", ")],
        ]}
      />
      <RecBar>Brothers and Sisters at MTB</RecBar>
      {r && r.siblings.length > 0 ? (
        <table className="od-grid od-rec-sibs">
          <thead>
            <tr>
              <th>Name</th>
              <th>G.R. No.</th>
              <th>Class / Section</th>
              <th>Relationship</th>
              <th>Campus</th>
            </tr>
          </thead>
          <tbody>
            {r.siblings.map((x) => (
              <tr key={x.grNo}>
                <td className="l">{x.name}</td>
                <td>{x.grNo}</td>
                <td>{x.classSection}</td>
                <td>{x.relation}</td>
                <td>{x.campusName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="od-rec-none">{r ? "None enrolled at MTB." : ""}</p>
      )}
      <RecBar>Other Information</RecBar>
      <RecRows
        rows={[
          ["Admission Reference :", r?.admissionReference ?? "", "Pick & Drop By :", r?.pickDrop ?? ""],
          ["Identification Mark :", r?.identificationMark ?? "", "Birth Certificate No. :", r?.birthCertificateNo ?? ""],
          ["Admission Date :", formatDate(s.admissionDate), "Guardian Signature :", ""],
        ]}
      />
      <footer className="od-rec-foot">
        <span>Print DateTime {printedOn === pakistanToday() ? printStamp() : formatDate(printedOn)}</span>
        <span>Student Admission Form</span>
        <span>
          Fill By:<span className="od-rec-fill" />
        </span>
      </footer>
    </article>
  );
}

/* ---------------------------------------------------------------- Blank admission form, four A4 pages */

/** A label with a line to write on. */
function Blank({ label, w }: { label: string; w?: string }) {
  return (
    <span className="od-af-field">
      <b>{label}</b>
      <span className="od-af-line" style={w ? { flex: `0 0 ${w}` } : undefined} />
    </span>
  );
}

function Boxes({ label, options = ["Yes", "No"] }: { label?: string; options?: string[] }) {
  return (
    <span className="od-af-field od-af-ticks">
      {label && <b>{label}</b>}
      {options.map((o) => (
        <span key={o} className="inline-flex items-center gap-1">
          <b>{o}</b>
          <span className="od-af-box" />
        </span>
      ))}
    </span>
  );
}

function AfBar({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <h2 className={wide ? "od-af-bar od-af-bar-wide" : "od-af-bar"}>{children}</h2>;
}

function AfHead({ campus, campusName }: { campus: string; campusName?: string }) {
  return (
    <div className="od-af-head">
      <Letterhead campus={campus} {...(campusName ? { campusName } : {})} title="ADMISSION FORM" />
    </div>
  );
}

const ATTACHMENTS = [
  "Birth Certificate",
  "Declaration (Birth Certificate)",
  "Emergency Information Form",
  "Authorization to Reproduce Physical Likeness",
  "Emergency Medical Procedure",
  "Vaccination",
  "NADRA'S Form B",
  "Previous Result card",
];

/**
 * The legacy blank admission form, four A4 pages, for families to fill in by hand: Section A student, B guardian,
 * C emergency contact, D additional information, E siblings, F attachments, G previous academic record,
 * H co-curricular activities and house, I group / subjects, J the student's declaration, K the student's and
 * parent's signatures and L the office's (accountant, office superintendent, principal's remarks).
 * `campus` (the campus code) prints the campus town in the letterhead.
 */
export function BlankAdmissionForm({ campusName, session, campus }: { campusName: string; session: number; campus?: string }) {
  const cc = campus ?? CAMPUS_CODES.find((c) => c !== "ALL" && CAMPUS_LABEL[c] === campusName) ?? "ALL";
  const head = <AfHead campus={cc} {...(campusName ? { campusName } : {})} />;
  return (
    <>
      <article className="mtb-doc mtb-doc-a4 od od-af flex flex-col" aria-label="Blank admission form, page 1">
        {head}
        <p className="od-af-session">Session {fullSession(session)}</p>
        <AfBar>Section A Student Information</AfBar>
        <div className="od-af-a">
          <div className="od-af-main">
            <Blank label="Student's First Name" />
            <Blank label="Student's Last Name" />
            <div className="od-af-dobrow">
              <span className="od-af-dob">
                <b>DOB</b>
                <span className="od-af-dmy">
                  <b>Day</b>
                  <b>Month</b>
                  <b>Year</b>
                  <span className="od-af-cell" />
                  <span className="od-af-cell" />
                  <span className="od-af-cell" />
                </span>
              </span>
              <span className="od-af-gender">
                <b className="od-af-gender-h">Tick the Appropriate Box</b>
                <span className="od-af-gender-row">
                  <b className="od-af-cellbox">Gender</b>
                  <Boxes options={["Male", "Female"]} />
                </span>
              </span>
            </div>
            <Blank label="DOB in Words" />
            <div className="od-af-two">
              <Blank label="Cast" />
              <Blank label="Religion" />
            </div>
            <div className="od-af-two">
              <Blank label="CNIC/B-Form" />
              <Blank label="City" />
            </div>
            <Boxes label="Disability" />
            <Blank label="Disability If Yes" />
            <div className="od-af-two">
              <Blank label="Mobile No" />
              <Blank label="E-Mail" />
            </div>
            <div className="od-af-two">
              <Blank label="No of Brothers" />
              <Blank label="No of Sisters" />
            </div>
            <div className="od-af-two">
              <Blank label="Previous School" />
              <Blank label="Admission in Class" />
            </div>
            <Blank label="Father's Name" />
            <div className="od-af-two">
              <Blank label="Father's CNIC" />
              <Blank label="Father's Profession" />
            </div>
            <Blank label="Mother's Name" />
            <Blank label="Father's Qualification" />
            <Blank label="Mother's Qualification" />
            <Blank label="Student Blood Group" w="60mm" />
            <div className="od-af-two">
              <Blank label="Admission Date" />
              <Boxes label="Hostelized" />
            </div>
          </div>
          <div className="od-af-side">
            <Blank label="Form No." />
            <Blank label="Date of Apply" />
            <Blank label="GR. NO." />
            <span className="od-photo od-af-photo" aria-label="Paste photo">
              <Silhouette />
            </span>
          </div>
        </div>
        <div className="od-af-addr">
          <Blank label="Permanent Address" />
          <span className="od-af-line od-af-line-full" />
          <Blank label="Temporary Address" />
          <span className="od-af-line od-af-line-full" />
        </div>
        <AfBar>Section B Guardian Information</AfBar>
        <div className="od-af-a">
          <div className="od-af-main">
            <Blank label="Guardian Name" />
            <Blank label="Mobile No." />
            <Blank label="CNIC No." />
            <Blank label="Relation" />
            <Blank label="E-Mail" />
            <Blank label="Profession" />
          </div>
          <div className="od-af-side">
            <span className="od-photo od-af-photo" aria-label="Guardian's photo">
              <Silhouette />
            </span>
          </div>
        </div>
      </article>
      <article className="mtb-doc mtb-doc-a4 od od-af flex flex-col" style={{ breakBefore: "page" }} aria-label="Blank admission form, page 2">
        {head}
        <AfBar wide>Section C Emergency Contact Information</AfBar>
        <div className="od-af-two">
          <Blank label="Name" />
          <Blank label="Mobile No. 1" />
        </div>
        <div className="od-af-two">
          <span />
          <Blank label="Mobile No. 2" />
        </div>
        <AfBar>Section D Additional Information</AfBar>
        <div className="od-af-two">
          <Blank label="Admission Reference" />
          <Boxes label="Pick And Drop" />
        </div>
        <div className="od-af-two">
          <Blank label="Pick And Drop Type" />
          <span />
        </div>
        <AfBar>Section E: Sibling Information</AfBar>
        <table className="od-grid od-af-table">
          <thead>
            <tr>
              <th colSpan={4} className="l">
                Name of brother(s) and sister(s) already enrolled in this campus of MTB:
              </th>
            </tr>
            <tr>
              <th style={{ width: "28%" }}>Name</th>
              <th style={{ width: "14%" }}>Class</th>
              <th style={{ width: "26%" }}>Section</th>
              <th>Relationship</th>
            </tr>
          </thead>
          <tbody>
            {[0, 1, 2].map((i) => (
              <tr key={i}>
                {[0, 1, 2, 3].map((j) => (
                  <td key={j} className="od-af-empty" />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <AfBar>Section F : Attachments</AfBar>
        <table className="od-grid od-af-table">
          <thead>
            <tr>
              <th colSpan={2} className="l">
                In-charge Admission Office to ensure following attachments:
              </th>
            </tr>
          </thead>
          <tbody>
            {ATTACHMENTS.map((a, i) => (
              <tr key={a}>
                <td className="c" style={{ width: "6mm" }}>
                  {i + 1}
                </td>
                <td className="od-af-att">{a}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <AfBar wide>SECTION: G PREVIOUS ACADEMIC RECORD</AfBar>
        <table className="od-grid od-af-table">
          <thead>
            <tr>
              {["Examination Passed", "Year", "Board/University", "Roll No.", "Obtained Marks", "Total Marks", "% Age"].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[0, 1].map((i) => (
              <tr key={i}>
                {[0, 1, 2, 3, 4, 5, 6].map((j) => (
                  <td key={j} className="od-af-empty" />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </article>
      <article className="mtb-doc mtb-doc-a4 od od-af flex flex-col" style={{ breakBefore: "page" }} aria-label="Blank admission form, page 3">
        {head}
        <AfBar wide>SECTION: H CO-CURRICULAR ACTIVITIES</AfBar>
        <table className="od-grid od-af-table">
          <thead>
            <tr>
              {["Sports Name", "Speech", "Another", "Position If any"].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[0, 1].map((i) => (
              <tr key={i}>
                {[0, 1, 2, 3].map((j) => (
                  <td key={j} className="od-af-empty" />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <table className="od-grid od-af-table od-af-houses">
          <thead>
            <tr>
              <th colSpan={4} className="l">
                House (For Office Use Only)
              </th>
            </tr>
          </thead>
          <tbody>
            {[0, 2, 4, 6].map((i) => (
              <tr key={i}>
                {OLD_HOUSES.slice(i, i + 2).map((h) => (
                  <Fragment key={h}>
                    <td className="od-af-att">{h}</td>
                    <td className="c" style={{ width: "14mm" }}>
                      <span className="od-af-box" />
                    </td>
                  </Fragment>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <AfBar wide>Section I: Group/Subjects Combinations</AfBar>
        <table className="od-grid od-af-table od-af-groups">
          <thead>
            <tr>
              <th colSpan={2} className="l">
                Please Tick the Relevant Group/ Subjects Combination
              </th>
            </tr>
          </thead>
          <tbody>
            {OLD_GROUPS.map(([program, options]) => (
              <tr key={program}>
                <th scope="row" className="l" style={{ width: "36mm" }}>
                  {program}
                </th>
                <td className="l">
                  <span className="od-af-groupopts">
                    {options.map((o) => (
                      <span key={o} className="inline-flex items-center gap-1.5">
                        <span className="od-af-box od-af-box-sm" />
                        {o}
                      </span>
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
      <article className="mtb-doc mtb-doc-a4 od od-af flex flex-col" style={{ breakBefore: "page" }} aria-label="Blank admission form, page 4">
        {head}
        <AfBar wide>Section J: Declaration by Student</AfBar>
        <table className="od-grid od-af-table">
          <tbody>
            {OLD_DECLARATION.map((d, i) => (
              <tr key={i}>
                <td className="c" style={{ width: "6mm" }}>
                  {i + 1}
                </td>
                <td className="l">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <AfBar>Section K: Signature</AfBar>
        <div className="od-af-signs">
          <span>Student&apos;s Signature</span>
          <span>Parent&apos;s / Guardian&apos;s Signature</span>
        </div>
        <AfBar>Section L: Signature</AfBar>
        <table className="od-grid od-af-table od-af-office">
          <thead>
            <tr>
              <th colSpan={2}>FOR OFFICE USE ONLY</th>
            </tr>
            <tr>
              <th>Action By Accountant</th>
              <th>Action by Office Superintendent</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="od-af-officecell" />
              <td className="od-af-officecell" />
            </tr>
            <tr>
              <td className="l">Signature:</td>
              <td className="l">Signature:</td>
            </tr>
            <tr>
              <th colSpan={2} className="l">
                Remarks by Principal
              </th>
            </tr>
            <tr>
              <td colSpan={2} className="od-af-officecell" />
            </tr>
          </tbody>
        </table>
      </article>
    </>
  );
}

/** The old form's eight houses (Section H, for office use), as Activities › Houses lists them at Khalid Campus. */
const OLD_HOUSES = ["Chand Bibi", "Sir Syed", "Zaib-un-Nisa", "Khawaja Fareed", "Fatima Jinnah", "Iqbal", "Razia Sultana", "Jinnah"];

/** Section I of the old form: the groups and subject combinations a family ticks, by programme. */
const OLD_GROUPS: Array<[string, string[]]> = [
  ["Matric Programs", ["Biology", "Computer Science"]],
  ["Intermediate Program", ["Pre Medical", "ICS (Phy, Math, CS)", "ICS (Stat, Eco, CS)", "General Science", "General Group"]],
  ["Graduate Programs", ["B.Sc. (Zool, Bot, Chem)", "B.Sc. (Math A, Math B, Phy)", "B.Sc. (Stat, Eco, Comp)", "B.A. (Eco, Lib, Persian)", "B.A. (Eco, Psych, Persian)", "B.A. (Psych, Lib, Persian)", "BSCS (4 Years Program)"]],
  ["Masters Programs", ["M.Sc. (Mathematics)", "M.Sc. (Physics)", "M.Sc. (Chemistry)", "M.A. (English)", "MSc"]],
];

/** Section J of the old form, word for word apart from its typing slips. */
const OLD_DECLARATION = [
  "I undertake to abide by all rules and regulations of the college regarding academic, discipline, attendance, conduct and punctuality.",
  "I undertake to accept all the decision of the principal to be final and irrevocable.",
  "I undertake to abide by all the rules/policies of the college and that admission form for the Board/University exam may be withheld if I am unable to clear the send up/Pre-board examination.",
  "I shall maintain my scholarship percentage at which the admission is granted. In case, the Scholarship is cancelled, I shall pay the dues of the remaining term.",
];
