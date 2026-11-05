import { sessionCode } from "./dates";

/**
 * Document numbers are issued by the server, gap-free per campus per session (brief §3).
 * The browser only formats them. Before posting, a receipt shows "Assigned on posting".
 */
export const RECEIPT_NUMBER_PLACEHOLDER = "Assigned on posting";

/** "KC-14823" */
export function formatGrNo(campusCode: string, serial: number): string {
  return `${campusCode}-${serial}`;
}

/** "KC-2627-004821" (campus–session–sequence) */
export function formatReceiptNo(campusCode: string, sessionStartYear: number, sequence: number): string {
  return `${campusCode}-${sessionCode(sessionStartYear)}-${String(sequence).padStart(6, "0")}`;
}

/** "KC-CN-2627-000037" */
export function formatCancellationNo(campusCode: string, sessionStartYear: number, sequence: number): string {
  return `${campusCode}-CN-${sessionCode(sessionStartYear)}-${String(sequence).padStart(6, "0")}`;
}

/** Receipt-number search accepts "KC-2627-004821", "kc 2627 4821" or "004821". */
export function looksLikeReceiptNo(query: string): boolean {
  return /^[a-z]{2}[-\s]?\d{4}[-\s]?\d{1,6}$/i.test(query.trim());
}

/** G.R. search: "KC-14823" or "kc14823". */
export function looksLikeGrNo(query: string): boolean {
  return /^[a-z]{2}-?\d{3,6}$/i.test(query.trim());
}
