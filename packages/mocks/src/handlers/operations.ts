// Transport — mock handlers and store, owned by the operations module (module 11c makes it real).
// The library (/api/library/*), the shared people search (/api/operations/people) and the warehouse with its book shop
// (/api/warehouse/*) are real since module 11: their requests fall through to the backend. The fictional library and
// warehouse the report centre still reads are in library-model.ts and warehouse-model.ts.
// Rules the real server will enforce live here too: vehicles that cannot carry more riders than seats without a
// decision, and the transport fee sent to the student's fee account in Fees.
import {
  can,
  type CampusCode,
  type Charge,
  type Ctx,
  type OperationsPersonType,
  type Permission,
  type SessionUser,
  type TransportAlert,
  type TransportFuel,
  type TransportOverview,
  type TransportRider,
  type TransportRoute,
  type TransportRouteSheet,
  type TransportTrip,
  type TransportVehicle,
} from "@mtb/api";
import { daysBetween, formatDate, formatRs, formatSession, type IsoDate } from "@mtb/domain";
import { http, type HttpHandler } from "msw";
import { CURRENT_SESSION, DEMO_TODAY } from "../clock";
import { createStore } from "../db";
import { campusName } from "../fixtures/campuses";
import {
  addDays,
  initialTransport,
  OPS_CAMPUSES,
  type TrnRiderRec,
} from "../fixtures/operations";
import { currentUser } from "./auth-state";
import { chargesOf, feesStore } from "./fees-state";
import { personOf } from "./library-model";
import { ctxFrom, fail, HttpResponse, latency } from "../util";

const trnStore = createStore("operations.transport", initialTransport);
const idemStore = createStore<Record<string, unknown>>("operations.idem", () => ({}));

const TODAY = DEMO_TODAY;
const sessionStart = (s: number): IsoDate => `${s}-04-01`;
const sessionEnd = (s: number): IsoDate => `${s + 1}-03-31`;
const inSession = (d: IsoDate, s: number) => d >= sessionStart(s) && d <= sessionEnd(s);
const scopeOf = (ctx: Ctx): CampusCode[] => (ctx.campus === "ALL" ? OPS_CAMPUSES : [ctx.campus]);
const inScope = (ctx: Ctx, campus: CampusCode) => ctx.campus === "ALL" || ctx.campus === campus;
const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 9)}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (iso: IsoDate) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const int = (v: unknown) => typeof v === "number" && Number.isInteger(v);

/* ================================================================================================ Guards */

type Guarded = SessionUser | Response;

function guard(permission: Permission, campus: Ctx["campus"]): Guarded {
  const user = currentUser();
  if (!user) return fail(401, "UNAUTHENTICATED", "Please sign in.");
  if (!can(user, permission, campus)) return fail(403, "FORBIDDEN", "Your role can't do this at this campus.");
  return user;
}

/** Changes need one campus and the current session. */
function writeGuard(permission: Permission, ctx: Ctx): Guarded {
  const user = guard(permission, ctx.campus);
  if (user instanceof Response) return user;
  if (ctx.campus === "ALL") return fail(400, "CAMPUS_REQUIRED", "Choose a campus first. Records always belong to one campus.");
  if (ctx.session !== CURRENT_SESSION) return fail(409, "SESSION_CLOSED", `Session ${formatSession(ctx.session)} is closed. Switch to ${formatSession(CURRENT_SESSION)} to make changes.`);
  return user;
}

/**
 * A change to an existing record uses the record's own campus and the session the user is working in.
 * The client sends ?session= with every write, so a return, renew or cancel made while a closed session
 * is selected is refused by writeGuard (SESSION_CLOSED) rather than slipping through.
 */
const ctxOf = (campus: CampusCode, request: Request): Ctx => ({ campus, session: ctxFrom(new URL(request.url)).session });

/** A retried post with the same Idempotency-Key gets the first answer back instead of a second document. */
function idem(request: Request): { key: string | null; hit: Record<string, unknown> | undefined } {
  const key = request.headers.get("Idempotency-Key");
  return { key, hit: key ? (idemStore.get()[key] as Record<string, unknown> | undefined) : undefined };
}
function remember<T>(key: string | null, value: T): T {
  if (key) idemStore.set((m) => ({ ...m, [key]: value }));
  return value;
}

const bad = (field: string, message: string) => fail(400, "VALIDATION", message, { field });

/* ================================================================================================ Fees link */

/** Adds a charge to a student's fee account in Fees (it then shows at the fee counter). */
function addFeeCharge(grNo: string, key: string, head: string, amount: number, dueDate: IsoDate): string {
  chargesOf(grNo);
  const id = `${grNo}:${key}`;
  const charge: Charge = { id, grNo, session: CURRENT_SESSION, head, kind: "FEE", amount, dueDate, status: "OPEN", settledAmount: 0 };
  feesStore.set((st) => {
    const list = st.charges[grNo] ?? [];
    if (list.some((c) => c.id === id)) return st;
    return { ...st, charges: { ...st.charges, [grNo]: [...list, charge] } };
  });
  return id;
}
/** Cancels a charge this module raised, if nothing has been paid against it. Returns false when it was paid. */
function cancelFeeCharge(grNo: string, id: string): boolean {
  const c = feesStore.get().charges[grNo]?.find((x) => x.id === id);
  if (!c) return true;
  if (c.settledAmount > 0 || c.status === "SETTLED") return false;
  feesStore.set((st) => ({ ...st, charges: { ...st.charges, [grNo]: (st.charges[grNo] ?? []).map((x) => (x.id === id ? { ...x, status: "CANCELLED" as const } : x)) } }));
  return true;
}
function setFeeChargeAmount(grNo: string, id: string, amount: number) {
  feesStore.set((st) => ({ ...st, charges: { ...st.charges, [grNo]: (st.charges[grNo] ?? []).map((x) => (x.id === id && x.status === "OPEN" && x.settledAmount === 0 ? { ...x, amount } : x)) } }));
}

/* ================================================================================================ Transport: views */

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

function trnOverview(ctx: Ctx): TransportOverview {
  const trn = trnStore.get();
  const campuses = scopeOf(ctx);
  const vehicles = trn.vehicles.filter((v) => campuses.includes(v.campus));
  const routes = trn.routes.filter((r) => campuses.includes(r.campus) && r.active).map((r) => routeView(trn, r));
  const riders = trn.riders.filter((r) => campuses.includes(r.campus) && riderActive(r)).map((r) => riderView(trn, r));
  const months = ["2026-08", "2026-09", "2026-10", "2026-11"];
  const fuel = trn.fuel.filter((f) => campuses.includes(f.campus));
  return {
    vehicles: vehicles.length,
    activeVehicles: vehicles.filter((v) => v.active && trn.routes.some((r) => r.vehicleId === v.id && r.active)).length,
    routes: routes.length,
    riders: riders.length,
    seats: routes.reduce((a, r) => a + r.capacity, 0),
    fullRoutes: routes.filter((r) => r.capacity > 0 && r.riders >= r.capacity).length,
    monthlyBilling: riders.filter((r) => r.type === "STUDENT").reduce((a, r) => a + r.monthlyFee, 0),
    alerts: vehicles.filter((v) => v.active).flatMap(alertsOf).sort((a, b) => a.days - b.days),
    load: routes.map((r) => ({ routeId: r.id, code: ctx.campus === "ALL" ? `${r.campus} ${r.code}` : r.code, name: r.name, riders: r.riders, capacity: r.capacity })),
    fuel: months.map((m) => ({ month: m, litres: fuel.filter((f) => f.date.startsWith(m)).reduce((a, f) => a + f.litres, 0), amount: fuel.filter((f) => f.date.startsWith(m)).reduce((a, f) => a + f.amount, 0) })),
    fuelLast30: fuel.filter((f) => f.date > addDays(TODAY, -30)).reduce((a, f) => a + f.amount, 0),
    tripsToday: trn.trips.filter((t) => campuses.includes(t.campus) && t.date === TODAY).length,
  };
}

/** Bills the month the rider starts in: "Transport fee – Nov 2026", due on the 10th (or the start day if later). */
function billTransport(rider: TrnRiderRec, amount: number): { head: string; due: IsoDate; chargeId: string } {
  const month = rider.fromDate.slice(0, 7);
  const tenth = `${month}-10`;
  const due = rider.fromDate > tenth ? rider.fromDate : tenth;
  const head = `Transport fee – ${monthLabel(`${month}-01`)}`;
  const chargeId = addFeeCharge(rider.personId, `trn-${rider.id}-${month}`, head, amount, due);
  return { head, due, chargeId };
}

function capacityCheck(trn: Trn, routeId: string, allow: boolean | undefined, ignoreRiderId?: string): Response | null {
  const route = trn.routes.find((r) => r.id === routeId)!;
  const v = route.vehicleId ? trn.vehicles.find((x) => x.id === route.vehicleId) : undefined;
  if (!v) return fail(409, "NO_VEHICLE", `Route ${route.code} has no vehicle yet. Give it a vehicle first.`, { field: "routeId" });
  const n = activeRiders(trn, routeId).filter((r) => r.id !== ignoreRiderId).length;
  if (n >= v.capacity && !allow) return fail(409, "CAPACITY_FULL", `Route ${route.code} is full: ${n} riders for ${v.capacity} seats in ${v.regNo}.`, { field: "routeId", details: { riders: n, capacity: v.capacity } });
  return null;
}

/* ================================================================================================ Transport: handlers */

const transportHandlers: HttpHandler[] = [
  http.get("/api/transport/overview", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = guard("transport.view", ctx.campus);
    if (user instanceof Response) return user;
    return HttpResponse.json(trnOverview(ctx));
  }),

  http.get("/api/transport/vehicles", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = guard("transport.view", ctx.campus);
    if (user instanceof Response) return user;
    const trn = trnStore.get();
    return HttpResponse.json(trn.vehicles.filter((v) => inScope(ctx, v.campus)).map((v) => vehicleView(trn, v)).sort((a, b) => (a.routeCode ?? "Z").localeCompare(b.routeCode ?? "Z") || a.regNo.localeCompare(b.regNo)));
  }),

  http.post("/api/transport/vehicles", async ({ request }) => saveVehicle(request, null)),
  http.put("/api/transport/vehicles/:id", async ({ request, params }) => saveVehicle(request, String(params.id))),

  http.get("/api/transport/routes", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = guard("transport.view", ctx.campus);
    if (user instanceof Response) return user;
    const trn = trnStore.get();
    return HttpResponse.json(trn.routes.filter((r) => inScope(ctx, r.campus)).map((r) => routeView(trn, r)).sort((a, b) => a.campus.localeCompare(b.campus) || a.code.localeCompare(b.code)));
  }),

  http.post("/api/transport/routes", async ({ request }) => saveRoute(request, null)),
  http.put("/api/transport/routes/:id", async ({ request, params }) => saveRoute(request, String(params.id))),

  http.get("/api/transport/route-sheets", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = guard("transport.view", ctx.campus);
    if (user instanceof Response) return user;
    const only = url.searchParams.get("routeId") ?? "";
    const trn = trnStore.get();
    const sheets: TransportRouteSheet[] = trn.routes
      .filter((r) => inScope(ctx, r.campus) && r.active && (!only || r.id === only))
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((r) => {
        const view = routeView(trn, r);
        const v = r.vehicleId ? trn.vehicles.find((x) => x.id === r.vehicleId) : undefined;
        const riders = activeRiders(trn, r.id).map((x) => riderView(trn, x));
        return { route: view, vehicle: v ? vehicleView(trn, v) : null, stops: view.stops.map((s) => ({ stop: s, riders: riders.filter((x) => x.stopId === s.id).sort((a, b) => a.name.localeCompare(b.name)) })), campusName: campusName(r.campus) };
      });
    return HttpResponse.json(sheets);
  }),

  http.get("/api/transport/riders", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = guard("transport.view", ctx.campus);
    if (user instanceof Response) return user;
    const routeId = url.searchParams.get("routeId") ?? "";
    const status = url.searchParams.get("status") ?? "ACTIVE";
    const trn = trnStore.get();
    const rows = trn.riders
      .filter((r) => inScope(ctx, r.campus) && (!routeId || r.routeId === routeId))
      .filter((r) => r.fromDate <= sessionEnd(ctx.session) && (r.toDate === null || r.toDate >= sessionStart(ctx.session)))
      .map((r) => riderView(trn, r))
      .filter((r) => status === "ALL" || r.status === status)
      .sort((a, b) => a.routeCode.localeCompare(b.routeCode) || a.stopName.localeCompare(b.stopName) || a.name.localeCompare(b.name));
    return HttpResponse.json(rows);
  }),

  http.post("/api/transport/riders", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = writeGuard("transport.manage", ctx);
    if (user instanceof Response) return user;
    const { key, hit } = idem(request);
    if (hit) return HttpResponse.json(hit, { status: 201 });
    const campus = ctx.campus as CampusCode;
    const b = (await request.json()) as { type: OperationsPersonType; personId: string; routeId: string; stopId: string; direction: TrnRiderRec["direction"]; fromDate: IsoDate; allowOverCapacity?: boolean };
    const person = personOf(b.type, b.personId);
    if (!person) return bad("personId", "Choose the student or staff member.");
    if (person.campus !== campus) return fail(409, "OTHER_CAMPUS", `${person.name} belongs to ${campusName(person.campus)}.`, { field: "personId" });
    if (!person.active) return fail(409, "LEFT", `${person.name} has left the school.`, { field: "personId" });
    const trn = trnStore.get();
    const current = trn.riders.find((r) => r.type === b.type && r.personId === b.personId && riderActive(r));
    if (current) {
      const v = riderView(trn, current);
      return fail(409, "ALREADY_RIDING", `${person.name} already rides ${v.routeCode} from ${v.stopName}. Use "Change route" instead.`, { field: "personId", details: { riderId: current.id } });
    }
    const route = trn.routes.find((r) => r.id === b.routeId && r.campus === campus && r.active);
    if (!route) return bad("routeId", "Choose the route.");
    const stop = route.stops.find((s) => s.id === b.stopId);
    if (!stop) return bad("stopId", "Choose the stop where they get on.");
    if (!b.fromDate || b.fromDate < sessionStart(CURRENT_SESSION) || b.fromDate > addDays(TODAY, 60)) return bad("fromDate", "Start date must be in this session, up to 60 days ahead.");
    const cap = capacityCheck(trn, route.id, b.allowOverCapacity);
    if (cap) return cap;
    const rec: TrnRiderRec = { id: uid(`${campus}-rd`), campus, type: b.type, personId: b.personId, routeId: route.id, stopId: stop.id, direction: b.direction ?? "BOTH", fromDate: b.fromDate, toDate: null, endReason: "", feeChargeIds: [] };
    let feeHead = "";
    let feeDueOn: IsoDate | null = null;
    if (b.type === "STUDENT") {
      const bill = billTransport(rec, stop.fare ?? route.fare);
      rec.feeChargeIds = [bill.chargeId];
      feeHead = bill.head;
      feeDueOn = bill.due;
    }
    trnStore.set((s) => ({ ...s, riders: [...s.riders, rec] }));
    return HttpResponse.json(remember(key, { rider: riderView(trnStore.get(), rec), feeHead, feeDueOn }), { status: 201 });
  }),

  http.put("/api/transport/riders/:id", async ({ request, params }) => {
    await latency();
    const trn = trnStore.get();
    const r = trn.riders.find((x) => x.id === params.id);
    if (!r) return fail(404, "NOT_FOUND", "This rider is no longer on record.");
    const user = writeGuard("transport.manage", ctxOf(r.campus, request));
    if (user instanceof Response) return user;
    if (!riderActive(r)) return fail(409, "ENDED", "This assignment has ended. Assign the rider again.");
    const b = (await request.json()) as { routeId: string; stopId: string; direction: TrnRiderRec["direction"]; allowOverCapacity?: boolean };
    const route = trn.routes.find((x) => x.id === b.routeId && x.campus === r.campus && x.active);
    if (!route) return bad("routeId", "Choose the route.");
    const stop = route.stops.find((s) => s.id === b.stopId);
    if (!stop) return bad("stopId", "Choose the stop.");
    if (route.id !== r.routeId) {
      const cap = capacityCheck(trn, route.id, b.allowOverCapacity, r.id);
      if (cap) return cap;
    }
    const fee = stop.fare ?? route.fare;
    trnStore.set((s) => ({ ...s, riders: s.riders.map((x) => (x.id === r.id ? { ...x, routeId: route.id, stopId: stop.id, direction: b.direction ?? x.direction } : x)) }));
    // An unpaid charge this demo raised follows the new fare.
    for (const cid of r.feeChargeIds) setFeeChargeAmount(r.personId, cid, fee);
    const view = riderView(trnStore.get(), trnStore.get().riders.find((x) => x.id === r.id)!);
    return HttpResponse.json({ rider: view, feeHead: r.type === "STUDENT" ? `Transport fee ${formatRs(fee)} a month from the next fee voucher` : "", feeDueOn: null });
  }),

  http.post("/api/transport/riders/:id/end", async ({ request, params }) => {
    await latency();
    const trn = trnStore.get();
    const r = trn.riders.find((x) => x.id === params.id);
    if (!r) return fail(404, "NOT_FOUND", "This rider is no longer on record.");
    const user = writeGuard("transport.manage", ctxOf(r.campus, request));
    if (user instanceof Response) return user;
    if (r.toDate) return fail(409, "ENDED", `This assignment already ends on ${formatDate(r.toDate)}.`);
    const b = (await request.json()) as { toDate: IsoDate; reason: string };
    if (!b.toDate || b.toDate < r.fromDate || b.toDate > addDays(TODAY, 90)) return bad("toDate", "The last day must be after the start date, up to 90 days ahead.");
    if ((b.reason ?? "").trim().length < 3) return bad("reason", "Say why they stop using transport.");
    // Charges for months after the last day are cancelled if unpaid.
    for (const cid of r.feeChargeIds) {
      const c = feesStore.get().charges[r.personId]?.find((x) => x.id === cid);
      if (c && c.dueDate.slice(0, 7) > b.toDate.slice(0, 7)) cancelFeeCharge(r.personId, cid);
    }
    trnStore.set((s) => ({ ...s, riders: s.riders.map((x) => (x.id === r.id ? { ...x, toDate: b.toDate, endReason: b.reason.trim() } : x)) }));
    return HttpResponse.json(riderView(trnStore.get(), trnStore.get().riders.find((x) => x.id === r.id)!));
  }),

  http.get("/api/transport/trips", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = guard("transport.view", ctx.campus);
    if (user instanceof Response) return user;
    const trn = trnStore.get();
    return HttpResponse.json(trn.trips.filter((t) => inScope(ctx, t.campus) && inSession(t.date, ctx.session)).map((t) => tripView(trn, t)).sort((a, b) => b.date.localeCompare(a.date) || b.departAt.localeCompare(a.departAt)));
  }),

  http.post("/api/transport/trips", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = writeGuard("transport.manage", ctx);
    if (user instanceof Response) return user;
    const campus = ctx.campus as CampusCode;
    const b = (await request.json()) as Omit<Trn["trips"][number], "id" | "campus">;
    const trn = trnStore.get();
    const v = trn.vehicles.find((x) => x.id === b.vehicleId && x.campus === campus);
    if (!v) return bad("vehicleId", "Choose the vehicle.");
    if (!b.date || b.date > TODAY || b.date < sessionStart(CURRENT_SESSION)) return bad("date", "The date must be in this session and not in the future.");
    if (!/^\d{2}:\d{2}$/.test(b.departAt ?? "")) return bad("departAt", "Enter the time it left, for example 06:45.");
    if (!/^\d{2}:\d{2}$/.test(b.arriveAt ?? "") || b.arriveAt <= b.departAt) return bad("arriveAt", "Enter the arrival time, after the departure time.");
    if (!int(b.startKm) || b.startKm < 0) return bad("startKm", "Enter the meter reading when it left.");
    if (!int(b.endKm) || b.endKm < b.startKm) return bad("endKm", "The meter reading at the end can't be less than at the start.");
    if (b.endKm - b.startKm > 600) return bad("endKm", "That is more than 600 km in one trip. Check the meter readings.");
    if (!int(b.ridersPresent) || b.ridersPresent < 0) return bad("ridersPresent", "Enter how many were on board.");
    if (b.ridersPresent > v.capacity) return bad("ridersPresent", `${v.regNo} has ${v.capacity} seats.`);
    if (b.direction === "OTHER" && (b.purpose ?? "").trim().length < 3) return bad("purpose", "Say what the trip was for.");
    const route = b.routeId ? trn.routes.find((r) => r.id === b.routeId && r.campus === campus) : undefined;
    const rec = { ...b, id: uid(`${campus}-trip`), campus, routeId: route?.id ?? null, purpose: b.direction === "PICKUP" ? "Morning pickup" : b.direction === "DROP" ? "Afternoon drop" : b.purpose.trim(), driverName: (b.driverName ?? "").trim() || v.driverName, note: (b.note ?? "").trim() };
    trnStore.set((s) => ({ ...s, trips: [...s.trips, rec], vehicles: s.vehicles.map((x) => (x.id === v.id && b.endKm > x.odometer ? { ...x, odometer: b.endKm } : x)) }));
    return HttpResponse.json(tripView(trnStore.get(), rec), { status: 201 });
  }),

  http.get("/api/transport/fuel", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = guard("transport.view", ctx.campus);
    if (user instanceof Response) return user;
    return HttpResponse.json(fuelViews(trnStore.get(), scopeOf(ctx), ctx.session));
  }),

  http.post("/api/transport/fuel", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = writeGuard("transport.manage", ctx);
    if (user instanceof Response) return user;
    const campus = ctx.campus as CampusCode;
    const b = (await request.json()) as { date: IsoDate; vehicleId: string; litres: number; amount: number; odometer: number; station: string; slipNo: string };
    const trn = trnStore.get();
    const v = trn.vehicles.find((x) => x.id === b.vehicleId && x.campus === campus);
    if (!v) return bad("vehicleId", "Choose the vehicle.");
    if (!b.date || b.date > TODAY || b.date < sessionStart(CURRENT_SESSION)) return bad("date", "The date must be in this session and not in the future.");
    if (typeof b.litres !== "number" || b.litres <= 0 || b.litres > 400) return bad("litres", "Enter the litres filled (up to 400).");
    if (!int(b.amount) || b.amount <= 0) return bad("amount", "Enter the amount paid in whole rupees.");
    const rate = b.amount / b.litres;
    if (rate < 150 || rate > 500) return bad("amount", `That is ${formatRs(Math.round(rate))} a litre. Check the litres and the amount.`);
    const lastOdo = Math.max(0, ...trn.fuel.filter((f) => f.vehicleId === v.id).map((f) => f.odometer));
    if (!int(b.odometer) || b.odometer <= lastOdo) return bad("odometer", `The last fill-up of ${v.regNo} was at ${lastOdo.toLocaleString("en-US")} km. Enter a higher meter reading.`);
    if ((b.slipNo ?? "").trim().length < 2) return bad("slipNo", "Enter the pump slip number.");
    const rec = { id: uid(`${campus}-fuel`), campus, date: b.date, vehicleId: v.id, litres: Math.round(b.litres * 10) / 10, amount: b.amount, odometer: b.odometer, station: (b.station ?? "").trim(), slipNo: b.slipNo.trim(), enteredBy: user.name };
    trnStore.set((s) => ({ ...s, fuel: [...s.fuel, rec], vehicles: s.vehicles.map((x) => (x.id === v.id && b.odometer > x.odometer ? { ...x, odometer: b.odometer } : x)) }));
    return HttpResponse.json(fuelViews(trnStore.get(), [campus], CURRENT_SESSION).find((f) => f.id === rec.id), { status: 201 });
  }),
];

async function saveVehicle(request: Request, id: string | null) {
  await latency();
  const ctx = ctxFrom(new URL(request.url));
  const trn = trnStore.get();
  const existing = id ? trn.vehicles.find((v) => v.id === id) : undefined;
  if (id && !existing) return fail(404, "NOT_FOUND", "This vehicle is no longer on record.");
  const user = writeGuard("transport.manage", existing ? ctxOf(existing.campus, request) : ctx);
  if (user instanceof Response) return user;
  const campus = existing?.campus ?? (ctx.campus as CampusCode);
  const b = (await request.json()) as Omit<Trn["vehicles"][number], "id" | "campus">;
  const regNo = (b.regNo ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2,4}-\d{1,4}$/.test(regNo)) return bad("regNo", "Use the number plate format, for example RYK-2231.");
  if (trn.vehicles.some((v) => v.campus === campus && v.id !== id && v.regNo === regNo)) return fail(409, "DUPLICATE", `${regNo} is already on the list.`, { field: "regNo" });
  if (!int(b.capacity) || b.capacity < 2 || b.capacity > 80) return bad("capacity", "Seats are 2 to 80.");
  if ((b.driverName ?? "").trim().length < 3) return bad("driverName", "Enter the driver's name.");
  const mob = (b.driverMobile ?? "").replace(/\D/g, "");
  if (!/^03\d{9}$/.test(mob)) return bad("driverMobile", "Enter the driver's mobile, for example 0301-2345678.");
  for (const [f, label] of [["fitnessExpiry", "fitness certificate"], ["insuranceExpiry", "insurance"], ["licenceExpiry", "driver's licence"], ["permitExpiry", "route permit"]] as const) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b[f] ?? "")) return bad(f, `Enter the date the ${label} runs out.`);
  }
  if (!int(b.odometer) || b.odometer < 0) return bad("odometer", "Enter the meter reading in km.");
  if (b.ownership === "CONTRACTED" && (b.contractor ?? "").trim().length < 3) return bad("contractor", "Enter the contractor's name.");
  if (existing) {
    const route = trn.routes.find((r) => r.vehicleId === existing.id && r.active);
    const n = route ? activeRiders(trn, route.id).length : 0;
    if (route && b.capacity < n) return fail(409, "TOO_SMALL", `Route ${route.code} has ${n} riders, more than ${b.capacity} seats. Move riders first.`, { field: "capacity" });
  }
  const rec = { ...b, id: existing?.id ?? uid(`${campus}-veh`), campus, regNo, driverName: b.driverName.trim(), contractor: b.ownership === "CONTRACTED" ? b.contractor.trim() : "" };
  trnStore.set((s) => ({ ...s, vehicles: existing ? s.vehicles.map((v) => (v.id === rec.id ? rec : v)) : [...s.vehicles, rec] }));
  return HttpResponse.json(vehicleView(trnStore.get(), rec), { status: existing ? 200 : 201 });
}

async function saveRoute(request: Request, id: string | null) {
  await latency();
  const ctx = ctxFrom(new URL(request.url));
  const trn = trnStore.get();
  const existing = id ? trn.routes.find((r) => r.id === id) : undefined;
  if (id && !existing) return fail(404, "NOT_FOUND", "This route is no longer on record.");
  const user = writeGuard("transport.manage", existing ? ctxOf(existing.campus, request) : ctx);
  if (user instanceof Response) return user;
  const campus = existing?.campus ?? (ctx.campus as CampusCode);
  const b = (await request.json()) as { code: string; name: string; vehicleId: string | null; fare: number; active: boolean; stops: Array<{ id?: string; name: string; pickupTime: string; dropTime: string; fare: number | null }> };
  const code = (b.code ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9-]{2,8}$/.test(code)) return bad("code", "Use a short code such as R-10.");
  if (trn.routes.some((r) => r.campus === campus && r.id !== id && r.code === code)) return fail(409, "DUPLICATE", `Route ${code} already exists.`, { field: "code" });
  if ((b.name ?? "").trim().length < 3) return bad("name", "Name the route by the areas it covers.");
  if (!int(b.fare) || b.fare < 0) return bad("fare", "Enter the monthly fare in whole rupees.");
  const stops = b.stops ?? [];
  if (stops.length === 0) return bad("stops", "Add at least one stop.");
  for (const [i, s] of stops.entries()) {
    if ((s.name ?? "").trim().length < 2) return bad(`stops.${i}.name`, "Enter the stop name.");
    if (!/^\d{2}:\d{2}$/.test(s.pickupTime)) return bad(`stops.${i}.pickupTime`, "Enter the pickup time, for example 07:05.");
    if (!/^\d{2}:\d{2}$/.test(s.dropTime)) return bad(`stops.${i}.dropTime`, "Enter the drop time, for example 13:50.");
    if (s.fare !== null && (!int(s.fare) || s.fare < 0)) return bad(`stops.${i}.fare`, "Enter the fare in whole rupees, or leave it empty for the route fare.");
  }
  if (b.vehicleId) {
    const v = trn.vehicles.find((x) => x.id === b.vehicleId && x.campus === campus);
    if (!v) return bad("vehicleId", "Choose a vehicle at this campus.");
    const other = trn.routes.find((r) => r.vehicleId === v.id && r.active && r.id !== id);
    if (other) return fail(409, "VEHICLE_BUSY", `${v.regNo} already runs route ${other.code}. Choose another vehicle, or free it from ${other.code} first.`, { field: "vehicleId" });
    if (existing) {
      const n = activeRiders(trn, existing.id).length;
      if (v.capacity < n) return fail(409, "TOO_SMALL", `${v.regNo} has ${v.capacity} seats but ${n} ride this route. Choose a bigger vehicle or move riders first.`, { field: "vehicleId" });
    }
  }
  const routeId = existing?.id ?? uid(`${campus}-rt`);
  const nextStops = stops.map((s) => ({ id: s.id && existing?.stops.some((x) => x.id === s.id) ? s.id : uid(`${routeId}-st`), name: s.name.trim(), pickupTime: s.pickupTime, dropTime: s.dropTime, fare: s.fare }));
  if (existing) {
    const kept = new Set(nextStops.map((s) => s.id));
    const orphan = existing.stops.find((s) => !kept.has(s.id) && activeRiders(trn, existing.id).some((r) => r.stopId === s.id));
    if (orphan) {
      const n = activeRiders(trn, existing.id).filter((r) => r.stopId === orphan.id).length;
      return fail(409, "STOP_IN_USE", `${n} ${n === 1 ? "rider gets" : "riders get"} on at ${orphan.name}. Move them to another stop first.`, { field: "stops" });
    }
    if (b.active === false && activeRiders(trn, existing.id).length) return fail(409, "ROUTE_IN_USE", `${activeRiders(trn, existing.id).length} riders still use ${existing.code}. Move them before closing the route.`, { field: "active" });
  }
  const rec = { id: routeId, campus, code, name: b.name.trim(), vehicleId: b.vehicleId, fare: b.fare, stops: nextStops, active: b.active !== false };
  trnStore.set((s) => ({ ...s, routes: existing ? s.routes.map((r) => (r.id === routeId ? rec : r)) : [...s.routes, rec] }));
  return HttpResponse.json(routeView(trnStore.get(), rec), { status: existing ? 200 : 201 });
}

/* ================================================================================================ Snapshots for the report centre */

// Read-only views of the live stores, so the report centre shows the same books, stock and riders as the module
// pages (and changes made in the demo). Nothing here writes.

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

export const operationsHandlers: HttpHandler[] = [...transportHandlers];
