import { TRANSPORT_VEHICLE_TYPE_LABEL, transportApi, transportQueries, type TransportVehicle, type TransportVehicleInput, type TransportVehicleType } from "@mtb/api";
import { formatCount, formatMobile } from "@mtb/domain";
import { Banner, Button, DataTable, DatePicker, EmptyState, Input, Segmented, Select, SidePanel, StatusBadge, Switch, useToast, type Column } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import { CampusNote, errorField, errorText, LoadError, opsToday, RequireSingleCampusOverlay, validate } from "../library/common";
import { AlertBadge, DateDue, TransportShell } from "./shared";

const date = (what: string) => z.string({ error: `Enter the date the ${what} runs out.` }).regex(/^\d{4}-\d{2}-\d{2}$/, { error: `Enter the date the ${what} runs out.` });
const vehicleSchema = z
  .object({
    regNo: z.string().trim().toUpperCase().regex(/^[A-Z]{2,4}-\d{1,4}$/, { error: "Use the number plate format, for example RYK-2231." }),
    type: z.enum(["BUS", "COASTER", "HIACE", "VAN", "CAR"]),
    make: z.string().trim().min(2, { error: "Enter the make, for example Toyota." }),
    model: z.string().trim().min(1, { error: "Enter the model." }),
    year: z
      .number({ error: "Enter the model year, for example 2019." })
      .int({ error: "Enter the model year, for example 2019." })
      .min(1950, { error: "Enter the model year, for example 2019." })
      .refine((y) => y <= Number(opsToday().slice(0, 4)) + 1, { error: "Enter the model year, for example 2019." }),
    capacity: z.number({ error: "Enter the seats." }).int().min(2, { error: "Seats are 2 to 80." }).max(80, { error: "Seats are 2 to 80." }),
    ownership: z.enum(["OWNED", "CONTRACTED"]),
    contractor: z.string().trim(),
    driverName: z.string().trim().min(3, { error: "Enter the driver's name." }),
    driverMobile: z.string().refine((v) => /^03\d{9}$/.test(v.replace(/\D/g, "")), { error: "Enter the driver's mobile, for example 0301-2345678." }),
    licenceNo: z.string().trim().min(3, { error: "Enter the licence number." }),
    licenceExpiry: date("driver's licence"),
    conductorName: z.string().trim(),
    fitnessExpiry: date("fitness certificate"),
    insuranceExpiry: date("insurance"),
    permitExpiry: date("route permit"),
    odometer: z.number({ error: "Enter the meter reading in km." }).int().min(0),
    active: z.boolean(),
  })
  .refine((v) => v.ownership === "OWNED" || v.contractor.length >= 3, { error: "Enter the contractor's name.", path: ["contractor"] });

type Draft = Omit<TransportVehicleInput, "year" | "capacity" | "odometer"> & { year: string; capacity: string; odometer: string };

function VehicleForm({ v, onClose }: { v: TransportVehicle | null; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>({
    regNo: v?.regNo ?? "",
    type: v?.type ?? "HIACE",
    make: v?.make ?? "Toyota",
    model: v?.model ?? "",
    year: v ? String(v.year) : "",
    capacity: v ? String(v.capacity) : "",
    ownership: v?.ownership ?? "OWNED",
    contractor: v?.contractor ?? "",
    driverName: v?.driverName ?? "",
    driverMobile: v?.driverMobile ?? "",
    licenceNo: v?.licenceNo ?? "",
    licenceExpiry: v?.licenceExpiry ?? "",
    conductorName: v?.conductorName ?? "",
    fitnessExpiry: v?.fitnessExpiry ?? "",
    insuranceExpiry: v?.insuranceExpiry ?? "",
    permitExpiry: v?.permitExpiry ?? "",
    odometer: v ? String(v.odometer) : "",
    active: v?.active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: (body: TransportVehicleInput) => transportApi.saveVehicle(ctx, body, v?.id),
    onSuccess: (x) => {
      toast({ title: `${x.regNo} saved`, message: x.alerts.length ? `${x.alerts.length} papers due within 30 days.` : "All papers in date." });
      void qc.invalidateQueries({ queryKey: ["transport"] });
      onClose();
    },
    onError: (e) => {
      const f = errorField(e);
      if (f) setErrors({ [f]: errorText(e) });
    },
  });
  const num = (s: string) => (s.trim() === "" ? undefined : Number(s.replace(/\D/g, "")));
  const set = <K extends keyof Draft>(k: K, val: Draft[K]) => setD({ ...d, [k]: val });
  const today = opsToday();
  const dateField = (k: "licenceExpiry" | "fitnessExpiry" | "insuranceExpiry" | "permitExpiry", label: string) => <DatePicker label={label} value={d[k] || null} onValueChange={(x) => set(k, x ?? "")} today={today} error={errors[k]} />;
  return (
    <SidePanel
      open
      wide
      onClose={onClose}
      title={v ? v.regNo : "Add a vehicle"}
      description="Expiry dates feed the alerts on the transport overview."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={m.isPending}
            onClick={() => {
              const r = validate(vehicleSchema, { ...d, year: num(d.year), capacity: num(d.capacity), odometer: num(d.odometer) });
              if (!r.ok) return setErrors(r.errors);
              setErrors({});
              m.mutate(r.data);
            }}
          >
            Save vehicle
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <fieldset className="m-0 grid gap-4 border-0 p-0 sm:grid-cols-3">
          <legend className="mtb-label sm:col-span-3">Vehicle</legend>
          <Input label="Number plate" mono value={d.regNo} onChange={(e) => set("regNo", e.target.value.toUpperCase())} error={errors.regNo} placeholder="RYK-2231" />
          <Select label="Type" value={d.type} onChange={(e) => set("type", e.target.value as TransportVehicleType)} options={(Object.keys(TRANSPORT_VEHICLE_TYPE_LABEL) as TransportVehicleType[]).map((t) => ({ value: t, label: TRANSPORT_VEHICLE_TYPE_LABEL[t] }))} />
          <Input label="Seats" inputMode="numeric" value={d.capacity} onChange={(e) => set("capacity", e.target.value)} error={errors.capacity} help="Students it may carry." />
          <Input label="Make" value={d.make} onChange={(e) => set("make", e.target.value)} error={errors.make} list="trn-makes" />
          <Input label="Model" value={d.model} onChange={(e) => set("model", e.target.value)} error={errors.model} placeholder="Hiace" />
          <Input label="Model year" inputMode="numeric" value={d.year} onChange={(e) => set("year", e.target.value)} error={errors.year} />
          <Input label="Meter reading" suffix="km" inputMode="numeric" value={d.odometer} onChange={(e) => set("odometer", e.target.value)} error={errors.odometer} />
          <div className="sm:col-span-2 grid gap-2">
            <span className="mtb-label">Owned by</span>
            <Segmented
              aria-label="Owned by"
              value={d.ownership}
              onChange={(x) => set("ownership", x as "OWNED" | "CONTRACTED")}
              options={[
                { value: "OWNED", label: "The school" },
                { value: "CONTRACTED", label: "A contractor" },
              ]}
            />
          </div>
          {d.ownership === "CONTRACTED" && <Input label="Contractor" value={d.contractor} onChange={(e) => set("contractor", e.target.value)} error={errors.contractor} />}
        </fieldset>
        <datalist id="trn-makes">
          {["Toyota", "Suzuki", "Hino", "Isuzu", "Nissan", "Hyundai"].map((m2) => (
            <option key={m2} value={m2} />
          ))}
        </datalist>
        <fieldset className="m-0 grid gap-4 border-0 p-0 sm:grid-cols-3">
          <legend className="mtb-label sm:col-span-3">Driver</legend>
          <Input label="Driver" value={d.driverName} onChange={(e) => set("driverName", e.target.value)} error={errors.driverName} />
          <Input label="Driver's mobile" inputMode="tel" value={d.driverMobile} onChange={(e) => set("driverMobile", e.target.value)} error={errors.driverMobile} placeholder="0301-2345678" />
          <Input label="Conductor (optional)" value={d.conductorName} onChange={(e) => set("conductorName", e.target.value)} />
          <Input label="Licence number" mono value={d.licenceNo} onChange={(e) => set("licenceNo", e.target.value)} error={errors.licenceNo} />
          {dateField("licenceExpiry", "Licence valid until")}
        </fieldset>
        <fieldset className="m-0 grid gap-4 border-0 p-0 sm:grid-cols-3">
          <legend className="mtb-label sm:col-span-3">Papers</legend>
          {dateField("fitnessExpiry", "Fitness valid until")}
          {dateField("insuranceExpiry", "Insurance valid until")}
          {dateField("permitExpiry", "Route permit valid until")}
        </fieldset>
        {v && <Switch label="In service" checked={d.active} onChange={(e) => set("active", e.target.checked)} />}
        {m.isError && !errorField(m.error) && <Banner tone="danger">{errorText(m.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

export function VehiclesPage() {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const canManage = useCan("transport.manage") && !readOnly;
  const q = useQuery(transportQueries.vehicles(ctx));
  const [edit, setEdit] = useState<TransportVehicle | null | "new">(null);
  const [onlyAlerts, setOnlyAlerts] = useState(false);
  const today = opsToday();
  const rows = (q.data ?? []).filter((v) => !onlyAlerts || v.alerts.length > 0);
  const columns: Array<Column<TransportVehicle>> = [
    { key: "reg", header: "Vehicle", render: (v) => <span className="grid"><span className="mtb-mono font-medium">{v.regNo}</span><span className="text-small text-ink-muted">{[v.make, v.model, v.year].filter(Boolean).join(" ")} · {TRANSPORT_VEHICLE_TYPE_LABEL[v.type]}{v.ownership === "CONTRACTED" ? " · contracted" : ""}{ctx.campus === "ALL" ? ` · ${campusLabel(v.campus)}` : ""}</span></span> },
    { key: "seats", header: "Seats", align: "right", render: (v) => <span className="mtb-num">{v.riders} / {v.capacity}</span> },
    { key: "route", header: "Route", render: (v) => (v.routeCode ? <span className="grid"><span>{v.routeCode}</span><span className="text-small text-ink-muted">{v.routeName}</span></span> : <StatusBadge status="neutral">Spare</StatusBadge>) },
    { key: "driver", header: "Driver", render: (v) => <span className="grid"><span>{v.driverName || "—"}</span><span className="text-small text-ink-muted">{v.driverMobile ? formatMobile(v.driverMobile) : "—"}</span></span> },
    { key: "fit", header: "Fitness", render: (v) => <DateDue date={v.fitnessExpiry} today={today} /> },
    { key: "ins", header: "Insurance", render: (v) => <DateDue date={v.insuranceExpiry} today={today} /> },
    { key: "lic", header: "Licence", render: (v) => <DateDue date={v.licenceExpiry} today={today} /> },
    { key: "km", header: "Meter", align: "right", render: (v) => <span className="mtb-num text-small">{formatCount(v.odometer)} km</span> },
  ];
  const alerts = (q.data ?? []).flatMap((v) => v.alerts);
  return (
    <TransportShell
      title="Vehicles"
      actions={
        canManage && ctx.campus !== "ALL" ? (
          <Button variant="primary" icon="plus" onClick={() => setEdit("new")}>
            Add a vehicle
          </Button>
        ) : undefined
      }
    >
      {q.isError && <LoadError what="Vehicles" error={q.error} onRetry={() => void q.refetch()} />}
      {alerts.some((a) => a.days < 0) && (
        <Banner tone="danger" icon="alert" title="A vehicle is on the road with expired papers.">
          <span className="flex flex-wrap gap-2">
            {alerts
              .filter((a) => a.days < 0)
              .map((a) => (
                <span key={`${a.vehicleId}${a.kind}`} className="flex items-center gap-2">
                  <span className="mtb-mono">{a.regNo}</span>
                  <AlertBadge a={a} />
                </span>
              ))}
          </span>
        </Banner>
      )}
      <DataTable
        caption="School vehicles"
        rows={rows}
        loading={q.isLoading}
        columns={columns}
        onRowClick={canManage ? (v) => setEdit(v) : undefined}
        rowClassName={(v) => (v.alerts.some((a) => a.days < 0) ? "bg-status-overdue-tint" : undefined)}
        toolbar={
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <Switch label="Only vehicles with papers due" checked={onlyAlerts} onChange={(e) => setOnlyAlerts(e.target.checked)} />
            <span className="text-small text-ink-muted">{alerts.length} papers expire within 30 days</span>
          </div>
        }
        empty={<EmptyState icon="key" title={onlyAlerts ? "No papers due" : "No vehicles yet"} />}
      />
      <CampusNote />
      {edit && (
        <RequireSingleCampusOverlay onClose={() => setEdit(null)}>
          <VehicleForm v={edit === "new" ? null : edit} onClose={() => setEdit(null)} />
        </RequireSingleCampusOverlay>
      )}
    </TransportShell>
  );
}
