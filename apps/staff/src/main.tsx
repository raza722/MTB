import "@fontsource-variable/inter";
import "@fontsource-variable/noto-nastaliq-urdu";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";

import { authQueries } from "@mtb/api";
import { ToastProvider, TooltipProvider } from "@mtb/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { queryClient, sessionExpired } from "./app/query-client";
import { routeTree } from "./routeTree.gen";

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
  // Page changes cross-fade the page area (styles in @mtb/ui motion.css). Filters and search params change in place;
  // the first load and a background tab skip it (a view transition waits for a frame, and a hidden document rejects it).
  defaultViewTransition: {
    types: ({ fromLocation, pathChanged }) => (fromLocation && pathChanged && document.visibilityState === "visible" ? ["mtb-page"] : false),
  },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

sessionExpired.handle = () => {
  queryClient.removeQueries({ queryKey: authQueries.session().queryKey });
  if (!router.state.location.pathname.startsWith("/login")) void router.navigate({ to: "/login" });
};

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
