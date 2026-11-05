import type { CampusCode, Charge, FeeBankDetails, PortalLang, PortalRelation, Receipt, ReceiptLine } from "@mtb/api";
import { amountInWords, calculateLateFine, DEFAULT_LATE_FINE_POLICY, type IsoDateTime } from "@mtb/domain";
import { findStudent } from "./students";

/**
 * Parent and student portal fixtures (fictional). Families sign in with the mobile number the school holds and a
 * one-time SMS code; students sign in with their G.R. number and the code goes to the family's mobile.
 * The demo code lives only here; the sign-in page shows it through the mock-only /api/portal/demo endpoint.
 */
export const PORTAL_DEMO_CODE = "135790";

/** Codes stop working after five minutes; three wrong codes pause sign-in for fifteen. */
export const PORTAL_CODE_TTL_MS = 5 * 60_000;
export const PORTAL_RESEND_AFTER_SEC = 30;
export const PORTAL_MAX_ATTEMPTS = 3;
export const PORTAL_LOCK_MS = 15 * 60_000;

export interface PortalParentRecord {
  id: string;
  name: string;
  nameUr: string;
  relation: PortalRelation;
  /** G.R. numbers, in the order the switcher lists them. Children at other campuses are included. */
  children: string[];
  smsLanguage: PortalLang;
  /** The sign-in before the demo's. */
  lastSignInAt?: IsoDateTime;
}

/** The brief's family (Imran Khan, three children across two campuses) and one single-child family. */
export const PORTAL_PARENTS: PortalParentRecord[] = [
  { id: "pg-imran", name: "Imran Khan", nameUr: "عمران خان", relation: "Father", children: ["KC-14823", "KC-15102", "UC-08831"], smsLanguage: "ur", lastSignInAt: "2026-10-30T19:12:00+05:00" },
  { id: "pg-tariq", name: "Tariq Mahmood", nameUr: "طارق محمود", relation: "Father", children: ["KC-14650"], smsLanguage: "en" },
];

/** A parent's registered mobile is the one on the children's records (the office keeps it up to date). */
export function parentMobile(p: PortalParentRecord): string {
  return findStudent(p.children[0] ?? "")?.guardian.mobile ?? "";
}

/** Students who can sign in themselves: the children of the families above. */
export const PORTAL_STUDENTS: string[] = PORTAL_PARENTS.flatMap((p) => p.children);

/** Notices the family had already opened before the demo starts (the rest show as new). */
export const PORTAL_READ_SEED: Record<string, string[]> = { "pg-imran": ["nt-kc-ptm-7"] };

// ---------------------------------------------------------------------------------------------------------
// Words the server sends in English, in Urdu
// ---------------------------------------------------------------------------------------------------------

export const CAMPUS_UR: Record<CampusCode, string> = { KC: "خالد کیمپس", SM: "شوگر مل کیمپس", UC: "عبید کیمپس", MC: "مجید کیمپس", HC: "حمیرا کیمپس" };

export const PEOPLE_UR: Record<string, string> = {
  "Ms Hina Javed": "مس حنا جاوید",
  "Mr Adeel Anwar": "مسٹر عدیل انور",
  "Ms Sana Tariq": "مس ثنا طارق",
  "Mrs Sadia Rehman": "مسز سعدیہ رحمان",
  "Ms Rukhsana Bibi": "مس رخسانہ بی بی",
  "Usman Ali": "عثمان علی",
  "Farah Naz": "فرح ناز",
  "Farah Imran": "فرح عمران",
  "Imran Khan": "عمران خان",
  "Tariq Mahmood": "طارق محمود",
  "Muhammad Bilal": "محمد بلال",
  "Accounts office": "اکاؤنٹس آفس",
  "Ubaid Campus office": "عبید کیمپس آفس",
  "Humaira Campus office": "حمیرا کیمپس آفس",
  "Sugar Mill Campus office": "شوگر مل کیمپس آفس",
};

export const HOUSE_UR: Record<string, string> = {
  "Iqbal House": "اقبال ہاؤس",
  "Jinnah House": "جناح ہاؤس",
  "Liaquat House": "لیاقت ہاؤس",
  "Sir Syed House": "سر سید ہاؤس",
};

const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const MONTHS_UR = ["جنوری", "فروری", "مارچ", "اپریل", "مئی", "جون", "جولائی", "اگست", "ستمبر", "اکتوبر", "نومبر", "دسمبر"];
const monthUr = (word: string) => {
  const i = MONTHS_EN.findIndex((m) => m === word || m.slice(0, 3) === word);
  return i >= 0 ? MONTHS_UR[i]! : word;
};

/** "Tuition fee – Nov 2026" → "ٹیوشن فیس – نومبر 2026". Unknown heads come back unchanged. */
export function feeHeadUr(head: string): string {
  const tuition = /^Tuition fee – (\w+) (\d{4})$/.exec(head);
  if (tuition) return `ٹیوشن فیس – ${monthUr(tuition[1]!)} ${tuition[2]}`;
  const annual = /^Annual charges (\d{4}–\d{2})$/.exec(head);
  if (annual) return `سالانہ چارجز ${annual[1]}`;
  const known: Record<string, string> = {
    "Admission fee": "داخلہ فیس",
    "Exam fee": "امتحانی فیس",
    "Transport fee": "ٹرانسپورٹ فیس",
    "Late fine": "جرمانہ",
    "Computer lab fee": "کمپیوٹر لیب فیس",
    "Sports fund": "اسپورٹس فنڈ",
  };
  return known[head] ?? head;
}

/**
 * Exam names in Urdu from the exam type's Urdu name: "First Term 2026–27" → "پہلا ٹرم امتحان 2026–27",
 * "Monthly Test – September 2026" → "ماہانہ ٹیسٹ – ستمبر 2026".
 */
export function examNameUr(name: string, typeUr: string | undefined, sessionLabel: string): string {
  if (!typeUr) return name;
  const month = /– (\w+) (\d{4})$/.exec(name);
  if (month) return `${typeUr} – ${monthUr(month[1]!)} ${month[2]}`;
  if (name.endsWith(sessionLabel)) return `${typeUr} ${sessionLabel}`;
  return typeUr;
}

// ---------------------------------------------------------------------------------------------------------
// School contacts per campus (the same phones and timings as Setup → Campuses; the real server reads Setup)
// ---------------------------------------------------------------------------------------------------------

export interface PortalCampusContact {
  phone: string;
  address: string;
  addressUr: string;
  /** null where the docs don't name the principal: the portal says "Campus principal". */
  principal: string | null;
  assembly: string;
  dayStarts: string;
  dayEnds: string;
  officeOpens: string;
  officeCloses: string;
  bank: FeeBankDetails;
}

const copies = ["Bank copy", "School copy", "Parent copy"];

export const PORTAL_CONTACTS: Record<CampusCode, PortalCampusContact> = {
  KC: {
    phone: "03005550101",
    address: "Khalid Campus, Sadiqabad",
    addressUr: "خالد کیمپس، صادق آباد",
    principal: "Mrs Sadia Rehman",
    assembly: "07:45",
    dayStarts: "07:45",
    dayEnds: "13:30",
    officeOpens: "07:30",
    officeCloses: "14:30",
    bank: { title: "MTB Khalid Campus, Sadiqabad", bankName: "Meezan Bank, Sadiqabad Branch", accountTitle: "MTB Khalid Campus Fee Collection", accountNo: "0101-0012345678", copyLabels: copies },
  },
  SM: {
    phone: "03005550202",
    address: "Sugar Mill Campus",
    addressUr: "شوگر مل کیمپس",
    principal: null,
    assembly: "07:45",
    dayStarts: "07:45",
    dayEnds: "13:30",
    officeOpens: "07:30",
    officeCloses: "14:30",
    bank: { title: "MTB Sugar Mill Campus", bankName: "HBL, Sugar Mill Branch", accountTitle: "MTB Sugar Mill Campus", accountNo: "0202-0023456789", copyLabels: copies },
  },
  UC: {
    phone: "03005550303",
    address: "Ubaid Campus",
    addressUr: "عبید کیمپس",
    principal: "Ms Rukhsana Bibi",
    assembly: "07:45",
    dayStarts: "07:45",
    dayEnds: "13:30",
    officeOpens: "07:30",
    officeCloses: "14:30",
    bank: { title: "MTB Ubaid Campus", bankName: "UBL, Main Branch", accountTitle: "MTB Ubaid Campus", accountNo: "0303-0034567890", copyLabels: copies },
  },
  MC: {
    phone: "03005550404",
    address: "Majeed Campus (Country Branch)",
    addressUr: "مجید کیمپس (کنٹری برانچ)",
    principal: null,
    assembly: "08:00",
    dayStarts: "08:00",
    dayEnds: "13:30",
    officeOpens: "07:45",
    officeCloses: "14:30",
    bank: { title: "MTB Majeed Campus", bankName: "National Bank of Pakistan", accountTitle: "MTB Majeed Campus", accountNo: "0404-0045678901", copyLabels: copies },
  },
  HC: {
    phone: "03005550505",
    address: "Humaira Campus, Lahore",
    addressUr: "حمیرا کیمپس، لاہور",
    principal: null,
    assembly: "07:45",
    dayStarts: "07:45",
    dayEnds: "13:30",
    officeOpens: "07:30",
    officeCloses: "14:30",
    bank: { title: "MTB Humaira Campus, Lahore", bankName: "Bank Alfalah, Lahore", accountTitle: "MTB Humaira Campus", accountNo: "0505-0056789012", copyLabels: copies },
  },
};

// ---------------------------------------------------------------------------------------------------------
// The portal demo starts after flow 1: this morning the cashier posted Ayesha's receipt KC-2627-004821 for the
// two overdue charges (Rs 12,250, cash), so only November tuition (Rs 8,500, due 10-Nov-2026) is left.
// The portal runs in its own browser tab, so when that receipt is not in this tab's fee records yet, the portal
// mock lays it over Ayesha's charges (it never writes to the fee records).
// ---------------------------------------------------------------------------------------------------------

export const COUNTER_RECEIPT_NO = "KC-2627-004821";
const COUNTER_GR = "KC-14823";
const COUNTER_POSTED_AT: IsoDateTime = "2026-11-04T10:39:00+05:00";
const COUNTER_CHARGE_SUFFIXES = [":ann", ":oct"];

/** Ayesha's flow-1 receipt, built from her two open overdue charges; null when they are already settled. */
export function counterReceiptOverlay(grNo: string, charges: Charge[]): Receipt | null {
  if (grNo !== COUNTER_GR) return null;
  const s = findStudent(grNo);
  const picked = COUNTER_CHARGE_SUFFIXES.map((suffix) => charges.find((c) => c.id.endsWith(suffix) && c.session === 2026)).filter((c): c is Charge => !!c);
  if (!s || picked.length !== COUNTER_CHARGE_SUFFIXES.length || picked.some((c) => c.status !== "OPEN")) return null;
  const day = COUNTER_POSTED_AT.slice(0, 10);
  const lines: ReceiptLine[] = picked.map((c) => {
    const lf = calculateLateFine(c.dueDate, day, DEFAULT_LATE_FINE_POLICY);
    return { chargeId: c.id, head: c.head, dueDate: c.dueDate, amount: c.amount, daysOverdue: lf.daysOverdue, lateFine: lf.fine, lineTotal: c.amount + lf.fine, applied: c.amount + lf.fine };
  });
  const total = lines.reduce((a, l) => a + l.lineTotal, 0);
  return {
    receiptNo: COUNTER_RECEIPT_NO,
    campus: "KC",
    campusName: "Khalid Campus",
    campusAddress: "Khalid Campus, Sadiqabad",
    session: 2026,
    grNo: s.grNo,
    studentName: s.name,
    ...(s.nameUr ? { studentNameUr: s.nameUr } : {}),
    relation: s.relation,
    father: s.father,
    classSection: s.classSection,
    cashier: "Usman Ali",
    postedAt: COUNTER_POSTED_AT,
    lines,
    total,
    amountInWords: amountInWords(total),
    payment: { method: "CASH", received: 13000, change: 13000 - total },
    status: "POSTED",
    printCount: 1,
  };
}
