// The Warehouse (/api/warehouse/*: overview, items, room stock, suppliers, GRNs, requests, issues, returns, counts, the
// shop with its sales and book sets, setup) is real since module 11b: its requests fall through to the backend. This
// file keeps only the fictional warehouse the report centre's warehouse reports still read (handlers/reports.ts) until
// module 13 makes the reports real. No routes and nothing here writes.
import type { CampusCode, WarehouseGrn, WarehouseIssue, WarehouseItem, WarehouseRoomStock } from "@mtb/api";
import type { IsoDate } from "@mtb/domain";
import { createStore } from "../db";
import { initialWarehouse, type WhItemRec } from "../fixtures/operations";

const whStore = createStore("operations.warehouse.v2", initialWarehouse);

type Wh = ReturnType<typeof whStore.get>;

interface Bal {
  onHand: number;
  avg: number;
  last: IsoDate | null;
  inRooms: number;
}

function balances(wh: Wh): Map<string, Bal> {
  const m = new Map<string, Bal>();
  const consumable = new Map(wh.items.map((i) => [i.id, i.consumable]));
  for (const mv of wh.moves) {
    const b = m.get(mv.itemId) ?? { onHand: 0, avg: mv.unitCost, last: null, inRooms: 0 };
    if (mv.qtyIn > 0 && !["RETURN", "SALE_CANCEL"].includes(mv.type)) b.avg = Math.round((b.onHand * b.avg + mv.qtyIn * mv.unitCost) / Math.max(1, b.onHand + mv.qtyIn));
    b.onHand += mv.qtyIn - mv.qtyOut;
    b.last = mv.date;
    if (consumable.get(mv.itemId) === false) {
      if (mv.type === "ISSUE") b.inRooms += mv.qtyOut;
      if (mv.type === "RETURN") b.inRooms -= mv.qtyIn;
    }
    m.set(mv.itemId, b);
  }
  return m;
}

function itemView(wh: Wh, it: WhItemRec, bals: Map<string, Bal>): WarehouseItem {
  const b = bals.get(it.id) ?? { onHand: 0, avg: 0, last: null, inRooms: 0 };
  const cat = wh.categories.find((c) => c.id === it.categoryId);
  return {
    id: it.id,
    campus: it.campus,
    code: it.code,
    group: it.group,
    name: it.name,
    categoryId: it.categoryId,
    category: cat?.name ?? "",
    unit: it.unit,
    consumable: it.consumable,
    reorderLevel: it.reorderLevel,
    onHand: b.onHand,
    inRooms: Math.max(0, b.inRooms),
    avgCost: b.avg,
    value: b.onHand * b.avg,
    forSale: Boolean(cat?.forSale),
    salePrice: it.salePrice,
    status: b.onHand <= 0 ? "OUT" : b.onHand <= it.reorderLevel ? "LOW" : "OK",
    active: it.active,
    lastMovementOn: b.last,
  };
}

function grnView(wh: Wh, g: Wh["grns"][number]): WarehouseGrn {
  const sup = wh.suppliers.find((s) => s.id === g.supplierId);
  const lines = g.lines.map((l) => {
    const it = wh.items.find((i) => i.id === l.itemId)!;
    return { itemId: l.itemId, itemName: it.name, unit: it.unit, qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct, total: Math.round(l.qty * l.unitPrice * (1 - l.discountPct / 100)) };
  });
  const subtotal = lines.reduce((a, l) => a + l.qty * l.unitPrice, 0);
  const net = lines.reduce((a, l) => a + l.total, 0);
  const tax = g.tax ?? 0;
  return { ...g, tax, supplierName: sup?.name ?? "", lines, subtotal, discount: subtotal - net, total: net + g.freight + tax };
}

function issueView(wh: Wh, i: Wh["issues"][number]): WarehouseIssue {
  const dep = wh.departments.find((d) => d.id === i.departmentId);
  const req = i.requestId ? wh.requests.find((r) => r.id === i.requestId) : undefined;
  const rets = wh.returns.filter((r) => r.issueId === i.id);
  const lines = i.lines.map((l) => {
    const it = wh.items.find((x) => x.id === l.itemId)!;
    const returned = rets.reduce((a, r) => a + r.lines.filter((x) => x.issueLineId === l.id).reduce((s, x) => s + x.qty, 0), 0);
    return { id: l.id, itemId: l.itemId, itemName: it.name, unit: it.unit, consumable: it.consumable, qty: l.qty, returned, unitCost: l.unitCost, remarks: l.remarks };
  });
  return {
    id: i.id,
    no: i.no,
    campus: i.campus,
    date: i.date,
    departmentId: i.departmentId,
    department: dep?.name ?? "",
    room: i.room,
    receivedBy: i.receivedBy,
    requestId: i.requestId,
    requestNo: req?.no ?? null,
    lines,
    value: lines.reduce((a, l) => a + (l.qty - l.returned) * l.unitCost, 0),
    issuedBy: i.issuedBy,
    postedAt: i.postedAt,
    returns: rets.map((r) => ({ no: r.no, date: r.date, qty: r.lines.reduce((a, x) => a + x.qty, 0) })),
  };
}

/** Stock held in each room: issues add what went out, returns take back what came in. */
function roomStock(wh: Wh, campuses: CampusCode[]): WarehouseRoomStock[] {
  const issueDept = new Map(wh.issues.map((i) => [i.id, i.departmentId]));
  const returnDept = new Map(wh.returns.map((r) => [r.id, issueDept.get(r.issueId) ?? ""]));
  const held = new Map<string, { departmentId: string; room: string; itemId: string; qty: number }>();
  for (const m of wh.moves) {
    if (!campuses.includes(m.campus) || !m.room || (m.type !== "ISSUE" && m.type !== "RETURN")) continue;
    const departmentId = m.type === "ISSUE" ? (issueDept.get(m.docId) ?? "") : (returnDept.get(m.docId) ?? "");
    const k = `${departmentId}|${m.room}|${m.itemId}`;
    const row = held.get(k) ?? { departmentId, room: m.room, itemId: m.itemId, qty: 0 };
    row.qty += m.type === "ISSUE" ? m.qtyOut : -m.qtyIn;
    held.set(k, row);
  }
  const deps = new Map(wh.departments.map((d) => [d.id, d.name]));
  const items = new Map(wh.items.map((i) => [i.id, i]));
  const cats = new Map(wh.categories.map((c) => [c.id, c.name]));
  return [...held.values()]
    .filter((r) => r.qty > 0)
    .flatMap((r): WarehouseRoomStock[] => {
      const it = items.get(r.itemId);
      if (!it) return [];
      return [{ departmentId: r.departmentId, department: deps.get(r.departmentId) ?? "", room: r.room, itemId: it.id, code: it.code, itemName: it.name, group: it.group, categoryId: it.categoryId, category: cats.get(it.categoryId) ?? "", unit: it.unit, consumable: it.consumable, qty: r.qty }];
    })
    .sort((a, b) => a.group.localeCompare(b.group) || a.itemName.localeCompare(b.itemName) || a.department.localeCompare(b.department) || a.room.localeCompare(b.room));
}

/** Read-only view of the fictional warehouse for the report centre (module 13 replaces it with the real reports). */
export function warehouseSnapshot(campuses: CampusCode[]) {
  const wh = whStore.get();
  const bals = balances(wh);
  return {
    items: wh.items.filter((i) => campuses.includes(i.campus)).map((i) => itemView(wh, i, bals)),
    /** Ledger rows (oldest first). */
    moves: wh.moves.filter((m) => campuses.includes(m.campus)).map((m) => ({ campus: m.campus, itemId: m.itemId, date: m.date, type: m.type, qtyIn: m.qtyIn, qtyOut: m.qtyOut, unitCost: m.unitCost })),
    issues: wh.issues.filter((i) => campuses.includes(i.campus)).map((i) => issueView(wh, i)),
    grns: wh.grns.filter((g) => campuses.includes(g.campus)).map((g) => grnView(wh, g)),
    departments: wh.departments.filter((d) => campuses.includes(d.campus)).map((d) => ({ id: d.id, campus: d.campus, name: d.name, rooms: d.rooms.map((r) => ({ ...r })) })),
    roomStock: roomStock(wh, campuses),
  };
}
