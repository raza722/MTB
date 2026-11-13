import { newIdempotencyKey, TRANSPORT_DIRECTION_LABEL, transportApi, transportQueries, type OperationsPerson, type TransportDirection, type TransportRider, type TransportRoute } from "@mtb/api";
import { formatCount, formatDate, formatMobile, formatRs } from "@mtb/domain";
import { Banner, Button, buttonClassName, ConfirmDialog, DataTable, DatePicker, EmptyState, Icon, Input, Modal, Segmented, Select, SidePanel, StatusBadge, Textarea, useToast, type Column } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import { CampusNote, errorCode, errorText, LoadError, opsToday, PersonPicker, RequireSingleCampusOverlay } from "../library/common";
import { Load, TransportShell } from "./shared";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
/** Last day of the month of an ISO date: the default last day on the van. */
const monthEnd = (d: string) => {
  const x = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0));
  return x.toISOString().slice(0, 10);
};
const isFull = (r: Pick<TransportRoute, "riders" | "capacity">) => r.capacity > 0 && r.riders >= r.capacity;
const routeOption = (r: TransportRoute) => ({ value: r.id, label: `${r.code} · ${r.name} (${r.capacity > 0 ? `${r.riders} of ${r.capacity} seats${isFull(r) ? ", full" : ""}` : "no vehicle yet"})` });
/** "Class 5-A · Father name" without empty parts; "—" when there is nothing. */
const detailLine = (r: TransportRider) => [r.detail, r.type === "STUDENT" ? r.father : ""].filter((x) => x.trim()).join(" · ") || "—";

function RouteStopFields({ routes, routeId, stopId, onRoute, onStop, errors }: { routes: TransportRoute[]; routeId: string; stopId: string; onRoute: (v: string) => void; onStop: (v: string) => void; errors: Record<string, string> }) {
  const route = routes.find((r) => r.id === routeId);
  return (
    <>
      <Select label="Route" required value={routeId} onChange={(e) => { onRoute(e.target.value); onStop(""); }} error={errors.routeId} options={[{ value: "", label: "Choose…" }, ...routes.filter((r) => r.active).map(routeOption)]} />
      <Select
        label="Gets on at"
        required
        value={stopId}
        onChange={(e) => onStop(e.target.value)}
        error={errors.stopId}
        disabled={!route}
        options={[{ value: "", label: route ? "Choose the stop…" : "Choose the route first" }, ...(route?.stops ?? []).map((s) => ({ value: s.id, label: `${s.name} · pickup ${s.pickupTime} · ${formatRs(s.fare ?? route!.fare)} a month` }))]}
      />
      {route && (
        <div className="sm:col-span-2 flex flex-wrap items-center gap-3 rounded-md bg-surface-sunken px-3 py-2">
          <Load r={route} />
          <span className="text-small text-ink-muted">
            {route.vehicleLabel} · driver {route.driverName || "not set"}
          </span>
        </div>
      )}
    </>
  );
}

function AssignPanel({ onClose }: { onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const canCollect = useCan("fees.collect");
  const routes = useQuery(transportQueries.routes(ctx));
  const [person, setPerson] = useState<OperationsPerson | null>(null);
  const [routeId, setRouteId] = useState("");
  const [stopId, setStopId] = useState("");
  const [direction, setDirection] = useState<TransportDirection>("BOTH");
  const today = opsToday();
  const [fromDate, setFrom] = useState<string | null>(today);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmFull, setConfirmFull] = useState(false);
  const key = useMemo(() => newIdempotencyKey(), [person?.id, routeId, stopId]);
  const list = routes.data ?? [];
  const route = list.find((r) => r.id === routeId);
  const stop = route?.stops.find((s) => s.id === stopId);
  const fee = stop ? (stop.fare ?? route!.fare) : null;
  const full = Boolean(route && isFull(route));
  const assign = useMutation({
    mutationFn: (allow: boolean) => transportApi.assign(ctx, { type: person!.type, personId: person!.id, routeId, stopId, direction, fromDate: fromDate!, allowOverCapacity: allow }, key),
    onSuccess: (r) => {
      toast({
        title: `${r.rider.name} now rides ${r.rider.routeCode}`,
        message:
          r.rider.type === "STAFF"
            ? "Staff transport is recorded for payroll."
            : r.feeHead
              ? `${r.feeHead}: ${formatRs(r.rider.monthlyFee)} added to the fee account${r.feeDueOn ? `, due ${formatDate(r.feeDueOn)}` : ""}.`
              : "No transport fee is charged: the fare is Rs 0.",
        action:
          r.feeHead && canCollect ? (
            <Link to="/fees/counter" search={{ gr: r.rider.personId } as never} className={buttonClassName({ size: "sm" })}>
              Open fee counter
            </Link>
          ) : undefined,
        duration: 8000,
      });
      void qc.invalidateQueries({ queryKey: ["transport"] });
      void qc.invalidateQueries({ queryKey: ["fees"] });
      onClose();
    },
    onError: (e) => {
      if (errorCode(e) === "CAPACITY_FULL") setConfirmFull(true);
    },
  });
  const submit = () => {
    const e: Record<string, string> = {};
    if (!person) e.person = "Choose the student or staff member.";
    else if (!person.active) e.person = `${person.name} has left the school.`;
    if (!routeId) e.routeId = "Choose the route.";
    if (!stopId) e.stopId = "Choose the stop where they get on.";
    if (!fromDate) e.fromDate = "Choose the first day.";
    setErrors(e);
    if (Object.keys(e).length) return;
    if (full) setConfirmFull(true);
    else assign.mutate(false);
  };
  return (
    <SidePanel
      open
      wide
      onClose={onClose}
      title="Assign to a route"
      description="Students are charged the route's monthly fare with their fee; staff transport is recorded for payroll."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="check" loading={assign.isPending} loadingLabel="Assigning…" onClick={submit}>
            Assign
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <PersonPicker label="Student or staff member" value={person} onChange={setPerson} error={errors.person} autoFocus />
        <div className="grid gap-4 sm:grid-cols-2">
          <RouteStopFields routes={list} routeId={routeId} stopId={stopId} onRoute={setRouteId} onStop={setStopId} errors={errors} />
          <DatePicker label="First day" value={fromDate} onValueChange={setFrom} today={today} error={errors.fromDate} />
          <Select label="Uses the van" value={direction} onChange={(e) => setDirection(e.target.value as TransportDirection)} options={(["BOTH", "PICKUP", "DROP"] as const).map((d) => ({ value: d, label: TRANSPORT_DIRECTION_LABEL[d] }))} />
        </div>
        {full && route && (
          <Banner tone="warning" title={`${route.code} is full: ${route.riders} riders for ${route.capacity} seats.`}>
            You can still assign, but you will be asked to confirm. Consider a bigger vehicle or another route.
          </Banner>
        )}
        {route && !route.vehicleId && (
          <Banner tone="warning" title={`${route.code} has no vehicle yet.`}>
            Give the route a vehicle in Routes and stops before assigning riders.
          </Banner>
        )}
        {fee !== null && person && (
          <Banner tone="info" icon="fees" title={person.type === "STAFF" ? "Staff transport" : fee > 0 ? `${formatRs(fee)} a month goes to Fees` : "No transport fee"}>
            {person.type === "STAFF"
              ? `${formatRs(fee)} a month is recorded for payroll. Nothing is charged in Fees and nothing is deducted from salary yet.`
              : fee > 0
                ? `"Transport fee – ${monthName(fromDate ?? today).slice(0, 3)} ${(fromDate ?? today).slice(0, 4)}" is added to ${person.name}'s fee account from ${monthName(fromDate ?? today)} and shows at the fee counter. Later months come with the monthly fee voucher.`
                : "The fare for this stop is Rs 0, so nothing is added to the fee account."}
          </Banner>
        )}
        {assign.isError && errorCode(assign.error) !== "CAPACITY_FULL" && <Banner tone="danger">{errorText(assign.error)}</Banner>}
      </div>
      <ConfirmDialog
        open={confirmFull}
        onClose={() => setConfirmFull(false)}
        onConfirm={() => assign.mutate(true)}
        tone="warning"
        title={`Assign to ${route?.code ?? "this route"} although it is full?`}
        message={`${route?.vehicleLabel ?? "The vehicle"} has ${route?.capacity ?? 0} seats and ${route?.riders ?? 0} riders already. An extra rider means someone may stand or wait for a second round.`}
        confirmLabel="Assign anyway"
        loading={assign.isPending}
      />
    </SidePanel>
  );
}

function ChangeModal({ rider, onClose }: { rider: TransportRider; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const routes = useQuery(transportQueries.routes(ctx));
  const [routeId, setRouteId] = useState(rider.routeId);
  const [stopId, setStopId] = useState(rider.stopId);
  const [direction, setDirection] = useState<TransportDirection>(rider.direction);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmFull, setConfirmFull] = useState(false);
  const m = useMutation({
    mutationFn: (allow: boolean) => transportApi.moveRider(ctx, rider.id, { routeId, stopId, direction, allowOverCapacity: allow }),
    onSuccess: (r) => {
      toast({ title: `${r.rider.name} moved to ${r.rider.routeCode} · ${r.rider.stopName}`, message: r.feeHead || undefined });
      void qc.invalidateQueries({ queryKey: ["transport"] });
      void qc.invalidateQueries({ queryKey: ["fees"] });
      onClose();
    },
    onError: (e) => {
      if (errorCode(e) === "CAPACITY_FULL") setConfirmFull(true);
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Change route for ${rider.name}`}
      description={`Now on ${rider.routeCode} from ${rider.stopName} (${formatRs(rider.monthlyFee)} a month).`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={m.isPending}
            onClick={() => {
              const e: Record<string, string> = {};
              if (!routeId) e.routeId = "Choose the route.";
              if (!stopId) e.stopId = "Choose the stop.";
              setErrors(e);
              if (!Object.keys(e).length) m.mutate(false);
            }}
          >
            Save change
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <RouteStopFields routes={routes.data ?? []} routeId={routeId} stopId={stopId} onRoute={setRouteId} onStop={setStopId} errors={errors} />
        <Select label="Uses the van" value={direction} onChange={(e) => setDirection(e.target.value as TransportDirection)} options={(["BOTH", "PICKUP", "DROP"] as const).map((d) => ({ value: d, label: TRANSPORT_DIRECTION_LABEL[d] }))} />
        {m.isError && errorCode(m.error) !== "CAPACITY_FULL" && (
          <div className="sm:col-span-2">
            <Banner tone="danger">{errorText(m.error)}</Banner>
          </div>
        )}
      </div>
      <ConfirmDialog open={confirmFull} onClose={() => setConfirmFull(false)} onConfirm={() => m.mutate(true)} tone="warning" title="The new route is full. Move anyway?" message={errorText(m.error)} confirmLabel="Move anyway" loading={m.isPending} />
    </Modal>
  );
}

function EndModal({ rider, onClose }: { rider: TransportRider; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const today = opsToday();
  const [toDate, setTo] = useState<string | null>(() => {
    const end = monthEnd(today);
    return end < rider.fromDate ? rider.fromDate : end;
  });
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => transportApi.endRider(ctx, rider.id, { toDate: toDate!, reason }),
    onSuccess: (r) => {
      toast({ title: r.toDate ? `${r.name} stops using transport after ${formatDate(r.toDate)}` : `${r.name} stops using transport`, message: r.type === "STUDENT" ? "Transport fees after that month are not charged; unpaid ones are cancelled." : undefined });
      void qc.invalidateQueries({ queryKey: ["transport"] });
      void qc.invalidateQueries({ queryKey: ["fees"] });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Stop transport for ${rider.name}?`}
      description={`${rider.routeCode} from ${rider.stopName}. The seat is freed after the last day.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            loading={m.isPending}
            onClick={() => {
              const e: Record<string, string> = {};
              if (!toDate) e.toDate = "Choose the last day.";
              else if (toDate < rider.fromDate) e.toDate = "The last day can't be before the first day.";
              if (reason.trim().length < 3) e.reason = "Say why, in a few words.";
              setErrors(e);
              if (!Object.keys(e).length) m.mutate();
            }}
          >
            Stop transport
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <DatePicker label="Last day on the van" value={toDate} onValueChange={setTo} today={today} minDate={rider.fromDate} error={errors.toDate} help={rider.type === "STUDENT" ? "The month of the last day is still charged." : undefined} />
        <Textarea label="Reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} error={errors.reason} placeholder="Family moved; parents will drop the child" />
        {m.isError && <Banner tone="danger">{errorText(m.error)}</Banner>}
      </div>
    </Modal>
  );
}

export function RidersPage({ assignOpen, setAssignOpen, routeId, setRouteId }: { assignOpen: boolean; setAssignOpen: (v: boolean) => void; routeId: string; setRouteId: (id: string) => void }) {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const canManage = useCan("transport.manage") && !readOnly;
  const [status, setStatus] = useState<"ACTIVE" | "ENDED" | "ALL">("ACTIVE");
  const [type, setType] = useState("");
  const [search, setSearch] = useState("");
  const [changing, setChanging] = useState<TransportRider | null>(null);
  const [ending, setEnding] = useState<TransportRider | null>(null);
  const q = useQuery(transportQueries.riders(ctx, { status, ...(routeId ? { routeId } : {}) }));
  const routes = useQuery(transportQueries.routes(ctx));
  const rows = (q.data ?? []).filter((r) => (!type || r.type === type) && (!search.trim() || `${r.name} ${r.personId} ${r.father} ${r.stopName}`.toLowerCase().includes(search.trim().toLowerCase())));
  const billed = rows.filter((r) => r.type === "STUDENT" && r.status === "ACTIVE").reduce((a, r) => a + r.monthlyFee, 0);
  const columns: Array<Column<TransportRider>> = [
    {
      key: "who",
      header: "Rider",
      render: (r) => (
        <span className="grid">
          {r.type === "STUDENT" ? (
            <Link to="/students/$grNo" params={{ grNo: r.personId }} className="font-medium text-brand-ink underline-offset-2 hover:underline">
              {r.name}
            </Link>
          ) : (
            <span className="font-medium">{r.name}</span>
          )}
          <span className="text-small text-ink-muted">
            {r.personId} · {detailLine(r)}
            {ctx.campus === "ALL" ? ` · ${campusLabel(r.campus)}` : ""}
          </span>
        </span>
      ),
    },
    { key: "route", header: "Route and stop", render: (r) => <span className="grid"><span>{r.routeCode} · {r.stopName}</span><span className="text-small text-ink-muted">Pickup {r.pickupTime} · drop {r.dropTime}</span></span> },
    { key: "dir", header: "Uses", render: (r) => <span className="text-small">{TRANSPORT_DIRECTION_LABEL[r.direction]}</span> },
    { key: "mobile", header: "Mobile", render: (r) => (r.mobile ? <span className="mtb-num text-small">{formatMobile(r.mobile)}</span> : <span className="text-ink-subtle">—</span>) },
    { key: "fee", header: "A month", align: "right", render: (r) => <span className="grid justify-items-end"><span className="mtb-num font-medium">{formatRs(r.monthlyFee)}</span><span className="text-small text-ink-muted">{r.feeLink === "BILLED" ? "With the fee" : "For payroll"}</span></span> },
    {
      key: "since",
      header: "Since",
      render: (r) =>
        r.toDate ? (
          <span className="grid">
            <StatusBadge status={r.status === "ENDED" ? "cancelled" : "warning"}>{r.status === "ENDED" ? `Stopped ${formatDate(r.toDate)}` : `Until ${formatDate(r.toDate)}`}</StatusBadge>
            {r.endReason && <span className="text-small text-ink-muted">{r.endReason}</span>}
          </span>
        ) : (
          <span className="mtb-num text-small">{formatDate(r.fromDate)}</span>
        ),
    },
    {
      key: "act",
      header: <span className="mtb-sr-only">Actions</span>,
      render: (r) =>
        canManage && r.status === "ACTIVE" && !r.toDate ? (
          <span className="flex justify-end gap-1">
            <Button size="sm" variant="quiet" onClick={() => setChanging(r)}>
              Change
            </Button>
            <Button size="sm" variant="quiet" onClick={() => setEnding(r)}>
              Stop
            </Button>
          </span>
        ) : null,
    },
  ];
  return (
    <TransportShell
      title="Students on transport"
      actions={
        canManage && ctx.campus !== "ALL" ? (
          <Button variant="primary" icon="plus" onClick={() => setAssignOpen(true)}>
            Assign to a route
          </Button>
        ) : undefined
      }
    >
      {q.isError && <LoadError what="Riders" error={q.error} onRetry={() => void q.refetch()} />}
      <DataTable
        caption="Students and staff on transport"
        rows={rows}
        loading={q.isLoading}
        columns={columns}
        toolbar={
          <div className="flex w-full flex-wrap items-end gap-3">
            <Segmented
              aria-label="Riders to show"
              value={status}
              onChange={(v) => setStatus(v as typeof status)}
              options={[
                { value: "ACTIVE", label: "Riding" },
                { value: "ENDED", label: "Stopped" },
                { value: "ALL", label: "All" },
              ]}
            />
            <Select label="Route" value={routeId} onChange={(e) => setRouteId(e.target.value)} options={[{ value: "", label: "All routes" }, ...(routes.data ?? []).map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` }))]} />
            <Select
              label="Rider"
              value={type}
              onChange={(e) => setType(e.target.value)}
              options={[
                { value: "", label: "Students and staff" },
                { value: "STUDENT", label: "Students" },
                { value: "STAFF", label: "Staff" },
              ]}
            />
            <div className="min-w-[200px] flex-1">
              <Input label="Search" icon="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, G.R. number, father or stop" />
            </div>
          </div>
        }
        footer={rows.length ? { who: <span className="font-semibold">{formatCount(rows.length)} riders</span>, fee: <span className="mtb-num font-semibold">{formatRs(billed)}</span> } : undefined}
        empty={<EmptyState icon="students" title={status === "ACTIVE" ? "Nobody on transport yet" : "No one matches"} description="Assign a student to a route and stop; the monthly fee goes to Fees." action={canManage && ctx.campus !== "ALL" ? <Button size="sm" variant="primary" icon="plus" onClick={() => setAssignOpen(true)}>Assign to a route</Button> : undefined} />}
      />
      <p className="m-0 flex items-center gap-2 text-small text-ink-muted">
        <Icon name="info" size={14} />
        Assigning a student adds the transport fee for the first month to their fee account and later months come with the fee voucher; changing the route re-prices unpaid months; stopping cancels months after the last day if they are unpaid. Staff are never charged in Fees.
      </p>
      <CampusNote />
      {assignOpen && (
        <RequireSingleCampusOverlay onClose={() => setAssignOpen(false)}>
          <AssignPanel onClose={() => setAssignOpen(false)} />
        </RequireSingleCampusOverlay>
      )}
      {changing && <ChangeModal rider={changing} onClose={() => setChanging(null)} />}
      {ending && <EndModal rider={ending} onClose={() => setEnding(null)} />}
    </TransportShell>
  );
}
