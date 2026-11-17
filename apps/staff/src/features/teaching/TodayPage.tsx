import { teacherQueries, TEACHER_REGISTER_STATUS_LABEL, type TeacherPaper, type TeacherPeriod, type TeacherToday } from "@mtb/api";
import { formatDate, formatLongDate, formatSession, formatWeekday } from "@mtb/domain";
import { buttonClassName, Icon, Panel, Skeleton, StatusBadge, Urdu, cx } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { useCtx } from "../../app/session";
import { Page, PageHeader } from "../../app/shell/page";
import { RegisterCard } from "./RegisterCard";
import { clock, greeting, periodPhase, pkMinutesNow, QueryState, RegisterStatusBadge, shortName, toMins } from "./shared";

/** /teaching — the teacher's day: today's register, today's classes, marks still to enter and the next closed day. */
export function TodayPage() {
  const ctx = useCtx();
  const q = useQuery(teacherQueries.today(ctx));
  const t = q.data;
  const unread = t?.unread ?? 0;
  return (
    <Page>
      <PageHeader
        title="Today"
        {...(t ? { context: `${formatLongDate(t.date)} · ${t.campusName} · Session ${formatSession(t.session)}` } : {})}
        actions={
          <Link to="/teaching/notifications" className={buttonClassName({ variant: unread ? "primary" : "secondary" })}>
            <Icon name="bell" />
            {unread ? `${unread} unread ${unread === 1 ? "notification" : "notifications"}` : "Notifications"}
          </Link>
        }
      />
      <QueryState query={q} what="Today" skeleton={<TodaySkeleton />}>
        {(data) => <TodayBody t={data} />}
      </QueryState>
    </Page>
  );
}

function TodayBody({ t }: { t: TeacherToday }) {
  // The server builds Today's papers from the Marks page's own list (open papers only), so the two always agree.
  const papers = t.papers;
  const now = pkMinutesNow();
  const nextIndex = t.periods.findIndex((p) => toMins(p.start) > now);
  // Two columns only when both have something in them.
  const hasMain = Boolean(t.closed) || t.registers.length > 0 || papers.length > 0;
  const hasSide = !t.closed || Boolean(t.nextClosed);
  return (
    <div className="grid gap-6">
      <p className="m-0 mtb-rise text-title-2 text-ink">
        {greeting()}, {shortName(t.teacherName)}
      </p>

      <div className={cx("grid items-start gap-6", hasMain && hasSide && "xl:grid-cols-2")}>
        {hasMain && (
          <div className="grid gap-6">
            {t.closed ? (
              <article className="mtb-card mtb-rise grid gap-2 border-status-holiday bg-status-holiday-tint p-5" style={{ "--i": 1 } as CSSProperties} aria-labelledby="holiday-title">
                <div className="flex items-center gap-2">
                  <Icon name="calendar" size={22} className="text-status-holiday-ink" />
                  <StatusBadge status="holiday">Holiday</StatusBadge>
                </div>
                <h2 id="holiday-title" className="m-0 text-title-2 text-ink">
                  No attendance today — {t.closed.name}
                </h2>
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

            {papers.length > 0 && (
              <Panel
                id="marks-to-enter"
                rise={3}
                title="Marks to enter"
                description="Open papers for your classes and subjects"
                actions={
                  <Link to="/teaching/marks" className={buttonClassName({ size: "sm", variant: "ghost" })}>
                    All papers
                  </Link>
                }
              >
                <ul className="m-0 grid list-none gap-2 p-0">
                  {papers.map((p) => (
                    <li key={`${p.examId}-${p.classSection}-${p.subjectId}`}>
                      <PaperLink p={p} />
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>
        )}

        <div className="grid gap-6">
          {!t.closed && (
            <Panel
              id="todays-classes"
              rise={2}
              title={`Today's classes · ${t.periods.length}`}
              description="Your lessons from the timetable"
              actions={
                <Link to="/teaching/timetable" className={buttonClassName({ size: "sm", variant: "ghost" })}>
                  Whole week
                </Link>
              }
            >
              {t.periods.length === 0 ? (
                <p className="m-0 text-ink-muted">No classes on your timetable today.</p>
              ) : (
                <ol className="m-0 grid list-none gap-2 p-0">
                  {t.periods.map((p, i) => (
                    <PeriodRow key={`${p.period}-${p.classSection}`} p={p} i={i} isNext={i === nextIndex} />
                  ))}
                </ol>
              )}
            </Panel>
          )}

          {t.nextClosed && (
            <Panel id="coming-up" rise={4} title="Coming up">
              <div className="flex items-center gap-3">
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
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function PeriodRow({ p, i, isNext }: { p: TeacherPeriod; i: number; isNext: boolean }) {
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
          {p.room ? `${p.room} · ` : ""}until {clock(p.end)}
        </p>
        {p.register && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <RegisterStatusBadge status={p.register.status} />
            <span className="text-small text-ink-muted">{p.register.mine ? "Your register" : `Register by ${p.register.classTeacher || "the class teacher"}`}</span>
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
  const cls = cx("flex items-start gap-3 rounded-lg border border-border p-3", phase === "now" && "border-brand", phase === "done" && "opacity-80");
  return (
    <li className="mtb-slide-in" style={{ "--i": i } as CSSProperties}>
      {p.register?.mine ? (
        <Link
          to="/teaching/registers/$classSection"
          params={{ classSection: p.classSection }}
          className={cx(cls, "text-inherit no-underline hover:border-border-strong hover:bg-surface-hover")}
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

/** An open paper: where its marks stand, one click to carry on. */
export function PaperLink({ p }: { p: TeacherPaper }) {
  const pct = p.candidates ? Math.round((p.entered / p.candidates) * 100) : 0;
  return (
    <Link
      to="/teaching/marks/$examId/$classSection/$subjectId"
      params={{ examId: p.examId, classSection: p.classSection, subjectId: p.subjectId }}
      className="flex items-center gap-3 rounded-lg border border-border p-3 text-inherit no-underline hover:border-border-strong hover:bg-surface-hover"
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
      <Skeleton width={220} height={24} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Skeleton height={180} className="rounded-lg" />
        <Skeleton height={260} className="rounded-lg" />
      </div>
    </div>
  );
}
