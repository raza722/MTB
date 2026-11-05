import { portalApi, portalQueries } from "@mtb/api";
import { Avatar, Button, EmptyState, Icon, IconButton, Menu, MenuItem, MenuLabel, MenuSeparator, useToast } from "@mtb/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { setTheme, useTheme } from "../appearance";
import { useLang } from "../i18n";
import { useAccount, useChild } from "../session";
import { ChildSwitcher } from "./ChildSwitcher";
import { BottomNav, SideNav } from "./nav";

/** English ↔ اردو. The label is always in the other language, so a reader can find it in either. */
export function LangToggle({ block }: { block?: boolean }) {
  const { lang, setLang, t } = useLang();
  const other = lang === "en" ? "ur" : "en";
  return (
    <Button variant="secondary" icon="globe" block={block} aria-label={t("lang.otherLabel")} onClick={() => setLang(other)} className="min-h-11">
      <span lang={other} dir={other === "ur" ? "rtl" : "ltr"} className={other === "ur" ? "font-[family-name:var(--font-urdu)]" : "font-[family-name:var(--font-sans)]"}>
        {t("lang.other")}
      </span>
    </Button>
  );
}

export function ThemeToggle() {
  const { resolved } = useTheme();
  const { t } = useLang();
  return (
    <IconButton
      icon={resolved === "dark" ? "sun" : "moon"}
      label={resolved === "dark" ? t("theme.toggleLight") : t("theme.toggleDark")}
      size="touch"
      onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
    />
  );
}

/** Signs out, forgets everything cached for this account and returns to sign-in. */
export function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const { t } = useLang();
  return useMutation({
    mutationFn: portalApi.signOut,
    onSettled: async () => {
      // Leave the signed-in pages first, then forget what was cached for this account.
      await navigate({ to: "/sign-in", search: {} as never });
      queryClient.removeQueries({ queryKey: portalQueries.all() });
      toast({ tone: "info", title: t("shell.signedOut") });
    },
  });
}

function AccountMenu() {
  const account = useAccount();
  const { t, pick } = useLang();
  const navigate = useNavigate();
  const signOut = useSignOut();
  const role = account.kind === "STUDENT" ? t("role.STUDENT") : t(`role.${account.relation ?? "Guardian"}`);
  return (
    <Menu
      align="end"
      label={t("shell.account")}
      trigger={
        <button type="button" className="flex min-h-11 items-center gap-2 rounded-md px-2 hover:bg-surface-hover" aria-label={`${t("shell.account")}: ${pick(account.name, account.nameUr)}`}>
          <Avatar name={account.name} size="sm" tone={2} />
          <span className="grid text-start leading-tight">
            <span className="font-medium text-ink">{pick(account.name, account.nameUr)}</span>
            <span className="text-caption text-ink-muted">{role}</span>
          </span>
          <Icon name="chevronDown" size={16} className="text-ink-muted" />
        </button>
      }
    >
      <MenuLabel>{t("shell.signedInAs", { name: pick(account.name, account.nameUr) })}</MenuLabel>
      <MenuItem icon="user" onSelect={() => void navigate({ to: "/profile" })}>
        {t("nav.profileLong")}
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon="logout" onSelect={() => signOut.mutate()}>
        {t("shell.signOut")}
      </MenuItem>
    </Menu>
  );
}

/** The signed-in frame: top bar with the child, the pages (side list on a computer, bottom bar on a phone). */
export function PortalShell() {
  const { t } = useLang();
  const child = useChild();
  const signOut = useSignOut();

  return (
    <div className="portal-shell min-h-dvh bg-surface lg:grid lg:grid-cols-[256px_minmax(0,1fr)]">
      <a href="#main" className="mtb-sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface-raised focus:p-2">
        {t("nav.skip")}
      </a>

      {/* Computer: side list */}
      <aside className="portal-no-print sticky top-0 hidden h-dvh flex-col gap-6 border-e border-border bg-surface-raised px-4 py-5 lg:flex">
        <Link to="/home" className="grid gap-0.5 px-3 no-underline">
          <span className="text-title-1 tracking-tight text-brand-ink">MTB</span>
          <span className="text-small text-ink-muted">{t("app.tagline")}</span>
        </Link>
        <SideNav />
        <div className="mt-auto grid gap-2">
          <LangToggle block />
          <Button variant="ghost" icon="logout" block loading={signOut.isPending} onClick={() => signOut.mutate()} className="justify-start">
            {t("shell.signOut")}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="portal-topbar portal-no-print sticky top-0 z-30 border-b border-border pt-[env(safe-area-inset-top)]">
          <div className="mx-auto flex min-h-16 w-full max-w-[1120px] items-center gap-2 px-2 lg:gap-4 lg:px-8">
            <ChildSwitcher />
            <div className="ms-auto flex shrink-0 items-center gap-1 lg:gap-2">
              <div className="hidden lg:block">
                <ThemeToggle />
              </div>
              <LangToggle />
              <div className="hidden lg:block">
                <AccountMenu />
              </div>
              <Link
                to="/profile"
                aria-label={t("nav.profileLong")}
                className="mtb-btn mtb-btn-ghost mtb-btn-touch mtb-btn-icon aria-[current=page]:bg-brand-tint aria-[current=page]:text-brand-ink lg:hidden"
              >
                <Icon name="user" size={22} />
              </Link>
            </div>
          </div>
        </header>

        <main id="main" tabIndex={-1} className="portal-page mx-auto w-full max-w-[1120px] flex-1 px-4 pt-4 pb-28 outline-none lg:px-8 lg:pt-6 lg:pb-12">
          {child ? <Outlet /> : <EmptyState icon="students" title={t("error.notLinked")} />}
        </main>
      </div>

      <BottomNav />
    </div>
  );
}
