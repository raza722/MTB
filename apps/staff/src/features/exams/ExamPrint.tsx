import { examsOfGender, type ExamsGender } from "@mtb/api";
import { Banner, Button, Checkbox, Panel, Segmented, Select } from "@mtb/ui";
import { type ReactNode } from "react";
import {
  AbsentReport,
  AWARD_COLS,
  AwardList,
  AwardPair,
  DateSheetDoc,
  EnvelopeLabels,
  FailedList,
  HalfCards,
  hasPaperGroups,
  HifzSheet,
  MasterSheet,
  PositionList,
  ResultCard,
  RollSlips,
  SubjectPerformance,
  TeacherReport,
  type AwardCols,
  type MasterWho,
} from "./print/docs";
import { PrintSheet, printNow, type ExamPaper } from "./print/PrintSheet";
import { useExam } from "./shared";

export type ExamDoc = "card" | "master" | "positions" | "award" | "envelopes" | "slips" | "datesheet" | "failed" | "teachers" | "subjects" | "absent" | "hifz";

export interface ExamPrintSearch {
  doc?: ExamDoc;
  section?: string;
  /** Group (stream) filter for the master sheet, position and failed lists. */
  group?: string;
  /** A subject id; "ALL" prints every subject (award list). */
  subject?: string;
  student?: string;
  urdu?: boolean;
  /** half: two result cards a page. pair: two copies of the award list side by side. */
  layout?: "half" | "pair";
  top?: number;
  /** Boys or girls only. */
  gender?: ExamsGender;
  /** Positions worked out among the boys (or girls) listed only. */
  rerank?: boolean;
  /** Position list: top N of each section, under section headings. */
  perSection?: boolean;
  /** Award list columns. */
  cols?: AwardCols;
  /** Monthly award sheet: number of date columns. */
  dates?: number;
  /** Award list: leave date, subject and maximum marks blank. */
  blank?: boolean;
  /** Master sheet: guardian's mobile column. */
  contact?: boolean;
  /** Master sheet: re-sit (supply) holders or failed students only. */
  who?: MasterWho;
  /** Master sheet: highest % first. */
  order?: "position";
  /** Hifz sheet: print the marks entered so far. */
  filled?: boolean;
}

export const EXAM_DOCS: Array<{ id: ExamDoc; label: string; detail: string; paper: ExamPaper; results: boolean }> = [
  { id: "card", label: "Result cards", detail: "One student or a whole section, A4. English or English with Urdu headings.", paper: "A4", results: true },
  { id: "master", label: "Master sheet", detail: "Every student × subject with total, %, grade, position, failed subjects and subject averages. Also the supply holder sheet. A4 landscape.", paper: "A4L", results: true },
  { id: "positions", label: "Position list", detail: "Top 3, 5, 10, 20 or everyone, for the class or the top of each section.", paper: "A4", results: true },
  { id: "failed", label: "Re-sit and failed list", detail: "Students below the pass rules by section, with marks, grade and the subjects to re-sit.", paper: "A4", results: true },
  { id: "subjects", label: "Subject performance", detail: "Highest, lowest, absent, average, failures and pass % per subject, with grade counts. A4 landscape.", paper: "A4L", results: true },
  { id: "teachers", label: "Subject teacher report", detail: "Average and pass rate of each teacher's papers.", paper: "A4", results: true },
  { id: "absent", label: "Absent report", detail: "Each paper's mark or A, absences and fine per student, one section a page.", paper: "A4", results: false },
  { id: "award", label: "Award list", detail: "Script marking list: one section or every section, one subject or every subject. Signature, subjective/objective or monthly columns.", paper: "A4", results: false },
  { id: "hifz", label: "Hifz marking sheet", detail: "Shoba-e-Hifz sheet: syllabus, Manzil and Dua parts with totals, position and grade. A4 landscape.", paper: "A4L", results: false },
  { id: "slips", label: "Roll number slips", detail: "Admit slips with the date sheet, three to a page.", paper: "A4", results: false },
  { id: "envelopes", label: "Envelope labels", detail: "Labels for the answer-script packets, eight to a page. Every paper or the day's paper.", paper: "A4", results: false },
  { id: "datesheet", label: "Date sheet", detail: "For parents, in English or with Urdu headings.", paper: "A4", results: false },
];

/** Documents that can be cut to boys or girls. */
const GENDER_DOCS: ExamDoc[] = ["card", "master", "positions", "failed", "subjects", "teachers", "absent", "award"];

/** Print centre for one exam: pick a document, set its options, check the preview, print. */
export function ExamPrint({ search, onSearch }: { search: ExamPrintSearch; onSearch: (next: ExamPrintSearch) => void }) {
  const exam = useExam();
  // The Hifz sheet only for exams with numbered paper groups (Manzil 1–7).
  const docs = EXAM_DOCS.filter((d) => d.id !== "hifz" || hasPaperGroups(exam));
  const doc = docs.find((d) => d.id === search.doc) ?? docs[0]!;
  const allowAll = doc.id !== "slips";
  const section = search.section && exam.classes.includes(search.section) ? search.section : allowAll && exam.classes.length > 1 && doc.id !== "card" ? "ALL" : exam.classes[0]!;
  const allSubjects = doc.id === "award" && search.subject === "ALL";
  const subject = exam.subjects.find((s) => s.id === search.subject) ?? exam.subjects[0]!;
  const groups = exam.groups ?? [];
  const groupFilter = (doc.id === "master" || doc.id === "positions" || doc.id === "failed") && groups.length > 0;
  const group = groupFilter && search.group && groups.includes(search.group) ? search.group : "ALL";
  // Boys or girls: only when the candidates have a gender (not applicants).
  const genderFilter = GENDER_DOCS.includes(doc.id) && exam.rows.some((r) => r.gender);
  const gender = genderFilter ? search.gender : undefined;
  const rowsInSection = exam.rows.filter((r) => (section === "ALL" || r.classSection === section) && examsOfGender(gender)(r)).sort((a, b) => a.classSection.localeCompare(b.classSection) || a.rollNo - b.rollNo);
  const student = search.student ? rowsInSection.find((r) => r.id === search.student) : undefined;
  const top = search.top ?? 10;
  const set = (patch: Partial<ExamPrintSearch>) => onSearch({ ...search, ...patch });
  const incomplete = exam.missingMarks > 0;
  const sections = section === "ALL" ? exam.classes : [section];
  const cols = search.cols ?? "marks";
  const pair = doc.id === "award" && search.layout === "pair";

  let body: ReactNode;
  let count = 1;
  switch (doc.id) {
    case "card": {
      const rows = student ? [student] : rowsInSection;
      count = search.layout === "half" ? Math.ceil(rows.length / 2) : rows.length;
      body = search.layout === "half" ? <HalfCards exam={exam} rows={rows} urdu={search.urdu} /> : rows.map((r) => <ResultCard key={r.id} exam={exam} row={r} urdu={search.urdu} />);
      break;
    }
    case "master":
      body = <MasterSheet exam={exam} section={section} group={group} gender={gender} contact={search.contact} who={search.who} order={search.order} />;
      break;
    case "positions":
      body = <PositionList exam={exam} section={section} top={top} group={group} gender={gender} rerankOn={search.rerank} perSection={search.perSection} />;
      break;
    case "failed":
      body = <FailedList exam={exam} section={section} group={group} gender={gender} />;
      break;
    case "subjects":
      body = <SubjectPerformance exam={exam} section={section} gender={gender} />;
      break;
    case "teachers":
      body = <TeacherReport exam={exam} section={section} gender={gender} />;
      break;
    case "absent":
      count = sections.length;
      body = sections.map((cs) => <AbsentReport key={cs} exam={exam} section={cs} gender={gender} />);
      break;
    case "award": {
      // One list per section × subject; "Whole class" and "Every subject" print them all in one go.
      const subjects = search.blank ? [null] : allSubjects ? exam.subjects : [subject];
      const lists = sections.flatMap((cs) => subjects.map((s) => ({ cs, s })));
      count = lists.length;
      body = lists.map(({ cs, s }) => {
        const props = { exam, section: cs, subject: s, teacher: s ? (exam.papers?.find((p) => p.classSection === cs && p.subjectId === s.id)?.teacher ?? null) : null, gender, cols, dates: search.dates };
        return pair ? <AwardPair key={`${cs}-${s?.id ?? "blank"}`} {...props} /> : <AwardList key={`${cs}-${s?.id ?? "blank"}`} {...props} />;
      });
      break;
    }
    case "hifz":
      count = sections.length;
      body = sections.map((cs) => <HifzSheet key={cs} exam={exam} section={cs} filled={search.filled} />);
      break;
    case "slips":
      count = Math.ceil(rowsInSection.length / 3);
      body = <RollSlips exam={exam} section={section} urdu={search.urdu} />;
      break;
    case "envelopes": {
      const n = sections.length * (search.subject && search.subject !== "ALL" ? 1 : exam.subjects.length);
      count = Math.ceil(n / 8);
      body = <EnvelopeLabels exam={exam} sections={sections} subjectId={search.subject && search.subject !== "ALL" ? subject.id : undefined} />;
      break;
    }
    case "datesheet":
      body = <DateSheetDoc exam={exam} urdu={search.urdu} />;
      break;
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
      <div className="grid content-start gap-4">
        <Panel id="print-docs" title="Document" rise={0}>
          <div className="grid gap-2" role="radiogroup" aria-label="Document to print">
            {docs.map((d) => (
              <label key={d.id} className={`flex cursor-pointer gap-3 rounded-md border px-3 py-2 ${d.id === doc.id ? "border-brand bg-brand-tint" : "border-border hover:bg-surface-hover"}`}>
                <input
                  type="radio"
                  className="mt-1 accent-[var(--brand)]"
                  name="exam-doc"
                  checked={d.id === doc.id}
                  onChange={() => onSearch({ doc: d.id, ...(search.section ? { section: search.section } : {}), ...(search.gender ? { gender: search.gender } : {}) })}
                />
                <span className="grid">
                  <span className="font-medium">{d.label}</span>
                  <span className="text-small text-ink-muted">{d.detail}</span>
                </span>
              </label>
            ))}
          </div>
        </Panel>
        <Panel id="print-options" title="Options" rise={1}>
          <div className="grid gap-4">
            {doc.id !== "datesheet" && (
              <Select
                label="Section"
                value={section}
                onChange={(e) => set({ section: e.target.value, student: undefined })}
                options={[...(allowAll && exam.classes.length > 1 ? [{ value: "ALL", label: doc.id === "award" || doc.id === "absent" || doc.id === "hifz" ? "Every section (one page each)" : "Whole class" }] : []), ...exam.classes.map((c) => ({ value: c, label: c }))]}
              />
            )}
            {genderFilter && (
              <Select
                label="Boys or girls"
                value={gender ?? ""}
                onChange={(e) => set({ gender: e.target.value === "M" || e.target.value === "F" ? e.target.value : undefined, student: undefined })}
                options={[
                  { value: "", label: "Boys and girls" },
                  { value: "M", label: "Boys only" },
                  { value: "F", label: "Girls only" },
                ]}
              />
            )}
            {doc.id === "card" && (
              <>
                <Select label="Student" value={student?.id ?? ""} onChange={(e) => set({ student: e.target.value || undefined })} options={[{ value: "", label: `Everyone (${rowsInSection.length} cards)` }, ...rowsInSection.map((r) => ({ value: r.id, label: `${r.rollNo}. ${r.name}` }))]} />
                <Segmented aria-label="Cards per page" value={search.layout ?? "full"} onChange={(v) => set({ layout: v === "half" ? "half" : undefined })} options={[{ value: "full", label: "One per page" }, { value: "half", label: "Two per page" }]} />
              </>
            )}
            {groupFilter && (
              <Select label="Group" value={group} onChange={(e) => set({ group: e.target.value === "ALL" ? undefined : e.target.value })} options={[{ value: "ALL", label: "Every group" }, ...groups.map((g) => ({ value: g, label: g }))]} />
            )}
            {doc.id === "master" && (
              <>
                <Select
                  label="Who"
                  value={search.who ?? ""}
                  onChange={(e) => set({ who: e.target.value === "resit" || e.target.value === "failed" ? e.target.value : undefined })}
                  help={search.who === "resit" ? "Prints the supply holder sheet." : undefined}
                  options={[
                    { value: "", label: "Everyone" },
                    { value: "resit", label: "Re-sit (supply) holders only" },
                    { value: "failed", label: "Failed only" },
                  ]}
                />
                <Segmented aria-label="Order" value={search.order ?? "roll"} onChange={(v) => set({ order: v === "position" ? "position" : undefined })} options={[{ value: "roll", label: "By roll" }, { value: "position", label: "By position" }]} />
                <Checkbox label="Contact column (guardian's mobile)" checked={Boolean(search.contact)} onChange={(e) => set({ contact: e.target.checked || undefined })} />
              </>
            )}
            {doc.id === "award" && (
              <>
                <Select
                  label="Subject"
                  value={search.blank ? "BLANK" : allSubjects ? "ALL" : subject.id}
                  onChange={(e) => (e.target.value === "BLANK" ? set({ blank: true, subject: undefined }) : set({ blank: undefined, subject: e.target.value }))}
                  options={[
                    ...(exam.subjects.length > 1 ? [{ value: "ALL", label: "Every subject (one list each)" }] : []),
                    ...exam.subjects.map((s) => ({ value: s.id, label: `${s.name} · out of ${s.maxMarks}${s.groups?.length ? ` · ${s.groups.join(", ")} only` : ""}` })),
                    { value: "BLANK", label: "Leave subject, date and marks blank" },
                  ]}
                />
                <Select
                  label="Columns"
                  value={pair ? "sign" : cols}
                  disabled={pair}
                  help={pair ? "Two copies a page always use signature and obtained." : undefined}
                  onChange={(e) => {
                    const v = AWARD_COLS.find((c) => c.value === e.target.value)?.value;
                    set({ cols: v && v !== "marks" ? v : undefined });
                  }}
                  options={AWARD_COLS}
                />
                {cols === "monthly" && !pair && (
                  <Select label="Date columns" value={String(search.dates ?? 5)} onChange={(e) => set({ dates: Number(e.target.value) === 5 ? undefined : Number(e.target.value) })} options={["3", "4", "5", "6"]} />
                )}
                <Segmented aria-label="Copies per page" value={pair ? "pair" : "one"} onChange={(v) => set({ layout: v === "pair" ? "pair" : undefined })} options={[{ value: "one", label: "One per page" }, { value: "pair", label: "Two copies a page" }]} />
              </>
            )}
            {doc.id === "envelopes" && (
              <Select
                label="Paper"
                value={search.subject && search.subject !== "ALL" ? subject.id : "ALL"}
                onChange={(e) => set({ subject: e.target.value === "ALL" ? undefined : e.target.value })}
                options={[{ value: "ALL", label: "Every paper" }, ...exam.subjects.map((s) => ({ value: s.id, label: `${s.name}${s.date ? ` · ${s.date.slice(8)}-${s.date.slice(5, 7)}` : ""}` }))]}
              />
            )}
            {doc.id === "positions" && (
              <>
                <Segmented
                  aria-label="How many"
                  value={String(top)}
                  onChange={(v) => set({ top: Number(v) })}
                  options={[
                    { value: "3", label: "Top 3" },
                    { value: "5", label: "Top 5" },
                    { value: "10", label: "Top 10" },
                    { value: "20", label: "Top 20" },
                    { value: "0", label: "Everyone" },
                  ]}
                />
                {exam.classes.length > 1 && section === "ALL" && <Checkbox label="Top of each section, under section headings" checked={Boolean(search.perSection)} onChange={(e) => set({ perSection: e.target.checked || undefined })} />}
                {gender && <Checkbox label={`Positions among ${gender === "M" ? "boys" : "girls"} only`} checked={Boolean(search.rerank)} onChange={(e) => set({ rerank: e.target.checked || undefined })} />}
              </>
            )}
            {doc.id === "hifz" && (
              <Segmented aria-label="Marks on the sheet" value={search.filled ? "filled" : "blank"} onChange={(v) => set({ filled: v === "filled" || undefined })} options={[{ value: "blank", label: "Blank for marking" }, { value: "filled", label: "With marks entered" }]} />
            )}
            {(doc.id === "card" || doc.id === "datesheet" || doc.id === "slips") && <Checkbox label="Urdu headings too" checked={Boolean(search.urdu)} onChange={(e) => set({ urdu: e.target.checked || undefined })} />}
            <Button variant="primary" icon="printer" onClick={printNow}>
              Print {count > 1 ? `${count} pages` : ""}
            </Button>
          </div>
        </Panel>
      </div>
      <div className="grid content-start gap-3">
        {doc.results && exam.status !== "DECLARED" && (
          <Banner tone={incomplete ? "warning" : "info"} title={incomplete ? "Marks are still missing." : "Results aren't declared yet."}>
            This prints as PROVISIONAL{incomplete ? "; students with missing marks show as incomplete" : ""}. Declare the results for final copies.
          </Banner>
        )}
        {doc.id === "absent" && incomplete && (
          <Banner tone="info" title="Some marks are not entered yet.">
            They show as a dash. A and L are counted once entered.
          </Banner>
        )}
        <PrintSheet paper={doc.paper} label={`${doc.label} preview`}>
          {body}
        </PrintSheet>
      </div>
    </div>
  );
}
