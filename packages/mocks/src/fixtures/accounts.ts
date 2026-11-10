import { ACCOUNTS_VOUCHER_CODE, type AccountsBankInfo, type AccountsClass, type AccountsControl, type AccountsJournalLine, type AccountsKind, type AccountsVoucher, type AccountsVoucherType, type CampusCode } from "@mtb/api";
import { formatDate, sessionCode, type IsoDate, type IsoDateTime } from "@mtb/domain";
import { campusName } from "./campuses";
import { dayFigure, figuresFor } from "./fee-setup";

/*
 * Accounts fixtures (all fictional). One shared chart of accounts with campus as a dimension. Balances are never
 * stored: every figure comes from vouchers. The books for 2025–26 and 2026–27 up to yesterday are generated here,
 * deterministically, from the fee office's own daily collection figures (fixtures/fee-setup.ts), so the fee
 * reconciliation agrees with the fee office to the rupee. What people do in the demo lives in the handler's store.
 */

export const ACC_CAMPUSES: CampusCode[] = ["KC", "SM", "UC", "MC", "HC"];

/** Yesterday in the demo; the generated books run up to here. */
export const BOOKS_TO: IsoDate = "2026-11-03";

export interface AccountRecord {
  code: string;
  name: string;
  accountClass: AccountsClass;
  parentCode: string | null;
  postable: boolean;
  normalSide: "DEBIT" | "CREDIT";
  campus?: CampusCode;
  kind: AccountsKind;
  control?: AccountsControl;
  bank?: AccountsBankInfo;
  note?: string;
  active: boolean;
}

const CLASS_OF: Record<string, AccountsClass> = { "1": "ASSET", "2": "LIABILITY", "3": "EQUITY", "4": "INCOME", "5": "EXPENSE" };
const sideOf = (c: AccountsClass): "DEBIT" | "CREDIT" => (c === "ASSET" || c === "EXPENSE" ? "DEBIT" : "CREDIT");

const GROUPS: Array<[string, string]> = [
  ["1", "Assets"],
  ["11", "Cash and bank"],
  ["12", "Fixed assets"],
  ["13", "Advances and deposits"],
  ["2", "Liabilities"],
  ["21", "Current liabilities"],
  ["29", "Suspense"],
  ["3", "Equity"],
  ["31", "Capital and surplus"],
  ["4", "Income"],
  ["41", "Fee income"],
  ["42", "Other income"],
  ["5", "Expenses"],
  ["51", "Staff costs"],
  ["52", "Utilities"],
  ["53", "Administrative"],
  // A group kept in sub-groups (the third level of the old chart: class > group > sub-group > account).
  ["54", "Office running"],
  ["5401", "Office supplies"],
  ["5402", "Hospitality"],
];

/** A class has no parent; a group's parent is its class; a sub-group or account sits under its code less two digits. */
const parentOf = (code: string): string | null => (code.length === 1 ? null : code.length === 2 ? code.slice(0, 1) : code.slice(0, code.length - 2));

interface LeafSpec {
  code: string;
  name: string;
  campus?: CampusCode;
  kind?: AccountsKind;
  control?: AccountsControl;
  bank?: AccountsBankInfo;
  note?: string;
  normal?: "DEBIT" | "CREDIT";
  inactive?: boolean;
}

const LEAVES: LeafSpec[] = [
  { code: "1101", name: "Cash in hand", kind: "CASH", note: "Each campus's fee counter cash, deposited in the campus bank every weekday." },
  { code: "1102", name: "Meezan Bank — Sadiqabad", campus: "KC", kind: "BANK", bank: { bankName: "Meezan Bank", branch: "Sadiqabad branch", accountNoMasked: "•••• 4417" } },
  { code: "1103", name: "HBL — Sadiqabad", campus: "KC", kind: "BANK", bank: { bankName: "HBL", branch: "Sadiqabad Main branch", accountNoMasked: "•••• 0932" } },
  { code: "1104", name: "Allied Bank — Lahore", campus: "HC", kind: "BANK", bank: { bankName: "Allied Bank", branch: "Johar Town branch, Lahore", accountNoMasked: "•••• 7781" } },
  { code: "1105", name: "Bank Alfalah — Sugar Mill Campus", campus: "SM", kind: "BANK", bank: { bankName: "Bank Alfalah", branch: "Main branch", accountNoMasked: "•••• 2264" } },
  { code: "1106", name: "National Bank — Ubaid Campus", campus: "UC", kind: "BANK", bank: { bankName: "National Bank", branch: "Main branch", accountNoMasked: "•••• 5520" } },
  { code: "1107", name: "Bank Alfalah — Majeed Campus", campus: "MC", kind: "BANK", bank: { bankName: "Bank Alfalah", branch: "Main branch", accountNoMasked: "•••• 3108" } },
  { code: "1108", name: "Petty cash", kind: "CASH", note: "Small office expenses; topped up from cash in hand." },
  { code: "1201", name: "Land and buildings" },
  { code: "1202", name: "Furniture and fixtures" },
  { code: "1203", name: "Computers and IT equipment" },
  { code: "1204", name: "School vehicles" },
  { code: "1209", name: "Accumulated depreciation", normal: "CREDIT", note: "Reduces fixed assets; added to once a year." },
  { code: "1301", name: "Staff advances" },
  { code: "1302", name: "Utility security deposits paid" },
  { code: "2101", name: "Salaries payable", control: "PAYROLL", note: "Salaries owed for the month just ended; paid on the 5th." },
  { code: "2102", name: "Student security deposits (refundable)" },
  { code: "2103", name: "Fees received in advance" },
  { code: "2104", name: "Vendors payable" },
  { code: "2105", name: "Board fees collected (payable to the board)", control: "FEE_OFFICE", note: "New: board registration fees are held for the board, not counted as school income." },
  { code: "2901", name: "Legacy migration suspense", campus: "KC", normal: "DEBIT", note: "Net of 1,048 old-system vouchers where debit ≠ credit. Cleared only by approved adjustments." },
  { code: "3101", name: "Trust capital fund" },
  { code: "3102", name: "Accumulated surplus", note: "Each session's surplus is carried here when the session closes." },
  { code: "4101", name: "Tuition fee", control: "FEE_OFFICE" },
  { code: "4102", name: "Annual charges", control: "FEE_OFFICE" },
  { code: "4103", name: "Admission fee", control: "FEE_OFFICE" },
  { code: "4104", name: "Exam fee", control: "FEE_OFFICE" },
  { code: "4105", name: "Late payment fine", control: "FEE_OFFICE", note: "New: late fines get their own income account instead of the fee head." },
  { code: "4106", name: "Transport fee", control: "FEE_OFFICE" },
  { code: "4107", name: "Admission test fee", control: "FEE_OFFICE" },
  { code: "4108", name: "Discipline and exam fines", control: "FEE_OFFICE" },
  { code: "4201", name: "Bank profit" },
  { code: "4202", name: "Canteen rent" },
  { code: "4203", name: "Donations" },
  { code: "5101", name: "Salaries — teaching staff" },
  { code: "5102", name: "Salaries — non-teaching staff" },
  { code: "5201", name: "Electricity" },
  { code: "5202", name: "Gas" },
  { code: "5203", name: "Water" },
  { code: "5204", name: "Telephone and internet" },
  { code: "5302", name: "Repairs and maintenance" },
  { code: "5303", name: "SMS charges" },
  { code: "5304", name: "Bank charges" },
  { code: "5305", name: "Depreciation" },
  { code: "5306", name: "Fuel and vehicle running" },
  { code: "5307", name: "Examination expenses" },
  { code: "5308", name: "Sports and events" },
  { code: "5309", name: "Generator rent", inactive: true, note: "Not used since the campuses bought their own generators." },
  { code: "540101", name: "Stationery and printing" },
  { code: "540102", name: "Postage and courier" },
  { code: "540201", name: "Refreshments and hospitality" },
];

export function initialChart(): AccountRecord[] {
  const groups: AccountRecord[] = GROUPS.map(([code, name]) => {
    const accountClass = CLASS_OF[code[0] ?? "1"] ?? "ASSET";
    return { code, name, accountClass, parentCode: parentOf(code), postable: false, normalSide: sideOf(accountClass), kind: "OTHER", active: true };
  });
  const leaves: AccountRecord[] = LEAVES.map((l) => {
    const accountClass = CLASS_OF[l.code[0] ?? "1"] ?? "ASSET";
    return {
      code: l.code,
      name: l.name,
      accountClass,
      parentCode: parentOf(l.code),
      postable: true,
      normalSide: l.normal ?? sideOf(accountClass),
      kind: l.kind ?? "OTHER",
      ...(l.campus ? { campus: l.campus } : {}),
      ...(l.control ? { control: l.control } : {}),
      ...(l.bank ? { bank: l.bank } : {}),
      ...(l.note ? { note: l.note } : {}),
      active: !l.inactive,
    };
  });
  return [...groups, ...leaves];
}

/* ================================================================== Campus figures */

/** Each campus's main bank (fees, deposits, bills). */
export const MAIN_BANK: Record<CampusCode, string> = { KC: "1102", SM: "1105", UC: "1106", MC: "1107", HC: "1104" };
const BANK_SHORT: Record<string, string> = { "1102": "Meezan Bank", "1103": "HBL", "1104": "Allied Bank", "1105": "Bank Alfalah", "1106": "National Bank", "1107": "Bank Alfalah" };
const SLIP_PREFIX: Record<string, string> = { "1102": "MZ", "1103": "HBL", "1104": "ABL", "1105": "BAF", "1106": "NBP", "1107": "BAF" };
/** Last cheque number used from each main bank's cheque book before the demo's own vouchers (KC 004512 is in a draft). */
const CHEQUE_LAST: Record<string, number> = { "1102": 4511, "1104": 118802, "1105": 220415, "1106": 560271, "1107": 331046 };
const SLIP_LAST: Record<string, number> = { "1102": 80214, "1104": 51630, "1105": 22981, "1106": 70442, "1107": 11873 };
const ELECTRIC_CO: Record<CampusCode, string> = { KC: "MEPCO", SM: "MEPCO", UC: "MEPCO", MC: "MEPCO", HC: "LESCO" };

/** Smaller campuses scaled from Khalid Campus figures (close to each campus's monthly fee target). */
const SCALE: Record<CampusCode, number> = { KC: 1, SM: 0.47, UC: 0.57, MC: 0.31, HC: 0.82 };

/** Cash kept at the counter overnight; everything above it is deposited the next weekday morning. */
const FLOAT = 50000;

/* ================================================================== Small helpers */

const toUtc = (d: IsoDate) => new Date(`${d}T00:00:00Z`);
export const addDaysIso = (d: IsoDate, n: number): IsoDate => {
  const x = toUtc(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
export const weekdayOf = (d: IsoDate) => toUtc(d).getUTCDay(); // 0 = Sunday
export const monthEndIso = (month: string): IsoDate => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y ?? 2026, m ?? 1, 0)).toISOString().slice(0, 10);
};
/** April to March: ["2026-04", … "2027-03"]. */
export function sessionMonths(session: number): string[] {
  return Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(session, 3 + i, 1)).toISOString().slice(0, 7));
}
export const sessionStart = (session: number): IsoDate => `${session}-04-01`;
export const sessionEnd = (session: number): IsoDate => `${session + 1}-03-31`;
export const sessionOfDate = (d: IsoDate) => (Number(d.slice(5, 7)) >= 4 ? Number(d.slice(0, 4)) : Number(d.slice(0, 4)) - 1);
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthLong = (month: string) => `${MONTH_LONG[Number(month.slice(5, 7)) - 1] ?? ""} ${month.slice(0, 4)}`;
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthShortName = (month: string) => `${MONTH_SHORT[Number(month.slice(5, 7)) - 1] ?? ""} ${month.slice(0, 4)}`;
const nextMonth = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 7);
const prevMonth = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
/** The given day of a month, moved to Monday when it falls on a Sunday. */
const dayIn = (month: string, day: number): IsoDate => {
  const d = `${month}-${String(day).padStart(2, "0")}`;
  return weekdayOf(d) === 0 ? addDaysIso(d, 1) : d;
};
const r50 = (n: number) => Math.round(n / 50) * 50;
const r10 = (n: number) => Math.round(n / 10) * 10;
const r100 = (n: number) => Math.round(n / 100) * 100;

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

export const voucherNoOf = (campus: CampusCode, type: AccountsVoucherType, session: number, seq: number) => `${campus}-${ACCOUNTS_VOUCHER_CODE[type]}-${sessionCode(session)}-${String(seq).padStart(6, "0")}`;

/* ================================================================== Fee heads → accounts (posting rules) */

export interface PostingRuleRecord {
  head: string;
  title: string;
  category: "FEE" | "FINE" | "APPLICATION";
  accountCode: string;
  note?: string;
}

export const DEFAULT_POSTING_RULES: PostingRuleRecord[] = [
  { head: "TUITION", title: "Tuition fee", category: "FEE", accountCode: "4101" },
  { head: "ANNUAL", title: "Annual charges", category: "FEE", accountCode: "4102" },
  { head: "EXAM", title: "Exam fee", category: "FEE", accountCode: "4104" },
  { head: "BOARD", title: "Board registration fee", category: "FEE", accountCode: "2105", note: "Held for the board, paid on in December." },
  { head: "ADMISSION", title: "Admission fee", category: "FEE", accountCode: "4103" },
  { head: "TRANSPORT", title: "Transport fee", category: "FEE", accountCode: "4106" },
  { head: "CANDIDATE", title: "Candidate (test) fee", category: "APPLICATION", accountCode: "4107" },
  { head: "LATE_FINE", title: "Late payment fine", category: "FINE", accountCode: "4105" },
  { head: "FINE_OTHER", title: "Exam absence and discipline fines", category: "FINE", accountCode: "4108" },
];

/** How a day's collection splits over fee heads (more admissions in April, annual charges in September …). */
export function headSplit(campus: CampusCode, date: IsoDate, amount: number): Array<[string, number]> {
  const rand = seeded(`heads:${campus}:${date}`);
  const m = date.slice(5, 7);
  const day = Number(date.slice(8, 10));
  const j = () => 0.85 + rand() * 0.3;
  const share: Record<string, number> = {
    ANNUAL: (m === "09" ? 0.24 : m === "08" ? 0.08 : m === "10" ? 0.05 : 0.01) * j(),
    EXAM: (["09", "10", "02", "03"].includes(m) ? 0.04 : 0.008) * j(),
    BOARD: (["10", "11"].includes(m) ? 0.028 : 0) * j(),
    ADMISSION: (m === "04" ? 0.1 : m === "05" ? 0.05 : 0.012) * j(),
    TRANSPORT: 0.07 * j(),
    CANDIDATE: (["03", "04"].includes(m) ? 0.02 : 0.002) * j(),
    LATE_FINE: (day > 10 ? 0.022 : 0.004) * j(),
    FINE_OTHER: 0.002 * j(),
  };
  const parts: Array<[string, number]> = Object.entries(share).map(([h, s]) => [h, h === "LATE_FINE" ? r10(amount * s) : r50(amount * s)]);
  const others = parts.reduce((a, [, v]) => a + v, 0);
  return [["TUITION", amount - others], ...parts.filter(([, v]) => v > 0)];
}

/** Cash taken at the counter; the rest (bank challans, online, cheques) goes straight to the campus bank. */
export function cashShare(campus: CampusCode, date: IsoDate, amount: number): number {
  const rand = seeded(`cash:${campus}:${date}`);
  return Math.min(amount, r50(amount * (0.66 + rand() * 0.08)));
}

/** Receipts entered at the counter after the day had closed: the fee office total is higher than the posted batch. */
export const FEE_LATE_ENTRIES: Array<{ campus: CampusCode; date: IsoDate; amount: number; head: string; note: string }> = [
  { campus: "KC", date: "2026-10-28", amount: 7500, head: "TUITION", note: "One bank challan (Rs 7,500) was entered at the counter on 29-Oct-2026, after the day had closed, so the day's batch was posted without it." },
];

/** The fee office's figures for a day, before anything is posted in this demo (stable for past days). */
export function feeOfficeDay(campus: CampusCode, date: IsoDate) {
  return dayFigure(campus, date, figuresFor(campus, undefined));
}

/* ================================================================== Opening balances */

/** Salaries a month at a campus (2025–26 about 7% lower). */
export function salariesFor(campus: CampusCode, session: number): { teaching: number; other: number } {
  const s = SCALE[campus] * (session >= 2026 ? 1 : 0.93);
  return { teaching: Math.round((3850000 * s) / 1000) * 1000, other: Math.round((960000 * s) / 1000) * 1000 };
}

/** 1-Apr-2025, as migrated from the old system (session 2025–26 is the first session kept in full). */
function opening2025(campus: CampusCode): Map<string, number> {
  const s = SCALE[campus];
  const sal = salariesFor(campus, 2025);
  const m = new Map<string, number>([
    ["1101", r100(95000 * s)],
    [MAIN_BANK[campus], r100(8650000 * s)],
    ["1108", r100(20000 * s)],
    ["1201", r100(38500000 * s)],
    ["1202", r100(3400000 * s)],
    ["1203", r100(2650000 * s)],
    ["1204", r100(7200000 * s)],
    ["1209", -r100(6850000 * s)],
    ["1301", r100(165000 * s)],
    ["1302", r100(240000 * s)],
    ["2101", -(sal.teaching + sal.other)],
    ["2102", -r100(1120000 * s)],
    ["2103", -r100(610000 * s)],
    ["2104", -r100(245000 * s)],
    ["3101", -r100(25000000 * s)],
  ]);
  if (campus === "KC") {
    m.set("1103", 2180000);
    m.set("2901", 74180);
  }
  const sum = [...m.values()].reduce((a, b) => a + b, 0);
  m.set("3102", -sum);
  return m;
}

/* ================================================================== Generated books */

interface Item {
  date: IsoDate;
  order: number;
  type: AccountsVoucherType;
  narration: string;
  lines: Array<[string, string, number, number]>; // account, description, debit, credit
  cashBank?: string;
  party?: string;
  reference?: string;
  cheque?: { number: string; date: IsoDate };
  source?: AccountsVoucher["source"];
  /** Bank vouchers: a cheque number is taken from the bank's cheque book. */
  needsCheque?: string;
  /** Cash deposits: a slip number from the bank. */
  needsSlip?: string;
  auto?: boolean;
}

const PETTY: Array<[string, string, string]> = [
  ["540101", "Stationery for the office", "Al-Madina Stationers"],
  ["540201", "Tea and refreshments, staff meeting", "Campus canteen"],
  ["540102", "Courier charges, board documents", "TCS Express"],
  ["5302", "Plumber: washroom taps replaced", "Local plumber"],
  ["540101", "Photocopies of monthly test papers", "Al-Madina Stationers"],
  ["540201", "Refreshments for parent-teacher meeting", "Campus canteen"],
  ["5302", "Electrician: fans and switches repaired", "Local electrician"],
];

const REPAIRS: Array<[string, string]> = [
  ["Generator service and oil change", "Al-Noor Electric"],
  ["Classroom whiteboards replaced", "Al-Madina Stationers"],
  ["Roof leak repaired before the rains", "Builders and Co."],
  ["School van tyres and service", "Rehman Autos"],
  ["Water cooler repair", "Cool Point Services"],
  ["Paint for the main corridor", "Paint House"],
];

const ELECTRIC: Record<string, number> = { "04": 210000, "05": 320000, "06": 420000, "07": 445000, "08": 410000, "09": 330000, "10": 186500, "11": 120000, "12": 110000, "01": 115000, "02": 118000, "03": 150000 };
const GAS: Record<string, number> = { "04": 18000, "05": 12000, "06": 9000, "07": 9000, "08": 9500, "09": 11000, "10": 21500, "11": 38000, "12": 62000, "01": 71000, "02": 55000, "03": 30000 };

export interface GeneratedBooks {
  vouchers: AccountsVoucher[];
  /** Last number used per type ("JV" → 213). */
  seq: Partial<Record<AccountsVoucherType, number>>;
  opening: Map<string, number>;
}

const booksCache = new Map<string, GeneratedBooks>();

/** The books of one campus for one session, up to yesterday for the current session. */
export function generatedBooks(campus: CampusCode, session: number): GeneratedBooks {
  const key = `${campus}:${session}`;
  const hit = booksCache.get(key);
  if (hit) return hit;
  const opening = session <= 2025 ? opening2025(campus) : closingOf(campus, session - 1);
  const books = generate(campus, session, opening);
  booksCache.set(key, books);
  return books;
}

/** Balance-sheet balances at a session's end, with the session's surplus carried to accumulated surplus. */
function closingOf(campus: CampusCode, session: number): Map<string, number> {
  const prev = generatedBooks(campus, session);
  const net = new Map(prev.opening);
  for (const v of prev.vouchers) {
    if (v.type === "OPENING") continue;
    for (const l of v.lines) net.set(l.accountCode, (net.get(l.accountCode) ?? 0) + l.debit - l.credit);
  }
  const out = new Map<string, number>();
  let surplus = 0;
  for (const [code, n] of net) {
    if (code[0] === "4" || code[0] === "5") surplus += n;
    else if (n !== 0) out.set(code, n);
  }
  out.set("3102", (out.get("3102") ?? 0) + surplus);
  return out;
}

function generate(campus: CampusCode, session: number, opening: Map<string, number>): GeneratedBooks {
  const start = sessionStart(session);
  const end = session >= 2026 ? BOOKS_TO : sessionEnd(session);
  const s = SCALE[campus] * (session >= 2026 ? 1 : 0.94);
  const bank = MAIN_BANK[campus];
  const bankName = BANK_SHORT[bank] ?? "the bank";
  const rand = seeded(`books:${campus}:${session}`);
  const items: Item[] = [];
  const months = sessionMonths(session).filter((m) => `${m}-01` <= end);
  const sal = salariesFor(campus, session);

  // All calendar days of the range, and the weekdays (deposit days).
  const days: IsoDate[] = [];
  for (let d = start; d <= end; d = addDaysIso(d, 1)) days.push(d);
  const weekdays = days.filter((d) => weekdayOf(d) >= 1 && weekdayOf(d) <= 5);

  // ---- Monthly items (dated; cash effects tracked in the day loop below)
  for (const month of months) {
    const mm = month.slice(5, 7);
    const mEnd = monthEndIso(month);
    const isVacation = mm === "06" || mm === "07";
    const kcOct = campus === "KC" && month === "2026-10";
    const prev = prevMonth(month);
    const paySal = salariesFor(campus, sessionOfDate(`${prev}-01`));

    // Salaries for the previous month, paid by bank transfer on the 5th.
    items.push({
      date: dayIn(month, 5),
      order: 2,
      type: "BP",
      narration: `Salaries for ${monthLong(prev)} paid by bank transfer`,
      lines: [["2101", `Salaries for ${monthLong(prev)}`, paySal.teaching + paySal.other, 0]],
      cashBank: bank,
      party: "Staff salary accounts (transfer list)",
      cheque: { number: `Transfer list ${prev.slice(5, 7)}/${prev.slice(0, 4)}`, date: dayIn(month, 5) },
    });
    // Fuel for the school vans.
    items.push({
      date: dayIn(month, 3),
      order: 2,
      type: "BP",
      narration: `Diesel for school vans, ${monthLong(month)}`,
      lines: [["5306", "Fleet card statement", r100((isVacation ? 40000 : 135000) * s), 0]],
      cashBank: bank,
      party: "PSO fleet card account",
      needsCheque: bank,
    });
    // Telephone and internet.
    items.push({
      date: dayIn(month, 8),
      order: 2,
      type: "BP",
      narration: `Telephone and internet, ${monthLong(month)}`,
      lines: [["5204", "PTCL bill", r100(18500 * Math.max(0.5, s)), 0]],
      cashBank: bank,
      party: "PTCL",
      needsCheque: bank,
    });
    if (!kcOct) {
      items.push({
        date: dayIn(month, 12),
        order: 2,
        type: "BP",
        narration: `Electricity bill, ${monthLong(month)} (${ELECTRIC_CO[campus]})`,
        lines: [["5201", `${ELECTRIC_CO[campus]} bill`, r50((ELECTRIC[mm] ?? 150000) * s), 0]],
        cashBank: bank,
        party: ELECTRIC_CO[campus],
        needsCheque: bank,
      });
      items.push({
        date: dayIn(month, 14),
        order: 2,
        type: "BP",
        narration: `Gas bill, ${monthLong(month)} (SNGPL)`,
        lines: [["5202", "SNGPL bill", r50((GAS[mm] ?? 15000) * s), 0]],
        cashBank: bank,
        party: "SNGPL",
        needsCheque: bank,
      });
    }
    items.push({
      date: dayIn(month, 16),
      order: 2,
      type: "BP",
      narration: `Water charges, ${monthLong(month)}`,
      lines: [["5203", "Municipal water bill", r50(7000 * Math.max(0.5, s)), 0]],
      cashBank: bank,
      party: "TMA water account",
      needsCheque: bank,
    });
    const [repWhat, repWho] = REPAIRS[Math.floor(rand() * REPAIRS.length)]!;
    items.push({
      date: dayIn(month, 20),
      order: 2,
      type: "BP",
      narration: repWhat,
      lines: [["5302", `Invoice ${1000 + Math.floor(rand() * 8999)}`, r100((25000 + rand() * 35000) * s), 0]],
      cashBank: bank,
      party: repWho,
      needsCheque: bank,
    });
    items.push({
      date: dayIn(month, 29 > Number(mEnd.slice(8)) ? 28 : 29),
      order: 2,
      type: "BP",
      narration: `SMS charges, ${monthLong(month)}`,
      lines: [["5303", "SMS gateway invoice", r100((9000 + rand() * 3000) * Math.max(0.5, s)), 0]],
      cashBank: bank,
      party: "SMS gateway provider",
      needsCheque: bank,
    });
    if (mm === "09" || mm === "03" || mm === "12") {
      items.push({
        date: dayIn(month, 6),
        order: 2,
        type: "BP",
        narration: `Printing of question papers, ${mm === "09" ? "First Term" : mm === "12" ? "Second Term" : "Annual"} exams`,
        lines: [["5307", "Printing invoice", r100((45000 + rand() * 15000) * s), 0]],
        cashBank: bank,
        party: "Al-Noor Printers",
        needsCheque: bank,
      });
    }
    if (mm === "08") {
      items.push({
        date: dayIn(month, 13),
        order: 2,
        type: "BP",
        narration: "Independence Day function: stage, sound and flags",
        lines: [["5308", "Event invoice", r100(35000 * s), 0]],
        cashBank: bank,
        party: "Star Events",
        needsCheque: bank,
      });
    }
    if (mm === "12" && session === 2025) {
      items.push({
        date: dayIn(month, 15),
        order: 2,
        type: "BP",
        narration: "Board registration fees paid to the board, 2025–26",
        lines: [["2105", "Class 9 and 10 registrations", 0, 0]], // amount filled from the board fees collected
        cashBank: bank,
        party: "Board of Intermediate and Secondary Education",
        needsCheque: bank,
      });
    }
    if (!isVacation) {
      items.push({
        date: dayIn(month, 2),
        order: 3,
        type: "CR",
        narration: `Canteen rent for ${monthLong(month)}`,
        lines: [["4202", "Monthly rent", 0, r100(45000 * s)]],
        cashBank: "1101",
        party: "Shahid Foods (canteen contractor)",
        reference: `Rent receipt ${month.slice(5, 7)}/${month.slice(0, 4)}`,
      });
    }
    if (mEnd <= end) {
      items.push({
        date: mEnd,
        order: 6,
        type: "JV",
        narration: `Salaries for ${monthLong(month)}`,
        lines: [
          ["5101", `Teaching staff, ${monthShortName(month)}`, sal.teaching, 0],
          ["5102", `Non-teaching staff, ${monthShortName(month)}`, sal.other, 0],
          ["2101", `Payable on ${formatDate(dayIn(nextMonth(month), 5))}`, 0, sal.teaching + sal.other],
        ],
      });
      const charges = r10((1800 + rand() * 800) * Math.max(0.6, s));
      items.push({
        date: mEnd,
        order: 6,
        type: "JV",
        narration: `Bank charges for ${monthLong(month)}, ${bankName}`,
        lines: [
          ["5304", "As per bank statement", charges, 0],
          [bank, "Charged by the bank", 0, charges],
        ],
      });
      if (!kcOct) {
        const profit = r10((32000 + rand() * 9000) * s);
        items.push({
          date: mEnd,
          order: 7,
          type: "BR",
          narration: `Profit for ${monthLong(month)} credited by ${bankName}`,
          lines: [["4201", "Profit on deposit account", 0, profit]],
          cashBank: bank,
          party: bankName,
          cheque: { number: "Bank credit", date: mEnd },
        });
      }
      if (campus === "KC") {
        const p = r10(13000 + rand() * 3000);
        items.push({
          date: mEnd,
          order: 7,
          type: "BR",
          narration: `Profit for ${monthLong(month)} credited by HBL`,
          lines: [["4201", "Profit on term deposit", 0, p]],
          cashBank: "1103",
          party: "HBL",
          cheque: { number: "Bank credit", date: mEnd },
        });
      }
    }
  }

  // One-off purchases.
  const capital: Array<[CampusCode, number, IsoDate, string, string, string, number]> = [
    ["KC", 2026, "2026-07-20", "1203", "Twelve computers for the computer lab", "Techno Computers", 1560000],
    ["HC", 2026, "2026-08-18", "1202", "Desks and chairs for two new classrooms", "Lahore Furniture House", 640000],
    ["KC", 2025, "2025-08-12", "1204", "School van (Hiace) for the Sadiqabad route", "Rehman Autos", 3450000],
    ["UC", 2025, "2025-11-10", "1202", "Library shelves and reading tables", "Wood Craft", 380000],
  ];
  for (const [c, sess, date, acc, what, who, amt] of capital) {
    if (c === campus && sess === session && date <= end) {
      items.push({ date, order: 2, type: "BP", narration: what, lines: [[acc, `Invoice, ${who}`, amt, 0]], cashBank: bank, party: who, needsCheque: bank });
    }
  }
  if (session === 2025 && end === sessionEnd(2025)) {
    const o = opening;
    const dep = [
      ["1201", 0.025],
      ["1202", 0.1],
      ["1203", 0.25],
      ["1204", 0.15],
    ] as const;
    const total = dep.reduce((a, [code, rate]) => a + r100((o.get(code) ?? 0) * rate), 0);
    items.push({
      date: sessionEnd(2025),
      order: 6,
      type: "JV",
      narration: "Depreciation for 2025–26: buildings 2.5%, furniture 10%, computers 25%, vehicles 15%",
      lines: [
        ["5305", "Charge for the year", total, 0],
        ["1209", "Added to accumulated depreciation", 0, total],
      ],
    });
  }

  // ---- Petty cash top-ups (journal vouchers) and the petty expenses paid from them.
  const baseJv = weekdays.length + items.filter((i) => i.type === "JV").length;
  const isKcNow = campus === "KC" && session === 2026 && end === BOOKS_TO;
  const mondays = weekdays.filter((d) => weekdayOf(d) === 1);
  // Khalid Campus's last journal voucher before the demo is KC-JV-2627-000213 (the demo posts 000214).
  const topUpCount = isKcNow ? Math.max(0, 213 - baseJv) : mondays.length;
  const topUpDays = new Set<IsoDate>();
  for (let i = 0; i < topUpCount; i++) topUpDays.add(weekdays[Math.min(weekdays.length - 1, Math.floor(((i + 0.5) * weekdays.length) / Math.max(1, topUpCount)))]!);
  const topUp = r100(Math.max(4000, 10000 * s));
  let pettyIdx = 0;
  const pettySpend = new Map<IsoDate, Array<[string, string, string, number]>>();
  for (const d of topUpDays) {
    const later = weekdays.filter((w) => w > d).slice(0, 3);
    const a1 = r50(topUp * (0.52 + rand() * 0.08));
    const a2 = r50(topUp * (0.4 + rand() * 0.06));
    for (const [i, amt] of [a1, a2].entries()) {
      const when = later[i] ?? d;
      const p = PETTY[pettyIdx++ % PETTY.length]!;
      pettySpend.set(when, [...(pettySpend.get(when) ?? []), [p[0], p[1], p[2], amt]]);
    }
  }

  // ---- The day loop: deposits in the morning, fee batches in the evening.
  let cash = opening.get("1101") ?? 0;
  const byDate = new Map<IsoDate, Item[]>();
  for (const it of items) byDate.set(it.date, [...(byDate.get(it.date) ?? []), it]);
  const out: Item[] = [];
  let lastCollection: IsoDate | null = null;
  let boardCollected = 0;
  for (const d of days) {
    const wd = weekdayOf(d);
    if (wd >= 1 && wd <= 5 && cash > FLOAT) {
      const amount = cash - FLOAT;
      out.push({
        date: d,
        order: 0,
        type: "JV",
        narration: `Cash deposited in ${bankName}`,
        lines: [
          [bank, lastCollection ? `Cash collected up to ${formatDate(lastCollection)}` : "Cash in hand brought forward", amount, 0],
          ["1101", "Deposit slip", 0, amount],
        ],
        needsSlip: bank,
      });
      cash -= amount;
    }
    if (topUpDays.has(d)) {
      out.push({ date: d, order: 1, type: "JV", narration: "Petty cash topped up from cash in hand", lines: [["1108", "Petty cash imprest", topUp, 0], ["1101", "Cash in hand", 0, topUp]] });
      cash -= topUp;
    }
    for (const [acc, what, who, amt] of pettySpend.get(d) ?? []) {
      out.push({ date: d, order: 2, type: "CP", narration: what, lines: [[acc, "Paid from petty cash", amt, 0]], cashBank: "1108", party: who, reference: `Bill ${100 + Math.floor(rand() * 900)}` });
    }
    for (const it of byDate.get(d) ?? []) {
      if (it.lines[0]?.[0] === "2105") {
        if (boardCollected <= 0) continue;
        it.lines[0] = ["2105", it.lines[0][1], boardCollected, 0];
        boardCollected = 0;
      }
      out.push(it);
      if (it.cashBank === "1101") cash += it.lines.reduce((a, l) => a + l[3] - l[2], 0);
    }
    // Evening: the day's fee collection, posted automatically when the counter closes.
    const fig = weekdayOf(d) === 0 ? { amount: 0, receipts: 0 } : feeOfficeDay(campus, d);
    if (fig.amount > 0) {
      const late = FEE_LATE_ENTRIES.find((e) => e.campus === campus && e.date === d);
      const amount = fig.amount - (late?.amount ?? 0);
      const cashPart = cashShare(campus, d, fig.amount);
      const bankPart = amount - cashPart;
      const heads = headSplit(campus, d, fig.amount).map(([h, v]) => [h, h === late?.head ? v - late.amount : v] as [string, number]);
      const rule = new Map(DEFAULT_POSTING_RULES.map((r) => [r.head, r.accountCode]));
      const credit = new Map<string, number>();
      for (const [h, v] of heads) {
        const acc = rule.get(h) ?? "4101";
        credit.set(acc, (credit.get(acc) ?? 0) + v);
        if (h === "BOARD") boardCollected += v;
      }
      out.push({
        date: d,
        order: 5,
        type: "FEE",
        narration: `Fee collection ${formatDate(d)}: ${fig.receipts} receipts`,
        lines: [
          ["1101", "Cash at the counter", cashPart, 0],
          [bank, "Bank challans, online payments and cheques", bankPart, 0],
          ...[...credit.entries()].map(([acc, v]) => [acc, "Fee office daily total", 0, v] as [string, string, number, number]),
        ],
        source: { kind: "FEE_BATCH", date: d, receipts: fig.receipts },
        auto: true,
      });
      cash += cashPart;
      lastCollection = d;
    }
  }

  // ---- Opening balances voucher.
  const openingLines: Item["lines"] = [...opening.entries()]
    .filter(([, n]) => n !== 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, n]) => [code, "Brought forward", n > 0 ? n : 0, n < 0 ? -n : 0]);
  out.unshift({
    date: start,
    order: -1,
    type: "OPENING",
    narration: session <= 2025 ? "Opening balances for 2025–26, as migrated from the old system" : `Opening balances for ${session}–${String(session + 1).slice(2)}, carried forward from ${session - 1}–${String(session).slice(2)}`,
    lines: openingLines,
    source: { kind: "OPENING" },
    auto: true,
  });

  // ---- Numbers: per type, in date order. Cheque and slip numbers count back from each bank's last used number.
  out.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  const seq: Partial<Record<AccountsVoucherType, number>> = {};
  const chequeItems = out.filter((i) => i.needsCheque);
  const slipItems = out.filter((i) => i.needsSlip);
  chequeItems.forEach((it, i) => {
    const last = CHEQUE_LAST[it.needsCheque!] ?? 100000;
    const n = last - (chequeItems.length - 1 - i) - (session < 2026 ? 400 : 0);
    it.cheque = { number: String(n).padStart(6, "0"), date: it.date };
  });
  slipItems.forEach((it, i) => {
    const last = SLIP_LAST[it.needsSlip!] ?? 10000;
    const n = last - (slipItems.length - 1 - i) - (session < 2026 ? 900 : 0);
    const slip = `${SLIP_PREFIX[it.needsSlip!] ?? "SL"}-${n}`;
    it.narration = `${it.narration} (slip ${slip})`;
    it.reference = slip;
  });

  const vouchers = out.map((it): AccountsVoucher => {
    const n = (seq[it.type] ?? 0) + 1;
    seq[it.type] = n;
    return toVoucher(campus, session, it, n);
  });
  return { vouchers, seq, opening };
}

const PREPARER = "Nadia Shah";
const APPROVER = "Kamran Yousaf";
const SYSTEM = "Fee office (automatic)";

function toVoucher(campus: CampusCode, session: number, it: Item, n: number): AccountsVoucher {
  const voucherNo = voucherNoOf(campus, it.type, session, n);
  const id = `g-${voucherNo}`;
  let lines: AccountsJournalLine[] = it.lines.map(([accountCode, description, debit, credit], i) => ({ id: `l${i + 1}`, accountCode, description, debit, credit }));
  // Cash and bank vouchers: the cash or bank side is one contra line.
  if (it.cashBank && ["CP", "CR", "BP", "BR"].includes(it.type)) {
    const other = lines.reduce((a, l) => a + l.debit - l.credit, 0);
    lines = [...lines, { id: `l${lines.length + 1}`, accountCode: it.cashBank, description: it.party ?? "", debit: other < 0 ? -other : 0, credit: other > 0 ? other : 0, contra: true }];
  }
  const at = (h: string): IsoDateTime => `${it.date}T${h}:00+05:00`;
  const manual = !it.auto;
  const needsApproval = ["CP", "CR", "BP", "BR"].includes(it.type);
  const history: AccountsVoucher["history"] = it.auto
    ? [{ action: "POSTED", by: it.type === "OPENING" ? "System" : SYSTEM, at: at(it.type === "OPENING" ? "00:05" : "18:00") }]
    : [
        { action: "CREATED", by: PREPARER, at: at("10:10") },
        ...(needsApproval
          ? [
              { action: "SUBMITTED" as const, by: PREPARER, at: at("10:25") },
              { action: "APPROVED" as const, by: APPROVER, at: at("12:40") },
            ]
          : []),
        { action: "POSTED", by: PREPARER, at: at("15:30") },
      ];
  return {
    id,
    type: it.type,
    voucherNo,
    campus,
    campusName: campusName(campus),
    session,
    date: it.date,
    narration: it.narration,
    lines,
    status: "POSTED",
    totalDebit: lines.reduce((a, l) => a + l.debit, 0),
    totalCredit: lines.reduce((a, l) => a + l.credit, 0),
    ...(it.cashBank && needsApproval ? { cashBankAccount: it.cashBank } : {}),
    ...(it.party ? { party: it.party } : {}),
    ...(it.reference ? { reference: it.reference } : {}),
    ...(it.cheque ? { cheque: it.cheque } : {}),
    createdBy: it.auto ? (it.type === "OPENING" ? "System" : SYSTEM) : PREPARER,
    updatedAt: history[history.length - 1]!.at,
    ...(needsApproval && manual ? { submittedBy: PREPARER, submittedAt: at("10:25"), approvedBy: APPROVER, approvedAt: at("12:40") } : {}),
    postedBy: it.auto ? (it.type === "OPENING" ? "System" : SYSTEM) : PREPARER,
    postedAt: history[history.length - 1]!.at,
    system: Boolean(it.auto),
    ...(it.source ? { source: it.source } : {}),
    history,
  };
}

/* ================================================================== The demo's own vouchers (in the store) */

const line = (id: string, accountCode: string, description: string, debit: number, credit: number, contra?: boolean): AccountsJournalLine => ({ id, accountCode, description, debit, credit, ...(contra ? { contra } : {}) });

function voucher(v: Omit<AccountsVoucher, "campusName" | "totalDebit" | "totalCredit" | "session" | "system"> & { session?: number }): AccountsVoucher {
  return {
    ...v,
    session: v.session ?? 2026,
    campusName: campusName(v.campus),
    totalDebit: v.lines.reduce((a, l) => a + l.debit, 0),
    totalCredit: v.lines.reduce((a, l) => a + l.credit, 0),
    system: false,
  };
}

export function initialVouchers(): AccountsVoucher[] {
  return [
    // Flow 2: a draft that is Rs 1,500 out of balance. The gas bill was Rs 21,500, typed as Rs 23,000.
    voucher({
      id: "jv-draft-1",
      type: "JV",
      voucherNo: null,
      campus: "KC",
      date: "2026-11-04",
      narration: "Utility bills for October 2026 paid by Meezan Bank cheque 004512",
      lines: [line("l1", "5201", "Electricity bill, October 2026 (MEPCO)", 186500, 0), line("l2", "5202", "Gas bill, October 2026 (SNGPL)", 23000, 0), line("l3", "1102", "Cheque 004512", 0, 208000)],
      status: "DRAFT",
      createdBy: "Nadia Shah",
      updatedAt: "2026-11-04T09:40:00+05:00",
      history: [{ action: "CREATED", by: "Nadia Shah", at: "2026-11-04T09:40:00+05:00" }],
    }),
    // Waiting for the admin's approval.
    voucher({
      id: "vch-kc-bp-results",
      type: "BP",
      voucherNo: null,
      campus: "KC",
      date: "2026-11-03",
      narration: "Printing of First Term result cards",
      lines: [line("l1", "5307", "Invoice 1187: 1,400 result cards", 38500, 0), line("l2", "1102", "Al-Noor Printers", 0, 38500, true)],
      cashBankAccount: "1102",
      party: "Al-Noor Printers, Sadiqabad",
      reference: "Invoice 1187",
      cheque: { number: "004513", date: "2026-11-03" },
      status: "SUBMITTED",
      createdBy: "Nadia Shah",
      updatedAt: "2026-11-03T16:20:00+05:00",
      submittedBy: "Nadia Shah",
      submittedAt: "2026-11-03T16:20:00+05:00",
      history: [
        { action: "CREATED", by: "Nadia Shah", at: "2026-11-03T16:05:00+05:00" },
        { action: "SUBMITTED", by: "Nadia Shah", at: "2026-11-03T16:20:00+05:00" },
      ],
    }),
    voucher({
      id: "vch-kc-br-canteen",
      type: "BR",
      voucherNo: null,
      campus: "KC",
      date: "2026-11-02",
      narration: "Canteen rent for November 2026, received by bank transfer",
      lines: [line("l1", "4202", "Monthly rent", 0, 45000), line("l2", "1102", "Shahid Foods (canteen contractor)", 45000, 0, true)],
      cashBankAccount: "1102",
      party: "Shahid Foods (canteen contractor)",
      reference: "Rent receipt 11/2026",
      cheque: { number: "IBFT 551208", date: "2026-11-02" },
      status: "SUBMITTED",
      createdBy: "Nadia Shah",
      updatedAt: "2026-11-02T12:10:00+05:00",
      submittedBy: "Nadia Shah",
      submittedAt: "2026-11-02T12:10:00+05:00",
      history: [
        { action: "CREATED", by: "Nadia Shah", at: "2026-11-02T11:55:00+05:00" },
        { action: "SUBMITTED", by: "Nadia Shah", at: "2026-11-02T12:10:00+05:00" },
      ],
    }),
    // Approved, ready for the accountant to post.
    voucher({
      id: "vch-hc-bp-generator",
      type: "BP",
      voucherNo: null,
      campus: "HC",
      date: "2026-11-02",
      narration: "Generator repair, Humaira Campus",
      lines: [line("l1", "5302", "Invoice 2219: alternator rewound", 18500, 0), line("l2", "1104", "Al-Noor Electric, Lahore", 0, 18500, true)],
      cashBankAccount: "1104",
      party: "Al-Noor Electric, Lahore",
      reference: "Invoice 2219",
      cheque: { number: "118803", date: "2026-11-02" },
      status: "APPROVED",
      createdBy: "Nadia Shah",
      updatedAt: "2026-11-03T11:05:00+05:00",
      submittedBy: "Nadia Shah",
      submittedAt: "2026-11-02T13:40:00+05:00",
      approvedBy: "Kamran Yousaf",
      approvedAt: "2026-11-03T11:05:00+05:00",
      history: [
        { action: "CREATED", by: "Nadia Shah", at: "2026-11-02T13:30:00+05:00" },
        { action: "SUBMITTED", by: "Nadia Shah", at: "2026-11-02T13:40:00+05:00" },
        { action: "APPROVED", by: "Kamran Yousaf", at: "2026-11-03T11:05:00+05:00", note: "Bill checked against the quotation." },
      ],
    }),
    // A draft not yet sent for approval.
    voucher({
      id: "vch-sm-cp-sports",
      type: "CP",
      voucherNo: null,
      campus: "SM",
      date: "2026-11-04",
      narration: "Refreshments for the inter-house sports day",
      lines: [line("l1", "5308", "Juice and biscuits for 420 students", 12400, 0), line("l2", "1101", "Campus canteen", 0, 12400, true)],
      cashBankAccount: "1101",
      party: "Campus canteen",
      status: "DRAFT",
      createdBy: "Nadia Shah",
      updatedAt: "2026-11-04T09:15:00+05:00",
      history: [{ action: "CREATED", by: "Nadia Shah", at: "2026-11-04T09:15:00+05:00" }],
    }),
    // Sent back by the approver: it holds up closing October at Ubaid Campus until it is corrected.
    voucher({
      id: "vch-uc-cp-furniture",
      type: "CP",
      voucherNo: null,
      campus: "UC",
      date: "2026-10-29",
      narration: "Office furniture repair",
      lines: [line("l1", "5302", "Two office chairs and the staff-room table", 9800, 0), line("l2", "1101", "Local carpenter", 0, 9800, true)],
      cashBankAccount: "1101",
      party: "Local carpenter",
      status: "DRAFT",
      createdBy: "Nadia Shah",
      updatedAt: "2026-10-30T10:20:00+05:00",
      submittedBy: "Nadia Shah",
      submittedAt: "2026-10-29T15:10:00+05:00",
      rejection: { by: "Kamran Yousaf", at: "2026-10-30T10:20:00+05:00", reason: "The carpenter's bill says Rs 8,900, not Rs 9,800. Correct the amount and add the bill number." },
      history: [
        { action: "CREATED", by: "Nadia Shah", at: "2026-10-29T15:00:00+05:00" },
        { action: "SUBMITTED", by: "Nadia Shah", at: "2026-10-29T15:10:00+05:00" },
        { action: "REJECTED", by: "Kamran Yousaf", at: "2026-10-30T10:20:00+05:00", note: "The carpenter's bill says Rs 8,900, not Rs 9,800. Correct the amount and add the bill number." },
      ],
    }),
  ];
}
