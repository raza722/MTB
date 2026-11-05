import { ApiError } from "@mtb/api";
import { Banner, Button } from "@mtb/ui";
import type { UseQueryResult } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { Cls, SessionL } from "../format";
import { useLang, type I18n } from "../i18n";
import { useChild } from "../session";

/** Plain-language text for a failed request, in the reader's language. */
export function errorText(error: unknown, { t, isUr }: Pick<I18n, "t" | "isUr">): string {
  if (error instanceof ApiError) {
    if (error.isNetwork) return t("error.network");
    if (error.code === "NOT_LINKED") return t("error.notLinked");
    if (error.status === 401) return t("error.signedOut");
    return isUr ? t("error.generic") : error.message;
  }
  return t("error.generic");
}

/**
 * Page title with the child's context line ("Ayesha Khan · Class 7-B · Khalid Campus · Session 2026–27"),
 * an optional description and actions. Sets the browser tab title too.
 */
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  const child = useChild();
  const { pick, rich, t } = useLang();
  const childName = child ? pick(child.name, child.nameUr) : "";
  useEffect(() => {
    document.title = `${title}${childName ? ` · ${childName}` : ""} · ${t("app.name")}`;
  }, [title, childName, t]);
  return (
    <header className="mb-4 flex flex-wrap items-end justify-between gap-3 lg:mb-6">
      <div className="grid min-w-0 gap-0.5">
        {child && (
          <p className="m-0 text-small text-ink-muted">
            {childName} · {rich("common.class", { cls: <Cls value={child.classSection} /> })} · {pick(child.campusName, child.campusNameUr)} ·{" "}
            {rich("common.session", { session: <SessionL value={child.session} /> })}
          </p>
        )}
        <h1 className="m-0 text-title-1 text-ink">{title}</h1>
        {description && <p className="m-0 max-w-[62ch] text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="portal-no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Data shown, loading skeleton, or an error banner with Try again (a quiet warning if only a refresh failed). */
export function QueryState<T>({ query, skeleton, children }: { query: UseQueryResult<T>; skeleton: ReactNode; children: (data: T) => ReactNode }) {
  const i18n = useLang();
  const { t } = i18n;
  if (query.data !== undefined) {
    return (
      <>
        {query.isError && (
          <Banner
            tone="warning"
            className="mb-4"
            actions={
              <Button size="sm" onClick={() => void query.refetch()}>
                {t("common.retry")}
              </Button>
            }
          >
            {errorText(query.error, i18n)}
          </Banner>
        )}
        {children(query.data)}
      </>
    );
  }
  if (query.isError) {
    const forbidden = query.error instanceof ApiError && query.error.status === 403;
    return (
      <Banner
        tone={forbidden ? "warning" : "danger"}
        title={forbidden ? undefined : t("error.title")}
        actions={
          forbidden ? undefined : (
            <Button size="sm" onClick={() => void query.refetch()}>
              {t("common.retry")}
            </Button>
          )
        }
      >
        {errorText(query.error, i18n)}
      </Banner>
    );
  }
  return <>{skeleton}</>;
}
