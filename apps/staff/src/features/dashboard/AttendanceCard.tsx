import type { AttendanceGroup, DashboardSummary } from "@mtb/api";
import { formatCount, formatPercent } from "@mtb/domain";
import { DataTable, DeviationChart, Segmented, Skeleton } from "@mtb/ui";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { campusLabel } from "../../app/shell/campus";
import { useCan, useCtx } from "../../app/session";
import { DashCard } from "./DashCard";
import { stagger } from "./format";

const short = (g: AttendanceGroup) => g.label.replace("Class ", "");

/** Today's attendance by class (or by campus), drawn up or down from the campus figure. */
export function AttendanceCard({ s }: { s: DashboardSummary | undefined }) {
  const [view, setView] = useState("chart");
  const ctx = useCtx();
  const canAttendance = useCan("attendance.view");
  const all = ctx.campus === "ALL";
  const groups = s?.attendanceGroups ?? [];
  const lowest = groups.reduce<AttendanceGroup | undefined>((a, g) => (!a || g.percent < a.percent ? g : a), undefined);

  return (
    <DashCard
      id="attendance-groups"
      title={all ? "Attendance by campus" : "Attendance by class"}
      description={
        s && lowest ? (
          <>
            Today, against {all ? "all campuses" : campusLabel(ctx.campus)} at {formatPercent(s.attendance.percent)}. Lowest: {lowest.label} at {formatPercent(lowest.percent)}.
          </>
        ) : (
          "Today"
        )
      }
      style={stagger(7)}
      actions={
        <>
          <Segmented aria-label="Show attendance as" value={view} onChange={setView} options={[{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }]} />
          {canAttendance && (
            <Link to="/attendance" className="text-small font-medium text-brand-ink underline-offset-2 hover:underline">
              Registers
            </Link>
          )}
        </>
      }
    >
      {!s ? (
        <Skeleton height={240} />
      ) : view === "chart" ? (
        <DeviationChart
          data={groups}
          value={(g) => g.percent}
          axisLabel={short}
          reference={s.attendance.percent}
          referenceLabel={`${all ? "All campuses" : campusLabel(ctx.campus)} today`}
          format={(v) => formatPercent(v)}
          formatAxis={(v) => `${v}%`}
          tooltip={(g) => (
            <>
              <div className="mtb-chart-tip-title">{g.label}</div>
              <div className="mtb-chart-tip-value">{formatPercent(g.percent)}</div>
              <div className="mtb-chart-tip-row">
                <span>Present</span>
                <span>
                  {formatCount(g.attended)} of {formatCount(g.marked)}
                </span>
              </div>
            </>
          )}
          describe={(g) => `${g.label}: ${formatPercent(g.percent)}, ${formatCount(g.attended)} of ${formatCount(g.marked)} present`}
          label={`Attendance today by ${all ? "campus" : "class"}, compared with ${formatPercent(s.attendance.percent)}`}
        />
      ) : (
        <DataTable
          rows={groups}
          rowKey="label"
          density="dense"
          maxHeight={260}
          caption={`Attendance today by ${all ? "campus" : "class"}`}
          columns={[
            { key: "label", header: all ? "Campus" : "Class", render: (g) => <span className="mtb-cell-primary">{g.label}</span> },
            { key: "present", header: "Present", align: "right", render: (g) => formatCount(g.attended) },
            { key: "marked", header: "Marked", align: "right", render: (g) => formatCount(g.marked) },
            { key: "pct", header: "Attendance", align: "right", render: (g) => formatPercent(g.percent) },
          ]}
        />
      )}
    </DashCard>
  );
}
