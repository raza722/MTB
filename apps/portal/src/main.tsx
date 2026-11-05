import "@fontsource-variable/inter";
import "@fontsource-variable/noto-nastaliq-urdu";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";

import { ApiError, portalQueries } from "@mtb/api";
import { ToastProvider, TooltipProvider } from "@mtb/ui";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { installAppearance } from "./app/appearance";
import { routeTree } from "./routeTree.gen";

/** A page request that comes back 401 means the session ended (signed out elsewhere, expired): back to sign-in. */
function sessionEnded() {
  if (router.state.location.pathname.startsWith("/sign-in")) return;
  void router.navigate({ to: "/sign-in", search: { expired: true } as never }).then(() => queryClient.removeQueries({ queryKey: portalQueries.all() }));
}

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (error instanceof ApiError && error.status === 401 && query.queryKey[1] !== "session") sessionEnded();
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // A 4xx answer will not change on retry (not linked, not found); a dropped connection might.
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 1,
    },
  },
});

const router = createRouter({ routeTree, context: { queryClient }, defaultPreload: "intent", scrollRestoration: true, defaultViewTransition: true });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

installAppearance();

async function start() {
  // The demo is the real app: MSW answers /api/* in the browser with fictional data.
  if (import.meta.env.VITE_USE_MOCKS !== "false") {
    const { startMockServer } = await import("@mtb/mocks/browser");
    await startMockServer();
  }
  const container = document.getElementById("root");
  if (!container) throw new Error("Missing #root");
  createRoot(container).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={300}>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}

void start();
