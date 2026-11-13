import {
  examsAnalyse,
  examsGradeFor,
  examsGroupShort,
  examsOfGender,
  examsPassMark,
  examsSits,
  EXAMS_DEFAULT_PASS_RULES,
  EXAMS_DEFAULT_SCALE,
  EXAMS_RESULT_LABEL,
  EXAMS_RESULT_LABEL_UR,
  type CampusCode,
  type ExamDetail,
  type ExamsGender,
  type ExamsResultRow,
  type ExamsSubject,
} from "@mtb/api";
import { amountInWords, formatDate, formatMobile, formatPercent, formatRs, formatSession, formatWeekday, pakistanToday } from "@mtb/domain";
import { Urdu } from "@mtb/ui";
import type { ReactNode } from "react";
import { campusLabel } from "../../../app/shell/campus";
import { markText, ordinal } from "../shared";

const CITY: Partial<Record<CampusCode, string>> = { KC: "Sadiqabad", HC: "Lahore" };
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

export function DocHead({ campus, title, titleUr, sub, urdu }: { campus: CampusCode; title: string; titleUr?: string; sub: ReactNode; urdu?: boolean }) {
  return (
    <header className="exams-doc-head">
      <div className="flex items-center gap-3">
        <span className="exams-doc-seal">MTB</span>
        <div>
          <h1>MTB Schools and Colleges</h1>
          <p>
            {campusLabel(campus)}
            {CITY[campus] ? `, ${CITY[campus]}` : ""}
          </p>
        </div>
      </div>
      <div className="exams-doc-title">
        <strong>{title}</strong>
        {urdu && titleUr && <Urdu size="small">{titleUr}</Urdu>}
        <p>{sub}</p>
      </div>
    </header>
  );
}

function Foot({ exam, page }: { exam: ExamDetail; page?: string }) {
  return (
    <footer className="exams-doc-foot">
      <span>
        Printed <bdi dir="ltr">{printedOn()}</bdi>
        {exam.status === "DECLARED" ? "" : " · Provisional: not declared"}
      </span>
      <span>{page ?? ""}</span>
    </footer>
  );
}

const sessionOf = (exam: ExamDetail) => `Session ${formatSession(exam.session)}`;

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

/** A mark as printed on sheets: the number, A, L, or blank. */
const sheetMark = (m: ExamsResultRow["marks"][string] | undefined) => (m === null || m === undefined ? "" : String(m));

/** The class's sections as printed: "Class 7" for several, or the one section. */
const classText = (exam: ExamDetail, section: string) => (section === "ALL" ? exam.classes.join(", ") : section);

// ------------------------------------------------------------------ Result card (A4, one or two to a page)

export function ResultCard({ exam, row, urdu, half }: { exam: ExamDetail; row: ExamsResultRow; urdu?: boolean; half?: boolean }) {
  const rules = exam.passRules ?? EXAMS_DEFAULT_PASS_RULES;
  const bands = exam.bands ?? EXAMS_DEFAULT_SCALE;
  const inSection = exam.rows.filter((r) => r.classSection === row.classSection && r.percent !== null && !r.withheld).length;
  const failed = new Set(row.failedSubjects ?? []);
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
        : `${EXAMS_RESULT_LABEL[row.result ?? "FAIL"]}: ${[...failed].map((id) => exam.subjects.find((s) => s.id === id)?.name ?? id).join(", ")}.`;
  return (
    <article className={half ? "exams-doc exams-doc-half" : "exams-doc exams-doc-a4"} style={half ? { width: "190mm", padding: "7mm 10mm", fontSize: "9pt", borderBottom: "0.8pt dashed var(--border-strong)" } : undefined} aria-label={`Result card, ${row.name}`}>
      {mark && <span className="exams-doc-mark">{mark}</span>}
      <DocHead campus={exam.campus} title="Result card" titleUr="نتیجہ کارڈ" urdu={urdu} sub={`${exam.name} · ${sessionOf(exam)}`} />
      <dl className="exams-doc-info">
        <div>
          <dt>
            <L en="Student" ur="نام طالب علم" urdu={urdu} />
          </dt>
          <dd>{row.name}</dd>
        </div>
        <div>
          <dt>
            <L en="Father's name" ur="ولدیت" urdu={urdu} />
          </dt>
          <dd>{row.father ?? "—"}</dd>
        </div>
        <div>
          <dt>
            <L en="G.R. No." ur="جی آر نمبر" urdu={urdu} />
          </dt>
          <dd className="mtb-mono">{row.id}</dd>
        </div>
        <div>
          <dt>
            <L en="Class" ur="جماعت" urdu={urdu} />
          </dt>
          <dd>{row.classSection}</dd>
        </div>
        <div>
          <dt>
            <L en="Roll no." ur="رول نمبر" urdu={urdu} />
          </dt>
          <dd>{row.rollNo}</dd>
        </div>
        <div>
          <dt>
            <L en="Declared" ur="اعلان" urdu={urdu} />
          </dt>
          <dd>{exam.declaredOn ? formatDate(exam.declaredOn) : "Not yet"}</dd>
        </div>
        {row.group && (
          <div>
            <dt>
              <L en="Group" ur="گروپ" urdu={urdu} />
            </dt>
            <dd>{row.group}</dd>
          </div>
        )}
        {row.boardRollNo && (
          <div>
            <dt>
              <L en="Board roll no." ur="بورڈ رول نمبر" urdu={urdu} />
            </dt>
            <dd className="mtb-mono">{row.boardRollNo}</dd>
          </div>
        )}
        {!half && row.address && (
          <div style={{ gridColumn: "span 3" }}>
            <dt>
              <L en="Address" ur="پتہ" urdu={urdu} />
            </dt>
            <dd style={{ fontWeight: 400 }}>{row.address}</dd>
          </div>
        )}
      </dl>
      <table>
        <thead>
          <tr>
            <th>
              <L en="Subject" ur="مضمون" urdu={urdu} />
            </th>
            <th className="n">
              <L en="Max" ur="کل نمبر" urdu={urdu} />
            </th>
            <th className="n">
              <L en="Obtained" ur="حاصل کردہ" urdu={urdu} />
            </th>
            {!half && <th className="n">%</th>}
            <th className="c">
              <L en="Grade" ur="گریڈ" urdu={urdu} />
            </th>
          </tr>
        </thead>
        <tbody>
          {papers.map((s) => {
            const m = row.marks[s.id];
            const pct = typeof m === "number" ? (m / s.maxMarks) * 100 : 0;
            const g = typeof m === "number" ? (examsGradeFor(pct, bands) ?? "") : "F";
            return (
              <tr key={s.id}>
                <td className={failed.has(s.id) ? "fail" : undefined}>
                  {s.name}
                  {urdu && s.nameUrdu ? (
                    <>
                      {" "}
                      · <Urdu size="small">{s.nameUrdu}</Urdu>
                    </>
                  ) : null}
                </td>
                <td className="n">{s.maxMarks}</td>
                <td className={failed.has(s.id) ? "n fail" : "n"}>{markText(m)}</td>
                {!half && <td className="n">{typeof m === "number" ? formatPercent(pct) : "—"}</td>}
                <td className="c">{m === null || m === undefined ? "—" : g}</td>
              </tr>
            );
          })}
          <tr>
            <th>
              <L en="Total" ur="میزان" urdu={urdu} />
            </th>
            <th className="n">{row.max}</th>
            <th className="n">{row.obtained}</th>
            {!half && <th className="n">{row.percent === null ? "—" : formatPercent(row.percent)}</th>}
            <th className="c">{row.withheld ? "—" : (row.grade ?? "—")}</th>
          </tr>
        </tbody>
      </table>
      {!row.withheld && row.percent !== null && (
        <p className="m-0 mt-2" style={{ fontSize: "9pt" }}>
          <b>
            <L en="Marks in words" ur="حاصل کردہ نمبر الفاظ میں" urdu={urdu} />:
          </b>{" "}
          {marksInWords(row.obtained)} out of {marksInWords(row.max)}
        </p>
      )}
      <div className="exams-doc-summary">
        <div>
          <span>
            <L en="Percentage" ur="فیصد" urdu={urdu} />
          </span>
          <b>{row.percent === null || row.withheld ? "—" : formatPercent(row.percent)}</b>
        </div>
        <div>
          <span>
            <L en="Position in section" ur="سیکشن میں پوزیشن" urdu={urdu} />
          </span>
          <b>{row.position && !row.withheld ? `${ordinal(row.position)} of ${inSection}` : "—"}</b>
        </div>
        <div>
          <span>
            <L en="Position in class" ur="جماعت میں پوزیشن" urdu={urdu} />
          </span>
          <b>{row.classPosition && !row.withheld ? ordinal(row.classPosition) : "—"}</b>
        </div>
        <div>
          <span>
            <L en="Result" ur="نتیجہ" urdu={urdu} />
          </span>
          <b className={row.result === "FAIL" ? "fail" : undefined}>
            {row.result ? EXAMS_RESULT_LABEL[row.result] : "—"}
            {urdu && row.result ? (
              <>
                {" "}
                <Urdu size="small">{EXAMS_RESULT_LABEL_UR[row.result]}</Urdu>
              </>
            ) : null}
          </b>
        </div>
      </div>
      <p className="m-0 mt-3">
        <b>
          <L en="Remarks" ur="کیفیت" urdu={urdu} />:
        </b>{" "}
        {remark}
      </p>
      <p className="m-0 mt-1">
        <b>
          <L en="Teacher's remarks" ur="استاد کے تاثرات" urdu={urdu} />:
        </b>{" "}
        {row.teacherRemark ?? <span style={{ color: "var(--ink-muted)" }}>____________________________________________</span>}
      </p>
      {!half && (
        <p className="exams-doc-key">
          Grades: {bands.map((b) => `${b.grade} ${b.min}–${b.max}%`).join(" · ")}. Pass mark {rules.subjectPassPercent}% in each subject and {rules.overallPassPercent}% overall.
        </p>
      )}
      <div className="exams-doc-signs" style={half ? { marginTop: "8mm" } : undefined}>
        <div>
          <L en="Class teacher" ur="کلاس ٹیچر" urdu={urdu} />
        </div>
        <div>
          <L en="Controller of examinations" ur="ناظم امتحانات" urdu={urdu} />
        </div>
        <div>
          <L en="Principal" ur="پرنسپل" urdu={urdu} />
        </div>
      </div>
      {!half && <Foot exam={exam} />}
    </article>
  );
}

/** Two compact cards on each A4 sheet. */
export function HalfCards({ exam, rows, urdu }: { exam: ExamDetail; rows: ExamsResultRow[]; urdu?: boolean }) {
  const pairs: ExamsResultRow[][] = [];
  for (let i = 0; i < rows.length; i += 2) pairs.push(rows.slice(i, i + 2));
  return (
    <>
      {pairs.map((p) => (
        <div key={p[0]!.id} className="exams-doc exams-doc-a4" style={{ padding: 0 }}>
          {p.map((r) => (
            <ResultCard key={r.id} exam={exam} row={r} urdu={urdu} half />
          ))}
        </div>
      ))}
    </>
  );
}

// ------------------------------------------------------------------ Master (tabulation) sheet, A4 landscape

/** Who a master sheet lists: everyone, re-sit (supply) holders only, or failed students only. */
export type MasterWho = "resit" | "failed";

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
  const rules = exam.passRules ?? EXAMS_DEFAULT_PASS_RULES;
  const complete = rows.filter((r) => r.percent !== null && !r.withheld);
  const count = (code: string) => complete.filter((r) => r.result === code).length;
  const grouped = Boolean(exam.groups?.length);
  const board = exam.category === "BOARD" && rows.some((r) => r.boardRollNo);
  // With groups, each student's total is out of their own papers.
  const maxes = new Set(rows.map((r) => r.max));
  // Each subject's average and average % over the students listed who sit it.
  const stats = examsAnalyse({ ...exam, rows }, "ALL").subjects;
  const subjectName = (id: string) => exam.subjects.find((s) => s.id === id)?.name ?? id;
  const lead = 4 + (board ? 1 : 0) + (section === "ALL" ? 1 : 0) + (grouped ? 1 : 0);
  const trail = 6 + (contact ? 1 : 0);
  const title = who === "resit" ? "Supply holder sheet" : who === "failed" ? "Failed students' master sheet" : "Master sheet";
  return (
    <article className="exams-doc exams-doc-land" aria-label={title}>
      <DocHead campus={exam.campus} title={title} sub={subParts(exam.name, classText(exam, section), group && group !== "ALL" ? group : "", genderText(gender), sessionOf(exam))} />
      <table>
        <thead>
          <tr>
            <th className="n">Roll</th>
            <th>G.R. No.</th>
            {board && <th>Board roll no.</th>}
            <th>Student</th>
            <th>Father's name</th>
            {section === "ALL" && <th>Sec.</th>}
            {grouped && <th>Grp</th>}
            {exam.subjects.map((s) => (
              <th key={s.id} className="n">
                {s.name.length > 10 ? s.name.slice(0, 9) + "." : s.name}
                <br />
                <span style={{ fontWeight: 400 }}>/{s.maxMarks}</span>
                {s.date && (
                  <>
                    <br />
                    <span style={{ fontWeight: 400 }}>{formatDate(s.date).slice(0, 6)}</span>
                  </>
                )}
              </th>
            ))}
            <th className="n">
              Total
              <br />
              <span style={{ fontWeight: 400 }}>/{maxes.size === 1 ? [...maxes][0] : "own"}</span>
            </th>
            <th className="n">%</th>
            <th className="c">Grade</th>
            <th className="n">Pos.</th>
            <th>Result</th>
            <th>Failed subjects</th>
            {contact && <th>Contact</th>}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={lead + exam.subjects.length + trail}>{who === "resit" ? "No student has a re-sit." : who === "failed" ? "No student failed." : "No students."}</td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="n">{r.rollNo}</td>
              <td className="mtb-mono">{r.id}</td>
              {board && <td className="mtb-mono">{r.boardRollNo ?? ""}</td>}
              <td>{r.name}</td>
              <td>{r.father ?? ""}</td>
              {section === "ALL" && <td>{r.classSection}</td>}
              {grouped && <td>{examsGroupShort(r.group)}</td>}
              {exam.subjects.map((s) => {
                // A paper outside the student's group prints blank (not taken, not failed).
                if (!examsSits(s, r.group)) return <td key={s.id} className="n" />;
                const m = r.marks[s.id];
                const low = typeof m !== "number" || m < examsPassMark(s.maxMarks, rules);
                return (
                  <td key={s.id} className={low && m !== null && m !== undefined ? "n fail" : "n"}>
                    {m === null || m === undefined ? "" : m === "A" ? "A" : m === "L" ? "L" : m}
                  </td>
                );
              })}
              <td className="n">{maxes.size === 1 ? r.obtained : `${r.obtained}/${r.max}`}</td>
              <td className="n">{r.percent === null ? "" : r.percent.toFixed(1)}</td>
              <td className="c">{r.withheld ? "" : (r.grade ?? "")}</td>
              <td className="n">{r.withheld ? "" : ((section === "ALL" ? r.classPosition : r.position) ?? "")}</td>
              <td>{r.result ? EXAMS_RESULT_LABEL[r.result] : ""}</td>
              <td style={{ fontSize: "7.5pt" }}>{(r.failedSubjects ?? []).map(subjectName).join(", ")}</td>
              {contact && <td className="mtb-mono">{r.guardianMobile ? formatMobile(r.guardianMobile) : ""}</td>}
            </tr>
          ))}
          {rows.length > 0 && (
            <>
              <tr>
                <th colSpan={lead} className="n">
                  Average
                </th>
                {stats.map((s) => (
                  <th key={s.subjectId} className="n">
                    {s.average === null ? "" : s.average.toFixed(1)}
                  </th>
                ))}
                <th colSpan={trail} />
              </tr>
              <tr>
                <th colSpan={lead} className="n">
                  %age
                </th>
                {stats.map((s) => (
                  <th key={s.subjectId} className="n">
                    {s.averagePercent === null ? "" : formatPercent(s.averagePercent)}
                  </th>
                ))}
                <th colSpan={trail} />
              </tr>
            </>
          )}
        </tbody>
      </table>
      <div className="exams-doc-summary" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
        <div>
          <span>Appeared</span>
          <b>{complete.length}</b>
        </div>
        <div>
          <span>Passed</span>
          <b>{count("PASS")}</b>
        </div>
        <div>
          <span>Re-sit</span>
          <b>{count("SUPPLY")}</b>
        </div>
        <div>
          <span>Failed</span>
          <b>{count("FAIL")}</b>
        </div>
        <div>
          <span>Pass rate</span>
          <b>{complete.length ? formatPercent((count("PASS") / complete.length) * 100) : "—"}</b>
        </div>
      </div>
      <p className="exams-doc-key">
        A = absent, L = leave. Marks in red are below the pass mark ({rules.subjectPassPercent}%). Position is {section === "ALL" ? "in the class" : "in the section"}; equal percentages share a position.
        {grouped ? ` Grp = group (${(exam.groups ?? []).map((g) => `${examsGroupShort(g)} ${g}`).join(", ")}); a blank paper is one the group doesn't take, and the total is out of the student's own papers.` : ""}
        {` Average and %age are over the students listed who sit each paper${order === "position" ? "; students are listed by percentage" : ""}.`}
      </p>
      <div className="exams-doc-signs" style={{ marginTop: "10mm", ...(section !== "ALL" ? { gridTemplateColumns: "repeat(4, 1fr)" } : {}) }}>
        {section !== "ALL" && <div>Class in-charge</div>}
        <div>Prepared by</div>
        <div>Controller of examinations</div>
        <div>Principal</div>
      </div>
    </article>
  );
}

// ------------------------------------------------------------------ Position list (top N or everyone)

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
  const grouped = Boolean(exam.groups?.length);
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
  // Section-wise, like the old "top three positions" table: positions 1 to N of each section (ties share a position).
  const blocks = perSection
    ? (section === "ALL" ? exam.classes : [section]).map((cs) => ({ cs, rows: base.filter((r) => r.classSection === cs && (top <= 0 || pos(r) <= top)).sort((a, b) => pos(a) - pos(b) || a.name.localeCompare(b.name)) }))
    : [{ cs: "", rows: cut(base) }];
  const extra = perSection ? 0 : Math.max(0, blocks[0]!.rows.length - (top > 0 ? top : blocks[0]!.rows.length));
  const showSection = !perSection && section === "ALL";
  const head = (
    <tr>
      <th className="n">Position</th>
      <th>G.R. No.</th>
      <th>Student</th>
      <th>Father's name</th>
      {showSection && <th>Section</th>}
      {grouped && <th>Grp</th>}
      <th className="n">Marks</th>
      <th className="n">%age</th>
      <th className="c">Grade</th>
    </tr>
  );
  const body = (list: ExamsResultRow[]) =>
    list.map((r) => (
      <tr key={r.id}>
        <td className="n">{ordinal(pos(r))}</td>
        <td className="mtb-mono">{r.id}</td>
        <td>{r.name}</td>
        <td>{r.father ?? ""}</td>
        {showSection && <td>{r.classSection}</td>}
        {grouped && <td>{examsGroupShort(r.group)}</td>}
        <td className="n">
          {r.obtained}/{r.max}
        </td>
        <td className="n">{formatPercent(r.percent ?? 0)}</td>
        <td className="c">{r.grade}</td>
      </tr>
    ));
  const title = top > 0 ? `Top ${top === 3 ? "three" : top} positions${perSection ? " (section-wise)" : ""}` : "Position list";
  return (
    <article className="exams-doc exams-doc-a4" aria-label="Position list">
      <DocHead campus={exam.campus} title={title} sub={subParts(exam.name, classText(exam, section), group && group !== "ALL" ? group : "", genderText(gender), sessionOf(exam))} />
      {perSection ? (
        blocks.map((b) => (
          <section key={b.cs} style={{ marginBottom: "4mm", breakInside: "avoid" }}>
            <p style={{ margin: "0 0 1mm", fontWeight: 600 }}>Section: {b.cs}</p>
            {b.rows.length === 0 ? (
              <p style={{ margin: 0, color: "var(--ink-muted)" }}>No complete results.</p>
            ) : (
              <table>
                <thead>{head}</thead>
                <tbody>{body(b.rows)}</tbody>
              </table>
            )}
          </section>
        ))
      ) : (
        <table>
          <thead>{head}</thead>
          <tbody>{body(blocks[0]!.rows)}</tbody>
        </table>
      )}
      <p className="exams-doc-key">
        Positions by percentage{bySection ? " within each section" : " in the class"}; equal percentages share a position
        {perSection && top > 0 ? `, so positions 1 to ${top} can list more than ${top} students` : extra > 0 ? `, so ${extra} more ${extra === 1 ? "student is" : "students are"} listed at the cut-off` : ""}.
        {ranks ? ` Positions are among the ${genderText(gender).toLowerCase()} listed only.` : gender ? " Positions are the exam's positions (boys and girls together)." : ""}
      </p>
      <div className="exams-doc-signs">
        <div>Controller of examinations</div>
        <div />
        <div>Principal</div>
      </div>
      <Foot exam={exam} />
    </article>
  );
}

// ------------------------------------------------------------------ Award list (script marking list)

/** Columns of the award list: what the teacher fills in. */
export type AwardCols = "marks" | "sign" | "split" | "monthly";

export const AWARD_COLS: Array<{ value: AwardCols; label: string }> = [
  { value: "marks", label: "Signature, marks and remarks" },
  { value: "sign", label: "Signature and obtained" },
  { value: "split", label: "Signature, subjective, objective, total" },
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

/** A blank line to write on. */
const Fill = ({ w = "24mm" }: { w?: string }) => <span className="exams-fill" style={{ minWidth: w }} />;

/** Award (script marking) list for one section and paper: the teacher's copy to mark against. */
export function AwardList(props: AwardProps) {
  return (
    <article className="exams-doc exams-doc-a4" aria-label="Award list">
      <AwardBody {...props} />
      <Foot exam={props.exam} page={`${props.subject?.name ?? "Paper not filled in"} · ${props.section}`} />
    </article>
  );
}

/** Two copies of the same list side by side on one A4 sheet, with compact rows (signature and obtained). */
export function AwardPair(props: AwardProps) {
  return (
    <article className="exams-doc exams-doc-a4 exams-award-pair" aria-label="Award list, two copies">
      <AwardBody {...props} cols="sign" compact />
      <AwardBody {...props} cols="sign" compact />
    </article>
  );
}

function AwardBody({ exam, section, subject, teacher, gender, cols = "marks", dates = 5, compact }: AwardProps & { compact?: boolean }) {
  // Only the students whose group sits this paper (everyone when the paper is left blank).
  const rows = exam.rows.filter((r) => r.classSection === section && (!subject || examsSits(subject, r.group)) && examsOfGender(gender)(r)).sort((a, b) => a.rollNo - b.rollNo);
  const grouped = Boolean(exam.groups?.length);
  const monthly = cols === "monthly";
  const nDates = Math.min(6, Math.max(3, dates));
  const showFather = cols === "marks" && !compact;
  const title = monthly ? "Monthly script marking list" : "Script marking list (award list)";
  return (
    <div>
      {compact ? (
        <div className="exams-award-head">
          <b>Script marking list</b>
          <span>
            {campusLabel(exam.campus)} · {exam.name} · {sessionOf(exam)}
          </span>
        </div>
      ) : (
        <DocHead campus={exam.campus} title={title} sub={subParts(exam.name, sessionOf(exam), genderText(gender))} />
      )}
      <dl className="exams-doc-info" style={{ gridTemplateColumns: compact ? "1fr 1fr" : "repeat(4, 1fr)", fontSize: compact ? "8pt" : undefined }}>
        <div>
          <dt>Class and section</dt>
          <dd>{section}</dd>
        </div>
        <div>
          <dt>Subject</dt>
          <dd>{subject ? `${subject.name}${subject.groups?.length ? ` (${subject.groups.join(", ")})` : ""}` : <Fill />}</dd>
        </div>
        <div>
          <dt>Maximum marks</dt>
          <dd>{subject ? subject.maxMarks : <Fill w="14mm" />}</dd>
        </div>
        <div>
          <dt>{monthly ? "Month" : "Paper date"}</dt>
          <dd>{!monthly && subject?.date ? formatDate(subject.date) : <Fill w="18mm" />}</dd>
        </div>
        {!compact && (
          <div style={{ gridColumn: "span 2" }}>
            <dt>Teacher</dt>
            <dd>{subject ? (teacher ?? "—") : <Fill w="40mm" />}</dd>
          </div>
        )}
        <div style={compact ? undefined : { gridColumn: "span 2" }}>
          <dt>Total students</dt>
          <dd>{rows.length}</dd>
        </div>
      </dl>
      <table>
        <thead>
          <tr>
            <th className="n">{compact ? "Sr#" : "Roll"}</th>
            {compact ? (
              <th>Student</th>
            ) : (
              <>
                <th>G.R. No.</th>
                <th>Student</th>
              </>
            )}
            {showFather && <th>Father's name</th>}
            {grouped && <th>Grp</th>}
            {!monthly && <th style={{ width: compact ? "18mm" : "24mm" }}>Sign.</th>}
            {cols === "marks" && (
              <>
                <th className="c" style={{ width: "20mm" }}>
                  Marks{subject ? ` /${subject.maxMarks}` : ""}
                </th>
                <th style={{ width: "26mm" }}>Remarks</th>
              </>
            )}
            {cols === "sign" && (
              <th className="c" style={{ width: compact ? "11mm" : "20mm" }}>
                Obt.
              </th>
            )}
            {cols === "split" &&
              ["Subjective", "Objective", "Total"].map((t) => (
                <th key={t} className="c" style={{ width: "18mm" }}>
                  {t}
                </th>
              ))}
            {monthly && (
              <>
                {Array.from({ length: nDates }, (_, i) => (
                  <th key={i} className="c" style={{ width: "14mm" }}>
                    Date
                    <br />
                    <span style={{ fontWeight: 400 }}>__/__</span>
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
              <td className="n">{compact ? i + 1 : r.rollNo}</td>
              {compact ? (
                <td>
                  <span className="mtb-mono">{r.id}</span> – {r.name}
                </td>
              ) : (
                <>
                  <td className="mtb-mono">{r.id}</td>
                  <td>{r.name}</td>
                </>
              )}
              {showFather && <td>{r.father ?? ""}</td>}
              {grouped && <td>{examsGroupShort(r.group)}</td>}
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
              {monthly && (
                <>
                  {Array.from({ length: nDates + 2 }, (_, k) => (
                    <td key={k} />
                  ))}
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {monthly ? (
        <>
          <table style={{ marginTop: "4mm" }} aria-label="Syllabus covered">
            <tbody>
              <tr>
                <th style={{ width: "22mm" }}>Date</th>
                {Array.from({ length: nDates }, (_, i) => (
                  <td key={i} />
                ))}
              </tr>
              <tr>
                <th>Syllabus</th>
                {Array.from({ length: nDates }, (_, i) => (
                  <td key={i} style={{ height: "16mm" }} />
                ))}
              </tr>
            </tbody>
          </table>
          <p className="exams-doc-key">Write the date over each column on the day of the test, and A for absent or L for leave.</p>
          <div className="exams-doc-signs" style={{ marginTop: "10mm" }}>
            <div>Subject teacher</div>
            <div>Checker</div>
            <div>Re-checker</div>
          </div>
        </>
      ) : compact ? (
        <div className="exams-tally">
          {["Present", "Absent", "Blank sheets", "Answer sheets", "Invigilator", "Checker", "Re-checker", "HOD sign"].map((t) => (
            <span key={t}>
              {t}: {t === "Invigilator" && subject?.supervisor ? <b>{subject.supervisor}</b> : <Fill w="20mm" />}
            </span>
          ))}
        </div>
      ) : (
        <>
          <div className="exams-doc-summary" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            {["Present", "Absent", "Blank sheets", "Answer sheets"].map((t) => (
              <div key={t}>
                <span>{t}</span>
                <b>&nbsp;</b>
              </div>
            ))}
          </div>
          <p className="exams-doc-key">Write A for absent and L for leave — never leave a box empty. Hand the list to the exam office with the scripts.</p>
          <div className="exams-doc-signs" style={{ gridTemplateColumns: "repeat(4, 1fr)", gap: "6mm" }}>
            <div>
              {subject?.supervisor && (
                <b style={{ display: "block", color: "var(--ink)" }}>{subject.supervisor}</b>
              )}
              Invigilator
            </div>
            <div>Checker</div>
            <div>Re-checker</div>
            <div>Head of department</div>
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Envelope labels (answer-script packets)

export function EnvelopeLabels({ exam, sections, subjectId }: { exam: ExamDetail; sections: string[]; /** One paper only (the day's paper), or every paper. */ subjectId?: string | undefined }) {
  const subjects = exam.subjects.filter((s) => !subjectId || s.id === subjectId);
  const labels = sections.flatMap((cs) => subjects.map((s) => ({ cs, s, p: exam.papers?.find((x) => x.classSection === cs && x.subjectId === s.id) })));
  const pages: (typeof labels)[] = [];
  for (let i = 0; i < labels.length; i += 8) pages.push(labels.slice(i, i + 8));
  return (
    <>
      {pages.map((page, i) => (
        <article key={i} className="exams-doc exams-doc-a4" aria-label={`Envelope labels, sheet ${i + 1}`}>
          <div className="exams-label-sheet">
            {page.map(({ cs, s, p }) => (
              <div key={`${cs}-${s.id}`} className="exams-label">
                <span style={{ fontSize: "8.5pt", color: "var(--ink-muted)" }}>
                  MTB Schools and Colleges · {campusLabel(exam.campus)}
                </span>
                <strong>
                  {s.name} · {cs}
                </strong>
                <span>
                  {exam.name} · {sessionOf(exam)}
                </span>
                <span>
                  {s.date ? `${formatWeekday(s.date)} ${formatDate(s.date)}` : "Date not set"}
                  {s.startTime ? ` · ${s.startTime}` : ""}
                </span>
                <span>
                  Scripts: <b>{p?.candidates ?? 0}</b> · Maximum marks: <b>{s.maxMarks}</b>
                </span>
                <span>Teacher: {p?.teacher ?? "—"}</span>
                <span>Invigilator: {s.supervisor ?? "—"}</span>
                <span style={{ marginTop: "2mm", fontSize: "8.5pt", color: "var(--ink-muted)" }}>Sealed by ____________ Received by ____________</span>
              </div>
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
            {page.map((r) => (
              <div key={r.id} className="exams-slip">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="exams-doc-seal" style={{ width: "10mm", height: "10mm", fontSize: "8pt" }}>
                      MTB
                    </span>
                    <div>
                      <b>Roll number slip</b>
                      {urdu && (
                        <>
                          {" "}
                          · <Urdu size="small">رول نمبر سلپ</Urdu>
                        </>
                      )}
                      <div style={{ fontSize: "8.5pt", color: "var(--ink-muted)" }}>
                        {exam.name} · {campusLabel(exam.campus)}
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: "8.5pt", color: "var(--ink-muted)" }}>Roll no.</div>
                    <b style={{ fontSize: "16pt" }}>
                      {section}/{String(r.rollNo).padStart(2, "0")}
                    </b>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "2mm" }}>
                  <span>
                    <span style={{ color: "var(--ink-muted)" }}>Student: </span>
                    <b>{r.name}</b>
                  </span>
                  <span>
                    <span style={{ color: "var(--ink-muted)" }}>Father: </span>
                    {r.father ?? "—"}
                  </span>
                  <span>
                    <span style={{ color: "var(--ink-muted)" }}>G.R. No.: </span>
                    <span className="mtb-mono">{r.id}</span>
                  </span>
                </div>
                <table style={{ fontSize: "8.5pt" }}>
                  <thead>
                    <tr>
                      {exam.subjects.map((s) => (
                        <th key={s.id}>{s.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {exam.subjects.map((s) => (
                        <td key={s.id}>
                          {s.date ? formatDate(s.date) : "—"}
                          {s.startTime ? ` · ${s.startTime}` : ""}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
                <div className="flex justify-between" style={{ fontSize: "8.5pt", color: "var(--ink-muted)" }}>
                  <span>Bring this slip to every paper. Arrive 15 minutes early.</span>
                  <span>Controller of examinations ____________</span>
                </div>
              </div>
            ))}
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
      <Foot exam={exam} />
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
      <Foot exam={exam} />
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
      <Foot exam={exam} />
    </article>
  );
}

// ------------------------------------------------------------------ Absent report (one section a page)

/** Each paper's mark or A/L for one section, with each student's absences and fine, and the absences per paper. */
export function AbsentReport({ exam, section, gender }: { exam: ExamDetail; section: string; gender?: ExamsGender }) {
  const rows = exam.rows.filter((r) => r.classSection === section && examsOfGender(gender)(r)).sort((a, b) => a.rollNo - b.rollNo);
  const papers = [...exam.subjects].sort((a, b) => (a.date ?? "9").localeCompare(b.date ?? "9"));
  const fine = exam.absenceFine ?? 0;
  const absentIn = (r: ExamsResultRow) => papers.filter((s) => r.marks[s.id] === "A").length;
  const totalAbsent = rows.reduce((a, r) => a + absentIn(r), 0);
  const leaves = rows.reduce((a, r) => a + papers.filter((s) => r.marks[s.id] === "L").length, 0);
  return (
    <article className="exams-doc exams-doc-a4" aria-label={`Absent report, ${section}`}>
      <DocHead campus={exam.campus} title="Absent report" sub={subParts(exam.name, section, genderText(gender), sessionOf(exam))} />
      <table style={{ fontSize: papers.length > 7 ? "8pt" : "9pt" }}>
        <thead>
          <tr>
            <th className="n">Sr#</th>
            <th>G.R. No.</th>
            <th>Student</th>
            {papers.map((s) => (
              <th key={s.id} className="c">
                {dayMonth(s.date) || "—"}
                <br />
                <span style={{ fontWeight: 400 }}>{s.name.length > 9 ? `${s.name.slice(0, 8)}.` : s.name}</span>
              </th>
            ))}
            <th className="n">Absent</th>
            <th className="n">Fine</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const n = absentIn(r);
            return (
              <tr key={r.id}>
                <td className="n">{i + 1}</td>
                <td className="mtb-mono">{r.id}</td>
                <td>{r.name}</td>
                {papers.map((s) => {
                  // A paper outside the student's group prints blank; a mark not entered yet shows a dash.
                  if (!examsSits(s, r.group)) return <td key={s.id} className="c" />;
                  const m = r.marks[s.id];
                  return (
                    <td key={s.id} className={m === "A" ? "c fail" : "c"}>
                      {m === null || m === undefined ? "—" : String(m)}
                    </td>
                  );
                })}
                <td className="n">{n}</td>
                <td className="n">{n * fine}</td>
              </tr>
            );
          })}
          <tr>
            <th colSpan={3} className="n">
              Total absent per paper
            </th>
            {papers.map((s) => (
              <th key={s.id} className="c">
                {rows.filter((r) => r.marks[s.id] === "A").length}
              </th>
            ))}
            <th className="n">{totalAbsent}</th>
            <th className="n">{totalAbsent * fine}</th>
          </tr>
        </tbody>
      </table>
      <p className="exams-doc-key">
        A = absent, L = leave. {fine > 0 ? `Fine ${formatRs(fine)} for each paper missed without leave; leave is never fined.` : "This exam type has no absence fine."} {leaves > 0 ? `${leaves} ${leaves === 1 ? "paper was" : "papers were"} missed on leave.` : ""}
      </p>
      <div className="exams-doc-signs">
        <div>Class teacher</div>
        <div>Controller of examinations</div>
        <div>Principal</div>
      </div>
      <Foot exam={exam} page={section} />
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
      <Foot exam={exam} />
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
      <DocHead campus={exam.campus} title="Script marking list (Shoba-e-Hifz)" titleUr="شعبہ حفظ" urdu sub={subParts(exam.name, sessionOf(exam))} />
      <dl className="exams-doc-info" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
        <div>
          <dt>Class and section</dt>
          <dd>{section}</dd>
        </div>
        <div>
          <dt>Teacher</dt>
          <dd>{teacher ?? <Fill w="36mm" />}</dd>
        </div>
        <div>
          <dt>Date</dt>
          <dd>{date ? formatDate(date) : <Fill />}</dd>
        </div>
        <div>
          <dt>Total marks</dt>
          <dd>{exam.totalMax}</dd>
        </div>
        <div>
          <dt>Students</dt>
          <dd>{rows.length}</dd>
        </div>
      </dl>
      <table>
        <thead>
          <tr>
            <th rowSpan={2} className="n">
              #
            </th>
            <th rowSpan={2}>G.R. No.</th>
            <th rowSpan={2}>Name</th>
            <th rowSpan={2}>Father's name</th>
            <th rowSpan={2} style={{ width: "26mm" }}>
              Decided syllabus
            </th>
            <th rowSpan={2} style={{ width: "26mm" }}>
              Completed syllabus
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
            {["T. marks", "Position", "Grade", "Attendance"].map((t) => (
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
      <div className="exams-doc-signs">
        <div>Teacher</div>
        <div>Head of Shoba-e-Hifz</div>
        <div>Principal</div>
      </div>
      <Foot exam={exam} page={section} />
    </article>
  );
}
