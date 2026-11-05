import type { HttpHandler } from "msw";
import { accountsHandlers } from "./accounts";
import { admissionsHandlers } from "./admissions";
import { attendanceHandlers } from "./attendance";
import { authHandlers } from "./auth";
import { dashboardHandlers } from "./dashboard";
import { examsHandlers } from "./exams";
import { feesHandlers } from "./fees";
import { metaHandlers } from "./meta";
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
import { setupHandlers } from "./setup";

export const handlers: HttpHandler[] = [
  ...authHandlers,
  ...metaHandlers,
  ...studentsHandlers,
  ...feesHandlers,
  ...dashboardHandlers,
  ...smsHandlers,
  ...examsHandlers,
  ...admissionsHandlers,
  ...accountsHandlers,
  ...attendanceHandlers,
  ...setupHandlers,
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
