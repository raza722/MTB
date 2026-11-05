import { useEffect, type CSSProperties, type ReactNode } from "react";
import { useLang } from "../../app/i18n";
import { LangToggle, ThemeToggle } from "../../app/shell/PortalShell";

/** Centred card with the MTB wordmark, the language switch within reach, and who to call for help. */
export function AuthLayout({ title, subtitle, children, aside }: { title: string; subtitle?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  const { t } = useLang();
  useEffect(() => {
    document.title = `${title} · ${t("app.name")}`;
  }, [title, t]);
  return (
    <div className="min-h-dvh bg-surface">
      <div className="mx-auto flex max-w-[1120px] items-center justify-end gap-2 px-4 pt-[max(12px,env(safe-area-inset-top))]">
        <ThemeToggle />
        <LangToggle />
      </div>
      <div className="mx-auto grid w-full max-w-[440px] gap-6 px-4 pt-6 pb-12 lg:pt-12">
        <div className="mtb-rise grid justify-items-center gap-1 text-center">
          <span className="text-display tracking-tight text-brand-ink">MTB</span>
          <span className="text-small text-ink-muted">{t("app.tagline")}</span>
        </div>
        <main className="mtb-card mtb-rise grid gap-5 p-5 sm:p-6" style={{ "--i": 1 } as CSSProperties}>
          <div className="grid gap-1">
            <h1 className="m-0 text-title-2 text-ink">{title}</h1>
            {subtitle && <p className="m-0 text-ink-muted">{subtitle}</p>}
          </div>
          {children}
        </main>
        {aside}
        <p className="m-0 text-center text-small text-ink-muted">{t("signin.trouble")}</p>
      </div>
    </div>
  );
}
