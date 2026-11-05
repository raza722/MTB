/**
 * Money is always whole rupees, stored as integers. Never floats, never paisa.
 * Every amount shown in the UI goes through formatRs() so the format is identical everywhere:
 * "Rs 12,500" — "Rs", a space, thousands separators, no decimals.
 */
export type Rupees = number;

const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0, useGrouping: true });
const MINUS = "−"; // typographic minus, same width as digits

export function isRupees(value: unknown): value is Rupees {
  return typeof value === "number" && Number.isSafeInteger(value);
}

export function assertRupees(value: number, label = "amount"): asserts value is Rupees {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be whole rupees, got ${String(value)}`);
  }
}

export type SignDisplay = "auto" | "never" | "always";

/** "Rs 12,500". Negative amounts read "−Rs 1,500"; `sign: "never"` drops the sign. */
export function formatRs(amount: Rupees, options: { sign?: SignDisplay } = {}): string {
  assertRupees(amount);
  const sign = options.sign ?? "auto";
  const body = `Rs ${grouped.format(Math.abs(amount))}`;
  if (sign === "never" || amount === 0) return body;
  if (amount < 0) return `${MINUS}${body}`;
  return sign === "always" ? `+${body}` : body;
}

/** "1,286" — counts in stat cards and tables. */
export function formatCount(value: number): string {
  return grouped.format(value);
}

/** "92.4%" — one decimal by default. */
export function formatPercent(value: number, fractionDigits = 1): string {
  return `${value.toFixed(fractionDigits)}%`;
}

/**
 * Open decision (brief §11): should large totals also appear in lakh?
 * "Rs 48.25 lakh" for 4,825,000. Up to two decimals, trailing zeros trimmed.
 */
export function formatLakh(amount: Rupees): string {
  assertRupees(amount);
  const lakh = Math.abs(amount) / 100_000;
  const text = lakh.toFixed(2).replace(/\.?0+$/, "");
  return `${amount < 0 ? MINUS : ""}Rs ${text} lakh`;
}

/** Parse what a cashier types: "12,250", "Rs 12250", " 12 250 ". Returns null for anything that isn't whole rupees. */
export function parseRs(input: string): Rupees | null {
  const cleaned = input.replace(/rs\.?/i, "").replace(/[,\s]/g, "");
  if (cleaned === "" || !/^\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isSafeInteger(value) ? value : null;
}

/** Sum of whole-rupee amounts; throws if any value isn't an integer. */
export function sumRs(values: readonly Rupees[]): Rupees {
  let total = 0;
  for (const v of values) {
    assertRupees(v);
    total += v;
  }
  return total;
}
