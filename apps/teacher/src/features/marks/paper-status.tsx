import type { ExamsCategory, TeacherPaper } from "@mtb/api";
import { StatusBadge } from "@mtb/ui";

export const CATEGORY_LABEL: Record<ExamsCategory, string> = {
  TERM: "Term exam",
  TEST: "Class test",
  BOARD: "Board exam",
  ENTRANCE: "Entry test",
  UNIVERSITY: "Semester exam",
};

/** Where a paper stands for the teacher: Not started, Draft, Submitted, Checked, or Declared (locked). */
export function PaperBadge({ p }: { p: Pick<TeacherPaper, "examStatus" | "status"> }) {
  if (p.examStatus === "DECLARED")
    return (
      <StatusBadge status="declared" icon="lock">
        Declared
      </StatusBadge>
    );
  switch (p.status) {
    case "NOT_STARTED":
      return <StatusBadge status="neutral">Not started</StatusBadge>;
    case "IN_PROGRESS":
      return <StatusBadge status="draft">Draft</StatusBadge>;
    case "SUBMITTED":
      return (
        <StatusBadge status="info" icon="lock">
          Submitted
        </StatusBadge>
      );
    case "CHECKED":
      return (
        <StatusBadge status="success" icon="lock">
          Checked
        </StatusBadge>
      );
  }
}

/** The brief's marks header: "First Term · Mathematics · 7-B · Max marks 75". */
export const paperHeader = (p: Pick<TeacherPaper, "examName" | "subjectName" | "classSection" | "maxMarks">) => `${p.examName} · ${p.subjectName} · ${p.classSection} · Max marks ${p.maxMarks}`;
