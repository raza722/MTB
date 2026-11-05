import { authApi, authQueries } from "@mtb/api";
import { DEMO_MFA_CODE, DEMO_PASSWORD, demoControls, resetDemoData, USERS } from "@mtb/mocks";
import { Button, Icon, Switch, useToast } from "@mtb/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Popover } from "radix-ui";
import { useState } from "react";
import { useSessionUser } from "../session";

/**
 * Presenter's panel, mock mode only: sign in as any cast member in one click, make the next receipt post
 * fail, or reset the demo data. Not part of the product.
 */
export default function DemoControls() {
  const user = useSessionUser();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [failNext, setFailNext] = useState(() => demoControls.get().failNextReceiptPost);
  const [busy, setBusy] = useState<string | null>(null);

  const signInAs = async (username: string) => {
    setBusy(username);
    try {
      await authApi.logout();
      const res = await authApi.login({ username, password: DEMO_PASSWORD });
      queryClient.clear();
      if (res.status === "password_reset_required") {
        await navigate({ to: "/login/reset-password", search: { token: res.resetToken } as never });
        return;
      }
      const signedIn = res.status === "mfa_required" ? await authApi.verifyMfa({ challengeId: res.challengeId, code: DEMO_MFA_CODE, method: "app" }) : res.user;
      queryClient.setQueryData(authQueries.session().queryKey, signedIn);
      await navigate({ to: "/dashboard", search: {} as never });
      toast({ title: `Signed in as ${signedIn.name}`, message: signedIn.roles.map((r) => `${r.roleName} — ${r.campusName}`).join(", ") });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="fixed bottom-4 left-4 z-40 flex h-9 items-center gap-2 rounded-full border border-border-strong bg-surface-raised px-3 text-small font-medium text-ink-muted shadow-md hover:text-ink" aria-label="Demo controls">
          <Icon name="bolt" size={16} /> Demo
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="start" sideOffset={8} className="mtb-popover z-50 grid w-80 gap-4">
          <div className="grid gap-1">
            <span className="text-title-3">Demo controls</span>
            <span className="text-small text-ink-muted">For the presenter. Fictional data; resets when this tab closes.</span>
          </div>
          <div className="grid gap-1">
            <span className="mtb-label">Sign in as</span>
            {USERS.map((u) => (
              <button
                key={u.id}
                type="button"
                disabled={busy !== null}
                onClick={() => signInAs(u.username)}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-hover disabled:opacity-60"
                aria-current={user?.id === u.id ? "true" : undefined}
              >
                <span className="grid">
                  <span className="font-medium text-ink">
                    {u.name} {user?.id === u.id && <span className="text-small text-brand-ink">· signed in</span>}
                  </span>
                  <span className="text-small text-ink-muted">
                    {u.roles[0]?.roleName} — {u.roles[0]?.campusName} · {u.demoNote}
                  </span>
                </span>
                {busy === u.username ? <span className="mtb-spinner text-ink-muted" /> : <Icon name="chevronRight" size={16} className="text-ink-muted" />}
              </button>
            ))}
          </div>
          <Switch
            label="Next receipt post fails (network error)"
            checked={failNext}
            onChange={(e) => {
              demoControls.set((c) => ({ ...c, failNextReceiptPost: e.target.checked }));
              setFailNext(e.target.checked);
            }}
          />
          <Button
            variant="danger-quiet"
            size="sm"
            icon="refresh"
            onClick={() => {
              resetDemoData();
              queryClient.clear();
              window.location.assign("/login");
            }}
          >
            Reset demo data
          </Button>
          <span className="text-small text-ink-muted">
            Demo password and code are in <span className="mtb-mono">packages/mocks/src/fixtures/users.ts</span>.
          </span>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
