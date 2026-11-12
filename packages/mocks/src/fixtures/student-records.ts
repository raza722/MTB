import type { StudentMovement } from "@mtb/api";
import type { IsoDate } from "@mtb/domain";
import { campusName } from "./campuses";
import { initialClassSubjects, initialGroups, initialSubjects } from "./setup";

/** Houses at Khalid Campus (fictional). */
export const HOUSES = ["Iqbal House", "Jinnah House", "Liaquat House", "Sir Syed House"];

/* ---------------------------------------------------------------- Groups (streams), one list for every module */

const GROUPS = initialGroups().filter((g) => g.active);
const classIdOf = (classShort: string) => `c-${classShort.toLowerCase()}`;

/** Every group in Setup → Subjects → Groups: "Science (Biology)", "Science (Computer)", "Humanities". */
const STREAMS: string[] = GROUPS.map((g) => g.name);

/** Groups offered in a class ("9" → the three groups; "7" → none). */
const groupsOfClass = (classShort: string): string[] => GROUPS.filter((g) => g.classIds.includes(classIdOf(classShort))).map((g) => g.name);

const CLASS_SUBJECTS = initialClassSubjects();
const SUBJECT_NAME = new Map(initialSubjects().map((s) => [s.id, s.name]));

/** Subjects a group studies in a class, from Setup → Subjects and marks (empty when Setup has none for that group). */
function subjectsOfGroup(classShort: string, group: string | undefined): string[] {
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
