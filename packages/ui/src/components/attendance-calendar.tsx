import { formatDate, formatPercent, formatWeekday, summariseAttendance, toIsoDate, type AttendanceCode, type IsoDate } from "@mtb/domain";
import type { ReactElement } from "react";
import { cx } from "../lib/cx";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const ATTENDANCE_CODE_LABEL: Record<AttendanceCode, string> = { P: "Present", A: "Absent", L: "Leave", LT: "Late", H: "Holiday" };

export interface AttendanceCalendarProps {
  year: number;
  /** 0 = January */
  month: number;
  /** One code per school day that has a mark. */
  days: Partial<Record<IsoDate, AttendanceCode>>;
  /** Holiday names, shown to screen readers: { "2026-11-09": "Iqbal Day" }. */
  holidayNames?: Partial<Record<IsoDate, string>>;
  /** Weekly off days (0 = Sunday). Default: Sunday. */
  offDays?: number[];
  today?: IsoDate;
  /** Hide the legend when a page shows one shared legend. */
  hideLegend?: boolean;
}

/** Month calendar with tinted cells, a letter in every cell (colour is never the only signal), legend and monthly %. */
export function AttendanceCalendar({ year, month, days, holidayNames = {}, offDays = [0], today, hideLegend }: AttendanceCalendarProps) {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leading = (first.getDay() + 6) % 7; // Monday-first grid
  const codes = Object.entries(days)
    .filter(([d]) => d.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`))
    .map(([, c]) => c as AttendanceCode);
  const summary = summariseAttendance(codes);

  const cells = [
    ...Array.from({ length: leading }, (_, i) => <div key={`pad-${i}`} className="mtb-attcal-cell is-pad" aria-hidden="true" />),
    ...Array.from({ length: daysInMonth }, (_, i) => {
      const date = new Date(year, month, i + 1);
      const iso = toIsoDate(date);
      const code = days[iso];
      const off = offDays.includes(date.getDay()) && !code;
      const label = code ? (code === "H" && holidayNames[iso] ? `Holiday — ${holidayNames[iso]}` : ATTENDANCE_CODE_LABEL[code]) : off ? "No school" : "No mark";
      return (
        <div
          key={iso}
          role="gridcell"
          aria-label={`${formatWeekday(iso)} ${formatDate(iso)}: ${label}`}
          className={cx("mtb-attcal-cell", code && `is-${code}`, off && "is-off", iso === today && "is-today")}
        >
          <span className="d">{i + 1}</span>
          <span className="c" aria-hidden="true">
            {code ?? (off ? "—" : "")}
          </span>
        </div>
      );
    }),
  ];

  const rows: ReactElement[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  return (
    <div className="mtb-attcal">
      <div className="mtb-attcal-head">
        <span className="mtb-attcal-title">
          {MONTHS[month]} {year}
        </span>
        <span className="mtb-num" style={{ color: "var(--ink-muted)", fontSize: 13 }}>
          {summary.percent === null ? "No school days yet" : `${formatPercent(summary.percent)} attended · ${summary.present + summary.late} of ${summary.schoolDays} days`}
        </span>
      </div>
      <div role="grid" aria-label={`Attendance, ${MONTHS[month]} ${year}`}>
        <div className="mtb-attcal-grid" role="row">
          {WEEKDAYS.map((w) => (
            <div key={w} className="mtb-attcal-wd" role="columnheader">
              {w}
            </div>
          ))}
        </div>
        {rows.map((row, i) => (
          <div key={i} className="mtb-attcal-grid" role="row" style={{ marginTop: 4 }}>
            {row}
          </div>
        ))}
      </div>
      {!hideLegend && <AttendanceLegend counts={summary} />}
    </div>
  );
}

export function AttendanceLegend({ counts }: { counts?: { present: number; absent: number; leave: number; late: number; holiday: number } }) {
  const items: Array<[AttendanceCode, number | undefined]> = [
    ["P", counts?.present],
    ["A", counts?.absent],
    ["L", counts?.leave],
    ["LT", counts?.late],
    ["H", counts?.holiday],
  ];
  return (
    <ul className="mtb-attcal-legend" aria-label="Legend">
      {items.map(([code, n]) => (
        <li key={code}>
          <span className={cx("mtb-attcal-cell", `is-${code}`, "mtb-attcal-swatch")} aria-hidden="true">
            {code}
          </span>
          {ATTENDANCE_CODE_LABEL[code]}
          {n !== undefined && <span className="mtb-num">({n})</span>}
        </li>
      ))}
    </ul>
  );
}
