// Fee-office choices the report catalogue's fee report filters list (fixtures/reports.ts, the contract reference of
// the backend's catalogue seed): the head catalogue, the concession types and the counter staff. Fees, fee setup
// and the report centre are real; the fictional structure, due dates and collection generator that the deleted
// fee-setup and accounts mocks read were removed in module 13c.
import type { CampusCode, FeeConcessionTypeInfo, FeeHead } from "@mtb/api";

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

/** Counter staff per campus (fictional). The first one is the main counter. */
export const CASHIERS: Record<CampusCode, string[]> = {
  KC: ["Usman Ali", "Rizwan Haider"],
  SM: ["Asma Rauf"],
  UC: ["Tariq Javed", "Saba Khalid"],
  MC: ["Nabeel Akhtar"],
  HC: ["Saima Qureshi", "Owais Malik"],
};
