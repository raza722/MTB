import { EXAMS_CATEGORY_HELP, EXAMS_CATEGORY_LABEL, examsApi, examsQueries, type ExamsClassTemplate, type ExamsSubject, type ExamsType } from "@mtb/api";
import { formatDate, formatSession, formatWeekday, type IsoDate } from "@mtb/domain";
import { Banner, Button, Checkbox, DatePicker, EmptyState, Input, KeyValue, Panel, Select, Skeleton, Stepper, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { z } from "zod";
import { campusLabel } from "../../app/shell/campus";
import { Page, PageHeader, RequireSingleCampus } from "../../app/shell/page";
import { useCtx, useReadOnly } from "../../app/session";
import { errorText, examsToday, LoadError } from "./shared";

interface PaperDraft {
  id: string;
  name: string;
  include: boolean;
  maxMarks: string;
  date: IsoDate | null;
  startTime: string;
  duration: string;
  supervisor: string;
  /** Groups that sit the paper; empty means everyone. */
  groups: string[];
}

const STEPS = ["Exam and class", "Papers and date sheet", "Check and create"];

const examSchema = z.object({
  typeId: z.string().min(1, "Choose an exam type."),
  name: z.string().trim().min(3, "Give the exam a name, for example “Second Term 2026–27”."),
  classShort: z.string().min(1, "Choose a class."),
  sections: z.array(z.string()).min(1, "Tick at least one section."),
});

const paperSchema = z.object({
  maxMarks: z.coerce.number({ error: "Type the maximum marks." }).int("Use a whole number.").min(1, "At least 1 mark.").max(1000, "No more than 1,000 marks."),
  duration: z.coerce.number({ error: "Type the minutes." }).int("Use whole minutes.").min(10, "At least 10 minutes.").max(300, "No more than 300 minutes."),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:00."),
});

const addDays = (d: IsoDate, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const isSunday = (d: IsoDate) => new Date(`${d}T00:00:00Z`).getUTCDay() === 0;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function suggestName(type: ExamsType | undefined, session: number): string {
  if (!type) return "";
  const today = examsToday();
  // Monthly tests are named for this month; board results for the year the students sat the board (last session's end).
  if (type.category === "TEST" && type.rankScope === "MONTH") return `${type.name} – ${MONTHS[Number(today.slice(5, 7)) - 1]} ${today.slice(0, 4)}`;
  if (type.category === "BOARD") return `${type.name} result ${session}`;
  return `${type.name} ${formatSession(session)}`;
}

/**
 * Groups a paper is for, as the API takes them: none (everyone) or exactly one. A paper ticked for every group is for
 * everyone; a paper for some but not all of several groups can't be set up yet (05_exams D38 / Q20).
 */
function paperGroups(p: Pick<PaperDraft, "groups">, all: string[]): string[] {
  return p.groups.length === 0 || p.groups.length >= all.length ? [] : p.groups;
}

/** New exam: type, class and sections; then papers with maximum marks and the date sheet; then a check before creating. */
export function NewExamPage() {
  return (
    <Page>
      <PageHeader title="New exam" />
      <RequireSingleCampus action="set up an exam">
        <NewExamForm />
      </RequireSingleCampus>
    </Page>
  );
}

function NewExamForm() {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const types = useQuery(examsQueries.types(ctx));
  const current = useQuery(examsQueries.templates(ctx));
  // Board results are recorded for the students who sat the board exam last session (since promoted).
  const lastSession = ctx.session - 1;
  const [sourceSession, setSourceSession] = useState<number>(lastSession);
  const past = useQuery({ ...examsQueries.templates({ ...ctx, session: lastSession }), enabled: !readOnly });
  const [step, setStep] = useState(0);
  const [tried, setTried] = useState<number | null>(null);
  const [typeId, setTypeId] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [classShort, setClassShort] = useState("");
  const [sections, setSections] = useState<string[]>([]);
  const [papers, setPapers] = useState<PaperDraft[]>([]);
  const [firstDate, setFirstDate] = useState<IsoDate | null>(null);

  // Programme tests (Diamond Minds) are set up under Exams → Programmes, entrance tests in Admissions, semesters under University.
  const usable = (types.data ?? []).filter((t) => t.active && t.category !== "UNIVERSITY" && t.category !== "ENTRANCE" && !t.programme);
  const type = usable.find((t) => t.id === typeId);
  const board = type?.category === "BOARD";
  const fromPast = board && sourceSession === lastSession;
  const templates = fromPast ? past : current;
  const template: ExamsClassTemplate | undefined = templates.data?.find((t) => t.classShort === classShort);
  const groups = template?.groups ?? [];

  const chooseType = (id: string) => {
    setTypeId(id);
    if (!nameTouched) setName(suggestName(usable.find((t) => t.id === id), ctx.session));
    const t = usable.find((x) => x.id === id);
    const wasPast = fromPast;
    const nowPast = t?.category === "BOARD" && sourceSession === lastSession;
    if (wasPast !== nowPast) {
      // The class list changes between this session and last session's: start the class again.
      setClassShort("");
      setSections([]);
      setPapers([]);
      return;
    }
    // Class tests are short: suggest 25 marks and 40 minutes per paper.
    if (t && template) setPapers(fromTemplate(template.subjects, t));
  };
  const chooseClass = (c: string) => {
    setClassShort(c);
    const t = templates.data?.find((x) => x.classShort === c);
    setSections(t ? t.sections.map((s) => s.classSection) : []);
    setPapers(t ? fromTemplate(t.subjects, type) : []);
  };
  const chooseSource = (n: number) => {
    setSourceSession(n);
    setClassShort("");
    setSections([]);
    setPapers([]);
  };
  const setPaper = (i: number, patch: Partial<PaperDraft>) => setPapers((list) => list.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const spreadDates = () => {
    if (!firstDate) return;
    let d = firstDate;
    setPapers((list) =>
      list.map((p) => {
        if (!p.include) return p;
        while (isSunday(d)) d = addDays(d, 1);
        const out = { ...p, date: d };
        d = addDays(d, 1);
        return out;
      }),
    );
  };

  const step1 = examSchema.safeParse({ typeId, name, classShort, sections });
  const step1Errors = step1.success ? {} : Object.fromEntries(step1.error.issues.map((i) => [String(i.path[0]), i.message]));
  const included = papers.filter((p) => p.include);
  const paperErrors = papers.map((p) => {
    if (!p.include) return {};
    const r = paperSchema.safeParse({ maxMarks: p.maxMarks, duration: p.duration, startTime: p.startTime });
    return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message]));
  });
  const step2Valid = included.length > 0 && paperErrors.every((e) => Object.keys(e).length === 0);
  const clashes = useMemo(() => {
    const seen = new Map<string, string>();
    const out: string[] = [];
    for (const p of papers.filter((x) => x.include && x.date)) {
      const key = `${p.date}|${p.startTime}`;
      const other = seen.get(key);
      if (other) out.push(`${other} and ${p.name} are both on ${formatDate(p.date!)} at ${p.startTime}.`);
      else seen.set(key, p.name);
    }
    for (const p of papers.filter((x) => x.include && x.date && isSunday(x.date))) out.push(`${p.name} is on a Sunday (${formatDate(p.date!)}).`);
    return out;
  }, [papers]);

  const create = useMutation({
    mutationFn: () =>
      examsApi.create(ctx, {
        typeId,
        name: name.trim(),
        classes: sections,
        subjects: included.map<ExamsSubject>((p) => ({
          id: p.id,
          name: p.name,
          maxMarks: Number(p.maxMarks),
          ...(p.date ? { date: p.date } : {}),
          startTime: p.startTime,
          durationMins: Number(p.duration),
          ...(p.supervisor.trim() ? { supervisor: p.supervisor.trim() } : {}),
          ...(paperGroups(p, groups).length ? { groups: paperGroups(p, groups) } : {}),
        })),
        ...(fromPast ? { sourceSession: lastSession } : {}),
      }),
    onSuccess: (exam) => {
      void queryClient.invalidateQueries({ queryKey: ["exams"] });
      toast({ title: "Exam created", message: `${exam.name} · ${exam.classes.join(", ")}. Teachers can now enter marks.` });
      void navigate({ to: "/exams/$examId", params: { examId: exam.id } });
    },
  });

  if (readOnly) {
    return (
      <div className="mtb-card">
        <EmptyState icon="lock" title="Past sessions are read-only" description="Switch to the current session to set up an exam." />
      </div>
    );
  }
  if (types.isError || templates.isError) return <LoadError what="Exam types and classes" error={types.error ?? templates.error} onRetry={() => void Promise.all([types.refetch(), templates.refetch()])} />;
  if (types.isLoading || templates.isLoading) return <Skeleton height={320} />;
  // Every group must sit at least one paper, and a paper is for one group or for everyone.
  const groupless = groups.filter((g) => !included.some((p) => p.groups.length === 0 || p.groups.includes(g)));
  const multiGroup = included.filter((p) => paperGroups(p, groups).length > 1);

  const next = () => {
    setTried(step);
    if (step === 0 && !step1.success) return;
    if (step === 1 && (!step2Valid || groupless.length > 0 || multiGroup.length > 0)) return;
    setTried(null);
    setStep((s) => s + 1);
  };
  const show = (n: number) => tried !== null && tried >= n;
  const totalMax = included.reduce((a, p) => a + (Number(p.maxMarks) || 0), 0);
  const students = template?.sections.filter((s) => sections.includes(s.classSection)).reduce((a, s) => a + s.students, 0) ?? 0;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Stepper steps={STEPS} current={step} label="New exam steps" />
        <Link to="/exams" className="text-small font-medium text-brand-ink underline-offset-2 hover:underline">
          Cancel and go back to exams
        </Link>
      </div>

      {step === 0 && (
        <Panel id="new-exam" title="Exam and class" description={`${campusLabel(ctx.campus)} · Session ${formatSession(ctx.session)}. One exam covers one class; its sections sit the same papers.`} rise={0}>
          <div className="grid max-w-3xl gap-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Exam type"
                required
                value={typeId}
                onChange={(e) => chooseType(e.target.value)}
                error={show(0) ? step1Errors.typeId : undefined}
                help={type ? EXAMS_CATEGORY_HELP[type.category] : "Term exams, class tests, board results and entrance tests all use the same steps."}
                options={[{ value: "", label: "Choose…" }, ...usable.map((t) => ({ value: t.id, label: `${t.name} · ${EXAMS_CATEGORY_LABEL[t.category]}` }))]}
              />
              <Input
                label="Exam name"
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameTouched(true);
                }}
                error={show(0) ? step1Errors.name : undefined}
                help="Parents see this name on result cards and in the portal."
              />
            </div>
            {board && (
              <Select
                label="Students who sat it in session"
                value={String(sourceSession)}
                onChange={(e) => chooseSource(Number(e.target.value))}
                help={
                  fromPast
                    ? `Last session's class, as it was then. Students promoted since are included; the exam is kept in ${formatSession(ctx.session)}.`
                    : "This session's sections, as they are now."
                }
                options={[
                  { value: String(lastSession), label: `${formatSession(lastSession)} (last session)` },
                  { value: String(ctx.session), label: `${formatSession(ctx.session)} (this session)` },
                ]}
              />
            )}
            <Select
              label={fromPast ? `Class in ${formatSession(lastSession)}` : "Class"}
              required
              value={classShort}
              onChange={(e) => chooseClass(e.target.value)}
              error={show(0) ? step1Errors.classShort : undefined}
              help={fromPast && (templates.data ?? []).length === 0 ? "No classes from last session can be found." : fromPast ? "Class 10 has left the school, so only classes with students still here are listed." : undefined}
              options={[{ value: "", label: "Choose…" }, ...(templates.data ?? []).map((t) => ({ value: t.classShort, label: `${t.className} · ${t.sections.length} ${t.sections.length === 1 ? "section" : "sections"}` }))]}
            />
            {template && (
              <fieldset className="m-0 grid gap-2 border-0 p-0">
                <legend className="mb-2 text-small font-medium">{fromPast ? `Sections in ${formatSession(lastSession)}` : "Sections that sit this exam"}</legend>
                <div className="flex flex-wrap gap-4">
                  {template.sections.map((s) => (
                    <Checkbox
                      key={s.classSection}
                      label={`${s.classSection} · ${s.students} students${s.groups ? ` (${Object.entries(s.groups).map(([g, n]) => `${n} ${g}`).join(", ")})` : ""}`}
                      checked={sections.includes(s.classSection)}
                      onChange={(e) => setSections((list) => (e.target.checked ? [...list, s.classSection].sort() : list.filter((x) => x !== s.classSection)))}
                    />
                  ))}
                </div>
                {show(0) && step1Errors.sections && <p className="m-0 text-small text-danger-ink">{step1Errors.sections}</p>}
              </fieldset>
            )}
          </div>
        </Panel>
      )}

      {step === 1 && (
        <Panel
          id="new-exam-papers"
          title="Papers and date sheet"
          description={`Subjects and maximum marks come from the class's subject list in Setup. Change a paper's maximum for this exam only, untick a subject that isn't examined, and give each paper a date.${groups.length ? " “Sat by” limits a paper to some groups: other students don't take it." : ""}`}
          rise={0}
          actions={
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-44">
                <DatePicker aria-label="First paper on" value={firstDate} onValueChange={setFirstDate} today={examsToday()} minDate={examsToday()} />
              </div>
              <Button icon="calendar" onClick={spreadDates} disabled={!firstDate}>
                One paper a day
              </Button>
            </div>
          }
        >
          <div className="grid gap-4">
            <div className="overflow-x-auto">
              <table className="mtb-table mtb-table-dense">
                <caption className="mtb-sr-only">Papers</caption>
                <thead>
                  <tr>
                    <th scope="col" style={{ position: "static", width: 40 }} aria-label="Included" />
                    <th scope="col" style={{ position: "static" }}>
                      Subject
                    </th>
                    <th scope="col" className="mtb-th-num" style={{ position: "static", width: 110 }}>
                      Max marks
                    </th>
                    <th scope="col" style={{ position: "static", width: 190 }}>
                      Date
                    </th>
                    <th scope="col" style={{ position: "static", width: 100 }}>
                      Starts
                    </th>
                    <th scope="col" className="mtb-th-num" style={{ position: "static", width: 110 }}>
                      Minutes
                    </th>
                    <th scope="col" style={{ position: "static", width: 190 }}>
                      Invigilator
                    </th>
                    {groups.length > 0 && (
                      <th scope="col" style={{ position: "static", width: 200 }}>
                        Sat by
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {papers.map((p, i) => {
                    const err = paperErrors[i] ?? {};
                    return (
                      <tr key={p.id} className={p.include ? undefined : "opacity-60"}>
                        <td>
                          <Checkbox aria-label={`Include ${p.name}`} checked={p.include} onChange={(e) => setPaper(i, { include: e.target.checked })} />
                        </td>
                        <td className="font-medium">
                          {p.name}
                          {p.date && <div className="text-small font-normal text-ink-muted">{formatWeekday(p.date)}</div>}
                        </td>
                        <td>
                          <Input aria-label={`${p.name} maximum marks`} value={p.maxMarks} disabled={!p.include} inputMode="numeric" amount onChange={(e) => setPaper(i, { maxMarks: e.target.value.replace(/\D/g, "") })} error={show(1) ? err.maxMarks : undefined} />
                        </td>
                        <td>
                          <DatePicker aria-label={`${p.name} date`} value={p.date} disabled={!p.include} onValueChange={(d) => setPaper(i, { date: d })} today={examsToday()} />
                        </td>
                        <td>
                          <Input aria-label={`${p.name} start time`} value={p.startTime} disabled={!p.include} onChange={(e) => setPaper(i, { startTime: e.target.value })} error={show(1) ? err.startTime : undefined} />
                        </td>
                        <td>
                          <Input aria-label={`${p.name} minutes`} value={p.duration} disabled={!p.include} inputMode="numeric" amount onChange={(e) => setPaper(i, { duration: e.target.value.replace(/\D/g, "") })} error={show(1) ? err.duration : undefined} />
                        </td>
                        <td>
                          <Input aria-label={`${p.name} invigilator`} value={p.supervisor} disabled={!p.include} placeholder="Optional" onChange={(e) => setPaper(i, { supervisor: e.target.value })} />
                        </td>
                        {groups.length > 0 && (
                          <td>
                            <div className="grid gap-1">
                              {groups.map((g) => (
                                <Checkbox
                                  key={g}
                                  label={g}
                                  disabled={!p.include}
                                  checked={p.groups.includes(g)}
                                  onChange={(e) => setPaper(i, { groups: e.target.checked ? [...p.groups, g] : p.groups.filter((x) => x !== g) })}
                                />
                              ))}
                              <span className={`text-[12px] ${paperGroups(p, groups).length > 1 ? "font-medium text-danger-ink" : "text-ink-muted"}`}>{paperGroups(p, groups).length === 0 ? "Everyone" : paperGroups(p, groups).length > 1 ? "One group, or none for everyone" : `${p.groups.join(", ")} only`}</span>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {show(1) && included.length === 0 && <Banner tone="danger">Tick at least one subject.</Banner>}
            {show(1) && multiGroup.length > 0 && (
              <Banner tone="danger">
                {multiGroup.map((p) => p.name).join(", ")}: choose one group, or none for everyone. A paper for some but not all groups can't be set up yet.
              </Banner>
            )}
            {show(1) && groupless.length > 0 && <Banner tone="danger">{groupless.join(" and ")} {groupless.length === 1 ? "sits" : "sit"} none of these papers. Tick it under “Sat by” for at least one paper.</Banner>}
            {clashes.length > 0 && (
              <Banner tone="warning" title="Check the date sheet">
                <ul className="m-0 mt-1 grid gap-0.5 ps-5">
                  {clashes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </Banner>
            )}
            <p className="m-0 text-small text-ink-muted">
              {included.length} {included.length === 1 ? "paper" : "papers"} · <span className="mtb-num">{totalMax}</span> marks in all. Dates can be changed later from the exam's overview until results are declared.
            </p>
          </div>
        </Panel>
      )}

      {step === 2 && (
        <Panel id="new-exam-review" title="Check and create" description="Nothing is visible to parents until the results are declared." rise={0}>
          <div className="grid max-w-3xl gap-5">
            <KeyValue
              items={[
                ["Exam", name.trim()],
                ["Type", type ? `${type.name} · ${EXAMS_CATEGORY_LABEL[type.category]}` : "—"],
                ["Campus", `${campusLabel(ctx.campus)} · Session ${formatSession(ctx.session)}`],
                ["Sections", `${sections.join(", ")} · ${students} students${fromPast ? ` · as in ${formatSession(lastSession)} (now promoted)` : ""}`],
                ["Papers", `${included.length} · ${totalMax} marks${groups.length ? ` in all · ${groups.map((g) => `${g}: ${included.filter((p) => paperGroups(p, groups).length === 0 || p.groups.includes(g)).reduce((a, p) => a + (Number(p.maxMarks) || 0), 0)}`).join(" · ")}` : ""}`],
                ["Date sheet", included.every((p) => p.date) ? `${formatDate(included.map((p) => p.date!).sort()[0]!)} to ${formatDate(included.map((p) => p.date!).sort().at(-1)!)}` : "Some papers have no date yet"],
                ["Absence fine", type && type.absenceFine > 0 ? `Rs ${type.absenceFine} for each paper missed without leave` : "None for this exam type"],
              ]}
            />
            {create.isError && <Banner tone="danger">{errorText(create.error)}</Banner>}
          </div>
        </Panel>
      )}

      <div className="flex flex-wrap justify-between gap-3">
        <Button icon="arrowLeft" disabled={step === 0 || create.isPending} onClick={() => setStep((s) => s - 1)}>
          Back
        </Button>
        {step < 2 ? (
          <Button variant="primary" iconRight="arrowRight" onClick={next}>
            Next
          </Button>
        ) : (
          <Button variant="primary" icon="check" loading={create.isPending} loadingLabel="Creating…" onClick={() => create.mutate()}>
            Create exam
          </Button>
        )}
      </div>
    </div>
  );
}

function fromTemplate(subjects: ExamsSubject[], type: ExamsType | undefined): PaperDraft[] {
  // A type with its own papers (Hifz: Manzil 1–7, Tajweed …) uses them instead of the class's subjects.
  if (type?.papers?.length)
    return type.papers.map((s) => ({ id: s.id, name: s.name, include: true, maxMarks: String(s.maxMarks), date: null, startTime: "08:00", duration: "40", supervisor: "", groups: [] }));
  const test = type?.category === "TEST";
  return subjects.map((s) => ({
    id: s.id,
    name: s.name,
    include: true,
    maxMarks: String(test ? 25 : s.maxMarks),
    date: null,
    startTime: test ? "08:00" : "09:00",
    duration: String(test ? 40 : s.maxMarks >= 75 ? 180 : 120),
    supervisor: "",
    groups: s.groups ?? [],
  }));
}
