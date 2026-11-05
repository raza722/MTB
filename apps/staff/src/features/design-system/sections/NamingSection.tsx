import { DataTable } from "@mtb/ui";
import { Code, Section, Specimen } from "../ds-kit";

const TOKEN_MAP = [
  { id: "1", design: "status-overdue-tint", css: "var(--status-overdue-tint)", code: "bg-status-overdue-tint" },
  { id: "2", design: "ink-muted", css: "var(--ink-muted)", code: "text-ink-muted" },
  { id: "3", design: "surface-raised", css: "var(--surface-raised)", code: "bg-surface-raised" },
  { id: "4", design: "border-strong", css: "var(--border-strong)", code: "border-border-strong" },
  { id: "5", design: "space-5", css: "var(--space-5)", code: "p-5 · gap-5" },
  { id: "6", design: "radius-lg", css: "var(--radius-lg)", code: "rounded-lg" },
  { id: "7", design: "shadow-md", css: "var(--shadow-md)", code: "shadow-md" },
  { id: "8", design: "title-1 (type)", css: "22px / 28px · 600", code: "text-title-1" },
  { id: "9", design: "urdu-body (type)", css: "15px / 34px · Noto Nastaliq Urdu", code: "urdu-body · <Urdu size=\"body\">" },
];

const COMPONENT_MAP = [
  { id: "1", design: "Button · primary · touch", code: '<Button variant="primary" size="touch">', css: ".mtb-btn .mtb-btn-primary .mtb-btn-touch" },
  { id: "2", design: "StatusBadge · overdue", code: '<StatusBadge status="overdue" />', css: ".mtb-badge .mtb-badge-overdue" },
  { id: "3", design: "Input · urdu", code: "<Input urdu />", css: ".mtb-input .mtb-input-urdu" },
  { id: "4", design: "DataTable · roomy", code: '<DataTable density="roomy" />', css: ".mtb-table .mtb-table-roomy" },
  { id: "5", design: "ConfirmDialog · danger", code: '<ConfirmDialog tone="danger" />', css: ".mtb-modal .mtb-confirm-body" },
  { id: "6", design: "StatCard · meter", code: "<StatCard meter={31} />", css: ".mtb-stat .mtb-meter" },
];

export function NamingSection() {
  return (
    <Section id="naming" title="Names in design and code" intro="Every token and component has one name everywhere, so a screen in the design system maps one-to-one to code a developer can read.">
      <div className="grid gap-6 xl:grid-cols-2">
        <Specimen title="Tokens" flush>
          <DataTable
            rows={TOKEN_MAP}
            stickyHeader={false}
            density="dense"
            columns={[
              { key: "design", header: "Design system", render: (r) => <span className="mtb-mono">{r.design}</span> },
              { key: "css", header: "CSS", render: (r) => <Code>{r.css}</Code> },
              { key: "code", header: "Tailwind / React", render: (r) => <Code>{r.code}</Code> },
            ]}
          />
        </Specimen>
        <Specimen title="Components" flush>
          <DataTable
            rows={COMPONENT_MAP}
            stickyHeader={false}
            density="dense"
            columns={[
              { key: "design", header: "Design system", render: (r) => <span className="mtb-cell-primary">{r.design}</span> },
              { key: "code", header: "React", render: (r) => <Code>{r.code}</Code> },
              { key: "css", header: "CSS classes", render: (r) => <Code>{r.css}</Code> },
            ]}
          />
        </Specimen>
      </div>

      <Specimen title="Notes for review" bodyClassName="grid gap-4 md:grid-cols-2">
        <div className="grid content-start gap-2">
          <h4 className="m-0 text-title-3">Added in code, not yet in the design system</h4>
          <ul className="m-0 grid gap-1 ps-5 text-small text-ink-muted">
            <li>DatePicker, CnicInput, AmountInput, Combobox</li>
            <li>AttendanceCalendar, Timeline, Tooltip, keyboard shortcut hints</li>
            <li>PermissionDenied (EmptyState with lock, as the brand book describes)</li>
            <li>ConfirmDialog typed confirmation (DECLARE, PAUSE), warning and retry error</li>
            <li>Button loadingLabel ("Posting…"); StatusBadge icon slot and Urdu labels</li>
            <li>Statuses: approved, rejected, sent, opted out</li>
            <li>Fix: Urdu textarea line height (34px instead of 20px)</li>
            <li>Fix: loading spinner was invisible on ghost and danger-quiet buttons</li>
            <li>Navy brand alternative for management's choice</li>
          </ul>
        </div>
        <div className="grid content-start gap-2">
          <h4 className="m-0 text-title-3">Where the design system and the brief differ (design system followed)</h4>
          <ul className="m-0 grid gap-1 ps-5 text-small text-ink-muted">
            <li>Focus ring is blue (focus-ring), not the brand green</li>
            <li>Type scale 12–28px (display 28, title-1 22…), not 12/14/16/20/24/32</li>
            <li>Cards and the top bar cast shadow-sm; the brief said overlays only</li>
            <li>Holiday uses the slate tint (hatched in the calendar), not plain grey</li>
            <li>Declared is brand tint with brand text, not a solid brand fill</li>
            <li>Badges carry a dot and the word; the lock icon is available as an option</li>
          </ul>
        </div>
      </Specimen>
    </Section>
  );
}
