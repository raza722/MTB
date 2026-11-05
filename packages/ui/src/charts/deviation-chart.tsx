import { useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { useElementWidth } from "./hooks";
import { linearScale, niceTicks } from "./scale";

export interface DeviationChartProps<T> {
  data: readonly T[];
  value: (d: T) => number;
  /** Short label under each mark: "Prep", "7", "Khalid". */
  axisLabel: (d: T) => string;
  /** The line every mark is measured from, e.g. the campus's attendance today. */
  reference: number;
  referenceLabel: string;
  /** Value text: "92.4%". */
  format: (v: number) => string;
  /** Axis tick text; defaults to format. */
  formatAxis?: (v: number) => string;
  tooltip: (d: T) => ReactNode;
  describe: (d: T) => string;
  label: string;
  height?: number;
}

const M = { top: 34, right: 16, bottom: 30, left: 52 };

/**
 * MTB addition: a lollipop per group, drawn up or down from a reference line. Use it when values are close
 * together (attendance 88–96%): bars would have to start at zero and every bar would look the same.
 * The highest and lowest groups are labelled; every mark has a tooltip.
 */
export function DeviationChart<T>({ data, value, axisLabel, reference, referenceLabel, format, formatAxis = format, tooltip, describe, label, height = 240 }: DeviationChartProps<T>) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const [byKeys, setByKeys] = useState(false);
  const n = data.length;
  const values = data.map(value);
  const innerW = Math.max(0, width - M.left - M.right);
  const innerH = height - M.top - M.bottom;
  const maxDev = Math.max(0.5, ...values.map((v) => Math.abs(v - reference)));
  // Round ticks (88%, 90% …) around the reference; the reference itself is labelled in bold on the axis.
  const ticks = niceTicks(reference - maxDev - 0.4, reference + maxDev + 0.4, 4);
  const y = linearScale([ticks[0]!, ticks[ticks.length - 1]!], [M.top + innerH, M.top]);
  const band = n > 0 ? innerW / n : 0;
  const cx = (i: number) => M.left + band * (i + 0.5);
  const yRef = Math.round(y(reference)) + 0.5;
  const labelEvery = band < 34 ? 2 : 1;
  const lo = values.indexOf(Math.min(...values));
  const hi = values.indexOf(Math.max(...values));

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setByKeys(true);
      setActive(e.key === "Home" ? 0 : n - 1);
      return;
    }
    const d = step[e.key];
    if (d === undefined || n === 0) return;
    e.preventDefault();
    setByKeys(true);
    setActive((i) => Math.min(n - 1, Math.max(0, (i ?? -1) + d)));
  };

  const a = active !== null ? active : null;
  const tipLeft = a !== null ? cx(a) : 0;
  const flip = a !== null && tipLeft > width - 220;

  return (
    <div
      ref={ref}
      className="mtb-chart-frame"
      style={{ height }}
      tabIndex={0}
      role="group"
      aria-roledescription="chart"
      aria-label={`${label}. Use the left and right arrow keys to read each one.`}
      onKeyDown={onKey}
      onFocus={() => {
        setByKeys(true);
        setActive((i) => i ?? 0);
      }}
      onBlur={() => setActive(null)}
    >
      {width > 0 && n > 0 && (
        <svg width={width} height={height} className="mtb-chart" aria-hidden="true" onPointerLeave={() => setActive(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={Math.round(y(t)) + 0.5} y2={Math.round(y(t)) + 0.5} className="mtb-chart-grid" />
              {Math.abs(y(t) - yRef) > 16 && (
                <text x={M.left - 10} y={y(t)} dy="0.32em" textAnchor="end">
                  {formatAxis(t)}
                </text>
              )}
            </g>
          ))}
          {a !== null && <rect x={M.left + band * a + 2} y={M.top - 6} width={Math.max(0, band - 4)} height={innerH + 6} rx={6} className="mtb-chart-band" />}
          <line x1={M.left} x2={width - M.right} y1={yRef} y2={yRef} className="mtb-chart-reference" />
          <text x={M.left - 10} y={yRef} dy="0.32em" textAnchor="end" className="mtb-chart-label-strong">
            {format(reference)}
          </text>
          <g>
            <line x1={M.left} x2={M.left + 18} y1={8.5} y2={8.5} className="mtb-chart-reference" />
            <text x={M.left + 24} y={8} dy="0.32em">
              {referenceLabel}
            </text>
          </g>
          {data.map((d, i) => {
            const v = values[i]!;
            const yv = y(v);
            const delay: CSSProperties = { animationDelay: `${180 + i * 45}ms` };
            const labelled = i === lo || i === hi;
            return (
              <g key={i}>
                <line x1={cx(i)} x2={cx(i)} y1={yRef} y2={yv} pathLength={1} className="mtb-chart-stem mtb-chart-draw" style={delay} />
                <circle cx={cx(i)} cy={yv} r={5} className="mtb-chart-dot mtb-chart-pop" style={{ animationDelay: `${420 + i * 45}ms` }} />
                {labelled && (
                  <text x={cx(i)} y={v >= reference ? yv - 12 : yv + 20} textAnchor="middle" className="mtb-chart-label-strong mtb-chart-fade-late">
                    {format(v)}
                  </text>
                )}
                {i % labelEvery === 0 && (
                  <text x={cx(i)} y={M.top + innerH + 20} textAnchor="middle">
                    {axisLabel(d)}
                  </text>
                )}
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
      {a !== null && data[a] !== undefined && (
        <div className="mtb-chart-tip" style={flip ? { right: width - tipLeft + 16 } : { left: tipLeft + 16 }}>
          {tooltip(data[a])}
        </div>
      )}
      <div className="mtb-sr-only" aria-live="polite">
        {byKeys && a !== null && data[a] !== undefined ? describe(data[a]) : ""}
      </div>
    </div>
  );
}
