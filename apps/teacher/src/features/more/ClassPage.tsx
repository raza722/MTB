import { teacherQueries, type TeacherClassDetail, type TeacherStudentContact } from "@mtb/api";
import { formatDate, formatMobile, formatPercent } from "@mtb/domain";
import { Avatar, Banner, BottomSheet, EmptyState, Icon, Input, KeyValue, Skeleton, StatusBadge, cx, type AttendanceStatus } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { useState, type CSSProperties } from "react";
import { useCtx } from "../../app/session";
import { QueryState } from "../../app/shell/QueryState";
import { Screen } from "../../app/shell/Screen";

const TODAY: Record<string, { status: AttendanceStatus; label: string }> = {
  P: { status: "present", label: "Present" },
  A: { status: "absent", label: "Absent" },
  L: { status: "leave", label: "Leave" },
  LT: { status: "late", label: "Late" },
  H: { status: "holiday", label: "Holiday" },
};

export function ClassPage({ classSection }: { classSection: string }) {
  const ctx = useCtx();
  const q = useQuery(teacherQueries.classDetail(ctx, classSection));
  return (
    <Screen title={classSection} subtitle="Students and parents' contacts" documentTitle={`${classSection} students`} backTo="/more/classes">
      <QueryState
        query={q}
        skeleton={
          <div className="grid gap-2" aria-busy="true" aria-label="Loading the class list">
            <Skeleton height={44} className="rounded-md" />
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} height={60} className="rounded-lg" />
            ))}
          </div>
        }
      >
        {(d) => <ClassList d={d} />}
      </QueryState>
    </Screen>
  );
}

function ClassList({ d }: { d: TeacherClassDetail }) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<TeacherStudentContact | null>(null);
  const classTeacher = d.roles.includes("CLASS_TEACHER");
  const needle = search.trim().toLowerCase();
  const list = d.students.filter((s) => !needle || s.name.toLowerCase().includes(needle) || s.father.toLowerCase().includes(needle) || String(s.rollNo) === needle);
  const low = d.students.filter((s) => s.attendancePercent !== null && s.attendancePercent < 85).length;

  return (
    <div className="grid gap-3">
      <p className="m-0 px-1 text-small text-ink-muted">
        {d.enrolled} students · {classTeacher ? "you are the class teacher" : `you teach ${d.subjects.join(", ")}`} · attendance since <bdi dir="ltr">{formatDate(d.since)}</bdi> ({d.schoolDays} school days)
      </p>
      {low > 0 && (
        <Banner tone="warning" icon="alert">
          {low} {low === 1 ? "student is" : "students are"} below 85% attendance this session.
        </Banner>
      )}
      {!classTeacher && <Banner tone="neutral">Parents' numbers are shown to the class teacher only. Ask the class teacher or the office if you need to call a parent.</Banner>}
      <Input icon="search" size="lg" type="search" placeholder="Search by name, father or roll number" aria-label="Search students" value={search} onChange={(e) => setSearch(e.target.value)} />
      {list.length === 0 ? (
        <div className="mtb-card p-2">
          <EmptyState icon="search" title="No student matches" description="Check the spelling, or search by roll number." />
        </div>
      ) : (
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {list.map((s, i) => (
            <li key={s.grNo} className={i < 14 ? "mtb-slide-in" : undefined} style={i < 14 ? ({ "--i": i } as CSSProperties) : undefined}>
              <button type="button" onClick={() => setOpen(s)} className="mtb-card flex min-h-14 w-full items-center gap-3 px-3 py-2 text-start hover:border-border-strong">
                <span className="w-6 shrink-0 text-end text-small text-ink-muted tabular-nums">{s.rollNo}</span>
                <Avatar name={s.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">{s.name}</span>
                  <span className="block truncate text-small text-ink-muted">Father: {s.father}</span>
                </span>
                {s.attendancePercent !== null && <span className={cx("text-small tabular-nums", s.attendancePercent < 85 ? "font-semibold text-danger-ink" : "text-ink-muted")}>{formatPercent(s.attendancePercent)}</span>}
                <Icon name="chevronRight" size={18} className="shrink-0 text-ink-muted" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <BottomSheet open={open !== null} onClose={() => setOpen(null)} title={open?.name ?? ""} description={open ? `Roll ${open.rollNo} · G.R. ${open.grNo} · ${d.classSection}` : undefined}>
        {open && (
          <div className="grid gap-4">
            <KeyValue
              items={[
                ["Father", open.father],
                ["Parent's mobile", open.guardianMobile ? <bdi dir="ltr" className="tabular-nums">{formatMobile(open.guardianMobile)}</bdi> : "Ask the class teacher or the office"],
                ["Today", open.todayMark ? <StatusBadge status={TODAY[open.todayMark]!.status}>{TODAY[open.todayMark]!.label}</StatusBadge> : "Register not submitted yet"],
                ["This session", open.attendancePercent !== null ? `${formatPercent(open.attendancePercent)} · ${open.absentDays} absent, ${open.lateDays} late` : "No school days yet"],
              ]}
            />
            {open.guardianMobile && (
              <div className="flex gap-2 [&>*]:flex-1">
                <a href={`tel:${open.guardianMobile}`} className="mtb-btn mtb-btn-primary mtb-btn-touch">
                  <Icon name="phone" /> Call
                </a>
                <a href={`sms:${open.guardianMobile}`} className="mtb-btn mtb-btn-secondary mtb-btn-touch">
                  <Icon name="message" /> Text
                </a>
              </div>
            )}
            <p className="m-0 text-small text-ink-muted">Calls and texts go from your own phone. For school SMS to the whole class, ask the office.</p>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
