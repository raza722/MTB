import type {
  CampusCode,
  HrAuditEntry,
  HrCampusSettings,
  HrCategory,
  HrDepartment,
  HrDesignation,
  HrDocumentKind,
  HrEmergencyContact,
  HrEmploymentType,
  HrExperience,
  HrGender,
  HrIncrementCriteria,
  HrLeaveType,
  HrLoanType,
  HrMaritalStatus,
  HrPayDefaults,
  HrPaymentMethod,
  HrQualification,
  HrRelation,
  HrSalaryReason,
  HrStaffStatus,
} from "@mtb/api";
import type { IsoDate, IsoDateTime } from "@mtb/domain";
import { campusName, tuitionFor } from "./campuses";
import { initialTeachers } from "./setup";

// Staff and payroll fixtures — owned by the hr feature. Every person here is fictional. Staff numbers, names and
// sign-in user names were chosen to match the old demo accounts and the class teachers in the timetable.

/* ================================================================== Deterministic randomness */

/** A number in [0, 1) from a string, the same on every load. */
export function hash01(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const pickBy = <T,>(xs: readonly T[], key: string): T => xs[Math.floor(hash01(key) * xs.length)]!;
const pad = (n: number, w = 4) => String(n).padStart(w, "0");

/* ================================================================== Lookups */

export const PAY_SCALES = ["12", "13", "14", "15", "16", "17", "18", "19"];
export const TEACHING_LEVELS = ["Pre-primary", "Primary", "Middle", "Secondary (Matric)", "Intermediate (College)"];
export const BANKS = ["Meezan Bank", "HBL", "Allied Bank", "Bank Alfalah", "UBL", "MCB Bank", "National Bank"];

export const DESIGNATIONS: Array<Omit<HrDesignation, "staff">> = [
  { id: "d-principal", title: "Principal", category: "MANAGEMENT", active: true },
  { id: "d-vp", title: "Vice principal", category: "MANAGEMENT", active: true },
  { id: "d-head", title: "Section head", category: "MANAGEMENT", active: true },
  { id: "d-senior", title: "Senior teacher", category: "TEACHING", active: true },
  { id: "d-teacher", title: "Teacher", category: "TEACHING", active: true },
  { id: "d-lecturer", title: "Lecturer", category: "TEACHING", active: true },
  { id: "d-visiting", title: "Visiting lecturer", category: "VISITING", active: true },
  { id: "d-qari", title: "Hifz teacher (Qari)", category: "HIFZ", active: true },
  { id: "d-sysadmin", title: "System administrator", category: "NON_TEACHING", active: true },
  { id: "d-accountant", title: "Accountant", category: "NON_TEACHING", active: true },
  { id: "d-cashier", title: "Cashier", category: "NON_TEACHING", active: true },
  { id: "d-office", title: "Office assistant", category: "NON_TEACHING", active: true },
  { id: "d-clerk", title: "Clerk", category: "NON_TEACHING", active: true },
  { id: "d-librarian", title: "Librarian", category: "NON_TEACHING", active: true },
  { id: "d-labasst", title: "Lab assistant", category: "NON_TEACHING", active: true },
  { id: "d-store", title: "Store keeper", category: "NON_TEACHING", active: true },
  { id: "d-driver", title: "Driver", category: "NON_TEACHING", active: true },
  { id: "d-guard", title: "Security guard", category: "NON_TEACHING", active: true },
  { id: "d-peon", title: "Naib qasid", category: "NON_TEACHING", active: true },
  { id: "d-aya", title: "Aya (classroom helper)", category: "NON_TEACHING", active: true },
  { id: "d-sanitary", title: "Sanitary worker", category: "NON_TEACHING", active: true },
  { id: "d-computer", title: "Computer operator", category: "NON_TEACHING", active: false },
];

export const DEPARTMENTS: Array<Omit<HrDepartment, "staff">> = [
  { id: "dp-head", title: "Head office", active: true },
  { id: "dp-admin", title: "Administration", active: true },
  { id: "dp-accounts", title: "Accounts and fee office", active: true },
  { id: "dp-pre", title: "Pre-primary", active: true },
  { id: "dp-pri", title: "Primary", active: true },
  { id: "dp-mid", title: "Middle", active: true },
  { id: "dp-sec", title: "Secondary (Matric)", active: true },
  { id: "dp-col", title: "College", active: true },
  { id: "dp-hifz", title: "Shoba-e-Hifz", active: true },
  { id: "dp-lib", title: "Library", active: true },
  { id: "dp-lab", title: "Science and computer labs", active: true },
  { id: "dp-transport", title: "Transport", active: true },
  { id: "dp-support", title: "Support services", active: true },
  { id: "dp-security", title: "Security", active: true },
];

/** Legacy leave types (CASUAL 10, ANNUAL 14, SICK 10, EMERGENCY 5) plus maternity and unpaid leave. */
export const LEAVE_TYPES: HrLeaveType[] = [
  { id: "lt-casual", code: "CASUAL", name: "Casual leave", daysPerYear: 10, paid: true, proofAfterDays: null, active: true },
  { id: "lt-annual", code: "ANNUAL", name: "Annual leave", daysPerYear: 14, paid: true, proofAfterDays: null, active: true },
  { id: "lt-sick", code: "SICK", name: "Sick leave", daysPerYear: 10, paid: true, proofAfterDays: 2, active: true },
  { id: "lt-emergency", code: "EMERGENCY", name: "Emergency leave", daysPerYear: 5, paid: true, proofAfterDays: null, active: true },
  { id: "lt-maternity", code: "MATERNITY", name: "Maternity leave", daysPerYear: 90, paid: true, proofAfterDays: 1, active: true },
  { id: "lt-unpaid", code: "UNPAID", name: "Unpaid leave", daysPerYear: null, paid: false, proofAfterDays: null, active: true },
];

/** Legacy loan types: "Advance Salary Loan" and personal loans; medical added. */
export const LOAN_TYPES: HrLoanType[] = [
  { id: "ln-advance", name: "Salary advance", kind: "ADVANCE", maxTimesBasic: 0.5, maxInstallments: 1, active: true },
  { id: "ln-personal", name: "Personal loan", kind: "LOAN", maxTimesBasic: 2, maxInstallments: 12, active: true },
  { id: "ln-medical", name: "Medical loan", kind: "LOAN", maxTimesBasic: 3, maxInstallments: 12, active: true },
  { id: "ln-marriage", name: "Marriage loan", kind: "LOAN", maxTimesBasic: 3, maxInstallments: 18, active: true },
];

export const PAY_DEFAULTS: HrPayDefaults = { houseRentPct: 45, conveyance: 2500, medical: 2000, eobi: 400, providentFundPct: 5 };
/** Staff without a pay scale (support staff) get a smaller house rent share. */
export const NO_SCALE_HOUSE_RENT_PCT = 30;

/** Basic pay on appointment per scale (fictional). */
export const SCALE_BASE: Record<string, number> = { "12": 20000, "13": 22000, "14": 24500, "15": 27500, "16": 32000, "17": 39000, "18": 50000, "19": 62000 };

/** Annual increment per scale by years of service, half-open bands [0,3) [3,6) [6,10) [10,15) [15,50). Fictional figures. */
const CRITERIA_TABLE: Record<string, number[]> = {
  "12": [600, 700, 800, 900, 1000],
  "13": [650, 750, 900, 1050, 1200],
  "14": [700, 850, 1000, 1150, 1300],
  "15": [800, 950, 1150, 1300, 1500],
  "16": [900, 1100, 1300, 1500, 1750],
  "17": [1100, 1350, 1600, 1850, 2100],
  "18": [1300, 1600, 1900, 2200, 2500],
  "19": [1600, 1950, 2300, 2650, 3000],
};
const BANDS: Array<[number, number]> = [
  [0, 3],
  [3, 6],
  [6, 10],
  [10, 15],
  [15, 50],
];

export function initialCriteria(): HrIncrementCriteria[] {
  return Object.entries(CRITERIA_TABLE).flatMap(([scale, amounts]) =>
    amounts.map((amount, i) => ({ id: `ic-${scale}-${i}`, payScale: scale, fromYears: BANDS[i]![0], toYears: BANDS[i]![1], amount, active: true })),
  );
}

export function criteriaAmount(criteria: HrIncrementCriteria[], scale: string | null, years: number): number {
  if (!scale || scale === "0") return 0;
  const row = criteria.find((c) => c.active && c.payScale === scale && years >= c.fromYears && years < c.toYears);
  return row?.amount ?? 0;
}

export interface CampusSettingsRec extends Omit<HrCampusSettings, "schoolAccount" | "campusName"> {
  schoolAccount: { bankName: string; branch: string; accountTitle: string; accountNo: string } | null;
}

/** Which campuses prepare salaries and take fingerprint attendance in the system (a setting per campus). */
export function initialCampusSettings(): CampusSettingsRec[] {
  const base = { dayStarts: "07:45", graceMinutes: 10, daysDivisor: 26, lateRule: { lates: 3, days: 0.5 }, salaryDay: 5 };
  return [
    { campus: "KC", runsPayroll: true, attendanceDevice: true, deviceName: "ZKTeco K40 · staff room", ...base, schoolAccount: { bankName: "Meezan Bank", branch: "Sadiqabad branch", accountTitle: "MTB Khalid Campus — Salaries", accountNo: "0102-01044417" } },
    { campus: "SM", runsPayroll: false, attendanceDevice: false, deviceName: null, ...base, lateRule: null, schoolAccount: null },
    { campus: "UC", runsPayroll: false, attendanceDevice: false, deviceName: null, ...base, lateRule: null, schoolAccount: null },
    { campus: "MC", runsPayroll: false, attendanceDevice: false, deviceName: null, ...base, dayStarts: "08:00", lateRule: null, schoolAccount: null },
    { campus: "HC", runsPayroll: true, attendanceDevice: true, deviceName: "ZKTeco MB360 · main gate", ...base, schoolAccount: { bankName: "Allied Bank", branch: "Johar Town branch, Lahore", accountTitle: "MTB Humaira Campus — Salaries", accountNo: "0010-00387781" } },
  ];
}

/* ================================================================== Staff records (as the mock server stores them) */

export interface PostingRec {
  id: string;
  campus: CampusCode;
  designationId: string;
  departmentId: string;
  employmentType: HrEmploymentType;
  payScale: string | null;
  startDate: IsoDate;
  endDate: IsoDate | null;
  endReason: string | null;
  primary: boolean;
  daysPerWeek: number | null;
  /** Weekdays worked at this campus (1 = Monday … 6 = Saturday); null = Monday to Saturday. */
  workDays: number[] | null;
  deviceEnrolNo: string | null;
  classTeacherOf: string | null;
}

export interface DocRec {
  id: string;
  kind: HrDocumentKind;
  title: string;
  fileName: string | null;
  sizeKb: number | null;
  uploadedAt: IsoDateTime | null;
  uploadedBy: string | null;
  required: boolean;
}

export interface SalaryRec {
  id: string;
  effectiveFrom: IsoDate;
  basic: number;
  reason: HrSalaryReason;
  note: string;
  by: string;
}

export interface BankRec {
  bankName: string;
  branch: string;
  accountTitle: string;
  accountNo: string;
}

export interface StaffRec {
  id: string;
  employeeNo: string;
  name: string;
  nameUrdu: string | null;
  gender: HrGender;
  relation: HrRelation;
  guardianName: string;
  cnic: string;
  dob: IsoDate;
  bloodGroup: string;
  maritalStatus: HrMaritalStatus;
  religion: string;
  mobile: string;
  mobile2: string | null;
  email: string | null;
  address: string;
  city: string;
  emergency: HrEmergencyContact;
  /** Who recommended the candidate (optional: records saved before it existed have none). */
  reference?: string | null;
  caste?: string | null;
  priorServiceYears: number;
  probationEnds: IsoDate | null;
  status: HrStaffStatus;
  leavingDate: IsoDate | null;
  leavingReason: string | null;
  postings: PostingRec[];
  qualifications: HrQualification[];
  experience: HrExperience[];
  teachingLevels: string[];
  subjectIds: string[];
  documents: DocRec[];
  salary: SalaryRec[];
  pay: { specialAllowance: number; paymentMethod: HrPaymentMethod; bank: BankRec | null; eobi: boolean; providentFund: boolean };
  children: Array<{ grNo: string; name: string; classSection: string; campus: CampusCode; monthlyFee: number; adjustAgainstSalary: boolean }>;
  userName: string | null;
  history: HrAuditEntry[];
  rowVer: number;
}

/* ---------------------------------------------------------------- Name pools (fictional) */

const F_FIRST = ["Amina", "Asma", "Bushra", "Farhana", "Huma", "Iram", "Javeria", "Kanwal", "Madiha", "Nabila", "Naila", "Nazia", "Nosheen", "Rafia", "Robina", "Rubina", "Saba", "Shabnam", "Shagufta", "Shamim", "Sidra", "Sobia", "Tayyaba", "Yasmin", "Zahida", "Zara", "Zubaida", "Afshan", "Fozia", "Mehreen", "Sumera", "Tasneem", "Faiza", "Quratulain", "Aneela", "Hajra", "Misbah", "Naheed", "Rizwana", "Shazia", "Farzana", "Atiya", "Bilqees", "Saadia", "Uzma", "Nasreen", "Ghazala", "Kausar"];
const M_FIRST = ["Abdul Basit", "Ahsan", "Amjad", "Asad", "Atif", "Babar", "Fawad", "Hamid", "Haroon", "Ijaz", "Irfan", "Jamshed", "Junaid", "Khurram", "Liaqat", "Majid", "Mansoor", "Mudassar", "Mukhtar", "Obaid", "Qaiser", "Rizwan", "Saleem", "Sarfraz", "Shakeel", "Umair", "Waseem", "Yasir", "Zeeshan", "Muhammad Aslam", "Muhammad Akram", "Ghulam Rasool", "Allah Ditta", "Manzoor", "Bashir", "Nazir"];
const LAST = ["Ahmed", "Akhtar", "Anjum", "Arshad", "Aslam", "Aziz", "Bashir", "Butt", "Chaudhry", "Farooq", "Ghani", "Hameed", "Haider", "Iqbal", "Jamil", "Kausar", "Latif", "Mahmood", "Malik", "Mughal", "Munir", "Nawaz", "Qureshi", "Rafiq", "Rasheed", "Riaz", "Saeed", "Sajjad", "Shahzad", "Sharif", "Sultan", "Zafar", "Bibi", "Perveen", "Sabir", "Waheed"];
const FATHERS = ["Muhammad Ashraf", "Abdul Ghafoor", "Ghulam Hussain", "Muhammad Ramzan", "Allah Bakhsh", "Muhammad Yaqoob", "Abdul Majeed", "Muhammad Saleem", "Noor Muhammad", "Muhammad Rafique", "Abdul Rauf", "Khadim Hussain"];
const BLOOD = ["A+", "B+", "O+", "AB+", "A−", "B−", "O−", "B+", "O+", "A+"];
const UNIS = ["Islamia University, Bahawalpur", "Bahauddin Zakariya University, Multan", "University of the Punjab, Lahore", "Allama Iqbal Open University", "Govt. Khawaja Fareed College, Rahim Yar Khan", "Govt. College for Women, Sadiqabad", "Lahore College for Women University"];
const PREV_SCHOOLS = ["Al-Huda Grammar School, Sadiqabad", "Crescent Model School, Rahim Yar Khan", "Iqra Public School, Khanpur", "Govt. Girls High School, Sadiqabad", "Green Valley School, Liaquatpur", "Faran Model School, Lahore"];
const TOWNS: Record<CampusCode, string[]> = {
  KC: ["Sadiqabad"],
  SM: ["Sadiqabad", "Rahim Yar Khan"],
  UC: ["Sadiqabad", "Khanpur"],
  MC: ["Sadiqabad", "Liaquatpur"],
  HC: ["Lahore"],
};
const STREETS: Record<CampusCode, string[]> = {
  KC: ["Model Town", "Satellite Town", "Gulshan Colony", "Officers Colony", "Abbas Nagar", "Ghalla Mandi Road"],
  SM: ["Sugar Mill Colony", "Canal Road", "Jamaldin Wali Road"],
  UC: ["Ubaid Colony", "Railway Road", "City Road"],
  MC: ["Majeed Town", "Chak 125/P", "Bypass Road"],
  HC: ["Johar Town", "Township", "Wapda Town", "Model Town Extension"],
};

const usedNames = new Set<string>();

function uniqueName(gender: HrGender, key: string, titled: boolean): string {
  for (let i = 0; i < 200; i++) {
    const first = pickBy(gender === "F" ? F_FIRST : M_FIRST, `${key}|f|${i}`);
    const last = pickBy(LAST, `${key}|l|${i}`);
    if (gender === "M" && last === "Bibi") continue;
    if (first.split(" ").at(-1) === last) continue;
    if (gender === "F" && (last === "Perveen" || last === "Bibi") && !titled) continue;
    const body = `${first} ${last}`;
    const full = titled ? `${gender === "F" ? "Ms" : "Mr"} ${body}` : body;
    if (!usedNames.has(full) && !usedNames.has(body)) {
      usedNames.add(full);
      return full;
    }
  }
  throw new Error("name pool exhausted");
}

/* ---------------------------------------------------------------- Builders */

const yearsBetween = (from: IsoDate, to: IsoDate) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / (365.25 * 86_400_000);
const addYears = (d: IsoDate, y: number) => `${Number(d.slice(0, 4)) + y}${d.slice(4)}`;
const addMonths = (d: IsoDate, n: number) => {
  const total = Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1 + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1, 2)}${d.slice(7)}`;
};

interface Seed {
  key: string;
  name?: string;
  gender: HrGender;
  campus: CampusCode;
  employeeNo?: string;
  designationId: string;
  departmentId: string;
  type?: HrEmploymentType;
  scale?: string | null;
  joined: IsoDate;
  urdu?: string;
  user?: string;
  classTeacherOf?: string | null;
  subjects?: string[];
  levels?: string[];
  special?: number;
  status?: HrStaffStatus;
  leaving?: { date: IsoDate; reason: string };
  workDays?: number[] | null;
  daysPerWeek?: number | null;
  noDevice?: boolean;
  married?: boolean;
  relation?: HrRelation;
  guardian?: string;
}

const SUPPORT_BASIC: Record<string, number> = { "d-driver": 31000, "d-guard": 29000, "d-peon": 28000, "d-aya": 28000, "d-sanitary": 28000 };

/** Basic pay history: appointment (or the figure carried over from the old system), then each 1-December increment. */
function salaryHistory(seed: Seed, criteria: HrIncrementCriteria[]): SalaryRec[] {
  const scale = seed.scale ?? null;
  const rows: SalaryRec[] = [];
  const legacyCut = "2022-08-01";
  if (seed.designationId === "d-visiting") {
    rows.push({ id: "sh-1", effectiveFrom: seed.joined, basic: 36000, reason: "APPOINTMENT", note: "Fixed monthly fee for visiting lecturers", by: "Mrs Sadia Rehman" });
    return rows;
  }
  if (seed.type === "CONTRACT") {
    rows.push({ id: "sh-1", effectiveFrom: seed.joined, basic: 26000, reason: "APPOINTMENT", note: "Part-time contract: three days a week", by: "Mrs Sadia Rehman" });
    return rows;
  }
  if (!scale) {
    const base = SUPPORT_BASIC[seed.designationId] ?? 28000;
    const start = seed.joined < legacyCut ? legacyCut : seed.joined;
    const first = Math.max(22000, base - 4000);
    rows.push({ id: "sh-1", effectiveFrom: start, basic: first, reason: seed.joined < legacyCut ? "LEGACY" : "APPOINTMENT", note: seed.joined < legacyCut ? "Salary carried over from the old system" : "Appointed", by: seed.joined < legacyCut ? "Migration" : "Mrs Sadia Rehman" });
    if (start < "2025-07-01") rows.push({ id: "sh-2", effectiveFrom: "2025-07-01", basic: base, reason: "REVISION", note: "Minimum wage revision 2025–26: gross pay kept above the legal minimum", by: "Nadia Shah" });
    else rows[0]!.basic = base;
    return rows;
  }
  let basic = SCALE_BASE[scale]!;
  const preYears = Math.max(0, Math.floor(yearsBetween(seed.joined, legacyCut)));
  for (let k = 1; k <= Math.min(preYears, 15); k++) basic += criteriaAmount(criteria, scale, k);
  if (seed.joined < legacyCut) rows.push({ id: "sh-1", effectiveFrom: legacyCut, basic, reason: "LEGACY", note: "Salary carried over from the old system", by: "Migration" });
  else rows.push({ id: "sh-1", effectiveFrom: seed.joined, basic, reason: "APPOINTMENT", note: "Appointed", by: "Mrs Sadia Rehman" });
  for (const year of [2022, 2023, 2024, 2025]) {
    const cut = `${year}-11-30`;
    if (seed.joined > cut) continue;
    const yrs = Math.round((yearsBetween(seed.joined, cut) + 0) * 10) / 10;
    if (yrs < 1) continue;
    const amount = criteriaAmount(criteria, scale, yrs);
    if (!amount) continue;
    basic += amount;
    rows.push({ id: `sh-${rows.length + 1}`, effectiveFrom: `${year}-12-01`, basic, reason: "INCREMENT", note: `Annual increment ${year}–${String((year + 1) % 100).padStart(2, "0")}`, by: year === 2025 ? "Mrs Sadia Rehman" : "Migration" });
  }
  return rows;
}

function qualificationsFor(seed: Seed, cat: HrCategory): HrQualification[] {
  const k = seed.key;
  const year = Number(seed.joined.slice(0, 4)) - 1 - Math.floor(hash01(`${k}|qy`) * 3);
  if (cat === "TEACHING" || cat === "MANAGEMENT" || cat === "VISITING") {
    const subject = pickBy(["English", "Mathematics", "Urdu", "Physics", "Chemistry", "Biology", "Islamic Studies", "Computer Science", "Education", "Pakistan Studies"], `${k}|qs`);
    const masters = seed.designationId === "d-lecturer" || seed.designationId === "d-visiting" ? "M.Phil." : pickBy(["M.A.", "M.Sc.", "M.A.", "B.S. (4 years)"], `${k}|qd`);
    return [
      { id: "q1", degree: `${masters} ${subject}`, subject, institution: pickBy(UNIS, `${k}|u1`), year, result: pickBy(["First division", "CGPA 3.4", "Second division", "CGPA 3.1", "First division"], `${k}|r1`) },
      { id: "q2", degree: "B.Ed.", subject: "Education", institution: pickBy(UNIS, `${k}|u2`), year: year - 1, result: pickBy(["First division", "Second division"], `${k}|r2`) },
    ];
  }
  if (cat === "HIFZ") return [{ id: "q1", degree: "Shahadat-ul-Aalmiya (Dars-e-Nizami)", subject: "Hifz and Tajweed", institution: "Wifaq-ul-Madaris", year, result: "Mumtaz" }];
  if (["d-accountant", "d-cashier", "d-sysadmin", "d-office", "d-clerk", "d-librarian"].includes(seed.designationId)) {
    const deg = { "d-accountant": "B.Com (Hons)", "d-cashier": "B.Com", "d-sysadmin": "BS Computer Science", "d-office": "B.A.", "d-clerk": "I.Com", "d-librarian": "M.A. Library and Information Science" }[seed.designationId]!;
    const subject = { "d-accountant": "Commerce", "d-cashier": "Commerce", "d-sysadmin": "Computer Science", "d-office": "Arts", "d-clerk": "Commerce", "d-librarian": "Library Science" }[seed.designationId]!;
    return [{ id: "q1", degree: deg, subject, institution: pickBy(UNIS, `${k}|u1`), year, result: "Second division" }];
  }
  return [{ id: "q1", degree: pickBy(["Matric", "Middle", "Matric", "F.A."], `${k}|qd`), subject: "General", institution: "Board of Intermediate and Secondary Education, Bahawalpur", year: year - 6, result: "Pass" }];
}

function experienceFor(seed: Seed, cat: HrCategory): HrExperience[] {
  if (!(cat === "TEACHING" || cat === "MANAGEMENT") || hash01(`${seed.key}|ex`) < 0.45) return [];
  const yrs = 1 + Math.floor(hash01(`${seed.key}|exy`) * 4);
  const to = `${seed.joined.slice(0, 7)}-01`;
  return [{ id: "x1", organisation: pickBy(PREV_SCHOOLS, `${seed.key}|exo`), role: "Teacher", from: addYears(to, -yrs), to }];
}

function documentsFor(seed: Seed, cat: HrCategory, empNo: string): DocRec[] {
  const slug = empNo.toLowerCase();
  const kinds: HrDocumentKind[] = ["CNIC", "PHOTO", "APPOINTMENT"];
  if (cat !== "NON_TEACHING" || ["d-accountant", "d-cashier", "d-sysadmin", "d-librarian"].includes(seed.designationId)) kinds.push("DEGREE");
  if (cat === "NON_TEACHING") kinds.push("POLICE");
  if (seed.type === "CONTRACT" || seed.type === "VISITING") kinds.push("CONTRACT");
  const uploadedAt = `${seed.joined < "2022-08-01" ? "2022-08-01" : seed.joined}T10:00:00+05:00`;
  const docs: DocRec[] = kinds.map((kind, i) => {
    const missing = (kind === "POLICE" && hash01(`${seed.key}|pol`) < 0.3) || (kind === "DEGREE" && hash01(`${seed.key}|deg`) < 0.08) || (seed.key === "mehwish" && kind === "POLICE");
    const file = `${kind.toLowerCase()}-${slug}.pdf`;
    return {
      id: `doc-${i + 1}`,
      kind,
      title: kind === "APPOINTMENT" ? "Signed appointment letter" : kind === "CNIC" ? "CNIC copy (both sides)" : kind === "PHOTO" ? "Passport-size photograph" : kind === "DEGREE" ? "Highest degree" : kind === "POLICE" ? "Police character certificate" : "Contract",
      fileName: missing ? null : kind === "PHOTO" ? `photo-${slug}.jpg` : file,
      sizeKb: missing ? null : 180 + Math.floor(hash01(`${seed.key}|sz${i}`) * 900),
      uploadedAt: missing ? null : uploadedAt,
      uploadedBy: missing ? null : seed.joined < "2022-08-01" ? "Scanned when records moved" : "Farah Naz",
      required: true,
    };
  });
  if (cat === "TEACHING" && hash01(`${seed.key}|exl`) < 0.4) docs.push({ id: `doc-${docs.length + 1}`, kind: "EXPERIENCE", title: "Experience letter from previous school", fileName: `experience-${slug}.pdf`, sizeKb: 240, uploadedAt, uploadedBy: "Farah Naz", required: false });
  return docs;
}

function cnicFor(seed: Seed): string {
  const area = seed.campus === "HC" ? "35202" : pickBy(["31303", "31301", "31304"], `${seed.key}|area`);
  const mid = String(1000000 + Math.floor(hash01(`${seed.key}|cnic`) * 8999999));
  const odd = [1, 3, 5, 7, 9];
  const even = [2, 4, 6, 8];
  const last = seed.gender === "M" ? pickBy(odd, `${seed.key}|cl`) : pickBy(even, `${seed.key}|cl`);
  return `${area}${mid}${last}`;
}

const mobileFor = (key: string) => `03${pickBy(["00", "01", "02", "03", "04", "05", "06", "07", "08", "09", "21", "33", "45"], `${key}|net`)}555${pad(Math.floor(hash01(`${key}|mob`) * 9999))}`;

function makeStaff(seed: Seed, idx: number, criteria: HrIncrementCriteria[]): StaffRec {
  const des = DESIGNATIONS.find((d) => d.id === seed.designationId)!;
  const cat = des.category;
  const type: HrEmploymentType = seed.type ?? (seed.joined >= "2026-05-01" ? "PROBATION" : "PERMANENT");
  const name = seed.name ?? uniqueName(seed.gender, seed.key, !["d-driver", "d-guard", "d-peon", "d-aya", "d-sanitary"].includes(seed.designationId));
  usedNames.add(name);
  const teaching = cat === "TEACHING" || cat === "VISITING" || cat === "HIFZ" || seed.designationId === "d-head";
  const empNo = seed.employeeNo ?? `${seed.campus}-${teaching ? "T" : "S"}-${pad(idx)}`;
  const num = Number(empNo.slice(-4));
  const enrol = seed.noDevice ? null : empNo.startsWith("HO") ? `9${pad(num, 3)}` : `${teaching ? 1 : 2}${pad(num, 3)}`;
  const town = pickBy(TOWNS[seed.campus], `${seed.key}|town`);
  const age = teaching ? 24 + Math.floor(hash01(`${seed.key}|age`) * 20) : 22 + Math.floor(hash01(`${seed.key}|age`) * 30);
  const joinYear = Number(seed.joined.slice(0, 4));
  const dobYear = Math.min(joinYear - 21, 2026 - age);
  const married = seed.married ?? hash01(`${seed.key}|mar`) < 0.62;
  const relation: HrRelation = seed.relation ?? (seed.gender === "M" ? "s/o" : married ? "w/o" : "d/o");
  const lastName = name.split(" ").slice(-1)[0]!;
  const guardian = seed.guardian ?? (relation === "w/o" ? `${pickBy(M_FIRST, `${seed.key}|hus`)} ${pickBy(LAST.filter((l) => l !== "Bibi" && l !== "Perveen"), `${seed.key}|husl`)}` : `${pickBy(FATHERS, `${seed.key}|fa`)}${lastName === "Bibi" || lastName === "Perveen" ? "" : ` ${lastName}`}`.trim());
  const salary = salaryHistory({ ...seed, type }, criteria);
  const bankPaid = cat !== "NON_TEACHING" || ["d-accountant", "d-cashier", "d-sysadmin", "d-office", "d-clerk", "d-librarian", "d-labasst", "d-store"].includes(seed.designationId) || hash01(`${seed.key}|bank`) < 0.35;
  const bankName = seed.campus === "HC" ? pickBy(["Allied Bank", "HBL", "Meezan Bank", "UBL", "MCB Bank"], `${seed.key}|bk`) : pickBy(["Meezan Bank", "HBL", "Meezan Bank", "Allied Bank", "National Bank", "UBL", "Bank Alfalah"], `${seed.key}|bk`);
  const accountNo = `${pad(Math.floor(hash01(`${seed.key}|ac1`) * 9999))}-${pad(Math.floor(hash01(`${seed.key}|ac2`) * 99999999), 8)}`;
  const levels = seed.levels ?? [];
  const posting: PostingRec = {
    id: "p1",
    campus: seed.campus,
    designationId: seed.designationId,
    departmentId: seed.departmentId,
    employmentType: type,
    payScale: seed.scale ?? null,
    startDate: seed.joined,
    endDate: seed.leaving?.date ?? null,
    endReason: seed.leaving?.reason ?? null,
    primary: true,
    daysPerWeek: seed.daysPerWeek ?? null,
    workDays: seed.workDays ?? null,
    deviceEnrolNo: enrol,
    classTeacherOf: seed.classTeacherOf ?? null,
  };
  return {
    id: `st-${empNo.toLowerCase()}`,
    employeeNo: empNo,
    name,
    nameUrdu: seed.urdu ?? null,
    gender: seed.gender,
    relation,
    guardianName: guardian,
    cnic: cnicFor(seed),
    dob: `${dobYear}-${pad(1 + Math.floor(hash01(`${seed.key}|dm`) * 12), 2)}-${pad(1 + Math.floor(hash01(`${seed.key}|dd`) * 27), 2)}`,
    bloodGroup: pickBy(BLOOD, `${seed.key}|bg`),
    maritalStatus: married ? "MARRIED" : "SINGLE",
    religion: "Islam",
    mobile: mobileFor(seed.key),
    mobile2: hash01(`${seed.key}|m2`) < 0.3 ? mobileFor(`${seed.key}|2`) : null,
    email: cat === "NON_TEACHING" && !bankPaid ? null : hash01(`${seed.key}|em`) < 0.55 ? `${name.replace(/^(Mr|Ms|Mrs|Dr|Qari)\s+/, "").toLowerCase().replace(/[^a-z]+/g, ".")}@mtb.edu.pk` : null,
    address: `House ${1 + Math.floor(hash01(`${seed.key}|hn`) * 240)}, Street ${1 + Math.floor(hash01(`${seed.key}|st`) * 18)}, ${pickBy(STREETS[seed.campus], `${seed.key}|area2`)}, ${town}`,
    city: town,
    emergency: { name: relation === "w/o" ? guardian : `${pickBy(M_FIRST, `${seed.key}|em1`)} ${lastName === "Bibi" ? "Ahmed" : lastName}`, relation: relation === "w/o" ? "Husband" : seed.gender === "M" && married ? "Wife" : "Brother", mobile: mobileFor(`${seed.key}|emg`) },
    reference: null,
    caste: null,
    priorServiceYears: hash01(`${seed.key}|prior`) < 0.12 ? Math.round(hash01(`${seed.key}|pv`) * 30) / 10 : 0,
    probationEnds: type === "PROBATION" ? addMonths(seed.joined, 6) : null,
    status: seed.status ?? "ACTIVE",
    leavingDate: seed.leaving?.date ?? null,
    leavingReason: seed.leaving?.reason ?? null,
    postings: [posting],
    qualifications: qualificationsFor(seed, cat),
    experience: experienceFor(seed, cat),
    teachingLevels: levels,
    subjectIds: seed.subjects ?? [],
    documents: documentsFor({ ...seed, type }, cat, empNo),
    salary,
    pay: {
      specialAllowance: seed.special ?? 0,
      paymentMethod: bankPaid ? "BANK" : "CASH",
      bank: bankPaid ? { bankName, branch: seed.campus === "HC" ? "Johar Town, Lahore" : `${town} branch`, accountTitle: name.replace(/^(Mr|Ms|Mrs|Dr|Qari)\s+/, ""), accountNo } : null,
      eobi: type !== "VISITING",
      providentFund: type === "PERMANENT" && cat !== "NON_TEACHING" ? true : type === "PERMANENT" && hash01(`${seed.key}|pf`) < 0.5,
    },
    children: [],
    userName: seed.user ?? null,
    history: [
      { id: "h1", at: `${seed.joined < "2022-08-01" ? "2026-02-01" : seed.joined}T09:00:00+05:00`, by: seed.joined < "2022-08-01" ? "Migration" : "Farah Naz", text: seed.joined < "2022-08-01" ? "Record moved from the old system" : "Staff record created" },
    ],
    rowVer: 1,
  };
}

/* ---------------------------------------------------------------- The staff list */

const LEVEL_OF = (cls: string): { dept: string; level: string } => {
  const c = cls.split("-")[0]!;
  if (c === "Prep") return { dept: "dp-pre", level: "Pre-primary" };
  const n = Number(c);
  if (n <= 5) return { dept: "dp-pri", level: "Primary" };
  if (n <= 8) return { dept: "dp-mid", level: "Middle" };
  return { dept: "dp-sec", level: "Secondary (Matric)" };
};

/** Sign-in staff numbers from the users list (fixtures/setup.ts). */
const KNOWN_NO: Record<string, string> = {
  "Ms Hina Javed": "KC-T-0142",
  "Mr Adeel Anwar": "KC-T-0118",
  "Ms Sana Tariq": "KC-T-0151",
  "Ms Rabia Nasir": "KC-T-0097",
  "Mr Imran Shafiq": "KC-T-0104",
  "Ms Nida Hussain": "KC-T-0126",
  "Ms Saima Akram": "KC-T-0088",
  "Mr Fahad Iqbal": "KC-T-0133",
  "Ms Mehwish Anjum": "KC-T-0166",
};
const URDU: Record<string, string> = {
  "Mrs Sadia Rehman": "سعدیہ رحمان",
  "Ms Hina Javed": "حنا جاوید",
  "Mr Adeel Anwar": "عدیل انور",
  "Ms Sana Tariq": "ثنا طارق",
  "Usman Ali": "عثمان علی",
  "Nadia Shah": "نادیہ شاہ",
  "Kamran Yousaf": "کامران یوسف",
  "Farah Naz": "فرح ناز",
};
const USER_OF: Record<string, string> = {
  "Mrs Sadia Rehman": "sadia.rehman",
  "Ms Hina Javed": "hina.javed",
  "Usman Ali": "usman.ali",
  "Nadia Shah": "nadia.shah",
  "Kamran Yousaf": "kamran.yousaf",
  "Farah Naz": "farah.naz",
  "Mr Adeel Anwar": "adeel.anwar",
  "Ms Sana Tariq": "sana.tariq",
};

/** Active staff per campus — the same strengths the setup pages show (KC 96, SM 41, UC 48, MC 30, HC 74). */
const TARGET: Record<CampusCode, number> = { KC: 96, SM: 41, UC: 48, MC: 30, HC: 74 };

const joinedFor = (key: string, minYear = 2005) => {
  const y = minYear + Math.floor(hash01(`${key}|jy`) * (2026 - minYear));
  const m = pickBy(["04", "04", "08", "08", "09", "01", "03"], `${key}|jm`);
  const d = pickBy(["01", "03", "05", "10", "15"], `${key}|jd`);
  const date = `${y}-${m}-${d}`;
  return date > "2026-09-30" ? "2025-08-11" : date;
};

const teacherScale = (key: string, des: string) => (des === "d-senior" ? "16" : des === "d-lecturer" ? "17" : hash01(`${key}|sc`) < 0.5 ? "14" : "15");

function campusSeeds(campus: CampusCode): Seed[] {
  const seeds: Seed[] = [];
  const add = (s: Seed) => seeds.push(s);
  const support: Array<[string, string, HrGender, number]> = [
    ["d-driver", "dp-transport", "M", campus === "KC" ? 3 : campus === "HC" ? 2 : 1],
    ["d-guard", "dp-security", "M", campus === "KC" ? 4 : campus === "HC" ? 3 : 2],
    ["d-peon", "dp-support", "M", campus === "KC" ? 4 : campus === "HC" ? 3 : 2],
    ["d-aya", "dp-support", "F", campus === "KC" ? 4 : campus === "HC" ? 3 : 2],
    ["d-sanitary", "dp-support", "M", campus === "KC" ? 3 : campus === "HC" ? 2 : 1],
    ["d-clerk", "dp-admin", campus === "HC" ? "F" : "M", campus === "KC" ? 2 : 1],
    ["d-labasst", "dp-lab", "M", campus === "KC" ? 1 : campus === "MC" ? 0 : 1],
  ];

  if (campus === "KC") {
    add({ key: "sadia", name: "Mrs Sadia Rehman", gender: "F", campus, employeeNo: "KC-S-0009", designationId: "d-principal", departmentId: "dp-admin", scale: "19", joined: "2008-04-01", special: 10000, married: true, guardian: "Abdul Rehman" });
    add({ key: "rehana", name: "Ms Rehana Kausar", gender: "F", campus, employeeNo: "KC-S-0012", designationId: "d-vp", departmentId: "dp-admin", scale: "18", joined: "2010-08-16", special: 6000 });
    add({ key: "samina", name: "Ms Samina Yasmeen", gender: "F", campus, employeeNo: "KC-T-0021", designationId: "d-head", departmentId: "dp-pri", scale: "17", joined: "2012-04-02", special: 4000, levels: ["Primary"], subjects: ["eng", "urd"] });
    add({ key: "kamran", name: "Kamran Yousaf", gender: "M", campus, employeeNo: "HO-S-0004", designationId: "d-sysadmin", departmentId: "dp-head", scale: "17", joined: "2014-09-01", special: 5000 });
    add({ key: "nadia", name: "Nadia Shah", gender: "F", campus, employeeNo: "HO-S-0031", designationId: "d-accountant", departmentId: "dp-head", scale: "16", joined: "2017-07-03", special: 4000 });
    add({ key: "usman", name: "Usman Ali", gender: "M", campus, employeeNo: "KC-S-0217", designationId: "d-cashier", departmentId: "dp-accounts", scale: "14", joined: "2019-01-14" });
    add({ key: "farah", name: "Farah Naz", gender: "F", campus, employeeNo: "KC-S-0188", designationId: "d-office", departmentId: "dp-admin", scale: "13", joined: "2018-05-07" });
    add({ key: "sohail", name: "Mr Sohail Ahmed", gender: "M", campus, employeeNo: "KC-S-0172", designationId: "d-cashier", departmentId: "dp-accounts", scale: "14", joined: "2016-03-01", status: "LEFT", leaving: { date: "2026-09-30", reason: "Resigned (one month's notice served)" } });
    // Class teachers and subject specialists, as in the timetable (Ms Kiran Javaid teaches at Humaira Campus).
    const teachers = initialTeachers().filter((t) => t.campus === "KC" && t.name !== "Ms Kiran Javaid");
    const classOf = new Map<string, string>();
    for (const [cls, tName] of Object.entries({ "7-A": "Mr Adeel Anwar", "7-B": "Ms Hina Javed", "7-C": "Ms Sana Tariq" })) classOf.set(tName, cls);
    const sections = ["Prep-A", "Prep-B", "1-A", "1-B", "2-A", "2-B", "3-A", "3-B", "4-A", "4-B", "5-A", "5-B", "6-A", "6-B", "6-C"];
    const rotation = ["Ms Rabia Nasir", "Mr Imran Shafiq", "Ms Saima Akram", "Mr Fahad Iqbal", "Ms Nida Hussain", "Mr Waqar Ahmed", "Ms Asma Rafiq", "Ms Kiran Javaid", "Mr Zubair Aslam", "Ms Farzana Bibi", "Mr Naveed Sadiq", "Ms Uzma Shah", "Mr Shahid Mehmood", "Ms Lubna Tariq", "Ms Mehwish Anjum"];
    sections.forEach((s, i) => classOf.set(rotation[i]!, s));
    ["8-A", "8-B", "8-C", "9-A"].forEach((s, i) => classOf.set(["Ms Tahira Yasmin", "Mr Arif Hussain", "Ms Shazia Parveen", "Mr Usman Ghani"][i]!, s));
    for (const t of teachers) {
      const cls = classOf.get(t.name) ?? null;
      const specialist = !cls;
      const lv = cls ? LEVEL_OF(cls) : { dept: "dp-sec", level: "Secondary (Matric)" };
      const key = t.name.toLowerCase().replace(/[^a-z]+/g, "-");
      const des = specialist || (cls && cls.startsWith("9")) ? "d-senior" : "d-teacher";
      const isNighat = t.name === "Ms Nighat Perveen";
      const isFahad = t.name === "Mr Fahad Iqbal";
      const isMehwish = t.name === "Ms Mehwish Anjum";
      add({
        key: isMehwish ? "mehwish" : key,
        name: t.name,
        gender: t.name.startsWith("Mr") ? "M" : "F",
        campus,
        ...(KNOWN_NO[t.name] ? { employeeNo: KNOWN_NO[t.name] } : {}),
        designationId: des,
        departmentId: lv.dept,
        scale: isNighat ? null : teacherScale(key, des),
        joined: isMehwish ? "2026-11-02" : t.name === "Ms Hina Javed" ? "2017-04-03" : t.name === "Mr Adeel Anwar" ? "2015-08-10" : t.name === "Ms Sana Tariq" ? "2019-04-01" : joinedFor(key, 2006),
        classTeacherOf: cls,
        subjects: t.subjectIds,
        levels: [lv.level],
        ...(URDU[t.name] ? { urdu: URDU[t.name] } : {}),
        ...(USER_OF[t.name] ? { user: USER_OF[t.name] } : {}),
        ...(isNighat ? { type: "CONTRACT" as const, workDays: [1, 3, 5], daysPerWeek: 3 } : {}),
        ...(isFahad ? { workDays: [1, 2, 3, 4], daysPerWeek: 4 } : {}),
        ...(isMehwish ? { type: "PROBATION" as const, noDevice: true } : {}),
      });
    }
    add({ key: "qari", name: "Qari Abdul Hameed", gender: "M", campus, employeeNo: "KC-T-0071", designationId: "d-qari", departmentId: "dp-hifz", scale: "14", joined: "2011-04-04", subjects: ["naz", "tqn"], levels: ["Middle", "Secondary (Matric)"] });
    add({ key: "saeed", name: "Dr Saeed Anwar", gender: "M", campus, employeeNo: "KC-T-0170", designationId: "d-visiting", departmentId: "dp-col", type: "VISITING", scale: null, joined: "2024-09-02", subjects: ["phy"], levels: ["Intermediate (College)"], workDays: [2, 4], daysPerWeek: 2 });
    add({ key: "bushra", name: "Ms Bushra Latif", gender: "F", campus, employeeNo: "KC-S-0144", designationId: "d-librarian", departmentId: "dp-lib", scale: "14", joined: "2013-09-02" });
    add({ key: "shahid", name: "Mr Shahid Hussain", gender: "M", campus, employeeNo: "KC-S-0203", designationId: "d-labasst", departmentId: "dp-lab", scale: "12", joined: "2012-01-09", married: true });
    add({ key: "naveed", name: "Mr Naveed Akhtar", gender: "M", campus, employeeNo: "KC-S-0195", designationId: "d-store", departmentId: "dp-support", scale: "12", joined: "2014-03-03", married: true });
    support.find((s) => s[0] === "d-labasst")![3] = 0;
    add({ key: "madiha", name: "Ms Madiha Riaz", gender: "F", campus, designationId: "d-teacher", departmentId: "dp-pri", scale: "15", joined: "2018-04-02", levels: ["Primary"], subjects: ["eng", "sci"] });
    add({ key: "kc-left-t", gender: "F", campus, designationId: "d-teacher", departmentId: "dp-mid", scale: "14", joined: "2021-04-05", levels: ["Middle"], subjects: ["urd"], status: "LEFT", leaving: { date: "2026-08-31", reason: "Moved to Lahore after marriage" } });
  } else {
    const fixed: Record<Exclude<CampusCode, "KC">, Seed[]> = {
      SM: [
        { key: "faisal", name: "Mr Faisal Mehmood", gender: "M", campus, employeeNo: "SM-S-0003", designationId: "d-principal", departmentId: "dp-admin", scale: "18", joined: "2012-04-02", special: 8000 },
        { key: "asif", name: "Mr Asif Raza", gender: "M", campus, employeeNo: "SM-S-0021", designationId: "d-cashier", departmentId: "dp-accounts", scale: "14", joined: "2018-08-06" },
        { key: "tariq-jamil", name: "Mr Tariq Jamil", gender: "M", campus, designationId: "d-teacher", departmentId: "dp-mid", scale: "15", joined: "2015-04-06", subjects: ["mat", "sci"], levels: ["Middle"], classTeacherOf: "6-A" },
        { key: "sumaira", name: "Ms Sumaira Khalid", gender: "F", campus, designationId: "d-teacher", departmentId: "dp-mid", scale: "14", joined: "2019-04-01", subjects: ["eng", "sst"], levels: ["Middle"], classTeacherOf: "6-B" },
        { key: "bilal-h", name: "Mr Bilal Hassan", gender: "M", campus, designationId: "d-teacher", departmentId: "dp-mid", scale: "14", joined: "2020-08-10", subjects: ["urd", "isl"], levels: ["Middle"], classTeacherOf: "7-A" },
        { key: "adnan", name: "Mr Adnan Sabir", gender: "M", campus, designationId: "d-senior", departmentId: "dp-sec", scale: "16", joined: "2013-04-01", subjects: ["cmp", "mat", "phy"], levels: ["Secondary (Matric)"] },
        { key: "hafsa", name: "Ms Hafsa Noreen", gender: "F", campus, designationId: "d-senior", departmentId: "dp-sec", scale: "16", joined: "2014-08-04", subjects: ["isl", "che", "bio"], levels: ["Secondary (Matric)"] },
      ],
      UC: [
        { key: "nasreen", name: "Mrs Nasreen Akhtar", gender: "F", campus, employeeNo: "UC-S-0002", designationId: "d-principal", departmentId: "dp-admin", scale: "18", joined: "2010-04-05", special: 8000, married: true },
        { key: "shabana", name: "Ms Shabana Kausar", gender: "F", campus, employeeNo: "UC-S-0019", designationId: "d-cashier", departmentId: "dp-accounts", scale: "14", joined: "2017-04-03" },
        { key: "naeem", name: "Mr Naeem Akhtar", gender: "M", campus, employeeNo: "UC-S-0026", designationId: "d-office", departmentId: "dp-admin", scale: "13", joined: "2019-09-02" },
        { key: "murtaza", name: "Mr Ghulam Murtaza", gender: "M", campus, designationId: "d-senior", departmentId: "dp-sec", scale: "16", joined: "2011-04-04", subjects: ["phy", "che", "mat"], levels: ["Secondary (Matric)"] },
        { key: "aqsa", name: "Ms Aqsa Jabeen", gender: "F", campus, designationId: "d-senior", departmentId: "dp-sec", scale: "16", joined: "2016-04-04", subjects: ["bio", "sci"], levels: ["Secondary (Matric)"] },
      ],
      MC: [
        { key: "zahid", name: "Mr Zahid Hussain", gender: "M", campus, employeeNo: "MC-S-0001", designationId: "d-principal", departmentId: "dp-admin", scale: "17", joined: "2014-04-07", special: 6000 },
        { key: "ghazala", name: "Ms Ghazala Parveen", gender: "F", campus, employeeNo: "MC-S-0011", designationId: "d-cashier", departmentId: "dp-accounts", scale: "13", joined: "2019-04-01" },
        { key: "riaz", name: "Mr Riaz Ahmad", gender: "M", campus, designationId: "d-senior", departmentId: "dp-sec", scale: "16", joined: "2012-08-06", subjects: ["isl", "phy", "che"], levels: ["Secondary (Matric)"] },
      ],
      HC: [
        { key: "ambreen", name: "Dr Ambreen Fatima", gender: "F", campus, employeeNo: "HC-S-0001", designationId: "d-principal", departmentId: "dp-admin", scale: "19", joined: "2009-04-06", special: 10000 },
        { key: "hc-vp", gender: "F", campus, designationId: "d-vp", departmentId: "dp-admin", scale: "18", joined: "2012-04-02", special: 6000 },
        { key: "tahir", name: "Mr Tahir Mahmood", gender: "M", campus, employeeNo: "HC-S-0014", designationId: "d-accountant", departmentId: "dp-accounts", scale: "16", joined: "2015-04-06", special: 3000 },
        { key: "kiran", name: "Ms Kiran Javaid", gender: "F", campus, employeeNo: "HC-T-0072", designationId: "d-teacher", departmentId: "dp-pri", scale: "15", joined: "2016-04-04", subjects: ["eng", "sst"], levels: ["Primary"], classTeacherOf: "3-B" },
        { key: "sadaf", name: "Ms Sadaf Iqbal", gender: "F", campus, designationId: "d-senior", departmentId: "dp-sec", scale: "16", joined: "2014-04-07", subjects: ["cmp", "mat"], levels: ["Secondary (Matric)"] },
        { key: "nadeem", name: "Mr Nadeem Abbas", gender: "M", campus, designationId: "d-senior", departmentId: "dp-sec", scale: "16", joined: "2013-08-05", subjects: ["phy", "che"], levels: ["Secondary (Matric)"] },
        { key: "farhat", name: "Ms Farhat Naz", gender: "F", campus, designationId: "d-senior", departmentId: "dp-sec", scale: "16", joined: "2017-04-03", subjects: ["bio", "tqn"], levels: ["Secondary (Matric)"] },
        { key: "hc-cashier", gender: "F", campus, designationId: "d-cashier", departmentId: "dp-accounts", scale: "14", joined: "2020-04-06" },
        { key: "hc-lib", gender: "F", campus, designationId: "d-librarian", departmentId: "dp-lib", scale: "14", joined: "2018-09-03" },
      ],
    };
    fixed[campus].forEach(add);
  }

  for (const [des, dept, gender, count] of support) {
    for (let i = 0; i < count; i++) add({ key: `${campus}-${des}-${i}`, gender, campus, designationId: des, departmentId: dept, scale: des === "d-clerk" ? "12" : des === "d-labasst" ? "12" : null, joined: joinedFor(`${campus}-${des}-${i}`, 2008) });
  }
  // Fill with teachers (and college lecturers at Khalid and Humaira) to the campus strength.
  const active = () => seeds.filter((s) => s.status !== "LEFT").length;
  let i = 0;
  const depts = ["dp-pre", "dp-pri", "dp-pri", "dp-mid", "dp-mid", "dp-sec"];
  const subjectsByDept: Record<string, string[][]> = {
    "dp-pre": [["eng", "urd"], ["drw", "gk"]],
    "dp-pri": [["eng", "sst"], ["mat", "sci"], ["urd", "isl"]],
    "dp-mid": [["mat", "sci"], ["eng", "urd"], ["isl", "sst"], ["cmp", "mat"]],
    "dp-sec": [["phy", "mat"], ["che", "bio"], ["eng", "pst"], ["urd", "isl"]],
    "dp-col": [["eng"], ["phy"], ["che"], ["bio"], ["mat"], ["cmp"], ["urd"], ["isl"]],
  };
  while (active() < TARGET[campus]) {
    const key = `${campus}-t-${i}`;
    const college = (campus === "KC" && i % 3 === 2) || (campus === "HC" && i % 4 === 3);
    const dept = college ? "dp-col" : depts[i % depts.length]!;
    const des = college ? "d-lecturer" : hash01(`${key}|sn`) < 0.22 ? "d-senior" : "d-teacher";
    const level = dept === "dp-col" ? "Intermediate (College)" : dept === "dp-pre" ? "Pre-primary" : dept === "dp-pri" ? "Primary" : dept === "dp-mid" ? "Middle" : "Secondary (Matric)";
    add({ key, gender: hash01(`${key}|g`) < 0.86 ? "F" : "M", campus, designationId: des, departmentId: dept, scale: teacherScale(key, des), joined: joinedFor(key, 2007), subjects: pickBy(subjectsByDept[dept]!, `${key}|subj`), levels: [level] });
    i++;
  }
  return seeds;
}

let cachedStaff: StaffRec[] | null = null;

/** Every campus's staff, built the same way on every load (a fresh copy each call). */
export function initialStaff(): StaffRec[] {
  if (!cachedStaff) {
    usedNames.clear();
    for (const n of ["Ms Madiha Riaz", "Mrs Sadia Rehman", "Ms Hina Javed", "Mr Adeel Anwar", "Ms Sana Tariq", "Usman Ali", "Nadia Shah", "Kamran Yousaf", "Farah Naz"]) usedNames.add(n);
    for (const t of initialTeachers()) usedNames.add(t.name);
    const criteria = initialCriteria();
    const out: StaffRec[] = [];
    const counters: Record<string, number> = {};
    const taken = new Set(Object.values(KNOWN_NO).concat(["KC-S-0009", "KC-S-0012", "KC-T-0021", "HO-S-0004", "HO-S-0031", "KC-S-0217", "KC-S-0188", "KC-S-0172", "KC-T-0071", "KC-T-0170", "KC-S-0144", "KC-S-0203", "KC-S-0195", "SM-S-0003", "SM-S-0021", "UC-S-0002", "UC-S-0019", "UC-S-0026", "MC-S-0001", "MC-S-0011", "HC-S-0001", "HC-S-0014", "HC-T-0072"]));
    for (const campus of ["KC", "SM", "UC", "MC", "HC"] as CampusCode[]) {
      for (const seed of campusSeeds(campus)) {
        let idx = 0;
        if (!seed.employeeNo) {
          const des = DESIGNATIONS.find((d) => d.id === seed.designationId)!;
          const teaching = des.category === "TEACHING" || des.category === "VISITING" || des.category === "HIFZ";
          const prefix = `${campus}-${teaching ? "T" : "S"}`;
          counters[prefix] ??= teaching ? 22 : 30;
          do counters[prefix] += 1 + Math.floor(hash01(`${seed.key}|no${counters[prefix]}`) * 3);
          while (taken.has(`${prefix}-${pad(counters[prefix])}`));
          idx = counters[prefix];
          taken.add(`${prefix}-${pad(idx)}`);
        }
        out.push(makeStaff(seed, idx, criteria));
      }
    }
    // Mr Fahad Iqbal also teaches computer science at Sugar Mill Campus two days a week: one profile, two postings.
    const fahad = out.find((s) => s.name === "Mr Fahad Iqbal");
    if (fahad) {
      fahad.postings.push({ id: "p2", campus: "SM", designationId: "d-visiting", departmentId: "dp-sec", employmentType: "VISITING", payScale: null, startDate: "2025-04-07", endDate: null, endReason: null, primary: false, daysPerWeek: 2, workDays: [5, 6], deviceEnrolNo: null, classTeacherOf: null });
      fahad.teachingLevels = ["Middle", "Secondary (Matric)"];
      fahad.history.push({ id: "h2", at: "2025-04-07T09:00:00+05:00", by: "Kamran Yousaf", text: "Added a posting at Sugar Mill Campus", detail: "Visiting lecturer, Friday and Saturday" });
    }
    // Children studying at MTB whose monthly fee is taken from the parent's salary.
    const shahid = out.find((s) => s.name === "Mr Shahid Hussain");
    if (shahid) shahid.children = [{ grNo: "KC-14377", name: "Ali Raza", classSection: "8-C", campus: "KC", monthlyFee: tuitionFor("8"), adjustAgainstSalary: true }];
    const naveed = out.find((s) => s.name === "Mr Naveed Akhtar");
    if (naveed) naveed.children = [{ grNo: "KC-15230", name: "Zainab Akhtar", classSection: "6-A", campus: "KC", monthlyFee: tuitionFor("6"), adjustAgainstSalary: true }];
    cachedStaff = out;
  }
  return structuredClone(cachedStaff);
}

/* ================================================================== Leave, loans */

export interface LeaveRec {
  id: string;
  staffId: string;
  campus: CampusCode;
  session: number;
  typeId: string;
  from: IsoDate;
  to: IsoDate;
  halfDay: boolean;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  source: "TEACHER_APP" | "OFFICE";
  requestedBy: string;
  requestedAt: IsoDateTime;
  decidedBy: string | null;
  decidedAt: IsoDateTime | null;
  decisionNote: string | null;
  history: HrAuditEntry[];
}

const byName = (staff: StaffRec[], name: string) => staff.find((s) => s.name === name);

export function initialLeave(staff: StaffRec[]): LeaveRec[] {
  const out: LeaveRec[] = [];
  let n = 0;
  const L = (who: StaffRec | undefined, typeId: string, from: IsoDate, to: IsoDate, status: LeaveRec["status"], reason: string, opts: { app?: boolean; at?: IsoDateTime; decidedAt?: IsoDateTime; note?: string; half?: boolean; by?: string } = {}) => {
    if (!who) return;
    const requestedBy = opts.app ? `${who.name} (teacher app)` : "Farah Naz";
    const requestedAt = opts.at ?? `${from}T07:10:00+05:00`;
    const decidedBy = status === "APPROVED" || status === "REJECTED" ? (opts.by ?? "Mrs Sadia Rehman") : null;
    const decidedAt = decidedBy ? (opts.decidedAt ?? requestedAt) : null;
    const history: HrAuditEntry[] = [{ id: "h1", at: requestedAt, by: requestedBy, text: "Asked for leave" }];
    if (decidedBy && decidedAt) history.push({ id: "h2", at: decidedAt, by: decidedBy, text: status === "APPROVED" ? "Approved" : "Rejected", ...(opts.note ? { detail: opts.note } : {}) });
    out.push({ id: `lv-${++n}`, staffId: who.id, campus: who.postings[0]!.campus, session: 2026, typeId, from, to, halfDay: Boolean(opts.half), reason, status, source: opts.app ? "TEACHER_APP" : "OFFICE", requestedBy, requestedAt, decidedBy, decidedAt, decisionNote: opts.note ?? null, history });
  };
  const s = (name: string) => byName(staff, name);
  // Today and coming days (consistent with the timetable's cover list: Mr Imran Shafiq is on casual leave today).
  L(s("Mr Imran Shafiq"), "lt-casual", "2026-11-04", "2026-11-04", "APPROVED", "Family wedding in Rahim Yar Khan.", { app: true, at: "2026-11-02T19:40:00+05:00", decidedAt: "2026-11-03T08:05:00+05:00" });
  L(s("Ms Hina Javed"), "lt-casual", "2026-11-12", "2026-11-13", "PENDING", "Attending my sister's nikah in Bahawalpur.", { app: true, at: "2026-11-03T20:15:00+05:00" });
  L(s("Ms Sana Tariq"), "lt-annual", "2026-11-23", "2026-11-27", "PENDING", "Visiting family in Karachi.", { app: true, at: "2026-11-04T07:05:00+05:00" });
  L(s("Mr Adeel Anwar"), "lt-sick", "2026-11-02", "2026-11-03", "APPROVED", "Fever; doctor's note attached.", { app: true, at: "2026-11-02T06:50:00+05:00", decidedAt: "2026-11-02T08:10:00+05:00" });
  L(s("Usman Ali"), "lt-casual", "2026-11-16", "2026-11-16", "PENDING", "Personal work at NADRA office.", { at: "2026-11-04T09:20:00+05:00" });
  L(s("Mr Shahid Hussain"), "lt-unpaid", "2026-10-26", "2026-10-28", "APPROVED", "Village visit after a death in the family; casual leave already used.", { at: "2026-10-24T11:00:00+05:00", decidedAt: "2026-10-24T12:30:00+05:00" });
  // Earlier this session.
  L(s("Ms Madiha Riaz"), "lt-maternity", "2026-09-28", "2026-12-26", "APPROVED", "Maternity leave; medical certificate on file.", { at: "2026-09-15T10:00:00+05:00", decidedAt: "2026-09-16T09:30:00+05:00" });
  L(s("Mr Kashif Nadeem"), "lt-emergency", "2026-10-20", "2026-10-20", "APPROVED", "Father admitted to hospital.", { app: true, at: "2026-10-20T06:30:00+05:00", decidedAt: "2026-10-20T07:50:00+05:00" });
  L(s("Mr Ehsan Ullah"), "lt-annual", "2026-10-12", "2026-10-14", "REJECTED", "Family trip.", { app: true, at: "2026-10-05T18:00:00+05:00", decidedAt: "2026-10-06T08:20:00+05:00", note: "First term exams that week; please choose dates after 17-Oct." });
  L(s("Farah Naz"), "lt-casual", "2026-10-15", "2026-10-15", "APPROVED", "Child's school function.", { at: "2026-10-13T12:00:00+05:00", decidedAt: "2026-10-13T13:10:00+05:00" });
  L(s("Ms Saima Akram"), "lt-sick", "2026-09-21", "2026-09-23", "APPROVED", "Dengue fever; medical certificate attached.", { app: true, at: "2026-09-21T06:40:00+05:00", decidedAt: "2026-09-21T08:00:00+05:00" });
  L(s("Ms Nida Hussain"), "lt-casual", "2026-10-30", "2026-10-30", "CANCELLED", "Bank work.", { app: true, at: "2026-10-28T19:00:00+05:00" });
  // A few approved casual and sick days for others, spread over the session.
  const kc = staff.filter((x) => x.postings[0]!.campus === "KC" && x.status === "ACTIVE" && !out.some((o) => o.staffId === x.id));
  kc.forEach((x, i) => {
    if (hash01(`${x.id}|lv`) > 0.28) return;
    const month = pickBy(["2026-05", "2026-08", "2026-09", "2026-10", "2026-10"], `${x.id}|lvm`);
    const day = pad(4 + Math.floor(hash01(`${x.id}|lvd`) * 22), 2);
    const date = `${month}-${day}`;
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (dow === 0 || (month === "2026-08" && day === "14")) return;
    L(x, i % 3 === 0 ? "lt-sick" : "lt-casual", date, date, "APPROVED", i % 3 === 0 ? "Unwell." : "Personal work.", { at: `${date}T06:45:00+05:00`, decidedAt: `${date}T08:00:00+05:00`, by: x.postings[0]!.designationId === "d-principal" ? "Kamran Yousaf" : "Mrs Sadia Rehman" });
  });
  // Humaira Campus.
  const hc = staff.filter((x) => x.postings[0]!.campus === "HC" && x.status === "ACTIVE" && x.postings[0]!.designationId === "d-teacher");
  L(hc[0], "lt-casual", "2026-11-04", "2026-11-04", "APPROVED", "Personal work.", { app: true, at: "2026-11-03T18:00:00+05:00", decidedAt: "2026-11-03T19:00:00+05:00", by: "Dr Ambreen Fatima" });
  L(hc[1], "lt-sick", "2026-11-05", "2026-11-06", "PENDING", "Unwell; will bring a medical certificate.", { app: true, at: "2026-11-04T06:55:00+05:00" });
  return out;
}

export interface LoanRec {
  id: string;
  loanNo: string;
  staffId: string;
  campus: CampusCode;
  typeId: string;
  principal: number;
  installment: number;
  installments: number;
  firstMonth: string;
  status: "PENDING" | "ACTIVE" | "CLOSED" | "REJECTED";
  reason: string;
  requestedBy: string;
  requestedAt: IsoDateTime;
  decidedBy: string | null;
  decidedAt: IsoDateTime | null;
  decisionNote: string | null;
  recoveries: Array<{ id: string; month: string; date: IsoDate; amount: number; source: "PAYROLL" | "CASH"; reference: string }>;
  history: HrAuditEntry[];
}

export function initialLoans(staff: StaffRec[]): LoanRec[] {
  const s = (name: string) => byName(staff, name);
  const out: LoanRec[] = [];
  const add = (who: StaffRec | undefined, loanNo: string, typeId: string, principal: number, installments: number, firstMonth: string, status: LoanRec["status"], reason: string, requestedAt: IsoDateTime, recoveredMonths: string[], decidedBy: string | null = "Mrs Sadia Rehman") => {
    if (!who) return;
    const installment = Math.round(principal / installments);
    const recoveries = recoveredMonths.map((m, i) => {
      const [y, mo] = m.split("-").map(Number) as [number, number];
      const next = mo === 12 ? `${y + 1}-01` : `${y}-${pad(mo + 1, 2)}`;
      const left = principal - installment * i;
      return { id: `r${i + 1}`, month: m, date: `${next}-05`, amount: Math.min(installment, left), source: "PAYROLL" as const, reference: `Salary sheet ${m}` };
    });
    const history: HrAuditEntry[] = [{ id: "h1", at: requestedAt, by: "Nadia Shah", text: "Loan requested", detail: reason }];
    if (decidedBy && status !== "PENDING") history.push({ id: "h2", at: requestedAt.replace("T10", "T15"), by: decidedBy, text: status === "REJECTED" ? "Rejected" : "Approved" });
    if (status === "CLOSED") history.push({ id: "h3", at: `${recoveries.at(-1)?.date ?? requestedAt.slice(0, 10)}T12:00:00+05:00`, by: "System", text: "Fully paid back; loan closed" });
    out.push({ id: loanNo.toLowerCase(), loanNo, staffId: who.id, campus: who.postings[0]!.campus, typeId, principal, installment, installments, firstMonth, status, reason, requestedBy: "Nadia Shah", requestedAt, decidedBy: status === "PENDING" ? null : decidedBy, decidedAt: status === "PENDING" ? null : requestedAt.replace("T10", "T15"), decisionNote: null, recoveries, history });
  };
  add(s("Mr Naveed Akhtar"), "LN-KC-0009", "ln-personal", 40000, 8, "2026-01", "CLOSED", "Roof repair after the monsoon rains.", "2025-12-20T10:00:00+05:00", ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);
  add(s("Ms Nighat Perveen"), "LN-KC-0010", "ln-advance", 10000, 1, "2026-09", "CLOSED", "School admission of her son.", "2026-08-28T10:00:00+05:00", ["2026-09"]);
  add(s("Mr Shahid Hussain"), "LN-KC-0011", "ln-personal", 60000, 12, "2026-06", "ACTIVE", "Daughter's wedding expenses.", "2026-05-25T10:00:00+05:00", ["2026-06", "2026-07", "2026-08", "2026-09"]);
  add(s("Usman Ali"), "LN-KC-0012", "ln-advance", 15000, 1, "2026-10", "ACTIVE", "Advance against October salary for a family emergency.", "2026-10-12T10:00:00+05:00", []);
  add(s("Ms Saima Akram"), "LN-KC-0013", "ln-medical", 90000, 10, "2026-11", "PENDING", "Mother's eye surgery at a hospital in Multan.", "2026-11-03T10:00:00+05:00", [], null);
  add(s("Mr Tahir Mahmood"), "LN-HC-0004", "ln-personal", 80000, 10, "2026-07", "ACTIVE", "Motorcycle purchase.", "2026-06-20T10:00:00+05:00", ["2026-07", "2026-08", "2026-09"], "Dr Ambreen Fatima");
  return out;
}

export { campusName };
