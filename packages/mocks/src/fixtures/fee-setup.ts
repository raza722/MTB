// Fictional fee-office data: the head catalogue, each campus's structure and due dates, concession types,
// late-fine rules, and the generator behind the collection reports. The day totals use the same seeded
// generator as the dashboard (handlers/dashboard-data.ts), so the reports and the dashboard always agree.
import type { CampusCode, FeeConcessionTypeInfo, FeeHead, FeeInstallment, FeeInstallmentPlan } from "@mtb/api";
import type { IsoDate } from "@mtb/domain";
import { DEMO_TODAY } from "../clock";
import { tuitionFor } from "./campuses";

/* ================================================================== Dates */

const toUtc = (d: IsoDate) => new Date(`${d}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (d: IsoDate, n: number): IsoDate => {
  const x = toUtc(d);
  x.setUTCDate(x.getUTCDate() + n);
  return iso(x);
};
export const weekday = (d: IsoDate) => toUtc(d).getUTCDay(); // 0 = Sunday
export const isSchoolDay = (d: IsoDate) => weekday(d) !== 0;

export function schoolDays(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isSchoolDay(d)) out.push(d);
  return out;
}

/** "2026-12" → the last day of that month. */
export function monthEnd(month: string): IsoDate {
  const [y, m] = month.split("-").map(Number);
  return iso(new Date(Date.UTC(y ?? 2026, m ?? 1, 0)));
}

/** "2026-11" → "2026-12" */
export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y ?? 2026, m ?? 1, 1));
  return d.toISOString().slice(0, 7);
}

/** Months of a session: Apr of the start year to Mar of the next. */
export function sessionMonths(session: number): string[] {
  const out: string[] = [];
  let m = `${session}-04`;
  for (let i = 0; i < 12; i++) {
    out.push(m);
    m = nextMonth(m);
  }
  return out;
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthShort = (month: string) => `${MONTH_SHORT[Number(month.slice(5, 7)) - 1] ?? ""} ${month.slice(0, 4)}`;

/* ================================================================== Seeded numbers */

/** Same generator as the dashboard's (FNV seed + murmur finaliser). */
export function seeded(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

export const round500 = (n: number) => Math.max(0, Math.round(n / 500) * 500);
export const roundTo = (n: number, step: number) => Math.round(n / step) * step;

/* ================================================================== Fee heads */

export const FEE_HEADS: FeeHead[] = [
  { code: "TUITION", title: "Tuition fee", titleUr: "ٹیوشن فیس", shortTitle: "Tuition", category: "FEE", billing: "MONTHLY", concessionEligible: true, lateFine: true, order: 1, active: true, system: true, note: "Charged every month, due on the 10th." },
  { code: "ANNUAL", title: "Annual charges", titleUr: "سالانہ چارجز", shortTitle: "Annual", category: "FEE", billing: "ANNUAL", concessionEligible: true, lateFine: true, order: 2, active: true, system: true, note: "Books, lab and sports for the year, due in September." },
  { code: "EXAM", title: "Exam fee", titleUr: "امتحانی فیس", shortTitle: "Exam", category: "FEE", billing: "TERMLY", concessionEligible: false, lateFine: true, order: 3, active: true, system: true, note: "Paper and result card for each term's exams." },
  { code: "BOARD", title: "Board registration fee", titleUr: "بورڈ رجسٹریشن فیس", shortTitle: "Board", category: "FEE", billing: "ANNUAL", concessionEligible: false, lateFine: false, classes: ["9", "10"], order: 4, active: true, system: true, note: "Paid on to the board for Class 9 and 10 students." },
  { code: "ADMISSION", title: "Admission fee", titleUr: "داخلہ فیس", shortTitle: "Admission", category: "FEE", billing: "ON_ADMISSION", concessionEligible: false, lateFine: false, order: 5, active: true, system: true, note: "Charged once, when a student is admitted." },
  { code: "TRANSPORT", title: "Transport fee", titleUr: "ٹرانسپورٹ فیس", shortTitle: "Transport", category: "FEE", billing: "MONTHLY", concessionEligible: false, lateFine: true, linked: "TRANSPORT", order: 6, active: true, system: true, note: "Set per route in Transport; charged to students who use a van." },
  { code: "CANDIDATE", title: "Candidate (test) fee", titleUr: "ٹیسٹ فیس", shortTitle: "Test fee", category: "APPLICATION", billing: "ON_APPLICATION", concessionEligible: false, lateFine: false, order: 7, active: true, system: true, note: "Paid with the admission application, before the entrance test." },
  { code: "LATE_FINE", title: "Late payment fine", titleUr: "تاخیری جرمانہ", shortTitle: "Late fine", category: "FINE", billing: "WHEN_RAISED", concessionEligible: false, lateFine: false, order: 8, active: true, system: true, note: "Worked out at the counter from the campus's fine rule." },
  { code: "FINE_EXAM", title: "Exam absence fine", titleUr: "امتحان سے غیر حاضری جرمانہ", shortTitle: "Exam fine", category: "FINE", billing: "WHEN_RAISED", concessionEligible: false, lateFine: false, order: 9, active: true, system: true, note: "Raised when a student misses a paper without leave." },
  { code: "FINE_OTHER", title: "Discipline fines", titleUr: "تادیبی جرمانہ", shortTitle: "Fines", category: "FINE", billing: "WHEN_RAISED", concessionEligible: false, lateFine: false, order: 10, active: true, system: true, note: "Breakage, mobile phone, lost ID card." },
  // Heads the office added over the years (legacy Fee Type list), fictional amounts.
  { code: "PROSPECTUS", title: "Prospectus", titleUr: "پراسپیکٹس", shortTitle: "Prospectus", category: "APPLICATION", billing: "ON_APPLICATION", concessionEligible: false, lateFine: false, order: 11, active: true, note: "Sold with the admission form." },
  { code: "FORM", title: "Admission form fee", titleUr: "داخلہ فارم فیس", shortTitle: "Form fee", category: "APPLICATION", billing: "ON_APPLICATION", concessionEligible: false, lateFine: false, order: 12, active: true, note: "Paid when the admission form is handed in, with the certificates." },
  { code: "PRE_NINTH", title: "Pre-9th fee", titleUr: "پری نہم فیس", shortTitle: "Pre-9th", category: "FEE", billing: "ANNUAL", concessionEligible: false, lateFine: true, classes: ["9"], order: 13, active: true, note: "Preparation classes before Class 9 starts, charged once." },
  { code: "GYM", title: "Gym fee", titleUr: "جم فیس", shortTitle: "Gym", category: "FEE", billing: "MONTHLY", concessionEligible: false, lateFine: false, classes: ["6", "7", "8", "9", "10"], order: 14, active: true, note: "Only for students who join the gym; add it to a class when the gym opens." },
  { code: "READMISSION", title: "Re-admission fee", titleUr: "دوبارہ داخلہ فیس", shortTitle: "Re-adm.", category: "FEE", billing: "WHEN_RAISED", concessionEligible: false, lateFine: false, order: 15, active: true, note: "Charged when a struck-off student is taken back." },
  { code: "SUBJECT_CHANGE", title: "Subject change fee", titleUr: "مضمون تبدیلی فیس", shortTitle: "Subj. change", category: "FEE", billing: "WHEN_RAISED", concessionEligible: false, lateFine: false, order: 16, active: true, note: "Charged when a student changes subject group after the first month." },
  { code: "UNI_EXAM", title: "University exam fee (per semester)", titleUr: "یونیورسٹی امتحانی فیس", shortTitle: "Uni exam", category: "FEE", billing: "WHEN_RAISED", concessionEligible: false, lateFine: false, order: 17, active: true, note: "Paid on to the university for college students, each semester." },
  { code: "CERTIFICATE", title: "Certificate fee", titleUr: "سرٹیفکیٹ فیس", shortTitle: "Certificate", category: "FEE", billing: "WHEN_RAISED", concessionEligible: false, lateFine: false, order: 18, active: true, note: "Duplicate result card, character or leaving certificate." },
];

/** Heads with an amount per class in the structure grid when the demo starts (more can be added per class). */
export const STRUCTURE_HEADS = ["TUITION", "ANNUAL", "EXAM", "BOARD", "ADMISSION", "CANDIDATE", "PRE_NINTH"] as const;

/** Income account a new head posts to until the accountant changes it (Accounts → Fee posting). */
export function defaultIncomeAccount(head: Pick<FeeHead, "category" | "billing" | "title">): string {
  if (head.category === "APPLICATION") return "4107";
  if (head.category === "FINE") return "4108";
  if (head.billing === "ON_ADMISSION" || /admission/i.test(head.title)) return "4103";
  if (/exam/i.test(head.title)) return "4104";
  if (head.billing === "MONTHLY") return "4101";
  return "4102";
}

export const CLASS_SHORTS = ["Prep", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
export const classNameOf = (short: string) => (short === "Prep" ? "Prep" : `Class ${short}`);

/** Admission and candidate fees by class (the admissions desk uses the same figures). */
const ADMISSION_FEE: Record<string, number> = { Prep: 6000, "1": 6000, "2": 6000, "3": 6000, "4": 7000, "5": 7000, "6": 8000, "7": 8000, "8": 8000, "9": 9000, "10": 9000 };
const CANDIDATE_FEE: Record<string, number> = { "1": 1000, "3": 1000, "6": 1500, "9": 2000 };

/** Amounts for a class in a session (2025–26 was about 6% lower). */
export function amountsFor(session: number, classShort: string): Record<string, number> {
  const n = Number(classShort);
  const tuition26 = tuitionFor(classShort);
  const tuition = session >= 2026 ? tuition26 : roundTo(tuition26 * 0.94, 500);
  return {
    TUITION: tuition,
    ANNUAL: 3000,
    EXAM: session >= 2026 ? (n >= 9 ? 1500 : 1000) : n >= 9 ? 1200 : 800,
    BOARD: n >= 9 ? (session >= 2026 ? 2500 : 2200) : 0,
    ADMISSION: session >= 2026 ? (ADMISSION_FEE[classShort] ?? 6000) : roundTo((ADMISSION_FEE[classShort] ?? 6000) * 0.9, 500),
    CANDIDATE: CANDIDATE_FEE[classShort] ?? 0,
    PRE_NINTH: classShort === "9" ? (session >= 2026 ? 4000 : 3500) : 0,
  };
}

/* ================================================================== Installment plans */

/** Due dates of each plan in a session (explicit dates, never worked out from today's date). */
export function plansFor(session: number): FeeInstallmentPlan[] {
  const y = session;
  const months = sessionMonths(session);
  const monthly: FeeInstallment[] = months.map((m, i) => ({ no: i + 1, label: monthShort(m), dueDate: `${m}-10` }));
  return [
    { code: "MONTHLY", title: "Monthly", count: 12, installments: monthly, heads: ["TUITION", "TRANSPORT"] },
    {
      code: "QUARTERLY",
      title: "Quarterly",
      count: 4,
      installments: [
        { no: 1, label: "Apr–Jun", dueDate: `${y}-04-10` },
        { no: 2, label: "Jul–Sep", dueDate: `${y}-07-10` },
        { no: 3, label: "Oct–Dec", dueDate: `${y}-10-10` },
        { no: 4, label: "Jan–Mar", dueDate: `${y + 1}-01-10` },
      ],
      heads: [],
    },
    {
      code: "TERMLY",
      title: "Each term",
      count: 2,
      installments: [
        { no: 1, label: "Mid-term (Dec)", dueDate: `${y}-12-10` },
        { no: 2, label: "Final term (Feb)", dueDate: `${y + 1}-02-10` },
      ],
      heads: ["EXAM"],
    },
    {
      code: "ANNUAL",
      title: "Once a year",
      count: 1,
      installments: [{ no: 1, label: "September", dueDate: `${y}-09-15` }],
      heads: ["ANNUAL"],
    },
  ];
}

/** Board registration is a one-off in January for Class 9 and 10. */
export const boardDueDate = (session: number): IsoDate => `${session + 1}-01-10`;

/* ================================================================== Concessions */

export const CONCESSION_TYPES: FeeConcessionTypeInfo[] = [
  { code: "SIBLING", title: "Sibling", description: "Each younger brother or sister of a child already at MTB (any campus). The eldest pays full fee.", defaultPct: 10, maxPct: 25, needsReference: false },
  { code: "STAFF_CHILD", title: "Staff child", description: "Children of MTB non-teaching staff while the parent is employed.", defaultPct: 50, maxPct: 100, needsReference: true, referenceLabel: "Staff number" },
  { code: "TEACHER_CHILD", title: "Teacher's child", description: "Children of MTB teachers while the parent teaches here.", defaultPct: 50, maxPct: 100, needsReference: true, referenceLabel: "Staff number" },
  { code: "SCHOLARSHIP", title: "Scholarship", description: "Need scholarship awarded by the scholarship committee.", defaultPct: 25, maxPct: 100, needsReference: true, referenceLabel: "Scholarship award number" },
  { code: "TALENT", title: "Talent / merit", description: "Position holders and students with a talent award (sports, Quran, debates).", defaultPct: 25, maxPct: 100, needsReference: true, referenceLabel: "Award or result reference" },
  { code: "ARMED_FORCES", title: "Armed forces", description: "Children of serving or retired armed forces personnel.", defaultPct: 20, maxPct: 50, needsReference: true, referenceLabel: "Service number" },
  { code: "GOVT_SERVANT", title: "Govt servant child", description: "Children of government employees, on the department's letter.", defaultPct: 10, maxPct: 30, needsReference: true, referenceLabel: "Department letter number" },
  { code: "ORPHAN", title: "Orphan", description: "A child whose father has died; the death certificate is seen by the office.", defaultPct: 50, maxPct: 100, needsReference: false },
  { code: "PERIPHERY", title: "Periphery student", description: "Students from the villages around the campus under the community scheme.", defaultPct: 25, maxPct: 50, needsReference: false },
  { code: "KINSHIP", title: "Kinship", description: "Children under a relative's or guardian's care.", defaultPct: 50, maxPct: 100, needsReference: false },
  { code: "HARDSHIP", title: "Hardship", description: "A family facing hardship for a period; reviewed at the end of it.", defaultPct: 50, maxPct: 100, needsReference: false },
  { code: "SPECIAL", title: "Special approval", description: "Any other case the principal approves, with the reason on record.", defaultPct: 20, maxPct: 100, needsReference: false },
];

/* ================================================================== Collections (agrees with the dashboard) */

/** Today's figures per campus before anything is posted in the demo (same as the dashboard's). */
export const COLLECTION_BASE: Record<CampusCode, { today: { amount: number; receipts: number }; month: { collected: number; target: number } }> = {
  KC: { today: { amount: 486500, receipts: 57 }, month: { collected: 2140000, target: 6800000 } },
  SM: { today: { amount: 214000, receipts: 24 }, month: { collected: 1020000, target: 3200000 } },
  UC: { today: { amount: 268500, receipts: 31 }, month: { collected: 1310000, target: 3900000 } },
  MC: { today: { amount: 121000, receipts: 15 }, month: { collected: 610000, target: 2100000 } },
  HC: { today: { amount: 402000, receipts: 44 }, month: { collected: 1880000, target: 5600000 } },
};

/** Receipt numbers already used in session 2026–27 when the demo starts. */
export const RECEIPT_SEQ_AT_START: Record<CampusCode, number> = { KC: 4820, SM: 1310, UC: 2204, MC: 980, HC: 3127 };

/** Counter staff per campus (fictional). The first one is the main counter. */
export const CASHIERS: Record<CampusCode, string[]> = {
  KC: ["Usman Ali", "Rizwan Haider"],
  SM: ["Asma Rauf"],
  UC: ["Tariq Javed", "Saba Khalid"],
  MC: ["Nabeel Akhtar"],
  HC: ["Saima Qureshi", "Owais Malik"],
};

/** Monthly target: the month's billing, higher in April (admissions) and September (annual charges). */
function monthTarget(code: CampusCode, month: string): number {
  const t = COLLECTION_BASE[code].month.target;
  const factor: Record<string, number> = { "04": 1.18, "09": 1.24 };
  const session2025 = month < "2026-04";
  return round500(t * (factor[month.slice(5, 7)] ?? 1) * (session2025 ? 0.94 : 1));
}

/** Share of the target collected in closed months (fictional). */
const MONTH_PCT: Record<string, number> = { "04": 0.96, "05": 0.95, "06": 0.89, "07": 0.92, "08": 0.97, "09": 0.91, "10": 0.94, "11": 0.95, "12": 0.93, "01": 0.92, "02": 0.95, "03": 0.97 };

export interface CollectionFigures {
  today: { amount: number; receipts: number };
  month: { collected: number; target: number };
}

/** Figures with the demo's own receipts added on top (exactly what the dashboard shows). */
export function figuresFor(code: CampusCode, posted: { amount: number; receipts: number } | undefined): CollectionFigures {
  const b = COLLECTION_BASE[code];
  const p = posted ?? { amount: 0, receipts: 0 };
  return { today: { amount: b.today.amount + p.amount, receipts: b.today.receipts + p.receipts }, month: { collected: b.month.collected + p.amount, target: b.month.target } };
}

const ticketOf = (f: CollectionFigures) => (f.today.receipts > 0 ? f.today.amount / f.today.receipts : 8500);

const octNovCache = new Map<string, Map<IsoDate, number>>();
const closedCache = new Map<string, Map<IsoDate, number>>();

/** October and November day by day, with the dashboard's generator (October 1–5 included). */
function octNovDays(code: CampusCode, f: CollectionFigures): Map<IsoDate, number> {
  const key = `${code}:${f.today.amount}:${f.today.receipts}:${f.month.collected}`;
  const hit = octNovCache.get(key);
  if (hit) return hit;
  const out = buildOctNov(code, f);
  octNovCache.set(key, out);
  return out;
}

function buildOctNov(code: CampusCode, f: CollectionFigures): Map<IsoDate, number> {
  const rand = seeded(`collections:${code}`);
  const weight = (d: IsoDate) => {
    const day = Number(d.slice(8, 10));
    const w = day <= 10 ? 0.8 + day * 0.32 : Math.max(0.22, 0.62 - (day - 10) * 0.02);
    return w * (weekday(d) === 6 ? 0.7 : 1) * (0.86 + rand() * 0.28);
  };
  const october = schoolDays("2026-10-01", "2026-10-31");
  const weights = new Map(october.map((d) => [d, weight(d)]));
  const wsum = [...weights.values()].reduce((a, w) => a + w, 0);
  const octTotal = f.month.target * 0.94;
  const out = new Map<IsoDate, number>();
  for (const d of october) out.set(d, round500((octTotal * weights.get(d)!) / wsum));

  const novBefore = schoolDays("2026-11-01", addDays(DEMO_TODAY, -1));
  const novRest = Math.max(0, f.month.collected - f.today.amount);
  const novWeights = novBefore.map((_, i) => 0.85 + i * 0.3);
  const novWsum = novWeights.reduce((a, w) => a + w, 0);
  novBefore.forEach((d, i) => out.set(d, round500((novRest * novWeights[i]!) / novWsum)));
  const lastNov = novBefore.at(-1);
  if (lastNov) out.set(lastNov, novRest - novBefore.slice(0, -1).reduce((a, d) => a + out.get(d)!, 0));
  out.set(DEMO_TODAY, f.today.amount);
  return out;
}

/** A closed month spread over its school days: busiest before the 10th, tailing off after. */
function closedMonthDays(code: CampusCode, month: string): Map<IsoDate, number> {
  const key = `${code}:${month}`;
  const hit = closedCache.get(key);
  if (hit) return hit;
  const out = buildClosedMonth(code, month);
  closedCache.set(key, out);
  return out;
}

function buildClosedMonth(code: CampusCode, month: string): Map<IsoDate, number> {
  const total = round500(monthTarget(code, month) * (MONTH_PCT[month.slice(5, 7)] ?? 0.93));
  const rand = seeded(`month:${code}:${month}`);
  const days = schoolDays(`${month}-01`, monthEnd(month));
  const w = days.map((d) => {
    const day = Number(d.slice(8, 10));
    return (day <= 10 ? 0.8 + day * 0.32 : Math.max(0.22, 0.62 - (day - 10) * 0.02)) * (weekday(d) === 6 ? 0.7 : 1) * (0.86 + rand() * 0.28);
  });
  const ws = w.reduce((a, x) => a + x, 0);
  const out = new Map<IsoDate, number>();
  days.forEach((d, i) => out.set(d, round500((total * w[i]!) / ws)));
  const last = days.at(-1);
  if (last) out.set(last, total - days.slice(0, -1).reduce((a, d) => a + out.get(d)!, 0));
  return out;
}

/** Amount and receipts collected at a campus on one day (0 on Sundays and after today). */
export function dayFigure(code: CampusCode, date: IsoDate, f: CollectionFigures): { amount: number; receipts: number } {
  if (date > DEMO_TODAY || !isSchoolDay(date) || date < "2025-04-01") return { amount: 0, receipts: 0 };
  const amount = date >= "2026-10-01" ? (octNovDays(code, f).get(date) ?? 0) : (closedMonthDays(code, date.slice(0, 7)).get(date) ?? 0);
  const receipts = date === DEMO_TODAY ? f.today.receipts : Math.round(amount / ticketOf(f));
  return { amount, receipts };
}

/* ================================================================== Synthetic counter rows */

const METHODS = [
  ["CASH", 0.7],
  ["BANK", 0.2],
  ["ONLINE", 0.08],
  ["CHEQUE", 0.02],
] as const;

export type SyntheticMethod = (typeof METHODS)[number][0];

/** The day's receipts behind the carried-over figure, rebuilt the same way every time. */
export function syntheticRows(
  code: CampusCode,
  date: IsoDate,
  count: number,
  amount: number,
  students: Array<{ grNo: string; name: string; classSection: string }>,
): Array<{ grNo: string; name: string; classSection: string; cashier: string; method: SyntheticMethod; minutes: number; amount: number; fine: number; head: string }> {
  if (count <= 0 || amount <= 0 || students.length === 0) return [];
  const rand = seeded(`rows:${code}:${date}`);
  const day = Number(date.slice(8, 10));
  // Late payers after the 10th pay last month's tuition with a fine; before it, this month's.
  const month = date.slice(0, 7);
  const prev = (() => {
    const [y, m] = month.split("-").map(Number);
    return new Date(Date.UTC(y ?? 2026, (m ?? 1) - 2, 1)).toISOString().slice(0, 7);
  })();
  const rows = Array.from({ length: count }, () => {
    const s = students[Math.floor(rand() * students.length)]!;
    const r = rand();
    let acc = 0;
    let method: SyntheticMethod = "CASH";
    for (const [m, p] of METHODS) {
      acc += p;
      if (r <= acc) {
        method = m;
        break;
      }
    }
    const cashiers = CASHIERS[code];
    const cashier = cashiers.length > 1 && rand() < 0.32 ? cashiers[1]! : cashiers[0]!;
    const late = day > 10 && rand() < 0.55;
    const fine = late ? Math.min(600, (day - 10) * 10) : 0;
    const base = tuitionFor(s.classSection.split("-")[0] ?? "") * (rand() < 0.18 ? 2 : 1);
    return { grNo: s.grNo, name: s.name, classSection: s.classSection, cashier, method, minutes: 0, amount: base + fine, fine, head: late ? `Tuition fee – ${monthShort(prev)}` : `Tuition fee – ${monthShort(month)}` };
  });
  // Scale to the day's figure in round fifties (rounded down); the last receipt takes the difference,
  // so the rows always add up to the day's figure exactly.
  const raw = rows.reduce((a, r) => a + r.amount, 0);
  const k = amount / raw;
  let running = 0;
  rows.forEach((r, i) => {
    if (i < rows.length - 1) {
      r.amount = Math.max(0, Math.floor((r.amount * k) / 50) * 50);
      running += r.amount;
    } else {
      r.amount = amount - running;
    }
    r.fine = Math.min(r.fine, Math.floor(r.amount / 2));
  });
  // Times from 08:05 to 13:40, spread through the counter's hours in order.
  const span = date === DEMO_TODAY ? 150 : 335;
  rows.forEach((r, i) => {
    r.minutes = 485 + Math.round(((i + rand() * 0.6) * span) / Math.max(1, count));
  });
  return rows;
}
