import { formatRs } from "@mtb/domain";
import { AttendanceCalendar, Button, Tabs } from "@mtb/ui";
import { useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { useAppearance } from "../../../app/appearance";
import { AYESHA_OCTOBER, AYESHA_OCTOBER_HOLIDAYS } from "../../design-system/demo-data";
import { AYESHA_OVERDUE, CASH_RECEIVED, OVERDUE_TOTAL, TODAY } from "../demo";
import { Specimen, StateGroupSection } from "../kit";
import { ChargesTable, DashboardKpis, ProfileHeader } from "../screens";

type Theme = "light" | "dark";

/**
 * The same screen twice, light underneath and dark on top, with a divider to drag (or the slider, by keyboard).
 * Both copies are pictures of the screen, so neither takes focus; the live link opens the working one.
 */
function Compare({ label, render }: { label: string; render: (theme: Theme) => ReactNode }) {
  const { accent } = useAppearance();
  const [split, setSplit] = useState(50);
  const box = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = box.current?.getBoundingClientRect();
    if (r && r.width) setSplit(Math.round(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100))));
  };
  return (
    <div className="grid gap-3">
      <div
        ref={box}
        className="mtb-states-compare cursor-ew-resize select-none touch-pan-y"
        style={{ "--split": `${split}%` } as CSSProperties}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          fromPointer(e);
        }}
        onPointerMove={(e) => dragging.current && fromPointer(e)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      >
        <p className="mtb-sr-only">
          {label} in light mode on the left and dark mode on the right. Use the slider below to move the divider.
        </p>
        <div data-theme="light" data-accent={accent} className="mtb-states-compare-layer bg-surface text-ink" inert aria-hidden="true">
          {render("light")}
        </div>
        <div data-theme="dark" data-accent={accent} className="mtb-states-compare-layer mtb-states-compare-top bg-surface text-ink" inert aria-hidden="true">
          {render("dark")}
        </div>
        <span className="mtb-states-compare-line" aria-hidden="true" />
        <span className="mtb-states-compare-tag" style={{ left: 8 }} aria-hidden="true">
          Light
        </span>
        <span className="mtb-states-compare-tag" style={{ right: 8 }} aria-hidden="true">
          Dark
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="range"
          className="mtb-states-range min-w-48 flex-1"
          min={0}
          max={100}
          step={1}
          value={split}
          onChange={(e) => setSplit(Number(e.target.value))}
          aria-label={`Divider between light and dark: ${label}`}
          aria-valuetext={`${split}% light, ${100 - split}% dark`}
        />
        <Button size="sm" variant="ghost" onClick={() => setSplit(100)}>
          All light
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setSplit(50)}>
          Half and half
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setSplit(0)}>
          All dark
        </Button>
      </div>
    </div>
  );
}

const PROFILE_TABS = [
  { id: "enrolment", label: "Enrolment history" },
  { id: "attendance", label: "Attendance" },
  { id: "results", label: "Results", count: 1 },
  { id: "ledger", label: "Fee ledger" },
];

const overdue = new Set(AYESHA_OVERDUE.map((c) => c.id));

export function DarkSection() {
  return (
    <StateGroupSection id="dark" cols={1}>
      <Specimen id="dark-dashboard" rise={0} plain>
        <Compare
          label="The dashboard"
          render={() => (
            <div className="grid gap-4">
              <div className="grid gap-1">
                <span className="text-small font-medium text-ink-muted">Dashboard · Wednesday 04-Nov-2026 · Khalid Campus · Session 2026–27</span>
                <span className="text-display text-ink">Good morning, Sadia</span>
              </div>
              <DashboardKpis animate={false} />
            </div>
          )}
        />
      </Specimen>

      <Specimen id="dark-counter" rise={1} plain>
        <Compare
          label="The fee counter"
          render={() => (
            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
              <ChargesTable selected={overdue} caption="Ayesha Khan's unpaid charges" />
              <div className="mtb-card grid gap-3 p-4">
                <dl className="m-0 grid grid-cols-[1fr_auto] gap-y-1 tabular-nums">
                  <dt className="text-ink-muted">Cash received</dt>
                  <dd className="m-0 text-right">{formatRs(CASH_RECEIVED)}</dd>
                  <dt className="text-ink-muted">Change to return</dt>
                  <dd className="m-0 text-right">{formatRs(CASH_RECEIVED - OVERDUE_TOTAL)}</dd>
                  <dt className="border-t border-border pt-2 font-semibold">Total</dt>
                  <dd className="m-0 border-t border-border pt-2 text-right text-numeric-large">{formatRs(OVERDUE_TOTAL)}</dd>
                </dl>
                <Button variant="primary" size="lg" block iconRight="arrowRight" tabIndex={-1}>
                  Review · {formatRs(OVERDUE_TOTAL)}
                </Button>
              </div>
            </div>
          )}
        />
      </Specimen>

      <Specimen id="dark-profile" rise={2} plain>
        <Compare
          label="The student profile"
          render={(theme) => (
            <div className="grid gap-4">
              <ProfileHeader animate={false} />
              <div className="mtb-card grid gap-4 px-5 pb-5">
                <Tabs aria-label="Student profile" idPrefix={`st-dark-${theme}-`} value="attendance" onChange={() => undefined} tabs={PROFILE_TABS} />
                <div className="max-w-xl">
                  <AttendanceCalendar year={2026} month={9} days={AYESHA_OCTOBER} holidayNames={AYESHA_OCTOBER_HOLIDAYS} today={TODAY} />
                </div>
              </div>
            </div>
          )}
        />
      </Specimen>
    </StateGroupSection>
  );
}
