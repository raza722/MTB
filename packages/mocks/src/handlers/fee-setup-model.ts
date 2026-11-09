// Fictional fee-office figures for the modules that are still mocked (no routes: Fees, module 6, is real).
// Accounts (module 7) reads the fee heads it posts to; the report centre (module 13) reads defaulters, class arrears,
// candidate fees, collections and the concession summary from here. The figures come from the fictional charges and
// receipts in fees-state.ts and the fictional structure and concessions below, and stay fictional until those
// modules are built (conventions §5).
import {
  type CampusCode,
  type CampusScope,
  type Charge,
  type FeeAuditEntry,
  type FeeCandidate,
  type FeeCandidateLine,
  type FeeClassArrears,
  type FeeClassArrearsRow,
  type FeeCollectionLine,
  type FeeCollectionRow,
  type FeeConcessionStatus,
  type FeeConcessionSummary,
  type FeeConcessionType,
  type FeeDefaulter,
  type FeeHead,
  type FeeSectionOverride,
  type FeeFineScope,
  type FeeInstallmentPlan,
  type Receipt,
} from "@mtb/api";
import { splitRupees } from "@mtb/api";
import { calculateLateFine, daysBetween, formatReceiptNo, formatSession, type IsoDate, type IsoDateTime, type LateFinePolicy } from "@mtb/domain";
import { DEMO_TODAY, demoNow } from "../clock";
import { createStore } from "../db";
import { campusName, campusOf } from "../fixtures/campuses";
import {
  addDays,
  amountsFor,
  boardDueDate,
  CASHIERS,
  CLASS_SHORTS,
  classNameOf,
  CONCESSION_TYPES,
  dayFigure,
  defaultIncomeAccount,
  FEE_HEADS,
  figuresFor,
  isSchoolDay,
  plansFor,
  RECEIPT_SEQ_AT_START,
  STRUCTURE_HEADS,
  syntheticRows,
} from "../fixtures/fee-setup";
import { findStudent, STUDENTS, type StudentRecord } from "../fixtures/students";
import { admissionsStore } from "./admissions-model";
import { chargesOf, feesStore } from "./fees-state";

const ALL_CAMPUSES: CampusCode[] = ["KC", "SM", "UC", "MC", "HC"];
const campusesIn = (scope: CampusScope): CampusCode[] => (scope === "ALL" ? ALL_CAMPUSES : [scope]);
const live = (s: StudentRecord) => !s.mergedInto;
const classOf = (cs: string) => cs.split("-")[0] ?? cs;
const sKey = (campus: CampusCode, session: number) => `${campus}:${session}`;
/* ================================================================== State */

interface ClassRecord {
  lines: Record<string, number>;
  /** Heads kept on record but not billed this session. */
  inactive?: string[];
  /** Annual / one-off heads split into parts (1, 2, 4 or 12). */
  installments?: Record<string, number>;
  /** Different amounts for one section. */
  sections?: FeeSectionOverride[];
  updatedAt: IsoDateTime;
  updatedBy: string;
}

interface StructureRecord {
  classes: Record<string, ClassRecord>;
  rowVer: number;
}

interface ConcessionRecord {
  id: string;
  campus: CampusCode;
  session: number;
  grNo: string;
  type: FeeConcessionType;
  pct: number;
  heads: string[];
  validFrom: IsoDate;
  validTo: IsoDate;
  reference?: string;
  reason: string;
  status: FeeConcessionStatus;
  requestedBy: string;
  requestedAt: IsoDateTime;
  decidedBy?: string;
  decidedAt?: IsoDateTime;
  decisionNote?: string;
  history: FeeAuditEntry[];
}

interface RuleCore {
  ratePerDay: number;
  graceDays: number;
  maxFine: number | null;
  appliesTo: FeeFineScope;
  effectiveFrom: IsoDate;
  updatedBy: string;
  updatedAt: IsoDateTime;
}

interface RuleRecord extends RuleCore {
  upcoming?: RuleCore;
  history: FeeAuditEntry[];
}

interface FeeSetupState {
  /** The fee head list (one for every campus). */
  heads?: FeeHead[];
  structures: Record<string, StructureRecord>;
  plans: Record<string, FeeInstallmentPlan[]>;
  concessions: ConcessionRecord[];
  rules: Record<CampusCode, RuleRecord>;
  /** Fee reminders sent per student (defaulter rows show the last one). */
  reminders: Record<string, { at: IsoDateTime; count: number }>;
}

/* ================================================================== Small helpers */

const audit = (at: IsoDateTime, by: string, text: string, detail?: string): FeeAuditEntry => ({ id: `a-${at}-${text.length}-${by.length}`, at, by, text, ...(detail ? { detail } : {}) });

/** The fee head list, in order (one list for every campus). */
function feeHeads(): FeeHead[] {
  const saved = feeSetupStore.get().heads;
  const list = saved ?? FEE_HEADS;
  return [...list].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

export const feeHeadByCode = (code: string): FeeHead | undefined => feeHeads().find((h) => h.code === code);

/** Which structure head a charge belongs to, from its label. */
export function headCodeOf(head: string): string {
  if (head.startsWith("Tuition fee")) return "TUITION";
  if (head.startsWith("Annual charges")) return "ANNUAL";
  if (head.startsWith("Exam fee")) return "EXAM";
  if (head.startsWith("Board registration")) return "BOARD";
  if (head.startsWith("Transport fee")) return "TRANSPORT";
  if (head.startsWith("Admission fee")) return "ADMISSION";
  // Heads added by the office: the label starts with the head's title (longest title first).
  const own = feeHeads()
    .filter((h) => h.category !== "FINE")
    .sort((a, b) => b.title.length - a.title.length)
    .find((h) => head.startsWith(h.title));
  if (own) return own.code;
  if (head.includes("fine")) return "FINE";
  return "OTHER";
}

/** For Accounts → Fee posting: heads added by the office, each with the income account it posts to by default. */
export function feeHeadsForPosting(core: string[]): Array<{ head: string; title: string; category: FeeHead["category"]; accountCode: string }> {
  return feeHeads()
    .filter((h) => !core.includes(h.code) && h.code !== "FINE_EXAM" && !h.linked)
    .map((h) => ({ head: h.code, title: h.title, category: h.category, accountCode: defaultIncomeAccount(h) }));
}

const HEAD_GROUP_LABEL: Record<string, string> = {
  TUITION: "Tuition fee",
  ANNUAL: "Annual charges",
  EXAM: "Exam fee",
  BOARD: "Board registration fee",
  TRANSPORT: "Transport fee",
  ADMISSION: "Admission fee",
  FINE: "Student fines",
  LATE_FINE: "Late fines",
  OTHER: "Other",
};

const groupLabel = (k: string) => HEAD_GROUP_LABEL[k] ?? feeHeadByCode(k)?.title ?? k;

/** The same rounding every time: concession = gross × % ÷ 100, to the nearest rupee. */
const concessionOff = (gross: number, pct: number) => Math.round((gross * pct) / 100);

/* ================================================================== Initial data */

function structureFor(session: number, at: IsoDateTime, by: string): StructureRecord {
  const classes: Record<string, ClassRecord> = {};
  for (const cls of CLASS_SHORTS) {
    const a = amountsFor(session, cls);
    classes[cls] = { lines: Object.fromEntries(STRUCTURE_HEADS.map((h) => [h, a[h] ?? 0])), updatedAt: at, updatedBy: by };
  }
  return { classes, rowVer: 1 };
}

const KC_NAMED = new Set(["KC-14823", "KC-15102", "KC-14650", "KC-14911", "KC-14377", "KC-15230", "KC-14502", "KC-14988", "KC-14215", "KC-14108", "KC-13981", "KC-14598"]);

/** Generated classmates at a campus (not the brief's named cast), in G.R. order. */
function generatedAt(campus: CampusCode): StudentRecord[] {
  return STUDENTS.filter((s) => live(s) && s.campus === campus && s.status === "ACTIVE" && !KC_NAMED.has(s.grNo)).sort((a, b) => a.grNo.localeCompare(b.grNo));
}

function initialRules(): Record<CampusCode, RuleRecord> {
  const base = (campus: CampusCode): RuleRecord => ({
    ratePerDay: 10,
    graceDays: 0,
    maxFine: null,
    appliesTo: "ALL",
    effectiveFrom: "2026-04-01",
    updatedBy: "Kamran Yousaf",
    updatedAt: "2026-03-25T10:15:00+05:00",
    history: [audit("2026-03-25T10:15:00+05:00", "Kamran Yousaf", `Rule for ${formatSession(2026)} at ${campusName(campus)}: Rs 10 a day after the due date, on every fee head`, "No grace days, no maximum")],
  });
  const rules = { KC: base("KC"), SM: base("SM"), UC: base("UC"), MC: base("MC"), HC: base("HC") };
  rules.HC = {
    ...rules.HC,
    upcoming: { ratePerDay: 10, graceDays: 5, maxFine: null, appliesTo: "ALL", effectiveFrom: "2026-12-01", updatedBy: "Kamran Yousaf", updatedAt: "2026-10-29T15:40:00+05:00" },
    history: [...rules.HC.history, audit("2026-10-29T15:40:00+05:00", "Kamran Yousaf", "Change saved: 5 grace days from 01-Dec-2026", "Requested by the Humaira Campus principal for parents paid by salary on the 10th")],
  };
  return rules;
}

function initialState(): FeeSetupState {
  const structures: Record<string, StructureRecord> = {};
  const plans: Record<string, FeeInstallmentPlan[]> = {};
  for (const c of ALL_CAMPUSES) {
    structures[sKey(c, 2025)] = structureFor(2025, "2025-03-18T10:00:00+05:00", "Nadia Shah");
    plans[sKey(c, 2025)] = plansFor(2025);
    plans[sKey(c, 2026)] = plansFor(2026);
    // Majeed Campus hasn't entered 2026–27 yet: the page offers "Copy from 2025–26".
    if (c !== "MC") {
      structures[sKey(c, 2026)] = structureFor(2026, "2026-03-20T11:00:00+05:00", "Nadia Shah");
    }
  }

  // Concessions. Most start in December so this month's counter figures stay as they are.
  const gen = generatedAt("KC");
  const staffChild = gen[2];
  const concessions: ConcessionRecord[] = [
    {
      id: "con-1",
      campus: "KC",
      session: 2026,
      grNo: "KC-14988",
      type: "SIBLING",
      pct: 10,
      heads: ["TUITION"],
      validFrom: "2026-11-01",
      validTo: "2027-03-31",
      reason: "Second child at MTB: her elder brother studies at Ubaid Campus. Checked by the office against the father's CNIC.",
      status: "APPROVED",
      requestedBy: "Usman Ali",
      requestedAt: "2026-10-30T11:05:00+05:00",
      decidedBy: "Mrs Sadia Rehman",
      decidedAt: "2026-11-02T12:40:00+05:00",
      decisionNote: "Approved from November.",
      history: [audit("2026-10-30T11:05:00+05:00", "Usman Ali", "Requested: sibling 10% on tuition from 01-Nov-2026"), audit("2026-11-02T12:40:00+05:00", "Mrs Sadia Rehman", "Approved", "Approved from November.")],
    },
    {
      id: "con-2",
      campus: "KC",
      session: 2026,
      grNo: "KC-15230",
      type: "SCHOLARSHIP",
      pct: 25,
      heads: ["TUITION"],
      validFrom: "2026-12-01",
      validTo: "2027-03-31",
      reference: "SCH-2627-014",
      reason: "Merit scholarship: first in Class 6 in the First Term exams.",
      status: "APPROVED",
      requestedBy: "Nadia Shah",
      requestedAt: "2026-10-24T10:20:00+05:00",
      decidedBy: "Mrs Sadia Rehman",
      decidedAt: "2026-10-28T13:15:00+05:00",
      decisionNote: "Scholarship committee minutes of 22-Oct are on file.",
      history: [audit("2026-10-24T10:20:00+05:00", "Nadia Shah", "Requested: scholarship 25% on tuition from 01-Dec-2026", "Award SCH-2627-014"), audit("2026-10-28T13:15:00+05:00", "Mrs Sadia Rehman", "Approved", "Scholarship committee minutes of 22-Oct are on file.")],
    },
    {
      id: "con-3",
      campus: "KC",
      session: 2026,
      grNo: "KC-14650",
      type: "HARDSHIP",
      pct: 50,
      heads: ["TUITION"],
      validFrom: "2026-11-01",
      validTo: "2027-03-31",
      reason: "Father's shop was closed for two months after the market fire; the family asked for help until March.",
      status: "PENDING",
      requestedBy: "Usman Ali",
      requestedAt: "2026-11-03T14:10:00+05:00",
      history: [audit("2026-11-03T14:10:00+05:00", "Usman Ali", "Requested: hardship 50% on tuition from 01-Nov-2026")],
    },
    {
      id: "con-4",
      campus: "KC",
      session: 2026,
      grNo: "KC-15102",
      type: "SIBLING",
      pct: 10,
      heads: ["TUITION"],
      validFrom: "2026-12-01",
      validTo: "2027-03-31",
      reason: "Younger brother of Ayesha Khan (7-B); the system found the family by the father's CNIC.",
      status: "PENDING",
      requestedBy: "Usman Ali",
      requestedAt: "2026-11-04T09:30:00+05:00",
      history: [audit("2026-11-04T09:30:00+05:00", "Usman Ali", "Requested: sibling 10% on tuition from 01-Dec-2026")],
    },
    {
      id: "con-5",
      campus: "KC",
      session: 2026,
      grNo: "KC-14377",
      type: "SPECIAL",
      pct: 30,
      heads: ["TUITION"],
      validFrom: "2026-11-01",
      validTo: "2027-03-31",
      reason: "Father asked for a reduction; two months of fees are overdue.",
      status: "REJECTED",
      requestedBy: "Usman Ali",
      requestedAt: "2026-10-15T12:00:00+05:00",
      decidedBy: "Mrs Sadia Rehman",
      decidedAt: "2026-10-20T11:30:00+05:00",
      decisionNote: "Clear the overdue fees first, then apply again with the father's letter.",
      history: [audit("2026-10-15T12:00:00+05:00", "Usman Ali", "Requested: special approval 30% on tuition from 01-Nov-2026"), audit("2026-10-20T11:30:00+05:00", "Mrs Sadia Rehman", "Rejected", "Clear the overdue fees first, then apply again with the father's letter.")],
    },
  ];
  if (staffChild) {
    concessions.push({
      id: "con-6",
      campus: "KC",
      session: 2026,
      grNo: staffChild.grNo,
      type: "STAFF_CHILD",
      pct: 50,
      heads: ["TUITION"],
      validFrom: "2026-12-01",
      validTo: "2027-03-31",
      reference: "KC-ST-0142",
      reason: "Mother joined Khalid Campus as a junior-school teacher on 01-Nov-2026.",
      status: "APPROVED",
      requestedBy: "Nadia Shah",
      requestedAt: "2026-11-02T09:10:00+05:00",
      decidedBy: "Mrs Sadia Rehman",
      decidedAt: "2026-11-02T15:00:00+05:00",
      history: [audit("2026-11-02T09:10:00+05:00", "Nadia Shah", "Requested: staff child 50% on tuition from 01-Dec-2026", "Staff number KC-ST-0142"), audit("2026-11-02T15:00:00+05:00", "Mrs Sadia Rehman", "Approved")],
    });
  }

  return {
    heads: FEE_HEADS.map((h) => ({ ...h, rowVer: 1 })),
    structures,
    plans,
    concessions,
    rules: initialRules(),
    reminders: { "KC-14823": { at: "2026-10-20T16:00:00+05:00", count: 1 } },
  };
}

const feeSetupStore = createStore<FeeSetupState>("fee-setup", initialState);

/* ================================================================== Rules and fines */

function currentRule(campus: CampusCode): RuleCore {
  const r = feeSetupStore.get().rules[campus];
  return r.upcoming && r.upcoming.effectiveFrom <= DEMO_TODAY ? r.upcoming : r;
}

const policyOf = (r: RuleCore): LateFinePolicy => ({ ratePerDay: r.ratePerDay, graceDays: r.graceDays, maxFine: r.maxFine });

/** Late fine on a charge on a date, by the campus's own rule. */
function campusFine(campus: CampusCode, head: string, dueDate: IsoDate, on: IsoDate): number {
  const r = currentRule(campus);
  if (r.appliesTo === "TUITION" && !head.startsWith("Tuition fee")) return 0;
  return calculateLateFine(dueDate, on, policyOf(r)).fine;
}

/* ================================================================== Structure */

function structureRecord(campus: CampusCode, session: number): StructureRecord | undefined {
  return feeSetupStore.get().structures[sKey(campus, session)];
}

/** Amount of a head for a class (or one section of it, when the section has its own amount). 0 when not billed. */
function amountOf(campus: CampusCode, session: number, cls: string, head: string, section?: string): number {
  const c = structureRecord(campus, session)?.classes[cls];
  if (!c || c.inactive?.includes(head)) return 0;
  const own = section ? c.sections?.find((o) => o.section === section && o.head === head) : undefined;
  return own ? own.amount : (c.lines[head] ?? 0);
}

function plansOf(campus: CampusCode, session: number): FeeInstallmentPlan[] {
  return feeSetupStore.get().plans[sKey(campus, session)] ?? plansFor(session);
}

/* ================================================================== Concessions */

/** Every installment of a head for a class (or section) in a session: due date and amount before concessions. */
function headSchedule(campus: CampusCode, session: number, cls: string, section: string | undefined, code: string): Array<{ dueDate: IsoDate; gross: number }> {
  const h = feeHeadByCode(code);
  if (!h || h.category !== "FEE" || h.linked) return [];
  if (h.classes?.length && !h.classes.includes(cls)) return [];
  const amount = amountOf(campus, session, cls, code, section);
  if (amount <= 0) return [];
  if (code === "BOARD") return [{ dueDate: boardDueDate(session), gross: amount }];
  const parts = structureRecord(campus, session)?.classes[cls]?.installments?.[code];
  const planCode = planFor(h, parts);
  const plan = planCode ? plansOf(campus, session).find((p) => p.code === planCode) : undefined;
  if (!plan) return [];
  if (parts && parts > 1 && h.billing === "ANNUAL") {
    const split = splitRupees(amount, parts);
    return plan.installments.map((i, k) => ({ dueDate: i.dueDate, gross: split[k] ?? 0 }));
  }
  return plan.installments.map((i) => ({ dueDate: i.dueDate, gross: amount }));
}

/** Rupees a concession takes off over its dates (or a window inside them), head by head. */
function concessionValue(c: Pick<ConcessionRecord, "campus" | "session" | "grNo" | "heads" | "pct" | "validFrom" | "validTo">, from: IsoDate, to: IsoDate, onlyHeads?: string[]): Record<string, number> {
  const s = findStudent(c.grNo);
  if (!s) return {};
  const cls = classOf(s.classSection);
  const section = s.classSection.split("-")[1];
  const lo = from > c.validFrom ? from : c.validFrom;
  const hi = to < c.validTo ? to : c.validTo;
  const out: Record<string, number> = {};
  for (const code of c.heads) {
    if (onlyHeads && !onlyHeads.includes(code)) continue;
    out[code] = headSchedule(c.campus, c.session, cls, section, code)
      .filter((i) => i.dueDate >= lo && i.dueDate <= hi)
      .reduce((a, i) => a + concessionOff(i.gross, c.pct), 0);
  }
  return out;
}

/**
 * Concessions added up by class for a period (Class Wise Discount, Annual Fee Concession, Student Discount).
 * Billed = the chosen heads' installments falling due in the period; discount = what approved concessions take off them.
 * Exported for the report centre, so both read the same live figures.
 */
export function feeConcessionSummary(scope: CampusScope, session: number, from: IsoDate, to: IsoDate, opts: { heads?: string[]; classes?: string[]; section?: string } = {}): FeeConcessionSummary {
  const eligible = feeHeads().filter((h) => h.concessionEligible);
  const heads = opts.heads?.length ? eligible.filter((h) => opts.heads!.includes(h.code)) : eligible;
  const codes = heads.map((h) => h.code);
  const campuses = campusesIn(scope);
  const concessions = feeSetupStore.get().concessions.filter((c) => campuses.includes(c.campus) && c.session === session && (c.status === "APPROVED" || c.status === "STOPPED") && c.validFrom <= to && c.validTo >= from);
  const students = STUDENTS.filter((s) => live(s) && s.status === "ACTIVE" && campuses.includes(s.campus))
    .filter((s) => !opts.classes?.length || opts.classes.includes(classOf(s.classSection)))
    .filter((s) => !opts.section || s.classSection.split("-")[1] === opts.section);
  const byClass = new Map<string, FeeSetupClassAcc>();
  const kindRows = new Map<string, { strength: number; counts: Partial<Record<FeeConcessionType, number>>; total: number }>();
  const studentRows: FeeConcessionSummary["students"] = [];
  const kinds = new Set<FeeConcessionType>();
  for (const s of students) {
    const cls = classOf(s.classSection);
    const section = s.classSection.split("-")[1];
    const g = byClass.get(cls) ?? { strength: 0, students: 0, billed: 0, discount: 0 };
    const k = kindRows.get(cls) ?? { strength: 0, counts: {}, total: 0 };
    g.strength += 1;
    k.strength += 1;
    const billedByHead: Record<string, number> = {};
    for (const code of codes) billedByHead[code] = headSchedule(s.campus, session, cls, section, code).filter((i) => i.dueDate >= from && i.dueDate <= to).reduce((a, i) => a + i.gross, 0);
    const billed = Object.values(billedByHead).reduce((a, v) => a + v, 0);
    g.billed += billed;
    const mine = concessions.filter((c) => c.grNo === s.grNo).sort((a, b) => b.pct - a.pct);
    if (mine.length) {
      // The larger concession applies when two run at once (same rule as the counter).
      const best = mine[0]!;
      const off = concessionValue(best, from, to, codes);
      const discount = Object.values(off).reduce((a, v) => a + v, 0);
      g.students += 1;
      g.discount += discount;
      k.counts[best.type] = (k.counts[best.type] ?? 0) + 1;
      k.total += 1;
      kinds.add(best.type);
      studentRows.push({
        grNo: s.grNo,
        studentName: s.name,
        father: s.father,
        classSection: s.classSection,
        type: best.type,
        pct: best.pct,
        ...(best.reference ? { reference: best.reference } : {}),
        sessionFee: billed,
        concession: discount,
        payable: billed - discount,
        byHead: off,
      });
    }
    byClass.set(cls, g);
    kindRows.set(cls, k);
  }
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
  const order = (a: string, b: string) => CLASS_SHORTS.indexOf(a) - CLASS_SHORTS.indexOf(b);
  const classRows = [...byClass.entries()].sort(([a], [b]) => order(a, b)).map(([cls, g]) => ({ classShort: cls, className: classNameOf(cls), ...g, remaining: g.billed - g.discount, pct: pct(g.discount, g.billed) }));
  const sum = (f: (r: (typeof classRows)[number]) => number) => classRows.reduce((a, r) => a + f(r), 0);
  const kindList = CONCESSION_TYPES.map((t) => t.code).filter((t) => kinds.has(t));
  const kRows = [...kindRows.entries()].sort(([a], [b]) => order(a, b)).map(([cls, k]) => ({ classShort: cls, className: classNameOf(cls), strength: k.strength, counts: k.counts, total: k.total, pct: pct(k.total, k.strength) }));
  const totalCounts: Partial<Record<FeeConcessionType, number>> = {};
  for (const r of kRows) for (const [t, n] of Object.entries(r.counts)) totalCounts[t as FeeConcessionType] = (totalCounts[t as FeeConcessionType] ?? 0) + (n ?? 0);
  const kStrength = kRows.reduce((a, r) => a + r.strength, 0);
  const kTotal = kRows.reduce((a, r) => a + r.total, 0);
  return {
    campus: scope,
    session,
    from,
    to,
    heads: heads.map((h) => ({ code: h.code, title: h.title })),
    byClass: classRows,
    totals: { strength: sum((r) => r.strength), students: sum((r) => r.students), billed: sum((r) => r.billed), discount: sum((r) => r.discount), remaining: sum((r) => r.remaining), pct: pct(sum((r) => r.discount), sum((r) => r.billed)) },
    byClassKind: { kinds: kindList, rows: kRows, totals: { strength: kStrength, counts: totalCounts, total: kTotal, pct: pct(kTotal, kStrength) } },
    students: studentRows.sort((a, b) => a.classSection.localeCompare(b.classSection, "en", { numeric: true }) || a.studentName.localeCompare(b.studentName)),
  };
}

interface FeeSetupClassAcc {
  strength: number;
  students: number;
  billed: number;
  discount: number;
}

/* ================================================================== Vouchers */


/** Which plan a head (or a head split into n parts) is billed on. */
function planFor(h: FeeHead, parts: number | undefined): FeeInstallmentPlan["code"] | null {
  if (h.billing === "MONTHLY" || h.billing === "QUARTERLY" || h.billing === "TERMLY") return h.billing;
  // Admission fees are raised when a student is admitted, never on a monthly voucher.
  if (h.billing === "ANNUAL") {
    if (!parts || parts === 1) return "ANNUAL";
    return parts === 12 ? "MONTHLY" : parts === 4 ? "QUARTERLY" : "TERMLY";
  }
  return null;
}

/* ================================================================== Defaulters */

interface DefaulterFilter {
  /** Head codes; empty = every head. */
  heads?: string[];
  dueFrom?: IsoDate;
  dueTo?: IsoDate;
  classShort?: string;
  section?: string;
  /** Several class-sections at once ("7-A", "8-B"). */
  sections?: string[];
}

const chargeCode = (c: Charge) => c.headCode ?? headCodeOf(c.head);

function defaulterRows(scope: CampusScope, session: number, includeLeft: boolean, filter: DefaulterFilter = {}): FeeDefaulter[] {
  const reminders = feeSetupStore.get().reminders;
  const out: FeeDefaulter[] = [];
  const headOk = (c: Charge) => !filter.heads?.length || filter.heads.includes(chargeCode(c)) || (filter.heads.includes("FINE") && chargeCode(c) === "FINE");
  const dueOk = (c: Charge) => (!filter.dueFrom || c.dueDate >= filter.dueFrom) && (!filter.dueTo || c.dueDate <= filter.dueTo);
  for (const s of STUDENTS) {
    if (!live(s) || (scope !== "ALL" && s.campus !== scope)) continue;
    if (s.status !== "ACTIVE" && !includeLeft) continue;
    if (filter.classShort && classOf(s.classSection) !== filter.classShort) continue;
    if (filter.section && s.classSection.split("-")[1] !== filter.section) continue;
    if (filter.sections?.length && !filter.sections.includes(s.classSection)) continue;
    const all = chargesOf(s.grNo).filter((c) => c.session <= session && headOk(c));
    const open = all.filter((c) => c.status === "OPEN" && dueOk(c));
    const overdue = open.filter((c) => c.dueDate < DEMO_TODAY);
    if (overdue.length === 0) continue;
    const outstanding = overdue.reduce((a, c) => a + c.amount - c.settledAmount, 0);
    const fine = overdue.reduce((a, c) => a + campusFine(s.campus, c.head, c.dueDate, DEMO_TODAY), 0);
    const oldestDue = overdue.map((c) => c.dueDate).sort()[0]!;
    const days = daysBetween(oldestDue, DEMO_TODAY);
    const rem = reminders[s.grNo];
    const sessionTotal = all.filter((c) => c.session === session && c.status !== "CANCELLED").reduce((a, c) => a + c.amount, 0);
    const previousSessionArrears = overdue.filter((c) => c.session < session).reduce((a, c) => a + c.amount - c.settledAmount, 0);
    out.push({
      sessionTotal,
      previousSessionArrears,
      installments: [...overdue].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map((c) => ({ label: c.head, dueDate: c.dueDate, amount: c.amount - c.settledAmount })),
      grNo: s.grNo,
      studentName: s.name,
      classSection: s.classSection,
      campus: s.campus,
      campusName: s.campusName,
      father: s.father,
      mobile: s.guardian.mobile,
      enrolment: s.status,
      overdueCharges: overdue.length,
      oldestDue,
      daysOverdue: days,
      monthsOverdue: Math.max(1, Math.ceil(days / 30)),
      outstanding,
      fine,
      total: outstanding + fine,
      upcoming: open.filter((c) => c.dueDate >= DEMO_TODAY).reduce((a, c) => a + c.amount - c.settledAmount, 0),
      ...(rem ? { lastReminderAt: rem.at } : {}),
      reminders: rem?.count ?? 0,
    });
  }
  return out.sort((a, b) => b.total - a.total);
}

/** Billed, paid and arrears per class-section (Class Wise Arrear). Exported for the report centre. */
export function feeClassArrears(scope: CampusScope, session: number, filter: DefaulterFilter = {}): FeeClassArrears {
  const headOk = (c: Charge) => !filter.heads?.length || filter.heads.includes(chargeCode(c));
  const dueOk = (c: Charge) => (!filter.dueFrom || c.dueDate >= filter.dueFrom) && (!filter.dueTo || c.dueDate <= filter.dueTo);
  const m = new Map<string, FeeClassArrearsRow>();
  for (const s of STUDENTS) {
    if (!live(s) || s.status !== "ACTIVE" || (scope !== "ALL" && s.campus !== scope)) continue;
    const cls = classOf(s.classSection);
    const section = s.classSection.split("-")[1] ?? "";
    if (filter.classShort && cls !== filter.classShort) continue;
    if (filter.section && section !== filter.section) continue;
    if (filter.sections?.length && !filter.sections.includes(s.classSection)) continue;
    const key = scope === "ALL" ? `${s.campus}:${s.classSection}` : s.classSection;
    const g = m.get(key) ?? { classSection: scope === "ALL" ? `${s.classSection} · ${campusName(s.campus).replace(" Campus", "")}` : s.classSection, classShort: cls, section, strength: 0, students: 0, billed: 0, paid: 0, arrears: 0, pct: 0 };
    g.strength += 1;
    const charges = chargesOf(s.grNo).filter((c) => c.session === session && c.status !== "CANCELLED" && c.dueDate <= DEMO_TODAY && headOk(c) && dueOk(c));
    const billed = charges.reduce((a, c) => a + c.amount, 0);
    const paid = charges.reduce((a, c) => a + (c.status === "SETTLED" ? c.amount : c.settledAmount), 0);
    const arrears = charges.filter((c) => c.status === "OPEN" && c.dueDate < DEMO_TODAY).reduce((a, c) => a + c.amount - c.settledAmount, 0);
    g.billed += billed;
    g.paid += paid;
    g.arrears += arrears;
    if (arrears > 0) g.students += 1;
    m.set(key, g);
  }
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
  const rows = [...m.values()]
    .map((r) => ({ ...r, pct: pct(r.arrears, r.billed) }))
    .sort((a, b) => CLASS_SHORTS.indexOf(a.classShort) - CLASS_SHORTS.indexOf(b.classShort) || a.classSection.localeCompare(b.classSection));
  const sum = (f: (r: FeeClassArrearsRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  return {
    campus: scope,
    session,
    today: DEMO_TODAY,
    rows,
    totals: { strength: sum((r) => r.strength), students: sum((r) => r.students), billed: sum((r) => r.billed), paid: sum((r) => r.paid), arrears: sum((r) => r.arrears), pct: pct(sum((r) => r.arrears), sum((r) => r.billed)) },
  };
}

/** For the report centre: the fee module's own defaulter rows. */
export const feeDefaulterRows = (scope: CampusScope, session: number, includeLeft: boolean, filter: DefaulterFilter = {}) => defaulterRows(scope, session, includeLeft, filter);

/* ================================================================== Candidate fees */

type Applicant = ReturnType<typeof admissionsStore.get>["applicants"][number];

function candidateRow(a: Applicant): FeeCandidate {
  const fee = a.fee!;
  const title = (code: string) => feeHeadByCode(code)?.title ?? code;
  const paid = fee.status === "PAID";
  const lines: FeeCandidateLine[] = (fee.lines ?? [{ head: "CANDIDATE", amount: fee.amount, paid: paid ? fee.amount : 0 }]).map((l) => ({ ...l, title: title(l.head) }));
  // Fees paid before the fee office recorded the cashier: the campus's counter staff (fictional).
  const hash = [...a.id].reduce((s, ch) => s + ch.charCodeAt(0), 0);
  const cashiers = CASHIERS[a.campus];
  return {
    id: a.id,
    applicationNo: a.applicationNo,
    name: a.name,
    father: a.father,
    classApplied: a.classApplied,
    campus: a.campus,
    campusName: a.campusName,
    appliedOn: a.appliedOn,
    ...(a.testDate ? { testDate: a.testDate } : {}),
    amount: lines.reduce((s, l) => s + l.amount, 0),
    status: fee.status,
    ...(fee.receiptNo ? { receiptNo: fee.receiptNo } : {}),
    ...(fee.paidOn ? { paidOn: fee.paidOn } : {}),
    lines,
    received: lines.reduce((s, l) => s + l.paid, 0),
    ...(paid ? { receivedBy: fee.receivedBy ?? cashiers[hash % cashiers.length]!, paymentMethod: fee.paymentMethod ?? "CASH" } : {}),
    ...(fee.bankChallanNo ? { bankChallanNo: fee.bankChallanNo } : {}),
    ...(fee.paidBy ? { paidBy: fee.paidBy } : {}),
  };
}

/** For the report centre: candidate fees paid in a period. */
export function feeCandidateRows(scope: CampusScope, session: number): FeeCandidate[] {
  const campuses = campusesIn(scope);
  return admissionsStore
    .get()
    .applicants.filter((a) => campuses.includes(a.campus) && a.session === session && a.fee && a.fee.amount > 0)
    .map(candidateRow);
}

/* ================================================================== Collections */

const SEQ_2025_END: Record<CampusCode, number> = { KC: 9910, SM: 3950, UC: 5230, MC: 2610, HC: 7480 };

function receiptsByDay(campus: CampusCode): Map<IsoDate, Receipt[]> {
  const m = new Map<IsoDate, Receipt[]>();
  for (const r of Object.values(feesStore.get().receipts)) {
    if (r.campus !== campus) continue;
    const d = r.postedAt.slice(0, 10);
    m.set(d, [...(m.get(d) ?? []), r]);
  }
  return m;
}

const nowMinutes = () => {
  const t = demoNow().slice(11, 16);
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
};

/** "Tuition fee – Nov 2026" → head TUITION, "Tuition fee", installment "Nov 2026". */
function splitLabel(label: string): Pick<FeeCollectionLine, "head" | "headTitle" | "installment"> {
  const code = headCodeOf(label);
  const h = feeHeadByCode(code);
  if (!h || code === "FINE" || code === "OTHER") return { head: code, headTitle: groupLabel(code), installment: label };
  const rest = label.startsWith(h.title) ? label.slice(h.title.length).replace(/^[\s–-]+/, "") : label;
  return { head: code, headTitle: h.title, installment: rest };
}

/** A fictional bank slip, cheque or transaction number for a carried-over receipt (same every time). */
function syntheticRef(method: string, key: string): string {
  let h = 2166136261;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const n = String((h >>> 0) % 900000 + 100000);
  return method === "BANK" ? `SL-${n}` : method === "CHEQUE" ? `CHQ-${n.slice(0, 6)}` : `RST-${n}`;
}

/** Every receipt of a campus for the days asked for: the system's own receipts plus the day's carried-over figure. */
function campusRows(campus: CampusCode, from: IsoDate, to: IsoDate): FeeCollectionRow[] {
  const f = figuresFor(campus, feesStore.get().postedToday[campus]);
  const real = receiptsByDay(campus);
  const taken = new Set(Object.keys(feesStore.get().receipts));
  const students = STUDENTS.filter((s) => live(s) && s.campus === campus && s.status === "ACTIVE").map((s) => ({ grNo: s.grNo, name: s.name, classSection: s.classSection }));
  const genders = new Map(STUDENTS.map((s) => [s.grNo, s.gender]));
  const prefix = campusOf(campus).docPrefix;
  const out: FeeCollectionRow[] = [];

  // Number the carried-over receipts backwards from the last number used, session by session.
  for (const session of [2026, 2025]) {
    const segFrom = session === 2026 ? "2026-04-01" : "2025-04-01";
    const segTo = session === 2026 ? DEMO_TODAY : "2026-03-31";
    if (to < segFrom || from > segTo) continue;
    let n = session === 2026 ? RECEIPT_SEQ_AT_START[campus] : SEQ_2025_END[campus];
    for (let d = segTo; d >= segFrom && d >= from; d = addDays(d, -1)) {
      if (!isSchoolDay(d)) continue;
      const fig = dayFigure(campus, d, f);
      const mine = real.get(d) ?? [];
      const realAmount = mine.reduce((a, r) => a + r.total, 0);
      const count = Math.max(0, fig.receipts - mine.length);
      const amount = Math.max(0, fig.amount - realAmount);
      const rows = syntheticRows(campus, d, amount > 0 ? Math.max(1, count) : 0, amount, students);
      const nums: number[] = [];
      for (let k = 0; k < rows.length; k++) {
        while (n > 1 && taken.has(formatReceiptNo(prefix, session, n))) n -= 1;
        nums.push(n);
        n = Math.max(1, n - 1);
      }
      if (d > to) continue;
      // Today: carried-over receipts fall between opening time and now.
      if (d === DEMO_TODAY) {
        const end = Math.max(500, Math.min(nowMinutes() - 5, 13 * 60 + 40));
        rows.forEach((r, i) => (r.minutes = 485 + Math.round(((i + 0.5) * (end - 485)) / Math.max(1, rows.length))));
      }
      nums.reverse();
      rows.forEach((r, i) => {
        if (r.amount <= 0) return;
        const hh = String(Math.floor(r.minutes / 60)).padStart(2, "0");
        const mm = String(r.minutes % 60).padStart(2, "0");
        out.push({
          receiptNo: formatReceiptNo(prefix, session, nums[i] ?? 1),
          at: `${d}T${hh}:${mm}:00+05:00`,
          campus,
          grNo: r.grNo,
          studentName: r.name,
          classSection: r.classSection,
          cashier: r.cashier,
          method: r.method,
          heads: r.fine > 0 ? `${r.head}, late fine` : r.head,
          fine: r.fine,
          amount: r.amount,
          status: "POSTED",
          openable: false,
          gender: genders.get(r.grNo) ?? "M",
          lines: [{ ...splitLabel(r.head), amount: r.amount - r.fine, fine: r.fine }],
          ...(r.method !== "CASH" ? { bankRef: syntheticRef(r.method, `${d}:${i}:${r.grNo}`) } : {}),
        });
      });
      for (const r of mine) {
        out.push({
          receiptNo: r.receiptNo,
          at: r.postedAt,
          campus,
          grNo: r.grNo,
          studentName: r.studentName,
          classSection: r.classSection,
          cashier: r.cashier,
          method: r.payment.method,
          heads: r.lines.map((l) => l.head).join(", ") + (r.lines.some((l) => l.lateFine > 0) ? ", late fine" : ""),
          fine: r.lines.reduce((a, l) => a + Math.min(l.lateFine, l.applied), 0),
          amount: r.total,
          status: r.status,
          openable: true,
          gender: genders.get(r.grNo) ?? "M",
          lines: r.lines.map((l) => ({ ...splitLabel(l.head), amount: Math.max(0, l.applied - l.lateFine), fine: Math.min(l.lateFine, l.applied) })),
          ...(r.payment.method === "BANK" ? { bankRef: r.payment.slipNo } : r.payment.method === "CHEQUE" ? { bankRef: r.payment.chequeNo } : r.payment.method === "ONLINE" ? { bankRef: r.payment.transactionId } : {}),
        });
      }
    }
  }
  return out;
}

/** For the report centre: every receipt in a period (the system's own and the carried-over figure), newest first. */
export function feeCollectionRows(scope: CampusScope, from: IsoDate, to: IsoDate): FeeCollectionRow[] {
  return campusesIn(scope)
    .flatMap((c) => campusRows(c, from, to))
    .sort((a, b) => b.at.localeCompare(a.at));
}
