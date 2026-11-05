import { smsRender, smsSegments, type CampusCode, type SmsAudienceRequest, type SmsBatch, type SmsBatchCounts, type SmsChannel, type SmsDeliveryRow, type SmsGatewaySettings, type SmsLanguage, type SmsOptOut, type SmsTemplate, type SmsTemplateCategory } from "@mtb/api";
import { formatCount, formatMobile, type IsoDate } from "@mtb/domain";
import { DEMO_TODAY } from "../clock";
import { campusName } from "./campuses";
import { findStudent, STUDENTS, type StudentRecord } from "./students";

const tpl = (id: string, name: string, category: SmsTemplateCategory, en: string, ur: string, updatedAt: string, updatedBy: string, uses: number): SmsTemplate => ({ id, name, category, en, ur, updatedAt, updatedBy, builtIn: true, uses });

/** Seed templates. The fee reminder is the brief's sample text, verbatim (§7.12). */
export const SMS_TEMPLATES: SmsTemplate[] = [
  tpl(
    "tpl-fee-reminder",
    "Fee reminder",
    "FEE",
    "Dear Parent, the fee of Rs {amount_due} for {student_name} ({class}) is due on {due_date}. Please pay on time to avoid a late fine of Rs 10 per day. – MTB {campus}",
    "محترم والدین، {student_name} ({class}) کی {amount_due} روپے فیس کی آخری تاریخ {due_date} ہے۔ یومیہ 10 روپے جرمانے سے بچنے کے لیے براہِ کرم بروقت ادائیگی کریں۔ — MTB {campus}",
    "2026-10-28T12:10:00+05:00",
    "Mrs Sadia Rehman",
    14,
  ),
  tpl(
    "tpl-fee-overdue",
    "Fee overdue",
    "FEE",
    "Dear Parent, the fee of Rs {amount_due} for {student_name} ({class}) was due on {due_date} and is now overdue. A late fine of Rs 10 per day applies. Please pay at the school office. - MTB {campus}",
    "محترم والدین، {student_name} ({class}) کی {amount_due} روپے فیس کی آخری تاریخ {due_date} گزر چکی ہے۔ یومیہ 10 روپے جرمانہ لاگو ہے، براہِ کرم جلد اسکول آفس میں ادائیگی کریں۔ — MTB {campus}",
    "2026-10-28T12:14:00+05:00",
    "Mrs Sadia Rehman",
    9,
  ),
  tpl(
    "tpl-absent",
    "Absent today",
    "ATTENDANCE",
    "Dear Parent, {student_name} ({class}) is absent from school today. If this is unexpected, please call the school office. - MTB {campus}",
    "محترم والدین، {student_name} ({class}) آج اسکول میں غیر حاضر ہے۔ اگر آپ کو اس کا علم نہیں تو براہِ کرم اسکول آفس سے رابطہ کریں۔ — MTB {campus}",
    "2026-09-01T09:00:00+05:00",
    "Kamran Yousaf",
    142,
  ),
  tpl(
    "tpl-ptm",
    "Parent-teacher meeting",
    "NOTICE",
    "Dear Parent, the parent-teacher meeting for {class} is on Saturday 14-Nov-2026 at 9:00 AM. We look forward to seeing you. - MTB {campus}",
    "محترم والدین، {class} کی والدین اور اساتذہ کی میٹنگ ہفتہ 14-Nov-2026 کو صبح 9 بجے ہوگی۔ آپ کی آمد کا انتظار رہے گا۔ — MTB {campus}",
    "2026-11-02T14:30:00+05:00",
    "Mrs Sadia Rehman",
    3,
  ),
  tpl(
    "tpl-leave",
    "On leave today",
    "ATTENDANCE",
    "Dear Parent, {student_name} ({class}) is marked on leave today as you asked. - MTB {campus}",
    "محترم والدین، آپ کی درخواست پر {student_name} ({class}) کو آج کی چھٹی دے دی گئی ہے۔ — MTB {campus}",
    "2026-09-01T09:05:00+05:00",
    "Kamran Yousaf",
    61,
  ),
  tpl(
    "tpl-result",
    "Result declared",
    "RESULT",
    "Dear Parent, the {exam_name} result of {student_name} ({class}) is declared: {result}. The result card is in the MTB app. - MTB {campus}",
    "محترم والدین، {student_name} ({class}) کا {exam_name} کا نتیجہ جاری کر دیا گیا ہے: {result}۔ رزلٹ کارڈ MTB ایپ میں دیکھا جا سکتا ہے۔ — MTB {campus}",
    "2026-10-20T10:00:00+05:00",
    "Mrs Sadia Rehman",
    4,
  ),
  tpl(
    "tpl-test",
    "Test result",
    "RESULT",
    "Dear Parent, {student_name} ({class}) scored {result} in the {exam_name}. - MTB {campus}",
    "محترم والدین، {student_name} ({class}) نے {exam_name} میں {result} نمبر حاصل کیے۔ — MTB {campus}",
    "2026-10-20T10:05:00+05:00",
    "Mrs Sadia Rehman",
    22,
  ),
  tpl(
    "tpl-tests-month",
    "Tests this month",
    "RESULT",
    "Dear Parent, class tests of {student_name} ({class}): {tests_summary}. Subject-wise: {subject_marks}. - MTB {campus}",
    "محترم والدین، {student_name} ({class}) کے کلاس ٹیسٹ: {tests_summary}۔ مضمون وار: {subject_marks}۔ — MTB {campus}",
    "2026-10-20T10:10:00+05:00",
    "Mrs Sadia Rehman",
    0,
  ),
  tpl(
    "tpl-expelled",
    "Expulsion notice",
    "DISCIPLINE",
    "Dear Parent, {student_name} ({class}) has been expelled from school by the principal's decision. Please meet the principal at the school office. - MTB {campus}",
    "محترم والدین، پرنسپل کے فیصلے کے مطابق {student_name} ({class}) کو اسکول سے خارج کر دیا گیا ہے۔ براہِ کرم اسکول آفس میں پرنسپل سے ملاقات کریں۔ — MTB {campus}",
    "2026-08-12T11:40:00+05:00",
    "Mrs Sadia Rehman",
    1,
  ),
  tpl(
    "tpl-candidate",
    "Entry test schedule",
    "ADMISSION",
    "Dear Parent, the entry test for {student_name} (applying for {class}) is on {event_date} at 9:00 AM at MTB {campus}. Please bring the admission slip.",
    "محترم والدین، {student_name} ({class} میں داخلہ) کا داخلہ ٹیسٹ {event_date} کو صبح 9 بجے MTB {campus} میں ہوگا۔ براہِ کرم داخلہ سلپ ساتھ لائیں۔",
    "2026-10-05T09:30:00+05:00",
    "Farah Naz",
    2,
  ),
  tpl(
    "tpl-entry-result",
    "Entry test result",
    "ADMISSION",
    "Dear Parent, {student_name} scored {result} in the entry test for {class} at MTB {campus}. The admission office will contact you about the merit list.",
    "محترم والدین، {student_name} نے MTB {campus} میں {class} کے داخلہ ٹیسٹ میں {result} نمبر حاصل کیے۔ میرٹ لسٹ کے بارے میں داخلہ آفس آپ سے رابطہ کرے گا۔",
    "2026-10-05T09:40:00+05:00",
    "Farah Naz",
    0,
  ),
  tpl(
    "tpl-portal-invite",
    "Parent portal invitation",
    "GENERAL",
    "Dear Parent, see {student_name}'s attendance, results and fee vouchers in the MTB parent portal. Sign in with this mobile number; a one-time code is sent to it. - MTB {campus}",
    "محترم والدین، {student_name} کی حاضری، نتائج اور فیس واؤچر MTB پیرنٹ پورٹل میں دیکھیں۔ اسی موبائل نمبر سے سائن اِن کریں، ایک بار کا کوڈ اسی نمبر پر آئے گا۔ — MTB {campus}",
    "2026-10-01T09:00:00+05:00",
    "Kamran Yousaf",
    0,
  ),
  tpl(
    "tpl-welcome",
    "Welcome after admission",
    "ADMISSION",
    "Welcome to MTB {campus}! {student_name} is admitted to {class}. Fee vouchers, attendance and results are in the MTB app.",
    "MTB {campus} میں خوش آمدید! {student_name} کو {class} میں داخلہ مل گیا ہے۔ فیس واؤچر، حاضری اور نتائج MTB ایپ میں دیکھے جا سکتے ہیں۔",
    "2026-04-02T09:00:00+05:00",
    "Farah Naz",
    186,
  ),
  tpl(
    "tpl-holiday",
    "School closed",
    "NOTICE",
    "Dear Parent, the school will remain closed on {event_date}. Classes resume on the next working day. - MTB {campus}",
    "محترم والدین، {event_date} کو اسکول بند رہے گا۔ کلاسیں اگلے کام کے دن سے دوبارہ شروع ہوں گی۔ — MTB {campus}",
    "2026-11-03T12:00:00+05:00",
    "Mrs Sadia Rehman",
    6,
  ),
  tpl(
    "tpl-staff-meeting",
    "Staff meeting",
    "STAFF",
    "Dear {guardian_name}, there is a staff meeting today at 1:30 PM in the main hall. Please attend. - Principal, MTB {campus}",
    "محترم {guardian_name}، آج دوپہر 1:30 بجے مین ہال میں اسٹاف میٹنگ ہے۔ براہِ کرم شرکت کریں۔ — پرنسپل، MTB {campus}",
    "2026-09-14T08:00:00+05:00",
    "Mrs Sadia Rehman",
    5,
  ),
];

/** Today's totals per campus before the demo sends anything (Khalid Campus matches the dashboard: 1,240 delivered, 18 failed, 0 queued). */
export const SMS_BASE_TODAY: Record<CampusCode, { delivered: number; failed: number }> = {
  KC: { delivered: 1240, failed: 18 },
  SM: { delivered: 540, failed: 6 },
  UC: { delivered: 690, failed: 4 },
  MC: { delivered: 380, failed: 9 },
  HC: { delivered: 1010, failed: 12 },
};

/** Share of families with the MTB app installed (they get free app notifications). */
export const APP_ADOPTION: Record<CampusCode, number> = { KC: 0.46, SM: 0.31, UC: 0.38, MC: 0.22, HC: 0.57 };

/** Families per campus (for the app adoption figure). */
export const FAMILIES: Record<CampusCode, number> = { KC: 1068, SM: 521, UC: 607, MC: 348, HC: 838 };

/** Gateway settings per campus. Account passwords and keys live in the secure vault, never here. */
export function seedGatewaySettings(): SmsGatewaySettings[] {
  const row = (campus: CampusCode, provider: SmsGatewaySettings["provider"], backupProvider: SmsGatewaySettings["backupProvider"], ratePer100: number, monthlyBudget: number, dailyCap: number): SmsGatewaySettings => ({
    campus,
    campusName: campusName(campus),
    provider,
    backupProvider,
    senderName: `MTB-${campus}`,
    ratePer100,
    monthlyBudget,
    dailyCap,
    approvalThreshold: 1000,
    quietFrom: "21:00",
    quietTo: "07:00",
    credentials: "VERIFIED",
    lastCheckedAt: "2026-11-04T07:30:00+05:00",
    deliveryReports: provider !== "ZONG",
    updatedAt: "2026-09-01T10:00:00+05:00",
    updatedBy: "Kamran Yousaf",
  });
  return [row("KC", "LRT", "UFONE", 55, 30000, 6000), row("SM", "LRT", "UFONE", 55, 14000, 3000), row("UC", "UFONE", "LRT", 52, 16000, 3500), row("MC", "UFONE", null, 52, 9000, 2000), row("HC", "ZONG", "LRT", 58, 26000, 5000)];
}

/** A stored delivery row plus the mock server's bookkeeping. */
export interface MockSmsRow extends SmsDeliveryRow {
  /** Epoch ms when queued in this demo; the mock moves it to sent, then delivered or failed. */
  queuedAt?: number;
  /** Fails again after a retry (wrong number). */
  willFail?: boolean;
  lastError?: string;
  /** Fails the first time only (phone switched off); a retry gets through. */
  failOnce?: boolean;
  /** App notification opened. */
  read?: boolean;
}

/** A stored send (outbox row). Counts come from its rows plus `extra` (messages older than the stored rows). */
export interface MockBatch extends Omit<SmsBatch, "counts"> {
  request: SmsAudienceRequest;
  /** Counts not represented by stored rows (seeded history). */
  extra: SmsBatchCounts;
  /** Batches created in this demo: epoch ms when sending started. */
  startedAtMs?: number;
}

export const ZERO_COUNTS: SmsBatchCounts = { queued: 0, sent: 0, delivered: 0, failed: 0, optedout: 0, app: 0, appRead: 0 };

const ERRORS = ["Invalid number — not a mobile number on any network", "Phone switched off — no delivery report from the network", "Gateway timeout at UFONE — not delivered"];

const TODAY_BATCHES: Array<{ tplId: string; title: string; audience: string; weight: number; at: string; by: string; channel: SmsChannel }> = [
  { tplId: "tpl-absent", title: "Absent today", audience: "Guardians of today's absent students", weight: 0.1, at: "08:40", by: "Attendance (automatic)", channel: "SMS" },
  { tplId: "tpl-fee-reminder", title: "Fee reminder", audience: "Fees due on 10-Nov-2026, every class", weight: 0.58, at: "09:10", by: "Usman Ali", channel: "SMS" },
  { tplId: "tpl-ptm", title: "Parent-teacher meeting", audience: "Classes 6 to 8, all sections", weight: 0.32, at: "09:35", by: "Mrs Sadia Rehman", channel: "APP_FIRST" },
];

function rowFor(s: StudentRecord, i: number, status: "delivered" | "failed", at: string): MockSmsRow {
  const cycle: Array<[string, SmsLanguage]> = [
    ["tpl-absent", "ur"],
    ["tpl-fee-reminder", "en"],
    ["tpl-absent", "en"],
    ["tpl-fee-reminder", "ur"],
    ["tpl-ptm", "en"],
  ];
  const [tplId, language] = cycle[i % cycle.length]!;
  const t = SMS_TEMPLATES.find((x) => x.id === tplId)!;
  const message = smsRender(language === "ur" ? t.ur : t.en, {
    student_name: language === "ur" && s.nameUr ? s.nameUr : s.name,
    class: s.classSection,
    amount_due: formatCount(s.balance || 8500),
    due_date: "10-Nov-2026",
    campus: campusName(s.campus),
  });
  const error = status === "failed" ? ERRORS[i % 9 === 0 ? 0 : 1 + (i % 2)] : undefined;
  return {
    id: `seed-${s.campus}-${status}-${i}`,
    campus: s.campus,
    at,
    mobile: formatMobile(s.guardian.mobile),
    guardian: s.guardian.name,
    studentName: s.name,
    grNo: s.grNo,
    classSection: s.classSection,
    templateName: t.name,
    language,
    message,
    status,
    channel: "SMS",
    batchId: `seed-${s.campus}-${tplId}`,
    parts: smsSegments(message).parts,
    ...(error ? { error, lastError: error, willFail: error === ERRORS[0] } : {}),
  };
}

const time = (minutesAfter8: number) => {
  const h = 8 + Math.floor(minutesAfter8 / 60);
  const m = minutesAfter8 % 60;
  return `${DEMO_TODAY}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+05:00`;
};

/** The latest messages per campus: every failed one, plus the 20 most recent delivered ones. */
export function seedReportRows(): MockSmsRow[] {
  const rows: MockSmsRow[] = [];
  for (const campus of Object.keys(SMS_BASE_TODAY) as CampusCode[]) {
    const pool = STUDENTS.filter((s) => s.campus === campus && s.status === "ACTIVE");
    if (pool.length === 0) continue;
    const { failed } = SMS_BASE_TODAY[campus];
    for (let i = 0; i < failed; i++) rows.push(rowFor(pool[(i * 7) % pool.length]!, i, "failed", time(35 + ((i * 3) % 90))));
    for (let i = 0; i < 20; i++) rows.push(rowFor(pool[(i * 5 + 3) % pool.length]!, i, "delivered", time(40 + i * 4)));
  }
  return rows;
}

/** Two guardians at Khalid Campus have opted out of notices; other campuses have none. */
export function seedOptOuts(): SmsOptOut[] {
  const bilal = findStudent("KC-14650");
  const other = STUDENTS.find((s) => s.campus === "KC" && s.classSection === "6-A" && s.grNo !== "KC-15230");
  return [bilal, other]
    .filter((s): s is StudentRecord => Boolean(s))
    .map((s, i) => ({
      id: `oo-${i + 1}`,
      campus: s.campus,
      mobile: formatMobile(s.guardian.mobile),
      guardian: s.guardian.name,
      students: [{ name: s.name, grNo: s.grNo, classSection: s.classSection }],
      optedOutAt: i === 0 ? "2026-10-12T18:22:00+05:00" : "2026-10-30T11:05:00+05:00",
      via: i === 0 ? "Replied STOP to a notice" : "Asked at the school office",
    }));
}

// ---------- seeded outbox ----------

const addDays = (d: IsoDate, n: number): IsoDate => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const weekday = (d: IsoDate) => new Date(`${d}T00:00:00Z`).getUTCDay();

const SCALE: Record<CampusCode, number> = { KC: 1, SM: 0.49, UC: 0.57, MC: 0.33, HC: 0.78 };

function seedBatch(
  campus: CampusCode,
  id: string,
  date: IsoDate,
  at: string,
  tplId: string,
  audienceLabel: string,
  channel: SmsChannel,
  recipients: number,
  createdBy: string,
  failRate: number,
  language: SmsLanguage = "en",
): MockBatch {
  const t = SMS_TEMPLATES.find((x) => x.id === tplId)!;
  const appShare = channel === "SMS" ? 0 : channel === "APP" ? 1 : APP_ADOPTION[campus];
  const app = Math.round(recipients * appShare);
  const sms = recipients - app;
  const failed = Math.round(sms * failRate);
  const sample = smsRender(language === "ur" ? t.ur : t.en, { student_name: "Ayesha Khan", class: "7-B", amount_due: "8,500", due_date: "10-Nov-2026", campus: campusName(campus), event_date: "09-Nov-2026", exam_name: "First Term", result: "512/700 (73.1%), Grade B" });
  const parts = Math.max(1, smsSegments(sample).parts);
  const rate = campus === "HC" ? 58 : campus === "UC" || campus === "MC" ? 52 : 55;
  return {
    id,
    campus,
    session: 2026,
    createdAt: `${date}T${at}:00+05:00`,
    createdBy,
    templateId: tplId,
    templateName: t.name,
    category: t.category,
    language,
    channel,
    audienceLabel,
    status: "SENT",
    sentAt: `${date}T${at}:00+05:00`,
    recipients,
    smsRecipients: sms,
    appRecipients: app,
    segments: sms * parts,
    estCost: Math.round((sms * parts * rate) / 100),
    saved: Math.round((app * parts * rate) / 100),
    sampleMessage: sample,
    source: createdBy === "Attendance (automatic)" ? "Attendance" : "Messages",
    request: { campus, session: 2026, templateId: tplId, language, audience: { kind: "ALL_PARENTS" }, channel },
    extra: { queued: 0, sent: 0, delivered: sms - failed, failed, optedout: 0, app, appRead: Math.round(app * 0.71) },
  };
}

/** Thirteen school days of history per campus, plus today's three morning sends (wrapping the seeded rows). */
export function seedBatches(rows: MockSmsRow[]): MockBatch[] {
  const out: MockBatch[] = [];
  for (const campus of Object.keys(SMS_BASE_TODAY) as CampusCode[]) {
    const k = SCALE[campus];
    for (let back = 13; back >= 1; back--) {
      const date = addDays(DEMO_TODAY, -back);
      if (weekday(date) === 0) continue;
      const n = back;
      out.push(seedBatch(campus, `h-${campus}-${date}-abs`, date, "08:45", "tpl-absent", "Guardians of the day's absent students", "APP_FIRST", Math.round((84 + ((n * 37) % 41)) * k), "Attendance (automatic)", 0.014, n % 2 ? "ur" : "en"));
      if (n % 3 === 1) out.push(seedBatch(campus, `h-${campus}-${date}-fee`, date, "10:15", n > 6 ? "tpl-fee-overdue" : "tpl-fee-reminder", n > 6 ? "Fee defaulters: overdue more than 15 days" : "Fees due on 10-Nov-2026, every class", "SMS", Math.round((380 + ((n * 53) % 160)) * k), "Usman Ali", 0.017));
      if (n % 4 === 2) out.push(seedBatch(campus, `h-${campus}-${date}-ntc`, date, "12:30", n === 2 ? "tpl-holiday" : "tpl-ptm", n === 2 ? "All parents" : "Classes 6 to 8, all sections", "APP_FIRST", Math.round((n === 2 ? 1290 : 430) * k), "Mrs Sadia Rehman", 0.01));
      if (n === 11) out.push(seedBatch(campus, `h-${campus}-${date}-res`, date, "14:00", "tpl-test", "Monthly test results, Classes 6 to 10", "APP_FIRST", Math.round(610 * k), "Mrs Sadia Rehman", 0.012));
    }
    // Today's morning sends: the stored rows plus the older messages behind them.
    const base = SMS_BASE_TODAY[campus];
    const delivered = rows.filter((r) => r.campus === campus && r.status === "delivered").length;
    const hidden = Math.max(0, base.delivered - delivered);
    let given = 0;
    TODAY_BATCHES.forEach((b, i) => {
      const id = `seed-${campus}-${b.tplId}`;
      const extraDelivered = i === TODAY_BATCHES.length - 1 ? hidden - given : Math.round(hidden * b.weight);
      given += extraDelivered;
      const t = SMS_TEMPLATES.find((x) => x.id === b.tplId)!;
      const own = rows.filter((r) => r.batchId === id);
      const app = b.channel === "APP_FIRST" ? Math.round((own.length + extraDelivered) * APP_ADOPTION[campus] * 1.1) : 0;
      const sms = own.length + extraDelivered;
      const parts = Math.max(1, own[0]?.parts ?? 2);
      const rate = campus === "HC" ? 58 : campus === "UC" || campus === "MC" ? 52 : 55;
      out.push({
        id,
        campus,
        session: 2026,
        createdAt: `${DEMO_TODAY}T${b.at}:00+05:00`,
        createdBy: b.by,
        templateId: b.tplId,
        templateName: t.name,
        category: t.category,
        language: "en",
        channel: b.channel,
        audienceLabel: b.audience,
        status: "SENT",
        sentAt: `${DEMO_TODAY}T${b.at}:00+05:00`,
        recipients: sms + app,
        smsRecipients: sms,
        appRecipients: app,
        segments: sms * parts,
        estCost: Math.round((sms * parts * rate) / 100),
        saved: Math.round((app * parts * rate) / 100),
        sampleMessage: own[0]?.message ?? t.en,
        source: b.by === "Attendance (automatic)" ? "Attendance" : "Messages",
        request: { campus, session: 2026, templateId: b.tplId, language: "en", audience: { kind: "ALL_PARENTS" }, channel: b.channel },
        extra: { ...ZERO_COUNTS, delivered: extraDelivered, app, appRead: Math.round(app * 0.48) },
      });
    });
  }
  return out;
}
