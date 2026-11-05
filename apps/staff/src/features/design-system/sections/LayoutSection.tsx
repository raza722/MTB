import { DataTable, Icon, ICON_NAMES, Money, StatusBadge, tokens } from "@mtb/ui";
import { Code, Section, Specimen } from "../ds-kit";
import { STUDENTS } from "../demo-data";

function GridDiagram({ columns, frame, margin, gutter, label, extra }: { columns: number; frame: number; margin: number; gutter: number; label: string; extra?: string }) {
  return (
    <figure className="m-0 grid gap-2">
      <div className="overflow-hidden rounded-md border border-border bg-surface-sunken" style={{ aspectRatio: columns === 12 ? "16 / 7" : "9 / 12", maxWidth: columns === 12 ? undefined : 220 }}>
        <div className="flex h-full" style={{ gap: `${(gutter / frame) * 100}%`, paddingInline: `${(margin / frame) * 100}%` }}>
          {Array.from({ length: columns }, (_, i) => (
            <div key={i} className="h-full flex-1 bg-info-tint" style={{ borderInline: "1px solid var(--info)" }} />
          ))}
        </div>
      </div>
      <figcaption className="text-small text-ink-muted">
        <b className="text-ink">{label}</b> · {frame}px frame, {columns} columns, {gutter}px gutter, {margin}px margin{extra ? ` · ${extra}` : ""}
      </figcaption>
    </figure>
  );
}

export function LayoutSection() {
  const rows = STUDENTS.slice(0, 3);
  return (
    <Section id="layout" title="Space, shape and layout" intro={tokens.spacing.note}>
      <div className="grid gap-6 lg:grid-cols-2">
        <Specimen title="Spacing" note="4px grid. Tailwind's spacing scale is the same grid: p-5 = space-5 = 20px.">
          <div className="grid gap-2">
            {tokens.spacing.tokens.map((t) => (
              <div key={t.name} className="grid grid-cols-[88px_56px_1fr] items-center gap-3">
                <Code>{t.name}</Code>
                <span className="mtb-num text-small text-ink-muted">{t.value}</span>
                <div className="grid gap-0.5">
                  <span className="block h-3 rounded-sm bg-brand-tint" style={{ width: t.value, boxShadow: "inset 0 0 0 1px var(--brand)" }} />
                  <span className="text-small text-ink-muted">{t.usage}</span>
                </div>
              </div>
            ))}
          </div>
        </Specimen>

        <div className="grid content-start gap-6">
          <Specimen title="Radius">
            <div className="flex flex-wrap gap-5">
              {tokens.radius.tokens.map((t) => (
                <div key={t.name} className="grid max-w-[150px] gap-2">
                  <span className="block h-14 w-14 border border-border-strong bg-surface-sunken" style={{ borderRadius: t.value }} />
                  <Code>{t.name}</Code>
                  <span className="text-small text-ink-muted">{t.usage}</span>
                </div>
              ))}
            </div>
          </Specimen>
          <Specimen title="Elevation" note={tokens.shadow.note}>
            <div className="grid gap-5 sm:grid-cols-3">
              {tokens.shadow.tokens.map((t) => (
                <div key={t.name} className="grid gap-2">
                  <span className={`block h-16 rounded-lg border border-border bg-surface-raised ${t.name}`} />
                  <Code>{t.name}</Code>
                  <span className="text-small text-ink-muted">{t.usage}</span>
                </div>
              ))}
            </div>
          </Specimen>
        </div>
      </div>

      <Specimen title="Grids" note="Staff app: 240px sidebar (64px collapsed), 48px top bar, 24px page padding. Teacher app and parent portal: one column at 390px with a sticky bottom action bar.">
        <div className="grid items-end gap-6 md:grid-cols-[1fr_220px]">
          <GridDiagram columns={12} frame={1440} margin={24} gutter={24} label="Desktop" extra="content area right of the sidebar; works down to 1280" />
          <GridDiagram columns={4} frame={390} margin={16} gutter={16} label="Mobile" />
        </div>
      </Specimen>

      <Specimen title="Table density" note="Default for most tables; dense for long ledgers; roomy for the fee counter, where cashiers click rows. Rows grow rather than clip when a cell holds Urdu." bodyClassName="grid gap-4">
        {(["dense", undefined, "roomy"] as const).map((d) => (
          <div key={d ?? "default"} className="grid gap-1">
            <span className="text-caption uppercase text-ink-muted">{d ?? "default"}</span>
            <DataTable
              rows={rows}
              stickyHeader={false}
              {...(d ? { density: d } : {})}
              columns={[
                { key: "name", header: "Student", render: (r) => <span className="mtb-cell-primary">{r.name}</span> },
                { key: "gr", header: "G.R.", width: 120, render: (r) => <span className="mtb-mono">{r.gr}</span> },
                { key: "status", header: "Fee status", width: 140, render: (r) => <StatusBadge status={r.status} /> },
                { key: "balance", header: "Balance", align: "right", width: 140, render: (r) => <Money value={r.balance} /> },
              ]}
            />
          </div>
        ))}
      </Specimen>

      <Specimen title={`Icons (${ICON_NAMES.length})`} note="The design system's own stroke icons: 24-unit grid, 1.75px stroke. 18px in buttons, 20px elsewhere, always with a text label or an aria-label. No emoji, no filled icons.">
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2 p-0">
          {ICON_NAMES.map((n) => (
            <li key={n} className="grid justify-items-center gap-1.5 rounded-md border border-border px-1 py-3 text-ink">
              <Icon name={n} />
              <span className="text-small text-ink-muted">{n}</span>
            </li>
          ))}
        </ul>
      </Specimen>
    </Section>
  );
}
