import type { HttpHandler } from "msw";
import { accountsHandlers } from "./accounts";
import { admissionsHandlers } from "./admissions";
import { attendanceHandlers } from "./attendance";
import { authTapHandlers } from "./auth-state";
import { dashboardHandlers } from "./dashboard";
import { examsHandlers } from "./exams";
import { feesHandlers } from "./fees";
import { smsHandlers } from "./sms";
import { studentsHandlers } from "./students";
import { portalHandlers } from "./portal";
import { teacherHandlers } from "./teacher";
import { reportsHandlers } from "./reports";
import { operationsHandlers } from "./operations";
import { hrHandlers } from "./hr";
import { feeSetupHandlers } from "./fee-setup";
import { activitiesHandlers } from "./activities";
import { timetableHandlers } from "./timetable";
import { studentRecordsHandlers } from "./student-records";

/**
 * Modules that are real now have no handlers here: their requests fall through (onUnhandledRequest "bypass") to the
 * backend through the Vite proxy. Real so far: sign-in for the staff and teacher apps (/api/auth/*, tapped on the way
 * through so the mocks below know the signed-in user), /api/meta/* and /api/setup/*.
 */
export const handlers: HttpHandler[] = [
  ...authTapHandlers,
  ...studentsHandlers,
  ...feesHandlers,
  ...dashboardHandlers,
  ...smsHandlers,
  ...examsHandlers,
  ...admissionsHandlers,
  ...accountsHandlers,
  ...attendanceHandlers,
  ...studentRecordsHandlers,
  ...timetableHandlers,
  ...activitiesHandlers,
  ...feeSetupHandlers,
  ...hrHandlers,
  ...operationsHandlers,
  ...reportsHandlers,
  ...teacherHandlers,
  ...portalHandlers,
];
