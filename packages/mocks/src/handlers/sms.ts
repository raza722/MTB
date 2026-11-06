import {
  can,
  SMS_LEFT_STATUS_LABEL,
  SMS_OPTIONAL_CATEGORIES,
  smsCost,
  smsRender,
  smsSegments,
  smsUnknownVariables,
  type CampusCode,
  type CampusScope,
  type SessionUser,
  type SmsAudience,
  type SmsAudiencePreview,
  type SmsAudienceRequest,
  type SmsBatch,
  type SmsBatchCounts,
  type SmsBatchDetail,
  type SmsBatchStatus,
  type SmsChannel,
  type SmsDeliveryStatus,
  type SmsGatewaySettings,
  type SmsGatewaySettingsInput,
  type SmsLanguage,
  type SmsOptOut,
  type SmsOverview,
  type SmsRecipientPreview,
  type SmsReport,
  type SmsSendResult,
  type SmsStaffMember,
  type SmsSystemStatus,
  type SmsTemplate,
  type SmsTemplateCategory,
  type SmsTrendDay,
} from "@mtb/api";
import { daysBetween, formatCount, formatDate, formatMobile, formatSession, normalizeMobile, type IsoDate } from "@mtb/domain";
import { http } from "msw";
import { CURRENT_SESSION, DEMO_TODAY, demoNow } from "../clock";
import { createStore } from "../db";
import { registerSections, rosterFor } from "../fixtures/attendance";
import { campusName, tuitionFor } from "../fixtures/campuses";
import { rand01, staffOf } from "../fixtures/reports";
import { APP_ADOPTION, FAMILIES, seedBatches, seedGatewaySettings, seedOptOuts, seedReportRows, SMS_TEMPLATES, ZERO_COUNTS, type MockBatch, type MockSmsRow } from "../fixtures/sms";
import { findStudent, STUDENTS, type StudentRecord } from "../fixtures/students";
import { ctxFrom, fail, HttpResponse, latency, requirePermission, requireUser } from "../util";
import { admissionApplicants } from "./admissions-model";
import { declaredResultsFor, examRows, examsStore } from "./exams";
import { chargesOf } from "./fees-state";
import { allMovements, sessionOfDate } from "./student-records-model";

// Messages centre. The kill switch store is read by the attendance and fee modules too.

export const smsStatusStore = createStore<SmsSystemStatus>("sms-status", () => ({ paused: false }));

const templatesStore = createStore<SmsTemplate[]>("sms-templates-v2", () => SMS_TEMPLATES.map((t) => ({ ...t })));

/**
 * A template as it stands now in Messages → Templates (with any rewording), for the modules that send it
 * (Attendance's "Absent today", Fees' "Fee overdue", Exams' "Result declared"). Built-in templates added after a demo
 * started are read from the seed.
 */
export function liveTemplate(id: string): SmsTemplate | undefined {
  return templatesNow().find((t) => t.id === id);
}

/** The stored templates, plus any built-in template shipped after this demo's data was first saved. */
function templatesNow(): SmsTemplate[] {
  const list = templatesStore.get();
  const missing = SMS_TEMPLATES.filter((t) => !list.some((x) => x.id === t.id));
  if (!missing.length) return list;
  const merged = [...list, ...missing.map((t) => ({ ...t }))];
  templatesStore.set(merged);
  return merged;
}

interface OutboxState {
  rows: MockSmsRow[];
  batches: MockBatch[];
  /** Idempotency-Key → result, so a double-click can't send twice. */
  idem: Record<string, SmsSendResult>;
}

const outboxStore = createStore<OutboxState>("sms-outbox-v2", () => {
  const rows = seedReportRows();
  return { rows, batches: seedBatches(rows), idem: {} };
});

const optOutStore = createStore<SmsOptOut[]>("sms-optouts", seedOptOuts);

/**
 * App notifications a family's phone received today (for the portal's notification list), newest first.
 * The portal mocks can call this with the guardian's mobile.
 */
export function appNotificationsFor(mobile: string): Array<{ id: string; at: string; title: string; message: string; read: boolean }> {
  const n = normalizeMobile(mobile);
  const st = outboxStore.get();
  return st.rows
    .filter((r) => r.channel === "APP" && r.status === "delivered" && normalizeMobile(r.mobile) === n)
    .map((r) => {
      const b = st.batches.find((x) => x.id === r.batchId);
      return { id: r.id, at: r.at, title: b?.title ?? r.templateName, message: r.message, read: Boolean(r.read) };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** Read-only view of the outbox for the report centre (message log, cost by month). */
export function outboxSnapshot(): { batches: SmsBatch[]; rows: MockSmsRow[] } {
  const st = outboxStore.get();
  return { batches: st.batches.map((b) => toBatch(b, st.rows)), rows: st.rows };
}
const settingsStore = createStore<SmsGatewaySettings[]>("sms-settings", seedGatewaySettings);

const ALL: CampusCode[] = ["KC", "SM", "UC", "MC", "HC"];
const inScope = (scope: CampusScope, c: CampusCode) => scope === "ALL" || scope === c;
const settingsOf = (c: CampusCode) => settingsStore.get().find((s) => s.campus === c)!;

/** Wording used in every value a template can carry (the exam name and event date can be typed at compose time). */
const DEFAULT_EXAM = "First Term 2026–27";
const DEFAULT_EVENT_DATE = "14-Nov-2026";

// ---------------------------------------------------------------------------------------------------
// Delivery simulation
// ---------------------------------------------------------------------------------------------------

/** SMS: queued → sent after ~2.5 s → delivered or failed after ~6 s (held while SMS is paused). App: delivered after ~1 s, often opened later. */
function progress() {
  const paused = smsStatusStore.get().paused;
  const now = Date.now();
  let changed = false;
  const nowIso = demoNow();
  const st = outboxStore.get();

  // Scheduled sends whose time has come go out now.
  const due = st.batches.filter((b) => b.status === "SCHEDULED" && b.scheduledFor && b.scheduledFor <= nowIso);
  for (const b of due) startBatch(b.id);

  const rows = outboxStore.get().rows.map((r) => {
    if (r.channel === "APP") {
      if (r.status === "queued" && r.queuedAt !== undefined && now - r.queuedAt > 1200) {
        changed = true;
        return { ...r, status: "delivered" as const };
      }
      if (r.status === "delivered" && !r.read && r.queuedAt !== undefined && now - r.queuedAt > 9000 && rand01(`${r.id}:read`) < 0.66) {
        changed = true;
        return { ...r, read: true };
      }
      return r;
    }
    if (paused || (r.status !== "queued" && r.status !== "sent") || r.queuedAt === undefined) return r;
    const elapsed = now - r.queuedAt;
    if (elapsed > 6000) {
      changed = true;
      const { queuedAt: _q, failOnce, ...rest } = r;
      if (r.willFail || failOnce) return { ...rest, status: "failed" as const, error: r.lastError ?? "Phone switched off — no delivery report from the network" };
      return { ...rest, status: "delivered" as const };
    }
    if (elapsed > 2500 && r.status === "queued") {
      changed = true;
      return { ...r, status: "sent" as const };
    }
    return r;
  });
  if (changed) outboxStore.set((s) => ({ ...s, rows }));

  // Sending batches finish once nothing of theirs is still on its way.
  const live = outboxStore.get();
  const finished = live.batches.filter((b) => b.status === "SENDING" && !live.rows.some((r) => r.batchId === b.id && (r.status === "queued" || r.status === "sent")));
  if (finished.length) {
    const ids = new Set(finished.map((b) => b.id));
    outboxStore.set((s) => ({ ...s, batches: s.batches.map((b) => (ids.has(b.id) ? { ...b, status: "SENT" as const } : b)) }));
  }
}

function countsOf(b: MockBatch, rows: MockSmsRow[]): SmsBatchCounts {
  const c: SmsBatchCounts = { ...b.extra };
  for (const r of rows) {
    if (r.batchId !== b.id) continue;
    if (r.channel === "APP") {
      if (r.status === "delivered") {
        c.app += 1;
        if (r.read) c.appRead += 1;
      }
      continue;
    }
    c[r.status] += 1;
  }
  return c;
}

function toBatch(b: MockBatch, rows: MockSmsRow[]): SmsBatch {
  const { request: _r, extra: _e, startedAtMs: _s, ...rest } = b;
  return { ...rest, counts: countsOf(b, rows) };
}

// ---------------------------------------------------------------------------------------------------
// Audiences
// ---------------------------------------------------------------------------------------------------

const GIRL_FIRST = new Set(["Hania", "Aiza", "Minahil", "Alishba", "Abeera", "Haleema", "Mishal", "Rameen", "Arfa", "Dua", "Sehar", "Javeria", "Maheen", "Iqra", "Komal", "Rabia", "Shiza", "Tayyaba", "Umaima", "Wajiha"]);

/** Fictional classmates are generated from these girls' names (attendance fixtures); the rest are boys. */
export const genderOfName = (name: string): "F" | "M" => (GIRL_FIRST.has(name.split(" ")[0] ?? "") ? "F" : "M");

interface AudienceRow extends SmsRecipientPreview {
  campus: CampusCode;
  excluded: "optout" | "nothing-due" | "no-app" | "duplicate" | "no-result" | "you" | null;
  channel: "SMS" | "APP";
}

export interface Person {
  /** Stable id for unticking on the preview (defaults to the G.R. no., else the number). */
  key?: string;
  /** Applicants: entry-test marks, "obtained/total", once marked. */
  testResult?: string;
  grNo: string;
  name: string;
  nameUr?: string;
  classSection: string;
  guardian: string;
  mobile: string;
  gender: "F" | "M";
  /** Open charges known (fixture students), else a fictional figure. */
  amountDue: number;
  overdueAmount: number;
  oldestDue?: IsoDate;
  daysOverdue: number;
  hasApp: boolean;
}

export function feeOf(grNo: string): { due: number; overdue: number; oldest?: IsoDate; days: number; first?: IsoDate } {
  const open = chargesOf(grNo)
    .filter((c) => c.status === "OPEN")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const due = open.reduce((a, c) => a + c.amount - c.settledAmount, 0);
  const overdue = open.filter((c) => c.dueDate < DEMO_TODAY);
  const overdueAmount = overdue.reduce((a, c) => a + c.amount - c.settledAmount, 0);
  return { due, overdue: overdueAmount, ...(overdue[0] ? { oldest: overdue[0].dueDate } : {}), days: overdue[0] ? daysBetween(overdue[0].dueDate, DEMO_TODAY) : 0, ...(open[0] ? { first: open[0].dueDate } : {}) };
}

/** A student with a full record (fixture or admitted in the demo), with their fees from the ledger. */
function personOf(s: StudentRecord, campus: CampusCode): Person {
  const f = feeOf(s.grNo);
  return {
    grNo: s.grNo,
    name: s.name,
    ...(s.nameUr ? { nameUr: s.nameUr } : {}),
    classSection: s.classSection,
    guardian: s.guardian.name,
    mobile: s.guardian.mobile,
    gender: s.gender,
    amountDue: f.due,
    overdueAmount: f.overdue,
    ...(f.oldest ?? f.first ? { oldestDue: (f.oldest ?? f.first)! } : {}),
    daysOverdue: f.days,
    hasApp: rand01(`${s.guardian.mobile}:app`) < APP_ADOPTION[campus],
  };
}

/** Everyone in some class-sections of a campus (full registers: fixture students plus their classmates). */
export function rosterPeople(campus: CampusCode, sections: string[]): Person[] {
  const out: Person[] = [];
  for (const cs of sections) {
    for (const e of rosterFor(campus, cs)) {
      const s = e.hasProfile ? findStudent(e.grNo) : undefined;
      if (s) {
        const f = feeOf(s.grNo);
        out.push({
          grNo: s.grNo,
          name: s.name,
          ...(s.nameUr ? { nameUr: s.nameUr } : {}),
          classSection: cs,
          guardian: s.guardian.name,
          mobile: s.guardian.mobile,
          gender: s.gender,
          amountDue: f.due,
          overdueAmount: f.overdue,
          ...(f.oldest ?? f.first ? { oldestDue: (f.oldest ?? f.first)! } : {}),
          daysOverdue: f.days,
          hasApp: rand01(`${s.guardian.mobile}:app`) < APP_ADOPTION[campus],
        });
        continue;
      }
      // Fictional dues for classmates without a fixture record: about 3 in 10 owe something, 1 in 5 is overdue.
      const owes = rand01(`${e.grNo}:fee`);
      const tuition = tuitionFor(cs.split("-")[0] ?? "");
      const months = owes < 0.05 ? 3 : owes < 0.1 ? 2 : owes < 0.18 ? 1 : 0;
      const overdue = months * tuition;
      const amount = owes < 0.3 ? overdue + tuition : 0;
      const oldest: IsoDate | undefined = months === 3 ? "2026-08-10" : months === 2 ? "2026-09-10" : months === 1 ? "2026-10-10" : amount ? "2026-11-10" : undefined;
      out.push({
        grNo: e.grNo,
        name: e.name,
        classSection: cs,
        guardian: e.father,
        mobile: e.mobile,
        gender: genderOfName(e.name),
        amountDue: amount,
        overdueAmount: overdue,
        ...(oldest ? { oldestDue: oldest } : {}),
        daysOverdue: overdue && oldest ? daysBetween(oldest, DEMO_TODAY) : 0,
        hasApp: rand01(`${e.mobile}:app`) < APP_ADOPTION[campus],
      });
    }
  }
  return out;
}

function sectionsOf(campus: CampusCode, a: SmsAudience): string[] {
  const all = registerSections(campus);
  if (a.kind === "ALL_PARENTS") return all;
  if (a.kind === "CLASS") return all.filter((cs) => cs.startsWith(`${a.className}-`) && (!a.section || cs === `${a.className}-${a.section}`));
  if (a.kind === "SECTIONS") return all.filter((cs) => a.classSections.includes(cs));
  return [];
}

export function audienceLabel(a: SmsAudience): string {
  switch (a.kind) {
    case "CLASS":
      return `Class ${a.className}${a.section ? `-${a.section}` : ", all sections"}${a.gender ? (a.gender === "F" ? " · girls" : " · boys") : ""}`;
    case "SECTIONS":
      return `${a.classSections.length === 1 ? "Class" : "Classes"} ${a.classSections.slice(0, 6).join(", ")}${a.classSections.length > 6 ? ` and ${a.classSections.length - 6} more` : ""}${a.gender ? (a.gender === "F" ? " · girls" : " · boys") : ""}`;
    case "DEFAULTERS":
      return `Fee defaulters: overdue more than ${a.minDaysOverdue} days and more than Rs ${formatCount(a.minAmount)}${a.classSections?.length ? ` · ${listOf(a.classSections)}` : ""}`;
    case "ALL_PARENTS":
      return `All parents${a.gender ? (a.gender === "F" ? " of girls" : " of boys") : ""}`;
    case "STAFF": {
      const base = a.group === "ALL" ? "all staff" : a.group === "TEACHING" ? "teaching staff" : "non-teaching staff";
      const text = `${a.staffIds ? `${formatCount(a.staffIds.length)} chosen from ${base}` : base}${a.departments?.length ? ` · ${a.departments.join(", ")}` : ""}${a.gender ? (a.gender === "F" ? " · women" : " · men") : ""}`;
      return text.charAt(0).toUpperCase() + text.slice(1);
    }
    case "NUMBERS":
      return a.label ?? `${formatCount(a.numbers.length)} typed or uploaded numbers`;
    case "CANDIDATES":
      return `Admission candidates${a.classApplied ? `, ${a.classApplied === "Prep" ? "Prep" : `Class ${a.classApplied}`}` : ", every class"}${a.testFee ? (a.testFee === "PAID" ? " · test fee paid" : " · test fee not paid") : ""}${a.registeredFrom || a.registeredTo ? ` · applied ${a.registeredFrom ? formatDate(a.registeredFrom) : "…"} to ${a.registeredTo ? formatDate(a.registeredTo) : "today"}` : ""}${a.testDate ? ` · test on ${formatDate(a.testDate)}` : ""}`;
    case "EXAM": {
      const e = examsStore.get().find((x) => x.id === a.examId);
      return `Result of ${e?.name ?? "an exam"} · ${listOf(a.classSections?.length ? a.classSections : (e?.classes ?? []))}${a.gender ? (a.gender === "F" ? " · girls" : " · boys") : ""}`;
    }
    case "LEFT":
      return `${SMS_LEFT_STATUS_LABEL[a.status]} in ${formatSession(a.session)}${a.classSections?.length ? ` · ${listOf(a.classSections)}` : ""}${a.gender ? (a.gender === "F" ? " · girls" : " · boys") : ""}`;
    case "STUDENTS":
      return a.label ?? `${formatCount(a.grNos.length)} chosen ${a.grNos.length === 1 ? "student" : "students"}`;
  }
}

const listOf = (xs: string[]) => `${xs.slice(0, 6).join(", ")}${xs.length > 6 ? ` and ${xs.length - 6} more` : ""}`;

const SUBJECT_SHORT: Record<string, string> = { English: "Eng", Urdu: "Urdu", Mathematics: "Maths", Science: "Sci", "General Science": "Sci", Islamiyat: "Isl", "Islamic Studies": "Isl", "Social Studies": "SSt", "Pakistan Studies": "Pak St", Physics: "Phy", Chemistry: "Chem", Biology: "Bio", "Computer Science": "Comp", Computer: "Comp", "Nazra Quran": "Quran" };
/** "Mathematics" → "Maths" for the subject-wise marks line. */
const shortSubject = (name: string) => SUBJECT_SHORT[name] ?? (name.length > 6 ? name.slice(0, 4) : name);
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const pctOf = (o: number, m: number) => (m > 0 ? Math.round((o / m) * 1000) / 10 : 0);
/** "512/700 (73.1%), Grade B, Position 3" */
const resultText = (obtained: number, max: number, percent: number, grade?: string | null, position?: number | null) => `${num(obtained)}/${max} (${percent}%)${grade ? `, Grade ${grade}` : ""}${position ? `, Position ${position}` : ""}`;
const firstOfMonth = (d: IsoDate): IsoDate => `${d.slice(0, 7)}-01`;

function templateFor(req: SmsAudienceRequest): SmsTemplate | Response {
  if (req.templateId === "custom") {
    const en = req.customText?.en?.trim() ?? "";
    const ur = req.customText?.ur?.trim() ?? "";
    if (req.language === "en" && !en) return fail(422, "VALIDATION", "Write the message in English, or switch the language to Urdu.", { field: "en" });
    if (req.language === "ur" && !ur) return fail(422, "VALIDATION", "Write the message in Urdu, or switch the language to English.", { field: "ur" });
    for (const [field, text] of [["en", en], ["ur", ur]] as const) {
      const unknown = smsUnknownVariables(text);
      if (unknown.length) return fail(422, "VALIDATION", `Unknown variable {${unknown[0]}}. Use one of the variable chips.`, { field });
    }
    const category: SmsTemplateCategory = req.customText?.category ?? (req.audience.kind === "STAFF" ? "STAFF" : "GENERAL");
    return { id: "custom", name: req.title?.trim() || "Message written for this send", category, en, ur, updatedAt: demoNow(), updatedBy: "" };
  }
  const t = liveTemplate(req.templateId);
  if (!t || t.archived) return fail(404, "NOT_FOUND", "That template no longer exists. Choose another one.");
  return t;
}

/** Works out who gets the message, how (SMS or app), what each message says and what it costs. */
function buildAudience(req: SmsAudienceRequest, user: SessionUser): { template: SmsTemplate; rows: AudienceRow[]; preview: SmsAudiencePreview } | Response {
  const template = templateFor(req);
  if (template instanceof Response) return template;
  const channel: SmsChannel = req.channel ?? "SMS";
  const settings = settingsOf(req.campus);
  const opted = new Set(optOutStore.get().filter((o) => o.campus === req.campus).map((o) => normalizeMobile(o.mobile)));
  const optional = SMS_OPTIONAL_CATEGORIES.includes(template.category);
  const body = req.language === "ur" ? template.ur : template.en;
  const a = req.audience;
  const eventDate = req.values?.event_date?.trim() || DEFAULT_EVENT_DATE;

  // Results come from Exams: the chosen exam (declared only), or each student's latest declared result this session.
  const examId = a.kind === "EXAM" ? a.examId : req.values?.exam_id?.trim() || undefined;
  const exam = examId ? examsStore.get().find((e) => e.id === examId) : undefined;
  if (examId) {
    if (!exam || exam.campus !== req.campus) return fail(404, "NOT_FOUND", "That exam isn't at this campus. Choose another one.", { field: "exam" });
    if (exam.status !== "DECLARED") return fail(409, "NOT_DECLARED", `${exam.name} isn't declared yet. Messages can only carry declared results.`, { field: "exam" });
  }
  const examName = exam?.name ?? (req.values?.exam_name?.trim() || DEFAULT_EXAM);
  const usesResult = /\{result\}/.test(body);
  const usesSubjects = /\{subject_marks\}/.test(body);
  const usesTests = /\{tests_summary\}/.test(body);
  // Cumulative tests: every class test declared in the dates (this month when none are given).
  const period = req.period ?? (usesTests ? { from: firstOfMonth(DEMO_TODAY), to: DEMO_TODAY } : undefined);
  if (period && (!period.from || !period.to || period.from > period.to)) return fail(422, "VALIDATION", "Choose the dates of the tests: the first date on or before the second.", { field: "period" });
  const tests = period ? examsStore.get().filter((e) => e.campus === req.campus && e.category === "TEST" && e.status === "DECLARED" && e.startDate >= period.from && e.startDate <= period.to) : [];
  const testRows = tests.map((e) => ({ e, rows: new Map(examRows(e).map((r) => [r.id, r])) }));
  const examResultRows = exam ? new Map(examRows(exam).map((r) => [r.id, r])) : null;

  const scoreOf = (p: Person): { result?: string; subjects?: string; tests?: string } => {
    if (p.testResult !== undefined) return { result: p.testResult };
    if (!p.grNo) return {};
    let result: string | undefined;
    let subjects: string | undefined;
    if (examResultRows && exam) {
      const r = examResultRows.get(p.grNo);
      if (r && !r.withheld && r.percent !== null) {
        result = resultText(r.obtained, r.max, r.percent, r.grade, r.position);
        subjects = exam.subjects
          .filter((s) => s.id in r.marks)
          .map((s) => {
            const m = r.marks[s.id];
            return `${shortSubject(s.name)} ${typeof m === "number" ? num(m) : m === "A" ? "absent" : m === "L" ? "leave" : "-"}/${s.maxMarks}`;
          })
          .join(", ");
      }
    } else if (usesResult || (usesSubjects && !period)) {
      const d = declaredResultsFor(p.grNo).find((x) => x.session === req.session);
      if (d) {
        result = resultText(d.obtained, d.total, d.percent, d.grade, d.position ?? null);
        subjects = d.subjects.map((x) => `${shortSubject(x.subject)} ${x.absent ? "absent" : x.obtained === null ? "-" : num(x.obtained)}/${x.max}`).join(", ");
      }
    }
    let testsText: string | undefined;
    if (period) {
      let n = 0;
      let obt = 0;
      let max = 0;
      const bySubject = new Map<string, { o: number; m: number }>();
      for (const t of testRows) {
        const r = t.rows.get(p.grNo);
        if (!r || r.withheld || r.percent === null) continue;
        n += 1;
        obt += r.obtained;
        max += r.max;
        for (const s of t.e.subjects) {
          if (!(s.id in r.marks)) continue;
          const m = r.marks[s.id];
          const g = bySubject.get(s.name) ?? { o: 0, m: 0 };
          g.o += typeof m === "number" ? m : 0;
          g.m += s.maxMarks;
          bySubject.set(s.name, g);
        }
      }
      if (n > 0) {
        testsText = `${n} ${n === 1 ? "test" : "tests"}, ${num(obt)}/${max} (${pctOf(obt, max)}%)`;
        if (!examResultRows) subjects = [...bySubject].map(([name, g]) => `${shortSubject(name)} ${num(g.o)}/${g.m}`).join(", ");
      }
    }
    return { ...(result ? { result } : {}), ...(subjects ? { subjects } : {}), ...(testsText ? { tests: testsText } : {}) };
  };

  let people: Person[] = [];
  let invalid: string[] = [];
  if (a.kind === "DEFAULTERS") {
    for (const s of STUDENTS.filter((x) => x.campus === req.campus && x.status === "ACTIVE")) {
      if (a.classSections?.length && !a.classSections.includes(s.classSection)) continue;
      const f = feeOf(s.grNo);
      if (!(f.days > a.minDaysOverdue && f.overdue > a.minAmount)) continue;
      people.push({ ...personOf(s, req.campus), amountDue: f.overdue, ...(f.oldest ? { oldestDue: f.oldest } : {}) });
    }
  } else if (a.kind === "STAFF") {
    people = staffOf(req.campus)
      .filter((s) => (a.group === "ALL" || (a.group === "TEACHING" ? s.teaching : !s.teaching)) && (!a.departments?.length || a.departments.includes(s.department)) && (!a.gender || s.gender === a.gender) && (!a.staffIds || a.staffIds.includes(s.id)))
      .map((s) => ({ key: s.id, grNo: s.staffNo, name: s.name, classSection: s.designation, guardian: s.name, mobile: s.mobile, gender: s.gender, amountDue: 0, overdueAmount: 0, daysOverdue: 0, hasApp: s.teaching }));
  } else if (a.kind === "CANDIDATES") {
    // Applicants from Admissions this session who are not yet admitted or withdrawn.
    const want = a.classApplied ? (a.classApplied === "Prep" ? "Prep" : `Class ${a.classApplied}`) : null;
    for (const x of admissionApplicants(req.campus, req.session)) {
      if (x.stage === "ADMITTED" || x.stage === "WITHDRAWN") continue;
      if (want && x.classApplied !== want) continue;
      if (a.registeredFrom && x.appliedOn < a.registeredFrom) continue;
      if (a.registeredTo && x.appliedOn > a.registeredTo) continue;
      if (a.testFee === "PAID" && !(x.fee && x.fee.status !== "DUE")) continue;
      if (a.testFee === "UNPAID" && x.fee?.status !== "DUE") continue;
      if (a.testDate && x.testDate !== a.testDate) continue;
      people.push({
        key: x.applicationNo,
        grNo: x.applicationNo,
        name: x.name,
        ...(x.nameUr ? { nameUr: x.nameUr } : {}),
        classSection: x.classApplied,
        guardian: x.father,
        mobile: x.mobile,
        gender: x.gender,
        amountDue: 0,
        overdueAmount: 0,
        daysOverdue: 0,
        hasApp: false,
        ...(x.testScore !== null && !x.absentFromTest ? { testResult: `${num(x.testScore)}/${x.testMax}` } : {}),
      });
    }
  } else if (a.kind === "EXAM") {
    // Everyone on the exam's roster in the chosen sections; their result is checked below.
    const sections = exam!.classes.filter((cs) => !a.classSections?.length || a.classSections.includes(cs));
    const onRoster = new Set(exam!.roster.map((p) => p.id));
    people = rosterPeople(req.campus, sections).filter((p) => onRoster.has(p.grNo));
    if (a.gender) people = people.filter((p) => p.gender === a.gender);
  } else if (a.kind === "LEFT") {
    // Students whose record shows them expelled, struck off, left or passed out in that session.
    const moves = allMovements();
    for (const s of STUDENTS) {
      if (s.campus !== req.campus || s.status !== a.status || s.mergedInto) continue;
      const m = [...moves].reverse().find((x) => x.grNo === s.grNo && x.kind === a.status);
      const on = m?.date ?? [...s.enrolment].reverse().find((e) => e.kind === a.status)?.date ?? s.leftOn;
      if (!on || sessionOfDate(on) !== a.session) continue;
      if (a.classSections?.length && !a.classSections.includes(s.classSection)) continue;
      if (a.gender && s.gender !== a.gender) continue;
      people.push(personOf(s, req.campus));
    }
  } else if (a.kind === "STUDENTS") {
    // Chosen students: full records first (they may have left), then classmates from the registers.
    const found = new Map<string, Person>();
    for (const gr of a.grNos) {
      const s = findStudent(gr);
      if (s && s.campus === req.campus) found.set(gr, personOf(s, req.campus));
    }
    const rest = new Set(a.grNos.filter((g) => !found.has(g)));
    if (rest.size) {
      const sections = registerSections(req.campus).filter((cs) => rosterFor(req.campus, cs).some((e) => rest.has(e.grNo)));
      for (const p of rosterPeople(req.campus, sections)) if (rest.has(p.grNo) && !found.has(p.grNo)) found.set(p.grNo, p);
    }
    people = a.grNos.flatMap((gr) => {
      const p = found.get(gr);
      if (!p) return [];
      const amount = a.amounts?.[gr];
      const due = a.dueDates?.[gr];
      return [{ ...p, ...(amount !== undefined ? { amountDue: amount, overdueAmount: amount } : {}), ...(due ? { oldestDue: due } : {}) }];
    });
  } else if (a.kind === "NUMBERS") {
    const seen = new Set<string>();
    for (const raw of a.numbers) {
      const n = normalizeMobile(raw);
      if (!n) {
        if (raw.trim()) invalid.push(raw.trim());
        continue;
      }
      if (seen.has(n)) continue;
      seen.add(n);
      people.push({ grNo: "", name: "—", classSection: "—", guardian: "Typed or uploaded number", mobile: n, gender: "M", amountDue: 0, overdueAmount: 0, daysOverdue: 0, hasApp: false });
    }
    invalid = [...new Set(invalid)];
  } else {
    if ((a.kind === "SECTIONS" && a.classSections.length === 0) || (a.kind === "CLASS" && !a.className)) people = [];
    else people = rosterPeople(req.campus, sectionsOf(req.campus, a));
    if (a.gender) people = people.filter((p) => p.gender === a.gender);
  }

  // Broadcasts reach each family once, even with several children in the list.
  const dedupe = (optional || template.category === "STAFF") && a.kind !== "DEFAULTERS" && a.kind !== "NUMBERS" && a.kind !== "CANDIDATES" && a.kind !== "STUDENTS" && a.kind !== "EXAM" && !/\{(student_name|amount_due|result|class|tests_summary|subject_marks)\}/.test(body);
  const seenMobile = new Set<string>();
  const unticked = new Set(req.exclude ?? []);
  const needsScore = usesResult || usesSubjects || usesTests;

  const rows: AudienceRow[] = [];
  for (const p of people) {
    const amountDue = a.kind === "DEFAULTERS" ? p.overdueAmount : p.amountDue;
    const due = p.oldestDue;
    const sc = needsScore || a.kind === "EXAM" ? scoreOf(p) : {};
    const message = smsRender(body, {
      student_name: req.language === "ur" && p.nameUr ? p.nameUr : p.name,
      class: p.classSection,
      amount_due: formatCount(amountDue),
      due_date: due ? formatDate(due) : "—",
      campus: campusName(req.campus),
      guardian_name: p.guardian,
      exam_name: examName,
      result: sc.result ?? "—",
      event_date: eventDate,
      tests_summary: sc.tests ?? "—",
      subject_marks: sc.subjects ?? "—",
    });
    const mobile = normalizeMobile(p.mobile) ?? p.mobile;
    const key = p.key ?? (p.grNo || mobile);
    const optedOut = opted.has(mobile);
    const goesBy: "SMS" | "APP" = channel === "SMS" ? "SMS" : p.hasApp ? "APP" : "SMS";
    const noResult = (usesResult && !sc.result) || (usesSubjects && !sc.subjects) || (usesTests && !sc.tests) || (a.kind === "EXAM" && !sc.result);
    let excluded: AudienceRow["excluded"] = null;
    if (unticked.has(key)) excluded = "you";
    else if (noResult) excluded = "no-result";
    else if (optional && optedOut) excluded = "optout";
    else if (template.category === "FEE" && amountDue === 0) excluded = "nothing-due";
    else if (channel === "APP" && !p.hasApp) excluded = "no-app";
    else if (dedupe && seenMobile.has(mobile)) excluded = "duplicate";
    if (dedupe && excluded === null) seenMobile.add(mobile);
    rows.push({
      campus: req.campus,
      key,
      grNo: p.grNo,
      studentName: p.name,
      classSection: p.classSection,
      guardian: p.guardian,
      mobile: formatMobile(mobile),
      amountDue,
      daysOverdue: p.daysOverdue,
      optedOut,
      message,
      parts: smsSegments(message).parts,
      excluded,
      channel: goesBy,
      hasApp: p.hasApp,
      ...(sc.result ? { result: sc.result } : sc.tests ? { result: sc.tests } : {}),
    });
  }
  if (a.kind === "DEFAULTERS") rows.sort((x, y) => y.daysOverdue - x.daysOverdue || x.studentName.localeCompare(y.studentName));
  if (a.kind === "EXAM" || a.kind === "LEFT") rows.sort((x, y) => x.classSection.localeCompare(y.classSection, "en", { numeric: true }) || x.studentName.localeCompare(y.studentName));

  const sendable = rows.filter((r) => r.excluded === null);
  const bySms = sendable.filter((r) => r.channel === "SMS");
  const byApp = sendable.filter((r) => r.channel === "APP");
  const segments = bySms.reduce((s, r) => s + r.parts, 0);
  const allSegments = sendable.reduce((s, r) => s + r.parts, 0);
  const approver = can(user, "approvals.decide", req.campus);
  const size = Math.min(500, Math.max(1, Math.floor(req.sampleSize ?? 8)));
  const preview: SmsAudiencePreview = {
    recipients: rows.length,
    excludedOptOut: rows.filter((r) => r.excluded === "optout").length,
    optedOutIncluded: sendable.filter((r) => r.optedOut).length,
    excludedNothingDue: rows.filter((r) => r.excluded === "nothing-due").length,
    excludedNoApp: rows.filter((r) => r.excluded === "no-app").length,
    duplicates: rows.filter((r) => r.excluded === "duplicate").length,
    excludedNoResult: rows.filter((r) => r.excluded === "no-result").length,
    excludedByYou: rows.filter((r) => r.excluded === "you").length,
    sendable: sendable.length,
    segments,
    smsRecipients: bySms.length,
    appRecipients: byApp.length,
    estCost: smsCost(segments, settings.ratePer100),
    costIfAllSms: smsCost(allSegments, settings.ratePer100),
    ratePer100: settings.ratePer100,
    needsApproval: sendable.length >= settings.approvalThreshold && !approver,
    approvalThreshold: settings.approvalThreshold,
    ...(invalid.length ? { invalidNumbers: invalid } : {}),
    // Unticked recipients stay in the list so they can be ticked again.
    sample: rows
      .filter((r) => r.excluded === null || r.excluded === "you")
      .slice(0, size)
      .map(({ campus: _c, excluded, ...r }) => ({ ...r, ...(excluded === "you" ? { unticked: true } : {}) })),
  };
  return { template, rows, preview };
}

// ---------------------------------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------------------------------

/** Turns a batch's audience into queued messages (now). */
function startBatch(id: string) {
  const st = outboxStore.get();
  const b = st.batches.find((x) => x.id === id);
  if (!b) return;
  const user: SessionUser = { id: "system", username: "system", name: b.createdBy, roles: [{ role: "PRINCIPAL", roleName: "", campus: b.campus, campusName: "", permissions: ["approvals.decide"] }] };
  const built = buildAudience(b.request, user);
  if (built instanceof Response) return;
  const now = Date.now();
  const at = demoNow();
  const sms = built.rows.filter((r) => r.excluded === null && r.channel === "SMS");
  const stagger = Math.min(150, Math.floor(15000 / Math.max(1, sms.length)));
  let i = 0;
  let j = 0;
  const rows: MockSmsRow[] = [];
  for (const r of built.rows) {
    if (r.excluded === "nothing-due" || r.excluded === "no-app" || r.excluded === "duplicate" || r.excluded === "no-result" || r.excluded === "you") continue;
    const base = {
      campus: r.campus,
      at,
      mobile: r.mobile,
      guardian: r.guardian,
      studentName: r.studentName,
      grNo: r.grNo,
      classSection: r.classSection,
      templateName: built.template.name,
      language: b.language,
      message: r.message,
      batchId: b.id,
      parts: r.parts,
    };
    if (r.excluded === "optout") {
      rows.push({ ...base, id: `${b.id}-o${j++}`, status: "optedout", channel: "SMS", error: "Guardian opted out of notices" });
      continue;
    }
    if (r.channel === "APP") {
      rows.push({ ...base, id: `${b.id}-a${j++}`, status: "queued", channel: "APP", queuedAt: now + Math.floor(j / 40) * 100 });
      continue;
    }
    const k = i++;
    // About one number in thirty fails the first time; one in ninety is simply wrong and fails again on retry.
    const wrong = k % 93 === 92;
    const once = !wrong && k % 31 === 30;
    rows.push({
      ...base,
      id: `${b.id}-s${k}`,
      status: "queued",
      channel: "SMS",
      queuedAt: now + k * stagger,
      ...(wrong ? { willFail: true, lastError: "Invalid number — not a mobile number on any network" } : {}),
      ...(once ? { failOnce: true, lastError: "Phone switched off — no delivery report from the network" } : {}),
    });
  }
  outboxStore.set((s) => ({
    ...s,
    rows: [...rows, ...s.rows],
    batches: s.batches.map((x) => (x.id === id ? { ...x, status: "SENDING" as const, sentAt: at, startedAtMs: now } : x)),
  }));
}

/** "2026-11-04T16:30:00+05:00" → minutes after midnight. */
const minutesOf = (iso: string) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
const hm = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
function inQuietHours(iso: string, s: SmsGatewaySettings) {
  const m = minutesOf(iso);
  const from = hm(s.quietFrom);
  const to = hm(s.quietTo);
  return from > to ? m >= from || m < to : m >= from && m < to;
}
const time12 = (s: string) => {
  const h = Number(s.slice(0, 2));
  return `${((h + 11) % 12) + 1}:${s.slice(3, 5)} ${h < 12 ? "AM" : "PM"}`;
};

/**
 * Queues a send for any module (Messages, Notices; attendance and fees can call it too).
 * Returns the result or an error response.
 */
export function queueBatch(req: SmsAudienceRequest, user: SessionUser): SmsSendResult | Response {
  if (req.session !== CURRENT_SESSION) return fail(409, "SESSION_READ_ONLY", "Past sessions are read-only. Switch to the current session to send messages.");
  const built = buildAudience(req, user);
  if (built instanceof Response) return built;
  const p = built.preview;
  if (p.sendable === 0) return fail(422, "NO_RECIPIENTS", "Nobody in this list can receive this message. Change the classes or filters.");
  const channel = req.channel ?? "SMS";
  const settings = settingsOf(req.campus);
  if (smsStatusStore.get().paused && (p.smsRecipients ?? 0) > 0) return fail(423, "SMS_PAUSED", channel === "SMS" ? "All SMS are paused. Ask an admin to resume SMS, or send as an app notification only." : "All SMS are paused, and some of these families don't have the app. Send as an app notification only, or ask an admin to resume SMS.");
  if (req.scheduledFor) {
    if (req.scheduledFor <= demoNow()) return fail(422, "VALIDATION", "Choose a time later than now.", { field: "scheduledFor" });
    if (req.scheduledFor.slice(0, 10) > "2027-03-31") return fail(422, "VALIDATION", "Schedule within this session (until 31-Mar-2027).", { field: "scheduledFor" });
    if (channel !== "APP" && inQuietHours(req.scheduledFor, settings)) return fail(422, "VALIDATION", `SMS can't go out between ${time12(settings.quietFrom)} and ${time12(settings.quietTo)}. Choose a time in the day.`, { field: "scheduledFor" });
  }
  const id = `b-${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  const status: SmsBatchStatus = p.needsApproval ? "AWAITING_APPROVAL" : req.scheduledFor ? "SCHEDULED" : "SENDING";
  const sample = p.sample[0]?.message ?? (req.language === "ur" ? built.template.ur : built.template.en);
  const batch: MockBatch = {
    id,
    campus: req.campus,
    session: req.session,
    createdAt: demoNow(),
    createdBy: user.name,
    templateId: req.templateId,
    templateName: built.template.name,
    category: built.template.category,
    language: req.language,
    channel,
    audienceLabel: audienceLabel(req.audience),
    status,
    ...(req.scheduledFor ? { scheduledFor: req.scheduledFor } : {}),
    recipients: p.sendable,
    smsRecipients: p.smsRecipients ?? p.sendable,
    appRecipients: p.appRecipients ?? 0,
    segments: p.segments,
    estCost: p.estCost ?? 0,
    saved: Math.max(0, (p.costIfAllSms ?? 0) - (p.estCost ?? 0)),
    sampleMessage: sample,
    ...(req.title ? { title: req.title } : {}),
    source: req.source ?? "Messages",
    request: req,
    extra: { ...ZERO_COUNTS },
  };
  outboxStore.set((s) => ({ ...s, batches: [batch, ...s.batches] }));
  if (req.templateId !== "custom") templatesStore.set((list) => list.map((t) => (t.id === req.templateId ? { ...t, uses: (t.uses ?? 0) + 1 } : t)));
  if (status === "SENDING") startBatch(id);
  // Result messages are logged on the exam too, so Exams shows when they last went out.
  const aud = req.audience;
  if (aud.kind === "EXAM") {
    const what = status === "AWAITING_APPROVAL" ? "waiting for the principal's approval" : status === "SCHEDULED" ? `scheduled for ${req.scheduledFor}` : "queued";
    examsStore.set((list) =>
      list.map((e) =>
        e.id === aud.examId
          ? { ...e, history: [...e.history, { id: `${id}-h`, at: demoNow(), by: user.name, action: "Result messages sent", detail: `${formatCount(p.sendable)} ${p.sendable === 1 ? "family" : "families"} · ${formatCount(p.appRecipients ?? 0)} by app, ${formatCount(p.smsRecipients ?? 0)} by SMS · ${what} · Messages ref ${id}` }] }
          : e,
      ),
    );
  }
  return {
    batchId: id,
    queued: p.sendable,
    excludedOptOut: p.excludedOptOut,
    segments: p.segments,
    status,
    ...(req.scheduledFor ? { scheduledFor: req.scheduledFor } : {}),
    appQueued: p.appRecipients ?? 0,
    estCost: p.estCost ?? 0,
  };
}

/** One message another module has already written for a student's guardian. */
export interface PreparedSms {
  grNo: string;
  studentName: string;
  classSection: string;
  guardian: string;
  mobile: string;
  message: string;
}

/**
 * A template's message for one student's guardian (the welcome SMS on admission, an expulsion notice), ready for
 * queueSms. Undefined when the template is gone or archived.
 */
export function preparedFor(templateId: string, s: Pick<StudentRecord, "grNo" | "name" | "nameUr" | "classSection" | "campus" | "guardian">, language: SmsLanguage = "en"): PreparedSms | undefined {
  const t = liveTemplate(templateId);
  if (!t || t.archived) return undefined;
  const message = smsRender(language === "ur" ? t.ur : t.en, {
    student_name: language === "ur" && s.nameUr ? s.nameUr : s.name,
    class: s.classSection,
    campus: campusName(s.campus),
    guardian_name: s.guardian.name,
  });
  return { grNo: s.grNo, studentName: s.name, classSection: s.classSection, guardian: s.guardian.name, mobile: s.guardian.mobile, message };
}

/**
 * Queues messages another module has already written, one per guardian (the welcome SMS on admission, an expulsion
 * notice), so they show in Messages → Outbox and the delivery report like any other send. While all SMS are paused
 * they wait in the Outbox ("held") and go out once SMS is resumed. Guardians who opted out are left out of optional
 * messages (notices, general). Returns the batch, or null when there is nobody to send to.
 */
export function queueSms(
  messages: PreparedSms[],
  input: { campus: CampusCode; session?: number; templateId: string; language?: SmsLanguage; title: string; source: string; createdBy: string; audienceLabel: string },
): { batchId: string; queued: number; held: boolean } | null {
  const template = templatesNow().find((t) => t.id === input.templateId);
  const optional = template ? SMS_OPTIONAL_CATEGORIES.includes(template.category) : false;
  const opted = new Set(optOutStore.get().filter((o) => o.campus === input.campus).map((o) => normalizeMobile(o.mobile)));
  const list = messages.filter((m) => m.message.trim() && normalizeMobile(m.mobile) && !(optional && opted.has(normalizeMobile(m.mobile))));
  if (list.length === 0) return null;
  const id = queuePrepared({ ...input, session: input.session ?? CURRENT_SESSION, language: input.language ?? "en", messages: list });
  return { batchId: id, queued: list.length, held: smsStatusStore.get().paused };
}

function queuePrepared(input: {
  campus: CampusCode;
  session: number;
  templateId: string;
  language: SmsLanguage;
  title: string;
  source: string;
  createdBy: string;
  audienceLabel: string;
  messages: PreparedSms[];
}): string {
  const template = templatesNow().find((t) => t.id === input.templateId);
  const id = `b-${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  const now = Date.now();
  const at = demoNow();
  const rows: MockSmsRow[] = input.messages.map((m, k) => ({
    id: `${id}-s${k}`,
    campus: input.campus,
    at,
    mobile: formatMobile(normalizeMobile(m.mobile) ?? m.mobile),
    guardian: m.guardian,
    studentName: m.studentName,
    grNo: m.grNo,
    classSection: m.classSection,
    templateName: template?.name ?? input.title,
    language: input.language,
    message: m.message,
    batchId: id,
    parts: smsSegments(m.message).parts,
    status: "queued",
    channel: "SMS",
    queuedAt: now + k * 200,
  }));
  const segments = rows.reduce((s, r) => s + (r.parts ?? 1), 0);
  const batch: MockBatch = {
    id,
    campus: input.campus,
    session: input.session,
    createdAt: at,
    createdBy: input.createdBy,
    templateId: input.templateId,
    templateName: template?.name ?? input.title,
    category: template?.category ?? "ATTENDANCE",
    language: input.language,
    channel: "SMS",
    audienceLabel: input.audienceLabel,
    status: "SENDING",
    sentAt: at,
    startedAtMs: now,
    recipients: rows.length,
    smsRecipients: rows.length,
    appRecipients: 0,
    segments,
    estCost: smsCost(segments, settingsOf(input.campus).ratePer100),
    saved: 0,
    sampleMessage: rows[0]!.message,
    title: input.title,
    source: input.source,
    request: {
      campus: input.campus,
      session: input.session,
      templateId: input.templateId,
      language: input.language,
      audience: { kind: "NUMBERS", numbers: rows.map((r) => r.mobile), label: input.audienceLabel },
      channel: "SMS",
      title: input.title,
      source: input.source,
    },
    extra: { ...ZERO_COUNTS },
  };
  outboxStore.set((s) => ({ ...s, rows: [...rows, ...s.rows], batches: [batch, ...s.batches] }));
  templatesStore.set((list) => list.map((t) => (t.id === input.templateId ? { ...t, uses: (t.uses ?? 0) + 1 } : t)));
  return id;
}

/** Batches to show for a campus scope, newest first; waiting and scheduled ones on top. */
function batchesFor(scope: CampusScope): MockBatch[] {
  const order: Record<SmsBatchStatus, number> = { AWAITING_APPROVAL: 0, SCHEDULED: 1, SENDING: 2, SENT: 3, CANCELLED: 3, REJECTED: 3 };
  return outboxStore
    .get()
    .batches.filter((b) => inScope(scope, b.campus))
    .sort((a, b) => order[a.status] - order[b.status] || (a.status === "SCHEDULED" ? (a.scheduledFor ?? "").localeCompare(b.scheduledFor ?? "") : b.createdAt.localeCompare(a.createdAt)));
}

const sentOn = (b: MockBatch) => (b.sentAt ?? b.createdAt).slice(0, 10);
const isLive = (b: MockBatch) => b.status === "SENT" || b.status === "SENDING";

function todayTotals(scope: CampusScope) {
  const st = outboxStore.get();
  const totals: Record<SmsDeliveryStatus, number> = { queued: 0, sent: 0, delivered: 0, failed: 0, optedout: 0 };
  let app = 0;
  for (const b of st.batches) {
    if (!inScope(scope, b.campus) || !isLive(b) || sentOn(b) !== DEMO_TODAY) continue;
    const c = countsOf(b, st.rows);
    totals.queued += c.queued;
    totals.sent += c.sent;
    totals.delivered += c.delivered;
    totals.failed += c.failed;
    totals.optedout += c.optedout;
    app += c.app;
  }
  return { totals, app };
}

const addDays = (d: IsoDate, n: number): IsoDate => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

function guard(user: SessionUser | Response, b: MockBatch | undefined): Response | null {
  if (user instanceof Response) return user;
  if (!b) return fail(404, "NOT_FOUND", "This message was not found. It may have been removed.");
  return null;
}

export const smsHandlers = [
  // ---- Kill switch ----
  http.get("/api/sms/status", async () => {
    await latency();
    const user = requireUser();
    if (user instanceof Response) return user;
    return HttpResponse.json(smsStatusStore.get());
  }),
  http.post("/api/sms/pause", async ({ request }) => {
    await latency();
    const user = requirePermission("sms.pause", "ALL");
    if (user instanceof Response) return user;
    const { reason } = (await request.json()) as { reason: string };
    if (!reason?.trim()) return fail(422, "VALIDATION", "Give a reason for pausing SMS.", { field: "reason" });
    const status: SmsSystemStatus = { paused: true, pausedBy: user.name, pausedAt: demoNow(), reason: reason.trim() };
    smsStatusStore.set(status);
    return HttpResponse.json(status);
  }),
  http.post("/api/sms/resume", async () => {
    await latency();
    const user = requirePermission("sms.pause", "ALL");
    if (user instanceof Response) return user;
    smsStatusStore.set({ paused: false });
    // Held messages go out in order from now, not all at once.
    const now = Date.now();
    let k = 0;
    outboxStore.set((s) => ({ ...s, rows: s.rows.map((r) => (r.channel !== "APP" && r.status === "queued" ? { ...r, queuedAt: now + k++ * 60 } : r)) }));
    return HttpResponse.json(smsStatusStore.get());
  }),

  // ---- Templates ----
  http.get("/api/sms/templates", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("sms.view", ctx.campus);
    if (user instanceof Response) return user;
    return HttpResponse.json(templatesNow());
  }),
  http.post("/api/sms/templates", async ({ request }) => {
    await latency();
    const user = requireUser();
    if (user instanceof Response) return user;
    if (!user.roles.some((g) => g.permissions.includes("sms.send"))) return fail(403, "FORBIDDEN", "Your role can't add message templates.");
    const body = (await request.json()) as { name: string; category: SmsTemplateCategory; en: string; ur: string };
    if (!body.name?.trim()) return fail(422, "VALIDATION", "Give the template a name staff will recognise.", { field: "name" });
    if (templatesNow().some((t) => !t.archived && t.name.toLowerCase() === body.name.trim().toLowerCase())) return fail(409, "DUPLICATE", "A template with this name already exists. Choose another name.", { field: "name" });
    if (!body.en?.trim()) return fail(422, "VALIDATION", "Write the English message.", { field: "en" });
    if (!body.ur?.trim()) return fail(422, "VALIDATION", "Write the Urdu message.", { field: "ur" });
    for (const [field, text] of [["en", body.en], ["ur", body.ur]] as const) {
      const unknown = smsUnknownVariables(text);
      if (unknown.length) return fail(422, "VALIDATION", `Unknown variable {${unknown[0]}}. Use one of the variable chips.`, { field });
    }
    const t: SmsTemplate = { id: `tpl-${Date.now().toString(36)}`, name: body.name.trim(), category: body.category, en: body.en.trim(), ur: body.ur.trim(), updatedAt: demoNow(), updatedBy: user.name, uses: 0 };
    templatesStore.set((list) => [...list, t]);
    return HttpResponse.json(t, { status: 201 });
  }),
  http.put("/api/sms/templates/:id", async ({ params, request }) => {
    await latency();
    const user = requireUser();
    if (user instanceof Response) return user;
    if (!user.roles.some((g) => g.permissions.includes("sms.send"))) return fail(403, "FORBIDDEN", "Your role can't change SMS templates.");
    const id = String(params.id);
    const current = templatesNow().find((t) => t.id === id);
    if (!current) return fail(404, "NOT_FOUND", "That template no longer exists.");
    const { en, ur, name } = (await request.json()) as { en: string; ur: string; name?: string };
    if (!en?.trim()) return fail(422, "VALIDATION", "Write the English message.", { field: "en" });
    if (!ur?.trim()) return fail(422, "VALIDATION", "Write the Urdu message.", { field: "ur" });
    for (const [field, text] of [["en", en], ["ur", ur]] as const) {
      const unknown = smsUnknownVariables(text);
      if (unknown.length) return fail(422, "VALIDATION", `Unknown variable {${unknown[0]}}. Use one of the variable chips.`, { field });
    }
    const saved: SmsTemplate = { ...current, ...(name?.trim() ? { name: name.trim() } : {}), en: en.trim(), ur: ur.trim(), updatedAt: demoNow(), updatedBy: user.name };
    templatesStore.set((list) => list.map((t) => (t.id === id ? saved : t)));
    return HttpResponse.json(saved);
  }),
  http.post("/api/sms/templates/:id/archive", async ({ params }) => {
    await latency();
    const user = requireUser();
    if (user instanceof Response) return user;
    if (!user.roles.some((g) => g.permissions.includes("sms.send"))) return fail(403, "FORBIDDEN", "Your role can't archive templates.");
    const t = templatesNow().find((x) => x.id === String(params.id));
    if (!t) return fail(404, "NOT_FOUND", "That template no longer exists.");
    if (t.builtIn) return fail(409, "BUILT_IN", "Built-in templates can be reworded but not archived, because other modules send them automatically.");
    const saved = { ...t, archived: true, updatedAt: demoNow(), updatedBy: user.name };
    templatesStore.set((list) => list.map((x) => (x.id === t.id ? saved : x)));
    return HttpResponse.json(saved);
  }),

  // ---- Compose and send ----
  http.get("/api/sms/staff", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("sms.send", ctx.campus);
    if (user instanceof Response) return user;
    if (ctx.campus === "ALL") return HttpResponse.json([]);
    const list: SmsStaffMember[] = staffOf(ctx.campus as CampusCode).map((s) => ({ id: s.id, name: s.name, designation: s.designation, department: s.department, gender: s.gender, teaching: s.teaching, mobile: formatMobile(s.mobile) }));
    return HttpResponse.json(list);
  }),
  http.post("/api/sms/audience/preview", async ({ request }) => {
    await latency();
    const body = (await request.json()) as SmsAudienceRequest;
    const user = requirePermission("sms.send", body.campus);
    if (user instanceof Response) return user;
    const built = buildAudience(body, user);
    if (built instanceof Response) return built;
    return HttpResponse.json(built.preview);
  }),
  http.post("/api/sms/send", async ({ request }) => {
    await latency();
    const key = request.headers.get("Idempotency-Key");
    if (!key) return fail(400, "IDEMPOTENCY_KEY_REQUIRED", "Missing idempotency key.");
    const body = (await request.json()) as SmsAudienceRequest;
    const user = requirePermission("sms.send", body.campus);
    if (user instanceof Response) return user;
    const done = outboxStore.get().idem[key];
    if (done) return HttpResponse.json(done);
    const result = queueBatch(body, user);
    if (result instanceof Response) return result;
    outboxStore.set((s) => ({ ...s, idem: { ...s.idem, [key]: result } }));
    return HttpResponse.json(result, { status: 201 });
  }),

  // ---- Outbox ----
  http.get("/api/sms/batches", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requirePermission("sms.view", ctx.campus);
    if (user instanceof Response) return user;
    progress();
    const status = url.searchParams.get("status") as SmsBatchStatus | null;
    const rows = outboxStore.get().rows;
    return HttpResponse.json(
      batchesFor(ctx.campus)
        .filter((b) => !status || b.status === status)
        .map((b) => toBatch(b, rows)),
    );
  }),
  http.get("/api/sms/batches/:id", async ({ params }) => {
    await latency();
    progress();
    const st = outboxStore.get();
    const b = st.batches.find((x) => x.id === String(params.id));
    const user = b ? requirePermission("sms.view", b.campus) : requireUser();
    const bad = guard(user, b);
    if (bad) return bad;
    const detail: SmsBatchDetail = {
      ...toBatch(b!, st.rows),
      request: b!.request,
      rows: st.rows
        .filter((r) => r.batchId === b!.id)
        .slice(0, 100)
        .map(({ queuedAt: _q, willFail: _w, lastError: _l, read: _r, failOnce: _f, ...r }) => r),
    };
    return HttpResponse.json(detail);
  }),
  http.post("/api/sms/batches/:id/decide", async ({ params, request }) => {
    await latency();
    const b = outboxStore.get().batches.find((x) => x.id === String(params.id));
    const user = b ? requirePermission("approvals.decide", b.campus) : requireUser();
    const bad = guard(user, b);
    if (bad) return bad;
    const u = user as SessionUser;
    if (b!.status !== "AWAITING_APPROVAL") return fail(409, "ALREADY_DECIDED", "Someone already decided on this message. Refresh to see what happened.");
    const { decision, note } = (await request.json()) as { decision: "approve" | "reject"; note?: string };
    if (decision === "reject" && !note?.trim()) return fail(422, "VALIDATION", "Say why it isn't approved, so the sender can fix it.", { field: "note" });
    if (decision === "approve" && smsStatusStore.get().paused && b!.channel !== "APP") return fail(423, "SMS_PAUSED", "All SMS are paused. Ask an admin to resume SMS, then approve.");
    const later = b!.scheduledFor && b!.scheduledFor > demoNow();
    const next: SmsBatchStatus = decision === "reject" ? "REJECTED" : later ? "SCHEDULED" : "SENDING";
    outboxStore.set((s) => ({ ...s, batches: s.batches.map((x) => (x.id === b!.id ? { ...x, status: next, decidedBy: u.name, decidedAt: demoNow(), ...(note?.trim() ? { decisionNote: note.trim() } : {}) } : x)) }));
    if (next === "SENDING") startBatch(b!.id);
    const st = outboxStore.get();
    return HttpResponse.json(toBatch(st.batches.find((x) => x.id === b!.id)!, st.rows));
  }),
  http.post("/api/sms/batches/:id/cancel", async ({ params, request }) => {
    await latency();
    const b = outboxStore.get().batches.find((x) => x.id === String(params.id));
    const user = b ? requirePermission("sms.send", b.campus) : requireUser();
    const bad = guard(user, b);
    if (bad) return bad;
    const u = user as SessionUser;
    if (b!.status !== "SCHEDULED" && b!.status !== "AWAITING_APPROVAL") return fail(409, "ALREADY_SENT", "This message has already gone out, so it can't be cancelled.");
    const { reason } = (await request.json()) as { reason?: string };
    outboxStore.set((s) => ({ ...s, batches: s.batches.map((x) => (x.id === b!.id ? { ...x, status: "CANCELLED" as const, decidedBy: u.name, decidedAt: demoNow(), ...(reason?.trim() ? { decisionNote: reason.trim() } : {}) } : x)) }));
    const st = outboxStore.get();
    return HttpResponse.json(toBatch(st.batches.find((x) => x.id === b!.id)!, st.rows));
  }),
  http.post("/api/sms/batches/:id/send-now", async ({ params }) => {
    await latency();
    const b = outboxStore.get().batches.find((x) => x.id === String(params.id));
    const user = b ? requirePermission("sms.send", b.campus) : requireUser();
    const bad = guard(user, b);
    if (bad) return bad;
    if (b!.status !== "SCHEDULED") return fail(409, "NOT_SCHEDULED", "Only scheduled messages can be sent early.");
    if (smsStatusStore.get().paused && b!.channel !== "APP") return fail(423, "SMS_PAUSED", "All SMS are paused. Ask an admin to resume SMS, then send.");
    startBatch(b!.id);
    const st = outboxStore.get();
    return HttpResponse.json(toBatch(st.batches.find((x) => x.id === b!.id)!, st.rows));
  }),
  http.post("/api/sms/batches/:id/reschedule", async ({ params, request }) => {
    await latency();
    const b = outboxStore.get().batches.find((x) => x.id === String(params.id));
    const user = b ? requirePermission("sms.send", b.campus) : requireUser();
    const bad = guard(user, b);
    if (bad) return bad;
    if (b!.status !== "SCHEDULED") return fail(409, "NOT_SCHEDULED", "Only scheduled messages can be moved.");
    const { scheduledFor } = (await request.json()) as { scheduledFor: string };
    if (!scheduledFor || scheduledFor <= demoNow()) return fail(422, "VALIDATION", "Choose a time later than now.", { field: "scheduledFor" });
    const s = settingsOf(b!.campus);
    if (b!.channel !== "APP" && inQuietHours(scheduledFor, s)) return fail(422, "VALIDATION", `SMS can't go out between ${time12(s.quietFrom)} and ${time12(s.quietTo)}.`, { field: "scheduledFor" });
    outboxStore.set((st) => ({ ...st, batches: st.batches.map((x) => (x.id === b!.id ? { ...x, scheduledFor, request: { ...x.request, scheduledFor } } : x)) }));
    const st = outboxStore.get();
    return HttpResponse.json(toBatch(st.batches.find((x) => x.id === b!.id)!, st.rows));
  }),

  // ---- Delivery report ----
  http.get("/api/sms/report", async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const ctx = ctxFrom(url);
    const user = requirePermission("sms.view", ctx.campus);
    if (user instanceof Response) return user;
    progress();
    const batch = url.searchParams.get("batch");
    const st = outboxStore.get();
    const rows = st.rows.filter((r) => inScope(ctx.campus, r.campus) && (!batch || r.batchId === batch));
    let totals: Record<SmsDeliveryStatus, number>;
    let app = 0;
    if (batch) {
      const b = st.batches.find((x) => x.id === batch);
      const c = b ? countsOf(b, st.rows) : { ...ZERO_COUNTS };
      totals = { queued: c.queued, sent: c.sent, delivered: c.delivered, failed: c.failed, optedout: c.optedout };
      app = c.app;
    } else {
      const t = todayTotals(ctx.campus);
      totals = t.totals;
      app = t.app;
    }
    const report: SmsReport = {
      totals,
      appToday: app,
      rows: [...rows]
        .sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id))
        .slice(0, batch ? 500 : 300)
        .map(({ queuedAt: _q, willFail: _w, lastError: _l, read: _r, failOnce: _f, ...r }) => r),
    };
    return HttpResponse.json(report);
  }),
  http.post("/api/sms/report/retry-failed", async ({ request }) => {
    await latency();
    const { campus, batchId } = (await request.json()) as { campus: CampusScope; batchId?: string };
    const user = requirePermission("sms.send", campus);
    if (user instanceof Response) return user;
    if (smsStatusStore.get().paused) return fail(423, "SMS_PAUSED", "All SMS are paused. Ask an admin to resume SMS, then retry.");
    const now = Date.now();
    let retried = 0;
    outboxStore.set((st) => ({
      ...st,
      rows: st.rows.map((r) => {
        if (r.status !== "failed" || !inScope(campus, r.campus) || (batchId && r.batchId !== batchId)) return r;
        const { error: _e, ...rest } = r;
        return { ...rest, status: "queued" as const, at: demoNow(), queuedAt: now + retried++ * 150 };
      }),
    }));
    return HttpResponse.json({ retried });
  }),

  // ---- Opt-outs ----
  http.get("/api/sms/opt-outs", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("sms.view", ctx.campus);
    if (user instanceof Response) return user;
    return HttpResponse.json(optOutStore.get().filter((o) => inScope(ctx.campus, o.campus)));
  }),
  http.post("/api/sms/opt-outs", async ({ request }) => {
    await latency();
    const body = (await request.json()) as { campus: CampusCode; mobile: string; via: string };
    const user = requirePermission("sms.send", body.campus);
    if (user instanceof Response) return user;
    const mobile = normalizeMobile(body.mobile ?? "");
    if (!mobile) return fail(422, "VALIDATION", "Enter an 11-digit mobile number starting with 03, for example 0300-1234567.", { field: "mobile" });
    if (optOutStore.get().some((o) => o.campus === body.campus && normalizeMobile(o.mobile) === mobile)) return fail(409, "DUPLICATE", "This number is already on the opt-out list.", { field: "mobile" });
    const kids = STUDENTS.filter((s) => s.campus === body.campus && s.status === "ACTIVE" && normalizeMobile(s.guardian.mobile) === mobile);
    let students = kids.map((s) => ({ name: s.name, grNo: s.grNo, classSection: s.classSection }));
    let guardian = kids[0]?.guardian.name;
    if (!students.length) {
      for (const cs of registerSections(body.campus)) {
        for (const e of rosterFor(body.campus, cs)) {
          if (normalizeMobile(e.mobile) === mobile) {
            students.push({ name: e.name, grNo: e.grNo, classSection: cs });
            guardian ??= e.father;
          }
        }
      }
    }
    if (!students.length) return fail(404, "NOT_FOUND", `No guardian at ${campusName(body.campus)} has this mobile number. Check the number, or update it in the student's record first.`, { field: "mobile" });
    students = students.slice(0, 4);
    const o: SmsOptOut = { id: `oo-${Date.now().toString(36)}`, campus: body.campus, mobile: formatMobile(mobile), guardian: guardian ?? "Guardian", students, optedOutAt: demoNow(), via: body.via?.trim() || "Asked at the school office" };
    optOutStore.set((list) => [o, ...list]);
    return HttpResponse.json(o, { status: 201 });
  }),
  http.delete("/api/sms/opt-outs/:id", async ({ params }) => {
    await latency();
    const item = optOutStore.get().find((o) => o.id === String(params.id));
    if (!item) return fail(404, "NOT_FOUND", "This opt-out was already removed.");
    const user = requirePermission("sms.send", item.campus);
    if (user instanceof Response) return user;
    optOutStore.set((list) => list.filter((o) => o.id !== item.id));
    return HttpResponse.json({ status: "ok" });
  }),

  // ---- Overview ----
  http.get("/api/sms/overview", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("sms.view", ctx.campus);
    if (user instanceof Response) return user;
    progress();
    const st = outboxStore.get();
    const mine = st.batches.filter((b) => inScope(ctx.campus, b.campus));
    const live = mine.filter(isLive);
    const { totals, app } = todayTotals(ctx.campus);
    const month = DEMO_TODAY.slice(0, 7);
    const inMonth = live.filter((b) => sentOn(b).startsWith(month));
    const counts = inMonth.map((b) => [b, countsOf(b, st.rows)] as const);
    const smsSent = counts.reduce((s, [, c]) => s + c.delivered + c.failed + c.sent + c.queued, 0);
    const appSent = counts.reduce((s, [, c]) => s + c.app, 0);
    const campuses = ALL.filter((c) => inScope(ctx.campus, c));
    const trend: SmsTrendDay[] = [];
    for (let i = 13; i >= 0; i--) {
      const date = addDays(DEMO_TODAY, -i);
      const day = live.filter((b) => sentOn(b) === date).map((b) => countsOf(b, st.rows));
      trend.push({ date, sms: day.reduce((s, c) => s + c.delivered + c.failed + c.sent + c.queued, 0), app: day.reduce((s, c) => s + c.app, 0), failed: day.reduce((s, c) => s + c.failed, 0) });
    }
    const byCat = new Map<SmsTemplateCategory, number>();
    for (const [b, c] of counts) byCat.set(b.category, (byCat.get(b.category) ?? 0) + c.delivered + c.failed + c.sent + c.queued + c.app);
    const overview: SmsOverview = {
      today: { ...totals, app },
      deliveryRate: totals.delivered + totals.failed > 0 ? Math.round((totals.delivered / (totals.delivered + totals.failed)) * 1000) / 10 : 100,
      month: {
        label: "November 2026",
        messages: smsSent + appSent,
        sms: smsSent,
        segments: inMonth.reduce((s, b) => s + b.segments, 0),
        app: appSent,
        cost: inMonth.reduce((s, b) => s + b.estCost, 0),
        saved: inMonth.reduce((s, b) => s + b.saved, 0),
        budget: campuses.reduce((s, c) => s + settingsOf(c).monthlyBudget, 0),
      },
      appFamilies: { withApp: campuses.reduce((s, c) => s + Math.round(FAMILIES[c] * APP_ADOPTION[c]), 0), total: campuses.reduce((s, c) => s + FAMILIES[c], 0) },
      trend,
      byCategory: [...byCat.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
      awaitingApproval: mine.filter((b) => b.status === "AWAITING_APPROVAL").map((b) => toBatch(b, st.rows)),
      scheduled: mine
        .filter((b) => b.status === "SCHEDULED")
        .sort((a, b) => (a.scheduledFor ?? "").localeCompare(b.scheduledFor ?? ""))
        .map((b) => toBatch(b, st.rows)),
      recent: live
        .sort((a, b) => (b.sentAt ?? b.createdAt).localeCompare(a.sentAt ?? a.createdAt))
        .slice(0, 6)
        .map((b) => toBatch(b, st.rows)),
    };
    return HttpResponse.json(overview);
  }),

  // ---- Gateway settings ----
  http.get("/api/sms/settings", async ({ request }) => {
    await latency();
    const ctx = ctxFrom(new URL(request.url));
    const user = requirePermission("sms.view", ctx.campus);
    if (user instanceof Response) return user;
    return HttpResponse.json(settingsStore.get().filter((s) => inScope(ctx.campus, s.campus)));
  }),
  http.put("/api/sms/settings/:campus", async ({ params, request }) => {
    await latency();
    const campus = String(params.campus) as CampusCode;
    const user = requirePermission("sms.pause", campus);
    if (user instanceof Response) return fail(403, "FORBIDDEN", "Only an admin can change SMS company settings.");
    const body = (await request.json()) as SmsGatewaySettingsInput;
    if (!/^[A-Za-z0-9 -]{3,11}$/.test(body.senderName ?? "")) return fail(422, "VALIDATION", "Use 3 to 11 letters, numbers, spaces or dashes for the sender name.", { field: "senderName" });
    if (!(body.ratePer100 > 0 && body.ratePer100 < 1000)) return fail(422, "VALIDATION", "Enter what the SMS company charges for 100 SMS, for example Rs 55.", { field: "ratePer100" });
    if (body.backupProvider && body.backupProvider === body.provider) return fail(422, "VALIDATION", "Choose a different company as the backup, or none.", { field: "backupProvider" });
    if (!(body.approvalThreshold >= 50)) return fail(422, "VALIDATION", "Approval is needed from at least 50 recipients.", { field: "approvalThreshold" });
    const saved: SmsGatewaySettings = { ...settingsOf(campus), ...body, updatedAt: demoNow(), updatedBy: user.name };
    settingsStore.set((list) => list.map((s) => (s.campus === campus ? saved : s)));
    return HttpResponse.json(saved);
  }),
  http.post("/api/sms/settings/:campus/test", async ({ params }) => {
    await latency();
    const campus = String(params.campus) as CampusCode;
    const user = requirePermission("sms.pause", campus);
    if (user instanceof Response) return user;
    const s = settingsOf(campus);
    const checkedAt = demoNow();
    settingsStore.set((list) => list.map((x) => (x.campus === campus ? { ...x, lastCheckedAt: checkedAt } : x)));
    return HttpResponse.json({ ok: true, checkedAt, message: `${s.provider} accepted the test. Account active; sender name ${s.senderName} approved.` });
  }),
];
