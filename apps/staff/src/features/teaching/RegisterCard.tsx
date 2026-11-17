import { teacherCountsLine, type TeacherRegisterCard } from "@mtb/api";
import { formatTime } from "@mtb/domain";
import { buttonClassName, Icon, SegmentedBar, StatusBadge, cx } from "@mtb/ui";
import { Link } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { RegisterStatusBadge } from "./shared";

/** Today's register for a class the teacher teaches: its state and the one action that moves it on. */
export function RegisterCard({ r, rise }: { r: TeacherRegisterCard; rise?: number }) {
  const counts = r.counts;
  const notMarked = r.status === "NOT_MARKED";
  const style = rise !== undefined ? ({ "--i": rise } as CSSProperties) : undefined;

  if (r.closed && notMarked) {
    return (
      <article className={cx("mtb-card grid gap-2 border-status-holiday bg-status-holiday-tint p-5", rise !== undefined && "mtb-rise")} style={style} aria-labelledby={`reg-${r.classSection}`}>
        <div className="flex items-start justify-between gap-3">
          <h2 id={`reg-${r.classSection}`} className="m-0 text-title-1 text-ink">
            {r.classSection}
          </h2>
          <StatusBadge status="holiday" size="lg">
            Holiday
          </StatusBadge>
        </div>
        <p className="m-0 text-title-3 text-ink">No attendance today — {r.closed.name}</p>
        <p className="m-0 text-small text-ink-muted">The register is closed for the day. Nothing needs marking.</p>
      </article>
    );
  }

  return (
    <article className={cx("mtb-card grid gap-3 p-5", rise !== undefined && "mtb-rise", notMarked && "border-brand")} style={style} aria-labelledby={`reg-${r.classSection}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`reg-${r.classSection}`} className="m-0 text-title-1 text-ink">
            {r.classSection}
          </h2>
          <p className="m-0 text-small text-ink-muted">Class register · {r.enrolled} students</p>
        </div>
        <RegisterStatusBadge status={r.status} size="lg" />
      </div>

      {notMarked ? (
        <p className="m-0 text-ink-muted">Everyone starts as Present. Mark the students who are absent, on leave or late, then submit.</p>
      ) : (
        counts && (
          <div className="grid gap-2">
            <p className="m-0 text-title-2 tabular-nums text-ink">{teacherCountsLine(counts)}</p>
            <SegmentedBar
              label={`${r.classSection} today`}
              height={10}
              segments={[
                { key: "P", label: "Present", value: counts.present, color: "var(--status-present)" },
                { key: "LT", label: "Late", value: counts.late, color: "var(--status-late)" },
                { key: "L", label: "Leave", value: counts.leave, color: "var(--status-leave)" },
                { key: "A", label: "Absent", value: counts.absent, color: "var(--status-absent)" },
              ]}
            />
            <p className="m-0 text-small text-ink-muted">
              Submitted{r.submittedAt && <> at <bdi dir="ltr">{formatTime(r.submittedAt)}</bdi></>}
              {r.pendingChanges > 0 && ` · ${r.pendingChanges} ${r.pendingChanges === 1 ? "change" : "changes"} waiting for approval`}
            </p>
          </div>
        )
      )}

      <div>
        <Link to="/teaching/registers/$classSection" params={{ classSection: r.classSection }} className={buttonClassName({ variant: notMarked ? "primary" : "secondary" })}>
          <Icon name={notMarked ? "listChecks" : "eye"} />
          {notMarked ? "Take register" : "View register"}
        </Link>
      </div>
    </article>
  );
}
