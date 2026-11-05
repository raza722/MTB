import { teacherCountsLine } from "@mtb/api";
import { formatRs } from "@mtb/domain";
import { Button, Toast, useToast, type ToastOptions } from "@mtb/ui";
import { AYESHA, FIRST_TERM_C8, OVERDUE_TOTAL, RECEIPT_NO, REGISTER_7B } from "../demo";
import { Specimen, StateGroupSection } from "../kit";

const c = REGISTER_7B.counts;

/** The exact wording each live screen uses. */
export const SUCCESS_TOASTS: Record<"receipt" | "attendance" | "results", ToastOptions> = {
  receipt: { title: `Receipt ${RECEIPT_NO} posted`, message: `${AYESHA.name} · ${formatRs(OVERDUE_TOTAL)}` },
  attendance: { title: "Attendance submitted", message: `${REGISTER_7B.classSection} · ${teacherCountsLine(c)}. Parents of ${c.absent} absent students get an SMS.` },
  results: { title: "Results declared", message: `${FIRST_TERM_C8.name} · ${FIRST_TERM_C8.classes.join(", ")} · now visible in the parent portal. Result messages are queued.` },
};

function ToastSpecimen({ id, kind, rise, note }: { id: string; kind: keyof typeof SUCCESS_TOASTS; rise: number; note: string }) {
  const toast = useToast();
  const t = SUCCESS_TOASTS[kind];
  return (
    <Specimen
      id={id}
      rise={rise}
      actions={
        <Button size="sm" variant="primary" icon="bolt" onClick={() => toast(t)}>
          Show toast
        </Button>
      }
      below={<p className="m-0 mt-3 text-small text-ink-muted">{note}</p>}
    >
      <div className="grid min-h-28 place-items-end">
        <Toast {...t} />
      </div>
    </Specimen>
  );
}

export function ToastSection() {
  const toast = useToast();
  return (
    <StateGroupSection id="toasts" cols={3}>
      <ToastSpecimen id="toast-receipt" kind="receipt" rise={0} note="The A5 receipt preview opens at the same moment, with Print, PDF, SMS to guardian and Next student." />
      <ToastSpecimen id="toast-attendance" kind="attendance" rise={1} note="Shown on the teacher's phone. Offline, the same moment shows “Saved on this phone” instead." />
      <ToastSpecimen id="toast-results" kind="results" rise={2} note="The exam then shows Declared with a lock, and every mark is read-only." />
      <div className="mtb-states-wide flex flex-wrap items-center gap-3 text-small text-ink-muted">
        <Button
          size="sm"
          icon="layers"
          onClick={() => {
            toast(SUCCESS_TOASTS.receipt);
            setTimeout(() => toast(SUCCESS_TOASTS.attendance), 350);
            setTimeout(() => toast(SUCCESS_TOASTS.results), 700);
          }}
        >
          Show all three
        </Button>
        Toasts stack bottom right, newest last, at most four at a time, and close on their own after a few seconds.
      </div>
    </StateGroupSection>
  );
}
