import { EXAMS_CATEGORY_LABEL, examsGroupShort, examsOfGender, examsQueries, type CampusCode, type ExamsCombined, type ExamsCombinedMode, type ExamsCombinedRow, type ExamsGender, type ExamsMark } from "@mtb/api";
import { formatDate, formatPercent, formatSession } from "@mtb/domain";
import { Banner, Button, Checkbox, DataTable, EmptyState, Input, Panel, Segmented, Select, Skeleton, StatusBadge, type Column } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { z } from "zod";
import { campusLabel } from "../../app/shell/campus";
import { Page, PageHeader } from "../../app/shell/page";
import { useCtx } from "../../app/session";
import { DocHead, PRINTED_ON } from "./print/docs";
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
              <div className="w-64">
                <Select label="Class" value={group?.classShort ?? ""} onChange={(e) => chooseClass(e.target.value)} options={groups.map((g) => ({ value: g.classShort, label: `${g.className} · ${g.exams.length} ${g.exams.length === 1 ? "exam" : "exams"}` }))} />
              </div>
              {testMonths.length > 0 && (
                <div className="w-64">
                  <Select
                    label="A month's class tests"
                    value={pickedMonth ?? ""}
                    onChange={(e) => pickMonth(e.target.value)}
                    help="Ticks every class test of that month."
                    options={[{ value: "", label: "Choose a month" }, ...testMonths.map((m) => ({ value: m, label: `${monthLabel(m)} · ${(group?.exams ?? []).filter((e) => e.category === "TEST" && e.startDate.startsWith(m)).length} tests` }))]}
                  />
                </div>
              )}
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
                <div className="w-72">
                  <Select
                    label="Student"
                    value={visible.some((r) => r.id === cardStudent) ? cardStudent : ""}
                    onChange={(e) => setCardStudent(e.target.value)}
                    options={[{ value: "", label: `Everyone shown (${visible.length} cards)` }, ...visible.map((r) => ({ value: r.id, label: `${r.classSection} · ${r.rollNo}. ${r.name}` }))]}
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
            <PrintSheet paper={printDoc === "sheet" ? "A4L" : "A4"} label="Combined result preview">
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
              <td className="n">{r.percent === null ? "" : r.percent.toFixed(1)}</td>
              <td className="c">{r.grade ?? ""}</td>
              <td className="n">{(section === "ALL" ? r.classPosition : r.position) ?? ""}</td>
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

const markCell = (m: ExamsMark | undefined) => (m === null || m === undefined ? "—" : String(m));

/**
 * One student's consolidated result sheet (terms) or class test report (tests): each subject's marks in every exam
 * and cumulatively, then total, %, grade, position and remarks for each exam and the combined result.
 */
function CombinedCard({ data, row, strength, campus, session }: { data: ExamsCombined; row: ExamsCombinedRow; strength: number; campus: CampusCode; session: number }) {
  const tests = data.parts.every((p) => p.category === "TEST");
  const subjects = (data.subjects ?? []).filter((s) => row.bySubject?.[s.id]);
  const months = [...new Set(data.parts.map((p) => p.startDate?.slice(0, 7)).filter((m): m is string => Boolean(m)))];
  const span = tests ? 3 : 2;
  const pct = (o: number, m: number) => (m ? formatPercent((o / m) * 100) : "—");
  const summary = (label: string, part: (p: (typeof data.parts)[number]) => ReactNode, total: ReactNode) => (
    <tr>
      <th>{label}</th>
      {data.parts.map((p) => (
        <td key={p.id} colSpan={span} className="c">
          {part(p)}
        </td>
      ))}
      <td colSpan={span} className="c">
        <b>{total}</b>
      </td>
    </tr>
  );
  const resultText = (r: string | undefined) => (r === "PASS" ? "Pass" : r === "SUPPLY" ? "Re-sit" : r === "FAIL" ? "Fail" : r === "WITHHELD" ? "Withheld" : "Incomplete");
  const [cls, sec] = row.classSection.split("-");
  return (
    <article className="exams-doc exams-doc-a4" aria-label={`${tests ? "Class test report" : "Consolidated result sheet"}, ${row.name}`}>
      {data.parts.some((p) => p.status !== "DECLARED") && <span className="exams-doc-mark">PROVISIONAL</span>}
      <DocHead campus={campus} title={tests ? "Class test report" : "Consolidated result sheet"} sub={`Session ${formatSession(session)} · ${tests && months.length ? months.map(monthLabel).join(", ") : `Printed ${PRINTED_ON}`}`} />
      <dl className="exams-doc-info">
        <div>
          <dt>Student</dt>
          <dd>{row.name}</dd>
        </div>
        <div>
          <dt>Father's name</dt>
          <dd>{row.father ?? "—"}</dd>
        </div>
        <div>
          <dt>G.R. No.</dt>
          <dd className="mtb-mono">{row.id}</dd>
        </div>
        <div>
          <dt>Class</dt>
          <dd>{cls === "Prep" ? "Prep" : `Class ${cls}`}</dd>
        </div>
        <div>
          <dt>Section</dt>
          <dd>{sec ?? row.classSection}</dd>
        </div>
        <div>
          <dt>{row.group ? "Group" : "Date"}</dt>
          <dd>{row.group ?? PRINTED_ON}</dd>
        </div>
      </dl>
      <table>
        <thead>
          <tr>
            <th rowSpan={2}>Subject</th>
            {data.parts.map((p) => (
              <th key={p.id} colSpan={span} className="c">
                {p.name}
                {data.mode === "AVERAGE" || data.parts.length === 1 ? "" : ` · ${p.weight}%`}
              </th>
            ))}
            <th colSpan={span} className="c">
              Cumulative result
            </th>
          </tr>
          <tr>
            {[...data.parts.map((p) => p.id), "cum"].flatMap((k) => [
              <th key={`${k}-o`} className="c">
                Obtained
              </th>,
              <th key={`${k}-m`} className="c">
                Max.
              </th>,
              ...(tests
                ? [
                    <th key={`${k}-p`} className="c">
                      %age
                    </th>,
                  ]
                : []),
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
                    ...(tests
                      ? [
                          <td key={`${p.id}-p`} className="c">
                            {x && x.mark !== null ? pct(typeof x.mark === "number" ? x.mark : 0, x.max) : ""}
                          </td>,
                        ]
                      : []),
                  ];
                })}
                <td className="c">{b.obtained}</td>
                <td className="c">{b.max}</td>
                {tests && <td className="c">{pct(b.obtained, b.max)}</td>}
              </tr>
            );
          })}
          {summary("Total marks", (p) => (row.parts[p.id] ? `${row.parts[p.id]!.obtained}/${row.parts[p.id]!.max}` : "No result"), marksText(row))}
          {summary("Percentage", (p) => (row.parts[p.id] ? formatPercent(row.parts[p.id]!.percent) : "—"), row.percent === null ? "—" : formatPercent(row.percent))}
          {summary("Grade", (p) => row.parts[p.id]?.grade ?? "—", row.grade ?? "—")}
          {summary("Position in section", (p) => (row.parts[p.id]?.position ? ordinal(row.parts[p.id]!.position!) : "—"), row.position ? ordinal(row.position) : "—")}
          {summary("Remarks", (p) => (row.parts[p.id] ? resultText(row.parts[p.id]!.result) : "No result"), row.result === "PASS" ? "Pass" : row.result === "FAIL" ? "Fail" : "Incomplete")}
        </tbody>
      </table>
      <div className="exams-card-grid">
        <table style={{ width: "auto" }}>
          <tbody>
            <tr>
              <th>Class strength</th>
              <td className="n" style={{ minWidth: "16mm" }}>
                {strength}
              </td>
            </tr>
            {row.lastPercent != null && (
              <tr>
                <th>Last session's final</th>
                <td className="n">{formatPercent(row.lastPercent)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="exams-doc-key">
        {data.mode === "AVERAGE" ? "The cumulative % is the average of the exams the student has." : data.parts.length > 1 ? `The cumulative % is weighted: ${partsTitle(data)}.` : ""} Cumulative marks are the totals of every exam. A = absent, L = leave.
      </p>
      {tests ? (
        <p className="m-0 mt-3" style={{ color: "var(--danger-ink)", fontWeight: 600 }}>
          Note: this is a system-generated report. No signature is required.
        </p>
      ) : (
        <div className="exams-doc-signs" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div>Controller / Superintendent of exams</div>
          <div>Principal</div>
        </div>
      )}
    </article>
  );
}

/** Top N combined positions of each section, under section headings (the old consolidated position table). */
function CombinedPositions({ data, rows, top, gender, campus, session }: { data: ExamsCombined; rows: ExamsCombinedRow[]; top: number; gender: ExamsGender | undefined; campus: CampusCode; session: number }) {
  const sections = [...new Set(rows.map((r) => r.classSection))].sort();
  const grouped = rows.some((r) => r.group);
  // Positions 1 to N of each section (equal percentages share a position), like the old table.
  const cut = (list: ExamsCombinedRow[]) => [...list].filter((r) => r.position !== null && r.position <= top).sort((a, b) => (a.position ?? 999) - (b.position ?? 999) || a.name.localeCompare(b.name));
  return (
    <article className="exams-doc exams-doc-a4" aria-label="Combined positions">
      <DocHead campus={campus} title={`Top ${top === 3 ? "three" : top} positions (combined)`} sub={[partsTitle(data), genderWord(gender), `Session ${formatSession(session)}`].filter(Boolean).join(" · ")} />
      {sections.length === 0 && <p>No complete results.</p>}
      {sections.map((cs) => (
        <section key={cs} style={{ marginBottom: "4mm", breakInside: "avoid" }}>
          <p style={{ margin: "0 0 1mm", fontWeight: 600 }}>Section: {cs}</p>
          <table>
            <thead>
              <tr>
                <th className="n">Position</th>
                <th>G.R. No.</th>
                <th>Student</th>
                {grouped && <th>Group</th>}
                <th className="n">Marks</th>
                <th className="n">%age</th>
              </tr>
            </thead>
            <tbody>
              {cut(rows.filter((r) => r.classSection === cs)).map((r) => (
                <tr key={r.id}>
                  <td className="n">{r.position ? ordinal(r.position) : ""}</td>
                  <td className="mtb-mono">{r.id}</td>
                  <td>{r.name}</td>
                  {grouped && <td>{examsGroupShort(r.group)}</td>}
                  <td className="n">{marksText(r)}</td>
                  <td className="n">{r.percent === null ? "" : formatPercent(r.percent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <p className="exams-doc-key">Positions 1 to {top} by combined % within each section; equal percentages share a position, so more than {top} students can be listed. Marks are the totals of every exam.</p>
      <div className="exams-doc-signs">
        <div>Controller of examinations</div>
        <div />
        <div>Principal</div>
      </div>
    </article>
  );
}

/** Students who failed the combined result, by section (the old cumulative failed students list). */
function CombinedFailed({ data, rows, gender, campus, session }: { data: ExamsCombined; rows: ExamsCombinedRow[]; gender: ExamsGender | undefined; campus: CampusCode; session: number }) {
  const sections = [...new Set(rows.map((r) => r.classSection))].sort();
  const grouped = rows.some((r) => r.group);
  return (
    <article className="exams-doc exams-doc-a4" aria-label="Combined failed list">
      <DocHead campus={campus} title="Cumulative failed students" sub={[partsTitle(data), genderWord(gender), `Session ${formatSession(session)}`].filter(Boolean).join(" · ")} />
      {rows.length === 0 ? (
        <p>No student failed the combined result.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th className="n">Sr#</th>
              <th>G.R. No.</th>
              <th>Student</th>
              {grouped && <th>Group</th>}
              <th className="n">Obt.</th>
              <th className="n">Total</th>
              <th className="n">%age</th>
              <th className="c">Grade</th>
            </tr>
          </thead>
          <tbody>
            {sections.flatMap((cs) => [
              <tr key={`h-${cs}`}>
                <th colSpan={7 + (grouped ? 1 : 0)}>Section: {cs}</th>
              </tr>,
              ...rows
                .filter((r) => r.classSection === cs)
                .sort((a, b) => a.rollNo - b.rollNo)
                .map((r, i) => (
                  <tr key={r.id}>
                    <td className="n">{i + 1}</td>
                    <td className="mtb-mono">{r.id}</td>
                    <td>{r.name}</td>
                    {grouped && <td>{examsGroupShort(r.group)}</td>}
                    <td className="n">{r.obtained ?? 0}</td>
                    <td className="n">{r.max ?? 0}</td>
                    <td className="n">{r.percent === null ? "—" : formatPercent(r.percent)}</td>
                    <td className="c">{r.grade ?? ""}</td>
                  </tr>
                )),
            ])}
          </tbody>
        </table>
      )}
      <p className="exams-doc-key">A fail in any exam, or a combined % below the pass mark, is a fail overall. Obt. and Total are the marks of every exam added up.</p>
      <div className="exams-doc-signs">
        <div>Class teacher</div>
        <div>Controller of examinations</div>
        <div>Principal</div>
      </div>
    </article>
  );
}
