// Transport (/api/transport/*: overview, vehicles, routes and stops, route sheets, riders with their assign / move / end,
// trips and fuel) is real since module 11c: its requests fall through to the backend, and the transport fee reaches Fees
// through module 6's own charges. This file keeps only the fictional transport the report centre's transport reports
// still read (handlers/reports.ts) until module 13 makes the reports real. No routes and nothing here writes.
import type { CampusCode, TransportAlert, TransportFuel, TransportRider, TransportRoute, TransportTrip, TransportVehicle } from "@mtb/api";
import { daysBetween, type IsoDate } from "@mtb/domain";
import { DEMO_TODAY } from "../clock";
import { createStore } from "../db";
import { addDays, initialTransport, type TrnRiderRec } from "../fixtures/operations";
import { personOf } from "./library-model";

const trnStore = createStore("operations.transport", initialTransport);

const TODAY = DEMO_TODAY;
const sessionStart = (s: number): IsoDate => `${s}-04-01`;
const sessionEnd = (s: number): IsoDate => `${s + 1}-03-31`;
const inSession = (d: IsoDate, s: number) => d >= sessionStart(s) && d <= sessionEnd(s);

type Trn = ReturnType<typeof trnStore.get>;

const riderActive = (r: TrnRiderRec, on: IsoDate = TODAY) => r.fromDate <= addDays(on, 60) && (r.toDate === null || r.toDate >= on);
const activeRiders = (trn: Trn, routeId: string) => trn.riders.filter((r) => r.routeId === routeId && riderActive(r));

function alertsOf(v: Trn["vehicles"][number]): TransportAlert[] {
  const docs: Array<[TransportAlert["kind"], IsoDate]> = [
    ["FITNESS", v.fitnessExpiry],
    ["INSURANCE", v.insuranceExpiry],
    ["LICENCE", v.licenceExpiry],
    ["PERMIT", v.permitExpiry],
  ];
  return docs.map(([kind, expiresOn]) => ({ vehicleId: v.id, regNo: v.regNo, kind, expiresOn, days: daysBetween(TODAY, expiresOn) })).filter((a) => a.days <= 30);
}

function vehicleView(trn: Trn, v: Trn["vehicles"][number]): TransportVehicle {
  const route = trn.routes.find((r) => r.vehicleId === v.id && r.active);
  return { ...v, routeId: route?.id ?? null, routeCode: route?.code ?? null, routeName: route?.name ?? null, riders: route ? activeRiders(trn, route.id).length : 0, alerts: alertsOf(v) };
}

function routeView(trn: Trn, r: Trn["routes"][number]): TransportRoute {
  const v = r.vehicleId ? trn.vehicles.find((x) => x.id === r.vehicleId) : undefined;
  const riders = activeRiders(trn, r.id);
  return {
    id: r.id,
    campus: r.campus,
    code: r.code,
    name: r.name,
    vehicleId: v?.id ?? null,
    vehicleRegNo: v?.regNo ?? "",
    vehicleLabel: v ? `${v.make} ${v.model} · ${v.regNo}` : "No vehicle",
    capacity: v?.capacity ?? 0,
    riders: riders.length,
    fare: r.fare,
    stops: r.stops.map((s) => ({ ...s, riders: riders.filter((x) => x.stopId === s.id).length })),
    driverName: v?.driverName ?? "",
    driverMobile: v?.driverMobile ?? "",
    active: r.active,
  };
}

function riderView(trn: Trn, r: TrnRiderRec): TransportRider {
  const p = personOf(r.type, r.personId);
  const route = trn.routes.find((x) => x.id === r.routeId)!;
  const stop = route.stops.find((s) => s.id === r.stopId) ?? route.stops[0]!;
  return {
    id: r.id,
    campus: r.campus,
    type: r.type,
    personId: r.personId,
    name: p?.name ?? r.personId,
    detail: p?.detail ?? "",
    father: p?.father ?? "",
    mobile: p?.mobile ?? "",
    routeId: route.id,
    routeCode: route.code,
    routeName: route.name,
    stopId: stop.id,
    stopName: stop.name,
    pickupTime: stop.pickupTime,
    dropTime: stop.dropTime,
    direction: r.direction,
    fromDate: r.fromDate,
    toDate: r.toDate,
    monthlyFee: stop.fare ?? route.fare,
    feeLink: r.type === "STUDENT" ? "BILLED" : "PAYROLL",
    status: riderActive(r) ? "ACTIVE" : "ENDED",
    endReason: r.endReason,
  };
}

function tripView(trn: Trn, t: Trn["trips"][number]): TransportTrip {
  const v = trn.vehicles.find((x) => x.id === t.vehicleId);
  const r = t.routeId ? trn.routes.find((x) => x.id === t.routeId) : undefined;
  return { ...t, regNo: v?.regNo ?? "", routeCode: r?.code ?? "" };
}

function fuelViews(trn: Trn, campuses: CampusCode[], session: number): TransportFuel[] {
  const rows = trn.fuel.filter((f) => campuses.includes(f.campus)).sort((a, b) => a.date.localeCompare(b.date) || a.odometer - b.odometer);
  const last = new Map<string, number>();
  const out: TransportFuel[] = [];
  for (const f of rows) {
    const prev = last.get(f.vehicleId);
    last.set(f.vehicleId, f.odometer);
    if (!inSession(f.date, session)) continue;
    const km = prev !== undefined ? f.odometer - prev : null;
    out.push({ ...f, regNo: trn.vehicles.find((v) => v.id === f.vehicleId)?.regNo ?? "", kmSinceLast: km, kmPerLitre: km !== null && f.litres > 0 ? Math.round((km / f.litres) * 10) / 10 : null });
  }
  return out.reverse();
}

/** Read-only views of the fictional transport store, for the report centre's transport reports. */
export function transportSnapshot(campuses: CampusCode[], session: number) {
  const trn = trnStore.get();
  return {
    vehicles: trn.vehicles.filter((v) => campuses.includes(v.campus)).map((v) => vehicleView(trn, v)),
    routes: trn.routes.filter((r) => campuses.includes(r.campus)).map((r) => routeView(trn, r)),
    riders: trn.riders.filter((r) => campuses.includes(r.campus)).map((r) => riderView(trn, r)),
    trips: trn.trips.filter((t) => campuses.includes(t.campus)).map((t) => tripView(trn, t)),
    fuel: fuelViews(trn, campuses, session),
  };
}
