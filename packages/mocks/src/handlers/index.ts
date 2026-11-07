import type { HttpHandler } from "msw";
import { accountsHandlers } from "./accounts";
import { authTapHandlers } from "./auth-state";
import { dashboardHandlers } from "./dashboard";
import { examsHandlers } from "./exams";
import { feesHandlers } from "./fees";
import { smsHandlers } from "./sms";
import { portalHandlers } from "./portal";
import { teacherHandlers } from "./teacher";
import { reportsHandlers } from "./reports";
import { operationsHandlers } from "./operations";
import { feeSetupHandlers } from "./fee-setup";
import { activitiesHandlers } from "./activities";
import { timetableHandlers } from "./timetable";

/**
 * Modules that are real now have no handlers here: their requests fall through (onUnhandledRequest "bypass") to the
 * backend through the Vite proxy. Real so far: sign-in for the staff and teacher apps (/api/auth/*, tapped on the way
 * through so the mocks below know the signed-in user), /api/meta/*, /api/setup/*, Students (/api/students*,
 * /api/search, /api/families*, /api/promotion*, /api/sections*, /api/movements, /api/documents*), Staff and payroll
 * (/api/hr/*), Admissions (/api/admissions/*), and Attendance (/api/attendance/*, the teacher app's
 * /api/teacher/registers*, and the attendance corrections in /api/approvals*: see dashboard.ts). The fictional student
 * records the unfinished modules still share live in student-records-model.ts, the fictional staff in fixtures/hr.ts
 * with handlers/hr-model.ts, the fictional applicants in fixtures/admissions.ts with handlers/admissions-model.ts, and
 * the fictional registers and calendar in fixtures/attendance.ts with handlers/attendance-model.ts (no routes).
 */
export const handlers: HttpHandler[] = [
  ...authTapHandlers,
  ...feesHandlers,
  ...dashboardHandlers,
  ...smsHandlers,
  ...examsHandlers,
  ...accountsHandlers,
  ...timetableHandlers,
  ...activitiesHandlers,
  ...feeSetupHandlers,
  ...operationsHandlers,
  ...reportsHandlers,
  ...teacherHandlers,
  ...portalHandlers,
];
