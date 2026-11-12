// Parent and student portal: real now (/api/portal/*: module 12, backend/docs/modules/12_portal.md). Sign-in with a
// one-time code, the session, preferences and every child page (home, fees, receipts, voucher, attendance, results,
// notices, profile) fall through to the backend. Only the mock-mode demo hint stays here: the real server has no such
// endpoint (it answers 404), and the portal app no longer shows it.
import type { PortalDemoHint } from "@mtb/api";
import { http, type HttpHandler } from "msw";
import { parentMobile, PORTAL_DEMO_CODE, PORTAL_PARENTS, PORTAL_STUDENTS } from "../fixtures/portal";
import { findStudent, type StudentRecord } from "../fixtures/students";
import { HttpResponse, latency } from "../util";

export const portalHandlers: HttpHandler[] = [
  // Mock mode only: the fictional families and students. The real server has no such endpoint.
  http.get("/api/portal/demo", async () => {
    await latency();
    const hint: PortalDemoHint = {
      code: PORTAL_DEMO_CODE,
      parents: PORTAL_PARENTS.map((p) => ({ name: p.name, mobile: parentMobile(p), children: p.children.map((gr) => findStudent(gr)?.name ?? gr) })),
      students: PORTAL_STUDENTS.map((gr) => findStudent(gr))
        .filter((s): s is StudentRecord => !!s && s.status === "ACTIVE")
        .map((s) => ({ name: s.name, grNo: s.grNo, classSection: s.classSection, campusName: s.campusName })),
    };
    return HttpResponse.json(hint);
  }),
];
