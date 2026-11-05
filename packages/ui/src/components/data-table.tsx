import { formatCount, formatDate, formatRs, type IsoDate, type Rupees } from "@mtb/domain";
import type { CSSProperties, ReactNode } from "react";
import { Icon } from "../icons";
import { cx } from "../lib/cx";
import { Button } from "./button";
import { Checkbox } from "./field";
import { EmptyState, Skeleton } from "./feedback";

export interface Column<Row> {
  key: string;
  header: ReactNode;
  /** 'right' for every money and count column. */
  align?: "left" | "right";
  width?: number | string;
  render?: (row: Row, index: number) => ReactNode;
  sortable?: boolean;
  className?: string;
}

export interface SortState {
  key: string;
  dir: "asc" | "desc";
}

export interface DataTableProps<Row> {
  columns: Array<Column<Row>>;
  rows: Row[];
  /** Property holding each row's unique id. */
  rowKey?: keyof Row & string;
  loading?: boolean;
  skeletonRows?: number;
  empty?: ReactNode;
  /** dense for long ledgers, roomy for the fee counter where cashiers click rows. */
  density?: "dense" | "roomy";
  selectable?: boolean;
  selected?: Set<unknown>;
  onSelectedChange?: (next: Set<unknown>) => void;
  isRowSelectable?: (row: Row) => boolean;
  onRowClick?: (row: Row) => void;
  rowClassName?: (row: Row) => string | undefined;
  /** Totals by column key. */
  footer?: Partial<Record<string, ReactNode>>;
  /** Screen-reader caption. */
  caption?: string;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  stickyHeader?: boolean;
  maxHeight?: number | string;
  toolbar?: ReactNode;
  pagination?: ReactNode;
}

/** The data-dense table of the staff app. Headers stay put; never hide a column that carries an amount. */
export function DataTable<Row extends object>({
  columns,
  rows,
  rowKey = "id" as keyof Row & string,
  loading,
  skeletonRows = 6,
  empty,
  density,
  selectable,
  selected,
  onSelectedChange,
  isRowSelectable,
  onRowClick,
  rowClassName,
  footer,
  caption,
  sort,
  onSortChange,
  stickyHeader = true,
  maxHeight,
  toolbar,
  pagination,
}: DataTableProps<Row>) {
  const idOf = (r: Row) => r[rowKey] as unknown;
  const selectableRows = rows.filter((r) => isRowSelectable?.(r) ?? true);
  const allIds = selectableRows.map(idOf);
  const allSelected = Boolean(selectable && allIds.length > 0 && allIds.every((id) => selected?.has(id)));
  const someSelected = Boolean(selectable && !allSelected && allIds.some((id) => selected?.has(id)));

  const toggleAll = () => {
    const next = new Set(selected);
    if (allSelected) allIds.forEach((id) => next.delete(id));
    else allIds.forEach((id) => next.add(id));
    onSelectedChange?.(next);
  };
  const toggle = (id: unknown) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange?.(next);
  };
  const sortBy = (key: string) => {
    if (!onSortChange) return;
    onSortChange(sort?.key === key ? { key, dir: sort.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });
  };
  const headStyle = (extra?: CSSProperties): CSSProperties | undefined => (stickyHeader ? extra : { ...extra, position: "static" });
  const colCount = columns.length + (selectable ? 1 : 0);

  return (
    <div className="mtb-table-wrap">
      {toolbar && <div className="mtb-table-toolbar">{toolbar}</div>}
      <div className="mtb-table-scroll" style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}>
        <table className={cx("mtb-table", density && `mtb-table-${density}`)} aria-busy={loading || undefined}>
          {caption && <caption className="mtb-sr-only">{caption}</caption>}
          <thead>
            <tr>
              {selectable && (
                <th className="mtb-td-check" style={headStyle()}>
                  <Checkbox checked={allSelected} indeterminate={someSelected} onChange={toggleAll} aria-label="Select all rows" />
                </th>
              )}
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cx(c.align === "right" && "mtb-th-num", c.className)}
                  style={headStyle({ width: c.width })}
                  aria-sort={sort?.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                >
                  {c.sortable && onSortChange ? (
                    <button type="button" onClick={() => sortBy(c.key)}>
                      {c.header}
                      <Icon
                        name={sort?.key === c.key && sort.dir === "asc" ? "chevronUp" : "chevronDown"}
                        style={sort?.key === c.key ? undefined : { opacity: 0.4 }}
                      />
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: skeletonRows }, (_, i) => (
                <tr key={i} aria-hidden="true">
                  {selectable && (
                    <td className="mtb-td-check">
                      <Skeleton width={18} height={18} />
                    </td>
                  )}
                  {columns.map((c) => (
                    <td key={c.key}>
                      <Skeleton
                        width={c.align === "right" ? 70 : `${55 + ((i * 17 + c.key.length * 7) % 40)}%`}
                        style={c.align === "right" ? { marginLeft: "auto" } : undefined}
                      />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={colCount} style={{ padding: 0 }}>
                  {empty ?? <EmptyState title="Nothing to show" />}
                </td>
              </tr>
            ) : (
              rows.map((r, i) => {
                const id = idOf(r);
                const canSelect = isRowSelectable?.(r) ?? true;
                const isSel = Boolean(selectable && selected?.has(id));
                return (
                  <tr
                    key={String(id ?? i)}
                    className={cx(onRowClick && "is-clickable", isSel && "is-selected", rowClassName?.(r))}
                    onClick={
                      onRowClick
                        ? (e) => {
                            if ((e.target as HTMLElement).closest("button, a, input, label")) return;
                            onRowClick(r);
                          }
                        : undefined
                    }
                    tabIndex={onRowClick ? 0 : undefined}
                    onKeyDown={onRowClick ? (e) => e.key === "Enter" && onRowClick(r) : undefined}
                    aria-selected={selectable ? isSel : undefined}
                  >
                    {selectable && (
                      <td className="mtb-td-check">
                        <Checkbox checked={isSel} disabled={!canSelect} onChange={() => toggle(id)} aria-label={`Select row ${i + 1}`} />
                      </td>
                    )}
                    {columns.map((c) => (
                      <td key={c.key} className={cx(c.align === "right" && "mtb-td-num", c.className)}>
                        {c.render ? c.render(r, i) : (r[c.key as keyof Row] as ReactNode)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
          {footer && !loading && rows.length > 0 && (
            <tfoot>
              <tr>
                {selectable && <td />}
                {columns.map((c) => (
                  <td key={c.key} className={cx(c.align === "right" && "mtb-td-num")}>
                    {footer[c.key] ?? ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {pagination && <div className="mtb-table-footer">{pagination}</div>}
    </div>
  );
}

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  pageSizes?: number[];
  onPageSizeChange?: (size: number) => void;
}

/** "Showing 1–25 of 412" with previous/next. Pages are 1-based. */
export function Pagination({ page, pageSize, total, onPageChange, pageSizes = [25, 50, 100], onPageSizeChange }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <>
      <span className="mtb-num" aria-live="polite">
        Showing {formatCount(from)}–{formatCount(to)} of {formatCount(total)}
      </span>
      <div className="mtb-pagination">
        {onPageSizeChange && (
          <select className="mtb-select" aria-label="Rows per page" value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))}>
            {pageSizes.map((s) => (
              <option key={s} value={s}>
                {s} per page
              </option>
            ))}
          </select>
        )}
        <Button size="sm" variant="secondary" icon="chevronLeft" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </Button>
        <Button size="sm" variant="secondary" iconRight="chevronRight" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
          Next
        </Button>
      </div>
    </>
  );
}

/** Every amount on screen: "Rs 12,500", tabular figures. Cancelled amounts keep their value, struck through. */
export function Money({ value, strike, sign, className }: { value: Rupees; strike?: boolean; sign?: boolean; className?: string }) {
  return <span className={cx("mtb-money", strike && "mtb-strike", className)}>{formatRs(value, { sign: sign ? "always" : "auto" })}</span>;
}

/** "04-Nov-2026" */
export function DateText({ value, className }: { value: IsoDate; className?: string }) {
  return (
    <time dateTime={value} className={cx("mtb-num", className)}>
      {formatDate(value)}
    </time>
  );
}
