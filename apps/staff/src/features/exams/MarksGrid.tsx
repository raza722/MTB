import type { ExamsMark } from "@mtb/api";
import { cx } from "@mtb/ui";
import { useRef, type KeyboardEvent, type ReactNode } from "react";

export interface GridCol {
  key: string;
  label: string;
  max: number;
  /** "A" allowed (absent: counts as 0, is not 0). */
  allowAbsent?: boolean;
  /** "L" allowed (on leave: counts as 0, never fined). */
  allowLeave?: boolean;
  /** A % (attendance) rather than marks: whole numbers only. */
  percent?: boolean;
  /** Header content under the label (status, teacher). */
  head?: ReactNode;
}

export interface GridRow {
  id: string;
  name: string;
  sub?: ReactNode;
  roll?: number;
  /** Group (stream), shown in the Group column when the grid has one. */
  group?: string;
  /** Column keys this row doesn't take (a paper outside the student's group): a disabled dash, never missing. */
  na?: string[];
}

/** Raw text typed in each cell: values[rowId][colKey]. */
export type GridValues = Record<string, Record<string, string>>;

/** Reads what was typed: "" → null (missing), A → absent, L → leave, else a number within the maximum. */
export function parseCell(raw: string, col: GridCol): { value: ExamsMark; error?: string } {
  const t = raw.trim().toUpperCase();
  if (t === "") return { value: null };
  if (t === "A") return col.allowAbsent ? { value: "A" } : { value: null, error: col.percent ? "Type a % from 0 to 100." : "Absent isn't used here: type the marks." };
  if (t === "L") return col.allowLeave ? { value: "L" } : { value: null, error: col.allowAbsent ? "Type the marks, or A for absent." : "Type the marks." };
  if (!/^\d+(\.\d+)?$/.test(t)) return { value: null, error: col.allowAbsent ? `Type a number${col.allowLeave ? ", A for absent or L for leave" : " or A for absent"}.` : "Type a number." };
  const n = Number(t);
  if (n > col.max) return { value: null, error: col.percent ? "Attendance can't be above 100%." : `Maximum is ${col.max}.` };
  if (col.percent ? !Number.isInteger(n) : Math.round(n * 2) !== n * 2) return { value: null, error: col.percent ? "Use a whole %." : "Use whole or half marks (32.5)." };
  return { value: n };
}

export const cellText = (m: ExamsMark | undefined) => (m === null || m === undefined ? "" : String(m));

/**
 * A spreadsheet-style marks grid: arrows move between cells, Enter goes down a subject (Shift+Enter up), Tab
 * goes across a student's subjects. Missing marks are tinted; marks over the maximum are refused with a reason.
 */
export function MarksGrid({
  caption,
  rows,
  cols,
  values,
  onChange,
  readOnly,
  serverErrors = {},
  trailingHead,
  trailing,
  groupColumn,
  leadHead,
  lead,
}: {
  caption: string;
  rows: GridRow[];
  cols: GridCol[];
  values: GridValues;
  onChange: (rowId: string, colKey: string, raw: string) => void;
  readOnly?: boolean;
  /** `${rowId}|${colKey}` → message from the server. */
  serverErrors?: Record<string, string>;
  trailingHead?: ReactNode;
  trailing?: (row: GridRow) => ReactNode;
  /** Show a Group column after the student (classes with groups). */
  groupColumn?: boolean;
  /** An extra column before the marks (board exams: the board roll no.). */
  leadHead?: ReactNode;
  lead?: (row: GridRow) => ReactNode;
}) {
  const refs = useRef(new Map<string, HTMLInputElement>());
  /** Moves to the nearest cell in the direction given, skipping papers the student doesn't take. */
  const focus = (r: number, c: number, dr = 0, dc = 0) => {
    let rr = r;
    let cc = c;
    for (let i = 0; i < rows.length + cols.length; i++) {
      const el = refs.current.get(`${rr}:${cc}`);
      if (el) {
        el.focus();
        el.select();
        return;
      }
      if (dr === 0 && dc === 0) return;
      rr += dr;
      cc += dc;
      if (rr < 0 || rr >= rows.length || cc < 0 || cc >= cols.length) return;
    }
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>, r: number, c: number) => {
    const el = e.currentTarget;
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
    const atEnd = el.selectionStart === el.value.length;
    const all = el.selectionStart === 0 && el.selectionEnd === el.value.length;
    if (e.key === "ArrowDown" || (e.key === "Enter" && !e.shiftKey)) {
      e.preventDefault();
      if (r + 1 < rows.length) focus(r + 1, c, 1, 0);
    } else if (e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey)) {
      e.preventDefault();
      if (r > 0) focus(r - 1, c, -1, 0);
    } else if (e.key === "ArrowRight" && (atEnd || all)) {
      e.preventDefault();
      if (c + 1 < cols.length) focus(r, c + 1, 0, 1);
    } else if (e.key === "ArrowLeft" && (atStart || all)) {
      e.preventDefault();
      if (c > 0) focus(r, c - 1, 0, -1);
    }
  };

  return (
    <div className="exams-grid-wrap">
      <table className="exams-grid">
        <caption className="mtb-sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="exams-grid-num" style={{ width: 52 }}>
              Roll
            </th>
            <th scope="col" className="exams-grid-sticky" style={{ minWidth: 200 }}>
              Student
            </th>
            {groupColumn && (
              <th scope="col" style={{ minWidth: 80 }}>
                Group
              </th>
            )}
            {lead && (
              <th scope="col" style={{ minWidth: 112 }}>
                {leadHead}
              </th>
            )}
            {cols.map((c) => (
              <th key={c.key} scope="col" className="exams-grid-num">
                <span className="exams-grid-head">
                  <b>{c.label}</b>
                  <span>{c.percent ? "%" : `out of ${c.max}`}</span>
                  {c.head}
                </span>
              </th>
            ))}
            {trailingHead && (
              <th scope="col" className="exams-grid-num">
                {trailingHead}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={row.id}>
              <td className="exams-grid-num text-ink-muted">{row.roll ?? r + 1}</td>
              <td className="exams-grid-sticky">
                <span className="grid">
                  <span className="font-medium">{row.name}</span>
                  {row.sub && <span className="text-[12px] text-ink-muted">{row.sub}</span>}
                </span>
              </td>
              {groupColumn && <td className="text-small text-ink-muted">{row.group ?? "—"}</td>}
              {lead && <td>{lead(row)}</td>}
              {cols.map((col, c) => {
                if (row.na?.includes(col.key))
                  return (
                    <td key={col.key} className="exams-grid-num is-na" title={`${row.group ?? "This group"} doesn't take ${col.label}`}>
                      <span className="exams-cell-na" aria-label={`${row.name}, ${col.label}: not taken (${row.group ?? "other group"})`}>
                        —
                      </span>
                    </td>
                  );
                const raw = values[row.id]?.[col.key] ?? "";
                const parsed = parseCell(raw, col);
                const err = parsed.error ?? serverErrors[`${row.id}|${col.key}`];
                const letter = parsed.value === "A" || parsed.value === "L";
                return (
                  <td key={col.key} className={cx("exams-grid-num", err ? "is-error" : raw.trim() === "" ? "is-missing" : letter && "is-absent")}>
                    <input
                      ref={(el) => {
                        if (el) refs.current.set(`${r}:${c}`, el);
                        else refs.current.delete(`${r}:${c}`);
                      }}
                      className={cx("exams-cell", err && "is-invalid", letter && "is-letter")}
                      value={raw}
                      readOnly={readOnly}
                      inputMode={col.allowAbsent || col.allowLeave ? "text" : "decimal"}
                      autoComplete="off"
                      maxLength={5}
                      aria-label={`${row.name}, ${col.label}${err ? `: ${err}` : raw.trim() === "" ? ": missing" : ""}`}
                      aria-invalid={err ? true : undefined}
                      title={err ?? (letter ? (parsed.value === "A" ? "Absent" : "On leave") : undefined)}
                      onFocus={(e) => e.currentTarget.select()}
                      onKeyDown={(e) => onKey(e, r, c)}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^0-9.aAlL]/g, "");
                        onChange(row.id, col.key, /^[aAlL]$/.test(v) ? v.toUpperCase() : v);
                      }}
                    />
                  </td>
                );
              })}
              {trailing && <td className="exams-grid-num">{trailing(row)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
