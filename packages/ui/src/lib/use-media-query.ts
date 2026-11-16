import { useSyncExternalStore } from "react";

/**
 * MTB addition. True while the media query matches, kept in step as the window is resized or a phone is turned.
 * Breakpoints follow Tailwind's: sm 640px, md 768px, lg 1024px, xl 1280px.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Phones and small tablets in portrait: below Tailwind's md (768px). */
export const PHONE_QUERY = "(max-width: 767.98px)";
/** Wide enough for the full sidebar beside the page: Tailwind's lg (1024px) and up. */
export const WIDE_QUERY = "(min-width: 1024px)";
