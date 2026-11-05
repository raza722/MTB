import {
  activitiesQueries,
  ACTIVITIES_AWARD_STATUS_LABEL,
  ACTIVITIES_EVENT_STATUS_LABEL,
  ACTIVITIES_RENEWAL_OUTCOME_LABEL,
  ACTIVITIES_TEST_STATUS_LABEL,
  ApiError,
  can,
  type ActivitiesAwardStatus,
  type ActivitiesBasis,
  type ActivitiesEventStatus,
  type ActivitiesHouseTone,
  type ActivitiesPerson,
  type ActivitiesRenewalOutcome,
  type ActivitiesTestStatus,
} from "@mtb/api";
import { formatRs } from "@mtb/domain";
import { Banner, Button, Icon, Input, Segmented, Spinner, StatusBadge, cx } from "@mtb/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { campusLabel } from "../../app/shell/campus";
import { SubNav } from "../../app/shell/SubNav";
import { useAppearance } from "../../app/appearance";
import { useCtx, useSessionUser } from "../../app/session";
import "./activities.css";

/** Plain-English text for a failed request. */
export const errorText = (e: unknown) => (e instanceof ApiError ? (e.isNetwork ? "No response from the server — nothing was changed. Try again." : e.message) : "Something went wrong. Try again.");

/** The field a server validation error points at, for showing it next to that field. */
export const errorField = (e: unknown) => (e instanceof ApiError ? e.field : undefined);

/** The module's own pages. */
export function ActivitiesNav() {
  return (
    <SubNav
      label="Scholarships and activities"
      items={[
        { to: "/activities", label: "Overview", icon: "dashboard", exact: true },
        { to: "/activities/scholarships", label: "Scholarships", icon: "award" },
        { to: "/activities/tests", label: "Scholarship tests", icon: "listChecks" },
        { to: "/activities/schemes", label: "Schemes", icon: "layers" },
        { to: "/activities/houses", label: "Houses", icon: "flag" },
        { to: "/activities/events", label: "Events", icon: "calendar" },
        { to: "/activities/records", label: "Student records", icon: "star" },
        { to: "/activities/certificates", label: "Certificates", icon: "file" },
      ]}
    />
  );
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

/** Refreshes everything this module shows after a change. */
export function useRefresh() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ["activities"] });
}

/** Schemes are organisation-wide: only an all-campus admin may change them. */
export function useCanEditSchemes() {
  const user = useSessionUser();
  return can(user, "activities.manage", "ALL");
}

export const stagger = (i: number) => ({ "--i": i }) as CSSProperties;

/** "1st", "2nd", "3rd" … */
export function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "50% off" or "Rs 1,000 a month". */
export const valueShort = (basis: ActivitiesBasis, v: number) => (basis === "FIXED" ? `${formatRs(v)} a month` : `${v}% off`);

// ------------------------------------------------------------------ Status badges

const AWARD_TONE: Record<ActivitiesAwardStatus, "pending" | "approved" | "rejected" | "neutral"> = { PENDING: "pending", APPROVED: "approved", REJECTED: "rejected", ENDED: "neutral" };

export function AwardBadge({ status }: { status: ActivitiesAwardStatus }) {
  return <StatusBadge status={AWARD_TONE[status]}>{status === "PENDING" ? "Waiting for approval" : ACTIVITIES_AWARD_STATUS_LABEL[status]}</StatusBadge>;
}

const TEST_TONE: Record<ActivitiesTestStatus, "info" | "warning" | "success" | "brand"> = { REGISTRATION: "info", MARKING: "warning", RESULT: "success", AWARDED: "brand" };

export function TestBadge({ status }: { status: ActivitiesTestStatus }) {
  return (
    <StatusBadge status={TEST_TONE[status]} {...(status === "AWARDED" ? { icon: "award" as const } : {})}>
      {ACTIVITIES_TEST_STATUS_LABEL[status]}
    </StatusBadge>
  );
}

const EVENT_TONE: Record<ActivitiesEventStatus, "neutral" | "info" | "success" | "cancelled"> = { PLANNED: "neutral", OPEN: "info", DONE: "success", CANCELLED: "cancelled" };

export function EventBadge({ status }: { status: ActivitiesEventStatus }) {
  return (
    <StatusBadge status={EVENT_TONE[status]} {...(status === "DONE" ? { icon: "check" as const } : {})}>
      {ACTIVITIES_EVENT_STATUS_LABEL[status]}
    </StatusBadge>
  );
}

const RENEWAL_TONE: Record<ActivitiesRenewalOutcome, "success" | "warning" | "danger" | "neutral"> = { MEETS: "success", AT_RISK: "warning", NOT_MET: "danger", AUTOMATIC: "neutral" };

export function RenewalBadge({ outcome }: { outcome: ActivitiesRenewalOutcome }) {
  return <StatusBadge status={RENEWAL_TONE[outcome]}>{ACTIVITIES_RENEWAL_OUTCOME_LABEL[outcome]}</StatusBadge>;
}

/** A place: gold, silver, bronze are not used as colours; the number and word carry the meaning. */
export function PlaceBadge({ position }: { position: 1 | 2 | 3 | null }) {
  if (!position) return <span className="text-ink-subtle">—</span>;
  return (
    <span className={cx("act-place", `act-place-${position}`)}>
      <Icon name="award" size={14} />
      {ordinal(position)}
    </span>
  );
}

// ------------------------------------------------------------------ Houses

export const houseColor = (tone: ActivitiesHouseTone) => `var(--chart-${tone})`;

/** A house name with its colour key. Colour is never the only signal: the name is always shown. */
export function HouseTag({ name, tone }: { name: string | null; tone?: ActivitiesHouseTone | undefined }) {
  if (!name) return <span className="text-ink-subtle">Not in a house</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="mtb-chart-key" style={{ background: tone ? houseColor(tone) : "var(--border-strong)" }} aria-hidden="true" />
      {name}
    </span>
  );
}

/** House colours by name, from the houses list of the campus. */
export function useHouseTones(): (name: string | null) => ActivitiesHouseTone | undefined {
  const ctx = useCtx();
  const houses = useQuery({ ...activitiesQueries.houses(ctx), staleTime: 60_000 });
  return (name) => houses.data?.houses.find((h) => h.name === name)?.tone;
}

// ------------------------------------------------------------------ Chart / table switch

export function ViewToggle({ value, onChange, label }: { value: "chart" | "table"; onChange: (v: "chart" | "table") => void; label: string }) {
  return (
    <Segmented
      aria-label={label}
      value={value}
      onChange={(v) => onChange(v as "chart" | "table")}
      options={[
        { value: "chart", label: "Chart" },
        { value: "table", label: "Table" },
      ]}
    />
  );
}

/** Horizontal bars for a few labelled values (house points, fee relief by scheme). One axis, values printed. */
export function BarList({ rows, format, label }: { rows: Array<{ key: string; label: ReactNode; value: number; color?: string; note?: ReactNode }>; format: (v: number) => string; label: string }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <ul className="act-bars" aria-label={label}>
      {rows.map((r, i) => (
        <li key={r.key} className="mtb-slide-in" style={stagger(i)}>
          <span className="act-bars-label">{r.label}</span>
          <span className="act-bars-track" aria-hidden="true">
            <span style={{ width: `${(Math.max(0, r.value) / max) * 100}%`, background: r.color ?? "var(--brand)", animationDelay: `${120 + i * 80}ms` }} />
          </span>
          <span className="act-bars-value">
            {format(r.value)}
            {r.note && <span className="act-bars-note">{r.note}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ Student search

/** Search students of the campus by name, G.R. number or father's name; pick one from the list. */
export function StudentSearch({
  label = "Student",
  onPick,
  exclude,
  placeholder = "Name, G.R. number or father's name",
  error,
  help,
  disabled,
  applicants,
}: {
  label?: string;
  /** Also list admission applicants (not yet admitted), marked "Applicant". */
  applicants?: boolean;
  onPick: (p: ActivitiesPerson) => void;
  exclude?: Set<string>;
  placeholder?: string;
  error?: string | undefined;
  help?: ReactNode;
  disabled?: boolean;
}) {
  const ctx = useCtx();
  const [q, setQ] = useState("");
  const deferred = useDeferredValue(q.trim());
  const hits = useQuery(activitiesQueries.people(ctx, deferred, applicants));
  const list = (hits.data ?? []).filter((p) => !exclude?.has(p.id));
  return (
    <div className="grid gap-1">
      <Input label={label} icon="search" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} error={error} help={help} disabled={disabled} autoComplete="off" />
      {deferred.length >= 2 && (
        <div className="act-hits" role="listbox" aria-label="Matching students">
          {hits.isLoading ? (
            <div className="flex items-center gap-2 p-3 text-small text-ink-muted">
              <Spinner label="Searching" /> Searching…
            </div>
          ) : list.length === 0 ? (
            <p className="m-0 p-3 text-small text-ink-muted">No students match “{deferred}”. Check the spelling or try the G.R. number.</p>
          ) : (
            list.map((p) => (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={false}
                className="act-hit"
                onClick={() => {
                  onPick(p);
                  setQ("");
                }}
              >
                <span className="grid min-w-0">
                  <span className="flex items-center gap-1.5 truncate font-medium">
                    {p.name}
                    {p.isApplicant && (
                      <StatusBadge status="info" dot={false}>
                        Applicant
                      </StatusBadge>
                    )}
                  </span>
                  <span className="truncate text-small text-ink-muted">
                    {p.father ? `${p.father} · ` : ""}
                    {p.isApplicant ? (p.previousSchool ?? "Admission application") : (p.house ?? "No house")}
                    {ctx.campus === "ALL" ? ` · ${campusLabel(p.campus)}` : ""}
                  </span>
                </span>
                <span className="text-right text-small text-ink-muted">
                  <span className="mtb-num block text-ink">{p.id}</span>
                  {p.classSection}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** A picked student shown as a removable chip. */
export function PersonChip({ person, onRemove }: { person: { id: string; name: string; classSection: string }; onRemove?: () => void }) {
  return (
    <span className="act-chip">
      <span className="font-medium">{person.name}</span>
      <span className="mtb-num text-ink-muted">{person.id}</span>
      <span className="text-ink-muted">{person.classSection}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${person.name}`}>
          <Icon name="x" size={14} />
        </button>
      )}
    </span>
  );
}

// ------------------------------------------------------------------ Printing

/**
 * Renders documents into a print-only layer and opens the print dialog. Only this layer prints (see styles.css),
 * always in the light theme, on the paper given.
 */
export function PrintLayer({ paper, children, onDone }: { paper: "A4" | "A4L"; children: ReactNode; onDone: () => void }) {
  const { accent } = useAppearance();
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });
  useEffect(() => {
    const done = () => doneRef.current();
    window.addEventListener("afterprint", done);
    const t = window.setTimeout(() => window.print(), 120);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("afterprint", done);
    };
  }, []);
  return createPortal(
    <div className="mtb-print-area act-print-layer" data-theme="light" data-accent={accent}>
      <style>{paper === "A4L" ? "@page { size: A4 landscape; margin: 0; }" : "@page { size: A4 portrait; margin: 0; }"}</style>
      {children}
    </div>,
    document.body,
  );
}

/** Scales a printable document down for an on-screen preview. */
export function DocPreview({ zoom = 0.5, children, label }: { zoom?: number; children: ReactNode; label: string }) {
  const { accent } = useAppearance();
  return (
    <div className="act-desk" aria-label={label}>
      <div className="act-zoom" style={{ "--doc-zoom": zoom } as CSSProperties} data-theme="light" data-accent={accent}>
        {children}
      </div>
    </div>
  );
}

export const PRINTED_ON = "04-Nov-2026";
