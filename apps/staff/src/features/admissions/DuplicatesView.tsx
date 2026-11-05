import {
  admissionsApi,
  admissionsMatchLabel,
  admissionsQueries,
  ApiError,
  newIdempotencyKey,
  studentFamiliesQueries,
  studentsQueries,
  type AdmissionsDuplicateCase,
  type AdmissionsDuplicates,
  type AdmissionsField,
  type AdmissionsPersonRecord,
} from "@mtb/api";
import { formatDate, formatDateTime } from "@mtb/domain";
import { Banner, Button, ConfirmDialog, cx, EmptyState, Icon, Skeleton, StatusBadge, useToast, type IconName } from "@mtb/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useCan, useReadOnly, useCtx } from "../../app/session";
import { COMPARED_FIELDS, compareField, displayValue, fieldLabel, MATCH_LABEL, type FieldMatch } from "./match";

type Side = "left" | "right";

const MATCH_STYLE: Record<FieldMatch, { cell: string; icon: IconName; text: string }> = {
  same: { cell: "bg-success-tint", icon: "check", text: "text-success-ink" },
  similar: { cell: "bg-info-tint", icon: "info", text: "text-info-ink" },
  different: { cell: "bg-warning-tint", icon: "alert", text: "text-warning-ink" },
  missing: { cell: "bg-warning-tint", icon: "alertCircle", text: "text-warning-ink" },
};

/** The student record survives a merge; between two applications, the earlier one (left). */
const survivorSide = (c: AdmissionsDuplicateCase): Side => (c.left.source === "STUDENT" || c.right.source !== "STUDENT" ? "left" : "right");

function RecordHeading({ rec, label }: { rec: AdmissionsPersonRecord; label: string }) {
  return (
    <span className="grid gap-0.5">
      <span className="text-caption uppercase text-ink-muted">{label}</span>
      <span className="font-medium text-ink">{rec.fields.name}</span>
      <span className="text-small text-ink-muted">
        <span className="mtb-mono" style={{ fontSize: 12 }}>
          {rec.ref}
        </span>{" "}
        · {rec.context}
      </span>
    </span>
  );
}

function Strength({ value }: { value: number }) {
  return (
    <div className="grid gap-1.5" style={{ minWidth: 180 }}>
      <span className="flex items-baseline justify-between gap-3">
        <b className="text-ink">{admissionsMatchLabel(value)}</b>
        <span className="mtb-num font-semibold text-ink">{value}%</span>
      </span>
      <div className="mtb-meter" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={`Match strength ${value}%`}>
        <span style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function Comparison({ c, merging, keep, onKeep }: { c: AdmissionsDuplicateCase; merging: boolean; keep: Partial<Record<AdmissionsField, Side>>; onKeep: (f: AdmissionsField, s: Side) => void }) {
  return (
    <div className="mtb-table-wrap">
      <div className="mtb-table-scroll">
        <table className="mtb-table">
          <caption className="mtb-sr-only">Field-by-field comparison</caption>
          <thead>
            <tr>
              <th scope="col" style={{ position: "static", width: 150 }}>Field</th>
              <th scope="col" style={{ position: "static" }}>Record A</th>
              <th scope="col" style={{ position: "static" }}>Record B</th>
              <th scope="col" style={{ position: "static", width: 190 }}>Result</th>
            </tr>
          </thead>
          <tbody>
            {COMPARED_FIELDS.map((f) => {
              const m = compareField(f, c.left.fields, c.right.fields);
              const style = MATCH_STYLE[m];
              const choose = merging && m !== "same";
              const cell = (side: Side) => {
                const rec = side === "left" ? c.left : c.right;
                const value = displayValue(f, rec.fields);
                const mono = f === "fatherCnic" || f === "mobile";
                return (
                  <td className={cx(m === "same" && style.cell)}>
                    {choose ? (
                      <label className="mtb-check" style={{ alignItems: "flex-start" }}>
                        <input type="radio" name={`keep-${c.id}-${f}`} checked={(keep[f] ?? survivorSide(c)) === side} onChange={() => onKeep(f, side)} aria-label={`Keep ${fieldLabel(f)} from record ${side === "left" ? "A" : "B"}: ${value}`} />
                        <span className={cx(mono && "mtb-mono", value === "Not given" && "text-ink-muted")}>{value}</span>
                      </label>
                    ) : (
                      <span className={cx(mono && "mtb-mono", value === "Not given" && "text-ink-muted")}>{value}</span>
                    )}
                  </td>
                );
              };
              return (
                <tr key={f}>
                  <th scope="row" style={{ position: "static", textTransform: "none", letterSpacing: 0, fontSize: 14, background: "transparent", color: "var(--ink-muted)" }}>
                    {fieldLabel(f)}
                  </th>
                  {cell("left")}
                  {cell("right")}
                  <td className={style.cell}>
                    <span className={cx("inline-flex items-center gap-1.5 font-medium", style.text)}>
                      <Icon name={style.icon} size={16} />
                      {MATCH_LABEL[m]}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function DuplicatesView({ data, loading }: { data: AdmissionsDuplicates | undefined; loading: boolean }) {
  const ctx = useCtx();
  const canManage = useCan("admissions.manage");
  const readOnly = useReadOnly();
  const canAct = canManage && !readOnly;
  const queryClient = useQueryClient();
  const toast = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [keep, setKeep] = useState<Partial<Record<AdmissionsField, Side>>>({});
  const [confirm, setConfirm] = useState<null | "merge" | "not-same">(null);
  const [actionKey, setActionKey] = useState(newIdempotencyKey);

  const cases = data?.cases ?? [];
  const current = cases.find((c) => c.id === selectedId) ?? cases[0];

  const reset = () => {
    setMerging(false);
    setKeep({});
    setConfirm(null);
    setActionKey(newIdempotencyKey());
  };

  const decide = useMutation({
    mutationFn: async (kind: "merge" | "not-same") => {
      if (!current) throw new Error("Nothing selected");
      if (kind === "merge") {
        const differing = COMPARED_FIELDS.filter((f) => compareField(f, current.left.fields, current.right.fields) !== "same");
        const chosen = Object.fromEntries(differing.map((f) => [f, keep[f] ?? survivorSide(current)])) as Partial<Record<AdmissionsField, Side>>;
        return admissionsApi.merge(current.id, chosen, actionKey);
      }
      return admissionsApi.notSame(current.id, actionKey);
    },
    onSuccess: (decision) => {
      const next = cases.find((c) => c.id !== current?.id);
      setSelectedId(next?.id ?? null);
      reset();
      void queryClient.invalidateQueries({ queryKey: admissionsQueries.all() });
      void queryClient.invalidateQueries({ queryKey: studentsQueries.all() });
      void queryClient.invalidateQueries({ queryKey: studentFamiliesQueries.all() });
      toast({ title: decision.decision === "MERGED" ? "Records merged" : "Marked as different people", message: decision.summary });
    },
  });
  const decideError = decide.error instanceof ApiError ? (decide.error.isNetwork ? "Not saved — the connection dropped. It's safe to try again." : decide.error.message) : undefined;

  if (loading || !data) return <Skeleton height={420} style={{ borderRadius: "var(--radius-lg)" }} />;

  const survivor = current ? (survivorSide(current) === "left" ? current.left : current.right) : null;
  const absorbed = current ? (survivorSide(current) === "left" ? current.right : current.left) : null;
  const differing = current ? COMPARED_FIELDS.filter((f) => compareField(f, current.left.fields, current.right.fields) !== "same") : [];

  return (
    <div className="grid gap-6">
      {cases.length === 0 || !current ? (
        <div className="mtb-card">
          <EmptyState icon="checkCircle" title="No possible duplicates to review" description="When a new application or record looks like someone already in the system, it appears here for a decision." />
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
          <section aria-labelledby="dup-queue" className="mtb-card">
            <header className="mtb-card-header">
              <h3 id="dup-queue">Review queue</h3>
              <span className="text-small text-ink-muted tabular-nums">{cases.length} to review</span>
            </header>
            <ul className="m-0 grid list-none gap-1 p-2">
              {cases.map((c) => {
                const active = c.id === current.id;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(c.id);
                        reset();
                      }}
                      aria-current={active ? "true" : undefined}
                      className={cx("grid w-full gap-1 rounded-md px-3 py-2.5 text-left", active ? "bg-surface-selected" : "hover:bg-surface-hover")}
                    >
                      <span className="font-medium text-ink">
                        {c.left.fields.name} · {c.right.fields.name}
                      </span>
                      <span className="flex items-center justify-between gap-2 text-small text-ink-muted">
                        <span>
                          {admissionsMatchLabel(c.strength)} · <span className="mtb-num">{c.strength}%</span>
                        </span>
                        <span className="mtb-num">{formatDate(c.foundOn)}</span>
                      </span>
                      {ctx.campus === "ALL" && <span className="text-small text-ink-muted">{c.campusName}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-labelledby="dup-title" className="mtb-card">
            <header className="mtb-card-header" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
              <div className="grid gap-1">
                <h3 id="dup-title">Is this the same person?</h3>
                <p className="m-0 text-small text-ink-muted">Found {formatDate(current.foundOn)} by the matching rules. Nothing changes until you decide.</p>
              </div>
              <Strength value={current.strength} />
            </header>
            <div className="mtb-card-body grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <RecordHeading rec={current.left} label="Record A" />
                <RecordHeading rec={current.right} label="Record B" />
              </div>
              <div className="grid gap-1">
                <span className="mtb-label">Why they were matched</span>
                <ul className="m-0 grid list-none gap-1 p-0 text-small">
                  {current.rules.map((r) => (
                    <li key={r} className="flex items-center gap-2 text-ink">
                      <Icon name="checkCircle" size={16} className="text-success" />
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
              {merging && survivor && absorbed && (
                <Banner tone="info" title="Choose the value to keep for each field that differs.">
                  {absorbed.fields.name} ({absorbed.ref}) will be merged into {survivor.fields.name} ({survivor.ref}). Fields marked Same need no choice.
                </Banner>
              )}
              <Comparison c={current} merging={merging} keep={keep} onKeep={(f, s) => setKeep((k) => ({ ...k, [f]: s }))} />
              {!canManage && <Banner tone="neutral">Only the principal or an admin can merge records or mark them as different people.</Banner>}
              {readOnly && <Banner tone="info">Past sessions are read-only.</Banner>}
            </div>
            {canAct && (
              <footer className="mtb-modal-footer is-split" style={{ borderRadius: "0 0 var(--radius-lg) var(--radius-lg)" }}>
                {merging ? (
                  <>
                    <Button onClick={() => reset()}>Cancel</Button>
                    <Button variant="primary" icon="merge" onClick={() => setConfirm("merge")}>
                      Review merge
                    </Button>
                  </>
                ) : (
                  <>
                    <Button icon="split" onClick={() => setConfirm("not-same")}>
                      Not the same person
                    </Button>
                    <Button variant="primary" icon="merge" onClick={() => setMerging(true)}>
                      Merge…
                    </Button>
                  </>
                )}
              </footer>
            )}
          </section>
        </div>
      )}

      <section aria-labelledby="dup-log" className="mtb-card">
        <header className="mtb-card-header">
          <h3 id="dup-log">Decision log</h3>
          <span className="text-small text-ink-muted">Every merge and every "not the same person" is recorded.</span>
        </header>
        {data.decisions.length === 0 ? (
          <p className="m-0 p-5 text-small text-ink-muted">No decisions yet.</p>
        ) : (
          <ul className="m-0 grid list-none p-0">
            {data.decisions.map((d) => (
              <li key={d.id} className="flex items-start gap-3 border-b border-border px-5 py-3 last:border-b-0">
                <span className={cx("mt-0.5 grid h-7 w-7 shrink-0 place-content-center rounded-full", d.decision === "MERGED" ? "bg-info-tint text-info-ink" : "bg-neutral-tint text-neutral-ink")} aria-hidden="true">
                  <Icon name={d.decision === "MERGED" ? "merge" : "split"} size={16} />
                </span>
                <span className="grid gap-0.5">
                  <span className="text-ink">{d.summary}</span>
                  <span className="text-small text-ink-muted">
                    <StatusBadge status={d.decision === "MERGED" ? "info" : "neutral"}>{d.decision === "MERGED" ? "Merged" : "Not the same person"}</StatusBadge>{" "}
                    {d.by} · <span className="mtb-num">{formatDateTime(d.at)}</span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {current && survivor && absorbed && (
        <>
          <ConfirmDialog
            open={confirm === "merge"}
            onClose={() => {
              setConfirm(null);
              decide.reset();
            }}
            onConfirm={() => decide.mutate("merge")}
            title="Merge these records?"
            message={`${absorbed.fields.name} (${absorbed.ref}) will be merged into ${survivor.fields.name} (${survivor.ref}). History from both records is kept and the merge is logged.`}
            details={differing.map((f) => {
              const side = keep[f] ?? survivorSide(current);
              const rec = side === "left" ? current.left : current.right;
              return [fieldLabel(f), `${displayValue(f, rec.fields)} (${side === "left" ? "A" : "B"})`];
            })}
            confirmLabel="Merge records"
            loading={decide.isPending}
            loadingLabel="Merging…"
            error={decideError}
          />
          <ConfirmDialog
            open={confirm === "not-same"}
            onClose={() => {
              setConfirm(null);
              decide.reset();
            }}
            onConfirm={() => decide.mutate("not-same")}
            title="Mark as different people?"
            message={`${current.left.fields.name} (${current.left.ref}) and ${current.right.fields.name} (${current.right.ref}) stay as separate records and this pair won't be suggested again. The decision is logged.`}
            icon="split"
            confirmLabel="Not the same person"
            loading={decide.isPending}
            loadingLabel="Saving…"
            error={decideError}
          />
        </>
      )}
    </div>
  );
}
