/**
 * Printing waits for the pictures on the page: the crest and the photos moved over from the old system load from the
 * server, and a print dialog opened before they arrive prints empty boxes. Installed once at start (main.tsx), it wraps
 * window.print for every Print button: when every eager picture has loaded (the usual case) it prints at once, exactly
 * as before; otherwise it waits for them, at most 4 seconds, then prints. Lazy pictures (on-screen avatars) are not
 * waited for: they are not on the printout.
 */
const MAX_WAIT_MS = 4000;

function pending(): HTMLImageElement[] {
  return [...document.images].filter((img) => img.loading !== "lazy" && img.getAttribute("src") && !img.complete);
}

export function installPrintWhenReady() {
  if ((window as { __mtbPrintReady?: boolean }).__mtbPrintReady) return;
  (window as { __mtbPrintReady?: boolean }).__mtbPrintReady = true;
  const nativePrint = window.print.bind(window);
  window.print = () => {
    const waiting = pending();
    if (waiting.length === 0) {
      nativePrint();
      return;
    }
    const loads = waiting.map((img) => new Promise<void>((done) => {
      img.addEventListener("load", () => done(), { once: true });
      img.addEventListener("error", () => done(), { once: true });
    }));
    // after the last picture settles, give React two frames to swap a missing photo for its grey outline
    const afterPaint = () => requestAnimationFrame(() => requestAnimationFrame(() => nativePrint()));
    void Promise.race([Promise.all(loads), new Promise((done) => setTimeout(done, MAX_WAIT_MS))]).then(afterPaint);
  };
}
