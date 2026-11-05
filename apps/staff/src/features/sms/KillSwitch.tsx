import { ApiError, smsStatusApi, smsStatusQueries } from "@mtb/api";
import { formatTime } from "@mtb/domain";
import { Button, ConfirmDialog, Icon, Select, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

const REASONS = ["Wrong message is going out", "Gateway problem", "Cost limit reached", "Other"];

/**
 * "Pause all SMS" — admin only, in its own danger zone. Needs a reason and typing PAUSE.
 * While paused, the shell shows "All SMS paused by … · Resume" on every staff page.
 */
export function KillSwitch() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const status = useQuery(smsStatusQueries.status());
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const setStatus = (data: Awaited<ReturnType<typeof smsStatusApi.status>>) => queryClient.setQueryData(smsStatusQueries.status().queryKey, data);

  const pause = useMutation({
    mutationFn: () => smsStatusApi.pause(reason),
    onSuccess: (data) => {
      setStatus(data);
      setOpen(false);
      setReason("");
      toast({ tone: "warning", title: "All SMS paused", message: "No messages leave any campus until SMS is resumed. Every staff page shows the paused banner." });
    },
  });
  const resume = useMutation({
    mutationFn: smsStatusApi.resume,
    onSuccess: (data) => {
      setStatus(data);
      toast({ title: "SMS resumed", message: "Held messages are being sent now." });
    },
    onError: (e) => toast({ tone: "danger", title: "SMS not resumed", message: e instanceof ApiError ? e.message : "Check your connection and try again." }),
  });

  const s = status.data;

  return (
    <section aria-labelledby="danger-zone" className="rounded-lg border border-danger bg-surface-raised">
      <header className="flex items-center gap-2 border-b border-border px-5 py-3">
        <Icon name="alert" size={18} className="text-danger-ink" />
        <h2 id="danger-zone" className="m-0 text-title-3 text-danger-ink">
          Danger zone
        </h2>
        <span className="text-small text-ink-muted">· Admin only</span>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div className="grid max-w-2xl gap-1">
          <span className="font-semibold text-ink">{s?.paused ? "All SMS are paused" : "Pause all SMS"}</span>
          {s?.paused ? (
            <span className="text-small text-ink-muted">
              Paused by {s.pausedBy ?? "Admin"}
              {s.pausedAt ? <> at <span className="mtb-num">{formatTime(s.pausedAt)}</span></> : null}
              {s.reason ? ` · ${s.reason}` : ""}. Fee reminders, absence alerts and results are held until you resume.
            </span>
          ) : (
            <span className="text-small text-ink-muted">
              Stops every SMS from every campus at once — fee reminders, absence alerts and results. Messages already queued wait until SMS is resumed. Use it only when a wrong message is going out or the gateway is misbehaving.
            </span>
          )}
        </div>
        {s?.paused ? (
          <Button variant="secondary" icon="play" loading={resume.isPending} loadingLabel="Resuming…" onClick={() => resume.mutate()}>
            Resume SMS
          </Button>
        ) : (
          <Button
            variant="danger"
            icon="pause"
            disabled={!s}
            onClick={() => {
              pause.reset();
              setReasonError(null);
              setOpen(true);
            }}
          >
            Pause all SMS
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={() => {
          if (!reason) {
            setReasonError("Choose why you are pausing SMS.");
            return;
          }
          pause.mutate();
        }}
        tone="danger"
        icon="pause"
        title="Pause all SMS?"
        message="No SMS will be sent from any campus until someone resumes it. Messages already queued stay queued. Every staff page will show that SMS is paused."
        confirmLabel="Pause all SMS"
        requireText="PAUSE"
        loading={pause.isPending}
        loadingLabel="Pausing…"
        error={pause.error ? (pause.error instanceof ApiError ? pause.error.message : "SMS were not paused — try again.") : undefined}
      >
        <div className="mt-4">
          <Select
            label="Reason"
            required
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setReasonError(null);
            }}
            options={[{ value: "", label: "Choose…" }, ...REASONS]}
            {...(reasonError ? { error: reasonError } : {})}
          />
        </div>
      </ConfirmDialog>
    </section>
  );
}
