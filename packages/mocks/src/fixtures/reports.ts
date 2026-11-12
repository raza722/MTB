import type { CampusCode, ReportColumnDef, ReportDefinition, ReportFilterDef } from "@mtb/api";
import { formatMobile, type IsoDate } from "@mtb/domain";
import { CLASSES } from "./campuses";
import { initialChart } from "./accounts";
import { CASHIERS, CONCESSION_TYPES, FEE_HEADS } from "./fee-setup";
import { STREAMS } from "./student-records";
import { LIB_CABINET_CODES, LIB_CATEGORIES, WH_CATEGORIES, WH_DEPARTMENT_NAMES, WH_ITEM_GROUPS, WH_ROOM_NAMES, WH_SUPPLIER_NAMES } from "./operations";

// Report centre catalogue and a fictional staff roster. The report centre is real now (backend module 13a, no
// routes here): REPORT_DEFINITIONS, reportById and DEFAULT_FAVOURITES are the contract reference the backend's
// catalogue seed is generated from and compared with; nothing imports them at run time. The deterministic
// randomness helpers stay for the mocks that still use them (sms-model). Legacy names come from docs 02 §A14, 03 §F8/§A4/§H5,
// 04 §M1–M4/§P7 and the screenshots index (folders 11 and 16).

// ---------- deterministic randomness ----------

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A number in [0, 1) that is always the same for the same key. */
export const rand01 = (key: string) => (hashStr(key) % 100000) / 100000;
export const pick = <T>(list: readonly T[], key: string): T => list[hashStr(key) % list.length]!;

// ---------- staff (fictional) ----------

export interface ReportStaff {
  id: string;
  staffNo: string;
  campus: CampusCode;
  name: string;
  gender: "F" | "M";
  designation: string;
  department: string;
  teaching: boolean;
  mobile: string;
  joined: IsoDate;
  scale: number;
  basic: number;
  /** Class teacher of (teachers only). */
  classSection?: string;
}

const STAFF_SIZE: Record<CampusCode, number> = { KC: 86, SM: 42, UC: 48, MC: 30, HC: 64 };

/** Khalid Campus staff from the demo cast, first. */
const CAST: Array<Omit<ReportStaff, "id" | "staffNo" | "campus" | "joined" | "scale" | "basic">> = [
  { name: "Mrs Sadia Rehman", gender: "F", designation: "Principal", department: "Administration", teaching: false, mobile: "03025550178" },
  { name: "Ms Hina Javed", gender: "F", designation: "Senior teacher", department: "Middle school", teaching: true, mobile: "03055550166", classSection: "7-B" },
  { name: "Mr Adeel Anwar", gender: "M", designation: "Teacher", department: "Middle school", teaching: true, mobile: "03075550131", classSection: "7-A" },
  { name: "Ms Sana Tariq", gender: "F", designation: "Teacher", department: "Middle school", teaching: true, mobile: "03085550152", classSection: "7-C" },
  { name: "Usman Ali", gender: "M", designation: "Cashier", department: "Accounts office", teaching: false, mobile: "03015550142" },
  { name: "Nadia Shah", gender: "F", designation: "Accountant", department: "Accounts office", teaching: false, mobile: "03035550113" },
  { name: "Kamran Yousaf", gender: "M", designation: "System administrator", department: "Administration", teaching: false, mobile: "03045550190" },
  { name: "Farah Naz", gender: "F", designation: "Office assistant", department: "Administration", teaching: false, mobile: "03065550121" },
];

const T_FEMALE = ["Ayesha", "Rabia", "Saima", "Nida", "Sobia", "Mehwish", "Kiran", "Asma", "Shazia", "Uzma", "Farzana", "Naila", "Bushra", "Sidra", "Amna", "Huma"];
const T_MALE = ["Imran", "Tariq", "Asif", "Naveed", "Kashif", "Waqas", "Shahid", "Faisal", "Zahid", "Nadeem", "Rizwan", "Adnan", "Sajid", "Khurram"];
const T_LAST = ["Iqbal", "Bashir", "Rasheed", "Mahmood", "Hussain", "Akram", "Saleem", "Naseem", "Hanif", "Qureshi", "Javed", "Aslam", "Latif", "Siddiqui", "Ahmed", "Riaz"];
const DEPTS_T = ["Pre-primary", "Primary", "Middle school", "Secondary", "Science", "Computer studies", "Islamic studies"];
const DESIG_T = ["Teacher", "Teacher", "Teacher", "Senior teacher", "Subject specialist", "Lab assistant"];
const NONT: Array<[string, string]> = [
  ["Clerk", "Administration"],
  ["Peon", "Support staff"],
  ["Security guard", "Support staff"],
  ["Driver", "Transport"],
  ["Librarian", "Library"],
  ["Store keeper", "Warehouse"],
  ["Sweeper", "Support staff"],
  ["Data entry operator", "Administration"],
];
const SCALE_BASE: Record<number, number> = { 5: 16500, 7: 18000, 9: 20000, 12: 24000, 14: 28500, 15: 31500, 16: 36000, 17: 44000, 18: 56000 };

const staffCache = new Map<CampusCode, ReportStaff[]>();

export function staffOf(campus: CampusCode): ReportStaff[] {
  const hit = staffCache.get(campus);
  if (hit) return hit;
  const size = STAFF_SIZE[campus];
  const sections = CLASSES.flatMap((c) => c.sections.map((s) => `${c.short}-${s}`));
  const list: ReportStaff[] = [];
  const cast = campus === "KC" ? CAST : [];
  for (let i = 0; i < size; i++) {
    const key = `${campus}:staff:${i}`;
    const base = cast[i];
    const teaching = base ? base.teaching : i < Math.round(size * 0.68);
    const gender: "F" | "M" = base ? base.gender : rand01(`${key}:g`) < (teaching ? 0.72 : 0.35) ? "F" : "M";
    const first = gender === "F" ? pick(T_FEMALE, `${key}:f`) : pick(T_MALE, `${key}:f`);
    const name = base?.name ?? `${teaching ? (gender === "F" ? "Ms " : "Mr ") : ""}${first} ${pick(T_LAST, `${key}:l`)}`;
    const [desig, dept] = base ? [base.designation, base.department] : teaching ? [pick(DESIG_T, `${key}:d`), pick(DEPTS_T, `${key}:dp`)] : pick(NONT, `${key}:nt`);
    const scale = base?.designation === "Principal" ? 18 : teaching ? pick([14, 15, 16, 16, 17], `${key}:s`) : pick([5, 7, 9, 12], `${key}:s`);
    const years = 1 + Math.floor(rand01(`${key}:y`) * 18);
    const classSection = base?.classSection ?? (teaching && i < sections.length + 8 && i >= 8 ? sections[(i - 8) % sections.length] : undefined);
    list.push({
      id: `st-${campus.toLowerCase()}-${i + 1}`,
      staffNo: `${campus}-S-${String(101 + i).padStart(4, "0")}`,
      campus,
      name,
      gender,
      designation: desig,
      department: dept,
      teaching,
      mobile: base?.mobile ?? `03${pick(["00", "01", "11", "21", "33", "45"], `${key}:n`)}555${String(1000 + Math.floor(rand01(`${key}:m`) * 9000))}`,
      joined: `${2026 - years}-${String(1 + Math.floor(rand01(`${key}:jm`) * 9)).padStart(2, "0")}-01`,
      scale,
      basic: (SCALE_BASE[scale] ?? 24000) + years * 900,
      ...(classSection ? { classSection } : {}),
    });
  }
  staffCache.set(campus, list);
  return list;
}

// ---------- admission candidates (fictional) ----------

const dobFor = (key: string, classShort: string) => {
  const n = classShort === "Prep" ? 0 : Number(classShort);
  const y = 2026 - 5 - n - (rand01(`${key}:y`) < 0.25 ? 1 : 0);
  return `${y}-${String(1 + (hashStr(`${key}m`) % 12)).padStart(2, "0")}-${String(1 + (hashStr(`${key}d`) % 28)).padStart(2, "0")}`;
};

export const CANDIDATES_PER_CAMPUS = 64;

export const NAMES_F = ["Hira", "Anum", "Laiba", "Eman", "Zoya", "Noor", "Areej", "Fiza", "Mahnoor", "Hafsa"];
export const NAMES_M = ["Abdullah", "Ibrahim", "Hassan", "Usman", "Talha", "Hamza", "Zain", "Bilal", "Ammar", "Rayyan"];
export const LAST = ["Akhtar", "Aslam", "Farooq", "Habib", "Jamil", "Latif", "Nadeem", "Rafiq", "Saeed", "Zaheer", "Anwar", "Iqbal"];
/** Entry-test candidates this session (fictional): the admissions report and Candidate SMS use the same list. */
export function candidateOf(campus: CampusCode, i: number) {
  const key = `${campus}:cand:${i}`;
  const girl = rand01(`${key}:g`) < 0.5;
  const last = pick(LAST, `${key}:l`);
  const cls = pick(["Prep", "1", "2", "3", "6", "9", "Prep", "1"], `${key}:c`);
  return {
    formNo: `${campus}-ADM-2627-${String(301 + i).padStart(4, "0")}`,
    name: `${pick(girl ? NAMES_F : NAMES_M, `${key}:f`)} ${last}`,
    father: `${pick(["Muhammad", "Ghulam", "Abdul", "Malik", "Rana"], `${key}:ff`)} ${last}`,
    gender: (girl ? "F" : "M") as "F" | "M",
    cls,
    dob: dobFor(key, cls),
    mobile: formatMobile(`03${pick(["00", "01", "21", "33", "45"], `${key}:n`)}555${String(1000 + (hashStr(`${key}:m`) % 9000))}`),
    marks: 30 + Math.round(rand01(`${key}:marks`) * 68),
    testDate: cls === "9" ? "2026-11-07" : "2026-10-24",
  };
}


// ---------- report catalogue ----------

const MONTHS_SO_FAR = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"];
const MONTH_LABEL = (m: string) => `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;

const F = {
  date: (label = "Date"): ReportFilterDef => ({ key: "date", label, kind: "date", default: "today", required: true }),
  range: (def = "monthStart|today"): ReportFilterDef => ({ key: "range", label: "Dates", kind: "dateRange", default: def, required: true }),
  month: (def = "2026-10"): ReportFilterDef => ({ key: "month", label: "Month", kind: "month", default: def, required: true, options: MONTHS_SO_FAR.map((m) => ({ value: m, label: MONTH_LABEL(m) })) }),
  cls: (required = false): ReportFilterDef => ({ key: "class", label: "Class", kind: "class", default: required ? "7" : "", ...(required ? { required } : {}) }),
  section: (): ReportFilterDef => ({ key: "section", label: "Section", kind: "section", default: "" }),
  classSection: (def = "7-B"): ReportFilterDef => ({ key: "classSection", label: "Class and section", kind: "classSection", default: def, required: true }),
  gender: (): ReportFilterDef => ({ key: "gender", label: "Boys or girls", kind: "gender", default: "" }),
  select: (key: string, label: string, options: Array<[string, string]>, def = options[0]?.[0] ?? ""): ReportFilterDef => ({ key, label, kind: "select", default: def, options: options.map(([value, l]) => ({ value, label: l })) }),
  number: (key: string, label: string, def: string, help?: string): ReportFilterDef => ({ key, label, kind: "number", default: def, ...(help ? { help } : {}) }),
  text: (key: string, label: string, def: string, help?: string): ReportFilterDef => ({ key, label, kind: "text", default: def, required: true, ...(help ? { help } : {}) }),
};

/** Exam choices: the backend's catalogue fills in the exams of the campus and session (module 13b). */
const EXAMS: Array<[string, string]> = [["", "Latest exam of the class"]];

/** Subjects for the one-subject-across-tests report. */
const EXAM_SUBJECTS: Array<[string, string]> = [
  ["mat", "Mathematics"],
  ["eng", "English"],
  ["urd", "Urdu"],
  ["sci", "Science"],
  ["phy", "Physics"],
  ["che", "Chemistry"],
  ["bio", "Biology"],
  ["cmp", "Computer Science"],
  ["isl", "Islamiyat"],
  ["sst", "Social Studies"],
  ["pst", "Pakistan Studies"],
  ["tqn", "Tarjuma-tul-Quran"],
];

const c = (key: string, label: string, kind: ReportColumnDef["kind"] = "text", total = false): ReportColumnDef => ({ key, label, kind, ...(total ? { total } : {}) });

/** Bank accounts in the chart of accounts, for the bank book filter. */
const BANK_ACCOUNTS: Array<[string, string]> = initialChart()
  .filter((a) => a.postable && a.kind === "BANK")
  .map((a) => [a.code, `${a.code} ${a.name}`]);

type Def = Omit<ReportDefinition, "formats" | "paper" | "background" | "tags"> & Partial<Pick<ReportDefinition, "formats" | "paper" | "background" | "tags">>;
const def = (d: Def): ReportDefinition => ({ formats: ["PDF", "EXCEL"], paper: "A4", background: false, tags: [], ...d });

export const REPORT_DEFINITIONS: ReportDefinition[] = [
  // ---------------- Fees (doc 03 §F8) ----------------
  def({
    id: "fee-daily-summary",
    name: "Daily fee collection summary",
    module: "FEES",
    description: "What each cashier collected on one day, by payment method — for closing the counter.",
    replaces: ["Daily Fee Summary", "Daily Fee Submission", "Daily Adjustment Fee Summary"],
    ownerPath: "/fees/reports/collection",
    ownerLabel: "Fees → Reports",
    permission: "fees.reports",
    filters: [F.date()],
    columns: [c("cashier", "Cashier"), c("receipts", "Receipts", "count", true), c("cash", "Cash", "money", true), c("bank", "Bank deposit", "money", true), c("cheque", "Cheque", "money", true), c("online", "Online / Raast", "money", true), c("total", "Total", "money", true)],
    tags: ["daily", "cashier", "counter"],
  }),
  def({
    id: "fee-collection-period",
    name: "Fee collection between dates",
    module: "FEES",
    description: "Money received day by day over any period, with a running total.",
    replaces: ["Fee Summary b/w dates", "Fee b/w dates", "Daily Fee Balance"],
    ownerPath: "/fees/reports/collection",
    ownerLabel: "Fees → Reports",
    permission: "fees.reports",
    filters: [F.range()],
    columns: [c("date", "Date", "date"), c("receipts", "Receipts", "count", true), c("amount", "Collected", "money", true), c("running", "Running total", "money")],
    chart: { kind: "area", label: "Collected per day", x: "date", y: "amount" },
    tags: ["collection", "period"],
  }),
  def({
    id: "fee-collection-heads",
    name: "Collection by fee head",
    module: "FEES",
    description: "Tuition, annual charges, exam fee, fines and others: how much came in under each head.",
    replaces: ["Fee Collection Head Wise"],
    improvement: "The old report needed five settings and broke when a campus used a different head list. One list of heads now covers every campus.",
    ownerPath: "/fees/reports",
    ownerLabel: "Fees → Reports",
    permission: "fees.reports",
    filters: [
      F.range(),
      F.gender(),
      F.select("head", "Fee head", [["", "Every head"], ...FEE_HEADS.filter((h) => h.category !== "FINE" && !h.linked).map((h): [string, string] => [h.code, h.title])]),
      F.select("mode", "Show", [["HEADS", "Totals by head"], ["STUDENTS", "Students who paid one head"]]),
      F.cls(),
      F.section(),
    ],
    columns: [c("head", "Fee head"), c("receipts", "Receipts", "count", true), c("amount", "Collected", "money", true), c("share", "Share", "percent")],
    chart: { kind: "column", label: "Collected by head", x: "head", y: "amount" },
    // D5 / C3 (spec 13 fix G4): over 1 s on the first call after a plan recompile over a long period at KC, so it runs in the background
    background: true,
    tags: ["heads", "tuition", "annual"],
  }),
  def({
    id: "fee-class-wise",
    name: "Class-wise fee position for a month",
    module: "FEES",
    description: "For each class: fees billed for the month, collected and still outstanding.",
    replaces: ["Class Wise Fee", "Class Monthly Fee"],
    improvement: "Class Monthly Fee did not open at Khalid Campus (its data source was missing). It works at every campus now.",
    ownerPath: "/fees/reports/monthly",
    ownerLabel: "Fees → Reports",
    permission: "fees.reports",
    filters: [
      F.month(),
      F.select("head", "Fee head", [["", "Every head"], ...FEE_HEADS.filter((h) => h.category === "FEE" && !h.linked).map((h): [string, string] => [h.code, h.title])]),
      F.cls(),
      F.section(),
      F.select("mode", "Show", [["CLASSES", "Each class-section"], ["STUDENTS", "Each student (one section)"]]),
    ],
    columns: [c("classSection", "Class"), c("students", "Students", "count", true), c("billed", "Billed", "money", true), c("collected", "Collected", "money", true), c("outstanding", "Outstanding", "money", true), c("percent", "Collected", "percent")],
    chart: { kind: "column", label: "Collected by class", x: "classSection", y: "collected" },
    tags: ["monthly", "class"],
  }),
  def({
    id: "fee-student-arrears",
    name: "Student-wise arrears",
    module: "FEES",
    description: "Every student with unpaid fees: how much, since when and the guardian's mobile.",
    replaces: ["Student Wise Arrears", "Student Wise Arrears (Changed)"],
    improvement: "Includes students moved between campuses, with one balance per child instead of one per campus.",
    ownerPath: "/fees/reports/arrears",
    ownerLabel: "Fees → Reports",
    permission: "fees.reports",
    filters: [F.cls(), F.section(), F.number("minAmount", "Arrears above (Rs)", "0")],
    columns: [c("grNo", "G.R. No.", "mono"), c("student", "Student"), c("father", "Father"), c("classSection", "Class"), c("mobile", "Mobile", "mono"), c("oldestDue", "Oldest due", "date"), c("days", "Days overdue", "count"), c("arrears", "Arrears", "money", true)],
    background: true,
    tags: ["arrears", "balance", "outstanding"],
  }),
  def({
    id: "fee-class-arrears",
    name: "Class-wise arrears",
    module: "FEES",
    description: "Arrears added up for each class and section, with how much is more than 30 days old.",
    replaces: ["Class Wise Arrears"],
    ownerPath: "/fees/reports/arrears",
    ownerLabel: "Fees → Reports",
    permission: "fees.reports",
    filters: [F.select("head", "Fee head", [["", "Every head"], ...FEE_HEADS.filter((h) => h.category === "FEE" && !h.linked).map((h): [string, string] => [h.code, h.title])]), F.cls()],
    columns: [
      c("classSection", "Class"),
      c("strength", "Total students", "count", true),
      c("students", "Students with arrears", "count", true),
      c("billed", "Billed", "money", true),
      c("paid", "Paid", "money", true),
      c("arrears", "Arrears", "money", true),
      c("percent", "Arrear %", "percent"),
      c("over30", "More than 30 days", "money", true),
    ],
    chart: { kind: "column", label: "Arrears by class", x: "classSection", y: "arrears" },
    // D5 / C3 (spec 13 fix G3): over 1 s on the first call after a plan recompile at KC, so it runs in the background
    background: true,
    tags: ["arrears", "class"],
  }),
  def({
    id: "fee-defaulters",
    name: "Fee defaulters",
    module: "FEES",
    description: "Students overdue by more than a set number of days and amount — the list for reminders and strike-off.",
    replaces: ["Tuition Fee Defaulter", "Fund Defaulter", "Fee Defaulter SMS list"],
    improvement: "Tuition Fee Defaulter and Fund Defaulter did not work at Khalid Campus (missing data source). Both are one report now, at every campus.",
    ownerPath: "/fees/defaulters",
    ownerLabel: "Fees → Defaulters",
    permission: "fees.reports",
    filters: [F.number("minDays", "Overdue more than (days)", "30"), F.number("minAmount", "Amount above (Rs)", "5000"), F.cls()],
    columns: [c("grNo", "G.R. No.", "mono"), c("student", "Student"), c("classSection", "Class"), c("guardian", "Guardian"), c("mobile", "Mobile", "mono"), c("days", "Days overdue", "count"), c("amount", "Overdue", "money", true)],
    // D5 / C3 (spec 13 fix G3): over 1 s on the first call after a plan recompile at KC, so it runs in the background
    background: true,
    tags: ["defaulters", "overdue", "strike off"],
  }),
  def({
    id: "fee-cancellations",
    name: "Receipt cancellations",
    module: "FEES",
    description: "Every cancelled receipt with who asked, who approved and why.",
    replaces: ["Daily Fee Cancellation"],
    improvement: "Cancellations now need the principal's approval on screen, and this report shows the approval trail.",
    ownerPath: "/fees/reports",
    ownerLabel: "Fees → Reports",
    permission: "fees.reports",
    filters: [F.range("2026-10-01|today")],
    columns: [c("cnNo", "Cancellation", "mono"), c("receiptNo", "Receipt", "mono"), c("student", "Student"), c("amount", "Amount", "money", true), c("requestedBy", "Asked by"), c("decidedBy", "Approved by"), c("reason", "Reason"), c("status", "Status", "status")],
    tags: ["cancelled", "audit"],
  }),
  def({
    id: "fee-concessions",
    name: "Discounts and scholarships",
    module: "FEES",
    description: "Students with a concession: type, percentage and how much it costs the school a month and a year.",
    replaces: ["Discount", "Discount Class Wise", "Discount Class Wise 2", "Annual Fee Concession", "Scholarship List"],
    improvement: "Five overlapping reports become one, and an approved scholarship now flows to the fee automatically instead of being typed in again.",
    ownerPath: "/fees/concessions",
    ownerLabel: "Fees → Concessions",
    permission: "fees.reports",
    filters: [F.cls(), F.section(), F.select("type", "Concession", [["", "All types"], ...CONCESSION_TYPES.map((t): [string, string] => [t.code, t.title])])],
    columns: [
      c("grNo", "G.R. No.", "mono"),
      c("student", "Student"),
      c("father", "Father"),
      c("classSection", "Class"),
      c("type", "Concession"),
      c("percent", "Discount", "percent"),
      c("sessionFee", "Session fee", "money", true),
      c("concession", "Concession", "money", true),
      c("payable", "Payable", "money", true),
    ],
    background: true,
    tags: ["discount", "scholarship", "concession"],
  }),
  def({
    id: "fee-concessions-class",
    name: "Discounts by class",
    module: "FEES",
    description: "For each class: students, fees falling due in the period, the discount concessions take off, what remains and the discount %.",
    replaces: ["Class Wise Discount", "Class Wise Discount II", "Annual Fee Concession"],
    ownerPath: "/fees/concessions",
    ownerLabel: "Fees → Concessions",
    permission: "fees.reports",
    filters: [F.range("2026-04-01|today"), F.cls()],
    columns: [
      c("className", "Class"),
      c("strength", "Total students", "count", true),
      c("students", "With a concession", "count", true),
      c("billed", "Total amount", "money", true),
      c("discount", "Discount", "money", true),
      c("remaining", "Remaining", "money", true),
      c("percent", "Discount %", "percent"),
    ],
    chart: { kind: "column", label: "Discount by class", x: "className", y: "discount" },
    tags: ["discount", "class", "concession", "scholarship"],
  }),
  def({
    id: "fee-student-ledger",
    name: "Individual fee ledger",
    module: "FEES",
    description: "One student's charges and payments with the running balance — to show a parent.",
    replaces: ["Individual Fee Ledger", "Fee Card", "Student Fee Detail"],
    improvement: "Individual Fee Ledger did not open at Khalid Campus (missing data source). Works now, including late fines and cancelled receipts.",
    ownerPath: "/students",
    ownerLabel: "Students → profile → Fees",
    permission: "fees.view",
    filters: [F.text("grNo", "G.R. number", "KC-14823", "For example KC-14823")],
    columns: [c("date", "Date", "date"), c("description", "Description"), c("reference", "Receipt / due", "mono"), c("charged", "Charged", "money", true), c("paid", "Paid", "money", true), c("balance", "Balance", "money")],
    tags: ["ledger", "student", "statement"],
  }),
  def({
    id: "fee-candidate",
    name: "Admission test fees received",
    module: "FEES",
    description: "Test fees paid by candidates, day by day.",
    replaces: ["Daily Candidate Fee Submission", "Candidate Fee Submission b/w dates", "Candidate Fee Slip"],
    ownerPath: "/fees/candidates",
    ownerLabel: "Fees → Candidates",
    permission: "fees.reports",
    filters: [F.range("2026-10-01|today"), F.select("cashier", "Received by", [["", "Every cashier"], ...Object.values(CASHIERS).flat().map((n): [string, string] => [n, n])])],
    columns: [
      c("cashier", "Received by"),
      c("date", "Date", "date"),
      c("receiptNo", "Receipt", "mono"),
      c("formNo", "Form No.", "mono"),
      c("candidate", "Candidate"),
      c("classApplied", "Class applied"),
      c("test", "Test fee", "money", true),
      c("prospectus", "Prospectus", "money", true),
      c("form", "Form fee", "money", true),
      c("total", "Total", "money", true),
      c("amount", "Received", "money", true),
    ],
    background: true,
    tags: ["candidate", "admission", "test fee"],
  }),
  def({
    id: "fee-receipt-register",
    name: "Fee receipt register (every receipt)",
    module: "FEES",
    description: "Every receipt posted in the period with method and cashier. Prepared in the background because it is long.",
    replaces: ["Student Wise Fee", "Daily Fee Submission (detail)"],
    ownerPath: "/fees/reports/collection",
    ownerLabel: "Fees → Reports",
    permission: "fees.reports",
    filters: [F.range("2026-04-01|today"), F.cls(), F.section()],
    columns: [c("date", "Date", "date"), c("receiptNo", "Receipt", "mono"), c("grNo", "G.R. No.", "mono"), c("student", "Student"), c("classSection", "Class"), c("heads", "For"), c("method", "Method"), c("cashier", "Cashier"), c("fine", "Fine", "money", true), c("amount", "Amount", "money", true)],
    background: true,
    paper: "A4_LANDSCAPE",
    tags: ["receipts", "register", "audit"],
  }),

  // ---------------- Students (doc 02 §A14, screenshots 16) ----------------
  def({
    id: "students-list",
    name: "Student list",
    module: "STUDENTS",
    description: "Enrolled students by class and section, with roll number, father and guardian's mobile.",
    replaces: ["Student List", "Student Detail Class Wise", "Student Detail Active", "Student Detail Gender Wise", "General list", "Register Report"],
    improvement: "Student Detail Active and Student Detail Gender Wise did not open in the old software. One list now covers all of them, with filters.",
    ownerPath: "/students",
    ownerLabel: "Students",
    permission: "students.view",
    filters: [
      F.cls(),
      F.section(),
      F.gender(),
      { ...F.select("blank", "Blank column", [["", "None"], ["SIGNATURE", "Signature"], ["TICK", "Tick"]]), help: "An empty column on the printed list, for signatures or ticks." },
    ],
    columns: [c("grNo", "G.R. No.", "mono"), c("roll", "Roll", "count"), c("student", "Student"), c("father", "Father"), c("classSection", "Class"), c("gender", "Gender"), c("mobile", "Guardian mobile", "mono")],
    tags: ["list", "class", "roll", "register", "signature"],
  }),
  def({
    id: "students-ptm-sheet",
    name: "Parent-teacher meeting sheet",
    module: "STUDENTS",
    description: "One section's students with blank columns for the teacher's and parent's remarks and the parent's signature, to fill in at the meeting.",
    replaces: ["Teacher Parent Meeting"],
    ownerPath: "/students/sections",
    ownerLabel: "Students → Sections",
    permission: "students.view",
    filters: [F.cls(true), { ...F.section(), default: "B", required: true }, { ...F.date("Meeting date"), allowFuture: true, help: "Printed in the heading. Can be a day ahead." }],
    columns: [
      c("sr", "Sr.", "count"),
      c("grNo", "G.R. No.", "mono"),
      c("student", "Student"),
      c("father", "Father"),
      c("gender", "Gender"),
      c("teacherRemarks", "Teacher's remarks", "blank"),
      c("parentRemarks", "Parent's remarks", "blank"),
      c("parentSign", "Parent's signature", "blank"),
    ],
    paper: "A4_LANDSCAPE",
    singleCampus: true,
    signatures: ["Class teacher signature", "Principal"],
    ruled: true,
    tags: ["parent", "teacher", "meeting", "ptm", "signature"],
  }),
  def({
    id: "portal-accounts",
    name: "Parent portal accounts",
    module: "STUDENTS",
    description: "Which families can use the parent portal and whether they have signed in, by class and section. No passwords: families sign in with a one-time code.",
    replaces: ["Get App Users List", "Android App Students LogIn Credentials"],
    improvement: "The old list printed every student's app password. Families now sign in with a code sent to their registered mobile, so this list shows the account's status instead.",
    ownerPath: "/students",
    ownerLabel: "Students",
    permission: "students.view",
    filters: [F.cls(), F.section(), F.select("status", "Portal", [["", "All"], ["SIGNED_IN", "Signed in"], ["NEVER", "Never signed in"], ["NOT_SET_UP", "Not set up"]])],
    columns: [c("grNo", "G.R. No.", "mono"), c("student", "Student"), c("father", "Father"), c("classSection", "Class"), c("mobile", "Registered mobile", "mono"), c("status", "Portal", "status"), c("lastSignIn", "Last sign-in", "date")],
    tags: ["portal", "app", "parents", "sign-in", "accounts"],
  }),
  def({
    id: "students-group-wise",
    name: "Group-wise list",
    module: "STUDENTS",
    description: "Students of one group (stream) in a class, with section, the group's subjects and a blank column for marks.",
    replaces: ["Group-wise list", "Group/Subject wise List"],
    ownerPath: "/students/sections",
    ownerLabel: "Students → Sections",
    permission: "students.view",
    filters: [
      { key: "class", label: "Class", kind: "class", default: "9", required: true },
      F.select("group", "Group", [["", "All groups"], ...STREAMS.map((g): [string, string] => [g, g])]),
      F.gender(),
    ],
    columns: [c("sr", "Sr", "count"), c("grNo", "G.R. No.", "mono"), c("student", "Student"), c("marks", "Marks", "blank"), c("classSection", "Class"), c("section", "Section"), c("group", "Group"), c("subjects", "Subjects")],
    paper: "A4_LANDSCAPE",
    tags: ["group", "stream", "subjects", "science", "computer"],
  }),
  def({
    id: "students-strength",
    name: "Student strength by class",
    module: "STUDENTS",
    description: "Boys, girls and total in every section, with room, seats and free seats, and a total line for each class.",
    replaces: ["Student count summary", "Total students"],
    ownerPath: "/students/sections",
    ownerLabel: "Students → Sections",
    permission: "students.view",
    filters: [F.cls()],
    columns: [
      c("classSection", "Class"),
      c("teacher", "Class teacher"),
      c("room", "Room"),
      c("seats", "Seats", "count", true),
      c("boys", "Boys", "count", true),
      c("girls", "Girls", "count", true),
      c("total", "Total", "count", true),
      c("free", "Free seats", "count", true),
    ],
    chart: { kind: "column", label: "Students per class", x: "classSection", y: "total" },
    tags: ["strength", "count", "summary"],
  }),
  def({
    id: "students-register",
    name: "Full student register",
    module: "STUDENTS",
    description: "Every student with date of birth, B-form, group, previous school, board roll no., address and guardian. Long: prepared in the background.",
    replaces: ["Student Detail", "Student registration print", "Academic history", "General Student List", "Student Detail Session Wise", "Student Detail Section Wise"],
    ownerPath: "/students",
    ownerLabel: "Students",
    permission: "students.view",
    filters: [F.cls(), F.section(), F.gender(), F.select("status", "Enrolment", [["", "Enrolled"], ["LEFT", "Left / inactive"], ["ALL", "All"]])],
    columns: [
      c("grNo", "G.R. No.", "mono"),
      c("roll", "Roll", "count"),
      c("student", "Student"),
      c("father", "Father"),
      c("occupation", "Father's occupation"),
      c("fatherCnic", "Father's CNIC", "mono"),
      c("gender", "Gender"),
      c("dob", "Date of birth", "date"),
      c("bForm", "B-form / CNIC", "mono"),
      c("classSection", "Class"),
      c("group", "Group"),
      c("boardRoll", "Board roll no.", "mono"),
      c("admitted", "Admitted", "date"),
      c("previous", "Previous school"),
      c("mobile", "Mobile", "mono"),
      c("address", "Address"),
    ],
    background: true,
    paper: "A4_LANDSCAPE",
    tags: ["register", "detail", "address"],
  }),
  def({
    id: "students-new-admissions",
    name: "New admissions",
    module: "STUDENTS",
    description: "Students admitted in a period, with gender, group, guardian mobile, test marks and previous school.",
    replaces: ["New admission list", "Admission date wise"],
    ownerPath: "/admissions/offers",
    ownerLabel: "Admissions → Offers & admission",
    permission: "students.view",
    filters: [F.range("2026-04-01|today"), F.cls(), F.section(), F.gender()],
    columns: [
      c("date", "Admitted", "date"),
      c("grNo", "G.R. No.", "mono"),
      c("student", "Student"),
      c("father", "Father"),
      c("gender", "Gender"),
      c("classSection", "Class"),
      c("group", "Group"),
      c("mobile", "Guardian mobile", "mono"),
      c("basis", "Test marks / basis"),
      c("previous", "Previous school"),
    ],
    paper: "A4_LANDSCAPE",
    tags: ["admission", "new", "gender", "mobile"],
  }),
  def({
    id: "students-new-admission-count",
    name: "New admission count",
    module: "STUDENTS",
    description: "New admissions in a period per class and section, boys and girls, with level subtotals and a grand total.",
    replaces: ["New Student Count", "New admission count"],
    ownerPath: "/admissions/offers",
    ownerLabel: "Admissions → Offers & admission",
    permission: "students.view",
    filters: [F.range("2026-04-01|today")],
    columns: [c("level", "Level"), c("className", "Class"), c("section", "Section"), c("boys", "Boys", "count", true), c("girls", "Girls", "count", true), c("total", "Total", "count", true)],
    chart: { kind: "column", label: "New admissions per class", x: "className", y: "total" },
    tags: ["admission", "new", "count", "gender"],
  }),
  def({
    id: "students-siblings",
    name: "Families with more than one child",
    module: "STUDENTS",
    description: "Brothers and sisters studying at MTB, across campuses — for sibling discounts and family payments.",
    replaces: ["Sibling report"],
    improvement: "Families are now matched by the father's CNIC across all campuses, not only within one campus's copy.",
    ownerPath: "/students/families",
    ownerLabel: "Students → Families",
    permission: "students.view",
    filters: [],
    columns: [c("father", "Father"), c("cnic", "CNIC", "mono"), c("children", "Children"), c("count", "Children", "count", true), c("campuses", "Campuses")],
    tags: ["siblings", "family"],
  }),
  def({
    id: "students-left",
    name: "Students who left or were expelled",
    module: "STUDENTS",
    description: "Students who left, were struck off, passed out or were expelled in a period, with the reason.",
    replaces: ["Expulsion notice", "Expulsion individual", "Expulsion between dates", "Expulsion gender-wise", "Expulsion session-wise", "Leaving list"],
    ownerPath: "/students/leaving",
    ownerLabel: "Students → Leaving",
    permission: "students.view",
    filters: [F.range("2026-04-01|today"), F.select("status", "Reason", [["", "All"], ["LEFT", "Left"], ["STRUCK_OFF", "Struck off"], ["EXPELLED", "Expelled"], ["PASSED_OUT", "Passed out"]]), F.cls(), F.section(), F.gender()],
    columns: [
      c("date", "Date", "date"),
      c("grNo", "G.R. No.", "mono"),
      c("student", "Student"),
      c("father", "Father"),
      c("mobile", "Guardian mobile", "mono"),
      c("gender", "Gender"),
      c("classSection", "Class"),
      c("session", "Session"),
      c("status", "Status", "status"),
      c("reason", "Reason"),
      c("by", "Recorded by"),
      c("approvedBy", "Approved by"),
    ],
    paper: "A4_LANDSCAPE",
    tags: ["left", "expelled", "struck off", "gender"],
  }),
  def({
    id: "students-contacts",
    name: "Guardian contact list",
    module: "STUDENTS",
    description: "Guardian name, relation, mobile and postal address for a class — for phone trees and letters.",
    replaces: ["Post address"],
    ownerPath: "/students",
    ownerLabel: "Students",
    permission: "students.view",
    filters: [F.cls(true), F.section()],
    columns: [c("grNo", "G.R. No.", "mono"), c("student", "Student"), c("classSection", "Class"), c("guardian", "Guardian"), c("relation", "Relation"), c("mobile", "Mobile", "mono"), c("address", "Address")],
    tags: ["contact", "address", "mobile"],
  }),

  // ---------------- Admissions ----------------
  def({
    id: "adm-candidates",
    name: "Admission candidates",
    module: "ADMISSIONS",
    description: "Everyone who applied this session, by class applied for, boys or girls, with B-form, previous school, address and test sitting.",
    replaces: ["Candidate Detail Gender Wise", "Candidate registration", "Candidate Detail"],
    ownerPath: "/admissions",
    ownerLabel: "Admissions",
    permission: "admissions.view",
    filters: [F.cls(), F.gender()],
    columns: [
      c("formNo", "Form No.", "mono"),
      c("candidate", "Candidate"),
      c("father", "Father"),
      c("bForm", "B-form / CNIC", "mono"),
      c("dob", "Date of birth", "date"),
      c("classApplied", "Class applied"),
      c("gender", "Gender"),
      c("previous", "Previous school"),
      c("mobile", "Mobile", "mono"),
      c("address", "Address"),
      c("sitting", "Test sitting"),
      c("status", "Status", "status"),
    ],
    paper: "A4_LANDSCAPE",
    // D5 / C3 (spec 13 fix G3): over 1 s on the first call after a plan recompile at KC, so it runs in the background
    background: true,
    tags: ["candidates", "entry test", "address"],
  }),
  def({
    id: "adm-test-appearance",
    name: "Entry test appearance",
    module: "ADMISSIONS",
    description: "Candidates booked into entry-test sittings in a period, and whether each appeared.",
    replaces: ["Pre-Entrance Test Candidates Appearance"],
    improvement: "The old report timed out; this one reads the marks sheets directly.",
    ownerPath: "/admissions/tests",
    ownerLabel: "Admissions → Entry tests",
    permission: "admissions.view",
    filters: [F.range("2026-09-01|today"), F.cls(), F.select("appeared", "Appeared", [["", "All"], ["yes", "Appeared"], ["no", "Did not appear"]])],
    columns: [c("seatNo", "Seat no.", "mono"), c("candidate", "Candidate"), c("father", "Father"), c("classApplied", "Class"), c("date", "Sitting date", "date"), c("appeared", "Appeared", "status"), c("score", "Marks")],
    tags: ["entry test", "absent", "appearance"],
  }),
  def({
    id: "adm-merit",
    name: "Entry test merit list",
    module: "ADMISSIONS",
    description: "Candidates ranked by entry-test marks, with the admission decision.",
    replaces: ["Merit List", "Pre-admission Merit List"],
    improvement: "Pre-admission Merit List could not be opened in the old software (its button opened another report).",
    ownerPath: "/admissions/merit",
    ownerLabel: "Admissions → Merit",
    permission: "admissions.view",
    filters: [{ ...F.cls(true), default: "6" }, F.gender()],
    columns: [c("rank", "Rank", "count"), c("seatNo", "Seat no.", "mono"), c("formNo", "Form No.", "mono"), c("candidate", "Candidate"), c("father", "Father"), c("marks", "Total", "count"), c("percent", "Score", "percent"), c("decision", "Decision", "status")],
    paper: "A4_LANDSCAPE",
    tags: ["merit", "entry test"],
  }),

  // ---------------- Attendance ----------------
  def({
    id: "att-daily",
    name: "Daily attendance by class",
    module: "ATTENDANCE",
    description: "Present, absent, on leave and late in every class on one day, and who marked the register.",
    replaces: ["Student Attendance", "Attendance Register (daily)"],
    ownerPath: "/attendance",
    ownerLabel: "Attendance",
    permission: "attendance.view",
    filters: [F.date()],
    columns: [c("classSection", "Class"), c("teacher", "Class teacher"), c("enrolled", "Enrolled", "count", true), c("present", "Present", "count", true), c("absent", "Absent", "count", true), c("leave", "Leave", "count", true), c("late", "Late", "count", true), c("percent", "Attendance", "percent")],
    chart: { kind: "column", label: "Attendance % by class", x: "classSection", y: "percent" },
    tags: ["daily", "absent"],
  }),
  def({
    id: "att-monthly-register",
    name: "Monthly attendance register",
    module: "ATTENDANCE",
    description: "The class register for a month, day by day, with G.R. no., father, each student's totals and days attended this month, last month and this session.",
    replaces: ["Student Monthly Attendance", "Attendance Register"],
    ownerPath: "/attendance/monthly",
    ownerLabel: "Attendance → Monthly",
    permission: "attendance.view",
    filters: [F.classSection(), F.month()],
    columns: [c("roll", "Roll", "count"), c("grNo", "G.R. No.", "mono"), c("student", "Student"), c("father", "Father"), c("attMonth", "Attended this month", "count"), c("attPrev", "Previous month", "count"), c("attTotal", "Session total", "count")],
    paper: "A4_LANDSCAPE",
    singleCampus: true,
    tags: ["register", "monthly"],
  }),
  def({
    id: "att-low",
    name: "Students below an attendance level",
    module: "ATTENDANCE",
    description: "Students whose attendance this session is below the level you set, with the guardian's mobile.",
    replaces: [],
    isNew: true,
    ownerPath: "/attendance/students",
    ownerLabel: "Attendance → Students",
    permission: "attendance.view",
    filters: [F.number("below", "Attendance below (%)", "80"), F.cls()],
    columns: [c("grNo", "G.R. No.", "mono"), c("student", "Student"), c("classSection", "Class"), c("days", "School days", "count"), c("present", "Present", "count"), c("percent", "Attendance", "percent"), c("mobile", "Guardian mobile", "mono")],
    tags: ["low attendance", "chronic"],
  }),
  def({
    id: "att-leave",
    name: "Student leave",
    module: "ATTENDANCE",
    description: "Students marked on leave in a period, with the number of days.",
    replaces: ["Student Leave"],
    ownerPath: "/attendance",
    ownerLabel: "Attendance",
    permission: "attendance.view",
    filters: [F.range("2026-10-01|today"), F.cls()],
    columns: [c("grNo", "G.R. No.", "mono"), c("student", "Student"), c("classSection", "Class"), c("days", "Days on leave", "count", true), c("last", "Last leave", "date")],
    tags: ["leave"],
  }),

  // ---------------- Exams (doc 02 §A9–A10, §A14) ----------------
  def({
    id: "exam-master-sheet",
    name: "Result master sheet",
    module: "EXAMS",
    description: "Every student's marks in every subject for one section, with total, percentage, grade, position and failed subjects.",
    replaces: ["Master Sheet (exam)", "Master Sheet (class)", "Master Sheet Type 2", "Master Sheet Monthly Test", "Master Sheet Board"],
    ownerPath: "/exams",
    ownerLabel: "Exams",
    permission: "exams.view",
    filters: [F.select("exam", "Exam", EXAMS), F.classSection(), F.gender()],
    columns: [c("roll", "Roll", "count"), c("grNo", "G.R. No.", "mono"), c("student", "Student")],
    paper: "A4_LANDSCAPE",
    singleCampus: true,
    tags: ["master sheet", "marks"],
  }),
  def({
    id: "exam-positions",
    name: "Class positions and top ten",
    module: "EXAMS",
    description: "The top students of a class across all its sections.",
    replaces: ["Position table", "Top Ten", "Diamond Mind list"],
    ownerPath: "/exams/merit",
    ownerLabel: "Exams → Merit",
    permission: "exams.view",
    filters: [F.select("exam", "Exam", EXAMS), F.cls(true), F.select("top", "Show", [["10", "Top 10"], ["3", "Top 3"], ["5", "Top 5"], ["20", "Top 20"], ["50", "Top 50"]]), F.gender()],
    columns: [c("position", "Position", "count"), c("grNo", "G.R. No.", "mono"), c("student", "Student"), c("classSection", "Section"), c("group", "Group"), c("total", "Marks", "count"), c("max", "Out of", "count"), c("percent", "Percentage", "percent"), c("grade", "Grade")],
    tags: ["position", "top ten", "merit"],
  }),
  def({
    id: "exam-failed",
    name: "Failed and supplementary students",
    module: "EXAMS",
    description: "Students who failed one or more subjects, and which ones.",
    replaces: ["Failed students", "Supply holders"],
    ownerPath: "/exams",
    ownerLabel: "Exams",
    permission: "exams.view",
    filters: [F.select("exam", "Exam", EXAMS), F.cls(), F.gender()],
    columns: [
      c("grNo", "G.R. No.", "mono"),
      c("student", "Student"),
      c("classSection", "Class"),
      c("group", "Group"),
      c("failed", "Failed in"),
      c("count", "Subjects", "count"),
      c("obtained", "Obtained", "count"),
      c("max", "Total", "count"),
      c("percent", "Overall", "percent"),
      c("grade", "Grade"),
      c("result", "Result"),
    ],
    tags: ["failed", "supply"],
  }),
  def({
    id: "exam-subject-analysis",
    name: "Subject results and teacher performance",
    module: "EXAMS",
    description: "Average and pass rate in each subject of a class, with the subject teacher.",
    replaces: ["Teacher performance (×3)", "Static result section-wise", "Static result class-wise"],
    ownerPath: "/exams",
    ownerLabel: "Exams → Analysis",
    permission: "exams.view",
    filters: [F.select("exam", "Exam", EXAMS), F.cls(true), F.gender()],
    columns: [
      c("subject", "Subject"),
      c("teacher", "Teacher"),
      c("students", "Students", "count"),
      c("average", "Average", "percent"),
      c("pass", "Passed", "percent"),
      c("highest", "Highest mark", "count"),
      c("lowest", "Lowest mark", "count"),
      c("absent", "Absent", "count"),
      c("failures", "Failures", "count"),
    ],
    chart: { kind: "column", label: "Average % by subject", x: "subject", y: "average" },
    tags: ["analysis", "teacher", "subject"],
  }),
  def({
    id: "exam-result-cards",
    name: "Result cards for a class",
    module: "EXAMS",
    description: "Printable result cards for every student in a section. Prepared in the background.",
    replaces: ["Result Card (Primary)", "Result Card (with column)", "Cumulative result card", "Previous result card"],
    improvement: "The old result card had a student hard-coded out of it and failed for some recent admissions. Cards print correctly for everyone.",
    ownerPath: "/exams",
    ownerLabel: "Exams → Print",
    permission: "exams.view",
    filters: [F.select("exam", "Exam", EXAMS), F.classSection()],
    columns: [c("roll", "Roll", "count"), c("grNo", "G.R. No.", "mono"), c("student", "Student"), c("total", "Marks", "count"), c("max", "Out of", "count"), c("percent", "Percentage", "percent"), c("grade", "Grade"), c("position", "Position", "count"), c("result", "Result")],
    formats: ["PDF"],
    background: true,
    singleCampus: true,
    tags: ["result card", "print"],
  }),
  def({
    id: "exam-tests-cumulative",
    name: "Monthly and cumulative tests",
    module: "EXAMS",
    description: "Each student's % in every class test of the session, last session's final %, and the average of the tests they have.",
    replaces: ["Academic History", "Monthly morning test", "Consolidated (cumulative) tests", "Class cumulative tests SMS list"],
    ownerPath: "/exams/combined",
    ownerLabel: "Exams → Combined results",
    permission: "exams.view",
    filters: [F.classSection()],
    columns: [c("roll", "Roll", "count"), c("grNo", "G.R. No.", "mono"), c("student", "Student"), c("last", "Last exam %", "percent"), c("average", "Average", "percent")],
    singleCampus: true,
    tags: ["monthly test", "cumulative", "academic history"],
  }),
  def({
    id: "exam-subject-tests",
    name: "One subject across tests",
    module: "EXAMS",
    description: "A section's results in one subject over every class test in a period: tests sat, absences, average, obtained, total and %.",
    replaces: ["Morning Test Detail", "Morning test detail subject-wise", "Student Morning Test Monthly"],
    ownerPath: "/exams/combined",
    ownerLabel: "Exams → Combined results",
    permission: "exams.view",
    filters: [
      F.classSection(),
      F.select("subject", "Subject", EXAM_SUBJECTS),
      F.range("2026-09-01|today"),
      F.select("examType", "Tests", [
        ["", "Every class test"],
        ["et-morning", "Morning tests"],
        ["et-weekly", "Weekly tests"],
        ["et-monthly", "Monthly tests"],
        ["et-chapter", "Chapter-wise tests"],
      ]),
    ],
    columns: [
      c("grNo", "G.R. No.", "mono"),
      c("student", "Student"),
      c("group", "Group"),
      c("tests", "Tests", "count"),
      c("absent", "Absent / leave", "count"),
      c("average", "Avg. mark", "count"),
      c("obtained", "Obtained", "count"),
      c("max", "Total", "count"),
      c("percent", "%age", "percent"),
    ],
    singleCampus: true,
    isNew: true,
    tags: ["morning test", "subject", "monthly test"],
  }),

  // ---------------- Accounts (doc 03 §A4) ----------------
  def({
    id: "acc-trial-balance",
    name: "Trial balance",
    module: "ACCOUNTS",
    description: "Opening balance, debits and credits in a period, and closing balance of every account, rolled up to a level if you like. The totals agree.",
    replaces: ["Trial Balance", "Trial Balance Level-wise"],
    improvement: "The old trial balance used the time a line was typed in, not the voucher date, so back-dated receipts landed in the wrong month and the books did not balance.",
    ownerPath: "/accounts/trial-balance",
    ownerLabel: "Accounts → Trial balance",
    permission: "accounts.view",
    filters: [F.range("2026-04-01|today"), F.select("level", "Roll up to", [["", "Every account"], ["1", "Level 1 (classes)"], ["2", "Level 2 (groups)"], ["3", "Level 3 (sub-groups)"]])],
    columns: [
      c("code", "Code", "mono"),
      c("account", "Account"),
      c("openingDr", "Opening Dr", "money", true),
      c("openingCr", "Opening Cr", "money", true),
      c("debit", "Debits", "money", true),
      c("credit", "Credits", "money", true),
      c("closingDr", "Closing Dr", "money", true),
      c("closingCr", "Closing Cr", "money", true),
    ],
    paper: "A4_LANDSCAPE",
    tags: ["trial balance", "ledger", "level"],
  }),
  def({
    id: "acc-cash-book",
    name: "Cash book",
    module: "ACCOUNTS",
    description: "Cash in hand received and paid, voucher by voucher, with the running balance.",
    replaces: ["Cash Ledger"],
    ownerPath: "/accounts/ledger",
    ownerLabel: "Accounts → Ledger",
    permission: "accounts.view",
    filters: [F.range()],
    columns: [c("date", "Date", "date"), c("voucher", "Voucher", "mono"), c("description", "Description"), c("receipts", "Received", "money", true), c("payments", "Paid", "money", true), c("balance", "Balance", "money")],
    tags: ["cash", "ledger"],
  }),
  def({
    id: "acc-bank-book",
    name: "Bank book",
    module: "ACCOUNTS",
    description: "Deposits and payments in one bank account, or every bank account together, with the running balance.",
    replaces: ["Bank Ledger", "Bank Payment Voucher"],
    ownerPath: "/accounts/bank",
    ownerLabel: "Accounts → Bank",
    permission: "accounts.view",
    filters: [F.range(), F.select("bank", "Bank account", [["", "All bank accounts"], ...BANK_ACCOUNTS])],
    columns: [c("date", "Date", "date"), c("voucher", "Voucher", "mono"), c("description", "Description"), c("deposits", "Deposits", "money", true), c("payments", "Payments", "money", true), c("balance", "Balance", "money")],
    tags: ["bank", "ledger"],
  }),
  def({
    id: "acc-income-expenditure",
    name: "Income and spending by head",
    module: "ACCOUNTS",
    description: "Income and expenses under each account for a month and the session so far, with group totals and the surplus.",
    replaces: ["Account Head Status", "Account Ledger (summary)"],
    ownerPath: "/accounts/statements",
    ownerLabel: "Accounts → Statements",
    permission: "accounts.view",
    filters: [F.month()],
    columns: [c("head", "Account"), c("type", "Type"), c("month", "This month", "money"), c("session", "Session to date", "money")],
    tags: ["income", "expenses", "statement"],
  }),
  def({
    id: "acc-voucher-register",
    name: "Voucher register",
    module: "ACCOUNTS",
    description: "Every cash, bank and journal voucher in a period with its status.",
    replaces: ["Cash Payment Voucher", "Cash Receipt Voucher", "Bank Payment Voucher", "Bank Receipt Voucher", "Journal Voucher"],
    ownerPath: "/accounts/vouchers",
    ownerLabel: "Accounts → Vouchers",
    permission: "accounts.view",
    filters: [F.range(), F.select("type", "Type", [["", "All"], ["CP", "Cash payment"], ["CR", "Cash receipt"], ["BP", "Bank payment"], ["BR", "Bank receipt"], ["JV", "Journal"], ["FEE", "Fee collection"], ["FEE_CANCEL", "Receipt cancellation"]])],
    columns: [c("voucherNo", "Voucher", "mono"), c("date", "Date", "date"), c("type", "Type"), c("narration", "Narration"), c("amount", "Amount", "money", true), c("status", "Status", "status"), c("by", "Entered by")],
    tags: ["vouchers", "journal"],
  }),

  // ---------------- Staff and payroll (doc 03 §H5) ----------------
  def({
    id: "hr-staff-list",
    name: "Staff list",
    module: "HR",
    description: "Everyone on the staff with designation, department, joining date and mobile.",
    replaces: ["Staff Record", "Total Staff", "Employee Profile"],
    ownerPath: "/hr",
    ownerLabel: "Staff",
    permission: "hr.view",
    filters: [F.select("group", "Staff", [["", "Everyone"], ["T", "Teaching"], ["N", "Non-teaching"]]), F.gender()],
    columns: [c("staffNo", "Staff No.", "mono"), c("name", "Name"), c("designation", "Designation"), c("department", "Department"), c("joined", "Joined", "date"), c("mobile", "Mobile", "mono")],
    tags: ["staff", "teachers"],
  }),
  def({
    id: "hr-staff-attendance",
    name: "Staff attendance for a month",
    module: "HR",
    description: "Days present, absent, on leave and late for each staff member, from the biometric devices and manual entries.",
    replaces: ["Staff Attendance", "Staff Monthly Attendance", "Time In/Out", "Working Attendance", "Total Present Staff"],
    improvement: "Staff Attendance Detail and Monthly Hours could not be opened in the old software.",
    ownerPath: "/hr/attendance",
    ownerLabel: "Staff → Attendance",
    permission: "hr.view",
    filters: [F.month()],
    columns: [c("staffNo", "Staff No.", "mono"), c("name", "Name"), c("designation", "Designation"), c("present", "Present", "count", true), c("absent", "Absent", "count", true), c("leave", "Leave", "count", true), c("late", "Late", "count", true), c("percent", "Attendance", "percent")],
    tags: ["staff attendance", "biometric"],
  }),
  def({
    id: "hr-salary-sheet",
    name: "Salary sheet",
    module: "HR",
    description: "Basic pay, allowances, deductions and net salary for every staff member for a month.",
    replaces: ["Full Salary", "Staff-wise Salary", "Salary Card", "Salary Card New", "Staff Salary"],
    improvement: "Three salary-card reports could not be reached from any menu. One salary sheet and payslips replace them.",
    ownerPath: "/hr/payroll",
    ownerLabel: "Staff → Payroll",
    permission: "payroll.manage",
    filters: [F.month()],
    columns: [c("staffNo", "Staff No.", "mono"), c("name", "Name"), c("designation", "Designation"), c("basic", "Basic", "money", true), c("allowances", "Allowances", "money", true), c("deductions", "Deductions", "money", true), c("net", "Net salary", "money", true)],
    paper: "A4_LANDSCAPE",
    tags: ["salary", "payroll"],
  }),
  def({
    id: "hr-loans",
    name: "Staff loans and advances",
    module: "HR",
    description: "Loans and salary advances with what has been repaid and what is left.",
    replaces: ["Staff Loan", "Advance Salary"],
    ownerPath: "/hr/loans",
    ownerLabel: "Staff → Loans",
    permission: "hr.view",
    filters: [],
    columns: [c("staffNo", "Staff No.", "mono"), c("name", "Name"), c("type", "Type"), c("amount", "Amount", "money", true), c("repaid", "Repaid", "money", true), c("balance", "Balance", "money", true), c("instalment", "Per month", "money")],
    tags: ["loans", "advance"],
  }),
  def({
    id: "hr-increments",
    name: "Annual increments",
    module: "HR",
    description: "This session's increment for each staff member from pay scale and years of service.",
    replaces: ["Staff Salary Increment", "Staff Experience"],
    ownerPath: "/hr/increments",
    ownerLabel: "Staff → Increments",
    permission: "hr.view",
    filters: [],
    columns: [c("staffNo", "Staff No.", "mono"), c("name", "Name"), c("scale", "Scale", "count"), c("years", "Years of service", "count"), c("oldBasic", "Old basic", "money", true), c("increment", "Increment", "money", true), c("newBasic", "New basic", "money", true)],
    tags: ["increment", "experience"],
  }),
  def({
    id: "hr-leave",
    name: "Staff leave",
    module: "HR",
    description: "Leave taken in a period by type, and each person's remaining balance.",
    replaces: ["Staff Leave"],
    ownerPath: "/hr/leave",
    ownerLabel: "Staff → Leave",
    permission: "hr.view",
    filters: [F.range("2026-04-01|today")],
    columns: [c("staffNo", "Staff No.", "mono"), c("name", "Name"), c("casual", "Casual", "count", true), c("sick", "Sick", "count", true), c("other", "Other", "count", true), c("remaining", "Casual left", "count")],
    tags: ["leave"],
  }),

  // ---------------- Timetable (doc 02 §A12) ----------------
  def({
    id: "tt-class",
    name: "Class timetable",
    module: "TIMETABLE",
    description: "A section's week: subject and teacher in every period.",
    replaces: ["Class Time Schedule", "Class Time Table Slip", "Section-wise master", "Day-wise timetable"],
    improvement: "Class Time Schedule did not open in the old software.",
    ownerPath: "/timetable",
    ownerLabel: "Timetable",
    permission: "timetable.view",
    filters: [F.classSection()],
    columns: [c("day", "Day")],
    paper: "A4_LANDSCAPE",
    singleCampus: true,
    tags: ["timetable", "periods"],
  }),
  def({
    id: "tt-teacher",
    name: "Teacher timetables and load",
    module: "TIMETABLE",
    description: "Periods per week for every teacher, the classes they teach and their free periods.",
    replaces: ["Staff Time Schedule", "Staff Day Time Schedule", "Time Table Teacher", "Teacher-wise timetable", "Level-wise timetable"],
    improvement: "Teacher timetable reports came out empty or did not open in the old software (missing data sources).",
    ownerPath: "/timetable/teachers",
    ownerLabel: "Timetable → Teachers",
    permission: "timetable.view",
    filters: [],
    columns: [c("teacher", "Teacher"), c("periods", "Periods a week", "count", true), c("free", "Free periods", "count"), c("classes", "Classes")],
    tags: ["teacher", "load"],
  }),

  // ---------------- Library (doc 04 §M1) ----------------
  def({
    id: "lib-catalogue",
    name: "Library catalogue",
    module: "LIBRARY",
    description: "Every title with author, category, cabinet, copies held and copies on the shelf.",
    replaces: ["Book Info", "Book Info Cabinet Wise", "Authors List", "Book Title Wise Count", "Cabinet Info"],
    ownerPath: "/library",
    ownerLabel: "Library",
    permission: "library.view",
    // Options come from the library module's own subjects and cabinets (live data in handlers/operations.ts).
    filters: [
      F.select("category", "Subject", [["", "All"], ...LIB_CATEGORIES.map((x): [string, string] => [x.id, x.name])]),
      F.select("cabinet", "Cabinet", [["", "All cabinets"], ...LIB_CABINET_CODES().map(([code, title]): [string, string] => [code, `${code} · ${title}`])]),
    ],
    columns: [c("accession", "Accession numbers", "mono"), c("title", "Title"), c("author", "Author"), c("category", "Subject"), c("cabinet", "Cabinet"), c("copies", "Copies", "count", true), c("available", "On shelf", "count", true)],
    tags: ["books", "catalogue"],
  }),
  def({
    id: "lib-issued",
    name: "Books issued and overdue",
    module: "LIBRARY",
    description: "Books out with students and staff, when they are due back and the fine so far.",
    replaces: ["Student Book Issuance", "Staff Book Issuance", "Book History"],
    ownerPath: "/library",
    ownerLabel: "Library",
    permission: "library.view",
    filters: [F.select("status", "Show", [["", "All books out"], ["overdue", "Overdue only"]]), F.select("borrower", "Borrower", [["", "Everyone"], ["student", "Students"], ["staff", "Staff"]])],
    columns: [c("accession", "Accession", "mono"), c("title", "Title"), c("borrowerId", "G.R. / staff no.", "mono"), c("borrower", "Borrower"), c("of", "Class / staff"), c("issued", "Issued", "date"), c("due", "Due back", "date"), c("days", "Days overdue", "count"), c("fine", "Fine", "money", true)],
    tags: ["issued", "overdue", "fine"],
  }),

  // ---------------- Warehouse (doc 04 §M2) ----------------
  def({
    id: "wh-stock",
    name: "Current stock",
    module: "WAREHOUSE",
    description: "Every item: received, issued and in stock now, with the items below reorder level marked.",
    replaces: ["Current Stock"],
    ownerPath: "/warehouse",
    ownerLabel: "Warehouse",
    permission: "warehouse.view",
    filters: [F.select("category", "Category", [["", "All"], ...WH_CATEGORIES.map((x): [string, string] => [x.id, x.name])])],
    columns: [c("code", "Item code", "mono"), c("item", "Item"), c("unit", "Unit"), c("received", "Received", "count"), c("issued", "Issued or sold", "count"), c("stock", "In stock", "count"), c("reorder", "Reorder at", "count"), c("value", "Stock value", "money", true)],
    tags: ["stock", "inventory"],
  }),
  def({
    id: "wh-issued",
    name: "Items issued to departments",
    module: "WAREHOUSE",
    description: "What the store issued, to which department and person, in a period.",
    replaces: ["Item Issuance", "Item Request", "Item Return"],
    ownerPath: "/warehouse",
    ownerLabel: "Warehouse",
    permission: "warehouse.view",
    filters: [
      F.range(),
      F.select("department", "Department", [["", "All departments"], ...WH_DEPARTMENT_NAMES.map((n): [string, string] => [n, n])]),
      F.select("room", "Room", [["", "All rooms"], ...WH_ROOM_NAMES.map((n): [string, string] => [n, n])]),
    ],
    columns: [c("date", "Date", "date"), c("issueNo", "Issue No.", "mono"), c("item", "Item"), c("kind", "Kind"), c("qty", "Issued", "count", true), c("returned", "Returned", "count", true), c("remaining", "Still out", "count", true), c("department", "Department"), c("room", "Room"), c("to", "Received by")],
    paper: "A4_LANDSCAPE",
    tags: ["issued", "requests"],
  }),
  def({
    id: "wh-purchases",
    name: "Purchases received",
    module: "WAREHOUSE",
    description: "Goods received from suppliers in a period with the invoice amount.",
    replaces: ["Purchase Invoice", "Item History"],
    ownerPath: "/warehouse",
    ownerLabel: "Warehouse",
    permission: "warehouse.view",
    filters: [
      F.range("2026-09-01|today"),
      F.select("supplier", "Supplier", [["", "All suppliers"], ...WH_SUPPLIER_NAMES().map((n): [string, string] => [n, n])]),
      F.select("item", "Item", [["", "All items"], ...WH_ITEM_GROUPS().map((n): [string, string] => [n, n])]),
    ],
    columns: [c("date", "Date", "date"), c("grn", "Receipt No.", "mono"), c("supplier", "Supplier"), c("invoice", "Supplier invoice", "mono"), c("items", "Items"), c("amount", "Amount", "money", true)],
    tags: ["purchases", "suppliers"],
  }),

  // ---------------- Transport (doc 04 §M4) ----------------
  def({
    id: "trn-riders",
    name: "Students by vehicle and route",
    module: "TRANSPORT",
    description: "Which students use each van or bus, their stop and transport fee.",
    replaces: ["Student Holding Vehicle Wise"],
    improvement: "This report existed in the old software but no screen opened it.",
    ownerPath: "/transport",
    ownerLabel: "Transport",
    permission: "transport.view",
    // Route codes are the transport module's own (R-01 …); each campus numbers its routes from R-01.
    filters: [F.select("route", "Route", [["", "All routes"], ...Array.from({ length: 9 }, (_, i): [string, string] => [`R-0${i + 1}`, `Route R-0${i + 1}`])])],
    columns: [c("route", "Route"), c("vehicle", "Vehicle", "mono"), c("grNo", "G.R. No.", "mono"), c("student", "Student"), c("classSection", "Class"), c("stop", "Stop"), c("fee", "Monthly fee", "money", true)],
    tags: ["routes", "vans", "students"],
  }),
  def({
    id: "trn-fuel",
    name: "Fuel and running cost",
    module: "TRANSPORT",
    description: "Trips, distance, fuel and cost per kilometre for each vehicle in a month.",
    replaces: ["Fueling", "Tour"],
    improvement: "Both reports existed in the old software but no screen opened them.",
    ownerPath: "/transport",
    ownerLabel: "Transport",
    permission: "transport.view",
    filters: [F.month()],
    columns: [c("vehicle", "Vehicle", "mono"), c("type", "Type"), c("trips", "Trips", "count", true), c("km", "Kilometres", "count", true), c("litres", "Litres", "count", true), c("cost", "Fuel cost", "money", true), c("perKm", "Rs per km", "money")],
    chart: { kind: "column", label: "Fuel cost by vehicle", x: "vehicle", y: "cost" },
    tags: ["fuel", "vehicles"],
  }),

  // ---------------- Messages (doc 04 §S2, screenshots 11) ----------------
  def({
    id: "msg-log",
    name: "Message log",
    module: "MESSAGES",
    description: "Every SMS and app notification sent in a period: to whom, what kind, and whether it was delivered. Prepared in the background.",
    replaces: ["SMS Log Report"],
    improvement: "The old log only knew whether the gateway accepted a message. This one shows delivered, failed with the reason, opted out, and app notifications.",
    ownerPath: "/sms/delivery",
    ownerLabel: "Messages → Delivery",
    permission: "sms.view",
    filters: [F.range("2026-10-01|today"), F.select("category", "Kind", [["", "All"], ["ATTENDANCE", "Attendance"], ["FEE", "Fees"], ["RESULT", "Results"], ["NOTICE", "Notices"]])],
    columns: [c("date", "Date", "date"), c("grNo", "G.R. No.", "mono"), c("student", "Student"), c("father", "Father"), c("gender", "Gender"), c("classSection", "Class"), c("mobile", "Mobile", "mono"), c("category", "Kind"), c("channel", "Channel"), c("status", "Status", "status")],
    background: true,
    paper: "A4_LANDSCAPE",
    tags: ["sms", "log", "delivery"],
  }),
  def({
    id: "msg-cost",
    name: "Messaging cost by month",
    module: "MESSAGES",
    description: "SMS parts, app notifications and what messaging cost each month — and what the app saved.",
    replaces: [],
    isNew: true,
    ownerPath: "/sms",
    ownerLabel: "Messages",
    permission: "sms.view",
    filters: [],
    columns: [c("month", "Month"), c("messages", "Messages", "count", true), c("parts", "SMS parts", "count", true), c("app", "App notifications", "count", true), c("cost", "Cost", "money", true), c("saved", "Saved by the app", "money", true)],
    chart: { kind: "column", label: "Cost per month", x: "month", y: "cost" },
    tags: ["cost", "sms", "budget"],
  }),
];

export const reportById = (id: string) => REPORT_DEFINITIONS.find((r) => r.id === id);

/** Reports favourited for every user until they change their own list. */
export const DEFAULT_FAVOURITES = ["fee-daily-summary", "fee-defaulters", "att-daily", "students-strength"];
