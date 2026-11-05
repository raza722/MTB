import { teacherQueries, type TeacherClass } from "@mtb/api";
import { formatPercent } from "@mtb/domain";
import { EmptyState, Icon, Skeleton, StatusBadge } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { useCtx } from "../../app/session";
import { QueryState } from "../../app/shell/QueryState";
import { Screen } from "../../app/shell/Screen";

export function ClassesPage() {
  const ctx = useCtx();
  const q = useQuery(teacherQueries.classes(ctx));
  return (
    <Screen title="My classes" subtitle="Where you are class teacher or teach a subject" documentTitle="My classes" backTo="/more">
      <QueryState
        query={q}
        skeleton={
          <div className="grid gap-2" aria-busy="true" aria-label="Loading your classes">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={96} className="rounded-lg" />
            ))}
          </div>
        }
      >
        {(list) =>
          list.length === 0 ? (
            <div className="mtb-card p-2">
              <EmptyState icon="students" title="No classes yet" description="Your classes appear once the office puts you on the timetable." />
            </div>
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0">
              {list.map((c, i) => (
                <li key={c.classSection} className="mtb-slide-in" style={{ "--i": i } as CSSProperties}>
                  <ClassLink c={c} />
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
    </Screen>
  );
}

function ClassLink({ c }: { c: TeacherClass }) {
  const pct = c.attendancePercent;
  return (
    <Link to="/more/classes/$classSection" params={{ classSection: c.classSection }} className="mtb-card flex items-center gap-3 p-4 text-inherit no-underline hover:border-border-strong">
      <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-brand-tint text-title-3 text-brand-ink">{c.classSection}</span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          {c.roles.includes("CLASS_TEACHER") && <StatusBadge status="brand">Class teacher</StatusBadge>}
          {c.subjects.length > 0 && <span className="text-small font-medium text-ink">{c.subjects.join(", ")}</span>}
        </span>
        <span className="mt-1 block text-small text-ink-muted">
          {c.enrolled} students{c.periodsPerWeek ? ` · ${c.periodsPerWeek} ${c.periodsPerWeek === 1 ? "period" : "periods"} a week` : ""} · {c.room}
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
