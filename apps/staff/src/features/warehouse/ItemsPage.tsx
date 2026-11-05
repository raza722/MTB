import { warehouseApi, warehouseQueries, type WarehouseCategory, type WarehouseDepartment, type WarehouseItem } from "@mtb/api";
import { formatCount, formatRs } from "@mtb/domain";
import { AmountInput, Banner, Button, Checkbox, DataTable, EmptyState, IconButton, Input, Modal, Select, SidePanel, StatusBadge, Switch, TabPanel, Tabs, useToast, type Column } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { z } from "zod";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import { CampusNote, DocHead, errorCode, errorField, errorText, LoadError, RequireSingleCampusOverlay, SignLines, StaleNote, usePrinter, validate } from "../library/common";
import { StockBadge, WarehouseShell } from "./shared";

const itemSchema = (forSale: boolean, isNew: boolean) =>
  z.object({
    group: z.string().trim(),
    name: z.string().trim().min(2, { error: 'Enter the item name, for example "Register 200 pages".' }),
    categoryId: z.string().min(1, { error: "Choose a category." }),
    unit: z.string().min(1, { error: "Choose the unit it is counted in." }),
    consumable: z.boolean(),
    reorderLevel: z.number({ error: "Enter the level to reorder at." }).int().min(0, { error: "0 or more." }),
    salePrice: forSale ? z.number({ error: "Enter the price students pay." }).int().min(1, { error: "Enter the price students pay." }) : z.number().nullable(),
    active: z.boolean(),
    openingQty: isNew ? z.number().int().min(0, { error: "0 or more." }) : z.number().optional(),
    openingCost: isNew ? z.number().int().min(0, { error: "Enter the cost of one in whole rupees." }) : z.number().optional(),
  });

function ItemForm({ item, onClose }: { item: WarehouseItem | null; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const setup = useQuery(warehouseQueries.setup(ctx));
  const [d, setD] = useState({
    group: item?.group ?? "",
    name: item?.name ?? "",
    categoryId: item?.categoryId ?? "",
    unit: item?.unit ?? "Piece",
    consumable: item?.consumable ?? true,
    reorderLevel: (item?.reorderLevel ?? 10) as number | null,
    salePrice: item?.salePrice ?? null,
    active: item?.active ?? true,
    openingQty: 0 as number | null,
    openingCost: null as number | null,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const cat = setup.data?.categories.find((c) => c.id === d.categoryId);
  const forSale = Boolean(cat?.forSale);
  const save = useMutation({
    mutationFn: (body: Parameters<typeof warehouseApi.saveItem>[1]) => warehouseApi.saveItem(ctx, body, item?.id),
    onSuccess: (it) => {
      toast({ title: item ? `${it.name} updated` : `${it.name} added as ${it.code}`, message: !item && (d.openingQty ?? 0) > 0 ? `Opening balance of ${d.openingQty} posted to the stock ledger.` : undefined });
      void qc.invalidateQueries({ queryKey: ["warehouse"] });
      onClose();
    },
    onError: (e) => {
      const f = errorField(e);
      if (f) setErrors({ [f]: errorText(e) });
    },
  });
  const submit = () => {
    const r = validate(itemSchema(forSale, !item), { ...d, reorderLevel: d.reorderLevel ?? undefined, salePrice: forSale ? (d.salePrice ?? undefined) : null, openingQty: item ? undefined : (d.openingQty ?? 0), openingCost: item ? undefined : (d.openingQty ? (d.openingCost ?? undefined) : 0) });
    if (!r.ok) return setErrors(r.errors);
    setErrors({});
    save.mutate({ ...r.data, salePrice: forSale ? (r.data.salePrice ?? null) : null });
  };
  return (
    <SidePanel
      open
      onClose={onClose}
      title={item ? `Edit ${item.name}` : "Add an item"}
      description={item ? `${item.code}. Quantities change only through receipts, issues and counts.` : "A code is given automatically. Opening stock is posted to the ledger as a first entry."}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={submit}>
            {item ? "Save changes" : "Add item"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Input label="Item name" required value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} error={errors.name} placeholder="Register 200 pages" />
        <Input label="Family" value={d.group} onChange={(e) => setD({ ...d, group: e.target.value })} help='Groups varieties together, for example "Register".' />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Category" required value={d.categoryId} onChange={(e) => setD({ ...d, categoryId: e.target.value })} error={errors.categoryId} options={[{ value: "", label: "Choose…" }, ...(setup.data?.categories ?? []).filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }))]} />
          <Select label="Counted in" value={d.unit} onChange={(e) => setD({ ...d, unit: e.target.value })} error={errors.unit} options={(setup.data?.units ?? []).map((u) => ({ value: u, label: u }))} />
          <Input label="Reorder at" inputMode="numeric" value={d.reorderLevel === null ? "" : String(d.reorderLevel)} onChange={(e) => setD({ ...d, reorderLevel: e.target.value === "" ? null : Number(e.target.value.replace(/\D/g, "")) })} error={errors.reorderLevel} help="Shown as low at or below this." />
          {forSale && <AmountInput label="Shop price" required value={d.salePrice} onValueChange={(v) => setD({ ...d, salePrice: v })} error={errors.salePrice} />}
        </div>
        <Checkbox label="Used up (paper, markers, cleaning). Untick for furniture and equipment that stay in a room." checked={d.consumable} onChange={(e) => setD({ ...d, consumable: e.target.checked })} />
        {!item && (
          <fieldset className="m-0 grid gap-4 rounded-md border border-border p-4">
            <legend className="px-1 text-small font-semibold">Already on the shelf</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Quantity now" inputMode="numeric" value={d.openingQty === null ? "" : String(d.openingQty)} onChange={(e) => setD({ ...d, openingQty: e.target.value === "" ? null : Number(e.target.value.replace(/\D/g, "")) })} error={errors.openingQty} />
              <AmountInput label="Cost of one" value={d.openingCost} onValueChange={(v) => setD({ ...d, openingCost: v })} error={errors.openingCost} disabled={!d.openingQty} />
            </div>
          </fieldset>
        )}
        {item && <Switch label="In use (untick to hide it from new receipts and issues; its history stays)" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} />}
        {save.isError && !errorField(save.error) && <Banner tone="danger">{errorText(save.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

function CategoryForm({ cat, onClose }: { cat: WarehouseCategory | null; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState(cat?.name ?? "");
  const [forSale, setForSale] = useState(cat?.forSale ?? false);
  const [active, setActive] = useState(cat?.active ?? true);
  const m = useMutation({
    mutationFn: () => warehouseApi.saveCategory(ctx, { name, forSale, active }, cat?.id),
    onSuccess: () => {
      toast({ title: `Category "${name}" saved` });
      void qc.invalidateQueries({ queryKey: ["warehouse"] });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={cat ? `Edit ${cat.name}` : "Add a category"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} disabled={name.trim().length < 2} onClick={() => m.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Input label="Category" value={name} onChange={(e) => setName(e.target.value)} error={m.isError ? errorText(m.error) : undefined} />
        <Switch label="Sold to students in the book shop" checked={forSale} onChange={(e) => setForSale(e.target.checked)} />
        <Switch label="In use" checked={active} onChange={(e) => setActive(e.target.checked)} />
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- Departments and rooms */

/** "Ground", "1", "2" … */
export const floorText = (f: number | null) => (f === null ? "—" : f === 0 ? "Ground" : String(f));

const deptSchema = z
  .object({
    name: z.string().trim().min(2, { error: "Enter the department name." }),
    rooms: z
      .array(
        z.object({
          name: z.string().trim().min(2, { error: "Enter the room or class name." }),
          roomNo: z
            .string()
            .trim()
            .regex(/^[A-Za-z0-9-]{0,8}$/, { error: "Use a short room number such as 204 or G-12." }),
          floor: z.number().int().min(0, { error: "Floor is 0 (ground) to 20." }).max(20, { error: "Floor is 0 (ground) to 20." }).nullable(),
          active: z.boolean(),
        }),
      )
      .min(1, { error: "Add at least one room or class." }),
    active: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const names = new Set<string>();
    const nos = new Set<string>();
    v.rooms.forEach((r, i) => {
      const n = r.name.trim().toLowerCase();
      if (n && names.has(n)) ctx.addIssue({ code: "custom", path: ["rooms", i, "name"], message: `${r.name.trim()} is on the list twice.` });
      names.add(n);
      const no = r.roomNo.trim().toUpperCase();
      if (no && nos.has(no)) ctx.addIssue({ code: "custom", path: ["rooms", i, "roomNo"], message: `Room ${no} is on the list twice.` });
      if (no) nos.add(no);
    });
  });

interface RoomDraft {
  key: string;
  name: string;
  roomNo: string;
  floor: string;
  active: boolean;
}
const newRoom = (floor = ""): RoomDraft => ({ key: Math.random().toString(36).slice(2), name: "", roomNo: "", floor, active: true });

function DepartmentForm({ dep, onClose }: { dep: WarehouseDepartment | null; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState(dep?.name ?? "");
  const [rooms, setRooms] = useState<RoomDraft[]>(() => (dep?.rooms.length ? dep.rooms.map((r) => ({ key: `${r.name}-${r.roomNo}`, name: r.name, roomNo: r.roomNo, floor: r.floor === null ? "" : String(r.floor), active: r.active })) : [newRoom("0")]));
  const [active, setActive] = useState(dep?.active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: (body: z.infer<typeof deptSchema>) => warehouseApi.saveDepartment(ctx, { ...body, rooms: body.rooms.map((r) => ({ ...r, roomNo: r.roomNo.toUpperCase() })), ...(dep ? { rowVer: dep.rowVer } : {}) }, dep?.id),
    onSuccess: (x) => {
      toast({ title: `${x.name} saved`, message: `${x.rooms.length} rooms and classes.` });
      void qc.invalidateQueries({ queryKey: ["warehouse"] });
      onClose();
    },
    onError: (e) => setErrors({ [errorField(e) ?? "form"]: errorText(e) }),
  });
  const set = (i: number, patch: Partial<RoomDraft>) => setRooms(rooms.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const submit = () => {
    const r = validate(deptSchema, { name, active, rooms: rooms.map((x) => ({ name: x.name, roomNo: x.roomNo, floor: x.floor === "" ? null : Number(x.floor), active: x.active })) });
    if (!r.ok) return setErrors(r.errors);
    setErrors({});
    m.mutate(r.data);
  };
  return (
    <SidePanel
      open
      wide
      onClose={onClose}
      title={dep ? dep.name : "Add a department"}
      description="Stock is issued to a room or class in a department. Room numbers can't repeat anywhere at the campus."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Input label="Department" required value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
        <fieldset className="m-0 grid gap-3 rounded-md border border-border p-4">
          <legend className="px-1 text-small font-semibold">Rooms and classes</legend>
          {rooms.map((r, i) => (
            <div key={r.key} className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_110px_90px_auto_auto]">
              <Input label={`Room or class ${i + 1}`} value={r.name} onChange={(e) => set(i, { name: e.target.value })} error={errors[`rooms.${i}.name`]} placeholder="Class 7-B" />
              <Input label="Room no." mono value={r.roomNo} onChange={(e) => set(i, { roomNo: e.target.value.toUpperCase() })} error={errors[`rooms.${i}.roomNo`]} placeholder="104" />
              <Input label="Floor" inputMode="numeric" value={r.floor} onChange={(e) => set(i, { floor: e.target.value.replace(/\D/g, "").slice(0, 2) })} error={errors[`rooms.${i}.floor`]} placeholder="0" />
              <div className="pt-7">
                <Checkbox label="In use" checked={r.active} onChange={(e) => set(i, { active: e.target.checked })} />
              </div>
              <div className="pt-6">
                <IconButton icon="trash" label={`Remove room ${i + 1}`} disabled={rooms.length === 1} onClick={() => setRooms(rooms.filter((_, k) => k !== i))} />
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button size="sm" icon="plus" onClick={() => setRooms([...rooms, newRoom(rooms[rooms.length - 1]?.floor ?? "")])}>
              Add a room
            </Button>
            <span className="text-small text-ink-muted">Floor 0 is the ground floor. Untick "In use" for a room that is closed; its history stays.</span>
          </div>
          {errors.rooms && <span className="mtb-error">{errors.rooms}</span>}
        </fieldset>
        <Switch label="In use" checked={active} onChange={(e) => setActive(e.target.checked)} />
        <StaleNote
          error={m.error}
          onReload={() => {
            void qc.invalidateQueries({ queryKey: ["warehouse"] });
            onClose();
          }}
        />
        {errors.form && errorCode(m.error) !== "CONCURRENCY" && <Banner tone="danger">{errors.form}</Banner>}
      </div>
    </SidePanel>
  );
}

/** Room list, department by department (legacy Room Info report). */
function RoomList({ departments, floor, campus }: { departments: WarehouseDepartment[]; floor: string; campus: string }) {
  const groups = departments.map((d) => ({ d, rooms: d.rooms.filter((r) => r.active && (floor === "" || String(r.floor ?? "") === floor)).sort((a, b) => (a.floor ?? 99) - (b.floor ?? 99) || a.roomNo.localeCompare(b.roomNo, undefined, { numeric: true })) })).filter((g) => g.rooms.length);
  const total = groups.reduce((a, g) => a + g.rooms.length, 0);
  let sr = 0;
  return (
    <div className="ops-doc">
      <DocHead title="Room list" subtitle={`${groups.length} departments · ${total} rooms in use${floor !== "" ? ` · floor ${floorText(Number(floor))}` : ""}`} campus={campus} />
      <table>
        <thead>
          <tr>
            <th className="n">Sr</th>
            <th>Floor</th>
            <th>Room no.</th>
            <th>Room name</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.d.id}>
              <tr>
                <th colSpan={4}>Department: {g.d.name}</th>
              </tr>
              {g.rooms.map((r) => (
                <tr key={`${g.d.id}-${r.name}`}>
                  <td className="n">{++sr}</td>
                  <td>{floorText(r.floor)}</td>
                  <td>{r.roomNo || "—"}</td>
                  <td>{r.name}</td>
                </tr>
              ))}
              <tr className="tot">
                <td colSpan={3}>Total rooms in {g.d.name}</td>
                <td className="n">{g.rooms.length}</td>
              </tr>
            </Fragment>
          ))}
          <tr className="tot">
            <td colSpan={3}>Total count</td>
            <td className="n">{total}</td>
          </tr>
        </tbody>
      </table>
      <SignLines />
    </div>
  );
}

export function ItemsPage() {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const canManage = useCan("warehouse.manage") && !readOnly;
  const items = useQuery(warehouseQueries.items(ctx));
  const setup = useQuery(warehouseQueries.setup(ctx));
  const [tab, setTab] = useState("items");
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editItem, setEditItem] = useState<WarehouseItem | null | "new">(null);
  const [editCat, setEditCat] = useState<WarehouseCategory | null | "new">(null);
  const [editDep, setEditDep] = useState<WarehouseDepartment | null | "new">(null);
  const [depFilter, setDepFilter] = useState("");
  const [floorFilter, setFloorFilter] = useState("");
  const printer = usePrinter();
  const departments = setup.data?.departments ?? [];
  const floors = [...new Set(departments.flatMap((d) => d.rooms.map((r) => r.floor)).filter((f): f is number => f !== null))].sort((a, b) => a - b);
  const depRows = departments.filter((d) => (!depFilter || d.id === depFilter) && (floorFilter === "" || d.rooms.some((r) => String(r.floor ?? "") === floorFilter)));
  const rows = (items.data ?? []).filter((i) => (showInactive || i.active) && (!cat || i.categoryId === cat) && (!search.trim() || `${i.name} ${i.code} ${i.group}`.toLowerCase().includes(search.trim().toLowerCase())));
  const itemCols: Array<Column<WarehouseItem>> = [
    { key: "code", header: "Code", width: 90, render: (i) => <span className="mtb-mono">{i.code}</span> },
    { key: "name", header: "Item", render: (i) => <span className="grid"><span className="font-medium">{i.name}</span><span className="text-small text-ink-muted">{i.group} · {i.category}{ctx.campus === "ALL" ? ` · ${campusLabel(i.campus)}` : ""}</span></span> },
    { key: "unit", header: "Unit", render: (i) => i.unit },
    { key: "kind", header: "Kind", render: (i) => <span className="text-small">{i.consumable ? "Used up" : "Kept in rooms"}</span> },
    { key: "reorder", header: "Reorder at", align: "right", render: (i) => <span className="mtb-num">{formatCount(i.reorderLevel)}</span> },
    { key: "price", header: "Shop price", align: "right", render: (i) => (i.salePrice ? <span className="mtb-num">{formatRs(i.salePrice)}</span> : <span className="text-ink-subtle">—</span>) },
    { key: "status", header: "Stock", render: (i) => (i.active ? <StockBadge status={i.status} /> : <StatusBadge status="neutral">Not in use</StatusBadge>) },
  ];
  return (
    <WarehouseShell
      title="Items and rooms"
      actions={
        canManage ? (
          tab === "items" ? (
            <Button variant="primary" icon="plus" onClick={() => setEditItem("new")}>
              Add an item
            </Button>
          ) : tab === "categories" ? (
            <Button variant="primary" icon="plus" onClick={() => setEditCat("new")}>
              Add a category
            </Button>
          ) : (
            <Button variant="primary" icon="plus" onClick={() => setEditDep("new")}>
              Add a department
            </Button>
          )
        ) : undefined
      }
    >
      {(items.isError || setup.isError) && <LoadError what="Items" error={items.error ?? setup.error} onRetry={() => { void items.refetch(); void setup.refetch(); }} />}
      <Tabs
        aria-label="Items and rooms"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "items", label: "Items", icon: "layers", ...(items.data ? { count: items.data.filter((i) => i.active).length } : {}) },
          { id: "categories", label: "Categories", icon: "folder", ...(setup.data ? { count: setup.data.categories.length } : {}) },
          { id: "rooms", label: "Departments and rooms", icon: "building", ...(setup.data ? { count: setup.data.departments.length } : {}) },
        ]}
      />
      <TabPanel id="items" active={tab === "items"}>
        <DataTable
          caption="Warehouse items"
          rows={rows}
          loading={items.isLoading}
          columns={itemCols}
          onRowClick={canManage ? (i) => setEditItem(i) : undefined}
          toolbar={
            <div className="flex w-full flex-wrap items-end gap-3">
              <div className="min-w-[220px] flex-1">
                <Input label="Search" icon="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, code or family" />
              </div>
              <Select label="Category" value={cat} onChange={(e) => setCat(e.target.value)} options={[{ value: "", label: "All categories" }, ...(setup.data?.categories ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
              <Checkbox label="Show items not in use" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            </div>
          }
          empty={<EmptyState icon="layers" title="No items match" />}
        />
      </TabPanel>
      <TabPanel id="categories" active={tab === "categories"}>
        <DataTable
          caption="Item categories"
          rows={setup.data?.categories ?? []}
          loading={setup.isLoading}
          onRowClick={canManage ? (c) => setEditCat(c) : undefined}
          columns={[
            { key: "name", header: "Category", render: (c) => <span className="font-medium">{c.name}</span> },
            { key: "sale", header: "Book shop", render: (c) => (c.forSale ? <StatusBadge status="info">Sold to students</StatusBadge> : <span className="text-ink-subtle">—</span>) },
            { key: "items", header: "Items", align: "right", render: (c) => <span className="mtb-num">{c.items}</span> },
            { key: "active", header: "Status", render: (c) => (c.active ? <StatusBadge status="paid">In use</StatusBadge> : <StatusBadge status="neutral">Not in use</StatusBadge>) },
          ]}
        />
      </TabPanel>
      <TabPanel id="rooms" active={tab === "rooms"}>
        <DataTable
          caption="Departments and rooms"
          rows={depRows}
          loading={setup.isLoading}
          onRowClick={canManage && ctx.campus !== "ALL" ? (d) => setEditDep(d) : undefined}
          toolbar={
            <div className="flex w-full flex-wrap items-end gap-3">
              <Select label="Department" value={depFilter} onChange={(e) => setDepFilter(e.target.value)} options={[{ value: "", label: "All departments" }, ...departments.map((d) => ({ value: d.id, label: ctx.campus === "ALL" ? `${d.name} · ${campusLabel(d.campus)}` : d.name }))]} />
              <Select label="Floor" value={floorFilter} onChange={(e) => setFloorFilter(e.target.value)} options={[{ value: "", label: "All floors" }, ...floors.map((f) => ({ value: String(f), label: floorText(f) }))]} />
              <span className="self-center text-small text-ink-muted">
                {depRows.reduce((a, d) => a + d.rooms.filter((r) => r.active && (floorFilter === "" || String(r.floor ?? "") === floorFilter)).length, 0)} rooms in use
              </span>
              <Button size="sm" icon="printer" className="ml-auto" disabled={!depRows.length} onClick={() => printer.print(<RoomList departments={depRows} floor={floorFilter} campus={campusLabel(ctx.campus)} />, "A4")}>
                Print room list
              </Button>
            </div>
          }
          columns={[
            { key: "name", header: "Department", render: (d) => <span className="grid"><span className="font-medium">{d.name}</span>{ctx.campus === "ALL" && <span className="text-small text-ink-muted">{campusLabel(d.campus)}</span>}{!d.active && <StatusBadge status="neutral">Not in use</StatusBadge>}</span> },
            {
              key: "rooms",
              header: "Rooms (number · floor)",
              render: (d) => (
                <span className="text-small">
                  {d.rooms
                    .filter((r) => floorFilter === "" || String(r.floor ?? "") === floorFilter)
                    .map((r) => {
                      const bits = [r.roomNo ? `room ${r.roomNo}` : "", r.floor !== null ? `floor ${floorText(r.floor).toLowerCase()}` : ""].filter(Boolean);
                      return `${r.name}${bits.length ? ` (${bits.join(", ")})` : ""}${r.active ? "" : " · not in use"}`;
                    })
                    .join("; ")}
                </span>
              ),
            },
            { key: "count", header: "Rooms", align: "right", render: (d) => <span className="mtb-num">{d.rooms.filter((r) => r.active).length}</span> },
            { key: "value", header: "Issued this session", align: "right", render: (d) => <span className="mtb-num">{formatRs(d.issuedThisSession)}</span> },
          ]}
          empty={<EmptyState icon="building" title={depFilter || floorFilter ? "No rooms match" : "No departments yet"} />}
        />
      </TabPanel>
      <CampusNote />
      {editItem && (
        <RequireSingleCampusOverlay onClose={() => setEditItem(null)}>
          <ItemForm item={editItem === "new" ? null : editItem} onClose={() => setEditItem(null)} />
        </RequireSingleCampusOverlay>
      )}
      {editCat && <CategoryForm cat={editCat === "new" ? null : editCat} onClose={() => setEditCat(null)} />}
      {editDep && (
        <RequireSingleCampusOverlay onClose={() => setEditDep(null)}>
          <DepartmentForm dep={editDep === "new" ? null : editDep} onClose={() => setEditDep(null)} />
        </RequireSingleCampusOverlay>
      )}
      {printer.element}
    </WarehouseShell>
  );
}
