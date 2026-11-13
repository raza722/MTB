import { WAREHOUSE_STOCK_STATUS_LABEL, type WarehouseItem, type WarehouseStockStatus } from "@mtb/api";
import { formatCount, formatRs } from "@mtb/domain";
import { AmountInput, Button, Combobox, IconButton, Input, StatusBadge, type ComboboxOption } from "@mtb/ui";
import type { ReactNode } from "react";
import type { SubNavItem } from "../../app/shell/SubNav";
import { ModuleShell } from "../library/common";

export const WAREHOUSE_NAV: SubNavItem[] = [
  { to: "/warehouse", label: "Overview", icon: "dashboard", exact: true },
  { to: "/warehouse/stock", label: "Stock", icon: "layers" },
  { to: "/warehouse/receive", label: "Goods received", icon: "download" },
  { to: "/warehouse/issue", label: "Issue and return", icon: "upload" },
  { to: "/warehouse/shop", label: "Book shop", icon: "receipt" },
  { to: "/warehouse/counts", label: "Stock count", icon: "checkSquare" },
  { to: "/warehouse/items", label: "Items and rooms", icon: "folder" },
  { to: "/warehouse/suppliers", label: "Suppliers", icon: "building" },
];

export function WarehouseShell(props: { title: string; context?: ReactNode; actions?: ReactNode; meta?: ReactNode; children: ReactNode }) {
  return <ModuleShell nav={WAREHOUSE_NAV} navLabel="Warehouse" readOnlyNote="Receipts, issues, sales and the stock ledger stay available to read and print." {...props} />;
}

export function StockBadge({ status }: { status: WarehouseStockStatus }) {
  return <StatusBadge status={status === "OK" ? "paid" : status === "LOW" ? "warning" : "overdue"}>{WAREHOUSE_STOCK_STATUS_LABEL[status]}</StatusBadge>;
}

/**
 * "—" for a text the record does not have. Migrated records leave some fields empty (spec 11_warehouse §5.3): a GRN's
 * supplier invoice no., who received an issue, who asked for a request, an issue line's remarks.
 */
export const orDash = (s: string | null | undefined): string => (s && s.trim() ? s : "—");

export const qtyText =(n: number, unit: string) => `${formatCount(n)} ${unit.toLowerCase()}${n === 1 || unit.endsWith("s") ? "" : unit === "Box" ? "es" : "s"}`;

export function itemOptions(items: WarehouseItem[], showStock = true): ComboboxOption[] {
  return items
    .filter((i) => i.active)
    .map((i) => ({ value: i.id, label: i.name, hint: showStock ? `${i.code} · ${formatCount(i.onHand)} in store` : i.code, keywords: [i.code, i.group, i.category] }));
}

export interface LineDraft {
  key: string;
  itemId: string;
  qty: number | null;
  unitPrice?: number | null;
  discountPct?: number | null;
  remarks?: string;
}

export const newLine = (): LineDraft => ({ key: Math.random().toString(36).slice(2), itemId: "", qty: null, unitPrice: null, discountPct: 0, remarks: "" });

/**
 * Item lines for a goods received note, an issue, a request or a count: pick an item, see what is in the store,
 * enter the quantity (and price for purchases). Errors are keyed "lines.<index>.<field>".
 */
export function LineEditor({
  items,
  lines,
  onChange,
  errors,
  price,
  remarks,
  stock = true,
  disabled,
}: {
  items: WarehouseItem[];
  lines: LineDraft[];
  onChange: (next: LineDraft[]) => void;
  errors: Record<string, string>;
  price?: boolean;
  remarks?: boolean;
  stock?: boolean;
  disabled?: boolean;
}) {
  const opts = itemOptions(items, stock);
  const set = (i: number, patch: Partial<LineDraft>) => onChange(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((a, l) => a + Math.round((l.qty ?? 0) * (l.unitPrice ?? 0) * (1 - (l.discountPct ?? 0) / 100)), 0);
  return (
    <div className="grid gap-3">
      {lines.map((l, i) => {
        const it = items.find((x) => x.id === l.itemId);
        const lineTotal = Math.round((l.qty ?? 0) * (l.unitPrice ?? 0) * (1 - (l.discountPct ?? 0) / 100));
        return (
          <div key={l.key} className="mtb-slide-in grid gap-3 rounded-md border border-border p-3" style={{ ["--i" as string]: Math.min(i, 8) }}>
            <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_120px_auto]">
              <Combobox label={`Item ${i + 1}`} options={opts} value={l.itemId || null} onValueChange={(v) => set(i, { itemId: v, ...(price && !l.unitPrice ? { unitPrice: items.find((x) => x.id === v)?.avgCost ?? null } : {}) })} placeholder="Choose an item" searchPlaceholder="Name or code" error={errors[`lines.${i}.itemId`]} disabled={disabled} />
              <Input label={it ? `Quantity (${it.unit.toLowerCase()})` : "Quantity"} inputMode="numeric" value={l.qty === null ? "" : String(l.qty)} onChange={(e) => set(i, { qty: e.target.value === "" ? null : Number(e.target.value.replace(/\D/g, "")) })} error={errors[`lines.${i}.qty`]} disabled={disabled} />
              <div className="pt-7">
                <IconButton icon="trash" label={`Remove line ${i + 1}`} disabled={disabled || lines.length === 1} onClick={() => onChange(lines.filter((_, k) => k !== i))} />
              </div>
            </div>
            {it && stock && (
              <span className={`text-small ${it.onHand <= 0 ? "text-status-overdue-ink" : it.status === "LOW" ? "text-warning-ink" : "text-ink-muted"}`}>
                {formatCount(it.onHand)} in the store{it.status !== "OK" ? ` · ${it.status === "OUT" ? "out of stock" : `below the reorder level of ${it.reorderLevel}`}` : ""}
                {!price && l.qty !== null && l.qty > it.onHand ? ` · only ${formatCount(it.onHand)} can go out` : ""}
              </span>
            )}
            {price && (
              <div className="grid gap-3 sm:grid-cols-3">
                <AmountInput label="Price of one" value={l.unitPrice ?? null} onValueChange={(v) => set(i, { unitPrice: v })} error={errors[`lines.${i}.unitPrice`]} disabled={disabled} />
                <Input label="Discount" suffix="%" inputMode="decimal" value={l.discountPct === null || l.discountPct === undefined ? "" : String(l.discountPct)} onChange={(e) => set(i, { discountPct: e.target.value === "" ? null : Number(e.target.value.replace(/[^\d.]/g, "")) })} error={errors[`lines.${i}.discountPct`]} disabled={disabled} />
                <div className="grid content-end pb-2 text-right">
                  <span className="text-small text-ink-muted">Line total</span>
                  <span className="mtb-num font-semibold">{formatRs(lineTotal)}</span>
                </div>
              </div>
            )}
            {remarks && <Input label="What it is for (optional)" value={l.remarks ?? ""} onChange={(e) => set(i, { remarks: e.target.value })} placeholder="Monthly test papers" disabled={disabled} />}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button size="sm" icon="plus" disabled={disabled} onClick={() => onChange([...lines, newLine()])}>
          Add another item
        </Button>
        {price && (
          <span className="text-small text-ink-muted">
            Items total <span className="mtb-num font-semibold text-ink">{formatRs(total)}</span>
          </span>
        )}
      </div>
      {errors.lines && <span className="mtb-error">{errors.lines}</span>}
    </div>
  );
}

/** Basic checks shared by every line form; the server checks stock again under lock. */
export function checkLines(lines: LineDraft[], items: WarehouseItem[], opts: { price?: boolean; stock?: boolean } = {}): Record<string, string> {
  const e: Record<string, string> = {};
  if (lines.length === 0) e.lines = "Add at least one item.";
  const seen = new Set<string>();
  lines.forEach((l, i) => {
    const it = items.find((x) => x.id === l.itemId);
    if (!it) e[`lines.${i}.itemId`] = "Choose the item.";
    else if (seen.has(it.id)) e[`lines.${i}.itemId`] = `${it.name} is on the list twice. Put the total on one line.`;
    if (it) seen.add(it.id);
    if (l.qty === null || !Number.isInteger(l.qty) || l.qty <= 0) e[`lines.${i}.qty`] = "Enter a whole number above 0.";
    else if (opts.stock && it && l.qty > it.onHand) e[`lines.${i}.qty`] = it.onHand === 0 ? `${it.name} is out of stock.` : `Only ${formatCount(it.onHand)} in the store.`;
    if (opts.price && (l.unitPrice === null || l.unitPrice === undefined || l.unitPrice < 0)) e[`lines.${i}.unitPrice`] = "Enter the price in whole rupees.";
    if (opts.price && (l.discountPct === null || l.discountPct === undefined || l.discountPct < 0 || l.discountPct > 100)) e[`lines.${i}.discountPct`] = "Discount is 0 to 100%.";
  });
  return e;
}
