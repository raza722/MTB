import { ApiError, authApi, authQueries } from "@mtb/api";
import { Banner, Button, IconButton, Input } from "@mtb/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useState, type KeyboardEvent } from "react";
import { AuthLayout } from "./AuthLayout";

const DemoAccounts = lazy(() => import("./DemoAccounts"));

export function LoginPage({ redirectTo }: { redirectTo?: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [touched, setTouched] = useState(false);

  const login = useMutation({
    mutationFn: () => authApi.login({ username, password }),
    onSuccess: async (res) => {
      if (res.status === "mfa_required") {
        await navigate({ to: "/login/mfa", search: { challenge: res.challengeId, phone: res.maskedPhone, ...(redirectTo ? { redirect: redirectTo } : {}) } as never });
      } else if (res.status === "password_reset_required") {
        await navigate({ to: "/login/reset-password", search: { token: res.resetToken } as never });
      } else {
        queryClient.setQueryData(authQueries.session().queryKey, res.user);
        await navigate({ to: redirectTo ?? "/dashboard" } as never);
      }
    },
  });

  const checkCaps = (e: KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.("CapsLock") ?? false);
  const missingUser = touched && !username.trim();
  const missingPass = touched && !password;
  const error = login.error instanceof ApiError ? login.error : null;

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Use the username and password your campus admin gave you."
      aside={
        import.meta.env.VITE_USE_MOCKS !== "false" ? (
          <Suspense fallback={null}>
            <DemoAccounts
              onPick={(u, p) => {
                setUsername(u);
                setPassword(p);
              }}
            />
          </Suspense>
        ) : undefined
      }
    >
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (username.trim() && password) login.mutate();
        }}
      >
        {error && (
          <Banner tone="danger">{error.isNetwork ? "Can't reach the server. Check the connection and try again." : error.message}</Banner>
        )}
        <Input
          label="Username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          error={missingUser ? "Enter your username." : undefined}
          autoFocus
        />
        <Input
          label="Password"
          type={show ? "text" : "password"}
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyUp={checkCaps}
          onKeyDown={checkCaps}
          error={missingPass ? "Enter your password." : undefined}
          action={<IconButton icon={show ? "eyeOff" : "eye"} label={show ? "Hide password" : "Show password"} size="sm" onClick={() => setShow((s) => !s)} />}
        />
        {caps && !missingPass && (
          <Banner tone="warning" role="status">
            Caps Lock is on. Passwords are case-sensitive.
          </Banner>
        )}
        <Button type="submit" variant="primary" size="lg" block loading={login.isPending} loadingLabel="Signing in…">
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
