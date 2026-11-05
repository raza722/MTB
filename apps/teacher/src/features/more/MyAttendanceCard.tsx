import { ApiError, HR_DAY_LABEL, hrMonthLabel, hrQueries, type HrMyAttendance, type HrMyAttendanceDay } from "@mtb/api";
import { formatDate } from "@mtb/domain";
import { Panel, Segmented, Skeleton } from "@mtb/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { QueryState } from "../../app/shell/QueryState";

const prevMonth = (m: string) => {
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7));
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
};

/** "08:12 AM" */
const clock = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return `${String(h % 12 || 12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

function lineFor(d: HrMyAttendanceDay): string {
  if (d.status === "LATE") return `Late${d.lateMinutes ? ` by ${d.lateMinutes} min` : ""}${d.timeIn ? `, in at ${clock(d.timeIn)}` : ""}`;
  if (d.status === "LEAVE") return d.leaveType ? `On leave (${d.leaveType})` : "On leave";
  if (d.status === "ABSENT") return "Absent";
  if (d.status === "HALF_DAY") return "Half day";
  return d.status ? HR_DAY_LABEL[d.status] : "Not marked yet";
}

function Figures({ a }: { a: HrMyAttendance }) {
  const tiles: Array<[string, number]> = [
    ["Present", a.present + a.halfDay],
    ["Late", a.late],
    ["On leave", a.leave],
    ["Absent", a.absent],
  ];
  // Days worth a look: late, leave, absent and half days, newest first.
  const notable = a.days.filter((d) => d.status === "LATE" || d.status === "LEAVE" || d.status === "ABSENT" || d.status === "HALF_DAY").reverse();
  return (
    <div className="grid gap-3">
      <dl className="m-0 grid grid-cols-4 gap-2">
        {tiles.map(([label, n]) => (
          <div key={label} className="grid gap-0.5 rounded-md bg-surface-sunken p-2 text-center">
            <dt className="text-caption text-ink-muted">{label}</dt>
            <dd className="m-0 text-title-2 tabular-nums text-ink">{n}</dd>
          </div>
        ))}
      </dl>
      <p className="m-0 text-small text-ink-muted">
        {a.workingDays} working {a.workingDays === 1 ? "day" : "days"} so far{a.percent !== null ? ` · ${a.percent}% attendance` : ""}
        {a.lateMinutes ? ` · ${a.lateMinutes} minutes late in all` : ""}. Half days count as present.
      </p>
      {notable.length > 0 && (
        <ul className="m-0 grid list-none gap-1 p-0 text-small" aria-label="Late, leave and absent days">
          {notable.slice(0, 6).map((d) => (
            <li key={d.date} className="flex justify-between gap-3">
              <span className="tabular-nums text-ink">{formatDate(d.date)}</span>
              <span className="text-ink-muted">{lineFor(d)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="m-0 text-small text-ink-muted">From the staff attendance kept by the office. Something wrong? Tell the office the same day.</p>
    </div>
  );
}

/** More › My attendance: the teacher's own staff attendance for the month (legacy Staff › Attendance report). */
export function MyAttendanceCard({ rise = 2 }: { rise?: number }) {
  const thisMonth = useQuery(hrQueries.myAttendance());
  const [which, setWhich] = useState<"this" | "last">("this");
  const current = thisMonth.data?.month;
  const last = useQuery({ ...hrQueries.myAttendance(current ? prevMonth(current) : ""), enabled: which === "last" && Boolean(current) });
  const q = which === "last" ? last : thisMonth;
  const notLinked = thisMonth.error instanceof ApiError && thisMonth.error.code === "NOT_LINKED";
  return (
    <Panel
      id="my-attendance"
      title="My attendance"
      description={current ? `${hrMonthLabel(which === "last" ? prevMonth(current) : current)}${which === "this" ? " so far" : ""}` : "Your own days in and out this month."}
      rise={rise}
      actions={
        current ? (
          <Segmented
            aria-label="Month"
            value={which}
            onChange={(v) => setWhich(v as "this" | "last")}
            options={[
              { value: "this", label: "This month" },
              { value: "last", label: "Last month" },
            ]}
          />
        ) : undefined
      }
    >
      {notLinked ? (
        <p className="m-0 text-small text-ink-muted">Your sign-in isn't linked to a staff record yet, so there is no attendance to show. Ask the office to link it.</p>
      ) : (
        <QueryState query={q} skeleton={<Skeleton height={96} />}>
          {(a) => <Figures a={a} />}
        </QueryState>
      )}
    </Panel>
  );
}
