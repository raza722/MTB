/**
 * A search value that names a record (?job=767, ?exam=12, ?batch=42). The router parses an all-digit value as a
 * number, so a link that writes it plainly (the bell, a bookmark, a typed address) arrives as 767, not "767"; a
 * "string only" check then drops it while the raw number still reaches the page (F-073, F-090). Numbers are taken
 * as text here, so both spellings open the same record.
 */
export function idParam(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() ? value : undefined;
}
