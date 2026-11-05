import type { HttpHandler } from "msw";
import { accountsHandlers } from "./accounts";
import { admissionsHandlers } from "./admissions";
import { attendanceHandlers } from "./attendance";
import { authTapHandlers } from "./auth-state";
import { dashboardHandlers } from "./dashboard";
import { examsHandlers } from "./exams";
import { feesHandlers } from "./fees";
import { smsHandlers } from "./sms";
import { portalHandlers } from "./portal";
import { teacherHandlers } from "./teacher";
import { reportsHandlers } from "./reports";
import { operationsHandlers } from "./operations";
import { hrHandlers } from "./hr";
import { feeSetupHandlers } from "./fee-setup";
import { activitiesHandlers } from "./activities";
import { timetableHandlers } from "./timetable";

/**
 * Modules that are real now have no handlers here: their requests fall through (onUnhandledRequest "bypass") to the
 * backend through the Vite proxy. Real so far: sign-in for the staff and teacher apps (/api/auth/*, tapped on the way
 * through so the mocks below know the signed-in user), /api/meta/*, /api/setup/*, and Students (/api/students*,
 * /api/search, /api/families*, /api/promotion*, /api/sections*, /api/movements, /api/documents*). The fictional
 * student records the unfinished modules still share live in student-records-model.ts (no routes).
 */
export const handlers: HttpHandler[] = [
  ...authTapHandlers,
  ...feesHandlers,
  ...dashboardHandlers,
  ...smsHandlers,
  ...examsHandlers,
  ...admissionsHandlers,
  ...accountsHandlers,
  ...attendanceHandlers,
  ...timetableHandlers,
  ...activitiesHandlers,
  ...feeSetupHandlers,
  ...hrHandlers,
  ...operationsHandlers,
  ...reportsHandlers,
  ...teacherHandlers,
  ...portalHandlers,
];
