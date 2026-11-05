import { formatCount, formatRs, sumRs } from "@mtb/domain";
import { Avatar, DataTable, DateText, EmptyState, Input, Money, Pagination, Segmented, StatCard, StatusBadge, Switch, type Column, type SortState, type Status } from "@mtb/ui";
import { useMemo, useState } from "react";
import { Code, Section, Specimen } from "../ds-kit";
import { STUDENTS, type DemoStudent } from "../demo-data";

const BADGES: Array<{ group: string; statuses: Status[] }> = [
  { group: "Fees", statuses: ["paid", "unpaid", "overdue", "cancelled"] },
  { group: "Attendance", statuses: ["present", "absent", "leave", "late", "holiday"] },
  { group: "Results", statuses: ["draft", "declared"] },
  { group: "Approvals", statuses: ["pending", "approved", "rejected"] },
  { group: "SMS", statuses: ["queued", "sent", "delivered", "failed", "optedout"] },
];

export function DataSection() {
  const [sort, setSort] = useState<SortState>({ key: "name", dir: "asc" });
  const [selected, setSelected] = useState<Set<unknown>>(new Set(["s1"]));
  const [density, setDensity] = useState<"default" | "dense" | "roomy">("default");
  const [loading, setLoading] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const rows = useMemo(() => {
    if (empty) return [];
    const q = query.trim().toLowerCase();
    const filtered = STUDENTS.filter((s) => !q || `${s.name} ${s.gr} ${s.father}`.toLowerCase().includes(q));
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const k = sort.key as keyof DemoStudent;
      const av = a[k] ?? "";
      const bv = b[k] ?? "";
      return (typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv))) * dir;
    });
  }, [empty, query, sort]);

  const columns: Array<Column<DemoStudent>> = [
    {
      key: "name",
      header: "Student",
      sortable: true,
      render: (r) => (
        <span className="flex items-center gap-3">
          <Avatar name={r.name} size="sm" />
          <span className="grid">
            <span className="mtb-cell-primary">{r.name}</span>
            <span className="mtb-cell-secondary">
              {r.relation} {r.father}
            </span>
          </span>
        </span>
      ),
    },
    { key: "gr", header: "G.R.", width: 120, sortable: true, render: (r) => <span className="mtb-mono">{r.gr}</span> },
    { key: "klass", header: "Class", width: 90, sortable: true },
    { key: "status", header: "Fee status", width: 140, render: (r) => <StatusBadge status={r.status} /> },
    { key: "balance", header: "Balance", align: "right", width: 140, sortable: true, render: (r) => <Money value={r.balance} /> },
  ];

  return (
    <Section id="data" title="Data" intro="Tables are the heart of the staff app. Money and counts are right-aligned with tabular figures; amounts are never hidden on desktop; balances are calculated, never typed.">
      <Specimen
        title="DataTable"
        note="Sortable headers, row selection with select-all, sticky header, totals row, pagination, loading skeleton and empty state. Try the controls."
        bodyClassName="grid gap-4"
      >
        <DataTable
          caption="Students, Khalid Campus, Session 2026–27"
          columns={columns}
          rows={rows}
          loading={loading}
          {...(density === "default" ? {} : { density })}
          selectable
          selected={selected}
          onSelectedChange={setSelected}
          sort={sort}
          onSortChange={setSort}
          maxHeight={420}
          footer={{
            name: <span className="text-ink-muted">{formatCount(rows.length)} students</span>,
            balance: <Money value={sumRs(rows.map((r) => r.balance))} />,
          }}
          empty={<EmptyState icon="search" title="No students match" description={`Nothing found for "${query || "this filter"}". Check the spelling, or search by G.R. number or father's CNIC.`} />}
          toolbar={
            <>
              <div className="w-72">
                <Input aria-label="Search students" placeholder="Search by name, G.R. or father" icon="search" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <Segmented aria-label="Row density" value={density} onChange={(v) => setDensity(v as typeof density)} options={["default", "dense", "roomy"]} />
                <Switch label="Loading" checked={loading} onChange={(e) => setLoading(e.target.checked)} />
                <Switch label="Empty" checked={empty} onChange={(e) => setEmpty(e.target.checked)} />
              </div>
            </>
          }
          pagination={<Pagination page={page} pageSize={25} total={412} onPageChange={setPage} />}
        />
        <p className="m-0 text-small text-ink-muted">
          {selected.size} selected. Rows highlight with <Code>surface-selected</Code>; totals sit in the sunken footer row.
        </p>
      </Specimen>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Specimen title="StatusBadge" note="The one way to show a status: colour, a dot (or icon) and the word.">
          <div className="grid gap-4">
            {BADGES.map((b) => (
              <div key={b.group} className="grid grid-cols-[96px_1fr] items-center gap-3">
                <span className="text-caption uppercase text-ink-muted">{b.group}</span>
                <span className="flex flex-wrap gap-2">
                  {b.statuses.map((s) => (
                    <StatusBadge key={s} status={s} />
                  ))}
                </span>
              </div>
            ))}
            <div className="grid grid-cols-[96px_1fr] items-center gap-3">
              <span className="text-caption uppercase text-ink-muted">Large · icon</span>
              <span className="flex flex-wrap gap-2">
                <StatusBadge status="overdue" size="lg" />
                <StatusBadge status="declared" size="lg" icon="lock" />
                <StatusBadge status="pending" size="lg">
                  Change pending approval
                </StatusBadge>
              </span>
            </div>
            <div className="grid grid-cols-[96px_1fr] items-center gap-3">
              <span className="text-caption uppercase text-ink-muted">Urdu</span>
              <span className="flex flex-wrap gap-2">
                {(["paid", "unpaid", "overdue", "present", "absent", "leave", "declared"] as const).map((s) => (
                  <StatusBadge key={s} status={s} lang="ur" />
                ))}
              </span>
            </div>
          </div>
        </Specimen>

        <Specimen title="Money and dates">
          <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-6 gap-y-3">
            <dt className="text-ink-muted">Line total</dt>
            <dd className="m-0 text-right">
              <Money value={12250} />
            </dd>
            <dt className="text-ink-muted">Cancelled receipt (amount kept, struck through)</dt>
            <dd className="m-0 text-right">
              <Money value={12250} strike />
            </dd>
            <dt className="text-ink-muted">Change on a stat card</dt>
            <dd className="m-0 text-right">
              <Money value={486500} sign />
            </dd>
            <dt className="text-ink-muted">Ledger credit balance</dt>
            <dd className="m-0 text-right">
              <Money value={-500} />
            </dd>
            <dt className="text-ink-muted">Due date (with relative time beside it)</dt>
            <dd className="m-0 text-right">
              <DateText value="2026-11-10" /> <span className="text-small text-ink-muted">· due in 6 days</span>
            </dd>
          </dl>
        </Specimen>
      </div>

      <Specimen title="StatCard" note="Khalid Campus dashboard figures for Wednesday 04-Nov-2026. One figure per card; four to six in a row." bodyClassName="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label="Attendance today" icon="attendance" value="92.4%" delta={1.2} deltaLabel="+1.2 pts" foot="1,286 of 1,392 present" />
        <StatCard label="Fees collected today" icon="fees" value={formatRs(486500)} foot="57 receipts" />
        <StatCard
          label="This month"
          icon="trendUp"
          value={formatRs(2140000)}
          meter={31}
          meterLabel={`31% of the ${formatRs(6800000)} target`}
          foot={`31% of ${formatRs(6800000)} target`}
        />
        <StatCard label="Outstanding arrears" icon="alert" tone="danger" value={formatRs(3925750)} foot="412 students" />
        <StatCard label="New admissions" icon="admissions" tone="info" value="186" delta={12} deltaLabel="+12 this week" foot="this session" />
        <StatCard label="SMS today" icon="sms" tone="neutral" value="1,240" foot="delivered · 18 failed · 0 queued" />
        <StatCard label="Loading" loading />
      </Specimen>
    </Section>
  );
}
