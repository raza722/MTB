import { WAREHOUSE_MOVEMENT_LABEL, warehouseQueries, type WarehouseItem, type WarehouseItemDetail, type WarehouseMovement, type WarehouseRoomStock } from "@mtb/api";
import { formatCount, formatDate, formatRs, type IsoDate } from "@mtb/domain";
import { AnimatedNumber, Button, DataTable, DatePicker, EmptyState, Input, KeyValue, Pagination, Segmented, Select, SidePanel, Skeleton, StatCard, type Column } from "@mtb/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { useCtx } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import { DocHead, inRange, LoadError, periodText, SignLines, slide, usePrinter } from "../library/common";
import { qtyText, StockBadge, WarehouseShell } from "./shared";

function StockList({ rows, campus }: { rows: WarehouseItem[]; campus: string }) {
  const value = rows.reduce((a, r) => a + Math.max(0, r.value), 0);
  return (
    <div className="ops-doc">
      <DocHead title="Current stock" subtitle={`${rows.length} items · value at average cost ${formatRs(value)}`} campus={campus} />
      <table>
        <thead>
          <tr>
            <th>Code</th>
            <th>Item</th>
            <th>Category</th>
            <th className="n">In store</th>
            <th>Unit</th>
            <th className="n">Reorder at</th>
            <th className="n">Avg cost</th>
            <th className="n">Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.code}</td>
              <td>{r.name}</td>
              <td>{r.category}</td>
              <td className="n">{formatCount(r.onHand)}</td>
              <td>{r.unit}</td>
              <td className="n">{r.reorderLevel}</td>
              <td className="n">{formatRs(r.avgCost)}</td>
              <td className="n">{formatRs(Math.max(0, r.value))}</td>
            </tr>
          ))}
          <tr className="tot">
            <td colSpan={7}>Total</td>
            <td className="n">{formatRs(value)}</td>
          </tr>
        </tbody>
      </table>
      <div className="ops-doc-sign">
        <div>Store keeper</div>
        <div>Checked by</div>
        <div>Principal</div>
      </div>
    </div>
  );
}

function Ledger({ item, rows, opening, period, campus }: { item: WarehouseItemDetail; rows: WarehouseMovement[]; opening: { on: IsoDate; balance: number } | null; period: string; campus: string }) {
  return (
    <div className="ops-doc">
      <DocHead title={`Stock ledger: ${item.name}`} subtitle={`${item.code} · ${item.category} · ${period} · ${qtyText(item.onHand, item.unit)} in store now`} campus={campus} />
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Document</th>
            <th>What happened</th>
            <th>From or to</th>
            <th className="n">In</th>
            <th className="n">Out</th>
            <th className="n">Balance</th>
            <th>By</th>
          </tr>
        </thead>
        <tbody>
          {opening && (
            <tr>
              <td colSpan={6}>Opening balance on {formatDate(opening.on)}</td>
              <td className="n">{opening.balance}</td>
              <td />
            </tr>
          )}
          {[...rows].reverse().map((m) => (
            <tr key={m.id}>
              <td>{formatDate(m.date)}</td>
              <td>{m.docNo}</td>
              <td>{WAREHOUSE_MOVEMENT_LABEL[m.type]}</td>
              <td>{m.party}</td>
              <td className="n">{m.qtyIn || ""}</td>
              <td className="n">{m.qtyOut || ""}</td>
              <td className="n">{m.balance}</td>
              <td>{m.by}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ItemPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const ctx = useCtx();
  const q = useQuery(warehouseQueries.item(ctx, id));
  const it = q.data;
  const [kind, setKind] = useState("ALL");
  const [from, setFrom] = useState<IsoDate | null>(null);
  const [to, setTo] = useState<IsoDate | null>(null);
  const printer = usePrinter();
  const inPeriod = (it?.movements ?? []).filter((m) => inRange(m.date, from, to));
  const rows = inPeriod.filter((m) => kind === "ALL" || (kind === "IN" ? m.qtyIn > 0 : m.qtyOut > 0));
  // Movements are newest first: the balance before the period is that of the latest movement before "from".
  const opening = from ? { on: from, balance: (it?.movements ?? []).find((m) => m.date < from)?.balance ?? 0 } : null;
  const columns: Array<Column<WarehouseMovement>> = [
    { key: "date", header: "Date", width: 104, render: (m) => <span className="mtb-num">{formatDate(m.date)}</span> },
    { key: "what", header: "What happened", render: (m) => <span className="grid"><span>{WAREHOUSE_MOVEMENT_LABEL[m.type]}</span><span className="text-small text-ink-muted">{m.docNo} · {m.party}</span>{m.note && <span className="text-small text-ink-muted">{m.note}</span>}</span> },
    { key: "in", header: "In", align: "right", render: (m) => (m.qtyIn ? <span className="mtb-num text-status-paid-ink">+{formatCount(m.qtyIn)}</span> : "") },
    { key: "out", header: "Out", align: "right", render: (m) => (m.qtyOut ? <span className="mtb-num">−{formatCount(m.qtyOut)}</span> : "") },
    { key: "bal", header: "Balance", align: "right", render: (m) => <span className="mtb-num font-medium">{formatCount(m.balance)}</span> },
  ];
  return (
    <SidePanel
      open
      wide
      onClose={onClose}
      title={it ? it.name : "Loading…"}
      description={it ? `${it.code} · ${it.category} · counted in ${it.unit.toLowerCase()}${it.consumable ? "" : " · kept, not used up"}` : undefined}
      footer={
        it ? (
          <Button icon="printer" onClick={() => printer.print(<Ledger item={it} rows={inPeriod} opening={opening} period={periodText(from, to, ctx.session)} campus={campusLabel(it.campus)} />)}>
            Print ledger
          </Button>
        ) : undefined
      }
    >
      {q.isError ? (
        <LoadError what="This item" error={q.error} onRetry={() => void q.refetch()} />
      ) : !it ? (
        <Skeleton height={300} />
      ) : (
        <div className="grid gap-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="In the store" value={qtyText(it.onHand, it.unit)} icon="warehouse" foot={<StockBadge status={it.status} />} />
            <StatCard label="Value" value={formatRs(Math.max(0, it.value))} icon="fees" foot={`${formatRs(it.avgCost)} each on average`} />
            <StatCard label={it.consumable ? "Reorder at" : "Out in rooms"} value={it.consumable ? formatCount(it.reorderLevel) : formatCount(it.inRooms)} icon={it.consumable ? "refresh" : "building"} foot={it.consumable ? "Shown as low at or below this" : "Issued and not returned"} />
          </div>
          <KeyValue
            items={[
              ["Bought from", it.suppliers.join(", ") || "No receipts yet"],
              ...(it.salePrice ? ([["Shop price", formatRs(it.salePrice)]] as Array<[string, string]>) : []),
              ...(it.rooms.length ? ([["Held in rooms", it.rooms.map((r) => `${r.location} (${r.qty})`).join(", ")]] as Array<[string, string]>) : []),
              ["Last movement", it.lastMovementOn ? formatDate(it.lastMovementOn) : "—"],
            ]}
          />
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h3 className="m-0 text-body font-semibold">Stock ledger</h3>
            <div className="flex flex-wrap items-end gap-3">
              <DatePicker label="From" value={from} onValueChange={setFrom} />
              <DatePicker label="To" value={to} onValueChange={setTo} {...(from ? { minDate: from } : {})} />
              <Segmented
                aria-label="Movements"
                value={kind}
                onChange={setKind}
                options={[
                  { value: "ALL", label: "All" },
                  { value: "IN", label: "In" },
                  { value: "OUT", label: "Out" },
                ]}
              />
            </div>
          </div>
          <p className="m-0 text-small text-ink-muted">
            Newest first. Every receipt, issue, return, sale and count adjustment is a row; corrections are new rows, never edits.
            {opening ? ` Balance on ${formatDate(opening.on)} before these movements: ${formatCount(opening.balance)}.` : ""}
          </p>
          <DataTable caption="Stock ledger" rows={rows} columns={columns} density="dense" maxHeight={420} empty={<EmptyState icon="inbox" title="No movements" />} />
        </div>
      )}
      {printer.element}
    </SidePanel>
  );
}

/* ---------------------------------------------------------------- Stock held in rooms */

/** Stock held in departments and rooms, family by family, with a total per item and per family (legacy Current Stock report). */
function RoomStockList({ rows, subtitle, campus }: { rows: WarehouseRoomStock[]; subtitle: string; campus: string }) {
  const families = new Map<string, Map<string, WarehouseRoomStock[]>>();
  for (const r of rows) {
    const fam = families.get(r.group) ?? new Map<string, WarehouseRoomStock[]>();
    fam.set(r.itemId, [...(fam.get(r.itemId) ?? []), r]);
    families.set(r.group, fam);
  }
  const sum = (list: WarehouseRoomStock[]) => list.reduce((a, r) => a + r.qty, 0);
  let sr = 0;
  return (
    <div className="ops-doc">
      <DocHead title="Stock in rooms" subtitle={subtitle} campus={campus} />
      <table>
        <thead>
          <tr>
            <th className="n">Sr</th>
            <th>Department</th>
            <th>Room</th>
            <th>Item</th>
            <th className="n">Held</th>
          </tr>
        </thead>
        <tbody>
          {[...families.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([family, items]) => (
              <Fragment key={family}>
                <tr>
                  <th colSpan={5}>Item family: {family}</th>
                </tr>
                {[...items.values()].map((list) => (
                  <Fragment key={list[0]!.itemId}>
                    {list.map((r) => (
                      <tr key={`${r.departmentId}-${r.room}-${r.itemId}`}>
                        <td className="n">{++sr}</td>
                        <td>{r.department}</td>
                        <td>{r.room}</td>
                        <td>{r.itemName}</td>
                        <td className="n">{qtyText(r.qty, r.unit)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={4} className="n">
                        <strong>Total {list[0]!.itemName}</strong>
                      </td>
                      <td className="n">
                        <strong>{qtyText(sum(list), list[0]!.unit)}</strong>
                      </td>
                    </tr>
                  </Fragment>
                ))}
                <tr className="tot">
                  <td colSpan={4}>Total {family}</td>
                  <td className="n">{formatCount(sum([...items.values()].flat()))}</td>
                </tr>
              </Fragment>
            ))}
        </tbody>
      </table>
      <SignLines />
    </div>
  );
}

function RoomStockView() {
  const ctx = useCtx();
  const setup = useQuery(warehouseQueries.setup(ctx));
  const [departmentId, setDept] = useState("");
  const [room, setRoom] = useState("");
  const [categoryId, setCat] = useState("");
  const [family, setFamily] = useState("");
  const [kind, setKind] = useState("");
  const q = useQuery({ ...warehouseQueries.roomStock(ctx, { departmentId, room, categoryId }), placeholderData: keepPreviousData });
  const printer = usePrinter();
  const departments = setup.data?.departments ?? [];
  const dep = departments.find((d) => d.id === departmentId);
  const roomChoices = [...new Map((dep ? dep.rooms : departments.flatMap((d) => d.rooms)).map((r) => [r.name, r])).values()];
  const all = q.data ?? [];
  const familyChoices = [...new Set(all.map((r) => r.group))].sort();
  const rows = all.filter((r) => (!family || r.group === family) && (!kind || (kind === "USED") === r.consumable)).map((r) => ({ ...r, id: `${r.departmentId}|${r.room}|${r.itemId}` }));
  const narrowed = [dep?.name, room || undefined, setup.data?.categories.find((c) => c.id === categoryId)?.name, family || undefined, kind ? (kind === "USED" ? "used-up items" : "kept items") : undefined].filter(Boolean).join(" · ");
  const columns: Array<Column<WarehouseRoomStock>> = [
    { key: "where", header: "Department · room", render: (r) => <span className="grid"><span className="font-medium">{r.room}</span><span className="text-small text-ink-muted">{r.department}</span></span> },
    { key: "item", header: "Item", render: (r) => <span className="grid"><span>{r.itemName}</span><span className="text-small text-ink-muted">{r.code} · {r.consumable ? "used up" : "kept in the room"}</span></span> },
    { key: "family", header: "Family", render: (r) => <span className="text-small">{r.group}</span> },
    { key: "qty", header: "Held", align: "right", render: (r) => <span className="mtb-num font-medium">{formatCount(r.qty)}</span> },
    { key: "unit", header: "Unit", width: 80, render: (r) => <span className="text-small text-ink-muted">{r.unit}</span> },
  ];
  return (
    <>
      {q.isError && <LoadError what="Stock in rooms" error={q.error} onRetry={() => void q.refetch()} />}
      <DataTable
        caption="Stock held in departments and rooms"
        rows={rows}
        loading={q.isLoading}
        columns={columns}
        toolbar={
          <div className="grid w-full gap-3">
            <div className="flex w-full flex-wrap items-end gap-3">
              <Select label="Department" value={departmentId} onChange={(e) => { setDept(e.target.value); setRoom(""); }} options={[{ value: "", label: "All departments" }, ...departments.map((d) => ({ value: d.id, label: d.name }))]} />
              <Select label="Room" value={room} onChange={(e) => setRoom(e.target.value)} options={[{ value: "", label: "All rooms" }, ...roomChoices.map((r) => ({ value: r.name, label: r.roomNo ? `${r.name} · room ${r.roomNo}` : r.name }))]} />
              <Select label="Category" value={categoryId} onChange={(e) => setCat(e.target.value)} options={[{ value: "", label: "All categories" }, ...(setup.data?.categories ?? []).filter((c) => !c.forSale).map((c) => ({ value: c.id, label: c.name }))]} />
              <Select label="Family" value={family} onChange={(e) => setFamily(e.target.value)} options={[{ value: "", label: "All families" }, ...familyChoices.map((f) => ({ value: f, label: f }))]} />
              <Segmented
                aria-label="Kind"
                value={kind}
                onChange={setKind}
                options={[
                  { value: "", label: "All" },
                  { value: "KEPT", label: "Kept" },
                  { value: "USED", label: "Used up" },
                ]}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-small text-ink-muted">Issued and not returned. Used-up items show what went to the room; they may be used by now.</span>
              <Button size="sm" icon="printer" disabled={!rows.length} onClick={() => printer.print(<RoomStockList rows={rows} subtitle={[`${rows.length} lines`, narrowed].filter(Boolean).join(" · ")} campus={campusLabel(ctx.campus)} />, "A4")}>
                Print stock in rooms
              </Button>
            </div>
          </div>
        }
        footer={rows.length ? { where: <span className="font-semibold">{formatCount(rows.length)} lines</span> } : undefined}
        empty={<EmptyState icon="building" title="Nothing held in these rooms" description="Change the filters, or issue stock to a room." />}
      />
      {printer.element}
    </>
  );
}

export function StockPage({ status, setStatus }: { status: string; setStatus: (s: string) => void }) {
  const [view, setView] = useState("store");
  if (view === "rooms") {
    return (
      <WarehouseShell title="Stock">
        <StockViewToggle value={view} onChange={setView} />
        <RoomStockView />
      </WarehouseShell>
    );
  }
  return <StoreStock status={status} setStatus={setStatus} toggle={<StockViewToggle value={view} onChange={setView} />} />;
}

function StockViewToggle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Segmented
      aria-label="Stock to show"
      value={value}
      onChange={onChange}
      options={[
        { value: "store", label: "In the store" },
        { value: "rooms", label: "In rooms" },
      ]}
    />
  );
}

function StoreStock({ status, setStatus, toggle }: { status: string; setStatus: (s: string) => void; toggle: ReactNode }) {
  const ctx = useCtx();
  const q = useQuery({ ...warehouseQueries.items(ctx), placeholderData: keepPreviousData });
  const setup = useQuery(warehouseQueries.setup(ctx));
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("");
  const [open, setOpen] = useState("");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const printer = usePrinter();
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? [])
      .filter((i) => i.active)
      .filter((i) => !s || `${i.name} ${i.code} ${i.group}`.toLowerCase().includes(s))
      .filter((i) => !cat || i.categoryId === cat)
      .filter((i) => (status === "LOW" ? i.status !== "OK" : status === "OUT" ? i.status === "OUT" : true));
  }, [q.data, search, cat, status]);
  useEffect(() => setPage(1), [search, cat, status, ctx.campus]);
  const value = rows.reduce((a, r) => a + Math.max(0, r.value), 0);
  const shown = rows.slice((page - 1) * size, page * size);
  const all = q.data ?? [];

  const columns: Array<Column<WarehouseItem>> = [
    { key: "name", header: "Item", render: (i) => <span className="grid"><span className="font-medium">{i.name}</span><span className="text-small text-ink-muted">{i.code} · {i.category}{ctx.campus === "ALL" ? ` · ${campusLabel(i.campus)}` : ""}</span></span> },
    { key: "onHand", header: "In store", align: "right", render: (i) => <span className={`mtb-num font-medium ${i.status === "OUT" ? "text-status-overdue-ink" : ""}`}>{formatCount(i.onHand)}</span> },
    { key: "unit", header: "Unit", width: 80, render: (i) => <span className="text-small text-ink-muted">{i.unit}</span> },
    { key: "reorder", header: "Reorder at", align: "right", render: (i) => <span className="mtb-num text-ink-muted">{formatCount(i.reorderLevel)}</span> },
    { key: "status", header: "Status", render: (i) => <StockBadge status={i.status} /> },
    { key: "rooms", header: "In rooms", align: "right", render: (i) => (i.consumable ? <span className="text-ink-subtle">—</span> : <span className="mtb-num">{formatCount(i.inRooms)}</span>) },
    { key: "value", header: "Value", align: "right", render: (i) => <span className="mtb-num">{formatRs(Math.max(0, i.value))}</span> },
    { key: "last", header: "Last moved", render: (i) => (i.lastMovementOn ? <span className="text-small">{formatDate(i.lastMovementOn)}</span> : "—") },
  ];

  return (
    <WarehouseShell
      title="Stock"
      actions={
        <Button icon="printer" disabled={!rows.length} onClick={() => printer.print(<StockList rows={rows} campus={campusLabel(ctx.campus)} />, "A4")}>
          Print current stock
        </Button>
      }
    >
      {toggle}
      {q.isError && <LoadError what="Stock" error={q.error} onRetry={() => void q.refetch()} />}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="mtb-rise" style={slide(0)}>
          <StatCard loading={q.isLoading} label="Value of what is shown" icon="fees" value={<AnimatedNumber value={value} format={formatRs} />} foot={`${formatCount(rows.length)} items`} />
        </div>
        <div className="mtb-rise" style={slide(1)}>
          <StatCard loading={q.isLoading} label="Below the reorder level" icon="alert" tone="warning" value={<AnimatedNumber value={all.filter((i) => i.active && i.status === "LOW").length} format={formatCount} />} foot="Order soon" onClick={() => setStatus("LOW")} />
        </div>
        <div className="mtb-rise" style={slide(2)}>
          <StatCard loading={q.isLoading} label="Out of stock" icon="ban" tone="danger" value={<AnimatedNumber value={all.filter((i) => i.active && i.status === "OUT").length} format={formatCount} />} foot="Can't be issued until received" onClick={() => setStatus("OUT")} />
        </div>
      </div>
      <DataTable
        caption="Stock in the store"
        rows={shown}
        loading={q.isLoading}
        columns={columns}
        onRowClick={(i) => setOpen(i.id)}
        toolbar={
          <div className="flex w-full flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1">
              <Input label="Search" icon="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Item name or code" />
            </div>
            <Select label="Category" value={cat} onChange={(e) => setCat(e.target.value)} options={[{ value: "", label: "All categories" }, ...(setup.data?.categories ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
            <Segmented
              aria-label="Stock level"
              value={status}
              onChange={setStatus}
              options={[
                { value: "", label: "All" },
                { value: "LOW", label: "Running low" },
                { value: "OUT", label: "Out of stock" },
              ]}
            />
          </div>
        }
        footer={rows.length ? { name: <span className="font-semibold">{formatCount(rows.length)} items</span>, value: <span className="mtb-num font-semibold">{formatRs(value)}</span> } : undefined}
        pagination={rows.length > size ? <Pagination page={page} pageSize={size} total={rows.length} onPageChange={setPage} onPageSizeChange={(s) => { setSize(s); setPage(1); }} /> : undefined}
        empty={<EmptyState icon="warehouse" title={status ? "Nothing is running low" : "No items match"} description={status ? "Every item is above its reorder level." : "Clear a filter or check the spelling."} />}
      />
      {open && <ItemPanel id={open} onClose={() => setOpen("")} />}
      {printer.element}
    </WarehouseShell>
  );
}
