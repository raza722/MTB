// MTB addition: the little geometry charts need (no chart library).

export type Scale = (value: number) => number;

export function linearScale([d0, d1]: [number, number], [r0, r1]: [number, number]): Scale {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v) => r0 + (v - d0) * k;
}

/** A step of 1, 2 or 5 × 10ⁿ that gives about `count` intervals. */
export function niceStep(span: number, count: number): number {
  const raw = Math.max(span, 1e-9) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f >= 7.5 ? 10 : f >= 3.5 ? 5 : f >= 1.5 ? 2 : 1) * mag;
}

/** Ticks from 0 (or `min`) to a rounded-up maximum, e.g. 0, 2,00,000 … 10,00,000. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  const step = niceStep(max - min, count);
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Monotone cubic curve through the points (Fritsch–Carlson). It never overshoots, so a smooth line can't
 * suggest a value the data doesn't have: a day with Rs 0 never dips below the baseline.
 */
export function monotonePath(points: Point[]): string {
  const n = points.length;
  if (n === 0) return "";
  if (n === 1) return `M${points[0]!.x},${points[0]!.y}`;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(points[i + 1]!.x - points[i]!.x);
    slope.push((points[i + 1]!.y - points[i]!.y) / (dx[i] || 1));
  }
  const m: number[] = [slope[0]!];
  for (let i = 1; i < n - 1; i++) m.push(slope[i - 1]! * slope[i]! <= 0 ? 0 : (slope[i - 1]! + slope[i]!) / 2);
  m.push(slope[n - 2]!);
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / slope[i]!;
    const b = m[i + 1]! / slope[i]!;
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * slope[i]!;
      m[i + 1] = t * b * slope[i]!;
    }
  }
  let d = `M${points[0]!.x},${points[0]!.y}`;
  for (let i = 0; i < n - 1; i++) {
    const p = points[i]!;
    const q = points[i + 1]!;
    const h = dx[i]! / 3;
    d += `C${p.x + h},${p.y + m[i]! * h},${q.x - h},${q.y - m[i + 1]! * h},${q.x},${q.y}`;
  }
  return d;
}

/** Roughly how wide one character of the charts' 12px axis labels is. */
const CHAR_PX = 6.6;

/** Text that fits in `room` pixels, shortened with "…" when it does not (the full text stays in the tooltip). */
export function fitLabel(text: string, room: number): string {
  const max = Math.max(2, Math.floor(room / CHAR_PX));
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Where to anchor a label centred on x so it stays between `left` and `right` instead of running off the edge. */
export function edgeAnchor(text: string, x: number, left: number, right: number): { x: number; anchor: "start" | "middle" | "end" } {
  const half = (text.length * CHAR_PX) / 2;
  if (x - half < left) return { x: Math.max(left, x - half), anchor: "start" };
  if (x + half > right) return { x: Math.min(right, x + half), anchor: "end" };
  return { x, anchor: "middle" };
}

export interface AxisLabel {
  text: string;
  x: number;
  anchor: "start" | "middle" | "end";
}

/**
 * The category labels an x-axis can show without overlapping: every label when the bands are wide enough, otherwise
 * every 2nd, 3rd … one; long names shortened to the room they have; the first and last kept inside [left, right].
 * Short labels on a wide chart ("Prep", "7", "Khalid") come out exactly as before. Hidden ones are null.
 */
export function fitAxisLabels(labels: string[], band: number, centre: (i: number) => number, left: number, right: number): (AxisLabel | null)[] {
  const n = labels.length;
  if (n === 0 || band <= 0) return labels.map(() => null);
  const longest = Math.max(1, ...labels.map((s) => s.length));
  // Room for the whole label, up to about 12 characters; beyond that, shorten rather than drop more labels.
  const want = Math.min(longest, 12) * CHAR_PX + 10;
  const every = Math.min(n, Math.max(1, Math.ceil(want / band)));
  const room = band * every - 8;
  return labels.map((full, i) => {
    if (i % every !== 0) return null;
    const text = fitLabel(full, room);
    return { text, ...edgeAnchor(text, centre(i), left, right) };
  });
}

/** Index of the point nearest to x (points are evenly spaced or at least sorted by x). */
export function nearestIndex(xs: number[], x: number): number {
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i]! - x) < Math.abs(xs[best]! - x)) best = i;
  return best;
}
