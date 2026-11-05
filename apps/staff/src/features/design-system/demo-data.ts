// Fictional demo data from the brief's cast (§5). No real student or staff data.
import type { AttendanceCode, IsoDate } from "@mtb/domain";
import type { FeeStatus, TimelineItem } from "@mtb/ui";

export const DEMO_TODAY: IsoDate = "2026-11-04";

export const CAMPUSES = ["Khalid Campus", "Sugar Mill Campus", "Ubaid Campus", "Majeed Campus", "Humaira Campus"] as const;

export interface DemoStudent {
  id: string;
  name: string;
  nameUr?: string;
  father: string;
  /** "d/o" or "s/o" */
  relation: "d/o" | "s/o";
  gr: string;
  klass: string;
  status: FeeStatus;
  balance: number;
}

export const STUDENTS: DemoStudent[] = [
  { id: "s1", name: "Ayesha Khan", nameUr: "عائشہ خان", relation: "d/o", father: "Imran Khan", gr: "KC-14823", klass: "7-B", status: "overdue", balance: 20750 },
  { id: "s2", name: "Hamza Khan", nameUr: "حمزہ خان", relation: "s/o", father: "Imran Khan", gr: "KC-15102", klass: "4-A", status: "paid", balance: 0 },
  { id: "s3", name: "Muhammad Bilal", relation: "s/o", father: "Tariq Mahmood", gr: "KC-14650", klass: "7-B", status: "unpaid", balance: 8500 },
  { id: "s4", name: "Fatima Noor", relation: "d/o", father: "Abdul Rauf", gr: "KC-14911", klass: "7-A", status: "paid", balance: 0 },
  { id: "s5", name: "Ali Raza", relation: "s/o", father: "Shahid Hussain", gr: "KC-14377", klass: "8-C", status: "overdue", balance: 17500 },
  { id: "s6", name: "Zainab Akhtar", relation: "d/o", father: "Naveed Akhtar", gr: "KC-15230", klass: "6-A", status: "unpaid", balance: 7800 },
  { id: "s7", name: "Hassan Iqbal", relation: "s/o", father: "Javed Iqbal", gr: "KC-14502", klass: "9-B", status: "cancelled", balance: 0 },
  { id: "s8", name: "Areeba Siddiqui", relation: "d/o", father: "Kamran Siddiqui", gr: "KC-14988", klass: "7-B", status: "paid", balance: 0 },
];

/** Ayesha's enrolment history (brief §7.4). */
export const AYESHA_TIMELINE: TimelineItem[] = [
  { id: "t1", date: "2020-04-06", title: "Admitted · Class 1-A", description: "Session 2020–21 · Khalid Campus", icon: "admissions", tone: "brand" },
  { id: "t2", date: "2025-04-01", title: "Promoted to Class 6-A", description: "Session 2025–26", icon: "arrowUp", tone: "success" },
  { id: "t3", date: "2026-04-01", title: "Promoted to Class 7-A", description: "Session 2026–27", icon: "arrowUp", tone: "success" },
  { id: "t4", date: "2026-08-18", title: "Section changed 7-A → 7-B", description: "Requested by Mrs Sadia Rehman (Principal)", icon: "split", tone: "info" },
];

/** Ayesha, October 2026: Monday–Saturday school, Sundays off. */
export const AYESHA_OCTOBER: Partial<Record<IsoDate, AttendanceCode>> = (() => {
  const marks: Partial<Record<IsoDate, AttendanceCode>> = {};
  const special: Record<number, AttendanceCode> = { 7: "A", 8: "L", 14: "LT", 21: "A", 24: "H", 28: "LT" };
  for (let d = 1; d <= 31; d++) {
    const date = new Date(2026, 9, d);
    if (date.getDay() === 0) continue;
    marks[`2026-10-${String(d).padStart(2, "0")}`] = special[d] ?? "P";
  }
  return marks;
})();

export const AYESHA_OCTOBER_HOLIDAYS: Partial<Record<IsoDate, string>> = { "2026-10-24": "Parent–teacher day (no classes)" };

export const ACCOUNTS = [
  { value: "1101", label: "Cash in hand", hint: "1101" },
  { value: "1102", label: "Bank — Meezan Bank, Sadiqabad", hint: "1102" },
  { value: "1103", label: "Bank — HBL, Sadiqabad", hint: "1103" },
  { value: "4101", label: "Tuition fee income", hint: "4101" },
  { value: "4102", label: "Annual charges income", hint: "4102" },
  { value: "4105", label: "Late payment fine income", hint: "4105" },
  { value: "5201", label: "Salaries — teaching staff", hint: "5201" },
  { value: "5310", label: "Electricity", hint: "5310" },
  { value: "5320", label: "Stationery and printing", hint: "5320" },
];
