import {
  ApiError,
  examsQueries,
  metaQueries,
  newIdempotencyKey,
  SMS_CATEGORY_LABEL,
  SMS_CHANNEL_LABEL,
  SMS_LEFT_STATUS_LABEL,
  SMS_OPTIONAL_CATEGORIES,
  smsApi,
  smsQueries,
  smsStatusQueries,
  type CampusCode,
  type ClassInfo,
  type SmsAudience,
  type SmsAudienceRequest,
  type SmsChannel,
  type SmsLanguage,
  type SmsLeftStatus,
  type SmsRecipientPreview,
  type SmsStaffGroup,
  type SmsVariable,
} from "@mtb/api";
import { formatCount, formatDate, formatRs, formatSession, normalizeMobile, pakistanToday, type IsoDate } from "@mtb/domain";
import { AmountInput, Banner, Button, ConfirmDialog, DataTable, DatePicker, EmptyState, Field, Icon, Input, Panel, Segmented, Select, Skeleton, StatusBadge, Textarea, useToast, type Column } from "@mtb/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { useCan, useCtx, useReadOnly } from "../../app/session";
import { RequireSingleCampus } from "../../app/shell/page";
import { errorText, isLaterThanNow, isoAt, MessagesShell, TIME_SLOTS, whenText } from "./shell";
import { insertAtCursor, NonGsmWarning, PhonePreview, renderPreview, SmsCount, toStandardCharacters, usesVariable, VariableChips } from "./sms-text";

export interface ComposeSearch {
  template?: string;
  to?: "CLASS" | "DEFAULTERS" | "ALL_PARENTS" | "STAFF" | "NUMBERS" | "CANDIDATES" | "LEFT";
  /** Comma-separated class-sections, e.g. "7-A,7-B". */
  sections?: string;
  /** A declared exam to put in {result} and {exam_name}. */
  exam?: string;
}

type Kind = NonNullable<ComposeSearch["to"]>;

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthLabel = (m: string) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const lastDayOf = (m: string): IsoDate => {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0));
  return d.toISOString().slice(0, 10);
};
/** Monday of the week a date falls in. */
const mondayOf = (d: IsoDate): IsoDate => {
  const x = new Date(`${d}T00:00:00Z`);
  const back = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - back);
  return x.toISOString().slice(0, 10);
};
/** Months of a session up to today: "2026-04" … "2026-11". */
function sessionMonths(session: number, today: IsoDate): string[] {
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(session, 3 + i, 1));
    const m = d.toISOString().slice(0, 7);
    if (m > today.slice(0, 7)) break;
    out.push(m);
  }
  return out;
}

/** Plain-English checks before anything is sent (the server checks again). */
const composeSchema = z
  .object({
    source: z.enum(["template", "custom"]),
    templateId: z.string(),
    language: z.enum(["en", "ur"]),
    en: z.string(),
    ur: z.string(),
    kind: z.enum(["CLASS", "DEFAULTERS", "ALL_PARENTS", "STAFF", "NUMBERS", "CANDIDATES", "LEFT"]),
    sections: z.array(z.string()),
    validNumbers: z.number(),
    needsEventDate: z.boolean(),
    eventDate: z.string().nullable(),
    needsExamPick: z.boolean(),
    examId: z.string(),
    needsPeriod: z.boolean(),
    periodFrom: z.string().nullable(),
    periodTo: z.string().nullable(),
    staffChosen: z.number(),
    regFrom: z.string().nullable(),
    regTo: z.string().nullable(),
    usesApp: z.boolean(),
    title: z.string(),
    later: z.boolean(),
    date: z.string().nullable(),
    time: z.string(),
    today: z.string(),
    sessionEnd: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.source === "template" && !v.templateId) ctx.addIssue({ code: "custom", path: ["templateId"], message: "Choose a template, or write your own message." });
    if (v.source === "custom" && !(v.language === "en" ? v.en : v.ur).trim()) ctx.addIssue({ code: "custom", path: [v.language], message: v.language === "en" ? "Write the message in English, or switch to Urdu." : "Write the message in Urdu, or switch to English." });
    if (v.kind === "CLASS" && v.sections.length === 0) ctx.addIssue({ code: "custom", path: ["sections"], message: "Choose at least one class or section." });
    if (v.kind === "NUMBERS" && v.validNumbers === 0) ctx.addIssue({ code: "custom", path: ["numbers"], message: "Add at least one mobile number starting with 03, for example 0300-1234567." });
    if (v.kind === "STAFF" && v.staffChosen === 0) ctx.addIssue({ code: "custom", path: ["staff"], message: "Tick at least one person." });
    if (v.kind === "CANDIDATES" && v.regFrom && v.regTo && v.regFrom > v.regTo) ctx.addIssue({ code: "custom", path: ["regTo"], message: "The first date must be on or before the second." });
    if (v.needsEventDate && !v.eventDate) ctx.addIssue({ code: "custom", path: ["eventDate"], message: "Choose the date to put in the message." });
    if (v.needsExamPick && !v.examId) ctx.addIssue({ code: "custom", path: ["examId"], message: "Choose a declared exam for the marks." });
    if (v.needsPeriod) {
      if (!v.periodFrom || !v.periodTo) ctx.addIssue({ code: "custom", path: ["periodTo"], message: "Choose the dates of the tests." });
      else if (v.periodFrom > v.periodTo) ctx.addIssue({ code: "custom", path: ["periodTo"], message: "The first date must be on or before the second." });
    }
    if (v.usesApp && !v.title.trim()) ctx.addIssue({ code: "custom", path: ["title"], message: "Give the app notification a short title." });
    if (v.usesApp && v.title.trim().length > 60) ctx.addIssue({ code: "custom", path: ["title"], message: "Keep the title under 60 characters so it fits on a phone." });
    if (v.later) {
      if (!v.date) ctx.addIssue({ code: "custom", path: ["date"], message: "Choose the day to send." });
      else if (v.date < v.today) ctx.addIssue({ code: "custom", path: ["date"], message: "Choose today or a later day." });
      else if (v.date > v.sessionEnd) ctx.addIssue({ code: "custom", path: ["date"], message: `Schedule within this session (until ${formatDate(v.sessionEnd)}).` });
    }
  });

type Errors = Partial<Record<string, string>>;

/** Pulls Pakistani mobile numbers out of pasted text or an uploaded CSV. */
function extractNumbers(text: string): string[] {
  return text
    .split(/[\n,;\t]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function Figure({ label, value, note, good }: { label: string; value: string; note?: string; good?: boolean }) {
  return (
    <div className={good ? "sms-figure sms-figure-good" : "sms-figure"}>
      <span className="sms-figure-label">{label}</span>
      <span className="sms-figure-value">{value}</span>
      {note && <span className="sms-figure-note">{note}</span>}
    </div>
  );
}

/** Class chips: click a class for all its sections, or pick sections one by one. */
function ClassPicker({ classes, loading, value, onChange, label, help, error }: { classes: ClassInfo[]; loading: boolean; value: string[]; onChange: (next: string[]) => void; label: string; help: string; error?: string }) {
  const toggle = (cs: string) => onChange(value.includes(cs) ? value.filter((x) => x !== cs) : [...value, cs]);
  const toggleClass = (all: string[]) => onChange(all.every((cs) => value.includes(cs)) ? value.filter((cs) => !all.includes(cs)) : [...new Set([...value, ...all])]);
  return (
    <Field label={label} help={help} {...(error ? { error } : {})}>
      {() =>
        loading ? (
          <Skeleton height={160} />
        ) : (
          <div className="grid gap-2">
            {classes.map((c) => {
              const all = c.sections.map((s) => `${c.short}-${s}`);
              const allOn = all.every((cs) => value.includes(cs));
              return (
                <div key={c.short} className="sms-class-row">
                  <button type="button" className="sms-chip" aria-pressed={allOn} onClick={() => toggleClass(all)}>
                    {c.name}
                  </button>
                  <div className="sms-chips">
                    {all.map((cs) => (
                      <button key={cs} type="button" className="sms-chip" aria-pressed={value.includes(cs)} onClick={() => toggle(cs)}>
                        {cs}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            {value.length > 0 && (
              <div className="flex items-center gap-2 text-small text-ink-muted">
                {formatCount(value.length)} {value.length === 1 ? "section" : "sections"} chosen
                <Button size="sm" variant="ghost" onClick={() => onChange([])}>
                  Clear
                </Button>
              </div>
            )}
          </div>
        )
      }
    </Field>
  );
}

/** /sms/compose — the old Event, Arrears, Staff, Manual, Candidate, Expelled, Term-result and Cumulative-test SMS screens in one place. */
export function ComposePage({ search }: { search: ComposeSearch }) {
  return (
    <MessagesShell title="Compose a message">
      <RequireSingleCampus action="message sending">
        <ComposeForm search={search} />
      </RequireSingleCampus>
    </MessagesShell>
  );
}

const defaultTemplate = (to?: Kind) => (to === "DEFAULTERS" ? "tpl-fee-overdue" : to === "STAFF" ? "tpl-staff-meeting" : to === "CANDIDATES" ? "tpl-candidate" : to === "LEFT" ? "tpl-expelled" : "tpl-holiday");

function ComposeForm({ search }: { search: ComposeSearch }) {
  const ctx = useCtx();
  const today = pakistanToday();
  // A session runs April to March: schedules stay inside the one in context.
  const sessionEnd: IsoDate = `${ctx.session + 1}-03-31`;
  const canSend = useCan("sms.send");
  const canSeeExams = useCan("exams.view");
  const readOnly = useReadOnly();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const templates = useQuery(smsQueries.templates(ctx));
  const classes = useQuery(metaQueries.classes(ctx.campus));
  const sessions = useQuery(metaQueries.sessions());
  const status = useQuery(smsStatusQueries.status());
  const settings = useQuery(smsQueries.settings(ctx));
  // the newest 200 declared exams (the server pages the exam list, contract change C9)
  const exams = useQuery({ ...examsQueries.list(ctx, { status: "DECLARED", pageSize: 200 }), enabled: canSeeExams });
  const sender = settings.data?.[0]?.senderName ?? "MTB";

  const [source, setSource] = useState<"template" | "custom">(search.template === "custom" ? "custom" : "template");
  const [templateId, setTemplateId] = useState(search.template && search.template !== "custom" ? search.template : search.exam ? "tpl-result" : defaultTemplate(search.to));
  const [en, setEn] = useState("");
  const [ur, setUr] = useState("");
  const enRef = useRef<HTMLTextAreaElement>(null);
  const urRef = useRef<HTMLTextAreaElement>(null);
  const [language, setLanguage] = useState<SmsLanguage>("en");
  const [kind, setKind] = useState<Kind>(search.to ?? (search.sections ? "CLASS" : "ALL_PARENTS"));
  const [sections, setSections] = useState<string[]>(search.sections ? search.sections.split(",").filter(Boolean) : []);
  const [gender, setGender] = useState<"" | "F" | "M">("");
  const [minDays, setMinDays] = useState("15");
  const [minAmount, setMinAmount] = useState<number | null>(5000);
  const [defaulterSections, setDefaulterSections] = useState<string[]>([]);
  const [staffGroup, setStaffGroup] = useState<SmsStaffGroup>("ALL");
  const [departments, setDepartments] = useState<string[]>([]);
  const [staffGender, setStaffGender] = useState<"" | "F" | "M">("");
  const [staffOff, setStaffOff] = useState<Set<string>>(new Set());
  const [numbersText, setNumbersText] = useState("");
  const [classApplied, setClassApplied] = useState("");
  const [regFrom, setRegFrom] = useState<IsoDate | null>(null);
  const [regTo, setRegTo] = useState<IsoDate | null>(null);
  const [testFee, setTestFee] = useState<"" | "PAID" | "UNPAID">("");
  const [testDate, setTestDate] = useState<IsoDate | null>(null);
  const [leftStatus, setLeftStatus] = useState<SmsLeftStatus>("EXPELLED");
  const [leftSession, setLeftSession] = useState(ctx.session);
  const [channel, setChannel] = useState<SmsChannel>(search.to === "NUMBERS" || search.to === "CANDIDATES" ? "SMS" : "APP_FIRST");
  const [title, setTitle] = useState("");
  const [eventDate, setEventDate] = useState<IsoDate | null>(null);
  const [examId, setExamId] = useState(search.exam ?? "");
  const [periodMode, setPeriodMode] = useState<"month" | "week" | "dates">("month");
  const [month, setMonth] = useState("");
  const [from, setFrom] = useState<IsoDate | null>(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState<IsoDate | null>(today);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [later, setLater] = useState(false);
  const [date, setDate] = useState<IsoDate | null>(null);
  const [time, setTime] = useState("08:00");
  const [errors, setErrors] = useState<Errors>({});
  const [tried, setTried] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);

  const active = (templates.data ?? []).filter((t) => !t.archived);
  const template = active.find((t) => t.id === templateId);
  const body = source === "template" ? (template ? (language === "ur" ? template.ur : template.en) : "") : language === "ur" ? ur : en;
  const category = source === "template" ? template?.category : kind === "STAFF" ? "STAFF" : "GENERAL";
  const needsEventDate = usesVariable(body, "event_date");
  const needsPeriod = usesVariable(body, "tests_summary");
  // Candidates' {result} is their entry-test marks; everyone else's comes from a declared exam.
  const needsExamPick = kind !== "CANDIDATES" && kind !== "STAFF" && kind !== "NUMBERS" && (usesVariable(body, "result") || usesVariable(body, "exam_name") || (usesVariable(body, "subject_marks") && !needsPeriod));
  const numbers = useMemo(() => extractNumbers(numbersText), [numbersText]);
  const validNumbers = numbers.filter((n) => normalizeMobile(n)).length;
  // Typed numbers and candidates aren't linked to the MTB app yet, so they always get an SMS.
  const smsOnly = kind === "NUMBERS" || kind === "CANDIDATES";
  const usesApp = !smsOnly && channel !== "SMS";
  const effectiveTitle = title || (source === "template" ? (template?.name ?? "") : "");

  // Declared exams of this campus and session (entrance and programme tests are messaged from Admissions).
  const declared = useMemo(() => (exams.data?.items ?? []).filter((e) => e.status === "DECLARED" && e.category !== "ENTRANCE" && !e.programmeId && e.session === ctx.session), [exams.data, ctx.session]);
  const exam = declared.find((e) => e.id === examId);
  const months = useMemo(() => sessionMonths(ctx.session, today), [ctx.session, today]);
  // Default month: the latest month with a declared class test.
  useEffect(() => {
    if (month || (canSeeExams && exams.isPending)) return;
    const tests = declared.filter((e) => e.category === "TEST").map((e) => e.startDate.slice(0, 7)).sort();
    setMonth(tests[tests.length - 1] ?? months[months.length - 1] ?? today.slice(0, 7));
  }, [declared, months, month, canSeeExams, exams.isPending, today]);
  useEffect(() => {
    if (!examId && declared[0]) setExamId(declared[0].id);
  }, [declared, examId]);
  const period: { from: IsoDate; to: IsoDate } | null =
    periodMode === "month" ? (month ? { from: `${month}-01`, to: lastDayOf(month) } : null) : periodMode === "week" ? { from: mondayOf(today), to: today } : from && to ? { from, to } : null;

  // When the template changes, the app title follows it until someone types their own.
  useEffect(() => setTitle(""), [templateId, source]);
  useEffect(() => {
    if (kind === "NUMBERS" || kind === "CANDIDATES") setChannel("SMS");
  }, [kind]);
  const chooseKind = (next: Kind) => {
    setKind(next);
    if (source === "template" && next === "LEFT" && leftStatus === "EXPELLED") setTemplateId("tpl-expelled");
  };
  const chooseLeftStatus = (next: SmsLeftStatus) => {
    setLeftStatus(next);
    if (next === "PASSED_OUT" && leftSession === ctx.session) setLeftSession(ctx.session - 1);
    if (source === "template" && next === "EXPELLED") setTemplateId("tpl-expelled");
  };

  // Staff: the list to tick from (filtered by group, department and gender).
  const staff = useQuery({ ...smsQueries.staff(ctx), enabled: kind === "STAFF" });
  const staffInGroup = (staff.data ?? []).filter((s) => staffGroup === "ALL" || (staffGroup === "TEACHING" ? s.teaching : !s.teaching));
  const deptOptions = [...new Set(staffInGroup.map((s) => s.department))].sort();
  const staffShown = staffInGroup.filter((s) => (!departments.length || departments.includes(s.department)) && (!staffGender || s.gender === staffGender));
  const staffPicked = staffShown.filter((s) => !staffOff.has(s.id));

  const audience: SmsAudience =
    kind === "CLASS"
      ? { kind: "SECTIONS", classSections: sections, ...(gender ? { gender } : {}) }
      : kind === "DEFAULTERS"
        ? { kind, minDaysOverdue: Math.max(0, Number(minDays) || 0), minAmount: minAmount ?? 0, ...(defaulterSections.length ? { classSections: defaulterSections } : {}) }
        : kind === "ALL_PARENTS"
          ? { kind, ...(gender ? { gender } : {}) }
          : kind === "STAFF"
            ? { kind, group: staffGroup, ...(departments.length ? { departments } : {}), ...(staffGender ? { gender: staffGender } : {}), ...(staff.data && staffPicked.length < staffShown.length ? { staffIds: staffPicked.map((s) => s.id) } : {}) }
            : kind === "CANDIDATES"
              ? { kind, ...(classApplied ? { classApplied } : {}), ...(regFrom ? { registeredFrom: regFrom } : {}), ...(regTo ? { registeredTo: regTo } : {}), ...(testFee ? { testFee } : {}), ...(testDate ? { testDate } : {}) }
              : kind === "LEFT"
                ? { kind, status: leftStatus, session: leftSession, ...(sections.length ? { classSections: sections } : {}), ...(gender ? { gender } : {}) }
                : { kind, numbers, label: `${formatCount(validNumbers)} typed or uploaded numbers` };

  // Unticked recipients are forgotten when the list itself changes.
  const audienceKey = JSON.stringify(audience);
  useEffect(() => setExcluded([]), [audienceKey]);

  const scheduledFor = later && date ? isoAt(date, time) : undefined;
  const ready =
    (source === "template" ? Boolean(template) : Boolean(body.trim())) &&
    !(kind === "CLASS" && sections.length === 0) &&
    !(kind === "NUMBERS" && validNumbers === 0) &&
    !(kind === "STAFF" && staff.data && staffPicked.length === 0) &&
    !(needsExamPick && canSeeExams && !examId) &&
    !(needsPeriod && !period);
  const request: SmsAudienceRequest | null =
    ctx.campus === "ALL" || !ready
      ? null
      : {
          campus: ctx.campus as CampusCode,
          session: ctx.session,
          templateId: source === "template" ? templateId : "custom",
          language,
          audience,
          channel: smsOnly ? "SMS" : channel,
          ...(source === "custom" ? { customText: { en, ur, category: kind === "STAFF" ? ("STAFF" as const) : ("GENERAL" as const) } } : {}),
          ...(usesApp && effectiveTitle ? { title: effectiveTitle } : {}),
          ...(scheduledFor ? { scheduledFor } : {}),
          values: { ...(eventDate ? { event_date: formatDate(eventDate) } : {}), ...(exam ? { exam_name: exam.name } : {}), ...(needsExamPick && examId ? { exam_id: examId } : {}) },
          ...(needsPeriod && period ? { period } : {}),
          ...(excluded.length ? { exclude: excluded } : {}),
          sampleSize: 25,
        };

  // Recalculate the preview shortly after the choices stop changing (the schedule time doesn't change who gets it).
  const previewKey = JSON.stringify(request ? { ...request, scheduledFor: undefined } : null);
  const [debounced, setDebounced] = useState<SmsAudienceRequest | null>(request);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(request ? ({ ...request, scheduledFor: undefined } as SmsAudienceRequest) : null), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);
  const preview = useQuery(smsQueries.preview(debounced));
  const p = preview.data;
  const stale = previewKey !== JSON.stringify(debounced);

  const paused = Boolean(status.data?.paused);
  const smsGoing = (p?.smsRecipients ?? p?.sendable ?? 0) > 0;
  const blocked = readOnly || !canSend || (paused && smsGoing);

  const formValues = {
    source,
    templateId,
    language,
    en,
    ur,
    kind,
    sections,
    validNumbers,
    needsEventDate,
    eventDate,
    needsExamPick: needsExamPick && canSeeExams,
    examId,
    needsPeriod,
    periodFrom: period?.from ?? null,
    periodTo: period?.to ?? null,
    staffChosen: staff.data ? staffPicked.length : 1,
    regFrom,
    regTo,
    usesApp,
    title: effectiveTitle,
    later,
    date,
    time,
    today,
    sessionEnd,
  };
  const check = (): boolean => {
    const r = composeSchema.safeParse(formValues);
    const next: Errors = {};
    if (!r.success) for (const issue of r.error.issues) next[String(issue.path[0])] ??= issue.message;
    if (later && date && !isLaterThanNow(isoAt(date, time))) next.time ??= "Choose a time later than now.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };
  useEffect(() => {
    if (tried) check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(formValues), tried]);

  const send = useMutation({
    mutationFn: () => smsApi.send(request!, key),
    onSuccess: async (res) => {
      setConfirmOpen(false);
      setKey(newIdempotencyKey());
      await queryClient.invalidateQueries({ queryKey: ["sms"] });
      if (request?.audience.kind === "EXAM" || request?.values?.exam_id) void queryClient.invalidateQueries({ queryKey: ["exams"] });
      const what = source === "template" ? (template?.name ?? "Message") : effectiveTitle || "Your message";
      if (res.status === "AWAITING_APPROVAL") toast({ tone: "info", title: `Sent for approval · ${formatCount(res.queued)} recipients`, message: `${what} waits for the principal's approval in the Outbox. Nothing is sent from this system.` });
      else if (res.status === "SCHEDULED") toast({ title: `Scheduled · ${whenText(res.scheduledFor!)}`, message: `${what} to ${formatCount(res.queued)} recipients. Change or cancel it in the Outbox until then.` });
      else toast({ title: `Held in the outbox · ${formatCount(res.queued)} recipients`, message: `${what}: ${formatCount(res.appQueued ?? 0)} by app, ${formatCount(res.queued - (res.appQueued ?? 0))} by SMS · about ${formatRs(res.estCost ?? 0)}. Nothing is sent from this system.` });
      void navigate({ to: "/sms/outbox", search: { batch: res.batchId } as never });
    },
  });
  const sendError = send.error instanceof ApiError ? (send.error.isNetwork ? "Not sent — no reply from the server. It's safe to try again; nothing will be sent twice." : send.error.message) : send.error ? errorText(send.error) : null;

  if (!canSend) return <EmptyState icon="lock" title="Your role can view messages but not send them" description="Ask your campus admin if you need to send messages to families or staff." />;

  const classList = classes.data ?? [];
  const showResult = Boolean(p?.sample.some((r) => r.result));
  const sessionOptions = (sessions.data ?? []).filter((s) => s.status !== "PLANNED" && s.startYear <= ctx.session).map((s) => ({ value: String(s.startYear), label: s.label }));

  const columns: Array<Column<SmsRecipientPreview>> = [
    {
      key: "who",
      header: kind === "STAFF" ? "Staff" : kind === "NUMBERS" ? "Number" : kind === "CANDIDATES" ? "Candidate" : "Student",
      render: (r) => (
        <span className={r.unticked ? "grid opacity-60" : "grid"}>
          <span className="mtb-cell-primary">{kind === "NUMBERS" ? <span className="mtb-mono">{r.mobile}</span> : r.studentName}</span>
          {kind !== "NUMBERS" && <span className="mtb-cell-secondary">{r.classSection}</span>}
        </span>
      ),
    },
    ...(kind !== "NUMBERS" ? [{ key: "mobile", header: kind === "STAFF" ? "Mobile" : "Guardian", render: (r: SmsRecipientPreview) => <span className="grid"><span className="mtb-mono">{r.mobile}</span>{kind !== "STAFF" && <span className="mtb-cell-secondary">{r.guardian}</span>}</span> }] : []),
    ...(kind === "DEFAULTERS" ? [{ key: "due", header: "Overdue", align: "right" as const, render: (r: SmsRecipientPreview) => <span className="grid justify-items-end"><span className="mtb-num">{formatRs(r.amountDue)}</span><span className="mtb-cell-secondary">{r.daysOverdue} days</span></span> }] : []),
    ...(showResult ? [{ key: "result", header: needsPeriod ? "Tests" : "Marks", render: (r: SmsRecipientPreview) => <span className="mtb-num text-small">{r.result ?? "—"}</span> }] : []),
    { key: "via", header: "Gets it by", width: 110, render: (r) => (r.unticked ? <StatusBadge status="neutral" dot={false}>Not sent</StatusBadge> : r.channel === "APP" ? <StatusBadge status="info" dot={false}>App · free</StatusBadge> : <StatusBadge status="neutral" dot={false}>{`SMS · ${r.parts}`}</StatusBadge>) },
  ];
  const ticked = new Set<unknown>((p?.sample ?? []).filter((r) => !r.unticked).map((r) => r.key ?? r.mobile));
  const onTicked = (next: Set<unknown>) => {
    const shown = (p?.sample ?? []).map((r) => r.key ?? r.mobile);
    const off = shown.filter((k) => !next.has(k));
    setExcluded((prev) => [...new Set([...prev.filter((k) => !shown.includes(k)), ...off])]);
  };

  const submit = () => {
    setTried(true);
    if (!check() || !p || stale) return;
    setKey(newIdempotencyKey());
    send.reset();
    setConfirmOpen(true);
  };

  const toText = (): string => {
    switch (kind) {
      case "CLASS":
        return `${sections.length} sections${gender ? (gender === "F" ? ", girls" : ", boys") : ""}`;
      case "DEFAULTERS":
        return `Defaulters: over ${minDays} days and ${formatRs(minAmount ?? 0)}${defaulterSections.length ? `, ${defaulterSections.length} sections` : ""}`;
      case "ALL_PARENTS":
        return `All parents${gender ? (gender === "F" ? " of girls" : " of boys") : ""}`;
      case "STAFF":
        return `${staffGroup === "ALL" ? "All staff" : staffGroup === "TEACHING" ? "Teaching staff" : "Non-teaching staff"}${departments.length ? `, ${departments.join(", ")}` : ""}${staffGender ? (staffGender === "F" ? ", women" : ", men") : ""}${staff.data ? ` (${formatCount(staffPicked.length)} ticked)` : ""}`;
      case "CANDIDATES":
        return `Admission candidates${classApplied ? `, class ${classApplied}` : ""}${testFee ? (testFee === "PAID" ? ", test fee paid" : ", test fee not paid") : ""}${testDate ? `, test on ${formatDate(testDate)}` : ""}`;
      case "LEFT":
        return `${SMS_LEFT_STATUS_LABEL[leftStatus]} in ${formatSession(leftSession)}${sections.length ? `, ${sections.length} sections` : ""}${gender ? (gender === "F" ? ", girls" : ", boys") : ""}`;
      case "NUMBERS":
        return `${formatCount(validNumbers)} numbers`;
    }
  };

  const chipsFor: readonly SmsVariable[] =
    kind === "STAFF"
      ? ["guardian_name", "campus", "event_date"]
      : kind === "NUMBERS"
        ? ["campus", "event_date"]
        : kind === "CANDIDATES"
          ? ["student_name", "class", "campus", "event_date", "result"]
          : kind === "LEFT"
            ? ["student_name", "class", "guardian_name", "campus", "event_date"]
            : ["student_name", "class", "guardian_name", "campus", "event_date", "exam_name", "result", "subject_marks", "tests_summary"];

  const primaryLabel = !p ? "Send" : p.needsApproval ? `Send for approval · ${formatCount(p.sendable)}` : later && date ? `Schedule · ${formatCount(p.sendable)} recipients` : `Send now · ${formatCount(p.sendable)} recipients`;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="grid min-w-0 content-start gap-4">
        {/* 1. Message */}
        <Panel id="compose-message" rise={0} title="1. Message" description="Pick a ready-made template or write your own, in English or Urdu.">
          <div className="grid gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <Segmented
                aria-label="Message"
                value={source}
                onChange={(v) => setSource(v as "template" | "custom")}
                options={[
                  { value: "template", label: "Use a template" },
                  { value: "custom", label: "Write my own" },
                ]}
              />
              <Segmented
                aria-label="Language"
                value={language}
                onChange={(v) => setLanguage(v as SmsLanguage)}
                options={[
                  { value: "en", label: "English" },
                  { value: "ur", label: <span lang="ur">اردو</span> },
                ]}
              />
            </div>
            {source === "template" ? (
              <Select
                label="Template"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                options={[{ value: "", label: "Choose…" }, ...active.map((t) => ({ value: t.id, label: `${SMS_CATEGORY_LABEL[t.category]} · ${t.name}` }))]}
                {...(template ? { help: SMS_OPTIONAL_CATEGORIES.includes(template.category) ? "Families who opted out of notices are skipped." : "About the family's own child: sent even to families who opted out of notices." } : {})}
                {...(errors.templateId ? { error: errors.templateId } : {})}
              />
            ) : (
              <div className="grid gap-3">
                <VariableChips label="Insert a variable" onInsert={(token) => (language === "ur" ? insertAtCursor(urRef, ur, token, setUr) : insertAtCursor(enRef, en, token, setEn))} only={chipsFor} />
                {language === "en" ? (
                  <Textarea ref={enRef} label="Message (English)" rows={4} value={en} onChange={(e) => setEn(e.target.value)} placeholder="Dear Parent, …" {...(errors.en ? { error: errors.en } : {})} />
                ) : (
                  <Textarea ref={urRef} label="Message (Urdu)" urdu rows={3} value={ur} onChange={(e) => setUr(e.target.value)} placeholder="محترم والدین، …" {...(errors.ur ? { error: errors.ur } : {})} />
                )}
                <p className="m-0 text-small text-ink-muted">Messages written here count as notices: families who opted out of notices are skipped.</p>
              </div>
            )}
            {body && (
              <>
                <SmsCount text={renderPreview(body, language)} language={language} />
                {language === "en" && <NonGsmWarning text={renderPreview(body, "en")} {...(source === "custom" ? { onFix: () => setEn(toStandardCharacters(en)) } : {})} />}
              </>
            )}
            {(needsEventDate || needsExamPick) && (
              <div className="grid gap-3 sm:grid-cols-2">
                {needsEventDate && <DatePicker label="Date in the message" value={eventDate} onValueChange={setEventDate} today={today} {...(errors.eventDate ? { error: errors.eventDate } : {})} />}
                {needsExamPick &&
                  (!canSeeExams ? (
                    <p className="m-0 self-end text-small text-ink-muted">Marks come from each student's latest declared result this session.</p>
                  ) : exams.isPending ? (
                    <Skeleton height={64} />
                  ) : (
                    <Select
                      label="Exam (declared results)"
                      value={examId}
                      onChange={(e) => setExamId(e.target.value)}
                      options={declared.length ? declared.map((e) => ({ value: e.id, label: `${e.name} · ${e.classes.join(", ")}` })) : [{ value: "", label: "No declared exams this session" }]}
                      help={exams.isError ? "Exams couldn't be loaded. Try again in a moment." : "Each family gets their own child's marks, grade and position."}
                      {...(errors.examId ? { error: errors.examId } : {})}
                    />
                  ))}
              </div>
            )}
            {needsExamPick && exam && kind === "CLASS" && !exam.classes.every((cs) => sections.includes(cs)) && (
              <div>
                <Button size="sm" icon="students" onClick={() => setSections(exam.classes)}>
                  Send to the classes that sat it ({exam.classes.join(", ")})
                </Button>
              </div>
            )}
            {needsPeriod && (
              <div className="grid gap-3">
                <Segmented
                  aria-label="Which tests"
                  value={periodMode}
                  onChange={(v) => setPeriodMode(v as "month" | "week" | "dates")}
                  options={[
                    { value: "month", label: "A month" },
                    { value: "week", label: "This week" },
                    { value: "dates", label: "Dates" },
                  ]}
                />
                {periodMode === "month" && (
                  <div className="max-w-xs">
                    <Select label="Tests in" value={month} onChange={(e) => setMonth(e.target.value)} options={months.map((m) => ({ value: m, label: monthLabel(m) }))} help="Every class test declared that month is added up." />
                  </div>
                )}
                {periodMode === "week" && <p className="m-0 text-small text-ink-muted">Tests from Monday {formatDate(mondayOf(today))} to today.</p>}
                {periodMode === "dates" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <DatePicker label="From" value={from} onValueChange={setFrom} today={today} maxDate={today} />
                    <DatePicker label="To" value={to} onValueChange={setTo} today={today} maxDate={today} {...(errors.periodTo ? { error: errors.periodTo } : {})} />
                  </div>
                )}
              </div>
            )}
          </div>
        </Panel>

        {/* 2. Recipients */}
        <Panel id="compose-to" rise={1} title="2. Who gets it" description="Classes, fee defaulters, all parents, staff, admission candidates, students who left, or numbers you type or upload.">
          <div className="grid gap-4">
            <Segmented
              aria-label="Send to"
              value={kind}
              onChange={(v) => chooseKind(v as Kind)}
              options={[
                { value: "CLASS", label: "Classes" },
                { value: "DEFAULTERS", label: "Fee defaulters" },
                { value: "ALL_PARENTS", label: "All parents" },
                { value: "STAFF", label: "Staff" },
                { value: "CANDIDATES", label: "Admission candidates" },
                { value: "LEFT", label: "Students who left" },
                { value: "NUMBERS", label: "Phone numbers" },
              ]}
            />
            {kind === "CANDIDATES" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Select label="Applying for" value={classApplied} onChange={(e) => setClassApplied(e.target.value)} options={[{ value: "", label: "Every class" }, ...classList.map((c) => ({ value: c.short, label: c.name }))]} help="Applications in Admissions this session, not yet admitted." />
                <Select
                  label="Test fee"
                  value={testFee}
                  onChange={(e) => setTestFee(e.target.value as "" | "PAID" | "UNPAID")}
                  options={[
                    { value: "", label: "Any" },
                    { value: "PAID", label: "Paid (registered)" },
                    { value: "UNPAID", label: "Not paid" },
                  ]}
                />
                <DatePicker label="Applied from" value={regFrom} onValueChange={setRegFrom} today={today} maxDate={today} />
                <DatePicker label="Applied to" value={regTo} onValueChange={setRegTo} today={today} maxDate={today} {...(errors.regTo ? { error: errors.regTo } : {})} />
                <DatePicker label="Entry test on" value={testDate} onValueChange={setTestDate} today={today} help="Leave empty for every test date." />
              </div>
            )}
            {kind === "CLASS" && <ClassPicker classes={classList} loading={classes.isPending} value={sections} onChange={setSections} label="Classes and sections" help="Click a class to choose all its sections." {...(errors.sections ? { error: errors.sections } : {})} />}
            {kind === "LEFT" && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select label="How they left" value={leftStatus} onChange={(e) => chooseLeftStatus(e.target.value as SmsLeftStatus)} options={(Object.keys(SMS_LEFT_STATUS_LABEL) as SmsLeftStatus[]).map((k) => ({ value: k, label: SMS_LEFT_STATUS_LABEL[k] }))} />
                  <Select label="Session they left in" value={String(leftSession)} onChange={(e) => setLeftSession(Number(e.target.value))} options={sessionOptions.length ? sessionOptions : [{ value: String(ctx.session), label: formatSession(ctx.session) }]} />
                </div>
                <ClassPicker classes={classList} loading={classes.isPending} value={sections} onChange={setSections} label="Classes and sections they were in" help="Leave empty for every class." />
              </>
            )}
            {kind === "DEFAULTERS" && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input label="Overdue more than" suffix="days" inputMode="numeric" value={minDays} onChange={(e) => setMinDays(e.target.value.replace(/\D/g, ""))} />
                  <AmountInput label="Amount above" value={minAmount} onValueChange={setMinAmount} />
                </div>
                <ClassPicker classes={classList} loading={classes.isPending} value={defaulterSections} onChange={setDefaulterSections} label="Only these classes" help="Leave empty for every class. For fee heads and months, send from Fees → Defaulters." />
              </>
            )}
            {(kind === "CLASS" || kind === "ALL_PARENTS" || kind === "LEFT") && (
              <div className="max-w-xs">
                <Select label="Boys or girls" value={gender} onChange={(e) => setGender(e.target.value as "" | "F" | "M")} options={[{ value: "", label: "Everyone" }, { value: "F", label: "Parents of girls" }, { value: "M", label: "Parents of boys" }]} />
              </div>
            )}
            {kind === "STAFF" && (
              <div className="grid gap-4">
                <Segmented
                  aria-label="Staff"
                  value={staffGroup}
                  onChange={(v) => {
                    setStaffGroup(v as SmsStaffGroup);
                    setDepartments([]);
                  }}
                  options={[
                    { value: "ALL", label: "All staff" },
                    { value: "TEACHING", label: "Teaching" },
                    { value: "NON_TEACHING", label: "Non-teaching" },
                  ]}
                />
                <Field label="Departments" help="Leave all off for every department.">
                  {() =>
                    staff.isPending ? (
                      <Skeleton height={36} />
                    ) : (
                      <div className="sms-chips">
                        {deptOptions.map((d) => (
                          <button key={d} type="button" className="sms-chip" aria-pressed={departments.includes(d)} onClick={() => setDepartments((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))}>
                            {d}
                          </button>
                        ))}
                      </div>
                    )
                  }
                </Field>
                <div className="max-w-xs">
                  <Select label="Men or women" value={staffGender} onChange={(e) => setStaffGender(e.target.value as "" | "F" | "M")} options={[{ value: "", label: "Everyone" }, { value: "F", label: "Women" }, { value: "M", label: "Men" }]} />
                </div>
                {staff.isError ? (
                  <Banner tone="warning">{errorText(staff.error)}</Banner>
                ) : (
                  <Field label={`Choose people · ${formatCount(staffPicked.length)} of ${formatCount(staffShown.length)} ticked`} {...(errors.staff ? { error: errors.staff } : {})}>
                    {() => (
                      <DataTable
                        caption="Staff who get the message"
                        columns={[
                          { key: "name", header: "Name", render: (s) => <span className="grid"><span className="mtb-cell-primary">{s.name}</span><span className="mtb-cell-secondary">{s.designation}</span></span> },
                          { key: "dept", header: "Department", render: (s) => s.department },
                          { key: "mobile", header: "Mobile", render: (s) => <span className="mtb-mono">{s.mobile}</span> },
                        ]}
                        rows={staffShown}
                        rowKey="id"
                        loading={staff.isPending}
                        density="dense"
                        maxHeight={280}
                        selectable
                        selected={new Set(staffPicked.map((s) => s.id))}
                        onSelectedChange={(next) => setStaffOff(new Set(staffShown.filter((s) => !next.has(s.id)).map((s) => s.id)))}
                        empty={<EmptyState icon="hr" title="Nobody matches" description="Change the group, department or men/women choice." />}
                      />
                    )}
                  </Field>
                )}
              </div>
            )}
            {kind === "NUMBERS" && (
              <div className="grid gap-3">
                <Textarea
                  label="Mobile numbers"
                  rows={4}
                  value={numbersText}
                  onChange={(e) => setNumbersText(e.target.value)}
                  placeholder={"0300-1234567\n0321-7654321"}
                  help={numbers.length ? `${formatCount(validNumbers)} valid${numbers.length - validNumbers ? `, ${numbers.length - validNumbers} not a mobile number (skipped)` : ""}. One per line, or separated by commas.` : "One per line, or separated by commas."}
                  {...(errors.numbers ? { error: errors.numbers } : {})}
                />
                <label className="inline-flex w-fit cursor-pointer items-center gap-2 text-small font-medium text-brand-ink">
                  <Icon name="upload" size={16} />
                  Upload a list (CSV, or an Excel sheet saved as CSV)
                  <input
                    type="file"
                    accept=".csv,.txt"
                    className="sr-only"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const text = await file.text();
                      const found = text.match(/(?:\+?92|0)?3\d{2}[- ]?\d{7}/g) ?? [];
                      setNumbersText((prev) => [prev.trim(), ...found].filter(Boolean).join("\n"));
                      toast({ title: `${formatCount(found.length)} numbers added from ${file.name}`, message: "Check the list, then send." });
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            )}
          </div>
        </Panel>

        {/* 3. How and when */}
        <Panel id="compose-how" rise={2} title="3. How and when" description="App notifications are free; SMS costs per part. Send now or schedule it.">
          <div className="grid gap-4">
            <fieldset className="m-0 grid gap-2 border-0 p-0">
              <legend className="mtb-label mb-1.5">Send as</legend>
              <div className="sms-options">
                {(["APP_FIRST", "SMS", "APP"] as SmsChannel[]).map((c) => (
                  <label key={c} className="sms-option" aria-disabled={smsOnly && c !== "SMS"}>
                    <input type="radio" name="channel" value={c} checked={(smsOnly ? "SMS" : channel) === c} disabled={smsOnly && c !== "SMS"} onChange={() => setChannel(c)} />
                    <span>
                      <b>{SMS_CHANNEL_LABEL[c]}</b>
                      <span className="sms-option-note">
                        {c === "APP_FIRST" ? "Families with the MTB app get a free notification; everyone else gets an SMS. Cheapest way to reach everyone." : c === "SMS" ? "Everyone gets an SMS, whether or not they have the app." : "Only families with the app are reached. Free."}
                      </span>
                    </span>
                    {c === "APP_FIRST" && <StatusBadge status="success" dot={false}>Recommended</StatusBadge>}
                  </label>
                ))}
              </div>
              {smsOnly && <p className="m-0 text-small text-ink-muted">{kind === "NUMBERS" ? "Typed numbers aren't linked to the app" : "Candidates' families don't have the app until admission"}, so they get an SMS.</p>}
            </fieldset>
            {usesApp && <Input label="App notification title" value={effectiveTitle} onChange={(e) => setTitle(e.target.value)} maxLength={70} help="Shown in bold on the phone, e.g. “School closed on Monday”." {...(errors.title ? { error: errors.title } : {})} />}
            <div className="grid gap-3">
              <Segmented
                aria-label="When"
                value={later ? "later" : "now"}
                onChange={(v) => setLater(v === "later")}
                options={[
                  { value: "now", label: "Send now" },
                  { value: "later", label: "Schedule" },
                ]}
              />
              {later && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <DatePicker label="Day" value={date} onValueChange={setDate} today={today} minDate={today} maxDate={sessionEnd} {...(errors.date ? { error: errors.date } : {})} />
                  <Select label="Time" value={time} onChange={(e) => setTime(e.target.value)} options={TIME_SLOTS} help="SMS go out between 7:00 AM and 9:00 PM only." {...(errors.time ? { error: errors.time } : {})} />
                </div>
              )}
            </div>
          </div>
        </Panel>
      </div>

      {/* Before you send */}
      <div className="sms-sticky grid min-w-0 content-start gap-4">
        <Panel
          id="compose-preview"
          rise={3}
          title="Before you send"
          description={p ? (stale || preview.isFetching ? "Updating…" : "Who gets it, how, and what it costs. Untick anyone who shouldn't get it.") : "Choose a message and who gets it."}
        >
          <div className="grid gap-4" aria-busy={preview.isFetching || undefined}>
            {paused && smsGoing && (
              <Banner tone="danger" title="SMS is paused.">
                Nothing goes by SMS until an admin resumes it{status.data?.reason ? ` (reason: ${status.data.reason})` : ""}. Choose “App notification only” to send now.
              </Banner>
            )}
            {preview.error && <Banner tone="warning">{errorText(preview.error)}</Banner>}
            {!request ? (
              <EmptyState
                icon="send"
                title="Nothing to preview yet"
                description={
                  kind === "CLASS" && sections.length === 0
                    ? "Choose at least one class."
                    : kind === "NUMBERS"
                      ? "Add at least one mobile number."
                      : kind === "STAFF" && staff.data && staffPicked.length === 0
                        ? "Tick at least one person."
                        : needsExamPick && !examId
                          ? "Choose a declared exam."
                          : needsPeriod && !period
                            ? "Choose the dates of the tests."
                            : "Write or choose the message."
                }
              />
            ) : !p ? (
              <div className="grid gap-3">
                <div className="sms-figures">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} height={64} />
                  ))}
                </div>
                <Skeleton height={200} />
              </div>
            ) : (
              <>
                <div className="sms-figures">
                  <Figure label="Will receive it" value={formatCount(p.sendable)} {...(p.recipients !== p.sendable ? { note: `of ${formatCount(p.recipients)} in the list` } : {})} />
                  <Figure label="Estimated cost" value={formatRs(p.estCost ?? 0)} note={`${formatCount(p.segments)} SMS parts at Rs ${p.ratePer100 ?? 55} per 100`} />
                  <Figure label="By app (free)" value={formatCount(p.appRecipients ?? 0)} {...(p.costIfAllSms && p.costIfAllSms > (p.estCost ?? 0) ? { note: `saves ${formatRs(p.costIfAllSms - (p.estCost ?? 0))}`, good: true } : {})} />
                  <Figure label="By SMS" value={formatCount(p.smsRecipients ?? p.sendable)} note={language === "ur" ? "Urdu: 70 characters per SMS" : "English: 160 characters per SMS"} />
                </div>
                {(p.excludedOptOut > 0 || p.excludedNothingDue > 0 || (p.excludedNoMobile ?? 0) > 0 || (p.duplicates ?? 0) > 0 || (p.excludedNoApp ?? 0) > 0 || p.optedOutIncluded > 0 || (p.invalidNumbers?.length ?? 0) > 0 || (p.excludedNoResult ?? 0) > 0 || (p.excludedByYou ?? 0) > 0) && (
                  <ul className="m-0 grid list-none gap-1 p-0 text-small text-ink-muted">
                    {p.excludedOptOut > 0 && <li>· {formatCount(p.excludedOptOut)} opted out of notices — skipped</li>}
                    {p.optedOutIncluded > 0 && <li>· {formatCount(p.optedOutIncluded)} opted out of notices but still get this, because it is about their own child</li>}
                    {p.excludedNothingDue > 0 && <li>· {formatCount(p.excludedNothingDue)} with nothing due — skipped</li>}
                    {(p.excludedNoMobile ?? 0) > 0 && <li>· {formatCount(p.excludedNoMobile ?? 0)} have no valid mobile number — skipped</li>}
                    {(p.excludedNoResult ?? 0) > 0 && <li>· {formatCount(p.excludedNoResult ?? 0)} have no result to send (not in the exam, result withheld, or no tests in these dates) — skipped</li>}
                    {(p.duplicates ?? 0) > 0 && <li>· {formatCount(p.duplicates ?? 0)} brothers and sisters share a phone — the family gets one message</li>}
                    {(p.excludedNoApp ?? 0) > 0 && <li>· {formatCount(p.excludedNoApp ?? 0)} don't have the app — not reached by an app-only message</li>}
                    {(p.excludedByYou ?? 0) > 0 && (
                      <li>
                        · {formatCount(p.excludedByYou ?? 0)} unticked by you — not sent{" "}
                        <Button size="sm" variant="ghost" onClick={() => setExcluded([])}>
                          Tick all again
                        </Button>
                      </li>
                    )}
                    {(p.invalidNumbers?.length ?? 0) > 0 && <li>· Not mobile numbers, skipped: {p.invalidNumbers!.slice(0, 5).join(", ")}</li>}
                  </ul>
                )}
                {p.needsApproval && (
                  <Banner tone="info" icon="checkSquare" title={`Needs the principal's approval.`}>
                    Messages to {formatCount(p.approvalThreshold ?? 1000)} or more people wait for approval before they go out. You'll see it in the Outbox.
                  </Banner>
                )}
                {p.sendable === 0 && p.sample.length === 0 ? (
                  <EmptyState
                    icon="students"
                    title="Nobody matches"
                    description={
                      kind === "DEFAULTERS"
                        ? "No student is overdue by that much. Lower the days or the amount."
                        : kind === "LEFT"
                          ? `No student was ${SMS_LEFT_STATUS_LABEL[leftStatus].toLowerCase()} in ${formatSession(leftSession)} in these classes.`
                          : needsPeriod
                            ? "No class test was declared in these dates. Choose another month or dates."
                            : "Nobody in this list can receive this message."
                    }
                  />
                ) : (
                  <>
                    <PhonePreview text={p.sample.find((r) => !r.unticked)?.message ?? renderPreview(body, language)} language={language} title={effectiveTitle || "MTB"} sender={sender} showApp={(p.appRecipients ?? 0) > 0} showSms={(p.smsRecipients ?? p.sendable) > 0} />
                    <DataTable caption="First recipients" columns={columns} rows={p.sample} rowKey="key" density="dense" stickyHeader={false} selectable selected={ticked} onSelectedChange={onTicked} />
                    {p.sendable + (p.excludedByYou ?? 0) > p.sample.length && <p className="m-0 text-small text-ink-muted">Showing the first {p.sample.length} of {formatCount(p.sendable + (p.excludedByYou ?? 0))}.</p>}
                  </>
                )}
              </>
            )}
            <Button variant="primary" icon={later ? "clock" : "send"} block disabled={blocked || !p || p.sendable === 0 || preview.isFetching || stale} onClick={submit}>
              {primaryLabel}
            </Button>
            {category && <p className="m-0 text-center text-small text-ink-muted">Kind: {SMS_CATEGORY_LABEL[category]} · campus sender {sender}</p>}
          </div>
        </Panel>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => send.mutate()}
        icon={later ? "clock" : "send"}
        title={p?.needsApproval ? "Send this message for approval?" : later && date ? `Schedule this message for ${whenText(isoAt(date, time))}?` : `Send this message to ${formatCount(p?.sendable ?? 0)} recipients now?`}
        message={p?.needsApproval ? "The principal approves it in the Outbox. The messages are held there; nothing is sent from this system." : later ? "You can change the time or cancel it in the Outbox. The messages are held there; nothing is sent from this system." : "The messages are held in the outbox; nothing is sent from this system."}
        details={[
          ["Message", source === "template" ? (template?.name ?? "—") : effectiveTitle || "Written for this send"],
          ["Language", language === "ur" ? "Urdu" : "English"],
          ["To", toText()],
          ...(needsExamPick && exam ? ([["Marks from", `${exam.name} · ${exam.classes.join(", ")}`]] as Array<[string, string]>) : []),
          ...(needsPeriod && period ? ([["Tests", `${formatDate(period.from)} to ${formatDate(period.to)}`]] as Array<[string, string]>) : []),
          ["Recipients", `${formatCount(p?.sendable ?? 0)} (${formatCount(p?.appRecipients ?? 0)} by app, ${formatCount(p?.smsRecipients ?? 0)} by SMS)`],
          ["Estimated cost", `${formatRs(p?.estCost ?? 0)} · ${formatCount(p?.segments ?? 0)} SMS parts`],
          ["When", later && date ? whenText(isoAt(date, time)) : "Now"],
        ]}
        confirmLabel={p?.needsApproval ? "Send for approval" : later ? "Schedule" : "Send now"}
        loading={send.isPending}
        loadingLabel={later ? "Scheduling…" : "Sending…"}
        error={sendError ?? undefined}
      />
    </div>
  );
}
