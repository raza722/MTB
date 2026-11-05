import { teacherCountMarks, teacherCountsLine, type TeacherRegisterCard } from "@mtb/api";
import { formatTime } from "@mtb/domain";
import { Icon, SegmentedBar, StatusBadge, cx } from "@mtb/ui";
import { Link } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { useOnline } from "../../app/sync/network";
import { RegisterStatusBadge, useQueuedFor } from "./marks";

/** Today's register for a class the teacher is class teacher of: its state and the one action that moves it on. */
export function RegisterCard({ r, rise }: { r: TeacherRegisterCard; rise?: number }) {
  const online = useOnline();
  const queued = useQueuedFor(r.classSection, r.date);
  const queuedCounts = queued.submit ? teacherCountMarks(Object.values(queued.submit.payload.body.marks)) : null;
  const counts = r.counts ?? queuedCounts;
  const notMarked = r.status === "NOT_MARKED" && !queued.submit;

  if (r.closed && !queued.submit && r.status === "NOT_MARKED") {
    return (
      <article
        className={cx("mtb-card grid gap-2 border-status-holiday bg-status-holiday-tint p-4", rise !== undefined && "mtb-rise")}
        style={rise !== undefined ? ({ "--i": rise } as CSSProperties) : undefined}
        aria-labelledby={`reg-${r.classSection}`}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 id={`reg-${r.classSection}`} className="m-0 text-title-1 text-ink">
            {r.classSection}
          </h3>
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
    <article
      className={cx("mtb-card grid gap-3 p-4", rise !== undefined && "mtb-rise", notMarked && "border-brand")}
      style={rise !== undefined ? ({ "--i": rise } as CSSProperties) : undefined}
      aria-labelledby={`reg-${r.classSection}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`reg-${r.classSection}`} className="m-0 text-title-1 text-ink">
            {r.classSection}
          </h3>
          <p className="m-0 text-small text-ink-muted">Class register · {r.enrolled} students</p>
        </div>
        {queued.submit ? (
          <StatusBadge status="queued" icon="cloudOff" size="lg">
            Saved on this phone
          </StatusBadge>
        ) : (
          <RegisterStatusBadge status={r.status} size="lg" />
        )}
      </div>

      {notMarked ? (
        <p className="m-0 text-ink-muted">Everyone starts as Present. Tap the students who are absent, on leave or late, then submit.</p>
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
              {queued.submit ? (
                online ? (
                  "Sending to the school server…"
                ) : (
                  <>
                    Submitted on this phone at <bdi dir="ltr">{formatTime(new Date(queued.submit.createdAt))}</bdi>. It is sent when the connection is back.
                  </>
                )
              ) : (
                <>
                  Submitted{r.submittedAt && <> at <bdi dir="ltr">{formatTime(r.submittedAt)}</bdi></>}
                  {r.pendingChanges > 0 && ` · ${r.pendingChanges} ${r.pendingChanges === 1 ? "change" : "changes"} waiting for approval`}
                </>
              )}
            </p>
          </div>
        )
      )}

      <Link
        to="/registers/$classSection"
        params={{ classSection: r.classSection }}
        className={cx("mtb-btn mtb-btn-touch mtb-btn-block", notMarked ? "mtb-btn-primary" : "mtb-btn-secondary")}
      >
        <Icon name={notMarked ? "listChecks" : "eye"} />
        {notMarked ? "Take register" : "View register"}
      </Link>
    </article>
  );
}
