import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Link, Outlet } from "@tanstack/react-router";
import { EmptyState } from "@mtb/ui";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => <Outlet />,
  notFoundComponent: () => (
    <main className="grid min-h-dvh place-items-center px-4">
      <EmptyState
        icon="search"
        title="This page doesn't exist"
        description="The link may be old or mistyped."
        action={
          <Link to="/today" className="mtb-btn mtb-btn-primary mtb-btn-touch">
            Go to Today
          </Link>
        }
      />
    </main>
  ),
});
