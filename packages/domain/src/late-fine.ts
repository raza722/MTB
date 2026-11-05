import { daysBetween, type IsoDate } from "./dates";
import { formatRs, type Rupees } from "./money";

/**
 * Late-fine rule as data, not code. Today: Rs 10 per day, starting the day after the due date,
 * no grace days and no cap. Grace days and a maximum are open decisions (brief §11), so they are
 * parameters here and the UI can show both variants.
 */
export interface LateFinePolicy {
  ratePerDay: Rupees;
  graceDays: number;
  maxFine: Rupees | null;
}

export const DEFAULT_LATE_FINE_POLICY: LateFinePolicy = { ratePerDay: 10, graceDays: 0, maxFine: null };

export interface LateFine {
  /** Calendar days past the due date (0 if not yet overdue). */
  daysOverdue: number;
  /** Days that attract a fine after grace days. */
  chargeableDays: number;
  fine: Rupees;
  capped: boolean;
  /** Days until due when not yet overdue; 0 means due today; null when overdue. */
  dueInDays: number | null;
  /** "50 days × Rs 10" — used in the fee-counter tooltip. */
  explanation: string;
}

export function calculateLateFine(dueDate: IsoDate, onDate: IsoDate, policy: LateFinePolicy = DEFAULT_LATE_FINE_POLICY): LateFine {
  const diff = daysBetween(dueDate, onDate);
  const daysOverdue = Math.max(0, diff);
  const chargeableDays = Math.max(0, daysOverdue - policy.graceDays);
  const uncapped = chargeableDays * policy.ratePerDay;
  const capped = policy.maxFine !== null && uncapped > policy.maxFine;
  const fine = capped && policy.maxFine !== null ? policy.maxFine : uncapped;

  let explanation = "No late fine";
  if (chargeableDays > 0) {
    explanation = `${chargeableDays} ${chargeableDays === 1 ? "day" : "days"} × ${formatRs(policy.ratePerDay)}`;
    if (capped && policy.maxFine !== null) explanation += ` (capped at ${formatRs(policy.maxFine)})`;
  } else if (daysOverdue > 0) {
    explanation = `Within ${policy.graceDays} grace ${policy.graceDays === 1 ? "day" : "days"}`;
  }

  return {
    daysOverdue,
    chargeableDays,
    fine,
    capped,
    dueInDays: diff < 0 ? -diff : diff === 0 ? 0 : null,
    explanation,
  };
}

/** "50" for overdue, "Due in 6 days" / "Due today" otherwise. */
export function describeDue(fine: Pick<LateFine, "daysOverdue" | "dueInDays">): string {
  if (fine.daysOverdue > 0) return String(fine.daysOverdue);
  if (fine.dueInDays === 0) return "Due today";
  return `Due in ${fine.dueInDays} ${fine.dueInDays === 1 ? "day" : "days"}`;
}
