import { SETUP_AUDIT_AREAS, setupQueries, type SetupAuditArea, type SetupAuditEntry, type SetupAuditFilters } from "@mtb/api";
import { formatCount, formatDate, formatDateTime, formatTime, type IsoDate } from "@mtb/domain";
import { AreaChart, Button, cx, DataTable, DatePicker, EmptyState, Icon, Input, KeyValue, Pagination, Panel, Segmented, Select, SidePanel, Skeleton, StatusBadge, type IconName } from "@mtb/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useCtx } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import { QueryError, SetupPage } from "./shared";

const AREA_ICON: Record<SetupAuditArea, IconName> = {
  Campuses: "building",
  Sessions: "calendar",
  Classes: "layers",
  Subjects: "book",
  Teachers: "students",
  Users: "user",
  Roles: "shield",
  Settings: "settings",
  "Sign-in": "key",
};

/** One audit entry as a compact row (used on the Setup overview too). */
export function AuditRow({ entry, onOpen }: { entry: SetupAuditEntry; onOpen?: () => void }) {
  const body = (
    <>
      <span className={cx("setup-row-icon", `tone-${entry.tone}`)} aria-hidden="true">
        <Icon name={AREA_ICON[entry.area]} size={16} />
      </span>
      <div className="grid min-w-0 flex-1 gap-0.5 text-left">
        <span className="truncate text-ink">
          <span className="font-medium">{entry.actor}</span> · {entry.action.toLowerCase()} · <span className="font-medium">{entry.target}</span>
        </span>
        <span className="truncate text-small text-ink-muted">{entry.summary || entry.changes.map((c) => `${c.field}: ${c.from} → ${c.to}`).join("; ")}</span>
      </div>
      <time dateTime={entry.at} className="shrink-0 text-small tabular-nums text-ink-muted">
        {entry.at.slice(0, 10) === "2026-11-04" ? formatTime(entry.at) : formatDate(entry.at)}
      </time>
    </>
  );
  return onOpen ? (
    <button type="button" className="setup-row w-full border-0 bg-transparent" style={{ font: "inherit", cursor: "pointer" }} onClick={onOpen}>
      {body}
    </button>
  ) : (
    <div className="setup-row">{body}</div>
  );
}

function SignInsPanel() {
  const ctx = useCtx();
  const q = useQuery(setupQueries.signIns(ctx));
  const [view, setView] = useState<"chart" | "table">("chart");
  const days = q.data ?? [];
  const success = days.reduce((a, d) => a + d.success, 0);
  const failed = days.reduce((a, d) => a + d.failed, 0);
  const short = (d: IsoDate) => formatDate(d).slice(0, 6).replace("-", " ");
  return (
    <Panel
      id="setup-signins"
      title="Sign-ins, last 14 days"
      description={q.data ? `${formatCount(success)} successful · ${formatCount(failed)} failed (wrong password or code)` : "Loading…"}
      rise={0}
      actions={<Segmented aria-label="Show as" value={view} onChange={(v) => setView(v as "chart" | "table")} options={[{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }]} />}
    >
      {q.isError ? (
        <QueryError what="Sign-in activity" error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <Skeleton height={220} />
      ) : view === "chart" ? (
        <AreaChart
          data={days}
          value={(d) => d.success}
          height={220}
          axisLabel={(d, i) => (i === days.length - 1 ? "Today" : short(d.date))}
          formatAxis={(v) => formatCount(v)}
          label={`Successful sign-ins per day from ${formatDate(days[0]!.date)} to today`}
          describe={(d) => `${formatDate(d.date)}: ${d.success} successful, ${d.failed} failed`}
          tooltip={(d) => (
            <div className="grid gap-1">
              <span className="mtb-chart-tip-title">{formatDate(d.date)}</span>
              <span className="mtb-chart-tip-row">
                Successful <b className="mtb-chart-tip-value">{formatCount(d.success)}</b>
              </span>
              <span className="mtb-chart-tip-row">
                Failed <b className="mtb-chart-tip-value">{formatCount(d.failed)}</b>
              </span>
            </div>
          )}
        />
      ) : (
        <DataTable
          rows={days.slice().reverse()}
          rowKey="date"
          density="dense"
          maxHeight={260}
          columns={[
            { key: "date", header: "Date", render: (d) => formatDate(d.date) },
            { key: "success", header: "Successful", align: "right", render: (d) => formatCount(d.success) },
            { key: "failed", header: "Failed", align: "right", render: (d) => (d.failed ? <span className={d.failed > 6 ? "font-medium text-danger-ink" : undefined}>{formatCount(d.failed)}</span> : "0") },
          ]}
        />
      )}
    </Panel>
  );
}

function AuditDetail({ entry, onClose }: { entry: SetupAuditEntry | null; onClose: () => void }) {
  return (
    <SidePanel open={entry !== null} onClose={onClose} title={entry ? `${entry.action}: ${entry.target}` : ""} description={entry ? formatDateTime(entry.at) : undefined}>
      {entry && (
        <div className="grid gap-5">
          <KeyValue
            items={[
              ["Who", `${entry.actor} (${entry.actorRole})`],
              ["Area", entry.area],
              ["Campus", campusLabel(entry.campus)],
              ["From", entry.device],
            ]}
          />
          {entry.summary && <p className="m-0 text-ink">{entry.summary}</p>}
          {entry.changes.length > 0 ? (
            <table className="setup-changes">
              <caption className="mtb-sr-only">What changed</caption>
              <thead>
                <tr>
                  <th scope="col">What</th>
                  <th scope="col">Before</th>
                  <th scope="col">After</th>
                </tr>
              </thead>
              <tbody>
                {entry.changes.map((c, i) => (
                  <tr key={i}>
                    <td>{c.field}</td>
                    <td>{c.from === "—" ? <span className="text-ink-subtle">—</span> : <del>{c.from}</del>}</td>
                    <td>{c.to === "—" ? <span className="text-ink-subtle">—</span> : <ins>{c.to}</ins>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="m-0 text-small text-ink-muted">No field values changed with this entry.</p>
          )}
          <p className="m-0 text-small text-ink-muted">Entries can't be edited or deleted, by anyone.</p>
        </div>
      )}
    </SidePanel>
  );
}

function toCsv(rows: SetupAuditEntry[]): string {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const head = ["When", "Who", "Role", "Campus", "Area", "Action", "Target", "Summary", "Changes"];
  const body = rows.map((a) => [formatDateTime(a.at), a.actor, a.actorRole, campusLabel(a.campus), a.area, a.action, a.target, a.summary, a.changes.map((c) => `${c.field}: ${c.from} -> ${c.to}`).join("; ")].map(esc).join(","));
  return [head.join(","), ...body].join("\r\n");
}

export function AuditPage() {
  const ctx = useCtx();
  const [q, setQ] = useState("");
  const [area, setArea] = useState<SetupAuditArea | "">("");
  const [actor, setActor] = useState("");
  const [from, setFrom] = useState<IsoDate | null>(null);
  const [to, setTo] = useState<IsoDate | null>(null);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<SetupAuditEntry | null>(null);
  const filters: SetupAuditFilters = { page, pageSize: 20, ...(q.trim() ? { q: q.trim() } : {}), ...(area ? { area } : {}), ...(actor ? { actor } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) };
  const list = useQuery({ ...setupQueries.audit(ctx, filters), placeholderData: keepPreviousData });
  const data = list.data;
  const filtered = Boolean(q || area || actor || from || to);
  const reset = () => {
    setQ("");
    setArea("");
    setActor("");
    setFrom(null);
    setTo(null);
    setPage(1);
  };

  const download = () => {
    if (!data) return;
    const blob = new Blob([toCsv(data.items)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mtb-audit-log-${ctx.campus.toLowerCase()}-page-${page}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <SetupPage
      title="Audit log"
      actions={
        <Button icon="download" onClick={download} disabled={!data || data.items.length === 0}>
          Download this page (CSV)
        </Button>
      }
    >
      <SignInsPanel />
      <Panel id="setup-audit" title="Changes" description="Setup, users, roles, settings and sign-in events. Newest first." rise={1} flush>
        <DataTable
          rows={data?.items ?? []}
          loading={list.isLoading}
          onRowClick={setOpen}
          density="dense"
          caption="Audit log"
          toolbar={
            <div className="flex w-full flex-wrap items-end gap-3">
              <div className="w-64 max-w-full">
                <Input
                  aria-label="Search the audit log"
                  icon="search"
                  placeholder="Search names, records, values"
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
              <div className="w-44">
                <Select
                  aria-label="Area"
                  value={area}
                  onChange={(e) => {
                    setArea(e.target.value as SetupAuditArea | "");
                    setPage(1);
                  }}
                  options={[{ value: "", label: "All areas" }, ...SETUP_AUDIT_AREAS.map((a) => ({ value: a, label: a }))]}
                />
              </div>
              <div className="w-48">
                <Select
                  aria-label="Person"
                  value={actor}
                  onChange={(e) => {
                    setActor(e.target.value);
                    setPage(1);
                  }}
                  options={[{ value: "", label: "Everyone" }, ...(data?.actors ?? []).map((a) => ({ value: a, label: a }))]}
                />
              </div>
              <div className="w-40">
                <DatePicker
                  aria-label="From date"
                  placeholder="From"
                  value={from}
                  today="2026-11-04"
                  maxDate="2026-11-04"
                  onValueChange={(v) => {
                    setFrom(v);
                    setPage(1);
                  }}
                />
              </div>
              <div className="w-40">
                <DatePicker
                  aria-label="To date"
                  placeholder="To"
                  value={to}
                  today="2026-11-04"
                  maxDate="2026-11-04"
                  onValueChange={(v) => {
                    setTo(v);
                    setPage(1);
                  }}
                />
              </div>
              {filtered && (
                <Button size="sm" variant="ghost" icon="x" onClick={reset}>
                  Clear filters
                </Button>
              )}
            </div>
          }
          empty={
            list.isError ? (
              <div className="p-4">
                <QueryError what="The audit log" error={list.error} onRetry={() => void list.refetch()} />
              </div>
            ) : (
              <EmptyState
                icon="search"
                title={filtered ? "No entries match these filters" : "Nothing recorded yet"}
                description={filtered ? "Try a wider date range, or clear the filters." : "Changes to setup and users will appear here."}
                action={
                  filtered ? (
                    <Button size="sm" onClick={reset}>
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            )
          }
          columns={[
            {
              key: "at",
              header: "When",
              width: 170,
              render: (a) => (
                <span className="grid">
                  <span className="tabular-nums">{formatDate(a.at)}</span>
                  <span className="mtb-cell-secondary tabular-nums">{formatTime(a.at)}</span>
                </span>
              ),
            },
            {
              key: "actor",
              header: "Who",
              render: (a) => (
                <span className="grid">
                  <span>{a.actor}</span>
                  <span className="mtb-cell-secondary">{a.actorRole}</span>
                </span>
              ),
            },
            {
              key: "what",
              header: "What",
              render: (a) => (
                <span className="grid min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={a.tone === "danger" ? "danger" : a.tone === "warning" ? "warning" : a.tone === "success" ? "success" : "neutral"} dot={false}>
                      {a.action}
                    </StatusBadge>
                    <span className="font-medium">{a.target}</span>
                  </span>
                  <span className="mtb-cell-secondary line-clamp-1">{a.summary}</span>
                </span>
              ),
            },
            { key: "area", header: "Area", width: 120, render: (a) => <span className="text-small text-ink-muted">{a.area}</span> },
            { key: "campus", header: "Campus", width: 150, render: (a) => <span className="text-small">{campusLabel(a.campus)}</span> },
            { key: "changes", header: "Changes", align: "right", width: 90, render: (a) => (a.changes.length ? formatCount(a.changes.length) : <span className="text-ink-subtle">—</span>) },
          ]}
          pagination={data && data.total > data.pageSize ? <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} /> : undefined}
        />
      </Panel>
      <AuditDetail entry={open} onClose={() => setOpen(null)} />
    </SetupPage>
  );
}
