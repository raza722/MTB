import { DataTable, EmptyState, Icon, Input, Select, StatusBadge, type Column } from "@mtb/ui";
import { useMemo, useState } from "react";
import { ACCOUNT_LABEL, GROUPS, STATES, type GroupId, type StateEntry } from "../catalogue";
import { LiveLinkButton } from "../kit";

const GROUP_TITLE = Object.fromEntries(GROUPS.map((g) => [g.id, g.title])) as Record<GroupId, string>;

const COLUMNS: Array<Column<StateEntry>> = [
  {
    key: "title",
    header: "State",
    width: 280,
    render: (s) => (
      <a href={`#state-${s.id}`} className="font-medium text-brand-ink underline-offset-2 hover:underline">
        {s.title}
      </a>
    ),
  },
  { key: "group", header: "Group", width: 170, render: (s) => <span className="text-ink-muted">{GROUP_TITLE[s.group]}</span> },
  { key: "where", header: "Where it appears", render: (s) => s.where },
  {
    key: "source",
    header: "From",
    width: 120,
    render: (s) =>
      s.source === "brief" ? (
        <StatusBadge status="brand" dot={false}>
          Brief §8
        </StatusBadge>
      ) : (
        <StatusBadge status="neutral" dot={false}>
          Added
        </StatusBadge>
      ),
  },
  {
    key: "who",
    header: "Sign in as",
    width: 190,
    render: (s) =>
      s.live.signInAs ? (
        <span className="grid">
          <span className="mtb-mono text-ink">{s.live.signInAs}</span>
          <span className="text-small text-ink-muted">{ACCOUNT_LABEL[s.live.signInAs]}</span>
        </span>
      ) : (
        "—"
      ),
  },
  { key: "live", header: <span className="mtb-sr-only">Live screen</span>, align: "right", width: 190, render: (s) => <LiveLinkButton live={s.live} label={s.live.app === "teacher" ? "Teacher app" : "Open"} /> },
];

/** Every state in one table: a checklist for reviewers, with a link to the specimen and to the live screen. */
export function IndexSection() {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<"" | GroupId>("");
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return STATES.filter((s) => (!group || s.group === group) && (!needle || `${s.title} ${s.where}`.toLowerCase().includes(needle)));
  }, [q, group]);

  return (
    <section id="index" aria-labelledby="index-title" className="mtb-states-group grid grid-cols-[minmax(0,1fr)] gap-5" data-state-group>
      <header className="flex items-start gap-4">
        <span className="mtb-states-group-icon" aria-hidden="true">
          <Icon name="listChecks" size={20} />
        </span>
        <div className="grid min-w-0 gap-1">
          <h2 id="index-title" className="m-0 text-title-1">
            Every state at a glance
          </h2>
          <p className="m-0 max-w-[72ch] text-ink-muted">A checklist for review: what each state is, where it appears, who to sign in as, and a link to the live screen.</p>
        </div>
      </header>
      <DataTable
        caption="Every state on this page"
        columns={COLUMNS}
        rows={rows}
        stickyHeader
        toolbar={
          <div className="flex w-full flex-wrap items-end gap-3">
            <div className="w-72 max-w-full">
              <Input icon="search" type="search" aria-label="Search states" placeholder="Search, e.g. receipt or offline" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="w-56 max-w-full">
              <Select aria-label="Group" value={group} onChange={(e) => setGroup(e.target.value as "" | GroupId)} options={[{ value: "", label: "All groups" }, ...GROUPS.map((g) => ({ value: g.id, label: g.title }))]} />
            </div>
            <span className="ml-auto text-small text-ink-muted tabular-nums">
              {rows.length} of {STATES.length} states
            </span>
          </div>
        }
        empty={<EmptyState icon="search" title="No state matches" description="Check the spelling, or choose All groups." />}
      />
    </section>
  );
}
