import type { CampusScope } from "@mtb/api";
import { formatDate, formatRs, formatSession } from "@mtb/domain";
import { Banner, Button, EmptyState, Segmented, Select, StatusBadge, type Status } from "@mtb/ui";
import { useState } from "react";
import { CAMPUS_CODES, campusLabel } from "../../../app/shell/campus";
import { OVERDUE_TOTAL } from "../demo";
import { AppFrame, Specimen, stagger, StateGroupSection } from "../kit";

/* ------------------------------------------------------------------ Read-only past session */

function ReadOnlySpecimen() {
  const [session, setSession] = useState(2025);
  const readOnly = session !== 2026;
  return (
    <Specimen id="readonly" rise={0}>
      <AppFrame
        title="Fee counter"
        context={`Khalid Campus · Session ${formatSession(session)}`}
        right={
          <Segmented
            aria-label="Session"
            value={String(session)}
            onChange={(v) => setSession(Number(v))}
            options={[
              { value: "2026", label: `${formatSession(2026)} (current)` },
              { value: "2025", label: `${formatSession(2025)} (read-only)` },
            ]}
          />
        }
      >
        {readOnly && (
          <Banner
            tone="info"
            title={`Viewing ${formatSession(session)} — read-only.`}
            actions={
              <Button size="sm" variant="secondary" onClick={() => setSession(2026)}>
                Switch to {formatSession(2026)}
              </Button>
            }
          >
            Past sessions can be viewed and printed but not changed.
          </Banner>
        )}
        <div className="mtb-card grid gap-3 p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-title-3 text-ink">Payment</span>
            <span className="text-title-3 tabular-nums">{formatRs(OVERDUE_TOTAL)}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" iconRight="arrowRight" disabled={readOnly}>
              Review · {formatRs(OVERDUE_TOTAL)}
            </Button>
            <Button icon="printer">Print statement</Button>
          </div>
          <p className="m-0 text-small text-ink-muted">{readOnly ? "Fees can't be collected in a past session. Printing still works." : "The current session: collecting is switched on."}</p>
        </div>
      </AppFrame>
    </Specimen>
  );
}

/* ------------------------------------------------------------------ Choose a campus first */

const REGISTERS: Array<{ cls: string; teacher: string; status: Status; label: string }> = [
  { cls: "7-A", teacher: "Mr Adeel Anwar", status: "approved", label: "Submitted" },
  { cls: "7-B", teacher: "Ms Hina Javed", status: "neutral", label: "Not marked" },
  { cls: "7-C", teacher: "Ms Sana Tariq", status: "pending", label: "Change pending" },
];

function ChooseCampusSpecimen() {
  const [campus, setCampus] = useState<CampusScope>("ALL");
  const options = CAMPUS_CODES.filter((c) => c !== "ALL");
  return (
    <Specimen
      id="choose-campus"
      rise={1}
      actions={
        campus !== "ALL" ? (
          <Button size="sm" variant="ghost" icon="refresh" onClick={() => setCampus("ALL")}>
            Back to all campuses
          </Button>
        ) : undefined
      }
    >
      <AppFrame title="Class registers" context={`${campusLabel(campus)} · Session 2026–27`}>
        {campus === "ALL" ? (
          <div className="mtb-card">
            <EmptyState
              icon="building"
              title="Choose a campus to use the class registers"
              description="You are viewing all campuses. This work always belongs to one campus, so pick it here."
              action={
                <div className="mt-2 w-64 text-left">
                  <Select label="Campus" defaultValue="" onChange={(e) => e.target.value && setCampus(e.target.value as CampusScope)} options={[{ value: "", label: "Choose…" }, ...options.map((c) => ({ value: c, label: campusLabel(c) }))]} />
                </div>
              }
            />
          </div>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0" aria-label={`Registers at ${campusLabel(campus)}`}>
            {REGISTERS.map((r, i) => (
              <li key={r.cls} className="mtb-card mtb-slide-in flex items-center justify-between gap-3 px-4 py-3" style={stagger(i)}>
                <span className="grid">
                  <b className="font-semibold text-ink">{r.cls}</b>
                  <span className="text-small text-ink-muted">
                    {r.teacher} · {formatDate("2026-11-04")}
                  </span>
                </span>
                <StatusBadge status={r.status}>{r.label}</StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </AppFrame>
    </Specimen>
  );
}

/* ------------------------------------------------------------------ Student has left */

function LeftStudentSpecimen() {
  return (
    <Specimen id="left-student" rise={2} wide>
      <AppFrame title="Fee counter">
        <Banner tone="warning" title="This student has left.">
          Family moved to Rahim Yar Khan on {formatDate("2026-06-30")}. Collect only the outstanding dues; no new charges can be added.
        </Banner>
        <div className="mtb-card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <span className="grid">
            <b className="font-semibold text-ink">Hassan Iqbal · KC-14502 · 9-B</b>
            <span className="text-small text-ink-muted">s/o Javed Iqbal · left {formatDate("2026-06-30")}</span>
          </span>
          <span className="flex items-center gap-3">
            <StatusBadge status="overdue">Outstanding {formatRs(9000)}</StatusBadge>
            <StatusBadge status="neutral">Left the school</StatusBadge>
          </span>
        </div>
      </AppFrame>
    </Specimen>
  );
}

export function ContextSection() {
  return (
    <StateGroupSection id="context">
      <ReadOnlySpecimen />
      <ChooseCampusSpecimen />
      <LeftStudentSpecimen />
    </StateGroupSection>
  );
}
