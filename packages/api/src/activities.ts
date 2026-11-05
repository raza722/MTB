// Scholarships and activities API — owned by the activities feature.
// Scholarship schemes, tests and merit lists, awards with approval and their fee effect (Fees applies them),
// renewal review, houses and points, the events calendar, co-curricular records and certificates.
import type { IsoDate, IsoDateTime } from "@mtb/domain";
import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { ctxKey, ctxQuery, type CampusCode, type Ctx } from "./context";

/* ================================================================================================ Schemes */

export type ActivitiesSchemeKind = "MERIT" | "NEED" | "HAFIZ" | "SIBLING" | "STAFF_CHILD" | "ORPHAN" | "SHUHADA" | "ARMED_FORCES" | "KINSHIP" | "PERIPHERY" | "OTHER";

export const ACTIVITIES_SCHEME_KINDS: ActivitiesSchemeKind[] = ["MERIT", "NEED", "HAFIZ", "SIBLING", "STAFF_CHILD", "ORPHAN", "SHUHADA", "ARMED_FORCES", "KINSHIP", "PERIPHERY", "OTHER"];

export const ACTIVITIES_SCHEME_KIND_LABEL: Record<ActivitiesSchemeKind, string> = {
  MERIT: "Merit (talent)",
  NEED: "Need-based",
  HAFIZ: "Hafiz-e-Quran",
  SIBLING: "Sibling",
  STAFF_CHILD: "Staff child",
  ORPHAN: "Orphan",
  SHUHADA: "Shuhada (martyr's) child",
  ARMED_FORCES: "Armed forces",
  KINSHIP: "Kinship",
  PERIPHERY: "Periphery student",
  OTHER: "Other",
};

/** PERCENT: % off each fee head. FIXED: rupees off the monthly tuition. */
export type ActivitiesBasis = "PERCENT" | "FIXED";

export type ActivitiesFeeHead = "TUITION" | "ANNUAL" | "ADMISSION";

export const ACTIVITIES_FEE_HEADS: ActivitiesFeeHead[] = ["TUITION", "ANNUAL", "ADMISSION"];

export const ACTIVITIES_FEE_HEAD_LABEL: Record<ActivitiesFeeHead, string> = {
  TUITION: "Tuition fee (monthly)",
  ANNUAL: "Annual charges",
  ADMISSION: "Admission fee (new students)",
};

/** Merit schemes: the % off that a result band earns, e.g. 90–100% marks → 50% off tuition. */
export interface ActivitiesMeritBand {
  fromPercent: number;
  toPercent: number;
  value: number;
  /** Only for this class ("7", "Prep"); missing or null = every class. A class's own bands are used before the general ones. */
  classShort?: string | null;
}

/** What the renewal review checks before an award continues into the next session. */
export interface ActivitiesRenewalRule {
  /** Latest declared result must be at least this %; null = not checked. */
  minResultPercent: number | null;
  /** Attendance this session must be at least this %; null = not checked. */
  minAttendancePercent: number | null;
  /** Anything else in plain words, e.g. "Parent still employed at MTB". */
  note: string;
}

export interface ActivitiesScheme {
  id: string;
  name: string;
  nameUrdu: string;
  kind: ActivitiesSchemeKind;
  basis: ActivitiesBasis;
  /** Default % (PERCENT) or rupees a month (FIXED). Each award may differ. */
  value: number;
  feeHeads: ActivitiesFeeHead[];
  /** Who qualifies, in plain words. */
  criteria: string;
  /** Documents the office keeps on file. */
  evidence: string[];
  meritBands: ActivitiesMeritBand[];
  renewal: ActivitiesRenewalRule;
  /** Most awards per class per session; null = no limit. */
  seatsPerClass: number | null;
  /** Awarded from a scholarship test's merit list. */
  needsTest: boolean;
  active: boolean;
  /** Awards in force in the campus and session asked for. */
  awards: number;
  pending: number;
  /** Rs off tuition per month across those awards. */
  monthlyRelief: number;
}

export type ActivitiesSchemeInput = Omit<ActivitiesScheme, "id" | "awards" | "pending" | "monthlyRelief">;

/* ================================================================================================ Fee effect */

export interface ActivitiesFeeLine {
  head: ActivitiesFeeHead;
  label: string;
  per: "month" | "year" | "once";
  before: number;
  after: number;
}

/** What an award does to the student's fees. Read-only here: the Fees module applies it to vouchers. */
export interface ActivitiesFeeEffect {
  lines: ActivitiesFeeLine[];
  /** Rs off each monthly tuition voucher. */
  monthly: number;
  /** Total relief this session, from the first voucher it applies to. */
  session: number;
  /** Monthly vouchers it covers this session. */
  months: number;
  /** "Dec 2026" */
  firstVoucher: string;
  note: string;
}

/** A different % for each fee head (admission, annual charges, tuition); heads not listed use `value`. */
export type ActivitiesHeadValues = Partial<Record<ActivitiesFeeHead, number>>;

export interface ActivitiesFeePreviewQuery {
  studentId: string;
  schemeId: string;
  value: number;
  feeHeads: ActivitiesFeeHead[];
  effectiveFrom: IsoDate;
  /** Per-head % (PERCENT schemes). */
  values?: ActivitiesHeadValues;
}

/** What the scholarship application form recorded (legacy Scholarship Application). */
export interface ActivitiesAwardApplication {
  submittedOn: IsoDate;
  receiptNo?: string;
  lastExam?: { name: string; rollNo?: string; obtained: number; total: number };
  previousSchool?: string;
  /** Staff member (parent) for a staff-child concession. */
  staffParentId?: string;
  staffParentName?: string;
  subjectGroup?: string;
}

/* ================================================================================================ Awards */

export type ActivitiesAwardStatus = "PENDING" | "APPROVED" | "REJECTED" | "ENDED";

export const ACTIVITIES_AWARD_STATUS_LABEL: Record<ActivitiesAwardStatus, string> = {
  PENDING: "Waiting for approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  ENDED: "Ended",
};

export type ActivitiesRenewalOutcome = "MEETS" | "AT_RISK" | "NOT_MET" | "AUTOMATIC";

export const ACTIVITIES_RENEWAL_OUTCOME_LABEL: Record<ActivitiesRenewalOutcome, string> = {
  MEETS: "Meets the criteria",
  AT_RISK: "Close to the line",
  NOT_MET: "Below the criteria",
  AUTOMATIC: "Continues automatically",
};

export type ActivitiesRenewalDecision = "RENEW" | "REDUCE" | "END";

export const ACTIVITIES_RENEWAL_DECISION_LABEL: Record<ActivitiesRenewalDecision, string> = {
  RENEW: "Renew for next session",
  REDUCE: "Renew at a lower rate",
  END: "End at session end",
};

export interface ActivitiesRenewalCheck {
  outcome: ActivitiesRenewalOutcome;
  checks: Array<{ label: string; ok: boolean; detail: string }>;
  latestResult: { exam: string; percent: number } | null;
  attendancePercent: number | null;
  decision?: ActivitiesRenewalDecision;
  /** For REDUCE: the new % or rupees. */
  newValue?: number;
  decidedBy?: string;
  decidedAt?: IsoDateTime;
  note?: string;
}

export interface ActivitiesHistoryItem {
  id: string;
  at: IsoDateTime;
  by: string;
  action: string;
  detail?: string;
}

export interface ActivitiesAward {
  id: string;
  /** "SCH-KC-2627-0014" */
  awardNo: string;
  campus: CampusCode;
  session: number;
  /** G.R. number, or application number for an applicant. */
  studentId: string;
  studentName: string;
  father: string;
  /** "s/o" or "d/o", for letters. */
  relation: "s/o" | "d/o";
  classSection: string;
  isApplicant: boolean;
  hasProfile: boolean;
  schemeId: string;
  schemeName: string;
  kind: ActivitiesSchemeKind;
  basis: ActivitiesBasis;
  value: number;
  feeHeads: ActivitiesFeeHead[];
  /** "25% off tuition" or "Rs 1,500 a month off tuition" ("100% tuition, 50% annual charges" when the heads differ) */
  valueText: string;
  /** Per-head % when the heads differ (PERCENT schemes). */
  values?: ActivitiesHeadValues;
  /** For the lists: from the student's record or the application. */
  gender: "F" | "M";
  previousSchool: string | null;
  /** Application details, when the award was applied for on the form. */
  application?: ActivitiesAwardApplication;
  /** Merit-list round the award came from: 1st list, 2nd list. */
  listRound?: number;
  testId?: string;
  testTitle?: string;
  rank?: number;
  percent?: number;
  reason: string;
  /** Documents seen, in plain words. */
  evidence: string;
  effectiveFrom: IsoDate;
  effectiveTo: IsoDate;
  status: ActivitiesAwardStatus;
  proposedBy: string;
  proposedAt: IsoDateTime;
  decidedBy?: string;
  decidedAt?: IsoDateTime;
  decisionNote?: string;
  endedOn?: IsoDate;
  endReason?: string;
  feeEffect: ActivitiesFeeEffect;
  /** Approved awards only. */
  renewal: ActivitiesRenewalCheck | null;
  history: ActivitiesHistoryItem[];
}

export interface ActivitiesAwardInput {
  studentId: string;
  schemeId: string;
  value: number;
  feeHeads: ActivitiesFeeHead[];
  effectiveFrom: IsoDate;
  reason: string;
  evidence: string;
  /** A different % for each ticked head (PERCENT schemes); heads not listed use `value`. */
  values?: ActivitiesHeadValues;
  application?: Omit<ActivitiesAwardApplication, "staffParentName">;
}

/** Changes to a merit-list row before proposing: the % (or per-head %) for that candidate. */
export interface ActivitiesProposeOverride {
  value?: number;
  values?: ActivitiesHeadValues;
}

export interface ActivitiesAwardsQuery {
  status?: ActivitiesAwardStatus | "ALL";
  schemeId?: string;
}

/* ================================================================================================ People */

export interface ActivitiesPerson {
  id: string;
  name: string;
  father: string;
  relation: "s/o" | "d/o";
  classSection: string;
  campus: CampusCode;
  house: string | null;
  hasProfile: boolean;
  /** An admission applicant (not yet a student): the award applies once admitted. */
  isApplicant?: boolean;
  applicationNo?: string;
  /** Applicants: the school they come from. */
  previousSchool?: string;
}

/* ================================================================================================ Scholarship tests */

/** EXAM: the merit list comes straight from a declared exam. DEDICATED: a scholarship test with its own papers. */
export type ActivitiesTestSource = "EXAM" | "DEDICATED";

export type ActivitiesTestStatus = "REGISTRATION" | "MARKING" | "RESULT" | "AWARDED";

export const ACTIVITIES_TEST_STATUS_LABEL: Record<ActivitiesTestStatus, string> = {
  REGISTRATION: "Registration open",
  MARKING: "Marking",
  RESULT: "Merit list ready",
  AWARDED: "Awards proposed",
};

export interface ActivitiesTestPaper {
  id: string;
  name: string;
  maxMarks: number;
}

export interface ActivitiesTestSummary {
  id: string;
  /** "ST-KC-2627-02" */
  testNo: string;
  title: string;
  campus: CampusCode;
  session: number;
  source: ActivitiesTestSource;
  examId: string | null;
  examName: string | null;
  /** "Class 7" or "Class 9 (students and applicants)" */
  classLabel: string;
  schemeId: string;
  schemeName: string;
  schemeBasis: ActivitiesBasis;
  date: IsoDate | null;
  venue: string | null;
  papers: ActivitiesTestPaper[];
  maxMarks: number;
  /** Awards on offer; null = everyone who reaches the pass mark. */
  seats: number | null;
  passPercent: number;
  status: ActivitiesTestStatus;
  candidateCount: number;
  /** Candidates with every mark entered. */
  marked: number;
  qualified: number;
  proposed: number;
}

/** A number, "A" for absent, or null when not entered yet. */
export type ActivitiesMark = number | "A" | null;

export interface ActivitiesCandidate {
  id: string;
  rollNo: number;
  name: string;
  father: string;
  classSection: string;
  isApplicant: boolean;
  previousSchool: string | null;
  gender: "F" | "M";
  hasProfile: boolean;
  marks: Record<string, ActivitiesMark>;
  obtained: number;
  /** null while marks are missing. */
  percent: number | null;
  /** Standard competition rank (1, 2, 2, 4) among those with a %; null while marks are missing. */
  rank: number | null;
  /** Reached the pass mark. */
  qualifies: boolean;
  /** Qualifies and is inside the seats (ties at the cut-off are included). */
  withinSeats: boolean;
  /** Suggested % (or Rs) from the scheme's merit bands. */
  suggestedValue: number | null;
  awardId: string | null;
  awardStatus: ActivitiesAwardStatus | null;
}

export interface ActivitiesTestDetail extends ActivitiesTestSummary {
  candidates: ActivitiesCandidate[];
  /** Candidates beyond the seats included because they tie at the cut-off. */
  tiedAtCutOff: number;
  history: ActivitiesHistoryItem[];
}

export interface ActivitiesTestInput {
  title: string;
  source: ActivitiesTestSource;
  examId?: string;
  classLabel?: string;
  schemeId: string;
  date?: IsoDate;
  venue?: string;
  papers?: ActivitiesTestPaper[];
  seats: number | null;
  passPercent: number;
}

export interface ActivitiesApplicantInput {
  name: string;
  father: string;
  previousSchool: string;
  mobile: string;
}

export type ActivitiesTestAction = "CLOSE_REGISTRATION" | "PUBLISH" | "REOPEN_MARKING";

/** Exams this campus could build a merit list from (declared results only). */
export interface ActivitiesExamOption {
  id: string;
  name: string;
  classes: string[];
  declaredOn: IsoDateTime | null;
  candidates: number;
}

/* ================================================================================================ Houses */

/** Houses are told apart by name and a categorical chart colour (--chart-1 … --chart-4). */
export type ActivitiesHouseTone = 1 | 2 | 3 | 4;

export interface ActivitiesHouseLead {
  id: string;
  name: string;
  classSection: string;
}

export interface ActivitiesHouse {
  id: string;
  campus: CampusCode;
  name: string;
  nameUrdu: string;
  motto: string;
  tone: ActivitiesHouseTone;
  houseMaster: string;
  assistantMaster: string | null;
  captain: ActivitiesHouseLead | null;
  viceCaptain: ActivitiesHouseLead | null;
  members: number;
  points: number;
  rank: number;
  /** First places in events this session. */
  eventWins: number;
  /** Retired houses stay in the history but are left out of standings, moves and sharing out. */
  active: boolean;
}

export type ActivitiesPointsCategory = "EVENT" | "ACADEMIC" | "DISCIPLINE" | "CONDUCT" | "OTHER";

export const ACTIVITIES_POINTS_CATEGORY_LABEL: Record<ActivitiesPointsCategory, string> = {
  EVENT: "Event result",
  ACADEMIC: "Academic",
  DISCIPLINE: "Discipline",
  CONDUCT: "Conduct and cleanliness",
  OTHER: "Other",
};

export interface ActivitiesPointsEntry {
  id: string;
  houseId: string;
  houseName: string;
  date: IsoDate;
  /** Negative for a deduction. */
  points: number;
  category: ActivitiesPointsCategory;
  reason: string;
  eventId: string | null;
  by: string;
}

export interface ActivitiesHousesView {
  campus: CampusCode;
  houses: ActivitiesHouse[];
  ledger: ActivitiesPointsEntry[];
  /** Points running total at the end of each month, per house id. */
  monthly: Array<{ month: string; totals: Record<string, number> }>;
  /** Active students not in any house. */
  unassigned: number;
}

export interface ActivitiesHouseMember {
  id: string;
  name: string;
  father: string;
  classSection: string;
  houseId: string | null;
  houseName: string | null;
  since: IsoDate | null;
  role: "CAPTAIN" | "VICE_CAPTAIN" | null;
  hasProfile: boolean;
}

export interface ActivitiesMembersQuery {
  /** A house id, "NONE" for students without a house, or "" for everyone. */
  houseId?: string;
  classSection?: string;
  q?: string;
}

export interface ActivitiesHouseInput {
  houseMaster: string;
  assistantMaster: string | null;
  captainId: string | null;
  viceCaptainId: string | null;
  motto: string;
  /** Unique at the campus. */
  name?: string;
  nameUrdu?: string;
  tone?: ActivitiesHouseTone;
  /** false retires the house (only once it has no students). */
  active?: boolean;
}

export interface ActivitiesHouseCreateInput {
  name: string;
  nameUrdu: string;
  tone: ActivitiesHouseTone;
  motto: string;
  houseMaster: string;
  assistantMaster: string | null;
}

export interface ActivitiesPointsInput {
  houseId: string;
  points: number;
  category: ActivitiesPointsCategory;
  reason: string;
  date: IsoDate;
}

/* ================================================================================================ Events */

export type ActivitiesEventKind = "SPORTS" | "DEBATE" | "NATIONAL_DAY" | "SCIENCE_FAIR" | "COMPETITION" | "RELIGIOUS" | "CEREMONY";

export const ACTIVITIES_EVENT_KINDS: ActivitiesEventKind[] = ["SPORTS", "DEBATE", "NATIONAL_DAY", "SCIENCE_FAIR", "COMPETITION", "RELIGIOUS", "CEREMONY"];

export const ACTIVITIES_EVENT_KIND_LABEL: Record<ActivitiesEventKind, string> = {
  SPORTS: "Sports",
  DEBATE: "Debate and speech",
  NATIONAL_DAY: "National day",
  SCIENCE_FAIR: "Science fair",
  COMPETITION: "Competition",
  RELIGIOUS: "Naat and Qirat",
  CEREMONY: "Ceremony",
};

export type ActivitiesEventStatus = "PLANNED" | "OPEN" | "DONE" | "CANCELLED";

export const ACTIVITIES_EVENT_STATUS_LABEL: Record<ActivitiesEventStatus, string> = {
  PLANNED: "Planned",
  OPEN: "Taking names",
  DONE: "Results recorded",
  CANCELLED: "Cancelled",
};

/** House points for each place, and for taking part. */
export interface ActivitiesPointsRule {
  first: number;
  second: number;
  third: number;
  participation: number;
}

export interface ActivitiesEventSummary {
  id: string;
  campus: CampusCode;
  session: number;
  title: string;
  titleUrdu: string;
  kind: ActivitiesEventKind;
  date: IsoDate;
  endDate: IsoDate | null;
  /** "09:00" */
  time: string | null;
  /** The timetable period (lecture number) it takes, when it runs in school hours; null or missing when not set. */
  period?: number | null;
  venue: string;
  /** Teachers in charge. */
  inCharge: string[];
  /** "Classes 6–10" */
  forClasses: string;
  /** Places earn house points. */
  houseEvent: boolean;
  /** Competition items: "English debate", "100 m race". */
  items: string[];
  description: string;
  status: ActivitiesEventStatus;
  cancelReason?: string;
  participants: number;
  placed: number;
  certificates: number;
}

export type ActivitiesRole = "PARTICIPANT" | "PLAYER" | "CAPTAIN" | "VOLUNTEER" | "ORGANISER";

export const ACTIVITIES_ROLE_LABEL: Record<ActivitiesRole, string> = {
  PARTICIPANT: "Participant",
  PLAYER: "Player",
  CAPTAIN: "Team captain",
  VOLUNTEER: "Volunteer",
  ORGANISER: "Organiser",
};

export type ActivitiesPosition = 1 | 2 | 3;

export interface ActivitiesParticipant {
  id: string;
  studentId: string;
  name: string;
  father: string;
  relation: "s/o" | "d/o";
  classSection: string;
  houseId: string | null;
  houseName: string | null;
  item: string;
  role: ActivitiesRole;
  position: ActivitiesPosition | null;
  certificateNo: string | null;
  hasProfile: boolean;
}

export interface ActivitiesEventDetail extends ActivitiesEventSummary {
  participantsList: ActivitiesParticipant[];
  pointsRule: ActivitiesPointsRule;
  history: ActivitiesHistoryItem[];
}

export interface ActivitiesEventInput {
  title: string;
  titleUrdu: string;
  kind: ActivitiesEventKind;
  date: IsoDate;
  endDate: IsoDate | null;
  time: string | null;
  /** Optional period (lecture number) 1 to 10. */
  period?: number | null;
  venue: string;
  inCharge: string[];
  forClasses: string;
  houseEvent: boolean;
  items: string[];
  description: string;
  pointsRule: ActivitiesPointsRule;
}

export interface ActivitiesParticipantsInput {
  studentIds: string[];
  item: string;
  role: ActivitiesRole;
}

/** participantId → place, or null to clear. */
export interface ActivitiesResultsInput {
  positions: Record<string, ActivitiesPosition | null>;
}

/**
 * The sports list (legacy Reports_SportsList): who took part in the session's events, house by house, with the
 * item and the place won. Cancelled events are left out; events still taking names show no place yet.
 */
export interface ActivitiesSportsListRow {
  houseId: string | null;
  houseName: string | null;
  eventId: string;
  eventTitle: string;
  eventDate: IsoDate;
  kind: ActivitiesEventKind;
  item: string;
  studentId: string;
  name: string;
  father: string;
  classSection: string;
  role: ActivitiesRole;
  position: ActivitiesPosition | null;
}

export interface ActivitiesSportsListQuery {
  /** A house id, "NONE" for students not in a house, or "" for every house. */
  houseId?: string;
  /** One kind of event, or "" for every kind. */
  kind?: ActivitiesEventKind | "";
  /** One class-section ("7-B"), or "" for every class. */
  classSection?: string;
  /** Several class-sections at once; empty or missing for every class (added to classSection when both are given). */
  classSections?: string[];
  /** Also list the house's students who took no part (the legacy list was a full house roster). */
  everyone?: boolean;
}

export interface ActivitiesSportsListIdle {
  studentId: string;
  name: string;
  father: string;
  classSection: string;
  houseId: string | null;
  houseName: string | null;
}

export interface ActivitiesSportsList {
  campus: CampusCode;
  session: number;
  /** Events the rows come from. */
  events: number;
  rows: ActivitiesSportsListRow[];
  /** Students who took no part; filled only when asked for (everyone). */
  idle: ActivitiesSportsListIdle[];
}

/* ================================================================================================ Catalogue */

export type ActivitiesCatalogKind = "SPORT" | "COMPETITION" | "CLUB" | "DUTY";

export const ACTIVITIES_CATALOG_KIND_LABEL: Record<ActivitiesCatalogKind, string> = {
  SPORT: "Sport",
  COMPETITION: "Competition",
  CLUB: "Club or society",
  DUTY: "Staff duty",
};

export interface ActivitiesCatalogItem {
  id: string;
  name: string;
  kind: ActivitiesCatalogKind;
  active: boolean;
  /** Records and events that use it. */
  uses: number;
}

export interface ActivitiesVenue {
  id: string;
  campus: CampusCode;
  name: string;
  /** Short title for tight tables and slips ("Hall"); "" when none. */
  shortName: string;
  active: boolean;
  uses: number;
}

export interface ActivitiesCatalogue {
  activities: ActivitiesCatalogItem[];
  venues: ActivitiesVenue[];
}

/* ================================================================================================ Co-curricular record */

export interface ActivitiesRecordEntry {
  id: string;
  date: IsoDate;
  session: number;
  title: string;
  /** "Sports", "Debate and speech", "Club or society" */
  kindLabel: string;
  item: string | null;
  role: ActivitiesRole;
  position: ActivitiesPosition | null;
  /** "1st place", "Member of the school cricket team" */
  achievement: string;
  source: "EVENT" | "MANUAL";
  eventId: string | null;
  certificateNo: string | null;
  housePoints: number;
}

export interface ActivitiesStudentRecord {
  person: ActivitiesPerson;
  houseHistory: Array<{ houseName: string; from: IsoDate; to: IsoDate | null }>;
  entries: ActivitiesRecordEntry[];
  awards: Array<Pick<ActivitiesAward, "id" | "awardNo" | "schemeName" | "valueText" | "status" | "session" | "effectiveFrom">>;
  totals: { events: number; places: number; certificates: number; housePoints: number };
}

export interface ActivitiesRecordInput {
  title: string;
  activityId: string | null;
  date: IsoDate;
  role: ActivitiesRole;
  position: ActivitiesPosition | null;
  achievement: string;
}

/* ================================================================================================ Certificates */

export type ActivitiesCertType = "PARTICIPATION" | "MERIT" | "APPRECIATION" | "SCHOLARSHIP";

export const ACTIVITIES_CERT_TYPE_LABEL: Record<ActivitiesCertType, string> = {
  PARTICIPATION: "Certificate of participation",
  MERIT: "Certificate of merit",
  APPRECIATION: "Certificate of appreciation",
  SCHOLARSHIP: "Scholarship award letter",
};

export interface ActivitiesCertificate {
  id: string;
  /** "KC-CRT-2627-000041" */
  certNo: string;
  campus: CampusCode;
  session: number;
  type: ActivitiesCertType;
  studentId: string;
  studentName: string;
  father: string;
  relation: "s/o" | "d/o";
  classSection: string;
  houseName: string | null;
  eventId: string | null;
  /** The event, or what the appreciation is for. */
  eventTitle: string;
  eventDate: IsoDate | null;
  item: string | null;
  role: ActivitiesRole | null;
  position: ActivitiesPosition | null;
  wording: string;
  issuedOn: IsoDate;
  issuedBy: string;
  /** Printed copies; the second and later print as "Duplicate". */
  prints: number;
}

export interface ActivitiesIssueInput {
  type: ActivitiesCertType;
  /** Participation and merit certificates: the event and the participants. */
  eventId?: string;
  participantIds?: string[];
  /** Appreciation: students and what it is for. */
  studentIds?: string[];
  title?: string;
  wording?: string;
}

/* ================================================================================================ Overview */

export interface ActivitiesTodo {
  id: string;
  kind: "AWARD" | "RENEWAL" | "TEST" | "EVENT";
  title: string;
  detail: string;
  /** App path to open, e.g. "/activities/scholarships". */
  to: string;
  search?: Record<string, string>;
}

export interface ActivitiesOverview {
  awards: { approved: number; pending: number; monthlyRelief: number; sessionRelief: number; atRisk: number; students: number };
  reliefByScheme: Array<{ schemeId: string; name: string; kind: ActivitiesSchemeKind; awards: number; monthly: number }>;
  tests: { open: number; marking: number; ready: number };
  /** Empty with "All campuses": houses belong to one campus. */
  houses: Array<Pick<ActivitiesHouse, "id" | "name" | "tone" | "points" | "rank" | "members">>;
  upcoming: ActivitiesEventSummary[];
  eventsDone: number;
  certificates: number;
  todo: ActivitiesTodo[];
}

/* ================================================================================================ Client */

const j = encodeURIComponent;

export const activitiesApi = {
  overview: (ctx: Ctx) => apiFetch<ActivitiesOverview>("/activities/overview", { query: ctxQuery(ctx) }),

  schemes: (ctx: Ctx) => apiFetch<ActivitiesScheme[]>("/activities/schemes", { query: ctxQuery(ctx) }),
  saveScheme: (ctx: Ctx, body: ActivitiesSchemeInput, id?: string) =>
    apiFetch<ActivitiesScheme>(id ? `/activities/schemes/${j(id)}` : "/activities/schemes", { method: id ? "PUT" : "POST", body, query: ctxQuery(ctx) }),

  awards: (ctx: Ctx, q: ActivitiesAwardsQuery = {}) => apiFetch<ActivitiesAward[]>("/activities/awards", { query: { ...ctxQuery(ctx), status: q.status, schemeId: q.schemeId } }),
  award: (id: string) => apiFetch<ActivitiesAward>(`/activities/awards/${j(id)}`),
  proposeAward: (ctx: Ctx, body: ActivitiesAwardInput) => apiFetch<ActivitiesAward>("/activities/awards", { method: "POST", body, query: ctxQuery(ctx) }),
  decideAward: (id: string, body: { decision: "APPROVE" | "REJECT"; note: string }) => apiFetch<ActivitiesAward>(`/activities/awards/${j(id)}/decide`, { method: "POST", body }),
  endAward: (id: string, body: { endOn: IsoDate; reason: string }) => apiFetch<ActivitiesAward>(`/activities/awards/${j(id)}/end`, { method: "POST", body }),
  decideRenewal: (id: string, body: { decision: ActivitiesRenewalDecision; newValue?: number; note: string }) => apiFetch<ActivitiesAward>(`/activities/awards/${j(id)}/renewal`, { method: "POST", body }),
  renewMany: (ctx: Ctx, awardIds: string[]) => apiFetch<{ renewed: number }>("/activities/renewals", { method: "POST", body: { awardIds }, query: ctxQuery(ctx) }),
  feePreview: (ctx: Ctx, q: ActivitiesFeePreviewQuery) =>
    apiFetch<ActivitiesFeeEffect>("/activities/fee-preview", { query: { ...ctxQuery(ctx), studentId: q.studentId, schemeId: q.schemeId, value: q.value, feeHeads: q.feeHeads.join(","), effectiveFrom: q.effectiveFrom, values: q.values && Object.keys(q.values).length ? Object.entries(q.values).map(([h, v]) => `${h}:${v}`).join(",") : undefined } }),

  /** applicants: also admission applicants of this session who are not admitted yet. */
  /** Staff of the campus (for a staff-child concession's parent). */
  staff: (ctx: Ctx) => apiFetch<Array<{ id: string; name: string; designation: string }>>("/activities/staff", { query: ctxQuery(ctx) }),
  people: (ctx: Ctx, q: string, applicants = false) => apiFetch<ActivitiesPerson[]>("/activities/people", { query: { ...ctxQuery(ctx), q, ...(applicants ? { applicants: "1" } : {}) } }),

  tests: (ctx: Ctx) => apiFetch<ActivitiesTestSummary[]>("/activities/tests", { query: ctxQuery(ctx) }),
  test: (id: string) => apiFetch<ActivitiesTestDetail>(`/activities/tests/${j(id)}`),
  examOptions: (ctx: Ctx) => apiFetch<ActivitiesExamOption[]>("/activities/exam-options", { query: ctxQuery(ctx) }),
  createTest: (ctx: Ctx, body: ActivitiesTestInput) => apiFetch<ActivitiesTestDetail>("/activities/tests", { method: "POST", body, query: ctxQuery(ctx) }),
  addCandidate: (id: string, body: { studentId?: string; applicant?: ActivitiesApplicantInput }) => apiFetch<ActivitiesTestDetail>(`/activities/tests/${j(id)}/candidates`, { method: "POST", body }),
  removeCandidate: (id: string, candidateId: string) => apiFetch<ActivitiesTestDetail>(`/activities/tests/${j(id)}/candidates/${j(candidateId)}`, { method: "DELETE" }),
  saveTestMarks: (id: string, marks: Record<string, Record<string, ActivitiesMark>>) => apiFetch<ActivitiesTestDetail>(`/activities/tests/${j(id)}/marks`, { method: "PUT", body: { marks } }),
  testAction: (id: string, action: ActivitiesTestAction) => apiFetch<ActivitiesTestDetail>(`/activities/tests/${j(id)}/status`, { method: "POST", body: { action } }),
  proposeFromTest: (id: string, candidateIds: string[], overrides?: Record<string, ActivitiesProposeOverride>, round?: number) =>
    apiFetch<ActivitiesTestDetail>(`/activities/tests/${j(id)}/awards`, { method: "POST", body: { candidateIds, ...(overrides ? { overrides } : {}), ...(round ? { round } : {}) } }),

  houses: (ctx: Ctx) => apiFetch<ActivitiesHousesView>("/activities/houses", { query: ctxQuery(ctx) }),
  saveHouse: (id: string, body: ActivitiesHouseInput) => apiFetch<ActivitiesHouse>(`/activities/houses/${j(id)}`, { method: "PUT", body }),
  createHouse: (ctx: Ctx, body: ActivitiesHouseCreateInput) => apiFetch<ActivitiesHouse>("/activities/houses", { method: "POST", body, query: ctxQuery(ctx) }),
  addPoints: (ctx: Ctx, body: ActivitiesPointsInput) => apiFetch<ActivitiesPointsEntry>("/activities/house-points", { method: "POST", body, query: ctxQuery(ctx) }),
  members: (ctx: Ctx, q: ActivitiesMembersQuery) => apiFetch<ActivitiesHouseMember[]>("/activities/house-members", { query: { ...ctxQuery(ctx), houseId: q.houseId, classSection: q.classSection, q: q.q } }),
  /** since: the date the move counts from (today when omitted); the old membership closes the day before. */
  assignHouse: (ctx: Ctx, body: { studentIds: string[]; houseId: string; reason: string; since?: IsoDate }) => apiFetch<{ moved: number }>("/activities/house-members", { method: "POST", body, query: ctxQuery(ctx) }),
  removeFromHouse: (ctx: Ctx, body: { studentIds: string[]; leftOn: IsoDate; reason: string }) => apiFetch<{ removed: number }>("/activities/house-members/remove", { method: "POST", body, query: ctxQuery(ctx) }),
  autoAssign: (ctx: Ctx) => apiFetch<{ assigned: number; byHouse: Record<string, number> }>("/activities/house-members/auto", { method: "POST", query: ctxQuery(ctx) }),

  events: (ctx: Ctx) => apiFetch<ActivitiesEventSummary[]>("/activities/events", { query: ctxQuery(ctx) }),
  event: (id: string) => apiFetch<ActivitiesEventDetail>(`/activities/events/${j(id)}`),
  saveEvent: (ctx: Ctx, body: ActivitiesEventInput, id?: string) =>
    apiFetch<ActivitiesEventDetail>(id ? `/activities/events/${j(id)}` : "/activities/events", { method: id ? "PUT" : "POST", body, query: ctxQuery(ctx) }),
  addParticipants: (id: string, body: ActivitiesParticipantsInput) => apiFetch<ActivitiesEventDetail>(`/activities/events/${j(id)}/participants`, { method: "POST", body }),
  removeParticipant: (id: string, participantId: string) => apiFetch<ActivitiesEventDetail>(`/activities/events/${j(id)}/participants/${j(participantId)}`, { method: "DELETE" }),
  saveResults: (id: string, body: ActivitiesResultsInput) => apiFetch<ActivitiesEventDetail>(`/activities/events/${j(id)}/results`, { method: "PUT", body }),
  cancelEvent: (id: string, reason: string) => apiFetch<ActivitiesEventDetail>(`/activities/events/${j(id)}/cancel`, { method: "POST", body: { reason } }),
  sportsList: (ctx: Ctx, q: ActivitiesSportsListQuery = {}) =>
    apiFetch<ActivitiesSportsList>("/activities/sports-list", {
      query: { ...ctxQuery(ctx), houseId: q.houseId || undefined, kind: q.kind || undefined, classSection: q.classSection || undefined, classSections: q.classSections?.length ? q.classSections.join(",") : undefined, everyone: q.everyone ? "1" : undefined },
    }),

  catalogue: (ctx: Ctx) => apiFetch<ActivitiesCatalogue>("/activities/catalogue", { query: ctxQuery(ctx) }),
  saveActivity: (body: { name: string; kind: ActivitiesCatalogKind; active: boolean }, id?: string) =>
    apiFetch<ActivitiesCatalogItem>(id ? `/activities/catalogue/activities/${j(id)}` : "/activities/catalogue/activities", { method: id ? "PUT" : "POST", body }),
  saveVenue: (ctx: Ctx, body: { name: string; shortName?: string; active: boolean }, id?: string) =>
    apiFetch<ActivitiesVenue>(id ? `/activities/catalogue/venues/${j(id)}` : "/activities/catalogue/venues", { method: id ? "PUT" : "POST", body, query: ctxQuery(ctx) }),

  record: (ctx: Ctx, studentId: string) => apiFetch<ActivitiesStudentRecord>(`/activities/records/${j(studentId)}`, { query: ctxQuery(ctx) }),
  addRecord: (ctx: Ctx, studentId: string, body: ActivitiesRecordInput) => apiFetch<ActivitiesStudentRecord>(`/activities/records/${j(studentId)}`, { method: "POST", body, query: ctxQuery(ctx) }),

  certificates: (ctx: Ctx) => apiFetch<ActivitiesCertificate[]>("/activities/certificates", { query: ctxQuery(ctx) }),
  issueCertificates: (ctx: Ctx, body: ActivitiesIssueInput) => apiFetch<ActivitiesCertificate[]>("/activities/certificates", { method: "POST", body, query: ctxQuery(ctx) }),
  recordPrint: (ids: string[]) => apiFetch<ActivitiesCertificate[]>("/activities/certificates/print", { method: "POST", body: { ids } }),
};

const k = (ctx: Ctx, ...rest: unknown[]) => ["activities", ...ctxKey(ctx), ...rest] as const;

export const activitiesQueries = {
  overview: (ctx: Ctx) => queryOptions({ queryKey: k(ctx, "overview"), queryFn: () => activitiesApi.overview(ctx) }),
  schemes: (ctx: Ctx) => queryOptions({ queryKey: k(ctx, "schemes"), queryFn: () => activitiesApi.schemes(ctx) }),
  awards: (ctx: Ctx, q: ActivitiesAwardsQuery = {}) => queryOptions({ queryKey: k(ctx, "awards", q.status ?? "ALL", q.schemeId ?? ""), queryFn: () => activitiesApi.awards(ctx, q) }),
  award: (ctx: Ctx, id: string) => queryOptions({ queryKey: k(ctx, "award", id), queryFn: () => activitiesApi.award(id), enabled: id !== "" }),
  feePreview: (ctx: Ctx, q: ActivitiesFeePreviewQuery | null) =>
    queryOptions({
      queryKey: k(ctx, "fee-preview", q ? `${q.studentId}|${q.schemeId}|${q.value}|${q.feeHeads.join(",")}|${q.effectiveFrom}|${JSON.stringify(q.values ?? {})}` : ""),
      queryFn: () => activitiesApi.feePreview(ctx, q!),
      enabled: q !== null,
    }),
  staff: (ctx: Ctx) => queryOptions({ queryKey: k(ctx, "staff"), queryFn: () => activitiesApi.staff(ctx), staleTime: 300_000 }),
  people: (ctx: Ctx, q: string, applicants = false) => queryOptions({ queryKey: k(ctx, "people", q, applicants ? "with-applicants" : ""), queryFn: () => activitiesApi.people(ctx, q, applicants), enabled: q.trim().length >= 2 }),
  tests: (ctx: Ctx) => queryOptions({ queryKey: k(ctx, "tests"), queryFn: () => activitiesApi.tests(ctx) }),
  test: (ctx: Ctx, id: string) => queryOptions({ queryKey: k(ctx, "test", id), queryFn: () => activitiesApi.test(id) }),
  examOptions: (ctx: Ctx) => queryOptions({ queryKey: k(ctx, "exam-options"), queryFn: () => activitiesApi.examOptions(ctx) }),
  houses: (ctx: Ctx) => queryOptions({ queryKey: k(ctx, "houses"), queryFn: () => activitiesApi.houses(ctx), enabled: ctx.campus !== "ALL" }),
  members: (ctx: Ctx, q: ActivitiesMembersQuery) =>
    queryOptions({ queryKey: k(ctx, "members", q.houseId ?? "", q.classSection ?? "", q.q ?? ""), queryFn: () => activitiesApi.members(ctx, q), enabled: ctx.campus !== "ALL" }),
  events: (ctx: Ctx) => queryOptions({ queryKey: k(ctx, "events"), queryFn: () => activitiesApi.events(ctx) }),
  event: (ctx: Ctx, id: string) => queryOptions({ queryKey: k(ctx, "event", id), queryFn: () => activitiesApi.event(id) }),
  sportsList: (ctx: Ctx, q: ActivitiesSportsListQuery = {}, enabled = true) =>
    queryOptions({
      queryKey: k(ctx, "sports-list", q.houseId ?? "", q.kind ?? "", q.classSection ?? "", [...(q.classSections ?? [])].sort().join(","), q.everyone ? "everyone" : "taking-part"),
      queryFn: () => activitiesApi.sportsList(ctx, q),
      enabled: enabled && ctx.campus !== "ALL",
    }),
  catalogue: (ctx: Ctx) => queryOptions({ queryKey: k(ctx, "catalogue"), queryFn: () => activitiesApi.catalogue(ctx) }),
  record: (ctx: Ctx, studentId: string) => queryOptions({ queryKey: k(ctx, "record", studentId), queryFn: () => activitiesApi.record(ctx, studentId), enabled: studentId !== "" }),
  certificates: (ctx: Ctx) => queryOptions({ queryKey: k(ctx, "certificates"), queryFn: () => activitiesApi.certificates(ctx) }),
};
