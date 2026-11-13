import type { TeacherChangeRequest, TeacherClosedDay, TeacherNotification } from "@mtb/api";

/**
 * Teacher app fixtures (fictional). The teacher app reads rosters, marks, timetables and the school calendar from
 * the other modules' fixtures and stores; this file only holds what the teacher app adds: its notifications, the
 * change requests already waiting when the demo starts, and the demo's holiday.
 */

/** The holiday the demo switch turns today into (brief §7.7: "No attendance today — Quaid-e-Azam Day"). */
export const TEACHER_DEMO_HOLIDAY: TeacherClosedDay = { name: "Quaid-e-Azam Day", nameUr: "یومِ قائدِ اعظم", kind: "HOLIDAY" };

/**
 * Fictional change requests Ms Hina Javed sent on earlier days that are still waiting. Only the teacher app's Today
 * mock reads them (its register cards count pending changes); the real requests and their "att-{n}" ids belong to
 * the backend (Attendance), so these carry "demo-" ids that can never be confused with real ones.
 */
export function seedTeacherChanges(): TeacherChangeRequest[] {
  return [
    {
      id: "demo-2",
      campus: "KC",
      classSection: "7-B",
      date: "2026-11-03",
      grNo: "KC-14988",
      studentName: "Areeba Siddiqui",
      from: "A",
      to: "L",
      reason: "Leave application from her mother received after the register was submitted.",
      status: "PENDING",
      requestedBy: "Ms Hina Javed",
      requestedAt: "2026-11-03T13:02:00+05:00",
    },
    {
      id: "demo-6",
      campus: "KC",
      classSection: "7-B",
      date: "2026-11-02",
      grNo: "KC-14823",
      studentName: "Ayesha Khan",
      from: "LT",
      to: "P",
      reason: "School van was late; all van students arrived together.",
      status: "PENDING",
      requestedBy: "Ms Hina Javed",
      requestedAt: "2026-11-02T09:31:00+05:00",
    },
  ];
}

const n = (id: string, at: string, kind: TeacherNotification["kind"], title: string, body?: string, read = true, link?: string): TeacherNotification => ({
  id,
  at,
  kind,
  title,
  ...(body ? { body } : {}),
  read,
  ...(link ? { link } : {}),
});

/** What a teacher finds in Notifications on the demo morning (newest first). */
export function seedTeacherNotifications(teacherName: string): TeacherNotification[] {
  if (teacherName !== "Ms Hina Javed") {
    return [
      n("tn-g1", "2026-11-04T07:30:00+05:00", "CALENDAR", "Iqbal Day: school closed on Monday 09-Nov-2026", "No registers that day. Classes resume on Tuesday 10-Nov-2026.", false),
      n("tn-g2", "2026-11-02T08:00:00+05:00", "NOTICE", "Annual sports day on Friday 27-Nov-2026", "Registers are taken in the morning before the events start."),
    ];
  }
  return [
    n("tn-1", "2026-11-04T07:30:00+05:00", "CALENDAR", "Iqbal Day: school closed on Monday 09-Nov-2026", "No registers that day. Classes resume on Tuesday 10-Nov-2026.", false),
    n(
      "tn-2",
      "2026-11-03T19:40:00+05:00",
      "MARKS",
      "Monthly Test – October 2026: Mathematics 7-B is not finished",
      "18 of 34 marks entered. The exam office needs every mark before the results can be declared.",
      false,
      "/marks",
    ),
    n("tn-3", "2026-11-03T20:15:00+05:00", "LEAVE", "Leave request sent: 12-Nov-2026 to 13-Nov-2026", "Casual leave. Waiting for Mrs Sadia Rehman to decide.", true, "/more/leave"),
    n("tn-4", "2026-11-03T13:02:00+05:00", "ATTENDANCE", "Change requested: Areeba Siddiqui, 03-Nov-2026", "Absent → Leave. Waiting for the principal's approval.", true, "/registers"),
    n("tn-5", "2026-11-02T09:31:00+05:00", "ATTENDANCE", "Change requested: Ayesha Khan, 02-Nov-2026", "Late → Present. Waiting for the principal's approval.", true, "/registers"),
    n("tn-6", "2026-11-02T08:00:00+05:00", "NOTICE", "Annual sports day on Friday 27-Nov-2026", "Registers are taken in the morning before the events start."),
    n("tn-7", "2026-10-20T15:30:00+05:00", "MARKS", "First Term 2026–27 results declared for Class 7", "Parents can see them in the portal. Your Mathematics marks for 7-B are locked.", true, "/marks"),
  ];
}
