import type { HttpHandler } from "msw";
import { authTapHandlers } from "./auth-state";
import { dashboardHandlers } from "./dashboard";
import { portalHandlers } from "./portal";
import { teacherHandlers } from "./teacher";
import { reportsHandlers } from "./reports";
import { operationsHandlers } from "./operations";

/**
 * Modules that are real now have no handlers here: their requests fall through (onUnhandledRequest "bypass") to the
 * backend through the Vite proxy. Real so far: sign-in for the staff and teacher apps (/api/auth/*, tapped on the way
 * through so the mocks below know the signed-in user), /api/meta/*, /api/setup/*, Students (/api/students*,
 * /api/search, /api/families*, /api/promotion*, /api/sections*, /api/movements, /api/documents*), Staff and payroll
 * (/api/hr/*), Admissions (/api/admissions/*), Attendance (/api/attendance/*, the teacher app's
 * /api/teacher/registers*), Exams (/api/exams*, /api/exams-*, and the teacher app's /api/teacher/papers*), Fees
 * (/api/fees/*, /api/fee-setup/*), every kind of /api/approvals* (attendance corrections, receipt and charge
 * cancellations), Accounts (/api/accounts/*), Timetable (/api/timetable/*, the teacher app's /api/teacher/timetable) and Activities
 * (/api/activities/*: scholarships, scholarship tests, houses, events, sports, records, certificates and the catalogue)
 * Messages (/api/sms/*: kill switch, templates, compose, outbox, delivery report, opt-outs, settings; /api/notices*),
 * Library (/api/library/*, with the shared people search /api/operations/people that warehouse and transport use),
 * Warehouse (/api/warehouse/*: stock, receipts, issues, returns, counts, the book shop and its sales), Transport
 * (/api/transport/*: vehicles, routes and stops, route sheets, riders with the transport fee in Fees, trips and fuel)
 * and the parent and student portal (/api/portal/*: code sign-in, session, preferences and every child page; only the
 * mock-mode /api/portal/demo hint stays in portal.ts).
 * The fictional student records the unfinished modules still share
 * live in student-records-model.ts, the fictional staff in fixtures/hr.ts with handlers/hr-model.ts, the fictional
 * applicants in fixtures/admissions.ts with handlers/admissions-model.ts, the fictional registers and calendar in
 * fixtures/attendance.ts with handlers/attendance-model.ts, the fictional exams in fixtures/exams.ts with
 * handlers/exams-model.ts, the fictional fee figures the dashboard, reports and SMS mocks still read in
 * fixtures/fee-setup.ts with handlers/fees-state.ts and handlers/fee-setup-model.ts, the fictional books the
 * report centre's accounts reports read in fixtures/accounts.ts with handlers/accounts-model.ts, and the fictional
 * timetable the report centre and the teacher app's Today / Classes read in fixtures/timetable.ts with
 * handlers/timetable-model.ts, the fictional outbox and rosters the report centre reads in fixtures/sms.ts with
 * handlers/sms-model.ts, the fictional library the report centre reads in fixtures/operations.ts with
 * handlers/library-model.ts, the fictional warehouse the report centre reads in fixtures/operations.ts with
 * handlers/warehouse-model.ts, the fictional transport the report centre reads in fixtures/operations.ts with
 * handlers/transport-model.ts, and the fictional portal families the report centre reads in fixtures/portal.ts with
 * handlers/portal-model.ts (no routes).
 */
export const handlers: HttpHandler[] = [
  ...authTapHandlers,
  ...dashboardHandlers,
  ...operationsHandlers,
  ...reportsHandlers,
  ...teacherHandlers,
  ...portalHandlers,
];
