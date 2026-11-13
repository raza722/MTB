import { ApiError, portalApi, type PortalAccountKind, type PortalCodeRequest, type PortalTooSoonDetails } from "@mtb/api";
import { normalizeMobile } from "@mtb/domain";
import { Banner, Button, Input, Segmented } from "@mtb/ui";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { Ltr, useLang } from "../../app/i18n";
import { AuthLayout } from "./AuthLayout";
import { loadPending, savePending } from "./challenge";

/**
 * Validation runs in the browser first, so a typo gets a message next to the field without a round trip.
 * A G.R. number is the campus code, a dash and the number as the school card prints it, letters allowed
 * ("KC-14823", "KC-C-1234"), at most 20 characters: the server's rule (12_portal.md X15, C5). "kc14823" → "KC-14823".
 */
const mobileSchema = z.string().trim().refine((v) => normalizeMobile(v) !== null);
const normaliseGr = (v: string) => v.trim().toUpperCase().replace(/\s+/g, "").replace(/^([A-Z]{2})-?(\d+)$/, "$1-$2");
const grSchema = z.string().transform(normaliseGr).pipe(z.string().max(20).regex(/^[A-Z]{2}-[A-Z0-9]+(?:-[A-Z0-9]+)*$/));

/**
 * Sign in with the family's mobile number (parent) or a G.R. number (student) and a one-time SMS code.
 * No passwords: nothing to forget, nothing to share, and only the registered mobile can receive the code.
 */
export function SignInPage({ as, expired }: { as?: "student"; expired?: boolean }) {
  const { t, rich } = useLang();
  const navigate = useNavigate();
  const pending = loadPending();
  const [kind, setKind] = useState<PortalAccountKind>(as === "student" ? "STUDENT" : (pending?.kind ?? "PARENT"));
  const [mobile, setMobile] = useState(pending?.kind === "PARENT" ? pending.identifier : "");
  const [grNo, setGrNo] = useState(pending?.kind === "STUDENT" ? pending.identifier : "");
  const [fieldError, setFieldError] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: (body: PortalCodeRequest) => portalApi.requestCode(body),
    onSuccess: async (challenge, body) => {
      savePending({ ...challenge, identifier: body.kind === "PARENT" ? body.mobile : body.grNo, sentAt: Date.now() });
      await navigate({ to: "/sign-in/verify" });
    },
    // The server never says whether a number or G.R. is registered (C1): an unknown one gets a code that never comes.
    onError: (e) => {
      if (e instanceof ApiError && e.code === "VALIDATION") setFieldError(kind === "PARENT" ? t("signin.errMobile") : t("signin.errGr", { example: "KC-14823" }));
    },
  });

  const submit = () => {
    setFieldError(null);
    send.reset();
    if (kind === "PARENT") {
      if (!mobileSchema.safeParse(mobile).success) return setFieldError(t("signin.errMobile"));
      send.mutate({ kind: "PARENT", mobile: normalizeMobile(mobile)! });
    } else {
      if (!grSchema.safeParse(grNo).success) return setFieldError(t("signin.errGr", { example: "KC-14823" }));
      send.mutate({ kind: "STUDENT", grNo: normaliseGr(grNo) });
    }
  };

  const err = send.error && !fieldError ? send.error : null;
  const waitSec = err instanceof ApiError ? (err.details as PortalTooSoonDetails | undefined)?.waitSec : undefined;
  const bannerError = !err
    ? null
    : !(err instanceof ApiError)
      ? t("error.generic")
      : err.isNetwork
        ? t("error.network")
        : err.code === "CODE_LOCKED"
          ? t("verify.err.CODE_LOCKED")
          : err.code === "TOO_SOON"
            ? waitSec !== undefined
              ? t("signin.err.TOO_SOON", { sec: waitSec })
              : t("verify.err.TOO_SOON")
            : err.code === "VALIDATION"
              ? null
              : t("error.generic");

  return (
    <AuthLayout title={t("signin.title")} subtitle={t("signin.subtitle")}>
      {expired && <Banner tone="info">{t("error.signedOut")}</Banner>}
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="grid gap-1.5">
          <span className="mtb-label" id="signin-as">
            {t("signin.as")}
          </span>
          <Segmented
            touch
            aria-label={t("signin.as")}
            className="w-full [&>button]:flex-1"
            value={kind}
            onChange={(v) => {
              setKind(v as PortalAccountKind);
              setFieldError(null);
              send.reset();
            }}
            options={[
              { value: "PARENT", label: t("signin.parent") },
              { value: "STUDENT", label: t("signin.student") },
            ]}
          />
        </div>

        {kind === "PARENT" ? (
          <Input
            key="mobile"
            label={t("signin.mobile")}
            size="lg"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            dir="ltr"
            placeholder="0300-1234567"
            value={mobile}
            onChange={(e) => {
              setMobile(e.target.value);
              setFieldError(null);
            }}
            help={rich("signin.mobileHelp", { example: <Ltr>0300-1234567</Ltr> })}
            error={fieldError ?? undefined}
            autoFocus
          />
        ) : (
          <Input
            key="gr"
            label={t("signin.gr")}
            size="lg"
            mono
            dir="ltr"
            autoCapitalize="characters"
            autoComplete="off"
            placeholder="KC-14823"
            value={grNo}
            onChange={(e) => {
              setGrNo(e.target.value);
              setFieldError(null);
            }}
            help={rich("signin.grHelp", { example: <Ltr>KC-14823</Ltr> })}
            error={fieldError ?? undefined}
            autoFocus
          />
        )}

        {bannerError && <Banner tone="danger">{bannerError}</Banner>}

        <Button type="submit" variant="primary" size="touch" block icon="message" loading={send.isPending} loadingLabel={t("signin.sending")}>
          {t("signin.send")}
        </Button>
        <p className="m-0 text-small text-ink-muted">{t("signin.privacy")}</p>
      </form>
    </AuthLayout>
  );
}
