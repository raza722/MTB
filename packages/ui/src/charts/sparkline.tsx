import { useId } from "react";
import { cx } from "../lib/cx";
import { useElementWidth } from "./hooks";
import { linearScale, monotonePath } from "./scale";

export interface SparklineProps {
  values: readonly number[];
  /** What the line shows, read out instead of the drawing: "Last 14 school days: 91.2% to 92.4%". */
  label: string;
  height?: number;
  className?: string;
}

/** MTB addition: a small trend line for a stat card. The last point (today) is marked. */
export function Sparkline({ values, label, height = 40, className }: SparklineProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const gid = `spark${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const M = { top: 6, right: 6, bottom: 4, left: 2 };
  const n = values.length;
  let body = null;
  if (width > 0 && n > 1) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = (max - min || Math.abs(max) || 1) * 0.12;
    const y = linearScale([min - pad, max + pad], [height - M.bottom, M.top]);
    const x = (i: number) => M.left + (i * (width - M.left - M.right)) / (n - 1);
    const pts = values.map((v, i) => ({ x: x(i), y: y(v) }));
    const line = monotonePath(pts);
    const last = pts[n - 1]!;
    const area = `${line}L${last.x},${height}L${pts[0]!.x},${height}Z`;
    body = (
      <svg width={width} height={height} aria-hidden="true" className="mtb-chart mtb-spark-svg">
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" style={{ stopColor: "var(--chart-1)", stopOpacity: 0.16 }} />
            <stop offset="1" style={{ stopColor: "var(--chart-1)", stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gid})`} className="mtb-chart-area-in" />
        <path d={line} pathLength={1} className="mtb-chart-line mtb-chart-draw" />
        <circle cx={last.x} cy={last.y} r={4} className="mtb-chart-pulse" />
        <circle cx={last.x} cy={last.y} r={4} className="mtb-chart-dot mtb-chart-pop" />
      </svg>
    );
  }
  return (
    <div ref={ref} className={cx("mtb-spark", className)} style={{ height }} role="img" aria-label={label}>
      {body}
    </div>
  );
}
