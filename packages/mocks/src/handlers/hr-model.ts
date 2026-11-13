// Fictional staff figures for mocks that are not real yet (no routes). Staff and payroll itself is real now
// (module 02): every /api/hr request falls through to the backend. Only the dashboard mock still needs "staff on roll
// and in today" per campus, and reads it from here until the dashboard module reads hr.vw_StaffToday.
import type { CampusCode } from "@mtb/api";
import { DEMO_TODAY } from "../clock";
import { initialStaff } from "../fixtures/hr";

/**
 * Staff with a posting open today at the campus, all counted present (the fictional data has no staff attendance or
 * leave any more: those are real HR data now).
 */
export function hrStaffToday(campus: CampusCode): { total: number; present: number; late: number; onLeave: number; notMarked: number } {
  const total = initialStaff().filter(
    (s) => s.status === "ACTIVE" && s.postings.some((p) => p.campus === campus && p.startDate <= DEMO_TODAY && (p.endDate === null || p.endDate >= DEMO_TODAY)),
  ).length;
  return { total, present: total, late: 0, onLeave: 0, notMarked: 0 };
}
