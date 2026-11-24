import { ApiError, HR_DAY_LABEL, hrApi, hrMonthLabel, hrQueries, newIdempotencyKey, type HrLeaveRequest, type HrMyAttendance, type HrMyAttendanceDay, type HrMyLeave } from "@mtb/api";
import { formatDate, pakistanToday } from "@mtb/domain";
import { Banner, Button, DatePicker, EmptyState, Panel, Segmented, Select, SidePanel, Skeleton, StatusBadge, Switch, Textarea, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type CSSProperties } from "react";
import { z } from "zod";
import { Page, PageHeader } from "../../app/shell/page";
import { errorText, QueryState } from "./shared";

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

/** /teaching/leave — the teacher's own leave (what is left, requests sent, ask for more) and own attendance. */
export function LeavePage() {
  const q = useQuery(hrQueries.myLeave());
  const [asking, setAsking] = useState(false);
  // Sign-ins without a staff record (HR answers 404 NOT_LINKED): nothing to show and nothing to ask for.
  const notLinked = q.error instanceof ApiError && q.error.code === "NOT_LINKED";
  return (
    <Page>
      <PageHeader
        title="Leave"
        context="Your leave and attendance · requests go to the principal"
        actions={
          <Button variant="primary" icon="plus" disabled={!q.data} onClick={() => setAsking(true)}>
            Ask for leave
          </Button>
        }
      />
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <div className="grid gap-6">
          {notLinked ? (
            <div className="mtb-card">
              <EmptyState icon="user" title="Not linked to a staff record" description="Your sign-in isn't linked to a staff record yet, so there is no leave to show. Ask the office to link it." />
            </div>
          ) : (
            <QueryState
              query={q}
              what="Your leave"
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
                  <AskPanel open={asking} onClose={() => setAsking(false)} d={d} />
                </>
              )}
            </QueryState>
          )}
        </div>
        <MyAttendanceCard rise={2} />
      </div>
    </Page>
  );
}

function LeaveBody({ d }: { d: HrMyLeave }) {
  return (
    <>
      <Panel id="leave-balances" rise={0} title="Left this session">
        <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-3">
          {d.balances.map((b, i) => (
            <li key={b.typeId} className="mtb-slide-in grid gap-0.5 rounded-md bg-surface-sunken p-3" style={{ "--i": i } as CSSProperties}>
              <span className="text-small text-ink-muted">{b.typeName}</span>
              <span className="text-title-1 tabular-nums text-ink">{b.left === null ? "No limit" : b.left}</span>
              <span className="text-caption text-ink-muted">
                {b.entitled === null ? `${b.taken} taken` : `of ${b.entitled} · ${b.taken} taken`}
                {b.pending ? ` · ${b.pending} waiting` : ""}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel id="leave-requests" rise={1} title="Your requests" flush>
        {d.requests.length === 0 ? (
          <EmptyState icon="calendar" title="No leave requests yet" description="Use Ask for leave; the principal decides and you're told in Notifications." />
        ) : (
          <ul className="m-0 grid list-none p-0 max-h-[420px] overflow-y-auto pr-1">
            {d.requests.map((r) => (
              <li key={r.id} className="grid gap-1 border-t border-border px-5 py-3 first:border-t-0">
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
      </Panel>
    </>
  );
}

function AskPanel({ open, onClose, d }: { open: boolean; onClose: () => void; d: HrMyLeave }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  // Today in Pakistan: the server checks leave dates against the same day.
  const TODAY = pakistanToday();
  // Kept for every attempt at one request, so a retry after a lost reply can't send it twice.
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
    <SidePanel
      open={open}
      onClose={() => !send.isPending && onClose()}
      title="Ask for leave"
      description="The principal decides. Sundays and school holidays don't count as leave days."
      footer={
        <>
          <Button onClick={onClose} disabled={send.isPending}>
            Cancel
          </Button>
          <Button variant="primary" icon="send" loading={send.isPending} loadingLabel="Sending…" onClick={submit}>
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
    </SidePanel>
  );
}

/* ------------------------------------------------------------------ My attendance */

const prevMonth = (m: string) => {
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7));
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
};

/** "08:12 AM" */
const clock12 = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return `${String(h % 12 || 12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

function lineFor(d: HrMyAttendanceDay): string {
  if (d.status === "LATE") return `Late${d.lateMinutes ? ` by ${d.lateMinutes} min` : ""}${d.timeIn ? `, in at ${clock12(d.timeIn)}` : ""}`;
  if (d.status === "LEAVE") return d.leaveType ? `On leave (${d.leaveType})` : "On leave";
  if (d.status === "ABSENT") return "Absent";
  if (d.status === "HALF_DAY") return "Half day";
  return d.status ? HR_DAY_LABEL[d.status] : "Not marked yet";
}

function Figures({ a }: { a: HrMyAttendance }) {
  const tiles: Array<[string, number]> = [
    ["Present", a.present + a.halfDay],
    ["Late", a.late],
    ["On leave", a.leave],
    ["Absent", a.absent],
  ];
  // Days worth a look: late, leave, absent and half days, newest first.
  const notable = a.days.filter((d) => d.status === "LATE" || d.status === "LEAVE" || d.status === "ABSENT" || d.status === "HALF_DAY").reverse();
  return (
    <div className="grid gap-3">
      <dl className="m-0 grid grid-cols-4 gap-2">
        {tiles.map(([label, n]) => (
          <div key={label} className="grid gap-0.5 rounded-md bg-surface-sunken p-2 text-center">
            <dt className="text-caption text-ink-muted">{label}</dt>
            <dd className="m-0 text-title-2 tabular-nums text-ink">{n}</dd>
          </div>
        ))}
      </dl>
      <p className="m-0 text-small text-ink-muted">
        {a.workingDays} working {a.workingDays === 1 ? "day" : "days"} so far{a.percent !== null ? ` · ${a.percent}% attendance` : ""}
        {a.lateMinutes ? ` · ${a.lateMinutes} minutes late in all` : ""}. Half days count as present.
      </p>
      {notable.length > 0 && (
        <ul className="m-0 grid list-none gap-1 p-0 text-small" aria-label="Late, leave and absent days">
          {notable.slice(0, 6).map((d) => (
            <li key={d.date} className="flex justify-between gap-3">
              <span className="tabular-nums text-ink">{formatDate(d.date)}</span>
              <span className="text-ink-muted">{lineFor(d)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="m-0 text-small text-ink-muted">From the staff attendance kept by the office. Something wrong? Tell the office the same day.</p>
    </div>
  );
}

/** The teacher's own staff attendance for this month or last month. */
export function MyAttendanceCard({ rise = 2 }: { rise?: number }) {
  const thisMonth = useQuery(hrQueries.myAttendance());
  const [which, setWhich] = useState<"this" | "last">("this");
  const current = thisMonth.data?.month;
  const last = useQuery({ ...hrQueries.myAttendance(current ? prevMonth(current) : ""), enabled: which === "last" && Boolean(current) });
  const q = which === "last" ? last : thisMonth;
  const notLinked = thisMonth.error instanceof ApiError && thisMonth.error.code === "NOT_LINKED";
  return (
    <Panel
      id="my-attendance"
      title="My attendance"
      description={current ? `${hrMonthLabel(which === "last" ? prevMonth(current) : current)}${which === "this" ? " so far" : ""}` : "Your own days in and out this month."}
      rise={rise}
      {...(current
        ? {
            actions: (
              <Segmented
                aria-label="Month"
                value={which}
                onChange={(v) => setWhich(v as "this" | "last")}
                options={[
                  { value: "this", label: "This month" },
                  { value: "last", label: "Last month" },
                ]}
              />
            ),
          }
        : {})}
    >
      {notLinked ? (
        <p className="m-0 text-small text-ink-muted">Your sign-in isn't linked to a staff record yet, so there is no attendance to show. Ask the office to link it.</p>
      ) : (
        <QueryState query={q} what="Your attendance" skeleton={<Skeleton height={96} />}>
          {(a) => <Figures a={a} />}
        </QueryState>
      )}
    </Panel>
  );
}
