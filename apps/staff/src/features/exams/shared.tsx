import { ApiError, can, EXAMS_PAPER_STATUS_LABEL, type CampusCode, type Permission, EXAMS_RESULT_LABEL, type ExamDetail, type ExamsMark, type ExamsPaperStatus, type ExamsResultCode, type ExamSummary } from "@mtb/api";
import { formatPercent, pakistanToday, type IsoDate } from "@mtb/domain";
import { Banner, Button, StatusBadge } from "@mtb/ui";
import { createContext, useContext, type ReactNode } from "react";
import { useSessionUser } from "../../app/session";
import { SubNav } from "../../app/shell/SubNav";
import "./exams.css";

/** Today in Pakistan time: the default and limit of the module's date pickers. */
export const examsToday = (): IsoDate => pakistanToday();

/** A % that may have no base (nobody has a mark yet): "—", never 0. */
export const percentText = (v: number | null | undefined) => (v === null || v === undefined ? "—" : formatPercent(v));

/** Plain-English text for a failed request. */
export const errorText = (e: unknown) => (e instanceof ApiError ? (e.isNetwork ? "No response from the server — nothing was changed. Try again." : e.message) : "Something went wrong. Try again.");

/**
 * Exam types and grade scales are shared by every campus: only an all-campus grant of exams.manage (head office) may
 * change them; a campus principal sees them read-only (the API refuses the save too).
 */
export function useCanEditShared(): boolean {
  return can(useSessionUser(), "exams.manage", "ALL");
}

/**
 * A permission on one exam: checked at the exam's own campus (the API checks the record's campus), so an exam opened
 * from a link or from "All campuses" offers what the user may do there.
 */
export function useCanOnExam(permission: Permission, campus: CampusCode): boolean {
  return can(useSessionUser(), permission, campus);
}

/** The module's own pages. */
export function ExamsNav() {
  return (
    <SubNav
      label="Exams"
      items={[
        { to: "/exams", label: "Exams", icon: "exams", exact: true },
        { to: "/exams/combined", label: "Combined results", icon: "layers" },
        { to: "/exams/merit", label: "Merit lists", icon: "award" },
        { to: "/exams/history", label: "Student history", icon: "trendUp" },
        { to: "/exams/teachers", label: "Teacher performance", icon: "user" },
        { to: "/exams/university", label: "University", icon: "book" },
        { to: "/exams/programmes", label: "Programmes", icon: "star" },
        { to: "/exams/types", label: "Exam types", icon: "listChecks" },
        { to: "/exams/grading", label: "Grading rules", icon: "checkSquare" },
      ]}
    />
  );
}

/** "First Term 2026–27 · Class 7" */
export function examTitle(exam: Pick<ExamSummary, "name" | "classes"> & Partial<Pick<ExamSummary, "programmeId">>) {
  const first = exam.classes[0] ?? "";
  // A programme test's sections are test centres.
  if (exam.programmeId) return `${exam.name} · ${exam.classes.length} ${exam.classes.length === 1 ? "centre" : "centres"}`;
  if (exam.classes.length > 1) return `${exam.name} · ${first.split("-")[0] === "Prep" ? "Prep" : `Class ${first.split("-")[0]}`}`;
  return `${exam.name} · ${first}`;
}

/** Status cell: Draft / Declared, plus anything blocking or pending. */
export function ExamStatus({ exam }: { exam: ExamSummary }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {exam.status === "DECLARED" ? <StatusBadge status="declared" icon="lock" /> : <StatusBadge status="draft" />}
      {exam.status === "DRAFT" && exam.missingMarks > 0 && (
        <StatusBadge status="warning" dot={false}>
          {exam.missingMarks} {exam.missingMarks === 1 ? "mark" : "marks"} missing
        </StatusBadge>
      )}
      {exam.status === "DRAFT" && exam.missingMarks === 0 && (
        <StatusBadge status="success" dot={false}>
          Ready to declare
        </StatusBadge>
      )}
      {exam.status === "DECLARED" && exam.missingMarks > 0 && (
        <StatusBadge status="neutral" dot={false}>
          {exam.missingMarks} {exam.missingMarks === 1 ? "mark" : "marks"} missing (old system)
        </StatusBadge>
      )}
      {exam.reopen?.status === "PENDING" && <StatusBadge status="pending">Reopen requested</StatusBadge>}
    </span>
  );
}

const PAPER_TONE: Record<ExamsPaperStatus, "neutral" | "warning" | "info" | "success"> = { NOT_STARTED: "neutral", IN_PROGRESS: "warning", SUBMITTED: "info", CHECKED: "success" };

export function PaperBadge({ status }: { status: ExamsPaperStatus }) {
  return (
    <StatusBadge status={PAPER_TONE[status]} dot={status !== "CHECKED"} {...(status === "CHECKED" ? { icon: "check" as const } : {})}>
      {EXAMS_PAPER_STATUS_LABEL[status]}
    </StatusBadge>
  );
}

const RESULT_TONE: Record<ExamsResultCode, "success" | "warning" | "danger" | "neutral" | "pending"> = { PASS: "success", SUPPLY: "warning", FAIL: "danger", INCOMPLETE: "neutral", WITHHELD: "pending" };

export function ResultBadge({ result }: { result: ExamsResultCode | undefined }) {
  if (!result) return null;
  return (
    <StatusBadge status={RESULT_TONE[result]} dot={false}>
      {EXAMS_RESULT_LABEL[result]}
    </StatusBadge>
  );
}

/** A mark as text: "88", "A", "L" or "—". */
export const markText = (m: ExamsMark | undefined) => (m === null || m === undefined ? "—" : m === "A" ? "Abs" : m === "L" ? "Leave" : String(m));

/** "1st", "2nd", "3rd" … */
export function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** Class number of a section: "7-B" → "7". */
export const classOf = (cs: string) => cs.split("-")[0] ?? cs;

// ------------------------------------------------------------------ The open exam, shared by its sub-pages

const ExamCtx = createContext<ExamDetail | null>(null);

export function ExamProvider({ exam, children }: { exam: ExamDetail; children: ReactNode }) {
  return <ExamCtx.Provider value={exam}>{children}</ExamCtx.Provider>;
}

/** The exam loaded by the exam layout (/exams/$examId). */
export function useExam(): ExamDetail {
  const exam = useContext(ExamCtx);
  if (!exam) throw new Error("useExam must be used inside the exam layout.");
  return exam;
}

/** A load error with a retry button. */
export function LoadError({ what, error, onRetry }: { what: string; error: unknown; onRetry: () => void }) {
  return (
    <Banner
      tone="danger"
      title={`${what} couldn't be loaded.`}
      actions={
        <Button size="sm" icon="refresh" onClick={onRetry}>
          Try again
        </Button>
      }
    >
      {errorText(error)}
    </Banner>
  );
}
