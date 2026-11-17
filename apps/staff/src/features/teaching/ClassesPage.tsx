import { photoUrl, teacherQueries, type TeacherClass, type TeacherClassDetail, type TeacherStudentContact } from "@mtb/api";
import { formatDate, formatMobile, formatPercent } from "@mtb/domain";
import { Avatar, Banner, buttonClassName, EmptyState, Icon, Input, KeyValue, Panel, SidePanel, Skeleton, StatusBadge, cx, type AttendanceStatus } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type CSSProperties } from "react";
import { useCan, useCtx } from "../../app/session";
import { Page, PageHeader } from "../../app/shell/page";
import { QueryState } from "./shared";

/** /teaching/classes — where the teacher is class teacher or teaches a subject. */
export function ClassesPage() {
  const ctx = useCtx();
  const q = useQuery(teacherQueries.classes(ctx));
  return (
    <Page>
      <PageHeader title="My classes" />
      <QueryState
        query={q}
        what="Your classes"
        skeleton={
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading your classes">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={110} className="rounded-lg" />
            ))}
          </div>
        }
      >
        {(list) =>
          list.length === 0 ? (
            <div className="mtb-card">
              <EmptyState icon="students" title="No classes yet" description="Your classes appear once the office puts you on the timetable." />
            </div>
          ) : (
            <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 xl:grid-cols-3">
              {list.map((c, i) => (
                <li key={c.classSection} className="mtb-slide-in" style={{ "--i": i } as CSSProperties}>
                  <ClassLink c={c} />
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
    </Page>
  );
}

function ClassLink({ c }: { c: TeacherClass }) {
  const pct = c.attendancePercent;
  return (
    <Link
      to="/teaching/classes/$classSection"
      params={{ classSection: c.classSection }}
      className="mtb-card flex h-full items-center gap-3 p-4 text-inherit no-underline hover:border-border-strong"
    >
      <span className="grid h-12 min-w-12 shrink-0 place-items-center whitespace-nowrap rounded-lg bg-brand-tint px-3 text-title-3 text-brand-ink">{c.classSection}</span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          {c.roles.includes("CLASS_TEACHER") && <StatusBadge status="brand">Class teacher</StatusBadge>}
          {c.subjects.length > 0 && <span className="text-small font-medium text-ink">{c.subjects.join(", ")}</span>}
        </span>
        <span className="mt-1 block text-small text-ink-muted">
          {c.enrolled} students{c.periodsPerWeek ? ` · ${c.periodsPerWeek} ${c.periodsPerWeek === 1 ? "period" : "periods"} a week` : ""}
          {c.room ? ` · ${c.room}` : ""}
        </span>
        {pct !== null && (
          <span className="mt-2 flex items-center gap-2">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken" aria-hidden="true">
              <span className="block h-full rounded-full bg-status-present" style={{ width: `${pct}%` }} />
            </span>
            <span className="text-small text-ink-muted tabular-nums">{formatPercent(pct)} attendance</span>
          </span>
        )}
      </span>
      <Icon name="chevronRight" className="shrink-0 text-ink-muted" />
    </Link>
  );
}

const TODAY: Record<string, { status: AttendanceStatus; label: string }> = {
  P: { status: "present", label: "Present" },
  A: { status: "absent", label: "Absent" },
  L: { status: "leave", label: "Leave" },
  LT: { status: "late", label: "Late" },
  H: { status: "holiday", label: "Holiday" },
};

/** /teaching/classes/7-B — the class list with attendance, and parents' contacts for the class teacher. */
export function ClassPage({ classSection }: { classSection: string }) {
  const ctx = useCtx();
  const q = useQuery(teacherQueries.classDetail(ctx, classSection));
  return (
    <Page>
      <PageHeader
        title={classSection}
        context="Students and parents' contacts"
        actions={
          <Link to="/teaching/classes" className={buttonClassName({ variant: "ghost" })}>
            <Icon name="arrowLeft" />
            My classes
          </Link>
        }
      />
      <QueryState
        query={q}
        what="The class list"
        skeleton={
          <div className="grid gap-2" aria-busy="true" aria-label="Loading the class list">
            <Skeleton height={44} className="rounded-md" />
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} height={56} className="rounded-lg" />
            ))}
          </div>
        }
      >
        {(d) => <ClassList d={d} />}
      </QueryState>
    </Page>
  );
}

function ClassList({ d }: { d: TeacherClassDetail }) {
  // Student photos are served to those who can open student records; everyone else sees initials (no refused requests).
  const showPhotos = useCan("students.view");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<TeacherStudentContact | null>(null);
  const classTeacher = d.roles.includes("CLASS_TEACHER");
  const needle = search.trim().toLowerCase();
  const list = d.students.filter((s) => !needle || s.name.toLowerCase().includes(needle) || s.father.toLowerCase().includes(needle) || String(s.rollNo) === needle);
  const low = d.students.filter((s) => s.attendancePercent !== null && s.attendancePercent < 85).length;

  return (
    <>
      {low > 0 && (
        <Banner tone="warning" icon="alert">
          {low} {low === 1 ? "student is" : "students are"} below 85% attendance this session.
        </Banner>
      )}
      {!classTeacher && <Banner tone="neutral">Parents' numbers are shown to the class teacher only. Ask the class teacher or the office if you need to call a parent.</Banner>}
      <Panel
        id="class-students"
        title={`${d.enrolled} students`}
        description={
          <>
            {classTeacher ? "You are the class teacher" : `You teach ${d.subjects.join(", ")}`} · attendance since <bdi dir="ltr">{formatDate(d.since)}</bdi> ({d.schoolDays} school days)
          </>
        }
        flush
      >
        <div className="border-b border-border px-5 pb-4">
          <Input icon="search" type="search" placeholder="Search by name, father or roll number" aria-label="Search students" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {list.length === 0 ? (
          <EmptyState icon="search" title="No student matches" description="Check the spelling, or search by roll number." />
        ) : (
          <ul className="m-0 grid list-none p-0">
            {list.map((s, i) => (
              <li key={s.grNo} className={cx("border-t border-border first:border-t-0", i < 14 && "mtb-slide-in")} style={i < 14 ? ({ "--i": i } as CSSProperties) : undefined}>
                <button type="button" onClick={() => setOpen(s)} className="flex min-h-14 w-full items-center gap-3 px-5 py-2 text-start hover:bg-surface-hover">
                  <span className="w-6 shrink-0 text-end text-small text-ink-muted tabular-nums">{s.rollNo}</span>
                  <Avatar {...(showPhotos ? { src: photoUrl.student(s.grNo) } : {})} name={s.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{s.name}</span>
                    <span className="block truncate text-small text-ink-muted">Father: {s.father}</span>
                  </span>
                  {s.attendancePercent !== null && (
                    <span className={cx("w-16 text-end text-small tabular-nums", s.attendancePercent < 85 ? "font-semibold text-danger-ink" : "text-ink-muted")}>{formatPercent(s.attendancePercent)}</span>
                  )}
                  <Icon name="chevronRight" size={18} className="shrink-0 text-ink-muted" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <SidePanel open={open !== null} onClose={() => setOpen(null)} title={open?.name ?? ""} description={open ? `Roll ${open.rollNo} · G.R. ${open.grNo} · ${d.classSection}` : ""}>
        {open && (
          <div className="grid gap-4">
            <KeyValue
              items={[
                ["Father", open.father],
                ["Parent's mobile", open.guardianMobile ? <bdi dir="ltr" className="tabular-nums">{formatMobile(open.guardianMobile)}</bdi> : "Ask the class teacher or the office"],
                ["Today", open.todayMark && TODAY[open.todayMark] ? <StatusBadge status={TODAY[open.todayMark]!.status}>{TODAY[open.todayMark]!.label}</StatusBadge> : "Register not submitted yet"],
                ["This session", open.attendancePercent !== null ? `${formatPercent(open.attendancePercent)} · ${open.absentDays} absent, ${open.lateDays} late` : "No school days yet"],
              ]}
            />
            {open.guardianMobile && (
              <div className="flex gap-2 [&>*]:flex-1">
                <a href={`tel:${open.guardianMobile}`} className={buttonClassName({ variant: "primary" })}>
                  <Icon name="phone" /> Call
                </a>
                <a href={`sms:${open.guardianMobile}`} className={buttonClassName({ variant: "secondary" })}>
                  <Icon name="message" /> Text
                </a>
              </div>
            )}
            <p className="m-0 text-small text-ink-muted">Calls and texts go from your own phone. For school SMS to the whole class, ask the office.</p>
          </div>
        )}
      </SidePanel>
    </>
  );
}
