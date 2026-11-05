import type { DashboardActivity, DashboardActivityKind, DashboardEvent, DashboardSummary } from "@mtb/api";
import { formatDate, formatRs, formatTime } from "@mtb/domain";
import { cx, EmptyState, Icon, Skeleton, type IconName } from "@mtb/ui";
import { Link } from "@tanstack/react-router";
import { DashCard } from "./DashCard";
import { fromToday, stagger, TODAY } from "./format";

const KIND: Record<DashboardActivityKind, { icon: IconName; tone: string }> = {
  RECEIPT: { icon: "receipt", tone: "brand" },
  CANCELLATION: { icon: "ban", tone: "danger" },
  ATTENDANCE: { icon: "attendance", tone: "info" },
  CORRECTION: { icon: "edit", tone: "warning" },
  SMS: { icon: "sms", tone: "neutral" },
  ADMISSION: { icon: "admissions", tone: "info" },
  RESULT: { icon: "award", tone: "brand" },
};

function when(at: string) {
  const day = at.slice(0, 10);
  return day === TODAY ? formatTime(at) : `${fromToday(day) === "Yesterday" ? "Yesterday" : formatDate(day)}, ${formatTime(at)}`;
}

function ActivityRow({ a, i }: { a: DashboardActivity; i: number }) {
  const k = KIND[a.kind];
  const inner = (
    <>
      <span className={cx("mtb-dash-feed-icon", `tone-${k.tone}`)}>
        <Icon name={k.icon} size={16} />
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span className="line-clamp-2 font-medium text-ink">{a.title}</span>
        <span className="truncate text-small text-ink-muted">
          {a.detail}
          {a.by ? ` · ${a.by}` : ""}
        </span>
      </span>
      <span className="grid justify-items-end gap-0.5 text-right">
        {a.amount !== undefined && <span className="mtb-money font-medium tabular-nums">{formatRs(a.amount)}</span>}
        <time dateTime={a.at} className="whitespace-nowrap text-small text-ink-muted">
          {when(a.at)}
        </time>
      </span>
    </>
  );
  return (
    <li className="mtb-slide-in" style={stagger(i + 8)}>
      {a.receiptNo ? (
        <Link to="/fees/receipts/$receiptNo" params={{ receiptNo: a.receiptNo }} className="mtb-dash-feed-row mtb-dash-feed-link">
          {inner}
        </Link>
      ) : (
        <div className="mtb-dash-feed-row">{inner}</div>
      )}
    </li>
  );
}

/** What happened on this campus today: receipts (including ones posted in this demo), registers, requests, SMS. */
export function ActivityCard({ s, wide }: { s: DashboardSummary | undefined; wide?: boolean }) {
  return (
    <DashCard id="activity" title="Recent activity" description="Today and yesterday, newest first" style={stagger(9)} className={wide ? "xl:col-span-2" : undefined}>
      {!s ? (
        <div className="grid gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={40} />
          ))}
        </div>
      ) : s.activity.length === 0 ? (
        <EmptyState icon="inbox" title="Nothing yet today" description="Receipts, registers and requests show here as they happen." />
      ) : (
        <ol className={cx("mtb-dash-feed", wide && "mtb-dash-feed-wide")}>
          {s.activity.map((a, i) => (
            <ActivityRow key={a.id} a={a} i={i} />
          ))}
        </ol>
      )}
    </DashCard>
  );
}

const EVENT_TONE: Record<DashboardEvent["kind"], string> = { FEE_DUE: "warning", LATE_FINE: "danger", TEST: "info", EXAM: "info", MEETING: "neutral" };

/** The next few dates that matter: tuition due, late fine starting, entrance tests. */
export function UpcomingCard({ s }: { s: DashboardSummary | undefined }) {
  return (
    <DashCard id="upcoming" title="Coming up" description="The next dates that need the office" style={stagger(8)}>
      {!s ? (
        <div className="grid gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={48} />
          ))}
        </div>
      ) : (
        <ol className="mtb-dash-upcoming">
          {s.upcoming.map((e, i) => {
            const date = formatDate(e.date);
            return (
              <li key={e.id} className="mtb-dash-upcoming-row mtb-slide-in" style={stagger(i + 7)}>
                <time dateTime={e.date} className={cx("mtb-dash-date", `tone-${EVENT_TONE[e.kind]}`)}>
                  <span className="mtb-dash-date-d">{date.slice(0, 2)}</span>
                  <span className="mtb-dash-date-m">{date.slice(3, 6)}</span>
                </time>
                <span className="grid min-w-0 gap-0.5">
                  <span className="line-clamp-2 font-medium text-ink">{e.title}</span>
                  <span className="truncate text-small text-ink-muted">{e.detail}</span>
                </span>
                <span className="mtb-dash-when">{fromToday(e.date)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </DashCard>
  );
}
