// Families, promotion, sections and roll numbers, leaving and transfers, and issued documents.
// This module also owns the live student records: changes made in the demo (admissions, section moves,
// transfers, status changes) are kept in one store and applied to the shared STUDENTS list, so every other
// module's mock (fees, attendance, exams, SMS) sees the same students.
import {
  can,
  ENROLMENT_STATUS_LABEL,
  isHandoverDoc,
  STUDENT_DOC_LABEL,
  STUDENT_MOVEMENT_LABEL,
  studentMovementsAllowed,
  type StudentDocsCollectionRow,
  type StudentDocsCollectionSheet,
  type AdmissionsApplicant,
  type CampusCode,
  type ClassHistoryRow,
  type EnrolmentEvent,
  type NextSessionPlacement,
  type SectionAllotmentBoard,
  type SectionAllotmentRollOrder,
  type StudentDocDetails,
  type StudentDocIssued,
  type StudentDocSnapshot,
  type StudentRecordSheet,
  type StudentDocsPreview,
  type StudentDocType,
  type StudentFamilyChild,
  type StudentFamilyDetail,
  type StudentFamilyEvent,
  type StudentFamilyGuardian,
  type StudentFamilyGuardianInput,
  type StudentFamilyRow,
  type StudentMovement,
  type StudentMovementChange,
  type StudentPromotionBatch,
  type StudentPromotionCandidate,
  type StudentPromotionClassRow,
  type StudentPromotionItem,
  type StudentPromotionOutcome,
  type StudentSummary,
} from "@mtb/api";
import { formatCount, formatDate, formatMobile, formatRs, formatSession, isValidCnic, normalizeCnic, normalizeMobile, sessionCode, type IsoDate } from "@mtb/domain";
import { http, type HttpHandler } from "msw";
import { CURRENT_SESSION, DEMO_TODAY, demoNow } from "../clock";
import { createStore } from "../db";
import { initialApplicants } from "../fixtures/admissions";
import { classTeacher } from "../fixtures/attendance";
import { campusName, campusOf, CLASSES, tuitionFor } from "../fixtures/campuses";
import { initialCampuses } from "../fixtures/setup";
import {
  CLASS_HISTORY,
  DOCUMENT_SEEDS,
  EXTRA_GUARDIANS,
  FATHER_NAME_UR,
  groupOfStudent,
  groupsOfClass,
  HOUSES,
  INITIAL_MOVEMENTS,
  PROMOTION_HISTORY_2025,
  seatsFor,
} from "../fixtures/student-records";
import { findStudent, STUDENTS, type StudentRecord } from "../fixtures/students";
import { currentUser } from "./auth-state";
import { examRows, examsStore, followGroupChange } from "./exams";
import { studentSessionFee } from "./fee-setup";
import { setupCampusContact } from "./setup";
import { preparedFor, queueSms } from "./sms";
import { chargesOf, feesStore, financeOf } from "./fees-state";
import { ctxFrom, fail, HttpResponse, latency, requirePermission, requireUser } from "../util";

/* ================================================================ small helpers */

const CUR = CURRENT_SESSION;
/** Every class-section in school order: "Prep-A" … "10-B" (the same order the attendance mock uses for class teachers). */
const ALL_SECTIONS: string[] = CLASSES.flatMap((c) => c.sections.map((s) => `${c.short}-${s}`));
export const classShortOf = (cs: string) => cs.split("-")[0] ?? "";
export const sectionOf = (cs: string) => cs.split("-")[1] ?? "A";
const classNum = (short: string) => (short === "Prep" ? 0 : Number(short));
const shortOfNum = (n: number) => (n <= 0 ? "Prep" : String(n));
export const classLabel = (short: string) => (short === "Prep" ? "Prep" : `Class ${short}`);
const nextClassOf = (short: string): string | null => (short === "10" ? null : shortOfNum(classNum(short) + 1));
export const sessionOfDate = (d: IsoDate) => {
  const [y, m] = d.split("-").map(Number) as [number, number];
  return m >= 4 ? y : y - 1;
};
const inSession = (d: IsoDate, session: number) => d >= `${session}-04-01` && d <= `${session + 1}-03-31`;
function addDays(d: IsoDate, n: number): IsoDate {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
const hashNum = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 100_003, 7);
const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const live = (s: StudentRecord) => !s.mergedInto;

/** "14th March Two Thousand Thirteen" — date of birth in words, as certificates print it. */
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const below100 = (n: number) => (n < 20 ? (ONES[n] ?? "") : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`);
export function dateInWords(d: IsoDate): string {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  const year = y >= 2000 ? `Two Thousand${y % 100 ? ` ${below100(y % 100)}` : ""}` : `${below100(Math.floor(y / 100))} ${below100(y % 100)}`;
  return `${day}${suffix} ${MONTHS[m - 1]} ${year}`;
}

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

interface SectionMove {
  id: string;
  campus: CampusCode;
  className: string;
  date: IsoDate;
  grNo: string;
  name: string;
  from: string;
  to: string;
  reason: string;
  by: string;
}

interface RecordsState {
  /** Students admitted (or found admitted in the applicant fixtures) during the demo. */
  added: StudentRecord[];
  /** Field changes to any student, applied over the fixtures. */
  patches: Record<string, Partial<StudentRecord>>;
  /** Class history rewritten by section moves and transfers. */
  histories: Record<string, ClassHistoryRow[]>;
  next: Record<string, NextSessionPlacement>;
  guardians: Record<string, StudentFamilyGuardian[]>;
  familyEvents: Record<string, StudentFamilyEvent[]>;
  movements: StudentMovement[];
  batches: StudentPromotionBatch[];
  sectionMoves: SectionMove[];
  documents: StudentDocIssued[];
  docSeq: Record<string, number>;
  grSeq: Record<string, number>;
  /** Idempotency-Key → stored response. */
  idem: Record<string, unknown>;
}

const DOC_CODE: Record<StudentDocType, string> = {
  ID_CARD: "ID",
  ADMISSION_SLIP: "AS",
  LEAVING_CERT: "SLC",
  CHARACTER_CERT: "CC",
  DOB_CERT: "BC",
  APPRECIATION_LETTER: "AL",
  ROLL_NO_SLIP: "RNS",
  RESULT_CARD: "RC",
  BOARD_CERTIFICATE: "BDC",
};
const serialOf = (campus: CampusCode, type: StudentDocType, session: number, n: number) => `${campus}-${DOC_CODE[type]}-${sessionCode(session)}-${String(n).padStart(4, "0")}`;

/** Students the applicant fixtures say were admitted but the student fixtures don't have yet. */
function admittedFromApplicants(): StudentRecord[] {
  return initialApplicants()
    .filter((a) => a.stage === "ADMITTED" && a.grNo && !findStudent(a.grNo))
    .map((a) => applicantToStudent(a, a.grNo!, a.admittedClassSection ?? `${a.classApplied.replace("Class ", "")}-A`, a.admittedOn ?? a.offeredOn ?? a.appliedOn, 1 + (hashNum(a.grNo!) % 30), "Mrs Sadia Rehman"));
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
  const lookup = (grNo: string) => findStudent(grNo) ?? added.find((s) => s.grNo === grNo);
  const docSeq: Record<string, number> = {};
  const documents: StudentDocIssued[] = [];
  for (const d of DOCUMENT_SEEDS) {
    const s = lookup(d.grNo);
    if (!s) continue;
    const key = `${s.campus}:${d.type}:${d.session}`;
    docSeq[key] = Math.max(docSeq[key] ?? 0, d.serial);
    documents.push({
      id: d.id,
      serialNo: serialOf(s.campus, d.type, d.session, d.serial),
      type: d.type,
      campus: s.campus,
      grNo: s.grNo,
      studentName: s.name,
      classSection: s.classSection,
      issuedOn: d.issuedOn,
      issuedBy: d.issuedBy,
      details: d.details,
      snapshot: snapshotOf(s, { balance: s.balance, session: d.session, pure: true }),
      prints: d.prints,
      status: d.status ?? "ISSUED",
      ...(d.cancelledReason ? { cancelledReason: d.cancelledReason } : {}),
    });
  }
  const grSeq: Record<string, number> = {};
  for (const s of [...STUDENTS, ...added]) {
    const [prefix, num] = s.grNo.split("-");
    if (prefix && num && prefix === s.grNo.slice(0, 2)) grSeq[prefix] = Math.max(grSeq[prefix] ?? 0, Number(num));
  }
  const batches: StudentPromotionBatch[] = PROMOTION_HISTORY_2025.map((b, i) => ({
    id: `pb-2526-${i}`,
    campus: "KC",
    fromSession: 2025,
    toSession: 2026,
    fromClassSection: b.from,
    promoted: b.promoted,
    detained: b.detained,
    left: b.left,
    passedOut: b.passedOut,
    sectionChanges: b.sectionChanges,
    by: b.by,
    at: b.at,
    summary: b.passedOut ? `${b.passedOut} passed out after Class 10` : `${b.promoted} promoted to ${classLabel(b.to)}${b.detained ? ` · ${b.detained} repeat${b.detained === 1 ? "s" : ""} the class` : ""}${b.left ? ` · ${b.left} left` : ""}`,
  }));
  return { added, patches: {}, histories: {}, next: {}, guardians: {}, familyEvents: {}, movements: INITIAL_MOVEMENTS, batches, sectionMoves: [], documents, docSeq, grSeq, idem: {} };
}

export const recordsStore = createStore<RecordsState>("student-records", initialRecords);

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

export function addEvent(grNo: string, kind: EnrolmentEvent["kind"], title: string, description?: string, by?: string, date: IsoDate = DEMO_TODAY) {
  const s = STUDENTS.find((x) => x.grNo === grNo);
  if (!s) return;
  const e: EnrolmentEvent = { id: uid("e"), date, kind, title, ...(description ? { description } : {}), ...(by ? { by } : {}) };
  patchStudent(grNo, { enrolment: [...s.enrolment, e] });
}

function addStudent(rec: StudentRecord) {
  STUDENTS.push(rec);
  recordsStore.set((st) => ({ ...st, added: [...st.added, structuredClone(rec)] }));
}

const userName = () => currentUser()?.name ?? "Office";

/* ================================================================ class history */

function deriveHistory(s: StudentRecord): ClassHistoryRow[] {
  const cur = classNum(classShortOf(s.classSection));
  const sec = sectionOf(s.classSection);
  const last = s.status === "PASSED_OUT" && s.leftOn ? sessionOfDate(s.leftOn) : CUR;
  const start = Math.max(sessionOfDate(s.admissionDate), last - cur);
  const rows: ClassHistoryRow[] = [];
  for (let ses = start; ses <= last; ses++) {
    const n = cur - (last - ses);
    const from = ses === start && s.admissionDate > `${ses}-04-01` ? s.admissionDate : `${ses}-04-01`;
    rows.push({
      session: ses,
      campus: s.campus,
      campusName: s.campusName,
      classSection: `${shortOfNum(n)}-${sec}`,
      from,
      ...(ses < last ? { to: `${ses + 1}-03-31`, outcome: "Promoted" } : {}),
      reason: ses === start ? "Admitted" : "Promoted",
      ...(ses === last ? { rollNo: s.rollNo } : {}),
    });
  }
  return rows;
}

function baseHistory(s: StudentRecord): ClassHistoryRow[] {
  return recordsStore.get().histories[s.grNo] ?? CLASS_HISTORY[s.grNo] ?? deriveHistory(s);
}

/** Closes the open row and opens a new one (section move, transfer). */
function moveHistory(s: StudentRecord, date: IsoDate, next: Omit<ClassHistoryRow, "session" | "from">, closingOutcome?: string) {
  const rows = baseHistory(s).map((r) => (!r.to ? { ...r, to: addDays(date, -1), ...(closingOutcome ? { outcome: closingOutcome } : {}) } : r));
  rows.push({ session: sessionOfDate(date), from: date, ...next });
  recordsStore.set((st) => ({ ...st, histories: { ...st.histories, [s.grNo]: rows } }));
}

const OUTCOME_REASON: Record<StudentPromotionOutcome, string> = { PROMOTE: "Promoted", DETAIN: "Repeats the class", LEFT: "Leaving", PASS_OUT: "Passes out" };

export function classHistoryOf(s: StudentRecord): ClassHistoryRow[] {
  const st = recordsStore.get();
  let rows = baseHistory(s).map((r) => (!r.to && r.session === CUR ? { ...r, rollNo: s.rollNo, campus: r.campus, campusName: campusName(r.campus) } : r));
  if (s.status !== "ACTIVE") {
    const note = statusNoteOf(s);
    const end = note?.on ?? s.leftOn;
    rows = rows.map((r) => (!r.to ? { ...r, ...(end ? { to: end } : {}), outcome: ENROLMENT_STATUS_LABEL[s.status] } : r));
  }
  const nx = st.next[s.grNo];
  if (nx) {
    const last = rows[rows.length - 1];
    if (last && !last.to) rows[rows.length - 1] = { ...last, outcome: OUTCOME_REASON[nx.outcome] };
    if (nx.outcome === "PROMOTE" || nx.outcome === "DETAIN") {
      rows.push({ session: nx.session, campus: s.campus, campusName: s.campusName, classSection: nx.classSection, from: `${nx.session}-04-01`, reason: `${OUTCOME_REASON[nx.outcome]} (decided ${formatDate(nx.decidedOn)})`, ...(nx.stream ? { stream: nx.stream } : {}) });
    }
  }
  return rows;
}

/**
 * Group (stream) of a student in a class with groups, by G.R. number and class. Without a stored group the
 * student is spread over the groups Setup has subjects for, so nobody lands in an empty group.
 * Also used for the generated classmates on the report registers (no record of their own).
 */
export function streamFor(grNo: string, classSection: string, stored?: string): string | undefined {
  return groupOfStudent(grNo, classShortOf(classSection), stored);
}

/** A student's group changed: open exams' rosters follow (Exams mock), so the group is the same everywhere. */
function groupChanged(grNo: string, group: string) {
  followGroupChange(grNo, group);
}

export function streamOf(s: StudentRecord): string | undefined {
  return streamFor(s.grNo, s.classSection, s.stream);
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

export const nextSessionOf = (grNo: string) => recordsStore.get().next[grNo];
export const documentsIssuedCount = (grNo: string) => recordsStore.get().documents.filter((d) => d.grNo === grNo).length;

/* ================================================================ families */

export const familyKeyOf = (s: Pick<StudentRecord, "fatherCnic" | "guardian">) => s.fatherCnic || `M${s.guardian.mobile}`;

function familyIds(): Map<string, string> {
  const ids = new Map<string, string>();
  for (const s of STUDENTS) {
    const k = familyKeyOf(s);
    if (!ids.has(k)) ids.set(k, `FAM-${1001 + ids.size}`);
  }
  return ids;
}

export const familyIdOf = (s: StudentRecord) => familyIds().get(familyKeyOf(s));

function familyKeyById(id: string): string | undefined {
  for (const [k, v] of familyIds()) if (v === id) return k;
  return undefined;
}

const membersOf = (key: string) => STUDENTS.filter((s) => live(s) && familyKeyOf(s) === key);

function guardiansOf(key: string): StudentFamilyGuardian[] {
  const stored = recordsStore.get().guardians[key];
  if (stored) return stored;
  const kids = membersOf(key);
  const first = kids[0];
  if (!first) return [];
  const fatherGuardian = kids.map((k) => k.guardian).find((g) => g.relation === "Father") ?? first.guardian;
  const list: StudentFamilyGuardian[] = [
    {
      id: "g-father",
      name: first.father,
      ...(FATHER_NAME_UR[first.fatherCnic] ?? fatherGuardian.nameUr ? { nameUr: FATHER_NAME_UR[first.fatherCnic] ?? fatherGuardian.nameUr } : {}),
      relation: "Father",
      cnic: first.fatherCnic,
      mobile: fatherGuardian.mobile,
      ...(fatherGuardian.occupation ? { occupation: fatherGuardian.occupation } : {}),
      isPrimaryContact: true,
      isFeePayer: true,
      isEmergencyContact: false,
    },
  ];
  (EXTRA_GUARDIANS[first.fatherCnic] ?? []).forEach((g, i) => list.push({ ...g, id: `g-${i + 1}` }));
  const mother = kids.find((k) => k.mother)?.mother;
  if (mother && !list.some((g) => g.name === mother)) list.push({ id: "g-mother", name: mother, relation: "Mother", cnic: "", mobile: "", isPrimaryContact: false, isFeePayer: false, isEmergencyContact: false });
  return list;
}

function familyEvent(key: string, text: string, date: IsoDate = DEMO_TODAY) {
  recordsStore.set((st) => ({ ...st, familyEvents: { ...st.familyEvents, [key]: [{ id: uid("fe"), date, text, by: userName() }, ...(st.familyEvents[key] ?? [])] } }));
}

const worst = (xs: StudentSummary[]): StudentSummary["feeStatus"] => (xs.some((x) => x.feeStatus === "overdue") ? "overdue" : xs.some((x) => x.feeStatus === "unpaid") ? "unpaid" : "paid");

function familyRow(id: string, key: string, kids: StudentRecord[]): StudentFamilyRow {
  const sums = kids.map(toSummary);
  const first = kids[0]!;
  const fatherG = guardiansOf(key).find((g) => g.relation === "Father");
  const campuses = [...new Set(kids.map((k) => k.campus))];
  return {
    id,
    fatherName: first.father,
    fatherCnic: first.fatherCnic,
    mobile: fatherG?.mobile ?? first.guardian.mobile,
    address: first.guardian.address,
    children: kids.length,
    enrolledChildren: kids.filter((k) => k.status === "ACTIVE").length,
    campuses,
    campusNames: campuses.map((c) => campusName(c)),
    balance: sums.reduce((a, x) => a + x.balance, 0),
    feeStatus: worst(sums.filter((x) => x.status === "ACTIVE" || x.balance > 0)),
    childNames: kids.map((k) => k.name.split(" ")[0]).join(", "),
  };
}

function familyDetail(id: string, key: string): StudentFamilyDetail {
  const kids = membersOf(key);
  const first = kids[0]!;
  const st = recordsStore.get();
  const children: StudentFamilyChild[] = kids.map((k) => {
    const rec = Object.values(feesStore.get().receipts)
      .filter((r) => r.grNo === k.grNo && r.status !== "CANCELLED")
      .sort((a, b) => b.postedAt.localeCompare(a.postedAt))[0];
    const sessionFee = k.status === "ACTIVE" ? studentSessionFee(k.grNo, CUR) : { gross: 0, concession: 0, net: 0 };
    return { ...toSummary(k), rollNo: k.rollNo, monthlyFee: tuitionFor(classShortOf(k.classSection)), sessionFee, ...(rec ? { lastPayment: { receiptNo: rec.receiptNo, on: rec.postedAt.slice(0, 10), amount: rec.total } } : {}) };
  });
  const enrolled = children.filter((c) => c.status === "ACTIVE");
  const grNos = new Set(kids.map((k) => k.grNo));
  const payments = Object.values(feesStore.get().receipts)
    .filter((r) => grNos.has(r.grNo) && r.status !== "CANCELLED")
    .sort((a, b) => b.postedAt.localeCompare(a.postedAt))
    .slice(0, 10)
    .map((r) => ({ receiptNo: r.receiptNo, on: r.postedAt.slice(0, 10), amount: r.total, grNo: r.grNo, studentName: r.studentName }));
  const timeline: StudentFamilyEvent[] = [
    ...(st.familyEvents[key] ?? []),
    ...kids.flatMap((k) =>
      k.enrolment
        .filter((e) => e.kind !== "ROLL_NO")
        .map((e) => ({ id: `${k.grNo}-${e.id}`, date: e.date, text: `${k.name.split(" ")[0]}: ${e.title}`, ...(e.by ? { by: e.by } : {}) })),
    ),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const ur = FATHER_NAME_UR[first.fatherCnic];
  return {
    id,
    fatherName: first.father,
    ...(ur ? { fatherNameUr: ur } : {}),
    fatherCnic: first.fatherCnic,
    address: first.guardian.address,
    guardians: guardiansOf(key),
    children,
    fees: {
      monthly: enrolled.reduce((a, c) => a + c.monthlyFee, 0),
      session: enrolled.reduce((a, c) => a + c.sessionFee.net, 0),
      balance: children.reduce((a, c) => a + c.balance, 0),
      overdueChildren: children.filter((c) => c.feeStatus === "overdue").length,
      ...(enrolled.length >= 2 ? { concession: `${enrolled.length} children enrolled: the family qualifies for the sibling concession (applied by the fees office).` } : {}),
      payments,
    },
    timeline,
  };
}

function canSeeFamily(kids: StudentRecord[]): boolean {
  const user = currentUser() ?? undefined;
  return kids.some((k) => can(user, "students.view", k.campus));
}

/* ================================================================ documents */

const DUES_MONTH = /–\s*(\w{3} \d{4})/;

let seedContacts: Map<string, { phone: string; email: string }> | null = null;
/**
 * Campus office phone and email for the letterhead, live from Setup → Campuses (a campus without an email prints
 * none). `pure` snapshots (built while this store is created, possibly before the Setup mock has loaded) read the
 * Setup fixtures instead.
 */
function campusContactOf(campus: CampusCode, pure?: boolean): { phone?: string; email?: string } {
  let c: { phone: string; email: string } | undefined;
  if (!pure) {
    try {
      c = setupCampusContact(campus);
    } catch {
      /* Setup mock not loaded yet: fixtures below */
    }
  }
  if (!c) {
    if (!seedContacts) seedContacts = new Map(initialCampuses().map((x) => [x.code, { phone: x.phone ?? "", email: x.email ?? "" }]));
    c = seedContacts.get(campus);
  }
  return { ...(c?.phone ? { phone: c.phone } : {}), ...(c?.email ? { email: c.email } : {}) };
}

/** A movement with its campus letterhead (address, phone and email from Setup), for the printed notice. */
function withLetterhead(m: StudentMovement): StudentMovement {
  const c = campusContactOf(m.campus);
  return { ...m, letterhead: { address: campusOf(m.campus).address, ...(c.phone ? { phone: c.phone } : {}), ...(c.email ? { email: c.email } : {}) } };
}

/** `pure` builds the snapshot without reading the store (used while the store itself is being created). */
export function snapshotOf(s: StudentRecord, opts: { balance?: number; session?: number; pure?: boolean } = {}): StudentDocSnapshot {
  const balance = opts.balance ?? financeOf(s.grNo).balance;
  const c = campusOf(s.campus);
  const short = classShortOf(s.classSection);
  let dues = "";
  if (balance > 0) dues = `Not cleared: ${formatRs(balance)} outstanding`;
  else {
    const settled = (opts.balance !== undefined ? [] : chargesOf(s.grNo)).filter((x) => x.status === "SETTLED").sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const last = settled[settled.length - 1];
    const month = last ? DUES_MONTH.exec(last.head)?.[1] : undefined;
    dues = month ? `${month} (no dues outstanding)` : "No dues outstanding";
  }
  const stream = streamOf(s);
  const contact = campusContactOf(s.campus, opts.pure);
  const readmitted = s.enrolment.some((e) => e.kind === "RESTORED") || s.enrolment.filter((e) => e.kind === "ADMITTED").length > 1;
  return {
    grNo: s.grNo,
    name: s.name,
    ...(s.nameUr ? { nameUr: s.nameUr } : {}),
    relation: s.relation,
    father: s.father,
    gender: s.gender,
    dob: s.dob,
    dobInWords: dateInWords(s.dob),
    campus: s.campus,
    campusName: c.name,
    campusAddress: c.address,
    ...(contact.phone ? { campusPhone: contact.phone } : {}),
    ...(contact.email ? { campusEmail: contact.email } : {}),
    classSection: s.classSection,
    className: classLabel(short),
    ...(readmitted ? { readmitted } : {}),
    session: opts.session ?? s.session,
    admissionDate: s.admissionDate,
    admittedInClass: s.admittedInClass ?? classLabel(classShortOf((opts.pure ? (CLASS_HISTORY[s.grNo] ?? deriveHistory(s)) : baseHistory(s))[0]?.classSection ?? s.classSection)),
    rollNo: s.rollNo,
    ...(stream ? { stream } : {}),
    ...(s.bloodGroup ? { bloodGroup: s.bloodGroup } : {}),
    guardianMobile: s.guardian.mobile,
    address: s.guardian.address,
    ...(s.leftOn ? { leftOn: s.leftOn } : {}),
    duesClearedUpTo: dues,
    balance,
  };
}

/** The full record for the printed admission form: parents, guardian, emergency contact, siblings at MTB. */
export function recordSheetOf(s: StudentRecord): StudentRecordSheet {
  const siblings = s.fatherCnic
    ? STUDENTS.filter((x) => live(x) && x.grNo !== s.grNo && x.fatherCnic === s.fatherCnic && x.status === "ACTIVE").map((x) => ({ grNo: x.grNo, name: x.name, relation: (x.gender === "F" ? "Sister" : "Brother") as "Sister" | "Brother", classSection: x.classSection, campusName: x.campusName }))
    : [];
  const g = s.guardian;
  return {
    fatherCnic: s.fatherCnic,
    ...(s.mother ? { mother: s.mother } : {}),
    ...(s.bForm ? { bForm: s.bForm } : {}),
    ...(s.previousSchool ? { previousSchool: s.previousSchool } : {}),
    ...(s.house ? { house: s.house } : {}),
    ...(s.religion ? { religion: s.religion } : {}),
    ...(s.disability ? { disability: s.disability } : {}),
    ...(s.identificationMark ? { identificationMark: s.identificationMark } : {}),
    ...(s.birthCertificateNo ? { birthCertificateNo: s.birthCertificateNo } : {}),
    ...(s.email ? { email: s.email } : {}),
    ...(s.homePhone ? { homePhone: s.homePhone } : {}),
    ...(s.city ? { city: s.city } : {}),
    ...(s.tempAddress ? { tempAddress: s.tempAddress } : {}),
    ...(s.fatherQualification ? { fatherQualification: s.fatherQualification } : {}),
    ...(s.fatherOccupation ? { fatherOccupation: s.fatherOccupation } : g.relation === "Father" && g.occupation ? { fatherOccupation: g.occupation } : {}),
    ...(s.motherQualification ? { motherQualification: s.motherQualification } : {}),
    ...(s.motherOccupation ? { motherOccupation: s.motherOccupation } : {}),
    ...(s.emergencyContact ? { emergencyContact: s.emergencyContact } : {}),
    ...(s.hostel !== undefined ? { hostel: s.hostel } : {}),
    ...(s.admissionReference ? { admissionReference: s.admissionReference } : {}),
    guardian: { name: g.name, relation: g.relation, cnic: g.cnic, mobile: g.mobile, ...(g.occupation ? { occupation: g.occupation } : {}) },
    siblings,
  };
}

/** School days so far this session and days present (attendance module's figures for the demo). */
function attendanceFor(s: StudentRecord): { present: number; total: number } {
  if (s.grNo === "KC-14823") return { present: 113, total: 117 };
  const total = 117;
  return { present: total - (hashNum(s.grNo) % 7), total };
}

const marksText = (o: number, t: number) => `${Number.isInteger(o) ? formatCount(o) : o} / ${formatCount(t)}`;

/** What the character certificate's board exam lines start with (all stay editable). */
function boardPrefillOf(s: StudentRecord): StudentDocsPreview["boardPrefill"] {
  const quals = [...(s.qualifications ?? [])].sort((a, b) => a.year - b.year);
  const q = quals[quals.length - 1];
  // The latest board result in Exams with this student on it (declared results carry the marks).
  const board = examsStore
    .get()
    .filter((e) => e.category === "BOARD" && e.campus === s.campus && e.roster.some((p) => p.id === s.grNo))
    .sort((a, b) => a.session - b.session || a.startDate.localeCompare(b.startDate));
  const e = board[board.length - 1];
  const row = e ? examRows(e).find((r) => r.id === s.grNo) : undefined;
  const examYear = e ? Number((e.declaredOn ?? e.startDate).slice(0, 4)) : 0;
  if (q && (!row || q.year >= examYear)) return { boardExam: `${q.exam}, ${q.board}`, boardRollNo: q.rollNo, boardMarks: marksText(q.obtained, q.total), from: "record" };
  if (e && row) {
    const marks = e.status === "DECLARED" && row.percent !== null && !row.withheld ? marksText(row.obtained, row.max) : undefined;
    const roll = row.boardRollNo ?? s.boardRollNo?.partII ?? s.boardRollNo?.partI;
    return { boardExam: e.name, ...(roll ? { boardRollNo: roll } : {}), ...(marks ? { boardMarks: marks } : {}), from: "exams" };
  }
  const roll = s.boardRollNo?.partII ?? s.boardRollNo?.partI;
  return roll ? { boardRollNo: roll, from: "roll-no" } : undefined;
}

function docChecks(s: StudentRecord): Pick<StudentDocsPreview, "blocks" | "warnings"> {
  const docs = recordsStore.get().documents.filter((d) => d.grNo === s.grNo && d.status === "ISSUED");
  const blocks: StudentDocsPreview["blocks"] = {};
  const warnings: StudentDocsPreview["warnings"] = {};
  const balance = financeOf(s.grNo).balance;
  if (s.status !== "ACTIVE") blocks.ID_CARD = `Only enrolled students get an ID card. ${s.name} is ${ENROLMENT_STATUS_LABEL[s.status].toLowerCase()}.`;
  const card = docs.find((d) => d.type === "ID_CARD" && inSession(d.issuedOn, CUR));
  if (card) warnings.ID_CARD = `Card ${card.serialNo} was issued on ${formatDate(card.issuedOn)}. A new card cancels it; use this for a lost or damaged card.`;
  const slc = docs.find((d) => d.type === "LEAVING_CERT");
  if (slc) blocks.LEAVING_CERT = `Already issued as ${slc.serialNo} on ${formatDate(slc.issuedOn)}. Use Reprint in the issue register for another copy.`;
  else {
    const notes: string[] = [];
    if (s.status === "ACTIVE") notes.push(`Issuing the certificate also records ${s.name} as left on the leaving date.`);
    if (balance > 0) notes.push(`${formatRs(balance)} is outstanding. The certificate will say the dues are not cleared unless the principal allows it.`);
    if (notes.length) warnings.LEAVING_CERT = notes.join(" ");
  }
  if (s.status === "EXPELLED") blocks.CHARACTER_CERT = "Character certificates are not issued after an expulsion. The principal can issue a letter instead.";
  if (s.status !== "ACTIVE") warnings.APPRECIATION_LETTER = `${s.name} is no longer enrolled; the letter will name the session they attended.`;
  // Board documents: Class 9 and 10 only, and each one (each part of the slip) is handed over once.
  const handed = (type: StudentDocType, part?: "I" | "II") => docs.find((d) => d.type === type && (type !== "ROLL_NO_SLIP" || (d.details.part ?? "I") === part));
  const said = (d: StudentDocIssued) => `handed over on ${formatDate(d.issuedOn)}${d.details.receivedBy ? ` to ${d.details.receivedBy}` : ""} (${d.serialNo})`;
  if (!/^(9|10)-/.test(s.classSection)) {
    for (const t of ["ROLL_NO_SLIP", "RESULT_CARD", "BOARD_CERTIFICATE"] as const) blocks[t] = "Board documents are for Class 9 and 10 students.";
  } else {
    const p1 = handed("ROLL_NO_SLIP", "I");
    const p2 = handed("ROLL_NO_SLIP", "II");
    if (p1 && p2) blocks.ROLL_NO_SLIP = `Both slips are already handed over: Part-I ${said(p1)}, Part-II ${said(p2)}.`;
    else if (p1 || p2) warnings.ROLL_NO_SLIP = `The Part-${p1 ? "I" : "II"} slip was ${said((p1 ?? p2)!)}. Record the other part.`;
    for (const t of ["RESULT_CARD", "BOARD_CERTIFICATE"] as const) {
      const d = handed(t);
      if (d) blocks[t] = `The ${STUDENT_DOC_LABEL[t].toLowerCase()} was ${said(d)}. Cancel that entry first if it was recorded by mistake.`;
    }
  }
  return { blocks, warnings };
}

/** Why a hand-over can't be recorded for this student (a second hand-over of the same document and part). */
function handoverBlock(s: StudentRecord, type: StudentDocType, part?: "I" | "II"): string | undefined {
  if (!isHandoverDoc(type)) return undefined;
  if (!/^(9|10)-/.test(s.classSection)) return "Board documents are for Class 9 and 10 students.";
  const d = recordsStore.get().documents.find((x) => x.grNo === s.grNo && x.status === "ISSUED" && x.type === type && (type !== "ROLL_NO_SLIP" || (x.details.part ?? "I") === part));
  return d ? `${STUDENT_DOC_LABEL[type]}${type === "ROLL_NO_SLIP" ? ` Part-${part}` : ""} was already handed over on ${formatDate(d.issuedOn)} (${d.serialNo}).` : undefined;
}

function issueDoc(s: StudentRecord, type: StudentDocType, details: StudentDocDetails, session: number, by: string): StudentDocIssued {
  const st = recordsStore.get();
  const key = `${s.campus}:${type}:${session}`;
  const n = (st.docSeq[key] ?? 0) + 1;
  const snap = snapshotOf(s, { session });
  if (type === "LEAVING_CERT" && details.duesOverride && snap.balance > 0) snap.duesClearedUpTo = `Not cleared: ${formatRs(snap.balance)} outstanding (issued with the principal's permission)`;
  // Board documents are handed over, not printed: the hand-over date is the issue date and nothing is printed.
  const handover = isHandoverDoc(type);
  const doc: StudentDocIssued = {
    id: uid("doc"),
    serialNo: serialOf(s.campus, type, session, n),
    type,
    campus: s.campus,
    grNo: s.grNo,
    studentName: s.name,
    classSection: s.classSection,
    issuedOn: (handover ? details.handedOverOn : details.dated) ?? DEMO_TODAY,
    issuedBy: (handover && details.handedOverBy?.trim()) || by,
    details: type === "ID_CARD" ? { validUntil: `${session + 1}-03-31`, ...details } : details,
    snapshot: snap,
    prints: handover ? [] : [{ at: demoNow(), by }],
    status: "ISSUED",
  };
  const documents = st.documents.map((d) =>
    type === "ID_CARD" && d.grNo === s.grNo && d.type === "ID_CARD" && d.status === "ISSUED" ? { ...d, status: "CANCELLED" as const, cancelledReason: `Replaced by ${doc.serialNo}` } : d,
  );
  recordsStore.set({ ...st, docSeq: { ...st.docSeq, [key]: n }, documents: [doc, ...documents] });
  return doc;
}

/* ================================================================ status changes and transfers */

export function recordMovement(s: StudentRecord, change: StudentMovementChange, by: string): StudentMovement {
  const balance = financeOf(s.grNo).balance;
  const m: StudentMovement = {
    id: uid("mv"),
    kind: change.kind,
    grNo: s.grNo,
    name: s.name,
    relation: s.relation,
    father: s.father,
    classSection: s.classSection,
    campus: s.campus,
    campusName: s.campusName,
    date: change.date,
    reason: change.reason,
    ...(change.remarks ? { remarks: change.remarks } : {}),
    by,
    ...(change.approvedBy ? { approvedBy: change.approvedBy } : {}),
    balanceAtTime: balance,
    ...(change.kind === "TRANSFER" && change.toCampus ? { toCampus: change.toCampus, toCampusName: campusName(change.toCampus), toClassSection: change.toClassSection ?? s.classSection } : {}),
  };
  const desc = [change.reason, change.remarks, change.approvedBy ? `approved by ${change.approvedBy}` : ""].filter(Boolean).join(" · ");
  const key = familyKeyOf(s);
  switch (change.kind) {
    case "LEFT":
      patchStudent(s.grNo, { status: "LEFT", leftOn: change.date });
      addEvent(s.grNo, "LEFT", "Left the school", desc, by, change.date);
      familyEvent(key, `${s.name} left the school (${change.reason})`, change.date);
      break;
    case "STRUCK_OFF":
      patchStudent(s.grNo, { status: "STRUCK_OFF" });
      addEvent(s.grNo, "STRUCK_OFF", "Struck off", desc, by, change.date);
      familyEvent(key, `${s.name} struck off (${change.reason})`, change.date);
      break;
    case "EXPELLED":
      patchStudent(s.grNo, { status: "EXPELLED" });
      addEvent(s.grNo, "EXPELLED", "Expelled", desc, by, change.date);
      familyEvent(key, `${s.name} expelled`, change.date);
      break;
    case "RESTORED":
      patchStudent(s.grNo, { status: "ACTIVE" });
      addEvent(s.grNo, "RESTORED", "Restored to class", desc, by, change.date);
      familyEvent(key, `${s.name} restored to ${s.classSection}`, change.date);
      break;
    case "TRANSFER": {
      const to = change.toCampus!;
      const toCs = change.toClassSection ?? s.classSection;
      const from = s.campusName;
      const rollNo = 1 + Math.max(0, ...STUDENTS.filter((x) => x.campus === to && x.classSection === toCs && x.status === "ACTIVE").map((x) => x.rollNo));
      moveHistory(s, change.date, { campus: to, campusName: campusName(to), classSection: toCs, reason: `Transferred in from ${from}`, rollNo }, "Transferred out");
      addEvent(s.grNo, "TRANSFER_OUT", `Transferred out of ${from}`, desc, by, change.date);
      patchStudent(s.grNo, { campus: to, campusName: campusName(to), classSection: toCs, rollNo });
      addEvent(s.grNo, "TRANSFER_IN", `Transferred in · ${campusName(to)} ${toCs}`, "History and G.R. number kept", by, change.date);
      familyEvent(key, `${s.name} moved from ${from} to ${campusName(to)}`, change.date);
      break;
    }
  }
  recordsStore.set((st) => ({ ...st, movements: [...st.movements, m] }));
  return m;
}

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
  familyEvent(familyKeyOf(student), `${a.name} admitted to ${classSection} (${grNo})`, admissionDate);
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

/* ================================================================ promotion */

const RESULT_GRADE = (p: number) => (p >= 80 ? "A+" : p >= 70 ? "A" : p >= 60 ? "B" : p >= 50 ? "C" : p >= 40 ? "D" : "F");

function promotionCandidates(campus: CampusCode, cs: string): StudentPromotionCandidate[] {
  const next = nextClassOf(classShortOf(cs));
  return STUDENTS.filter((s) => live(s) && s.campus === campus && s.classSection === cs && s.status === "ACTIVE")
    .sort((a, b) => a.rollNo - b.rollNo || a.name.localeCompare(b.name))
    .map((s) => {
      const h = hashNum(s.grNo);
      const percent = s.grNo === "KC-14823" ? 85.3 : Math.round((35 + (h % 60) + (h % 10) / 10) * 10) / 10;
      const att = s.grNo === "KC-14823" ? 96.6 : 72 + (h % 28);
      const sum = toSummary(s);
      let suggestion: StudentPromotionOutcome = next ? "PROMOTE" : "PASS_OUT";
      let note: string | undefined;
      if (percent < 40) {
        suggestion = "DETAIN";
        note = `Below 40% in First Term 2026–27 (${percent}%)`;
      } else if (att < 75) note = `Attendance ${att}% this session`;
      const stream = streamOf(s);
      const landing = suggestion === "PROMOTE" && next ? next : classShortOf(cs);
      const suggestedStream = groupOfStudent(s.grNo, landing, s.stream);
      return {
        grNo: s.grNo,
        name: s.name,
        relation: s.relation,
        father: s.father,
        gender: s.gender,
        rollNo: s.rollNo,
        feeStatus: sum.feeStatus,
        balance: sum.balance,
        attendancePercent: att,
        latestResult: { exam: "First Term 2026–27", percent, grade: RESULT_GRADE(percent) },
        suggestion,
        ...(note ? { note } : {}),
        ...(stream ? { stream } : {}),
        ...(suggestedStream ? { suggestedStream } : {}),
      };
    });
}

function placedNext(campus: CampusCode, cs: string): number {
  const st = recordsStore.get();
  return Object.entries(st.next).filter(([grNo, n]) => n.classSection === cs && STUDENTS.find((s) => s.grNo === grNo)?.campus === campus).length;
}

function promotionRows(campus: CampusCode, session: number): StudentPromotionClassRow[] {
  const st = recordsStore.get();
  if (session !== CUR) {
    return st.batches
      .filter((b) => b.campus === campus && b.fromSession === session)
      .map((b) => ({
        classSection: b.fromClassSection,
        className: classShortOf(b.fromClassSection),
        section: sectionOf(b.fromClassSection),
        students: b.promoted + b.detained + b.left + b.passedOut,
        nextClass: nextClassOf(classShortOf(b.fromClassSection)),
        status: "DONE" as const,
        batchId: b.id,
        doneOn: b.at.slice(0, 10),
        doneBy: b.by,
      }));
  }
  return ALL_SECTIONS.map((cs) => {
    const count = STUDENTS.filter((s) => live(s) && s.campus === campus && s.classSection === cs && s.status === "ACTIVE").length;
    const batch = st.batches.find((b) => b.campus === campus && b.fromSession === session && b.fromClassSection === cs);
    return { cs, count, batch };
  })
    .filter((r) => r.count > 0 || r.batch)
    .map(({ cs, count, batch }) => ({
      classSection: cs,
      className: classShortOf(cs),
      section: sectionOf(cs),
      students: batch ? batch.promoted + batch.detained + batch.left + batch.passedOut : count,
      nextClass: nextClassOf(classShortOf(cs)),
      status: batch ? ("DONE" as const) : ("NOT_STARTED" as const),
      ...(batch ? { batchId: batch.id, doneOn: batch.at.slice(0, 10), doneBy: batch.by } : {}),
    }));
}

/* ================================================================ handlers */

const idemHit = (key: string | null) => (key ? recordsStore.get().idem[key] : undefined);
const remember = (key: string | null, value: unknown) => {
  if (key) recordsStore.set((st) => ({ ...st, idem: { ...st.idem, [key]: value } }));
};

const RELATIONS = new Set(["Father", "Mother", "Grandfather", "Grandmother", "Uncle", "Aunt", "Brother", "Other"]);

export const studentRecordsHandlers: HttpHandler[] = [
  /* ---------------- families ---------------- */
  http.get("/api/families", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requirePermission("students.view", ctx.campus);
    if (user instanceof Response) return user;
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const digits = normalizeCnic(q);
    const ids = familyIds();
    const groups = new Map<string, StudentRecord[]>();
    for (const s of STUDENTS.filter(live)) {
      const k = familyKeyOf(s);
      groups.set(k, [...(groups.get(k) ?? []), s]);
    }
    const all = [...groups.entries()]
      .filter(([, kids]) => ctx.campus === "ALL" || kids.some((k) => k.campus === ctx.campus))
      .map(([k, kids]) => familyRow(ids.get(k)!, k, kids));
    const items = all
      .filter((f) => {
        if (!q) return true;
        if (digits.length >= 4 && /^[\d\s-]+$/.test(q)) return f.fatherCnic.includes(digits) || f.mobile.includes(digits);
        return f.fatherName.toLowerCase().includes(q) || f.childNames.toLowerCase().includes(q) || f.id.toLowerCase() === q || groups.get(familyKeyById(f.id) ?? "")?.some((k) => k.name.toLowerCase().includes(q) || k.grNo.toLowerCase().includes(q));
      })
      .sort((a, b) => b.children - a.children || a.fatherName.localeCompare(b.fatherName));
    return HttpResponse.json({
      items,
      total: items.length,
      stats: {
        families: all.length,
        multiChild: all.filter((f) => f.children > 1).length,
        crossCampus: all.filter((f) => f.campuses.length > 1).length,
        withDues: all.filter((f) => f.balance > 0).length,
        balance: all.reduce((a, f) => a + f.balance, 0),
      },
    });
  }),

  http.get("/api/families/:id", async ({ params }) => {
    await latency();
    const id = String(params.id).toUpperCase();
    const key = familyKeyById(id);
    if (!key) return fail(404, "NOT_FOUND", `No family with the number ${id}.`);
    const kids = membersOf(key);
    if (!kids.length) return fail(404, "NOT_FOUND", `No family with the number ${id}.`);
    if (!canSeeFamily(kids)) return fail(403, "FORBIDDEN", "This family's children are at a campus your role doesn't cover.");
    return HttpResponse.json(familyDetail(id, key));
  }),

  http.post("/api/families/:id/guardians", async ({ params, request }) => {
    await latency();
    const id = String(params.id).toUpperCase();
    const key = familyKeyById(id);
    if (!key) return fail(404, "NOT_FOUND", `No family with the number ${id}.`);
    const kids = membersOf(key);
    const user = requirePermission("students.edit", kids[0]!.campus);
    if (user instanceof Response) return user;
    const idem = request.headers.get("Idempotency-Key");
    const hit = idemHit(idem);
    if (hit) return HttpResponse.json(familyDetail(id, key));
    const g = (await request.json()) as StudentFamilyGuardianInput;
    if (!g.name?.trim()) return fail(422, "VALIDATION", "Enter the guardian's name.", { field: "name" });
    if (!RELATIONS.has(g.relation)) return fail(422, "VALIDATION", "Choose how the guardian is related to the children.", { field: "relation" });
    if (g.mobile && !normalizeMobile(g.mobile)) return fail(422, "VALIDATION", "Enter a Pakistani mobile number, e.g. 0300-1234567.", { field: "mobile" });
    if ((g.isPrimaryContact || g.isFeePayer) && !g.mobile) return fail(422, "VALIDATION", "The primary contact and fee payer need a mobile number for SMS.", { field: "mobile" });
    const cnic = normalizeCnic(g.cnic ?? "");
    if (cnic && !isValidCnic(cnic)) return fail(422, "VALIDATION", "A CNIC has 13 digits.", { field: "cnic" });
    let list = guardiansOf(key);
    const existing = g.id ? list.find((x) => x.id === g.id) : undefined;
    if (existing?.relation === "Father" && g.relation !== "Father") return fail(422, "VALIDATION", "The father's record stays as Father. Add another guardian instead.", { field: "relation" });
    const saved: StudentFamilyGuardian = { ...g, id: existing?.id ?? uid("g"), name: g.name.trim(), cnic, mobile: g.mobile ? (normalizeMobile(g.mobile) ?? g.mobile) : "" };
    list = existing ? list.map((x) => (x.id === existing.id ? saved : x)) : [...list, saved];
    if (saved.isPrimaryContact) list = list.map((x) => (x.id === saved.id ? x : { ...x, isPrimaryContact: false }));
    if (saved.isFeePayer) list = list.map((x) => (x.id === saved.id ? x : { ...x, isFeePayer: false }));
    if (!list.some((x) => x.isPrimaryContact)) return fail(422, "VALIDATION", "One guardian must stay the primary contact.", { field: "isPrimaryContact" });
    recordsStore.set((st) => ({ ...st, guardians: { ...st.guardians, [key]: list } }));
    // Every child's record follows the family: the primary contact is the guardian the school calls and texts.
    const primary = list.find((x) => x.isPrimaryContact)!;
    for (const k of kids) {
      patchStudent(k.grNo, {
        guardian: { ...k.guardian, name: primary.name, relation: primary.relation, cnic: primary.cnic, mobile: primary.mobile, ...(primary.occupation ? { occupation: primary.occupation } : {}), ...(primary.nameUr ? { nameUr: primary.nameUr } : {}) },
      });
    }
    familyEvent(key, existing ? `Guardian updated: ${saved.name} (${saved.relation})` : `Guardian added: ${saved.name} (${saved.relation})`);
    remember(idem, true);
    return HttpResponse.json(familyDetail(id, key), { status: existing ? 200 : 201 });
  }),

  http.delete("/api/families/:id/guardians/:gid", async ({ params }) => {
    await latency();
    const id = String(params.id).toUpperCase();
    const key = familyKeyById(id);
    if (!key) return fail(404, "NOT_FOUND", `No family with the number ${id}.`);
    const kids = membersOf(key);
    const user = requirePermission("students.edit", kids[0]!.campus);
    if (user instanceof Response) return user;
    const list = guardiansOf(key);
    const g = list.find((x) => x.id === String(params.gid));
    if (!g) return HttpResponse.json(familyDetail(id, key));
    if (g.relation === "Father" || g.isPrimaryContact || g.isFeePayer) return fail(422, "GUARDIAN_IN_USE", `${g.name} is the father, primary contact or fee payer. Choose someone else for that role first.`);
    recordsStore.set((st) => ({ ...st, guardians: { ...st.guardians, [key]: list.filter((x) => x.id !== g.id) } }));
    familyEvent(key, `Guardian removed: ${g.name} (${g.relation})`);
    return HttpResponse.json(familyDetail(id, key));
  }),

  /* ---------------- promotion ---------------- */
  http.get("/api/promotion", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("students.view", ctx.campus);
    if (user instanceof Response) return user;
    if (ctx.campus === "ALL") return fail(400, "CAMPUS_REQUIRED", "Promotion is run campus by campus. Choose a campus.");
    const classes = promotionRows(ctx.campus, ctx.session);
    const batches = recordsStore
      .get()
      .batches.filter((b) => b.campus === ctx.campus && b.fromSession === ctx.session)
      .sort((a, b) => b.at.localeCompare(a.at));
    const totals = batches.reduce(
      (a, b) => ({ ...a, promoted: a.promoted + b.promoted, detained: a.detained + b.detained, left: a.left + b.left, passedOut: a.passedOut + b.passedOut }),
      { students: classes.reduce((a, c) => a + c.students, 0), promoted: 0, detained: 0, left: 0, passedOut: 0, classesDone: classes.filter((c) => c.status === "DONE").length },
    );
    return HttpResponse.json({ fromSession: ctx.session, toSession: ctx.session + 1, classes, batches, totals });
  }),

  http.get("/api/promotion/:cs", async ({ params, request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("students.view", ctx.campus);
    if (user instanceof Response) return user;
    if (ctx.campus === "ALL") return fail(400, "CAMPUS_REQUIRED", "Promotion is run campus by campus. Choose a campus.");
    const cs = String(params.cs);
    const next = nextClassOf(classShortOf(cs));
    const cls = next ? CLASSES.find((c) => c.short === next) : undefined;
    const done = recordsStore.get().batches.find((b) => b.campus === ctx.campus && b.fromSession === ctx.session && b.fromClassSection === cs);
    return HttpResponse.json({
      fromSession: ctx.session,
      toSession: ctx.session + 1,
      classSection: cs,
      nextClass: next,
      destination: (cls?.sections ?? []).map((sec) => ({ section: sec, seats: seatsFor(next!), placed: placedNext(ctx.campus as CampusCode, `${next}-${sec}`) })),
      nextGroups: next ? groupsOfClass(next) : [],
      groups: groupsOfClass(classShortOf(cs)),
      candidates: ctx.session === CUR && !done ? promotionCandidates(ctx.campus, cs) : [],
      ...(done ? { done } : {}),
    });
  }),

  http.post("/api/promotion/:cs", async ({ params, request }) => {
    await latency();
    const key = request.headers.get("Idempotency-Key");
    const hit = idemHit(key);
    if (hit) return HttpResponse.json(hit);
    const body = (await request.json()) as { campus: CampusCode | "ALL"; session: number; items: StudentPromotionItem[] };
    if (body.campus === "ALL") return fail(400, "CAMPUS_REQUIRED", "Promotion is run campus by campus. Choose a campus.");
    const user = requirePermission("students.edit", body.campus);
    if (user instanceof Response) return user;
    if (body.session !== CUR) return fail(409, "SESSION_READ_ONLY", `${formatSession(body.session)} is closed. Switch to ${formatSession(CUR)} to promote.`);
    const cs = String(params.cs);
    const st = recordsStore.get();
    if (st.batches.some((b) => b.campus === body.campus && b.fromSession === CUR && b.fromClassSection === cs)) return fail(409, "ALREADY_PROMOTED", `${cs} has already been promoted. Reload the page.`);
    const candidates = promotionCandidates(body.campus, cs);
    const items = body.items ?? [];
    const missing = candidates.filter((c) => !items.some((i) => i.grNo === c.grNo));
    if (missing.length) return fail(422, "OUTCOME_MISSING", `Choose an outcome for every student. Missing: ${missing.map((m) => m.name).join(", ")}.`);
    const curShort = classShortOf(cs);
    const next = nextClassOf(curShort);
    const curSec = sectionOf(cs);
    // Where everyone lands, then one seat check for the whole class: nothing is saved if any section is over.
    const landing = items.map((i) => ({
      ...i,
      to: i.outcome === "PROMOTE" ? (next ? `${next}-${i.toSection ?? curSec}` : null) : i.outcome === "DETAIN" ? `${curShort}-${i.toSection ?? curSec}` : null,
    }));
    if (landing.some((l) => l.outcome === "PROMOTE" && !l.to)) return fail(422, "NO_NEXT_CLASS", "Class 10 is the last class: choose Passes out instead of Promote.");
    // Group in the class each student lands in: the one chosen, else their own or the school's rule.
    for (const l of landing) {
      if (!l.to || !l.stream) continue;
      const offered = groupsOfClass(classShortOf(l.to));
      const who = candidates.find((c) => c.grNo === l.grNo)?.name ?? l.grNo;
      if (!offered.length) return fail(422, "VALIDATION", `${classLabel(classShortOf(l.to))} has no groups. Clear ${who}'s group.`, { field: "stream" });
      if (!offered.includes(l.stream)) return fail(422, "VALIDATION", `Choose one of ${classLabel(classShortOf(l.to))}'s groups for ${who}: ${offered.join(", ")}.`, { field: "stream" });
    }
    const perSection = new Map<string, number>();
    for (const l of landing) if (l.to) perSection.set(l.to, (perSection.get(l.to) ?? 0) + 1);
    for (const [to, n] of perSection) {
      const seats = seatsFor(classShortOf(to));
      const taken = placedNext(body.campus, to);
      if (taken + n > seats) return fail(422, "SEATS_FULL", `${to} would have ${taken + n} students for ${seats} seats next session. Move ${taken + n - seats} to another section, then promote again.`);
    }
    const by = user.name;
    const nextMap = { ...st.next };
    for (const l of landing) {
      const s = STUDENTS.find((x) => x.grNo === l.grNo)!;
      const stream = l.to ? groupOfStudent(s.grNo, classShortOf(l.to), l.stream ?? s.stream) : undefined;
      nextMap[l.grNo] = { session: CUR + 1, classSection: l.to ?? "", outcome: l.outcome, decidedOn: DEMO_TODAY, decidedBy: by, ...(stream ? { stream } : {}) };
      const desc = `Decided on ${formatDate(DEMO_TODAY)} · takes effect on 01-Apr-${CUR + 1}${stream ? ` · ${stream} group` : ""}`;
      if (l.outcome === "PROMOTE") addEvent(s.grNo, "PROMOTED", `Promoted to Class ${l.to} for ${formatSession(CUR + 1)}`, desc, by);
      else if (l.outcome === "DETAIN") addEvent(s.grNo, "DETAINED", `Repeats ${classLabel(curShort)} in ${formatSession(CUR + 1)} (${l.to})`, desc, by);
      else if (l.outcome === "PASS_OUT") addEvent(s.grNo, "PASSED_OUT", `Passes out at the end of ${formatSession(CUR)}`, desc, by);
      else addEvent(s.grNo, "LEFT", `Leaving at the end of ${formatSession(CUR)}`, desc, by);
    }
    const count = (o: StudentPromotionOutcome) => landing.filter((l) => l.outcome === o).length;
    const sectionChanges = landing.filter((l) => l.to && sectionOf(l.to) !== curSec).length;
    const promotedBySection = [...perSection.entries()].filter(([to]) => classShortOf(to) === next).map(([to, n]) => `${n} to ${to}`);
    const parts = [
      count("PROMOTE") ? `${count("PROMOTE")} promoted (${promotedBySection.join(", ")})` : "",
      count("DETAIN") ? `${count("DETAIN")} repeat${count("DETAIN") === 1 ? "s" : ""} ${classLabel(curShort)}` : "",
      count("PASS_OUT") ? `${count("PASS_OUT")} pass out` : "",
      count("LEFT") ? `${count("LEFT")} leaving` : "",
    ].filter(Boolean);
    const byGroup = new Map<string, number>();
    for (const l of landing) {
      const g = nextMap[l.grNo]?.stream;
      if (g && l.outcome === "PROMOTE") byGroup.set(g, (byGroup.get(g) ?? 0) + 1);
    }
    if (byGroup.size) parts.push(`groups: ${[...byGroup].map(([g, n]) => `${g} ${n}`).join(", ")}`);
    const batch: StudentPromotionBatch = {
      id: uid("pb"),
      campus: body.campus,
      fromSession: CUR,
      toSession: CUR + 1,
      fromClassSection: cs,
      promoted: count("PROMOTE"),
      detained: count("DETAIN"),
      left: count("LEFT"),
      passedOut: count("PASS_OUT"),
      sectionChanges,
      by,
      at: demoNow(),
      summary: parts.join(" · "),
    };
    recordsStore.set((s) => ({ ...s, next: nextMap, batches: [...s.batches, batch] }));
    remember(key, batch);
    return HttpResponse.json(batch, { status: 201 });
  }),

  /* ---------------- sections and roll numbers ---------------- */
  http.get("/api/sections", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requirePermission("students.view", ctx.campus);
    if (user instanceof Response) return user;
    if (ctx.campus === "ALL") return fail(400, "CAMPUS_REQUIRED", "Sections belong to one campus. Choose a campus.");
    const short = url.searchParams.get("className") || "7";
    const cls = CLASSES.find((c) => c.short === short);
    if (!cls) return fail(404, "NOT_FOUND", "No such class.");
    const campus = ctx.campus;
    const sections = cls.sections.map((sec) => {
      const cs = `${short}-${sec}`;
      const kids = STUDENTS.filter((s) => live(s) && s.campus === campus && s.classSection === cs && s.status === "ACTIVE").sort((a, b) => a.rollNo - b.rollNo || a.name.localeCompare(b.name));
      const rolls = kids.map((k) => k.rollNo);
      const dupes = rolls.filter((r, i) => r > 0 && rolls.indexOf(r) !== i).length;
      return {
        section: sec,
        classSection: cs,
        seats: seatsFor(short),
        classTeacher: classTeacher(campus, cs, Math.max(0, ALL_SECTIONS.indexOf(cs))),
        students: kids.map((k) => {
          const stream = streamOf(k);
          return { grNo: k.grNo, name: k.name, gender: k.gender, rollNo: k.rollNo, father: k.father, admissionDate: k.admissionDate, feeStatus: toSummary(k).feeStatus, ...(stream ? { stream } : {}) };
        }),
        rollIssues: dupes + rolls.filter((r) => !r).length,
      };
    });
    const board: SectionAllotmentBoard = {
      className: short,
      label: classLabel(short),
      streams: groupsOfClass(short),
      sections,
      recentMoves: recordsStore
        .get()
        .sectionMoves.filter((m) => m.campus === campus && m.className === short)
        .slice(0, 8)
        .map(({ id, date, grNo, name, from, to, reason, by }) => ({ id, date, grNo, name, from, to, reason, by })),
    };
    return HttpResponse.json(board);
  }),

  http.post("/api/sections/move", async ({ request }) => {
    await latency();
    const key = request.headers.get("Idempotency-Key");
    const hit = idemHit(key);
    if (hit) return HttpResponse.json(hit);
    const body = (await request.json()) as { campus: CampusCode | "ALL"; session: number; grNos: string[]; toSection: string; effectiveDate: IsoDate; reason: string; stream?: string };
    if (body.campus === "ALL") return fail(400, "CAMPUS_REQUIRED", "Sections belong to one campus. Choose a campus.");
    const user = requirePermission("students.edit", body.campus);
    if (user instanceof Response) return user;
    if (body.session !== CUR) return fail(409, "SESSION_READ_ONLY", `${formatSession(body.session)} is closed. Switch to ${formatSession(CUR)} to move students.`);
    if (!body.grNos?.length) return fail(422, "VALIDATION", "Select at least one student to move.");
    if (!body.reason?.trim()) return fail(422, "VALIDATION", "Give a reason for the move. It is kept in each student's history.", { field: "reason" });
    if (!body.effectiveDate || body.effectiveDate > addDays(DEMO_TODAY, 30) || body.effectiveDate < `${CUR}-04-01`) return fail(422, "VALIDATION", "Choose a date in this session, no more than 30 days ahead.", { field: "effectiveDate" });
    const kids = body.grNos.map((g) => STUDENTS.find((s) => s.grNo === g && s.campus === body.campus && s.status === "ACTIVE"));
    if (kids.some((k) => !k)) return fail(409, "STALE", "Some of these students are no longer in this class. Reload the page.");
    const short = classShortOf(kids[0]!.classSection);
    if (kids.some((k) => classShortOf(k!.classSection) !== short)) return fail(422, "VALIDATION", "Move students of one class at a time.");
    const toCs = `${short}-${body.toSection}`;
    if (!CLASSES.find((c) => c.short === short)?.sections.includes(body.toSection)) return fail(422, "VALIDATION", "Choose a section of this class.", { field: "toSection" });
    if (body.stream && !groupsOfClass(short).includes(body.stream)) return fail(422, "VALIDATION", `Choose a group offered in ${classLabel(short)}.`, { field: "stream" });
    const movers = kids.filter((k) => k!.classSection !== toCs) as StudentRecord[];
    const stats = sectionStats(body.campus, short).find((x) => x.classSection === toCs)!;
    if (stats.enrolled + movers.length > stats.seats) return fail(422, "SEATS_FULL", `${toCs} has ${stats.seats - stats.enrolled} free seats; you selected ${movers.length}. Move fewer students or raise the seats in Setup.`);
    let roll = stats.nextRollNo;
    const moves: SectionMove[] = [];
    for (const s of movers) {
      const from = s.classSection;
      const desc = `${body.reason.trim()} · effective ${formatDate(body.effectiveDate)}`;
      moveHistory(s, body.effectiveDate, { campus: s.campus, campusName: s.campusName, classSection: toCs, reason: `Section change: ${body.reason.trim()}`, rollNo: roll });
      patchStudent(s.grNo, { classSection: toCs, rollNo: roll, ...(body.stream ? { stream: body.stream } : {}) });
      if (body.stream) groupChanged(s.grNo, body.stream);
      addEvent(s.grNo, "SECTION_CHANGE", `Section changed ${from} → ${toCs}`, desc, user.name, body.effectiveDate);
      moves.push({ id: uid("sm"), campus: body.campus, className: short, date: body.effectiveDate, grNo: s.grNo, name: s.name, from, to: toCs, reason: body.reason.trim(), by: user.name });
      roll += 1;
    }
    recordsStore.set((st) => ({ ...st, sectionMoves: [...moves, ...st.sectionMoves] }));
    const result = { moved: movers.length, toClassSection: toCs };
    remember(key, result);
    return HttpResponse.json(result, { status: 201 });
  }),

  http.post("/api/sections/roll-numbers", async ({ request }) => {
    await latency();
    const key = request.headers.get("Idempotency-Key");
    const hit = idemHit(key);
    if (hit) return HttpResponse.json(hit);
    const body = (await request.json()) as { campus: CampusCode | "ALL"; session: number; classSection: string; order: SectionAllotmentRollOrder };
    if (body.campus === "ALL") return fail(400, "CAMPUS_REQUIRED", "Sections belong to one campus. Choose a campus.");
    const user = requirePermission("students.edit", body.campus);
    if (user instanceof Response) return user;
    if (body.session !== CUR) return fail(409, "SESSION_READ_ONLY", `${formatSession(body.session)} is closed.`);
    const kids = STUDENTS.filter((s) => live(s) && s.campus === body.campus && s.classSection === body.classSection && s.status === "ACTIVE");
    const sorted = [...kids].sort((a, b) => {
      if (body.order === "GR") return Number(a.grNo.replace(/\D/g, "")) - Number(b.grNo.replace(/\D/g, ""));
      if (body.order === "ADMISSION") return a.admissionDate.localeCompare(b.admissionDate) || a.name.localeCompare(b.name);
      if (body.order === "GIRLS_FIRST") return (a.gender === b.gender ? 0 : a.gender === "F" ? -1 : 1) || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });
    sorted.forEach((s, i) => {
      if (s.rollNo !== i + 1) patchStudent(s.grNo, { rollNo: i + 1 });
    });
    recordsStore.set((st) => ({
      ...st,
      sectionMoves: [{ id: uid("sm"), campus: body.campus as CampusCode, className: classShortOf(body.classSection), date: DEMO_TODAY, grNo: "", name: `Roll numbers 1–${sorted.length}`, from: body.classSection, to: body.classSection, reason: `Roll numbers given ${body.order === "NAME" ? "alphabetically" : body.order === "GR" ? "by G.R. number" : body.order === "ADMISSION" ? "by admission date" : "girls first"}`, by: user.name }, ...st.sectionMoves],
    }));
    const result = { assigned: sorted.length, classSection: body.classSection };
    remember(key, result);
    return HttpResponse.json(result, { status: 201 });
  }),

  /* ---------------- leaving, struck off, expelled, transfers ---------------- */
  http.get("/api/movements", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requirePermission("students.view", ctx.campus);
    if (user instanceof Response) return user;
    const kind = url.searchParams.get("kind") ?? "";
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";
    const className = url.searchParams.get("className") ?? "";
    if (from && to && from > to) return fail(422, "VALIDATION", "The first date must be on or before the second.", { field: "from" });
    const scoped = recordsStore
      .get()
      .movements.filter((m) => (ctx.campus === "ALL" || m.campus === ctx.campus || m.toCampus === ctx.campus) && inSession(m.date, ctx.session))
      .filter((m) => (!from || m.date >= from) && (!to || m.date <= to) && (!className || classShortOf(m.classSection) === className))
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    const counts = Object.fromEntries(Object.keys(STUDENT_MOVEMENT_LABEL).map((k) => [k, scoped.filter((m) => m.kind === k).length]));
    return HttpResponse.json({
      items: (kind ? scoped.filter((m) => m.kind === kind) : scoped).map(withLetterhead),
      counts,
      struckOffNow: STUDENTS.filter((s) => live(s) && s.status === "STRUCK_OFF" && (ctx.campus === "ALL" || s.campus === ctx.campus)).length,
    });
  }),

  http.post("/api/students/:grNo/status", async ({ params, request }) => {
    await latency();
    const key = request.headers.get("Idempotency-Key");
    const hit = idemHit(key);
    if (hit) return HttpResponse.json(hit);
    const s = findStudent(String(params.grNo));
    if (!s || !live(s)) return fail(404, "NOT_FOUND", "No student with this G.R. number.");
    const user = requirePermission("students.edit", s.campus);
    if (user instanceof Response) return user;
    const change = (await request.json()) as StudentMovementChange;
    if (!studentMovementsAllowed(s.status).includes(change.kind)) {
      return fail(409, "NOT_ALLOWED", `${s.name} is ${ENROLMENT_STATUS_LABEL[s.status].toLowerCase()}, so ${STUDENT_MOVEMENT_LABEL[change.kind].toLowerCase()} can't be recorded. Reload the page.`);
    }
    if (!change.reason?.trim()) return fail(422, "VALIDATION", "Choose a reason. It is printed on notices and kept in the history.", { field: "reason" });
    if (!change.date || change.date > DEMO_TODAY) return fail(422, "VALIDATION", "The date can't be in the future.", { field: "date" });
    if (change.date < s.admissionDate) return fail(422, "VALIDATION", `The date can't be before admission (${formatDate(s.admissionDate)}).`, { field: "date" });
    if (change.kind === "EXPELLED" && !change.approvedBy?.trim()) return fail(422, "VALIDATION", "An expulsion needs the principal's approval. Enter who approved it.", { field: "approvedBy" });
    const notice = change.kind === "EXPELLED" && change.sendNoticeSms;
    if (notice && !can(user, "sms.send", s.campus)) return fail(403, "FORBIDDEN", "Your role can't send messages. Turn off the notice SMS, or ask the office to send it from Messages.", { field: "sendNoticeSms" });
    if (change.kind === "TRANSFER") {
      if (!change.toCampus || change.toCampus === s.campus) return fail(422, "VALIDATION", "Choose the campus the student is moving to.", { field: "toCampus" });
      const toCs = change.toClassSection ?? s.classSection;
      if (classShortOf(toCs) !== classShortOf(s.classSection)) return fail(422, "VALIDATION", "A transfer keeps the same class. Change the class later through promotion.", { field: "toClassSection" });
      const stats = sectionStats(change.toCampus, classShortOf(toCs)).find((x) => x.classSection === toCs);
      if (stats && stats.enrolled >= stats.seats) return fail(422, "SEATS_FULL", `${campusName(change.toCampus)} ${toCs} is full (${stats.seats} seats). Choose another section.`, { field: "toClassSection" });
    }
    const { sendNoticeSms: _notice, ...rest } = change;
    let m = recordMovement(s, { ...rest, reason: change.reason.trim() }, user.name);
    if (notice) {
      // The "Expulsion notice" template goes through Messages, so it shows in the Outbox and the delivery report.
      const msg = preparedFor("tpl-expelled", s);
      const sent = msg ? queueSms([msg], { campus: s.campus, templateId: "tpl-expelled", title: "Expulsion notice", source: "Students", createdBy: user.name, audienceLabel: `Guardian of ${s.name} (${s.grNo})` }) : null;
      if (sent) {
        m = { ...m, noticeSms: { batchId: sent.batchId, held: sent.held } };
        recordsStore.set((st) => ({ ...st, movements: st.movements.map((x) => (x.id === m.id ? m : x)) }));
        addEvent(s.grNo, "NOTE", "Expulsion notice SMS", `${sent.held ? "Queued (held while SMS is paused)" : "Sent"} to ${s.guardian.name}, ${formatMobile(s.guardian.mobile)}`, user.name);
      }
    }
    m = withLetterhead(m);
    remember(key, m);
    return HttpResponse.json(m, { status: 201 });
  }),

  /* ---------------- documents ---------------- */
  http.get("/api/documents", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requirePermission("students.view", ctx.campus);
    if (user instanceof Response) return user;
    const type = url.searchParams.get("type") ?? "";
    const scoped = recordsStore
      .get()
      .documents.filter((d) => (ctx.campus === "ALL" || d.campus === ctx.campus) && inSession(d.issuedOn, ctx.session))
      .sort((a, b) => b.issuedOn.localeCompare(a.issuedOn) || b.serialNo.localeCompare(a.serialNo));
    const counts = Object.fromEntries(Object.keys(STUDENT_DOC_LABEL).map((k) => [k, scoped.filter((d) => d.type === k).length]));
    return HttpResponse.json({ items: type ? scoped.filter((d) => d.type === type) : scoped, counts, reprints: scoped.reduce((a, d) => a + Math.max(0, d.prints.length - 1), 0) });
  }),

  http.get("/api/documents/roster", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requirePermission("students.view", ctx.campus);
    if (user instanceof Response) return user;
    if (ctx.campus === "ALL") return fail(400, "CAMPUS_REQUIRED", "ID cards are printed campus by campus. Choose a campus.");
    const cs = url.searchParams.get("classSection") ?? "";
    const full = url.searchParams.get("full") === "1";
    const kids = STUDENTS.filter((s) => live(s) && s.campus === ctx.campus && s.classSection === cs && s.status === "ACTIVE").sort((a, b) => a.rollNo - b.rollNo);
    return HttpResponse.json(kids.map((k) => (full ? { ...snapshotOf(k), record: recordSheetOf(k) } : snapshotOf(k))));
  }),

  // Days present this session per student of a section, to prefill appreciation letters for a class.
  http.get("/api/documents/attendance", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requirePermission("students.view", ctx.campus);
    if (user instanceof Response) return user;
    if (ctx.campus === "ALL") return fail(400, "CAMPUS_REQUIRED", "Letters carry one campus's letterhead. Choose a campus.");
    const cs = url.searchParams.get("classSection") ?? "";
    const kids = STUDENTS.filter((s) => live(s) && s.campus === ctx.campus && s.classSection === cs && s.status === "ACTIVE");
    return HttpResponse.json(kids.map((k) => ({ grNo: k.grNo, ...attendanceFor(k) })));
  }),

  // Students admitted between two dates, for admission slips in bulk (Students › Documents).
  http.get("/api/documents/new-admissions", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requirePermission("students.view", ctx.campus);
    if (user instanceof Response) return user;
    if (ctx.campus === "ALL") return fail(400, "CAMPUS_REQUIRED", "Admission slips are printed campus by campus. Choose a campus.");
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return fail(422, "VALIDATION", "Choose both dates.", { field: "from" });
    if (from > to) return fail(422, "VALIDATION", "The first date must be on or before the second.", { field: "from" });
    const cls = url.searchParams.get("className") ?? "";
    const section = url.searchParams.get("section") ?? "";
    const kids = STUDENTS.filter(
      (s) => live(s) && s.campus === ctx.campus && s.status === "ACTIVE" && s.admissionDate >= from && s.admissionDate <= to && (!cls || classShortOf(s.classSection) === cls) && (!section || s.classSection.endsWith(`-${section}`)),
    ).sort((a, b) => a.admissionDate.localeCompare(b.admissionDate) || a.classSection.localeCompare(b.classSection) || a.rollNo - b.rollNo);
    return HttpResponse.json(kids.map((k) => snapshotOf(k)));
  }),

  // The board-document collection sheet: students sign for roll no. slips, result cards and certificates.
  http.get("/api/documents/collection-sheet", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requirePermission("students.view", ctx.campus);
    if (user instanceof Response) return user;
    if (ctx.campus === "ALL") return fail(400, "CAMPUS_REQUIRED", "The sheet carries one campus's heading. Choose a campus.");
    const p = url.searchParams;
    const className = p.get("className") ?? "";
    const section = p.get("section") ?? "";
    const stream = p.get("stream") ?? "";
    const gender = p.get("gender") ?? "";
    if (!CLASSES.some((c) => c.short === className)) return fail(422, "VALIDATION", "Choose the class.", { field: "className" });
    if (stream && !groupsOfClass(className).includes(stream)) return fail(422, "VALIDATION", `${classLabel(className)} has no group called ${stream}.`, { field: "stream" });
    const docs = recordsStore.get().documents.filter((d) => d.status === "ISSUED" && d.campus === ctx.campus && isHandoverDoc(d.type));
    const handedOn = (grNo: string, type: StudentDocType, part?: "I" | "II") => docs.find((d) => d.grNo === grNo && d.type === type && (type !== "ROLL_NO_SLIP" || (d.details.part ?? "I") === part))?.issuedOn;
    const rows: StudentDocsCollectionRow[] = STUDENTS.filter((s) => live(s) && s.campus === ctx.campus && s.status === "ACTIVE" && classShortOf(s.classSection) === className)
      .filter((s) => (!section || sectionOf(s.classSection) === section) && (!gender || s.gender === gender) && (!stream || streamOf(s) === stream))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => {
        const g = streamOf(s);
        const slipI = handedOn(s.grNo, "ROLL_NO_SLIP", "I");
        const slipII = handedOn(s.grNo, "ROLL_NO_SLIP", "II");
        const resultCard = handedOn(s.grNo, "RESULT_CARD");
        const certificate = handedOn(s.grNo, "BOARD_CERTIFICATE");
        return {
          grNo: s.grNo,
          name: s.name,
          classSection: s.classSection,
          ...(g ? { stream: g } : {}),
          ...(s.boardRollNo?.partI ? { rollPartI: s.boardRollNo.partI } : {}),
          ...(s.boardRollNo?.partII ? { rollPartII: s.boardRollNo.partII } : {}),
          handed: { ...(slipI ? { slipI } : {}), ...(slipII ? { slipII } : {}), ...(resultCard ? { resultCard } : {}), ...(certificate ? { certificate } : {}) },
        };
      });
    const c = campusOf(ctx.campus);
    const sheet: StudentDocsCollectionSheet = {
      campus: ctx.campus,
      campusName: c.name,
      campusAddress: c.address,
      session: ctx.session,
      className,
      ...(section ? { section } : {}),
      ...(stream ? { stream } : {}),
      ...(gender === "F" || gender === "M" ? { gender } : {}),
      rows,
    };
    return HttpResponse.json(sheet);
  }),

  http.get("/api/students/:grNo/documents", async ({ params }) => {
    await latency();
    const s = findStudent(String(params.grNo));
    if (!s || !live(s)) return fail(404, "NOT_FOUND", "No student with this G.R. number.");
    const user = requirePermission("students.view", s.campus);
    if (user instanceof Response) return user;
    const issued = recordsStore
      .get()
      .documents.filter((d) => d.grNo === s.grNo)
      .sort((a, b) => b.issuedOn.localeCompare(a.issuedOn));
    const prefill = boardPrefillOf(s);
    const body: StudentDocsPreview = { snapshot: { ...snapshotOf(s), record: recordSheetOf(s) }, issued, attendance: attendanceFor(s), ...docChecks(s), ...(prefill ? { boardPrefill: prefill } : {}) };
    return HttpResponse.json(body);
  }),

  http.post("/api/documents", async ({ request }) => {
    await latency();
    const key = request.headers.get("Idempotency-Key");
    const hit = idemHit(key);
    if (hit) return HttpResponse.json(hit);
    const body = (await request.json()) as { campus: CampusCode | "ALL"; session: number; type: StudentDocType; grNos: string[]; details: StudentDocDetails; detailsByGrNo?: Record<string, StudentDocDetails> };
    if (body.campus === "ALL") return fail(400, "CAMPUS_REQUIRED", "Documents carry one campus's letterhead. Choose a campus.");
    const user = requirePermission("students.edit", body.campus);
    if (user instanceof Response) return user;
    if (body.session !== CUR) return fail(409, "SESSION_READ_ONLY", `${formatSession(body.session)} is closed. Switch to ${formatSession(CUR)} to issue documents.`);
    if (!body.grNos?.length) return fail(422, "VALIDATION", "Choose at least one student.");
    const d = body.details ?? {};
    // Each student's own details (letters for a class: days present each) over the shared ones.
    const own = body.detailsByGrNo ?? {};
    const detailsOf = (grNo: string): StudentDocDetails => ({ ...d, ...(own[grNo] ?? {}) });
    if (body.type === "APPRECIATION_LETTER") {
      for (const grNo of body.grNos) {
        const x = detailsOf(grNo);
        if (!x.attendanceDays || !x.totalDays || x.attendanceDays > x.totalDays) {
          const who = body.grNos.length > 1 ? `${findStudent(grNo)?.name ?? grNo}: ` : "";
          return fail(422, "VALIDATION", `${who}Days present can't be more than the school days in the session.`, { field: "attendanceDays", details: { grNo } });
        }
      }
    }
    if (body.type === "LEAVING_CERT" && !d.leavingReason?.trim()) return fail(422, "VALIDATION", "Enter the reason for leaving. It is printed on the certificate.", { field: "leavingReason" });
    // Dates other than today: the hand-over date of a board document, or the date printed on a letter or certificate.
    const sessionStartsOn = `${CUR}-04-01`;
    if (isHandoverDoc(body.type)) {
      if (!d.receivedBy?.trim()) return fail(422, "VALIDATION", "Enter who received the document. The register keeps it.", { field: "receivedBy" });
      if (body.type === "ROLL_NO_SLIP" && d.part !== "I" && d.part !== "II") return fail(422, "VALIDATION", "Choose Part-I or Part-II.", { field: "part" });
      const on = d.handedOverOn ?? DEMO_TODAY;
      if (on > DEMO_TODAY) return fail(422, "VALIDATION", "The hand-over date can't be in the future.", { field: "handedOverOn" });
      if (on < sessionStartsOn) return fail(422, "VALIDATION", `Choose a date in this session (from ${formatDate(sessionStartsOn)}).`, { field: "handedOverOn" });
      d.receivedBy = d.receivedBy.trim();
      d.handedOverOn = on;
    } else if (d.dated) {
      if (body.type === "ID_CARD" || body.type === "ADMISSION_SLIP") delete d.dated;
      else if (d.dated > DEMO_TODAY) return fail(422, "VALIDATION", "The date can't be in the future.", { field: "dated" });
      else if (d.dated < sessionStartsOn) return fail(422, "VALIDATION", `Choose a date in this session (from ${formatDate(sessionStartsOn)}).`, { field: "dated" });
    }
    const issued: StudentDocIssued[] = [];
    const skipped: Array<{ grNo: string; name: string; reason: string }> = [];
    for (const grNo of body.grNos) {
      const s = findStudent(grNo);
      if (!s || !live(s) || s.campus !== body.campus) {
        skipped.push({ grNo, name: s?.name ?? grNo, reason: "Not a student of this campus." });
        continue;
      }
      const { blocks } = docChecks(s);
      const block = blocks[body.type] ?? handoverBlock(s, body.type, d.part);
      if (block) {
        skipped.push({ grNo, name: s.name, reason: block });
        continue;
      }
      const balance = financeOf(s.grNo).balance;
      if (body.type === "LEAVING_CERT" && balance > 0 && d.duesOverride && !can(user, "approvals.decide", s.campus)) {
        skipped.push({ grNo, name: s.name, reason: "Only the principal can issue a leaving certificate with dues outstanding." });
        continue;
      }
      if (body.type === "LEAVING_CERT" && s.status === "ACTIVE") recordMovement(s, { kind: "LEFT", date: d.dated && d.dated >= s.admissionDate ? d.dated : DEMO_TODAY, reason: d.leavingReason!.trim(), remarks: "School leaving certificate issued" }, user.name);
      issued.push(issueDoc(s, body.type, detailsOf(grNo), CUR, user.name));
    }
    if (!issued.length) return fail(422, "NOTHING_ISSUED", skipped[0]?.reason ?? "Nothing was issued.", { details: { skipped } });
    const result = { issued, skipped };
    remember(key, result);
    return HttpResponse.json(result, { status: 201 });
  }),

  http.post("/api/documents/:id/reprint", async ({ params, request }) => {
    await latency();
    const user = requireUser();
    if (user instanceof Response) return user;
    const key = request.headers.get("Idempotency-Key");
    const hit = idemHit(key);
    if (hit) return HttpResponse.json(hit);
    const st = recordsStore.get();
    const doc = st.documents.find((d) => d.id === String(params.id));
    if (!doc) return fail(404, "NOT_FOUND", "This document is not in the register.");
    if (!can(user, "students.edit", doc.campus)) return fail(403, "FORBIDDEN", "Your role can't print documents at this campus.");
    if (doc.status === "CANCELLED") return fail(409, "CANCELLED", `${doc.serialNo} was cancelled (${doc.cancelledReason ?? "no reason given"}). Issue a new one instead.`);
    if (isHandoverDoc(doc.type)) return fail(409, "NOT_PRINTED", `${STUDENT_DOC_LABEL[doc.type]}s come from the board. The school records the hand-over but does not print them.`);
    if (doc.returnedOn) return fail(409, "RETURNED", `${doc.serialNo} was handed back on ${formatDate(doc.returnedOn)}. Issue a new card instead.`);
    const { reason } = (await request.json()) as { reason: string };
    if (!reason?.trim()) return fail(422, "VALIDATION", "Say why another copy is needed. Every reprint is logged.", { field: "reason" });
    const updated: StudentDocIssued = { ...doc, prints: [...doc.prints, { at: demoNow(), by: user.name, reason: reason.trim() }] };
    recordsStore.set({ ...st, documents: st.documents.map((d) => (d.id === doc.id ? updated : d)) });
    remember(key, updated);
    return HttpResponse.json(updated);
  }),

  http.post("/api/documents/:id/cancel", async ({ params, request }) => {
    await latency();
    const user = requireUser();
    if (user instanceof Response) return user;
    const st = recordsStore.get();
    const doc = st.documents.find((d) => d.id === String(params.id));
    if (!doc) return fail(404, "NOT_FOUND", "This document is not in the register.");
    if (!can(user, "students.edit", doc.campus)) return fail(403, "FORBIDDEN", "Your role can't cancel documents at this campus.");
    const { reason } = (await request.json()) as { reason: string };
    if (!reason?.trim()) return fail(422, "VALIDATION", "Say why the document is cancelled.", { field: "reason" });
    if (doc.status === "CANCELLED") return HttpResponse.json(doc);
    const updated: StudentDocIssued = { ...doc, status: "CANCELLED", cancelledReason: reason.trim() };
    recordsStore.set({ ...st, documents: st.documents.map((d) => (d.id === doc.id ? updated : d)) });
    return HttpResponse.json(updated);
  }),

  // An ID card handed back to the office (the legacy "reimbursement" date), usually when the student leaves.
  http.post("/api/documents/:id/return", async ({ params, request }) => {
    await latency();
    const user = requireUser();
    if (user instanceof Response) return user;
    const key = request.headers.get("Idempotency-Key");
    const hit = idemHit(key);
    if (hit) return HttpResponse.json(hit);
    const st = recordsStore.get();
    const doc = st.documents.find((d) => d.id === String(params.id));
    if (!doc) return fail(404, "NOT_FOUND", "This document is not in the register.");
    if (!can(user, "students.edit", doc.campus)) return fail(403, "FORBIDDEN", "Your role can't change the register at this campus.");
    if (doc.type !== "ID_CARD") return fail(422, "VALIDATION", "Only ID cards are handed back.");
    if (doc.status === "CANCELLED") return fail(409, "CANCELLED", `${doc.serialNo} was cancelled (${doc.cancelledReason ?? "no reason given"}).`);
    if (doc.returnedOn) return fail(409, "ALREADY_RETURNED", `${doc.serialNo} was already marked returned on ${formatDate(doc.returnedOn)}. Reload the page.`);
    const { returnedOn } = (await request.json()) as { returnedOn?: IsoDate };
    if (!returnedOn || !/^\d{4}-\d{2}-\d{2}$/.test(returnedOn)) return fail(422, "VALIDATION", "Choose the date the card was handed back.", { field: "returnedOn" });
    if (returnedOn > DEMO_TODAY) return fail(422, "VALIDATION", "The date can't be in the future.", { field: "returnedOn" });
    if (returnedOn < doc.issuedOn) return fail(422, "VALIDATION", `The card was issued on ${formatDate(doc.issuedOn)}. Choose that day or later.`, { field: "returnedOn" });
    const updated: StudentDocIssued = { ...doc, returnedOn, returnedBy: user.name };
    recordsStore.set({ ...st, documents: st.documents.map((d) => (d.id === doc.id ? updated : d)) });
    addEvent(doc.grNo, "NOTE", "ID card returned", `${doc.serialNo} handed back on ${formatDate(returnedOn)}`, user.name, returnedOn);
    remember(key, updated);
    return HttpResponse.json(updated);
  }),
];

export { HOUSES };
