import {
  examsAnalyse,
  examsGroupShort,
  examsOfGender,
  examsSits,
  EXAMS_DEFAULT_SCALE,
  EXAMS_RESULT_LABEL,
  EXAMS_RESULT_LABEL_UR,
  type CampusCode,
  type ExamDetail,
  type ExamsGender,
  type ExamsResultRow,
  type ExamsSubject,
} from "@mtb/api";
import { amountInWords, formatDate, formatPercent, formatSession, formatWeekday, pakistanToday } from "@mtb/domain";
import { Urdu } from "@mtb/ui";
import type { CSSProperties, ReactNode } from "react";
import { Letterhead } from "../../../app/print/letterhead";
import { markText, ordinal } from "../shared";

/** Today (Pakistan time) as printed on documents: "07-Nov-2026". */
export const printedOn = () => formatDate(pakistanToday());

/** An English label with its Urdu underneath when Urdu headings are on. */
function L({ en, ur, urdu }: { en: string; ur: string; urdu: boolean | undefined }) {
  if (!urdu) return <>{en}</>;
  return (
    <span className="inline-grid">
      <span>{en}</span>
      <Urdu size="small">{ur}</Urdu>
    </span>
  );
}

/**
 * The old printed heading (shared letterhead): crest, "MTB-Madrasat-ul-Banat Schools and Colleges, Khalid Campus,
 * Sadikabad", the document's title (underlined where the old report underlined it) and an optional line under it.
 */
export function DocHead({ campus, title, titleUr, sub, urdu, underline }: { campus: CampusCode; title: string; titleUr?: string; sub?: ReactNode; urdu?: boolean; underline?: boolean }) {
  return (
    <div className="exams-lh">
      <Letterhead
        campus={campus}
        titleCase="as-is"
        title={
          <>
            <span className={underline ? "exams-u" : undefined}>{title}</span>
            {urdu && titleUr && (
              <>
                {" "}
                <Urdu size="small">{titleUr}</Urdu>
              </>
            )}
          </>
        }
        sub={sub || undefined}
      />
    </div>
  );
}

/** "Label: value" pairs on one line, as the old reports printed them under the title; `under` underlines the values. */
export function Fields({ items, under, style }: { items: Array<[ReactNode, ReactNode] | null | false | "" | undefined>; under?: boolean; style?: CSSProperties }) {
  return (
    <div className="exams-fields" style={style}>
      {items.filter((x): x is [ReactNode, ReactNode] => Boolean(x)).map(([k, v], i) => (
        <span key={i}>
          <b>{k}:</b> <span className={under ? "exams-u" : undefined}>{v}</span>
        </span>
      ))}
    </div>
  );
}

/** A large faint mark across a document whose results are not final. */
function Provisional({ exam }: { exam: ExamDetail }) {
  return exam.status === "DECLARED" ? null : <span className="exams-doc-mark">PROVISIONAL</span>;
}

/** "2026-2027", the old session format. */
export const sessionLong = (y: number) => `${y}-${y + 1}`;

/** "03 - Nov - 2026", the old result card's date format. */
export const spacedDate = (d: string) => formatDate(d).replace(/-/g, " - ");

/** "93.2 %", the old percentage format. */
export const pctText = (p: number | null | undefined, digits = 1) => (p === null || p === undefined ? "" : `${p.toFixed(digits)} %`);

const CLASS_WORD: Record<string, string> = {
  "1": "One",
  "2": "Two",
  "3": "Three",
  "4": "Four",
  "5": "Five",
  "6": "Six",
  "7": "Seven",
  "8": "Eight",
  "9": "Nine",
  "10": "Ten",
  "11": "Eleven",
  "12": "Twelve",
  FY: "First Year",
  SY: "Second Year",
  SEH: "Shoba-e-Hifz",
};

/** The class as the old reports named it: "9" → "Nine". */
export const classWord = (short: string) => CLASS_WORD[short] ?? short;

/** "9-Barni" → class "Nine", section "Barni". A programme test's centre is a section with no class. */
export function splitSection(cs: string, programme?: boolean): { cls: string; sec: string } {
  const i = cs.indexOf("-");
  if (programme || i < 0) return { cls: programme ? "" : classWord(cs), sec: programme ? cs : "" };
  return { cls: classWord(cs.slice(0, i)), sec: cs.slice(i + 1) };
}

/** "Nine - Barni" (the old "Class & Section"). */
export const classAndSection = (cs: string, programme?: boolean) => {
  const { cls, sec } = splitSection(cs, programme);
  return [cls, sec].filter(Boolean).join(" - ");
};

/** The exam's class in words ("Nine"), from its first section. */
const examClass = (exam: ExamDetail) => (exam.programmeId ? "" : splitSection(exam.classes[0] ?? "").cls);

/** "Four Hundred Twenty Nine" (marks, not rupees); half marks end in "and a half". */
export function marksInWords(n: number): string {
  const whole = Math.floor(n);
  const words = amountInWords(whole).replace(/^Rupees /, "").replace(/ Only$/, "");
  return n - whole >= 0.5 ? `${words} and a half` : words;
}

/** Rows of one group, or everyone ("ALL"). */
export const inGroup = (group: string | undefined) => (r: ExamsResultRow) => !group || group === "ALL" || r.group === group;

/** "Boys", "Girls" or "" for the document's sub-title. */
export const genderText = (g: ExamsGender | undefined) => (g === "M" ? "Boys" : g === "F" ? "Girls" : "");

/** "Session 2026–27" for document sub-titles. */
const sessionOf = (exam: ExamDetail) => `Session ${formatSession(exam.session)}`;

/** The class's sections as printed: "Class 7" for several, or the one section. */
const classText = (exam: ExamDetail, section: string) => (section === "ALL" ? exam.classes.join(", ") : section);

/** " · Boys" style sub-title parts, skipping the empty ones. */
const subParts = (...parts: Array<string | undefined | false>) => parts.filter(Boolean).join(" · ");

/** Dense positions by % among the given rows only (equal % share a position), per section or across them all. */
export function rerank(rows: ExamsResultRow[], perSection: boolean): Map<string, number> {
  const out = new Map<string, number>();
  const groups = new Map<string, ExamsResultRow[]>();
  for (const r of rows) {
    if (r.percent === null || r.withheld) continue;
    const k = perSection ? r.classSection : "ALL";
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const list of groups.values()) {
    let rank = 0;
    let last: number | null = null;
    for (const r of [...list].sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0))) {
      if (r.percent !== last) {
        rank++;
        last = r.percent;
      }
      out.set(r.id, rank);
    }
  }
  return out;
}

/** "04-Nov" from an ISO date. */
const dayMonth = (d: string | undefined) => (d ? formatDate(d).slice(0, 6) : "");

/** The month of the exam's first paper ("September"), as the old position tables printed it. */
const examMonth = (exam: ExamDetail) => {
  const d = exam.subjects.map((s) => s.date).filter(Boolean).sort()[0] ?? exam.startDate;
  return d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleString("en-US", { month: "long" }) : "";
};

/** A mark as printed on sheets: the number, A, L, or blank. */
const sheetMark = (m: ExamsResultRow["marks"][string] | undefined) => (m === null || m === undefined ? "" : String(m));

/** A blank line to write on. */
const Fill = ({ w = "24mm" }: { w?: string }) => <span className="exams-fill" style={{ minWidth: w }} />;

// ------------------------------------------------------------------ Result card: the old "Result Intimation Sheet"

/**
 * The old result card ("Result Intimation Sheet"): a boxed card with Exam / Session / Date, Name / Father / Gr. No and
 * Class / Section / Group, the subjects with marks obtained and maximum, the total, %age and grade, position and the
 * class strength, the remarks and two signature lines. One a page (the old "primary" card) or two side by side on a
 * landscape page (the old "with column" card).
 */
export function ResultCard({ exam, row, urdu, half }: { exam: ExamDetail; row: ExamsResultRow; urdu?: boolean; half?: boolean }) {
  const card = <CardBox exam={exam} row={row} urdu={urdu} />;
  if (half) return card;
  return (
    <article className="exams-doc exams-doc-a4 exams-card-page" aria-label={`Result card, ${row.name}`}>
      {card}
    </article>
  );
}

function CardBox({ exam, row, urdu }: { exam: ExamDetail; row: ExamsResultRow; urdu?: boolean }) {
  const bands = exam.bands ?? EXAMS_DEFAULT_SCALE;
  const strength = exam.rows.filter((r) => r.classSection === row.classSection).length;
  const failedNames = (row.failedSubjects ?? []).map((id) => exam.subjects.find((s) => s.id === id)?.name ?? id).sort((a, b) => a.localeCompare(b));
  // Only the papers of the student's group (classes 9–10).
  const papers = exam.subjects.filter((s) => examsSits(s, row.group));
  const declared = exam.status === "DECLARED";
  const mark = row.withheld ? "WITHHELD" : declared ? null : "PROVISIONAL";
  const remark = row.withheld
    ? `Result withheld: ${row.withheld}`
    : row.result === "PASS"
      ? `Passed. ${bands.find((b) => b.grade === row.grade)?.remark ?? ""}`.trim()
      : row.result === "INCOMPLETE"
        ? "Some marks are not entered yet."
        : `${row.result === "SUPPLY" ? EXAMS_RESULT_LABEL.SUPPLY : "Failed"}. ${failedNames.join(",")}`;
  const { cls, sec } = splitSection(row.classSection, Boolean(exam.programmeId));
  const date = exam.declaredOn ? spacedDate(exam.declaredOn) : spacedDate(pakistanToday());
  const info: Array<[ReactNode, ReactNode]> = [
    [<L key="e" en="Exam" ur="امتحان" urdu={urdu} />, exam.name],
    [<L key="s" en="Session" ur="سیشن" urdu={urdu} />, sessionLong(exam.session)],
    [<L key="d" en="Date" ur="تاریخ" urdu={urdu} />, date],
    [<L key="n" en="Name" ur="نام" urdu={urdu} />, row.name],
    [<L key="f" en="Father" ur="ولدیت" urdu={urdu} />, row.father ?? ""],
    [<L key="g" en="Gr. No" ur="جی آر نمبر" urdu={urdu} />, row.id],
    [<L key="c" en="Class" ur="جماعت" urdu={urdu} />, cls],
    [<L key="x" en="Section" ur="سیکشن" urdu={urdu} />, sec],
    [<L key="gp" en="Group" ur="گروپ" urdu={urdu} />, row.group ?? ""],
  ];
  return (
    <div className="exams-card" aria-label={`Result card, ${row.name}`}>
      {mark && <span className="exams-doc-mark">{mark}</span>}
      <DocHead campus={exam.campus} title="Result Intimation Sheet" titleUr="نتیجہ کارڈ" urdu={urdu} />
      <div className="exams-card-info">
        {[0, 3, 6].map((start) => (
          <div key={start} className="exams-card-line">
            {info.slice(start, start + 3).map(([k, v], i) => (
              <div key={i}>
                <b>{k} :</b>
                <span>{v}</span>
              </div>
            ))}
          </div>
        ))}
        {row.boardRollNo && (
          <div className="exams-card-line">
            <div>
              <b>
                <L en="Board roll no." ur="بورڈ رول نمبر" urdu={urdu} /> :
              </b>
              <span>{row.boardRollNo}</span>
            </div>
          </div>
        )}
      </div>
      <table className="exams-card-marks">
        <colgroup>
          <col style={{ width: "21mm" }} />
          <col style={{ width: "21mm" }} />
          <col style={{ width: "22mm" }} />
          <col style={{ width: "24mm" }} />
        </colgroup>
        <thead>
          <tr>
            <th colSpan={2} className="c">
              <L en="Subject" ur="مضمون" urdu={urdu} />
            </th>
            <th className="c">
              <L en="Marks Obtained" ur="حاصل کردہ" urdu={urdu} />
            </th>
            <th className="c">
              <L en="Max. Marks" ur="کل نمبر" urdu={urdu} />
            </th>
          </tr>
        </thead>
        <tbody>
          {papers.map((s) => {
            const m = row.marks[s.id];
            return (
              <tr key={s.id}>
                <td colSpan={2}>
                  {s.name}
                  {urdu && s.nameUrdu ? (
                    <>
                      {" "}
                      · <Urdu size="small">{s.nameUrdu}</Urdu>
                    </>
                  ) : null}
                </td>
                <td className="c">{m === null || m === undefined ? "" : markText(m)}</td>
                <td className="c">{s.maxMarks}</td>
              </tr>
            );
          })}
          <tr className="exams-card-gap">
            <td colSpan={4} />
          </tr>
          <tr>
            <th colSpan={2} className="c">
              <L en="Total Marks" ur="میزان" urdu={urdu} />
            </th>
            <td className="c">{row.obtained}</td>
            <td className="c">{row.max}</td>
          </tr>
          <tr>
            <th className="n">
              <L en="%age" ur="فیصد" urdu={urdu} /> :
            </th>
            <td className="c">{row.percent === null || row.withheld ? "" : pctText(row.percent)}</td>
            <th className="n">
              <L en="Grade" ur="گریڈ" urdu={urdu} /> :
            </th>
            <td className="c">{row.withheld ? "" : (row.grade ?? "")}</td>
          </tr>
          <tr>
            <th className="n">
              <L en="Position" ur="پوزیشن" urdu={urdu} />:
            </th>
            <td className="c">{row.position && !row.withheld && row.result === "PASS" ? ordinal(row.position) : ""}</td>
            <th className="n">
              <L en="Class Total" ur="کل طلبہ" urdu={urdu} />:
            </th>
            <td className="c">{strength}</td>
          </tr>
        </tbody>
      </table>
      <div className="exams-card-remarks">
        <b>
          <L en="Remarks" ur="کیفیت" urdu={urdu} />
        </b>
        <span>
          {remark}
          {urdu && row.result ? (
            <>
              {" "}
              <Urdu size="small">{EXAMS_RESULT_LABEL_UR[row.result]}</Urdu>
            </>
          ) : null}
        </span>
      </div>
      {row.teacherRemark && (
        <div className="exams-card-remarks">
          <b>
            <L en="Teacher's remarks" ur="استاد کے تاثرات" urdu={urdu} />
          </b>
          <span>{row.teacherRemark}</span>
        </div>
      )}
      <div className="exams-card-signs">
        <span>
          <b>
            <L en="Controller/Superintendent" ur="ناظم امتحانات" urdu={urdu} /> :
          </b>
          <i />
        </span>
        <span>
          <b>
            <L en="Principal" ur="پرنسپل" urdu={urdu} /> :
          </b>
          <i />
        </span>
      </div>
    </div>
  );
}

/** Two cards side by side on each landscape A4 sheet (the old "Result Card Primery With Column"). */
export function HalfCards({ exam, rows, urdu }: { exam: ExamDetail; rows: ExamsResultRow[]; urdu?: boolean }) {
  const pairs: ExamsResultRow[][] = [];
  for (let i = 0; i < rows.length; i += 2) pairs.push(rows.slice(i, i + 2));
  return (
    <>
      {pairs.map((p) => (
        <article key={p[0]!.id} className="exams-doc exams-doc-land exams-card-pair" aria-label="Result cards, two a page">
          {p.map((r) => (
            <ResultCard key={r.id} exam={exam} row={r} urdu={urdu} half />
          ))}
        </article>
      ))}
    </>
  );
}

// ------------------------------------------------------------------ Master (tabulation) sheet, A4 landscape

/** Who a master sheet lists: everyone, re-sit (supply) holders only, or failed students only. */
export type MasterWho = "resit" | "failed";

/**
 * The old class master sheet / supply holder sheet: "Master Sheet For Session 2026-2027", Class / Section / Exam,
 * then Sr.#, G.R.No, Student Name, (Section), Grp, one column per subject with the heading turned on its side, a
 * Max. Marks row, Obt., %, Grd, Pos and Failed Subjects.
 */
export function MasterSheet({
  exam,
  section,
  group,
  gender,
  contact,
  who,
  order,
}: {
  exam: ExamDetail;
  section: string;
  group?: string;
  gender?: ExamsGender;
  /** Adds the guardian's mobile as a Contact column. */
  contact?: boolean;
  who?: MasterWho;
  /** "position": highest % first, like the old class master sheet. */
  order?: "position";
}) {
  const rows = exam.rows
    .filter((r) => (section === "ALL" || r.classSection === section) && inGroup(group)(r) && examsOfGender(gender)(r) && (who === "resit" ? r.result === "SUPPLY" : who === "failed" ? r.result === "FAIL" : true))
    .sort((a, b) => (order === "position" ? (b.percent ?? -1) - (a.percent ?? -1) || a.name.localeCompare(b.name) : a.classSection.localeCompare(b.classSection) || a.rollNo - b.rollNo));
  const grouped = Boolean(exam.groups?.length);
  const board = exam.category === "BOARD" && rows.some((r) => r.boardRollNo);
  const all = section === "ALL";
  // With groups, each student's total is out of their own papers.
  const maxes = new Set(rows.map((r) => r.max));
  // Each subject's average and average % over the students listed who sit it.
  const stats = examsAnalyse({ ...exam, rows }, "ALL").subjects;
  const subjectName = (id: string) => exam.subjects.find((s) => s.id === id)?.name ?? id;
  const lead = 3 + (board ? 1 : 0) + (all ? 1 : 0) + (grouped ? 1 : 0);
  const trail = 5 + (contact ? 1 : 0);
  const title = who === "resit" ? "Supply Holder Sheet" : who === "failed" ? "Failed Students Master Sheet" : "Master Sheet";
  const programme = Boolean(exam.programmeId);
  const { cls, sec } = splitSection(all ? (exam.classes[0] ?? "") : section, programme);
  return (
    <article className="exams-doc exams-doc-land exams-master" aria-label={title}>
      <Provisional exam={exam} />
      <DocHead campus={exam.campus} title={`${title} For Session ${sessionLong(exam.session)}`} underline />
      <Fields
        under
        items={[
          !programme && ["Class", cls],
          (!all || programme) && [programme ? "Centre" : "Section", all ? "All" : sec],
          ["Exam", exam.name],
          group && group !== "ALL" && ["Group", group],
          gender && ["Gender", genderText(gender)],
        ]}
      />
      <table>
        <thead>
          <tr>
            <th className="c">Sr.#</th>
            <th className="c">G.R.No</th>
            {board && <th className="c">Board Roll No</th>}
            <th className="c" style={{ width: "36mm" }}>
              Student Name
            </th>
            {all && <th className="c">{programme ? "Centre" : "Section"}</th>}
            {grouped && (
              <th className="c">
                <span className="exams-vert">Grp</span>
              </th>
            )}
            {exam.subjects.map((s) => (
              <th key={s.id} className="c exams-vert-th">
                <span className="exams-vert">{s.name}</span>
              </th>
            ))}
            {["Obt.", "%", "Grd", "Pos"].map((t) => (
              <th key={t} className="c">
                <span className="exams-vert">{t}</span>
              </th>
            ))}
            <th className="c" style={{ width: "42mm" }}>
              Failed Subjects
            </th>
            {contact && <th className="c">Contact</th>}
          </tr>
          <tr>
            <th colSpan={lead} className="n">
              Max. Marks:
            </th>
            {exam.subjects.map((s) => (
              <th key={s.id} className="c">
                {s.maxMarks}
              </th>
            ))}
            <th className="c">{maxes.size === 1 ? [...maxes][0] : ""}</th>
            <th colSpan={trail - 1} />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={lead + exam.subjects.length + trail}>{who === "resit" ? "No student has a re-sit." : who === "failed" ? "No student failed." : "No students."}</td>
            </tr>
          )}
          {rows.map((r, i) => (
            <tr key={r.id}>
              <td className="c">{order === "position" || all || !r.rollNo ? i + 1 : r.rollNo}</td>
              <td>{r.id}</td>
              {board && <td>{r.boardRollNo ?? ""}</td>}
              <td>{r.name}</td>
              {all && <td className="c">{splitSection(r.classSection, programme).sec || r.classSection}</td>}
              {grouped && <td className="c">{examsGroupShort(r.group)}</td>}
              {exam.subjects.map((s) => {
                // A paper outside the student's group prints blank (not taken, not failed).
                if (!examsSits(s, r.group)) return <td key={s.id} className="c" />;
                return (
                  <td key={s.id} className="c">
                    {sheetMark(r.marks[s.id])}
                  </td>
                );
              })}
              <td className="c">{r.obtained}</td>
              <td className="c">{pctText(r.percent)}</td>
              <td className="c">{r.withheld ? "" : (r.grade ?? "")}</td>
              <td className="c">{r.withheld ? "" : (all ? r.classPosition : r.position) ? ordinal((all ? r.classPosition : r.position)!) : ""}</td>
              <td className="wrap">{(r.failedSubjects ?? []).map(subjectName).join(",")}</td>
              {contact && <td className="c">{r.guardianMobile ?? ""}</td>}
            </tr>
          ))}
          {rows.length > 0 && (
            <>
              <tr className="exams-nob">
                <th colSpan={lead} className="n">
                  Average
                </th>
                {stats.map((s) => (
                  <td key={s.subjectId} className="c">
                    {s.average === null ? "" : Math.round(s.average)}
                  </td>
                ))}
                <td colSpan={trail} />
              </tr>
              <tr className="exams-nob">
                <th colSpan={lead} className="n">
                  %Age:
                </th>
                {stats.map((s) => (
                  <td key={s.subjectId} className="c">
                    {s.averagePercent === null ? "" : Math.round(s.averagePercent)}
                  </td>
                ))}
                <td colSpan={trail} />
              </tr>
            </>
          )}
        </tbody>
      </table>
    </article>
  );
}

// ------------------------------------------------------------------ Position tables (the old "Top Three / Top Ten Positions")

export interface PositionRow {
  id: string;
  name: string;
  /** Section (class-wise table) or school. */
  section?: string;
  /** Previous school (Diamond Minds). */
  school?: string;
  group?: string;
  obtained: number | null;
  max: number;
  percent: number | null;
  position: number | null;
}

/**
 * The old position table: the heading line (Session / Exam / Class / Month), a ruled column header, then either one
 * boxed list (class-wise) or an "Exam Title" box and a "Section :" box over each section's rows (section-wise).
 */
export function PositionTable({
  fields,
  blocks,
  examTitle,
  showSection,
  showSchool,
  sectionLabel = "Section",
}: {
  fields: Array<[ReactNode, ReactNode] | null | false | "" | undefined>;
  blocks: Array<{ section: string; rows: PositionRow[] }>;
  /** Section-wise: the "Exam Title" box over the sections. */
  examTitle?: string;
  showSection?: boolean;
  showSchool?: boolean;
  sectionLabel?: string;
}) {
  const grouped = blocks.some((b) => b.rows.some((r) => r.group));
  const cols = 5 + (showSection ? 1 : 0) + (showSchool ? 1 : 0) + (grouped ? 1 : 0);
  const sectionWise = blocks.length > 1 || Boolean(blocks[0]?.section);
  const tag = (label: string, value: string, key: string) => (
    <tr key={key} className="exams-pos-tag">
      <th>{label}</th>
      <td className="c">
        <b className="exams-u">{value}</b>
      </td>
      <td colSpan={cols - 2} className="exams-nob" />
    </tr>
  );
  const gap = (key: string) => (
    <tr key={key} className="exams-pos-gap">
      <td colSpan={cols} />
    </tr>
  );
  return (
    <>
      <Fields items={fields} style={{ justifyContent: "space-between" }} />
      <table className="exams-pos">
        <thead>
          <tr>
            <th className="c">G.R.No</th>
            <th className="c">Student Name</th>
            {showSection && <th className="c">{sectionLabel}</th>}
            {showSchool && <th className="c">Previous School Name</th>}
            {grouped && <th className="c">Group</th>}
            <th className="c">Marks</th>
            <th className="c">%Age</th>
            <th className="c">Position</th>
          </tr>
        </thead>
        <tbody>
          {gap("top")}
          {examTitle && sectionWise && [tag("Exam Title", examTitle, "exam"), gap("exam-gap")]}
          {blocks.flatMap((b) => [
            ...(sectionWise && b.section ? [tag("Section :", b.section, `s-${b.section}`), gap(`g-${b.section}`)] : []),
            ...(b.rows.length === 0
              ? [
                  <tr key={`e-${b.section}`}>
                    <td colSpan={cols}>No complete results.</td>
                  </tr>,
                ]
              : b.rows.map((r) => (
                  <tr key={`${b.section}-${r.id}`}>
                    <td className="c nw">{r.id}</td>
                    <td>{r.name}</td>
                    {showSection && <td>{r.section ?? ""}</td>}
                    {showSchool && <td className="c">{r.school ?? ""}</td>}
                    {grouped && <td className="c">{r.group ?? ""}</td>}
                    <td className="c nw">{r.max ? `${r.obtained ?? 0} / ${r.max}` : ""}</td>
                    <td className="c nw">{pctText(r.percent)}</td>
                    <td className="c">{r.position ? ordinal(r.position) : ""}</td>
                  </tr>
                ))),
            gap(`after-${b.section}`),
          ])}
        </tbody>
      </table>
    </>
  );
}

const topWord = (n: number) => (n === 3 ? "Three" : n === 5 ? "Five" : n === 10 ? "Ten" : n === 20 ? "Twenty" : String(n));

export function PositionList({
  exam,
  section,
  top,
  group,
  gender,
  rerankOn,
  perSection,
}: {
  exam: ExamDetail;
  section: string;
  top: number;
  group?: string;
  gender?: ExamsGender;
  /** Positions among the boys (or girls) listed only, instead of the exam's positions. */
  rerankOn?: boolean;
  /** One block per section, each with its own top N by section position. */
  perSection?: boolean;
}) {
  const programme = Boolean(exam.programmeId);
  const base = exam.rows
    .filter((r) => (section === "ALL" || r.classSection === section) && r.percent !== null && !r.withheld && inGroup(group)(r) && examsOfGender(gender)(r))
    .sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0) || a.name.localeCompare(b.name));
  const bySection = Boolean(perSection) || section !== "ALL";
  const ranks = rerankOn && gender ? rerank(base, bySection) : null;
  const pos = (r: ExamsResultRow) => ranks?.get(r.id) ?? (bySection ? r.position : r.classPosition) ?? 0;
  // Top N students, keeping everyone tied at the cut-off.
  const cut = (list: ExamsResultRow[]) => {
    const cutRank = top > 0 && list[top - 1] ? pos(list[top - 1]!) : Infinity;
    return top > 0 ? list.filter((r, i) => i < top || pos(r) === cutRank) : list;
  };
  const toRow = (r: ExamsResultRow): PositionRow => ({
    id: r.id,
    name: r.name,
    section: splitSection(r.classSection, programme).sec || r.classSection,
    group: r.group ? examsGroupShort(r.group) : undefined,
    obtained: r.obtained,
    max: r.max,
    percent: r.percent,
    position: pos(r),
  });
  // Section-wise, like the old "top three positions" table: positions 1 to N of each section (ties share a position).
  const blocks = perSection
    ? (section === "ALL" ? exam.classes : [section]).map((cs) => ({
        section: splitSection(cs, programme).sec || cs,
        rows: base
          .filter((r) => r.classSection === cs && (top <= 0 || pos(r) <= top))
          .sort((a, b) => pos(a) - pos(b) || a.name.localeCompare(b.name))
          .map(toRow),
      }))
    : [{ section: "", rows: cut(base).map(toRow) }];
  const title = top > 0 ? `Top ${topWord(top)} Positions (${perSection ? "Section-Wise" : section === "ALL" ? "Class-Wise" : "Section-Wise"})` : `Position List (${section === "ALL" && !perSection ? "Class-Wise" : "Section-Wise"})`;
  return (
    <article className="exams-doc exams-doc-a4" aria-label="Position list">
      <Provisional exam={exam} />
      <DocHead campus={exam.campus} title={title} underline />
      <PositionTable
        fields={[
          ["Session", <b key="s">{sessionLong(exam.session)}</b>],
          !perSection && ["Exam", <b key="e">{exam.name}</b>],
          !programme && ["Class", <b key="c">{examClass(exam)}</b>],
          section !== "ALL" && !perSection && ["Section", <b key="x">{splitSection(section, programme).sec}</b>],
          group && group !== "ALL" && ["Group", <b key="g">{group}</b>],
          gender && ["Gender", <b key="gn">{genderText(gender)}</b>],
          ["Month", <b key="m">{examMonth(exam)}</b>],
        ]}
        blocks={blocks}
        examTitle={perSection ? exam.name : undefined}
        showSection={!perSection && section === "ALL"}
        sectionLabel={programme ? "Centre" : "Section"}
      />
      {ranks && <p className="exams-doc-key">Positions are among the {genderText(gender).toLowerCase()} listed only.</p>}
    </article>
  );
}

// ------------------------------------------------------------------ Award list (script marking list)

/** Columns of the award list: what the teacher fills in. */
export type AwardCols = "marks" | "sign" | "split" | "monthly";

export const AWARD_COLS: Array<{ value: AwardCols; label: string }> = [
  { value: "marks", label: "Signature, marks and remarks" },
  { value: "sign", label: "Signature and obtained" },
  { value: "split", label: "Signature, subjective, objective, total (term/semester)" },
  { value: "monthly", label: "Monthly sheet: date columns, total, average" },
];

interface AwardProps {
  exam: ExamDetail;
  section: string;
  /** null prints a blank header: date, subject and maximum marks are left for the teacher. */
  subject: ExamsSubject | null;
  teacher: string | null;
  gender?: ExamsGender | undefined;
  cols?: AwardCols | undefined;
  /** Monthly sheet: how many date columns (3–6). */
  dates?: number | undefined;
}

/** "__/__/__" or the paper's date. */
const DateBlank = ({ subject }: { subject: ExamsSubject | null }) => (subject?.date ? <>{formatDate(subject.date)}</> : <>____/____/____</>);

/** The old award list footer: Present / Absent, Blank Sheets / Answer Sheets, Invigilator / Checker, Rechecker, HOD Sign. */
function Tally({ subject, compact }: { subject: ExamsSubject | null; compact?: boolean }) {
  const line = (label: string, value?: ReactNode) => (
    <span>
      <b>{label}</b>
      {value ? <span className="exams-u">{value}</span> : <Fill w={compact ? "26mm" : "32mm"} />}
    </span>
  );
  return (
    <div className={compact ? "exams-tally exams-tally-compact" : "exams-tally"}>
      {line("Present:")}
      {line("Absent:")}
      {line("Blank Sheets:")}
      {line("Answer Sheets:")}
      {line("Invigilator:", subject?.supervisor)}
      {line("Checker:")}
      <span />
      {line("Rechecker:")}
      <span />
      {line("HOD Sign:")}
    </div>
  );
}

/** Award (script marking) list for one section and paper: the teacher's copy to mark against. */
export function AwardList(props: AwardProps) {
  return (
    <article className="exams-doc exams-doc-a4" aria-label="Award list">
      <AwardBody {...props} />
    </article>
  );
}

/** Two copies of the same list side by side on one A4 sheet (the old section-wise "Script Marking List"). */
export function AwardPair(props: AwardProps) {
  return (
    <article className="exams-doc exams-doc-a4 exams-award-pair" aria-label="Award list, two copies">
      <AwardBody {...props} cols="sign" compact />
      <AwardBody {...props} cols="sign" compact />
    </article>
  );
}

function AwardBody({ exam, section, subject, gender, cols = "marks", dates = 5, compact }: AwardProps & { compact?: boolean }) {
  // Only the students whose group sits this paper (everyone when the paper is left blank).
  const rows = exam.rows.filter((r) => r.classSection === section && (!subject || examsSits(subject, r.group)) && examsOfGender(gender)(r)).sort((a, b) => a.rollNo - b.rollNo);
  const grouped = Boolean(exam.groups?.length);
  const monthly = cols === "monthly";
  const nDates = Math.min(6, Math.max(3, dates));
  const programme = Boolean(exam.programmeId);
  const { cls, sec } = splitSection(section, programme);
  const secText = [sec || section, genderText(gender)].filter(Boolean).join(" ");
  const subjectText = subject ? `${subject.name}${subject.groups?.length ? ` (${subject.groups.join(", ")})` : ""}` : <Fill w="22mm" />;
  const maxText = subject ? subject.maxMarks : <Fill w="14mm" />;

  if (compact)
    return (
      <div className="exams-award-copy">
        <div className="exams-award-title">Script Marking List</div>
        <div className="exams-award-grid">
          <span>
            <b>Exam:</b> {exam.name}
          </span>
          <span>
            <b>Session:</b> {sessionLong(exam.session)}
          </span>
          <span>
            <b>Class:</b> {cls}
          </span>
          <span>
            <b>Section:</b> {secText}
          </span>
          <span />
          <span>
            <b>Total Students:</b> {rows.length}
          </span>
        </div>
        <div className="exams-award-line">
          <span>
            <b>Date:</b> <DateBlank subject={subject} />
          </span>
          <span>
            <b>Subject:</b> {subjectText}
          </span>
          <span>
            <b>Max Marks:</b> {maxText}
          </span>
        </div>
        <table>
          <thead>
            <tr>
              <th className="c">Sr#</th>
              <th className="c">Student Name</th>
              {grouped && <th className="c">Group</th>}
              <th className="c" style={{ width: "19mm" }}>
                Sign.
              </th>
              <th className="c" style={{ width: "10mm" }}>
                Obt.
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td className="c">{i + 1}</td>
                <td>
                  {r.id} - {r.name}
                </td>
                {grouped && <td>{examsGroupShort(r.group)}</td>}
                <td />
                <td />
              </tr>
            ))}
          </tbody>
        </table>
        <Tally subject={subject} compact />
      </div>
    );

  return (
    <div className="exams-award-doc">
      <DocHead campus={exam.campus} title={monthly ? "Monthly Script Marking List" : "Script Marking List"} />
      {monthly ? (
        <div className="exams-award-info">
          <Fields under items={[["Exam", exam.name]]} style={{ justifyContent: "center" }} />
          <Fields items={[["Class", cls], ["Section", secText], ["Total Students", rows.length]]} style={{ justifyContent: "center" }} />
          <Fields items={[["Month", subject?.date ? new Date(`${subject.date}T00:00:00`).toLocaleString("en-US", { month: "long" }) : <Fill key="m" w="26mm" />], ["Subject", subjectText], ["Max Marks", maxText]]} style={{ justifyContent: "center" }} />
        </div>
      ) : (
        <div className="exams-award-info">
          <Fields under items={[["Exam", exam.name], ["Session", sessionLong(exam.session)]]} />
          <Fields under items={[["Class", cls], ["Section", secText]]} />
          <Fields under items={[["Total Students", rows.length]]} />
          <Fields items={[["Date", <DateBlank key="d" subject={subject} />], ["Subject", subjectText], ["Max Marks", maxText]]} />
        </div>
      )}
      <table className="exams-award">
        <thead>
          <tr>
            {!monthly && <th className="c">Sr #</th>}
            <th className="c">GR No.</th>
            <th className="c">Student Name</th>
            {grouped && <th className="c">{monthly ? "G" : "Group"}</th>}
            {!monthly && (
              <th className="c" style={{ width: "24mm" }}>
                Sign.
              </th>
            )}
            {cols === "marks" && (
              <>
                <th className="c" style={{ width: "20mm" }}>
                  Marks
                </th>
                <th className="c" style={{ width: "26mm" }}>
                  Remarks
                </th>
              </>
            )}
            {cols === "sign" && (
              <th className="c" style={{ width: "20mm" }}>
                Obt.
              </th>
            )}
            {cols === "split" &&
              ["Subjective", "Objective", "Total"].map((t) => (
                <th key={t} className="c" style={{ width: "20mm" }}>
                  {t}
                </th>
              ))}
            {monthly && (
              <>
                {Array.from({ length: nDates }, (_, i) => (
                  <th key={i} className="c" style={{ width: "15mm" }}>
                    Date
                  </th>
                ))}
                <th className="c" style={{ width: "13mm" }}>
                  Total
                </th>
                <th className="c" style={{ width: "13mm" }}>
                  Avg.
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id}>
              {!monthly && <td className="c">{i + 1}</td>}
              <td className="c nw">{r.id}</td>
              <td>{r.name}</td>
              {grouped && <td className="c">{examsGroupShort(r.group)}</td>}
              {!monthly && <td />}
              {cols === "marks" && (
                <>
                  <td />
                  <td />
                </>
              )}
              {cols === "sign" && <td />}
              {cols === "split" && (
                <>
                  <td />
                  <td />
                  <td />
                </>
              )}
              {monthly &&
                Array.from({ length: nDates + 2 }, (_, k) => (
                  <td key={k} />
                ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!monthly && <Tally subject={subject} />}
    </div>
  );
}

// ------------------------------------------------------------------ Envelope tags (answer-script packets)

/** The old "Exam Envelops Tag": a small boxed table per packet, two across and six down on A4. */
export function EnvelopeLabels({ exam, sections, subjectId }: { exam: ExamDetail; sections: string[]; /** One paper only (the day's paper), or every paper. */ subjectId?: string | undefined }) {
  const subjects = exam.subjects.filter((s) => !subjectId || s.id === subjectId);
  const programme = Boolean(exam.programmeId);
  const labels = subjects.flatMap((s) => sections.map((cs) => ({ cs, s, p: exam.papers?.find((x) => x.classSection === cs && x.subjectId === s.id) })));
  const pages: (typeof labels)[] = [];
  for (let i = 0; i < labels.length; i += 12) pages.push(labels.slice(i, i + 12));
  return (
    <>
      {pages.map((page, i) => (
        <article key={i} className="exams-doc exams-doc-a4" aria-label={`Envelope tags, sheet ${i + 1}`}>
          <div className="exams-label-sheet">
            {page.map(({ cs, s, p }) => (
              <table key={`${cs}-${s.id}`} className="exams-tag">
                <tbody>
                  <tr>
                    <th>Exam:</th>
                    <td>{exam.name}</td>
                  </tr>
                  <tr>
                    <th>Session:</th>
                    <td>{sessionLong(exam.session)}</td>
                  </tr>
                  <tr>
                    <th>Class &amp; Section</th>
                    <td>{classAndSection(cs, programme)}</td>
                  </tr>
                  <tr>
                    <th>Subject</th>
                    <td>{s.name}</td>
                  </tr>
                  <tr>
                    <th>No. of Students</th>
                    <td>{p?.candidates ?? exam.rows.filter((r) => r.classSection === cs && examsSits(s, r.group)).length}</td>
                  </tr>
                  <tr>
                    <th>Issue Date:</th>
                    <td>{s.date ? formatDate(s.date) : printedOn()}</td>
                  </tr>
                </tbody>
              </table>
            ))}
          </div>
        </article>
      ))}
    </>
  );
}

// ------------------------------------------------------------------ Roll number slips (admit cards)

export function RollSlips({ exam, section, urdu }: { exam: ExamDetail; section: string; urdu?: boolean }) {
  const rows = exam.rows.filter((r) => r.classSection === section).sort((a, b) => a.rollNo - b.rollNo);
  const pages: ExamsResultRow[][] = [];
  for (let i = 0; i < rows.length; i += 3) pages.push(rows.slice(i, i + 3));
  return (
    <>
      {pages.map((page) => (
        <article key={page[0]!.id} className="exams-doc exams-doc-a4" aria-label="Roll number slips">
          <div className="exams-slip-sheet">
            {page.map((r) => {
              // Only the papers of the student's group (classes 9–10), as on the result card (test run F-142).
              const papers = exam.subjects.filter((s) => examsSits(s, r.group));
              return (
              <div key={r.id} className="exams-slip">
                <Letterhead
                  campus={exam.campus}
                  variant="slip"
                  titleCase="as-is"
                  title={
                    <>
                      Roll Number Slip{urdu && <> · <Urdu size="small">رول نمبر سلپ</Urdu></>} · {exam.name}
                    </>
                  }
                  right={
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: "8.5pt" }}>Roll no.</div>
                      <b style={{ fontSize: "16pt" }}>
                        {section}/{String(r.rollNo).padStart(2, "0")}
                      </b>
                    </div>
                  }
                />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "2mm" }}>
                  <span>
                    <b>Student: </b>
                    {r.name}
                  </span>
                  <span>
                    <b>Father: </b>
                    {r.father ?? ""}
                  </span>
                  <span>
                    <b>G.R. No.: </b>
                    {r.id}
                  </span>
                </div>
                <table style={{ fontSize: "8.5pt" }}>
                  <thead>
                    <tr>
                      {papers.map((s) => (
                        <th key={s.id}>{s.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {papers.map((s) => (
                        <td key={s.id}>
                          {s.date ? formatDate(s.date) : "—"}
                          {s.startTime ? ` · ${s.startTime}` : ""}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
                <div className="flex justify-between" style={{ fontSize: "8.5pt" }}>
                  <span>Bring this slip to every paper. Arrive 15 minutes early.</span>
                  <span>Controller of examinations ____________</span>
                </div>
              </div>
              );
            })}
          </div>
        </article>
      ))}
    </>
  );
}

// ------------------------------------------------------------------ Date sheet for parents

export function DateSheetDoc({ exam, urdu }: { exam: ExamDetail; urdu?: boolean }) {
  const papers = [...exam.subjects].sort((a, b) => (a.date ?? "9").localeCompare(b.date ?? "9"));
  return (
    <article className="exams-doc exams-doc-a4" aria-label="Date sheet">
      <DocHead campus={exam.campus} title="Date sheet" titleUr="ڈیٹ شیٹ" urdu={urdu} sub={`${exam.name} · ${exam.classes.join(", ")} · ${sessionOf(exam)}`} />
      <table>
        <thead>
          <tr>
            <th>
              <L en="Date" ur="تاریخ" urdu={urdu} />
            </th>
            <th>
              <L en="Day" ur="دن" urdu={urdu} />
            </th>
            <th>
              <L en="Subject" ur="مضمون" urdu={urdu} />
            </th>
            <th>
              <L en="Time" ur="وقت" urdu={urdu} />
            </th>
            <th className="n">
              <L en="Marks" ur="کل نمبر" urdu={urdu} />
            </th>
          </tr>
        </thead>
        <tbody>
          {papers.map((s) => (
            <tr key={s.id}>
              <td>
                <bdi dir="ltr">{s.date ? formatDate(s.date) : "To be announced"}</bdi>
              </td>
              <td>{s.date ? formatWeekday(s.date) : ""}</td>
              <td>
                {s.name}
                {urdu && s.nameUrdu ? (
                  <>
                    {" "}
                    · <Urdu size="small">{s.nameUrdu}</Urdu>
                  </>
                ) : null}
              </td>
              <td>
                {s.startTime ?? ""}
                {s.durationMins ? ` · ${Math.floor(s.durationMins / 60) ? `${Math.floor(s.durationMins / 60)} h ` : ""}${s.durationMins % 60 ? `${s.durationMins % 60} min` : ""}` : ""}
              </td>
              <td className="n">{s.maxMarks}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul style={{ marginTop: "6mm", paddingInlineStart: "5mm", display: "grid", gap: "1mm" }}>
        <li>Students must reach school 15 minutes before each paper, in uniform, with their roll number slip.</li>
        <li>A paper missed without approved leave is marked absent{exam.absenceFine ? ` and fined Rs ${exam.absenceFine}` : ""}.</li>
        <li>Results are announced in the parent portal and by SMS once declared.</li>
      </ul>
      {urdu && (
        <Urdu as="p" className="mt-3 block">
          طلبہ ہر پرچے سے پندرہ منٹ پہلے یونیفارم اور رول نمبر سلپ کے ساتھ اسکول پہنچیں۔ بغیر منظور شدہ رخصت کے پرچہ چھوڑنے پر غیر حاضری لگے گی۔
        </Urdu>
      )}
      <div className="exams-doc-signs">
        <div />
        <div>Controller of examinations</div>
        <div>Principal</div>
      </div>
    </article>
  );
}

// ------------------------------------------------------------------ Failed and re-sit list

export function FailedList({ exam, section, group, gender }: { exam: ExamDetail; section: string; group?: string; gender?: ExamsGender }) {
  const grouped = Boolean(exam.groups?.length);
  const rows = exam.rows
    .filter((r) => (section === "ALL" || r.classSection === section) && (r.result === "FAIL" || r.result === "SUPPLY") && inGroup(group)(r) && examsOfGender(gender)(r))
    .sort((a, b) => a.classSection.localeCompare(b.classSection) || a.rollNo - b.rollNo);
  const name = (id: string) => exam.subjects.find((s) => s.id === id)?.name ?? id;
  // Grouped under section headings, like the old failed-students list.
  const sections = [...new Set(rows.map((r) => r.classSection))];
  return (
    <article className="exams-doc exams-doc-a4" aria-label="Failed and re-sit list">
      <DocHead campus={exam.campus} title="Re-sit and failed list" sub={subParts(exam.name, classText(exam, section), group && group !== "ALL" ? group : "", genderText(gender), sessionOf(exam))} />
      {rows.length === 0 ? (
        <p>Every student met the pass rules.</p>
      ) : (
        <table style={{ fontSize: "9pt" }}>
          <thead>
            <tr>
              <th className="n">Sr#</th>
              <th>G.R. No.</th>
              <th>Student</th>
              <th>Father's name</th>
              {grouped && <th>Grp</th>}
              <th className="n">Obt.</th>
              <th className="n">Total</th>
              <th className="n">%age</th>
              <th className="c">Grade</th>
              <th>Subjects below the pass mark</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {sections.flatMap((cs) => [
              <tr key={`h-${cs}`}>
                <th colSpan={10 + (grouped ? 1 : 0)}>Section: {cs}</th>
              </tr>,
              ...rows
                .filter((r) => r.classSection === cs)
                .map((r, i) => (
                  <tr key={r.id}>
                    <td className="n">{i + 1}</td>
                    <td className="mtb-mono">{r.id}</td>
                    <td>{r.name}</td>
                    <td>{r.father ?? ""}</td>
                    {grouped && <td>{examsGroupShort(r.group)}</td>}
                    <td className="n">{r.obtained}</td>
                    <td className="n">{r.max}</td>
                    <td className="n">{formatPercent(r.percent ?? 0)}</td>
                    <td className="c">{r.grade ?? ""}</td>
                    <td>{(r.failedSubjects ?? []).map(name).join(", ")}</td>
                    <td>{r.result ? EXAMS_RESULT_LABEL[r.result] : ""}</td>
                  </tr>
                )),
            ])}
          </tbody>
        </table>
      )}
      <div className="exams-doc-signs">
        <div>Class teacher</div>
        <div>Controller of examinations</div>
        <div>Principal</div>
      </div>
    </article>
  );
}

// ------------------------------------------------------------------ Subject teacher report

export function TeacherReport({ exam, section, gender }: { exam: ExamDetail; section: string; gender?: ExamsGender }) {
  const a = examsAnalyse(exam, section, { gender });
  const byTeacher = new Map<string, typeof a.sections>();
  for (const s of a.sections) {
    const key = s.teacher ?? "Not assigned";
    byTeacher.set(key, [...(byTeacher.get(key) ?? []), s]);
  }
  return (
    <article className="exams-doc exams-doc-a4" aria-label="Subject teacher report">
      <DocHead campus={exam.campus} title="Subject teacher report" sub={subParts(exam.name, classText(exam, section), genderText(gender), sessionOf(exam))} />
      <table>
        <thead>
          <tr>
            <th>Teacher</th>
            <th>Subject</th>
            <th>Section</th>
            <th className="n">Students</th>
            <th className="n">Average</th>
            <th className="n">Pass rate</th>
          </tr>
        </thead>
        <tbody>
          {[...byTeacher.entries()]
            .sort(([x], [y]) => x.localeCompare(y))
            .flatMap(([t, list]) =>
              list.map((s, i) => (
                <tr key={`${t}-${s.classSection}-${s.subjectId}`}>
                  <td>{i === 0 ? <b>{t}</b> : ""}</td>
                  <td>{s.subjectName}</td>
                  <td>{s.classSection}</td>
                  <td className="n">{s.sat}</td>
                  <td className="n">{s.averagePercent === null ? "—" : formatPercent(s.averagePercent)}</td>
                  <td className={s.passRate !== null && s.passRate < 70 ? "n fail" : "n"}>{s.passRate === null ? "—" : formatPercent(s.passRate)}</td>
                </tr>
              )),
            )}
        </tbody>
      </table>
      <p className="exams-doc-key">Pass rate below 70% is shown in red. Average is the class's average mark as a % of the paper's maximum.</p>
    </article>
  );
}

// ------------------------------------------------------------------ Absent report (one section a page)

/**
 * The old "Absent Report" (Test Absent): Session / Exam / Month / Class, then Sr.#, G.R.No, Student Name, each paper's
 * date with the mark or A (L for leave), the number of absences and the fine. One section a page, A4 landscape.
 */
export function AbsentReport({ exam, section, gender }: { exam: ExamDetail; section: string; gender?: ExamsGender }) {
  const rows = exam.rows.filter((r) => r.classSection === section && examsOfGender(gender)(r)).sort((a, b) => a.rollNo - b.rollNo);
  const papers = [...exam.subjects].sort((a, b) => (a.date ?? "9").localeCompare(b.date ?? "9"));
  const fine = exam.absenceFine ?? 0;
  const absentIn = (r: ExamsResultRow) => papers.filter((s) => r.marks[s.id] === "A").length;
  // Two papers on one day: the subject goes under the date so the columns can be told apart.
  const days = papers.map((s) => s.date ?? "");
  const shared = (d: string) => !d || days.filter((x) => x === d).length > 1;
  return (
    <article className="exams-doc exams-doc-land" aria-label={`Absent report, ${section}`}>
      <DocHead campus={exam.campus} title="Absent Report" />
      <Fields
        items={[
          ["Session", sessionLong(exam.session)],
          ["Exam", exam.name],
          ["Month", examMonth(exam)],
          ["Class", classAndSection(section, Boolean(exam.programmeId))],
          gender && ["Gender", genderText(gender)],
        ]}
      />
      <table className="exams-absent" style={{ width: "auto", fontSize: papers.length > 12 ? "7.5pt" : "8.5pt" }}>
        <thead>
          <tr>
            <th className="c">Sr.#</th>
            <th className="c">G.R.No</th>
            <th className="c">Student Name</th>
            {papers.map((s) => (
              <th key={s.id} className="c">
                {dayMonth(s.date) || s.name}
                {s.date && shared(s.date) && (
                  <>
                    <br />
                    <span style={{ fontWeight: 400 }}>{s.name.length > 9 ? `${s.name.slice(0, 8)}.` : s.name}</span>
                  </>
                )}
              </th>
            ))}
            <th className="c">Total</th>
            <th className="c">Fine</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const n = absentIn(r);
            return (
              <tr key={r.id}>
                <td className="c">{i + 1}</td>
                <td>{r.id}</td>
                <td>{r.name}</td>
                {papers.map((s) => {
                  // A paper outside the student's group prints blank; a mark not entered yet shows a dash.
                  if (!examsSits(s, r.group)) return <td key={s.id} className="c" />;
                  const m = r.marks[s.id];
                  return (
                    <td key={s.id} className="c">
                      {m === null || m === undefined ? "—" : String(m)}
                    </td>
                  );
                })}
                <td className="c">{n}</td>
                <td className="c">{n * fine}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </article>
  );
}

// ------------------------------------------------------------------ Subject performance (class-wise or section-wise)

/** Highest, lowest, absent, average, failures and pass % of every subject, with the grade counts. A4 landscape. */
export function SubjectPerformance({ exam, section, gender }: { exam: ExamDetail; section: string; gender?: ExamsGender }) {
  const a = examsAnalyse(exam, section, { gender });
  const subjects = a.subjects.filter((s) => s.sat > 0);
  const students = exam.rows.filter((r) => (section === "ALL" || r.classSection === section) && examsOfGender(gender)(r)).length;
  const failedAll = a.counts.FAIL;
  const one = section !== "ALL";
  const line = (label: string, cell: (s: (typeof subjects)[number]) => ReactNode) => (
    <tr>
      <th>{label}</th>
      {subjects.map((s) => (
        <td key={s.subjectId} className="c">
          {cell(s)}
        </td>
      ))}
    </tr>
  );
  return (
    <article className="exams-doc exams-doc-land" aria-label="Subject performance">
      <DocHead campus={exam.campus} title={one ? "Section-wise subject performance" : "Class-wise subject performance"} sub={subParts(exam.name, classText(exam, section), genderText(gender), sessionOf(exam), `Total students ${students}`)} />
      {subjects.length === 0 ? (
        <p>No marks are entered yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Subject</th>
              {subjects.map((s) => (
                <th key={s.subjectId} className="c">
                  {s.name}
                  <br />
                  <span style={{ fontWeight: 400 }}>/{s.maxMarks}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {one && line("Teacher / lecturer", (s) => s.teacher ?? "—")}
            {line("Max. obt. marks", (s) => s.highest ?? "—")}
            {line("Min. obt. marks", (s) => s.lowest ?? "—")}
            {line("Absent", (s) => s.absent)}
            {line("Average marks", (s) => (s.average === null ? "—" : s.average.toFixed(1)))}
            {line("Marks %age", (s) => (s.averagePercent === null ? "—" : formatPercent(s.averagePercent)))}
            {line("No. of failures", (s) => <span className={s.failed > 0 ? "fail" : undefined}>{s.failed}</span>)}
            {line("Pass %age", (s) => (s.passRate === null ? "—" : formatPercent(s.passRate)))}
          </tbody>
        </table>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "auto auto", justifyContent: "start", gap: "1mm 14mm", marginTop: "5mm" }}>
        <table style={{ width: "auto" }}>
          <tbody>
            {a.grades.map((g) => (
              <tr key={g.grade}>
                <th>No. of {g.grade} grade students</th>
                <td className="n" style={{ minWidth: "14mm" }}>
                  {g.count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <table style={{ width: "auto", alignSelf: "start" }}>
          <tbody>
            <tr>
              <th>Complete results</th>
              <td className="n">{a.complete}</td>
            </tr>
            <tr>
              <th>Failed overall</th>
              <td className="n">{failedAll}</td>
            </tr>
            <tr>
              <th>Overall fail %age</th>
              <td className="n">{a.complete ? formatPercent((failedAll / a.complete) * 100) : "—"}</td>
            </tr>
            <tr>
              <th>Re-sit</th>
              <td className="n">{a.counts.SUPPLY}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="exams-doc-key">Absent counts absent and leave. Failures are students who sat the paper and scored below the pass mark; pass %age is of everyone with a mark.</p>
    </article>
  );
}

// ------------------------------------------------------------------ Hifz marking sheet (Shoba-e-Hifz)

/** A paper id ending in a number ("manzil-3") belongs to a numbered group ("manzil"). */
const PART_RE = /^(.*)-(\d+)$/;

/** Papers in print order: numbered groups (Manzil 1–7) together with a total, other papers on their own. */
export function hifzColumns(subjects: ExamsSubject[]): Array<{ key: string; label: string; papers: ExamsSubject[]; grouped: boolean }> {
  const out: Array<{ key: string; label: string; papers: ExamsSubject[]; grouped: boolean }> = [];
  for (const s of subjects) {
    const m = PART_RE.exec(s.id);
    const key = m ? m[1]! : s.id;
    const hit = out.find((c) => c.key === key && c.grouped);
    if (m && hit) hit.papers.push(s);
    else out.push({ key, label: m ? s.name.replace(/\s*\d+$/, "") : s.name, papers: [s], grouped: Boolean(m) });
  }
  return out;
}

/** True when an exam has numbered paper groups (the Hifz Manzil test). */
export const hasPaperGroups = (exam: Pick<ExamDetail, "subjects">) => exam.subjects.some((s) => PART_RE.test(s.id));

/** The old Shoba-e-Hifz sheet: syllabus, Manzil and Dua parts with totals, other papers, total, position, grade. */
export function HifzSheet({ exam, section, filled }: { exam: ExamDetail; section: string; /** Print the marks entered so far (otherwise blank for marking). */ filled?: boolean }) {
  const rows = exam.rows.filter((r) => r.classSection === section).sort((a, b) => a.rollNo - b.rollNo);
  const cols = hifzColumns(exam.subjects);
  const teacher = exam.papers?.find((p) => p.classSection === section && p.teacher)?.teacher ?? null;
  const date = exam.subjects.map((s) => s.date).filter(Boolean).sort()[0];
  const show = (m: ExamsResultRow["marks"][string] | undefined) => (filled ? sheetMark(m) : "");
  const sum = (r: ExamsResultRow, papers: ExamsSubject[]) => (papers.every((s) => (r.marks[s.id] ?? null) === null) ? "" : papers.reduce((a, s) => a + (typeof r.marks[s.id] === "number" ? (r.marks[s.id] as number) : 0), 0));
  return (
    <article className="exams-doc exams-doc-land" aria-label={`Hifz marking sheet, ${section}`} style={{ fontSize: "7.5pt" }}>
      <DocHead campus={exam.campus} title="Script Marking List" />
      <div className="exams-award-info">
        <Fields items={[["Class", splitSection(section).cls], ["Exam", exam.name]]} style={{ justifyContent: "space-between", paddingRight: "40mm" }} />
        <Fields
          items={[
            ["Section", `${splitSection(section).sec} - ${sessionLong(exam.session)}`],
            ["Teacher", teacher ?? <Fill key="t" w="36mm" />],
            ["Date", date ? formatDate(date).replace(/-/g, " ") : <Fill key="d" />],
            ["Total Marks", exam.totalMax],
          ]}
          style={{ justifyContent: "space-between" }}
        />
      </div>
      <table>
        <thead>
          <tr>
            <th rowSpan={2} className="n">
              #
            </th>
            <th rowSpan={2}>GR #</th>
            <th rowSpan={2}>Name</th>
            <th rowSpan={2}>Father Name</th>
            <th rowSpan={2} style={{ width: "26mm" }}>
              Decided Syllabus
            </th>
            <th rowSpan={2} style={{ width: "26mm" }}>
              Completed Syllabus
            </th>
            {cols.map((c) =>
              c.grouped ? (
                <th key={c.key} colSpan={c.papers.length + 1} className="c">
                  {c.label} {c.papers.length} × {c.papers[0]!.maxMarks} = {c.papers.reduce((a, s) => a + s.maxMarks, 0)}
                </th>
              ) : (
                <th key={c.key} rowSpan={2} className="c">
                  <span className="exams-vert">{c.label}</span>
                  <br />
                  {c.papers[0]!.maxMarks}
                </th>
              ),
            )}
            {["T.Marks", "Position", "Grade", "Attendance"].map((t) => (
              <th key={t} rowSpan={2} className="c">
                <span className="exams-vert">{t}</span>
              </th>
            ))}
            <th rowSpan={2} style={{ width: "24mm" }}>
              Remarks
            </th>
          </tr>
          <tr>
            {cols
              .filter((c) => c.grouped)
              .flatMap((c) => [
                ...c.papers.map((s, i) => (
                  <th key={s.id} className="c" style={{ width: "5mm" }}>
                    {i + 1}
                  </th>
                )),
                <th key={`${c.key}-t`} className="c">
                  <span className="exams-vert">Total</span>
                </th>,
              ])}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} style={{ height: "9mm" }}>
              <td className="n">{i + 1}</td>
              <td className="mtb-mono">{r.id}</td>
              <td>{r.name}</td>
              <td>{r.father ?? ""}</td>
              <td />
              <td />
              {cols.flatMap((c) =>
                c.grouped
                  ? [
                      ...c.papers.map((s) => (
                        <td key={s.id} className="c">
                          {show(r.marks[s.id])}
                        </td>
                      )),
                      <td key={`${c.key}-t`} className="c">
                        {filled ? sum(r, c.papers) : ""}
                      </td>,
                    ]
                  : [
                      <td key={c.key} className="c">
                        {show(r.marks[c.papers[0]!.id])}
                      </td>,
                    ],
              )}
              <td className="c">{filled && r.percent !== null ? r.obtained : ""}</td>
              <td className="c">{filled && r.position ? ordinal(r.position) : ""}</td>
              <td className="c">{filled && r.percent !== null ? (r.grade ?? "") : ""}</td>
              <td />
              <td>{filled ? (r.teacherRemark ?? "") : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}
