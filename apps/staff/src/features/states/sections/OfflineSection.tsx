import { teacherCountsLine } from "@mtb/api";
import { formatLongDate, formatTime } from "@mtb/domain";
import { ATTENDANCE_LETTER, Avatar, Banner, Button, cx, Icon, StatusBadge, useToast, type AttendanceStatus, type IconName } from "@mtb/ui";
import { useEffect, useRef, useState } from "react";
import { TEACHER_APP_URL } from "../catalogue";
import { REGISTER_7B, SYNCED_AT, TODAY } from "../demo";
import { PhoneFrame, Specimen, stagger, StateGroupSection } from "../kit";
import { SUCCESS_TOASTS } from "./ToastSection";

type Kind = "online" | "offline" | "syncing" | "synced" | "failed";

const SUBMITTED_AT = "2026-11-04T08:39:00+05:00";

/** The teacher app's wording, exactly (brief §7.7). */
const LABEL: Record<Kind, string> = {
  online: "Online",
  offline: "Offline — saved on this phone",
  syncing: "Syncing…",
  synced: `Synced ${formatTime(SYNCED_AT)}`,
  failed: "Sync failed — Retry",
};

/** Same colours and icons as the teacher app's SyncIndicator. */
const LOOK: Record<Kind, { icon: IconName; cls: string }> = {
  online: { icon: "wifi", cls: "bg-surface-sunken text-ink-muted" },
  offline: { icon: "cloudOff", cls: "bg-warning-tint text-warning-ink" },
  syncing: { icon: "refresh", cls: "bg-info-tint text-info-ink" },
  synced: { icon: "checkCircle", cls: "bg-success-tint text-success-ink" },
  failed: { icon: "alertCircle", cls: "bg-danger-tint text-danger-ink" },
};

const MEANING: Record<Kind, string> = {
  online: "Everything is saved on the phone first, then sent to the school server straight away.",
  offline: "No signal. The register is kept on the phone and sent by itself when the signal returns. The teacher can carry on.",
  syncing: "The signal is back; what was saved on the phone is being sent.",
  synced: "Everything on the phone has reached the school server. Parents of absent students get their SMS now.",
  failed: "The server didn't take it. It stays on the phone; one tap tries again.",
};

const KINDS: Kind[] = ["online", "offline", "syncing", "synced", "failed"];
const MARK_STATUS: Record<"P" | "A" | "L", AttendanceStatus> = { P: "present", A: "absent", L: "leave" };

function SyncPill({ kind, waiting, live }: { kind: Kind; waiting: number; live?: boolean }) {
  const look = LOOK[kind];
  return (
    <span key={kind} className={cx("mtb-states-pill mtb-states-pill-swap w-fit min-w-0", look.cls)} {...(live ? { role: "status", "aria-label": `${LABEL[kind]}${waiting ? `. ${waiting} waiting to send` : ""}` } : {})}>
      <Icon name={look.icon} size={15} className={cx("shrink-0", kind === "syncing" && "motion-safe:animate-spin")} />
      <span>{LABEL[kind]}</span>
      {waiting > 0 && kind !== "syncing" && <span className="tabular-nums">· {waiting}</span>}
    </span>
  );
}

export function OfflineSection() {
  const toast = useToast();
  const [kind, setKind] = useState<Kind>("offline");
  const [playing, setPlaying] = useState(false);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const counts = REGISTER_7B.counts;
  const line = teacherCountsLine(counts);
  const submitted = kind !== "online";
  const waiting = kind === "offline" || kind === "failed" || kind === "syncing" ? 1 : 0;

  const stop = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPlaying(false);
  };
  useEffect(() => stop, []);

  /** Flow 3 of the brief: submit with no signal → saved on the phone → signal back → synced. */
  const play = () => {
    stop();
    setPlaying(true);
    setKind("online");
    const at = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
    at(1400, () => {
      setKind("offline");
      toast({ tone: "warning", title: "Saved on this phone", message: "You're offline. The register is sent as soon as the connection is back." });
    });
    at(4200, () => setKind("syncing"));
    at(5900, () => {
      setKind("synced");
      setPlaying(false);
      toast(SUCCESS_TOASTS.attendance);
    });
  };

  const retry = () => {
    stop();
    setKind("syncing");
    timers.current.push(setTimeout(() => setKind("synced"), 1500));
  };

  const bottom =
    kind === "online" ? (
      <Button variant="primary" size="touch" block icon="send" onClick={play} disabled={playing}>
        <span className="tabular-nums">Submit · {line}</span>
      </Button>
    ) : kind === "offline" ? (
      <Button size="touch" block icon="cloudOff" disabled>
        Waiting for a connection
      </Button>
    ) : kind === "syncing" ? (
      <Button size="touch" block icon="refresh" disabled>
        Sending…
      </Button>
    ) : kind === "failed" ? (
      <Button size="touch" block icon="refresh" onClick={retry}>
        Send now
      </Button>
    ) : (
      <Button size="touch" block icon="edit" onClick={() => toast({ title: "Change sent for approval", message: "Muhammad Bilal: Absent → Late. The register shows “Change pending approval” until the principal decides." })}>
        Request change
      </Button>
    );

  return (
    <StateGroupSection id="offline" cols={1}>
      <Specimen
        id="offline-sync"
        rise={0}
        plain
        actions={
          <Button size="sm" variant="primary" icon={playing ? "pause" : "play"} onClick={playing ? stop : play}>
            {playing ? "Stop" : "Play the sequence"}
          </Button>
        }
      >
        <div className="grid items-start gap-6 lg:grid-cols-[344px_minmax(0,1fr)]">
          <PhoneFrame
            label="Teacher app, 7-B register"
            title={`${REGISTER_7B.classSection} register`}
            subtitle={
              <>
                <bdi dir="ltr">{formatLongDate(TODAY)}</bdi> · {REGISTER_7B.enrolled} students
              </>
            }
            right={
              <div className="flex min-w-0 max-w-[62%] justify-end">
                <SyncPill kind={kind} waiting={waiting} live />
              </div>
            }
            bottom={bottom}
          >
            <div key={kind} className="mtb-rise grid gap-3">
              {(kind === "offline" || kind === "syncing" || kind === "failed") && (
                <Banner tone="warning" icon="cloudOff" title="Saved on this phone.">
                  Submitted at <bdi dir="ltr">{formatTime(SUBMITTED_AT)}</bdi>.{" "}
                  {kind === "offline" ? "It is sent automatically when you're back online. The register is locked meanwhile." : kind === "syncing" ? "Sending now…" : "The school server didn't take it yet; it will try again."}
                </Banner>
              )}
              {kind === "synced" && (
                <Banner tone="success" icon="lock" title={`Submitted at ${formatTime(SYNCED_AT)} · locked.`}>
                  Taken offline and synced. Parents of {counts.absent} absent students were sent an SMS. To correct a mark, tap the student or use Request change.
                </Banner>
              )}
              {kind === "online" && <p className="m-0 px-1 text-small text-ink-muted">Everyone starts as Present. Tap a student to mark them absent, on leave or late.</p>}
              {submitted && <p className="mtb-card m-0 px-4 py-3 text-title-3 tabular-nums text-ink">{line}</p>}
            </div>
            <ul className="m-0 grid list-none gap-1.5 p-0" aria-label="7-B students (first three)">
              {REGISTER_7B.shown.map((s, i) => (
                <li key={s.name} className="mtb-card mtb-slide-in flex min-h-14 items-center gap-3 px-3 py-2" style={stagger(i)}>
                  <span className="w-5 shrink-0 text-end text-small text-ink-muted tabular-nums">{s.roll}</span>
                  <Avatar name={s.name} />
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{s.name}</span>
                  <StatusBadge status={MARK_STATUS[s.mark]} dot={false}>
                    {ATTENDANCE_LETTER[MARK_STATUS[s.mark]]}
                  </StatusBadge>
                </li>
              ))}
              <li className="px-1 text-small text-ink-muted">…and {REGISTER_7B.enrolled - REGISTER_7B.shown.length} more</li>
            </ul>
          </PhoneFrame>

          <div className="grid content-start gap-3">
            <p className="m-0 text-ink-muted">
              The pill at the top of every teacher-app screen says where the teacher's work is. Choose a state, or play the brief's flow: submit with no signal, the signal returns, the register syncs.
            </p>
            <ul className="m-0 grid list-none gap-2 p-0" aria-label="Sync states">
              {KINDS.map((k, i) => (
                <li key={k} className="mtb-slide-in" style={stagger(i)}>
                  <button
                    type="button"
                    aria-pressed={kind === k}
                    onClick={() => {
                      stop();
                      setKind(k);
                    }}
                    className={cx(
                      "grid w-full gap-1.5 rounded-md border px-3 py-2.5 text-left transition-colors",
                      kind === k ? "border-brand bg-brand-tint" : "border-border bg-surface-raised hover:bg-surface-hover",
                    )}
                  >
                    <SyncPill kind={k} waiting={0} />
                    <span className="text-small text-ink">{MEANING[k]}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="m-0 flex items-start gap-2 text-small text-ink-muted">
              <Icon name="smartphone" size={16} className="mt-0.5 shrink-0" />
              <span>
                In the teacher app at <span className="mtb-mono">{TEACHER_APP_URL.replace(/^https?:\/\//, "")}</span>, tap the pill and switch on “Demo: this phone has no signal” to take the phone offline for real. Registers and marks wait on the phone and sync when it is switched off again.
              </span>
            </p>
          </div>
        </div>
      </Specimen>
    </StateGroupSection>
  );
}
