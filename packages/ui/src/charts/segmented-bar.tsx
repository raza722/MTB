import { Tooltip } from "../components/overlays";

export interface BarSegment {
  key: string;
  label: string;
  value: number;
  /** A status colour, e.g. "var(--status-paid)". Status colours carry an icon and a label in the legend. */
  color: string;
}

export interface SegmentedBarProps {
  segments: readonly BarSegment[];
  /** Accessible name; the parts are listed after it. */
  label: string;
  format?: (value: number) => string;
  height?: number;
}

/**
 * MTB addition: the parts of one whole as a single bar (students paid / unpaid / overdue). Close values read
 * better here than in a donut. Always shown with a legend that names each part and its count.
 */
export function SegmentedBar({ segments, label, format = String, height = 14 }: SegmentedBarProps) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const pct = (v: number) => `${Math.round((v / total) * 100)}%`;
  const described = `${label}: ${segments.map((s) => `${s.label} ${format(s.value)} (${pct(s.value)})`).join(", ")}`;
  return (
    <div className="mtb-segbar" style={{ height }} role="img" aria-label={described}>
      {segments
        .filter((s) => s.value > 0)
        .map((s, i) => (
          <Tooltip
            key={s.key}
            content={
              <span>
                {s.label}: {format(s.value)} · {pct(s.value)}
              </span>
            }
          >
            <span className="mtb-segbar-part" style={{ flexGrow: s.value, background: s.color, animationDelay: `${200 + i * 120}ms` }} />
          </Tooltip>
        ))}
    </div>
  );
}
