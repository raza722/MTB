// Parent and student portal: one-time SMS code sign-in, children, fees, attendance, results, notices, contacts.
// The portal only reads the school's records (fees, attendance, exams, notices); what it keeps for itself is the
// signed-in account, sign-in codes, which notices each account has opened and the family's SMS language.
import {
  CURRENT_SESSION,
  type CampusCode,
  type FeeVoucher,
  type FeeVoucherLine,
  type PortalAccount,
  type PortalAccountKind,
  type PortalAttendanceMonth,
  type PortalChallenge,
  type PortalChild,
  type PortalCodeRequest,
  type PortalDemoHint,
  type PortalDue,
  type PortalFees,
  type PortalHome,
  type PortalLang,
  type PortalNotice,
  type PortalNotices,
  type PortalPreferences,
  type PortalProfile,
  type PortalReceipt,
  type PortalReceiptRow,
  type PortalRelation,
  type PortalResult,
  type PortalResults,
  type Receipt,
} from "@mtb/api";
import { calculateLateFine, DEFAULT_LATE_FINE_POLICY, formatSession, normalizeMobile, summariseAttendance, type AttendanceCode, type IsoDate, type IsoDateTime } from "@mtb/domain";
import { http, type HttpHandler } from "msw";
import { DEMO_TODAY, demoNow } from "../clock";
import { createStore } from "../db";
import { addDays, ALL_SECTIONS, calendarSeed, classTeacher, hash32, registersFor, SESSION_DATES } from "../fixtures/attendance";
import { campusOf } from "../fixtures/campuses";
import { initialExamTypes } from "../fixtures/exams";
import { publishedNotices } from "../fixtures/notices";
import {
  CAMPUS_UR,
  COUNTER_RECEIPT_NO,
  counterReceiptOverlay,
  examNameUr,
  feeHeadUr,
  HOUSE_UR,
  parentMobile,
  PEOPLE_UR,
  PORTAL_CODE_TTL_MS,
  PORTAL_CONTACTS,
  PORTAL_DEMO_CODE,
  PORTAL_LOCK_MS,
  PORTAL_MAX_ATTEMPTS,
  PORTAL_PARENTS,
  PORTAL_READ_SEED,
  PORTAL_RESEND_AFTER_SEC,
  PORTAL_STUDENTS,
} from "../fixtures/portal";
import { findStudent, type StudentRecord } from "../fixtures/students";
import { fail, HttpResponse, latency } from "../util";
import { attendanceMarkOf, closedOn } from "./attendance-model";
import { declaredResultsFor, examsStore } from "./exams-model";
import { chargesOf, feesStore, receiptsOf } from "./fees-state";

/* ================================================================== State */

interface Challenge {
  accountId: string;
  /** Wall-clock milliseconds: codes really do expire during a demo. */
  sentAt: number;
  expiresAt: number;
  attemptsLeft: number;
}

interface PortalState {
  accountId: string | null;
  challenges: Record<string, Challenge>;
  /** accountId → locked until (ms) after three wrong codes. */
  locks: Record<string, number>;
  /** accountId → notice ids opened. */
  read: Record<string, string[]>;
  /** accountId → SMS language chosen by the parent. */
  prefs: Record<string, PortalLang>;
  /** accountId → this sign-in and the one before. */
  signIns: Record<string, { current: IsoDateTime; previous?: IsoDateTime }>;
}

const store = createStore<PortalState>("portal", () => ({ accountId: null, challenges: {}, locks: {}, read: { ...PORTAL_READ_SEED }, prefs: {}, signIns: {} }));

/** Sign-ins recorded by the portal in this demo: account id → this sign-in and the one before. */
export function portalSignIns(): Record<string, { current: IsoDateTime; previous?: IsoDateTime }> {
  return store.get().signIns;
}

/** Families with a portal account and their latest sign-in (for the staff report; never a password or code). */
export function portalFamilies(): Array<{ id: string; children: string[]; lastSignInAt?: IsoDateTime }> {
  const signIns = portalSignIns();
  return PORTAL_PARENTS.map((p) => {
    const last = signIns[p.id]?.current ?? p.lastSignInAt;
    return { id: p.id, children: p.children, ...(last ? { lastSignInAt: last } : {}) };
  });
}

const newId = () => Math.random().toString(36).slice(2, 10);

/* ================================================================== Accounts */

interface AccountRecord {
  id: string;
  kind: PortalAccountKind;
  name: string;
  nameUr: string;
  relation?: PortalRelation;
  mobile: string;
  children: string[];
  smsLanguage: PortalLang;
  lastSignInAt?: IsoDateTime;
}

function accountById(id: string): AccountRecord | null {
  const parent = PORTAL_PARENTS.find((p) => p.id === id);
  if (parent) {
    return {
      id: parent.id,
      kind: "PARENT",
      name: parent.name,
      nameUr: parent.nameUr,
      relation: parent.relation,
      mobile: parentMobile(parent),
      children: parent.children.filter((gr) => findStudent(gr)?.status === "ACTIVE"),
      smsLanguage: parent.smsLanguage,
      ...(parent.lastSignInAt ? { lastSignInAt: parent.lastSignInAt } : {}),
    };
  }
  if (id.startsWith("ps-")) {
    const gr = id.slice(3);
    const s = findStudent(gr);
    if (!s || !PORTAL_STUDENTS.includes(gr) || s.status !== "ACTIVE") return null;
    const family = PORTAL_PARENTS.find((p) => p.children.includes(gr));
    return { id, kind: "STUDENT", name: s.name, nameUr: s.nameUr ?? PEOPLE_UR[s.name] ?? "", mobile: s.guardian.mobile, children: [gr], smsLanguage: family?.smsLanguage ?? "en" };
  }
  return null;
}

const mask = (mobile: string) => `${mobile.slice(0, 4)}-•••••${mobile.slice(-2)}`;

function toChild(s: StudentRecord): PortalChild {
  const f = feesView(s);
  return {
    grNo: s.grNo,
    name: s.name,
    nameUr: s.nameUr ?? PEOPLE_UR[s.name] ?? "",
    relation: s.relation,
    gender: s.gender,
    campus: s.campus,
    campusName: s.campusName,
    campusNameUr: CAMPUS_UR[s.campus],
    classSection: s.classSection,
    rollNo: s.rollNo,
    session: s.session,
    due: f.totalDue,
    feeStatus: f.status,
  };
}

function toAccount(a: AccountRecord): PortalAccount {
  const st = store.get();
  const signIn = st.signIns[a.id];
  const previous = signIn?.previous ?? (signIn ? undefined : a.lastSignInAt);
  return {
    id: a.id,
    kind: a.kind,
    name: a.name,
    nameUr: a.nameUr,
    ...(a.relation ? { relation: a.relation } : {}),
    mobile: a.mobile,
    children: a.children.map((gr) => findStudent(gr)).filter((s): s is StudentRecord => !!s).map(toChild),
    smsLanguage: st.prefs[a.id] ?? a.smsLanguage,
    signedInAt: signIn?.current ?? demoNow(),
    ...(previous ? { lastSignInAt: previous } : {}),
  };
}

/** The signed-in account, or a 401. */
function signedIn(): AccountRecord | Response {
  const id = store.get().accountId;
  const a = id ? accountById(id) : null;
  return a ?? fail(401, "UNAUTHENTICATED", "Please sign in.");
}

/** The signed-in account and one of its children, or a 401/403/404. */
function guardChild(grNo: string): { a: AccountRecord; s: StudentRecord } | Response {
  const a = signedIn();
  if (a instanceof Response) return a;
  if (!a.children.includes(grNo)) return fail(403, "NOT_LINKED", "This child isn't linked to your account. If that is wrong, call the campus office.");
  const s = findStudent(grNo);
  if (!s) return fail(404, "NOT_FOUND", "No student with this G.R. number.");
  return { a, s };
}

/* ================================================================== Fees */

interface FeesView {
  dues: PortalDue[];
  totalDue: number;
  lateFineSoFar: number;
  payBy: IsoDate | null;
  status: "paid" | "unpaid" | "overdue";
  receipts: Receipt[];
  charged: number;
  paid: number;
}

/** What is due today and every receipt, with Ayesha's flow-1 receipt laid over her charges when needed. */
function feesView(s: StudentRecord): FeesView {
  const charges = chargesOf(s.grNo);
  const overlay = feesStore.get().receipts[COUNTER_RECEIPT_NO] ? null : counterReceiptOverlay(s.grNo, charges);
  const paidByOverlay = new Set(overlay?.lines.map((l) => l.chargeId) ?? []);
  const open = charges.filter((c) => c.status === "OPEN" && !paidByOverlay.has(c.id)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const dues: PortalDue[] = open.map((c) => {
    const remaining = c.amount - c.settledAmount;
    const lf = calculateLateFine(c.dueDate, DEMO_TODAY, DEFAULT_LATE_FINE_POLICY);
    return {
      chargeId: c.id,
      head: c.head,
      headUr: feeHeadUr(c.head),
      dueDate: c.dueDate,
      amount: remaining,
      lateFine: lf.fine,
      daysOverdue: lf.daysOverdue,
      total: remaining + lf.fine,
      status: c.dueDate < DEMO_TODAY ? "overdue" : "unpaid",
    };
  });
  const totalDue = dues.reduce((a, d) => a + d.total, 0);
  const session = charges.filter((c) => c.session === CURRENT_SESSION && c.status !== "CANCELLED");
  const charged = session.reduce((a, c) => a + c.amount, 0);
  const stillOpen = session.filter((c) => c.status === "OPEN" && !paidByOverlay.has(c.id)).reduce((a, c) => a + c.amount - c.settledAmount, 0);
  const receipts = [...receiptsOf(s.grNo), ...(overlay ? [overlay] : [])].sort((a, b) => b.postedAt.localeCompare(a.postedAt));
  return {
    dues,
    totalDue,
    lateFineSoFar: dues.reduce((a, d) => a + d.lateFine, 0),
    payBy: dues[0]?.dueDate ?? null,
    status: totalDue === 0 ? "paid" : dues.some((d) => d.status === "overdue") ? "overdue" : "unpaid",
    receipts,
    charged,
    paid: charged - stillOpen,
  };
}

const receiptRow = (r: Receipt): PortalReceiptRow => ({
  receiptNo: r.receiptNo,
  session: r.session,
  postedAt: r.postedAt,
  total: r.total,
  method: r.payment.method,
  heads: r.lines.map((l) => ({ head: l.head, headUr: feeHeadUr(l.head) })),
  status: r.status,
});

const monthEnd = (month: string): IsoDate => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

/** A voucher for everything due now, in the office's voucher format (three copies on A4). */
function voucherFor(s: StudentRecord, f: FeesView): FeeVoucher | null {
  if (f.dues.length === 0) return null;
  const month = DEMO_TODAY.slice(0, 7);
  const lines: FeeVoucherLine[] = f.dues.map((d) => ({ chargeId: d.chargeId, head: d.head, dueDate: d.dueDate, amount: d.amount, arrears: d.dueDate < `${month}-01` }));
  const latest = f.dues.reduce((a, d) => (d.dueDate > a ? d.dueDate : a), f.dues[0]!.dueDate);
  const dueDate = latest >= DEMO_TODAY ? latest : addDays(DEMO_TODAY, 7);
  const base = lines.reduce((a, l) => a + l.amount, 0);
  const fineTable = [0, 5, 10, 15, 20].map((k) => {
    const upTo = addDays(dueDate, k);
    const fine = lines.reduce((a, l) => a + calculateLateFine(l.dueDate, upTo, DEFAULT_LATE_FINE_POLICY).fine, 0);
    return { upTo, fine, amount: base + fine };
  });
  const prefix = campusOf(s.campus).docPrefix;
  return {
    voucherNo: `${prefix}-FV-2627-${String(5000 + (hash32(`${s.grNo}:${month}`) % 4000)).padStart(6, "0")}`,
    runId: "portal",
    campus: s.campus,
    campusName: s.campusName,
    session: CURRENT_SESSION,
    month,
    grNo: s.grNo,
    studentName: s.name,
    ...(s.nameUr ? { studentNameUr: s.nameUr } : {}),
    relation: s.relation,
    father: s.father,
    classSection: s.classSection,
    issueDate: DEMO_TODAY,
    dueDate,
    validUntil: monthEnd(month) >= dueDate ? monthEnd(month) : addDays(dueDate, 20),
    lines,
    fineOnArrears: fineTable[0]!.fine,
    payableByDue: fineTable[0]!.amount,
    fineTable,
    status: "ISSUED",
    receiptNos: [],
    printCount: 0,
    bank: PORTAL_CONTACTS[s.campus].bank,
    fineRule: "Rs 10 a day after the due date",
  };
}

/* ================================================================== Attendance */

const holidayUr = (name: string) => calendarSeed().find((e) => e.name === name)?.nameUr ?? name;

interface MonthDays {
  days: Partial<Record<IsoDate, AttendanceCode>>;
  holidays: Array<{ date: IsoDate; name: string; nameUr: string }>;
}

const firstMonthOf = (s: StudentRecord) => {
  const start = SESSION_DATES[CURRENT_SESSION]!.starts;
  return (s.admissionDate > start ? s.admissionDate : start).slice(0, 7);
};

/** One month of marks: school days up to today, plus every holiday in the month (upcoming ones too). */
function monthDays(s: StudentRecord, month: string): MonthDays {
  const start = SESSION_DATES[CURRENT_SESSION]!.starts;
  const days: MonthDays["days"] = {};
  const holidays: MonthDays["holidays"] = [];
  for (let d = `${month}-01`; d <= monthEnd(month); d = addDays(d, 1)) {
    if (d < start || d < s.admissionDate) continue;
    const closed = closedOn(s.campus, d);
    if (closed) {
      if (closed.kind === "WEEKLY_OFF") continue;
      days[d] = "H";
      holidays.push({ date: d, name: closed.name, nameUr: holidayUr(closed.name) });
      continue;
    }
    if (d > DEMO_TODAY) continue;
    const code = attendanceMarkOf(s.campus, s.classSection, d, s.grNo);
    if (code) days[d] = code;
  }
  return { days, holidays };
}

const monthsBetween = (from: string, to: string) => {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number) as [number, number];
  for (let guard = 0; guard < 24; guard++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (key > to) break;
    out.push(key);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
};

function sectionTeacher(campus: CampusCode, cs: string): string {
  return registersFor(campus).find((r) => r.classSection === cs)?.classTeacher ?? classTeacher(campus, cs, Math.max(0, ALL_SECTIONS.indexOf(cs)));
}

/* ================================================================== Results and notices */

function resultsOf(s: StudentRecord): PortalResult[] {
  const exams = examsStore.get();
  const types = initialExamTypes();
  return declaredResultsFor(s.grNo).map((d) => {
    const e = exams.find((x) => x.id === d.examId);
    const type = types.find((t) => t.id === e?.typeId);
    return {
      examId: d.examId,
      exam: d.exam,
      examUr: examNameUr(d.exam, type?.nameUrdu, formatSession(d.session)),
      category: e?.category ?? "TERM",
      session: d.session,
      classSection: e?.roster.find((p) => p.id === s.grNo)?.classSection ?? s.classSection,
      declaredOn: d.declaredOn,
      obtained: d.obtained,
      total: d.total,
      percent: d.percent,
      grade: d.grade,
      ...(d.position !== undefined ? { position: d.position } : {}),
      subjects: d.subjects.map((sub) => ({
        subject: sub.subject,
        subjectUr: e?.subjects.find((x) => x.name === sub.subject)?.nameUrdu || sub.subject,
        obtained: sub.obtained,
        max: sub.max,
        grade: sub.grade,
        ...(sub.absent ? { absent: true } : {}),
      })),
    };
  });
}

function noticesOf(accountId: string, s: StudentRecord): PortalNotice[] {
  const read = new Set(store.get().read[accountId] ?? []);
  return publishedNotices(s.campus, s.classSection).map((n) => ({
    id: n.id,
    title: n.title,
    titleUr: n.titleUr,
    body: n.body,
    bodyUr: n.bodyUr,
    date: n.date,
    publishedAt: n.publishedAt,
    publishedBy: n.publishedBy,
    ...(PEOPLE_UR[n.publishedBy] ? { publishedByUr: PEOPLE_UR[n.publishedBy] } : {}),
    category: n.category ?? "GENERAL",
    pinned: Boolean(n.pinned),
    read: read.has(n.id),
  }));
}

const unreadOf = (list: PortalNotice[]) => list.filter((n) => !n.read).length;

/* ================================================================== Handlers */

const GR = /^[A-Z]{2}-\d{3,6}$/;

export const portalHandlers: HttpHandler[] = [
  // Mock mode only: the sign-in page's demo hint. The real server has no such endpoint.
  http.get("/api/portal/demo", async () => {
    await latency();
    const hint: PortalDemoHint = {
      code: PORTAL_DEMO_CODE,
      parents: PORTAL_PARENTS.map((p) => ({ name: p.name, mobile: parentMobile(p), children: p.children.map((gr) => findStudent(gr)?.name ?? gr) })),
      students: PORTAL_STUDENTS.map((gr) => findStudent(gr))
        .filter((s): s is StudentRecord => !!s && s.status === "ACTIVE")
        .map((s) => ({ name: s.name, grNo: s.grNo, classSection: s.classSection, campusName: s.campusName })),
    };
    return HttpResponse.json(hint);
  }),

  http.post("/api/portal/auth/code", async ({ request }) => {
    await latency();
    const body = (await request.json()) as Partial<PortalCodeRequest> & { mobile?: string; grNo?: string };
    let account: AccountRecord | null = null;
    if (body.kind === "STUDENT") {
      const gr = (body.grNo ?? "").trim().toUpperCase().replace(/\s+/g, "");
      if (!GR.test(gr)) return fail(422, "VALIDATION", "Enter the G.R. number as it is on the school card, for example KC-14823.", { field: "grNo" });
      const s = findStudent(gr);
      if (!s) return fail(404, "GR_NOT_FOUND", "We couldn't find this G.R. number. Check it on the school card or a fee receipt.", { field: "grNo" });
      account = accountById(`ps-${gr}`);
      if (!account) return fail(403, "PORTAL_NOT_ENABLED", "The portal hasn't been set up for this student yet. Ask your campus office.", { field: "grNo" });
    } else {
      const mobile = normalizeMobile(body.mobile ?? "");
      if (!mobile) return fail(422, "VALIDATION", "Enter an 11-digit mobile number that starts with 03.", { field: "mobile" });
      const parent = PORTAL_PARENTS.find((p) => parentMobile(p) === mobile);
      account = parent ? accountById(parent.id) : null;
      if (!account) return fail(404, "NOT_REGISTERED", "This number isn't in the school's records. Use the number you gave at admission, or call your campus office to update it.", { field: "mobile" });
    }
    const now = Date.now();
    const lockedUntil = store.get().locks[account.id] ?? 0;
    if (lockedUntil > now) return fail(423, "CODE_LOCKED", "Too many wrong codes. Sign-in is paused for 15 minutes.");
    const challengeId = newId();
    const ch: Challenge = { accountId: account.id, sentAt: now, expiresAt: now + PORTAL_CODE_TTL_MS, attemptsLeft: PORTAL_MAX_ATTEMPTS };
    store.set((st) => ({ ...st, challenges: { ...st.challenges, [challengeId]: ch } }));
    const res: PortalChallenge = { challengeId, kind: account.kind, maskedPhone: mask(account.mobile), expiresAt: new Date(ch.expiresAt).toISOString(), resendAfterSec: PORTAL_RESEND_AFTER_SEC };
    return HttpResponse.json(res);
  }),

  http.post("/api/portal/auth/code/resend", async ({ request }) => {
    await latency();
    const { challengeId } = (await request.json()) as { challengeId: string };
    const ch = store.get().challenges[challengeId];
    const account = ch ? accountById(ch.accountId) : null;
    if (!ch || !account) return fail(410, "CODE_EXPIRED", "This sign-in has expired. Start again.");
    const now = Date.now();
    const wait = Math.ceil((ch.sentAt + PORTAL_RESEND_AFTER_SEC * 1000 - now) / 1000);
    if (wait > 0) return fail(429, "TOO_SOON", `Wait ${wait} seconds before asking for another code.`, { details: { waitSec: wait } });
    const next: Challenge = { ...ch, sentAt: now, expiresAt: now + PORTAL_CODE_TTL_MS };
    store.set((st) => ({ ...st, challenges: { ...st.challenges, [challengeId]: next } }));
    const res: PortalChallenge = { challengeId, kind: account.kind, maskedPhone: mask(account.mobile), expiresAt: new Date(next.expiresAt).toISOString(), resendAfterSec: PORTAL_RESEND_AFTER_SEC };
    return HttpResponse.json(res);
  }),

  http.post("/api/portal/auth/verify", async ({ request }) => {
    await latency();
    const { challengeId, code } = (await request.json()) as { challengeId: string; code: string };
    const st = store.get();
    const ch = st.challenges[challengeId];
    const account = ch ? accountById(ch.accountId) : null;
    if (!ch || !account) return fail(410, "CODE_EXPIRED", "This code has expired. Ask for a new one.");
    const now = Date.now();
    const dropChallenge = (s: PortalState) => {
      const { [challengeId]: _gone, ...rest } = s.challenges;
      return rest;
    };
    if ((st.locks[account.id] ?? 0) > now) return fail(423, "CODE_LOCKED", "Too many wrong codes. Sign-in is paused for 15 minutes.");
    if (now > ch.expiresAt) {
      store.set((s) => ({ ...s, challenges: dropChallenge(s) }));
      return fail(410, "CODE_EXPIRED", "This code has expired. Ask for a new one.");
    }
    if (String(code ?? "").trim() !== PORTAL_DEMO_CODE) {
      const attemptsLeft = ch.attemptsLeft - 1;
      if (attemptsLeft <= 0) {
        store.set((s) => ({ ...s, challenges: dropChallenge(s), locks: { ...s.locks, [account.id]: now + PORTAL_LOCK_MS } }));
        return fail(423, "CODE_LOCKED", "Too many wrong codes. Sign-in is paused for 15 minutes.");
      }
      store.set((s) => ({ ...s, challenges: { ...s.challenges, [challengeId]: { ...ch, attemptsLeft } } }));
      return fail(401, "CODE_INVALID", `That code isn't right. ${attemptsLeft} ${attemptsLeft === 1 ? "attempt" : "attempts"} left.`, { details: { attemptsLeft } });
    }
    const at = demoNow();
    store.set((s) => {
      const before = s.signIns[account.id];
      const previous = before?.current ?? account.lastSignInAt;
      return { ...s, accountId: account.id, challenges: dropChallenge(s), signIns: { ...s.signIns, [account.id]: { current: at, ...(previous ? { previous } : {}) } } };
    });
    return HttpResponse.json(toAccount(account));
  }),

  http.get("/api/portal/session", async () => {
    await latency();
    const a = signedIn();
    return a instanceof Response ? a : HttpResponse.json(toAccount(a));
  }),

  http.post("/api/portal/auth/sign-out", async () => {
    await latency();
    store.set((s) => ({ ...s, accountId: null }));
    return HttpResponse.json({ status: "ok" });
  }),

  http.put("/api/portal/preferences", async ({ request }) => {
    await latency();
    const a = signedIn();
    if (a instanceof Response) return a;
    if (a.kind !== "PARENT") return fail(403, "FORBIDDEN", "Your parent chooses the SMS language.");
    const body = (await request.json()) as Partial<PortalPreferences>;
    if (body.smsLanguage !== "en" && body.smsLanguage !== "ur") return fail(422, "VALIDATION", "Choose English or Urdu.", { field: "smsLanguage" });
    const lang = body.smsLanguage;
    store.set((s) => ({ ...s, prefs: { ...s.prefs, [a.id]: lang } }));
    return HttpResponse.json(toAccount(a));
  }),

  http.get("/api/portal/children/:grNo/home", async ({ params }) => {
    await latency();
    const g = guardChild(String(params.grNo));
    if (g instanceof Response) return g;
    const { a, s } = g;
    const f = feesView(s);
    const closed = closedOn(s.campus, DEMO_TODAY);
    const code = attendanceMarkOf(s.campus, s.classSection, DEMO_TODAY, s.grNo);
    const month = monthDays(s, DEMO_TODAY.slice(0, 7));
    const latest = resultsOf(s)[0];
    const notices = noticesOf(a.id, s);
    const last = f.receipts.find((r) => r.status !== "CANCELLED");
    const home: PortalHome = {
      child: toChild(s),
      today: DEMO_TODAY,
      fees: {
        due: f.totalDue,
        overdue: f.dues.filter((d) => d.status === "overdue").reduce((x, d) => x + d.total, 0),
        payBy: f.payBy,
        status: f.status,
        lastReceipt: last ? { receiptNo: last.receiptNo, postedAt: last.postedAt, total: last.total } : null,
      },
      attendance: {
        date: DEMO_TODAY,
        code: closed && closed.kind !== "WEEKLY_OFF" ? "H" : code,
        ...(closed && closed.kind !== "WEEKLY_OFF" ? { holiday: { name: closed.name, nameUr: holidayUr(closed.name) } } : {}),
        month: summariseAttendance(Object.entries(month.days).filter(([d]) => d <= DEMO_TODAY).map(([, c]) => c as AttendanceCode)),
      },
      result: latest ? (({ subjects: _subjects, ...summary }) => summary)(latest) : null,
      notices: notices.slice(0, 3),
      unreadNotices: unreadOf(notices),
    };
    return HttpResponse.json(home);
  }),

  http.get("/api/portal/children/:grNo/fees", async ({ params }) => {
    await latency();
    const g = guardChild(String(params.grNo));
    if (g instanceof Response) return g;
    const { s } = g;
    const f = feesView(s);
    const res: PortalFees = {
      child: toChild(s),
      today: DEMO_TODAY,
      dues: f.dues,
      totalDue: f.totalDue,
      lateFineSoFar: f.lateFineSoFar,
      payBy: f.payBy,
      finePerDay: DEFAULT_LATE_FINE_POLICY.ratePerDay,
      bankName: PORTAL_CONTACTS[s.campus].bank.bankName,
      session: { charged: f.charged, paid: f.paid },
      receipts: f.receipts.map(receiptRow),
    };
    return HttpResponse.json(res);
  }),

  http.get("/api/portal/children/:grNo/receipts/:receiptNo", async ({ params }) => {
    await latency();
    const g = guardChild(String(params.grNo));
    if (g instanceof Response) return g;
    const r = feesView(g.s).receipts.find((x) => x.receiptNo === String(params.receiptNo));
    if (!r) return fail(404, "NOT_FOUND", "There is no receipt with this number for this child. Check the number on the fees page.");
    const res: PortalReceipt = { ...r, downloadedAt: demoNow() };
    return HttpResponse.json(res);
  }),

  http.get("/api/portal/children/:grNo/voucher", async ({ params }) => {
    await latency();
    const g = guardChild(String(params.grNo));
    if (g instanceof Response) return g;
    const v = voucherFor(g.s, feesView(g.s));
    return v ? HttpResponse.json(v) : fail(404, "NO_DUES", "All dues are cleared, so there is no voucher to download.");
  }),

  http.get("/api/portal/children/:grNo/attendance", async ({ params, request }) => {
    await latency();
    const g = guardChild(String(params.grNo));
    if (g instanceof Response) return g;
    const { s } = g;
    const url = new URL(request.url);
    const firstMonth = firstMonthOf(s);
    const lastMonth = DEMO_TODAY.slice(0, 7);
    const month = url.searchParams.get("month") ?? lastMonth;
    if (!/^\d{4}-\d{2}$/.test(month) || month < firstMonth || month > lastMonth) return fail(422, "VALIDATION", "Choose a month of this session up to today.", { field: "month" });
    const current = monthDays(s, month);
    const pastOnly = (days: MonthDays["days"]) => Object.entries(days).filter(([d]) => d <= DEMO_TODAY).map(([, c]) => c as AttendanceCode);
    const vacations = calendarSeed().filter((e) => e.kind === "VACATION" && e.session === CURRENT_SESSION && (e.campus === "ALL" || e.campus === s.campus));
    let sessionCodes: AttendanceCode[] = [];
    const months = monthsBetween(firstMonth, lastMonth).map((m) => {
      const md = m === month ? current : monthDays(s, m);
      const codes = pastOnly(md.days);
      sessionCodes = sessionCodes.concat(codes);
      const sum = summariseAttendance(codes);
      const vacation = sum.schoolDays === 0 ? vacations.find((v) => v.from.slice(0, 7) <= m && m <= v.to.slice(0, 7)) : undefined;
      return { month: m, schoolDays: sum.schoolDays, percent: sum.percent, ...(vacation ? { note: vacation.name, noteUr: vacation.nameUr } : {}) };
    });
    const teacher = sectionTeacher(s.campus, s.classSection);
    const res: PortalAttendanceMonth = {
      child: toChild(s),
      month,
      firstMonth,
      lastMonth,
      today: DEMO_TODAY,
      days: current.days,
      holidays: current.holidays,
      summary: summariseAttendance(pastOnly(current.days)),
      marks: Object.entries(current.days)
        .filter((e): e is [IsoDate, "A" | "L" | "LT"] => e[1] === "A" || e[1] === "L" || e[1] === "LT")
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([date, code]) => ({ date, code })),
      months,
      sessionSummary: summariseAttendance(sessionCodes),
      classTeacher: teacher,
      ...(PEOPLE_UR[teacher] ? { classTeacherUr: PEOPLE_UR[teacher] } : {}),
      officePhone: PORTAL_CONTACTS[s.campus].phone,
    };
    return HttpResponse.json(res);
  }),

  http.get("/api/portal/children/:grNo/results", async ({ params }) => {
    await latency();
    const g = guardChild(String(params.grNo));
    if (g instanceof Response) return g;
    const [latest, ...earlier] = resultsOf(g.s);
    const res: PortalResults = { child: toChild(g.s), latest: latest ?? null, earlier };
    return HttpResponse.json(res);
  }),

  http.get("/api/portal/children/:grNo/notices", async ({ params }) => {
    await latency();
    const g = guardChild(String(params.grNo));
    if (g instanceof Response) return g;
    const notices = noticesOf(g.a.id, g.s);
    const res: PortalNotices = { child: toChild(g.s), notices, unread: unreadOf(notices) };
    return HttpResponse.json(res);
  }),

  http.post("/api/portal/children/:grNo/notices/read-all", async ({ params }) => {
    await latency();
    const g = guardChild(String(params.grNo));
    if (g instanceof Response) return g;
    const ids = noticesOf(g.a.id, g.s).map((n) => n.id);
    store.set((st) => ({ ...st, read: { ...st.read, [g.a.id]: [...new Set([...(st.read[g.a.id] ?? []), ...ids])] } }));
    return HttpResponse.json({ unread: 0 });
  }),

  http.post("/api/portal/children/:grNo/notices/:noticeId/read", async ({ params }) => {
    await latency();
    const g = guardChild(String(params.grNo));
    if (g instanceof Response) return g;
    const id = String(params.noticeId);
    const visible = noticesOf(g.a.id, g.s);
    if (!visible.some((n) => n.id === id)) return fail(404, "NOT_FOUND", "This notice is no longer on the board.");
    store.set((st) => ({ ...st, read: { ...st.read, [g.a.id]: [...new Set([...(st.read[g.a.id] ?? []), id])] } }));
    return HttpResponse.json({ unread: unreadOf(noticesOf(g.a.id, g.s)) });
  }),

  http.get("/api/portal/children/:grNo/profile", async ({ params }) => {
    await latency();
    const g = guardChild(String(params.grNo));
    if (g instanceof Response) return g;
    const { s } = g;
    const c = PORTAL_CONTACTS[s.campus];
    const teacher = sectionTeacher(s.campus, s.classSection);
    const principal = c.principal ?? "Campus principal";
    const res: PortalProfile = {
      child: {
        ...toChild(s),
        dob: s.dob,
        admissionDate: s.admissionDate,
        ...(s.house ? { house: s.house, houseUr: HOUSE_UR[s.house] ?? s.house } : {}),
        father: s.father,
        ...(s.guardian.nameUr ? { fatherUr: s.guardian.nameUr } : PEOPLE_UR[s.father] ? { fatherUr: PEOPLE_UR[s.father] } : {}),
        ...(s.mother ? { mother: s.mother, ...(PEOPLE_UR[s.mother] ? { motherUr: PEOPLE_UR[s.mother] } : {}) } : {}),
      },
      guardian: { name: s.guardian.name, ...(s.guardian.nameUr ? { nameUr: s.guardian.nameUr } : {}), relation: s.guardian.relation, mobile: s.guardian.mobile, address: s.guardian.address },
      school: {
        campusName: s.campusName,
        campusNameUr: CAMPUS_UR[s.campus],
        address: c.address,
        addressUr: c.addressUr,
        phone: c.phone,
        principal,
        ...(PEOPLE_UR[principal] ? { principalUr: PEOPLE_UR[principal] } : c.principal ? {} : { principalUr: "کیمپس پرنسپل" }),
        classTeacher: teacher,
        ...(PEOPLE_UR[teacher] ? { classTeacherUr: PEOPLE_UR[teacher] } : {}),
        assembly: c.assembly,
        dayStarts: c.dayStarts,
        dayEnds: c.dayEnds,
        officeOpens: c.officeOpens,
        officeCloses: c.officeCloses,
      },
    };
    return HttpResponse.json(res);
  }),
];

