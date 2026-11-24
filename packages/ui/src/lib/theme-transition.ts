/**
 * Switching between light and dark with an animation (user request, 20-Nov-2026): the new theme opens as a circle
 * from the place that was clicked (the top right corner when the keyboard was used) and spreads over the page.
 * Where the browser has no view transitions, or the person asked for reduced motion, the theme just changes.
 * The look is in motion.css (`html.mtb-theme-switch`).
 */
let lastPoint: { x: number; y: number; at: number } | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", (e) => (lastPoint = { x: e.clientX, y: e.clientY, at: performance.now() }), { capture: true, passive: true });
}

type ViewTransition = { finished: Promise<unknown> };

export function withThemeTransition(change: () => void): void {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => ViewTransition };
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!doc.startViewTransition || reduced || document.hidden) return change();
  const root = document.documentElement;
  // A menu closes a moment after the click: only a recent click counts as where the switch was made.
  const p = lastPoint && performance.now() - lastPoint.at < 1500 ? lastPoint : { x: window.innerWidth - 24, y: 24 };
  root.style.setProperty("--mtb-theme-x", `${p.x}px`);
  root.style.setProperty("--mtb-theme-y", `${p.y}px`);
  root.classList.add("mtb-theme-switch");
  const done = () => root.classList.remove("mtb-theme-switch");
  try {
    doc.startViewTransition(change).finished.then(done, done);
  } catch {
    done();
    change();
  }
}
