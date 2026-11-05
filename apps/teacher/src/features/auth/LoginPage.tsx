import { ApiError, authApi, authQueries } from "@mtb/api";
import { Banner, Button, IconButton, Input } from "@mtb/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState, type KeyboardEvent } from "react";
import { z } from "zod";
import { AuthLayout } from "./AuthLayout";

const schema = z.object({
  username: z.string().trim().min(1, { error: "Enter your username." }),
  password: z.string().min(1, { error: "Enter your password." }),
});

export function LoginPage({ redirectTo, username: initialUser, changed }: { redirectTo?: string; username?: string; changed?: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState(initialUser ?? "");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [touched, setTouched] = useState(false);

  const login = useMutation({
    mutationFn: () => authApi.login({ username: username.trim(), password }),
    onSuccess: async (res) => {
      if (res.status === "mfa_required") {
        await navigate({ to: "/login/mfa", search: { challenge: res.challengeId, phone: res.maskedPhone, ...(redirectTo ? { redirect: redirectTo } : {}) } });
      } else if (res.status === "password_reset_required") {
        await navigate({ to: "/login/reset-password", search: { token: res.resetToken, username: username.trim() } });
      } else {
        queryClient.setQueryData(authQueries.session().queryKey, res.user);
        await navigate({ to: (redirectTo ?? "/today") as never });
      }
    },
  });

  const parsed = schema.safeParse({ username, password });
  const fieldError = (k: "username" | "password") => (touched && !parsed.success ? parsed.error.issues.find((i) => i.path[0] === k)?.message : undefined);
  const error = login.error instanceof ApiError ? login.error : null;
  const checkCaps = (e: KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.("CapsLock") ?? false);

  return (
    <AuthLayout title="Sign in" subtitle="Use the same username and password as the school system.">
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (parsed.success) login.mutate();
        }}
      >
        {changed && !error && <Banner tone="success">Your new password is saved. Sign in to continue.</Banner>}
        {error && <Banner tone="danger">{error.isNetwork ? "Can't reach the school server. Check the phone's connection and try again." : error.message}</Banner>}
        <Input
          label="Username"
          size="lg"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          error={fieldError("username")}
        />
        <Input
          label="Password"
          size="lg"
          type={show ? "text" : "password"}
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyUp={checkCaps}
          onKeyDown={checkCaps}
          error={fieldError("password")}
          action={<IconButton icon={show ? "eyeOff" : "eye"} label={show ? "Hide password" : "Show password"} size="touch" onClick={() => setShow((s) => !s)} />}
        />
        {caps && (
          <Banner tone="warning" role="status">
            Caps Lock is on. Passwords are case-sensitive.
          </Banner>
        )}
        <Button type="submit" variant="primary" size="touch" block loading={login.isPending} loadingLabel="Signing in…">
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
