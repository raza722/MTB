import { Switch } from "@mtb/ui";
import type { CSSProperties, ReactNode } from "react";
import { useAppearance } from "../../../app/appearance";
import { footerBoxes } from "../../../app/print/letterhead";
import "./documents.css";

/** A4_LANDSCAPE: wide registers and sign-for sheets. A4_LABELS: eight postal labels to an A4 sheet. */
export type Paper = "A4" | "A5" | "ID_SHEET" | "A4_LANDSCAPE" | "A4_LABELS";

const PAGE_SIZE: Record<Paper, string> = {
  A4: "size: A4 portrait; margin: 10mm;",
  A5: "size: A5 portrait; margin: 8mm;",
  ID_SHEET: "size: A4 portrait; margin: 8mm;",
  A4_LANDSCAPE: "size: A4 landscape; margin: 10mm 10mm 14mm;",
  A4_LABELS: "size: A4 portrait; margin: 10mm;",
};

/**
 * The @page rule. With `footer` the old report footer is printed on every page: "Print DateTime …" bottom left (or
 * the note given, when it is not "Printed …") and "Page No x of y" bottom right.
 */
function pageRule(paper: Paper, footer?: string | boolean) {
  const note = typeof footer === "string" && !/^Printed /.test(footer) ? footer : undefined;
  const boxes = footer ? footerBoxes(note) : "";
  return `@page { ${PAGE_SIZE[paper]}${boxes} }`;
}

/**
 * Wraps printable documents: only this area prints, always in the light theme, on the paper size given.
 * The page rule here overrides the app's default A5 receipt page while the preview is open.
 * On screen the paper sits on a grey desk, zoomed to fit. `footer` (true, or a note) adds the old report footer.
 */
export function PrintSheet({ paper, label, zoom = 0.72, footer, children }: { paper: Paper; label: string; zoom?: number; footer?: string | boolean; children: ReactNode }) {
  const { accent } = useAppearance();
  return (
    <div className="mtb-doc-desk" aria-label={label}>
      <style>{pageRule(paper, footer)}</style>
      <div className="mtb-doc-zoom" style={{ "--doc-zoom": zoom } as CSSProperties}>
        <div data-theme="light" data-accent={accent} className="mtb-print-area">
          {children}
        </div>
      </div>
    </div>
  );
}

/** "Print the back too": the backs follow each sheet of fronts, mirrored for two-sided printing. */
export function CardBackSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="grid gap-1">
      <Switch label="Print the back of the card too (two-sided printing)" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-small text-ink-muted">The backs come on the next sheet in mirrored order, so they line up when the printer turns the sheet over.</span>
    </div>
  );
}

/** Prints after React has painted the document. */
export function printNow() {
  window.setTimeout(() => window.print(), 60);
}
