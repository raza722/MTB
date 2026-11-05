import {
  accentAlternatives,
  Button,
  contrastRatio,
  CONTRAST_MINIMUM,
  CONTRAST_PAIRS,
  DataTable,
  formatRatio,
  Icon,
  resolveColor,
  StatusBadge,
  tokens,
  type AccentId,
  type Column,
  type ColorToken,
  type Status,
  type ThemeId,
} from "@mtb/ui";
import { Code, Section, Specimen, ThemeIsland } from "../ds-kit";

const GROUPS: Array<{ title: string; note: string; match: (name: string) => boolean }> = [
  { title: "Grounds", note: "surface is the page; surface-raised is every card, table, panel and modal; surface-sunken is table headers and read-only inputs.", match: (n) => n.startsWith("surface") },
  { title: "Text", note: "ink for body and headings, ink-muted for labels and secondary lines, ink-subtle only for placeholders.", match: (n) => n.startsWith("ink") },
  { title: "Borders and focus", note: "border for hairlines; border-strong for control boundaries (3:1); focus-ring on every focusable control.", match: (n) => n.startsWith("border") || n === "focus-ring" },
  { title: "Brand", note: "One brand colour, for the single most important action on a view, the active nav item, links and the selected tab. Never decorative.", match: (n) => n.startsWith("brand") || n === "on-brand" },
  {
    title: "Signals",
    note: "Banners, toasts and inline validation. danger is also the destructive button; only the Pause all SMS switch uses it as a switch.",
    match: (n) => ["success", "warning", "danger", "info", "neutral", "slate"].some((s) => n === s || n.startsWith(`${s}-`)) || n === "on-danger",
  },
  { title: "Charts", note: "Series in chart-1 to chart-5 order; chart-track for the unfilled part of a meter.", match: (n) => n.startsWith("chart") },
];

const STATUS_GROUPS: Array<{ title: string; statuses: Status[]; tokenBase: Partial<Record<Status, string>> }> = [
  { title: "Fees", statuses: ["paid", "unpaid", "overdue", "cancelled"], tokenBase: { paid: "status-paid", unpaid: "status-unpaid", overdue: "status-overdue", cancelled: "status-cancelled" } },
  {
    title: "Attendance",
    statuses: ["present", "absent", "leave", "late", "holiday"],
    tokenBase: { present: "status-present", absent: "status-absent", leave: "status-leave", late: "status-late", holiday: "status-holiday" },
  },
  { title: "Results", statuses: ["draft", "declared"], tokenBase: { draft: "status-draft", declared: "status-declared" } },
  { title: "Approvals (MTB addition, mapped to fee tokens)", statuses: ["pending", "approved", "rejected"], tokenBase: { pending: "status-unpaid", approved: "status-paid", rejected: "status-overdue" } },
  {
    title: "SMS (queued, delivered, failed from the design system; sent and opted out added)",
    statuses: ["queued", "sent", "delivered", "failed", "optedout"],
    tokenBase: { queued: "status-leave", sent: "neutral", delivered: "status-paid", failed: "status-overdue", optedout: "neutral" },
  },
];

function Ratio({ fg, bg, theme, accent, kind }: { fg: string; bg: string; theme: ThemeId; accent: AccentId; kind: "text" | "non-text" }) {
  const r = contrastRatio(resolveColor(fg, theme, accent), resolveColor(bg, theme, accent));
  if (r === null) return <span className="text-ink-muted">—</span>;
  const pass = r >= CONTRAST_MINIMUM[kind];
  return (
    <span className="mtb-num inline-flex items-center gap-1" style={{ color: pass ? "var(--success-ink)" : "var(--danger-ink)" }}>
      <Icon name={pass ? "check" : "x"} size={14} label={pass ? "passes" : "fails"} />
      {formatRatio(r)}
    </span>
  );
}

function Swatch({ value, label }: { value: string; label: string }) {
  return (
    <span className="grid justify-items-center gap-1">
      <span className="block h-8 w-12 rounded-md border border-border" style={{ background: value }} aria-hidden="true" />
      <span className="text-[11px] leading-4 text-ink-muted">{label}</span>
    </span>
  );
}

function TokenTable({ list, accent }: { list: ColorToken[]; accent: AccentId }) {
  const columns: Array<Column<ColorToken>> = [
    {
      key: "swatch",
      header: "Light · Dark",
      width: 130,
      render: (t) => (
        <span className="flex gap-2">
          <Swatch value={resolveColor(t.name, "light", accent)} label="Light" />
          <Swatch value={resolveColor(t.name, "dark", accent)} label="Dark" />
        </span>
      ),
    },
    {
      key: "name",
      header: "Token · CSS · Tailwind",
      width: 250,
      render: (t) => (
        <span className="grid gap-0.5">
          <span className="mtb-cell-primary mtb-mono" style={{ color: "var(--ink)" }}>
            {t.name}
          </span>
          <Code>var(--{t.name})</Code>
          <Code>bg-{t.name} · text-{t.name}</Code>
        </span>
      ),
    },
    {
      key: "value",
      header: "Value",
      width: 120,
      render: (t) => (
        <span className="grid gap-0.5 mtb-mono text-small">
          <span>{resolveColor(t.name, "light", accent)}</span>
          <span className="text-ink-muted">{resolveColor(t.name, "dark", accent)}</span>
        </span>
      ),
    },
    { key: "usage", header: "Usage", render: (t) => <span className="text-small">{t.usage}</span> },
    {
      key: "contrast",
      header: "Contrast (light / dark)",
      width: 280,
      render: (t) => {
        const pairs = CONTRAST_PAIRS.filter((p) => p.fg === t.name || p.bg === t.name).slice(0, 3);
        if (pairs.length === 0) return <span className="text-small text-ink-muted">Decorative or translucent</span>;
        return (
          <span className="grid gap-1 text-small">
            {pairs.map((p) => (
              <span key={`${p.fg}|${p.bg}`} className="flex flex-wrap items-center gap-x-2">
                <span className="text-ink-muted">{p.fg === t.name ? `on ${p.bg}` : `${p.fg} on it`}</span>
                <Ratio fg={p.fg} bg={p.bg} theme="light" accent={accent} kind={p.kind} />
                <span className="text-ink-muted">/</span>
                <Ratio fg={p.fg} bg={p.bg} theme="dark" accent={accent} kind={p.kind} />
              </span>
            ))}
          </span>
        );
      },
    },
  ];
  return <DataTable columns={columns} rows={list} rowKey="name" density="dense" stickyHeader={false} />;
}

function BrandPreview({ theme, accent }: { theme: ThemeId; accent: AccentId }) {
  return (
    <ThemeIsland theme={theme} accent={accent} className="grid gap-3">
      <span className="text-caption uppercase text-ink-muted">
        {accent === "green" ? "MTB green" : "Navy"} · {theme === "light" ? "Light" : "Dark"}
      </span>
      <div className="flex items-center gap-2 rounded-md bg-brand-tint px-3 py-2 font-medium text-brand-ink">
        <Icon name="fees" size={18} /> Fees
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm">
          Post receipt
        </Button>
        <Button variant="quiet" size="sm">
          View ledger
        </Button>
        <Button variant="secondary" size="sm" data-force="focus">
          Focused
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status="declared" icon="lock" />
        <a href="#colour" className="text-brand-ink underline underline-offset-2">
          Ayesha Khan
        </a>
      </div>
      <div className="mtb-meter" role="img" aria-label="31% progress sample">
        <span style={{ width: "31%" }} />
      </div>
    </ThemeIsland>
  );
}

export function ColourSection({ accent }: { accent: AccentId }) {
  const all = tokens.color.tokens;
  const statusTokens = all.filter((t) => t.name.startsWith("status-"));
  return (
    <Section id="colour" title="Colour" intro={tokens.color.note}>
      <Specimen
        title="Brand: green (design system) or navy (alternative for review)"
        note={accentAlternatives.note}
        bodyClassName="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <BrandPreview theme="light" accent="green" />
        <BrandPreview theme="dark" accent="green" />
        <BrandPreview theme="light" accent="navy" />
        <BrandPreview theme="dark" accent="navy" />
      </Specimen>

      {GROUPS.map((g) => (
        <Specimen key={g.title} title={g.title} note={g.note} flush>
          <TokenTable list={all.filter((t) => g.match(t.name) && !t.name.startsWith("status-"))} accent={accent} />
        </Specimen>
      ))}

      <Specimen
        title="Status vocabularies"
        note="Fixed words reached only through semantic tokens. Every badge carries its word, so colour is never the only signal."
        bodyClassName="grid gap-5"
      >
        {STATUS_GROUPS.map((g) => (
          <div key={g.title} className="grid gap-2">
            <h4 className="m-0 text-title-3">{g.title}</h4>
            <div className="grid gap-3 md:grid-cols-2">
              {(["light", "dark"] as const).map((theme) => (
                <ThemeIsland key={theme} theme={theme} accent={accent} className="grid gap-2">
                  {g.statuses.map((s) => {
                    const base = g.tokenBase[s] ?? "neutral";
                    const tint = `${base}-tint`;
                    const ink = `${base}-ink`;
                    return (
                      <div key={s} className="flex items-center justify-between gap-3">
                        <StatusBadge status={s} />
                        <span className="flex items-center gap-2 text-small text-ink-muted">
                          <Code>{base}</Code>
                          <Ratio fg={ink} bg={tint} theme={theme} accent={accent} kind="text" />
                        </span>
                      </div>
                    );
                  })}
                </ThemeIsland>
              ))}
            </div>
          </div>
        ))}
        <p className="m-0 text-small text-ink-muted">
          {statusTokens.length} status tokens alias the signal tokens, so fees, attendance and results stay consistent in all three apps. Ratios shown are the badge text on its tint.
        </p>
      </Specimen>
    </Section>
  );
}
