import { newIdempotencyKey, warehouseApi, warehouseQueries, type OperationsPerson, type WarehouseBookSet, type WarehouseSale } from "@mtb/api";
import { formatCount, formatDate, formatDateTime, formatRs, formatTime } from "@mtb/domain";
import {
  AmountInput,
  AnimatedNumber,
  Banner,
  Button,
  Combobox,
  DataTable,
  EmptyState,
  IconButton,
  Input,
  Modal,
  Panel,
  Segmented,
  SidePanel,
  Skeleton,
  StatCard,
  StatusBadge,
  TabPanel,
  Tabs,
  Textarea,
  useToast,
  type Column,
} from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { RequireSingleCampus } from "../../app/shell/page";
import { errorText, LoadError, PersonPicker, slide, TODAY, usePrinter } from "../library/common";
import { WarehouseShell } from "./shared";

/* ---------------------------------------------------------------- Receipt (A5) */

export function ShopReceipt({ s, duplicate }: { s: WarehouseSale; duplicate?: boolean }) {
  const mark = s.status === "CANCELLED" ? "CANCELLED" : duplicate ? "DUPLICATE" : null;
  return (
    <article className="ops-receipt relative overflow-hidden border border-border shadow-sm" aria-label={`Receipt ${s.receiptNo}`}>
      {mark && (
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 grid place-content-center text-[54px] font-semibold tracking-[0.2em]" style={{ color: s.status === "CANCELLED" ? "var(--danger)" : "var(--ink-subtle)", opacity: 0.16, transform: "rotate(-24deg)" }}>
          {mark}
        </span>
      )}
      <header className="flex items-start justify-between gap-4 border-b border-border-strong pb-3">
        <div className="grid">
          <span className="text-title-2 text-brand-ink">MTB</span>
          <span className="font-medium">{s.campusName}</span>
          <span className="text-ink-muted">{s.campusAddress}</span>
        </div>
        <div className="grid justify-items-end text-right">
          <span className="text-title-3">Book shop receipt</span>
          <span className="mtb-mono">{s.receiptNo}</span>
          <span className="tabular-nums">
            {formatDate(s.at)}, {formatTime(s.at)}
          </span>
        </div>
      </header>
      <section className="grid gap-1 rounded-md bg-surface-sunken px-3 py-2">
        <span className="text-[14px] font-semibold">{s.studentName}</span>
        <span className="text-ink-muted">
          G.R. <span className="mtb-mono text-ink">{s.grNo}</span> · Class {s.classSection} · {s.relation} {s.father}
        </span>
      </section>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th className="n">Qty</th>
            <th className="n">Price</th>
            <th className="n">Amount</th>
          </tr>
        </thead>
        <tbody>
          {s.lines.map((l) => (
            <tr key={l.itemId}>
              <td>{l.itemName}</td>
              <td className="n">{l.qty}</td>
              <td className="n">{formatRs(l.price)}</td>
              <td className="n">{formatRs(l.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-baseline justify-between border-t border-border-strong pt-2">
        <span className="font-semibold">Total</span>
        <span className="text-title-3 tabular-nums">{formatRs(s.total)}</span>
      </div>
      <span className="text-ink-muted">{s.amountInWords}</span>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
        {s.payment === "CASH" ? (
          <>
            <dt className="text-ink-muted">Paid</dt>
            <dd className="m-0 text-right">Cash {s.received !== null ? formatRs(s.received) : ""}</dd>
            {s.change !== null && s.change > 0 && (
              <>
                <dt className="text-ink-muted">Change returned</dt>
                <dd className="m-0 text-right">{formatRs(s.change)}</dd>
              </>
            )}
          </>
        ) : (
          <>
            <dt className="text-ink-muted">Payment</dt>
            <dd className="m-0 text-right">Added to the fee account; pay with the next fee</dd>
          </>
        )}
        <dt className="text-ink-muted">Sold by</dt>
        <dd className="m-0 text-right">{s.soldBy}</dd>
      </dl>
      {s.status === "CANCELLED" && <p className="m-0 font-semibold text-danger-ink">Cancelled: {s.cancelReason}</p>}
      <p className="m-0 text-[10px] text-ink-muted">Unused items can be exchanged within 7 days with this receipt.</p>
    </article>
  );
}

function SaleModal({ sale, onClose }: { sale: WarehouseSale; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const canManage = useCan("warehouse.manage") && !readOnly;
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | undefined>();
  const printer = usePrinter();
  const cancel = useMutation({
    mutationFn: () => warehouseApi.cancelSale(ctx, sale.id, reason),
    onSuccess: (s) => {
      toast({ title: `${s.receiptNo} cancelled`, message: "The items are back in stock." });
      void qc.invalidateQueries({ queryKey: ["warehouse"] });
      void qc.invalidateQueries({ queryKey: ["fees"] });
      onClose();
    },
  });
  return (
    <SidePanel
      open
      wide
      onClose={onClose}
      title={sale.receiptNo}
      description={`${sale.studentName} · ${formatDateTime(sale.at)}`}
      footer={
        <>
          {canManage && sale.status === "POSTED" && sale.at.startsWith(TODAY) && !cancelling && (
            <Button variant="danger-quiet" onClick={() => setCancelling(true)}>
              Cancel sale
            </Button>
          )}
          <Button variant="primary" icon="printer" onClick={() => printer.print(<ShopReceipt s={sale} duplicate />, "A5")}>
            Print receipt
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {cancelling && (
          <div className="grid gap-3 rounded-md border border-border p-4">
            <Textarea label="Why is the sale cancelled?" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} error={err} />
            {cancel.isError && <Banner tone="danger">{errorText(cancel.error)}</Banner>}
            <div className="flex gap-2">
              <Button
                variant="danger"
                loading={cancel.isPending}
                onClick={() => {
                  if (reason.trim().length < 5) return setErr("Say why, in a few words.");
                  setErr(undefined);
                  cancel.mutate();
                }}
              >
                Cancel sale and restock
              </Button>
              <Button variant="quiet" onClick={() => setCancelling(false)}>
                Keep it
              </Button>
            </div>
          </div>
        )}
        <div className="overflow-x-auto rounded-md bg-surface-sunken p-4">
          <div style={{ zoom: 0.8 }}>
            <ShopReceipt s={sale} />
          </div>
        </div>
      </div>
      {printer.element}
    </SidePanel>
  );
}

/* ---------------------------------------------------------------- Counter */

interface CartLine {
  itemId: string;
  qty: number;
}

function Counter() {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const canManage = useCan("warehouse.manage") && !readOnly;
  const shop = useQuery(warehouseQueries.shop(ctx));
  const today = useQuery(warehouseQueries.sales(ctx, TODAY));
  const [student, setStudent] = useState<OperationsPerson | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [pick, setPick] = useState<string | null>(null);
  const [payment, setPayment] = useState<"CASH" | "FEE_ACCOUNT">("CASH");
  const [received, setReceived] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<WarehouseSale | null>(null);
  const [open, setOpen] = useState<WarehouseSale | null>(null);
  const key = useMemo(() => newIdempotencyKey(), [student?.id, cart, payment]);
  const printer = usePrinter();
  const items = shop.data?.items ?? [];
  const byId = new Map(items.map((i) => [i.id, i]));
  const classShort = student?.detail.split("-")[0] ?? "";
  const set: WarehouseBookSet | undefined = shop.data?.bookSets.find((b) => b.classShort === classShort);
  const total = cart.reduce((a, l) => a + l.qty * (byId.get(l.itemId)?.salePrice ?? 0), 0);
  const add = (itemId: string, qty = 1) => setCart((c) => (c.some((l) => l.itemId === itemId) ? c.map((l) => (l.itemId === itemId ? { ...l, qty: l.qty + qty } : l)) : [...c, { itemId, qty }]));
  const post = useMutation({
    mutationFn: () => warehouseApi.postSale(ctx, { grNo: student!.id, payment, received: payment === "CASH" ? received : null, lines: cart }, key),
    onSuccess: (s) => {
      toast({ title: `${s.receiptNo} posted`, message: `${formatRs(s.total)} · ${s.payment === "CASH" ? "cash" : "added to the fee account"}. Stock deducted.` });
      void qc.invalidateQueries({ queryKey: ["warehouse"] });
      void qc.invalidateQueries({ queryKey: ["fees"] });
      setDone(s);
      setCart([]);
      setReceived(null);
      setStudent(null);
    },
  });
  const submit = () => {
    const e: Record<string, string> = {};
    if (!student) e.student = "Choose the student.";
    if (cart.length === 0) e.cart = "Add at least one item.";
    for (const l of cart) {
      const it = byId.get(l.itemId);
      if (it && l.qty > it.onHand) e[`q-${l.itemId}`] = it.onHand === 0 ? "Out of stock." : `Only ${it.onHand} left.`;
    }
    if (payment === "CASH" && (received === null || received < total)) e.received = `Cash received must be at least ${formatRs(total)}.`;
    setErrors(e);
    if (Object.keys(e).length === 0) post.mutate();
  };
  const t = shop.data?.today;

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Sales today", value: t?.sales ?? 0, icon: "receipt" as const, money: false, foot: "Receipts posted at this counter" },
          { label: "Cash today", value: t?.cash ?? 0, icon: "fees" as const, money: true, foot: "Hand over with the day's cash" },
          { label: "On fee accounts today", value: t?.feeAccount ?? 0, icon: "students" as const, money: true, foot: "Collected with the next fee" },
        ].map((k, i) => (
          <div key={k.label} className="mtb-rise" style={slide(i)}>
            <StatCard loading={shop.isLoading} label={k.label} icon={k.icon} value={<AnimatedNumber value={k.value} format={k.money ? formatRs : formatCount} />} foot={k.foot} />
          </div>
        ))}
      </div>
      {shop.isError && <LoadError what="The shop" error={shop.error} onRetry={() => void shop.refetch()} />}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel id="shop-sale" rise={1} title="New sale" description="Books, uniform and stationery for a student. The receipt prints on A5 and the stock goes down at once.">
          {!canManage ? (
            <EmptyState icon="lock" title={readOnly ? "This session is closed" : "Your role can view sales but not sell"} />
          ) : (
            <div className="grid gap-4">
              {done && (
                <Banner
                  tone="success"
                  icon="checkCircle"
                  title={`${done.receiptNo} posted · ${formatRs(done.total)}`}
                  actions={
                    <Button size="sm" variant="primary" icon="printer" onClick={() => printer.print(<ShopReceipt s={done} />, "A5")}>
                      Print receipt
                    </Button>
                  }
                >
                  {done.studentName} · {done.payment === "CASH" ? `cash${done.change ? `, change ${formatRs(done.change)}` : ""}` : "added to the fee account"}
                </Banner>
              )}
              <PersonPicker label="Student" type="STUDENT" value={student} onChange={(p) => { setStudent(p); setDone(null); }} error={errors.student} autoFocus />
              {student && set && (
                <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface-sunken p-3">
                  <span className="grid flex-1">
                    <span className="font-medium">{set.name}</span>
                    <span className="text-small text-ink-muted">
                      {set.lines.length} books · {formatRs(set.total)}
                    </span>
                  </span>
                  <Button size="sm" icon="plus" onClick={() => set.lines.forEach((l) => add(l.itemId, l.qty))}>
                    Add the whole set
                  </Button>
                </div>
              )}
              <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <Combobox
                  label="Add an item"
                  options={items.map((i) => ({ value: i.id, label: i.name, hint: `${formatRs(i.salePrice ?? 0)} · ${i.onHand} left`, keywords: [i.code, i.category] }))}
                  value={pick}
                  onValueChange={(v) => {
                    add(v);
                    setPick(null);
                  }}
                  placeholder="Book, uniform or stationery"
                  searchPlaceholder="Name or code"
                />
              </div>
              {cart.length === 0 ? (
                <p className="m-0 rounded-md border border-dashed border-border p-4 text-center text-small text-ink-muted">{errors.cart ?? "Nothing added yet."}</p>
              ) : (
                <ul className="m-0 grid list-none gap-2 p-0">
                  {cart.map((l, i) => {
                    const it = byId.get(l.itemId);
                    if (!it) return null;
                    return (
                      <li key={l.itemId} className="mtb-slide-in grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-md border border-border px-3 py-2" style={slide(i)}>
                        <span className="grid min-w-0">
                          <span className="truncate font-medium">{it.name}</span>
                          <span className={`text-small ${errors[`q-${l.itemId}`] ? "text-danger-ink" : "text-ink-muted"}`}>{errors[`q-${l.itemId}`] ?? `${formatRs(it.salePrice ?? 0)} each · ${it.onHand} left`}</span>
                        </span>
                        <span className="flex items-center gap-1">
                          <IconButton icon="minus" size="sm" label={`One less ${it.name}`} onClick={() => setCart((c) => c.map((x) => (x.itemId === l.itemId ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))} />
                          <span className="mtb-num w-8 text-center">{l.qty}</span>
                          <IconButton icon="plus" size="sm" label={`One more ${it.name}`} onClick={() => add(l.itemId)} />
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="mtb-num w-24 text-right font-medium">{formatRs(l.qty * (it.salePrice ?? 0))}</span>
                          <IconButton icon="x" size="sm" label={`Remove ${it.name}`} onClick={() => setCart((c) => c.filter((x) => x.itemId !== l.itemId))} />
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="flex items-baseline justify-between border-t border-border pt-3">
                <span className="font-semibold">Total</span>
                <span className="text-title-2 mtb-num">{formatRs(total)}</span>
              </div>
              <Segmented
                aria-label="Payment"
                value={payment}
                onChange={(v) => setPayment(v as "CASH" | "FEE_ACCOUNT")}
                options={[
                  { value: "CASH", label: "Cash now" },
                  { value: "FEE_ACCOUNT", label: "Add to fee account" },
                ]}
              />
              {payment === "CASH" ? (
                <div className="grid items-end gap-3 sm:grid-cols-2">
                  <AmountInput label="Cash received" value={received} onValueChange={setReceived} error={errors.received} />
                  <span className="pb-2 text-small text-ink-muted">{received !== null && received >= total && total > 0 ? `Change to return: ${formatRs(received - total)}` : ""}</span>
                </div>
              ) : (
                <p className="m-0 text-small text-ink-muted">The amount shows on the student's fee account and at the fee counter, and is collected with the next fee.</p>
              )}
              {post.isError && <Banner tone="danger">{errorText(post.error)}</Banner>}
              <Button variant="primary" size="lg" icon="check" loading={post.isPending} loadingLabel="Posting…" onClick={submit} disabled={cart.length === 0}>
                Post sale · {formatRs(total)}
              </Button>
            </div>
          )}
        </Panel>
        <Panel id="shop-today" rise={2} title="Today's sales" description="Open a sale to reprint its receipt or cancel it the same day." flush>
          {today.isLoading ? (
            <Skeleton height={200} />
          ) : (today.data ?? []).length === 0 ? (
            <EmptyState icon="receipt" title="No sales yet today" />
          ) : (
            <ul className="m-0 list-none p-0">
              {(today.data ?? []).map((s, i) => (
                <li key={s.id} className="mtb-slide-in border-b border-border last:border-b-0" style={slide(i)}>
                  <button type="button" className="flex w-full items-center gap-3 bg-transparent px-5 py-2.5 text-left text-ink hover:bg-surface-hover" onClick={() => setOpen(s)}>
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate font-medium">{s.studentName}</span>
                      <span className="text-small text-ink-muted">
                        {s.receiptNo} · {formatTime(s.at)} · {s.payment === "CASH" ? "Cash" : "Fee account"}
                      </span>
                    </span>
                    <span className={`mtb-num font-medium ${s.status === "CANCELLED" ? "mtb-strike text-ink-muted" : ""}`}>{formatRs(s.total)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      {open && <SaleModal sale={open} onClose={() => setOpen(null)} />}
      {printer.element}
    </div>
  );
}

/* ---------------------------------------------------------------- Sales and book sets */

function AllSales() {
  const ctx = useCtx();
  const q = useQuery(warehouseQueries.sales(ctx));
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<WarehouseSale | null>(null);
  const rows = (q.data ?? []).filter((s) => !search.trim() || `${s.receiptNo} ${s.studentName} ${s.grNo}`.toLowerCase().includes(search.trim().toLowerCase()));
  const total = rows.filter((s) => s.status === "POSTED").reduce((a, s) => a + s.total, 0);
  const columns: Array<Column<WarehouseSale>> = [
    { key: "no", header: "Receipt", render: (s) => <span className="grid"><span className="mtb-mono font-medium">{s.receiptNo}</span><span className="text-small text-ink-muted">{formatDateTime(s.at)}</span></span> },
    { key: "student", header: "Student", render: (s) => <span className="grid"><span>{s.studentName}</span><span className="text-small text-ink-muted">{s.grNo} · {s.classSection}</span></span> },
    { key: "items", header: "Items", render: (s) => <span className="text-small">{s.lines.length} {s.lines.length === 1 ? "item" : "items"}</span> },
    { key: "pay", header: "Payment", render: (s) => (s.payment === "CASH" ? "Cash" : "Fee account") },
    { key: "total", header: "Total", align: "right", render: (s) => <span className={`mtb-num font-medium ${s.status === "CANCELLED" ? "mtb-strike text-ink-muted" : ""}`}>{formatRs(s.total)}</span> },
    { key: "st", header: "Status", render: (s) => (s.status === "CANCELLED" ? <StatusBadge status="cancelled">Cancelled</StatusBadge> : <StatusBadge status="paid">Posted</StatusBadge>) },
  ];
  return (
    <>
      {q.isError && <LoadError what="Sales" error={q.error} onRetry={() => void q.refetch()} />}
      <DataTable
        caption="Book shop sales this session"
        rows={rows}
        loading={q.isLoading}
        columns={columns}
        onRowClick={setOpen}
        toolbar={
          <div className="flex w-full flex-wrap items-end gap-3">
            <div className="min-w-[240px] flex-1">
              <Input label="Search" icon="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Receipt, student or G.R. number" />
            </div>
            <span className="ml-auto self-center text-small text-ink-muted">
              {formatCount(rows.length)} sales · {formatRs(total)}
            </span>
          </div>
        }
        empty={<EmptyState icon="receipt" title="No sales this session" />}
      />
      {open && <SaleModal sale={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function BookSets() {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const canManage = useCan("warehouse.manage") && !readOnly;
  const shop = useQuery(warehouseQueries.shop(ctx));
  const [editing, setEditing] = useState<WarehouseBookSet | null>(null);
  const [lines, setLines] = useState<Array<{ itemId: string; qty: number }>>([]);
  const [pick, setPick] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => warehouseApi.saveBookSet(ctx, editing!.id, lines),
    onSuccess: (b) => {
      toast({ title: `${b.name} saved`, message: `${b.lines.length} items · ${formatRs(b.total)}` });
      void qc.invalidateQueries({ queryKey: ["warehouse"] });
      setEditing(null);
    },
  });
  const items = shop.data?.items ?? [];
  return (
    <div className="grid gap-4">
      <Banner tone="info" icon="info">
        A book set is everything a class needs. At the counter one click adds the whole set for the student's class (this replaces the old "recipe" set-up).
      </Banner>
      {shop.isLoading ? (
        <Skeleton height={200} />
      ) : (shop.data?.bookSets ?? []).length === 0 ? (
        <EmptyState icon="book" title="No book sets at this campus" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(shop.data?.bookSets ?? []).map((b, i) => (
            <Panel
              key={b.id}
              id={`set-${b.id}`}
              rise={i}
              title={b.name}
              description={`${b.lines.length} items · ${formatRs(b.total)}`}
              actions={
                canManage ? (
                  <Button
                    size="sm"
                    variant="quiet"
                    icon="edit"
                    onClick={() => {
                      setEditing(b);
                      setLines(b.lines.map((l) => ({ itemId: l.itemId, qty: l.qty })));
                    }}
                  >
                    Edit
                  </Button>
                ) : undefined
              }
            >
              <ul className="m-0 grid list-none gap-1 p-0 text-small">
                {b.lines.map((l) => (
                  <li key={l.itemId} className="flex justify-between gap-3">
                    <span>
                      {l.itemName}
                      {l.qty > 1 ? ` × ${l.qty}` : ""}
                    </span>
                    <span className="mtb-num text-ink-muted">{formatRs(l.price * l.qty)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      )}
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        size="lg"
        title={editing ? `Edit ${editing.name}` : ""}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" loading={save.isPending} disabled={lines.length === 0} onClick={() => save.mutate()}>
              Save set
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          {lines.map((l) => {
            const it = items.find((x) => x.id === l.itemId);
            return (
              <div key={l.itemId} className="flex items-center gap-3">
                <span className="flex-1">{it?.name ?? l.itemId}</span>
                <Input aria-label={`Quantity of ${it?.name ?? ""}`} inputMode="numeric" value={String(l.qty)} onChange={(e) => setLines(lines.map((x) => (x.itemId === l.itemId ? { ...x, qty: Math.max(1, Number(e.target.value.replace(/\D/g, "") || 1)) } : x)))} />
                <IconButton icon="trash" label={`Remove ${it?.name ?? ""}`} onClick={() => setLines(lines.filter((x) => x.itemId !== l.itemId))} />
              </div>
            );
          })}
          <Combobox
            label="Add an item"
            options={items.filter((i) => !lines.some((l) => l.itemId === i.id)).map((i) => ({ value: i.id, label: i.name, hint: formatRs(i.salePrice ?? 0) }))}
            value={pick}
            onValueChange={(v) => {
              setLines([...lines, { itemId: v, qty: 1 }]);
              setPick(null);
            }}
          />
          {save.isError && <Banner tone="danger">{errorText(save.error)}</Banner>}
        </div>
      </Modal>
    </div>
  );
}

export function ShopPage() {
  const [tab, setTab] = useState("counter");
  return (
    <WarehouseShell title="Book shop">
      <RequireSingleCampus action="the book shop">
        <Tabs
          aria-label="Book shop"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "counter", label: "Counter", icon: "receipt" },
            { id: "sales", label: "All sales", icon: "listChecks" },
            { id: "sets", label: "Book sets", icon: "book" },
          ]}
        />
        <TabPanel id="counter" active={tab === "counter"}>
          <Counter />
        </TabPanel>
        <TabPanel id="sales" active={tab === "sales"}>
          {tab === "sales" && <AllSales />}
        </TabPanel>
        <TabPanel id="sets" active={tab === "sets"}>
          {tab === "sets" && <BookSets />}
        </TabPanel>
      </RequireSingleCampus>
    </WarehouseShell>
  );
}
