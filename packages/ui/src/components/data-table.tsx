import { formatCount, formatDate, formatRs, type IsoDate, type Rupees } from "@mtb/domain";
import { isValidElement, useState, type CSSProperties, type ReactNode } from "react";
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
  /**
   * The column never gets narrower than this, even when the table is wider than its frame. By default the first text
   * column without a width (the name column) keeps 180px; 0 switches that off.
   */
  minWidth?: number | string;
  render?: (row: Row, index: number) => ReactNode;
  /** With `onSortChange` the page sorts (true shows the arrow). Without it the table sorts by itself on every column whose key is a plain value of the row; false switches that off for a column. */
  sortable?: boolean;
  className?: string;
}

/**
 * A plain value this short stays on one line. In a narrow column the browser broke "SY-Rushd-II", "25-Apr-2018" or
 * "FAM-1016" at their hyphens into two or three lines (seen 23-Nov-2026). Longer text still wraps.
 */
const SHORT_VALUE = 24;
/** The name column's least width: two words of a name on the first line. */
const NAME_MIN_WIDTH = 180;
function isShortValue(v: ReactNode): boolean {
  if (typeof v === "number") return true;
  if (typeof v === "string") return v.length <= SHORT_VALUE;
  // One element around a short value: a G.R. link, a <span className="mtb-mono">, a class name in a span.
  if (isValidElement<{ children?: ReactNode }>(v)) {
    const c = v.props.children;
    return typeof c === "number" || (typeof c === "string" && c.length <= SHORT_VALUE);
  }
  return false;
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
  /** What a row's select box reads to a screen reader: "Select {rowLabel}" (default "Select row {n}"). */
  rowLabel?: (row: Row) => string;
  onRowClick?: (row: Row) => void;
  rowClassName?: (row: Row) => string | undefined;
  /** Totals by column key. */
  footer?: Partial<Record<string, ReactNode>>;
  /** Screen-reader caption. */
  caption?: string;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  /**
   * No longer used: the header row always stays on top. Long tables scroll inside their frame since 20-Nov-2026, and a
   * header that scrolled away with the rows would leave the columns unnamed. Kept so older pages still compile.
   */
  stickyHeader?: boolean;
  /** The frame's height before the rows scroll; by default min(640px, 78vh) (components-ext.css). */
  maxHeight?: number | string;
  toolbar?: ReactNode;
  pagination?: ReactNode;
  /**
   * The table's own search box, which filters the rows on screen by any text or number in them. By default it shows
   * on a table of more than 10 rows that has no toolbar, pages or totals row of its own; false switches it off
   * (a page with its own search box), true shows it whatever the size.
   */
  searchable?: boolean;
}

const BUILT_IN_SEARCH_FROM = 10;

/** Every text and number in a row (two levels deep), lower-cased, for the built-in search. */
const rowTextCache = new WeakMap<object, string>();
function rowText(row: object): string {
  const hit = rowTextCache.get(row);
  if (hit !== undefined) return hit;
  const parts: string[] = [];
  const walk = (v: unknown, depth: number) => {
    if (typeof v === "string" || typeof v === "number") parts.push(String(v));
    else if (v && typeof v === "object" && depth < 2) for (const x of Object.values(v)) walk(x, depth + 1);
  };
  walk(row, 0);
  const text = parts.join(" ").toLowerCase();
  rowTextCache.set(row, text);
  return text;
}

function compareValues(a: unknown, b: unknown): number {
  const empty = (v: unknown) => v === null || v === undefined || v === "";
  if (empty(a) || empty(b)) return empty(a) ? (empty(b) ? 0 : 1) : -1; // empty values last
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/** The data-dense table of the staff app. Headers stay put; never hide a column that carries an amount. */
export function DataTable<Row extends object>({
  columns,
  rowKey = "id" as keyof Row & string,
  loading,
  skeletonRows = 6,
  empty,
  density,
  selectable,
  selected,
  onSelectedChange,
  isRowSelectable,
  rowLabel,
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
  searchable,
  rows: allRows,
}: DataTableProps<Row>) {
  // Search and sorting the table does by itself (user request, 19-Nov-2026: "search on every table, and ascending and
  // descending on the columns"). A page that sorts for itself (onSortChange) or shows pages keeps doing so: sorting
  // one page of a longer list here would put the wrong rows first.
  const [query, setQuery] = useState("");
  const [ownSort, setOwnSort] = useState<SortState | null>(null);
  const selfSort = !onSortChange && !pagination;
  const plainValue = (key: string) => allRows.some((r) => ["string", "number", "boolean"].includes(typeof (r as Record<string, unknown>)[key]));
  const canSort = (c: Column<Row>) => (onSortChange ? Boolean(c.sortable) : selfSort && c.sortable !== false && plainValue(c.key));
  const showSearch = searchable ?? (!toolbar && !pagination && !footer && allRows.length > BUILT_IN_SEARCH_FROM);
  const needle = showSearch ? query.trim().toLowerCase() : "";
  let rows = needle ? allRows.filter((r) => rowText(r).includes(needle)) : allRows;
  if (selfSort && ownSort) {
    const k = ownSort.key;
    const sign = ownSort.dir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => sign * compareValues((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  const shownSort = onSortChange ? sort : (ownSort ?? undefined);
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
    if (onSortChange) return onSortChange(sort?.key === key ? { key, dir: sort.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });
    // The table's own sort: ascending, then descending, then back to the order the page gave.
    setOwnSort((cur) => (cur?.key !== key ? { key, dir: "asc" } : cur.dir === "asc" ? { key, dir: "desc" } : null));
  };
  void stickyHeader; // see the prop: the header always stays on top now
  const headStyle = (extra?: CSSProperties): CSSProperties | undefined => extra;
  const colCount = columns.length + (selectable ? 1 : 0);
  // The first text column without a width is the row's name (student, book, staff). When the table is wider than its
  // frame the browser squeezed it to 95px, one word per line (seen 23-Nov-2026), so it keeps NAME_MIN_WIDTH.
  const nameKey = columns.find((c) => c.width === undefined && c.minWidth === undefined && c.align !== "right")?.key;
  const minWidthOf = (c: Column<Row>) => (c.minWidth !== undefined ? c.minWidth || undefined : c.key === nameKey ? NAME_MIN_WIDTH : undefined);

  return (
    <div className="mtb-table-wrap">
      {toolbar && <div className="mtb-table-toolbar">{toolbar}</div>}
      {showSearch && (
        <div className="mtb-table-toolbar">
          <div className="mtb-input-wrap has-icon" style={{ width: "min(320px, 100%)" }}>
            <Icon name="search" />
            <input className="mtb-input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search this table" aria-label={caption ? `Search ${caption}` : "Search this table"} />
          </div>
          {needle && (
            <span className="mtb-num" aria-live="polite" style={{ color: "var(--ink-muted)" }}>
              {formatCount(rows.length)} of {formatCount(allRows.length)}
            </span>
          )}
        </div>
      )}
      <div className="mtb-table-scroll" style={maxHeight ? { maxHeight } : undefined}>
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
                  style={headStyle({ width: c.width, minWidth: minWidthOf(c) })}
                  aria-sort={shownSort?.key === c.key ? (shownSort.dir === "asc" ? "ascending" : "descending") : undefined}
                >
                  {canSort(c) ? (
                    <button type="button" onClick={() => sortBy(c.key)} title="Sort by this column">
                      {c.header}
                      <Icon
                        name={shownSort?.key === c.key && shownSort.dir === "asc" ? "chevronUp" : "chevronDown"}
                        style={shownSort?.key === c.key ? undefined : { opacity: 0.4 }}
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
                  {needle ? <EmptyState icon="search" title="Nothing matches the search" description="Check the spelling, or clear the search box to see every row." /> : (empty ?? <EmptyState title="Nothing to show" />)}
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
                        <Checkbox checked={isSel} disabled={!canSelect} onChange={() => toggle(id)} aria-label={rowLabel ? `Select ${rowLabel(r)}` : `Select row ${i + 1}`} />
                      </td>
                    )}
                    {columns.map((c) => {
                      const content = c.render ? c.render(r, i) : (r[c.key as keyof Row] as ReactNode);
                      return (
                        <td key={c.key} className={cx(c.align === "right" && "mtb-td-num", isShortValue(content) && "mtb-td-short", c.className)}>
                          {content}
                        </td>
                      );
                    })}
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
