import { useId, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useElementWidth } from "./hooks";
import { linearScale, monotonePath, nearestIndex, niceTicks } from "./scale";

export interface AreaChartProps<T> {
  data: readonly T[];
  value: (d: T) => number;
  /** Label under a point on the x axis, e.g. "06 Oct" or "Today". */
  axisLabel: (d: T, i: number) => string;
  /** Y axis tick text, e.g. "5 lakh". */
  formatAxis: (v: number) => string;
  /** Tooltip body for the point under the pointer or keyboard focus. */
  tooltip: (d: T, i: number) => ReactNode;
  /** Read out when a point is reached with the arrow keys. */
  describe: (d: T, i: number) => string;
  /** Accessible name: what the chart shows. */
  label: string;
  /** Short label next to the highest point, e.g. "Rs 9.12 lakh". Omit to leave the peak unlabelled. */
  peakLabel?: (d: T) => string;
  height?: number;
}

const M = { top: 24, right: 20, bottom: 30, left: 60 };
const MIN_LABEL_GAP = 58;

/**
 * MTB addition: one series over time as a 2px line with a soft wash under it. Hover or arrow keys move a
 * crosshair with a tooltip; the latest point is marked; the peak is labelled. Pair it with a table view.
 */
export function AreaChart<T>({ data, value, axisLabel, formatAxis, tooltip, describe, label, peakLabel, height = 260 }: AreaChartProps<T>) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  // Only keyboard moves are read out; pointer hovering would make a screen reader chatter.
  const [byKeys, setByKeys] = useState(false);
  const gid = `area${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const n = data.length;

  const innerW = Math.max(0, width - M.left - M.right);
  const innerH = height - M.top - M.bottom;
  const values = data.map(value);
  const ticks = niceTicks(0, Math.max(1, ...values), 4);
  const yMax = ticks[ticks.length - 1]!;
  const y = linearScale([0, yMax], [M.top + innerH, M.top]);
  const xs = values.map((_, i) => M.left + (n <= 1 ? innerW / 2 : (i * innerW) / (n - 1)));
  const pts = values.map((v, i) => ({ x: xs[i]!, y: y(v) }));
  const line = monotonePath(pts);
  const base = M.top + innerH;
  const area = n > 0 ? `${line}L${pts[n - 1]!.x},${base}L${pts[0]!.x},${base}Z` : "";

  // Axis labels anchored on the latest point, so "Today" is always shown.
  const step = n > 1 ? Math.max(1, Math.ceil(MIN_LABEL_GAP / (innerW / (n - 1)))) : 1;
  const peak = values.length ? values.indexOf(Math.max(...values)) : -1;
  const showPeak = peakLabel && peak >= 0 && peak < n - 2;

  const move = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    setByKeys(false);
    setActive(nearestIndex(xs, e.clientX - box.left));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity };
    const d = keys[e.key];
    if (d === undefined || n === 0) return;
    e.preventDefault();
    setByKeys(true);
    const from = active ?? n - 1;
    setActive(Math.min(n - 1, Math.max(0, d === -Infinity ? 0 : d === Infinity ? n - 1 : from + d)));
  };

  const a = active !== null ? pts[active] : undefined;
  const flip = a !== undefined && a.x > width - 220;

  return (
    <div
      ref={ref}
      className="mtb-chart-frame"
      style={{ height }}
      tabIndex={0}
      role="group"
      aria-roledescription="chart"
      aria-label={`${label}. Use the left and right arrow keys to read each day.`}
      onKeyDown={onKey}
      onFocus={() => {
        setByKeys(true);
        setActive((i) => i ?? n - 1);
      }}
      onBlur={() => setActive(null)}
    >
      {width > 0 && n > 0 && (
        <svg width={width} height={height} className="mtb-chart" aria-hidden="true" onPointerMove={move} onPointerLeave={() => setActive(null)}>
          <defs>
            <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" style={{ stopColor: "var(--chart-1)", stopOpacity: 0.18 }} />
              <stop offset="1" style={{ stopColor: "var(--chart-1)", stopOpacity: 0.02 }} />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={Math.round(y(t)) + 0.5} y2={Math.round(y(t)) + 0.5} className={t === 0 ? "mtb-chart-baseline" : "mtb-chart-grid"} />
              <text x={M.left - 10} y={y(t)} dy="0.32em" textAnchor="end">
                {formatAxis(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) =>
            (n - 1 - i) % step === 0 ? (
              <text key={i} x={xs[i]} y={base + 20} textAnchor={i === n - 1 ? "end" : "middle"} className={i === n - 1 ? "mtb-chart-label-strong" : undefined}>
                {axisLabel(d, i)}
              </text>
            ) : null,
          )}
          <path d={area} fill={`url(#${gid})`} className="mtb-chart-area-in" />
          <path d={line} pathLength={1} className="mtb-chart-line mtb-chart-draw" />
          {showPeak && (
            <g className="mtb-chart-fade-late">
              <circle cx={pts[peak]!.x} cy={pts[peak]!.y} r={4} className="mtb-chart-dot" />
              <text x={pts[peak]!.x} y={pts[peak]!.y - 12} textAnchor={pts[peak]!.x < M.left + 60 ? "start" : "middle"} className="mtb-chart-label-strong">
                {peakLabel(data[peak]!)}
              </text>
            </g>
          )}
          <circle cx={pts[n - 1]!.x} cy={pts[n - 1]!.y} r={4.5} className="mtb-chart-pulse" />
          <circle cx={pts[n - 1]!.x} cy={pts[n - 1]!.y} r={4.5} className="mtb-chart-dot mtb-chart-pop" />
          {a && (
            <g>
              <line x1={Math.round(a.x) + 0.5} x2={Math.round(a.x) + 0.5} y1={M.top - 8} y2={base} className="mtb-chart-crosshair" />
              <circle cx={a.x} cy={a.y} r={5.5} className="mtb-chart-dot" />
            </g>
          )}
        </svg>
      )}
      {a && active !== null && (
        <div className="mtb-chart-tip" style={flip ? { right: width - a.x + 12 } : { left: a.x + 12 }}>
          {tooltip(data[active]!, active)}
        </div>
      )}
      <div className="mtb-sr-only" aria-live="polite">
        {byKeys && active !== null && data[active] !== undefined ? describe(data[active], active) : ""}
      </div>
    </div>
  );
}
