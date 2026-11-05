// Fictional figures for the specimens, matching the demo data the live screens use (brief §5).
import { calculateLateFine, formatRs, type IsoDate, type LateFine } from "@mtb/domain";

export const TODAY: IsoDate = "2026-11-04";
/** 10:41 AM, Pakistan time: when the demo admin pauses SMS. */
export const PAUSED_AT = "2026-11-04T10:41:00+05:00";
/** 08:42 AM: when the teacher's register reaches the school server. */
export const SYNCED_AT = "2026-11-04T08:42:00+05:00";

export interface DemoCharge {
  id: string;
  head: string;
  dueDate: IsoDate;
  amount: number;
  fine: LateFine;
  lineTotal: number;
  overdue: boolean;
}

function charge(id: string, head: string, amount: number, dueDate: IsoDate): DemoCharge {
  const fine = calculateLateFine(dueDate, TODAY);
  return { id, head, dueDate, amount, fine, lineTotal: amount + fine.fine, overdue: fine.daysOverdue > 0 };
}

/** Ayesha Khan's open charges on 04-Nov-2026, oldest first. The two overdue ones come to Rs 12,250. */
export const AYESHA_CHARGES: DemoCharge[] = [
  charge("ann", "Annual charges 2026–27", 3000, "2026-09-15"),
  charge("oct", "Tuition fee – Oct 2026", 8500, "2026-10-10"),
  charge("nov", "Tuition fee – Nov 2026", 8500, "2026-11-10"),
];

export const AYESHA_OVERDUE = AYESHA_CHARGES.filter((c) => c.overdue);
export const OVERDUE_TOTAL = AYESHA_OVERDUE.reduce((s, c) => s + c.lineTotal, 0);
export const CASH_RECEIVED = 13000;
export const RECEIPT_NO = "KC-2627-004821";

export const AYESHA = { name: "Ayesha Khan", nameUr: "عائشہ خان", grNo: "KC-14823", classSection: "7-B", father: "Imran Khan", campus: "Khalid Campus" } as const;
export const HAMZA = { name: "Hamza Khan", nameUr: "حمزہ خان", grNo: "KC-15102", classSection: "4-A", father: "Imran Khan" } as const;

/** Lines for the review dialog: "Annual charges 2026–27 + late fine Rs 500" → "Rs 3,500". */
export function reviewLines(charges: DemoCharge[]): Array<[string, string]> {
  return charges.map((c) => [c.head + (c.fine.fine ? ` + late fine ${formatRs(c.fine.fine)}` : ""), formatRs(c.lineTotal)]);
}

/** 7-B, the register Ms Hina Javed takes (34 students). Only named demo students are listed; the rest are counted. */
export const REGISTER_7B = {
  classSection: "7-B",
  enrolled: 34,
  counts: { present: 31, absent: 2, leave: 1, late: 0 },
  shown: [
    { roll: 1, name: "Areeba Siddiqui", mark: "L" as const },
    { roll: 2, name: "Ayesha Khan", mark: "P" as const },
    { roll: 3, name: "Muhammad Bilal", mark: "A" as const },
  ],
};

/** The grading-free summary of First Term · Class 8 the exam office declares in flow 2. */
export const FIRST_TERM_C8 = { name: "First Term 2026–27", type: "Term exam", classes: ["8-A", "8-B", "8-C"], students: 96, missing: 0 };
