import { newIdempotencyKey } from "@mtb/api";
import { formatRs, formatTime } from "@mtb/domain";
import { AmountInput, Banner, Button, Icon, KeyValue, Switch, useToast, type IconName } from "@mtb/ui";
import { useRef, useState } from "react";
import { OVERDUE_TOTAL } from "../demo";
import { AppFrame, Specimen, stagger, StateGroupSection, wait } from "../kit";
import { ReceiptReviewDialog } from "../ReceiptReview";
import { DashboardKpis } from "../screens";

/* ------------------------------------------------------------------ Receipt not posted */

function ReceiptNotPostedSpecimen() {
  const [open, setOpen] = useState(false);
  const [failNext, setFailNext] = useState(true);
  const failRef = useRef(true);
  const [key, setKey] = useState(newIdempotencyKey);
  const [posted, setPosted] = useState(false);

  const setFail = (v: boolean) => {
    failRef.current = v;
    setFailNext(v);
  };

  const steps: Array<{ icon: IconName; text: string }> = [
    { icon: "send", text: "Post receipt sends the payment with a one-time request key." },
    { icon: "wifiOff", text: "The connection drops before the server answers. Nothing is saved and no number is used." },
    { icon: "refresh", text: "Try again sends the same key, so even if the first attempt did arrive, the receipt is posted only once." },
  ];

  return (
    <Specimen
      id="network-receipt"
      rise={0}
      wide
      actions={<Switch label="Fail the next attempt" checked={failNext} onChange={(e) => setFail(e.target.checked)} />}
    >
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid gap-3">
          <Banner tone="danger" title="Receipt not posted — safe to try again.">
            The connection dropped before the server replied; nothing was saved.
          </Banner>
          <ol className="m-0 grid list-none gap-2 p-0">
            {steps.map((s, i) => (
              <li key={s.icon} className="mtb-slide-in flex items-start gap-3 rounded-md border border-border bg-surface-raised px-3 py-2.5" style={stagger(i)}>
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-sunken text-small font-semibold text-ink-muted">{i + 1}</span>
                <span className="flex items-start gap-2 text-ink">
                  <Icon name={s.icon} size={18} className="mt-0.5 shrink-0 text-ink-muted" />
                  {s.text}
                </span>
              </li>
            ))}
          </ol>
        </div>
        <div className="mtb-card grid gap-3 p-4">
          <KeyValue
            items={[
              ["Student", "Ayesha Khan · KC-14823"],
              ["Paying", formatRs(OVERDUE_TOTAL)],
              ["Request key", <span className="mtb-mono text-small">{key.slice(0, 18)}…</span>],
            ]}
          />
          {posted ? (
            <Banner tone="success" title="Posted once.">
              The retry carried the same key.
            </Banner>
          ) : (
            <Button variant="primary" size="lg" block iconRight="arrowRight" onClick={() => setOpen(true)}>
              Review · {formatRs(OVERDUE_TOTAL)}
            </Button>
          )}
          {posted && (
            <Button
              size="sm"
              variant="ghost"
              icon="refresh"
              onClick={() => {
                setPosted(false);
                setFail(true);
                setKey(newIdempotencyKey());
              }}
            >
              Start again
            </Button>
          )}
        </div>
      </div>
      <ReceiptReviewDialog
        open={open}
        onClose={() => setOpen(false)}
        onPosted={() => {
          setOpen(false);
          setPosted(true);
        }}
        payment="Cash · received Rs 13,000 · change Rs 750"
        shouldFail={() => {
          if (!failRef.current) return false;
          setFail(false);
          return true;
        }}
      />
    </Specimen>
  );
}

/* ------------------------------------------------------------------ A page couldn't load */

function LoadErrorSpecimen() {
  const [phase, setPhase] = useState<"error" | "retrying" | "loaded">("error");
  const retry = async () => {
    setPhase("retrying");
    await wait(1200);
    setPhase("loaded");
  };
  return (
    <Specimen
      id="network-load"
      rise={1}
      actions={
        phase === "loaded" ? (
          <Button size="sm" variant="ghost" icon="refresh" onClick={() => setPhase("error")}>
            Start again
          </Button>
        ) : undefined
      }
    >
      <AppFrame title="Dashboard">
        {phase !== "loaded" && (
          <Banner
            tone="danger"
            title="The dashboard figures could not be loaded."
            actions={
              <Button size="sm" variant="secondary" loading={phase === "retrying"} loadingLabel="Trying…" onClick={() => void retry()}>
                Try again
              </Button>
            }
          >
            No response from the server. Check the connection, then try again.
          </Banner>
        )}
        <DashboardKpis key={phase} loading={phase !== "loaded"} compact />
      </AppFrame>
    </Specimen>
  );
}

/* ------------------------------------------------------------------ Someone else saved first */

const OTHER_SAVED_AT = "2026-11-04T10:12:00+05:00";

function ConflictSpecimen() {
  const toast = useToast();
  const [value, setValue] = useState<number | null>(9000);
  const [phase, setPhase] = useState<"editing" | "saving" | "conflict" | "reloaded" | "saved">("editing");

  const save = async () => {
    setPhase("saving");
    await wait(900);
    if (phase === "editing") {
      setPhase("conflict");
      return;
    }
    setPhase("saved");
    toast({ title: "Fee structure saved", message: `Class 7 · tuition fee ${formatRs(value ?? 0)} a month.` });
  };

  return (
    <Specimen
      id="network-conflict"
      rise={2}
      actions={
        phase === "saved" ? (
          <Button
            size="sm"
            variant="ghost"
            icon="refresh"
            onClick={() => {
              setValue(9000);
              setPhase("editing");
            }}
          >
            Start again
          </Button>
        ) : undefined
      }
    >
      <AppFrame title="Fee structure · Class 7" context="Khalid Campus · Session 2026–27">
        <div className="grid gap-3 sm:grid-cols-2">
          <AmountInput label="Tuition fee (monthly)" value={value} onValueChange={setValue} disabled={phase === "saved"} />
          <AmountInput label="Annual charges" value={3000} onValueChange={() => undefined} disabled />
        </div>
        {phase === "conflict" && (
          <Banner tone="danger" title="Someone else saved changes first.">
            Nadia Shah changed Class 7's fees at {formatTime(OTHER_SAVED_AT)}, after you opened this. Your change was not saved. Load the latest, check it, then make your change again.
          </Banner>
        )}
        {phase === "reloaded" && (
          <Banner tone="info" title="Showing the latest version.">
            Saved by Nadia Shah at {formatTime(OTHER_SAVED_AT)}. Change it again if you still need to.
          </Banner>
        )}
        {phase === "saved" && <Banner tone="success" title="Saved.">Nobody else changed it in between, so nothing was overwritten.</Banner>}
        <div className="flex flex-wrap justify-end gap-2">
          {phase === "conflict" ? (
            <Button
              variant="primary"
              icon="refresh"
              onClick={() => {
                setValue(8800);
                setPhase("reloaded");
              }}
            >
              Load the latest
            </Button>
          ) : (
            <Button variant="primary" loading={phase === "saving"} loadingLabel="Saving…" disabled={phase === "saved"} onClick={() => void save()}>
              Save
            </Button>
          )}
        </div>
      </AppFrame>
    </Specimen>
  );
}

export function NetworkSection() {
  return (
    <StateGroupSection id="network">
      <ReceiptNotPostedSpecimen />
      <LoadErrorSpecimen />
      <ConflictSpecimen />
    </StateGroupSection>
  );
}
