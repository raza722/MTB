/** CNIC: 13 digits, shown as 36302-4567890-1. Search accepts it with or without dashes. */
export function normalizeCnic(input: string): string {
  return input.replace(/\D/g, "").slice(0, 13);
}

/** Progressive mask while typing: "36302", "36302-45678", "36302-4567890-1". */
export function maskCnic(input: string): string {
  const d = normalizeCnic(input);
  if (d.length <= 5) return d;
  if (d.length <= 12) return `${d.slice(0, 5)}-${d.slice(5)}`;
  return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`;
}

export function isValidCnic(input: string): boolean {
  return /^\d{13}$/.test(normalizeCnic(input)) && input.replace(/[\d-\s]/g, "") === "";
}

/** Formats a complete CNIC; returns the input unchanged if it isn't 13 digits. */
export function formatCnic(input: string): string {
  const d = normalizeCnic(input);
  return d.length === 13 ? maskCnic(d) : input;
}

/** Looks like a CNIC search ("36302-4567890-1" or "3630245678901"). */
export function looksLikeCnic(query: string): boolean {
  return /^\d{5}-?\d{7}-?\d$/.test(query.trim());
}

/** Pakistani mobile numbers: stored as 11 local digits ("03001234567"), shown as "0300-1234567". */
export function normalizeMobile(input: string): string | null {
  let d = input.replace(/\D/g, "");
  if (d.startsWith("0092")) d = d.slice(4);
  else if (d.startsWith("92") && d.length === 12) d = d.slice(2);
  if (d.length === 10 && d.startsWith("3")) d = `0${d}`;
  return /^03\d{9}$/.test(d) ? d : null;
}

export function formatMobile(input: string): string {
  const d = normalizeMobile(input);
  return d ? `${d.slice(0, 4)}-${d.slice(4)}` : input;
}

/** "+923001234567" for SMS gateways. */
export function mobileToE164(input: string): string | null {
  const d = normalizeMobile(input);
  return d ? `+92${d.slice(1)}` : null;
}
