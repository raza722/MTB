import type { AdmissionsApplicant, AdmissionsClassRule, AdmissionsStage, AdmissionsTest, AdmissionsTestSubject, CampusCode } from "@mtb/api";
import type { IsoDate } from "@mtb/domain";
import { campusName } from "./campuses";
import { initialClassSubjects, initialGroups } from "./setup";

/**
 * Fictional 2026–27 intake, kept for the modules that are still mocked (Exams, Fees › Candidates, Reports, Messages,
 * Activities: see handlers/admissions-model.ts). Admissions itself is real; its screens never read these.
 *
 * Fictional 2026–27 intake. Khalid Campus (Sadiqabad) runs entrance tests for Class 1, 3, 6 and 9; other classes
 * are admitted directly on seats and an interview. The Diamond Minds talent test brings in applicants from other
 * schools (they are applicants, not students, until admitted).
 */

/** Groups a child can join in a class: Setup's groups for the class that have subjects (as in the timetable). */
function streamsOf(classShort: string): string[] {
  const classId = `c-${classShort.toLowerCase()}`;
  const withSubjects = new Set(initialClassSubjects().filter((r) => r.classId === classId && r.groupId).map((r) => r.groupId));
  return initialGroups()
    .filter((g) => g.active && g.classIds.includes(classId) && withSubjects.has(g.id))
    .map((g) => g.name);
}

const rule = (classApplied: string, classShort: string, testRequired: boolean, candidateFee: number, admissionFee: number, seatsOnMeritList: number): AdmissionsClassRule => ({ classApplied, classShort, testRequired, candidateFee, admissionFee, seatsOnMeritList, streams: streamsOf(classShort) });

/** Admission rules per class (fictional fees). */
export const CLASS_RULES: AdmissionsClassRule[] = [
  rule("Prep", "Prep", false, 0, 6000, 0),
  rule("Class 1", "1", true, 1000, 6000, 4),
  rule("Class 2", "2", false, 0, 6000, 0),
  rule("Class 3", "3", true, 1000, 6000, 3),
  rule("Class 4", "4", false, 0, 7000, 0),
  rule("Class 5", "5", false, 0, 7000, 0),
  rule("Class 6", "6", true, 1500, 8000, 4),
  rule("Class 7", "7", false, 0, 8000, 0),
  rule("Class 8", "8", false, 0, 8000, 0),
  rule("Class 9", "9", true, 2000, 9000, 3),
  rule("Class 10", "10", false, 0, 9000, 0),
];

const BIO = "Science (Biology)";
const CMP = "Science (Computer)";

export const ruleFor = (cls: string): AdmissionsClassRule => CLASS_RULES.find((r) => r.classApplied === cls) ?? CLASS_RULES[0]!;

const SUBJECTS: Record<string, AdmissionsTestSubject[]> = {
  "Class 1": [
    { subject: "English", max: 15, durationMins: 30 },
    { subject: "Urdu", max: 15, durationMins: 30 },
    { subject: "Mathematics", max: 20, durationMins: 30 },
  ],
  "Class 3": [
    { subject: "English", max: 20, durationMins: 40 },
    { subject: "Urdu", max: 20, durationMins: 40 },
    { subject: "Mathematics", max: 20, durationMins: 40 },
  ],
  "Class 6": [
    { subject: "English", max: 30, durationMins: 45 },
    { subject: "Urdu", max: 30, durationMins: 45 },
    { subject: "Mathematics", max: 40, durationMins: 60 },
  ],
  "Class 9": [
    { subject: "English", max: 30, durationMins: 45 },
    { subject: "Mathematics", max: 40, durationMins: 60 },
    { subject: "General Science", max: 30, durationMins: 45 },
  ],
};

export const subjectsFor = (cls: string): AdmissionsTestSubject[] => SUBJECTS[cls] ?? [{ subject: "General test", max: 100 }];

/**
 * Papers of one sitting. Class 9 round 2 is set per group, as the old "Candidate Class Subject" screen allowed:
 * the common papers for everyone, then Biology for the Biology group and Computer for the Computer group.
 */
function subjectsForTest(id: string, cls: string): AdmissionsTestSubject[] {
  if (id === "t-kc-c9-r2")
    return [
      { subject: "English", max: 25, durationMins: 40 },
      { subject: "Mathematics", max: 35, durationMins: 50 },
      { subject: "General Science", max: 20, durationMins: 30 },
      { subject: "Biology", max: 20, durationMins: 30, stream: BIO },
      { subject: "Computer", max: 20, durationMins: 30, stream: CMP },
    ];
  return subjectsFor(cls);
}

type TestSeed = Omit<AdmissionsTest, "candidates" | "feePaid" | "marked" | "status" | "max" | "subjects" | "campus" | "session"> & { campus?: CampusCode; session?: number };

const TEST_SEEDS: TestSeed[] = [
  { id: "t-kc-c6-r0", classApplied: "Class 6", name: "Class 6 entrance test · early round", date: "2026-09-26", time: "9:00 am", venue: "Examination hall, Khalid Campus" },
  { id: "t-kc-c9-r0", classApplied: "Class 9", name: "Class 9 entrance test · early round", date: "2026-09-26", time: "11:30 am", venue: "Examination hall, Khalid Campus" },
  { id: "t-kc-c1-r0", classApplied: "Class 1", name: "Class 1 entrance test · early round", date: "2026-10-03", time: "9:00 am", venue: "Junior block, Khalid Campus" },
  { id: "t-kc-c1-r1", classApplied: "Class 1", name: "Class 1 entrance test · round 1", date: "2026-10-24", time: "9:00 am", venue: "Junior block, Khalid Campus" },
  { id: "t-kc-c6-r1", classApplied: "Class 6", name: "Class 6 entrance test · round 1", date: "2026-10-24", time: "11:00 am", venue: "Examination hall, Khalid Campus" },
  { id: "t-kc-c9-r1", classApplied: "Class 9", name: "Class 9 entrance test · round 1", date: "2026-10-26", time: "9:00 am", venue: "Examination hall, Khalid Campus" },
  { id: "t-kc-c1-r2", classApplied: "Class 1", name: "Class 1 entrance test · round 2", date: "2026-11-02", time: "9:00 am", venue: "Junior block, Khalid Campus" },
  { id: "t-kc-c3-r1", classApplied: "Class 3", name: "Class 3 entrance test · round 1", date: "2026-11-07", time: "9:00 am", venue: "Junior block, Khalid Campus" },
  { id: "t-kc-c6-r2", classApplied: "Class 6", name: "Class 6 entrance test · round 2", date: "2026-11-07", time: "11:00 am", venue: "Examination hall, Khalid Campus" },
  { id: "t-kc-c9-r2", classApplied: "Class 9", name: "Class 9 entrance test · round 2", date: "2026-11-09", time: "9:00 am", venue: "Examination hall, Khalid Campus" },
  { id: "t-hc-c9-r1", classApplied: "Class 9", name: "Class 9 entrance test · round 1", date: "2026-10-26", time: "9:00 am", venue: "Main hall, Humaira Campus", campus: "HC" },
  { id: "t-hc-c1-r1", classApplied: "Class 1", name: "Class 1 entrance test · round 1", date: "2026-11-07", time: "9:30 am", venue: "Main hall, Humaira Campus", campus: "HC" },
  { id: "t-kc-c6-2526", classApplied: "Class 6", name: "Class 6 entrance test", date: "2025-10-04", time: "9:00 am", venue: "Examination hall, Khalid Campus", session: 2025 },
  { id: "t-kc-c1-2526", classApplied: "Class 1", name: "Class 1 entrance test", date: "2025-10-04", time: "11:00 am", venue: "Junior block, Khalid Campus", session: 2025 },
];

/** Test sittings without their live counts (the handler adds candidates, fees and marking progress). */
export function initialTests(): Array<Omit<AdmissionsTest, "candidates" | "feePaid" | "marked" | "status">> {
  return TEST_SEEDS.map(({ campus = "KC", session = 2026, ...t }) => {
    const subjects = subjectsForTest(t.id, t.classApplied);
    // The sitting's total is a candidate's total: common papers plus one group's papers.
    const common = subjects.filter((s) => !s.stream).reduce((a, s) => a + s.max, 0);
    const group = Math.max(0, ...[...new Set(subjects.filter((s) => s.stream).map((s) => s.stream))].map((g) => subjects.filter((s) => s.stream === g).reduce((a, s) => a + s.max, 0)));
    return { ...t, campus, session, subjects, max: common + group };
  });
}

const testMax = (cls: string) => subjectsFor(cls).reduce((a, s) => a + s.max, 0);

/** Spreads a total over the test's subjects in proportion to their marks (deterministic). */
function spread(cls: string, total: number): Record<string, number> {
  const subjects = subjectsFor(cls);
  const max = testMax(cls);
  const out: Record<string, number> = {};
  let left = total;
  subjects.forEach((s, i) => {
    const v = i === subjects.length - 1 ? left : Math.min(s.max, Math.round((total * s.max) / max));
    out[s.subject] = v;
    left -= v;
  });
  return out;
}

let seq = 360;
let feeSeq = 400;
function app(
  campus: CampusCode,
  name: string,
  relation: "s/o" | "d/o",
  father: string,
  fatherCnic: string,
  dob: IsoDate,
  classApplied: string,
  stage: AdmissionsStage,
  appliedOn: IsoDate,
  extra: Partial<AdmissionsApplicant> & { mobile: string; address: string },
): AdmissionsApplicant {
  seq += 7;
  const rule = ruleFor(classApplied);
  const tested = extra.testScore !== undefined && extra.testScore !== null;
  const feePaid = rule.testRequired && (stage !== "APPLIED" || extra.testId !== undefined || seq % 2 === 0);
  const base: AdmissionsApplicant = {
    id: `adm-${campus}-${seq}`,
    applicationNo: `${campus}-APP-2627-${String(seq).padStart(4, "0")}`,
    name,
    relation,
    father,
    fatherCnic,
    dob,
    gender: relation === "d/o" ? "F" : "M",
    campus,
    campusName: campusName(campus),
    session: 2026,
    classApplied,
    stage,
    appliedOn,
    source: seq % 5 === 0 ? "WEB" : "DESK",
    testScore: null,
    testMax: testMax(classApplied),
    diamondMinds: false,
    ...(rule.testRequired
      ? { fee: feePaid ? { amount: rule.candidateFee, status: "PAID" as const, receiptNo: `${campus}-CF-2627-${String((feeSeq += 3)).padStart(6, "0")}`, paidOn: appliedOn } : { amount: rule.candidateFee, status: "DUE" as const } }
      : { directAdmission: true }),
    ...extra,
  };
  if (tested) base.marks = spread(classApplied, base.testScore!);
  if (base.testId && !base.testRollNo) base.testRollNo = `T${classApplied.replace("Class ", "")}-${String(seq % 97).padStart(3, "0")}`;
  return base;
}

const SDQ = "Sadiqabad";

/** Applicants in fixed order. Numbering restarts on every call, so the same ids come back each time. */
export function initialApplicants(): AdmissionsApplicant[] {
  seq = 360;
  feeSeq = 400;
  return [
    // ---- Khalid Campus · Applied ----
    app("KC", "Arham Faisal", "s/o", "Faisal Nawaz", "3130341122334", "2020-02-11", "Class 1", "APPLIED", "2026-11-02", { mobile: "03997788112", address: `House 7, Street 3, Shahbaz Colony, ${SDQ}` }),
    app("KC", "Hafsa Yasir", "d/o", "Yasir Hameed", "3130352211445", "2020-06-23", "Class 1", "APPLIED", "2026-11-03", { mobile: "03996654321", address: `House 41, Model Town, ${SDQ}`, source: "ENQUIRY", enquiryNo: "KC-ENQ-2627-0109" }),
    app("KC", "Shayan Qasim", "s/o", "Qasim Raza", "3130363344556", "2017-09-05", "Class 4", "APPLIED", "2026-10-30", { mobile: "03997766554", address: `House 12, Block B, Satellite Town, ${SDQ}`, previousSchool: "Allied School, Sadiqabad" }),
    app("KC", "Hira Mehmood", "d/o", "Sajjad Mehmood", "3130374125896", "2015-02-17", "Class 6", "APPLIED", "2026-10-21", { mobile: "03994455667", address: `House 18, Street 2, Gulshan-e-Iqbal, ${SDQ}` }),
    app("KC", "Hira Mahmood", "d/o", "Sajjad Mahmood", "", "2015-02-17", "Class 6", "APPLIED", "2026-11-01", { mobile: "03994455667", address: `Mohallah Rehmanabad, ${SDQ}` }),
    app("KC", "M. Bilal", "s/o", "Tariq Mehmood", "3130398765431", "2012-01-10", "Class 8", "APPLIED", "2026-10-28", { mobile: "03996120458", address: `House 3, Street 11, ${SDQ}`, diamondMinds: true }),
    app("KC", "Ali Raza", "s/o", "Shahid Hussain", "3130322233347", "2019-05-03", "Class 1", "APPLIED", "2026-11-03", { mobile: "03997788990", address: `Chak 172/P, ${SDQ}` }),
    app("KC", "Zoha Imtiaz", "d/o", "Imtiaz Ahmed", "3130344477781", "2022-03-15", "Prep", "APPLIED", "2026-11-04", { mobile: "03998877665", address: `House 9, Satellite Town, ${SDQ}`, source: "ENQUIRY", enquiryNo: "KC-ENQ-2627-0112" }),

    // ---- Khalid Campus · Test (scheduled; round 2 of Class 1 was held on 02-Nov and is waiting for marks) ----
    app("KC", "Anaya Kashif", "d/o", "Kashif Riaz", "3130310293847", "2020-03-30", "Class 1", "TEST", "2026-10-19", { mobile: "03995566778", address: `House 9, Street 6, ${SDQ}`, testDate: "2026-11-02", testId: "t-kc-c1-r2" }),
    app("KC", "Ibrahim Mazhar", "s/o", "Mazhar Iqbal", "3130320394857", "2020-01-14", "Class 1", "TEST", "2026-10-20", { mobile: "03998899001", address: `House 22, Model Town, ${SDQ}`, testDate: "2026-11-02", testId: "t-kc-c1-r2" }),
    app("KC", "Zoya Shafqat", "d/o", "Shafqat Rasool", "3130330495867", "2019-11-08", "Class 1", "TEST", "2026-10-22", { mobile: "03999988776", address: `House 5, Street 1, Shahbaz Colony, ${SDQ}`, testDate: "2026-11-02", testId: "t-kc-c1-r2" }),
    app("KC", "Daniyal Khalid", "s/o", "Khalid Javed", "3130340596877", "2015-07-19", "Class 6", "TEST", "2026-10-25", { mobile: "03996677889", address: `House 31, Satellite Town, ${SDQ}`, testDate: "2026-11-07", testId: "t-kc-c6-r2", diamondMinds: true }),
    app("KC", "Aleena Asif", "d/o", "Asif Mehmood", "3130350697887", "2018-04-02", "Class 3", "TEST", "2026-10-27", { mobile: "03995566770", address: `House 14, Gulshan-e-Iqbal, ${SDQ}`, testDate: "2026-11-07", testId: "t-kc-c3-r1" }),
    app("KC", "Sana Zahid", "d/o", "Zahid Iqbal", "3130360798897", "2012-08-21", "Class 9", "TEST", "2026-10-29", { mobile: "03994455661", address: `House 2, Street 9, ${SDQ}`, testDate: "2026-11-09", testId: "t-kc-c9-r2", testMax: 100, stream: BIO, religion: "Islam", city: SDQ, fatherOccupation: "Shopkeeper", fatherQualification: "Matric", motherQualification: "F.A.", emergencyContact: { name: "Rafiq Iqbal (uncle)", mobile1: "03994411223" } }),
    app("KC", "Hammad Nasir", "s/o", "Nasir Ali", "3130370899907", "2012-10-12", "Class 9", "TEST", "2026-10-30", { mobile: "03997766558", address: `House 66, Model Town, ${SDQ}`, testDate: "2026-11-09", testId: "t-kc-c9-r2", testMax: 100, stream: CMP, religion: "Islam", city: SDQ, email: "nasir.ali@example.pk", admissionReference: "Website" }),

    // ---- Khalid Campus · Merit list (tested, ranked) ----
    app("KC", "Saad Ahmed", "s/o", "Farooq Ahmed", "3130311223344", "2015-01-09", "Class 6", "MERIT", "2026-10-05", { mobile: "03991122334", address: `House 4, Satellite Town, ${SDQ}`, testDate: "2026-10-24", testId: "t-kc-c6-r1", testScore: 91, diamondMinds: true }),
    app("KC", "Mahnoor Tahir", "d/o", "Tahir Nadeem", "3130322334455", "2015-05-14", "Class 6", "MERIT", "2026-10-06", { mobile: "03992233445", address: `House 19, Gulshan-e-Iqbal, ${SDQ}`, testDate: "2026-10-24", testId: "t-kc-c6-r1", testScore: 88 }),
    app("KC", "Abdullah Rashid", "s/o", "Rashid Latif", "3130333445566", "2015-03-27", "Class 6", "MERIT", "2026-10-07", { mobile: "03993344556", address: `House 8, Street 4, ${SDQ}`, testDate: "2026-10-24", testId: "t-kc-c6-r1", testScore: 84 }),
    app("KC", "Eman Waqas", "d/o", "Waqas Anwar", "3130344556677", "2015-08-02", "Class 6", "MERIT", "2026-10-08", { mobile: "03994455667", address: `House 27, Model Town, ${SDQ}`, testDate: "2026-10-24", testId: "t-kc-c6-r1", testScore: 79, diamondMinds: true }),
    app("KC", "Talha Shahbaz", "s/o", "Shahbaz Akram", "3130355667788", "2015-11-16", "Class 6", "MERIT", "2026-10-09", { mobile: "03995566778", address: `House 13, Shahbaz Colony, ${SDQ}`, testDate: "2026-10-24", testId: "t-kc-c6-r1", testScore: 74 }),
    app("KC", "Laiba Adnan", "d/o", "Adnan Saeed", "3130366778899", "2015-06-30", "Class 6", "MERIT", "2026-10-10", { mobile: "03996677889", address: `House 50, Satellite Town, ${SDQ}`, testDate: "2026-10-24", testId: "t-kc-c6-r1", testScore: 71 }),
    app("KC", "Rayyan Imtiaz", "s/o", "Imtiaz Hussain", "3130377889900", "2015-09-04", "Class 6", "MERIT", "2026-10-11", { mobile: "03997788990", address: `House 1, Street 12, ${SDQ}`, testDate: "2026-10-24", testId: "t-kc-c6-r1", testScore: 66 }),
    app("KC", "Khadija Naeem", "d/o", "Naeem Akhtar", "3130388990011", "2012-04-18", "Class 9", "OFFERED", "2026-10-12", { mobile: "03998899001", address: `House 36, Gulshan-e-Iqbal, ${SDQ}`, testDate: "2026-10-26", testId: "t-kc-c9-r1", testScore: 89, diamondMinds: true, offeredOn: "2026-10-30", offeredBy: "Mrs Sadia Rehman", offerValidUntil: "2026-11-06", stream: BIO, religion: "Islam", city: SDQ, fatherOccupation: "Bank officer", fatherQualification: "M.Com", motherQualification: "B.A.", motherOccupation: "Teacher", emergencyContact: { name: "Saleem Akhtar (uncle)", mobile1: "03997711224", mobile2: "03997711224" } }),
    app("KC", "Umar Sajid", "s/o", "Sajid Mehmood", "3130399001122", "2012-02-25", "Class 9", "MERIT", "2026-10-13", { mobile: "03999900112", address: `House 10, Model Town, ${SDQ}`, testDate: "2026-10-26", testId: "t-kc-c9-r1", testScore: 82, stream: CMP }),
    app("KC", "Amna Arshad", "d/o", "Arshad Mahmood", "3130300112233", "2012-07-07", "Class 9", "MERIT", "2026-10-14", { mobile: "03990011223", address: `House 21, Street 5, ${SDQ}`, testDate: "2026-10-26", testId: "t-kc-c9-r1", testScore: 77, stream: BIO }),
    app("KC", "Haris Tanveer", "s/o", "Tanveer Abbas", "3130312312312", "2012-12-01", "Class 9", "MERIT", "2026-10-15", { mobile: "03991122334", address: `House 44, Satellite Town, ${SDQ}`, testDate: "2026-10-26", testId: "t-kc-c9-r1", testScore: 70, stream: CMP }),
    app("KC", "Noor Fatima", "d/o", "Javed Akram", "3130323423423", "2020-05-12", "Class 1", "OFFERED", "2026-10-03", { mobile: "03992233445", address: `House 6, Shahbaz Colony, ${SDQ}`, testDate: "2026-10-24", testId: "t-kc-c1-r1", testScore: 46, offeredOn: "2026-10-28", offeredBy: "Mrs Sadia Rehman", offerValidUntil: "2026-11-04" }),
    app("KC", "Arsalan Tariq", "s/o", "Tariq Jamil", "3130334534534", "2020-02-28", "Class 1", "MERIT", "2026-10-04", { mobile: "03993344556", address: `House 15, Street 8, ${SDQ}`, testDate: "2026-10-24", testId: "t-kc-c1-r1", testScore: 41 }),
    app("KC", "Maira Sohail", "d/o", "Sohail Akhtar", "3130345645645", "2020-09-09", "Class 1", "MERIT", "2026-10-05", { mobile: "03994455667", address: `House 39, Model Town, ${SDQ}`, testDate: "2026-10-24", testId: "t-kc-c1-r1", testScore: 37 }),
    app("KC", "Hasan Ali", "s/o", "Ali Akbar", "3130356712345", "2016-01-21", "Class 5", "OFFERED", "2026-10-26", { mobile: "03996677881", address: `House 3, Model Town, ${SDQ}`, previousSchool: "The Educators, Sadiqabad", offeredOn: "2026-11-02", offeredBy: "Mrs Sadia Rehman", offerValidUntil: "2026-11-09" }),

    // ---- Khalid Campus · Admitted ----
    app("KC", "Rida Farooq", "d/o", "Farooq Haider", "3130356756756", "2015-04-04", "Class 6", "ADMITTED", "2026-09-14", { mobile: "03995566778", address: `House 23, Gulshan-e-Iqbal, ${SDQ}`, testDate: "2026-09-26", testId: "t-kc-c6-r0", testScore: 86, offeredOn: "2026-10-01", offeredBy: "Mrs Sadia Rehman", grNo: "KC-15412", admittedOn: "2026-10-05", admittedClassSection: "6-B", previousSchool: "The Educators, Sadiqabad", religion: "Islam", city: SDQ, homePhone: "0685551203", fatherOccupation: "Engineer", fatherQualification: "B.Sc. Engineering", motherQualification: "M.A.", motherOccupation: "Housewife", emergencyContact: { name: "Haider Ali (grandfather)", mobile1: "03996655441" }, admissionReference: "Sibling's teacher", hostel: false }),
    app("KC", "Faizan Adnan", "s/o", "Adnan Rafiq", "3130367867867", "2012-06-15", "Class 9", "ADMITTED", "2026-09-15", { mobile: "03996677889", address: `House 2, Satellite Town, ${SDQ}`, testDate: "2026-09-26", testId: "t-kc-c9-r0", testScore: 81, offeredOn: "2026-10-01", offeredBy: "Mrs Sadia Rehman", grNo: "KC-15419", admittedOn: "2026-10-06", admittedClassSection: "9-A", stream: BIO, previousSchool: "Allied School, Sadiqabad", religion: "Islam", city: SDQ, fatherOccupation: "Farmer", hostel: true }),
    app("KC", "Iqra Tahir", "d/o", "Tahir Mehmood", "3130378978978", "2019-01-22", "Class 2", "ADMITTED", "2026-09-20", { mobile: "03997788990", address: `House 17, Model Town, ${SDQ}`, offeredOn: "2026-10-12", offeredBy: "Mrs Sadia Rehman", grNo: "KC-15426", admittedOn: "2026-10-14", admittedClassSection: "2-B" }),
    app("KC", "Usman Kashif", "s/o", "Kashif Mahmood", "3130389089089", "2017-03-03", "Class 4", "ADMITTED", "2026-10-01", { mobile: "03998899001", address: `House 30, Street 2, ${SDQ}`, offeredOn: "2026-10-20", offeredBy: "Mrs Sadia Rehman", grNo: "KC-15433", admittedOn: "2026-10-22", admittedClassSection: "4-A" }),
    app("KC", "Noor Waqas", "d/o", "Waqas Ahmed", "3130390190190", "2020-07-17", "Class 1", "ADMITTED", "2026-09-28", { mobile: "03999900112", address: `House 11, Shahbaz Colony, ${SDQ}`, testDate: "2026-10-03", testId: "t-kc-c1-r0", testScore: 45, offeredOn: "2026-10-28", offeredBy: "Mrs Sadia Rehman", grNo: "KC-15440", admittedOn: "2026-10-30", admittedClassSection: "1-A" }),

    // ---- Khalid Campus · Withdrawn ----
    app("KC", "Bilal Saeed", "s/o", "Saeed Akhtar", "3130367812390", "2015-10-10", "Class 6", "WITHDRAWN", "2026-09-30", { mobile: "03995566112", address: `House 70, Model Town, ${SDQ}`, withdrawnOn: "2026-10-20", withdrawnReason: "Family chose another school" }),

    // ---- Humaira Campus (Lahore) ----
    app("HC", "Zainab Kamran", "d/o", "Kamran Butt", "3520212345671", "2015-02-02", "Class 6", "APPLIED", "2026-11-02", { mobile: "03994567890", address: "House 112, Block C, Model Town, Lahore" }),
    app("HC", "Ahmed Salman", "s/o", "Salman Qureshi", "3520223456782", "2020-04-11", "Class 1", "TEST", "2026-10-26", { mobile: "03994567891", address: "Flat 7, Block H, Johar Town, Lahore", testDate: "2026-11-07", testId: "t-hc-c1-r1" }),
    app("HC", "Fatima Usman", "d/o", "Usman Ghani", "3520234567893", "2012-09-19", "Class 9", "MERIT", "2026-10-08", { mobile: "03994567892", address: "House 45, Faisal Town, Lahore", testDate: "2026-10-26", testId: "t-hc-c9-r1", testScore: 84, diamondMinds: true, stream: BIO }),
    app("HC", "Hamza Rauf", "s/o", "Rauf Chaudhry", "3520245678904", "2012-03-08", "Class 9", "ADMITTED", "2026-09-18", { mobile: "03994567893", address: "House 9, Garden Town, Lahore", testDate: "2026-09-26", testScore: 80, offeredOn: "2026-10-01", offeredBy: "Principal, Humaira Campus", grNo: "HC-22312", admittedOn: "2026-10-03", admittedClassSection: "9-A", stream: CMP }),

    // ---- Khalid Campus · last session (read-only view) ----
    { ...app("KC", "Aliza Nadeem", "d/o", "Nadeem Abbas", "3130301230123", "2014-05-05", "Class 6", "ADMITTED", "2025-09-10", { mobile: "03991122334", address: `House 8, Model Town, ${SDQ}`, testId: "t-kc-c6-2526", testDate: "2025-10-04", testScore: 83, offeredOn: "2025-10-01", offeredBy: "Mrs Sadia Rehman", grNo: "KC-14702", admittedOn: "2025-10-06", admittedClassSection: "6-A" }), session: 2025 },
    { ...app("KC", "Moiz Anwar", "s/o", "Anwar Saleem", "3130312341234", "2019-08-08", "Class 1", "ADMITTED", "2025-09-12", { mobile: "03992233445", address: `House 2, Gulshan-e-Iqbal, ${SDQ}`, testId: "t-kc-c1-2526", testDate: "2025-10-04", testScore: 44, offeredOn: "2025-10-01", offeredBy: "Mrs Sadia Rehman", grNo: "KC-14709", admittedOn: "2025-10-06", admittedClassSection: "1-B" }), session: 2025 },
  ];
}
