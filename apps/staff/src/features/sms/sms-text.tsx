import { SMS_GSM_REPLACEMENTS, SMS_VARIABLES, smsRender, smsSegments, type SmsLanguage, type SmsValues, type SmsVariable } from "@mtb/api";
import { Button, cx, Icon } from "@mtb/ui";
import type { ReactNode, RefObject } from "react";

/**
 * Neutral placeholders for the editor preview and the SMS-parts estimate (no invented child or family). Each has
 * about the length of a real value, so the parts count stays close; the real values come from the server's preview.
 */
export const PREVIEW_VALUES: Record<SmsLanguage, SmsValues> = {
  en: { student_name: "Student name", class: "7-B", amount_due: "2,500", due_date: "DD-MMM-YYYY", campus: "Campus name", guardian_name: "Guardian name", exam_name: "Exam name", result: "Marks and grade", event_date: "DD-MMM-YYYY", tests_summary: "Tests total and %", subject_marks: "Marks by subject" },
  ur: { student_name: "طالب علم کا نام", class: "7-B", amount_due: "2,500", due_date: "DD-MMM-YYYY", campus: "Campus name", guardian_name: "سرپرست کا نام", exam_name: "Exam name", result: "Marks and grade", event_date: "DD-MMM-YYYY", tests_summary: "Tests total and %", subject_marks: "Marks by subject" },
};

export const VARIABLE_LABEL: Record<SmsVariable, string> = {
  student_name: "Student name",
  class: "Class",
  amount_due: "Amount due",
  due_date: "Due date",
  campus: "Campus",
  guardian_name: "Guardian or staff name",
  exam_name: "Exam name",
  result: "Marks and grade",
  event_date: "Date in the message",
  tests_summary: "Tests in the dates: total and %",
  subject_marks: "Marks subject by subject",
};

/**
 * Inside Urdu, runs of Western text (7-B, 8,500, 10-Nov-2026, MTB Khalid Campus) are wrapped in
 * <bdi dir="ltr"> so the bidi algorithm doesn't flip them into "B-7" or "Nov-2026-10".
 */
const LATIN_RUN = /([A-Za-z0-9][A-Za-z0-9,.:/()%–-]*(?:[ ][A-Za-z0-9][A-Za-z0-9,.:/()%–-]*)*)/;

export function UrduWithLtrRuns({ text }: { text: string }) {
  const parts = text.split(LATIN_RUN);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <bdi key={i} dir="ltr">
            {p}
          </bdi>
        ) : (
          p
        ),
      )}
    </>
  );
}

/** The message as the guardian's phone shows it. */
export function SmsBubble({ text, language, className }: { text: string; language: SmsLanguage; className?: string }) {
  return (
    <div className={cx("rounded-lg border border-border bg-surface-sunken px-4 py-3", className)}>
      {language === "ur" ? (
        <p lang="ur" dir="rtl" className="urdu-body m-0 whitespace-pre-wrap text-ink">
          <UrduWithLtrRuns text={text} />
        </p>
      ) : (
        <p className="m-0 whitespace-pre-wrap text-ink">{text}</p>
      )}
    </div>
  );
}

/** A phone with the SMS (and the app notification when the channel uses the app). */
export function PhonePreview({ text, language, title, sender, showApp, showSms }: { text: string; language: SmsLanguage; title: string; sender: string; showApp: boolean; showSms: boolean }) {
  return (
    <div className="sms-phone" aria-label="Preview on a parent's phone">
      {showApp && (
        <>
          <div className="sms-phone-head">
            <Icon name="smartphone" size={14} /> MTB app · now
          </div>
          <div className="sms-push mb-4">
            <span className="sms-push-icon" aria-hidden="true">
              MTB
            </span>
            <div className="min-w-0">
              <b>{title}</b>
              {language === "ur" ? (
                <p lang="ur" dir="rtl" className="urdu-small">
                  <UrduWithLtrRuns text={text} />
                </p>
              ) : (
                <p>{text.length > 140 ? `${text.slice(0, 137)}…` : text}</p>
              )}
            </div>
          </div>
        </>
      )}
      {showSms && (
        <>
          <div className="sms-phone-head">
            <Icon name="sms" size={14} /> SMS from <span className="font-mono text-ink">{sender}</span>
          </div>
          {language === "ur" ? (
            <p lang="ur" dir="rtl" className="sms-bubble urdu-body m-0">
              <UrduWithLtrRuns text={text} />
            </p>
          ) : (
            <p className="sms-bubble m-0">{text}</p>
          )}
        </>
      )}
    </div>
  );
}

/** "152 characters · 1 SMS · standard alphabet, 160 per SMS". */
export function SmsCount({ text, language }: { text: string; language: SmsLanguage }) {
  const s = smsSegments(text);
  const kind = s.encoding === "GSM-7" ? "standard alphabet" : language === "ur" ? "Urdu uses Unicode" : "Unicode";
  const limit = s.parts > 1 ? `${s.perPart} per part` : `${s.perSms} per SMS`;
  return (
    <p className="m-0 text-small text-ink-muted" aria-live="polite">
      <span className="mtb-num font-medium text-ink">{s.units}</span> characters · <span className="mtb-num font-medium text-ink">{s.parts} SMS</span> · {kind}, {limit}
    </p>
  );
}

/** Characters that silently make an English message Unicode (70 per SMS instead of 160). */
export function nonGsmIn(text: string): string[] {
  return smsSegments(text).nonGsm;
}

export function toStandardCharacters(text: string): string {
  return [...text].map((c) => SMS_GSM_REPLACEMENTS[c] ?? c).join("");
}

export function renderPreview(template: string, language: SmsLanguage, values: Partial<SmsValues> = {}): string {
  return smsRender(template, { ...PREVIEW_VALUES[language], ...values });
}

/** Inserts {variable} at the cursor of the given textarea (or at the end if it never had focus). */
export function insertAtCursor(ref: RefObject<HTMLTextAreaElement | null>, value: string, token: string, onChange: (next: string) => void) {
  const el = ref.current;
  const start = el?.selectionStart ?? value.length;
  const end = el?.selectionEnd ?? value.length;
  const next = value.slice(0, start) + token + value.slice(end);
  onChange(next);
  const caret = start + token.length;
  requestAnimationFrame(() => {
    if (!el) return;
    el.focus();
    el.setSelectionRange(caret, caret);
  });
}

export function VariableChips({ onInsert, label, only }: { onInsert: (token: string) => void; label: string; only?: readonly SmsVariable[] }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {(only ?? SMS_VARIABLES).map((v) => (
        <button
          key={v}
          type="button"
          // Keep focus (and the caret) in the textarea when clicked with a mouse.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onInsert(`{${v}}`)}
          title={`Insert ${VARIABLE_LABEL[v].toLowerCase()}`}
          className="inline-flex h-7 items-center gap-1 rounded-full border border-border-strong bg-surface-raised px-2.5 font-mono text-[12px] text-ink hover:bg-surface-hover"
        >
          <Icon name="plus" size={12} />
          {`{${v}}`}
        </button>
      ))}
    </div>
  );
}

/** Warns when an English message contains characters outside the standard SMS alphabet, with a one-click fix. */
export function NonGsmWarning({ text, onFix }: { text: string; onFix?: () => void }): ReactNode {
  const bad = nonGsmIn(text);
  if (bad.length === 0) return null;
  const fixable = bad.every((c) => c in SMS_GSM_REPLACEMENTS);
  const shown = bad.map((c) => (c === " " ? "non-breaking space" : `“${c}”`)).join(", ");
  return (
    <div className="mtb-banner mtb-banner-warning" role="status">
      <Icon name="alert" />
      <div style={{ flex: 1 }}>
        <b>Sent as Unicode: 70 characters per SMS instead of 160.</b> {shown} {bad.length === 1 ? "isn't" : "aren't"} in the standard SMS alphabet, so this message costs about {Math.max(1, smsSegments(text).parts)} SMS per recipient.
      </div>
      {fixable && onFix && (
        <div className="mtb-banner-actions">
          <Button size="sm" variant="secondary" onClick={onFix}>
            Use standard characters
          </Button>
        </div>
      )}
    </div>
  );
}

/** Which variables a message uses (to ask for an event date or exam name at compose time). */
export const usesVariable = (text: string, v: SmsVariable) => text.includes(`{${v}}`);
