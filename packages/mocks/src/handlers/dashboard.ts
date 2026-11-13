import type { CampusCode, DashboardSummary } from "@mtb/api";
import { http } from "msw";
import { DEMO_TODAY } from "../clock";
import { totalsOf } from "../fixtures/attendance";
import { CAMPUSES } from "../fixtures/campuses";
import { ctxFrom, HttpResponse, latency, requirePermission } from "../util";
import { attendanceDayFor } from "./attendance-model";
import { activityFor, ALL_CODES, attendanceTrendFor, classGroupsFor, collectionsFor, feeStatusFor, upcomingFor } from "./dashboard-data";
import { feesStore } from "./fees-state";
import { hrStaffToday } from "./hr-model";

/** Staff on roll and in today, from Staff & payroll attendance (one campus, or every campus added up). */
function staffToday(codes: CampusCode[]): NonNullable<DashboardSummary["staff"]> {
  const days = codes.map(hrStaffToday);
  const sum = (k: keyof (typeof days)[number]) => days.reduce((a, d) => a + d[k], 0);
  return { total: sum("total"), present: sum("present"), late: sum("late"), onLeave: sum("onLeave"), notMarked: sum("notMarked") };
}

type Base = Pick<DashboardSummary, "attendance" | "feesToday" | "month" | "arrears" | "admissions" | "sms">;

/** Today's figures per campus before anything is posted in the demo (Khalid Campus figures from the brief). */
const BASE: Record<CampusCode, Base> = {
  KC: { attendance: { percent: 92.4, present: 1286, total: 1392, deltaPts: 1.2 }, feesToday: { amount: 486500, receipts: 57 }, month: { collected: 2140000, target: 6800000 }, arrears: { amount: 3925750, students: 412 }, admissions: { session: 186, week: 12 }, sms: { delivered: 1240, failed: 18, queued: 0 } },
  SM: { attendance: { percent: 90.1, present: 612, total: 679, deltaPts: -0.6 }, feesToday: { amount: 214000, receipts: 24 }, month: { collected: 1020000, target: 3200000 }, arrears: { amount: 1480500, students: 171 }, admissions: { session: 74, week: 5 }, sms: { delivered: 540, failed: 6, queued: 0 } },
  UC: { attendance: { percent: 94.1, present: 744, total: 791, deltaPts: 0.4 }, feesToday: { amount: 268500, receipts: 31 }, month: { collected: 1310000, target: 3900000 }, arrears: { amount: 1102250, students: 133 }, admissions: { session: 92, week: 7 }, sms: { delivered: 690, failed: 4, queued: 0 } },
  MC: { attendance: { percent: 88.7, present: 402, total: 453, deltaPts: -1.9 }, feesToday: { amount: 121000, receipts: 15 }, month: { collected: 610000, target: 2100000 }, arrears: { amount: 935000, students: 118 }, admissions: { session: 41, week: 2 }, sms: { delivered: 380, failed: 9, queued: 0 } },
  HC: { attendance: { percent: 93.2, present: 1018, total: 1092, deltaPts: 0.8 }, feesToday: { amount: 402000, receipts: 44 }, month: { collected: 1880000, target: 5600000 }, arrears: { amount: 2710400, students: 289 }, admissions: { session: 151, week: 11 }, sms: { delivered: 1010, failed: 12, queued: 0 } },
};

/**
 * Today's attendance as the Attendance module's registers have it (office marking, approved changes), so the
 * dashboard and Attendance always show the same figures. Before anything changes this equals BASE.
 */
function liveAttendance(code: CampusCode, b: Base["attendance"]): Base["attendance"] {
  const t = totalsOf(attendanceDayFor(code, DEMO_TODAY).rows);
  if (t.marked === 0) return b;
  const yesterday = b.percent - b.deltaPts;
  return { percent: t.percent, present: t.attended, total: t.marked, deltaPts: Math.round((t.percent - yesterday) * 10) / 10 };
}

function campusFigures(code: CampusCode): Base {
  const b = BASE[code];
  const posted = feesStore.get().postedToday[code] ?? { amount: 0, receipts: 0 };
  return {
    ...b,
    attendance: liveAttendance(code, b.attendance),
    feesToday: { amount: b.feesToday.amount + posted.amount, receipts: b.feesToday.receipts + posted.receipts },
    month: { ...b.month, collected: b.month.collected + posted.amount },
  };
}

export const dashboardHandlers = [
  http.get("/api/dashboard", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("dashboard.view", ctx.campus);
    if (user instanceof Response) return user;
    if (ctx.campus !== "ALL") {
      const f = campusFigures(ctx.campus);
      const summary: DashboardSummary = {
        ...f,
        collectionsTrend: collectionsFor(ctx.campus, f),
        attendanceTrend: attendanceTrendFor(ctx.campus, f),
        feeStatus: feeStatusFor(ctx.campus, f),
        attendanceGroups: classGroupsFor(ctx.campus),
        activity: activityFor([ctx.campus], campusFigures),
        upcoming: upcomingFor([ctx.campus]),
        staff: staffToday([ctx.campus]),
      };
      return HttpResponse.json(summary);
    }
    const rows = CAMPUSES.map((c) => ({ c, f: campusFigures(c.code) }));
    const sum = (pick: (f: Base) => number) => rows.reduce((a, r) => a + pick(r.f), 0);
    const present = sum((f) => f.attendance.present);
    const total = sum((f) => f.attendance.total);

    // Trends add up campus by campus; attendance is weighted by students marked.
    const collections = rows.map(({ c, f }) => collectionsFor(c.code, f));
    const collectionsTrend = collections[0]!.map((d, i) => ({ date: d.date, amount: collections.reduce((a, s) => a + s[i]!.amount, 0), receipts: collections.reduce((a, s) => a + s[i]!.receipts, 0) }));
    const attendance = rows.map(({ c, f }) => ({ trend: attendanceTrendFor(c.code, f), weight: f.attendance.total }));
    const attendanceTrend = attendance[0]!.trend.map((d, i) => ({
      date: d.date,
      percent: Math.round((attendance.reduce((a, s) => a + s.trend[i]!.percent * s.weight, 0) / total) * 10) / 10,
    }));
    const percent = Math.round((present / total) * 1000) / 10;
    const yesterday = attendanceTrend.at(-2)?.percent ?? percent;
    attendanceTrend[attendanceTrend.length - 1] = { date: attendanceTrend.at(-1)!.date, percent };
    const status = rows.map(({ c, f }) => feeStatusFor(c.code, f));

    const summary: DashboardSummary = {
      attendance: { percent, present, total, deltaPts: Math.round((percent - yesterday) * 10) / 10 },
      feesToday: { amount: sum((f) => f.feesToday.amount), receipts: sum((f) => f.feesToday.receipts) },
      month: { collected: sum((f) => f.month.collected), target: sum((f) => f.month.target) },
      arrears: { amount: sum((f) => f.arrears.amount), students: sum((f) => f.arrears.students) },
      admissions: { session: sum((f) => f.admissions.session), week: sum((f) => f.admissions.week) },
      sms: { delivered: sum((f) => f.sms.delivered), failed: sum((f) => f.sms.failed), queued: sum((f) => f.sms.queued) },
      collectionsTrend,
      attendanceTrend,
      feeStatus: { paid: status.reduce((a, s) => a + s.paid, 0), unpaid: status.reduce((a, s) => a + s.unpaid, 0), overdue: status.reduce((a, s) => a + s.overdue, 0) },
      attendanceGroups: rows.map(({ c, f }) => ({ label: c.name.replace(" Campus", ""), attended: f.attendance.present, marked: f.attendance.total, percent: f.attendance.percent })),
      activity: activityFor(ALL_CODES, campusFigures),
      upcoming: upcomingFor(ALL_CODES),
      staff: staffToday(CAMPUSES.map((c) => c.code)),
      campuses: rows.map(({ c, f }) => ({ campus: c.code, name: c.name, attendancePercent: f.attendance.percent, collected: f.month.collected, target: f.month.target, arrears: f.arrears.amount })),
    };
    return HttpResponse.json(summary);
  }),
];
