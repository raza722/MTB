import { SMS_CATEGORY_LABEL, smsQueries, smsStatusQueries, type SmsBatch, type SmsTemplateCategory, type SmsTrendDay } from "@mtb/api";
import { formatCount, formatDate, formatPercent, formatRs, formatWeekday, pakistanToday } from "@mtb/domain";
import { AnimatedNumber, buttonClassName, ColumnChart, DataTable, EmptyState, Icon, Panel, Segmented, SegmentedBar, Skeleton, Sparkline, StatCard, type Column } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useCan, useCanGroupWide, useCtx, useReadOnly } from "../../app/session";
import { campusLabel } from "../../app/shell/campus";
import { KillSwitch } from "./KillSwitch";
import { BatchStatus, ChannelLabel, LoadError, MessagesShell, slide, useGo, whenText } from "./shell";

const CATEGORY_COLOR: Record<SmsTemplateCategory, string> = {
  NOTICE: "var(--chart-1)",
  FEE: "var(--chart-2)",
  ATTENDANCE: "var(--chart-3)",
  RESULT: "var(--chart-4)",
  ADMISSION: "var(--chart-5)",
  DISCIPLINE: "var(--danger)",
  STAFF: "var(--info)",
  GENERAL: "var(--ink-subtle)",
};

const shortDay = (d: string) => formatDate(d).slice(0, 6).replace("-", " ");

/** /sms — messages today and this month, what they would cost, and what needs attention. */
export function OverviewPage() {
  const ctx = useCtx();
  const go = useGo();
  const canSend = useCan("sms.send");
  const canPause = useCanGroupWide("sms.pause"); // group-wide switch: an all-campus grant
  const readOnly = useReadOnly();
  const q = useQuery({ ...smsQueries.overview(ctx), refetchInterval: (s) => (s.state.data && (s.state.data.today.queued > 0 || s.state.data.today.sent > 0) ? 3000 : false) });
  const status = useQuery(smsStatusQueries.status());
  const [view, setView] = useState("chart");
  const d = q.data;

  const actions = canSend && !readOnly && (
    <>
      <Link to="/sms/notices" search={{ new: 1 } as never} className={buttonClassName({ variant: "secondary" })}>
        <Icon name="flag" size={16} /> New notice
      </Link>
      <Link to="/sms/compose" className={buttonClassName({ variant: "primary" })}>
        <Icon name="send" size={16} /> Compose message
      </Link>
    </>
  );

  // Nothing is sent from this system: today's new messages are held ("queued"); sent / delivered / failed are
  // migrated history only.
  const total = d ? d.today.delivered + d.today.sent + d.today.app : 0;
  const todayIso = pakistanToday();
  const budgetPct = d && d.month.budget ? Math.round((d.month.cost / d.month.budget) * 100) : 0;
  const appPct = d ? Math.round((d.appFamilies.withApp / Math.max(1, d.appFamilies.total)) * 100) : 0;
  const catTotal = d ? d.byCategory.reduce((s, c) => s + c.count, 0) : 0;

  const trendColumns: Array<Column<SmsTrendDay>> = [
    { key: "date", header: "Day", render: (t) => `${formatWeekday(t.date)} ${formatDate(t.date)}` },
    { key: "sms", header: "SMS", align: "right", render: (t) => <span className="mtb-num">{formatCount(t.sms)}</span> },
    { key: "app", header: "App notifications", align: "right", render: (t) => <span className="mtb-num">{formatCount(t.app)}</span> },
    { key: "failed", header: "Failed", align: "right", render: (t) => <span className="mtb-num">{formatCount(t.failed)}</span> },
  ];

  return (
    <MessagesShell title="Messages" {...(actions ? { actions } : {})}>
      {q.error && !d ? (
        <LoadError what="The messages overview" error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="mtb-rise" style={slide(0)}>
              <StatCard
                label="Sent today"
                icon="checkCircle"
                loading={!d}
                value={d ? <AnimatedNumber value={total} format={formatCount} /> : ""}
                foot={d ? `${formatCount(d.today.delivered + d.today.sent)} SMS · ${formatCount(d.today.app)} app · ${d.today.delivered + d.today.failed > 0 ? `${formatPercent(d.deliveryRate)} of SMS delivered` : "delivery rate —"} · ${formatCount(d.today.queued)} held in the outbox` : ""}
                {...(d ? { onClick: () => go("/sms/delivery") } : {})}
              >
                {d && <Sparkline values={d.trend.map((t) => t.sms + t.app)} label={`Last 14 days: ${d.trend.map((t) => t.sms + t.app).join(", ")} messages a day`} height={32} />}
              </StatCard>
            </div>
            <div className="mtb-rise" style={slide(1)}>
              <StatCard
                label="Failed today"
                icon="alertCircle"
                {...(d && d.today.failed > 0 ? { tone: "danger" as const } : {})}
                loading={!d}
                value={d ? <AnimatedNumber value={d.today.failed} format={formatCount} /> : ""}
                foot={d ? (d.today.queued > 0 ? `${formatCount(d.today.queued)} held in the outbox: nothing is sent from this system` : "Only messages from the old system can have failed.") : ""}
                {...(d ? { onClick: () => go("/sms/delivery", { status: "failed" }) } : {})}
              />
            </div>
            <div className="mtb-rise" style={slide(2)}>
              <StatCard
                label={`SMS cost, ${d?.month.label ?? "this month"}`}
                icon="fees"
                loading={!d}
                value={d ? <AnimatedNumber value={d.month.cost} format={formatRs} /> : ""}
                meter={budgetPct}
                {...(budgetPct >= 90 ? { meterTone: "danger" as const } : budgetPct >= 75 ? { meterTone: "warning" as const } : {})}
                meterLabel={`${budgetPct}% of the ${d ? formatRs(d.month.budget) : ""} monthly budget`}
                foot={d ? `of ${formatRs(d.month.budget)} budget · the app saved ${formatRs(d.month.saved)}` : ""}
              />
            </div>
            <div className="mtb-rise" style={slide(3)}>
              <StatCard
                label="Families on the MTB app"
                icon="smartphone"
                tone="info"
                loading={!d}
                value={d ? `${appPct}%` : ""}
                meter={appPct}
                meterLabel={`${appPct}% of families get free app notifications`}
                foot={d ? `${formatCount(d.appFamilies.withApp)} of ${formatCount(d.appFamilies.total)} families get free app notifications` : ""}
              />
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Panel
              id="sms-trend"
              rise={4}
              title="Messages, last 14 days"
              description={`${campusLabel(ctx.campus)}. SMS and app notifications together; new SMS are held in the outbox (nothing is sent from this system).`}
              actions={
                <Segmented
                  aria-label="Show messages as"
                  value={view}
                  onChange={setView}
                  options={[
                    { value: "chart", label: "Chart" },
                    { value: "table", label: "Table" },
                  ]}
                />
              }
            >
              {!d ? (
                <Skeleton height={260} />
              ) : view === "chart" ? (
                <ColumnChart
                  data={d.trend}
                  value={(t) => t.sms + t.app}
                  axisLabel={(t) => (t.date === todayIso ? "Today" : shortDay(t.date))}
                  formatAxis={(v) => formatCount(v)}
                  partial={(t) => t.date === todayIso}
                  partialLabel="Today so far"
                  valueLabel="Messages"
                  label="Messages sent per day, last 14 days"
                  describe={(t) => `${formatWeekday(t.date)} ${formatDate(t.date)}: ${formatCount(t.sms)} SMS, ${formatCount(t.app)} app notifications, ${formatCount(t.failed)} failed`}
                  tooltip={(t) => (
                    <>
                      <div className="mtb-chart-tip-title">
                        {formatWeekday(t.date)} {formatDate(t.date)}
                      </div>
                      <div className="mtb-chart-tip-value">{formatCount(t.sms + t.app)} messages</div>
                      <div className="mtb-chart-tip-row">
                        {formatCount(t.sms)} SMS · {formatCount(t.app)} app · {formatCount(t.failed)} failed
                      </div>
                    </>
                  )}
                />
              ) : (
                <DataTable caption="Messages sent per day" columns={trendColumns} rows={[...d.trend].reverse()} rowKey="date" density="dense" stickyHeader={false} />
              )}
            </Panel>

            <Panel id="sms-kinds" rise={5} title={`What was sent, ${d?.month.label ?? "this month"}`} description="Every message this month by kind, SMS and app together.">
              {!d ? (
                <Skeleton height={200} />
              ) : catTotal === 0 ? (
                <EmptyState icon="message" title="Nothing sent this month" description="Messages appear here as soon as they go out." />
              ) : (
                <div className="grid gap-4">
                  <p className="m-0 flex items-baseline gap-2">
                    <span className="text-title-1 tabular-nums">
                      <AnimatedNumber value={d.month.messages} format={formatCount} />
                    </span>
                    <span className="text-small text-ink-muted">messages · {formatCount(d.month.segments)} SMS parts</span>
                  </p>
                  <SegmentedBar label="Messages this month by kind" format={formatCount} segments={d.byCategory.map((c) => ({ key: c.category, label: SMS_CATEGORY_LABEL[c.category], value: c.count, color: CATEGORY_COLOR[c.category] }))} />
                  <ul className="sms-legend" aria-label="Messages by kind">
                    {d.byCategory.map((c, i) => (
                      <li key={c.category} className="mtb-slide-in" style={slide(i + 5)}>
                        <span className="mtb-chart-key" style={{ background: CATEGORY_COLOR[c.category] }} aria-hidden="true" />
                        {SMS_CATEGORY_LABEL[c.category]}
                        <b>{formatCount(c.count)}</b>
                        <span className="w-10 text-right tabular-nums">{Math.round((c.count / catTotal) * 100)}%</span>
                      </li>
                    ))}
                  </ul>
                  <div className="grid gap-1.5 border-t border-border pt-3">
                    <span className="text-small font-medium text-ink-muted">How it went out</span>
                    <SegmentedBar
                      label="SMS or app notification"
                      format={formatCount}
                      height={10}
                      segments={[
                        { key: "sms", label: "SMS", value: d.month.sms, color: "var(--chart-2)" },
                        { key: "app", label: "App notification", value: d.month.app, color: "var(--chart-1)" },
                      ]}
                    />
                    <ul className="sms-legend">
                      <li>
                        <span className="mtb-chart-key" style={{ background: "var(--chart-2)" }} aria-hidden="true" />
                        SMS (paid)
                        <b>{formatCount(d.month.sms)}</b>
                      </li>
                      <li>
                        <span className="mtb-chart-key" style={{ background: "var(--chart-1)" }} aria-hidden="true" />
                        App notification (free)
                        <b>{formatCount(d.month.app)}</b>
                      </li>
                    </ul>
                  </div>
                </div>
              )}
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel id="sms-attention" rise={6} title="Needs attention" description="Waiting for approval, held or failed.">
              {!d ? (
                <Skeleton height={140} />
              ) : (
                <AttentionList waiting={d.awaitingApproval} failed={d.today.failed} held={d.today.queued} paused={Boolean(status.data?.paused)} />
              )}
            </Panel>
            <Panel id="sms-scheduled" rise={7} title="Scheduled" description="Messages set to go out later." actions={<Link to="/sms/outbox" search={{ status: "SCHEDULED" } as never} className="text-small font-medium text-brand-ink">See all</Link>}>
              {!d ? <Skeleton height={140} /> : <BatchList list={d.scheduled} empty="Nothing scheduled. Choose “Schedule” when you compose a message." when={(b) => `Goes ${whenText(b.scheduledFor ?? b.createdAt)}`} />}
            </Panel>
            <Panel id="sms-recent" rise={8} title="Recent sends" description="The latest messages and how they did." actions={<Link to="/sms/outbox" className="text-small font-medium text-brand-ink">Outbox</Link>}>
              {!d ? <Skeleton height={140} /> : <BatchList list={d.recent} empty="Nothing sent yet." when={(b) => whenText(b.sentAt ?? b.createdAt)} />}
            </Panel>
          </div>
        </>
      )}
      {canPause && <KillSwitch />}
    </MessagesShell>
  );
}

function AttentionList({ waiting, failed, held, paused }: { waiting: SmsBatch[]; failed: number; held: number; paused: boolean }) {
  const items = [
    ...waiting.map((b) => ({ key: b.id, icon: "clock" as const, tone: "is-warning", title: `${b.templateName} · ${formatCount(b.recipients)} families`, desc: `Waiting for the principal's approval. Asked by ${b.createdBy}.`, to: "/sms/outbox", search: { batch: b.id } })),
    ...(held ? [{ key: "held", icon: "pause" as const, tone: "is-warning", title: `${formatCount(held)} SMS held`, desc: paused ? "All SMS are paused, and sending is switched off in this system: they stay in the outbox." : "Sending is switched off in this system: they stay in the outbox.", to: "/sms/delivery", search: { status: "queued" } }] : []),
    ...(failed ? [{ key: "failed", icon: "alertCircle" as const, tone: "is-warning", title: `${formatCount(failed)} SMS failed today`, desc: "Messages from the old system that it recorded as not sent.", to: "/sms/delivery", search: { status: "failed" } }] : []),
  ];
  if (!items.length) return <EmptyState icon="checkCircle" title="All clear" description="Nothing is waiting for approval and nothing failed today." />;
  return (
    <ul className="m-0 grid list-none gap-2 p-0">
      {items.map((it, i) => (
        <li key={it.key} className="mtb-slide-in" style={slide(i)}>
          <Link to={it.to as never} search={it.search as never} className="sms-row">
            <span className={`sms-row-icon ${it.tone}`}>
              <Icon name={it.icon} size={18} />
            </span>
            <span className="grid min-w-0 flex-1">
              <span className="truncate font-medium text-ink">{it.title}</span>
              <span className="text-small text-ink-muted">{it.desc}</span>
            </span>
            <Icon name="chevronRight" size={16} className="text-ink-subtle" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function BatchList({ list, empty, when }: { list: SmsBatch[]; empty: string; when: (b: SmsBatch) => string }) {
  if (!list.length) return <EmptyState icon="inbox" title="Nothing here" description={empty} />;
  return (
    <ul className="m-0 grid list-none gap-2 p-0">
      {list.slice(0, 5).map((b, i) => (
        <li key={b.id} className="mtb-slide-in" style={slide(i)}>
          <Link to="/sms/outbox" search={{ batch: b.id } as never} className="sms-row">
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="flex items-center gap-2">
                <span className="truncate font-medium text-ink">{b.templateName}</span>
                {b.status !== "SENT" && <BatchStatus status={b.status} />}
              </span>
              <span className="truncate text-small text-ink-muted">
                {when(b)} · {formatCount(b.recipients)} recipients · {b.audienceLabel}
              </span>
              <ChannelLabel channel={b.channel} short />
            </span>
            <Icon name="chevronRight" size={16} className="text-ink-subtle" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
