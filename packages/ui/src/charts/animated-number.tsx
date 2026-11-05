import { useCountUp } from "./hooks";

export interface AnimatedNumberProps {
  value: number;
  /** Formats the in-between values too, e.g. formatRs or (v) => formatPercent(v). */
  format: (value: number) => string;
  /** Decimals the in-between values are rounded to (formatRs needs whole rupees). */
  decimals?: number;
  duration?: number;
  delay?: number;
}

/**
 * MTB addition: a figure that counts up when it first shows and when it changes.
 * Screen readers get the final value only; the moving digits are hidden from them.
 */
export function AnimatedNumber({ value, format, decimals = 0, duration, delay }: AnimatedNumberProps) {
  const current = useCountUp(value, { ...(duration !== undefined ? { duration } : {}), ...(delay !== undefined ? { delay } : {}) });
  const f = 10 ** decimals;
  return (
    <>
      <span aria-hidden="true">{format(Math.round(current * f) / f)}</span>
      <span className="mtb-sr-only">{format(value)}</span>
    </>
  );
}
