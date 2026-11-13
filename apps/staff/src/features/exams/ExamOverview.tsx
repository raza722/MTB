import { EXAMS_PAPER_STATUS_LABEL, examsApi, examsQueries, type ExamDetail, type ExamsPaper, type ExamsPaperAction, type ExamsSubject } from "@mtb/api";
import { formatCount, formatDate, formatDateTime, formatRs, formatSession, formatTime, formatWeekday, type IsoDate } from "@mtb/domain";
import { AnimatedNumber, Banner, Button, buttonClassName, DataTable, DatePicker, EmptyState, Input, KeyValue, Panel, Select, SidePanel, StatCard, Textarea, Timeline, useToast, type TimelineItem } from "@mtb/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type CSSProperties } from "react";
import { z } from "zod";
import { useReadOnly } from "../../app/session";
import { errorText, examsToday, PaperBadge, useCanOnExam, useExam } from "./shared";

/** Overview of one exam: where every paper stands, the date sheet, absence fines and the history log. */
export function ExamOverview() {
  const exam = useExam();
  const canManage = useCanOnExam("exams.manage", exam.campus);
  const readOnly = useReadOnly();
  const [paper, setPaper] = useState<ExamsPaper | null>(null);
  const [editing, setEditing] = useState(false);
  const declared = exam.status === "DECLARED";
  const editable = canManage && !readOnly && !declared;
  const papers = exam.papers ?? [];
  const done = papers.filter((p) => p.status === "SUBMITTED" || p.status === "CHECKED").length;
  const absences = exam.rows.flatMap((r) => exam.subjects.filter((s) => r.marks[s.id] === "A" || r.marks[s.id] === "L").map((s) => ({ id: `${r.id}-${s.id}`, row: r, subject: s, leave: r.marks[s.id] === "L" })));
  const fineable = absences.filter((a) => !a.leave);
  const fine = exam.absenceFine ?? 0;
  // The absence-fines panel can show one section; the stat card keeps the whole exam.
  const [absSection, setAbsSection] = useState("ALL");
  const shownAbsences = absences.filter((a) => absSection === "ALL" || a.row.classSection === absSection);
  const shownFineable = shownAbsences.filter((a) => !a.leave);
  const missingList = exam.rows.flatMap((r) => exam.subjects.filter((s) => r.marks[s.id] === null).map((s) => `${r.name} (${r.classSection}) · ${s.name}`));

  const history: TimelineItem[] = exam.history.map((h) => ({
    id: h.id,
    date: h.at,
    title: h.action,
    description: `${h.by} · ${formatTime(h.at)}${h.detail ? ` · ${h.detail}` : ""}`,
    icon: h.action.includes("declared") ? "lock" : h.action.startsWith("Reopen") ? "unlock" : h.action.includes("withheld") || h.action.includes("released") ? "flag" : /[Mm]arks/.test(h.action) ? "edit" : h.action.includes("Merit") ? "award" : "exams",
    tone: h.action.includes("declared") ? "brand" : h.action.startsWith("Reopen") || h.action.includes("returned") ? "warning" : h.action.includes("checked") ? "success" : "neutral",
  }));

  return (
    <>
      {declared ? (
        <Banner tone="success" title={`Declared${exam.declaredOn ? ` on ${formatDateTime(exam.declaredOn)}` : ""}${exam.declaredBy ? ` by ${exam.declaredBy}` : ""}.`}>
          Results are read-only and visible in the parent portal. Grades and positions are kept exactly as declared.
          {exam.missingMarks > 0 && ` Declared in the old system with ${formatCount(exam.missingMarks)} ${exam.missingMarks === 1 ? "mark" : "marks"} missing: those papers show “—”.`}
        </Banner>
      ) : exam.missingMarks > 0 ? (
        <Banner tone="warning" title={`${formatCount(exam.missingMarks)} ${exam.missingMarks === 1 ? "mark is" : "marks are"} missing — results can't be declared yet.`}>
          {missingList.slice(0, 4).join("; ")}
          {missingList.length > 4 ? `; and ${missingList.length - 4} more` : ""}. Absent (A) and leave (L) are entered values, not missing.
        </Banner>
      ) : (
        <Banner tone="info" title="Draft — all marks are in.">
          The principal can declare now. Declaring locks the marks and the grading rules, so grades and positions stay as declared, and shows the results in the parent portal.
        </Banner>
      )}

      {exam.programmeId && (
        <Banner tone="info" title="Diamond Minds participants, not students.">
          The test centres are the sections here. Register participants, print the result sheet and the top ten, and start admissions in{" "}
          <Link to="/exams/programmes" className="font-medium text-brand-ink underline-offset-2 hover:underline">
            Exams → Programmes
          </Link>
          .
        </Banner>
      )}
      {exam.category === "ENTRANCE" && !exam.programmeId && (
        <Banner tone="info" title="Applicants, not students.">
          Marks are entered here like any exam. The merit list, offers and admission happen in{" "}
          <Link to="/admissions/merit" className="font-medium text-brand-ink underline-offset-2 hover:underline">
            Admissions → Merit list
          </Link>
          .
        </Banner>
      )}
      {exam.category === "BOARD" && (
        <Banner tone="info" title="Board result.">
          Marks are recorded as received from the board, against the class the students sat it in — even after they have been promoted.
          {exam.sourceSession !== undefined ? ` These students sat it in session ${formatSession(exam.sourceSession)}.` : ""}
        </Banner>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={`${exam.candidateLabel ?? "Student"}s`}
          icon="students"
          value={<AnimatedNumber value={exam.students} format={formatCount} />}
          foot={`${exam.classes.length} ${exam.programmeId ? (exam.classes.length === 1 ? "centre" : "centres") : exam.classes.length === 1 ? "group" : "sections"} · ${exam.subjects.length} papers${exam.groups?.length ? ` · ${exam.groups.length} groups` : ""}`}
        />
        <StatCard
          label="Papers submitted"
          icon="checkSquare"
          value={
            <>
              <AnimatedNumber value={done} format={formatCount} /> <span className="text-body text-ink-muted">of {papers.length}</span>
            </>
          }
          meter={papers.length ? Math.round((done / papers.length) * 100) : 0}
          meterLabel={`${done} of ${papers.length} papers submitted or checked`}
          foot={`${papers.filter((p) => p.status === "CHECKED").length} checked by the exam office`}
        />
        <StatCard label="Marks missing" icon="alertCircle" tone={exam.missingMarks > 0 && !declared ? "warning" : "neutral"} value={<AnimatedNumber value={exam.missingMarks} format={formatCount} />} foot={exam.missingMarks > 0 ? (declared ? "Declared in the old system with gaps" : "Declaring is blocked") : "Nothing missing"} />
        <StatCard label="Absent papers" icon="user" value={<AnimatedNumber value={fineable.length} format={formatCount} />} foot={fine > 0 ? `${formatRs(fine * fineable.length)} in fines · ${absences.length - fineable.length} on leave` : `${absences.length - fineable.length} on leave · no fine for this type`} />
      </div>

      <Panel
        id="exam-progress"
        title="Marks progress"
        description="Each box is one section's paper: who teaches it and how far the marks are. Open one to check it or send it back to the teacher."
        rise={1}
        actions={
          <Link to="/exams/$examId/marks" params={{ examId: exam.id }} className={buttonClassName({ size: "sm", variant: editable ? "primary" : "secondary" })}>
            {editable ? "Enter marks" : "View marks"}
          </Link>
        }
      >
        <div className="overflow-x-auto">
          <div className="exams-board" style={{ "--cols": exam.subjects.length } as CSSProperties}>
            <div className="exams-board-row" aria-hidden="true">
              <span />
              {exam.subjects.map((s) => (
                <span key={s.id} className="text-small font-medium text-ink-muted">
                  {s.name} <span className="mtb-num">/{s.maxMarks}</span>
                </span>
              ))}
            </div>
            {exam.classes.map((cs, ri) => (
              <div key={cs} className="exams-board-row mtb-slide-in" style={{ "--i": ri } as CSSProperties}>
                <span className="self-center font-semibold">{cs}</span>
                {exam.subjects.map((s) => {
                  const p = papers.find((x) => x.classSection === cs && x.subjectId === s.id);
                  if (!p) return <span key={s.id} />;
                  const pct = p.candidates ? Math.round((p.entered / p.candidates) * 100) : 0;
                  return (
                    <button key={s.id} type="button" className="exams-board-cell" data-status={p.status} onClick={() => setPaper(p)} aria-label={`${cs} ${s.name}: ${EXAMS_PAPER_STATUS_LABEL[p.status]}, ${p.entered} of ${p.candidates} entered`}>
                      <span className="text-small font-semibold">{EXAMS_PAPER_STATUS_LABEL[p.status]}</span>
                      <span className="text-small text-ink-muted">
                        <span className="mtb-num">{p.entered}</span>/{p.candidates} entered
                      </span>
                      <span className="exams-board-meter" aria-hidden="true">
                        <span style={{ width: `${pct}%` }} />
                      </span>
                      <span className="truncate text-[12px] text-ink-muted">{teacherText(exam, p)}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel
          id="exam-datesheet"
          title="Date sheet"
          description="Paper dates, times and invigilators. Parents get the printed date sheet."
          rise={2}
          flush
          actions={
            <>
              <Link to="/exams/$examId/print" params={{ examId: exam.id }} search={{ doc: "datesheet" } as never} className={buttonClassName({ size: "sm", variant: "ghost" })}>
                Print
              </Link>
              {editable && (
                <Button size="sm" icon="edit" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )}
            </>
          }
        >
          <DataTable
            caption="Date sheet"
            rows={exam.subjects}
            density="dense"
            columns={[
              { key: "date", header: "Date", width: 150, render: (s) => (s.date ? <span className="grid"><span className="mtb-num">{formatDate(s.date)}</span><span className="mtb-cell-secondary">{formatWeekday(s.date)}</span></span> : <span className="text-ink-muted">Not set</span>) },
              { key: "name", header: "Paper", render: (s) => <span className="mtb-cell-primary">{s.name}</span> },
              { key: "time", header: "Time", width: 130, render: (s) => (s.startTime ? `${s.startTime}${s.durationMins ? ` · ${s.durationMins} min` : ""}` : "—") },
              { key: "max", header: "Max", align: "right", width: 70, render: (s) => <span className="mtb-num">{s.maxMarks}</span> },
              { key: "sup", header: "Invigilator", width: 170, render: (s) => s.supervisor ?? <span className="text-ink-muted">—</span> },
            ]}
          />
        </Panel>

        <Panel
          id="exam-fines"
          title="Absence fines"
          description={fine > 0 ? `${formatRs(fine)} for each paper missed without leave. Leave (L) is never fined.` : "This exam type has no absence fine. Absences are listed for follow-up."}
          rise={3}
          flush
          actions={
            <>
              {exam.classes.length > 1 && (
                <Select aria-label="Section" value={absSection} onChange={(e) => setAbsSection(e.target.value)} options={[{ value: "ALL", label: "Every section" }, ...exam.classes.map((c) => ({ value: c, label: c }))]} />
              )}
              <Link to="/exams/$examId/print" params={{ examId: exam.id }} search={{ doc: "absent", ...(absSection !== "ALL" ? { section: absSection } : {}) } as never} className={buttonClassName({ size: "sm", variant: "ghost" })}>
                Print
              </Link>
            </>
          }
        >
          {shownAbsences.length === 0 ? (
            <EmptyState icon="checkCircle" title="No absences" description={absSection === "ALL" ? "Every candidate sat every paper entered so far." : `Everyone in ${absSection} sat every paper entered so far.`} />
          ) : (
            <DataTable
              caption="Absences"
              rows={shownAbsences}
              density="dense"
              maxHeight={300}
              columns={[
                { key: "who", header: "Student", render: (a) => <span className="grid"><span className="mtb-cell-primary">{a.row.name}</span><span className="mtb-cell-secondary">{a.row.classSection} · <span className="mtb-mono">{a.row.id}</span></span></span> },
                { key: "subject", header: "Paper", width: 130, render: (a) => a.subject.name },
                { key: "fine", header: "Fine", align: "right", width: 110, render: (a) => (a.leave ? <span className="text-small text-ink-muted">On leave</span> : fine > 0 ? <span className="mtb-num">{formatRs(fine)}</span> : "—") },
              ]}
              footer={fine > 0 ? { who: `${shownFineable.length} papers missed`, fine: formatRs(fine * shownFineable.length) } : undefined}
            />
          )}
        </Panel>
      </div>

      <Panel id="exam-history" title="History" description="Every change to this exam, newest first: who did it and when." rise={4}>
        <Timeline items={history} label="Exam history" />
      </Panel>

      {paper && <PaperPanel exam={exam} paper={paper} editable={editable} onClose={() => setPaper(null)} />}
      {editing && <DateSheetPanel exam={exam} onClose={() => setEditing(false)} />}
    </>
  );
}

/** Who marks a paper: the section's subject teacher; entrance tests are marked by the admissions office. */
const teacherText = (exam: Pick<ExamDetail, "category" | "programmeId">, p: Pick<ExamsPaper, "teacher">) =>
  p.teacher || (exam.category === "ENTRANCE" && !exam.programmeId ? "Admissions office" : "No subject teacher recorded");

/** One section's paper: counts, teacher, and the exam office's check / return actions. */
function PaperPanel({ exam, paper, editable, onClose }: { exam: ExamDetail; paper: ExamsPaper; editable: boolean; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [returning, setReturning] = useState(false);
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const live = exam.papers?.find((p) => p.classSection === paper.classSection && p.subjectId === paper.subjectId) ?? paper;
  const act = useMutation({
    mutationFn: (action: ExamsPaperAction) => examsApi.paperAction(exam.id, { classSection: live.classSection, subjectId: live.subjectId, action, ...(action === "RETURN" ? { note } : {}) }),
    onSuccess: (data, action) => {
      queryClient.setQueryData(examsQueries.detail(exam.id).queryKey, data);
      void queryClient.invalidateQueries({ queryKey: ["exams"], refetchType: "active" });
      toast(action === "CHECK" ? { title: "Marked as checked", message: `${live.subjectName} · ${live.classSection}` } : { tone: "info", title: "Sent back to the teacher", message: `${live.teacher ?? "The teacher"} sees your note in the teacher app.` });
      onClose();
    },
  });
  const missing = live.candidates - live.entered;
  return (
    <SidePanel
      open
      onClose={onClose}
      title={`${live.subjectName} · ${live.classSection}`}
      description={`${exam.name} · out of ${live.maxMarks}`}
      footer={
        <>
          <Link to="/exams/$examId/marks" params={{ examId: exam.id }} search={{ section: live.classSection, subject: live.subjectId } as never} className={buttonClassName()}>
            {editable ? "Enter or correct marks" : "View marks"}
          </Link>
          {editable && live.status !== "CHECKED" && (
            <Button variant="primary" icon="check" disabled={missing > 0} loading={act.isPending && act.variables === "CHECK"} onClick={() => act.mutate("CHECK")}>
              Mark as checked
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-5">
        <div>
          <PaperBadge status={live.status} />
        </div>
        <KeyValue
          items={[
            ["Teacher", teacherText(exam, live)],
            ["Entered", `${live.entered} of ${live.candidates}${missing > 0 ? ` · ${missing} missing` : ""}`],
            ["Absent", `${live.absent}${live.leave ? ` · ${live.leave} on leave` : ""}`],
            ["Last change", live.updatedAt ? `${live.updatedBy ?? "—"} · ${formatDateTime(live.updatedAt)}` : "Nothing entered yet"],
          ]}
        />
        {live.note && <Banner tone="warning" title="Returned to the teacher">{live.note}</Banner>}
        {missing > 0 && <Banner tone="info">This paper can be marked as checked once every mark is in (A for absent, L for leave).</Banner>}
        {editable && (live.status === "SUBMITTED" || live.status === "CHECKED") && (
          <div className="grid gap-3">
            {!returning ? (
              <div>
                <Button variant="danger-quiet" icon="arrowLeft" onClick={() => setReturning(true)}>
                  Return to the teacher…
                </Button>
              </div>
            ) : (
              <>
                <Textarea label="What needs correcting?" required rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: three marks look out of 50, not 25. Please check rolls 4, 9 and 12." error={tried && !note.trim() ? "Say what the teacher needs to correct." : undefined} />
                <div className="flex gap-2">
                  <Button onClick={() => setReturning(false)}>Cancel</Button>
                  <Button
                    variant="danger"
                    loading={act.isPending && act.variables === "RETURN"}
                    onClick={() => {
                      setTried(true);
                      if (note.trim()) act.mutate("RETURN");
                    }}
                  >
                    Send back
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
        {act.isError && <Banner tone="danger">{errorText(act.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

const sheetRow = z.object({
  maxMarks: z.coerce.number({ error: "Type the maximum." }).int("Use a whole number.").min(1, "At least 1.").max(1000, "No more than 1,000."),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:00."),
  durationMins: z.coerce.number({ error: "Type the minutes." }).int("Whole minutes.").min(10, "At least 10.").max(300, "No more than 300."),
});

interface SheetDraft {
  id: string;
  name: string;
  maxMarks: string;
  date: IsoDate | null;
  startTime: string;
  durationMins: string;
  supervisor: string;
}

/** Edit dates, times, invigilators and maximum marks while the exam is in draft. */
function DateSheetPanel({ exam, onClose }: { exam: ExamDetail; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<SheetDraft[]>(
    exam.subjects.map((s) => ({ id: s.id, name: s.name, maxMarks: String(s.maxMarks), date: s.date ?? null, startTime: s.startTime ?? "09:00", durationMins: String(s.durationMins ?? 120), supervisor: s.supervisor ?? "" })),
  );
  const [tried, setTried] = useState(false);
  const errors = rows.map((r) => {
    const p = sheetRow.safeParse(r);
    return p.success ? {} : Object.fromEntries(p.error.issues.map((i) => [String(i.path[0]), i.message]));
  });
  const valid = errors.every((e) => Object.keys(e).length === 0);
  const save = useMutation({
    mutationFn: () =>
      examsApi.saveDateSheet(
        exam.id,
        rows.map<ExamsSubject>((r) => {
          const s = exam.subjects.find((x) => x.id === r.id)!;
          return { ...s, maxMarks: Number(r.maxMarks), ...(r.date ? { date: r.date } : {}), startTime: r.startTime, durationMins: Number(r.durationMins), supervisor: r.supervisor.trim() };
        }),
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(examsQueries.detail(exam.id).queryKey, data);
      void queryClient.invalidateQueries({ queryKey: ["exams"], refetchType: "active" });
      toast({ title: "Date sheet saved", message: "Reprint it for parents if dates changed." });
      onClose();
    },
  });
  const set = (i: number, patch: Partial<SheetDraft>) => setRows((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <SidePanel
      open
      wide
      onClose={onClose}
      title="Edit date sheet"
      description={`${exam.name} · ${exam.classes.join(", ")}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => {
              setTried(true);
              if (valid) save.mutate();
            }}
          >
            Save date sheet
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {rows.map((r, i) => {
          const err = (tried ? errors[i] : {}) ?? {};
          return (
            <fieldset key={r.id} className="m-0 grid gap-3 rounded-md border border-border p-3">
              <legend className="px-1 font-semibold">{r.name}</legend>
              <div className="grid gap-3 sm:grid-cols-3">
                <DatePicker label="Date" value={r.date} onValueChange={(d) => set(i, { date: d })} today={examsToday()} />
                <Input label="Starts" value={r.startTime} onChange={(e) => set(i, { startTime: e.target.value })} error={err.startTime} />
                <Input label="Minutes" value={r.durationMins} inputMode="numeric" amount onChange={(e) => set(i, { durationMins: e.target.value.replace(/\D/g, "") })} error={err.durationMins} />
              </div>
              <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
                <Input label="Max marks" value={r.maxMarks} inputMode="numeric" amount onChange={(e) => set(i, { maxMarks: e.target.value.replace(/\D/g, "") })} error={err.maxMarks} />
                <Input label="Invigilator" value={r.supervisor} placeholder="Optional" onChange={(e) => set(i, { supervisor: e.target.value })} />
              </div>
            </fieldset>
          );
        })}
        <p className="m-0 text-small text-ink-muted">Lowering a maximum is blocked while a mark already entered is above it. Papers can't be added or removed after the exam is set up.</p>
        {save.isError && <Banner tone="danger">{errorText(save.error)}</Banner>}
      </div>
    </SidePanel>
  );
}
