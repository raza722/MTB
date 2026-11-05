// Families, promotion, sections and roll numbers, leaving and transfers, and issued documents.
// Exports are prefixed (families…, promotion…, sections…, movements…, documents…) so `export *` in index.ts never collides.
import type { IsoDate, IsoDateTime, Rupees } from "@mtb/domain";
import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { ctxKey, ctxQuery, type CampusCode, type Ctx } from "./context";
import type { EnrolmentStatusCode, FeeStatusCode, StudentPersonalExtras, StudentSummary } from "./students";

/* ---------------------------------------------------------------- Families */

export type StudentFamilyGuardianRelation = "Father" | "Mother" | "Grandfather" | "Grandmother" | "Uncle" | "Aunt" | "Brother" | "Other";

export interface StudentFamilyGuardian {
  id: string;
  name: string;
  nameUr?: string;
  relation: StudentFamilyGuardianRelation;
  /** 13 digits, or "" when not given. */
  cnic: string;
  mobile: string;
  occupation?: string;
  /** Receives SMS and calls about every child in the family. */
  isPrimaryContact: boolean;
  /** Name on fee vouchers and receipts. */
  isFeePayer: boolean;
  isEmergencyContact: boolean;
  /** Staff member at MTB (staff-child concession). */
  isStaff?: boolean;
}

export interface StudentFamilyRow {
  id: string;
  fatherName: string;
  fatherCnic: string;
  mobile: string;
  address: string;
  children: number;
  enrolledChildren: number;
  campuses: CampusCode[];
  campusNames: string[];
  balance: Rupees;
  /** Worst fee status among the children. */
  feeStatus: FeeStatusCode;
  /** First names, for the list: "Ayesha, Hamza, Mariam". */
  childNames: string;
}

export interface StudentFamilyList {
  items: StudentFamilyRow[];
  total: number;
  /** Across the whole scope, not just the matching rows. */
  stats: { families: number; multiChild: number; crossCampus: number; withDues: number; balance: Rupees };
}

export interface StudentFamilyChild extends StudentSummary {
  rollNo: number;
  /** Monthly tuition for the child's class. */
  monthlyFee: Rupees;
  /** This session's fee: the class's session total from the fee structure, less approved concessions. */
  sessionFee: { gross: Rupees; concession: Rupees; net: Rupees };
  lastPayment?: { receiptNo: string; on: IsoDate; amount: Rupees };
}

export interface StudentFamilyEvent {
  id: string;
  date: IsoDate;
  text: string;
  by?: string;
}

export interface StudentFamilyDetail {
  id: string;
  fatherName: string;
  fatherNameUr?: string;
  fatherCnic: string;
  address: string;
  guardians: StudentFamilyGuardian[];
  children: StudentFamilyChild[];
  fees: {
    monthly: Rupees;
    /** Session fees of the enrolled children, after concessions. */
    session: Rupees;
    balance: Rupees;
    overdueChildren: number;
    /** Sibling concession in force, in plain words. */
    concession?: string;
    payments: Array<{ receiptNo: string; on: IsoDate; amount: Rupees; grNo: string; studentName: string }>;
  };
  timeline: StudentFamilyEvent[];
}

export type StudentFamilyGuardianInput = Omit<StudentFamilyGuardian, "id"> & { id?: string };

export const studentFamiliesApi = {
  list: (ctx: Ctx, q: string) => apiFetch<StudentFamilyList>("/families", { query: { ...ctxQuery(ctx), q } }),
  get: (id: string) => apiFetch<StudentFamilyDetail>(`/families/${encodeURIComponent(id)}`),
  saveGuardian: (id: string, guardian: StudentFamilyGuardianInput, idempotencyKey: string) =>
    apiFetch<StudentFamilyDetail>(`/families/${encodeURIComponent(id)}/guardians`, { method: "POST", body: guardian, idempotencyKey }),
  removeGuardian: (id: string, guardianId: string, idempotencyKey: string) =>
    apiFetch<StudentFamilyDetail>(`/families/${encodeURIComponent(id)}/guardians/${encodeURIComponent(guardianId)}`, { method: "DELETE", idempotencyKey }),
};

export const studentFamiliesQueries = {
  all: () => ["families"] as const,
  list: (ctx: Ctx, q: string) => queryOptions({ queryKey: ["families", ...ctxKey(ctx), "list", q], queryFn: () => studentFamiliesApi.list(ctx, q) }),
  detail: (id: string) => queryOptions({ queryKey: ["families", "detail", id], queryFn: () => studentFamiliesApi.get(id) }),
};

/* ---------------------------------------------------------------- Promotion */

export type StudentPromotionOutcome = "PROMOTE" | "DETAIN" | "LEFT" | "PASS_OUT";

export const STUDENT_PROMOTION_OUTCOME_LABEL: Record<StudentPromotionOutcome, string> = {
  PROMOTE: "Promote",
  DETAIN: "Repeat class",
  LEFT: "Leaving",
  PASS_OUT: "Passes out",
};

export interface StudentPromotionClassRow {
  classSection: string;
  className: string;
  section: string;
  students: number;
  /** "8" — or null when the class is the last one (students pass out). */
  nextClass: string | null;
  status: "NOT_STARTED" | "DONE";
  batchId?: string;
  doneOn?: IsoDate;
  doneBy?: string;
}

export interface StudentPromotionBatch {
  id: string;
  campus: CampusCode;
  fromSession: number;
  toSession: number;
  fromClassSection: string;
  promoted: number;
  detained: number;
  left: number;
  passedOut: number;
  sectionChanges: number;
  by: string;
  at: IsoDateTime;
  /** "28 promoted to 8-B, 2 to 8-A, 1 repeats 7-B" */
  summary: string;
}

export interface StudentPromotionOverview {
  fromSession: number;
  toSession: number;
  classes: StudentPromotionClassRow[];
  batches: StudentPromotionBatch[];
  totals: { students: number; promoted: number; detained: number; left: number; passedOut: number; classesDone: number };
}

export interface StudentPromotionCandidate {
  grNo: string;
  name: string;
  relation: "s/o" | "d/o";
  father: string;
  gender: "F" | "M";
  rollNo: number;
  feeStatus: FeeStatusCode;
  balance: Rupees;
  attendancePercent: number;
  /** Latest declared result, as advice only; promotion stays a decision. */
  latestResult?: { exam: string; percent: number; grade: string };
  suggestion: StudentPromotionOutcome;
  /** Why the suggestion differs from "Promote". */
  note?: string;
  /** Group now (classes with groups). */
  stream?: string;
  /** Group the student goes into by default when the class they land in has groups: their own, else the school's rule. */
  suggestedStream?: string;
}

export interface StudentPromotionClassDetail {
  fromSession: number;
  toSession: number;
  classSection: string;
  nextClass: string | null;
  /** Sections of the next class, with seats and students already placed there. */
  destination: Array<{ section: string; seats: number; placed: number }>;
  /** Groups of the next class (promote) and of this class (repeat); empty when the class has none. */
  nextGroups: string[];
  groups: string[];
  candidates: StudentPromotionCandidate[];
  done?: StudentPromotionBatch;
}

export interface StudentPromotionItem {
  grNo: string;
  outcome: StudentPromotionOutcome;
  /** Section in next session's class (promote) or this class (repeat). */
  toSection?: string;
  /** Group in the class the student lands in, when it has groups (promotion into Class 9 or 10). */
  stream?: string;
}

export const studentPromotionApi = {
  overview: (ctx: Ctx) => apiFetch<StudentPromotionOverview>("/promotion", { query: ctxQuery(ctx) }),
  classDetail: (ctx: Ctx, classSection: string) => apiFetch<StudentPromotionClassDetail>(`/promotion/${encodeURIComponent(classSection)}`, { query: ctxQuery(ctx) }),
  run: (ctx: Ctx, classSection: string, items: StudentPromotionItem[], idempotencyKey: string) =>
    apiFetch<StudentPromotionBatch>(`/promotion/${encodeURIComponent(classSection)}`, { method: "POST", body: { ...ctxQuery(ctx), items }, idempotencyKey }),
};

export const studentPromotionQueries = {
  all: () => ["promotion"] as const,
  overview: (ctx: Ctx) => queryOptions({ queryKey: ["promotion", ...ctxKey(ctx)], queryFn: () => studentPromotionApi.overview(ctx) }),
  classDetail: (ctx: Ctx, classSection: string) => queryOptions({ queryKey: ["promotion", ...ctxKey(ctx), classSection], queryFn: () => studentPromotionApi.classDetail(ctx, classSection), enabled: Boolean(classSection) }),
};

/* ---------------------------------------------------------------- Sections and roll numbers */

export interface SectionAllotmentStudent {
  grNo: string;
  name: string;
  gender: "F" | "M";
  rollNo: number;
  father: string;
  admissionDate: IsoDate;
  feeStatus: FeeStatusCode;
  stream?: string;
}

export interface SectionAllotmentSection {
  section: string;
  classSection: string;
  seats: number;
  classTeacher?: string;
  students: SectionAllotmentStudent[];
  /** Two students with the same roll number, or roll numbers missing. */
  rollIssues: number;
}

export interface SectionAllotmentBoard {
  className: string;
  /** "Class 7" */
  label: string;
  /** Classes 9 and 10 choose a group. */
  streams: string[];
  sections: SectionAllotmentSection[];
  recentMoves: Array<{ id: string; date: IsoDate; grNo: string; name: string; from: string; to: string; reason: string; by: string }>;
}

export type SectionAllotmentRollOrder = "NAME" | "GR" | "ADMISSION" | "GIRLS_FIRST";

export const SECTION_ALLOTMENT_ROLL_ORDER_LABEL: Record<SectionAllotmentRollOrder, string> = {
  NAME: "Alphabetical by name",
  GR: "By G.R. number",
  ADMISSION: "By admission date",
  GIRLS_FIRST: "Girls first, then boys (each by name)",
};

export const sectionAllotmentApi = {
  board: (ctx: Ctx, className: string) => apiFetch<SectionAllotmentBoard>("/sections", { query: { ...ctxQuery(ctx), className } }),
  move: (ctx: Ctx, body: { grNos: string[]; toSection: string; effectiveDate: IsoDate; reason: string; stream?: string }, idempotencyKey: string) =>
    apiFetch<{ moved: number; toClassSection: string }>("/sections/move", { method: "POST", body: { ...ctxQuery(ctx), ...body }, idempotencyKey }),
  assignRollNumbers: (ctx: Ctx, body: { classSection: string; order: SectionAllotmentRollOrder }, idempotencyKey: string) =>
    apiFetch<{ assigned: number; classSection: string }>("/sections/roll-numbers", { method: "POST", body: { ...ctxQuery(ctx), ...body }, idempotencyKey }),
};

export const sectionAllotmentQueries = {
  all: () => ["sections"] as const,
  board: (ctx: Ctx, className: string) => queryOptions({ queryKey: ["sections", ...ctxKey(ctx), className], queryFn: () => sectionAllotmentApi.board(ctx, className) }),
};

/* ---------------------------------------------------------------- Leaving, struck off, expelled, transfers */

export type StudentMovementKind = "LEFT" | "STRUCK_OFF" | "EXPELLED" | "RESTORED" | "TRANSFER" | "PASSED_OUT";

export const STUDENT_MOVEMENT_LABEL: Record<StudentMovementKind, string> = {
  LEFT: "Left",
  STRUCK_OFF: "Struck off",
  EXPELLED: "Expelled",
  RESTORED: "Restored",
  TRANSFER: "Campus transfer",
  PASSED_OUT: "Passed out",
};

/** Reasons offered for each change, in the school's words. */
export const STUDENT_MOVEMENT_REASONS: Record<Exclude<StudentMovementKind, "PASSED_OUT">, string[]> = {
  LEFT: ["Family moved to another city", "Admission in another school", "School leaving certificate issued", "Failed / de-promoted", "Shifted to Hifz", "Health reasons", "Other"],
  STRUCK_OFF: ["Continuous absence", "Non-payment of dues", "Failed / de-promoted", "Other"],
  EXPELLED: ["Discipline violation", "Unfair means in exams", "Other"],
  RESTORED: ["Dues cleared", "Attendance resumed", "Principal's decision", "Other"],
  TRANSFER: ["Family moved closer to the other campus", "Sibling at the other campus", "Class or group not offered here", "Other"],
};

export interface StudentMovement {
  id: string;
  kind: StudentMovementKind;
  grNo: string;
  name: string;
  relation: "s/o" | "d/o";
  father: string;
  classSection: string;
  campus: CampusCode;
  campusName: string;
  date: IsoDate;
  reason: string;
  remarks?: string;
  by: string;
  approvedBy?: string;
  /** Dues outstanding when the change was recorded. */
  balanceAtTime: Rupees;
  toCampus?: CampusCode;
  toCampusName?: string;
  toClassSection?: string;
  /** Expulsion notice SMS queued in Messages with this change (held while all SMS are paused). */
  noticeSms?: { batchId: string; held: boolean };
  /** The campus letterhead for the printed notice, live from Setup → Campuses (filled when read, not stored). */
  letterhead?: { address: string; phone?: string; email?: string };
}

export interface StudentMovementsList {
  items: StudentMovement[];
  counts: Record<StudentMovementKind, number>;
  /** Struck off now (can be restored). */
  struckOffNow: number;
}

export interface StudentMovementChange {
  kind: Exclude<StudentMovementKind, "PASSED_OUT">;
  date: IsoDate;
  reason: string;
  remarks?: string;
  approvedBy?: string;
  toCampus?: CampusCode;
  toClassSection?: string;
  /** Expelled only: send the "Expulsion notice" SMS to the guardian through Messages (needs sms.send). */
  sendNoticeSms?: boolean;
}

/** Narrows the leaving list: dates (inclusive) and class ("9"). */
export interface StudentMovementsFilter {
  from?: IsoDate;
  to?: IsoDate;
  className?: string;
}

export const studentMovementsApi = {
  list: (ctx: Ctx, kind?: StudentMovementKind | "", filter: StudentMovementsFilter = {}) =>
    apiFetch<StudentMovementsList>("/movements", { query: { ...ctxQuery(ctx), kind, from: filter.from, to: filter.to, className: filter.className } }),
  record: (grNo: string, change: StudentMovementChange, idempotencyKey: string) =>
    apiFetch<StudentMovement>(`/students/${encodeURIComponent(grNo)}/status`, { method: "POST", body: change, idempotencyKey }),
};

export const studentMovementsQueries = {
  all: () => ["movements"] as const,
  list: (ctx: Ctx, kind?: StudentMovementKind | "", filter: StudentMovementsFilter = {}) =>
    queryOptions({ queryKey: ["movements", ...ctxKey(ctx), kind ?? "", filter], queryFn: () => studentMovementsApi.list(ctx, kind, filter) }),
};

/** Statuses a student can be moved to from their current status. */
export function studentMovementsAllowed(status: EnrolmentStatusCode): Array<StudentMovementChange["kind"]> {
  if (status === "ACTIVE") return ["TRANSFER", "LEFT", "STRUCK_OFF", "EXPELLED"];
  if (status === "STRUCK_OFF" || status === "LEFT") return ["RESTORED"];
  return [];
}

/* ---------------------------------------------------------------- Documents (ID cards, slips, certificates, letters) */

/**
 * Documents in the issue register. The first six are printed by the school; ROLL_NO_SLIP, RESULT_CARD and
 * BOARD_CERTIFICATE come from the board and are only handed over (the register logs who collected them and when).
 */
export type StudentDocType = "ID_CARD" | "ADMISSION_SLIP" | "LEAVING_CERT" | "CHARACTER_CERT" | "DOB_CERT" | "APPRECIATION_LETTER" | "ROLL_NO_SLIP" | "RESULT_CARD" | "BOARD_CERTIFICATE";

/** Board documents the school hands over but does not print. */
export type StudentHandoverDocType = "ROLL_NO_SLIP" | "RESULT_CARD" | "BOARD_CERTIFICATE";

/** Documents the school prints. */
export const STUDENT_PRINTED_DOC_TYPES: StudentDocType[] = ["ID_CARD", "ADMISSION_SLIP", "LEAVING_CERT", "CHARACTER_CERT", "DOB_CERT", "APPRECIATION_LETTER"];

export const STUDENT_HANDOVER_DOC_TYPES: StudentHandoverDocType[] = ["ROLL_NO_SLIP", "RESULT_CARD", "BOARD_CERTIFICATE"];

export const STUDENT_DOC_TYPES: StudentDocType[] = [...STUDENT_PRINTED_DOC_TYPES, ...STUDENT_HANDOVER_DOC_TYPES];

export const isHandoverDoc = (t: StudentDocType): t is StudentHandoverDocType => (STUDENT_HANDOVER_DOC_TYPES as StudentDocType[]).includes(t);

export const STUDENT_DOC_LABEL: Record<StudentDocType, string> = {
  ID_CARD: "Student ID card",
  ADMISSION_SLIP: "Admission slip",
  LEAVING_CERT: "School leaving certificate",
  CHARACTER_CERT: "Character certificate",
  DOB_CERT: "Date of birth certificate",
  APPRECIATION_LETTER: "Appreciation letter",
  ROLL_NO_SLIP: "Board roll no. slip",
  RESULT_CARD: "Board result card",
  BOARD_CERTIFICATE: "Board certificate",
};

/** Paper each document prints on. */
export const STUDENT_DOC_PAPER: Record<StudentDocType, string> = {
  ID_CARD: "ID card size (CR80), 10 to an A4 sheet",
  ADMISSION_SLIP: "A5",
  LEAVING_CERT: "A4",
  CHARACTER_CERT: "A4",
  DOB_CERT: "A4",
  APPRECIATION_LETTER: "A4",
  ROLL_NO_SLIP: "Handed over, not printed",
  RESULT_CARD: "Handed over, not printed",
  BOARD_CERTIFICATE: "Handed over, not printed",
};

export interface StudentDocDetails {
  /** Appreciation letter: days present and school days in the session. */
  attendanceDays?: number;
  totalDays?: number;
  /** Leaving / character certificate: conduct in one word, e.g. "Good". */
  character?: string;
  remarks?: string;
  /** Character certificate: board exam details. */
  boardExam?: string;
  boardRollNo?: string;
  boardMarks?: string;
  /** ID card valid until. */
  validUntil?: IsoDate;
  /** Leaving certificate: reason for leaving. */
  leavingReason?: string;
  /** Leaving certificate: issued although dues are outstanding (principal's decision). */
  duesOverride?: boolean;
  /** Who collected the document. */
  receivedBy?: string;
  /** Roll no. slip: Part-I (Class 9 exam) or Part-II (Class 10 exam). */
  part?: "I" | "II";
  /** Board documents: the day they were handed over (today or earlier in the session). Stored as issuedOn. */
  handedOverOn?: IsoDate;
  /** Board documents: the staff member who handed them over (the signed-in user by default). */
  handedOverBy?: string;
  /** Letters and certificates: the date printed on the document, today or earlier in the session. Stored as issuedOn. */
  dated?: IsoDate;
}

/** Everything a document prints, frozen when it is issued so a reprint matches the original. */
export interface StudentDocSnapshot {
  grNo: string;
  name: string;
  nameUr?: string;
  relation: "s/o" | "d/o";
  father: string;
  gender: "F" | "M";
  dob: IsoDate;
  /** "Fourteenth March Two Thousand Thirteen" */
  dobInWords: string;
  campus: CampusCode;
  campusName: string;
  campusAddress: string;
  /** Campus office phone, printed on the letterhead. */
  campusPhone?: string;
  /** Campus office email, printed on the letterhead when the campus has one. */
  campusEmail?: string;
  classSection: string;
  /** "Class 7" */
  className: string;
  /** Admitted again after leaving or being struck off (leaving certificate "Category"). */
  readmitted?: boolean;
  session: number;
  admissionDate: IsoDate;
  admittedInClass: string;
  rollNo: number;
  stream?: string;
  bloodGroup?: string;
  guardianMobile: string;
  address: string;
  leftOn?: IsoDate;
  /** "November 2026 tuition fee" or "Not cleared: Rs 20,000 due". */
  duesClearedUpTo: string;
  balance: Rupees;
  /** The full record, for the printed admission form (only on the class roster with `full` and the student's preview). */
  record?: StudentRecordSheet;
}

/** Everything the printed admission form (full student record) shows beyond the snapshot. */
export interface StudentRecordSheet extends StudentPersonalExtras {
  mother?: string;
  fatherCnic: string;
  bForm?: string;
  previousSchool?: string;
  house?: string;
  guardian: { name: string; relation: string; cnic: string; mobile: string; occupation?: string };
  /** Brothers and sisters at MTB (same father's CNIC). */
  siblings: Array<{ grNo: string; name: string; relation: "Brother" | "Sister"; classSection: string; campusName: string }>;
}

/** New admissions for printing admission slips in bulk. */
export interface StudentDocsNewAdmissionsQuery {
  /** "7"; empty for every class. */
  className?: string;
  section?: string;
  from: IsoDate;
  to: IsoDate;
}

export interface StudentDocIssued {
  id: string;
  /** "KC-SLC-2627-0042" */
  serialNo: string;
  type: StudentDocType;
  campus: CampusCode;
  grNo: string;
  studentName: string;
  classSection: string;
  issuedOn: IsoDate;
  issuedBy: string;
  details: StudentDocDetails;
  snapshot: StudentDocSnapshot;
  prints: Array<{ at: IsoDateTime; by: string; reason?: string }>;
  status: "ISSUED" | "CANCELLED";
  /** Why it was cancelled (e.g. "Card lost, new card issued"). */
  cancelledReason?: string;
  /** ID cards: the day the card was handed back to the office (on leaving), and who took it. */
  returnedOn?: IsoDate;
  returnedBy?: string;
}

export interface StudentDocsRegister {
  items: StudentDocIssued[];
  counts: Record<StudentDocType, number>;
  reprints: number;
}

/** What a student's documents would print today, plus what has been issued before. */
export interface StudentDocsPreview {
  snapshot: StudentDocSnapshot;
  issued: StudentDocIssued[];
  /** Suggested from attendance for the appreciation letter. */
  attendance: { present: number; total: number };
  /** Reasons the document cannot be issued right now, in plain words. */
  blocks: Partial<Record<StudentDocType, string>>;
  /** Shown before issuing, but not blocking. */
  warnings: Partial<Record<StudentDocType, string>>;
  /**
   * Board exam details for the character certificate: from the latest board exam on the student's record, else the
   * latest board result in Exams (roll no. and marks), else the board roll no. on the record.
   */
  boardPrefill?: { boardExam?: string; boardRollNo?: string; boardMarks?: string; from: "record" | "exams" | "roll-no" };
}

export interface StudentDocsIssueInput {
  type: StudentDocType;
  grNos: string[];
  /** Details shared by every student in the batch. */
  details: StudentDocDetails;
  /** Each student's own details, laid over the shared ones (letters for a class: days present each). */
  detailsByGrNo?: Record<string, StudentDocDetails>;
}

/** Days present and school days this session, per student of a class (prefills appreciation letters). */
export interface StudentDocsClassAttendance {
  grNo: string;
  present: number;
  total: number;
}

/** Which students go on a board-document collection sheet. */
export interface StudentDocsCollectionQuery {
  /** "9" (required) */
  className: string;
  section?: string;
  /** Group, e.g. "Science (Biology)". */
  stream?: string;
  gender?: "F" | "M" | "";
}

/** One student on the collection sheet: board roll numbers and any hand-over already recorded (dates). */
export interface StudentDocsCollectionRow {
  grNo: string;
  name: string;
  classSection: string;
  stream?: string;
  rollPartI?: string;
  rollPartII?: string;
  handed: { slipI?: IsoDate; slipII?: IsoDate; resultCard?: IsoDate; certificate?: IsoDate };
}

/** "Roll No. slip / result card / certificate issuance form": students sign as they collect board documents. */
export interface StudentDocsCollectionSheet {
  campus: CampusCode;
  campusName: string;
  campusAddress: string;
  session: number;
  className: string;
  section?: string;
  stream?: string;
  gender?: "F" | "M";
  rows: StudentDocsCollectionRow[];
}

export const studentDocsApi = {
  register: (ctx: Ctx, type?: StudentDocType | "") => apiFetch<StudentDocsRegister>("/documents", { query: { ...ctxQuery(ctx), type } }),
  forStudent: (grNo: string) => apiFetch<StudentDocsPreview>(`/students/${encodeURIComponent(grNo)}/documents`),
  issue: (ctx: Ctx, input: StudentDocsIssueInput, idempotencyKey: string) =>
    apiFetch<{ issued: StudentDocIssued[]; skipped: Array<{ grNo: string; name: string; reason: string }> }>("/documents", { method: "POST", body: { ...ctxQuery(ctx), ...input }, idempotencyKey }),
  reprint: (id: string, reason: string, idempotencyKey: string) => apiFetch<StudentDocIssued>(`/documents/${encodeURIComponent(id)}/reprint`, { method: "POST", body: { reason }, idempotencyKey }),
  cancel: (id: string, reason: string, idempotencyKey: string) => apiFetch<StudentDocIssued>(`/documents/${encodeURIComponent(id)}/cancel`, { method: "POST", body: { reason }, idempotencyKey }),
  /** ID card handed back to the office on that date (not after today, not before it was issued). */
  markReturned: (id: string, returnedOn: IsoDate, idempotencyKey: string) => apiFetch<StudentDocIssued>(`/documents/${encodeURIComponent(id)}/return`, { method: "POST", body: { returnedOn }, idempotencyKey }),
  /** Class roster for printing a sheet of ID cards; `full` adds each student's full record (admission forms). */
  classRoster: (ctx: Ctx, classSection: string, full = false) => apiFetch<StudentDocSnapshot[]>("/documents/roster", { query: { ...ctxQuery(ctx), classSection, ...(full ? { full: "1" } : {}) } }),
  /** Students admitted between two dates (a class and section when given), for admission slips in bulk. */
  newAdmissions: (ctx: Ctx, q: StudentDocsNewAdmissionsQuery) =>
    apiFetch<StudentDocSnapshot[]>("/documents/new-admissions", { query: { ...ctxQuery(ctx), className: q.className, section: q.section, from: q.from, to: q.to } }),
  /** Days present this session for every student of a class-section (letters for a class). */
  classAttendance: (ctx: Ctx, classSection: string) => apiFetch<StudentDocsClassAttendance[]>("/documents/attendance", { query: { ...ctxQuery(ctx), classSection } }),
  /** Students of a class (or group) with board roll numbers, for the board-document collection sheet. */
  collectionSheet: (ctx: Ctx, q: StudentDocsCollectionQuery) =>
    apiFetch<StudentDocsCollectionSheet>("/documents/collection-sheet", { query: { ...ctxQuery(ctx), className: q.className, section: q.section, stream: q.stream, gender: q.gender } }),
};

export const studentDocsQueries = {
  all: () => ["documents"] as const,
  register: (ctx: Ctx, type?: StudentDocType | "") => queryOptions({ queryKey: ["documents", ...ctxKey(ctx), "register", type ?? ""], queryFn: () => studentDocsApi.register(ctx, type) }),
  forStudent: (grNo: string) => queryOptions({ queryKey: ["documents", "student", grNo], queryFn: () => studentDocsApi.forStudent(grNo), enabled: Boolean(grNo) }),
  classRoster: (ctx: Ctx, classSection: string, full = false) =>
    queryOptions({ queryKey: ["documents", ...ctxKey(ctx), "roster", classSection, full], queryFn: () => studentDocsApi.classRoster(ctx, classSection, full), enabled: Boolean(classSection) }),
  newAdmissions: (ctx: Ctx, q: StudentDocsNewAdmissionsQuery) =>
    queryOptions({ queryKey: ["documents", ...ctxKey(ctx), "new-admissions", q], queryFn: () => studentDocsApi.newAdmissions(ctx, q), enabled: Boolean(q.from && q.to) }),
  collectionSheet: (ctx: Ctx, q: StudentDocsCollectionQuery) =>
    queryOptions({ queryKey: ["documents", ...ctxKey(ctx), "collection-sheet", q], queryFn: () => studentDocsApi.collectionSheet(ctx, q), enabled: Boolean(q.className) }),
  classAttendance: (ctx: Ctx, classSection: string) =>
    queryOptions({ queryKey: ["documents", ...ctxKey(ctx), "attendance", classSection], queryFn: () => studentDocsApi.classAttendance(ctx, classSection), enabled: Boolean(classSection) }),
};
