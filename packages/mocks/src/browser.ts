import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";

// Editing a mock file while the app is open must reload the page: a hot update would leave the running
// worker answering with stale handlers or not at all.
(import.meta as { hot?: { decline(): void } }).hot?.decline();

/** Starts the in-browser mock server. Requests to /api/* are answered here; everything else goes to the network. */
export async function startMockServer() {
  // Service workers exist only on secure pages (HTTPS or localhost). Opened over plain HTTP on a network address the
  // app still starts, with every request going to the real API.
  if (!("serviceWorker" in navigator)) {
    console.warn("Sample-data mode is off: this page is not on HTTPS or localhost, so every request goes to the real API.");
    return null;
  }
  const worker = setupWorker(...handlers);
  await worker.start({ onUnhandledRequest: "bypass", quiet: true, serviceWorker: { url: "/mockServiceWorker.js" } });
  return worker;
}
