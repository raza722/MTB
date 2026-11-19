import { EXAMS_CATEGORY_LABEL, examsGroupShort, examsOfGender, examsQueries, type CampusCode, type ExamsCombined, type ExamsCombinedMode, type ExamsCombinedRow, type ExamsGender, type ExamsMark } from "@mtb/api";
import { formatDate, formatPercent, formatSession, pakistanToday } from "@mtb/domain";
import { Banner, Button, Checkbox, DataTable, EmptyState, Input, Panel, Segmented, Select, Skeleton, StatusBadge, type Column } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { z } from "zod";
import { campusLabel } from "../../app/shell/campus";
import { Page, PageHeader } from "../../app/shell/page";
import { useCtx } from "../../app/session";
import { classWord, DocHead, Fields, pctText, PositionTable, sessionLong, spacedDate, splitSection } from "./print/docs";
import { PrintSheet, printNow } from "./print/PrintSheet";
import { ExamsNav, LoadError, ordinal, ResultBadge } from "./shared";

const weightsSchema = z
  .array(z.object({ examId: z.string(), weight: z.number().int("Use whole numbers.").min(1, "At least 1%.") }))
  .min(1, "Tick at least one exam.")
  .refine((list) => list.reduce((a, p) => a + p.weight, 0) === 100, { message: "The weights must add up to 100%." });

type PrintDoc = "sheet" | "cards" | "positions" | "failed";

const PRINT_DOCS: Array<{ value: PrintDoc; label: string }> = [
  { value: "sheet", label: "Class sheet" },
  { value: "cards", label: "Result cards" },
  { value: "positions", label: "Positions" },
  { value: "failed", label: "Failed list" },
];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1] ?? ""} ${m.slice(0, 4)}`;

/** Combined (cumulative) results: two or more exams of one class weighted into one result, e.g. First Term 40% + Annual 60%. */
export function CombinedPage() {
  const ctx = useCtx();
  const options = useQuery(examsQueries.combinable(ctx));
  const [classKey, setClassKey] = useState("");
  const [chosen, setPicked] = useState<Record<string, string> | null>(null);
  const [applied, setApplied] = useState<Array<{ examId: string; weight: number }>>([]);
  const [mode, setMode] = useState<ExamsCombinedMode>("WEIGHTED");
  const [includeLast, setIncludeLast] = useState(false);
  const [appliedOpts, setAppliedOpts] = useState<{ mode: ExamsCombinedMode; includeLast: boolean }>({ mode: "WEIGHTED", includeLast: false });
  const [tried, setTried] = useState(false);
  const [section, setSection] = useState("ALL");
  const [genderPick, setGender] = useState("");
  const [show, setShow] = useState<"ALL" | "FAILED">("ALL");
  const [printDoc, setPrintDoc] = useState<PrintDoc | null>(null);
  const [cardStudent, setCardStudent] = useState("");
  const [top, setTop] = useState(3);
  const combined = useQuery(examsQueries.combined(ctx, applied, appliedOpts));

  const groups = options.data ?? [];
  const group = groups.find((g) => g.classShort === classKey) ?? groups[0];
  // Until the user changes anything, every exam of the class is ticked with equal weights.
  const picked = chosen ?? (group ? evenWeights(group.exams.filter((e) => e.category !== "BOARD").map((e) => e.id)) : {});
  const chooseClass = (key: string) => {
    setClassKey(key);
    setPicked(null);
    setApplied([]);
    setSection("ALL");
    setPrintDoc(null);
  };
  const parts = Object.entries(picked).map(([examId, w]) => ({ examId, weight: Number(w) }));
  const check = weightsSchema.safeParse(parts);
  const sum = parts.reduce((a, p) => a + (Number.isFinite(p.weight) ? p.weight : 0), 0);
  // Month quick-pick: that month's class tests (the old monthly class-test report).
  const testMonths = [...new Set((group?.exams ?? []).filter((e) => e.category === "TEST").map((e) => e.startDate.slice(0, 7)))].sort();
  const pickMonth = (m: string) => {
    if (!m || !group) return;
    setPicked(evenWeights(group.exams.filter((e) => e.category === "TEST" && e.startDate.startsWith(m)).map((e) => e.id)));
  };
  const pickedMonth = testMonths.find((m) => {
    const ids = (group?.exams ?? []).filter((e) => e.category === "TEST" && e.startDate.startsWith(m)).map((e) => e.id);
    return ids.length > 0 && ids.length === Object.keys(picked).length && ids.every((id) => id in picked);
  });

  const data = combined.data;
  const hasGender = Boolean(data?.rows.some((r) => r.gender));
  const gender: ExamsGender | undefined = hasGender && (genderPick === "M" || genderPick === "F") ? genderPick : undefined;
  const sectionsOf = data ? [...new Set(data.rows.map((r) => r.classSection))].sort() : [];
  const visible = (data?.rows ?? []).filter((r) => (section === "ALL" || r.classSection === section) && examsOfGender(gender)(r) && (show === "ALL" || r.result === "FAIL"));
  const campus: CampusCode = ctx.campus === "ALL" ? "KC" : ctx.campus;

  return (
    <Page>
      <PageHeader title="Combined results" />
      <ExamsNav />
      {options.isError && <LoadError what="Exams" error={options.error} onRetry={() => void options.refetch()} />}
      <Panel
        id="combined-pick"
        title="Exams to combine"
        description="Choose a class, tick its exams and give each a weight. The combined % is the weighted average; a fail in any part is a fail overall. Drafts show as provisional."
        rise={0}
      >
        {options.isLoading ? (
          <Skeleton height={160} />
        ) : groups.length === 0 ? (
          <EmptyState icon="layers" title={`No exams for ${campusLabel(ctx.campus)} in ${formatSession(ctx.session)}`} description="Combined results appear once a class has exams." />
        ) : (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-full sm:w-64">
                <Select label="Class" value={group?.classShort ?? ""} onChange={(e) => chooseClass(e.target.value)} options={groups.map((g) => ({ value: g.classShort, label: `${g.className} · ${g.exams.length} ${g.exams.length === 1 ? "exam" : "exams"}` }))} />
              </div>
              {testMonths.length > 0 && (
                <div className="w-full sm:w-64">
                  <Select
                    label="A month's class tests"
                    value={pickedMonth ?? ""}
                    onChange={(e) => pickMonth(e.target.value)}
                    help="Ticks every class test of that month."
                    options={[{ value: "", label: "Choose a month" }, ...testMonths.map((m) => ({ value: m, label: `${monthLabel(m)} · ${(group?.exams ?? []).filter((e) => e.category === "TEST" && e.startDate.startsWith(m)).length} tests` }))]}
                  />
                </div>
              )}
              {/* A class can have nearly 200 exams, all ticked to start with: one press clears them to tick a few by hand. */}
              <Button onClick={() => setPicked({})} disabled={Object.keys(picked).length === 0}>
                Untick all
              </Button>
            </div>
            <ul className="m-0 grid list-none gap-2 p-0">
              {group?.exams.map((e) => {
                const on = e.id in picked;
                return (
                  <li key={e.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border px-3 py-2">
                    <Checkbox
                      label={
                        <span className="grid">
                          <span className="font-medium">{e.name}</span>
                          <span className="text-small text-ink-muted">
                            {EXAMS_CATEGORY_LABEL[e.category]} · {formatDate(e.startDate)} · {e.totalMax} marks
                          </span>
                        </span>
                      }
                      checked={on}
                      onChange={(ev) => setPicked(evenWeights(ev.target.checked ? [...Object.keys(picked), e.id] : Object.keys(picked).filter((x) => x !== e.id)))}
                    />
                    <span className="flex-1" />
                    {e.status === "DECLARED" ? <StatusBadge status="declared" icon="lock" /> : <StatusBadge status="draft" />}
                    <div className="w-28">
                      <Input aria-label={`${e.name} weight`} value={picked[e.id] ?? ""} disabled={!on || mode === "AVERAGE"} suffix="%" inputMode="numeric" amount onChange={(ev) => setPicked({ ...picked, [e.id]: ev.target.value.replace(/\D/g, "") })} />
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap items-center gap-4">
              <Segmented
                aria-label="How to combine"
                value={mode}
                onChange={(v) => {
                  const next = v === "AVERAGE" ? "AVERAGE" : "WEIGHTED";
                  setMode(next);
                  if (next === "AVERAGE") setPicked(evenWeights(Object.keys(picked)));
                }}
                options={[
                  { value: "WEIGHTED", label: "Weighted" },
                  { value: "AVERAGE", label: "Average of the tests each student has" },
                ]}
              />
              <Checkbox label="Add last session's final result (not counted)" checked={includeLast} onChange={(e) => setIncludeLast(e.target.checked)} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className={sum === 100 ? "text-small text-ink-muted" : "text-small font-medium text-danger-ink"} aria-live="polite">
                {mode === "AVERAGE" ? "Each student's tests count equally; a missing test is left out instead of making the result incomplete." : `Weights add up to ${sum}%${sum === 100 ? "" : " — they must add up to 100%."}`}
              </span>
              <Button
                variant="primary"
                icon="layers"
                onClick={() => {
                  setTried(true);
                  if (check.success) {
                    setApplied(parts);
                    setAppliedOpts({ mode, includeLast });
                  }
                }}
              >
                Show combined result
              </Button>
            </div>
            {tried && !check.success && <Banner tone="danger">{check.error.issues[0]?.message}</Banner>}
          </div>
        )}
      </Panel>

      {applied.length > 0 && (
        <Panel
          id="combined-result"
          title="Combined result"
          description={
            data
              ? `${data.parts.map((p) => (data.mode === "AVERAGE" ? p.name : `${p.name} ${p.weight}%`)).join(data.mode === "AVERAGE" ? ", " : " + ")}${data.mode === "AVERAGE" ? " · average of the tests each student has" : ""} · ${visible.length} ${visible.length === 1 ? "student" : "students"}${data.lastExam ? ` · last exam: ${data.lastExam.name}` : data.lastExam === null ? " · no final result last session" : ""}`
              : "Working it out…"
          }
          rise={1}
          flush
          actions={
            data && (
              <>
                {sectionsOf.length > 1 && <Segmented aria-label="Section" value={section} onChange={setSection} options={[{ value: "ALL", label: "Whole class" }, ...sectionsOf.map((s) => ({ value: s, label: s }))]} />}
                {hasGender && (
                  <Segmented
                    aria-label="Boys or girls"
                    value={gender ?? ""}
                    onChange={setGender}
                    options={[
                      { value: "", label: "Boys and girls" },
                      { value: "M", label: "Boys" },
                      { value: "F", label: "Girls" },
                    ]}
                  />
                )}
                <Segmented aria-label="Show" value={show} onChange={(v) => setShow(v === "FAILED" ? "FAILED" : "ALL")} options={[{ value: "ALL", label: "Everyone" }, { value: "FAILED", label: "Failed only" }]} />
                <Button size="sm" icon="printer" onClick={() => setPrintDoc((p) => (p ? null : show === "FAILED" ? "failed" : "sheet"))}>
                  {printDoc ? "Hide print preview" : "Print"}
                </Button>
              </>
            )
          }
        >
          {combined.isError ? (
            <div className="p-4">
              <LoadError what="The combined result" error={combined.error} onRetry={() => void combined.refetch()} />
            </div>
          ) : (
            <CombinedTable data={data} rows={visible} loading={combined.isLoading} section={section} failedOnly={show === "FAILED"} />
          )}
        </Panel>
      )}
      {printDoc && data && (
        <Panel id="combined-print" title="Print" description="Choose what to print. Cards print one A4 page per student." rise={2}>
          <div className="grid gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <Segmented aria-label="Document" value={printDoc} onChange={(v) => setPrintDoc(PRINT_DOCS.find((d) => d.value === v)?.value ?? "sheet")} options={PRINT_DOCS} />
              {printDoc === "cards" && (
                <div className="w-full sm:w-72">
                  <Select
                    label="Student"
                    value={visible.some((r) => r.id === cardStudent) ? cardStudent : ""}
                    onChange={(e) => setCardStudent(e.target.value)}
                    options={[{ value: "", label: `Everyone shown (${visible.length} cards)` }, ...visible.map((r) => ({ value: r.id, label: `${r.classSection} · ${r.rollNo ? `${r.rollNo}. ` : ""}${r.name} · ${r.id}` }))]}
                  />
                </div>
              )}
              {printDoc === "positions" && (
                <Segmented
                  aria-label="How many in each section"
                  value={String(top)}
                  onChange={(v) => setTop(Number(v))}
                  options={[
                    { value: "3", label: "Top 3" },
                    { value: "5", label: "Top 5" },
                    { value: "10", label: "Top 10" },
                  ]}
                />
              )}
              <Button variant="primary" icon="printer" onClick={printNow}>
                Print
              </Button>
            </div>
            <PrintSheet paper={printDoc === "sheet" ? "A4L" : "A4"} footer={printDoc !== "cards" || data.parts.every((p) => p.category === "TEST")} label="Combined result preview">
              {printDoc === "sheet" && <CombinedDoc data={data} rows={visible} section={section} gender={gender} failedOnly={show === "FAILED"} campus={campus} session={ctx.session} />}
              {printDoc === "cards" &&
                (cardStudent && visible.some((r) => r.id === cardStudent) ? visible.filter((r) => r.id === cardStudent) : visible).map((r) => (
                  <CombinedCard key={r.id} data={data} row={r} strength={data.rows.filter((x) => x.classSection === r.classSection).length} campus={campus} session={ctx.session} />
                ))}
              {printDoc === "positions" && <CombinedPositions data={data} rows={visible.filter((r) => r.percent !== null)} top={top} gender={gender} campus={campus} session={ctx.session} />}
              {printDoc === "failed" && <CombinedFailed data={data} rows={visible.filter((r) => r.result === "FAIL")} gender={gender} campus={campus} session={ctx.session} />}
            </PrintSheet>
          </div>
        </Panel>
      )}
    </Page>
  );
}

function evenWeights(ids: string[]): Record<string, string> {
  if (!ids.length) return {};
  const base = Math.floor(100 / ids.length);
  return Object.fromEntries(ids.map((id, i) => [id, String(i === ids.length - 1 ? 100 - base * (ids.length - 1) : base)]));
}

const marksText = (r: ExamsCombinedRow) => (r.max ? `${r.obtained ?? 0}/${r.max}` : "—");
const partsTitle = (data: ExamsCombined) => data.parts.map((p) => (data.mode === "AVERAGE" ? p.name : `${p.name} ${p.weight}%`)).join(data.mode === "AVERAGE" ? ", " : " + ");
const genderWord = (g: ExamsGender | undefined) => (g === "M" ? "Boys" : g === "F" ? "Girls" : "");

function CombinedTable({ data, rows: given, loading, section, failedOnly }: { data: ExamsCombined | undefined; rows: ExamsCombinedRow[]; loading: boolean; section: string; failedOnly: boolean }) {
  const rows = [...given].sort((a, b) => ((section === "ALL" ? a.classPosition : a.position) ?? 999) - ((section === "ALL" ? b.classPosition : b.position) ?? 999) || a.name.localeCompare(b.name));
  const withLast = Boolean(data?.rows.some((r) => r.lastPercent !== undefined));
  const columns: Array<Column<ExamsCombinedRow>> = [
    {
      key: "name",
      header: "Student",
      width: 220,
      render: (r) => (
        <span className="grid">
          <span className="mtb-cell-primary">{r.name}</span>
          <span className="mtb-cell-secondary">
            {r.classSection} · <span className="mtb-mono">{r.id}</span>
            {r.group ? ` · ${examsGroupShort(r.group)}` : ""}
          </span>
        </span>
      ),
    },
    ...(withLast ? [{ key: "last", header: "Last exam %", align: "right" as const, width: 110, render: (r: ExamsCombinedRow) => (r.lastPercent == null ? <span className="text-small text-ink-muted">None</span> : <span className="mtb-num">{formatPercent(r.lastPercent)}</span>) }] : []),
    ...(data?.parts ?? []).map<Column<ExamsCombinedRow>>((p) => ({
      key: p.id,
      header: (
        <span>
          {p.name} {data?.mode === "AVERAGE" ? null : <span className="normal-case">· {p.weight}%</span>}
        </span>
      ),
      align: "right",
      render: (r) => (r.parts[p.id] ? <span className="mtb-num">{formatPercent(r.parts[p.id]!.percent)}</span> : <span className="text-small text-ink-muted">No result</span>),
    })),
    { key: "marks", header: "Marks", align: "right", width: 110, render: (r) => <span className="mtb-num">{marksText(r)}</span> },
    { key: "pct", header: data?.mode === "AVERAGE" ? "Average %" : "Combined %", align: "right", width: 110, render: (r) => (r.percent === null ? "—" : <span className="mtb-num font-semibold">{formatPercent(r.percent)}</span>) },
    { key: "grade", header: "Grade", width: 70, render: (r) => r.grade ?? "—" },
    { key: "pos", header: section === "ALL" ? "Class pos." : "Section pos.", align: "right", width: 96, render: (r) => (section === "ALL" ? r.classPosition : r.position) ?? "—" },
    { key: "result", header: "Result", width: 100, render: (r) => <ResultBadge result={r.result} /> },
  ];
  return (
    <DataTable
      caption="Combined result"
      columns={columns}
      rows={rows}
      loading={loading}
      density="dense"
      maxHeight={560}
      empty={failedOnly ? <EmptyState icon="checkCircle" title="No one failed" description="Every student shown passed the combined result." /> : <EmptyState icon="layers" title="No students" description="These exams have no students in common." />}
    />
  );
}

function CombinedDoc({ data, rows: given, section, gender, failedOnly, campus, session }: { data: ExamsCombined; rows: ExamsCombinedRow[]; section: string; gender: ExamsGender | undefined; failedOnly: boolean; campus: CampusCode; session: number }) {
  const rows = [...given].sort((a, b) => a.classSection.localeCompare(b.classSection) || a.rollNo - b.rollNo);
  const withLast = data.rows.some((r) => r.lastPercent !== undefined);
  const grouped = rows.some((r) => r.group);
  return (
    <article className="exams-doc exams-doc-land" aria-label="Combined result sheet">
      <DocHead
        campus={campus}
        title={failedOnly ? "Combined result: failed students" : "Combined result"}
        sub={[partsTitle(data), section === "ALL" ? "" : section, genderWord(gender), `Session ${formatSession(session)}`, `Total students ${rows.length}`].filter(Boolean).join(" · ")}
      />
      <table>
        <thead>
          <tr>
            <th>Sec.</th>
            <th className="n">Roll</th>
            <th>G.R. No.</th>
            <th>Student</th>
            <th>Father's name</th>
            {grouped && <th>Grp</th>}
            {withLast && <th className="n">Last exam %</th>}
            {data.parts.map((p) => (
              <th key={p.id} className="n">
                {p.name}
                {data.mode === "AVERAGE" ? null : (
                  <>
                    <br />
                    <span style={{ fontWeight: 400 }}>{p.weight}%</span>
                  </>
                )}
              </th>
            ))}
            <th className="n">Marks</th>
            <th className="n">{data.mode === "AVERAGE" ? "Average %" : "Combined %"}</th>
            <th className="c">Grade</th>
            <th className="n">Pos.</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.classSection}</td>
              <td className="n">{r.rollNo}</td>
              <td className="mtb-mono">{r.id}</td>
              <td>{r.name}</td>
              <td>{r.father ?? ""}</td>
              {grouped && <td>{examsGroupShort(r.group)}</td>}
              {withLast && <td className="n">{r.lastPercent == null ? "" : r.lastPercent.toFixed(1)}</td>}
              {data.parts.map((p) => (
                <td key={p.id} className="n">
                  {r.parts[p.id] ? r.parts[p.id]!.percent.toFixed(1) : "—"}
                </td>
              ))}
              <td className="n">{marksText(r)}</td>
              <td className="n">{r.percent === null ? "—" : r.percent.toFixed(1)}</td>
              <td className="c">{r.grade ?? "—"}</td>
              <td className="n">{(section === "ALL" ? r.classPosition : r.position) ?? "—"}</td>
              <td className={r.result === "FAIL" ? "fail" : undefined}>{r.result === "PASS" ? "Pass" : r.result === "FAIL" ? "Fail" : "Incomplete"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {withLast && <p className="exams-doc-key">Last exam % is each student's final result last session{data.lastExam ? ` (${data.lastExam.name})` : ""}. It is not counted in the combined result.</p>}
      <div className="exams-doc-signs">
        <div>Prepared by</div>
        <div>Controller of examinations</div>
        <div>Principal</div>
      </div>
    </article>
  );
}

const markCell = (m: ExamsMark | undefined) => (m === null || m === undefined ? "" : String(m));

/**
 * One student's consolidated result sheet (terms) or class test report (tests), as the old system printed them: the
 * boxed "Consolidated Result Sheet" with each exam's and the cumulative Obtained / Max. per subject, then Total Marks,
 * Percentage, Grade, Position and Remarks, the class strength and two signature lines; or the "Class Test Report" with
 * Obt. Marks/Total and %age per test, the total and the no-signature note.
 */
function CombinedCard({ data, row, strength, campus, session }: { data: ExamsCombined; row: ExamsCombinedRow; strength: number; campus: CampusCode; session: number }) {
  const tests = data.parts.every((p) => p.category === "TEST");
  const subjects = (data.subjects ?? []).filter((s) => row.bySubject?.[s.id]);
  const months = [...new Set(data.parts.map((p) => p.startDate?.slice(0, 7)).filter((m): m is string => Boolean(m)))];
  const pct = (o: number, m: number) => (m ? pctText((o / m) * 100, tests ? 0 : 1) : "");
  const resultText = (r: string | undefined) => (r === "PASS" ? "Pass" : r === "SUPPLY" ? "Re-sit" : r === "FAIL" ? "Fail" : r === "WITHHELD" ? "Withheld" : "Incomplete");
  const { cls, sec } = splitSection(row.classSection);
  const partHead = (p: (typeof data.parts)[number]) => `${p.name}${data.mode === "AVERAGE" || data.parts.length === 1 ? "" : ` (${p.weight}%)`}`;
  const keys = [...data.parts.map((p) => p.id), "cum"];
  const provisional = data.parts.some((p) => p.status !== "DECLARED");

  if (tests)
    return (
      <article className="exams-doc exams-doc-a4" aria-label={`Class test report, ${row.name}`}>
        {provisional && <span className="exams-doc-mark">PROVISIONAL</span>}
        <DocHead campus={campus} title="Class Test Report" />
        <div className="exams-cons-info" style={{ gridTemplateColumns: "auto 1fr auto 1fr" }}>
          <b>Student&apos;s Name:</b>
          <span>{row.name}</span>
          <b>Gr.No:</b>
          <span>{row.id}</span>
          <b>Father&apos;s Name :</b>
          <span>{row.father ?? ""}</span>
          <b>Class/Section:</b>
          <span>{[cls, sec].filter(Boolean).join("/")}</span>
          <b>Month :</b>
          <span>{months.map(monthLabel).join(", ")}</span>
          <b>Session:</b>
          <span>{sessionLong(session)}</span>
        </div>
        <table style={{ width: "auto" }}>
          <thead>
            <tr>
              <th className="exams-nob" />
              {data.parts.map((p) => (
                <th key={p.id} colSpan={2} className="c">
                  {partHead(p)}
                </th>
              ))}
              <th colSpan={2} className="c">
                Cumulative Result
              </th>
            </tr>
            <tr>
              <th className="c">Subject</th>
              {keys.flatMap((k) => [
                <th key={`${k}-o`} className="c" style={{ fontWeight: 400 }}>
                  Obt. Marks/Total
                </th>,
                <th key={`${k}-p`} className="c" style={{ fontWeight: 400 }}>
                  %age
                </th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {subjects.map((s) => {
              const b = row.bySubject![s.id]!;
              return (
                <tr key={s.id}>
                  <td style={{ minWidth: "34mm" }}>{s.name}</td>
                  {data.parts.flatMap((p) => {
                    const x = b.parts[p.id];
                    return [
                      <td key={`${p.id}-o`} className="c">
                        {x ? `${markCell(x.mark)}/${x.max}` : ""}
                      </td>,
                      <td key={`${p.id}-p`} className="n">
                        {x && x.mark !== null ? pct(typeof x.mark === "number" ? x.mark : 0, x.max) : ""}
                      </td>,
                    ];
                  })}
                  <td className="c">
                    {b.obtained}/{b.max}
                  </td>
                  <td className="n">{pct(b.obtained, b.max)}</td>
                </tr>
              );
            })}
            <tr>
              <th>Total Marks:</th>
              {data.parts.flatMap((p) => {
                const x = row.parts[p.id];
                return [
                  <td key={`${p.id}-o`} className="c">
                    {x ? `${x.obtained}/${x.max}` : ""}
                  </td>,
                  <td key={`${p.id}-p`} className="n">
                    {x ? pctText(x.percent) : ""}
                  </td>,
                ];
              })}
              <td className="c">{marksText(row)}</td>
              <td className="n">{pctText(row.percent)}</td>
            </tr>
          </tbody>
        </table>
        {data.mode !== "AVERAGE" && data.parts.length > 1 && <p className="exams-doc-key">The cumulative % is weighted: {partsTitle(data)}.</p>}
        <p className="m-0 mt-3" style={{ color: "#d00", fontFamily: "'Times New Roman', Times, serif", fontSize: "12pt" }}>
          <b>Note:</b> It is a system generated report no signature required.
        </p>
      </article>
    );

  const summary = (label: string, part: (p: (typeof data.parts)[number]) => ReactNode, total: ReactNode) => (
    <tr>
      <th style={{ width: "34mm" }}>{label}</th>
      {data.parts.map((p) => (
        <td key={p.id} className="c" style={{ width: "34mm" }}>
          {part(p)}
        </td>
      ))}
      <td className="c" style={{ width: "34mm" }}>
        {total}
      </td>
    </tr>
  );
  return (
    <article className="exams-doc exams-doc-a4" aria-label={`Consolidated result sheet, ${row.name}`}>
      <div className="exams-cons">
        {provisional && <span className="exams-doc-mark">PROVISIONAL</span>}
        <DocHead campus={campus} title="Consolidated Result Sheet" />
        <div className="exams-cons-info">
          <span />
          <span />
          <b>Session:</b>
          <span>{sessionLong(session)}</span>
          <b>Date :</b>
          <span>{spacedDate(pakistanToday())}</span>
          <b>Student&apos;s Name:</b>
          <span>{row.name}</span>
          <b>Father&apos;s Name:</b>
          <span>{row.father ?? ""}</span>
          <b>Gr.No:</b>
          <span>{row.id}</span>
          <b>Class :</b>
          <span>{cls}</span>
          <b>Section:</b>
          <span>{sec}</span>
          <span />
          <span />
        </div>
        <table>
          <thead>
            <tr>
              <th className="c" style={{ width: "34mm" }}>
                Semester
              </th>
              {data.parts.map((p) => (
                <th key={p.id} colSpan={2} className="c">
                  {partHead(p)}
                </th>
              ))}
              <th colSpan={2} className="c">
                Cumulative Result
              </th>
            </tr>
            <tr>
              <th className="c">Subject</th>
              {keys.flatMap((k) => [
                <th key={`${k}-o`} className="c" style={{ width: "16mm" }}>
                  Obtained
                </th>,
                <th key={`${k}-m`} className="c" style={{ width: "13mm" }}>
                  Max.
                </th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {subjects.map((s) => {
              const b = row.bySubject![s.id]!;
              return (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  {data.parts.flatMap((p) => {
                    const x = b.parts[p.id];
                    return [
                      <td key={`${p.id}-o`} className="c">
                        {x ? markCell(x.mark) : ""}
                      </td>,
                      <td key={`${p.id}-m`} className="c">
                        {x ? x.max : ""}
                      </td>,
                    ];
                  })}
                  <td className="c">{b.obtained}</td>
                  <td className="c">{b.max}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="exams-cons-sum">
          <table>
            <tbody>
              {summary("Total Marks:", (p) => (row.parts[p.id] ? `${row.parts[p.id]!.obtained}/${row.parts[p.id]!.max}` : ""), marksText(row))}
              {summary("Percentage:", (p) => (row.parts[p.id] ? pctText(row.parts[p.id]!.percent) : ""), pctText(row.percent))}
              {summary("Grade:", (p) => row.parts[p.id]?.grade ?? "", row.grade ?? "")}
              {summary("Position:", (p) => (row.parts[p.id]?.position && row.parts[p.id]?.result === "PASS" ? ordinal(row.parts[p.id]!.position!) : ""), row.position && row.result === "PASS" ? ordinal(row.position) : "")}
              {summary("Remarks", (p) => (row.parts[p.id] ? resultText(row.parts[p.id]!.result) : "No result"), row.result === "PASS" ? "Pass" : row.result === "FAIL" ? "Fail" : "Incomplete")}
            </tbody>
          </table>
        </div>
        <table>
          <tbody>
            <tr>
              <th className="n" style={{ width: "34mm" }}>
                Class Strength:
              </th>
              <td className="c" style={{ width: "34mm" }}>
                {strength}
              </td>
              {row.lastPercent != null && (
                <>
                  <th className="n">Last session&apos;s final:</th>
                  <td className="c">{pctText(row.lastPercent)}</td>
                </>
              )}
            </tr>
          </tbody>
        </table>
        {data.mode === "AVERAGE" ? <p className="exams-doc-key">The cumulative % is the average of the exams the student has.</p> : data.parts.length > 1 ? <p className="exams-doc-key">The cumulative % is weighted: {partsTitle(data)}.</p> : null}
        <div className="exams-cons-signs">
          <span>
            Controller/Superintendent Exams: <i />
          </span>
          <span>
            Principal: <i />
          </span>
        </div>
      </div>
    </article>
  );
}

/** Top N combined positions of each section, under section headings (the old consolidated position table). */
function CombinedPositions({ data, rows, top, gender, campus, session }: { data: ExamsCombined; rows: ExamsCombinedRow[]; top: number; gender: ExamsGender | undefined; campus: CampusCode; session: number }) {
  const sections = [...new Set(rows.map((r) => r.classSection))].sort();
  // Positions 1 to N of each section (equal percentages share a position), like the old table.
  const cut = (list: ExamsCombinedRow[]) => [...list].filter((r) => r.position !== null && r.position <= top).sort((a, b) => (a.position ?? 999) - (b.position ?? 999) || a.name.localeCompare(b.name));
  const word = top === 3 ? "Three" : top === 5 ? "Five" : top === 10 ? "Ten" : String(top);
  return (
    <article className="exams-doc exams-doc-a4" aria-label="Combined positions">
      <DocHead campus={campus} title={`Top ${word} Consolidated Positions (Section-Wise)`} underline />
      <PositionTable
        fields={[["Session", <b key="s">{sessionLong(session)}</b>], ["Class", <b key="c">{classWord(data.classShort)}</b>], gender && ["Gender", <b key="g">{genderWord(gender)}</b>]]}
        blocks={sections.map((cs) => ({
          section: splitSection(cs).sec || cs,
          rows: cut(rows.filter((r) => r.classSection === cs)).map((r) => ({ id: r.id, name: r.name, group: r.group ? examsGroupShort(r.group) : undefined, obtained: r.obtained ?? null, max: r.max ?? 0, percent: r.percent, position: r.position })),
        }))}
      />
      {sections.length === 0 && <p>No complete results.</p>}
      <p className="exams-doc-key">{partsTitle(data)}. Marks are the totals of every exam.</p>
    </article>
  );
}

/** Students who failed the combined result, by section (the old "Comulative Failed Students" list). */
function CombinedFailed({ data, rows, gender, campus, session }: { data: ExamsCombined; rows: ExamsCombinedRow[]; gender: ExamsGender | undefined; campus: CampusCode; session: number }) {
  const sections = [...new Set(rows.map((r) => r.classSection))].sort();
  const grouped = rows.some((r) => r.group);
  return (
    <>
      {(sections.length ? sections : [""]).map((cs) => (
        <article key={cs || "none"} className="exams-doc exams-doc-a4" aria-label="Cumulative failed students">
          <DocHead campus={campus} title="Cumulative Failed Students" />
          <Fields items={[["Class", classWord(data.classShort)], ["Exam", "Cumulative Exam"], ["Session", sessionLong(session)]]} style={{ justifyContent: "space-between" }} />
          <Fields items={[cs && ["Section", splitSection(cs).sec || cs], gender && ["Gender", genderWord(gender)]]} />
          {rows.length === 0 ? (
            <p>No student failed the combined result.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th className="c">Sr.#</th>
                  <th className="c">GRNo.</th>
                  <th className="c">Student Name</th>
                  {grouped && <th className="c">Group</th>}
                  <th className="c">Obt.</th>
                  <th className="c">Total</th>
                  <th className="c">%age</th>
                  <th className="c">Grade</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter((r) => r.classSection === cs)
                  .sort((a, b) => a.rollNo - b.rollNo || a.name.localeCompare(b.name))
                  .map((r, i) => (
                    <tr key={r.id}>
                      <td className="c">{i + 1}</td>
                      <td className="c">{r.id}</td>
                      <td>{r.name}</td>
                      {grouped && <td className="c">{examsGroupShort(r.group)}</td>}
                      <td className="c">{r.max ? (r.obtained ?? 0) : ""}</td>
                      <td className="c">{r.max ? r.max : ""}</td>
                      <td className="c">{pctText(r.percent ?? 0)}</td>
                      <td className="c">{r.grade ?? ""}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
          <p className="exams-doc-key">{partsTitle(data)}. A fail in any exam, or a combined % below the pass mark, is a fail overall.</p>
        </article>
      ))}
    </>
  );
}
