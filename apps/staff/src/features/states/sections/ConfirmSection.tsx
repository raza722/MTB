import { formatCount, formatDate, formatRs, formatTime } from "@mtb/domain";
import { Banner, Button, Checkbox, ConfirmDialog, cx, Icon, KeyValue, Radio, Select, StatusBadge, useToast } from "@mtb/ui";
import { useState } from "react";
import { AYESHA_OVERDUE, CASH_RECEIVED, FIRST_TERM_C8, OVERDUE_TOTAL, PAUSED_AT } from "../demo";
import { Specimen, stagger, StateGroupSection, wait } from "../kit";
import { ReceiptReviewDialog } from "../ReceiptReview";
import { ChargesTable } from "../screens";
import { SUCCESS_TOASTS } from "./ToastSection";

/* ------------------------------------------------------------------ Post receipt */

function PostReceiptSpecimen() {
  const [open, setOpen] = useState(false);
  const [posted, setPosted] = useState<string | null>(null);
  return (
    <Specimen
      id="confirm-post"
      rise={0}
      wide
      actions={
        posted ? (
          <Button size="sm" variant="ghost" icon="refresh" onClick={() => setPosted(null)}>
            Start again
          </Button>
        ) : undefined
      }
    >
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <ChargesTable selected={new Set(AYESHA_OVERDUE.map((c) => c.id))} caption="Ayesha Khan's unpaid charges" />
        <div className="mtb-card grid gap-3 p-4">
          <dl className="m-0 grid grid-cols-[1fr_auto] gap-y-1 tabular-nums">
            <dt className="text-ink-muted">Cash received</dt>
            <dd className="m-0 text-right">{formatRs(CASH_RECEIVED)}</dd>
            <dt className="text-ink-muted">Change to return</dt>
            <dd className="m-0 text-right">{formatRs(CASH_RECEIVED - OVERDUE_TOTAL)}</dd>
            <dt className="border-t border-border pt-2 font-semibold">Total</dt>
            <dd className="m-0 border-t border-border pt-2 text-right text-numeric-large">{formatRs(OVERDUE_TOTAL)}</dd>
          </dl>
          {posted ? (
            <Banner tone="success" title={`Receipt ${posted} posted.`}>
              The number is given only now, on posting.
            </Banner>
          ) : (
            <Button variant="primary" size="lg" block iconRight="arrowRight" onClick={() => setOpen(true)}>
              Review · {formatRs(OVERDUE_TOTAL)}
            </Button>
          )}
        </div>
      </div>
      <ReceiptReviewDialog
        open={open}
        onClose={() => setOpen(false)}
        onPosted={(no) => {
          setOpen(false);
          setPosted(no);
        }}
        payment={`Cash · received ${formatRs(CASH_RECEIVED)} · change ${formatRs(CASH_RECEIVED - OVERDUE_TOTAL)}`}
      />
    </Specimen>
  );
}

/* ------------------------------------------------------------------ Declare results */

function DeclareSpecimen() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [declared, setDeclared] = useState(false);
  const [notify, setNotify] = useState(true);
  const e = FIRST_TERM_C8;

  const declare = async () => {
    setBusy(true);
    await wait(1100);
    setBusy(false);
    setOpen(false);
    setDeclared(true);
    toast(SUCCESS_TOASTS.results);
  };

  return (
    <Specimen
      id="confirm-declare"
      rise={1}
      actions={
        declared ? (
          <Button size="sm" variant="ghost" icon="refresh" onClick={() => setDeclared(false)}>
            Start again
          </Button>
        ) : undefined
      }
    >
      <div className="mtb-card grid gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-title-3 text-ink">
            {e.name} · Class 8
          </span>
          {declared ? <StatusBadge status="declared" icon="lock" /> : <StatusBadge status="draft" />}
        </div>
        <KeyValue
          items={[
            ["Classes", e.classes.join(", ")],
            ["Students", formatCount(e.students)],
            ["Missing marks", <span className="inline-flex items-center gap-1.5 text-success-ink">{formatCount(e.missing)}<Icon name="checkCircle" size={16} /></span>],
          ]}
        />
        {declared ? (
          <Banner tone="info" icon="lock" title="Declared · read-only.">
            Results are in the parent portal. Reopening needs admin approval and is logged.
          </Banner>
        ) : (
          <Button variant="primary" icon="flag" onClick={() => setOpen(true)}>
            Declare results
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={open}
        onClose={() => !busy && setOpen(false)}
        onConfirm={() => void declare()}
        title={`Declare ${e.name} results?`}
        message="Results become read-only and appear in the parent portal. Grades and positions are frozen. Reopening needs admin approval and is logged."
        details={[
          ["Exam", `${e.name} · ${e.type}`],
          ["Classes", e.classes.join(", ")],
          ["Students", formatCount(e.students)],
          ["Missing marks", formatCount(e.missing)],
        ]}
        confirmLabel="Declare results"
        requireText="DECLARE"
        loading={busy}
        loadingLabel="Declaring…"
      >
        <Checkbox label="Also send each family a result message (SMS and app notification)" checked={notify} onChange={(ev) => setNotify(ev.target.checked)} />
      </ConfirmDialog>
    </Specimen>
  );
}

/* ------------------------------------------------------------------ Pause all SMS */

const PAUSE_REASONS = ["Wrong message is going out", "Gateway problem", "Cost limit reached", "Other"];

function PauseSpecimen() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [paused, setPaused] = useState<string | null>(null);

  const pause = async () => {
    if (!reason) return setReasonError("Choose why you are pausing SMS.");
    setBusy(true);
    await wait(900);
    setBusy(false);
    setOpen(false);
    setPaused(reason);
    toast({ tone: "warning", title: "All SMS paused", message: "Every staff page now shows that SMS is paused." });
  };

  return (
    <Specimen id="confirm-pause" rise={2}>
      {paused ? (
        <Banner
          tone="danger"
          title={`All SMS paused by Admin at ${formatTime(PAUSED_AT)}.`}
          actions={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setPaused(null);
                setReason("");
                toast({ title: "SMS resumed", message: "Queued messages will start sending." });
              }}
            >
              Resume
            </Button>
          }
        >
          Reason: {paused}. No messages will be sent until SMS is resumed.
        </Banner>
      ) : (
        <p className="m-0 text-small text-ink-muted">This banner appears at the top of every staff page while SMS is paused.</p>
      )}
      <section className="grid gap-3 rounded-md border border-danger bg-surface-raised p-4" aria-labelledby="st-danger-title">
        <h3 id="st-danger-title" className="m-0 text-title-3 text-danger-ink">
          Danger zone
        </h3>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="max-w-[46ch] text-small text-ink-muted">Stops every SMS from every campus at once. Messages already queued wait until SMS is resumed.</span>
          <Button
            variant="danger"
            icon="pause"
            disabled={Boolean(paused)}
            onClick={() => {
              setReasonError(null);
              setOpen(true);
            }}
          >
            Pause all SMS
          </Button>
        </div>
      </section>
      <ConfirmDialog
        open={open}
        onClose={() => !busy && setOpen(false)}
        onConfirm={() => void pause()}
        tone="danger"
        icon="pause"
        title="Pause all SMS?"
        message="No SMS will be sent from any campus until someone resumes it. Messages already queued stay queued. Every staff page will show that SMS is paused."
        confirmLabel="Pause all SMS"
        requireText="PAUSE"
        loading={busy}
        loadingLabel="Pausing…"
      >
        <div className="mt-4">
          <Select
            label="Reason"
            required
            value={reason}
            onChange={(ev) => {
              setReason(ev.target.value);
              setReasonError(null);
            }}
            options={[{ value: "", label: "Choose…" }, ...PAUSE_REASONS]}
            {...(reasonError ? { error: reasonError } : {})}
          />
        </div>
      </ConfirmDialog>
    </Specimen>
  );
}

/* ------------------------------------------------------------------ Merge records */

type Side = "A" | "B";
interface CompareRow {
  key: string;
  label: string;
  a: string;
  b: string;
  match: "same" | "similar" | "different";
}

const PAIR: CompareRow[] = [
  { key: "name", label: "Name", a: "Muhammad Bilal", b: "M. Bilal", match: "similar" },
  { key: "father", label: "Father's name", a: "Tariq Mahmood", b: "Tariq Mehmood", match: "similar" },
  { key: "cnic", label: "Father's CNIC", a: "31303-9876543-1", b: "31303-9876543-1", match: "same" },
  { key: "dob", label: "Date of birth", a: formatDate("2012-01-10"), b: formatDate("2012-01-10"), match: "same" },
  { key: "mobile", label: "Guardian mobile", a: "0300-1234567", b: "0333-6120458", match: "different" },
];

const MATCH_BADGE = {
  same: <StatusBadge status="success">Same</StatusBadge>,
  similar: <StatusBadge status="warning">Similar</StatusBadge>,
  different: <StatusBadge status="danger">Different</StatusBadge>,
};

function MergeSpecimen() {
  const toast = useToast();
  const [keep, setKeep] = useState<Record<string, Side>>({ name: "A", father: "A", mobile: "B" });
  const [confirm, setConfirm] = useState<null | "merge" | "split">(null);
  const [busy, setBusy] = useState(false);
  const [decided, setDecided] = useState<null | "merged" | "split">(null);
  const choices = PAIR.filter((r) => r.match !== "same");

  const decide = async (kind: "merge" | "split") => {
    setBusy(true);
    await wait(900);
    setBusy(false);
    setConfirm(null);
    setDecided(kind === "merge" ? "merged" : "split");
    toast(
      kind === "merge"
        ? { title: "Records merged", message: "M. Bilal's application now belongs to Muhammad Bilal (KC-14650). Both histories are kept." }
        : { title: "Marked as different people", message: "This pair won't be suggested again." },
    );
  };

  return (
    <Specimen
      id="confirm-merge"
      rise={3}
      wide
      actions={
        decided ? (
          <Button size="sm" variant="ghost" icon="refresh" onClick={() => setDecided(null)}>
            Start again
          </Button>
        ) : undefined
      }
    >
      <div className="mtb-card grid gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-1">
            <span className="text-title-3 text-ink">Possible duplicate · found {formatDate("2026-10-28")}</span>
            <span className="text-small text-ink-muted">Same father's CNIC · same date of birth · similar names · similar father's names</span>
          </div>
          <div className="grid w-48 gap-1">
            <span className="flex justify-between text-small">
              <span className="text-ink-muted">Match strength</span>
              <b className="tabular-nums">94%</b>
            </span>
            <div className="mtb-meter mtb-meter-animate" role="progressbar" aria-valuenow={94} aria-valuemin={0} aria-valuemax={100} aria-label="Match strength 94%">
              <span style={{ width: "94%" }} />
            </div>
          </div>
        </div>
        <div className="mtb-table-wrap">
          <div className="mtb-table-scroll">
            <table className="mtb-table">
              <caption className="mtb-sr-only">The two records side by side</caption>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>A · Student KC-14650</th>
                  <th>B · Application, Class 8</th>
                  <th>Match</th>
                </tr>
              </thead>
              <tbody>
                {PAIR.map((r, i) => (
                  <tr key={r.key} className={cx("mtb-slide-in", r.match === "same" && "bg-success-tint")} style={stagger(i)}>
                    <td className="font-medium">{r.label}</td>
                    {(["A", "B"] as const).map((side) => {
                      const value = side === "A" ? r.a : r.b;
                      return (
                        <td key={side}>
                          {r.match === "same" || decided ? (
                            <span className={cx(r.key === "cnic" || r.key === "mobile" ? "mtb-mono" : undefined)}>{value}</span>
                          ) : (
                            <Radio name={`st-keep-${r.key}`} label={<span className={cx(r.key === "mobile" && "mtb-mono")}>{value}</span>} checked={keep[r.key] === side} onChange={() => setKeep((k) => ({ ...k, [r.key]: side }))} />
                          )}
                        </td>
                      );
                    })}
                    <td>{MATCH_BADGE[r.match]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {decided ? (
          <Banner tone="success" title={decided === "merged" ? "Merged into Muhammad Bilal (KC-14650)." : "Kept as two people."}>
            {decided === "merged" ? "History from both records is kept. The decision is in the audit log." : "This pair won't be suggested again. The decision is in the audit log."}
          </Banner>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-small text-ink-muted">For each field that differs, choose the value to keep. Every merge and every “not the same person” is recorded.</span>
            <div className="flex flex-wrap gap-2">
              <Button icon="split" onClick={() => setConfirm("split")}>
                Not the same person
              </Button>
              <Button variant="primary" icon="merge" onClick={() => setConfirm("merge")}>
                Review merge
              </Button>
            </div>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirm === "merge"}
        onClose={() => !busy && setConfirm(null)}
        onConfirm={() => void decide("merge")}
        title="Merge these records?"
        message="M. Bilal (application) will be merged into Muhammad Bilal (KC-14650). History from both records is kept and the merge is logged."
        details={choices.map((r): [string, string] => [r.label, `${keep[r.key] === "B" ? r.b : r.a} (${keep[r.key] ?? "A"})`])}
        confirmLabel="Merge records"
        loading={busy}
        loadingLabel="Merging…"
      />
      <ConfirmDialog
        open={confirm === "split"}
        onClose={() => !busy && setConfirm(null)}
        onConfirm={() => void decide("split")}
        title="Mark as different people?"
        message="Muhammad Bilal (KC-14650) and M. Bilal (application) stay as separate records and this pair won't be suggested again. The decision is logged."
        icon="split"
        confirmLabel="Not the same person"
        loading={busy}
        loadingLabel="Saving…"
      />
    </Specimen>
  );
}

export function ConfirmSection() {
  return (
    <StateGroupSection id="confirm">
      <PostReceiptSpecimen />
      <DeclareSpecimen />
      <PauseSpecimen />
      <MergeSpecimen />
    </StateGroupSection>
  );
}

