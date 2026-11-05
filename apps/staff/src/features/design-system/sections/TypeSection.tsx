import {
  amountInWords,
  formatCancellationNo,
  formatCnic,
  formatDate,
  formatGrNo,
  formatLakh,
  formatLongDate,
  formatMobile,
  formatReceiptNo,
  formatRs,
  formatSession,
  formatTime,
  RECEIPT_NUMBER_PLACEHOLDER,
} from "@mtb/domain";
import { DataTable, tokens, Urdu, type Column } from "@mtb/ui";
import { Code, Section, Specimen } from "../ds-kit";

type Style = (typeof tokens.type.groups)[number]["styles"][number] & { family: string };

const styles: Style[] = tokens.type.groups.flatMap((g) => g.styles.map((s) => ({ ...s, family: g.family })));

function sampleClass(s: Style) {
  if (s.family === "urdu") return s.name; // urdu-title / urdu-body / urdu-small utilities
  if (s.family === "mono") return "mtb-mono";
  const extra = s.name === "caption" ? " uppercase" : s.name.startsWith("numeric") ? " tabular-nums" : "";
  return `text-${s.name}${extra}`;
}

const FORMATS: Array<{ id: string; rule: string; example: string; code: string }> = [
  { id: "money", rule: "Money: Rs, a space, thousands separators, no decimals. Right-aligned in tables.", example: formatRs(12250), code: "formatRs(12250)" },
  { id: "money-big", rule: "Full values in tables and stat cards", example: formatRs(4825000), code: "formatRs(4825000)" },
  { id: "lakh", rule: "Open decision: large totals also in lakh?", example: formatLakh(4825000), code: "formatLakh(4825000)" },
  { id: "words", rule: "Amount in words (receipts)", example: amountInWords(12250), code: "amountInWords(12250)" },
  { id: "date", rule: "Dates", example: formatDate("2026-11-04"), code: 'formatDate("2026-11-04")' },
  { id: "long", rule: "Dates with weekday (page context, teacher home)", example: formatLongDate("2026-11-04"), code: "formatLongDate(…)" },
  { id: "time", rule: "Times, Pakistan time", example: formatTime("2026-11-04T10:39:00+05:00"), code: "formatTime(…)" },
  { id: "session", rule: "Academic session (en dash)", example: formatSession(2026), code: "formatSession(2026)" },
  { id: "cnic", rule: "CNIC (mono)", example: formatCnic("3630245678901"), code: 'formatCnic("3630245678901")' },
  { id: "mobile", rule: "Mobile", example: formatMobile("03001234567"), code: 'formatMobile("03001234567")' },
  { id: "gr", rule: "G.R. number: campus code + number (mono)", example: formatGrNo("KC", 14823), code: 'formatGrNo("KC", 14823)' },
  { id: "receipt", rule: "Receipt: campus–session–sequence, gap-free, issued by the server", example: formatReceiptNo("KC", 2026, 4821), code: 'formatReceiptNo("KC", 2026, 4821)' },
  { id: "receipt-pending", rule: "Receipt number before posting", example: RECEIPT_NUMBER_PLACEHOLDER, code: "RECEIPT_NUMBER_PLACEHOLDER" },
  { id: "cancel", rule: "Cancellation document", example: formatCancellationNo("KC", 2026, 37), code: 'formatCancellationNo("KC", 2026, 37)' },
];

export function TypeSection() {
  const columns: Array<Column<Style>> = [
    {
      key: "name",
      header: "Style",
      width: 200,
      render: (s) => (
        <span className="grid gap-0.5">
          <span className="mtb-cell-primary">{s.name}</span>
          <Code>{sampleClass(s)}</Code>
        </span>
      ),
    },
    {
      key: "spec",
      header: "Size / line · weight",
      width: 170,
      render: (s) => (
        <span className="mtb-num text-small text-ink-muted">
          {s.fontSize.replace("px", "")}/{s.lineHeight.replace("px", "")} · {s.fontWeight}
          {s.letterSpacing ? ` · ${s.letterSpacing}` : ""}
        </span>
      ),
    },
    {
      key: "sample",
      header: "Sample",
      render: (s) =>
        s.family === "urdu" ? (
          <span lang="ur" dir="rtl" className={sampleClass(s)}>
            {s.sample}
          </span>
        ) : (
          <span className={sampleClass(s)}>{s.sample}</span>
        ),
    },
    { key: "usage", header: "Usage", width: 320, render: (s) => <span className="text-small text-ink-muted">{s.usage}</span> },
  ];

  return (
    <Section id="type" title="Type" intro={tokens.type.note}>
      <Specimen title="Type styles" note="Inter for English and every numeral, Noto Nastaliq Urdu for Urdu, JetBrains Mono for identifiers read digit by digit. All three are self-hosted." flush>
        <DataTable columns={columns} rows={styles} rowKey="name" stickyHeader={false} />
      </Specimen>

      <div className="grid gap-6 lg:grid-cols-2">
        <Specimen title="Urdu beside English" note="Nastaliq descends far below the baseline: Urdu always gets its own taller line and is isolated from the English around it.">
          <div className="grid gap-4">
            <div className="flex flex-wrap items-baseline gap-x-4">
              <span className="text-title-1">Ayesha Khan</span>
              <Urdu size="title">عائشہ خان</Urdu>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-3 text-small text-ink-muted">
              <span>d/o Imran Khan</span>
              <Urdu size="small">ولدیت: عمران خان</Urdu>
            </div>
            <Urdu as="p" size="body" className="m-0">
              محترم والدین، عائشہ خان (<bdi dir="ltr">7-B</bdi>) کی <bdi dir="ltr">8,500</bdi> روپے فیس کی آخری تاریخ <bdi dir="ltr">10-Nov-2026</bdi> ہے۔ یومیہ <bdi dir="ltr">10</bdi> روپے جرمانے سے بچنے کے لیے براہِ کرم بروقت ادائیگی کریں۔
            </Urdu>
            <div className="grid gap-1">
              <span className="text-caption uppercase text-ink-muted">Without bdi — the date and class flip</span>
              <Urdu as="p" size="small" className="m-0 text-ink-muted">
                آخری تاریخ 10-Nov-2026 ہے · کلاس 7-B
              </Urdu>
            </div>
            <p className="m-0 text-small text-ink-muted">
              Amounts, dates, CNICs and phone numbers stay in Western digits and read left to right inside Urdu: wrap each in <code className="mtb-mono">{'<bdi dir="ltr">'}</code>.
            </p>
          </div>
        </Specimen>

        <Specimen title="Tabular figures" note="Every number in tables, stat cards and receipts uses tabular figures so columns line up.">
          <div className="grid grid-cols-2 gap-6">
            <div className="grid gap-1 text-right" style={{ fontVariantNumeric: "proportional-nums" }}>
              <span className="text-caption uppercase text-ink-muted">Proportional</span>
              <span>Rs 111,111</span>
              <span>Rs 888,808</span>
              <span>Rs 4,825,000</span>
            </div>
            <div className="grid gap-1 text-right tabular-nums">
              <span className="text-caption uppercase text-ink-muted">Tabular (used)</span>
              <span>Rs 111,111</span>
              <span>Rs 888,808</span>
              <span>Rs 4,825,000</span>
            </div>
          </div>
        </Specimen>
      </div>

      <Specimen title="Formatting rules" note="Rendered live by @mtb/domain, the same functions every screen uses. The server issues receipt numbers; the browser only formats them." flush>
        <DataTable
          rows={FORMATS}
          stickyHeader={false}
          density="dense"
          columns={[
            { key: "rule", header: "Rule", render: (f) => <span className="text-small">{f.rule}</span> },
            { key: "example", header: "Shows as", width: 360, render: (f) => <span className={/cnic|gr|receipt|cancel/.test(f.id) ? "mtb-mono" : "mtb-num font-medium"}>{f.example}</span> },
            { key: "code", header: "Code", width: 300, render: (f) => <Code>{f.code}</Code> },
          ]}
        />
      </Specimen>
    </Section>
  );
}
