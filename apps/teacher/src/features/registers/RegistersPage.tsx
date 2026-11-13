import { teacherCountsLine, teacherQueries, type TeacherCounts, type TeacherRegisterDay, type TeacherRegisterOverview } from "@mtb/api";
import { formatDate, formatPercent, formatTime, formatWeekday } from "@mtb/domain";
import { AreaChart, EmptyState, Icon, Panel, Segmented, Skeleton, StatusBadge } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type CSSProperties } from "react";
import { useCtx } from "../../app/session";
import { QueryState } from "../../app/shell/QueryState";
import { Screen } from "../../app/shell/Screen";
import { MARK_LABEL, RegisterStatusBadge } from "./marks";
import { RegisterCard } from "./RegisterCard";

const VIEW_KEY = "mtb.teacher.registerView";

/** A past day whose register was taken, with its counts and percentage. */
type TakenDay = TeacherRegisterDay & { counts: TeacherCounts; percent: number };
const taken = (d: TeacherRegisterDay): d is TakenDay => d.status !== "NOT_MARKED" && d.counts !== null && d.percent !== null;
const pctOrDash = (v: number | null) => (v === null ? "—" : formatPercent(v));

function savedView(): "chart" | "table" {
  try {
    return localStorage.getItem(VIEW_KEY) === "table" ? "table" : "chart";
  } catch {
    return "chart";
  }
}

export function RegistersPage() {
  const ctx = useCtx();
  const q = useQuery(teacherQueries.registers(ctx));
  return (
    <Screen title="Registers" documentTitle="Registers">
      <QueryState
        query={q}
        skeleton={
          <div className="grid gap-4" aria-busy="true" aria-label="Loading registers">
            <Skeleton height={190} className="rounded-lg" />
            <Skeleton height={260} className="rounded-lg" />
          </div>
        }
      >
        {(list) =>
          list.length === 0 ? (
            <div className="mtb-card p-2">
              <EmptyState
                icon="listChecks"
                title="You don't take a class register"
                description="Class teachers take the daily register. Your lessons are in Timetable; if you should have a class, ask the office."
              />
            </div>
          ) : (
            <div className="grid gap-6">
              {list.map((o) => (
                <Overview key={o.classSection} o={o} />
              ))}
            </div>
          )
        }
      </QueryState>
    </Screen>
  );
}

function Overview({ o }: { o: TeacherRegisterOverview }) {
  const [view, setView] = useState<"chart" | "table">(savedView);
  // The chart shows the days the register was taken; the average is attended ÷ marked over those days (not an average of percentages).
  const days = [...o.days].reverse().filter(taken);
  const sums = days.reduce((a, d) => ({ attended: a.attended + d.counts.present + d.counts.late, marked: a.marked + d.counts.present + d.counts.absent + d.counts.leave + d.counts.late }), { attended: 0, marked: 0 });
  const avg = sums.marked ? Math.round((sums.attended / sums.marked) * 1000) / 10 : null;
  const pending = o.changes.filter((c) => c.status === "PENDING");

  return (
    <div className="grid gap-4">
      <RegisterCard r={o.today} rise={0} />

      <Panel
        id={`days-${o.classSection}`}
        rise={1}
        title="Last 10 school days"
        description={avg !== null ? `Present and late as a share of the students marked in ${o.classSection} · ${formatPercent(avg)} over these days` : "No register was taken on these days."}
        actions={
          <Segmented
            aria-label="Show as"
            value={view}
            onChange={(v) => {
              const next = v === "table" ? "table" : "chart";
              setView(next);
              try {
                localStorage.setItem(VIEW_KEY, next);
              } catch {
                /* this page only */
              }
            }}
            options={[
              { value: "chart", label: "Chart" },
              { value: "table", label: "Table" },
            ]}
          />
        }
        flush={view === "table"}
      >
        {view === "chart" ? (
          days.length === 0 ? (
            <EmptyState icon="listChecks" title="No registers to chart" description="The registers of the last school days were not taken." />
          ) : (
          <AreaChart
            data={days}
            value={(d: TakenDay) => d.percent}
            axisLabel={(d) => formatDate(d.date).slice(0, 6)}
            formatAxis={(v) => `${Math.round(v)}%`}
            tooltip={(d) => (
              <>
                <b>
                  {formatWeekday(d.date)} {formatDate(d.date)}
                </b>
                <br />
                {formatPercent(d.percent)} · {teacherCountsLine(d.counts)}
              </>
            )}
            describe={(d) => `${formatDate(d.date)}: ${formatPercent(d.percent)} present`}
            label={`${o.classSection} attendance over the last ${days.length} school days`}
            height={190}
          />
          )
        ) : (
          <ul className="m-0 grid list-none p-0">
            {o.days.map((d, i) => (
              <li key={d.date} className="mtb-slide-in border-t border-border first:border-t-0" style={{ "--i": i } as CSSProperties}>
                <Link
                  to="/registers/$classSection"
                  params={{ classSection: o.classSection }}
                  search={{ date: d.date }}
                  className="flex min-h-14 items-center gap-3 px-5 py-2 text-inherit no-underline hover:bg-surface-hover"
                >
                  <span className="grid w-24 shrink-0">
                    <span className="font-medium text-ink">{formatWeekday(d.date).slice(0, 3)}</span>
                    <span className="text-small text-ink-muted tabular-nums">
                      <bdi dir="ltr">{formatDate(d.date)}</bdi>
                    </span>
                  </span>
                  <span className="min-w-0 flex-1 text-small tabular-nums text-ink">
                    {taken(d) ? teacherCountsLine(d.counts) : <span className="text-ink-muted">Not taken</span>}
                    {d.pending > 0 && (
                      <span className="mt-1 block">
                        <RegisterStatusBadge status="CHANGE_PENDING" />
                      </span>
                    )}
                  </span>
                  <span className="text-body-strong tabular-nums text-ink">{taken(d) ? formatPercent(d.percent) : pctOrDash(null)}</span>
                  <Icon name="chevronRight" size={18} className="text-ink-muted" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel id={`changes-${o.classSection}`} rise={2} title="Change requests" description={pending.length ? `${pending.length} waiting for the principal` : "Corrections to submitted registers"} flush>
        {o.changes.length === 0 ? (
          <EmptyState icon="checkCircle" title="No change requests" description="To correct a submitted register, open it and tap the student." />
        ) : (
          <ul className="m-0 grid list-none p-0">
            {o.changes.map((c) => (
              <li key={c.id} className="border-t border-border first:border-t-0">
                <Link
                  to="/registers/$classSection"
                  params={{ classSection: c.classSection }}
                  search={{ date: c.date }}
                  className="grid gap-1 px-5 py-3 text-inherit no-underline hover:bg-surface-hover"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink">{c.studentName}</span>
                    <StatusBadge status={c.status === "PENDING" ? "pending" : c.status === "APPROVED" ? "approved" : "rejected"} />
                  </span>
                  <span className="text-small text-ink">
                    <bdi dir="ltr">{formatDate(c.date)}</bdi> · {MARK_LABEL[c.from]} → {MARK_LABEL[c.to]}
                  </span>
                  <span className="text-small text-ink-muted">{c.reason}</span>
                  <span className="text-caption text-ink-muted">
                    Asked <bdi dir="ltr">{formatDate(c.requestedAt)}</bdi> at <bdi dir="ltr">{formatTime(c.requestedAt)}</bdi>
                    {c.decidedBy ? ` · ${c.status === "APPROVED" ? "approved" : "rejected"} by ${c.decidedBy}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
