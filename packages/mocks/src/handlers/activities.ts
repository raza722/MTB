// Scholarships and activities — mock handlers and stores, owned by the activities feature.
// Schemes, tests and merit lists (from declared exam results or a dedicated test), awards with maker-checker
// approval and their fee effect (read-only: Fees applies it), renewal review, houses and points, events,
// co-curricular records and certificates with serial numbers.
import {
  ACTIVITIES_EVENT_KIND_LABEL,
  ACTIVITIES_CATALOG_KIND_LABEL,
  ACTIVITIES_FEE_HEADS,
  type ActivitiesAward,
  type ActivitiesAwardInput,
  type ActivitiesCandidate,
  type ActivitiesCatalogKind,
  type ActivitiesCertificate,
  type ActivitiesEventDetail,
  type ActivitiesEventInput,
  type ActivitiesEventSummary,
  type ActivitiesExamOption,
  type ActivitiesFeeEffect,
  type ActivitiesFeeHead,
  type ActivitiesFeeLine,
  type ActivitiesHeadValues,
  type ActivitiesHouse,
  type ActivitiesHouseCreateInput,
  type ActivitiesHouseInput,
  type ActivitiesHouseTone,
  type ActivitiesHouseMember,
  type ActivitiesHousesView,
  type ActivitiesIssueInput,
  type ActivitiesMark,
  type ActivitiesMeritBand,
  type ActivitiesOverview,
  type ActivitiesParticipant,
  type ActivitiesParticipantsInput,
  type ActivitiesPerson,
  type ActivitiesPointsEntry,
  type ActivitiesPointsInput,
  type ActivitiesPosition,
  type ActivitiesRecordEntry,
  type ActivitiesRecordInput,
  type ActivitiesRenewalCheck,
  type ActivitiesRenewalDecision,
  type ActivitiesResultsInput,
  type ActivitiesScheme,
  type ActivitiesSchemeInput,
  type ActivitiesSportsList,
  type ActivitiesSportsListRow,
  type ActivitiesStudentRecord,
  type ActivitiesTestAction,
  type ActivitiesTestDetail,
  type ActivitiesTestInput,
  type ActivitiesTestSummary,
  type ActivitiesTodo,
  type ActivitiesApplicantInput,
  type ActivitiesProposeOverride,
  type CampusCode,
  type CampusScope,
  type Ctx,
  type SessionUser,
} from "@mtb/api";
import { daysBetween, formatDate, formatRs, formatSession, sessionCode, type IsoDate } from "@mtb/domain";
import { http, type HttpHandler } from "msw";
import { CURRENT_SESSION, DEMO_TODAY, demoNow } from "../clock";
import { createStore } from "../db";
import {
  classNo,
  initialAwards,
  initialCatalogue,
  initialEvents,
  initialHouses,
  initialManualRecords,
  initialPoints,
  initialSchemes,
  initialTests,
  initialVenues,
  startingHouse,
  type AwardRecord,
  type CandidateRecord,
  type CertificateRecord,
  type EventRecord,
  type HouseRecord,
  type ManualRecord,
  type ParticipantRecord,
  type PointsRecord,
  type RankedPerson,
  type SchemeRecord,
  type TestRecord,
  type VenueRecord,
} from "../fixtures/activities";
import { addDays, ALL_SECTIONS, pastMark, registerSections, rosterFor, SESSION_DATES } from "../fixtures/attendance";
import { campusName, tuitionFor } from "../fixtures/campuses";
import { staffOf } from "../fixtures/reports";
import { findStudent, STUDENTS } from "../fixtures/students";
import { ctxFrom, fail, HttpResponse, latency, requirePermission } from "../util";
import { admissionApplicants } from "./admissions-model";
import { closedOn } from "./attendance-model";
import { examRows, examsStore } from "./exams-model";

// ---------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------

const CAMPUSES: CampusCode[] = ["KC", "SM", "UC", "MC", "HC"];
const newId = (p: string) => `${p}-${Math.random().toString(36).slice(2, 10)}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const round1 = (n: number) => Math.round(n * 10) / 10;
const ORD = ["", "1st", "2nd", "3rd"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (iso: IsoDate) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const monthIndex = (iso: IsoDate) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
const sessionOf = (session: number) => SESSION_DATES[session] ?? { starts: `${session}-04-01`, ends: `${session + 1}-03-31` };
const thisMonthStart = `${DEMO_TODAY.slice(0, 7)}-01`;
const nextMonthStart = (() => {
  const m = monthIndex(DEMO_TODAY) + 1;
  return `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}-01`;
})();

const inCtx = (ctx: Ctx, r: { campus: CampusCode; session: number }) => r.session === ctx.session && (ctx.campus === "ALL" || r.campus === ctx.campus);

function readOnly(session: number): Response | null {
  return session !== CURRENT_SESSION ? fail(409, "SESSION_READ_ONLY", `${formatSession(session)} is closed and read-only. Switch to ${formatSession(CURRENT_SESSION)} to make changes.`) : null;
}

function singleCampus(campus: CampusScope, what: string): Response | null {
  return campus === "ALL" ? fail(422, "CHOOSE_CAMPUS", `Choose a campus first: ${what} always belong to one campus.`) : null;
}

const body = async <T,>(request: Request): Promise<T> => ((await request.json().catch(() => ({}))) ?? {}) as T;

// ---------------------------------------------------------------------------------------------------------
// People (fixture students, register classmates, test applicants)
// ---------------------------------------------------------------------------------------------------------

const GEN_RE = /^(KC|SM|UC|MC|HC)-3(\d{2})(\d{2})$/;

interface Found {
  id: string;
  name: string;
  father: string;
  classSection: string;
  campus: CampusCode;
  hasProfile: boolean;
  isApplicant: boolean;
  gender?: "F" | "M";
  previousSchool?: string | null;
  /** An application in Admissions (not a scholarship-test registration). */
  admission?: boolean;
}

/** An admission application of this session that hasn't been admitted or withdrawn, by application number. */
function admissionApplicant(id: string): Found | null {
  for (const campus of CAMPUSES) {
    const a = admissionApplicants(campus, CURRENT_SESSION).find((x) => x.applicationNo.toUpperCase() === id && x.stage !== "ADMITTED" && x.stage !== "WITHDRAWN");
    if (a) return { id: a.applicationNo, name: a.name, father: a.father, classSection: a.classApplied, campus, hasProfile: false, isApplicant: true, gender: a.gender, previousSchool: a.previousSchool ?? null, admission: true };
  }
  return null;
}

function findPerson(id: string): Found | null {
  const key = id.trim().toUpperCase();
  const s = findStudent(key);
  if (s) return { id: s.grNo, name: s.name, father: s.father, classSection: s.classSection, campus: s.campus, hasProfile: true, isApplicant: false };
  const m = GEN_RE.exec(key);
  if (m) {
    const campus = m[1] as CampusCode;
    const cs = ALL_SECTIONS[Number(m[2])];
    const e = cs ? rosterFor(campus, cs).find((x) => x.grNo === key) : undefined;
    if (e && cs) return { id: e.grNo, name: e.name, father: e.father, classSection: cs, campus, hasProfile: false, isApplicant: false };
  }
  for (const t of testsStore.get()) {
    const c = t.candidates.find((x) => x.id === key && !x.studentId);
    if (c) return { id: c.id, name: c.name, father: c.father, classSection: c.classSection, campus: t.campus, hasProfile: false, isApplicant: true, previousSchool: c.previousSchool };
  }
  return admissionApplicant(key);
}

/** Boy or girl: from the student's record or the application, else from the first name. */
function genderOf(id: string, name: string): "F" | "M" {
  const s = findStudent(id);
  if (s) return s.gender;
  const a = admissionApplicant(id.toUpperCase());
  if (a?.gender) return a.gender;
  return relationOf(id, name) === "d/o" ? "F" : "M";
}

/** Everyone on a campus's registers, plus fixture students whose class has no register today. */
function campusStudents(campus: CampusCode) {
  const sections = new Set(registerSections(campus));
  STUDENTS.filter((s) => s.campus === campus && s.status === "ACTIVE").forEach((s) => sections.add(s.classSection));
  return [...sections].sort((a, b) => classNo(a) - classNo(b) || a.localeCompare(b)).flatMap((cs) => rosterFor(campus, cs).map((e) => ({ ...e, classSection: cs })));
}

// ---------------------------------------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------------------------------------

interface Membership {
  houseId: string | null;
  since: IsoDate;
  history: Array<{ houseId: string; from: IsoDate; to: IsoDate }>;
}

const schemesStore = createStore<SchemeRecord[]>("activities-schemes", initialSchemes);
const housesStore = createStore<HouseRecord[]>("activities-houses", initialHouses);
const membershipStore = createStore<Record<string, Membership>>("activities-members", () => ({}));
const testsStore = createStore<TestRecord[]>("activities-tests", initialTests);
const eventsStore = createStore<EventRecord[]>("activities-events", () => initialEvents((campus, id) => houseOf(campus, id).houseId));
const pointsStore = createStore<PointsRecord[]>("activities-points", () => [...initialPoints(), ...eventsStore.get().flatMap(eventLedger)]);
const awardsStore = createStore<AwardRecord[]>("activities-awards", () => initialAwards(topOf));
const certsStore = createStore<CertificateRecord[]>("activities-certificates", initialCertificates);
const catalogueStore = createStore("activities-catalogue", initialCatalogue);
const venuesStore = createStore<VenueRecord[]>("activities-venues", initialVenues);
const recordsStore = createStore<ManualRecord[]>("activities-records", initialManualRecords);

function houseOf(campus: CampusCode, id: string): { houseId: string | null; since: IsoDate; history: Membership["history"] } {
  const m = membershipStore.get()[id];
  if (m) return m;
  // Starting houses come from the campus's original houses only, so adding a house never reshuffles anyone.
  const all = housesStore.get();
  const start = startingHouse(campus, id, all.filter((h) => !h.added));
  const retired = start.houseId && all.find((h) => h.id === start.houseId)?.active === false;
  return { ...start, ...(retired ? { houseId: null } : {}), history: [] };
}

const isActive = (h: HouseRecord) => h.active !== false;

const houseName = (houseId: string | null) => (houseId ? (housesStore.get().find((h) => h.id === houseId)?.name ?? null) : null);

/** Girls' first names used by the register fixtures (fixture students carry their own relation). */
const GIRL_FIRST = new Set(
  "Hania Aiza Minahil Alishba Abeera Haleema Mishal Rameen Arfa Dua Sehar Javeria Maheen Iqra Komal Rabia Shiza Tayyaba Umaima Wajiha Hira Maryam Zoya Mahnoor Laiba Eman Aleena Hafsa Anaya Noor Sana Rida Amna Khadija Ayesha Fatima Zainab Areeba Mariam Sara".split(" "),
);

function relationOf(id: string, name: string): "s/o" | "d/o" {
  const s = findStudent(id);
  if (s) return s.relation === "d/o" ? "d/o" : "s/o";
  return GIRL_FIRST.has(name.split(" ")[0] ?? "") ? "d/o" : "s/o";
}

function toPerson(f: Found): ActivitiesPerson {
  return { id: f.id, name: f.name, father: f.father, relation: relationOf(f.id, f.name), classSection: f.classSection, campus: f.campus, house: f.isApplicant ? null : houseName(houseOf(f.campus, f.id).houseId), hasProfile: f.hasProfile };
}

// ---------------------------------------------------------------------------------------------------------
// Exams: merit order and latest results (read from the exams module's store)
// ---------------------------------------------------------------------------------------------------------

function topOf(examId: string, n: number): RankedPerson[] {
  const e = examsStore.get().find((x) => x.id === examId);
  if (!e) return [];
  const rows = examRows(e)
    .filter((r) => r.percent !== null && !r.withheld)
    .sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0) || a.name.localeCompare(b.name));
  const out: RankedPerson[] = [];
  rows.forEach((r, i) => {
    const prev = out[i - 1];
    const rank = prev && prev.percent === round1(r.percent ?? 0) ? prev.rank : i + 1;
    out.push({ id: r.id, name: r.name, father: r.father ?? "", classSection: r.classSection, percent: round1(r.percent ?? 0), rank, hasProfile: r.hasProfile });
  });
  return out.slice(0, n);
}

function latestResult(campus: CampusCode, session: number, id: string): { exam: string; percent: number } | null {
  const exams = examsStore
    .get()
    .filter((e) => e.status === "DECLARED" && e.campus === campus && e.session === session && e.category !== "ENTRANCE" && e.roster.some((p) => p.id === id))
    .sort((a, b) => (b.declaredOn ?? "").localeCompare(a.declaredOn ?? ""));
  for (const e of exams) {
    const row = examRows(e).find((r) => r.id === id);
    if (row && row.percent !== null) return { exam: `${e.name}${e.classes.length ? ` (${e.classes[0]!.split("-")[0]})` : ""}`, percent: round1(row.percent) };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// Attendance % this session (from the attendance registers)
// ---------------------------------------------------------------------------------------------------------

const schoolDayCache = new Map<CampusCode, IsoDate[]>();

function schoolDays(campus: CampusCode): IsoDate[] {
  const hit = schoolDayCache.get(campus);
  if (hit) return hit;
  const out: IsoDate[] = [];
  const end = addDays(DEMO_TODAY, -1);
  for (let d = sessionOf(CURRENT_SESSION).starts; d <= end; d = addDays(d, 1)) if (!closedOn(campus, d)) out.push(d);
  schoolDayCache.set(campus, out);
  return out;
}

function attendanceOf(campus: CampusCode, id: string, classSection: string): number | null {
  const e = rosterFor(campus, classSection).find((x) => x.grNo === id);
  if (!e) return null;
  const days = schoolDays(campus);
  if (days.length === 0) return null;
  const attended = days.filter((d) => {
    const c = pastMark(e, d);
    return c === "P" || c === "LT";
  }).length;
  return round1((attended / days.length) * 100);
}

// ---------------------------------------------------------------------------------------------------------
// Awards: value text, fee effect and renewal check
// ---------------------------------------------------------------------------------------------------------

const ANNUAL_CHARGES = 3000;
const ADMISSION_FEE = 15000;

const classShortOf = (cs: string) => {
  const m = /(\d+)/.exec(cs);
  if (cs.startsWith("Prep")) return "Prep";
  return m ? m[1]! : "7";
};

function headsText(heads: ActivitiesFeeHead[]) {
  const words = ACTIVITIES_FEE_HEADS.filter((h) => heads.includes(h)).map((h) => (h === "TUITION" ? "tuition" : h === "ANNUAL" ? "annual charges" : "admission fee"));
  return words.length <= 1 ? (words[0] ?? "tuition") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** The % taken off one head: its own figure when the award gives each head a different %. */
const headValue = (a: { value: number; values?: ActivitiesHeadValues | undefined }, head: ActivitiesFeeHead) => a.values?.[head] ?? a.value;

function valueText(scheme: { basis: SchemeRecord["basis"] }, value: number, heads: ActivitiesFeeHead[], values?: ActivitiesHeadValues) {
  if (scheme.basis === "FIXED") return `${formatRs(value)} a month off tuition`;
  const ordered = ACTIVITIES_FEE_HEADS.filter((h) => heads.includes(h));
  const per = ordered.map((h) => values?.[h] ?? value);
  if (per.every((v) => v === per[0])) return `${per[0] ?? value}% off ${headsText(heads)}`;
  // "100% tuition, 50% annual charges"
  return ordered.map((h, i) => `${per[i]}% ${h === "TUITION" ? "tuition" : h === "ANNUAL" ? "annual charges" : "admission fee"}`).join(", ");
}

interface EffectInput {
  classSection: string;
  isApplicant: boolean;
  value: number;
  values?: ActivitiesHeadValues | undefined;
  feeHeads: ActivitiesFeeHead[];
  effectiveFrom: IsoDate;
  effectiveTo: IsoDate;
  status: AwardRecord["status"];
  endedOn?: IsoDate | undefined;
  session: number;
}

function feeEffect(a: EffectInput, scheme: SchemeRecord): ActivitiesFeeEffect {
  const tuition = tuitionFor(classShortOf(a.classSection));
  // Each head: after = fee − round(fee × that head's % / 100).
  const pct = (amount: number, head: ActivitiesFeeHead) => Math.min(amount, Math.round((amount * headValue(a, head)) / 100));
  const lines: ActivitiesFeeLine[] = [];
  const heads = scheme.basis === "FIXED" ? (["TUITION"] as ActivitiesFeeHead[]) : ACTIVITIES_FEE_HEADS.filter((h) => a.feeHeads.includes(h));
  for (const head of heads) {
    if (head === "TUITION") lines.push({ head, label: "Tuition fee", per: "month", before: tuition, after: tuition - (scheme.basis === "FIXED" ? Math.min(a.value, tuition) : pct(tuition, head)) });
    if (head === "ANNUAL") lines.push({ head, label: "Annual charges", per: "year", before: ANNUAL_CHARGES, after: ANNUAL_CHARGES - pct(ANNUAL_CHARGES, head) });
    if (head === "ADMISSION" && a.isApplicant) lines.push({ head, label: "Admission fee", per: "once", before: ADMISSION_FEE, after: ADMISSION_FEE - pct(ADMISSION_FEE, head) });
  }
  const monthly = lines.filter((l) => l.per === "month").reduce((s, l) => s + (l.before - l.after), 0);
  const last = a.status === "ENDED" && a.endedOn ? a.endedOn : a.effectiveTo;
  const months = a.status === "REJECTED" ? 0 : Math.max(0, monthIndex(last) - monthIndex(a.effectiveFrom) + 1);
  const annualDue = `${a.session}-09-15`;
  const annualOff = a.status !== "REJECTED" && a.effectiveFrom <= annualDue ? lines.filter((l) => l.per === "year").reduce((s, l) => s + (l.before - l.after), 0) : 0;
  const admissionOff = a.status !== "REJECTED" ? lines.filter((l) => l.per === "once").reduce((s, l) => s + (l.before - l.after), 0) : 0;
  const firstVoucher = monthLabel(a.effectiveFrom);
  const annualNote = lines.some((l) => l.per === "year") && a.effectiveFrom > annualDue ? ` This session's annual charges were billed on ${formatDate(annualDue)}, so relief on them starts next session.` : "";
  const note =
    a.status === "PENDING"
      ? `Applies once approved: ${formatRs(monthly)} off each tuition voucher from ${firstVoucher}.${annualNote}`
      : a.status === "APPROVED"
        ? `The fees office applies this from the ${firstVoucher} voucher. Vouchers already issued are not changed.${annualNote}`
        : a.status === "REJECTED"
          ? "Not applied: the award was rejected."
          : `Ended on ${formatDate(a.endedOn ?? a.effectiveTo)}: no relief after ${monthLabel(a.endedOn ?? a.effectiveTo)}.`;
  return { lines, monthly, session: monthly * months + annualOff + admissionOff, months, firstVoucher, note };
}

function renewalCheck(a: AwardRecord, scheme: SchemeRecord): ActivitiesRenewalCheck | null {
  if (a.status !== "APPROVED") return null;
  const stored = a.renewal ? { decision: a.renewal.decision, decidedBy: a.renewal.decidedBy, decidedAt: a.renewal.decidedAt, ...(a.renewal.newValue !== undefined ? { newValue: a.renewal.newValue } : {}), ...(a.renewal.note ? { note: a.renewal.note } : {}) } : {};
  const r = scheme.renewal;
  if (a.session !== CURRENT_SESSION) return { outcome: "MEETS", checks: [], latestResult: null, attendancePercent: null, ...stored };
  const latest = a.isApplicant ? null : latestResult(a.campus, a.session, a.studentId);
  const att = a.isApplicant ? null : attendanceOf(a.campus, a.studentId, a.classSection);
  const checks: ActivitiesRenewalCheck["checks"] = [];
  let close = false;
  if (r.minResultPercent !== null) {
    if (latest) {
      checks.push({ label: `Result at least ${r.minResultPercent}%`, ok: latest.percent >= r.minResultPercent, detail: `${latest.exam}: ${latest.percent.toFixed(1)}%` });
      if (latest.percent >= r.minResultPercent && latest.percent < r.minResultPercent + 3) close = true;
    } else checks.push({ label: `Result at least ${r.minResultPercent}%`, ok: true, detail: "No declared result yet this session; checked again on the annual result." });
  }
  if (r.minAttendancePercent !== null) {
    if (att !== null) {
      checks.push({ label: `Attendance at least ${r.minAttendancePercent}%`, ok: att >= r.minAttendancePercent, detail: `${att.toFixed(1)}% of school days this session` });
      if (att >= r.minAttendancePercent && att < r.minAttendancePercent + 2) close = true;
    } else checks.push({ label: `Attendance at least ${r.minAttendancePercent}%`, ok: true, detail: "Not on a register yet." });
  }
  if (r.note) checks.push({ label: "Also", ok: true, detail: r.note });
  const numeric = r.minResultPercent !== null || r.minAttendancePercent !== null;
  const outcome = !numeric ? "AUTOMATIC" : checks.some((c) => !c.ok) ? "NOT_MET" : close ? "AT_RISK" : "MEETS";
  return { outcome, checks, latestResult: latest, attendancePercent: att, ...stored };
}

const schemeOf = (id: string) => schemesStore.get().find((s) => s.id === id);

function toAward(a: AwardRecord): ActivitiesAward {
  const scheme = schemeOf(a.schemeId) ?? initialSchemes()[0]!;
  const test = a.testId ? testsStore.get().find((t) => t.id === a.testId) : undefined;
  return {
    id: a.id,
    awardNo: a.awardNo,
    campus: a.campus,
    session: a.session,
    studentId: a.studentId,
    studentName: a.studentName,
    father: a.father,
    relation: relationOf(a.studentId, a.studentName),
    classSection: a.classSection,
    isApplicant: a.isApplicant,
    hasProfile: a.hasProfile,
    schemeId: a.schemeId,
    schemeName: scheme.name,
    kind: scheme.kind,
    basis: scheme.basis,
    value: a.value,
    feeHeads: a.feeHeads,
    valueText: valueText(scheme, a.value, a.feeHeads, a.values),
    ...(a.values && Object.keys(a.values).length ? { values: a.values } : {}),
    gender: a.gender ?? genderOf(a.studentId, a.studentName),
    previousSchool: a.previousSchool ?? a.application?.previousSchool ?? (test?.candidates.find((c) => c.id === a.studentId)?.previousSchool ?? null),
    ...(a.application ? { application: { ...a.application, ...(a.application.staffParentId ? { staffParentName: staffName(a.campus, a.application.staffParentId) } : {}) } } : {}),
    ...(a.listRound ? { listRound: a.listRound } : {}),
    ...(a.testId ? { testId: a.testId } : {}),
    ...(test ? { testTitle: `${test.testNo} · ${test.title}` } : {}),
    ...(a.rank !== undefined ? { rank: a.rank } : {}),
    ...(a.percent !== undefined ? { percent: a.percent } : {}),
    reason: a.reason,
    evidence: a.evidence,
    effectiveFrom: a.effectiveFrom,
    effectiveTo: a.effectiveTo,
    status: a.status,
    proposedBy: a.proposedBy,
    proposedAt: a.proposedAt,
    ...(a.decidedBy ? { decidedBy: a.decidedBy } : {}),
    ...(a.decidedAt ? { decidedAt: a.decidedAt } : {}),
    ...(a.decisionNote ? { decisionNote: a.decisionNote } : {}),
    ...(a.endedOn ? { endedOn: a.endedOn } : {}),
    ...(a.endReason ? { endReason: a.endReason } : {}),
    feeEffect: feeEffect(a, scheme),
    renewal: renewalCheck(a, scheme),
    history: a.history,
  };
}

function nextAwardNo(campus: CampusCode, session: number) {
  const prefix = `SCH-${campus}-${sessionCode(session)}-`;
  const max = awardsStore
    .get()
    .filter((a) => a.awardNo.startsWith(prefix))
    .reduce((m, a) => Math.max(m, Number(a.awardNo.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

/** Name of a member of staff (for a staff-child concession). */
function staffName(campus: CampusCode, id: string): string {
  return staffOf(campus).find((s) => s.id === id)?.name ?? id;
}

/** % of the tuition an award takes off (fixed amounts converted). */
function tuitionPercent(a: { classSection: string; value: number; values?: ActivitiesHeadValues | undefined; feeHeads: ActivitiesFeeHead[] }, scheme: SchemeRecord) {
  if (scheme.basis === "PERCENT") return a.feeHeads.includes("TUITION") ? headValue(a, "TUITION") : 0;
  return (Math.min(a.value, tuitionFor(classShortOf(a.classSection))) / tuitionFor(classShortOf(a.classSection))) * 100;
}

function updateAward(id: string, fn: (a: AwardRecord) => AwardRecord): AwardRecord | undefined {
  let out: AwardRecord | undefined;
  awardsStore.set((list) => list.map((a) => (a.id === id ? (out = fn(a)) : a)));
  return out;
}

const log = (by: string, action: string, detail?: string) => ({ id: newId("h"), at: demoNow(), by, action, ...(detail ? { detail } : {}) });

// ---------------------------------------------------------------------------------------------------------
// Tests and merit lists
// ---------------------------------------------------------------------------------------------------------

interface Base {
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
  percent: number | null;
}

function testPapers(t: TestRecord) {
  if (t.source === "DEDICATED") return t.papers;
  const e = examsStore.get().find((x) => x.id === t.examId);
  return (e?.subjects ?? []).map((s) => ({ id: s.id, name: s.name, maxMarks: s.maxMarks }));
}

function testBase(t: TestRecord): Base[] {
  if (t.source === "EXAM") {
    const e = examsStore.get().find((x) => x.id === t.examId);
    if (!e) return [];
    return examRows(e).map((r) => ({
      id: r.id,
      rollNo: r.rollNo,
      name: r.name,
      father: r.father ?? "",
      classSection: r.classSection,
      isApplicant: false,
      previousSchool: null,
      gender: genderOf(r.id, r.name),
      hasProfile: r.hasProfile,
      marks: Object.fromEntries(Object.entries(r.marks).map(([k, v]) => [k, v === "L" ? "A" : v])) as Record<string, ActivitiesMark>,
      obtained: r.obtained,
      percent: r.withheld || r.percent === null ? null : round1(r.percent),
    }));
  }
  const max = t.papers.reduce((s, p) => s + p.maxMarks, 0) || 1;
  return t.candidates.map((c: CandidateRecord, i) => {
    const vals = t.papers.map((p) => c.marks[p.id] ?? null);
    const complete = vals.every((v) => v !== null);
    const obtained = vals.reduce<number>((s, v) => s + (typeof v === "number" ? v : 0), 0);
    return { id: c.id, rollNo: i + 1, name: c.name, father: c.father, classSection: c.classSection, isApplicant: !c.studentId, previousSchool: c.previousSchool, gender: genderOf(c.studentId ?? c.id, c.name), hasProfile: c.hasProfile, marks: c.marks, obtained, percent: complete ? round1((obtained / max) * 100) : null };
  });
}

/** Classes a merit band can be limited to. */
const MERIT_CLASSES = ["Prep", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];

/** The bands that apply to a candidate: their class's own bands when the scheme has any, else the every-class bands. */
function bandsFor(scheme: SchemeRecord | undefined, classSection: string, classLabel: string): ActivitiesMeritBand[] {
  const all = scheme?.meritBands ?? [];
  const cls = /^(Prep|\d+)-/.exec(classSection)?.[1] ?? /Class(?:es)? (Prep|\d+)/.exec(classLabel)?.[1] ?? "";
  const own = cls ? all.filter((x) => x.classShort === cls) : [];
  return own.length ? own : all.filter((x) => !x.classShort);
}

function testCandidates(t: TestRecord): { candidates: ActivitiesCandidate[]; tiedAtCutOff: number } {
  const scheme = schemeOf(t.schemeId);
  const base = testBase(t);
  const ranked = base.filter((b) => b.percent !== null).sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0));
  const rank = new Map<string, number>();
  ranked.forEach((b, i) => {
    const prev = ranked[i - 1];
    rank.set(b.id, prev && prev.percent === b.percent ? rank.get(prev.id)! : i + 1);
  });
  const awards = awardsStore.get().filter((a) => a.testId === t.id && a.status !== "REJECTED");
  const candidates = base
    .map((b): ActivitiesCandidate => {
      const r = rank.get(b.id) ?? null;
      const qualifies = b.percent !== null && b.percent >= t.passPercent;
      const withinSeats = qualifies && (t.seats === null || (r !== null && r <= t.seats));
      const bands = bandsFor(scheme, b.classSection, t.classLabel);
      const band = bands.find((x) => b.percent !== null && b.percent >= x.fromPercent && b.percent <= x.toPercent + 0.0001);
      // Below every band but above the pass mark: the lowest band's figure.
      const suggested = !qualifies ? null : scheme && bands.length > 0 ? (band?.value ?? Math.min(...bands.map((x) => x.value))) : (scheme?.value ?? null);
      const award = awards.find((a) => a.studentId === b.id);
      return { ...b, rank: r, qualifies, withinSeats, suggestedValue: suggested, awardId: award?.id ?? null, awardStatus: award?.status ?? null };
    })
    .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999) || a.classSection.localeCompare(b.classSection) || a.name.localeCompare(b.name));
  const inside = candidates.filter((c) => c.withinSeats).length;
  return { candidates, tiedAtCutOff: t.seats !== null ? Math.max(0, inside - t.seats) : 0 };
}

function toTestSummary(t: TestRecord, computed = testCandidates(t)): ActivitiesTestSummary {
  const papers = testPapers(t);
  const e = t.examId ? examsStore.get().find((x) => x.id === t.examId) : undefined;
  return {
    id: t.id,
    testNo: t.testNo,
    title: t.title,
    campus: t.campus,
    session: t.session,
    source: t.source,
    examId: t.examId,
    examName: e ? `${e.name} · ${e.classes.join(", ")}` : null,
    classLabel: t.classLabel,
    schemeId: t.schemeId,
    schemeName: schemeOf(t.schemeId)?.name ?? "",
    schemeBasis: schemeOf(t.schemeId)?.basis ?? "PERCENT",
    date: t.date,
    venue: t.venue,
    papers,
    maxMarks: papers.reduce((s, p) => s + p.maxMarks, 0),
    seats: t.seats,
    passPercent: t.passPercent,
    status: t.status,
    candidateCount: computed.candidates.length,
    marked: computed.candidates.filter((c) => c.percent !== null).length,
    qualified: computed.candidates.filter((c) => c.qualifies).length,
    proposed: computed.candidates.filter((c) => c.awardId).length,
  };
}

function toTestDetail(t: TestRecord): ActivitiesTestDetail {
  const computed = testCandidates(t);
  return { ...toTestSummary(t, computed), candidates: computed.candidates, tiedAtCutOff: computed.tiedAtCutOff, history: t.history };
}

function updateTest(id: string, fn: (t: TestRecord) => TestRecord): TestRecord | undefined {
  let out: TestRecord | undefined;
  testsStore.set((list) => list.map((t) => (t.id === id ? (out = fn(t)) : t)));
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Houses and points
// ---------------------------------------------------------------------------------------------------------

/** One ledger line per house for an event's results: places plus taking part. */
function eventLedger(ev: EventRecord): PointsRecord[] {
  if (!ev.houseEvent || ev.status !== "DONE") return [];
  const byHouse = new Map<string, { pts: number; firsts: number; seconds: number; thirds: number; took: number }>();
  for (const p of ev.participants) {
    if (!p.houseId) continue;
    const x = byHouse.get(p.houseId) ?? { pts: 0, firsts: 0, seconds: 0, thirds: 0, took: 0 };
    if (p.role !== "VOLUNTEER") {
      x.took++;
      x.pts += ev.pointsRule.participation;
    }
    if (p.position === 1) (x.pts += ev.pointsRule.first), x.firsts++;
    if (p.position === 2) (x.pts += ev.pointsRule.second), x.seconds++;
    if (p.position === 3) (x.pts += ev.pointsRule.third), x.thirds++;
    byHouse.set(p.houseId, x);
  }
  return [...byHouse.entries()]
    .filter(([, x]) => x.pts !== 0)
    .map(([houseId, x]) => {
      const places = [x.firsts && `${x.firsts} × 1st`, x.seconds && `${x.seconds} × 2nd`, x.thirds && `${x.thirds} × 3rd`].filter(Boolean).join(", ");
      return {
        id: `pt-${ev.id}-${houseId}`,
        campus: ev.campus,
        session: ev.session,
        houseId,
        date: ev.date,
        points: x.pts,
        category: "EVENT" as const,
        reason: `${ev.title}: ${places ? `${places}; ` : ""}${plural(x.took, "student")} took part`,
        eventId: ev.id,
        by: ev.inCharge[0] ?? "Events office",
      };
    });
}

function toLedger(p: PointsRecord): ActivitiesPointsEntry {
  return { id: p.id, houseId: p.houseId, houseName: houseName(p.houseId) ?? p.houseId, date: p.date, points: p.points, category: p.category, reason: p.reason, eventId: p.eventId, by: p.by };
}

function housesView(campus: CampusCode, session: number): ActivitiesHousesView {
  const houses = housesStore.get().filter((h) => h.campus === campus);
  const ledger = pointsStore
    .get()
    .filter((p) => p.campus === campus && p.session === session)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const students = campusStudents(campus);
  const count = new Map<string, number>();
  let unassigned = 0;
  for (const s of students) {
    const h = houseOf(campus, s.grNo).houseId;
    if (h) count.set(h, (count.get(h) ?? 0) + 1);
    else unassigned++;
  }
  const wins = new Map<string, number>();
  eventsStore
    .get()
    .filter((e) => e.campus === campus && e.session === session && e.status === "DONE")
    .forEach((e) => e.participants.forEach((p) => p.position === 1 && p.houseId && wins.set(p.houseId, (wins.get(p.houseId) ?? 0) + 1)));
  const totals = houses.map((h) => ({ h, points: ledger.filter((p) => p.houseId === h.id).reduce((s, p) => s + p.points, 0) }));
  // Retired houses keep their points in the history but take no place in the standings.
  const sorted = totals.filter((x) => isActive(x.h)).sort((a, b) => b.points - a.points);
  const lead = (id: string | null) => {
    if (!id) return null;
    const f = findPerson(id);
    return f ? { id: f.id, name: f.name, classSection: f.classSection } : null;
  };
  const view: ActivitiesHouse[] = totals.map(({ h, points }) => ({
    id: h.id,
    campus: h.campus,
    name: h.name,
    nameUrdu: h.nameUrdu,
    motto: h.motto,
    tone: h.tone,
    houseMaster: h.houseMaster,
    assistantMaster: h.assistantMaster,
    captain: lead(h.captainId),
    viceCaptain: lead(h.viceCaptainId),
    members: count.get(h.id) ?? 0,
    points,
    rank: isActive(h) ? sorted.findIndex((x) => x.points === points) + 1 : 0,
    eventWins: wins.get(h.id) ?? 0,
    active: isActive(h),
  }));
  // Running totals at the end of each month of the session (up to this month).
  const { starts, ends } = sessionOf(session);
  const lastMonth = Math.min(monthIndex(ends), monthIndex(DEMO_TODAY));
  const monthly: ActivitiesHousesView["monthly"] = [];
  for (let m = monthIndex(starts); m <= lastMonth; m++) {
    const y = Math.floor(m / 12);
    const mm = String((m % 12) + 1).padStart(2, "0");
    const endOf = `${y}-${mm}-31`;
    monthly.push({ month: `${y}-${mm}`, totals: Object.fromEntries(houses.map((h) => [h.id, ledger.filter((p) => p.houseId === h.id && p.date <= endOf).reduce((s, p) => s + p.points, 0)])) });
  }
  return { campus, houses: view, ledger: ledger.map(toLedger), monthly, unassigned };
}

// ---------------------------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------------------------

function toParticipant(p: ParticipantRecord, ev: EventRecord): ActivitiesParticipant {
  const cert = certsStore.get().find((c) => c.eventId === ev.id && c.studentId === p.studentId && c.item === p.item);
  return {
    id: p.id,
    studentId: p.studentId,
    name: p.name,
    father: p.father,
    relation: relationOf(p.studentId, p.name),
    classSection: p.classSection,
    houseId: p.houseId,
    houseName: houseName(p.houseId),
    item: p.item,
    role: p.role,
    position: p.position,
    certificateNo: cert?.certNo ?? null,
    hasProfile: p.hasProfile,
  };
}

function toEventSummary(ev: EventRecord): ActivitiesEventSummary {
  return {
    id: ev.id,
    campus: ev.campus,
    session: ev.session,
    title: ev.title,
    titleUrdu: ev.titleUrdu,
    kind: ev.kind,
    date: ev.date,
    endDate: ev.endDate,
    time: ev.time,
    period: ev.period ?? null,
    venue: ev.venue,
    inCharge: ev.inCharge,
    forClasses: ev.forClasses,
    houseEvent: ev.houseEvent,
    items: ev.items,
    description: ev.description,
    status: ev.status,
    ...(ev.cancelReason ? { cancelReason: ev.cancelReason } : {}),
    participants: ev.participants.length,
    placed: ev.participants.filter((p) => p.position !== null).length,
    certificates: certsStore.get().filter((c) => c.eventId === ev.id).length,
  };
}

function toEventDetail(ev: EventRecord): ActivitiesEventDetail {
  return { ...toEventSummary(ev), participantsList: ev.participants.map((p) => toParticipant(p, ev)), pointsRule: ev.pointsRule, history: ev.history };
}

function updateEvent(id: string, fn: (e: EventRecord) => EventRecord): EventRecord | undefined {
  let out: EventRecord | undefined;
  eventsStore.set((list) => list.map((e) => (e.id === id ? (out = fn(e)) : e)));
  return out;
}

function checkEventInput(b: ActivitiesEventInput, campus: CampusCode, session: number): Response | null {
  const { starts, ends } = sessionOf(session);
  if (!b.title?.trim() || b.title.trim().length < 3) return fail(422, "VALIDATION", "Give the event a name, for example “Annual sports day”.", { field: "title" });
  if (!b.date || b.date < starts || b.date > ends) return fail(422, "VALIDATION", `The date must be in session ${formatSession(session)} (${formatDate(starts)} to ${formatDate(ends)}).`, { field: "date" });
  if (b.endDate && b.endDate < b.date) return fail(422, "VALIDATION", "The last day can't be before the first day.", { field: "endDate" });
  const closed = closedOn(campus, b.date);
  if (closed) return fail(422, "VALIDATION", `${formatDate(b.date)} is ${closed.name === "Sunday" ? "a Sunday" : `${closed.name}, a school holiday`}. Choose a school day.`, { field: "date" });
  if (b.period !== undefined && b.period !== null && (!Number.isInteger(b.period) || b.period < 1 || b.period > 10)) return fail(422, "VALIDATION", "The period is a lecture number from 1 to 10, or leave it empty.", { field: "period" });
  if (!b.venue?.trim()) return fail(422, "VALIDATION", "Choose where it takes place.", { field: "venue" });
  if (!b.inCharge?.length || b.inCharge.some((x) => !x.trim())) return fail(422, "VALIDATION", "Name at least one teacher in charge.", { field: "inCharge" });
  if (!b.items?.length || b.items.some((x) => !x.trim())) return fail(422, "VALIDATION", "Add at least one item, for example “100 m race” or “English debate”.", { field: "items" });
  if (new Set(b.items.map((x) => x.trim().toLowerCase())).size !== b.items.length) return fail(422, "VALIDATION", "Each item can be listed once.", { field: "items" });
  const r = b.pointsRule;
  if (!r || [r.first, r.second, r.third, r.participation].some((v) => !Number.isInteger(v) || v < 0 || v > 50)) return fail(422, "VALIDATION", "House points must be whole numbers from 0 to 50.", { field: "pointsRule" });
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// Certificates
// ---------------------------------------------------------------------------------------------------------

function certWording(type: CertificateRecord["type"], o: { item: string | null; position: ActivitiesPosition | null; eventTitle: string; eventDate: IsoDate | null; role?: string | null }) {
  const on = o.eventDate ? ` held on ${formatDate(o.eventDate)}` : "";
  if (type === "MERIT") return `for winning ${ORD[o.position ?? 1]} place in ${o.item ?? "the competition"} at the ${o.eventTitle}${on}.`;
  if (type === "PARTICIPATION") return `for taking part in ${o.item ?? "the event"} at the ${o.eventTitle}${on}.`;
  if (type === "APPRECIATION") return `in appreciation of ${o.eventTitle.charAt(0).toLowerCase()}${o.eventTitle.slice(1)}.`;
  return o.eventTitle;
}

function nextCertNo(campus: CampusCode, session: number, list: CertificateRecord[]) {
  const prefix = `${campus}-CRT-${sessionCode(session)}-`;
  const max = list.filter((c) => c.certNo.startsWith(prefix)).reduce((m, c) => Math.max(m, Number(c.certNo.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(6, "0")}`;
}

function initialCertificates(): CertificateRecord[] {
  const out: CertificateRecord[] = [];
  const plan: Array<[string, CertificateRecord["type"], IsoDate, string]> = [
    ["ev-kc-indep", "PARTICIPATION", "2026-08-20", "Ms Hina Javed"],
    ["ev-kc-indep", "MERIT", "2026-08-20", "Ms Hina Javed"],
    ["ev-kc-defence", "MERIT", "2026-09-10", "Mr Adeel Anwar"],
    ["ev-kc-debate", "MERIT", "2026-10-05", "Mrs Sadia Rehman"],
    ["ev-kc-spell", "MERIT", "2026-10-26", "Ms Sana Tariq"],
    ["ev-kc-sports-2526", "MERIT", "2025-12-02", "Mrs Sadia Rehman"],
  ];
  const events = eventsStore.get();
  for (const [eventId, type, issuedOn, by] of plan) {
    const ev = events.find((e) => e.id === eventId);
    if (!ev) continue;
    const people = ev.participants.filter((p) => (type === "MERIT" ? p.position !== null : p.position === null && p.role !== "VOLUNTEER"));
    for (const p of people) {
      out.push({
        id: newId("crt"),
        certNo: nextCertNo(ev.campus, ev.session, out),
        campus: ev.campus,
        session: ev.session,
        type,
        studentId: p.studentId,
        studentName: p.name,
        father: p.father,
        classSection: p.classSection,
        houseName: houseName(p.houseId),
        eventId: ev.id,
        eventTitle: ev.title,
        eventDate: ev.date,
        item: p.item,
        role: p.role,
        position: p.position,
        wording: certWording(type, { item: p.item, position: p.position, eventTitle: ev.title, eventDate: ev.date }),
        issuedOn,
        issuedBy: by,
        prints: 1,
      });
    }
  }
  return out;
}

const toCert = (c: CertificateRecord): ActivitiesCertificate => ({ ...c, relation: relationOf(c.studentId, c.studentName) });

// ---------------------------------------------------------------------------------------------------------
// Co-curricular record
// ---------------------------------------------------------------------------------------------------------

function studentRecord(id: string): ActivitiesStudentRecord | null {
  const f = findPerson(id);
  if (!f || f.isApplicant) return null;
  const mem = houseOf(f.campus, f.id);
  const houseHistory: ActivitiesStudentRecord["houseHistory"] = [
    ...mem.history.map((x) => ({ houseName: houseName(x.houseId) ?? x.houseId, from: x.from, to: x.to as IsoDate | null })),
    ...(mem.houseId ? [{ houseName: houseName(mem.houseId) ?? mem.houseId, from: mem.since, to: null }] : []),
  ];
  const entries: ActivitiesRecordEntry[] = [];
  for (const ev of eventsStore.get()) {
    if (ev.status === "CANCELLED") continue;
    for (const p of ev.participants.filter((x) => x.studentId === f.id)) {
      const pts = ev.houseEvent && ev.status === "DONE" ? (p.role === "VOLUNTEER" ? 0 : ev.pointsRule.participation) + (p.position === 1 ? ev.pointsRule.first : p.position === 2 ? ev.pointsRule.second : p.position === 3 ? ev.pointsRule.third : 0) : 0;
      const cert = certsStore.get().find((c) => c.eventId === ev.id && c.studentId === f.id && c.item === p.item);
      entries.push({
        id: `${ev.id}:${p.id}`,
        date: ev.date,
        session: ev.session,
        title: ev.title,
        kindLabel: ACTIVITIES_EVENT_KIND_LABEL[ev.kind],
        item: p.item,
        role: p.role,
        position: p.position,
        achievement: ev.status !== "DONE" ? (ev.date >= DEMO_TODAY ? "Registered" : "Waiting for results") : p.position ? `${ORD[p.position]} place` : p.role === "VOLUNTEER" ? "Volunteered" : "Took part",
        source: "EVENT",
        eventId: ev.id,
        certificateNo: cert?.certNo ?? null,
        housePoints: pts,
      });
    }
  }
  for (const r of recordsStore.get().filter((x) => x.studentId === f.id)) {
    const cert = certsStore.get().find((c) => c.studentId === f.id && c.type === "APPRECIATION" && c.eventTitle === r.title);
    entries.push({ id: r.id, date: r.date, session: r.session, title: r.title, kindLabel: r.kindLabel, item: null, role: r.role, position: r.position, achievement: r.achievement, source: "MANUAL", eventId: null, certificateNo: cert?.certNo ?? null, housePoints: 0 });
  }
  entries.sort((a, b) => b.date.localeCompare(a.date));
  const awards = awardsStore
    .get()
    .filter((a) => a.studentId === f.id)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
    .map((a) => {
      const x = toAward(a);
      return { id: x.id, awardNo: x.awardNo, schemeName: x.schemeName, valueText: x.valueText, status: x.status, session: x.session, effectiveFrom: x.effectiveFrom };
    });
  const certs = certsStore.get().filter((c) => c.studentId === f.id);
  return {
    person: toPerson(f),
    houseHistory,
    entries,
    awards,
    totals: {
      events: entries.length,
      places: entries.filter((e) => e.position !== null).length,
      certificates: certs.length,
      housePoints: entries.reduce((s, e) => s + e.housePoints, 0),
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------------------------------------

function overview(ctx: Ctx): ActivitiesOverview {
  const awards = awardsStore.get().filter((a) => inCtx(ctx, a)).map(toAward);
  const approved = awards.filter((a) => a.status === "APPROVED");
  const pending = awards.filter((a) => a.status === "PENDING");
  const atRisk = approved.filter((a) => a.renewal && (a.renewal.outcome === "NOT_MET" || a.renewal.outcome === "AT_RISK") && !a.renewal.decision);
  const byScheme = new Map<string, { schemeId: string; name: string; kind: ActivitiesAward["kind"]; awards: number; monthly: number }>();
  approved.forEach((a) => {
    const x = byScheme.get(a.schemeId) ?? { schemeId: a.schemeId, name: a.schemeName, kind: a.kind, awards: 0, monthly: 0 };
    x.awards++;
    x.monthly += a.feeEffect.monthly;
    byScheme.set(a.schemeId, x);
  });
  const tests = testsStore.get().filter((t) => inCtx(ctx, t));
  const events = eventsStore.get().filter((e) => inCtx(ctx, e));
  const upcoming = events.filter((e) => e.date >= DEMO_TODAY && (e.status === "PLANNED" || e.status === "OPEN")).sort((a, b) => a.date.localeCompare(b.date));
  const todo: ActivitiesTodo[] = [];
  pending.slice(0, 6).forEach((a) =>
    todo.push({ id: `aw-${a.id}`, kind: "AWARD", title: `Approve ${a.studentName}'s ${a.schemeName.toLowerCase()}`, detail: `${a.valueText} · ${formatRs(a.feeEffect.monthly)} a month · proposed by ${a.proposedBy}`, to: "/activities/scholarships", search: { award: a.id } }),
  );
  if (atRisk.length) todo.push({ id: "renewals", kind: "RENEWAL", title: `${plural(atRisk.length, "award")} below or close to the renewal criteria`, detail: "Review before the session ends: renew, reduce or end.", to: "/activities/scholarships", search: { view: "renewals" } });
  tests
    .filter((t) => t.status === "MARKING")
    .forEach((t) => {
      const s = toTestSummary(t);
      todo.push({ id: `t-${t.id}`, kind: "TEST", title: `Enter marks: ${t.title}`, detail: `${s.marked} of ${s.candidateCount} candidates complete`, to: `/activities/tests/${t.id}` });
    });
  tests
    .filter((t) => t.status === "RESULT")
    .forEach((t) => todo.push({ id: `t-${t.id}`, kind: "TEST", title: `Propose awards: ${t.title}`, detail: `Merit list ready · ${t.seats === null ? "every qualifier" : plural(t.seats, "seat")}`, to: `/activities/tests/${t.id}` }));
  events
    .filter((e) => e.status === "OPEN" && e.date < DEMO_TODAY)
    .forEach((e) => todo.push({ id: `e-${e.id}`, kind: "EVENT", title: `Record results: ${e.title}`, detail: `Held on ${formatDate(e.date)}`, to: `/activities/events/${e.id}` }));
  upcoming
    .filter((e) => daysBetween(DEMO_TODAY, e.date) <= 7)
    .forEach((e) => todo.push({ id: `e-${e.id}`, kind: "EVENT", title: `${e.title} on ${formatDate(e.date)}`, detail: `${plural(e.participants.length, "name")} taken · ${e.venue}`, to: `/activities/events/${e.id}` }));
  const houses = ctx.campus === "ALL" ? [] : housesView(ctx.campus, ctx.session).houses.map((h) => ({ id: h.id, name: h.name, tone: h.tone, points: h.points, rank: h.rank, members: h.members }));
  return {
    awards: {
      approved: approved.length,
      pending: pending.length,
      monthlyRelief: approved.reduce((s, a) => s + a.feeEffect.monthly, 0),
      sessionRelief: approved.reduce((s, a) => s + a.feeEffect.session, 0),
      atRisk: atRisk.length,
      students: new Set(approved.map((a) => a.studentId)).size,
    },
    reliefByScheme: [...byScheme.values()].sort((a, b) => b.monthly - a.monthly),
    tests: { open: tests.filter((t) => t.status === "REGISTRATION").length, marking: tests.filter((t) => t.status === "MARKING").length, ready: tests.filter((t) => t.status === "RESULT").length },
    houses: houses.sort((a, b) => a.rank - b.rank),
    upcoming: upcoming.slice(0, 5).map(toEventSummary),
    eventsDone: events.filter((e) => e.status === "DONE").length,
    certificates: certsStore.get().filter((c) => inCtx(ctx, c)).length,
    todo,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------------------------------------

function checkScheme(b: ActivitiesSchemeInput, id?: string): Response | null {
  const name = b.name?.trim() ?? "";
  if (name.length < 3) return fail(422, "VALIDATION", "Give the scheme a name, for example “Merit scholarship”.", { field: "name" });
  if (schemesStore.get().some((s) => s.id !== id && s.name.toLowerCase() === name.toLowerCase())) return fail(422, "VALIDATION", `A scheme called “${name}” already exists.`, { field: "name" });
  if (!b.feeHeads?.length) return fail(422, "VALIDATION", "Choose at least one fee it takes money off.", { field: "feeHeads" });
  if (b.basis === "PERCENT" && (!Number.isFinite(b.value) || b.value < 1 || b.value > 100)) return fail(422, "VALIDATION", "The percentage must be from 1 to 100.", { field: "value" });
  if (b.basis === "FIXED" && (!Number.isInteger(b.value) || b.value < 100 || b.value > 20000)) return fail(422, "VALIDATION", "A fixed amount must be whole rupees from Rs 100 to Rs 20,000 a month.", { field: "value" });
  if (b.basis === "FIXED" && b.feeHeads.some((h) => h !== "TUITION")) return fail(422, "VALIDATION", "A fixed amount comes off the monthly tuition only.", { field: "feeHeads" });
  if (!b.criteria?.trim()) return fail(422, "VALIDATION", "Say who qualifies, in plain words.", { field: "criteria" });
  // Bands may be for one class; within the same class (or among the every-class bands) they must not overlap.
  const classKey = (x: ActivitiesMeritBand) => x.classShort?.trim() || "";
  for (const key of new Set((b.meritBands ?? []).map(classKey))) {
    const bands = (b.meritBands ?? []).filter((x) => classKey(x) === key).sort((x, y) => x.fromPercent - y.fromPercent);
    const where = key ? ` for Class ${key}` : "";
    for (const [i, band] of bands.entries()) {
      if (key && !MERIT_CLASSES.includes(key)) return fail(422, "VALIDATION", `Band${where}: choose a class from the list.`, { field: "meritBands" });
      if (band.fromPercent < 0 || band.toPercent > 100 || band.fromPercent >= band.toPercent) return fail(422, "VALIDATION", `Band ${i + 1}${where}: “from” must be below “to”, both between 0 and 100.`, { field: "meritBands" });
      if (band.value < 1 || band.value > 100) return fail(422, "VALIDATION", `Band ${i + 1}${where}: the % off must be from 1 to 100.`, { field: "meritBands" });
      const next = bands[i + 1];
      if (next && next.fromPercent <= band.toPercent) return fail(422, "VALIDATION", `Bands ${i + 1} and ${i + 2}${where} overlap. Each mark can fall in one band only.`, { field: "meritBands" });
    }
  }
  if (b.seatsPerClass !== null && (!Number.isInteger(b.seatsPerClass) || b.seatsPerClass < 1 || b.seatsPerClass > 50)) return fail(422, "VALIDATION", "Seats per class must be from 1 to 50, or leave it empty for no limit.", { field: "seatsPerClass" });
  for (const v of [b.renewal?.minResultPercent, b.renewal?.minAttendancePercent]) if (v !== null && v !== undefined && (v < 0 || v > 100)) return fail(422, "VALIDATION", "Renewal percentages must be from 0 to 100.", { field: "renewal" });
  return null;
}

interface AwardCheck {
  person: Found;
  scheme: SchemeRecord;
}

function checkAward(b: ActivitiesAwardInput, campus: CampusCode, session: number, opts: { fromTest?: boolean } = {}): AwardCheck | Response {
  const person = findPerson(b.studentId ?? "");
  if (!person) return fail(422, "VALIDATION", "Choose the student from the search list.", { field: "studentId" });
  if (person.campus !== campus) return fail(422, "VALIDATION", `${person.name} studies at another campus. Switch to that campus to propose the award.`, { field: "studentId" });
  const scheme = schemeOf(b.schemeId);
  if (!scheme) return fail(422, "VALIDATION", "Choose a scheme.", { field: "schemeId" });
  if (!scheme.active) return fail(422, "VALIDATION", `${scheme.name} is switched off. Choose another scheme.`, { field: "schemeId" });
  if (scheme.needsTest && !opts.fromTest) return fail(422, "VALIDATION", `${scheme.name}s are given from a merit list. Open Scholarship tests to propose them.`, { field: "schemeId" });
  if (scheme.basis === "PERCENT" && (!Number.isFinite(b.value) || b.value < 1 || b.value > 100)) return fail(422, "VALIDATION", "The percentage off must be from 1 to 100.", { field: "value" });
  if (b.values && scheme.basis === "PERCENT") {
    for (const [head, v] of Object.entries(b.values) as Array<[ActivitiesFeeHead, number]>) {
      if (!ACTIVITIES_FEE_HEADS.includes(head)) return fail(422, "VALIDATION", "Unknown fee head.", { field: "values" });
      if (!Number.isFinite(v) || v < 1 || v > 100) return fail(422, "VALIDATION", `The % off ${headsText([head])} must be from 1 to 100.`, { field: `values.${head}` });
    }
  }
  if (person.admission && b.application?.staffParentId && !staffOf(campus).some((s) => s.id === b.application!.staffParentId)) return fail(422, "VALIDATION", "Choose the parent from this campus's staff list.", { field: "staffParentId" });
  if (b.application) {
    const ap = b.application;
    if (!ap.submittedOn || ap.submittedOn > DEMO_TODAY) return fail(422, "VALIDATION", "The application date can't be after today.", { field: "submittedOn" });
    if (ap.lastExam && (!Number.isFinite(ap.lastExam.total) || ap.lastExam.total <= 0 || !Number.isFinite(ap.lastExam.obtained) || ap.lastExam.obtained < 0 || ap.lastExam.obtained > ap.lastExam.total)) return fail(422, "VALIDATION", "Marks obtained must be from 0 to the total marks.", { field: "lastExam" });
  }
  const tuition = tuitionFor(classShortOf(person.classSection));
  if (scheme.basis === "FIXED" && (!Number.isInteger(b.value) || b.value < 100 || b.value > tuition)) return fail(422, "VALIDATION", `The amount must be whole rupees from Rs 100 to ${formatRs(tuition)} (the monthly tuition).`, { field: "value" });
  const { ends } = sessionOf(session);
  const earliest = thisMonthStart;
  if (!b.effectiveFrom || b.effectiveFrom < earliest || b.effectiveFrom > ends) return fail(422, "VALIDATION", `Start between ${formatDate(earliest)} and ${formatDate(ends)}. Vouchers already posted are not changed.`, { field: "effectiveFrom" });
  if (!opts.fromTest && (b.reason?.trim().length ?? 0) < 10) return fail(422, "VALIDATION", "Say why in a sentence: the family's situation, the result or the relationship.", { field: "reason" });
  if (!opts.fromTest && scheme.evidence.length > 0 && !b.evidence?.trim()) return fail(422, "VALIDATION", `Note the documents seen (${scheme.evidence.join(", ").toLowerCase()}).`, { field: "evidence" });
  const live = awardsStore.get().filter((a) => a.studentId === person.id && a.session === session && (a.status === "PENDING" || a.status === "APPROVED"));
  const same = live.find((a) => a.schemeId === scheme.id);
  if (same) return fail(409, "DUPLICATE", `${person.name} already has a ${scheme.name.toLowerCase()} this session (${same.awardNo}, ${same.status === "PENDING" ? "waiting for approval" : "approved"}).`, { field: "schemeId" });
  const used = live.reduce((s, a) => s + tuitionPercent(a, schemeOf(a.schemeId) ?? scheme), 0);
  const adding = tuitionPercent({ classSection: person.classSection, value: b.value, values: b.values, feeHeads: b.feeHeads?.length ? b.feeHeads : scheme.feeHeads }, scheme);
  if (used + adding > 100) return fail(422, "OVER_LIMIT", `Together with ${person.name}'s other awards this takes ${Math.round(used + adding)}% off tuition. The total can't go above 100%.`, { field: "value" });
  return { person, scheme };
}

/** A house name: 3 to 40 characters and not already used at the campus (retired houses included). */
function checkHouseName(campus: CampusCode, name: string, id?: string): Response | null {
  if (name.length < 3 || name.length > 40) return fail(422, "VALIDATION", "Give the house a name of 3 to 40 characters, for example “Quaid House”.", { field: "name" });
  const dup = housesStore.get().find((h) => h.campus === campus && h.id !== id && h.name.toLowerCase() === name.toLowerCase());
  if (dup) return fail(409, "DUPLICATE", `${campusName(campus)} already has a house called “${dup.name}”${dup.active === false ? " (out of use: switch it back on instead)" : ""}.`, { field: "name" });
  return null;
}

/** Per-head % for the ticked heads only; nothing stored when every head has the same %. */
function pickValues(values: ActivitiesHeadValues, heads: ActivitiesFeeHead[], value: number): { values?: ActivitiesHeadValues } {
  const out: ActivitiesHeadValues = {};
  for (const h of heads) if (values[h] !== undefined) out[h] = values[h];
  const per = heads.map((h) => out[h] ?? value);
  return per.some((v) => v !== value) ? { values: out } : {};
}

function cleanApplication(a: NonNullable<ActivitiesAwardInput["application"]>): NonNullable<AwardRecord["application"]> {
  return {
    submittedOn: a.submittedOn,
    ...(a.receiptNo?.trim() ? { receiptNo: a.receiptNo.trim() } : {}),
    ...(a.lastExam && a.lastExam.name?.trim() ? { lastExam: { name: a.lastExam.name.trim(), ...(a.lastExam.rollNo?.trim() ? { rollNo: a.lastExam.rollNo.trim() } : {}), obtained: a.lastExam.obtained, total: a.lastExam.total } } : {}),
    ...(a.previousSchool?.trim() ? { previousSchool: a.previousSchool.trim() } : {}),
    ...(a.staffParentId ? { staffParentId: a.staffParentId } : {}),
    ...(a.subjectGroup?.trim() ? { subjectGroup: a.subjectGroup.trim() } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------------------------------------

const can = (perm: Parameters<typeof requirePermission>[0], campus: CampusScope) => requirePermission(perm, campus);

export const activitiesHandlers: HttpHandler[] = [
  // ---- Overview ----
  http.get("/api/activities/overview", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = can("activities.view", ctx.campus);
    if (user instanceof Response) return user;
    return HttpResponse.json(overview(ctx));
  }),

  // ---- Staff (parent of a staff-child concession) ----
  http.get("/api/activities/staff", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = can("activities.view", ctx.campus);
    if (user instanceof Response) return user;
    if (ctx.campus === "ALL") return HttpResponse.json([]);
    return HttpResponse.json(staffOf(ctx.campus).map((s) => ({ id: s.id, name: s.name, designation: s.designation })));
  }),

  // ---- People search ----
  http.get("/api/activities/people", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = can("activities.view", ctx.campus);
    if (user instanceof Response) return user;
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    if (q.length < 2) return HttpResponse.json([]);
    const campuses = ctx.campus === "ALL" ? CAMPUSES : [ctx.campus];
    const out: ActivitiesPerson[] = [];
    for (const campus of campuses) {
      for (const s of campusStudents(campus)) {
        if (`${s.name} ${s.grNo} ${s.father}`.toLowerCase().includes(q) || s.grNo.replace("-", "").toLowerCase().includes(q.replace("-", ""))) {
          out.push({ id: s.grNo, name: s.name, father: s.father, relation: relationOf(s.grNo, s.name), classSection: s.classSection, campus, house: houseName(houseOf(campus, s.grNo).houseId), hasProfile: s.hasProfile });
          if (out.length >= 12) break;
        }
      }
      if (out.length >= 12) break;
    }
    // Admission applicants of this session (not yet admitted): a scholarship can be applied for before admission.
    for (const campus of url.searchParams.get("applicants") === "1" ? campuses : []) {
      if (out.length >= 16) break;
      for (const a of admissionApplicants(campus, ctx.session)) {
        if (a.stage === "ADMITTED" || a.stage === "WITHDRAWN") continue;
        if (!`${a.name} ${a.applicationNo} ${a.father}`.toLowerCase().includes(q)) continue;
        out.push({ id: a.applicationNo, name: a.name, father: a.father, relation: a.relation, classSection: a.classApplied, campus, house: null, hasProfile: false, isApplicant: true, applicationNo: a.applicationNo, ...(a.previousSchool ? { previousSchool: a.previousSchool } : {}) });
        if (out.length >= 16) break;
      }
    }
    return HttpResponse.json(out.sort((a, b) => Number(b.hasProfile) - Number(a.hasProfile)));
  }),

  // ---- Schemes ----
  http.get("/api/activities/schemes", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = can("activities.view", ctx.campus);
    if (user instanceof Response) return user;
    const awards = awardsStore.get().filter((a) => inCtx(ctx, a));
    return HttpResponse.json(
      schemesStore.get().map((s): ActivitiesScheme => {
        const mine = awards.filter((a) => a.schemeId === s.id);
        const approved = mine.filter((a) => a.status === "APPROVED");
        return { ...s, awards: approved.length, pending: mine.filter((a) => a.status === "PENDING").length, monthlyRelief: approved.reduce((sum, a) => sum + feeEffect(a, s).monthly, 0) };
      }),
    );
  }),

  ...(["post", "put"] as const).map((method) =>
    http[method](method === "post" ? "/api/activities/schemes" : "/api/activities/schemes/:id", async ({ request, params }) => {
      await latency();
      const ctx = ctxFrom(new URL(request.url));
      const user = can("activities.manage", "ALL");
      if (user instanceof Response) return fail(403, "FORBIDDEN", "Schemes are shared by every campus, so only an all-campus admin can change them.");
      const ro = readOnly(ctx.session);
      if (ro) return ro;
      const b = await body<ActivitiesSchemeInput>(request);
      const id = method === "put" ? String(params.id) : undefined;
      if (id && !schemeOf(id)) return fail(404, "NOT_FOUND", "That scheme no longer exists.");
      const bad = checkScheme(b, id);
      if (bad) return bad;
      const rec: SchemeRecord = {
        id: id ?? newId("sc"),
        name: b.name.trim(),
        nameUrdu: b.nameUrdu?.trim() ?? "",
        kind: b.kind,
        basis: b.basis,
        value: b.value,
        feeHeads: b.basis === "FIXED" ? ["TUITION"] : b.feeHeads,
        criteria: b.criteria.trim(),
        evidence: (b.evidence ?? []).map((x) => x.trim()).filter(Boolean),
        meritBands: [...(b.meritBands ?? [])].map((x) => ({ fromPercent: x.fromPercent, toPercent: x.toPercent, value: x.value, ...(x.classShort?.trim() ? { classShort: x.classShort.trim() } : {}) })).sort((x, y) => (x.classShort ?? "").localeCompare(y.classShort ?? "", "en", { numeric: true }) || y.fromPercent - x.fromPercent),
        renewal: { minResultPercent: b.renewal?.minResultPercent ?? null, minAttendancePercent: b.renewal?.minAttendancePercent ?? null, note: b.renewal?.note?.trim() ?? "" },
        seatsPerClass: b.seatsPerClass,
        needsTest: Boolean(b.needsTest),
        active: Boolean(b.active),
      };
      schemesStore.set((list) => (id ? list.map((s) => (s.id === id ? rec : s)) : [...list, rec]));
      return HttpResponse.json({ ...rec, awards: 0, pending: 0, monthlyRelief: 0 } satisfies ActivitiesScheme, { status: id ? 200 : 201 });
    }),
  ),

  // ---- Awards ----
  http.get("/api/activities/awards", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = can("activities.view", ctx.campus);
    if (user instanceof Response) return user;
    const status = url.searchParams.get("status");
    const schemeId = url.searchParams.get("schemeId");
    const order = { PENDING: 0, APPROVED: 1, ENDED: 2, REJECTED: 3 };
    const list = awardsStore
      .get()
      .filter((a) => inCtx(ctx, a) && (!status || status === "ALL" || a.status === status) && (!schemeId || a.schemeId === schemeId))
      .sort((a, b) => order[a.status] - order[b.status] || b.proposedAt.localeCompare(a.proposedAt))
      .map(toAward);
    return HttpResponse.json(list);
  }),

  http.get("/api/activities/awards/:id", async ({ params }) => {
    await latency();
    const a = awardsStore.get().find((x) => x.id === params.id);
    if (!a) return fail(404, "NOT_FOUND", "That award no longer exists.");
    const user = can("activities.view", a.campus);
    if (user instanceof Response) return user;
    return HttpResponse.json(toAward(a));
  }),

  http.get("/api/activities/fee-preview", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = can("activities.view", ctx.campus);
    if (user instanceof Response) return user;
    const person = findPerson(url.searchParams.get("studentId") ?? "");
    const scheme = schemeOf(url.searchParams.get("schemeId") ?? "");
    if (!person || !scheme) return fail(422, "VALIDATION", "Choose a student and a scheme to see the fee effect.");
    const value = Number(url.searchParams.get("value") ?? scheme.value) || 0;
    const heads = (url.searchParams.get("feeHeads") ?? "").split(",").filter(Boolean) as ActivitiesFeeHead[];
    const from = url.searchParams.get("effectiveFrom") || nextMonthStart;
    // "TUITION:100,ANNUAL:50" — a % for each head.
    const values: ActivitiesHeadValues = {};
    for (const part of (url.searchParams.get("values") ?? "").split(",").filter(Boolean)) {
      const [head, v] = part.split(":") as [ActivitiesFeeHead, string];
      const n = Number(v);
      if (!ACTIVITIES_FEE_HEADS.includes(head) || !Number.isFinite(n) || n < 1 || n > 100) return fail(422, "VALIDATION", "Each fee's % off must be from 1 to 100.", { field: `values.${head}` });
      values[head] = n;
    }
    return HttpResponse.json(
      feeEffect({ classSection: person.classSection, isApplicant: person.isApplicant, value, values, feeHeads: heads.length ? heads : scheme.feeHeads, effectiveFrom: from, effectiveTo: sessionOf(ctx.session).ends, status: "PENDING", session: ctx.session }, scheme),
    );
  }),

  http.post("/api/activities/awards", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = can("activities.manage", ctx.campus);
    if (user instanceof Response) return user;
    const ro = readOnly(ctx.session) ?? singleCampus(ctx.campus, "scholarship awards");
    if (ro) return ro;
    const campus = ctx.campus as CampusCode;
    const b = await body<ActivitiesAwardInput>(request);
    const checked = checkAward(b, campus, ctx.session);
    if (checked instanceof Response) return checked;
    const { person, scheme } = checked;
    const awardNo = nextAwardNo(campus, ctx.session);
    const now = demoNow();
    const rec: AwardRecord = {
      id: `aw-${awardNo.toLowerCase()}`,
      awardNo,
      campus,
      session: ctx.session,
      studentId: person.id,
      studentName: person.name,
      father: person.father,
      classSection: person.classSection,
      isApplicant: person.isApplicant,
      hasProfile: person.hasProfile,
      schemeId: scheme.id,
      value: b.value,
      feeHeads: scheme.basis === "FIXED" ? ["TUITION"] : b.feeHeads?.length ? b.feeHeads : scheme.feeHeads,
      ...(scheme.basis === "PERCENT" && b.values ? pickValues(b.values, b.feeHeads?.length ? b.feeHeads : scheme.feeHeads, b.value) : {}),
      ...(b.application ? { application: cleanApplication(b.application) } : {}),
      ...(person.isApplicant ? { previousSchool: b.application?.previousSchool?.trim() || person.previousSchool || null, ...(person.gender ? { gender: person.gender } : {}) } : {}),
      reason: person.admission ? `${b.reason.trim()} Applies once admitted.` : b.reason.trim(),
      evidence: b.evidence?.trim() ?? "",
      effectiveFrom: b.effectiveFrom,
      effectiveTo: sessionOf(ctx.session).ends,
      status: "PENDING",
      proposedBy: user.name,
      proposedAt: now,
      history: [{ id: newId("h"), at: now, by: user.name, action: "Proposed", detail: `${b.reason.trim()}${person.admission ? ` · applicant ${person.id}` : ""}` }],
    };
    awardsStore.set((list) => [rec, ...list]);
    return HttpResponse.json(toAward(rec), { status: 201 });
  }),

  http.post("/api/activities/awards/:id/decide", async ({ request, params }) => {
    await latency();
    const a = awardsStore.get().find((x) => x.id === params.id);
    if (!a) return fail(404, "NOT_FOUND", "That award no longer exists.");
    const user = can("approvals.decide", a.campus);
    if (user instanceof Response) return fail(403, "FORBIDDEN", "Only the principal or an admin can approve scholarships.");
    const ro = readOnly(a.session);
    if (ro) return ro;
    const b = await body<{ decision: "APPROVE" | "REJECT"; note: string }>(request);
    if (a.status !== "PENDING") return fail(409, "ALREADY_DECIDED", `${a.awardNo} was already ${a.status === "APPROVED" ? "approved" : a.status.toLowerCase()} by ${a.decidedBy ?? "someone else"}. Refresh to see it.`);
    if (a.proposedBy === user.name) return fail(409, "SAME_PERSON", "You proposed this award, so another approver must decide it. Ask the principal or the admin.");
    if (b.decision === "REJECT" && (b.note?.trim().length ?? 0) < 5) return fail(422, "VALIDATION", "Say why it is rejected; the office tells the family.", { field: "note" });
    if (b.decision === "APPROVE") {
      const scheme = schemeOf(a.schemeId);
      if (!scheme?.active) return fail(409, "SCHEME_OFF", "This scheme has been switched off. Reject the award or switch the scheme back on.");
      const others = awardsStore.get().filter((x) => x.id !== a.id && x.studentId === a.studentId && x.session === a.session && x.status === "APPROVED");
      const total = others.reduce((s, x) => s + tuitionPercent(x, schemeOf(x.schemeId) ?? scheme), 0) + tuitionPercent(a, scheme);
      if (total > 100) return fail(422, "OVER_LIMIT", `With the awards already approved this would take ${Math.round(total)}% off ${a.studentName}'s tuition. Reject it or end another award first.`);
    }
    const now = demoNow();
    const out = updateAward(a.id, (x) => ({
      ...x,
      status: b.decision === "APPROVE" ? "APPROVED" : "REJECTED",
      decidedBy: user.name,
      decidedAt: now,
      ...(b.note?.trim() ? { decisionNote: b.note.trim() } : {}),
      history: [...x.history, { id: newId("h"), at: now, by: user.name, action: b.decision === "APPROVE" ? "Approved" : "Rejected", ...(b.note?.trim() ? { detail: b.note.trim() } : {}) }],
    }))!;
    if (out.testId) updateTest(out.testId, (t) => ({ ...t, history: [...t.history, log(user.name, b.decision === "APPROVE" ? "Award approved" : "Award rejected", `${out.studentName} · ${out.awardNo}`)] }));
    return HttpResponse.json(toAward(out));
  }),

  http.post("/api/activities/awards/:id/end", async ({ request, params }) => {
    await latency();
    const a = awardsStore.get().find((x) => x.id === params.id);
    if (!a) return fail(404, "NOT_FOUND", "That award no longer exists.");
    const user = can("activities.manage", a.campus);
    if (user instanceof Response) return user;
    const ro = readOnly(a.session);
    if (ro) return ro;
    const b = await body<{ endOn: IsoDate; reason: string }>(request);
    if (a.status !== "APPROVED") return fail(409, "NOT_APPROVED", "Only an approved award can be ended.");
    if (!b.endOn || b.endOn < thisMonthStart || b.endOn > a.effectiveTo) return fail(422, "VALIDATION", `End between ${formatDate(thisMonthStart)} and ${formatDate(a.effectiveTo)}. Vouchers already posted keep the relief.`, { field: "endOn" });
    if ((b.reason?.trim().length ?? 0) < 5) return fail(422, "VALIDATION", "Say why the award ends.", { field: "reason" });
    const out = updateAward(a.id, (x) => ({ ...x, status: "ENDED", endedOn: b.endOn, endReason: b.reason.trim(), history: [...x.history, log(user.name, "Ended", `From ${formatDate(b.endOn)}. ${b.reason.trim()}`)] }))!;
    return HttpResponse.json(toAward(out));
  }),

  http.post("/api/activities/awards/:id/renewal", async ({ request, params }) => {
    await latency();
    const a = awardsStore.get().find((x) => x.id === params.id);
    if (!a) return fail(404, "NOT_FOUND", "That award no longer exists.");
    const user = can("activities.manage", a.campus);
    if (user instanceof Response) return user;
    const ro = readOnly(a.session);
    if (ro) return ro;
    if (a.status !== "APPROVED") return fail(409, "NOT_APPROVED", "Only approved awards go through the renewal review.");
    const b = await body<{ decision: ActivitiesRenewalDecision; newValue?: number; note: string }>(request);
    const scheme = schemeOf(a.schemeId);
    if (b.decision === "REDUCE") {
      const v = Number(b.newValue);
      const min = scheme?.basis === "FIXED" ? 100 : 1;
      if (!Number.isFinite(v) || v < min || v >= a.value) return fail(422, "VALIDATION", `The new ${scheme?.basis === "FIXED" ? "amount" : "%"} must be below the current ${scheme?.basis === "FIXED" ? formatRs(a.value) : `${a.value}%`}.`, { field: "newValue" });
    }
    if (b.decision === "END" && (b.note?.trim().length ?? 0) < 5) return fail(422, "VALIDATION", "Say why it won't continue; the office tells the family.", { field: "note" });
    const now = demoNow();
    const text = b.decision === "RENEW" ? "Renew for next session" : b.decision === "REDUCE" ? `Renew at ${scheme?.basis === "FIXED" ? formatRs(Number(b.newValue)) : `${b.newValue}%`}` : "End at session end";
    const out = updateAward(a.id, (x) => ({
      ...x,
      renewal: { decision: b.decision, ...(b.decision === "REDUCE" ? { newValue: Number(b.newValue) } : {}), decidedBy: user.name, decidedAt: now, ...(b.note?.trim() ? { note: b.note.trim() } : {}) },
      history: [...x.history, log(user.name, "Renewal review", `${text}${b.note?.trim() ? `. ${b.note.trim()}` : ""}`)],
    }))!;
    return HttpResponse.json(toAward(out));
  }),

  http.post("/api/activities/renewals", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = can("activities.manage", ctx.campus);
    if (user instanceof Response) return user;
    const ro = readOnly(ctx.session);
    if (ro) return ro;
    const b = await body<{ awardIds: string[] }>(request);
    const ids = new Set(b.awardIds ?? []);
    let renewed = 0;
    const now = demoNow();
    awardsStore.set((list) =>
      list.map((a) => {
        if (!ids.has(a.id) || a.status !== "APPROVED" || a.renewal || !inCtx(ctx, a)) return a;
        const check = renewalCheck(a, schemeOf(a.schemeId)!);
        if (!check || (check.outcome !== "MEETS" && check.outcome !== "AUTOMATIC")) return a;
        renewed++;
        return { ...a, renewal: { decision: "RENEW", decidedBy: user.name, decidedAt: now, note: "Meets the criteria (renewed together)." }, history: [...a.history, log(user.name, "Renewal review", "Renew for next session (renewed together)")] };
      }),
    );
    return HttpResponse.json({ renewed });
  }),

  // ---- Scholarship tests ----
  http.get("/api/activities/tests", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = can("activities.view", ctx.campus);
    if (user instanceof Response) return user;
    return HttpResponse.json(
      testsStore
        .get()
        .filter((t) => inCtx(ctx, t))
        .sort((a, b) => b.testNo.localeCompare(a.testNo))
        .map((t) => toTestSummary(t)),
    );
  }),

  http.get("/api/activities/tests/:id", async ({ params }) => {
    await latency();
    const t = testsStore.get().find((x) => x.id === params.id);
    if (!t) return fail(404, "NOT_FOUND", "That scholarship test no longer exists.");
    const user = can("activities.view", t.campus);
    if (user instanceof Response) return user;
    return HttpResponse.json(toTestDetail(t));
  }),

  http.get("/api/activities/exam-options", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = can("activities.view", ctx.campus);
    if (user instanceof Response) return user;
    return HttpResponse.json(
      examsStore
        .get()
        .filter((e) => e.status === "DECLARED" && e.session === ctx.session && (ctx.campus === "ALL" || e.campus === ctx.campus) && e.category !== "UNIVERSITY")
        .sort((a, b) => (b.declaredOn ?? "").localeCompare(a.declaredOn ?? ""))
        .map((e): ActivitiesExamOption => ({ id: e.id, name: e.name, classes: e.classes, declaredOn: e.declaredOn ?? null, candidates: e.roster.length })),
    );
  }),

  http.post("/api/activities/tests", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = can("activities.manage", ctx.campus);
    if (user instanceof Response) return user;
    const ro = readOnly(ctx.session) ?? singleCampus(ctx.campus, "scholarship tests");
    if (ro) return ro;
    const campus = ctx.campus as CampusCode;
    const b = await body<ActivitiesTestInput>(request);
    if ((b.title?.trim().length ?? 0) < 3) return fail(422, "VALIDATION", "Give the test a title, for example “Talent scholarship · Class 7”.", { field: "title" });
    const scheme = schemeOf(b.schemeId);
    if (!scheme?.active) return fail(422, "VALIDATION", "Choose the scheme the awards will come from.", { field: "schemeId" });
    if (b.seats !== null && (!Number.isInteger(b.seats) || b.seats < 1 || b.seats > 50)) return fail(422, "VALIDATION", "Seats must be from 1 to 50, or leave it empty to award everyone who passes.", { field: "seats" });
    if (!Number.isFinite(b.passPercent) || b.passPercent < 0 || b.passPercent > 100) return fail(422, "VALIDATION", "The pass mark must be from 0% to 100%.", { field: "passPercent" });
    const code = sessionCode(ctx.session);
    const prefix = `ST-${campus}-${code}-`;
    const n = testsStore.get().filter((t) => t.testNo.startsWith(prefix)).length + 1;
    let rec: TestRecord;
    if (b.source === "EXAM") {
      const e = examsStore.get().find((x) => x.id === b.examId);
      if (!e || e.campus !== campus || e.session !== ctx.session) return fail(422, "VALIDATION", "Choose a declared exam of this campus and session.", { field: "examId" });
      if (e.status !== "DECLARED") return fail(409, "NOT_DECLARED", "Merit lists use declared results only. Declare the exam's results first.", { field: "examId" });
      const dup = testsStore.get().find((t) => t.examId === e.id && t.schemeId === scheme.id);
      if (dup) return fail(409, "DUPLICATE", `A merit list for this exam already exists: ${dup.testNo} · ${dup.title}.`, { field: "examId" });
      rec = {
        id: newId("st"),
        testNo: `${prefix}${String(n).padStart(2, "0")}`,
        title: b.title.trim(),
        campus,
        session: ctx.session,
        source: "EXAM",
        examId: e.id,
        classLabel: b.classLabel?.trim() || (e.classes.length > 1 ? `Class ${e.classes[0]!.split("-")[0]}` : e.classes[0] ?? ""),
        schemeId: scheme.id,
        date: null,
        venue: null,
        papers: [],
        seats: b.seats,
        passPercent: b.passPercent,
        status: "RESULT",
        candidates: [],
        history: [log(user.name, `Merit list made from ${e.name}`, `Declared result · ${b.seats === null ? "every qualifier" : plural(b.seats, "seat")} · pass mark ${b.passPercent}%`)],
      };
    } else {
      const papers = (b.papers ?? []).map((p, i) => ({ id: p.id || `p${i + 1}`, name: p.name?.trim() ?? "", maxMarks: Number(p.maxMarks) }));
      if (!papers.length) return fail(422, "VALIDATION", "Add at least one paper with its maximum marks.", { field: "papers" });
      if (papers.some((p) => !p.name || !Number.isInteger(p.maxMarks) || p.maxMarks < 5 || p.maxMarks > 200)) return fail(422, "VALIDATION", "Each paper needs a name and maximum marks from 5 to 200.", { field: "papers" });
      if (!b.classLabel?.trim()) return fail(422, "VALIDATION", "Say who may sit the test, for example “Class 9 (students and applicants)”.", { field: "classLabel" });
      const { starts, ends } = sessionOf(ctx.session);
      if (!b.date || b.date < starts || b.date > ends) return fail(422, "VALIDATION", `Choose the test date in session ${formatSession(ctx.session)}.`, { field: "date" });
      const closed = closedOn(campus, b.date);
      if (closed) return fail(422, "VALIDATION", `${formatDate(b.date)} is ${closed.name === "Sunday" ? "a Sunday" : `${closed.name}, a holiday`}. Choose another day.`, { field: "date" });
      rec = {
        id: newId("st"),
        testNo: `${prefix}${String(n).padStart(2, "0")}`,
        title: b.title.trim(),
        campus,
        session: ctx.session,
        source: "DEDICATED",
        examId: null,
        classLabel: b.classLabel.trim(),
        schemeId: scheme.id,
        date: b.date,
        venue: b.venue?.trim() || null,
        papers,
        seats: b.seats,
        passPercent: b.passPercent,
        status: "REGISTRATION",
        candidates: [],
        history: [log(user.name, "Test set up", `${plural(papers.length, "paper")} · ${papers.reduce((s, p) => s + p.maxMarks, 0)} marks · pass mark ${b.passPercent}%`)],
      };
    }
    testsStore.set((list) => [rec, ...list]);
    return HttpResponse.json(toTestDetail(rec), { status: 201 });
  }),

  http.post("/api/activities/tests/:id/candidates", async ({ request, params }) => {
    await latency();
    const t = testsStore.get().find((x) => x.id === params.id);
    if (!t) return fail(404, "NOT_FOUND", "That scholarship test no longer exists.");
    const user = can("activities.manage", t.campus);
    if (user instanceof Response) return user;
    const ro = readOnly(t.session);
    if (ro) return ro;
    if (t.source !== "DEDICATED") return fail(409, "FROM_EXAM", "This merit list comes from exam results; its candidates are the exam's students.");
    if (t.status !== "REGISTRATION") return fail(409, "CLOSED", "Registration is closed for this test.");
    const b = await body<{ studentId?: string; applicant?: ActivitiesApplicantInput }>(request);
    const blank = Object.fromEntries(t.papers.map((p) => [p.id, null])) as Record<string, ActivitiesMark>;
    let cand: CandidateRecord;
    if (b.studentId) {
      const f = findPerson(b.studentId);
      if (!f || f.isApplicant) return fail(422, "VALIDATION", "Choose the student from the search list.", { field: "studentId" });
      if (f.campus !== t.campus) return fail(422, "VALIDATION", `${f.name} studies at another campus.`, { field: "studentId" });
      if (t.candidates.some((c) => c.studentId === f.id)) return fail(409, "DUPLICATE", `${f.name} is already registered.`, { field: "studentId" });
      cand = { id: f.id, studentId: f.id, name: f.name, father: f.father, classSection: f.classSection, previousSchool: null, mobile: null, hasProfile: f.hasProfile, marks: blank };
    } else {
      const a = b.applicant;
      if (!a || (a.name?.trim().length ?? 0) < 3) return fail(422, "VALIDATION", "Enter the applicant's full name.", { field: "name" });
      if ((a.father?.trim().length ?? 0) < 3) return fail(422, "VALIDATION", "Enter the father's name.", { field: "father" });
      if ((a.previousSchool?.trim().length ?? 0) < 3) return fail(422, "VALIDATION", "Enter the school the applicant comes from.", { field: "previousSchool" });
      const digits = (a.mobile ?? "").replace(/\D/g, "");
      if (!/^03\d{9}$/.test(digits)) return fail(422, "VALIDATION", "Enter an 11-digit mobile number starting 03, for example 0300-1234567.", { field: "mobile" });
      if (t.candidates.some((c) => !c.studentId && c.name.toLowerCase() === a.name.trim().toLowerCase() && c.father.toLowerCase() === a.father.trim().toLowerCase())) return fail(409, "DUPLICATE", `${a.name.trim()} is already registered.`, { field: "name" });
      const prefix = `APP-${t.campus}-${sessionCode(t.session)}-`;
      const max = testsStore
        .get()
        .flatMap((x) => x.candidates)
        .filter((c) => c.id.startsWith(prefix))
        .reduce((m, c) => Math.max(m, Number(c.id.slice(prefix.length)) || 0), 0);
      cand = { id: `${prefix}${String(max + 1).padStart(4, "0")}`, studentId: null, name: a.name.trim(), father: a.father.trim(), classSection: `${t.classLabel.replace(/\s*\(.*\)$/, "")} applicant`, previousSchool: a.previousSchool.trim(), mobile: `${digits.slice(0, 4)}-${digits.slice(4)}`, hasProfile: false, marks: blank };
    }
    const out = updateTest(t.id, (x) => ({ ...x, candidates: [...x.candidates, cand], history: [...x.history, log(user.name, "Candidate registered", `${cand.name} · ${cand.classSection}`)] }))!;
    return HttpResponse.json(toTestDetail(out), { status: 201 });
  }),

  http.delete("/api/activities/tests/:id/candidates/:cid", async ({ params }) => {
    await latency();
    const t = testsStore.get().find((x) => x.id === params.id);
    if (!t) return fail(404, "NOT_FOUND", "That scholarship test no longer exists.");
    const user = can("activities.manage", t.campus);
    if (user instanceof Response) return user;
    const ro = readOnly(t.session);
    if (ro) return ro;
    if (t.status !== "REGISTRATION") return fail(409, "CLOSED", "Candidates can only be removed while registration is open.");
    const c = t.candidates.find((x) => x.id === params.cid);
    if (!c) return fail(404, "NOT_FOUND", "That candidate is not registered.");
    const out = updateTest(t.id, (x) => ({ ...x, candidates: x.candidates.filter((y) => y.id !== c.id), history: [...x.history, log(user.name, "Candidate removed", c.name)] }))!;
    return HttpResponse.json(toTestDetail(out));
  }),

  http.put("/api/activities/tests/:id/marks", async ({ request, params }) => {
    await latency();
    const t = testsStore.get().find((x) => x.id === params.id);
    if (!t) return fail(404, "NOT_FOUND", "That scholarship test no longer exists.");
    const user = can("activities.manage", t.campus);
    if (user instanceof Response) return user;
    const ro = readOnly(t.session);
    if (ro) return ro;
    if (t.source !== "DEDICATED") return fail(409, "FROM_EXAM", "Marks for this merit list come from the exam. Change them in Exams.");
    if (t.status !== "MARKING") return fail(409, "NOT_MARKING", t.status === "REGISTRATION" ? "Close registration first, then enter marks." : "The merit list is published. Reopen marking to change marks.");
    const b = await body<{ marks: Record<string, Record<string, ActivitiesMark>> }>(request);
    for (const [cid, row] of Object.entries(b.marks ?? {})) {
      const c = t.candidates.find((x) => x.id === cid);
      if (!c) return fail(422, "VALIDATION", "A candidate in the grid is no longer registered. Refresh the page.");
      for (const [pid, v] of Object.entries(row)) {
        const p = t.papers.find((x) => x.id === pid);
        if (!p) return fail(422, "VALIDATION", "A paper in the grid no longer exists. Refresh the page.");
        if (v !== null && v !== "A" && (!Number.isInteger(v) || v < 0 || v > p.maxMarks))
          return fail(422, "VALIDATION", `${c.name}, ${p.name}: marks must be a whole number from 0 to ${p.maxMarks}, or A for absent.`, { field: "marks", details: { candidateId: cid, paperId: pid } });
      }
    }
    const out = updateTest(t.id, (x) => {
      const candidates = x.candidates.map((c) => (b.marks?.[c.id] ? { ...c, marks: { ...c.marks, ...b.marks[c.id] } } : c));
      const complete = candidates.filter((c) => x.papers.every((p) => (c.marks[p.id] ?? null) !== null)).length;
      const last = x.history[x.history.length - 1];
      const entry = log(user.name, "Marks saved", `${complete} of ${candidates.length} candidates complete`);
      const history = last && last.action === "Marks saved" && last.by === user.name ? [...x.history.slice(0, -1), entry] : [...x.history, entry];
      return { ...x, candidates, history };
    })!;
    return HttpResponse.json(toTestDetail(out));
  }),

  http.post("/api/activities/tests/:id/status", async ({ request, params }) => {
    await latency();
    const t = testsStore.get().find((x) => x.id === params.id);
    if (!t) return fail(404, "NOT_FOUND", "That scholarship test no longer exists.");
    const user = can("activities.manage", t.campus);
    if (user instanceof Response) return user;
    const ro = readOnly(t.session);
    if (ro) return ro;
    const { action } = await body<{ action: ActivitiesTestAction }>(request);
    let next: TestRecord["status"];
    let note: string;
    if (action === "CLOSE_REGISTRATION") {
      if (t.status !== "REGISTRATION") return fail(409, "STATE", "Registration is already closed.");
      if (t.candidates.length === 0) return fail(422, "VALIDATION", "Register at least one candidate first.");
      next = "MARKING";
      note = `${plural(t.candidates.length, "candidate")}`;
    } else if (action === "PUBLISH") {
      if (t.status !== "MARKING") return fail(409, "STATE", "Only a test being marked can be published.");
      const missing = testBase(t).filter((c) => c.percent === null);
      if (missing.length) return fail(422, "MARKS_MISSING", `${plural(missing.length, "candidate")} still ${missing.length === 1 ? "has" : "have"} marks missing: ${missing.slice(0, 3).map((c) => c.name).join(", ")}${missing.length > 3 ? "…" : ""}. Enter A for anyone absent.`);
      next = "RESULT";
      const computed = testCandidates(t);
      note = `${plural(computed.candidates.filter((c) => c.qualifies).length, "candidate")} reached ${t.passPercent}%`;
    } else if (action === "REOPEN_MARKING") {
      if (t.status !== "RESULT" || t.source !== "DEDICATED") return fail(409, "STATE", "Only a published dedicated test can go back to marking.");
      if (awardsStore.get().some((a) => a.testId === t.id && a.status !== "REJECTED")) return fail(409, "HAS_AWARDS", "Awards have been proposed from this merit list, so its marks are locked.");
      next = "MARKING";
      note = "Marks can be changed again";
    } else return fail(422, "VALIDATION", "Unknown action.");
    const label = action === "CLOSE_REGISTRATION" ? "Registration closed" : action === "PUBLISH" ? "Merit list published" : "Marking reopened";
    const out = updateTest(t.id, (x) => ({ ...x, status: next, history: [...x.history, log(user.name, label, note)] }))!;
    return HttpResponse.json(toTestDetail(out));
  }),

  http.post("/api/activities/tests/:id/awards", async ({ request, params }) => {
    await latency();
    const t = testsStore.get().find((x) => x.id === params.id);
    if (!t) return fail(404, "NOT_FOUND", "That scholarship test no longer exists.");
    const user = can("activities.manage", t.campus);
    if (user instanceof Response) return user;
    const ro = readOnly(t.session);
    if (ro) return ro;
    if (t.status !== "RESULT" && t.status !== "AWARDED") return fail(409, "STATE", "Publish the merit list before proposing awards.");
    const { candidateIds, overrides = {}, round } = await body<{ candidateIds: string[]; overrides?: Record<string, ActivitiesProposeOverride>; round?: number }>(request);
    if (!candidateIds?.length) return fail(422, "VALIDATION", "Tick at least one candidate.");
    if (round !== undefined && (!Number.isInteger(round) || round < 1 || round > 5)) return fail(422, "VALIDATION", "Choose the 1st to 5th list.", { field: "round" });
    const { candidates } = testCandidates(t);
    const scheme = schemeOf(t.schemeId);
    if (!scheme?.active) return fail(409, "SCHEME_OFF", "The scheme for this test is switched off. Switch it on in Schemes first.");
    const made: AwardRecord[] = [];
    const now = demoNow();
    for (const id of candidateIds) {
      const c = candidates.find((x) => x.id === id);
      if (!c) return fail(422, "VALIDATION", "A ticked candidate is no longer on the list. Refresh the page.");
      if (!c.withinSeats) return fail(422, "VALIDATION", `${c.name} is ${c.qualifies ? "outside the seats" : `below the pass mark of ${t.passPercent}%`}.`);
      if (c.awardId) return fail(409, "DUPLICATE", `${c.name} already has an award from this list.`);
      // The % can be changed row by row on the merit list before proposing (per head when the scheme covers several).
      const o = overrides[id] ?? {};
      const value = o.value ?? c.suggestedValue ?? scheme.value;
      const heads: ActivitiesFeeHead[] = c.isApplicant && scheme.basis === "PERCENT" ? [...new Set([...scheme.feeHeads, "ADMISSION" as const])] : scheme.feeHeads;
      if (scheme.basis === "PERCENT") {
        for (const v of [value, ...Object.values(o.values ?? {})]) if (!Number.isFinite(v) || v < 1 || v > 100) return fail(422, "VALIDATION", `${c.name}: each % off must be from 1 to 100.`, { field: "overrides", details: { candidateId: id } });
      } else if (!Number.isInteger(value) || value < 100) return fail(422, "VALIDATION", `${c.name}: the amount must be whole rupees, at least Rs 100.`, { field: "overrides", details: { candidateId: id } });
      const values = scheme.basis === "PERCENT" && o.values ? pickValues(o.values, heads, value) : {};
      const check = c.isApplicant ? null : checkAward({ studentId: c.id, schemeId: scheme.id, value, ...values, feeHeads: heads, effectiveFrom: nextMonthStart, reason: "x".repeat(10), evidence: "x" }, t.campus, t.session, { fromTest: true });
      if (check instanceof Response) return check;
      const awardNo = nextAwardNo(t.campus, t.session);
      const reason = `Rank ${c.rank} in ${t.testNo} · ${t.title} (${c.percent?.toFixed(1)}%).`;
      const rec: AwardRecord = {
        id: `aw-${awardNo.toLowerCase()}`,
        awardNo,
        campus: t.campus,
        session: t.session,
        studentId: c.id,
        studentName: c.name,
        father: c.father,
        classSection: c.classSection,
        isApplicant: c.isApplicant,
        hasProfile: c.hasProfile,
        schemeId: scheme.id,
        value,
        feeHeads: heads,
        ...values,
        gender: c.gender,
        previousSchool: c.previousSchool,
        ...(round ? { listRound: round } : {}),
        testId: t.id,
        ...(c.rank !== null ? { rank: c.rank } : {}),
        ...(c.percent !== null ? { percent: c.percent } : {}),
        reason: c.isApplicant ? `${reason} Applies once admitted.` : reason,
        evidence: `Merit list ${t.testNo}`,
        effectiveFrom: nextMonthStart,
        effectiveTo: sessionOf(t.session).ends,
        status: "PENDING",
        proposedBy: user.name,
        proposedAt: now,
        history: [{ id: newId("h"), at: now, by: user.name, action: "Proposed", detail: reason }],
      };
      awardsStore.set((list) => [rec, ...list]);
      made.push(rec);
    }
    const out = updateTest(t.id, (x) => ({ ...x, status: "AWARDED", history: [...x.history, log(user.name, round ? `Awards proposed (${ORD[round] ?? `${round}th`} list)` : "Awards proposed", `${plural(made.length, "student")} sent for approval: ${made.map((m) => m.studentName).join(", ")}`)] }))!;
    return HttpResponse.json(toTestDetail(out));
  }),

  // ---- Houses ----
  http.get("/api/activities/houses", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = can("activities.view", ctx.campus);
    if (user instanceof Response) return user;
    const one = singleCampus(ctx.campus, "houses");
    if (one) return one;
    return HttpResponse.json(housesView(ctx.campus as CampusCode, ctx.session));
  }),

  http.put("/api/activities/houses/:id", async ({ request, params }) => {
    await latency();
    const hs = housesStore.get().find((x) => x.id === params.id);
    if (!hs) return fail(404, "NOT_FOUND", "That house no longer exists.");
    const user = can("activities.manage", hs.campus);
    if (user instanceof Response) return user;
    const b = await body<ActivitiesHouseInput>(request);
    if ((b.houseMaster?.trim().length ?? 0) < 3) return fail(422, "VALIDATION", "Name the house master.", { field: "houseMaster" });
    if ((b.motto?.length ?? 0) > 60) return fail(422, "VALIDATION", "Keep the motto under 60 characters.", { field: "motto" });
    const name = b.name !== undefined ? b.name.trim() : hs.name;
    const nameBad = checkHouseName(hs.campus, name, hs.id);
    if (nameBad) return nameBad;
    if (b.tone !== undefined && ![1, 2, 3, 4].includes(b.tone)) return fail(422, "VALIDATION", "Choose one of the four house colours.", { field: "tone" });
    const retiring = b.active === false && isActive(hs);
    if (retiring) {
      const members = campusStudents(hs.campus).filter((s) => houseOf(hs.campus, s.grNo).houseId === hs.id).length;
      if (members > 0) return fail(409, "HAS_MEMBERS", `${hs.name} still has ${plural(members, "student")}. Move its students first, then take it out of use.`, { field: "active" });
    }
    for (const [field, id] of [
      ["captainId", b.captainId],
      ["viceCaptainId", b.viceCaptainId],
    ] as const) {
      if (!id) continue;
      if (houseOf(hs.campus, id).houseId !== hs.id) return fail(422, "VALIDATION", `${findPerson(id)?.name ?? id} is not a member of ${hs.name}.`, { field });
    }
    if (b.captainId && b.captainId === b.viceCaptainId) return fail(422, "VALIDATION", "The captain and vice-captain must be different students.", { field: "viceCaptainId" });
    housesStore.set((list) =>
      list.map((x) =>
        x.id === hs.id
          ? {
              ...x,
              name,
              ...(b.nameUrdu !== undefined ? { nameUrdu: b.nameUrdu.trim() } : {}),
              ...(b.tone !== undefined ? { tone: b.tone } : {}),
              ...(b.active !== undefined ? { active: b.active } : {}),
              houseMaster: b.houseMaster.trim(),
              assistantMaster: b.assistantMaster?.trim() || null,
              captainId: retiring ? null : b.captainId,
              viceCaptainId: retiring ? null : b.viceCaptainId,
              motto: b.motto?.trim() ?? "",
            }
          : x,
      ),
    );
    const view = housesView(hs.campus, CURRENT_SESSION);
    return HttpResponse.json(view.houses.find((x) => x.id === hs.id));
  }),

  http.post("/api/activities/houses", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = can("activities.manage", ctx.campus);
    if (user instanceof Response) return user;
    const ro = readOnly(ctx.session) ?? singleCampus(ctx.campus, "houses");
    if (ro) return ro;
    const campus = ctx.campus as CampusCode;
    const b = await body<ActivitiesHouseCreateInput>(request);
    const name = b.name?.trim() ?? "";
    const nameBad = checkHouseName(campus, name);
    if (nameBad) return nameBad;
    if (![1, 2, 3, 4].includes(b.tone)) return fail(422, "VALIDATION", "Choose one of the four house colours.", { field: "tone" });
    if ((b.houseMaster?.trim().length ?? 0) < 3) return fail(422, "VALIDATION", "Name the house master.", { field: "houseMaster" });
    if ((b.motto?.length ?? 0) > 60) return fail(422, "VALIDATION", "Keep the motto under 60 characters.", { field: "motto" });
    const rec: HouseRecord = {
      id: newId(`h-${campus.toLowerCase()}`),
      campus,
      key: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      name,
      nameUrdu: b.nameUrdu?.trim() ?? "",
      motto: b.motto?.trim() ?? "",
      tone: b.tone as ActivitiesHouseTone,
      houseMaster: b.houseMaster.trim(),
      assistantMaster: b.assistantMaster?.trim() || null,
      captainId: null,
      viceCaptainId: null,
      active: true,
      added: true,
    };
    housesStore.set((list) => [...list, rec]);
    const view = housesView(campus, ctx.session);
    return HttpResponse.json(view.houses.find((x) => x.id === rec.id), { status: 201 });
  }),

  http.post("/api/activities/house-points", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = can("activities.manage", ctx.campus);
    if (user instanceof Response) return user;
    const ro = readOnly(ctx.session) ?? singleCampus(ctx.campus, "house points");
    if (ro) return ro;
    const b = await body<ActivitiesPointsInput>(request);
    const hs = housesStore.get().find((x) => x.id === b.houseId && x.campus === ctx.campus);
    if (!hs) return fail(422, "VALIDATION", "Choose a house.", { field: "houseId" });
    if (!isActive(hs)) return fail(422, "VALIDATION", `${hs.name} is no longer in use. Choose another house.`, { field: "houseId" });
    if (!Number.isInteger(b.points) || b.points === 0 || b.points < -50 || b.points > 100) return fail(422, "VALIDATION", "Points must be a whole number from -50 to 100, and not 0. Use a minus sign for a deduction.", { field: "points" });
    if ((b.reason?.trim().length ?? 0) < 5) return fail(422, "VALIDATION", "Say what the points are for, for example “Cleanest classrooms: October”.", { field: "reason" });
    const { starts } = sessionOf(ctx.session);
    if (!b.date || b.date < starts || b.date > DEMO_TODAY) return fail(422, "VALIDATION", `The date must be between ${formatDate(starts)} and today.`, { field: "date" });
    const rec: PointsRecord = { id: newId("pt"), campus: hs.campus, session: ctx.session, houseId: hs.id, date: b.date, points: b.points, category: b.category, reason: b.reason.trim(), eventId: null, by: user.name };
    pointsStore.set((list) => [rec, ...list]);
    return HttpResponse.json(toLedger(rec), { status: 201 });
  }),

  http.get("/api/activities/house-members", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = can("activities.view", ctx.campus);
    if (user instanceof Response) return user;
    const one = singleCampus(ctx.campus, "houses");
    if (one) return one;
    const campus = ctx.campus as CampusCode;
    const houseFilter = url.searchParams.get("houseId") ?? "";
    const cs = url.searchParams.get("classSection") ?? "";
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const houses = housesStore.get().filter((x) => x.campus === campus);
    const out: ActivitiesHouseMember[] = [];
    for (const s of campusStudents(campus)) {
      if (cs && s.classSection !== cs) continue;
      if (q && !`${s.name} ${s.grNo} ${s.father}`.toLowerCase().includes(q)) continue;
      const m = houseOf(campus, s.grNo);
      if (houseFilter === "NONE" ? m.houseId !== null : houseFilter && m.houseId !== houseFilter) continue;
      const h = houses.find((x) => x.id === m.houseId);
      out.push({
        id: s.grNo,
        name: s.name,
        father: s.father,
        classSection: s.classSection,
        houseId: m.houseId,
        houseName: h?.name ?? null,
        since: m.houseId ? m.since : null,
        role: h?.captainId === s.grNo ? "CAPTAIN" : h?.viceCaptainId === s.grNo ? "VICE_CAPTAIN" : null,
        hasProfile: s.hasProfile,
      });
    }
    return HttpResponse.json(out);
  }),

  http.post("/api/activities/house-members", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = can("activities.manage", ctx.campus);
    if (user instanceof Response) return user;
    const ro = readOnly(ctx.session) ?? singleCampus(ctx.campus, "houses");
    if (ro) return ro;
    const campus = ctx.campus as CampusCode;
    const b = await body<{ studentIds: string[]; houseId: string; reason: string; since?: IsoDate }>(request);
    const target = housesStore.get().find((x) => x.id === b.houseId && x.campus === campus);
    if (!target) return fail(422, "VALIDATION", "Choose the house to move them to.", { field: "houseId" });
    if (!isActive(target)) return fail(422, "VALIDATION", `${target.name} is no longer in use. Choose another house.`, { field: "houseId" });
    if (!b.studentIds?.length) return fail(422, "VALIDATION", "Tick at least one student.");
    const since = b.since || DEMO_TODAY;
    const { starts } = sessionOf(ctx.session);
    if (since > DEMO_TODAY) return fail(422, "VALIDATION", "The move can't start after today.", { field: "since" });
    if (since < starts) return fail(422, "VALIDATION", `Choose a date in this session (from ${formatDate(starts)}).`, { field: "since" });
    for (const id of b.studentIds) {
      const cur = houseOf(campus, id);
      if (cur.houseId && cur.houseId !== target.id && cur.since >= since) return fail(422, "VALIDATION", `${findPerson(id)?.name ?? id} joined their house on ${formatDate(cur.since)}. Choose a later date.`, { field: "since" });
    }
    for (const id of b.studentIds) {
      const lead = housesStore.get().find((x) => x.campus === campus && (x.captainId === id || x.viceCaptainId === id) && x.id !== target.id);
      if (lead) return fail(409, "IS_CAPTAIN", `${findPerson(id)?.name ?? id} is ${lead.captainId === id ? "captain" : "vice-captain"} of ${lead.name}. Choose a new ${lead.captainId === id ? "captain" : "vice-captain"} first.`);
    }
    let moved = 0;
    membershipStore.set((all) => {
      const next = { ...all };
      for (const id of b.studentIds) {
        const cur = houseOf(campus, id);
        if (cur.houseId === target.id) continue;
        moved++;
        next[id] = { houseId: target.id, since, history: [...cur.history, ...(cur.houseId ? [{ houseId: cur.houseId, from: cur.since, to: addDays(since, -1) }] : [])] };
      }
      return next;
    });
    return HttpResponse.json({ moved });
  }),

  http.post("/api/activities/house-members/remove", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = can("activities.manage", ctx.campus);
    if (user instanceof Response) return user;
    const ro = readOnly(ctx.session) ?? singleCampus(ctx.campus, "houses");
    if (ro) return ro;
    const campus = ctx.campus as CampusCode;
    const b = await body<{ studentIds: string[]; leftOn: IsoDate; reason: string }>(request);
    if (!b.studentIds?.length) return fail(422, "VALIDATION", "Tick at least one student.");
    const { starts } = sessionOf(ctx.session);
    if (!b.leftOn || b.leftOn > DEMO_TODAY || b.leftOn < starts) return fail(422, "VALIDATION", `Choose a date between ${formatDate(starts)} and today.`, { field: "leftOn" });
    if ((b.reason?.trim().length ?? 0) < 3) return fail(422, "VALIDATION", "Say why, in a few words.", { field: "reason" });
    for (const id of b.studentIds) {
      const lead = housesStore.get().find((x) => x.campus === campus && (x.captainId === id || x.viceCaptainId === id));
      if (lead) return fail(409, "IS_CAPTAIN", `${findPerson(id)?.name ?? id} is ${lead.captainId === id ? "captain" : "vice-captain"} of ${lead.name}. Choose a new ${lead.captainId === id ? "captain" : "vice-captain"} first.`);
      const cur = houseOf(campus, id);
      if (cur.houseId && cur.since > b.leftOn) return fail(422, "VALIDATION", `${findPerson(id)?.name ?? id} joined their house on ${formatDate(cur.since)}. Choose a later date.`, { field: "leftOn" });
    }
    let removed = 0;
    membershipStore.set((all) => {
      const next = { ...all };
      for (const id of b.studentIds) {
        const cur = houseOf(campus, id);
        if (!cur.houseId) continue;
        removed++;
        next[id] = { houseId: null, since: b.leftOn, history: [...cur.history, { houseId: cur.houseId, from: cur.since, to: b.leftOn }] };
      }
      return next;
    });
    return HttpResponse.json({ removed });
  }),

  http.post("/api/activities/house-members/auto", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = can("activities.manage", ctx.campus);
    if (user instanceof Response) return user;
    const ro = readOnly(ctx.session) ?? singleCampus(ctx.campus, "houses");
    if (ro) return ro;
    const campus = ctx.campus as CampusCode;
    const houses = housesStore.get().filter((x) => x.campus === campus && isActive(x));
    if (houses.length === 0) return fail(409, "NO_HOUSES", "No house is in use at this campus. Add a house first.");
    const students = campusStudents(campus);
    // Balance within each class-section: the house with the fewest members of that section gets the next student.
    const bySection = new Map<string, Map<string, number>>();
    for (const s of students) {
      const h = houseOf(campus, s.grNo).houseId;
      const m = bySection.get(s.classSection) ?? new Map(houses.map((x) => [x.id, 0]));
      if (h) m.set(h, (m.get(h) ?? 0) + 1);
      bySection.set(s.classSection, m);
    }
    const byHouse: Record<string, number> = {};
    let assigned = 0;
    membershipStore.set((all) => {
      const next = { ...all };
      for (const s of students) {
        if (houseOf(campus, s.grNo).houseId) continue;
        const m = bySection.get(s.classSection)!;
        const pick = [...m.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0]![0];
        m.set(pick, (m.get(pick) ?? 0) + 1);
        next[s.grNo] = { houseId: pick, since: DEMO_TODAY, history: [] };
        const name = houses.find((x) => x.id === pick)?.name ?? pick;
        byHouse[name] = (byHouse[name] ?? 0) + 1;
        assigned++;
      }
      return next;
    });
    return HttpResponse.json({ assigned, byHouse });
  }),

  // ---- Events ----
  http.get("/api/activities/events", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = can("activities.view", ctx.campus);
    if (user instanceof Response) return user;
    return HttpResponse.json(
      eventsStore
        .get()
        .filter((e) => inCtx(ctx, e))
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(toEventSummary),
    );
  }),

  http.get("/api/activities/events/:id", async ({ params }) => {
    await latency();
    const ev = eventsStore.get().find((x) => x.id === params.id);
    if (!ev) return fail(404, "NOT_FOUND", "That event no longer exists.");
    const user = can("activities.view", ev.campus);
    if (user instanceof Response) return user;
    return HttpResponse.json(toEventDetail(ev));
  }),

  ...(["post", "put"] as const).map((method) =>
    http[method](method === "post" ? "/api/activities/events" : "/api/activities/events/:id", async ({ request, params }) => {
      await latency();
      const ctx = ctxFrom(new URL(request.url));
      const existing = method === "put" ? eventsStore.get().find((x) => x.id === params.id) : undefined;
      if (method === "put" && !existing) return fail(404, "NOT_FOUND", "That event no longer exists.");
      const campus = existing?.campus ?? ctx.campus;
      const user = can("activities.manage", campus);
      if (user instanceof Response) return user;
      const ro = readOnly(existing?.session ?? ctx.session) ?? singleCampus(campus, "events");
      if (ro) return ro;
      if (existing && (existing.status === "DONE" || existing.status === "CANCELLED")) return fail(409, "LOCKED", existing.status === "DONE" ? "Results are recorded, so the event details are locked." : "This event is cancelled.");
      const b = await body<ActivitiesEventInput>(request);
      const bad = checkEventInput(b, campus as CampusCode, existing?.session ?? ctx.session);
      if (bad) return bad;
      if (existing) {
        const used = new Set(existing.participants.map((p) => p.item));
        const dropped = [...used].filter((i) => !b.items.includes(i));
        if (dropped.length) return fail(422, "VALIDATION", `Students are registered for ${dropped.join(", ")}. Remove them before taking the item off.`, { field: "items" });
      }
      const fields = {
        title: b.title.trim(),
        titleUrdu: b.titleUrdu?.trim() ?? "",
        kind: b.kind,
        date: b.date,
        endDate: b.endDate || null,
        time: b.time || null,
        period: b.period ?? null,
        venue: b.venue.trim(),
        inCharge: b.inCharge.map((x) => x.trim()),
        forClasses: b.forClasses?.trim() || "All classes",
        houseEvent: Boolean(b.houseEvent),
        items: b.items.map((x) => x.trim()),
        description: b.description?.trim() ?? "",
        pointsRule: b.pointsRule,
      };
      if (existing) {
        const out = updateEvent(existing.id, (e) => ({ ...e, ...fields, history: [...e.history, log(user.name, "Details changed")] }))!;
        return HttpResponse.json(toEventDetail(out));
      }
      const rec: EventRecord = { id: newId("ev"), campus: campus as CampusCode, session: ctx.session, ...fields, status: "PLANNED", participants: [], history: [log(user.name, "Event added to the calendar")] };
      eventsStore.set((list) => [...list, rec]);
      return HttpResponse.json(toEventDetail(rec), { status: 201 });
    }),
  ),

  http.post("/api/activities/events/:id/participants", async ({ request, params }) => {
    await latency();
    const ev = eventsStore.get().find((x) => x.id === params.id);
    if (!ev) return fail(404, "NOT_FOUND", "That event no longer exists.");
    const user = can("activities.manage", ev.campus);
    if (user instanceof Response) return user;
    const ro = readOnly(ev.session);
    if (ro) return ro;
    if (ev.status === "DONE" || ev.status === "CANCELLED") return fail(409, "LOCKED", ev.status === "DONE" ? "Results are recorded; names can no longer be added." : "This event is cancelled.");
    const b = await body<ActivitiesParticipantsInput>(request);
    if (!ev.items.includes(b.item)) return fail(422, "VALIDATION", "Choose the item they take part in.", { field: "item" });
    if (!b.studentIds?.length) return fail(422, "VALIDATION", "Choose at least one student.", { field: "studentIds" });
    const added: ParticipantRecord[] = [];
    for (const id of b.studentIds) {
      const f = findPerson(id);
      if (!f || f.isApplicant) return fail(422, "VALIDATION", "Choose students from the search list.", { field: "studentIds" });
      if (f.campus !== ev.campus) return fail(422, "VALIDATION", `${f.name} studies at another campus.`, { field: "studentIds" });
      if (ev.participants.some((p) => p.studentId === f.id && p.item === b.item)) return fail(409, "DUPLICATE", `${f.name} is already down for ${b.item}.`, { field: "studentIds" });
      added.push({ id: newId("pp"), studentId: f.id, name: f.name, father: f.father, classSection: f.classSection, hasProfile: f.hasProfile, houseId: houseOf(f.campus, f.id).houseId, item: b.item, role: b.role ?? "PARTICIPANT", position: null });
    }
    const out = updateEvent(ev.id, (e) => ({
      ...e,
      status: e.status === "PLANNED" ? "OPEN" : e.status,
      participants: [...e.participants, ...added],
      history: [...e.history, log(user.name, "Names taken", `${added.map((a) => a.name).join(", ")} · ${b.item}`)],
    }))!;
    return HttpResponse.json(toEventDetail(out), { status: 201 });
  }),

  http.delete("/api/activities/events/:id/participants/:pid", async ({ params }) => {
    await latency();
    const ev = eventsStore.get().find((x) => x.id === params.id);
    if (!ev) return fail(404, "NOT_FOUND", "That event no longer exists.");
    const user = can("activities.manage", ev.campus);
    if (user instanceof Response) return user;
    const ro = readOnly(ev.session);
    if (ro) return ro;
    if (ev.status === "DONE") return fail(409, "LOCKED", "Results are recorded; the list of names is locked.");
    const p = ev.participants.find((x) => x.id === params.pid);
    if (!p) return fail(404, "NOT_FOUND", "That name is not on the list.");
    const out = updateEvent(ev.id, (e) => ({ ...e, participants: e.participants.filter((x) => x.id !== p.id), history: [...e.history, log(user.name, "Name removed", `${p.name} · ${p.item}`)] }))!;
    return HttpResponse.json(toEventDetail(out));
  }),

  http.put("/api/activities/events/:id/results", async ({ request, params }) => {
    await latency();
    const ev = eventsStore.get().find((x) => x.id === params.id);
    if (!ev) return fail(404, "NOT_FOUND", "That event no longer exists.");
    const user = can("activities.manage", ev.campus);
    if (user instanceof Response) return user;
    const ro = readOnly(ev.session);
    if (ro) return ro;
    if (ev.status === "CANCELLED") return fail(409, "CANCELLED", "This event was cancelled.");
    if (ev.date > DEMO_TODAY) return fail(409, "NOT_YET", `Results can be recorded on or after the event day (${formatDate(ev.date)}).`);
    if (ev.participants.length === 0) return fail(422, "VALIDATION", "Take names first: nobody is registered.");
    const { positions } = await body<ActivitiesResultsInput>(request);
    const next = ev.participants.map((p) => (positions && p.id in positions ? { ...p, position: positions[p.id] ?? null } : p));
    for (const item of ev.items) {
      for (const place of [1, 2, 3] as const) {
        const who = next.filter((p) => p.item === item && p.position === place);
        if (who.length > 1) return fail(422, "VALIDATION", `${item}: ${who.map((w) => w.name).join(" and ")} both have ${ORD[place]} place. Each place can be given once per item.`, { field: "positions" });
      }
    }
    const placed = next.filter((p) => p.position !== null).length;
    const out = updateEvent(ev.id, (e) => ({ ...e, participants: next, status: "DONE", history: [...e.history, log(user.name, e.status === "DONE" ? "Results corrected" : "Results recorded", `${plural(placed, "place")} given${e.houseEvent ? " · house points posted" : ""}`)] }))!;
    pointsStore.set((list) => [...list.filter((p) => p.eventId !== ev.id), ...eventLedger(out)]);
    return HttpResponse.json(toEventDetail(out));
  }),

  http.post("/api/activities/events/:id/cancel", async ({ request, params }) => {
    await latency();
    const ev = eventsStore.get().find((x) => x.id === params.id);
    if (!ev) return fail(404, "NOT_FOUND", "That event no longer exists.");
    const user = can("activities.manage", ev.campus);
    if (user instanceof Response) return user;
    const ro = readOnly(ev.session);
    if (ro) return ro;
    if (ev.status === "DONE" || ev.status === "CANCELLED") return fail(409, "LOCKED", ev.status === "DONE" ? "Results are recorded; a held event can't be cancelled." : "Already cancelled.");
    const { reason } = await body<{ reason: string }>(request);
    if ((reason?.trim().length ?? 0) < 5) return fail(422, "VALIDATION", "Say why, so teachers and parents know.", { field: "reason" });
    const out = updateEvent(ev.id, (e) => ({ ...e, status: "CANCELLED", cancelReason: reason.trim(), history: [...e.history, log(user.name, "Event cancelled", reason.trim())] }))!;
    return HttpResponse.json(toEventDetail(out));
  }),

  // Sports list (legacy Reports_SportsList): the session's names by house, with the item and the place won.
  http.get("/api/activities/sports-list", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = can("activities.view", ctx.campus);
    if (user instanceof Response) return user;
    const one = singleCampus(ctx.campus, "houses");
    if (one) return one;
    const campus = ctx.campus as CampusCode;
    const houseFilter = url.searchParams.get("houseId") ?? "";
    const kind = url.searchParams.get("kind") ?? "";
    // One class (classSection) or several (classSections, comma-separated); none means every class.
    const classes = new Set([url.searchParams.get("classSection") ?? "", ...(url.searchParams.get("classSections") ?? "").split(",")].map((x) => x.trim()).filter(Boolean));
    const inClass = (classSection: string) => classes.size === 0 || classes.has(classSection);
    const everyone = url.searchParams.get("everyone") === "1";
    if (kind && !(kind in ACTIVITIES_EVENT_KIND_LABEL)) return fail(422, "VALIDATION", "Choose a kind of event from the list.", { field: "kind" });
    if (houseFilter && houseFilter !== "NONE" && !housesStore.get().some((h) => h.id === houseFilter && h.campus === campus))
      return fail(422, "VALIDATION", "That house is not at this campus. Choose a house from the list.", { field: "houseId" });
    const houseMatch = (id: string | null) => (houseFilter === "NONE" ? id === null : !houseFilter || id === houseFilter);
    const events = eventsStore
      .get()
      .filter((e) => inCtx(ctx, e) && e.status !== "CANCELLED" && (!kind || e.kind === kind))
      .sort((a, b) => a.date.localeCompare(b.date));
    const rows: ActivitiesSportsListRow[] = [];
    const used = new Set<string>();
    for (const ev of events)
      for (const p of ev.participants) {
        if (!houseMatch(p.houseId) || !inClass(p.classSection)) continue;
        used.add(ev.id);
        rows.push({
          houseId: p.houseId,
          houseName: houseName(p.houseId),
          eventId: ev.id,
          eventTitle: ev.title,
          eventDate: ev.date,
          kind: ev.kind,
          item: p.item,
          studentId: p.studentId,
          name: p.name,
          father: p.father,
          classSection: p.classSection,
          role: p.role,
          position: p.position,
        });
      }
    // The full house roster: the house's students who took no part, by class.
    const idle: ActivitiesSportsList["idle"] = [];
    if (everyone) {
      const took = new Set(rows.map((r) => r.studentId));
      for (const s of campusStudents(campus)) {
        if (took.has(s.grNo) || !inClass(s.classSection)) continue;
        const h = houseOf(campus, s.grNo).houseId;
        if (!houseMatch(h)) continue;
        idle.push({ studentId: s.grNo, name: s.name, father: s.father, classSection: s.classSection, houseId: h, houseName: houseName(h) });
      }
    }
    const out: ActivitiesSportsList = { campus, session: ctx.session, events: used.size, rows, idle };
    return HttpResponse.json(out);
  }),

  // ---- Catalogue ----
  http.get("/api/activities/catalogue", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = can("activities.view", ctx.campus);
    if (user instanceof Response) return user;
    const events = eventsStore.get();
    const records = recordsStore.get();
    return HttpResponse.json({
      activities: catalogueStore.get().map((a) => ({ ...a, uses: records.filter((r) => r.activityId === a.id).length + events.filter((e) => e.items.some((i) => i.toLowerCase().startsWith(a.name.toLowerCase()))).length })),
      venues: venuesStore
        .get()
        .filter((v) => ctx.campus === "ALL" || v.campus === ctx.campus)
        .map((v) => ({ ...v, shortName: v.shortName ?? "", uses: events.filter((e) => e.campus === v.campus && e.venue === v.name).length })),
    });
  }),

  ...(["post", "put"] as const).map((method) =>
    http[method](method === "post" ? "/api/activities/catalogue/activities" : "/api/activities/catalogue/activities/:id", async ({ request, params }) => {
      await latency();
      const ctx = ctxFrom(new URL(request.url));
      const user = can("activities.manage", ctx.campus);
      if (user instanceof Response) return user;
      const b = await body<{ name: string; kind: ActivitiesCatalogKind; active: boolean }>(request);
      const id = method === "put" ? String(params.id) : undefined;
      const name = b.name?.trim() ?? "";
      if (name.length < 2) return fail(422, "VALIDATION", "Enter the activity's name.", { field: "name" });
      if (!ACTIVITIES_CATALOG_KIND_LABEL[b.kind]) return fail(422, "VALIDATION", "Choose what kind of activity it is.", { field: "kind" });
      if (catalogueStore.get().some((a) => a.id !== id && a.name.toLowerCase() === name.toLowerCase())) return fail(422, "VALIDATION", `“${name}” is already in the list.`, { field: "name" });
      const rec = { id: id ?? newId("ac"), name, kind: b.kind, active: Boolean(b.active) };
      catalogueStore.set((list) => (id ? list.map((a) => (a.id === id ? rec : a)) : [...list, rec]));
      return HttpResponse.json({ ...rec, uses: 0 }, { status: id ? 200 : 201 });
    }),
  ),

  ...(["post", "put"] as const).map((method) =>
    http[method](method === "post" ? "/api/activities/catalogue/venues" : "/api/activities/catalogue/venues/:id", async ({ request, params }) => {
      await latency();
      const ctx = ctxFrom(new URL(request.url));
      const id = method === "put" ? String(params.id) : undefined;
      const existing = id ? venuesStore.get().find((v) => v.id === id) : undefined;
      const campus = existing?.campus ?? ctx.campus;
      const user = can("activities.manage", campus);
      if (user instanceof Response) return user;
      const one = singleCampus(campus, "venues");
      if (one) return one;
      const b = await body<{ name: string; shortName?: string; active: boolean }>(request);
      const name = b.name?.trim() ?? "";
      if (name.length < 2) return fail(422, "VALIDATION", "Enter the place's name.", { field: "name" });
      if (venuesStore.get().some((v) => v.id !== id && v.campus === campus && v.name.toLowerCase() === name.toLowerCase())) return fail(422, "VALIDATION", `“${name}” is already in the list.`, { field: "name" });
      const shortName = b.shortName?.trim() ?? existing?.shortName ?? "";
      if (shortName.length > 12) return fail(422, "VALIDATION", "Keep the short title to 12 letters, for example “Hall”.", { field: "shortName" });
      if (shortName && venuesStore.get().some((v) => v.id !== id && v.campus === campus && (v.shortName ?? "").toLowerCase() === shortName.toLowerCase())) return fail(422, "VALIDATION", `Another place here is already “${shortName}”. Choose a different short title.`, { field: "shortName" });
      const rec: VenueRecord = { id: id ?? newId("vn"), campus: campus as CampusCode, name, shortName, active: Boolean(b.active) };
      venuesStore.set((list) => (id ? list.map((v) => (v.id === id ? rec : v)) : [...list, rec]));
      return HttpResponse.json({ ...rec, uses: 0 }, { status: id ? 200 : 201 });
    }),
  ),

  // ---- Co-curricular record ----
  http.get("/api/activities/records/:id", async ({ request, params }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = can("activities.view", ctx.campus);
    if (user instanceof Response) return user;
    const rec = studentRecord(String(params.id));
    if (!rec) return fail(404, "NOT_FOUND", "No student with that G.R. number.");
    if (ctx.campus !== "ALL" && rec.person.campus !== ctx.campus) return fail(404, "OTHER_CAMPUS", `${rec.person.name} studies at another campus. Switch campus to see the record.`);
    return HttpResponse.json(rec);
  }),

  http.post("/api/activities/records/:id", async ({ request, params }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const f = findPerson(String(params.id));
    if (!f || f.isApplicant) return fail(404, "NOT_FOUND", "No student with that G.R. number.");
    const user = can("activities.manage", f.campus);
    if (user instanceof Response) return user;
    const ro = readOnly(ctx.session);
    if (ro) return ro;
    const b = await body<ActivitiesRecordInput>(request);
    if ((b.title?.trim().length ?? 0) < 3) return fail(422, "VALIDATION", "Say what the activity was, for example “Inter-school cricket tournament”.", { field: "title" });
    const { starts } = sessionOf(ctx.session);
    if (!b.date || b.date < starts || b.date > DEMO_TODAY) return fail(422, "VALIDATION", `The date must be between ${formatDate(starts)} and today.`, { field: "date" });
    if ((b.achievement?.trim().length ?? 0) < 3) return fail(422, "VALIDATION", "Describe the part played or the result.", { field: "achievement" });
    const act = b.activityId ? catalogueStore.get().find((a) => a.id === b.activityId) : undefined;
    const rec: ManualRecord = {
      id: newId("mr"),
      campus: f.campus,
      session: ctx.session,
      studentId: f.id,
      title: b.title.trim(),
      activityId: act?.id ?? null,
      kindLabel: act ? (act.kind === "SPORT" ? "Sports" : ACTIVITIES_CATALOG_KIND_LABEL[act.kind]) : "Other",
      date: b.date,
      role: b.role,
      position: b.position,
      achievement: b.achievement.trim(),
      by: user.name,
    };
    recordsStore.set((list) => [rec, ...list]);
    return HttpResponse.json(studentRecord(f.id), { status: 201 });
  }),

  // ---- Certificates ----
  http.get("/api/activities/certificates", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = can("activities.view", ctx.campus);
    if (user instanceof Response) return user;
    return HttpResponse.json(
      certsStore
        .get()
        .filter((c) => inCtx(ctx, c))
        .sort((a, b) => b.certNo.localeCompare(a.certNo))
        .map(toCert),
    );
  }),

  http.post("/api/activities/certificates", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = can("activities.manage", ctx.campus);
    if (user instanceof Response) return user;
    const ro = readOnly(ctx.session) ?? singleCampus(ctx.campus, "certificates");
    if (ro) return ro;
    const campus = ctx.campus as CampusCode;
    const b = await body<ActivitiesIssueInput>(request);
    const issued: CertificateRecord[] = [];
    const existing: CertificateRecord[] = [];
    const all = [...certsStore.get()];
    const add = (c: Omit<CertificateRecord, "id" | "certNo" | "campus" | "session" | "issuedOn" | "issuedBy" | "prints">) => {
      const rec: CertificateRecord = { ...c, id: newId("crt"), certNo: nextCertNo(campus, ctx.session, all), campus, session: ctx.session, issuedOn: DEMO_TODAY, issuedBy: user.name, prints: 0 };
      all.push(rec);
      issued.push(rec);
    };
    if (b.type === "PARTICIPATION" || b.type === "MERIT") {
      const ev = eventsStore.get().find((e) => e.id === b.eventId && e.campus === campus);
      if (!ev) return fail(422, "VALIDATION", "Choose the event.", { field: "eventId" });
      if (ev.date > DEMO_TODAY || ev.status === "CANCELLED") return fail(409, "NOT_HELD", ev.status === "CANCELLED" ? "This event was cancelled." : `Certificates are issued after the event (${formatDate(ev.date)}).`);
      if (b.type === "MERIT" && ev.status !== "DONE") return fail(409, "NO_RESULTS", "Record the results first: merit certificates name the place won.");
      const ids = new Set(b.participantIds ?? []);
      const people = ev.participants.filter((p) => ids.has(p.id));
      if (!people.length) return fail(422, "VALIDATION", "Tick the students to issue certificates to.", { field: "participantIds" });
      for (const p of people) {
        if (b.type === "MERIT" && !p.position) return fail(422, "VALIDATION", `${p.name} has no place in ${p.item}. Give a participation certificate instead.`, { field: "participantIds" });
        const dup = all.find((c) => c.eventId === ev.id && c.studentId === p.studentId && c.item === p.item && c.type === b.type);
        if (dup) {
          existing.push(dup);
          continue;
        }
        add({ type: b.type, studentId: p.studentId, studentName: p.name, father: p.father, classSection: p.classSection, houseName: houseName(p.houseId), eventId: ev.id, eventTitle: ev.title, eventDate: ev.date, item: p.item, role: p.role, position: p.position, wording: b.wording?.trim() || certWording(b.type, { item: p.item, position: p.position, eventTitle: ev.title, eventDate: ev.date }) });
      }
    } else if (b.type === "APPRECIATION") {
      const title = b.title?.trim() ?? "";
      if (title.length < 5) return fail(422, "VALIDATION", "Say what the appreciation is for, for example “Outstanding service as a library prefect”.", { field: "title" });
      if (!b.studentIds?.length) return fail(422, "VALIDATION", "Choose at least one student.", { field: "studentIds" });
      for (const id of b.studentIds) {
        const f = findPerson(id);
        if (!f || f.isApplicant || f.campus !== campus) return fail(422, "VALIDATION", "Choose students of this campus from the search list.", { field: "studentIds" });
        add({ type: "APPRECIATION", studentId: f.id, studentName: f.name, father: f.father, classSection: f.classSection, houseName: houseName(houseOf(campus, f.id).houseId), eventId: null, eventTitle: title, eventDate: null, item: null, role: null, position: null, wording: b.wording?.trim() || certWording("APPRECIATION", { item: null, position: null, eventTitle: title, eventDate: null }) });
      }
    } else if (b.type === "SCHOLARSHIP") {
      const a = awardsStore.get().find((x) => x.id === b.title);
      if (!a || a.campus !== campus) return fail(422, "VALIDATION", "Choose the award.", { field: "title" });
      if (a.status !== "APPROVED") return fail(409, "NOT_APPROVED", "Award letters are printed once the award is approved.");
      const x = toAward(a);
      const dup = all.find((c) => c.type === "SCHOLARSHIP" && c.eventTitle === `${x.schemeName} · ${x.awardNo}`);
      if (dup) existing.push(dup);
      else
        add({
          type: "SCHOLARSHIP",
          studentId: a.studentId,
          studentName: a.studentName,
          father: a.father,
          classSection: a.classSection,
          houseName: null,
          eventId: null,
          eventTitle: `${x.schemeName} · ${x.awardNo}`,
          eventDate: a.effectiveFrom,
          item: null,
          role: null,
          position: null,
          wording: `has been awarded the ${x.schemeName.toLowerCase()} for session ${formatSession(a.session)}: ${x.valueText}, from ${formatDate(a.effectiveFrom)}. The award continues while the conditions of the scheme are met.`,
        });
    } else return fail(422, "VALIDATION", "Choose the type of certificate.", { field: "type" });
    certsStore.set(all);
    return HttpResponse.json([...issued, ...existing].map(toCert), { status: 201 });
  }),

  http.post("/api/activities/certificates/print", async ({ request }) => {
    await latency();
    const { ids } = await body<{ ids: string[] }>(request);
    const set = new Set(ids ?? []);
    const first = certsStore.get().find((c) => set.has(c.id));
    if (!first) return fail(422, "VALIDATION", "Nothing to print.");
    const user = can("activities.view", first.campus);
    if (user instanceof Response) return user;
    certsStore.set((list) => list.map((c) => (set.has(c.id) ? { ...c, prints: c.prints + 1 } : c)));
    return HttpResponse.json(certsStore.get().filter((c) => set.has(c.id)).map(toCert));
  }),
];

/** Pending scholarship awards a user may decide (for an approvals inbox elsewhere). */
export function activitiesPendingAwards(user: SessionUser, campus: CampusScope): ActivitiesAward[] {
  return awardsStore
    .get()
    .filter((a) => a.status === "PENDING" && a.session === CURRENT_SESSION && (campus === "ALL" || a.campus === campus) && a.proposedBy !== user.name)
    .map(toAward);
}
