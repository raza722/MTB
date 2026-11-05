// The fictional student records the unfinished modules' mocks still share (admissions, exams, fees, reports, SMS).
//
// Students is served by the real backend now (backend/docs/modules/01_students.md): every /api/students, /api/search,
// /api/families, /api/promotion, /api/sections, /api/movements and /api/documents request falls through to it.
// What is left here is the mock store those other modules read and write while they are still fictional
// (conventions §5): admissions admits and merges students, exams change a student's group, fees read status notes,
// reports and SMS read the movement log. No route handlers live here.
import { type AdmissionsApplicant, type CampusCode, type EnrolmentEvent, type StudentMovement, type StudentSummary } from "@mtb/api";
import { formatSession, type IsoDate } from "@mtb/domain";
import { CURRENT_SESSION, DEMO_TODAY } from "../clock";
import { createStore } from "../db";
import { initialApplicants } from "../fixtures/admissions";
import { classTeacher } from "../fixtures/attendance";
import { CLASSES, tuitionFor } from "../fixtures/campuses";
import { groupOfStudent, INITIAL_MOVEMENTS, seatsFor } from "../fixtures/student-records";
import { findStudent, STUDENTS, type StudentRecord } from "../fixtures/students";
import { feesStore, financeOf } from "./fees-state";

/* ================================================================ small helpers */

const CUR = CURRENT_SESSION;
/** Every class-section in school order: "Prep-A" … "10-B" (the same order the attendance mock uses for class teachers). */
const ALL_SECTIONS: string[] = CLASSES.flatMap((c) => c.sections.map((s) => `${c.short}-${s}`));
const classShortOf = (cs: string) => cs.split("-")[0] ?? "";
export const sessionOfDate = (d: IsoDate) => {
  const [y, m] = d.split("-").map(Number) as [number, number];
  return m >= 4 ? y : y - 1;
};
function addDays(d: IsoDate, n: number): IsoDate {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
const hashNum = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 100_003, 7);
const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const live = (s: StudentRecord) => !s.mergedInto;

export function toSummary(s: StudentRecord): StudentSummary {
  const { balance, feeStatus } = financeOf(s.grNo);
  return {
    grNo: s.grNo,
    name: s.name,
    ...(s.nameUr ? { nameUr: s.nameUr } : {}),
    relation: s.relation,
    father: s.father,
    fatherCnic: s.fatherCnic,
    gender: s.gender,
    campus: s.campus,
    campusName: s.campusName,
    classSection: s.classSection,
    session: s.session,
    status: s.status,
    feeStatus,
    balance,
  };
}

/* ================================================================ the store */

interface RecordsState {
  /** Students admitted (or found admitted in the applicant fixtures) during the demo. */
  added: StudentRecord[];
  /** Field changes to any student, applied over the fixtures. */
  patches: Record<string, Partial<StudentRecord>>;
  /** The fictional leaving / struck-off / transfer log the reports and SMS mocks read. */
  movements: StudentMovement[];
  grSeq: Record<string, number>;
}

/** Students the applicant fixtures say were admitted but the student fixtures don't have yet. */
function admittedFromApplicants(): StudentRecord[] {
  return initialApplicants()
    .filter((a) => a.stage === "ADMITTED" && a.grNo && !findStudent(a.grNo))
    .map((a) => applicantToStudent(a, a.grNo!, a.admittedClassSection ?? `${a.classApplied.replace("Class ", "")}-A`, a.admittedOn ?? a.offeredOn ?? a.appliedOn, 1 + (hashNum(a.grNo!) % 30), "Office"));
}

function applicantToStudent(a: AdmissionsApplicant, grNo: string, classSection: string, admissionDate: IsoDate, rollNo: number, by: string, house?: string): StudentRecord {
  return {
    grNo,
    name: a.name,
    ...(a.nameUr ? { nameUr: a.nameUr } : {}),
    relation: a.relation,
    father: a.father,
    fatherCnic: a.fatherCnic,
    gender: a.gender,
    campus: a.campus,
    campusName: a.campusName,
    classSection,
    session: sessionOfDate(admissionDate),
    status: "ACTIVE",
    feeStatus: "unpaid",
    balance: 0,
    dob: a.dob,
    admissionDate,
    rollNo,
    ...(house ? { house } : {}),
    guardian: { name: a.father, relation: "Father", cnic: a.fatherCnic, mobile: a.mobile, address: a.address, ...(a.fatherOccupation ? { occupation: a.fatherOccupation } : {}) },
    ...(a.mother ? { mother: a.mother } : {}),
    ...(a.bForm ? { bForm: a.bForm } : {}),
    ...(a.previousSchool ? { previousSchool: a.previousSchool } : {}),
    // The rest of the admission form travels with the child (one record, nothing typed twice).
    ...(a.stream ? { stream: a.stream } : {}),
    ...(a.religion ? { religion: a.religion } : {}),
    ...(a.disability ? { disability: a.disability } : {}),
    ...(a.identificationMark ? { identificationMark: a.identificationMark } : {}),
    ...(a.birthCertificateNo ? { birthCertificateNo: a.birthCertificateNo } : {}),
    ...(a.email ? { email: a.email } : {}),
    ...(a.homePhone ? { homePhone: a.homePhone } : {}),
    ...(a.city ? { city: a.city } : {}),
    ...(a.tempAddress ? { tempAddress: a.tempAddress } : {}),
    ...(a.fatherQualification ? { fatherQualification: a.fatherQualification } : {}),
    ...(a.fatherOccupation ? { fatherOccupation: a.fatherOccupation } : {}),
    ...(a.motherQualification ? { motherQualification: a.motherQualification } : {}),
    ...(a.motherOccupation ? { motherOccupation: a.motherOccupation } : {}),
    ...(a.emergencyContact ? { emergencyContact: a.emergencyContact } : {}),
    ...(a.hostel !== undefined ? { hostel: a.hostel } : {}),
    ...(a.admissionReference ? { admissionReference: a.admissionReference } : {}),
    admittedInClass: a.classApplied,
    enrolment: [
      {
        id: "e1",
        date: admissionDate,
        kind: "ADMITTED",
        title: `Admitted · Class ${classSection}`,
        description: `Session ${formatSession(sessionOfDate(admissionDate))} · ${a.campusName} · application ${a.applicationNo}${a.testScore !== null ? ` · entrance test ${a.testScore}/${a.testMax}` : ""}`,
        by,
      },
    ],
  };
}

function initialRecords(): RecordsState {
  const added = admittedFromApplicants();
  const grSeq: Record<string, number> = {};
  for (const s of [...STUDENTS, ...added]) {
    const [prefix, num] = s.grNo.split("-");
    if (prefix && num && prefix === s.grNo.slice(0, 2)) grSeq[prefix] = Math.max(grSeq[prefix] ?? 0, Number(num));
  }
  return { added, patches: {}, movements: INITIAL_MOVEMENTS, grSeq };
}

// A new store name: the old "student-records" store also held families, promotion, documents and so on.
const recordsStore = createStore<RecordsState>("student-records-model", initialRecords);

/** Puts the demo's changes onto the shared student list (on load, and after a page reload). */
function applyOverlay() {
  const st = recordsStore.get();
  for (const a of st.added) if (!STUDENTS.some((s) => s.grNo === a.grNo)) STUDENTS.push(structuredClone(a));
  for (const [grNo, p] of Object.entries(st.patches)) {
    const s = STUDENTS.find((x) => x.grNo === grNo);
    if (s) Object.assign(s, p);
  }
}
try {
  applyOverlay();
} catch {
  /* storage unavailable: fixtures only */
}

export function patchStudent(grNo: string, patch: Partial<StudentRecord>) {
  const s = STUDENTS.find((x) => x.grNo === grNo);
  if (!s) return;
  Object.assign(s, patch);
  recordsStore.set((st) => ({ ...st, patches: { ...st.patches, [grNo]: { ...st.patches[grNo], ...patch } } }));
}

function addEvent(grNo: string, kind: EnrolmentEvent["kind"], title: string, description?: string, by?: string, date: IsoDate = DEMO_TODAY) {
  const s = STUDENTS.find((x) => x.grNo === grNo);
  if (!s) return;
  const e: EnrolmentEvent = { id: uid("e"), date, kind, title, ...(description ? { description } : {}), ...(by ? { by } : {}) };
  patchStudent(grNo, { enrolment: [...s.enrolment, e] });
}

function addStudent(rec: StudentRecord) {
  STUDENTS.push(rec);
  recordsStore.set((st) => ({ ...st, added: [...st.added, structuredClone(rec)] }));
}

/* ================================================================ read helpers for other mocks */

/**
 * Group (stream) of a student in a class with groups, by G.R. number and class. Without a stored group the
 * student is spread over the groups Setup has subjects for, so nobody lands in an empty group.
 * Also used for the generated classmates on the report registers (no record of their own).
 */
export function streamFor(grNo: string, classSection: string, stored?: string): string | undefined {
  return groupOfStudent(grNo, classShortOf(classSection), stored);
}

/** Every change of status on record (leaving, struck off, expelled, restored, transfers), oldest first. */
export const allMovements = (): StudentMovement[] => recordsStore.get().movements;

export function statusNoteOf(s: StudentRecord): { on: IsoDate; reason: string; remarks?: string; by?: string } | undefined {
  if (s.status === "ACTIVE") return undefined;
  const kinds = new Set(["LEFT", "STRUCK_OFF", "EXPELLED", "PASSED_OUT"]);
  const m = [...recordsStore.get().movements].reverse().find((x) => x.grNo === s.grNo && kinds.has(x.kind));
  if (m) return { on: m.date, reason: m.reason, ...(m.remarks ? { remarks: m.remarks } : {}), by: m.by };
  const e = [...s.enrolment].reverse().find((x) => kinds.has(x.kind));
  return e ? { on: e.date, reason: e.description ?? e.title } : s.leftOn ? { on: s.leftOn, reason: "Left the school" } : undefined;
}

/* ================================================================ families (ids only, for the admissions mock) */

const familyKeyOf = (s: Pick<StudentRecord, "fatherCnic" | "guardian">) => s.fatherCnic || `M${s.guardian.mobile}`;

function familyIds(): Map<string, string> {
  const ids = new Map<string, string>();
  for (const s of STUDENTS) {
    const k = familyKeyOf(s);
    if (!ids.has(k)) ids.set(k, `FAM-${1001 + ids.size}`);
  }
  return ids;
}

export const familyIdOf = (s: StudentRecord) => familyIds().get(familyKeyOf(s));

/* ================================================================ admission (used by the admissions mock) */

export function peekGrNo(campus: CampusCode): string {
  return `${campus}-${(recordsStore.get().grSeq[campus] ?? 1000) + 1}`;
}

export function sectionStats(campus: CampusCode, classShort: string) {
  const cls = CLASSES.find((c) => c.short === classShort);
  return (cls?.sections ?? ["A"]).map((sec) => {
    const cs = `${classShort}-${sec}`;
    const kids = STUDENTS.filter((s) => live(s) && s.campus === campus && s.classSection === cs && s.status === "ACTIVE");
    return {
      section: sec,
      classSection: cs,
      seats: seatsFor(classShort),
      enrolled: kids.length,
      nextRollNo: 1 + Math.max(0, ...kids.map((k) => k.rollNo)),
      girls: kids.filter((k) => k.gender === "F").length,
      boys: kids.filter((k) => k.gender === "M").length,
      ...(campus ? { classTeacher: classTeacher(campus, cs, Math.max(0, ALL_SECTIONS.indexOf(cs))) } : {}),
    };
  });
}

/** Creates the student from the applicant on the same person: G.R. number, enrolment, placement, roll number and first charges. */
export function admitStudent(a: AdmissionsApplicant, classSection: string, admissionDate: IsoDate, admissionFee: number, by: string, house?: string): { student: StudentRecord; charges: Array<{ head: string; amount: number; dueDate: IsoDate }> } {
  const st = recordsStore.get();
  const n = (st.grSeq[a.campus] ?? 1000) + 1;
  const grNo = `${a.campus}-${n}`;
  recordsStore.set({ ...st, grSeq: { ...st.grSeq, [a.campus]: n } });
  const stats = sectionStats(a.campus, classShortOf(classSection)).find((x) => x.classSection === classSection);
  const student = applicantToStudent(a, grNo, classSection, admissionDate, stats?.nextRollNo ?? 1, by, house);
  addStudent(student);
  const tuition = tuitionFor(classShortOf(classSection));
  const charges = [
    { head: "Admission fee 2026–27", amount: admissionFee, dueDate: addDays(admissionDate, 7) },
    { head: "Tuition fee – Nov 2026", amount: tuition, dueDate: "2026-11-10" as IsoDate },
  ];
  feesStore.set((fs) => ({
    ...fs,
    charges: {
      ...fs.charges,
      [grNo]: charges.map((c, i) => ({ id: `${grNo}:adm${i}`, grNo, session: CUR, head: c.head, kind: "FEE" as const, amount: c.amount, dueDate: c.dueDate, status: "OPEN" as const, settledAmount: 0 })),
    },
  }));
  return { student, charges };
}

/** A duplicate student record folded into the surviving one (Admissions → Possible duplicates). */
export function mergeStudentRecords(survivorGrNo: string, absorbedGrNo: string, kept: Partial<StudentRecord>, by: string) {
  const absorbed = STUDENTS.find((s) => s.grNo === absorbedGrNo);
  const survivor = STUDENTS.find((s) => s.grNo === survivorGrNo);
  if (!absorbed || !survivor) return;
  if (Object.keys(kept).length) patchStudent(survivorGrNo, kept);
  addEvent(survivorGrNo, "NOTE", `Duplicate record ${absorbedGrNo} merged into this record`, `${absorbed.campusName} · ${absorbed.classSection}`, by);
  patchStudent(absorbedGrNo, { mergedInto: survivorGrNo, status: "LEFT", leftOn: DEMO_TODAY });
}
