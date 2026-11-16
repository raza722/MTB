import type { CSSProperties, ReactNode } from "react";
import { useAppearance } from "../../../app/appearance";
import { footerBoxes } from "../../../app/print/letterhead";
import "../exams.css";

export type ExamPaper = "A4" | "A4L";

const SIZE: Record<ExamPaper, string> = { A4: "A4 portrait", A4L: "A4 landscape" };

/**
 * Wraps printable exam documents: only this area prints, always in the light theme, on the paper given.
 * The page rule overrides the app's default A5 receipt page while the preview is on screen. `footer` (default on)
 * prints the old footer on every page: "Print DateTime …" bottom left and "Page No x of y" bottom right; documents the
 * old system printed without it (result cards, envelope tags, the two-copy script marking list) turn it off.
 */
export function PrintSheet({ paper, label, zoom, footer = true, children }: { paper: ExamPaper; label: string; zoom?: number; footer?: boolean; children: ReactNode }) {
  const { accent } = useAppearance();
  const rule = `@page { size: ${SIZE[paper]}; margin: 8mm 8mm ${footer ? "11mm" : "8mm"};${footer ? footerBoxes() : ""} }`;
  return (
    <div className="exams-desk" aria-label={label}>
      <style>{rule}</style>
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
