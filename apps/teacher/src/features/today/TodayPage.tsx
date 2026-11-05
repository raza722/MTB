import { teacherQueries, TEACHER_REGISTER_STATUS_LABEL, type TeacherPaper, type TeacherPeriod, type TeacherToday } from "@mtb/api";
import { formatDate, formatLongDate, formatSession, formatWeekday } from "@mtb/domain";
import { Icon, IconButton, Skeleton, StatusBadge, Urdu, cx } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { useCtx } from "../../app/session";
import { QueryState } from "../../app/shell/QueryState";
import { Screen, Section } from "../../app/shell/Screen";
import { clock, greeting, periodPhase, pkMinutesNow, shortName, toMins } from "../../app/time";
import { RegisterStatusBadge } from "../registers/marks";
import { RegisterCard } from "../registers/RegisterCard";

export function TodayPage() {
  const ctx = useCtx();
  const q = useQuery(teacherQueries.today(ctx));
  const navigate = useNavigate();
  const unread = q.data?.unread ?? 0;
  return (
    <Screen
      title="Today"
      documentTitle="Today"
      actions={
        <span className="relative">
          <IconButton icon="bell" label={unread ? `Notifications, ${unread} unread` : "Notifications"} size="touch" onClick={() => void navigate({ to: "/more/notifications" })} />
          {unread > 0 && <span className="pointer-events-none absolute top-2 right-2 size-2.5 rounded-full bg-danger ring-2 ring-surface-raised" aria-hidden="true" />}
        </span>
      }
    >
      <QueryState query={q} skeleton={<TodaySkeleton />}>
        {(t) => <TodayBody t={t} />}
      </QueryState>
    </Screen>
  );
}

function TodayBody({ t }: { t: TeacherToday }) {
  const now = pkMinutesNow();
  const nextIndex = t.periods.findIndex((p) => toMins(p.start) > now);
  return (
    <div className="grid gap-6">
      <div className="mtb-rise grid gap-0.5">
        <p className="m-0 text-body-large text-ink-muted">{greeting()},</p>
        <h2 className="m-0 text-display text-ink">{shortName(t.teacherName)}</h2>
        <p className="m-0 mt-1 text-ink">
          <bdi dir="ltr">{formatLongDate(t.date)}</bdi>
        </p>
        <p className="m-0 text-small text-ink-muted">
          {t.campusName} · Session {formatSession(t.session)}
        </p>
      </div>

      {t.closed ? (
        <article className="mtb-card mtb-rise grid gap-2 border-status-holiday bg-status-holiday-tint p-4" style={{ "--i": 1 } as CSSProperties} aria-labelledby="holiday-title">
          <div className="flex items-center gap-2">
            <Icon name="calendar" size={22} className="text-status-holiday-ink" />
            <StatusBadge status="holiday">Holiday</StatusBadge>
          </div>
          <h3 id="holiday-title" className="m-0 text-title-2 text-ink">
            No attendance today — {t.closed.name}
          </h3>
          {t.closed.nameUr && (
            <Urdu size="body" className="text-ink">
              {t.closed.nameUr}
            </Urdu>
          )}
          <p className="m-0 text-ink-muted">Registers are closed for the day and there are no classes on your timetable.</p>
        </article>
      ) : (
        t.registers.map((r, i) => <RegisterCard key={r.classSection} r={r} rise={1 + i} />)
      )}

      {!t.closed && (
        <Section title={`Today's classes · ${t.periods.length}`} rise={2} action={<Link to="/timetable" className="text-small font-medium text-brand-ink no-underline">Week</Link>}>
          {t.periods.length === 0 ? (
            <p className="m-0 mtb-card p-4 text-ink-muted">No classes on your timetable today.</p>
          ) : (
            <ol className="m-0 grid list-none gap-2 p-0">
              {t.periods.map((p, i) => (
                <PeriodCard key={`${p.period}-${p.classSection}`} p={p} i={i} isNext={i === nextIndex} />
              ))}
            </ol>
          )}
        </Section>
      )}

      {t.papers.length > 0 && (
        <Section title="Marks to enter" rise={3} action={<Link to="/marks" className="text-small font-medium text-brand-ink no-underline">All papers</Link>}>
          <ul className="m-0 grid list-none gap-2 p-0">
            {t.papers.map((p) => (
              <li key={`${p.examId}-${p.classSection}-${p.subjectId}`}>
                <PaperLink p={p} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {t.nextClosed && (
        <Section title="Coming up" rise={4}>
          <div className="mtb-card flex items-center gap-3 p-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-status-holiday-tint text-status-holiday-ink">
              <Icon name="calendar" />
            </span>
            <div className="min-w-0">
              <p className="m-0 font-medium text-ink">{t.nextClosed.name}</p>
              <p className="m-0 text-small text-ink-muted">
                {formatWeekday(t.nextClosed.date)} <bdi dir="ltr">{formatDate(t.nextClosed.date)}</bdi> · school closed, no register
              </p>
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}

function PeriodCard({ p, i, isNext }: { p: TeacherPeriod; i: number; isNext: boolean }) {
  const phase = periodPhase(p.start, p.end);
  const body = (
    <>
      <div className="grid w-[4.5rem] shrink-0 content-start gap-0.5">
        <span className={cx("text-body-strong tabular-nums", phase === "done" ? "text-ink-muted" : "text-ink")}>{clock(p.start)}</span>
        <span className="text-caption text-ink-muted">Period {p.period}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-ink">
          {p.classSection} · {p.subject}
          {p.stream && <StatusBadge status="neutral">{p.stream} group</StatusBadge>}
          {p.cover && <StatusBadge status="info">Cover</StatusBadge>}
        </p>
        <p className="m-0 text-small text-ink-muted">
          {p.room} · until {clock(p.end)}
        </p>
        {p.register && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <RegisterStatusBadge status={p.register.status} />
            <span className="text-small text-ink-muted">{p.register.mine ? "Your register" : `Register by ${p.register.classTeacher}`}</span>
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {phase === "now" && <StatusBadge status="brand">Now</StatusBadge>}
        {phase !== "now" && isNext && <StatusBadge status="neutral">Next</StatusBadge>}
        {p.register?.mine && <Icon name="chevronRight" size={18} className="text-ink-muted" />}
      </div>
    </>
  );
  const cls = cx("mtb-card flex items-start gap-3 p-3", phase === "now" && "border-brand", phase === "done" && "opacity-80");
  return (
    <li className="mtb-slide-in" style={{ "--i": i } as CSSProperties}>
      {p.register?.mine ? (
        <Link
          to="/registers/$classSection"
          params={{ classSection: p.classSection }}
          className={cx(cls, "text-inherit no-underline hover:border-border-strong")}
          aria-label={`${p.classSection} ${p.subject} at ${clock(p.start)}. Register ${TEACHER_REGISTER_STATUS_LABEL[p.register.status]}. Open the register.`}
        >
          {body}
        </Link>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}

/** An open paper: where its marks stand, one tap to carry on. */
export function PaperLink({ p }: { p: TeacherPaper }) {
  const pct = p.candidates ? Math.round((p.entered / p.candidates) * 100) : 0;
  return (
    <Link
      to="/marks/$examId/$classSection/$subjectId"
      params={{ examId: p.examId, classSection: p.classSection, subjectId: p.subjectId }}
      className="mtb-card flex items-center gap-3 p-4 text-inherit no-underline hover:border-border-strong"
    >
      <div className="min-w-0 flex-1">
        <p className="m-0 text-small text-ink-muted">{p.examName}</p>
        <p className="m-0 font-medium text-ink">
          {p.subjectName} · {p.classSection} · Max marks {p.maxMarks}
        </p>
        <div className="mt-2 grid gap-1">
          <div className="h-2 overflow-hidden rounded-full bg-surface-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={p.candidates} aria-valuenow={p.entered} aria-label="Marks entered">
            <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
          </div>
          <p className="m-0 text-small text-ink-muted tabular-nums">
            {p.entered} of {p.candidates} entered
            {p.note ? " · returned by the exam office" : ""}
          </p>
        </div>
      </div>
      <Icon name="chevronRight" className="shrink-0 text-ink-muted" />
    </Link>
  );
}

function TodaySkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true" aria-label="Loading today">
      <div className="grid gap-2">
        <Skeleton width={120} height={18} />
        <Skeleton width={180} height={30} />
        <Skeleton width={220} height={16} />
      </div>
      <Skeleton height={180} className="rounded-lg" />
      <div className="grid gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} height={76} className="rounded-lg" />
        ))}
      </div>
    </div>
  );
}
