import { ApiError, authApi, authQueries } from "@mtb/api";
import { Banner, Button, Input } from "@mtb/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AuthLayout } from "./AuthLayout";

/** Two-step sign-in for accounts that have it (optional for teachers; required for admin and finance roles). */
export function MfaPage({ challenge, phone, redirectTo }: { challenge: string; phone: string; redirectTo?: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [method, setMethod] = useState<"app" | "sms">("app");
  const [touched, setTouched] = useState(false);
  const verify = useMutation({
    mutationFn: () => authApi.verifyMfa({ challengeId: challenge, code, method }),
    onSuccess: async (user) => {
      queryClient.setQueryData(authQueries.session().queryKey, user);
      await navigate({ to: (redirectTo ?? "/today") as never });
    },
    onError: () => setCode(""),
  });
  const sms = useMutation({ mutationFn: () => authApi.sendSmsCode(challenge), onSuccess: () => setMethod("sms") });

  const error = verify.error instanceof ApiError ? verify.error : null;
  const locked = error?.code === "MFA_LOCKED";
  const invalid = touched && code.length !== 6 ? "Enter all six digits." : undefined;

  return (
    <AuthLayout title="Enter your code" subtitle={method === "app" ? "Open your authenticator app and type the six-digit code." : `We sent a six-digit code by SMS to ${sms.data?.maskedPhone ?? phone}.`}>
      {locked ? (
        <div className="grid gap-4">
          <Banner tone="danger" title="Signing in is locked.">
            {error?.message}
          </Banner>
          <Link to="/login" className="mtb-btn mtb-btn-secondary mtb-btn-touch">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (code.length === 6) verify.mutate();
          }}
        >
          {error && <Banner tone="danger">{error.isNetwork ? "Can't reach the school server. Check the connection and try again." : error.message}</Banner>}
          <Input
            label="Six-digit code"
            size="lg"
            mono
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            error={invalid}
            inputClassName="text-center text-[22px] tracking-[0.5em]"
          />
          <Button type="submit" variant="primary" size="touch" block loading={verify.isPending} loadingLabel="Checking…">
            Continue
          </Button>
          {method === "app" && (
            <Button variant="ghost" size="touch" block loading={sms.isPending} onClick={() => sms.mutate()}>
              Use SMS code instead
            </Button>
          )}
        </form>
      )}
    </AuthLayout>
  );
}
