import type { CampusScope } from "@mtb/api";
import { buttonClassName, EmptyState } from "@mtb/ui";
import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Link, Outlet, retainSearchParams } from "@tanstack/react-router";
import { CAMPUS_CODES } from "../app/shell/campus";

/** Campus and session live in the URL, so links and bookmarks always reopen the same context. */
export interface RootSearch {
  campus?: CampusScope;
  session?: number;
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  validateSearch: (s: Record<string, unknown>): RootSearch => ({
    ...(typeof s.campus === "string" && CAMPUS_CODES.includes(s.campus as CampusScope) ? { campus: s.campus as CampusScope } : {}),
    ...(Number(s.session) === 2025 ? { session: 2025 } : {}),
  }),
  search: { middlewares: [retainSearchParams<RootSearch>(["campus", "session"])] },
  component: () => <Outlet />,
  notFoundComponent: () => (
    <div className="grid min-h-screen place-content-center bg-surface p-6">
      <div className="mtb-card max-w-md">
        <EmptyState
          icon="search"
          title="Page not found"
          description="The link may be old or mistyped."
          action={
            <Link to="/dashboard" className={buttonClassName({ variant: "primary" })}>
              Go to dashboard
            </Link>
          }
        />
      </div>
    </div>
  ),
});
