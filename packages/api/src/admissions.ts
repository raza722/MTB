// Admissions API — enquiries, applications, entrance tests with candidate fees, merit lists and offers,
// admission with class placement and G.R. number, and the duplicate-person review queue.
// Every export is prefixed with "admissions" so `export *` in index.ts never collides.
import type { IsoDate, IsoDateTime, Rupees } from "@mtb/domain";
import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { ctxKey, ctxQuery, type CampusCode, type CampusScope, type Ctx } from "./context";
import type { StudentPersonalExtras, StudentSummary } from "./students";

/** Applied → Test → Merit list → Offered → Admitted (Withdrawn leaves the pipeline). */
export type AdmissionsStage = "APPLIED" | "TEST" | "MERIT" | "OFFERED" | "ADMITTED" | "WITHDRAWN";

/** The pipeline's columns, in order. */
export const ADMISSIONS_STAGES: AdmissionsStage[] = ["APPLIED", "TEST", "MERIT", "OFFERED", "ADMITTED"];

export const ADMISSIONS_STAGE_LABEL: Record<AdmissionsStage, string> = {
  APPLIED: "Applied",
  TEST: "Test",
  MERIT: "Merit list",
  OFFERED: "Offered",
  ADMITTED: "Admitted",
  WITHDRAWN: "Withdrawn",
};

export interface AdmissionsFee {
  amount: Rupees;
  status: "PAID" | "DUE" | "WAIVED";
  receiptNo?: string;
  paidOn?: IsoDate;
  /** Set when paid at the fee office: one line per head (test fee, prospectus, form fee). */
  lines?: Array<{ head: string; amount: Rupees; paid: Rupees }>;
  receivedBy?: string;
  paymentMethod?: "CASH" | "BANK";
  bankChallanNo?: string;
  paidBy?: string;
}

export interface AdmissionsHistoryItem {
  at: IsoDateTime;
  text: string;
  by?: string;
}

export interface AdmissionsApplicant extends StudentPersonalExtras {
  id: string;
  /** "KC-APP-2627-0371" */
  applicationNo: string;
  name: string;
  nameUr?: string;
  relation: "s/o" | "d/o";
  father: string;
  /** 13 digits, or "" when the family didn't give it. */
  fatherCnic: string;
  mother?: string;
  dob: IsoDate;
  gender: "F" | "M";
  bForm?: string;
  previousSchool?: string;
  campus: CampusCode;
  campusName: string;
  session: number;
  /** "Class 6" */
  classApplied: string;
  stage: AdmissionsStage;
  appliedOn: IsoDate;
  /** Where the application came from. */
  source?: "DESK" | "WEB" | "ENQUIRY";
  enquiryNo?: string;
  /** Entrance test sitting, once scheduled. */
  testId?: string;
  /** Entrance test date once scheduled. */
  testDate?: IsoDate;
  /** Seat number on the test slip, e.g. "T6-012". */
  testRollNo?: string;
  /** Marks per test subject; null = not entered yet. */
  marks?: Record<string, number | null>;
  absentFromTest?: boolean;
  /** Entrance test score; null until marked. */
  testScore: number | null;
  testMax: number;
  /** No entrance test for this class: admission is decided on interview and seats. */
  directAdmission?: boolean;
  /** Candidate (test) fee. */
  fee?: AdmissionsFee;
  /** Took the Diamond Minds talent test: an applicant, not yet a student. */
  diamondMinds: boolean;
  mobile: string;
  address: string;
  /** Set when admission was offered from a merit list. */
  offeredOn?: IsoDate;
  offeredBy?: string;
  offerValidUntil?: IsoDate;
  /** Group for classes with groups (9, 10, college), e.g. "Science (Biology)". Confirmed on admission. */
  stream?: string;
  /** G.R. number once admitted. */
  grNo?: string;
  admittedOn?: IsoDate;
  admittedClassSection?: string;
  withdrawnOn?: IsoDate;
  withdrawnReason?: string;
  /** Children already at MTB with the same father's CNIC. */
  siblings?: Array<{ grNo: string; name: string; classSection: string; campusName: string }>;
  history?: AdmissionsHistoryItem[];
}

export interface AdmissionsPipeline {
  campus: CampusScope;
  session: number;
  counts: Record<AdmissionsStage, number>;
  applicants: AdmissionsApplicant[];
  /** Enquiries still open (not yet an application). */
  openEnquiries: number;
  /** Admitted in the last 7 days. */
  admittedThisWeek: number;
}

export interface AdmissionsMeritRow {
  rank: number;
  applicant: AdmissionsApplicant;
}

export interface AdmissionsMeritList {
  classApplied: string;
  /** Classes that have a merit list this session at this campus. */
  classes: string[];
  testName: string;
  testDate: IsoDate;
  seats: number;
  /** Lowest score inside the seats. */
  cutoffScore: number | null;
  rows: AdmissionsMeritRow[];
  /** Papers, for a column per paper (the sitting's, or every paper of the class's sittings). */
  subjects: AdmissionsTestSubject[];
  /** The next list's number: 1 for the 1st merit list, 2 for the 2nd… */
  round: number;
  /** Sittings of this class, for the Sitting filter. */
  tests: Array<{ id: string; name: string; date: IsoDate }>;
  /** Lists already saved for this class, newest first. */
  saved: AdmissionsSavedMeritList[];
  counts: {
    /** Sat the test and were marked (in the sitting or class chosen). */
    appeared: number;
    absent: number;
    /** Inside the seats on this list. */
    inside: number;
    /** Below the seats but within the waiting band (the next as many again). */
    waiting: number;
    notSelected: number;
  };
}

/** A merit list saved as an official round ("1st merit list"). */
export interface AdmissionsSavedMeritList {
  id: string;
  round: number;
  title: string;
  classApplied: string;
  testId: string | null;
  seats: number;
  /** Applicant ids inside the seats when saved, in rank order. */
  selected: string[];
  savedOn: IsoDate;
  savedBy: string;
}

export interface AdmissionsMeritQuery {
  testId?: string;
  gender?: "F" | "M" | "";
  /** Seats on this list; the class's default when missing. */
  seats?: number;
}

export interface AdmissionsSaveMeritInput {
  classApplied: string;
  testId?: string;
  gender?: "F" | "M" | "";
  seats: number;
  title: string;
}

export interface AdmissionsOfferResult {
  offered: AdmissionsApplicant[];
}

/* ---------------------------------------------------------------- Enquiries */

export type AdmissionsEnquirySource = "WALK_IN" | "PHONE" | "WEBSITE" | "REFERRAL" | "SIBLING";

export const ADMISSIONS_ENQUIRY_SOURCE_LABEL: Record<AdmissionsEnquirySource, string> = {
  WALK_IN: "Walk-in",
  PHONE: "Phone call",
  WEBSITE: "Website form",
  REFERRAL: "Referred by a parent",
  SIBLING: "Sibling already at MTB",
};

export interface AdmissionsEnquiry {
  id: string;
  /** "KC-ENQ-2627-0118" */
  enquiryNo: string;
  campus: CampusCode;
  campusName: string;
  session: number;
  childName: string;
  gender: "F" | "M";
  parentName: string;
  mobile: string;
  classInterest: string;
  source: AdmissionsEnquirySource;
  receivedOn: IsoDate;
  followUpOn?: IsoDate;
  status: "OPEN" | "CONVERTED" | "CLOSED";
  notes?: string;
  closedReason?: string;
  applicationNo?: string;
  takenBy: string;
}

export interface AdmissionsEnquiryInput {
  childName: string;
  gender: "F" | "M";
  parentName: string;
  mobile: string;
  classInterest: string;
  source: AdmissionsEnquirySource;
  followUpOn?: IsoDate;
  notes?: string;
}

/* ---------------------------------------------------------------- Entrance tests */

export interface AdmissionsTestSubject {
  subject: string;
  max: number;
  /** Only candidates of this group sit the paper (classes with groups); missing for a common paper. */
  stream?: string;
  /** Length of the paper in minutes. */
  durationMins?: number;
}

/** The papers a candidate sits: common papers and their own group's. */
export const admissionsPapersFor = (subjects: AdmissionsTestSubject[], stream?: string) => subjects.filter((s) => !s.stream || s.stream === stream);

export interface AdmissionsTest {
  id: string;
  campus: CampusCode;
  session: number;
  classApplied: string;
  /** "Class 6 entrance test · round 2" */
  name: string;
  date: IsoDate;
  /** "9:00 am" */
  time: string;
  venue: string;
  subjects: AdmissionsTestSubject[];
  max: number;
  candidates: number;
  feePaid: number;
  marked: number;
  status: "UPCOMING" | "MARKING" | "DONE";
  /** Remarks for the sitting, saved with the marks. */
  remarks?: string;
}

export interface AdmissionsTestSheet {
  test: AdmissionsTest;
  rows: AdmissionsApplicant[];
  /** After saving marks: candidates who moved to the merit list. */
  completed?: number;
}

export interface AdmissionsTestInput {
  classApplied: string;
  date: IsoDate;
  time: string;
  venue: string;
  subjects: AdmissionsTestSubject[];
}

export interface AdmissionsMarksRow {
  id: string;
  absent: boolean;
  marks: Record<string, number | null>;
}

/** Admission rules per class at a campus. */
export interface AdmissionsClassRule {
  classApplied: string;
  /** "Prep", "1" … "10" — the class in student records. */
  classShort: string;
  testRequired: boolean;
  candidateFee: Rupees;
  admissionFee: Rupees;
  seatsOnMeritList: number;
  /** Groups a child chooses in this class (9, 10, college), e.g. "Science (Biology)"; empty for other classes. */
  streams: string[];
}

export interface AdmissionsSetup {
  campus: CampusScope;
  session: number;
  classes: AdmissionsClassRule[];
  tests: AdmissionsTest[];
}

/* ---------------------------------------------------------------- New application */

export interface AdmissionsApplicationInput extends StudentPersonalExtras {
  /** Group for classes with groups. */
  stream?: string;
  name: string;
  nameUr?: string;
  gender: "F" | "M";
  dob: IsoDate;
  bForm?: string;
  previousSchool?: string;
  classApplied: string;
  father: string;
  fatherCnic: string;
  mother?: string;
  mobile: string;
  address: string;
  testId?: string;
  /** Candidate fee paid at the desk now. */
  feePaidNow: boolean;
  enquiryId?: string;
}

/** Live checks while the form is typed: the family already at MTB and possible duplicate people. */
export interface AdmissionsCheckResult {
  family?: { familyId?: string; fatherName: string; children: StudentSummary[] };
  matches: Array<{ ref: string; source: "STUDENT" | "APPLICANT"; name: string; father: string; context: string; campusName: string; reasons: string[]; strength: number }>;
}

/* ---------------------------------------------------------------- Admission (placement and G.R. number) */

export interface AdmissionsPlacement {
  classApplied: string;
  classShort: string;
  /** Next G.R. number the campus will issue. */
  nextGrNo: string;
  admissionFee: Rupees;
  sections: Array<{ section: string; classSection: string; seats: number; enrolled: number; nextRollNo: number; classTeacher?: string; girls: number; boys: number }>;
}

export interface AdmissionsAdmitInput {
  classSection: string;
  admissionDate: IsoDate;
  house?: string;
  /** Send the welcome SMS to the guardian. */
  welcomeSms: boolean;
  /** Group, confirmed on admission; required for classes with groups. */
  stream?: string;
  hostel?: boolean;
}

export interface AdmissionsAdmitResult {
  applicant: AdmissionsApplicant;
  student: StudentSummary;
  rollNo: number;
  /** Charges raised on the student's ledger, for the fee counter. */
  charges: Array<{ head: string; amount: Rupees; dueDate: IsoDate }>;
  /** The welcome SMS, when asked for: its send in Messages (held while all SMS are paused). */
  welcomeSms?: { batchId: string; held: boolean };
}

/* ---------------------------------------------------------------- Duplicates */

/** A record on one side of a duplicate comparison. */
export interface AdmissionsPersonRecord {
  source: "STUDENT" | "APPLICANT";
  /** G.R. number or application number. */
  ref: string;
  campusName: string;
  /** "Student · 7-B" or "Applicant · Class 8" */
  context: string;
  fields: AdmissionsPersonFields;
}

export interface AdmissionsPersonFields {
  name: string;
  father: string;
  fatherCnic: string;
  dob: IsoDate | "";
  gender: "F" | "M";
  mobile: string;
  address: string;
}

export type AdmissionsField = keyof AdmissionsPersonFields;

export const ADMISSIONS_FIELD_LABEL: Record<AdmissionsField, string> = {
  name: "Name",
  father: "Father's name",
  fatherCnic: "Father's CNIC",
  dob: "Date of birth",
  gender: "Gender",
  mobile: "Guardian mobile",
  address: "Address",
};

export interface AdmissionsDuplicateCase {
  id: string;
  campus: CampusCode;
  campusName: string;
  /** 0–100 */
  strength: number;
  /** The rules that matched, in plain words. */
  rules: string[];
  foundOn: IsoDate;
  left: AdmissionsPersonRecord;
  right: AdmissionsPersonRecord;
}

export interface AdmissionsDecision {
  id: string;
  caseId: string;
  decision: "MERGED" | "NOT_SAME";
  by: string;
  at: IsoDateTime;
  /** "Merged M. Bilal (KC-APP-2627-0402) into Muhammad Bilal (KC-14650)" */
  summary: string;
  /** Field → which side's value was kept (merges only). */
  kept?: Partial<Record<AdmissionsField, "left" | "right">>;
}

export interface AdmissionsDuplicates {
  cases: AdmissionsDuplicateCase[];
  decisions: AdmissionsDecision[];
}

/** "Strong match" ≥ 90 · "Likely match" ≥ 75 · "Possible match" below. */
export function admissionsMatchLabel(strength: number): string {
  return strength >= 90 ? "Strong match" : strength >= 75 ? "Likely match" : "Possible match";
}

/** Reasons offered when an applicant withdraws or an offer lapses. */
export const ADMISSIONS_WITHDRAW_REASONS = ["Family chose another school", "Did not appear in the test", "Offer not accepted in time", "Below the cut-off, not interested in the waiting list", "Duplicate application", "Other"];

export const admissionsApi = {
  pipeline: (ctx: Ctx) => apiFetch<AdmissionsPipeline>("/admissions/pipeline", { query: ctxQuery(ctx) }),
  applicant: (id: string) => apiFetch<AdmissionsApplicant>(`/admissions/applicants/${encodeURIComponent(id)}`),
  setup: (ctx: Ctx) => apiFetch<AdmissionsSetup>("/admissions/setup", { query: ctxQuery(ctx) }),
  merit: (ctx: Ctx, classApplied: string, q: AdmissionsMeritQuery = {}) =>
    apiFetch<AdmissionsMeritList>("/admissions/merit", { query: { ...ctxQuery(ctx), class: classApplied, ...(q.testId ? { testId: q.testId } : {}), ...(q.gender ? { gender: q.gender } : {}), ...(q.seats !== undefined ? { seats: String(q.seats) } : {}) } }),
  /** Save the list as the next numbered round ("2nd merit list"). Applicants already offered are left out of later rounds. */
  saveMeritList: (ctx: Ctx, input: AdmissionsSaveMeritInput, idempotencyKey: string) => apiFetch<AdmissionsSavedMeritList>("/admissions/merit/lists", { method: "POST", body: { ...ctxQuery(ctx), ...input }, idempotencyKey }),
  /** `list` is the merit list on screen (sitting, gender, seats): only applicants inside its seats can be offered. */
  offer: (ctx: Ctx, applicantIds: string[], idempotencyKey: string, list?: { classApplied: string; testId?: string; gender?: string; seats?: number }) =>
    apiFetch<AdmissionsOfferResult>("/admissions/offers", { method: "POST", body: { ...ctxQuery(ctx), applicantIds, ...(list ? { list } : {}) }, idempotencyKey }),

  enquiries: (ctx: Ctx) => apiFetch<AdmissionsEnquiry[]>("/admissions/enquiries", { query: ctxQuery(ctx) }),
  createEnquiry: (ctx: Ctx, input: AdmissionsEnquiryInput, idempotencyKey: string) =>
    apiFetch<AdmissionsEnquiry>("/admissions/enquiries", { method: "POST", body: { ...ctxQuery(ctx), ...input }, idempotencyKey }),
  updateEnquiry: (id: string, patch: { status?: "OPEN" | "CLOSED"; followUpOn?: IsoDate; notes?: string; closedReason?: string }, idempotencyKey: string) =>
    apiFetch<AdmissionsEnquiry>(`/admissions/enquiries/${encodeURIComponent(id)}`, { method: "PATCH", body: patch, idempotencyKey }),

  check: (ctx: Ctx, body: { name: string; father: string; fatherCnic: string; dob: IsoDate | "" }) =>
    apiFetch<AdmissionsCheckResult>("/admissions/check", { method: "POST", body: { ...ctxQuery(ctx), ...body } }),
  apply: (ctx: Ctx, input: AdmissionsApplicationInput, idempotencyKey: string) =>
    apiFetch<AdmissionsApplicant>("/admissions/applicants", { method: "POST", body: { ...ctxQuery(ctx), ...input }, idempotencyKey }),
  scheduleTest: (id: string, testId: string, idempotencyKey: string) =>
    apiFetch<AdmissionsApplicant>(`/admissions/applicants/${encodeURIComponent(id)}/test`, { method: "POST", body: { testId }, idempotencyKey }),
  recordFee: (id: string, idempotencyKey: string) => apiFetch<AdmissionsApplicant>(`/admissions/applicants/${encodeURIComponent(id)}/fee`, { method: "POST", idempotencyKey }),
  withdraw: (id: string, reason: string, idempotencyKey: string) =>
    apiFetch<AdmissionsApplicant>(`/admissions/applicants/${encodeURIComponent(id)}/withdraw`, { method: "POST", body: { reason }, idempotencyKey }),
  offerDirect: (id: string, idempotencyKey: string) => apiFetch<AdmissionsApplicant>(`/admissions/applicants/${encodeURIComponent(id)}/offer`, { method: "POST", idempotencyKey }),

  testSheet: (testId: string) => apiFetch<AdmissionsTestSheet>(`/admissions/tests/${encodeURIComponent(testId)}`),
  createTest: (ctx: Ctx, input: AdmissionsTestInput, idempotencyKey: string) =>
    apiFetch<AdmissionsTest>("/admissions/tests", { method: "POST", body: { ...ctxQuery(ctx), ...input }, idempotencyKey }),
  saveMarks: (testId: string, rows: AdmissionsMarksRow[], idempotencyKey: string, remarks?: string) =>
    apiFetch<AdmissionsTestSheet>(`/admissions/tests/${encodeURIComponent(testId)}/marks`, { method: "POST", body: { rows, ...(remarks !== undefined ? { remarks } : {}) }, idempotencyKey }),

  placement: (ctx: Ctx, classApplied: string) => apiFetch<AdmissionsPlacement>("/admissions/placement", { query: { ...ctxQuery(ctx), class: classApplied } }),
  admit: (id: string, input: AdmissionsAdmitInput, idempotencyKey: string) =>
    apiFetch<AdmissionsAdmitResult>(`/admissions/applicants/${encodeURIComponent(id)}/admit`, { method: "POST", body: input, idempotencyKey }),

  duplicates: (ctx: Ctx) => apiFetch<AdmissionsDuplicates>("/admissions/duplicates", { query: ctxQuery(ctx) }),
  merge: (caseId: string, keep: Partial<Record<AdmissionsField, "left" | "right">>, idempotencyKey: string) =>
    apiFetch<AdmissionsDecision>(`/admissions/duplicates/${encodeURIComponent(caseId)}/merge`, { method: "POST", body: { keep }, idempotencyKey }),
  notSame: (caseId: string, idempotencyKey: string) =>
    apiFetch<AdmissionsDecision>(`/admissions/duplicates/${encodeURIComponent(caseId)}/not-same`, { method: "POST", idempotencyKey }),
};

export const admissionsQueries = {
  all: () => ["admissions"] as const,
  pipeline: (ctx: Ctx) => queryOptions({ queryKey: ["admissions", ...ctxKey(ctx), "pipeline"], queryFn: () => admissionsApi.pipeline(ctx) }),
  applicant: (id: string) => queryOptions({ queryKey: ["admissions", "applicant", id], queryFn: () => admissionsApi.applicant(id), enabled: Boolean(id) }),
  setup: (ctx: Ctx) => queryOptions({ queryKey: ["admissions", ...ctxKey(ctx), "setup"], queryFn: () => admissionsApi.setup(ctx) }),
  merit: (ctx: Ctx, classApplied: string, q: AdmissionsMeritQuery = {}) =>
    queryOptions({ queryKey: ["admissions", ...ctxKey(ctx), "merit", classApplied, q.testId ?? "", q.gender ?? "", q.seats ?? ""], queryFn: () => admissionsApi.merit(ctx, classApplied, q) }),
  enquiries: (ctx: Ctx) => queryOptions({ queryKey: ["admissions", ...ctxKey(ctx), "enquiries"], queryFn: () => admissionsApi.enquiries(ctx) }),
  check: (ctx: Ctx, body: { name: string; father: string; fatherCnic: string; dob: IsoDate | "" }) =>
    queryOptions({
      queryKey: ["admissions", ...ctxKey(ctx), "check", body],
      queryFn: () => admissionsApi.check(ctx, body),
      enabled: body.fatherCnic.length === 13 || (body.name.trim().length >= 3 && body.father.trim().length >= 3),
      staleTime: 30_000,
    }),
  testSheet: (testId: string) => queryOptions({ queryKey: ["admissions", "test", testId], queryFn: () => admissionsApi.testSheet(testId), enabled: Boolean(testId) }),
  placement: (ctx: Ctx, classApplied: string) =>
    queryOptions({ queryKey: ["admissions", ...ctxKey(ctx), "placement", classApplied], queryFn: () => admissionsApi.placement(ctx, classApplied), enabled: Boolean(classApplied) }),
  duplicates: (ctx: Ctx) => queryOptions({ queryKey: ["admissions", ...ctxKey(ctx), "duplicates"], queryFn: () => admissionsApi.duplicates(ctx) }),
};
