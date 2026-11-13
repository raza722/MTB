// Trend, activity and calendar data for the dashboard. Everything is deterministic per campus, and anchored to the
// day's figures in dashboard.ts so the charts and the stat cards always agree: the last collection point is
// "fees collected today", November's points add up to "this month", and the last attendance point is today's %.
import type { AttendanceGroup, AttendanceTrendDay, CampusCode, CollectionDay, DashboardActivity, DashboardEvent } from "@mtb/api";
import type { IsoDate } from "@mtb/domain";
import { formatCount, formatRs } from "@mtb/domain";
import { DEMO_TODAY } from "../clock";
import { CAMPUSES, campusName } from "../fixtures/campuses";
import { registersFor, totalsOf } from "../fixtures/attendance";
import { findStudent } from "../fixtures/students";
import { feesStore } from "./fees-state";

/** The figures the trends must agree with (today's, from dashboard.ts). */
export interface DayFigures {
  attendance: { percent: number; deltaPts: number };
  feesToday: { amount: number; receipts: number };
  month: { collected: number; target: number };
  arrears: { students: number };
  sms: { delivered: number; failed: number };
}

// ---------- dates (UTC arithmetic so the machine's time zone never shifts a day) ----------

const toUtc = (d: IsoDate) => new Date(`${d}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: IsoDate, n: number) => {
  const x = toUtc(d);
  x.setUTCDate(x.getUTCDate() + n);
  return iso(x);
};
const weekday = (d: IsoDate) => toUtc(d).getUTCDay(); // 0 = Sunday
const isSchoolDay = (d: IsoDate) => weekday(d) !== 0;

/** School days from `from` to `to`, both included. */
function schoolDays(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isSchoolDay(d)) out.push(d);
  return out;
}

/** Small deterministic generator, seeded per campus and series. */
function seeded(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

const round500 = (n: number) => Math.max(0, Math.round(n / 500) * 500);

// ---------- collections ----------

const WINDOW_START = addDays(DEMO_TODAY, -29); // 06-Oct-2026

/**
 * Daily collections for the last 30 days. Parents pay in the run-up to the 10th (the due date), so October rises to
 * 10-Oct, tails off with late payers, and November climbs again. Saturdays are a shorter counter day.
 */
export function collectionsFor(code: CampusCode, f: DayFigures): CollectionDay[] {
  const rand = seeded(`collections:${code}`);
  const ticket = f.feesToday.receipts > 0 ? f.feesToday.amount / f.feesToday.receipts : 8500;
  const weight = (d: IsoDate) => {
    const day = Number(d.slice(8, 10));
    const w = day <= 10 ? 0.8 + day * 0.32 : Math.max(0.22, 0.62 - (day - 10) * 0.02);
    return w * (weekday(d) === 6 ? 0.7 : 1) * (0.86 + rand() * 0.28);
  };

  // October: about 94% of the monthly target, spread by weight over all of October's school days.
  const october = schoolDays("2026-10-01", "2026-10-31");
  const weights = new Map(october.map((d) => [d, weight(d)]));
  const wsum = [...weights.values()].reduce((a, w) => a + w, 0);
  const octTotal = f.month.target * 0.94;

  // November so far: today is the live figure; the earlier school days share the rest of "this month".
  const novBefore = schoolDays("2026-11-01", addDays(DEMO_TODAY, -1));
  const novRest = Math.max(0, f.month.collected - f.feesToday.amount);
  const novWeights = novBefore.map((_, i) => 0.85 + i * 0.3);
  const novWsum = novWeights.reduce((a, w) => a + w, 0);
  const nov = new Map(novBefore.map((d, i) => [d, round500((novRest * novWeights[i]!) / novWsum)]));
  // The last earlier day takes the rounding remainder, so November adds up to "this month" exactly.
  const lastNov = novBefore.at(-1);
  if (lastNov) nov.set(lastNov, novRest - novBefore.slice(0, -1).reduce((a, d) => a + nov.get(d)!, 0));

  return schoolDays(WINDOW_START, DEMO_TODAY).map((date) => {
    const amount = date === DEMO_TODAY ? f.feesToday.amount : date.startsWith("2026-10") ? round500((octTotal * weights.get(date)!) / wsum) : (nov.get(date) ?? 0);
    const receipts = date === DEMO_TODAY ? f.feesToday.receipts : Math.round(amount / ticket);
    return { date, amount, receipts };
  });
}

// ---------- attendance ----------

/** The last 14 school days; yesterday is today minus the change shown on the card. */
export function attendanceTrendFor(code: CampusCode, f: DayFigures): AttendanceTrendDay[] {
  const rand = seeded(`attendance:${code}`);
  const days = schoolDays(addDays(DEMO_TODAY, -20), DEMO_TODAY).slice(-14);
  const today = f.attendance.percent;
  const yesterday = Math.round((today - f.attendance.deltaPts) * 10) / 10;
  return days.map((date, i) => {
    if (i === days.length - 1) return { date, percent: today };
    if (i === days.length - 2) return { date, percent: yesterday };
    // Mondays run a little lower; Saturdays lower still.
    const dip = weekday(date) === 1 ? 0.9 : weekday(date) === 6 ? 1.6 : 0;
    const p = today - 0.4 - dip + (rand() - 0.5) * 2.4;
    return { date, percent: Math.min(98.5, Math.round(p * 10) / 10) };
  });
}

/** Today's attendance by class for one campus: present + late out of students in submitted registers. */
export function classGroupsFor(code: CampusCode): AttendanceGroup[] {
  const groups = new Map<string, { attended: number; marked: number }>();
  for (const r of registersFor(code)) {
    if (r.status === "NOT_MARKED") continue;
    const cls = r.classSection.split("-")[0]!;
    const g = groups.get(cls) ?? { attended: 0, marked: 0 };
    g.attended += r.present + r.late;
    g.marked += r.enrolled;
    groups.set(cls, g);
  }
  return [...groups.entries()].map(([cls, g]) => ({
    label: cls === "Prep" ? "Prep" : `Class ${cls}`,
    attended: g.attended,
    marked: g.marked,
    percent: Math.round((g.attended / g.marked) * 1000) / 10,
  }));
}

export function enrolledAt(code: CampusCode): number {
  return totalsOf(registersFor(code)).enrolled;
}

/** Students by fee status: overdue matches the arrears card; paid follows how much of the month is collected. */
export function feeStatusFor(code: CampusCode, f: DayFigures) {
  const enrolled = enrolledAt(code);
  const overdue = Math.min(enrolled, f.arrears.students);
  const paid = Math.round((enrolled - overdue) * Math.min(1, f.month.collected / f.month.target));
  return { paid, unpaid: enrolled - overdue - paid, overdue };
}

// ---------- activity and calendar ----------

const PAY_LABEL = { CASH: "Cash", BANK: "Bank deposit", CHEQUE: "Cheque", ONLINE: "Online transfer", SALARY: "Salary deduction", LEGACY: "Old system" } as const;

/** Receipts and cancellation requests from the fees store (including anything posted in this demo), last two days. */
function feesActivity(code: CampusCode): DashboardActivity[] {
  const since = addDays(DEMO_TODAY, -1);
  const out: DashboardActivity[] = [];
  for (const r of Object.values(feesStore.get().receipts)) {
    if (r.campus !== code) continue;
    if (r.postedAt.slice(0, 10) >= since) {
      out.push({
        id: `rc:${r.receiptNo}`,
        kind: "RECEIPT",
        at: r.postedAt,
        campus: code,
        title: `Receipt ${r.receiptNo}`,
        detail: `${r.studentName} · ${r.classSection} · ${PAY_LABEL[r.payment.method]}`,
        by: r.cashier,
        amount: r.total,
        receiptNo: r.receiptNo,
      });
    }
    const cn = r.cancellation;
    if (cn && cn.requestedAt.slice(0, 10) >= since) {
      out.push({
        id: `cn:${cn.cnNo}`,
        kind: "CANCELLATION",
        at: cn.requestedAt,
        campus: code,
        title: cn.status === "PENDING" ? "Cancellation waiting for approval" : cn.status === "APPROVED" ? "Receipt cancelled" : "Cancellation rejected",
        detail: `${r.receiptNo} · ${r.studentName} · ${formatRs(r.total)}`,
        by: cn.requestedBy,
        receiptNo: r.receiptNo,
      });
    }
  }
  return out;
}

function fixedActivity(code: CampusCode, f: DayFigures): DashboardActivity[] {
  const t = (time: string, day = DEMO_TODAY) => `${day}T${time}:00+05:00`;
  const sms: DashboardActivity = {
    id: `sms:${code}`,
    kind: "SMS",
    at: t("08:30"),
    campus: code,
    title: "Morning SMS batch sent",
    detail: `${formatCount(f.sms.delivered)} delivered · ${formatCount(f.sms.failed)} failed`,
    by: "SMS service",
  };
  const totals = totalsOf(registersFor(code));
  const registers: DashboardActivity = {
    id: `att:${code}`,
    kind: "ATTENDANCE",
    at: t("08:40"),
    campus: code,
    title: `${totals.registers - totals.notMarked} of ${totals.registers} registers submitted`,
    detail: `${formatCount(totals.attended)} of ${formatCount(totals.marked)} students present`,
  };
  if (code !== "KC") return [sms, registers];
  const bilal = findStudent("KC-14650");
  return [
    sms,
    registers,
    { id: "att:7b", kind: "ATTENDANCE", at: t("08:05"), campus: code, title: "7-B register submitted", detail: "31 present · 2 absent · 1 on leave · from the teacher app", by: "Ms Hina Javed" },
    { id: "corr:att-1", kind: "CORRECTION", at: t("08:47"), campus: code, title: "Attendance correction requested", detail: `${bilal?.name ?? "Muhammad Bilal"} · 7-B · absent → late`, by: "Ms Hina Javed" },
    { id: "adm:hafsa", kind: "ADMISSION", at: t("11:40", "2026-11-03"), campus: code, title: "Admission application", detail: "Hafsa Yasir · Class 1", by: "Admissions office" },
    { id: "adm:ali", kind: "ADMISSION", at: t("12:25", "2026-11-03"), campus: code, title: "Admission application", detail: "Ali Raza · Class 1", by: "Admissions office" },
  ];
}

export function activityFor(codes: CampusCode[], dayFigures: (c: CampusCode) => DayFigures, limit = 8): DashboardActivity[] {
  const all = codes.flatMap((c) => [...feesActivity(c), ...fixedActivity(c, dayFigures(c))]);
  if (codes.length > 1) for (const a of all) a.title = `${campusName(a.campus).replace(" Campus", "")} · ${a.title}`;
  return all.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

const TESTS: Partial<Record<CampusCode, DashboardEvent[]>> = {
  KC: [
    { id: "kc-t-0711", date: "2026-11-07", kind: "TEST", title: "Entrance tests: Class 3 and Class 6", detail: "2 applicants · Exam hall" },
    { id: "kc-t-0811", date: "2026-11-08", kind: "TEST", title: "Entrance test: Class 1", detail: "3 applicants · Prep block" },
    { id: "kc-t-0911", date: "2026-11-09", kind: "TEST", title: "Entrance test: Class 9", detail: "2 applicants · Exam hall" },
  ],
  HC: [{ id: "hc-t-0711", date: "2026-11-07", kind: "TEST", title: "Entrance test: Class 1", detail: "1 applicant" }],
};

export function upcomingFor(codes: CampusCode[]): DashboardEvent[] {
  const all = codes.length > 1;
  const events: DashboardEvent[] = [
    { id: "fee-due-nov", date: "2026-11-10", kind: "FEE_DUE", title: "November tuition due", detail: all ? "All campuses" : "Reminder SMS goes to parents on 08-Nov" },
    { id: "fine-nov", date: "2026-11-11", kind: "LATE_FINE", title: "Late fine starts", detail: "Rs 10 a day on unpaid November tuition" },
    ...codes.flatMap((c) => (TESTS[c] ?? []).map((e) => (all ? { ...e, id: `${c}:${e.id}`, title: `${campusName(c).replace(" Campus", "")} · ${e.title}` } : e))),
  ];
  return events.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
}

export const ALL_CODES = CAMPUSES.map((c) => c.code);
