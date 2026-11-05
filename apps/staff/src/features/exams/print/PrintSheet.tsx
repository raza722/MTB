import type { CSSProperties, ReactNode } from "react";
import { useAppearance } from "../../../app/appearance";
import "../exams.css";

export type ExamPaper = "A4" | "A4L";

const PAGE_RULE: Record<ExamPaper, string> = {
  A4: "@page { size: A4 portrait; margin: 8mm; }",
  A4L: "@page { size: A4 landscape; margin: 8mm; }",
};

/**
 * Wraps printable exam documents: only this area prints, always in the light theme, on the paper given.
 * The page rule overrides the app's default A5 receipt page while the preview is on screen.
 */
export function PrintSheet({ paper, label, zoom, children }: { paper: ExamPaper; label: string; zoom?: number; children: ReactNode }) {
  const { accent } = useAppearance();
  return (
    <div className="exams-desk" aria-label={label}>
      <style>{PAGE_RULE[paper]}</style>
      <div className="exams-zoom" style={{ "--doc-zoom": zoom ?? (paper === "A4L" ? 0.52 : 0.66) } as CSSProperties}>
        <div data-theme="light" data-accent={accent} className="mtb-print-area">
          {children}
        </div>
      </div>
    </div>
  );
}

/** Prints after React has painted the document. */
export function printNow() {
  window.setTimeout(() => window.print(), 60);
}
