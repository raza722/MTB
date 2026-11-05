/** Attendance codes shown everywhere: Present, Absent, Leave, Late, Holiday. */
export type AttendanceCode = "P" | "A" | "L" | "LT" | "H";

export interface AttendanceSummary {
  present: number;
  absent: number;
  leave: number;
  late: number;
  holiday: number;
  /** Days attendance was taken (holidays excluded). */
  schoolDays: number;
  /** Present + Late as a share of school days, one decimal. null when there were no school days. */
  percent: number | null;
}

/**
 * Rule used for the monthly %: Present and Late count as attended; Absent and Leave do not;
 * holidays are not school days. (Assumption to confirm with the principal — the legacy system has no stored rule.)
 */
export function summariseAttendance(codes: Iterable<AttendanceCode>): AttendanceSummary {
  const s = { present: 0, absent: 0, leave: 0, late: 0, holiday: 0 };
  for (const code of codes) {
    if (code === "P") s.present++;
    else if (code === "A") s.absent++;
    else if (code === "L") s.leave++;
    else if (code === "LT") s.late++;
    else s.holiday++;
  }
  const schoolDays = s.present + s.absent + s.leave + s.late;
  const percent = schoolDays === 0 ? null : Math.round(((s.present + s.late) / schoolDays) * 1000) / 10;
  return { ...s, schoolDays, percent };
}
