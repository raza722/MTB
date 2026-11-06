import { ApiError, hrApi, hrQueries, newIdempotencyKey, type HrLeaveRequest, type HrMyLeave } from "@mtb/api";
import { formatDate, pakistanToday } from "@mtb/domain";
import { Banner, BottomSheet, Button, DatePicker, EmptyState, Select, Skeleton, StatusBadge, Switch, Textarea, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type CSSProperties } from "react";
import { z } from "zod";
import { QueryState, errorText } from "../../app/shell/QueryState";
import { Screen } from "../../app/shell/Screen";
import { useOnline } from "../../app/sync/network";

const schema = z
  .object({
    typeId: z.string().min(1, { error: "Choose the kind of leave." }),
    from: z.string({ error: "Enter the first day of leave." }).min(1, { error: "Enter the first day of leave." }),
    to: z.string({ error: "Enter the last day of leave." }).min(1, { error: "Enter the last day of leave." }),
    halfDay: z.boolean(),
    reason: z.string().trim().min(5, { error: "Say why in a few words; the principal reads this." }),
  })
  .refine((v) => v.to >= v.from, { path: ["to"], error: "The last day can't be before the first day." })
  .refine((v) => !v.halfDay || v.from === v.to, { path: ["to"], error: "A half day is one date: make the first and last day the same." });

type Field = "typeId" | "from" | "to" | "reason" | "form";

const STATUS: Record<HrLeaveRequest["status"], { status: "pending" | "approved" | "rejected" | "neutral"; label: string }> = {
  PENDING: { status: "pending", label: "Waiting" },
  APPROVED: { status: "approved", label: "Approved" },
  REJECTED: { status: "rejected", label: "Rejected" },
  CANCELLED: { status: "neutral", label: "Cancelled" },
};

/** The teacher's own leave: what is left of each kind, the requests sent, and a short form to ask for more. */
export function LeavePage() {
  const q = useQuery(hrQueries.myLeave());
  const [asking, setAsking] = useState(false);
  // Sign-ins without a staff record (HR answers 404 NOT_LINKED): nothing to show and nothing to ask for.
  const notLinked = q.error instanceof ApiError && q.error.code === "NOT_LINKED";
  const online = useOnline();
  return (
    <Screen
      title="My leave"
      subtitle="Requests go to the principal"
      documentTitle="My leave"
      backTo="/more"
      bottom={
        <Button variant="primary" size="touch" block icon="plus" disabled={!q.data || !online} onClick={() => setAsking(true)}>
          {online ? "Ask for leave" : "Asking for leave needs a connection"}
        </Button>
      }
    >
      {notLinked ? (
        <EmptyState icon="user" title="Not linked to a staff record" description="Your sign-in isn't linked to a staff record yet, so there is no leave to show. Ask the office to link it." />
      ) : (
        <QueryState
          query={q}
          skeleton={
            <div className="grid gap-2" aria-busy="true" aria-label="Loading your leave">
              <Skeleton height={120} className="rounded-lg" />
              <Skeleton height={200} className="rounded-lg" />
            </div>
          }
        >
          {(d) => (
            <>
              <LeaveBody d={d} />
              <AskSheet open={asking} onClose={() => setAsking(false)} d={d} />
            </>
          )}
        </QueryState>
      )}
    </Screen>
  );
}

function LeaveBody({ d }: { d: HrMyLeave }) {
  return (
    <div className="grid gap-5">
      <section aria-labelledby="balances" className="grid gap-2">
        <h2 id="balances" className="m-0 px-1 text-caption tracking-wide text-ink-muted uppercase">
          Left this session
        </h2>
        <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0">
          {d.balances.map((b, i) => (
            <li key={b.typeId} className="mtb-card mtb-slide-in grid gap-0.5 p-3" style={{ "--i": i } as CSSProperties}>
              <span className="text-small text-ink-muted">{b.typeName}</span>
              <span className="text-title-1 tabular-nums text-ink">{b.left === null ? "No limit" : b.left}</span>
              <span className="text-caption text-ink-muted">
                {b.entitled === null ? `${b.taken} taken` : `of ${b.entitled} · ${b.taken} taken`}
                {b.pending ? ` · ${b.pending} waiting` : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="requests" className="grid gap-2">
        <h2 id="requests" className="m-0 px-1 text-caption tracking-wide text-ink-muted uppercase">
          Your requests
        </h2>
        {d.requests.length === 0 ? (
          <div className="mtb-card p-2">
            <EmptyState icon="calendar" title="No leave requests yet" description="Use Ask for leave below; the principal decides and you're told here." />
          </div>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {d.requests.map((r) => (
              <li key={r.id} className="mtb-card grid gap-1 p-4">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium text-ink">{r.typeName}</span>
                  <StatusBadge status={STATUS[r.status].status}>{STATUS[r.status].label}</StatusBadge>
                </span>
                <span className="text-small text-ink tabular-nums">
                  <bdi dir="ltr">{formatDate(r.from)}</bdi>
                  {r.to !== r.from && (
                    <>
                      {" "}
                      to <bdi dir="ltr">{formatDate(r.to)}</bdi>
                    </>
                  )}{" "}
                  · {r.halfDay ? "half day" : `${r.days} ${r.days === 1 ? "day" : "days"}`}
                </span>
                <span className="text-small text-ink-muted">{r.reason}</span>
                {r.decisionNote && <span className="text-small text-ink">Note: {r.decisionNote}</span>}
                {r.clashes.length > 0 && <span className="text-small text-warning-ink">On those days: {r.clashes.join(", ")}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AskSheet({ open, onClose, d }: { open: boolean; onClose: () => void; d: HrMyLeave }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  // Today in Pakistan: leave is real HR data (module 02), checked by the server against the same date.
  const TODAY = pakistanToday();
  const key = useRef(newIdempotencyKey());
  const [typeId, setTypeId] = useState("");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});

  const send = useMutation({
    mutationFn: () => hrApi.requestMyLeave({ typeId, from: from ?? "", to: to ?? from ?? "", halfDay, reason: reason.trim() }, key.current),
    onSuccess: (r) => {
      key.current = newIdempotencyKey();
      void queryClient.invalidateQueries({ queryKey: hrQueries.myLeave().queryKey });
      toast({ title: "Leave request sent", message: `${r.typeName}, ${formatDate(r.from)}${r.to !== r.from ? ` to ${formatDate(r.to)}` : ""}. The principal decides.` });
      setTypeId("");
      setFrom(null);
      setTo(null);
      setHalfDay(false);
      setReason("");
      onClose();
    },
    onError: (e) => {
      const f = e instanceof ApiError ? e.field : undefined;
      if (f === "typeId" || f === "from" || f === "to" || f === "reason") setErrors({ [f]: e.message });
      else setErrors({ form: errorText(e) });
    },
  });

  const submit = () => {
    const parsed = schema.safeParse({ typeId, from: from ?? "", to: to ?? from ?? "", halfDay, reason });
    if (!parsed.success) {
      const next: Partial<Record<Field, string>> = {};
      for (const i of parsed.error.issues) next[i.path[0] as Field] ??= i.message;
      setErrors(next);
      return;
    }
    setErrors({});
    send.mutate();
  };

  return (
    <BottomSheet
      open={open}
      onClose={send.isPending ? undefined : onClose}
      title="Ask for leave"
      description="The principal decides. Sundays and school holidays don't count as leave days."
      footer={
        <>
          <Button size="touch" onClick={onClose} disabled={send.isPending}>
            Cancel
          </Button>
          <Button size="touch" variant="primary" icon="send" loading={send.isPending} loadingLabel="Sending…" onClick={submit}>
            Send request
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {errors.form && (
          <Banner tone="danger" title="Not sent.">
            {errors.form}
          </Banner>
        )}
        <Select
          label="Kind of leave"
          required
          value={typeId}
          onChange={(e) => setTypeId(e.target.value)}
          error={errors.typeId}
          options={[{ value: "", label: "Choose" }, ...d.types.map((t) => ({ value: t.id, label: `${t.name}${t.paid ? "" : " (unpaid)"}` }))]}
        />
        <div className="grid grid-cols-2 gap-3">
          <DatePicker label="First day" required value={from} onValueChange={setFrom} today={TODAY} minDate={TODAY} error={errors.from} />
          <DatePicker label="Last day" required value={to ?? from} onValueChange={setTo} today={TODAY} minDate={from ?? TODAY} error={errors.to} />
        </div>
        <Switch label="Half day only" checked={halfDay} onChange={(e) => setHalfDay(e.target.checked)} />
        <Textarea label="Reason" required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} error={errors.reason} placeholder="For example: attending my sister's wedding in Bahawalpur." />
      </form>
    </BottomSheet>
  );
}
