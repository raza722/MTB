import { teacherQueries, type TeacherPaper } from "@mtb/api";
import { formatDate } from "@mtb/domain";
import { EmptyState, Icon, Skeleton, StatusBadge, Stepper, cx } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { useCtx } from "../../app/session";
import { QueryState } from "../../app/shell/QueryState";
import { Screen, Section } from "../../app/shell/Screen";
import { CATEGORY_LABEL, PaperBadge } from "./paper-status";

interface ExamGroup {
  examId: string;
  examName: string;
  category: TeacherPaper["category"];
  declared: boolean;
  papers: TeacherPaper[];
}

function groupByExam(papers: TeacherPaper[]): ExamGroup[] {
  const out: ExamGroup[] = [];
  for (const p of papers) {
    let g = out.find((x) => x.examId === p.examId);
    if (!g) {
      g = { examId: p.examId, examName: p.examName, category: p.category, declared: p.examStatus === "DECLARED", papers: [] };
      out.push(g);
    }
    g.papers.push(p);
  }
  return out;
}

/** Pick the exam, then the class, then the subject — only the teacher's own papers are listed. */
export function MarksPage({ exam, cls }: { exam?: string; cls?: string }) {
  const ctx = useCtx();
  const q = useQuery(teacherQueries.papers(ctx));
  return (
    <Screen title="Marks" documentTitle="Marks">
      <QueryState
        query={q}
        skeleton={
          <div className="grid gap-2" aria-busy="true" aria-label="Loading your papers">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={84} className="rounded-lg" />
            ))}
          </div>
        }
      >
        {(papers) => <Picker papers={papers} exam={exam} cls={cls} />}
      </QueryState>
    </Screen>
  );
}

function Picker({ papers, exam, cls }: { papers: TeacherPaper[]; exam: string | undefined; cls: string | undefined }) {
  const exams = groupByExam(papers);
  if (exams.length === 0) {
    return (
      <div className="mtb-card p-2">
        <EmptyState icon="exams" title="No papers to mark" description="When the exam office sets an exam for one of your classes and subjects, it appears here." />
      </div>
    );
  }
  const chosen = exams.find((e) => e.examId === exam);
  const classes = chosen ? [...new Set(chosen.papers.map((p) => p.classSection))] : [];
  const chosenClass = chosen ? (classes.includes(cls ?? "") ? cls : classes.length === 1 ? classes[0] : undefined) : undefined;
  const step = !chosen ? 0 : !chosenClass ? 1 : 2;

  return (
    <div className="grid gap-5">
      <div className="mtb-card px-4 py-3">
        <Stepper steps={["Exam", "Class", "Subject"]} current={step} label="Choose a paper" />
      </div>

      {!chosen ? (
        <Section title="1 · Choose the exam" rise={0}>
          <ul className="m-0 grid list-none gap-2 p-0">
            {exams.map((e, i) => {
              const open = e.papers.filter((p) => !p.locked);
              return (
                <li key={e.examId} className="mtb-slide-in" style={{ "--i": i } as CSSProperties}>
                  <Link to="/marks" search={{ exam: e.examId }} className="mtb-card flex min-h-16 items-center gap-3 p-4 text-inherit no-underline hover:border-border-strong">
                    <span className={cx("grid size-10 shrink-0 place-items-center rounded-md", open.length ? "bg-brand-tint text-brand-ink" : "bg-surface-sunken text-ink-muted")}>
                      <Icon name={e.declared ? "lock" : "exams"} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-ink">{e.examName}</span>
                      <span className="block text-small text-ink-muted">
                        {CATEGORY_LABEL[e.category]} · {e.papers.length} {e.papers.length === 1 ? "paper" : "papers"} for you
                      </span>
                    </span>
                    {e.declared ? (
                      <StatusBadge status="declared" icon="lock">
                        Declared
                      </StatusBadge>
                    ) : open.length ? (
                      <StatusBadge status="warning">{open.length} to finish</StatusBadge>
                    ) : (
                      <StatusBadge status="success">All submitted</StatusBadge>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 px-1">
            <p className="m-0 min-w-0">
              <span className="block text-caption tracking-wide text-ink-muted uppercase">Exam</span>
              <span className="block truncate font-medium text-ink">{chosen.examName}</span>
            </p>
            <Link to="/marks" search={{}} className="mtb-btn mtb-btn-ghost mtb-btn-touch shrink-0">
              Change
            </Link>
          </div>

          <Section title="2 · Choose the class" rise={0}>
            <div className="flex flex-wrap gap-2" role="list">
              {classes.map((c) => (
                <Link
                  key={c}
                  role="listitem"
                  to="/marks"
                  search={{ exam: chosen.examId, cls: c }}
                  aria-current={c === chosenClass ? "true" : undefined}
                  className={cx(
                    "inline-flex h-11 min-w-16 items-center justify-center rounded-full border px-4 font-medium no-underline",
                    c === chosenClass ? "border-brand bg-brand-tint text-brand-ink" : "border-border-strong bg-surface-raised text-ink hover:bg-surface-hover",
                  )}
                >
                  {c}
                </Link>
              ))}
            </div>
          </Section>

          {chosenClass && (
            <Section title="3 · Choose the subject" rise={1}>
              <ul className="m-0 grid list-none gap-2 p-0">
                {chosen.papers
                  .filter((p) => p.classSection === chosenClass)
                  .map((p, i) => {
                    const pct = p.candidates ? Math.round((p.entered / p.candidates) * 100) : 0;
                    return (
                      <li key={p.subjectId} className="mtb-slide-in" style={{ "--i": i } as CSSProperties}>
                        <Link
                          to="/marks/$examId/$classSection/$subjectId"
                          params={{ examId: p.examId, classSection: p.classSection, subjectId: p.subjectId }}
                          className="mtb-card grid gap-2 p-4 text-inherit no-underline hover:border-border-strong"
                        >
                          <span className="flex items-start justify-between gap-2">
                            <span className="min-w-0">
                              <span className="block text-title-3 text-ink">{p.subjectName}</span>
                              <span className="block text-small text-ink-muted">
                                Max marks {p.maxMarks}
                                {p.paperDate && (
                                  <>
                                    {" "}
                                    · paper on <bdi dir="ltr">{formatDate(p.paperDate)}</bdi>
                                  </>
                                )}
                              </span>
                            </span>
                            <PaperBadge p={p} />
                          </span>
                          <span className="h-2 overflow-hidden rounded-full bg-surface-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={p.candidates} aria-valuenow={p.entered} aria-label="Marks entered">
                            <span className="block h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                          </span>
                          <span className="flex items-center justify-between text-small text-ink-muted tabular-nums">
                            <span>
                              {p.entered} of {p.candidates} entered
                              {p.absent ? ` · ${p.absent} absent` : ""}
                            </span>
                            <span className="inline-flex items-center gap-1 font-medium text-brand-ink">
                              {p.locked ? "View" : p.entered ? "Continue" : "Start"} <Icon name="chevronRight" size={16} />
                            </span>
                          </span>
                          {p.note && <span className="text-small text-warning-ink">Returned by the exam office: {p.note}</span>}
                        </Link>
                      </li>
                    );
                  })}
              </ul>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
