import { formatTime } from "@mtb/domain";
import { BottomSheet, Button, cx, Icon, Switch, type IconName } from "@mtb/ui";
import { useState, type CSSProperties } from "react";
import { setSimulatedOffline, useOnline, useSimulatedOffline } from "../sync/network";
import { discard, retrySync, useSync, type SyncState } from "../sync/outbox";

type Kind = "online" | "offline" | "syncing" | "synced" | "failed";

function kindOf(online: boolean, s: SyncState): Kind {
  if (!online) return "offline";
  if (s.phase === "syncing") return "syncing";
  if (s.phase === "failed") return "failed";
  return s.lastSyncedAt ? "synced" : "online";
}

/** The brief's wording, exactly: Online · "Offline — saved on this phone" · Syncing… · "Synced 08:42 AM" · "Sync failed — Retry". */
export function syncLabel(kind: Kind, lastSyncedAt: number | null): string {
  switch (kind) {
    case "online":
      return "Online";
    case "offline":
      return "Offline — saved on this phone";
    case "syncing":
      return "Syncing…";
    case "synced":
      return `Synced ${formatTime(new Date(lastSyncedAt ?? Date.now()))}`;
    case "failed":
      return "Sync failed — Retry";
  }
}

const LOOK: Record<Kind, { icon: IconName; cls: string }> = {
  online: { icon: "wifi", cls: "bg-surface-sunken text-ink-muted" },
  offline: { icon: "cloudOff", cls: "bg-warning-tint text-warning-ink" },
  syncing: { icon: "refresh", cls: "bg-info-tint text-info-ink" },
  synced: { icon: "checkCircle", cls: "bg-success-tint text-success-ink" },
  failed: { icon: "alertCircle", cls: "bg-danger-tint text-danger-ink" },
};

/** The sync pill at the top of every screen. Tap it for what is waiting on the phone; when sync failed it retries. */
export function SyncIndicator() {
  const online = useOnline();
  const sync = useSync();
  const [open, setOpen] = useState(false);
  const kind = kindOf(online, sync);
  const look = LOOK[kind];
  const waiting = sync.items.length;
  const label = syncLabel(kind, sync.lastSyncedAt);

  return (
    <>
      <button
        type="button"
        onClick={() => (kind === "failed" ? void retrySync() : setOpen(true))}
        className="grid min-h-11 max-w-[62%] shrink-0 place-items-center rounded-full px-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        aria-label={`${label}${waiting ? `. ${waiting} waiting to send` : ""}. ${kind === "failed" ? "Tap to try again." : "Tap for details."}`}
      >
        <span className={cx("flex h-8 max-w-full items-center gap-1.5 rounded-full px-2.5 text-caption font-medium", look.cls)}>
          <Icon name={look.icon} size={15} className={cx("shrink-0", kind === "syncing" && "motion-safe:animate-spin")} />
          <span className="truncate">{label}</span>
          {waiting > 0 && kind !== "syncing" && <span className="tabular-nums">· {waiting}</span>}
        </span>
      </button>
      <span className="mtb-sr-only" aria-live="polite">
        {label}
      </span>
      <SyncSheet open={open} onClose={() => setOpen(false)} kind={kind} />
    </>
  );
}

function SyncSheet({ open, onClose, kind }: { open: boolean; onClose: () => void; kind: Kind }) {
  const sync = useSync();
  const online = useOnline();
  const simulated = useSimulatedOffline();
  const [confirming, setConfirming] = useState<string | null>(null);
  const intro: Record<Kind, string> = {
    online: "Everything you do is saved on this phone first, then sent to the school server straight away.",
    offline: "This phone has no connection. Registers and marks are kept here and sent automatically when the connection comes back.",
    syncing: "Sending what was saved on this phone…",
    synced: "Everything on this phone has reached the school server.",
    failed: `The school server didn't take the last item${sync.error ? `: ${sync.error}` : "."} It is still on this phone.`,
  };
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={syncLabel(kind, sync.lastSyncedAt)}
      description={intro[kind]}
      footer={
        <>
          <Button size="touch" onClick={onClose}>
            Close
          </Button>
          <Button size="touch" variant="primary" icon="refresh" disabled={!online || !sync.items.length} loading={sync.phase === "syncing"} loadingLabel="Syncing…" onClick={() => void retrySync()}>
            Sync now
          </Button>
        </>
      }
    >
      {import.meta.env.VITE_USE_MOCKS !== "false" && (
        <div className="mb-3 rounded-md border border-dashed border-border-strong px-3 py-1">
          <Switch label="Demo: this phone has no signal" checked={simulated} onChange={(e) => setSimulatedOffline(e.target.checked)} />
        </div>
      )}
      {sync.items.length === 0 ? (
        <p className="m-0 flex items-center gap-2 rounded-md bg-surface-sunken px-3 py-3 text-ink-muted">
          <Icon name="checkCircle" size={18} /> Nothing waiting to send.
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {sync.items.map((i, n) => (
            <li key={i.id} className="mtb-slide-in rounded-md border border-border px-3 py-2.5" style={{ "--i": n } as CSSProperties}>
              <div className="flex items-start gap-3">
                <Icon name="cloudOff" size={18} className="mt-0.5 shrink-0 text-ink-muted" />
                <div className="min-w-0 flex-1">
                  <p className="m-0 font-medium text-ink">{i.label}</p>
                  <p className="m-0 text-small text-ink-muted">
                    Saved on this phone at <bdi dir="ltr">{formatTime(new Date(i.createdAt))}</bdi>
                    {i.attempts > 0 && ` · ${i.attempts} ${i.attempts === 1 ? "try" : "tries"}`}
                  </p>
                  {i.lastError && <p className="m-0 mt-1 text-small text-danger-ink">{i.lastError}</p>}
                </div>
                <Button
                  size="sm"
                  variant={confirming === i.id ? "danger" : "ghost"}
                  onClick={() => {
                    if (confirming === i.id) {
                      discard(i.id);
                      setConfirming(null);
                    } else setConfirming(i.id);
                  }}
                >
                  {confirming === i.id ? "Discard for good" : "Discard"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </BottomSheet>
  );
}
