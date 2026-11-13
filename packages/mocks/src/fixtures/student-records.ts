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
