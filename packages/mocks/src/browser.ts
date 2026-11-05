import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";

// Editing a mock file while the app is open must reload the page: a hot update would leave the running
// worker answering with stale handlers or not at all.
(import.meta as { hot?: { decline(): void } }).hot?.decline();

/** Starts the in-browser mock server. Requests to /api/* are answered here; everything else goes to the network. */
export async function startMockServer() {
  const worker = setupWorker(...handlers);
  await worker.start({ onUnhandledRequest: "bypass", quiet: true, serviceWorker: { url: "/mockServiceWorker.js" } });
  return worker;
}
