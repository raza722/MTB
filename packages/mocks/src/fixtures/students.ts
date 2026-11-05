import type { CampusCode, EnrolmentEvent, FeeStatusCode, Guardian, StudentProfile } from "@mtb/api";
import type { IsoDate } from "@mtb/domain";
import { campusName } from "./campuses";

/**
 * A fictional student as the unfinished modules' mocks (fees, attendance, exams, admissions, SMS…) still store it.
 * Students itself is real (backend module 01); these records stay until those modules are built. Every fictional
 * student has a date of birth, unlike migrated ones.
 */
export type StudentRecord = Omit<StudentProfile, "siblings" | "dob"> & { dob: IsoDate };

/** The brief's family, grouped by father's CNIC 36302-4567890-1, across two campuses. */
const IMRAN: Guardian = {
  name: "Imran Khan",
  nameUr: "عمران خان",
  relation: "Father",
  cnic: "3630245678901",
  mobile: "03001234567",
  address: "House 24, Street 5, Model Town, Sadiqabad",
  occupation: "Shopkeeper",
};

const ev = (id: string, date: IsoDate, kind: EnrolmentEvent["kind"], title: string, description?: string): EnrolmentEvent => ({ id, date, kind, title, ...(description ? { description } : {}) });

const base = (r: Omit<StudentRecord, "campusName" | "session">): StudentRecord => ({ ...r, campusName: campusName(r.campus), session: 2026 });

const CAST: StudentRecord[] = [
  base({
    grNo: "KC-14823",
    name: "Ayesha Khan",
    nameUr: "عائشہ خان",
    relation: "d/o",
    father: "Imran Khan",
    fatherCnic: IMRAN.cnic,
    gender: "F",
    campus: "KC",
    classSection: "7-B",
    status: "ACTIVE",
    feeStatus: "overdue",
    balance: 20000,
    dob: "2013-03-14",
    admissionDate: "2020-04-06",
    rollNo: 12,
    house: "Iqbal House",
    guardian: IMRAN,
    mother: "Farah Imran",
    enrolment: [
      ev("e1", "2020-04-06", "ADMITTED", "Admitted · Class 1-A", "Session 2020–21 · Khalid Campus"),
      ev("e2", "2025-04-01", "PROMOTED", "Promoted to Class 6-A", "Session 2025–26"),
      ev("e3", "2026-04-01", "PROMOTED", "Promoted to Class 7-A", "Session 2026–27"),
      ev("e4", "2026-08-18", "SECTION_CHANGE", "Section changed 7-A → 7-B", "Approved by Mrs Sadia Rehman (Principal)"),
    ],
  }),
  base({
    grNo: "KC-15102",
    name: "Hamza Khan",
    nameUr: "حمزہ خان",
    relation: "s/o",
    father: "Imran Khan",
    fatherCnic: IMRAN.cnic,
    gender: "M",
    campus: "KC",
    classSection: "4-A",
    status: "ACTIVE",
    feeStatus: "paid",
    balance: 0,
    dob: "2016-09-02",
    admissionDate: "2023-04-03",
    rollNo: 7,
    house: "Jinnah House",
    guardian: IMRAN,
    mother: "Farah Imran",
    enrolment: [
      ev("e1", "2023-04-03", "ADMITTED", "Admitted · Class 1-A", "Session 2023–24 · Khalid Campus"),
      ev("e2", "2026-04-01", "PROMOTED", "Promoted to Class 4-A", "Session 2026–27"),
    ],
  }),
  base({
    grNo: "UC-08831",
    name: "Mariam Khan",
    nameUr: "مریم خان",
    relation: "d/o",
    father: "Imran Khan",
    fatherCnic: IMRAN.cnic,
    gender: "F",
    campus: "UC",
    classSection: "9-A",
    status: "ACTIVE",
    feeStatus: "unpaid",
    balance: 9000,
    dob: "2011-01-20",
    admissionDate: "2019-04-08",
    rollNo: 21,
    guardian: IMRAN,
    mother: "Farah Imran",
    enrolment: [
      ev("e1", "2019-04-08", "ADMITTED", "Admitted · Class 2-A", "Session 2019–20 · Ubaid Campus"),
      ev("e2", "2026-04-01", "PROMOTED", "Promoted to Class 9-A", "Session 2026–27"),
    ],
  }),
];

const g = (name: string, cnic: string, mobile: string, address = "Sadiqabad"): Guardian => ({ name, relation: "Father", cnic, mobile, address });

const NAMED: Array<[string, "s/o" | "d/o", string, string, string, FeeStatusCode, number, string]> = [
  // name, relation, father, grNo, class, fee status, balance, father CNIC
  ["Muhammad Bilal", "s/o", "Tariq Mahmood", "KC-14650", "7-B", "unpaid", 8500, "3130398765431"],
  ["Fatima Noor", "d/o", "Abdul Rauf", "KC-14911", "7-A", "paid", 0, "3130312345672"],
  ["Ali Raza", "s/o", "Shahid Hussain", "KC-14377", "8-C", "overdue", 17000, "3130355512343"],
  ["Zainab Akhtar", "d/o", "Naveed Akhtar", "KC-15230", "6-A", "unpaid", 8500, "3130377788814"],
  ["Hassan Iqbal", "s/o", "Javed Iqbal", "KC-14502", "9-B", "overdue", 9000, "3130366699915"],
  ["Areeba Siddiqui", "d/o", "Kamran Siddiqui", "KC-14988", "7-B", "paid", 0, "3130344411126"],
];

const NAMED_STUDENTS: StudentRecord[] = NAMED.map(([name, relation, father, grNo, cls, feeStatus, balance, cnic], i) =>
  base({
    grNo,
    name,
    relation,
    father,
    fatherCnic: cnic,
    gender: relation === "d/o" ? "F" : "M",
    campus: "KC",
    classSection: cls,
    status: grNo === "KC-14502" ? "LEFT" : "ACTIVE",
    feeStatus,
    balance,
    dob: `201${2 + (i % 3)}-0${(i % 8) + 1}-1${i}`,
    admissionDate: `202${i % 4}-04-0${(i % 6) + 1}`,
    rollNo: 3 + i * 4,
    guardian: g(father, cnic, `030${(i % 9) + 1}55501${20 + i}`),
    enrolment: [ev("e1", `202${i % 4}-04-0${(i % 6) + 1}`, "ADMITTED", `Admitted · Class ${Number(cls.split("-")[0]) - (6 - (i % 4))}-A`)],
    ...(grNo === "KC-14502" ? { leftOn: "2026-06-30" } : {}),
  }),
);
// Hassan Iqbal left at the end of last session with dues outstanding (fee counter "student has left" state).
const hassan = NAMED_STUDENTS.find((s) => s.grNo === "KC-14502");
if (hassan) hassan.enrolment.push(ev("e2", "2026-06-30", "LEFT", "Left the school", "Family moved to Rahim Yar Khan"));

// ---- Generated classmates (deterministic) ----
const BOYS = ["Abdullah", "Ahmed", "Usman", "Zain", "Saad", "Talha", "Haris", "Ibrahim", "Umar", "Faizan", "Arham", "Rayyan", "Shayan", "Daniyal", "Hammad"];
const GIRLS = ["Hira", "Maryam", "Iqra", "Zoya", "Mahnoor", "Laiba", "Eman", "Aleena", "Hafsa", "Anaya", "Noor", "Sana", "Rida", "Amna", "Khadija"];
const FATHERS = ["Asif Mehmood", "Khalid Javed", "Tahir Nadeem", "Zahid Iqbal", "Farooq Ahmed", "Nasir Ali", "Rashid Latif", "Waqas Anwar", "Shahbaz Akram", "Adnan Saeed", "Imtiaz Hussain", "Sajid Mehmood", "Arshad Mahmood", "Naeem Akhtar", "Shafqat Rasool", "Tanveer Abbas", "Mazhar Iqbal", "Kashif Riaz"];
const CLASS_SECTIONS = ["Prep-A", "1-A", "2-B", "3-A", "4-A", "4-B", "5-A", "6-A", "6-B", "7-A", "7-B", "7-B", "7-C", "8-A", "8-C", "9-A", "9-B", "10-A"];

let seed = 20261104;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)] as T;

function generate(count: number, campus: CampusCode, startGr: number, prefix: string, address: string): StudentRecord[] {
  const out: StudentRecord[] = [];
  for (let i = 0; i < count; i++) {
    const girl = rand() < 0.5;
    const father = pick(FATHERS);
    const first = girl ? pick(GIRLS) : pick(BOYS);
    const name = `${first} ${father.split(" ")[1]}`;
    const cls = pick(CLASS_SECTIONS);
    const r = rand();
    const feeStatus: FeeStatusCode = r < 0.58 ? "paid" : r < 0.84 ? "unpaid" : "overdue";
    const tuition = cls.startsWith("9") || cls.startsWith("10") ? 9000 : cls.startsWith("7") || cls.startsWith("8") || cls.startsWith("6") ? 8500 : 7000;
    const cnic = `3130${String(3000000000 + Math.floor(rand() * 999999999)).slice(0, 9)}`;
    out.push(
      base({
        grNo: `${prefix}-${startGr + i * 7}`,
        name,
        relation: girl ? "d/o" : "s/o",
        father,
        fatherCnic: cnic,
        gender: girl ? "F" : "M",
        campus,
        classSection: cls,
        status: "ACTIVE",
        feeStatus,
        balance: feeStatus === "paid" ? 0 : feeStatus === "unpaid" ? tuition : tuition * 2,
        dob: `20${10 + Math.floor(rand() * 9)}-0${1 + Math.floor(rand() * 9)}-1${Math.floor(rand() * 9)}`,
        admissionDate: `202${Math.floor(rand() * 6)}-04-0${1 + Math.floor(rand() * 8)}`,
        rollNo: 1 + Math.floor(rand() * 40),
        guardian: g(father, cnic, `03${10 + Math.floor(rand() * 40)}${String(1000000 + Math.floor(rand() * 8999999))}`, address),
        enrolment: [],
      }),
    );
  }
  return out;
}

// ---- Students records module: a few more fictional records that show every enrolment status ----
// (added after the generated students so the generator's sequence is unchanged)
const EXTRA: StudentRecord[] = [
  // The same girl registered twice: Zainab Akhtar (KC-15230) was entered again at Sugar Mill Campus with a spelling
  // variant. Same father's CNIC and date of birth, so the duplicate review queue flags the pair.
  base({
    grNo: "SM-5241",
    name: "Zainab Akhter",
    relation: "d/o",
    father: "Naveed Akhter",
    fatherCnic: "3130377788814",
    gender: "F",
    campus: "SM",
    classSection: "6-A",
    status: "ACTIVE",
    feeStatus: "unpaid",
    balance: 8500,
    dob: "2012-04-13",
    admissionDate: "2026-09-01",
    rollNo: 18,
    guardian: { name: "Naveed Akhter", relation: "Father", cnic: "3130377788814", mobile: "03045550123", address: "Sugar Mill Colony" },
    enrolment: [ev("e1", "2026-09-01", "ADMITTED", "Admitted · Class 6-A", "Session 2026–27 · Sugar Mill Campus")],
  }),
  // Struck off for continuous absence: can be restored.
  base({
    grNo: "KC-14215",
    name: "Usman Tariq",
    relation: "s/o",
    father: "Tariq Jamil",
    fatherCnic: "3130334534534",
    gender: "M",
    campus: "KC",
    classSection: "8-A",
    status: "STRUCK_OFF",
    feeStatus: "overdue",
    balance: 17000,
    dob: "2012-11-02",
    admissionDate: "2019-04-08",
    rollNo: 27,
    guardian: { name: "Tariq Jamil", relation: "Father", cnic: "3130334534534", mobile: "03123344556", address: "House 15, Street 8, Sadiqabad", occupation: "Driver" },
    enrolment: [
      ev("e1", "2019-04-08", "ADMITTED", "Admitted · Class 1-A", "Session 2019–20 · Khalid Campus"),
      ev("e2", "2026-04-01", "PROMOTED", "Promoted to Class 8-A", "Session 2026–27"),
      ev("e3", "2026-10-30", "STRUCK_OFF", "Struck off", "Continuous absence · absent since 21-Oct-2026"),
    ],
  }),
  // Expelled after a discipline case.
  base({
    grNo: "KC-14108",
    name: "Shahzaib Anwar",
    relation: "s/o",
    father: "Anwar Saleem",
    fatherCnic: "3130312341234",
    gender: "M",
    campus: "KC",
    classSection: "9-B",
    status: "EXPELLED",
    feeStatus: "paid",
    balance: 0,
    dob: "2011-06-25",
    admissionDate: "2018-04-09",
    rollNo: 31,
    guardian: { name: "Anwar Saleem", relation: "Father", cnic: "3130312341234", mobile: "03192233445", address: "House 2, Gulshan-e-Iqbal, Sadiqabad" },
    enrolment: [
      ev("e1", "2018-04-09", "ADMITTED", "Admitted · Class 1-B", "Session 2018–19 · Khalid Campus"),
      ev("e2", "2026-04-01", "PROMOTED", "Promoted to Class 9-B", "Session 2026–27"),
      ev("e3", "2026-09-18", "EXPELLED", "Expelled", "Discipline violation · approved by Mrs Sadia Rehman (Principal)"),
    ],
  }),
  // Passed out at the end of last session; leaving certificate issued.
  base({
    grNo: "KC-13981",
    name: "Sara Nadeem",
    relation: "d/o",
    father: "Nadeem Abbas",
    fatherCnic: "3130301230123",
    gender: "F",
    campus: "KC",
    classSection: "10-A",
    status: "PASSED_OUT",
    feeStatus: "paid",
    balance: 0,
    dob: "2010-02-08",
    admissionDate: "2016-04-04",
    rollNo: 4,
    guardian: { name: "Nadeem Abbas", relation: "Father", cnic: "3130301230123", mobile: "03191122334", address: "House 8, Model Town, Sadiqabad" },
    enrolment: [
      ev("e1", "2016-04-04", "ADMITTED", "Admitted · Class 1-A", "Session 2016–17 · Khalid Campus"),
      ev("e2", "2025-04-01", "PROMOTED", "Promoted to Class 10-A", "Session 2025–26"),
      ev("e3", "2026-03-31", "PASSED_OUT", "Passed out after Class 10", "Session 2025–26 · school leaving certificate issued"),
    ],
    leftOn: "2026-03-31",
  }),
  // Moved from Khalid Campus to Humaira Campus in August; the G.R. number and history moved with her.
  base({
    grNo: "KC-14598",
    name: "Rameen Asif",
    relation: "d/o",
    father: "Asif Mehmood",
    fatherCnic: "3130350697887",
    gender: "F",
    campus: "HC",
    classSection: "5-A",
    status: "ACTIVE",
    feeStatus: "paid",
    balance: 0,
    dob: "2015-12-19",
    admissionDate: "2022-04-04",
    rollNo: 9,
    guardian: { name: "Asif Mehmood", relation: "Father", cnic: "3130350697887", mobile: "03215566770", address: "House 61, Block D, Johar Town, Lahore", occupation: "Bank officer" },
    enrolment: [
      ev("e1", "2022-04-04", "ADMITTED", "Admitted · Class 2-A", "Session 2022–23 · Khalid Campus"),
      ev("e2", "2026-04-01", "PROMOTED", "Promoted to Class 5-A", "Session 2026–27"),
      ev("e3", "2026-08-03", "TRANSFER_OUT", "Transferred out of Khalid Campus", "Family moved to Lahore"),
      ev("e4", "2026-08-03", "TRANSFER_IN", "Transferred in · Humaira Campus 5-A", "History and G.R. number kept"),
    ],
  }),
];

export const STUDENTS: StudentRecord[] = [
  ...CAST,
  ...NAMED_STUDENTS,
  ...generate(56, "KC", 14400, "KC", "Sadiqabad"),
  ...generate(8, "HC", 22100, "HC", "Lahore"),
  ...generate(6, "UC", 8700, "UC", ""),
  ...generate(5, "SM", 5200, "SM", ""),
  ...generate(5, "MC", 3300, "MC", ""),
  ...EXTRA,
];

// Extra profile details for the brief's family (added fields only).
for (const [grNo, extra] of [
  ["KC-14823", { bloodGroup: "B+", religion: "Islam", admittedInClass: "Class 1", previousSchool: "None (first school)", bForm: "3130324680135" }],
  ["KC-15102", { bloodGroup: "O+", religion: "Islam", admittedInClass: "Class 1", previousSchool: "None (first school)" }],
  ["UC-08831", { bloodGroup: "B+", religion: "Islam", admittedInClass: "Class 2", previousSchool: "The City Montessori, Sadiqabad" }],
] as const) {
  const s = STUDENTS.find((x) => x.grNo === grNo);
  if (s) Object.assign(s, extra);
}

// Board roll numbers (fictional). Class 10 students got their Part-I number for last year's Class 9 board exam;
// some Class 9 students already have this year's Part-I slip; a few in Class 10 have their Part-II number too.
// Every third student is left without one, so the collection sheet shows blanks to fill in.
STUDENTS.filter((s) => /^(9|10)-/.test(s.classSection) && (s.status === "ACTIVE" || s.status === "PASSED_OUT")).forEach((s, i) => {
  if (i % 3 === 2) return;
  const n = 410200 + ((i * 7919) % 8800);
  const tenth = s.classSection.startsWith("10");
  s.boardRollNo = { partI: String(n), ...(tenth && i % 2 === 0 ? { partII: String(n + 151000) } : {}) };
});

// Earlier qualifications (fictional): about half the Class 9 students have their Class 8 (PEC) result on record.
// Class 10's Part-I board result is in Exams (Matric Part I board result), not repeated here.
STUDENTS.filter((s) => s.classSection.startsWith("9-") && s.status === "ACTIVE").forEach((s) => {
  const h = [...s.grNo].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 9973, 7);
  if (h % 3 === 0) return;
  s.qualifications = [{ id: `q-${s.grNo}-c8`, exam: "Class 8 (PEC) Annual 2026", board: "Punjab Examination Commission", year: 2026, rollNo: `08-${String(10000 + (h % 89999))}`, obtained: 280 + (h % 200), total: 500, rowVer: 1, updatedBy: "Office", updatedAt: "2026-05-02T10:00:00+05:00" }];
});

export function findStudent(grNo: string): StudentRecord | undefined {
  const key = grNo.replace(/[^a-z0-9]/gi, "").toUpperCase();
  return STUDENTS.find((s) => s.grNo.replace("-", "").toUpperCase() === key);
}
