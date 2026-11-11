import { TRANSPORT_DIRECTION_LABEL, transportApi, transportQueries, type TransportRoute, type TransportRouteSheet } from "@mtb/api";
import { formatMobile, formatRs } from "@mtb/domain";
import { AmountInput, Banner, Button, EmptyState, IconButton, Input, Panel, Select, SidePanel, Skeleton, StatusBadge, Switch, useToast } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import { CampusNote, DocHead, errorField, errorText, LoadError, RequireSingleCampusOverlay, usePrinter, validate } from "../library/common";
import { Load, TransportShell } from "./shared";

/* ---------------------------------------------------------------- Route sheet (A4) */

function RouteSheet({ s }: { s: TransportRouteSheet }) {
  const v = s.vehicle;
  return (
    <div className="ops-doc">
      <DocHead title={`Route sheet ${s.route.code} · ${s.route.name}`} subtitle={`${s.route.riders} riders · ${s.route.stops.length} stops`} campus={s.campusName} />
      <dl className="ops-doc-kv">
        <dt>Vehicle</dt>
        <dd>{v ? `${v.regNo} · ${v.make} ${v.model} · ${v.capacity} seats` : "None"}</dd>
        <dt>Driver</dt>
        <dd>{v ? [v.driverName, v.driverMobile ? formatMobile(v.driverMobile) : ""].filter(Boolean).join(" · ") || "—" : "—"}</dd>
        <dt>Conductor</dt>
        <dd>{v?.conductorName || "—"}</dd>
        <dt>Fare</dt>
        <dd>{formatRs(s.route.fare)} a month</dd>
      </dl>
      {s.stops.map(({ stop, riders }) => (
        <section key={stop.id}>
          <h2>
            {stop.name} · pickup {stop.pickupTime} · drop {stop.dropTime}
          </h2>
          {riders.length === 0 ? (
            <p>No riders at this stop.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Class</th>
                  <th>Father or guardian</th>
                  <th>Mobile</th>
                  <th>Uses</th>
                  <th>Morning</th>
                  <th>Afternoon</th>
                </tr>
              </thead>
              <tbody>
                {riders.map((r, i) => (
                  <tr key={r.id}>
                    <td>{i + 1}</td>
                    <td>{r.name}</td>
                    <td>{r.detail || "—"}</td>
                    <td>{r.father || "—"}</td>
                    <td>{r.mobile ? formatMobile(r.mobile) : "—"}</td>
                    <td>{TRANSPORT_DIRECTION_LABEL[r.direction]}</td>
                    <td />
                    <td />
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
      <div className="ops-doc-sign">
        <div>Driver</div>
        <div>Transport in-charge</div>
        <div>Principal</div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Route form */

interface StopDraft {
  id?: string;
  name: string;
  pickupTime: string;
  dropTime: string;
  fare: number | null;
}

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: "Use 24-hour time, for example 07:05." });
const routeSchema = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9-]{2,8}$/, { error: "Use a short code such as R-10." }),
  name: z.string().trim().min(3, { error: "Name the route by the areas it covers." }),
  vehicleId: z.string().nullable(),
  fare: z.number({ error: "Enter the monthly fare." }).int().min(0),
  active: z.boolean(),
  stops: z.array(z.object({ id: z.string().optional(), name: z.string().trim().min(2, { error: "Enter the stop name." }), pickupTime: time, dropTime: time, fare: z.number().int().min(0).nullable() })).min(1, { error: "Add at least one stop." }),
});

function RouteForm({ route, onClose }: { route: TransportRoute | null; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const vehicles = useQuery(transportQueries.vehicles(ctx));
  const [code, setCode] = useState(route?.code ?? "");
  const [name, setName] = useState(route?.name ?? "");
  const [vehicleId, setVehicleId] = useState(route?.vehicleId ?? "");
  const [fare, setFare] = useState<number | null>(route?.fare ?? null);
  const [active, setActive] = useState(route?.active ?? true);
  const [stops, setStops] = useState<StopDraft[]>(route?.stops.map((s) => ({ id: s.id, name: s.name, pickupTime: s.pickupTime, dropTime: s.dropTime, fare: s.fare })) ?? [{ name: "", pickupTime: "07:00", dropTime: "13:45", fare: null }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: (body: z.infer<typeof routeSchema>) => transportApi.saveRoute(ctx, body, route?.id),
    onSuccess: (r) => {
      toast({ title: `Route ${r.code} saved`, message: `${r.stops.length} stops · ${r.vehicleLabel}` });
      void qc.invalidateQueries({ queryKey: ["transport"] });
      onClose();
    },
    onError: (e) => {
      const f = errorField(e);
      if (f) setErrors({ [f]: errorText(e) });
    },
  });
  const setStop = (i: number, patch: Partial<StopDraft>) => setStops(stops.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= stops.length) return;
    const next = [...stops];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setStops(next);
  };
  // Vehicles in service not running another route, plus the route's own vehicle even when it is out of service.
  const free = (vehicles.data ?? []).filter((v) => (v.active && (!v.routeId || v.routeId === route?.id)) || (route?.vehicleId != null && v.id === route.vehicleId));
  return (
    <SidePanel
      open
      wide
      onClose={onClose}
      title={route ? `Route ${route.code}` : "Add a route"}
      description="Stops in the order the van reaches them in the morning."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={m.isPending}
            onClick={() => {
              const r = validate(routeSchema, { code, name, vehicleId: vehicleId || null, fare: fare ?? undefined, active, stops });
              if (!r.ok) return setErrors(r.errors);
              setErrors({});
              m.mutate({ ...r.data, code: r.data.code.toUpperCase() });
            }}
          >
            Save route
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Code" value={code} onChange={(e) => setCode(e.target.value)} error={errors.code} placeholder="R-10" />
          <div className="sm:col-span-2">
            <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} placeholder="Model Town – Satellite Town" />
          </div>
          <Select label="Vehicle" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} error={errors.vehicleId} options={[{ value: "", label: "No vehicle yet" }, ...free.map((v) => ({ value: v.id, label: `${v.regNo} · ${v.make} ${v.model} (${v.capacity} seats)` }))]} help="Only vehicles not running another route." />
          <AmountInput label="Monthly fare" value={fare} onValueChange={setFare} error={errors.fare} help="A stop can have its own fare." />
          <div className="pt-7">
            <Switch label="Route in use" checked={active} onChange={(e) => setActive(e.target.checked)} />
          </div>
        </div>
        <fieldset className="m-0 grid gap-3 border-0 p-0">
          <legend className="mtb-label">Stops</legend>
          {stops.map((s, i) => (
            <div key={s.id ?? `new-${i}`} className="grid items-start gap-2 rounded-md border border-border p-3 sm:grid-cols-[minmax(0,1fr)_90px_90px_130px_auto]">
              <Input label={`Stop ${i + 1}`} value={s.name} onChange={(e) => setStop(i, { name: e.target.value })} error={errors[`stops.${i}.name`]} />
              <Input label="Pickup" mono value={s.pickupTime} onChange={(e) => setStop(i, { pickupTime: e.target.value })} error={errors[`stops.${i}.pickupTime`]} />
              <Input label="Drop" mono value={s.dropTime} onChange={(e) => setStop(i, { dropTime: e.target.value })} error={errors[`stops.${i}.dropTime`]} />
              <AmountInput label="Own fare" value={s.fare} onValueChange={(v) => setStop(i, { fare: v })} placeholder="Route fare" />
              <div className="flex gap-1 pt-7">
                <IconButton icon="arrowUp" size="sm" label="Move up" disabled={i === 0} onClick={() => move(i, -1)} />
                <IconButton icon="arrowDown" size="sm" label="Move down" disabled={i === stops.length - 1} onClick={() => move(i, 1)} />
                <IconButton icon="trash" size="sm" label={`Remove stop ${i + 1}`} disabled={stops.length === 1} onClick={() => setStops(stops.filter((_, k) => k !== i))} />
              </div>
            </div>
          ))}
          <div>
            <Button size="sm" icon="plus" onClick={() => setStops([...stops, { name: "", pickupTime: stops[stops.length - 1]?.pickupTime ?? "07:00", dropTime: stops[stops.length - 1]?.dropTime ?? "13:45", fare: null }])}>
              Add a stop
            </Button>
          </div>
          {(errors.stops || errors.active) && <Banner tone="danger">{errors.stops ?? errors.active}</Banner>}
        </fieldset>
        {m.isError && !errorField(m.error) && <Banner tone="danger">{errorText(m.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

/* ---------------------------------------------------------------- Page */

export function RoutesPage() {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const canManage = useCan("transport.manage") && !readOnly;
  const q = useQuery(transportQueries.routes(ctx));
  const sheets = useQuery(transportQueries.sheets(ctx));
  const [edit, setEdit] = useState<TransportRoute | null | "new">(null);
  const printer = usePrinter();
  const printSheets = (only?: string) => {
    const list = (sheets.data ?? []).filter((s) => !only || s.route.id === only);
    if (list.length) printer.print(<>{list.map((s) => <RouteSheet key={s.route.id} s={s} />)}</>, "A4");
  };
  const routes = q.data ?? [];
  return (
    <TransportShell
      title="Routes and stops"
      actions={
        <>
          <Button icon="printer" disabled={!sheets.data?.length} onClick={() => printSheets()}>
            Print all route sheets
          </Button>
          {canManage && ctx.campus !== "ALL" && (
            <Button variant="primary" icon="plus" onClick={() => setEdit("new")}>
              Add a route
            </Button>
          )}
        </>
      }
    >
      {q.isError && <LoadError what="Routes" error={q.error} onRetry={() => void q.refetch()} />}
      {q.isLoading ? (
        <Skeleton height={320} />
      ) : routes.length === 0 ? (
        <div className="mtb-card">
          <EmptyState icon="mapPin" title="No routes yet" description="Add a route with its stops, then assign a vehicle and students." />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {routes.map((r, i) => (
            <Panel
              key={r.id}
              id={`route-${r.id}`}
              rise={i}
              title={`${r.code} · ${r.name}`}
              description={`${r.vehicleLabel}${r.driverName ? ` · ${r.driverName}` : ""}${ctx.campus === "ALL" ? ` · ${campusLabel(r.campus)}` : ""}`}
              actions={
                <>
                  {!r.active && <StatusBadge status="neutral">Not in use</StatusBadge>}
                  <IconButton icon="printer" size="sm" label={`Print route sheet for ${r.code}`} onClick={() => printSheets(r.id)} disabled={!sheets.data} />
                  {canManage && ctx.campus !== "ALL" && <IconButton icon="edit" size="sm" label={`Edit ${r.code}`} onClick={() => setEdit(r)} />}
                </>
              }
            >
              <div className="grid gap-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <Load r={r} />
                  <span className="text-right">
                    <span className="block text-small text-ink-muted">Monthly fare</span>
                    <span className="mtb-num font-semibold">{formatRs(r.fare)}</span>
                  </span>
                </div>
                <ol className="ops-stops" aria-label={`Stops on ${r.code}`}>
                  {r.stops.map((s) => (
                    <li key={s.id}>
                      <span className="mtb-num text-small text-ink-muted">{s.pickupTime}</span>
                      <span className="dot" aria-hidden="true" />
                      <span className="grid min-w-0">
                        <span className="truncate">{s.name}</span>
                        <span className="text-small text-ink-muted">
                          Drop {s.dropTime}
                          {s.fare !== null ? ` · ${formatRs(s.fare)} a month` : ""}
                        </span>
                      </span>
                      <span className="mtb-num text-small text-ink-muted">{s.riders} riders</span>
                    </li>
                  ))}
                </ol>
                <Link to="/transport/riders" search={{ route: r.id } as never} className="text-small font-medium text-brand-ink underline-offset-2 hover:underline">
                  See who rides {r.code}
                </Link>
              </div>
            </Panel>
          ))}
        </div>
      )}
      <CampusNote />
      {edit && (
        <RequireSingleCampusOverlay onClose={() => setEdit(null)}>
          <RouteForm route={edit === "new" ? null : edit} onClose={() => setEdit(null)} />
        </RequireSingleCampusOverlay>
      )}
      {printer.element}
    </TransportShell>
  );
}
