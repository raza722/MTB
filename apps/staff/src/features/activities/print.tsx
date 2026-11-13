import {
  ACTIVITIES_AWARD_STATUS_LABEL,
  ACTIVITIES_EVENT_KIND_LABEL,
  ACTIVITIES_EVENT_STATUS_LABEL,
  ACTIVITIES_ROLE_LABEL,
  type ActivitiesAward,
  type ActivitiesCertificate,
  type ActivitiesCertType,
  type ActivitiesEventDetail,
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
import { campusLabel } from "../../app/shell/campus";
import { ordinal, printedOn, valueShort } from "./shared";

const CITY: Partial<Record<CampusCode, string>> = { KC: "Sadiqabad", HC: "Lahore" };
const campusLine = (c: CampusCode) => `${campusLabel(c)}${CITY[c] ? `, ${CITY[c]}` : ""}`;

export function DocHead({ campus, title, titleUr, sub }: { campus: CampusCode; title: string; titleUr?: string; sub: ReactNode }) {
  return (
    <header className="act-doc-head">
      <div className="flex items-center gap-3">
        <span className="act-seal">MTB</span>
        <div>
          <h1>MTB Schools and Colleges</h1>
          <p>{campusLine(campus)}</p>
        </div>
      </div>
      <div className="act-doc-title">
        <strong>{title}</strong>
        {titleUr && <Urdu size="small">{titleUr}</Urdu>}
        <p>{sub}</p>
      </div>
    </header>
  );
}

// ------------------------------------------------------------------ Certificates (A4 landscape)

const CERT_TITLE: Record<ActivitiesCertType, [string, string]> = {
  MERIT: ["Certificate of merit", "سندِ امتیاز"],
  PARTICIPATION: ["Certificate of participation", "سندِ شرکت"],
  APPRECIATION: ["Certificate of appreciation", "سندِ تحسین"],
  SCHOLARSHIP: ["Scholarship award", "سندِ وظیفہ"],
};

/** One certificate. A reprint (the certificate was printed before) says "Duplicate". */
export function CertificateDoc({ cert, duplicate }: { cert: ActivitiesCertificate; duplicate?: boolean }) {
  const [title, titleUr] = CERT_TITLE[cert.type];
  const inCharge = cert.type === "APPRECIATION" ? "Class teacher" : cert.type === "SCHOLARSHIP" ? "Scholarship committee" : "Teacher in charge";
  return (
    <article className="act-cert" aria-label={`${title}, ${cert.studentName}`}>
      {duplicate && <span className="act-doc-mark">DUPLICATE</span>}
      <div className="act-cert-frame">
        <div className="act-cert-inner">
          <div className="act-cert-school">
            <span className="act-seal">MTB</span>
            <div>
              <h1>MTB Schools and Colleges</h1>
              <p>{campusLine(cert.campus)}</p>
            </div>
          </div>
          <div className="grid justify-items-center gap-1">
            <h2 className="act-cert-title">{title}</h2>
            <Urdu size="title">{titleUr}</Urdu>
          </div>
          <p className="act-cert-body">
            This is to certify that
            <span className="act-cert-name">{cert.studentName}</span>
            {cert.relation} {cert.father}, Class <bdi dir="ltr">{cert.classSection}</bdi>
            {cert.houseName ? `, ${cert.houseName}` : ""}, {cert.wording}
            {cert.role && cert.role !== "PARTICIPANT" && cert.type !== "SCHOLARSHIP" ? ` (${ACTIVITIES_ROLE_LABEL[cert.role]})` : ""}
          </p>
          <div className="act-cert-signs">
            <div>{inCharge}</div>
            <div className="grid justify-items-center border-0" style={{ borderTop: 0 }}>
              {cert.position ? <span className="act-cert-place">{ordinal(cert.position)}</span> : <span className="act-seal">MTB</span>}
            </div>
            <div>Principal</div>
          </div>
          <div className="act-cert-meta">
            <span>
              Certificate no. <bdi dir="ltr">{cert.certNo}</bdi> · Session {formatSession(cert.session)}
            </span>
            <span>
              Issued <bdi dir="ltr">{formatDate(cert.issuedOn)}</bdi>
              {duplicate ? ` · Duplicate printed ${printedOn()}` : ""}
            </span>
          </div>
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

export function MeritListDoc({ test, feeHeads }: { test: ActivitiesTestDetail; feeHeads?: ActivitiesFeeHead[] | undefined }) {
  const rows = test.candidates.filter((c) => c.percent !== null);
  // The suggested award, head by head (the scheme's heads; the admission fee for applicants only).
  const perHead = test.schemeBasis === "PERCENT" && feeHeads !== undefined;
  const headText = (c: (typeof rows)[number], head: ActivitiesFeeHead) =>
    !c.withinSeats || c.suggestedValue === null ? "" : feeHeads!.includes(head) || (head === "ADMISSION" && c.isApplicant) ? `${c.suggestedValue} %` : "0 %";
  return (
    <article className="act-doc" aria-label={`Merit list, ${test.title}`}>
      {test.status === "MARKING" || test.status === "REGISTRATION" ? <span className="act-doc-mark">PROVISIONAL</span> : null}
      <DocHead campus={test.campus} title="Scholarship merit list" titleUr="میرٹ لسٹ" sub={`${test.testNo} · Session ${formatSession(test.session)}`} />
      <p className="m-0 mb-1 font-semibold">{test.title}</p>
      <p className="m-0 mb-3 text-small text-ink-muted">
        {test.source === "EXAM" ? `From the declared result: ${test.examName ?? ""}` : `Test on ${test.date ? formatDate(test.date) : "—"}${test.venue ? `, ${test.venue}` : ""}`} · {test.schemeName} · pass mark {test.passPercent}% ·{" "}
        {test.seats === null ? "every qualifier" : `${test.seats} seats`}
      </p>
      <table>
        <thead>
          <tr>
            <th className="n">Rank</th>
            <th>Name</th>
            <th>Father</th>
            <th>Class</th>
            <th>Student or applicant</th>
            <th>Previous school</th>
            <th className="n">Marks</th>
            <th className="n">%</th>
            <th>Result</th>
            {perHead ? (
              PRINT_HEADS.map(([h, label]) => (
                <th key={h} className="n">
                  {label}
                </th>
              ))
            ) : (
              <th>Award</th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td className="n">{c.rank}</td>
              <td>{c.name}</td>
              <td>{c.father}</td>
              <td>{c.classSection}</td>
              <td>{c.isApplicant ? "Applicant" : "Student"}</td>
              <td>{c.previousSchool ?? (c.isApplicant ? "" : "MTB")}</td>
              <td className="n">
                {c.obtained} / {test.maxMarks}
              </td>
              <td className="n">{c.percent?.toFixed(1)}</td>
              <td>{c.withinSeats ? "Selected" : c.qualifies ? "Waiting list" : "Below pass mark"}</td>
              {perHead ? (
                PRINT_HEADS.map(([h]) => (
                  <td key={h} className="n">
                    {headText(c, h)}
                  </td>
                ))
              ) : (
                <td>{c.withinSeats && c.suggestedValue !== null ? valueShort(test.schemeBasis, c.suggestedValue) : ""}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {test.tiedAtCutOff > 0 && <p className="mt-2 text-small">{test.tiedAtCutOff} extra {test.tiedAtCutOff === 1 ? "candidate is" : "candidates are"} included because of a tie at the cut-off.</p>}
      <div className="act-doc-signs">
        <div>Exam office</div>
        <div>Scholarship committee</div>
        <div>Principal</div>
      </div>
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
 * The sports list (legacy Reports_SportsList): names house by house, then by event and item, with the G.R. number,
 * class, the part played and the place won. Places not given yet print as a blank to fill in by hand on the day.
 * With `idle`, each house ends with its students who took no part, so the list is the full house roster.
 */
export function SportsListDoc({
  campus,
  session,
  title,
  titleUr,
  heading,
  note,
  rows,
  idle = [],
  itemOrder,
  signs = ["Teacher in charge", "House masters", "Principal"],
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
  const students = new Set(rows.map((r) => r.studentId)).size + idle.length;
  return (
    <article className="act-doc" aria-label={`${title}, ${heading}`}>
      <DocHead campus={campus} title={title} titleUr={titleUr} sub={`Session ${formatSession(session)}`} />
      <p className="m-0 mb-1 font-semibold">{heading}</p>
      {note && <p className="m-0 mb-2 text-small text-ink-muted">{note}</p>}
      {houses.length === 0 ? (
        <p className="mt-4">No names for this choice.</p>
      ) : (
        houses.map((house) => {
          const list = byHouse.get(house) ?? [];
          const rest = [...(idleByHouse.get(house) ?? [])].sort((a, b) => a.classSection.localeCompare(b.classSection, undefined, { numeric: true }) || a.name.localeCompare(b.name));
          const took = new Set(list.map((r) => r.studentId)).size;
          const places = placesText(list);
          return (
            <section key={house} className="act-list-house">
              <h2>
                {house}
                <span>
                  {took} {took === 1 ? "student" : "students"} took part
                  {idle.length > 0 ? ` of ${took + rest.length}` : ""}
                  {places ? ` · ${places}` : ""}
                </span>
              </h2>
              <table>
                <thead>
                  <tr>
                    <th className="n" style={{ width: "8mm" }}>
                      #
                    </th>
                    <th style={{ width: "24mm" }}>G.R. no.</th>
                    <th>Name</th>
                    <th>Father</th>
                    <th style={{ width: "15mm" }}>Class</th>
                    <th style={{ width: "26mm" }}>Part played</th>
                    <th style={{ width: "16mm" }}>Place</th>
                  </tr>
                </thead>
                <tbody>
                  {groupsOf(list, itemOrder).map((g) => [
                    <tr key={g.key} className="act-list-sub">
                      <th colSpan={7}>
                        {oneEvent ? g.item : `${g.eventTitle} · ${g.item}`}
                        {!oneEvent && (
                          <span>
                            <bdi dir="ltr">{formatDate(g.eventDate)}</bdi>
                          </span>
                        )}
                      </th>
                    </tr>,
                    ...g.rows.map((r, i) => (
                      <tr key={`${g.key}|${r.studentId}`}>
                        <td className="n">{i + 1}</td>
                        <td>
                          <bdi dir="ltr">{r.studentId}</bdi>
                        </td>
                        <td>{r.name}</td>
                        <td>{r.father}</td>
                        <td>
                          <bdi dir="ltr">{r.classSection}</bdi>
                        </td>
                        <td>{ACTIVITIES_ROLE_LABEL[r.role]}</td>
                        <td>{r.position ? <b>{ordinal(r.position)}</b> : ""}</td>
                      </tr>
                    )),
                  ])}
                  {rest.length > 0 && (
                    <tr className="act-list-sub">
                      <th colSpan={7}>Took no part this session</th>
                    </tr>
                  )}
                  {rest.map((s, i) => (
                    <tr key={`idle|${s.studentId}`}>
                      <td className="n">{i + 1}</td>
                      <td>
                        <bdi dir="ltr">{s.studentId}</bdi>
                      </td>
                      <td>{s.name}</td>
                      <td>{s.father}</td>
                      <td>
                        <bdi dir="ltr">{s.classSection}</bdi>
                      </td>
                      <td />
                      <td />
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })
      )}
      <div className="act-doc-signs">
        {signs.map((s) => (
          <div key={s}>{s}</div>
        ))}
      </div>
      <footer className="act-doc-foot">
        <span>
          Printed <bdi dir="ltr">{printedOn()}</bdi>
        </span>
        <span>
          {students} {students === 1 ? "student" : "students"} · {rows.length} {rows.length === 1 ? "entry" : "entries"}
          {oneEvent ? "" : ` · ${new Set(rows.map((r) => r.eventId)).size} events`}
        </span>
      </footer>
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
