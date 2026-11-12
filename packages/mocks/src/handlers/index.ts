import type { HttpHandler } from "msw";
import { authTapHandlers } from "./auth-state";
import { dashboardHandlers } from "./dashboard";
import { portalHandlers } from "./portal";
import { teacherHandlers } from "./teacher";
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
 * the parent and student portal (/api/portal/*: code sign-in, session, preferences and every child page; only the
 * mock-mode /api/portal/demo hint stays in portal.ts) and the report centre with the staff bell (/api/reports/*:
 * catalogue, favourites, run, jobs, schedules, recipients; /api/notifications*). Reports of modules not built yet
 * (13b / 13c) are listed in the catalogue and answer "This report is not available yet." from the backend.
 * Model files without routes that the remaining mocks (dashboard, teacher app, portal hint) still read: the
 * fictional staff in fixtures/hr.ts with handlers/hr-model.ts, the fictional registers and calendar in
 * fixtures/attendance.ts with handlers/attendance-model.ts, the fictional exams in fixtures/exams.ts with
 * handlers/exams-model.ts (and the rosters of handlers/sms-model.ts it uses), the fictional fee figures of the
 * dashboard and SMS mocks in handlers/fees-state.ts, and the fictional timetable of the teacher app's Today /
 * Classes in fixtures/timetable.ts with handlers/timetable-model.ts.
 * Since the report centre became real (module 13a) nothing imports handlers/accounts-model.ts,
 * admissions-model.ts, fee-setup-model.ts, library-model.ts, portal-model.ts, student-records-model.ts,
 * transport-model.ts or warehouse-model.ts any more (their last importer was the deleted handlers/reports.ts):
 * they are dead code, kept only until the lead deletes them.
 */
export const handlers: HttpHandler[] = [
  ...authTapHandlers,
  ...dashboardHandlers,
  ...operationsHandlers,
  ...teacherHandlers,
  ...portalHandlers,
];
