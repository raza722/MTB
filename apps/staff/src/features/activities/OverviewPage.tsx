import { activitiesQueries, ACTIVITIES_EVENT_KIND_LABEL, ACTIVITIES_SCHEME_KIND_LABEL, type ActivitiesTodo } from "@mtb/api";
import { formatCount, formatDate, formatRs, formatSession } from "@mtb/domain";
import { AnimatedNumber, buttonClassName, DataTable, EmptyState, Icon, Panel, SegmentedBar, Skeleton, StatCard, type IconName } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { campusLabel } from "../../app/shell/campus";
import { Page, PageHeader } from "../../app/shell/page";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { ActivitiesNav, BarList, EventBadge, houseColor, LoadError, plural, stagger, ViewToggle } from "./shared";

const TODO_ICON: Record<ActivitiesTodo["kind"], IconName> = { AWARD: "award", RENEWAL: "refresh", TEST: "listChecks", EVENT: "calendar" };
const SCHEME_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

/** Scholarships and activities at a glance: what needs doing, fee relief, house standings and the next events. */
export function OverviewPage() {
  const ctx = useCtx();
  const navigate = useNavigate();
  const canManage = useCan("activities.manage");
  const readOnly = useReadOnly();
  const q = useQuery(activitiesQueries.overview(ctx));
  const o = q.data;
  const [reliefView, setReliefView] = useState<"chart" | "table">("chart");
  const [houseView, setHouseView] = useState<"chart" | "table">("chart");
  const leader = o?.houses[0];
  const reliefTotal = o?.reliefByScheme.reduce((s, r) => s + r.monthly, 0) ?? 0;
  const otherParts = (o?.reliefByScheme ?? []).slice(4);
  const parts = [
    ...(o?.reliefByScheme ?? []).slice(0, 4).map((r, i) => ({ key: r.schemeId, label: r.name, value: r.monthly, color: SCHEME_COLORS[i]!, awards: r.awards })),
    ...(otherParts.length ? [{ key: "other", label: `${otherParts.length} other schemes`, value: otherParts.reduce((s, r) => s + r.monthly, 0), color: SCHEME_COLORS[4]!, awards: otherParts.reduce((s, r) => s + r.awards, 0) }] : []),
  ];

  const open = (t: ActivitiesTodo) => void navigate({ to: t.to as never, search: ((prev: Record<string, unknown>) => ({ ...prev, ...(t.search ?? {}) })) as never });

  return (
    <Page>
      <PageHeader
        title="Scholarships and activities"
        actions={
          canManage && !readOnly && ctx.campus !== "ALL" ? (
            <>
              <Link to="/activities/events" search={((prev: Record<string, unknown>) => ({ ...prev, new: true })) as never} className={buttonClassName({ variant: "secondary" })}>
                <Icon name="calendar" size={18} />
                Add event
              </Link>
              <Link to="/activities/scholarships" search={((prev: Record<string, unknown>) => ({ ...prev, new: true })) as never} className={buttonClassName({ variant: "primary" })}>
                <Icon name="plus" size={18} />
                Propose a scholarship
              </Link>
            </>
          ) : undefined
        }
      />
      <ActivitiesNav />
      {q.isError && <LoadError what="The overview" error={q.error} onRetry={() => void q.refetch()} />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Students on scholarship"
          icon="award"
          loading={q.isLoading}
          value={<AnimatedNumber value={o?.awards.students ?? 0} format={formatCount} />}
          foot={o ? `${formatRs(o.awards.monthlyRelief)} off fees each month` : undefined}
          onClick={() => void navigate({ to: "/activities/scholarships", search: ((prev: Record<string, unknown>) => ({ ...prev, status: "APPROVED" })) as never })}
        />
        <StatCard
          label="Waiting for approval"
          icon="clock"
          tone={o && o.awards.pending > 0 ? "warning" : "neutral"}
          loading={q.isLoading}
          value={<AnimatedNumber value={o?.awards.pending ?? 0} format={formatCount} />}
          foot={o?.awards.pending ? "The principal or admin approves" : "Nothing waiting"}
          onClick={() => void navigate({ to: "/activities/scholarships", search: ((prev: Record<string, unknown>) => ({ ...prev, status: "PENDING" })) as never })}
        />
        <StatCard
          label={`Fee relief, session ${formatSession(ctx.session)}`}
          icon="fees"
          loading={q.isLoading}
          value={<AnimatedNumber value={o?.awards.sessionRelief ?? 0} format={formatRs} />}
          foot="Approved awards · the fees office applies them"
        />
        {ctx.campus === "ALL" ? (
          <StatCard label="Events held this session" icon="calendar" loading={q.isLoading} value={<AnimatedNumber value={o?.eventsDone ?? 0} format={formatCount} />} foot={o ? `${formatCount(o.certificates)} certificates issued` : undefined} />
        ) : (
          <StatCard
            label="House in the lead"
            icon="flag"
            loading={q.isLoading}
            value={leader ? leader.name : "—"}
            foot={leader ? `${formatCount(leader.points)} points · ${o && o.houses[1] ? `${formatCount(leader.points - o.houses[1].points)} ahead` : ""}` : undefined}
            onClick={() => void navigate({ to: "/activities/houses" })}
          />
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Panel id="act-todo" title="What needs doing" description="Approvals, marks, renewals and results waiting on someone, most urgent first." rise={1}>
          {q.isLoading ? (
            <div className="grid gap-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height={52} />
              ))}
            </div>
          ) : !o || o.todo.length === 0 ? (
            <EmptyState icon="checkCircle" title="Nothing waiting" description="Approvals, tests and event results are all up to date." />
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0">
              {o.todo.slice(0, 7).map((t, i) => (
                <li key={t.id} className="mtb-slide-in" style={stagger(i)}>
                  <button type="button" className="act-row" onClick={() => open(t)}>
                    <span className={`grid size-9 shrink-0 place-content-center rounded-full ${t.kind === "AWARD" || t.kind === "RENEWAL" ? "bg-warning-tint text-warning-ink" : "bg-brand-tint text-brand-ink"}`}>
                      <Icon name={TODO_ICON[t.kind]} size={18} />
                    </span>
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate font-medium">{t.title}</span>
                      <span className="truncate text-small text-ink-muted">{t.detail}</span>
                    </span>
                    <Icon name="chevronRight" size={16} className="text-ink-subtle" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          id="act-upcoming"
          title="Coming up"
          description="Next events on the calendar"
          rise={2}
          actions={
            <Link to="/activities/events" className="text-small font-medium text-brand-ink">
              Calendar
            </Link>
          }
        >
          {q.isLoading ? (
            <div className="grid gap-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height={52} />
              ))}
            </div>
          ) : !o || o.upcoming.length === 0 ? (
            <EmptyState icon="calendar" title="No events planned" description={readOnly ? "This session has ended." : "Add sports day, debates or national days to the calendar."} />
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0">
              {o.upcoming.map((e, i) => (
                <li key={e.id} className="mtb-slide-in" style={stagger(i)}>
                  <Link to="/activities/events/$eventId" params={{ eventId: e.id }} className="act-row">
                    <span className="act-date" aria-hidden="true">
                      <b>{e.date.slice(8)}</b>
                      <span>{formatDate(e.date).slice(3, 6)}</span>
                    </span>
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate font-medium">{e.title}</span>
                      <span className="truncate text-small text-ink-muted">
                        <span className="mtb-num">{formatDate(e.date)}</span> · {ACTIVITIES_EVENT_KIND_LABEL[e.kind]} · {plural(e.participants, "name")}
                        {ctx.campus === "ALL" ? ` · ${campusLabel(e.campus)}` : ""}
                      </span>
                    </span>
                    <EventBadge status={e.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel id="act-relief" title="Fee relief by scheme" description="Rupees off tuition each month, approved awards only" rise={3} actions={<ViewToggle value={reliefView} onChange={setReliefView} label="Fee relief view" />}>
          {q.isLoading ? (
            <Skeleton height={140} />
          ) : parts.length === 0 ? (
            <EmptyState icon="award" title="No approved awards" description="Approved scholarships and concessions appear here." />
          ) : reliefView === "chart" ? (
            <div className="grid gap-4">
              <p className="m-0 flex items-baseline gap-2">
                <span className="text-title-2 font-semibold tabular-nums">
                  <AnimatedNumber value={reliefTotal} format={formatRs} />
                </span>
                <span className="text-small text-ink-muted">a month across {plural(o?.awards.approved ?? 0, "award")}</span>
              </p>
              <SegmentedBar label="Fee relief by scheme" format={formatRs} segments={parts} />
              <ul className="m-0 grid list-none gap-2 p-0" aria-label="Legend">
                {parts.map((p, i) => (
                  <li key={p.key} className="mtb-slide-in flex items-center gap-2 text-small" style={stagger(i)}>
                    <span className="mtb-chart-key" style={{ background: p.color }} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{p.label}</span>
                    <span className="text-ink-muted">{plural(p.awards, "award")}</span>
                    <span className="w-24 text-right font-medium tabular-nums">{formatRs(p.value)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <DataTable
              caption="Fee relief by scheme"
              density="dense"
              rowKey="schemeId"
              rows={o?.reliefByScheme ?? []}
              columns={[
                { key: "name", header: "Scheme", render: (r) => r.name },
                { key: "kind", header: "Kind", render: (r) => ACTIVITIES_SCHEME_KIND_LABEL[r.kind] },
                { key: "awards", header: "Awards", align: "right", render: (r) => <span className="mtb-num">{r.awards}</span> },
                { key: "monthly", header: "Off a month", align: "right", render: (r) => <span className="mtb-num">{formatRs(r.monthly)}</span> },
              ]}
              footer={{ name: "Total", monthly: <span className="mtb-num font-semibold">{formatRs(reliefTotal)}</span> }}
            />
          )}
        </Panel>

        <Panel
          id="act-houses"
          title="House standings"
          description={ctx.campus === "ALL" ? "Houses belong to one campus" : `Points this session, ${campusLabel(ctx.campus)}`}
          rise={4}
          actions={ctx.campus !== "ALL" ? <ViewToggle value={houseView} onChange={setHouseView} label="House standings view" /> : undefined}
        >
          {ctx.campus === "ALL" ? (
            <EmptyState icon="flag" title="Choose a campus to see its houses" description="Each campus runs its own house competition." />
          ) : q.isLoading ? (
            <Skeleton height={140} />
          ) : !o || o.houses.length === 0 ? (
            <EmptyState icon="flag" title="No houses yet" />
          ) : houseView === "chart" ? (
            <BarList label="House points" format={formatCount} rows={o.houses.map((h) => ({ key: h.id, label: `${h.rank}. ${h.name}`, value: h.points, color: houseColor(h.tone), note: `${formatCount(h.members)} students` }))} />
          ) : (
            <DataTable
              caption="House standings"
              density="dense"
              rows={o.houses}
              columns={[
                { key: "rank", header: "Rank", width: 64, align: "right", render: (h) => <span className="mtb-num">{h.rank}</span> },
                { key: "name", header: "House", render: (h) => h.name },
                { key: "members", header: "Students", align: "right", render: (h) => <span className="mtb-num">{formatCount(h.members)}</span> },
                { key: "points", header: "Points", align: "right", render: (h) => <span className="mtb-num font-semibold">{formatCount(h.points)}</span> },
              ]}
            />
          )}
        </Panel>
      </div>

      {o && (
        <p className="m-0 text-small text-ink-muted">
          {plural(o.tests.open, "scholarship test")} taking names · {o.tests.marking} being marked · {plural(o.tests.ready, "merit list")} ready · {plural(o.eventsDone, "event")} held · {formatCount(o.certificates)} certificates issued
        </p>
      )}
    </Page>
  );
}
