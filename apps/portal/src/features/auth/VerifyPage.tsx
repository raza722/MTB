import { ApiError, portalApi, portalQueries, type PortalCodeErrorDetails } from "@mtb/api";
import { Banner, Button, cx, useToast } from "@mtb/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { firstName } from "../../app/format";
import { Ltr, useLang } from "../../app/i18n";
import { AuthLayout } from "./AuthLayout";
import { clearPending, loadPending, savePending, type PendingChallenge } from "./challenge";

const LENGTH = 6;

/** Six digit boxes, always left to right: typing moves on, Backspace moves back, a pasted or auto-filled SMS code fills all six. */
function CodeBoxes({ value, onChange, disabled, invalid, onComplete }: { value: string[]; onChange: (v: string[]) => void; disabled: boolean; invalid: boolean; onComplete: (code: string) => void }) {
  const { t } = useLang();
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const fillFrom = (from: number, text: string) => {
    const digits = text.replace(/\D/g, "").slice(0, LENGTH - from).split("");
    if (digits.length === 0) return;
    const next = [...value];
    digits.forEach((d, k) => (next[from + k] = d));
    onChange(next);
    refs.current[Math.min(from + digits.length, LENGTH - 1)]?.focus();
    if (next.every((d) => d !== "")) onComplete(next.join(""));
  };
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
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (/\d/.test(text)) {
      e.preventDefault();
      fillFrom(0, text);
    }
  };
  return (
    <div dir="ltr" className="flex justify-between gap-2" role="group" aria-labelledby="code-label">
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
          aria-label={t("verify.digit", { n: i + 1 })}
          aria-invalid={invalid || undefined}
          autoFocus={i === 0}
          className={cx("mtb-input h-14 w-full max-w-14 text-center text-title-1 tabular-nums", invalid && "is-invalid")}
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

/** Seconds left before another code may be sent. */
function useCountdown(pending: PendingChallenge | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  if (!pending) return 0;
  return Math.max(0, Math.ceil(pending.resendAfterSec - (now - pending.sentAt) / 1000));
}

export function VerifyPage() {
  const { t, tp, rich, pick } = useLang();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [pending, setPending] = useState(loadPending);
  const [digits, setDigits] = useState<string[]>(Array(LENGTH).fill(""));
  const wait = useCountdown(pending);

  const verify = useMutation({
    mutationFn: (code: string) => portalApi.verifyCode({ challengeId: pending!.challengeId, code }),
    onSuccess: async (account) => {
      clearPending();
      queryClient.setQueryData(portalQueries.session().queryKey, account);
      const first = account.children[0]?.grNo;
      await navigate({ to: "/home", search: (first ? { child: first } : {}) as never });
      toast({ tone: "success", title: t("verify.welcome", { name: firstName(pick(account.name, account.nameUr)) }) });
    },
    onError: () => {
      setDigits(Array(LENGTH).fill(""));
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>("input[autocomplete='one-time-code']")?.focus());
    },
  });

  const resend = useMutation({
    mutationFn: () => portalApi.resendCode(pending!.challengeId),
    onSuccess: (c) => {
      const next = { ...pending!, ...c, sentAt: Date.now() };
      savePending(next);
      setPending(next);
      verify.reset();
      toast({ tone: "info", title: t("verify.resent") });
    },
  });

  if (!pending) return <Navigate to="/sign-in" />;

  const err = verify.error instanceof ApiError ? verify.error : null;
  const resendErr = resend.error instanceof ApiError ? resend.error : null;
  const locked = err?.code === "CODE_LOCKED";
  const expired = err?.code === "CODE_EXPIRED" || resendErr?.code === "CODE_EXPIRED";
  const code = digits.join("");
  const attemptsLeft = (err?.details as PortalCodeErrorDetails | undefined)?.attemptsLeft;

  const inlineError = !err
    ? null
    : err.isNetwork
      ? t("error.network")
      : err.code === "CODE_INVALID" && attemptsLeft !== undefined
        ? tp("verify.err.CODE_INVALID", attemptsLeft)
        : locked || expired
          ? null
          : t("error.generic");

  return (
    <AuthLayout title={t("verify.title")} subtitle={rich("verify.subtitle", { phone: <Ltr className="font-medium text-ink">{pending.maskedPhone}</Ltr> })}>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length === LENGTH) verify.mutate(code);
        }}
      >
        <span id="code-label" className="mtb-label">
          {t("verify.label")}
        </span>
        <CodeBoxes value={digits} onChange={setDigits} disabled={locked || expired || verify.isPending} invalid={Boolean(inlineError)} onComplete={(c) => verify.mutate(c)} />
        {inlineError && (
          <div className="mtb-error" role="alert">
            {inlineError}
          </div>
        )}
        {(locked || expired) && (
          <Banner tone={locked ? "danger" : "warning"} title={locked ? t("verify.err.CODE_LOCKED.title") : t("verify.err.CODE_EXPIRED.title")}>
            {locked ? t("verify.err.CODE_LOCKED") : t("verify.err.CODE_EXPIRED")}
          </Banner>
        )}
        {resendErr?.code === "TOO_SOON" && (
          <div className="mtb-error" role="alert">
            {t("verify.err.TOO_SOON")}
          </div>
        )}

        {locked || expired ? (
          <Link to="/sign-in" className="mtb-btn mtb-btn-primary mtb-btn-touch mtb-btn-block">
            {t("verify.startAgain")}
          </Link>
        ) : (
          <Button type="submit" variant="primary" size="touch" block disabled={code.length < LENGTH} loading={verify.isPending} loadingLabel={t("verify.checking")}>
            {t("verify.submit")}
          </Button>
        )}

        {!locked && !expired && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-small">
            <Button variant="quiet" size="sm" icon="refresh" disabled={wait > 0} loading={resend.isPending} onClick={() => resend.mutate()}>
              {wait > 0 ? rich("verify.resendIn", { sec: <Ltr className="tabular-nums">{wait}</Ltr> }) : t("verify.resend")}
            </Button>
            <Link to="/sign-in" className="text-ink-muted underline underline-offset-2">
              {pending.kind === "STUDENT" ? t("verify.changeStudent") : t("verify.change")}
            </Link>
          </div>
        )}
      </form>
    </AuthLayout>
  );
}
