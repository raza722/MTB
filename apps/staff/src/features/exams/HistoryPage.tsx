import { EXAMS_CATEGORY_LABEL, EXAMS_RESULT_LABEL, examsQueries, type ExamsHistoryEntry, type ExamsMark, type ExamsStudentHistory } from "@mtb/api";
import { formatDate, formatMobile, formatPercent, formatSession, type IsoDate } from "@mtb/domain";
import { AreaChart, Avatar, Banner, Button, buttonClassName, Checkbox, DataTable, DatePicker, EmptyState, Input, Panel, Segmented, Select, Skeleton } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useDeferredValue, useState, type CSSProperties } from "react";
import { campusLabel } from "../../app/shell/campus";
import { Page, PageHeader } from "../../app/shell/page";
import { useCtx } from "../../app/session";
import { DocHead, PRINTED_ON } from "./print/docs";
import { PrintSheet, printNow } from "./print/PrintSheet";
import { ExamsNav, LoadError, markText, ordinal, ResultBadge } from "./shared";

type PrintKind = "history" | "papers" | "monthly";

/** One paper of one exam, for the paper-by-paper view. */
interface PaperLine {
  id: string;
  date: IsoDate;
  subject: string;
  exam: string;
  mark: ExamsMark;
  max: number;
  percent: number | null;
  grade: string | null;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1] ?? ""} ${m.slice(0, 4)}`;
const monthEnd = (m: string): IsoDate => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
/** The exam type's name, or the kind for exams without a type. */
const typeKey = (e: ExamsHistoryEntry) => e.typeName ?? EXAMS_CATEGORY_LABEL[e.category];
/** A paper's date, or the exam's start date when the paper has none. */
const paperDate = (e: ExamsHistoryEntry, s: ExamsHistoryEntry["subjects"][number]) => s.date ?? e.startDate;
/** A mark as printed on history sheets: number, A, L or a dash. */
const sheetMark = (m: ExamsMark) => (m === null ? "—" : String(m));

/** A student's academic history: every declared result across sessions, with the trend, filters and prints. */
export function HistoryPage({ id, onPick }: { id: string | undefined; onPick: (id: string | undefined) => void }) {
  const ctx = useCtx();
  const [q, setQ] = useState("");
  const deferred = useDeferredValue(q);
  const hits = useQuery(examsQueries.searchPeople(ctx, deferred));
  const history = useQuery(examsQueries.history(ctx, id ?? ""));
  const [view, setView] = useState("chart");
  const [printing, setPrinting] = useState<PrintKind | null>(null);
  const [session, setSession] = useState("");
  const [types, setTypes] = useState<string[] | null>(null);
  const [from, setFrom] = useState<IsoDate | null>(null);
  const [to, setTo] = useState<IsoDate | null>(null);

  const all = history.data?.entries ?? [];
  const allTypes = [...new Set(all.map(typeKey))].sort();
  const ticked = types ?? allTypes;
  const sessions = [...new Set(all.map((e) => e.session))].sort((a, b) => b - a);
  const months = [...new Set(all.flatMap((e) => e.subjects.map((s) => paperDate(e, s).slice(0, 7))))].sort();
  const badRange = from && to && from > to;
  // Exams in the filters: session, exam type and dates (an exam counts when any of its papers falls in the dates).
  const entries = all.filter(
    (e) =>
      (!session || String(e.session) === session) &&
      ticked.includes(typeKey(e)) &&
      (badRange || e.subjects.some((s) => (!from || paperDate(e, s) >= from) && (!to || paperDate(e, s) <= to)) || e.subjects.length === 0),
  );
  const papers: PaperLine[] = entries
    .flatMap((e) =>
      e.subjects
        .filter((s) => badRange || ((!from || paperDate(e, s) >= from) && (!to || paperDate(e, s) <= to)))
        .map((s) => ({ id: `${e.examId}-${s.subjectId}`, date: paperDate(e, s), subject: s.name, exam: e.exam, mark: s.mark, max: s.max, percent: s.percent ?? null, grade: s.grade ?? null })),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.subject.localeCompare(b.subject));
  const counts = { tests: papers.filter((p) => p.mark !== null).length, absent: papers.filter((p) => p.mark === "A").length, leave: papers.filter((p) => p.mark === "L").length };
  const filtered = Boolean(session) || ticked.length !== allTypes.length || Boolean(from) || Boolean(to);
  const pickMonth = (m: string) => {
    if (!m) {
      setFrom(null);
      setTo(null);
      return;
    }
    setFrom(`${m}-01`);
    setTo(monthEnd(m));
  };
  const monthPicked = from && to && from.endsWith("-01") && months.find((m) => from === `${m}-01` && to === monthEnd(m));

  return (
    <Page>
      <PageHeader title="Student history" />
      <ExamsNav />
      <Panel id="history-search" title="Find a student" description="Search by name or G.R. number. Results from every session are shown, declared results only." rise={0}>
        <div className="grid gap-3">
          <div className="max-w-md">
            <Input aria-label="Search students" icon="search" placeholder="For example Ayesha or KC-14823" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {deferred.trim().length >= 2 &&
            (hits.isLoading ? (
              <Skeleton height={60} />
            ) : hits.isError ? (
              <LoadError what="Students" error={hits.error} onRetry={() => void hits.refetch()} />
            ) : (hits.data ?? []).length === 0 ? (
              <p className="m-0 text-small text-ink-muted">No student in any exam matches “{deferred}”.</p>
            ) : (
              <ul className="m-0 grid list-none gap-1.5 p-0 sm:grid-cols-2 xl:grid-cols-3">
                {hits.data!.map((p, i) => (
                  <li key={p.id} className="mtb-slide-in" style={{ "--i": i } as CSSProperties}>
                    {p.university ? (
                      // A university student: their transcript and assessment history are under University.
                      <Link
                        to="/exams/university"
                        search={{ semester: p.university.semesterId, tab: "transcript", student: p.id, view: "history" } as never}
                        className="flex w-full items-center gap-3 rounded-md border border-border px-3 py-2 text-left hover:bg-surface-hover"
                      >
                        <Avatar name={p.name} size="sm" />
                        <span className="grid min-w-0">
                          <span className="truncate font-medium">{p.name}</span>
                          <span className="text-small text-ink-muted">
                            {p.classSection} · <span className="mtb-mono">{p.id}</span> · opens University history
                          </span>
                        </span>
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          onPick(p.id);
                          setTypes(null);
                          setSession("");
                          setFrom(null);
                          setTo(null);
                        }}
                        className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left ${p.id === id ? "border-brand bg-brand-tint" : "border-border hover:bg-surface-hover"}`}
                      >
                        <Avatar name={p.name} size="sm" />
                        <span className="grid min-w-0">
                          <span className="truncate font-medium">{p.name}</span>
                          <span className="text-small text-ink-muted">
                            {p.classSection} · <span className="mtb-mono">{p.id}</span>
                            {ctx.campus === "ALL" ? ` · ${campusLabel(p.campus)}` : ""}
                          </span>
                        </span>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ))}
        </div>
      </Panel>

      {!id ? (
        <div className="mtb-card">
          <EmptyState icon="trendUp" title="Choose a student" description="Their results from every exam and session appear here, with how they changed over time." />
        </div>
      ) : history.isLoading ? (
        <Skeleton height={320} />
      ) : history.isError ? (
        <LoadError what="This student's history" error={history.error} onRetry={() => void history.refetch()} />
      ) : history.data ? (
        <>
          <Panel
            id="history-person"
            title={history.data.person.name}
            description={`${history.data.person.father ? `Father: ${history.data.person.father} · ` : ""}${history.data.person.classSection}${history.data.person.group ? ` · ${history.data.person.group}` : ""} · ${history.data.person.id} · ${campusLabel(history.data.person.campus)}`}
            rise={1}
            actions={
              <>
                {history.data.person.hasProfile && (
                  <Link to="/students/$grNo" params={{ grNo: history.data.person.id }} className={buttonClassName({ size: "sm", variant: "ghost" })}>
                    Student profile
                  </Link>
                )}
                <Segmented
                  aria-label="Show history as"
                  value={view}
                  onChange={setView}
                  options={[
                    { value: "chart", label: "Chart" },
                    { value: "table", label: "By exam" },
                    { value: "papers", label: "Paper by paper" },
                  ]}
                />
                <Button size="sm" icon="printer" onClick={() => setPrinting((p) => (p ? null : view === "papers" ? "papers" : "history"))}>
                  {printing ? "Hide print" : "Print"}
                </Button>
              </>
            }
          >
            {all.length === 0 ? (
              <EmptyState icon="exams" title="No declared results yet" description="Drafts never show here. Results appear once they are declared." />
            ) : (
              <div className="grid gap-4">
                <div className="grid gap-3 rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="w-44">
                      <Select label="Session" value={session} onChange={(e) => setSession(e.target.value)} options={[{ value: "", label: "Every session" }, ...sessions.map((s) => ({ value: String(s), label: formatSession(s) }))]} />
                    </div>
                    <div className="w-48">
                      <Select label="Month" value={monthPicked || ""} onChange={(e) => pickMonth(e.target.value)} options={[{ value: "", label: from || to ? "Dates below" : "Any month" }, ...months.map((m) => ({ value: m, label: monthLabel(m) }))]} />
                    </div>
                    <div className="w-44">
                      <DatePicker label="From" value={from} onValueChange={setFrom} today="2026-11-04" />
                    </div>
                    <div className="w-44">
                      <DatePicker label="To" value={to} onValueChange={setTo} today="2026-11-04" error={badRange ? "Choose a date on or after the first one." : undefined} />
                    </div>
                    {filtered && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="x"
                        onClick={() => {
                          setSession("");
                          setTypes(null);
                          setFrom(null);
                          setTo(null);
                        }}
                      >
                        Clear filters
                      </Button>
                    )}
                  </div>
                  <fieldset className="m-0 flex flex-wrap items-center gap-x-4 gap-y-2 border-0 p-0">
                    <legend className="mb-1 text-small font-medium">Exam types</legend>
                    <Checkbox label="Check all" checked={ticked.length === allTypes.length} indeterminate={ticked.length > 0 && ticked.length < allTypes.length} onChange={(e) => setTypes(e.target.checked ? null : [])} />
                    {allTypes.map((t) => (
                      <Checkbox key={t} label={t} checked={ticked.includes(t)} onChange={(e) => setTypes(e.target.checked ? [...ticked, t] : ticked.filter((x) => x !== t))} />
                    ))}
                  </fieldset>
                  <dl className="m-0 flex flex-wrap gap-x-6 gap-y-1 text-small" aria-label="Counts in these filters">
                    {(
                      [
                        ["Exams", entries.length],
                        ["No. of tests (papers)", counts.tests],
                        ["No. of absents", counts.absent],
                        ["No. of leaves", counts.leave],
                      ] as const
                    ).map(([k, v]) => (
                      <div key={k} className="flex gap-1.5">
                        <dt className="text-ink-muted">{k}</dt>
                        <dd className="m-0 mtb-num font-semibold">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
                {entries.length === 0 ? (
                  <EmptyState icon="filter" title="Nothing in these filters" description="Tick more exam types or widen the dates." />
                ) : view === "chart" ? (
                  <AreaChart<ExamsHistoryEntry>
                    data={[...entries].reverse()}
                    value={(e) => e.percent ?? 0}
                    axisLabel={(e) => formatDate(e.startDate).slice(3)}
                    formatAxis={(v) => `${v}%`}
                    peakLabel={(e) => formatPercent(e.percent ?? 0)}
                    tooltip={(e) => (
                      <>
                        <div className="mtb-chart-tip-title">{e.exam}</div>
                        <div className="mtb-chart-tip-value">{e.percent === null ? "Withheld" : formatPercent(e.percent)}</div>
                        <div className="mtb-chart-tip-row">
                          <span>Grade</span>
                          <span>{e.grade ?? "—"}</span>
                        </div>
                        <div className="mtb-chart-tip-row">
                          <span>Position</span>
                          <span>{e.position ? `${ordinal(e.position)} in ${e.classSection}` : "—"}</span>
                        </div>
                      </>
                    )}
                    describe={(e) => `${e.exam}: ${e.percent === null ? "withheld" : formatPercent(e.percent)}, grade ${e.grade ?? "none"}`}
                    label={`${history.data.person.name}'s percentage in each declared exam, oldest first`}
                  />
                ) : view === "papers" ? (
                  <PaperTable papers={papers} />
                ) : (
                  <HistoryTable entries={entries} />
                )}
              </div>
            )}
          </Panel>
          {view === "chart" && entries.length > 0 && (
            <Panel id="history-table" title="Every result" description="Newest first. Open a subject breakdown in the exam's results." rise={2} flush>
              <HistoryTable entries={entries} />
            </Panel>
          )}
          {printing && (
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <Segmented
                  aria-label="What to print"
                  value={printing}
                  onChange={(v) => setPrinting(v === "papers" ? "papers" : v === "monthly" ? "monthly" : "history")}
                  options={[
                    { value: "history", label: "Academic history" },
                    { value: "papers", label: "Paper by paper" },
                    { value: "monthly", label: "Test summary" },
                  ]}
                />
                <Button variant="primary" icon="printer" onClick={printNow} disabled={entries.length === 0}>
                  Print
                </Button>
              </div>
              {entries.length === 0 ? (
                <Banner tone="info">Nothing to print in these filters.</Banner>
              ) : (
                <PrintSheet paper={printing === "monthly" && entries.length > 3 ? "A4L" : "A4"} label="History print preview">
                  {printing === "history" && <AcademicHistoryDoc data={history.data} entries={entries} />}
                  {printing === "papers" && <PaperHistoryDoc data={history.data} papers={papers} counts={counts} session={session} from={from} to={to} />}
                  {printing === "monthly" && <TestSummaryDoc data={history.data} entries={entries} session={session} wide={entries.length > 3} />}
                </PrintSheet>
              )}
            </div>
          )}
        </>
      ) : null}
    </Page>
  );
}

function HistoryTable({ entries }: { entries: ExamsHistoryEntry[] }) {
  return (
    <DataTable<ExamsHistoryEntry & { id: string }>
      caption="Results by exam"
      rows={entries.map((e) => ({ ...e, id: e.examId }))}
      density="dense"
      columns={[
        {
          key: "exam",
          header: "Exam",
          render: (e) => (
            <span className="grid">
              <Link to="/exams/$examId/results" params={{ examId: e.examId }} className="mtb-cell-primary text-brand-ink underline-offset-2 hover:underline">
                {e.exam}
              </Link>
              <span className="mtb-cell-secondary">
                {typeKey(e)} · Session {formatSession(e.session)}
              </span>
            </span>
          ),
        },
        { key: "cs", header: "Class", width: 80, render: (e) => e.classSection },
        { key: "total", header: "Total", align: "right", width: 110, render: (e) => `${e.obtained} / ${e.max}` },
        { key: "pct", header: "%", align: "right", width: 80, render: (e) => (e.percent === null ? "—" : formatPercent(e.percent)) },
        { key: "grade", header: "Grade", width: 70, render: (e) => e.grade ?? "—" },
        { key: "pos", header: "Position", width: 150, render: (e) => (e.position ? `${ordinal(e.position)} in section${e.classPosition ? ` · ${ordinal(e.classPosition)} in class` : ""}` : "—") },
        { key: "result", header: "Result", width: 100, render: (e) => <ResultBadge result={e.result} /> },
      ]}
    />
  );
}

function PaperTable({ papers }: { papers: PaperLine[] }) {
  return (
    <DataTable<PaperLine>
      caption="Every paper"
      rows={papers}
      density="dense"
      maxHeight={520}
      empty={<EmptyState icon="filter" title="No papers in these dates" description="Widen the dates." />}
      columns={[
        { key: "date", header: "Date", width: 120, render: (p) => <span className="mtb-num">{formatDate(p.date)}</span> },
        { key: "subject", header: "Subject", render: (p) => <span className="mtb-cell-primary">{p.subject}</span> },
        { key: "exam", header: "Exam", render: (p) => p.exam },
        { key: "obt", header: "Obt. marks", align: "right", width: 100, render: (p) => (p.mark === "A" || p.mark === "L" ? <span className="font-semibold text-danger-ink">{p.mark}</span> : markText(p.mark)) },
        { key: "max", header: "Total marks", align: "right", width: 100, render: (p) => p.max },
        { key: "pct", header: "%age", align: "right", width: 80, render: (p) => (p.percent === null ? "—" : formatPercent(p.percent)) },
        { key: "grade", header: "Grade", width: 70, render: (p) => p.grade ?? "—" },
      ]}
    />
  );
}

/** Student details block shared by the history prints. */
function PersonBlock({ person, session, extra }: { person: ExamsStudentHistory["person"]; session: string; extra?: Array<[string, string]> }) {
  const [cls, sec] = person.classSection.split("-");
  const items: Array<[string, string]> = [
    ["G.R. No.", person.id],
    ["Name", person.name],
    ["Father's name", person.father ?? "—"],
    ["Class", cls === "Prep" ? "Prep" : `Class ${cls}`],
    ["Section", sec ?? person.classSection],
    ["Session", session ? formatSession(Number(session)) : "Every session"],
    ...(person.group ? ([["Group", person.group]] as Array<[string, string]>) : []),
    ...(extra ?? []),
  ];
  return (
    <dl className="exams-doc-info">
      {items.map(([k, v]) => (
        <div key={k} style={k === "Address" ? { gridColumn: "span 3" } : undefined}>
          <dt>{k}</dt>
          <dd className={k === "G.R. No." || k === "Contact no." ? "mtb-mono" : undefined} style={k === "Address" ? { fontWeight: 400 } : undefined}>
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function AcademicHistoryDoc({ data, entries }: { data: ExamsStudentHistory; entries: ExamsHistoryEntry[] }) {
  return (
    <article className="exams-doc exams-doc-a4" aria-label="Academic history">
      <DocHead campus={data.person.campus} title="Academic history" sub={`${data.person.name} · ${data.person.id}${data.person.group ? ` · ${data.person.group}` : ""}`} />
      {entries.map((e) => (
        <section key={e.examId} style={{ marginBottom: "4mm", breakInside: "avoid" }}>
          <p style={{ margin: "0 0 1mm" }}>
            <b>{e.exam}</b> · {e.classSection} · Session {formatSession(e.session)} · {e.obtained}/{e.max} · {e.percent === null ? "Withheld" : formatPercent(e.percent)} · Grade {e.grade ?? "—"} · {e.position ? `${ordinal(e.position)} in section` : ""} · {EXAMS_RESULT_LABEL[e.result]}
          </p>
          <table>
            <tbody>
              <tr>
                {e.subjects.map((s) => (
                  <th key={s.subjectId}>{s.name}</th>
                ))}
              </tr>
              <tr>
                {e.subjects.map((s) => (
                  <td key={s.subjectId}>
                    {markText(s.mark)} / {s.max}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </section>
      ))}
      <p className="exams-doc-key">Declared results only. Printed {PRINTED_ON}.</p>
      <div className="exams-doc-signs">
        <div />
        <div>Controller of examinations</div>
        <div>Principal</div>
      </div>
    </article>
  );
}

/** The old Student History Report: student details, counts, then one row per paper. */
function PaperHistoryDoc({ data, papers, counts, session, from, to }: { data: ExamsStudentHistory; papers: PaperLine[]; counts: { tests: number; absent: number; leave: number }; session: string; from: IsoDate | null; to: IsoDate | null }) {
  return (
    <article className="exams-doc exams-doc-a4" aria-label="Student history report">
      <DocHead campus={data.person.campus} title="Student history report" sub={from || to ? `${from ? formatDate(from) : "Start"} to ${to ? formatDate(to) : PRINTED_ON}` : "Every declared exam"} />
      <PersonBlock person={data.person} session={session} />
      <div className="exams-doc-summary" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginTop: 0, marginBottom: "3mm" }}>
        <div>
          <span>No. of tests</span>
          <b>{counts.tests}</b>
        </div>
        <div>
          <span>No. of absents</span>
          <b>{counts.absent}</b>
        </div>
        <div>
          <span>No. of leaves</span>
          <b>{counts.leave}</b>
        </div>
      </div>
      <table style={{ fontSize: "9pt" }}>
        <thead>
          <tr>
            <th>Date</th>
            <th>Subject</th>
            <th>Exam</th>
            <th className="n">Obt. marks</th>
            <th className="n">Total marks</th>
            <th className="n">%age</th>
            <th className="c">Grade</th>
          </tr>
        </thead>
        <tbody>
          {papers.map((p) => (
            <tr key={p.id}>
              <td>{formatDate(p.date)}</td>
              <td>{p.subject}</td>
              <td>{p.exam}</td>
              <td className={p.mark === "A" ? "n fail" : "n"}>{sheetMark(p.mark)}</td>
              <td className="n">{p.max}</td>
              <td className="n">{p.percent === null ? "" : formatPercent(p.percent)}</td>
              <td className="c">{p.grade ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="exams-doc-key">A = absent, L = leave (both count as 0%). Declared results only. Printed {PRINTED_ON}.</p>
    </article>
  );
}

/** The old Monthly Test Summary: subjects as rows, each test's obtained, total and %, then the total. */
function TestSummaryDoc({ data, entries, session, wide }: { data: ExamsStudentHistory; entries: ExamsHistoryEntry[]; session: string; wide: boolean }) {
  const tests = [...entries].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const subjects: Array<{ id: string; name: string }> = [];
  for (const e of tests) for (const s of e.subjects) if (!subjects.some((x) => x.id === s.subjectId)) subjects.push({ id: s.subjectId, name: s.name });
  const cell = (e: ExamsHistoryEntry, id: string) => e.subjects.find((s) => s.subjectId === id);
  return (
    <article className={wide ? "exams-doc exams-doc-land" : "exams-doc exams-doc-a4"} aria-label="Test summary">
      <DocHead campus={data.person.campus} title="Monthly test summary" sub={tests.map((e) => e.exam).join(" · ")} />
      <PersonBlock
        person={data.person}
        session={session}
        extra={[
          ["Contact no.", data.person.guardianMobile ? formatMobile(data.person.guardianMobile) : "—"],
          ["Address", data.person.address ?? "—"],
        ]}
      />
      <table>
        <thead>
          <tr>
            <th rowSpan={2} className="n">
              Sr#
            </th>
            <th rowSpan={2}>Subject</th>
            {tests.map((e) => (
              <th key={e.examId} colSpan={3} className="c">
                {formatDate(e.startDate)}
                <br />
                <span style={{ fontWeight: 400 }}>{e.exam}</span>
              </th>
            ))}
            <th rowSpan={2} className="c">
              Total
            </th>
          </tr>
          <tr>
            {tests.flatMap((e) => [
              <th key={`${e.examId}-o`} className="c">
                Obtained
              </th>,
              <th key={`${e.examId}-t`} className="c">
                Total
              </th>,
              <th key={`${e.examId}-p`} className="c">
                %
              </th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {subjects.map((s, i) => {
            let obt = 0;
            let max = 0;
            return (
              <tr key={s.id}>
                <td className="n">{i + 1}</td>
                <td>{s.name}</td>
                {tests.flatMap((e) => {
                  const x = cell(e, s.id);
                  if (x) {
                    obt += typeof x.mark === "number" ? x.mark : 0;
                    max += x.max;
                  }
                  return [
                    <td key={`${e.examId}-o`} className={x?.mark === "A" ? "c fail" : "c"}>
                      {x ? sheetMark(x.mark) : ""}
                    </td>,
                    <td key={`${e.examId}-t`} className="c">
                      {x ? x.max : ""}
                    </td>,
                    <td key={`${e.examId}-p`} className="c">
                      {x && x.percent != null ? formatPercent(x.percent) : ""}
                    </td>,
                  ];
                })}
                <td className="c">{max ? `${obt} / ${max}` : ""}</td>
              </tr>
            );
          })}
          <tr>
            <th colSpan={2}>Total</th>
            {tests.flatMap((e) => [
              <th key={`${e.examId}-o`} className="c">
                {e.obtained}
              </th>,
              <th key={`${e.examId}-t`} className="c">
                {e.max}
              </th>,
              <th key={`${e.examId}-p`} className="c">
                {e.percent === null ? "—" : formatPercent(e.percent)}
              </th>,
            ])}
            <th className="c">
              {tests.reduce((a, e) => a + e.obtained, 0)} / {tests.reduce((a, e) => a + e.max, 0)}
            </th>
          </tr>
        </tbody>
      </table>
      <p className="exams-doc-key">A = absent, L = leave. Declared results only. Printed {PRINTED_ON}.</p>
      <div className="exams-doc-signs" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div>Class in-charge</div>
        <div>Principal</div>
      </div>
    </article>
  );
}
