import { assertRupees, type Rupees } from "./money";

const ONES = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n] ?? "";
  const tens = TENS[Math.floor(n / 10)] ?? "";
  const rest = n % 10;
  return rest === 0 ? tens : `${tens} ${ONES[rest]}`;
}

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds > 0) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest > 0) parts.push(belowHundred(rest));
  return parts.join(" ");
}

function international(n: number): string {
  const scales: Array<[number, string]> = [
    [1_000_000_000, "Billion"],
    [1_000_000, "Million"],
    [1_000, "Thousand"],
  ];
  const parts: string[] = [];
  let rest = n;
  for (const [size, name] of scales) {
    if (rest >= size) {
      parts.push(`${belowThousand(Math.floor(rest / size))} ${name}`);
      rest %= size;
    }
  }
  if (rest > 0) parts.push(belowThousand(rest));
  return parts.join(" ");
}

function southAsian(n: number): string {
  const scales: Array<[number, string]> = [
    [10_000_000, "Crore"],
    [100_000, "Lakh"],
    [1_000, "Thousand"],
  ];
  const parts: string[] = [];
  let rest = n;
  for (const [size, name] of scales) {
    if (rest >= size) {
      const count = Math.floor(rest / size);
      parts.push(`${size === 10_000_000 ? southAsian(count) : belowHundred(count)} ${name}`);
      rest %= size;
    }
  }
  if (rest > 0) parts.push(belowThousand(rest));
  return parts.join(" ");
}

/**
 * "Rupees Twelve Thousand Two Hundred Fifty Only".
 * `system: "southAsian"` uses lakh/crore ("Forty Eight Lakh Twenty Five Thousand") — see open decision on lakh display.
 */
export function amountInWords(amount: Rupees, options: { system?: "international" | "southAsian" } = {}): string {
  assertRupees(amount);
  if (amount < 0) throw new RangeError("Amount in words needs a positive amount");
  const words = amount === 0 ? "Zero" : options.system === "southAsian" ? southAsian(amount) : international(amount);
  return `Rupees ${words} Only`;
}
