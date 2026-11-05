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
import { installAppearance } from "./app/appearance";
import { forgetSession, persistQueries, restoreQueries } from "./app/persist";
import { captureInstallPrompt, registerServiceWorker } from "./app/pwa";
import { queryClient, sessionExpired } from "./app/query-client";
import { installNetwork } from "./app/sync/network";
import { initOutbox } from "./app/sync/outbox";
import { routeTree } from "./routeTree.gen";

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

sessionExpired.handle = () => {
  queryClient.removeQueries({ queryKey: authQueries.session().queryKey });
  // Forget the saved session too (drafts and the outbox stay: they are sent after the teacher signs in again).
  void forgetSession();
  if (!router.state.location.pathname.startsWith("/login")) void router.navigate({ to: "/login" });
};

installAppearance();
installNetwork();
captureInstallPrompt();
registerServiceWorker();

async function start() {
  // The demo is the real app: MSW answers /api/* in the browser with fictional data.
  if (import.meta.env.VITE_USE_MOCKS !== "false") {
    const { startMockServer } = await import("@mtb/mocks/browser");
    await startMockServer();
  }
  // What the phone saved last time (screens, waiting registers and marks) is back before the first screen draws.
  await restoreQueries(queryClient);
  persistQueries(queryClient);
  await initOutbox(queryClient);

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
