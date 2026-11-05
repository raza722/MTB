import { ApiError, authApi, authQueries } from "@mtb/api";
import { Banner, Button, cx } from "@mtb/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { AuthLayout } from "./AuthLayout";

const LENGTH = 6;

/** Six single-digit boxes: typing moves forward, Backspace moves back, pasting fills all six. */
function CodeBoxes({ value, onChange, disabled, invalid, onComplete }: { value: string[]; onChange: (v: string[]) => void; disabled: boolean; invalid: boolean; onComplete: (code: string) => void }) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const setAt = (i: number, digit: string) => {
    const next = [...value];
    next[i] = digit;
    onChange(next);
    if (digit && i < LENGTH - 1) refs.current[i + 1]?.focus();
    if (next.every((d) => d !== "")) onComplete(next.join(""));
  };
  const onKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !value[i] && i > 0) {
      e.preventDefault();
      const next = [...value];
      next[i - 1] = "";
      onChange(next);
      refs.current[i - 1]?.focus();
    }
    if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
    if (e.key === "ArrowRight" && i < LENGTH - 1) refs.current[i + 1]?.focus();
  };
  /** Several digits at once (paste, or a phone auto-filling the SMS code into one box): spread them from box `from`. */
  const fillFrom = (from: number, text: string) => {
    const digits = text.replace(/\D/g, "").slice(0, LENGTH - from).split("");
    if (digits.length === 0) return false;
    const next = [...value];
    digits.forEach((d, k) => (next[from + k] = d));
    onChange(next);
    refs.current[Math.min(from + digits.length, LENGTH - 1)]?.focus();
    if (next.every((d) => d !== "")) onComplete(next.join(""));
    return true;
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (/\d/.test(text)) {
      e.preventDefault();
      fillFrom(0, text);
    }
  };
  return (
    <div className="flex justify-between gap-2" role="group" aria-labelledby="code-label">
      {value.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`Digit ${i + 1} of ${LENGTH}`}
          aria-invalid={invalid || undefined}
          autoFocus={i === 0}
          className={cx("mtb-input h-14 w-12 text-center text-title-1 tabular-nums", invalid && "is-invalid")}
          onChange={(e) => {
            const typed = e.target.value.replace(/\D/g, "");
            if (typed.length > 1 && typed.length !== 2) fillFrom(i, typed);
            else setAt(i, typed.slice(-1));
          }}
          onKeyDown={(e) => onKey(i, e)}
          onPaste={onPaste}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  );
}

export function MfaPage({ challenge, phone, redirectTo }: { challenge: string; phone: string; redirectTo?: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [digits, setDigits] = useState<string[]>(Array(LENGTH).fill(""));
  const [method, setMethod] = useState<"app" | "sms">("app");
  const [smsPhone, setSmsPhone] = useState(phone);

  const verify = useMutation({
    mutationFn: (code: string) => authApi.verifyMfa({ challengeId: challenge, code, method }),
    onSuccess: async (user) => {
      queryClient.setQueryData(authQueries.session().queryKey, user);
      await navigate({ to: redirectTo ?? "/dashboard" } as never);
    },
    onError: () => {
      setDigits(Array(LENGTH).fill(""));
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>('input[aria-label="Digit 1 of 6"]')?.focus());
    },
  });
  const sendSms = useMutation({
    mutationFn: () => authApi.sendSmsCode(challenge),
    onSuccess: (r) => {
      setMethod("sms");
      setSmsPhone(r.maskedPhone);
    },
  });

  const err = verify.error instanceof ApiError ? verify.error : null;
  const locked = err?.code === "MFA_LOCKED";
  const expired = err?.code === "CHALLENGE_EXPIRED";
  const code = digits.join("");

  return (
    <AuthLayout
      title="Two-step verification"
      subtitle={method === "app" ? "Enter the 6-digit code from your authenticator app." : `We sent a 6-digit code by SMS to ${smsPhone}.`}
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length === LENGTH) verify.mutate(code);
        }}
      >
        <span id="code-label" className="mtb-label">
          Verification code
        </span>
        <CodeBoxes value={digits} onChange={setDigits} disabled={locked || expired || verify.isPending} invalid={Boolean(err) && !locked} onComplete={(c) => verify.mutate(c)} />
        {err && !locked && !expired && (
          <div className="mtb-error" role="alert">
            {err.isNetwork ? "Can't reach the server. Try again." : err.message}
          </div>
        )}
        {(locked || expired) && (
          <Banner tone="danger" title={locked ? "Account locked for 15 minutes." : "This sign-in has expired."}>
            {locked ? "Too many incorrect codes. Try again later, or ask your campus admin to unlock your account." : "Start again from the sign-in page."}
          </Banner>
        )}
        {locked || expired ? (
          <Link to="/login" className="mtb-btn mtb-btn-secondary mtb-btn-lg mtb-btn-block">
            Back to sign in
          </Link>
        ) : (
          <Button type="submit" variant="primary" size="lg" block disabled={code.length < LENGTH} loading={verify.isPending} loadingLabel="Checking…">
            Verify
          </Button>
        )}
        {!locked && !expired && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-small">
            {method === "app" ? (
              <Button variant="quiet" size="sm" icon="message" loading={sendSms.isPending} onClick={() => sendSms.mutate()}>
                Use SMS code instead
              </Button>
            ) : (
              <Button variant="quiet" size="sm" icon="refresh" loading={sendSms.isPending} onClick={() => sendSms.mutate()}>
                Send the SMS again
              </Button>
            )}
            <Link to="/login" className="text-ink-muted underline underline-offset-2">
              Use a different account
            </Link>
          </div>
        )}
      </form>
    </AuthLayout>
  );
}
