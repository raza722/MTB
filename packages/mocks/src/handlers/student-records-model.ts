// The fictional student records the unfinished modules' mocks still share (admissions, exams, fees, reports, SMS).
//
// Students is served by the real backend now (backend/docs/modules/01_students.md): every /api/students, /api/search,
// /api/families, /api/promotion, /api/sections, /api/movements and /api/documents request falls through to it.
// What is left here is the mock store those other modules read and write while they are still fictional
// (conventions §5): the fictional applicants admitted in fixtures/admissions.ts appear as students, exams change a
// student's group, fees read status notes, reports and SMS read the movement log. No route handlers live here.
import { type AdmissionsApplicant, type StudentMovement, type StudentSummary } from "@mtb/api";
import { formatSession, type IsoDate } from "@mtb/domain";
import { createStore } from "../db";
import { initialApplicants } from "../fixtures/admissions";
import { INITIAL_MOVEMENTS } from "../fixtures/student-records";
import { findStudent, STUDENTS, type StudentRecord } from "../fixtures/students";
import { financeOf } from "./fees-state";

/* ================================================================ small helpers */

const sessionOfDate = (d: IsoDate) => {
  const [y, m] = d.split("-").map(Number) as [number, number];
  return m >= 4 ? y : y - 1;
};
const hashNum = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 100_003, 7);

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
  /** Students the applicant fixtures say were admitted. */
  added: StudentRecord[];
  /** Field changes to any student, applied over the fixtures. */
  patches: Record<string, Partial<StudentRecord>>;
  /** The fictional leaving / struck-off / transfer log the reports and SMS mocks read. */
  movements: StudentMovement[];
}

/** Students the applicant fixtures say were admitted but the student fixtures don't have yet. */
function admittedFromApplicants(): StudentRecord[] {
  return initialApplicants()
    .filter((a) => a.stage === "ADMITTED" && a.grNo && !findStudent(a.grNo))
    .map((a) => applicantToStudent(a, a.grNo!, a.admittedClassSection ?? `${a.classApplied.replace("Class ", "")}-A`, a.admittedOn ?? a.offeredOn ?? a.appliedOn, 1 + (hashNum(a.grNo!) % 30), "Office"));
}

function applicantToStudent(a: AdmissionsApplicant, grNo: string, classSection: string, admissionDate: IsoDate, rollNo: number, by: string): StudentRecord {
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
    dob: a.dob ?? "",
    admissionDate,
    rollNo,
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
        description: `Session ${formatSession(sessionOfDate(admissionDate))} · ${a.campusName} · application ${a.applicationNo}${a.testScore !== null && a.testMax ? ` · entrance test ${a.testScore}/${a.testMax}` : ""}`,
        by,
      },
    ],
  };
}

function initialRecords(): RecordsState {
  return { added: admittedFromApplicants(), patches: {}, movements: INITIAL_MOVEMENTS };
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

/* ================================================================ read helpers for other mocks */

export function statusNoteOf(s: StudentRecord): { on: IsoDate; reason: string; remarks?: string; by?: string } | undefined {
  if (s.status === "ACTIVE") return undefined;
  const kinds = new Set(["LEFT", "STRUCK_OFF", "EXPELLED", "PASSED_OUT"]);
  const m = [...recordsStore.get().movements].reverse().find((x) => x.grNo === s.grNo && kinds.has(x.kind));
  if (m) return { on: m.date, reason: m.reason, ...(m.remarks ? { remarks: m.remarks } : {}), by: m.by };
  const e = [...s.enrolment].reverse().find((x) => kinds.has(x.kind));
  return e ? { on: e.date, reason: e.description ?? e.title } : s.leftOn ? { on: s.leftOn, reason: "Left the school" } : undefined;
}
