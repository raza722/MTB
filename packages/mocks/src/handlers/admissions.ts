import {
  ADMISSIONS_FIELD_LABEL,
  ADMISSIONS_STAGES,
  admissionsPapersFor,
  type AdmissionsSaveMeritInput,
  type AdmissionsSavedMeritList,
  type AdmissionsTestSubject,
  type AdmissionsAdmitInput,
  type AdmissionsApplicant,
  type AdmissionsApplicationInput,
  type AdmissionsCheckResult,
  type AdmissionsDecision,
  type AdmissionsDuplicateCase,
  type AdmissionsEnquiry,
  type AdmissionsEnquiryInput,
  type AdmissionsField,
  type AdmissionsMarksRow,
  type AdmissionsMeritList,
  type AdmissionsPersonRecord,
  type AdmissionsPipeline,
  type AdmissionsPlacement,
  type AdmissionsStage,
  type AdmissionsTest,
  type AdmissionsTestInput,
  type CampusCode,
} from "@mtb/api";
import { formatDate, formatSession, isValidCnic, normalizeCnic, normalizeMobile, type IsoDate } from "@mtb/domain";
import { http, type HttpHandler } from "msw";
import { CURRENT_SESSION, DEMO_TODAY, demoNow } from "../clock";
import { createStore } from "../db";
import { ADMISSION_TESTS, applicantRecord, CLASS_RULES, INITIAL_DECISIONS, initialApplicants, initialDuplicateCases, initialEnquiries, initialTests, ruleFor, subjectsFor } from "../fixtures/admissions";
import { campusName } from "../fixtures/campuses";
import { HOUSES } from "../fixtures/student-records";
import { findStudent, STUDENTS } from "../fixtures/students";
import { ctxFrom, fail, HttpResponse, latency, requirePermission } from "../util";
import { currentUser } from "./auth-state";
import { preparedFor, queueSms } from "./sms";
import { admitStudent, familyIdOf, mergeStudentRecords, peekGrNo, sectionStats, toSummary } from "./student-records";

type TestRecord = Omit<AdmissionsTest, "candidates" | "feePaid" | "marked" | "status">;

interface AdmissionsState {
  applicants: AdmissionsApplicant[];
  cases: AdmissionsDuplicateCase[];
  decisions: AdmissionsDecision[];
  enquiries: AdmissionsEnquiry[];
  tests: TestRecord[];
  appSeq: Partial<Record<CampusCode, number>>;
  enqSeq: Partial<Record<CampusCode, number>>;
  feeSeq: Partial<Record<CampusCode, number>>;
  /** Merit lists saved as numbered rounds (optional: a demo started before this existed keeps working). */
  meritLists?: StoredMeritList[];
  /** Idempotency-Key → done */
  idem: Record<string, string>;
}

type StoredMeritList = AdmissionsSavedMeritList & { campus: CampusCode; session: number; gender?: "F" | "M" };

export const admissionsStore = createStore<AdmissionsState>("admissions", () => {
  const applicants = initialApplicants();
  const maxOf = (xs: string[]) => Math.max(0, ...xs.map((x) => Number(x.split("-").pop())));
  const seqFor = (campus: CampusCode, list: string[]) => maxOf(list.filter((n) => n.startsWith(campus)));
  const enquiries = initialEnquiries();
  const campuses: CampusCode[] = ["KC", "SM", "UC", "MC", "HC"];
  return {
    applicants,
    cases: initialDuplicateCases(applicants),
    decisions: INITIAL_DECISIONS,
    enquiries,
    tests: initialTests(),
    appSeq: Object.fromEntries(campuses.map((c) => [c, seqFor(c, applicants.map((a) => a.applicationNo))])),
    enqSeq: Object.fromEntries(campuses.map((c) => [c, seqFor(c, enquiries.map((e) => e.enquiryNo))])),
    feeSeq: Object.fromEntries(campuses.map((c) => [c, seqFor(c, applicants.map((a) => a.fee?.receiptNo ?? "").filter(Boolean))])),
    idem: {},
  };
});

/** Seats on a class's merit list (the class's default). */
export const admissionsSeats = (cls: string) => ADMISSION_TESTS[cls]?.seats ?? 0;

/** Merit order: score (as a share of the test's marks) high to low, then earlier date of birth, then application number. */
function ranked(list: AdmissionsApplicant[]): AdmissionsApplicant[] {
  return [...list].sort((a, b) => (b.testScore ?? -1) / b.testMax - (a.testScore ?? -1) / a.testMax || a.dob.localeCompare(b.dob) || a.applicationNo.localeCompare(b.applicationNo));
}

/** On the merit list: tested and ranked, offered, or admitted from an offer. */
const onMerit = (a: AdmissionsApplicant) => a.testScore !== null && (a.stage === "MERIT" || a.stage === "OFFERED" || (a.stage === "ADMITTED" && Boolean(a.offeredOn)));

/** Papers a candidate sits in a sitting: the common ones and their own group's. */
const papersOf = (subjects: AdmissionsTestSubject[], stream?: string) => admissionsPapersFor(subjects, stream);
const maxOf = (subjects: AdmissionsTestSubject[]) => subjects.reduce((x, s) => x + s.max, 0);

/** Saved rounds of a class's merit list at a campus, oldest first. */
const savedLists = (st: AdmissionsState, campus: CampusCode, session: number, cls: string) => (st.meritLists ?? []).filter((l) => l.campus === campus && l.session === session && l.classApplied === cls).sort((a, b) => a.round - b.round);

/**
 * One merit list: tested candidates of a class (one sitting and one gender when chosen), ranked. Once a round has been
 * saved, candidates already offered a seat are left out, so the next list ranks only those still waiting.
 */
function meritRows(st: AdmissionsState, campus: CampusCode, session: number, cls: string, q: { testId?: string | undefined; gender?: string | undefined }): AdmissionsApplicant[] {
  let pool = st.applicants.filter((a) => a.session === session && a.campus === campus && a.classApplied === cls && onMerit(a) && (!q.testId || a.testId === q.testId) && (!q.gender || a.gender === q.gender));
  if (savedLists(st, campus, session, cls).length) pool = pool.filter((a) => a.stage === "MERIT");
  return ranked(pool);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Checks and tidies the rest of the admission form (shared by the application). Returns an error Response or the clean fields. */
function cleanExtras(body: Partial<AdmissionsApplicationInput>): Response | Partial<AdmissionsApplicant> {
  const err = (field: string, message: string) => fail(422, "VALIDATION", message, { field });
  const t = (v: string | undefined) => (v ?? "").trim();
  const out: Partial<AdmissionsApplicant> = {};
  for (const k of ["religion", "disability", "identificationMark", "city", "tempAddress", "fatherQualification", "fatherOccupation", "motherQualification", "motherOccupation", "admissionReference"] as const) {
    const v = t(body[k]);
    if (v.length > 120) return err(k, "Keep this under 120 letters.");
    if (v) out[k] = v;
  }
  const bc = t(body.birthCertificateNo);
  if (bc && !/^[A-Za-z0-9/-]{4,20}$/.test(bc)) return err("birthCertificateNo", "A birth certificate number is 4 to 20 letters, digits or dashes.");
  if (bc) out.birthCertificateNo = bc;
  const email = t(body.email);
  if (email && !EMAIL.test(email)) return err("email", "Enter an email address such as name@example.com.");
  if (email) out.email = email.toLowerCase();
  const home = t(body.homePhone).replace(/[\s-]/g, "");
  if (home && !/^0\d{9,10}$/.test(home)) return err("homePhone", "Enter a landline with the area code, e.g. 068-5551234.");
  if (home) out.homePhone = home;
  const ec = body.emergencyContact;
  if (ec && (t(ec.name) || t(ec.mobile1) || t(ec.mobile2))) {
    if (t(ec.name).length < 3) return err("emergencyName", "Enter the emergency contact's name.");
    const m1 = normalizeMobile(t(ec.mobile1));
    if (!m1) return err("emergencyMobile1", "Enter the emergency contact's mobile, e.g. 0300-1234567.");
    const m2 = t(ec.mobile2) ? normalizeMobile(t(ec.mobile2)) : "";
    if (m2 === null) return err("emergencyMobile2", "The second mobile is not a Pakistani mobile number.");
    out.emergencyContact = { name: t(ec.name), mobile1: m1, ...(m2 ? { mobile2: m2 } : {}) };
  }
  if (body.hostel !== undefined) out.hostel = Boolean(body.hostel);
  return out;
}

const refOf = (r: AdmissionsDuplicateCase["left"]) => `${r.fields.name} (${r.ref})`;
const by = () => currentUser()?.name ?? "Admissions office";
const now = () => demoNow();

function addDays(d: IsoDate, n: number): IsoDate {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

const norm = (v: string) => v.toLowerCase().replace(/[^a-z]/g, "");
/** Levenshtein similarity, 0–1. */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - (prev[b.length] ?? 0) / Math.max(a.length, b.length);
}

/** Matching rules shared by the live check and new-application duplicate detection. */
function matchPerson(p: { name: string; father: string; fatherCnic: string; dob: IsoDate | ""; mobile?: string }, o: { name: string; father: string; fatherCnic: string; dob: IsoDate | ""; mobile?: string }): { strength: number; reasons: string[] } {
  const reasons: string[] = [];
  let strength = 0;
  const nameSim = similarity(norm(p.name), norm(o.name));
  const fatherSim = similarity(norm(p.father), norm(o.father));
  if (p.fatherCnic && p.fatherCnic === o.fatherCnic) {
    reasons.push("Same father's CNIC");
    strength += 35;
  }
  if (p.dob && p.dob === o.dob) {
    reasons.push("Same date of birth");
    strength += 30;
  }
  if (nameSim === 1) {
    reasons.push("Same name");
    strength += 25;
  } else if (nameSim >= 0.75) {
    reasons.push(`Similar names: ${p.name} and ${o.name}`);
    strength += 18;
  }
  if (fatherSim >= 0.8) {
    reasons.push(fatherSim === 1 ? "Same father's name" : `Similar father's names: ${p.father} and ${o.father}`);
    strength += 10;
  }
  if (p.mobile && o.mobile && normalizeMobile(p.mobile) === normalizeMobile(o.mobile)) {
    reasons.push("Same guardian mobile");
    strength += 10;
  }
  // A shared father's CNIC with a different name and birthday is a sibling, not a duplicate.
  if (nameSim < 0.75) strength = Math.min(strength, 40);
  return { strength: Math.min(99, strength), reasons };
}

function testWithCounts(t: TestRecord, applicants: AdmissionsApplicant[]): AdmissionsTest {
  const sitting = applicants.filter((a) => a.testId === t.id && a.stage !== "WITHDRAWN");
  const marked = sitting.filter((a) => a.testScore !== null || a.absentFromTest).length;
  return {
    ...t,
    candidates: sitting.length,
    feePaid: sitting.filter((a) => a.fee?.status !== "DUE").length,
    marked,
    status: t.date > DEMO_TODAY ? "UPCOMING" : sitting.length > 0 && marked < sitting.length ? "MARKING" : "DONE",
  };
}

/** Children already at MTB with the applicant's father's CNIC. */
function siblingsOf(a: AdmissionsApplicant): AdmissionsApplicant["siblings"] {
  if (!a.fatherCnic) return [];
  return STUDENTS.filter((s) => !s.mergedInto && s.fatherCnic === a.fatherCnic && s.grNo !== a.grNo && s.status === "ACTIVE").map((s) => ({ grNo: s.grNo, name: s.name, classSection: s.classSection, campusName: s.campusName }));
}

const withSiblings = (a: AdmissionsApplicant): AdmissionsApplicant => ({ ...a, siblings: siblingsOf(a) });

function history(a: AdmissionsApplicant, text: string): AdmissionsApplicant {
  return { ...a, history: [...(a.history ?? []), { at: now(), text, by: by() }] };
}

/** The applicant's story, rebuilt from the fixture fields when there is no recorded history yet. */
function storyOf(a: AdmissionsApplicant): AdmissionsApplicant {
  if (a.history?.length) return a;
  const h: NonNullable<AdmissionsApplicant["history"]> = [{ at: `${a.appliedOn}T10:00:00+05:00`, text: `Application ${a.applicationNo} received${a.source === "WEB" ? " from the website" : a.enquiryNo ? ` (enquiry ${a.enquiryNo})` : " at the front desk"}` }];
  if (a.fee?.status === "PAID") h.push({ at: `${a.fee.paidOn ?? a.appliedOn}T10:05:00+05:00`, text: `Candidate fee Rs ${a.fee.amount.toLocaleString("en-US")} paid · ${a.fee.receiptNo}` });
  if (a.testDate) h.push({ at: `${a.testDate}T09:00:00+05:00`, text: `Entrance test ${a.testDate > DEMO_TODAY ? "scheduled for" : "on"} ${formatDate(a.testDate)}${a.testRollNo ? ` · seat ${a.testRollNo}` : ""}` });
  if (a.testScore !== null) h.push({ at: `${a.testDate ?? a.appliedOn}T16:00:00+05:00`, text: `Test marked: ${a.testScore} / ${a.testMax}` });
  if (a.offeredOn) h.push({ at: `${a.offeredOn}T12:00:00+05:00`, text: `Admission offered${a.offerValidUntil ? ` (valid until ${formatDate(a.offerValidUntil)})` : ""}`, ...(a.offeredBy ? { by: a.offeredBy } : {}) });
  if (a.grNo) h.push({ at: `${a.admittedOn ?? a.offeredOn ?? a.appliedOn}T12:30:00+05:00`, text: `Admitted to ${a.admittedClassSection ?? a.classApplied} · G.R. ${a.grNo}` });
  if (a.withdrawnOn) h.push({ at: `${a.withdrawnOn}T12:00:00+05:00`, text: `Withdrawn: ${a.withdrawnReason ?? ""}` });
  return { ...a, history: h };
}

function saveApplicant(next: AdmissionsApplicant) {
  admissionsStore.set((st) => ({ ...st, applicants: st.applicants.map((a) => (a.id === next.id ? next : a)) }));
}

function issueFeeReceipt(campus: CampusCode): string {
  const st = admissionsStore.get();
  const n = (st.feeSeq[campus] ?? 400) + 1;
  admissionsStore.set({ ...st, feeSeq: { ...st.feeSeq, [campus]: n } });
  return `${campus}-CF-2627-${String(n).padStart(6, "0")}`;
}

function seatNo(cls: string, testId: string, applicants: AdmissionsApplicant[]): string {
  const n = applicants.filter((a) => a.testId === testId).length + 1;
  return `T${cls.replace("Class ", "").replace("Prep", "P")}-${String(100 + n).slice(1).padStart(3, "0")}`;
}

const markIdem = (key: string | null, value: string) => {
  if (key) admissionsStore.set((st) => ({ ...st, idem: { ...st.idem, [key]: value } }));
};

/** Applications at a campus in a session, as Admissions holds them now (Messages → Admission candidates, Scholarships). */
export function admissionApplicants(campus: CampusCode, session: number): AdmissionsApplicant[] {
  return admissionsStore.get().applicants.filter((a) => a.campus === campus && a.session === session);
}

export const admissionsHandlers: HttpHandler[] = [
  http.get("/api/admissions/pipeline", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("admissions.view", ctx.campus);
    if (user instanceof Response) return user;
    const st = admissionsStore.get();
    const applicants = st.applicants
      .filter((a) => a.session === ctx.session && (ctx.campus === "ALL" || a.campus === ctx.campus))
      .sort((a, b) => b.appliedOn.localeCompare(a.appliedOn))
      .map(withSiblings);
    const stages: AdmissionsStage[] = [...ADMISSIONS_STAGES, "WITHDRAWN"];
    const counts = Object.fromEntries(stages.map((s) => [s, applicants.filter((a) => a.stage === s).length])) as Record<AdmissionsStage, number>;
    const body: AdmissionsPipeline = {
      campus: ctx.campus,
      session: ctx.session,
      counts,
      applicants,
      openEnquiries: st.enquiries.filter((e) => e.session === ctx.session && e.status === "OPEN" && (ctx.campus === "ALL" || e.campus === ctx.campus)).length,
      admittedThisWeek: applicants.filter((a) => a.stage === "ADMITTED" && (a.admittedOn ?? "") >= addDays(DEMO_TODAY, -7)).length,
    };
    return HttpResponse.json(body);
  }),

  http.get("/api/admissions/applicants/:id", async ({ params }) => {
    await latency();
    const a = admissionsStore.get().applicants.find((x) => x.id === String(params.id));
    if (!a) return fail(404, "NOT_FOUND", "This application is no longer on record. It may have been merged.");
    const user = requirePermission("admissions.view", a.campus);
    if (user instanceof Response) return user;
    return HttpResponse.json(storyOf(withSiblings(a)));
  }),

  http.get("/api/admissions/setup", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("admissions.view", ctx.campus);
    if (user instanceof Response) return user;
    const st = admissionsStore.get();
    const tests = st.tests
      .filter((t) => t.session === ctx.session && (ctx.campus === "ALL" || t.campus === ctx.campus))
      .map((t) => testWithCounts(t, st.applicants))
      .sort((a, b) => b.date.localeCompare(a.date));
    return HttpResponse.json({ campus: ctx.campus, session: ctx.session, classes: CLASS_RULES.map((r) => ({ ...r, streams: r.streams ?? [] })), tests });
  }),

  /* ---------------- merit list and offers ---------------- */
  http.get("/api/admissions/merit", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requirePermission("admissions.view", ctx.campus);
    if (user instanceof Response) return user;
    if (ctx.campus === "ALL") return fail(400, "CAMPUS_REQUIRED", "Merit lists belong to one campus. Choose a campus.");
    const st = admissionsStore.get();
    const pool = st.applicants.filter((a) => a.session === ctx.session && a.campus === ctx.campus && onMerit(a));
    const classes = Object.keys(ADMISSION_TESTS).filter((c) => pool.some((a) => a.classApplied === c));
    const cls = url.searchParams.get("class") || classes[0] || "Class 6";
    const def = ADMISSION_TESTS[cls] ?? { testName: `${cls} entrance test`, testDate: DEMO_TODAY, max: 100, seats: 0 };
    const sittings = st.tests.filter((t) => t.campus === ctx.campus && t.session === ctx.session && t.classApplied === cls).sort((a, b) => a.date.localeCompare(b.date));
    const testId = url.searchParams.get("testId") ?? "";
    const sitting = testId ? sittings.find((t) => t.id === testId) : undefined;
    if (testId && !sitting) return fail(422, "VALIDATION", `Choose a ${cls} sitting.`, { field: "testId" });
    const g = url.searchParams.get("gender") ?? "";
    const gender = g === "F" || g === "M" ? g : "";
    const seatsRaw = url.searchParams.get("seats");
    const seats = seatsRaw === null || seatsRaw === "" ? def.seats : Number(seatsRaw);
    if (!Number.isInteger(seats) || seats < 0 || seats > 500) return fail(422, "VALIDATION", "Seats on the list must be a whole number up to 500.", { field: "seats" });
    const rows = meritRows(st, ctx.campus, ctx.session, cls, { testId, gender }).map((applicant, i) => ({ rank: i + 1, applicant }));
    const inside = rows.slice(0, seats);
    const waiting = rows.slice(seats, seats * 2);
    // Papers: the sitting's, or every paper set for the class's sittings (by name, first seen).
    const subjects: AdmissionsTestSubject[] = [];
    for (const t of sitting ? [sitting] : sittings) for (const s of t.subjects) if (!subjects.some((x) => x.subject === s.subject)) subjects.push(s);
    const scope = st.applicants.filter((a) => a.session === ctx.session && a.campus === ctx.campus && a.classApplied === cls && a.testId && (!testId || a.testId === testId) && (!gender || a.gender === gender) && (sittings.find((t) => t.id === a.testId)?.date ?? "9999") <= DEMO_TODAY);
    const saved = savedLists(st, ctx.campus, ctx.session, cls);
    const body: AdmissionsMeritList = {
      classApplied: cls,
      classes,
      testName: sitting?.name ?? def.testName,
      testDate: sitting?.date ?? def.testDate,
      seats,
      cutoffScore: inside.length ? (inside[inside.length - 1]?.applicant.testScore ?? null) : null,
      rows,
      subjects,
      round: saved.length + 1,
      tests: sittings.map((t) => ({ id: t.id, name: t.name, date: t.date })),
      saved: [...saved].reverse().map(({ campus: _c, session: _s, gender: _g, ...l }) => l),
      counts: {
        appeared: scope.filter((a) => a.testScore !== null).length,
        absent: scope.filter((a) => a.absentFromTest).length,
        inside: inside.length,
        waiting: waiting.length,
        notSelected: Math.max(0, rows.length - inside.length - waiting.length),
      },
    };
    return HttpResponse.json(body);
  }),

  http.post("/api/admissions/merit/lists", async ({ request }) => {
    await latency();
    const key = request.headers.get("Idempotency-Key");
    const body = (await request.json()) as AdmissionsSaveMeritInput & { campus: CampusCode | "ALL"; session: number };
    if (body.campus === "ALL") return fail(400, "CAMPUS_REQUIRED", "Merit lists belong to one campus. Choose a campus.");
    const user = requirePermission("admissions.manage", body.campus);
    if (user instanceof Response) return user;
    const st = admissionsStore.get();
    if (key && st.idem[key]) {
      const done = (st.meritLists ?? []).find((l) => l.id === st.idem[key]);
      if (done) return HttpResponse.json(done);
    }
    if (body.session !== CURRENT_SESSION) return fail(409, "SESSION_READ_ONLY", `${formatSession(body.session)} is closed.`);
    if (!ADMISSION_TESTS[body.classApplied]) return fail(422, "VALIDATION", `${body.classApplied} has no entrance test, so no merit list.`, { field: "classApplied" });
    if (!Number.isInteger(body.seats) || body.seats < 1 || body.seats > 500) return fail(422, "VALIDATION", "Enter the number of seats on this list (1 to 500).", { field: "seats" });
    const title = (body.title ?? "").trim();
    if (title.length < 3) return fail(422, "VALIDATION", "Give the list a title, for example “2nd merit list”.", { field: "title" });
    const rows = meritRows(st, body.campus, body.session, body.classApplied, { testId: body.testId, gender: body.gender ?? "" });
    if (rows.length === 0) return fail(422, "VALIDATION", "Nobody is waiting on this list. Mark the test first, or choose another sitting.", { field: "seats" });
    const round = savedLists(st, body.campus, body.session, body.classApplied).length + 1;
    const saved: StoredMeritList = {
      id: `ml-${body.campus}-${body.classApplied.replace(/\s+/g, "")}-${round}`,
      campus: body.campus,
      session: body.session,
      round,
      title,
      classApplied: body.classApplied,
      testId: body.testId || null,
      ...(body.gender ? { gender: body.gender } : {}),
      seats: body.seats,
      selected: rows.slice(0, body.seats).map((a) => a.id),
      savedOn: DEMO_TODAY,
      savedBy: user.name,
    };
    admissionsStore.set((s) => ({ ...s, meritLists: [...(s.meritLists ?? []), saved], idem: key ? { ...s.idem, [key]: saved.id } : s.idem }));
    const { campus: _c, session: _s, gender: _g, ...out } = saved;
    return HttpResponse.json(out, { status: 201 });
  }),

  http.post("/api/admissions/offers", async ({ request }) => {
    await latency();
    const key = request.headers.get("Idempotency-Key");
    if (!key) return fail(400, "IDEMPOTENCY_KEY_REQUIRED", "Missing idempotency key.");
    const { campus, session, applicantIds, list } = (await request.json()) as { campus: AdmissionsApplicant["campus"]; session: number; applicantIds: string[]; list?: { classApplied: string; testId?: string; gender?: string; seats?: number } };
    const user = requirePermission("admissions.manage", campus);
    if (user instanceof Response) return user;
    const state = admissionsStore.get();
    if (state.idem[key]) {
      const ids = new Set(state.idem[key].split(","));
      return HttpResponse.json({ offered: state.applicants.filter((a) => ids.has(a.id)) });
    }
    if (session !== CURRENT_SESSION) return fail(409, "SESSION_READ_ONLY", "2025–26 is closed. Switch to 2026–27 to offer admission.");
    if (!applicantIds?.length) return fail(422, "VALIDATION", "Select at least one applicant above the cut-off.");
    const targets = state.applicants.filter((a) => applicantIds.includes(a.id));
    if (targets.length !== applicantIds.length || targets.some((a) => a.stage !== "MERIT" || a.campus !== campus)) {
      return fail(409, "NOT_ON_MERIT_LIST", "Some of these applicants are no longer on the merit list. Reload the list.");
    }
    // Only applicants inside the seats of the list on screen (sitting, gender and seats chosen there) can be offered.
    for (const cls of new Set(targets.map((a) => a.classApplied))) {
      const q: { testId?: string; gender?: string; seats?: number } = list?.classApplied === cls ? list : {};
      const seats = q.seats ?? ADMISSION_TESTS[cls]?.seats ?? 0;
      const order = meritRows(state, campus, session, cls, { testId: q.testId, gender: q.gender });
      const inside = new Set(order.slice(0, seats).map((a) => a.id));
      if (targets.some((a) => a.classApplied === cls && !inside.has(a.id))) return fail(422, "BELOW_CUTOFF", `Only the top ${seats} on the ${cls} merit list can be offered admission.`);
    }
    const ids = new Set(applicantIds);
    const until = addDays(DEMO_TODAY, 7);
    const updated = state.applicants.map((a) =>
      ids.has(a.id) ? history({ ...storyOf(a), stage: "OFFERED" as const, offeredOn: DEMO_TODAY, offeredBy: user.name, offerValidUntil: until }, `Admission offered from the merit list (valid until ${formatDate(until)})`) : a,
    );
    admissionsStore.set({ ...state, applicants: updated, idem: { ...state.idem, [key]: applicantIds.join(",") } });
    return HttpResponse.json({ offered: updated.filter((a) => ids.has(a.id)) }, { status: 201 });
  }),

  http.post("/api/admissions/applicants/:id/offer", async ({ params, request }) => {
    await latency();
    const key = request.headers.get("Idempotency-Key");
    const st = admissionsStore.get();
    const a = st.applicants.find((x) => x.id === String(params.id));
    if (!a) return fail(404, "NOT_FOUND", "This application is no longer on record.");
    if (key && st.idem[key]) return HttpResponse.json(a);
    const user = requirePermission("admissions.manage", a.campus);
    if (user instanceof Response) return user;
    if (a.session !== CURRENT_SESSION) return fail(409, "SESSION_READ_ONLY", `${formatSession(a.session)} is closed.`);
    if (!a.directAdmission) return fail(422, "TEST_REQUIRED", `${a.classApplied} admits through the entrance test and merit list.`);
    if (a.stage !== "APPLIED") return fail(409, "STALE", "This application has moved on. Reload the page.");
    const until = addDays(DEMO_TODAY, 7);
    const next = history({ ...storyOf(a), stage: "OFFERED", offeredOn: DEMO_TODAY, offeredBy: user.name, offerValidUntil: until }, `Seat offered in ${a.classApplied} after the interview (valid until ${formatDate(until)})`);
    saveApplicant(next);
    markIdem(key, next.id);
    return HttpResponse.json(withSiblings(next), { status: 201 });
  }),

  /* ---------------- enquiries ---------------- */
  http.get("/api/admissions/enquiries", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("admissions.view", ctx.campus);
    if (user instanceof Response) return user;
    const list = admissionsStore
      .get()
      .enquiries.filter((e) => e.session === ctx.session && (ctx.campus === "ALL" || e.campus === ctx.campus))
      .sort((a, b) => b.receivedOn.localeCompare(a.receivedOn) || b.enquiryNo.localeCompare(a.enquiryNo));
    return HttpResponse.json(list);
  }),

  http.post("/api/admissions/enquiries", async ({ request }) => {
    await latency();
    const key = request.headers.get("Idempotency-Key");
    const body = (await request.json()) as AdmissionsEnquiryInput & { campus: CampusCode | "ALL"; session: number };
    if (body.campus === "ALL") return fail(400, "CAMPUS_REQUIRED", "An enquiry belongs to one campus. Choose a campus.");
    const user = requirePermission("admissions.manage", body.campus);
    if (user instanceof Response) return user;
    const st = admissionsStore.get();
    if (key && st.idem[key]) return HttpResponse.json(st.enquiries.find((e) => e.id === st.idem[key]));
    if (body.session !== CURRENT_SESSION) return fail(409, "SESSION_READ_ONLY", `${formatSession(body.session)} is closed.`);
    if (!body.childName?.trim()) return fail(422, "VALIDATION", "Enter the child's name.", { field: "childName" });
    if (!body.parentName?.trim()) return fail(422, "VALIDATION", "Enter the parent's name.", { field: "parentName" });
    const mobile = normalizeMobile(body.mobile ?? "");
    if (!mobile) return fail(422, "VALIDATION", "Enter a Pakistani mobile number, e.g. 0300-1234567.", { field: "mobile" });
    const n = (st.enqSeq[body.campus] ?? 100) + 1;
    const e: AdmissionsEnquiry = {
      id: `enq-${body.campus}-${n}`,
      enquiryNo: `${body.campus}-ENQ-2627-${String(n).padStart(4, "0")}`,
      campus: body.campus,
      campusName: campusName(body.campus),
      session: body.session,
      childName: body.childName.trim(),
      gender: body.gender,
      parentName: body.parentName.trim(),
      mobile,
      classInterest: body.classInterest,
      source: body.source,
      receivedOn: DEMO_TODAY,
      ...(body.followUpOn ? { followUpOn: body.followUpOn } : {}),
      ...(body.notes?.trim() ? { notes: body.notes.trim() } : {}),
      status: "OPEN",
      takenBy: user.name,
    };
    admissionsStore.set({ ...st, enquiries: [e, ...st.enquiries], enqSeq: { ...st.enqSeq, [body.campus]: n }, idem: key ? { ...st.idem, [key]: e.id } : st.idem });
    return HttpResponse.json(e, { status: 201 });
  }),

  http.patch("/api/admissions/enquiries/:id", async ({ params, request }) => {
    await latency();
    const st = admissionsStore.get();
    const e = st.enquiries.find((x) => x.id === String(params.id));
    if (!e) return fail(404, "NOT_FOUND", "This enquiry is not on record.");
    const user = requirePermission("admissions.manage", e.campus);
    if (user instanceof Response) return user;
    const patch = (await request.json()) as { status?: "OPEN" | "CLOSED"; followUpOn?: IsoDate; notes?: string; closedReason?: string };
    if (e.status === "CONVERTED") return fail(409, "CONVERTED", `This enquiry is already application ${e.applicationNo}.`);
    if (patch.status === "CLOSED" && !patch.closedReason?.trim()) return fail(422, "VALIDATION", "Say why the enquiry is closed.", { field: "closedReason" });
    const next: AdmissionsEnquiry = {
      ...e,
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.followUpOn ? { followUpOn: patch.followUpOn } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.closedReason ? { closedReason: patch.closedReason.trim() } : {}),
    };
    admissionsStore.set({ ...st, enquiries: st.enquiries.map((x) => (x.id === e.id ? next : x)) });
    return HttpResponse.json(next);
  }),

  /* ---------------- new application ---------------- */
  http.post("/api/admissions/check", async ({ request }) => {
    await latency();
    const body = (await request.json()) as { campus: CampusCode | "ALL"; session: number; name: string; father: string; fatherCnic: string; dob: IsoDate | "" };
    const user = requirePermission("admissions.view", body.campus);
    if (user instanceof Response) return user;
    const cnic = normalizeCnic(body.fatherCnic ?? "");
    const kids = cnic.length === 13 ? STUDENTS.filter((s) => !s.mergedInto && s.fatherCnic === cnic) : [];
    const p = { name: body.name ?? "", father: body.father ?? "", fatherCnic: cnic, dob: body.dob ?? "" };
    const matches: AdmissionsCheckResult["matches"] = [];
    if (p.name.trim().length >= 3) {
      for (const s of STUDENTS.filter((x) => !x.mergedInto)) {
        const m = matchPerson(p, { name: s.name, father: s.father, fatherCnic: s.fatherCnic, dob: s.dob });
        if (m.strength >= 60) matches.push({ ref: s.grNo, source: "STUDENT", name: s.name, father: s.father, context: `Student · ${s.classSection}`, campusName: s.campusName, reasons: m.reasons, strength: m.strength });
      }
      for (const a of admissionsStore.get().applicants.filter((x) => x.stage !== "ADMITTED" && x.stage !== "WITHDRAWN")) {
        const m = matchPerson(p, { name: a.name, father: a.father, fatherCnic: a.fatherCnic, dob: a.dob });
        if (m.strength >= 60) matches.push({ ref: a.applicationNo, source: "APPLICANT", name: a.name, father: a.father, context: `Applicant · ${a.classApplied}`, campusName: a.campusName, reasons: m.reasons, strength: m.strength });
      }
    }
    const first = kids[0];
    const familyId = first ? familyIdOf(first) : undefined;
    const result: AdmissionsCheckResult = {
      ...(first ? { family: { ...(familyId ? { familyId } : {}), fatherName: first.father, children: kids.map(toSummary) } } : {}),
      matches: matches.sort((a, b) => b.strength - a.strength).slice(0, 4),
    };
    return HttpResponse.json(result);
  }),

  http.post("/api/admissions/applicants", async ({ request }) => {
    await latency();
    const key = request.headers.get("Idempotency-Key");
    const body = (await request.json()) as AdmissionsApplicationInput & { campus: CampusCode | "ALL"; session: number };
    if (body.campus === "ALL") return fail(400, "CAMPUS_REQUIRED", "An application belongs to one campus. Choose a campus.");
    const user = requirePermission("admissions.manage", body.campus);
    if (user instanceof Response) return user;
    let st = admissionsStore.get();
    if (key && st.idem[key]) return HttpResponse.json(st.applicants.find((a) => a.id === st.idem[key]));
    if (body.session !== CURRENT_SESSION) return fail(409, "SESSION_READ_ONLY", `${formatSession(body.session)} is closed. Switch to ${formatSession(CURRENT_SESSION)}.`);
    const err = (field: string, message: string) => fail(422, "VALIDATION", message, { field });
    if (!body.name?.trim() || body.name.trim().length < 3) return err("name", "Enter the child's full name.");
    if (!body.dob || body.dob > DEMO_TODAY) return err("dob", "Enter the date of birth.");
    if (!body.father?.trim()) return err("father", "Enter the father's name.");
    const cnic = normalizeCnic(body.fatherCnic ?? "");
    if (cnic && !isValidCnic(cnic)) return err("fatherCnic", "A CNIC has 13 digits, e.g. 36302-4567890-1.");
    const mobile = normalizeMobile(body.mobile ?? "");
    if (!mobile) return err("mobile", "Enter a Pakistani mobile number, e.g. 0300-1234567.");
    if (!body.address?.trim() || body.address.trim().length < 8) return err("address", "Enter the full address: house, street and area.");
    const rule = ruleFor(body.classApplied);
    const streams = rule.streams ?? [];
    const stream = (body.stream ?? "").trim();
    if (stream && !streams.includes(stream)) return err("stream", streams.length ? `Choose one of the groups: ${streams.join(", ")}.` : `${body.classApplied} has no groups.`);
    const extras = cleanExtras(body);
    if (extras instanceof Response) return extras;
    const test = body.testId ? st.tests.find((t) => t.id === body.testId && t.campus === body.campus) : undefined;
    if (body.testId && !test) return err("testId", "That test sitting is not available. Choose another date.");
    if (test && test.classApplied !== body.classApplied) return err("testId", `That sitting is for ${test.classApplied}.`);
    if (test && !stream && test.subjects.some((s) => s.stream)) return err("stream", "This sitting has a paper for each group. Choose the child's group first.");
    const n = (st.appSeq[body.campus] ?? 400) + 1;
    const gender = body.gender;
    const applicationNo = `${body.campus}-APP-2627-${String(n).padStart(4, "0")}`;
    const fee = rule.testRequired ? (body.feePaidNow ? { amount: rule.candidateFee, status: "PAID" as const, receiptNo: issueFeeReceipt(body.campus), paidOn: DEMO_TODAY } : { amount: rule.candidateFee, status: "DUE" as const }) : undefined;
    st = admissionsStore.get();
    const enquiry = body.enquiryId ? st.enquiries.find((e) => e.id === body.enquiryId) : undefined;
    let a: AdmissionsApplicant = {
      id: `adm-${body.campus}-${n}`,
      applicationNo,
      name: body.name.trim(),
      ...(body.nameUr?.trim() ? { nameUr: body.nameUr.trim() } : {}),
      relation: gender === "F" ? "d/o" : "s/o",
      father: body.father.trim(),
      fatherCnic: cnic,
      ...(body.mother?.trim() ? { mother: body.mother.trim() } : {}),
      dob: body.dob,
      gender,
      ...(body.bForm ? { bForm: normalizeCnic(body.bForm) } : {}),
      ...(body.previousSchool?.trim() ? { previousSchool: body.previousSchool.trim() } : {}),
      campus: body.campus,
      campusName: campusName(body.campus),
      session: body.session,
      classApplied: body.classApplied,
      stage: test ? "TEST" : "APPLIED",
      appliedOn: DEMO_TODAY,
      source: enquiry ? "ENQUIRY" : "DESK",
      ...(enquiry ? { enquiryNo: enquiry.enquiryNo } : {}),
      testScore: null,
      testMax: test ? maxOf(papersOf(test.subjects, stream || undefined)) : subjectsFor(body.classApplied).reduce((x, s) => x + s.max, 0),
      ...(stream ? { stream } : {}),
      ...extras,
      ...(rule.testRequired ? {} : { directAdmission: true }),
      ...(fee ? { fee } : {}),
      diamondMinds: false,
      mobile,
      address: body.address.trim(),
      history: [],
    };
    a = history(a, `Application ${applicationNo} received at the front desk${enquiry ? ` (from enquiry ${enquiry.enquiryNo})` : ""}`);
    if (fee?.status === "PAID") a = history(a, `Candidate fee Rs ${fee.amount.toLocaleString("en-US")} paid · ${fee.receiptNo}`);
    if (test) a = history({ ...a, testId: test.id, testDate: test.date, testRollNo: seatNo(body.classApplied, test.id, st.applicants) }, `Entrance test booked for ${formatDate(test.date)}, ${test.time}`);
    // A strong match with someone already on record goes to the duplicate review queue.
    const strongest = [
      ...STUDENTS.filter((s) => !s.mergedInto).map((s) => ({ rec: { source: "STUDENT" as const, ref: s.grNo, campusName: s.campusName, context: `Student · ${s.classSection}`, fields: { name: s.name, father: s.father, fatherCnic: s.fatherCnic, dob: s.dob, gender: s.gender, mobile: s.guardian.mobile, address: s.guardian.address } }, m: matchPerson({ ...a, mobile }, { name: s.name, father: s.father, fatherCnic: s.fatherCnic, dob: s.dob, mobile: s.guardian.mobile }) })),
      ...st.applicants.filter((x) => x.stage !== "WITHDRAWN").map((x) => ({ rec: applicantRecord(x), m: matchPerson({ ...a, mobile }, { name: x.name, father: x.father, fatherCnic: x.fatherCnic, dob: x.dob, mobile: x.mobile }) })),
    ].sort((x, y) => y.m.strength - x.m.strength)[0];
    const cases = strongest && strongest.m.strength >= 75 ? [{ id: `dup-${a.id}`, campus: a.campus, campusName: a.campusName, strength: strongest.m.strength, rules: strongest.m.reasons, foundOn: DEMO_TODAY, left: strongest.rec as AdmissionsPersonRecord, right: applicantRecord(a) }, ...st.cases] : st.cases;
    admissionsStore.set({
      ...st,
      applicants: [a, ...st.applicants],
      cases,
      appSeq: { ...st.appSeq, [body.campus]: n },
      enquiries: enquiry ? st.enquiries.map((e) => (e.id === enquiry.id ? { ...e, status: "CONVERTED" as const, applicationNo } : e)) : st.enquiries,
      idem: key ? { ...st.idem, [key]: a.id } : st.idem,
    });
    return HttpResponse.json(withSiblings(a), { status: 201 });
  }),

  http.post("/api/admissions/applicants/:id/test", async ({ params, request }) => {
    await latency();
    const st = admissionsStore.get();
    const a = st.applicants.find((x) => x.id === String(params.id));
    if (!a) return fail(404, "NOT_FOUND", "This application is no longer on record.");
    const user = requirePermission("admissions.manage", a.campus);
    if (user instanceof Response) return user;
    const { testId } = (await request.json()) as { testId: string };
    const test = st.tests.find((t) => t.id === testId && t.campus === a.campus && t.classApplied === a.classApplied);
    if (!test) return fail(422, "VALIDATION", `Choose a ${a.classApplied} test sitting.`, { field: "testId" });
    if (test.date < DEMO_TODAY) return fail(422, "VALIDATION", "That sitting has already taken place. Choose a later date.", { field: "testId" });
    if (a.stage !== "APPLIED" && a.stage !== "TEST") return fail(409, "STALE", "This applicant has already been tested. Reload the page.");
    if (a.fee?.status === "DUE") return fail(422, "FEE_DUE", `The candidate fee of Rs ${a.fee.amount.toLocaleString("en-US")} is not paid yet. Record the payment first; the test slip is printed after payment.`);
    if (!a.stream && test.subjects.some((s) => s.stream)) return fail(422, "VALIDATION", `This sitting has a paper for each group, and ${a.name} has no group yet. Choose another sitting, or record the group on a new application.`, { field: "testId" });
    const next = history({ ...storyOf(a), stage: "TEST", testId: test.id, testDate: test.date, testMax: maxOf(papersOf(test.subjects, a.stream)), testRollNo: a.testRollNo && a.testId === test.id ? a.testRollNo : seatNo(a.classApplied, test.id, st.applicants) }, `Entrance test booked for ${formatDate(test.date)}, ${test.time}`);
    saveApplicant(next);
    return HttpResponse.json(withSiblings(next));
  }),

  http.post("/api/admissions/applicants/:id/fee", async ({ params, request }) => {
    await latency();
    const key = request.headers.get("Idempotency-Key");
    const st = admissionsStore.get();
    const a = st.applicants.find((x) => x.id === String(params.id));
    if (!a) return fail(404, "NOT_FOUND", "This application is no longer on record.");
    if (key && st.idem[key]) return HttpResponse.json(withSiblings(a));
    const user = requirePermission("admissions.manage", a.campus);
    if (user instanceof Response) return user;
    if (!a.fee) return fail(422, "NO_FEE", `${a.classApplied} has no candidate fee.`);
    if (a.fee.status !== "DUE") return HttpResponse.json(withSiblings(a));
    const receiptNo = issueFeeReceipt(a.campus);
    const next = history({ ...storyOf(a), fee: { ...a.fee, status: "PAID", receiptNo, paidOn: DEMO_TODAY } }, `Candidate fee Rs ${a.fee.amount.toLocaleString("en-US")} paid · ${receiptNo}`);
    saveApplicant(next);
    markIdem(key, next.id);
    return HttpResponse.json(withSiblings(next), { status: 201 });
  }),

  http.post("/api/admissions/applicants/:id/withdraw", async ({ params, request }) => {
    await latency();
    const st = admissionsStore.get();
    const a = st.applicants.find((x) => x.id === String(params.id));
    if (!a) return fail(404, "NOT_FOUND", "This application is no longer on record.");
    const user = requirePermission("admissions.manage", a.campus);
    if (user instanceof Response) return user;
    const { reason } = (await request.json()) as { reason: string };
    if (!reason?.trim()) return fail(422, "VALIDATION", "Choose a reason.", { field: "reason" });
    if (a.stage === "ADMITTED") return fail(409, "ADMITTED", `${a.name} is already a student (${a.grNo}). Record leaving on the student's page instead.`);
    if (a.stage === "WITHDRAWN") return HttpResponse.json(withSiblings(a));
    const next = history({ ...storyOf(a), stage: "WITHDRAWN", withdrawnOn: DEMO_TODAY, withdrawnReason: reason.trim() }, `Withdrawn: ${reason.trim()}`);
    saveApplicant(next);
    return HttpResponse.json(withSiblings(next));
  }),

  /* ---------------- entrance tests and marks ---------------- */
  http.get("/api/admissions/tests/:id", async ({ params }) => {
    await latency();
    const st = admissionsStore.get();
    const t = st.tests.find((x) => x.id === String(params.id));
    if (!t) return fail(404, "NOT_FOUND", "This test sitting is not on record.");
    const user = requirePermission("admissions.view", t.campus);
    if (user instanceof Response) return user;
    const rows = st.applicants.filter((a) => a.testId === t.id && a.stage !== "WITHDRAWN").sort((a, b) => (a.testRollNo ?? "").localeCompare(b.testRollNo ?? ""));
    return HttpResponse.json({ test: testWithCounts(t, st.applicants), rows });
  }),

  http.post("/api/admissions/tests", async ({ request }) => {
    await latency();
    const key = request.headers.get("Idempotency-Key");
    const body = (await request.json()) as AdmissionsTestInput & { campus: CampusCode | "ALL"; session: number };
    if (body.campus === "ALL") return fail(400, "CAMPUS_REQUIRED", "A test sitting belongs to one campus. Choose a campus.");
    const user = requirePermission("admissions.manage", body.campus);
    if (user instanceof Response) return user;
    const st = admissionsStore.get();
    if (key && st.idem[key]) return HttpResponse.json(testWithCounts(st.tests.find((t) => t.id === st.idem[key])!, st.applicants));
    if (body.session !== CURRENT_SESSION) return fail(409, "SESSION_READ_ONLY", `${formatSession(body.session)} is closed.`);
    if (!ruleFor(body.classApplied).testRequired) return fail(422, "VALIDATION", `${body.classApplied} admits without an entrance test.`, { field: "classApplied" });
    if (!body.date || body.date < DEMO_TODAY) return fail(422, "VALIDATION", "Choose a date from today onwards.", { field: "date" });
    if (!body.subjects?.length || body.subjects.some((s) => !s.subject.trim() || !Number.isInteger(s.max) || s.max <= 0 || s.max > 200)) return fail(422, "VALIDATION", "Each subject needs a name and total marks between 1 and 200.", { field: "subjects" });
    const groups = ruleFor(body.classApplied).streams ?? [];
    const badGroup = body.subjects.find((s) => s.stream && !groups.includes(s.stream));
    if (badGroup) return fail(422, "VALIDATION", `${badGroup.subject}: ${groups.length ? `choose All or one of the groups (${groups.join(", ")})` : `${body.classApplied} has no groups`}.`, { field: "subjects" });
    const badTime = body.subjects.find((s) => s.durationMins !== undefined && (!Number.isInteger(s.durationMins) || s.durationMins < 5 || s.durationMins > 240));
    if (badTime) return fail(422, "VALIDATION", `${badTime.subject}: a paper lasts 5 to 240 minutes.`, { field: "subjects" });
    if (body.subjects.some((s) => s.stream) && body.subjects.every((s) => s.stream)) return fail(422, "VALIDATION", "Add at least one paper for every candidate (group All).", { field: "subjects" });
    if (st.tests.some((t) => t.campus === body.campus && t.classApplied === body.classApplied && t.date === body.date)) return fail(422, "VALIDATION", `${body.classApplied} already has a sitting on ${formatDate(body.date)}.`, { field: "date" });
    const round = st.tests.filter((t) => t.campus === body.campus && t.session === body.session && t.classApplied === body.classApplied).length;
    const t: TestRecord = {
      id: `t-${body.campus.toLowerCase()}-${body.classApplied.replace("Class ", "c")}-${Date.now().toString(36)}`,
      campus: body.campus,
      session: body.session,
      classApplied: body.classApplied,
      name: `${body.classApplied} entrance test · round ${round}`,
      date: body.date,
      time: body.time || "9:00 am",
      venue: body.venue || `Examination hall, ${campusName(body.campus)}`,
      subjects: body.subjects.map((s) => ({ subject: s.subject.trim(), max: s.max, ...(s.stream ? { stream: s.stream } : {}), ...(s.durationMins ? { durationMins: s.durationMins } : {}) })),
      // A candidate's total: the common papers plus the largest group's papers.
      max: maxOf(body.subjects.filter((s) => !s.stream)) + Math.max(0, ...groups.map((g) => maxOf(body.subjects.filter((s) => s.stream === g)))),
    };
    admissionsStore.set({ ...st, tests: [...st.tests, t], idem: key ? { ...st.idem, [key]: t.id } : st.idem });
    return HttpResponse.json(testWithCounts(t, st.applicants), { status: 201 });
  }),

  http.post("/api/admissions/tests/:id/marks", async ({ params, request }) => {
    await latency();
    const st = admissionsStore.get();
    const t = st.tests.find((x) => x.id === String(params.id));
    if (!t) return fail(404, "NOT_FOUND", "This test sitting is not on record.");
    const user = requirePermission("admissions.manage", t.campus);
    if (user instanceof Response) return user;
    if (t.session !== CURRENT_SESSION) return fail(409, "SESSION_READ_ONLY", `${formatSession(t.session)} is closed.`);
    if (t.date > DEMO_TODAY) return fail(422, "NOT_HELD", `This test is on ${formatDate(t.date)}. Marks can be entered after it is held.`);
    const { rows, remarks } = (await request.json()) as { rows: AdmissionsMarksRow[]; remarks?: string };
    if (remarks !== undefined && remarks.trim().length > 300) return fail(422, "VALIDATION", "Keep the remarks under 300 letters.", { field: "remarks" });
    const errors: Record<string, string> = {};
    for (const r of rows) {
      const a = st.applicants.find((x) => x.id === r.id && x.testId === t.id);
      if (!a) return fail(409, "STALE", "The candidate list has changed. Reload the sheet.");
      if (a.fee?.status === "DUE") errors[r.id] = `${a.name}: candidate fee not paid.`;
      if (r.absent) continue;
      // Each candidate sits the common papers and their own group's.
      for (const s of papersOf(t.subjects, a.stream)) {
        const v = r.marks[s.subject];
        if (v === null || v === undefined) continue;
        if (!Number.isFinite(v) || v < 0 || v > s.max) errors[`${r.id}:${s.subject}`] = `${a.name}: ${s.subject} must be between 0 and ${s.max}.`;
      }
    }
    if (Object.keys(errors).length) return fail(422, "VALIDATION", Object.values(errors)[0]!, { details: { fields: errors } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    let completed = 0;
    const applicants = st.applicants.map((a) => {
      const r = byId.get(a.id);
      if (!r) return a;
      if (a.stage !== "TEST" && a.stage !== "MERIT") return a;
      if (r.absent) return history({ ...storyOf(a), absentFromTest: true, testScore: null, marks: {} }, `Marked absent in ${t.name}`);
      const papers = papersOf(t.subjects, a.stream);
      const max = maxOf(papers);
      const marks = Object.fromEntries(papers.map((s) => [s.subject, r.marks[s.subject] ?? null]));
      const done = papers.every((s) => marks[s.subject] !== null);
      const score = done ? papers.reduce((x, s) => x + (marks[s.subject] ?? 0), 0) : null;
      if (done && a.testScore === null) completed += 1;
      const next = { ...storyOf(a), marks, absentFromTest: false, testScore: score, testMax: max, stage: done ? ("MERIT" as const) : a.stage };
      return done && a.testScore !== score ? history(next, `Test marked: ${score} / ${max} · moved to the merit list`) : next;
    });
    const tests = remarks !== undefined ? st.tests.map((x) => (x.id === t.id ? { ...x, ...(remarks.trim() ? { remarks: remarks.trim() } : { remarks: undefined }) } : x)) : st.tests;
    admissionsStore.set({ ...st, applicants, tests });
    const sheet = applicants.filter((a) => a.testId === t.id && a.stage !== "WITHDRAWN").sort((a, b) => (a.testRollNo ?? "").localeCompare(b.testRollNo ?? ""));
    return HttpResponse.json({ test: testWithCounts(tests.find((x) => x.id === t.id) ?? t, applicants), rows: sheet, completed });
  }),

  /* ---------------- admission: placement, G.R. number, roll number ---------------- */
  http.get("/api/admissions/placement", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requirePermission("admissions.view", ctx.campus);
    if (user instanceof Response) return user;
    if (ctx.campus === "ALL") return fail(400, "CAMPUS_REQUIRED", "Placement is per campus. Choose a campus.");
    const cls = url.searchParams.get("class") ?? "Class 1";
    const rule = ruleFor(cls);
    const body: AdmissionsPlacement = { classApplied: cls, classShort: rule.classShort, nextGrNo: peekGrNo(ctx.campus), admissionFee: rule.admissionFee, sections: sectionStats(ctx.campus, rule.classShort) };
    return HttpResponse.json(body);
  }),

  http.post("/api/admissions/applicants/:id/admit", async ({ params, request }) => {
    await latency();
    const key = request.headers.get("Idempotency-Key");
    const st = admissionsStore.get();
    const a = st.applicants.find((x) => x.id === String(params.id));
    if (!a) return fail(404, "NOT_FOUND", "This application is no longer on record.");
    const user = requirePermission("admissions.manage", a.campus);
    if (user instanceof Response) return user;
    if (a.stage === "ADMITTED" && a.grNo) {
      const s = findStudent(a.grNo);
      if (s) return HttpResponse.json({ applicant: withSiblings(a), student: toSummary(s), rollNo: s.rollNo, charges: [] });
    }
    if (a.session !== CURRENT_SESSION) return fail(409, "SESSION_READ_ONLY", `${formatSession(a.session)} is closed.`);
    if (a.stage !== "OFFERED") return fail(409, "NOT_OFFERED", `${a.name} has not been offered a seat yet. Offer admission first (merit list or interview).`);
    const input = (await request.json()) as AdmissionsAdmitInput;
    const rule = ruleFor(a.classApplied);
    if (input.classSection.split("-")[0] !== rule.classShort) return fail(422, "VALIDATION", `Place ${a.name} in a section of ${a.classApplied}.`, { field: "classSection" });
    if (!input.admissionDate || input.admissionDate > DEMO_TODAY || input.admissionDate < (a.offeredOn ?? a.appliedOn)) return fail(422, "VALIDATION", "The admission date must be between the offer date and today.", { field: "admissionDate" });
    if (input.house && !HOUSES.includes(input.house)) return fail(422, "VALIDATION", "Choose one of the campus houses.", { field: "house" });
    const sec = sectionStats(a.campus, rule.classShort).find((s) => s.classSection === input.classSection);
    if (!sec) return fail(422, "VALIDATION", "Choose a section of this class.", { field: "classSection" });
    if (sec.enrolled >= sec.seats) return fail(422, "SEATS_FULL", `${input.classSection} is full (${sec.seats} seats). Choose another section.`, { field: "classSection" });
    const streams = rule.streams ?? [];
    const stream = (input.stream ?? a.stream ?? "").trim();
    if (streams.length && !stream) return fail(422, "VALIDATION", `Choose ${a.name}'s group: ${streams.join(" or ")}.`, { field: "stream" });
    if (stream && !streams.includes(stream)) return fail(422, "VALIDATION", `Choose one of the groups: ${streams.join(", ")}.`, { field: "stream" });
    if (key && st.idem[key]) {
      const done = st.applicants.find((x) => x.id === a.id);
      const s = done?.grNo ? findStudent(done.grNo) : undefined;
      if (done && s) return HttpResponse.json({ applicant: done, student: toSummary(s), rollNo: s.rollNo, charges: [] });
    }
    const placed: AdmissionsApplicant = { ...a, ...(stream ? { stream } : {}), ...(input.hostel !== undefined ? { hostel: Boolean(input.hostel) } : {}) };
    const { student, charges } = admitStudent(placed, input.classSection, input.admissionDate, rule.admissionFee, user.name, input.house);
    // The welcome SMS goes through Messages, so it shows in the Outbox and the delivery report.
    const welcome = input.welcomeSms ? preparedFor("tpl-welcome", student) : undefined;
    const sent = welcome
      ? queueSms([welcome], { campus: student.campus, templateId: "tpl-welcome", title: "Welcome after admission", source: "Admissions", createdBy: user.name, audienceLabel: `${student.name} (${student.grNo}), newly admitted` })
      : null;
    const smsNote = !input.welcomeSms ? "" : !sent ? " · welcome SMS not sent (no mobile number or template)" : sent.held ? " · welcome SMS queued (held while SMS is paused)" : " · welcome SMS sent to the guardian";
    const next = history(
      { ...storyOf(placed), stage: "ADMITTED", grNo: student.grNo, admittedOn: input.admissionDate, admittedClassSection: input.classSection },
      `Admitted to ${input.classSection}${stream ? ` (${stream})` : ""} · G.R. ${student.grNo} · roll no. ${student.rollNo}${placed.hostel ? " · hostel" : ""}${smsNote}`,
    );
    admissionsStore.set((s) => ({ ...s, applicants: s.applicants.map((x) => (x.id === a.id ? next : x)), idem: key ? { ...s.idem, [key]: a.id } : s.idem }));
    return HttpResponse.json({ applicant: withSiblings(next), student: toSummary(student), rollNo: student.rollNo, charges, ...(sent ? { welcomeSms: { batchId: sent.batchId, held: sent.held } } : {}) }, { status: 201 });
  }),

  /* ---------------- duplicates ---------------- */
  http.get("/api/admissions/duplicates", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("admissions.view", ctx.campus);
    if (user instanceof Response) return user;
    const state = admissionsStore.get();
    const cases = state.cases.filter((c) => ctx.campus === "ALL" || c.campus === ctx.campus).sort((a, b) => b.strength - a.strength);
    const decisions = [...state.decisions].sort((a, b) => b.at.localeCompare(a.at));
    return HttpResponse.json({ cases, decisions });
  }),

  http.post("/api/admissions/duplicates/:id/merge", async ({ params, request }) => {
    await latency();
    const id = String(params.id);
    const key = request.headers.get("Idempotency-Key") ?? "";
    const state = admissionsStore.get();
    const done = key && state.decisions.find((d) => d.id === `dec-${key}`);
    if (done) return HttpResponse.json(done);
    const c = state.cases.find((x) => x.id === id);
    if (!c) return fail(409, "ALREADY_DECIDED", "Someone already decided this pair. Reload the queue.");
    const user = requirePermission("admissions.manage", c.campus);
    if (user instanceof Response) return user;
    const { keep } = (await request.json()) as { keep: Partial<Record<AdmissionsField, "left" | "right">> };
    // The surviving record is the student when there is one, otherwise the earlier application.
    const survivor = c.left.source === "STUDENT" || c.right.source !== "STUDENT" ? c.left : c.right;
    const merged = survivor === c.left ? c.right : c.left;
    const keptText = Object.entries(keep)
      .map(([f, side]) => `${ADMISSIONS_FIELD_LABEL[f as AdmissionsField]} from ${side === "left" ? c.left.ref : c.right.ref}`)
      .join(", ");
    const decision: AdmissionsDecision = {
      id: `dec-${key || Math.random().toString(36).slice(2)}`,
      caseId: id,
      decision: "MERGED",
      by: user.name,
      at: demoNow(),
      summary: `Merged ${refOf(merged)} into ${refOf(survivor)}${keptText ? ` · kept ${keptText}` : ""}.`,
      kept: keep,
    };
    // Two student records for one child: fold the later one into the survivor, keeping the chosen values.
    if (survivor.source === "STUDENT" && merged.source === "STUDENT") {
      const kept: Record<string, string> = {};
      for (const [f, side] of Object.entries(keep)) {
        const v = (side === "left" ? c.left : c.right).fields[f as AdmissionsField];
        if (side !== (survivor === c.left ? "left" : "right") && v) kept[f] = v;
      }
      const s = findStudent(survivor.ref);
      const patch = {
        ...(kept.name ? { name: kept.name } : {}),
        ...(kept.father ? { father: kept.father } : {}),
        ...(kept.fatherCnic ? { fatherCnic: kept.fatherCnic } : {}),
        ...(kept.dob ? { dob: kept.dob } : {}),
        ...(s && (kept.mobile || kept.address) ? { guardian: { ...s.guardian, ...(kept.mobile ? { mobile: kept.mobile } : {}), ...(kept.address ? { address: kept.address } : {}) } } : {}),
      };
      mergeStudentRecords(survivor.ref, merged.ref, patch, user.name);
    }
    // A merged application no longer appears in the pipeline on its own.
    const removeApp = merged.source === "APPLICANT" ? merged.ref : null;
    admissionsStore.set({
      ...state,
      cases: state.cases.filter((x) => x.id !== id),
      decisions: [decision, ...state.decisions],
      applicants: removeApp ? state.applicants.filter((a) => a.applicationNo !== removeApp) : state.applicants,
    });
    return HttpResponse.json(decision, { status: 201 });
  }),

  http.post("/api/admissions/duplicates/:id/not-same", async ({ params, request }) => {
    await latency();
    const id = String(params.id);
    const key = request.headers.get("Idempotency-Key") ?? "";
    const state = admissionsStore.get();
    const done = key && state.decisions.find((d) => d.id === `dec-${key}`);
    if (done) return HttpResponse.json(done);
    const c = state.cases.find((x) => x.id === id);
    if (!c) return fail(409, "ALREADY_DECIDED", "Someone already decided this pair. Reload the queue.");
    const user = requirePermission("admissions.manage", c.campus);
    if (user instanceof Response) return user;
    const decision: AdmissionsDecision = {
      id: `dec-${key || Math.random().toString(36).slice(2)}`,
      caseId: id,
      decision: "NOT_SAME",
      by: user.name,
      at: demoNow(),
      summary: `Not the same person: ${refOf(c.left)} and ${refOf(c.right)}. Both records are kept and this pair won't be suggested again.`,
    };
    admissionsStore.set({ ...state, cases: state.cases.filter((x) => x.id !== id), decisions: [decision, ...state.decisions] });
    return HttpResponse.json(decision, { status: 201 });
  }),
];
