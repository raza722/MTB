import { buttonClassName, EmptyState } from "@mtb/ui";
import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Link, Outlet, retainSearchParams } from "@tanstack/react-router";
import { Direction } from "radix-ui";
import { useLang } from "../app/i18n";

/** The child on screen lives in the URL (?child=KC-14823), so links and bookmarks reopen the same child. */
export interface RootSearch {
  child?: string;
}

function NotFound() {
  const { t } = useLang();
  return (
    <main className="grid min-h-dvh place-items-center bg-surface px-4">
      <div className="mtb-card max-w-md">
        <EmptyState
          icon="search"
          title={t("notFound.title")}
          description={t("notFound.desc")}
          action={
            <Link to="/home" className={buttonClassName({ variant: "primary", size: "touch" })}>
              {t("notFound.action")}
            </Link>
          }
        />
      </div>
    </main>
  );
}

/** Menus and sheets follow the reading direction too. */
function Root() {
  const { dir } = useLang();
  return (
    <Direction.Provider dir={dir}>
      <Outlet />
    </Direction.Provider>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  validateSearch: (s: Record<string, unknown>): RootSearch => (typeof s.child === "string" && /^[A-Z]{2}-\d{3,6}$/.test(s.child) ? { child: s.child } : {}),
  search: { middlewares: [retainSearchParams<RootSearch>(["child"])] },
  component: Root,
  notFoundComponent: NotFound,
});
