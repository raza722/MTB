import { formatDate, formatRs, type IsoDate } from "@mtb/domain";
import { AmountInput, Banner, Button, cx, DatePicker, Icon, Input, Radio, Select, StatusBadge, Tooltip, useToast } from "@mtb/ui";
import { useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import { z } from "zod";
import { OVERDUE_TOTAL, TODAY } from "../demo";
import { PhoneFrame, Specimen, stagger, StateGroupSection, wait } from "../kit";
import { ReceiptReviewDialog } from "../ReceiptReview";

/* ------------------------------------------------------------------ Wrong two-step code */

const CODE_LENGTH = 6;
const empty = () => Array<string>(CODE_LENGTH).fill("");

function TwoStepSpecimen() {
  const [digits, setDigits] = useState<string[]>(empty);
  const [attemptsLeft, setAttemptsLeft] = useState(2);
  const [checking, setChecking] = useState(false);
  const [shake, setShake] = useState(0);
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const locked = attemptsLeft <= 0;

  const verify = async () => {
    setChecking(true);
    await wait(700);
    setChecking(false);
    setAttemptsLeft((a) => a - 1);
    setDigits(empty());
    setShake((s) => s + 1);
    requestAnimationFrame(() => refs.current[0]?.focus());
  };

  const update = (next: string[]) => {
    setDigits(next);
    if (next.every((d) => d !== "")) void verify();
  };
  const setAt = (i: number, d: string) => {
    const next = [...digits];
    next[i] = d;
    if (d && i < CODE_LENGTH - 1) refs.current[i + 1]?.focus();
    update(next);
  };
  const onKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      e.preventDefault();
      const next = [...digits];
      next[i - 1] = "";
      setDigits(next);
      refs.current[i - 1]?.focus();
    }
    if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
    if (e.key === "ArrowRight" && i < CODE_LENGTH - 1) refs.current[i + 1]?.focus();
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const d = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, CODE_LENGTH).split("");
    if (!d.length) return;
    e.preventDefault();
    const next = empty().map((_, k) => d[k] ?? "");
    refs.current[Math.min(d.length, CODE_LENGTH - 1)]?.focus();
    update(next);
  };

  return (
    <div className="mx-auto grid w-full max-w-[380px] gap-4 rounded-lg border border-border bg-surface-raised p-6 shadow-sm">
      <div className="grid gap-1">
        <span className="text-title-2 text-ink">Two-step verification</span>
        <span className="text-small text-ink-muted">Enter the 6-digit code from your authenticator app.</span>
      </div>
      <span id="st-code-label" className="mtb-label">
        Verification code
      </span>
      <div key={shake} className={cx("mtb-states-code", shake > 0 && "mtb-states-shake")} role="group" aria-labelledby="st-code-label">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            value={d}
            disabled={locked || checking}
            inputMode="numeric"
            autoComplete="off"
            aria-label={`Digit ${i + 1} of ${CODE_LENGTH}`}
            aria-invalid={!locked || undefined}
            className={cx("mtb-input", !locked && "is-invalid")}
            onChange={(e) => setAt(i, e.target.value.replace(/\D/g, "").slice(-1))}
            onKeyDown={(e) => onKey(i, e)}
            onPaste={onPaste}
            onFocus={(e) => e.target.select()}
          />
        ))}
      </div>
      {locked ? (
        <Banner tone="danger" title="Account locked for 15 minutes.">
          Too many incorrect codes. Try again later, or ask your campus admin to unlock your account.
        </Banner>
      ) : (
        <div className="mtb-error" role="alert">
          Incorrect code. {attemptsLeft} {attemptsLeft === 1 ? "attempt" : "attempts"} left.
        </div>
      )}
      {locked ? (
        <Button size="lg" block onClick={() => setAttemptsLeft(2)} icon="refresh">
          Start this specimen again
        </Button>
      ) : (
        <Button variant="primary" size="lg" block loading={checking} loadingLabel="Checking…" disabled={digits.some((x) => !x)} onClick={() => void verify()}>
          Verify
        </Button>
      )}
      <Button variant="quiet" size="sm" icon="message" disabled={locked}>
        Use SMS code instead
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ Journal voucher out of balance */

const JV_ELECTRICITY = 186500;
const JV_BANK = 208000;
const JV_TYPED = 23000;
const JV_NO = "KC-JV-2627-000214";

function VoucherSpecimen() {
  const toast = useToast();
  const [gas, setGas] = useState<number | null>(JV_TYPED);
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState(false);
  const debit = JV_ELECTRICITY + (gas ?? 0);
  const credit = JV_BANK;
  const diff = debit - credit;
  const balanced = diff === 0;
  const reason = balanced ? null : `Post is off until debits equal credits. Out of balance by ${formatRs(Math.abs(diff))}.`;

  const post = async () => {
    setPosting(true);
    await wait(900);
    setPosting(false);
    setPosted(true);
    toast({ title: `Journal voucher ${JV_NO} posted`, message: `Khalid Campus · ${formatRs(debit)} · 3 lines` });
  };

  const row = (account: string, description: string, dr: ReactNode, cr: ReactNode, i: number) => (
    <tr className="mtb-slide-in" style={stagger(i)}>
      <td>
        <span className="mtb-mono text-ink-muted">{account.slice(0, 4)}</span> {account.slice(5)}
      </td>
      <td className="text-ink-muted">{description}</td>
      <td className="mtb-td-num">{dr}</td>
      <td className="mtb-td-num">{cr}</td>
    </tr>
  );

  return (
    <div className="mtb-card grid gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid">
          <span className="font-semibold text-ink">Journal voucher · {posted ? <span className="mtb-mono">{JV_NO}</span> : "number assigned on posting"}</span>
          <span className="text-small text-ink-muted">{formatDate(TODAY)} · Utility bills for October 2026 paid by Meezan Bank cheque 004512</span>
        </div>
        {posted ? <StatusBadge status="approved" icon="lock">Posted</StatusBadge> : <StatusBadge status="draft">Draft</StatusBadge>}
      </div>
      <div className="mtb-table-wrap">
        <div className="mtb-table-scroll">
          <table className="mtb-table">
            <caption className="mtb-sr-only">Voucher lines</caption>
            <thead>
              <tr>
                <th>Account</th>
                <th>Description</th>
                <th className="mtb-td-num">Debit</th>
                <th className="mtb-td-num">Credit</th>
              </tr>
            </thead>
            <tbody>
              {row("5201 Electricity", "Electricity bill, October 2026 (MEPCO)", formatRs(JV_ELECTRICITY), "", 0)}
              {row(
                "5202 Gas",
                "Gas bill, October 2026 (SNGPL)",
                posted ? (
                  formatRs(gas ?? 0)
                ) : (
                  <div className="ml-auto w-36">
                    <AmountInput aria-label="Debit, gas bill" value={gas} onValueChange={setGas} />
                  </div>
                ),
                "",
                1,
              )}
              {row("1102 Bank — Meezan Bank, Sadiqabad", "Cheque 004512", "", formatRs(JV_BANK), 2)}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} className="font-semibold">
                  Totals
                </td>
                <td className="mtb-td-num font-semibold">{formatRs(debit)}</td>
                <td className="mtb-td-num font-semibold">{formatRs(credit)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div aria-live="polite" className="min-w-0">
          {balanced ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-success-ink">
              <Icon name="checkCircle" size={18} /> Balanced
            </span>
          ) : (
            <span className="grid">
              <span className="inline-flex items-center gap-1.5 font-semibold text-danger-ink">
                <Icon name="alertCircle" size={18} /> Out of balance by <span className="mtb-num">{formatRs(Math.abs(diff))}</span>
              </span>
              <span className="text-small text-ink-muted">{diff > 0 ? "Debits are more than credits." : "Credits are more than debits."}</span>
            </span>
          )}
        </div>
        {posted ? (
          <Button
            size="sm"
            variant="ghost"
            icon="refresh"
            onClick={() => {
              setPosted(false);
              setGas(JV_TYPED);
            }}
          >
            Start this specimen again
          </Button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => toast({ title: "Draft saved", message: balanced ? "Debits equal credits; ready to post." : `Still out of balance by ${formatRs(Math.abs(diff))}.` })}>Save draft</Button>
            {reason ? (
              <Tooltip content={reason}>
                <span tabIndex={0} className="inline-flex rounded-md" aria-label={reason}>
                  <Button variant="primary" icon="check" disabled>
                    Post
                  </Button>
                </span>
              </Tooltip>
            ) : (
              <Button variant="primary" icon="check" loading={posting} loadingLabel="Posting…" onClick={() => void post()}>
                Post
              </Button>
            )}
          </div>
        )}
      </div>
      {!posted && !balanced && <p className="m-0 text-small text-ink-muted">The gas bill was Rs 21,500 but was typed as Rs 23,000. Change it to 21,500 and Post switches on.</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ Marks above the maximum (teacher app keypad) */

const MAX = 75;
const MARK_STUDENTS = ["Ayesha Khan", "Muhammad Bilal", "Areeba Siddiqui"];

function checkMark(buffer: string): string | null {
  if (buffer === "" || buffer === "A") return null;
  const n = Number(buffer.endsWith(".") ? buffer.slice(0, -1) : buffer);
  if (Number.isNaN(n)) return "Type a number, or tap Absent.";
  if (n > MAX) return `Maximum is ${MAX}`;
  if (Math.round(n * 2) !== n * 2) return "Use whole or half marks, for example 12.5.";
  return null;
}

function typeKey(buffer: string, key: string): string {
  const base = buffer === "A" ? "" : buffer;
  if (key === "back") return base.slice(0, -1);
  if (key === ".") return base.includes(".") ? base : `${base || "0"}.`;
  if (base === "0") return key;
  if (base.includes(".") && (base.split(".")[1] ?? "").length >= 1) return base;
  return base.length >= 5 ? base : base + key;
}

function MarksSpecimen() {
  const [at, setAt] = useState(0);
  const [buffer, setBuffer] = useState("82");
  const [entered, setEntered] = useState<Record<string, string>>({});
  const error = checkMark(buffer);
  const done = at >= MARK_STUDENTS.length;
  const count = 18 + Object.keys(entered).length;
  const who = MARK_STUDENTS[at] ?? "";

  const next = () => {
    if (error || buffer === "") return;
    setEntered((e) => ({ ...e, [who]: buffer }));
    setAt((a) => a + 1);
    setBuffer("");
  };
  const reset = () => {
    setAt(0);
    setBuffer("82");
    setEntered({});
  };
  const key = (k: string) => setBuffer((b) => typeKey(b, k));
  const digit = "h-11 rounded-md bg-surface-sunken text-title-2 font-medium text-ink tabular-nums hover:bg-surface-hover active:bg-surface-selected";

  return (
    <PhoneFrame label="Teacher app, marks entry" title="Mathematics · 7-B" subtitle={<>First Term · Max marks {MAX}</>}>
      <ul className="m-0 grid list-none gap-1.5 p-0" aria-label="Students">
        {MARK_STUDENTS.map((name, i) => (
          <li key={name} className={cx("mtb-card flex items-center justify-between gap-2 px-3 py-2", i === at && "border-brand")}>
            <span className="truncate font-medium text-ink">{name}</span>
            <span className={cx("tabular-nums", entered[name] === "A" ? "text-status-absent-ink font-semibold" : "text-ink-muted")}>{entered[name] === "A" ? "Absent" : (entered[name] ?? (i === at ? "Typing…" : "—"))}</span>
          </li>
        ))}
      </ul>
      {done ? (
        <div className="grid gap-2">
          <Banner tone="success" title="All three entered.">
            Absent is kept apart from 0, so a missed paper never counts as a fail.
          </Banner>
          <Button size="touch" icon="refresh" onClick={reset}>
            Start this specimen again
          </Button>
        </div>
      ) : (
        <div className="grid gap-2" role="group" aria-label={`Number pad for ${who}`}>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="m-0 truncate font-medium text-ink">{who}</p>
              <p className="m-0 text-small text-ink-muted tabular-nums">
                {count} of 34 entered · Max {MAX}
              </p>
            </div>
            <output className={cx("grid h-11 min-w-20 place-items-center rounded-md border-2 bg-surface-raised px-3 text-title-1 tabular-nums", error ? "border-danger text-danger-ink" : "border-brand text-ink")} aria-live="polite" aria-label={`Mark for ${who}`}>
              {buffer === "A" ? "Absent" : buffer || <span className="text-ink-subtle">—</span>}
            </output>
          </div>
          <p role="alert" className={cx("m-0 flex min-h-5 items-center gap-1.5 text-small font-medium text-danger-ink", !error && "invisible")}>
            <Icon name="alertCircle" size={16} />
            {error ?? "No problem"}
          </p>
          <div className="grid grid-cols-4 gap-1.5">
            {["1", "2", "3", "back", "4", "5", "6", "A", "7", "8", "9", ".", "0"].map((k) => (
              <button
                key={k}
                type="button"
                className={cx(digit, k === "A" && "bg-status-absent-tint text-small font-semibold text-status-absent-ink hover:bg-status-absent-tint", k === "back" && "text-ink-muted")}
                aria-label={k === "back" ? "Delete" : k === "." ? "Decimal point" : k === "A" ? "Absent" : undefined}
                onClick={() => (k === "A" ? setBuffer("A") : key(k))}
              >
                {k === "back" ? "⌫" : k === "A" ? "Absent" : k}
              </button>
            ))}
            <Button variant="primary" size="touch" className="col-span-3 h-11" iconRight="arrowRight" disabled={Boolean(error) || buffer === ""} onClick={next}>
              Next
            </Button>
          </div>
        </div>
      )}
    </PhoneFrame>
  );
}

/* ------------------------------------------------------------------ Missing cheque number */

const BANKS = ["Meezan Bank", "HBL", "UBL", "Allied Bank", "Bank Alfalah", "MCB Bank", "National Bank of Pakistan"];
const METHODS = ["Cash", "Bank deposit", "Cheque", "Online transfer / Raast"] as const;

const chequeSchema = z.object({
  chequeNo: z.string().trim().min(1, "Enter the cheque number printed on the cheque."),
  bank: z.string().min(1, "Choose the bank."),
  chequeDate: z.string().nullable().refine((v) => Boolean(v), "Enter the cheque date."),
});
type ChequeField = keyof z.infer<typeof chequeSchema>;

function ChequeSpecimen() {
  const [method, setMethod] = useState<(typeof METHODS)[number]>("Cheque");
  const [chequeNo, setChequeNo] = useState("");
  const [bank, setBank] = useState("Meezan Bank");
  const [chequeDate, setChequeDate] = useState<IsoDate | null>(TODAY);
  const [showErrors, setShowErrors] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const chequeRef = useRef<HTMLInputElement>(null);

  const parsed = chequeSchema.safeParse({ chequeNo, bank, chequeDate });
  const errors: Partial<Record<ChequeField, string>> = {};
  if (!parsed.success) for (const issue of parsed.error.issues) errors[issue.path[0] as ChequeField] ??= issue.message;
  const shown = showErrors ? errors : {};

  return (
    <aside className="mtb-card mx-auto grid w-full max-w-[380px] gap-4 p-5" aria-label="Payment">
      <div className="flex items-baseline justify-between">
        <span className="text-title-3 text-ink">Payment</span>
        <span className="text-title-3 tabular-nums">{formatRs(OVERDUE_TOTAL)}</span>
      </div>
      <fieldset className="m-0 grid gap-2 border-0 p-0">
        <legend className="mtb-label mb-2">Payment method</legend>
        <div className="grid grid-cols-2 gap-2">
          {METHODS.map((m) => (
            <Radio key={m} name="st-method" value={m} label={m} checked={method === m} onChange={() => setMethod(m)} />
          ))}
        </div>
      </fieldset>
      {method === "Cheque" ? (
        <div className="grid gap-3">
          <Input ref={chequeRef} label="Cheque number" required value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} error={shown.chequeNo} mono inputMode="numeric" />
          <Select label="Bank" required value={bank} onChange={(e) => setBank(e.target.value)} error={shown.bank} options={[{ value: "", label: "Choose…" }, ...BANKS]} />
          <DatePicker label="Cheque date" required value={chequeDate} onValueChange={setChequeDate} error={shown.chequeDate} today={TODAY} />
        </div>
      ) : (
        <p className="m-0 rounded-md bg-surface-sunken px-3 py-2 text-small text-ink-muted">Each method shows only its own fields, all required. Choose Cheque to see the missing-number error.</p>
      )}
      <Button
        variant="primary"
        size="lg"
        block
        iconRight="arrowRight"
        onClick={() => {
          if (method !== "Cheque") return setMethod("Cheque");
          setShowErrors(true);
          if (parsed.success) setReviewing(true);
          else chequeRef.current?.focus();
        }}
      >
        Review · {formatRs(OVERDUE_TOTAL)}
      </Button>
      <ReceiptReviewDialog
        open={reviewing}
        onClose={() => setReviewing(false)}
        onPosted={() => {
          setReviewing(false);
          setChequeNo("");
          setShowErrors(true);
        }}
        payment={`Cheque ${chequeNo} · ${bank} · ${chequeDate ? formatDate(chequeDate) : ""}`}
      />
    </aside>
  );
}

export function ValidationSection() {
  return (
    <StateGroupSection id="validation">
      <Specimen id="mfa-wrong" rise={0} below={<p className="m-0 mt-3 text-small text-ink-muted">Every code is wrong in this specimen, so you can watch the attempts run out and the account lock.</p>}>
        <TwoStepSpecimen />
      </Specimen>
      <Specimen id="cheque-missing" rise={1} below={<p className="m-0 mt-3 text-small text-ink-muted">Type any cheque number and the message clears as you type; Review then opens the real review step.</p>}>
        <ChequeSpecimen />
      </Specimen>
      <Specimen id="jv-balance" rise={2} wide>
        <VoucherSpecimen />
      </Specimen>
      <Specimen id="marks-max" rise={3} plain below={<p className="m-0 mt-3 text-small text-ink-muted">The exam office's marks grid in the staff app (Exams → an exam → Marks) shows “Maximum is 75.” in the cell the same way.</p>}>
        <MarksSpecimen />
      </Specimen>
    </StateGroupSection>
  );
}
