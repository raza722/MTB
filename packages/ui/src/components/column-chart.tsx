import { useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { useElementWidth } from "../charts/hooks";
import { linearScale, niceTicks } from "../charts/scale";

export interface ColumnChartProps<T> {
  data: readonly T[];
  value: (d: T) => number;
  /** A target per column, drawn as a short bar across it (omit for plain columns). */
  target?: (d: T) => number | null;
  /** Short label under each column: "Apr", "7-B". */
  axisLabel: (d: T) => string;
  /** Y axis tick text, e.g. "50 lakh". */
  formatAxis: (v: number) => string;
  tooltip: (d: T) => ReactNode;
  /** Read out when a column is reached with the arrow keys. */
  describe: (d: T) => string;
  /** Accessible name: what the chart shows. */
  label: string;
  /** Legend names; the legend shows when a target is drawn. */
  valueLabel?: string;
  targetLabel?: string;
  /** Columns still filling up (the month in progress): drawn lighter and named in the legend. */
  partial?: (d: T) => boolean;
  partialLabel?: string;
  height?: number;
}

const M = { top: 16, right: 12, bottom: 30, left: 60 };

/**
 * MTB addition: one value per category as columns from zero, with an optional target marker on each
 * (collected against target by month). One axis, ink-coloured text, a legend for the two marks, hover or
 * arrow keys for a tooltip. Pair it with a table view.
 */
export function ColumnChart<T>({ data, value, target, axisLabel, formatAxis, tooltip, describe, label, valueLabel = "Value", targetLabel = "Target", partial, partialLabel = "In progress", height = 260 }: ColumnChartProps<T>) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const [byKeys, setByKeys] = useState(false);
  const n = data.length;
  const values = data.map(value);
  const targets = data.map((d) => target?.(d) ?? null);
  const max = Math.max(1, ...values, ...targets.map((t) => t ?? 0));
  const ticks = niceTicks(0, max, 4);
  const yMax = ticks[ticks.length - 1]!;
  const innerW = Math.max(0, width - M.left - M.right);
  const innerH = height - M.top - M.bottom;
  const y = linearScale([0, yMax], [M.top + innerH, M.top]);
  const band = n > 0 ? innerW / n : 0;
  const barW = Math.max(6, Math.min(44, band * 0.56));
  const cx = (i: number) => M.left + band * (i + 0.5);
  const base = M.top + innerH;
  const hasPartial = Boolean(partial && data.some((d) => partial(d)));

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity };
    const d = keys[e.key];
    if (d === undefined || n === 0) return;
    e.preventDefault();
    setByKeys(true);
    setActive((i) => Math.min(n - 1, Math.max(0, d === -Infinity ? 0 : d === Infinity ? n - 1 : (i ?? -1) + d)));
  };

  const tipX = active !== null ? cx(active) : 0;
  const flip = active !== null && tipX > width - 220;

  return (
    <div className="grid gap-3">
      {(target || hasPartial) && (
        <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-1 p-0 text-[13px] text-ink-muted" aria-hidden="true">
          <li className="flex items-center gap-2">
            <span className="mtb-chart-key" style={{ background: "var(--chart-1)" }} />
            {valueLabel}
          </li>
          {hasPartial && (
            <li className="flex items-center gap-2">
              <span className="mtb-chart-key" style={{ background: "var(--chart-1)", opacity: 0.45 }} />
              {partialLabel}
            </li>
          )}
          {target && (
            <li className="flex items-center gap-2">
              <span style={{ display: "inline-block", width: 14, height: 3, borderRadius: 2, background: "var(--ink)" }} />
              {targetLabel}
            </li>
          )}
        </ul>
      )}
      <div
        ref={ref}
        className="mtb-chart-frame"
        style={{ height }}
        tabIndex={0}
        role="group"
        aria-roledescription="chart"
        aria-label={`${label}. Use the left and right arrow keys to read each column.`}
        onKeyDown={onKey}
        onFocus={() => {
          setByKeys(true);
          setActive((i) => i ?? n - 1);
        }}
        onBlur={() => setActive(null)}
      >
        {width > 0 && n > 0 && (
          <svg width={width} height={height} className="mtb-chart" aria-hidden="true" onPointerLeave={() => setActive(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={M.left} x2={width - M.right} y1={Math.round(y(t)) + 0.5} y2={Math.round(y(t)) + 0.5} className={t === 0 ? "mtb-chart-baseline" : "mtb-chart-grid"} />
                <text x={M.left - 10} y={y(t)} dy="0.32em" textAnchor="end">
                  {formatAxis(t)}
                </text>
              </g>
            ))}
            {active !== null && <rect x={M.left + band * active + 2} y={M.top - 6} width={Math.max(0, band - 4)} height={innerH + 6} rx={6} className="mtb-chart-band" />}
            {data.map((d, i) => {
              const v = values[i]!;
              const top = y(v);
              const t = targets[i];
              const light = partial?.(d) ?? false;
              const motion: CSSProperties = { animation: `mtb-rise var(--motion-slow, 240ms) var(--ease-out, ease) ${120 + i * 50}ms both` };
              return (
                <g key={i}>
                  <rect x={cx(i) - barW / 2} y={top} width={barW} height={Math.max(0, base - top)} rx={4} style={{ fill: "var(--chart-1)", opacity: light ? 0.45 : 1, ...motion }} />
                  {t !== null && t !== undefined && (
                    <line x1={cx(i) - barW / 2 - 5} x2={cx(i) + barW / 2 + 5} y1={Math.round(y(t)) + 0.5} y2={Math.round(y(t)) + 0.5} style={{ stroke: "var(--ink)", strokeWidth: 2.5, strokeLinecap: "round", ...motion }} />
                  )}
                  <text x={cx(i)} y={base + 20} textAnchor="middle" className={active === i ? "mtb-chart-label-strong" : undefined}>
                    {axisLabel(d)}
                  </text>
                  <rect
                    x={M.left + band * i}
                    y={0}
                    width={band}
                    height={height}
                    fill="transparent"
                    onPointerEnter={() => {
                      setByKeys(false);
                      setActive(i);
                    }}
                  />
                </g>
              );
            })}
          </svg>
        )}
        {active !== null && data[active] !== undefined && (
          <div className="mtb-chart-tip" style={flip ? { right: width - tipX + 16 } : { left: tipX + 16 }}>
            {tooltip(data[active])}
          </div>
        )}
        <div className="mtb-sr-only" aria-live="polite">
          {byKeys && active !== null && data[active] !== undefined ? describe(data[active]) : ""}
        </div>
      </div>
    </div>
  );
}
