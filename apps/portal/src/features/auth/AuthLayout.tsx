import { AuthScene, type AuthSceneHighlight } from "@mtb/ui";
import { useEffect, type ReactNode } from "react";
import { useLang } from "../../app/i18n";
import { LangToggle, ThemeToggle } from "../../app/shell/PortalShell";

/** The shared sign-in frame (school crest and the MTB name), the language switch within reach, and who to call for help. */
export function AuthLayout({ title, subtitle, children, aside }: { title: string; subtitle?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  const { t } = useLang();
  useEffect(() => {
    document.title = `${title} · ${t("app.name")}`;
  }, [title, t]);
  const highlights: AuthSceneHighlight[] = [
    { icon: "receipt", text: t("signin.point.fees") },
    { icon: "award", text: t("signin.point.results") },
    { icon: "calendar", text: t("signin.point.attendance") },
    { icon: "bell", text: t("signin.point.notices") },
  ];
  return (
    <AuthScene
      name="MTB"
      tagline={t("app.tagline")}
      highlights={highlights}
      // The crest's own printed wording: kept in English in both languages.
      motto={
        <span dir="ltr" lang="en">
          Inspiring success &amp; changing lives · since 1907
        </span>
      }
      tools={
        <>
          <ThemeToggle />
          <LangToggle />
        </>
      }
    >
      <main className="mtb-card mtb-auth-card grid gap-5 p-5 sm:p-8">
        <div className="grid gap-1">
          <h1 className="m-0 text-title-1 tracking-tight text-ink">{title}</h1>
          {subtitle && <p className="m-0 text-ink-muted">{subtitle}</p>}
        </div>
        {children}
      </main>
      {aside}
      <p className="mtb-auth-foot m-0 text-center text-small text-ink-muted">{t("signin.trouble")}</p>
    </AuthScene>
  );
}
