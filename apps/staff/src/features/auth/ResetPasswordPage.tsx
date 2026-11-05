import { ApiError, authApi } from "@mtb/api";
import { Banner, Button, cx, EmptyState, Icon, IconButton, Input } from "@mtb/ui";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { AuthLayout } from "./AuthLayout";

const RULES: Array<{ id: string; label: string; test: (p: string) => boolean }> = [
  // Same rules as the server (and Setup → Users): 8 to 72 characters with a letter and a number, not containing the username.
  { id: "len", label: "8 to 72 characters", test: (p) => p.length >= 8 && p.length <= 72 },
  { id: "letter", label: "At least one letter", test: (p) => /[A-Za-z]/.test(p) },
  { id: "num", label: "At least one number", test: (p) => /\d/.test(p) },
  { id: "common", label: "Not a common password (like Password123 or Mtb@12345)", test: (p) => p.length > 0 && !/^(password|mtb|pakistan|qwerty|admin|school)/i.test(p) },
];

export function ResetPasswordPage({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const reset = useMutation({ mutationFn: () => authApi.resetPassword({ resetToken: token, newPassword: password }) });

  const passed = RULES.map((r) => r.test(password));
  const allPassed = passed.every(Boolean);
  const mismatch = confirm.length > 0 && confirm !== password;

  if (reset.isSuccess) {
    return (
      <AuthLayout title="Password changed">
        <EmptyState
          icon="checkCircle"
          title="Your new password is saved"
          description="Sign in with your new password. You won't be asked to change it again."
          action={
            <Link to="/login" className="mtb-btn mtb-btn-primary mtb-btn-lg">
              Sign in
            </Link>
          }
        />
      </AuthLayout>
    );
  }

  const error = reset.error instanceof ApiError ? reset.error : null;

  return (
    <AuthLayout title="Choose a new password" subtitle="This is your first sign-in. Replace the temporary password before you continue.">
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(true);
          if (allPassed && confirm === password) reset.mutate();
        }}
      >
        {error && <Banner tone="danger">{error.message}</Banner>}
        <Input
          label="New password"
          type={show ? "text" : "password"}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby="password-rules"
          error={submitted && !allPassed ? "The password doesn't meet all the rules below." : undefined}
          action={<IconButton icon={show ? "eyeOff" : "eye"} label={show ? "Hide password" : "Show password"} size="sm" onClick={() => setShow((s) => !s)} />}
          autoFocus
        />
        <ul id="password-rules" className="m-0 grid list-none gap-1.5 p-0" aria-live="polite">
          {RULES.map((r, i) => (
            <li key={r.id} className={cx("flex items-center gap-2 text-small", passed[i] ? "text-success-ink" : "text-ink-muted")}>
              <Icon name={passed[i] ? "checkCircle" : "minus"} size={16} />
              <span>
                {r.label}
                <span className="mtb-sr-only">{passed[i] ? " — done" : " — not yet"}</span>
              </span>
            </li>
          ))}
        </ul>
        <Input
          label="Confirm new password"
          type={show ? "text" : "password"}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={mismatch || (submitted && confirm !== password) ? "The two passwords don't match." : undefined}
        />
        <Button type="submit" variant="primary" size="lg" block loading={reset.isPending} loadingLabel="Saving…">
          Save new password
        </Button>
      </form>
    </AuthLayout>
  );
}
