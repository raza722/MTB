/** Join class names, skipping falsy values. Components use design-system classes, so no merging is needed. */
export function cx(...parts: Array<string | false | null | undefined | 0>): string {
  return parts.filter(Boolean).join(" ");
}

/** "AK" for "Ayesha Khan" — same rule as the design system's format.initials. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
}
