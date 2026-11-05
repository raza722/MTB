import type { ClassHistoryRow, StudentDocDetails, StudentDocType, StudentFamilyGuardian, StudentMovement } from "@mtb/api";
import type { IsoDate, IsoDateTime } from "@mtb/domain";
import { campusName } from "./campuses";
import { initialClassSubjects, initialGroups, initialSections, initialSubjects, type SectionRecord } from "./setup";

/** Houses at Khalid Campus (fictional). */
export const HOUSES = ["Iqbal House", "Jinnah House", "Liaquat House", "Sir Syed House"];

/** Seats per section (class strength limit). */
export const seatsFor = (classShort: string) => (classShort === "Prep" ? 30 : classShort === "1" || classShort === "2" ? 35 : 40);

/* ---------------------------------------------------------------- Groups (streams), one list for every module */

const GROUPS = initialGroups().filter((g) => g.active);
const classIdOf = (classShort: string) => `c-${classShort.toLowerCase()}`;

/** Every group in Setup → Subjects → Groups: "Science (Biology)", "Science (Computer)", "Humanities". */
export const STREAMS: string[] = GROUPS.map((g) => g.name);

/** Groups offered in a class ("9" → the three groups; "7" → none). */
export const groupsOfClass = (classShort: string): string[] => GROUPS.filter((g) => g.classIds.includes(classIdOf(classShort))).map((g) => g.name);

const CLASS_SUBJECTS = initialClassSubjects();
const SUBJECT_NAME = new Map(initialSubjects().map((s) => [s.id, s.name]));

/** Subjects a group studies in a class, from Setup → Subjects and marks (empty when Setup has none for that group). */
export function subjectsOfGroup(classShort: string, group: string | undefined): string[] {
  const groupId = group ? (GROUPS.find((g) => g.name === group)?.id ?? null) : null;
  const rec = CLASS_SUBJECTS.find((r) => r.classId === classIdOf(classShort) && r.groupId === groupId);
  return (rec?.subjects ?? []).map((r) => SUBJECT_NAME.get(r.subjectId) ?? r.subjectId).sort((a, b) => a.localeCompare(b));
}

/** Groups a student can be placed in by default: the ones Setup has subjects for (nobody sits in an empty group). */
export const groupsWithSubjects = (classShort: string): string[] => groupsOfClass(classShort).filter((g) => subjectsOfGroup(classShort, g).length > 0);

/** Names used before the group list came from Setup, mapped to the Setup names. */
const OLD_GROUP_NAME: Record<string, string> = { Science: "Science (Biology)", "Computer Science": "Science (Computer)" };
export const normalizeGroup = (g: string) => OLD_GROUP_NAME[g] ?? g;

const groupHash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 100_003, 7);

/**
 * A student's group (stream) in a class with groups. The one rule every module uses (profile, exams rosters, ID cards,
 * group-wise lists, board-document sheet): the group stored on the record wins; without one, the student is spread by
 * G.R. number over the groups Setup has subjects for, so nobody lands in an empty group. The real backend reads the
 * enrolment's group.
 */
export function groupOfStudent(grNo: string, classShort: string, stored?: string): string | undefined {
  if (!groupsOfClass(classShort).length) return undefined;
  if (stored) return normalizeGroup(stored);
  const pool = groupsWithSubjects(classShort);
  const list = pool.length ? pool : STREAMS;
  return list.length ? list[groupHash(grNo) % list.length] : undefined;
}

let sectionCache: Map<string, SectionRecord> | null = null;
/** A section as Setup → Classes and sections has it (seats, room), by campus, session and "7-B". */
export function setupSectionOf(campus: string, session: number, classSection: string): SectionRecord | undefined {
  if (!sectionCache) sectionCache = new Map(initialSections().map((s) => [s.id, s]));
  return sectionCache.get(`${campus}-${session}-${classSection}`);
}

const row = (session: number, campus: ClassHistoryRow["campus"], classSection: string, from: IsoDate, to: IsoDate | undefined, reason: string, outcome?: string, rollNo?: number): ClassHistoryRow => ({
  session,
  campus,
  campusName: campusName(campus),
  classSection,
  from,
  ...(to ? { to } : {}),
  reason,
  ...(outcome ? { outcome } : {}),
  ...(rollNo !== undefined ? { rollNo } : {}),
});

/** Class histories written out where the brief tells the story (others are derived from admission date and class). */
export const CLASS_HISTORY: Record<string, ClassHistoryRow[]> = {
  "KC-14823": [
    row(2020, "KC", "1-A", "2020-04-06", "2021-03-31", "Admitted", "Promoted"),
    row(2021, "KC", "2-A", "2021-04-01", "2022-03-31", "Promoted", "Promoted"),
    row(2022, "KC", "3-A", "2022-04-01", "2023-03-31", "Promoted", "Promoted"),
    row(2023, "KC", "4-A", "2023-04-01", "2024-03-31", "Promoted", "Promoted"),
    row(2024, "KC", "5-A", "2024-04-01", "2025-03-31", "Promoted", "Promoted"),
    row(2025, "KC", "6-A", "2025-04-01", "2026-03-31", "Promoted", "Promoted"),
    row(2026, "KC", "7-A", "2026-04-01", "2026-08-17", "Promoted", undefined, 14),
    row(2026, "KC", "7-B", "2026-08-18", undefined, "Section change (approved by Mrs Sadia Rehman)", undefined, 12),
  ],
  "KC-15102": [
    row(2023, "KC", "1-A", "2023-04-03", "2024-03-31", "Admitted", "Promoted"),
    row(2024, "KC", "2-A", "2024-04-01", "2025-03-31", "Promoted", "Promoted"),
    row(2025, "KC", "3-A", "2025-04-01", "2026-03-31", "Promoted", "Promoted"),
    row(2026, "KC", "4-A", "2026-04-01", undefined, "Promoted", undefined, 7),
  ],
  "UC-08831": [
    row(2019, "UC", "2-A", "2019-04-08", "2020-03-31", "Admitted", "Promoted"),
    row(2020, "UC", "3-A", "2020-04-01", "2021-03-31", "Promoted", "Promoted"),
    row(2021, "UC", "4-A", "2021-04-01", "2022-03-31", "Promoted", "Promoted"),
    row(2022, "UC", "5-A", "2022-04-01", "2023-03-31", "Promoted", "Promoted"),
    row(2023, "UC", "6-A", "2023-04-01", "2024-03-31", "Promoted", "Promoted"),
    row(2024, "UC", "7-A", "2024-04-01", "2025-03-31", "Promoted", "Promoted"),
    row(2025, "UC", "8-A", "2025-04-01", "2026-03-31", "Promoted", "Promoted"),
    row(2026, "UC", "9-A", "2026-04-01", undefined, "Promoted", undefined, 21),
  ],
  "KC-14598": [
    row(2022, "KC", "2-A", "2022-04-04", "2023-03-31", "Admitted", "Promoted"),
    row(2023, "KC", "3-A", "2023-04-01", "2024-03-31", "Promoted", "Promoted"),
    row(2024, "KC", "4-A", "2024-04-01", "2025-03-31", "Promoted", "Promoted"),
    row(2025, "KC", "4-A", "2025-04-01", "2026-03-31", "Repeated the class", "Promoted"),
    row(2026, "KC", "5-A", "2026-04-01", "2026-08-02", "Promoted", "Transferred out"),
    row(2026, "HC", "5-A", "2026-08-03", undefined, "Transferred in from Khalid Campus", undefined, 9),
  ],
};

const mv = (
  id: string,
  kind: StudentMovement["kind"],
  grNo: string,
  name: string,
  relation: "s/o" | "d/o",
  father: string,
  classSection: string,
  campus: StudentMovement["campus"],
  date: IsoDate,
  reason: string,
  by: string,
  balanceAtTime: number,
  extra: Partial<StudentMovement> = {},
): StudentMovement => ({ id, kind, grNo, name, relation, father, classSection, campus, campusName: campusName(campus), date, reason, by, balanceAtTime, ...extra });

/** What happened before the demo starts: matches the statuses of the fixture students. */
export const INITIAL_MOVEMENTS: StudentMovement[] = [
  mv("mv-1", "PASSED_OUT", "KC-13981", "Sara Nadeem", "d/o", "Nadeem Abbas", "10-A", "KC", "2026-03-31", "Completed Class 10", "Farah Naz", 0, { remarks: "Leaving certificate issued the same day." }),
  mv("mv-2", "LEFT", "KC-14502", "Hassan Iqbal", "s/o", "Javed Iqbal", "9-B", "KC", "2026-06-30", "Family moved to another city", "Farah Naz", 9000, { remarks: "Family moved to Rahim Yar Khan. Dues of Rs 9,000 still to be collected." }),
  mv("mv-3", "TRANSFER", "KC-14598", "Rameen Asif", "d/o", "Asif Mehmood", "5-A", "KC", "2026-08-03", "Family moved closer to the other campus", "Kamran Yousaf", 0, {
    toCampus: "HC",
    toCampusName: campusName("HC"),
    toClassSection: "5-A",
    approvedBy: "Mrs Sadia Rehman",
    remarks: "Father posted to Lahore. G.R. number and history kept.",
  }),
  mv("mv-4", "STRUCK_OFF", "KC-14215", "Usman Tariq", "s/o", "Tariq Jamil", "8-A", "KC", "2026-09-05", "Non-payment of dues", "Usman Ali", 17000, { approvedBy: "Mrs Sadia Rehman" }),
  mv("mv-5", "RESTORED", "KC-14215", "Usman Tariq", "s/o", "Tariq Jamil", "8-A", "KC", "2026-09-12", "Dues cleared", "Usman Ali", 0, { remarks: "August and September dues paid at the counter." }),
  mv("mv-6", "EXPELLED", "KC-14108", "Shahzaib Anwar", "s/o", "Anwar Saleem", "9-B", "KC", "2026-09-18", "Discipline violation", "Kamran Yousaf", 0, { approvedBy: "Mrs Sadia Rehman", remarks: "Disciplinary committee decision of 16-Sep-2026." }),
  mv("mv-7", "STRUCK_OFF", "KC-14215", "Usman Tariq", "s/o", "Tariq Jamil", "8-A", "KC", "2026-10-30", "Continuous absence", "Farah Naz", 17000, { remarks: "Absent since 21-Oct-2026. Father not reachable on the registered mobile." }),
];

export interface DocumentSeed {
  id: string;
  type: StudentDocType;
  grNo: string;
  serial: number;
  issuedOn: IsoDate;
  issuedBy: string;
  details: StudentDocDetails;
  prints: Array<{ at: IsoDateTime; by: string; reason?: string }>;
  session: number;
  status?: "ISSUED" | "CANCELLED";
  cancelledReason?: string;
}

/** The issue register before the demo starts. Reprints show in the print log. */
export const DOCUMENT_SEEDS: DocumentSeed[] = [
  { id: "doc-1", type: "LEAVING_CERT", grNo: "KC-13981", serial: 187, session: 2025, issuedOn: "2026-03-31", issuedBy: "Farah Naz", details: { character: "Good", leavingReason: "Completed Class 10", remarks: "A regular and hard-working student.", receivedBy: "Nadeem Abbas (father)" }, prints: [{ at: "2026-03-31T11:20:00+05:00", by: "Farah Naz" }, { at: "2026-06-14T10:05:00+05:00", by: "Farah Naz", reason: "Extra copy for college admission" }] },
  { id: "doc-2", type: "CHARACTER_CERT", grNo: "KC-13981", serial: 92, session: 2025, issuedOn: "2026-03-31", issuedBy: "Farah Naz", details: { character: "Good", boardExam: "Secondary School Certificate (Annual) 2026", boardRollNo: "Awaited", boardMarks: "Awaited", receivedBy: "Nadeem Abbas (father)" }, prints: [{ at: "2026-03-31T11:24:00+05:00", by: "Farah Naz" }] },
  { id: "doc-3", type: "ID_CARD", grNo: "KC-14823", serial: 1204, session: 2026, issuedOn: "2026-04-15", issuedBy: "Farah Naz", details: { validUntil: "2027-03-31" }, prints: [{ at: "2026-04-15T09:40:00+05:00", by: "Farah Naz" }] },
  { id: "doc-4", type: "ID_CARD", grNo: "KC-15102", serial: 1205, session: 2026, issuedOn: "2026-04-15", issuedBy: "Farah Naz", details: { validUntil: "2027-03-31" }, prints: [{ at: "2026-04-15T09:40:00+05:00", by: "Farah Naz" }] },
  { id: "doc-5", type: "ID_CARD", grNo: "KC-14650", serial: 1188, session: 2026, issuedOn: "2026-04-14", issuedBy: "Farah Naz", details: { validUntil: "2027-03-31" }, prints: [{ at: "2026-04-14T10:10:00+05:00", by: "Farah Naz" }], status: "CANCELLED", cancelledReason: "Card lost; replaced by KC-ID-2627-1391" },
  { id: "doc-6", type: "ID_CARD", grNo: "KC-14650", serial: 1391, session: 2026, issuedOn: "2026-09-22", issuedBy: "Farah Naz", details: { validUntil: "2027-03-31" }, prints: [{ at: "2026-09-22T12:00:00+05:00", by: "Farah Naz" }] },
  { id: "doc-7", type: "APPRECIATION_LETTER", grNo: "KC-14988", serial: 63, session: 2025, issuedOn: "2026-04-10", issuedBy: "Farah Naz", details: { attendanceDays: 238, totalDays: 238, remarks: "Most regular student of her class in 2025–26." }, prints: [{ at: "2026-04-10T10:30:00+05:00", by: "Farah Naz" }] },
  { id: "doc-8", type: "ADMISSION_SLIP", grNo: "KC-15440", serial: 341, session: 2026, issuedOn: "2026-10-30", issuedBy: "Farah Naz", details: { receivedBy: "Waqas Ahmed (father)" }, prints: [{ at: "2026-10-30T12:15:00+05:00", by: "Farah Naz" }] },
  { id: "doc-9", type: "ADMISSION_SLIP", grNo: "KC-15433", serial: 338, session: 2026, issuedOn: "2026-10-22", issuedBy: "Farah Naz", details: { receivedBy: "Kashif Mahmood (father)" }, prints: [{ at: "2026-10-22T11:05:00+05:00", by: "Farah Naz" }] },
  { id: "doc-10", type: "CHARACTER_CERT", grNo: "KC-14911", serial: 118, session: 2026, issuedOn: "2026-10-12", issuedBy: "Farah Naz", details: { character: "Very good", remarks: "Issued on request for an inter-school debate.", receivedBy: "Abdul Rauf (father)" }, prints: [{ at: "2026-10-12T09:50:00+05:00", by: "Farah Naz" }] },
];

/** Extra guardians on record, by father's CNIC (the father comes from the student records). */
export const EXTRA_GUARDIANS: Record<string, Array<Omit<StudentFamilyGuardian, "id">>> = {
  "3630245678901": [
    { name: "Farah Imran", nameUr: "فرح عمران", relation: "Mother", cnic: "3630245678912", mobile: "03011234568", occupation: "Teacher", isPrimaryContact: false, isFeePayer: false, isEmergencyContact: true },
    { name: "Salman Khan", relation: "Uncle", cnic: "", mobile: "03337654321", isPrimaryContact: false, isFeePayer: false, isEmergencyContact: true },
  ],
  "3130344411126": [{ name: "Saba Kamran", relation: "Mother", cnic: "", mobile: "03004411229", isPrimaryContact: false, isFeePayer: false, isEmergencyContact: true }],
};

/** Urdu names of fathers where the office has them. */
export const FATHER_NAME_UR: Record<string, string> = { "3630245678901": "عمران خان" };

/** Last year's promotion runs at Khalid Campus (2025–26 → 2026–27), for the read-only view of last session. */
export const PROMOTION_HISTORY_2025: Array<{ from: string; to: string; promoted: number; detained: number; left: number; passedOut: number; sectionChanges: number; at: IsoDateTime; by: string }> = [
  { from: "Prep-A", to: "1", promoted: 28, detained: 0, left: 1, passedOut: 0, sectionChanges: 0, at: "2026-04-01T09:10:00+05:00", by: "Farah Naz" },
  { from: "1-A", to: "2", promoted: 31, detained: 1, left: 0, passedOut: 0, sectionChanges: 0, at: "2026-04-01T09:18:00+05:00", by: "Farah Naz" },
  { from: "3-A", to: "4", promoted: 33, detained: 1, left: 1, passedOut: 0, sectionChanges: 2, at: "2026-04-01T09:31:00+05:00", by: "Farah Naz" },
  { from: "5-A", to: "6", promoted: 34, detained: 0, left: 2, passedOut: 0, sectionChanges: 3, at: "2026-04-01T09:44:00+05:00", by: "Farah Naz" },
  { from: "6-A", to: "7", promoted: 32, detained: 1, left: 0, passedOut: 0, sectionChanges: 1, at: "2026-04-01T09:52:00+05:00", by: "Farah Naz" },
  { from: "6-B", to: "7", promoted: 31, detained: 0, left: 1, passedOut: 0, sectionChanges: 2, at: "2026-04-01T10:01:00+05:00", by: "Farah Naz" },
  { from: "8-A", to: "9", promoted: 30, detained: 2, left: 1, passedOut: 0, sectionChanges: 0, at: "2026-04-01T10:15:00+05:00", by: "Farah Naz" },
  { from: "9-B", to: "10", promoted: 29, detained: 1, left: 0, passedOut: 0, sectionChanges: 0, at: "2026-04-01T10:24:00+05:00", by: "Farah Naz" },
  { from: "10-A", to: "—", promoted: 0, detained: 0, left: 0, passedOut: 33, sectionChanges: 0, at: "2026-04-01T10:30:00+05:00", by: "Farah Naz" },
];
