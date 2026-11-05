import { formatDate, formatMobile, formatPercent, formatRs, formatSession, formatTime, type IsoDate, type IsoDateTime } from "@mtb/domain";
import { AnimatedNumber } from "@mtb/ui";
import { Ltr, useLang } from "./i18n";

/** "Rs 8,500", left to right in either language. */
export function Money({ value, animate, className }: { value: number; animate?: boolean; className?: string }) {
  return <Ltr className={className ?? "tabular-nums"}>{animate ? <AnimatedNumber value={value} format={formatRs} /> : formatRs(value)}</Ltr>;
}

/** "10-Nov-2026" in a <time> element. */
export function DateL({ value, className }: { value: IsoDate | IsoDateTime; className?: string }) {
  return (
    <Ltr className={className}>
      <time dateTime={value}>{formatDate(value)}</time>
    </Ltr>
  );
}

/** "Wednesday 04-Nov-2026" / "بدھ 04-Nov-2026": the weekday in the reader's language, the date in digits. */
export function LongDate({ value }: { value: IsoDate }) {
  const { weekday } = useLang();
  return (
    <>
      {weekday(value)} <DateL value={value} />
    </>
  );
}

/** "04-Nov-2026, 10:39 AM" */
export function DateTimeL({ value }: { value: IsoDateTime }) {
  return (
    <Ltr>
      <time dateTime={value}>
        {formatDate(value)}, {formatTime(value)}
      </time>
    </Ltr>
  );
}

/** "0300-1234567"; a tel: link when `call` is set. */
export function Phone({ value, call }: { value: string; call?: boolean }) {
  const text = formatMobile(value);
  return call ? (
    <a href={`tel:${value.replace(/\D/g, "")}`} className="font-medium text-brand-ink underline-offset-2 hover:underline">
      <Ltr className="tabular-nums">{text}</Ltr>
    </a>
  ) : (
    <Ltr className="tabular-nums">{text}</Ltr>
  );
}

export function Percent({ value, animate }: { value: number; animate?: boolean }) {
  return <Ltr className="tabular-nums">{animate ? <AnimatedNumber value={value} decimals={1} format={(v) => formatPercent(v)} /> : formatPercent(value)}</Ltr>;
}

/** "2026–27" */
export function SessionL({ value }: { value: number }) {
  return <Ltr className="tabular-nums">{formatSession(value)}</Ltr>;
}

/** "07:45" → "7:45 AM" (English) or "صبح 7:45" (Urdu). */
export function ClockTime({ value }: { value: string }) {
  const { isUr } = useLang();
  const [hh, mm] = value.split(":").map(Number) as [number, number];
  const h12 = ((hh + 11) % 12) + 1;
  const digits = `${h12}:${String(mm).padStart(2, "0")}`;
  if (!isUr) return <Ltr className="tabular-nums">{`${digits} ${hh < 12 ? "AM" : "PM"}`}</Ltr>;
  const part = hh < 12 ? "صبح" : hh < 16 ? "دوپہر" : "شام";
  return (
    <>
      {part} <Ltr className="tabular-nums">{digits}</Ltr>
    </>
  );
}

/** Class name such as "7-B" kept left to right. */
export function Cls({ value }: { value: string }) {
  return <Ltr>{value}</Ltr>;
}

/** First name for greetings: "Imran Khan" → "Imran", "عمران خان" → "عمران". */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
