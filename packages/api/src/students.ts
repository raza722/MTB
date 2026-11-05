import type { AttendanceCode, IsoDate, IsoDateTime, Rupees } from "@mtb/domain";
import { queryOptions } from "@tanstack/react-query";
import type { AdmissionsStage } from "./admissions";
import { apiFetch } from "./client";
import { ctxKey, ctxQuery, type CampusCode, type Ctx } from "./context";

export type FeeStatusCode = "paid" | "unpaid" | "overdue" | "cancelled";
/**
 * Where a student stands now. Struck off is temporary and can be restored (continuous absence, unpaid dues);
 * expelled is a disciplinary decision; left covers withdrawals and transfers out of the school.
 */
export type EnrolmentStatusCode = "ACTIVE" | "LEFT" | "STRUCK_OFF" | "PASSED_OUT" | "EXPELLED";

export const ENROLMENT_STATUS_LABEL: Record<EnrolmentStatusCode, string> = {
  ACTIVE: "Enrolled",
  LEFT: "Left",
  STRUCK_OFF: "Struck off",
  PASSED_OUT: "Passed out",
  EXPELLED: "Expelled",
};

export interface StudentSummary {
  grNo: string;
  name: string;
  nameUr?: string;
  relation: "s/o" | "d/o";
  father: string;
  fatherCnic: string;
  gender: "F" | "M";
  campus: CampusCode;
  campusName: string;
  /** "7-B" */
  classSection: string;
  session: number;
  status: EnrolmentStatusCode;
  feeStatus: FeeStatusCode;
  /** Calculated from the ledger. */
  balance: Rupees;
  /** Group (stream) in classes with groups, e.g. "Science (Biology)". Sent on the student list. */
  stream?: string;
}

/** Board (BISE) roll numbers: Part-I is the Class 9 board exam, Part-II the Class 10 board exam. */
export interface StudentBoardRollNo {
  partI?: string;
  partII?: string;
}

export interface Guardian {
  name: string;
  nameUr?: string;
  relation: string;
  cnic: string;
  mobile: string;
  address: string;
  occupation?: string;
}

export interface EnrolmentEvent {
  id: string;
  date: IsoDate;
  kind: "ADMITTED" | "PROMOTED" | "SECTION_CHANGE" | "TRANSFER_IN" | "LEFT" | "TRANSFER_OUT" | "STRUCK_OFF" | "RESTORED" | "EXPELLED" | "DETAINED" | "PASSED_OUT" | "ROLL_NO" | "NOTE";
  title: string;
  description?: string;
  /** Who recorded it (new events only). */
  by?: string;
}

/** One row of the class history: where the student sat, from when to when. */
export interface ClassHistoryRow {
  session: number;
  campus: CampusCode;
  campusName: string;
  classSection: string;
  rollNo?: number;
  from: IsoDate;
  /** Open while the student is still in this class. */
  to?: IsoDate;
  /** How the student got here: "Admitted", "Promoted", "Section change", "Transferred in". */
  reason: string;
  /** How the year ended: "Promoted", "Detained", "Passed out", "Left". */
  outcome?: string;
  /** Group (stream) in classes with groups, when chosen for this placement (promotion into Class 9 or 10). */
  stream?: string;
}

/** Set once next session's class is decided (promotion run). */
export interface NextSessionPlacement {
  session: number;
  classSection: string;
  outcome: "PROMOTE" | "DETAIN" | "LEFT" | "PASS_OUT";
  decidedOn: IsoDate;
  decidedBy: string;
  /** Group in next session's class, when that class has groups. */
  stream?: string;
}

/** The rest of the legacy admission form: identity, contact, parents' work and education, emergency contact. */
export interface StudentPersonalExtras {
  religion?: string;
  /** "None", or what the school should know. */
  disability?: string;
  identificationMark?: string;
  birthCertificateNo?: string;
  email?: string;
  homePhone?: string;
  city?: string;
  /** Where the family lives for now, when not at the home address. */
  tempAddress?: string;
  fatherQualification?: string;
  fatherOccupation?: string;
  motherQualification?: string;
  motherOccupation?: string;
  /** Someone other than the guardian to call in an emergency. */
  emergencyContact?: { name: string; mobile1: string; mobile2?: string };
  /** Lives in the school hostel. */
  hostel?: boolean;
  /** Who referred the family (a parent, a staff member, an advert). */
  admissionReference?: string;
}

/** A board exam or another earlier qualification on the student's record (prefills the character certificate). */
export interface StudentQualification {
  id: string;
  /** "SSC Part-I (Class 9) Annual 2026" */
  exam: string;
  /** "BISE Bahawalpur" */
  board: string;
  year: number;
  rollNo: string;
  obtained: number;
  total: number;
  /** "Science (Biology)" */
  group?: string;
  rowVer: number;
  updatedBy?: string;
  updatedAt?: IsoDateTime;
}

export type StudentQualificationInput = Pick<StudentQualification, "exam" | "board" | "year" | "rollNo" | "obtained" | "total" | "group">;

export interface StudentProfile extends StudentSummary, StudentPersonalExtras {
  dob: IsoDate;
  admissionDate: IsoDate;
  rollNo: number;
  house?: string;
  guardian: Guardian;
  mother?: string;
  /** Family grouped by father's CNIC, across campuses (excluding this student). */
  siblings: StudentSummary[];
  enrolment: EnrolmentEvent[];
  leftOn?: IsoDate;
  /** Group for classes 9–10: "Science", "Computer Science". */
  stream?: string;
  religion?: string;
  bloodGroup?: string;
  /** Child's B-form (CNIC format), when the family gave it. */
  bForm?: string;
  /** Board roll numbers (Class 9 and 10). */
  boardRollNo?: StudentBoardRollNo;
  /** Board exams and other earlier qualifications (the legacy academic record), oldest first. */
  qualifications?: StudentQualification[];
  previousSchool?: string;
  /** "Class 1" */
  admittedInClass?: string;
  /** Family record this child belongs to, e.g. "FAM-1001". */
  familyId?: string;
  /** Class history per session, oldest first. */
  history?: ClassHistoryRow[];
  nextSession?: NextSessionPlacement;
  /** Why the student is no longer enrolled (status other than ACTIVE). */
  statusNote?: { on: IsoDate; reason: string; remarks?: string; by?: string };
  /** Number of documents issued (certificates, ID cards, slips). */
  documentsIssued?: number;
  /** Set when this record was merged into another one. */
  mergedInto?: string;
}

export interface StudentListQuery {
  q?: string;
  className?: string;
  section?: string;
  status?: EnrolmentStatusCode | "";
  feeStatus?: FeeStatusCode | "";
  gender?: "F" | "M" | "";
  /** Group (stream), e.g. "Science (Biology)". */
  stream?: string;
}

/** Extra columns for the downloaded student list (GET /students?detail=1). */
export interface StudentListDetail {
  dob: IsoDate;
  bForm?: string;
  previousSchool?: string;
  guardianMobile: string;
  address: string;
  boardRollNo?: StudentBoardRollNo;
}

/** One postal address label: who it is for and where it goes. */
export interface StudentAddressLabel {
  grNo: string;
  name: string;
  relation: "s/o" | "d/o";
  father: string;
  /** "Class 9" */
  className: string;
  section: string;
  classSection: string;
  /** Guardian the letter is addressed to. */
  guardian: string;
  address: string;
  mobile: string;
  campusName: string;
}

export interface StudentLabelsQuery {
  className?: string;
  section?: string;
  /** Exactly these students (ticked rows or one profile). */
  grNos?: string[];
}

export interface Family {
  fatherCnic: string;
  fatherName: string;
  members: StudentSummary[];
  /** Family record, e.g. "FAM-1001" (opens the Families page). */
  familyId?: string;
}

export interface StudentAttendance {
  month: string;
  days: Partial<Record<IsoDate, AttendanceCode>>;
  holidayNames: Partial<Record<IsoDate, string>>;
}

export interface DeclaredResult {
  examId: string;
  exam: string;
  session: number;
  declaredOn: IsoDate;
  obtained: number;
  total: number;
  percent: number;
  grade: string;
  position?: number;
  subjects: Array<{ subject: string; obtained: number | null; max: number; grade: string; absent?: boolean }>;
}

export interface SmsHistoryItem {
  id: string;
  sentAt: IsoDateTime;
  to: string;
  language: "en" | "ur";
  message: string;
  status: "queued" | "sent" | "delivered" | "failed" | "optedout";
}

/** An admission applicant found by the header search (name, application no., father's CNIC or mobile). */
export interface GlobalSearchApplicant {
  id: string;
  applicationNo: string;
  name: string;
  relation: string;
  father: string;
  classApplied: string;
  campusName: string;
  stage: AdmissionsStage;
}

export interface GlobalSearchResult {
  students: StudentSummary[];
  families: Family[];
  receipts: Array<{ receiptNo: string; studentName: string; grNo: string; total: Rupees; postedAt: IsoDateTime; status: "POSTED" | "CANCEL_PENDING" | "CANCELLED" }>;
  /** Applicants not yet admitted (only for users who can see Admissions). */
  applicants: GlobalSearchApplicant[];
}

/** Contact and identity fields the office may correct on a student's record. */
export interface StudentUpdate {
  nameUr?: string;
  mobile?: string;
  address?: string;
  mother?: string;
  occupation?: string;
  /** Changing it moves the child to that family. */
  fatherCnic?: string;
  bloodGroup?: string;
  religion?: string;
  bForm?: string;
  /** Board roll numbers; an empty string clears one. */
  boardRollNo?: StudentBoardRollNo;
  disability?: string;
  identificationMark?: string;
  birthCertificateNo?: string;
  email?: string;
  homePhone?: string;
  city?: string;
  tempAddress?: string;
  fatherQualification?: string;
  fatherOccupation?: string;
  motherQualification?: string;
  motherOccupation?: string;
  /** null removes the emergency contact. */
  emergencyContact?: { name: string; mobile1: string; mobile2?: string } | null;
  hostel?: boolean;
  admissionReference?: string;
}

/** Student strength for the Students page: headline figures and seats per class. */
export interface StudentStrength {
  enrolled: number;
  girls: number;
  boys: number;
  /** Admitted in this session. */
  newThisSession: number;
  newThisWeek: number;
  /** Left, struck off or expelled in this session. */
  leftThisSession: number;
  struckOff: number;
  families: number;
  /** Families with children at more than one campus. */
  crossCampusFamilies: number;
  classes: Array<{ className: string; label: string; enrolled: number; seats: number; sections: Array<{ section: string; enrolled: number; seats: number; girls: number; boys: number }> }>;
  /** Records that may be the same child, waiting for review in Admissions. */
  duplicatesToReview: number;
}

export const studentsApi = {
  list: (ctx: Ctx, q: StudentListQuery) => apiFetch<{ items: StudentSummary[]; total: number; family?: Family }>("/students", { query: { ...ctxQuery(ctx), ...q } }),
  get: (grNo: string) => apiFetch<StudentProfile>(`/students/${encodeURIComponent(grNo)}`),
  attendance: (grNo: string, month: string) => apiFetch<StudentAttendance>(`/students/${encodeURIComponent(grNo)}/attendance`, { query: { month } }),
  results: (grNo: string) => apiFetch<DeclaredResult[]>(`/students/${encodeURIComponent(grNo)}/results`),
  sms: (grNo: string) => apiFetch<SmsHistoryItem[]>(`/students/${encodeURIComponent(grNo)}/sms`),
  search: (ctx: Ctx, q: string) => apiFetch<GlobalSearchResult>("/search", { query: { ...ctxQuery(ctx), q } }),
  update: (grNo: string, body: StudentUpdate, idempotencyKey: string) => apiFetch<StudentProfile>(`/students/${encodeURIComponent(grNo)}`, { method: "PATCH", body, idempotencyKey }),
  /** Adds a board exam (or other earlier qualification) to the record. */
  addQualification: (grNo: string, body: StudentQualificationInput, idempotencyKey: string) =>
    apiFetch<StudentProfile>(`/students/${encodeURIComponent(grNo)}/qualifications`, { method: "POST", body, idempotencyKey }),
  /** Corrects one; 409 CONCURRENCY when someone else changed it since `rowVer`. */
  updateQualification: (grNo: string, id: string, body: StudentQualificationInput & { rowVer: number }, idempotencyKey: string) =>
    apiFetch<StudentProfile>(`/students/${encodeURIComponent(grNo)}/qualifications/${encodeURIComponent(id)}`, { method: "PUT", body, idempotencyKey }),
  strength: (ctx: Ctx) => apiFetch<StudentStrength>("/students/strength", { query: ctxQuery(ctx) }),
  /** The list with the register columns (date of birth, B-form, previous school, guardian mobile, address), for the download. */
  listDetail: (ctx: Ctx, q: StudentListQuery) => apiFetch<{ items: Array<StudentSummary & StudentListDetail>; total: number }>("/students", { query: { ...ctxQuery(ctx), ...q, detail: 1 } }),
  /** Postal address labels for a class, a section or chosen students. */
  labels: (ctx: Ctx, q: StudentLabelsQuery) =>
    apiFetch<StudentAddressLabel[]>("/students/labels", { query: { ...ctxQuery(ctx), className: q.className, section: q.section, grNos: q.grNos?.join(",") } }),
};

export const studentsQueries = {
  all: () => ["students"] as const,
  list: (ctx: Ctx, q: StudentListQuery) => queryOptions({ queryKey: ["students", ...ctxKey(ctx), "list", q], queryFn: () => studentsApi.list(ctx, q) }),
  profile: (grNo: string) => queryOptions({ queryKey: ["students", "profile", grNo], queryFn: () => studentsApi.get(grNo) }),
  attendance: (grNo: string, month: string) => queryOptions({ queryKey: ["students", "attendance", grNo, month], queryFn: () => studentsApi.attendance(grNo, month) }),
  results: (grNo: string) => queryOptions({ queryKey: ["students", "results", grNo], queryFn: () => studentsApi.results(grNo) }),
  sms: (grNo: string) => queryOptions({ queryKey: ["students", "sms", grNo], queryFn: () => studentsApi.sms(grNo) }),
  search: (ctx: Ctx, q: string) =>
    queryOptions({ queryKey: ["search", ...ctxKey(ctx), q], queryFn: () => studentsApi.search(ctx, q), enabled: q.trim().length >= 2, staleTime: 30_000 }),
  strength: (ctx: Ctx) => queryOptions({ queryKey: ["students", ...ctxKey(ctx), "strength"], queryFn: () => studentsApi.strength(ctx) }),
  labels: (ctx: Ctx, q: StudentLabelsQuery) => queryOptions({ queryKey: ["students", ...ctxKey(ctx), "labels", q], queryFn: () => studentsApi.labels(ctx, q) }),
};
