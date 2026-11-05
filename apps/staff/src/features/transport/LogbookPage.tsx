import { transportApi, transportQueries, type TransportFuel, type TransportTrip, type TransportVehicle } from "@mtb/api";
import { formatCount, formatDate, formatRs } from "@mtb/domain";
import { AmountInput, AnimatedNumber, Banner, Button, DataTable, DatePicker, EmptyState, Input, Modal, Segmented, Select, StatCard, TabPanel, Tabs, Textarea, useToast, type Column } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import { addDays, CampusNote, errorField, errorText, LoadError, RequireSingleCampusOverlay, slide, TODAY } from "../library/common";
import { TransportShell } from "./shared";

const n = (s: string) => (s.trim() === "" ? null : Number(s.replace(/[^\d.]/g, "")));
const hhmm = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

function TripModal({ vehicles, onClose }: { vehicles: TransportVehicle[]; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const [vehicleId, setVehicleId] = useState("");
  const v = vehicles.find((x) => x.id === vehicleId);
  const [date, setDate] = useState<string | null>(TODAY);
  const [direction, setDirection] = useState<"PICKUP" | "DROP" | "OTHER">("PICKUP");
  const [purpose, setPurpose] = useState("");
  const [departAt, setDepart] = useState("06:45");
  const [arriveAt, setArrive] = useState("07:50");
  const [startKm, setStart] = useState("");
  const [endKm, setEnd] = useState("");
  const [riders, setRiders] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => transportApi.addTrip(ctx, { date: date!, vehicleId, routeId: direction === "OTHER" ? null : (v?.routeId ?? null), direction, purpose, driverName: v?.driverName ?? "", departAt, arriveAt, startKm: n(startKm)!, endKm: n(endKm)!, ridersPresent: n(riders) ?? 0, note }),
    onSuccess: (t) => {
      toast({ title: `Trip logged for ${t.regNo}`, message: `${t.endKm - t.startKm} km · ${t.ridersPresent} on board.` });
      void qc.invalidateQueries({ queryKey: ["transport"] });
      onClose();
    },
    onError: (e) => {
      const f = errorField(e);
      if (f) setErrors({ [f]: errorText(e) });
    },
  });
  const submit = () => {
    const e: Record<string, string> = {};
    if (!v) e.vehicleId = "Choose the vehicle.";
    if (!date) e.date = "Enter the date.";
    if (!hhmm(departAt)) e.departAt = "Use 24-hour time, for example 06:45.";
    if (!hhmm(arriveAt) || arriveAt <= departAt) e.arriveAt = "Arrival must be after departure.";
    const s = n(startKm);
    const en = n(endKm);
    if (s === null) e.startKm = "Enter the meter reading when it left.";
    if (en === null || (s !== null && en < s)) e.endKm = "The reading at the end can't be less than at the start.";
    if (direction === "OTHER" && purpose.trim().length < 3) e.purpose = "Say what the trip was for.";
    if (v && (n(riders) ?? 0) > v.capacity) e.ridersPresent = `${v.regNo} has ${v.capacity} seats.`;
    setErrors(e);
    if (!Object.keys(e).length) m.mutate();
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Log a trip"
      description="The old Tours screen: one row per run, with the meter readings and how many were on board."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} onClick={submit}>
            Save trip
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Segmented
          aria-label="Trip"
          value={direction}
          onChange={(x) => setDirection(x as typeof direction)}
          options={[
            { value: "PICKUP", label: "Morning pickup" },
            { value: "DROP", label: "Afternoon drop" },
            { value: "OTHER", label: "Other trip" },
          ]}
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <Select
            label="Vehicle"
            value={vehicleId}
            onChange={(e) => {
              setVehicleId(e.target.value);
              const nv = vehicles.find((x) => x.id === e.target.value);
              if (nv) setStart(String(nv.odometer));
            }}
            error={errors.vehicleId}
            options={[{ value: "", label: "Choose…" }, ...vehicles.filter((x) => x.active).map((x) => ({ value: x.id, label: `${x.regNo}${x.routeCode ? ` · ${x.routeCode}` : ""}` }))]}
          />
          <DatePicker label="Date" value={date} onValueChange={setDate} maxDate={TODAY} today={TODAY} error={errors.date} />
          <Input label="On board" inputMode="numeric" value={riders} onChange={(e) => setRiders(e.target.value)} error={errors.ridersPresent} />
          {direction === "OTHER" && (
            <div className="sm:col-span-3">
              <Input label="What for" value={purpose} onChange={(e) => setPurpose(e.target.value)} error={errors.purpose} placeholder="Science fair visit, Rahim Yar Khan" />
            </div>
          )}
          <Input label="Left at" mono value={departAt} onChange={(e) => setDepart(e.target.value)} error={errors.departAt} />
          <Input label="Arrived at" mono value={arriveAt} onChange={(e) => setArrive(e.target.value)} error={errors.arriveAt} />
          <span />
          <Input label="Meter at start" suffix="km" inputMode="numeric" value={startKm} onChange={(e) => setStart(e.target.value)} error={errors.startKm} />
          <Input label="Meter at end" suffix="km" inputMode="numeric" value={endKm} onChange={(e) => setEnd(e.target.value)} error={errors.endKm} help={n(startKm) !== null && n(endKm) !== null && n(endKm)! >= n(startKm)! ? `${n(endKm)! - n(startKm)!} km` : undefined} />
        </div>
        <Textarea label="Note (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        {v && <span className="text-small text-ink-muted">Driver: {v.driverName}{v.routeName ? ` · ${v.routeCode} ${v.routeName}` : ""}</span>}
        {m.isError && !errorField(m.error) && <Banner tone="danger">{errorText(m.error)}</Banner>}
      </div>
    </Modal>
  );
}

function FuelModal({ vehicles, fuel, onClose }: { vehicles: TransportVehicle[]; fuel: TransportFuel[]; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const [vehicleId, setVehicleId] = useState("");
  const [date, setDate] = useState<string | null>(TODAY);
  const [litres, setLitres] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [odometer, setOdo] = useState("");
  const [station, setStation] = useState("PSO, Bypass Road");
  const [slipNo, setSlip] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const last = fuel.find((f) => f.vehicleId === vehicleId);
  const m = useMutation({
    mutationFn: () => transportApi.addFuel(ctx, { date: date!, vehicleId, litres: n(litres)!, amount: amount!, odometer: n(odometer)!, station, slipNo }),
    onSuccess: (f) => {
      toast({ title: `Fuel recorded for ${f.regNo}`, message: f.kmPerLitre ? `${f.kmSinceLast} km since the last fill · ${f.kmPerLitre} km a litre.` : undefined });
      void qc.invalidateQueries({ queryKey: ["transport"] });
      onClose();
    },
    onError: (e) => {
      const f = errorField(e);
      if (f) setErrors({ [f]: errorText(e) });
    },
  });
  const submit = () => {
    const e: Record<string, string> = {};
    if (!vehicleId) e.vehicleId = "Choose the vehicle.";
    if (!date) e.date = "Enter the date.";
    const l = n(litres);
    if (l === null || l <= 0) e.litres = "Enter the litres filled.";
    if (amount === null || amount <= 0) e.amount = "Enter the amount paid.";
    const o = n(odometer);
    if (o === null) e.odometer = "Enter the meter reading.";
    else if (last && o <= last.odometer) e.odometer = `The last fill-up was at ${formatCount(last.odometer)} km.`;
    if (slipNo.trim().length < 2) e.slipNo = "Enter the pump slip number.";
    setErrors(e);
    if (!Object.keys(e).length) m.mutate();
  };
  const rate = n(litres) && amount ? Math.round(amount / n(litres)!) : null;
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Record fuel"
      description="From the pump slip. The meter reading works out kilometres per litre, so an unusual fill stands out."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Select label="Vehicle" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} error={errors.vehicleId} options={[{ value: "", label: "Choose…" }, ...vehicles.filter((x) => x.active).map((x) => ({ value: x.id, label: x.regNo }))]} />
        <DatePicker label="Date" value={date} onValueChange={setDate} maxDate={TODAY} minDate={addDays(TODAY, -60)} today={TODAY} error={errors.date} />
        <Input label="Slip number" mono value={slipNo} onChange={(e) => setSlip(e.target.value)} error={errors.slipNo} />
        <Input label="Litres" inputMode="decimal" value={litres} onChange={(e) => setLitres(e.target.value)} error={errors.litres} />
        <AmountInput label="Amount paid" value={amount} onValueChange={setAmount} error={errors.amount} help={rate ? `${formatRs(rate)} a litre` : undefined} />
        <Input label="Meter reading" suffix="km" inputMode="numeric" value={odometer} onChange={(e) => setOdo(e.target.value)} error={errors.odometer} help={last ? `Last fill at ${formatCount(last.odometer)} km on ${formatDate(last.date)}` : undefined} />
        <div className="sm:col-span-3">
          <Input label="Petrol pump" value={station} onChange={(e) => setStation(e.target.value)} />
        </div>
        {m.isError && !errorField(m.error) && (
          <div className="sm:col-span-3">
            <Banner tone="danger">{errorText(m.error)}</Banner>
          </div>
        )}
      </div>
    </Modal>
  );
}

export function LogbookPage() {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const canManage = useCan("transport.manage") && !readOnly;
  const trips = useQuery(transportQueries.trips(ctx));
  const fuel = useQuery(transportQueries.fuel(ctx));
  const vehicles = useQuery(transportQueries.vehicles(ctx));
  const [tab, setTab] = useState("trips");
  const [vehicleId, setVehicleId] = useState("");
  const [adding, setAdding] = useState<"trip" | "fuel" | null>(null);
  const weekAgo = addDays(TODAY, -7);
  const tripRows = (trips.data ?? []).filter((t) => !vehicleId || t.vehicleId === vehicleId);
  const fuelRows = (fuel.data ?? []).filter((f) => !vehicleId || f.vehicleId === vehicleId);
  const kmWeek = (trips.data ?? []).filter((t) => t.date > weekAgo).reduce((a, t) => a + (t.endKm - t.startKm), 0);
  const fuel30 = (fuel.data ?? []).filter((f) => f.date > addDays(TODAY, -30));
  const kml = fuelRows.filter((f) => f.kmPerLitre !== null);
  const avgKml = kml.length ? Math.round((kml.reduce((a, f) => a + f.kmPerLitre!, 0) / kml.length) * 10) / 10 : 0;

  const tripCols: Array<Column<TransportTrip>> = [
    { key: "date", header: "Date", render: (t) => <span className="mtb-num">{formatDate(t.date)}</span> },
    { key: "veh", header: "Vehicle", render: (t) => <span className="grid"><span className="mtb-mono">{t.regNo}</span><span className="text-small text-ink-muted">{t.routeCode || "—"}{ctx.campus === "ALL" ? ` · ${campusLabel(t.campus)}` : ""}</span></span> },
    { key: "what", header: "Trip", render: (t) => <span className="grid"><span>{t.purpose}</span>{t.note && <span className="text-small text-ink-muted">{t.note}</span>}</span> },
    { key: "time", header: "Time", render: (t) => <span className="mtb-num text-small">{t.departAt}–{t.arriveAt}</span> },
    { key: "km", header: "Km", align: "right", render: (t) => <span className="mtb-num">{formatCount(t.endKm - t.startKm)}</span> },
    { key: "on", header: "On board", align: "right", render: (t) => <span className="mtb-num">{t.ridersPresent}</span> },
    { key: "driver", header: "Driver", render: (t) => <span className="text-small">{t.driverName}</span> },
  ];
  const fuelCols: Array<Column<TransportFuel>> = [
    { key: "date", header: "Date", render: (f) => <span className="mtb-num">{formatDate(f.date)}</span> },
    { key: "veh", header: "Vehicle", render: (f) => <span className="mtb-mono">{f.regNo}</span> },
    { key: "litres", header: "Litres", align: "right", render: (f) => <span className="mtb-num">{f.litres}</span> },
    { key: "amount", header: "Amount", align: "right", render: (f) => <span className="grid justify-items-end"><span className="mtb-num font-medium">{formatRs(f.amount)}</span><span className="text-small text-ink-muted">{formatRs(Math.round(f.amount / f.litres))} a litre</span></span> },
    { key: "odo", header: "Meter", align: "right", render: (f) => <span className="mtb-num text-small">{formatCount(f.odometer)} km</span> },
    { key: "kml", header: "Km a litre", align: "right", render: (f) => (f.kmPerLitre === null ? <span className="text-ink-subtle">—</span> : <span className={`mtb-num ${avgKml && f.kmPerLitre < avgKml * 0.75 ? "font-semibold text-status-overdue-ink" : ""}`}>{f.kmPerLitre}</span>) },
    { key: "slip", header: "Pump and slip", render: (f) => <span className="grid"><span className="text-small">{f.station}</span><span className="text-small text-ink-muted">Slip {f.slipNo} · {f.enteredBy}</span></span> },
  ];
  return (
    <TransportShell
      title="Trips and fuel"
      actions={
        canManage && ctx.campus !== "ALL" ? (
          <>
            <Button icon="fees" onClick={() => setAdding("fuel")}>
              Record fuel
            </Button>
            <Button variant="primary" icon="plus" onClick={() => setAdding("trip")}>
              Log a trip
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Trips in the last 7 days", value: (trips.data ?? []).filter((t) => t.date > weekAgo).length, icon: "clock" as const, foot: `${formatCount(kmWeek)} km driven` },
          { label: "Fuel in the last 30 days", value: fuel30.reduce((a, f) => a + f.amount, 0), money: true, icon: "fees" as const, foot: `${formatCount(Math.round(fuel30.reduce((a, f) => a + f.litres, 0)))} litres` },
          { label: "Average km a litre", value: avgKml, icon: "trendUp" as const, foot: "A fill far below this is shown in red", decimal: true },
          { label: "Fill-ups recorded", value: fuelRows.length, icon: "receipt" as const, foot: "This session" },
        ].map((k, i) => (
          <div key={k.label} className="mtb-rise" style={slide(i)}>
            <StatCard loading={trips.isLoading || fuel.isLoading} label={k.label} icon={k.icon} value={<AnimatedNumber value={k.value} format={k.money ? formatRs : k.decimal ? (v) => v.toFixed(1) : formatCount} />} foot={k.foot} />
          </div>
        ))}
      </div>
      {(trips.isError || fuel.isError) && <LoadError what="The logbook" error={trips.error ?? fuel.error} onRetry={() => { void trips.refetch(); void fuel.refetch(); }} />}
      <Tabs
        aria-label="Logbook"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "trips", label: "Trips", icon: "clock", count: tripRows.length },
          { id: "fuel", label: "Fuel", icon: "fees", count: fuelRows.length },
        ]}
      />
      <div className="flex flex-wrap items-end gap-3">
        <Select label="Vehicle" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} options={[{ value: "", label: "All vehicles" }, ...(vehicles.data ?? []).map((v) => ({ value: v.id, label: `${v.regNo}${v.routeCode ? ` · ${v.routeCode}` : ""}` }))]} />
      </div>
      <TabPanel id="trips" active={tab === "trips"}>
        <DataTable caption="Trips" rows={tripRows} loading={trips.isLoading} columns={tripCols} density="dense" maxHeight={560} empty={<EmptyState icon="clock" title="No trips logged" />} />
      </TabPanel>
      <TabPanel id="fuel" active={tab === "fuel"}>
        <DataTable caption="Fuel" rows={fuelRows} loading={fuel.isLoading} columns={fuelCols} density="dense" maxHeight={560} empty={<EmptyState icon="fees" title="No fuel recorded" />} />
      </TabPanel>
      <CampusNote />
      {adding && (
        <RequireSingleCampusOverlay onClose={() => setAdding(null)}>
          {adding === "trip" ? <TripModal vehicles={vehicles.data ?? []} onClose={() => setAdding(null)} /> : <FuelModal vehicles={vehicles.data ?? []} fuel={fuel.data ?? []} onClose={() => setAdding(null)} />}
        </RequireSingleCampusOverlay>
      )}
    </TransportShell>
  );
}
