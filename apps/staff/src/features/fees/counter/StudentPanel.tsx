import { studentsQueries, type StudentSummary } from "@mtb/api";
import { formatMobile, formatRs } from "@mtb/domain";
import { Avatar, Banner, Button, Icon, Input, Kbd, Skeleton, StatusBadge, Urdu } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState, type RefObject } from "react";
import { useCtx } from "../../../app/session";

export function StudentSearch({ inputRef, onPick }: { inputRef: RefObject<HTMLInputElement | null>; onPick: (grNo: string) => void }) {
  const ctx = useCtx();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  const results = useQuery({ ...studentsQueries.list(ctx, { q: debounced }), enabled: debounced.length >= 2 });
  const items = (results.data?.items ?? []).slice(0, 8);
  const pick = (s: StudentSummary) => {
    setQ("");
    setDebounced("");
    onPick(s.grNo);
  };
  return (
    <div className="grid gap-2">
      <Input
        ref={inputRef}
        label={
          <span className="flex items-center justify-between gap-2">
            Find student <Kbd>F2</Kbd>
          </span>
        }
        icon="search"
        placeholder="Name, G.R. or father's CNIC"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && items[0]) {
            e.preventDefault();
            pick(items[0]);
          }
        }}
        autoComplete="off"
        aria-controls="counter-search-results"
      />
      {debounced.length >= 2 && (
        <ul id="counter-search-results" className="m-0 grid list-none gap-1 rounded-lg border border-border bg-surface-raised p-1 shadow-md" aria-label="Matching students">
          {results.isLoading && (
            <li className="p-2">
              <Skeleton width="80%" />
            </li>
          )}
          {!results.isLoading && items.length === 0 && <li className="p-3 text-small text-ink-muted">No student matches "{debounced}".</li>}
          {items.map((s, i) => (
            <li key={s.grNo}>
              <button type="button" onClick={() => pick(s)} className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-surface-hover focus-visible:bg-surface-hover">
                <Avatar name={s.name} size="sm" />
                <span className="grid min-w-0 flex-1">
                  <span className="truncate font-medium">{s.name}</span>
                  <span className="truncate text-small text-ink-muted">
                    <span className="mtb-mono">{s.grNo}</span> · {s.classSection} · {s.relation} {s.father}
                  </span>
                </span>
                <StatusBadge status={s.feeStatus} />
                {i === 0 && <span className="mtb-sr-only">Press Enter to open</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The student being served, their guardian and siblings (family by father's CNIC). */
export function StudentSummaryCard({ grNo, onSwitch, onAddCharge }: { grNo: string; onSwitch: (grNo: string) => void; onAddCharge?: () => void }) {
  const profile = useQuery(studentsQueries.profile(grNo));
  const p = profile.data;
  if (profile.isLoading || !p) {
    return (
      <div className="mtb-card grid gap-3 p-4" aria-busy="true">
        <div className="flex items-center gap-3">
          <Skeleton width={56} height={56} style={{ borderRadius: 999 }} />
          <div className="grid flex-1 gap-2">
            <Skeleton width="70%" height={18} />
            <Skeleton width="50%" />
          </div>
        </div>
        <Skeleton height={60} />
      </div>
    );
  }
  return (
    <section className="mtb-card grid gap-4 p-4" aria-label="Student">
      <div className="flex items-start gap-3">
        <Avatar name={p.name} size="lg" />
        <div className="grid min-w-0 gap-0.5">
          <span className="text-title-2">{p.name}</span>
          {p.nameUr && <Urdu size="small">{p.nameUr}</Urdu>}
          <span className="text-small text-ink-muted">
            <span className="mtb-mono text-ink">{p.grNo}</span> · {p.classSection} · {p.campusName}
          </span>
        </div>
      </div>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-small">
        <dt className="text-ink-muted">Father</dt>
        <dd className="m-0">{p.guardian.name}</dd>
        <dt className="text-ink-muted">Mobile</dt>
        <dd className="m-0 tabular-nums">{formatMobile(p.guardian.mobile)}</dd>
        <dt className="text-ink-muted">Balance</dt>
        <dd className="m-0 flex items-center gap-1 tabular-nums">
          {formatRs(p.balance)} <Icon name="lock" size={14} label="Calculated from the ledger" className="text-ink-subtle" />
        </dd>
      </dl>
      {p.siblings.length > 0 && (
        <div className="grid gap-1">
          <span className="mtb-label">Siblings</span>
          {p.siblings.map((s) => (
            <button
              key={s.grNo}
              type="button"
              onClick={() => onSwitch(s.grNo)}
              disabled={s.campus !== p.campus}
              title={s.campus !== p.campus ? `${s.campusName}: collect at that campus` : `Switch to ${s.name}`}
              className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-hover disabled:cursor-default disabled:hover:bg-transparent"
            >
              <span className="grid">
                <span className="font-medium">{s.name}</span>
                <span className="text-small text-ink-muted">
                  {s.classSection} · {s.campusName}
                </span>
              </span>
              <StatusBadge status={s.feeStatus} />
            </button>
          ))}
          <span className="text-small text-ink-muted">One receipt for several siblings is an open decision; today each child gets their own receipt.</span>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to="/students/$grNo" params={{ grNo: p.grNo }} search={(prev: Record<string, unknown>) => ({ ...prev, tab: "ledger" }) as never} className="text-small font-medium text-brand-ink underline-offset-2 hover:underline">
          Open fee ledger
        </Link>
        {onAddCharge && p.status !== "LEFT" && p.status !== "EXPELLED" && p.status !== "PASSED_OUT" && (
          <Button size="sm" icon="plus" onClick={onAddCharge}>
            Add a charge
          </Button>
        )}
      </div>
    </section>
  );
}

const LEFT_TITLE = { LEFT: "This student has left.", STRUCK_OFF: "This student was struck off.", EXPELLED: "This student was expelled.", PASSED_OUT: "This student has passed out." } as const;

export function LeftStudentBanner({ on, reason, status = "LEFT" }: { on: string; reason: string; status?: keyof typeof LEFT_TITLE }) {
  return (
    <Banner tone="warning" title={LEFT_TITLE[status]}>
      {reason} on {on}. Collect only the outstanding dues; no new charges can be added.
    </Banner>
  );
}
