import {
  ACTIVITIES_AWARD_STATUS_LABEL,
  ACTIVITIES_EVENT_KIND_LABEL,
  ACTIVITIES_EVENT_STATUS_LABEL,
  ACTIVITIES_ROLE_LABEL,
  type ActivitiesAward,
  type ActivitiesCertificate,
  type ActivitiesCertType,
  type ActivitiesEventDetail,
  type ActivitiesEventKind,
  type ActivitiesEventSummary,
  type ActivitiesFeeHead,
  type ActivitiesSportsListIdle,
  type ActivitiesSportsListRow,
  type ActivitiesStudentRecord,
  type ActivitiesTestDetail,
  type CampusCode,
} from "@mtb/api";
import { formatDate, formatRs, formatSession } from "@mtb/domain";
import { Urdu } from "@mtb/ui";
import type { ReactNode } from "react";
import { campusPlace, CREST_SRC, Letterhead, SCHOOL_NAME } from "../../app/print/letterhead";
import { ordinal, printedOn, valueShort } from "./shared";
import { StudentPhoto } from "../../app/print/photo";


/**
 * The old letterhead (crest, "MTB-Madrasat-ul-Banat Schools and Colleges, Khalid Campus, Sadikabad") with the title
 * under it. The old printouts had no Urdu title, so `titleUr` is not printed.
 */
export function DocHead({ campus, title, sub }: { campus: CampusCode; title: string; titleUr?: string; sub: ReactNode }) {
  return (
    <header className="act-doc-head">
      <Letterhead campus={campus} title={title} sub={sub} titleCase="as-is" />
    </header>
  );
}

// ------------------------------------------------------------------ Certificates (A4 landscape)

const CERT_TITLE: Record<ActivitiesCertType, string> = {
  MERIT: "Merit Certificate",
  PARTICIPATION: "Participation Certificate",
  APPRECIATION: "Appreciation Certificate",
  SCHOLARSHIP: "Scholarship Award",
};

/**
 * One certificate, laid out as the old merit certificates (A4 portrait, the crest and school name over the campus, the
 * title badge, then the details on ruled lines and the two notes at the foot). The old system had three variants and
 * the certificate picks the matching one:
 *  - sports (a sports event, or a player or captain): "participated in", "and played as … House:", signed by the Incharge Sports;
 *  - drawing (an event named "… drawing …"): "participated in the event of", "He / She was placed :", signed by the
 *    Vice Principal;
 *  - any other: "participated in", "He / She was placed", signed by the Principal only.
 * A reprint (the certificate was printed before) says "Duplicate".
 */
/** `kind`: the event's kind, when known, picks the sports variant for a sports event. */
export function CertificateDoc({ cert, duplicate, kind }: { cert: ActivitiesCertificate; duplicate?: boolean; kind?: ActivitiesEventKind | undefined }) {
  const title = CERT_TITLE[cert.type];
  const sports = kind === "SPORTS" || cert.role === "PLAYER" || cert.role === "CAPTAIN";
  const drawing = !sports && /drawing/i.test(`${cert.eventTitle} ${cert.item ?? ""}`);
  const event = cert.item && !cert.eventTitle.toLowerCase().includes(cert.item.toLowerCase()) ? `${cert.eventTitle} (${cert.item})` : cert.eventTitle;
  const appreciation = cert.type === "APPRECIATION" || cert.type === "SCHOLARSHIP";
  const left = sports ? "INCHARGE SPORTS" : drawing ? "VICE PRINCIPAL" : null;
  const line = (label: ReactNode, value: ReactNode, extra?: ReactNode) => (
    <div className="act-oc-row">
      <span>{label}</span>
      <span className="act-oc-line">{value}</span>
      {extra}
    </div>
  );
  return (
    <article className="act-cert" aria-label={`${title}, ${cert.studentName}`}>
      {duplicate && <span className="act-doc-mark">DUPLICATE</span>}
      <div className="act-oc-frame">
        <div className="act-oc-head">
          <div className="act-oc-school">{SCHOOL_NAME.replace(" and ", " & ")}</div>
          <img src={CREST_SRC} alt="" className="act-oc-crest" />
          <div className="act-oc-campus">{campusPlace(cert.campus).replace(",", "")}</div>
          <div className="act-oc-badge">{title}</div>
        </div>
        <div className="act-oc-body">
          <div className="act-oc-row act-oc-top">
            <b>Certificate No:</b>
            <span className="act-oc-line">
              <bdi dir="ltr">{cert.certNo}</bdi>
            </span>
            <b>Session :</b>
            <span className="act-oc-line">{`${cert.session}-${cert.session + 1}`}</span>
          </div>
          {line("It is certified that Mr/Ms:", cert.studentName)}
          {line("s/d of:", cert.father)}
          {line("Class & Section:", <bdi dir="ltr">{cert.classSection}</bdi>)}
          {appreciation ? line("for :", cert.wording) : line(drawing ? "participated in the event of :" : "participated in :", event)}
          {sports &&
            line(
              "and played as :",
              cert.role ? ACTIVITIES_ROLE_LABEL[cert.role] : "",
              <>
                <span style={{ paddingLeft: "8mm" }}>House:</span>
                <span className="act-oc-line">{cert.houseName ?? ""}</span>
              </>,
            )}
          {!appreciation && line(drawing ? "He / She was placed :" : "He / She was placed", cert.position ? ordinal(cert.position) : "")}
          {!appreciation && <div className="act-oc-row">in the competition.</div>}
        </div>
        <div className="act-oc-signs">
          <div>{left && <span>{left}</span>}</div>
          <div>
            <span>PRINCIPAL</span>
          </div>
        </div>
        <div className="act-oc-notes">
          <div>This certificate:</div>
          <div>* is issued without any alteration/overwriting.</div>
          <div>* may be referred to the issuing authority for verification, if required.</div>
        </div>
        <div className="act-oc-meta">
          Issued <bdi dir="ltr">{formatDate(cert.issuedOn)}</bdi>
          {duplicate ? ` · Duplicate printed ${printedOn()}` : ""}
        </div>
      </div>
    </article>
  );
}
// ------------------------------------------------------------------ Scholarship award letter (A4)

export function AwardLetter({ award, letterNo }: { award: ActivitiesAward; letterNo?: string | undefined }) {
  const fx = award.feeEffect;
  return (
    <article className="act-doc" aria-label={`Award letter, ${award.studentName}`}>
      <DocHead campus={award.campus} title="Scholarship award letter" titleUr="اسکالرشپ کا خط" sub={`Session ${formatSession(award.session)}`} />
      <div className="flex justify-between text-small">
        <span>
          Ref: <bdi dir="ltr">{award.awardNo}</bdi>
          {letterNo ? (
            <>
              {" "}
              · Letter <bdi dir="ltr">{letterNo}</bdi>
            </>
          ) : null}
        </span>
        <span>
          Date: <bdi dir="ltr">{printedOn()}</bdi>
        </span>
      </div>
      <p className="mt-6">To the parent or guardian of</p>
      <p className="m-0 text-[13pt] font-semibold">
        {award.studentName} {award.relation} {award.father}
      </p>
      <p className="m-0">
        Class <bdi dir="ltr">{award.classSection}</bdi> · G.R. <bdi dir="ltr">{award.studentId}</bdi>
      </p>
      <p className="mt-5">
        We are pleased to tell you that the school has awarded <b>{award.studentName}</b> the <b>{award.schemeName.toLowerCase()}</b> for session {formatSession(award.session)}: <b>{award.valueText}</b>, from{" "}
        <bdi dir="ltr">{formatDate(award.effectiveFrom)}</bdi>.
      </p>
      <Urdu as="p" className="mt-2">
        مبارک ہو! آپ کے بچے کو اس تعلیمی سال کے لیے اسکالرشپ دی گئی ہے۔ فیس میں رعایت نیچے دی گئی ہے۔
      </Urdu>
      <table className="mt-4">
        <thead>
          <tr>
            <th>Fee</th>
            <th className="n">Usual amount</th>
            <th className="n">With the scholarship</th>
            <th>Charged</th>
          </tr>
        </thead>
        <tbody>
          {fx.lines.map((l) => (
            <tr key={l.head}>
              <td>{l.label}</td>
              <td className="n">{formatRs(l.before)}</td>
              <td className="n">{formatRs(l.after)}</td>
              <td>{l.per === "month" ? "Every month" : l.per === "year" ? "Once a year" : "Once"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {fx.lines.length ? (
        <p className="mt-3">
          This saves <b>{formatRs(fx.monthly)}</b> a month on tuition and <b>{formatRs(fx.session)}</b> this session ({fx.months} {fx.months === 1 ? "month" : "months"} from the {fx.firstVoucher} voucher).
        </p>
      ) : (
        <p className="mt-3">{fx.note}</p>
      )}
      <p className="mt-3 text-small text-ink-muted">
        The scholarship is reviewed before the next session. It continues while the conditions of the scheme are met; the office will write to you if anything changes. Vouchers already issued are not changed.
      </p>
      <div className="act-doc-signs">
        <div>Prepared by</div>
        <div>Scholarship committee</div>
        <div>Principal</div>
      </div>
      <footer className="act-doc-foot">
        <span>
          Printed <bdi dir="ltr">{printedOn()}</bdi>
        </span>
        <span>{ACTIVITIES_AWARD_STATUS_LABEL[award.status]}</span>
      </footer>
    </article>
  );
}

// ------------------------------------------------------------------ Per-head % (admission, annual charges, tuition)

const PRINT_HEADS: Array<[ActivitiesFeeHead, string]> = [
  ["ADMISSION", "Adm. %"],
  ["ANNUAL", "Annual %"],
  ["TUITION", "Tuition %"],
];

/** "100 %" for a head the award covers, "0 %" for one it doesn't (as the legacy lists print it). */
function awardHeadText(a: ActivitiesAward, head: ActivitiesFeeHead): string {
  if (a.basis === "FIXED") return head === "TUITION" ? `${formatRs(a.value)}/mo` : "0 %";
  if (!a.feeHeads.includes(head) || (head === "ADMISSION" && !a.isApplicant)) return "0 %";
  return `${a.values?.[head] ?? a.value} %`;
}

// ------------------------------------------------------------------ Merit list (A4)

/**
 * The scholarship merit list, laid out as the old "Scholarship List First" (A4 landscape): the letterhead and
 * "Dated:", then Sr. No., Form No., Name, Last Class Marks, Scholarship type, Previous Institute and the
 * "Scholarships" heads (A/C, Annual, TU.FEE). The class and the result (selected, waiting list) the new process needs
 * follow the name and the heads. The old contact number column is not kept for test candidates.
 */
export function MeritListDoc({ test, feeHeads }: { test: ActivitiesTestDetail; feeHeads?: ActivitiesFeeHead[] | undefined }) {
  const rows = test.candidates.filter((c) => c.percent !== null);
  // The suggested award, head by head (the scheme's heads; the admission fee for applicants only).
  const perHead = test.schemeBasis === "PERCENT" && feeHeads !== undefined;
  const headText = (c: (typeof rows)[number], head: ActivitiesFeeHead) =>
    !c.withinSeats || c.suggestedValue === null ? "" : feeHeads!.includes(head) || (head === "ADMISSION" && c.isApplicant) ? `${c.suggestedValue} %` : "0 %";
  const heads: Array<[ActivitiesFeeHead, string]> = [
    ["ADMISSION", "A/C"],
    ["ANNUAL", "Annual"],
    ["TUITION", "TU.FEE"],
  ];
  const dated = (test.date ?? new Date().toISOString().slice(0, 10)).split("-").reverse().join(" - ");
  return (
    <article className="act-doc act-doc-land" aria-label={`Merit list, ${test.title}`}>
      {test.status === "MARKING" || test.status === "REGISTRATION" ? <span className="act-doc-mark">PROVISIONAL</span> : null}
      <DocHead campus={test.campus} title={`Dated:      ${dated}`} sub={`${test.title} · ${test.testNo} · Session ${formatSession(test.session)}`} />
      <p className="m-0 mb-2 text-small text-ink-muted">
        {test.source === "EXAM" ? `From the declared result: ${test.examName ?? ""}` : `Test on ${test.date ? formatDate(test.date) : "—"}${test.venue ? `, ${test.venue}` : ""}`} · {test.schemeName} · pass mark {test.passPercent}% ·{" "}
        {test.seats === null ? "every qualifier" : `${test.seats} seats`}
      </p>
      <table className="act-sl">
        <thead>
          <tr>
            <th colSpan={7} style={{ border: 0 }} />
            <th colSpan={perHead ? 3 : 1}>Scholarships</th>
            <th style={{ border: 0 }} />
          </tr>
          <tr>
            <th style={{ width: "12mm" }}>Sr. No.</th>
            <th style={{ width: "16mm" }}>Form No.</th>
            <th>Name</th>
            <th style={{ width: "22mm" }}>Class</th>
            <th style={{ width: "20mm" }}>Last Class Marks</th>
            <th>Scholarship type</th>
            <th>Previous Institute</th>
            {perHead ? (
              heads.map(([h, label]) => (
                <th key={h} style={{ width: "18mm" }}>
                  {label}
                </th>
              ))
            ) : (
              <th>Award</th>
            )}
            <th style={{ width: "22mm" }}>Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td className="c">{c.rank}</td>
              <td className="c">{c.rollNo}</td>
              <td>{c.name}</td>
              <td>
                {c.classSection}
                {c.isApplicant ? " (applicant)" : ""}
              </td>
              <td className="c">
                {c.obtained} / {test.maxMarks}
              </td>
              <td className="c">{test.schemeName}</td>
              <td>{c.previousSchool ?? (c.isApplicant ? "" : "MTB")}</td>
              {perHead ? (
                heads.map(([h]) => (
                  <td key={h} className="c">
                    {headText(c, h)}
                  </td>
                ))
              ) : (
                <td className="c">{c.withinSeats && c.suggestedValue !== null ? valueShort(test.schemeBasis, c.suggestedValue) : ""}</td>
              )}
              <td>{c.withinSeats ? "Selected" : c.qualifies ? "Waiting list" : "Below pass mark"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {test.tiedAtCutOff > 0 && <p className="mt-2 text-small">{test.tiedAtCutOff} extra {test.tiedAtCutOff === 1 ? "candidate is" : "candidates are"} included because of a tie at the cut-off.</p>}
      <footer className="act-doc-foot">
        <span>
          Printed <bdi dir="ltr">{printedOn()}</bdi>
        </span>
        <span>{rows.length} candidates ranked</span>
      </footer>
    </article>
  );
}

// ------------------------------------------------------------------ Scholarship list (A4 landscape)

export function ScholarshipListDoc({ awards, campus, session, title }: { awards: ActivitiesAward[]; campus: CampusCode; session: number; title: string }) {
  const monthly = awards.filter((a) => a.status === "APPROVED").reduce((s, a) => s + a.feeEffect.monthly, 0);
  return (
    <article className="act-doc act-doc-land" aria-label="Scholarship list">
      <DocHead campus={campus} title="Scholarship list" titleUr="فہرستِ وظائف" sub={`Session ${formatSession(session)}`} />
      <p className="m-0 mb-2 font-semibold">{title}</p>
      <table>
        <thead>
          <tr>
            <th className="n">#</th>
            <th>Award no.</th>
            <th>Student</th>
            <th>Father</th>
            <th>Class</th>
            <th>Scheme</th>
            <th className="n">Merit %</th>
            <th>Previous school</th>
            {PRINT_HEADS.map(([h, label]) => (
              <th key={h} className="n">
                {label}
              </th>
            ))}
            <th className="n">Off a month</th>
            <th>From</th>
            <th>Valid until</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {awards.map((a, i) => {
            return (
              <tr key={a.id}>
                <td className="n">{i + 1}</td>
                <td>{a.awardNo}</td>
                <td>
                  {a.studentName}
                  <br />
                  <span className="text-ink-muted">{a.studentId}</span>
                </td>
                <td>{a.father}</td>
                <td>
                  {a.classSection}
                  {a.isApplicant ? " (applicant)" : ""}
                </td>
                <td>
                  {a.schemeName}
                  {a.listRound ? ` · ${ordinal(a.listRound)} list` : ""}
                </td>
                <td className="n">{a.percent !== undefined ? a.percent.toFixed(1) : a.application?.lastExam ? ((a.application.lastExam.obtained / a.application.lastExam.total) * 100).toFixed(1) : "—"}</td>
                <td>{a.previousSchool ?? ""}</td>
                {PRINT_HEADS.map(([h]) => (
                  <td key={h} className="n">
                    {awardHeadText(a, h)}
                  </td>
                ))}
                <td className="n">{a.feeEffect.lines.length ? formatRs(a.feeEffect.monthly) : "—"}</td>
                <td>{formatDate(a.effectiveFrom)}</td>
                <td>{formatDate(a.endedOn ?? a.effectiveTo)}</td>
                <td>{ACTIVITIES_AWARD_STATUS_LABEL[a.status]}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th colSpan={11}>Approved awards: fee relief each month</th>
            <th className="n">{formatRs(monthly)}</th>
            <th colSpan={3} />
          </tr>
        </tfoot>
      </table>
      <div className="act-doc-signs">
        <div>Accounts office</div>
        <div>Scholarship committee</div>
        <div>Principal</div>
      </div>
      <footer className="act-doc-foot">
        <span>
          Printed <bdi dir="ltr">{printedOn()}</bdi>
        </span>
        <span>{awards.length} awards</span>
      </footer>
    </article>
  );
}

// ------------------------------------------------------------------ Sports list (A4)

const NO_HOUSE = "Not in a house";

/** One event's names as sports-list rows (the event page prints from what it already shows). */
export function eventListRows(ev: ActivitiesEventDetail): ActivitiesSportsListRow[] {
  return ev.participantsList.map((p) => ({
    houseId: p.houseId,
    houseName: p.houseName,
    eventId: ev.id,
    eventTitle: ev.title,
    eventDate: ev.date,
    kind: ev.kind,
    item: p.item,
    studentId: p.studentId,
    name: p.name,
    father: p.father,
    classSection: p.classSection,
    role: p.role,
    position: p.position,
  }));
}

interface ListGroup {
  key: string;
  eventTitle: string;
  eventDate: string;
  item: string;
  rows: ActivitiesSportsListRow[];
}

/** Rows of one house, grouped by event (in date order) and then by item (in the order given, else first seen). */
function groupsOf(rows: ActivitiesSportsListRow[], itemOrder?: string[]): ListGroup[] {
  const map = new Map<string, ListGroup>();
  for (const r of rows) {
    const key = `${r.eventId}|${r.item}`;
    const g = map.get(key) ?? { key, eventTitle: r.eventTitle, eventDate: r.eventDate, item: r.item, rows: [] };
    g.rows.push(r);
    map.set(key, g);
  }
  const seen = [...map.keys()];
  const rank = (g: ListGroup) => (itemOrder?.includes(g.item) ? itemOrder.indexOf(g.item) : 1000 + seen.indexOf(g.key));
  return [...map.values()]
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.eventTitle.localeCompare(b.eventTitle) || rank(a) - rank(b))
    .map((g) => ({ ...g, rows: [...g.rows].sort((a, b) => (a.position ?? 9) - (b.position ?? 9) || a.classSection.localeCompare(b.classSection, undefined, { numeric: true }) || a.name.localeCompare(b.name)) }));
}

const placesText = (rows: ActivitiesSportsListRow[]) =>
  ([1, 2, 3] as const)
    .map((p) => [p, rows.filter((r) => r.position === p).length] as const)
    .filter(([, n]) => n > 0)
    .map(([p, n]) => `${ordinal(p)} × ${n}`)
    .join(" · ");

/**
 * The sports list, laid out as the old Reports_SportsList (A4 landscape): the letterhead and "Sports List", then
 * house by house "House: …" at the left and "Total Students: …" at the right over one table: Sr. #, GR.No, Name,
 * Class, Section, Participated In, Played as, Position. Rows run event by event and item by item; a place not given
 * yet prints blank to fill in by hand. With `idle`, each house ends with its students who took no part, so the list
 * is the full house roster. The old "Interest In Sports", "Contact Number" and "Picture" columns are not kept now.
 */
export function SportsListDoc({
  campus,
  session,
  title,
  heading,
  note,
  rows,
  idle = [],
  itemOrder,
  signs,
}: {
  campus: CampusCode;
  session: number;
  title: string;
  titleUr: string;
  heading: string;
  note?: string;
  rows: ActivitiesSportsListRow[];
  idle?: ActivitiesSportsListIdle[];
  itemOrder?: string[];
  signs?: [string, string, string];
}) {
  const oneEvent = new Set(rows.map((r) => r.eventId)).size <= 1;
  const byHouse = new Map<string, ActivitiesSportsListRow[]>();
  const idleByHouse = new Map<string, ActivitiesSportsListIdle[]>();
  for (const r of rows) byHouse.set(r.houseName ?? NO_HOUSE, [...(byHouse.get(r.houseName ?? NO_HOUSE) ?? []), r]);
  for (const s of idle) idleByHouse.set(s.houseName ?? NO_HOUSE, [...(idleByHouse.get(s.houseName ?? NO_HOUSE) ?? []), s]);
  const houses = [...new Set([...byHouse.keys(), ...idleByHouse.keys()])].sort((a, b) => (a === NO_HOUSE ? 1 : b === NO_HOUSE ? -1 : a.localeCompare(b)));
  // "6-Ubaid" prints as Class "6" and Section "Ubaid", as the old list had them in two columns.
  const split = (cs: string) => {
    const i = cs.indexOf("-");
    return i > 0 ? [cs.slice(0, i), cs.slice(i + 1)] : [cs, ""];
  };
  return (
    <article className="act-doc act-doc-land" aria-label={`${title}, ${heading}`}>
      <DocHead campus={campus} title={title} sub={`${heading} · Session ${formatSession(session)}`} />
      {note && <p className="m-0 mb-2 text-small text-ink-muted">{note}</p>}
      {houses.length === 0 ? (
        <p className="mt-4">No names for this choice.</p>
      ) : (
        houses.map((house) => {
          const list = byHouse.get(house) ?? [];
          const rest = [...(idleByHouse.get(house) ?? [])].sort((a, b) => a.classSection.localeCompare(b.classSection, undefined, { numeric: true }) || a.name.localeCompare(b.name));
          const total = new Set(list.map((r) => r.studentId)).size + rest.length;
          const places = placesText(list);
          let sr = 0;
          return (
            <section key={house} className="act-list-house">
              <div className="act-sl-head">
                <span>
                  <b>House:</b> <span className="act-sl-line">{house}</span>
                </span>
                {places && <span className="act-sl-places">{places}</span>}
                <span>
                  <b>Total Students:</b> <span className="act-sl-line">{total}</span>
                </span>
              </div>
              <table className="act-sl">
                <thead>
                  <tr>
                    <th style={{ width: "12mm" }}>Sr. #</th>
                    <th style={{ width: "24mm" }}>GR.No</th>
                    <th>Name</th>
                    <th style={{ width: "18mm" }}>Class</th>
                    <th style={{ width: "26mm" }}>Section</th>
                    <th>Participated In</th>
                    <th style={{ width: "24mm" }}>Played as</th>
                    <th style={{ width: "18mm" }}>Position</th>
                    <th style={{ width: "11mm" }}>Picture</th>
                  </tr>
                </thead>
                <tbody>
                  {groupsOf(list, itemOrder).flatMap((g) =>
                    g.rows.map((r) => {
                      const [k, sec] = split(r.classSection);
                      return (
                        <tr key={`${g.key}|${r.studentId}`}>
                          <td className="c">{++sr}</td>
                          <td className="c">
                            <bdi dir="ltr">{r.studentId}</bdi>
                          </td>
                          <td>{r.name}</td>
                          <td className="c">{k}</td>
                          <td className="c">{sec}</td>
                          <td className="c">{oneEvent ? g.item : `${g.eventTitle} · ${g.item}`}</td>
                          <td className="c">{ACTIVITIES_ROLE_LABEL[r.role]}</td>
                          <td className="c">{r.position ? ordinal(r.position) : ""}</td>
                          <td className="act-sl-pic">
                            <StudentPhoto grNo={r.studentId} className="act-sl-photo" />
                          </td>
                        </tr>
                      );
                    }),
                  )}
                  {rest.map((s) => {
                    const [k, sec] = split(s.classSection);
                    return (
                      <tr key={`idle|${s.studentId}`}>
                        <td className="c">{++sr}</td>
                        <td className="c">
                          <bdi dir="ltr">{s.studentId}</bdi>
                        </td>
                        <td>{s.name}</td>
                        <td className="c">{k}</td>
                        <td className="c">{sec}</td>
                        <td />
                        <td />
                        <td />
                        <td className="act-sl-pic">
                          <StudentPhoto grNo={s.studentId} className="act-sl-photo" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          );
        })
      )}
      {signs && (
        <div className="act-doc-signs">
          {signs.map((s) => (
            <div key={s}>{s}</div>
          ))}
        </div>
      )}
    </article>
  );
}

// ------------------------------------------------------------------ Events by teacher in charge (A4)

const bare = (n: string) => n.replace(/^(Mr|Ms|Mrs|Dr|Miss)\.?\s+/i, "");

/**
 * The old staff activity log (Staff › Extracurricular Activity): events grouped by the teacher in charge, with the
 * date, time or period, the event and the place. An event with two teachers in charge is listed under each.
 */
export function EventsByTeacherDoc({ campus, session, heading, events, teacher }: { campus: CampusCode; session: number; heading: string; events: ActivitiesEventSummary[]; teacher?: string }) {
  const names = teacher ? [teacher] : [...new Set(events.flatMap((e) => e.inCharge))].sort((a, b) => bare(a).localeCompare(bare(b)));
  const groups = names
    .map((name) => ({ name, list: events.filter((e) => e.inCharge.includes(name)).sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "")) }))
    .filter((g) => g.list.length > 0);
  return (
    <article className="act-doc" aria-label={`Staff activity list, ${heading}`}>
      <DocHead campus={campus} title="Staff activity list" titleUr="اساتذہ کی ہم نصابی ذمہ داریاں" sub={`Session ${formatSession(session)}`} />
      <p className="m-0 mb-1 font-semibold">{heading}</p>
      <p className="m-0 mb-2 text-small text-ink-muted">Events by the teacher in charge. An event with two teachers in charge is listed under each.</p>
      {groups.length === 0 ? (
        <p className="mt-4">No events for this choice.</p>
      ) : (
        groups.map((g) => (
          <section key={g.name} className="act-list-house">
            <h2>
              {g.name}
              <span>
                {g.list.length} {g.list.length === 1 ? "event" : "events"}
              </span>
            </h2>
            <table>
              <thead>
                <tr>
                  <th className="n" style={{ width: "8mm" }}>
                    #
                  </th>
                  <th style={{ width: "26mm" }}>Date</th>
                  <th style={{ width: "26mm" }}>Time / period</th>
                  <th>Event</th>
                  <th style={{ width: "34mm" }}>Place</th>
                  <th style={{ width: "24mm" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {g.list.map((e, i) => (
                  <tr key={e.id}>
                    <td className="n">{i + 1}</td>
                    <td>
                      <bdi dir="ltr">{formatDate(e.date)}</bdi>
                      {e.endDate && e.endDate !== e.date && (
                        <>
                          {" "}
                          to <bdi dir="ltr">{formatDate(e.endDate)}</bdi>
                        </>
                      )}
                    </td>
                    <td>
                      <bdi dir="ltr">{[e.time ?? "", e.period ? `Period ${e.period}` : ""].filter(Boolean).join(" · ") || "—"}</bdi>
                    </td>
                    <td>
                      {e.title}
                      <span className="block text-small text-ink-muted">
                        {ACTIVITIES_EVENT_KIND_LABEL[e.kind]} · {e.forClasses}
                      </span>
                    </td>
                    <td>{e.venue}</td>
                    <td>{ACTIVITIES_EVENT_STATUS_LABEL[e.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}
      <div className="act-doc-signs">
        <div>Teacher in charge</div>
        <div>Activities in charge</div>
        <div>Principal</div>
      </div>
      <footer className="act-doc-foot">
        <span>
          Printed <bdi dir="ltr">{printedOn()}</bdi>
        </span>
        <span>
          {events.length} {events.length === 1 ? "event" : "events"} · {groups.length} {groups.length === 1 ? "teacher" : "teachers"}
        </span>
      </footer>
    </article>
  );
}

// ------------------------------------------------------------------ Co-curricular record (A4)

export function RecordDoc({ record }: { record: ActivitiesStudentRecord }) {
  const p = record.person;
  return (
    <article className="act-doc" aria-label={`Co-curricular record, ${p.name}`}>
      <DocHead campus={p.campus} title="Co-curricular record" titleUr="ہم نصابی سرگرمیوں کا ریکارڈ" sub={`Printed ${printedOn()}`} />
      <dl className="mb-4 grid grid-cols-3 gap-x-6 gap-y-1">
        {[
          ["Name", p.name],
          ["G.R. number", p.id],
          ["Class", p.classSection],
          ["Father", p.father],
          ["House", p.house ?? "—"],
          ["Places won", String(record.totals.places)],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-small text-ink-muted">{k}</dt>
            <dd className="m-0 font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Activity</th>
            <th>Item</th>
            <th>Part played</th>
            <th>Result</th>
            <th>Certificate</th>
          </tr>
        </thead>
        <tbody>
          {record.entries.map((e) => (
            <tr key={e.id}>
              <td>{formatDate(e.date)}</td>
              <td>{e.title}</td>
              <td>{e.item ?? "—"}</td>
              <td>{ACTIVITIES_ROLE_LABEL[e.role]}</td>
              <td>{e.achievement}</td>
              <td>{e.certificateNo ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {record.awards.length > 0 && (
        <>
          <p className="mb-1 mt-4 font-semibold">Scholarships</p>
          <table>
            <tbody>
              {record.awards.map((a) => (
                <tr key={a.id}>
                  <td>{a.awardNo}</td>
                  <td>{a.schemeName}</td>
                  <td>{a.valueText}</td>
                  <td>Session {formatSession(a.session)}</td>
                  <td>{ACTIVITIES_AWARD_STATUS_LABEL[a.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <div className="act-doc-signs">
        <div>Class teacher</div>
        <div>House master</div>
        <div>Principal</div>
      </div>
      <footer className="act-doc-foot">
        <span>
          Printed <bdi dir="ltr">{printedOn()}</bdi>
        </span>
        <span>{record.entries.length} entries</span>
      </footer>
    </article>
  );
}
