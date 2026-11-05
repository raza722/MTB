import { newIdempotencyKey, warehouseApi, warehouseQueries, type WarehouseGrn } from "@mtb/api";
import { amountInWords, formatCount, formatDate, formatDateTime, formatRs } from "@mtb/domain";
import { AmountInput, Banner, Button, Combobox, DataTable, DatePicker, EmptyState, Input, KeyValue, Modal, Select, SidePanel, StatusBadge, Textarea, useToast, type Column } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useMemo, useState } from "react";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import { CampusNote, DocHead, errorField, errorText, inRange, LoadError, periodText, RequireSingleCampusOverlay, SignLines, TODAY, usePrinter } from "../library/common";
import { checkLines, itemOptions, LineEditor, newLine, WarehouseShell, type LineDraft } from "./shared";

function GrnDoc({ g, campus }: { g: WarehouseGrn; campus: string }) {
  return (
    <div className="ops-doc">
      <DocHead title={`Goods received note ${g.no}`} subtitle={g.status === "REVERSED" ? "REVERSED" : undefined} campus={campus} />
      <dl className="ops-doc-kv">
        <dt>Supplier</dt>
        <dd>{g.supplierName}</dd>
        <dt>Supplier invoice</dt>
        <dd>{g.supplierInvoiceNo}</dd>
        <dt>Received on</dt>
        <dd>{formatDate(g.date)}</dd>
        <dt>Received by</dt>
        <dd>{g.receivedBy}</dd>
      </dl>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th className="n">Qty</th>
            <th>Unit</th>
            <th className="n">Price</th>
            <th className="n">Discount</th>
            <th className="n">Total</th>
          </tr>
        </thead>
        <tbody>
          {g.lines.map((l) => (
            <tr key={l.itemId}>
              <td>{l.itemName}</td>
              <td className="n">{formatCount(l.qty)}</td>
              <td>{l.unit}</td>
              <td className="n">{formatRs(l.unitPrice)}</td>
              <td className="n">{l.discountPct ? `${l.discountPct}%` : "—"}</td>
              <td className="n">{formatRs(l.total)}</td>
            </tr>
          ))}
          {g.freight > 0 && (
            <tr>
              <td colSpan={5}>Freight</td>
              <td className="n">{formatRs(g.freight)}</td>
            </tr>
          )}
          {g.tax > 0 && (
            <tr>
              <td colSpan={5}>Sales tax</td>
              <td className="n">{formatRs(g.tax)}</td>
            </tr>
          )}
          <tr className="tot">
            <td colSpan={5}>Total ({amountInWords(g.total)})</td>
            <td className="n">{formatRs(g.total)}</td>
          </tr>
        </tbody>
      </table>
      {g.note && <p>Note: {g.note}</p>}
      {g.reversal && (
        <p>
          Reversed on {formatDateTime(g.reversal.at)} by {g.reversal.by}: {g.reversal.reason}
        </p>
      )}
      <div className="ops-doc-sign">
        <div>Store keeper</div>
        <div>Checked by</div>
        <div>Accounts</div>
      </div>
    </div>
  );
}

function NewGrn({ onClose }: { onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const items = useQuery(warehouseQueries.items(ctx));
  const suppliers = useQuery(warehouseQueries.suppliers(ctx));
  const [supplierId, setSupplierId] = useState("");
  const [invoice, setInvoice] = useState("");
  const [date, setDate] = useState<string | null>(TODAY);
  const [freight, setFreight] = useState<number | null>(0);
  const [tax, setTax] = useState<number | null>(0);
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const key = useMemo(() => newIdempotencyKey(), []);
  const all = items.data ?? [];
  const net = lines.reduce((a, l) => a + Math.round((l.qty ?? 0) * (l.unitPrice ?? 0) * (1 - (l.discountPct ?? 0) / 100)), 0);
  const post = useMutation({
    mutationFn: () =>
      warehouseApi.postGrn(ctx, { supplierId, supplierInvoiceNo: invoice.trim(), date: date!, freight: freight ?? 0, tax: tax ?? 0, note, lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty!, unitPrice: l.unitPrice!, discountPct: l.discountPct ?? 0 })) }, key),
    onSuccess: (g) => {
      toast({ title: `${g.no} posted`, message: `${g.lines.length} ${g.lines.length === 1 ? "item" : "items"} added to the store · ${formatRs(g.total)} from ${g.supplierName}.` });
      void qc.invalidateQueries({ queryKey: ["warehouse"] });
      onClose();
    },
    onError: (e) => {
      const f = errorField(e);
      if (f) setErrors({ [f]: errorText(e) });
    },
  });
  const submit = () => {
    const e = checkLines(lines, all, { price: true });
    if (!supplierId) e.supplierId = "Choose the supplier.";
    if (!invoice.trim()) e.supplierInvoiceNo = "Enter the supplier's invoice or bill number.";
    if (!date) e.date = "Enter the date the goods arrived.";
    else if (date > TODAY) e.date = "The date can't be in the future.";
    if (freight === null || freight < 0) e.freight = "Enter freight in whole rupees, or 0.";
    if (tax === null || tax < 0) e.tax = "Enter sales tax in whole rupees, or 0.";
    setErrors(e);
    if (Object.keys(e).length === 0) post.mutate();
  };
  return (
    <SidePanel
      open
      wide
      onClose={onClose}
      title="Receive goods"
      description="Everything on the supplier's bill. Posting adds it to the store at the price paid."
      footer={
        <>
          <span className="mr-auto text-small text-ink-muted">
            Total <span className="mtb-num font-semibold text-ink">{formatRs(net + (freight ?? 0) + (tax ?? 0))}</span>
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="check" loading={post.isPending} loadingLabel="Posting…" onClick={submit}>
            Post receipt
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Select label="Supplier" required value={supplierId} onChange={(e) => setSupplierId(e.target.value)} error={errors.supplierId} options={[{ value: "", label: "Choose…" }, ...(suppliers.data ?? []).filter((s) => s.active).map((s) => ({ value: s.id, label: s.name }))]} />
          <Input label="Supplier's invoice no." required mono value={invoice} onChange={(e) => setInvoice(e.target.value)} error={errors.supplierInvoiceNo} help="The same bill can't be received twice." />
          <DatePicker label="Received on" value={date} onValueChange={setDate} maxDate={TODAY} today={TODAY} error={errors.date} />
        </div>
        <LineEditor items={all} lines={lines} onChange={setLines} errors={errors} price stock={false} />
        <div className="grid gap-4 sm:grid-cols-2">
          <AmountInput label="Freight and loading" value={freight} onValueChange={setFreight} error={errors.freight} />
          <AmountInput label="Sales tax" value={tax} onValueChange={setTax} error={errors.tax} help="As shown on the supplier's bill. 0 if none." />
        </div>
        <Textarea label="Note (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        {post.isError && !errorField(post.error) && <Banner tone="danger">{errorText(post.error)}</Banner>}
      </div>
    </SidePanel>
  );
}

function GrnPanel({ g, onClose }: { g: WarehouseGrn; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const canManage = useCan("warehouse.manage") && !readOnly;
  const [reversing, setReversing] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | undefined>();
  const printer = usePrinter();
  const rev = useMutation({
    mutationFn: () => warehouseApi.reverseGrn(ctx, g.id, reason),
    onSuccess: (x) => {
      toast({ title: `${x.no} reversed`, message: "The items were taken out of the store. Post a new receipt with the right figures." });
      void qc.invalidateQueries({ queryKey: ["warehouse"] });
      setReversing(false);
      onClose();
    },
  });
  return (
    <SidePanel
      open
      wide
      onClose={onClose}
      title={g.no}
      description={`${g.supplierName} · invoice ${g.supplierInvoiceNo} · ${formatDate(g.date)}`}
      footer={
        <>
          <Button icon="printer" onClick={() => printer.print(<GrnDoc g={g} campus={campusLabel(g.campus)} />)}>
            Print
          </Button>
          {canManage && g.status === "POSTED" && (
            <Button variant="danger-quiet" icon="refresh" onClick={() => setReversing(true)}>
              Reverse
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-5">
        {g.status === "REVERSED" && g.reversal && (
          <Banner tone="neutral" icon="refresh" title={`Reversed on ${formatDateTime(g.reversal.at)} by ${g.reversal.by}`}>
            {g.reversal.reason}
          </Banner>
        )}
        <KeyValue
          items={[
            ["Received by", `${g.receivedBy}, ${formatDateTime(g.postedAt)}`],
            ["Before discount", formatRs(g.subtotal)],
            ["Discount", g.discount ? formatRs(g.discount) : "None"],
            ["Freight", g.freight ? formatRs(g.freight) : "None"],
            ["Sales tax", g.tax ? formatRs(g.tax) : "None"],
            ["Total", <span className="font-semibold">{formatRs(g.total)}</span>],
            ...(g.note ? ([["Note", g.note]] as Array<[string, string]>) : []),
          ]}
        />
        <DataTable
          caption="Items received"
          rowKey="itemId"
          rows={g.lines}
          density="dense"
          columns={[
            { key: "item", header: "Item", render: (l) => l.itemName },
            { key: "qty", header: "Qty", align: "right", render: (l) => <span className="mtb-num">{formatCount(l.qty)} {l.unit.toLowerCase()}</span> },
            { key: "price", header: "Price", align: "right", render: (l) => <span className="mtb-num">{formatRs(l.unitPrice)}</span> },
            { key: "disc", header: "Discount", align: "right", render: (l) => (l.discountPct ? `${l.discountPct}%` : "—") },
            { key: "total", header: "Total", align: "right", render: (l) => <span className="mtb-num font-medium">{formatRs(l.total)}</span> },
          ]}
        />
        <p className="m-0 text-small text-ink-muted">A posted receipt is never edited. If a figure is wrong, reverse it and post it again; both stay on the stock ledger.</p>
      </div>
      <Modal
        open={reversing}
        onClose={() => setReversing(false)}
        title={`Reverse ${g.no}?`}
        description="Every item on it is taken back out of the store. This can't be undone; post a new receipt afterwards if needed."
        footer={
          <>
            <Button onClick={() => setReversing(false)}>Cancel</Button>
            <Button
              variant="danger"
              loading={rev.isPending}
              onClick={() => {
                if (reason.trim().length < 5) return setErr("Say why it is being reversed (a few words).");
                setErr(undefined);
                rev.mutate();
              }}
            >
              Reverse receipt
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <Textarea label="Reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} error={err} placeholder="Wrong quantity typed: 40 registers, not 400" />
          {rev.isError && <Banner tone="danger">{errorText(rev.error)}</Banner>}
        </div>
      </Modal>
      {printer.element}
    </SidePanel>
  );
}

/* ---------------------------------------------------------------- Purchase register */

interface RegisterReceipt {
  g: WarehouseGrn;
  lines: WarehouseGrn["lines"];
  /** Every line shown: freight and tax belong to the receipt. With an item or kind filter only those lines count. */
  whole: boolean;
  total: number;
}

/** Purchases for a period, supplier by supplier and receipt by receipt, with the item lines (legacy purchase invoice report). */
function PurchaseRegister({ receipts, kindOf, subtitle, campus }: { receipts: RegisterReceipt[]; kindOf: (itemId: string) => string; subtitle: string; campus: string }) {
  const bySupplier = new Map<string, RegisterReceipt[]>();
  for (const r of receipts) bySupplier.set(r.g.supplierName, [...(bySupplier.get(r.g.supplierName) ?? []), r]);
  const counted = (list: RegisterReceipt[]) => list.filter((r) => r.g.status === "POSTED").reduce((a, r) => a + r.total, 0);
  const reversed = receipts.filter((r) => r.g.status === "REVERSED").length;
  let sr = 0;
  return (
    <div className="ops-doc">
      <DocHead title="Purchase register" subtitle={subtitle} campus={campus} />
      <table>
        <thead>
          <tr>
            <th className="n">Sr</th>
            <th>Item</th>
            <th>Kind</th>
            <th className="n">Qty</th>
            <th className="n">Price</th>
            <th className="n">Net amount</th>
            <th className="n">Discount</th>
            <th className="n">Line total</th>
          </tr>
        </thead>
        <tbody>
          {[...bySupplier.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([supplier, list]) => (
              <Fragment key={supplier}>
                <tr>
                  <th colSpan={8}>Supplier: {supplier}</th>
                </tr>
                {list.map((r) => (
                  <Fragment key={r.g.id}>
                    <tr>
                      <td colSpan={8}>
                        <strong>{r.g.no}</strong> · invoice {r.g.supplierInvoiceNo} · {formatDate(r.g.date)}
                        {r.g.status === "REVERSED" ? " · REVERSED, not counted in the totals" : ""}
                      </td>
                    </tr>
                    {r.lines.map((l) => (
                      <tr key={`${r.g.id}-${l.itemId}`}>
                        <td className="n">{++sr}</td>
                        <td>{l.itemName}</td>
                        <td>{kindOf(l.itemId)}</td>
                        <td className="n">
                          {formatCount(l.qty)} {l.unit.toLowerCase()}
                        </td>
                        <td className="n">{formatRs(l.unitPrice)}</td>
                        <td className="n">{formatRs(l.qty * l.unitPrice)}</td>
                        <td className="n">{l.discountPct ? `${l.discountPct}%` : "—"}</td>
                        <td className="n">{formatRs(l.total)}</td>
                      </tr>
                    ))}
                    {r.whole && r.g.freight > 0 && (
                      <tr>
                        <td colSpan={7}>Freight</td>
                        <td className="n">{formatRs(r.g.freight)}</td>
                      </tr>
                    )}
                    {r.whole && r.g.tax > 0 && (
                      <tr>
                        <td colSpan={7}>Sales tax</td>
                        <td className="n">{formatRs(r.g.tax)}</td>
                      </tr>
                    )}
                    <tr>
                      <td colSpan={7}>
                        <strong>Total of {r.g.no}</strong>
                      </td>
                      <td className="n">
                        <strong className={r.g.status === "REVERSED" ? "mtb-strike" : undefined}>{formatRs(r.total)}</strong>
                      </td>
                    </tr>
                  </Fragment>
                ))}
                <tr className="tot">
                  <td colSpan={7}>
                    Total for {supplier} ({list.filter((r) => r.g.status === "POSTED").length} receipts)
                  </td>
                  <td className="n">{formatRs(counted(list))}</td>
                </tr>
              </Fragment>
            ))}
          <tr className="tot">
            <td colSpan={7}>Grand total{reversed ? ` (${reversed} reversed ${reversed === 1 ? "receipt" : "receipts"} not counted)` : ""}</td>
            <td className="n">{formatRs(counted(receipts))}</td>
          </tr>
        </tbody>
      </table>
      <p>Amount in words: {amountInWords(counted(receipts))}</p>
      <SignLines />
    </div>
  );
}

type Kind = "" | "USED" | "KEPT";

export function ReceivePage({ openNew, setOpenNew }: { openNew: boolean; setOpenNew: (v: boolean) => void }) {
  const ctx = useCtx();
  const readOnly = useReadOnly();
  const canManage = useCan("warehouse.manage") && !readOnly;
  const q = useQuery(warehouseQueries.grns(ctx));
  const suppliers = useQuery(warehouseQueries.suppliers(ctx));
  const items = useQuery(warehouseQueries.items(ctx));
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [itemId, setItemId] = useState("");
  const [kind, setKind] = useState<Kind>("");
  const [open, setOpen] = useState<WarehouseGrn | null>(null);
  const printer = usePrinter();
  const allItems = items.data ?? [];
  const consumable = useMemo(() => new Map(allItems.map((i) => [i.id, i.consumable])), [allItems]);
  const kindOf = (id: string) => (consumable.has(id) ? (consumable.get(id) ? "Used up" : "Kept") : "");
  const lineOk = (l: { itemId: string }) => (!itemId || l.itemId === itemId) && (!kind || consumable.get(l.itemId) === (kind === "USED"));
  const filtered = Boolean(from || to || supplierId || itemId || kind || search.trim());
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter(
      (g) =>
        inRange(g.date, from, to) &&
        (!supplierId || g.supplierId === supplierId) &&
        g.lines.some((l) => (!itemId || l.itemId === itemId) && (!kind || consumable.get(l.itemId) === (kind === "USED"))) &&
        (!s || `${g.no} ${g.supplierName} ${g.supplierInvoiceNo} ${g.lines.map((l) => l.itemName).join(" ")}`.toLowerCase().includes(s)),
    );
  }, [q.data, from, to, supplierId, itemId, kind, search, consumable]);
  const total = rows.filter((g) => g.status === "POSTED").reduce((a, g) => a + g.total, 0);
  const printRegister = () => {
    const lineFilter = Boolean(itemId || kind);
    const receipts: RegisterReceipt[] = [...rows]
      .sort((a, b) => a.supplierName.localeCompare(b.supplierName) || a.date.localeCompare(b.date) || a.no.localeCompare(b.no))
      .map((g) => {
        const lines = lineFilter ? g.lines.filter(lineOk) : g.lines;
        return { g, lines, whole: !lineFilter, total: lineFilter ? lines.reduce((a, l) => a + l.total, 0) : g.total };
      });
    const narrowed = [suppliers.data?.find((s) => s.id === supplierId)?.name, allItems.find((i) => i.id === itemId)?.name, kind ? (kind === "USED" ? "Used up" : "Kept") : undefined].filter(Boolean).join(" · ");
    const subtitle = [periodText(from, to, ctx.session), narrowed, lineFilter ? "item lines only; freight and tax not included" : ""].filter(Boolean).join(" · ");
    printer.print(<PurchaseRegister receipts={receipts} kindOf={kindOf} subtitle={subtitle} campus={campusLabel(ctx.campus)} />, "A4");
  };
  const columns: Array<Column<WarehouseGrn>> = [
    { key: "no", header: "Receipt", render: (g) => <span className="grid"><span className="mtb-mono font-medium">{g.no}</span><span className="text-small text-ink-muted">{formatDate(g.date)}{ctx.campus === "ALL" ? ` · ${campusLabel(g.campus)}` : ""}</span></span> },
    { key: "sup", header: "Supplier", render: (g) => <span className="grid"><span>{g.supplierName}</span><span className="text-small text-ink-muted">Invoice {g.supplierInvoiceNo}</span></span> },
    { key: "items", header: "Items", render: (g) => <span className="text-small">{g.lines.slice(0, 2).map((l) => l.itemName).join(", ")}{g.lines.length > 2 ? ` and ${g.lines.length - 2} more` : ""}</span> },
    { key: "total", header: "Total", align: "right", render: (g) => <span className={`mtb-num font-medium ${g.status === "REVERSED" ? "mtb-strike text-ink-muted" : ""}`}>{formatRs(g.total)}</span> },
    { key: "status", header: "Status", render: (g) => (g.status === "POSTED" ? <StatusBadge status="declared" icon="lock">Posted</StatusBadge> : <StatusBadge status="cancelled" icon="refresh">Reversed</StatusBadge>) },
    { key: "by", header: "Received by", render: (g) => <span className="text-small">{g.receivedBy}</span> },
  ];
  return (
    <WarehouseShell
      title="Goods received"
      actions={
        canManage && ctx.campus !== "ALL" ? (
          <Button variant="primary" icon="download" onClick={() => setOpenNew(true)}>
            Receive goods
          </Button>
        ) : undefined
      }
    >
      {q.isError && <LoadError what="Goods received notes" error={q.error} onRetry={() => void q.refetch()} />}
      <DataTable
        caption="Goods received notes"
        rows={rows}
        loading={q.isLoading}
        columns={columns}
        onRowClick={(g) => setOpen(g)}
        toolbar={
          <div className="grid w-full gap-3">
            <div className="flex w-full flex-wrap items-end gap-3">
              <DatePicker label="Received from" value={from} onValueChange={setFrom} />
              <DatePicker label="to" value={to} onValueChange={setTo} {...(from ? { minDate: from } : {})} />
              <Select label="Supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} options={[{ value: "", label: "All suppliers" }, ...(suppliers.data ?? []).map((s) => ({ value: s.id, label: s.name }))]} />
              <div className="min-w-[200px]">
                <Combobox label="Item" options={[{ value: "", label: "All items" }, ...itemOptions(allItems, false)]} value={itemId} onValueChange={setItemId} placeholder="All items" searchPlaceholder="Name or code" />
              </div>
              <Select
                label="Kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as Kind)}
                options={[
                  { value: "", label: "All" },
                  { value: "USED", label: "Used up" },
                  { value: "KEPT", label: "Kept in rooms" },
                ]}
              />
              <div className="min-w-[200px] flex-1">
                <Input label="Search" icon="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Receipt, supplier, invoice or item" />
              </div>
              {filtered && (
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() => {
                    setFrom(null);
                    setTo(null);
                    setSupplierId("");
                    setItemId("");
                    setKind("");
                    setSearch("");
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-small text-ink-muted">
                {formatCount(rows.length)} receipts · {formatRs(total)} {filtered ? "for these filters" : "this session"} (reversed receipts not counted)
              </span>
              <Button size="sm" icon="printer" disabled={!rows.length || items.isLoading} onClick={printRegister}>
                Print purchase register
              </Button>
            </div>
          </div>
        }
        empty={
          <EmptyState
            icon="download"
            title={filtered ? "No receipts match" : "No goods received this session"}
            description={filtered ? "Change or clear the filters." : "Receive a supplier's bill to add stock. The warehouse moved to this system on 01-Apr-2026 with a physical count."}
          />
        }
      />
      <CampusNote />
      {printer.element}
      {open && <GrnPanel g={open} onClose={() => setOpen(null)} />}
      {openNew && (
        <RequireSingleCampusOverlay onClose={() => setOpenNew(false)}>
          <NewGrn onClose={() => setOpenNew(false)} />
        </RequireSingleCampusOverlay>
      )}
    </WarehouseShell>
  );
}

