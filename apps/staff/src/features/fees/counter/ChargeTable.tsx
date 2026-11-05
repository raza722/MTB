import { describeDue, formatDate, formatRs } from "@mtb/domain";
import { Checkbox, cx, Money, StatusBadge, Switch, Tooltip } from "@mtb/ui";
import { useRef, type KeyboardEvent } from "react";
import type { FeeCounterState } from "./useFeeCounter";

/**
 * Unpaid charges, oldest first. Keyboard: ↑/↓ move between charges, Space selects, Enter continues to payment.
 * Late fines are calculated live (the tooltip shows the working); the server recalculates them on posting.
 */
export function ChargeTable({ state, onContinue, readOnly }: { state: FeeCounterState; onContinue: () => void; readOnly: boolean }) {
  const rowRefs = useRef<Array<HTMLTableRowElement | null>>([]);
  const { lines, selected, toggle } = state;

  const onRowKey = (i: number, id: string, e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      rowRefs.current[Math.min(i + 1, lines.length - 1)]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      rowRefs.current[Math.max(i - 1, 0)]?.focus();
    } else if (e.key === " ") {
      e.preventDefault();
      if (!readOnly) toggle(id);
    } else if (e.key === "Enter") {
      e.preventDefault();
      onContinue();
    }
  };

  return (
    <section className="mtb-table-wrap" aria-label="Unpaid charges">
      <div className="mtb-table-toolbar">
        <div className="grid">
          <h2 className="m-0 text-title-3">Unpaid charges</h2>
          <span className="text-small text-ink-muted">Oldest first. Select what the parent is paying now.</span>
        </div>
        <div className="flex items-center gap-2">
          <Switch label="Oldest first" checked={state.oldestFirst} onChange={(e) => state.setOldestFirst(e.target.checked)} />
          <StatusBadge status="neutral" dot={false}>
            Rule not yet decided
          </StatusBadge>
        </div>
      </div>
      <div className="mtb-table-scroll">
        <table className="mtb-table mtb-table-roomy">
          <caption className="mtb-sr-only">Unpaid charges. Use the arrow keys to move, Space to select, Enter to continue.</caption>
          <thead>
            <tr>
              <th className="mtb-td-check" scope="col">
                <span className="mtb-sr-only">Select</span>
              </th>
              <th scope="col">Charge</th>
              <th scope="col">Due date</th>
              <th scope="col">Days overdue</th>
              <th scope="col" className="mtb-th-num">
                Amount
              </th>
              <th scope="col" className="mtb-th-num">
                Late fine
              </th>
              <th scope="col" className="mtb-th-num">
                Line total
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const isSel = selected.has(l.charge.id);
              const overdue = l.fine.daysOverdue > 0;
              return (
                <tr
                  key={l.charge.id}
                  ref={(el) => {
                    rowRefs.current[i] = el;
                  }}
                  tabIndex={0}
                  aria-selected={isSel}
                  className={cx("is-clickable", isSel && "is-selected")}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("label, input, button")) return;
                    if (!readOnly) toggle(l.charge.id);
                  }}
                  onKeyDown={(e) => onRowKey(i, l.charge.id, e)}
                  data-row={i}
                >
                  <td className="mtb-td-check">
                    <Checkbox checked={isSel} disabled={readOnly} onChange={() => toggle(l.charge.id)} aria-label={`Pay ${l.charge.head}`} tabIndex={-1} />
                  </td>
                  <td>
                    <span className="mtb-cell-primary">{l.charge.head}</span>
                    {l.charge.session !== lines[lines.length - 1]?.charge.session && <span className="mtb-cell-secondary block">Previous session</span>}
                    {l.charge.settledAmount > 0 && <span className="mtb-cell-secondary block">Part paid: {formatRs(l.charge.settledAmount)} of {formatRs(l.charge.amount)}</span>}
                  </td>
                  <td className="tabular-nums">{formatDate(l.charge.dueDate)}</td>
                  <td>{overdue ? <StatusBadge status="overdue">{describeDue(l.fine)} days</StatusBadge> : <StatusBadge status="unpaid">{describeDue(l.fine)}</StatusBadge>}</td>
                  <td className="mtb-td-num">
                    <Money value={l.outstanding} />
                  </td>
                  <td className="mtb-td-num">
                    {l.fine.fine > 0 ? (
                      <Tooltip content={l.fine.explanation}>
                        <span tabIndex={-1} className="cursor-help font-medium text-status-overdue-ink underline decoration-dotted underline-offset-4">
                          {formatRs(l.fine.fine)}
                        </span>
                      </Tooltip>
                    ) : (
                      <span className="text-ink-muted">Rs 0</span>
                    )}
                  </td>
                  <td className="mtb-td-num font-medium">
                    <Money value={l.lineTotal} />
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td />
              <td colSpan={3}>
                {state.chosen.length} of {lines.length} selected
              </td>
              <td className="mtb-td-num">
                <Money value={state.fees} />
              </td>
              <td className="mtb-td-num">
                <Money value={state.fines} />
              </td>
              <td className="mtb-td-num">
                <Money value={state.total} />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
