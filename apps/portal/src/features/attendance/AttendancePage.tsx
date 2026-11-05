import { portalQueries, type PortalAttendanceMonth } from "@mtb/api";
import { formatPercent, type AttendanceCode } from "@mtb/domain";
import { AttendanceCalendar, ColumnChart, cx, Icon, IconButton, Panel, Segmented, Skeleton, StatCard, StatusBadge } from "@mtb/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState, type CSSProperties } from "react";
import { DateL, Percent, Phone, SessionL } from "../../app/format";
import { Ltr, useLang } from "../../app/i18n";
import { PageHeader, QueryState } from "../../app/shell/page";
import { useChild } from "../../app/session";
import { ATT_STATUS } from "../home/HomePage";

const addMonth = (month: string, delta: number) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

/** "November 2026" / "نومبر 2026" */
function MonthLabel({ month }: { month: string }) {
  const { month: name } = useLang();
  const [y, m] = month.split("-").map(Number) as [number, number];
  return (
    <>
      {name(m - 1)} <Ltr className="tabular-nums">{y}</Ltr>
    </>
  );
}

const CODES: AttendanceCode[] = ["P", "A", "L", "LT", "H"];

/** Consecutive days of the same holiday become one line: "Summer vacation · 01-Jun-2026 – 30-Jun-2026". */
function holidayRanges(list: PortalAttendanceMonth["holidays"]) {
  const out: Array<{ from: string; to: string; name: string; nameUr: string }> = [];
  for (const h of list) {
    const last = out[out.length - 1];
    if (last && last.name === h.name) last.to = h.date;
    else out.push({ from: h.date, to: h.date, name: h.name, nameUr: h.nameUr });
  }
  return out;
}

/** Legend in the reader's language: letter, colour and word, with this month's count. */
function Legend({ a }: { a: PortalAttendanceMonth }) {
  const { t } = useLang();
  const words: Record<AttendanceCode, string> = { P: t("att.present"), A: t("att.absent"), L: t("att.leave"), LT: t("att.late"), H: t("att.holiday") };
  const counts: Record<AttendanceCode, number> = { P: a.summary.present, A: a.summary.absent, L: a.summary.leave, LT: a.summary.late, H: a.holidays.length };
  return (
    <ul className="mtb-attcal-legend" aria-label={t("att.legendHint")}>
      {CODES.map((c) => (
        <li key={c}>
          <span className={cx("mtb-attcal-cell mtb-attcal-swatch", `is-${c}`)} aria-hidden="true" dir="ltr">
            {c}
          </span>
          {words[c]}
          <Ltr className="tabular-nums">({counts[c]})</Ltr>
        </li>
      ))}
    </ul>
  );
}

function Stats({ a }: { a: PortalAttendanceMonth }) {
  const { t, rich } = useLang();
  const s = a.summary;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      <div className="mtb-rise col-span-2 lg:col-span-1" style={{ "--i": 0 } as CSSProperties}>
        <StatCard
          label={t("att.attended")}
          icon="attendance"
          value={s.percent === null ? "—" : <Percent value={s.percent} animate />}
          {...(s.percent !== null ? { meter: s.percent, meterLabel: formatPercent(s.percent) } : {})}
          foot={s.schoolDays > 0 ? rich("att.daysOf", { present: <Ltr className="tabular-nums">{s.present + s.late}</Ltr>, days: <Ltr className="tabular-nums">{s.schoolDays}</Ltr> }) : t("att.noSchoolDays")}
        />
      </div>
      {(
        [
          ["att.absent", s.absent, "absent"],
          ["att.leave", s.leave, "leave"],
          ["att.late", s.late, "late"],
        ] as const
      ).map(([key, n, status], i) => (
        <div key={key} className="mtb-rise" style={{ "--i": i + 1 } as CSSProperties}>
          <StatCard label={t(key)} value={<Ltr className="tabular-nums">{n}</Ltr>} foot={<StatusBadge status={status}>{ATT_LETTER[status]}</StatusBadge>} />
        </div>
      ))}
    </div>
  );
}

const ATT_LETTER = { absent: "A", leave: "L", late: "LT" } as const;

function MonthTable({ a }: { a: PortalAttendanceMonth }) {
  const { t, pick } = useLang();
  return (
    <div className="mtb-table-wrap">
      <div className="mtb-table-scroll">
        <table className="mtb-table">
          <thead>
            <tr>
              <th className="text-start">{t("att.colMonth")}</th>
              <th className="text-end">{t("att.colDays")}</th>
              <th className="text-end">{t("att.colAttended")}</th>
            </tr>
          </thead>
          <tbody>
            {a.months.map((m) => (
              <tr key={m.month}>
                <td>
                  <MonthLabel month={m.month} />
                </td>
                <td className="text-end tabular-nums">
                  <Ltr>{m.schoolDays}</Ltr>
                </td>
                <td className="text-end">{m.percent === null ? <span className="text-ink-muted">{m.note ? pick(m.note, m.noteUr) : t("att.vacation")}</span> : <Percent value={m.percent} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SessionPanel({ a }: { a: PortalAttendanceMonth }) {
  const { t, rich, month: monthName } = useLang();
  const [view, setView] = useState<"chart" | "table">("chart");
  const data = a.months.filter((m) => m.percent !== null);
  return (
    <Panel
      id="att-session"
      title={t("att.sessionTitle")}
      description={rich("att.sessionDesc", { session: <SessionL value={a.child.session} /> })}
      rise={4}
      actions={
        <Segmented
          aria-label={t("common.view")}
          value={view}
          onChange={(v) => setView(v as "chart" | "table")}
          options={[
            { value: "chart", label: t("common.chart") },
            { value: "table", label: t("common.table") },
          ]}
        />
      }
    >
      {view === "chart" && data.length > 0 ? (
        <div dir="ltr">
          <ColumnChart
            data={data}
            value={(m) => m.percent ?? 0}
            axisLabel={(m) => monthName(Number(m.month.slice(5)) - 1, true)}
            formatAxis={(v) => `${v}%`}
            tooltip={(m) => (
              <span>
                <MonthLabel month={m.month} />: {formatPercent(m.percent ?? 0)}
              </span>
            )}
            describe={(m) => `${m.month}: ${formatPercent(m.percent ?? 0)}`}
            label={t("att.chartLabel")}
            height={220}
          />
        </div>
      ) : (
        <MonthTable a={a} />
      )}
    </Panel>
  );
}

function AttendanceBody({ a, month, go }: { a: PortalAttendanceMonth; month: string; go: (m: string) => void }) {
  const { t, rich, pick, name, weekday, lang } = useLang();
  const [y, m] = month.split("-").map(Number) as [number, number];
  const canPrev = month > a.firstMonth;
  const canNext = month < a.lastMonth;
  return (
    <div className="grid gap-4 lg:gap-6">
      <Stats a={a} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-6">
        <Panel
          id="att-month"
          title={<MonthLabel month={month} />}
          description={t("att.legendHint")}
          rise={2}
          actions={
            <div className="flex items-center gap-1">
              <IconButton icon="chevronLeft" label={t("att.prev")} size="touch" variant="secondary" disabled={!canPrev} onClick={() => go(addMonth(month, -1))} className="portal-flip" />
              <IconButton icon="chevronRight" label={t("att.next")} size="touch" variant="secondary" disabled={!canNext} onClick={() => go(addMonth(month, 1))} className="portal-flip" />
            </div>
          }
        >
          <div className="portal-attcal grid gap-4">
            <AttendanceCalendar year={y} month={m - 1} days={a.days} holidayNames={Object.fromEntries(a.holidays.map((h) => [h.date, h.name]))} today={a.today} hideLegend />
            <Legend a={a} />
          </div>
        </Panel>

        <div className="grid content-start gap-4 lg:gap-6">
          <Panel id="att-days" title={t("att.daysTitle")} rise={3}>
            {a.marks.length === 0 ? (
              <p className="m-0 flex items-center gap-2 text-ink-muted">
                <Icon name="checkCircle" size={18} className="text-status-present-ink" />
                {t("att.daysNone")}
              </p>
            ) : (
              <ul className="m-0 grid list-none gap-1 p-0">
                {a.marks.map((d, i) => (
                  <li key={d.date} className="mtb-slide-in flex items-center justify-between gap-3 border-b border-border py-2 last:border-b-0" style={{ "--i": i } as CSSProperties}>
                    <span>
                      {weekday(d.date)} <DateL value={d.date} className="text-ink-muted" />
                    </span>
                    <StatusBadge status={ATT_STATUS[d.code]} lang={lang} />
                  </li>
                ))}
              </ul>
            )}
            {a.holidays.length > 0 && (
              <div className="mt-4 grid gap-1">
                <h3 className="m-0 text-caption text-ink-subtle">{t("att.holidaysTitle")}</h3>
                <ul className="m-0 grid list-none gap-1 p-0">
                  {holidayRanges(a.holidays).map((h) => (
                    <li key={h.from} className="flex flex-wrap items-center justify-between gap-x-3 text-small">
                      <span className="text-ink">{pick(h.name, h.nameUr)}</span>
                      <span className="text-ink-muted">
                        <DateL value={h.from} />
                        {h.to !== h.from && (
                          <>
                            {" – "}
                            <DateL value={h.to} />
                          </>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>
          <p className="m-0 flex items-start gap-2 text-small text-ink-muted">
            <Icon name="info" size={16} className="mt-1 shrink-0" />
            <span>{rich("att.wrong", { teacher: <span className="text-ink">{name(a.classTeacher, a.classTeacherUr)}</span>, phone: <Phone value={a.officePhone} call /> })}</span>
          </p>
        </div>
      </div>
      <SessionPanel a={a} />
    </div>
  );
}

function AttendanceSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <StatCard key={i} label="" loading />
        ))}
      </div>
      <div className="mtb-card grid gap-2 p-5">
        <Skeleton width={160} />
        <Skeleton width="100%" height={260} />
      </div>
    </div>
  );
}

/** Attendance: the month calendar with a legend, the days away or late, and the session month by month. */
export function AttendancePage({ month: requested }: { month?: string }) {
  const child = useChild()!;
  const { t, rich } = useLang();
  const navigate = useNavigate();
  // No month in the link: the server answers with the current month.
  const att = useQuery({ ...portalQueries.attendance(child.grNo, requested ?? ""), placeholderData: keepPreviousData });
  const go = (m: string) => void navigate({ to: "/attendance", search: ((prev: Record<string, unknown>) => ({ ...prev, month: m })) as never });
  return (
    <div key={child.grNo}>
      <PageHeader title={t("att.title")} description={rich("att.desc", { session: <SessionL value={child.session} /> })} />
      <QueryState query={att} skeleton={<AttendanceSkeleton />}>
        {(a) => <AttendanceBody a={a} month={a.month} go={go} />}
      </QueryState>
    </div>
  );
}
